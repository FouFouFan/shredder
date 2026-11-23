// T0.3 夹具生成脚本（开发专用，不属于发布路径）
// 用法：node tools/make-fixtures.mjs
// 依赖：devdeps/node_modules（pdfkit）。未提交 devdeps。
//
// 生成 fixtures/ 下的 PDF 夹具。全部内容为自撰示例文本，不含任何受版权教材。
// 大型夹具（F-02 20 章 / F-08 80MB / F-09 超限）不在默认输出内，
// 如需生成请传 --large（会占用较多磁盘，不随仓库提交）。

import PDFDocument from '../devdeps/node_modules/pdfkit/js/pdfkit.js';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'fixtures');
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/simsun.ttc',
  'C:/Windows/Fonts/msyh.ttc',
];
const FONT = FONT_CANDIDATES.find((p) => fs.existsSync(p));
const LARGE = process.argv.includes('--large');

if (!FONT) {
  console.error('未找到可用的中文字体，请调整 FONT_CANDIDATES。');
  process.exit(1);
}

// ---- 自撰示例正文（Mock 合法响应会逐字摘录其中句子，改动时需同步 ai-mock 场景） ----
export const CHAPTERS = [
  {
    title: '第一章 世界的物质性',
    paragraphs: [
      '物质是不依赖于人的意识并能为人的意识所反映的客观实在。世界统一于物质，物质决定意识，意识对物质具有能动的反作用。承认世界的物质性，是坚持一切从实际出发、实事求是的前提。',
      '运动是物质的根本属性，时间和空间是运动着的物质的存在形式。物质世界处在永恒的运动、变化和发展之中，静止只是运动的一种特殊状态。',
      '规律是事物运动过程中固有的本质的、必然的、稳定的联系。规律具有客观性，人们不能创造规律，也不能消灭规律，但可以认识和利用规律。',
    ],
  },
  {
    title: '第二章 实践与认识',
    paragraphs: [
      '实践是人类能动地改造客观世界的物质活动，具有直接现实性、自觉能动性和社会历史性三个基本特征。实践是认识的基础，认识的产生、发展、检验和目的都离不开实践。',
      '认识是主体对客体的能动反映，经历了从感性认识到理性认识、再从理性认识到实践的两次飞跃。真理是标志主观同客观相符合的哲学范畴。',
      '真理既是绝对的又是相对的。坚持真理与修正错误是同一过程的两个方面，任何真理都是在一定条件下对客观事物的正确反映。',
    ],
  },
  {
    title: '第三章 社会历史的发展',
    paragraphs: [
      '社会存在决定社会意识，社会意识对社会存在具有能动的反作用。生产力与生产关系、经济基础与上层建筑的矛盾运动，是社会发展的根本动力。',
      '人民群众是历史的创造者，是社会物质财富和精神财富的创造者，是社会变革的决定力量。坚持群众观点和群众路线，是无产阶级政党的根本工作方法。',
    ],
  },
];

// 无章标题的通用段落（用于 no-chapter.pdf）
const PLAIN_PARAGRAPHS = [
  '本节讨论研究对象的基本概念与相互关系，说明概念的适用范围与边界条件。',
  '分析问题时应当先明确对象，再梳理关系，最后给出可检验的结论。',
  '任何结论都依赖前提，改变前提时结论需要重新检验，不能直接沿用。',
  '方法的选择取决于目标与约束，脱离约束讨论方法优劣没有意义。',
  '在复杂系统中，局部最优往往不等于整体最优，需要从整体上权衡。',
];

const TOC_LINES = [
  '第一章 世界的物质性',
  '第二章 实践与认识',
  '第三章 社会历史的发展',
  '第四章 资本主义的本质',
  '第五章 资本主义的发展',
  '第六章 社会主义的发展',
  '第七章 共产主义理想',
  '第八章 认识的辩证过程',
  '第九章 社会基本矛盾',
  '第十章 历史发展动力',
];

