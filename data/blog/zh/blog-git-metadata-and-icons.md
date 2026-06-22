---
title: 给博客加上 Git 元信息和图标短写
date: 2026-06-22
summary: 记录这次给博客添加编辑时间、相关提交、源码链接、构建 hash、版权声明、图标短写、GitHub 代码引用和 Shiki 主题的实现。
categories: ['折腾']
tags: ['Blog', 'Next.js', 'MDX']
language: zh
authors: ['default']
---

这次改动的核心目标是把博客文章和 Git 历史接起来：读者看到一篇文章时，不只看到正文，还能看到这篇文章最近什么时候被改过、由哪些 commit 改过、源码在哪里，以及当前页面来自哪一次构建。

下面引用的代码都来自这次实现提交：

`43a2ef8e733191f98f417daf69026406bbe562f7`

代码块标题栏和 diff 背景的后续优化来自：

`9c3711f19fed98004a96649e7622ed58027cc821`

## 文章头部的 Git 信息

文章卡片会在标题下面显示最近更新时间、相对时间、源文链接，以及相关 commit。UI 上没有再套一张额外卡片，而是作为文章元信息自然排在标题和摘要之间。

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="components/ExpandablePostCard.tsx" lines="180-279" lang="tsx" title="components/ExpandablePostCard.tsx"

这里的关键点是：

- `gitUpdatedAt`、`gitCommits`、`githubUrl` 都来自 Contentlayer 的 computed fields。
- 每个 commit 同时展示短 hash 和 commit message。
- 图标和文字用 `inline-flex` / `gap` 对齐，避免图标贴字或基线漂移。
- commit message 在窄屏下会自动换行，不挤压 hash。

## 构建时读取 Git 历史

Git 信息不是写在 frontmatter 里的。构建时，Contentlayer 会对每篇文章对应的 Markdown 文件执行 `git log --follow`，把结果写入文章数据。

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="contentlayer.config.ts" lines="87-156" lang="ts" title="contentlayer.config.ts"

这样做的好处是维护成本低：文章只要正常提交到 Git，页面上的“更新于”和“相关提交”就会跟着变。源文链接也固定到最近一次 commit，而不是浮动的 `main`，避免以后文件移动或内容变化导致链接不稳定。

## Footer 显示构建 hash

footer 里的 `commit <hash>` 来自构建时的 HEAD。部署平台如果提供 `VERCEL_GIT_COMMIT_SHA`，就优先用平台值；本地构建时则回退到 `git rev-parse HEAD`。

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="next.config.js" lines="1-34" lang="js" title="next.config.js"

渲染时只读取公开环境变量，并把 hash 链到 GitHub commit 页面：

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="components/Footer.tsx" lines="5-41" lang="tsx" title="components/Footer.tsx"

这个信息很适合排查部署问题。线上页面如果样式或内容不对，先看 footer 的 hash，就能知道线上到底跑的是哪一次构建。

## 文章末尾的授权声明

版权声明没有写进每篇 Markdown，而是由文章组件统一追加。这样文案或协议需要调整时，只改组件，不需要批量改历史文章。

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="components/ExpandablePostCard.tsx" lines="282-311" lang="tsx" title="components/ExpandablePostCard.tsx"

当前文案使用的是 `CC BY-NC-SA 4.0`。如果以后有单篇文章需要不同协议，再额外加 frontmatter 覆盖会更合适。

## 图标短写

正文里可以直接写：

```md
:icon-clock: 更新
:icon-git-commit: 提交
:icon-code: 源码
:icon-tag: 标签
```

渲染效果：

:icon-clock: 更新

:icon-git-commit: 提交

:icon-code: 源码

:icon-tag: 标签

短写是在 Contentlayer 的 remark 阶段转成 MDX `Icon` 组件的，不是在浏览器里扫字符串。

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="contentlayer.config.ts" lines="167-230" lang="ts" title="contentlayer.config.ts"

图标组件本身没有再 `import * as lucide`，而是通过一个显式 registry 保留常用图标。这样文章仍然可以写 `:icon-name:`，客户端 bundle 不会因为任意图标名把整套图标库都带进去。

## GitHub 代码引用

文章现在支持直接引用 GitHub 上的代码。写法是：

```md
::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="data/codeThemes.ts" lines="10-35" lang="ts" title="data/codeThemes.ts"
```

实际效果：

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="data/codeThemes.ts" lines="10-35" lang="ts" title="data/codeThemes.ts"

GitHub 引用块的标题栏右侧会显示 GitHub 图标和“在 GitHub 查看代码”。点击后会跳到这段代码所在的 commit 和行号，而不是跳到浮动的 `main`。

源码 URL 在构建时生成：

