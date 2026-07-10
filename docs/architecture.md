---
status: active
audience: both
authority: source-of-truth
owner: docs-maintainer
last_verified: 2026-07-10
verified_by: command
related_code:
  - app/[locale]/page.tsx
  - app/[locale]/[...slug]/page.tsx
  - app/[locale]/[...slug]/loading.tsx
  - app/[locale]/loading.tsx
  - layouts/ListLayoutWithTags.tsx
  - components/ExpandablePostCard.tsx
  - components/MDXServerRenderer.tsx
  - components/AppShell.tsx
  - components/animata
  - lib/content/posts.ts
  - lib/content/terms.ts
  - lib/listPosts.ts
  - lib/toc.ts
  - next.config.js
  - public/_headers
update_when:
  - architecture or build model changes
  - list or article RSC boundaries change
  - routing, return, or scroll behavior changes
  - animation or loading ownership changes
supersedes:
superseded_by:
---

# 软件架构

本项目是纯静态双语博客。生产环境不运行 Node.js 服务，文章、列表和索引页面均在构建阶段预渲染。文章阅读已经接受路由优先作为目标架构：文章 URL 应成为独立阅读页面，而不是列表卡片的展开状态。文章阅读决策以 [ADR-0007](./adr/ADR-0007-route-first-article-reading.md) 为准，MDX 安全边界以 [ADR-0003](./adr/ADR-0003-remove-client-mdx-eval.md) 为准。

## 迁移状态

截至 2026-07-10，ADR-0007 已接受，但对应的源码迁移尚未落地。`app/[locale]/[...slug]/page.tsx`、`layouts/ListLayoutWithTags.tsx`、`components/ExpandablePostCard.tsx` 及相关导航、展开状态和滚动协调代码仍保留列表内展开实现。该实现只是迁移期间的临时现状，不再是架构规范，也不能作为新增行为的参照。

下文的路由、返回、滚动、动画和 loading 边界描述迁移完成后必须满足的目标；除本节明确记录的现状外，不表示源码已经具备这些行为。判断当前运行行为时应以源码和现有测试为准。

## 构建模型

```text
MDX files
  -> Contentlayer
  -> typed content data + generated MDX modules
  -> Next.js static routes
  -> out/
  -> Cloudflare Pages
```

构建入口是 `yarn build`。构建完成后，`out/` 是唯一部署产物。

## 目录职责

```text
app/          Next.js 路由、页面、SEO、全局布局和按路由划分的 loading UI
components/   UI、有限动效、MDX 渲染和文章阅读 client islands
layouts/      列表与文章的页面级布局边界
content/      文章和作者 MDX 内容
data/         导航、站点信息和代码主题等配置
lib/          内容查询、列表投影、TOC、日期、SEO、国际化和小型路由工具
scripts/      开发、构建后处理和质量检查脚本
public/       静态资源和 Cloudflare Pages headers
docs/         架构决策与维护文档
```

## 内容管线

文章位于 `content/blog/zh/` 和 `content/blog/en/`。Contentlayer 在构建时读取 MDX frontmatter 与正文，生成 `.contentlayer/generated`。生产构建先生成内容数据，再运行 `next build`；页面运行时不读取文件系统。

核心边界如下：

- `lib/content/posts.ts` 是文章和作者数据的查询入口。
- `lib/content/terms.ts` 负责分类、标签的 slug、展示 label、计数、过滤和静态参数。
- `lib/listPosts.ts` 把完整文章投影为可序列化的卡片数据。
- `lib/toc.ts` 从 Markdown 标题生成目录数据。
- `components/MDXServerRenderer.tsx` 只在文章路由的服务端边界渲染生成的 MDX 模块。
- `lib/i18n.ts` 负责语言配置、路径本地化和界面文案。

浏览器不接收或执行 Contentlayer 的 MDX runtime code。MDX 内的交互组件按正常 React 边界 hydration；列表页不通过 HTML 注入或客户端求值重建正文。

## 路由与渲染所有权

迁移完成后，列表路由和文章路由必须拥有不同的 RSC 数据与页面几何。

### 列表路由

首页、分类页和标签页必须只查询、排序并渲染 `BlogListPost` 卡片数据。列表 RSC payload 不得包含正文、`mdxModulePath`、编译后 MDX code 或隐藏的文章阅读树。分页或无限加载只改变可见卡片数量，不改变文章路由身份。

