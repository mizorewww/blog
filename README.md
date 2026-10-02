# mizore / notes

一个参考 [Zed Blog](https://zed.dev/blog) 排版气质的极简个人博客。首页只有文章列表：日期、分类、标题、摘要和阅读时长。无导航、首屏介绍或页脚；使用贯穿页面的横线、两侧纵线和交点标记组织页面。

**静态 HTML · 默认 0 JS · 无框架 · 无 hydration · 无 bundler**

## 本地运行

需要 Go 1.23 或更新版本（测试环境：Go 1.27.1）。

```sh
go run . -url http://localhost:8080 -serve localhost:8080
```

打开 <http://localhost:8080>。示例文章在 <http://localhost:8080/posts/less-but-better/>。

预览服务器只绑定本机。修改内容后重新执行命令；没有热更新或浏览器脚本。生产部署只需要生成文件，不需要运行此服务器。

```sh
go run .                         # 使用 site.json 的生产 URL
# 或者指定自己的域名（也支持子路径部署）
go run . -url https://example.com/blog
```

将 `public/` 的内容上传到任意静态托管服务。配置目录 URL 对应 `index.html`，不存在的地址返回 `404.html` 并保持 HTTP 404。域名根目录部署时，`robots.txt` 可被标准爬虫直接发现；子路径部署时由域名根站点管理 robots.txt。

当前仓库为私有，尚未启用 GitHub Pages；配置中的 `https://mizorewww.github.io/blog-new` 是预设发布地址，不代表已经上线。发布到其他域名时务必修改 `site.json` 或传入 `-url`，以生成正确的 canonical、RSS 和 sitemap URL。

## 写文章

在 `content/posts/` 新建文件，例如 `hello-world.md`。文件名即 URL slug，只允许小写英文字母、数字和连字符。

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
- 支持常规 Markdown、表格、代码块和自动标题 ID。
- 文章目录自动提取 `##`、`###` 标题，桌面为侧栏，手机位于正文前，可原生折叠；无标题时不显示目录。
- 文末显示上一篇（更早）和下一篇（更新），同日按文件名顺序；首尾自动省略不存在的链接，只有一篇时不显示相邻文章导航。
- 文章页不展示分类、日期、阅读时长或作者署名；发布日期仍保留在 HTML 元数据和 RSS 中。
- 原始 HTML 与危险链接由 Goldmark 默认规则禁用；元数据由 `html/template` 转义。
- 阅读时长是按中英文内容粗略估算的。
- 图片可放在 `static/`。Markdown 链接不会自动重写，使用绝对地址时请包含部署子路径；从文章页链接站内资源可使用 `../../static/your-image.webp`。

## 个性化

| 文件 | 用途 |
| --- | --- |
| `site.json` | 站点标题、作者、描述、正式 URL、GitHub 地址 |
| `templates/page.html` | 文章列表、文章与关于页布局 |
| `static/style.css` | 颜色、字体、间距、响应式规则 |
| `static/favicon.svg` | `m.` 图标，可换成自己的标记 |
| `content/about.md` | 个人介绍 |
| `content/posts/*.md` | 文章 |
| `main.go` | 约 280 行的构建器与本地预览服务器 |

关于页有独立的个人资料链接，也应按需修改；RSS 仍通过 HTML head 提供自动发现。

## 输出与设计约束

- 首页、文章页、关于页、404：完整语义化 HTML，HTTP 响应包含全部正文。
- `feed.xml`：包含全文的 RSS 2.0。
- `sitemap.xml`、`robots.txt`：爬虫入口。
- canonical、description、Open Graph、文章日期、跳至正文链接、键盘焦点状态。
- 标题使用 Source Han Serif（思源宋体），正文和界面使用 Source Han Sans（思源黑体），代码保持系统等宽字体。
- Adobe 官方简体中文可变字体，自托管 WOFF2，按字符分片、`font-display: swap`，无第三方网络请求，无分析脚本。
- 字体已提交到 `static/fonts/`，正常构建只需 Go；新增文字由浏览器自动加载对应分片。可选用 `uv run scripts/prepare-fonts.py` 重新优化当前文章的常用字符分片，工具不参与日常构建。
- 字体版本：Source Han Sans 2.005R / Source Han Serif 2.003R，SIL OFL 1.1 许可证保留在字体目录。
- Go 标准库处理模板、JSON、XML、日期和文件；唯一第三方依赖为锁定版本的 Goldmark。
- 构建先写临时目录，全部成功后替换 `public/`，避免内容或模板错误破坏已有输出。替换并非无缝在线发布，请通过托管平台部署产物。
- 没有评论、搜索、客户端路由、Service Worker 或动态后端。

## 验证

```sh
go test ./...
go vet ./...
```

测试覆盖非法元数据与日期、危险 HTML、子路径链接、全文 RSS、sitemap、中文及重复标题目录、相邻文章首尾边界、旧产物清理，以及失败构建保留原有输出。

切换思源字体前的本地 Lighthouse 移动端测试（2026-10-02，localhost）：首页和示例文章页 Performance / Accessibility / Best Practices / SEO / Agentic browsing 均为 **100**。这不是线上成绩保证；托管延迟、缓存、压缩和后续文章资源都会影响结果。

切换为自托管思源字体后，示例文章页移动端复测：Performance **90**，其余四项 **100**。当前文章仅请求两个常用字体分片，合计约 290 KiB。

如需复测，可临时使用 Lighthouse CLI；Node.js 仅用于可选审计，不参与站点构建：

```sh
npx --yes lighthouse http://localhost:8080 --chrome-flags='--headless' --view
```
