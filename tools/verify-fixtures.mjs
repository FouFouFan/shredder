// T0.3 夹具校验脚本（开发专用）：用 pdf.js 打开每个 PDF 夹具，
// 断言其行为与文件名语义一致。用法：node tools/verify-fixtures.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pdfjs = require('../devdeps/node_modules/pdfjs-dist/legacy/build/pdf.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const MOCK = path.join(ROOT, 'public', 'assets', 'mock');

pdfjs.GlobalWorkerOptions.workerSrc = '';

const normalize = (s) =>
  s
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function openPdf(file) {
  const data = new Uint8Array(fs.readFileSync(path.join(FIXTURES, file)));
  const task = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => it.str).join(''));
    }
    const outline = await doc.getOutline();
    const result = { ok: true, numPages: doc.numPages, text: normalize(pages.join(' ')), outlineCount: (outline || []).length };
    await doc.destroy();
    return result;
  } catch (err) {
    return { ok: false, name: err.name, message: String(err.message || err) };
  }
}

const failures = [];
function check(label, cond, detail) {
  if (cond) {
    console.log(`  ✔ ${label}`);
  } else {
    failures.push(`${label} —— ${detail || ''}`);
    console.log(`  ✘ ${label}${detail ? ` —— ${detail}` : ''}`);
  }
}

async function main() {
  console.log('\n[1] bookmarked.pdf');
  const bookmarked = await openPdf('bookmarked.pdf');
  check('可打开', bookmarked.ok, bookmarked.message);
  check('页数 ≥ 6', bookmarked.ok && bookmarked.numPages >= 6, `实际 ${bookmarked.numPages}`);
  check('顶层书签 = 3', bookmarked.ok && bookmarked.outlineCount === 3, `实际 ${bookmarked.outlineCount}`);
  check('正文可提取', bookmarked.ok && bookmarked.text.includes('物质是不依赖于人的意识'), `提取到 ${bookmarked.ok ? bookmarked.text.length : 0} 字符`);

  console.log('\n[2] no-bookmark.pdf');
  const noBookmark = await openPdf('no-bookmark.pdf');
  check('可打开', noBookmark.ok, noBookmark.message);
  check('无书签', noBookmark.ok && noBookmark.outlineCount === 0, `实际 ${noBookmark.outlineCount}`);
  check('含第一/二/三章标题', noBookmark.ok && ['第一章', '第二章', '第三章'].every((t) => noBookmark.text.includes(t)));

  console.log('\n[3] no-chapter.pdf');
  const noChapter = await openPdf('no-chapter.pdf');
  check('可打开', noChapter.ok, noChapter.message);
  check('无书签', noChapter.ok && noChapter.outlineCount === 0);
  check('不含“第X章”标题', noChapter.ok && !/第[一二三四五六七八九十百]+章/.test(noChapter.text));
  check('有可提取正文', noChapter.ok && noChapter.text.length > 100, `实际 ${noChapter.ok ? noChapter.text.length : 0}`);

  console.log('\n[4] toc-false-positive.pdf');
  const toc = await openPdf('toc-false-positive.pdf');
  check('可打开', toc.ok, toc.message);
  check('无书签', toc.ok && toc.outlineCount === 0);
  check('含目录页', toc.ok && toc.text.includes('目 录'));
  check('目录出现 ≥ 8 个章标题', toc.ok && (toc.text.match(/第[一二三四五六七八九十]+章/g) || []).length >= 8);

  console.log('\n[5] encrypted.pdf');
  const encrypted = await openPdf('encrypted.pdf');
  check('需要密码（PasswordException）', !encrypted.ok && encrypted.name === 'PasswordException', `${encrypted.name}: ${encrypted.message}`);

  console.log('\n[6] scanned.pdf');
  const scanned = await openPdf('scanned.pdf');
  check('可打开', scanned.ok, scanned.message);
  check('2 页', scanned.ok && scanned.numPages === 2, `实际 ${scanned.ok ? scanned.numPages : '-'}`);
  check('无可提取文本', scanned.ok && scanned.text.length === 0, `实际 ${scanned.ok ? scanned.text.length : 0} 字符`);

  console.log('\n[7] corrupted.pdf');
  const corrupted = await openPdf('corrupted.pdf');
  check('打开失败', !corrupted.ok, '意外成功打开');
  check('错误类型可识别', !corrupted.ok && ['InvalidPDFException', 'FormatError', 'UnknownErrorException'].includes(corrupted.name), corrupted.name);

  console.log('\n[8] not-a-pdf.pdf');
  const notPdf = await openPdf('not-a-pdf.pdf');
  check('打开失败', !notPdf.ok, '意外成功打开');
  check('错误类型可识别', !notPdf.ok && ['InvalidPDFException', 'FormatError', 'UnknownErrorException'].includes(notPdf.name), notPdf.name);

  console.log('\n[9] Mock 合法响应与 bookmarked.pdf 原文对齐');
  const mockSuccess = JSON.parse(fs.readFileSync(path.join(MOCK, 'success.json'), 'utf8'));
  const payload = JSON.parse(mockSuccess.body.choices[0].message.content);
  const picks = [];
  const collect = (n) => { picks.push(n.content); (n.children || []).forEach(collect); };
  payload.sections.forEach(collect);
  const missing = picks.filter((c) => !bookmarked.text.includes(normalize(c)));
  check(`全部 content 为原文连续子串（${picks.length} 条）`, missing.length === 0, missing.join(' | '));
  check('sections 为根的直接子节点（客户端负责包根）', payload.sections.every((s) => s.content !== '' && s.title !== '第一章 世界的物质性'));

  console.log('\n[10] JSON 树夹具与 Mock 响应集标注完整');
  const invalidDir = path.join(FIXTURES, 'json');
  const files = fs.readdirSync(invalidDir).filter((f) => f.endsWith('.json')).sort();
  files.forEach((f) => {
    const json = JSON.parse(fs.readFileSync(path.join(invalidDir, f), 'utf8'));
    const ok = typeof json.expect === 'string' && (json.expect !== 'reject' || typeof json.expectError === 'string');
    check(`${f} 标注 expect${json.expect === 'reject' ? ' + expectError' : ''}`, ok);
  });
  const mockFiles = fs.readdirSync(MOCK).filter((f) => f.endsWith('.json')).sort();
  check(`Mock 响应集共 9 个场景（实际 ${mockFiles.length}）`, mockFiles.length === 9);
  mockFiles.forEach((f) => {
    const json = JSON.parse(fs.readFileSync(path.join(MOCK, f), 'utf8'));
    check(`${f} 带 expect`, typeof json.expect === 'string' && json.expect.length > 0);
  });

  if (fs.existsSync(path.join(FIXTURES, 'bookmarked-20ch.pdf'))) {
    console.log('\n[11] bookmarked-20ch.pdf（F-02，可选）');
    const big = await openPdf('bookmarked-20ch.pdf');
    check('可打开', big.ok, big.message);
    check('约 300 页（≥280）', big.ok && big.numPages >= 280, `实际 ${big.ok ? big.numPages : '-'}`);
    check('顶层书签 = 20', big.ok && big.outlineCount === 20, `实际 ${big.ok ? big.outlineCount : '-'}`);
  }

  console.log(`\n结果：${failures.length === 0 ? '全部通过' : `${failures.length} 项失败`}`);
  if (failures.length) {
    failures.forEach((f) => console.log(` - ${f}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
