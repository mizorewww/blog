# 部署

生产部署使用 GitHub Actions 发布到 Cloudflare Pages。

## 部署产物

构建命令：

```bash
yarn build
```

部署目录：

```text
out/
```

`next.config.js` 使用静态导出：

```js
output: 'export'
```

图片配置为静态导出兼容模式：

```js
images: {
  unoptimized: true
}
```

## 压缩与缓存

生产链路是：

```text
GitHub Actions -> yarn build -> out/ -> Cloudflare Pages
```

传输压缩由 Cloudflare Pages 在边缘处理。不要手工生成或提交 `.gz`、`.br` 文件，也不要在本地修改 `out/` 作为性能优化手段。

如果以后需要自动图片优化、资源预算或 Lighthouse 门禁，应作为可重复的构建脚本或 GitHub Actions 步骤加入，并同步更新 `docs/development.md`。不接受一次性手工转码或只在某台机器上成立的优化。

当前 GitHub Actions 在部署前会执行：

- `yarn lint:check`
- `yarn format:check`
- `yarn typecheck`
- `yarn typecheck:scripts`
- `yarn deadcode:check`
- `yarn build`
- 列表页 RSC payload 检查，防止 MDX 正文重新进入首页列表
- `yarn quality:html`
- `yarn size:budget`
- `yarn size:report` 静态资源体积报告

## GitHub Actions

工作流文件：

```text
.github/workflows/pages.yml
```

触发方式：

- push 到 `main`
- 手动触发 `workflow_dispatch`

工作流步骤：

1. 拉取仓库
2. 安装 `.node-version` 指定的 Node.js
3. 安装 Yarn 依赖
4. 执行 `yarn build`
5. 校验 Cloudflare 配置
6. 执行 `wrangler pages deploy out`

## Cloudflare 配置

GitHub 仓库需要配置：

```text
secrets.CLOUDFLARE_ACCOUNT_ID
secrets.CLOUDFLARE_API_TOKEN
vars.CLOUDFLARE_PAGES_PROJECT_NAME
```

`CLOUDFLARE_API_TOKEN` 需要具备 Cloudflare Pages 部署权限。

## 环境变量

可选：

```bash
NEXT_UMAMI_ID=
```

设置后，生产构建会输出 Umami 统计脚本。未设置时不加载统计脚本。

## 静态 headers

Cloudflare Pages 会读取：

```text
public/_headers
```

这里维护 CSP、HSTS、Referrer Policy、Frame Policy 等响应头。

## 重定向

`public/_redirects` 是无语言前缀历史 URL 和旧平铺文章 URL 的权威规则。主题目录迁移后的字面 301（例如 `/zh/xiaomi-book-pro-14` → `/zh/折腾/xiaomi-book-pro-14/`）也写在同一文件；开发服务器、静态 preview 和 Cloudflare Pages 共用这份清单。
