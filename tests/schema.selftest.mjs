// T1.1 自测：数据契约与校验纯函数（Node 直接运行，不依赖 DOM / localStorage）
// 运行：node tests/schema.selftest.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LIMITS,
  ERROR_CODES,
} from '../public/assets/js/constants.js';
import {
  normalizeText,
  countChars,
  normalizeTerm,
  isSubstringAfterNormalize,
  isTermInContent,
  validateNodeTree,
  validateChapterRecord,
  validateMeta,
  validateHighlightStore,
  validateCardStore,
  parseAiResponse,
  wrapSections,
  injectNodeIds,
  collectNodes,
  walkTree,
  dedupeSections,
  mergeChunkSections,
  createNodeId,
} from '../public/assets/js/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(HERE, '..', 'fixtures', 'json');

// 与 tools/make-fixtures.mjs 的 CHAPTERS[0] 保持一致（夹具 content 均摘自该章）。
const CH1_PARAGRAPHS = [
  '物质是不依赖于人的意识并能为人的意识所反映的客观实在。世界统一于物质，物质决定意识，意识对物质具有能动的反作用。承认世界的物质性，是坚持一切从实际出发、实事求是的前提。',
  '运动是物质的根本属性，时间和空间是运动着的物质的存在形式。物质世界处在永恒的运动、变化和发展之中，静止只是运动的一种特殊状态。',
  '规律是事物运动过程中固有的本质的、必然的、稳定的联系。规律具有客观性，人们不能创造规律，也不能消灭规律，但可以认识和利用规律。',
];
const CH1_TEXT = CH1_PARAGRAPHS.join('\n');
const SENT_0_0 = `${CH1_PARAGRAPHS[0].split('。')[0]}。`;
const SENT_0_1 = `${CH1_PARAGRAPHS[0].split('。')[1]}。`;

const ISO = '2026-11-20T09:30:00.000Z';
const DOC_ID = 'doc_6f2b8c1e-6a83-4f5a-9a4a-9d8f0c91b2a1';
const CH_ID = 'ch_0a1b2c3d-1111-4222-8333-444455556666';
const NODE_ID = 'n_22222222-3333-4444-8555-666666666666';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function summarize(result) {
  if (!result || !result.errors) return '无结构化结果';
  const types = result.errors.map((e) => e.type).join(', ');
  return types || '（无错误）';
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8'));
}

// ---------------------------------------------------------------------------
console.log('\n[1] 归一化与计数');
// ---------------------------------------------------------------------------

check('normalizeText：CRLF / 制表符 / 全角空格 / NUL 折叠为单空格', () => {
  const raw = '物质\r\n决定\t意识\u3000\u3000世界\u0000！';
  assert(normalizeText(raw) === '物质 决定 意识 世界！', `实际：${JSON.stringify(normalizeText(raw))}`);
});

check('normalizeText：NFC 合成与 trim', () => {
  assert(normalizeText('  e\u0301  ') === 'é', `实际：${normalizeText('  e\u0301  ')}`);
});

check('countChars：按码点计数', () => {
  assert(countChars('𠀀') === 1, '代理对应按 1 个字符计');
  assert(countChars('abc') === 3, 'ASCII 计数错误');
  assert(countChars(null) === 0, '非字符串应返回 0');
});

check('normalizeTerm：NFKC + 空白折叠 + 英文小写', () => {
  assert(normalizeTerm('Ｍａｒｘ　Ｔｈｅｏｒｙ ') === 'marx theory', normalizeTerm('Ｍａｒｘ　Ｔｈｅｏｒｙ '));
});

check('isSubstringAfterNormalize：PDF 硬换行不误判为改写', () => {
  const content = '物质是不依赖于人的意识\r\n并能为人的意识所反映的客观实在。';
  assert(isSubstringAfterNormalize(content, CH1_TEXT), '应判定为连续子串');
  assert(!isSubstringAfterNormalize('物体是不依赖于人的意识。', CH1_TEXT), '改写内容不应通过');
});

check('isTermInContent：英文不区分大小写', () => {
  assert(isTermInContent('material', 'The Material World'), '英文应大小写不敏感');
  assert(!isTermInContent('生产力', SENT_0_0), '不存在的术语不应命中');
});

// ---------------------------------------------------------------------------
console.log('\n[2] 节点树夹具（F-10）');
// ---------------------------------------------------------------------------

const fixtureFiles = fs.readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();
let fixtureCount = 0;

