---
status: active
audience: both
authority: source-of-truth
owner: docs-maintainer
last_verified: 2026-07-10
verified_by: command
related_code:
  - package.json
  - app/[locale]/page.tsx
  - app/[locale]/[...slug]/page.tsx
  - app/[locale]/categories/page.tsx
  - app/[locale]/categories/[category]/page.tsx
  - app/[locale]/tags/page.tsx
  - app/[locale]/tags/[tag]/page.tsx
  - app/theme-providers.tsx
  - layouts/PostLayout.tsx
  - layouts/ListLayoutWithTags.tsx
  - components/AppShell.tsx
  - components/PostCard.tsx
  - components/ArticleReturnLink.tsx
  - components/BlogListNavigationRecorder.tsx
  - components/ArticleReader.tsx
  - components/ReadingProgress.tsx
  - components/animata/ArticleRouteSkeleton.tsx
  - lib/articleFragment.ts
  - lib/articleReturn.ts
  - lib/blogRouteState.ts
  - lib/listPosts.ts
  - scripts
  - tests/e2e
  - tests/e2e/term-routes.spec.ts
  - playwright.config.ts
  - tsconfig.scripts.json
  - eslint.config.mjs
  - knip.json
update_when:
  - development commands or package manager change
  - quality gates change
  - list or article route behavior changes
  - animation, reduced-motion, or loading policy changes
supersedes:
superseded_by:
---

# 本地开发

## 环境

使用 `.node-version` 和 `package.json#packageManager` 指定的 Node.js 与 Yarn 版本。

```bash
yarn install
```

## 开发服务器

```bash
yarn dev
```

默认地址是 `http://localhost:3000/`。

## 静态预览

需要验证真实静态导出、App Router 预取、history 恢复或构建后搜索时，使用：

```bash
yarn preview
```

该命令先执行 `yarn build`，再用仓库固定版本的 Caddy 服务 `out/`。首次运行会下载 Caddy 到 `.tools/caddy/` 并在解压前校验 checksum；该目录只保存本机工具和运行状态，不提交。

默认端口是 `3001`。终端会显示 Local 和 Network 地址。可选参数：

```bash
yarn preview --port 4000
yarn preview --no-build
yarn preview --update-caddy
```

## 质量检查

常用单项检查：

```bash
yarn format:check
yarn lint:check
yarn test:unit
yarn test:e2e
yarn typecheck
yarn typecheck:scripts
yarn docs:check
yarn deadcode:check
yarn perf:check
```

`lint:check` 不改写文件；需要自动修复时使用 `yarn lint:fix`。需要格式化时使用 `yarn format:write`，或只对当前写集运行 Prettier。

合并前的完整静态检查：

```bash
yarn check
```

`yarn check` 包含图标、图片、格式、ESLint、单元测试、应用与脚本 TypeScript、文档 metadata 和 dead-code/dependency 检查。路由、浏览器交互、滚动或静态预览行为变化时还要执行 `yarn test:e2e`；渲染、路由输出、图片、bundle 或第三方客户端依赖变化时还要执行 `yarn perf:check`。

`test:e2e` 通过 Playwright 使用生产静态导出路径。首次缺少 Chromium 时运行：

```bash
yarn playwright install chromium
```

新增 lucide 图标引用后可运行 `yarn icons:generate`；pre-commit 也会更新并暂存 `lib/generated/lucide-icons.ts`。

## 构建与性能

生产构建：

```bash
yarn build
```

构建依次生成图标注册表、清理旧产物、生成 Contentlayer 数据、执行 `next build`，再生成 RSS 与 Pagefind 索引。不要手工修改 `out/`，也不要提交一次性 `.gz`、`.br` 或临时转码文件。

验证列表页没有携带编译后 MDX 正文：

```bash
rg "bodyCode|function MDXContent|var Component" out/zh/index.txt out/en/index.txt
```

期望没有输出。首页、分类页和标签页只能序列化卡片数据；文章路由只导入并渲染当前文章的 MDX 模块。相邻文章导航和 TOC 使用精简数据，不把完整文章集合传给 client islands。

静态 HTML 与资源检查：

```bash
yarn quality:html
yarn size:report
yarn size:budget
```

