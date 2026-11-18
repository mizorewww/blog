---
title: "Glance：一眼问完八个问题，而且敢说“不在”"
description: "一次前向，回答一张图上的一串问题，每个答案都带概率，包括“不在”。"
date: 2026-11-18
tag: "技术"
tags:
  - "llm"
  - "vision"
  - "grounding"
  - "agent"
draft: false
---

```widget src="../widgets/glance/hero.js" title="一张图，八个问题，一次前向" note="Glance-4B-preview 的真实输出，事先跑好，页面上只做筛选。两个阈值只作用于框问题：P(present) 低于第一个就回答“不在”，P(IoU ≥ 0.5) 低于第二个就把框标成“不准”。67 ms 是 RTX PRO 6000 上一张照片（不超过 640 个视觉 token）问 8 个问题的延迟中位数，软件界面那页的截图更大，会更慢，我们没有单独测；图上的结果是在 Apple 芯片 MPS（fp32）上跑的。"
../images/glance/w-hero.png | 静态图：雨伞下的晚饭，Glance 框出了彩虹伞和左边站着的女人；“番茄酱”在（0.976），但框准的概率只有 0.386，标成“框不准”；“一只狗”和“生日蛋糕”回答“不在”（0.001、0.002）；“在下雨吗”是 0.155；“在哪吃饭”选了花园（0.991）
../images/glance/w-hero-n.png | 同上，手机版
```

agent 看屏幕、看视频的时候，问的从来不是一个问题，而是一串：保存对话框开着吗？“导出”按钮在哪？点“全部删除”危险吗？这一段里有没有那只蝴蝶？更要紧的是，**东西不在的时候，它得敢说不在，而且这个“不在”有多确定，要靠得住。**

Glance 是我们在 Qwen3.5-4B[@qwen35] 上训练的一个“看一眼”模型。它不生成文字，只读一次图，就对任意多个问题各给出一个概率分布：框在哪里、是还是否、选哪一项、打几分，以及“它不在这里”。上面每个数字都是它的真实输出，指一指问题，拖一拖两个阈值，有几处值得多看一眼：

- “一只狗”“生日蛋糕”不是没框出来，而是回答了“不在”，并且给出了概率。中文和英文的问题落在同一个框上。
- “番茄酱”在（0.976），可框准的概率只有 0.386：它知道桌上有番茄酱，却不确定是哪一块。东西在不在、框准不准，是两个分开的旋钮。
- “点‘全部删除’有多危险”四档的概率差不多，这就是它在说“我不知道”。一个分布比一个答案多给出的，正是这个。
- 动画那一页，“一只飞鼠”（0.661）和“一只鸟”（0.347）都指向左上角半空中那只红松鼠：拖动阈值，拿不准的答案会先出现、先消失。

这篇讲 Glance 是怎么做的，以及做它的路上遇到的三个意外：

1. 在 Qwen3.5 这种线性注意力和注意力混合的模型上，最直接的“一次问多个问题”的写法，会让问题之间悄悄串题。
2. 生成式模型什么时候说“没有”，不取决于它看到了什么，而取决于坐标被切成什么 token、用什么规则解码。
3. 我们读了 21 个视频 agent 的失败记录，一半以上的错误是看错了或没看到，而不是想错了。

## agent 问的是一串小问题

今天让一个视觉语言模型回答“按钮在哪”，它会生成一串坐标；目标不在，它要生成一个 `none` 或者一句“图里没有”。这有三个麻烦：

- **慢，而且一次只答一个。** 同一张图上问 8 个问题，就要生成 8 遍。
- **“没有”只是一个 token。** 它没有概率意义上的保证，你也没法说“只有 90% 把握以上才算在”。
- **答案要解析。** 坐标、选项、是否，都混在自由文本里。

```stats title="同一张图上问 1、8、32 个问题" meta="RTX PRO 6000 · 每次调用的延迟中位数" note="一张图、所有问题一次发出。来源：outputs/ablation_v2/latency/latency_table.md，全文的延迟都出自这一套测量。"
## 生成式底座 Qwen3.5-4B，vLLM + 前缀缓存
1 个问题 | 174 ms | 所有请求一次发出
8 个问题 | 218 ms
32 个问题 | 331 ms
## Glance
1 个问题 | 67 ms | 不生成任何 token
8 个问题 | 67 ms | 共用一次前向
32 个问题 | 70 ms | 快 4.7 倍
```

这是一个对底座尽量公平的对比：vLLM 打开前缀缓存，同一张图只算一次，所有问题同时发出。Glance 仍然快 2.6、3.3、4.7 倍（1、8、32 个问题），把图像预处理也算进去是 2.3、2.9、4.2 倍。差距来自一件事：它不用解码。反过来，8 张图各问 1 个问题时，Glance 只快 1.2 倍：优势随着每张图上的问题数增长，而 agent 正是这样问的，对着同一个画面问一串。

Glance 的想法来自文本里的“System One”式决策模型：给一个状态和一组带类型的问题，模型一次前向，直接给出每个答案的概率，不写推理过程[@opendecisions]。我们想把视觉的“框”也变成这样一种原语，而它最重要的性质不是框得多准，而是**目标不在时能说不在，并且这个概率是校准过的**。

动手前查了一圈。用 patch 定位，GUI-Actor[@guiactor] 做过；用 presence token 判断概念在不在，SAM 3[@sam3] 做过；把框的四条边建模成分布，GFL[@gfl] 早就做过。架构的零件都不新。没人回答的是另一个问题：能不能在**一次前向**里，对一张图上的很多个问题同时给出框和校准过的“不在”？

## 一次前向，怎么问八个问题

一条输入是一张图加上很多个问题。图像部分只算一次；每个问题是接在后面的一小段 token，读出它最后一个位置的隐状态，交给对应的输出头：

- **框**：一个存在门控给出 P(present)；在图像的视觉 token 里选框中心所在的 patch；四条边各是一个 64 档的分布；再估计这个框和真值 IoU ≥ 0.5 的概率。
- **选项、是否、打分**：直接读底座语言模型头里对应标签 token（A…Z、Yes/No）的 logit，再加一个零初始化的修正。刚初始化时，它们的输出和底座下一个 token 的分布一模一样，训练只是在这个基础上微调。

