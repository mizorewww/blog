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

```widget src="../widgets/glance/hero.js" title="一张图，八个问题，一次前向" note="Glance-4B-preview 的真实输出，事先跑好，页面上只做筛选。"
../images/glance/w-hero.png | 静态图：雨伞下的晚饭，Glance 框出了彩虹伞和左边站着的女人；“番茄酱”在（0.976），但框准的概率只有 0.386，标成“框不准”；“一只狗”和“生日蛋糕”回答“不在”（0.001、0.002）；“在下雨吗”是 0.155；“在哪吃饭”选了花园（0.991）
../images/glance/w-hero-n.png | 同上，手机版
```

agent 看屏幕、看视频的时候，问的从来不是一个问题，而是一串：保存对话框开着吗？“导出”按钮在哪？点“全部删除”危险吗？这一段里有没有那只蝴蝶？更要紧的是，**东西不在的时候，它得敢说不在，而且这个“不在”有多确定，要靠得住。**

Glance 是我们在 Qwen3.5-4B[@qwen35] 上训练的一个“看一眼”模型。熟悉 TypeSafe 的 Jev[@jev] 的话，可以把它看成会看图的 Jev。它不生成文字，只读一次图，就对任意多个问题各给出一个概率分布：框在哪里、是还是否、选哪一项、打几分，以及“它不在这里”。上面每个数字都是它的真实输出。两个阈值只管框问题：P(present) 低于第一个，它就回答“不在”；P(IoU ≥ 0.5) 低于第二个，框就标成“不准”。指一指问题、拖一拖阈值，有几处值得多看一眼：

- “一只狗”“生日蛋糕”不是没框出来，而是回答了“不在”，并且给出了概率。中文和英文的问题落在同一个框上。
- “番茄酱”在（0.976），可框准的概率只有 0.386：它知道桌上有番茄酱，却不确定是哪一块。东西在不在、框准不准，是两个分开的旋钮。
- “点‘全部删除’有多危险”四档的概率差不多，这就是它在说“我不知道”。一个分布比一个答案多给出的，正是这个。
- 动画那一页，“一只飞鼠”（0.661）和“一只鸟”（0.347）都指向左上角半空中那只红松鼠：拖动阈值，拿不准的答案会先出现、先消失。

## 它解决什么问题，新在哪里

今天的 agent 拿一个生成式视觉语言模型当眼睛。这只眼睛有三个毛病，每一个都会直接变成 agent 的事故：

- **一次只看一个问题。** 对同一屏问 8 件事，就要生成 8 遍，agent 每一步都在等。
- **“没有”说不准。** 目标不在时，它常常照样画一个框，agent 就去点一个不存在的按钮。在 GUI 上“目标不在屏幕上”的题里，同一个底座按生成式的方式只说对了 3.9%。
- **旋钮被锁住了。** 它的“不在”由解码规则替它定好，用的人没法按场景调；它也不知道自己框得准不准。

Glance 对这三个毛病的回答是三件事，前两件是方法，第三件是我们在路上发现的：

1. **一次前向，回答任意多个带类型的问题。** 图像只算一次，每个问题各自读出，答案直接是概率分布。难点在 Qwen3.5 这种线性注意力和注意力混合的模型上：常用的 mask 写法会让问题之间悄悄串题。我们的前向和逐个单独运行在数学上等价，一张图问 32 个问题和问 1 个几乎一样快。
2. **把“在不在”和“框准不准”做成两个校准过的旋钮。** 判断框对不对，Glance 的 IoU 头 AUROC 是 91.6，生成式的做法最多 79.7。两个概率配上一条按代价选阈值的规则，部署时按场景调，不用重训：框错一次的代价是拒答的 5 倍时，两个旋钮一起用，比只看“在不在”少付 33% 的代价。
3. **模型说不说“没有”，很大程度上是解码器替它决定的。** 同一个生成式模型，换个解码规则，拒答率能从 0.4% 变到最多约 40%。要比较两个模型会不会说“没有”，得先把解码规则固定下来。

现实意义也落在这三处。GUI agent 点击之前多了一道闸：目标不在屏幕上时，Glance 有八成会停下来（81.5%，已发表的最好结果是 78.1%），原来的底座只有 4%。agent 每一步都对着同一个画面问一串问题，一张图问 32 个问题，等待从 331 ms 降到 70 ms。同一个 4B 模型，换个阈值就能从谨慎切到激进，用它的人可以按业务设风险，而不是接受解码器替它选好的那一个点。