`quality:html` 的 `issues` 必须修复。`warnings` 需要按上下文判断，例如 SVG/RSS 命名空间或代码示例中的 `http://` 可能是误报。`size:report` 只读构建产物；图片优化应改源文件或使用可重复的命令：

```bash
yarn images:optimize
```

分类和标签路由的回归门禁位于 `tests/e2e/term-routes.spec.ts`。它必须覆盖 zh/en 的 index 与 detail：禁用 JavaScript 时，响应的原始 HTML 不含 `id="B:0"`、`id="S:0"` 或 shimmer fallback，标题、term chip 和文章卡片直接可见；启用 JavaScript 时，Header -> term index -> term chip -> detail 的普通 Link 链路正常提交。

Core Web Vitals 边界：

- LCP 内容来自静态 HTML 或构建期数据，首屏标题、正文和主图不改成客户端请求后显示。
- 点击处理保持短小；预取、分析等非关键工作不能阻塞导航。
- 图片、嵌入内容和固定格式 UI 提供稳定尺寸、宽高比或容器，避免 CLS。
- 列表 RSC 不含正文，文章 RSC 只含当前文章的 MDX 阅读树。
- 第三方脚本默认不进首屏；接入时验证 CSP、构建产物和 INP。
- Speculation Rules 的 `moderate` 预渲染是渐进增强，不能成为导航正确性的前提；分析脚本不得在 prerender 阶段提前上报。

## 文章路由规范

文章阅读与历史所有权由 [ADR-0007](./adr/ADR-0007-route-first-article-reading.md) 定义，App Store 风格卡片转场由 [ADR-0008](./adr/ADR-0008-app-store-article-card-transition.md) 定义。独立 `PostLayout`、普通文章 Link、来源记录器和安全返回控制仍是正确性的基础；视觉快照只是渐进增强。

列表与导航：

1. 首页、分类页和标签页必须使用普通 Next.js `Link` 打开文章。
2. 列表链接不阻止修改键、新标签页或浏览器默认语义，不使用 pending motion 状态决定页面正确性。
3. 文章 URL 必须渲染独立阅读页，只显示当前文章、TOC 和相邻文章导航。
4. 文章顶部返回控制始终具有本地化首页 `href`。只有普通主键列表 Link 写入的同标签页、同源、同 locale 一次性凭证与当前文章精确匹配时，普通主键点击才使用 `history.back()`。凭证只保存来源、目标和创建时间，在 hydration 时按 document time origin 和短到达窗口验证并立即清除；验证结果只属于当前文章路径对应的返回组件实例，不用 `history.length` 推断邻接。
5. 直达、刷新、外链、新标签页和未知 history 走本地化首页，不能离开站点或进入空白历史项。

滚动与正文：

1. Next.js 和浏览器是路由滚动的唯一所有者。
2. 文章打开和返回不使用 `scroll: false`、保存的 `scrollY`、延迟恢复、临时 runway 或提交后的二次滚动。文章内普通同文档 fragment 链接以保留现有 Next.js history state 的 `replaceState()` 更新当前文章 entry，并即时滚动已验证目标；不得新增位于文章和列表来源之间的 history entry。
3. 正文在静态 HTML 中默认可见，不是列表内 disclosure。
4. 正文及其祖先不执行 `height: 0 -> auto`、整篇 opacity gating 或依赖 `AnimatePresence` 的退出折叠。
5. TOC、阅读进度、代码复制和 widget 保持小型 client islands；禁用 JavaScript不影响正文阅读。`ArticleReader` 的 children 由服务端渲染；该边界只持有文章 DOM ref 供 `ReadingProgress` 使用，并捕获经 `lib/articleFragment.ts` 验证的普通同文档 fragment，以保留现有 history state 的 `replaceState()` 和即时滚动避免新增 history entry。不得在该边界导入 `Blog`、MDX、正文状态或可见性逻辑。

## 动画与加载规范

Motion 与 Animata-derived 组件只能提供视觉反馈，不能拥有文章路由、正文生命周期或滚动恢复。下列条目是必须由源代码与 E2E 共同证明的合同，不表示仅凭文档已完成实现。

