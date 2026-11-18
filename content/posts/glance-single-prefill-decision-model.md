---
title: "Glance：一眼问完八个问题，而且敢说“不在”"
description: "一次前向回答一张图上的一串问题，每个答案都带概率，包括“不在”。还有路上撞见的三件意外：拒答是解码器选的，可信的“不在”靠数据，视频 agent 输在“看”。"
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

Glance 是我们在 Qwen3.5-4B[@qwen35] 上训练的一个“看一眼”模型。熟悉 TypeSafe 的 Jev[@jev] 的话，可以把它看成专为看画面做的 Jev：它的框会说“不在”，也会说自己框得准不准。它不生成文字，只读一次图，就对任意多个问题各给出一个概率分布：框在哪里、是还是否、选哪一项、打几分，以及“它不在这里”。上面每个数字都是它的真实输出。两个阈值只管框问题：P(present) 低于第一个，它就回答“不在”；P(IoU ≥ 0.5) 低于第二个，框就标成“不准”。指一指问题、拖一拖阈值，有几处值得多看一眼：

- “一只狗”“生日蛋糕”不是没框出来，而是回答了“不在”，并且给出了概率。中文和英文的问题落在同一个框上。
- “番茄酱”在（0.976），可框准的概率只有 0.386：它知道桌上有番茄酱，却不确定是哪一块。东西在不在、框准不准，是两个分开的旋钮。
- “点‘全部删除’有多危险”四档的概率差不多，这就是它在说“我不知道”。一个分布比一个答案多给出的，正是这个。
- 动画那一页，“一只飞鼠”（0.661）和“一只鸟”（0.347）都指向左上角半空中那只红松鼠：拖动阈值，拿不准的答案会先出现、先消失。

## 它解决什么问题，新在哪里

今天的 agent 拿一个生成式视觉语言模型当眼睛。这只眼睛有三个毛病，每一个都会直接变成 agent 的事故：

- **一次只看一个问题。** 对同一屏问 8 件事，就要解码 8 遍，agent 每一步都在等。
- **“没有”说不准。** 目标不在时，它常常照样画一个框，agent 就去点一个不存在的按钮。在 GUI 上“目标不在屏幕上”的题里，同一个底座用常见的写法几乎从不拒答（不到 4%），换遍我们试过的提示词也最多四成多。
- **旋钮被锁住了。** 它说不说“不在”，由解码规则替它定好，用的人没法按场景调；它也不知道自己框得准不准。

```sketch title="同样问三个问题：生成式逐题解码，Glance 读一次" note="示意，P 值是举例。"
<svg viewBox="0 0 704 330">
<rect class="panel" x="0" y="0" width="344" height="330" rx="12"/>
<rect class="panel" x="360" y="0" width="344" height="330" rx="12"/>
<text class="caps" x="24" y="28">生成式 VLM</text>
<g class="node clay"><rect x="82" y="48" width="180" height="30" rx="15"/><text class="mid" x="172" y="63">一张图 + 3 个问题</text></g>
<path class="edge" d="M172.0 78 V96" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="62" y="98" width="220" height="30" rx="4"/><text class="mid" x="172" y="113">prefill，然后逐题解码</text></g>
<text class="small" x="24" y="165">问题 1</text>
<g class="node plain"><rect x="76" y="150" width="244" height="30" rx="4"/><text class="mid mono" x="198" y="165">4 1 2 , 0 8 8 , 6 0 1 …</text></g>
<text class="small" x="24" y="205">问题 2</text>
<g class="node plain"><rect x="76" y="190" width="244" height="30" rx="4"/><text class="mid mono" x="198" y="205">3 0 , 1 9 2 , 7 7 …</text></g>
<text class="small" x="24" y="245">问题 3</text>
<g class="node plain"><rect x="76" y="230" width="244" height="30" rx="4"/><text class="mid mono" x="198" y="245">n o n e</text></g>
<path class="edge" d="M172.0 128 V146" marker-end="url(#arrow)"/>
<text class="small" x="24" y="288">每题解码 5–20 步，再解析文本</text>
<text class="small accent" x="24" y="308">“不在”要和成千上万种坐标写法比概率</text>
<text class="caps" x="384" y="28">Glance</text>
<g class="node clay"><rect x="442" y="48" width="180" height="30" rx="15"/><text class="mid" x="532" y="63">一张图 + 3 个问题</text></g>
<path class="edge" d="M532.0 78 V96" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="422" y="98" width="220" height="30" rx="4"/><text class="mid" x="532" y="113">prefill：图像只算一次</text></g>
<path class="edge" d="M532.0 128 V138 H430.6666666666667 V148" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="384" y="150" width="93.3333" height="30" rx="4"/><text class="mid" x="430.667" y="165">问题 1</text></g>
<path class="edge" d="M430.6666666666667 180 V206" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="384" y="210" width="93.3333" height="30" rx="4"/><text class="mid" x="430.667" y="225">不在 0.998</text></g>
<path class="edge" d="M532.0 128 V138 H532.0 V148" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="485.333" y="150" width="93.3333" height="30" rx="4"/><text class="mid" x="532" y="165">问题 2</text></g>
<path class="edge" d="M532.0 180 V206" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="485.333" y="210" width="93.3333" height="30" rx="4"/><text class="mid" x="532" y="225">框 · 准 0.91</text></g>
<path class="edge" d="M532.0 128 V138 H633.3333333333333 V148" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="586.667" y="150" width="93.3333" height="30" rx="4"/><text class="mid" x="633.333" y="165">问题 3</text></g>
<path class="edge" d="M633.3333333333333 180 V206" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="586.667" y="210" width="93.3333" height="30" rx="4"/><text class="mid" x="633.333" y="225">选 A 0.99</text></g>
<text class="small" x="384" y="266">每个问题从前缀的状态分出去，互不相见</text>
<text class="small" x="384" y="288">0 步解码；每个答案直接是一个分布</text>
<text class="small accent" x="384" y="308">“不在”是一个数，阈值由你定</text>
</svg>
<svg viewBox="0 0 340 670">
<rect class="panel" x="0" y="0" width="340" height="330" rx="12"/>
<rect class="panel" x="0" y="340" width="340" height="330" rx="12"/>
<text class="caps" x="24" y="28">生成式 VLM</text>
<g class="node clay"><rect x="80" y="48" width="180" height="30" rx="15"/><text class="mid" x="170" y="63">一张图 + 3 个问题</text></g>
<path class="edge" d="M170.0 78 V96" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="60" y="98" width="220" height="30" rx="4"/><text class="mid" x="170" y="113">prefill，然后逐题解码</text></g>
<text class="small" x="24" y="165">问题 1</text>
<g class="node plain"><rect x="76" y="150" width="240" height="30" rx="4"/><text class="mid mono" x="196" y="165">4 1 2 , 0 8 8 , 6 0 1 …</text></g>
<text class="small" x="24" y="205">问题 2</text>
<g class="node plain"><rect x="76" y="190" width="240" height="30" rx="4"/><text class="mid mono" x="196" y="205">3 0 , 1 9 2 , 7 7 …</text></g>
<text class="small" x="24" y="245">问题 3</text>
<g class="node plain"><rect x="76" y="230" width="240" height="30" rx="4"/><text class="mid mono" x="196" y="245">n o n e</text></g>
<path class="edge" d="M170.0 128 V146" marker-end="url(#arrow)"/>
<text class="small" x="24" y="288">每题解码 5–20 步，再解析文本</text>
<text class="small accent" x="24" y="308">“不在”要和成千上万种坐标写法比概率</text>
<text class="caps" x="24" y="368">Glance</text>
<g class="node clay"><rect x="80" y="388" width="180" height="30" rx="15"/><text class="mid" x="170" y="403">一张图 + 3 个问题</text></g>
<path class="edge" d="M170.0 418 V436" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="60" y="438" width="220" height="30" rx="4"/><text class="mid" x="170" y="453">prefill：图像只算一次</text></g>
<path class="edge" d="M170.0 468 V478 H70.0 V488" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="24" y="490" width="92" height="30" rx="4"/><text class="mid" x="70" y="505">问题 1</text></g>
<path class="edge" d="M70.0 520 V546" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="24" y="550" width="92" height="30" rx="4"/><text class="mid" x="70" y="565">不在 0.998</text></g>
<path class="edge" d="M170.0 468 V478 H170.0 V488" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="124" y="490" width="92" height="30" rx="4"/><text class="mid" x="170" y="505">问题 2</text></g>
<path class="edge" d="M170.0 520 V546" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="124" y="550" width="92" height="30" rx="4"/><text class="mid" x="170" y="565">框 · 准 0.91</text></g>
<path class="edge" d="M170.0 468 V478 H270.0 V488" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="224" y="490" width="92" height="30" rx="4"/><text class="mid" x="270" y="505">问题 3</text></g>
<path class="edge" d="M270.0 520 V546" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="224" y="550" width="92" height="30" rx="4"/><text class="mid" x="270" y="565">选 A 0.99</text></g>
<text class="small" x="24" y="606">每个问题从前缀的状态分出去，互不相见</text>
<text class="small" x="24" y="628">0 步解码；每个答案直接是一个分布</text>
<text class="small accent" x="24" y="648">“不在”是一个数，阈值由你定</text>
</svg>
```

Glance 对这三个毛病的回答是三件事：

1. **一次前向，回答任意多个带类型的问题。** 图像只算一次，每个问题从图像的状态分出去各自读出，答案直接是概率分布。在 Qwen3.5 这种线性注意力和注意力混合的模型上，常用的 mask 写法会让问题之间悄悄串题；我们的前向和逐个单独运行在数学上等价。一张图问 8 个框问题 45 ms，我们能配出的最强生成式方案要 134 ms。
2. **把“在不在”和“框准不准”做成两个校准过的旋钮。** 判断框对不对，Glance 的 AUROC 是 91.6，生成式的做法最多 79.7。两个概率配一条按代价选阈值的规则，部署时按场景调，不用重训。
3. **一个可以复用的发现：生成式模型会不会给不存在的东西画框，是一个设置，不是模型的性质。** 在四个现成的 VLM 上，只换提示词、坐标格式和解码器，不在的目标被画上框的比例从 17% 到 92%，同一个 Qwen 模型内部就能差 50–60 个点。受控实验告诉我们为什么：“不在”只有一种写法，“在”有成千上万种，谁赢取决于怎么计票。而 Glance 的“不在”是一个概率，可以连续地拧，不挑提示词。

做的路上还撞见两件和预想不一样的事：让“不在”变可信的是数据，不是更大的底座（而且我们自己的数据教会了模型一条捷径）；视频 agent 答错，多半是看错了，而不是想错了。

落到 agent 身上：GUI agent 点击之前多了一道闸，同样把两成在场的按钮误当成不存在，Glance 能拦下五成多根本不在屏幕上的目标，同一个底座换遍提示词最多四成多，而 Glance 的阈值还能往谨慎那头继续拧（GUI 上的误拒偏高，后面会讲）；agent 对着同一个画面追问时，每次只要十几毫秒；同一个 4B 模型，换个阈值就能从谨慎切到激进，按业务设风险，而不是接受解码器替它选好的那一个点。

和 Jev 比，差别在框上。Jev 是 System One 决策模型：给一段状态和一组问题，一次查询并行给出每个答案的概率；从 1.14 起，它也实验性地支持了图片和 `box` 题型[@jev114]。但它的框没有“不在”这个答案（文档建议另问一个是否题），框上也只有一个 confidence。Glance 把两件事做进了框本身。后面有一节是我们在同一批题上实测的对比。

## 一次前向，问任意多个问题

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

每个视觉 token 对应 32×32 像素。中心 patch 的训练目标，按真值框盖住每个 patch 的面积来分配，这是 GUI-Actor[@guiactor] 的做法；四条边建模成分布来自 GFL[@gfl]，用 Cramér 距离（两个分布 CDF 之差的平方和）训练，最后的框是各条边分布的期望；用一个 presence 量判断概念在不在，SAM 3[@sam3] 也这么做。零件都不新，新的是把它们放进**一次前向**，对一张图上的很多个问题同时给出框和校准过的“不在”。IoU 头读的是选中那个 patch 上的特征，框的置信度是 P(present) × P(IoU ≥ 0.5)。目标不在时，只训练存在门控。训练时冻结视觉塔，在语言模型的线性层上加 LoRA（r=64）。每种问题的温度在训练分布里留出的校准集上拟合，从不碰评测集。

### 混合模型上，mask 挡不住串题

“图像只算一次，问题接在后面”，最直接的写法是把图像和 8 个问题拼成一条序列，在注意力里加一个 block mask，让每个问题只看见图像和它自己。在普通 Transformer 上这就够了。

可 Qwen3.5 是混合架构：每 4 层里 3 层是 Gated DeltaNet（GDN，一种带递归状态的线性注意力），只有 1 层是注意力。GDN 没有注意力矩阵可遮，它的状态顺着序列往后传，问题 1 写进状态的东西，问题 2 照样读得到。这种串题不会报错，也不会让分数崩掉，只会让每个答案悄悄依赖于排在它前面的问题。

```widget src="../widgets/glance/leak.js" title="block mask 挡住了注意力，挡不住 GDN 的状态" note="27B 上的对照实验。"
../images/glance/w-leak.png | 静态图：上面是把图像和三个问题拼起来加 block mask，GDN 层的递归状态从问题 1 一直传到问题 3；下面是 Glance 的做法，每个问题从前缀的状态重新开始
../images/glance/w-leak-n.png | 同上，手机版
```

我们在 27B 上量了一下串了多少：938 个 token 的前缀后面接 8 个问题块，每块 25 个 token，看第 4 块的隐状态和它单独运行时差多少（‖拼接 − 单独‖ / ‖单独‖）。不加 mask 差 44.1%，加了 mask 还差 39.8%，换成 flex attention 的 BlockMask 也还差 38.7%。三种写法几乎一样糟。

所以我们自己写了前向：前缀照常算一次，记下每个 GDN 层最后的递归状态和最后 3 个 conv 输入，每个问题块都从这份状态重新开始；注意力层里每个块只看前缀和自己。数学上，这等于把每个“前缀 + 问题”分开跑，只是前缀只算一次。在随机初始化的小 Qwen3.5 配置上逐块对比参考实现，fp32 下的相对误差约 1e-7；换成真实的 4B 权重，余弦相似度不低于 0.99999。

```echarts title="和单独运行差多少：三种 mask 写法都差约 40%，从前缀状态重开约 1e-7" note="前三条在 27B 上测，最后一条在小配置 fp32 上测。对数轴。" height="230"
{"tooltip": {"trigger": "item", "formatter": "{b}"}, "grid": {"left": 96, "right": 56, "top": 12, "bottom": 40}, "xAxis": {"type": "log", "min": 1e-08, "max": 1, "name": "相对误差（对数轴）", "nameLocation": "middle", "nameGap": 26}, "yAxis": {"type": "category", "inverse": true, "axisTick": {"show": false}, "data": ["不加 mask", "block mask", "flex BlockMask", "前缀状态重开"]}, "series": [{"type": "scatter", "symbolSize": 13, "data": [{"value": [0.441, 0], "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "44.1%", "color": "var(--ink)", "textBorderColor": "transparent"}}, {"value": [0.398, 1], "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "39.8%", "color": "var(--ink)", "textBorderColor": "transparent"}}, {"value": [0.387, 2], "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "38.7%", "color": "var(--ink)", "textBorderColor": "transparent"}}, {"value": [1e-07, 3], "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "position": "right", "formatter": "≈1e-7", "color": "var(--ink)", "textBorderColor": "transparent"}}]}]}
```

### 有多快，快在哪里

