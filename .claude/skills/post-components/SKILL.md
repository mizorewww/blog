---
name: post-components
description: Reference for the Markdown components this blog framework supports in content/posts/*.md — metadata, images, formulas, code and source quotes, data tables, charts, stat cards and ticker cards. Use when writing or editing a post and you need a component's exact syntax or options.
---

# 文章组件

文章是 `content/posts/<slug>.md`（英文版 `content/posts/en/<slug>.md`，同名即互为翻译）。下面每个组件写错时构建都会失败并指出文件和原因。

## 元数据

文件第一部分是 JSON，随后单独一行 `---`，再接 Markdown 正文。

```markdown
{"title":"标题","description":"一句话摘要","date":"2026-10-24","tag":"折腾","tags":["Linux","Laptop"]}
---
正文。
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 页面 h1；正文里不要再写 `# 标题` |
| `description` | 是 | 首页列表、RSS 和 meta description 里的摘要 |
| `date` | 是 | 发布日期 `YYYY-MM-DD` |
| `updated` | 否 | 实质修改日期，不早于 `date` |
| `tag` | 否 | 分类，只有一个，生成 `/categories/<名字>/` |
| `tags` | 否 | 标签列表，生成 `/tags/<名字>/` |
| `draft` | 否 | `true` 时正式构建跳过，`-drafts` 才构建 |
| `aliases` | 否 | 旧地址列表，如 `["/zh/折腾/x/"]`；生成 301 跳转，第一项也是 RSS guid |

其他字段会让构建失败。slug（文件名）只能用小写字母、数字和单个连字符。

## 标题与目录

正文从 `##` 开始。`##` 和 `###` 自动进入目录并得到锚点，中文保留原文：`## 问题一：屏幕花屏` → `#问题一屏幕花屏`。

## Markdown

GFM：段落、列表、引用、链接、表格（`---:` 右对齐）、删除线、任务列表。原始 HTML 和 `javascript:` 链接会被丢弃。不支持脚注、提示块（`[!NOTE]`）、MDX/JSX 和 Obsidian 嵌入。

## 图片

```markdown
![替代文字](../images/photo.jpg)
```

- 路径相对于 Markdown 文件，原图放在 `content/images/`；也可以写 `/static/…`。
- JPEG、PNG、WebP、静态 GIF、AVIF 在构建时转成更小的 WebP（最宽 1600 px，宽图另有 720 px 版本给手机），自动补上宽高。SVG 和动图原样发布。
- 第一张图优先加载，其余懒加载。`http(s)://` 远程图片原样引用。

## 公式

行内 `$E = mc^2$`；独立公式把 `$$` 各放一行：

```markdown
$$
\frac{a}{b}
$$
```

构建时转成 MathML。`$` 后是空格、结束的 `$` 前是空格或后面紧跟数字时不算公式，所以 `$5 和 $10` 保持原样；需要字面 `$` 时写 `\$`。不支持的命令会让构建失败，例如 `\arg` 要写成 `\mathrm{arg}`。

## 代码

````markdown
```go
func main() {}
```
````

标明语言时构建时高亮，角落显示语言名和复制按钮；不标或语言未知时为纯文本。

引用 GitHub 源码时加 `src`（必须是带 commit 哈希的 blob 永久链接），可选 `title`；显示文件路径、真实行号和提交：

````markdown
```go src="https://github.com/owner/repo/blob/ad8012c1a0926822307f56454bd26be9ef9dd2dc/main.go#L76-L103" title="入口"
…
```
````

## 数据表格 `data`

````markdown
```data title="12 档 delta 的 Sharpe 对比" bars="BTC,ETH" mark="Δ0.35" note="周频收益 × √52 年化。"
Delta | BTC  | ETH
Δ0.05 | 4.40 | 1.18
Δ0.35 | 3.43 | 2.19
```
````

| 属性 | 说明 |
| --- | --- |
| `title` | 表格标题 |
| `note` | 表下注释 |
| `bars` | 画横条的列名，逗号分隔；横条从 0 开始，负值另一种颜色 |
| `scale` | `shared`（默认，所有横条共用比例）或 `column`（每列各自缩放） |
| `mark` | 强调的行，按第一列的值匹配，逗号分隔 |

第一行是表头，`|` 分隔，首尾 `|` 和 `---` 分隔行可有可无。单元格是纯文本；单元格里的第一个数字决定横条长度（`+1.2 BTC`、`−3.4%`、`$64,395` 都能识别）。全是数字的列自动右对齐。

## 图表 `chart`

和 `data` 一样的表格写法：第一列是 x（`YYYY-MM-DD` 日期、数字或分类），其余每列是一条序列。构建时画成静态 SVG，悬停显示数值。

````markdown
```chart line title="累计 PnL" note="每周五入场。"
周五 | BTC | ETH
2022-09-02 | -0.001 | -0.006
2022-09-09 | 0.004 | 0.002
```
````

| 类型 | 说明 |
| --- | --- |
| `line` | 折线；x 是日期时末端标出数值 |
| `area` | 面积 |
| `bar` | 柱状；单序列正负两色，多序列并排 |
| `scatter` | 散点，三列：标签 \| x \| y |

| 属性 | 说明 |
| --- | --- |
| `title`、`note` | 标题、图下注释 |
| `panels="true"` | 每条序列一格，各自 y 轴，共用 x 轴 |
| `mirror="true"` | 两条柱状序列背对背，第二条向下 |
| `diag="true"` | 散点加 y = x 参考线 |
| `mark` | 要标注的散点标签，逗号分隔 |
| `ref` | 竖直参考线的 x 值，逗号分隔 |
| `xfmt`、`yfmt` | printf 格式，如 `yfmt="%.0f%%"` |
| `xscale` | x 先乘以它再按 `xfmt` 格式化，如 `xfmt="$%.0fk" xscale="0.001"` |

## 指标卡 `stats`

````markdown
```stats title="周末卖方策略" meta="Deribit · 208 周" note="单利，币本位。"
## BTC 单利币本位
总收益 | +1.166 | +116.6%
胜率 | 81.25% | 169 / 39 周
```
````

`## ` 开始一组，第一个词加粗。其余每行是 `标签 | 数值 | 说明`（说明可省略）；以 `+` 开头的数值用强调色。属性：`title`、`meta`（标题右侧的小字）、`note`。

## 行情卡

单独一段写：

```markdown
::tv BINANCE:BTCUSDT 比特币 interval=W height=480
```

或只写 `$BTC`、`$NASDAQ:AAPL`。常见币种（BTC、ETH、SOL……）自动对应 Binance 的 USDT 交易对。生成一张带 TradingView 链接的卡片，读者点击按钮后才加载实时图表。`interval` 默认 `D`，`height` 默认 420。
