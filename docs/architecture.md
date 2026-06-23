---
status: active
audience: both
authority: source-of-truth
owner: docs-maintainer
last_verified: 2026-06-23
verified_by: command
related_code:
  - app
  - components
  - contentlayer
  - lib
  - next.config.js
  - public/_headers
update_when:
  - architecture changes
  - build model changes
  - routing behavior changes
supersedes:
superseded_by:
---

# 软件架构

这个项目是纯静态博客。生产环境不运行 Node.js 服务，所有页面在构建阶段预渲染为静态文件。

## 构建模型

```text
MDX files
  -> Contentlayer
  -> typed content data
  -> Next.js static routes
  -> out/
  -> Cloudflare Pages
```

构建入口是：

```bash
yarn build
```

构建完成后，`out/` 是唯一需要部署的产物。

## 目录职责

```text
app/          Next.js 路由、页面、SEO、全局布局
components/   UI 组件、MDX 渲染、文章卡片、导航、主题切换
layouts/      页面级布局，目前主要是博客列表布局
content/      文章和作者 MDX 内容
data/         导航、站点元信息、代码主题等配置数据
lib/          内容查询、路由状态、动画、日期、TOC、国际化等工具
scripts/      本地开发、构建后处理和质量检查脚本
public/       静态资源和 Cloudflare Pages headers
docs/         项目维护文档
```

## 内容流

文章存放在 `content/blog/` 下，按语言分目录：

```text
content/blog/zh/
content/blog/en/
```

Contentlayer 在构建时读取 `content/` 下的 MDX frontmatter 和正文，并生成 `.contentlayer/generated`。生产构建通过 `yarn contentlayer2 build` 先生成内容数据，再运行 `next build`；开发服务器仍使用 `next-contentlayer2` 插件以便内容变更时自动更新。页面代码只消费生成后的内容数据，不在运行时读取文件系统。

核心内容工具在 `lib/` 和 `lib/content/`：

- `lib/blog.ts`：文章发布状态和语言归属判断。
- `lib/content/posts.ts`：唯一读取 Contentlayer 文章/作者数据的查询层。
- `lib/content/terms.ts`：分类、标签的 slug、原始展示 label、计数、过滤和静态参数。路由使用 slug，UI、metadata 和 JSON-LD 使用 label。
- `lib/contentlayer.ts`：排序和提取可序列化内容字段。
- `lib/listPosts.ts`：把完整文章转换为精简的列表/卡片数据。
- `lib/toc.ts`：从 Markdown 标题生成目录数据。
- `lib/i18n.ts`：语言配置、路径本地化、界面文案。
- `lib/blogRouteState.ts`：文章展开路由、全局事件和 history state 边界。
- `lib/hooks/useExpandablePostNavigation.ts`：列表卡片的预取、history state 和 App Router 跳转边界。
- `lib/blogExpansionState.ts`：文章展开列表状态的纯计算。
- `lib/postMotion.ts`：文章展开/收起的滚动动画工具。

## 性能边界

列表页只传递卡片渲染需要的精简文章数据，不在 RSC payload 里携带所有 MDX 编译后的正文代码。文章详情页渲染当前展开文章的正文。

Contentlayer 会把每篇文章的 compiled MDX 写成 `.contentlayer/generated/mdx/*.mjs`，详情页在构建阶段通过 server-side dynamic import 渲染正文。列表页不接收或公开 MDX runtime code；列表卡片进入浏览器后预取对应文章的静态 App Router 路由，点击“继续阅读”时保存展开动画上下文并进入 `/{locale}/{slug}`。文章路由提交后，`usePostExpansion` 读取 pending motion context，在详情路由内播放展开动画。点击收起时，卡片保存收起动画上下文并返回原列表 URL，让首页、标签页或分类页先恢复各自的服务端列表数据，再播放收起动画。收起完成时必须恢复到点击“继续阅读”之前保存的列表 scrollY，而不是只把卡片移动到近似的视口位置。

这个模型保留列表到文章详情的展开/收起动效，同时让 MDX 正文继续走 Next.js 和 React 的正常渲染与 hydration 边界。客户端不再执行 Contentlayer runtime MDX code，Cloudflare Pages CSP 不需要为文章展开保留 eval 例外。

静态导出模式下，Next.js 不会在运行时优化图片。新增主图和作者头像时，应在提交前压缩到适合网页使用的尺寸和体积。

## 路由结构

默认语言是 `zh`。应用路由只保留显式语言路径；Cloudflare Pages redirects 把无语言前缀的历史 URL 永久跳到 `/zh/...`。

```text
/{locale}
/{locale}/{slug}
/{locale}/tags
/{locale}/tags/{tag}
/{locale}/categories
/{locale}/categories/{category}
```

所有动态路由都通过 `generateStaticParams` 生成静态页面。

## 运行时边界

生产站点只依赖浏览器和 Cloudflare Pages 静态托管能力。下面这些能力不在运行时存在：

- 文件系统读取
- 服务端 API
- 数据库
- Node.js server
- 内置搜索服务

如果后续接入搜索，应作为第三方静态/客户端搜索能力接入，例如托管搜索服务或构建期索引库。
