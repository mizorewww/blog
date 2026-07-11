---
status: active
audience: both
authority: source-of-truth
owner: docs-maintainer
last_verified: 2026-07-11
verified_by: command
related_code:
  - app/[locale]/page.tsx
  - app/[locale]/[...slug]/page.tsx
  - app/[locale]/categories/page.tsx
  - app/[locale]/categories/[category]/page.tsx
  - app/[locale]/tags/page.tsx
  - app/[locale]/tags/[tag]/page.tsx
  - app/theme-providers.tsx
  - layouts/PostLayout.tsx
  - layouts/ListLayoutWithTags.tsx
  - components/PostCard.tsx
  - components/ArticleCardPresentation.tsx
  - components/ArticleGitMeta.tsx
  - components/PostMeta.tsx
  - components/MDXServerRenderer.tsx
  - components/AppShell.tsx
  - components/ArticleTransitionContext.tsx
  - components/ArticleReturnLink.tsx
  - components/BlogListNavigationRecorder.tsx
  - components/ArticleReader.tsx
  - components/ArticleTableOfContents.tsx
  - components/animata/ArticleCardTransitionOverlay.tsx
  - components/animata/ArticleRouteSkeleton.tsx
  - lib/articleFragment.ts
  - lib/articleReturn.ts
  - lib/articleTransition.ts
  - lib/blogRouteState.ts
  - lib/content/posts.ts
  - lib/content/terms.ts
  - lib/listPosts.ts
  - lib/toc.ts
  - next.config.js
  - public/_headers
  - tests/e2e/article-card-transition.spec.ts
  - tests/e2e/term-routes.spec.ts
  - tests/unit/articleTransition.test.ts
update_when:
  - architecture or build model changes
  - list or article RSC boundaries change
  - routing, return, or scroll behavior changes
  - animation or loading ownership changes
supersedes:
superseded_by:
---

# 软件架构

本项目是纯静态双语博客。生产环境不运行 Node.js 服务，文章、列表和索引页面均在构建阶段预渲染。文章阅读采用路由优先架构：文章 URL 是独立阅读页面，不是列表卡片的展开状态。文章与历史所有权以 [ADR-0007](./adr/ADR-0007-route-first-article-reading.md) 为准，卡片到独立文章页的视觉连续性以 [ADR-0008](./adr/ADR-0008-app-store-article-card-transition.md) 为准，MDX 安全边界以 [ADR-0003](./adr/ADR-0003-remove-client-mdx-eval.md) 为准。

## 构建模型

```text
MDX files
  -> Contentlayer
  -> typed content data + generated MDX modules
  -> Next.js static routes
  -> out/
  -> Cloudflare Pages
```

构建入口是 `yarn build`。构建完成后，`out/` 是唯一部署产物。

## 目录职责

```text
app/          Next.js 路由、页面、SEO、全局布局和渐进增强 UI
components/   UI、有限动效、MDX 渲染和文章阅读 client islands
layouts/      列表与文章的页面级布局边界
content/      文章和作者 MDX 内容
data/         导航、站点信息和代码主题等配置
lib/          内容查询、列表投影、TOC、日期、SEO、国际化和小型路由工具
scripts/      开发、构建后处理和质量检查脚本
public/       静态资源和 Cloudflare Pages headers
docs/         架构决策与维护文档
```

## 内容管线

文章位于 `content/blog/zh/` 和 `content/blog/en/`。Contentlayer 在构建时读取 MDX frontmatter 与正文，生成 `.contentlayer/generated`。生产构建先生成内容数据，再运行 `next build`；页面运行时不读取文件系统。

核心边界如下：

- `lib/content/posts.ts` 是文章和作者数据的查询入口。
- `lib/content/terms.ts` 负责分类、标签的 slug、展示 label、计数、过滤和静态参数。
- `lib/listPosts.ts` 把完整文章投影为可序列化的卡片数据。
- `lib/toc.ts` 从 Markdown 标题生成目录数据。
- `components/MDXServerRenderer.tsx` 只在文章路由的服务端边界渲染生成的 MDX 模块。
- `lib/i18n.ts` 负责语言配置、路径本地化和界面文案。

