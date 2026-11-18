---
title: "Glance：一次 prefill 回答“在不在、在哪里”"
description: "从调研、架构、Colab 上的基础设施到 v0、27B、v1 和一组只换输出头的受控实验，完整记录我们训练单次前向决策模型 Glance 的过程：能说“目标不存在”的 box 原语、混合 GDN 底座上的共享前缀前向、跨域翻车，以及受控实验怎样改写了我们的论文主张。"
date: 2026-11-18
tag: "技术"
tags:
  - "llm"
  - "vision"
  - "grounding"
  - "Colab"
draft: true
---

这两天我们在 Qwen3.5-4B[@qwen35] 上训练了一个叫 **Glance** 的模型。它不生成文字，只做一次 prefill，就对一组带类型的问题给出概率：选哪个选项（choice）、打几分（score）、是还是否（noul），以及这篇的主角，**框出一个东西，或者说它不在图里**（box）。

```frames title="同一个模型，一次 prefill：在就框出来，不在就说不在" q="问：the big white rabbit（最后一格换成问 a red car）" cols="6" note="Glance-4B-preview 的真实输出，Apple 芯片 MPS、fp32；每帧问 4 个问题共用一次 prefill，60 帧平均每帧约 1.5 s。P 是校准过的 P(present)，不低于 0.5 时画出 box 头的框。帧取自 Big Buck Bunny（© 2008 Blender Foundation，www.bigbuckbunny.org，CC BY 3.0；archive.org 上的 640×360 版本），只截取单帧并缩放，低于阈值的帧显示成灰度。原始输出：outputs/blog/glance_bbb.json。"
../images/glance/bbb-056.jpg | 0:56 | 0.9964 | 410.7,77.5,640,360 | 从洞里出来
../images/glance/bbb-064.jpg | 1:04 | 0.9862 | 469.2,235,596,360 | 远处，被花挡住一半
../images/glance/bbb-128.jpg | 2:08 | 0.9886 | 109.2,127.8,537.8,360 | 头上停着蝴蝶
../images/glance/bbb-152.jpg | 2:32 | 0.0162 | | 只有三只啮齿动物
../images/glance/bbb-400.jpg | 6:40 | 0.0443 | | 飞鼠，不是兔子
../images/glance/bbb-128.jpg | 2:08 | 0.0003 | | 问 a red car：同一帧，不在
```

这篇按时间顺序写：为什么要做、架构里踩到的坑、在 Colab 上怎么把训练跑完、v0 和 27B 的结果、跨域的翻车、v1，以及一组只换输出头的受控实验怎样改写了我们原本想写的论文主张。所有数字都来自训练和评测的输出文件；还没核对完的会标出来。

## 为什么要一个会说“不在”的框

“System One”式的类型化决策模型已经有一批了，比如 TypeSafe 的 Jev 和 Cloudflare 的 Clef：给一个状态和一组带类型的问题，模型一次前向给出每个选项的概率，不写推理过程，所以快，而且输出的是能直接拿来做决策的分布。OpenDecisions[@opendecisions] 是一篇讲怎样做开源决策模型的论文给出的 2,352 题验证集，后面我们也用它来测文本决策。

我们想往这套原语里加一个视觉的 box。agent 点按钮之前要先确认按钮在不在、在哪里；做视频检索时要先问“这一段里有没有那个东西”。这里真正有用的不是“框得更准”，而是**目标不在时，模型能说不在，而且说得有多确定是校准过的**。

动手前做了一轮调研，结论大致是这样：

- 现有的 box 原语都回答不了“不存在”。生成式模型可以输出一个 `none`，但那只是一个 token，没有概率意义上的保证。
- 选 patch 来定位，GUI-Actor[@guiactor] 已经做了；用 presence token 判断概念在不在，SAM 3[@sam3] 已经做了；把框的四条边建模成离散分布，GFL[@gfl] 早就做了。所以**架构本身不是贡献**。
- 还没人回答的问题是：能不能在**一次前向**里同时给出框和校准过的“不存在”概率，并且一张图上问很多个问题也不变慢？

所以我们的卖点一开始就定在“单次前向、能拒答、校准”，而不是 box 精度。

## 架构：一次 prefill，所有问题共用前缀

一条训练记录是一张图加上很多个问题。图像部分 `<vision_start><image_pad>…<vision_end>` 只跑一次；每个问题块 `<object_ref_start>描述<object_ref_end><box_start>` 各自接在前缀后面，读出位置是 `<box_start>` 的最终隐状态。v1 里 choice、score、noul 也是同样的问题块，只是读出位置换成块的最后一个 token。

Qwen3.5 是混合架构：每 4 层里 3 层是 Gated DeltaNet（GDN，一种线性注意力，带递归状态），1 层是带门控的全注意力。这一点决定了共享前缀**不能**用最直接的方法实现。

### 坑：只靠 block mask 拼接，会从 GDN 状态漏过去

最直接的做法是把前缀和所有问题块拼成一条序列，在全注意力层加一个 block mask，让每个块只看到前缀和自己。可 GDN 层没有注意力矩阵可遮：它是一个沿序列往后传的递归状态，问题 1 的内容会被写进状态，再被问题 2、3 读到。mask 只挡住了四分之一的层。

我们在 27B 上做了一次对照：把 8 个问题块拼在一起、全注意力层加 block mask，和每个块单独接在前缀后面跑，比较每个块的隐状态和读出分布。

```data title="只加 block mask，后面的块就和单独跑时不一样" bars="隐状态相对差" mark="块 3" note="27B，8 个问题块，每块 25 个 token。隐状态相对差 = ‖拼接 − 单独‖ / ‖单独‖；KL 是读出位置下一个 token 分布的 KL。两次运行在前缀部分本身也有数值差异（mask 的写法不同），所以只看块之间的对比：块 0 前面没有别的块，可以当对照。来源：outputs/27b/bench/leak.json。"
块 | 隐状态相对差 | 读出 KL | top-1 一致
块 0 | 1.8% | 0.0004 | 是
块 1 | 17.3% | 0.012 | 是
块 2 | 29.5% | 0.079 | 是
块 3 | 39.5% | 0.150 | 是
块 4 | 33.4% | 0.029 | 是
块 5 | 21.2% | 0.038 | 是
块 6 | 30.5% | 0.133 | 否
块 7 | 24.0% | 0.042 | 是
```

块 0 和单独跑几乎一样，从块 1 开始差出 17%–40%，块 6 连最可能的那个 token 都变了。换成 flex attention 的 BlockMask 结果也一样（块 3 相对差 38.7%），因为问题不在注意力层。

所以我们自己写了前向（`dv/model/backbone.py`）：前缀照常因果地跑一次，记下每个 GDN 层最后的递归状态和最后 3 个 conv 输入；每个问题块的 GDN 层**都从这份前缀状态重新开始**，而不是接着上一个块；全注意力层里每个块只看前缀的 key 和自己（块内双向）。这在数学上等于把每个“前缀 + 问题块”分开跑，只是前缀只算一次。