::github-code repo="mizorewww/blog" ref="9c3711f19fed98004a96649e7622ed58027cc821" path="contentlayer.config.ts" lines="276-313" lang="ts" title="contentlayer.config.ts"

然后跟随 code node 的 meta 一起进入 rehype 流程：

::github-code repo="mizorewww/blog" ref="9c3711f19fed98004a96649e7622ed58027cc821" path="contentlayer.config.ts" lines="417-467" lang="ts" title="contentlayer.config.ts"

这段逻辑做了几件事：

- `repo` 默认指向当前博客仓库，也可以显式指定别的 GitHub 仓库。
- 当前仓库优先用本地 `git show` 读取，构建更快，也避免网络波动。
- 外部仓库用 `raw.githubusercontent.com` 拉取。
- `lines` 会在构建时截取代码行。
- `sourceUrl` 会在构建时生成，指向 GitHub 上的 blob 或 commit 页面。
- 最终生成的是普通 Markdown code node，所以仍然由 Shiki 高亮。

最后，rehype 插件会把 `sourceUrl` 从 meta 里取出来，转换成标题栏右侧的 GitHub 链接：

::github-code repo="mizorewww/blog" ref="9c3711f19fed98004a96649e7622ed58027cc821" path="contentlayer.config.ts" lines="514-543,596-667" lang="ts" title="contentlayer.config.ts"

## GitHub diff 视图

diff 也可以引用 GitHub commit。这里展示的是这次把代码块样式改成 Shiki 主题面板的 diff：

```md
::github-diff repo="mizorewww/blog" ref="9c3711f19fed98004a96649e7622ed58027cc821" path="css/prism.css"
```

实际效果：

::github-diff repo="mizorewww/blog" ref="9c3711f19fed98004a96649e7622ed58027cc821" path="css/prism.css"

为了让 diff 不只是“带颜色的纯文本”，我在 rehype 阶段给每一行补了 metadata：普通代码行标 `data-code-line`，diff 行额外标 `data-diff-line="add|remove|hunk|meta"`。

::github-code repo="mizorewww/blog" ref="9c3711f19fed98004a96649e7622ed58027cc821" path="contentlayer.config.ts" lines="554-699" lang="ts" title="contentlayer.config.ts"

CSS 再根据这些属性给加行、删行、hunk 和元信息行做背景区分。这里用了更接近 GitHub 的整行背景：添加行是绿色，删除行是红色，hunk 是蓝色。

::github-code repo="mizorewww/blog" ref="9c3711f19fed98004a96649e7622ed58027cc821" path="css/prism.css" lines="63-125" lang="css" title="css/prism.css"

标题栏里的 GitHub 链接样式也在同一个 CSS 文件里：

::github-code repo="mizorewww/blog" ref="9c3711f19fed98004a96649e7622ed58027cc821" path="css/prism.css" lines="7-25" lang="css" title="css/prism.css"

## Shiki 主题配置

Shiki 主题不应该散落在 `contentlayer.config.ts` 里，所以我把主题组合抽到了单独配置文件。默认使用 Catppuccin：light mode 是 `catppuccin-latte`，dark mode 是 `catppuccin-mocha`。

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="data/codeThemes.ts" lines="1-89" lang="ts" title="data/codeThemes.ts"

Contentlayer 只负责读取配置并传给 `rehype-pretty-code`：

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="contentlayer.config.ts" lines="20-35" lang="ts" title="contentlayer.config.ts"

想切换主题时，可以在构建前设置：

```bash
CODE_THEME=vitesse yarn build
```

目前可选的主题 key 有：

- `catppuccin`
- `catppuccin-macchiato`
- `github`
- `vitesse`
- `rose-pine`
- `gruvbox`
- `kanagawa`
- `material`
- `nord`
- `one-dark`

代码块样式不再手写 token 颜色，而是读取 Shiki 输出的 CSS 变量：

::github-code repo="mizorewww/blog" ref="43a2ef8e733191f98f417daf69026406bbe562f7" path="css/prism.css" lines="11-45" lang="css" title="css/prism.css"

这样主题切换时，语法颜色、背景色、粗体、斜体都会跟着 Shiki 主题走。

## 这套功能怎么串起来

现在一篇文章的构建流程是：

1. Contentlayer 读取 Markdown。
2. remark 插件把 `:icon-name:` 转成 MDX `Icon`。
3. remark 插件把 `::github-code` 和 `::github-diff` 拉成 code node。
4. `rehype-pretty-code` 用 Shiki 和当前主题生成高亮 HTML。
5. 自定义 rehype 插件给代码行和 diff 行补 metadata。
6. computed fields 读取文章文件的 Git 历史。
7. React 组件渲染文章头部 Git 信息、末尾授权声明和 footer 构建 hash。

这不是一个单独的视觉小功能，而是把写作、源码、构建和页面展示连成了一条可追踪的链路。