和 Jev 比，差别在这几处。Jev 是文本上的 System One 决策模型：给一段文本或结构化状态和一组问题，一次查询并行给出每个答案的概率。它的输入是文本和结构化状态，官方博客说图像“还没有”支持。agent 要在屏幕和视频上做决定，就得先让一个生成式模型把画面写成文字，慢和“不会说没有”的问题又回来了。Glance 把同样的接口搬到了像素上，并加上了文本决策模型不需要的两样东西：框，和“它不在这里”。

| | Jev | Glance |
| --- | --- | --- |
| 输入 | 文本、结构化状态 | 截图、照片、视频帧，加文本 |
| 一次调用回答多个问题 | 是 | 是 |
| 题型 | 分类、打分、是否 | 分类、打分、是否，加上框 |
| 目标不在时 | 不适用（不看图） | 校准过的 P(present) |
| 框准不准 | 不适用 | 校准过的 P(IoU ≥ 0.5) |
| 权重 | 闭源 API | 开放的 4B 预览权重 |
| OpenDecisions capability | 80.1（Jev 1.13.0，论文报告） | 67.7（同一基准，我们自测） |

文本决策是 Jev 的主场，OpenDecisions 上它比我们高 12 个点（两边分数各自报告，打分细节可能不完全相同）。两者正好可以接起来：Glance 负责看，Jev 负责在看到的东西上做决定。

后面按做的顺序讲：怎么在混合模型上做到一次前向而不串题，为什么生成式模型“说没有”由解码器决定，以及我们读 21 个视频 agent 的失败记录时发现，它们多半输在“看”。

## agent 问的是一串小问题

先看速度。生成式模型的每个答案都要解码出来，坐标、选项、是否还混在自由文本里，要再解析一遍。

```stats title="同一张图上问 1、8、32 个问题" meta="RTX PRO 6000 · 每次调用的延迟中位数" note="一张图，所有问题一次发出。"
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

前面说过，Glance 的接口来自 Jev 这类 System One 决策模型[@jev][@opendecisions]。我们想把视觉的“框”也变成这样一种原语，而它最重要的性质不是框得多准，而是**目标不在时能说不在，并且这个概率是校准过的**。

动手前查了一圈。用 patch 定位，GUI-Actor[@guiactor] 做过；用 presence token 判断概念在不在，SAM 3[@sam3] 做过；把框的四条边建模成分布，GFL[@gfl] 早就做过。架构的零件都不新。没人回答的是另一个问题：能不能在**一次前向**里，对一张图上的很多个问题同时给出框和校准过的“不在”？

## 一次前向，怎么问八个问题

一条输入是一张图加上很多个问题。图像部分只算一次；每个问题是接在后面的一小段 token，读出它最后一个位置的隐状态，交给对应的输出头：

- **框**：一个存在门控给出 P(present)；在图像的视觉 token 里选框中心所在的 patch；四条边各是一个 64 档的分布；再估计这个框和真值 IoU ≥ 0.5 的概率。
- **选项、是否、打分**：直接读底座语言模型头里对应标签 token（A…Z、Yes/No）的 logit，再加一个零初始化的修正。刚初始化时，它们的输出和底座下一个 token 的分布一模一样，训练只是在这个基础上微调。

```sketch title="box 头：一次读出，给出框和两个概率"
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

每个视觉 token 对应 32×32 像素。中心 patch 的训练目标，按真值框盖住每个 patch 的面积来分配，这是 GUI-Actor 的做法。四条边用 Cramér 距离（两个分布 CDF 之差的平方和）训练，最后的框是各条边分布的期望。IoU 头读的是选中那个 patch 上的特征，框的置信度是 P(present) × P(IoU ≥ 0.5)。目标不在时，只训练存在门控。训练时冻结视觉塔，在语言模型的线性层上加 LoRA（r=64）。每种问题的温度在训练分布里留出的校准集上拟合，从不碰评测集。

### 意外一：混合模型上，mask 挡不住串题

“图像只算一次，问题接在后面”，最直接的写法是把图像和 8 个问题拼成一条序列，在注意力里加一个 block mask，让每个问题只看见图像和它自己。在普通 Transformer 上这就够了。

可 Qwen3.5 是混合架构：每 4 层里 3 层是 Gated DeltaNet（GDN，一种带递归状态的线性注意力），只有 1 层是注意力。GDN 没有注意力矩阵可遮，它的状态顺着序列往后传，问题 1 写进状态的东西，问题 2 照样读得到。这个错误不会报错，不会让分数崩掉，只会让每个答案悄悄依赖于排在它前面的问题。