```sketch title="box 头：一次读出，给出框和两个概率" note="视觉 token 每个对应 32×32 px。中心的训练目标按 GT 框覆盖每个 patch 的面积分配（GUI-Actor 的做法）；四条边各是 64 档的分布，用 Cramér 距离（CDF 的 L2）训练。IoU 头读的是选中 patch 上的特征。目标不在时只训练存在门控。"
<svg viewBox="0 0 704 330">
  <rect class="panel" x="0" y="0" width="704" height="330" rx="12"/>
  <g class="node clay"><rect x="262" y="24" width="180" height="34" rx="17"/><text class="mid" x="352" y="41">读出 h（box_start）</text></g>
  <g class="node plain"><rect x="48" y="96" width="184" height="34" rx="4"/><text class="mid" x="140" y="113">存在门控</text></g>
  <g class="node plain"><rect x="260" y="96" width="184" height="34" rx="4"/><text class="mid" x="352" y="113">中心：视觉 token softmax</text></g>
  <g class="node plain"><rect x="260" y="152" width="184" height="34" rx="4"/><text class="mid" x="352" y="169">四条边：4 × 64 档分布</text></g>
  <g class="node plain"><rect x="472" y="152" width="184" height="34" rx="4"/><text class="mid" x="564" y="169">IoU 头</text></g>
  <g class="node teal"><rect x="48" y="208" width="184" height="34" rx="4"/><text class="mid" x="140" y="225">P(present)</text></g>
  <g class="node teal"><rect x="260" y="208" width="184" height="34" rx="4"/><text class="mid" x="352" y="225">框 = 各边分布的期望</text></g>
  <g class="node teal"><rect x="472" y="208" width="184" height="34" rx="4"/><text class="mid" x="564" y="225">P(IoU ≥ 0.5)</text></g>
  <g class="node clay"><rect x="172" y="272" width="360" height="34" rx="17"/><text class="mid" x="352" y="289">框置信度 = P(present) × P(IoU ≥ 0.5)</text></g>
  <path class="edge" d="M352 58 V92" marker-end="url(#arrow)"/>
  <path class="edge" d="M352 76 H140 V92" marker-end="url(#arrow)"/>
  <path class="edge" d="M352 76 H608 V148" marker-end="url(#arrow)"/>
  <path class="edge" d="M140 130 V204" marker-end="url(#arrow)"/>
  <path class="edge" d="M352 130 V148" marker-end="url(#arrow)"/>
  <path class="edge" d="M352 186 V204" marker-end="url(#arrow)"/>
  <path class="edge" d="M564 186 V204" marker-end="url(#arrow)"/>
  <path class="edge dash" d="M444 169 H468" marker-end="url(#arrow)"/>
  <path class="edge" d="M140 242 V289 H168" marker-end="url(#arrow)"/>
  <path class="edge" d="M564 242 V289 H536" marker-end="url(#arrow)"/>
  <text class="small" x="452" y="190">选中的 patch</text>
</svg>
<svg viewBox="0 0 340 326">
  <rect class="panel" x="0" y="0" width="340" height="326" rx="12"/>
  <g class="node clay"><rect x="80" y="16" width="180" height="30" rx="15"/><text class="mid" x="170" y="31">读出 h</text></g>
  <g class="node plain"><rect x="24" y="70" width="130" height="30" rx="4"/><text class="mid" x="89" y="85">存在门控</text></g>
  <g class="node teal"><rect x="186" y="70" width="130" height="30" rx="4"/><text class="mid" x="251" y="85">P(present)</text></g>
  <g class="node plain"><rect x="24" y="120" width="130" height="30" rx="4"/><text class="mid" x="89" y="135">中心 patch</text></g>
  <g class="node plain"><rect x="186" y="120" width="130" height="30" rx="4"/><text class="mid" x="251" y="135">四条边 4×64 档</text></g>
  <g class="node teal"><rect x="186" y="170" width="130" height="30" rx="4"/><text class="mid" x="251" y="185">框</text></g>
  <g class="node plain"><rect x="24" y="220" width="130" height="30" rx="4"/><text class="mid" x="89" y="235">IoU 头</text></g>
  <g class="node teal"><rect x="186" y="220" width="130" height="30" rx="4"/><text class="mid" x="251" y="235">P(IoU ≥ 0.5)</text></g>
  <g class="node clay"><rect x="24" y="278" width="292" height="30" rx="15"/><text class="mid" x="170" y="293">置信度 = P(present) · P(IoU≥0.5)</text></g>
  <path class="edge" d="M80 31 H12 V235 H20" marker-end="url(#arrow)"/>
  <path class="edge" d="M12 85 H20" marker-end="url(#arrow)"/>
  <path class="edge" d="M12 135 H20" marker-end="url(#arrow)"/>
  <path class="edge" d="M154 85 H182" marker-end="url(#arrow)"/>
  <path class="edge" d="M154 135 H182" marker-end="url(#arrow)"/>
  <path class="edge" d="M251 150 V166" marker-end="url(#arrow)"/>
  <path class="edge" d="M154 235 H182" marker-end="url(#arrow)"/>
  <path class="edge" d="M316 85 H328 V293 H320" marker-end="url(#arrow)"/>
  <path class="edge" d="M316 235 H328"/>
</svg>
```

框的四条边用 Cramér 距离（两个分布 CDF 之差的平方和）训练，最后的框是各条边分布的期望；框的置信度是 P(present) × P(IoU ≥ 0.5)。训练时冻结视觉塔，在语言模型的线性层上加 LoRA（r=64）。每种问题的温度在训练分布里留出的校准集上拟合，从不碰评测集。

### 意外一：混合模型上，mask 挡不住串题

“图像只算一次，问题接在后面”，最直接的写法是把图像和 8 个问题拼成一条序列，在注意力里加一个 block mask，让每个问题只看见图像和它自己。在普通 Transformer 上这就够了。

可 Qwen3.5 是混合架构：每 4 层里 3 层是 Gated DeltaNet（GDN，一种带递归状态的线性注意力），只有 1 层是注意力。GDN 没有注意力矩阵可遮，它的状态顺着序列往后传，问题 1 写进状态的东西，问题 2 照样读得到。这个错误不会报错，不会让分数崩掉，只会让每个答案悄悄依赖于排在它前面的问题。

```widget src="../widgets/glance/leak.js" title="block mask 挡住了注意力，挡不住 GDN 的状态" note="数字来自 27B 上的对照实验：8 个问题块各 25 个 token，前缀 938 个 token。“隐状态差” = ‖拼接 − 单独‖ / ‖单独‖，第 4 块（下标 3），SDPA 实现；换成 flex attention 的 BlockMask 是 38.7%。≈1e-7 是 scripts/test_equivalence.py 在随机初始化的小 Qwen3.5 配置上和 HF 参考实现逐块对比的结果；真实 4B 权重上 fp32 余弦相似度 ≥ 0.99999。来源：outputs/27b/bench/masktest.json。"
../images/glance/w-leak.png | 静态图：上面是把图像和三个问题拼起来加 block mask，GDN 层的递归状态从问题 1 一直传到问题 3；下面是 Glance 的做法，每个问题从前缀的状态重新开始
../images/glance/w-leak-n.png | 同上，手机版
```

