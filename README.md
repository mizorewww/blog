# mizore / notes

一个用 Go 写的静态博客框架。文章是带 JSON 元数据的 Markdown，构建结果是纯静态的 HTML、RSS 和 sitemap：中英双语、按页面子集化的自托管字体、构建时渲染的公式、代码高亮、数据表格和 SVG 图表，正文不依赖 JavaScript。

文章里能用的组件见 [`.claude/skills/post-components/SKILL.md`](.claude/skills/post-components/SKILL.md)。

## 环境

- Go 1.26 或更新版本（见 `go.mod`）。
- [uv](https://docs.astral.sh/uv/)：只有新图片或改动过的图片需要，用来压缩图片。

所有命令都在仓库根目录运行。

## 构建

```sh
go run ./src                                            # 构建到 public/，网址取 site.json 的 url
go run ./src -url https://example.com/blog              # 换成别的网址，支持子路径
go run ./src -url http://localhost:8080 -serve localhost:8080   # 构建并在本机预览
go run ./src -drafts -url http://localhost:8080 -serve localhost:8080   # 预览时包含草稿
```

| 参数 | 作用 |
| --- | --- |
| `-url` | 覆盖 `site.json` 的站点网址，用于 canonical、RSS、sitemap 等绝对地址 |
| `-serve` | 构建完成后在这个地址启动预览服务器；修改内容后重新运行 |
| `-drafts` | 同时构建元数据里有 `"draft": true` 的文章 |

构建失败时（元数据、公式、表格、图片或站内链接有错）不会改动上一次的 `public/`。把 `public/` 上传到任意静态托管即可；Cloudflare Pages 会读取其中的 `_headers` 和 `_redirects`。

## 新建文章

```sh
go run ./src new "Hello Go"                     # content/posts/hello-go.md
go run ./src new -slug hello-world -description "一句话摘要。" -tag 随笔 "你好，世界"
go run ./src new -h                             # 全部参数
```

| 参数 | 作用 |
| --- | --- |
| `-title` | 标题，也可以作为最后一个参数直接给出 |
| `-slug` | 文件名和网址，只能用小写字母、数字和连字符；缺省时从英文标题生成，纯中文标题用时间戳 |
| `-description` | 摘要 |
| `-tag` | 分类 |
| `-date` | 发布日期 `YYYY-MM-DD`，默认今天 |

参数要放在标题前。同名文件已存在时报错，不会覆盖。正文模板是 `templates/post.md.tmpl`。

## 测试

```sh
go test ./...                                   # 单元测试和完整构建测试
sh scripts/lighthouse.sh http://localhost:8080  # 在预览运行时测量每篇文章的 Lighthouse 性能分
```
