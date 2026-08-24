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

开发阶段不会启用 `output: 'export'`。Next.js 使用稳定的顶层 `app/layout.tsx` 处理正常页面和未知路由，并从权威的 `public/_redirects` 载入与静态 preview 相同的永久重定向规则。根布局以服务端组件拥有完整文档；路径语言由 `app/localized-html.tsx` 在初始浏览器文档和客户端导航时同步。

## 静态预览

需要验证真实静态导出、App Router 预取、history 恢复或构建后搜索时，使用：

```bash
yarn preview
```

该命令先执行 `yarn build`，再用仓库固定版本的 Caddy 服务 `out/`。Caddy 从构建产物中的 `_redirects` 读取同一组权威规则，并关闭自身的 canonical URI redirect，保持 wildcard、Unicode 与 trailing-slash 行为和开发服务器一致。首次运行会下载 Caddy 到 `.tools/caddy/` 并在解压前校验 checksum；该目录只保存本机工具和运行状态，不提交。

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
yarn test:e2e:parity
yarn typecheck
yarn typecheck:scripts
yarn deadcode:check
yarn perf:check
```

`lint:check` 不改写文件；需要自动修复时使用 `yarn lint:fix`。需要格式化时使用 `yarn format:write`，或只对当前写集运行 Prettier。

合并前的完整静态检查：

```bash
yarn check
```

`yarn check` 包含图标、图片、格式、ESLint、单元测试、应用与脚本 TypeScript 和 dead-code/dependency 检查。路由、浏览器交互、滚动或静态预览行为变化时还要执行 `yarn test:e2e`；渲染、路由输出、图片、bundle 或第三方客户端依赖变化时还要执行 `yarn perf:check`。

`test:e2e` 通过 Playwright 使用生产静态导出路径。`test:e2e:parity` 会先构建 `out/`，再同时启动 Next.js development server 与 Caddy preview，比较 redirect status/`Location`、Unicode 与 trailing slash、本地化页面以及自定义 404。Next.js 15.5 的开发 404 原始 streaming shell 不要求与静态 HTML 字节一致；门禁比较浏览器完成框架渲染后的 status、title、`html lang`、文案和返回链接。

首次缺少 Chromium 时运行：

```bash
yarn playwright install chromium
```

新增 lucide 图标引用后可运行 `yarn icons:generate`；pre-commit 也会更新并暂存 `lib/generated/lucide-icons.ts`。

## UI 截图

UI 改动需要目视检查时，先启动静态预览，让 Pagefind、404 和导出路由都使用生产路径：

```bash
yarn preview
```

如果已经构建过，也可以复用现有 `out/`：

```bash
yarn preview --no-build --port 3001
```

另开一个终端生成截图：

```bash
yarn ui:screenshots --label after
```

默认访问 `http://127.0.0.1:3001`，捕捉 `zh` 的首页、文章、搜索、分类和 404，在 `1440x900` desktop 与 `375x812` mobile 两个 viewport 下使用 dark theme。捕捉时使用 reduced motion，并在每次导航后确认根节点主题 class，再等待 Header 与主内容区域动画稳定。常用参数：

```bash
yarn ui:screenshots --label after --theme both
yarn ui:screenshots --label header-polish --pages home,article,404
yarn ui:screenshots --label reading --pages article-top,article-math,article-code,article-data-block --viewports desktop,compact --theme both
yarn ui:screenshots --label comprehensive-after --pages home,search-results,search-empty,categories,tags,category-term,tag-term,404 --viewports compact,mobile,landscape,tablet,laptop,desktop --theme both
yarn ui:screenshots --label local --base-url http://127.0.0.1:4000
```

