// 教材思维导图工具 — 数据契约与校验纯函数
// T1.1：归一化、节点树 / 章节 / 元数据 / 标亮 / 卡片校验、AI 响应解析、树工具。
// 约束：不依赖 DOM 与 localStorage；所有校验返回结构化结果，不向 UI 抛异常。

import {
  LIMITS,
  SCHEMA_VERSION,
  ERROR_CODES,
  CHAPTER_STATUS_VALUES,
  SEGMENTATION_VALUES,
  HIGHLIGHT_COLOR,
  ID_PATTERNS,
  ID_PREFIX,
} from './constants.js';

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const WHITESPACE_RUN = /[\s\u3000]+/g;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const isInteger = (v) => typeof v === 'number' && Number.isInteger(v);
const isIsoTime = (v) => typeof v === 'string' && ISO_TIME.test(v);

// ---------------------------------------------------------------------------
// 1. 归一化与计数
// ---------------------------------------------------------------------------

/**
 * 章节原文 / 节点文本统一归一化：
 * NFC → CRLF/CR 转 LF → 去 NUL 与控制字符 → 连续空白折叠为单空格 → trim。
 * 非字符串输入返回空串。
 */
export function normalizeText(input) {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim();
}

/** 按 Unicode 码点计数（代理对算 1 个字符）。 */
export function countChars(value) {
  if (typeof value !== 'string') return 0;
  let n = 0;
  for (const _ of value) n += 1; // eslint-disable-line no-unused-vars
  return n;
}

/**
 * 卡片术语归一化：NFKC → 去控制字符 → 连续空白折叠 → trim → 英文字母转小写。
 * 用于卡片去重键。
 */
export function normalizeTerm(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .toLowerCase();
}

/**
 * content 归一化后是否为归一化原文的连续子串。
 * 同时允许“PDF 断行 / 模型合并断行”造成的空白差异：两侧去掉空格后再比较一次。
 */
export function isSubstringAfterNormalize(content, sourceText) {
  const fragment = normalizeText(content);
  if (!fragment) return false;
  const source = normalizeText(sourceText);
  if (!source) return false;
  if (source.includes(fragment)) return true;
  return stripSpaces(source).includes(stripSpaces(fragment));
}

/** 去掉归一化文本中的单空格（用于空白差异不敏感的原文比对）。 */
function stripSpaces(normalized) {
  return normalized.replace(/ /g, '');
}

/** 术语是否出现在节点 content 中（NFC、空白归一、英文不区分大小写）。 */
export function isTermInContent(term, content) {
  const t = normalizeText(term).toLowerCase();
  if (!t) return false;
  return normalizeText(content).toLowerCase().includes(t);
}

// ---------------------------------------------------------------------------
// 2. 结构化结果工具
// ---------------------------------------------------------------------------

function createResult() {
  return { ok: true, errors: [], warnings: [], truncated: false, value: null };
}

function addError(result, code, type, path, message) {
  result.ok = false;
  if (result.errors.length >= LIMITS.validationErrorMax) {
    result.truncated = true;
    return;
  }
  result.errors.push({ code, type, path, message });
}

function addWarning(result, type, path, message) {
  result.warnings.push({ type, path, message });
}

function mergeResult(target, sub) {
  if (!sub.ok) target.ok = false;
  for (const err of sub.errors) {
    if (target.errors.length >= LIMITS.validationErrorMax) {
      target.truncated = true;
      break;
    }
    target.errors.push(err);
  }
  for (const warn of sub.warnings) target.warnings.push(warn);
  if (sub.truncated) target.truncated = true;
}

function exceptionResult(error, value = null) {
  const result = createResult();
  addError(
    result,
    ERROR_CODES.AI_VALIDATION,
    'validator-exception',
    '',
    `校验过程出错：${error && error.message ? error.message : '未知错误'}`,
  );
  result.value = value;
  return result;
}

// ---------------------------------------------------------------------------
// 3. 节点树校验
// ---------------------------------------------------------------------------

function readId(raw, path, ctx, result) {
  const id = raw.id;
  if (id === undefined || id === null || id === '') {
    addError(result, ctx.errorCode, 'id-missing', `${path}.id`, '节点缺少 id');
    return '';
  }
  if (typeof id !== 'string' || !ID_PATTERNS.node.test(id)) {
    addError(result, ctx.errorCode, 'id-invalid', `${path}.id`, '节点 id 必须形如 n_<uuid>');
    return '';
  }
  if (ctx.ids.has(id)) {
    addError(result, ctx.errorCode, 'id-duplicate', `${path}.id`, `节点 id 重复：${id}`);
  } else {
    ctx.ids.add(id);
  }
  return id;
}

