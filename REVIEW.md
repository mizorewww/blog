# 代码审查标准与重构记录

第一节是本仓库的审查基线：每次改动（包括 AI 写的改动）都按它检查。第二节记录 2026-10-25 全量审查的发现和每一项的处理结果。

## 一、审查标准

按顺序检查，前面的不过就不用往后看。

### 1. 正确性（必须通过）

- `go vet ./...`、`go test ./...` 通过；`go run .` 能完整构建，失败时 `public/` 保持上一次的结果。
- 新的 Markdown 语法或元数据字段：非法输入必须让构建失败并指出文件，不允许静默忽略或输出半成品 HTML。元数据的未知字段已经会让构建失败，新增字段要加进 `PostMetadata`。
- 用户可控内容（标题、描述、标签、代码块属性）只经过 `html/template` 或 `html.EscapeString` 进入页面；`template.HTML` / `template.JS` 只用于 Goldmark 输出、`json.Marshal` 结果和 `templates/js` 的脚本。
- 旧链接不能断：改 slug、标签名、URL 结构时，`aliases` / `site.json redirects` 同步更新，`TestRedirects` 覆盖新规则。站内链接由构建时的链接检查兜底（`links.go`）。
- 中英两个版本都要验证：新加的界面文字放进 `i18n.go` 的 `UI`，不在 Go 或模板里写死某一种语言。

### 2. 站点约束（必须通过）

- 不新增运行时第三方请求；需要外部脚本的功能（如 TradingView）必须是读者点击后才加载。
- 不新增浏览器端依赖、框架或 bundler；页面脚本写在 `templates/js/`，只做增强，禁用 JS 时正文、目录、导航完整可用。新脚本要在 `scripts.go` 里按页面内容决定是否带上。
- 不输出 `og:image` 等分享预览图（`TestBuild` 检查）。
- Lighthouse 性能分 ≥ 97（手机）。改动字体、CSS、首屏 HTML 结构、图片加载属性或页面脚本时，本地运行 `sh scripts/lighthouse.sh` 测量每一篇文章；CI 每次推送也会测量。
- 同样的内容和提交构建出同样的文件；日期只来自内容或 git，不来自时钟；不按 Go map 的顺序输出。

### 3. 可维护性（应当通过）

- 一个函数只做一件事；超过约 80 行或嵌套超过 3 层时拆分。构建流程的每一步是 `builder` 的一个方法，新的输出加一个方法而不是加长已有的。
- 不用包级可变状态传参数；构建选项放进 `Options`，每次构建使用自己的语言版本副本。
- `fonts.go faceFor` 镜像 `style.css` 的字体规则：改了 CSS 的 `font-family` / `font-weight`，`TestFontRulesMatchFaceFor` 会失败，按提示同步修改 `faceFor` 和测试里的列表。
- 一种页面一个模板：`templates/pages/<kind>.html`，共用部分留在 `templates/page.html`。
- 文档与行为一致：改了行为就改 README 和 `.claude/skills/write-post/SKILL.md`。
- 注释解释"为什么"，不复述代码；风格与周围代码一致，`gofmt -l .` 无输出。
- 提交保持原子：一个提交只做一件事并能单独通过测试；纯重构的提交不改变构建结果（用前后两次构建的 `diff -r` 确认）。

### 4. 审查流程

1. 先读 diff 涉及的完整函数，而不只是改动行。
2. 本地 `go test ./... && go run . -url http://localhost:8080 -serve localhost:8080`，至少打开首页、一篇带图/表/公式的文章、英文版、搜索页。
3. 按上面 1→3 逐项过；发现的问题按"会出错 / 违反约束 / 可维护性"三级记录。
4. 推送到 `main` 就会部署到 Cloudflare Pages，所以只有全部"必须通过"项通过才合并。

## 二、2026-10-25 审查与处理结果

分支 `refactor/review-fixes`，每一项一个提交。

### 会出错 / 违反约束

| # | 问题 | 处理 |
| --- | --- | --- |
| 0 | 页面输出分享预览图 | 删除 `og:image`、大图卡片、`static/og.png`、`image` 元数据与 JSON-LD 图片（`feat: drop share preview images`） |
| 1 | 元数据未知字段被静默忽略 | 严格解析，拒绝未知字段和尾随内容 |
| 2 | 页脚年份取时钟，构建不确定 | 取最新文章的年份；无文章时省略 |
| 3 | 英文版里写死中文（行情按钮、404、跳转页） | 每个语言版本有自己的 Markdown 渲染器、`404.html` 和跳转页语言；预览服务器也按最近目录选 404 |
| 4 | 字体子集依赖手工镜像 CSS | `TestFontRulesMatchFaceFor` 固定 CSS 字体规则，`TestFaceFor` 覆盖主要分支 |
| 5 | README 与实际行为多处矛盾 | README 与 SKILL.md 按实际行为重写 |
| 新 | 草稿在跳过之前已经渲染，图片照样发布 | 先解析、判断草稿、再渲染 |
| 新 | treeblood 按 map 顺序写 MathML 属性，含公式的页面每次构建都不同 | 输出前按名称排序属性和 style 声明；两次构建字节一致 |
| 新 | sitemap 中分类与标签的顺序随 map 变化 | 固定为分类在前 |
| 新 | `_headers` 漏掉 `/zh/*` 跳转页 | 由构建写出的顶层文件和目录生成 |

### 可维护性

| # | 问题 | 处理 |
| --- | --- | --- |
| 6 | `build()` 约 320 行 | 拆成 `builder` 的各个阶段（`build.go`），源文件按职责拆分：`post.go`、`page.go`、`feed.go`、`i18n.go`、`terms.go`、`git.go`、`search.go` |
| 7 | 包级可变状态 | `Options` 替代 `includeDrafts`；构建不再改写全局 `languages` |
| 8 | 页面脚本是一行手写压缩的 JS | `templates/js/` 下的可读源码，按页面内容选用；首页脚本 2.4 KB → 1.0 KB |
| 9 | 单个模板靠 `Kind` 分支 | 布局 + `templates/pages/<kind>.html`，输出逐字节不变 |
| 10 | `_headers` 路由写死 | 见上表 |
| 11 | 发布了从不被引用的 `style.css` 和两份内联字体 | 不再复制 |
| 12 | 翻译配对四重循环 | 按 slug 分组 |
| 13 | 标签 slug 冲突静默合并 | 构建失败并指出两个名字 |
| 14 | 每张图片启动一次 `uv run` | Go 直接读取缓存清单，图片未变时不启动 Python、不需要 uv（比批处理更省） |
| — | `readPost` / `renderContent` 的可变参数图片钩子 | 单个可选钩子 |

### 质量门禁

- 构建时检查站内链接与锚点（`links.go`）。
- `scripts/lighthouse.sh` 测量首页、搜索和每篇文章；CI 与部署并行运行，低于 97 时标红但不阻止部署（共享 runner 的分数有波动）。本次重构后本地全部为 99–100。

### 有意保留

- JSON-LD 的 `BlogPosting` 不带 `image`：这是预览图的一种，按要求删除。代价是 Search Console 可能提示缺少推荐字段，文章不会出现图片型富结果。
- 没有 `og:image` 时，Facebook、LinkedIn 可能自行从页面挑图；这无法由站点完全控制。
- 已删除的 `/static/og.png` 与两张封面图地址返回 404，只影响已缓存的旧分享卡片。
- 本地 Go 预览服务器下，headless Chrome 的 `--dump-dom` 观察不到目录高亮；同一份页面用其他静态服务器正常，重构前的版本也一样，属于测量方式的问题。