for (const file of fixtureFiles) {
  const fixture = readFixture(file);
  if (fixture.id === 'response-fenced') continue;
  fixtureCount += 1;
  check(`夹具 ${fixture.id}（${fixture.expect}）`, () => {
    const result = validateNodeTree(fixture.tree, {
      sourceText: CH1_TEXT,
      chapterTitle: fixture.tree.title,
    });
    if (fixture.expect === 'pass') {
      assert(result.ok, `应通过，实际错误：${summarize(result)}`);
      assert(result.errors.length === 0, `不应有错误：${summarize(result)}`);
      assert(result.value && result.value.content === '', '根节点 content 应为空串');
      return;
    }
    assert(!result.ok, '应被拒绝');
    const hit = result.errors.find((e) => e.type === fixture.violation);
    assert(hit, `缺少预期错误 ${fixture.violation}，实际：${summarize(result)}`);
    assert(hit.code === ERROR_CODES.AI_VALIDATION, `错误码应为 AI_VALIDATION，实际：${hit.code}`);
  });
}

check('根节点标题允许 >12 且 content 为空', () => {
  const longTitle = '第一章 世界的物质性与意识的能动作用';
  assert(countChars(longTitle) > LIMITS.titleMax, '测试用根标题应超过 12 字');
  const tree = {
    id: NODE_ID,
    title: longTitle,
    content: '',
    terms: [],
    children: [
      { id: 'n_00000002-0000-4000-8000-000000000000', title: '物质与意识', content: SENT_0_0, terms: [], children: [] },
    ],
  };
  const result = validateNodeTree(tree, { sourceText: CH1_TEXT, chapterTitle: longTitle });
  assert(result.ok, `应通过，实际错误：${summarize(result)}`);
});

check('错误聚合最多 20 条并标记 truncated', () => {
  const children = Array.from({ length: 30 }, (_, i) => ({
    id: `n_0000${String(i).padStart(4, '0')}-0000-4000-8000-000000000000`,
    title: '物质论',
    content: SENT_0_0,
    terms: [],
    children: [],
  }));
  const tree = { id: NODE_ID, title: '第一章 世界的物质性', content: '', terms: [], children };
  const result = validateNodeTree(tree, { sourceText: CH1_TEXT, chapterTitle: tree.title });
  assert(!result.ok, '应被拒绝');
  assert(result.errors.length === LIMITS.validationErrorMax, `错误条数应被截断为 ${LIMITS.validationErrorMax}`);
  assert(result.truncated === true, '应标记 truncated');
});

// ---------------------------------------------------------------------------
console.log('\n[3] AI 响应解析与树工具');
// ---------------------------------------------------------------------------

check('response-fenced：围栏 + 前后说明可提取并通过校验', () => {
  const fixture = readFixture('response-fenced.json');
  const parsed = parseAiResponse(fixture.rawText);
  assert(parsed.ok, `解析应成功，实际：${summarize(parsed)}`);
  assert(parsed.value.sections.length === 3, '应提取 3 个一级节点');

  const wrapped = wrapSections(parsed.value.sections, { chapterTitle: '第一章 世界的物质性' });
  const injected = injectNodeIds(wrapped);
  const nodes = collectNodes(injected);
  assert(nodes.length === 5, `节点数应为 5，实际 ${nodes.length}`);
  assert(nodes.every((n) => n.id.startsWith('n_')), 'id 应以 n_ 开头');
  assert(new Set(nodes.map((n) => n.id)).size === nodes.length, 'id 应唯一');

  const result = validateNodeTree(injected, {
    sourceText: CH1_TEXT,
    chapterTitle: '第一章 世界的物质性',
  });
  assert(result.ok, `包装后应通过校验，实际：${summarize(result)}`);
  assert(result.value.title === '第一章 世界的物质性', '根标题应为章节标题');
});

check('畸形输出返回 AI_BAD_RESPONSE', () => {
  const result = parseAiResponse('抱歉，我无法按 JSON 输出。');
  assert(!result.ok, '应失败');
  assert(result.errors[0].code === ERROR_CODES.AI_BAD_RESPONSE, `错误码应为 AI_BAD_RESPONSE`);
});

check('JSON 前后夹带说明文字仍可提取', () => {
  const raw = `结果如下：\n${JSON.stringify({
    sections: [{ title: '物质与意识', content: SENT_0_0, terms: [], children: [] }],
  })}\n以上。`;
  const result = parseAiResponse(raw);
  assert(result.ok, `应解析成功，实际：${summarize(result)}`);
  assert(result.value.sections.length === 1, '应提取 1 个节点');
});

