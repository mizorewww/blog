---
title: 博客新功能：代码图标、源码引用、行情图表 !
date: 2026-06-22
summary: 展示这次给博客新增的代码块语言图标、inline code 主题、GitHub 源码和 diff 引用，以及 TradingView 行情图表短语法。
categories: ['折腾']
tags: ['Blog', 'Next.js', 'MDX']
language: zh
authors: ['default']
---

这次主要把博客的写作体验继续往前推了一步：代码块更容易扫读，代码引用能直接指向 GitHub，金融类内容可以用很短的语法插入 TradingView 图表。

## 先看新功能

### 代码块有语言图标

普通代码块现在也会有标题栏。左侧是语言图标，右侧仍然保留复制按钮；如果代码来自 GitHub，标题栏还会出现 GitHub 跳转入口。

```ts
const feature = '语言图标'
const theme = 'catppuccin'
console.log(feature, theme)
```

### inline code 重新做了主题

正文里的 `git log --follow`、`$AAPL`、`::tv AAPL` 不再像一块突兀的亮色贴片。明亮模式下它更接近 Catppuccin Latte 的纸面色，黑暗模式下则压进 Mocha 的低亮度底色。

### 直接引用 GitHub 代码

写作时输入：

```md
::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="251-253" lang="ts" title="contentlayer.config.ts"
```

渲染出来就是带 Shiki 高亮、语言图标和 GitHub 链接的代码块：

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="251-253" lang="ts" title="contentlayer.config.ts"

### diff 像 GitHub 一样分行染色

写作时输入：

```md
::github-diff repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="css/prism.css" lines="1-15"
```

渲染效果：

::github-diff repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="css/prism.css" lines="1-15"

### 单行 ticker 自动变成 Mini Chart

写作时单独一行输入：

```md
$AAPL
```

渲染效果：

$AAPL

### Advanced Chart 也有短语法

写作时输入：

```md
::tv AAPL interval=60 height=460
```

渲染效果：

::tv AAPL interval=60 height=460

## 代码逻辑

### 短语法先在 remark 阶段变成组件

这两个正则负责识别行情图表写法。`$AAPL` 是 Mini Chart，`::tv AAPL` 是 Advanced Chart。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="251-253" lang="ts" title="contentlayer.config.ts"

Mini Chart 的转换很克制：只有整段内容就是一个 ticker 时才会替换，避免正文里随手提到 `$AAPL` 就插入一个大图表。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="288-295" lang="ts" title="contentlayer.config.ts"

Advanced Chart 多一步解析参数。比如 `height=460`、`interval=60` 会作为 JSX attribute 传给组件。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="298-313" lang="ts" title="contentlayer.config.ts"

最后把插件挂进 Contentlayer 的 remark 链路里。这样短语法发生在 MDX 编译前，浏览器里不会再扫字符串。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="1063-1069" lang="ts" title="contentlayer.config.ts"

### TradingView 只在客户端加载

TradingView 官方 widget 需要插入外部 script，所以组件保持为 client component。渲染时先清空容器，再放入 widget 容器和配置 script；主题或参数变化时重新生成。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="components/TradingViewWidgets.tsx" lines="83-101" lang="tsx" title="components/TradingViewWidgets.tsx"

股票代码会先规范化。`AAPL` 默认映射成 `NASDAQ:AAPL`，如果你写 `NYSE:IBM` 这种完整 symbol，就不会改动。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="lib/tradingview.ts" lines="4-20" lang="ts" title="lib/tradingview.ts"

### 代码块标题栏统一增强

代码块语言图标没有在每篇文章里手写，而是在 rehype 阶段统一补。它会先找到 Shiki 生成的 `figure`，再保证有一个标题栏。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="850-868" lang="ts" title="contentlayer.config.ts"

标题栏左侧由语言图标和标题文本组成。没有显式 title 时，就回退到语言名，比如 `TypeScript`、`Diff`、`Markdown`。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="787-799" lang="ts" title="contentlayer.config.ts"

视觉上用小尺寸 badge 表达语言，不去额外引入一整套语言 logo。这样代码块有识别度，也不会把首屏 JavaScript 变重。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="css/prism.css" lines="11-17" lang="css" title="css/prism.css"

### inline code 不再抢正文注意力

inline code 这次改成了低对比度、有边界的 token。它仍然能被识别为代码，但不会像按钮一样跳出来。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="css/tailwind.css" lines="110-124" lang="css" title="css/tailwind.css"

### GitHub 代码和 diff 仍然走 Shiki

`::github-code` 和 `::github-diff` 在构建时会拉取真实代码或 diff，再生成普通 code node。也就是说它们不需要特殊渲染器，最后仍然交给 Shiki 高亮。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="543-552" lang="ts" title="contentlayer.config.ts"

diff 的路径也一样，只是数据源换成 patch，语言固定成 `diff`。

::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="555-563" lang="ts" title="contentlayer.config.ts"

这也是为什么 GitHub 引用块能同时拥有：Shiki 颜色主题、语言图标、复制按钮、GitHub 跳转和 diff 背景。

## 现在写博客的心智模型

普通文章只管写 Markdown。需要图标时写 `:icon-code:`，需要行情时写 `$AAPL` 或 `::tv AAPL`，需要引用源码时写 `::github-code`，需要引用改动时写 `::github-diff`。

构建阶段会把这些短语法转换成稳定的 MDX 组件或 Shiki 代码块；运行时只负责交互和外部 widget 加载。这样写作语法短，页面输出也可控。