```widget src="../widgets/glance/leak.js" title="block mask 挡住了注意力，挡不住 GDN 的状态" note="27B 上的对照实验。"
../images/glance/w-leak.png | 静态图：上面是把图像和三个问题拼起来加 block mask，GDN 层的递归状态从问题 1 一直传到问题 3；下面是 Glance 的做法，每个问题从前缀的状态重新开始
../images/glance/w-leak-n.png | 同上，手机版
```

我们在 27B 上做了对照：938 个 token 的前缀后面接 8 个问题块，每块 25 个 token，看第 4 块的隐状态和它单独运行时差多少（‖拼接 − 单独‖ / ‖单独‖）。加了 mask 还差 39.8%，不加 mask 是 44.1%，mask 几乎没起作用；换成 flex attention 的 BlockMask 也还差 38.7%。

所以我们自己写了前向：前缀照常算一次，记下每个 GDN 层最后的递归状态和最后 3 个 conv 输入，每个问题块都从这份状态重新开始；注意力层里每个块只看前缀和自己。数学上，这等于把每个“前缀 + 问题”分开跑，只是前缀只算一次。在随机初始化的小 Qwen3.5 配置上逐块对比参考实现，fp32 下的相对误差约 1e-7；换成真实的 4B 权重，余弦相似度不低于 0.99999。

结果是，问多少个问题，代价几乎不变：问 1 个问题 67 ms，问 8 个还是 67 ms，32 个是 70 ms。

## 意外二：说不说“没有”，由解码器决定

我们原本想证明的是：自回归地生成坐标，天生不擅长说“没有”，而一个显式的存在门控更好。为了验证，做了一组受控实验：**同一个 4B 底座、同样的 LoRA、同样的数据和顺序、同样 3,058 步，只换输出头**。

- **门控**：上面的框头，P(present) 是一个数。
- **数字**：生成 `x1,y1,x2,y2`，0–1000，每位数字一个 token；不在就生成 `none`。
- **层级**：每个坐标两个新 token，先粗后细，共 32×32 = 1,024 级[@song2025]。
- **原子 100 / 原子 1000**：每个坐标值一个新 token，100 级或 1,000 级。

生成式的头还要选一个解码规则来决定“说不说 none”：贪心解码；P(none) ≥ 0.5 的阈值；或者比较整串 `none` 和整串坐标的概率，大的赢。

下面这张图，横轴是目标明明在、模型却说“不在”的比例（RefCOCO val，10,834 个表达式），纵轴是目标真的不在时说对“不在”的比例（gRefCOCO val 的无目标表达式，8,905 个）。每条曲线是一个头在自己的“不在”概率上取遍所有阈值：门控用 1 − P(present)，生成式头用 P(none)。曲线上的点，是某个解码规则落在哪里。选一个头、一个规则，看看会发生什么：

```widget src="../widgets/glance/dial.js" title="同一个数字头，只换解码规则：拒答率从 0.4% 到最多约 40%" note="单个 seed。"
../images/glance/w-dial.png | 静态图：五个输出头的曲线几乎重合；同一个数字头，阈值 0.5 下把 0.4% 的在场目标说成“不在”，整串比较下最多 39.9%
../images/glance/w-dial-n.png | 同上，手机版
```

结果和预想的不一样，但更有意思。

**生成式头其实知道东西在不在。** 五条曲线几乎重合：把阈值调到恰好拒答 1% 的在场目标时，四种坐标写法的头都能拒掉 81–82% 的无目标表达式，门控是 81.3%；AUROC 都在 96.2–96.7 之间。门控在“不在”上并没有赢。

**但它什么时候说出来，是坐标的写法决定的。** 一个框的概率摊在成千上万种坐标串上，`none` 只有一种写法。在 RefCOCO 的 21,586 个在场目标上，贪心解码的拒答是同一个模型用 0.5 阈值时的 1.3–3.1 倍；按整串概率比较时，从原子 100 的 3.4% 一路涨到数字头的最多 39.9%。同样的底座和数据，只换切坐标的方式，模型“说没有”的频率就差十倍。整串比较时，候选坐标用的是贪心解出的那一串，所以这是拒答率的上界；贪心和 0.5 阈值则几乎不受是否加语法约束的影响（原子 1000 在 16,158 个目标里只有 53 个不同）。

