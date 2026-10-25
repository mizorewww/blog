{"title":"New Blog Features: Language Icons, Source Quotes, Tickers, and Charts","description":"Authoring features added during the old Next.js + MDX blog era—code block language icons, GitHub source and diff embeds, TradingView ticker shortcodes, and ECharts blocks—and how they work at build time.","date":"2026-06-22","tag":"Tinkering","tags":["Blog","Next.js","MDX","ECharts"]}
---

> This post was written during the old blog (Next.js + MDX) era. After migrating to the current static site, all of these features happen at build time: TradingView widgets became ticker cards that only load the live chart when you click "Live chart"; ECharts blocks became static SVG charts with hover values; source embeds are pinned commit snippets with line numbers; and language icons became corner language labels on code blocks.

This update pushes the blog's writing experience another step forward: code blocks are easier to scan, code references link straight to GitHub, and financial posts can embed TradingView charts with a tiny shortcode.

## What's New

### Language Icons on Code Blocks

A language logo and copy button float in the top-right corner of every code block—no title bar, no badge border, and no extra vertical space. When a block has a `title` or comes from GitHub, a small path line appears above the code and the GitHub link sits tucked into a small icon in the top-right corner.

```ts
const feature = 'language icons'
const theme = 'catppuccin'
console.log(feature, theme)
```

### Restyled Inline Code

Inline code in prose like `git log --follow`, `$AAPL`, and `::tv AAPL` no longer sticks out like a bright patch. In light mode it blends closer to Catppuccin Latte's paper tone, and in dark mode it settles into a low-luminance Mocha surface.

### Quoting GitHub Code Directly

When writing a post, enter:

```md
::github-code repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="contentlayer.config.ts" lines="251-253" lang="ts" title="contentlayer.config.ts"
```

It renders as a code block with Shiki syntax highlighting, a language icon, and a direct link to GitHub:

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L251-L253"
const githubEmbedPattern = /^::github-(code|diff)\s+(.+)$/
const tradingViewMiniPattern = /^\$([A-Za-z0-9._:-]+)$/
const tradingViewAdvancedPattern = /^::(?:tv|tv-advanced|tradingview)\s+(.+)$/
```

### Line-by-Line Diff Highlighting Like GitHub

When writing a post, enter:

```md
::github-diff repo="mizorewww/blog" ref="c067042276d4b4b384c66c0c61fcd4f6716eb599" path="css/prism.css" lines="1-15"
```

Rendered output:

[Changes to `css/prism.css` in c067042](https://github.com/mizorewww/blog/commit/c067042276d4b4b384c66c0c61fcd4f6716eb599)

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

### Single-Line Tickers Become Mini Charts

Put a ticker on its own line:

```md
$AAPL
$BINANCE:BTCUSDT.P
```

On the old site, each of these lines turned into a Mini Chart. The current static site doesn't load TradingView scripts upfront—instead, it renders a ticker card linking to TradingView:

::tv NASDAQ:AAPL Apple Inc.

::tv BINANCE:BTCUSDT.P Bitcoin / USDT Perpetual

### Shortcode for Advanced Charts

When writing a post, enter:

```md
::tv AAPL interval=60 height=460
```

On the old site this rendered an interactive Advanced Chart; here it is likewise a ticker card.

### Rendering ECharts Directly from Code Blocks

Use an ` ```echarts ` code block whose body is the chart's option JSON, with `title` and `height` supported in the meta string:

````md
```echarts title="Weekly Visits" height=320
{
  "tooltip": { "trigger": "axis" },
  "xAxis": {
    "type": "category",
    "data": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
  },
  "yAxis": { "type": "value" },
  "series": [
    {
      "name": "Visits",
      "type": "line",
      "smooth": true,
      "areaStyle": {},
      "data": [120, 200, 150, 80, 70, 110, 130]
    }
  ]
}
```
````

On the old site these were two ECharts instances. The current site draws the same data as static SVG at build time; since there is no pie chart type, the second example is represented as a `data` table:

```chart area title="Weekly Visits"
Day | Visits
Mon | 120
Tue | 200
Wed | 150
Thu | 80
Fri | 70
Sat | 110
Sun | 130
```

```data title="Posts by Category" bars="Share"
Category | Posts | Share
Tinkering | 40 | 40%
Dev | 32 | 32%
Notes | 18 | 18%
Other | 10 | 10%
```

If the JSON is invalid, it gracefully falls back to a regular code block instead of breaking the build. When you need functions or other options that plain JSON cannot express, you can also pass a JS object directly to the `<ECharts>` component. Charts follow the site's light/dark theme, and the `echarts` library is lazy-loaded on demand so it stays out of the initial bundle.

## How It Works Under the Hood

### Turning Shortcodes into Components in Remark