页面键除了 `home`、`article`、`search`、`categories` 和 `404`，还支持文章局部截图：`article-top`、`article-math`、`article-code`、`article-table`、`article-toc`、`article-image`、`article-data-block`、`article-bottom`。发现页和搜索状态可用 `search-initial`、`search-results`、`search-empty`、`search-error`、`tags`、`category-term`、`tag-term`。viewport 可选 `compact`、`mobile`、`landscape`、`reflow200`、`tablet`、`laptop`、`desktop`、`w1280`、`w1440`、`w1728`、`w1920`；`compact` 是 `320x812`，`reflow200` 是 `640x900`，用于近似检查 1280px 视口 200% zoom 的重排。

Reading Max 长文排版改动需要额外捕捉真实中英文文章顶部、暗色 inline code、Markdown family fixture 和 200% 文本缩放证据。输出仍必须留在 ignored agent records 下：

```bash
yarn ui:screenshots --label reading-max-after-zh --out-dir docs/agent-records/reading-max/screenshots/after/zh-top --pages article-top --article-path /zh/折腾/xiaomi-book-pro-14/ --viewports compact,reflow200,tablet,w1440,w1920 --theme both
yarn ui:screenshots --label reading-max-after-en --out-dir docs/agent-records/reading-max/screenshots/after/en-top --pages article-top --article-path /en/折腾/xiaomi-book-pro-14/ --viewports compact,reflow200,tablet,w1440,w1920 --theme both
yarn ui:screenshots --label reading-max-inline-code --out-dir docs/agent-records/reading-max/screenshots/after/inline-code --pages article-inline-code --article-path /zh/技术/blog-git-metadata-and-icons/ --viewports compact,reflow200,tablet,w1440,w1920 --theme both
yarn ui:screenshots --label reading-max-markdown-fixture --out-dir docs/agent-records/reading-max/screenshots/after/markdown-fixture --pages markdown-fixture --article-path /zh/折腾/xiaomi-book-pro-14/ --viewports compact,reflow200,tablet,w1440,w1920 --theme both
yarn ui:screenshots --label reading-max-rich-content --out-dir docs/agent-records/reading-max/screenshots/after/rich-content --pages article-code,article-math,article-table --article-path /zh/技术/making-memoh-cheaper-on-telegram/ --viewports compact,reflow200,tablet,w1440,w1920 --theme both
yarn ui:screenshots --label reading-max-images --out-dir docs/agent-records/reading-max/screenshots/after/images --pages article-image --article-path /zh/折腾/kde-plasma-obsdian-web-clipper/ --viewports compact,reflow200,tablet,w1440,w1920 --theme both
yarn ui:screenshots --label reading-max-textscale-zh --out-dir docs/agent-records/reading-max/screenshots/after/textscale200-zh --pages article-top,markdown-fixture --article-path /zh/折腾/xiaomi-book-pro-14/ --viewports reflow200 --theme both --text-scale 200
yarn ui:screenshots --label reading-max-textscale-rich --out-dir docs/agent-records/reading-max/screenshots/after/textscale200-rich --pages article-code,article-math,article-table --article-path /zh/技术/making-memoh-cheaper-on-telegram/ --viewports reflow200 --theme both --text-scale 200
```

`/zh/技术/making-memoh-cheaper-on-telegram/` 是真实 rich-content 样本，包含 Shiki 代码块、行间 MathJax 和 Markdown 表格；`/zh/折腾/kde-plasma-obsdian-web-clipper/` 包含真实正文图片，适合 `article-image`。不要把 `article-math` 指向缺少 MathJax 的文章，否则局部截图会按设计等待目标元素并失败。

`w1280`、`w1440`、`w1728`、`w1920` 分别是 `1280x960`、`1440x960`、`1728x960`、`1920x960`。`--text-scale 200` 会把根字体设为 `200%`，用于验证真实 200% 文本缩放，而不是只缩小 viewport。

截图还支持局部捕捉和滚动：

```bash
yarn ui:screenshots --label focus --pages home --selector '[data-post-shell]' --theme light
yarn ui:screenshots --label footer --pages article-bottom --full-page
yarn ui:screenshots --label section --pages article --scroll-to '.article-post-nav'
```

