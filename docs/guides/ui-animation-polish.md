---
status: active
audience: both
authority: guide
owner: codex-agent
last_verified: 2026-07-05
verified_by: agent review
related_code:
  - components/ui/styles.ts
  - css/tailwind.css
  - components/animata
  - components/ExpandablePostCard.tsx
  - components/SearchPageClient.tsx
  - components/ReadingProgress.tsx
  - components/BackToTop.tsx
  - components/ThemeSwitch.tsx
  - components/SidebarTOC.tsx
  - components/TableOfContents.tsx
  - components/PostNavLinks.tsx
  - components/CodeBlock.tsx
  - components/TermIndexView.tsx
  - components/Footer.tsx
  - components/Header.tsx
  - components/HeaderNavLinks.tsx
  - components/social-icons/index.tsx
  - app/not-found.tsx
  - app/[locale]/not-found.tsx
update_when:
  - design token system changes
  - animation system changes
  - card/widget styling changes
  - color palette changes
  - transition timing changes
supersedes:
superseded_by:
---

# UI / 动画美化指南

本指南记录 mizore-blog 的 UI 与动画审查结果,以及分批优化计划。每批优化完成后,对应章节标记 ✅。

## 一、设计系统层面的问题

### 1.1 卡片样式分裂 — 两套 token 无统一 hover

当前有两套卡片 token:

- `cardClass`(文章卡片、搜索结果、PostNavLinks、搜索输入、移动 TOC):`shadow-[0_14px_36px_rgba(21,30,43,0.07)]`,无 border/ring
- `widgetCardClass`(侧边栏 widget):`shadow-[0_6px_18px_rgba(21,30,43,0.045)] ring-1 ring-slate-200/70`

问题:

- `cardClass` 在深色模式下 `dark:shadow-none` 且无 ring — 卡片只靠 `bg-surface-card-dark (#252d38)` 与页面 `bg-surface-page-dark (#181c27)` 的微弱色差区分,边界几乎不可见
- hover 阴影临时硬编码:`hover:shadow-[0_18px_44px_rgba(21,30,43,0.1)]` 在搜索结果和 PostNavLinks 各写一遍
- 全站 4 种不同阴影值 + 3 种不同 rgba 基色,无 shadow scale token

建议:

```css
@theme {
  --shadow-card: 0 2px 8px rgba(21, 30, 43, 0.06), 0 1px 2px rgba(21, 30, 43, 0.04);
  --shadow-card-hover: 0 12px 32px rgba(21, 30, 43, 0.1), 0 2px 4px rgba(21, 30, 43, 0.06);
}
```

统一 `cardClass` 深色模式用 `dark:ring-1 dark:ring-white/10`(和 `widgetCardClass` 一致)。

### 1.2 gray vs slate 混用

| 文件                   | 当前用法                                                                 | 应改为                                  |
| ---------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| LanguageSwitcher.tsx   | `text-gray-600 dark:text-gray-300`                                       | `text-slate-600 dark:text-white/80`     |
| social-icons/index.tsx | `text-gray-700 dark:text-gray-200`                                       | `text-slate-700 dark:text-white/80`     |
| Footer.tsx             | `text-gray-500`                                                          | `text-slate-500`                        |
| TermIndexView.tsx      | `text-gray-900/600/300`, `divide-gray-200/700`, `dark:text-gray-100/300` | 全改 `slate-*`                          |
| css/tailwind.css L256  | `.footnotes border-gray-200 dark:border-gray-700`                        | `border-slate-200 dark:border-white/10` |
| not-found.tsx ×2       | `text-gray-900 dark:text-gray-100`                                       | `text-slate-900 dark:text-white/90`     |

`@theme` 定义了 `--color-gray-*`(oklch)覆盖 Tailwind 默认 gray,但 slate 未被覆盖。全站应统一到 slate。

### 1.3 圆角不统一

当前:`rounded-[8px]`(卡片)、`rounded-[10px]`(badge)、`rounded-[6px]`(commit badge / code copy)、`rounded-full`(头像/BackToTop)、`rounded`(无值)。

建议:定义 3 级圆角 token — `sm=6px`(按钮/badge)、`md=8px`(卡片/widget)、`full=9999px`(头像/FAB)。

### 1.4 过渡动画不统一

CSS transition 散落各处,无统一时长/缓动:

- `transition-shadow`(PostNavLinks,搜索结果)— 默认 150ms
- `transition-colors`(TOC,nav links)— 默认 150ms
- `transition-[width] duration-75`(ReadingProgress)— 75ms 太快,抖动
- animata Motion 库(`animataDuration=0.48s`, `animataEase=[0.22,1,0.36,1]`)

建议:所有 CSS `transition-*` 统一 `duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]`(与 animataEase 对齐)。

## 二、动画系统问题

### 2.1 ReadingProgress 用手动 scroll listener,应改用 Motion useScroll

当前:`addEventListener('scroll')` + `requestAnimationFrame` + `transition-[width] duration-75`。

问题:75ms CSS transition 在快速滚动时跳帧。手动 scroll listener 不如 Motion `useScroll` + `useSpring` 平滑。

建议:

```tsx
import { useScroll, useSpring, useTransform, motion } from 'motion/react'

const { scrollYProgress } = useScroll({ target: targetRef, offset: ['start 96px', 'end end'] })
const width = useSpring(useTransform(scrollYProgress, [0, 1], ['0%', '100%']), {
  stiffness: 400,
  damping: 40,
})
return (
  <motion.div
    style={{ width }}
    className="fixed top-0 left-0 z-[55] h-1 origin-left bg-sky-500 dark:bg-sky-400"
  />
)
```

### 2.2 BackToTop 应改用 Motion useScroll

当前:`addEventListener('scroll')` + 手动判断 `scrollY > 420`。

建议:

```tsx
import { useScroll, useMotionValueEvent } from 'motion/react'
const { scrollY } = useScroll()
useMotionValueEvent(scrollY, 'change', (y) => setVisible(y > 420))
```

### 2.3 搜索结果无入场动画

当前搜索结果直接 map 渲染,无 AnimatePresence / stagger。

建议:用 Motion `AnimatePresence` + stagger 变体,结果列表交错入场,搜索切换时有退出动画。

### 2.4 PostNavLinks 无入场动画

文章展开后上一篇/下一篇卡片直接出现。建议用 Motion stagger(可复用 MenuList/MenuListItem 模式)。

### 2.5 SidebarTOC 激活指示器无动画

当前 activeId 变化时 border-sky-500 + text-sky-700 瞬切。建议用 Motion `layoutId` 做平滑滑动指示器。

### 2.6 Header nav active 下划线无动画

当前 CSS underline 瞬切。建议用 `layoutId` 共享布局动画让下划线在 nav 项间平滑滑动。

### 2.7 ThemeSwitch 图标切换无动画

当前 Sun/Moon 直接条件渲染瞬切。建议用 `AnimatePresence` 交叉淡入 + 旋转。

### 2.8 CodeBlock 复制反馈不够好

当前按钮文字从"复制"变"已复制"。建议引入 `sonner` 库(18k+ stars,MIT)做 toast 通知。

## 三、组件级 UI 问题

### 3.1 文章卡片深色模式边界不可见

`cardClass` 深色模式 `dark:shadow-none` 无 ring — 卡片与页面背景色差极小。建议加 `dark:ring-1 dark:ring-white/10`。

### 3.2 文章卡片无 card-level hover 反馈

collapsed 状态 hover 只有 cover HoverScale 和标题 color change,卡片本身无 shadow/border 变化。建议加 `transition-shadow hover:shadow-card-hover`(仅 collapsed)。

### 3.3 搜索加载用 animate-pulse 而非项目 Skeleton

项目有 `Skeleton` 组件(带 shimmer),搜索加载态应复用,保持全站 loading 一致。

### 3.4 搜索输入框无 focus 态视觉反馈

建议 `focus-within:ring-2 focus-within:ring-sky-500/30`。

### 3.5 TermIndexView 样式脱离设计系统

分类 chip 用 `bg-white` 无 rounded token 无 transition;标签 `# label` + 独立 count 链接视觉断裂。建议重新设计为 chip 样式。

### 3.6 404 页面按钮无过渡

`bg-sky-700 hover:bg-sky-800` 无 transition-colors。

### 3.7 Footer 社交图标 hover 不统一

图标无容器,hover 仅颜色。建议每个图标包 `rounded-full p-2 transition-colors hover:bg-slate-100 dark:hover:bg-white/10`。

## 四、库引入建议

| 库                                                  | Stars  | 用途                                               | 必要性                         |
| --------------------------------------------------- | ------ | -------------------------------------------------- | ------------------------------ |
| Motion useScroll/useSpring/layoutId/AnimatePresence | 已安装 | 替代手动 scroll listener / 列表入场 / 共享布局动画 | **高** — 已有库,只需用更多 API |
| sonner                                              | ~18k   | Toast 通知(CodeBlock 复制反馈)                     | 中 — 提升 UX 一致性            |
| react-wrap-balancer                                 | ~4k    | 标题平衡换行                                       | 低 — 锦上添花                  |

核心结论:不需要引入新库即可覆盖绝大部分动画需求(Motion 已安装)。`sonner` 是唯一值得引入的新库。

## 五、优先级与执行批次

### Batch 9 — P0 设计系统基础

- [x] `cardClass` 加 `dark:ring-1 dark:ring-white/10`
- [x] 全站 `gray-*` → `slate-*` 统一(6+ 文件机械替换)
- [x] 文章卡片深色模式边界修复(同 cardClass)

### Batch 10 — P1 核心动画升级(Motion 已有 API)

- [x] ReadingProgress → Motion `useScroll` + `useSpring`
- [x] BackToTop → Motion `useScroll` + `useMotionValueEvent`
- [x] 搜索结果 → `AnimatePresence` + stagger
- [x] ThemeSwitch → `AnimatePresence` 图标交叉动画
- [x] 搜索加载 → 用 `Skeleton` 组件
- [x] 搜索输入 → focus-within ring

### Batch 11 — P2 交互细节打磨

- [x] SidebarTOC → `layoutId` 激活指示器滑动
- [x] Header nav → `layoutId` 下划线滑动
- [x] PostNavLinks → Motion stagger 入场
- [x] 文章卡片 collapsed hover shadow
- [x] CSS transition token 统一(`duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]`)

### Batch 12 — P3 收尾

- [x] TermIndexView 重新设计
- [x] 404 按钮 transition
- [x] Footer 社交图标容器化
- [x] `sonner` toast 引入 + CodeBlock 复制反馈
- [x] 圆角/shadow token(如需要)
