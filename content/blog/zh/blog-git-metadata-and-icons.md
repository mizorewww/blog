---
title: 博客新功能：语言图标、源码引用、行情与图表 !
date: 2026-06-22
summary: 展示这次给博客新增的代码块语言图标、inline code 主题、GitHub 源码和 diff 引用、TradingView 行情图表短语法，以及 Apache ECharts 图表。
categories: ['折腾']
tags: ['Blog', 'Next.js', 'MDX', 'ECharts']
language: zh
authors: ['default']
---

这次主要把博客的写作体验继续往前推了一步：代码块更容易扫读，代码引用能直接指向 GitHub，金融类内容可以用很短的语法插入 TradingView 图表。

## 先看新功能

### 代码块有语言图标

代码块右上角一直浮着语言 logo 和复制按钮，没有标题栏、没有徽章边框，不占额外空间。写了 `title` 或者代码来自 GitHub 时，代码上方只会多一行小字路径，GitHub 跳转入口收进右上角的一个小图标里。

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
$BINANCE:BTCUSDT.P
```

渲染效果：

$AAPL

$BINANCE:BTCUSDT.P

### Advanced Chart 也有短语法

写作时输入：

```md
::tv AAPL interval=60 height=460
```

渲染效果：

::tv AAPL interval=60 height=460

### 代码块直接渲染 ECharts

写文章时用 ` ```echarts ` 代码块，内容是图表的 option JSON,meta 支持 `title` 和 `height`:

````md
```echarts title="每周访问量" height=320
{
  "tooltip": { "trigger": "axis" },
  "xAxis": {
    "type": "category",
    "data": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
  },
  "yAxis": { "type": "value" },
  "series": [
    {
      "name": "访问量",
      "type": "line",
      "smooth": true,
      "areaStyle": {},
      "data": [120, 200, 150, 80, 70, 110, 130]
    }
  ]
}
```
````

渲染效果：

```echarts title="每周访问量" height=320
{
  "tooltip": { "trigger": "axis" },
  "xAxis": {
    "type": "category",
    "data": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
  },
  "yAxis": { "type": "value" },
  "series": [
    {
      "name": "访问量",
      "type": "line",
      "smooth": true,
      "areaStyle": {},
      "data": [120, 200, 150, 80, 70, 110, 130]
    }
  ]
}
```

```echarts title="文章分类占比" height=360
{
  "tooltip": { "trigger": "item" },
  "legend": { "bottom": 0 },
  "series": [
    {
      "name": "分类",
      "type": "pie",
      "radius": ["40%", "70%"],
      "itemStyle": { "borderRadius": 6, "borderWidth": 2 },
      "label": { "show": false },
      "data": [
        { "value": 40, "name": "折腾" },
        { "value": 32, "name": "开发" },
        { "value": 18, "name": "笔记" },
        { "value": 10, "name": "其他" }
      ]
    }
  ]
}
```

JSON 不合法时会回退成普通代码块，不会把构建搞挂。需要函数等 JSON 表达不了的配置时，也可以直接用 `<ECharts>` 组件传 JS 对象。图表跟随站点明暗主题，echarts 库按需懒加载，不进首屏包。

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

视觉上 logo 直接来自 simple-icons 的品牌图标，按需 tree-shake，不会把首屏 JavaScript 变重；没有品牌图标的语言才回退到简短的文字标注。

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

普通文章只管写 Markdown。需要图标时写 `:icon-code:`，需要行情时写 `$AAPL` 或 `::tv AAPL`，需要数据图表时写 ` ```echarts ` 代码块，需要引用源码时写 `::github-code`，需要引用改动时写 `::github-diff`。

构建阶段会把这些短语法转换成稳定的 MDX 组件或 Shiki 代码块；运行时只负责交互和外部 widget 加载。这样写作语法短，页面输出也可控。