function visitNode(raw, path, depth, isRoot, ctx, result) {
  if (!isPlainObject(raw)) {
    addError(result, ctx.errorCode, 'node-not-object', path, '节点必须是对象');
    return null;
  }

  ctx.count += 1;
  if (ctx.count > LIMITS.nodeCountMax && !ctx.countReported) {
    ctx.countReported = true;
    addError(
      result,
      ctx.errorCode,
      'nodeCount>100',
      path,
      `节点总数超过上限 ${LIMITS.nodeCountMax}`,
    );
  }

  if (depth > LIMITS.depthMax) {
    addError(result, ctx.errorCode, 'depth>4', path, `层级超过上限 ${LIMITS.depthMax}（含根）`);
    return null;
  }

  const id = readId(raw, path, ctx, result);

  // title
  const rawTitle = raw.title;
  const title = normalizeText(rawTitle);
  if (typeof rawTitle !== 'string') {
    addError(result, ctx.errorCode, 'title-not-string', `${path}.title`, 'title 必须是字符串');
  } else if (isRoot) {
    if (!title) addError(result, ctx.errorCode, 'root-title-empty', `${path}.title`, '根节点标题不能为空');
  } else {
    const len = countChars(title);
    if (len < LIMITS.titleMin) {
      addError(result, ctx.errorCode, 'title-length<4', `${path}.title`, `标题至少 ${LIMITS.titleMin} 个字符`);
    } else if (len > LIMITS.titleMax) {
      addError(result, ctx.errorCode, 'title-length>12', `${path}.title`, `标题最多 ${LIMITS.titleMax} 个字符`);
    }
  }

  // content
  const rawContent = raw.content;
  let content = '';
  let contentPassed = false;
  if (isRoot) {
    if (rawContent !== undefined && rawContent !== null && typeof rawContent !== 'string') {
      addError(result, ctx.errorCode, 'content-not-string', `${path}.content`, 'content 必须是字符串');
    } else if (normalizeText(rawContent) !== '') {
      addError(result, ctx.errorCode, 'root-content-not-empty', `${path}.content`, '根节点 content 必须为空字符串');
    }
    content = '';
    contentPassed = true;
  } else if (typeof rawContent !== 'string') {
    addError(result, ctx.errorCode, 'content-missing', `${path}.content`, '非根节点必须提供 content');
  } else {
    content = normalizeText(rawContent);
    const len = countChars(content);
    if (len < LIMITS.contentMin) {
      addError(result, ctx.errorCode, 'content-length<1', `${path}.content`, 'content 不能为空');
    } else if (len > LIMITS.contentMax) {
      addError(result, ctx.errorCode, 'content-length>80', `${path}.content`, `content 最多 ${LIMITS.contentMax} 个字符`);
    } else if (ctx.source && !ctx.source.includes(content) && !ctx.sourceCompact.includes(stripSpaces(content))) {
      addError(result, ctx.errorCode, 'content-not-substring', `${path}.content`, 'content 不是章节原文的连续片段');
    } else {
      contentPassed = true;
    }
  }

  // terms
  const rawTerms = raw.terms;
  const terms = [];
  if (rawTerms !== undefined && rawTerms !== null) {
    if (!Array.isArray(rawTerms)) {
      addError(result, ctx.errorCode, 'terms-not-array', `${path}.terms`, 'terms 必须是数组');
    } else if (isRoot) {
      if (rawTerms.length > 0) {
        addError(result, ctx.errorCode, 'root-terms-not-empty', `${path}.terms`, '根节点 terms 必须为空数组');
      }
    } else {
      if (rawTerms.length > LIMITS.termsPerNodeMax) {
        addError(result, ctx.errorCode, 'terms>3', `${path}.terms`, `每个节点最多 ${LIMITS.termsPerNodeMax} 个术语`);
      }
      rawTerms.forEach((rawTerm, i) => {
        const termPath = `${path}.terms[${i}]`;
        if (!isPlainObject(rawTerm)) {
          addError(result, ctx.errorCode, 'term-not-object', termPath, '术语必须是对象');
          return;
        }
        const term = normalizeText(rawTerm.term);
        const definition = normalizeText(rawTerm.definition);
        if (typeof rawTerm.term !== 'string' || !term) {
          addError(result, ctx.errorCode, 'term-length<1', `${termPath}.term`, 'term 不能为空');
        } else if (countChars(term) > LIMITS.termMax) {
          addError(result, ctx.errorCode, 'term-length>20', `${termPath}.term`, `term 最多 ${LIMITS.termMax} 个字符`);
        }
        if (typeof rawTerm.definition !== 'string' || !definition) {
          addError(result, ctx.errorCode, 'definition-length<1', `${termPath}.definition`, 'definition 不能为空');
        } else if (countChars(definition) > LIMITS.definitionMax) {
          addError(
            result,
            ctx.errorCode,
            'definition-length>120',
            `${termPath}.definition`,
            `definition 最多 ${LIMITS.definitionMax} 个字符`,
          );
        }
        if (term && contentPassed && !isTermInContent(term, content)) {
          addError(result, ctx.errorCode, 'term-not-in-content', `${termPath}.term`, `术语「${term}」未出现在 content 中`);
        }
        terms.push({ term, definition });
      });
    }
  }

  // children
  const rawChildren = raw.children;
  const children = [];
  if (rawChildren !== undefined && rawChildren !== null) {
    if (!Array.isArray(rawChildren)) {
      addError(result, ctx.errorCode, 'children-not-array', `${path}.children`, 'children 必须是数组');
    } else {
      if (rawChildren.length > LIMITS.childrenPerNodeMax) {
        addError(
          result,
          ctx.errorCode,
          'children>8',
          `${path}.children`,
          `每个节点最多 ${LIMITS.childrenPerNodeMax} 个子节点`,
        );
      }
      rawChildren.forEach((child, i) => {
        const cleaned = visitNode(child, `${path}.children[${i}]`, depth + 1, false, ctx, result);
        if (cleaned) children.push(cleaned);
      });
    }
  }

  return {
    id,
    title,
    content: isRoot ? '' : content,
    terms: isRoot ? [] : terms,
    children,
  };
}