加了 mask，第 4 个问题块和它单独运行时的隐状态还差 39.8%，不加 mask 是 44.1%，mask 几乎没起作用。所以我们自己写了前向：前缀照常算一次，记下每个 GDN 层最后的递归状态和最后 3 个 conv 输入，每个问题块都从这份状态重新开始；注意力层里每个块只看前缀和自己。数学上，这等于把每个“前缀 + 问题”分开跑，只是前缀只算一次。和逐个单独运行相比，fp32 下的相对误差约 1e-7。

结果是，问多少个问题，代价几乎不变：问 1 个问题 67 ms，问 8 个还是 67 ms，32 个是 70 ms。

## 意外二：说不说“没有”，由解码器决定

我们原本想证明的是：自回归地生成坐标，天生不擅长说“没有”，而一个显式的存在门控更好。为了验证，做了一组受控实验：**同一个 4B 底座、同样的 LoRA、同样的数据和顺序、同样 3,058 步，只换输出头**。

- **门控**：上面的框头，P(present) 是一个数。
- **数字**：生成 `x1,y1,x2,y2`，0–1000，每位数字一个 token；不在就生成 `none`。
- **层级**：每个坐标两个新 token，先粗后细，共 32×32 = 1,024 级[@song2025]。
- **原子 100 / 原子 1000**：每个坐标值一个新 token，100 级或 1,000 级。

生成式的头还要选一个解码规则来决定“说不说 none”：贪心解码；P(none) ≥ 0.5 的阈值；或者比较整串 `none` 和整串坐标的概率，大的赢。选一个头、一个规则，看看会发生什么：

```widget src="../widgets/glance/dial.js" title="同一个数字头，只换解码规则：拒答率从 0.4% 到最多约 40%" note="横轴：RefCOCO val 上目标在场、模型却说“不在”的比例（10,834 个表达式）；纵轴：gRefCOCO val 无目标表达式上说对“不在”的比例（N-acc，8,905 个）。每条曲线是一个头在它自己的“不在”概率上取遍所有阈值（门控用 1 − P(present)，生成式头用 P(none)）；点是某个解码规则落在哪里。贪心和阈值 0.5 在这些目标上，受约束和不受约束的解码第一步结果几乎相同（原子 1000 在 16,158 个目标里有 53 个不同）；整串比较用受约束的解码，候选是贪心解出的那串坐标，所以是拒答率的上界。单个 seed。来源：outputs/ablation/*/rows.json、rows_c.json、main_table.json。"
../images/glance/w-dial.png | 静态图：五个输出头的曲线几乎重合；同一个数字头，阈值 0.5 下把 0.4% 的在场目标说成“不在”，整串比较下最多 39.9%
../images/glance/w-dial-n.png | 同上，手机版
```

结果和预想的不一样，但更有意思。

**生成式头其实知道东西在不在。** 五条曲线几乎重合：把阈值调到恰好拒答 1% 的在场目标时，四种坐标写法的头都能拒掉 81–82% 的无目标表达式，门控是 81.3%；AUROC 都在 96.2–96.7 之间。门控在“不在”上并没有赢。

**但它什么时候说出来，是坐标的写法决定的。** 一个框的概率摊在成千上万种坐标串上，`none` 只有一种写法。在 RefCOCO 的 21,586 个在场目标上，贪心解码的拒答是同一个模型用 0.5 阈值时的 1.3–3.1 倍；按整串概率比较时，从原子 100 的 3.4% 一路涨到数字头的最多 39.9%。同样的底座和数据，只换切坐标的方式，模型“说没有”的频率就差十倍。

甚至不用换词表，换搜索算法就够了。同一个数字头：贪心解码在这 21,586 个目标上把 0.60% 说成“不在”；beam search（宽 4）在一批 191 个目标上是 4.7%，因为 `none` 在第一步就排不进前 4 个候选、被直接剪掉了；在同一批目标上按整串概率比较，最多是 37.7%。同一个模型、同一张图，拒答率由解码器挑。这就是表面形式竞争[@holtzman2021]，只不过它决定的是一个 agent 会不会把在场的按钮当成不存在。

原子 1000 还有一个更隐蔽的版本：表面形式竞争也会发生在**框的内部**。一个坐标值被摊在 1,000 个相邻的 token 上，在场目标的第一个 token 上，除 `none` 以外最可能的那个只拿到平均 0.19 的概率（数字是 0.78），于是不加约束地贪心解码时，24.2% 的输出连格式都不对，RefCOCO 只有 73.1；用语法约束把每一步限制在合法 token 上，同一个模型就回到 93.8。

所以门控的价值不在“看得更准”，而在两件事：

- **“不在”是一个你能拧的旋钮。** 它是一个校准过的概率，阈值由用户定，换了场景还能按新的先验平移；生成式头给你的，是解码规则替你选好的一个点。
- **框准不准，也是一个旋钮。** 框头还给出 P(IoU ≥ 0.5)，它在在场目标上分辨“框对了”和“框错了”的 AUROC 是 91.6；生成式头不管用哪种分数最多 79.7，用整串概率最多 75.4。把“在不在”和“框得准不准”两个阈值一起用（在训练分布的校准集上定阈值，不碰评测集），和只用存在门控相比，在框错一次的代价是拒答的 1、2、5 倍时，实际代价分别降 4%、13%、33%；在 5% 的目标不在、框错代价为 5 的“点击”场景里降 31%，置信区间都不含 0。
- **不用解码。** 生成式头每个问题还要解码 5–15 步，门控是 0 步。这就是开头那组对比里的差距：和打开前缀缓存的 vLLM 比，一张图问 8 个问题是 67 对 218 ms。

同一组实验还给了第二个结论：**幻觉主要由训练数据里负样本的比例决定，和输出头关系不大。** 把训练时“不在”的问题从 25% 降到 5%，三种读法在无目标表达式上画出框的比例都升了 11 个点左右，门控也一样。

