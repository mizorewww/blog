# mizore / notes

一个参考 [Zed Blog](https://zed.dev/blog) 排版气质的极简个人博客。页眉只有站名、「关于」和 RSS 三个链接，首页是一句站点介绍加文章列表：日期、分类、标题、摘要和阅读时长；页脚只有版权和外部链接。使用贯穿页面的横线、两侧纵线和交点标记组织页面。

**静态 HTML · 默认 0 JS · 无框架 · 无 hydration · 无 bundler**

## 本地运行

需要 Go 1.25 或更新版本（测试环境：Go 1.27.3）。

```sh
go run . -url http://localhost:8080 -serve localhost:8080
```

打开 <http://localhost:8080>。

上述预览命令只绑定本机，已启用 gzip 和 HTTP 缓存。修改内容后重新执行命令；没有热更新或浏览器脚本。生产部署只需要生成文件，不需要运行此服务器。

```sh
go run .                         # 使用 site.json 的生产 URL
# 或者指定自己的域名（也支持子路径部署）
go run . -url https://example.com/blog
```

将 `public/` 的内容上传到任意静态托管服务。配置目录 URL 对应 `index.html`，不存在的地址返回 `404.html` 并保持 HTTP 404。域名根目录部署时，`robots.txt` 可被标准爬虫直接发现；子路径部署时由域名根站点管理 robots.txt。

正式地址是 `https://mizore.blog`，接替原来的 Next.js 博客，按旧站方式部署在 Cloudflare Pages（会读取构建产物里的 `_headers` 与 `_redirects`）。发布到其他域名时务必修改 `site.json` 或传入 `-url`，以生成正确的 canonical、RSS 与 sitemap URL。上线后在 Google Search Console 和 Bing Webmaster Tools 提交 `https://mizore.blog/sitemap.xml`。

## 写文章

在仓库根目录运行：

```sh
go run . new -slug hello-world -description "文章的一句话介绍。" -tag 随笔 "你好，世界"
```

生成 `content/posts/hello-world.md`，日期默认取本机当天。也可以只传标题：

```sh
go run . new "Hello Go"       # hello-go.md
go run . new "一篇新的笔记"   # post-YYYYMMDD-HHMMSS.md
go run . new -h               # 全部参数
```

所有选项放在标题前。可用 `-date YYYY-MM-DD` 指定日期，或用 `-title` 代替位置参数。文件名只允许小写英文字母、数字和连字符；重名会报错，绝不覆盖已有文章。缺省摘要和正文是待填写的占位文字，创建后编辑再构建。

正文模板位于 `templates/post.md.tmpl`，可直接修改；`{{.Metadata}}` 是自动生成的 JSON 元数据，也可使用 `{{.Title}}`、`{{.Date}}`、`{{.Description}}` 和 `{{.Tag}}`。工具只创建文件，不自动构建、提交或推送。

也可以手动在 `content/posts/` 新建 Markdown 文件。

文件开头是 **JSON 元数据**，随后单独一行 `---`，再写 Markdown。刻意不用 YAML，避免引入新的解析依赖。

```markdown
{"title":"你好，世界","description":"文章的一句话介绍。","date":"2026-10-02","tag":"随笔"}
---
这是正文。

## 一个小标题

从这里开始写。
```

- `title`、`description`、`date` 必填；日期格式为 `YYYY-MM-DD`，非法日期会让构建失败。
- `tag` 是可选的文字标签。
- `aliases` 可选，列出文章的旧地址（以 `/` 开头和结尾，如 `"/zh/折腾/xiaomi-book-pro-14/"`），见下文「旧地址跳转」。
- `updated` 可选，格式同 `date` 且不早于它；文章有实质修改时填写，用于 `dateModified`、`article:modified_time` 和 sitemap 的 `lastmod`。
- 文章按日期倒序排列，同日按文件名排序。
- 所有文章都会发布，包括未来日期；草稿放在 `content/posts/` 之外。
- 支持常规 Markdown、表格、代码块和自动标题 ID；中文标题保留可读锚点，例如 `## 问题一：屏幕花屏` 对应 `#问题一屏幕花屏`。
- 文章目录自动提取 `##`、`###` 标题，桌面为侧栏，手机位于正文前，可原生折叠；无标题时不显示目录。
- 文末显示上一篇（更早）和下一篇（更新），同日按文件名顺序；首尾自动省略不存在的链接，只有一篇时不显示相邻文章导航。
- 文章页不展示分类、日期、阅读时长或作者署名；发布日期仍保留在 HTML 元数据和 RSS 中。
- 原始 HTML 与危险链接由 Goldmark 默认规则禁用；元数据由 `html/template` 转义。
- 数学公式写 LaTeX：行内 `$E = mc^2$`，独立公式把 `$$` 各放一行。构建时由 [treeblood](https://github.com/wyatt915/treeblood) 转为浏览器原生 MathML，0 JS、无额外字体；不支持的命令（如 `\arg`）让构建失败并指出公式，可改写为 `\mathrm{arg}`。为了不误伤价格，`$` 后紧跟空格、结束 `$` 前有空格或后接数字时都不算公式，`$5 和 $10` 保持原样；确需字面量时写 `\$`。
- 阅读时长按每分钟 300 个汉字或英文单词估算，不计代码块和数据表格。
- 本地图片在构建时自动压缩并重写地址，使用方法见下文「文章图片」。普通 Markdown 链接不重写。

## 数据表格

本站不嵌入图表脚本或图表图片。需要比较数值时，用 `data` 代码块写一张带标题和细横条的表格：

````markdown
```data title="12 档 delta 的 Sharpe 对比" bars="BTC,ETH" mark="Δ0.35" note="周频收益 × √52 年化。"
Delta | BTC  | ETH
Δ0.05 | 4.40 | 1.18
Δ0.35 | 3.43 | 2.19
```
````

- 第一行是表头，单元格用 `|` 分隔，首尾的 `|` 和 GFM 的 `---|---:` 分隔行都可以省略或保留。单元格是纯文本，不解析 Markdown。
- `title` 标题、`note` 表下注释（单位、口径、数据来源）。
- `bars` 列出要画横条的列名；横条从 0 开始，负值用赭红色并在 0 处画刻度。单元格里第一个数字决定长度，`+1.2 BTC`、`−3.4%`、`$64,395` 都能识别。
- 默认所有横条共用一个比例，便于横向比较；单位不同的列加 `scale="column"` 各自缩放。
- `mark` 列出需要强调的行（按第一列匹配，逗号分隔）。
- 全为数字的列自动右对齐、等宽数字。表格过宽时在容器内横向滚动。
- 未知属性、找不到的 `bars` 列、行列数不一致都会让构建失败。

普通 Markdown 表格使用相同的横线样式；用 `---:` 让数字列右对齐。如何把图表改写成表格，以及给 AI 的完整写作规范，见 `.claude/skills/write-post/SKILL.md`。

## 旧地址跳转

站点从旧博客（`mizore.blog/zh/<分类>/<slug>/`）迁移而来。为保住旧链接和搜索排名：

- 每篇迁移文章在 `aliases` 中列出旧地址。构建时写入 Cloudflare Pages 的 `_redirects`（301，先匹配先生效）；含中文的地址同时写入编码和原文两种形式，因为 Cloudflare 未说明按哪种匹配。
- 每个旧地址还会生成一个跳转页（`noindex`、canonical 指向新地址、0 秒 meta refresh），换到不读 `_redirects` 的托管也能跳转。
- `aliases` 的第一项同时作为 RSS 的 `guid`，与旧 feed 一致，订阅者不会把迁移文章当成新文章重复收到。
- 旧的分类、标签、语言首页等没有对应页面的地址，由 `site.json` 的 `redirects` 按顺序 301 到首页，`/about/` 跳到 about.mizore.blog。规则写在文章别名之后，所以 `/zh/*` 不会抢走具体文章。
- 别名不能指向 `/`、`/posts/`、`/static/`、`/images/`，同一地址不能被两篇文章占用，否则构建失败。

## 文章图片

原图放在 `content/images/`，在文章里使用相对于 Markdown 文件的路径：

```markdown
![图片的内容说明](../images/photo.jpg)
```

保留有意义的替代文字，让屏幕阅读器与爬虫理解图片。

直接运行原来的 `go run .`，无需手动压缩。首次构建含本地位图的文章需要安装 [uv](https://docs.astral.sh/uv/getting-started/installation/)；它会为 `scripts/prepare-image.py` 自动准备锁定版本的 Pillow。没有本地位图时仍然只需 Go；浏览器端不增加依赖。

- JPEG、PNG、WebP、静态 GIF、AVIF：生成 WebP 候选，宽图按最大 1600 px 等比缩小，不放大小图。JPEG/WebP/AVIF 使用 quality 82；PNG/静态 GIF 使用无损编码，透明背景保留（缩小尺寸本身仍会重采样）。
- 只采用比原图更小的结果，否则保留原文件及原始尺寸。处理照片 EXIF 方向，生成的 WebP 不携带 EXIF；保留原文件的情况下也保留原有元数据。
- 动画与 SVG 原样保留，暂不压缩；远程 HTTP(S) 图片不下载、不压缩，若需优化请先保存到本地。
- `content/images/` 原图不会写入发布目录，也不会被覆盖。旧的 `../../static/photo.png` 或 `/static/photo.png` 图片引用也会优化，但 `static/` 本身仍作为公共资源复制，建议将大原图迁入 `content/images/`。
- 产物以内容哈希命名，输出到 `/images/`，使用一年期 immutable 缓存；修改样式不会让图片地址失效；文章与全文 RSS 自动引用带部署子路径的绝对地址。修改图片后 URL 随内容更新。
- 本地位图自动补充 `width` / `height`，减少布局跳动；每篇正文首张图片不懒加载，后续图片用原生 `loading="lazy"`，全部设置 `decoding="async"`。SVG、外链的尺寸不会自动探测。
- `.cache/images/` 按原图内容和处理脚本缓存，无变化时不重复编码；删除该目录即可重建。原图缺失或编码失败会中止构建，保留上次的 `public/`。

编码测试：`uv run scripts/test_images.py`。日常发布仍只上传 `public/`，无需部署 Python、uv 或 Go。

## 个性化

| 文件 | 用途 |
| --- | --- |
| `site.json` | 站点标题、作者、描述、正式 URL、页眉「关于」链接（`about`）与结构化数据中的个人主页（`sameAs`） |
| `templates/page.html` | 页眉、文章列表与文章布局 |
| `static/style.css` | 颜色、字体、间距、响应式规则 |
| `static/favicon.svg` | `m.` 图标，可换成自己的标记 |
| `content/posts/*.md` | 文章 |
| `main.go` | 构建器与本地预览入口 |
| `images.go` / `scripts/prepare-image.py` | 本地图片重写、压缩与构建缓存 |
| `assets.go` / `serve.go` | 资源版本号与 HTTP 压缩、缓存 |
| `new.go` / `templates/post.md.tmpl` | 创建文章工具及正文模板 |

个人介绍不放在本站：页眉的「关于」指向 `site.json` 的 `about`（目前是 about.mizore.blog）。RSS 同时出现在页眉和 HTML head 的自动发现中。

## 输出与设计约束

- 首页、文章页、404：完整语义化 HTML，HTTP 响应包含全部正文。
- `feed.xml`：包含全文的 RSS 2.0，带 `atom:link rel="self"`、语言、分类和 `lastBuildDate`。
- `sitemap.xml` 的 `lastmod` 取文章的 `updated` 或 `date`，首页取最新一篇；日期只来自内容，内容不变时构建结果完全一致。
- `sitemap.xml`、`robots.txt`：爬虫入口。
- canonical、description、跳至正文链接、键盘焦点状态。
- 分享与搜索：Open Graph 与 Twitter `summary` 卡片只有标题和描述，刻意不输出 `og:image` 预览图；文章页输出发布、修改日期、作者与标签。
- 结构化数据：首页 `WebSite`、文章页 `BlogPosting` 的 JSON-LD，作者为 `site.json` 的 `author`，链接到 `about` 与 `sameAs`（GitHub、X），与 about.mizore.blog 的身份一致。这是 `application/ld+json` 数据块，不是可执行脚本。
- 正文用思源黑体，标题用思源宋体，日期、表格与代码用 Maple Mono，全部自托管、不依赖系统字体。构建时按页面子集化：每页首屏（第一个正文小标题之前）用到的字直接内嵌，其余的字拆成这一页自己的小文件，加载后再启用。新文章不需要重新生成字体；GB2312 以外的生僻字要先运行 `uv run scripts/prepare-fonts.py` 更新 `fonts/` 下的源字体。
- Adobe 官方简体中文可变字体，自托管 WOFF2，按字符分片、`font-display: swap`，无第三方网络请求，无分析脚本。
- 字体已提交到 `static/fonts/`，字体无需日常重新生成；新增文字由浏览器自动加载对应分片。可选用 `uv run scripts/prepare-fonts.py` 重新优化当前文章的常用字符分片，工具不参与日常构建。
- 字体版本：Source Han Serif 2.003R / Maple Mono 7.9，SIL OFL 1.1 许可证保留在字体目录。
- Go 标准库处理模板、JSON、XML、日期和文件；Go 第三方依赖为锁定版本的 Goldmark、代码高亮（goldmark-highlighting + Chroma）与公式转换（treeblood）；含本地位图的构建另需 uv/Pillow。
- 构建先写临时目录，全部成功后替换 `public/`，避免内容或模板错误破坏已有输出。替换并非无缝在线发布，请通过托管平台部署产物。
- 没有评论、搜索、客户端路由、Service Worker 或动态后端。

## 压缩与缓存

- CSS、字体和图标输出到 `/static/<内容哈希>/`。样式或资源改变后地址自动更新，使用 `Cache-Control: public, max-age=31536000, immutable`；不变的资源可直接使用浏览器缓存。
- HTML、RSS、sitemap 和 robots 使用 `Cache-Control: no-cache` + ETag：每次重新验证，未变化返回 304，修改后返回新内容。`no-cache` 允许存储，但要求复用前验证。
- 本地 Go 服务器会 gzip 压缩 HTML、CSS、XML、SVG 等文本响应，发送 `Vary: Accept-Encoding`，为压缩和未压缩内容生成各自的 ETag。已压缩的 WOFF2 不再重复 gzip。
- 首屏预加载两个常用字体分片；没有 Service Worker 或客户端缓存脚本。
- 自行放进 `static/` 的文章图片保持原路径，Go 服务器对未带版本号的资源重新验证，不使用永久缓存。
- 构建输出包含 Cloudflare Pages 的 `_headers` 文件，配置 HTML 重新验证和当前版本静态资源长期缓存，支持站点子路径。参见 [Cloudflare Pages 响应头文档](https://developers.cloudflare.com/pages/configuration/headers/)。
- 其他静态托管平台需配置同等响应头并启用压缩；GitHub Pages 不读取 `_headers`，其缓存策略由平台控制。缓存头属于 HTTP 服务配置，不能仅靠 HTML 文件生效。

## 代码高亮

围栏代码块标明语言时，构建时由 [Goldmark highlighting v2](https://github.com/yuin/goldmark-highlighting) + [Chroma v2](https://github.com/alecthomas/chroma) 生成带 class 的 HTML，颜色写在 `static/style.css` 末尾的几行规则里，与站点配色一致：关键字绿色、字符串与数字棕色、函数与变量蓝灰、注释灰色斜体。浏览器端 0 JS，不加行号、工具栏或复制按钮。

````markdown
```go
func main() {}
```
````

未标注或 Chroma 不认识的语言保持纯文本。代码区域可用键盘聚焦并横向滚动。

选型时（2026-10-02）比较过 Shiki 与 highlight.js：前者需要额外的 JS 构建工具链，后者需要在浏览器执行脚本，都不符合本站约束。
