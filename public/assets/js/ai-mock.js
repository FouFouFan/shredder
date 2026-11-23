// T0.3 开发模式 Mock AI 适配器
//
// 设计约束（对应 task.md T0.3 / spec 6.4）：
// - 默认关闭；只有显式带 ?mock=1 或调用 setMockEnabled(true) 时才启用。
//   public/ 目录虽随发布部署，但该模块在未启用时不发起任何请求、不改写任何状态。
// - Mock 场景数据放在 public/assets/mock/*.json，与真实接口的响应信封一致，
//   便于 AI 客户端（T3.x）直接替换 fetch。
// - Mock 文档使用独立 docId（MOCK_DOC_ID），不得占用真实文档键；
//   开发开关只写 sessionStorage 的 tmm:dev:*，不碰 tmm:v1:*。

export const MOCK_DOC_ID = 'doc_00000000-0000-4000-8000-000000000000';

export const MOCK_SCENARIO_IDS = Object.freeze([
  'success',
  'fenced',
  'malformed',
  'http-401',
  'http-403',
  'http-429',
  'http-500',
  'timeout',
  'chunk-partial-fail',
]);

const DEV_KEY = 'tmm:dev:mock';
const DEFAULT_SCENARIO = 'success';
const cache = new Map();
let chunkCursor = 0;

/** 是否启用 Mock：URL ?mock=1 优先，其次 sessionStorage 开发开关。 */
export function isMockEnabled() {
  try {
    if (new URLSearchParams(location.search).get('mock') === '1') return true;
    return sessionStorage.getItem(DEV_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMockEnabled(on) {
  try {
    if (on) sessionStorage.setItem(DEV_KEY, '1');
    else sessionStorage.removeItem(DEV_KEY);
  } catch {
    /* 存储不可用时静默降级为仅 URL 开关 */
  }
}

/** 当前场景：?mockScenario=<id> > sessionStorage > success。 */
export function getMockScenarioId() {
  try {
    const fromQuery = new URLSearchParams(location.search).get('mockScenario');
    if (fromQuery) return fromQuery;
    return sessionStorage.getItem(`${DEV_KEY}:scenario`) || DEFAULT_SCENARIO;
  } catch {
    return DEFAULT_SCENARIO;
  }
}

export function setMockScenarioId(id) {
  if (!MOCK_SCENARIO_IDS.includes(id)) throw new Error(`未知 Mock 场景：${id}`);
  chunkCursor = 0;
  try {
    sessionStorage.setItem(`${DEV_KEY}:scenario`, id);
  } catch {
    /* 忽略 */
  }
}

export async function loadScenario(id = getMockScenarioId()) {
  if (cache.has(id)) return cache.get(id);
  const res = await fetch(new URL(`../mock/${id}.json`, import.meta.url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Mock 场景加载失败：${id}（HTTP ${res.status}）`);
  const data = await res.json();
  cache.set(id, data);
  return data;
}

/** 测试用：重置分块游标，使 chunk-partial-fail 场景可重复。 */
export function resetMockState() {
  chunkCursor = 0;
}

function delay(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * 创建可替换 window.fetch 的 Mock 实现。
 * 返回的 Response 与真实 OpenAI 兼容接口同构，可直接交给 AI 客户端。
 */
export function createMockFetch({ scenarioId = getMockScenarioId() } = {}) {
  return async function mockFetch(_url, init = {}) {
    const scenario = await loadScenario(scenarioId);
    const signal = init.signal;

    // 分块场景：按调用顺序返回 chunks，用尽后重复最后一块
    if (Array.isArray(scenario.chunks) && scenario.chunks.length > 0) {
      const chunk = scenario.chunks[Math.min(chunkCursor, scenario.chunks.length - 1)];
      chunkCursor += 1;
      await delay(chunk.delayMs || 0, signal);
      return new Response(JSON.stringify(chunk.body ?? {
        choices: [{ index: 0, message: { role: 'assistant', content: chunk.content } }],
      }), {
        status: chunk.httpStatus || 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    await delay(scenario.delayMs || 0, signal);
    return new Response(JSON.stringify(scenario.body ?? {}), {
      status: scenario.httpStatus || 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}