速度要和最强的对手比。我们能配出的最强生成式方案，是 Qwen3.5-4B 跑在 vLLM 0.34 上，打开前缀缓存、CUDA graph、MTP 投机解码，权重用 FP8。同一张 RTX PRO 6000，同一批 RefCOCO 照片（不超过 640 个视觉 token），一张图问 1、8、32 个框问题：Glance 是 43、45、61 ms，它是 99、134、229 ms，Glance 快 2.3、3.0、3.8 倍；和同样设置下 bf16 的 vLLM 比，是 2.7、3.6、4.6 倍。两边都从缩放好的图算到拿到全部答案，图像预处理也算在内。Glance 这边是 bf16，和 fp32 的参考前向比，“在不在”的判断 99.78% 一致。

```echarts title="一张图问 N 个框问题，一次调用的延迟" note="RTX PRO 6000，50 次调用的中位数。" height="330"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value} ms"}, "grid": {"left": 52, "right": 128, "top": 20, "bottom": 44}, "xAxis": {"type": "category", "data": ["1", "2", "4", "8", "16", "32", "64"], "name": "每张图的问题数", "nameLocation": "middle", "nameGap": 28}, "yAxis": {"type": "value", "axisLabel": {"formatter": "{value} ms"}}, "series": [{"name": "Glance", "type": "line", "symbolSize": 6, "itemStyle": {"color": "var(--clay)"}, "lineStyle": {"width": 2.5}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}"}, "data": [43, 43, 43, 45, 50, 61, 85]}, {"name": "vLLM 最强配置", "type": "line", "symbolSize": 5, "itemStyle": {"color": "var(--stone)"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}"}, "data": [99, 112, 117, 134, 166, 229, 361]}, {"name": "vLLM bf16", "type": "line", "symbolSize": 4, "itemStyle": {"color": "var(--muted)"}, "lineStyle": {"type": "dashed"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}"}, "data": [167, 186, 202, 221, 259, 334, 481]}, {"name": "vLLM 不解码", "type": "line", "symbolSize": 4, "itemStyle": {"color": "var(--sky)"}, "lineStyle": {"type": "dotted"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}"}, "data": [39, 50, 53, 65, 87, 141, 234]}]}
```

快在哪里？我们把 vLLM 也改成每个问题只读一个 token、不解码（这样它只能答“在不在”，给不出框）：一个问题时它也降到 39 ms，和 Glance 一样快。所以优势来自不解码，而不是我们的引擎更快；Glance 做到的，是不解码也能给出框。问题一多，vLLM 那条线仍然涨得更快，因为每个问题在它那里都是一个单独的请求。

agent 最常见的用法，是对已经看过的画面接着追问。图像的状态已经在缓存里，再问 1、8、32 个问题只要 11、14、28 ms，最强的对手要 78、113、212 ms，快 7–8 倍。换到更便宜的 L4 上差距更大：一张图问 1、8、32 个问题快 2.6、3.2、5.4 倍，追问快 10–12 倍。

它也有不快的时候。一次调用的时间主要花在 prefill 上时，不解码省下的那点时间就不够用了：一张 4,096 个视觉 token 的大截图只问一个问题，或者 32–64 帧视频每帧只问一个问题，Glance 和对手持平甚至更慢（0.5–1.0 倍）。输的原因是我们研究用的引擎做长序列和多张图的 prefill 比 vLLM 慢，不是读出方式。

```data title="不同用法下的延迟（ms），Glance 对最强生成式配置" bars="倍数" mark="追问 8 个"
用法 | 倍数 | Glance | 对手
问 8 个框 | 3.0× | 45 | 134
问 32 个框 | 3.8× | 61 | 229
追问 8 个 | 8.3× | 14 | 113
L4，问 32 个 | 5.4× | 354 | 1,909
四种题型 8 个 | 2.3× | 54 | 122
2K 截图问 32 个 | 2.7× | 155 | 419
4K 截图问 1 个 | 0.88× | 299 | 262
64 帧各问 1 个 | 0.52× | 1,161 | 609
```

## 意外一：会不会画出不存在的框，是一个设置

我们原本想证明的是：自回归地生成坐标，天生不擅长说“没有”，一个显式的存在门控更好。结果不是这样。生成式模型其实知道东西在不在；它说不说出来，取决于你用什么规则把它的概率变成一个答案。下面先讲机制，再看它在现成模型上是什么样子：同一个模型，换提示词、坐标格式和解码器，对不存在的东西画框的比例能差五六十个点。

### 一个独立候选人，和一个分了票的大党

生成式模型回答“框出 X”，是写出一串文字：要么写 `none`，要么写四个坐标，比如 `412,088,601,733`。“不在”只有一种写法。“在”却有成千上万种：`412,088,601,733` 和 `413,088,601,733` 几乎是同一个框，但对模型来说是两串不同的答案，各分走一小份概率。

举个数字：模型认为 30% 是 `none`，70% 是“在”，而这 70% 平均摊在 100 种差不多的坐标写法上，每种 0.7%。

- **规则 A：挑单个概率最高的完整答案。** 这叫最大后验（MAP），beam search 想逼近的就是它。`none` 的 30% 比任何一种 0.7% 都大，于是回答“不在”。
- **规则 B：先看“在”的总概率。** P(none) 只有 30%，不到 0.5，于是回答“在”，再挑一个框。

同一组概率，两个相反的答案。这和选举一样：一个独立候选人拿 30% 的票，一个党拿 70%，但党内有 100 个候选人在分票。数单个候选人的票，独立候选人赢；数党的总票，党赢。贪心解码介于两者之间：它在第一步比较 `none` 和“第一个数字是 4”，后者已经把所有以 4 开头的框合在一起了，所以它更像规则 B。

```sketch title="同一组概率，两种计票，两个答案" note="示意，数字是举例。"
<svg viewBox="0 0 704 400">
<rect class="panel" x="0" y="0" width="704" height="400" rx="12"/>
<text class="small b" x="24" y="30">一个问题的全部答案，按概率</text>
<rect x="70" y="160.0" width="56" height="90.0" rx="2" fill="var(--clay)"/>
<text class="mid b" x="98" y="148">30%</text>
<text class="mid mono" x="98" y="266">none</text>
<text class="small mid" x="98" y="284">“不在”</text>
<rect x="186.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="189.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="192.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="196.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="199.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="203.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="206.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="209.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="213.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="216.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="220.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="223.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="226.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="230.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="233.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="237.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="240.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="243.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="247.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="250.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="254.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="257.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="260.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="264.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="267.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="271.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="274.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="277.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="281.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="284.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="288.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="291.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="294.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="298.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="301.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="305.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="308.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="311.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="315.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="318.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="322.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="325.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="328.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="332.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="335.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="339.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="342.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="345.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="349.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="352.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="356.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="359.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="362.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="366.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="369.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="373.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="376.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="379.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="383.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="386.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="390.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="393.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="396.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="400.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="403.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="407.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="410.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="413.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="417.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="420.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="424.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="427.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="430.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="434.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="437.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="441.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="444.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="447.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="451.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="454.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="458.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="461.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="464.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="468.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="471.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="475.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="478.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="481.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="485.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="488.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="492.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="495.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="498.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="502.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="505.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="509.0" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="512.4" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="515.8" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="519.2" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<rect x="522.6" y="246.9" width="2.4" height="3.1" fill="var(--teal)"/>
<text class="small mid" x="356" y="232">每种 0.7%</text>
<text class="mid" x="356" y="266">100 种坐标写法</text>
<text class="small mid" x="356" y="284">“在”，但票分散了</text>
<rect x="550.0" y="40.0" width="44" height="210.0" rx="2" fill="var(--teal-wash)" stroke="var(--teal)" stroke-dasharray="3 3"/>
<text class="mid b" x="572" y="28">70%</text>
<text class="small mid" x="572" y="266">合计</text>
<line x1="12" y1="250" x2="692" y2="250" stroke="var(--line)"/>
<g class="node clay"><rect x="24" y="300" width="656" height="36" rx="4"/></g>
<text class="b" x="36" y="318">规则 A · 挑单个概率最高的答案（MAP）</text>
<text class="small end" x="668" y="318">none 30% 胜过每一种 0.7% 的写法 → 说“不在”</text>
<g class="node teal"><rect x="24" y="344" width="656" height="36" rx="4"/></g>
<text class="b" x="36" y="362">规则 B · 先看“在”的总概率（阈值 0.5）</text>
<text class="small end" x="668" y="362">在 70% &gt; 不在 30% → 说“在”，再给出框</text>
</svg>
<svg viewBox="0 0 340 460">
<rect class="panel" x="0" y="0" width="340" height="460" rx="12"/>
<text class="small b" x="16" y="30">一个问题的全部答案，按概率</text>
<rect x="40" y="160.0" width="44" height="90.0" rx="2" fill="var(--clay)"/>
<text class="mid b" x="62" y="148">30%</text>
<text class="mid mono" x="62" y="266">none</text>
<text class="small mid" x="62" y="284">“不在”</text>
<rect x="118.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="119.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="121.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="123.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="124.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="126.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="128.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="129.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="131.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="133.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="135.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="136.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="138.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="140.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="141.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="143.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="145.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="146.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="148.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="150.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="152.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="153.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="155.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="157.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="158.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="160.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="162.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="163.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="165.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="167.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="169.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="170.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="172.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="174.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="175.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="177.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="179.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="180.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="182.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="184.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="186.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="187.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="189.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="191.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="192.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="194.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="196.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="197.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="199.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="201.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="203.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="204.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="206.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="208.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="209.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="211.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="213.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="214.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="216.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="218.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="220.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="221.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="223.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="225.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="226.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="228.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="230.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="231.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="233.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="235.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="237.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="238.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="240.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="242.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="243.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="245.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="247.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="248.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="250.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="252.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="254.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="255.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="257.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="259.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="260.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="262.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="264.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="265.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="267.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="269.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="271.0" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="272.7" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="274.4" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="276.1" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="277.8" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="279.5" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="281.2" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="282.9" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="284.6" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<rect x="286.3" y="246.9" width="1.1" height="3.1" fill="var(--teal)"/>
<text class="small mid" x="203" y="232">每种 0.7%</text>
<text class="mid" x="203" y="266">100 种坐标写法</text>
<text class="small mid" x="203" y="284">“在”，但票分散了</text>
<rect x="298.0" y="40.0" width="30" height="210.0" rx="2" fill="var(--teal-wash)" stroke="var(--teal)" stroke-dasharray="3 3"/>
<text class="mid b" x="313" y="28">70%</text>
<text class="small mid" x="313" y="266">合计</text>
<line x1="12" y1="250" x2="328" y2="250" stroke="var(--line)"/>
<g class="node clay"><rect x="16" y="304" width="308" height="56" rx="4"/></g>
<text class="b" x="28" y="322">规则 A · 挑单个概率最高的答案（MAP）</text>
<text class="small" x="28" y="344">none 30% 胜过每一种 0.7% 的写法 → 说“不在”</text>
<g class="node teal"><rect x="16" y="374" width="308" height="56" rx="4"/></g>
<text class="b" x="28" y="392">规则 B · 先看“在”的总概率（阈值 0.5）</text>
<text class="small" x="28" y="414">在 70% &gt; 不在 30% → 说“在”，再给出框</text>
</svg>
```

这个解释给出一个可以检验的预测：坐标写法把票分得越散，规则 A 越爱说“不在”；规则 B 不受影响。

### 受控实验：只换输出头

为了检验，我们做了一组受控实验：**同一个 4B 底座、同样的 LoRA、同样的数据和顺序、同样 3,058 步，只换输出头**。

- **门控**：上面的框头，P(present) 是一个数。
- **数字**：生成 `x1,y1,x2,y2`，0–1000，每位数字一个 token；不在就生成 `none`。
- **层级**：每个坐标两个新 token，先粗后细，共 32×32 = 1,024 级[@song2025]。
- **原子 100 / 原子 1000**：每个坐标值一个新 token，100 级或 1,000 级。

下面这张图，横轴是目标明明在、模型却说“不在”的比例（RefCOCO val，10,834 个表达式），纵轴是目标真的不在时说对“不在”的比例（gRefCOCO val 的无目标表达式，8,905 个）。每条曲线是一个头在自己的“不在”概率上取遍所有阈值：门控用 1 − P(present)，生成式头用 P(none)。曲线上的点，是某个解码规则落在哪里。选一个头、一个规则，看看会发生什么：

```widget src="../widgets/glance/dial.js" title="同一个数字头，只换解码规则：拒答率从 0.4% 到约 40%" note="单个 seed。"
../images/glance/w-dial.png | 静态图：五个输出头的曲线几乎重合；同一个数字头，阈值 0.5 下把 0.4% 的在场目标说成“不在”，挑整串概率最高的答案时约 40%
../images/glance/w-dial-n.png | 同上，手机版
```

**生成式头其实知道东西在不在。** 五条曲线几乎重合：把阈值调到恰好拒答 1% 的在场目标时，四种坐标写法的头都能拒掉 81–82% 的无目标表达式，门控是 81.3%；AUROC 都在 96.2–96.7 之间。门控在“不在”上并没有赢。

**说不说出来，是计票方式决定的。** 在 RefCOCO 的 21,586 个在场目标上，数字头按 P(none) ≥ 0.5 只把 0.47% 说成“不在”，贪心解码是 0.60%。上图的规则 A 用的是近似：拿贪心解出的那串坐标和 `none` 比整串概率。为了确认它没有夸大，我们在抽样的一批目标上用精确的最优优先搜索去找概率最高的整串答案，数字头是 34–41%（有一部分题在搜索预算内没有定论，所以是区间），和近似值几乎一致。四种写法排成一列：

```data title="同一批在场目标，被说成“不在”的比例（%）" bars="精确 MAP" mark="数字" note="抽样子集；beam：宽度 4，把 none 留作候选。"
输出头 | 精确 MAP | beam | 贪心 | 阈值
数字 | 34–41 | 39.2 | 0.6 | 0.4
层级 | 23–25 | 22.6 | 0.7 | 0.4
原子 1000 | 12.3 | 10.4 | 1.9 | 0.6
原子 100 | 4.6 | 3.9 | 0.8 | 0.4
```

阈值和贪心几乎不随写法变（都在 2% 以下）；规则 A 从原子 100 的 4.6% 一路涨到数字头的 34–41%，跟着“最可能的那一串坐标能拿到多少概率”走：一个框要写的 token 越多、每一步越拿不准，单串的概率就越小，`none` 越容易赢。被规则 A 说成“不在”的在场目标，其实大多知道在哪：数字头贪心解出的框，88% 是对的。

甚至不用换词表，换一种 beam search 就够了。我们第一次用标准实现跑宽度为 4 的 beam search，在一批 191 个目标上只有 4.7% 被说成“不在”。后来发现，是 `none` 在第一步就排不进前几名、被直接剪掉了（宽度 4 时，72% 的在场目标上 `none` 落在第一步的候选之外）。把 `none` 当成一个随时可以结束的完整候选留下来，宽度从 4 到 16 都回到 38–39%，和精确搜索一致；而 Hugging Face 默认的长度归一化（按长度平均对数概率），又把它压回 1–3%。三个都叫 beam search，答案差了 40 倍。这就是表面形式竞争[@holtzman2021]，只不过它决定的是一个 agent 会不会把在场的按钮当成不存在。

原子 1000 还有一个更隐蔽的版本：表面形式竞争也发生在**框的内部**。一个坐标值被摊在 1,000 个相邻的 token 上，在场目标的第一个 token 上，除 `none` 以外最可能的那个只拿到平均 0.19 的概率（数字头是 0.78），于是不加约束地贪心解码时，24.2% 的输出连格式都不对，RefCOCO 只有 73.1；用语法约束把每一步限制在合法 token 上，同一个模型回到 93.8。

