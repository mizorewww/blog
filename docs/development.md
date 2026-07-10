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
  - app/[locale]/categories/loading.tsx
  - app/[locale]/tags/loading.tsx
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
  - components/animata/BlogRouteSkeleton.tsx
  - lib/articleFragment.ts
  - lib/articleReturn.ts
  - lib/blogRouteState.ts
  - lib/listPosts.ts
  - scripts
  - tests/e2e
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

Core Web Vitals 边界：

- LCP 内容来自静态 HTML 或构建期数据，首屏标题、正文和主图不改成客户端请求后显示。
- 点击处理保持短小；预取、分析等非关键工作不能阻塞导航。
- 图片、嵌入内容和固定格式 UI 提供稳定尺寸、宽高比或容器，避免 CLS。
- 列表 RSC 不含正文，文章 RSC 只含当前文章的 MDX 阅读树。
- 第三方脚本默认不进首屏；接入时验证 CSP、构建产物和 INP。
- Speculation Rules 的 `moderate` 预渲染是渐进增强，不能成为导航正确性的前提；分析脚本不得在 prerender 阶段提前上报。

## 文章路由规范

文章阅读架构由 [ADR-0007](./adr/ADR-0007-route-first-article-reading.md) 定义，并由独立的 `PostLayout`、普通文章 Link、来源记录器和安全返回控制实现。

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

Motion 与 Animata-derived 组件只能提供有限反馈，不能拥有文章路由、正文生命周期或滚动恢复。

- Fast 动效为 160-180 ms，standard 动效为 200-220 ms。
- 可见位移使用 `transform`，不超过 8 px；允许局部 opacity，不允许用 opacity 隐藏整篇正文。
- 一次交互最多一个主要动画；已经提交且状态未变的内容不重播入场。
- 应用级 `MotionConfig` 使用 `reducedMotion="user"`。减弱动态效果时取消位移、stagger、smooth scroll 和动画等待。
- Loading UI 是可选的，并且必须与最终页面几何一致。当前实现不为本地化祖先或文章路由定义 `loading.tsx`，因为 Next.js 静态导出的 streaming 边界会在禁用 JavaScript 时让最终文章保持隐藏。
- 普通客户端文章 Link 通过 `AppShell` 在 pathname 提交前显示 `ArticleRouteSkeleton` 覆盖层；修改键、新标签页、直达、刷新和禁用 JavaScript 不依赖该覆盖层。
- 分类和标签嵌套路由保留列表几何的 route skeleton；搜索只在已渲染的结果区域显示查询 loading。不要假设每个 route 都有 skeleton。
- 骨架只覆盖 pending navigation，不在内容提交后伪装第二次加载。

路由或动画变更的浏览器验收矩阵至少覆盖：

- `320x720`、`390x844` 和 `1440x900`。
- 浅色与深色主题。
- 正常动态效果与 reduced motion。
- 首页、分类或标签列表进入文章，再使用浏览器 Back 和页面返回控制。
- 文章直达、刷新、新标签页、外部来源和禁用 JavaScript。

E2E 需要验证 URL、目标内容、scrollY 与动画中间帧。对于应在 220 ms 内结束的效果，记录点击后早期帧、结束帧和 250 ms 之后的稳定帧；仅断言最终 URL 或最终位置不足以证明没有闪烁、二次跳动或错误退出动画。

## 开发纪律

- 不手工修改 `out/`。
- 不依赖某台机器才有的工具链。
- 不用文档或注释代替源代码实现。
- 替换旧动效或状态机时，在同一实现批次删除被替换代码，避免双重所有者。
- 性能与行为优化必须能由构建、测试或质量门禁稳定复现。

## 站点配置

站点标题、作者、社交链接、站点 URL、默认主题和 Umami 配置位于 `data/siteMetadata.ts`。导航位于 `data/headerNavLinks.ts`。