```echarts title="负样本从 25% 减到 5%，三种读法都多了约 11 个点的幻觉" height="250" note="幻觉率 = gRefCOCO val 无目标表达式上没有说“不在”的比例。门控按 P(present) ≥ 0.5；数字头分别按 P(none) < 0.5 的阈值和贪心解码。空心点：5% 的模型按训练先验平移 logit 之后（贪心没有阈值可平移）。来源：outputs/ablation/halluc_vs_negratio.json。"
{"tooltip": {"trigger": "item"}, "legend": {"data": ["负样本 25%", "负样本 5%", "5% + 先验修正"]}, "grid": {"left": 64, "right": 44, "top": 40, "bottom": 40}, "xAxis": {"type": "value", "min": 15, "max": 40, "name": "无目标表达式上画了框", "nameLocation": "middle", "nameGap": 26, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "data": ["门控", "数字·阈值", "数字·贪心"], "inverse": true, "axisTick": {"show": false}}, "series": [{"type": "bar", "stack": "d", "silent": true, "itemStyle": {"color": "transparent"}, "data": [24.3, 24.2, 22.0], "tooltip": {"show": false}}, {"type": "bar", "stack": "d", "silent": true, "barWidth": 3, "itemStyle": {"color": "var(--line)"}, "data": [11.4, 10.8, 10.8], "tooltip": {"show": false}}, {"name": "负样本 25%", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--stone)"}, "z": 3, "label": {"show": true, "position": "top", "distance": 6, "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [["24.3", 0], ["24.2", 1], ["22.0", 2]], "tooltip": {"formatter": "{a}：{@[0]}%"}}, {"name": "负样本 5%", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--clay)"}, "z": 4, "label": {"show": true, "position": "right", "formatter": "{@[0]}%", "color": "var(--ink)", "textBorderColor": "transparent"}, "data": [["35.7", 0], ["35.0", 1], ["32.8", 2]], "tooltip": {"formatter": "{a}：{@[0]}%"}}, {"name": "5% + 先验修正", "type": "scatter", "symbolSize": 10, "itemStyle": {"color": "var(--paper)", "borderColor": "var(--clay)", "borderWidth": 2}, "z": 5, "label": {"show": true, "position": "bottom", "distance": 6, "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [["27.3", 0], ["24.6", 1]], "tooltip": {"formatter": "{a}：{@[0]}%"}}]}
```

先验变了，可以事后平移 logit 修正：门控从 35.7% 修到 27.3%，数字头用 P(none) 的阈值做同样的修正是 24.6%，门控并没有更好。这把我们推回到了数据。

## 让“不在”变得可信的，是数据

第一版（v0）只在 COCO 系列上训练：RefCOCO、RefCOCO+、RefCOCOg，gRefCOCO[@grefcoco] 里的无目标表达式，再从别的图里借来一些描述当负样本。24,462 张图、355,385 个问题，一张卡 78 分钟。框很准，8 个 RefCOCO 评测集平均 Acc@0.5 是 92.8。

可它对真正难的负样本过于自信。gRefCOCO 的无目标表达式是“图里有狗，但没有‘左边那只白狗’”这种，v0 能说对“不在”的只有 77.0%，而在只含无目标和多目标表达式的子集上，存在门控的 ECE 高达 0.139。训练时借来的负样本太容易了：类别根本不在图里。

同样的数据换到 Qwen3.8-27B 上再训一遍，框更准了（平均 94.1），“不在”几乎没动。让它动起来的是 v1 换的数据：加入 GUI 截图、PixMo 的指点和计数，并刻意构造**难负样本**，也就是同一张图里存在、但不符合描述的东西（GUI 里是同一屏上的别的按钮）。

```data title="加了难负样本，“不在”才变得可信" bars="N-acc" mark="v1 4B" note="gRefCOCO val 无目标表达式（N-acc）；AUROC 和 ECE 是存在门控在 gRefCOCO val 并上 RefCOCO val（25,063 个表达式）上的值。27B 是 Qwen3.8-27B，4B 是 Qwen3.5-4B，规模和底座版本同时变了。v1 的 ECE 是温度校准后的值（未校准 0.023）。来源：outputs/v0、27b、v1/eval_results.json。"
模型 | N-acc | AUROC | ECE
v0 4B | 77.0 | 0.964 | 0.075
v0 27B | 77.5 | 0.968 | 0.074
v1 4B | 87.4 | 0.979 | 0.024
```

GUI 上也是同一个故事。v0 在 COCO 上训了 78 分钟，拿去测 ScreenSpot-v2[@screenspotv2] 只有 28.6，生成式底座是 93.4。一开始我们怀疑是分辨率：v0 最多用 640 个视觉 token。可在 ScreenSpot-Pro[@screenspotpro] 上把 v0 的视觉 token 提到 4,000，它也只从 0.9% 升到 1.8%，底座是 56.0%。新加的头只见过自然图像里的物体，分辨率不是主因。v1 加了 GUI 截图之后，ScreenSpot-v2 回到 89.4。在 VenusBench-GD[@venusbench] 里“目标不在屏幕上”的题上，v1 说对了 81.5%，比已发表的最好结果（78.1%）还高（用的是我们自己的评测脚本）；同一个底座按生成式的方式、用同一个评测脚本，只有 3.9%。目标在场的题，点击准确率是 47.3%（这部分计分时没有经过门控）。

## 拿到视频上

一个会说“不在”的框，放到视频上就是一条时间曲线：每隔几秒取一帧，问“兔子在不在”“有没有蝴蝶”，P(t) 越过阈值的地方就是它出现的时间段，连起来的段数就是次数。逐帧扫描是“多张图、每张图问几个问题”的用法，Glance 的速度优势在这里会缩小到 1.2–1.9 倍。下面是 Big Buck Bunny 的前 8 分钟，每 4 秒一帧，每帧在一次前向里同时问 5 个问题，图里画出其中 4 个框问题。拖动曲线看任意一帧：

```widget src="../widgets/glance/video.js" title="在不在，随时间变成一条曲线" note="Glance-4B-preview，Big Buck Bunny 0–476 秒每 4 秒一帧（120 帧，640×360），每帧 5 个问题（4 个框、1 个是否）一次问完，这里展示 4 个框问题，Apple 芯片 MPS、fp32，平均每帧约 1.6 秒。曲线下的灰条是我们逐帧看图标的“在”（看不清的帧单列，不计入一致率）；标注时看得到模型的输出，所以一致率偏乐观。“飞鼠”指片中的飞鼠 Frank，不含另外两只啮齿动物。视频 © 2008 Blender Foundation，www.bigbuckbunny.org，CC BY 3.0（https://creativecommons.org/licenses/by/3.0/），帧经过缩放。原始输出：outputs/blog/widgets/bbb4.json。"
../images/glance/w-video.png | 静态图：2 分 16 秒那一帧，Glance 框出了兔子（0.996）、蝴蝶（0.992）和左上角的红松鼠（飞鼠 0.661）；下面是四条 P(t) 曲线和人工标注
../images/glance/w-video-n.png | 同上，手机版
```

