---
status: active
audience: both
authority: guide
owner: codex-agent
last_verified: 2026-07-10
verified_by: command
related_code:
  - app/theme-providers.tsx
  - app/[locale]/categories/loading.tsx
  - app/[locale]/tags/loading.tsx
  - components/AppShell.tsx
  - components/PostCard.tsx
  - components/ArticleReturnLink.tsx
  - components/BlogListNavigationRecorder.tsx
  - components/ArticleReader.tsx
  - components/ReadingProgress.tsx
  - components/ArticleTableOfContents.tsx
  - components/PostNavLinks.tsx
  - components/ThemeSwitch.tsx
  - components/animata/ArticleRouteSkeleton.tsx
  - components/animata/BlogRouteSkeleton.tsx
  - components/animata/CollapsiblePanel.tsx
  - components/animata/motion.ts
  - lib/articleFragment.ts
  - app/[locale]/[...slug]/page.tsx
  - layouts/PostLayout.tsx
  - css/tailwind.css
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

本指南记录当前 UI 动效契约和后续变更的验收标准，不是历史修复清单。文章路由、返回与滚动所有权以 [ADR-0007](../adr/ADR-0007-route-first-article-reading.md) 为准。文章正文已经从列表卡片展开状态中移出，通用页面转场和长文展开/收起动画已经删除。

## 核心原则

- 动效用于说明真实状态变化，不用于掩盖路由提交或重复播放已经完成的内容。
- 一次交互最多有一个主要动画。辅助反馈不能与主要动画争夺注意力。
- 布局先稳定，再添加反馈。图片、卡片、工具栏、TOC 和固定按钮使用明确尺寸、宽高比或响应式约束。
- 可见动画优先使用 `transform` 和 `opacity`。不得用 `height`、`width`、`top` 或大范围 layout animation 驱动长文或整页移动。
- 正文在静态 HTML 中默认可见，不做高度展开、透明度揭示或退出折叠。

## 时间与位移

只有两个常用时间档：

- Fast：160-180 ms，用于按钮、图标、hover、focus 和小型状态反馈。
- Standard：200-220 ms，用于路由反馈、菜单、短 disclosure 和有限的内容切换。

默认位移不超过 8 px。超过 220 ms、连续 stagger 或大范围位移需要新的架构理由，不能作为局部美化直接加入。持续滚动反馈如 reading progress 可以直接绑定 motion value，但不能用追赶式 CSS duration 制造滞后。

## 文章阅读

- 列表卡片使用普通 Next.js `Link`，不把点击改造成列表内展开命令。
- 文章页只显示当前文章、TOC 与相邻文章导航。
- 正文及其祖先不使用 `height: 0 -> auto`、整篇 opacity gating 或 `AnimatePresence` exit。
- 可选入场只作用于标题、封面或小型控件，使用 opacity/transform，并在 220 ms 内结束；正文阅读不等待该效果。
- `ArticleReader` 保留文章 DOM ref，让 `ReadingProgress` 按文章自身区间计算进度；它还捕获经 `lib/articleFragment.ts` 校验的普通同文档 fragment，使用保留现有 history state 的 `replaceState()` 和即时滚动，避免新增 history entry。它接收服务端渲染的 children，不导入正文数据，也不控制正文显示或动画。
- 返回控制位于文章顶部。无法证明上一条 history entry 是同源列表时，使用本地化首页链接。
- 浏览器与 Next.js 负责滚动。动效层不保存 scrollY、不延迟恢复、不在路由提交后矫正位置。

## 小型交互

短 TOC、提交记录和菜单可以使用 disclosure 动效，但需要稳定的触发按钮、`aria-expanded`、可识别的内容关系和 reduced-motion 等价行为。ThemeSwitch、复制反馈、active indicator 与 BackToTop 使用 fast 档，不与路由主动画同时 stagger。

hover 和 focus 只能改变阴影、边框、颜色、opacity 或小范围 transform，不得改变控件占位尺寸。图标按钮使用稳定的点击区域和 tooltip/accessible name；文本必须在 320 px 宽度下不与相邻控件重叠。

## 路由加载

Loading UI 必须匹配目标路由，但当前实现并不为每个 route 提供 skeleton：

- 本地化祖先和文章路由不设置 `loading.tsx`。Next.js 静态导出的 streaming loading 边界会在禁用 JavaScript 时让最终文章保持隐藏，因此静态文章 HTML 直接承担直达、刷新和无脚本阅读。
- 列表、搜索结果和侧栏中的普通文章 Link 会触发 `AppShell` 的 `ArticleRouteSkeleton` 覆盖层；它只持续到 pathname 提交，不阻止 Link，也不参与正文显示。
- 分类/标签嵌套路由保留列表几何的 `BlogRouteSkeleton`。搜索静态外壳没有 route skeleton，查询等待只在结果区域内显示。

骨架只存在于 pending navigation。修改键、新标签页和直达请求不触发文章覆盖层；内容提交后不再播放 loading 入场，也不能先显示三栏卡片再突然替换为单篇文章或 term index。

## Reduced Motion

应用级 `MotionConfig` 使用 `reducedMotion="user"`。用户要求减弱动态效果时：

- 移除非必要 transform、stagger 和 spring overshoot。
- 不启用 smooth scroll。
- 不保留为动画准备的 timeout 或延迟卸载。
- opacity 反馈可以保留为极短、不阻塞的状态提示，但正文与焦点立即到达最终状态。

## 验证矩阵

UI 或动效变更至少验证以下视口：

| 视口       | 重点                                                     |
| ---------- | -------------------------------------------------------- |
| `320x720`  | Header、语言切换、返回控制、长标题、按钮文字和横向溢出   |
| `390x844`  | 移动文章首屏、TOC、阅读控件、列表返回和原生滚动恢复      |
| `1440x900` | 阅读栏宽度、TOC、列表/文章几何差异、首屏信息层级和稳定性 |

每个视口覆盖浅色、深色、正常动态效果和 reduced motion。文章流程覆盖列表进入、浏览器 Back、顶部返回、直达、刷新和新标签页。

浏览器检查同时记录交互早期帧、动画结束帧和 250 ms 后稳定帧。验收条件是没有 UI 重叠、长文布局补间、二次滚动、骨架错型或 hydration 后正文闪现；只检查最终截图或最终 URL 不足以通过。
