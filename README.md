# mizore-blog

一个静态个人博客。内容用 MDX 编写，构建时由 Contentlayer 生成类型化数据，Next.js App Router 负责页面渲染，最终导出为静态文件并部署到 Cloudflare Pages。

## 技术栈

- Next.js App Router
- React
- Contentlayer
- Tailwind CSS
- MDX
- GitHub Actions
- Cloudflare Pages

## 快速开始

```bash
yarn install
yarn dev
```

常用命令：

```bash
yarn dev      # 本地开发服务器
yarn lint     # ESLint 检查
yarn build    # 生成静态站点到 out/
yarn preview  # 构建静态站点并用本地 Caddy 预览
```

`yarn preview` 第一次运行会自动下载固定版本的 Caddy 到 `.tools/caddy/`，随后终端会持续显示可点击的 Local/Network 预览地址。

Node.js 版本以 `.node-version` 为准，包管理器版本以 `packageManager` 为准。

## 文档

- [软件架构](docs/architecture.md)
- [架构决策记录](docs/decisions.md)
- [本地开发](docs/development.md)
- [部署](docs/deployment.md)
- [内容与 MDX](docs/content.md)