```sketch title="每个问题块都从前缀的状态重新开始" note="直接拼接：全注意力层的 block mask 挡住了注意力，但 GDN 的递归状态沿序列往后传，问题 1 的内容进了问题 2、3。我们的做法：前缀只算一次，每个块的 GDN 层从同一份前缀末状态出发，全注意力层只看前缀和自己。"
<svg viewBox="0 0 704 372">
  <rect class="panel" x="0" y="0" width="704" height="150" rx="12"/>
  <text class="caps" x="24" y="28">直接拼接 + block mask</text>
  <g class="node plain"><rect x="24" y="46" width="168" height="34" rx="4"/><text class="mid" x="108" y="63">图像前缀</text></g>
  <g class="node blue"><rect x="228" y="46" width="128" height="34" rx="4"/><text class="mid" x="292" y="63">问题块 1</text></g>
  <g class="node blue"><rect x="392" y="46" width="128" height="34" rx="4"/><text class="mid" x="456" y="63">问题块 2</text></g>
  <g class="node blue"><rect x="556" y="46" width="124" height="34" rx="4"/><text class="mid" x="618" y="63">问题块 3</text></g>
  <path class="edge" d="M192 63 H224" marker-end="url(#arrow)"/>
  <path class="edge hot" d="M356 63 H388" marker-end="url(#arrow)"/>
  <path class="edge hot" d="M520 63 H552" marker-end="url(#arrow)"/>
  <text class="small accent" x="24" y="108">GDN 递归状态沿序列往后传：问题 1 的内容写进了问题 2、3 读到的状态</text>
  <text class="small" x="24" y="128">block mask 只作用在全注意力层（每 4 层 1 层）</text>
  <rect class="panel" x="0" y="166" width="704" height="206" rx="12"/>
  <text class="caps" x="24" y="194">Glance：每块从前缀状态重开</text>
  <g class="node plain"><rect x="24" y="264" width="168" height="34" rx="4"/><text class="mid" x="108" y="281">图像前缀（只跑一次）</text></g>
  <g class="node violet"><rect x="228" y="264" width="196" height="34" rx="4"/><text class="mid" x="326" y="281">前缀末状态 + 3 个 conv 输入</text></g>
  <g class="node blue"><rect x="484" y="212" width="196" height="34" rx="4"/><text class="mid" x="582" y="229">问题块 1</text></g>
  <g class="node blue"><rect x="484" y="264" width="196" height="34" rx="4"/><text class="mid" x="582" y="281">问题块 2</text></g>
  <g class="node blue"><rect x="484" y="316" width="196" height="34" rx="4"/><text class="mid" x="582" y="333">问题块 3</text></g>
  <path class="edge" d="M192 281 H224" marker-end="url(#arrow)"/>
  <path class="edge" d="M424 281 H480" marker-end="url(#arrow)"/>
  <path class="edge" d="M452 281 V229 H480" marker-end="url(#arrow)"/>
  <path class="edge" d="M452 281 V333 H480" marker-end="url(#arrow)"/>
</svg>
<svg viewBox="0 0 340 556">
  <rect class="panel" x="0" y="0" width="340" height="262" rx="12"/>
  <text class="caps" x="16" y="28">直接拼接 + block mask</text>
  <g class="node plain"><rect x="40" y="44" width="260" height="30" rx="4"/><text class="mid" x="170" y="59">图像前缀</text></g>
  <g class="node blue"><rect x="40" y="94" width="260" height="30" rx="4"/><text class="mid" x="170" y="109">问题块 1</text></g>
  <g class="node blue"><rect x="40" y="144" width="260" height="30" rx="4"/><text class="mid" x="170" y="159">问题块 2</text></g>
  <g class="node blue"><rect x="40" y="194" width="260" height="30" rx="4"/><text class="mid" x="170" y="209">问题块 3</text></g>
  <path class="edge" d="M170 74 V90" marker-end="url(#arrow)"/>
  <path class="edge hot" d="M170 124 V140" marker-end="url(#arrow)"/>
  <path class="edge hot" d="M170 174 V190" marker-end="url(#arrow)"/>
  <text class="small mid accent" x="170" y="246">GDN 状态把问题 1 带进了问题 2、3</text>
  <rect class="panel" x="0" y="278" width="340" height="278" rx="12"/>
  <text class="caps" x="16" y="306">Glance：每块从前缀状态重开</text>
  <g class="node plain"><rect x="40" y="322" width="260" height="30" rx="4"/><text class="mid" x="170" y="337">图像前缀（只跑一次）</text></g>
  <g class="node violet"><rect x="40" y="372" width="260" height="30" rx="4"/><text class="mid" x="170" y="387">前缀末状态 + 3 个 conv 输入</text></g>
  <g class="node blue"><rect x="16" y="458" width="96" height="30" rx="4"/><text class="mid" x="64" y="473">问题块 1</text></g>
  <g class="node blue"><rect x="122" y="458" width="96" height="30" rx="4"/><text class="mid" x="170" y="473">问题块 2</text></g>
  <g class="node blue"><rect x="228" y="458" width="96" height="30" rx="4"/><text class="mid" x="276" y="473">问题块 3</text></g>
  <path class="edge" d="M170 352 V368" marker-end="url(#arrow)"/>
  <path class="edge" d="M170 402 V454" marker-end="url(#arrow)"/>
  <path class="edge" d="M170 426 H64 V454" marker-end="url(#arrow)"/>
  <path class="edge" d="M170 426 H276 V454" marker-end="url(#arrow)"/>
  <text class="small mid" x="170" y="524">每块只看前缀和自己，块之间互不可见</text>
</svg>
```

这个实现有两层检查：`scripts/test_equivalence.py` 在一个随机初始化的小 Qwen3.5 配置上，对比我们的前向和 HF 参考实现跑“前缀 + 单个块”的结果（fp32，相对误差约 1e-7），并且改动块 1 的 token 时块 0 的输出不变；`scripts/test_numerics.py` 用真实的 4B 权重在 GPU 上再比一次（fp32 余弦相似度 ≥ 0.99999，bf16 的偏差和 HF 自己的 bf16 噪声一样大）。

### box 头：存在门控、patch 中心、四条边的分布

读出 `<box_start>` 位置的隐状态 h 之后，box 头做四件事：

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

- **存在门控**：一个 MLP 输出 P(present)，用 BCE 训练。这是“不在”的来源。
- **中心**：h 和每个视觉 token 做点积再 softmax，选框中心所在的 patch。训练目标是 GT 框覆盖到的所有 patch，按覆盖面积分配概率（和 GUI-Actor 一样）。
- **四条边**：在选中的 patch 中心上，预测到左、上、右、下四条边的偏移，每条是 K=64 档的分布。目标是以真实偏移为中心、宽 1 档的高斯，损失是 Cramér 距离（两个分布 CDF 之差的平方和），再加上期望框的 GIoU。和 GFL 一样，边是分布而不是一个数，所以“这条边有多不确定”可以直接读出来。
- **IoU 头**：预测解码出的框和真值 IoU ≥ 0.5 的概率。最后的框置信度是 P(present) × P(IoU ≥ 0.5)。

训练时冻结视觉塔和 embedding，在 LLM 的所有线性层上加 LoRA（r=64，α=128），头用 fp32。

v1 加了 choice、score、noul 三种类型化的头。它们的 logit 是 h 乘上 LM head 里对应标签 token（A…Z、Yes/No）的那几行，再加一个零初始化的线性残差。所以**刚初始化时，类型化头的输出和底座模型下一个 token 的 logit 完全一样**（`scripts/v1/test_v1_init.py` 检查了这一点），训练只是在这个基础上微调。choice 和 noul 用软目标 CE 加 Brier，score 用 CE 加等级上的 Cramér。各类的温度事后在训练分布里留出的校准集上拟合，从不用评测集。