These regular expressions match the ticker chart syntax. `$AAPL` becomes a Mini Chart and `::tv AAPL` becomes an Advanced Chart.

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L251-L253"
const githubEmbedPattern = /^::github-(code|diff)\s+(.+)$/
const tradingViewMiniPattern = /^\$([A-Za-z0-9._:-]+)$/
const tradingViewAdvancedPattern = /^::(?:tv|tv-advanced|tradingview)\s+(.+)$/
```

The Mini Chart transform is intentionally conservative: it only triggers when an entire paragraph consists of a single ticker, so mentioning `$AAPL` in the middle of a sentence won't drop a giant chart into the paragraph.

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L288-L295"
function createTradingViewMiniNode(symbol: string): MdastNode | null {
  if (!isTradingViewTicker(symbol)) {
    return null
  }

  return createMdxFlowNode('TradingViewMiniChart', {
    symbol: normalizeTradingViewSymbol(symbol),
  })
```

Advanced Chart adds parameter parsing so attributes like `height=460` and `interval=60` are forwarded as JSX props.

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L298-L313"
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

Finally, the plugins are wired into Contentlayer's remark pipeline. Because shortcodes are transformed before MDX compilation, no string scanning happens in the browser.

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L1063-L1069"
export default makeSource({
  contentDirPath: 'data',
  documentTypes: [Blog, Authors],
  mdx: {
    cwd: process.cwd(),
    remarkPlugins: [remarkGfm, remarkTradingViewWidgets, remarkIconShortcodes, remarkGitHubEmbeds],
    rehypePlugins: [
```

### Loading TradingView Only on the Client

The official TradingView widget requires injecting an external `<script>`, so the component stays a client component. On render, it clears the container and inserts the widget mount node and config script; whenever the theme or props change, it rebuilds the widget.

```tsx src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/components/TradingViewWidgets.tsx#L83-L101"
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

Ticker symbols are normalized first. Bare `AAPL` defaults to `NASDAQ:AAPL`, while an explicit symbol like `NYSE:IBM` is left untouched.

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/lib/tradingview.ts#L4-L20"
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

### Enhancing Code Block Title Bars in Rehype

Language icons aren't written by hand in each post; they're injected across the board during the rehype pass. It locates the `figure` generated by Shiki and ensures a title bar exists.

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L850-L868"
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

The left side of the title bar pairs the language icon with the title text. When no explicit title is provided, it falls back to the language display name—such as `TypeScript`, `Diff`, or `Markdown`.

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L787-L799"
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

Visually, the logos come straight from `simple-icons` brand icons, tree-shaken on demand so they don't bloat first-load JavaScript; languages without a brand icon fall back to a short text badge.

```css src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/css/prism.css#L11-L17"
figure[data-rehype-pretty-code-figure] .code-title-main {
  @apply inline-flex min-w-0 items-center gap-2;
}

figure[data-rehype-pretty-code-figure] .code-language-icon {
  @apply inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] border border-slate-300 bg-slate-100 px-1 font-sans text-[0.62rem] leading-none font-semibold text-slate-600 dark:border-white/15 dark:bg-white/10 dark:text-white/70;
}
```

### Keeping Inline Code from Stealing Attention

Inline code now uses a low-contrast, subtly bordered token style. It's still unmistakably code, without popping out of the paragraph like a button.

```css src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/css/tailwind.css#L110-L124"
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

### GitHub Code and Diffs Still Go Through Shiki

At build time, `::github-code` and `::github-diff` fetch the real source file or diff and emit a standard code AST node. That means they don't need a custom renderer—Shiki highlights them just like any other code block.

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L543-L552"
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

Diffs follow the exact same path, except the data source is a patch and the language defaults to `diff`.

```ts src="https://github.com/mizorewww/blog/blob/c067042276d4b4b384c66c0c61fcd4f6716eb599/contentlayer.config.ts#L555-L563"
const value = selectCodeLines(await getGitHubDiff(attrs), attrs.lines)
const title =
  attrs.title ||
  `${normalizeGitHubRepo(attrs.repo)}:${attrs.path || `${attrs.base || attrs.ref}...${attrs.head || ''}`}`

return createCodeNode(value || 'No diff matched this query.', attrs.lang || 'diff', title, {
  showLineNumbers: true,
  sourceUrl: getGitHubDiffUrl(attrs),
})
```

That's why GitHub embeds get the Shiki color theme, language icon, copy button, GitHub link, and diff line backgrounds all at once.

## The Mental Model for Writing Posts

For normal posts, you just write Markdown. When you want an icon, write `:icon-code:`; for a market ticker, write `$AAPL` or `::tv AAPL`; for a data chart, write an ` ```echarts ` block; to quote source code, write `::github-code`; and to quote a commit diff, write `::github-diff`.

The build step turns these shortcodes into stable MDX components or Shiki code blocks, while the runtime only handles interactivity and external widgets. The authoring syntax stays brief, and the rendered page stays predictable.