浏览器不接收或执行 Contentlayer 的 MDX runtime code。MDX 内的交互组件按正常 React 边界 hydration；列表页不通过 HTML 注入或客户端求值重建正文。

## 路由与渲染所有权

列表路由和文章路由拥有不同的 RSC 数据与页面几何。

### 列表路由

首页、分类页和标签页必须只查询、排序并渲染 `BlogListPost` 卡片数据。列表 RSC payload 不得包含正文、`mdxModulePath`、编译后 MDX code 或隐藏的文章阅读树。分页或无限加载只改变可见卡片数量，不改变文章路由身份。

卡片必须使用普通 Next.js `Link` 指向 `/{locale}/{slug}`。修改键点击、新标签页、焦点、预取和浏览器语义保持原生；列表点击不得以 sessionStorage pending motion、卡片让位或正文展开状态机作为正确性前提。捕获阶段可以为普通主键导航采集完整卡片的最小展示字段与 viewport rectangle，但不得 `preventDefault()`、克隆 DOM 或把展示快照作为导航前提。

### 文章路由

文章 RSC 必须只查询并渲染当前文章、作者信息、目录数据以及上一篇/下一篇的精简导航数据。页面首屏从返回控制、文章标题和当前文章元信息开始，不得在当前文章之前渲染其他列表卡片。

当前文章正文必须通过构建期生成的 MDX 模块和 `MDXServerRenderer` 进入静态 HTML并默认可见。刷新、直接访问、新标签页和禁用 JavaScript时都必须得到同一篇可读正文。

TOC、阅读进度、代码复制、主题、第三方 widget 和经过验证的返回行为保持为小型 client islands。`ArticleReader` 是窄客户端边界：它接收服务端已渲染的 children，保存 `<article>` DOM ref 并传给 `ReadingProgress`，同时捕获普通同文档 fragment 点击。fragment 经 `lib/articleFragment.ts` 校验后，以保留现有 Next.js history state 的 `replaceState()` 更新 URL，并即时滚动已验证目标，避免插入新的 history entry。它不导入 `Blog`、MDX 或正文数据，不变换 children，也不控制正文初始可见性。这些 islands 可以订阅浏览器状态，但不能拥有正文数据或把文章页还原成客户端列表展开状态。

## 返回与滚动

文章顶部返回控制的稳定 `href` 必须是本地化首页。只有当前标签页的普通主键列表 Link 写入一次性到达凭证，且凭证中的同源、同 locale 来源、精确文章目标和创建时间都通过验证时，普通主键点击才可使用 `history.back()` 返回该列表。凭证只保存来源 URL、目标 URL 和创建时间，不用 `history.length` 推断 history 索引；文章 hydration 仅接受当前 document time origin 之后创建的短期凭证，随后立即清除，并把验证结果限制在以文章路径区分的当前返回组件实例。停留时长不改变已经验证的实例状态。直达、刷新、外链、新标签页、过期或目标不匹配的凭证、文章间切换和未知 history 均走本地化首页；返回控制不得因错误假设离开站点。

路由滚动只有一个所有者：Next.js 与浏览器。文章导航不使用 `scroll: false`，不保存 `scrollY`，不设置延迟恢复 timer，不创建临时滚动 runway，也不在路由提交后执行位置修正。有效 Back 使用浏览器原生位置恢复，首页 fallback 使用普通 Link 导航。文章边界内的普通同文档 fragment 锚点必须验证同源 pathname、search、可解码目标 ID 和目标存在性，再以保留现有 Next.js `history.state` 的 `history.replaceState()` 更新当前文章 entry，并使用无 smooth 的 `scrollIntoView()` 定位；它不能在文章与已验证列表来源之间插入 history entry。修改键和新标签页继续使用原生行为。

## 文章卡片转场

本节是 ADR-0008 的规范性合同；是否已经落地必须以对应源代码与浏览器测试为准，不能从文档状态推断。