输出目录必须位于 `docs/agent-records/` 下的安全子目录，例如默认的 `docs/agent-records/screenshots/<label>/` 或 Reading Max 专用的 `docs/agent-records/reading-max/screenshots/after/`；实际允许范围以脚本校验为准。该目录只保存本机 agent 记录，不进入 Git。脚本不会启动服务器；如果目标服务、页面状态或响应码不符合预期，会以非零状态退出。`--out-dir` 指向允许范围外部时会直接失败，避免 UI 审阅图片散落到仓库其他位置。

需要量化 UI 关键指标时，使用：

```bash
yarn ui:probe --base-url http://127.0.0.1:3001 --out docs/agent-records/comprehensive-after-probe.json
```

probe 会输出 header 控件命中区、首页首卡高度、侧栏视觉权重、term chip 高度、搜索初始/结果/空/错误状态、404 inset 和多 viewport 页面横向 overflow。该 JSON 也是本机 agent 记录，不提交；`--out` 同样必须留在 `docs/agent-records/` 下。

同一个 probe 还会输出 `readingMax` 节点，覆盖：

- 中英文文章在 `320`、`375`、`640`、`768`、`1024`、`1280`、`1440`、`1728`、`1920` CSS px 下的正文宽度、首段可见高度、字符行长、TOC 间距和 dark inline code computed style/contrast。
- test-only Markdown fixture 的 h2-h6、列表、任务列表、blockquote、details、footnotes、kbd、abbr、mark、sub/sup、图片、表格、长 token 和嵌入块覆盖。
- 真实 rich article 的代码、表格和 MathJax 内部横向滚动。
- `640x900` 下 `--text-scale 200` 的根字体、页面 overflow 和内部滚动状态。

Reading Alignment 类改动还需要采集共享 rail 与 wide TOC 的证据。`ui:probe` 会额外输出顶层 `readingAlignment` 节点，覆盖真实文章与 test-only fixture 在 `320`、`375`、`640`、`768`、`1024`、`1280`、`1440`、`1728`、`1920` CSS px 下的 edge delta、rail delta、surface/text center offset、text left inset（textLeftInset）、页面 overflow、TOC 宽度/间距/左侧边距、TOC label overflow 和 scroll affordance。该节点还会在 `640x900` 与 `1440x960` 下重复 200% 文本缩放检查。

宽屏光学平衡改动的期望是：`1024px` 及以上文章页为 `TOC | surface | tree`，surface 占据居中 `article-shell` 减去 `584px` 后的中间栏，正文 rail 在 surface 内贴左对齐（textLeftInset = gutter，±1px）；`1024px` 以下正文 rail 在 surface 内居中且 center offset 不超过 `1px`，文章树隐藏。桌面 TOC 在左侧常驻，保持 `256px` 宽、距 surface `36px`、sticky、低视觉权重、无 clipping/overflow，并在 `1024px` 仍可见。右侧内容树同样 `256px`、距 surface `36px`、sticky。

Reading Alignment 截图建议按真实文章和 fixture 分组，输出到本机 agent records：

