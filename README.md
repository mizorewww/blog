# mizore / notes

一个参考 [Zed Blog](https://zed.dev/blog) 排版气质的极简个人博客。首页只有文章列表：日期、分类、标题、摘要和阅读时长。无导航、首屏介绍或页脚；使用贯穿页面的横线、两侧纵线和交点标记组织页面。

**静态 HTML · 默认 0 JS · 无框架 · 无 hydration · 无 bundler**

## 本地运行

需要 Go 1.25 或更新版本（测试环境：Go 1.27.3）。

```sh
go run . -url http://localhost:8080 -serve localhost:8080
```

打开 <http://localhost:8080>。示例文章在 <http://localhost:8080/posts/less-but-better/>。

上述预览命令只绑定本机，已启用 gzip 和 HTTP 缓存。修改内容后重新执行命令；没有热更新或浏览器脚本。生产部署只需要生成文件，不需要运行此服务器。

```sh
go run .                         # 使用 site.json 的生产 URL
# 或者指定自己的域名（也支持子路径部署）
go run . -url https://example.com/blog
```

将 `public/` 的内容上传到任意静态托管服务。配置目录 URL 对应 `index.html`，不存在的地址返回 `404.html` 并保持 HTTP 404。域名根目录部署时，`robots.txt` 可被标准爬虫直接发现；子路径部署时由域名根站点管理 robots.txt。

当前仓库为私有，尚未启用 GitHub Pages；配置中的 `https://mizorewww.github.io/blog-new` 是预设发布地址，不代表已经上线。发布到其他域名时务必修改 `site.json` 或传入 `-url`，以生成正确的 canonical、RSS 和 sitemap URL。

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
- 文章按日期倒序排列，同日按文件名排序。
- 所有文章都会发布，包括未来日期；草稿放在 `content/posts/` 之外。
- 支持常规 Markdown、表格、代码块和自动标题 ID；中文标题保留可读锚点，例如 `## 问题一：屏幕花屏` 对应 `#问题一屏幕花屏`。
- 文章目录自动提取 `##`、`###` 标题，桌面为侧栏，手机位于正文前，可原生折叠；无标题时不显示目录。
- 文末显示上一篇（更早）和下一篇（更新），同日按文件名顺序；首尾自动省略不存在的链接，只有一篇时不显示相邻文章导航。
- 文章页不展示分类、日期、阅读时长或作者署名；发布日期仍保留在 HTML 元数据和 RSS 中。
- 原始 HTML 与危险链接由 Goldmark 默认规则禁用；元数据由 `html/template` 转义。
- 阅读时长是按中英文内容粗略估算的。
- 本地图片在构建时自动压缩并重写地址，使用方法见下文「文章图片」。普通 Markdown 链接不重写。

## 文章图片

原图放在 `content/images/`，在文章里使用相对于 Markdown 文件的路径：

```markdown
![图片的内容说明](../images/photo.jpg)
```

关于页 `content/about.md` 使用 `images/photo.jpg`。保留有意义的替代文字，让屏幕阅读器与爬虫理解图片。

直接运行原来的 `go run .`，无需手动压缩。首次构建含本地位图的文章需要安装 [uv](https://docs.astral.sh/uv/getting-started/installation/)；它会为 `scripts/prepare-image.py` 自动准备锁定版本的 Pillow。没有本地位图时仍然只需 Go；浏览器端不增加依赖。

- JPEG、PNG、WebP、静态 GIF、AVIF：生成 WebP 候选，宽图按最大 1600 px 等比缩小，不放大小图。JPEG/WebP/AVIF 使用 quality 82；PNG/静态 GIF 使用无损编码，透明背景保留（缩小尺寸本身仍会重采样）。
- 只采用比原图更小的结果，否则保留原文件及原始尺寸。处理照片 EXIF 方向，生成的 WebP 不携带 EXIF；保留原文件的情况下也保留原有元数据。
- 动画与 SVG 原样保留，暂不压缩；远程 HTTP(S) 图片不下载、不压缩，若需优化请先保存到本地。
- `content/images/` 原图不会写入发布目录，也不会被覆盖。旧的 `../../static/photo.png` 或 `/static/photo.png` 图片引用也会优化，但 `static/` 本身仍作为公共资源复制，建议将大原图迁入 `content/images/`。
- 产物使用内容哈希文件名，进入现有一年期 immutable 缓存路径；文章与全文 RSS 自动引用带部署子路径的绝对地址。修改图片后 URL 随内容更新。
- 本地位图自动补充 `width` / `height`，减少布局跳动；每篇正文首张图片不懒加载，后续图片用原生 `loading="lazy"`，全部设置 `decoding="async"`。SVG、外链的尺寸不会自动探测。
- `.cache/images/` 按原图内容和处理脚本缓存，无变化时不重复编码；删除该目录即可重建。原图缺失或编码失败会中止构建，保留上次的 `public/`。

编码测试：`uv run scripts/test_images.py`。日常发布仍只上传 `public/`，无需部署 Python、uv 或 Go。

## 个性化

| 文件 | 用途 |
| --- | --- |
| `site.json` | 站点标题、作者、描述和正式 URL |
| `templates/page.html` | 文章列表、文章与关于页布局 |
| `static/style.css` | 颜色、字体、间距、响应式规则 |
| `static/favicon.svg` | `m.` 图标，可换成自己的标记 |
| `content/about.md` | 个人介绍 |
| `content/posts/*.md` | 文章 |
| `main.go` | 构建器与本地预览入口 |
| `images.go` / `scripts/prepare-image.py` | 本地图片重写、压缩与构建缓存 |
| `assets.go` / `serve.go` | 资源版本号与 HTTP 压缩、缓存 |
| `new.go` / `templates/post.md.tmpl` | 创建文章工具及正文模板 |

关于页有独立的个人资料链接，也应按需修改；RSS 仍通过 HTML head 提供自动发现。

## 输出与设计约束

- 首页、文章页、关于页、404：完整语义化 HTML，HTTP 响应包含全部正文。
- `feed.xml`：包含全文的 RSS 2.0。
- `sitemap.xml`、`robots.txt`：爬虫入口。
- canonical、description、Open Graph、文章日期、跳至正文链接、键盘焦点状态。
- 标题使用 Source Han Serif（思源宋体），正文和界面使用 Source Han Sans（思源黑体），代码保持系统等宽字体。
- Adobe 官方简体中文可变字体，自托管 WOFF2，按字符分片、`font-display: swap`，无第三方网络请求，无分析脚本。
- 字体已提交到 `static/fonts/`，字体无需日常重新生成；新增文字由浏览器自动加载对应分片。可选用 `uv run scripts/prepare-fonts.py` 重新优化当前文章的常用字符分片，工具不参与日常构建。
- 字体版本：Source Han Sans 2.005R / Source Han Serif 2.003R，SIL OFL 1.1 许可证保留在字体目录。
- Go 标准库处理模板、JSON、XML、日期和文件；Go 第三方依赖为锁定版本的 Goldmark 与代码高亮（goldmark-highlighting + Chroma）；含本地位图的构建另需 uv/Pillow。
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