在 0.5 的阈值上，它和人工标注的一致率是兔子 111/113、飞鼠 111/115、蝴蝶 115/118，“红色汽车”在 120 帧里一次都没有说在。有些“错”其实是我们没看见：片头 0:28 那一帧，模型说有蝴蝶（0.99），放大才发现标题字母上真停着一只。

不过这是一个物体检测器在逐帧回答，而视频 agent 真正卡住的地方，比这更难。

## 意外三：视频 agent 错在哪里

为了知道 Glance 作为工具该补什么，我们先读了 Video-Index[@videoindex] v1.1 上 21 个 agent 公开的运行记录（144 题）。分层抽了 48 个失败的运行，按事先定好的规则逐条标注：

```data title="48 个失败运行，一半以上是“看”出了问题" bars="占比" mark="看错了" note="Opus 5.5、Opus 5、Gemini 4 Argon、GPT-6-Astra 的错误或无答案运行，按 agent × 能力组分层抽样，每格 3 个。一个人标注，置信区间偏乐观。感知类（前三行）合计 27/48，56%，95% 置信区间 42%–69%。下面时间线那一例按原始标注计在“没看到”里。来源：video/analysis/failure_analysis.md。"
类型 | 个数 | 占比
看错了 | 21 | 43.8%
没看到 | 5 | 10.4%
时间段找错 | 1 | 2.1%
推理或知识 | 8 | 16.7%
超时或框架错误 | 7 | 14.6%
答案可疑 | 6 | 12.5%
```

推理错误只有 8 个。最多的是**看错了**：找对了场景，却把颜色认错、把次数数错、把方向看反。

```cases title="找到了，但看错了；或者翻遍了，没看到" note="答案来自各 agent 的 result.json，备注来自我们读轨迹时的标注。Video-Index 的视频只允许用于评测，所以这里不放任何画面。来源：video/analysis/trace_labels.json 和 Video-Index v1.1 的公开轨迹。"
## ALLVB_2121 电影 · 87 分钟 · 感知
tag: 看错了
q: … a woman is seen tending to a wounded person and later crawling through the muddy terrain while holding a gun. … What is the color of the woman's shirt in the scene?
答案 | ok | (E) Purple
Claude Opus 5.5 | bad | (B) Red
备注 | note | 找到了对的场景，把栗色（maroon）说成了红色；21 个 agent 里 9 个选了 Red
## ALLVB_429 电影 · 132 分钟 · 空间
tag: 没看到
q: What is the movement path of the prescription Elizabeth receives from her doctor?
答案 | ok | (C) From the doctor's hand to the trash can outside the office
Claude Opus 5 | bad | (B) From the doctor's hand to Elizabeth's purse
备注 | note | 翻了 1,100 张镜头缩略图，没找到处方被扔掉的那一刻，结论是医生从没出现在画面上
```

“没看到”和“看错了”的边界，要把 agent 看过哪里画出来才分得清。下面这道计数题，Gemini 4 Argon 数出 3 次，答案是 5 次。把它实际抽帧的时间段和答对的 GPT-6-Astra 报告的 5 个时刻叠在一起，漏掉的两次都落在 Argon 用 6 帧/秒细看过的窗口里：它看到了，只是没数对。这正是逐段问“这一刻在不在指”的 P(t) 能直接回答的问题。