```bash
yarn ui:screenshots --label reading-alignment-after-xiaomi --out-dir docs/agent-records/reading-alignment-audit/screenshots/after/xiaomi --pages article-top,article-toc,article-data-block --article-path /zh/折腾/xiaomi-book-pro-14/ --viewports compact,mobile,reflow200,tablet,laptop,w1280,w1440,w1728,w1920 --theme both
yarn ui:screenshots --label reading-alignment-after-rich --out-dir docs/agent-records/reading-alignment-audit/screenshots/after/rich --pages article-code,article-math,article-table --article-path /zh/技术/making-memoh-cheaper-on-telegram/ --viewports compact,mobile,reflow200,tablet,laptop,w1280,w1440,w1728,w1920 --theme both
yarn ui:screenshots --label reading-alignment-after-images --out-dir docs/agent-records/reading-alignment-audit/screenshots/after/images --pages article-image --article-path /zh/折腾/kde-plasma-obsdian-web-clipper/ --viewports compact,mobile,reflow200,tablet,laptop,w1280,w1440,w1728,w1920 --theme both
yarn ui:screenshots --label reading-alignment-after-feature --out-dir docs/agent-records/reading-alignment-audit/screenshots/after/feature --pages article-top,article-data-block --article-path /zh/技术/blog-git-metadata-and-icons/ --viewports compact,mobile,reflow200,tablet,laptop,w1280,w1440,w1728,w1920 --theme both
yarn ui:screenshots --label reading-alignment-after-fixture --out-dir docs/agent-records/reading-alignment-audit/screenshots/after/fixture --pages markdown-fixture --article-path /zh/折腾/xiaomi-book-pro-14/ --viewports compact,mobile,reflow200,tablet,laptop,w1280,w1440,w1728,w1920 --theme both
yarn ui:screenshots --label reading-alignment-textscale-rich --out-dir docs/agent-records/reading-alignment-audit/screenshots/after/textscale200-rich --pages article-code,article-math,article-table --article-path /zh/技术/making-memoh-cheaper-on-telegram/ --viewports reflow200,w1440 --theme both --text-scale 200
yarn ui:screenshots --label reading-alignment-textscale-fixture --out-dir docs/agent-records/reading-alignment-audit/screenshots/after/textscale200-fixture --pages markdown-fixture --article-path /zh/折腾/xiaomi-book-pro-14/ --viewports reflow200,w1440 --theme both --text-scale 200
yarn ui:screenshots --label wide-reading-optical-balance --out-dir docs/agent-records/wide-reading-optical-balance/screenshots/final --pages article-top,article-toc --article-path /zh/折腾/xiaomi-book-pro-14/ --viewports w1440,w1728,w1920 --theme both
```

## 构建与性能

生产构建：

```bash
yarn build
```

构建依次生成图标注册表、清理旧产物、生成 Contentlayer 数据、执行启用了 `output: 'export'` 的 `next build`，再生成 RSS、把 `out/{locale}/` 下所有 HTML 的 `lang` 校正为路径对应语言，最后生成 Pagefind 索引。语言校正必须发生在 Pagefind 之前，确保中英文进入各自索引。不要手工修改 `out/`，也不要提交一次性 `.gz`、`.br` 或临时转码文件。

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