### 不重新训练，只把坐标切碎

最干净的检验，是一个模型都不动。拿训练好的原子 100 头，把每个坐标 token 拆成 k 个等价的“同义写法”，每个分到原来 1/k 的概率。模型认为“在”还是“不在”的总概率一分没变，变的只是票被分成了几份。

```echarts title="同一个模型，把每个坐标拆成 k 份：MAP 的拒答从 4.6% 涨到 29.4%，阈值不动" note="原子 100 头，RefCOCO val 抽样 1,362 个在场目标，精确 MAP。" height="280"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "grid": {"left": 52, "right": 120, "top": 24, "bottom": 44}, "xAxis": {"type": "category", "data": ["1", "2", "4", "10"], "name": "每个坐标拆成几份（k）", "nameLocation": "middle", "nameGap": 28}, "yAxis": {"type": "value", "max": 35, "axisLabel": {"formatter": "{value}%"}}, "series": [{"name": "规则 A（MAP）", "type": "line", "showSymbol": true, "symbolSize": 8, "itemStyle": {"color": "var(--clay)"}, "lineStyle": {"width": 2.5}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}", "offset": [6, 0]}, "data": [4.6, 10.7, 18.1, 29.4]}, {"name": "阈值 0.5", "type": "line", "showSymbol": true, "symbolSize": 6, "itemStyle": {"color": "var(--stone)"}, "label": {"show": false, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%"}, "endLabel": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "formatter": "{a}", "offset": [6, 0]}, "data": [0.7, 0.7, 0.7, {"value": 0.7, "label": {"show": true}}]}]}
```

k 从 1 到 10，规则 A 的拒答从 4.6% 涨到 29.4%，涨了 6 倍；阈值规则一直是 0.7%。同时，无目标表达式上说对“不在”的比例也从 85.4% 涨到 96.6%：规则 A 不是变“准”了，只是整体往“不在”那边挪了。

### 在现成的模型上：幻觉是一个设置

受控实验是为了看清机制，四种坐标写法是我们自己造的。现成的 VLM 上是什么样子？我们拿四个常用的开源模型（Qwen3.5-4B、Qwen3-VL-4B、Qwen2.5-VL-7B、InternVL3.5-8B），在 1,993 个问题上（RefCOCO val 的 1,000 个在场目标，gRefCOCO val 的 993 个无目标表达式）换着设置跑：三种都明确允许说“没有”的提示词（不在就答 `none`；JSON 里填 `null`；点坐标答 `[-1, -1]`），三种坐标格式（0–1000 整数、0–1 小数、像素），六种解码方式：贪心（vLLM 和 Hugging Face 各一种，最多差 1.3 个点）、采样、beam、按长度归一的 beam、思考模式（Qwen2.5-VL-7B 和 InternVL3.5-8B 只跑了贪心和采样）。0–1 小数的格式几乎全部输出不合规，没有画。下图是剩下 49 个输出合规的设置，每个点是一个设置：

```echarts title="同样的 1,993 个问题，49 种设置：不在的东西被画上框的比例从 17% 到 92%" note="每个点是一个模型 × 提示词 × 坐标格式 × 解码器，误拒为 0 的画在 0.1%；Glance 的线是同一批题上的全部阈值。Glance 训练时见过 gRefCOCO train 的无目标表达式，其他模型没有。" height="420"
{"tooltip": {"trigger": "item", "formatter": "{a}<br/>{b}：{c}"}, "legend": {"data": ["Glance", "Qwen3.5-4B", "Qwen3-VL-4B", "Qwen2.5-VL-7B", "InternVL3.5-8B"]}, "grid": {"left": 56, "right": 20, "top": 64, "bottom": 48}, "xAxis": {"type": "log", "min": 0.1, "max": 60, "name": "在场的目标被说成“不在”（对数轴）", "nameLocation": "middle", "nameGap": 28, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "value", "min": 0, "max": 100, "name": "不在的目标被画了框", "nameLocation": "middle", "nameGap": 40, "axisLabel": {"formatter": "{value}%"}}, "series": [{"name": "Qwen3.5-4B", "type": "scatter", "symbolSize": 8, "itemStyle": {"color": "var(--sky)", "opacity": 0.85}, "data": [{"name": "JSON · 0–1000 · beam-4", "value": [4.7, 30.1]}, {"name": "JSON · 0–1000 · beam-4 长度归一", "value": [0.1, 76.8]}, {"name": "JSON · 0–1000 · 贪心", "value": [0.1, 84.1]}, {"name": "JSON · 0–1000 · HF 贪心", "value": [0.1, 82.8]}, {"name": "JSON · 0–1000 · 采样", "value": [0.1, 82.6]}, {"name": "说 none · 0–1000 · beam-4", "value": [2.2, 26.6]}, {"name": "说 none · 0–1000 · beam-4 长度归一", "value": [2.1, 28.2]}, {"name": "说 none · 0–1000 · 贪心", "value": [0.8, 37.7]}, {"name": "说 none · 0–1000 · HF 贪心", "value": [0.8, 37.0]}, {"name": "说 none · 0–1000 · 采样", "value": [1.1, 36.7]}, {"name": "说 none · 0–1000 · 思考模式", "value": [1.1, 41.1]}, {"name": "点 [-1,-1] · 0–1000 · beam-4", "value": [0.6, 41.4]}, {"name": "点 [-1,-1] · 0–1000 · beam-4 长度归一", "value": [0.6, 41.4]}, {"name": "点 [-1,-1] · 0–1000 · 贪心", "value": [0.1, 65.4]}, {"name": "点 [-1,-1] · 0–1000 · HF 贪心", "value": [0.1, 65.5]}, {"name": "点 [-1,-1] · 0–1000 · 采样", "value": [0.1, 65.4]}, {"name": "点 [-1,-1] · 0–1000 · 思考模式", "value": [0.8, 56.9]}]}, {"name": "Qwen3-VL-4B", "type": "scatter", "symbolSize": 8, "itemStyle": {"color": "var(--olive)", "opacity": 0.85}, "data": [{"name": "JSON · 0–1000 · beam-4", "value": [0.1, 77.2]}, {"name": "JSON · 0–1000 · beam-4 长度归一", "value": [0.1, 83.5]}, {"name": "JSON · 0–1000 · 贪心", "value": [0.1, 86.5]}, {"name": "JSON · 0–1000 · HF 贪心", "value": [0.1, 86.6]}, {"name": "JSON · 0–1000 · 采样", "value": [0.1, 86.8]}, {"name": "说 none · 0–1000 · beam-4", "value": [1.6, 34.2]}, {"name": "说 none · 0–1000 · beam-4 长度归一", "value": [0.4, 57.1]}, {"name": "说 none · 0–1000 · 贪心", "value": [0.4, 58.0]}, {"name": "说 none · 0–1000 · HF 贪心", "value": [0.4, 58.3]}, {"name": "说 none · 0–1000 · 采样", "value": [0.5, 56.1]}, {"name": "点 [-1,-1] · 0–1000 · beam-4", "value": [2.1, 48.4]}, {"name": "点 [-1,-1] · 0–1000 · beam-4 长度归一", "value": [2.1, 48.4]}, {"name": "点 [-1,-1] · 0–1000 · 贪心", "value": [0.1, 85.1]}, {"name": "点 [-1,-1] · 0–1000 · HF 贪心", "value": [0.1, 85.2]}, {"name": "点 [-1,-1] · 0–1000 · 采样", "value": [0.1, 81.0]}]}, {"name": "Qwen2.5-VL-7B", "type": "scatter", "symbolSize": 8, "itemStyle": {"color": "var(--kraft)", "opacity": 0.85}, "data": [{"name": "JSON · 0–1000 · 贪心", "value": [0.1, 91.6]}, {"name": "JSON · 0–1000 · 采样", "value": [0.1, 92.2]}, {"name": "JSON · 像素 · 贪心", "value": [0.7, 84.3]}, {"name": "JSON · 像素 · 采样", "value": [0.9, 85.3]}, {"name": "说 none · 0–1000 · 贪心", "value": [0.6, 78.7]}, {"name": "说 none · 0–1000 · 采样", "value": [0.4, 79.4]}, {"name": "说 none · 像素 · 贪心", "value": [0.6, 87.8]}, {"name": "说 none · 像素 · 采样", "value": [0.8, 88.0]}, {"name": "点 [-1,-1] · 0–1000 · 贪心", "value": [4.2, 34.3]}, {"name": "点 [-1,-1] · 0–1000 · 采样", "value": [4.2, 32.4]}, {"name": "点 [-1,-1] · 像素 · 贪心", "value": [4.2, 34.7]}, {"name": "点 [-1,-1] · 像素 · 采样", "value": [4.1, 33.5]}]}, {"name": "InternVL3.5-8B", "type": "scatter", "symbolSize": 8, "itemStyle": {"color": "var(--fig)", "opacity": 0.85}, "data": [{"name": "JSON · 0–1000 · 贪心", "value": [1.2, 41.7]}, {"name": "JSON · 0–1000 · 采样", "value": [2.8, 38.4]}, {"name": "说 none · 0–1000 · 贪心", "value": [10.7, 27.7]}, {"name": "点 [-1,-1] · 0–1000 · 贪心", "value": [21.4, 18.7]}, {"name": "点 [-1,-1] · 0–1000 · 采样", "value": [48.0, 16.9]}]}, {"name": "Glance", "type": "line", "showSymbol": false, "smooth": false, "itemStyle": {"color": "var(--clay)"}, "lineStyle": {"width": 2.5}, "data": [[0.1, 31.32], [0.2, 30.92], [0.2, 30.41], [0.2, 29.91], [0.2, 29.41], [0.2, 28.9], [0.2, 28.4], [0.4, 28.1], [0.4, 27.59], [0.4, 27.09], [0.5, 26.69], [0.5, 26.18], [0.5, 25.68], [0.6, 25.28], [0.6, 24.87], [0.6, 24.37], [0.7, 23.97], [0.7, 23.46], [0.7, 22.96], [0.8, 22.56], [0.8, 22.05], [0.8, 21.55], [0.8, 21.05], [0.8, 20.54], [0.8, 20.04], [0.8, 19.54], [0.8, 19.03], [0.8, 18.53], [1.0, 18.23], [1.2, 17.93], [1.2, 17.42], [1.3, 17.02], [1.3, 16.52], [1.3, 16.01], [1.4, 15.61], [1.4, 15.11], [1.5, 14.7], [1.6, 14.3], [1.7, 13.9], [1.7, 13.39], [1.8, 12.99], [1.9, 12.59], [1.9, 12.08], [2.2, 11.88], [2.3, 11.48], [2.4, 11.08], [2.5, 10.67], [2.5, 10.17], [2.5, 9.67], [2.5, 9.16], [2.6, 8.76], [2.8, 8.46], [2.8, 7.96], [2.9, 7.55], [3.0, 7.15], [3.3, 6.95], [3.6, 6.75], [3.8, 6.45], [3.9, 6.04], [4.3, 5.94], [4.6, 5.74], [4.8, 5.44], [5.0, 5.14], [5.1, 4.73], [5.3, 4.53], [5.6, 4.33], [5.8, 4.03], [6.6, 3.83], [7.0, 3.73], [7.4, 3.63], [7.7, 3.42], [8.1, 3.32], [8.5, 3.22], [8.9, 3.12], [9.2, 2.92], [9.5, 2.72], [9.9, 2.62], [10.3, 2.52], [11.2, 2.42], [12.6, 2.32], [13.0, 2.22], [13.4, 2.11], [14.3, 2.01], [15.2, 1.91], [18.1, 1.81], [19.0, 1.71], [19.3, 1.51], [20.7, 1.41], [22.1, 1.31], [28.9, 1.21], [29.8, 1.11], [30.7, 1.01], [33.1, 0.91], [33.5, 0.81], [42.4, 0.7], [52.7, 0.6], [59.1, 0.5]], "endLabel": {"show": false}}]}
```

三个 Qwen 模型的点几乎都是上下散开的：在场的目标几乎没人拒（都在 5% 以内，InternVL 是例外），差别全在“不在的东西被画上框”。49 个设置里，这个比例从 16.9% 到 92.2%，同一个 Qwen 模型内部就差 50–60 个点。两个例子：Qwen3-VL-4B 贪心解码，提示词说“不在就答 none”时画框 58.0%，换成点坐标 85.1%，换成 JSON 86.5%；Qwen3.5-4B 用 JSON 提示词，贪心解码画框 84.1%，beam-4 降到 30.1%（代价是在场目标的误拒从 0 升到 4.7%）。

解码器那一半，就是上面那场选举：beam 搜的是整串概率最高的答案，把 Qwen3.5-4B 的画框从 84% 压到 30%。提示词那一半是另一件事：它改变的是模型在决策那一步把多少概率给“不在”。Qwen3.5-4B 和 Qwen2.5-VL-7B 用 JSON 时，这一步的概率几乎不再区分在不在（见下一段）；Qwen3-VL-4B 仍分得开（AUROC 0.89–0.91），但“不在”整体拿到的概率太低，贪心照样画了 86.5% 的框。两件事都和模型“看没看见”无关。一个模型“会不会幻觉”，在这里不是它的性质，而是你选的那一档设置。

公平地说，生成式模型自己也有一个不错的旋钮，前提有两个：你拿得到决策那一步的 token 概率，并且提示词没有把它搅乱。这时读这一步“拒答”的概率当分数，三个 Qwen 模型在“不在就答 none”的提示词下 AUROC 有 0.93–0.95。可换成 JSON 提示词，Qwen3.5-4B 和 Qwen2.5-VL-7B 的这个分数只剩 0.62–0.69。Glance 在同一批题上是 0.985（它在训练时见过这类负样本）：误拒 1% 的在场目标时，它只给 18% 的不在目标画框，生成式模型最好的旋钮是 34%。所以 Glance 的优势不只在于概率更好，还在于三件事：不怕提示词怎么写，不需要读 logprob，框和概率在同一次前向里一起出来。

### 为什么要在意

- **对 agent：** 用生成式模型当眼睛时，它会不会去点一个不存在的按钮，是你的配置的性质：提示词怎么写、坐标用什么格式、beam 开多宽、要不要长度归一化。换一个提示词模板，或者推理库默认的解码参数，幻觉率可能差五六十个点，而模型一个参数都没变。拿不到 logprob 时，设置只能一档一档地换；Glance 的概率可以连续地拧，而且不挑提示词。
- **对评测：** 两个模型在“不在”类题目上比幻觉率或拒答率，如果没有把提示词、坐标格式和解码规则固定住，比的其实是设置。别人的评测里也能看到这一点：RefBench-PRO[@refbenchpro] 里，生成式模型对属性对不上的描述只拒掉 3–25%，把同样的题改成是否题问，拒答升到约 47–64%。
- **对 Glance：** 门控给出的就是一个数，阈值由用的人定。下一节讲怎么定。

## 两个旋钮，一条决策规则

受控实验里，同底座、同数据训练的生成式头在“在不在”上和门控一样准，所以门控的价值不在“看得更准”。它的价值在于把两件事都交成了校准过的概率：**在不在**，和**框准不准**。有了这两个数，就能按代价算出该不该回答。

先看第二个旋钮。框头还给出 P(IoU ≥ 0.5)，它在在场目标上分辨“框对了”和“框错了”的 AUROC 是 91.6；生成式头不管用哪种分数（整串概率、按长度归一的概率、`none` 和最佳框的差），最多 79.7。生成式模型很确定一个框“在”，却说不清这个框画得对不对。

