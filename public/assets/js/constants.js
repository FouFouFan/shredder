// 教材思维导图工具 — 全局常量
// T1.1：限制、localStorage 键、错误码、状态枚举、Prompt 版本。
// 纯数据模块：不依赖 DOM / localStorage，可在 Node 中直接导入。

export const SCHEMA_VERSION = 1;

/** 数据契约中的各类硬限制（长度均按 Unicode 码点计算）。 */
export const LIMITS = Object.freeze({
  titleMin: 4,
  titleMax: 12,
  contentMin: 1,
  contentMax: 80,
  termMin: 1,
  termMax: 20,
  definitionMin: 1,
  definitionMax: 120,
  termsPerNodeMax: 3,
  childrenPerNodeMax: 8,
  depthMax: 4,
  nodeCountMax: 100,
  /** 单章原文超过该字符数时拒绝生成（AI_CHAPTER_TOO_LONG）。 */
  chapterMaxChars: 120000,
  /** 分块输入的单块上限与块数上限。 */
  chunkMaxChars: 8000,
  chunkMaxCount: 16,
  /** 单次校验最多保留的错误条数（错误聚合）。 */
  validationErrorMax: 20,
});

/** localStorage 键前缀；所有正式数据键均以此开头。 */
export const KEY_PREFIX = 'tmm:v1';

export const STORAGE_KEYS = Object.freeze({
  meta: `${KEY_PREFIX}:meta`,
  chapter: (docId, chapterId) => `${KEY_PREFIX}:chapter:${docId}:${chapterId}`,
  source: (docId, chapterId) => `${KEY_PREFIX}:source:${docId}:${chapterId}`,
  highlights: (docId) => `${KEY_PREFIX}:highlights:${docId}`,
  cards: (docId) => `${KEY_PREFIX}:cards:${docId}`,
  ui: (docId) => `${KEY_PREFIX}:ui:${docId}`,
  settings: `${KEY_PREFIX}:settings`,
});

/** API Key 仅存 sessionStorage，关闭标签页即清除。 */
export const SESSION_AI_KEY = 'tmm:session:aiKey';

/** ID 前缀：前缀_ + crypto.randomUUID()。 */
export const ID_PREFIX = Object.freeze({
  doc: 'doc_',
  chapter: 'ch_',
  node: 'n_',
  highlight: 'hl_',
  card: 'card_',
});

export const ID_PATTERNS = Object.freeze({
  doc: /^doc_[A-Za-z0-9_-]+$/,
  chapter: /^ch_[A-Za-z0-9_-]+$/,
  node: /^n_[A-Za-z0-9_-]+$/,
  highlight: /^hl_[A-Za-z0-9_-]+$/,
  card: /^card_[A-Za-z0-9_-]+$/,
});

/** 章节生成状态；刷新后 processing 视为 pending（由恢复逻辑处理）。 */
export const CHAPTER_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  READY: 'ready',
  ERROR: 'error',
});

export const CHAPTER_STATUS_VALUES = Object.freeze(Object.values(CHAPTER_STATUS));

/** 切章来源。 */
export const SEGMENTATION = Object.freeze({
  BOOKMARK: 'bookmark',
  REGEX: 'regex',
  SINGLE: 'single',
});

export const SEGMENTATION_VALUES = Object.freeze(Object.values(SEGMENTATION));

/** v1 标亮单色。 */
export const HIGHLIGHT_COLOR = 'amber';

/** Prompt 版本：随系统提示词变更递增，并写入章节 generation。 */
export const PROMPT_VERSION = 'struct-v1';

/** AI 请求重试策略：仅网络 / 429 / 5xx / 超时可重试。 */
export const AI_RETRY_MAX = 2;
export const AI_RETRY_BACKOFF_MS = Object.freeze([1000, 3000]);
export const AI_TIMEOUT_MS = 60000;

/** 统一错误码（spec 5.6）。 */
export const ERROR_CODES = Object.freeze({
  PDF_INVALID_TYPE: 'PDF_INVALID_TYPE',
  PDF_TOO_LARGE: 'PDF_TOO_LARGE',
  PDF_TOO_MANY_PAGES: 'PDF_TOO_MANY_PAGES',
  PDF_PASSWORD_REQUIRED: 'PDF_PASSWORD_REQUIRED',
  PDF_CORRUPT: 'PDF_CORRUPT',
  PDF_NO_TEXT: 'PDF_NO_TEXT',
  SEGMENT_FALLBACK_SINGLE: 'SEGMENT_FALLBACK_SINGLE',
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  AI_AUTH: 'AI_AUTH',
  AI_RATE_LIMIT: 'AI_RATE_LIMIT',
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_NETWORK: 'AI_NETWORK',
  AI_UPSTREAM: 'AI_UPSTREAM',
  AI_REQUEST: 'AI_REQUEST',
  AI_BAD_RESPONSE: 'AI_BAD_RESPONSE',
  AI_VALIDATION: 'AI_VALIDATION',
  AI_CORS: 'AI_CORS',
  AI_ABORTED: 'AI_ABORTED',
  AI_CHAPTER_TOO_LONG: 'AI_CHAPTER_TOO_LONG',
  STORAGE_QUOTA: 'STORAGE_QUOTA',
  STORAGE_CORRUPT: 'STORAGE_CORRUPT',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
});
