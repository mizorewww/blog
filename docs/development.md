---
status: active
audience: both
authority: source-of-truth
owner: docs-maintainer
last_verified: 2026-06-23
verified_by: command
related_code:
  - package.json
  - scripts
  - eslint.config.mjs
  - knip.json
update_when:
  - development command changes
  - package manager changes
  - quality gate changes
supersedes:
superseded_by:
---

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

## 静态预览

需要检查真实静态导出效果时，使用：

```bash
yarn preview
```

该命令会先执行 `yarn build`，然后用项目本地的 Caddy 服务 `out/`。第一次运行会自动下载固定版本的 Caddy 到 `.tools/caddy/`，并在解压前校验 checksum；该目录只保存本机工具和运行状态，不提交到仓库。

默认端口是 `3001`。服务启动后，终端会显示并定期重复 Local 和 Network 预览地址，例如：

```text
Local:   http://localhost:3001/
Network: http://192.168.31.129:3001/
```

可选参数：

```bash
yarn preview --port 4000       # 指定端口
yarn preview --no-build        # 跳过构建，直接服务已有 out/
yarn preview --update-caddy    # 重新下载仓库固定版本的 Caddy
```

## 检查

```bash
yarn check
```

`check` 会依次执行图标注册表检查、格式检查、ESLint、TypeScript、文档 metadata 检查和 Knip dead-code/dependency 检查。

常用单项检查：

```bash
yarn format:check
yarn lint:check
yarn typecheck
yarn docs:check
yarn deadcode:check
```

`lint:check` 只做检查，不会改写文件。需要自动修复 ESLint 问题时使用：

```bash
yarn lint:fix
```

需要自动格式化时使用：

```bash
yarn format:write
```

合并前的完整只读检查：

```bash
yarn check
```

如果文章或组件新增了 lucide 图标引用，pre-commit 会自动更新并暂存 `lib/generated/lucide-icons.ts`。也可以手动执行：

```bash
yarn icons:generate
```

## 性能防退化

性能检查以构建产物为准。不要手工修改 `out/`，不要提交一次性压缩出的 `.gz`、`.br` 或临时转码资源；生产环境的传输压缩由 GitHub Actions 构建后的 Cloudflare Pages 交付层负责。

修改路由、列表、文章渲染、图片、字体或第三方脚本时，合并前执行：

```bash
yarn check
yarn build
```

构建后检查列表页没有重新携带 MDX 正文代码：

```bash
rg "bodyCode|function MDXContent|var Component" out/zh/index.txt out/en/index.txt
```

期望没有输出。列表页只能携带卡片所需的精简数据；文章正文通过详情页构建期渲染，或通过 `out/_post-data/` 在客户端预取后用于就地展开动画。

使用仓库内的静态 HTML 质量检查：

```bash
yarn quality:html
```

`issues` 需要修复后再合并。`warnings` 需要人工判断；例如 SVG/RSS 命名空间里的 `http://www.w3.org/...`、文章代码块中的 `http://` 示例可能是误报。

GitHub Actions 会在 `yarn build` 后重复执行同一类检查：

- 列表页 RSC payload 不得包含 MDX 正文代码。
- 静态 HTML 质量检查的 `issueCount` 必须为 `0`。
- 静态资源必须通过 `yarn size:budget`。
- 构建日志会通过 `yarn size:report` 输出静态资源体积，供 review 判断趋势。

排查资源体积时使用只读命令观察构建产物：

```bash
yarn size:report
```

这个命令用于 review 和定位问题，不作为手工改文件的理由。需要优化图片或其他静态资源时，应改源文件或引入可重复的构建/Actions 步骤，并在文档中说明规则。

优化 `public/static/images/` 下的图片：

```bash
yarn images:optimize
```

Core Web Vitals 约束：

- LCP 内容必须来自静态 HTML 或构建期数据，不要把首屏主要内容改成客户端加载。
- INP 敏感路径中的点击处理要短，先给视觉反馈，再做预取、统计等低优先级工作。
- CLS 依赖稳定尺寸：图片、嵌入内容、固定格式 UI 要有 `width`/`height`、`aspect-ratio` 或稳定容器。
- 动画优先使用 `transform` 和 `opacity`。如果必须做布局高度动画，提交前用浏览器验证有中间帧，不是瞬间跳变。
- 第三方脚本默认不进首屏；必须接入时使用延迟加载，并确认 CSP、构建产物和交互性能。
- 跨页面提速优先使用浏览器原生能力。当前站点使用 Speculation Rules 的 `moderate` 预渲染作为渐进增强；涉及统计脚本时必须避免 prerender 阶段提前上报。

“继续阅读”交互的专项检查：

1. 首页加载后正文预加载请求应命中 `/_post-data/{locale}/{slug}.json`。
2. 点击后 URL 更新目标是 `/{locale}/{slug}`，但已预取正文时不应等待 App Router 提交详情页。
3. 返回列表时应读取 `sessionStorage` 或 history state 中的展开动画上下文并播放收起动画。
4. 点击响应应控制在 30ms 内。
5. 展开动画应有折叠态、中间态和完成态，不得为了速度跳过动画。

## 开发纪律

不允许手工 hack 性能问题：

- 不手工改 `out/`。
- 不提交本地临时压缩或转码结果。
- 不依赖某台机器上才有的工具链。
- 不把检查结果只写在聊天里，必须沉淀到代码、GitHub Actions 或文档。
- 任何性能优化都要能由 `yarn build`、GitHub Actions 或 Cloudflare Pages 稳定复现。

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

`out/` 是生产部署产物。生产发布只通过 GitHub Actions 上传到 Cloudflare Pages；本地需要检查静态产物时，优先用 `yarn preview` 预览 `out/`。

## 修改站点信息

站点标题、作者、社交链接、站点 URL、默认主题、Umami 配置位于：

```text
data/siteMetadata.ts
```

导航位于：

```text
data/headerNavLinks.ts
```