甚至不用换词表，换搜索算法就够了。同一个数字头：贪心解码在这 21,586 个目标上把 0.60% 说成“不在”；beam search（宽 4）在一批 191 个目标上是 4.7%，因为 `none` 在第一步就排不进前 4 个候选、被直接剪掉了；在同一批目标上按整串概率比较，最多是 37.7%。同一个模型、同一张图，拒答率由解码器挑。这就是表面形式竞争[@holtzman2021]，只不过它决定的是一个 agent 会不会把在场的按钮当成不存在。

原子 1000 还有一个更隐蔽的版本：表面形式竞争也会发生在**框的内部**。一个坐标值被摊在 1,000 个相邻的 token 上，在场目标的第一个 token 上，除 `none` 以外最可能的那个只拿到平均 0.19 的概率（数字是 0.78），于是不加约束地贪心解码时，24.2% 的输出连格式都不对，RefCOCO 只有 73.1；用语法约束把每一步限制在合法 token 上，同一个模型就回到 93.8。

所以门控的价值不在“看得更准”，而在两件事：

- **“不在”是一个你能拧的旋钮。** 它是一个校准过的概率，阈值由用户定，换了场景还能按新的先验平移；生成式头给你的，是解码规则替你选好的一个点。
- **框准不准，也是一个旋钮。** 框头还给出 P(IoU ≥ 0.5)，它在在场目标上分辨“框对了”和“框错了”的 AUROC 是 91.6；生成式头不管用哪种分数最多 79.7，用整串概率最多 75.4。把“在不在”和“框得准不准”两个阈值一起用（在训练分布的校准集上定阈值，不碰评测集），和只用存在门控相比，在框错一次的代价是拒答的 1、2、5 倍时，实际代价分别降 4%、13%、33%；在 5% 的目标不在、框错代价为 5 的“点击”场景里降 31%，置信区间都不含 0。
- **不用解码。** 生成式头每个问题还要解码 5–15 步，门控是 0 步。这就是开头那组对比里的差距：和打开前缀缓存的 vLLM 比，一张图问 8 个问题是 67 对 218 ms。

同一组实验还给了第二个结论：**幻觉主要由训练数据里负样本的比例决定，和输出头关系不大。** 把训练时“不在”的问题从 25% 降到 5%，三种读法在无目标表达式上画出框的比例都升了 11 个点左右，门控也一样。

这里的幻觉率，是 gRefCOCO val 的无目标表达式上没有说“不在”的比例。门控按 P(present) ≥ 0.5 判断；数字头分别看 P(none) < 0.5 的阈值和贪心解码。

```echarts title="负样本从 25% 减到 5%，三种读法都多了约 11 个点的幻觉" height="250" note="空心点：5% 的模型按训练先验平移 logit 之后。"
{"tooltip": {"trigger": "item"}, "legend": {"data": ["负样本 25%", "负样本 5%", "5% + 先验修正"]}, "grid": {"left": 64, "right": 44, "top": 40, "bottom": 40}, "xAxis": {"type": "value", "min": 15, "max": 40, "name": "无目标表达式上画了框", "nameLocation": "middle", "nameGap": 26, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "data": ["门控", "数字·阈值", "数字·贪心"], "inverse": true, "axisTick": {"show": false}}, "series": [{"type": "bar", "stack": "d", "silent": true, "itemStyle": {"color": "transparent"}, "data": [24.3, 24.2, 22.0], "tooltip": {"show": false}}, {"type": "bar", "stack": "d", "silent": true, "barWidth": 3, "itemStyle": {"color": "var(--line)"}, "data": [11.4, 10.8, 10.8], "tooltip": {"show": false}}, {"name": "负样本 25%", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--stone)"}, "z": 3, "label": {"show": true, "position": "top", "distance": 6, "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [["24.3", 0], ["24.2", 1], ["22.0", 2]], "tooltip": {"formatter": "{a}：{@[0]}%"}}, {"name": "负样本 5%", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--clay)"}, "z": 4, "label": {"show": true, "position": "right", "formatter": "{@[0]}%", "color": "var(--ink)", "textBorderColor": "transparent"}, "data": [["35.7", 0], ["35.0", 1], ["32.8", 2]], "tooltip": {"formatter": "{a}：{@[0]}%"}}, {"name": "5% + 先验修正", "type": "scatter", "symbolSize": 10, "itemStyle": {"color": "var(--paper)", "borderColor": "var(--clay)", "borderWidth": 2}, "z": 5, "label": {"show": true, "position": "bottom", "distance": 6, "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [["27.3", 0], ["24.6", 1]], "tooltip": {"formatter": "{a}：{@[0]}%"}}]}
```