check('wrapSections + injectNodeIds：保留已有合法 id、替换重复 id', () => {
  const wrapped = wrapSections(
    [
      { id: NODE_ID, title: '物质与意识', content: SENT_0_0, terms: [], children: [] },
      { id: NODE_ID, title: '运动与静止', content: SENT_0_1, terms: [], children: [] },
    ],
    { chapterTitle: '第一章 世界的物质性' },
  );
  const injected = injectNodeIds(wrapped);
  assert(injected.id.startsWith('n_'), '根节点应获得 id');
  assert(injected.children[0].id === NODE_ID, '首个合法 id 应保留');
  assert(injected.children[1].id !== NODE_ID, '重复 id 应被替换');
});

check('walkTree 先序与 collectNodes 一致', () => {
  const tree = injectNodeIds(wrapSections([{ title: '物质与意识', content: SENT_0_0, terms: [], children: [{ title: '意识的能动作用', content: SENT_0_1, terms: [], children: [] }] }], { chapterTitle: '第一章 世界的物质性' }));
  const visited = [];
  walkTree(tree, (node, meta) => visited.push(`${meta.depth}:${node.title}`));
  assert(visited[0] === '1:第一章 世界的物质性', `先序首项错误：${visited[0]}`);
  assert(visited[1] === '2:物质与意识', `先序第二项错误：${visited[1]}`);
  assert(visited[2] === '3:意识的能动作用', `先序第三项错误：${visited[2]}`);
});

check('dedupeSections：完全相同去重、同名不同 content 保留', () => {
  const a = { title: '物质与意识', content: SENT_0_0 };
  const same = { title: '物质与意识', content: SENT_0_0 };
  const other = { title: '物质与意识', content: SENT_0_1 };
  const out = dedupeSections([a, same, other]);
  assert(out.length === 2, `应保留 2 个，实际 ${out.length}`);
  assert(mergeChunkSections([[a], [same]]).length === 1, '跨块重复应去重');
  assert(mergeChunkSections([[a], [other]]).length === 2, '不同 content 不应去重');
});

check('createNodeId 生成合法且唯一 id', () => {
  const ids = new Set(Array.from({ length: 50 }, () => createNodeId()));
  assert(ids.size === 50, 'id 应唯一');
  for (const id of ids) assert(/^n_[A-Za-z0-9_-]+$/.test(id), `id 不合法：${id}`);
});

// ---------------------------------------------------------------------------
console.log('\n[4] 章节 / 元数据 / 标亮 / 卡片校验');
// ---------------------------------------------------------------------------

check('validateChapterRecord：合法记录通过', () => {
  const validTree = readFixture('valid-tree.json').tree;
  const record = {
    schemaVersion: 1,
    docId: DOC_ID,
    chapterId: CH_ID,
    title: '第一章 世界的物质性',
    tree: validTree,
    generation: { model: 'mock-model', promptVersion: 'struct-v1', generatedAt: ISO },
    updatedAt: ISO,
  };
  const result = validateChapterRecord(record, { sourceText: CH1_TEXT });
  assert(result.ok, `应通过，实际：${summarize(result)}`);
});

check('validateMeta：合法元数据通过', () => {
  const meta = {
    schemaVersion: 1,
    docId: DOC_ID,
    title: '马克思主义基本原理',
    sourceFileName: 'bookmarked.pdf',
    pageCount: 42,
    segmentation: 'bookmark',
    createdAt: ISO,
    updatedAt: ISO,
    chapters: [
      { id: CH_ID, order: 0, title: '第一章 世界的物质性', startPage: 1, endPage: 12, charCount: 8210, status: 'ready', nodeCount: 5, hasSource: true, lastError: null },
      { id: 'ch_1b2c3d4e-7777-4888-9999-aaaabbbbcccc', order: 1, title: '第二章 实践与认识', startPage: 13, endPage: 42, charCount: 18420, status: 'pending', nodeCount: 0, hasSource: true, lastError: null },
    ],
  };
  const result = validateMeta(meta);
  assert(result.ok, `应通过，实际：${summarize(result)}`);
});

check('validateMeta：order 不连续被拒绝', () => {
  const meta = {
    schemaVersion: 1,
    docId: DOC_ID,
    title: '马克思主义基本原理',
    sourceFileName: 'bookmarked.pdf',
    pageCount: 42,
    segmentation: 'bookmark',
    createdAt: ISO,
    updatedAt: ISO,
    chapters: [{ id: CH_ID, order: 5, title: '第一章', startPage: 1, endPage: 12, charCount: 100, status: 'ready', nodeCount: 5, hasSource: true, lastError: null }],
  };
  const result = validateMeta(meta);
  assert(!result.ok, '应被拒绝');
  assert(result.errors.some((e) => e.type === 'order-not-continuous'), `实际：${summarize(result)}`);
});

