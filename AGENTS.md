# AGENTS.md

这是一个用 Go 写的静态博客（见 `README.md`）。文章在 `content/posts/`，框架代码在 `src/`、`templates/`、`static/`、`scripts/`。

## 写或改博客文章时

动笔之前先读这两个 skill，写作过程中按它们来：

- `.claude/skills/post-components/SKILL.md`：文章能用的组件和确切语法（元数据、公式、代码、`data`、`chart`、`echarts`、`mermaid`、`sketch`、`stats`……），以及图表风格。
- `.claude/skills/post-diagrams/SKILL.md`：什么时候该画示意图（多画）、本博客的示意图风格、好图的标准和画图流程。

写完要构建并在浏览器里看过每一张图（浅色、深色、手机宽度），数字要和正文、数据对得上。

## 改框架代码时

按 `REVIEW.md` 的审查标准做：`go vet ./...`、`go test ./...`、`gofmt -l .` 无输出，`go run ./src` 能完整构建；改了文章组件就同步改 `post-components` skill，改了 CLI 就改 `README.md`。提交保持原子。
