# 内容与 MDX

文章使用 MDX 编写，构建时由 Contentlayer 转换为类型化数据。

## 文章位置

中文文章：

```text
data/blog/zh/my-post.mdx
```

英文文章：

```text
data/blog/en/my-post.mdx
```

作者信息：

```text
data/authors/default.mdx
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
data/blog/zh/example.mdx
```

生成路径：

```text
/zh/blog/example
/blog/example
```

对于文件：

```text
data/blog/en/example.mdx
```

生成路径：

```text
/en/blog/example
```

默认语言是 `zh`，所以中文内容同时出现在默认根路径下。

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

文章内可用组件来自：

```text
components/MDXComponents.tsx
```

目前暴露给 MDX 的组件：

- `Image`
- `a`
- `pre`
- `table`

## 代码块

代码块由 `rehype-pretty-code` 和 Shiki 高亮：

````mdx
```bash
echo "hello"
```
````

代码块渲染后带复制按钮。

## 图片

Markdown 图片：

```mdx
![](/static/images/example.jpg)
```

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

- 数学公式
- citation/bibliography
- GitHub blockquote alert
- 内置搜索索引

如果内容需要这些能力，应先更新 Contentlayer/MDX 管线，再补充相应文档。
