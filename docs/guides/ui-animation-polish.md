---
status: active
audience: both
authority: guide
owner: codex-agent
last_verified: 2026-07-11
verified_by: command
related_code:
  - app/theme-providers.tsx
  - app/[locale]/categories/page.tsx
  - app/[locale]/categories/[category]/page.tsx
  - app/[locale]/tags/page.tsx
  - app/[locale]/tags/[tag]/page.tsx
  - components/AppShell.tsx
  - components/ArticleTransitionContext.tsx
  - components/Header.tsx
  - components/HeaderNavLinks.tsx
  - components/PostCard.tsx
  - components/ArticleReturnLink.tsx
  - components/BlogListNavigationRecorder.tsx
  - components/ArticleReader.tsx
  - components/ReadingProgress.tsx
  - components/ArticleTableOfContents.tsx
  - components/PostNavLinks.tsx
  - components/ThemeSwitch.tsx
  - components/animata/ArticleCardTransitionOverlay.tsx
  - components/animata/ArticleRouteSkeleton.tsx
  - components/animata/CollapsiblePanel.tsx
  - components/animata/motion.ts
  - lib/articleFragment.ts
  - lib/articleTransition.ts
  - app/[locale]/[...slug]/page.tsx
  - layouts/PostLayout.tsx
  - css/tailwind.css
  - tests/e2e/article-card-transition.spec.ts
  - tests/e2e/term-routes.spec.ts
  - tests/unit/articleTransition.test.ts
update_when:
  - animation timing or easing changes
  - route loading geometry changes
  - reduced-motion behavior changes
  - article or list interaction changes
  - responsive validation matrix changes
supersedes:
superseded_by:
---

# UI 与动效规范

本指南记录 UI 动效合同和变更验收标准，不是历史修复清单。文章路由、返回与滚动所有权以 [ADR-0007](../adr/ADR-0007-route-first-article-reading.md) 为准，App Store 风格卡片转场以 [ADR-0008](../adr/ADR-0008-app-store-article-card-transition.md) 为准。文章正文已经从列表卡片展开状态中移出；视觉上可以由卡片引导到独立文章页，但正文不会回到列表 disclosure。

## 核心原则

- 动效用于说明真实状态变化，不用于掩盖路由提交或重复播放已经完成的内容。
- 一次交互最多有一个主要动画。辅助反馈不能与主要动画争夺注意力。
- 布局先稳定，再添加反馈。图片、卡片、工具栏、TOC 和固定按钮使用明确尺寸、宽高比或响应式约束。
- 可见动画优先使用 `transform` 和 `opacity`。不得用 `height`、`width`、`top` 或大范围 layout animation 驱动长文或整页移动。ADR-0008 的 fixed inert snapshot 是大范围 transform 的唯一例外。
- 正文在静态 HTML 中默认可见，不做高度展开、透明度揭示或退出折叠。

## 时间与位移

只有两个常用时间档：

- Fast：160-180 ms，用于按钮、图标、hover、focus 和小型状态反馈。
- Standard：200-220 ms，用于路由反馈、菜单、短 disclosure 和有限的内容切换。

默认位移不超过 8 px。文章卡片打开 `380 ms`、经验证返回 `340 ms`，easing 均为 `[0.32, 0.72, 0, 1]`；这是 ADR-0008 已批准的唯一额外时间档与大位移。其他超过 220 ms、连续 stagger 或大范围位移仍需要新的架构理由，不能作为局部美化直接加入。持续滚动反馈如 reading progress 可以直接绑定 motion value，但不能用追赶式 CSS duration 制造滞后。

## 文章阅读

