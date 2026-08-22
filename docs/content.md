# 内容与 MDX

文章使用 MDX 编写，构建时由 Contentlayer 转换为类型化数据。

## 文章位置

中文文章按主题子目录存放，文件名仍是 slug 的最后一段：

```text
content/blog/zh/折腾/xiaomi-book-pro-14.md
content/blog/zh/技术/making-memoh-cheaper-on-telegram.md
```

英文文章同样嵌套：

```text
content/blog/en/折腾/xiaomi-book-pro-14.md
```

根目录平铺文件仍然可用，但新文章应放进主题文件夹。`yarn write-blog create --folder 折腾` 会写入 `content/blog/{locale}/{folder}/{slug}.md`。

Obsidian 通过仓库外的 vault 符号链接编辑同一棵目录，不把 vault 文件提交进 Git：

```bash
ln -sfn /Users/aac6fef/Developer/blog/content/blog "/Users/aac6fef/Documents/Obsidian Vault/06_Blog"
```

Templater 模板在 vault 的 `99_Resources/Templater/Blog.md`。slug 只使用不含扩展名的 basename：`yarn write-blog`、Templater 和 Contentlayer `blogSlug` 都会去掉末尾误带的 `.md` / `.mdx`，Templater 创建笔记时不得再把 `.md` 写进文件名，以免生成 `post.md.md`。已存在的双后缀文件仍映射到不含扩展名的公开 URL，不要靠改文件名来“修复”未提交草稿。可选的本机插件符号链接：

```bash
ln -sfn /Users/aac6fef/Developer/obsidian-plugin-myblog "/Users/aac6fef/Documents/Obsidian Vault/.obsidian/plugins/myblog"
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
content/blog/zh/折腾/xiaomi-book-pro-14.md
```

生成路径：

```text
/zh/折腾/xiaomi-book-pro-14
```

公开 slug 不含文件扩展名。若 flattenedPath 因双后缀文件变成 `折腾/use-grok-bot.md`，`blogSlug` 仍会收成 `折腾/use-grok-bot`。

对于文件：

```text
content/blog/en/折腾/xiaomi-book-pro-14.md
```

生成路径：

```text
/en/折腾/xiaomi-book-pro-14
```

默认语言是 `zh`。无语言前缀的历史路径由 Cloudflare Pages redirects 跳转到 `/zh/...`。旧的平铺文章 URL 再 301 到主题路径，例如 `/zh/xiaomi-book-pro-14` → `/zh/折腾/xiaomi-book-pro-14/`。`/blog/xiaomi-book-pro-14` 先经现有 splat 到 `/zh/xiaomi-book-pro-14`，再跳到新路径。

没有 `/{locale}/folders/...` 列表路由。文件夹只出现在右侧内容树里，行本身只负责展开/折叠，文章叶子是普通 `Link`。

| 旧 URL                                  | 新 URL                                       |
| --------------------------------------- | -------------------------------------------- |
| `/zh/blog-git-metadata-and-icons/`      | `/zh/技术/blog-git-metadata-and-icons/`      |
| `/zh/kde-plasma-obsdian-web-clipper/`   | `/zh/折腾/kde-plasma-obsdian-web-clipper/`   |
| `/zh/making-memoh-cheaper-on-telegram/` | `/zh/技术/making-memoh-cheaper-on-telegram/` |
| `/zh/xiaomi-book-pro-14/`               | `/zh/折腾/xiaomi-book-pro-14/`               |
| `/en/xiaomi-book-pro-14/`               | `/en/折腾/xiaomi-book-pro-14/`               |

文章移进主题目录后，Git 元数据仍要跟到平铺旧路径：`git log --follow` 看当前文件，候选路径再补 `content/blog/{locale}/{slug}.md` 和更早的 `data/blog/` 位置。这样相关提交在 rename 提交前后都还能列出来。

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

## 正文排版合同

文章正文由 `article-prose` 作用域统一承载。文章页正文相关外边缘按层走同一条阅读 rail：文字类 block（标题、段落、列表、引用、details、脚注、license notice、文章详情和上下篇导航）与 `article-content-rail` 对齐，在 `1024px` 及以上左缘为 surface 左缘加 gutter；`pre`、Shiki figure、图片 figure 和行间 MathJax 在 surface 内 breakout 到 `calc(100% - 2 * gutter)`；表格使用 `fit-content` 紧凑尺寸并左对齐，仅在超出 breakout 上限时容器内横向滚动。普通段落、标题、列表、引用、脚注、details、kbd、abbr、mark、sub/sup 等 inline 和 block family 必须保持页面级无横向滚动；真正二维的代码块、表格和行间 MathJax 只能在自身容器内横向滚动，并需要保留可见横向滚动边缘提示。

`1024px` 及以上的桌面文章页是三列：`TOC | surface | tree`。正文 rail 在 surface 内贴左对齐（左缘 = surface 左缘 + gutter），surface 占据居中 `article-shell` 减去两侧各 `256px + 36px` 后的中间栏。左侧 TOC 和右侧内容树都是辅助 chrome，不参与 rail 对齐计算。`1023px` 及以下继续使用单列阅读布局和折叠 TOC，文章树隐藏。

正文阅读宽度按语言调节：英文文章使用较窄的长文 measure，rail 上限 `49rem`；中文文章略宽，rail 上限 `56rem`，避免英文桌面行长过长或中文桌面断行过碎。普通正文在移动端不低于 16px，并用紧凑但可读的行高；标题层级按 h2-h6 递减，不用孤立装饰替代结构。

inline code 使用正文专用语义 token。暗色模式下 inline code 必须是暗色 surface，不得沿用浅色 gradient 或浅色文字；链接里的 code 继承同一 surface/border，仅改变链接前景色。Shiki fenced code 仍由代码块组件和高亮主题控制，不套用 inline code 的 border、padding 或背景规则。

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

代码块渲染后会在代码上方显示一行安静的工具区：左侧是语言 logo 或文字标注，右侧是 GitHub 源码链接和复制按钮。代码内容保留内部横向滚动，320px 宽度下控件不得覆盖第一行代码。复制失败时页面会提示手动选择代码。

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

可运行的示例见文章 `content/blog/zh/技术/blog-git-metadata-and-icons.md` 的「代码块直接渲染 ECharts」一节。

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
- 行间公式在窄屏下可以在公式自身区域横向滚动；页面根部不应因此出现横向滚动。行内公式仍按正文流排版。

## 图片

Markdown 图片：

```mdx
![图片说明](/static/images/example.jpg)
```

Markdown 图片会渲染为带 `loading="lazy"` 和 `decoding="async"` 的原生 `img`，并继承文章正文的圆角和细 outline。内容图片必须写有意义的 alt；只有纯装饰图片才使用空 alt。Markdown 图片 title 会显示为 caption。

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
