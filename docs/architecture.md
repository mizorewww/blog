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
data/         文章、作者、导航、站点元信息
lib/          内容查询、排序、日期、TOC、国际化等纯工具
scripts/      构建后脚本，目前用于生成 RSS
public/       静态资源和 Cloudflare Pages headers
docs/         项目维护文档
```

## 内容流

文章存放在 `data/blog/` 下，按语言分目录：

```text
data/blog/zh/
data/blog/en/
```

Contentlayer 在构建时读取 MDX frontmatter 和正文，并生成 `.contentlayer/generated`。页面代码只消费生成后的内容数据，不在运行时读取文件系统。

核心内容工具在 `lib/`：

- `lib/blog.ts`：按语言、分类、标签过滤文章。
- `lib/contentlayer.ts`：排序和提取可序列化内容字段。
- `lib/listPosts.ts`：把完整文章转换为列表/卡片需要的数据。
- `lib/toc.ts`：从 Markdown 标题生成目录数据。
- `lib/i18n.ts`：语言配置、路径本地化、界面文案。

## 路由结构

默认语言是 `zh`。站点同时提供默认语言根路径和显式语言路径。

```text
/                         默认语言首页
/blog                     默认语言文章列表
/blog/{slug}              默认语言文章
/tags                     默认语言标签页
/tags/{tag}               默认语言标签文章列表
/categories               默认语言分类页
/categories/{category}    默认语言分类文章列表

/{locale}
/{locale}/blog
/{locale}/blog/{slug}
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
