---
name: write-blog
description: |
  在本仓库撰写或修改博客文章。当用户说"写一篇博客"、"发文章"、"把 XX 写成博客"、
  "把回测结果发成文章"时使用。流程遵循 .agents/instructions/write-blog.md
  （yarn write-blog create、frontmatter、构建验证、humanizer-zh / trading-humanizer 润色），
  本 skill 补充回测/量化类文章的专项要求。
---

# 写博客

## 通用流程

严格按 `.agents/instructions/write-blog.md` 执行，要点：

1. 确认主题、读者、语言（默认 zh）、主要结论。
2. `yarn write-blog create --title ... --locale zh --slug <显式 slug>` 建骨架；
   中文标题必须显式给 slug，不自动生成拼音。
3. 正文遵循 `docs/content.md` 的 MDX 规范（GFM、代码块语言标注、`:icon:`、
   ` ```echarts ` 或 `<ECharts />`、图片放 `public/static/images/`）。
4. 中文文章定稿前进行人味与去 AI 痕迹润色：通用文章读 `.agents/skills/humanizer-zh/SKILL.md`；
   量化/交易/回测类文章必须读并严格执行 `.agents/skills/trading-humanizer/SKILL.md`。
5. `yarn content:generate` + `yarn build` 验证，再按 AGENTS.md 跑确定性门禁。
6. 发布前去掉 `--draft`。

## 回测/量化类文章专项要求

这类文章的素材来自回测仓库（`~/Developer/backtest/tasks/NNNN-*/`）。
分类一律 `Trading`，放 `content/blog/zh/Trading/`（文件夹名即分类名，与
`技术`/`折腾` 同级）。写作与润色必须严格遵循 `.agents/skills/trading-humanizer/SKILL.md`。

**结构**（包含两根定海神针与完整量化叙事，顺序自然展开，讲透细节，不写"电报体"与机器报告）：

1. **策略介绍与动机（定海神针 1）**：以真实老交易员的人味引子开场（市场痛点、划水行情、持仓困惑），
   直白讲清一句话规则、收益来源（波动率溢价、Theta 衰减）与风险本质（非套利，赚的是保费，赌的是周末不出黑天鹅，左尾极厚）。
2. **怎么操作（定海神针 2 - 保姆级实操手把手）**：具象化实盘演练！设定具体场景（如 1 个 BTC 现货、
   北京时间周五 24:00 打开 Deribit 网页）、图解式指引（挑 35Δ 合约、分别卖出 1 张 Call 和 1 张 Put）、
   保证金与风控测算、周日 08:00 UTC 自动交割结算全流程，让小白也能无障碍下单。
3. **数学与定价**：公式全部用 LaTeX 写出。**红线**：只有完整数学等式才用 `$$...$$` 单独起段；
   **严禁**在正文行内把单个变量写成 `$$S$$`、`$$K$$`（变量一律用斜体 `*S*`、`*K*` 或代码块 `` `S` ``）。
   公式与 backtest 代码一一对应，逐个解释符号含义与假设。
4. **数据与假设**：数据源、窗口、样本量、关键假设（成交价、费用、滑点、币本位机制）。
5. **结果与全量图集**：开头放标准回测数据卡片（见 `.agents/skills/data-viz/SKILL.md`）。
   Notebook 里的所有漂亮研究图**全量导出并呈现在博客中**（不少于 6-7 张）：到期 Payoff 结构图、
   累计权益曲线、回撤水下曲线、逐笔盈亏柱状、收益分布直方图+尾部对数图、参数敏感性（网格表 + 柱状/热图）。
   ECharts 图例必须置顶，grid 留足边距，dataZoom slider 显式设置位置与高度，杜绝元素重叠。
6. **怎么解读与交易心理**：区分收益口径和风险调整口径；指出样本内最优≠未来最优；分享真实的盯盘心理与持仓体验。
7. **风险与局限**：滑点、盘口流动性、保证金占用、样本期偏差。必须实质深刻，不能一句带过。
8. **复现**：链接 GitHub 上对应任务的 notebook（Colab badge）。

**红线**：

- 必须以真实交易员视角复盘，拒绝 AI 腔、空洞学术综述与冷冰冰的电报体。
- 标题和正文不得暗示稳定盈利（"躺赚"、"稳赚"、"印钞机"一律禁用）；
  收益数字必须和风险指标（最大回撤、胜率、尾部案例）同时出现。
- 严禁在正文行内使用 `$$变量$$` 语法破坏排版。
- ECharts 图表 `legend` 严禁置底撞车，必须置顶；Notebook 研究图必须全量导出。
- 文末固定声明：历史样本内统计，不构成投资建议。
- 每个数字可溯源到 backtest 仓库的 results 文件；写作时把来源任务编号
  记进 frontmatter 的 tags（如 `backtest-0001`）。
- 图表遵循项目级 skill `.agents/skills/data-viz/SKILL.md`：单位标注、
  币本位/USD 不混轴、正负红绿一致。