先验变了，可以事后平移 logit 修正（图里的空心点）：门控从 35.7% 修到 27.3%，数字头用 P(none) 的阈值做同样的修正是 24.6%，门控并没有更好；贪心解码没有阈值可平移。这把我们推回到了数据。

## 让“不在”变得可信的，是数据

第一版（v0）只在 COCO 系列上训练：RefCOCO、RefCOCO+、RefCOCOg，gRefCOCO[@grefcoco] 里的无目标表达式，再从别的图里借来一些描述当负样本。24,462 张图、355,385 个问题，一张卡 78 分钟。框很准，8 个 RefCOCO 评测集平均 Acc@0.5 是 92.8。

可它对真正难的负样本过于自信。gRefCOCO 的无目标表达式是“图里有狗，但没有‘左边那只白狗’”这种，v0 能说对“不在”的只有 77.0%，而在只含无目标和多目标表达式的子集上，存在门控的 ECE 高达 0.139。训练时借来的负样本太容易了：类别根本不在图里。

同样的数据换到 Qwen3.8-27B 上再训一遍，框更准了（平均 94.1），“不在”几乎没动。让它动起来的是 v1 换的数据：加入 GUI 截图、PixMo 的指点和计数，并刻意构造**难负样本**，也就是同一张图里存在、但不符合描述的东西（GUI 里是同一屏上的别的按钮）。

下表的 N-acc 是 gRefCOCO val 无目标表达式上说对“不在”的比例；AUROC 和 ECE 衡量存在门控，算在 gRefCOCO val 加 RefCOCO val 共 25,063 个表达式上。注意 27B 换的是 Qwen3.8-27B，规模和底座版本是同时变的。v1 的 ECE 未校准时是 0.023，表里是温度校准后的值。

```data title="加了难负样本，“不在”才变得可信" bars="N-acc" mark="v1 4B"
模型 | N-acc | AUROC | ECE
v0 4B | 77.0 | 0.964 | 0.075
v0 27B | 77.5 | 0.968 | 0.074
v1 4B | 87.4 | 0.979 | 0.024
```

GUI 上也是同一个故事。v0 在 COCO 上训了 78 分钟，拿去测 ScreenSpot-v2[@screenspotv2] 只有 28.6，生成式底座是 93.4。一开始我们怀疑是分辨率：v0 最多用 640 个视觉 token。可在 ScreenSpot-Pro[@screenspotpro] 上把 v0 的视觉 token 提到 4,000，它也只从 0.9% 升到 1.8%，底座是 56.0%。新加的头只见过自然图像里的物体，分辨率不是主因。v1 加了 GUI 截图之后，ScreenSpot-v2 回到 89.4。在 VenusBench-GD[@venusbench] 里“目标不在屏幕上”的题上，v1 说对了 81.5%，比已发表的最好结果（78.1%）还高（用的是我们自己的评测脚本）；同一个底座按生成式的方式、用同一个评测脚本，只有 3.9%。目标在场的题，点击准确率是 47.3%（这部分计分时没有经过门控）。

## 拿到视频上

一个会说“不在”的框，放到视频上就是一条时间曲线：每隔几秒取一帧，问“兔子在不在”“有没有蝴蝶”，P(t) 越过阈值的地方就是它出现的时间段，连起来的段数就是次数。逐帧扫描是“多张图、每张图问几个问题”的用法，Glance 的速度优势在这里会缩小到 1.2–1.9 倍。下面是 Big Buck Bunny 的前 8 分钟（0–476 秒），每 4 秒一帧，共 120 帧。每帧在一次前向里同时问 5 个问题，4 个框问题、1 个是否问题，图里画出 4 个框问题。“飞鼠”指片中的飞鼠 Frank，不含另外两只啮齿动物。曲线下的灰条是我们逐帧看图标出的“在”。拖动曲线看任意一帧：

```widget src="../widgets/glance/video.js" title="在不在，随时间变成一条曲线" note="视频 © 2008 Blender Foundation，www.bigbuckbunny.org，CC BY 3.0（https://creativecommons.org/licenses/by/3.0/），帧经过缩放。"
../images/glance/w-video.png | 静态图：2 分 16 秒那一帧，Glance 框出了兔子（0.996）、蝴蝶（0.992）和左上角的红松鼠（飞鼠 0.661）；下面是四条 P(t) 曲线和人工标注
../images/glance/w-video-n.png | 同上，手机版
```