```sketch title="Argon 细看过那两次指向，只是没数到" note="S-EMBER_7291（第一人称，319 秒，问“我指了乐高盒子几次？”，答案 5 次，21 个 agent 里 4 个答对）。数据集没有逐次的时间标注，编号的 5 个时刻是答对的 GPT-6-Astra 自己写的“around 129, 132, 134, 232, and 249 seconds”；黑框是 Argon 自己写的 3 段指向。色带按轨迹里每条抽帧命令的时间范围和帧率画；Codex 的轨迹不记录看图事件，所以 Astra 一行是“抽出来的帧”，不一定都看过。只用时间，不含任何画面。来源：outputs/blog/coverage.json。"
<svg viewBox="0 0 704 412">
<rect class="panel" x="0" y="0" width="704" height="412" rx="12"/>
<text class="small b" x="24" y="30">整段视频 · 319 s</text>
<line class="edge" x1="176" y1="144" x2="680" y2="144"/>
<line class="edge" x1="176" y1="141" x2="176" y2="147"/><text class="small mid" x="176" y="158">0 s</text>
<line class="edge" x1="334" y1="141" x2="334" y2="147"/><text class="small mid" x="334" y="158">100 s</text>
<line class="edge" x1="492" y1="141" x2="492" y2="147"/><text class="small mid" x="492" y="158">200 s</text>
<line class="edge" x1="650" y1="141" x2="650" y2="147"/><text class="small mid" x="650" y="158">300 s</text>
<text class="small" x="24" y="62">回答正确者报告的指向</text>
<text x="24" y="96">Argon：答 3 次</text>
<text x="24" y="124">Astra：答 5 次 ✓</text>
<line x1="176" y1="92" x2="680" y2="92" stroke="var(--line)"/>
<rect x="176" y="89" width="504" height="6" rx="2" fill="var(--stone)"/>
<rect x="207.6" y="85" width="14.2" height="14" rx="2" fill="var(--blue)"/>
<rect x="376.7" y="85" width="25.3" height="14" rx="2" fill="var(--blue)"/>
<rect x="539.4" y="85" width="11.1" height="14" rx="2" fill="var(--blue)"/>
<rect x="567.8" y="85" width="9.5" height="14" rx="2" fill="var(--blue)"/>
<line x1="176" y1="120" x2="680" y2="120" stroke="var(--line)"/>
<rect x="176" y="117" width="504" height="6" rx="2" fill="var(--stone)"/>
<rect x="176" y="117" width="504" height="6" rx="2" fill="var(--stone)"/>
<rect x="378.2" y="113" width="22.1" height="14" rx="2" fill="var(--blue)"/>
<rect x="539.4" y="117" width="36.3" height="6" rx="2" fill="var(--stone)"/>
<rect x="378.5" y="83" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="383.3" y="83" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="568.9" y="83" width="5.2" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="379.8" y1="66" x2="379.8" y2="128" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="379.8" cy="62" r="3.5" fill="var(--teal)"/>
<line x1="384.6" y1="66" x2="384.6" y2="128" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="384.6" cy="62" r="3.5" fill="var(--teal)"/>
<line x1="387.7" y1="66" x2="387.7" y2="128" stroke="var(--clay)" stroke-dasharray="2 3"/>
<circle cx="387.7" cy="62" r="3.5" fill="var(--clay)"/>
<line x1="542.5" y1="66" x2="542.5" y2="128" stroke="var(--clay)" stroke-dasharray="2 3"/>
<circle cx="542.5" cy="62" r="3.5" fill="var(--clay)"/>
<line x1="569.4" y1="66" x2="569.4" y2="128" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="569.4" cy="62" r="3.5" fill="var(--teal)"/>

<text class="small b" x="24" y="210">放大 120–145 s</text>
<line class="edge" x1="80" y1="324" x2="340" y2="324"/>
<line class="edge" x1="80" y1="321" x2="80" y2="327"/><text class="small mid" x="80" y="338">120 s</text>
<line class="edge" x1="204.8" y1="321" x2="204.8" y2="327"/><text class="small mid" x="204.8" y="338">132 s</text>
<line class="edge" x1="340" y1="321" x2="340" y2="327"/><text class="small mid" x="340" y="338">145 s</text>
<line x1="80" y1="270" x2="340" y2="270" stroke="var(--line)"/>
<rect x="80" y="267" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="152.8" y="263" width="166.4" height="14" rx="2" fill="var(--blue)"/>
<line x1="80" y1="300" x2="340" y2="300" stroke="var(--line)"/>
<rect x="80" y="297" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="80" y="297" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="163.2" y="293" width="145.6" height="14" rx="2" fill="var(--blue)"/>
<rect x="165.3" y="261" width="10.4" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="196.5" y="261" width="10.4" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="173.6" y1="246" x2="173.6" y2="308" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="173.6" cy="238" r="8"/><text class="mid" x="173.6" y="238" font-size="11">1</text></g>
<line x1="204.8" y1="246" x2="204.8" y2="308" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="204.8" cy="238" r="8"/><text class="mid" x="204.8" y="238" font-size="11">2</text></g>
<line x1="225.6" y1="246" x2="225.6" y2="308" stroke="var(--clay)" stroke-dasharray="2 3"/>
<g class="node clay"><circle cx="225.6" cy="238" r="8"/><text class="mid" x="225.6" y="238" font-size="11">3</text></g>
<text class="small" x="24" y="270">Argon</text><text class="small" x="24" y="300">Astra</text>
<text class="small b" x="364" y="210">放大 225–258 s</text>
<line class="edge" x1="420" y1="324" x2="680" y2="324"/>
<line class="edge" x1="420" y1="321" x2="420" y2="327"/><text class="small mid" x="420" y="338">225 s</text>
<line class="edge" x1="538.2" y1="321" x2="538.2" y2="327"/><text class="small mid" x="538.2" y="338">240 s</text>
<line class="edge" x1="680" y1="321" x2="680" y2="327"/><text class="small mid" x="680" y="338">258 s</text>
<line x1="420" y1="270" x2="680" y2="270" stroke="var(--line)"/>
<rect x="420" y="267" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="459.4" y="263" width="55.2" height="14" rx="2" fill="var(--blue)"/>
<rect x="601.2" y="263" width="47.3" height="14" rx="2" fill="var(--blue)"/>
<line x1="420" y1="300" x2="680" y2="300" stroke="var(--line)"/>
<rect x="420" y="297" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="420" y="297" width="260" height="6" rx="2" fill="var(--stone)"/>
<rect x="459.4" y="297" width="181.2" height="6" rx="2" fill="var(--stone)"/>
<rect x="606.7" y="261" width="26" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="475.2" y1="246" x2="475.2" y2="308" stroke="var(--clay)" stroke-dasharray="2 3"/>
<g class="node clay"><circle cx="475.2" cy="238" r="8"/><text class="mid" x="475.2" y="238" font-size="11">4</text></g>
<line x1="609.1" y1="246" x2="609.1" y2="308" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="609.1" cy="238" r="8"/><text class="mid" x="609.1" y="238" font-size="11">5</text></g>
<text class="small" x="364" y="270">Argon</text><text class="small" x="364" y="300">Astra</text>
<rect x="24" y="356" width="18" height="6" rx="2" fill="var(--stone)"/><text class="small" x="48" y="359">≤1 帧/秒的整段浏览</text>
<rect x="176" y="352" width="18" height="14" rx="2" fill="var(--blue)"/><text class="small" x="200" y="359">2–6 帧/秒的细看窗口</text>
<rect x="340" y="351" width="16" height="16" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/><text class="small" x="362" y="359">Argon 数到的指向</text>
<circle cx="30" cy="386" r="5" fill="var(--teal)"/><text class="small" x="42" y="386">答对者报告的指向，Argon 也数到了</text><circle cx="270" cy="386" r="5" fill="var(--clay)"/><text class="small" x="282" y="386">答对者报告的指向，落在 Argon 细看过的窗口里，却没数到</text>
</svg>
<svg viewBox="0 0 340 584">
<rect class="panel" x="0" y="0" width="340" height="584" rx="12"/>
<text class="small b" x="16" y="28">整段视频 · 319 s</text>
<line class="edge" x1="96" y1="138" x2="320" y2="138"/>
<line class="edge" x1="96" y1="135" x2="96" y2="141"/><text class="small mid" x="96" y="152">0 s</text>
<line class="edge" x1="201.3" y1="135" x2="201.3" y2="141"/><text class="small mid" x="201.3" y="152">150 s</text>
<line class="edge" x1="306.7" y1="135" x2="306.7" y2="141"/><text class="small mid" x="306.7" y="152">300 s</text>
<text class="small" x="16" y="56">正确者报告</text>
<text x="16" y="90">Argon 3 次</text>
<text x="16" y="118">Astra 5 ✓</text>
<line x1="96" y1="86" x2="320" y2="86" stroke="var(--line)"/>
<rect x="96" y="83" width="224" height="6" rx="2" fill="var(--stone)"/>
<rect x="110" y="79" width="6.3" height="14" rx="2" fill="var(--blue)"/>
<rect x="185.2" y="79" width="11.2" height="14" rx="2" fill="var(--blue)"/>
<rect x="257.5" y="79" width="4.9" height="14" rx="2" fill="var(--blue)"/>
<rect x="270.1" y="79" width="4.2" height="14" rx="2" fill="var(--blue)"/>
<line x1="96" y1="114" x2="320" y2="114" stroke="var(--line)"/>
<rect x="96" y="111" width="224" height="6" rx="2" fill="var(--stone)"/>
<rect x="96" y="111" width="224" height="6" rx="2" fill="var(--stone)"/>
<rect x="185.9" y="107" width="9.8" height="14" rx="2" fill="var(--blue)"/>
<rect x="257.5" y="111" width="16.2" height="6" rx="2" fill="var(--stone)"/>
<rect x="186" y="77" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="188.1" y="77" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="270.6" y="77" width="3" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="186.6" y1="60" x2="186.6" y2="122" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="186.6" cy="56" r="3.5" fill="var(--teal)"/>
<line x1="188.7" y1="60" x2="188.7" y2="122" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="188.7" cy="56" r="3.5" fill="var(--teal)"/>
<line x1="190.1" y1="60" x2="190.1" y2="122" stroke="var(--clay)" stroke-dasharray="2 3"/>
<circle cx="190.1" cy="56" r="3.5" fill="var(--clay)"/>
<line x1="258.9" y1="60" x2="258.9" y2="122" stroke="var(--clay)" stroke-dasharray="2 3"/>
<circle cx="258.9" cy="56" r="3.5" fill="var(--clay)"/>
<line x1="270.8" y1="60" x2="270.8" y2="122" stroke="var(--teal)" stroke-dasharray="2 3"/>
<circle cx="270.8" cy="56" r="3.5" fill="var(--teal)"/>

<text class="small b" x="16" y="196">放大 120–145 s</text>
<line class="edge" x1="72" y1="312" x2="320" y2="312"/>
<line class="edge" x1="72" y1="309" x2="72" y2="315"/><text class="small mid" x="72" y="326">120 s</text>
<line class="edge" x1="191" y1="309" x2="191" y2="315"/><text class="small mid" x="191" y="326">132 s</text>
<line class="edge" x1="320" y1="309" x2="320" y2="315"/><text class="small mid" x="320" y="326">145 s</text>
<line x1="72" y1="258" x2="320" y2="258" stroke="var(--line)"/>
<rect x="72" y="255" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="141.4" y="251" width="158.7" height="14" rx="2" fill="var(--blue)"/>
<line x1="72" y1="288" x2="320" y2="288" stroke="var(--line)"/>
<rect x="72" y="285" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="72" y="285" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="151.4" y="281" width="138.9" height="14" rx="2" fill="var(--blue)"/>
<rect x="153.3" y="249" width="9.9" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<rect x="183.1" y="249" width="9.9" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="161.3" y1="234" x2="161.3" y2="296" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="161.3" cy="226" r="8"/><text class="mid" x="161.3" y="226" font-size="11">1</text></g>
<line x1="191" y1="234" x2="191" y2="296" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="191" cy="226" r="8"/><text class="mid" x="191" y="226" font-size="11">2</text></g>
<line x1="210.9" y1="234" x2="210.9" y2="296" stroke="var(--clay)" stroke-dasharray="2 3"/>
<g class="node clay"><circle cx="210.9" cy="226" r="8"/><text class="mid" x="210.9" y="226" font-size="11">3</text></g>
<text class="small" x="16" y="258">Argon</text><text class="small" x="16" y="288">Astra</text>
<text class="small b" x="16" y="340">放大 225–258 s</text>
<line class="edge" x1="72" y1="456" x2="320" y2="456"/>
<line class="edge" x1="72" y1="453" x2="72" y2="459"/><text class="small mid" x="72" y="470">225 s</text>
<line class="edge" x1="184.7" y1="453" x2="184.7" y2="459"/><text class="small mid" x="184.7" y="470">240 s</text>
<line class="edge" x1="320" y1="453" x2="320" y2="459"/><text class="small mid" x="320" y="470">258 s</text>
<line x1="72" y1="402" x2="320" y2="402" stroke="var(--line)"/>
<rect x="72" y="399" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="109.6" y="395" width="52.6" height="14" rx="2" fill="var(--blue)"/>
<rect x="244.8" y="395" width="45.1" height="14" rx="2" fill="var(--blue)"/>
<line x1="72" y1="432" x2="320" y2="432" stroke="var(--line)"/>
<rect x="72" y="429" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="72" y="429" width="248" height="6" rx="2" fill="var(--stone)"/>
<rect x="109.6" y="429" width="172.8" height="6" rx="2" fill="var(--stone)"/>
<rect x="250.1" y="393" width="24.8" height="18" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/>
<line x1="124.6" y1="378" x2="124.6" y2="440" stroke="var(--clay)" stroke-dasharray="2 3"/>
<g class="node clay"><circle cx="124.6" cy="370" r="8"/><text class="mid" x="124.6" y="370" font-size="11">4</text></g>
<line x1="252.4" y1="378" x2="252.4" y2="440" stroke="var(--teal)" stroke-dasharray="2 3"/>
<g class="node teal"><circle cx="252.4" cy="370" r="8"/><text class="mid" x="252.4" y="370" font-size="11">5</text></g>
<text class="small" x="16" y="402">Argon</text><text class="small" x="16" y="432">Astra</text>
<rect x="16" y="484" width="18" height="6" rx="2" fill="var(--stone)"/><text class="small" x="40" y="487">≤1 帧/秒浏览</text>
<rect x="170" y="480" width="18" height="14" rx="2" fill="var(--blue)"/><text class="small" x="194" y="487">2–6 帧/秒细看</text>
<rect x="16" y="508" width="16" height="16" rx="2" fill="none" stroke="var(--ink)" stroke-width="1.5"/><text class="small" x="40" y="516">Argon 数到的指向</text>
<circle cx="24" cy="542" r="5" fill="var(--teal)"/><text class="small" x="40" y="542">答对者报告，Argon 也数到了</text><circle cx="24" cy="566" r="5" fill="var(--clay)"/><text class="small" x="40" y="566">在 Argon 细看过的窗口里，没数到</text>
</svg>
```

