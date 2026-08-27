---
name: data-viz
description: |
  数据可视化规范。当任务涉及画图（matplotlib 图表、回测结果图、博客文章配图、
  ECharts 交互图表）时使用。覆盖：图表类型选择、matplotlib 统一风格、回测常用
  图形的标准画法、向博客（MDX/ECharts）导出图表的规范。
---

# 数据可视化规范

## 图表选择

| 数据形态               | 图型                                       |
| ---------------------- | ------------------------------------------ |
| 时间序列（权益、价格） | 折线图                                     |
| 回撤随时间             | 水下曲线（回撤填色，y 轴向下为负）         |
| 两维参数网格的标量指标 | 热力图（heatmap）                          |
| 收益分布               | 直方图 + 正态参考线；尾部用对数 y 轴       |
| 多档参数的单指标对比   | 柱状图（参数为 x，标注最优档）             |
| 单笔盈亏序列           | 柱状图（正绿负红）                         |
| 期权策略到期损益结构   | payoff 图（行权价处折线 + 盈亏平衡点标注） |
| 隐含 vs 已实现波动     | 双线对比 + 差值填色                        |
| 两个变量的关系         | 散点图 + 趋势线                            |

不确定时用最简单的折线/柱状，不用 3D、不用饼图（超过 3 类时）。

## matplotlib 统一风格

```python
import matplotlib
matplotlib.use("Agg")  # 脚本环境；notebook 里用 %matplotlib inline 代替
import matplotlib.pyplot as plt

plt.rcParams.update({
    "figure.figsize": (10, 5),
    "figure.dpi": 120,
    "font.size": 10,
    "axes.grid": True,
    "grid.alpha": 0.3,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.unicode_minus": False,   # 负号正常显示
})
POS, NEG = "#1e8449", "#c0392b"  # 正绿负红，全项目统一
```

- macOS 中文：`plt.rcParams["font.family"] = ["PingFang SC", "Arial Unicode MS"]`；
  Colab/Linux 无中文字体时图内文字一律用英文，不要硬塞中文出方块。
- 保存：`fig.tight_layout(); fig.savefig(path, dpi=120)`，脚本环境每张图 `plt.close()`。

## 回测常用图形要点

- **权益曲线**：x 轴用真实日期（不是序号）；多参数对比时 `legend(ncol=4, fontsize=8)`；
  加 `axhline(0)` 参考线。
- **回撤水下曲线**：`drawdown = eq/eq.cummax() - 1`，`fill_between` 填色（NEG 色，
  alpha 0.3），标注最大回撤点和数值。
- **热力图**：`imshow(cmap="RdYlGn")` + colorbar 标注指标名；两轴标参数值；
  标题写清指标和标的。
- **payoff 图**（期权策略必备）：x 轴为到期价 S_T，y 轴为单笔 PnL（含权利金与
  费用）；各腿虚线、组合实线；标注行权价（竖虚线）与盈亏平衡点（与零轴交点）。
- **收益分布直方图**：叠加同均值同方差的正态密度参考线；左尾单独放大或用
  对数 y 轴，突出"多次小赢、少数大亏"的偏态。
- **单位纪律（最重要的坑）**：币本位和 USD 本位的曲线不能画在同一坐标轴；
  轴标签、图例、tooltip 必须带单位（BTC / ETH / USD / %）。

## 回测数据卡片与策略看板（标准模板，每个策略必备）

仿 TradingView Strategy Tester 的 performance summary。**每个回测策略在 notebook、README、博客文章里都必须有一张同一口径的数据卡片**。

1. **Notebook / README 标准 Markdown 表格**（由脚本从 results CSV 生成，不手抄）：

```markdown
| 指标                               | BTC | ETH |
| ---------------------------------- | --- | --- | -------------------------- | ------ |
| 净利润（币本位）                   |     |     | # sum(单笔 PnL)，带单位    |
| 交易数 / 胜率                      |     |     | # n；PnL>0 占比            |
| 盈利因子 Profit Factor             |     |     | # 总盈利 /                 | 总亏损 |
| 最大回撤                           |     |     | # min(eq/eq.cummax()−1)    |
| 平均交易 / 平均盈利笔 / 平均亏损笔 |     |     |
| 最好 / 最差单笔                    |     |     |
| Sharpe（注明频率与年化系数）       |     |     |
| 总手续费                           |     |     |
| 策略特有指标                       |     |     | # 如卖方策略的权利金留存率 |
```

2. **博客 MDX 性能看板组件（`<StrategyCard />` 纯 JSON 驱动）**：
   - 博客已内置标准 `StrategyCard` 组件（外观采用 `article-data-block` 容器样式），**严禁在 MDX 中手工编写复杂 HTML/JSX**，只需传入纯 JSON 数据：

