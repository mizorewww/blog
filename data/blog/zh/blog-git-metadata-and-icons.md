---
title: 给博客加上 Git 元信息和图标短写
date: 2026-06-22
summary: 记录这次给博客添加编辑时间、相关提交、源码链接、构建 hash、版权声明和图标短写的过程。
categories: ['折腾']
tags: ['Blog', 'Next.js', 'MDX']
language: zh
authors: ['default']
---

这次给博客补了一组偏“基础设施”的功能：文章不只展示正文，也会展示这篇内容在 Git 历史里的位置。

现在打开任意文章，标题下方会出现这些信息：

- :icon-clock: 最近更新时间，以及距离现在多久
- :icon-git-commit: 与文章文件相关的提交 hash 和 commit message
- :icon-code: 指向 GitHub 上对应 Markdown 源文的链接

博客底部也会显示当前构建使用的 commit hash。这样看到线上页面时，可以直接知道它对应仓库里的哪一次构建。

## 文章头部的 Git 信息

每篇文章都会在构建时读取对应 Markdown 文件的 Git 历史。展示逻辑是：

1. 取文件最近一次 commit 作为“更新于”时间。
2. 展示最近几次相关提交。
3. 每条提交同时显示短 hash 和 commit message。
4. 源文链接固定到最近一次提交，避免以后文件移动或内容变化导致链接指向不稳定。

这部分不是手写 frontmatter，所以更新文章之后不需要额外维护 `lastmod`。只要提交进 Git，页面上的信息就会跟着更新。

## Footer 的构建 hash

页面 footer 现在会显示 :icon-git-commit: `commit <hash>`。

这个 hash 来自构建时的 HEAD。如果部署环境提供 `VERCEL_GIT_COMMIT_SHA`，会优先使用部署平台给出的值；否则就从本地 Git 里读取。

这个小信息很适合排查问题：如果线上样式和本地不一致，先看 footer 的 hash，就能确认线上到底跑的是哪一次构建。

## 版权声明自动追加

每篇文章正文末尾都会追加版权声明：

> 除另有说明，本文内容采用 CC BY-NC-SA 4.0 协议许可。

它不是写进 Markdown 的固定内容，而是由文章组件统一渲染。这样修改授权文案时只需要改一处，历史文章也会同步更新。

## 文章里快捷输入图标

这次还接入了 `lucide-react`，并给 MDX 加了一个短写语法。

在文章里直接写：

```md
:icon-clock: 更新
:icon-git-commit: 提交
:icon-code: 源码
:icon-tag: 标签
```

会渲染成：

:icon-clock: 更新

:icon-git-commit: 提交

:icon-code: 源码

:icon-tag: 标签

如果需要更明确地指定图标，也可以直接用组件：

```mdx
<Icon name="ExternalLink" /> 外部链接
<Icon name="History" /> 历史记录
```

实际效果：

<Icon name="ExternalLink" /> 外部链接

<Icon name="History" /> 历史记录

短写会在构建时转换成 `Icon` 组件，不是在浏览器里扫正文字符串。因此它不会影响代码块，也不会在客户端做额外解析。

## 引用 GitHub 上的代码

文章现在也可以在构建时引用 GitHub 上的代码片段。写法是：

```md
::github-code repo="mizorewww/blog" ref="ee81d7f3ba7b99694fe57d9697e5fa47d5b6ab96" path="data/blog/zh/xiaomi-book-pro-14.md" lines="1-14" lang="md"
```

实际效果：

::github-code repo="mizorewww/blog" ref="ee81d7f3ba7b99694fe57d9697e5fa47d5b6ab96" path="data/blog/zh/xiaomi-book-pro-14.md" lines="1-14" lang="md"

它会在 Contentlayer 构建阶段拉取内容，然后变成普通 Markdown code fence，所以仍然走 Shiki 高亮。

## 展示 GitHub diff

diff 也可以直接嵌入文章：

```md
::github-diff repo="mizorewww/blog" base="949bd13a24acb074f84ac66238f920359317bd34" head="ee81d7f3ba7b99694fe57d9697e5fa47d5b6ab96" path="data/blog/zh/xiaomi-book-pro-14.md"
```

实际效果：

::github-diff repo="mizorewww/blog" base="949bd13a24acb074f84ac66238f920359317bd34" head="ee81d7f3ba7b99694fe57d9697e5fa47d5b6ab96" path="data/blog/zh/xiaomi-book-pro-14.md"

这个功能适合写变更记录、源码讲解和问题排查文章。读者可以直接看到代码改了什么，而不是只看到一个 commit 链接。

## 图标库和性能

一开始为了让博客里可以按名字动态写图标，我用了整套 `lucide-react` 的 namespace import。它写起来最舒服，但代价也明显：客户端 bundle 会变大。

更平衡的做法有几种：

1. 页面 UI 里固定用到的图标，直接按需 import，例如 `import { Clock } from 'lucide-react'`。
2. MDX 文章里的短写图标，可以在构建阶段统计用到的名字，生成一个小的 icon registry。
3. 如果确实需要任意图标名，就只在文章页加载动态 registry，别让全站公共入口都带上整套图标。
4. 也可以把图标短写在构建期渲染成静态 SVG，这样浏览器端完全不需要图标库。

现在这版优先选了“写作方便”。如果以后文章图标用得多，再把动态 registry 改成构建期生成，会更适合长期使用。

## 现在的写作体验

这次改完之后，一篇文章从 Markdown 到页面大概是这样：

- 写正文时，用 `:icon-name:` 快速插入图标。
- 构建时，Contentlayer 把图标短写转成 MDX 组件。
- 构建时，GitHub 代码和 diff 短写会被拉取并转成 Shiki 高亮代码块。
- 构建时，Contentlayer 读取文章文件的 Git 历史。
- 页面渲染时，文章卡片显示更新时间、提交记录、源文链接。
- 正文末尾自动显示授权声明。
- 全站 footer 显示当前构建 hash。

这些信息都不算复杂，但组合起来之后，博客会更像一个能追踪来源的内容系统，而不只是几篇静态 Markdown。
