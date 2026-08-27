---
name: data-viz
description: |
  数据可视化规范。当任务涉及画图（matplotlib 图表、回测结果图、博客文章配图、
  ECharts 交互图表）时使用。覆盖：图表类型选择、matplotlib 统一风格、回测常用
  图形的标准画法、向博客（MDX/ECharts）导出图表的规范。
---

# 数据可视化规范

## 图表选择

| 数据形态               | 图型                                 |
| ---------------------- | ------------------------------------ |
| 时间序列（权益、价格） | 折线图                               |
| 回撤随时间             | 水下曲线（回撤填色，y 轴向下为负）   |
| 两维参数网格的标量指标 | 热力图（heatmap）                    |
| 收益分布               | 直方图 + 正态参考线；尾部用对数 y 轴 |
| 多档参数的单指标对比   | 柱状图（参数为 x，标注最优档）       |
| 单笔盈亏序列           | 柱状图（正绿负红）                   |
| 两个变量的关系         | 散点图 + 趋势线                      |

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
- **单位纪律（最重要的坑）**：币本位和 USD 本位的曲线不能画在同一坐标轴；
  轴标签、图例、tooltip 必须带单位（BTC / ETH / USD / %）。

## 输出到博客（~/Developer/blog）

博客是 Next.js + MDX，支持交互式 ECharts，**优先用 ECharts，静态 PNG 是备选**。

- **ECharts 通道**：把数据整理成 ECharts option JSON，正文里用 ` ```echarts `
  代码块嵌入。折线图最小模板：

  ```json
  {
    "tooltip": { "trigger": "axis" },
    "grid": { "left": 70, "right": 20, "top": 40, "bottom": 60 },
    "xAxis": { "type": "category", "data": ["2024-01-05", "..."] },
    "yAxis": { "type": "value", "name": "累计 PnL (BTC)" },
    "dataZoom": [{ "type": "inside" }, { "type": "slider" }],
    "series": [{ "name": "Δ0.35", "type": "line", "showSymbol": false, "data": [0.001, "..."] }]
  }
  ```

  长序列数据点保留 4~6 位有效数字即可；tooltip 的 valueFormatter 带单位。

- **PNG 通道**：导出到 `blog/public/static/images/<post-slug>/`，正文引用
  `/static/images/<post-slug>/xxx.png`。导出 dpi 提高到 150，宽度按 1180px 内
  内容区设计。
- 正负着色与 matplotlib 一致：正 `#1e8449`，负 `#c0392b`。
- 表格比图更适合精确数字（如参数网格指标汇总），博客正文里图表和表格搭配用。
