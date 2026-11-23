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
│     ├─ js/                  # main.js 及各功能模块（含 ai-mock.js）
│     ├─ mock/                # 开发模式 Mock 响应集（启用时才被读取）
│     └─ icons/
├─ fixtures/                  # 测试夹具（位于站点根之外，不通过 URL 暴露）
│  ├─ *.pdf                   # PDF 夹具
│  └─ json/                   # 合法/非法树夹具
├─ tools/                     # 夹具生成与校验脚本（开发专用）
└─ README.md
```

## 测试夹具

`fixtures/` 存放 PDF 与 JSON 测试样本，位于 `public/` 之外，不会被部署，也不会通过 URL 暴露。

| 夹具 | 用途 |
| --- | --- |
| `fixtures/bookmarked.pdf` | 3 章、顶层书签、正文可提取；书签切章与完整链路 |
| `fixtures/bookmarked-20ch.pdf` | 20 章 / 300 页、顶层书签；规模、标签与性能 |
| `fixtures/no-bookmark.pdf` | 含「第一章/第二章/第三章」标题、无书签；正则兜底 |
| `fixtures/no-chapter.pdf` | 无书签、无章标题；单章回退 |
| `fixtures/toc-false-positive.pdf` | 目录页列出 10 个章标题；目录误判 |
| `fixtures/encrypted.pdf` | 用户密码 `123456`；加密分支 |
| `fixtures/scanned.pdf` | 纯图片、无文本层；`PDF_NO_TEXT` |
| `fixtures/corrupted.pdf` | 截断文件；`PDF_CORRUPT` |
| `fixtures/not-a-pdf.pdf` | 非 PDF 字节；`PDF_INVALID_TYPE` |
| `fixtures/json/valid-tree*.json` | 合法树（3 层 / 4 层），content 均为第一章原文连续子串 |
| `fixtures/json/invalid-*.json` | 8 类非法树：3 字标题、13 字标题、81 字 content、改写原文、5 层、101 节点、9 子节点、术语不在原文 |
| `fixtures/json/response-fenced.json` | Markdown 围栏 + 前后说明包裹的 JSON |

所有 PDF 与正文均为自撰示例文本，不含任何受版权保护的教材内容。

### 重新生成与校验

```bash
# 需要先安装开发依赖（不随仓库提交）
npm install --prefix devdeps --registry=https://registry.npmmirror.com pdfkit@0.15.2 pdfjs-dist@3.11.174

node tools/make-fixtures.mjs    # 生成 PDF / JSON / Mock 夹具
node tools/verify-fixtures.mjs  # 用 pdf.js 逐个校验夹具行为，并核对 Mock 与原文一致
```

`node tools/make-fixtures.mjs --large` 会额外生成 `bookmarked-20ch.pdf`（20 章 / 300 页，F-02）。80 MB / 1500 页（F-08）与 >100 MB / >2000 页（F-09）体积过大，默认不生成、不提交。

## 开发模式 Mock（不消耗真实 Key）

Mock 默认**关闭**。启用方式：

```text
http://localhost:8080/?mock=1                        # 默认场景 success
http://localhost:8080/?mock=1&mockScenario=http-401  # 指定场景
```

启用后顶栏出现 `MOCK` 标识，控制台可用 `window.__tmmMock`（`fetch` / `useScenario` / `reset`）。

| 场景 | 用途 |
| --- | --- |
| `success` | 合法响应，content 逐字取自 `bookmarked.pdf` 第一章 |
| `fenced` | Markdown 围栏 + 前后说明，需要先提取 JSON |
| `malformed` | 截断 JSON → `AI_BAD_RESPONSE` |
| `http-401` / `http-403` | 鉴权失败 → `AI_AUTH`（不自动重试） |
| `http-429` | 限流 → 退避重试 |
| `http-500` | 上游异常 → 重试后 `AI_UPSTREAM` |
| `timeout` | 延迟 5s，触发客户端超时 `AI_TIMEOUT` |
| `chunk-partial-fail` | 第 1 块成功、第 2 块 500，整章应失败且不留半树 |

约束：Mock 使用独立 `docId`（`doc_00000000-0000-4000-8000-000000000000`），开关只写 `sessionStorage` 的 `tmm:dev:*`，不会写入正式文档键 `tmm:v1:*`。发布路径默认不启用 Mock。

## 已知限制（v1）

- 不支持 OCR / 扫描版 PDF；仅处理可复制文字的 PDF。
- 无移动端适配；最低支持视口 1280×720。
- 单教材工作区；无多教材书架、账号、云同步。
- 若 AI 接口不支持浏览器 CORS，需更换接口或自行部署网关（v1 不内置代理）。
- localStorage 通常约 5 MB；源文本缓存可在配额压力下清理。