再看规则。假设拒答一个在场目标的代价是 1，画出一个根本不存在的框也是 1，画了框但框错了是 c_W。期望代价最小的做法是：

$$
\text{回答} \iff P(\text{在}) \cdot \big[\, 2 - c_W \, (1 - P(\text{框准})) \,\big] > 1
$$

c_W 越大，“框准”的要求越高。c_W = 5 时，P(框准) 低于 0.8，再确定东西在也应该拒答；只看“在不在”的规则（下图的水平虚线）做不到这一点。

```sketch title="两个概率，一条规则：框错越贵，越要求“框准”" note="阴影是 c_W = 5 时应当回答的区域。"
<svg viewBox="0 0 704 330">
<rect class="panel" x="0" y="0" width="704" height="330" rx="12"/>
<path d="M388.0 40.0 L388.0 40.0 L389.9 49.3 L391.8 58.3 L393.7 66.7 L395.6 74.8 L397.5 82.6 L399.4 90.0 L401.3 97.1 L403.2 103.9 L405.1 110.4 L407.0 116.7 L408.9 122.7 L410.8 128.5 L412.7 134.0 L414.6 139.4 L416.5 144.5 L418.4 149.5 L420.3 154.3 L422.2 159.0 L424.1 163.4 L426.0 167.8 L427.9 172.0 L429.8 176.0 L431.7 179.9 L433.6 183.8 L435.5 187.4 L437.4 191.0 L439.3 194.5 L441.2 197.8 L443.1 201.1 L445.0 204.3 L446.9 207.4 L448.8 210.4 L450.7 213.3 L452.6 216.1 L454.5 218.9 L456.4 221.6 L458.3 224.2 L460.2 226.8 L462.1 229.2 L464.0 231.7 L464.0 40.0 Z" fill="var(--clay-wash)" stroke="none"/>
<line x1="84.0" y1="40" x2="84.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="84" y="284">0</text>
<line x1="179.0" y1="40" x2="179.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="179" y="284">0.25</text>
<line x1="274.0" y1="40" x2="274.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="274" y="284">0.5</text>
<line x1="369.0" y1="40" x2="369.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="369" y="284">0.75</text>
<line x1="464.0" y1="40" x2="464.0" y2="270" stroke="var(--grid)"/>
<text class="small mid" x="464" y="284">1</text>
<line x1="84" y1="270.0" x2="464" y2="270.0" stroke="var(--grid)"/>
<text class="small end" x="78" y="270">0.4</text>
<line x1="84" y1="193.3" x2="464" y2="193.3" stroke="var(--grid)"/>
<text class="small end" x="78" y="193.333">0.6</text>
<line x1="84" y1="116.7" x2="464" y2="116.7" stroke="var(--grid)"/>
<text class="small end" x="78" y="116.667">0.8</text>
<line x1="84" y1="40.0" x2="464" y2="40.0" stroke="var(--grid)"/>
<text class="small end" x="78" y="40">1</text>
<text class="small mid" x="274" y="304">P(框准)：P(IoU ≥ 0.5)</text>
<text class="small mid" x="54" y="155" transform="rotate(-90 54 155.0)">P(在)</text>
<line x1="84" y1="231.7" x2="464" y2="231.7" stroke="var(--muted)" stroke-dasharray="4 3"/>
<text class="small" x="92" y="243.667">只看在不在：P(在) &gt; 0.5 就回答</text>
<path d="M85.9 41.9 L87.8 43.8 L89.7 45.7 L91.6 47.5 L93.5 49.3 L95.4 51.2 L97.3 53.0 L99.2 54.7 L101.1 56.5 L103.0 58.3 L104.9 60.0 L106.8 61.7 L108.7 63.4 L110.6 65.1 L112.5 66.7 L114.4 68.4 L116.3 70.0 L118.2 71.7 L120.1 73.3 L122.0 74.8 L123.9 76.4 L125.8 78.0 L127.7 79.5 L129.6 81.1 L131.5 82.6 L133.4 84.1 L135.3 85.6 L137.2 87.1 L139.1 88.5 L141.0 90.0 L142.9 91.4 L144.8 92.9 L146.7 94.3 L148.6 95.7 L150.5 97.1 L152.4 98.5 L154.3 99.8 L156.2 101.2 L158.1 102.6 L160.0 103.9 L161.9 105.2 L163.8 106.5 L165.7 107.8 L167.6 109.1 L169.5 110.4 L171.4 111.7 L173.3 112.9 L175.2 114.2 L177.1 115.4 L179.0 116.7 L180.9 117.9 L182.8 119.1 L184.7 120.3 L186.6 121.5 L188.5 122.7 L190.4 123.9 L192.3 125.0 L194.2 126.2 L196.1 127.3 L198.0 128.5 L199.9 129.6 L201.8 130.7 L203.7 131.8 L205.6 132.9 L207.5 134.0 L209.4 135.1 L211.3 136.2 L213.2 137.3 L215.1 138.3 L217.0 139.4 L218.9 140.4 L220.8 141.5 L222.7 142.5 L224.6 143.5 L226.5 144.5 L228.4 145.6 L230.3 146.6 L232.2 147.6 L234.1 148.5 L236.0 149.5 L237.9 150.5 L239.8 151.5 L241.7 152.4 L243.6 153.4 L245.5 154.3 L247.4 155.3 L249.3 156.2 L251.2 157.1 L253.1 158.1 L255.0 159.0 L256.9 159.9 L258.8 160.8 L260.7 161.7 L262.6 162.6 L264.5 163.4 L266.4 164.3 L268.3 165.2 L270.2 166.1 L272.1 166.9 L274.0 167.8 L275.9 168.6 L277.8 169.5 L279.7 170.3 L281.6 171.1 L283.5 172.0 L285.4 172.8 L287.3 173.6 L289.2 174.4 L291.1 175.2 L293.0 176.0 L294.9 176.8 L296.8 177.6 L298.7 178.4 L300.6 179.2 L302.5 179.9 L304.4 180.7 L306.3 181.5 L308.2 182.2 L310.1 183.0 L312.0 183.8 L313.9 184.5 L315.8 185.2 L317.7 186.0 L319.6 186.7 L321.5 187.4 L323.4 188.2 L325.3 188.9 L327.2 189.6 L329.1 190.3 L331.0 191.0 L332.9 191.7 L334.8 192.4 L336.7 193.1 L338.6 193.8 L340.5 194.5 L342.4 195.2 L344.3 195.8 L346.2 196.5 L348.1 197.2 L350.0 197.8 L351.9 198.5 L353.8 199.2 L355.7 199.8 L357.6 200.5 L359.5 201.1 L361.4 201.8 L363.3 202.4 L365.2 203.0 L367.1 203.7 L369.0 204.3 L370.9 204.9 L372.8 205.5 L374.7 206.1 L376.6 206.8 L378.5 207.4 L380.4 208.0 L382.3 208.6 L384.2 209.2 L386.1 209.8 L388.0 210.4 L389.9 211.0 L391.8 211.5 L393.7 212.1 L395.6 212.7 L397.5 213.3 L399.4 213.9 L401.3 214.4 L403.2 215.0 L405.1 215.6 L407.0 216.1 L408.9 216.7 L410.8 217.2 L412.7 217.8 L414.6 218.3 L416.5 218.9 L418.4 219.4 L420.3 220.0 L422.2 220.5 L424.1 221.0 L426.0 221.6 L427.9 222.1 L429.8 222.6 L431.7 223.2 L433.6 223.7 L435.5 224.2 L437.4 224.7 L439.3 225.2 L441.2 225.7 L443.1 226.2 L445.0 226.8 L446.9 227.3 L448.8 227.8 L450.7 228.3 L452.6 228.7 L454.5 229.2 L456.4 229.7 L458.3 230.2 L460.2 230.7 L462.1 231.2 L464.0 231.7" fill="none" stroke="var(--stone)" stroke-width="1.5"/>
<text class="small" x="89.9" y="32">c_W = 1</text>
<path d="M275.9 43.8 L277.8 47.5 L279.7 51.2 L281.6 54.7 L283.5 58.3 L285.4 61.7 L287.3 65.1 L289.2 68.4 L291.1 71.7 L293.0 74.8 L294.9 78.0 L296.8 81.1 L298.7 84.1 L300.6 87.1 L302.5 90.0 L304.4 92.9 L306.3 95.7 L308.2 98.5 L310.1 101.2 L312.0 103.9 L313.9 106.5 L315.8 109.1 L317.7 111.7 L319.6 114.2 L321.5 116.7 L323.4 119.1 L325.3 121.5 L327.2 123.9 L329.1 126.2 L331.0 128.5 L332.9 130.7 L334.8 132.9 L336.7 135.1 L338.6 137.3 L340.5 139.4 L342.4 141.5 L344.3 143.5 L346.2 145.6 L348.1 147.6 L350.0 149.5 L351.9 151.5 L353.8 153.4 L355.7 155.3 L357.6 157.1 L359.5 159.0 L361.4 160.8 L363.3 162.6 L365.2 164.3 L367.1 166.1 L369.0 167.8 L370.9 169.5 L372.8 171.1 L374.7 172.8 L376.6 174.4 L378.5 176.0 L380.4 177.6 L382.3 179.2 L384.2 180.7 L386.1 182.2 L388.0 183.8 L389.9 185.2 L391.8 186.7 L393.7 188.2 L395.6 189.6 L397.5 191.0 L399.4 192.4 L401.3 193.8 L403.2 195.2 L405.1 196.5 L407.0 197.8 L408.9 199.2 L410.8 200.5 L412.7 201.8 L414.6 203.0 L416.5 204.3 L418.4 205.5 L420.3 206.8 L422.2 208.0 L424.1 209.2 L426.0 210.4 L427.9 211.5 L429.8 212.7 L431.7 213.9 L433.6 215.0 L435.5 216.1 L437.4 217.2 L439.3 218.3 L441.2 219.4 L443.1 220.5 L445.0 221.6 L446.9 222.6 L448.8 223.7 L450.7 224.7 L452.6 225.7 L454.5 226.8 L456.4 227.8 L458.3 228.7 L460.2 229.7 L462.1 230.7 L464.0 231.7" fill="none" stroke="var(--stone)" stroke-width="1.5"/>
<text class="small" x="279.9" y="32">c_W = 2</text>
<path d="M388.0 40.0 L389.9 49.3 L391.8 58.3 L393.7 66.7 L395.6 74.8 L397.5 82.6 L399.4 90.0 L401.3 97.1 L403.2 103.9 L405.1 110.4 L407.0 116.7 L408.9 122.7 L410.8 128.5 L412.7 134.0 L414.6 139.4 L416.5 144.5 L418.4 149.5 L420.3 154.3 L422.2 159.0 L424.1 163.4 L426.0 167.8 L427.9 172.0 L429.8 176.0 L431.7 179.9 L433.6 183.8 L435.5 187.4 L437.4 191.0 L439.3 194.5 L441.2 197.8 L443.1 201.1 L445.0 204.3 L446.9 207.4 L448.8 210.4 L450.7 213.3 L452.6 216.1 L454.5 218.9 L456.4 221.6 L458.3 224.2 L460.2 226.8 L462.1 229.2 L464.0 231.7" fill="none" stroke="var(--clay)" stroke-width="2"/>
<text class="small accent" x="392" y="32">c_W = 5</text>
<text class="mid b accent" x="437.4" y="86">回答</text>
<text class="mid mute" x="243.6" y="193.333">拒答</text>
<text class="small" x="484" y="62">代价：拒答一个在场目标 = 1，</text>
<text class="small" x="484" y="82">画出一个不存在的框 = 1，</text>
<text class="small" x="484" y="102">框错了 = c_W。</text>
<text class="small" x="484" y="142">回答，当且仅当</text>
<text class="small b" x="484" y="162">P(在)·[2 − c_W·(1 − P(框准))] &gt; 1</text>
<text class="small" x="484" y="202">c_W 越大，曲线越往右推：</text>
<text class="small" x="484" y="222">c_W = 5 时，P(框准) 低于 0.8，</text>
<text class="small" x="484" y="242">再确定“在”也该拒答。</text>
</svg>
<svg viewBox="0 0 340 500">
<rect class="panel" x="0" y="0" width="340" height="500" rx="12"/>
<path d="M264.0 32.0 L264.0 32.0 L265.3 40.9 L266.6 49.5 L267.9 57.6 L269.2 65.3 L270.5 72.7 L271.8 79.8 L273.1 86.6 L274.4 93.1 L275.7 99.3 L277.0 105.3 L278.3 111.1 L279.6 116.6 L280.9 121.9 L282.2 127.1 L283.5 132.0 L284.8 136.8 L286.1 141.4 L287.4 145.8 L288.7 150.1 L290.0 154.2 L291.3 158.2 L292.6 162.1 L293.9 165.9 L295.2 169.5 L296.5 173.0 L297.8 176.4 L299.1 179.8 L300.4 183.0 L301.7 186.1 L303.0 189.1 L304.3 192.1 L305.6 195.0 L306.9 197.8 L308.2 200.5 L309.5 203.1 L310.8 205.7 L312.1 208.2 L313.4 210.6 L314.7 213.0 L316.0 215.3 L316.0 32.0 Z" fill="var(--clay-wash)" stroke="none"/>
<line x1="56.0" y1="32" x2="56.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="56" y="266">0</text>
<line x1="121.0" y1="32" x2="121.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="121" y="266">0.25</text>
<line x1="186.0" y1="32" x2="186.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="186" y="266">0.5</text>
<line x1="251.0" y1="32" x2="251.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="251" y="266">0.75</text>
<line x1="316.0" y1="32" x2="316.0" y2="252" stroke="var(--grid)"/>
<text class="small mid" x="316" y="266">1</text>
<line x1="56" y1="252.0" x2="316" y2="252.0" stroke="var(--grid)"/>
<text class="small end" x="50" y="252">0.4</text>
<line x1="56" y1="178.7" x2="316" y2="178.7" stroke="var(--grid)"/>
<text class="small end" x="50" y="178.667">0.6</text>
<line x1="56" y1="105.3" x2="316" y2="105.3" stroke="var(--grid)"/>
<text class="small end" x="50" y="105.333">0.8</text>
<line x1="56" y1="32.0" x2="316" y2="32.0" stroke="var(--grid)"/>
<text class="small end" x="50" y="32">1</text>
<text class="small mid" x="186" y="286">P(框准)：P(IoU ≥ 0.5)</text>
<text class="small mid" x="30" y="142" transform="rotate(-90 30 142.0)">P(在)</text>
<line x1="56" y1="215.3" x2="316" y2="215.3" stroke="var(--muted)" stroke-dasharray="4 3"/>
<text class="small" x="64" y="227.333">只看在不在：P(在) &gt; 0.5 就回答</text>
<path d="M57.3 33.8 L58.6 35.6 L59.9 37.4 L61.2 39.2 L62.5 40.9 L63.8 42.7 L65.1 44.4 L66.4 46.1 L67.7 47.8 L69.0 49.5 L70.3 51.1 L71.6 52.8 L72.9 54.4 L74.2 56.0 L75.5 57.6 L76.8 59.2 L78.1 60.7 L79.4 62.3 L80.7 63.8 L82.0 65.3 L83.3 66.8 L84.6 68.3 L85.9 69.8 L87.2 71.3 L88.5 72.7 L89.8 74.2 L91.1 75.6 L92.4 77.0 L93.7 78.4 L95.0 79.8 L96.3 81.2 L97.6 82.6 L98.9 83.9 L100.2 85.3 L101.5 86.6 L102.8 87.9 L104.1 89.2 L105.4 90.5 L106.7 91.8 L108.0 93.1 L109.3 94.4 L110.6 95.6 L111.9 96.9 L113.2 98.1 L114.5 99.3 L115.8 100.6 L117.1 101.8 L118.4 103.0 L119.7 104.2 L121.0 105.3 L122.3 106.5 L123.6 107.7 L124.9 108.8 L126.2 110.0 L127.5 111.1 L128.8 112.2 L130.1 113.3 L131.4 114.4 L132.7 115.5 L134.0 116.6 L135.3 117.7 L136.6 118.8 L137.9 119.8 L139.2 120.9 L140.5 121.9 L141.8 123.0 L143.1 124.0 L144.4 125.0 L145.7 126.1 L147.0 127.1 L148.3 128.1 L149.6 129.1 L150.9 130.0 L152.2 131.0 L153.5 132.0 L154.8 133.0 L156.1 133.9 L157.4 134.9 L158.7 135.8 L160.0 136.8 L161.3 137.7 L162.6 138.6 L163.9 139.5 L165.2 140.5 L166.5 141.4 L167.8 142.3 L169.1 143.1 L170.4 144.0 L171.7 144.9 L173.0 145.8 L174.3 146.7 L175.6 147.5 L176.9 148.4 L178.2 149.2 L179.5 150.1 L180.8 150.9 L182.1 151.8 L183.4 152.6 L184.7 153.4 L186.0 154.2 L187.3 155.0 L188.6 155.8 L189.9 156.6 L191.2 157.4 L192.5 158.2 L193.8 159.0 L195.1 159.8 L196.4 160.6 L197.7 161.3 L199.0 162.1 L200.3 162.9 L201.6 163.6 L202.9 164.4 L204.2 165.1 L205.5 165.9 L206.8 166.6 L208.1 167.3 L209.4 168.1 L210.7 168.8 L212.0 169.5 L213.3 170.2 L214.6 170.9 L215.9 171.6 L217.2 172.3 L218.5 173.0 L219.8 173.7 L221.1 174.4 L222.4 175.1 L223.7 175.8 L225.0 176.4 L226.3 177.1 L227.6 177.8 L228.9 178.4 L230.2 179.1 L231.5 179.8 L232.8 180.4 L234.1 181.1 L235.4 181.7 L236.7 182.3 L238.0 183.0 L239.3 183.6 L240.6 184.2 L241.9 184.9 L243.2 185.5 L244.5 186.1 L245.8 186.7 L247.1 187.3 L248.4 187.9 L249.7 188.5 L251.0 189.1 L252.3 189.7 L253.6 190.3 L254.9 190.9 L256.2 191.5 L257.5 192.1 L258.8 192.7 L260.1 193.3 L261.4 193.8 L262.7 194.4 L264.0 195.0 L265.3 195.5 L266.6 196.1 L267.9 196.6 L269.2 197.2 L270.5 197.8 L271.8 198.3 L273.1 198.8 L274.4 199.4 L275.7 199.9 L277.0 200.5 L278.3 201.0 L279.6 201.5 L280.9 202.1 L282.2 202.6 L283.5 203.1 L284.8 203.6 L286.1 204.1 L287.4 204.7 L288.7 205.2 L290.0 205.7 L291.3 206.2 L292.6 206.7 L293.9 207.2 L295.2 207.7 L296.5 208.2 L297.8 208.7 L299.1 209.2 L300.4 209.7 L301.7 210.1 L303.0 210.6 L304.3 211.1 L305.6 211.6 L306.9 212.1 L308.2 212.5 L309.5 213.0 L310.8 213.5 L312.1 213.9 L313.4 214.4 L314.7 214.9 L316.0 215.3" fill="none" stroke="var(--stone)" stroke-width="1.5"/>
<text class="small" x="61.3" y="24">c_W = 1</text>
<path d="M187.3 35.6 L188.6 39.2 L189.9 42.7 L191.2 46.1 L192.5 49.5 L193.8 52.8 L195.1 56.0 L196.4 59.2 L197.7 62.3 L199.0 65.3 L200.3 68.3 L201.6 71.3 L202.9 74.2 L204.2 77.0 L205.5 79.8 L206.8 82.6 L208.1 85.3 L209.4 87.9 L210.7 90.5 L212.0 93.1 L213.3 95.6 L214.6 98.1 L215.9 100.6 L217.2 103.0 L218.5 105.3 L219.8 107.7 L221.1 110.0 L222.4 112.2 L223.7 114.4 L225.0 116.6 L226.3 118.8 L227.6 120.9 L228.9 123.0 L230.2 125.0 L231.5 127.1 L232.8 129.1 L234.1 131.0 L235.4 133.0 L236.7 134.9 L238.0 136.8 L239.3 138.6 L240.6 140.5 L241.9 142.3 L243.2 144.0 L244.5 145.8 L245.8 147.5 L247.1 149.2 L248.4 150.9 L249.7 152.6 L251.0 154.2 L252.3 155.8 L253.6 157.4 L254.9 159.0 L256.2 160.6 L257.5 162.1 L258.8 163.6 L260.1 165.1 L261.4 166.6 L262.7 168.1 L264.0 169.5 L265.3 170.9 L266.6 172.3 L267.9 173.7 L269.2 175.1 L270.5 176.4 L271.8 177.8 L273.1 179.1 L274.4 180.4 L275.7 181.7 L277.0 183.0 L278.3 184.2 L279.6 185.5 L280.9 186.7 L282.2 187.9 L283.5 189.1 L284.8 190.3 L286.1 191.5 L287.4 192.7 L288.7 193.8 L290.0 195.0 L291.3 196.1 L292.6 197.2 L293.9 198.3 L295.2 199.4 L296.5 200.5 L297.8 201.5 L299.1 202.6 L300.4 203.6 L301.7 204.7 L303.0 205.7 L304.3 206.7 L305.6 207.7 L306.9 208.7 L308.2 209.7 L309.5 210.6 L310.8 211.6 L312.1 212.5 L313.4 213.5 L314.7 214.4 L316.0 215.3" fill="none" stroke="var(--stone)" stroke-width="1.5"/>
<text class="small" x="191.3" y="24">c_W = 2</text>
<path d="M264.0 32.0 L265.3 40.9 L266.6 49.5 L267.9 57.6 L269.2 65.3 L270.5 72.7 L271.8 79.8 L273.1 86.6 L274.4 93.1 L275.7 99.3 L277.0 105.3 L278.3 111.1 L279.6 116.6 L280.9 121.9 L282.2 127.1 L283.5 132.0 L284.8 136.8 L286.1 141.4 L287.4 145.8 L288.7 150.1 L290.0 154.2 L291.3 158.2 L292.6 162.1 L293.9 165.9 L295.2 169.5 L296.5 173.0 L297.8 176.4 L299.1 179.8 L300.4 183.0 L301.7 186.1 L303.0 189.1 L304.3 192.1 L305.6 195.0 L306.9 197.8 L308.2 200.5 L309.5 203.1 L310.8 205.7 L312.1 208.2 L313.4 210.6 L314.7 213.0 L316.0 215.3" fill="none" stroke="var(--clay)" stroke-width="2"/>
<text class="small accent" x="268" y="24">c_W = 5</text>
<text class="mid b accent" x="297.8" y="76">回答</text>
<text class="mid mute" x="165.2" y="178.667">拒答</text>
<text class="small" x="16" y="334">代价：拒答在场目标 = 1，</text>
<text class="small" x="16" y="356">画出不存在的框 = 1，框错 = c_W。</text>
<text class="small" x="16" y="378">回答，当且仅当</text>
<text class="small b" x="16" y="400">P(在)·[2 − c_W·(1 − P(框准))] &gt; 1</text>
<text class="small" x="16" y="422">c_W = 5 时，P(框准) 低于 0.8</text>
<text class="small" x="16" y="444">就该拒答，不管多确定“在”。</text>
</svg>
```