我们做过一个逐帧的版本给 agent 调用，它暴露的正是上一节的局限：“一只手从盒子里抽出湿巾”这种**动作**，只要手和盒子同时在画面里，逐帧的检测器就会说“在”，于是一道答案是 5 次的计数题，它数出了 64 次。所以 Glance 作为视频工具该补的，是 agent 最常出错的那几种感知：数清次数、确认某个东西在不在某一段里、指出它在哪，而动作要在一小段视频上判断，不能只看一帧。

读这些记录时还顺带发现两件和“看”无关的事：v1.1 有 41.0% 的题答案是最后一个选项，“永远选最后一个”能在 22 个参赛者里排第 5；Codex 的 52 次 `technical_error` 里有 51 次已经写好了答案，其中 24 个是对的，算上它们 GPT-6-Astra 会从 35.4 升到 41.0。比较 v1.1 上的结果时，这两点都值得先校正。

## 还会出错的地方

最后是一个它还会出错、而且错得很有规律的地方：**同一个东西，换一种说法，答案可能翻转。** 在一张干净的图上，怎么问都对；换到伞下那张摆满东西的晚饭桌上，“ketchup”是 0.976，“the ketchup bottle”只有 0.362，“something to drink”在一桌子杯子和瓶子前面说“不在”（0.135）。最要紧的是软件界面：“导出按钮”稳稳地框对了，可换成“把图存成 PNG 的那个按钮”，它说不在（0.11）；问“能保住我的修改的那个按钮”，它很有把握地（0.93）框住了“Don't Save”。