- Fast 动效为 160-180 ms，standard 动效为 200-220 ms。
- 可见位移使用 `transform`，不超过 8 px；允许局部 opacity，不允许用 opacity 隐藏整篇正文。
- 一次交互最多一个主要动画；已经提交且状态未变的内容不重播入场。
- 应用级 `MotionConfig` 使用 `reducedMotion="user"`。减弱动态效果时取消位移、stagger、smooth scroll 和动画等待。
- App Store 文章卡片转场是唯一 timing/displacement 例外：打开 `380 ms`，经验证的返回 `340 ms`，easing 为 `[0.32, 0.72, 0, 1]`。完整 `PostCard` 必须以 fixed 结构化快照 morph；搜索与侧栏来源只使用单篇 skeleton。
- 快照必须 `aria-hidden="true"`、`pointer-events: none`，只含最小展示数据和数值 rectangle，不用 `cloneNode()`、复制控件、文章 HTML 或 MDX。Header 保持 `z-index: 50`，覆盖层为 `z-index: 40`。
- `320px`/`390px` 目标面全宽、`top: 72px`、radius `0`；`1440px` 目标面宽 `780px`、居中、`top: 120px`、radius `8px`。
- Link 不调用 `preventDefault()`；route commit、Back 与 fallback Link 都不等待动画。覆盖层不设置 scroll restoration、不保存/修正 scrollY、不锁滚动、不持有焦点。resize、缺数据、route mismatch、无有效目标或动画中断立即移除快照。
- reduced motion 下禁止完整卡片的大范围 translate/scale，只允许极短 opacity 提示；正文、URL、focus 和 history 结果必须与正常模式一致。
- Loading UI 是可选的，并且必须与最终页面几何一致。当前实现不为本地化祖先、文章路由或分类/标签的 index/detail 定义 `loading.tsx`，因为 Next.js 静态导出的 streaming fallback 会在禁用 JavaScript 时把最终内容留在隐藏的 `S:0` segment 后面。
- 普通客户端文章 Link 的目标合同是由 `AppShell` 显示 ADR-0008 快照；完整卡片使用卡片 morph，搜索/侧栏才保留 `ArticleRouteSkeleton` 几何。修改键、新标签页、直达、刷新和禁用 JavaScript 不依赖该覆盖层。
- 分类和标签页面由预渲染 HTML 直接显示标题、term chip 与文章卡片；搜索只在已渲染的结果区域显示查询 loading。不要假设每个 route 都有 skeleton。
- 快照可跨 route commit 完成有界视觉退出，但真实文章从提交时起直接可读；它不能在内容提交后伪装第二次加载或遮住正文等待 animation complete。

路由或动画变更的浏览器验收矩阵至少覆盖：

- `320x720`、`390x844` 和 `1440x900`。
- 浅色与深色主题。
- 正常动态效果与 reduced motion。
- 首页、分类或标签列表进入文章，再使用浏览器 Back 和页面返回控制。
- 文章直达、刷新、新标签页、外部来源和禁用 JavaScript。
- 完整 PostCard、搜索结果与侧栏三种来源；前者验证 card morph，后两者验证单篇 skeleton fallback。
- 正常完成、快速重复点击、动画中 resize、目标卡片缺失和 route mismatch 等退化路径。

E2E 需要验证 URL、目标内容、scrollY、snapshot semantics 与动画中间帧。普通微动效记录点击后早期帧、220 ms 结束帧和 250 ms 之后的稳定帧；文章打开至少记录起点、约 190 ms 中间帧、380 ms 结束帧和 450 ms 稳定帧，返回至少记录起点、约 170 ms 中间帧、340 ms 结束帧和 420 ms 稳定帧。断言 overlay 为 fixed、inert、Header 在其上方，移动/桌面目标 geometry 符合合同，并证明 route/Back 在动画结束前即可提交。仅断言最终 URL 或最终位置不足以证明没有闪烁、二次跳动或错误退出动画。

## 开发纪律

- 不手工修改 `out/`。
- 不依赖某台机器才有的工具链。
- 不用文档或注释代替源代码实现。
- 替换旧动效或状态机时，在同一实现批次删除被替换代码，避免双重所有者。
- 性能与行为优化必须能由构建、测试或质量门禁稳定复现。

## 站点配置

站点标题、作者、社交链接、站点 URL、默认主题和 Umami 配置位于 `data/siteMetadata.ts`。导航位于 `data/headerNavLinks.ts`。