在受控实验的模型上（gRefCOCO val 加 RefCOCO val，45% 的表达式“不在”），Glance 和数字头用同样的方法校准、套同一条规则，不在评测集上调任何阈值：

```echarts title="每题的期望代价：框错越贵，第二个旋钮省得越多" note="代价 ×100，拒答和幻觉的代价都是 1；受控实验的门控模型和数字头，同样校准。" height="300"
{"tooltip": {"trigger": "axis"}, "grid": {"left": 44, "right": 132, "top": 20, "bottom": 44}, "xAxis": {"type": "value", "min": 0, "max": 5, "interval": 1, "name": "框错一次的代价 c_W", "nameLocation": "middle", "nameGap": 28}, "yAxis": {"type": "value", "min": 6, "max": 20}, "series": [{"name": "两个旋钮", "type": "line", "showSymbol": true, "symbolSize": 7, "itemStyle": {"color": "var(--clay)"}, "lineStyle": {"width": 2.5}, "endLabel": {"show": true, "formatter": "{a} {@[1]}", "color": "var(--clay)", "textBorderColor": "transparent"}, "data": [[0, 7.06], [1, 9.16], [2, 10.75], [5, 14.06]]}, {"name": "只看在不在", "type": "line", "showSymbol": true, "symbolSize": 6, "itemStyle": {"color": "var(--stone)"}, "endLabel": {"show": true, "formatter": "{a} {@[1]}", "color": "var(--muted)", "textBorderColor": "transparent", "offset": [0, 8]}, "data": [[0, 7.06], [1, 9.32], [2, 11.59], [5, 18.38]]}, {"name": "生成式", "type": "line", "showSymbol": true, "symbolSize": 6, "itemStyle": {"color": "var(--sky)"}, "lineStyle": {"type": "dashed"}, "endLabel": {"show": true, "formatter": "{a} {@[1]}", "color": "var(--sky)", "textBorderColor": "transparent", "offset": [0, -8]}, "data": [[0, 6.95], [1, 9.52], [2, 12.0], [5, 18.74]]}]}
```

框错不要钱的时候（c_W = 0），三者打平，生成式头还略好一点（6.95 对 7.06，置信区间包含 0）。框错的代价越高，第二个旋钮省得越多：c_W = 5 时，Glance 每题的期望代价是 14.06，只看“在不在”是 18.38，少付 24%；同样校准过、同样用两个分数的生成式头是 18.74，少付 25%。生成式头的第二个分数几乎帮不上忙（18.74 对只用一个分数的 19.51），因为它的“框准不准”本来就分不清。换一个更接近训练分布的场景（25% 的问题“不在”），阈值在训练分布的校准集上调，两个旋钮相对只看“在不在”在 c_W = 1、2、5 时少付 4%、13%、33%。

### 让概率说实话：一个不用训练的修补

两个旋钮要直接当阈值用，概率得是准的。v1 出厂时，框置信度在 RefCOCO 系列 8 个划分上的 ECE 是 1.8–5.0%。一个原因是先验变了：训练时自然图像的问题里近三成“不在”，RefCOCO 里一个都没有，模型总是把“不在”估得偏多。

修补不需要重训。先用训练分布里留出的数据做 Platt 缩放；再用 EM，从没有标注的模型输出里估计部署时“在”的比例（RefCOCO 上估出 0.999），按它把 logit 平移回来。8 个划分上的 ECE 都降到 0.6–1.6%。gRefCOCO val 本来就有三分之一以上的表达式“不在”，先验离训练时不远，收获小一些（3.8% → 3.2%）。

### 把概率变成保证

校准好的分数可以变成一个带统计保证的开关：在一半图上定阈值，保证在另一半图上，回答了的题里错答率不超过 5%（置信度 90%）。能回答多少题，叫覆盖率。错答包括框了不存在的东西、框错和点错。只用 P(在) 当分数，和乘上 P(框准) 之后比：

```echarts title="错答率不超过 5% 时，能回答多少题" note="v1；在一半图上校准阈值，另一半图上统计，重复多次取平均；名义置信度 90%。" height="250"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "legend": {"data": ["只用 P(在)", "P(在) × P(框准)"]}, "grid": {"left": 108, "right": 52, "top": 36, "bottom": 28}, "xAxis": {"type": "value", "max": 100, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "inverse": true, "axisTick": {"show": false}, "data": ["RefCOCO val", "gRefCOCO val", "ScreenSpot-v2"]}, "series": [{"name": "只用 P(在)", "type": "bar", "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "right", "formatter": "{c}%", "fontSize": 10}, "data": [83.4, 0.2, 4.0]}, {"name": "P(在) × P(框准)", "type": "bar", "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "right", "formatter": "{c}%"}, "data": [93.8, 39.5, 50.4]}]}
```

在 gRefCOCO 和 ScreenSpot-v2 上，只靠“在不在”几乎认证不出能放心回答的题：框错的那部分错误，P(在) 看不见。加上第二个旋钮，同样 5% 的错答率下能回答四成到五成（更难的 gRefCOCO testB 上仍认证不出）。在 VenusBench 这样的难 GUI 集上，两种分数都还认证不出任何覆盖率，GUI 上的“不在”还不够准，后面会讲。

## 意外二：让“不在”可信的，是数据，不是规模

上面的受控实验还给了一个顺带的结论：**幻觉主要由训练数据里负样本的比例决定，和输出头关系不大。** 把训练时“不在”的问题从 25% 降到 5%，三种读法在无目标表达式上画出框的比例都升了 11 个点左右，门控也一样。

```echarts title="负样本从 25% 减到 5%，三种读法都多了约 11 个点的幻觉" height="250" note="空心点：5% 的模型按训练先验平移 logit 之后。"
{"tooltip": {"trigger": "item"}, "legend": {"data": ["负样本 25%", "负样本 5%", "5% + 先验修正"]}, "grid": {"left": 64, "right": 44, "top": 40, "bottom": 40}, "xAxis": {"type": "value", "min": 15, "max": 40, "name": "无目标表达式上画了框", "nameLocation": "middle", "nameGap": 26, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "data": ["门控", "数字·阈值", "数字·贪心"], "inverse": true, "axisTick": {"show": false}}, "series": [{"type": "bar", "stack": "d", "silent": true, "itemStyle": {"color": "transparent"}, "data": [24.3, 24.2, 22.0], "tooltip": {"show": false}}, {"type": "bar", "stack": "d", "silent": true, "barWidth": 3, "itemStyle": {"color": "var(--line)"}, "data": [11.4, 10.8, 10.8], "tooltip": {"show": false}}, {"name": "负样本 25%", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--stone)"}, "z": 3, "label": {"show": true, "position": "top", "distance": 6, "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [["24.3", 0], ["24.2", 1], ["22.0", 2]], "tooltip": {"formatter": "{a}：{@[0]}%"}}, {"name": "负样本 5%", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--clay)"}, "z": 4, "label": {"show": true, "position": "right", "formatter": "{@[0]}%", "color": "var(--ink)", "textBorderColor": "transparent"}, "data": [["35.7", 0], ["35.0", 1], ["32.8", 2]], "tooltip": {"formatter": "{a}：{@[0]}%"}}, {"name": "5% + 先验修正", "type": "scatter", "symbolSize": 10, "itemStyle": {"color": "var(--paper)", "borderColor": "var(--clay)", "borderWidth": 2}, "z": 5, "label": {"show": true, "position": "bottom", "distance": 6, "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [["27.3", 0], ["24.6", 1]], "tooltip": {"formatter": "{a}：{@[0]}%"}}]}
```

先验变了，可以事后平移 logit 修正（图里的空心点）：门控从 35.7% 修到 27.3%，数字头用 P(none) 的阈值做同样的修正是 24.6%，门控并没有更好；贪心解码没有阈值可平移。这把我们推回到了数据。

