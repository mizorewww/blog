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

## 性能防退化

性能检查以构建产物为准。不要手工修改 `out/`，不要提交一次性压缩出的 `.gz`、`.br` 或临时转码资源；生产环境的传输压缩由 GitHub Actions 构建后的 Cloudflare Pages 交付层负责。

修改路由、列表、文章渲染、图片、字体或第三方脚本时，合并前执行：

```bash
yarn lint
yarn build
```

构建后检查列表页没有重新携带 MDX 正文代码：

```bash
rg "bodyCode|function MDXContent|var Component" out/index.txt out/zh/index.txt out/en/index.txt
```

期望没有输出。列表页只能携带卡片所需的精简数据；文章正文通过详情页或 `out/_post-data/` 预加载数据进入浏览器。

使用本地 web quality skill 做静态 HTML 审计：

```bash
.agents/skills/web-quality-audit/scripts/analyze.sh out
```

`issues` 需要修复后再合并。`warnings` 需要人工判断；例如 SVG/RSS 命名空间里的 `http://www.w3.org/...`、文章代码块中的 `http://` 示例可能是误报。

GitHub Actions 会在 `yarn build` 后重复执行同一类检查：

- 列表页 RSC payload 不得包含 MDX 正文代码。
- web-quality-audit 的 `issueCount` 必须为 `0`。
- 构建日志会输出静态资源体积，供 review 判断趋势。

排查资源体积时使用只读命令观察构建产物：

```bash
du -ah out | sort -h | tail -40
find out/_next/static -type f \( -name '*.js' -o -name '*.css' -o -name '*.woff2' \) -printf '%s %p\n' | sort -nr | head -40
find out/static/images -type f -printf '%s %p\n' | sort -nr
```

这些命令用于 review 和定位问题，不作为手工改文件的理由。需要优化图片或其他静态资源时，应改源文件或引入可重复的构建/Actions 步骤，并在文档中说明规则。

Core Web Vitals 约束：

- LCP 内容必须来自静态 HTML 或构建期数据，不要把首屏主要内容改成客户端加载。
- INP 敏感路径中的点击处理要短，先给视觉反馈，再做预取、统计等低优先级工作。
- CLS 依赖稳定尺寸：图片、嵌入内容、固定格式 UI 要有 `width`/`height`、`aspect-ratio` 或稳定容器。
- 动画优先使用 `transform` 和 `opacity`。如果必须做布局高度动画，提交前用浏览器验证有中间帧，不是瞬间跳变。
- 第三方脚本默认不进首屏；必须接入时使用延迟加载，并确认 CSP、构建产物和交互性能。
- 跨页面提速优先使用浏览器原生能力。当前站点使用 Speculation Rules 的 `moderate` 预渲染作为渐进增强；涉及统计脚本时必须避免 prerender 阶段提前上报。

“继续阅读”交互的专项检查：

1. 首页加载后正文预加载请求应命中 `/_post-data/{locale}/{slug}.json`。
2. 点击后 URL 更新目标是 `/{locale}/{slug}`。
3. 点击响应应控制在 30ms 内。
4. 展开动画应有折叠态、中间态和完成态，不得为了速度跳过动画。

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
