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