第一版（v0）只在 COCO 系列上训练：RefCOCO、RefCOCO+、RefCOCOg，gRefCOCO[@grefcoco] 里的无目标表达式，再从别的图里借来一些描述当负样本。24,462 张图、355,385 个问题。框很准，8 个 RefCOCO 评测集平均 Acc@0.5 是 92.8。可它对真正难的负样本过于自信：gRefCOCO 的无目标表达式是“图里有狗，但没有‘左边那只白狗’”这种，v0 能说对“不在”的只有 77.0%。

同样的数据换到 Qwen3.8-27B 上再训一遍，框更准了（平均 94.1），“不在”几乎没动。让它动起来的是 v1 换的数据：加入 GUI 截图、PixMo 的指点和计数，并刻意构造**难负样本**，也就是同一张图里存在、但不符合描述的东西（GUI 里是同一类软件里、这一屏上没有的按钮名字）。

```data title="加了难负样本，“不在”才变得可信" bars="N-acc" mark="v1 4B"
模型 | N-acc | AUROC | ECE
v0 4B | 77.0 | 0.964 | 0.075
v0 27B | 77.5 | 0.968 | 0.074
v1 4B | 87.4 | 0.979 | 0.024
```

N-acc 是 gRefCOCO val 无目标表达式上说对“不在”的比例；AUROC 和 ECE 衡量存在门控，算在 gRefCOCO val 加 RefCOCO val 共 25,063 个表达式上。27B 换的是 Qwen3.8-27B，规模和底座版本是同时变的。

GUI 上也是同一个故事。v0 在 COCO 上训完，拿去测 ScreenSpot-v2[@screenspotv2] 只有 28.6，生成式底座是 93.4。一开始我们怀疑是分辨率：v0 最多用 640 个视觉 token。可在 ScreenSpot-Pro[@screenspotpro] 上把 v0 的视觉 token 提到 4,000，它也只从 0.9% 升到 1.8%。新加的头只见过自然图像里的物体，分辨率不是主因。v1 加了 GUI 截图之后，ScreenSpot-v2 回到 89.4。

### 我们不小心教会了它一条捷径

v1 在标准评测上很好看，问题出在人换一种说法的时候。我们给验证集里的每个目标写了好几种说法：原句、中文、改写、只说用途（“能盛热饮的东西”）、只说上位词（“那个电器”），每种说法都配一个核实过“不在”的版本。原句、中文和改写都没问题；只说用途和只说上位词时，v1 把 19% 的在场目标说成“不在”，生成式底座只有 3–8%。在另一套独立写的说法上，靠关系来描述的模糊说法（“桌子旁边那个”）被误判的更多，达到 40%。

原因在 v1 的负样本里。“简单负样本”是从别的图借来的描述，借的条件是它的类别不在这张图里；难负样本多是同一个类别改了颜色。两种负样本都只差一个词：一个类别名，或者一个颜色词。模型学到的是一条捷径：句子里只要有一个关键词在画面上找不到对应，就说不在。一句不提类别名的话，在它看来恰好有一处对不上：找不到那个名词。

```sketch title="我们给模型的“不在”，靠一个对不上的词就能认出来" note="例子取自 v1 的两种负样本。"
<svg viewBox="0 0 704 260">
<rect class="panel" x="0" y="0" width="704" height="260" rx="12"/>
<text class="caps" x="24" y="28">训练里的“不在”</text>
<text class="caps" x="264" y="28">它学到的规则</text>
<text class="caps" x="484" y="28">遇到没有名词的说法</text>
<g class="node plain"><rect x="24" y="48" width="200" height="34" rx="4"/><text class="mid mono" x="124" y="65">a red bicycle</text></g>
<text class="small" x="24" y="96">借自别的图：图里根本没有自行车</text>
<g class="node plain"><rect x="24" y="116" width="200" height="34" rx="4"/><text class="mid mono" x="124" y="133">the gray cat</text></g>
<text class="small" x="24" y="164">改了颜色：猫在，“灰”对不上</text>
<g class="node violet"><rect x="254" y="70" width="200" height="70" rx="4"/></g>
<text class="mid" x="354" y="92">有个词在画面里</text>
<text class="mid" x="354" y="118">找不到 ⇒ 不在</text>
<path class="edge" d="M224 65 H240 V105 H250" marker-end="url(#arrow)"/>
<path class="edge" d="M224 133 H240 V105" marker-end="url(#arrow)"/>
<g class="node plain"><rect x="484" y="48" width="196" height="34" rx="4"/><text class="mid mono" x="582" y="65">something to drink from</text></g>
<text class="small" x="484" y="96">桌上有杯子，可句子里没有“杯子”</text>
<g class="node clay"><rect x="484" y="116" width="196" height="34" rx="17"/><text class="mid" x="582" y="133">说“不在”：19%</text></g>
<path class="edge hot" d="M454 105 H470 V65 H480" marker-end="url(#arrow)"/>
<g class="node teal"><rect x="24" y="196" width="656" height="40" rx="4"/></g>
<text x="40" y="216">修复：功能说法、上位词也各配一个“不在”的版本，名词不再泄露答案</text>
</svg>
<svg viewBox="0 0 340 412">
<rect class="panel" x="0" y="0" width="340" height="412" rx="12"/>
<text class="caps" x="16" y="20">训练里的“不在”</text>
<g class="node plain"><rect x="16" y="38" width="150" height="30" rx="4"/><text class="mid mono" x="91" y="53">a red bicycle</text></g>
<g class="node plain"><rect x="174" y="38" width="150" height="30" rx="4"/><text class="mid mono" x="249" y="53">the gray cat</text></g>
<text class="small" x="16" y="82">借来的，图里没有车</text>
<text class="small" x="174" y="82">改了颜色</text>
<path class="edge" d="M170 92 V112" marker-end="url(#arrow)"/>
<text class="caps" x="16" y="130">它学到的规则</text>
<g class="node violet"><rect x="16" y="144" width="308" height="34" rx="4"/><text class="mid" x="170" y="161">有个词在画面里找不到 ⇒ 不在</text></g>
<path class="edge hot" d="M170 178 V198" marker-end="url(#arrow)"/>
<text class="caps" x="16" y="216">遇到没有名词的说法</text>
<g class="node plain"><rect x="16" y="230" width="308" height="30" rx="4"/><text class="mid mono" x="170" y="245">something to drink from</text></g>
<text class="small" x="16" y="274">桌上有杯子，可句子里没有“杯子”</text>
<g class="node clay"><rect x="16" y="290" width="308" height="30" rx="15"/><text class="mid" x="170" y="305">说“不在”：19%</text></g>
<g class="node teal"><rect x="16" y="336" width="308" height="56" rx="4"/></g>
<text x="28" y="354">修复：功能说法、上位词也各配一个</text>
<text x="28" y="376">“不在”的版本，名词不再泄露答案</text>
</svg>
```

一个旁证：同一个 v1，对核实过“不在”的用途描述，99.2% 都说对了。它不是在判断东西在不在，而是在判断句子里有没有它认识的名词。

修法就是把这条捷径堵上：训练时加入用途说法和上位词说法，**每一种都配一个核实过的“不在”的版本**，没有名词这件事就不再泄露答案；再加一个一致性损失，把同一个目标的几种说法的门控和框拉到一起。

```echarts title="只说用途、只说上位词时，在场目标框对的比例" note="Acc@0.5，P(在) ≥ 0.5 才算；“新句”只统计训练里从未出现过的原句。" height="300"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "legend": {"data": ["生成式底座", "v1", "v1 + 修复"]}, "grid": {"left": 48, "right": 12, "top": 40, "bottom": 60}, "xAxis": {"type": "category", "data": ["用途", "上位词", "用途\n新句", "上位词\n新句"], "axisLabel": {"interval": 0}}, "yAxis": {"type": "value", "max": 100, "axisLabel": {"formatter": "{value}%"}}, "series": [{"name": "生成式底座", "type": "bar", "itemStyle": {"color": "var(--sky)"}, "label": {"show": true, "color": "var(--muted)", "textBorderColor": "transparent", "position": "top", "fontSize": 9, "formatter": "{c}"}, "data": ["79.0", 53.8, 78.9, "50.0"]}, {"name": "v1", "type": "bar", "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "fontSize": 10}, "data": [59.2, 43.5, 58.4, 40.2]}, {"name": "v1 + 修复", "type": "bar", "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "fontSize": 10}, "data": [83.3, 69.8, 83.5, 62.7]}]}
```

只说用途时，框对的比例从 59.2% 升到 83.3%，被误说“不在”从 19.2% 降到 3.0%；只说上位词时从 43.5% 升到 69.8%，误说“不在”从 19.0% 降到 2.2%。同一个目标的所有说法全答对的比例，从 24.3% 升到 63.0%。修复后的模型超过了生成式底座。这不是白来的：“不在”上少了 2–4 个点（gRefCOCO 的 N-acc 从 87.3 降到 85.2），但对“不在”的用途描述仍然 98.7% 说对，而生成式底座对“不在”的描述只说对 63.5%。在训练里从没见过的句子上，提升几乎一样大。RefCOCO、GUI 和 OpenDecisions 上的成绩和对照组持平。只训输出头、冻住 LoRA，只能修回一部分（只说用途 65.0%），捷径长在底座的表示里，不只在头上。

### 一份 183 万题的体检

修好一条捷径，自然要问还有几条。组里的同学做了一份大得多的数据，Glance-Data：24,406 张 COCO 图，183 万个问题。每个答案都由规则从标注里算出来（框、数量、在不在都是精确的），大模型只负责把句子写得像人说的话；人工抽检 112 题，101 题无误。它附带一个 300 张图、23,578 题的诊断集，中英文各一半，正好给 v1 做一次全面体检：

```echarts title="v1 在 Glance-Data 诊断集上，按题型" note="英文题；“唯一物体+方位”是我们补的题（中英各 382 题）。目标在的题是 Acc@0.5（P(在) ≥ 0.5 才算）；标“不在”的是说对“不在”的比例。" height="400"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "grid": {"left": 104, "right": 44, "top": 8, "bottom": 28}, "xAxis": {"type": "value", "max": 100, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "inverse": true, "axisTick": {"show": false}, "data": ["短描述", "中等长度", "长描述", "口语", "只说类别", "只说用途", "唯一物体+方位", "不在·相近类别", "不在·方位不对", "不在·数量不对", "不在·属性不对", "不在·关系不对"]}, "series": [{"type": "bar", "barWidth": 14, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "right", "formatter": "{c}%", "fontSize": 10}, "data": [{"value": 78.2, "itemStyle": {"color": "var(--stone)"}}, {"value": 81.4, "itemStyle": {"color": "var(--stone)"}}, {"value": 81.8, "itemStyle": {"color": "var(--stone)"}}, {"value": 79.6, "itemStyle": {"color": "var(--stone)"}}, {"value": 55.2, "itemStyle": {"color": "var(--stone)"}}, {"value": 44.9, "itemStyle": {"color": "var(--clay)"}}, {"value": 24.6, "itemStyle": {"color": "var(--clay)"}}, {"value": 95.3, "itemStyle": {"color": "var(--stone)"}}, {"value": 90.7, "itemStyle": {"color": "var(--stone)"}}, {"value": 69.0, "itemStyle": {"color": "var(--stone)"}, "label": {"formatter": "69.0%"}}, {"value": 68.4, "itemStyle": {"color": "var(--stone)"}}, {"value": 40.7, "itemStyle": {"color": "var(--clay)"}}]}]}
```

人日常的说法，短的、长的、口语的，都在 78–82%。三处明显的短板：只说用途（44.9%，就是上一节那条捷径）；关系对不上的“不在”只说对 40.7%（中文 30.1%）；最奇怪的是**唯一物体加方位词**，只有 24.6%。

最后这一条，我们在 COCO 的图上单独验证过：图里只有一只猫，问“最左边的猫”，86.5% 被说成“不在”，可框其实落在那只猫上；连“左边那只猫”这种方位正确的说法，也有 64% 被拒。原因还是数据：RefCOCO 里，方位词只在有同类干扰物时才出现，于是模型学到“说了‘最左边’，就意味着不止一只”。Glance-Data 里也缺这一类题。我们用规则补了 63,190 个“唯一物体 + 方位词”的正例，和 63,198 个“方位不对”的负例按 1:1 配平，让方位词本身不再偏向任何一个答案。

## 和 Jev 1.14 实测对比

Jev 的框没有公开评测，我们就自己测了一遍：通过 OpenRouter 调 Jev 1.14，题目和 Glance 完全相同，Jev 的每个框问题都按它文档的建议并行加一个是否题。约 2.2 万个请求，没有一个失败，花了 11 美元。

| 同一批题 | Jev 1.14 | Glance v1 |
| --- | --- | --- |
| 框准不准：RefCOCO 系列 8 个划分平均 Acc@0.5 | 73.0 | **90.8** |
| 目标不在时说对“不在”（gRefCOCO，8,905 题） | 87.4 | 87.4 |
| 只误伤 1% 在场目标时，还能说对多少“不在” | 72.5 | **84.5** |
| “在不在”的概率准不准（ECE，越低越好） | 15.5 | **2.4** |
| 自己知不知道框错了（AUROC，RefCOCO val） | 75.7 | **90.1** |
| GUI 上“在不在”分得开吗（VenusBench AUROC） | **90.2** | 73.8 |
| 描述里的数量不对时，误接受的比例 | **1.3%** | 14.1% |
| 只有一个物体时，“最左边的 X”被说成不在 | **38%** | 86% |
| GUI 点击：ScreenSpot-v2 | 89.7 | 89.4 |
| 文本决策：OpenDecisions capability | **80.9** | 67.7 |
| 延迟：一张图问 1 / 8 / 32 个问题 | 180 / 212 / 380 ms | 43 / 45 / 61 ms |

在自然图像上，能说出“不在”的比例两边一样，差别在代价：要让“不在”几乎不误伤在场的东西，Jev 只剩七成，Glance 还有八成半；Jev 给的概率偏差较大（ECE 15.5），拿来设阈值前得先自己校准。框本身准了 18 个点，并且 Glance 知道自己什么时候框错了。反过来，Jev 有三处明显更强：GUI 截图上的“在不在”、描述里的数量、单个物体上的方位词，后两处正是 Glance-Data 体检出来、v1.2 在补的地方；文本决策更是它的主场。Jev 问得越多越慢，Glance 几乎不变；Jev 的延迟经 OpenRouter 的公网 API 测得，含网络开销（一个几乎空的请求就要 127 ms），Glance 是本地 GPU 上的纯前向，所以这一行只看趋势。

## 按官方协议：GREC 和 VenusBench

前面的数字多是我们自己的评测脚本。两个有官方计分规则、又专门考“不在”的基准，我们按官方协议重测了一遍。

**GREC**[@grec] 是 gRefCOCO 的检测版。规则很严：模型输出所有分数不低于 0.7 的框，一道题只有在这些框和全部目标一一对上时才算对（Pr@F1=1）；没有目标的题，一个框都不能留（N-acc）。v1 的 N-acc 在 val、testA、testB 上是 91.4、85.4、81.9。val 上这比我们查到的所有已发表结果都高；testA 和 testB 上只低于 CRS（87.3、84.0），而 CRS 的 Pr 比 Glance 低得多（val 上 56.3 对 71.6）。