从完整 `PostCard` 打开文章时，App Shell 必须使用一个 fixed、结构化、`aria-hidden="true"`、`pointer-events: none` 的 React 快照，把卡片表面以及卡片上所有可见元素从实测起始 rectangle 变换到文章阅读面。`PostCard`、`ArticleCardTransitionOverlay` 与 `PostLayout` 的共享头部消费同一展示合同；快照把 surface、cover、title、Git 相对更新时间、源码入口、summary、published date、primary tag 和 read-more affordance 分别建模，不能把 metadata 压成一个字符串或 DOM 片段。快照只消费最小序列化卡片字段，不使用 `cloneNode()`、复制交互控件、文章 HTML 或 MDX。搜索结果和侧栏文章链接缺少完整卡片合同时，改用单篇文章 skeleton 快照，不拼接不完整的共享元素。

surface、cover、title、Git 信息、summary、published date 与 primary tag 是持久元素。它们在快照终点与文章共享头部中必须保持相同的元素顺序、字体、字重、行高、换行约束和目标 geometry，并按 child 分别执行 layout projection；不得用 opacity crossfade 遮掩两套标题或元信息渲染。Git 相对时间在捕获时冻结，避免过渡中因时钟或 hydration 改变文案。read-more 只属于来源卡片，在 inert 快照中保留 layout space 后平滑淡出，返回接近来源卡片时再恢复；它不会成为文章页上的可聚焦自链接。该合同是规范性目标，不能仅凭本段文档推断实现已完成。

转场覆盖层为 `z-index: 40`，Header 为 `z-index: 50`。`320px` 与 `390px` 下目标面宽度为 viewport 全宽、`top: 72px`、radius 为 `0`；`1440px` 下目标面宽 `780px`、水平居中、`top: 120px`、radius 为 `8px`。打开使用 `380 ms`，经验证的返回使用 `340 ms`，二者 easing 均为 `[0.32, 0.72, 0, 1]`。

转场不等待路由，路由也不等待转场。普通文章 Link 立即导航；返回控制立即执行已验证的 Back 或本地化 fallback Link。返回折叠只有在列表提交后能找到匹配的完整卡片和有效 rectangle 时才继续，否则立即移除覆盖层；它不能滚动列表来制造目标。缺数据、无效矩形、storage 失败、route mismatch、动画中断和 viewport resize 同样立即退化为无覆盖层的普通导航。

覆盖层不拥有正文、焦点、history 或 scroll，不锁页面滚动，不设置 `history.scrollRestoration`，不合成 `popstate`，不保存或矫正 `scrollY`。`AnimatePresence` 只能短暂保留 inert 快照，不能保留旧路由、旧卡片树或文章正文。

只有经过完整 `PostCard` 校验的打开流程，才允许在目标 pathname 提交后于卡片快照背后加入 fixed、inert、opaque 的页面 underlay。它持续到 route 与 card motion 两个 ready signal 都满足，用于阻止目标封面和目标页新增控件提前成为 topmost pixels；目标 DOM 始终挂载并保持原有语义、静态布局、focus、history 与 scroll 行为。destination-only presentation 仅限显式标记的有界文章头部控件和文章专有 metadata；只有这些头部元素可以在打开期间 `opacity: 0`，并在 handoff 后用 `180 ms` 显示。正文及其所有祖先不属于该标记合同，始终在视觉层下保持静态可见；共享 cover、title 和卡片字段禁止 opacity crossfade。直达、失败、退化、返回均不使用 underlay。reduced motion 只保留极短 snapshot 提示，随后立即显示目标 presentation，不等待 underlay 或分阶段 reveal。

## 动画边界

Motion 和 `components/animata/` 只负责有界面的视觉反馈，不负责文章数据、文章生命周期或滚动正确性。

- 正文不是 disclosure，不执行 `height: 0 -> auto`、整篇 opacity gating 或退出折叠。
- 正文静态 HTML 不依赖 hydration 或动画完成后才显示。
- 快速反馈使用 160-180 ms；标准反馈使用 200-220 ms。
- 可见位移只使用 `transform`，幅度不超过 8 px；透明度与 transform 动画不得触发布局。
- 一次交互最多有一个主要动画。已提交且没有状态变化的内容不重播入场。
- 应用级 Motion 配置使用 `reducedMotion="user"`。减弱动态效果时取消非必要位移、stagger、smooth scroll 和等待 timer，不改变内容或焦点结果。