check('validateMeta：未知 schemaVersion 被拒绝', () => {
  const meta = { schemaVersion: 2, docId: DOC_ID, title: 'x', sourceFileName: 'a.pdf', pageCount: 1, segmentation: 'single', createdAt: ISO, updatedAt: ISO, chapters: [{ id: CH_ID, order: 0, title: '全文', startPage: 1, endPage: 1, charCount: 1, status: 'ready', nodeCount: 1, hasSource: true, lastError: null }] };
  const result = validateMeta(meta);
  assert(!result.ok, '应被拒绝');
  assert(result.errors.some((e) => e.type === 'schema-version'), `实际：${summarize(result)}`);
});

const highlight = (id, start, end, quote) => ({ id, start, end, quote, color: 'amber', createdAt: ISO });
const hlStore = (list) => ({
  schemaVersion: 1,
  docId: DOC_ID,
  byChapter: { [CH_ID]: { [NODE_ID]: list } },
  updatedAt: ISO,
});

check('validateHighlightStore：合法与相邻区间通过', () => {
  const content = '马克思主义是无产阶级的思想体系。';
  const store = hlStore([
    highlight('hl_11111111-2222-4333-8444-555555555555', 0, 5, '马克思主义'),
    highlight('hl_22222222-3333-4444-8555-666666666666', 5, 6, '是'),
  ]);
  const result = validateHighlightStore(store, { getContent: () => content });
  assert(result.ok, `应通过，实际：${summarize(result)}`);
});

check('validateHighlightStore：重叠区间被拒绝', () => {
  const content = '马克思主义是无产阶级的思想体系。';
  const store = hlStore([
    highlight('hl_11111111-2222-4333-8444-555555555555', 0, 6, '马克思主义是'),
    highlight('hl_22222222-3333-4444-8555-666666666666', 3, 8, '思主义是无'),
  ]);
  const result = validateHighlightStore(store, { getContent: () => content });
  assert(!result.ok, '应被拒绝');
  assert(result.errors.some((e) => e.type === 'highlight-overlap'), `实际：${summarize(result)}`);
});

check('validateHighlightStore：quote 与区间不一致被拒绝', () => {
  const content = '马克思主义是无产阶级的思想体系。';
  const store = hlStore([highlight('hl_11111111-2222-4333-8444-555555555555', 0, 5, '马克思')]);
  const result = validateHighlightStore(store, { getContent: () => content });
  assert(!result.ok, '应被拒绝');
  assert(result.errors.some((e) => e.type === 'highlight-quote-mismatch'), `实际：${summarize(result)}`);
});

const makeCard = (id, term, normalizedTerm) => ({
  id,
  term,
  normalizedTerm,
  definition: '不依赖于人的意识并能为人的意识所反映的客观实在。',
  sources: [{ chapterId: CH_ID, chapterTitle: '第一章 世界的物质性', nodeId: NODE_ID, nodeTitle: '物质与意识' }],
  createdAt: ISO,
  updatedAt: ISO,
});

check('validateCardStore：合法卡片通过', () => {
  const store = {
    schemaVersion: 1,
    docId: DOC_ID,
    cards: [makeCard('card_12345678-90ab-4cde-8f01-234567890abc', 'Ｍａｒｘ', normalizeTerm('Ｍａｒｘ'))],
    updatedAt: ISO,
  };
  const result = validateCardStore(store);
  assert(result.ok, `应通过，实际：${summarize(result)}`);
});

check('validateCardStore：归一化术语重复被拒绝', () => {
  const store = {
    schemaVersion: 1,
    docId: DOC_ID,
    cards: [
      makeCard('card_12345678-90ab-4cde-8f01-234567890abc', 'Marx', 'marx'),
      makeCard('card_22345678-90ab-4cde-8f01-234567890abc', 'ｍａｒｘ', 'ｍａｒｘ'),
    ],
    updatedAt: ISO,
  };
  const result = validateCardStore(store);
  assert(!result.ok, '应被拒绝');
  assert(
    result.errors.some((e) => e.type === 'duplicate-normalized-term' || e.type === 'normalized-term-mismatch'),
    `实际：${summarize(result)}`,
  );
});

// ---------------------------------------------------------------------------
console.log(`\n结果：${passed} 项通过，${failures.length} 项失败（节点树夹具 ${fixtureCount} 个）`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
