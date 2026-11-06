---
name: post-diagrams
description: How to plan and draw diagrams for posts in this blog — when a section deserves one (more often than you think), the house diagram style learned from Anthropic's engineering blog, what makes a diagram excellent, a catalog of patterns, and the draw-check-review workflow. Use whenever writing or revising a post in content/posts/, or when adding, redrawing or reviewing any figure. Pair it with post-components for the exact fence syntax.
---

# 示意图：画什么、怎么画好

组件的语法（` ```sketch `、` ```mermaid `、` ```echarts ` 的属性和 class）在 `post-components` skill 里；这里讲判断和手艺。

## 多画图

读者扫一眼图，比读三段解释更快明白一个结构。写文章时默认要画，而不是默认不画：

- **每一节在讲“它是怎么工作的”，就配一张示意图。** 流程、架构、请求的组成、前后两种做法的对比、层层嵌套的边界、一个参数的取舍，都是图。
- **看到这些信号就该画**：一段文字里出现“先……再……然后”；一个编号列表在描述结构而不是步骤；正文里有 ASCII 框图；在比较“A 做法 vs B 做法”；在说“X 占了多少”“越大越……”。
- **ASCII 图一律换成 `mermaid` 或 `sketch`。** 代码块里的框线在手机上会折行，深色模式里也不跟随主题。
- 一篇几千字的技术文章，通常该有 4–8 张图（数据图另算）。少于这个数，回头找找哪几节只靠文字在硬撑。
- 图不替代文字：正文仍然要把结论说出来，图负责让人一眼看懂“长什么样”。

## 选哪种

| 想表达 | 用 |
| --- | --- |
| 数量、趋势、分布、占比 | `echarts`（要动画、悬停）、`chart`、`data`、`stats` |
| 普通的流程、分支、时序，节点十个以内 | `mermaid`，自动排版，最省事 |
| 结构本身就是重点：按比例的组成、并排对比、嵌套边界、色带上的位置、两次请求逐段对齐 | `sketch`，手写 SVG |

拿不准时：如果“放在哪里”本身有含义（对齐、比例、包含关系），就用 `sketch`；如果只是“谁连到谁”，用 `mermaid`。

## 风格（学 Anthropic 工程博客）

参考 Anthropic 的 [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)、[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)、[Contextual retrieval](https://www.anthropic.com/engineering/contextual-retrieval) 里的图。它们的共同点，也就是 `.sketch` 的 class 编码的东西：

- **安静的底**：暖灰的大圆角底板（`panel`），不描边；左右对比就是两块底板。板块标题用等宽小号大写（`caps`），如 PREPROCESSING / RUNTIME。
- **节点**：暖灰填充 + 1.25px 深灰描边的小圆角矩形（`node`）；白底（`node plain`）表示消息、文本、普通内容。
- **颜色只表达角色**，一张图里同一种颜色永远指同一类东西：
  - `blue` system prompt、指令
  - `teal` 文档、产出、好的结果
  - `orange` 工具、外部调用
  - `violet` 记忆、附注、元数据
  - `clay` 输入/输出（配大 `rx` 画成胶囊），以及“这里出问题了”（`edge hot`、`accent`）
- **边界**：虚线圆角框（`window`）= 上下文窗口、沙箱、一次请求、可以被裁掉的范围。
- **连线**：1.25px 灰线、直角折线、开口箭头（`marker-end="url(#arrow)"`）；虚线（`edge dash`）= 可选、并行、按需。连线上的标签用 `small`，放在线旁边，不压线。
- **图标克制**：模型用一小簇圆点（`glyph`）；不画 logo、不画剪贴画、不用阴影和渐变。
- **大量留白**：内容只占底板的六七成，四周至少 24px。

## 好示意图的标准

1. **一张图只说一件事**，标题就是这件事（“前缀只追加，缓存才接得上”，而不是“缓存示意图”）。`note` 写读图方法和数据来源。
2. **画真实的机制**：节点名用系统里真实的名字（`send`、`tg_messages`、`/work`），不要“模块 A”“服务 B”。
3. **位置有含义**：同一行 = 同一时刻或同一请求；对齐 = 相同；按比例的高度/宽度要真的按比例，并在 `note` 里说明。
4. **对比用完全相同的骨架**：两种做法并排时，同样的东西画在同样的位置，读者只需要找不同。
5. **把错误做法也画出来**：正确做法 + 用 clay 标出断点的错误做法，比单画正确做法更有说服力。
6. **一条主线**：从左到右或从上到下，只有一个方向；回路用一条弯回去的虚线，不要交叉。
7. **少**：节点十个左右，标签几个字；解释交给正文和 `note`。删掉一个元素图还成立，就删掉。
8. **数字和正文一致**：图里的每个数字都要能在正文或数据里找到出处；不确定的不画。图里的步数、次数和正文说法不一样时（例如图只画了两轮，正文说“四五轮”），在 `note` 里说清楚。
9. **示意要说是示意**：色带、曲线、面积这类看起来像测量结果的形状，如果没有数据支撑，`note` 里写明“示意，不是实测”。
10. **读得清**：最小字号 11px；深色模式下每个颜色都还分得开；文字不出框、不压线。
11. **手机上也成立**：图的要点在 390 px 宽度下必须完整可见。宽图写第二个 `<svg>` 作为手机版（并排改上下、长句换行），不要指望读者横向滚动去找另一半。

## 常用版式

| 版式 | 适合 | 本博客的例子 |
| --- | --- | --- |
| 流水线：胶囊输入 → 节点 → 胶囊输出 | 一个请求怎么流过系统 | 接话路由（mermaid） |
| 按比例的堆叠：虚线框里分层 | 某样东西由什么组成、各占多少 | 一次请求里都装了什么 |
| 逐行对齐：每行一次请求/一个版本 | 前后两次的差别、缓存为什么命中或失效 | 前缀只追加，缓存才接得上 |
| 并排两块底板 | 两种做法对比 | 同一个任务，两种跑法 |
| 色带 + 标注卡片 | 一个参数太小/刚好/太大 | 窗口开多大 |
| 嵌套边界 | 权限、隔离、信任的层级 | 一台完整的 Linux，装在几层边界里 |
| 扇出/扇入 | 并行、多个子任务汇总 | codemode 里的并行检索 |

例子都在 `content/posts/save-a-little-more.md`，照着改比从零写快。

## 怎么做

1. **先写一句话**：这张图要让读者明白什么。写不出来就先别画。
2. **在纸上（或脑子里）定版式**：从上面的表里挑一种，定方向、分几块、哪个元素用强调色。
3. **写 SVG**：
   - 画布宽 704（正文栏），先定网格：板块内边距 24、行高 34、节点间距 4–24。
   - 再画手机版：宽 340，内边距 16；并排的板块改成上下排，横排太长的一行拆成两行，标签放到行上方。
   - 文字宽度先算：中文 13px 约 13px/字，英文数字约 8px/字（11px 的 `small` 约 11px 和 6.6px）；节点宽 = 文字宽 + 左右各 12 以上。
   - 坐标多的图，在 scratchpad 里写个小脚本算坐标、生成 SVG，再贴进文章；脚本不进仓库。
4. **构建并在浏览器里看**（宽版和手机版都要看）：`go run ./src -drafts -url http://localhost:8080 -serve localhost:8080`，用浏览器工具截图，检查浅色、深色（`document.documentElement.dataset.theme`）、1280 和 390 宽度。逐张看：文字出框、压线、对不齐、太挤，改到没有为止。
5. **让审查 subagent 逐张审**：每张图单独给出 PASS/FAIL 和理由（说清一件事、数字准确、清晰、合乎风格）；有 FAIL 就改，再审。