ADR-0008 的单个卡片转场是 timing 与 displacement 的唯一例外：其 inert overlay 可使用 `380/340 ms` 和大于 `8px` 的 transform，打开 handoff 后可对显式标记的 destination-only 文章头部元素使用 `180 ms` reveal，但不能让正文 DOM、route commit、focus、scroll 或 history traversal 等待。其他控件继续使用 fast/standard 两档。

通用页面转场不得掩盖路由提交、延迟可读正文或与文章返回竞争。实验性 View Transition API 和新动画依赖不属于当前架构。

## 加载边界

Loading UI 是可选的渐进增强，必须匹配目标页面几何，不能成为静态内容可见性的前提。

本地化祖先、文章路由以及分类/标签的 index 和 detail 路由都不设置 `loading.tsx`。当前 Next.js 静态导出中的 streaming fallback 会把最终内容放在隐藏的 `S:0` segment，并依赖 JavaScript 把它替换到 `B:0` boundary；禁用 JavaScript 时客户端会停留在 loading shell。这与静态内容必须直接可见的契约冲突，因此这些路由的直达、刷新、新标签页和无脚本请求直接使用预渲染的最终 HTML。

从列表、搜索结果或侧栏文章链接进行普通主键导航时，`BlogListNavigationRecorder` 只记录来源并通知 `AppShell`。ADR-0008 要求 `AppShell` 把完整 `PostCard` 来源显示为结构化卡片快照；只有搜索或侧栏等缺少完整卡片数据与几何的来源才使用单篇阅读 skeleton。覆盖层可跨 pathname commit 完成自身的有界退出；完整卡片打开时可在 commit 后短暂增加 opaque underlay，直到 route 与 motion 都 ready。两者都不阻止 Link、不替代导航、也不控制正文 DOM 可见性。修改键点击和新标签页不会触发该覆盖层。

分类和标签的 index/detail 页面不依赖骨架显示标题、term chip 或文章卡片。搜索没有 route loading 骨架，输入后的等待状态只显示在已经渲染的结果区域。当前实现不声称每个路由都有 loading skeleton；任何新增边界都必须先验证目标几何、原始静态 HTML 和禁用 JavaScript 行为。

## 性能与安全边界

列表页只序列化卡片需要的字段，文章页只导入当前 MDX 模块。上一篇/下一篇和 TOC 数据保持精简，避免把完整文章集合传给 client islands。转场状态只能重复当前选中卡片已经拥有的最小展示字段和数值 geometry；不得为动画把正文、完整文章集合、DOM HTML 或 MDX code 带入 App Shell。

静态导出模式下，Next.js 不在运行时优化图片。主图和头像应在提交前压缩并提供稳定尺寸或宽高比，以控制 LCP 与 CLS。第三方脚本默认不进入首屏；接入时需要验证 CSP、静态构建产物和交互性能。

Cloudflare Pages CSP 不为文章渲染开放 eval。`public/_headers`、生成的 JSON-LD、分析脚本和第三方 widget 的现有例外需要单独审查，不能扩展成客户端 MDX 执行能力。

## 路由结构

默认语言是 `zh`。应用只保留显式语言路径；Cloudflare Pages redirects 把无语言前缀的历史 URL 永久跳到 `/zh/...`。

```text
/{locale}
/{locale}/{slug}
/{locale}/search
/{locale}/tags
/{locale}/tags/{tag}
/{locale}/categories
/{locale}/categories/{category}
```

所有动态内容路由通过 `generateStaticParams` 生成静态页面。

## 运行时边界

生产站点只依赖浏览器和 Cloudflare Pages 静态托管。运行时不存在文件系统读取、服务端 API、数据库或 Node.js server。搜索使用构建期 Pagefind 索引和按需加载的浏览器 runtime，不改变文章与列表的 RSC 数据边界。