```widget src="../widgets/glance/phrasing.js" title="同一个东西，换个说法" note="Glance-4B-preview 的真实输出，Apple 芯片 MPS、fp32；每张图的所有说法在一次前向里一起问。竖线是 0.5。没过线的说法，框画成虚线，标签写“它说不在”。照片：Walter Lim，“Ice capuccino and durian durian cake for #tea”，CC BY 2.0（COCO val2017）；Peter Moons，“Dinner under the umbrella.”，CC BY 2.0（COCO val2017）；界面：Glance 仓库的 examples/gui_mock.html，Apache-2.0。原始输出：outputs/blog/widgets/probe.json、outputs/probes/editor_glance_v1.json。"
../images/glance/w-phrasing.png | 静态图：冰咖啡和蛋糕那张图上，dessert、甜点、something sweet、甜的东西都在 0.98 以上；伞下的晚饭那张图上，ketchup 0.976，番茄酱 0.851，the ketchup bottle 0.362；软件界面上，the button that saves the picture as a PNG 只有 0.11
../images/glance/w-phrasing-n.png | 同上，手机版
```

中文和英文、“甜点”和“dessert”在这几张图上都没问题；出问题的是按用途来描述的说法，而 agent 收到的指令恰恰常常是这种：“把图存下来”，而不是“点 Export”。训练数据里的指代表达式大多是“名词 + 修饰”，人在真实场景里的问法要宽得多。

v1 也拿一部分框的精度换来了 GUI 能力和可信的“不在”：RefCOCO val 从 95.0 降到 93.2，框置信度的 ECE 从 0.006 升到 0.024，多目标表达式被误说“不在”的比例从 1.2% 升到 5.1%。专业软件的高分辨率截图还不行（ScreenSpot-Pro 29.3，底座 56.0），GUI 上“不在”的判别力也远不如自然图像（VenusBench-GD 上存在门控的 AUROC 是 0.738，gRefCOCO 上是 0.979）。受控实验只跑了一个 seed，门控那一组和 v0 同配方，N-acc 差了 1.3 个点，比这更小的差别都不该当真。

## 接下来

- **视频原生的 Glance。** 不是逐帧问物体，而是在几秒长的小段上回答“这个动作发生了吗”，并且能数状态的变化，这是视频 agent 最缺的那种感知。
- **对人的说法更稳。** 按用途描述、长描述、中英混用的问法，需要专门的训练数据和评测，而不是只靠指代表达式。
- **开放。** 代码在 [Vision-Decision/Glance](https://github.com/Vision-Decision/Glance)（Apache-2.0），4B 的预览权重在 Hugging Face 的 [aac6fef/Glance-4B-preview](https://huggingface.co/aac6fef/Glance-4B-preview)（CC BY-NC 4.0，训练数据里的 gRefCOCO 只限非商用），一行 `pip install` 就能在 CUDA、Apple 芯片或 CPU 上跑起来。下一步是 27B 版本和训练代码。

回头看，最有价值的不是哪个分数，而是三次“和预想的不一样”：生成式头在“不在”上并不差，差在解码规则替它选了点；更大、更新的底座没学会说“不在”，难负样本学会了；视频 agent 输在“看”，而不是“想”。每一次都把我们从“换模型、换架构”推回到“数据和接口”。

## 参考资料

- [@qwen35] Qwen Team (2026). [Qwen3.5: Towards Native Multimodal Agents](https://qwen.ai/blog?id=qwen3.5). _Qwen blog_, February 2026.
- [@opendecisions] Geuter, J., Cheng, A., & Alvarez-Melis, D. (2026). [Releasing the Inner Jev: A Simple Recipe for Open Decision Models](https://arxiv.org/abs/2610.17205). _arXiv preprint arXiv:2610.17205_.
- [@guiactor] Wu, Q., Cheng, K., Yang, R., et al. (2025). [GUI-Actor: Coordinate-Free Visual Grounding for GUI Agents](https://arxiv.org/abs/2506.03143). _Advances in Neural Information Processing Systems 38 (NeurIPS 2025)_.
- [@sam3] Carion, N., Gustafson, L., Hu, Y.-T., et al. (2026). [SAM 3: Segment Anything with Concepts](https://arxiv.org/abs/2511.16719). _International Conference on Learning Representations (ICLR 2026)_.
- [@gfl] Li, X., Wang, W., Wu, L., et al. (2020). [Generalized Focal Loss: Learning Qualified and Distributed Bounding Boxes for Dense Object Detection](https://arxiv.org/abs/2006.04388). _Advances in Neural Information Processing Systems 33 (NeurIPS 2020)_.
- [@song2025] Song, X., & Bahri, D. (2025). [Decoding-based Regression](https://arxiv.org/abs/2501.19383). _Transactions on Machine Learning Research_.
- [@holtzman2021] Holtzman, A., West, P., Shwartz, V., Choi, Y., & Zettlemoyer, L. (2021). [Surface Form Competition: Why the Highest Probability Answer Isn't Always Right](https://doi.org/10.18653/v1/2021.emnlp-main.564). _Proceedings of EMNLP 2021_, 7038–7051.
- [@grefcoco] Liu, C., Ding, H., & Jiang, X. (2023). [GRES: Generalized Referring Expression Segmentation](https://arxiv.org/abs/2306.00968). _IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR 2023)_.
- [@screenspotv2] Wu, Z., Wu, Z., Xu, F., et al. (2025). [OS-ATLAS: A Foundation Action Model for Generalist GUI Agents](https://arxiv.org/abs/2410.23218). _International Conference on Learning Representations (ICLR 2025)_. ScreenSpot-v2 是这篇论文修订的版本。
- [@screenspotpro] Li, K., Meng, Z., Lin, H., et al. (2025). [ScreenSpot-Pro: GUI Grounding for Professional High-Resolution Computer Use](https://arxiv.org/abs/2504.07981). _Proceedings of the 33rd ACM International Conference on Multimedia (MM '25)_.
- [@videoindex] Song, E., Xu, Y., Yang, S., Chai, W., & Gu, J. (2026). [Video-Index: A Curated Meta-Benchmark for Video Understanding](https://arxiv.org/abs/2610.00960). _arXiv preprint arXiv:2610.00960_.
- [@venusbench] Zhou, B., Huang, Z., Guo, Y., et al. (2025). [VenusBench-GD: A Comprehensive Multi-Platform GUI Benchmark for Diverse Grounding Tasks](https://arxiv.org/abs/2512.16501). _arXiv preprint arXiv:2512.16501_.