/** 生成一个 PNG（8 位灰度渐变 + 方块），用于构造无文本层的“扫描件”。 */
function makeGrayPng(width, height) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const block = (Math.floor(x / 40) + Math.floor(y / 40)) % 2 === 0 ? 235 : 190;
      const grad = Math.round((x / width) * 40);
      raw[rowStart + 1 + x] = Math.max(0, Math.min(255, block - grad));
    }
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([len, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 通用 PDF 构建器：按章节分页，可选书签与加密。 */
function buildPdf({ chapters, outline = false, password, pagesPerChapter = 2, tocPage = false }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 64, bottom: 64, left: 64, right: 64 },
      userPassword: password,
      ownerPassword: password ? `${password}-owner` : undefined,
      info: { Title: 'TMM 夹具（自撰示例）', Creator: 'tools/make-fixtures.mjs' },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.font(FONT);

    if (tocPage) {
      doc.fontSize(20).text('目 录', { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(12);
      TOC_LINES.forEach((line, i) => {
        doc.text(`${line}${' '.repeat(6)}${(i + 1) * 15}`, { lineGap: 6 });
      });
      doc.addPage();
    }

    chapters.forEach((chapter, idx) => {
      for (let p = 0; p < pagesPerChapter; p += 1) {
        if (idx > 0 || p > 0 || tocPage) doc.addPage();
        // 书签在 addPage 之后添加，指向当前页
        if (outline && p === 0) doc.outline.addItem(chapter.title);
        doc.fontSize(12);
        if (p === 0) {
          doc.fontSize(18).text(chapter.title, { lineGap: 8 });
          doc.moveDown(0.6);
          doc.fontSize(12);
        }
        const start = Math.floor((chapter.paragraphs.length / pagesPerChapter) * p);
        const end = Math.floor((chapter.paragraphs.length / pagesPerChapter) * (p + 1));
        chapter.paragraphs.slice(start, Math.max(end, start + 1)).forEach((para) => {
          doc.text(para, { lineGap: 8, align: 'justify' });
          doc.moveDown(0.5);
        });
      }
    });

    doc.end();
  });
}

// ---------- JSON 树夹具（F-10）与 Mock 响应集（F-11） ----------

const UUID = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const nodeId = (n) => `n_${UUID(n)}`;

const CH1 = CHAPTERS[0].paragraphs;
const sent = (p, i) => CH1[p].split('。')[i] + '。';

/** 合法树：根 content 为空，其余 content 均为第一章原文连续子串。 */
const VALID_TREE = {
  id: nodeId(1),
  title: '第一章 世界的物质性',
  content: '',
  terms: [],
  children: [
    {
      id: nodeId(2),
      title: '物质与意识',
      content: sent(0, 0),
      terms: [
        { term: '物质', definition: '不依赖于人的意识并能为人的意识所反映的客观实在。' },
        { term: '客观实在', definition: '独立于人的意识之外而存在的实在性。' },
      ],
      children: [
        {
          id: nodeId(3),
          title: '意识的能动作用',
          content: sent(0, 1),
          terms: [{ term: '意识', definition: '人脑对客观存在的反映，具有能动作用。' }],
          children: [],
        },
      ],
    },
    {
      id: nodeId(4),
      title: '运动与静止',
      content: sent(1, 0),
      terms: [{ term: '运动', definition: '物质的根本属性，指事物的一切变化和过程。' }],
      children: [],
    },
    {
      id: nodeId(5),
      title: '规律的客观性',
      content: sent(2, 0),
      terms: [{ term: '规律', definition: '事物运动过程中固有的本质的、必然的、稳定的联系。' }],
      children: [],
    },
  ],
};

const clone = (v) => JSON.parse(JSON.stringify(v));
/** 取第一章首个段落中长度恰为 81 的连续片段（用于制造“仅长度超限”的非法节点）。 */
const window81 = CH1[0].slice(0, 81);

const invalidTrees = [
  {
    id: 'invalid-title-short-3',
    description: '非根节点标题为 3 字（下限 4）',
    expect: 'reject',
    expectError: 'AI_VALIDATION',
    violation: 'title-length<4',
    tree: (() => { const t = clone(VALID_TREE); t.children[1].title = '物质论'; return t; })(),
  },
  {
    id: 'invalid-title-long-13',
    description: '非根节点标题为 13 字（上限 12）',
    expect: 'reject',
    expectError: 'AI_VALIDATION',
    violation: 'title-length>12',
    tree: (() => { const t = clone(VALID_TREE); t.children[1].title = '物质与意识的辩证关系原理论'; return t; })(),
  },
  {
    id: 'invalid-content-81',
    description: '非根节点 content 为 81 字（上限 80），且仍是原文片段',
    expect: 'reject',
    expectError: 'AI_VALIDATION',
    violation: 'content-length>80',
    tree: (() => { const t = clone(VALID_TREE); t.children[1].content = window81; return t; })(),
  },
  {
    id: 'invalid-content-rewritten',
    description: 'content 被改写（“物质”改为“物体”），不再是原文连续子串',
    expect: 'reject',
    expectError: 'AI_VALIDATION',
    violation: 'content-not-substring',
    tree: (() => { const t = clone(VALID_TREE); t.children[1].content = sent(0, 0).replace('物质', '物体'); return t; })(),
  },
  {
    id: 'invalid-depth-5',
    description: '层级为 5（含根），超过上限 4',
    expect: 'reject',
    expectError: 'AI_VALIDATION',
    violation: 'depth>4',
    tree: (() => {
      const t = clone(VALID_TREE);
      t.children[0].children[0].children = [{
        id: nodeId(20),
        title: '主体与客体',
        content: sent(0, 2),
        terms: [],
        children: [{
          id: nodeId(21),
          title: '认识的两次飞跃',
          content: sent(0, 2),
          terms: [],
          children: [],
        }],
      }];
      return t;
    })(),
  },
  {
    id: 'invalid-children-9',
    description: '根节点直接子节点为 9 个（上限 8）',
    expect: 'reject',
    expectError: 'AI_VALIDATION',
    violation: 'children>8',
    tree: (() => {
      const t = clone(VALID_TREE);
      t.children = Array.from({ length: 9 }, (_, i) => ({
        id: nodeId(40 + i),
        title: '运动与静止',
        content: sent(1, 0),
        terms: [],
        children: [],
      }));
      return t;
    })(),
  },
  {
    id: 'invalid-node-count-101',
    description: '节点总数为 101（含根，上限 100）',
    expect: 'reject',
    expectError: 'AI_VALIDATION',
    violation: 'nodeCount>100',
    tree: (() => {
      const t = { ...clone(VALID_TREE), children: [] };
      let seq = 100;
      const makeLeaf = () => ({
        id: nodeId((seq += 1)),
        title: '运动与静止',
        content: sent(1, 0),
        terms: [],
        children: [],
      });
      // 100 个节点分配到 8 个一级分支（每个分支 ≤8 个子节点）
      for (let b = 0; b < 8; b += 1) {
        const branch = {
          id: nodeId((seq += 1)),
          title: '规律的客观性',
          content: sent(2, 0),
          terms: [],
          children: Array.from({ length: 8 }, makeLeaf),
        };
        t.children.push(branch);
      }
      return t; // 1 + 8 + 64 = 73 → 下方补齐到 101
    })(),
  },
  {
    id: 'invalid-term-not-in-content',
    description: '术语“生产力”未出现在该节点 content 中',
    expect: 'reject',
    expectError: 'AI_VALIDATION',
    violation: 'term-not-in-content',
    tree: (() => {
      const t = clone(VALID_TREE);
      t.children[0].terms[0] = { term: '生产力', definition: '人类改造自然的能力。' };
      return t;
    })(),
  },
];

/** 把 invalid-node-count-101 补齐为恰好 101 个节点（73 + 28，补在第 4 层，避免同时违反子节点上限）。 */
(() => {
  const t = invalidTrees.find((x) => x.id === 'invalid-node-count-101').tree;
  let seq = 900;
  const leaves = t.children.flatMap((b) => b.children);
  for (let i = 0; i < 28; i += 1) {
    leaves[i].children.push({
      id: nodeId((seq += 1)),
      title: '物质与意识',
      content: sent(0, 0),
      terms: [],
      children: [],
    });
  }
})();

const fencedResponse = {
  id: 'response-fenced',
  description: '模型输出被 Markdown 围栏包裹并带前后说明文字',
  expect: 'pass-after-extraction',
  rawText: `以下是本章结构化结果：\n\n\`\`\`json\n${JSON.stringify({ sections: VALID_TREE.children }, null, 2)}\n\`\`\`\n\n希望对你有帮助。`,
};

function writeJsonFixtures() {
  const dir = path.join(OUT, 'json');
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, obj) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(obj, null, 2)}\n`, 'utf8');

  write('valid-tree.json', {
    id: 'valid-tree',
    description: '合法树：3 个一级节点、1 个二级节点，所有 content 均为第一章原文连续子串',
    expect: 'pass',
    tree: VALID_TREE,
  });
  write('valid-tree-deep.json', {
    id: 'valid-tree-deep',
    description: '合法深度上限：4 层（含根）',
    expect: 'pass',
    tree: (() => {
      const t = clone(VALID_TREE);
      t.children[0].children[0].children = [{
        id: nodeId(30),
        title: '真理的绝对性',
        content: sent(0, 2),
        terms: [],
        children: [],
      }];
      return t;
    })(),
  });
  invalidTrees.forEach((x) => write(`${x.id}.json`, x));
  write('response-fenced.json', fencedResponse);

  return ['valid-tree.json', 'valid-tree-deep.json', 'response-fenced.json'].length + invalidTrees.length;
}

/** Mock 响应信封：与 OpenAI 兼容接口一致，便于 AI 客户端直接复用。 */
const mockEnvelope = ({ id, description, expect, httpStatus = 200, delayMs = 0, content, body, chunks }) => ({
  id,
  description,
  expect,
  httpStatus,
  delayMs,
  ...(content !== undefined ? {
    body: {
      id: `chatcmpl-mock-${id}`,
      object: 'chat.completion',
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1200, completion_tokens: 800 },
    },
  } : {}),
  ...(body !== undefined ? { body } : {}),
  ...(chunks !== undefined ? { chunks } : {}),
});

function writeMockScenarios() {
  const dir = path.join(ROOT, 'public', 'assets', 'mock');
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, obj) => fs.writeFileSync(path.join(dir, name), `${JSON.stringify(obj, null, 2)}\n`, 'utf8');

  const validContent = JSON.stringify({ sections: VALID_TREE.children });
  const scenarios = [
    mockEnvelope({
      id: 'success',
      description: '合法响应：sections 全部逐字摘录 bookmarked.pdf 第一章原文',
      expect: 'pass',
      content: validContent,
    }),
    mockEnvelope({
      id: 'fenced',
      description: 'Markdown 围栏包裹 + 前后说明文字，需要先提取 JSON',
      expect: 'pass-after-extraction',
      content: `好的，下面是结果：\n\`\`\`json\n${validContent}\n\`\`\`\n以上是本章的知识结构。`,
    }),
    mockEnvelope({
      id: 'malformed',
      description: 'JSON 被截断，无法解析',
      expect: 'AI_BAD_RESPONSE',
      content: '{"sections": [{"title": "物质与意识", "content": "物质是不依赖',
    }),
    mockEnvelope({
      id: 'http-401',
      description: '上游 401：Key 无效或过期（不自动重试）',
      expect: 'AI_AUTH',
      httpStatus: 401,
      body: { error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } },
    }),
    mockEnvelope({
      id: 'http-403',
      description: '上游 403：无权限（不自动重试）',
      expect: 'AI_AUTH',
      httpStatus: 403,
      body: { error: { message: 'Forbidden', type: 'permission_error' } },
    }),
    mockEnvelope({
      id: 'http-429',
      description: '上游 429：限流，应按 1s/3s 退避重试',
      expect: 'AI_RATE_LIMIT',
      httpStatus: 429,
      body: { error: { message: 'Rate limit exceeded', type: 'rate_limit_error' } },
    }),
    mockEnvelope({
      id: 'http-500',
      description: '上游 500：服务异常，应重试，达上限映射 AI_UPSTREAM',
      expect: 'AI_UPSTREAM',
      httpStatus: 500,
      body: { error: { message: 'Internal server error', type: 'server_error' } },
    }),
    mockEnvelope({
      id: 'timeout',
      description: '响应延迟 5s，用于触发客户端超时（AI_TIMEOUT）',
      expect: 'AI_TIMEOUT',
      delayMs: 5000,
      content: validContent,
    }),
    mockEnvelope({
      id: 'chunk-partial-fail',
      description: '分块场景：第 1 块成功、第 2 块 500，整章应失败且不保存部分结果',
      expect: 'AI_UPSTREAM',
      chunks: [
        { httpStatus: 200, delayMs: 0, content: JSON.stringify({ sections: VALID_TREE.children.slice(0, 2) }) },
        { httpStatus: 500, delayMs: 0, body: { error: { message: 'Internal server error', type: 'server_error' } } },
      ],
    }),
  ];

  scenarios.forEach((s) => write(`${s.id}.json`, s));
  return scenarios.length;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = [];

  const write = (name, buf) => {
    const file = path.join(OUT, name);
    fs.writeFileSync(file, buf);
    manifest.push({ name, bytes: buf.length });
  };

  // F-01 书签 3 章
  write('bookmarked.pdf', await buildPdf({ chapters: CHAPTERS, outline: true, pagesPerChapter: 2 }));

  // F-03 无书签但有章标题
  write('no-bookmark.pdf', await buildPdf({ chapters: CHAPTERS, outline: false, pagesPerChapter: 2 }));

  // F-04 无书签、无章标题
  write('no-chapter.pdf', await buildPdf({
    chapters: [{ title: '', paragraphs: PLAIN_PARAGRAPHS }],
    outline: false,
    pagesPerChapter: 3,
  }));

  // F-05 目录页含大量章标题
  write('toc-false-positive.pdf', await buildPdf({
    chapters: CHAPTERS,
    outline: false,
    pagesPerChapter: 1,
    tocPage: true,
  }));

  // F-06 加密 PDF（用户密码 123456）
  write('encrypted.pdf', await buildPdf({
    chapters: [CHAPTERS[0]],
    outline: false,
    pagesPerChapter: 1,
    password: '123456',
  }));

  // F-07 无文本层（纯图片）
  const png = makeGrayPng(560, 760);
  const scanned = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 40, left: 40, right: 40 } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.image(png, 40, 40, { fit: [515, 760] });
    doc.addPage();
    doc.image(png, 40, 40, { fit: [515, 760] });
    doc.end();
  });
  write('scanned.pdf', scanned);

  // 损坏样本：截断（保留 %PDF 头）与非法类型
  const bookmarked = fs.readFileSync(path.join(OUT, 'bookmarked.pdf'));
  write('corrupted.pdf', bookmarked.subarray(0, Math.floor(bookmarked.length * 0.55)));
  write('not-a-pdf.pdf', Buffer.from('这不是一个 PDF 文件。\nThis is not a PDF file.\n', 'utf8'));

  if (LARGE) {
    const bigChapters = CHAPTERS.concat(
      Array.from({ length: 17 }, (_, i) => ({
        title: `第${i + 4}章 扩展章节`,
        paragraphs: CHAPTERS[i % CHAPTERS.length].paragraphs,
      })),
    );
    write('bookmarked-20ch.pdf', await buildPdf({ chapters: bigChapters, outline: true, pagesPerChapter: 15 }));
    console.log('已生成 bookmarked-20ch.pdf（F-02）。F-08/F-09 体积过大，默认不生成。');
  }

  const jsonCount = writeJsonFixtures();
  const mockCount = writeMockScenarios();

  console.table(manifest.map((m) => ({ 文件: m.name, '大小(KB)': (m.bytes / 1024).toFixed(1) })));
  console.log(`输出目录：${OUT}`);
  console.log(`JSON 树夹具：${jsonCount} 个（fixtures/json/）`);
  console.log(`Mock 响应集：${mockCount} 个（public/assets/mock/）`);
  if (!LARGE) console.log('提示：如需 F-02 规模夹具，运行 node tools/make-fixtures.mjs --large');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