```tsx
<StrategyCard
  title="35Δ 周末卖方策略 (Short Strangle)"
  subtitle="Deribit 官方公开历史 · 2022-09 至 2026-08 (208 周) · 单利币本位"
  data={{
    BTC: {
      totalPnl: '+1.166 BTC',
      totalPnlPct: '+116.6%',
      totalPnlUsd: '≈ $64,395',
      winRate: '81.25%',
      winCount: 169,
      lossCount: 39,
      profitFactor: '3.43',
      sharpe: '3.43',
      maxDd: '-0.105 BTC',
      maxDdPct: '-10.5%',
      retained: '47.1%',
      totalPremium: '2.475 BTC',
      avgWeekly: '+0.561%',
      avgWin: '+0.0097 BTC',
      avgLoss: '-0.0123 BTC',
      bestWeek: '+0.0269 BTC',
      worstWeek: '-0.0596 BTC',
      fees: '0.1389 BTC',
    },
    ETH: {
      totalPnl: '+1.146 ETH',
      totalPnlPct: '+114.6%',
      totalPnlUsd: '≈ $2,418',
      winRate: '78.85%',
      winCount: 164,
      lossCount: 44,
      profitFactor: '2.30',
      sharpe: '2.19',
      maxDd: '-0.111 ETH',
      maxDdPct: '-11.1%',
      retained: '34.3%',
      totalPremium: '3.343 ETH',
      avgWeekly: '+0.551%',
      avgWin: '+0.0124 ETH',
      avgLoss: '-0.0201 ETH',
      bestWeek: '+0.0474 ETH',
      worstWeek: '-0.1018 ETH',
      fees: '0.1406 ETH',
    },
  }}
/>
```

卡片上方一行必须写清口径：单利/复利、币本位/USD、样本窗口。

## 输出到博客（~/Developer/blog）

博客是 Next.js + MDX，支持交互式 ECharts，**优先用 ECharts，静态 PNG 是备选**。研究 Notebook 里的高价值图表必须全量导出呈现在博文中，不留遗憾。

- **ECharts 通道（排版第一优先级：清爽与无重叠）**：
  - **`legend` 必须置于顶部**：`"legend": { "top": 10, "right": 20 }` 或 `left: "center"`，严禁放在底部与 x 轴刻度/标签/dataZoom 撞车。
  - **`grid` 留足边距**：无 dataZoom 时 `top: 50, bottom: 40`；有 dataZoom 时 `bottom: 70`，`left: 65, right: 25`。
  - **`dataZoom` 显式设置**：slider 必须设置 `bottom: 10, height: 20`，避免遮挡坐标轴。
  - **`markLine` / `markPoint` 标签防撞**：标签位置设为 `"insideEndTop"` 或 `"end"`，严禁与轴刻度重叠。
  - 把数据整理成 ECharts option JSON，正文里用 ` ```echarts ` 代码块嵌入。标准折线图模板：

  ```json
  {
    "tooltip": { "trigger": "axis" },
    "legend": { "top": 10, "right": 20 },
    "grid": { "left": 65, "right": 25, "top": 50, "bottom": 70 },
    "xAxis": { "type": "category", "data": ["2024-01-05", "..."] },
    "yAxis": { "type": "value", "name": "累计 PnL (BTC)" },
    "dataZoom": [{ "type": "inside" }, { "type": "slider", "bottom": 10, "height": 20 }],
    "series": [{ "name": "Δ0.35", "type": "line", "showSymbol": false, "data": [0.001, "..."] }]
  }
  ```

  长序列数据点保留 4~6 位有效数字即可；tooltip 的 valueFormatter 带单位。

- **PNG 通道**：导出到 `blog/public/static/images/<post-slug>/`，正文引用
  `/static/images/<post-slug>/xxx.png`。导出 dpi 提高到 150，宽度按 1180px 内
  内容区设计。
- 正负着色与 matplotlib 一致：正 `#1e8449`，负 `#c0392b`。
- **数学公式支持**：博客支持 LaTeX（remark-math + MathJax 构建期渲染成 SVG）。
  - 行内公式使用 `$formula$`（如 `$S_T$`、`$r = 0$`、`$\sigma$`、`$K$`）。
  - 只有完整数学等式/模型方程才用 `$$...$$` 单独起段。严禁在行内使用 `$$...$$`。
- **TradingView 走势短语法支持**：
  - 独立段落输入 `$BTC`、`$ETH`、`$SOL` 等常见加密货币代码（系统会自动映射为 `BINANCE:${symbol}USDT` 实时行情）、美股代码 `$AAPL`（默认映射为 `NASDAQ:AAPL`）或显式交易所代码 `$BINANCE:BTCUSDT` 会直接渲染为 TradingView 迷你行情走势卡片（Mini Chart）。
  - 使用 `::tv BINANCE:BTCUSDT height=400` 可嵌入带完整指标的 TradingView 全功能交互图表。
- **策略性能看板（`<StrategyCard />`）**：在 MDX 中直接使用 `<StrategyCard data={{ ... }} />` 填入纯 JSON 字段，组件提供与 ECharts 风格统一的数据卡片与多标的 Tab 切换能力。
- **工具不限于 ECharts**：以演示清晰为最高优先级。ECharts 是默认选择；
  静态 matplotlib PNG（`/static/images/<post-slug>/`）、自包含 SVG、TradingView 组件等都可以，
  引入新客户端库需谨慎评估 bundle 与门禁影响并在汇报中说明。
- 表格比图更适合精确数字（如参数网格指标汇总），博客正文里图表和表格搭配用。
