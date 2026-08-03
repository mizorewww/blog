# 内容与 MDX

文章使用 MDX 编写，构建时由 Contentlayer 转换为类型化数据。

## 文章位置

中文文章：

```text
content/blog/zh/my-post.mdx
```

英文文章：

```text
content/blog/en/my-post.mdx
```

作者信息：

```text
content/authors/default.mdx
```

图片资源：

```text
public/static/images/
```

## Frontmatter

示例：

```mdx
---
title: 文章标题
date: 2026-05-10
summary: 摘要
categories: ['折腾']
tags: ['Linux', 'Laptop']
language: zh
translationKey: stable-id-for-translations
authors: ['default']
image: /static/images/example.jpg
draft: false
---
```

字段说明：

| 字段             | 必填 | 说明                         |
| ---------------- | ---- | ---------------------------- |
| `title`          | 是   | 文章标题                     |
| `date`           | 是   | 发布日期                     |
| `summary`        | 否   | 摘要，用于卡片、SEO 和 RSS   |
| `categories`     | 否   | 分类列表                     |
| `tags`           | 否   | 标签列表                     |
| `language`       | 否   | 文章语言，建议与目录保持一致 |
| `translationKey` | 否   | 多语言文章的关联键           |
| `authors`        | 否   | 作者 ID 列表                 |
| `image`          | 否   | 文章主图                     |
| `draft`          | 否   | 生产环境隐藏草稿             |
| `canonicalUrl`   | 否   | 外部 canonical URL           |

## 路由生成

对于文件：

```text
content/blog/zh/example.mdx
```

生成路径：

```text
/zh/example
```

对于文件：

```text
content/blog/en/example.mdx
```

生成路径：

```text
/en/example
```

默认语言是 `zh`。无语言前缀的历史路径由 Cloudflare Pages redirects 跳转到 `/zh/...`。

分类和标签的路由片段由原始 term 生成 slug，例如 `Next.js` 生成 `nextjs`。页面展示、aria 文案、metadata 和 JSON-LD 保留 frontmatter 中的原始 term。

## 支持的 MDX 能力

当前 MDX 管线支持：

- 标准 Markdown
- GFM 表格、任务列表等语法
- MDX JSX 组件
- 代码块高亮
- 行内代码
- heading slug
- heading anchor
- 自动 TOC 数据抽取
- 普通 Markdown 图片
- 表格横向滚动包装
- ECharts 图表
- 数学公式

文章内可用组件来自：

```text
components/MDXComponents.tsx
```

目前暴露给 MDX 的组件：

- `Image`
- `a`
- `img`
- `pre`
- `table`
- `Icon`
- `ECharts`
- `TradingViewMiniChart`
- `TradingViewAdvancedChart`

## 图标

文章里可以用 lucide 图标 shortcode：

```mdx
:icon-code:
:icon-git-branch:
:icon-rocket:
```

shortcode 会在构建期转换成 `<Icon name="..." />`。图标名来自 `lucide-react`，支持 kebab-case、snake_case 和 PascalCase；常用别名在 `lib/iconAliases.ts`。

为了避免把整套 lucide 图标打进首屏包，仓库会生成一个只包含已使用图标的 registry：

```bash
yarn icons:generate
```

`yarn build` 和 pre-commit hook 会自动执行生成；CI 使用 `yarn icons:check` 防止生成文件过期。

## 代码块

代码块由 `rehype-pretty-code` 和 Shiki 高亮：

````mdx
```bash
echo "hello"
```
````

代码块渲染后右上角常显复制按钮和语言 logo（来自 simple-icons，无徽章边框；没有品牌图标的语言回退为简短文字标注），不渲染标题栏。写了 `title="文件名"` 或 `sourceUrl="..."` 的代码块，会在代码上方多一行小字路径，GitHub 源码链接收进右上角图标。

## ECharts 图表

文章里可以直接渲染 [Apache ECharts](https://echarts.apache.org/) 图表，支持明暗主题跟随和自适应宽度。图表库按需懒加载，不进入首屏包。

推荐写法是使用 ` ```echarts ` 代码块，内容为图表的 option JSON；代码块 meta 支持 `title`（标题栏文字）和 `height`(像素高度，默认 360):

````mdx
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

注意事项：

- 代码块内容必须是合法的 JSON 对象（双引号、无注释、无尾随逗号),option 字段完整参考 [ECharts 配置项文档](https://echarts.apache.org/option.html)。
- JSON 不合法时不会构建失败，而是回退渲染为普通的 `echarts` 代码块，方便排查。
- `backgroundColor` 默认注入为 `transparent`,可以在 option 里覆盖。

需要写函数等 JSON 表达不了的配置时，可以改用 MDX 组件直接传 JS 对象：

```mdx
<ECharts
  title="柱状图"
  height={300}
  option={{
    xAxis: { type: 'category', data: ['Q1', 'Q2', 'Q3', 'Q4'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [23, 45, 31, 58] }],
  }}
/>
```

可运行的示例见文章 `content/blog/zh/blog-git-metadata-and-icons.md` 的「代码块直接渲染 ECharts」一节。

## 数学公式

公式用 LaTeX 语法书写，构建时由 remark-math 解析、MathJax 渲染成内联 SVG，不加载任何客户端脚本或字体。

行间公式把 `$$...$$` 单独成段：

```mdx
$$
C_{\mathrm{call}} = T \times P_{\mathrm{in}}
$$
```

行内公式把 `$$...$$` 写在同一行内：

```mdx
其中 $$f(h) = (1-h) + h \times r$$ 是缓存因子。
```

单个 `$` 保持字面值，不会被当作公式定界符，所以 `$AAPL` ticker shortcode 和 `$0.5` 这类货币文本不受影响。

注意事项：

- LaTeX 语法错误不会导致构建失败，公式位置会渲染出带错误说明的标记，写完应目视检查页面。

## 图片

Markdown 图片：

```mdx
![](/static/images/example.jpg)
```

Markdown 图片会渲染为带 `loading="lazy"` 和 `decoding="async"` 的原生 `img`。

需要更精细控制时，可以使用 MDX 组件：

```mdx
<Image src="/static/images/example.jpg" alt="Example" width={1200} height={800} />
```

## RSS

RSS 在构建后生成：

```text
/feed.xml
/tags/{tag}/feed.xml
/{locale}/tags/{tag}/feed.xml
```

RSS 生成脚本：

```text
scripts/rss.mjs
```

## 非内置能力

这些能力不属于当前 MDX 管线：

- citation/bibliography
- GitHub blockquote alert
- 内置搜索索引

如果内容需要这些能力，应先更新 Contentlayer/MDX 管线，再补充相应文档。
