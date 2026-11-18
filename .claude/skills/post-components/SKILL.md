---
name: post-components
description: Reference for the Markdown components this blog framework supports in content/posts/*.md — metadata, images, formulas, code and source quotes, citations and reference lists, data tables, charts, ECharts figures, Mermaid diagrams, hand-drawn SVG sketches, frame strips with model boxes, case cards, annotated agent traces, interactive widgets a post scripts itself, stat cards and ticker cards — and the house style for charts and diagrams. Use when writing or editing a post, adding a chart or diagram, or when you need a component's exact syntax or options.
---

# 文章组件

文章是 `content/posts/<slug>.md`（英文版 `content/posts/en/<slug>.md`，同名即互为翻译）。下面每个组件写错时构建都会失败并指出文件和原因。

## 元数据

文件以单独一行 `---` 开头，随后是 YAML 元数据，再用单独一行 `---` 结束，最后接 Markdown 正文。

```markdown
---
title: "标题"
description: "一句话摘要"
date: 2026-10-24
tag: "折腾"
tags:
  - "Linux"
  - "Laptop"
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

其他字段会让构建失败。YAML 中包含冒号、井号等可能引起歧义的文本要加引号，最稳妥的方式是字符串统一使用双引号。slug（文件名）只能用小写字母、数字和单个连字符。

## 标题与目录

正文从 `##` 开始。`##` 和 `###` 自动进入目录并得到锚点，中文保留原文：`## 问题一：屏幕花屏` → `#问题一屏幕花屏`。

## Markdown

GFM：段落、列表、引用、链接、表格（`---:` 右对齐）、删除线、任务列表。原始 HTML 和 `javascript:` 链接会被丢弃。不支持脚注（用下面的参考资料）、提示块（`[!NOTE]`）、MDX/JSX 和 Obsidian 嵌入。

## 参考资料

正文里写 `[@key]` 引用一条文献，渲染成上标 `[n]`，点击跳到文献，鼠标悬停或键盘聚焦时预览全文；以 `[@key]` 开头的列表项定义这条文献，前面加上回到引用处的 ↑（被引用多次时是 ↑ 1 2）。

```markdown
一项元分析[@mccomb2023]发现……经典的角色榜样实验[@lockwood1997]又发现……

## 参考资料

### 比较与自我价值

- [@mccomb2023] McComb, C. A., … (2023). [A Meta-Analysis of …](https://doi.org/10.1080/15213269.2023.2180647). _Media Psychology, 26_(5), 612–635.
- [@lockwood1997] Lockwood, P., & Kunda, Z. (1997). [Superstars and Me](https://doi.org/10.1037/0022-3514.73.1.91). _JPSP, 73_(1), 91–103.
```

- 编号按定义的先后，从 1 开始，跨标题分组的多个列表连续编号（上例下一组从 3 开始）。按正文第一次引用的顺序排列定义，编号就从前往后递增。
- key 只用字母、数字、`-` 和 `_`，以字母或数字开头，如 `flynn2008`。文献条目本身是普通 Markdown，格式自己写（建议 APA，标题链到 DOI）。
- 引用了没定义的 key、同一个 key 定义两次、文献列表里混进不以 `[@key]` 开头的项，构建都会失败。定义了但没被引用的文献可以留着，只是没有 ↑。
- 后面紧跟 `(` 或 `[` 的 `[@name](url)` 仍是普通链接，比如链到 GitHub 用户。
- 同一处引用多条就连着写：`[@a][@b]` 渲染成 `[1][2]`。

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

## 动态图表 `echarts`

需要动画、悬停、图例开关，或者 `chart` 画不了的类型时用。主题已经配好颜色的类型：折线、柱状、散点、饼/环、热力图（含日历热力图）、桑基、树图、漏斗、雷达、箱线、K 线、仪表盘。其他类型或组件（如旭日图、`dataZoom`）还没有配色，构建会报“colors not from a var(--token)”，要先在 `templates/js/chart-theme.js` 里给它们设好 token 颜色。正文是一个 [ECharts 6](https://echarts.apache.org/zh/option.html) 的 option，必须是合法 JSON：

````markdown
```echarts title="每周模型调用，按模型" note="截至 11 月 1 日。" height="320"
{
  "tooltip": {"trigger": "axis"},
  "legend": {},
  "xAxis": {"type": "category", "data": ["08-07", "08-14", "08-21"]},
  "yAxis": {"type": "value"},
  "series": [
    {"name": "DeepSeek", "type": "bar", "stack": "all", "data": [3154, 7664, 6590]},
    {"name": "Gemini", "type": "bar", "stack": "all", "data": [0, 0, 3223]}
  ]
}
```
````

| 属性 | 说明 |
| --- | --- |
| `title` | 必填，图上方的标题，也是读屏文字；图号 FIGURE n 自动编 |
| `note` | 图下的注释：数据来源、时间范围、口径 |
| `height` | 像素，160–720，默认 360；宽度跟随正文 |

- 构建时在无头 Chrome 里画成静态 SVG，没有 JS 时也看得到（按正文宽度画好再缩放，手机上字会很小；RSS 阅读器不认 `var(--…)`，颜色会丢）。页面上图滚进视口时 ECharts 接管，图表动画画出，可悬停、可点图例。
- 只能写 JSON，不能写函数：`formatter` 用字符串模板，如 `"{value}%"`、`"{b}: {c}"`；`tooltip.valueFormatter` 也写成模板 `"{value}%"`，页面会把它变成函数。其他只接受函数的选项不能用。
- 系列类型写错（如 `"barz"`）、`series` 为空、或者某个系列画不出来，构建都会失败。
- **颜色只能写 `var(--名字)`**：写 `#hex`、`rgb()`、`red` 这样的颜色名会构建失败，这样深浅色都对。颜色键（`color`、`borderColor`、`inRange.color` …）里还可以写 `transparent`、`none`、`auto`、`gradient` 等关键字。可用：`clay`（强调）、`stone`（对照的中性色）、`sky`、`olive`、`kraft`、`fig`，以及 `ink`、`body`、`muted`、`faint`、`line`、`grid`、`card`、`paper`、`wash`、`clay-wash`。
- 主题（`templates/js/chart-theme.js`）已经设好字体、坐标轴、网格、提示框、动画和系列配色，option 里不要再写这些样式。
- 不要写 ECharts 的 `title` 组件，标题用 `title` 属性。`grid`、`legend` 位置一般不用改。

## 示意图 `mermaid`

流程、时序、状态、结构关系用 [Mermaid](https://mermaid.js.org/)，不要画 ASCII 图：

````markdown
```mermaid title="要不要接话" note="被点名不经过判断模型。"
flowchart TD
  M[群友消息] --> Q{被点名?}
  Q -- 是 --> A[主模型]
  Q -- 否 --> D[判断模型] -- 够格 --> A
```
````

属性只有 `title`（必填）和 `note`。构建时画成 SVG，配色跟随深浅色，页面上不加载任何脚本，节点一般不需要单独上色；要强调某个节点时，`style`/`classDef` 只能写 token，如 `style A fill:var(--clay-wash),stroke:var(--clay)`。语法错误会让构建失败并给出 Mermaid 的报错。正文栏约 700 px 宽，手机上约 324 px：比 520 px 宽的图在手机上横向滚动。流程图优先 `TD`（从上到下），一行写不下的节点文字会自动换行，节点控制在十个左右。

## 手绘示意图 `sketch`

Mermaid 自动排版不够用时（要并排对比、按比例画、画容器的层层嵌套、在一条色带上标位置），直接写 SVG。什么时候该画、怎么画得好，见 `post-diagrams` skill。样子学 Anthropic 工程博客的示意图：暖灰底板、细描边的节点、按角色上色的标签、细灰线加开口箭头、大量留白。

````markdown
```sketch title="前缀只追加，缓存才接得上" note="上：正确的投影；下：错误做法。"
<svg viewBox="0 0 704 180">
  <rect class="panel" x="0" y="0" width="704" height="180" rx="12"/>
  <text class="caps" x="24" y="30">只追加</text>
  <g class="node blue"><rect x="112" y="52" width="72" height="34" rx="4"/><text class="mid" x="148" y="69">system</text></g>
  <g class="node plain"><rect x="188" y="52" width="236" height="34" rx="4"/><text class="mid" x="306" y="69">历史消息</text></g>
  <path class="edge" d="M424 69 H470" marker-end="url(#arrow)"/>
</svg>
```
````

属性只有 `title`（必填）和 `note`。构建时只检查、不渲染，不需要 Chrome。

- **画布**：`viewBox="0 0 宽 高"`，宽一般就是 704（正文栏），高按内容定；`<svg>` 上不写 `width`/`height`/`class`/颜色，页面会自适应。
- **手机版**：手机正文栏只有约 324 px，704 宽的图会整体缩小到一半，小字看不清，并排的对比也挤成一团。所以稍复杂的图都在同一个代码块里再写第二个 `<svg>`：宽不超过 400 且比第一个窄（一般 340），把并排的东西改成上下排、把长标签换行。页面在 640 px 以下显示第二个，以上显示第一个。只有一个 `<svg>` 时，手机上整体缩小显示。
- **只能用画图元素**：`g rect circle ellipse line path polyline polygon text tspan defs marker use symbol clipPath title desc`。`script`、`style` 属性、`foreignObject`、渐变、事件属性、外部链接都会让构建失败。
- **颜色用 class**，需要时 `fill`/`stroke` 写 `var(--token)`（同 echarts 的 token 表，另有 `panel node node-line edge` 和 `blue teal orange violet` 及其 `-wash`、`-ink`、`clay-ink`），写死的颜色会构建失败。
- **id 会自动加上图的前缀**，`url(#id)` 和 `href="#id"` 跟着改；`marker-end="url(#arrow)"` 是现成的开口箭头，不用自己定义。

| class | 用在 | 样子 |
| --- | --- | --- |
| `panel` | 背景 `rect` | 暖灰底板，不描边；左右对比就画两块 |
| `window` | `rect` | 虚线圆角框：上下文窗口、沙箱、一组东西的边界 |
| `node` | 包住 `rect`+`text` 的 `g` | 暖灰填充、深灰细描边的节点 |
| `node plain` / `blue` / `teal` / `orange` / `violet` / `clay` | 同上 | 白底；或按角色上色：blue=system prompt/指令，teal=文档/产出/好的结果，orange=工具，violet=记忆/附注，clay=输入输出（配 `rx` 画成胶囊） |
| `edge`、`edge dash`、`edge hot` | `path`/`line` | 1.25px 灰线；虚线=可选/并行；clay=出问题的地方 |
| `caps` | `text` | 等宽小号、自动转大写，只用于板块标题，如“preprocessing” → PREPROCESSING；用户名、路径、参数这类区分大小写的名字不要放进去，用 `small` |
| `small`、`b`、`mid`、`end`、`accent` | `text` | 11px 灰色说明、加粗、居中、右对齐、clay 强调色 |
| `mono` | `text` | 11.5px 等宽，用来画请求原文、代码、哈希这类“原样”的内容 |
| `glyph` | `circle` | 模型图标的小圆点（几个点排成网格） |

画法：
- 先定网格：行高 34、节点间距 4–24、板块内边距 24；同一行的节点底边对齐，文字 `y` 取节点中线（`text` 已经垂直居中）。
- 中文 13px 一个字约 13px 宽，英文和数字约 8px；先算好文字宽度再定节点宽度，留 12px 以上左右余量。
- 连线用直角折线 `M x y H x2 V y2`，箭头指向节点边缘外 2–4px。
- 一张图讲一件事：对比就并排两块 `panel`，流程就一条主线，层级就嵌套 `window`。
- 写完一定在浏览器里看：深浅两种配色、1280 和 390 两种宽度（390 时看到的是手机版），文字不出框、不压线。

## 帧条 `frames`

一排视频帧或照片，每张下面写模型给的 P(present)（数字加一条细横条），P 不低于阈值的帧在图上画出模型的框，低于阈值的帧变灰、不画框。纯 HTML/CSS，框按百分比定位，任何宽度都压在图上；图片走和普通图片一样的流水线（WebP、宽高、`srcset`、懒加载）。

````markdown
```frames title="同一个问题，问 6 帧" q="问：the big white rabbit" note="Glance-4B-preview，MPS fp32。帧来自 Big Buck Bunny（© Blender Foundation，CC BY 3.0）。" cols="6"
../images/glance/bbb-0042.jpg | 0:42 | 0.99 | 212,88,520,402 | 兔子
../images/glance/bbb-0100.jpg | 1:40 | 0.03 | | 不在
```
````

每行 `图片 | 标签 | P | x1,y1,x2,y2 | 说明`：图片路径和普通图片一样（相对于 Markdown 文件）；标签一般是时间；P 是 0–1 的数；框是图片像素坐标（模型的原始输出），可以空着；说明可省略。

| 属性 | 说明 |
| --- | --- |
| `title` | 必填，图上方的标题；图号 FIGURE n 自动编 |
| `q` | 标题下的一行小字，写问的是什么 |
| `note` | 图下注释：模型、采样方式、**素材来源和许可** |
| `cols` | 每行几张，1–8，默认全部排一行；手机上最多 3 张 |
| `threshold` | 画框的阈值，默认 0.5 |
| `size` | 框所在的像素尺寸，如 `size="854x480"`；默认是图片文件自己的尺寸（构建时最宽 1600 px，原图更宽时要写） |

- 图片的替代文字由标签、P 和说明拼成。
- 只放有再发布许可的素材，在 `note` 里署名；评测集里只许用于评测的视频不要截帧。
- 每帧的数字必须是模型真实输出，`note` 写清模型、设备和采样间隔。

## 案例卡片 `cases`

把统计结论落到具体题目上：每张卡片是一道题、标准答案和各个模型的回答，答对的绿色加 ✓，答错的红色加 ✗，附注灰色加 ·（没有 CSS 的 RSS 阅读器里也分得清）。纯 HTML/CSS。

````markdown
```cases title="看到了，但看错了" note="来源：video/analysis/trace_labels.json。"
## ALLVB_2121 电影 · 感知
tag: 看错了
q: What colour is the man's shirt?
答案 | ok | (E) purple
Claude Opus 5.5 | bad | (C) red
备注 | note | 9/21 个 agent 选了 red
```
````

- `## ` 开始一张卡片，第一个词用等宽字（题号），其余是灰色说明。
- `tag:` 右上角的红色标签（错误类型）；`q:` 题目，加粗；`image:` 左侧 112 px 的方形缩略图（手机上 72 px），走普通图片流水线。三者都可省略，图片只放有再发布许可的素材。
- 其余每行 `谁 | ok/bad/note | 回答`，每张卡片至少一行。
- 属性只有 `title`（必填，图号自动编）和 `note`。

## 轨迹节选 `trace`

agent 运行记录的一段节选，关键的几行旁边写批注。等宽的“终端”面板，按类型上色，长输出自动折叠，`<details>` 折叠，不需要 JS。

````markdown
```trace title="评测框架报错时，答案已经写好了" note="GPT-6-Astra 在 Video-Index v1.1 Video-MME_2411 上的运行，节选。"
user | Which of the following …
cmd | ffmpeg -i video.mp4 -vf fps=1/8 sheet.jpg
fold | 中间 6 次工具调用
out | …
end
ans | {"answer_letter": "A"}
note | 答案已经写在最后一条消息里，而且是对的
error | technical_error: unfinished tool activity at turn completion
```
````

- 每行 `类型 | 文本`，只按第一个 `|` 切分，所以命令里的管道符原样保留。类型：`user`（题目）、`cmd`（命令，显示 `$`）、`out`（输出，灰色）、`tool`、`say`（agent 说的话）、`ans`（答案，绿色）、`error`（红色）。
- 以两个空格开头的行接在上一条后面（多行输出）；超过 6 行的条目只显示前 3 行，其余点开看。
- `note | 批注` 写在它批注的那一条后面，每条最多一个；有批注的行整行浅色高亮，批注在右侧（手机上在下面）。
- `fold | 摘要` 到单独一行 `end` 之间的条目折叠起来，只显示摘要；不能嵌套。
- 文本必须是原始记录（可以截断，用 `…` 标出），`note` 写清模型、题目和来源。属性只有 `title`（必填，图号自动编）和 `note`。

## 图表风格

图的样子参考 Anthropic 博客的图：安静、只强调一件事、数字直接写在图上。

- **一张图只说一个结论**，标题写成那个结论或者它回答的问题，`note` 写来源、时间范围和口径。数据必须是真实的，换算或假设要在 `note` 里说明。
- **只强调一个系列**：要读者看的那个用 `var(--clay)`，对照组用 `var(--stone)`；多个系列地位相同时才用默认配色。柱子突出单根时，在那根数据上写 `{"value": 25, "itemStyle": {"color": "var(--clay)"}}`，其余设为 `stone`。
- **直接标注，少用图例**：柱状图加 `"label": {"show": true, "position": "top"}`（横向用 `"right"`）；折线加 `"endLabel": {"show": true, "formatter": "{a}"}`，并把 `grid.right` 调大到能放下名字。只有两三个系列且没有直接标注时才用 `legend`。
- 阈值、事件用 `markLine` / `markArea` 标在图上，标签写清是什么（如“压缩阈值 110K”）。
- 坐标轴带单位（`"axisLabel": {"formatter": "{value}K"}`、`"name"`），大数换成千或百万。
- 手机上正文栏只有约 324 px：分类标签要短（“命中 85%”而不是“缓存命中率 85%（实测）”），细节放进 `note`；横向柱状图的分类名尤其要短，不然柱子会被挤得很窄。
- 数据来自某个快照或时间段时，`note` 写明截止时间；同一篇里和别的表口径不同时，说清差在哪里。
- 不要 3D、渐变、阴影、圆角大柱子，不要双 y 轴硬凑两个无关的量（两组量纲不同的数据用两个 `grid` 上下排）。

选组件：要读精确数值、或者行数多 → `data`；模型对一组图片或视频帧的判断 → `frames`；具体的失败案例 → `cases`；agent 运行记录 → `trace`；几个关键数字 → `stats`；要动画、交互或其他图形 → `echarts`；`echarts` 也做不到、需要读者自己操作的 → `widget`；简单的静态线/柱且不想加载脚本 → `chart`；普通的关系和流程 → `mermaid`；要讲清一个结构（对比、比例、嵌套、色带上的位置）→ `sketch`。

## 交互图 `widget`

别的组件都做不到、非得让读者自己拖、点、切换才看得懂的图（滑块调阈值、时间轴拖动、切换几种设置看结果怎么变），用这篇文章自己的脚本画。脚本只做增强：构建时放一张静态图，没有 JS、RSS 阅读器和首屏看到的都是它。

````markdown
```widget src="../widgets/glance/hero.js" title="拖动阈值，看框出现和消失" note="数据来源、模型、素材许可。"
../images/glance/hero.png | 静态图的替代文字：图上画了什么
../images/glance/hero-narrow.png | 手机版静态图的替代文字
```
````

| 属性 | 说明 |
| --- | --- |
| `src` | 必填，相对于 Markdown 文件的 ES module，必须在 `content/` 下某个文件夹里，一般是 `content/widgets/<名字>/xxx.js` |
| `title` | 必填，图上方的标题；图号 FIGURE n 自动编 |
| `note` | 图下注释 |

- 正文每行 `图片 | 替代文字`：第一行是静态图（必填），第二行可选，是 640 px 及以下显示的手机版。静态图走普通图片流水线；最好就是交互图默认状态的截图（浅色、正文宽度 704 px 和 390 px 各截一张），这样换成交互图时页面不跳。
- 构建把 `src` 所在的**整个文件夹**发布到 `/widgets/<文件夹名>-<内容哈希>/`（以 `.` 开头的文件除外）。文件夹里只能放 `.js .json .css .webp .png .jpg .jpeg .svg .woff2`，不能有符号链接，否则构建失败，原始输出和生成脚本放在别处。模块可以用相对地址 `import`、`fetch` 同文件夹里的其他文件（数据 JSON、精灵图）；任何文件变了网址就变，可以永久缓存。同一个文件夹可以给几张图共用，每张图一个入口模块。
- 页面 load 之后、图快滚进视口（提前 600 px）时，`templates/js/widget.js` 先加载同文件夹的 `style.css`（构建发现文件夹里有它，才让页面去取），再 `import()` 模块，调用它的默认导出：`export default async (stage, { figure, base }) => { … }`。`stage` 是一个空的 `div`，模块往里画；`base` 是文件夹的网址。返回（或 resolve）之后静态图隐藏、交互图显示；抛出异常就保留静态图。
- 文件夹里 `.js`、`.json` 的文字会并进这篇文章的字体子集，所以脚本里写的中文用的还是正文字体。
- 模块自己负责：颜色只用 `var(--token)`（深浅色跟着切换，主题切换时不用重画）；`prefers-reduced-motion` 时不做动画；键盘能操作（`button`、`input type=range`）；390 px 宽也成立；不请求任何第三方网址，用到的库放进文件夹里并核对许可。
- 数据必须是真实输出，预先算好放进 JSON；页面上只做筛选和插值，不跑模型。

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
