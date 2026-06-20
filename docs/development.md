# 本地开发

## 环境

使用仓库指定的 Node.js 和 Yarn 版本：

```text
.node-version
package.json#packageManager
```

安装依赖：

```bash
yarn install
```

## 开发服务器

```bash
yarn dev
```

默认端口是 `3000`。

## 检查

```bash
yarn lint
```

`lint` 会对 `app/`、`components/`、`data/`、`lib/`、`layouts/`、`scripts/` 和配置文件运行 ESLint，并自动修复可修复问题。

## 本地构建

```bash
yarn build
```

构建流程：

1. 清空 `.next/` 和 `out/`
2. 执行 `next build`
3. 静态导出页面
4. 执行 `scripts/postbuild.mjs`
5. 生成 RSS 和文章正文预加载数据

构建产物：

```text
out/
```

`out/` 是生产部署产物。生产发布只通过 GitHub Actions 上传到 Cloudflare Pages；本地需要检查静态产物时，可以临时用静态文件服务器预览 `out/`。

## 修改站点信息

站点标题、作者、社交链接、站点 URL、默认主题、Umami 配置位于：

```text
data/siteMetadata.js
```

导航位于：

```text
data/headerNavLinks.ts
```
