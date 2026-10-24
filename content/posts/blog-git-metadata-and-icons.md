{"title":"博客新功能：语言图标、源码引用、行情与图表","description":"旧博客（Next.js + MDX）时期加的写作功能：代码块语言图标、GitHub 源码与 diff 引用、TradingView 行情短语法和 ECharts 图表，以及它们在构建时的实现。","date":"2026-06-22","tag":"折腾"}
---

> 这篇写于旧博客（Next.js + MDX）时期。迁移到现在的静态站后，需要浏览器脚本的演示（TradingView、ECharts）改成了链接和数据表格，源码引用改成固定 commit 的代码片段，语言图标和复制按钮没有保留。

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

[`contentlayer.config.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L251-L253)

```ts
const githubEmbedPattern = /^::github-(code|diff)\s+(.+)$/
const tradingViewMiniPattern = /^\$([A-Za-z0-9._:-]+)$/
const tradingViewAdvancedPattern = /^::(?:tv|tv-advanced|tradingview)\s+(.+)$/
```

### diff 像 GitHub 一样分行染色

写作时输入：

```md
::github-diff repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="css/prism.css" lines="1-15"
```

渲染效果：

[`css/prism.css` 在 c067042 中的改动](https://github.com/mizorewww/blog/commit/c067042276d4b4b384c66c0c61fcd4f6716eb599)

```diff
@@ -8,6 +8,44 @@ figure[data-rehype-pretty-code-figure] [data-rehype-pretty-code-title] {
   @apply flex items-center justify-between gap-3 border-b border-slate-200 bg-white/70 px-4 py-2 text-xs text-slate-600 dark:border-[#405064] dark:bg-white/[0.035] dark:text-white/65;
 }
 
+figure[data-rehype-pretty-code-figure] .code-title-main {
+  @apply inline-flex min-w-0 items-center gap-2;
+}
+
+figure[data-rehype-pretty-code-figure] .code-language-icon {
+  @apply inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] border border-slate-300 bg-slate-100 px-1 font-sans text-[0.62rem] leading-none font-semibold text-slate-600 dark:border-white/15 dark:bg-white/10 dark:text-white/70;
+}
+
+figure[data-rehype-pretty-code-figure] .code-language-icon[data-code-language='ts'],
+figure[data-rehype-pretty-code-figure] .code-language-icon[data-code-language='tsx'] {
+  @apply border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-200;
```

### 单行 ticker 自动变成 Mini Chart

写作时单独一行输入：

```md
$AAPL
$BINANCE:BTCUSDT.P
```

旧站上这两行会各变成一张 Mini Chart。现在的静态站不加载 TradingView 脚本，只保留链接：[AAPL](https://www.tradingview.com/symbols/NASDAQ-AAPL/)、[BINANCE:BTCUSDT.P](https://www.tradingview.com/symbols/BTCUSDT.P/?exchange=BINANCE)。

### Advanced Chart 也有短语法

写作时输入：

```md
::tv AAPL interval=60 height=460
```

旧站上这里是一张可交互的 Advanced Chart，现在改为链接：[在 TradingView 打开 AAPL 1 小时图](https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL&interval=60)。

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

旧站上这里是两张 ECharts 图。现在的站点不运行图表脚本，同样的数据写成 `data` 表格：

```data title="每周访问量" bars="访问量"
日期 | 访问量
周一 | 120
周二 | 200
周三 | 150
周四 | 80
周五 | 70
周六 | 110
周日 | 130
```

```data title="文章分类占比" bars="占比"
分类 | 篇数 | 占比
折腾 | 40 | 40%
开发 | 32 | 32%
笔记 | 18 | 18%
其他 | 10 | 10%
```

JSON 不合法时会回退成普通代码块，不会把构建搞挂。需要函数等 JSON 表达不了的配置时，也可以直接用 `<ECharts>` 组件传 JS 对象。图表跟随站点明暗主题，echarts 库按需懒加载，不进首屏包。

## 代码逻辑

### 短语法先在 remark 阶段变成组件

这两个正则负责识别行情图表写法。`$AAPL` 是 Mini Chart，`::tv AAPL` 是 Advanced Chart。

[`contentlayer.config.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L251-L253)

```ts
const githubEmbedPattern = /^::github-(code|diff)\s+(.+)$/
const tradingViewMiniPattern = /^\$([A-Za-z0-9._:-]+)$/
const tradingViewAdvancedPattern = /^::(?:tv|tv-advanced|tradingview)\s+(.+)$/
```

Mini Chart 的转换很克制：只有整段内容就是一个 ticker 时才会替换，避免正文里随手提到 `$AAPL` 就插入一个大图表。

[`contentlayer.config.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L288-L295)

```ts
function createTradingViewMiniNode(symbol: string): MdastNode | null {
  if (!isTradingViewTicker(symbol)) {
    return null
  }

  return createMdxFlowNode('TradingViewMiniChart', {
    symbol: normalizeTradingViewSymbol(symbol),
  })
```

Advanced Chart 多一步解析参数。比如 `height=460`、`interval=60` 会作为 JSX attribute 传给组件。

[`contentlayer.config.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L298-L313)

```ts
function createTradingViewAdvancedNode(source: string): MdastNode | null {
  const [rawSymbol, ...attrParts] = source.trim().split(/\s+/)

  if (!rawSymbol || !isTradingViewTicker(rawSymbol)) {
    return null
  }

  const attrs = parseEmbedAttributes(attrParts.join(' ')) as TradingViewAttrs

  return createMdxFlowNode('TradingViewAdvancedChart', {
    height: attrs.height,
    interval: attrs.interval,
    locale: attrs.locale,
    symbol: normalizeTradingViewSymbol(rawSymbol),
    timezone: attrs.timezone,
  })
```

最后把插件挂进 Contentlayer 的 remark 链路里。这样短语法发生在 MDX 编译前，浏览器里不会再扫字符串。

[`contentlayer.config.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L1063-L1069)

```ts
export default makeSource({
  contentDirPath: 'data',
  documentTypes: [Blog, Authors],
  mdx: {
    cwd: process.cwd(),
    remarkPlugins: [remarkGfm, remarkTradingViewWidgets, remarkIconShortcodes, remarkGitHubEmbeds],
    rehypePlugins: [
```

### TradingView 只在客户端加载

TradingView 官方 widget 需要插入外部 script，所以组件保持为 client component。渲染时先清空容器，再放入 widget 容器和配置 script；主题或参数变化时重新生成。

[`components/TradingViewWidgets.tsx`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/components/TradingViewWidgets.tsx#L83-L101)

```tsx
useEffect(() => {
  const container = containerRef.current

  if (!container) {
    return
  }

  container.innerHTML = '<div class="tradingview-widget-container__widget"></div>'

  const script = document.createElement('script')
  script.async = true
  script.src = scriptSrc
  script.text = JSON.stringify(config)
  container.appendChild(script)

  return () => {
    container.innerHTML = ''
  }
}, [config, scriptSrc])
```

股票代码会先规范化。`AAPL` 默认映射成 `NASDAQ:AAPL`，如果你写 `NYSE:IBM` 这种完整 symbol，就不会改动。

[`lib/tradingview.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/lib/tradingview.ts#L4-L20)

```ts
export function normalizeTradingViewSymbol(value: string, defaultExchange = 'NASDAQ') {
  const symbol = value.trim().replace(/^\$/, '').toUpperCase()

  if (!symbol) {
    return ''
  }

  if (explicitTradingViewSymbolPattern.test(symbol)) {
    return symbol
  }

  if (plainTickerPattern.test(symbol)) {
    return `${defaultExchange}:${symbol}`
  }

  return symbol
}
```

### 代码块标题栏统一增强

代码块语言图标没有在每篇文章里手写，而是在 rehype 阶段统一补。它会先找到 Shiki 生成的 `figure`，再保证有一个标题栏。

[`contentlayer.config.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L850-L868)

```ts
function enhanceCodeTitle(node: HastNode) {
  if (
    node.tagName !== 'figure' ||
    node.properties?.['data-rehype-pretty-code-figure'] === undefined
  ) {
    return
  }

  const title = ensureCodeTitle(node)
  const code = findDescendantElement(node, 'code')
  const sourceUrl = typeof code?.data?.githubSourceUrl === 'string' ? code.data.githubSourceUrl : ''
  const language = getCodeLanguage(code)
  const titleText = getNodeText(title) || getLanguageName(language)

  title.children = [createCodeTitleNode(titleText, language)]

  if (sourceUrl) {
    title.children.push(createCodeSourceLinkNode(sourceUrl, language))
  }
```

标题栏左侧由语言图标和标题文本组成。没有显式 title 时，就回退到语言名，比如 `TypeScript`、`Diff`、`Markdown`。

[`contentlayer.config.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L787-L799)

```ts
function createCodeTitleNode(titleText: string, language: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['code-title-main'] },
    children: [
      createCodeLanguageIconNode(language),
      {
        type: 'element',
        tagName: 'span',
        properties: { className: ['code-title-text'] },
        children: [{ type: 'text', value: titleText || getLanguageName(language) }],
      },
```

视觉上 logo 直接来自 simple-icons 的品牌图标，按需 tree-shake，不会把首屏 JavaScript 变重；没有品牌图标的语言才回退到简短的文字标注。

[`css/prism.css`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/css/prism.css#L11-L17)

```css
figure[data-rehype-pretty-code-figure] .code-title-main {
  @apply inline-flex min-w-0 items-center gap-2;
}

figure[data-rehype-pretty-code-figure] .code-language-icon {
  @apply inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] border border-slate-300 bg-slate-100 px-1 font-sans text-[0.62rem] leading-none font-semibold text-slate-600 dark:border-white/15 dark:bg-white/10 dark:text-white/70;
}
```

### inline code 不再抢正文注意力

inline code 这次改成了低对比度、有边界的 token。它仍然能被识别为代码，但不会像按钮一样跳出来。

[`css/tailwind.css`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/css/tailwind.css#L110-L124)

```css
& :where(code):not(pre code) {
  border: 1px solid color-mix(in oklab, var(--color-slate-300) 72%, transparent);
  border-radius: 6px;
  background: linear-gradient(
    to bottom,
    color-mix(in oklab, white 92%, var(--color-slate-100)),
    color-mix(in oklab, var(--color-slate-100) 88%, white)
  );
  box-shadow: inset 0 -1px 0 color-mix(in oklab, var(--color-slate-300) 45%, transparent);
  color: #4c4f69;
  padding: 0.08rem 0.34rem;
  font-size: 0.86em;
  font-weight: 500;
  line-height: 1.75;
  word-break: break-word;
```

### GitHub 代码和 diff 仍然走 Shiki

`::github-code` 和 `::github-diff` 在构建时会拉取真实代码或 diff，再生成普通 code node。也就是说它们不需要特殊渲染器，最后仍然交给 Shiki 高亮。

[`contentlayer.config.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L543-L552)

```ts
if (kind === 'code') {
  const value = selectCodeLines(await getGitHubFile(attrs), attrs.lines)
  const title =
    attrs.title ||
    `${normalizeGitHubRepo(attrs.repo)}:${attrs.path}${attrs.lines ? `#L${attrs.lines}` : ''}`

  return createCodeNode(value, attrs.lang || 'text', title, {
    showLineNumbers: true,
    sourceUrl: getGitHubCodeUrl(attrs),
  })
```

diff 的路径也一样，只是数据源换成 patch，语言固定成 `diff`。

[`contentlayer.config.ts`](https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L555-L563)

```ts
const value = selectCodeLines(await getGitHubDiff(attrs), attrs.lines)
const title =
  attrs.title ||
  `${normalizeGitHubRepo(attrs.repo)}:${attrs.path || `${attrs.base || attrs.ref}...${attrs.head || ''}`}`

return createCodeNode(value || 'No diff matched this query.', attrs.lang || 'diff', title, {
  showLineNumbers: true,
  sourceUrl: getGitHubDiffUrl(attrs),
})
```

这也是为什么 GitHub 引用块能同时拥有：Shiki 颜色主题、语言图标、复制按钮、GitHub 跳转和 diff 背景。

## 现在写博客的心智模型

普通文章只管写 Markdown。需要图标时写 `:icon-code:`，需要行情时写 `$AAPL` 或 `::tv AAPL`，需要数据图表时写 ` ```echarts ` 代码块，需要引用源码时写 `::github-code`，需要引用改动时写 `::github-diff`。

构建阶段会把这些短语法转换成稳定的 MDX 组件或 Shiki 代码块；运行时只负责交互和外部 widget 加载。这样写作语法短，页面输出也可控。
