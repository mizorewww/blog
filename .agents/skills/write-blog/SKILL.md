---
name: write-blog
description: |
  在本仓库撰写或修改博客文章。当用户说"写一篇博客"、"发文章"、"把 XX 写成博客"、
  "把回测结果发成文章"时使用。流程遵循 .agents/instructions/write-blog.md
  （yarn write-blog create、frontmatter、构建验证、humanizer-zh 润色），
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
4. 中文文章定稿前读 `.agents/skills/humanizer-zh/SKILL.md` 并对正文去 AI 痕迹。
5. `yarn content:generate` + `yarn build` 验证，再按 AGENTS.md 跑确定性门禁。
6. 发布前去掉 `--draft`。

## 回测/量化类文章专项要求

这类文章的素材来自回测仓库（`~/Developer/backtest/tasks/NNNN-*/`）。
分类一律 `Trading`，放 `content/blog/zh/Trading/`（文件夹名即分类名，与
`技术`/`折腾` 同级）。

**结构**（七段，顺序不机械，但都不能缺；文章要写详细，每个环节展开讲透，
不写"电报体"）：

1. **策略是什么**：一句话规则 + 为什么可能赚钱（经济逻辑，如波动率风险溢价）。
   开头就把"这不是套利、是在承担尾部风险"这类定性说清楚。
2. **数学与定价**：策略涉及的公式全部用 LaTeX 写出（`$$...$$`，构建期 MathJax
   渲染）：定价模型、希腊值/信号定义、费用模型、损益公式、指标定义（Sharpe、
   留存率等）。公式与 backtest 代码里的实现一一对应，逐个解释每个符号的含义
   和取值的来源假设。
3. **数据与假设**：数据源、窗口、样本量、关键假设（成交价、费用、滑点）。
4. **结果**：开头放标准回测数据卡片（指标集与模板见
   `.agents/skills/data-viz/SKILL.md`），然后图表展开。**最少图集**：到期
   payoff 结构图、累计权益曲线、回撤水下曲线、逐笔盈亏柱状、收益分布直方图、
   参数敏感性（网格表 + 柱状/热图）——不少于 6 张；图不够就是没有讲清楚。
   数据从任务 results/ 的 CSV 生成，不手抄数字。
5. **怎么解读**：区分收益口径和风险调整口径；指出样本内最优≠未来最优。
6. **风险与局限**：滑点、成交价假设、保证金、样本期偏差。这一节必须实质性，
   不能一句"回测不代表未来"带过。
7. **复现**：链接 GitHub 上对应任务的 notebook（Colab badge）。

**红线**：

- 标题和正文不得暗示稳定盈利（"躺赚"、"稳赚"、"印钞机"一律禁用）；
  收益数字必须和风险指标（最大回撤、胜率、尾部案例）同时出现。
- 文末固定声明：历史样本内统计，不构成投资建议。
- 每个数字可溯源到 backtest 仓库的 results 文件；写作时把来源任务编号
  记进 frontmatter 的 tags（如 `backtest-0001`）。
- 图表遵循项目级 skill `.agents/skills/data-viz/SKILL.md`：单位标注、
  币本位/USD 不混轴、正负红绿一致。