/**
 * 校验完整节点树（含根）。
 * @param {object} tree 根节点（需已注入 id）。
 * @param {object} [options]
 * @param {string|null} [options.sourceText] 章节归一化原文；为空时跳过 content 原文校验。
 * @param {string|null} [options.chapterTitle] 章节标题；提供时校验根标题一致。
 * @param {string} [options.errorCode] 错误码，默认 AI_VALIDATION。
 * @returns {{ok:boolean, errors:Array, warnings:Array, truncated:boolean, value:object|null}}
 */
export function validateNodeTree(tree, options = {}) {
  const { sourceText = null, chapterTitle = null, errorCode = ERROR_CODES.AI_VALIDATION } = options;
  const result = createResult();
  try {
    const ctx = {
      source: typeof sourceText === 'string' ? normalizeText(sourceText) : '',
      sourceCompact: '',
      ids: new Set(),
      count: 0,
      countReported: false,
      errorCode,
    };
    ctx.sourceCompact = stripSpaces(ctx.source);
    if (!isPlainObject(tree)) {
      addError(result, errorCode, 'tree-not-object', 'root', '树根必须是对象');
      return result;
    }
    if (!ctx.source && sourceText !== null) {
      addWarning(result, 'source-empty', 'root', '章节原文为空，已跳过 content 原文校验');
    } else if (sourceText === null) {
      addWarning(result, 'source-missing', 'root', '未提供章节原文，已跳过 content 原文校验');
    }

    result.value = visitNode(tree, 'root', 1, true, ctx, result);

    if (chapterTitle !== null) {
      const expected = normalizeText(chapterTitle);
      const actual = normalizeText(tree.title);
      if (expected && actual !== expected) {
        addError(result, errorCode, 'root-title-mismatch', 'root.title', '根节点标题必须与章节标题一致');
      }
    }
  } catch (err) {
    return exceptionResult(err);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 4. 章节记录 / 元数据 / 标亮 / 卡片校验
// ---------------------------------------------------------------------------

function checkSchemaVersion(record, result, path, code) {
  if (record.schemaVersion !== SCHEMA_VERSION) {
    addError(result, code, 'schema-version', `${path}.schemaVersion`, `不支持的 schemaVersion：${record.schemaVersion}`);
  }
}

/** 校验章节记录（含节点树）。 */
export function validateChapterRecord(record, options = {}) {
  const { sourceText = null } = options;
  const result = createResult();
  try {
    if (!isPlainObject(record)) {
      addError(result, ERROR_CODES.STORAGE_CORRUPT, 'record-not-object', 'chapter', '章节记录必须是对象');
      return result;
    }
    checkSchemaVersion(record, result, 'chapter', ERROR_CODES.STORAGE_CORRUPT);
    if (!ID_PATTERNS.doc.test(record.docId)) {
      addError(result, ERROR_CODES.STORAGE_CORRUPT, 'docId-invalid', 'chapter.docId', 'docId 必须形如 doc_<uuid>');
    }
    if (!ID_PATTERNS.chapter.test(record.chapterId)) {
      addError(
        result,
        ERROR_CODES.STORAGE_CORRUPT,
        'chapterId-invalid',
        'chapter.chapterId',
        'chapterId 必须形如 ch_<uuid>',
      );
    }
    const title = normalizeText(record.title);
    if (!title) {
      addError(result, ERROR_CODES.STORAGE_CORRUPT, 'chapter-title-empty', 'chapter.title', '章节标题不能为空');
    }

    if (!isPlainObject(record.tree)) {
      addError(result, ERROR_CODES.STORAGE_CORRUPT, 'tree-missing', 'chapter.tree', '章节记录缺少节点树');
    } else {
      const treeResult = validateNodeTree(record.tree, {
        sourceText,
        chapterTitle: record.title,
        errorCode: ERROR_CODES.STORAGE_CORRUPT,
      });
      mergeResult(result, treeResult);
      result.value = { ...record, title, tree: treeResult.value };
    }

    if (record.generation !== undefined && record.generation !== null) {
      const g = record.generation;
      if (!isPlainObject(g)) {
        addError(result, ERROR_CODES.STORAGE_CORRUPT, 'generation-invalid', 'chapter.generation', 'generation 必须是对象');
      } else {
        if (!isNonEmptyString(g.model)) {
          addError(result, ERROR_CODES.STORAGE_CORRUPT, 'generation-model-missing', 'chapter.generation.model', '缺少模型名');
        }
        if (!isNonEmptyString(g.promptVersion)) {
          addError(
            result,
            ERROR_CODES.STORAGE_CORRUPT,
            'generation-prompt-version-missing',
            'chapter.generation.promptVersion',
            '缺少 promptVersion',
          );
        }
        if (!isIsoTime(g.generatedAt)) {
          addError(
            result,
            ERROR_CODES.STORAGE_CORRUPT,
            'generation-time-invalid',
            'chapter.generation.generatedAt',
            'generatedAt 必须是 ISO 8601 UTC 时间',
          );
        }
      }
    }
    if (!isIsoTime(record.updatedAt)) {
      addError(
        result,
        ERROR_CODES.STORAGE_CORRUPT,
        'updatedAt-invalid',
        'chapter.updatedAt',
        'updatedAt 必须是 ISO 8601 UTC 时间',
      );
    }
    if (!result.value) result.value = { ...record, title };
  } catch (err) {
    return exceptionResult(err);
  }
  return result;
}

/** 校验文档元数据（章节顺序、id 唯一、状态枚举等）。 */
export function validateMeta(meta) {
  const result = createResult();
  const code = ERROR_CODES.STORAGE_CORRUPT;
  try {
    if (!isPlainObject(meta)) {
      addError(result, code, 'meta-not-object', 'meta', '文档元数据必须是对象');
      return result;
    }
    checkSchemaVersion(meta, result, 'meta', code);
    if (!ID_PATTERNS.doc.test(meta.docId)) {
      addError(result, code, 'docId-invalid', 'meta.docId', 'docId 必须形如 doc_<uuid>');
    }
    if (!normalizeText(meta.title)) {
      addError(result, code, 'doc-title-empty', 'meta.title', '文档标题不能为空');
    }
    if (!isNonEmptyString(meta.sourceFileName)) {
      addError(result, code, 'source-file-name-invalid', 'meta.sourceFileName', 'sourceFileName 不能为空');
    }
    if (!isInteger(meta.pageCount) || meta.pageCount < 1) {
      addError(result, code, 'page-count-invalid', 'meta.pageCount', 'pageCount 必须是正整数');
    }
    if (!SEGMENTATION_VALUES.includes(meta.segmentation)) {
      addError(result, code, 'segmentation-invalid', 'meta.segmentation', 'segmentation 取值不合法');
    }
    if (!isIsoTime(meta.createdAt)) {
      addError(result, code, 'createdAt-invalid', 'meta.createdAt', 'createdAt 必须是 ISO 8601 UTC 时间');
    }
    if (!isIsoTime(meta.updatedAt)) {
      addError(result, code, 'updatedAt-invalid', 'meta.updatedAt', 'updatedAt 必须是 ISO 8601 UTC 时间');
    }

    if (!Array.isArray(meta.chapters)) {
      addError(result, code, 'chapters-not-array', 'meta.chapters', 'chapters 必须是数组');
    } else {
      if (meta.chapters.length === 0) {
        addError(result, code, 'chapters-empty', 'meta.chapters', '文档至少包含一个章节');
      }
      const ids = new Set();
      meta.chapters.forEach((ch, i) => {
        const p = `meta.chapters[${i}]`;
        if (!isPlainObject(ch)) {
          addError(result, code, 'chapter-not-object', p, '章节元数据必须是对象');
          return;
        }
        if (!ID_PATTERNS.chapter.test(ch.id)) {
          addError(result, code, 'chapterId-invalid', `${p}.id`, '章节 id 必须形如 ch_<uuid>');
        } else if (ids.has(ch.id)) {
          addError(result, code, 'chapterId-duplicate', `${p}.id`, `章节 id 重复：${ch.id}`);
        } else {
          ids.add(ch.id);
        }
        if (ch.order !== i) {
          addError(result, code, 'order-not-continuous', `${p}.order`, `order 必须从 0 连续递增（期望 ${i}）`);
        }
        if (!normalizeText(ch.title)) {
          addError(result, code, 'chapter-title-empty', `${p}.title`, '章节标题不能为空');
        }
        if (!isInteger(ch.startPage) || ch.startPage < 1) {
          addError(result, code, 'start-page-invalid', `${p}.startPage`, 'startPage 必须是正整数');
        }
        if (!isInteger(ch.endPage) || !isInteger(ch.startPage) || ch.endPage < ch.startPage) {
          addError(result, code, 'end-page-invalid', `${p}.endPage`, 'endPage 必须不早于 startPage');
        }
        if (isInteger(meta.pageCount) && isInteger(ch.endPage) && ch.endPage > meta.pageCount) {
          addError(result, code, 'end-page-out-of-range', `${p}.endPage`, 'endPage 超出 pageCount');
        }
        if (!isInteger(ch.charCount) || ch.charCount < 0) {
          addError(result, code, 'char-count-invalid', `${p}.charCount`, 'charCount 必须是非负整数');
        }
        if (!CHAPTER_STATUS_VALUES.includes(ch.status)) {
          addError(result, code, 'status-invalid', `${p}.status`, '章节状态取值不合法');
        }
        if (!isInteger(ch.nodeCount) || ch.nodeCount < 0 || ch.nodeCount > LIMITS.nodeCountMax) {
          addError(result, code, 'node-count-invalid', `${p}.nodeCount`, `nodeCount 必须是 0–${LIMITS.nodeCountMax} 的整数`);
        }
        if (typeof ch.hasSource !== 'boolean') {
          addError(result, code, 'has-source-invalid', `${p}.hasSource`, 'hasSource 必须是布尔值');
        }
        if (ch.lastError !== null && ch.lastError !== undefined) {
          if (!isPlainObject(ch.lastError)) {
            addError(result, code, 'last-error-invalid', `${p}.lastError`, 'lastError 必须是对象或 null');
          } else {
            if (!isNonEmptyString(ch.lastError.code)) {
              addError(result, code, 'last-error-code-invalid', `${p}.lastError.code`, '缺少错误码');
            }
            if (typeof ch.lastError.message !== 'string') {
              addError(result, code, 'last-error-message-invalid', `${p}.lastError.message`, 'message 必须是字符串');
            }
            if (!isIsoTime(ch.lastError.at)) {
              addError(result, code, 'last-error-at-invalid', `${p}.lastError.at`, 'at 必须是 ISO 8601 UTC 时间');
            }
          }
        }
      });
    }
    result.value = result.ok ? meta : null;
  } catch (err) {
    return exceptionResult(err);
  }
  return result;
}

/**
 * 校验标亮存储。
 * @param {object} store
 * @param {object} [options]
 * @param {(chapterId:string, nodeId:string)=>string|null} [options.getContent]
 *   可选：提供节点 content 时校验区间边界与 quote 一致性。
 */
export function validateHighlightStore(store, options = {}) {
  const { getContent = null } = options;
  const result = createResult();
  const code = ERROR_CODES.STORAGE_CORRUPT;
  try {
    if (!isPlainObject(store)) {
      addError(result, code, 'store-not-object', 'highlights', '标亮存储必须是对象');
      return result;
    }
    checkSchemaVersion(store, result, 'highlights', code);
    if (!ID_PATTERNS.doc.test(store.docId)) {
      addError(result, code, 'docId-invalid', 'highlights.docId', 'docId 必须形如 doc_<uuid>');
    }
    if (store.updatedAt !== undefined && !isIsoTime(store.updatedAt)) {
      addError(result, code, 'updatedAt-invalid', 'highlights.updatedAt', 'updatedAt 必须是 ISO 8601 UTC 时间');
    }
    if (!isPlainObject(store.byChapter)) {
      addError(result, code, 'by-chapter-invalid', 'highlights.byChapter', 'byChapter 必须是对象');
      return result;
    }

    for (const [chapterId, byNode] of Object.entries(store.byChapter)) {
      if (!ID_PATTERNS.chapter.test(chapterId)) {
        addError(result, code, 'chapterId-invalid', `highlights.byChapter.${chapterId}`, '章节 id 不合法');
      }
      if (!isPlainObject(byNode)) {
        addError(result, code, 'by-node-invalid', `highlights.byChapter.${chapterId}`, '章节标亮必须是对象');
        continue;
      }
      for (const [nodeId, list] of Object.entries(byNode)) {
        const p = `highlights.byChapter.${chapterId}.${nodeId}`;
        if (!ID_PATTERNS.node.test(nodeId)) {
          addError(result, code, 'nodeId-invalid', p, '节点 id 不合法');
        }
        if (!Array.isArray(list)) {
          addError(result, code, 'highlight-list-invalid', p, '标亮列表必须是数组');
          continue;
        }
        const content = typeof getContent === 'function' ? getContent(chapterId, nodeId) : null;
        let prevEnd = -1;
        const ids = new Set();
        list.forEach((hl, i) => {
          const hp = `${p}[${i}]`;
          if (!isPlainObject(hl)) {
            addError(result, code, 'highlight-not-object', hp, '标亮必须是对象');
            return;
          }
          if (!ID_PATTERNS.highlight.test(hl.id)) {
            addError(result, code, 'id-invalid', `${hp}.id`, '标亮 id 必须形如 hl_<uuid>');
          } else if (ids.has(hl.id)) {
            addError(result, code, 'id-duplicate', `${hp}.id`, `标亮 id 重复：${hl.id}`);
          } else {
            ids.add(hl.id);
          }
          if (!isInteger(hl.start) || !isInteger(hl.end) || hl.start < 0 || hl.start >= hl.end) {
            addError(result, code, 'highlight-range-invalid', hp, '标亮区间必须满足 0 ≤ start < end');
            return;
          }
          if (hl.start < prevEnd) {
            addError(result, code, 'highlight-overlap', hp, '标亮区间必须按 start 升序且互不重叠');
          }
          prevEnd = hl.end;
          if (hl.color !== HIGHLIGHT_COLOR) {
            addError(result, code, 'highlight-color-invalid', `${hp}.color`, `v1 仅支持 ${HIGHLIGHT_COLOR}`);
          }
          if (!isIsoTime(hl.createdAt)) {
            addError(result, code, 'createdAt-invalid', `${hp}.createdAt`, 'createdAt 必须是 ISO 8601 UTC 时间');
          }
          if (typeof content === 'string') {
            if (hl.end > content.length) {
              addError(result, code, 'highlight-range-out-of-bounds', hp, '标亮区间超出 content 长度');
            } else if (hl.quote !== content.slice(hl.start, hl.end)) {
              addError(result, code, 'highlight-quote-mismatch', `${hp}.quote`, 'quote 与标亮区间不一致');
            }
          }
        });
      }
    }
    result.value = result.ok ? store : null;
  } catch (err) {
    return exceptionResult(err);
  }
  return result;
}

const CARD_SOURCE_KEYS = ['chapterId', 'chapterTitle', 'nodeId', 'nodeTitle'];

/** 校验卡片集：normalizedTerm 唯一、来源非空且二元组不重复。 */
export function validateCardStore(store) {
  const result = createResult();
  const code = ERROR_CODES.STORAGE_CORRUPT;
  try {
    if (!isPlainObject(store)) {
      addError(result, code, 'store-not-object', 'cards', '卡片存储必须是对象');
      return result;
    }
    checkSchemaVersion(store, result, 'cards', code);
    if (!ID_PATTERNS.doc.test(store.docId)) {
      addError(result, code, 'docId-invalid', 'cards.docId', 'docId 必须形如 doc_<uuid>');
    }
    if (store.updatedAt !== undefined && !isIsoTime(store.updatedAt)) {
      addError(result, code, 'updatedAt-invalid', 'cards.updatedAt', 'updatedAt 必须是 ISO 8601 UTC 时间');
    }
    if (!Array.isArray(store.cards)) {
      addError(result, code, 'cards-not-array', 'cards.cards', 'cards 必须是数组');
      return result;
    }

    const normalizedTerms = new Set();
    const cardIds = new Set();
    store.cards.forEach((card, i) => {
      const p = `cards.cards[${i}]`;
      if (!isPlainObject(card)) {
        addError(result, code, 'card-not-object', p, '卡片必须是对象');
        return;
      }
      if (!ID_PATTERNS.card.test(card.id)) {
        addError(result, code, 'id-invalid', `${p}.id`, '卡片 id 必须形如 card_<uuid>');
      } else if (cardIds.has(card.id)) {
        addError(result, code, 'id-duplicate', `${p}.id`, `卡片 id 重复：${card.id}`);
      } else {
        cardIds.add(card.id);
      }
      const term = normalizeText(card.term);
      if (!term) {
        addError(result, code, 'term-empty', `${p}.term`, 'term 不能为空');
      } else if (countChars(term) > LIMITS.termMax) {
        addError(result, code, 'term-length>20', `${p}.term`, `term 最多 ${LIMITS.termMax} 个字符`);
      }
      const expectedNormalized = normalizeTerm(card.term);
      if (typeof card.normalizedTerm !== 'string' || card.normalizedTerm !== expectedNormalized) {
        addError(result, code, 'normalized-term-mismatch', `${p}.normalizedTerm`, 'normalizedTerm 与 term 不匹配');
      }
      if (expectedNormalized) {
        if (normalizedTerms.has(expectedNormalized)) {
          addError(result, code, 'duplicate-normalized-term', `${p}.normalizedTerm`, `卡片术语重复：${expectedNormalized}`);
        } else {
          normalizedTerms.add(expectedNormalized);
        }
      }
      const definition = normalizeText(card.definition);
      if (!definition) {
        addError(result, code, 'definition-empty', `${p}.definition`, 'definition 不能为空');
      } else if (countChars(definition) > LIMITS.definitionMax) {
        addError(result, code, 'definition-length>120', `${p}.definition`, `definition 最多 ${LIMITS.definitionMax} 个字符`);
      }
      if (!Array.isArray(card.sources) || card.sources.length === 0) {
        addError(result, code, 'sources-empty', `${p}.sources`, 'sources 不能为空');
      } else {
        const tuples = new Set();
        card.sources.forEach((src, j) => {
          const sp = `${p}.sources[${j}]`;
          if (!isPlainObject(src)) {
            addError(result, code, 'source-not-object', sp, '来源必须是对象');
            return;
          }
          for (const key of CARD_SOURCE_KEYS) {
            if (!isNonEmptyString(src[key])) {
              addError(result, code, 'source-field-invalid', `${sp}.${key}`, `${key} 不能为空`);
            }
          }
          const tuple = `${src.chapterId}\u0000${src.nodeId}`;
          if (tuples.has(tuple)) {
            addError(result, code, 'source-duplicate', sp, '来源 (chapterId, nodeId) 重复');
          } else {
            tuples.add(tuple);
          }
        });
      }
      if (card.createdAt !== undefined && !isIsoTime(card.createdAt)) {
        addError(result, code, 'createdAt-invalid', `${p}.createdAt`, 'createdAt 必须是 ISO 8601 UTC 时间');
      }
      if (card.updatedAt !== undefined && !isIsoTime(card.updatedAt)) {
        addError(result, code, 'updatedAt-invalid', `${p}.updatedAt`, 'updatedAt 必须是 ISO 8601 UTC 时间');
      }
    });
    result.value = result.ok ? store : null;
  } catch (err) {
    return exceptionResult(err);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 5. AI 响应解析
// ---------------------------------------------------------------------------

const FENCED_BLOCK = /```[ \t]*(?:json)?[ \t]*\r?\n?([\s\S]*?)```/i;

/** 从模型输出中提取 JSON 文本：优先 Markdown 围栏，其次首个 { 到末个 }。 */
export function extractJsonText(rawText) {
  if (typeof rawText !== 'string') return { ok: false, type: 'raw-not-string' };
  const text = rawText.replace(/^\uFEFF/, '').trim();
  if (!text) return { ok: false, type: 'raw-empty' };

  const fenced = text.match(FENCED_BLOCK);
  if (fenced) {
    const inner = fenced[1].trim();
    if (inner) return { ok: true, text: inner };
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return { ok: false, type: 'json-not-found' };
  return { ok: true, text: text.slice(start, end + 1) };
}

/** 解析 AI 原始输出（模型 message.content），返回结构化 sections。 */
export function parseAiResponse(rawText) {
  const result = createResult();
  const code = ERROR_CODES.AI_BAD_RESPONSE;
  try {
    const extracted = extractJsonText(rawText);
    if (!extracted.ok) {
      addError(result, code, extracted.type, 'response', '模型输出中未找到 JSON 内容');
      return result;
    }
    let data;
    try {
      data = JSON.parse(extracted.text);
    } catch (err) {
      addError(result, code, 'invalid-json', 'response', `JSON 解析失败：${err.message}`);
      return result;
    }
    if (!isPlainObject(data)) {
      addError(result, code, 'not-object', 'response', 'JSON 根必须是对象');
      return result;
    }
    if (!Array.isArray(data.sections)) {
      addError(result, code, 'missing-sections', 'response.sections', '缺少 sections 数组');
      return result;
    }
    if (data.sections.length === 0) {
      addError(result, code, 'sections-empty', 'response.sections', 'sections 不能为空');
    }

    const sections = [];
    data.sections.forEach((raw, i) => {
      const cleaned = readRawNode(raw, `sections[${i}]`, 2, result);
      if (cleaned) sections.push(cleaned);
    });
    result.value = { sections };
  } catch (err) {
    return exceptionResult(err);
  }
  return result;
}

/** 解析期结构校验：只检查形状与类型，长度/原文等语义约束交给 validateNodeTree。 */
function readRawNode(raw, path, depth, result) {
  const code = ERROR_CODES.AI_BAD_RESPONSE;
  if (depth > LIMITS.depthMax) {
    addError(result, ERROR_CODES.AI_VALIDATION, 'depth>4', path, `层级超过上限 ${LIMITS.depthMax}（含根）`);
    return null;
  }
  if (!isPlainObject(raw)) {
    addError(result, code, 'node-not-object', path, '节点必须是对象');
    return null;
  }
  const title = normalizeText(raw.title);
  if (typeof raw.title !== 'string' || !title) {
    addError(result, code, 'title-missing', `${path}.title`, '缺少有效的 title');
  }
  const content = normalizeText(raw.content);
  if (typeof raw.content !== 'string' || !content) {
    addError(result, code, 'content-missing', `${path}.content`, '缺少有效的 content');
  }

  const terms = [];
  if (raw.terms !== undefined && raw.terms !== null) {
    if (!Array.isArray(raw.terms)) {
      addError(result, code, 'terms-not-array', `${path}.terms`, 'terms 必须是数组');
    } else {
      raw.terms.forEach((t, i) => {
        if (!isPlainObject(t) || typeof t.term !== 'string' || typeof t.definition !== 'string') {
          addError(result, code, 'term-invalid', `${path}.terms[${i}]`, '术语必须包含 term 与 definition 字符串');
          return;
        }
        terms.push({ term: normalizeText(t.term), definition: normalizeText(t.definition) });
      });
    }
  }

  const children = [];
  if (raw.children !== undefined && raw.children !== null) {
    if (!Array.isArray(raw.children)) {
      addError(result, code, 'children-not-array', `${path}.children`, 'children 必须是数组');
    } else {
      raw.children.forEach((c, i) => {
        const cleaned = readRawNode(c, `${path}.children[${i}]`, depth + 1, result);
        if (cleaned) children.push(cleaned);
      });
    }
  }

  return { title, content, terms, children };
}

// ---------------------------------------------------------------------------
// 6. 树工具：根节点包装、ID 注入、遍历、去重
// ---------------------------------------------------------------------------

/** 用章节标题与 sections 包装根节点（不注入 id，注入见 injectNodeIds）。 */
export function wrapSections(sections, options = {}) {
  const { chapterTitle = '' } = options;
  return {
    title: normalizeText(chapterTitle),
    content: '',
    terms: [],
    children: Array.isArray(sections) ? sections : [],
  };
}

function fallbackUuid() {
  const hex = (len) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

/** 生成指定前缀的 ID。 */
export function createId(prefix) {
  const uuid =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : fallbackUuid();
  return `${prefix}${uuid}`;
}

export const createNodeId = () => createId(ID_PREFIX.node);

/**
 * 为整棵树注入唯一节点 id，并只保留契约字段。
 * 已有合法且未重复的 id 会保留；缺失、非法或重复的重新生成。返回新树，不修改入参。
 */
export function injectNodeIds(tree, options = {}) {
  const { idFactory = createNodeId } = options;
  const seen = new Set();
  const visit = (raw) => {
    const base = isPlainObject(raw) ? raw : {};
    let id = typeof base.id === 'string' && ID_PATTERNS.node.test(base.id) && !seen.has(base.id) ? base.id : '';
    while (!id || seen.has(id)) id = idFactory();
    seen.add(id);
    return {
      id,
      title: base.title,
      content: base.content,
      terms: Array.isArray(base.terms)
        ? base.terms.map((t) => ({
            term: isPlainObject(t) ? t.term : '',
            definition: isPlainObject(t) ? t.definition : '',
          }))
        : [],
      children: Array.isArray(base.children) ? base.children.map(visit) : [],
    };
  };
  return visit(tree);
}

/**
 * 先序遍历整棵树。
 * @param {object} root
 * @param {(node:object, meta:{depth:number, parent:object|null, index:number})=>void} visit
 */
export function walkTree(root, visit) {
  if (!isPlainObject(root)) return;
  const stack = [{ node: root, depth: 1, parent: null, index: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    visit(current.node, { depth: current.depth, parent: current.parent, index: current.index });
    const children = Array.isArray(current.node.children) ? current.node.children : [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: children[i], depth: current.depth + 1, parent: current.node, index: i });
    }
  }
}

/** 先序展开为节点数组。 */
export function collectNodes(root) {
  const nodes = [];
  walkTree(root, (node) => nodes.push(node));
  return nodes;
}

/** 按归一化后的 (title, content) 精确去重，保持出现顺序；不同 content 的同名节点保留。 */
export function dedupeSections(sections) {
  const seen = new Set();
  const out = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const key = `${normalizeText(section && section.title)}\u0000${normalizeText(section && section.content)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(section);
  }
  return out;
}

/** 按块顺序拼接分块 sections 并去重，不跨块重排。 */
export function mergeChunkSections(chunkSections) {
  const flat = [];
  for (const chunk of Array.isArray(chunkSections) ? chunkSections : []) {
    if (Array.isArray(chunk)) flat.push(...chunk);
  }
  return dedupeSections(flat);
}