```echarts title="GREC val：说对“不在”和整题答对，两头都要" note="Glance 之外的数字取自 GREC 技术报告和 RC-GRPO 论文。" height="340"
{"tooltip": {"trigger": "item", "formatter": "{b}"}, "grid": {"left": 44, "right": 24, "top": 24, "bottom": 44}, "xAxis": {"type": "value", "min": 30, "max": 100, "name": "N-acc：没有目标时一个框都不留", "nameLocation": "middle", "nameGap": 28}, "yAxis": {"type": "value", "min": 40, "max": 80, "name": "Pr@F1=1", "nameLocation": "end"}, "series": [{"type": "scatter", "data": [{"name": "Glance v1", "value": [91.4, 71.6], "symbolSize": 14, "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "position": "bottom", "formatter": "{b}", "color": "var(--ink)", "fontSize": 12, "textBorderColor": "transparent"}}, {"name": "RC-GRPO-II", "value": [85.3, 75.7], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "top", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "Qwen3-VL-4B", "value": [77.2, 72.4], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "left", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "CRS", "value": [89.5, 56.3], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "left", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "InstanceVG", "value": [72.8, 73.5], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "top", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "HieA2G", "value": [60.3, 67.8], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "top", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "Qwen3-VL-235B", "value": [65.7, 59.5], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "bottom", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "UNINEXT", "value": [50.6, 58.2], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "bottom", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}, {"name": "MDETR", "value": [36.3, 42.7], "symbolSize": 9, "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "position": "right", "formatter": "{b}", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}}]}]}
```

Glance 的 Pr（71.6）略低于最好的几个，原因很单纯：它每题只出一个框。单目标的题它对了 90.4%，多目标的题它一道也对不了，因为一个框永远凑不齐 F1 = 1。这是多框头要解决的事。

**VenusBench-GD**[@venusbench] 是一个跨手机、网页、桌面的 GUI 定位基准，其中 899 道题的目标根本不在屏幕上。按官方脚本忠实计分（说了“不在”就不再给点击），v1 的拒答题说对 81.8%，比论文表里的所有模型都高，但低于我们实测的 Jev（87.5%）；可整体分只有 40.1：

```data title="VenusBench-GD，官方脚本" mark="Glance v1"
模型 | 基础题 | 拒答题 | 整体
Glance v1 | 42.4 | 81.8 | 40.1
Glance v1.1 | 40.7 | 83.8 | 40.7
Qwen3-VL-4B | 72.5 | 31.6 | 56.2
Qwen3-VL-8B | 77.0 | 63.8 | 62.3
UI-Venus-Ground-7B | 68.7 | 0.0 | 49.0
UI-Venus-1.5-2B | 81.4 | 76.3 | 67.3
```

差距几乎都在在场题上，而且一大块是门控自己造成的：同样的点击如果不经过门控，在场题的基础分是 60.4，过了门控只剩 42.4。也就是说，在 GUI 上，Glance 太容易把在场的按钮说成“不在”。它在 GUI 上分辨“在不在”的 AUROC 是 73.8，自然图像上是 97.9。这是它眼下最大的 GUI 短板，原因和前面一样在数据：v1 的 GUI 负样本只是“同一领域里、这一屏上没有的别的按钮名字”，太容易了。

### v1.1

v1.1 用同一套方法、81 万题的训练数据，重点补 GUI：

```data title="v1 到 v1.1" mark="ScreenSpot-Pro 放大再看"
评测 | v1 | v1.1
RefCOCO 系列 8 个划分平均 | 90.8 | 92.8
gRefCOCO val N-acc | 87.4 | 86.0
ScreenSpot-v2 | 89.4 | 89.2
ScreenSpot-Pro 读一遍 | 29.3 | 46.8
ScreenSpot-Pro 放大再看 | – | 59.9
VenusBench 在场题点击（自评） | 47.3 | 55.2
VenusBench 拒答题（自评） | 81.5 | 82.2
VenusBench 整体（官方） | 40.1 | 40.7
```

框更准了，专业软件的截图好了很多。ScreenSpot-Pro 的两个数不能直接比：v1 读截图最多用 2,048 个视觉 token，v1.1 最多 4,096；“放大再看”是先框一次，再把框周围 40% 的区域重新读一遍。可 VenusBench 的官方整体分几乎没动：在场题点得更准了，门控还是把太多在场的按钮挡在外面。Glance-Data 的体检还发现，v1.1 在“数量不对”的题上倒退了（说对“不在”从 69.0% 降到 49.1%）。

### v1.2 在做什么

v1.2 要补的，正是上面体检和这一节暴露的地方。它换用转换后的 Glance-Data（189 万题，多目标的题给出每一个目标的框），加上补的方位词正例，配一个能输出多个框的头。我们给它定的目标：唯一物体加方位词被误拒的比例从 64% 降到 10% 以下，方位真的不对时误接受仍低于 5%；用途和关系说法要稳；数量对不上时要敢说“不在”。

## 拿到视频上

一个会说“不在”的框，放到视频上就是一条时间曲线：每隔几秒取一帧，问“兔子在不在”“有没有蝴蝶”，P(t) 越过阈值的地方就是它出现的时间段，连起来的段数就是次数。下面是 Big Buck Bunny 的前 8 分钟（0–476 秒），每 4 秒一帧，共 120 帧。每帧在一次前向里同时问 5 个问题，4 个框问题、1 个是否问题，图里画出 4 个框问题。“飞鼠”指片中的飞鼠 Frank，不含另外两只啮齿动物。曲线下的灰条是我们逐帧看图标出的“在”。拖动曲线看任意一帧：

```widget src="../widgets/glance/video.js" title="在不在，随时间变成一条曲线" note="视频 © 2008 Blender Foundation，www.bigbuckbunny.org，CC BY 3.0（https://creativecommons.org/licenses/by/3.0/），帧经过缩放。"
../images/glance/w-video.png | 静态图：2 分 16 秒那一帧，Glance 框出了兔子（0.996）、蝴蝶（0.992）和左上角的红松鼠（飞鼠 0.661）；下面是四条 P(t) 曲线和人工标注
../images/glance/w-video-n.png | 同上，手机版
```

在 0.5 的阈值上，它和人工标注的一致率是兔子 111/113、飞鼠 111/115、蝴蝶 115/118，“红色汽车”在 120 帧里一次都没有说在。看不清的帧没有计入；标注时我们看得到模型的输出，所以这个一致率偏乐观。有些“错”其实是我们没看见：片头 0:28 那一帧，模型说有蝴蝶（0.99），放大才发现标题字母上真停着一只。

逐帧扫描是“很多张图、每张问几个问题”的用法，也就是前面说的 prefill 占大头的情形，Glance 在这里没有速度优势；它给的是每一帧一个校准过的“在不在”。不过这是一个物体检测器在逐帧回答，而视频 agent 真正卡住的地方，比这更难。

## 意外三：视频 agent 输在“看”

为了知道 Glance 作为工具该补什么，我们先读了 Video-Index[@videoindex] v1.1 上 21 个 agent 公开的运行记录（144 题）。我们从最强的四个 agent（Opus 5.5、Opus 5、Gemini 4 Argon、GPT-6-Astra）的错误或无答案运行里，按 agent × 能力组分层抽样，每格 3 个，共 48 个，按事先定好的规则逐条标注。感知类（前三行）合计 27 个，占 56%，95% 置信区间 42%–69%；只有一个人标注，所以区间偏乐观。