卡片必须使用普通 Next.js `Link` 指向 `/{locale}/{slug}`。修改键点击、新标签页、焦点、预取和浏览器语义保持原生；列表点击不得以 sessionStorage pending motion、卡片让位或正文展开状态机作为正确性前提。

### 文章路由

文章 RSC 必须只查询并渲染当前文章、作者信息、目录数据以及上一篇/下一篇的精简导航数据。页面首屏从返回控制、文章标题和当前文章元信息开始，不得在当前文章之前渲染其他列表卡片。

当前文章正文必须通过构建期生成的 MDX 模块和 `MDXServerRenderer` 进入静态 HTML并默认可见。刷新、直接访问、新标签页和禁用 JavaScript时都必须得到同一篇可读正文。

TOC、阅读进度、代码复制、主题、第三方 widget 和经过验证的返回行为应保持为小型 client islands。它们可以订阅浏览器状态，但不能拥有正文数据、控制正文初始可见性或把文章页还原成客户端列表展开状态。

## 返回与滚动

文章顶部返回控制的稳定 `href` 必须是本地化首页。只有当前标签页存在明确标记，能够证明上一条 history entry 是同源博客列表且由它打开当前文章时，普通主键点击才可使用 `history.back()` 返回该列表。直达、刷新、外链、新标签页和未知 history 均走本地化首页；返回控制不得因错误假设离开站点。

迁移后的路由滚动只有一个所有者：Next.js 与浏览器。文章导航不使用 `scroll: false`，不保存 `scrollY`，不设置延迟恢复 timer，不创建临时滚动 runway，也不在路由提交后执行位置修正。有效 Back 使用浏览器原生位置恢复，首页 fallback 使用普通 Link 导航。

## 动画边界

Motion 和 `components/animata/` 只负责有界面的视觉反馈，不负责文章数据、文章生命周期或滚动正确性。

- 正文不是 disclosure，不执行 `height: 0 -> auto`、整篇 opacity gating 或退出折叠。
- 正文静态 HTML 不依赖 hydration 或动画完成后才显示。
- 快速反馈使用 160-180 ms；标准反馈使用 200-220 ms。
- 可见位移只使用 `transform`，幅度不超过 8 px；透明度与 transform 动画不得触发布局。
- 一次交互最多有一个主要动画。已提交且没有状态变化的内容不重播入场。
- 应用级 Motion 配置使用 `reducedMotion="user"`。减弱动态效果时取消非必要位移、stagger、smooth scroll 和等待 timer，不改变内容或焦点结果。

通用页面转场不得掩盖路由提交、延迟可读正文或与文章返回竞争。实验性 View Transition API 和新动画依赖不属于当前架构。

## 加载边界

每类路由使用与目标页面几何一致的 loading UI：

- 列表 loading 显示列表主栏与卡片结构。
- 文章 loading 显示单篇阅读栏、标题/元信息、正文行和可选 TOC 结构。
- 分类、标签、搜索等稀疏页面使用对应结构；静态且即时的路由可以不显示骨架。

骨架只表达 pending navigation，不在真实内容提交后重播。文章路由不得先显示三栏列表卡片骨架，再切换成单篇阅读布局。

## 性能与安全边界

迁移完成后，列表页只序列化卡片需要的字段，文章页只导入当前 MDX 模块。上一篇/下一篇和 TOC 数据保持精简，避免把完整文章集合传给 client islands。

静态导出模式下，Next.js 不在运行时优化图片。主图和头像应在提交前压缩并提供稳定尺寸或宽高比，以控制 LCP 与 CLS。第三方脚本默认不进入首屏；接入时需要验证 CSP、静态构建产物和交互性能。

Cloudflare Pages CSP 不为文章渲染开放 eval。`public/_headers`、生成的 JSON-LD、分析脚本和第三方 widget 的现有例外需要单独审查，不能扩展成客户端 MDX 执行能力。

## 路由结构

默认语言是 `zh`。应用只保留显式语言路径；Cloudflare Pages redirects 把无语言前缀的历史 URL 永久跳到 `/zh/...`。

```text
/{locale}
/{locale}/{slug}
/{locale}/search
/{locale}/tags
/{locale}/tags/{tag}
/{locale}/categories
/{locale}/categories/{category}
```

所有动态内容路由通过 `generateStaticParams` 生成静态页面。

## 运行时边界

生产站点只依赖浏览器和 Cloudflare Pages 静态托管。运行时不存在文件系统读取、服务端 API、数据库或 Node.js server。搜索使用构建期 Pagefind 索引和按需加载的浏览器 runtime，不改变文章与列表的 RSC 数据边界。