- 列表卡片使用普通 Next.js `Link`，不把点击改造成列表内展开命令。
- 文章页只显示当前文章、TOC 与相邻文章导航。
- 正文及其祖先不使用 `height: 0 -> auto`、整篇 opacity gating 或 `AnimatePresence` exit。
- 可选入场只作用于标题、封面或小型控件，使用 opacity/transform，并在 220 ms 内结束；正文阅读不等待该效果。
- `ArticleReader` 保留文章 DOM ref，让 `ReadingProgress` 按文章自身区间计算进度；它还捕获经 `lib/articleFragment.ts` 校验的普通同文档 fragment，使用保留现有 history state 的 `replaceState()` 和即时滚动，避免新增 history entry。它接收服务端渲染的 children，不导入正文数据，也不控制正文显示或动画。
- 返回控制位于文章顶部。无法证明上一条 history entry 是同源列表时，使用本地化首页链接。
- 浏览器与 Next.js 负责滚动。动效层不保存 scrollY、不延迟恢复、不在路由提交后矫正位置。

## App Store 卡片转场

以下为规范性目标合同；实现状态以源代码和浏览器测试为准。

- 完整 `PostCard` 的普通主键 Link 可以启动唯一主要动画。`PostCard`、`ArticleCardTransitionOverlay` 和 `PostLayout` 的共享头部使用同一展示合同；结构化 React snapshot 分别重绘 surface、cover、title、Git 相对更新时间、源码入口、summary、published date、primary tag 和 read-more affordance，不能把 metadata 扁平化。snapshot 必须 fixed、`aria-hidden="true"`、`pointer-events: none`，不得 `cloneNode()` 或复制正文 DOM。
- surface、cover、title、Git 信息、summary、date 与 tag 必须逐 child 投影到文章共享头部。overlay 最终帧与文章头部保持相同的顺序、字体、字重、行高、换行约束和 geometry，不用 opacity crossfade 交接两套标题或持久信息。Git 相对时间在捕获时冻结，过渡期间不随时钟或 hydration 改写。
- read-more 是来源卡片专有的视觉提示。它在 inert snapshot 中保留 layout space 并平滑淡出，返回接近来源卡片时平滑恢复；文章页不渲染可聚焦的自链接。其他在首页卡片上出现的元素不得在 route handoff 时骤然消失。
- 搜索结果和侧栏链接没有完整卡片数据与 rectangle 时，只显示目标文章形状的 skeleton snapshot。不得把零散标题或缩略图伪装成完整 shared card。
- Link 始终立即执行，observer 不 `preventDefault()`。route commit 不等 `380 ms`；返回控制也立即执行已验证 Back 或 fallback Link，不等 `340 ms`。真实正文不做 height/opacity gating。
- Header 为 `z-index: 50`，snapshot overlay 为 `z-index: 40`。覆盖层不接收 focus/pointer，不锁 body scroll，也不改变页面 layout。
- `320px` 与 `390px` 的目标面为 viewport 全宽、`top: 72px`、radius `0`。`1440px` 下宽 `780px`、水平居中、`top: 120px`、radius `8px`。
- 返回时只有同标签页来源已验证、列表 route 已提交、且匹配的完整卡片 rectangle 可用，才从阅读面收回到卡片。找不到目标时直接移除 snapshot，不自动滚动列表。
- capture 数据缺失、rectangle 无效、storage 异常、route mismatch、交互中断或 viewport resize 都必须立即移除 snapshot，以普通 Link/history 结果为准。
- `AnimatePresence` 只能保留退出中的 inert snapshot，不能保留旧 route tree、旧 PostCard 控件、文章正文或独立 scroll container。

## 小型交互

短 TOC、提交记录和菜单可以使用 disclosure 动效，但需要稳定的触发按钮、`aria-expanded`、可识别的内容关系和 reduced-motion 等价行为。ThemeSwitch、复制反馈、active indicator 与 BackToTop 使用 fast 档，不与路由主动画同时 stagger。

hover 和 focus 只能改变阴影、边框、颜色、opacity 或小范围 transform，不得改变控件占位尺寸。图标按钮使用稳定的点击区域和 tooltip/accessible name；文本必须在 320 px 宽度下不与相邻控件重叠。

## 移动 Header