文章阅读与历史所有权由 [ADR-0007](./decisions.md#adr-0007-路由优先的文章阅读) 定义，App Store 风格卡片转场由 [ADR-0008](./decisions.md#adr-0008-app-store-风格文章卡片转场) 定义。独立 `PostLayout`、普通文章 Link、来源记录器和安全返回控制仍是正确性的基础；视觉快照只是渐进增强。

列表与导航：

1. 首页、分类页和标签页必须使用普通 Next.js `Link` 打开文章。
2. 列表链接不阻止修改键、新标签页或浏览器默认语义，不使用 pending motion 状态决定页面正确性。
3. 文章 URL 必须渲染独立阅读页，只显示当前文章、TOC 和相邻文章导航。
4. 文章顶部返回控制始终具有本地化首页 `href`。只有普通主键列表 Link 写入的同标签页、同源、同 locale 一次性凭证与当前文章精确匹配时，普通主键点击才使用 `history.back()`。凭证只保存来源、目标和创建时间，在 hydration 时按 document time origin 和短到达窗口验证并立即清除；验证结果只属于当前文章路径对应的返回组件实例，不用 `history.length` 推断邻接。
5. 直达、刷新、外链、新标签页和未知 history 走本地化首页，不能离开站点或进入空白历史项。

滚动与正文：

1. Next.js 和浏览器是路由滚动的唯一所有者。
2. 文章打开和返回不使用 `scroll: false`、保存的 `scrollY`、延迟恢复、临时 runway 或提交后的二次滚动。文章内普通同文档 fragment 链接以保留现有 Next.js history state 的 `replaceState()` 更新当前文章 entry，并即时滚动已验证目标；不得新增位于文章和列表来源之间的 history entry。
3. 正文在静态 HTML 中默认挂载、参与静态布局且不依赖客户端透明度或延迟挂载，不是列表内 disclosure。仅 ADR-0008 已验证卡片意图的页面色 underlay（打开/返回淡入，返回回位后淡出）与 `opening` 期间对 surface/桌面 TOC 的 CSS 隐藏（revealed 时无过渡立即显示）可在不修改正文 DOM 的前提下短暂遮挡其 pixels。
4. 正文及其祖先不执行 `height: 0 -> auto`、整篇 DOM opacity gating、delayed mounting 或依赖 `AnimatePresence` 的退出折叠。
5. TOC、阅读进度、代码复制和 widget 保持小型 client islands；禁用 JavaScript不影响正文阅读。`ArticleReader` 的 children 由服务端渲染；该边界只持有文章 DOM ref 供 `ReadingProgress` 使用，并捕获经 `lib/articleFragment.ts` 验证的普通同文档 fragment，以保留现有 history state 的 `replaceState()` 和即时滚动避免新增 history entry。不得在该边界导入 `Blog`、MDX、正文状态或可见性逻辑。

## 动画与加载规范

Motion 与 Animata-derived 组件只能提供视觉反馈，不能拥有文章路由、正文生命周期或滚动恢复。下列条目是必须由源代码与 E2E 共同证明的合同，不表示仅凭文档已完成实现。

- Fast 动效为 160-180 ms，standard 动效为 200-220 ms。
- 可见位移使用 `transform`，不超过 8 px；允许局部 opacity，不允许用 opacity 隐藏整篇正文。
- 一次交互最多一个主要动画；已经提交且状态未变的内容不重播入场。
- 应用级 `MotionConfig` 使用 `reducedMotion="user"`。减弱动态效果时取消位移、stagger、smooth scroll 和动画等待。
- App Store 文章卡片转场是唯一 timing/displacement 例外：先用 `160 ms` / `easeOut` 淡入页面色 underlay，再打开 `380 ms` 或经验证返回 `340 ms`，easing 为 `[0.32, 0.72, 0, 1]`。完整 `PostCard` 必须以 fixed 结构化快照 morph；搜索与侧栏来源只使用单篇 skeleton。
- 快照必须 `aria-hidden="true"`、`pointer-events: none`，只含最小展示数据和数值 rectangle，不用 `cloneNode()`、复制控件、文章 HTML 或 MDX。Header 保持 `z-index: 50`，覆盖层为 `z-index: 40`。
- `PostCard`、`ArticleCardTransitionOverlay` 与 `PostLayout` 共享一套卡片头部展示合同。surface、cover、title、Git 相对更新时间、源码入口、summary、published date、primary tag 和 read-more affordance 必须分别类型化并拥有各自的 layout marker；禁止把 metadata 合并为一个不可投影的字符串或节点。
- title 与其余持久信息在 overlay 终点和文章头部必须保持相同的元素顺序、字体、字重、行高、换行约束和 geometry，逐 child 投影且不使用 opacity crossfade 交接。捕获时冻结 Git 相对时间文案。read-more 只在 inert snapshot 中保留占位并平滑淡出，返回时平滑恢复，不在文章页生成可聚焦自链接。
- 完整卡片意图从第 0 帧允许 snapshot 背后出现 fixed/inert 页面色 underlay：打开与返回均先淡入 160ms，卡片再移动。目标 pathname 提交后、`opening` 期间以 CSS 隐藏真实 surface 与桌面 TOC（`opacity: 0` + `visibility: hidden`），`revealed` 时无过渡立即显示，overlay 整体在其上以 180ms 退出淡出。卡片返回把 `history.back()` 推迟到 underlay 不透明之后。返回在卡片回到列表目标后再把 underlay 淡出。目标 DOM 必须继续挂载、保持语义和静态布局，导航、history、focus 与 scroll 都不能等待视觉 handoff。underlay 不得用于直达、失败或退化路径。
- destination-only presentation 仅限显式标记的有界文章头部控件和文章专有 metadata；只有这些头部元素可在 validated opening 期间为 `opacity: 0`，并在 handoff 后用 `180 ms` reveal。正文及其所有祖先不得使用该 marker 或继承 transition opacity，必须在视觉层下保持静态可见。共享 cover、title、Git 信息、summary、date 与 tag 不得 opacity crossfade；snapshot 必须保持为最终 motion frame 的 topmost shared representation。reduced motion 在极短 snapshot 提示后立即显示目标 presentation，不等待 underlay 或 reveal。
- `320px`/`390px` 目标面全宽、`top: 72px`、radius `0`；`640–1023px` 目标面为居中 shell、`top: 120px`、radius `8px`；`1024px` 及以上目标面为同一居中 shell 减去 `584px` 后的中间栏、`top: 120px`、radius `8px`。内容树 companion 在 underlay 淡入期间保持来源/destination rectangle，只在卡片 Phase B 滑动（打开 380ms，companion 返回 340ms），并维持到返回 Phase C 结束；文章→文章只用阅读面 veil。代码块工具行不再使用 `min-h-12`，复制/源码控件保持 `44px`。
- Link 不调用 `preventDefault()`；route commit、Back 与 fallback Link 都不等待动画。覆盖层不设置 scroll restoration、不保存/修正 scrollY、不锁滚动、不持有焦点。resize、缺数据、route mismatch、无有效目标或动画中断立即移除 snapshot、underlay 和 destination-only staging；这些歧义路径不得遮挡目标 pixels。
- reduced motion 下禁止完整卡片的大范围 translate/scale，只允许极短 opacity 提示；正文、URL、focus 和 history 结果必须与正常模式一致。
- Loading UI 是可选的，并且必须与最终页面几何一致。当前实现不为本地化祖先、文章路由或分类/标签的 index/detail 定义 `loading.tsx`，因为 Next.js 静态导出的 streaming fallback 会在禁用 JavaScript 时把最终内容留在隐藏的 `S:0` segment 后面。
- 普通客户端文章 Link 的目标合同是由 `AppShell` 显示 ADR-0008 快照；完整卡片使用卡片 morph，搜索/侧栏才保留 `ArticleRouteSkeleton` 几何。修改键、新标签页、直达、刷新和禁用 JavaScript 不依赖该覆盖层。
- 分类和标签页面由预渲染 HTML 直接显示标题、term chip 与文章卡片；搜索只在已渲染的结果区域显示查询 loading。不要假设每个 route 都有 skeleton。
- 快照可跨 route commit 完成有界视觉退出，但真实文章 DOM 从提交时起已挂载、静态布局且不做 opacity gating 或 delayed mounting。已验证的完整卡片意图可由页面色 underlay 遮挡来源或目标 pixels；`opening` 期间的 surface/TOC CSS 隐藏只持续到 revealed，且 revealed 的显示不带任何过渡；不得把该 underlay 或隐藏扩展成第二次加载或正文生命周期门禁。

路由或动画变更的浏览器验收矩阵至少覆盖：

- `320x720`、`390x844` 和 `1440x900`。
- 浅色与深色主题。
- 正常动态效果与 reduced motion。
- 首页、分类或标签列表进入文章，再使用浏览器 Back 和页面返回控制。
- 文章直达、刷新、新标签页、外部来源和禁用 JavaScript。
- 完整 PostCard、搜索结果与侧栏三种来源；前者验证 card morph，后两者验证单篇 skeleton fallback。列表内容树点击验证树 overlay + 阅读面 veil；文章树点击验证 veil 且 TOC/树不位移。无脚本时内容树仍在 HTML 中且文件夹默认展开。
- 正常完成、快速重复点击、动画中 resize、目标卡片缺失和 route mismatch 等退化路径。

E2E 需要验证 URL、目标内容、scrollY、snapshot semantics 与动画中间帧。普通微动效记录点击后早期帧、220 ms 结束帧和 250 ms 之后的稳定帧；文章打开至少记录起点、约 80 ms fade 中间帧、160 ms morph 起点、约 350 ms morph 中间帧、约 540 ms handoff 帧、`180 ms` destination-only reveal 和稳定帧，返回至少记录起点、underlay 淡入、340 ms morph、160 ms underlay 淡出和稳定帧。断言 overlay 为 fixed、inert、Header 在其上方，移动/桌面目标 geometry 符合合同，并证明 route/Back 在动画结束前即可提交；还要逐项比较 title、Git 信息、summary、date 和 tag 在 overlay 终点与文章共享头部的 typography、顺序、换行和 rectangle，确认没有 opacity handoff 或单帧消失。每个中间帧都要检查实际 pixels 以及 cover、共享字段和 destination-only controls 位置的 topmost painted layer，不能以被遮挡元素的 DOM presence 或 computed opacity 代替视觉断言。仅断言最终 URL 或最终位置不足以证明没有闪烁、二次跳动或错误退出动画。

## 小型交互与移动 Header

- 短 TOC、提交记录和菜单可以使用 disclosure 动效，但需要稳定的触发按钮、`aria-expanded`、可识别的内容关系和 reduced-motion 等价行为。ThemeSwitch、复制反馈、active indicator 与 BackToTop 使用 fast 档，不与路由主动画同时 stagger。
- hover 和 focus 只能改变阴影、边框、颜色、opacity 或小范围 transform，不得改变控件占位尺寸。图标按钮使用稳定的点击区域和 accessible name；文本必须在 320 px 宽度下不与相邻控件重叠。
- `<1024px` 使用 `Menu`/`X` 图标按钮控制移动导航 disclosure：触发器固定 `44x44px`，提供随状态变化的 accessible name、`aria-expanded` 和 `aria-controls`；`Escape` 关闭并把焦点还给触发器；pathname 变化、进入 `>=1024px` 或点击 Header 外部都会关闭。面板打开时文章滚动隐藏逻辑不得隐藏 Header。移动面板直接挂载，不播放入场/退出动画，使用普通 `<nav>` 语义，不用 `role="menu"`、focus trap 或 scroll lock。
- `>=1024px` 保留桌面导航布局和 Motion active underline，不渲染移动 disclosure。这个断点给中英文导航、RSS、主题按钮和语言切换留下单行空间，避免 640px/768px 平板与 200% reflow 宽度下出现竖排或重叠。

## 开发纪律

- 不手工修改 `out/`。
- 不依赖某台机器才有的工具链。
- 不用文档或注释代替源代码实现。
- 替换旧动效或状态机时，在同一实现批次删除被替换代码，避免双重所有者。
- 性能与行为优化必须能由构建、测试或质量门禁稳定复现。

## 撰写博客

新增文章可使用 CLI 工具：

```bash
yarn write-blog create --title "文章标题" --locale zh --slug my-post --folder 折腾 --draft
```

参数说明：

- `--title`：文章标题（必填）。
- `--locale`：`zh` 或 `en`（必填）。
- `--slug`：URL slug；中文标题必须显式提供，脚本不会自动生成拼音 slug。
- `--folder`：主题子目录，kebab-case 段，可用 `/` 嵌套；拒绝 `..` 以及 `categories`/`tags`/`search`。
- `--date`：发布日期，默认当天（`YYYY-MM-DD`）。
- `--summary`、`--categories`、`--tags`、`--translationKey`、`--authors`、`--image`、`--draft`：可选 frontmatter 字段。

工具会创建 `content/blog/{locale}/{folder}/{slug}.md` 并自动运行 `yarn content:generate` 验证 frontmatter 和 MDX。完整 agent 写作流程（选题、生成 frontmatter、撰写正文、humanizer-zh 润色、构建验证、提交）见 `.agents/instructions/write-blog.md`。

## 站点配置

站点标题、作者、社交链接、站点 URL、默认主题和 Umami 配置位于 `data/siteMetadata.ts`。导航位于 `data/headerNavLinks.ts`。