## 基础设施：Colab G4 和一个多账号池

所有训练都在 Colab 的 G4（RTX PRO 6000 Blackwell，96 GB）上跑，通过 `colab-pool` 在几个账号之间分配 VM。这一节只写几条以后还用得上的经验。

**Colab 会把它认为闲着的 VM 收回去。** 所以训练期间要让它一直看到活动：每 5 分钟从本机对 VM 执行一次 `echo ok`；训练脚本每 15 分钟存一次 checkpoint，本机每 40 分钟把最新的拉回来，替换上一份。某次 exec 报“session not found”时，先用 `colab-pool reconcile` 跟服务端确认，确认真没了才算丢失，因为切账号的瞬间会出现假的“not found”。脚本见 `scripts/27b/pull_ckpt.sh`，每个远程调用都带硬超时。

**池子的锁拿得太久。** `colab-pool` 在每条命令的整个生命周期里都持有账号锁。一次卡住的 exec 或 download 能占着锁 12 分钟到 1 小时，期间所有切账号、`stop`、`list` 都在排队。大家于是开始在外面套 `timeout`，而 `timeout` 会在 Colab CLI 写状态文件的半路把它杀掉，留下空的或写了一半的文件，这很可能就是偶尔出现“会话不见了”的原因。[issue #2](https://github.com/mizorewww/colab-account-changer/issues/2) 先在 `ssh --proxy-mode` 上发现了这个问题；[PR #3](https://github.com/mizorewww/colab-account-changer/pull/3) 改成只在命令启动时持锁：切到正确的账号，token 离过期不到 15 分钟就先刷新，启动后再多拿 3 秒，然后放锁。

还有两个是我们自己写出来的：

- **`pkill -f` 杀了自己的启动器。** 启动脚本先用 `pkill -f` 按名字清掉旧的训练进程，再启动新的。可启动脚本自己的命令行里也带着这个名字，`pkill -f` 匹配的是完整命令行，于是连它自己一起杀了，新训练根本没起来。
- **等待脚本 grep 到了自己的回显。** 等评测结束的脚本远程执行 `test -f … && echo RESULTS_READY`，再在输出里 grep `RESULTS_READY`。但远程执行会把命令本身也打印回来，于是第一次轮询就“等到了”。修法是让命令里的字符串和要找的字符串不一样：

```bash
test -f /content/out/v0_27b/eval_results.json && echo RESULTS_''READY
```

两件事是同一个道理：**用来匹配的字符串不要出现在发出匹配的那条命令里。**

## v0：在 COCO 上，一次前向就够了

v0 只有 box 原语。数据是 RefCOCO、RefCOCO+、RefCOCOg 和 gRefCOCO[@grefcoco]：gRefCOCO 里的“无目标”表达式当负样本，另外从别的图里挑描述性的表达式，只要它指的 COCO 类别在当前图里一个实例都没有，就当作交换来的负样本，补到 25% 的问题是“不在”。所有评测集里出现过的图都从训练集里去掉。总共 24,462 张图、355,385 个问题。

一张 G4 上训练 1 个 epoch，3,058 步，**77.7 分钟**，峰值显存 17.1 GB；整个会话（装环境、测试、训练、评测）约 24 个计算单元。

```data title="v0 在 RefCOCO 系列上" bars="Acc@0.5" note="Qwen3.5-4B + LoRA，1 个 epoch。Acc@0.5 = 预测框与真值 IoU ≥ 0.5 的比例；ECE 是框置信度 P(present)×P(IoU≥0.5) 的期望校准误差。来源：outputs/v0/eval_results.json。"
评测集 | 题数 | Acc@0.5 | 框置信度 ECE
RefCOCO val | 10,834 | 95.0 | 0.006
RefCOCO testA | 5,657 | 96.1 | 0.006
RefCOCO testB | 5,095 | 92.8 | 0.012
RefCOCO+ val | 10,758 | 91.8 | 0.012
RefCOCO+ testA | 5,726 | 95.2 | 0.011
RefCOCO+ testB | 4,889 | 87.5 | 0.016
RefCOCOg val | 4,896 | 92.1 | 0.016
RefCOCOg test | 9,602 | 92.0 | 0.014
```

框置信度的 ECE 在 0.006 到 0.016 之间，也就是说它说“90% 有把握”的时候，大约真的有 90% 是对的。

速度是这套设计的另一半理由。同一张图问 1 个问题和问 8 个问题，模型时间几乎一样，因为前缀只算一次、问题块是并行的：

```data title="同一张图上问 1 题和 8 题的延迟" bars="1 题,8 题" mark="Glance v0" note="模型时间的中位数，毫秒，RTX PRO 6000。生成式底座：同一个 Qwen3.5-4B，用提示词让它输出 0–1000 坐标或 none，8 题是同一张图上的 8 个问题依次生成。来源：outputs/v0/eval_results.json、baseline_results.json。"
模型 | 1 题 | 8 题
Glance v0 | 84 | 85
生成式底座 | 400 | 3,161
```

v0 的问题在“不在”上。gRefCOCO val 的负样本里，它能正确说“不在”的比例（N-acc）是 77.0%；在同一个 500 题的无目标子集上是 75%，生成式底座是 65%。但存在门控的 ECE 在只含无目标和多目标表达式的 gRefCOCO val 上是 **0.139**，并上 RefCOCO val 的正样本之后是 0.075。它对真实负样本**过于自信**：训练时的负样本大多是“换来的”，类别根本不在图里，太容易了；gRefCOCO 的负样本是“图里有狗，但没有‘左边那只白狗’”这种。

## 27B：更大的模型，同样的盲区

v0 跑通之后，用同样的数据和配方在 27B（`Qwen/Qwen3.8-27B`，同一族的混合架构，bf16 + LoRA）上训了一遍：同样 3,058 步，约 5 小时，峰值显存 66 GB。

```data title="v0 4B 与 27B：框更准了，“不在”没有变" note="同样的数据、同样的步数。8 个 RefCOCO 评测集的平均 Acc@0.5 提高 1.3 个点，其中 RefCOCO+ 和 RefCOCOg 的 5 个评测集平均提高 1.6 个点。gRefCOCO 一行是 val 的无目标 + 多目标表达式并上 RefCOCO val（25,063 题）。来源：outputs/v0/eval_results.json、outputs/27b/eval_results.json。"
指标 | 4B | 27B
RefCOCO 8 个评测集平均 Acc@0.5 | 92.8 | 94.1
RefCOCO+ testB Acc@0.5 | 87.5 | 89.9
gRefCOCO N-acc | 77.0 | 77.5
gRefCOCO 存在门控 AUROC | 0.964 | 0.968
gRefCOCO 存在门控 ECE | 0.075 | 0.074
延迟 1 题 / 8 题（ms） | 84 / 85 | 230 / 233
```

框更准了，越难的评测集提升越大，但 N-acc 和 ECE 几乎没动。7 倍的参数没有教会它分辨“图里有狗”和“图里有那只狗”。这说明**问题在数据，不在规模**：训练集里没有足够多难的负样本，模型再大也学不到。

## 跨域检查：COCO 上的分数带不走

在 COCO 上的分数很好看，于是我们把 v0 直接拿去测 GUI 定位的 ScreenSpot-v2[@screenspotv2]：

```data title="v0 在 ScreenSpot-v2 上" bars="点击准确率" note="1,272 题，预测点落在目标框内算对。Glance v0 用 640 个视觉 token，生成式底座最多 4,000 个，分辨率差很多；但下面的 v1 同样只用 640 个就到了 89.4，所以分辨率不是主要原因。来源：outputs/eval_v0_xdomain/rows/。"
模型 | 点击准确率
Glance v0 | 28.6
生成式底座 Qwen3.5-4B | 93.4
```

28.6 对 93.4。底座本身会定位 UI 元素，v0 在 COCO 上训了 78 分钟，反而把它压没了：新加的头只见过自然图像里的物体。in-domain 的分数说明不了任何跨域的事。

## v1：类型化原语 + 混合数据 + 难负样本

v1 做了两件事：一是加上 choice、score、noul，让 Glance 成为一个通用的决策模型；二是把数据换成混合配比，并刻意加入难负样本。

```data title="v1 的训练数据" bars="问题数" note="难负样本：同一张图里存在、但不符合描述的东西（GUI 里是同一屏上的别的元素），区别于从别的图换来的“容易”负样本。“不在”的问题占全部 box 问题的 17.9%。所有评测集的图片按哈希剔除，OpenDecisions 和 Decision Index 的题目按 n-gram 去重。来源：outputs/v1/data_stats/stats.json。"
数据池 | 记录 | 问题数 | 其中“不在” | 难负样本
文本决策 | 178,942 | 208,000 | 0 | 0
GUI 截图 | 20,050 | 130,029 | 13,046 | 6,470
自然图像 | 7,590 | 114,419 | 32,088 | 20,941
PixMo 指点和计数 | 5,791 | 67,600 | 9,260 | 0
```

一共 212,373 条记录、520,048 个问题。训练 3,844 步，396 分钟，约 85 个计算单元。

```data title="v1 和 v0、底座的对比" note="gRefCOCO 同上一张表的口径。VenusBench-GD 拒答：目标不在屏幕上时说“不在”的比例，用的是我们自己的评测脚本，还没有和官方脚本交叉核对。OpenDecisions 是 capability 分，底座和 v1 都用事后温度校准后的分数（底座未校准是 51.9）。“—”是没测。来源：outputs/v1/eval_results.json、eval_base_qwen35_4b.json。"
指标 | 生成式底座 | v0 | v1
gRefCOCO N-acc | — | 77.0 | 87.4
gRefCOCO 存在门控 ECE | — | 0.075 | 0.023
gRefCOCO 存在门控 AUROC | — | 0.964 | 0.979
ScreenSpot-v2 点击准确率 | 93.4 | 28.6 | 89.4
ScreenSpot-Pro 点击准确率 | — | — | 29.3
VenusBench-GD 拒答准确率（待核对） | — | — | 81.5
OpenDecisions capability | 63.6 | — | 67.6
RefCOCO val Acc@0.5 | — | 95.0 | 93.2
```

“不在”的问题基本解决了：N-acc 从 77.0 到 87.4，ECE 从 0.075 降到 0.023。ScreenSpot-v2 从 28.6 回到 89.4，VenusBench-GD[@venusbench] 的拒答子任务 81.5（自己的脚本，等官方脚本交叉核对），OpenDecisions 67.6，比同样校准过的底座高 4 个点。延迟没变：box 1 题 85.5 ms、8 题 85.6 ms，纯文本 1 题 67 ms。

也有退步，要写清楚：

- **RefCOCO 掉了 2 个点**（val 95.0 → 93.2，8 个评测集平均 92.8 → 90.8）。框也松了一些，平均 IoU 从 0.84 降到 0.77。自然图像只占全部问题的五分之一左右，COCO 上的专长被稀释了。
- **多目标表达式的召回**从 98.8% 降到 94.9%：模型更敢说“不在”，代价是偶尔把在的也说成不在。
- **ScreenSpot-Pro[@screenspotpro] 只有 29.3**。这个评测集是专业软件的高分辨率截图，图标很小，而 v1 的视觉 token 上限只有 640。生成式底座在 SS-Pro 上我们只跑完了 718/1,581 题，没法直接比。

## 受控实验：只换输出头

原本想写的论文主线是：自回归地生成坐标，会因为“表面形式竞争”[@holtzman2021] 而幻觉出框，或者过度拒答；存在门控加 proper scoring 的读出没有这个问题。为了验证，我们做了一组受控实验：**同一个 4B 底座、同样的 LoRA、同样的数据和顺序、同样 3,058 步，只换输出头**。

- **本文门控**：v0 的 box 头。
- **AR 数字**：生成 `x1,y1,x2,y2`，0–1000 的数字，每位数字一个 token；不在就生成 `none`。
- **AR 层级**：每个坐标两个新 token，先粗后细（32×32 = 1,024 级），类似用 token 序列解码数值的做法[@song2025]。
- **AR 原子**：每个坐标值一个新 token，1,000 级。另有一个 100 级的版本，只放在下面的哑铃图里。

AR 头需要选一个解码规则来决定“说不说 none”。我们比较了三种：贪心解码；P(none) ≥ 0.5 的阈值；以及**序列级 MAP**：比较整串 `none` 的概率和贪心得到的整串坐标的概率，取大的那个，这近似于 beam search 会做的事。

```data title="六组受控实验" mark="门控 25%" note="百分比后的数字是训练时“不在”的问题占比（5% 时只减少负样本，正样本完全相同）。拒答 = RefCOCO val 上目标在场、模型却说不在的比例；@1% = 把阈值调到恰好拒答 1% 的在场目标时的 N-acc；MAP 两列是序列级 MAP 解码下的 N-acc 和拒答。AR 头其余各列用贪心解码。25% 的四组存在概率 AUROC 在 96.2–96.6 之间，5% 的两组是 94.9 和 95.0。来源：outputs/ablation/main_table.md。"
运行 | RefCOCO | N-acc | 拒答 | ECE | @1% | MAP N-acc | MAP 拒答
门控 25% | 95.1 | 75.7 | 0.4 | 8.1 | 81.3 | — | —
AR 数字 25% | 94.4 | 78.0 | 0.5 | 7.9 | 82.1 | 98.2 | 39.9
AR 层级 25% | 94.4 | 78.3 | 0.5 | 8.0 | 81.7 | 96.6 | 21.9
AR 原子 25% | 73.1 | 84.4 | 1.5 | 7.6 | 82.1 | 93.3 | 9.9
门控 5% | 94.8 | 64.3 | 0.1 | 12.7 | 80.0 | — | —
AR 数字 5% | 94.4 | 67.2 | 0.2 | 12.1 | 79.9 | 94.1 | 15.2
```

结果和预想的不一样，分三点说。

**一，贪心解码下，AR 头在“不在”上和门控打平。** N-acc 是 78.0、78.3 对 75.7；把阈值调到同样拒答 1% 的在场目标时，是 82.1、81.7 对 81.3。AUROC 和 ECE 也几乎一样。门控在“不在”上并没有赢。

**二，表面形式竞争是真的，但只在序列级 MAP 下出现。** 一个框的概率分散在成千上万种坐标串上，而 `none` 只有一种写法。按整串概率比较时，`none` 赢得太多：AR 数字会把 **40%** 在场的目标说成不在，层级 22%，原子 9.9%。所以 AR 头的“不在”有多好，取决于你选哪种解码规则，而这在部署时往往不是一个显式的选择。

```echarts title="同一个 AR 头，换个解码规则，拒答率差几十倍" height="360" note="RefCOCO val 上目标在场、模型却说“不在”的比例。灰点：贪心解码（与上表“拒答”列同口径）；橙点：序列级 MAP；连线越长，表面形式竞争越强。门控只有一种读法，所以只有一个点。AR 原子 1000 级在这个预算下没有学会（见上表），数字只作参考；100 级是另一次同配方的训练。来源：outputs/ablation/main_table.json（refusal_present_val、refusal_seqmap_val）。"
{"tooltip": {"trigger": "item"}, "grid": {"left": 112, "right": 56, "top": 16, "bottom": 40}, "xAxis": {"type": "value", "max": 45, "name": "在场却说“不在”", "nameLocation": "middle", "nameGap": 26, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "data": ["AR 数字", "AR 层级", "AR 原子 1000", "AR 原子 100", "AR 数字 · 负 5%", "门控", "门控 · 负 5%"], "inverse": true, "axisTick": {"show": false}}, "series": [{"type": "bar", "stack": "d", "silent": true, "itemStyle": {"color": "transparent"}, "data": [0.5, 0.5, 1.5, 0.8, 0.2, 0.4, 0.1], "tooltip": {"show": false}}, {"type": "bar", "stack": "d", "silent": true, "barWidth": 3, "itemStyle": {"color": "var(--line)"}, "data": [39.4, 21.4, 8.4, 2.6, 15.0, 0, 0], "tooltip": {"show": false}}, {"name": "贪心", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--stone)"}, "z": 3, "label": {"show": true, "position": "bottom", "distance": 4, "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [[0.5, 0], [0.5, 1], [1.5, 2], [0.8, 3], [0.2, 4], [0.4, 5], [0.1, 6]], "tooltip": {"formatter": "{a}：{@[0]}%"}}, {"name": "序列 MAP", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--clay)"}, "z": 4, "label": {"show": true, "position": "right", "formatter": "{@[0]}%", "color": "var(--ink)", "textBorderColor": "transparent"}, "data": [[39.9, 0], [21.9, 1], [9.9, 2], [3.4, 3], [15.2, 4]], "tooltip": {"formatter": "{a}：{@[0]}%"}}]}
```

**三，负样本越少，所有头都越爱幻觉。** 训练负样本从 25% 降到 5%，在 gRefCOCO 无目标表达式上画出框的比例都升了 10 个点左右，门控也不例外。先验变了可以事后平移 logit 来修正：门控从 35.7 修到 27.3，AR 数字用 P(none) 阈值做同样的修正是 24.6，门控并没有更好。

```echarts title="训练负样本从 25% 减到 5%，三种读法都往右移了 10 个点左右" height="260" note="幻觉率 = gRefCOCO val 无目标表达式上没有说“不在”的比例。门控按 P(present) ≥ 0.5；AR 数字分别按 P(none) < 0.5 的阈值和贪心解码。空心点：5% 的模型按训练先验平移 logit 之后（贪心解码没有可平移的阈值）。来源：outputs/ablation/halluc_vs_negratio.json。"
{"tooltip": {"trigger": "item"}, "legend": {"data": ["负样本 25%", "负样本 5%", "5% + 先验修正"]}, "grid": {"left": 112, "right": 56, "top": 40, "bottom": 40}, "xAxis": {"type": "value", "min": 15, "max": 40, "name": "无目标表达式上画了框", "nameLocation": "middle", "nameGap": 26, "axisLabel": {"formatter": "{value}%"}}, "yAxis": {"type": "category", "data": ["门控", "AR 数字 · 阈值", "AR 数字 · 贪心"], "inverse": true, "axisTick": {"show": false}}, "series": [{"type": "bar", "stack": "d", "silent": true, "itemStyle": {"color": "transparent"}, "data": [24.3, 24.2, 22.0], "tooltip": {"show": false}}, {"type": "bar", "stack": "d", "silent": true, "barWidth": 3, "itemStyle": {"color": "var(--line)"}, "data": [11.4, 10.8, 10.8], "tooltip": {"show": false}}, {"name": "负样本 25%", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--stone)"}, "z": 3, "label": {"show": true, "position": "left", "formatter": "{@[0]}%", "color": "var(--muted)", "textBorderColor": "transparent"}, "data": [[24.3, 0], [24.2, 1], [22.0, 2]], "tooltip": {"formatter": "{a}：{@[0]}%"}}, {"name": "负样本 5%", "type": "scatter", "symbolSize": 11, "itemStyle": {"color": "var(--clay)"}, "z": 4, "label": {"show": true, "position": "right", "formatter": "{@[0]}%", "color": "var(--ink)", "textBorderColor": "transparent"}, "data": [[35.7, 0], [35.0, 1], [32.8, 2]], "tooltip": {"formatter": "{a}：{@[0]}%"}}, {"name": "5% + 先验修正", "type": "scatter", "symbolSize": 10, "itemStyle": {"color": "var(--paper)", "borderColor": "var(--clay)", "borderWidth": 2}, "z": 5, "label": {"show": true, "position": "top", "formatter": "{@[0]}%", "color": "var(--muted)", "fontSize": 10, "textBorderColor": "transparent"}, "data": [[27.3, 0], [24.6, 1]], "tooltip": {"formatter": "{a}：{@[0]}%"}}]}
```

另外，AR 原子在这个预算下没学会：RefCOCO val 只有 73.1，24.2% 的输出连格式都解析不出来。每个坐标值一个新 token，1,000 个新 embedding 要从零学，3,058 步不够。

这组实验改写了论文主张。我们**不能**说“门控在‘不在’上比自回归好”，数据不支持。能说的是：

1. 自回归头的拒答行为取决于解码规则：贪心下没问题，按序列概率比较时会过度拒答到 40%，这正是表面形式竞争。门控只有一个数，没有解码规则可选。
2. 幻觉主要由训练数据里负样本的比例和难度决定，和输出头关系不大。v0 → 27B → v1 的结果也是同一个结论。
3. 门控的价值在别处：一次前向、一个校准过的概率、8 个问题和 1 个问题一样快。

## 支线：Video-Index

我们还想把 Glance 当作视频 agent 的一个工具，去冲 Video-Index[@videoindex]。动手前先分析了 v1.1 上 21 个 agent 公开的运行记录（144 题），有三个发现：

- **一半以上的错误是感知错误。** 我们分层抽了 48 个失败的运行，按事先定好的规则手工标注：看错了（数错、认错、方向判断错）21 个，没看到 5 个，看错了时间段 1 个，合计 **27/48（56%，95% 置信区间 42%–69%）**。推理错误只有 8 个，题目答案本身有问题的 6 个。
- **答案偏向最后一个选项。** 144 题里有 59 题的答案是最后一个选项（41.0%，均匀分布下期望 24.8%）。“永远选最后一个”能拿 **41.0 分，排在 22 个参赛者里的第 5 名**。agent 们选最后一个选项的频率只有 17%–32%，并没有利用这个偏差，所以它更可能来自出题方式。任何 v1.1 上的结论都需要一个打乱选项顺序的对照。
- **评测框架的错误藏住了正确答案。** Codex 的 52 次 `technical_error` 里，51 次在最后一条消息里已经写好了答案字母，其中 24 个是对的。算上它们，GPT-6-Astra 会从 35.4 升到 41.0。

```data title="48 个失败运行的错误类型" bars="占比" note="Opus 5.5、Opus 5、Gemini 4 Argon、GPT-6-Astra 的错误或无答案运行，按 agent × 能力组分层抽样，每格 3 个。一个人标注，n 小，置信区间偏乐观。来源：video/analysis/failure_analysis.md。"
类型 | 个数 | 占比
看错了 | 21 | 43.8%
没看到 | 5 | 10.4%
时间段找错 | 1 | 2.1%
推理或知识 | 8 | 16.7%
超时或框架错误 | 7 | 14.6%
答案可疑 | 6 | 12.5%
```

具体看几道题。三张卡片分别是“看错了”“时间段找错”“没看到”，答案来自各 agent 的 `result.json`，备注来自我们读轨迹时的标注。题目保留原文；Video-Index 的视频只允许用于评测，所以这里不放任何画面。

```cases title="三种感知错误，各一道题" note="21 个 agent 的选择分布按 result.json 统计（空答案也算一个）。“没看到”那题的 1,100 张缩略图、“时间段找错”那题的时间都出自 agent 自己的轨迹。来源：video/analysis/trace_labels.json 和 Video-Index v1.1 的公开轨迹。"
## ALLVB_2121 电影 · 87 分钟 · 感知
tag: 看错了
q: … a woman is seen tending to a wounded person and later crawling through the muddy terrain while holding a gun. … What is the color of the woman's shirt in the scene?
答案 | ok | (E) Purple
Claude Opus 5.5 | bad | (B) Red
备注 | note | 找到了对的场景，把栗色（maroon）说成了红色；21 个 agent 里 9 个选了 Red
## S-EMBER_2431 第一人称 · 20 分钟 · 感知
tag: 时间段找错
q: How does this pair of shorts differ from the ones I just saw on the floor?
答案 | ok | (E) This pair of shorts is black and smaller, whereas the ones on the floor were navy blue.
Claude Opus 5.5 | bad | (C) This pair of shorts is olive-green on a hanger, whereas the ones on the floor were blue denim.
Gemini 4 Argon | ok | (E)，只看了最后约 60 秒
备注 | note | 问题是在视频结尾提出的。Opus 自己写下“她在 1185–1200 s 看的是黑色短裤，这会支持 E”，最后却锚定在 1174.5 s 那条挂着的橄榄绿短裤上
## ALLVB_429 电影 · 132 分钟 · 空间
tag: 没看到
q: What is the movement path of the prescription Elizabeth receives from her doctor?
答案 | ok | (C) From the doctor's hand to the trash can outside the office
Claude Opus 5 | bad | (B) From the doctor's hand to Elizabeth's purse
备注 | note | 翻了 1,100 张镜头缩略图，没找到处方被扔掉的那一刻，结论是医生从没出现在画面上；21 个 agent 里 11 个选了 B
```

“没看到”和“看错了”的边界，要把 agent 看过哪里画出来才分得清。下面这道计数题在标注里记作“没看到”：Gemini 4 Argon 数出 3 次，答案是 5 次。可把它实际抽帧的时间段和答对的 GPT-6-Astra 报告的 5 个时刻叠在一起，漏掉的两次（134 s、232 s）都落在 Argon 用 6 帧/秒细看过的窗口里：它看到了，只是没数对。

```sketch title="Argon 细看过那两次指向，只是没数到" note="S-EMBER_7291（第一人称，319 s，“我指了乐高盒子几次？”，答案 5 次，21 个 agent 里 4 个答对）。数据集没有逐次的时间标注，编号的 5 个时刻是答对的 GPT-6-Astra 自己写的“around 129, 132, 134, 232, and 249 seconds”；黑框是 Argon 自己写的 3 段指向。色带按轨迹里每条抽帧命令的时间范围和帧率画；Codex 的轨迹不记录看图事件，所以 Astra 一行是“抽出来的帧”，不一定都看过。只用时间，不含任何画面。来源：outputs/blog/coverage.json，由 outputs/blog/make_coverage_sketch.py 生成。"
<svg viewBox="0 0 704 392">
<rect class="panel" x="0" y="0" width="704" height="392" rx="12"/>
<text class="caps" x="24" y="30">整段视频 · 319 s</text>
<line class="edge" x1="176" y1="144" x2="680" y2="144"/>
<line class="edge" x1="176" y1="141" x2="176" y2="147"/><text class="small mid" x="176" y="158">0 s</text>
<line class="edge" x1="334" y1="141" x2="334" y2="147"/><text class="small mid" x="334" y="158">100 s</text>
<line class="edge" x1="492" y1="141" x2="492" y2="147"/><text class="small mid" x="492" y="158">200 s</text>
<line class="edge" x1="650" y1="141" x2="650" y2="147"/><text class="small mid" x="650" y="158">300 s</text>
<text class="small" x="24" y="62">回答正确者报告的指向</text>
<text x="24" y="92">Gemini 4 Argon</text>
<text x="24" y="120">GPT-6-Astra</text>
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
<text class="small" x="24" y="106">答 3 次</text><text class="small" x="24" y="134">答 5 次（正确）</text>
<text class="caps" x="24" y="210">放大 120–145 s</text>
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
<text class="caps" x="364" y="210">放大 225–258 s</text>
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
<circle cx="480" cy="359" r="6" fill="var(--clay)"/><text class="small" x="492" y="359">落在 Argon 细看过的窗口里，却没数到</text>
</svg>
<svg viewBox="0 0 340 560">
<rect class="panel" x="0" y="0" width="340" height="560" rx="12"/>
<text class="caps" x="16" y="28">整段视频 · 319 s</text>
<line class="edge" x1="96" y1="138" x2="320" y2="138"/>
<line class="edge" x1="96" y1="135" x2="96" y2="141"/><text class="small mid" x="96" y="152">0 s</text>
<line class="edge" x1="201.3" y1="135" x2="201.3" y2="141"/><text class="small mid" x="201.3" y="152">150 s</text>
<line class="edge" x1="306.7" y1="135" x2="306.7" y2="141"/><text class="small mid" x="306.7" y="152">300 s</text>
<text class="small" x="16" y="56">正确者报告</text>
<text x="16" y="86">Argon</text>
<text x="16" y="114">Astra</text>
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
<text class="small" x="16" y="100">答 3 次</text><text class="small" x="16" y="128">答 5 次 ✓</text>
<text class="caps" x="16" y="196">放大 120–145 s</text>
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
<text class="caps" x="16" y="340">放大 225–258 s</text>
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
<circle cx="24" cy="542" r="6" fill="var(--clay)"/><text class="small" x="40" y="542">在 Argon 细看的窗口里，没数到</text>
</svg>
```

第三个发现最好直接看一段轨迹的结尾。GPT-6-Astra 在这道题上最后一条消息已经给出了正确答案，评测框架却因为一条早先启动、没有返回的转写命令，把整次运行记成 `technical_error`：

```trace title="评测框架报错时，答案已经写好了" note="GPT-6-Astra（Codex）在 Video-Index v1.1 Video-MME_2411 上的运行，共 6 条命令，154.5 s。按 stdout.jsonl 摘录，省略处标 …；中间 2 条命令折叠，开头 2 条（ffprobe、抽结尾的帧和音频）没有列出。最后一行是 result.json 的字段。"
user | At the end of the video, why does James Corden sing a song with tears in his eyes?
  A. He was reluctant to leave this job.
  B. He expressed his satisfaction with the hard work of his colleagues.
  C. He felt touched by the work he had done over the years.
  D. He wept with joy at the achievements of the performance.
cmd | python - <<'PY'
  from faster_whisper import WhisperModel
  model=WhisperModel('<lab>/models/faster-whisper/large-v3',device='cpu',compute_type='int8',cpu_threads=8)
  segments,info=model.transcribe('scratch/end_audio.wav',language='en',beam_size=5,vad_filter=True)
  …
note | 在 CPU 上用 large-v3 转写最后 7 分钟音频。这条命令启动了，直到回合结束都没有返回
fold | 另外 2 条命令：画一张全片缩略图，查进程（失败）
cmd | python - <<'PY' … times=[20,300,600,900,1200,1500,1800,1980] … canvas.save('scratch/context_contact.jpg')
out | [exit 0]
cmd | ps -eo pid,etime,pcpu,pmem,cmd | grep -E '[p]ython -|[f]fmpeg'
out | Error, do this: mount -t proc proc /proc
end
cmd | ffmpeg -v error -ss 2170 -i input/video.mp4 -vn -ar 16000 -ac 1 scratch/song.wav && python -u - <<'PY' … WhisperModel('<lab>/models/faster-whisper/small' …
out | Loading model...
  Transcribing...
  [2170.00-2172.00]  1200 times in a row
  [2173.48-2175.48]  So good night
  [2175.52-2177.52]  Thanks for watching
  [2177.52-2179.52]  That's our show
  [2186.08-2189.48]  Now the last karaoke's been carpooled
  …
note | 换成 small 模型、只转写最后的歌，这次有了结果
ans | {"answer_letter":"A","reason":"He is emotional about leaving his hosting job, singing that part of him wants to “stay here forever” even though it is time to go."}
note | 最后一条消息给出 A，就是标准答案
error | status: technical_error · error: ValueError: unfinished tool activity at turn completion
note | 评分只看状态，这一题记为错。Codex 的 52 次 technical_error 里，51 次最后一条消息已经写好了答案字母
```

所以工具应该补感知。我们没有给 Glance 单独训练一个时间区间头，而是用 ffmpeg 把视频切成几秒长的小段，每段问一个 noul（“这一段里有没有 X”），得到一条 P(t) 曲线，再用阈值得到区间和次数。理由有三个：失败案例里最多的是数错次数和判断错方向，正好是逐段问是或否能直接回答的；它复用的是已经训练好、校准过的 noul，不用多训一个头；而且共享前缀让同一段上问多个问题几乎不加时间。只有需要精确起止时间（比如 Charades-STA 的 mIoU）时，才值得做专门的时间区间头。另外，Video-Index 的视频只允许用于评测，不能拿来训练。

下面是这个做法在一段许可明确的视频上的样子（不是 Video-Index 的题）：Big Buck Bunny 的前 8 分钟，每 8 秒取一帧，每帧在一次 prefill 里同时问 box 和 noul，P 不低于 0.5 的相邻帧连成区间。蝴蝶那条曲线给出 3 段，对照帧看，三段里都确实有蝴蝶；兔子那条在他出场的镜头里几乎都贴着 1。真正用在 Video-Index 上时，每一帧换成几秒长的一小段。

```echarts title="同一段视频上的两条 P(t)：兔子在不在，有没有蝴蝶" height="400" note="Glance-4B-preview，Big Buck Bunny 0–472 s 每 8 s 一帧（共 60 帧），MPS、fp32。上：box 问题 “the big white rabbit” 的 P(present)；下：noul 问题 “Is there a butterfly in this frame?” 的 P(yes)。色块是 P ≥ 0.5 的相邻帧，每帧按前后各 4 s 算。没有人工标注的真值区间。视频 © 2008 Blender Foundation，CC BY 3.0。原始输出：outputs/blog/glance_bbb.json。"
{"tooltip": {"trigger": "axis"}, "grid": [{"left": 44, "right": 16, "top": 28, "height": 120}, {"left": 44, "right": 16, "top": 232, "height": 120}], "xAxis": [{"type": "value", "gridIndex": 0, "min": 0, "max": 480, "interval": 60, "name": "", "nameLocation": "middle", "nameGap": 24, "axisLabel": {"formatter": "{value} s"}}, {"type": "value", "gridIndex": 1, "min": 0, "max": 480, "interval": 60, "name": "视频时间", "nameLocation": "middle", "nameGap": 24, "axisLabel": {"formatter": "{value} s"}}], "yAxis": [{"type": "value", "gridIndex": 0, "min": 0, "max": 1, "interval": 0.5, "name": "P(present)：the big white rabbit", "nameLocation": "end", "nameTextStyle": {"align": "left"}}, {"type": "value", "gridIndex": 1, "min": 0, "max": 1, "interval": 0.5, "name": "P(yes)：Is there a butterfly in this frame?", "nameLocation": "end", "nameTextStyle": {"align": "left"}}], "series": [{"name": "兔子 P(present)", "type": "line", "xAxisIndex": 0, "yAxisIndex": 0, "showSymbol": true, "symbolSize": 4, "lineStyle": {"width": 1.5}, "itemStyle": {"color": "var(--stone)"}, "data": [[0, 0.146], [8, 0.003], [16, 0.003], [24, 0.012], [32, 0.004], [40, 0.006], [48, 0.936], [56, 0.996], [64, 0.986], [72, 0.757], [80, 0.991], [88, 0.996], [96, 0.997], [104, 0.986], [112, 0.991], [120, 0.081], [128, 0.989], [136, 0.996], [144, 0.197], [152, 0.016], [160, 0.992], [168, 0.022], [176, 0.992], [184, 0.034], [192, 0.992], [200, 0.106], [208, 0.978], [216, 0.019], [224, 0.004], [232, 0.031], [240, 0.791], [248, 0.908], [256, 0.483], [264, 0.977], [272, 0.971], [280, 0.992], [288, 0.104], [296, 0.008], [304, 0.141], [312, 0.696], [320, 0.692], [328, 0.148], [336, 0.181], [344, 0.017], [352, 0.001], [360, 0.979], [368, 0.964], [376, 0.976], [384, 0.005], [392, 0.002], [400, 0.044], [408, 0.982], [416, 0.628], [424, 0.002], [432, 0.005], [440, 0.005], [448, 0.003], [456, 0.973], [464, 0.004], [472, 0.96]], "markLine": {"silent": true, "symbol": "none", "lineStyle": {"color": "var(--muted)", "type": "dashed"}, "label": {"formatter": "阈值 0.5", "position": "insideEndTop", "color": "var(--muted)"}, "data": [{"yAxis": 0.5}]}, "markArea": {"silent": true, "itemStyle": {"color": "var(--wash)"}, "data": [[{"xAxis": 44}, {"xAxis": 116}], [{"xAxis": 124}, {"xAxis": 140}], [{"xAxis": 156}, {"xAxis": 164}], [{"xAxis": 172}, {"xAxis": 180}], [{"xAxis": 188}, {"xAxis": 196}], [{"xAxis": 204}, {"xAxis": 212}], [{"xAxis": 236}, {"xAxis": 252}], [{"xAxis": 260}, {"xAxis": 284}], [{"xAxis": 308}, {"xAxis": 324}], [{"xAxis": 356}, {"xAxis": 380}], [{"xAxis": 404}, {"xAxis": 420}], [{"xAxis": 452}, {"xAxis": 460}], [{"xAxis": 468}, {"xAxis": 476}]]}}, {"name": "蝴蝶 P(yes)", "type": "line", "xAxisIndex": 1, "yAxisIndex": 1, "showSymbol": true, "symbolSize": 4, "lineStyle": {"width": 1.5}, "itemStyle": {"color": "var(--clay)"}, "data": [[0, 0.316], [8, 0.0], [16, 0.0], [24, 0.002], [32, 0.001], [40, 0.0], [48, 0.002], [56, 0.002], [64, 0.001], [72, 0.031], [80, 0.944], [88, 0.834], [96, 0.834], [104, 0.001], [112, 0.0], [120, 0.0], [128, 1.0], [136, 1.0], [144, 0.0], [152, 0.0], [160, 0.416], [168, 0.0], [176, 0.0], [184, 0.0], [192, 0.001], [200, 0.0], [208, 0.0], [216, 0.0], [224, 0.001], [232, 0.828], [240, 0.001], [248, 0.002], [256, 0.0], [264, 0.0], [272, 0.001], [280, 0.0], [288, 0.003], [296, 0.001], [304, 0.011], [312, 0.029], [320, 0.0], [328, 0.0], [336, 0.001], [344, 0.039], [352, 0.001], [360, 0.0], [368, 0.0], [376, 0.004], [384, 0.0], [392, 0.0], [400, 0.008], [408, 0.367], [416, 0.196], [424, 0.007], [432, 0.001], [440, 0.0], [448, 0.0], [456, 0.0], [464, 0.0], [472, 0.0]], "markLine": {"silent": true, "symbol": "none", "lineStyle": {"color": "var(--muted)", "type": "dashed"}, "label": {"formatter": "阈值 0.5", "position": "insideEndTop", "color": "var(--muted)"}, "data": [{"yAxis": 0.5}]}, "markArea": {"silent": true, "itemStyle": {"color": "var(--clay-wash)"}, "data": [[{"xAxis": 76}, {"xAxis": 100}], [{"xAxis": 124}, {"xAxis": 140}], [{"xAxis": 228}, {"xAxis": 236}]]}}]}
```

## 接下来

- **v1.1**：补上 v1 的退步。加更多高分辨率的 GUI 数据（OS-Atlas 的 Windows 桌面、GroundCUA、Jedi 等），提高自然图像的比例，把校准做得更细。
- **合成 GUI 数据**：在一台 30 核的 CPU 机器上，用 Xvfb 起虚拟桌面、打开真实的桌面软件（LibreOffice、GIMP、Inkscape、KiCad……），通过 AT-SPI 无障碍树拿到每个元素的位置。负样本对着完整的无障碍树核实过，确定屏幕上真的没有，而不是猜的。
- **27B 旗舰版**：把类型化原语和混合数据搬到 27B 上。
- **公开发布**：代码会放在 `github.com/Vision-Decision/Glance`，权重放在 Hugging Face 的 `aac6fef/Glance-4B-preview`，权重采用 CC-BY-NC 许可（训练数据里的 gRefCOCO 本身也只限非商用）。写这篇时两个仓库都还没公开。

回头看，这两天最有价值的不是哪个分数，而是三次“不一样”：27B 和 4B 在“不在”上一样，v0 在 COCO 和 GUI 上判若两模，门控和 AR 在贪心解码下打平。每一次都把我们从“模型/架构”推回到“数据”。

## 参考资料

- [@qwen35] Qwen Team (2026). [Qwen3.5: Towards Native Multimodal Agents](https://qwen.ai/blog?id=qwen3.5). _Qwen blog_, February 2026.
- [@opendecisions] Geuter, J., Cheng, A., & Alvarez-Melis, D. (2026). [Releasing the Inner Jev: A Simple Recipe for Open Decision Models](https://arxiv.org/abs/2610.17205). _arXiv preprint arXiv:2610.17205_.
- [@guiactor] Wu, Q., Cheng, K., Yang, R., et al. (2025). [GUI-Actor: Coordinate-Free Visual Grounding for GUI Agents](https://arxiv.org/abs/2506.03143). _Advances in Neural Information Processing Systems 38 (NeurIPS 2025)_.
- [@sam3] Carion, N., Gustafson, L., Hu, Y.-T., et al. (2026). [SAM 3: Segment Anything with Concepts](https://arxiv.org/abs/2511.16719). _International Conference on Learning Representations (ICLR 2026)_.
- [@gfl] Li, X., Wang, W., Wu, L., et al. (2020). [Generalized Focal Loss: Learning Qualified and Distributed Bounding Boxes for Dense Object Detection](https://arxiv.org/abs/2006.04388). _Advances in Neural Information Processing Systems 33 (NeurIPS 2020)_.
- [@grefcoco] Liu, C., Ding, H., & Jiang, X. (2023). [GRES: Generalized Referring Expression Segmentation](https://arxiv.org/abs/2306.00968). _IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR 2023)_.
- [@screenspotv2] Wu, Z., Wu, Z., Xu, F., et al. (2025). [OS-ATLAS: A Foundation Action Model for Generalist GUI Agents](https://arxiv.org/abs/2410.23218). _International Conference on Learning Representations (ICLR 2025)_.
- [@venusbench] Zhou, B., Huang, Z., Guo, Y., et al. (2025). [VenusBench-GD: A Comprehensive Multi-Platform GUI Benchmark for Diverse Grounding Tasks](https://arxiv.org/abs/2512.16501). _arXiv preprint arXiv:2512.16501_.
- [@screenspotpro] Li, K., Meng, Z., Lin, H., et al. (2025). [ScreenSpot-Pro: GUI Grounding for Professional High-Resolution Computer Use](https://arxiv.org/abs/2504.07981). _Proceedings of the 33rd ACM International Conference on Multimedia (MM '25)_.
- [@holtzman2021] Holtzman, A., West, P., Shwartz, V., Choi, Y., & Zettlemoyer, L. (2021). [Surface Form Competition: Why the Highest Probability Answer Isn't Always Right](https://doi.org/10.18653/v1/2021.emnlp-main.564). _Proceedings of EMNLP 2021_, 7038–7051.
- [@song2025] Song, X., & Bahri, D. (2025). [Decoding-based Regression](https://arxiv.org/abs/2501.19383). _Transactions on Machine Learning Research_.
- [@videoindex] Song, E., Xu, Y., Yang, S., Chai, W., & Gu, J. (2026). [Video-Index: A Curated Meta-Benchmark for Video Understanding](https://arxiv.org/abs/2610.00960). _arXiv preprint arXiv:2610.00960_.
