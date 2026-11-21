# 教材思维导图工具（Textbook Mind Map，TMM）

把一本 PDF 教材转化为「文件夹舌片章节导航 + 放射状思维导图」的可探索结构，支持原文定位、标亮、术语解释与概念卡片集。

- **产品形态**：纯前端单页应用（SPA），仅桌面端。
- **技术基线**：原生 JavaScript（ES2022 / ES Modules）+ D3.js v7.9.0 + pdf.js v3.11.174。
- **数据边界**：教材结构化树、标亮、卡片、章节状态全部保存在浏览器 `localStorage`；PDF 原文件不持久化；API Key 仅存 `sessionStorage`。

> 本仓库是开发基线，功能按 [task.md](./task.md) 的 Phase 顺序推进。当前进度见各任务勾选状态。

## 运行方式

本项目**不需要** `npm install` 或任何构建步骤。`public/` 是唯一的静态站点根目录。

### 1. 启动静态服务器

任选一种本地静态服务器，以 `public/` 为站点根：

```bash
# Python 3
python -m http.server 8080 --directory public

# 或 Node（如已安装）
npx serve public

# 或任意你偏好的静态服务器
```

### 2. 访问

打开浏览器访问 <http://localhost:8080/>。

> ⚠️ **不要用 `file://` 直接打开**：ES Modules、pdf.js worker 与 `fetch` 在 `file://` 下不保证可用；必须通过 HTTP(S) 静态托管访问。

## AI 接口配置

- 用户在「AI 设置」中填写 `baseUrl`、`model` 与 `apiKey`。
- `apiKey` 仅保存在当前标签页的 `sessionStorage` 与内存中；**不写入 localStorage、不进入导出文件、不进入源码**。
- 接口需为 OpenAI 兼容的 `https` 地址，且支持浏览器跨域请求（CORS）。
- 开发环境允许 `http://localhost` / `http://127.0.0.1`。

## 安全与隐私

- 首次生成前会提示：教材章节文本将发送到用户填写的 AI 接口；**不发送 PDF 原文件**。
- 依赖（D3 / pdf.js）通过固定版本 CDN + SRI 加载，版本不得使用浮动标签。
- CSP 通过 `<meta>` 设置：脚本仅 `'self'` 与固定 CDN，禁止 `unsafe-eval` 与内联脚本。
- `frame-ancestors` / `X-Frame-Options` 需由静态托管响应头配置（`<meta>` 不支持 `frame-ancestors`）。
- 所有不可信文本（教材、模型输出、搜索词）通过 `textContent` 渲染，禁止 `innerHTML`。

## 目录结构

```text
/
├─ public/                    # 唯一的静态站点根目录（部署仅需此目录）
│  ├─ index.html
│  ├─ favicon.svg
│  └─ assets/
│     ├─ css/                 # tokens.css、app.css、mindmap.css（后续）
│     ├─ js/                  # main.js 及各功能模块
│     └─ icons/
├─ fixtures/                  # 测试夹具（位于站点根之外，不通过 URL 暴露）
└─ README.md
```

## 测试夹具

`fixtures/` 用于存放 PDF 与 JSON 测试样本，位于 `public/` 之外，不会被部署到站点。

夹具用途与 Mock 使用方式在 [task.md T0.3](./task.md) 中定义。

> 版权注意：请勿提交受版权保护的完整教材；仅使用公开可分发的小型 PDF 或自行构造的样本。

## 已知限制（v1）

- 不支持 OCR / 扫描版 PDF；仅处理可复制文字的 PDF。
- 无移动端适配；最低支持视口 1280×720。
- 单教材工作区；无多教材书架、账号、云同步。
- 若 AI 接口不支持浏览器 CORS，需更换接口或自行部署网关（v1 不内置代理）。
- localStorage 通常约 5 MB；源文本缓存可在配额压力下清理。