```data title="48 个失败运行，一半以上是“看”出了问题" bars="占比" mark="看错了"
类型 | 占比 | 个数
看错了 | 43.8% | 21
没看到 | 10.4% | 5
时间段找错 | 2.1% | 1
推理或知识 | 16.7% | 8
超时或框架错误 | 14.6% | 7
答案可疑 | 12.5% | 6
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

数据集没有逐次的时间标注，图里编号的 5 个时刻，是答对的 GPT-6-Astra 自己写的“around 129, 132, 134, 232, and 249 seconds”；黑框是 Argon 自己写下的 3 段指向。色带按轨迹里每条抽帧命令的时间范围和帧率画出；Codex 的轨迹不记录看图事件，所以 Astra 那一行是“抽出来的帧”，不一定都看过。把这些叠在一起，漏掉的两次都落在 Argon 用 6 帧/秒细看过的窗口里：它看到了，只是没数对。这正是逐段问“这一刻在不在指”的 P(t) 能直接回答的问题。

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

我们做过一个逐帧的版本给 agent 调用，它暴露的正是逐帧的局限：“一只手从盒子里抽出湿巾”这种**动作**，只要手和盒子同时在画面里，逐帧的检测器就会说“在”，于是一道答案是 5 次的计数题，它数出了 64 次。所以 Glance 作为视频工具该补的，是 agent 最常出错的那几种感知：数清次数、确认某个东西在不在某一段里、指出它在哪，而动作要在一小段视频上判断，不能只看一帧。

### 逐帧打分，在这套题上是反着的

我们还试过一件更直接的事：不要 agent，只让 Glance 自己答题。均匀取 32 帧，每一帧单独回答那道选择题，把各帧给每个选项的概率平均，选最高的。在 Video-Index v1.1 的 144 题上，它只答对 2.1%，随机猜是 24.8%。反过来选概率**最低**的选项，答对 66.7%。

这不是程序错误。我们用合成视频核对过整条链路（63 题全对），把选项顺序倒过来，偏好跟着选项的内容走，不跟字母和位置走。原因在于这套题是怎么挑出来的：Video-Index 的候选题要过一道筛，凡是逐帧模型能有把握答对的题（只看一帧，或者看 32 帧、打乱的 32 帧，或者只看文字），都被去掉；剩下的再按“逐帧模型给正确答案的概率有多低”从难到易排序发布。所以按这个构造，逐帧模型偏爱的选项多半是错的。

```echarts title="逐帧打分：选最可能的选项几乎全错，选最不可能的反而大多对" note="Glance v1，32 帧均匀采样，每帧单独回答。v1.0 是随机 155 题。" height="270"
{"tooltip": {"trigger": "axis", "valueFormatter": "{value}%"}, "legend": {"data": ["选概率最高", "选概率最低", "随机猜"]}, "grid": {"left": 48, "right": 16, "top": 40, "bottom": 44}, "xAxis": {"type": "category", "data": ["v1.0", "v1.1"], "name": "Video-Index", "nameLocation": "middle", "nameGap": 26}, "yAxis": {"type": "value", "max": 80, "axisLabel": {"formatter": "{value}%"}}, "series": [{"name": "选概率最高", "type": "bar", "itemStyle": {"color": "var(--stone)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%", "fontSize": 10}, "data": [3.2, 2.1]}, {"name": "选概率最低", "type": "bar", "itemStyle": {"color": "var(--clay)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%"}, "data": [{"value": 69.0, "label": {"formatter": "69.0%"}}, 66.7]}, {"name": "随机猜", "type": "bar", "itemStyle": {"color": "var(--line)"}, "label": {"show": true, "color": "var(--ink)", "textBorderColor": "transparent", "position": "top", "formatter": "{c}%", "fontSize": 10}, "data": [{"value": 30.0, "label": {"formatter": "30.0%"}}, 24.8]}]}
```

v1.0 是筛选后直接发布的那一批，现象一样：随机 155 题里，选最高 3.2%，选最低 69.0%，随机 30.0%。直接读整段视频的 Qwen3.5-4B 也一样反着（选最高只对 3–5/144，选最低 53–59%），所以这不是“只看单帧”的问题，而是这类模型共同的偏好被筛掉了。这是一个经过对抗筛选的基准应有的性质，不是缺陷：它正好留下了逐帧感知会被误导的那些题。只是要用它评价一个逐帧打分的工具时，得先知道这一点，并且另找没有经过这道筛的题做对照。

读这些记录时还顺带发现两件和“看”无关的事：v1.1 有 41.0% 的题答案是最后一个选项，“永远选最后一个”能在 22 个参赛者里排第 5；Codex 的 52 次 `technical_error` 里有 51 次已经写好了答案，其中 24 个是对的，算上它们 GPT-6-Astra 会从 35.4 升到 41.0。比较 v1.1 上的结果时，这两点都值得先校正。

## 还会出错的地方

Glance 还会出错，而且错得很有规律。每一类我们都知道原因，也都有对应的修法。

**换一种说法，答案可能翻转。** 在一张干净的图上，怎么问都对；换到伞下那张摆满东西的晚饭桌上，“ketchup”是 0.976，“the ketchup bottle”只有 0.362，“something to drink”在一桌子杯子和瓶子前面说“不在”（0.135）。最要紧的是软件界面：“导出按钮”稳稳地框对了，可换成“把图存成 PNG 的那个按钮”，它说不在（0.11）；问“能保住我的修改的那个按钮”，它很有把握地（0.93）框住了“Don't Save”。下图里，每张图的所有说法都在一次前向里一起问，竖线是 0.5 的阈值；没过线的说法，框画成虚线，标签写“它说不在”。

```widget src="../widgets/glance/phrasing.js" title="同一个东西，换个说法" note="照片：Walter Lim，“Ice capuccino and durian durian cake for #tea”；Peter Moons，“Dinner under the umbrella.”，均为 CC BY 2.0（COCO val2017）。界面：Glance 仓库的 examples/gui_mock.html，Apache-2.0。"
../images/glance/w-phrasing.png | 静态图：冰咖啡和蛋糕那张图上，dessert、甜点、something sweet、甜的东西都在 0.98 以上；伞下的晚饭那张图上，ketchup 0.976，番茄酱 0.851，the ketchup bottle 0.362；软件界面上，the button that saves the picture as a PNG 只有 0.11
../images/glance/w-phrasing-n.png | 同上，手机版
```

中文和英文、“甜点”和“dessert”在这几张图上都没问题；出问题的是按用途来描述的说法，而 agent 收到的指令恰恰常常是这种：“把图存下来”，而不是“点 Export”。这正是前面那条名词捷径，修法也在前面。

**靠关系描述的“不在”。** “笔记本电脑旁边的杯子”，可杯子在别处：这种关系对不上的题，v1 只说对 41%（中文 30%）。它认得出杯子，却不太核对“旁边”。

**多个目标，只有一个框。** “两个穿红衣服的人”，它会框住其中一个（在 gRefCOCO 的多目标题上，73.6% 能框中其中之一），可框住全部的只有 41.3%。这是单框头的天花板，GREC 上多目标题一道都对不了也是这个原因。

**GUI 上太容易说“不在”。** VenusBench 上门控挡掉了 18 个点的在场题，GUI 上“在不在”的 AUROC 只有 73.8。

还有一笔明面上的交换：v1 拿一部分框的精度换来了 GUI 能力和可信的“不在”，RefCOCO val 从 95.0 降到 93.2，多目标表达式被误说“不在”的比例从 1.2% 升到 5.1%；v1.1 又把框的精度补了回来。

## 接下来

- **v1.2。** 在 Glance-Data 上重训，补上方位词、数量和关系这几类题。
- **多框头。** 在中心 patch 的分布旁边，加一个逐 patch 的“这里有一个目标”的头：峰的个数就是数量，每个峰各用一次现有的四条边。同一次前向里顺带问一句“这个描述是不是指不止一个东西”，零样本就已经有 0.89 的 AUROC，可以当第三个旋钮：在不在、框准不准、是不是只有一个。
- **Glance-Video。** 不是逐帧问物体，而是在几秒长的小段上回答“这个动作发生了吗”，并且能数状态的变化。那道数出 64 次的计数题，就是它要过的第一关。
- **一句话，问 N 个片段。** 视频 agent 最需要的工具，是拿一句话把整段视频扫一遍，告诉它“在 3:12”，或者有把握地告诉它“这两小时里没有”。

```sketch title="给视频 agent 的扫描工具：一句话，N 个片段，一次前向" note="示意，曲线不是实测。"
<svg viewBox="0 0 704 276">
<rect class="panel" x="0" y="0" width="704" height="276" rx="12"/>
<g class="node clay"><rect x="24" y="24" width="220" height="32" rx="16"/><text class="mid" x="134" y="40">一句话：“有人摔倒了吗”</text></g>
<g class="node plain"><rect x="24" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="54" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="84" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="114" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="144" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="174" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="204" y="76" width="24" height="18" rx="2"/></g>
<g class="node plain"><rect x="234" y="76" width="24" height="18" rx="2"/></g>
<text class="small" x="268" y="85">… N 个片段</text>
<path class="edge" d="M134 56 V70" marker-end="url(#arrow)"/>
<path class="edge" d="M134 94 V118" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="24" y="120" width="300" height="34" rx="4"/><text class="mid" x="174" y="137">一次前向：每个片段从共享状态分出去</text></g>
<path class="edge" d="M324 137 H360" marker-end="url(#arrow)"/>
<line x1="380" y1="150" x2="676" y2="150" stroke="var(--line)"/>
<line x1="380" y1="100.0" x2="676" y2="100.0" stroke="var(--muted)" stroke-dasharray="4 3"/>
<path d="M380.0 142.7 L382.5 141.8 L384.9 142.7 L387.4 143.0 L389.9 141.7 L392.3 140.6 L394.8 142.1 L397.3 145.0 L399.7 146.5 L402.2 145.8 L404.7 145.0 L407.1 145.8 L409.6 147.1 L412.1 146.3 L414.5 143.4 L417.0 141.4 L419.5 141.7 L421.9 142.9 L424.4 142.6 L426.9 141.3 L429.3 141.5 L431.8 144.1 L434.3 146.6 L436.7 146.7 L439.2 145.4 L441.7 145.1 L444.1 146.3 L446.6 146.5 L449.1 144.4 L451.5 141.6 L454.0 140.9 L456.5 142.2 L458.9 143.1 L461.4 142.2 L463.9 141.6 L466.3 143.2 L468.8 146.1 L471.3 147.4 L473.7 146.3 L476.2 144.9 L478.7 145.3 L481.1 146.1 L483.6 145.1 L486.1 142.3 L488.5 140.5 L491.0 141.3 L493.5 142.9 L495.9 143.1 L498.4 142.2 L500.9 142.7 L503.3 145.3 L505.8 147.5 L508.3 147.2 L510.7 145.3 L513.2 144.5 L515.7 145.3 L518.1 145.3 L520.6 143.2 L523.1 140.7 L525.5 140.4 L528.0 142.3 L530.5 143.6 L532.9 143.2 L535.4 142.8 L537.9 144.4 L540.3 147.0 L542.8 147.8 L545.3 144.6 L547.7 125.4 L550.2 90.6 L552.7 67.0 L555.1 57.6 L557.6 53.5 L560.1 52.0 L562.5 53.3 L565.0 55.5 L567.5 56.5 L569.9 59.2 L572.4 73.3 L574.9 106.5 L577.3 139.0 L579.8 146.8 L582.3 144.7 L584.7 143.5 L587.2 144.1 L589.7 144.2 L592.1 142.3 L594.6 140.3 L597.1 140.5 L599.5 142.9 L602.0 144.6 L604.5 144.4 L606.9 143.9 L609.4 145.2 L611.9 147.4 L614.3 147.7 L616.8 145.6 L619.3 143.3 L621.7 143.1 L624.2 143.8 L626.7 143.1 L629.1 141.0 L631.6 140.2 L634.1 142.0 L636.5 144.5 L639.0 145.3 L641.5 144.6 L643.9 144.7 L646.4 146.5 L648.9 147.8 L651.3 146.5 L653.8 143.7 L656.3 142.4 L658.7 143.0 L661.2 143.4 L663.7 141.9 L666.1 140.4 L668.6 141.2 L671.1 143.9 L673.5 145.8 L676.0 145.5" fill="none" stroke="var(--clay)" stroke-width="1.75"/>
<rect x="550.2" y="154" width="23.7" height="6" rx="2" fill="var(--clay)"/>
<text class="small" x="380" y="32">P(t)：每个片段一个校准的概率</text>
<text class="small end" x="676" y="90">阈值</text>
<text class="small mid" x="562.04" y="174">在 3:12–3:40</text>
<g class="node teal"><rect x="24" y="196" width="300" height="34" rx="4"/></g>
<text x="36" y="213">回答：“在 3:12–3:40”，框出是谁</text>
<g class="node teal"><rect x="380" y="196" width="296" height="34" rx="4"/></g>
<text x="392" y="213">或者：“全程都没有”，误报率 ≤ α</text>
<text class="small" x="24" y="254">目标：一次前向 &lt; 100 ms；“全程都没有”在片段集合层面校准</text>
</svg>
<svg viewBox="0 0 340 428">
<rect class="panel" x="0" y="0" width="340" height="428" rx="12"/>
<g class="node clay"><rect x="16" y="16" width="308" height="30" rx="15"/><text class="mid" x="170" y="31">一句话：“有人摔倒了吗”</text></g>
<g class="node plain"><rect x="16" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="42" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="68" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="94" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="120" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="146" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="172" y="62" width="20" height="16" rx="2"/></g>
<g class="node plain"><rect x="198" y="62" width="20" height="16" rx="2"/></g>
<text class="small" x="228" y="70">… N 个片段</text>
<path class="edge" d="M170 46 V58" marker-end="url(#arrow)"/>
<path class="edge" d="M170 78 V96" marker-end="url(#arrow)"/>
<g class="node blue"><rect x="16" y="98" width="308" height="32" rx="4"/><text class="mid" x="170" y="114">一次前向：每个片段从共享状态分出</text></g>
<path class="edge" d="M170 130 V150" marker-end="url(#arrow)"/>
<line x1="24" y1="260" x2="316" y2="260" stroke="var(--line)"/>
<line x1="24" y1="215.0" x2="316" y2="215.0" stroke="var(--muted)" stroke-dasharray="4 3"/>
<path d="M24.0 253.5 L26.4 252.6 L28.9 253.4 L31.3 253.7 L33.7 252.5 L36.2 251.6 L38.6 252.8 L41.0 255.5 L43.5 256.8 L45.9 256.2 L48.3 255.5 L50.8 256.3 L53.2 257.4 L55.6 256.6 L58.1 254.1 L60.5 252.2 L62.9 252.6 L65.4 253.6 L67.8 253.3 L70.2 252.1 L72.7 252.4 L75.1 254.7 L77.5 256.9 L80.0 257.1 L82.4 255.9 L84.8 255.6 L87.3 256.6 L89.7 256.9 L92.1 254.9 L94.6 252.4 L97.0 251.8 L99.4 253.0 L101.9 253.8 L104.3 253.0 L106.7 252.4 L109.2 253.9 L111.6 256.5 L114.0 257.7 L116.5 256.6 L118.9 255.4 L121.3 255.8 L123.8 256.5 L126.2 255.6 L128.6 253.1 L131.1 251.4 L133.5 252.1 L135.9 253.6 L138.4 253.8 L140.8 253.0 L143.2 253.4 L145.7 255.7 L148.1 257.8 L150.5 257.5 L153.0 255.8 L155.4 255.1 L157.8 255.8 L160.3 255.8 L162.7 253.9 L165.1 251.6 L167.6 251.4 L170.0 253.0 L172.4 254.3 L174.9 253.9 L177.3 253.5 L179.7 254.9 L182.2 257.3 L184.6 258.1 L187.0 255.1 L189.5 237.8 L191.9 206.5 L194.3 185.3 L196.8 176.9 L199.2 173.2 L201.6 171.8 L204.1 173.0 L206.5 175.0 L208.9 175.9 L211.4 178.2 L213.8 191.0 L216.2 220.8 L218.7 250.1 L221.1 257.1 L223.5 255.3 L226.0 254.2 L228.4 254.7 L230.8 254.8 L233.3 253.1 L235.7 251.2 L238.1 251.5 L240.6 253.6 L243.0 255.2 L245.4 255.0 L247.9 254.5 L250.3 255.7 L252.7 257.7 L255.2 258.0 L257.6 256.0 L260.0 254.0 L262.5 253.8 L264.9 254.4 L267.3 253.8 L269.8 251.9 L272.2 251.1 L274.6 252.8 L277.1 255.1 L279.5 255.8 L281.9 255.1 L284.4 255.2 L286.8 256.9 L289.2 258.0 L291.7 256.8 L294.1 254.3 L296.5 253.1 L299.0 253.7 L301.4 254.0 L303.8 252.8 L306.3 251.4 L308.7 252.1 L311.1 254.5 L313.6 256.2 L316.0 256.0" fill="none" stroke="var(--clay)" stroke-width="1.75"/>
<rect x="191.9" y="264" width="23.4" height="6" rx="2" fill="var(--clay)"/>
<text class="small" x="24" y="160">P(t)：每个片段一个校准的概率</text>
<text class="small mid" x="203.58" y="282">在 3:12–3:40</text>
<g class="node teal"><rect x="16" y="296" width="308" height="32" rx="4"/><text class="mid" x="170" y="312">回答：“在 3:12–3:40”，框出是谁</text></g>
<g class="node teal"><rect x="16" y="336" width="308" height="32" rx="4"/><text class="mid" x="170" y="352">或者：“全程都没有”，误报率 ≤ α</text></g>
<text class="small" x="16" y="388">目标：一次前向 &lt; 100 ms</text>
<text class="small" x="16" y="408">“全程都没有”在片段集合层面校准</text>
</svg>
```

难点不在前向，而在“全程都没有”这句话。就算每一段的误报只有 1%，各段独立时，64 段里至少误报一次的概率约 47%，256 段时约 92%。只要有一段误报，“全程都没有”就说不出口。所以要在片段集合的层面校准：对所有片段里最高的那个概率定阈值，把“明明没有却说有”的概率控制在 α 以内。这样，视频里真的没有时，它能以 1 − α 的把握说出“全程都没有”，而不会被某一段的误报打断。我们的目标是一次前向在 100 ms 以内，给出一条 P(t) 曲线和一个校准过的“全程都没有”。

**开放。** 代码在 [Vision-Decision/Glance](https://github.com/Vision-Decision/Glance)（Apache-2.0），4B 的预览权重（就是文中的 v1）在 Hugging Face 的 [Vision-Decision/Glance-4B-preview](https://huggingface.co/Vision-Decision/Glance-4B-preview)（CC BY-NC 4.0，训练数据里的 gRefCOCO 只限非商用），一行 `pip install` 就能在 CUDA、Apple 芯片或 CPU 上跑起来。

回头看，最有价值的不是哪个分数，而是三次“和预想的不一样”：生成式模型在“不在”上并不差，它会不会幻觉是提示词和解码器替它选的一档设置；更大、更新的底座没学会说“不在”，难负样本学会了，而我们自己的负样本又悄悄教了它一条捷径；视频 agent 输在“看”，而不是“想”。每一次都把我们从“换模型、换架构”推回到“数据和接口”。

## 数字从哪来

- 延迟都在一张 RTX PRO 6000 上测（另有一组在 L4 上），先空跑一轮，再取 50 次调用的中位数（L4 上 20 次）；两边都从缩放好的图算到拿到全部答案，含图像预处理，不含 JPEG 解码。Jev 的延迟是经 OpenRouter 测的，含网络。
- 页面上的交互图都是 Glance-4B-preview 事先跑好的真实输出，页面上只做筛选和插值。
- 标“官方”的是基准作者的计分脚本，其余是我们自己的评测脚本；所有阈值和温度都在训练分布的留出数据上定，不碰评测集。

## 参考资料

- [@qwen35] Qwen Team (2026). [Qwen3.5: Towards Native Multimodal Agents](https://qwen.ai/blog?id=qwen3.5). _Qwen blog_, February 2026.
- [@jev] Almeida, D. (2026). [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev). _TypeSafe AI blog_, September 2026.
- [@jev114] TypeSafe AI (2026). [Jev 1.14](https://typesafe.ai/blog/jev-1-14). _TypeSafe AI blog_, October 2026. Box 题型的说明见 [TypeSafe 文档](https://docs.typesafe.ai/primitives/box.md)。
- [@guiactor] Wu, Q., Cheng, K., Yang, R., et al. (2025). [GUI-Actor: Coordinate-Free Visual Grounding for GUI Agents](https://arxiv.org/abs/2506.03143). _Advances in Neural Information Processing Systems 38 (NeurIPS 2025)_.
- [@gfl] Li, X., Wang, W., Wu, L., et al. (2020). [Generalized Focal Loss: Learning Qualified and Distributed Bounding Boxes for Dense Object Detection](https://arxiv.org/abs/2006.04388). _Advances in Neural Information Processing Systems 33 (NeurIPS 2020)_.
- [@sam3] Carion, N., Gustafson, L., Hu, Y.-T., et al. (2026). [SAM 3: Segment Anything with Concepts](https://arxiv.org/abs/2511.16719). _International Conference on Learning Representations (ICLR 2026)_.
- [@song2025] Song, X., & Bahri, D. (2025). [Decoding-based Regression](https://arxiv.org/abs/2501.19383). _Transactions on Machine Learning Research_.
- [@holtzman2021] Holtzman, A., West, P., Shwartz, V., Choi, Y., & Zettlemoyer, L. (2021). [Surface Form Competition: Why the Highest Probability Answer Isn't Always Right](https://doi.org/10.18653/v1/2021.emnlp-main.564). _Proceedings of EMNLP 2021_, 7038–7051.
- [@refbenchpro] Gao, T., Li, H., Fang, H., Wei, X., et al. (2025). [RefBench-PRO: Perceptual and Reasoning Oriented Benchmark for Referring Expression Comprehension](https://arxiv.org/abs/2512.06276). _arXiv preprint arXiv:2512.06276_.
- [@grefcoco] Liu, C., Ding, H., & Jiang, X. (2023). [GRES: Generalized Referring Expression Segmentation](https://arxiv.org/abs/2306.00968). _IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR 2023)_.
- [@screenspotv2] Wu, Z., Wu, Z., Xu, F., et al. (2025). [OS-ATLAS: A Foundation Action Model for Generalist GUI Agents](https://arxiv.org/abs/2410.23218). _International Conference on Learning Representations (ICLR 2025)_. ScreenSpot-v2 是这篇论文修订的版本。
- [@screenspotpro] Li, K., Meng, Z., Lin, H., et al. (2025). [ScreenSpot-Pro: GUI Grounding for Professional High-Resolution Computer Use](https://arxiv.org/abs/2504.07981). _Proceedings of the 33rd ACM International Conference on Multimedia (MM '25)_.
- [@grec] He, S., Ding, H., Liu, C., & Jiang, X. (2023). [GREC: Generalized Referring Expression Comprehension](https://arxiv.org/abs/2308.16182). _arXiv preprint arXiv:2308.16182_. MLLM 的 GREC 成绩取自 Yang, X., Ling, J., Huang, T., et al. (2026). [Teaching MLLMs to Say No: Generalized Referring Expression Comprehension via Refusal Calibrated GRPO](https://arxiv.org/abs/2608.04698). _arXiv preprint arXiv:2608.04698_。
- [@venusbench] Zhou, B., Huang, Z., Guo, Y., et al. (2025). [VenusBench-GD: A Comprehensive Multi-Platform GUI Benchmark for Diverse Grounding Tasks](https://arxiv.org/abs/2512.16501). _arXiv preprint arXiv:2512.16501_. UI-Venus-1.5 的成绩取自其技术报告 [arXiv:2602.09082](https://arxiv.org/abs/2602.09082)。
- [@videoindex] Song, E., Xu, Y., Yang, S., Chai, W., & Gu, J. (2026). [Video-Index: A Curated Meta-Benchmark for Video Understanding](https://arxiv.org/abs/2610.00960). _arXiv preprint arXiv:2610.00960_.
