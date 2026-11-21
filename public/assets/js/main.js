// 教材思维导图工具 — 应用入口（ES Modules）
// T0.1：建立入口、全局错误捕获、CDN 依赖加载检测、最小可运行壳。
// 后续模块（state / storage / pdf / ai / mindmap ...）在对应任务中接入。

const DEPENDENCIES = {
  d3: { global: 'd3', label: 'D3.js v7.9.0' },
  pdfjs: { global: 'pdfjsLib', label: 'pdf.js v3.11.174' },
};

/** 全局 Toast：最多同时 3 条，自动消失，支持 aria-live。 */
const Toast = (() => {
  const container = () => document.getElementById('toast-container');
  const MAX = 3;
  const active = [];

  function show(message, { type = 'info', timeout = 3500 } = {}) {
    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;

    const wrap = container();
    if (!wrap) return;
    wrap.appendChild(el);
    active.push(el);

    if (active.length > MAX) {
      const oldest = active.shift();
      remove(oldest);
    }

    if (type !== 'error') {
      const timer = setTimeout(() => remove(el), timeout);
      el._timer = timer;
    } else {
      // 错误 toast 可手动关闭（点击）
      el.style.cursor = 'pointer';
      el.title = '点击关闭';
      el.addEventListener('click', () => remove(el), { once: true });
    }
  }

  function remove(el) {
    if (!el || !el.isConnected) return;
    if (el._timer) clearTimeout(el._timer);
    el.remove();
    const idx = active.indexOf(el);
    if (idx >= 0) active.splice(idx, 1);
  }

  return { show, remove };
})();

/** 错误覆盖层：用于阻断性启动错误。 */
function showFatalError(message) {
  const overlay = document.getElementById('error-overlay');
  const msg = document.getElementById('error-overlay__message');
  const retry = document.getElementById('error-overlay__retry');
  if (!overlay) return;
  msg.textContent = message;
  overlay.hidden = false;
  retry.addEventListener('click', () => location.reload(), { once: true });
}

/** 全局加载覆盖层：阻塞性操作期间展示。 */
const Loading = (() => {
  const overlay = () => document.getElementById('loading-overlay');
  const text = () => document.getElementById('loading-overlay__text');
  function show(message = '处理中…') {
    const el = overlay();
    if (!el) return;
    const t = text();
    if (t) t.textContent = message;
    el.hidden = false;
  }
  function hide() {
    const el = overlay();
    if (el) el.hidden = true;
  }
  return { show, hide };
})();

/** 检查 CDN 依赖是否加载成功（无内联 onerror，纯靠全局变量是否被注入）。 */
function checkDependencies() {
  const missing = Object.entries(DEPENDENCIES)
    .filter(([, def]) => typeof window[def.global] === 'undefined')
    .map(([, def]) => def.label);

  if (missing.length === 0) return null;

  const names = missing.join('、');
  return `解析依赖加载失败：${names}。\n请检查网络连接后刷新页面重试。若网络正常，可能是 CDN（jsDelivr）暂时不可用，可稍后再试。`;
}

/** 统一全局错误入口：不把内部堆栈暴露给用户，仅输出到 console。 */
function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    // 资源加载失败（script/img）由 onerror 标记，这里只捕获脚本运行时错误。
    if (event && event.filename) {
      console.error('[TMM] 未捕获错误：', event.error || event.message);
    }
    Toast.show('页面发生错误，相关信息已记录到控制台。', { type: 'error' });
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[TMM] 未处理的 Promise 拒绝：', event.reason);
    Toast.show('异步操作失败，相关信息已记录到控制台。', { type: 'error' });
  });
}

/** 视口宽度提示：< 1200px 已由 CSS 处理；此处仅做日志记录，避免重复 UI。 */
function checkViewport() {
  const w = window.innerWidth;
  if (w < 1200) {
    console.warn(`[TMM] 当前视口宽度 ${w}px < 1200px，应用针对桌面端优化。`);
  }
}

/** 骨架阶段：绑定占位按钮的反馈（实际功能在后续任务实现）。 */
function bindSkeletonActions() {
  const uploadBtn = document.getElementById('btn-upload');
  const fileInput = document.getElementById('file-input');
  const settingsBtn = document.getElementById('btn-settings');
  const cardsBtn = document.getElementById('btn-cards');
  const reimportBtn = document.getElementById('btn-reimport');
  const canvasArea = document.getElementById('canvas-area');

  const notImpl = (name) => {
    Toast.show(`${name} 将在后续版本中可用。`, { type: 'warning' });
  };

  // 文件选择：按钮触发隐藏 input；实际解析由 T2.1 实现
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (file) {
        Toast.show(`已选择文件「${file.name}」，PDF 导入功能将在后续版本中实现。`, { type: 'info' });
      }
      fileInput.value = '';
    });
  }

  // 拖拽：仅 UI 反馈与占位处理，实际导入由 T2.1 实现
  if (canvasArea) {
    let dragDepth = 0;
    canvasArea.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth += 1;
      canvasArea.classList.add('is-dragover');
    });
    canvasArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    canvasArea.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragDepth -= 1;
      if (dragDepth <= 0) {
        dragDepth = 0;
        canvasArea.classList.remove('is-dragover');
      }
    });
    canvasArea.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      canvasArea.classList.remove('is-dragover');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) {
        Toast.show(`已拖入文件「${file.name}」，PDF 导入功能将在后续版本中实现。`, { type: 'info' });
      }
    });
  }

  if (settingsBtn) settingsBtn.addEventListener('click', () => notImpl('AI 设置'));
  if (cardsBtn) cardsBtn.addEventListener('click', () => {
    const drawer = document.getElementById('cards-drawer');
    if (drawer) {
      drawer.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
    }
  });
  if (reimportBtn) reimportBtn.addEventListener('click', () => notImpl('重新导入'));

  // 卡片抽屉关闭
  document.querySelectorAll('[data-close-drawer]').forEach((el) => {
    el.addEventListener('click', () => {
      const drawer = document.getElementById('cards-drawer');
      if (drawer) {
        drawer.hidden = true;
        drawer.setAttribute('aria-hidden', 'true');
      }
    });
  });

  // Esc 关闭抽屉
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const drawer = document.getElementById('cards-drawer');
    if (drawer && !drawer.hidden) {
      drawer.hidden = true;
      drawer.setAttribute('aria-hidden', 'true');
    }
  });
}

/** 启动应用。 */
function boot() {
  installGlobalErrorHandlers();
  checkViewport();

  const depError = checkDependencies();
  if (depError) {
    console.error('[TMM] 依赖缺失，进入错误覆盖层。');
    showFatalError(depError);
    return;
  }

  // 依赖就绪：配置 pdf.js worker（同版本固定 URL）
  try {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  } catch (err) {
    console.error('[TMM] 配置 pdf.js worker 失败：', err);
  }

  bindSkeletonActions();

  console.info('[TMM] 应用壳已启动（T0.2）。后续任务将接入状态、存储、PDF、AI 与导图模块。');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