在 0.5 的阈值上，它和人工标注的一致率是兔子 111/113、飞鼠 111/115、蝴蝶 115/118，“红色汽车”在 120 帧里一次都没有说在。看不清的帧没有计入；标注时我们看得到模型的输出，所以这个一致率偏乐观。有些“错”其实是我们没看见：片头 0:28 那一帧，模型说有蝴蝶（0.99），放大才发现标题字母上真停着一只。

不过这是一个物体检测器在逐帧回答，而视频 agent 真正卡住的地方，比这更难。

## 意外三：视频 agent 错在哪里

为了知道 Glance 作为工具该补什么，我们先读了 Video-Index[@videoindex] v1.1 上 21 个 agent 公开的运行记录（144 题）。我们从最强的四个 agent（Opus 5.5、Opus 5、Gemini 4 Argon、GPT-6-Astra）的错误或无答案运行里，按 agent × 能力组分层抽样，每格 3 个，共 48 个，按事先定好的规则逐条标注。感知类（前三行）合计 27 个，占 56%，95% 置信区间 42%–69%；只有一个人标注，所以区间偏乐观。

```data title="48 个失败运行，一半以上是“看”出了问题" bars="占比" mark="看错了"
类型 | 个数 | 占比
看错了 | 21 | 43.8%
没看到 | 5 | 10.4%
时间段找错 | 1 | 2.1%
推理或知识 | 8 | 16.7%
超时或框架错误 | 7 | 14.6%
答案可疑 | 6 | 12.5%
```

推理错误只有 8 个。最多的是**看错了**：找对了场景，却把颜色认错、把次数数错、把方向看反。下面两个例子里，答案取自各 agent 自己的输出，备注是我们读轨迹时写的。Video-Index 的视频只允许用于评测，所以这里不放任何画面。

```cases title="找到了，但看错了；或者翻遍了，没看到" note="Video-Index v1.1 的公开轨迹。"
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

“没看到”和“看错了”的边界，要把 agent 看过哪里画出来才分得清。下面这道计数题是一段 319 秒的第一人称视频，问“我指了乐高盒子几次？”，答案 5 次，21 个 agent 里只有 4 个答对。Gemini 4 Argon 数出 3 次。

数据集没有逐次的时间标注，图里编号的 5 个时刻，是答对的 GPT-6-Astra 自己写的“around 129, 132, 134, 232, and 249 seconds”；黑框是 Argon 自己写下的 3 段指向。色带按轨迹里每条抽帧命令的时间范围和帧率画出；Codex 的轨迹不记录看图事件，所以 Astra 那一行是“抽出来的帧”，不一定都看过。把这些叠在一起，漏掉的两次都落在 Argon 用 6 帧/秒细看过的窗口里：它看到了，只是没数对（上面的分类表里，这一例按最初的标注算在“没看到”）。这正是逐段问“这一刻在不在指”的 P(t) 能直接回答的问题。

```sketch title="Argon 细看过那两次指向，只是没数到" note="S-EMBER_7291。只用时间，不含任何画面。"
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

下图里，每张图的所有说法都在一次前向里一起问，竖线是 0.5 的阈值；没过线的说法，框画成虚线，标签写“它说不在”。

```widget src="../widgets/glance/phrasing.js" title="同一个东西，换个说法" note="照片：Walter Lim，“Ice capuccino and durian durian cake for #tea”；Peter Moons，“Dinner under the umbrella.”，均为 CC BY 2.0（COCO val2017）。界面：Glance 仓库的 examples/gui_mock.html，Apache-2.0。"
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

## 数字从哪来

- 延迟都在一张 RTX PRO 6000 上测，取每次调用的中位数，全文出自同一套测量。一张照片不超过 640 个视觉 token；软件界面的截图更大，会更慢，我们没有单独测。
- 页面上的交互图都是 Glance-4B-preview 事先跑好的真实输出，在 Apple 芯片上用 MPS、fp32 跑；视频那张平均每帧约 1.6 秒。

## 参考资料

- [@qwen35] Qwen Team (2026). [Qwen3.5: Towards Native Multimodal Agents](https://qwen.ai/blog?id=qwen3.5). _Qwen blog_, February 2026.
- [@jev] Almeida, D. (2026). [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev). _TypeSafe AI blog_, September 2026.
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