- `<640px` 使用 `Menu`/`X` 图标按钮控制普通 primary navigation disclosure。触发器固定为 `44x44px`，提供随状态变化的 accessible name、`aria-expanded` 和 `aria-controls`。
- `Escape` 关闭面板并把焦点还给触发器；路由 pathname 变化、进入 `>=640px` 断点或点击 Header 外部都会关闭面板。
- 面板打开时，文章滚动隐藏逻辑不得隐藏 Header，确保触发器和导航始终可见。
- `>=640px` 保留既有桌面导航布局和 Motion active underline，不渲染移动 disclosure。
- 移动面板直接挂载，不播放入场或退出动画。它使用普通 `<nav>` 与链接语义，不使用 `role="menu"`、focus trap 或页面 scroll lock。

## 路由加载

Loading UI 必须匹配目标路由，但当前实现并不为每个 route 提供 skeleton：

- 本地化祖先、文章路由以及分类/标签的 index/detail 不设置 `loading.tsx`。Next.js 静态导出的 streaming fallback 会在禁用 JavaScript 时让最终内容留在隐藏 segment，因此这些页面由预渲染 HTML 直接承担直达、刷新和无脚本阅读。
- ADR-0008 的目标合同用完整 card snapshot 处理 `PostCard` 来源；搜索结果和侧栏中的普通文章 Link 才使用 `ArticleRouteSkeleton` 几何。它不阻止 Link，也不参与正文显示。
- 分类/标签页面不依赖骨架显示标题、term chip 与文章卡片。搜索静态外壳没有 route skeleton，查询等待只在结果区域内显示。

修改键、新标签页和直达请求不触发文章覆盖层。snapshot 可以跨 pathname commit 完成自身的有界 exit，但内容提交后真实文章立即可读；不能先显示三栏卡片、遮住正文等待动画结束，再突然替换为单篇文章或 term index。

## Reduced Motion

应用级 `MotionConfig` 使用 `reducedMotion="user"`。用户要求减弱动态效果时：

- 移除非必要 transform、stagger 和 spring overshoot。
- App Store 卡片 snapshot 不执行大范围位移或缩放；最多保留极短且不阻塞的 opacity 提示。
- 不启用 smooth scroll。
- 不保留为动画准备的 timeout 或延迟卸载。
- opacity 反馈可以保留为极短、不阻塞的状态提示，但正文与焦点立即到达最终状态。

## 验证矩阵

UI 或动效变更至少验证以下视口：

| 视口       | 重点                                                      |
| ---------- | --------------------------------------------------------- |
| `320x720`  | Header、全宽 `top:72/radius:0` snapshot、长标题与横向溢出 |
| `390x844`  | 全宽卡片 morph、TOC、列表返回、退化路径和原生滚动恢复     |
| `1440x900` | `780px/top:120/radius:8` 阅读面、卡片目标和 Header 层级   |

每个视口覆盖浅色、深色、正常动态效果和 reduced motion。文章流程覆盖完整 PostCard、搜索与侧栏来源，列表进入、浏览器 Back、顶部返回、直达、刷新和新标签页，以及 resize、缺目标、route mismatch 与快速重复操作。term 流程覆盖 zh/en 的 index/detail 直达、无脚本可见性以及 Header -> index -> chip -> detail 导航。

浏览器检查普通微动效的早期帧、220 ms 结束帧和 250 ms 稳定帧；文章打开记录起点、约 190 ms、380 ms 和 450 ms，返回记录起点、约 170 ms、340 ms 和 420 ms。验收条件是 route/Back 可先于动画结束提交，snapshot 始终 fixed/inert，Header 位于 overlay 上方；逐 child 检查 title、Git 信息、summary、date 与 tag 的 typography、顺序、换行和 rectangle 在交接帧一致，并确认 read-more 保留占位平滑退出。页面不得出现 opacity 标题交接、单帧消失、UI 重叠、长文布局补间、二次滚动、骨架错型或 hydration 后正文闪现；只检查最终截图或最终 URL 不足以通过。
