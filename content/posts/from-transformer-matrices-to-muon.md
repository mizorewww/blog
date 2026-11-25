---
title: "从 Transformer 的矩阵流转到现代优化器推导（SGD → AdamW → Muon）"
description: "从自回归语言模型的概率建模出发，厘清推理与训练中四类张量的职责与生命周期，逐步推导交叉熵与线性层反向传播、逐元素优化器的四代演进，以及基于算子谱范数与牛顿-舒尔茨迭代的矩阵优化器 Muon。"
date: 2026-11-24
tag: "技术"
tags:
  - "llm"
  - "ai"
  - "架构设计"
draft: false
---

在深度学习课程与真实工程代码之间，常常横着一道明显的断层。

讲网络结构的教材（如 Transformer[@vaswani2017]），满篇都是三维激活张量、多头子空间投影与注意力矩阵。而讲优化算法的章节（如 SGD[@robbins1951]、AdamW[@loshchilov2019]），却习惯把所有参数压扁成一条抽象的一维向量 $\theta \in \mathbb{R}^p$，只在二次曲面上讨论标量坐标的迭代。

一旦打开真正的大语言模型预训练代码，这两套叙述立刻就会撞在一起。显存里到底存了什么？为什么训练不用逐词循环？矩阵梯度怎么算，二维权重又该怎么更新？

本文沿着一条自底向上的推导主线，把这些分散在不同教材里的拼图逐一对齐，从头到尾推演一遍。

## 五个核心追问与全文推导脉络

全文围绕五个环环相扣的问题展开：

1. **显存里的“矩阵”各管什么？** 词嵌入表、$Q/K/V$ 投影权重、$T \times T$ 注意力表、`KV Cache`、梯度与动量缓冲区同时挤在显存里。哪些才是模型本体，哪些只是推理或训练途中的临时过客？
2. **为什么推理串行、训练并行，且训练显存高出好几倍？** 聊天生成必须一个词接一个词往外蹦，为什么训练代码里却没有逐词循环，能把整段话一次性喂进网络？
3. **标量损失怎么变回二维梯度矩阵？** 损失函数只输出一个数 $L \in \mathbb{R}$。`loss.backward()` 究竟做了什么矩阵运算，才为每块二维权重 $W$ 算出同形状的梯度 $G$？这张 $G$ 的奇异值分布又有什么隐患？
4. **逐元素优化器经历了哪四代演进？** 从 `SGD`、`Momentum`、`Adam` 到 `AdamW`，每一代公式各自修补了上一代的什么数学缺陷？冷启动偏差修正与解耦权重衰减又是怎么严格推出来的？
5. **二维矩阵优化器 `Muon` 凭什么超越逐元素方法？** 当参数本身是 $d_{\mathrm{out}} \times d_{\mathrm{in}}$ 的线性算子时，逐格缩放忽略了什么几何结构？`Muon`[@jordan2024][@liu2025] 如何从诱导算子范数导出半正交方向 $U V^\top$，又如何只用 5 次半精度矩阵乘法绕开奇异值分解？

我们将按四个阶段逐步回答这些问题。

第 1 节从自回归概率分解出发，把推理与训练涉及的全部张量归入四大家族。第 2 节推演单步训练的前向与反向传播，揭开线性层梯度矩阵的外积结构。

接着进入优化器核心。我们在“局部线性化 + 范数约束”的统一变分视角下，先推导四代逐元素优化器（第 3 节），再推导二维谱范数优化器 `Shampoo`、`Muon` 与月之暗面的规模化方案（第 4–5 节）。

最后，第 6–7 节用 GPU 屋顶线算力估算、受控对比实验与一份单文件可运行的 PyTorch 代码收尾闭环。

## 全局鸟瞰：先在一张图上看清模型、推理、训练与优化器的关系

在进入局部公式之前，我们先建立一幅全局地图。

一座大语言模型的本体其实非常单纯：它只是一组形状固定、持久化在磁盘与显存里的**静态参数矩阵 $\Theta$**。其中包括首尾负责词表转换的 $E_{\mathrm{tok}}$ 与 $W_{\mathrm{head}}$，中间堆叠 $L$ 层的二维线性变换 $W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}$，以及一维缩放向量 $\gamma$。

围绕同一组参数 $\Theta$，**推理**与**训练**走的是两条截然不同的数据流：

- **推理是只读的单向流水线**（第 1 节）。参数 $\Theta$ 全程冻结不动。输入提示词先走 `Prefill` 阶段做整段矩阵乘法，把历史键值存进 `KV Cache`；随后的 `Decode` 阶段每步只送入 1 行新词向量做向量乘矩阵，逐词采样生成回复。中间激活算完即焚，绝不留存。
- **训练是改写参数的四步闭环**（第 2–5 节）。**① 前向并行（Forward）** 整句同时算完，但必须把各层激活 $X$ 留在显存里备用。**② 交叉熵损失（Loss）** 将全句预测误差压成一个标量 $L$。**③ 反向传播（Backward）** 靠矩阵乘 $G = \Delta^\top X$ 消去样本词元维，算出与每块权重同形状的梯度 $G$。**④ 优化器更新（Optimizer Step）** 结合 $G$ 与历史状态改写 $\Theta$：首尾词表层交给逐元素自适应的 `AdamW`（第 3 节），占非词表参数 $95\%$ 以上的内部二维线性层则交给谱正交化的 `Muon`（第 4–5 节）。

```sketch title="大语言模型全局鸟瞰：同一组静态参数 $\Theta$ 在只读推理单向流与训练四步闭环中的位置" note="蓝色为模型静态参数 $\Theta$；青色为动态激活；紫色为推理键值缓存或优化器动量状态；橙色为反向传播算出的梯度矩阵。"
<svg viewBox="0 0 704 292">
  <rect class="panel" x="0" y="0" width="216" height="292" rx="12"/>
  <text class="caps" x="18" y="24">INFERENCE · 只读推理单向流</text>
  <g class="node clay"><rect x="18" y="42" width="180" height="32" rx="16"/><text class="mid b" x="108" y="58">输入提示词前缀序列</text></g>
  <path class="edge" d="M108 74 V92" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="18" y="96" width="180" height="44" rx="6"/><text class="mid b" x="108" y="111">1. Prefill 预填充 (GEMM)</text><text class="mid small" x="108" y="129">多行并行投影，激活算完即释</text></g>
  <path class="edge" d="M108 140 V158" marker-end="url(#arrow)"/>
  <g class="node violet"><rect x="18" y="162" width="180" height="44" rx="6"/><text class="mid b" x="108" y="177">2. 维护推理 KV Cache</text><text class="mid small" x="108" y="195">缓存历史键值，每步长高 1 行</text></g>
  <path class="edge" d="M108 206 V224" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="18" y="228" width="180" height="46" rx="6"/><text class="mid b" x="108" y="244">3. Decode 逐词解码 (GEMV)</text><text class="mid small" x="108" y="262">单行新词向量采样下一词</text></g>

  <rect class="panel" x="240" y="0" width="224" height="292" rx="12"/>
  <text class="caps" x="258" y="24">MODEL · 静态参数矩阵 Θ</text>
  <g class="node blue"><rect x="258" y="42" width="188" height="54" rx="6"/><text class="mid b" x="352" y="59">首尾边界查表与打分层</text><tex class="mid small" x="352" y="81">E_{\mathrm{tok}},\; W_{\mathrm{head}} \in \mathbb{R}^{V \times D}</tex></g>
  <g class="node blue"><rect x="258" y="108" width="188" height="78" rx="6"/><text class="mid b" x="352" y="126">内部 L 层二维线性算子</text><tex class="mid small" x="352" y="149">W_{q,k,v,o} \in \mathbb{R}^{D \times D}</tex><tex class="mid small" x="352" y="171">W_{\mathrm{up}}, W_{\mathrm{down}} \in \mathbb{R}^{4D \times D}</tex></g>
  <g class="node plain"><rect x="258" y="198" width="188" height="44" rx="6"/><text class="mid b" x="352" y="213">一维归一化通道缩放</text><tex class="mid small" x="352" y="231">\gamma \in \mathbb{R}^D</tex></g>
  <text class="mid small b" x="352" y="268">推理阶段只读 · 训练阶段被改写</text>

  <path class="edge dash" d="M240 118 H202" marker-end="url(#arrow)"/>
  <path class="edge dash" d="M240 250 H202" marker-end="url(#arrow)"/>
  <text class="mid small" x="221" y="108">只读</text>

  <rect class="panel" x="488" y="0" width="216" height="292" rx="12"/>
  <text class="caps" x="506" y="24">TRAINING · 训练四步闭环</text>
  <g class="node teal"><rect x="506" y="42" width="180" height="46" rx="6"/><text class="mid b" x="596" y="57">1. Forward 整句并行</text><text class="mid small" x="596" y="75">留存激活 X 供反向求导</text></g>
  <path class="edge" d="M596 88 V104" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="506" y="108" width="180" height="34" rx="17"/><text class="mid b" x="596" y="125">2. 交叉熵归约为标量 L</text></g>
  <path class="edge" d="M596 142 V158" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="506" y="162" width="180" height="48" rx="6"/><text class="mid b" x="596" y="178">3. Backward 反向求导</text><tex class="mid small" x="556" y="198">G = \Delta^\top X</tex><text class="small" x="592" y="198">（消去词元维）</text></g>
  <path class="edge" d="M596 210 V226" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="506" y="230" width="180" height="48" rx="6"/><text class="mid b" x="596" y="246">4. 优化器分流更新 step()</text><text class="mid small" x="596" y="265">AdamW (边界) + Muon (内部)</text></g>

  <path class="edge dash" d="M464 65 H502" marker-end="url(#arrow)"/>
  <path class="edge hot" d="M506 254 H468" marker-end="url(#arrow)"/>
  <text class="mid small accent" x="486" y="244">改写</text>
</svg>
<svg viewBox="0 0 340 508">
  <rect class="panel" x="0" y="0" width="340" height="148" rx="12"/>
  <text class="caps" x="16" y="24">MODEL · 静态参数矩阵 Θ</text>
  <g class="node blue"><rect x="16" y="38" width="148" height="50" rx="6"/><text class="mid b" x="90" y="54">边界查表与打分层</text><tex class="mid small" x="90" y="75">E_{\mathrm{tok}}, W_{\mathrm{head}}</tex></g>
  <g class="node blue"><rect x="174" y="38" width="150" height="50" rx="6"/><text class="mid b" x="249" y="54">内部二维线性算子</text><tex class="mid small" x="249" y="75">W_{q..o}, W_{\mathrm{up}}, W_{\mathrm{down}}</tex></g>
  <text class="small b" x="16" y="114">尺寸仅由架构超参数决定，权重文件唯一保存对象</text>
  <text class="small" x="16" y="134">推理阶段只读冻结 · 训练阶段由双优化器分流改写</text>

  <rect class="panel" x="0" y="162" width="340" height="150" rx="12"/>
  <text class="caps" x="16" y="186">INFERENCE · 只读推理单向流（第 1 节）</text>
  <g class="node teal"><rect x="16" y="200" width="144" height="44" rx="6"/><text class="mid b" x="88" y="215">1. Prefill (GEMM)</text><text class="mid small" x="88" y="233">整段前缀并行投影</text></g>
  <path class="edge" d="M160 222 H178" marker-end="url(#arrow)"/>
  <g class="node violet"><rect x="182" y="200" width="142" height="44" rx="6"/><text class="mid b" x="253" y="215">2. KV Cache</text><text class="mid small" x="253" y="233">保存历史键值</text></g>
  <path class="edge" d="M253 244 V258 H170 V262" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="16" y="264" width="308" height="34" rx="17"/><text class="mid b" x="170" y="281">3. Decode 单行向量乘 (GEMV) 逐词采样输出</text></g>

  <rect class="panel" x="0" y="326" width="340" height="182" rx="12"/>
  <text class="caps" x="16" y="350">TRAINING · 训练四步闭环（第 2–5 节）</text>
  <g class="node teal"><rect x="16" y="364" width="144" height="44" rx="6"/><text class="mid b" x="88" y="379">1. Forward 并行</text><text class="mid small" x="88" y="397">留存各层激活 X</text></g>
  <path class="edge" d="M160 386 H178" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="182" y="364" width="142" height="44" rx="22"/><text class="mid b" x="253" y="379">2. 交叉熵损失</text><text class="mid small" x="253" y="397">汇总为标量 L</text></g>
  <path class="edge" d="M253 408 V424 H90 V428" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="16" y="430" width="148" height="56" rx="6"/><text class="mid b" x="90" y="448">3. Backward 缩并</text><tex class="mid small" x="90" y="470">G = \Delta^\top X</tex></g>
  <path class="edge hot" d="M164 458 H180" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="184" y="430" width="140" height="56" rx="6"/><text class="mid b" x="254" y="448">4. 分流改写 Θ</text><text class="mid small" x="254" y="470">AdamW + Muon</text></g>
</svg>
```

---

## 一、从自回归概率分解到显存里的四类张量

### 1.1 语言模型在算什么：条件概率链式法则与向量化嵌入

设词表 $\mathcal{V} = \{0, 1, \dots, V-1\}$ 包含 $V$ 个离散词元（Token）。给定一段长度为 $T$ 的词元序列 $x_{1:T} = (x_1, x_2, \dots, x_T) \in \mathcal{V}^T$，概率论的乘法链式法则可以把联合概率精确拆成条件概率的连乘积：

$$
p_\Theta(x_1, x_2, \dots, x_T) = \prod_{t=1}^{T} p_\Theta(x_t \mid x_1, \dots, x_{t-1})
$$

这个分解不依赖任何独立性近似。式中的 $\Theta$ 代表模型全体可学习参数的集合。

大语言模型的任务由此变得非常明确：构造一个由 $\Theta$ 参数化的函数，吃进前缀序列 $x_{1:t}$，输出词表上全部 $V$ 个候选词的未归一化对数打分（Logits）$z_t \in \mathbb{R}^V$。随后经过 Softmax，打分就变成合法的下一词概率分布：

$$
p_\Theta(x_{t+1} = k \mid x_{1:t}) = \frac{\exp(z_{t,k})}{\sum_{m=0}^{V-1} \exp(z_{t,m})}, \qquad k \in \{0, \dots, V-1\}
$$

问题在于，离散整数编号只是字典里的门牌号——编号 `500` 并不代表编号 `250` 的两倍，微积分里的导数也没法对整数求导。

因此，网络入口必须先放一张词嵌入矩阵 $E_{\mathrm{tok}} \in \mathbb{R}^{V \times D}$，把每个整数编号 $x_t$ 映射成连续空间 $\mathbb{R}^D$ 里的第 $x_t$ 行向量。如果把编号 $x_t$ 写成仅第 $x_t$ 位为 $1$ 的独热（One-Hot）列向量 $u_{x_t} \in \{0,1\}^V$，按行查表在代数上就等价于一次稀疏矩阵乘法 $u_{x_t}^\top E_{\mathrm{tok}} \in \mathbb{R}^{1 \times D}$。

光有词向量还不够。自注意力里的向量内积天生对词序“脸盲”（置换等变）：如果不注入位置信息，“猫追狗”和“狗追猫”算出来的只是同一组行向量调换了顺序，模型根本分不清谁追谁。

所以，我们还要加上编码座位顺序的位置表示 $E_{\mathrm{pos}} \in \mathbb{R}^{T \times D}$，合成初始状态矩阵 $X^{(0)} \in \mathbb{R}^{T \times D}$。当一个批次同时处理 $B$ 条序列时，它就叠成三维张量 $\mathbb{R}^{B \times T \times D}$。

从这儿往后，每一层算出的特征增量都通过加法 $X \leftarrow X + \mathrm{Sublayer}(X)$ 汇回这条主干张量。这条贯通首尾的高速公路，就叫做**残差流（Residual Stream）**。

### 1.2 单层 Transformer 的前向方程

现代主流开源大模型（如 Llama、Qwen、DeepSeek 系列）普遍采用无偏置的 Pre-RMSNorm 解码器结构[@vaswani2017][@zhang2019]。

以单条序列的残差流矩阵 $X \in \mathbb{R}^{T \times D}$ 为例。在进入每个子层前，我们先对每一行词向量 $x \in \mathbb{R}^D$ 做均方根归一化 $\mathrm{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{D}\sum_{i=1}^D x_i^2 + \epsilon}} \odot \gamma$。其中 $\epsilon > 0$ 防止除零，$\gamma \in \mathbb{R}^D$ 是可学习的逐通道缩放向量，$\odot$ 表示按位逐元素相乘（它的反向正交性质将在 2.1 节推导）。

每一层 Transformer 由一前一后两个子层串联而成。

**第一子层是多头因果自注意力（Multi-Head Causal Self-Attention）。** 先对残差流逐行归一化得到 $H = \mathrm{RMSNorm}(X) \in \mathbb{R}^{T \times D}$，再用三块线性投影矩阵分别算出查询（Query）、键（Key）和值（Value）：

$$
Q = H W_q^\top, \qquad K = H W_k^\top, \qquad V_{\mathrm{val}} = H W_v^\top
$$

这里 $W_q, W_k, W_v$ 的形状都是 $\mathbb{R}^{D \times D}$。

为什么要切分成“多头”？如果直接在整个 $D$ 维空间上只做一次内积，每个词每一步就只能拿出一组注意力权重，很难同时兼顾指代消解、句法修饰和局部词组搭配。

于是，模型把隐藏维 $D$ 均分成 $H_{\mathrm{head}}$ 个并行的低维子空间（注意力头），每个头的宽度为 $d_k = D / H_{\mathrm{head}}$。在批量代码中，形状为 $(B, T, D)$ 的张量先重排成 $(B, T, H_{\mathrm{head}}, d_k)$，再交换中间两维变成 $(B, H_{\mathrm{head}}, T, d_k)$。

对单条样本第 $h$ 个头的切片 $Q^{(h)}, K^{(h)}, V_{\mathrm{val}}^{(h)} \in \mathbb{R}^{T \times d_k}$，缩放点积因果注意力的计算分三步完成：

$$
S^{(h)} = \frac{Q^{(h)} \bigl(K^{(h)}\bigr)^\top}{\sqrt{d_k}} + M_{\mathrm{causal}}, \qquad P^{(h)} = \mathrm{softmax}\!\left(S^{(h)}\right), \qquad O^{(h)} = P^{(h)} V_{\mathrm{val}}^{(h)}
$$

式中的打分矩阵 $S^{(h)}$ 与概率矩阵 $P^{(h)}$ 都是 $T \times T$ 方阵。因果掩码 $M_{\mathrm{causal}} \in \{0, -\infty\}^{T \times T}$ 在主对角线及左下方（$i \ge j$）填 $0$，在主对角线右上方（$i < j$，代表第 $i$ 个词偷看未来第 $j$ 个词）填 $-\infty$。

因为 $\exp(-\infty) = 0$，按行做完 Softmax 后，$P^{(h)}$ 严格变成下三角随机矩阵。第 $i$ 行的输出由此被严格限制为只能融合前 $i$ 个位置的信息。

这里有一个经典细节：为什么要除以 $\sqrt{d_k}$？

不妨设查询向量 $q \in \mathbb{R}^{d_k}$ 与键向量 $k \in \mathbb{R}^{d_k}$ 的各分量相互独立，均值为 $0$、方差为 $1$。那么每一项乘积满足 $\mathbb{E}[q_m k_m] = 0$ 且 $\mathrm{Var}(q_m k_m) = 1$，把 $d_k$ 项加起来，内积的总方差就随维度线性膨胀：

$$
\mathrm{Var}(q^\top k) = \sum_{m=1}^{d_k} \mathrm{Var}(q_m k_m) = d_k
$$

如果不除以 $\sqrt{d_k}$，当 $d_k = 64$ 或 $128$ 时，内积的标准差会涨到 $8 \sim 11.3$。同一行里的最大打分会远远甩开其余位置，把 Softmax 输出 $P_{i,a} = e^{S_{i,a}} / \sum_c e^{S_{i,c}}$ 挤成近乎“某一项为 $1$、其余全为 $0$”的尖锐分布。

这在反向传播时是致命的。直接求偏导可知，Softmax 的雅可比矩阵元素为 $\partial P_{i,a} / \partial S_{i,b} = P_{i,a}(\delta_{ab} - P_{i,b})$（克罗内克符号 $\delta_{ab}$ 仅在 $a=b$ 时为 $1$）。一旦 $P$ 饱和到非 $0$ 即 $1$，无论对角线还是非对角线，这个导数都会全部归零，梯度当场消失[@vaswani2017]。除以 $\sqrt{d_k}$ 正好把内积方差拉回 $1$，让 Softmax 留在梯度充沛的温和区间。

算完各头输出后，我们把全部 $H_{\mathrm{head}}$ 个头沿最后一维拼回 $O = [O^{(1)}, \dots, O^{(H_{\mathrm{head}})}] \in \mathbb{R}^{T \times D}$，右乘输出投影 $W_o^\top$（$W_o \in \mathbb{R}^{D \times D}$），再加回残差支路：$X' = X + O W_o^\top$。

**第二子层是位置前馈网络（Position-wise FFN / MLP）。** 先对 $X'$ 再次做归一化 $H' = \mathrm{RMSNorm}(X')$。随后依次经过升维矩阵 $W_{\mathrm{up}} \in \mathbb{R}^{d_{\mathrm{ff}} \times D}$（常取 $d_{\mathrm{ff}} = 4D$）、逐元素非线性激活 $\sigma(\cdot)$（如 $\mathrm{SiLU}(z) = z / (1 + e^{-z})$）以及降维矩阵 $W_{\mathrm{down}} \in \mathbb{R}^{D \times d_{\mathrm{ff}}}$，最后加回残差流：

$$
X_{\mathrm{out}} = X' + \sigma(H' W_{\mathrm{up}}^\top) W_{\mathrm{down}}^\top
$$

当信号穿过全部 $L$ 层解码器后，末端归一化输出再右乘词表分类头 $W_{\mathrm{head}}^\top$（$W_{\mathrm{head}} \in \mathbb{R}^{V \times D}$），就得到整段序列的预测打分矩阵 $Z \in \mathbb{R}^{T \times V}$。

> **关于 PyTorch `nn.Linear` 权重形状的说明**：调用 `nn.Linear(in_features=64, out_features=256, bias=False)` 时，内部 `.weight` 的存储形状其实是反过来的 `(256, 64)`，即 $(d_{\mathrm{out}}, d_{\mathrm{in}})$，前向执行的是 $H W^\top$。原因在于 C/CUDA 数组按行连续存储（Row-Major）：把每个输出神经元对应的 $d_{\mathrm{in}}$ 个权重排成连续一行，算内积时就能顺着内存连续读取。后文写任意二维权重 $W \in \mathbb{R}^{A \times B}$ 时，一律与 PyTorch 保持一致，记行数 $A = d_{\mathrm{out}}$、列数 $B = d_{\mathrm{in}}$。

### 1.3 显存中的四类张量家族

回头看上面这一串前向方程，登场的二维与高维数组在口语里常被统称为“矩阵”。但只要按数学职责、形状依赖和存活周期拆开看，它们其实分属四个截然不同的家族：

```sketch title="显存中四类张量家族的数学职责与生命周期" note="静态参数形状仅由模型超参数决定；动态激活形状随批大小 B 与序列长 T 变化；KV Cache 仅在自回归解码时逐词追加；梯度与优化器状态仅在训练阶段与参数成套分配。"
<svg viewBox="0 0 704 268">
  <rect class="panel" x="0" y="0" width="344" height="124" rx="12"/>
  <text class="caps" x="20" y="25">FAMILY 1 · PARAMETERS</text>
  <g class="node blue"><rect x="20" y="38" width="144" height="36" rx="4"/><text class="mid b" x="92" y="56">静态参数矩阵</text></g>
  <g class="node plain"><rect x="174" y="38" width="150" height="36" rx="4"/><tex class="mid" x="249" y="56">W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}</tex></g>
  <text class="small" x="20" y="94">尺寸仅由架构常数决定，与输入句长 T 无关</text>
  <text class="small b" x="20" y="112">推理阶段只读固定 · 训练阶段唯一被优化器更新的对象</text>

  <rect class="panel" x="360" y="0" width="344" height="124" rx="12"/>
  <text class="caps" x="380" y="25">FAMILY 2 · ACTIVATIONS</text>
  <g class="node teal"><rect x="380" y="38" width="136" height="36" rx="4"/><text class="mid b" x="448" y="56">动态激活张量</text></g>
  <g class="node plain"><rect x="526" y="38" width="158" height="36" rx="4"/><tex class="mid" x="605" y="56">X \in \mathbb{R}^{B \times T \times D},\; P \in \mathbb{R}^{T \times T}</tex></g>
  <text class="small" x="380" y="94">随每次输入的样本与词元位置即时算出（含注意力表 P）</text>
  <text class="small b" x="380" y="112">推理阶段逐层释放 · 训练前向须保留以供反向求导</text>

  <rect class="panel" x="0" y="140" width="344" height="128" rx="12"/>
  <text class="caps" x="20" y="165">FAMILY 3 · INFERENCE CACHE</text>
  <g class="node violet"><rect x="20" y="178" width="136" height="36" rx="4"/><text class="mid b" x="88" y="196">推理键值缓存</text></g>
  <g class="node plain"><rect x="166" y="178" width="158" height="36" rx="4"/><tex class="mid" x="245" y="196">K_{\mathrm{cache}} \in \mathbb{R}^{B \times H \times t \times d_k}</tex></g>
  <text class="small" x="20" y="234">自回归解码时保存历史词元的键与值，每步追加 1 行</text>
  <text class="small b" x="20" y="252">仅推理阶段常驻 · 训练阶段整句并行故无需分配</text>

  <rect class="panel" x="360" y="140" width="344" height="128" rx="12"/>
  <text class="caps" x="380" y="165">FAMILY 4 · TRAINING STATES</text>
  <g class="node clay"><rect x="380" y="178" width="136" height="36" rx="4"/><text class="mid b" x="448" y="196">梯度与状态表</text></g>
  <g class="node plain"><rect x="526" y="178" width="158" height="36" rx="4"/><tex class="mid" x="605" y="196">G, M, V \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}</tex></g>
  <text class="small" x="380" y="234">为每块参数配套分配同形状的梯度 G、一阶矩 M 与二阶矩 V</text>
  <text class="small accent" x="380" y="252">仅训练阶段驻留 · Muon 可省去内部二维层的二阶矩 V</text>
</svg>
<svg viewBox="0 0 340 524">
  <rect class="panel" x="0" y="0" width="340" height="120" rx="12"/>
  <text class="caps" x="16" y="24">1 · PARAMETERS</text>
  <g class="node blue"><rect x="16" y="36" width="132" height="34" rx="4"/><text class="mid b" x="82" y="53">静态参数权重</text></g>
  <g class="node plain"><rect x="156" y="36" width="168" height="34" rx="4"/><tex class="mid" x="240" y="53">W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}</tex></g>
  <text class="small" x="16" y="90">尺寸与句长无关，权重文件唯一保存的对象</text>
  <text class="small b" x="16" y="108">推理只读 · 训练由优化器更新</text>

  <rect class="panel" x="0" y="132" width="340" height="120" rx="12"/>
  <text class="caps" x="16" y="156">2 · ACTIVATIONS</text>
  <g class="node teal"><rect x="16" y="168" width="132" height="34" rx="4"/><text class="mid b" x="82" y="185">动态激活张量</text></g>
  <g class="node plain"><rect x="156" y="168" width="168" height="34" rx="4"/><tex class="mid" x="240" y="185">X,\; P \in \mathbb{R}^{T \times T}</tex></g>
  <text class="small" x="16" y="222">随输入即时算出，含注意力概率矩阵 P</text>
  <text class="small b" x="16" y="240">推理算完释放 · 训练保留供反向求导</text>

  <rect class="panel" x="0" y="264" width="340" height="120" rx="12"/>
  <text class="caps" x="16" y="288">3 · INFERENCE CACHE</text>
  <g class="node violet"><rect x="16" y="300" width="132" height="34" rx="4"/><text class="mid b" x="82" y="317">推理 KV 缓存</text></g>
  <g class="node plain"><rect x="156" y="300" width="168" height="34" rx="4"/><tex class="mid" x="240" y="317">K_{\mathrm{cache}} \in \mathbb{R}^{B \times H \times t \times d_k}</tex></g>
  <text class="small" x="16" y="354">自回归解码保存前文键值，每步长高 1 行</text>
  <text class="small b" x="16" y="372">仅推理常驻 · 训练阶段不分配</text>

  <rect class="panel" x="0" y="396" width="340" height="128" rx="12"/>
  <text class="caps" x="16" y="420">4 · TRAINING STATES</text>
  <g class="node clay"><rect x="16" y="432" width="132" height="34" rx="4"/><text class="mid b" x="82" y="449">梯度与状态表</text></g>
  <g class="node plain"><rect x="156" y="432" width="168" height="34" rx="4"/><tex class="mid" x="240" y="449">G, M, V \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}</tex></g>
  <text class="small" x="16" y="486">每块参数配套同形状的梯度 G、动量 M、二阶矩 V</text>
  <text class="small accent" x="16" y="506">Muon 省去内部二维层的整张二阶矩 V 表</text>
</svg>
```

初学者最容易混淆的一对矩阵，是**投影权重 $W_q, W_k \in \mathbb{R}^{D \times D}$** 与**注意力概率矩阵 $P \in \mathbb{R}^{T \times T}$**。

$W_q, W_k$ 属于第一类静态参数。不管输入句子有 4 个词还是 4096 个词，它们的形状永远锁死在 $D \times D$；训练时优化器真正动手修改的，也正是这些静态权重。

而 $P$ 属于第二类动态激活。它的边长会跟着当前句子的词数 $T$ 伸缩，仅仅记录了这一句话内部各位置的临时对齐权重——既不会写进模型权重文件，也绝不会被优化器直接更新。

```sketch title="投影参数矩阵 $W_q, W_k$ 与动态注意力矩阵 $P$ 的职责对比" note="参数矩阵 $W_q, W_k$ 的维度固定为 $(D, D)$，承载跨样本共享的子空间映射；注意力矩阵 $P$ 的维度为 $(T, T)$，仅反映单条输入序列内部词元间的临时对齐权重。"
<svg viewBox="0 0 704 202">
  <rect class="panel" x="0" y="0" width="340" height="202" rx="12"/>
  <text class="small b" x="24" y="28">第一类静态参数：查询与键投影矩阵</text>
  <g class="node blue"><rect x="24" y="46" width="144" height="58" rx="6"/><tex class="mid" x="96" y="65">W_q,\; W_k</tex><tex class="mid small" x="96" y="88">\mathbb{R}^{D \times D}\;(64 \times 64)</tex></g>
  <path class="edge" d="M168 75 H198" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="202" y="46" width="114" height="58" rx="6"/><text class="mid b" x="259" y="66">由优化器更新</text><text class="mid small" x="259" y="88">持久化至权重文件</text></g>
  <text class="small" x="24" y="134">形状由隐藏维 D 唯一决定，与序列长度 T 无关</text>
  <text class="small b" x="24" y="156">定义如何将隐状态投影到查询与键子空间</text>
  <text class="small" x="24" y="178">属于第四节中矩阵谱优化器 Muon 的核心作用对象</text>

  <rect class="panel" x="364" y="0" width="340" height="202" rx="12"/>
  <text class="small b" x="388" y="28">第二类动态激活：因果注意力概率矩阵</text>
  <g class="node plain"><rect x="388" y="46" width="152" height="58" rx="6"/><tex class="mid" x="464" y="65">P = \mathrm{softmax}(S)</tex><tex class="mid small" x="464" y="88">\mathbb{R}^{T \times T}</tex></g>
  <path class="edge hot" d="M540 75 H568" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="572" y="46" width="108" height="58" rx="6"/><text class="mid b" x="626" y="66">前向临时生成</text><text class="mid small" x="626" y="88">非可训练参数</text></g>
  <text class="small" x="388" y="134">输入 4 词则为 4×4，输入 100 词则变为 100×100</text>
  <text class="small accent" x="388" y="156">主对角线上方因因果掩码恒为 0，步后即释放</text>
  <text class="small" x="388" y="178">反向传播仅借它回传误差以求得参数梯度</text>
</svg>
<svg viewBox="0 0 340 380">
  <rect class="panel" x="0" y="0" width="340" height="180" rx="12"/>
  <text class="small b" x="16" y="26">第一类参数：投影矩阵</text>
  <g class="node blue"><rect x="16" y="42" width="146" height="54" rx="6"/><tex class="mid" x="89" y="60">W_q,\; W_k</tex><tex class="mid small" x="89" y="82">\mathbb{R}^{D \times D}</tex></g>
  <path class="edge" d="M162 69 H188" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="192" y="42" width="132" height="54" rx="6"/><text class="mid b" x="258" y="61">优化器更新</text><text class="mid small" x="258" y="81">写入权重文件</text></g>
  <text class="small" x="16" y="124">维度固定为 D×D，与输入序列长度 T 无关</text>
  <text class="small b" x="16" y="146">内部二维投影层归 Muon 正交化更新</text>

  <rect class="panel" x="0" y="196" width="340" height="184" rx="12"/>
  <text class="small b" x="16" y="222">第二类激活：注意力矩阵</text>
  <g class="node plain"><rect x="16" y="238" width="146" height="54" rx="6"/><tex class="mid" x="89" y="256">P = \mathrm{softmax}(S)</tex><tex class="mid small" x="89" y="278">\mathbb{R}^{T \times T}</tex></g>
  <path class="edge hot" d="M162 265 H188" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="192" y="238" width="132" height="54" rx="6"/><text class="mid b" x="258" y="257">前向临时算出</text><text class="mid small" x="258" y="277">非可训练参数</text></g>
  <text class="small" x="16" y="320">维度随序列长度 T 变化，步后立即销毁</text>
  <text class="small accent" x="16" y="342">上三角恒为 0，保证当前位置不读取未来词元</text>
</svg>
```

以本文后续代码使用的迷你模型（批大小 $B=20$、句长 $T=16$、隐藏维 $D=64$、头数 $H=4$、单头维 $d_k=16$、词表 $V=1000$）对照工业级 7B 模型，全流程涉及的 14 类张量可归纳如下：

```data title="Transformer 推理与训练全流程 14 类张量对照表" mark="注意力投影 $W_q \dots W_o$,前馈层 $W_{\mathrm{up}} / W_{\mathrm{down}}$" note="工业级模型（如 Llama 3 / Qwen）常采用分组查询注意力 GQA 缩减 $W_k, W_v$ 的输出行数以压缩 KV Cache，并在前馈层增加门控矩阵 $W_{\mathrm{gate}}$ 构成 SwiGLU；这些权重依然是稠密二维线性算子。"
张量与符号 | 所属家族 | 迷你模型形状 | 7B 级典型形状 | 推理阶段 | 训练阶段
输入与目标 $x, y$ | 样本索引 | $(20, 16)$ | $(B, 4096)$ | 仅输入前缀 | 错位 1 词配对
词嵌入 $E_{\mathrm{tok}}$ | ① 静态参数 | $(1000, 64)$ | $(128256, 4096)$ | 只读按行查表 | AdamW 更新
位置嵌入 $E_{\mathrm{pos}}$ | ① 静态参数 | $(32, 64)$ | 旋转编码无参 | 只读广播相加 | AdamW 更新
注意力投影 $W_q \dots W_o$ | ① 静态参数 | 4 张 $(64, 64)$ | $(4096, 4096)$ | 只读线性投影 | Muon 正交更新
前馈层 $W_{\mathrm{up}} / W_{\mathrm{down}}$ | ① 静态参数 | $(256,64)/(64,256)$ | $(11008, 4096)$ | 只读特征变换 | Muon 正交更新
归一化缩放 $\gamma$ | ① 静态参数 | $(64,)$ 一维 | $(4096,)$ 一维 | 只读通道缩放 | AdamW (无衰减)
输出打分头 $W_{\mathrm{head}}$ | ① 静态参数 | $(1000, 64)$ | $(128256, 4096)$ | 只读末位打分 | AdamW 更新
残差与归一化 $X, H$ | ② 动态激活 | $(20, 16, 64)$ | $(B, T, 4096)$ | 算完逐层释放 | 保留供反向求导
多头键值 $Q, K, V_{\mathrm{val}}$ | ② 动态激活 | $(20, 4, 16, 16)$ | $(B, 32, T, 128)$ | 算完逐层释放 | 保留供反向求导
注意力矩阵 $S, P$ | ② 动态激活 | $(20, 4, 16, 16)$ | $(B, 32, T, T)$ | 算完逐层释放 | 保留或重算
词表打分矩阵 $Z$ | ② 动态激活 | $(20, 16, 1000)$ | $(B, T, 128256)$ | 仅算最后 1 行 | 全位置算交叉熵
键值缓存 $K/V_{\mathrm{cache}}$ | ③ 推理缓存 | $(1, 4, t, 16)$ | $(B, 8, t, 128)$ | 每步追加 1 行 | 不分配
参数梯度矩阵 $G$ | ④ 训练状态 | 与各参数同形状 | 与各参数同形状 | 不分配 | 每步反向写入
优化器状态 $M, V$ | ④ 训练状态 | 与各参数同形状 | 与各参数同形状 | 不分配 | 常驻 (Muon 省 $V$)
```

### 1.4 为什么推理需要 `KV Cache`，而训练能够整句并行？

分清四类张量之后，再结合因果掩码 $M_{\mathrm{causal}}$ 的下三角结构，就能一眼看懂**推理两阶段（Prefill 与 Decode）**与**训练整句并行（Teacher Forcing）**的根本差异。

先看**推理阶段**。推理时，未来的词还没有生出来。模型只能拿用户输入的前缀 $x_{1:T_0}$ 预测出 $x_{T_0+1}$，再把 $x_{T_0+1}$ 接回句尾去预测 $x_{T_0+2}$。

这个过程天然分成两个阶段：

1. **预填充阶段（Prefill）**。初始前缀的 $T_0$ 个词同时已知。输入激活 $H \in \mathbb{R}^{T_0 \times D}$ 与权重 $W^\top \in \mathbb{R}^{D \times D}$ 直接做一次稠密矩阵乘法（GEMM），一口气算出前 $T_0$ 个位置的键矩阵 $K_{1:T_0}$ 与值矩阵 $V_{1:T_0}$，最后取第 $T_0$ 行的输出分布采样出第一个新词 $x_{T_0+1}$。
2. **自回归解码阶段（Decode）**。到了第 $t$ 步，手里有了 $x_{1:t}$，准备生成 $x_{t+1}$。假如此时笨拙地把整段 $x_{1:t}$ 重新喂进网络算一遍，会发生什么？

   由于因果掩码严禁前 $t-1$ 个位置偷看第 $t$ 个词，前 $t-1$ 行的隐状态 $h_1, \dots, h_{t-1}$ 以及它们投影出的 $k_1, \dots, k_{t-1}$、$v_1, \dots, v_{t-1}$，**跟上一步算出来的结果一模一样，连一个比特都不会变**。而且为了预测下一词 $x_{t+1}$，我们也只需要最后一行输出 $o_t$：

$$
o_t^{(h)} = \sum_{j=1}^{t} P_{t,j}^{(h)} v_j^{(h)}, \qquad P_{t, :}^{(h)} = \mathrm{softmax}\!\left(\frac{q_t^{(h)} K_{1:t}^{(h)\top}}{\sqrt{d_k}}\right) \in \mathbb{R}^{1 \times t}
$$

你看，前 $t-1$ 行的查询 $q_1, \dots, q_{t-1}$ 根本用不上，完整的 $t \times t$ 注意力方阵也没必要建。

只要把先前算好的 $K_{1:t-1}$ 和 $V_{1:t-1}$ 留在显存里——这就是 `KV Cache`——第 $t$ 步就只需送入 1 行新词向量 $h_t \in \mathbb{R}^{1 \times D}$。做一次轻量的向量乘矩阵（GEMV）算出当前的 $q_t, k_t, v_t$，把 $k_t, v_t$ 追加到缓存末尾凑成 $K_{1:t}, V_{1:t}$，再做一次 $(1, d_k) \times (d_k, t)$ 内积就够了。

算一笔乘加运算量（MACs，1 次乘加 = 2 FLOPs），差距就更清楚了。

如果不建 `KV Cache`，序列长 $t$ 时重算整句投影要 $\mathcal{O}(t D^2)$，算注意力要 $\mathcal{O}(t^2 D)$；从 $T_0$ 一路生成到长度 $N$，累计开销高达 $\sum_{t=T_0}^N \mathcal{O}(t D^2 + t^2 D) = \mathcal{O}(N^2 D^2 + N^3 D)$。启用 `KV Cache` 后，每步只投影 1 个新词 $\mathcal{O}(D^2)$ 并扫描缓存 $\mathcal{O}(t D)$，累计开销直接降了一个数量级，变成 $\mathcal{O}(N D^2 + N^2 D)$。

再看**训练阶段**，情况恰恰相反。

训练时，语料库里整段标准答案 $x_{1:T+1}$ 早就摊在桌面上了。我们把前 $T$ 个词 $x_{1:T}$ 当输入，整体右移一位的 $x_{2:T+1}$ 当监督标签，这叫做 **Teacher Forcing**。

既然因果掩码 $M_{\mathrm{causal}}$ 已经在矩阵内部挡住了第 $t$ 行去读第 $j > t$ 列的通路，那么做一次 $(B, T, D) \times (D, D)$ 的大矩阵乘法，在数学上就分毫不差地等价于同时跑了 $B \times T$ 道不同前缀长度的填空题。这样既能喂饱 GPU 的矩阵算力，又完全不需要分配 `KV Cache`。

```sketch title="LLM 推理全流程矩阵维度图解：用拆开的方块追踪 Prefill 与 Decode 的维度对应和变化" note="每一个小方格代表矩阵中的一个标量元素（设 $T_0=3, D=4, d_k=2, d_{\mathrm{ff}}=6, V=6$）。上方彩色弧线标出矩阵乘法中必须相等并求和消去的公共内维；从 Stage 1 到 Stage 2，所有高 $T_0=3$ 行的激活块统一退化为高 $1$ 行的单排方块，而紫色 KV Cache 每次仅追加橙色 $1$ 行。"
<svg viewBox="0 0 704 700">
  <rect class="panel" x="0" y="0" width="704" height="456" rx="12"/>
  <text class="caps" x="18" y="22">STAGE 1 · PREFILL</text>
  <text class="small b" x="156" y="22">预填充（设词元数 3、隐藏维 D=4、单头维 2、前馈维 6、词表 V=6）</text>

  <text class="small b" x="20" y="46">① 嵌入查表与单头投影：内维 D=4（蓝）配对消去，保留词元行 3（橙）与子空间列 2（紫）</text>
  <g>
    <line x1="38" y1="84" x2="38" y2="165" stroke="var(--orange)" stroke-width="2"/>
    <line x1="35" y1="84" x2="41" y2="84" stroke="var(--orange)" stroke-width="1.5"/>
    <line x1="35" y1="165" x2="41" y2="165" stroke="var(--orange)" stroke-width="1.5"/>
    <tex class="end small orange" x="33" y="124.5">V=6</tex>
    <line x1="44" y1="78" x2="97" y2="78" stroke="var(--blue)" stroke-width="2"/>
    <line x1="44" y1="75" x2="44" y2="81" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="97" y1="75" x2="97" y2="81" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="70.5" y="67">D=4</tex>
    <path d="M46 84h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 84h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 84h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 84h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM46 112h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 112h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 112h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 112h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM46 154h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 154h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 154h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 154h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <path d="M46 98h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 98h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 98h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 98h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM46 126h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 126h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 126h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 126h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM46 140h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 140h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 140h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 140h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="70.5" y="180">E_{\mathrm{tok}}\;(6\!\times\!4)</tex>
  </g>
  <path class="edge" d="M105 124 H135" marker-end="url(#arrow)"/>
  <text class="mid small" x="120" y="110">抽 3 行</text>

  <g>
    <line x1="186" y1="104" x2="186" y2="143" stroke="var(--clay)" stroke-width="2"/>
    <line x1="183" y1="104" x2="189" y2="104" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="183" y1="143" x2="189" y2="143" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="181" y="123.5">T_0=3</tex>
    <line x1="192" y1="98" x2="245" y2="98" stroke="var(--blue)" stroke-width="2"/>
    <line x1="192" y1="95" x2="192" y2="101" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="245" y1="95" x2="245" y2="101" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="218.5" y="87">D=4</tex>
    <path d="M194 104h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM208 104h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM222 104h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM236 104h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM194 118h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM208 118h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM222 118h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM236 118h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM194 132h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM208 132h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM222 132h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM236 132h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="218.5" y="159">X\;(3\!\times\!4)</tex>
  </g>
  <tex class="mid b" x="260" y="124">\times</tex>
  <g>
    <line x1="296" y1="97" x2="296" y2="150" stroke="var(--blue)" stroke-width="2"/>
    <line x1="293" y1="97" x2="299" y2="97" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="293" y1="150" x2="299" y2="150" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="end small blue" x="291" y="123.5">4</tex>
    <line x1="302" y1="91" x2="327" y2="91" stroke="var(--violet)" stroke-width="2"/>
    <line x1="302" y1="88" x2="302" y2="94" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="327" y1="88" x2="327" y2="94" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="314.5" y="80">d_k=2</tex>
    <path d="M304 97h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM318 97h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM304 111h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM318 111h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM304 125h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM318 125h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM304 139h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM318 139h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <tex class="mid small" x="314.5" y="166">W_q^\top\;(4\!\times\!2)</tex>
  </g>
  <path d="M218.5 96.0 Q260.2 88.0 294.0 123.5" fill="none" stroke="var(--blue)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="342" y="124">=</tex>
  <g>
    <line x1="368" y1="104" x2="368" y2="143" stroke="var(--clay)" stroke-width="2"/>
    <line x1="365" y1="104" x2="371" y2="104" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="365" y1="143" x2="371" y2="143" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="363" y="123.5">3</tex>
    <line x1="374" y1="98" x2="399" y2="98" stroke="var(--violet)" stroke-width="2"/>
    <line x1="374" y1="95" x2="374" y2="101" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="399" y1="95" x2="399" y2="101" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="386.5" y="87">d_k=2</tex>
    <path d="M376 104h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM390 104h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM376 118h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM390 118h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM376 132h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM390 132h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <tex class="mid small" x="386.5" y="159">Q\;(3\!\times\!2)</tex>
  </g>

  <text class="small" x="426" y="86">同理算出同形状键值块：</text>
  <g>
    <line x1="434" y1="118" x2="459" y2="118" stroke="var(--violet)" stroke-width="2"/>
    <line x1="434" y1="115" x2="434" y2="121" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="459" y1="115" x2="459" y2="121" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="446.5" y="107">K</tex>
    <path d="M436 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM450 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM436 138h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM450 138h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM436 152h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM450 152h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  </g>
  <g>
    <line x1="476" y1="118" x2="501" y2="118" stroke="var(--violet)" stroke-width="2"/>
    <line x1="476" y1="115" x2="476" y2="121" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="501" y1="115" x2="501" y2="121" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="488.5" y="107">V</tex>
    <path d="M478 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM492 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM478 138h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM492 138h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM478 152h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM492 152h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  </g>
  <rect class="window" x="426" y="98" width="84" height="72" rx="5"/>
  <text class="small b" x="520" y="128" fill="var(--violet-ink)">← K, V 写入缓存</text>
  <text class="small" x="520" y="146">供后续 Decode 拼接</text>

  <line x1="18" y1="194" x2="686" y2="194" stroke="var(--line)" stroke-dasharray="3 3"/>

  <text class="small b" x="20" y="216">② 因果注意力与多头拼接：查询乘键转置消去内维 2 得 [3×3] 下三角表，乘 V 后双头拼回 D=4</text>
  <g>
    <line x1="42" y1="256" x2="42" y2="295" stroke="var(--clay)" stroke-width="2"/>
    <line x1="39" y1="256" x2="45" y2="256" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="39" y1="295" x2="45" y2="295" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="37" y="275.5">3</tex>
    <line x1="48" y1="250" x2="73" y2="250" stroke="var(--violet)" stroke-width="2"/>
    <line x1="48" y1="247" x2="48" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="73" y1="247" x2="73" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="60.5" y="239">2</tex>
    <path d="M50 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM64 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM50 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM64 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM50 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM64 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <tex class="mid small" x="60.5" y="311">Q\;(3\!\times\!2)</tex>
  </g>
  <tex class="mid b" x="88" y="276">\times</tex>
  <g>
    <line x1="118" y1="263" x2="118" y2="288" stroke="var(--violet)" stroke-width="2"/>
    <line x1="115" y1="263" x2="121" y2="263" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="115" y1="288" x2="121" y2="288" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="end small violet" x="113" y="275.5">2</tex>
    <line x1="124" y1="257" x2="163" y2="257" stroke="var(--clay)" stroke-width="2"/>
    <line x1="124" y1="254" x2="124" y2="260" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="163" y1="254" x2="163" y2="260" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="mid small clay" x="143.5" y="246">T_0=3</tex>
    <path d="M126 263h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM140 263h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM154 263h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM126 277h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM140 277h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM154 277h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <tex class="mid small" x="143.5" y="311">K^\top\;(2\!\times\!3)</tex>
  </g>
  <path d="M60.5 248.0 Q92.2 240.0 116.0 275.5" fill="none" stroke="var(--violet)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="178" y="276">=</tex>
  <g>
    <line x1="206" y1="256" x2="206" y2="295" stroke="var(--clay)" stroke-width="2"/>
    <line x1="203" y1="256" x2="209" y2="256" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="203" y1="295" x2="209" y2="295" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="201" y="275.5">3</tex>
    <line x1="212" y1="250" x2="251" y2="250" stroke="var(--clay)" stroke-width="2"/>
    <line x1="212" y1="247" x2="212" y2="253" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="251" y1="247" x2="251" y2="253" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="mid small clay" x="231.5" y="239">3</tex>
    <path d="M214 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM214 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM228 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM214 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM228 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM242 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <path d="M228 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM242 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM242 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--card)" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 2"/>
    <tex class="mid small" x="231.5" y="311">P\;(3\!\times\!3)</tex>
  </g>
  <tex class="mid b" x="266" y="276">\times</tex>
  <g>
    <line x1="294" y1="256" x2="294" y2="295" stroke="var(--clay)" stroke-width="2"/>
    <line x1="291" y1="256" x2="297" y2="256" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="291" y1="295" x2="297" y2="295" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="289" y="275.5">3</tex>
    <line x1="300" y1="250" x2="325" y2="250" stroke="var(--violet)" stroke-width="2"/>
    <line x1="300" y1="247" x2="300" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="325" y1="247" x2="325" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="312.5" y="239">2</tex>
    <path d="M302 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM316 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM302 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM316 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM302 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM316 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <tex class="mid small" x="312.5" y="311">V\;(3\!\times\!2)</tex>
  </g>
  <path d="M231.5 248.0 Q265.8 240.0 292.0 275.5" fill="none" stroke="var(--clay)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="340" y="276">=</tex>
  <g>
    <line x1="366" y1="256" x2="366" y2="295" stroke="var(--clay)" stroke-width="2"/>
    <line x1="363" y1="256" x2="369" y2="256" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="363" y1="295" x2="369" y2="295" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="361" y="275.5">3</tex>
    <line x1="372" y1="250" x2="397" y2="250" stroke="var(--violet)" stroke-width="2"/>
    <line x1="372" y1="247" x2="372" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="397" y1="247" x2="397" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <text class="mid small b" x="384.5" y="239" fill="var(--violet-ink)">头 1</text>
    <path d="M374 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM388 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM374 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM388 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM374 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM388 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <line x1="403" y1="250" x2="428" y2="250" stroke="var(--violet)" stroke-width="2"/>
    <line x1="403" y1="247" x2="403" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="428" y1="247" x2="428" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <text class="mid small b" x="415.5" y="239" fill="var(--violet-ink)">头 2</text>
    <path d="M405 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM419 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM405 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM419 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM405 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM419 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="400.0" y="311">\mathrm{Concat}\;(3\!\times\!4)</tex>
  </g>
  <path class="edge" d="M436 276 H462" marker-end="url(#arrow)"/>
  <g>
    <line x1="488" y1="256" x2="488" y2="295" stroke="var(--clay)" stroke-width="2"/>
    <line x1="485" y1="256" x2="491" y2="256" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="485" y1="295" x2="491" y2="295" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="483" y="275.5">3</tex>
    <line x1="494" y1="250" x2="547" y2="250" stroke="var(--blue)" stroke-width="2"/>
    <line x1="494" y1="247" x2="494" y2="253" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="547" y1="247" x2="547" y2="253" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="520.5" y="239">D=4</tex>
    <path d="M496 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM510 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM524 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM538 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM496 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM510 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM524 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM538 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM496 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM510 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM524 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM538 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="520.5" y="311">X'\;(3\!\times\!4)</tex>
  </g>
  <text class="small" x="560" y="268">虚线空心格 = 0</text>
  <text class="small mute" x="560" y="286">因果掩码屏蔽未来</text>

  <line x1="18" y1="322" x2="686" y2="322" stroke="var(--line)" stroke-dasharray="3 3"/>

  <text class="small b" x="20" y="344">③ FFN 升维降维（4→6→4）与末行打分（只抽最后 1 行 [1×4] 乘分类头 [4×6] 得打分 [1×6]）</text>
  <g>
    <line x1="38" y1="380" x2="38" y2="419" stroke="var(--clay)" stroke-width="2"/>
    <line x1="35" y1="380" x2="41" y2="380" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="35" y1="419" x2="41" y2="419" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="33" y="399.5">3</tex>
    <line x1="44" y1="374" x2="97" y2="374" stroke="var(--blue)" stroke-width="2"/>
    <line x1="44" y1="371" x2="44" y2="377" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="97" y1="371" x2="97" y2="377" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="70.5" y="363">4</tex>
    <path d="M46 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM46 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM46 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="70.5" y="435">X'\;(3\!\times\!4)</tex>
  </g>
  <path class="edge" d="M105 400 H133" marker-end="url(#arrow)"/>
  <tex class="mid small mute" x="119" y="388">W_{\mathrm{up}}^\top</tex>
  <g>
    <line x1="150" y1="380" x2="150" y2="419" stroke="var(--clay)" stroke-width="2"/>
    <line x1="147" y1="380" x2="153" y2="380" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="147" y1="419" x2="153" y2="419" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="145" y="399.5">3</tex>
    <line x1="156" y1="374" x2="237" y2="374" stroke="var(--teal)" stroke-width="2"/>
    <line x1="156" y1="371" x2="156" y2="377" stroke="var(--teal)" stroke-width="1.5"/>
    <line x1="237" y1="371" x2="237" y2="377" stroke="var(--teal)" stroke-width="1.5"/>
    <tex class="mid small teal" x="196.5" y="363">d_{{\mathrm{{ff}}}}=6</tex>
    <path d="M158 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM172 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM186 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM200 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM214 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM228 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM158 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM172 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM186 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM200 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM214 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM228 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM158 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM172 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM186 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM200 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM214 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM228 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="196.5" y="435">H_{\mathrm{ff}}\;(3\!\times\!6)</tex>
  </g>
  <path class="edge" d="M245 400 H273" marker-end="url(#arrow)"/>
  <tex class="mid small mute" x="259" y="388">W_{\mathrm{down}}^\top</tex>
  <g>
    <line x1="290" y1="380" x2="290" y2="419" stroke="var(--clay)" stroke-width="2"/>
    <line x1="287" y1="380" x2="293" y2="380" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="287" y1="419" x2="293" y2="419" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="285" y="399.5">3</tex>
    <line x1="296" y1="374" x2="349" y2="374" stroke="var(--blue)" stroke-width="2"/>
    <line x1="296" y1="371" x2="296" y2="377" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="349" y1="371" x2="349" y2="377" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="322.5" y="363">4</tex>
    <path d="M298 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM312 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM326 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM340 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM298 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM312 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM326 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM340 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <path d="M298 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM312 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM326 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM340 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="322.5" y="435">X_{\mathrm{out}}\;(3\!\times\!4)</tex>
  </g>
  <path class="edge hot" d="M355 413 H383" marker-end="url(#arrow)"/>
  <text class="mid small accent" x="369" y="400">抽末行</text>
  <g>
    <line x1="398" y1="407" x2="398" y2="418" stroke="var(--clay)" stroke-width="2"/>
    <line x1="395" y1="407" x2="401" y2="407" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="395" y1="418" x2="401" y2="418" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="393" y="412.5">1</tex>
    <line x1="404" y1="401" x2="457" y2="401" stroke="var(--blue)" stroke-width="2"/>
    <line x1="404" y1="398" x2="404" y2="404" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="457" y1="398" x2="457" y2="404" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="430.5" y="390">4</tex>
    <path d="M406 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM420 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM434 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM448 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="430.5" y="434">x_3\;(1\!\times\!4)</tex>
  </g>
  <tex class="mid b" x="470" y="413">\times</tex>
  <g>
    <line x1="498" y1="380" x2="498" y2="433" stroke="var(--blue)" stroke-width="2"/>
    <line x1="495" y1="380" x2="501" y2="380" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="495" y1="433" x2="501" y2="433" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="end small blue" x="493" y="406.5">4</tex>
    <line x1="504" y1="374" x2="585" y2="374" stroke="var(--orange)" stroke-width="2"/>
    <line x1="504" y1="371" x2="504" y2="377" stroke="var(--orange)" stroke-width="1.5"/>
    <line x1="585" y1="371" x2="585" y2="377" stroke="var(--orange)" stroke-width="1.5"/>
    <tex class="mid small orange" x="544.5" y="363">V=6</tex>
    <path d="M506 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM520 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM534 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM548 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM562 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM576 380h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM506 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM520 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM534 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM548 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM562 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM576 394h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM506 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM520 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM534 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM548 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM562 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM576 408h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM506 422h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM520 422h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM534 422h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM548 422h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM562 422h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM576 422h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <tex class="mid small" x="544.5" y="448">W_{\mathrm{head}}^\top\;(4\!\times\!6)</tex>
  </g>
  <path d="M430.5 399.0 Q467.2 390.5 496.0 406.5" fill="none" stroke="var(--blue)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="598" y="413">=</tex>
  <g>
    <line x1="610" y1="401" x2="691" y2="401" stroke="var(--orange)" stroke-width="2"/>
    <line x1="610" y1="398" x2="610" y2="404" stroke="var(--orange)" stroke-width="1.5"/>
    <line x1="691" y1="398" x2="691" y2="404" stroke="var(--orange)" stroke-width="1.5"/>
    <tex class="mid small orange" x="650.5" y="390">V=6</tex>
    <path d="M612 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM626 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM640 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM654 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM668 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM682 407h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
    <tex class="mid small" x="650.5" y="434">z_3\;(1\!\times\!6)</tex>
  </g>

  <rect class="panel" x="0" y="472" width="704" height="228" rx="12"/>
  <text class="caps" x="18" y="494">STAGE 2 · DECODE + KV CACHE</text>
  <text class="small b" x="238" y="494">第 4 步逐词解码：输入退化为单排方块 [1×4]，历史 K, V 仅追加第 4 行</text>

  <g>
    <line x1="38" y1="554" x2="38" y2="565" stroke="var(--clay)" stroke-width="2"/>
    <line x1="35" y1="554" x2="41" y2="554" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="35" y1="565" x2="41" y2="565" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="33" y="559.5">1</tex>
    <line x1="44" y1="548" x2="97" y2="548" stroke="var(--blue)" stroke-width="2"/>
    <line x1="44" y1="545" x2="44" y2="551" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="97" y1="545" x2="97" y2="551" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="70.5" y="537">D=4</tex>
    <path d="M46 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM60 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM74 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM88 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="70.5" y="583">h_4\;(1\!\times\!4)</tex>
  </g>
  <path class="edge" d="M105 560 H131" marker-end="url(#arrow)"/>
  <tex class="mid small mute" x="118" y="548">W_{q,k,v}^\top</tex>
  <g>
    <line x1="148" y1="554" x2="148" y2="565" stroke="var(--clay)" stroke-width="2"/>
    <line x1="145" y1="554" x2="151" y2="554" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="145" y1="565" x2="151" y2="565" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="143" y="559.5">1</tex>
    <line x1="154" y1="548" x2="179" y2="548" stroke="var(--violet)" stroke-width="2"/>
    <line x1="154" y1="545" x2="154" y2="551" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="179" y1="545" x2="179" y2="551" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="166.5" y="537">2</tex>
    <path d="M156 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM170 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="166.5" y="583">q_4\;(1\!\times\!2)</tex>
  </g>
  <tex class="mid b" x="196" y="560">\times</tex>
  <g>
    <line x1="226" y1="547" x2="226" y2="572" stroke="var(--violet)" stroke-width="2"/>
    <line x1="223" y1="547" x2="229" y2="547" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="223" y1="572" x2="229" y2="572" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="end small violet" x="221" y="559.5">2</tex>
    <line x1="232" y1="541" x2="285" y2="541" stroke="var(--clay)" stroke-width="2"/>
    <line x1="232" y1="538" x2="232" y2="544" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="285" y1="538" x2="285" y2="544" stroke="var(--clay)" stroke-width="1.5"/>
    <text class="mid small b" x="258.5" y="530" fill="var(--clay-ink)">3 旧 + 1 新</text>
    <path d="M234 547h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM248 547h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM262 547h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM234 561h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM248 561h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM262 561h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <path d="M276 547h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM276 561h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="258.5" y="592">K_{1:4}^\top\;(2\!\times\!4)</tex>
  </g>
  <path d="M166.5 546.0 Q199.2 538.0 224.0 559.5" fill="none" stroke="var(--violet)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="300" y="560">=</tex>
  <g>
    <line x1="328" y1="554" x2="328" y2="565" stroke="var(--clay)" stroke-width="2"/>
    <line x1="325" y1="554" x2="331" y2="554" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="325" y1="565" x2="331" y2="565" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="323" y="559.5">1</tex>
    <line x1="334" y1="548" x2="387" y2="548" stroke="var(--clay)" stroke-width="2"/>
    <line x1="334" y1="545" x2="334" y2="551" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="387" y1="545" x2="387" y2="551" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="mid small clay" x="360.5" y="537">t=4</tex>
    <path d="M336 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM350 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM364 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM378 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="360.5" y="583">P_4\;(1\!\times\!4)</tex>
  </g>
  <tex class="mid b" x="402" y="560">\times</tex>
  <g>
    <line x1="430" y1="534" x2="430" y2="587" stroke="var(--clay)" stroke-width="2"/>
    <line x1="427" y1="534" x2="433" y2="534" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="427" y1="587" x2="433" y2="587" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="425" y="560.5">4</tex>
    <line x1="436" y1="528" x2="461" y2="528" stroke="var(--violet)" stroke-width="2"/>
    <line x1="436" y1="525" x2="436" y2="531" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="461" y1="525" x2="461" y2="531" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="448.5" y="517">2</tex>
    <path d="M438 534h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM452 534h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM438 548h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM452 548h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM438 562h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM452 562h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <path d="M438 576h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM452 576h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="448.5" y="603">V_{1:4}\;(4\!\times\!2)</tex>
  </g>
  <path d="M360.5 546.0 Q398.2 538.0 428.0 560.5" fill="none" stroke="var(--clay)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="476" y="560">=</tex>
  <g>
    <line x1="494" y1="548" x2="519" y2="548" stroke="var(--violet)" stroke-width="2"/>
    <line x1="494" y1="545" x2="494" y2="551" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="519" y1="545" x2="519" y2="551" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="506.5" y="537">2</tex>
    <path d="M496 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM510 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="506.5" y="583">o_4^{(h)}</tex>
  </g>
  <path class="edge" d="M527 560 H567" marker-end="url(#arrow)"/>
  <text class="mid small" x="547" y="546">双头+FFN</text>
  <g>
    <line x1="582" y1="548" x2="663" y2="548" stroke="var(--orange)" stroke-width="2"/>
    <line x1="582" y1="545" x2="582" y2="551" stroke="var(--orange)" stroke-width="1.5"/>
    <line x1="663" y1="545" x2="663" y2="551" stroke="var(--orange)" stroke-width="1.5"/>
    <tex class="mid small orange" x="622.5" y="537">V=6</tex>
    <path d="M584 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM598 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM612 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM626 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM640 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM654 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
    <tex class="mid small" x="622.5" y="583">z_4\;(1\!\times\!6)</tex>
  </g>

  <text class="small b" x="20" y="650">对照上下两框可见：静态权重（蓝）尺寸恒定；Prefill 中高 3 行的激活块，在 Decode 中全部变成高 1 行的单排方块</text>
  <text class="small" x="20" y="672">紫色方块为前 3 词缓存的历史键值，橙色方块是第 4 步唯一新算并追加的 1 行键值，省去了全部历史词重算</text>
</svg>
<svg viewBox="0 0 340 634">
  <rect class="panel" x="0" y="0" width="340" height="346" rx="12"/>
  <text class="caps" x="16" y="22">1 · PREFILL（3 行方块并行 GEMM）</text>
  <text class="small b" x="16" y="44">投影：[3×4] × [4×2] → 内维 4 消去得 [3×2]</text>
  <g>
    <line x1="36" y1="86" x2="36" y2="121.0" stroke="var(--clay)" stroke-width="2"/>
    <line x1="33" y1="86" x2="39" y2="86" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="33" y1="121.0" x2="39" y2="121.0" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="31" y="103.5">3</tex>
    <line x1="42" y1="80" x2="89.5" y2="80" stroke="var(--blue)" stroke-width="2"/>
    <line x1="42" y1="77" x2="42" y2="83" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="89.5" y1="77" x2="89.5" y2="83" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="65.8" y="69">D=4</tex>
    <path d="M44 86h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 86h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 86h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 86h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM44 98.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 98.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 98.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 98.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM44 111h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 111h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 111h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 111h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="65.8" y="136.0">X</tex>
  </g>
  <tex class="mid b" x="108" y="104">\times</tex>
  <g>
    <line x1="138" y1="80" x2="138" y2="127.5" stroke="var(--blue)" stroke-width="2"/>
    <line x1="135" y1="80" x2="141" y2="80" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="135" y1="127.5" x2="141" y2="127.5" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="end small blue" x="133" y="103.8">4</tex>
    <line x1="144" y1="74" x2="166.5" y2="74" stroke="var(--violet)" stroke-width="2"/>
    <line x1="144" y1="71" x2="144" y2="77" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="166.5" y1="71" x2="166.5" y2="77" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="155.2" y="63">2</tex>
    <path d="M146 80h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM158.5 80h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM146 92.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM158.5 92.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM146 105h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM158.5 105h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM146 117.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM158.5 117.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <tex class="mid small" x="155.2" y="142.5">W_q^\top</tex>
  </g>
  <path d="M65.8 78.0 Q104.9 70.0 136.0 103.8" fill="none" stroke="var(--blue)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="186" y="104">=</tex>
  <g>
    <line x1="212" y1="86" x2="212" y2="121.0" stroke="var(--clay)" stroke-width="2"/>
    <line x1="209" y1="86" x2="215" y2="86" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="209" y1="121.0" x2="215" y2="121.0" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="207" y="103.5">3</tex>
    <line x1="218" y1="80" x2="240.5" y2="80" stroke="var(--violet)" stroke-width="2"/>
    <line x1="218" y1="77" x2="218" y2="83" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="240.5" y1="77" x2="240.5" y2="83" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="229.2" y="69">2</tex>
    <path d="M220 86h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM232.5 86h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM220 98.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM232.5 98.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM220 111h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM232.5 111h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <tex class="mid small" x="229.2" y="136.0">Q,K,V</tex>
  </g>

  <text class="small b" x="16" y="176">因果注意力：[3×2]×[2×3] = [3×3] 下三角</text>
  <g>
    <path d="M28 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM40.5 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM28 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM40.5 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM28 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM40.5 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <tex class="mid small" x="37.2" y="248.0">Q</tex>
  </g>
  <tex class="mid b" x="62" y="216">\times</tex>
  <g>
    <path d="M78 204h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM90.5 204h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM103 204h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM78 216.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM90.5 216.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM103 216.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <tex class="mid small" x="93.5" y="247.5">K^\top</tex>
  </g>
  <tex class="mid b" x="124" y="216">=</tex>
  <g>
    <path d="M140 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM140 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM152.5 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM140 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM152.5 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM165 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <path d="M152.5 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM165 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM165 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--card)" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 2"/>
    <tex class="mid small" x="155.5" y="248.0">P\;(3\!\times\!3)</tex>
  </g>
  <path class="edge" d="M186 216 H214" marker-end="url(#arrow)"/>
  <g>
    <path d="M222 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM234.5 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM247 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM259.5 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM272 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM284.5 198h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM222 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM234.5 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM247 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM259.5 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM272 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM284.5 210.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <path d="M222 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM234.5 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM247 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM259.5 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM272 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM284.5 223h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="256.2" y="248.0">H_{\mathrm{ff}}\;(3\!\times\!6)</tex>
  </g>
  <text class="small" x="16" y="282">仅抽第 3 行 [1×4] × 分类头 [4×6] = 打分 [1×6]</text>
  <g>
    <path d="M28 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM40.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM53 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM65.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  </g>
  <path class="edge" d="M84 301 H124" marker-end="url(#arrow)"/>
  <g>
    <path d="M134 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM146.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM159 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM171.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM184 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM196.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  </g>
  <tex class="small" x="214" y="301">z_3\;(1\!\times\!6)</tex>

  <rect class="panel" x="0" y="362" width="340" height="272" rx="12"/>
  <text class="caps" x="16" y="384">2 · DECODE（压成 1 行 + 缓存拼第 4 行）</text>
  <g>
    <line x1="30" y1="430" x2="30" y2="440.0" stroke="var(--clay)" stroke-width="2"/>
    <line x1="27" y1="430" x2="33" y2="430" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="27" y1="440.0" x2="33" y2="440.0" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="25" y="435.0">1</tex>
    <line x1="36" y1="424" x2="58.5" y2="424" stroke="var(--violet)" stroke-width="2"/>
    <line x1="36" y1="421" x2="36" y2="427" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="58.5" y1="421" x2="58.5" y2="427" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="47.2" y="413">2</tex>
    <path d="M38 430h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM50.5 430h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="47.2" y="456.0">q_4</tex>
  </g>
  <tex class="mid b" x="72" y="435">\times</tex>
  <g>
    <line x1="88" y1="418" x2="135.5" y2="418" stroke="var(--clay)" stroke-width="2"/>
    <line x1="88" y1="415" x2="88" y2="421" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="135.5" y1="415" x2="135.5" y2="421" stroke="var(--clay)" stroke-width="1.5"/>
    <text class="mid small b" x="111.8" y="407" fill="var(--clay-ink)">3 旧 + 1 新</text>
    <path d="M90 424h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM102.5 424h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM115 424h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM90 436.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM102.5 436.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM115 436.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <path d="M127.5 424h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM127.5 436.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="111.8" y="464.5">K_{1:4}^\top\;(2\!\times\!4)</tex>
  </g>
  <tex class="mid b" x="150" y="435">=</tex>
  <g>
    <line x1="166" y1="424" x2="213.5" y2="424" stroke="var(--clay)" stroke-width="2"/>
    <line x1="166" y1="421" x2="166" y2="427" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="213.5" y1="421" x2="213.5" y2="427" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="mid small clay" x="189.8" y="413">1\!\times\!4</tex>
    <path d="M168 430h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM180.5 430h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM193 430h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM205.5 430h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="189.8" y="456.0">P_4</tex>
  </g>
  <tex class="mid b" x="226" y="435">\times</tex>
  <g>
    <path d="M244 412h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM256.5 412h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM244 424.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM256.5 424.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM244 437h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM256.5 437h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <path d="M244 449.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM256.5 449.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="253.2" y="475.5">V_{1:4}</tex>
  </g>
  <text class="small b" x="16" y="516">注意力表从 [3×3] 变成单排 4 格 [1×4]</text>
  <text class="small" x="16" y="540">橙色格即本步追加进 KV Cache 的第 4 行</text>
  <g>
    <path d="M28 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM40.5 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM53 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM65.5 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM78 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM90.5 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  </g>
  <tex class="small" x="112" y="567">z_4\;(1\!\times\!6)\;\longrightarrow\;x_5</tex>
  <text class="small mute" x="16" y="606">静态参数方块全程不变，动态激活压为 1 行</text>
</svg>
```

### 1.5 把矩阵真正展开：一条 3 词例句的 `Prefill` 与 `Decode` 逐步手算

前文用紧凑的矩阵符号和方格维度图概括了推理流程。但很多初学 Transformer 的读者依然会卡在一个地方：这些矩阵乘起来时，括号里的数字到底是怎么一步步变过去的？

不妨把隐藏维度缩小到能直接口算的迷你尺寸，将整条计算链上的每一张矩阵摊开在桌面上。

设迷你词表共有 $V = 5$ 个词元：`0:<pad>`、`1:猫`、`2:追`、`3:狗`、`4:跑`；隐藏维 $D = 3$，单头注意力维 $d_k = 2$。用户输入长度为 $T_0 = 3$ 的提示词前缀 `["猫", "追", "狗"]`，对应整数编号 $(1, 2, 3)$。

**第一步：词嵌入查表（等价于独热矩阵左乘）。** 先展开静态词嵌入表 $E_{\mathrm{tok}} \in \mathbb{R}^{5 \times 3}$。抽出编号 $(1, 2, 3)$ 对应的三行，在代数上跟左乘一张 $3 \times 5$ 的独热选择矩阵 $U$ 逐位相同（为聚焦矩阵变换主线，此处略去位置编码，直接把三行均方根相等的查表结果记作 $H$）：

$$
H = U E_{\mathrm{tok}} =
\begin{bmatrix}
0 & \mathbf{1} & 0 & 0 & 0 \\
0 & 0 & \mathbf{1} & 0 & 0 \\
0 & 0 & 0 & \mathbf{1} & 0
\end{bmatrix}
\begin{bmatrix}
0 & 0 & 0 \\
1 & 0 & 1 \\
0 & 1 & 1 \\
1 & 1 & 0 \\
1 & 0 & -1
\end{bmatrix}
=
\begin{bmatrix}
1 & 0 & 1 \\
0 & 1 & 1 \\
1 & 1 & 0
\end{bmatrix}
\begin{matrix}
\leftarrow \text{词 1 “猫”} \\
\leftarrow \text{词 2 “追”} \\
\leftarrow \text{词 3 “狗”}
\end{matrix}
$$

这一步看得很清楚：所谓“离散词元转连续向量”，只是按编号把词表矩阵的对应行原样抄出来排成 $3 \times 3$ 矩阵；未被选中的第 0 行与第 4 行完全没有参与运算。

**第二步：线性投影生成 $Q, K, V_{\mathrm{val}}$。** 给定静态投影权重转置 $W_q^\top, W_k^\top, W_v^\top \in \mathbb{R}^{3 \times 2}$，将 $H\;(3 \times 3)$ 分别右乘三块权重矩阵：

$$
Q = H W_q^\top =
\begin{bmatrix} 1 & 0 & 1 \\ 0 & 1 & 1 \\ 1 & 1 & 0 \end{bmatrix}
\begin{bmatrix} 1 & 0 \\ 0 & 1 \\ 1 & -1 \end{bmatrix}
=
\begin{bmatrix} 2 & -1 \\ 1 & 0 \\ 1 & 1 \end{bmatrix}, \quad
K = H W_k^\top =
\begin{bmatrix} 1 & 0 & 1 \\ 0 & 1 & 1 \\ 1 & 1 & 0 \end{bmatrix}
\begin{bmatrix} 1 & 1 \\ 0 & 1 \\ 1 & 0 \end{bmatrix}
=
\begin{bmatrix} 2 & 1 \\ 1 & 1 \\ 1 & 2 \end{bmatrix}, \quad
V_{\mathrm{val}} = H W_v^\top =
\begin{bmatrix} 1 & 0 & 1 \\ 0 & 1 & 1 \\ 1 & 1 & 0 \end{bmatrix}
\begin{bmatrix} 2 & 0 \\ 0 & 2 \\ 1 & 1 \end{bmatrix}
=
\begin{bmatrix} 3 & 1 \\ 1 & 3 \\ 2 & 2 \end{bmatrix}
$$

以 $Q$ 左上角的 $Q_{1,1} = 2$ 为例，它由 $H$ 第 1 行 $[1, 0, 1]$ 与 $W_q^\top$ 第 1 列 $[1, 0, 1]^\top$ 逐位乘加得到（$1\times 1 + 0\times 0 + 1\times 1 = 2$）。

请留意一个关键事实：**线性投影只在同一行内部重组特征列，3 个词元在这一步彼此毫无交流**。与此同时，算出来的 $K$ 与 $V_{\mathrm{val}}$ 会顺手存进显存，作为前 3 个位置的初始 `KV Cache`。

**第三步：因果自注意力的四步矩阵变形（内积 $\to$ 掩码 $\to$ Softmax $\to$ 加权混洗 $V$）。** 现在词与词之间开始交互。先用 $Q\;(3\times 2)$ 右乘转置后的 $K^\top\;(2\times 3)$，算出两两词元之间的原始匹配内积：

$$
Q K^\top =
\begin{bmatrix} 2 & -1 \\ 1 & 0 \\ 1 & 1 \end{bmatrix}
\begin{bmatrix} 2 & 1 & 1 \\ 1 & 1 & 2 \end{bmatrix}
=
\begin{bmatrix}
3 & 1 & 0 \\
2 & 1 & 1 \\
3 & 2 & 3
\end{bmatrix}
$$

接着除以 $\sqrt{d_k} = \sqrt{2} \approx 1.414$，并加上主对角线以上全为 $-\infty$ 的因果掩码 $M_{\mathrm{causal}}$，再对每一行独立求指数归一化 $P_{i,j} = e^{S_{i,j}} / \sum_c e^{S_{i,c}}$（因 $e^{-\infty} = 0$，上三角概率严格归零）：

$$
S = \frac{Q K^\top}{\sqrt{2}} + M_{\mathrm{causal}} \approx
\begin{bmatrix}
2.12 & -\infty & -\infty \\
1.41 & 0.71 & -\infty \\
2.12 & 1.41 & 2.12
\end{bmatrix}
\;\xrightarrow{\text{按行 Softmax}}\;
P \approx
\begin{bmatrix}
1.00 & 0 & 0 \\
0.67 & 0.33 & 0 \\
0.40 & 0.20 & 0.40
\end{bmatrix}
$$

最后用下三角概率矩阵 $P\;(3\times 3)$ 左乘值矩阵 $V_{\mathrm{val}}\;(3\times 2)$：

$$
O = P V_{\mathrm{val}} \approx
\begin{bmatrix}
1.00 & 0 & 0 \\
0.67 & 0.33 & 0 \\
0.40 & 0.20 & 0.40
\end{bmatrix}
\begin{bmatrix}
3 & 1 \\
1 & 3 \\
2 & 2
\end{bmatrix}
=
\begin{bmatrix}
3.00 & 1.00 \\
2.34 & 1.66 \\
2.20 & 1.80
\end{bmatrix}
$$

把每一行的乘法拆开，就能直观看到自注意力究竟做了什么：
- **第 1 行（“猫”）**：$1.00 \times [3, 1] + 0 + 0 = [3.00, 1.00]$，只能读取自身信息；
- **第 2 行（“追”）**：$0.67 \times [3, 1] + 0.33 \times [1, 3] + 0 = [2.34, 1.66]$，把前文主语“猫”的值向量按 $67\%$ 权重融合进来，同时被掩码严密阻断了对第 3 个词“狗”的偷看；
- **第 3 行（“狗”）**：$0.40 \times [3, 1] + 0.20 \times [1, 3] + 0.40 \times [2, 2] = [2.20, 1.80]$，汇总了整段 3 词前文。`Prefill` 结束时，网络只取最后这一行往后送入前馈层与词表分类头 $W_{\mathrm{head}}^\top$，假设采样生成了第 4 个词 `4:跑`。

**第四步：推进到 `Decode` 阶段（$t=4$，为什么只需算 1 行？）。** 现在要把新采出来的 `4:跑` 送进模型去猜第 5 个词。

回看上一步立刻就能明白：前 3 个词根本看不见第 4 个词，所以它们的 $K, V_{\mathrm{val}}$ 行永远不会变。第 4 步**根本不用再拼一张 $4 \times 3$ 矩阵**，只需单独取出词表第 4 行 $h_4 = [1, 0, -1] \in \mathbb{R}^{1 \times 3}$，做三次轻巧的单行向量乘矩阵：

$$
q_4 = h_4 W_q^\top = \begin{bmatrix} 0 & 1 \end{bmatrix}, \qquad
k_4 = h_4 W_k^\top = \begin{bmatrix} 0 & 1 \end{bmatrix}, \qquad
v_4 = h_4 W_v^\top = \begin{bmatrix} 1 & -1 \end{bmatrix}
$$

把 $k_4, v_4$ 直接拼接到刚才缓存的 $3 \times 2$ 键值表末尾，组成 $4 \times 2$ 的 $K_{1:4}$ 与 $V_{1:4}$，随后只需计算单行查询 $q_4\;(1\times 2)$ 与 $K_{1:4}^\top\;(2\times 4)$ 的内积：

$$
q_4 K_{1:4}^\top =
\begin{bmatrix} 0 & 1 \end{bmatrix}
\begin{bmatrix}
2 & 1 & 1 & \mathbf{0} \\
1 & 1 & 2 & \mathbf{1}
\end{bmatrix}
= \begin{bmatrix} 1 & 1 & 2 & 1 \end{bmatrix}
\;\xrightarrow{\mathrm{softmax}(\cdot / \sqrt{2})}\;
p_4 \approx \begin{bmatrix} 0.20 & 0.20 & 0.40 & 0.20 \end{bmatrix}
$$

再用这一排 4 个概率对 $V_{1:4}$ 的 4 行做加权平均：$o_4 = p_4 V_{1:4} = 0.20[3,1] + 0.20[1,3] + 0.40[2,2] + 0.20[1,-1] = [1.80, 1.40] \in \mathbb{R}^{1 \times 2}$。整座 $4 \times 4$ 注意力方阵的前 3 行自始至终无需构造。

```sketch title="展开数值图解：3 词 Prefill 因果注意力与第 4 步 Decode 缓存追加的矩阵内部数值变换" note="把抽象符号替换成可直接口算的小整数与两位小数（$d_k=2$，缩放因子 $\sqrt{2}\approx 1.41$）。Stage 1 展示下三角掩码如何令每行输出成为历史值向量的凸组合；Stage 2 展示自回归解码如何仅凭单行 $q_4$ 与追加 1 行的紫色缓存算出 $o_4$。"
<svg viewBox="0 0 704 494">
  <rect class="panel" x="0" y="0" width="704" height="256" rx="12"/>
  <text class="caps" x="18" y="22">STAGE 1 · PREFILL 展开数值追踪</text>
  <text class="small b" x="18" y="44">输入 3 词“猫 追 狗”（高亮第 2 行“追”如何融合前文并屏蔽未来词“狗”）</text>

  <g>
  <path d="M20.5 72.0 H16.0 V146.0 H20.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M71.5 72.0 H76.0 V146.0 H71.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="20.0" y="74.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="32.5" y="85.0">2</text>
  <rect x="47.0" y="74.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="59.5" y="85.0">-1</text>
  <rect x="20.0" y="98.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small b" x="32.5" y="109.0">1</text>
  <rect x="47.0" y="98.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small b" x="59.5" y="109.0">0</text>
  <rect x="20.0" y="122.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="32.5" y="133.0">1</text>
  <rect x="47.0" y="122.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="59.5" y="133.0">1</text>
  <tex class="mid small" x="46.0" y="161.0">Q\;(3\!\times\!2)</tex>
  </g>
  <text class="mid b" x="88" y="109">×</text>
  <g>
  <path d="M104.5 84.0 H100.0 V134.0 H104.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M182.5 84.0 H187.0 V134.0 H182.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="104.0" y="86.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="116.5" y="97.0">2</text>
  <rect x="131.0" y="86.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="143.5" y="97.0">1</text>
  <rect x="158.0" y="86.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="170.5" y="97.0">1</text>
  <rect x="104.0" y="110.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="116.5" y="121.0">1</text>
  <rect x="131.0" y="110.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="143.5" y="121.0">1</text>
  <rect x="158.0" y="110.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="170.5" y="121.0">2</text>
  <tex class="mid small" x="143.5" y="161.0">K^\top\;(2\!\times\!3)</tex>
  </g>
  <path class="edge" d="M192 109 H222" marker-end="url(#arrow)"/>
  <tex class="mid small mute" x="207" y="94">\div\sqrt{2}</tex>
  <text class="mid small accent" x="207" y="125">+掩码</text>

  <g>
  <path d="M232.5 72.0 H228.0 V146.0 H232.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M337.5 72.0 H342.0 V146.0 H337.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="232.0" y="74.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="249.0" y="85.0">2.12</text>
  <rect x="268.0" y="74.0" width="34.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <tex class="mid small clay" x="285.0" y="85.0">-\infty</tex>
  <rect x="304.0" y="74.0" width="34.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <tex class="mid small clay" x="321.0" y="85.0">-\infty</tex>
  <rect x="232.0" y="98.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="249.0" y="109.0">1.41</text>
  <rect x="268.0" y="98.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="285.0" y="109.0">0.71</text>
  <rect x="304.0" y="98.0" width="34.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <tex class="mid small clay" x="321.0" y="109.0">-\infty</tex>
  <rect x="232.0" y="122.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="249.0" y="133.0">2.12</text>
  <rect x="268.0" y="122.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="285.0" y="133.0">1.41</text>
  <rect x="304.0" y="122.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="321.0" y="133.0">2.12</text>
  <tex class="mid small" x="285.0" y="161.0">S\;(3\!\times\!3)</tex>
  </g>
  <path class="edge" d="M348 109 H376" marker-end="url(#arrow)"/>
  <text class="mid small mute" x="362" y="95">row</text>
  <text class="mid small mute" x="362" y="124">exp</text>

  <g>
  <path d="M386.5 72.0 H382.0 V146.0 H386.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M491.5 72.0 H496.0 V146.0 H491.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="386.0" y="74.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="403.0" y="85.0">1.00</text>
  <rect x="422.0" y="74.0" width="34.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <text class="mid small" x="439.0" y="85.0" fill="var(--muted)">0</text>
  <rect x="458.0" y="74.0" width="34.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <text class="mid small" x="475.0" y="85.0" fill="var(--muted)">0</text>
  <rect x="386.0" y="98.0" width="34.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="403.0" y="109.0">0.67</text>
  <rect x="422.0" y="98.0" width="34.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="439.0" y="109.0">0.33</text>
  <rect x="458.0" y="98.0" width="34.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <text class="mid small" x="475.0" y="109.0" fill="var(--muted)">0</text>
  <rect x="386.0" y="122.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="403.0" y="133.0">0.40</text>
  <rect x="422.0" y="122.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="439.0" y="133.0">0.20</text>
  <rect x="458.0" y="122.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="475.0" y="133.0">0.40</text>
  <tex class="mid small" x="439.0" y="161.0">P\;(3\!\times\!3)</tex>
  </g>
  <text class="mid b" x="507" y="109">×</text>
  <g>
  <path d="M522.5 72.0 H518.0 V146.0 H522.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M573.5 72.0 H578.0 V146.0 H573.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="522.0" y="74.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="534.5" y="85.0">3</text>
  <rect x="549.0" y="74.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="561.5" y="85.0">1</text>
  <rect x="522.0" y="98.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="534.5" y="109.0">1</text>
  <rect x="549.0" y="98.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="561.5" y="109.0">3</text>
  <rect x="522.0" y="122.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="534.5" y="133.0">2</text>
  <rect x="549.0" y="122.0" width="25.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="561.5" y="133.0">2</text>
  <tex class="mid small" x="548.0" y="161.0">V\;(3\!\times\!2)</tex>
  </g>
  <text class="mid b" x="588" y="109">=</text>
  <g>
  <path d="M602.5 72.0 H598.0 V146.0 H602.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M675.5 72.0 H680.0 V146.0 H675.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="602.0" y="74.0" width="36.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="620.0" y="85.0">3.00</text>
  <rect x="640.0" y="74.0" width="36.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="658.0" y="85.0">1.00</text>
  <rect x="602.0" y="98.0" width="36.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="620.0" y="109.0">2.34</text>
  <rect x="640.0" y="98.0" width="36.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="658.0" y="109.0">1.66</text>
  <rect x="602.0" y="122.0" width="36.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="620.0" y="133.0">2.20</text>
  <rect x="640.0" y="122.0" width="36.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="658.0" y="133.0">1.80</text>
  <tex class="mid small" x="639.0" y="161.0">O\;(3\!\times\!2)</tex>
  </g>

  <rect class="window" x="18" y="206" width="668" height="34" rx="6"/>
  <text class="small b" x="30" y="223">第 2 行（“追”）验算：0.67×[3, 1]（猫） + 0.33×[1, 3]（追） + 0×[2, 2]（狗被屏蔽） = [2.34, 1.66]</text>

  <rect class="panel" x="0" y="272" width="704" height="222" rx="12"/>
  <text class="caps" x="18" y="294">STAGE 2 · DECODE 第 4 步展开数值追踪</text>
  <text class="small b" x="18" y="316">仅送入单行新词 q₄=[0, 1]，在缓存末尾追加橙色第 4 列/行，只算 1×4 权重</text>

  <g>
  <path d="M22.5 368.0 H18.0 V394.0 H22.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M75.5 368.0 H80.0 V394.0 H75.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="22.0" y="370.0" width="26.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="35.0" y="381.0">0</text>
  <rect x="50.0" y="370.0" width="26.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="63.0" y="381.0">1</text>
  <tex class="mid small" x="49.0" y="409.0">q_4\;(1\!\times\!2)</tex>
  </g>
  <text class="mid b" x="92" y="381">×</text>
  <g>
  <path d="M108.5 356.0 H104.0 V406.0 H108.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M217.5 356.0 H222.0 V406.0 H217.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="108.0" y="358.0" width="26.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="121.0" y="369.0">2</text>
  <rect x="136.0" y="358.0" width="26.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="149.0" y="369.0">1</text>
  <rect x="164.0" y="358.0" width="26.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="177.0" y="369.0">1</text>
  <rect x="192.0" y="358.0" width="26.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="205.0" y="369.0">0</text>
  <rect x="108.0" y="382.0" width="26.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="121.0" y="393.0">1</text>
  <rect x="136.0" y="382.0" width="26.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="149.0" y="393.0">1</text>
  <rect x="164.0" y="382.0" width="26.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="177.0" y="393.0">2</text>
  <rect x="192.0" y="382.0" width="26.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="205.0" y="393.0">1</text>
  <text class="mid small mute" x="163.0" y="347.0">3 旧 + 1 新</text>
  <tex class="mid small" x="163.0" y="421.0">K_{{1:4}}^\top\;(2\!\times\!4)</tex>
  </g>
  <path class="edge" d="M228 381 H268" marker-end="url(#arrow)"/>
  <text class="mid small mute" x="248" y="367">softmax</text>

  <g>
  <path d="M278.5 368.0 H274.0 V394.0 H278.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M419.5 368.0 H424.0 V394.0 H419.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="278.0" y="370.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="295.0" y="381.0">0.20</text>
  <rect x="314.0" y="370.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="331.0" y="381.0">0.20</text>
  <rect x="350.0" y="370.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="367.0" y="381.0">0.40</text>
  <rect x="386.0" y="370.0" width="34.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="403.0" y="381.0">0.20</text>
  <tex class="mid small" x="349.0" y="409.0">p_4\;(1\!\times\!4)</tex>
  </g>
  <text class="mid b" x="436" y="381">×</text>
  <g>
  <path d="M452.5 332.0 H448.0 V430.0 H452.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M509.5 332.0 H514.0 V430.0 H509.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="452.0" y="334.0" width="28.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="466.0" y="345.0">3</text>
  <rect x="482.0" y="334.0" width="28.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="496.0" y="345.0">1</text>
  <rect x="452.0" y="358.0" width="28.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="466.0" y="369.0">1</text>
  <rect x="482.0" y="358.0" width="28.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="496.0" y="369.0">3</text>
  <rect x="452.0" y="382.0" width="28.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="466.0" y="393.0">2</text>
  <rect x="482.0" y="382.0" width="28.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="496.0" y="393.0">2</text>
  <rect x="452.0" y="406.0" width="28.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="466.0" y="417.0">1</text>
  <rect x="482.0" y="406.0" width="28.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="496.0" y="417.0">-1</text>
  <tex class="mid small" x="481.0" y="445.0">V_{{1:4}}\;(4\!\times\!2)</tex>
  </g>
  <text class="mid b" x="528" y="381">=</text>
  <g>
  <path d="M544.5 368.0 H540.0 V394.0 H544.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M625.5 368.0 H630.0 V394.0 H625.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="544.0" y="370.0" width="40.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="564.0" y="381.0">1.80</text>
  <rect x="586.0" y="370.0" width="40.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="606.0" y="381.0">1.40</text>
  <tex class="mid small" x="585.0" y="409.0">o_4\;(1\!\times\!2)</tex>
  </g>

  <text class="small" x="18" y="472">加权验算：0.20×[3,1] + 0.20×[1,3] + 0.40×[2,2] + 0.20×[1,-1]（新追加行） = [1.80, 1.40]（省去前 3 行全部重算）</text>
</svg>
<svg viewBox="0 0 340 632">
  <rect class="panel" x="0" y="0" width="340" height="368" rx="12"/>
  <text class="caps" x="14" y="22">1 · PREFILL（3 词矩阵展开）</text>
  <text class="small b" x="14" y="44">① 打分与因果掩码：上三角填 -∞ 阻断未来词</text>

  <g>
  <path d="M16.5 60.0 H12.0 V128.0 H16.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M63.5 60.0 H68.0 V128.0 H63.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="16.0" y="62.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="27.5" y="72.0">2</text>
  <rect x="41.0" y="62.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="52.5" y="72.0">-1</text>
  <rect x="16.0" y="84.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="27.5" y="94.0">1</text>
  <rect x="41.0" y="84.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="52.5" y="94.0">0</text>
  <rect x="16.0" y="106.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="27.5" y="116.0">1</text>
  <rect x="41.0" y="106.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="52.5" y="116.0">1</text>
  <tex class="mid small" x="40.0" y="143.0">Q</tex>
  </g>
  <text class="mid b" x="79" y="94">×</text>
  <g>
  <path d="M92.5 71.0 H88.0 V117.0 H92.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M161.5 71.0 H166.0 V117.0 H161.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="92.0" y="73.0" width="22.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="103.0" y="83.0">2</text>
  <rect x="116.0" y="73.0" width="22.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="127.0" y="83.0">1</text>
  <rect x="140.0" y="73.0" width="22.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="151.0" y="83.0">1</text>
  <rect x="92.0" y="95.0" width="22.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="103.0" y="105.0">1</text>
  <rect x="116.0" y="95.0" width="22.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="127.0" y="105.0">1</text>
  <rect x="140.0" y="95.0" width="22.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="151.0" y="105.0">2</text>
  <tex class="mid small" x="127.0" y="142.0">K^\top</tex>
  </g>
  <path class="edge" d="M170 94 H195" marker-end="url(#arrow)"/>
  <g>
  <path d="M204.5 60.0 H200.0 V128.0 H204.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M309.5 60.0 H314.0 V128.0 H309.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="204.0" y="62.0" width="34.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="221.0" y="72.0">2.12</text>
  <rect x="240.0" y="62.0" width="34.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <tex class="mid small clay" x="257.0" y="72.0">-\infty</tex>
  <rect x="276.0" y="62.0" width="34.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <tex class="mid small clay" x="293.0" y="72.0">-\infty</tex>
  <rect x="204.0" y="84.0" width="34.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="221.0" y="94.0">1.41</text>
  <rect x="240.0" y="84.0" width="34.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="257.0" y="94.0">0.71</text>
  <rect x="276.0" y="84.0" width="34.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <tex class="mid small clay" x="293.0" y="94.0">-\infty</tex>
  <rect x="204.0" y="106.0" width="34.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="221.0" y="116.0">2.12</text>
  <rect x="240.0" y="106.0" width="34.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="257.0" y="116.0">1.41</text>
  <rect x="276.0" y="106.0" width="34.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="293.0" y="116.0">2.12</text>
  <tex class="mid small" x="257.0" y="143.0">S_{{\mathrm{{mask}}}}</tex>
  </g>

  <text class="small b" x="14" y="182">② 按行归一化乘 V：每行是对历史值的加权平均</text>
  <g>
  <path d="M16.5 198.0 H12.0 V266.0 H16.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M115.5 198.0 H120.0 V266.0 H115.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="16.0" y="200.0" width="32.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="32.0" y="210.0">1.00</text>
  <rect x="50.0" y="200.0" width="32.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <text class="mid small" x="66.0" y="210.0" fill="var(--muted)">0</text>
  <rect x="84.0" y="200.0" width="32.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <text class="mid small" x="100.0" y="210.0" fill="var(--muted)">0</text>
  <rect x="16.0" y="222.0" width="32.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="32.0" y="232.0">0.67</text>
  <rect x="50.0" y="222.0" width="32.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="66.0" y="232.0">0.33</text>
  <rect x="84.0" y="222.0" width="32.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15" stroke-dasharray="2.5 2"/>
  <text class="mid small" x="100.0" y="232.0" fill="var(--muted)">0</text>
  <rect x="16.0" y="244.0" width="32.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="32.0" y="254.0">0.40</text>
  <rect x="50.0" y="244.0" width="32.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="66.0" y="254.0">0.20</text>
  <rect x="84.0" y="244.0" width="32.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="100.0" y="254.0">0.40</text>
  <tex class="mid small" x="66.0" y="281.0">P</tex>
  </g>
  <text class="mid b" x="132" y="232">×</text>
  <g>
  <path d="M144.5 198.0 H140.0 V266.0 H144.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M191.5 198.0 H196.0 V266.0 H191.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="144.0" y="200.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="155.5" y="210.0">3</text>
  <rect x="169.0" y="200.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="180.5" y="210.0">1</text>
  <rect x="144.0" y="222.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="155.5" y="232.0">1</text>
  <rect x="169.0" y="222.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="180.5" y="232.0">3</text>
  <rect x="144.0" y="244.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="155.5" y="254.0">2</text>
  <rect x="169.0" y="244.0" width="23.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="180.5" y="254.0">2</text>
  <tex class="mid small" x="168.0" y="281.0">V</tex>
  </g>
  <text class="mid b" x="208" y="232">=</text>
  <g>
  <path d="M220.5 198.0 H216.0 V266.0 H220.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M291.5 198.0 H296.0 V266.0 H291.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="220.0" y="200.0" width="35.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="237.5" y="210.0">3.00</text>
  <rect x="257.0" y="200.0" width="35.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="274.5" y="210.0">1.00</text>
  <rect x="220.0" y="222.0" width="35.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="237.5" y="232.0">2.34</text>
  <rect x="257.0" y="222.0" width="35.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="274.5" y="232.0">1.66</text>
  <rect x="220.0" y="244.0" width="35.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="237.5" y="254.0">2.20</text>
  <rect x="257.0" y="244.0" width="35.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="274.5" y="254.0">1.80</text>
  <tex class="mid small" x="256.0" y="281.0">O</tex>
  </g>

  <text class="small" x="14" y="318">第 2 行：0.67×[3,1] + 0.33×[1,3] = [2.34, 1.66]</text>
  <text class="small mute" x="14" y="342">第 1 行“猫”权重 [1,0,0]，完全看不到后两词</text>

  <rect class="panel" x="0" y="384" width="340" height="248" rx="12"/>
  <text class="caps" x="14" y="406">2 · DECODE（第 4 步单行解码 + 缓存追加）</text>
  <g>
  <path d="M16.5 432.0 H12.0 V456.0 H16.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M65.5 432.0 H70.0 V456.0 H65.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="16.0" y="434.0" width="24.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="28.0" y="444.0">0</text>
  <rect x="42.0" y="434.0" width="24.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="54.0" y="444.0">1</text>
  <tex class="mid small" x="41.0" y="471.0">q_4</tex>
  </g>
  <text class="mid b" x="83" y="444">×</text>
  <g>
  <path d="M96.5 422.0 H92.0 V468.0 H96.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M197.5 422.0 H202.0 V468.0 H197.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="96.0" y="424.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="108.0" y="434.0">2</text>
  <rect x="122.0" y="424.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="134.0" y="434.0">1</text>
  <rect x="148.0" y="424.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="160.0" y="434.0">1</text>
  <rect x="174.0" y="424.0" width="24.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="186.0" y="434.0">0</text>
  <rect x="96.0" y="446.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="108.0" y="456.0">1</text>
  <rect x="122.0" y="446.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="134.0" y="456.0">1</text>
  <rect x="148.0" y="446.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="160.0" y="456.0">2</text>
  <rect x="174.0" y="446.0" width="24.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="186.0" y="456.0">1</text>
  <tex class="mid small" x="147.0" y="483.0">K_{{1:4}}^\top</tex>
  </g>
  <path class="edge" d="M210 444 H234" marker-end="url(#arrow)"/>
  <text class="small b" x="240" y="444">[1, 1, 2, 1]</text>

  <g>
  <path d="M16.5 522.0 H12.0 V546.0 H16.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M145.5 522.0 H150.0 V546.0 H145.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="16.0" y="524.0" width="31.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="31.5" y="534.0">0.20</text>
  <rect x="49.0" y="524.0" width="31.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="64.5" y="534.0">0.20</text>
  <rect x="82.0" y="524.0" width="31.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="97.5" y="534.0">0.40</text>
  <rect x="115.0" y="524.0" width="31.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="130.5" y="534.0">0.20</text>
  <tex class="mid small" x="81.0" y="561.0">p_4\;(1\!\times\!4)</tex>
  </g>
  <text class="mid b" x="163" y="534">×</text>
  <g>
  <path d="M176.5 490.0 H172.0 V580.0 H176.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M225.5 490.0 H230.0 V580.0 H225.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="176.0" y="492.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="188.0" y="502.0">3</text>
  <rect x="202.0" y="492.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="214.0" y="502.0">1</text>
  <rect x="176.0" y="514.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="188.0" y="524.0">1</text>
  <rect x="202.0" y="514.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="214.0" y="524.0">3</text>
  <rect x="176.0" y="536.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="188.0" y="546.0">2</text>
  <rect x="202.0" y="536.0" width="24.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="214.0" y="546.0">2</text>
  <rect x="176.0" y="558.0" width="24.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="188.0" y="568.0">1</text>
  <rect x="202.0" y="558.0" width="24.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="214.0" y="568.0">-1</text>
  <tex class="mid small" x="201.0" y="595.0">V_{{1:4}}</tex>
  </g>
  <text class="mid b" x="242" y="534">=</text>
  <g>
  <path d="M254.5 522.0 H250.0 V546.0 H254.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M323.5 522.0 H328.0 V546.0 H323.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="254.0" y="524.0" width="34.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="271.0" y="534.0">1.80</text>
  <rect x="290.0" y="524.0" width="34.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="307.0" y="534.0">1.40</text>
  <tex class="mid small" x="289.0" y="561.0">o_4</tex>
  </g>

  <text class="small" x="14" y="612">仅算单排 [1×4] 概率，橙色为新追加的第 4 词键值</text>
</svg>
```

下面两组实测图把上述差异落实到了具体的字节数与运算量上。

第一张图测量了一座 6 层 `float32` 模型（$V=2000, D=256, L=6$，每参数 4 字节）的显存账本。它的静态参数共约 $5.82 \times 10^6$ 个（首尾嵌入与分类头约 $1.04 \times 10^6$ 个，6 层内部二维权重约 $4.72 \times 10^6$ 个），模型权重本身只占 $22.2\;\text{MB}$。

一旦开启训练（$B=16, T=64$），6 层暂存的前向激活一口气吃掉 $103.8\;\text{MB}$，是权重本体的近 5 倍。而在优化器状态上，`Muon+AdamW` 省掉了全部内部二维层的二阶矩 $V$，只给词表和归一化层留了约 $4.2\;\text{MB}$ 的二阶矩。

第二张图则记录了 4 层模型从 8 词前缀一路解码到第 120 词时，开启与关闭 `KV Cache` 的累计乘加次数对比。

```echarts title="6 层 Transformer 在推理与三种优化器训练模式下的显存构成对比" height="360" note="基于 6 层 Transformer（词表 $V=2000$，$D=256$，8 头，fp32，批大小 $B=16$，句长 $T=64$）实测张量字节。训练模式下需保留中间激活并分配梯度 $G$ 与状态张量；Muon+AdamW 省去了全部内部二维层的二阶矩 $V$（仅边界层保留 4.2 MB）。"
{"tooltip":{"trigger":"axis","axisPointer":{"type":"shadow"},"valueFormatter":"{value} MB"},"legend":{},"grid":{"top":68,"left":58,"right":16,"bottom":36},"xAxis":{"type":"category","axisLabel":{"interval":0},"data":["推理","纯 SGD","AdamW","Muon+AdamW"]},"yAxis":{"type":"value","max":200,"interval":50,"axisLabel":{"formatter":"{value} MB"}},"series":[{"name":"静态权重 W","type":"bar","stack":"vram","itemStyle":{"color":"var(--blue)"},"data":[22.2,22.2,22.2,22.2]},{"name":"KV Cache","type":"bar","stack":"vram","itemStyle":{"color":"var(--sky)"},"data":[12.0,0.0,0.0,0.0]},{"name":"梯度 G","type":"bar","stack":"vram","itemStyle":{"color":"var(--orange)"},"data":[0.0,22.2,22.2,22.2]},{"name":"动量 M","type":"bar","stack":"vram","itemStyle":{"color":"var(--violet)"},"data":[0.0,0.0,22.2,22.2]},{"name":"二阶矩 V","type":"bar","stack":"vram","itemStyle":{"color":"var(--clay)"},"data":[0.0,0.0,22.2,4.2]},{"name":"前向激活","type":"bar","stack":"vram","itemStyle":{"color":"var(--teal)"},"data":[0.2,103.8,103.8,103.8]}]}
```

```plot title="自回归解码从前缀 8 词推进至长度 120：KV Cache 将累计乘加降为近似线性" note="4 层 Transformer（$D=128$，词表 $V=512$），初始前缀长度 $T_0=8$（Prefill），随后从 $t=9$ 至 $t=120$ 连续执行 112 步自回归解码。累计乘加次数从 6,758.5M 降至 109.7M（减少 98.4%）。"
{"xlabel":"当前输入序列长度 $t$（$t=8$ 完成 Prefill，随后 $t=9 \\dots 120$ 连续解码 112 步）","legend":[{"label":"无 KV Cache（每步重算整句 $\\mathcal{O}(t D^2 + t^2 D)$）","color":"var(--clay)","shape":"dash"},{"label":"启用 KV Cache（每步仅算新词 $\\mathcal{O}(D^2 + t D)$）","color":"var(--teal)","shape":"line"},{"label":"避免的 98.4% 重复计算量","color":"var(--clay)","shape":"band"}],"data":{"kv":[{"t":8,"no_cache":6.9,"kv_cache":6.9},{"t":12,"no_cache":43.1,"kv_cache":10.3},{"t":16,"no_cache":93.4,"kv_cache":13.8},{"t":20,"no_cache":157.9,"kv_cache":17.3},{"t":24,"no_cache":236.6,"kv_cache":20.8},{"t":28,"no_cache":329.8,"kv_cache":24.3},{"t":32,"no_cache":437.6,"kv_cache":27.8},{"t":36,"no_cache":560.0,"kv_cache":31.4},{"t":40,"no_cache":697.3,"kv_cache":34.9},{"t":44,"no_cache":849.5,"kv_cache":38.5},{"t":48,"no_cache":1016.9,"kv_cache":42.1},{"t":52,"no_cache":1199.4,"kv_cache":45.7},{"t":56,"no_cache":1397.3,"kv_cache":49.4},{"t":60,"no_cache":1610.7,"kv_cache":53.0},{"t":64,"no_cache":1839.7,"kv_cache":56.7},{"t":68,"no_cache":2084.4,"kv_cache":60.4},{"t":72,"no_cache":2345.0,"kv_cache":64.1},{"t":76,"no_cache":2621.7,"kv_cache":67.8},{"t":80,"no_cache":2914.4,"kv_cache":71.5},{"t":84,"no_cache":3223.5,"kv_cache":75.2},{"t":88,"no_cache":3548.9,"kv_cache":79.0},{"t":92,"no_cache":3890.9,"kv_cache":82.8},{"t":96,"no_cache":4249.5,"kv_cache":86.6},{"t":100,"no_cache":4624.9,"kv_cache":90.4},{"t":104,"no_cache":5017.3,"kv_cache":94.2},{"t":108,"no_cache":5426.7,"kv_cache":98.1},{"t":112,"no_cache":5853.2,"kv_cache":101.9},{"t":116,"no_cache":6297.2,"kv_cache":105.8},{"t":120,"no_cache":6758.5,"kv_cache":109.7}]},"height":290,"narrowHeight":240,"y":{"label":"累计矩阵乘加次数（百万 MACs）","domain":[0,7300]},"x":{"label":null,"domain":[8,122]},"grid":true,"marks":[{"mark":"areaY","data":"kv","x":"t","y1":"kv_cache","y2":"no_cache","fill":"var(--clay)","fillOpacity":0.12},{"mark":"ruleX","data":[8],"stroke":"var(--stone)","strokeDasharray":"4 3"},{"mark":"line","data":"kv","x":"t","y":"no_cache","stroke":"var(--clay)","strokeWidth":2.2,"strokeDasharray":"6 4"},{"mark":"line","data":"kv","x":"t","y":"kv_cache","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":"kv","x":"t","y":"no_cache","fill":"var(--clay)","r":2.5,"tip":["t","no_cache","kv_cache"]},{"mark":"text","data":[{"t":10,"y":5600,"txt":"← Prefill 结束 (t=8)"}],"x":"t","y":"y","text":"txt","textAnchor":"start","fill":"var(--muted)"},{"mark":"text","data":[{"t":108,"y":6650,"txt":"6,759M"}],"x":"t","y":"y","text":"txt","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"t":116,"y":520,"txt":"110M (-98.4%)"}],"x":"t","y":"y","text":"txt","textAnchor":"end","fill":"var(--teal)"}]}
```

在明确“优化器只作用在第一类静态参数 $\Theta$ 上”之后，下一个需要解决的问题是：每一轮迭代中，指导参数更新的梯度矩阵 $G$ 是如何从标量损失一步步算出来的？

---

## 二、归一化尺度不变性与矩阵反向传播推导

明确了“优化器只改写静态参数 $\Theta$”之后，我们把镜头拉近到单个训练步（Step）内部，把反向传播的微积分账算清楚。

这一节不仅会揭示为什么前向激活必须占着显存不放，还会直接导出贯穿后文的两条核心线索：**`RMSNorm` 对隐藏层输入尺度的钉死作用**，以及**线性层梯度矩阵 $G$ 的秩一外积求和结构**。

### 2.1 `RMSNorm` 的由来与梯度正交性质推导

初代 Transformer 用的是 `LayerNorm`。对单个词向量 $x \in \mathbb{R}^D$，它要先算均值 $\mu = \frac{1}{D}\sum_{i=1}^D x_i$，再算中心化方差 $\sigma^2 = \frac{1}{D}\sum_{i=1}^D (x_i - \mu)^2$，最后输出 $\frac{x - \mu}{\sqrt{\sigma^2 + \epsilon}} \odot \gamma + \beta$。在 GPU 上，因为方差依赖均值，每个向量都得做两趟跨通道归约（Reduction），读写显存的等待时间远超乘加计算本身。

2019 年，Zhang 与 Sennrich 提出了一个大胆的减法假设：`LayerNorm` 之所以能稳住深层训练，靠的并不是“减去均值”（平移不变性），而是“除以向量模长”（缩放不变性）[@zhang2019]。

直接砍掉均值中心化与偏置 $\beta$，就得到了如今大模型标配的均方根层归一化（`RMSNorm`）：

$$
r(x) = \sqrt{\frac{1}{D} \sum_{i=1}^{D} x_i^2 + \epsilon}, \qquad y = \mathrm{RMSNorm}(x) = \frac{x}{r(x)} \odot \gamma = \hat{x} \odot \gamma
$$

其中 $\gamma \in \mathbb{R}^D$ 初始化为全 $1$。这个极简算子带来了两条漂亮的几何性质。

**第一条性质在前向：把输入均方根钉在单位尺度。** 当 $\epsilon \to 0$ 且 $\gamma = \mathbf{1}$ 时，归一化向量 $\hat{x} = x / r(x)$ 恒满足 $\frac{1}{D}\|\hat{x}\|_2^2 = 1$。也就是说，紧跟在 `RMSNorm` 后面的任何线性层 $W$，吃进来的词向量在均方根意义下永远处在 $1$ 附近。到了第 4 节，正是这一性质直接决定了我们该用什么算子范数去衡量权重更新 $\Delta W$。

**第二条性质在反向：梯度与输入径向正交，且自带反比阻尼。** 令 $\epsilon = 0$，对任意正数 $\alpha > 0$，都有 $\mathrm{RMSNorm}(\alpha x) = \mathrm{RMSNorm}(x)$。单纯把输入拉长 $\alpha$ 倍，输出纹丝不动。

我们来验证这对反向梯度意味着什么。设上游传回对 $y$ 的导数为 $\delta_y = \partial L / \partial y \in \mathbb{R}^D$，记 $\tilde{\delta} = \delta_y \odot \gamma$。利用 $\partial r / \partial x_j = \frac{x_j}{D r}$，对第 $j$ 个输入分量求偏导：

$$
\frac{\partial L}{\partial x_j} = \sum_{i=1}^{D} \tilde{\delta}_i \frac{\partial}{\partial x_j}\left(\frac{x_i}{r}\right) = \frac{\tilde{\delta}_j}{r} - \sum_{i=1}^{D} \tilde{\delta}_i \frac{x_i x_j}{D r^3} = \frac{1}{r}\left(\tilde{\delta}_j - \hat{x}_j \cdot \frac{1}{D}\langle \tilde{\delta}, \hat{x} \rangle\right)
$$

收拢成向量形式，输入梯度与缩放参数梯度分别为：

$$
\nabla_x L = \frac{1}{r(x)}\left(I_D - \frac{\hat{x} \hat{x}^\top}{D}\right) \tilde{\delta}, \qquad \nabla_\gamma L = \delta_y \odot \hat{x}
$$

注意 $\frac{1}{D}\hat{x}^\top \hat{x} = 1$。拿 $x^\top = r(x)\hat{x}^\top$ 左乘 $\nabla_x L$，两项恰好抵消：

$$
x^\top \nabla_x L = \hat{x}^\top \tilde{\delta} - \frac{\hat{x}^\top \hat{x}}{D} \hat{x}^\top \tilde{\delta} = 0
$$

内积恒等于零！这意味着回传给 $x$ 的梯度严格躺在球面的切空间里，绝不会顺着径向去盲目推高或压扁 $x$ 的模长。同时，门外的系数 $\frac{1}{r(x)}$ 还充当了自动减震器：一旦某层激活模长意外暴涨 $\alpha$ 倍，回传梯度就会自动缩水为 $1/\alpha$，稳稳压住深层残差网络的梯度爆炸[@zhang2019]。

### 2.2 交叉熵损失对 Logits 的导数推导

接着走到前向流水线的终点，看损失函数如何启动反向传播的第一棒。

设批大小 $B=20$、句长 $T=16$，整个批次共有 $N = B \times T = 320$ 个预测位置。把末端打分张量展平成二维矩阵 $Z \in \mathbb{R}^{N \times V}$，第 $n$ 个位置的真实下一词记作 $y_n \in \{0, \dots, V-1\}$。

交叉熵损失就是这 $N$ 个位置上真实词负对数似然的算术平均：

$$
L = -\frac{1}{N} \sum_{n=1}^{N} \ln P_{n, y_n} = -\frac{1}{N} \sum_{n=1}^{N} \left(Z_{n, y_n} - \ln \sum_{m=0}^{V-1} e^{Z_{n, m}}\right)
$$

其中 $P_{n, k} = e^{Z_{n,k}} / \sum_{m=0}^{V-1} e^{Z_{n,m}}$。顺便一提，刚随机初始化时各词打分差不多，$P_{n, k} \approx 1/V$，所以开训第 1 步的理论损失一定落在 $\ln V$ 附近（词表 $V=1000$ 时约为 $\ln 1000 \approx 6.91$；$V=128$ 时约为 $4.85$）。这是检查训练代码有没有写错的一个极佳标尺。

现在对第 $n$ 行第 $j$ 列的打分 $Z_{n, j}$ 求偏导。因为第 $n$ 行的概率只跟第 $n$ 行自己的打分有关，求和号里别的样本全部导数为零：

$$
\frac{\partial L}{\partial Z_{n, j}} = -\frac{1}{N}\left(\frac{\partial Z_{n, y_n}}{\partial Z_{n, j}} - \frac{1}{\sum_{m=0}^{V-1} e^{Z_{n, m}}} \cdot \frac{\partial}{\partial Z_{n, j}} \sum_{m=0}^{V-1} e^{Z_{n, m}}\right) = -\frac{1}{N}\left(\mathbf{1}_{j = y_n} - \frac{e^{Z_{n, j}}}{\sum_{m=0}^{V-1} e^{Z_{n, m}}}\right)
$$

化简后，反向传播起点的误差矩阵 $\Delta^{(Z)} = \partial L / \partial Z \in \mathbb{R}^{N \times V}$ 干净得令人愉悦：

$$
\Delta_{n, j}^{(Z)} = \frac{\partial L}{\partial Z_{n, j}} = \frac{1}{N}\left(P_{n, j} - \mathbf{1}_{j = y_n}\right)
$$

“预测概率减去独热真值，再除以样本数”，仅此而已。

在标准答案那一列（$j = y_n$），导数是负数 $(P_{n, y_n} - 1)/N$，指引负梯度更新把正确词的打分往上抬。在其余所有错词列（$j \neq y_n$），导数是正数 $P_{n, j}/N$——哪个错词分到的概率越离谱，把它往下按的力道就越重。而且每一行的导数加起来恒等于 $\frac{1}{N}(1 - 1) = 0$，一推一拉严丝合缝。

### 2.3 线性层矩阵求导与梯度奇异值偏斜的根源

拿到顶层误差之后，再看网络内部任意一层无偏置线性变换 $Y = X W^\top$ 是怎么分头算出权重梯度和下传梯度的。

把批次与序列维合并记作 $N = B \cdot T$。此时输入是 $X \in \mathbb{R}^{N \times d_{\mathrm{in}}}$，权重是 $W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$，输出是 $Y \in \mathbb{R}^{N \times d_{\mathrm{out}}}$，上游刚刚传下来的输出误差矩阵则是 $\Delta = \partial L / \partial Y \in \mathbb{R}^{N \times d_{\mathrm{out}}}$。

先把 $Y$ 按元素展开成标量求和：

$$
Y_{n, i} = \sum_{k=1}^{d_{\mathrm{in}}} X_{n, k} W_{i, k}
$$

盯住其中一个权重元素 $W_{i, j}$，看它参与了哪些输出的计算：在全部 $N$ 个词元位置上，$W_{i, j}$ 都只出现在第 $i$ 列输出 $Y_{n, i}$ 的第 $k = j$ 项里，局部偏导就是 $\partial Y_{n, i} / \partial W_{i, j} = X_{n, j}$。

按复合函数链式法则，把全部 $N$ 个样本位置传回来的影响加总：

$$
G_{i, j} \triangleq \frac{\partial L}{\partial W_{i, j}} = \sum_{n=1}^{N} \sum_{p=1}^{d_{\mathrm{out}}} \frac{\partial L}{\partial Y_{n, p}} \frac{\partial Y_{n, p}}{\partial W_{i, j}} = \sum_{n=1}^{N} \Delta_{n, i} X_{n, j} = \sum_{n=1}^{N} (\Delta^\top)_{i, n} X_{n, j}
$$

对照矩阵乘法定义，右边正好是 $\Delta^\top\;(d_{\mathrm{out}} \times N)$ 乘以 $X\;(N \times d_{\mathrm{in}})$ 的第 $(i, j)$ 个格子！

用完全相同的手法对输入元素 $X_{n, j}$ 求偏导，因为它同时喂给了该行的全部 $d_{\mathrm{out}}$ 个输出通道，加总就得到 $(\Delta W)_{n, j}$。把这两条核心反向传播公式并排放在一起：

$$
G = \frac{\partial L}{\partial W} = \Delta^\top X = \sum_{n=1}^{N} \delta_n x_n^\top \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}, \qquad \frac{\partial L}{\partial X} = \Delta W \in \mathbb{R}^{N \times d_{\mathrm{in}}}
$$

式中 $\delta_n \in \mathbb{R}^{d_{\mathrm{out}}}$ 与 $x_n \in \mathbb{R}^{d_{\mathrm{in}}}$ 分别是第 $n$ 个词元位置的上游误差列向量和本层输入列向量。

```sketch title="LLM 训练全流程矩阵维度图解：用拆开的方块追踪前向驻留、反向转置消维与双优化器更新" note="设单步总词元数 $N = B \times T = 5$（橙色行）、输入维 $d_{\mathrm{in}}=4$（蓝色列）、输出维 $d_{\mathrm{out}}=3$（紫色列）。Stage 2 右侧清晰展示了 $\Delta_Y^\top$ 横过来的 $5$ 列如何与前向暂存的 $X$ 竖着的 $5$ 行一一配对消去，留下与 $W\;[3\times 4]$ 完全同形状的 $12$ 格梯度矩阵 $G$。"
<svg viewBox="0 0 704 684">
  <rect class="panel" x="0" y="0" width="704" height="196" rx="12"/>
  <text class="caps" x="18" y="22">STAGE 1 · FORWARD &amp; LOSS</text>
  <text class="small b" x="218" y="22">前向并行与全位置求损（设批次总词元 N=5 行、输入维 4、输出维 3、词表 V=6）</text>

  <g>
    <line x1="48" y1="68" x2="48" y2="135" stroke="var(--clay)" stroke-width="2"/>
    <line x1="45" y1="68" x2="51" y2="68" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="45" y1="135" x2="51" y2="135" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="43" y="101.5">N=5</tex>
    <line x1="54" y1="62" x2="107" y2="62" stroke="var(--blue)" stroke-width="2"/>
    <line x1="54" y1="59" x2="54" y2="65" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="107" y1="59" x2="107" y2="65" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="80.5" y="51">d_{{\mathrm{{in}}}}=4</tex>
    <path d="M56 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM70 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM84 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM98 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM56 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM70 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM84 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM98 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM56 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM70 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM84 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM98 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM56 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM70 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM84 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM98 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM56 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM70 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM84 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM98 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="80.5" y="151">X\;(5\!\times\!4)</tex>
  </g>
  <rect class="window" x="12" y="44" width="106" height="118" rx="6"/>
  <text class="mid small accent" x="65" y="176">留存显存供 Stage 3 用</text>

  <tex class="mid b" x="134" y="102">\times</tex>
  <g>
    <line x1="166" y1="75" x2="166" y2="128" stroke="var(--blue)" stroke-width="2"/>
    <line x1="163" y1="75" x2="169" y2="75" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="163" y1="128" x2="169" y2="128" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="end small blue" x="161" y="101.5">4</tex>
    <line x1="172" y1="69" x2="211" y2="69" stroke="var(--violet)" stroke-width="2"/>
    <line x1="172" y1="66" x2="172" y2="72" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="211" y1="66" x2="211" y2="72" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="191.5" y="58">d_{{\mathrm{{out}}}}=3</tex>
    <path d="M174 75h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM188 75h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM202 75h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM174 89h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM188 89h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM202 89h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM174 103h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM188 103h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM202 103h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM174 117h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM188 117h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM202 117h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <tex class="mid small" x="191.5" y="150">W^\top\;(4\!\times\!3)</tex>
  </g>
  <path d="M80.5 60.0 Q126.2 52.0 164.0 101.5" fill="none" stroke="var(--blue)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="226" y="102">=</tex>
  <g>
    <line x1="252" y1="68" x2="252" y2="135" stroke="var(--clay)" stroke-width="2"/>
    <line x1="249" y1="68" x2="255" y2="68" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="249" y1="135" x2="255" y2="135" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="247" y="101.5">5</tex>
    <line x1="258" y1="62" x2="297" y2="62" stroke="var(--violet)" stroke-width="2"/>
    <line x1="258" y1="59" x2="258" y2="65" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="297" y1="59" x2="297" y2="65" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="277.5" y="51">3</tex>
    <path d="M260 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM274 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM288 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM260 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM274 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM288 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM260 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM274 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM288 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM260 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM274 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM288 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM260 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM274 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM288 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="277.5" y="151">Y\;(5\!\times\!3)</tex>
  </g>
  <path class="edge" d="M307 102 H351" marker-end="url(#arrow)"/>
  <text class="mid small" x="329" y="89">经各层至</text>
  <text class="mid small" x="329" y="118">分类头</text>

  <g>
    <line x1="378" y1="68" x2="378" y2="135" stroke="var(--clay)" stroke-width="2"/>
    <line x1="375" y1="68" x2="381" y2="68" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="375" y1="135" x2="381" y2="135" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="373" y="101.5">5</tex>
    <line x1="384" y1="62" x2="465" y2="62" stroke="var(--orange)" stroke-width="2"/>
    <line x1="384" y1="59" x2="384" y2="65" stroke="var(--orange)" stroke-width="1.5"/>
    <line x1="465" y1="59" x2="465" y2="65" stroke="var(--orange)" stroke-width="1.5"/>
    <text class="mid small b" x="424.5" y="51" fill="var(--orange-ink)">V=6 候选词</text>
    <path d="M386 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM386 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM386 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM386 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM386 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <rect x="412" y="68" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <rect x="454" y="82" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <rect x="398" y="96" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <rect x="440" y="110" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <rect x="384" y="124" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="mid small" x="424.5" y="151">Z\;(5\!\times\!6)</tex>
  </g>
  <path class="edge" d="M475 102 H533" marker-end="url(#arrow)"/>
  <text class="mid small" x="504" y="88">5 行平均</text>
  <text class="mid small mute" x="504" y="118">交叉熵</text>

  <g>
    <rect x="554" y="88" width="24" height="24" rx="4" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.6"/>
    <tex class="mid small b" x="566" y="100">L</tex>
    <text class="small b" x="588" y="96">单格标量 (1×1)</text>
    <text class="small mute" x="588" y="114">反向求导起点</text>
  </g>

  <rect class="panel" x="0" y="212" width="704" height="246" rx="12"/>
  <text class="caps" x="18" y="234">STAGE 2 &amp; 3 · BACKWARD</text>
  <text class="small b" x="196" y="234">同一份上游误差 [5×3] 分出两条矩阵乘法：左支传误差，右支转置消去 N=5 算权重梯度</text>

  <text class="small b" x="20" y="260">左支（传向浅层）：内维 3（紫）消去，保留 N=5 行</text>
  <g>
    <line x1="44" y1="298" x2="44" y2="365" stroke="var(--clay)" stroke-width="2"/>
    <line x1="41" y1="298" x2="47" y2="298" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="41" y1="365" x2="47" y2="365" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="39" y="331.5">N=5</tex>
    <line x1="50" y1="292" x2="89" y2="292" stroke="var(--violet)" stroke-width="2"/>
    <line x1="50" y1="289" x2="50" y2="295" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="89" y1="289" x2="89" y2="295" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="69.5" y="281">3</tex>
    <path d="M52 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM66 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM80 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM52 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM66 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM80 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM52 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM66 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM80 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM52 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM66 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM80 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM52 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM66 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM80 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
    <tex class="mid small" x="69.5" y="381">\Delta_Y\;(5\!\times\!3)</tex>
  </g>
  <tex class="mid b" x="106" y="332">\times</tex>
  <g>
    <line x1="134" y1="312" x2="134" y2="351" stroke="var(--violet)" stroke-width="2"/>
    <line x1="131" y1="312" x2="137" y2="312" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="131" y1="351" x2="137" y2="351" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="end small violet" x="129" y="331.5">3</tex>
    <line x1="140" y1="306" x2="193" y2="306" stroke="var(--blue)" stroke-width="2"/>
    <line x1="140" y1="303" x2="140" y2="309" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="193" y1="303" x2="193" y2="309" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="166.5" y="295">d_{{\mathrm{{in}}}}=4</tex>
    <path d="M142 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM156 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM170 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM184 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM142 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM156 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM170 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM184 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM142 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM156 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM170 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM184 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <tex class="mid small" x="166.5" y="373">W\;(3\!\times\!4)</tex>
  </g>
  <path d="M69.5 290.0 Q104.8 282.0 132.0 331.5" fill="none" stroke="var(--violet)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="208" y="332">=</tex>
  <g>
    <line x1="234" y1="298" x2="234" y2="365" stroke="var(--clay)" stroke-width="2"/>
    <line x1="231" y1="298" x2="237" y2="298" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="231" y1="365" x2="237" y2="365" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="229" y="331.5">5</tex>
    <line x1="240" y1="292" x2="293" y2="292" stroke="var(--blue)" stroke-width="2"/>
    <line x1="240" y1="289" x2="240" y2="295" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="293" y1="289" x2="293" y2="295" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="266.5" y="281">4</tex>
    <path d="M242 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM256 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM270 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM284 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM242 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM256 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM270 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM284 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM242 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM256 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM270 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM284 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM242 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM256 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM270 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM284 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM242 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM256 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM270 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM284 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
    <tex class="mid small" x="266.5" y="381">\Delta_X\;(5\!\times\!4)</tex>
  </g>
  <text class="small mute" x="20" y="438">前向乘转置 [4×3]，反向乘原矩阵 W [3×4]</text>

  <line x1="322" y1="250" x2="322" y2="444" stroke="var(--line)" stroke-dasharray="4 3"/>

  <text class="small b" x="340" y="260">右支（算参数梯度）：词元维 N=5（橙）配对求和消去</text>
  <g>
    <line x1="362" y1="312" x2="362" y2="351" stroke="var(--violet)" stroke-width="2"/>
    <line x1="359" y1="312" x2="365" y2="312" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="359" y1="351" x2="365" y2="351" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="end small violet" x="357" y="331.5">3</tex>
    <line x1="368" y1="306" x2="435" y2="306" stroke="var(--clay)" stroke-width="2"/>
    <line x1="368" y1="303" x2="368" y2="309" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="435" y1="303" x2="435" y2="309" stroke="var(--clay)" stroke-width="1.5"/>
    <text class="mid small b" x="401.5" y="295" fill="var(--clay-ink)">N=5 横躺</text>
    <path d="M370 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM384 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM398 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM412 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM426 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM370 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM384 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM398 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM412 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM426 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM370 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM384 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM398 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM412 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM426 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
    <tex class="mid small" x="401.5" y="373">\Delta_Y^\top\;(3\!\times\!5)</tex>
  </g>
  <tex class="mid b" x="454" y="332">\times</tex>
  <g>
    <line x1="486" y1="298" x2="486" y2="365" stroke="var(--clay)" stroke-width="2"/>
    <line x1="483" y1="298" x2="489" y2="298" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="483" y1="365" x2="489" y2="365" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="481" y="331.5">5</tex>
    <line x1="492" y1="292" x2="545" y2="292" stroke="var(--blue)" stroke-width="2"/>
    <line x1="492" y1="289" x2="492" y2="295" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="545" y1="289" x2="545" y2="295" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="518.5" y="281">d_{{\mathrm{{in}}}}=4</tex>
    <path d="M494 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM508 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM522 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM536 298h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM494 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM508 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM522 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM536 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM494 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM508 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM522 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM536 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM494 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM508 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM522 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM536 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM494 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM508 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM522 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM536 354h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="518.5" y="381">X\;(5\!\times\!4)</tex>
  </g>
  <path d="M401.5 304.0 Q446.8 296.0 484.0 331.5" fill="none" stroke="var(--clay)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="564" y="332">=</tex>
  <g>
    <line x1="594" y1="312" x2="594" y2="351" stroke="var(--violet)" stroke-width="2"/>
    <line x1="591" y1="312" x2="597" y2="312" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="591" y1="351" x2="597" y2="351" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="end small violet" x="589" y="331.5">3</tex>
    <line x1="600" y1="306" x2="653" y2="306" stroke="var(--blue)" stroke-width="2"/>
    <line x1="600" y1="303" x2="600" y2="309" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="653" y1="303" x2="653" y2="309" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="626.5" y="295">4</tex>
    <path d="M602 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM616 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM630 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM644 312h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM602 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM616 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM630 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM644 326h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM602 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM616 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM630 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM644 340h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="626.5" y="373">G\;(3\!\times\!4)</tex>
  </g>
  <text class="small accent" x="340" y="438">公共维 N=5 消去，G 恒为 [3×4]，与参数 W 逐格一致</text>

  <rect class="panel" x="0" y="474" width="704" height="210" rx="12"/>
  <text class="caps" x="18" y="496">STAGE 4 · OPTIMIZER STEP</text>
  <text class="small b" x="210" y="496">拿到同为 [3×4] 的 12 格梯度矩阵 G 后，逐元素 AdamW 与矩阵谱 Muon 的更新对比</text>

  <text class="small b" x="20" y="522">A · 逐元素优化器 AdamW：12 个小方格各自独立缩放</text>
  <g>
    <path d="M26 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM40 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM54 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM68 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM26 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM40 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM54 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM68 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM26 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM40 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM54 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM68 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="50.5" y="595">G\;(3\!\times\!4)</tex>
  </g>
  <tex class="mid b" x="88" y="560">+</tex>
  <g>
    <path d="M102 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM116 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM130 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM144 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM102 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM116 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM130 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM144 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM102 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM116 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM130 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM144 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <tex class="mid small" x="126.5" y="595">M\;(3\!\times\!4)</tex>
  </g>
  <tex class="mid b" x="164" y="560">\div</tex>
  <g>
    <path d="M178 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM192 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM206 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM220 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM178 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM192 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM206 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM220 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM178 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM192 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM206 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM220 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
    <tex class="mid small" x="202.5" y="595">\sqrt{\hat{V}}\;(3\!\times\!4)</tex>
  </g>
  <path class="edge hot" d="M236 560 H262" marker-end="url(#arrow)"/>
  <g>
    <path d="M268 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM282 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM296 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM310 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM268 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM282 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM296 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM310 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM268 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM282 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM296 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM310 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <tex class="mid small" x="292.5" y="595">W_{\mathrm{new}}\;(3\!\times\!4)</tex>
  </g>
  <text class="small mute" x="20" y="622">格与格互不通气（适合按行解耦的词嵌入表与分类头）</text>
  <text class="small mute" x="20" y="642">需常驻 M 和 V 两套 12 格状态表</text>

  <line x1="346" y1="510" x2="346" y2="664" stroke="var(--line)" stroke-dasharray="4 3"/>

  <text class="small b" x="364" y="522">B · 矩阵谱优化器 Muon：省去 V，整张 [3×4] 经 5 步正交化</text>
  <g>
    <path d="M370 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM384 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM398 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM412 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM370 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM384 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM398 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM412 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM370 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM384 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM398 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM412 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="394.5" y="595">G\;(3\!\times\!4)</tex>
  </g>
  <tex class="mid b" x="432" y="560">+</tex>
  <g>
    <path d="M446 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM460 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM474 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM488 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM446 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM460 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM474 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM488 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM446 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM460 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM474 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM488 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
    <tex class="mid small" x="470.5" y="595">M\;(3\!\times\!4)</tex>
  </g>
  <path class="edge" d="M504 560 H544" marker-end="url(#arrow)"/>
  <text class="mid small b" x="524" y="546" fill="var(--teal-ink)">NS5</text>
  <g>
    <rect x="546" y="536" width="61" height="47" rx="4" fill="none" stroke="var(--teal)" stroke-width="1.5"/>
    <path d="M552 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM566 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM580 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM594 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM552 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM566 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM580 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM594 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM552 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM566 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM580 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM594 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="576.5" y="599">O_t\approx UV^\top</tex>
  </g>
  <path class="edge hot" d="M614 560 H634" marker-end="url(#arrow)"/>
  <g>
    <path d="M640 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM654 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM668 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM682 540h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM640 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM654 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM668 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM682 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM640 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM654 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM668 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM682 568h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <tex class="mid small" x="664.5" y="595">W_{\mathrm{new}}</tex>
  </g>
  <text class="small accent" x="364" y="622">整张算子正交化拉平全部奇异值（专责内部二维线性层）</text>
  <text class="small" x="364" y="642">无需分配二阶矩 V [3×4]，优化器状态显存减半</text>
</svg>
<svg viewBox="0 0 340 660">
  <rect class="panel" x="0" y="0" width="340" height="190" rx="12"/>
  <text class="caps" x="16" y="22">1 · FORWARD（N=5 行并行与留存）</text>
  <g>
    <line x1="36" y1="62" x2="36" y2="122.0" stroke="var(--clay)" stroke-width="2"/>
    <line x1="33" y1="62" x2="39" y2="62" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="33" y1="122.0" x2="39" y2="122.0" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="31" y="92.0">5</tex>
    <line x1="42" y1="56" x2="89.5" y2="56" stroke="var(--blue)" stroke-width="2"/>
    <line x1="42" y1="53" x2="42" y2="59" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="89.5" y1="53" x2="89.5" y2="59" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="65.8" y="45">4</tex>
    <path d="M44 62h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 62h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 62h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 62h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM44 74.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 74.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 74.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 74.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM44 87h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 87h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 87h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 87h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM44 99.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 99.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 99.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 99.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM44 112h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 112h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 112h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 112h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="65.8" y="137.0">X\;(5\!\times\!4)</tex>
  </g>
  <tex class="mid b" x="104" y="92">\times</tex>
  <g>
    <line x1="130" y1="68" x2="130" y2="115.5" stroke="var(--blue)" stroke-width="2"/>
    <line x1="127" y1="68" x2="133" y2="68" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="127" y1="115.5" x2="133" y2="115.5" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="end small blue" x="125" y="91.8">4</tex>
    <line x1="136" y1="62" x2="171.0" y2="62" stroke="var(--violet)" stroke-width="2"/>
    <line x1="136" y1="59" x2="136" y2="65" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="171.0" y1="59" x2="171.0" y2="65" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="153.5" y="51">3</tex>
    <path d="M138 68h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM150.5 68h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM163 68h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM138 80.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM150.5 80.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM163 80.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM138 93h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM150.5 93h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM163 93h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM138 105.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM150.5 105.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM163 105.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <tex class="mid small" x="153.5" y="135.5">W^\top</tex>
  </g>
  <path d="M65.8 54.0 Q100.9 46.0 128.0 91.8" fill="none" stroke="var(--blue)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="184" y="92">=</tex>
  <g>
    <path d="M200 62h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM212.5 62h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM225 62h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM200 74.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM212.5 74.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM225 74.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM200 87h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM212.5 87h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM225 87h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM200 99.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM212.5 99.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM225 99.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM200 112h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM212.5 112h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM225 112h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="215.5" y="137.0">Y\;(5\!\times\!3)</tex>
  </g>
  <path class="edge" d="M242 92 H276" marker-end="url(#arrow)"/>
  <rect x="282" y="80" width="24" height="24" rx="4" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
  <tex class="mid small b" x="294" y="92">L</tex>
  <text class="small" x="16" y="168">X [5×4] 必须留在显存，供下方反向求导乘积读取</text>

  <rect class="panel" x="0" y="206" width="340" height="236" rx="12"/>
  <text class="caps" x="16" y="228">2 · BACKWARD（转置消去长边 N=5）</text>
  <text class="small b" x="16" y="252">权重梯度：横向 5 列与纵向 5 行配对消去</text>
  <g>
    <line x1="36" y1="298" x2="36" y2="333.0" stroke="var(--violet)" stroke-width="2"/>
    <line x1="33" y1="298" x2="39" y2="298" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="33" y1="333.0" x2="39" y2="333.0" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="end small violet" x="31" y="315.5">3</tex>
    <line x1="42" y1="292" x2="102.0" y2="292" stroke="var(--clay)" stroke-width="2"/>
    <line x1="42" y1="289" x2="42" y2="295" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="102.0" y1="289" x2="102.0" y2="295" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="mid small clay" x="72.0" y="281">N=5</tex>
    <path d="M44 298h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 298h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 298h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 298h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM94 298h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM44 310.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 310.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 310.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 310.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM94 310.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM44 323h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM56.5 323h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM69 323h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM81.5 323h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM94 323h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
    <tex class="mid small" x="72.0" y="355.0">\Delta_Y^\top\;(3\!\times\!5)</tex>
  </g>
  <tex class="mid b" x="118" y="316">\times</tex>
  <g>
    <line x1="148" y1="286" x2="148" y2="346.0" stroke="var(--clay)" stroke-width="2"/>
    <line x1="145" y1="286" x2="151" y2="286" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="145" y1="346.0" x2="151" y2="346.0" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="143" y="316.0">5</tex>
    <line x1="154" y1="280" x2="201.5" y2="280" stroke="var(--blue)" stroke-width="2"/>
    <line x1="154" y1="277" x2="154" y2="283" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="201.5" y1="277" x2="201.5" y2="283" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="177.8" y="269">4</tex>
    <path d="M156 286h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM168.5 286h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM181 286h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM193.5 286h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM156 298.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM168.5 298.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM181 298.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM193.5 298.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM156 311h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM168.5 311h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM181 311h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM193.5 311h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM156 323.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM168.5 323.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM181 323.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM193.5 323.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM156 336h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM168.5 336h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM181 336h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM193.5 336h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="177.8" y="361.0">X\;(5\!\times\!4)</tex>
  </g>
  <path d="M72.0 290.0 Q113.0 282.0 146.0 316.0" fill="none" stroke="var(--clay)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <tex class="mid b" x="216" y="316">=</tex>
  <g>
    <line x1="242" y1="298" x2="242" y2="333.0" stroke="var(--violet)" stroke-width="2"/>
    <line x1="239" y1="298" x2="245" y2="298" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="239" y1="333.0" x2="245" y2="333.0" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="end small violet" x="237" y="315.5">3</tex>
    <line x1="248" y1="292" x2="295.5" y2="292" stroke="var(--blue)" stroke-width="2"/>
    <line x1="248" y1="289" x2="248" y2="295" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="295.5" y1="289" x2="295.5" y2="295" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="271.8" y="281">4</tex>
    <path d="M250 298h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM262.5 298h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM275 298h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM287.5 298h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM250 310.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM262.5 310.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM275 310.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM287.5 310.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM250 323h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM262.5 323h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM275 323h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM287.5 323h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
    <tex class="mid small" x="271.8" y="355.0">G\;(3\!\times\!4)</tex>
  </g>
  <text class="small accent" x="16" y="394">N=5 求和消去，G [3×4] 与权重 W [3×4] 逐格同形</text>
  <text class="small mute" x="16" y="418">另一支路 [5×3]×[3×4] = [5×4] 继续向浅层回传</text>

  <rect class="panel" x="0" y="458" width="340" height="202" rx="12"/>
  <text class="caps" x="16" y="480">3 · OPTIMIZER（逐格 vs 整阵更新）</text>
  <g>
    <path d="M20 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM32.5 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM45 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM57.5 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM20 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM32.5 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM45 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM57.5 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM20 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM32.5 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM45 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM57.5 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  </g>
  <tex class="mid b" x="76" y="519">+</tex>
  <g>
    <path d="M90 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM102.5 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM115 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM127.5 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM90 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM102.5 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM115 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM127.5 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM90 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM102.5 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM115 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM127.5 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  </g>
  <path class="edge" d="M142 519 H178" marker-end="url(#arrow)"/>
  <text class="mid small b" x="160" y="507" fill="var(--teal-ink)">NS5</text>
  <g>
    <rect x="180" y="498" width="53.5" height="41.0" rx="3" fill="none" stroke="var(--teal)" stroke-width="1.4"/>
    <path d="M185 501h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM197.5 501h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM210 501h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM222.5 501h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM185 513.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM197.5 513.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM210 513.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM222.5 513.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM185 526h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM197.5 526h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM210 526h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM222.5 526h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  </g>
  <path class="edge hot" d="M242 519 H266" marker-end="url(#arrow)"/>
  <g>
    <path d="M272 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM284.5 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM297 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM309.5 502h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM272 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM284.5 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM297 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM309.5 514.5h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM272 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM284.5 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM297 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM309.5 527h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
  </g>
  <text class="small b" x="16" y="566">Muon：整张 [3×4] 算子谱正交化，省去二阶矩 V 表</text>
  <text class="small" x="16" y="592">AdamW：额外存 V [3×4]，12 个方格各自独立缩放</text>
  <text class="small mute" x="16" y="618">内部二维层归 Muon，词表/分类头归 AdamW</text>
</svg>
```

别小看这一行矩阵求导公式，它一口气打通了训练工程与优化理论里的四个核心疑问：

1. **为什么梯度 $G$ 永远和权重 $W$ 形状一致？** 在 $\Delta^\top X$ 的矩阵乘法里，公共内维恰好是样本词元数 $N$。无论批大小 $B$ 和句长 $T$ 怎么变，$N$ 都会在求和收缩中消掉，只留下干净的 $(d_{\mathrm{out}}, d_{\mathrm{in}})$。
2. **为什么训练显存远超推理显存？** 因为算权重梯度 $\Delta^\top X$ 时，公式右边明明白白写着前向输入激活 $X$！如果前向算完把 $X$ 扔了，反向传播就造不出 $G$。

   注意力层也是一样：求导 $\Delta_V = P^\top \Delta_O$、$\Delta_Q = \frac{1}{\sqrt{d_k}}\Delta_S K$、$\Delta_K = \frac{1}{\sqrt{d_k}}\Delta_S^\top Q$ 处处都要读取前向的 $Q, K, V_{\mathrm{val}}, P$。FlashAttention 虽然能在片上 SRAM 重算 $P$ 省掉 $T \times T$ 显存，但各层的 $Q, K, V_{\mathrm{val}}$ 与输入激活依然得老老实实驻留显存（除非开启梯度检查点，拿重算整层前向的时间去换空间）。
3. **为什么每步都要手动调 `zero_grad()`？** 大模型显存吃紧时，常把一个大批次拆成好几个微批次（Micro-batches）做梯度累积：连续调好几次 `loss.backward()`，把每次的 $\Delta^\top X$ 累加（`+=`）进同一块 `W.grad`，最后再统一更新一步参数。所以 PyTorch 默认累加梯度而不覆盖；常规单批训练时，就必须在每步开头手动清零。
4. **为什么神经网络梯度的奇异值谱总是严重偏斜？** 答案就藏在外积和 $G = \sum_{n=1}^N \delta_n x_n^\top$ 里。自然语言词频服从长尾的齐夫定律（Zipf's Law），少数高频功能词与公共句法方向在每个批次里反复刷屏，把输入协方差 $\frac{1}{N}X^\top X$ 的能量挤在寥寥几个主方向上。

   由这些秩一外积叠出来的梯度矩阵 $G$ 因而极度不均衡：头部几个奇异值大得惊人，而承载低频知识与精细推理回路的几十上百个尾部奇异值，往往微弱了成千上万倍。

### 2.4 把反向传播展开：手算 2 个词元的交叉熵误差与外积梯度矩阵 $G$

光看符号还不够过瘾。我们照样代进一组能口算的小数字，亲眼看着单个标量损失 $L$ 怎么退回成二维矩阵 $G$，又怎么在叠加中生出 $67$ 倍的奇异值鸿沟。

**第一步：从打分矩阵 $Z$ 算出顶层误差 $\Delta^{(Z)}$。** 设批次里只有 $N = 2$ 个预测位置，词表大小 $V = 3$，真实下一词编号分别是 $y_1 = 0$ 和 $y_2 = 1$，对应独热目标 $Y_{\mathrm{true}} = \begin{bsmallmatrix} 1 & 0 & 0 \\ 0 & 1 & 0 \end{bsmallmatrix}$。设前向输出的打分矩阵 $Z \in \mathbb{R}^{2 \times 3}$ 为：

$$
Z = \begin{bmatrix} 2.0 & 1.0 & 0.0 \\ 0.0 & 2.0 & 1.0 \end{bmatrix}
\;\xrightarrow{\text{按行 Softmax}}\;
P \approx \begin{bmatrix} 0.67 & 0.24 & 0.09 \\ 0.09 & 0.67 & 0.24 \end{bmatrix}
$$

此时平均交叉熵损失只是一个标量：$L = -\frac{1}{2}(\ln 0.67 + \ln 0.67) \approx 0.40$。代进刚推出来的起点公式 $\Delta^{(Z)} = \frac{1}{N}(P - Y_{\mathrm{true}})$：

$$
\Delta^{(Z)} = \frac{1}{2}
\left(
\begin{bmatrix} 0.67 & 0.24 & 0.09 \\ 0.09 & 0.67 & 0.24 \end{bmatrix}
-
\begin{bmatrix} 1 & 0 & 0 \\ 0 & 1 & 0 \end{bmatrix}
\right)
=
\begin{bmatrix}
\mathbf{-0.17} & +0.12 & +0.05 \\
+0.05 & \mathbf{-0.17} & +0.12
\end{bmatrix}
$$

正负号一目了然：真实答案所在的格子（第 1 行第 0 列、第 2 行第 1 列）都是负数 $-0.17$，后续做 $Z - \eta \Delta^{(Z)}$ 时会把正确词打分往上推；其余错词格子都是正数（$+0.12, +0.05$），错得越离谱，往下压得越狠。

**第二步：拆解内部线性层 $Y = X W^\top$ 的反向双支路。** 看一层 $d_{\mathrm{in}} = 3 \to d_{\mathrm{out}} = 2$ 的线性变换。设前向暂存在显存里的 $N=2$ 行输入激活为 $X \in \mathbb{R}^{2 \times 3}$，当前权重为 $W \in \mathbb{R}^{2 \times 3}$：

$$
X = \begin{bmatrix} 1 & 2 & 0 \\ 1 & 2 & 1 \end{bmatrix}, \qquad
W = \begin{bmatrix} 1.0 & 0.5 & -1.0 \\ -0.5 & 1.0 & 1.0 \end{bmatrix}, \qquad
Y = X W^\top =
\begin{bmatrix} 1 & 2 & 0 \\ 1 & 2 & 1 \end{bmatrix}
\begin{bmatrix} 1.0 & -0.5 \\ 0.5 & 1.0 \\ -1.0 & 1.0 \end{bmatrix}
= \begin{bmatrix} 2.0 & 1.5 \\ 1.0 & 2.5 \end{bmatrix}
$$

假设上游传回对 $Y$ 的误差为 $\Delta_Y = \begin{bsmallmatrix} -0.6 & 0.2 \\ -0.4 & 0.2 \end{bsmallmatrix} \in \mathbb{R}^{2 \times 2}$。反向流经这层时兵分两路：

1. **左支传给前一层输入 $X$**。直接拿 $\Delta_Y$ 右乘不转置的 $W$，消掉输出维 $d_{\mathrm{out}}=2$，还原出与 $X$ 同形状的 $2 \times 3$ 激活梯度：

$$
\Delta_X = \Delta_Y W =
\begin{bmatrix} -0.6 & 0.2 \\ -0.4 & 0.2 \end{bmatrix}
\begin{bmatrix} 1.0 & 0.5 & -1.0 \\ -0.5 & 1.0 & 1.0 \end{bmatrix}
=
\begin{bmatrix} -0.7 & -0.1 & 0.8 \\ -0.5 & 0.0 & 0.6 \end{bmatrix} \in \mathbb{R}^{2 \times 3}
$$

2. **右支留在当前层算权重梯度 $G$**。把 $\Delta_Y$ 转置后左乘前向暂存的 $X$。按词元 $n = 1, 2$ 拆成两张秩一外积 $\delta_1 x_1^\top + \delta_2 x_2^\top$ 相加，每个数字的来历清清楚楚：

$$
G = \Delta_Y^\top X =
\begin{bmatrix} -0.6 & -0.4 \\ 0.2 & 0.2 \end{bmatrix}
\begin{bmatrix} 1 & 2 & 0 \\ 1 & 2 & 1 \end{bmatrix}
=
\underbrace{\begin{bmatrix} -0.6 \\ 0.2 \end{bmatrix} \begin{bmatrix} 1 & 2 & 0 \end{bmatrix}}_{\text{词 1 外积 }\delta_1 x_1^\top}
+
\underbrace{\begin{bmatrix} -0.4 \\ 0.2 \end{bmatrix} \begin{bmatrix} 1 & 2 & 1 \end{bmatrix}}_{\text{词 2 外积 }\delta_2 x_2^\top}
=
\begin{bmatrix} -0.6 & -1.2 & 0.0 \\ 0.2 & 0.4 & 0.0 \end{bmatrix}
+
\begin{bmatrix} -0.4 & -0.8 & -0.4 \\ 0.2 & 0.4 & 0.2 \end{bmatrix}
=
\begin{bmatrix} -1.0 & -2.0 & -0.4 \\ 0.4 & 0.8 & 0.2 \end{bmatrix}
$$

请盯住最终算出来的这张 $G = \begin{bsmallmatrix} -1.0 & -2.0 & -0.4 \\ 0.4 & 0.8 & 0.2 \end{bsmallmatrix}$。

因为两个词元在前两列共享了完全相同的高频特征 $[1, 2]$，$G$ 的前两列严格成比例——第 1 行正好是第 2 行的 $-2.5$ 倍。只有第 3 列（$-0.4$ 与 $0.2$，来自词元 2 独有的第 3 维特征 `1`）轻轻打破了共线性，比例变成了 $-2.0$ 倍。

算一下 $G G^\top = \begin{bsmallmatrix} 5.16 & -2.08 \\ -2.08 & 0.84 \end{bsmallmatrix}$ 的特征值平方根，就能拿到 $G$ 的两个奇异值：

$$
\sigma_1(G) \approx 2.449, \qquad \sigma_2(G) \approx 0.037 \qquad (\sigma_1 / \sigma_2 \approx 67.1)
$$

仅仅叠了两个词元，主方向与次方向就已经拉开了 **$67$ 倍**的悬殊差距。第 4 节登场的矩阵优化器，瞄准的正是这个病根。

```sketch title="展开数值图解：2 个词元的交叉熵误差起点与线性层秩一外积梯度叠加" note="Step 1 展示 $\Delta^{(Z)} = (P - Y_{\mathrm{true}})/N$ 如何给真实词列赋负值、其余候选词列赋正值；Step 2 将 $G = \Delta_Y^\top X$ 拆解为两个词元秩一矩阵 $\delta_1 x_1^\top + \delta_2 x_2^\top$ 的逐格相加，直观呈现共享高频输入特征如何导致 $67$ 倍奇异值偏斜。"
<svg viewBox="0 0 704 432">
  <rect class="panel" x="0" y="0" width="704" height="194" rx="12"/>
  <text class="caps" x="18" y="22">STEP 1 · 顶层交叉熵梯度展开</text>
  <text class="small b" x="18" y="44">青色格为真实答案列（负导数 → 更新时抬高打分）；橙色格为非答案列（正导数 → 压低打分），每行和恒为 0</text>

  <g>
  <path d="M24.5 70.0 H20.0 V120.0 H24.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M135.5 70.0 H140.0 V120.0 H135.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="24.0" y="72.0" width="36.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="42.0" y="83.0">2.0</text>
  <rect x="62.0" y="72.0" width="36.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="80.0" y="83.0">1.0</text>
  <rect x="100.0" y="72.0" width="36.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="118.0" y="83.0">0.0</text>
  <rect x="24.0" y="96.0" width="36.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="42.0" y="107.0">0.0</text>
  <rect x="62.0" y="96.0" width="36.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="80.0" y="107.0">2.0</text>
  <rect x="100.0" y="96.0" width="36.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="118.0" y="107.0">1.0</text>
  <tex class="mid small" x="80.0" y="135.0">Z\;(2\!\times\!3)</tex>
  </g>
  <path class="edge" d="M148 95 H186" marker-end="url(#arrow)"/>
  <text class="mid small mute" x="167" y="81">softmax</text>

  <g>
  <path d="M196.5 70.0 H192.0 V120.0 H196.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M313.5 70.0 H318.0 V120.0 H313.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="196.0" y="72.0" width="38.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="215.0" y="83.0">0.67</text>
  <rect x="236.0" y="72.0" width="38.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="255.0" y="83.0">0.24</text>
  <rect x="276.0" y="72.0" width="38.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="295.0" y="83.0">0.09</text>
  <rect x="196.0" y="96.0" width="38.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="215.0" y="107.0">0.09</text>
  <rect x="236.0" y="96.0" width="38.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="255.0" y="107.0">0.67</text>
  <rect x="276.0" y="96.0" width="38.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="295.0" y="107.0">0.24</text>
  <tex class="mid small" x="255.0" y="135.0">P\;(2\!\times\!3)</tex>
  </g>
  <text class="mid b" x="331" y="95">−</text>
  <g>
  <path d="M348.5 70.0 H344.0 V120.0 H348.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M435.5 70.0 H440.0 V120.0 H435.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="348.0" y="72.0" width="28.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="362.0" y="83.0">1</text>
  <rect x="378.0" y="72.0" width="28.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="392.0" y="83.0">0</text>
  <rect x="408.0" y="72.0" width="28.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="422.0" y="83.0">0</text>
  <rect x="348.0" y="96.0" width="28.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="362.0" y="107.0">0</text>
  <rect x="378.0" y="96.0" width="28.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="392.0" y="107.0">1</text>
  <rect x="408.0" y="96.0" width="28.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="422.0" y="107.0">0</text>
  <tex class="mid small" x="392.0" y="135.0">Y_{{\mathrm{{true}}}}\;(2\!\times\!3)</tex>
  </g>
  <path class="edge" d="M448 95 H486" marker-end="url(#arrow)"/>
  <tex class="mid small mute" x="467" y="81">\div N</tex>

  <g>
  <path d="M496.5 70.0 H492.0 V120.0 H496.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M637.5 70.0 H642.0 V120.0 H637.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="496.0" y="72.0" width="46.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="519.0" y="83.0">-0.17</text>
  <rect x="544.0" y="72.0" width="46.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="567.0" y="83.0">+0.12</text>
  <rect x="592.0" y="72.0" width="46.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="615.0" y="83.0">+0.05</text>
  <rect x="496.0" y="96.0" width="46.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="519.0" y="107.0">+0.05</text>
  <rect x="544.0" y="96.0" width="46.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="567.0" y="107.0">-0.17</text>
  <rect x="592.0" y="96.0" width="46.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="615.0" y="107.0">+0.12</text>
  <tex class="mid small" x="567.0" y="135.0">\Delta^{{(Z)}}\;(2\!\times\!3)</tex>
  </g>

  <rect class="panel" x="0" y="210" width="704" height="222" rx="12"/>
  <text class="caps" x="18" y="232">STEP 2 · 线性层权重梯度展开：转置矩阵乘 = 逐词元秩一外积之和</text>
  <text class="small b" x="18" y="254">词元维 N=2 在矩阵乘中求和消去；因两词前两列同为 [1, 2]，叠加出的 G 奇异值相差 67 倍（2.45 vs 0.037）</text>

  <g>
  <path d="M20.5 292.0 H16.0 V342.0 H20.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M91.5 292.0 H96.0 V342.0 H91.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="20.0" y="294.0" width="35.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="37.5" y="305.0">-0.6</text>
  <rect x="57.0" y="294.0" width="35.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="74.5" y="305.0">-0.4</text>
  <rect x="20.0" y="318.0" width="35.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="37.5" y="329.0">0.2</text>
  <rect x="57.0" y="318.0" width="35.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="74.5" y="329.0">0.2</text>
  <tex class="mid small" x="56.0" y="357.0">\Delta_Y^\top\;(2\!\times\!2)</tex>
  </g>
  <text class="mid b" x="109" y="317">×</text>
  <g>
  <path d="M124.5 292.0 H120.0 V342.0 H124.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M205.5 292.0 H210.0 V342.0 H205.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="124.0" y="294.0" width="26.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="137.0" y="305.0">1</text>
  <rect x="152.0" y="294.0" width="26.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="165.0" y="305.0">2</text>
  <rect x="180.0" y="294.0" width="26.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="193.0" y="305.0">0</text>
  <rect x="124.0" y="318.0" width="26.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="137.0" y="329.0">1</text>
  <rect x="152.0" y="318.0" width="26.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="165.0" y="329.0">2</text>
  <rect x="180.0" y="318.0" width="26.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="193.0" y="329.0">1</text>
  <tex class="mid small" x="165.0" y="357.0">X\;(2\!\times\!3)</tex>
  </g>
  <text class="mid b" x="223" y="317">=</text>
  <g>
  <path d="M240.5 292.0 H236.0 V342.0 H240.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M357.5 292.0 H362.0 V342.0 H357.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="240.0" y="294.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="259.0" y="305.0">-0.6</text>
  <rect x="280.0" y="294.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="299.0" y="305.0">-1.2</text>
  <rect x="320.0" y="294.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="339.0" y="305.0">0.0</text>
  <rect x="240.0" y="318.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="259.0" y="329.0">0.2</text>
  <rect x="280.0" y="318.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="299.0" y="329.0">0.4</text>
  <rect x="320.0" y="318.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="339.0" y="329.0">0.0</text>
  <text class="mid small mute" x="299.0" y="283.0">词 1 外积</text>
  <tex class="mid small" x="299.0" y="357.0">\delta_1 x_1^\top</tex>
  </g>
  <text class="mid b" x="374" y="317">+</text>
  <g>
  <path d="M390.5 292.0 H386.0 V342.0 H390.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M507.5 292.0 H512.0 V342.0 H507.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="390.0" y="294.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="409.0" y="305.0">-0.4</text>
  <rect x="430.0" y="294.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="449.0" y="305.0">-0.8</text>
  <rect x="470.0" y="294.0" width="38.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="489.0" y="305.0">-0.4</text>
  <rect x="390.0" y="318.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="409.0" y="329.0">0.2</text>
  <rect x="430.0" y="318.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="449.0" y="329.0">0.4</text>
  <rect x="470.0" y="318.0" width="38.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="489.0" y="329.0">0.2</text>
  <text class="mid small mute" x="449.0" y="283.0">词 2 外积</text>
  <tex class="mid small" x="449.0" y="357.0">\delta_2 x_2^\top</tex>
  </g>
  <text class="mid b" x="524" y="317">=</text>
  <g>
  <path d="M540.5 292.0 H536.0 V342.0 H540.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M663.5 292.0 H668.0 V342.0 H663.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="540.0" y="294.0" width="40.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="560.0" y="305.0">-1.0</text>
  <rect x="582.0" y="294.0" width="40.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="602.0" y="305.0">-2.0</text>
  <rect x="624.0" y="294.0" width="40.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="644.0" y="305.0">-0.4</text>
  <rect x="540.0" y="318.0" width="40.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="560.0" y="329.0">0.4</text>
  <rect x="582.0" y="318.0" width="40.0" height="22.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="602.0" y="329.0">0.8</text>
  <rect x="624.0" y="318.0" width="40.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="644.0" y="329.0">0.2</text>
  <tex class="mid small" x="602.0" y="357.0">G\;(2\!\times\!3)</tex>
  </g>

  <text class="small accent" x="18" y="406">仅第 3 列（红框 -0.4, 0.2）打破两行共线 → 主奇异值 σ₁=2.45，第 2 奇异值仅 σ₂=0.037</text>
</svg>
<svg viewBox="0 0 340 578">
  <rect class="panel" x="0" y="0" width="340" height="232" rx="12"/>
  <text class="caps" x="14" y="22">1 · 交叉熵误差展开</text>
  <g>
  <path d="M18.5 40.0 H14.0 V86.0 H18.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M129.5 40.0 H134.0 V86.0 H129.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="18.0" y="42.0" width="36.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="36.0" y="52.0">0.67</text>
  <rect x="56.0" y="42.0" width="36.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="74.0" y="52.0">0.24</text>
  <rect x="94.0" y="42.0" width="36.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="112.0" y="52.0">0.09</text>
  <rect x="18.0" y="64.0" width="36.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="36.0" y="74.0">0.09</text>
  <rect x="56.0" y="64.0" width="36.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="74.0" y="74.0">0.67</text>
  <rect x="94.0" y="64.0" width="36.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="112.0" y="74.0">0.24</text>
  <tex class="mid small" x="74.0" y="101.0">P</tex>
  </g>
  <text class="mid b" x="146" y="63">−</text>
  <g>
  <path d="M162.5 40.0 H158.0 V86.0 H162.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M243.5 40.0 H248.0 V86.0 H243.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="162.0" y="42.0" width="26.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="175.0" y="52.0">1</text>
  <rect x="190.0" y="42.0" width="26.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="203.0" y="52.0">0</text>
  <rect x="218.0" y="42.0" width="26.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="231.0" y="52.0">0</text>
  <rect x="162.0" y="64.0" width="26.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="175.0" y="74.0">0</text>
  <rect x="190.0" y="64.0" width="26.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="203.0" y="74.0">1</text>
  <rect x="218.0" y="64.0" width="26.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="231.0" y="74.0">0</text>
  <tex class="mid small" x="203.0" y="101.0">Y_{{\mathrm{{true}}}}</tex>
  </g>
  <path class="edge" d="M256 63 H282" marker-end="url(#arrow)"/>
  <tex class="small mute" x="288" y="63">\div 2</tex>

  <g>
  <path d="M18.5 126.0 H14.0 V172.0 H18.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M159.5 126.0 H164.0 V172.0 H159.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="18.0" y="128.0" width="46.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="41.0" y="138.0">-0.17</text>
  <rect x="66.0" y="128.0" width="46.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="89.0" y="138.0">+0.12</text>
  <rect x="114.0" y="128.0" width="46.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="137.0" y="138.0">+0.05</text>
  <rect x="18.0" y="150.0" width="46.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="41.0" y="160.0">+0.05</text>
  <rect x="66.0" y="150.0" width="46.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="89.0" y="160.0">-0.17</text>
  <rect x="114.0" y="150.0" width="46.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="137.0" y="160.0">+0.12</text>
  <tex class="mid small" x="89.0" y="187.0">\Delta^{{(Z)}} = \partial L / \partial Z</tex>
  </g>
  <text class="small" x="176" y="140">真实词列为 -0.17</text>
  <text class="small mute" x="176" y="160">错误词列为正值</text>
  <text class="small b" x="14" y="212">负梯度经 -ηΔ 更新后自动抬高真实词打分</text>

  <rect class="panel" x="0" y="248" width="340" height="330" rx="12"/>
  <text class="caps" x="14" y="270">2 · 权重梯度 = 两词秩一外积相加</text>
  <g>
  <path d="M18.5 288.0 H14.0 V334.0 H18.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M89.5 288.0 H94.0 V334.0 H89.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="18.0" y="290.0" width="35.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="35.5" y="300.0">-0.6</text>
  <rect x="55.0" y="290.0" width="35.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="72.5" y="300.0">-0.4</text>
  <rect x="18.0" y="312.0" width="35.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="35.5" y="322.0">0.2</text>
  <rect x="55.0" y="312.0" width="35.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="72.5" y="322.0">0.2</text>
  <tex class="mid small" x="54.0" y="349.0">\Delta_Y^\top\;(2\!\times\!2)</tex>
  </g>
  <text class="mid b" x="108" y="311">×</text>
  <g>
  <path d="M124.5 288.0 H120.0 V334.0 H124.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M211.5 288.0 H216.0 V334.0 H211.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="124.0" y="290.0" width="28.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="138.0" y="300.0">1</text>
  <rect x="154.0" y="290.0" width="28.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="168.0" y="300.0">2</text>
  <rect x="184.0" y="290.0" width="28.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="198.0" y="300.0">0</text>
  <rect x="124.0" y="312.0" width="28.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="138.0" y="322.0">1</text>
  <rect x="154.0" y="312.0" width="28.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="168.0" y="322.0">2</text>
  <rect x="184.0" y="312.0" width="28.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="198.0" y="322.0">1</text>
  <tex class="mid small" x="168.0" y="349.0">X\;(2\!\times\!3)</tex>
  </g>

  <g>
  <path d="M18.5 380.0 H14.0 V426.0 H18.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M129.5 380.0 H134.0 V426.0 H129.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="18.0" y="382.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="36.0" y="392.0">-0.6</text>
  <rect x="56.0" y="382.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="74.0" y="392.0">-1.2</text>
  <rect x="94.0" y="382.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="112.0" y="392.0">0.0</text>
  <rect x="18.0" y="404.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="36.0" y="414.0">0.2</text>
  <rect x="56.0" y="404.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="74.0" y="414.0">0.4</text>
  <rect x="94.0" y="404.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="112.0" y="414.0">0.0</text>
  <tex class="mid small" x="74.0" y="441.0">\delta_1 x_1^\top</tex>
  </g>
  <text class="mid b" x="146" y="403">+</text>
  <g>
  <path d="M162.5 380.0 H158.0 V426.0 H162.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M273.5 380.0 H278.0 V426.0 H273.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="162.0" y="382.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="180.0" y="392.0">-0.4</text>
  <rect x="200.0" y="382.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="218.0" y="392.0">-0.8</text>
  <rect x="238.0" y="382.0" width="36.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="256.0" y="392.0">-0.4</text>
  <rect x="162.0" y="404.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="180.0" y="414.0">0.2</text>
  <rect x="200.0" y="404.0" width="36.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="218.0" y="414.0">0.4</text>
  <rect x="238.0" y="404.0" width="36.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="256.0" y="414.0">0.2</text>
  <tex class="mid small" x="218.0" y="441.0">\delta_2 x_2^\top</tex>
  </g>

  <text class="mid b" x="34" y="489">=</text>
  <g>
  <path d="M56.5 466.0 H52.0 V512.0 H56.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M185.5 466.0 H190.0 V512.0 H185.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="56.0" y="468.0" width="42.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="77.0" y="478.0">-1.0</text>
  <rect x="100.0" y="468.0" width="42.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="121.0" y="478.0">-2.0</text>
  <rect x="144.0" y="468.0" width="42.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="165.0" y="478.0">-0.4</text>
  <rect x="56.0" y="490.0" width="42.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="77.0" y="500.0">0.4</text>
  <rect x="100.0" y="490.0" width="42.0" height="20.0" rx="3" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  <text class="mid small" x="121.0" y="500.0">0.8</text>
  <rect x="144.0" y="490.0" width="42.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small b" x="165.0" y="500.0">0.2</text>
  <tex class="mid small" x="121.0" y="527.0">G\;(2\!\times\!3)</tex>
  </g>
  <text class="small accent" x="206" y="480">σ₁ = 2.45</text>
  <text class="small accent" x="206" y="500">σ₂ = 0.037 (67×)</text>
  <text class="small mute" x="14" y="556">两词共享前两列特征，叠加后奇异值天然严重偏斜</text>
</svg>
```

拿到梯度之后，第 5 步 `optimizer.step()` 如何根据梯度更新参数？下面我们从标量与向量的情形起步，逐步推导出四代逐元素优化算法。

---

## 三、邻近最速下降原理与逐元素优化器的四代推演

为了把 `SGD`、`Momentum`、`Adam`、`AdamW` 乃至后面的 `Muon` 放在同一把尺子下比较，我们先立起一个统一的起点：**一阶最速下降的邻近变分形式**。

设第 $t-1$ 步结束时的参数向量是 $\theta_{t-1} \in \mathbb{R}^p$，当前微批次算出的梯度是 $g_t = \nabla L_t(\theta_{t-1}) \in \mathbb{R}^p$。在 $\theta_{t-1}$ 附近做一阶泰勒展开，损失近似为 $L_t(\theta) \approx L_t(\theta_{t-1}) + \langle g_t, \theta - \theta_{t-1} \rangle$。

这只是局部线性近似。如果不限制步子大小直接去极小化线性项，参数会一口气跑到无穷远。所以，我们必须在目标函数里加上一项惩罚步幅过大的二次邻近项（Proximal Penalty）：

$$
\theta_t = \mathrm{arg}\min_{\theta \in \mathbb{R}^p} \left\{ \langle g_t, \theta - \theta_{t-1} \rangle + \frac{1}{2\eta} \|\theta - \theta_{t-1}\|_2^2 \right\}
$$

其中 $\eta > 0$ 是学习率。对大括号里的凸二次函数关于 $\theta$ 求梯度并令其为零：

$$
g_t + \frac{1}{\eta}(\theta_t - \theta_{t-1}) = 0 \quad \Longrightarrow \quad \theta_t = \theta_{t-1} - \eta g_t
$$

这就是最经典的**随机梯度下降（SGD）**[@robbins1951]。

这行极简推导藏着一个常被忽视的前提：“负梯度 $-\eta g_t$ 是最速下降方向”这句话，**只有在你选用各向同性的欧氏范数 $\|\cdot\|_2$ 来丈量步长时才成立**。一旦损失曲面在不同方向上的陡峭程度相差悬殊，欧氏距离就不再是一把好尺子了。

### 3.1 第一代 `SGD` 在病态曲率下的收敛瓶颈推导

不妨看一个最简单的二维狭长山谷：

$$
L(\theta_1, \theta_2) = \frac{1}{2}\lambda_1 \theta_1^2 + \frac{1}{2}\lambda_2 \theta_2^2, \qquad 0 < \lambda_1 \ll \lambda_2
$$

它的梯度是 $\nabla L(\theta) = (\lambda_1 \theta_1, \lambda_2 \theta_2)^\top$，谷底极小值在原点 $(0, 0)$。最大曲率与最小曲率之比叫做**条件数（Condition Number）**，记作 $\kappa \triangleq \lambda_2 / \lambda_1 \gg 1$。

跑标准梯度下降时，两个坐标各自独立按等比数列演化：

$$
\theta_{t, 1} = (1 - \eta \lambda_1)^t \theta_{0, 1}, \qquad \theta_{t, 2} = (1 - \eta \lambda_2)^t \theta_{0, 2}
$$

为了不让陡峭方向 $\theta_2$ 爆炸发散，公比绝对值必须小于 $1$，即 $|1 - \eta \lambda_2| < 1$。这就给全局学习率套上了一道死箍：

$$
0 < \eta < \frac{2}{\lambda_2}
$$

不仅如此，只要步长落在 $\frac{1}{\lambda_2} < \eta < \frac{2}{\lambda_2}$ 之间，公比 $1 - \eta \lambda_2$ 就是负数，$\theta_{t, 2}$ 每走一步都要正负变号，在两侧陡壁之间来回撞墙。

更糟糕的是平缓方向 $\theta_1$。因为 $\eta$ 被陡壁死死卡在 $2/\lambda_2$ 以下，谷底方向的单步误差收缩率最多只能做到：

$$
1 - \eta \lambda_1 > 1 - \frac{2\lambda_1}{\lambda_2} = 1 - \frac{2}{\kappa}
$$

利用 $\ln(1 - u) \approx -u$ 估算，要把谷底误差缩小到 $\varepsilon$ 倍，至少得走 $t \ge \frac{\kappa}{2}\ln(1/\varepsilon)$ 步。深度网络的海森条件数 $\kappa$ 动辄高达 $10^4 \sim 10^6$，纯 `SGD` 在平坦谷底几乎寸步难行。

### 3.2 第二代动量法：Polyak 惯性与 Nesterov 前瞻等价变形

怎么同时做到“压住陡壁两侧的来回震荡”与“加快平坦谷底的持续推进”？

1964 年，Boris Polyak 借用重球在势能面上带阻尼滚动的物理图像，用指数移动平均（EMA）把历史梯度攒了起来[@polyak1964]：

$$
m_t = \beta_1 m_{t-1} + (1 - \beta_1) g_t, \qquad \theta_t = \theta_{t-1} - \eta m_t
$$

（工程代码里也常省掉 $(1 - \beta_1)$ 写成 $u_t = \mu u_{t-1} + g_t$，只需把常数倍数折进 $\eta$ 即可。）我们直接算一算它在两种极端梯度序列下的稳态表现：

- **平缓一致方向**（每步梯度恒为 $g_\tau = g$）。当 $t$ 足够大时，$m_t = (1 - \beta_1)\sum_{k=0}^\infty \beta_1^k g = g$，推进力丝毫不损（在不乘 $(1-\mu)$ 的写法里稳态是 $\frac{1}{1-\mu}g$，$\mu = 0.9$ 时等效步长直接放大 $10$ 倍）。
- **陡峭震荡方向**（每步梯度正负翻转 $g_\tau = (-1)^\tau g$）。正负项在几何级数里剧烈抵消，稳态幅度只剩：

$$
|m_t| = (1 - \beta_1) |g| \left|\sum_{k=0}^{\infty} (-\beta_1)^k\right| = \frac{1 - \beta_1}{1 + \beta_1} |g|
$$

代入常用值 $\beta_1 = 0.9$，$\frac{1 - 0.9}{1 + 0.9} \approx 0.0526$——横跨峡谷的无效震荡被砍掉了近 $95\%$！在凸二次问题上，最优动量能把迭代复杂度从 $\mathcal{O}(\kappa)$ 直接降到平方根量级 $\mathcal{O}(\sqrt{\kappa})$。

1983 年，Yurii Nesterov 又往前推了一步[@nesterov1983]。他注意到一个极自然的道理：既然重球马上就要顺着历史惯性往前滑出一步 $\mu v_{t-1}$，与其站在原地算梯度，不如**先顺着惯性滑到“前瞻点”，在那个新位置上算梯度来修正方向**：

$$
v_t = \mu v_{t-1} - \eta \nabla L(x_{t-1} + \mu v_{t-1}), \qquad x_t = x_{t-1} + v_t
$$

初看之下，在非参数点 $x_{t-1} + \mu v_{t-1}$ 算梯度似乎得额外多做一趟前向和反向传播。

其实不用。PyTorch 的 `SGD(..., nesterov=True)` 以及后文的 `Muon`，都用了一个巧妙的变量代换：干脆把前瞻点本身存成模型的当前参数 $\theta_{t-1} \triangleq x_{t-1} + \mu v_{t-1}$！这样常规反向传播算出来的直接就是 $g_t = \nabla L(\theta_{t-1})$。

再令动量缓冲区 $M_t \triangleq -v_t / \eta$（即 $v_t = -\eta M_t$ 且 $M_t = \mu M_{t-1} + g_t$），把下一步前瞻点 $\theta_t$ 用 $\theta_{t-1}$ 表出：

$$
\begin{aligned}
\theta_t &= x_t + \mu v_t = (x_{t-1} + v_t) + \mu v_t \\
&= (x_{t-1} + \mu v_{t-1}) - \mu v_{t-1} + (1 + \mu) v_t \\
&= \theta_{t-1} + \eta \mu M_{t-1} - \eta (1 + \mu)(\mu M_{t-1} + g_t) \\
&= \theta_{t-1} - \eta \bigl(g_t + \mu (\mu M_{t-1} + g_t)\bigr) = \theta_{t-1} - \eta (g_t + \mu M_t)
\end{aligned}
$$

记 $\tilde{M}_t \triangleq g_t + \mu M_t$，这正是第 7 节 `Muon` 代码里那两行 `M = mu * M + G; tilde_M = G + mu * M` 的一字不差的由来。

对比普通动量 $M_t = g_t + \mu M_{t-1}$ 与 Nesterov 前瞻动量 $\tilde{M}_t = (1 + \mu)g_t + \mu^2 M_{t-1}$ 可以看到，Nesterov 把当期最新梯度 $g_t$ 的话语权放大了 $(1 + \mu)$ 倍，遇到山谷拐弯时刹车更早、过冲更小。

### 3.3 第三代自适应预条件与 Adam 偏差修正推导

动量抚平了单层内部的震荡，但深度 Transformer 还有另一重麻烦：不同层、不同词频之间的梯度量级差了好几个数量级。生僻词嵌入行的梯度可能只有 $10^{-5}$，而某层注意力权重的梯度却高达 $10^1$，一把全局学习率根本没法同时伺候它们。

回到本节开头的邻近最速下降。如果我们把各向同性的欧氏惩罚 $\|\theta - \theta_{t-1}\|_2^2$，换成按坐标独立加权的对角黎曼度量 $(\theta - \theta_{t-1})^\top D_t (\theta - \theta_{t-1})$（其中 $D_t = \mathrm{diag}(d_{t,1}, \dots, d_{t,p}) \succ 0$）：

$$
\theta_t = \mathrm{arg}\min_{\theta \in \mathbb{R}^p} \left\{ \langle g_t, \theta - \theta_{t-1} \rangle + \frac{1}{2\eta} (\theta - \theta_{t-1})^\top D_t (\theta - \theta_{t-1}) \right\} \quad \Longrightarrow \quad \theta_t = \theta_{t-1} - \eta D_t^{-1} g_t
$$

每个坐标立刻拥有了自己的专属步长缩放。围绕怎么造这张对角阵 $D_t$，诞生了三步经典演进：

- **AdaGrad（2011）[@duchi2011]**。直接把开训以来所有梯度平方全加起来：$G_{\mathrm{sum}, t} = \sum_{\tau=1}^t g_\tau \odot g_\tau$，取 $D_t = \mathrm{diag}\!\left(\sqrt{G_{\mathrm{sum}, t}} + \epsilon\right)$。它在稀疏凸在线学习里有漂亮的遗憾界；但在成千上万步的神经网络非凸训练中，只增不减的分母会把有效学习率越压越小，最终提前“冻死”。
- **RMSProp（2012）**。引入遗忘因子 $\beta_2 \in (0, 1)$（如 $0.999$），把无限累加改成近期约 $\frac{1}{1-\beta_2}$ 步窗口的指数移动平均：$v_t = \beta_2 v_{t-1} + (1 - \beta_2) (g_t \odot g_t)$，分母取 $\sqrt{v_t} + \epsilon$，彻底治好了学习率早衰。
- **Adam（2015）[@kingma2015]**。把分子的一阶动量 $m_t$ 与分母的二阶矩 $v_t$ 合二为一，从全零初值 $m_0 = 0, v_0 = 0$ 起步：

$$
m_t = \beta_1 m_{t-1} + (1 - \beta_1) g_t, \qquad v_t = \beta_2 v_{t-1} + (1 - \beta_2) g_t^2
$$

（注：标量写法里的 $g_t^2$ 代表逐元素平方 $g_t \odot g_t$。）

这里立刻冒出一个关键问题：**`Adam` 为什么非做冷启动偏差修正不可？**

我们把 $v_t$ 的递推式一路展开回第 $1$ 步：

$$
v_t = (1 - \beta_2) \sum_{i=1}^{t} \beta_2^{t-i} g_i^2
$$

两边同时取期望。设梯度二阶矩局部平稳，记 $\sigma_{g,t}^2 \triangleq \mathbb{E}[g_t^2]$（非平稳余项记为 $\zeta$），代入有限等比数列求和 $\sum_{k=0}^{t-1} \beta_2^k = \frac{1 - \beta_2^t}{1 - \beta_2}$，立得：

$$
\mathbb{E}[v_t] = (1 - \beta_2) \sum_{i=1}^{t} \beta_2^{t-i} \mathbb{E}[g_i^2] = \sigma_{g,t}^2 (1 - \beta_2) \frac{1 - \beta_2^t}{1 - \beta_2} + \zeta = \sigma_{g,t}^2 (1 - \beta_2^t) + \zeta
$$

一阶矩完全同理：$\mathbb{E}[m_t] = \mathbb{E}[g_t](1 - \beta_1^t) + \zeta'$。因为零初值 $m_0 = 0, v_0 = 0$ 偷偷占走了高达 $\beta_1^t$ 与 $\beta_2^t$ 的权重，训练刚起步时，$m_t$ 和 $v_t$ 都会严重偏向零。

如果不修掉这个偏差直接相除，第 $t=1$ 步会发生什么？代入默认超参 $\beta_1 = 0.9, \beta_2 = 0.999$ 算一下：

$$
\frac{|m_1|}{\sqrt{v_1}} = \frac{(1 - \beta_1)|g_1|}{\sqrt{(1 - \beta_2) g_1^2}} = \frac{1 - 0.9}{\sqrt{1 - 0.999}} = \frac{0.1}{\sqrt{0.001}} \approx 3.162
$$

因为 $\beta_2$ 比 $\beta_1$ 更贴近 $1$，分母向零缩水的程度远比分子剧烈！结果第 1 步的实际步长凭空暴涨了 **$3.16$ 倍**（要是设 $\beta_2 = 0.9999$ 更是暴涨 $10$ 倍），极易在开训瞬间把模型一步跨崩。

解决办法非常干净：把 $m_t$ 和 $v_t$ 各自除以已经攒够的权重总和 $(1 - \beta_1^t)$ 与 $(1 - \beta_2^t)$，还原出无偏估计 $\hat{m}_t, \hat{v}_t$：

$$
\hat{m}_t = \frac{m_t}{1 - \beta_1^t}, \qquad \hat{v}_t = \frac{v_t}{1 - \beta_2^t}, \qquad \theta_t = \theta_{t-1} - \eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}
$$

修完之后，第 1 步 $|\hat{m}_1| / \sqrt{\hat{v}_1} = 1$ 不偏不倚；等跑到大步数 $t \to \infty$ 时，$\beta_1^t, \beta_2^t \to 0$，修正系数又悄无声息地退回 $1$。

从统计眼光看，$\hat{m}_t / \sqrt{\hat{v}_t}$ 还有一层极美的物理直觉——它是每个参数坐标上的**经验信噪比（SNR）**。梯度方向高度一致时，比值饱和在 $\pm 1$ 附近稳步推进；等到快进极小值谷底、真实均值 $\mathbb{E}[g_t] \to 0$ 只剩批次噪声正负乱跳时，分子抵消趋零而分母依然为正，步长就会自动收缩退火[@kingma2015]。

### 3.4 二次正则不等价定理与 AdamW 解耦权重衰减推导

训练超大规模网络时，如果放任权重模长自由生长，模型为了刷低有限训练集上的交叉熵，往往会把冗余权重推得很大，导致输出打分过度尖锐、泛化变差。

从贝叶斯最大后验估计（MAP）来看，给参数套上零均值各向同性高斯先验 $p(\theta) \propto \exp\!\left(-\frac{\lambda}{2}\|\theta\|_2^2\right)$，等价于在损失函数后面挂一项二次 **$L_2$ 正则惩罚**：

$$
L_{\mathrm{reg}}(\theta) = L(\theta) + \frac{\lambda}{2}\|\theta\|_2^2 \quad \Longrightarrow \quad \nabla L_{\mathrm{reg}}(\theta) = \nabla L(\theta) + \lambda \theta
$$

另一条路线则来自 Hanson 与 Pratt（1988）定义的**权重衰减（Weight Decay）**：每步更新时，直接按固定比例把参数往零缩一点，即 $(1 - w)\theta_{t-1}$。

在纯 `SGD` 里，把带 $L_2$ 正则的梯度代进去：

$$
\theta_t = \theta_{t-1} - \eta (g_t + \lambda \theta_{t-1}) = (1 - \eta \lambda)\theta_{t-1} - \eta g_t
$$

只要令 $w = \eta \lambda$，两件事在数学上分毫不差！正是被这个巧合误导，早年几乎所有深度学习框架都偷了个懒：把 `weight_decay` 直接实现成求导后往梯度上加一行 `g_t = g_t + wd * theta`。

可等到大家换用 `Adam` 后，怪事出现了：配了这种“权重衰减”的 `Adam`，泛化表现总是莫名其妙地输给老派的 `SGD + Momentum`。

直到 2019 年，Loshchilov 与 Hutter 在 `AdamW` 论文里用几行干脆利落的代数揪出了真凶[@loshchilov2019]。

设任意带正定预条件矩阵 $P_t \succ 0$ 的优化器，配合真正的解耦权重衰减率 $w$ 时，更新式应当是：

$$
\theta_t = (1 - w)\theta_{t-1} - \eta P_t^{-1} \nabla L(\theta_{t-1})
$$

现在反问一句：能不能找到某个固定的正则项 $R(\theta)$，加进损失里变成 $\tilde{L}(\theta) = L(\theta) + R(\theta)$，使得不做解耦衰减也能算出完全相同的更新？

首先，只要 $P_t$ 还在随历史梯度动态变化，根本就不存在不随时间 $t$ 改变的固定函数 $R(\theta)$。退一步说，就算假定 $P_t = P$ 恒定不变，强行令两种更新相等：

$$
\theta_{t-1} - \eta P^{-1}\bigl(\nabla L(\theta_{t-1}) + \nabla R(\theta_{t-1})\bigr) = (1 - w)\theta_{t-1} - \eta P^{-1} \nabla L(\theta_{t-1})
$$

消掉公共项，两边同时左乘 $P$，立刻露出真相：

$$
\nabla R(\theta_{t-1}) = \frac{w}{\eta} P \theta_{t-1} \quad \Longleftrightarrow \quad R(\theta) = \frac{w}{2\eta} \theta^\top P \theta
$$

两条切中要害的结论跃然纸上：

1. **等价的充要条件极为苛刻**。只有当预条件矩阵是单位阵的标量倍数 $P_t = c I$（也就是没有任何逐坐标自适应缩放的 `SGD`）时，$L_2$ 正则才等价于权重衰减。
2. **耦合 $L_2$ 在 `Adam` 里把惩罚对象搞反了**。在 `Adam` 中，$P_t = \mathrm{diag}\!\left(\sqrt{\hat{v}_t} + \epsilon\right)$ 因坐标而异。一旦把 $\lambda \theta_{t-1}$ 混进梯度变成 $g_t^{\mathrm{L2}} = g_t + \lambda \theta_{t-1}$，它不仅会污染二阶矩 $\hat{v}_t^{\mathrm{L2}}$，还会让单步更新（取 $\beta_1 = 0$ 看最清晰）变成：

$$
\theta_{t, i} = \theta_{t-1, i} - \eta \frac{g_{t, i} + \lambda \theta_{t-1, i}}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon} = \left(1 - \frac{\eta \lambda}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon}\right)\theta_{t-1, i} - \eta \frac{g_{t, i}}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon}
$$

看左边括号里的实际衰减率 $\frac{\eta \lambda}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon}$——它被该坐标的历史梯度均方根生生除掉了！

这意味着什么？历史梯度越凶猛的活跃参数（$\sqrt{\hat{v}_{t,i}} \gg 1$），受到的衰减惩罚反而微乎其微；反倒是平时梯度很小的安静参数（$\sqrt{\hat{v}_{t,i}} \ll 1$），被狠狠按着往零压。这跟各向同性高斯先验“所有参数一视同仁按同比例收缩”的初衷彻底背道而驰。

看破这一点后，`AdamW` 的修法简单至极——把权重衰减从梯度里请出去，老老实实直接乘在参数上：

$$
\theta_t = (1 - \eta \lambda)\theta_{t-1} - \eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}
$$

```sketch title="耦合 $L_2$ 正则与解耦权重衰减（AdamW）的数据流对比" note="在耦合 $L_2$ 写法中，惩罚项 $\lambda\theta_{t-1}$ 混入梯度后被分母 $\sqrt{\hat{v}_t}$ 除掉，导致各坐标衰减率随梯度幅度发生偏离；AdamW 将收缩步独立作用于参数。"
<svg viewBox="0 0 704 224">
  <rect class="panel" x="0" y="0" width="704" height="104" rx="12"/>
  <text class="caps" x="20" y="24">COUPLED ADAM + L2 REGULARIZATION</text>
  <g class="node plain"><rect x="20" y="40" width="154" height="38" rx="4"/><tex class="mid" x="97" y="59">g_t + \lambda \theta_{t-1}</tex></g>
  <path class="edge hot" d="M174 59 H204" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="208" y="40" width="194" height="38" rx="4"/><tex class="mid" x="305" y="59">\div \left(\sqrt{\hat{v}_t^{\mathrm{L2}}} + \epsilon\right)</tex></g>
  <path class="edge hot" d="M402 59 H432" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="436" y="40" width="248" height="38" rx="4"/><text class="mid b" x="560" y="59">大梯度坐标衰减趋零，小梯度过度压缩</text></g>

  <rect class="panel" x="0" y="120" width="704" height="104" rx="12"/>
  <text class="caps" x="20" y="144">DECOUPLED ADAMW WEIGHT DECAY</text>
  <g class="node plain"><rect x="20" y="160" width="144" height="38" rx="4"/><tex class="mid" x="92" y="179">g_t = \nabla L(\theta_{t-1})</tex></g>
  <path class="edge" d="M164 179 H190" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="194" y="160" width="174" height="38" rx="4"/><tex class="mid" x="281" y="179">-\eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}</tex></g>
  <path class="edge" d="M368 179 H394" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="398" y="160" width="286" height="38" rx="4"/><tex class="mid" x="541" y="179">\theta_t = (1 - \eta \lambda)\theta_{t-1} - \eta \hat{m}_t / (\sqrt{\hat{v}_t} + \epsilon)</tex></g>
</svg>
<svg viewBox="0 0 340 356">
  <rect class="panel" x="0" y="0" width="340" height="170" rx="12"/>
  <text class="caps" x="16" y="24">ADAM + L2 · COUPLED</text>
  <g class="node plain"><rect x="16" y="38" width="144" height="34" rx="4"/><tex class="mid" x="88" y="55">g_t + \lambda \theta_{t-1}</tex></g>
  <path class="edge hot" d="M160 55 H180" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="184" y="38" width="140" height="34" rx="4"/><tex class="mid" x="254" y="55">\div \sqrt{\hat{v}_t^{\mathrm{L2}}}</tex></g>
  <path class="edge hot" d="M170 72 V94" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="16" y="98" width="308" height="52" rx="4"/><tex class="mid" x="170" y="115">1 - \frac{\eta \lambda}{\sqrt{\hat{v}_t^{\mathrm{L2}}} + \epsilon}</tex><text class="mid small" x="170" y="137">大梯度坐标几乎不收缩，小梯度坐标过度压缩</text></g>

  <rect class="panel" x="0" y="186" width="340" height="170" rx="12"/>
  <text class="caps" x="16" y="210">ADAMW · DECOUPLED</text>
  <g class="node plain"><rect x="16" y="224" width="144" height="34" rx="4"/><tex class="mid" x="88" y="241">g_t = \nabla L(\theta_{t-1})</tex></g>
  <path class="edge" d="M160 241 H180" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="184" y="224" width="140" height="34" rx="4"/><tex class="mid" x="254" y="241">\hat{m}_t / \sqrt{\hat{v}_t}</tex></g>
  <path class="edge" d="M170 258 V280" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="16" y="284" width="308" height="52" rx="4"/><tex class="mid" x="170" y="303">\theta_t = (1 - \eta \lambda)\theta_{t-1} - \eta \hat{m}_t / \sqrt{\hat{v}_t}</tex><text class="mid small" x="170" y="325">无论梯度量级大小，全体参数按同一速率收缩</text></g>
</svg>
```

下图用两组受控数值实验直观验证了这两项结论。

左面板画出了 `SGD`、`Momentum` 与 `AdamW` 在条件数 $\kappa = 36$ 的狭长山谷 $L(\theta_1, \theta_2) = 0.5\theta_1^2 + 18\theta_2^2$ 上走过 26 步的真实轨迹。右面板则对比了两个初始值同为 $2.5$、零均值噪声梯度幅度分别为 $40$ 与 $0.05$ 的冗余参数：在 `Adam+L2` 下，大梯度参数几乎彻底停滞不衰减；换成 `AdamW` 后，两条衰减曲线严丝合缝地叠在一起。

```plot title="逐元素优化器数值验证：病态二次曲面轨迹与耦合 $L_2$ 衰减失真" note="左面板：$L(\theta_1, \theta_2) = 0.5\theta_1^2 + 18\theta_2^2$（$\kappa = 36$）上 26 步轨迹；右面板：零均值交替噪声梯度下（$\theta_1$ 幅度 40，$\theta_2$ 幅度 0.05，初值均为 2.5，$\eta=0.02, \lambda=0.4$）观察冗余参数向零收缩的过程。"
{"cols":2,"narrowCols":1,"legend":[{"label":"SGD / Adam+$L_2$ 大梯度坐标 $\\theta_1$","color":"var(--clay)","shape":"line"},{"label":"Momentum / Adam+$L_2$ 小梯度坐标 $\\theta_2$","color":"var(--orange)","shape":"dash"},{"label":"AdamW（逐轴自适应与等比例解耦衰减）","color":"var(--teal)","shape":"line"}],"data":{"canyon":[{"opt":"SGD","step":0,"w1":-3.4,"w2":0.78},{"opt":"SGD","step":1,"w1":-3.223,"w2":-0.68},{"opt":"SGD","step":2,"w1":-3.056,"w2":0.593},{"opt":"SGD","step":3,"w1":-2.897,"w2":-0.517},{"opt":"SGD","step":4,"w1":-2.746,"w2":0.451},{"opt":"SGD","step":5,"w1":-2.603,"w2":-0.393},{"opt":"SGD","step":6,"w1":-2.468,"w2":0.343},{"opt":"SGD","step":7,"w1":-2.34,"w2":-0.299},{"opt":"SGD","step":8,"w1":-2.218,"w2":0.261},{"opt":"SGD","step":9,"w1":-2.103,"w2":-0.227},{"opt":"SGD","step":10,"w1":-1.993,"w2":0.198},{"opt":"SGD","step":11,"w1":-1.89,"w2":-0.173},{"opt":"SGD","step":12,"w1":-1.791,"w2":0.151},{"opt":"SGD","step":13,"w1":-1.698,"w2":-0.131},{"opt":"SGD","step":14,"w1":-1.61,"w2":0.115},{"opt":"SGD","step":15,"w1":-1.526,"w2":-0.1},{"opt":"SGD","step":16,"w1":-1.447,"w2":0.087},{"opt":"SGD","step":17,"w1":-1.372,"w2":-0.076},{"opt":"SGD","step":18,"w1":-1.3,"w2":0.066},{"opt":"SGD","step":19,"w1":-1.233,"w2":-0.058},{"opt":"SGD","step":20,"w1":-1.169,"w2":0.05},{"opt":"SGD","step":21,"w1":-1.108,"w2":-0.044},{"opt":"SGD","step":22,"w1":-1.05,"w2":0.038},{"opt":"SGD","step":23,"w1":-0.996,"w2":-0.033},{"opt":"SGD","step":24,"w1":-0.944,"w2":0.029},{"opt":"SGD","step":25,"w1":-0.895,"w2":-0.025},{"opt":"SGD","step":26,"w1":-0.848,"w2":0.022},{"opt":"Momentum","step":0,"w1":-3.4,"w2":0.78},{"opt":"Momentum","step":1,"w1":-3.281,"w2":0.203},{"opt":"Momentum","step":2,"w1":-3.061,"w2":-0.812},{"opt":"Momentum","step":3,"w1":-2.761,"w2":-0.325},{"opt":"Momentum","step":4,"w1":-2.4,"w2":0.513},{"opt":"Momentum","step":5,"w1":-1.998,"w2":0.604},{"opt":"Momentum","step":6,"w1":-1.575,"w2":-0.077},{"opt":"Momentum","step":7,"w1":-1.147,"w2":-0.579},{"opt":"Momentum","step":8,"w1":-0.731,"w2":-0.292},{"opt":"Momentum","step":9,"w1":-0.339,"w2":0.329},{"opt":"Momentum","step":10,"w1":0.018,"w2":0.461},{"opt":"Momentum","step":11,"w1":0.332,"w2":-0.004},{"opt":"Momentum","step":12,"w1":0.596,"w2":-0.408},{"opt":"Momentum","step":13,"w1":0.808,"w2":-0.249},{"opt":"Momentum","step":14,"w1":0.966,"w2":0.204},{"opt":"Momentum","step":15,"w1":1.071,"w2":0.346},{"opt":"Momentum","step":16,"w1":1.126,"w2":0.035},{"opt":"Momentum","step":17,"w1":1.135,"w2":-0.283},{"opt":"Momentum","step":18,"w1":1.103,"w2":-0.206},{"opt":"Momentum","step":19,"w1":1.037,"w2":0.121},{"opt":"Momentum","step":20,"w1":0.942,"w2":0.257},{"opt":"Momentum","step":21,"w1":0.826,"w2":0.052},{"opt":"Momentum","step":22,"w1":0.694,"w2":-0.193},{"opt":"Momentum","step":23,"w1":0.554,"w2":-0.166},{"opt":"Momentum","step":24,"w1":0.412,"w2":0.067},{"opt":"Momentum","step":25,"w1":0.272,"w2":0.188},{"opt":"Momentum","step":26,"w1":0.139,"w2":0.057},{"opt":"AdamW","step":0,"w1":-3.4,"w2":0.78},{"opt":"AdamW","step":1,"w1":-3.15,"w2":0.53},{"opt":"AdamW","step":2,"w1":-2.901,"w2":0.287},{"opt":"AdamW","step":3,"w1":-2.653,"w2":0.061},{"opt":"AdamW","step":4,"w1":-2.406,"w2":-0.133},{"opt":"AdamW","step":5,"w1":-2.163,"w2":-0.278},{"opt":"AdamW","step":6,"w1":-1.922,"w2":-0.362},{"opt":"AdamW","step":7,"w1":-1.686,"w2":-0.39},{"opt":"AdamW","step":8,"w1":-1.454,"w2":-0.371},{"opt":"AdamW","step":9,"w1":-1.229,"w2":-0.318},{"opt":"AdamW","step":10,"w1":-1.011,"w2":-0.242},{"opt":"AdamW","step":11,"w1":-0.802,"w2":-0.152},{"opt":"AdamW","step":12,"w1":-0.602,"w2":-0.057},{"opt":"AdamW","step":13,"w1":-0.412,"w2":0.033},{"opt":"AdamW","step":14,"w1":-0.235,"w2":0.112},{"opt":"AdamW","step":15,"w1":-0.071,"w2":0.172},{"opt":"AdamW","step":16,"w1":0.079,"w2":0.21},{"opt":"AdamW","step":17,"w1":0.213,"w2":0.225},{"opt":"AdamW","step":18,"w1":0.332,"w2":0.217},{"opt":"AdamW","step":19,"w1":0.434,"w2":0.19},{"opt":"AdamW","step":20,"w1":0.52,"w2":0.148},{"opt":"AdamW","step":21,"w1":0.589,"w2":0.096},{"opt":"AdamW","step":22,"w1":0.642,"w2":0.04},{"opt":"AdamW","step":23,"w1":0.68,"w2":-0.015},{"opt":"AdamW","step":24,"w1":0.702,"w2":-0.063},{"opt":"AdamW","step":25,"w1":0.71,"w2":-0.101},{"opt":"AdamW","step":26,"w1":0.705,"w2":-0.126}],"pts":[{"w1":-3.4,"w2":0.78,"lbl":"起点 (-3.4, 0.78)"},{"w1":0.0,"w2":0.0,"lbl":"极小值点 (0, 0)"}],"decay":[{"step":0,"l2_hi":2.5,"l2_lo":2.5,"aw_hi":2.5,"aw_lo":2.5},{"step":5,"l2_hi":2.469,"l2_lo":2.4,"aw_hi":2.374,"aw_lo":2.374},{"step":10,"l2_hi":2.465,"l2_lo":2.301,"aw_hi":2.278,"aw_lo":2.278},{"step":15,"l2_hi":2.459,"l2_lo":2.202,"aw_hi":2.185,"aw_lo":2.185},{"step":20,"l2_hi":2.457,"l2_lo":2.105,"aw_hi":2.099,"aw_lo":2.099},{"step":25,"l2_hi":2.453,"l2_lo":2.009,"aw_hi":2.015,"aw_lo":2.015},{"step":30,"l2_hi":2.451,"l2_lo":1.915,"aw_hi":1.937,"aw_lo":1.937},{"step":35,"l2_hi":2.447,"l2_lo":1.822,"aw_hi":1.859,"aw_lo":1.859},{"step":40,"l2_hi":2.446,"l2_lo":1.732,"aw_hi":1.787,"aw_lo":1.787},{"step":45,"l2_hi":2.442,"l2_lo":1.644,"aw_hi":1.715,"aw_lo":1.715},{"step":50,"l2_hi":2.441,"l2_lo":1.559,"aw_hi":1.649,"aw_lo":1.649},{"step":55,"l2_hi":2.437,"l2_lo":1.476,"aw_hi":1.583,"aw_lo":1.583},{"step":60,"l2_hi":2.436,"l2_lo":1.395,"aw_hi":1.522,"aw_lo":1.522},{"step":65,"l2_hi":2.433,"l2_lo":1.317,"aw_hi":1.461,"aw_lo":1.461},{"step":70,"l2_hi":2.431,"l2_lo":1.242,"aw_hi":1.404,"aw_lo":1.404},{"step":75,"l2_hi":2.428,"l2_lo":1.169,"aw_hi":1.348,"aw_lo":1.348},{"step":80,"l2_hi":2.426,"l2_lo":1.099,"aw_hi":1.296,"aw_lo":1.296},{"step":85,"l2_hi":2.423,"l2_lo":1.031,"aw_hi":1.244,"aw_lo":1.244},{"step":90,"l2_hi":2.421,"l2_lo":0.967,"aw_hi":1.196,"aw_lo":1.196},{"step":95,"l2_hi":2.418,"l2_lo":0.905,"aw_hi":1.148,"aw_lo":1.148},{"step":100,"l2_hi":2.417,"l2_lo":0.846,"aw_hi":1.104,"aw_lo":1.104},{"step":105,"l2_hi":2.413,"l2_lo":0.789,"aw_hi":1.059,"aw_lo":1.059},{"step":110,"l2_hi":2.412,"l2_lo":0.735,"aw_hi":1.019,"aw_lo":1.019},{"step":115,"l2_hi":2.408,"l2_lo":0.684,"aw_hi":0.977,"aw_lo":0.977},{"step":120,"l2_hi":2.407,"l2_lo":0.635,"aw_hi":0.94,"aw_lo":0.94},{"step":125,"l2_hi":2.403,"l2_lo":0.589,"aw_hi":0.902,"aw_lo":0.902},{"step":130,"l2_hi":2.402,"l2_lo":0.545,"aw_hi":0.867,"aw_lo":0.867},{"step":135,"l2_hi":2.399,"l2_lo":0.504,"aw_hi":0.832,"aw_lo":0.832},{"step":140,"l2_hi":2.397,"l2_lo":0.465,"aw_hi":0.801,"aw_lo":0.801},{"step":145,"l2_hi":2.394,"l2_lo":0.428,"aw_hi":0.768,"aw_lo":0.768},{"step":150,"l2_hi":2.392,"l2_lo":0.393,"aw_hi":0.739,"aw_lo":0.739}]},"panels":[{"title":"病态二次曲面轨迹 · $L(\\theta_1, \\theta_2) = 0.5\\theta_1^2 + 18\\theta_2^2$","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"平缓方向参数 1","domain":[-3.7,0.95]},"y":{"label":"陡峭方向参数 2","domain":[-0.92,0.92]},"grid":true,"marks":[{"mark":"ruleY","data":[0],"stroke":"var(--line)"},{"mark":"ruleX","data":[0],"stroke":"var(--line)"},{"mark":"line","data":"canyon","filter":{"opt":"SGD"},"x":"w1","y":"w2","stroke":"var(--clay)","strokeWidth":1.8},{"mark":"line","data":"canyon","filter":{"opt":"Momentum"},"x":"w1","y":"w2","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"canyon","filter":{"opt":"AdamW"},"x":"w1","y":"w2","stroke":"var(--teal)","strokeWidth":2.4},{"mark":"dot","data":"canyon","filter":{"opt":"AdamW"},"x":"w1","y":"w2","fill":"var(--teal)","r":2.2,"tip":["opt","step","w1","w2"]},{"mark":"dot","data":"pts","x":"w1","y":"w2","fill":"var(--ink)","r":4.2},{"mark":"text","data":[{"w1":-3.3,"w2":0.84,"t":"起点"}],"x":"w1","y":"w2","text":"t","textAnchor":"start","fill":"var(--ink)"},{"mark":"text","data":[{"w1":0.0,"w2":-0.22,"t":"极值点 (0, 0)"}],"x":"w1","y":"w2","text":"t","textAnchor":"middle","fill":"var(--ink)"}]},{"title":"冗余参数衰减对比 · 高梯度 $\\theta_1$ ($\\sqrt{v_t}\\approx 40$) 与低梯度 $\\theta_2$ ($\\sqrt{v_t}\\approx 0.05$)","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"迭代步数 Step t","domain":[0,155]},"y":{"label":"参数数值","domain":[0,2.75]},"grid":true,"marks":[{"mark":"line","data":"decay","x":"step","y":"l2_hi","stroke":"var(--clay)","strokeWidth":2.4},{"mark":"line","data":"decay","x":"step","y":"l2_lo","stroke":"var(--orange)","strokeWidth":2.0,"strokeDasharray":"5 3"},{"mark":"line","data":"decay","x":"step","y":"aw_hi","stroke":"var(--teal)","strokeWidth":2.6},{"mark":"line","data":"decay","x":"step","y":"aw_lo","stroke":"var(--blue)","strokeWidth":1.8,"strokeDasharray":"2 3"},{"mark":"dot","data":"decay","x":"step","y":"l2_hi","fill":"var(--clay)","r":2,"tip":["step","l2_hi","l2_lo","aw_hi"]},{"mark":"text","data":[{"step":148,"y":2.54,"t":"Adam+L2 高梯度参数停留在 2.39"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"step":148,"y":1.78,"t":"AdamW 两参数重合衰减至 0.74"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"},{"mark":"text","data":[{"step":148,"y":0.22,"t":"Adam+L2 低梯度参数压缩至 0.39"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--orange)"}]}]}
```

顺便回答一个常见的工程细节：为什么 `RMSNorm` 的缩放向量 $\gamma$（以及一维偏置 `bias`）在配 `AdamW` 时总是把 `weight_decay` 设成 `0.0`？

因为 $\gamma$ 初始化就是全 $1$，它的本职工作是在特征归一到单位均方根之后微调各通道增益，参数量还不到全模型的万分之五，根本不存在高维矩阵过拟合的风险。硬把 $\gamma$ 往 $0$ 拉，只会无谓地压扁整层激活，迫使上下游线性层反向放大权重去代偿。

---

## 四、从逐元素范数到二维算子谱范数：推导矩阵优化器 `Muon`

到这里，我们拿到了现代预训练的黄金基线 `AdamW`。

现在请把第 1 节与第 2 节的两块拼图合拢：Transformer 内部占非词表参数 $95\%$ 以上的权重（$W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}$）全都是二维线性算子 $W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$，而它们的梯度 $G = \sum_{n=1}^N \delta_n x_n^\top$ 又天生带着极度偏斜的奇异值谱。

当我们把这样一张二维矩阵扔给 `AdamW` 时，它在几何上到底干了什么？

### 4.1 AdamW 的隐含几何假设：逐元素最大范数下的最速下降

为了看清非欧氏范数下的更新方向，我们把第 3 节的二次邻近惩罚改写成等价的**范数球硬约束最速下降（Normalized Steepest Descent）**。

记两张同形状矩阵的 Frobenius 内积为 $\langle A, B \rangle_F \triangleq \mathrm{tr}(A^\top B) = \sum_{i, j} A_{i, j} B_{i, j}$，对应的 Frobenius 范数为 $\|A\|_F = \sqrt{\langle A, A \rangle_F}$。给定任意一把矩阵范数尺子 $\|\cdot\|$ 与步长预算 $\eta > 0$，范数球最速下降求解的是：

$$
\Delta W^* = \mathrm{arg}\min_{\|\Delta W\| \le \eta} \langle G, \Delta W \rangle_F
$$

（由拉格朗日对偶可知，硬约束解与二次惩罚解指向完全相同的方向，只是硬约束把每一步的范数步长直接归一到了 $\eta$。比如选 Frobenius 范数 $\|\Delta W\|_F \le \eta$ 时，精确解就是归一化负梯度 $-\eta G / \|G\|_F$。）

现在关掉 `Adam` 的历史记忆（令 $\beta_1 = 0, \beta_2 = 0, \epsilon \to 0$），看看它的瞬时骨架：每个格子 $(i, j)$ 的更新量变成了 $-\eta \frac{G_{i, j}}{\sqrt{G_{i, j}^2}} = -\eta \,\mathrm{sign}(G_{i, j})$，也就是符号梯度下降 `SignSGD`。

这个更新方向对应哪一把矩阵范数？恰恰是**逐元素最大绝对值范数** $\|\Delta W\|_{\max} \triangleq \max_{i, j} |\Delta W_{i, j}|$（即把矩阵压扁成向量后的 $\ell_\infty$ 范数）：

$$
\min_{\|\Delta W\|_{\max} \le \eta} \langle G, \Delta W \rangle_F = \min_{\forall i, j:\; |\Delta W_{i, j}| \le \eta} \sum_{i=1}^{d_{\mathrm{out}}} \sum_{j=1}^{d_{\mathrm{in}}} G_{i, j} \Delta W_{i, j} \quad \Longrightarrow \quad \Delta W_{i, j}^* = -\eta \,\mathrm{sign}(G_{i, j})
$$

一句话点破本质：**`AdamW` 在几何上就是带指数移动平均平滑的逐元素 $\ell_\infty$ 范数最速下降**[@bernstein2024]。

把一张 $d_{\mathrm{out}} \times d_{\mathrm{in}}$ 的二维线性变换拆成 $d_{\mathrm{out}} \cdot d_{\mathrm{in}}$ 个互不相干的小格子各自限幅，藏着两个深层缺陷：

1. **它依赖坐标轴的任意选取，对空间旋转不透明**。给隐状态空间做一次正交旋转 $h \mapsto Q h$（$Q^\top Q = I$），线性映射的几何意义丝毫未变，但逐格取符号却不满足旋转等变性（$\mathrm{sign}(Q G) \neq Q \,\mathrm{sign}(G)$）。
2. **拉平了每个格子，不等于拉平了正交特征方向**。当梯度矩阵被单个主方向垄断——比如是一张秩为 $1$ 的外积 $G = u v^\top$ 时，逐格取符号算出来的 $\mathrm{sign}(u v^\top) = \mathrm{sign}(u)\,\mathrm{sign}(v)^\top$ **依然是一张秩为 $1$ 的矩阵**！单靠每个格子各除以自己的 $\sqrt{\hat{v}_{i, j}}$，根本救不活底下几十个微弱的尾部奇异子空间。

口说无凭，直接把第 2.4 节刚手算出来的那张 $2 \times 3$ 梯度 $G = \begin{bsmallmatrix} -1.0 & -2.0 & -0.4 \\ 0.4 & 0.8 & 0.2 \end{bsmallmatrix}$ 代进第 $t=1$ 步的偏差修正版 `Adam`（此时 $\hat{M}_1 = G$，$\hat{V}_1 = G \odot G = \begin{bsmallmatrix} 1.00 & 4.00 & 0.16 \\ 0.16 & 0.64 & 0.04 \end{bsmallmatrix}$，忽略 $\epsilon$）：

$$
U_{\mathrm{Adam}, 1} = \frac{\hat{M}_1}{\sqrt{\hat{V}_1}} =
\begin{bmatrix}
-1.0 / 1.0 & -2.0 / 2.0 & -0.4 / 0.4 \\
0.4 / 0.4 & 0.8 / 0.8 & 0.2 / 0.2
\end{bmatrix}
=
\begin{bmatrix}
-1 & -1 & -1 \\
+1 & +1 & +1
\end{bmatrix}
$$

这个结果非常值得玩味！

表面上看，6 个格子的绝对值都被整整齐齐拉平到了 $1$。可仔细一瞧，第 2 行变成了第 1 行的严格相反数，整张更新矩阵直接坍缩成了**秩为 $1$ 的退化矩阵**（$\sigma_1 \approx 2.45,\; \sigma_2 = \mathbf{0.00}$）！原本藏在第 3 列里、唯一能区分词元 2 和词元 1 的微弱新特征信号（$\sigma_2 \approx 0.037$），被逐格除法彻底抹杀了。

不妨提前剧透对比一下：如果对同一张 $G$ 算下一小节即将导出的半正交极因子 $U V^\top$，得到的是满秩矩阵 $\begin{bsmallmatrix} -0.438 & -0.877 & +0.199 \\ +0.089 & +0.178 & \mathbf{+0.980} \end{bsmallmatrix}$。它的两行严格正交（$\sigma_1 = \sigma_2 = 1$），第 2 个输出神经元会自动腾出 $98\%$ 的步幅，精准扑向第 3 列那个稀有特征。

### 4.2 从 `Shampoo` 双边预条件到无状态极限的代数化简

既然不能拆成孤立格子，那该怎么保留行列耦合结构做矩阵预条件？

如果把 $W \in \mathbb{R}^{A \times B}$ 硬拉成长 $A B$ 的向量去做全矩阵 `AdaGrad`，协方差矩阵会膨胀到 $(A B) \times (A B)$。当 $A = B = 4096$ 时，光这一张表就有 $2.8 \times 10^{14}$ 个浮点数，显存和算力当场出局。

2018 年，Gupta、Koren 与 Singer 提出了优雅的折中方案 **Shampoo**[@gupta2018]：用克罗内克积拆成左右两张小表——左边攒行空间协方差 $L_t = \sum_{s=1}^t G_s G_s^\top \in \mathbb{R}^{A \times A}$，右边攒列空间协方差 $R_t = \sum_{s=1}^t G_s^\top G_s \in \mathbb{R}^{B \times B}$，更新方向取双边分数次幂 $L_t^{-1/4} G_t R_t^{-1/4}$。

为什么指数偏偏是 $-1/4$，而不是 `AdaGrad` 的 $-1/2$？数一下量纲就明白了：$L_t$ 和 $R_t$ 都是梯度的二次型（量纲 $G^2$），左边乘 $L_t^{-1/4}$（量纲 $G^{-1/2}$）、右边乘 $R_t^{-1/4}$（量纲 $G^{-1/2}$），左右合起来正好是 $G^{-1}$，跟中间一次方的 $G_t$ 抵消成零阶单位步幅。

后来研究者在实验里发现了一个出人意料的现象：把 `Shampoo` 的跨步历史累加关掉，只拿当期梯度（或动量）矩阵 $G$ 算瞬时无状态版本 $((G G^\top)^+)^{1/4} G ((G^\top G)^+)^{1/4}$（$(\cdot)^+$ 为 Moore-Penrose 伪逆），收敛非但没变差，反而经常更快[@bernstein2024]！

我们动手把这个双边 $-1/4$ 次幂化简到底，看看它究竟是个什么东西。

设矩阵 $G \in \mathbb{R}^{A \times B}$ 的秩为 $r \le \min(A, B)$，写出它的**精简奇异值分解（Reduced SVD）**：

$$
G = U \Sigma V^\top
$$

其中左奇异向量 $U \in \mathbb{R}^{A \times r}$ 列正交（$U^\top U = I_r$），对角阵 $\Sigma = \mathrm{diag}(\sigma_1, \dots, \sigma_r) \in \mathbb{R}^{r \times r}$ 装着全部正奇异值（$\sigma_1 \ge \dots \ge \sigma_r > 0$），右奇异向量 $V \in \mathbb{R}^{B \times r}$ 也列正交（$V^\top V = I_r$）。（顺手记一条后面要用的恒等式：$\|G\|_F^2 = \mathrm{tr}(G^\top G) = \sum_{i=1}^r \sigma_i^2$。）

先算出左右两张格拉姆矩阵（Gram Matrix）：

$$
G G^\top = (U \Sigma V^\top)(V \Sigma U^\top) = U \Sigma^2 U^\top, \qquad G^\top G = (V \Sigma U^\top)(U \Sigma V^\top) = V \Sigma^2 V^\top
$$

在非零奇异子空间上取伪逆的 $1/4$ 次幂，相当于直接对对角线上的 $\sigma_i^2$ 开 $-1/4$ 次方，得到 $\Sigma^{-1/2}$：

$$
((G G^\top)^+)^{1/4} = U \Sigma^{-1/2} U^\top, \qquad ((G^\top G)^+)^{1/4} = V \Sigma^{-1/2} V^\top
$$

把左、中、右三块拼起来连乘，利用 $U^\top U = I_r$ 和 $V^\top V = I_r$：

$$
((G G^\top)^+)^{1/4} G ((G^\top G)^+)^{1/4} = \bigl(U \Sigma^{-1/2} U^\top\bigr)(U \Sigma V^\top)\bigl(V \Sigma^{-1/2} V^\top\bigr) = U \Sigma^{-1/2} \Sigma \Sigma^{-1/2} V^\top = U I_r V^\top = U V^\top
$$

中间的奇异值矩阵 $\Sigma$ 干干净净地全部约掉了！

不管原本 $\sigma_1$ 到 $\sigma_r$ 之间差了十倍还是一万倍，化简完统统归为 $1$。当 $G$ 满秩（$r = \min(A, B)$，随机梯度下几乎必然成立）时，$U V^\top \in \mathbb{R}^{A \times B}$ 就是离 $G$ 最近的**半正交矩阵（Semi-orthogonal Matrix）**——高矩阵满足列正交 $(U V^\top)^\top (U V^\top) = I_B$，宽矩阵满足行正交 $(U V^\top)(U V^\top)^\top = I_A$。

### 4.3 第一性原理推导：隐藏层诱导算子范数下的最速下降解

2024 年，Bernstein 与 Newhouse 在 *Old Optimizer, New Norm*[@bernstein2024] 中给出了一套更透彻的解释：半正交更新 $U V^\top$ 根本不需要借道“近似二阶海森矩阵”来辩护——它本来就是**隐藏线性层在自身物理诱导范数下的精确一阶最速下降解**。

我们来一步步重现这个第一性原理推导。

考察 Transformer 内部的一层线性映射 $y = W x$，它把输入向量 $x \in \mathbb{R}^{d_{\mathrm{in}}}$ 映到输出向量 $y \in \mathbb{R}^{d_{\mathrm{out}}}$。回想第 2.1 节的结论：`RMSNorm` 决定了隐藏层里每个词向量的自然大小是用**均方根范数（RMS Norm）**度量的：

$$
\|x\|_{\mathrm{RMS}} \triangleq \frac{1}{\sqrt{d_{\mathrm{in}}}} \|x\|_2, \qquad \|y\|_{\mathrm{RMS}} \triangleq \frac{1}{\sqrt{d_{\mathrm{out}}}} \|y\|_2
$$

现在把权重从 $W$ 改动到 $W + \Delta W$。同一个输入词向量 $x$ 引起的本层输出变化量就是 $\Delta y = \Delta W x$。

我们希望无论网络宽度 $d_{\mathrm{in}}, d_{\mathrm{out}}$ 设成多少，单步更新造成的输出激活波动都受控在固定步幅以内。那么，丈量矩阵步长 $\Delta W$ 最合乎物理意义的尺子，就是“输入 RMS 为 $1$ 的向量最多能把输出 RMS 撼动多少”——这正是线性代数里的 **$\mathrm{RMS} \to \mathrm{RMS}$ 诱导算子范数**：

$$
\|\Delta W\|_{\mathrm{RMS} \to \mathrm{RMS}} \triangleq \max_{x \neq 0} \frac{\|\Delta W x\|_{\mathrm{RMS}}}{\|x\|_{\mathrm{RMS}}} = \max_{x \neq 0} \frac{\frac{1}{\sqrt{d_{\mathrm{out}}}}\|\Delta W x\|_2}{\frac{1}{\sqrt{d_{\mathrm{in}}}}\|x\|_2} = \sqrt{\frac{d_{\mathrm{in}}}{d_{\mathrm{out}}}} \max_{\|x\|_2 = 1} \|\Delta W x\|_2 = \sqrt{\frac{d_{\mathrm{in}}}{d_{\mathrm{out}}}}\, \sigma_1(\Delta W)
$$

看到了吗？算出来的恰好是长宽比系数乘上 $\Delta W$ 的最大奇异值 $\sigma_1(\Delta W)$（即标准谱范数）！

拿着这把诱导范数尺子，给定当期动量矩阵 $\tilde{M} = U \Sigma V^\top = \sum_{i=1}^r \sigma_i u_i v_i^\top$（$\sigma_i > 0$），我们直接求解范数球约束下的最速下降问题：

$$
\min_{\|\Delta W\|_{\mathrm{RMS} \to \mathrm{RMS}} \le \eta} \langle \tilde{M}, \Delta W \rangle_F \quad \Longleftrightarrow \quad \min_{\sigma_1(\Delta W) \le \eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}} \mathrm{tr}(\tilde{M}^\top \Delta W)
$$

利用迹的循环交换律把内积拆成 $r$ 个奇异方向的加权和：

$$
\langle \tilde{M}, \Delta W \rangle_F = \mathrm{tr}\!\left(\sum_{i=1}^{r} \sigma_i v_i u_i^\top \Delta W\right) = \sum_{i=1}^{r} \sigma_i \, u_i^\top \Delta W v_i
$$

因为左右奇异向量都是单位向量（$\|u_i\|_2 = \|v_i\|_2 = 1$），由柯西-施瓦茨不等式与最大奇异值定义，每一项投影都被同一个上界牢牢卡住：

$$
|u_i^\top \Delta W v_i| \le \|u_i\|_2 \, \|\Delta W v_i\|_2 \le \sigma_1(\Delta W) \le \eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}}
$$

再乘上正权重 $\sigma_i > 0$ 求和，目标函数的理论最低下界立刻浮现：

$$
\langle \tilde{M}, \Delta W \rangle_F = \sum_{i=1}^{r} \sigma_i \, u_i^\top \Delta W v_i \ge -\eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}} \sum_{i=1}^{r} \sigma_i
$$

什么时候能取到这个最速下降等号？当且仅当对**全部 $r$ 个非零奇异方向**，都有 $u_i^\top \Delta W v_i = -\eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}$ **同时取满负界**！

把半正交候选解代进去验算：

$$
\Delta W^* = -\eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}} \, U V^\top
$$

一方面，它的最大奇异值 $\sigma_1(\Delta W^*) = \eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}$ 刚好压在范数球边界上；另一方面，对每个 $i$ 都有 $u_i^\top \Delta W^* v_i = -\eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}$，分毫不差地取满下界（满秩时该最优解唯一）。

这就是 **Muon** 背后的全部几何秘密：Frobenius 球顺着偏斜梯度原样走，逐元素 $\ell_\infty$ 方盒只管拉平孤立坐标，唯独 $\mathrm{RMS} \to \mathrm{RMS}$ 诱导谱范数球**强迫全部 $r$ 个正交特征子空间肩并肩、以完全相等的步幅齐头并进**。

```sketch title="三种范数球约束下的最速下降几何对比" note="在 Frobenius 范数球下，步幅集中在最大奇异值方向；在逐元素 $\ell_\infty$ 立方体下，单格步幅拉平但丢失子空间正交性；在算子谱范数下，全部非零奇异值统一归一化为 $1$。"
<svg viewBox="0 0 704 228">
  <rect class="panel" x="0" y="0" width="224" height="228" rx="12"/>
  <text class="caps" x="20" y="25">1 · FROBENIUS NORM BALL</text>
  <circle cx="112" cy="96" r="40" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.5"/>
  <path class="edge hot" d="M112 96 L146 75" marker-end="url(#arrow)"/>
  <tex class="small mid" x="112" y="162">\|\Delta W\|_F \le \eta \implies -\eta G / \|G\|_F</tex>
  <text class="small mid mute" x="112" y="186">保持原始奇异值比例不变</text>
  <text class="small mid mute" x="112" y="206">步幅集中于最大奇异值方向</text>

  <rect class="panel" x="240" y="0" width="224" height="228" rx="12"/>
  <text class="caps" x="260" y="25">2 · ENTRYWISE MAX NORM</text>
  <rect x="312" y="56" width="80" height="80" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.5"/>
  <path class="edge" d="M352 96 L390 58" marker-end="url(#arrow)"/>
  <tex class="small mid" x="352" y="162">\|\Delta W\|_{\max} \le \eta \implies -\eta\,\mathrm{sign}(G)</tex>
  <text class="small mid mute" x="352" y="186">动量平滑后对应 AdamW 更新</text>
  <text class="small mid mute" x="352" y="206">平衡单坐标幅度，不改变低秩偏斜</text>

  <rect class="panel" x="480" y="0" width="224" height="228" rx="12"/>
  <text class="caps" x="500" y="25">3 · OPERATOR SPECTRAL NORM</text>
  <ellipse cx="592" cy="96" rx="58" ry="16" transform="rotate(-18 592 96)" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.25" stroke-dasharray="4 3"/>
  <circle cx="592" cy="96" r="38" fill="none" stroke="var(--blue)" stroke-width="2"/>
  <tex class="small mid b" x="592" y="96" width="64">U \Sigma V^\top \mapsto U V^\top</tex>
  <tex class="small mid" x="592" y="162">\|\Delta W\|_{\mathrm{RMS}\to\mathrm{RMS}} \le \eta</tex>
  <text class="small mid mute" x="592" y="186">半正交解令全部奇异值归 1</text>
  <text class="small mid mute" x="592" y="206">长尾稀有子空间与主方向同步学习</text>
</svg>
<svg viewBox="0 0 340 492">
  <rect class="panel" x="0" y="0" width="340" height="152" rx="12"/>
  <text class="caps" x="16" y="24">1 · FROBENIUS NORM BALL</text>
  <circle cx="68" cy="88" r="34" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.5"/>
  <path class="edge hot" d="M68 88 L98 70" marker-end="url(#arrow)"/>
  <tex class="small" x="122" y="68">\|\Delta W\|_F \le \eta \implies -\eta G / \|G\|_F</tex>
  <text class="small mute" x="122" y="94">步幅集中于大奇异值方向</text>
  <text class="small mute" x="122" y="116">尾部子空间更新微弱</text>

  <rect class="panel" x="0" y="168" width="340" height="152" rx="12"/>
  <text class="caps" x="16" y="192">2 · ENTRYWISE MAX NORM</text>
  <rect x="34" y="222" width="68" height="68" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.5"/>
  <path class="edge" d="M68 256 L100 224" marker-end="url(#arrow)"/>
  <tex class="small" x="122" y="236">\|\Delta W\|_{\max} \le \eta \implies -\eta\,\mathrm{sign}(G)</tex>
  <text class="small mute" x="122" y="262">平滑后对应 AdamW 逐格自适应</text>
  <text class="small mute" x="122" y="284">不消除矩阵整体的奇异值偏斜</text>

  <rect class="panel" x="0" y="336" width="340" height="156" rx="12"/>
  <text class="caps" x="16" y="360">3 · SPECTRAL NORM (MUON)</text>
  <ellipse cx="68" cy="426" rx="44" ry="13" transform="rotate(-18 68 426)" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <circle cx="68" cy="426" r="32" fill="none" stroke="var(--blue)" stroke-width="2"/>
  <tex class="small" x="122" y="404">U \Sigma V^\top \mapsto U V^\top</tex>
  <text class="small mute" x="122" y="430">算子谱范数约束下的精确解</text>
  <text class="small mute" x="122" y="452">全部正交特征方向步幅统一为 1</text>
</svg>
```

### 4.4 用同一套诱导范数理论导出参数分流规则

在工业界用 `Muon` 预训练大模型时，有一条铁律：内部隐藏层的二维投影矩阵（`W_q, W_k, W_v, W_o, W_up, W_down`）交给 `Muon`，而入口嵌入表（`tok_emb, pos_emb`）、出口分类头（`lm_head`）与一维 `RMSNorm` 增益向量继续留给 `AdamW`[@jordan2024][@liu2025]。

有人会问：`tok_emb` 和 `lm_head` 明明也是二维大矩阵，为什么不能一并塞进 `Muon` 做正交化？

答案根本不用靠经验试错，直接拿**各层自己输入输出空间的诱导范数**一量便知[@bernstein2024]：

1. **词嵌入表 $E_{\mathrm{tok}} \in \mathbb{R}^{V \times D}$（自然映射 $\ell_1 \to \mathrm{RMS}$）**。嵌入层吃进来的是独热向量 $u \in \mathbb{R}^V$，它的自然大小是绝对值和 $\|u\|_1 = 1$；吐出去的是残差流向量，自然大小是 $\|\cdot\|_{\mathrm{RMS}}$。

   由于凸函数在多面体 $\ell_1$ 球上的最大值一定落在某个独热顶点 $u = e_v$ 上，这层的诱导算子范数直接化简为：

$$
\|\Delta E_{\mathrm{tok}}^\top\|_{\ell_1 \to \mathrm{RMS}} = \max_{\|u\|_1 = 1} \|\Delta E_{\mathrm{tok}}^\top u\|_{\mathrm{RMS}} = \max_{v \in \{0, \dots, V-1\}} \|\Delta E_{\mathrm{tok}}[v, :]\|_{\mathrm{RMS}}
$$

   看，它是对词表的每一行各自取最大——**不同词元行之间在几何上彻底解耦**！况且每个训练批次最多只翻开 $B \times T$ 个词，词表里绝大多数行梯度全为零；要是强行跨行做全局谱正交化，反而会把高频词和生僻词的嵌入行搅成一锅粥。
2. **输出分类头 $W_{\mathrm{head}} \in \mathbb{R}^{V \times D}$（自然映射 $\mathrm{RMS} \to \ell_\infty$）**。它吃进单位 $\mathrm{RMS}$ 的末端隐状态 $h \in \mathbb{R}^D$，吐出词表打分 $z = W_{\mathrm{head}} h \in \mathbb{R}^V$。Softmax 分布对最大分量变化 $\max_v |z_v| = \|z\|_\infty$ 最敏感，算出来的诱导范数 $\|\Delta W_{\mathrm{head}}\|_{\mathrm{RMS} \to \ell_\infty} = \max_v \sqrt{D}\,\|\Delta W_{\mathrm{head}}[v, :]\|_2$ 同样按词表行逐行解耦。把首尾这两张词表矩阵留给逐坐标自适应的 `AdamW`，正好顺应了行间互不串扰的几何天性[@jordan2024][@liu2025]。
3. **一维 `RMSNorm` 向量 $\gamma \in \mathbb{R}^D$**。就算硬把它看成 $D \times 1$ 矩阵，它的秩最多也只有 $1$，全身上下就一个奇异值 $\sigma_1 = \|\gamma\|_2$，压根不存在奇异值失衡问题；真去做正交化只会把它除成单位向量，废掉各通道独立调增益的能力。

```sketch title="由各层输入输出空间范数决定的双优化器参数分流" note="只有输入与输出同属连续隐藏向量空间（$\mathrm{RMS} \to \mathrm{RMS}$）的二维线性层才对应谱范数正交化；按行解耦的离散入口、打分出口与一维向量则交由 AdamW 维护。"
<svg viewBox="0 0 704 218">
  <rect class="panel" x="0" y="0" width="340" height="218" rx="12"/>
  <text class="caps" x="20" y="25">INTERNAL 2D OPERATORS · MUON</text>
  <g class="node blue"><rect x="20" y="40" width="300" height="44" rx="6"/><tex class="mid" x="170" y="62">W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}</tex></g>
  <path class="edge" d="M170 84 V106" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="20" y="110" width="300" height="50" rx="6"/><tex class="mid" x="170" y="129">\mathrm{RMS} \to \mathrm{RMS} \implies \Delta W \propto -U V^\top</tex><text class="mid small" x="170" y="149">拉平全奇异值谱 · 省去二阶矩张量 V</text></g>
  <text class="small" x="20" y="190">连续隐空间线性变换，占非词表参数总量的 95% 以上</text>

  <rect class="panel" x="364" y="0" width="340" height="218" rx="12"/>
  <text class="caps" x="384" y="25">BOUNDARY &amp; 1D PARAMS · ADAMW</text>
  <g class="node plain"><rect x="384" y="40" width="300" height="44" rx="6"/><tex class="mid" x="534" y="62">E_{\mathrm{tok}}, E_{\mathrm{pos}}, W_{\mathrm{head}}, \gamma_{\mathrm{norm}}</tex></g>
  <path class="edge" d="M534 84 V106" marker-end="url(#arrow)"/>
  <g class="node violet"><rect x="384" y="110" width="300" height="50" rx="6"/><tex class="mid" x="534" y="128">\ell_1 \to \mathrm{RMS},\; \mathrm{RMS} \to \ell_\infty\;\;(\max_v \|W_{v,:}\|_2)</tex><text class="mid small" x="534" y="149">按词元行解耦 → 交由 AdamW（一维参数设 wd=0）</text></g>
  <text class="small" x="384" y="190">避免稀疏词表行相互串扰与输出打分尺度波动</text>
</svg>
<svg viewBox="0 0 340 392">
  <rect class="panel" x="0" y="0" width="340" height="186" rx="12"/>
  <text class="caps" x="16" y="24">INTERNAL 2D · MUON</text>
  <g class="node blue"><rect x="16" y="38" width="308" height="42" rx="6"/><tex class="mid" x="170" y="59">W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}</tex></g>
  <path class="edge" d="M170 80 V100" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="16" y="104" width="308" height="48" rx="6"/><tex class="mid" x="170" y="122">\mathrm{RMS} \to \mathrm{RMS} \implies -U V^\top</tex><text class="mid small" x="170" y="141">谱正交化更新，省去二阶矩张量 V</text></g>
  <text class="small" x="16" y="172">连续隐空间算子，占非词表主体参数 95% 以上</text>

  <rect class="panel" x="0" y="202" width="340" height="190" rx="12"/>
  <text class="caps" x="16" y="226">BOUNDARY &amp; 1D · ADAMW</text>
  <g class="node plain"><rect x="16" y="240" width="308" height="42" rx="6"/><tex class="mid" x="170" y="261">E_{\mathrm{tok}}, E_{\mathrm{pos}}, W_{\mathrm{head}}, \gamma_{\mathrm{norm}}</tex></g>
  <path class="edge" d="M170 282 V302" marker-end="url(#arrow)"/>
  <g class="node violet"><rect x="16" y="306" width="308" height="48" rx="6"/><text class="mid b" x="170" y="324">按行解耦 → 交由 AdamW 自适应更新</text><text class="mid small" x="170" y="343">避免跨词行串扰，一维缩放向量设衰减率为 0</text></g>
  <text class="small" x="16" y="376">维护稀疏词表行独立步长与输出打分尺度</text>
</svg>
```

---

## 五、牛顿-舒尔茨奇数次多项式迭代与规模化缩放推导

理论推导指明了完美的目标方向 $O_t = U V^\top$。但如果在工程代码里每一步都对上百块 $4096 \times 4096$ 矩阵硬调精确奇异值分解 `torch.linalg.svd`，GPU 流水线立刻就会卡死。

原因在于硬件架构：精确 SVD 依赖双对角化与串行特征值扫描，必须在 `float32` 下做大量细粒度分支旋转，完全用不上现代 GPU 半精度矩阵核心（Tensor Cores）的恐怖吞吐力。

2024 年 10 月，Keller Jordan 联合 Bernstein 等人提出的 **Muon（MomentUm Orthogonalized by Newton-Schulz）**[@jordan2024]，最漂亮的一招就是用 **5 步纯 `bfloat16` 奇数次矩阵多项式乘法**，在无需任何 SVD 的前提下算出了 $U V^\top$ 的高精近似。

### 5.1 为什么奇数次矩阵多项式能保持左右奇异向量不变

设矩阵 $X \in \mathbb{R}^{A \times B}$ 的精简奇异值分解为 $X = U \Sigma V^\top$。我们来看看拿 $X$ 和 $X^\top$ 交替相乘凑出来的奇数次幂长什么样：

$$
\begin{aligned}
(X X^\top) X &= (U \Sigma V^\top)(V \Sigma U^\top)(U \Sigma V^\top) = U \Sigma (V^\top V) \Sigma (U^\top U) \Sigma V^\top = U \Sigma^3 V^\top \\
(X X^\top)^2 X &= (U \Sigma^2 U^\top)^2 (U \Sigma V^\top) = U \Sigma^5 V^\top
\end{aligned}
$$

注意，偶数次幂 $X X^\top = U \Sigma^2 U^\top$ 会把右奇异向量 $V^\top$ 约掉，连形状都变成 $A \times A$。只有形如 $(X X^\top)^m X$ 的**奇数次项**，才能原封不动地保住左右两边的正交基底 $U$ 和 $V^\top$！

于是，对任意五次奇多项式 $\varphi(\sigma) = a \sigma + b \sigma^3 + c \sigma^5$，只要令格拉姆矩阵 $A_k = X_k X_k^\top$，反复执行纯矩阵乘法：

$$
X_{k+1} = a X_k + (b A_k + c A_k^2) X_k
$$

在奇异谱的视角下，这就等价于死死锁住 $U$ 和 $V^\top$ 不动，只对对角线上的每个奇异值单独套用标量函数 $\varphi$：

$$
X_{k+1} = U \varphi(\Sigma_k) V^\top, \qquad \sigma_{k+1, i} = \varphi(\sigma_{k, i}) = a \sigma_{k, i} + b \sigma_{k, i}^3 + c \sigma_{k, i}^5
$$

在踏进第 $0$ 步循环之前，还有两道四两拨千斤的预处理：

1. **除以 Frobenius 范数，把初值锁进 $[0, 1]$ 收敛域**。五次项 $c \sigma^5$ 在 $\sigma > 1$ 时会迅速发散爆炸，所以迭代前必须把所有奇异值压进 $[0, 1]$。利用 $\| \tilde{M}_t \|_F^2 = \sum_{j=1}^r \sigma_j^2 \ge \sigma_1^2$，只需一行除法：

$$
X_0 = \frac{\tilde{M}_t}{\|\tilde{M}_t\|_F + \epsilon}
$$

   不用估最大奇异值，就能保证每个初始奇异值严格落在 $0 \le \sigma_{0, i} \le 1$ 之内。顺便留意，任何正标量因子都会在这行分子分母里自动约掉——所以 `Muon` 的动量递推 $M_t = \mu M_{t-1} + G_t$ 既不用乘 $(1-\mu)$，也完全不需要 `Adam` 那套冷启动偏差修正。
2. **高瘦矩阵先转置（$A > B$ 时省掉 $90\%$ 算力）**。遇到行数大于列数的高矩阵（比如 MLP 升维层 $W_{\mathrm{up}} \in \mathbb{R}^{256 \times 64}$，$A = 4B$），直接算 $X_k X_k^\top$ 会造出 $A \times A$ 的大方阵，单步要花 $(2 A^2 B + A^3)$ 次乘加。

   反过来，要是先把 $X_0$ 转置成 $B \times A$ 的矮宽矩阵再进循环，格拉姆阵立刻缩成 $B \times B$ 小方阵，单步只花 $(2 A B^2 + B^3)$ 次乘加！在 $A = 4B$ 时，计算量从 $96 B^3$ 骤降到 $9 B^3$，省下超过 $90\%$ 算力，跑完 5 步再转置回来，结果逐位相等。

### 5.2 经典牛顿-舒尔茨系数与 `Muon` 极小极大系数的设计权衡

多项式里的那三个神奇数字 $(a, b, c)$ 又是怎么定出来的？我们先从数值代数里的**经典牛顿-舒尔茨迭代**推起。

要把正数 $s > 0$ 推向 $1$，如果直接对 $g(s) = s^2 - 1 = 0$ 用牛顿切线法，算出来的 $s_{k+1} = \frac{1}{2}(s_k + s_k^{-1})$ 带着负一次幂 $s_k^{-1}$，放回矩阵还是逃不掉求逆 $X_k^{-1}$。

怎么把求逆变没？换个等价方程，改对 $f(s) = s^{-2} - 1 = 0$ 用牛顿法！此时导数 $f'(s) = -2 s^{-3}$ 躺在分母上，正好把负指数翻上分子，化成清一色的正奇数次幂：

$$
s_{k+1} = s_k - \frac{f(s_k)}{f'(s_k)} = s_k - \frac{s_k^{-2} - 1}{-2 s_k^{-3}} = \frac{3}{2}s_k - \frac{1}{2}s_k^3
$$

这就是经典三次公式 $(1.5, -0.5)$。同理推广到五次多项式 $\varphi_{\mathrm{classic}}(\sigma) = a\sigma + b\sigma^3 + c\sigma^5$，要求它在不动点 $\sigma = 1$ 处达到三阶超线性收敛（即 $\varphi(1) = 1,\; \varphi'(1) = 0,\; \varphi''(1) = 0$），解三元一次方程组：

$$
\begin{cases}
a + b + c = 1 \\
a + 3b + 5c = 0 \\
6b + 20c = 0
\end{cases}
\quad \Longrightarrow \quad
(a, b, c)_{\mathrm{classic}} = \left(\frac{15}{8},\; -\frac{10}{8},\; \frac{3}{8}\right) = (1.875,\; -1.25,\; 0.375)
$$

这套教科书系数在精确算术里很优雅，可一旦搬进大模型训练，立刻撞上一堵南墙。

$4096$ 维梯度的奇异值动辄横跨上万倍，除以 $\|\tilde{M}_t\|_F$ 后，大批尾部奇异值被挤在 $\sigma_0 \in [10^{-3}, 10^{-2}]$ 角落里。在接近 $0$ 的地方，$\sigma^3, \sigma^5$ 小到可以忽略，每一步能把小奇异值往上拔多少，全看原点斜率 $\varphi'(0) = a$。经典系数 $a = 1.875$ 连跑 5 步，最多只能放大 $1.875^5 \approx 23.2$ 倍——$\sigma_0 = 0.01$ 跑完 5 步才爬到 $0.21$，离 $1$ 还差得远。

Jordan 等人在这儿展现了一流的工程品味。

既然在只有 7 位尾数的 `bfloat16` 噪声梯度里，把奇异值磨到小数点后六位的 $1.000000$ 毫无实战价值，真正要紧的是**在短短 5 步之内把尽量小的尾部奇异值一把拽上来**！

于是，`Muon` 果断放弃了 $\varphi(1) = 1$ 的死板约束，允许五次复合曲线 $\varphi^{(5)}(\sigma)$ 在 $1$ 附近的窄带 $[1 - \delta, 1 + \delta]$ 里做切比雪夫式的等波纹振荡，全力换取不发散前提下最大的原点斜率 $a$[@jordan2024]：

$$
(a, b, c)_{\mathrm{Muon}} = (3.4445,\; -4.7750,\; 2.0315)
$$

拿计算器按两下就能看清这笔买卖有多划算：

- **尾部放大倍率暴涨 $21$ 倍**。原点斜率从 $1.875$ 猛增到 $3.4445$，5 步累计线性增益高达 $3.4445^5 \approx 484.4$ 倍！刚才还卡在半山腰的 $\sigma_0 = 0.01$，现在 5 步直接跃升到 $\varphi^{(5)}(0.01) \approx 0.70$。
- **为什么 $\varphi(1) = 3.4445 - 4.7750 + 2.0315 = 0.7010 \neq 1$？** 这绝不是代码打错了小数点，而是等波纹逼近故意让出的波谷下界。所有落在 $[0.01, 1.0]$ 里的奇异值，5 步之后都会整齐收拢进 $[0.68, 1.13]$ 窄带内（极个别 $(0, 0.01)$ 里的微小值爬坡时最高触及多项式峰顶 $\approx 1.20$）。

为了彻底捅破“只靠矩阵乘法怎么可能不调 SVD 就挖出微弱奇异方向”这层窗户纸，我们拿一张 $2 \times 2$ 偏斜动量矩阵把这 5 步亲手算一遍：

$$
\tilde{M} =
\underbrace{\begin{bmatrix} 10 & 10 \\ 10 & 10 \end{bmatrix}}_{\text{主奇异方向 }\sigma_1 = 20.0}
+
\underbrace{\begin{bmatrix} -0.1 & +0.1 \\ +0.1 & -0.1 \end{bmatrix}}_{\text{微弱正交子空间 }\sigma_2 = 0.2}
=
\begin{bmatrix}
9.9 & 10.1 \\
10.1 & 9.9
\end{bmatrix}
$$

肉眼看去，$\tilde{M}$ 四个数全挤在 $10$ 左右，正对角线与反对角线只差微不足道的 $0.2$。

如果交给逐格取符号（无记忆 `Adam` 极限），四个正数直接变成全 $1$ 的秩一矩阵 $\begin{bsmallmatrix} 1 & 1 \\ 1 & 1 \end{bsmallmatrix}$（$\sigma = [2, 0]$），反对角线上的微弱特征当场灰飞烟灭。而真正的半正交极因子，其实是干净利落的置换矩阵 $U V^\top = \begin{bsmallmatrix} 0 & 1 \\ 1 & 0 \end{bsmallmatrix}$（$\sigma = [1, 1]$）。

现在完全不碰特征分解，只跑 `Muon` 的预归一化与五次矩阵乘递推 $X_{k+1} = 3.4445 X_k + (-4.7750 A_k + 2.0315 A_k^2) X_k$：

1. **第 $0$ 步预归一化**。$\|\tilde{M}\|_F = \sqrt{400.04} \approx 20.001$，整阵除完得到 $X_0 = \begin{bsmallmatrix} 0.495 & 0.505 \\ 0.505 & 0.495 \end{bsmallmatrix}$，两个奇异值是悬殊的 $(1.000, 0.010)$。
2. **第 $1$ 步怎么把 $0.495$ 和 $0.505$ 掰开的？** 算格拉姆阵 $A_0 = X_0 X_0^\top \approx \begin{bsmallmatrix} 0.50005 & 0.49995 \\ 0.49995 & 0.50005 \end{bsmallmatrix}$。它在主方向 $\begin{bsmallmatrix} 1 \\ 1 \end{bsmallmatrix}$ 上特征值为 $1$，所以负三次项 $-4.7750 A_0 X_0$ 狠狠踩下刹车，把主方向压到 $0.701$；而在差模方向 $\begin{bsmallmatrix} -1 \\ 1 \end{bsmallmatrix}$ 上，特征值只有 $0.01^2 = 0.0001$，高次阻尼项几乎为零，一次项 $3.4445 X_0$ 得以全速把微弱差距放大 $3.4445$ 倍，算出 $X_1 = \begin{bsmallmatrix} 0.333 & 0.368 \\ 0.368 & 0.333 \end{bsmallmatrix}$！
3. **一口气跑完第 $1 \sim 5$ 步**：

$$
\begin{aligned}
X_0 &= \begin{bmatrix} 0.495 & 0.505 \\ 0.505 & 0.495 \end{bmatrix} \xrightarrow{k=1}
X_1 = \begin{bmatrix} 0.333 & 0.368 \\ 0.368 & 0.333 \end{bmatrix} \xrightarrow{k=2}
X_2 = \begin{bmatrix} 0.498 & 0.616 \\ 0.616 & 0.498 \end{bmatrix} \\[6pt]
&\xrightarrow{k=3}
X_3 = \begin{bmatrix} 0.160 & 0.560 \\ 0.560 & 0.160 \end{bmatrix} \xrightarrow{k=4}
X_4 = \begin{bmatrix} -0.002 & 1.092 \\ 1.092 & -0.002 \end{bmatrix} \xrightarrow{k=5}
X_5 = \begin{bmatrix} -0.001 & 0.698 \\ 0.698 & -0.001 \end{bmatrix}
\end{aligned}
$$

短短 5 轮普通矩阵乘法，主对角线上喧宾夺主的共模背景自动归零（$-0.001$），深埋在小数点后一位的反对角置换算子水落石出（$\approx 0.70 \begin{bsmallmatrix} 0 & 1 \\ 1 & 0 \end{bsmallmatrix}$），奇异值比从 $100:1$ 完美拉平到 $(0.699,\; 0.697)$。

```sketch title="展开数值图解：偏斜动量矩阵在三种更新规则与 5 步牛顿-舒尔茨迭代下的逐格数值演变" note="输入矩阵 $\tilde{M} = \begin{bsmallmatrix}9.9 & 10.1\\10.1 & 9.9\end{bsmallmatrix}$ 含主奇异值 $20.0$ 与微弱正交奇异值 $0.2$。逐格取符号因四格皆正而退化为秩 $1$ 全 $1$ 阵；牛顿-舒尔茨五次多项式迭代无需分解特征向量，仅凭 5 步矩阵乘法便将隐藏在小数点后一位的反对角正交结构完整分离出来。"
<svg viewBox="0 0 704 446">
  <rect class="panel" x="0" y="0" width="704" height="206" rx="12"/>
  <text class="caps" x="18" y="22">1 · 同一张 100:1 偏斜矩阵在三种更新规则下的展开结果对比</text>
  <text class="small b" x="18" y="44">输入动量 = [[10,10],[10,10]]（σ₁=20）+ [[-0.1,0.1],[0.1,-0.1]]（σ₂=0.2），微弱差模信号被共模底数淹没</text>

  <g>
  <path d="M24.5 80.0 H20.0 V130.0 H24.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M101.5 80.0 H106.0 V130.0 H101.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="24.0" y="82.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="43.0" y="93.0">9.9</text>
  <rect x="64.0" y="82.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small b" x="83.0" y="93.0">10.1</text>
  <rect x="24.0" y="106.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small b" x="43.0" y="117.0">10.1</text>
  <rect x="64.0" y="106.0" width="38.0" height="22.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="83.0" y="117.0">9.9</text>
  <text class="mid small mute" x="63.0" y="71.0">σ = (20.0, 0.2)</text>
  <tex class="mid small" x="63.0" y="145.0">\tilde{{M}}</tex>
  </g>
  <path class="edge" d="M114 105 H150" marker-end="url(#arrow)"/>

  <rect x="158" y="58" width="166" height="132" rx="8" fill="var(--card)" stroke="var(--line)"/>
  <text class="mid small b" x="241" y="76">SGD / Frobenius 归一化</text>
  <g>
  <path d="M196.5 88.0 H192.0 V138.0 H196.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M285.5 88.0 H290.0 V138.0 H285.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="196.0" y="90.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="218.0" y="101.0">0.495</text>
  <rect x="242.0" y="90.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="264.0" y="101.0">0.505</text>
  <rect x="196.0" y="114.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="218.0" y="125.0">0.505</text>
  <rect x="242.0" y="114.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="264.0" y="125.0">0.495</text>
  </g>
  <text class="mid small mute" x="241" y="156">σ = (1.00, 0.01)</text>
  <text class="mid small mute" x="241" y="175">仍保持 100:1 严重偏斜</text>

  <rect x="336" y="58" width="166" height="132" rx="8" fill="var(--card)" stroke="var(--clay)"/>
  <text class="mid small b" x="419" y="76" fill="var(--clay-ink)">逐格符号 / 无记忆 Adam</text>
  <g>
  <path d="M378.5 88.0 H374.0 V138.0 H378.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M459.5 88.0 H464.0 V138.0 H459.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="378.0" y="90.0" width="40.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="398.0" y="101.0">1.00</text>
  <rect x="420.0" y="90.0" width="40.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="440.0" y="101.0">1.00</text>
  <rect x="378.0" y="114.0" width="40.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="398.0" y="125.0">1.00</text>
  <rect x="420.0" y="114.0" width="40.0" height="22.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="440.0" y="125.0">1.00</text>
  </g>
  <text class="mid small accent" x="419" y="156">σ = (2.00, 0.00)</text>
  <text class="mid small accent" x="419" y="175">四格皆正，抹平第 2 子空间</text>

  <rect x="514" y="58" width="172" height="132" rx="8" fill="var(--card)" stroke="var(--teal)"/>
  <text class="mid small b" x="600" y="76" fill="var(--teal-ink)">Muon 目标极分解 UVᵀ</text>
  <g>
  <path d="M559.5 88.0 H555.0 V138.0 H559.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M640.5 88.0 H645.0 V138.0 H640.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="559.0" y="90.0" width="40.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15"/>
  <text class="mid small" x="579.0" y="101.0">0.00</text>
  <rect x="601.0" y="90.0" width="40.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="621.0" y="101.0">1.00</text>
  <rect x="559.0" y="114.0" width="40.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="579.0" y="125.0">1.00</text>
  <rect x="601.0" y="114.0" width="40.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15"/>
  <text class="mid small" x="621.0" y="125.0">0.00</text>
  </g>
  <text class="mid small b" x="600" y="156" fill="var(--teal-ink)">σ = (1.00, 1.00)</text>
  <text class="mid small" x="600" y="175">两正交方向等步幅推进</text>

  <rect class="panel" x="0" y="222" width="704" height="224" rx="12"/>
  <text class="caps" x="18" y="244">2 · 牛顿-舒尔茨 5 步纯矩阵乘展开（无需 SVD 分解）</text>
  <text class="small b" x="18" y="266">观察主对角共模项如何逐轮消退、反对角差模项如何放大 484 倍并在第 5 步还原正交置换结构</text>

  <g>
  <path d="M24.5 304.0 H20.0 V354.0 H24.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M113.5 304.0 H118.0 V354.0 H113.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="24.0" y="306.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="46.0" y="317.0">0.495</text>
  <rect x="70.0" y="306.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="92.0" y="317.0">0.505</text>
  <rect x="24.0" y="330.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="46.0" y="341.0">0.505</text>
  <rect x="70.0" y="330.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="92.0" y="341.0">0.495</text>
  <text class="mid small mute" x="69.0" y="295.0">σ:(1.00, 0.01)</text>
  <tex class="mid small" x="69.0" y="369.0">X_0 = \tilde{{M}}/\|\tilde{{M}}\|_F</tex>
  </g>
  <path class="edge" d="M122 329 H148" marker-end="url(#arrow)"/>

  <g>
  <path d="M158.5 304.0 H154.0 V354.0 H158.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M247.5 304.0 H252.0 V354.0 H247.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="158.0" y="306.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="180.0" y="317.0">0.333</text>
  <rect x="204.0" y="306.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="226.0" y="317.0">0.368</text>
  <rect x="158.0" y="330.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="180.0" y="341.0">0.368</text>
  <rect x="204.0" y="330.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="226.0" y="341.0">0.333</text>
  <text class="mid small mute" x="203.0" y="295.0">σ:(0.70, 0.03)</text>
  <tex class="mid small" x="203.0" y="369.0">X_1\;(k=1)</tex>
  </g>
  <path class="edge" d="M256 329 H282" marker-end="url(#arrow)"/>

  <g>
  <path d="M292.5 304.0 H288.0 V354.0 H292.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M381.5 304.0 H386.0 V354.0 H381.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="292.0" y="306.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="314.0" y="317.0">0.498</text>
  <rect x="338.0" y="306.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="360.0" y="317.0">0.616</text>
  <rect x="292.0" y="330.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="314.0" y="341.0">0.616</text>
  <rect x="338.0" y="330.0" width="44.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="360.0" y="341.0">0.498</text>
  <text class="mid small mute" x="337.0" y="295.0">σ:(1.11, 0.12)</text>
  <tex class="mid small" x="337.0" y="369.0">X_2\;(k=2)</tex>
  </g>
  <path class="edge" d="M390 329 H416" marker-end="url(#arrow)"/>

  <g>
  <path d="M426.5 304.0 H422.0 V354.0 H426.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M515.5 304.0 H520.0 V354.0 H515.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="426.0" y="306.0" width="44.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="448.0" y="317.0">0.160</text>
  <rect x="472.0" y="306.0" width="44.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="494.0" y="317.0">0.560</text>
  <rect x="426.0" y="330.0" width="44.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="448.0" y="341.0">0.560</text>
  <rect x="472.0" y="330.0" width="44.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="494.0" y="341.0">0.160</text>
  <text class="mid small mute" x="471.0" y="295.0">σ:(0.72, 0.40)</text>
  <tex class="mid small" x="471.0" y="369.0">X_3\;(k=3)</tex>
  </g>
  <path class="edge hot" d="M524 329 H562" marker-end="url(#arrow)"/>
  <text class="mid small mute" x="543" y="316">k=4..5</text>

  <g>
  <path d="M572.5 304.0 H568.0 V354.0 H572.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M669.5 304.0 H674.0 V354.0 H669.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="572.0" y="306.0" width="48.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15"/>
  <text class="mid small" x="596.0" y="317.0">-0.001</text>
  <rect x="622.0" y="306.0" width="48.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="646.0" y="317.0">0.698</text>
  <rect x="572.0" y="330.0" width="48.0" height="22.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="596.0" y="341.0">0.698</text>
  <rect x="622.0" y="330.0" width="48.0" height="22.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15"/>
  <text class="mid small" x="646.0" y="341.0">-0.001</text>
  <text class="mid small mute" x="621.0" y="295.0">σ:(0.70, 0.70)</text>
  <tex class="mid small" x="621.0" y="369.0">X_5 \approx 0.70\,U V^\top</tex>
  </g>

  <text class="small" x="18" y="424">第 5 步对角元退至 -0.001，反对角升至 0.698，两个奇异值之比从 100:1 拉平至 1.003:1</text>
</svg>
<svg viewBox="0 0 340 604">
  <rect class="panel" x="0" y="0" width="340" height="278" rx="12"/>
  <text class="caps" x="14" y="22">1 · 三种更新规则展开对比</text>
  <g>
  <path d="M20.5 46.0 H16.0 V92.0 H20.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M97.5 46.0 H102.0 V92.0 H97.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="20.0" y="48.0" width="38.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="39.0" y="58.0">9.9</text>
  <rect x="60.0" y="48.0" width="38.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="79.0" y="58.0">10.1</text>
  <rect x="20.0" y="70.0" width="38.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="39.0" y="80.0">10.1</text>
  <rect x="60.0" y="70.0" width="38.0" height="20.0" rx="3" fill="var(--violet-wash)" stroke="var(--violet)" stroke-width="1.15"/>
  <text class="mid small" x="79.0" y="80.0">9.9</text>
  <tex class="mid small" x="59.0" y="107.0">\tilde{{M}}\;(\sigma=20, 0.2)</tex>
  </g>
  <text class="small" x="116" y="60">= 10×全1阵 (主方向)</text>
  <text class="small accent" x="116" y="80">+ 0.1×反对角阵 (微弱信号)</text>

  <text class="small b" x="20" y="136" fill="var(--clay-ink)">逐格 Sign / Adam</text>
  <g>
  <path d="M20.5 146.0 H16.0 V192.0 H20.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M105.5 146.0 H110.0 V192.0 H105.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="20.0" y="148.0" width="42.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="41.0" y="158.0">1.00</text>
  <rect x="64.0" y="148.0" width="42.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="85.0" y="158.0">1.00</text>
  <rect x="20.0" y="170.0" width="42.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="41.0" y="180.0">1.00</text>
  <rect x="64.0" y="170.0" width="42.0" height="20.0" rx="3" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  <text class="mid small" x="85.0" y="180.0">1.00</text>
  </g>
  <text class="small accent" x="20" y="212">σ = (2.00, 0.00)</text>
  <text class="small mute" x="20" y="232">抹平 ±0.1 差模信号</text>

  <text class="small b" x="182" y="136" fill="var(--teal-ink)">Muon 极分解 UVᵀ</text>
  <g>
  <path d="M182.5 146.0 H178.0 V192.0 H182.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M267.5 146.0 H272.0 V192.0 H267.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="182.0" y="148.0" width="42.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15"/>
  <text class="mid small" x="203.0" y="158.0">0.00</text>
  <rect x="226.0" y="148.0" width="42.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="247.0" y="158.0">1.00</text>
  <rect x="182.0" y="170.0" width="42.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="203.0" y="180.0">1.00</text>
  <rect x="226.0" y="170.0" width="42.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15"/>
  <text class="mid small" x="247.0" y="180.0">0.00</text>
  </g>
  <text class="small b" x="182" y="212" fill="var(--teal-ink)">σ = (1.00, 1.00)</text>
  <text class="small mute" x="182" y="232">完美还原置换正交阵</text>

  <rect class="panel" x="0" y="294" width="340" height="310" rx="12"/>
  <text class="caps" x="14" y="316">2 · 牛顿-舒尔茨 5 步矩阵乘追踪</text>

  <g>
  <path d="M20.5 348.0 H16.0 V394.0 H20.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M109.5 348.0 H114.0 V394.0 H109.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="20.0" y="350.0" width="44.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="42.0" y="360.0">0.495</text>
  <rect x="66.0" y="350.0" width="44.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="88.0" y="360.0">0.505</text>
  <rect x="20.0" y="372.0" width="44.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="42.0" y="382.0">0.505</text>
  <rect x="66.0" y="372.0" width="44.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="88.0" y="382.0">0.495</text>
  <text class="mid small mute" x="65.0" y="339.0">σ:(1.00, 0.01)</text>
  <tex class="mid small" x="65.0" y="409.0">X_0</tex>
  </g>
  <path class="edge" d="M122 371 H158" marker-end="url(#arrow)"/>
  <g>
  <path d="M168.5 348.0 H164.0 V394.0 H168.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M257.5 348.0 H262.0 V394.0 H257.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="168.0" y="350.0" width="44.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="190.0" y="360.0">0.333</text>
  <rect x="214.0" y="350.0" width="44.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="236.0" y="360.0">0.368</text>
  <rect x="168.0" y="372.0" width="44.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="190.0" y="382.0">0.368</text>
  <rect x="214.0" y="372.0" width="44.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.15"/>
  <text class="mid small" x="236.0" y="382.0">0.333</text>
  <text class="mid small mute" x="213.0" y="339.0">σ:(0.70, 0.03)</text>
  <tex class="mid small" x="213.0" y="409.0">X_1</tex>
  </g>

  <g>
  <path d="M20.5 460.0 H16.0 V506.0 H20.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M109.5 460.0 H114.0 V506.0 H109.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="20.0" y="462.0" width="44.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="42.0" y="472.0">0.160</text>
  <rect x="66.0" y="462.0" width="44.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="88.0" y="472.0">0.560</text>
  <rect x="20.0" y="484.0" width="44.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="42.0" y="494.0">0.560</text>
  <rect x="66.0" y="484.0" width="44.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small" x="88.0" y="494.0">0.160</text>
  <text class="mid small mute" x="65.0" y="451.0">σ:(0.72, 0.40)</text>
  <tex class="mid small" x="65.0" y="521.0">X_3</tex>
  </g>
  <path class="edge hot" d="M122 483 H158" marker-end="url(#arrow)"/>
  <g>
  <path d="M168.5 460.0 H164.0 V506.0 H168.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <path d="M265.5 460.0 H270.0 V506.0 H265.5" fill="none" stroke="var(--ink)" stroke-width="1.35"/>
  <rect x="168.0" y="462.0" width="48.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15"/>
  <text class="mid small" x="192.0" y="472.0">-0.001</text>
  <rect x="218.0" y="462.0" width="48.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="242.0" y="472.0">0.698</text>
  <rect x="168.0" y="484.0" width="48.0" height="20.0" rx="3" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
  <text class="mid small b" x="192.0" y="494.0">0.698</text>
  <rect x="218.0" y="484.0" width="48.0" height="20.0" rx="3" fill="var(--card)" stroke="var(--line)" stroke-width="1.15"/>
  <text class="mid small" x="242.0" y="494.0">-0.001</text>
  <text class="mid small mute" x="217.0" y="451.0">σ:(0.70, 0.70)</text>
  <tex class="mid small" x="217.0" y="521.0">X_5 \approx 0.70\,U V^\top</tex>
  </g>

  <text class="small" x="14" y="560">仅靠 5 轮矩阵自乘，无需调用 SVD 分解</text>
  <text class="small b" x="14" y="582" fill="var(--teal-ink)">奇异值比从 100:1 拉平为 0.699 : 0.697</text>
</svg>
```

下图左面板画出了 $\varphi(\sigma)$ 复合 1、3、5 次后的真实函数曲线；右面板则实测了双层迷你 Transformer 训练到第 25 步时，第 1 层 `W_q` 动量矩阵全部 64 个奇异值在更新前后的分布。

对比非常鲜明：原始动量首尾奇异值差了 $13,669$ 倍；哪怕经过 `AdamW` 逐格除以 $\sqrt{\hat{v}_t}$，更新矩阵的奇异值谱依然滑落了逾两千倍；唯独跑完 5 步牛顿-舒尔茨迭代后，前 53 个奇异值齐刷刷挺进了 $[0.68, 1.20]$ 的平坦窄带。

```plot title="牛顿-舒尔茨五次多项式复合映射曲线与真实 Transformer $W_q$ 奇异值谱对比" note="左面板：$\varphi(\sigma) = 3.4445\sigma - 4.7750\sigma^3 + 2.0315\sigma^5$ 迭代 1、3、5 次后的映射曲线；右面板：双层 Mini-Transformer（$D=64$）第 25 步第 1 层 $W_q$ 动量矩阵的 64 个奇异值实测（原始动量与 AdamW 更新按各自最大奇异值归一化以对比谱形状）。"
{"cols":2,"narrowCols":1,"legend":[{"label":"Muon 5 步迭代 $\\varphi^{(5)}(\\sigma)$ / $O_t$ 谱","color":"var(--teal)","shape":"line"},{"label":"1 步映射 / AdamW 更新谱","color":"var(--orange)","shape":"dash"},{"label":"原始动量 $\\tilde{M}_t$ 谱（首尾比 13,669×）","color":"var(--clay)","shape":"line"},{"label":"$[0.01, 1]$ 收敛带 $[0.68, 1.13]$","color":"var(--teal)","shape":"band"}],"data":{"ns":[{"s0":0.0,"id":0.0,"k1":0.0,"k3":0.0,"k5":0.0},{"s0":0.01,"id":0.01,"k1":0.0344,"k3":0.4001,"k5":0.6989},{"s0":0.02,"id":0.02,"k1":0.0689,"k3":0.7506,"k5":0.6818},{"s0":0.03,"id":0.03,"k1":0.1032,"k3":1.012,"k5":1.1223},{"s0":0.04,"id":0.04,"k1":0.1375,"k3":1.1626,"k5":0.9514},{"s0":0.05,"id":0.05,"k1":0.1716,"k3":1.2016,"k5":0.7581},{"s0":0.06,"id":0.06,"k1":0.2056,"k3":1.1482,"k5":1.0056},{"s0":0.07,"id":0.07,"k1":0.2395,"k3":1.0355,"k5":1.1325},{"s0":0.08,"id":0.08,"k1":0.2731,"k3":0.9023,"k5":0.9524},{"s0":0.09,"id":0.09,"k1":0.3065,"k3":0.7843,"k5":0.7005},{"s0":0.1,"id":0.1,"k1":0.3397,"k3":0.7071,"k5":0.7121},{"s0":0.11,"id":0.11,"k1":0.3726,"k3":0.6818,"k5":0.7531},{"s0":0.12,"id":0.12,"k1":0.4051,"k3":0.7053,"k5":0.7145},{"s0":0.13,"id":0.13,"k1":0.4374,"k3":0.7629,"k5":0.6843},{"s0":0.14,"id":0.14,"k1":0.4692,"k3":0.8339,"k5":0.786},{"s0":0.15,"id":0.15,"k1":0.5007,"k3":0.8974,"k5":0.9409},{"s0":0.16,"id":0.16,"k1":0.5318,"k3":0.9374,"k5":1.0279},{"s0":0.17,"id":0.17,"k1":0.5624,"k3":0.9454,"k5":1.0427},{"s0":0.18,"id":0.18,"k1":0.5925,"k3":0.9219,"k5":0.9967},{"s0":0.19,"id":0.19,"k1":0.6222,"k3":0.8745,"k5":0.8842},{"s0":0.2,"id":0.2,"k1":0.6514,"k3":0.815,"k5":0.7468},{"s0":0.21,"id":0.21,"k1":0.68,"k3":0.7566,"k5":0.6824},{"s0":0.22,"id":0.22,"k1":0.708,"k3":0.7109,"k5":0.7072},{"s0":0.23,"id":0.23,"k1":0.7354,"k3":0.6856,"k5":0.7461},{"s0":0.24,"id":0.24,"k1":0.7623,"k3":0.6841,"k5":0.7489},{"s0":0.25,"id":0.25,"k1":0.7885,"k3":0.7053,"k5":0.7145},{"s0":0.26,"id":0.26,"k1":0.8141,"k3":0.7451,"k5":0.6823},{"s0":0.27,"id":0.27,"k1":0.8389,"k3":0.7974,"k5":0.7172},{"s0":0.28,"id":0.28,"k1":0.8631,"k3":0.8558,"k5":0.8377},{"s0":0.29,"id":0.29,"k1":0.8866,"k3":0.9145,"k5":0.9804},{"s0":0.3,"id":0.3,"k1":0.9094,"k3":0.9689,"k5":1.0796},{"s0":0.31,"id":0.31,"k1":0.9314,"k3":1.0162,"k5":1.1248},{"s0":0.32,"id":0.32,"k1":0.9526,"k3":1.055,"k5":1.1342},{"s0":0.33,"id":0.33,"k1":0.973,"k3":1.0851,"k5":1.1226},{"s0":0.34,"id":0.34,"k1":0.9927,"k3":1.1071,"k5":1.0998},{"s0":0.35,"id":0.35,"k1":1.0115,"k3":1.122,"k5":1.0748},{"s0":0.36,"id":0.36,"k1":1.0295,"k3":1.1308,"k5":1.0556},{"s0":0.37,"id":0.37,"k1":1.0467,"k3":1.1343,"k5":1.0469},{"s0":0.38,"id":0.38,"k1":1.063,"k3":1.1329,"k5":1.0504},{"s0":0.39,"id":0.39,"k1":1.0784,"k3":1.1268,"k5":1.0647},{"s0":0.4,"id":0.4,"k1":1.093,"k3":1.1161,"k5":1.0859},{"s0":0.41,"id":0.41,"k1":1.1067,"k3":1.1004,"k5":1.1083},{"s0":0.42,"id":0.42,"k1":1.1195,"k3":1.0797,"k5":1.1261},{"s0":0.43,"id":0.43,"k1":1.1314,"k3":1.0542,"k5":1.1342},{"s0":0.44,"id":0.44,"k1":1.1423,"k3":1.0244,"k5":1.1288},{"s0":0.45,"id":0.45,"k1":1.1524,"k3":0.9911,"k5":1.1056},{"s0":0.46,"id":0.46,"k1":1.1615,"k3":0.9558,"k5":1.0602},{"s0":0.47,"id":0.47,"k1":1.1698,"k3":0.9199,"k5":0.9923},{"s0":0.48,"id":0.48,"k1":1.177,"k3":0.885,"k5":0.9106},{"s0":0.49,"id":0.49,"k1":1.1834,"k3":0.8528,"k5":0.8303},{"s0":0.5,"id":0.5,"k1":1.1889,"k3":0.8244,"k5":0.7654},{"s0":0.51,"id":0.51,"k1":1.1934,"k3":0.8006,"k5":0.722},{"s0":0.52,"id":0.52,"k1":1.197,"k3":0.7818,"k5":0.6978},{"s0":0.53,"id":0.53,"k1":1.1997,"k3":0.7681,"k5":0.6869},{"s0":0.54,"id":0.54,"k1":1.2014,"k3":0.7592,"k5":0.6831},{"s0":0.55,"id":0.55,"k1":1.2023,"k3":0.755,"k5":0.6821},{"s0":0.56,"id":0.56,"k1":1.2022,"k3":0.7552,"k5":0.6822},{"s0":0.57,"id":0.57,"k1":1.2013,"k3":0.7598,"k5":0.6832},{"s0":0.58,"id":0.58,"k1":1.1995,"k3":0.7689,"k5":0.6874},{"s0":0.59,"id":0.59,"k1":1.1968,"k3":0.7827,"k5":0.6987},{"s0":0.6,"id":0.6,"k1":1.1933,"k3":0.8011,"k5":0.7229},{"s0":0.61,"id":0.61,"k1":1.1889,"k3":0.8242,"k5":0.7651},{"s0":0.62,"id":0.62,"k1":1.1837,"k3":0.8514,"k5":0.8269},{"s0":0.63,"id":0.63,"k1":1.1777,"k3":0.8819,"k5":0.9028},{"s0":0.64,"id":0.64,"k1":1.1709,"k3":0.9147,"k5":0.9809},{"s0":0.65,"id":0.65,"k1":1.1633,"k3":0.9484,"k5":1.0479},{"s0":0.66,"id":0.66,"k1":1.155,"k3":0.9816,"k5":1.0955},{"s0":0.67,"id":0.67,"k1":1.1459,"k3":1.0131,"k5":1.123},{"s0":0.68,"id":0.68,"k1":1.1362,"k3":1.0418,"k5":1.1338},{"s0":0.69,"id":0.69,"k1":1.1258,"k3":1.0669,"k5":1.1318},{"s0":0.7,"id":0.7,"k1":1.1148,"k3":1.0881,"k5":1.1203},{"s0":0.71,"id":0.71,"k1":1.1031,"k3":1.1051,"k5":1.1025},{"s0":0.72,"id":0.72,"k1":1.0909,"k3":1.118,"k5":1.0824},{"s0":0.73,"id":0.73,"k1":1.0781,"k3":1.127,"k5":1.0642},{"s0":0.74,"id":0.74,"k1":1.0648,"k3":1.1324,"k5":1.0516},{"s0":0.75,"id":0.75,"k1":1.051,"k3":1.1344,"k5":1.0467},{"s0":0.76,"id":0.76,"k1":1.0368,"k3":1.1329,"k5":1.0505},{"s0":0.77,"id":0.77,"k1":1.0222,"k3":1.1279,"k5":1.0624},{"s0":0.78,"id":0.78,"k1":1.0073,"k3":1.1192,"k5":1.0803},{"s0":0.79,"id":0.79,"k1":0.992,"k3":1.1065,"k5":1.1007},{"s0":0.8,"id":0.8,"k1":0.9765,"k3":1.0895,"k5":1.1192},{"s0":0.81,"id":0.81,"k1":0.9608,"k3":1.0679,"k5":1.1315},{"s0":0.82,"id":0.82,"k1":0.9449,"k3":1.0417,"k5":1.1338},{"s0":0.83,"id":0.83,"k1":0.9289,"k3":1.0112,"k5":1.1218},{"s0":0.84,"id":0.84,"k1":0.9128,"k3":0.9767,"k5":1.0898},{"s0":0.85,"id":0.85,"k1":0.8968,"k3":0.9393,"k5":1.0315},{"s0":0.86,"id":0.86,"k1":0.8808,"k3":0.9,"k5":0.9469},{"s0":0.87,"id":0.87,"k1":0.8649,"k3":0.8602,"k5":0.8486},{"s0":0.88,"id":0.88,"k1":0.8492,"k3":0.8216,"k5":0.7598},{"s0":0.89,"id":0.89,"k1":0.8338,"k3":0.7857,"k5":0.702},{"s0":0.9,"id":0.9,"k1":0.8187,"k3":0.7539,"k5":0.682},{"s0":0.91,"id":0.91,"k1":0.8039,"k3":0.7273,"k5":0.6908},{"s0":0.92,"id":0.92,"k1":0.7896,"k3":0.7067,"k5":0.7126},{"s0":0.93,"id":0.93,"k1":0.7759,"k3":0.6924,"k5":0.7343},{"s0":0.94,"id":0.94,"k1":0.7627,"k3":0.6843,"k5":0.7486},{"s0":0.95,"id":0.95,"k1":0.7502,"k3":0.6818,"k5":0.7531},{"s0":0.96,"id":0.96,"k1":0.7385,"k3":0.6843,"k5":0.7486},{"s0":0.97,"id":0.97,"k1":0.7277,"k3":0.6905,"k5":0.7375},{"s0":0.98,"id":0.98,"k1":0.7177,"k3":0.6994,"k5":0.7231},{"s0":0.99,"id":0.99,"k1":0.7088,"k3":0.7098,"k5":0.7085},{"s0":1.0,"id":1.0,"k1":0.701,"k3":0.7207,"k5":0.6964}],"band1":[{"x":0.0,"lo":0.6818,"hi":1.1344},{"x":1.0,"lo":0.6818,"hi":1.1344}],"band2":[{"x":1,"lo":0.6818,"hi":1.1344},{"x":64,"lo":0.6818,"hi":1.1344}],"svd":[{"idx":1,"raw":1.0,"adamw":1.0,"muon":1.2007},{"idx":2,"raw":0.5543,"adamw":0.8475,"muon":1.1964},{"idx":3,"raw":0.3382,"adamw":0.5205,"muon":1.1935},{"idx":4,"raw":0.2587,"adamw":0.3883,"muon":1.1749},{"idx":5,"raw":0.1777,"adamw":0.3127,"muon":1.1506},{"idx":6,"raw":0.139,"adamw":0.2501,"muon":1.1341},{"idx":7,"raw":0.1122,"adamw":0.2177,"muon":1.1304},{"idx":8,"raw":0.1051,"adamw":0.1945,"muon":1.1269},{"idx":9,"raw":0.0732,"adamw":0.1593,"muon":1.1122},{"idx":10,"raw":0.0689,"adamw":0.1533,"muon":1.1037},{"idx":11,"raw":0.057,"adamw":0.1373,"muon":1.096},{"idx":12,"raw":0.0561,"adamw":0.1255,"muon":1.0942},{"idx":13,"raw":0.0495,"adamw":0.124,"muon":1.0746},{"idx":14,"raw":0.0449,"adamw":0.1107,"muon":1.0629},{"idx":15,"raw":0.0407,"adamw":0.105,"muon":1.0549},{"idx":16,"raw":0.0371,"adamw":0.0984,"muon":1.0364},{"idx":17,"raw":0.0352,"adamw":0.0934,"muon":1.0221},{"idx":18,"raw":0.0308,"adamw":0.0877,"muon":0.9834},{"idx":19,"raw":0.029,"adamw":0.0847,"muon":0.9444},{"idx":20,"raw":0.0278,"adamw":0.078,"muon":0.9384},{"idx":21,"raw":0.0261,"adamw":0.0754,"muon":0.9342},{"idx":22,"raw":0.0251,"adamw":0.0723,"muon":0.9319},{"idx":23,"raw":0.0231,"adamw":0.0705,"muon":0.9309},{"idx":24,"raw":0.0221,"adamw":0.063,"muon":0.9208},{"idx":25,"raw":0.0202,"adamw":0.0604,"muon":0.9076},{"idx":26,"raw":0.019,"adamw":0.0586,"muon":0.8924},{"idx":27,"raw":0.0175,"adamw":0.0544,"muon":0.8863},{"idx":28,"raw":0.0158,"adamw":0.0512,"muon":0.88},{"idx":29,"raw":0.0153,"adamw":0.0492,"muon":0.8593},{"idx":30,"raw":0.0138,"adamw":0.0473,"muon":0.8521},{"idx":31,"raw":0.0132,"adamw":0.0457,"muon":0.8331},{"idx":32,"raw":0.0125,"adamw":0.0428,"muon":0.8155},{"idx":33,"raw":0.0117,"adamw":0.0423,"muon":0.8028},{"idx":34,"raw":0.0103,"adamw":0.0394,"muon":0.7985},{"idx":35,"raw":0.0098,"adamw":0.0381,"muon":0.7961},{"idx":36,"raw":0.0085,"adamw":0.037,"muon":0.7891},{"idx":37,"raw":0.0083,"adamw":0.0349,"muon":0.7767},{"idx":38,"raw":0.0076,"adamw":0.0323,"muon":0.7655},{"idx":39,"raw":0.0072,"adamw":0.0292,"muon":0.7579},{"idx":40,"raw":0.0069,"adamw":0.0282,"muon":0.7531},{"idx":41,"raw":0.0066,"adamw":0.0275,"muon":0.7411},{"idx":42,"raw":0.006,"adamw":0.0241,"muon":0.7389},{"idx":43,"raw":0.0057,"adamw":0.0227,"muon":0.7304},{"idx":44,"raw":0.005,"adamw":0.0216,"muon":0.7276},{"idx":45,"raw":0.0048,"adamw":0.0213,"muon":0.7217},{"idx":46,"raw":0.0041,"adamw":0.0195,"muon":0.7155},{"idx":47,"raw":0.0034,"adamw":0.0188,"muon":0.7029},{"idx":48,"raw":0.0033,"adamw":0.0171,"muon":0.7007},{"idx":49,"raw":0.0028,"adamw":0.0157,"muon":0.6977},{"idx":50,"raw":0.0028,"adamw":0.0154,"muon":0.6957},{"idx":51,"raw":0.0024,"adamw":0.0138,"muon":0.6882},{"idx":52,"raw":0.0021,"adamw":0.013,"muon":0.6822},{"idx":53,"raw":0.002,"adamw":0.0113,"muon":0.6819},{"idx":54,"raw":0.0016,"adamw":0.0109,"muon":0.5902},{"idx":55,"raw":0.0015,"adamw":0.0087,"muon":0.5366},{"idx":56,"raw":0.0012,"adamw":0.0077,"muon":0.4558},{"idx":57,"raw":0.0012,"adamw":0.0064,"muon":0.4354},{"idx":58,"raw":0.0011,"adamw":0.0053,"muon":0.4271},{"idx":59,"raw":0.0009,"adamw":0.0048,"muon":0.3298},{"idx":60,"raw":0.0006,"adamw":0.0039,"muon":0.2364},{"idx":61,"raw":0.0005,"adamw":0.0033,"muon":0.1728},{"idx":62,"raw":0.0003,"adamw":0.0026,"muon":0.1185},{"idx":63,"raw":0.0002,"adamw":0.0015,"muon":0.0697},{"idx":64,"raw":0.0001,"adamw":0.0004,"muon":0.0281}]},"panels":[{"title":"五次多项式迭代 · $\\varphi(\\sigma) = 3.4445\\sigma - 4.7750\\sigma^3 + 2.0315\\sigma^5$","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"初始归一化奇异值 (0 至 1)","domain":[0,1.02]},"y":{"label":"映射后奇异值","domain":[0,1.28]},"grid":true,"marks":[{"mark":"areaY","data":"band1","x":"x","y1":"lo","y2":"hi","fill":"var(--teal)","fillOpacity":0.13},{"mark":"ruleY","data":[1.0],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"line","data":"ns","x":"s0","y":"id","stroke":"var(--stone)","strokeDasharray":"4 4"},{"mark":"line","data":"ns","x":"s0","y":"k1","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"ns","x":"s0","y":"k3","stroke":"var(--blue)","strokeWidth":1.6},{"mark":"line","data":"ns","x":"s0","y":"k5","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":[{"s0":1.0,"k1":0.701}],"x":"s0","y":"k1","fill":"var(--clay)","r":4.2,"tip":["s0","k1"]},{"mark":"text","data":[{"x":0.99,"y":0.56,"t":"右端红点: 0.701"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"}]},{"title":"第 1 层 $W_q$ ($64\\times 64$) 第 25 步奇异值谱实测","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"奇异值序号（第 1 至第 64，从大到小）","domain":[1,64]},"y":{"label":"奇异值大小","domain":[0,1.28]},"grid":true,"marks":[{"mark":"areaY","data":"band2","x":"x","y1":"lo","y2":"hi","fill":"var(--teal)","fillOpacity":0.13},{"mark":"ruleY","data":[1.0],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"line","data":"svd","x":"idx","y":"raw","stroke":"var(--clay)","strokeWidth":2.1},{"mark":"line","data":"svd","x":"idx","y":"adamw","stroke":"var(--orange)","strokeWidth":1.9,"strokeDasharray":"5 3"},{"mark":"line","data":"svd","x":"idx","y":"muon","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":"svd","x":"idx","y":"muon","fill":"var(--teal)","r":2.0,"tip":["idx","muon","adamw","raw"]},{"mark":"text","data":[{"x":63,"y":1.19,"t":"Muon：前 53 个方向落在 [0.68, 1.20]"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"},{"mark":"text","data":[{"x":14,"y":0.15,"t":"原始动量谱：尾部衰减 13,669 倍"}],"x":"x","y":"y","text":"t","textAnchor":"start","fill":"var(--clay)"}]}]}
```

### 5.3 月之暗面的规模化改进：单元素更新 RMS 对齐与权重衰减推导

把原版 `Muon` 从实验室小模型直接推上百亿参数预训练时，还会撞上两道工程门槛：怎么直接复用 `AdamW` 积攒多年的学习率调度表？长周期训练怎么防权重膨胀？

2025 年初，月之暗面（Moonshot AI，Liu, Su et al.）在 *Muon is Scalable for LLM Training*[@liu2025] 中给出了干净利落的解答。

**第一关：把不同尺寸矩阵的更新幅度与 `AdamW` 对齐。**

设近似半正交矩阵 $O_t \in \mathbb{R}^{A \times B}$ 满秩（$r = \min(A, B)$），非零奇异值都在 $1$ 附近。它的全部元素平方和等于奇异值平方和：

$$
\|O_t\|_F^2 = \sum_{i=1}^{A} \sum_{j=1}^{B} O_{t, ij}^2 = \sum_{k=1}^{\min(A, B)} \sigma_k^2 \approx \min(A, B)
$$

把这份总能量平摊到 $A \cdot B$ 个参数格子上，每个格子的更新均方根幅度（Update RMS）就是：

$$
\mathrm{RMS}(O_t) \triangleq \sqrt{\frac{1}{A B} \|O_t\|_F^2} \approx \sqrt{\frac{\min(A, B)}{A B}} = \frac{1}{\sqrt{\max(A, B)}}
$$

问题暴露出来了。不管是第 4.3 节理论导出的 $\sqrt{A / B}$ 因子，还是 Keller Jordan 开源代码里防降维缩步的截断因子 $\sqrt{\max(1, A/B)}$，算出来的单元素更新幅度都会跟着模型宽度 $B = d_{\mathrm{in}}$ 按 $1/\sqrt{d_{\mathrm{in}}}$ 一路缩水！

这意味着每次把模型加宽，或者在同一座网络里同时面对不同宽度的注意力头、MLP 与 MoE 专家层时，各层步幅都不一致，还得专门给 `Muon` 重新搜一套比 `AdamW` 大十倍的独立学习率（比如 `lr = 0.02`）。

那不如反过来问一句：**成熟的 `AdamW` 在训练稳态下，每个格子的更新 RMS 到底是多少？**

我们用随机过程两行就能估出来。设训练中后期某坐标的梯度序列 $\{g_t\}$ 近似是零均值、方差为 $\sigma^2$ 的独立同分布随机变量。当步数 $t$ 足够大时：

- 二阶矩期望等于方差：$\mathbb{E}[v_t] = (1 - \beta_2)\sum_{k=0}^\infty \beta_2^k \mathbb{E}[g_{t-k}^2] = \sigma^2$；
- 一阶矩平方期望（跨步独立交叉项为零）等于：

$$
\mathbb{E}[m_t^2] = (1 - \beta_1)^2 \sum_{k=0}^{\infty} \beta_1^{2k} \mathbb{E}[g_{t-k}^2] = \frac{(1 - \beta_1)^2}{1 - \beta_1^2} \sigma^2 = \frac{1 - \beta_1}{1 + \beta_1} \sigma^2
$$

当 $\beta_2$ 贴近 $1$ 时，$v_t$ 紧紧聚拢在 $\sigma^2$ 周围。取一阶近似 $\mathbb{E}[m_t^2 / v_t] \approx \mathbb{E}[m_t^2] / \mathbb{E}[v_t]$，`AdamW` 无量纲更新量 $u_t = m_t / \sqrt{v_t}$ 的均方根幅度立即化简为：

$$
\mathrm{RMS}(u_t^{\mathrm{AdamW}}) \approx \sqrt{\frac{\mathbb{E}[m_t^2]}{\mathbb{E}[v_t]}} = \sqrt{\frac{1 - \beta_1}{1 + \beta_1}}
$$

代入标准超参 $\beta_1 = 0.9$，算出 $\sqrt{0.1 / 1.9} \approx 0.229$（真实训练里带一点局部时间正相关，实测稳稳落在 $0.2 \sim 0.4$ 之间[@liu2025]）。

破局之法呼之欲出：只要给 `Muon` 的正交化输出 $O_t$ 乘上 $0.2\sqrt{\max(A, B)}$，就能分毫不差地消掉分母 $\frac{1}{\sqrt{\max(A, B)}}$，把任意长宽尺寸矩阵的单元素更新 RMS 钉死在 $0.2$ 附近：

$$
W_t = (1 - \eta \lambda) W_{t-1} - \eta \cdot 0.2\sqrt{\max(A, B)} \, O_t
$$

对齐之后，`Muon` 与负责首尾词表的 `AdamW` **可以直接共用同一套学习率调度器 $\eta_t$ 与同一个权重衰减率 $\lambda$**，跨尺寸迁移实现零调参。

**第二关：为什么百亿规模长训非加解耦权重衰减不可？**

看看不加权重衰减（$\lambda = 0$）时，权重 Frobenius 范数平方的单步变化（记 $\Delta_t = \eta \cdot 0.2\sqrt{\max(A,B)}\,O_t$）：

$$
\|W_t\|_F^2 = \|W_{t-1} - \Delta_t\|_F^2 = \|W_{t-1}\|_F^2 - 2\langle W_{t-1}, \Delta_t \rangle_F + \|\Delta_t\|_F^2
$$

到了训练中后期，梯度里夹杂着大量与当前权重近似正交的随机噪声，正二次项 $\|\Delta_t\|_F^2 \approx 0.04 \eta^2 A B$ 每一步都在往里净注水！没有收缩力拉住它，$\|W_t\|_F$ 就会一路单调疯长，直到把注意力打分撑爆溢出。

补上解耦衰减 $(1 - \eta \lambda)W_{t-1}$ 后，每步自带 $-2\eta\lambda\|W_{t-1}\|_F^2$ 的回拉阻尼。一注一抽相互抵消，权重均方根最终稳稳停在有界平衡点 $\mathrm{RMS}(W_{\mathrm{eq}}) \approx \sqrt{0.02 \eta / \lambda}$[@liu2025]。

下面三组受控消融实验逐一印证了这三项结论：把词表强行塞给 `Muon` 会拖慢收敛并在后期反弹；关掉权重衰减会让权重范数一路线性疯长；而乘上 $0.2\sqrt{\max(A, B)}$ 后，从 $64 \times 64$ 到 $2048 \times 512$ 的单元素更新 RMS 全程稳在 $0.17 \sim 0.19$。

```plot title="参数分流、解耦权重衰减与跨尺寸 RMS 对齐三组受控消融实验" note="前两面板测于双层 Mini-Transformer 360 步训练；右面板实测高斯随机矩阵经 5 步牛顿-舒尔茨迭代后的单元素均方根（横轴为长边维度 $A=\max(A,B)$：首点为 $64\times 64$ 方阵，其余长宽比固定为 $4:1$，即 $256\times 64$ 至 $2048\times 512$）。"
{"cols":3,"narrowCols":1,"legend":[{"label":"分流混合 / 含衰减 / $0.2\\sqrt{\\max(A,B)}$ 对齐","color":"var(--teal)","shape":"line"},{"label":"消融对照：全量 Muon / 无衰减 $\\lambda=0$ / 未缩放 $O_t$","color":"var(--clay)","shape":"dash"},{"label":"截断长宽比缩放 $\\sqrt{\\max(1, A/B)}$","color":"var(--orange)","shape":"line"}],"data":{"ab":[{"step":1,"loss_hybrid":4.943,"loss_all_muon":5.012,"wnorm_nowd":19.54,"wnorm_wd":19.52},{"step":8,"loss_hybrid":4.329,"loss_all_muon":4.829,"wnorm_nowd":19.65,"wnorm_wd":19.46},{"step":16,"loss_hybrid":3.555,"loss_all_muon":4.589,"wnorm_nowd":19.97,"wnorm_wd":19.58},{"step":24,"loss_hybrid":3.145,"loss_all_muon":4.284,"wnorm_nowd":20.49,"wnorm_wd":19.92},{"step":32,"loss_hybrid":2.921,"loss_all_muon":3.96,"wnorm_nowd":21.0,"wnorm_wd":20.26},{"step":40,"loss_hybrid":2.825,"loss_all_muon":3.703,"wnorm_nowd":21.56,"wnorm_wd":20.65},{"step":48,"loss_hybrid":2.796,"loss_all_muon":3.451,"wnorm_nowd":22.26,"wnorm_wd":21.18},{"step":56,"loss_hybrid":2.773,"loss_all_muon":3.258,"wnorm_nowd":23.01,"wnorm_wd":21.75},{"step":64,"loss_hybrid":2.778,"loss_all_muon":3.123,"wnorm_nowd":23.74,"wnorm_wd":22.31},{"step":72,"loss_hybrid":2.781,"loss_all_muon":3.039,"wnorm_nowd":24.42,"wnorm_wd":22.82},{"step":80,"loss_hybrid":2.775,"loss_all_muon":2.966,"wnorm_nowd":25.06,"wnorm_wd":23.28},{"step":88,"loss_hybrid":2.772,"loss_all_muon":2.906,"wnorm_nowd":25.64,"wnorm_wd":23.67},{"step":96,"loss_hybrid":2.778,"loss_all_muon":2.867,"wnorm_nowd":26.15,"wnorm_wd":23.98},{"step":104,"loss_hybrid":2.771,"loss_all_muon":2.836,"wnorm_nowd":26.58,"wnorm_wd":24.21},{"step":112,"loss_hybrid":2.759,"loss_all_muon":2.811,"wnorm_nowd":26.97,"wnorm_wd":24.4},{"step":120,"loss_hybrid":2.741,"loss_all_muon":2.786,"wnorm_nowd":27.33,"wnorm_wd":24.57},{"step":128,"loss_hybrid":2.732,"loss_all_muon":2.781,"wnorm_nowd":27.68,"wnorm_wd":24.73},{"step":136,"loss_hybrid":2.724,"loss_all_muon":2.769,"wnorm_nowd":28.04,"wnorm_wd":24.88},{"step":144,"loss_hybrid":2.701,"loss_all_muon":2.746,"wnorm_nowd":28.39,"wnorm_wd":25.04},{"step":152,"loss_hybrid":2.683,"loss_all_muon":2.736,"wnorm_nowd":28.75,"wnorm_wd":25.2},{"step":160,"loss_hybrid":2.663,"loss_all_muon":2.725,"wnorm_nowd":29.11,"wnorm_wd":25.37},{"step":168,"loss_hybrid":2.656,"loss_all_muon":2.712,"wnorm_nowd":29.47,"wnorm_wd":25.53},{"step":176,"loss_hybrid":2.65,"loss_all_muon":2.708,"wnorm_nowd":29.85,"wnorm_wd":25.71},{"step":184,"loss_hybrid":2.641,"loss_all_muon":2.704,"wnorm_nowd":30.22,"wnorm_wd":25.87},{"step":192,"loss_hybrid":2.642,"loss_all_muon":2.699,"wnorm_nowd":30.57,"wnorm_wd":26.02},{"step":200,"loss_hybrid":2.636,"loss_all_muon":2.686,"wnorm_nowd":30.91,"wnorm_wd":26.15},{"step":208,"loss_hybrid":2.647,"loss_all_muon":2.701,"wnorm_nowd":31.24,"wnorm_wd":26.27},{"step":216,"loss_hybrid":2.638,"loss_all_muon":2.698,"wnorm_nowd":31.58,"wnorm_wd":26.41},{"step":224,"loss_hybrid":2.656,"loss_all_muon":2.718,"wnorm_nowd":31.95,"wnorm_wd":26.58},{"step":232,"loss_hybrid":2.651,"loss_all_muon":2.72,"wnorm_nowd":32.3,"wnorm_wd":26.72},{"step":240,"loss_hybrid":2.659,"loss_all_muon":2.721,"wnorm_nowd":32.66,"wnorm_wd":26.86},{"step":248,"loss_hybrid":2.662,"loss_all_muon":2.723,"wnorm_nowd":33.01,"wnorm_wd":27.01},{"step":256,"loss_hybrid":2.659,"loss_all_muon":2.729,"wnorm_nowd":33.37,"wnorm_wd":27.17},{"step":264,"loss_hybrid":2.687,"loss_all_muon":2.756,"wnorm_nowd":33.73,"wnorm_wd":27.33},{"step":272,"loss_hybrid":2.679,"loss_all_muon":2.761,"wnorm_nowd":34.07,"wnorm_wd":27.47},{"step":280,"loss_hybrid":2.695,"loss_all_muon":2.777,"wnorm_nowd":34.42,"wnorm_wd":27.61},{"step":288,"loss_hybrid":2.699,"loss_all_muon":2.796,"wnorm_nowd":34.77,"wnorm_wd":27.77},{"step":296,"loss_hybrid":2.689,"loss_all_muon":2.806,"wnorm_nowd":35.1,"wnorm_wd":27.9},{"step":304,"loss_hybrid":2.672,"loss_all_muon":2.814,"wnorm_nowd":35.43,"wnorm_wd":28.0},{"step":312,"loss_hybrid":2.635,"loss_all_muon":2.84,"wnorm_nowd":35.74,"wnorm_wd":28.1},{"step":320,"loss_hybrid":2.619,"loss_all_muon":2.843,"wnorm_nowd":36.06,"wnorm_wd":28.22},{"step":328,"loss_hybrid":2.613,"loss_all_muon":2.864,"wnorm_nowd":36.38,"wnorm_wd":28.33},{"step":336,"loss_hybrid":2.585,"loss_all_muon":2.862,"wnorm_nowd":36.69,"wnorm_wd":28.43},{"step":344,"loss_hybrid":2.594,"loss_all_muon":2.873,"wnorm_nowd":37.02,"wnorm_wd":28.54},{"step":352,"loss_hybrid":2.602,"loss_all_muon":2.895,"wnorm_nowd":37.33,"wnorm_wd":28.65},{"step":360,"loss_hybrid":2.624,"loss_all_muon":2.91,"wnorm_nowd":37.63,"wnorm_wd":28.75}],"rms":[{"order":1,"shape":"64×64","unscaled":0.1088,"keller":0.1088,"moonshot":0.174,"s":"64"},{"order":2,"shape":"256×64","unscaled":0.0539,"keller":0.1079,"moonshot":0.1726,"s":"256"},{"order":3,"shape":"512×128","unscaled":0.0383,"keller":0.0766,"moonshot":0.1733,"s":"512"},{"order":4,"shape":"1024×256","unscaled":0.0298,"keller":0.0596,"moonshot":0.1908,"s":"1k"},{"order":5,"shape":"2048×512","unscaled":0.0211,"keller":0.0422,"moonshot":0.191,"s":"2k"}]},"panels":[{"title":"参数分流消融 · 验证集损失","height":250,"narrowHeight":235,"marginBottom":38,"x":{"label":"步数 Step"},"y":{"label":"Val Loss","domain":[2.32,5.1]},"grid":true,"marks":[{"mark":"line","data":"ab","x":"step","y":"loss_all_muon","stroke":"var(--clay)","strokeWidth":2.0,"strokeDasharray":"5 3"},{"mark":"line","data":"ab","x":"step","y":"loss_hybrid","stroke":"var(--teal)","strokeWidth":2.4},{"mark":"text","data":[{"step":355,"y":3.06,"t":"全量 Muon 升至 2.91"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"step":355,"y":2.42,"t":"分流混合 2.62"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"}]},{"title":"权重衰减对比 · 隐藏层 $\\|W\\|_F$","height":250,"narrowHeight":235,"marginBottom":38,"x":{"label":"步数 Step"},"y":{"label":"Frobenius 范数","domain":[18,40]},"grid":true,"marks":[{"mark":"line","data":"ab","x":"step","y":"wnorm_nowd","stroke":"var(--clay)","strokeWidth":2.1,"strokeDasharray":"5 3"},{"mark":"line","data":"ab","x":"step","y":"wnorm_wd","stroke":"var(--teal)","strokeWidth":2.4},{"mark":"text","data":[{"step":355,"y":38.6,"t":"无衰减增至 37.6"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"step":355,"y":23.6,"t":"含衰减稳定于 28.7"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"}]},{"title":"跨尺寸单元素更新 $\\mathrm{RMS}$","height":250,"narrowHeight":235,"marginBottom":38,"x":{"type":"point","domain":["64","256","512","1k","2k"],"label":"矩阵长边维度 A"},"y":{"label":"单元素 RMS","domain":[0,0.25]},"grid":true,"marks":[{"mark":"ruleY","data":[0.2],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"line","data":"rms","x":"s","y":"unscaled","stroke":"var(--clay)","strokeWidth":2.0,"strokeDasharray":"5 3"},{"mark":"line","data":"rms","x":"s","y":"keller","stroke":"var(--orange)","strokeWidth":1.9},{"mark":"line","data":"rms","x":"s","y":"moonshot","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":"rms","x":"s","y":"moonshot","fill":"var(--teal)","r":3.2,"tip":["shape","moonshot","keller","unscaled"]},{"mark":"text","data":[{"s":"2k","y":0.216,"t":"Moonshot 对齐 ≈ 0.19"}],"x":"s","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"}]}]}
```

---

## 六、硬件算术强度估算与四代优化器受控对比实验

### 6.1 为什么每步多做 5 轮大矩阵乘法，训练墙钟时间却几乎不增加？

第一次看到 `Muon` 的人，心里多半会犯嘀咕：`AdamW` 每个参数不过做几次加减乘除，`Muon` 却要给每张权重连乘 5 轮大矩阵，训练速度难道不会慢一大截吗？

拿 GPU 的**屋顶线模型（Roofline Model）**算一笔算术强度（Arithmetic Intensity，即每读写 1 字节显存能干多少次浮点运算 FLOPs/Byte，1 MAC = 2 FLOPs），疑虑当场烟消云散。

设权重 $W \in \mathbb{R}^{A \times B}$ 的短边为 $m = \min(A, B)$、长边为 $M = \max(A, B)$，主权重与优化器状态以 `float32`（4 字节）躺在显存（HBM）里：

1. **`AdamW` 卡在显存带宽上**。融合算子每步要读出 $(W, G, M, V)$ 4 张表，写回 $(W, M, V)$ 3 张表，一共搬运 $7 \times 4 A B = 28 A B$ 字节；可每个格子只做约 $12$ 次标量运算。算术强度低到只有 $\frac{12 A B}{28 A B} \approx 0.43\;\text{FLOPs/Byte}$——比现代 GPU 的算力拐点（H100 `bfloat16` Tensor Cores 约为 $295\;\text{FLOPs/Byte}$）低了整整几百倍！而且它还得常驻两张状态表。
2. **`Muon` 跑在 Tensor Cores 甜点区，且相对主干算力不到 $2\%$**。首先，`Muon` 砍掉了二阶矩 $V$，二维层的状态显存直接减半。其次，转置成 $m \times M$ 的 `bfloat16` 矩阵后，单步包含三次矩阵乘：$A_k = X_k X_k^\top$（$2 m^2 M$ FLOPs）、$A_k^2$（$2 m^3$ FLOPs）与 $B_k X_k$（$2 m^2 M$ FLOPs），5 步加起来总共不超过 $(20 + 10 m / M) m A B \le 30 m A B$ FLOPs。

   当 $m = 4096$ 时，这些 `bfloat16` 矩阵乘的算术强度高达 $1{,}365 \sim 2{,}048\;\text{FLOPs/Byte}$，稳稳跑满 Tensor Cores 峰值。再跟同一个训练步的前反向主干算力做个除法——全局批次 $N_{\mathrm{tok}} = B_{\mathrm{batch}} T$ 个词元流经该层时，前向 $X W^\top$ 与反向 $\Delta^\top X, \Delta W$ 合起来要花 $6 N_{\mathrm{tok}} A B$ FLOPs，所以 `Muon` 多出来的计算占比上界仅仅是：

$$
\frac{\mathrm{FLOPs}_{\mathrm{NS5}}}{\mathrm{FLOPs}_{\mathrm{fwd+bwd}}} = \frac{(20 + 10 m / M) m A B}{6 N_{\mathrm{tok}} A B} \le \frac{5 \min(A, B)}{N_{\mathrm{tok}}}
$$

在大模型预训练里，短边 $\min(A, B)$ 不过 $4{,}096 \sim 8{,}192$，而单步全局批词元数 $N_{\mathrm{tok}}$ 动辄高达 $10^6 \sim 4 \times 10^6$。代进去一除，额外开销只有区区 **$0.5\% \sim 2\%$**[@jordan2024][@liu2025]！

用不到 $2\%$ 的矩阵算力零头，换来每一轮对全部尾部奇异特征子空间的满额推进——在月之暗面的缩放定律实测中，达到同等损失所需的总训练词元数直接省下了约 **$48\%$**[@liu2025]，端到端训练时间反而大幅缩短。

### 6.2 双层迷你 Transformer 上的四代优化器同台受控实验

为了在一套干净透明的任务上亲眼看到四代优化器的分野，我们搭了一个结合**齐夫偏置背景词**与**跨位置关联键值检索（Associative Recall）**的合成基准。

词表设为 $V = 128$，句长 $T = 32$。每条序列前半段随机埋入 4 组 `Key → Value` 配对，后半段混入大量齐夫高频背景词，并在末尾随机挑一个 `Key` 发问。模型必须修成双层协同的“诱导头（Induction Head）”注意力回路，精准回头定位前文里的同一个 `Key`，才能答对它身后的 `Value`。

我们在完全相同的双层 4 头迷你 Transformer（$D = 64, B = 32$）上，让 `SGD`、`SGD + Momentum`、全参数 `AdamW` 以及标准分流的 `Muon + AdamW` 同台跑满 360 步（其中后两者共用一模一样的 $\eta = 5 \times 10^{-3}$ 与 $\lambda = 0.02$）：

```plot title="双层 4 头 Mini-Transformer 四代优化器受控对比：验证损失与跨位置键值检索准确率" note="词表 $V=128$，序列长 $T=32$，$D=64$，4 头，批大小 $B=32$；实线为两个随机种子的均值，半透明带为 $\pm 1$ 标准差。理论随机猜测交叉熵起点为 $\ln(128) \approx 4.85$。"
{"cols":2,"narrowCols":1,"xlabel":"训练步数 Step（双层 4 头 Mini-Transformer，齐夫偏置语料 + 跨位置键值检索，双随机种子均值 ±1 标准差）","legend":[{"label":"Muon+AdamW 混合（共用 $\\eta = 5\\times 10^{-3}$）","color":"var(--clay)","shape":"line"},{"label":"全参数 AdamW（$\\eta = 5\\times 10^{-3}$）","color":"var(--teal)","shape":"line"},{"label":"SGD + Momentum（$\\eta = 0.15$）","color":"var(--orange)","shape":"dash"},{"label":"纯 SGD（$\\eta = 0.25$）","color":"var(--stone)","shape":"dash"}],"data":{"bm":[{"opt":"sgd","step":1,"loss":4.958,"loss_lo":4.942,"loss_hi":4.974,"acc":1.4,"acc_lo":0.7,"acc_hi":2.1},{"opt":"sgd","step":8,"loss":4.44,"loss_lo":4.378,"loss_hi":4.503,"acc":1.9,"acc_lo":1.4,"acc_hi":2.4},{"opt":"sgd","step":16,"loss":3.978,"loss_lo":3.949,"loss_hi":4.007,"acc":1.6,"acc_lo":0.6,"acc_hi":2.5},{"opt":"sgd","step":24,"loss":3.718,"loss_lo":3.691,"loss_hi":3.744,"acc":2.0,"acc_lo":1.0,"acc_hi":2.9},{"opt":"sgd","step":32,"loss":3.558,"loss_lo":3.531,"loss_hi":3.584,"acc":2.6,"acc_lo":2.2,"acc_hi":3.0},{"opt":"sgd","step":40,"loss":3.438,"loss_lo":3.41,"loss_hi":3.467,"acc":4.2,"acc_lo":3.0,"acc_hi":5.4},{"opt":"sgd","step":48,"loss":3.335,"loss_lo":3.304,"loss_hi":3.367,"acc":5.1,"acc_lo":5.0,"acc_hi":5.3},{"opt":"sgd","step":56,"loss":3.241,"loss_lo":3.208,"loss_hi":3.274,"acc":5.0,"acc_lo":4.4,"acc_hi":5.7},{"opt":"sgd","step":64,"loss":3.159,"loss_lo":3.13,"loss_hi":3.188,"acc":6.9,"acc_lo":6.7,"acc_hi":7.0},{"opt":"sgd","step":72,"loss":3.093,"loss_lo":3.066,"loss_hi":3.12,"acc":7.0,"acc_lo":6.5,"acc_hi":7.4},{"opt":"sgd","step":80,"loss":3.036,"loss_lo":3.013,"loss_hi":3.059,"acc":6.1,"acc_lo":5.9,"acc_hi":6.3},{"opt":"sgd","step":88,"loss":2.988,"loss_lo":2.968,"loss_hi":3.008,"acc":7.0,"acc_lo":6.7,"acc_hi":7.2},{"opt":"sgd","step":96,"loss":2.957,"loss_lo":2.942,"loss_hi":2.971,"acc":7.8,"acc_lo":7.4,"acc_hi":8.1},{"opt":"sgd","step":104,"loss":2.923,"loss_lo":2.912,"loss_hi":2.933,"acc":7.4,"acc_lo":6.2,"acc_hi":8.7},{"opt":"sgd","step":112,"loss":2.901,"loss_lo":2.891,"loss_hi":2.911,"acc":7.4,"acc_lo":6.7,"acc_hi":8.1},{"opt":"sgd","step":120,"loss":2.881,"loss_lo":2.876,"loss_hi":2.886,"acc":7.7,"acc_lo":7.2,"acc_hi":8.2},{"opt":"sgd","step":128,"loss":2.87,"loss_lo":2.865,"loss_hi":2.875,"acc":7.3,"acc_lo":6.9,"acc_hi":7.6},{"opt":"sgd","step":136,"loss":2.857,"loss_lo":2.85,"loss_hi":2.863,"acc":6.8,"acc_lo":6.0,"acc_hi":7.7},{"opt":"sgd","step":144,"loss":2.846,"loss_lo":2.841,"loss_hi":2.85,"acc":7.2,"acc_lo":6.3,"acc_hi":8.0},{"opt":"sgd","step":152,"loss":2.838,"loss_lo":2.833,"loss_hi":2.842,"acc":6.5,"acc_lo":6.4,"acc_hi":6.5},{"opt":"sgd","step":160,"loss":2.829,"loss_lo":2.829,"loss_hi":2.83,"acc":8.1,"acc_lo":7.5,"acc_hi":8.7},{"opt":"sgd","step":168,"loss":2.825,"loss_lo":2.824,"loss_hi":2.827,"acc":7.3,"acc_lo":6.6,"acc_hi":8.0},{"opt":"sgd","step":176,"loss":2.822,"loss_lo":2.819,"loss_hi":2.825,"acc":7.2,"acc_lo":6.9,"acc_hi":7.4},{"opt":"sgd","step":184,"loss":2.816,"loss_lo":2.815,"loss_hi":2.816,"acc":7.4,"acc_lo":6.8,"acc_hi":8.0},{"opt":"sgd","step":192,"loss":2.816,"loss_lo":2.815,"loss_hi":2.817,"acc":7.2,"acc_lo":7.0,"acc_hi":7.3},{"opt":"sgd","step":200,"loss":2.809,"loss_lo":2.805,"loss_hi":2.813,"acc":7.9,"acc_lo":7.5,"acc_hi":8.3},{"opt":"sgd","step":208,"loss":2.812,"loss_lo":2.81,"loss_hi":2.815,"acc":7.2,"acc_lo":6.5,"acc_hi":7.8},{"opt":"sgd","step":216,"loss":2.81,"loss_lo":2.803,"loss_hi":2.816,"acc":7.7,"acc_lo":7.6,"acc_hi":7.8},{"opt":"sgd","step":224,"loss":2.803,"loss_lo":2.8,"loss_hi":2.806,"acc":7.5,"acc_lo":7.4,"acc_hi":7.5},{"opt":"sgd","step":232,"loss":2.807,"loss_lo":2.799,"loss_hi":2.815,"acc":6.6,"acc_lo":6.2,"acc_hi":6.9},{"opt":"sgd","step":240,"loss":2.806,"loss_lo":2.804,"loss_hi":2.808,"acc":7.8,"acc_lo":7.0,"acc_hi":8.6},{"opt":"sgd","step":248,"loss":2.798,"loss_lo":2.794,"loss_hi":2.801,"acc":7.9,"acc_lo":7.1,"acc_hi":8.6},{"opt":"sgd","step":256,"loss":2.802,"loss_lo":2.792,"loss_hi":2.811,"acc":8.2,"acc_lo":7.4,"acc_hi":8.9},{"opt":"sgd","step":264,"loss":2.796,"loss_lo":2.795,"loss_hi":2.798,"acc":8.1,"acc_lo":7.3,"acc_hi":8.8},{"opt":"sgd","step":272,"loss":2.795,"loss_lo":2.792,"loss_hi":2.797,"acc":7.0,"acc_lo":6.4,"acc_hi":7.5},{"opt":"sgd","step":280,"loss":2.795,"loss_lo":2.788,"loss_hi":2.802,"acc":8.5,"acc_lo":8.4,"acc_hi":8.6},{"opt":"sgd","step":288,"loss":2.791,"loss_lo":2.787,"loss_hi":2.795,"acc":7.5,"acc_lo":6.6,"acc_hi":8.3},{"opt":"sgd","step":296,"loss":2.792,"loss_lo":2.792,"loss_hi":2.793,"acc":8.1,"acc_lo":7.6,"acc_hi":8.6},{"opt":"sgd","step":304,"loss":2.796,"loss_lo":2.792,"loss_hi":2.8,"acc":8.0,"acc_lo":7.3,"acc_hi":8.7},{"opt":"sgd","step":312,"loss":2.803,"loss_lo":2.791,"loss_hi":2.816,"acc":7.5,"acc_lo":6.9,"acc_hi":8.0},{"opt":"sgd","step":320,"loss":2.788,"loss_lo":2.784,"loss_hi":2.791,"acc":7.9,"acc_lo":7.1,"acc_hi":8.6},{"opt":"sgd","step":328,"loss":2.791,"loss_lo":2.788,"loss_hi":2.794,"acc":6.8,"acc_lo":6.6,"acc_hi":7.0},{"opt":"sgd","step":336,"loss":2.79,"loss_lo":2.787,"loss_hi":2.792,"acc":7.2,"acc_lo":6.5,"acc_hi":7.9},{"opt":"sgd","step":344,"loss":2.788,"loss_lo":2.782,"loss_hi":2.794,"acc":7.5,"acc_lo":7.1,"acc_hi":7.8},{"opt":"sgd","step":352,"loss":2.788,"loss_lo":2.786,"loss_hi":2.79,"acc":7.0,"acc_lo":6.5,"acc_hi":7.5},{"opt":"sgd","step":360,"loss":2.788,"loss_lo":2.782,"loss_hi":2.794,"acc":7.3,"acc_lo":7.0,"acc_hi":7.5},{"opt":"momentum","step":1,"loss":4.985,"loss_lo":4.972,"loss_hi":4.998,"acc":1.1,"acc_lo":0.7,"acc_hi":1.5},{"opt":"momentum","step":8,"loss":4.167,"loss_lo":4.123,"loss_hi":4.212,"acc":1.5,"acc_lo":0.7,"acc_hi":2.3},{"opt":"momentum","step":16,"loss":3.473,"loss_lo":3.42,"loss_hi":3.527,"acc":3.8,"acc_lo":2.2,"acc_hi":5.4},{"opt":"momentum","step":24,"loss":3.125,"loss_lo":3.088,"loss_hi":3.163,"acc":5.7,"acc_lo":5.2,"acc_hi":6.2},{"opt":"momentum","step":32,"loss":2.942,"loss_lo":2.926,"loss_hi":2.957,"acc":7.1,"acc_lo":6.9,"acc_hi":7.3},{"opt":"momentum","step":40,"loss":2.861,"loss_lo":2.856,"loss_hi":2.865,"acc":8.0,"acc_lo":7.2,"acc_hi":8.7},{"opt":"momentum","step":48,"loss":2.829,"loss_lo":2.828,"loss_hi":2.83,"acc":7.2,"acc_lo":6.8,"acc_hi":7.6},{"opt":"momentum","step":56,"loss":2.811,"loss_lo":2.809,"loss_hi":2.812,"acc":6.9,"acc_lo":6.2,"acc_hi":7.5},{"opt":"momentum","step":64,"loss":2.808,"loss_lo":2.803,"loss_hi":2.814,"acc":7.1,"acc_lo":6.2,"acc_hi":8.0},{"opt":"momentum","step":72,"loss":2.804,"loss_lo":2.798,"loss_hi":2.81,"acc":7.4,"acc_lo":7.2,"acc_hi":7.5},{"opt":"momentum","step":80,"loss":2.799,"loss_lo":2.797,"loss_hi":2.801,"acc":8.0,"acc_lo":7.9,"acc_hi":8.0},{"opt":"momentum","step":88,"loss":2.799,"loss_lo":2.795,"loss_hi":2.802,"acc":5.8,"acc_lo":4.7,"acc_hi":6.8},{"opt":"momentum","step":96,"loss":2.798,"loss_lo":2.796,"loss_hi":2.8,"acc":6.9,"acc_lo":6.6,"acc_hi":7.2},{"opt":"momentum","step":104,"loss":2.8,"loss_lo":2.795,"loss_hi":2.805,"acc":8.8,"acc_lo":7.5,"acc_hi":10.1},{"opt":"momentum","step":112,"loss":2.793,"loss_lo":2.791,"loss_hi":2.796,"acc":7.2,"acc_lo":6.2,"acc_hi":8.2},{"opt":"momentum","step":120,"loss":2.792,"loss_lo":2.788,"loss_hi":2.795,"acc":8.0,"acc_lo":7.4,"acc_hi":8.5},{"opt":"momentum","step":128,"loss":2.799,"loss_lo":2.796,"loss_hi":2.802,"acc":6.7,"acc_lo":6.6,"acc_hi":6.7},{"opt":"momentum","step":136,"loss":2.793,"loss_lo":2.788,"loss_hi":2.798,"acc":6.7,"acc_lo":6.6,"acc_hi":6.8},{"opt":"momentum","step":144,"loss":2.794,"loss_lo":2.793,"loss_hi":2.795,"acc":7.5,"acc_lo":7.1,"acc_hi":7.9},{"opt":"momentum","step":152,"loss":2.795,"loss_lo":2.792,"loss_hi":2.799,"acc":6.0,"acc_lo":5.7,"acc_hi":6.2},{"opt":"momentum","step":160,"loss":2.791,"loss_lo":2.785,"loss_hi":2.797,"acc":7.3,"acc_lo":7.1,"acc_hi":7.4},{"opt":"momentum","step":168,"loss":2.793,"loss_lo":2.793,"loss_hi":2.793,"acc":6.7,"acc_lo":6.0,"acc_hi":7.5},{"opt":"momentum","step":176,"loss":2.795,"loss_lo":2.793,"loss_hi":2.798,"acc":6.9,"acc_lo":6.3,"acc_hi":7.5},{"opt":"momentum","step":184,"loss":2.792,"loss_lo":2.789,"loss_hi":2.796,"acc":7.8,"acc_lo":7.7,"acc_hi":7.9},{"opt":"momentum","step":192,"loss":2.794,"loss_lo":2.793,"loss_hi":2.796,"acc":7.4,"acc_lo":6.7,"acc_hi":8.1},{"opt":"momentum","step":200,"loss":2.785,"loss_lo":2.785,"loss_hi":2.785,"acc":7.2,"acc_lo":6.6,"acc_hi":7.8},{"opt":"momentum","step":208,"loss":2.789,"loss_lo":2.786,"loss_hi":2.792,"acc":8.4,"acc_lo":7.6,"acc_hi":9.2},{"opt":"momentum","step":216,"loss":2.795,"loss_lo":2.794,"loss_hi":2.797,"acc":7.6,"acc_lo":7.2,"acc_hi":8.0},{"opt":"momentum","step":224,"loss":2.791,"loss_lo":2.791,"loss_hi":2.791,"acc":7.2,"acc_lo":6.5,"acc_hi":7.8},{"opt":"momentum","step":232,"loss":2.788,"loss_lo":2.786,"loss_hi":2.79,"acc":7.5,"acc_lo":7.5,"acc_hi":7.5},{"opt":"momentum","step":240,"loss":2.79,"loss_lo":2.788,"loss_hi":2.793,"acc":6.8,"acc_lo":6.6,"acc_hi":6.9},{"opt":"momentum","step":248,"loss":2.791,"loss_lo":2.786,"loss_hi":2.796,"acc":8.1,"acc_lo":7.4,"acc_hi":8.7},{"opt":"momentum","step":256,"loss":2.788,"loss_lo":2.786,"loss_hi":2.789,"acc":8.6,"acc_lo":7.8,"acc_hi":9.4},{"opt":"momentum","step":264,"loss":2.787,"loss_lo":2.787,"loss_hi":2.787,"acc":7.2,"acc_lo":7.0,"acc_hi":7.3},{"opt":"momentum","step":272,"loss":2.787,"loss_lo":2.783,"loss_hi":2.79,"acc":7.2,"acc_lo":6.4,"acc_hi":8.0},{"opt":"momentum","step":280,"loss":2.785,"loss_lo":2.784,"loss_hi":2.787,"acc":8.3,"acc_lo":8.2,"acc_hi":8.3},{"opt":"momentum","step":288,"loss":2.788,"loss_lo":2.78,"loss_hi":2.796,"acc":7.1,"acc_lo":6.5,"acc_hi":7.6},{"opt":"momentum","step":296,"loss":2.787,"loss_lo":2.783,"loss_hi":2.791,"acc":7.1,"acc_lo":6.2,"acc_hi":8.0},{"opt":"momentum","step":304,"loss":2.791,"loss_lo":2.788,"loss_hi":2.795,"acc":8.0,"acc_lo":7.3,"acc_hi":8.7},{"opt":"momentum","step":312,"loss":2.792,"loss_lo":2.786,"loss_hi":2.797,"acc":6.8,"acc_lo":6.3,"acc_hi":7.2},{"opt":"momentum","step":320,"loss":2.787,"loss_lo":2.784,"loss_hi":2.79,"acc":7.2,"acc_lo":6.9,"acc_hi":7.5},{"opt":"momentum","step":328,"loss":2.8,"loss_lo":2.795,"loss_hi":2.804,"acc":7.0,"acc_lo":6.1,"acc_hi":7.9},{"opt":"momentum","step":336,"loss":2.783,"loss_lo":2.782,"loss_hi":2.785,"acc":7.0,"acc_lo":6.2,"acc_hi":7.8},{"opt":"momentum","step":344,"loss":2.789,"loss_lo":2.784,"loss_hi":2.794,"acc":7.4,"acc_lo":7.3,"acc_hi":7.5},{"opt":"momentum","step":352,"loss":2.784,"loss_lo":2.78,"loss_hi":2.788,"acc":7.6,"acc_lo":7.0,"acc_hi":8.1},{"opt":"momentum","step":360,"loss":2.787,"loss_lo":2.781,"loss_hi":2.793,"acc":7.4,"acc_lo":7.4,"acc_hi":7.4},{"opt":"adamw","step":1,"loss":4.726,"loss_lo":4.707,"loss_hi":4.745,"acc":2.6,"acc_lo":2.2,"acc_hi":2.9},{"opt":"adamw","step":8,"loss":3.602,"loss_lo":3.593,"loss_hi":3.611,"acc":4.1,"acc_lo":3.2,"acc_hi":5.0},{"opt":"adamw","step":16,"loss":2.963,"loss_lo":2.936,"loss_hi":2.99,"acc":6.5,"acc_lo":6.0,"acc_hi":7.0},{"opt":"adamw","step":24,"loss":2.822,"loss_lo":2.817,"loss_hi":2.826,"acc":5.3,"acc_lo":4.1,"acc_hi":6.5},{"opt":"adamw","step":32,"loss":2.796,"loss_lo":2.789,"loss_hi":2.803,"acc":7.1,"acc_lo":5.7,"acc_hi":8.5},{"opt":"adamw","step":40,"loss":2.789,"loss_lo":2.785,"loss_hi":2.792,"acc":6.4,"acc_lo":4.2,"acc_hi":8.6},{"opt":"adamw","step":48,"loss":2.786,"loss_lo":2.786,"loss_hi":2.787,"acc":6.4,"acc_lo":6.3,"acc_hi":6.5},{"opt":"adamw","step":56,"loss":2.783,"loss_lo":2.782,"loss_hi":2.784,"acc":6.2,"acc_lo":5.4,"acc_hi":7.1},{"opt":"adamw","step":64,"loss":2.79,"loss_lo":2.784,"loss_hi":2.796,"acc":6.0,"acc_lo":4.0,"acc_hi":7.9},{"opt":"adamw","step":72,"loss":2.783,"loss_lo":2.78,"loss_hi":2.787,"acc":5.5,"acc_lo":5.1,"acc_hi":6.0},{"opt":"adamw","step":80,"loss":2.78,"loss_lo":2.779,"loss_hi":2.781,"acc":7.2,"acc_lo":5.8,"acc_hi":8.6},{"opt":"adamw","step":88,"loss":2.785,"loss_lo":2.784,"loss_hi":2.786,"acc":8.0,"acc_lo":7.2,"acc_hi":8.7},{"opt":"adamw","step":96,"loss":2.787,"loss_lo":2.784,"loss_hi":2.791,"acc":8.9,"acc_lo":6.9,"acc_hi":10.8},{"opt":"adamw","step":104,"loss":2.776,"loss_lo":2.775,"loss_hi":2.777,"acc":10.0,"acc_lo":7.5,"acc_hi":12.4},{"opt":"adamw","step":112,"loss":2.785,"loss_lo":2.773,"loss_hi":2.796,"acc":9.3,"acc_lo":6.6,"acc_hi":11.9},{"opt":"adamw","step":120,"loss":2.774,"loss_lo":2.763,"loss_hi":2.785,"acc":10.6,"acc_lo":6.8,"acc_hi":14.4},{"opt":"adamw","step":128,"loss":2.778,"loss_lo":2.77,"loss_hi":2.786,"acc":9.3,"acc_lo":5.3,"acc_hi":13.3},{"opt":"adamw","step":136,"loss":2.775,"loss_lo":2.773,"loss_hi":2.776,"acc":11.8,"acc_lo":6.7,"acc_hi":16.8},{"opt":"adamw","step":144,"loss":2.767,"loss_lo":2.76,"loss_hi":2.774,"acc":11.5,"acc_lo":6.9,"acc_hi":16.1},{"opt":"adamw","step":152,"loss":2.772,"loss_lo":2.77,"loss_hi":2.775,"acc":13.1,"acc_lo":7.0,"acc_hi":19.1},{"opt":"adamw","step":160,"loss":2.766,"loss_lo":2.749,"loss_hi":2.784,"acc":13.1,"acc_lo":7.8,"acc_hi":18.5},{"opt":"adamw","step":168,"loss":2.765,"loss_lo":2.747,"loss_hi":2.783,"acc":14.2,"acc_lo":7.4,"acc_hi":20.9},{"opt":"adamw","step":176,"loss":2.76,"loss_lo":2.75,"loss_hi":2.771,"acc":15.0,"acc_lo":8.8,"acc_hi":21.3},{"opt":"adamw","step":184,"loss":2.757,"loss_lo":2.735,"loss_hi":2.778,"acc":17.3,"acc_lo":11.0,"acc_hi":23.5},{"opt":"adamw","step":192,"loss":2.745,"loss_lo":2.729,"loss_hi":2.761,"acc":18.5,"acc_lo":12.8,"acc_hi":24.1},{"opt":"adamw","step":200,"loss":2.734,"loss_lo":2.717,"loss_hi":2.751,"acc":19.4,"acc_lo":14.6,"acc_hi":24.2},{"opt":"adamw","step":208,"loss":2.74,"loss_lo":2.717,"loss_hi":2.762,"acc":18.6,"acc_lo":13.5,"acc_hi":23.7},{"opt":"adamw","step":216,"loss":2.721,"loss_lo":2.696,"loss_hi":2.746,"acc":21.3,"acc_lo":16.0,"acc_hi":26.6},{"opt":"adamw","step":224,"loss":2.728,"loss_lo":2.709,"loss_hi":2.746,"acc":19.9,"acc_lo":14.9,"acc_hi":24.8},{"opt":"adamw","step":232,"loss":2.719,"loss_lo":2.694,"loss_hi":2.743,"acc":21.8,"acc_lo":18.1,"acc_hi":25.5},{"opt":"adamw","step":240,"loss":2.713,"loss_lo":2.691,"loss_hi":2.734,"acc":21.9,"acc_lo":18.6,"acc_hi":25.3},{"opt":"adamw","step":248,"loss":2.709,"loss_lo":2.684,"loss_hi":2.735,"acc":22.5,"acc_lo":19.1,"acc_hi":25.9},{"opt":"adamw","step":256,"loss":2.701,"loss_lo":2.669,"loss_hi":2.734,"acc":22.3,"acc_lo":17.2,"acc_hi":27.4},{"opt":"adamw","step":264,"loss":2.705,"loss_lo":2.687,"loss_hi":2.724,"acc":23.7,"acc_lo":21.2,"acc_hi":26.2},{"opt":"adamw","step":272,"loss":2.702,"loss_lo":2.677,"loss_hi":2.726,"acc":23.9,"acc_lo":20.9,"acc_hi":26.9},{"opt":"adamw","step":280,"loss":2.696,"loss_lo":2.674,"loss_hi":2.718,"acc":23.2,"acc_lo":19.8,"acc_hi":26.6},{"opt":"adamw","step":288,"loss":2.705,"loss_lo":2.678,"loss_hi":2.733,"acc":21.7,"acc_lo":18.5,"acc_hi":25.0},{"opt":"adamw","step":296,"loss":2.705,"loss_lo":2.678,"loss_hi":2.733,"acc":23.3,"acc_lo":20.7,"acc_hi":25.9},{"opt":"adamw","step":304,"loss":2.695,"loss_lo":2.666,"loss_hi":2.725,"acc":24.7,"acc_lo":23.1,"acc_hi":26.3},{"opt":"adamw","step":312,"loss":2.705,"loss_lo":2.683,"loss_hi":2.726,"acc":24.1,"acc_lo":21.7,"acc_hi":26.6},{"opt":"adamw","step":320,"loss":2.689,"loss_lo":2.674,"loss_hi":2.703,"acc":24.0,"acc_lo":21.5,"acc_hi":26.5},{"opt":"adamw","step":328,"loss":2.693,"loss_lo":2.685,"loss_hi":2.702,"acc":25.0,"acc_lo":23.8,"acc_hi":26.1},{"opt":"adamw","step":336,"loss":2.677,"loss_lo":2.661,"loss_hi":2.692,"acc":25.9,"acc_lo":24.4,"acc_hi":27.3},{"opt":"adamw","step":344,"loss":2.684,"loss_lo":2.667,"loss_hi":2.701,"acc":25.5,"acc_lo":22.5,"acc_hi":28.5},{"opt":"adamw","step":352,"loss":2.687,"loss_lo":2.668,"loss_hi":2.707,"acc":24.5,"acc_lo":22.9,"acc_hi":26.0},{"opt":"adamw","step":360,"loss":2.698,"loss_lo":2.682,"loss_hi":2.713,"acc":23.7,"acc_lo":22.0,"acc_hi":25.5},{"opt":"muon_hybrid","step":1,"loss":4.929,"loss_lo":4.915,"loss_hi":4.944,"acc":1.5,"acc_lo":0.6,"acc_hi":2.4},{"opt":"muon_hybrid","step":8,"loss":4.269,"loss_lo":4.211,"loss_hi":4.327,"acc":5.8,"acc_lo":5.8,"acc_hi":5.8},{"opt":"muon_hybrid","step":16,"loss":3.487,"loss_lo":3.428,"loss_hi":3.547,"acc":6.4,"acc_lo":6.0,"acc_hi":6.8},{"opt":"muon_hybrid","step":24,"loss":3.119,"loss_lo":3.09,"loss_hi":3.148,"acc":6.1,"acc_lo":5.5,"acc_hi":6.6},{"opt":"muon_hybrid","step":32,"loss":2.917,"loss_lo":2.913,"loss_hi":2.922,"acc":8.1,"acc_lo":7.0,"acc_hi":9.2},{"opt":"muon_hybrid","step":40,"loss":2.829,"loss_lo":2.826,"loss_hi":2.832,"acc":8.2,"acc_lo":6.9,"acc_hi":9.4},{"opt":"muon_hybrid","step":48,"loss":2.798,"loss_lo":2.797,"loss_hi":2.798,"acc":7.2,"acc_lo":6.9,"acc_hi":7.5},{"opt":"muon_hybrid","step":56,"loss":2.775,"loss_lo":2.774,"loss_hi":2.776,"acc":7.2,"acc_lo":7.0,"acc_hi":7.4},{"opt":"muon_hybrid","step":64,"loss":2.786,"loss_lo":2.778,"loss_hi":2.794,"acc":7.2,"acc_lo":6.9,"acc_hi":7.4},{"opt":"muon_hybrid","step":72,"loss":2.779,"loss_lo":2.775,"loss_hi":2.782,"acc":8.1,"acc_lo":7.3,"acc_hi":8.9},{"opt":"muon_hybrid","step":80,"loss":2.773,"loss_lo":2.771,"loss_hi":2.775,"acc":9.0,"acc_lo":8.6,"acc_hi":9.5},{"opt":"muon_hybrid","step":88,"loss":2.774,"loss_lo":2.772,"loss_hi":2.776,"acc":8.3,"acc_lo":8.2,"acc_hi":8.3},{"opt":"muon_hybrid","step":96,"loss":2.772,"loss_lo":2.768,"loss_hi":2.777,"acc":10.6,"acc_lo":9.6,"acc_hi":11.6},{"opt":"muon_hybrid","step":104,"loss":2.767,"loss_lo":2.765,"loss_hi":2.77,"acc":12.9,"acc_lo":12.0,"acc_hi":13.9},{"opt":"muon_hybrid","step":112,"loss":2.758,"loss_lo":2.758,"loss_hi":2.758,"acc":13.8,"acc_lo":12.0,"acc_hi":15.5},{"opt":"muon_hybrid","step":120,"loss":2.744,"loss_lo":2.739,"loss_hi":2.749,"acc":19.3,"acc_lo":17.5,"acc_hi":21.2},{"opt":"muon_hybrid","step":128,"loss":2.731,"loss_lo":2.73,"loss_hi":2.731,"acc":21.0,"acc_lo":19.5,"acc_hi":22.5},{"opt":"muon_hybrid","step":136,"loss":2.721,"loss_lo":2.718,"loss_hi":2.725,"acc":22.3,"acc_lo":21.5,"acc_hi":23.0},{"opt":"muon_hybrid","step":144,"loss":2.705,"loss_lo":2.703,"loss_hi":2.708,"acc":23.6,"acc_lo":22.0,"acc_hi":25.3},{"opt":"muon_hybrid","step":152,"loss":2.692,"loss_lo":2.687,"loss_hi":2.697,"acc":24.3,"acc_lo":23.5,"acc_hi":25.1},{"opt":"muon_hybrid","step":160,"loss":2.681,"loss_lo":2.67,"loss_hi":2.692,"acc":26.8,"acc_lo":25.0,"acc_hi":28.6},{"opt":"muon_hybrid","step":168,"loss":2.676,"loss_lo":2.667,"loss_hi":2.684,"acc":26.1,"acc_lo":25.3,"acc_hi":27.0},{"opt":"muon_hybrid","step":176,"loss":2.67,"loss_lo":2.662,"loss_hi":2.677,"acc":26.7,"acc_lo":25.9,"acc_hi":27.5},{"opt":"muon_hybrid","step":184,"loss":2.667,"loss_lo":2.657,"loss_hi":2.676,"acc":24.9,"acc_lo":23.8,"acc_hi":26.0},{"opt":"muon_hybrid","step":192,"loss":2.663,"loss_lo":2.662,"loss_hi":2.664,"acc":26.3,"acc_lo":24.7,"acc_hi":27.9},{"opt":"muon_hybrid","step":200,"loss":2.656,"loss_lo":2.655,"loss_hi":2.658,"acc":27.1,"acc_lo":26.6,"acc_hi":27.6},{"opt":"muon_hybrid","step":208,"loss":2.665,"loss_lo":2.66,"loss_hi":2.67,"acc":28.2,"acc_lo":27.9,"acc_hi":28.4},{"opt":"muon_hybrid","step":216,"loss":2.661,"loss_lo":2.659,"loss_hi":2.662,"acc":30.1,"acc_lo":28.1,"acc_hi":32.1},{"opt":"muon_hybrid","step":224,"loss":2.676,"loss_lo":2.669,"loss_hi":2.683,"acc":30.1,"acc_lo":26.5,"acc_hi":33.7},{"opt":"muon_hybrid","step":232,"loss":2.67,"loss_lo":2.658,"loss_hi":2.682,"acc":32.6,"acc_lo":27.1,"acc_hi":38.1},{"opt":"muon_hybrid","step":240,"loss":2.667,"loss_lo":2.644,"loss_hi":2.691,"acc":36.2,"acc_lo":28.2,"acc_hi":44.2},{"opt":"muon_hybrid","step":248,"loss":2.668,"loss_lo":2.638,"loss_hi":2.699,"acc":40.0,"acc_lo":29.8,"acc_hi":50.3},{"opt":"muon_hybrid","step":256,"loss":2.655,"loss_lo":2.605,"loss_hi":2.705,"acc":45.1,"acc_lo":30.1,"acc_hi":60.1},{"opt":"muon_hybrid","step":264,"loss":2.66,"loss_lo":2.584,"loss_hi":2.736,"acc":50.1,"acc_lo":29.1,"acc_hi":71.2},{"opt":"muon_hybrid","step":272,"loss":2.651,"loss_lo":2.569,"loss_hi":2.733,"acc":55.7,"acc_lo":30.7,"acc_hi":80.7},{"opt":"muon_hybrid","step":280,"loss":2.658,"loss_lo":2.557,"loss_hi":2.759,"acc":57.7,"acc_lo":31.0,"acc_hi":84.5},{"opt":"muon_hybrid","step":288,"loss":2.663,"loss_lo":2.552,"loss_hi":2.773,"acc":59.7,"acc_lo":32.1,"acc_hi":87.2},{"opt":"muon_hybrid","step":296,"loss":2.675,"loss_lo":2.559,"loss_hi":2.791,"acc":61.7,"acc_lo":33.6,"acc_hi":89.7},{"opt":"muon_hybrid","step":304,"loss":2.677,"loss_lo":2.557,"loss_hi":2.797,"acc":64.6,"acc_lo":38.0,"acc_hi":91.2},{"opt":"muon_hybrid","step":312,"loss":2.687,"loss_lo":2.586,"loss_hi":2.787,"acc":66.2,"acc_lo":39.8,"acc_hi":92.5},{"opt":"muon_hybrid","step":320,"loss":2.696,"loss_lo":2.596,"loss_hi":2.797,"acc":68.5,"acc_lo":44.4,"acc_hi":92.6},{"opt":"muon_hybrid","step":328,"loss":2.711,"loss_lo":2.614,"loss_hi":2.809,"acc":68.2,"acc_lo":45.7,"acc_hi":90.6},{"opt":"muon_hybrid","step":336,"loss":2.72,"loss_lo":2.638,"loss_hi":2.803,"acc":70.7,"acc_lo":50.3,"acc_hi":91.0},{"opt":"muon_hybrid","step":344,"loss":2.739,"loss_lo":2.664,"loss_hi":2.814,"acc":72.4,"acc_lo":54.1,"acc_hi":90.6},{"opt":"muon_hybrid","step":352,"loss":2.758,"loss_lo":2.69,"loss_hi":2.825,"acc":74.1,"acc_lo":56.3,"acc_hi":91.9},{"opt":"muon_hybrid","step":360,"loss":2.778,"loss_lo":2.723,"loss_hi":2.833,"acc":77.0,"acc_lo":62.2,"acc_hi":91.8}]},"panels":[{"title":"验证集交叉熵损失（Cross-Entropy Loss）","height":270,"narrowHeight":235,"x":{"label":null,"domain":[0,365]},"y":{"label":"Val Loss","domain":[2.45,5.2]},"grid":true,"marks":[{"mark":"ruleY","data":[4.852],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"text","data":[{"x":358,"y":5.04,"t":"均匀随机起点 ln(128) = 4.85"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--muted)"},{"mark":"areaY","data":"bm","filter":{"opt":"adamw"},"x":"step","y1":"loss_lo","y2":"loss_hi","fill":"var(--teal)","fillOpacity":0.14},{"mark":"areaY","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y1":"loss_lo","y2":"loss_hi","fill":"var(--clay)","fillOpacity":0.15},{"mark":"line","data":"bm","filter":{"opt":"sgd"},"x":"step","y":"loss","stroke":"var(--stone)","strokeWidth":1.8,"strokeDasharray":"5 4"},{"mark":"line","data":"bm","filter":{"opt":"momentum"},"x":"step","y":"loss","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"bm","filter":{"opt":"adamw"},"x":"step","y":"loss","stroke":"var(--teal)","strokeWidth":2.2},{"mark":"line","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"loss","stroke":"var(--clay)","strokeWidth":2.5},{"mark":"dot","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"loss","fill":"var(--clay)","r":2.0,"tip":["step","loss"]}]},{"title":"跨位置键值检索准确率（Associative Recall %）","height":270,"narrowHeight":235,"x":{"label":null,"domain":[0,365]},"y":{"label":"检索准确率 (%)","domain":[-3,100]},"grid":true,"marks":[{"mark":"areaY","data":"bm","filter":{"opt":"adamw"},"x":"step","y1":"acc_lo","y2":"acc_hi","fill":"var(--teal)","fillOpacity":0.15},{"mark":"areaY","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y1":"acc_lo","y2":"acc_hi","fill":"var(--clay)","fillOpacity":0.16},{"mark":"line","data":"bm","filter":{"opt":"sgd"},"x":"step","y":"acc","stroke":"var(--stone)","strokeWidth":1.8,"strokeDasharray":"5 4"},{"mark":"line","data":"bm","filter":{"opt":"momentum"},"x":"step","y":"acc","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"bm","filter":{"opt":"adamw"},"x":"step","y":"acc","stroke":"var(--teal)","strokeWidth":2.2},{"mark":"line","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"acc","stroke":"var(--clay)","strokeWidth":2.6},{"mark":"dot","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"acc","fill":"var(--clay)","r":2.2,"tip":["step","acc"]},{"mark":"text","data":[{"x":358,"y":82,"t":"Muon+AdamW 77.0%"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"x":358,"y":15,"t":"全参数 AdamW 23.7%"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"},{"mark":"text","data":[{"x":358,"y":2,"t":"SGD / Momentum 7.4%"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--muted)"}]}]}
```

曲线的每一个拐点都跟前五节的数学推导严丝合缝。

前 50 步里，四组优化器都飞快背下了齐夫高频词的边际概率，把损失从 $4.85$ 压到 $2.80$ 附近。但从这儿往后，差距急剧拉开。

`SGD` 与 `Momentum` 的梯度长期被高频背景词淹没，承载诱导头回路的低奇异值方向根本长不出来，检索准确率一直死卡在 $7.3\% \sim 7.4\%$。`AdamW` 熬到第 150 步后才慢慢摸到子空间对齐的门道，360 步爬到 $23.7\%$。

而 `Muon + AdamW` 早在第 120 步就一举冲过诱导头相变阈值，最终把跨位置检索率推上了 **$77.0\%$**！（注：250 步后它的整体交叉熵有轻微回升，那只是因为固定小语料上的高频背景词先一步饱和过拟合了，而真正考验多头对齐的检索准确率仍在稳步攀升。）

---

## 七、单文件完整 PyTorch 实现：迷你 Transformer 与 `Muon + AdamW` 混合训练

最后，下面这份自包含的单文件 PyTorch 脚本把全文推导的每一个齿轮全部装在了一起——混合精度安全的 `RMSNorm`、多头因果自注意力、5 步牛顿-舒尔茨正交化、月之暗面 RMS 对齐版 `Muon`、按诱导范数的参数分流，以及 1 个完整 Epoch（50 步）的训练循环：

```python
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import TensorDataset, DataLoader


# =====================================================================
# 1. 牛顿-舒尔茨五次多项式迭代与自定义 Muon 优化器
# =====================================================================
def zeropower_via_newtonschulz5(G: torch.Tensor, steps: int = 5, eps: float = 1e-7) -> torch.Tensor:
    """用 5 步矩阵乘法将 G = U * Sigma * V^T 映射为近似半正交矩阵 U * V^T"""
    assert G.ndim == 2, "牛顿-舒尔茨正交化仅作用于二维矩阵参数"
    a, b, c = (3.4445, -4.7750, 2.0315)
    X = G.bfloat16() if G.is_cuda else G.float()

    # 除以 Frobenius 范数，保证全部初始奇异值落在 [0, 1] 收敛域内
    X = X / (X.norm() + eps)

    # 当行数大于列数 (A > B) 时先转置，使 A_k = X @ X.T 维度取较小的 B x B
    transposed = False
    if X.size(0) > X.size(1):
        X = X.T
        transposed = True

    # 奇数次矩阵多项式递推: X_{k+1} = a * X_k + (b * A_k + c * A_k^2) * X_k
    for _ in range(steps):
        A = X @ X.T
        B = b * A + c * (A @ A)
        X = a * X + B @ X

    if transposed:
        X = X.T
    return X.to(G.dtype)


class Muon(torch.optim.Optimizer):
    """作用于 Transformer 内部二维线性层的 Muon 优化器（含解耦权重衰减与 RMS 对齐）"""
    def __init__(self, params, lr=3e-3, momentum=0.95, weight_decay=0.01, scale_mode="moonshot"):
        defaults = dict(lr=lr, momentum=momentum, weight_decay=weight_decay, scale_mode=scale_mode)
        super().__init__(params, defaults)

    @torch.no_grad()
    def step(self, closure=None):
        loss = None
        if closure is not None:
            with torch.enable_grad():
                loss = closure()
        for group in self.param_groups:
            lr = group["lr"]
            mu = group["momentum"]
            wd = group["weight_decay"]
            scale_mode = group["scale_mode"]

            for W in group["params"]:
                if W.grad is None:
                    continue
                G = W.grad  # 与参数 W 同形状 (d_out, d_in) 的二维梯度矩阵

                # 每个二维参数仅需维护一阶动量缓冲区 M，无需二阶矩张量 V
                state = self.state[W]
                if "momentum_buffer" not in state:
                    state["momentum_buffer"] = torch.zeros_like(G)
                M = state["momentum_buffer"]

                # 1. Nesterov 前瞻动量: M_t = mu * M_{t-1} + G_t, tilde_M_t = G_t + mu * M_t
                M.mul_(mu).add_(G)
                tilde_M = G + mu * M

                # 2. 5 步牛顿-舒尔茨正交化
                O_t = zeropower_via_newtonschulz5(tilde_M, steps=5)

                # 3. 解耦权重衰减: W <- (1 - lr * wd) * W
                if wd != 0:
                    W.mul_(1.0 - lr * wd)

                # 4. 单元素更新 RMS 对齐缩放（moonshot 模式可直接共用 AdamW 学习率）
                A, B = W.size(0), W.size(1)
                scale = 0.2 * (max(A, B) ** 0.5) if scale_mode == "moonshot" else max(1.0, A / B) ** 0.5
                W.add_(O_t, alpha=-lr * scale)
        return loss


# =====================================================================
# 2. 迷你 Transformer 语言模型定义
# =====================================================================
class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim))  # 一维缩放向量 (dim,) -> AdamW (wd=0)
        self.eps = eps

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x_fp32 = x.float()
        rms = torch.rsqrt(x_fp32.pow(2).mean(-1, keepdim=True) + self.eps)
        return (x_fp32 * rms).to(x.dtype) * self.weight


class MiniTransformerLM(nn.Module):
    def __init__(self, vocab_size=1000, d_model=64, n_heads=4, max_len=32):
        super().__init__()
        assert d_model % n_heads == 0
        self.d_model = d_model
        self.n_heads = n_heads
        self.head_dim = d_model // n_heads

        # 入口离散查表层 -> AdamW
        self.tok_emb = nn.Embedding(vocab_size, d_model)
        self.pos_emb = nn.Embedding(max_len, d_model)

        # 内部注意力二维投影层 (.weight 形状均为 (64, 64)) -> Muon
        self.norm1 = RMSNorm(d_model)
        self.W_q = nn.Linear(d_model, d_model, bias=False)
        self.W_k = nn.Linear(d_model, d_model, bias=False)
        self.W_v = nn.Linear(d_model, d_model, bias=False)
        self.W_o = nn.Linear(d_model, d_model, bias=False)

        # 内部前馈网络二维层 (W_up: (256, 64), W_down: (64, 256)) -> Muon
        self.norm2 = RMSNorm(d_model)
        self.W_up   = nn.Linear(d_model, 4 * d_model, bias=False)
        self.W_down = nn.Linear(4 * d_model, d_model, bias=False)

        # 出口打分分类头 (1000, 64) -> AdamW
        self.norm_final = RMSNorm(d_model)
        self.lm_head = nn.Linear(d_model, vocab_size, bias=False)

    def forward(self, idx: torch.Tensor) -> torch.Tensor:
        B, T = idx.shape
        pos = torch.arange(0, T, device=idx.device)

        # (B, T, D) + (T, D)[沿批次维自动广播] -> (B, T, D)
        x = self.tok_emb(idx) + self.pos_emb(pos)

        # 第一子层: Pre-RMSNorm + 多头因果自注意力
        h = self.norm1(x)
        q = self.W_q(h).view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        k = self.W_k(h).view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        v = self.W_v(h).view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        attn_out = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        attn_out = attn_out.transpose(1, 2).contiguous().view(B, T, self.d_model)
        x = x + self.W_o(attn_out)

        # 第二子层: Pre-RMSNorm + SiLU 前馈网络
        h = self.norm2(x)
        x = x + self.W_down(F.silu(self.W_up(h)))

        return self.lm_head(self.norm_final(x))


# =====================================================================
# 3. 参数分流与 1 个完整 Epoch（50 Steps）训练循环
# =====================================================================
if __name__ == "__main__":
    torch.manual_seed(42)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = MiniTransformerLM(vocab_size=1000, d_model=64, n_heads=4, max_len=32).to(device)

    muon_params, adamw_decay, adamw_nodecay = [], [], []
    for name, p in model.named_parameters():
        is_embed_or_head = ("emb" in name) or ("lm_head" in name)
        if p.ndim == 2 and not is_embed_or_head:
            muon_params.append(p)
        elif p.ndim >= 2:
            adamw_decay.append(p)
        else:
            adamw_nodecay.append(p)

    shared_lr = 3e-3
    opt_muon = Muon(muon_params, lr=shared_lr, momentum=0.95, weight_decay=0.01, scale_mode="moonshot")
    opt_adamw = torch.optim.AdamW([
        {"params": adamw_decay,   "weight_decay": 0.01},
        {"params": adamw_nodecay, "weight_decay": 0.0},
    ], lr=shared_lr, betas=(0.9, 0.95))

    # 1000 条模 1000 递增序列，batch_size=20 -> 1 Epoch = 50 Steps
    seq_len = 16
    starts = torch.randint(0, 1000, (1000, 1))
    sequences = (starts + torch.arange(seq_len + 1)) % 1000
    dataloader = DataLoader(
        TensorDataset(sequences[:, :-1], sequences[:, 1:]),
        batch_size=20,
        shuffle=True,
    )

    model.train()
    for step, (x_batch, y_batch) in enumerate(dataloader, start=1):
        x_batch, y_batch = x_batch.to(device), y_batch.to(device)

        logits = model(x_batch)                                                # 1. 前向传播
        loss = F.cross_entropy(logits.reshape(-1, 1000), y_batch.reshape(-1))  # 2. 交叉熵损失
        opt_muon.zero_grad(); opt_adamw.zero_grad()                            # 3. 清空旧梯度
        loss.backward()                                                        # 4. 反向传播求导
        opt_muon.step(); opt_adamw.step()                                      # 5. 双优化器更新参数

        if step == 1 or step % 10 == 0:
            print(f"Epoch 1 | Step [{step:2d}/50] | Loss: {loss.item():.4f}")
```

运行上述脚本，可以看到交叉熵损失从接近均匀随机分布基准值 $\ln(1000) \approx 6.91$ 的起点单调平稳下降：

```text
Epoch 1 | Step [ 1/50] | Loss: 7.1004
Epoch 1 | Step [10/50] | Loss: 6.7182
Epoch 1 | Step [20/50] | Loss: 6.2750
Epoch 1 | Step [30/50] | Loss: 5.7630
Epoch 1 | Step [40/50] | Loss: 5.0782
Epoch 1 | Step [50/50] | Loss: 4.5468
```

---

## 小结：现代优化器演进脉络对照

回头纵览整条推导链，从最朴素的标量梯度下降走到今天的大模型混合优化器，其实一直在回答三个层层递进的追问：

1. **怎么借历史梯度抚平噪声与峡谷震荡？**（从 `SGD` 到 `Momentum` / Nesterov 前瞻）
2. **怎么让权重衰减摆脱自适应分母的扭曲？**（从 `Adam + L2` 到解耦的 `AdamW`）
3. **怎么按每一层输入输出空间的真实几何，选对丈量步长的范数尺子？**（首尾词表层留给 `AdamW`，内部 $\mathrm{RMS}\to\mathrm{RMS}$ 线性层交给 `Muon`）

```data title="五种优化器更新机制、对应约束范数与受控实验表现汇总" bars="检索率" mark="Muon+AdamW" note="检索率取自第六节双层 4 头 Mini-Transformer 跨位置键值检索实验（第 360 步均值；Adam+L2 重点见第三节衰减对比故未重复跑该项）。"
方案 | 更新信号与谱变换 | 权重衰减 | 隐含约束范数 | 检索率
SGD (+L2) | $g_t$（标量步长） | 混入 $g_t + \lambda\theta$ | $\|\Delta\theta\|_2$ | 7.3%
Momentum | $m_t$（一阶惯性） | 混入 $g_t + \lambda\theta$ | $\|\Delta\theta\|_2$ + 惯性 | 7.4%
Adam (+L2) | $\hat{m}_t / (\sqrt{\hat{v}_t} + \epsilon)$ | 与 $\sqrt{\hat{v}_t}$ 耦合失真 | $\|\Delta\theta\|_\infty$ | —
AdamW | $\hat{m}_t / (\sqrt{\hat{v}_t} + \epsilon)$ | 解耦 $(1-\eta\lambda)\theta$ | $\|\Delta\theta\|_\infty$ | 23.7%
Muon+AdamW | $\tilde{M}_t$ 经 5 步 NS5 | 解耦 $(1-\eta\lambda)W$ | $\|\Delta W\|_{\mathrm{RMS}\to\mathrm{RMS}}$ | 77.0%
```

只要脑海里立住这条主线——**显存四类张量的存活边界 $\to$ 外积梯度 $G = \Delta^\top X$ 的奇异谱偏斜 $\to$ 诱导范数决定的 `Muon` / `AdamW` 分流**——再去翻看 `modded-nanogpt`、`Moonlight` 或主流大模型预训练框架的源码时，每一处矩阵转置、半精度转换与缩放系数都会变成水到渠成的数学推论。

## 参考资料

- [@vaswani2017] Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, Ł., & Polosukhin, I. (2017). [Attention Is All You Need](https://arxiv.org/abs/1706.03762). _Advances in Neural Information Processing Systems 30 (NeurIPS 2017)_.
- [@robbins1951] Robbins, H., & Monro, S. (1951). [A Stochastic Approximation Method](https://doi.org/10.1214/aoms/1177729586). _The Annals of Mathematical Statistics, 22_(3), 400–407.
- [@loshchilov2019] Loshchilov, I., & Hutter, F. (2019). [Decoupled Weight Decay Regularization](https://arxiv.org/abs/1711.05101). _International Conference on Learning Representations (ICLR 2019)_.
- [@jordan2024] Jordan, K., Jin, Y., Boza, V., You, J., Cesista, F., Newhouse, L., & Bernstein, J. (2024). [Muon: An Optimizer for Hidden Layers in Neural Networks](https://kellerjordan.github.io/posts/muon/). _Keller Jordan blog_.
- [@liu2025] Liu, J., Su, J., Yao, X., Jiang, Z., Lai, G., Du, Y., Qin, Y., Xu, W., Lu, E., Yan, J., et al. (2025). [Muon is Scalable for LLM Training](https://arxiv.org/abs/2502.16982). _arXiv preprint arXiv:2502.16982_.
- [@zhang2019] Zhang, B., & Sennrich, R. (2019). [Root Mean Square Layer Normalization](https://arxiv.org/abs/1910.07467). _Advances in Neural Information Processing Systems 32 (NeurIPS 2019)_.
- [@polyak1964] Polyak, B. T. (1964). [Some Methods of Speeding Up the Convergence of Iteration Methods](https://doi.org/10.1016/0041-5553(64)90137-5). _USSR Computational Mathematics and Mathematical Physics, 4_(5), 1–17.
- [@nesterov1983] Nesterov, Y. (1983). A Method for Solving the Convex Programming Problem with Convergence Rate $O(1/k^2)$. _Doklady AN SSSR, 269_, 543–547.
- [@duchi2011] Duchi, J., Hazan, E., & Singer, Y. (2011). [Adaptive Subgradient Methods for Online Learning and Stochastic Optimization](https://jmlr.org/papers/v12/duchi11a.html). _Journal of Machine Learning Research, 12_, 2121–2159.
- [@kingma2015] Kingma, D. P., & Ba, J. (2015). [Adam: A Method for Stochastic Optimization](https://arxiv.org/abs/1412.6980). _International Conference on Learning Representations (ICLR 2015)_.
- [@gupta2018] Gupta, V., Koren, T., & Singer, Y. (2018). [Shampoo: Preconditioned Stochastic Tensor Optimization](https://arxiv.org/abs/1802.09568). _Proceedings of the 35th International Conference on Machine Learning (ICML 2018)_, 1842–1850.
- [@bernstein2024] Bernstein, J., & Newhouse, L. (2024). [Old Optimizer, New Norm: An Anthology](https://arxiv.org/abs/2409.20325). _arXiv preprint arXiv:2409.20325_.

# Cards

## 全局心智图：静态参数本体与推理、训练两条数据流

一座大语言模型的本体只是持久化在磁盘与显存中的一组**静态参数矩阵 $\Theta$**（首尾词表层 $E_{\mathrm{tok}}, W_{\mathrm{head}}$、内部 $L$ 层二维算子 $W_{q,k,v,o}, W_{\mathrm{up}}, W_{\mathrm{down}}$ 与一维缩放向量 $\gamma$）。围绕同一组 $\Theta$ 运行着两条截然不同的数据流：

1. **推理是只读单向流水线**：$\Theta$ 全程冻结；输入提示词先经 **{{c1::Prefill（预填充）}}** 阶段做整段并行矩阵乘（GEMM，算力受限）填充历史 `KV Cache`，随后 **{{c1::Decode（自回归解码）}}** 阶段每步仅送入 $1 \times D$ 单行新词向量做向量乘矩阵（GEMV，受限于 **{{c2::显存访存带宽}}**）逐词采样，中间激活算完即释。
2. **训练是改写参数的四步闭环**：**Forward** 整句并行 GEMM（算力受限）并暂存各层激活 $X$ $\to$ **Loss** 将全序列预测归约为单个标量 $L$ $\to$ **Backward** 经矩阵收缩算出与各参数同形状的梯度 $G$ $\to$ **Optimizer Step** 按空间几何分流改写 $\Theta$（首尾边界与一维参数交由 **{{c3::AdamW}}**，占非词表参数 $95\%$ 以上的内部二维线性算子交由 **{{c3::Muon}}**）。

Extra

大局观锚点：阅读任何大模型系统代码前先定位当前处于哪条流——推理用显存空间（`KV Cache`）换取免除历史前缀重算，瓶颈在单行解码的访存带宽；训练用数倍显存空间（暂存前向激活与优化器状态）换取全序列并行求导，核心挑战在梯度矩阵的奇异谱病态性。

type: cloze
tags: ML/LLM ML/Architecture ML/Systems ML/BigPicture
uuid: 8b184ab9-f28e-4297-890c-b375a3f2d94a

---

## 显存中四类张量家族的存活周期与职责边界

在 Transformer 的推理与训练全流程中，口语里统称为“矩阵”的张量按数学职责与存活周期严格划分为四类：

1. **{{c1::静态参数矩阵 $\Theta$}}**（如 $E_{\mathrm{tok}}, W_{q,k,v,o}, W_{\mathrm{up}}, W_{\mathrm{down}}, W_{\mathrm{head}}$）：尺寸仅由架构常数决定，与输入句长 $T$ 无关，是权重文件唯一保存且训练中唯一被优化器改写的对象。
2. **{{c2::动态激活张量}}**（如残差流 $X$、多头 $Q, K, V_{\mathrm{val}}$ 与注意力概率矩阵 $P \in \mathbb{R}^{B \times H \times T \times T}$）：随每次输入的词元即时算出；推理阶段逐层释放，训练前向则必须 **{{c2::暂存至反向传播结束}}** 以供链式求导。
3. **{{c3::推理键值缓存 KV Cache}}**（形状 $(B, H, t, d_k)$）：仅在自回归解码阶段常驻显存并每步追加 $1$ 行；训练阶段因整句并行故无需分配。
4. **{{c4::训练梯度与优化器状态 $G, M, V$}}**：仅在训练阶段为每块可训练参数配套分配同形状缓冲区（其中 `Muon` 可省去内部二维层的整张二阶矩 $V$ 表）。

Extra

防混淆核心判据：初学者最易混同投影权重 $W_q, W_k \in \mathbb{R}^{D \times D}$（第一类静态参数，承载跨位置共享的子空间映射）与注意力概率矩阵 $P \in \mathbb{R}^{T \times T}$（第二类动态激活，仅反映单条句子内部词元间的临时对齐权重，步后即销毁，不写入权重文件）。

type: cloze
tags: ML/LLM ML/Architecture ML/Systems ML/BigPicture
uuid: bccb8883-467a-4721-861f-2bbc824eab34

---

Front

## 系统不对称性：为什么推理省显存却串行慢，而训练并行快却吃数倍显存？

围绕同一座 Transformer 模型回答两个根本系统追问：
1. 为什么聊天推理必须拆成 `Prefill` + `Decode` 并维护 `KV Cache` 逐词串行生成，而训练代码没有逐词循环、也不分配 `KV Cache`，却能把整段序列一次性送入网络并行算完？
2. 为什么同一座模型开启训练所需的显存会比推理高出数倍？

Back

1. **目标词已知性与因果掩码决定并行形态**：
   - **推理（未来词未知）**：第 $t+1$ 词依赖第 $t$ 步采样输出，必须串行推进。由于因果掩码严禁前 $t-1$ 个位置读取第 $t$ 词，历史键值 $K_{1:t-1}, V_{1:t-1}$ 永不改变；缓存后单步 `Decode` 只需输入单行新词 $h_t \in \mathbb{R}^{1 \times D}$ 做 GEMV，把生成至长度 $N$ 的累计乘加复杂度从每步重算整句的 $\mathcal{O}(N^2 D^2 + N^3 D)$ 降至 **$\mathcal{O}(N D^2 + N^2 D)$**（但单步算术强度极低，受限于显存带宽）。
   - **训练（Teacher Forcing 全序列已知）**：语料真实序列 $x_{1:T+1}$ 事先给定。将 $x_{1:T}$ 打包为 $(B, T, D)$ 配合上三角掩码 $M_{\mathrm{causal}}$ 做单次高算术强度 GEMM，在数学上严格等价于同时独立运行 $B \times T$ 个不同前缀长度的下一词预测任务，无需 `KV Cache`。
2. **反向链式求导决定显存倍率**：
   - 推理激活算完即焚，仅驻留静态参数 $\Theta$ 与 `KV Cache`；
   - 训练为计算各层参数梯度（如线性层 $G = \Delta^\top X$ 及注意力反向求导），必须同时在显存驻留 **$L$ 层全部前向中间激活**、**同形状梯度矩阵 $G$** 以及 **优化器历史状态 $M, V$**。

type: basic
tags: ML/LLM ML/Systems ML/BigPicture
uuid: f74adae9-482d-4859-8f6e-fc1f17fc16f5

---

## 形状因果律（一）：为什么线性层权重不含句长 $T$，而注意力矩阵必现 $T \times T$？

设批大小 $B$、序列长 $T$、词表大小 $V$、隐藏维 $D$、注意力头数 $H$、前馈升维宽度 $d_{\mathrm{ff}}$，从运算物理职责推导核心张量形状：

1. **词表边界与主干隐藏流**：离散整数编号无法直接求导，入口词嵌入表 $E_{\mathrm{tok}} \in$ **{{c1::$\mathbb{R}^{V \times D}$}}** 通过等价于独热向量左乘 $u_{x_t}^\top E_{\mathrm{tok}}$ 的按行查表，叠加位置表示后形成贯通首尾的三维残差流激活 $X \in$ **{{c1::$\mathbb{R}^{B \times T \times D}$}}**（常展平为 $N \times D$，其中 $N = B T$）。
2. **为什么投影与 MLP 权重完全不含句长 $T$**：注意力投影 $W_{q,k,v,o} \in$ **{{c2::$\mathbb{R}^{D \times D}$}}** 与前馈升维层 $W_{\mathrm{up}} \in$ **{{c2::$\mathbb{R}^{d_{\mathrm{ff}} \times D}$}}** 的维度只取决于特征通道宽度——因为线性层是**跨所有序列位置共享的逐行算子**，只在同一词元内部重组特征列，不同位置的词元在线性投影中互不通信。
3. **为什么注意力概率表必然出现 $T \times T$**：单头切片 $Q^{(h)}, K^{(h)} \in \mathbb{R}^{B \times T \times d_k}$ 执行 $Q^{(h)}(K^{(h)})^\top$ 时，公共子空间特征维 $d_k$ 内积消去，必然生成形状为 **{{c3::$\mathbb{R}^{B \times H \times T \times T}$}}** 的因果注意力矩阵 $P$——它是全网唯一让不同位置词元**两两交互混洗信息**的下三角路由表。

Extra

读形状培养架构直觉：看到张量形状里不含 $T$，说明它是跨位置复用的静态变换规则；含一个 $T$，说明它是逐词携带的特征状态流；含 $T \times T$，则直接定位了跨位置信息路由点以及长文本二次方复杂度瓶颈。

type: cloze
tags: ML/LLM ML/TensorShapes ML/Architecture
uuid: d1d2e02e-ecdd-440f-95f0-15458285572b

---

## 形状因果律（二）：多头切分 $D = H \times d_k$、方差缩放与解码 KV Cache 的行高非对称性

多头因果自注意力将 $(B, T, D)$ 重排并交换中间两维得到四维张量 $(B, H, T, d_k)$（满足 $D = H \times d_k$）：

1. **子空间切分与 $\sqrt{d_k}$ 梯度保护**：拆分为 $H$ 个并行低维子空间可同时捕获指代、句法等多种上下文对齐关系；若 $q, k \in \mathbb{R}^{d_k}$ 各分量独立零均值、单位方差，未缩放内积 $q^\top k$ 的方差等于 **{{c1::$d_k$}}**，必须除以 **{{c1::$\sqrt{d_k}$}}** 将方差重新归一为 $1$，否则大维度下打分极差过大会令 Softmax 退化为近似独热分布，使其局部导数 $P_{i,a}(\delta_{ab} - P_{i,b}) \to 0$ 而引发梯度饱和消失。
2. **解码第 $t$ 步的 $1$ 行对 $t$ 行非对称性**：在自回归 `Decode` 第 $t$ 步，模型只需预测第 $t+1$ 个词，故查询张量 $Q_t$ 在序列维压缩为 **{{c2::$1$}}** 行（单头切片 $1 \times d_k$），而键值缓存 $K_{1:t}, V_{1:t}$ 必须保有完整的 **{{c2::$t$}}** 行（前 $t-1$ 行历史缓存拼接本步新算 $1$ 行，完整 `KV Cache` 形状为 $(B, H, t, d_k)$）。
3. **单步解码注意力形状退化**：第 $t$ 步无需构造 $t \times t$ 方阵，注意力概率退化为单排向量 $P_{t,:} = \mathrm{softmax}(q_t K_{1:t}^\top / \sqrt{d_k}) \in$ **{{c3::$\mathbb{R}^{1 \times t}$}}**，左乘 $V_{1:t}\;(t \times d_k)$ 即输出当前位置隐状态 $o_t \in \mathbb{R}^{1 \times d_k}$。

Extra

形状直觉：为什么解码时 $Q$ 不需要建 Cache 而 $K, V$ 必须建 Cache？因为因果掩码下历史旧词既不需要再重新预测下一词（故历史 $q_{1:t-1}$ 作废），也永远读不到新生成的第 $t$ 词；唯独新词必须拿自己的查询 $q_t$ 去检索全部历史位置的键 $K_{1:t}$ 并加权提取值 $V_{1:t}$。

type: cloze
tags: ML/LLM ML/TensorShapes ML/Attention
uuid: 28cbdce2-8582-49c4-a943-596c7b7a4191

---

## 形状因果律（三）：反向传播的“公共维消元律”与前向激活驻留铁律

给定无偏置线性层 $Y = X W^\top$，设展平批次与序列后的输入 $X \in \mathbb{R}^{N \times d_{\mathrm{in}}}$，权重 $W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$，上游传回误差矩阵 $\Delta = \nabla_Y L \in \mathbb{R}^{N \times d_{\mathrm{out}}}$。无需死背逐元素求导公式，仅凭**“矩阵乘必须消去哪条公共维”**即可唯一确定两路反传方程：

1. **求本层权重梯度 $G = \nabla_W L$（目标形状 $d_{\mathrm{out}} \times d_{\mathrm{in}}$）**：由 $\Delta\;(N \times d_{\mathrm{out}})$ 与 $X\;(N \times d_{\mathrm{in}})$ 相乘得到，必须将两者共有的**样本词元维 $N$** 内积求和消去，故唯一合法形式为 $G =$ **{{c1::$\Delta^\top X$}}**。
2. **求传向下游的输入梯度 $\nabla_X L$（目标形状 $N \times d_{\mathrm{in}}$）**：由 $\Delta\;(N \times d_{\mathrm{out}})$ 与 $W\;(d_{\mathrm{out}} \times d_{\mathrm{in}})$ 相乘得到，必须将共有的**输出通道维 $d_{\mathrm{out}}$** 求和消去，故唯一合法形式为 $\nabla_X L =$ **{{c2::$\Delta W$}}**（前向乘转置 $W^\top$，反向恰好乘原矩阵 $W$）。
3. **直接导出的系统铁律**：由于计算 $G = \Delta^\top X$ 必须直接读取前向输入矩阵 $X$，训练前向算出 $Y$ 后 **{{c3::绝不能立即释放 $X$，必须将其驻留显存直到本层反向求导完成}}**；同理，把大批次 $N$ 拆成若干微批次反复将 $\Delta^\top X$ 累加进 `W.grad` 严格等价于沿样本维 $N$ 分段内积求和，因此常规单步反向前必须调用 `zero_grad()`。

Extra

维度消元心法：算任何参数梯度时，样本批次维 $N$ 必定作为内维被转置配对消去，从而保证无论批大小与句长如何变化，$G$ 的形状永远与静态参数 $W$ 逐格一致；算任何激活梯度时，样本维 $N$ 必定原样保留在外侧。

type: cloze
tags: ML/Backprop ML/TensorShapes ML/Systems
uuid: 4777fd46-af30-49a0-affc-30b93f532e46

---

## 形状因果律（四）：标量损失还原矩阵梯度的起点与 PyTorch 权重行主序布局

打通训练图首尾两端的形状转换与工程内存约定（设总预测词元位置 $N = B T$，词表大小 $V$）：

1. **开训首步 Loss 校验基准**：随机初始化阶段各候选词打分接近相等（$P_{n,k} \approx 1/V$），全序列平均交叉熵损失的理论期望起点恰为 **{{c1::$\ln V$}}**（例如 $V = 1000$ 时约为 $6.91$，是检验模型前向与损失归约是否写对的第一基准）。
2. **从 $1 \times 1$ 标量 $L$ 展开为 $N \times V$ 顶层误差矩阵**：平均交叉熵对展平打分矩阵 $Z \in \mathbb{R}^{N \times V}$ 求偏导，直接还原出反向传播起点 $\Delta^{(Z)} = \nabla_Z L =$ **{{c2::$\frac{1}{N}(P - Y_{\mathrm{true}})$}}**——真实答案列导数为负值（负梯度更新时向上推高打分），其余错误候选列导数为正值（分错概率越大向下压低力度越强），且每行导数之和恒为 $0$。
3. **为什么 PyTorch `nn.Linear(d_in, d_out)` 内部 `.weight` 形状反存为 $(d_{\mathrm{out}}, d_{\mathrm{in}})$**：前向计算执行 $Y = X W^\top$，是因为 C/CUDA 数组默认采用 **{{c3::按行连续（Row-Major）}}** 存储——把每个输出神经元对应的 $d_{\mathrm{in}}$ 个权重排成连续的一行，做向量内积时即可顺着连续内存地址高速读取。

Extra

工程与源码阅读直觉：阅读优化器源码（如 `Muon` 中令 `A, B = W.size(0), W.size(1)`）时，务必牢记 PyTorch 线性层二维权重的第 0 维行数恒为输出维 $d_{\mathrm{out}}$，第 1 维列数恒为输入维 $d_{\mathrm{in}}$。

type: cloze
tags: ML/Backprop ML/TensorShapes ML/LLM
uuid: 79a36682-a97b-404d-8b1b-c68a252b7efb

---

## 研究品味（一）：做减法的艺术——RMSNorm 的尺度不变性与切空间正交（Zhang & Sennrich）

早期 `LayerNorm` 对每个词向量需串行执行两趟跨通道归约（先求均值 $\mu$，再求方差 $\sigma^2$），访存延迟显著高于算术本身。Zhang & Sennrich 追问：稳定深层训练的核心机制究竟是“减均值”还是“控幅度”？果断删去均值中心化与偏置后得到 $y = \frac{x}{r(x)} \odot \gamma$（其中 $r(x) = \sqrt{\frac{1}{D}\sum_{i=1}^D x_i^2 + \epsilon}$）：

1. **纯净的正标量尺度不变性**：当 $\epsilon \to 0$ 时，对任意 $\alpha > 0$ 有 $\mathrm{RMSNorm}(\alpha x) =$ **{{c1::$\mathrm{RMSNorm}(x)$}}**；这令紧随其后的线性层接收到的输入隐状态在均方根意义下始终锚定于单位尺度 $\|x\|_{\mathrm{RMS}} \approx 1$。
2. **反向切平面径向正交与自动阻尼**：反传回输入 $x$ 的梯度 $\nabla_x L = \frac{1}{r(x)}\!\left(I_D - \frac{\hat{x}\hat{x}^\top}{D}\right)\tilde{\delta}$ 恒满足内积恒等式 **{{c2::$x^\top \nabla_x L = 0$}}**——梯度严格正交于 $x$ 本身（单纯拉长或缩短激活模长的径向导数恒为零），且前置因子 $1/r(x)$ 自动按输入尺度反比抑制深层梯度发散。
3. **尺度层与权重衰减的交互边界**：初始化为全 $1$ 的一维通道缩放向量 $\gamma \in \mathbb{R}^D$ 仅调节归一化后的通道增益，不存在高维矩阵过拟合自由度，在 `AdamW` 中必须设 `weight_decay =` **{{c3::0.0}}**。

Extra

研究品味启发（Takeaway for Research Taste）：高水准的架构改进往往做减法而非堆砌模块——把经验有效的复杂组件剥离到“最小充分假设”（只保留均方根缩放不变性），不仅省掉一趟 GPU 归约访存，还赋予后续线性层干净的单位 RMS 输入度量（成为导出 `Muon` 算子谱范数的前置基石）；同时凡遇尺度不变结构，必须审视权重衰减是否会与缩放因子产生无意义的抵消博弈。

type: cloze
tags: ML/LLM ML/Normalization ML/ResearchTaste
uuid: 2f5a2da9-5abc-4980-a594-3a1143f284be

---

## 研究品味（二）：从梯度外积和代数结构看透奇异谱偏斜病灶

面对线性层梯度公式 $G = \Delta^\top X \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$，顶尖优化器研究者不会把它当成普通矩阵乘黑盒，而会立刻按样本词元维拆开，审视其**逐词元秩一外积求和**结构：

$$
G = {{c1::\sum_{n=1}^{N} \delta_n x_n^\top}}
$$

1. **数据分布注定的奇异值鸿沟**：自然语言词频服从长尾 **{{c2::齐夫定律（Zipf's Law）}}**，少数高频语法词与共模语义方向在每个批次反复叠加，使输入协方差 $\frac{1}{N}X^\top X$ 与梯度矩阵 $G$ 呈现剧烈的各向异性——前几个主奇异值垄断绝大部分能量，而承载低频知识与精细上下文对齐的几十上百个尾部奇异值微弱数千至上万倍。
2. **标量步长的结构性两难**：在条件数 $\kappa = \lambda_{\max}/\lambda_{\min} \gg 1$ 的病态曲率下，统一标量学习率被最陡主方向锁死在稳定上界 $\eta <$ **{{c3::$2 / \lambda_{\max}$}}** 以内，导致高曲率主方向极易跨谷壁来回震荡，而微弱尾部奇异方向每步误差仅收缩 $1 - \mathcal{O}(1/\kappa)$，陷入漫长的更新停滞（纯 `SGD` 需 $\mathcal{O}(\kappa)$ 步，引入动量阻尼亦仅改善至 $\mathcal{O}(\sqrt{\kappa})$）。

Extra

研究品味启发（Takeaway for Research Taste）：不要在真空中空谈非凸优化，先看真实数据分布与网络求导代数耦合出了怎样的梯度结构——“秩一外积求和 × 齐夫长尾词频”直接注定了梯度奇异谱的“头部垄断、尾部饥饿”。看懂这幅奇异谱图景，就抓住了从自适应预条件到矩阵谱正交化整条演进脉络的共同靶心。

type: cloze
tags: ML/Backprop ML/Optimizer ML/ResearchTaste
uuid: aac2751e-59a3-4d13-89ec-24a9fb9d1c16

---

## 研究品味（三）：边界步量纲检验与逐坐标经验信噪比（Kingma & Ba）

`Adam` 从零初值 $m_0 = 0, v_0 = 0$ 累积一阶矩 $m_t = \beta_1 m_{t-1} + (1-\beta_1) g_t$ 与二阶矩 $v_t = \beta_2 v_{t-1} + (1-\beta_2) g_t^2$。用研究者的“极端步检验”与“无量纲物理意义”审视该设计：

1. **冷启动零偏置与第 $1$ 步过冲定量验算**：在平稳二阶矩 $\sigma_{g,t}^2 = \mathbb{E}[g_t^2]$ 下展开有限等比级数得 $\mathbb{E}[v_t] =$ **{{c1::$\sigma_{g,t}^2 (1 - \beta_2^t)$}}**。由于标准超参 $\beta_2 = 0.999$ 比 $\beta_1 = 0.9$ 更接近 $1$，分母向零偏置远重于分子；若省去偏差修正，第 $t=1$ 步任意非零梯度 $g_1$ 产生的实际步幅倍率 $|m_1| / \sqrt{v_1} = \frac{1-\beta_1}{\sqrt{1-\beta_2}} \approx$ **{{c2::$3.162$}}**（若 $\beta_2 = 0.9999$ 则放大 $10$ 倍），极易在起步阶段引发参数更新过冲。
2. **逐坐标步长的统计语义**：分别除以 $(1-\beta_1^t)$ 与 $(1-\beta_2^t)$ 得到无偏估计后，更新核心 $\frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}$ 消去了梯度的绝对量纲，本质是每个参数坐标上的 **{{c3::经验梯度信噪比（SNR）}}**——梯度方向稳定时幅值接近 $1$，接近局部极值、小批量噪声正负抵消时 $\hat{m}_t \to 0$ 而 $\hat{v}_t > 0$，步幅在极值附近自动收缩退火。

Extra

研究品味启发（Takeaway for Research Taste）：养成对一切递推状态公式手算 $t=1$ 与 $t \to \infty$ 边界行为的肌肉记忆，并追问分母归一化后的无量纲物理含义。对比思考：为什么后文的 `Muon` 累积动量 $M_t = \mu M_{t-1} + G_t$ 既不乘 $(1-\mu)$ 也不做冷启动偏差修正？因为随后的 Frobenius 预归一化 $\tilde{M}_t / \|\tilde{M}_t\|_F$ 会把任意正标量常数分子分母精确约掉！

type: cloze
tags: ML/Optimizer ML/ResearchTaste
uuid: 3104e7fc-0cea-4c41-b654-851d9f180b44

---

Front

## 研究品味（四）：揪出模块化隐式耦合 Bug——为什么 Adam + L2 会让大梯度参数逃避衰减？（Loshchilov & Hutter）

由于纯 `SGD` 中把 $\lambda \theta_{t-1}$ 加进梯度与等比例权重衰减完全等价，早期框架直接将该实现搬进 `Adam`（方案 A），导致泛化性能明显弱于解耦后的 `AdamW`（方案 B）：

```python
# 方案 A：耦合 L2 正则化
g = grad + wd * param
param -= lr * m_hat / (v_hat.sqrt() + eps)

# 方案 B：AdamW 解耦权重衰减
param *= (1.0 - lr * wd)
param -= lr * m_hat / (v_hat.sqrt() + eps)
```

1. 对一般对称正定预条件更新 $\theta_t = \theta_{t-1} - \eta P^{-1} \nabla \tilde{L}(\theta_{t-1})$，要使其等价于均匀权重衰减 $(1 - w)\theta_{t-1}$，修改后的总损失正则项 $R(\theta)$ 必须满足什么方程？何时才等价于标准 $L_2$ 正则？
2. 方案 A 对不同梯度量级的参数造成了什么反直觉失真？这给你什么可迁移的研究品味启示？

Back

1. **二次正则不等价定理**：
   令 $\theta_{t-1} - \eta P^{-1}(\nabla L + \nabla R) = (1 - w)\theta_{t-1} - \eta P^{-1}\nabla L$，消去公共项并左乘 $P$ 立得 $\nabla R(\theta) = \frac{w}{\eta} P \theta$，即等效正则项变成了 **$R(\theta) = \frac{w}{2\eta}\theta^\top P \theta$**（若 $P_t$ 随历史梯度动态变化，甚至不存在与步数无关的固定函数 $R$）。它与各向同性高斯先验 $\frac{\lambda}{2}\|\theta\|_2^2$ 等价，**当且仅当预条件矩阵满足 $P = c I$**（如纯 `SGD`）。
2. **大梯度活跃参数逃避衰减**：
   在 `Adam` 中 $P_t = \mathrm{diag}(\sqrt{\hat{v}_t} + \epsilon)$。耦合进梯度的 $\lambda \theta_{t-1, i}$ 被除以 $\sqrt{\hat{v}_{t,i}}$，使第 $i$ 个坐标的实际衰减比例变成 $\frac{\eta \lambda}{\sqrt{\hat{v}_{t,i}} + \epsilon}$——**历史梯度越大的活跃参数（$\sqrt{\hat{v}_{t,i}} \gg 1$）几乎不受衰减约束**，而梯度微弱的参数反而被过度压缩，且 $\lambda\theta$ 还会混入并污染二阶矩统计。`AdamW` 将收缩步 $(1 - \eta \lambda)\theta_{t-1}$ 剥离出预条件器，恢复全体受衰减参数的等速率收缩与 $(\eta, \lambda)$ 超参解耦。
3. **研究品味启示（Takeaway for Research Taste）**：
   高度警惕**“旧底座等价写法在新底座下的隐式耦合陷阱”**——两个在各向同性欧氏空间（`SGD`）中完全等价的实现，一旦与非欧氏自适应度量（$P_t^{-1}$）组合，原本的代数消去关系就会失效；拼装两个独立有效模块时，必须写出联合更新方程验算交叉项。

type: basic
tags: ML/Optimizer ML/ResearchTaste
uuid: 63feb428-1356-4797-9f2b-c9a2c40fd477

---

## 研究品味（五）：把“选优化器”升维成“选算子空间的自然诱导范数”（Bernstein & Newhouse）

在范数球约束最速下降框架 $\Delta W^* = \mathrm{arg}\min_{\|\Delta W\| \le \eta} \langle \tilde{M}, \Delta W \rangle_F$ 下，Bernstein & Newhouse 揭示了一个极具品味的统一视角——**设计优化器本质上是为参数张量选择物理意义最匹配的范数尺子**：

1. **`AdamW` 的隐含几何局限（逐元素 $\ell_\infty$ 范数）**：关闭历史记忆时对应 $\|\Delta W\|_{\max} = \max_{i,j}|\Delta W_{i,j}| \le \eta$，最速下降解为 **{{c1::$-\eta\,\mathrm{sign}(G)$}}**。它把二维线性算子拆成孤立标量格，对正交换基不等变；更关键的是，当梯度被高频方向主导接近秩一外积 $u v^\top$ 时，$\mathrm{sign}(u v^\top) = \mathrm{sign}(u)\,\mathrm{sign}(v)^\top$ 依然退化为 **{{c1::秩为 $1$ 的矩阵}}**，逐格拉平了数值却抹平了微弱的正交特征子空间。
2. **`Muon` 的第一性原理解（$\mathrm{RMS} \to \mathrm{RMS}$ 诱导算子范数）**：紧接在 `RMSNorm` 后的隐藏线性层将单位 $\mathrm{RMS}$ 输入映射为输出，最自然的步长约束是“单位输入 $\mathrm{RMS}$ 所能引起的最大输出 $\mathrm{RMS}$ 变化”$\|\Delta W\|_{\mathrm{RMS}\to\mathrm{RMS}} = \sqrt{\frac{d_{\mathrm{in}}}{d_{\mathrm{out}}}}\,\sigma_1(\Delta W) \le \eta$；设动量精简 SVD 为 $\tilde{M} = U \Sigma V^\top$，精确最速下降解为：
$$
\Delta W^* = {{c2::-\eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}} \, U V^\top}}
$$
3. **全谱拉平与双边预条件化简统一**：半正交极因子 $U V^\top$（亦即单步无状态双边 `Shampoo` 预条件 $((G G^\top)^+)^{1/4} G ((G^\top G)^+)^{1/4}$ 的精确化简结果）将全部非零奇异值 $\sigma_1 \ge \dots \ge \sigma_r > 0$ **{{c3::统一归一化为 $1$}}**，使全部 $r$ 个正交特征子空间以相等步幅协同推进。

Extra

研究品味启发（Takeaway for Research Taste）：最高级的理论品味是用更本质的第一性原理消解复杂叙事——无需诉诸昂贵且脆弱的“近似二阶海森矩阵”，只要停止把二维权重压扁成一维长向量，承认它作为连接两个 RMS 归一化隐空间的“线性算子”身份，半正交极分解更新就会作为纯粹的一阶诱导范数最速下降解自然导出。

type: cloze
tags: ML/Optimizer ML/Muon ML/ResearchTaste
uuid: 80d4906e-7367-4247-86c1-a1159e9b550c

---

## 研究品味（六）：拒绝“一刀切”——用诱导范数划定 Muon 与 AdamW 的架构边界

拥有了强力的矩阵谱正交化算子后，为什么工业界标准方案绝不把同样是二维矩阵的词嵌入表 $E_{\mathrm{tok}} \in \mathbb{R}^{V \times D}$ 与分类头 $W_{\mathrm{head}} \in \mathbb{R}^{V \times D}$ 一并交给 `Muon`？用各层输入输出空间自身携带的诱导范数检验：

1. **入口词嵌入表（映射方向 $\ell_1 \to \mathrm{RMS}$）**：输入是满足 $\|u\|_1 = 1$ 的独热向量，凸函数在 $\ell_1$ 多面体球上的极值取在独热顶点处，导出 $\|\Delta E_{\mathrm{tok}}^\top\|_{\ell_1 \to \mathrm{RMS}} = \max_v \|\Delta E_{\mathrm{tok}}[v, :]\|_{\mathrm{RMS}}$——该范数在几何上 **{{c1::按词表的每一行完全解耦}}**；且单批次仅稀疏激活少量词行，若做全局谱正交化反而会把高频词与低频词子空间强行耦合串扰。
2. **出口分类头（映射方向 $\mathrm{RMS} \to \ell_\infty$）与一维缩放向量 $\gamma$**：Softmax 分布受最大打分分量 $\|z\|_\infty$ 控制，其诱导范数同样是按词表行解耦的混合范数；一维向量 $\gamma \in \mathbb{R}^D$ 秩上限为 $1$ 无多奇异值失衡。故入口表、出口头与一维参数统一保留给 **{{c2::AdamW}}**（仅占非词表主体参数 $95\%$ 以上的内部二维稠密层归 `Muon`）。
3. 补全参数分流代码中的路由判据（空 3）：

```python
muon_params, adamw_decay, adamw_nodecay = [], [], []
for name, p in model.named_parameters():
    is_embed_or_head = ("emb" in name) or ("lm_head" in name)
    if ____:  # [空 3]
        muon_params.append(p)
    elif p.ndim >= 2:
        adamw_decay.append(p)
    else:
        adamw_nodecay.append(p)
```

空 3 应填入：**{{c3::p.ndim == 2 and not is_embed_or_head}}**。

Extra

研究品味启发（Takeaway for Research Taste）：好品味意味着深刻理解方法的适用前提而非盲目推广“全网大一统”。判断一块二维数组该用什么优化器，看的不是表面形状 `p.ndim == 2`，而是它在前向传播中的算子契约——连续隐空间的稠密旋转归谱范数（`Muon`），离散词表的按行索引与间隔打分归逐坐标/逐行自适应（`AdamW`）。

type: cloze
tags: ML/Optimizer ML/Muon ML/LLM ML/ResearchTaste
uuid: 854f3e86-de4c-41a7-aecd-bb2f87bfa475

---

## 研究品味（七）：硬件协同与“用可控不精确换数量级加速”（Keller Jordan：NS5 极小极大系数）

精确 `torch.linalg.svd` 依赖 `float32` 串行双对角化，无法利用 GPU 半精度矩阵核心（Tensor Cores）。`Muon` 利用奇数次幂 $(X X^\top)^m X = U \Sigma^{2m+1} V^\top$ 严格保持左右奇异向量 $U, V^\top$ 不变的代数性质，改用 5 步 `bfloat16` 纯矩阵乘法迭代逼近 $U V^\top$：

```python
def zeropower_via_newtonschulz5(G, steps=5, eps=1e-7):
    a, b, c = (3.4445, -4.7750, 2.0315)
    X = G.bfloat16()
    X = ____  # [空 1]
    transposed = False
    if X.size(0) > X.size(1):
        X = X.T
        transposed = True
    for _ in range(steps):
        A = X @ X.T
        B = b * A + c * (A @ A)
        X = a * X + B @ X
    return X.T if transposed else X
```

1. **空 1（免求最大奇异值的收敛域压缩）**：五次多项式在 $\sigma > 1$ 外会迅速发散，迭代前必须执行 **{{c1::X / (X.norm() + eps)}}**——利用 $\|\tilde{M}\|_F = \sqrt{\sum \sigma_j^2} \ge \sigma_1$ 将全部初始奇异值安全压入 $[0, 1]$ 收敛区间。
2. **高瘦矩阵转置优化**：当行数大于列数（如升维层 $W_{\mathrm{up}}$ 为 $4D \times D$）时先转置，使格拉姆方阵 $A = X X^\top$ 的边长取短边 **{{c2::$\min(d_{\mathrm{out}}, d_{\mathrm{in}})$}}**（在 $4D \times D$ 上单步乘加量从 $96 D^3$ 骤降至 $9 D^3$，节省超 $90\%$ 算力）。
3. **极小极大系数的品味权衡**：在 $\sigma=1$ 处精确三阶相切的经典系数 $(1.875, -1.25, 0.375)$ 跑 5 步对微小奇异值放大上限仅 $1.875^5 \approx 23.2$ 倍；`Muon` 主动放弃 $\varphi(1) = 1$ 的精确不动点（实算 $\varphi(1) = 0.701$，容忍稳态奇异值在 $[0.68, 1.20]$ 窄带温和波动），换取原点斜率 $a = 3.4445$ 在 5 步内高达 $3.4445^5 \approx$ **{{c3::$484$}}** 倍的尾部微弱奇异值拉升能力！

Extra

研究品味启发（Takeaway for Research Taste）：算法与硬件协同设计的教科书范例——先洞察在仅有 7 位尾数的 `bfloat16` 随机梯度训练中“把奇异值算准到 $1.000000$ 毫无收益，在固定 5 步预算内把 $\sigma_0 \sim 10^{-2}$ 的尾部方向拉起来才是关键”，再用切比雪夫式等波纹折中换取 $20.9$ 倍的尾部放大增益，且全程只跑 Tensor Cores 最擅长的稠密 GEMM。

type: cloze
tags: ML/Optimizer ML/Muon ML/Numerical ML/ResearchTaste
uuid: 35426eff-4fad-4be0-9ab6-b2fcb2ee2c26

---

## 研究品味（八）：规模化迁移品味——更新 RMS 不变量对齐与 Roofline 全局算力账（Moonshot AI）

将原版 `Muon` 推向百亿参数大模型长周期预训练时，月之暗面团队解决了“跨规模超参迁移”“后期权重范数膨胀”与“硬件真实开销核算”三个关键工程问题：

1. **对齐单元素 Update RMS 以直接复用 `AdamW` 超参**：满秩近似半正交阵 $O_t \in \mathbb{R}^{A \times B}$ 满足 $\|O_t\|_F^2 \approx \min(A, B)$，均摊到 $A B$ 个元素上的单元素更新均方根为 $\mathrm{RMS}(O_t) \approx$ **{{c1::$1 / \sqrt{\max(A, B)}$}}**（随隐藏维变宽而按反根号缩小）；而成熟 `AdamW`（$\beta_1 = 0.9$）在稳态随机梯度下的单元素无量纲更新 $\mathrm{RMS}$ 约为 $\sqrt{\frac{1-\beta_1}{1+\beta_1}} \approx 0.229$（实测稳定在 $0.2$ 附近）。乘上补偿因子并引入解耦权重衰减即得规模化统一更新式：
$$
W_t = {{c2::(1 - \eta \lambda) W_{t-1} - \eta \cdot 0.2\sqrt{\max(A, B)} \, O_t}}
$$
2. **为什么长训必须补上解耦衰减 $(1 - \eta\lambda)$**：若 $\lambda = 0$，后期噪声梯度产生的正二次项 $\|\Delta_t\|_F^2$ 会无阻尼持续累加，导致隐藏层权重模长 $\|W_t\|_F$ 单调膨胀并引发注意力打分饱和溢出；加入解耦衰减后收敛于有界平衡态 $\mathrm{RMS}(W_{\mathrm{eq}}) \approx \sqrt{0.02\eta/\lambda}$。
3. **用批词元数 $N_{\mathrm{tok}}$ 算清 Roofline 大账**：`Muon` 省去了内部二维层的整张二阶矩 $V$ 表（优化器状态显存减半）；虽然单层多做 5 轮矩阵乘（$\le 30 \min(A,B) A B$ FLOPs），但与该层单步前反向主干算力 $6 N_{\mathrm{tok}} A B$ 相比，额外 FLOPs 占比上界仅为 **{{c3::$\frac{5 \min(A, B)}{N_{\mathrm{tok}}}$}}**——在预训练百万级批词元数 $N_{\mathrm{tok}} \sim 10^6$ 下仅占 **$0.5\% \sim 2\%$**！

Extra

研究品味启发（Takeaway for Research Taste）：规模化研究的品味体现在两处——① 抓住跨模型宽度的统计不变量（单元素 Update RMS $\approx 0.2$），让新优化器与负责边界层的 `AdamW` 无缝共用同一套学习率调度器与衰减率，消灭百亿级重调参成本；② 评估计算开销永远要有“分母意识”与 Roofline 视角，脱离全局批词元数 $N_{\mathrm{tok}}$ 单看参数矩阵自乘次数会严重误判系统真实代价。

type: cloze
tags: ML/Optimizer ML/Muon ML/Systems ML/ResearchTaste
uuid: 3c9eb912-bea1-46f1-9f2b-c65e7b866c00
