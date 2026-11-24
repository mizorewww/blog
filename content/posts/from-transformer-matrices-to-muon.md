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

在深度学习课程与工程代码之间，常常存在一道明显的衔接断层。讲述网络结构（如 Transformer[@vaswani2017]）的教材围绕三维激活张量、多头子空间投影与注意力矩阵展开；而讲述优化算法（如 SGD[@robbins1951]、AdamW[@loshchilov2019]）的章节，又往往把全体参数简化为一个抽象的一维向量 $\theta \in \mathbb{R}^p$，在二次曲面上讨论标量坐标的迭代。

当读者真正打开一份大语言模型的预训练代码时，这两套叙述之间的衔接落差会具体体现为显存分类、计算形态、反向传播外积结构与二维算子更新等一系列环环相扣的疑问。本文沿着一条自底向上的连续推导脉络，把这些分散在不同教材中的拼图逐一对齐并严格导出。

## 五个核心追问与全文推导脉络

具体而言，全文围绕以下五个首尾相接的问题展开：

1. 显存中同时存在着词嵌入表、$Q/K/V$ 投影权重、$T \times T$ 注意力分数表、`KV Cache`、梯度张量以及动量缓冲区，这些统称为“矩阵”的对象各自承担什么数学职责，哪些属于模型本身，哪些只在推理或训练阶段短暂存在？
2. 聊天推理是逐词串行生成的，为什么训练代码里没有逐词循环，而是把整段序列一次性送入网络？为什么同一座模型开启训练所需的显存会比推理高出数倍？
3. 损失函数输出的只是一个标量 $L \in \mathbb{R}$，反向传播 `loss.backward()` 通过怎样的代数运算，为每一块二维权重矩阵 $W$ 算出形状一致的梯度矩阵 $G$？这个梯度矩阵本身的奇异值分布有什么结构特征？
4. 从 `SGD`、`Momentum`、`Adam` 到 `AdamW`，每一代更新公式分别针对前一代的哪一个数学局限提出，偏差修正项与解耦权重衰减各自如何严格导出？
5. 当参数本身是形如 $d_{\mathrm{out}} \times d_{\mathrm{in}}$ 的二维线性算子时，逐元素自适应方法忽略了什么几何结构？新一代矩阵优化器 `Muon`[@jordan2024][@liu2025] 如何从算子诱导范数自然推导出半正交更新方向 $U V^\top$，又如何仅用 5 次半精度矩阵乘法替代奇异值分解？

本文沿着一条连续的推导脉络回答上述问题。全文首先从自回归概率分解出发，把模型在推理与训练中涉及的全部张量按生命周期归入四类；接着推演单步训练的前向与反向传播方程，揭示线性层梯度矩阵的外积结构；随后在“局部线性化 + 邻近惩罚或范数球约束”这一统一的变分框架下，依次完成从标量逐元素优化器（`SGD` $\to$ `Momentum` $\to$ `Adam` $\to$ `AdamW`）到二维算子谱范数优化器（`Shampoo` $\to$ `Muon` $\to$ 月之暗面规模化方案）的完整数学推导；最后结合 GPU 算术强度分析、受控实验数据与一份单文件可运行的 PyTorch 实现完成闭环。

## 全局鸟瞰：先在一张图上看清模型、推理、训练与优化器的关系

在展开任何局部公式之前，不妨先建立一幅全局心智地图。一座大语言模型的本体，仅仅是一组形状固定、持久化在磁盘与显存中的**静态参数矩阵 $\Theta$**（包括首尾负责词表转换的 $E_{\mathrm{tok}}, W_{\mathrm{head}}$，以及中间堆叠 $L$ 层的二维线性变换 $W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}$ 与一维缩放向量 $\gamma$）。围绕同一组参数 $\Theta$，**推理**与**训练**是两条截然不同的数据流：

- **推理是只读的单向流水线**（下文第 1 节）：参数 $\Theta$ 全程冻结不变。输入提示词先经 `Prefill` 阶段做整段矩阵乘法并把历史键值存入 `KV Cache`；随后 `Decode` 阶段每步只送入 1 行新词向量做向量乘矩阵，逐词采样生成回复，算完的中间激活当场释放。
- **训练是改写参数的四步闭环**（下文第 2–5 节）：为了把预测误差反传回每一层，训练在 **① 前向并行（Forward）** 时必须把各层中间激活 $X$ 暂存在显存中；经 **② 交叉熵损失（Loss）** 汇总为单个标量 $L$ 后，**③ 反向传播（Backward）** 通过链式法则矩阵乘 $G = \Delta^\top X$ 将样本词元维求和消去，为每一块参数算出形状完全一致的梯度矩阵 $G$；最后在 **④ 优化器更新（Optimizer Step）** 中，算法结合梯度 $G$ 与历史状态改写 $\Theta$——其中首尾查表打分层交由逐元素自适应的 `AdamW`（第 3 节），占非词表参数 $95\%$ 以上的内部二维线性算子则交由算子谱正交化的 `Muon`（第 4–5 节）。

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

设词表 $\mathcal{V} = \{0, 1, \dots, V-1\}$ 包含 $V$ 个离散词元（Token）。给定一段长度为 $T$ 的词元序列 $x_{1:T} = (x_1, x_2, \dots, x_T) \in \mathcal{V}^T$，概率论的乘法链式法则允许在不引入任何近似假设的前提下，将整段序列的联合概率严格分解为每一步给定前文预测下一词的条件概率连乘积：

$$
p_\Theta(x_1, x_2, \dots, x_T) = \prod_{t=1}^{T} p_\Theta(x_t \mid x_1, \dots, x_{t-1})
$$

其中 $\Theta$ 表示模型中全体可学习参数的集合。大语言模型的建模目标，就是构造一个由 $\Theta$ 参数化的函数，接收前缀序列 $x_{1:t}$，输出词表上全部 $V$ 个候选词作为下一词 $x_{t+1}$ 的未归一化对数打分向量（称为 Logits）$z_t \in \mathbb{R}^V$，再经由 Softmax 映射为合法的概率分布：

$$
p_\Theta(x_{t+1} = k \mid x_{1:t}) = \frac{\exp(z_{t,k})}{\sum_{m=0}^{V-1} \exp(z_{t,m})}, \qquad k \in \{0, \dots, V-1\}
$$

由于离散整数编号本身只代表字典序号（编号 `500` 并不代表编号 `250` 的两倍），微积分中的导数无法直接作用在整数上。因此，网络的第一步是引入一张词嵌入矩阵 $E_{\mathrm{tok}} \in \mathbb{R}^{V \times D}$，将每个离散编号 $x_t$ 映射为连续实数空间 $\mathbb{R}^D$ 中的第 $x_t$ 行向量。若用 $u_{x_t} \in \{0,1\}^V$ 表示仅第 $x_t$ 个分量为 $1$ 的独热（One-Hot）列向量，则按行查表在代数上等价于一次稀疏矩阵乘法 $u_{x_t}^\top E_{\mathrm{tok}} \in \mathbb{R}^{1 \times D}$。

对于长度为 $T$ 的输入序列，仅有词向量查表还不够：后续自注意力中的向量内积本身对词序满足置换等变性（若不加位置信息，调换“猫追狗”与“狗追猫”的词序只会调换对应输出行而算不出语义区别）。因此需要加上编码绝对或相对座位顺序的位置表示 $E_{\mathrm{pos}} \in \mathbb{R}^{T \times D}$，得到初始状态矩阵 $X^{(0)} \in \mathbb{R}^{T \times D}$（当同时处理 $B$ 条序列时，叠成三维张量 $\mathbb{R}^{B \times T \times D}$）。此后每一层计算出的增量都会通过加法 $X \leftarrow X + \mathrm{Sublayer}(X)$ 累加回这条贯通首尾的主干张量上，故该主干通常称为**残差流（Residual Stream）**。

### 1.2 单层 Transformer 的前向方程

现代主流开源大模型（如 Llama、Qwen、DeepSeek 系列）普遍采用无偏置的 Pre-RMSNorm 解码器结构[@vaswani2017][@zhang2019]。以单条长度为 $T$、隐藏维度为 $D$ 的残差流矩阵 $X \in \mathbb{R}^{T \times D}$ 为例，先定义逐行作用的均方根归一化算子 $\mathrm{RMSNorm}$：对行向量 $x \in \mathbb{R}^D$，令 $\mathrm{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{D}\sum_{i=1}^D x_i^2 + \epsilon}} \odot \gamma$，其中 $\epsilon > 0$ 为防除零小常数，$\gamma \in \mathbb{R}^D$ 为可学习通道缩放向量，$\odot$ 表示按对应坐标相乘的逐元素乘积（Hadamard Product，其反向性质将在 2.1 节推导）。在此基础上，流经一层 Transformer 包含两个子层：

**第一子层：多头因果自注意力（Multi-Head Causal Self-Attention）。** 先对残差流逐行做归一化 $H = \mathrm{RMSNorm}(X) \in \mathbb{R}^{T \times D}$，再用三块线性投影矩阵生成查询（Query）、键（Key）和值（Value）：

$$
Q = H W_q^\top, \qquad K = H W_k^\top, \qquad V_{\mathrm{val}} = H W_v^\top
$$

这里 $W_q, W_k, W_v \in \mathbb{R}^{D \times D}$。若直接在整个 $D$ 维空间上只算一次内积，每个词元每一步只能生成一组标量注意力权重，难以同时兼顾“指代消解”“句法修饰”与“邻近词搭配”等多种关系。因此，模型将隐藏维 $D$ 均分为 $H_{\mathrm{head}}$ 个并行的低维子空间（称为注意力头），每个子空间宽度为 $d_k = D / H_{\mathrm{head}}$。在批量处理 $B$ 条序列的代码中，形状为 $(B, T, D)$ 的张量先重排为 $(B, T, H_{\mathrm{head}}, d_k)$，再交换中间两维得到四维张量 $(B, H_{\mathrm{head}}, T, d_k)$。对单条样本第 $h$ 个头的切片 $Q^{(h)}, K^{(h)}, V_{\mathrm{val}}^{(h)} \in \mathbb{R}^{T \times d_k}$，计算带因果掩码的缩放点积注意力：

$$
S^{(h)} = \frac{Q^{(h)} \bigl(K^{(h)}\bigr)^\top}{\sqrt{d_k}} + M_{\mathrm{causal}}, \qquad P^{(h)} = \mathrm{softmax}\!\left(S^{(h)}\right), \qquad O^{(h)} = P^{(h)} V_{\mathrm{val}}^{(h)}
$$

其中注意力分数矩阵 $S^{(h)}$ 与注意力概率矩阵 $P^{(h)}$ 的形状均为 $T \times T$；因果掩码 $M_{\mathrm{causal}} \in \{0, -\infty\}^{T \times T}$ 在主对角线及以下位置（$i \ge j$）取 $0$，在主对角线以上位置（$i < j$，即第 $i$ 个词试图读取未来第 $j$ 个词）取 $-\infty$。由于 $\exp(-\infty) = 0$，经过按行 Softmax 后，$P^{(h)}$ 严格成为下三角随机矩阵，保证第 $i$ 行的输出只依赖前 $i$ 个位置的信息。

为什么要除以缩放因子 $\sqrt{d_k}$？假设查询向量 $q \in \mathbb{R}^{d_k}$ 与键向量 $k \in \mathbb{R}^{d_k}$ 的各个分量相互独立，均值为 $0$、方差为 $1$，则单项乘积满足 $\mathbb{E}[q_m k_m] = 0$ 且 $\mathrm{Var}(q_m k_m) = \mathbb{E}[q_m^2]\mathbb{E}[k_m^2] - 0 = 1$，整个内积的方差为：

$$
\mathrm{Var}(q^\top k) = \sum_{m=1}^{d_k} \mathrm{Var}(q_m k_m) = d_k
$$

若不除以 $\sqrt{d_k}$，当 $d_k = 64$ 或 $128$ 时，内积的标准差会增大至 $8 \sim 11.3$，导致同一行中的最大值远超其余元素，Softmax 输出 $P_{i,a} = e^{S_{i,a}} / \sum_c e^{S_{i,c}}$ 趋近于某一项为 $1$、其余为 $0$ 的退化分布。直接对商式求偏导可知，Softmax 的局部导数为 $\partial P_{i,a} / \partial S_{i,b} = P_{i,a}(\delta_{ab} - P_{i,b})$（其中克罗内克符号 $\delta_{ab}$ 在 $a=b$ 时取 $1$，否则取 $0$）；一旦分布退化为 $0$ 或 $1$，无论 $a=b$ 还是 $a \neq b$，该导数均趋于 $0$，反向传播经过注意力权重的梯度便会消失[@vaswani2017]。除以 $\sqrt{d_k}$ 恰好把内积方差重新归一为 $1$。

将全部 $H_{\mathrm{head}}$ 个头的输出沿最后一维拼接回 $O = [O^{(1)}, \dots, O^{(H_{\mathrm{head}})}] \in \mathbb{R}^{T \times D}$，右乘输出投影矩阵 $W_o^\top$（$W_o \in \mathbb{R}^{D \times D}$）并加回残差支路，得到 $X' = X + O W_o^\top$。

**第二子层：位置前馈网络（Position-wise FFN / MLP）。** 再次做归一化 $H' = \mathrm{RMSNorm}(X')$，经升维矩阵 $W_{\mathrm{up}} \in \mathbb{R}^{d_{\mathrm{ff}} \times D}$（经典设定 $d_{\mathrm{ff}} = 4D$）、逐元素非线性激活函数 $\sigma(\cdot)$（如 $\mathrm{SiLU}(z) = z / (1 + e^{-z})$）以及降维矩阵 $W_{\mathrm{down}} \in \mathbb{R}^{D \times d_{\mathrm{ff}}}$ 变换后加回残差流：

$$
X_{\mathrm{out}} = X' + \sigma(H' W_{\mathrm{up}}^\top) W_{\mathrm{down}}^\top
$$

全部 $L$ 层堆叠完毕后，末端归一化输出右乘词表分类头 $W_{\mathrm{head}}^\top$（$W_{\mathrm{head}} \in \mathbb{R}^{V \times D}$），即得到全序列的预测打分矩阵 $Z \in \mathbb{R}^{T \times V}$。

> **关于 PyTorch `nn.Linear` 权重形状的说明**：在代码中调用 `nn.Linear(in_features=64, out_features=256, bias=False)` 时，其内部参数 `.weight` 的实际存储形状是反过来的 `(256, 64)`，即 $(d_{\mathrm{out}}, d_{\mathrm{in}})$，前向计算执行 $H W^\top$。这样设计是因为 C/CUDA 数组默认按行连续（Row-Major）存储：把每个输出神经元对应的 $d_{\mathrm{in}}$ 个权重排成连续的一行，计算内积时就能顺着内存地址连续读取。后文讨论任意二维权重矩阵 $W \in \mathbb{R}^{A \times B}$ 时，始终与 PyTorch 内存布局保持一致，记行数为 $A = d_{\mathrm{out}}$、列数为 $B = d_{\mathrm{in}}$。

### 1.3 显存中的四类张量家族

审视上面这一组完整的前向方程，所有出现的二维与高维数组虽然在口语里常被混称为“矩阵”，但按其数学定义、形状依赖关系与存活周期，可以严格划分为四类：

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

在初学阶段，最容易混淆的一对概念是**投影权重 $W_q, W_k \in \mathbb{R}^{D \times D}$** 与**注意力概率矩阵 $P \in \mathbb{R}^{T \times T}$**。前者属于第一类静态参数，无论输入是 4 个词还是 4096 个词，其尺寸恒为 $D \times D$，优化器在训练中真正修改的正是这类投影矩阵；后者属于第二类动态激活，尺寸随当前句子的词元数 $T$ 伸缩，只是当前句子内部各位置相关性的一次性中间计算结果，既不写入模型权重文件，也不会被优化器直接更新。

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

理解四类张量的另一个关键，是从因果掩码 $M_{\mathrm{causal}}$ 的下三角结构推导出**推理两阶段（Prefill 与 Decode）**和**训练并行（Teacher Forcing）**的计算差异。

先看**推理阶段**。推理时未来词元尚未生成，模型只能根据用户输入的前缀 $x_{1:T_0}$ 先预测 $x_{T_0+1}$，再把预测出的 $x_{T_0+1}$ 拼回末尾预测 $x_{T_0+2}$。

1. **预填充阶段（Prefill）**：处理长度为 $T_0$ 的初始前缀时，$T_0$ 个词元同时已知，输入激活矩阵 $H \in \mathbb{R}^{T_0 \times D}$ 与权重 $W^\top \in \mathbb{R}^{D \times D}$ 执行通用矩阵乘法（GEMM），一次性算出前 $T_0$ 个位置的键矩阵 $K_{1:T_0}$ 与值矩阵 $V_{1:T_0}$，并取第 $T_0$ 行的输出分布采样出第一个新词 $x_{T_0+1}$。
2. **自回归解码阶段（Decode）与冗余分析**：当第 $t$ 步已经拥有序列 $x_{1:t}$、准备生成 $x_{t+1}$ 时，如果把整段 $x_{1:t}$ 重新送入网络计算，由于每一层的因果掩码严格禁止前 $t-1$ 个位置读取第 $t$ 个位置的信息，前 $t-1$ 行的隐状态 $h_1, \dots, h_{t-1}$ 以及它们投影出的键向量 $k_1, \dots, k_{t-1}$、值向量 $v_1, \dots, v_{t-1}$，**与上一步算过的结果逐位相等**。同时，为了预测 $x_{t+1}$，我们只需要最后一行隐状态 $o_t$：

$$
o_t^{(h)} = \sum_{j=1}^{t} P_{t,j}^{(h)} v_j^{(h)}, \qquad P_{t, :}^{(h)} = \mathrm{softmax}\!\left(\frac{q_t^{(h)} K_{1:t}^{(h)\top}}{\sqrt{d_k}}\right) \in \mathbb{R}^{1 \times t}
$$

上式无需计算前 $t-1$ 行的查询 $q_1, \dots, q_{t-1}$，也无需构造完整的 $t \times t$ 注意力方阵。只要把历史步骤算好的 $K_{1:t-1}$ 与 $V_{1:t-1}$ 缓存在显存中（即 `KV Cache`），第 $t$ 步只需输入单行新词表示 $h_t \in \mathbb{R}^{1 \times D}$，通过向量乘矩阵（GEMV）算出单个 $q_t, k_t, v_t$，将 $k_t, v_t$ 追加到缓存末尾得到 $K_{1:t}, V_{1:t}$，再做一次 $(1, d_k) \times (d_k, t)$ 乘法即可。

我们可以定量对比两者的乘加运算次数（MACs，1 次乘加对应 2 次浮点运算 FLOPs）。忽略低阶项，在单层隐藏维 $D$ 上：若不使用 `KV Cache`，在序列长度为 $t$ 时重算整句线性投影需 $\mathcal{O}(t D^2)$、注意力需 $\mathcal{O}(t^2 D)$，从初始前缀 $T_0$ 连续评估至序列长 $N$ 的累计开销为 $\sum_{t=T_0}^N \mathcal{O}(t D^2 + t^2 D) = \mathcal{O}(N^2 D^2 + N^3 D)$；启用 `KV Cache` 后，每一步仅对单个新词做投影 $\mathcal{O}(D^2)$ 与缓存内积 $\mathcal{O}(t D)$，累计开销降为 $\mathcal{O}(N D^2 + N^2 D)$。

再看**训练阶段**。训练时语料库中的完整真实序列 $x_{1:T+1}$ 已经事先给定。我们把前 $T$ 个词 $x_{1:T}$ 作为输入，后移一位的 $x_{2:T+1}$ 作为监督目标（称为 **Teacher Forcing**）。由于因果掩码 $M_{\mathrm{causal}}$ 已经在矩阵内部阻断了第 $t$ 行对第 $j > t$ 列的访问，一次 $(B, T, D) \times (D, D)$ 的大矩阵乘法，就在数学上严格等价于同时独立运行了 $B \times T$ 个不同前缀长度的下一词预测任务，既充分利用了 GPU 的并行矩阵算力，又不需要分配 `KV Cache`。

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

下面两组实测图定量展示了上述机制在张量字节与算力上的差异。在第一张图的 6 层 `float32` 模型（$V=2000, D=256, L=6$）中，单参数占 4 字节：静态参数共约 $5.82 \times 10^6$ 个（嵌入与分类头约 $1.04 \times 10^6$ 个，6 层内部二维权重约 $4.72 \times 10^6$ 个），对应权重显存 $22.2\;\text{MB}$；训练时 $B=16, T=64$ 的 6 层前向中间激活（含多头 $Q,K,V$、注意力矩阵与前馈升维激活）合计占去 $103.8\;\text{MB}$；而在 `Muon+AdamW` 模式下，内部二维层省去了二阶矩 $V$，仅保留词嵌入、分类头与归一化层的二阶矩（约 $1.05 \times 10^6 \times 4\;\text{B} \approx 4.2\;\text{MB}$）。第二张图记录了 4 层模型从 $t=8$（`Prefill`）逐词评估至 $t=120$（共 112 步 `Decode`，生成至第 121 个词）时的累计乘加次数对比。

```echarts title="6 层 Transformer 在推理与三种优化器训练模式下的显存构成对比" height="360" note="基于 6 层 Transformer（词表 $V=2000$，$D=256$，8 头，fp32，批大小 $B=16$，句长 $T=64$）实测张量字节。训练模式下需保留中间激活并分配梯度 $G$ 与状态张量；Muon+AdamW 省去了全部内部二维层的二阶矩 $V$（仅边界层保留 4.2 MB）。"
{"tooltip":{"trigger":"axis","axisPointer":{"type":"shadow"},"valueFormatter":"{value} MB"},"legend":{},"grid":{"top":68,"left":56,"right":16,"bottom":32},"xAxis":{"type":"category","axisLabel":{"interval":0},"data":["推理","纯 SGD","AdamW","Muon+AdamW"]},"yAxis":{"type":"value","max":210,"axisLabel":{"formatter":"{value}M"}},"series":[{"name":"静态权重 W","type":"bar","stack":"vram","itemStyle":{"color":"var(--blue)"},"data":[22.2,22.2,22.2,22.2]},{"name":"KV Cache","type":"bar","stack":"vram","itemStyle":{"color":"var(--sky)"},"data":[12.0,0.0,0.0,0.0]},{"name":"梯度 G","type":"bar","stack":"vram","itemStyle":{"color":"var(--orange)"},"data":[0.0,22.2,22.2,22.2]},{"name":"动量 M","type":"bar","stack":"vram","itemStyle":{"color":"var(--violet)"},"data":[0.0,0.0,22.2,22.2]},{"name":"二阶矩 V","type":"bar","stack":"vram","itemStyle":{"color":"var(--clay)"},"data":[0.0,0.0,22.2,4.2]},{"name":"前向激活","type":"bar","stack":"vram","itemStyle":{"color":"var(--teal)"},"data":[0.2,103.8,103.8,103.8]}]}
```

```plot title="自回归解码从前缀 8 词推进至长度 120：KV Cache 将累计乘加降为近似线性" note="4 层 Transformer（$D=128$，词表 $V=512$），初始前缀长度 $T_0=8$（Prefill），随后从 $t=9$ 至 $t=120$ 连续执行 112 步自回归解码。累计乘加次数从 6,758.5M 降至 109.7M（减少 98.4%）。"
{"xlabel":"当前输入序列长度 $t$（$t=8$ 完成 Prefill，随后 $t=9 \\dots 120$ 连续解码 112 步）","legend":[{"label":"无 KV Cache（每步重算整句 $\\mathcal{O}(t D^2 + t^2 D)$）","color":"var(--clay)","shape":"dash"},{"label":"启用 KV Cache（每步仅算新词 $\\mathcal{O}(D^2 + t D)$）","color":"var(--teal)","shape":"line"},{"label":"避免的 98.4% 重复计算量","color":"var(--clay)","shape":"band"}],"data":{"kv":[{"t":8,"no_cache":6.9,"kv_cache":6.9},{"t":12,"no_cache":43.1,"kv_cache":10.3},{"t":16,"no_cache":93.4,"kv_cache":13.8},{"t":20,"no_cache":157.9,"kv_cache":17.3},{"t":24,"no_cache":236.6,"kv_cache":20.8},{"t":28,"no_cache":329.8,"kv_cache":24.3},{"t":32,"no_cache":437.6,"kv_cache":27.8},{"t":36,"no_cache":560.0,"kv_cache":31.4},{"t":40,"no_cache":697.3,"kv_cache":34.9},{"t":44,"no_cache":849.5,"kv_cache":38.5},{"t":48,"no_cache":1016.9,"kv_cache":42.1},{"t":52,"no_cache":1199.4,"kv_cache":45.7},{"t":56,"no_cache":1397.3,"kv_cache":49.4},{"t":60,"no_cache":1610.7,"kv_cache":53.0},{"t":64,"no_cache":1839.7,"kv_cache":56.7},{"t":68,"no_cache":2084.4,"kv_cache":60.4},{"t":72,"no_cache":2345.0,"kv_cache":64.1},{"t":76,"no_cache":2621.7,"kv_cache":67.8},{"t":80,"no_cache":2914.4,"kv_cache":71.5},{"t":84,"no_cache":3223.5,"kv_cache":75.2},{"t":88,"no_cache":3548.9,"kv_cache":79.0},{"t":92,"no_cache":3890.9,"kv_cache":82.8},{"t":96,"no_cache":4249.5,"kv_cache":86.6},{"t":100,"no_cache":4624.9,"kv_cache":90.4},{"t":104,"no_cache":5017.3,"kv_cache":94.2},{"t":108,"no_cache":5426.7,"kv_cache":98.1},{"t":112,"no_cache":5853.2,"kv_cache":101.9},{"t":116,"no_cache":6297.2,"kv_cache":105.8},{"t":120,"no_cache":6758.5,"kv_cache":109.7}]},"height":290,"narrowHeight":240,"y":{"label":"累计矩阵乘加次数（百万 MACs）","domain":[0,7300]},"x":{"label":null,"domain":[8,122]},"grid":true,"marks":[{"mark":"areaY","data":"kv","x":"t","y1":"kv_cache","y2":"no_cache","fill":"var(--clay)","fillOpacity":0.12},{"mark":"ruleX","data":[8],"stroke":"var(--stone)","strokeDasharray":"4 3"},{"mark":"line","data":"kv","x":"t","y":"no_cache","stroke":"var(--clay)","strokeWidth":2.2,"strokeDasharray":"6 4"},{"mark":"line","data":"kv","x":"t","y":"kv_cache","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":"kv","x":"t","y":"no_cache","fill":"var(--clay)","r":2.5,"tip":["t","no_cache","kv_cache"]},{"mark":"text","data":[{"t":10,"y":5600,"txt":"← Prefill 结束 (t=8)"}],"x":"t","y":"y","text":"txt","textAnchor":"start","fill":"var(--muted)"},{"mark":"text","data":[{"t":108,"y":6650,"txt":"6,759M"}],"x":"t","y":"y","text":"txt","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"t":116,"y":520,"txt":"110M (-98.4%)"}],"x":"t","y":"y","text":"txt","textAnchor":"end","fill":"var(--teal)"}]}
```

在明确“优化器只作用在第一类静态参数 $\Theta$ 上”之后，下一个需要解决的问题是：每一轮迭代中，指导参数更新的梯度矩阵 $G$ 是如何从标量损失一步步算出来的？

---

## 二、归一化尺度不变性与矩阵反向传播推导

在展开优化器公式之前，我们先把一个训练步（Step）内部的微积分过程完整推导清楚。这一节不仅解释为什么训练显存会被中间激活占据，还会直接导出两个贯穿后文的底层性质：**`RMSNorm` 对特征尺度的约束**，以及**线性层梯度矩阵 $G$ 的秩一外积求和结构**。

### 2.1 `RMSNorm` 的由来与梯度正交性质推导

早期 Transformer 采用 `LayerNorm`：对单个词向量 $x \in \mathbb{R}^D$，先计算均值 $\mu = \frac{1}{D}\sum_{i=1}^D x_i$，再计算方差 $\sigma^2 = \frac{1}{D}\sum_{i=1}^D (x_i - \mu)^2$，最后输出 $\frac{x - \mu}{\sqrt{\sigma^2 + \epsilon}} \odot \gamma + \beta$。在 GPU 硬件上，由于方差依赖均值，每个向量必须做两趟跨通道归约（Reduction），访存延迟显著高于算术耗时。

2019 年，Zhang 与 Sennrich 提出假设：`LayerNorm` 稳定深层训练的核心机制并非“减去均值（平移不变性）”，而是“除以向量幅度（缩放不变性）”[@zhang2019]。去掉均值中心化与偏置 $\beta$ 后，就得到均方根层归一化（`RMSNorm`）：

$$
r(x) = \sqrt{\frac{1}{D} \sum_{i=1}^{D} x_i^2 + \epsilon}, \qquad y = \mathrm{RMSNorm}(x) = \frac{x}{r(x)} \odot \gamma = \hat{x} \odot \gamma
$$

其中 $\gamma \in \mathbb{R}^D$ 是初始化为全 $1$ 的可学习通道缩放向量。我们可以从两个角度直接推导它的数学作用：

1. **前向输出均方根归一**：当 $\epsilon \to 0$ 且 $\gamma = \mathbf{1}$ 时，输出向量 $\hat{x} = x / r(x)$ 满足 $\frac{1}{D}\|\hat{x}\|_2^2 = \frac{\frac{1}{D}\|x\|_2^2}{\frac{1}{D}\|x\|_2^2} = 1$。这意味着紧接在 `RMSNorm` 之后的线性层 $W$，接收到的输入向量在均方根意义下始终处于单位尺度附近——这一事实将在第四节直接决定衡量权重更新 $\Delta W$ 所需的算子范数。
2. **反向梯度的尺度反比缩放与径向正交性**：令 $\epsilon = 0$，对任意正实数 $\alpha > 0$，有 $\mathrm{RMSNorm}(\alpha x) = \frac{\alpha x}{\alpha r(x)} \odot \gamma = \mathrm{RMSNorm}(x)$。设后续网络损失为 $L(y)$，上游传对 $y$ 的导数为 $\delta_y = \partial L / \partial y \in \mathbb{R}^D$，令 $\tilde{\delta} = \delta_y \odot \gamma$。对第 $j$ 个输入分量求偏导（注意 $\partial r / \partial x_j = \frac{x_j}{D r}$）：

$$
\frac{\partial L}{\partial x_j} = \sum_{i=1}^{D} \tilde{\delta}_i \frac{\partial}{\partial x_j}\left(\frac{x_i}{r}\right) = \frac{\tilde{\delta}_j}{r} - \sum_{i=1}^{D} \tilde{\delta}_i \frac{x_i x_j}{D r^3} = \frac{1}{r}\left(\tilde{\delta}_j - \hat{x}_j \cdot \frac{1}{D}\langle \tilde{\delta}, \hat{x} \rangle\right)
$$

写成向量形式即为：

$$
\nabla_x L = \frac{1}{r(x)}\left(I_D - \frac{\hat{x} \hat{x}^\top}{D}\right) \tilde{\delta}, \qquad \nabla_\gamma L = \delta_y \odot \hat{x}
$$

由于 $\frac{1}{D}\hat{x}^\top \hat{x} = 1$，把 $x^\top = r(x)\hat{x}^\top$ 左乘到 $\nabla_x L$ 上立得：

$$
x^\top \nabla_x L = \hat{x}^\top \tilde{\delta} - \frac{\hat{x}^\top \hat{x}}{D} \hat{x}^\top \tilde{\delta} = 0
$$

这说明反传回输入 $x$ 的梯度严格正交于 $x$ 本身（即沿单纯拉长或缩短 $x$ 模长的方向导数恒为零），且与输入尺度 $r(x)$ 成反比：即便某层特征整体放大了 $\alpha$ 倍，反传梯度也只会缩小为 $1/\alpha$，从而抑制深层残差网络中的梯度发散[@zhang2019]。

### 2.2 交叉熵损失对 Logits 的导数推导

现在跟踪一个训练批次。设批大小 $B=20$、序列长度 $T=16$，共有 $N = B \times T = 320$ 个预测位置。将前向末端输出的打分张量展平为二维矩阵 $Z \in \mathbb{R}^{N \times V}$，第 $n$ 个位置的真实下一词编号记为 $y_n \in \{0, \dots, V-1\}$。

交叉熵损失定义为全部 $N$ 个位置上真实词元负对数似然的算术平均：

$$
L = -\frac{1}{N} \sum_{n=1}^{N} \ln P_{n, y_n} = -\frac{1}{N} \sum_{n=1}^{N} \left(Z_{n, y_n} - \ln \sum_{m=0}^{V-1} e^{Z_{n, m}}\right)
$$

其中 $P_{n, k} = e^{Z_{n,k}} / \sum_{m=0}^{V-1} e^{Z_{n,m}}$。在随机初始化阶段，各候选词打分接近相等，$P_{n, k} \approx 1/V$，因此初始损失的理论基准值恰为 $\ln V$（词表 $V=1000$ 时为 $\ln 1000 \approx 6.91$；词表 $V=128$ 时为 $\ln 128 \approx 4.85$）。

下面直接对第 $n$ 行第 $j$ 列的打分 $Z_{n, j}$ 求偏导。由于第 $n$ 行的概率只依赖第 $n$ 行的打分，求和号中其余样本项导数均为零：

$$
\frac{\partial L}{\partial Z_{n, j}} = -\frac{1}{N}\left(\frac{\partial Z_{n, y_n}}{\partial Z_{n, j}} - \frac{1}{\sum_{m=0}^{V-1} e^{Z_{n, m}}} \cdot \frac{\partial}{\partial Z_{n, j}} \sum_{m=0}^{V-1} e^{Z_{n, m}}\right) = -\frac{1}{N}\left(\mathbf{1}_{j = y_n} - \frac{e^{Z_{n, j}}}{\sum_{m=0}^{V-1} e^{Z_{n, m}}}\right)
$$

整理即得反向传播起点的误差矩阵 $\Delta^{(Z)} = \partial L / \partial Z \in \mathbb{R}^{N \times V}$：

$$
\Delta_{n, j}^{(Z)} = \frac{\partial L}{\partial Z_{n, j}} = \frac{1}{N}\left(P_{n, j} - \mathbf{1}_{j = y_n}\right)
$$

这个结果的物理含义十分直观：在真实答案列 $j = y_n$ 上，由于 $P_{n, y_n} \le 1$，导数为负值 $(P_{n, y_n} - 1)/N$，提示后续优化应当抬高该项打分；在所有非答案列 $j \neq y_n$ 上，导数为正值 $P_{n, j}/N$，错误分配的概率越大，向下压低该项打分的梯度信号就越强；整行导数之和恒等于 $\frac{1}{N}(1 - 1) = 0$。

### 2.3 线性层矩阵求导与梯度奇异值偏斜的根源

有了顶层误差矩阵，接下来看网络内部任意一层无偏置线性变换 $Y = X W^\top$ 是如何计算权重梯度与向下游传递误差的。

设合并批次与序列维后的输入矩阵为 $X \in \mathbb{R}^{N \times d_{\mathrm{in}}}$，权重矩阵为 $W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$，输出矩阵为 $Y \in \mathbb{R}^{N \times d_{\mathrm{out}}}$，且已知上游传回的损失对 $Y$ 的偏导矩阵 $\Delta = \partial L / \partial Y \in \mathbb{R}^{N \times d_{\mathrm{out}}}$（即 $\Delta_{n, i} = \partial L / \partial Y_{n, i}$）。

写出 $Y$ 的逐元素展开式：

$$
Y_{n, i} = \sum_{k=1}^{d_{\mathrm{in}}} X_{n, k} W_{i, k}
$$

观察单个参数元素 $W_{i, j}$ 出现在哪些输出元素里：对于全部 $n = 1, \dots, N$ 个词元位置，$W_{i, j}$ 都且仅出现在第 $i$ 列输出 $Y_{n, i}$ 的第 $k = j$ 项中，且局部偏导为 $\partial Y_{n, i} / \partial W_{i, j} = X_{n, j}$（当 $p \neq i$ 时 $\partial Y_{n, p} / \partial W_{i, j} = 0$）。根据多元复合函数链式法则，将所有依赖 $W_{i, j}$ 的路径相加：

$$
G_{i, j} \triangleq \frac{\partial L}{\partial W_{i, j}} = \sum_{n=1}^{N} \sum_{p=1}^{d_{\mathrm{out}}} \frac{\partial L}{\partial Y_{n, p}} \frac{\partial Y_{n, p}}{\partial W_{i, j}} = \sum_{n=1}^{N} \Delta_{n, i} X_{n, j} = \sum_{n=1}^{N} (\Delta^\top)_{i, n} X_{n, j}
$$

对照矩阵乘法的定义，上式右侧正是 $\Delta^\top \in \mathbb{R}^{d_{\mathrm{out}} \times N}$ 与 $X \in \mathbb{R}^{N \times d_{\mathrm{in}}}$ 的第 $(i, j)$ 个乘积元素。同理，对第 $n$ 个词元的第 $j$ 个输入特征 $X_{n, j}$ 求偏导，由于它参与了该行全部 $d_{\mathrm{out}}$ 个输出通道的计算（$\partial Y_{n, i} / \partial X_{n, j} = W_{i, j}$），求和即得 $\frac{\partial L}{\partial X_{n, j}} = \sum_{i=1}^{d_{\mathrm{out}}} \Delta_{n, i} W_{i, j} = (\Delta W)_{n, j}$。将权重梯度与向下游传递的输入梯度并列写出：

$$
G = \frac{\partial L}{\partial W} = \Delta^\top X = \sum_{n=1}^{N} \delta_n x_n^\top \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}, \qquad \frac{\partial L}{\partial X} = \Delta W \in \mathbb{R}^{N \times d_{\mathrm{in}}}
$$

其中 $\delta_n \in \mathbb{R}^{d_{\mathrm{out}}}$ 与 $x_n \in \mathbb{R}^{d_{\mathrm{in}}}$ 分别表示第 $n$ 个词元位置上的上游误差列向量与本层输入列向量。

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

这一组简洁的矩阵求导公式，同时解释了训练工程与优化理论中的四件事：

1. **为什么梯度 $G$ 永远与权重 $W$ 同形状**：样本维 $N$ 在 $\Delta^\top X$ 的内积求和中恰好收缩消去，无论批大小 $B$ 和句长 $T$ 取多少，乘积结果恒为 $(d_{\mathrm{out}}, d_{\mathrm{in}})$。
2. **为什么训练显存远大于推理显存**：反向传播计算线性层权重梯度 $\Delta^\top X$ 直接依赖前向激活 $X$；注意力子层同理——由 $O = P V_{\mathrm{val}}$ 与 $S = Q K^\top / \sqrt{d_k}$ 求导可得 $\Delta_{V} = P^\top \Delta_O$、$\Delta_P = \Delta_O V_{\mathrm{val}}^\top$、$\Delta_Q = \frac{1}{\sqrt{d_k}}\Delta_S K$ 与 $\Delta_K = \frac{1}{\sqrt{d_k}}\Delta_S^\top Q$，反向传播必须用到前向算出的 $Q, K, V_{\mathrm{val}}, P$（FlashAttention 通过在片上高速缓存重算 $P$ 省去了 $T \times T$ 矩阵显存，但 $Q, K, V_{\mathrm{val}}$ 与各层输入激活仍须保留，除非启用梯度检查点以重算整层前向换取显存）。
3. **为什么每步反向传播前需要调用 `zero_grad()`**：在显存有限的大模型训练中，工程上常把一个大批次拆成若干微批次（Micro-batches），多次调用 `loss.backward()` 将各微批次的 $\Delta^\top X$ 累加（`+=`）到同一块 `W.grad` 缓冲区上，再执行一次参数更新。因此 PyTorch 默认对梯度做累加而非覆盖；常规单批次更新前必须显式清零上一步的残留梯度。
4. **为什么神经网络的梯度矩阵普遍具有高度偏斜的奇异值谱**：看外积展开式 $G = \sum_{n=1}^N \delta_n x_n^\top$。自然语言中的词频服从长尾的齐夫定律（Zipf's Law），少数高频语法词与公共语义方向在每个批次中反复出现，使输入协方差 $\frac{1}{N}X^\top X$ 的特征值高度集中在少数几个主方向上。叠加成的梯度矩阵 $G$ 因此呈现出显著的各向异性——前几个奇异值很大，而承载低频知识与精细上下文对齐的几十上百个奇异值方向微弱了数千乃至上万倍。

拿到梯度之后，第 5 步 `optimizer.step()` 如何根据梯度更新参数？下面我们从标量与向量的情形起步，逐步推导出四代逐元素优化算法。

---

## 三、邻近最速下降原理与逐元素优化器的四代推演

为了把 `SGD`、`Momentum`、`Adam`、`AdamW` 乃至后面的 `Muon` 放在同一框架下比较，我们先写出**一阶最速下降的邻近变分形式**。

设第 $t-1$ 步结束时的参数向量为 $\theta_{t-1} \in \mathbb{R}^p$，当前步在微批次上算得的损失梯度为 $g_t = \nabla L_t(\theta_{t-1}) \in \mathbb{R}^p$。在 $\theta_{t-1}$ 附近对损失函数做一阶泰勒近似，有 $L_t(\theta) \approx L_t(\theta_{t-1}) + \langle g_t, \theta - \theta_{t-1} \rangle$。由于一阶线性近似只在局部邻域内有效，若不加步幅限制直接极小化线性项，解会发散至无穷远。因此，我们在目标中加上一项度量步幅大小的二次邻近惩罚（Proximal Penalty）：

$$
\theta_t = \mathrm{arg}\min_{\theta \in \mathbb{R}^p} \left\{ \langle g_t, \theta - \theta_{t-1} \rangle + \frac{1}{2\eta} \|\theta - \theta_{t-1}\|_2^2 \right\}
$$

其中 $\eta > 0$ 为学习率。对上式大括号内的严格凸二次函数关于 $\theta$ 求梯度并令其为零：

$$
g_t + \frac{1}{\eta}(\theta_t - \theta_{t-1}) = 0 \quad \Longrightarrow \quad \theta_t = \theta_{t-1} - \eta g_t
$$

这就是经典的**随机梯度下降（SGD）**[@robbins1951]。这行推导表明：“负梯度方向 $-\eta g_t$ 是最速下降方向”这一结论，**依赖于选取欧氏范数 $\|\cdot\|_2$ 度量参数位移**。一旦损失曲面的曲率在不同方向上严重失衡，各向同性的欧氏距离就不再是合适的局部度量。

### 3.1 第一代 `SGD` 在病态曲率下的收敛瓶颈推导

考虑一个最简单的二维各向异性二次损失函数（对应局部海森矩阵特征值悬殊的狭长山谷）：

$$
L(\theta_1, \theta_2) = \frac{1}{2}\lambda_1 \theta_1^2 + \frac{1}{2}\lambda_2 \theta_2^2, \qquad 0 < \lambda_1 \ll \lambda_2
$$

其梯度为 $\nabla L(\theta) = (\lambda_1 \theta_1, \lambda_2 \theta_2)^\top$，唯一极小值点在原点 $(0, 0)$。定义最大曲率与最小曲率之比为**条件数（Condition Number）**$\kappa \triangleq \lambda_2 / \lambda_1 \gg 1$。执行标准梯度下降，两个坐标解耦迭代：

$$
\theta_{t, 1} = (1 - \eta \lambda_1)^t \theta_{0, 1}, \qquad \theta_{t, 2} = (1 - \eta \lambda_2)^t \theta_{0, 2}
$$

要使陡峭方向 $\theta_2$ 收敛而不发散，公比必须满足 $|1 - \eta \lambda_2| < 1$，由此给学习率加上了严格上界：

$$
0 < \eta < \frac{2}{\lambda_2}
$$

并且只要 $\frac{1}{\lambda_2} < \eta < \frac{2}{\lambda_2}$，公比 $1 - \eta \lambda_2$ 就是负数，$\theta_{t, 2}$ 每一步都会正负变号，在山谷两侧陡壁之间来回振荡。更关键的是，学习率被陡峭方向限制在 $\eta < 2/\lambda_2$ 后，平缓方向 $\theta_1$ 每一步的误差收缩因子被迫满足：

$$
1 - \eta \lambda_1 > 1 - \frac{2\lambda_1}{\lambda_2} = 1 - \frac{2}{\kappa}
$$

利用 $\ln(1 - u) \approx -u$，要把平缓方向的初始误差缩小到 $\varepsilon$ 倍，所需迭代步数为 $t \ge \frac{\kappa}{2}\ln(1/\varepsilon)$。在深度网络中，海森矩阵的条件数 $\kappa$ 常达 $10^4 \sim 10^6$，纯 `SGD` 沿着平坦谷底推进就会十分缓慢。

### 3.2 第二代动量法：Polyak 惯性与 Nesterov 前瞻等价变形

如何抑制陡峭方向正负交替的振荡，同时加速平缓方向符号一致的推进？1964 年，Boris Polyak 借鉴重球在势能面滚动的物理阻尼方程，引入指数移动平均（EMA）累积历史梯度[@polyak1964]：

$$
m_t = \beta_1 m_{t-1} + (1 - \beta_1) g_t, \qquad \theta_t = \theta_{t-1} - \eta m_t
$$

（工程中也常省略常数因子 $(1 - \beta_1)$ 写作 $u_t = \mu u_{t-1} + g_t$，只需相应缩放 $\eta$。）我们可以算清它在两种典型梯度序列下的稳态增益：

- **平缓恒定方向**（设每步 $g_\tau = g$ 方向不变）：当 $t$ 足够大时，$m_t = (1 - \beta_1)\sum_{k=0}^\infty \beta_1^k g = g$，完整保留推进力（在无 $(1-\mu)$ 写法中稳态为 $\frac{1}{1-\mu}g$，当 $\mu = 0.9$ 时等效步幅放大 $10$ 倍）；
- **陡峭正负振荡方向**（设每步 $g_\tau = (-1)^\tau g$ 交替变号）：稳态幅度为

$$
|m_t| = (1 - \beta_1) |g| \left|\sum_{k=0}^{\infty} (-\beta_1)^k\right| = \frac{1 - \beta_1}{1 + \beta_1} |g|
$$

取常用值 $\beta_1 = 0.9$ 时，$\frac{1 - 0.9}{1 + 0.9} \approx 0.0526$，陡壁间的振荡幅度被衰减了近 $95\%$。在凸二次问题上，最优阻尼下的动量法能将收敛复杂度从 $\mathcal{O}(\kappa)$ 改善至 $\mathcal{O}(\sqrt{\kappa})$。

1983 年，Yurii Nesterov 进一步指出：既然参数即将顺着历史惯性向量往前滑行一步，与其在当前旧位置算梯度，不如**先顺着惯性滑到前瞻点，再计算该处的梯度做修正**[@nesterov1983]。设原始位置序列为 $x_t$，速度向量为 $v_t$，Nesterov 加速梯度（NAG）写作：

$$
v_t = \mu v_{t-1} - \eta \nabla L(x_{t-1} + \mu v_{t-1}), \qquad x_t = x_{t-1} + v_t
$$

初看上式似乎需要在非参数点 $x_{t-1} + \mu v_{t-1}$ 额外做一次前向与反向传播；但在深度学习框架（如 PyTorch `SGD(..., nesterov=True)` 以及后文的 `Muon`）中，通过一个变量代换即可消除额外求导。直接把前瞻点定义为框架实际存储的参数变量 $\theta_{t-1} \triangleq x_{t-1} + \mu v_{t-1}$，则当前步常规求导得到的就是 $g_t = \nabla L(\theta_{t-1})$。令动量缓冲区 $M_t \triangleq -v_t / \eta$，则 $v_t = -\eta M_t$ 且 $M_t = \mu M_{t-1} + g_t$。将 $\theta_t$ 用 $\theta_{t-1}$ 表示：

$$
\begin{aligned}
\theta_t &= x_t + \mu v_t = (x_{t-1} + v_t) + \mu v_t \\
&= (x_{t-1} + \mu v_{t-1}) - \mu v_{t-1} + (1 + \mu) v_t \\
&= \theta_{t-1} + \eta \mu M_{t-1} - \eta (1 + \mu)(\mu M_{t-1} + g_t) \\
&= \theta_{t-1} - \eta \bigl(g_t + \mu (\mu M_{t-1} + g_t)\bigr) = \theta_{t-1} - \eta (g_t + \mu M_t)
\end{aligned}
$$

定义 $\tilde{M}_t \triangleq g_t + \mu M_t$，这正是后文第五节 `Muon` 代码里那两行递推式 `M = mu * M + G; tilde_M = G + mu * M` 的精确代数来源。对比普通动量 $M_t = g_t + \mu M_{t-1}$ 与 Nesterov 前瞻动量 $\tilde{M}_t = (1 + \mu)g_t + \mu^2 M_{t-1}$，可以看到 Nesterov 将当期最新梯度 $g_t$ 的相对权重提高了 $(1 + \mu)$ 倍，遇到地形拐弯时能够更早减速。

### 3.3 第三代自适应预条件与 Adam 偏差修正推导

动量缓解了单一层内的曲率振荡，但深度网络还面临跨层、跨通道的梯度量级悬殊：稀有词嵌入行的梯度可能是 $10^{-5}$，而某层注意力投影的梯度可能是 $10^1$。

回到开头式中的邻近最速下降框架，如果把各向同性的欧氏距离 $\|\theta - \theta_{t-1}\|_2^2$ 替换为按坐标加权的对角黎曼度量 $(\theta - \theta_{t-1})^\top D_t (\theta - \theta_{t-1})$，其中 $D_t = \mathrm{diag}(d_{t,1}, \dots, d_{t,p}) \succ 0$：

$$
\theta_t = \mathrm{arg}\min_{\theta \in \mathbb{R}^p} \left\{ \langle g_t, \theta - \theta_{t-1} \rangle + \frac{1}{2\eta} (\theta - \theta_{t-1})^\top D_t (\theta - \theta_{t-1}) \right\} \quad \Longrightarrow \quad \theta_t = \theta_{t-1} - \eta D_t^{-1} g_t
$$

如何构造对角矩阵 $D_t$？

- **AdaGrad（Duchi et al., 2011）[@duchi2011]**：取开训以来全体历史梯度平方的累积和 $G_{\mathrm{sum}, t} = \sum_{\tau=1}^t g_\tau \odot g_\tau$，令 $D_t = \mathrm{diag}\!\left(\sqrt{G_{\mathrm{sum}, t}} + \epsilon\right)$。这在稀疏凸在线学习中具有理论最优遗憾界，但在非凸神经网络的数万步长训中，由于平方项非负单调递增，分母 $\sqrt{G_{\mathrm{sum}, t}}$ 会持续增大，导致中后期有效学习率 $\eta D_t^{-1}$ 过早衰减趋零。
- **RMSProp（Hinton, 2012）**：引入遗忘系数 $\beta_2 \in (0, 1)$（如 $0.999$ 或 $0.95$），将无限累加改为近期窗口约为 $\frac{1}{1-\beta_2}$ 步的指数移动平均：$v_t = \beta_2 v_{t-1} + (1 - \beta_2) (g_t \odot g_t)$，分母取 $\sqrt{v_t} + \epsilon$。
- **Adam（Kingma & Ba, 2015）与冷启动偏差修正推导[@kingma2015]**：将分子的一阶动量 $m_t$ 与分母的二阶矩 $v_t$ 结合，从零初值 $m_0 = 0, v_0 = 0$ 出发迭代：

$$
m_t = \beta_1 m_{t-1} + (1 - \beta_1) g_t, \qquad v_t = \beta_2 v_{t-1} + (1 - \beta_2) g_t^2
$$

（此处及下文标量写法中，$g_t^2$ 表示逐元素平方 $g_t \odot g_t$。）为什么要做偏差修正？将 $v_t$ 的递推式按数学归纳法展开至 $t=1$：

$$
v_t = (1 - \beta_2) \sum_{i=1}^{t} \beta_2^{t-i} g_i^2
$$

两边取数学期望。记当前第 $t$ 步的真实二阶矩为 $\sigma_{g,t}^2 \triangleq \mathbb{E}[g_t^2]$，将历史步写为 $\mathbb{E}[g_i^2] = \sigma_{g,t}^2 + (\mathbb{E}[g_i^2] - \sigma_{g,t}^2)$（若分布近似平稳则差值余项 $\zeta = 0$），利用有限等比数列求和公式 $\sum_{k=0}^{t-1} \beta_2^k = \frac{1 - \beta_2^t}{1 - \beta_2}$，可得：

$$
\mathbb{E}[v_t] = (1 - \beta_2) \sum_{i=1}^{t} \beta_2^{t-i} \mathbb{E}[g_i^2] = \sigma_{g,t}^2 (1 - \beta_2) \frac{1 - \beta_2^t}{1 - \beta_2} + \zeta = \sigma_{g,t}^2 (1 - \beta_2^t) + \zeta
$$

同理，$\mathbb{E}[m_t] = \mathbb{E}[g_t](1 - \beta_1^t) + \zeta'$。可以看到，由于 $m_0 = 0, v_0 = 0$ 占据了剩余的 $\beta_1^t$ 与 $\beta_2^t$ 权重，原始估计量在训练初期明显偏向于零。更具体地看第 $t=1$ 步：若不做修正直接计算比值，当取标准超参数 $\beta_1 = 0.9, \beta_2 = 0.999$ 时，任意非零梯度 $g_1$ 产生的单步更新幅度为：

$$
\frac{|m_1|}{\sqrt{v_1}} = \frac{(1 - \beta_1)|g_1|}{\sqrt{(1 - \beta_2) g_1^2}} = \frac{1 - 0.9}{\sqrt{1 - 0.999}} = \frac{0.1}{\sqrt{0.001}} \approx 3.162
$$

由于 $\beta_2$ 比 $\beta_1$ 更接近 $1$，分母向零偏置的程度大于分子，第一步的实际步幅被放大至 $3.16$ 倍（若取 $\beta_2 = 0.9999$ 则放大至 $10$ 倍），容易在训练初期引起参数更新过冲。

消除该系统性偏差的方法，正是把 $m_t$ 与 $v_t$ 分别除以各自的权重总和 $(1 - \beta_1^t)$ 与 $(1 - \beta_2^t)$，构造无偏估计量 $\hat{m}_t, \hat{v}_t$：

$$
\hat{m}_t = \frac{m_t}{1 - \beta_1^t}, \qquad \hat{v}_t = \frac{v_t}{1 - \beta_2^t}, \qquad \theta_t = \theta_{t-1} - \eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}
$$

修正后，第 $1$ 步 $|\hat{m}_1| / \sqrt{\hat{v}_1} = |g_1| / |g_1| = 1$；当 $t \to \infty$ 时 $\beta_1^t, \beta_2^t \to 0$，修正因子平滑趋于 $1$。同时，比值 $\hat{m}_t / \sqrt{\hat{v}_t}$ 具有明确的统计意义——它是每个参数坐标上的经验**梯度信噪比（Signal-to-Noise Ratio）**：当参数接近局部极小值时，真实均值信号 $\mathbb{E}[g_t] \to 0$，小批量采样方差仍使 $\hat{v}_t > 0$，而正负随机抵消使 $\hat{m}_t \to 0$，步幅在极值附近自动收缩退火[@kingma2015]。

### 3.4 二次正则不等价定理与 AdamW 解耦权重衰减推导

在训练参数量庞大的神经网络时，如果不对参数模长施加约束，模型为了压低有限训练集上的交叉熵，往往会将部分冗余权重推向较大的数值，使输出打分过度尖锐并影响泛化表现。从贝叶斯最大后验概率估计（MAP）视角看，若假设参数服从零均值各向同性高斯先验 $p(\theta) \propto \exp\!\left(-\frac{\lambda}{2}\|\theta\|_2^2\right)$，最大化对数后验 $\ln p(\mathcal{D} \mid \theta) + \ln p(\theta)$ 就等价于在经验损失后加上二次 **$L_2$ 正则项**：

$$
L_{\mathrm{reg}}(\theta) = L(\theta) + \frac{\lambda}{2}\|\theta\|_2^2 \quad \Longrightarrow \quad \nabla L_{\mathrm{reg}}(\theta) = \nabla L(\theta) + \lambda \theta
$$

另一方面，1988 年 Hanson 与 Pratt 定义了直接按比例收缩参数的**权重衰减（Weight Decay）**：在每步更新时令参数乘上衰减因子 $(1 - w)\theta_{t-1}$。在纯 `SGD` 中，把 $\nabla L_{\mathrm{reg}}$ 代入更新式得：

$$
\theta_t = \theta_{t-1} - \eta (g_t + \lambda \theta_{t-1}) = (1 - \eta \lambda)\theta_{t-1} - \eta g_t
$$

令 $w = \eta \lambda$，两者形式完全相同。由于这一巧合，早期深度学习库统一将 `weight_decay` 实现为在求导后执行 `g_t = g_t + wd * theta`。然而，当 `Adam` 普及后，研究者发现 `Adam` 配合该实现训练出的模型泛化性能明显弱于 `SGD + Momentum`。

2019 年，Loshchilov 与 Hutter 在 `AdamW` 论文中给出了严格的不等价证明[@loshchilov2019]。设一般预条件优化器（对称正定预条件矩阵 $P_t \succ 0$）带解耦权重衰减率 $w$ 的更新式为：

$$
\theta_t = (1 - w)\theta_{t-1} - \eta P_t^{-1} \nabla L(\theta_{t-1})
$$

问：是否存在某个固定的可微正则项 $R(\theta)$，使得在同一优化器下最小化修改后的总损失 $\tilde{L}(\theta) = L(\theta) + R(\theta)$ 产生完全相同的更新？首先，若 $P_t$ 随历史梯度动态变化，根本不存在与步数 $t$ 无关的固定标量函数 $R(\theta)$；退一步，即便假定 $P_t = P$ 固定且与 $\theta$ 无关，将 $\nabla \tilde{L}(\theta_{t-1}) = \nabla L(\theta_{t-1}) + \nabla R(\theta_{t-1})$ 代入无解耦衰减的更新式并令两端相等：

$$
\theta_{t-1} - \eta P^{-1}\bigl(\nabla L(\theta_{t-1}) + \nabla R(\theta_{t-1})\bigr) = (1 - w)\theta_{t-1} - \eta P^{-1} \nabla L(\theta_{t-1})
$$

消去公共项并左乘对称正定阵 $P$，得到梯度恒等条件：

$$
\nabla R(\theta_{t-1}) = \frac{w}{\eta} P \theta_{t-1} \quad \Longleftrightarrow \quad R(\theta) = \frac{w}{2\eta} \theta^\top P \theta
$$

这一推导直接得出两条结论：

1. **充要条件**：标准各向同性 $L_2$ 正则 $R(\theta) = \frac{\lambda}{2}\|\theta\|_2^2$ 与权重衰减等价，**当且仅当预条件矩阵是单位阵的标量倍数 $P_t = c I$**（即无逐坐标自适应缩放的 `SGD`）。
2. **耦合 $L_2$ 在 `Adam` 中的失真效应**：在 `Adam` 中，$P_t = \mathrm{diag}\!\left(\sqrt{\hat{v}_t} + \epsilon\right)$ 各个坐标互不相等。若直接把 $\lambda \theta_{t-1}$ 加进梯度 $g_t^{\mathrm{L2}} = g_t + \lambda \theta_{t-1}$，一方面 $\lambda \theta$ 会反向混入二阶矩 $\hat{v}_t^{\mathrm{L2}}$ 的累积；另一方面（暂取 $\beta_1 = 0$ 观察单步结构），实际更新变为：

$$
\theta_{t, i} = \theta_{t-1, i} - \eta \frac{g_{t, i} + \lambda \theta_{t-1, i}}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon} = \left(1 - \frac{\eta \lambda}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon}\right)\theta_{t-1, i} - \eta \frac{g_{t, i}}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon}
$$

第 $i$ 个参数的实际衰减比例变成了 $\frac{\eta \lambda}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon}$，不仅与学习率耦合，而且被该坐标的历史梯度均方根除了下去：历史梯度较大的活跃参数（$\sqrt{\hat{v}_{t,i}} \gg 1$）几乎不受衰减约束；反之，历史梯度微弱的参数（$\sqrt{\hat{v}_{t,i}} \ll 1$）承受了更强的相对收缩，偏离了各向同性高斯先验要求所有权重按同一速率向零收缩的目标。

`AdamW` 的修正方式就是将权重衰减从梯度计算中剥离，恢复其按固定比例直接收缩参数本身的本义：

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

下图用两组数值实验直接验证了本节的两项推导：左侧面板展示 `SGD`、`Momentum` 与 `AdamW` 在条件数 $\kappa = 36$ 的二次曲面 $L(\theta_1, \theta_2) = 0.5\theta_1^2 + 18\theta_2^2$ 上迭代 26 步的参数空间轨迹；右侧面板对两个零均值噪声梯度幅度分别为 $40$ 与 $0.05$、初始值同为 $2.5$ 的冗余参数运行 `Adam+L2` 与 `AdamW`，可以看到 `Adam+L2` 中大梯度参数几乎停止衰减，而 `AdamW` 的两条衰减曲线严格重合。

```plot title="逐元素优化器数值验证：病态二次曲面轨迹与耦合 $L_2$ 衰减失真" note="左面板：$L(\theta_1, \theta_2) = 0.5\theta_1^2 + 18\theta_2^2$（$\kappa = 36$）上 26 步轨迹；右面板：零均值交替噪声梯度下（$\theta_1$ 幅度 40，$\theta_2$ 幅度 0.05，初值均为 2.5，$\eta=0.02, \lambda=0.4$）观察冗余参数向零收缩的过程。"
{"cols":2,"narrowCols":1,"legend":[{"label":"SGD / Adam+$L_2$ 大梯度坐标 $\\theta_1$","color":"var(--clay)","shape":"line"},{"label":"Momentum / Adam+$L_2$ 小梯度坐标 $\\theta_2$","color":"var(--orange)","shape":"dash"},{"label":"AdamW（逐轴自适应与等比例解耦衰减）","color":"var(--teal)","shape":"line"}],"data":{"canyon":[{"opt":"SGD","step":0,"w1":-3.4,"w2":0.78},{"opt":"SGD","step":1,"w1":-3.223,"w2":-0.68},{"opt":"SGD","step":2,"w1":-3.056,"w2":0.593},{"opt":"SGD","step":3,"w1":-2.897,"w2":-0.517},{"opt":"SGD","step":4,"w1":-2.746,"w2":0.451},{"opt":"SGD","step":5,"w1":-2.603,"w2":-0.393},{"opt":"SGD","step":6,"w1":-2.468,"w2":0.343},{"opt":"SGD","step":7,"w1":-2.34,"w2":-0.299},{"opt":"SGD","step":8,"w1":-2.218,"w2":0.261},{"opt":"SGD","step":9,"w1":-2.103,"w2":-0.227},{"opt":"SGD","step":10,"w1":-1.993,"w2":0.198},{"opt":"SGD","step":11,"w1":-1.89,"w2":-0.173},{"opt":"SGD","step":12,"w1":-1.791,"w2":0.151},{"opt":"SGD","step":13,"w1":-1.698,"w2":-0.131},{"opt":"SGD","step":14,"w1":-1.61,"w2":0.115},{"opt":"SGD","step":15,"w1":-1.526,"w2":-0.1},{"opt":"SGD","step":16,"w1":-1.447,"w2":0.087},{"opt":"SGD","step":17,"w1":-1.372,"w2":-0.076},{"opt":"SGD","step":18,"w1":-1.3,"w2":0.066},{"opt":"SGD","step":19,"w1":-1.233,"w2":-0.058},{"opt":"SGD","step":20,"w1":-1.169,"w2":0.05},{"opt":"SGD","step":21,"w1":-1.108,"w2":-0.044},{"opt":"SGD","step":22,"w1":-1.05,"w2":0.038},{"opt":"SGD","step":23,"w1":-0.996,"w2":-0.033},{"opt":"SGD","step":24,"w1":-0.944,"w2":0.029},{"opt":"SGD","step":25,"w1":-0.895,"w2":-0.025},{"opt":"SGD","step":26,"w1":-0.848,"w2":0.022},{"opt":"Momentum","step":0,"w1":-3.4,"w2":0.78},{"opt":"Momentum","step":1,"w1":-3.281,"w2":0.203},{"opt":"Momentum","step":2,"w1":-3.061,"w2":-0.812},{"opt":"Momentum","step":3,"w1":-2.761,"w2":-0.325},{"opt":"Momentum","step":4,"w1":-2.4,"w2":0.513},{"opt":"Momentum","step":5,"w1":-1.998,"w2":0.604},{"opt":"Momentum","step":6,"w1":-1.575,"w2":-0.077},{"opt":"Momentum","step":7,"w1":-1.147,"w2":-0.579},{"opt":"Momentum","step":8,"w1":-0.731,"w2":-0.292},{"opt":"Momentum","step":9,"w1":-0.339,"w2":0.329},{"opt":"Momentum","step":10,"w1":0.018,"w2":0.461},{"opt":"Momentum","step":11,"w1":0.332,"w2":-0.004},{"opt":"Momentum","step":12,"w1":0.596,"w2":-0.408},{"opt":"Momentum","step":13,"w1":0.808,"w2":-0.249},{"opt":"Momentum","step":14,"w1":0.966,"w2":0.204},{"opt":"Momentum","step":15,"w1":1.071,"w2":0.346},{"opt":"Momentum","step":16,"w1":1.126,"w2":0.035},{"opt":"Momentum","step":17,"w1":1.135,"w2":-0.283},{"opt":"Momentum","step":18,"w1":1.103,"w2":-0.206},{"opt":"Momentum","step":19,"w1":1.037,"w2":0.121},{"opt":"Momentum","step":20,"w1":0.942,"w2":0.257},{"opt":"Momentum","step":21,"w1":0.826,"w2":0.052},{"opt":"Momentum","step":22,"w1":0.694,"w2":-0.193},{"opt":"Momentum","step":23,"w1":0.554,"w2":-0.166},{"opt":"Momentum","step":24,"w1":0.412,"w2":0.067},{"opt":"Momentum","step":25,"w1":0.272,"w2":0.188},{"opt":"Momentum","step":26,"w1":0.139,"w2":0.057},{"opt":"AdamW","step":0,"w1":-3.4,"w2":0.78},{"opt":"AdamW","step":1,"w1":-3.15,"w2":0.53},{"opt":"AdamW","step":2,"w1":-2.901,"w2":0.287},{"opt":"AdamW","step":3,"w1":-2.653,"w2":0.061},{"opt":"AdamW","step":4,"w1":-2.406,"w2":-0.133},{"opt":"AdamW","step":5,"w1":-2.163,"w2":-0.278},{"opt":"AdamW","step":6,"w1":-1.922,"w2":-0.362},{"opt":"AdamW","step":7,"w1":-1.686,"w2":-0.39},{"opt":"AdamW","step":8,"w1":-1.454,"w2":-0.371},{"opt":"AdamW","step":9,"w1":-1.229,"w2":-0.318},{"opt":"AdamW","step":10,"w1":-1.011,"w2":-0.242},{"opt":"AdamW","step":11,"w1":-0.802,"w2":-0.152},{"opt":"AdamW","step":12,"w1":-0.602,"w2":-0.057},{"opt":"AdamW","step":13,"w1":-0.412,"w2":0.033},{"opt":"AdamW","step":14,"w1":-0.235,"w2":0.112},{"opt":"AdamW","step":15,"w1":-0.071,"w2":0.172},{"opt":"AdamW","step":16,"w1":0.079,"w2":0.21},{"opt":"AdamW","step":17,"w1":0.213,"w2":0.225},{"opt":"AdamW","step":18,"w1":0.332,"w2":0.217},{"opt":"AdamW","step":19,"w1":0.434,"w2":0.19},{"opt":"AdamW","step":20,"w1":0.52,"w2":0.148},{"opt":"AdamW","step":21,"w1":0.589,"w2":0.096},{"opt":"AdamW","step":22,"w1":0.642,"w2":0.04},{"opt":"AdamW","step":23,"w1":0.68,"w2":-0.015},{"opt":"AdamW","step":24,"w1":0.702,"w2":-0.063},{"opt":"AdamW","step":25,"w1":0.71,"w2":-0.101},{"opt":"AdamW","step":26,"w1":0.705,"w2":-0.126}],"pts":[{"w1":-3.4,"w2":0.78,"lbl":"起点 (-3.4, 0.78)"},{"w1":0.0,"w2":0.0,"lbl":"极小值点 (0, 0)"}],"decay":[{"step":0,"l2_hi":2.5,"l2_lo":2.5,"aw_hi":2.5,"aw_lo":2.5},{"step":5,"l2_hi":2.469,"l2_lo":2.4,"aw_hi":2.374,"aw_lo":2.374},{"step":10,"l2_hi":2.465,"l2_lo":2.301,"aw_hi":2.278,"aw_lo":2.278},{"step":15,"l2_hi":2.459,"l2_lo":2.202,"aw_hi":2.185,"aw_lo":2.185},{"step":20,"l2_hi":2.457,"l2_lo":2.105,"aw_hi":2.099,"aw_lo":2.099},{"step":25,"l2_hi":2.453,"l2_lo":2.009,"aw_hi":2.015,"aw_lo":2.015},{"step":30,"l2_hi":2.451,"l2_lo":1.915,"aw_hi":1.937,"aw_lo":1.937},{"step":35,"l2_hi":2.447,"l2_lo":1.822,"aw_hi":1.859,"aw_lo":1.859},{"step":40,"l2_hi":2.446,"l2_lo":1.732,"aw_hi":1.787,"aw_lo":1.787},{"step":45,"l2_hi":2.442,"l2_lo":1.644,"aw_hi":1.715,"aw_lo":1.715},{"step":50,"l2_hi":2.441,"l2_lo":1.559,"aw_hi":1.649,"aw_lo":1.649},{"step":55,"l2_hi":2.437,"l2_lo":1.476,"aw_hi":1.583,"aw_lo":1.583},{"step":60,"l2_hi":2.436,"l2_lo":1.395,"aw_hi":1.522,"aw_lo":1.522},{"step":65,"l2_hi":2.433,"l2_lo":1.317,"aw_hi":1.461,"aw_lo":1.461},{"step":70,"l2_hi":2.431,"l2_lo":1.242,"aw_hi":1.404,"aw_lo":1.404},{"step":75,"l2_hi":2.428,"l2_lo":1.169,"aw_hi":1.348,"aw_lo":1.348},{"step":80,"l2_hi":2.426,"l2_lo":1.099,"aw_hi":1.296,"aw_lo":1.296},{"step":85,"l2_hi":2.423,"l2_lo":1.031,"aw_hi":1.244,"aw_lo":1.244},{"step":90,"l2_hi":2.421,"l2_lo":0.967,"aw_hi":1.196,"aw_lo":1.196},{"step":95,"l2_hi":2.418,"l2_lo":0.905,"aw_hi":1.148,"aw_lo":1.148},{"step":100,"l2_hi":2.417,"l2_lo":0.846,"aw_hi":1.104,"aw_lo":1.104},{"step":105,"l2_hi":2.413,"l2_lo":0.789,"aw_hi":1.059,"aw_lo":1.059},{"step":110,"l2_hi":2.412,"l2_lo":0.735,"aw_hi":1.019,"aw_lo":1.019},{"step":115,"l2_hi":2.408,"l2_lo":0.684,"aw_hi":0.977,"aw_lo":0.977},{"step":120,"l2_hi":2.407,"l2_lo":0.635,"aw_hi":0.94,"aw_lo":0.94},{"step":125,"l2_hi":2.403,"l2_lo":0.589,"aw_hi":0.902,"aw_lo":0.902},{"step":130,"l2_hi":2.402,"l2_lo":0.545,"aw_hi":0.867,"aw_lo":0.867},{"step":135,"l2_hi":2.399,"l2_lo":0.504,"aw_hi":0.832,"aw_lo":0.832},{"step":140,"l2_hi":2.397,"l2_lo":0.465,"aw_hi":0.801,"aw_lo":0.801},{"step":145,"l2_hi":2.394,"l2_lo":0.428,"aw_hi":0.768,"aw_lo":0.768},{"step":150,"l2_hi":2.392,"l2_lo":0.393,"aw_hi":0.739,"aw_lo":0.739}]},"panels":[{"title":"病态二次曲面轨迹 · $L(\\theta_1, \\theta_2) = 0.5\\theta_1^2 + 18\\theta_2^2$","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"平缓方向参数 1","domain":[-3.7,0.95]},"y":{"label":"陡峭方向参数 2","domain":[-0.92,0.92]},"grid":true,"marks":[{"mark":"ruleY","data":[0],"stroke":"var(--line)"},{"mark":"ruleX","data":[0],"stroke":"var(--line)"},{"mark":"line","data":"canyon","filter":{"opt":"SGD"},"x":"w1","y":"w2","stroke":"var(--clay)","strokeWidth":1.8},{"mark":"line","data":"canyon","filter":{"opt":"Momentum"},"x":"w1","y":"w2","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"canyon","filter":{"opt":"AdamW"},"x":"w1","y":"w2","stroke":"var(--teal)","strokeWidth":2.4},{"mark":"dot","data":"canyon","filter":{"opt":"AdamW"},"x":"w1","y":"w2","fill":"var(--teal)","r":2.2,"tip":["opt","step","w1","w2"]},{"mark":"dot","data":"pts","x":"w1","y":"w2","fill":"var(--ink)","r":4.2},{"mark":"text","data":[{"w1":-3.3,"w2":0.84,"t":"起点"}],"x":"w1","y":"w2","text":"t","textAnchor":"start","fill":"var(--ink)"},{"mark":"text","data":[{"w1":0.0,"w2":-0.22,"t":"极值点 (0, 0)"}],"x":"w1","y":"w2","text":"t","textAnchor":"middle","fill":"var(--ink)"}]},{"title":"冗余参数衰减对比 · 高梯度 $\\theta_1$ ($\\sqrt{v_t}\\approx 40$) 与低梯度 $\\theta_2$ ($\\sqrt{v_t}\\approx 0.05$)","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"迭代步数 Step t","domain":[0,155]},"y":{"label":"参数数值","domain":[0,2.75]},"grid":true,"marks":[{"mark":"line","data":"decay","x":"step","y":"l2_hi","stroke":"var(--clay)","strokeWidth":2.4},{"mark":"line","data":"decay","x":"step","y":"l2_lo","stroke":"var(--orange)","strokeWidth":2.0,"strokeDasharray":"5 3"},{"mark":"line","data":"decay","x":"step","y":"aw_hi","stroke":"var(--teal)","strokeWidth":2.6},{"mark":"line","data":"decay","x":"step","y":"aw_lo","stroke":"var(--blue)","strokeWidth":1.8,"strokeDasharray":"2 3"},{"mark":"dot","data":"decay","x":"step","y":"l2_hi","fill":"var(--clay)","r":2,"tip":["step","l2_hi","l2_lo","aw_hi"]},{"mark":"text","data":[{"step":148,"y":2.54,"t":"Adam+L2 高梯度参数停留在 2.39"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"step":148,"y":1.78,"t":"AdamW 两参数重合衰减至 0.74"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"},{"mark":"text","data":[{"step":148,"y":0.22,"t":"Adam+L2 低梯度参数压缩至 0.39"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--orange)"}]}]}
```

关于权重衰减还有一个工程细节：为什么 `RMSNorm` 的缩放向量 $\gamma$（以及网络中的一维偏置 `bias`）在配置 `AdamW` 时通常将 `weight_decay` 设为 `0.0`？因为 $\gamma$ 初始化为全 $1$，其职责是在特征归一化为单位均方根后调节各通道的增益幅度，本身只占总参数量的万分之几，不存在高维矩阵过拟合的自由度；若对其施加向 $0$ 收缩的惩罚，反而会人为压低整层激活幅度。

---

## 四、从逐元素范数到二维算子谱范数：推导矩阵优化器 `Muon`

至此，我们得到了现代训练栈的默认基线 `AdamW`。现在回到第一节与第二节揭示的结构特征：Transformer 内部占非词表参数 $95\%$ 以上的权重（$W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}$）都是二维线性变换矩阵 $W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$，其梯度 $G = \sum_{n=1}^N \delta_n x_n^\top$ 具有显著的奇异值偏斜。当把这样一张二维矩阵交给 `AdamW` 时，`AdamW` 对应怎样的几何操作？

### 4.1 AdamW 的隐含几何假设：逐元素最大范数下的最速下降

为了统一比较非欧氏范数下的更新方向，我们先将第三节的“无约束二次邻近惩罚”改写为等价的**范数球硬约束最速下降（Normalized Steepest Descent）**。记两张同形状矩阵的 Frobenius 内积为 $\langle A, B \rangle_F \triangleq \mathrm{tr}(A^\top B) = \sum_{i, j} A_{i, j} B_{i, j}$，对应的 Frobenius 范数为 $\|A\|_F = \sqrt{\langle A, A \rangle_F}$。给定任意矩阵范数 $\|\cdot\|$ 与步长预算 $\eta > 0$，范数球约束最速下降定义为：

$$
\Delta W^* = \mathrm{arg}\min_{\|\Delta W\| \le \eta} \langle G, \Delta W \rangle_F
$$

（拉格朗日对偶可知，该硬约束问题与二次惩罚问题方向相同，区别仅在于硬约束将每一步的范数步幅显式归一化为 $\eta$；例如取 Frobenius 范数 $\|\Delta W\|_F \le \eta$ 时，精确解为归一化负梯度 $\Delta W^* = -\eta G / \|G\|_F$。）

现在考察关闭历史记忆（$\beta_1 = 0, \beta_2 = 0, \epsilon \to 0$）时的 `Adam` 极限形式：每个矩阵元素 $(i, j)$ 的更新量变为 $-\eta \frac{G_{i, j}}{\sqrt{G_{i, j}^2}} = -\eta \,\mathrm{sign}(G_{i, j})$（即符号梯度下降 `SignSGD`）。它恰好对应选取**逐元素最大绝对值范数** $\|\Delta W\|_{\max} \triangleq \max_{i, j} |\Delta W_{i, j}|$（即展平向量的 $\ell_\infty$ 范数）时的球约束解：

$$
\min_{\|\Delta W\|_{\max} \le \eta} \langle G, \Delta W \rangle_F = \min_{\forall i, j:\; |\Delta W_{i, j}| \le \eta} \sum_{i=1}^{d_{\mathrm{out}}} \sum_{j=1}^{d_{\mathrm{in}}} G_{i, j} \Delta W_{i, j} \quad \Longrightarrow \quad \Delta W_{i, j}^* = -\eta \,\mathrm{sign}(G_{i, j})
$$

因此，`AdamW` 在几何本质上是**带指数移动平均平滑的逐元素 $\ell_\infty$ 范数最速下降**[@bernstein2024]。

把一张 $d_{\mathrm{out}} \times d_{\mathrm{in}}$ 的线性算子拆成 $d_{\mathrm{out}} \cdot d_{\mathrm{in}}$ 个互不相干的标量格子分别限幅，存在两个结构性局限：

1. **依赖坐标基选取，忽略子空间旋转结构**：若对隐状态空间做一次正交换基 $h \mapsto Q h$（$Q^\top Q = I$），线性映射的几何实质完全未变，但逐元素符号算子 $\mathrm{sign}(\cdot)$ 在正交变换下并不等变（$\mathrm{sign}(Q G) \neq Q \,\mathrm{sign}(G)$）。
2. **拉平的是单个矩阵格子，而非正交特征方向**：当梯度矩阵 $G = \sum_n \delta_n x_n^\top$ 被少数高频方向主导（比如秩接近 $1$ 的外积 $u v^\top$）时，逐元素取符号得到的矩阵 $\mathrm{sign}(u v^\top) = \mathrm{sign}(u)\,\mathrm{sign}(v)^\top$ **依然是一个秩为 $1$ 的矩阵**。也就是说，单靠逐格除以 $\sqrt{\hat{v}_{i, j}}$，无法有效放大尾部数十个低奇异值特征子空间上的更新步幅。

### 4.2 从 `Shampoo` 双边预条件到无状态极限的代数化简

怎样在不丢失行列耦合的前提下对矩阵梯度做预条件？如果把 $W \in \mathbb{R}^{A \times B}$ 展平为长度 $A B$ 的长向量做全矩阵 `AdaGrad`，协方差矩阵的大小将是 $(A B) \times (A B)$——当 $A = B = 4096$ 时，单这一张预条件矩阵就含有 $2.8 \times 10^{14}$ 个浮点数，在内存与算力上均不可行。

2018 年，Gupta、Koren 与 Singer 提出 **Shampoo**[@gupta2018]：用克罗内克积（Kronecker Product）分别维护行空间协方差累加矩阵 $L_t = \sum_{s=1}^t G_s G_s^\top \in \mathbb{R}^{A \times A}$ 与列空间协方差累加矩阵 $R_t = \sum_{s=1}^t G_s^\top G_s \in \mathbb{R}^{B \times B}$，将更新方向定义为双边矩阵幂预条件 $L_t^{-1/4} G_t R_t^{-1/4}$。为什么指数取 $-1/4$ 而不是 `AdaGrad` 的 $-1/2$？因为 $L_t$ 和 $R_t$ 各自都是梯度的二次型（量纲为 $G^2$），左乘 $L_t^{-1/4}$（量纲 $G^{-1/2}$）与右乘 $R_t^{-1/4}$（量纲 $G^{-1/2}$）合在一起，恰好抵消中间一次方的 $G$，恢复与 `AdaGrad` $(G^2)^{-1/2} G$ 一致的零阶步幅量纲。

在后续实验探索中，研究者注意到一个启发性的现象：如果把 `Shampoo` 中的跨步累加关掉，直接用当期梯度（或动量）矩阵 $G$ 计算单步无状态形式 $((G G^\top)^+)^{1/4} G ((G^\top G)^+)^{1/4}$（其中 $(\cdot)^+$ 表示 Moore-Penrose 伪逆），收敛速度不仅没有退化，反而常常更快[@bernstein2024]。让我们把这个双边 $-1/4$ 次幂表达式严格化简出来。

设矩阵 $G \in \mathbb{R}^{A \times B}$ 的秩为 $r \le \min(A, B)$，写出其**精简奇异值分解（Reduced SVD）**：

$$
G = U \Sigma V^\top
$$

其中左奇异向量矩阵 $U \in \mathbb{R}^{A \times r}$ 列正交（$U^\top U = I_r$），奇异值矩阵 $\Sigma = \mathrm{diag}(\sigma_1, \dots, \sigma_r) \in \mathbb{R}^{r \times r}$ 为正对角方阵（$\sigma_1 \ge \dots \ge \sigma_r > 0$），右奇异向量矩阵 $V \in \mathbb{R}^{B \times r}$ 列正交（$V^\top V = I_r$）。顺便验证矩阵 Frobenius 范数与奇异值的恒等关系：$\|G\|_F^2 = \mathrm{tr}(G^\top G) = \mathrm{tr}(V \Sigma U^\top U \Sigma V^\top) = \mathrm{tr}(\Sigma^2 V^\top V) = \sum_{i=1}^r \sigma_i^2$。代入计算左右格拉姆矩阵（Gram Matrix）：

$$
G G^\top = (U \Sigma V^\top)(V \Sigma U^\top) = U \Sigma^2 U^\top, \qquad G^\top G = (V \Sigma U^\top)(U \Sigma V^\top) = V \Sigma^2 V^\top
$$

在非零奇异值张成的子空间上取伪逆的 $1/4$ 次幂（即对正对角元开 $-1/2$ 次方）：

$$
((G G^\top)^+)^{1/4} = U \Sigma^{-1/2} U^\top, \qquad ((G^\top G)^+)^{1/4} = V \Sigma^{-1/2} V^\top
$$

将三项依次相乘，利用 $U^\top U = I_r$ 与 $V^\top V = I_r$：

$$
((G G^\top)^+)^{1/4} G ((G^\top G)^+)^{1/4} = \bigl(U \Sigma^{-1/2} U^\top\bigr)(U \Sigma V^\top)\bigl(V \Sigma^{-1/2} V^\top\bigr) = U \Sigma^{-1/2} \Sigma \Sigma^{-1/2} V^\top = U I_r V^\top = U V^\top
$$

无论原始非零奇异值 $\sigma_1, \dots, \sigma_r$ 之间相差多少数量级，经过双边预条件后均精确抵消并归一为 $1$。当 $G$ 满秩（$r = \min(A, B)$，随机梯度下几乎处处成立）时，矩阵 $U V^\top \in \mathbb{R}^{A \times B}$ 是与 $G$ 最接近的**半正交矩阵（Semi-orthogonal Matrix）**（$A \ge B$ 时满足 $(U V^\top)^\top (U V^\top) = I_B$；$A \le B$ 时满足 $(U V^\top)(U V^\top)^\top = I_A$；若秩亏 $r < \min(A, B)$，则是秩为 $r$ 的部分等距矩阵）。

### 4.3 第一性原理推导：隐藏层诱导算子范数下的最速下降解

2024 年，Bernstein 与 Newhouse 在 *Old Optimizer, New Norm*[@bernstein2024] 中证明：上述半正交更新 $U V^\top$ 无需借助“近似二阶海森矩阵”来解释，它就是**隐藏线性层在物理意义最自然的算子诱导范数下的精确一阶最速下降解**。下面我们完整写出这一推导。

考虑 Transformer 隐藏层中的一块线性算子 $y = W x$，输入 $x \in \mathbb{R}^{d_{\mathrm{in}}}$，输出 $y \in \mathbb{R}^{d_{\mathrm{out}}}$。回顾第二节对 `RMSNorm` 的分析：每一层输入的每个词向量 $x$ 都是按**均方根范数（RMS Norm）**度量幅度的，即定义向量范数：

$$
\|x\|_{\mathrm{RMS}} \triangleq \frac{1}{\sqrt{d_{\mathrm{in}}}} \|x\|_2, \qquad \|y\|_{\mathrm{RMS}} \triangleq \frac{1}{\sqrt{d_{\mathrm{out}}}} \|y\|_2
$$

当参数从 $W$ 更新为 $W + \Delta W$ 时，同一输入 $x$ 产生的本层输出偏移量为 $\Delta y = \Delta W x$。为了保证无论隐藏层宽度 $d_{\mathrm{in}}, d_{\mathrm{out}}$ 如何变化，单步更新引起的输出激活均方根变化始终有界，衡量矩阵步长 $\Delta W$ 最恰当的尺子，就是“单位输入 RMS 所能引起的最大输出 RMS 变化”——即 **$\mathrm{RMS} \to \mathrm{RMS}$ 诱导算子范数**：

$$
\|\Delta W\|_{\mathrm{RMS} \to \mathrm{RMS}} \triangleq \max_{x \neq 0} \frac{\|\Delta W x\|_{\mathrm{RMS}}}{\|x\|_{\mathrm{RMS}}} = \max_{x \neq 0} \frac{\frac{1}{\sqrt{d_{\mathrm{out}}}}\|\Delta W x\|_2}{\frac{1}{\sqrt{d_{\mathrm{in}}}}\|x\|_2} = \sqrt{\frac{d_{\mathrm{in}}}{d_{\mathrm{out}}}} \max_{\|x\|_2 = 1} \|\Delta W x\|_2 = \sqrt{\frac{d_{\mathrm{in}}}{d_{\mathrm{out}}}}\, \sigma_1(\Delta W)
$$

其中 $\sigma_1(\Delta W) = \|\Delta W\|_2$ 是矩阵 $\Delta W$ 的最大奇异值（即标准谱范数 Spectral Norm）。

现在，给定当前步的动量矩阵 $\tilde{M} \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$（设其精简奇异值分解为 $\tilde{M} = U \Sigma V^\top = \sum_{i=1}^r \sigma_i u_i v_i^\top$，$\sigma_i > 0$），我们求解该诱导算子范数球约束下的最速下降问题：

$$
\min_{\|\Delta W\|_{\mathrm{RMS} \to \mathrm{RMS}} \le \eta} \langle \tilde{M}, \Delta W \rangle_F \quad \Longleftrightarrow \quad \min_{\sigma_1(\Delta W) \le \eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}} \mathrm{tr}(\tilde{M}^\top \Delta W)
$$

利用迹的循环交换律展开目标内积：

$$
\langle \tilde{M}, \Delta W \rangle_F = \mathrm{tr}\!\left(\sum_{i=1}^{r} \sigma_i v_i u_i^\top \Delta W\right) = \sum_{i=1}^{r} \sigma_i \, u_i^\top \Delta W v_i
$$

由于奇异向量满足 $\|u_i\|_2 = 1$ 且 $\|v_i\|_2 = 1$，由柯西-施瓦茨不等式与最大奇异值的定义，对每一个 $i \in \{1, \dots, r\}$ 都有：

$$
|u_i^\top \Delta W v_i| \le \|u_i\|_2 \, \|\Delta W v_i\|_2 \le \sigma_1(\Delta W) \le \eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}}
$$

再结合 $\sigma_i > 0$，立即得到目标函数的紧下界：

$$
\langle \tilde{M}, \Delta W \rangle_F = \sum_{i=1}^{r} \sigma_i \, u_i^\top \Delta W v_i \ge -\eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}} \sum_{i=1}^{r} \sigma_i
$$

不等号何时取到等号？当且仅当对**每一个**非零奇异值方向 $i = 1, \dots, r$，都有 $u_i^\top \Delta W v_i = -\eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}$ 同时成立。直接将半正交解

$$
\Delta W^* = -\eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}} \, U V^\top
$$

代入检验：一方面，$\sigma_1(\Delta W^*) = \eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}$，恰好落在可行域边界上；另一方面，$u_i^\top \Delta W^* v_i = -\eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}} \, u_i^\top \left(\sum_{k=1}^r u_k v_k^\top\right) v_i = -\eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}$，精确取满理论下界（当 $\tilde{M}$ 满秩 $r = \min(d_{\mathrm{out}}, d_{\mathrm{in}})$ 时该最优解唯一）。

这就是矩阵谱优化器 **Muon** 的核心几何依据：Frobenius 范数球约束只沿原始梯度方向推进，逐元素 $\ell_\infty$ 范数约束只平衡孤立坐标，而 $\mathrm{RMS} \to \mathrm{RMS}$ 算子谱范数约束要求**全部 $r$ 个相互正交的特征子空间以相等的步幅协同推进**。

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

在工业界使用 `Muon` 训练 Transformer 时，有一条标准的参数分配方式：内部隐藏层的二维投影矩阵（`W_q, W_k, W_v, W_o, W_up, W_down`）交给 `Muon`，而入口嵌入层（`tok_emb, pos_emb`）、出口分类头（`lm_head`）以及一维归一化参数（`RMSNorm`）继续交给 `AdamW`[@jordan2024][@liu2025]。

为什么同样是二维矩阵，词嵌入表与输出分类头不能使用全局谱正交化？我们仍然用**各层输入与输出空间自身携带的诱导范数**来检验[@bernstein2024]：

1. **词嵌入表 $E_{\mathrm{tok}} \in \mathbb{R}^{V \times D}$（映射方向 $\ell_1 \to \mathrm{RMS}$）**：如 1.1 节所述，嵌入层的输入是独热向量 $u \in \mathbb{R}^V$，其自然范数是绝对值和 $\|u\|_1 = 1$；输出是进入残差流的 $D$ 维向量，自然范数是 $\|\cdot\|_{\mathrm{RMS}}$。由于凸函数在多面体 $\ell_1$ 单位球上的最大值必在顶点（即全部 $V$ 个独热基向量 $u = e_v$）处取到，映射 $u \mapsto E_{\mathrm{tok}}^\top u$ 的诱导算子范数为：

$$
\|\Delta E_{\mathrm{tok}}^\top\|_{\ell_1 \to \mathrm{RMS}} = \max_{\|u\|_1 = 1} \|\Delta E_{\mathrm{tok}}^\top u\|_{\mathrm{RMS}} = \max_{v \in \{0, \dots, V-1\}} \|\Delta E_{\mathrm{tok}}[v, :]\|_{\mathrm{RMS}}
$$

可以看到，该诱导范数按词表的每一行独立取最大值，**各词元行之间在几何上完全解耦**（理论精确解是对每个激活词行独立做行 $\mathrm{RMS}$ 归一化，而非跨词表行做全局谱正交化）。此外，单批次仅激活至多 $B \times T$ 个词，嵌入梯度的绝大多数行为零；若直接做全局矩阵乘正交化，反而会把高频词与低频词的子空间相互耦合。
2. **输出分类头 $W_{\mathrm{head}} \in \mathbb{R}^{V \times D}$（映射方向 $\mathrm{RMS} \to \ell_\infty$）**：输入是单位 $\mathrm{RMS}$ 的末端隐状态 $h \in \mathbb{R}^D$，输出是进入 Softmax 的对数打分向量 $z = W_{\mathrm{head}} h \in \mathbb{R}^V$。Softmax 分布受打分最大分量变化 $\max_v |z_v| = \|z\|_\infty$ 控制，其诱导范数 $\|\Delta W_{\mathrm{head}}\|_{\mathrm{RMS} \to \ell_\infty} = \max_v \sqrt{D}\,\|\Delta W_{\mathrm{head}}[v, :]\|_2$ 同样是按词表行解耦的混合范数（而非全局谱范数）。在工程实践中，将 `tok_emb` 与 `lm_head` 统一交由逐坐标自适应的 `AdamW` 处理，既自然满足了“不同词元行互不串扰”的解耦要求，又能自适应调节各候选词的打分尺度[@jordan2024][@liu2025]。
3. **一维 `RMSNorm` 向量 $\gamma \in \mathbb{R}^D$**：即便视作 $D \times 1$ 矩阵，其秩上限 $\min(D, 1) = 1$，只有一个奇异值 $\sigma_1 = \|\gamma\|_2$，不存在多个奇异值之间的失衡问题；正交化会退化为整条向量除以模长，丢失逐通道独立调节能力。

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

理论推导给出了精确的目标矩阵 $O_t = U V^\top$，但若在工程代码中每一步直接对几十上百块 $4096 \times 4096$ 矩阵调用精确奇异值分解 `torch.linalg.svd`，则会遇到严重的硬件效率瓶颈：精确 SVD 依赖双对角化与串行特征值扫描，必须在 `float32` 高精度下执行大量细粒度向量旋转，无法发挥现代 GPU 半精度矩阵核心（Tensor Cores）的高吞吐算力。

2024 年 10 月，Keller Jordan 联合 Bernstein 等人提出的 **Muon（MomentUm Orthogonalized by Newton-Schulz）**[@jordan2024]，核心工程贡献正是用 **5 次 `bfloat16` 奇数次矩阵多项式迭代**替代精确 SVD。

### 5.1 为什么奇数次矩阵多项式能保持左右奇异向量不变

设矩阵 $X \in \mathbb{R}^{A \times B}$ 的精简奇异值分解为 $X = U \Sigma V^\top$。考察用 $X$ 和 $X^\top$ 交替相乘构造的奇数次幂：

$$
\begin{aligned}
(X X^\top) X &= (U \Sigma V^\top)(V \Sigma U^\top)(U \Sigma V^\top) = U \Sigma (V^\top V) \Sigma (U^\top U) \Sigma V^\top = U \Sigma^3 V^\top \\
(X X^\top)^2 X &= (U \Sigma^2 U^\top)^2 (U \Sigma V^\top) = U \Sigma^5 V^\top
\end{aligned}
$$

（注意偶数次幂 $X X^\top = U \Sigma^2 U^\top$ 会消掉右奇异向量 $V^\top$ 并把矩阵形状变成 $A \times A$，因此只有形如 $(X X^\top)^m X$ 的奇数次项才能完整保留 $U \cdot (\dots) \cdot V^\top$ 的双边子空间基底。）

由线性组合性质，对任意五次奇函数多项式 $\varphi(\sigma) = a \sigma + b \sigma^3 + c \sigma^5$，只要令格拉姆矩阵 $A_k = X_k X_k^\top$ 并执行纯矩阵乘法递推：

$$
X_{k+1} = a X_k + (b A_k + c A_k^2) X_k
$$

在奇异值分解视角下就严格等价于固定左右正交基 $U, V^\top$ 不动，对对角线上的每个奇异值独立迭代标量映射：

$$
X_{k+1} = U \varphi(\Sigma_k) V^\top, \qquad \sigma_{k+1, i} = \varphi(\sigma_{k, i}) = a \sigma_{k, i} + b \sigma_{k, i}^3 + c \sigma_{k, i}^5
$$

在进入第 $0$ 步迭代之前，有两步关键的预处理：

1. **Frobenius 范数预归一化保证初值落在 $[0, 1]$**：多项式 $\varphi(\sigma)$ 当 $\sigma$ 过大时会因五次项迅速发散到无穷，因此必须先把所有初始奇异值压缩到收敛域 $[0, 1]$ 内。利用恒等式 $\|\tilde{M}_t\|_F^2 = \sum_{j=1}^r \sigma_j^2 \ge \sigma_1^2$，只需令

$$
X_0 = \frac{\tilde{M}_t}{\|\tilde{M}_t\|_F + \epsilon}
$$

即可在不求最大奇异值的前提下，严格保证每个初始奇异值满足 $0 \le \sigma_{0, i} = \frac{\sigma_i}{\sqrt{\sum_j \sigma_j^2} + \epsilon} \le 1$。同时应当注意，任何正标量常数 $c > 0$ 在 $\frac{c \tilde{M}_t}{\|c \tilde{M}_t\|_F}$ 中都会分子分母精确约去，这也是为什么 `Muon` 的动量累积 $M_t = \mu M_{t-1} + G_t$ 无需乘 $(1-\mu)$，也无需像 `Adam` 那样做冷启动偏差修正。
2. **高瘦矩阵转置优化（$A > B$ 时先转置）**：当矩阵行数大于列数（如前馈升维层 $W_{\mathrm{up}} \in \mathbb{R}^{256 \times 64}$，$A = 4B$）时，直接算 $A_k = X_k X_k^\top$ 会生成较大的 $A \times A$ 方阵，单步矩阵乘耗费 $(2 A^2 B + A^3)$ 次乘加；而若先对 $X_0$ 取转置变成 $B \times A$ 的矮宽矩阵，中间方阵就缩小为 $B \times B$，单步仅耗费 $(2 A B^2 + B^3)$ 次乘加（在 $A = 4B$ 时单步乘加量从 $96 B^3$ 降至 $9 B^3$，节省超过 $90\%$ 算力）。由于 $\bigl(a X^\top + b (X^\top X) X^\top + c (X^\top X)^2 X^\top\bigr)^\top = a X + b (X X^\top) X + c (X X^\top)^2 X$，迭代结束后再转置回来，数学结果逐位等价。

### 5.2 经典牛顿-舒尔茨系数与 `Muon` 极小极大系数的设计权衡

多项式系数 $(a, b, c)$ 是怎么求出来的？我们先推导数值线性代数中的**经典牛顿-舒尔茨迭代（Classical Newton-Schulz）**。

要把任意正奇异值 $s > 0$ 迭代推向 $1$，一个直接的想法是对 $g(s) = s^2 - 1 = 0$ 用牛顿法，但算出的迭代式 $s_{k+1} = s_k - \frac{s_k^2 - 1}{2 s_k} = \frac{1}{2}(s_k + s_k^{-1})$ 含有负一次幂 $s_k^{-1}$，放回矩阵仍要求逆 $X_k^{-1}$。为了彻底消去矩阵求逆，改对等价方程 $f(s) = s^{-2} - 1 = 0$ 应用牛顿切线法，此时导数 $f'(s) = -2 s^{-3}$ 位于分母，恰好将负指数翻到分子变成纯正奇数次幂：

$$
s_{k+1} = s_k - \frac{f(s_k)}{f'(s_k)} = s_k - \frac{s_k^{-2} - 1}{-2 s_k^{-3}} = \frac{3}{2}s_k - \frac{1}{2}s_k^3
$$

这就是经典的三次牛顿-舒尔茨公式 $(a, b) = (1.5, -0.5)$。若推广到五次多项式 $\varphi_{\mathrm{classic}}(\sigma) = a\sigma + b\sigma^3 + c\sigma^5$ 并要求在不动点 $\sigma = 1$ 处达到三阶局部超线性收敛（即同时满足 $\varphi(1) = 1,\; \varphi'(1) = 0,\; \varphi''(1) = 0$），解三元一次方程组：

$$
\begin{cases}
a + b + c = 1 \\
a + 3b + 5c = 0 \\
6b + 20c = 0
\end{cases}
\quad \Longrightarrow \quad
(a, b, c)_{\mathrm{classic}} = \left(\frac{15}{8},\; -\frac{10}{8},\; \frac{3}{8}\right) = (1.875,\; -1.25,\; 0.375)
$$

把经典系数放进神经网络训练中立刻会遇到一个现实障碍：当矩阵维度为 $4096$ 且存在上万倍奇异值跨度时，除以 $\|\tilde{M}_t\|_F$ 后大量尾部奇异值落在 $\sigma_0 \in [10^{-3}, 10^{-2}]$ 区间。对于接近 $0$ 的微小奇异值，高次项 $\sigma^3, \sigma^5$ 可忽略，每一步放大倍数完全取决于原点处的一阶导数 $\varphi'(0) = a$。经典系数 $a = 1.875$ 连跑 5 步，对微弱奇异值的累计放大上限仅为 $1.875^5 \approx 23.2$ 倍——例如 $\sigma_0 = 0.01$ 跑完 5 步仅升至 $0.21$，远未靠近 $1$。

Jordan 等人的设计思路是：在 `bfloat16` 只有 7 位尾数精度的随机梯度训练中，把奇异值收敛到小数点后六位的 $1.000000$ 并无必要；真正决定训练效率的是**在固定 5 步预算内把尽可能小的尾部奇异值拉升上来**。因此，`Muon` 放弃了 $\varphi(1) = 1$ 的精确不动点约束，允许五次复合曲线 $\varphi^{(5)}(\sigma)$ 在 $1$ 附近的一个有界窄带 $[1 - \delta, 1 + \delta]$ 内做等波纹振荡（类似切比雪夫极小极大逼近），以此换取在全区间不发散前提下尽可能大的原点斜率 $a$，选定系数为[@jordan2024]：

$$
(a, b, c)_{\mathrm{Muon}} = (3.4445,\; -4.7750,\; 2.0315)
$$

我们可以直接验算这组系数的两个关键数字：

- **小奇异值放大能力**：原点斜率从 $1.875$ 提升至 $3.4445$，5 步累计线性放大倍数达到 $3.4445^5 \approx 484.4$ 倍（是经典系数的 $20.9$ 倍），初始 $\sigma_0 = 0.01$ 经过 5 步即可升至 $\varphi^{(5)}(0.01) \approx 0.70$；
- **为什么代入 $\sigma = 1$ 算得 $\varphi(1) = 3.4445 - 4.7750 + 2.0315 = 0.7010 \neq 1$**：这并非笔误，而是极小极大设计主动让出的波谷下界——落在 $[0.01, 1.0]$ 内的奇异值经过 5 次复合后都会进入 $[0.68, 1.13]$ 窄带（而个别处于 $(0, 0.01)$ 的极小奇异值在爬升途中可能最高到达多项式峰值 $\max \varphi \approx 1.20$，故总体上界约为 $1.20$）。

下图左侧面板画出了 $\varphi(\sigma)$ 复合 1、3、5 次后的精确函数图像，右侧面板展示了双层迷你 Transformer 在训练第 25 步时第 1 层 `W_q` 动量矩阵全部 64 个奇异值在更新前后的实测对比。可以看到，不仅原始动量首尾相差 $13,669$ 倍，即便用 `AdamW` 逐元素除以 $\sqrt{\hat{v}_t}$ 后，更新矩阵的奇异值谱依然衰减了逾两千倍；而经过 5 步牛顿-舒尔茨迭代后，前 53 个奇异值全部落入 $[0.68, 1.20]$ 区间。

```plot title="牛顿-舒尔茨五次多项式复合映射曲线与真实 Transformer $W_q$ 奇异值谱对比" note="左面板：$\varphi(\sigma) = 3.4445\sigma - 4.7750\sigma^3 + 2.0315\sigma^5$ 迭代 1、3、5 次后的映射曲线；右面板：双层 Mini-Transformer（$D=64$）第 25 步第 1 层 $W_q$ 动量矩阵的 64 个奇异值实测（原始动量与 AdamW 更新按各自最大奇异值归一化以对比谱形状）。"
{"cols":2,"narrowCols":1,"legend":[{"label":"Muon 5 步迭代 $\\varphi^{(5)}(\\sigma)$ / $O_t$ 谱","color":"var(--teal)","shape":"line"},{"label":"1 步映射 / AdamW 更新谱","color":"var(--orange)","shape":"dash"},{"label":"原始动量 $\\tilde{M}_t$ 谱（首尾比 13,669×）","color":"var(--clay)","shape":"line"},{"label":"$[0.01, 1]$ 收敛带 $[0.68, 1.13]$","color":"var(--teal)","shape":"band"}],"data":{"ns":[{"s0":0.0,"id":0.0,"k1":0.0,"k3":0.0,"k5":0.0},{"s0":0.01,"id":0.01,"k1":0.0344,"k3":0.4001,"k5":0.6989},{"s0":0.02,"id":0.02,"k1":0.0689,"k3":0.7506,"k5":0.6818},{"s0":0.03,"id":0.03,"k1":0.1032,"k3":1.012,"k5":1.1223},{"s0":0.04,"id":0.04,"k1":0.1375,"k3":1.1626,"k5":0.9514},{"s0":0.05,"id":0.05,"k1":0.1716,"k3":1.2016,"k5":0.7581},{"s0":0.06,"id":0.06,"k1":0.2056,"k3":1.1482,"k5":1.0056},{"s0":0.07,"id":0.07,"k1":0.2395,"k3":1.0355,"k5":1.1325},{"s0":0.08,"id":0.08,"k1":0.2731,"k3":0.9023,"k5":0.9524},{"s0":0.09,"id":0.09,"k1":0.3065,"k3":0.7843,"k5":0.7005},{"s0":0.1,"id":0.1,"k1":0.3397,"k3":0.7071,"k5":0.7121},{"s0":0.11,"id":0.11,"k1":0.3726,"k3":0.6818,"k5":0.7531},{"s0":0.12,"id":0.12,"k1":0.4051,"k3":0.7053,"k5":0.7145},{"s0":0.13,"id":0.13,"k1":0.4374,"k3":0.7629,"k5":0.6843},{"s0":0.14,"id":0.14,"k1":0.4692,"k3":0.8339,"k5":0.786},{"s0":0.15,"id":0.15,"k1":0.5007,"k3":0.8974,"k5":0.9409},{"s0":0.16,"id":0.16,"k1":0.5318,"k3":0.9374,"k5":1.0279},{"s0":0.17,"id":0.17,"k1":0.5624,"k3":0.9454,"k5":1.0427},{"s0":0.18,"id":0.18,"k1":0.5925,"k3":0.9219,"k5":0.9967},{"s0":0.19,"id":0.19,"k1":0.6222,"k3":0.8745,"k5":0.8842},{"s0":0.2,"id":0.2,"k1":0.6514,"k3":0.815,"k5":0.7468},{"s0":0.21,"id":0.21,"k1":0.68,"k3":0.7566,"k5":0.6824},{"s0":0.22,"id":0.22,"k1":0.708,"k3":0.7109,"k5":0.7072},{"s0":0.23,"id":0.23,"k1":0.7354,"k3":0.6856,"k5":0.7461},{"s0":0.24,"id":0.24,"k1":0.7623,"k3":0.6841,"k5":0.7489},{"s0":0.25,"id":0.25,"k1":0.7885,"k3":0.7053,"k5":0.7145},{"s0":0.26,"id":0.26,"k1":0.8141,"k3":0.7451,"k5":0.6823},{"s0":0.27,"id":0.27,"k1":0.8389,"k3":0.7974,"k5":0.7172},{"s0":0.28,"id":0.28,"k1":0.8631,"k3":0.8558,"k5":0.8377},{"s0":0.29,"id":0.29,"k1":0.8866,"k3":0.9145,"k5":0.9804},{"s0":0.3,"id":0.3,"k1":0.9094,"k3":0.9689,"k5":1.0796},{"s0":0.31,"id":0.31,"k1":0.9314,"k3":1.0162,"k5":1.1248},{"s0":0.32,"id":0.32,"k1":0.9526,"k3":1.055,"k5":1.1342},{"s0":0.33,"id":0.33,"k1":0.973,"k3":1.0851,"k5":1.1226},{"s0":0.34,"id":0.34,"k1":0.9927,"k3":1.1071,"k5":1.0998},{"s0":0.35,"id":0.35,"k1":1.0115,"k3":1.122,"k5":1.0748},{"s0":0.36,"id":0.36,"k1":1.0295,"k3":1.1308,"k5":1.0556},{"s0":0.37,"id":0.37,"k1":1.0467,"k3":1.1343,"k5":1.0469},{"s0":0.38,"id":0.38,"k1":1.063,"k3":1.1329,"k5":1.0504},{"s0":0.39,"id":0.39,"k1":1.0784,"k3":1.1268,"k5":1.0647},{"s0":0.4,"id":0.4,"k1":1.093,"k3":1.1161,"k5":1.0859},{"s0":0.41,"id":0.41,"k1":1.1067,"k3":1.1004,"k5":1.1083},{"s0":0.42,"id":0.42,"k1":1.1195,"k3":1.0797,"k5":1.1261},{"s0":0.43,"id":0.43,"k1":1.1314,"k3":1.0542,"k5":1.1342},{"s0":0.44,"id":0.44,"k1":1.1423,"k3":1.0244,"k5":1.1288},{"s0":0.45,"id":0.45,"k1":1.1524,"k3":0.9911,"k5":1.1056},{"s0":0.46,"id":0.46,"k1":1.1615,"k3":0.9558,"k5":1.0602},{"s0":0.47,"id":0.47,"k1":1.1698,"k3":0.9199,"k5":0.9923},{"s0":0.48,"id":0.48,"k1":1.177,"k3":0.885,"k5":0.9106},{"s0":0.49,"id":0.49,"k1":1.1834,"k3":0.8528,"k5":0.8303},{"s0":0.5,"id":0.5,"k1":1.1889,"k3":0.8244,"k5":0.7654},{"s0":0.51,"id":0.51,"k1":1.1934,"k3":0.8006,"k5":0.722},{"s0":0.52,"id":0.52,"k1":1.197,"k3":0.7818,"k5":0.6978},{"s0":0.53,"id":0.53,"k1":1.1997,"k3":0.7681,"k5":0.6869},{"s0":0.54,"id":0.54,"k1":1.2014,"k3":0.7592,"k5":0.6831},{"s0":0.55,"id":0.55,"k1":1.2023,"k3":0.755,"k5":0.6821},{"s0":0.56,"id":0.56,"k1":1.2022,"k3":0.7552,"k5":0.6822},{"s0":0.57,"id":0.57,"k1":1.2013,"k3":0.7598,"k5":0.6832},{"s0":0.58,"id":0.58,"k1":1.1995,"k3":0.7689,"k5":0.6874},{"s0":0.59,"id":0.59,"k1":1.1968,"k3":0.7827,"k5":0.6987},{"s0":0.6,"id":0.6,"k1":1.1933,"k3":0.8011,"k5":0.7229},{"s0":0.61,"id":0.61,"k1":1.1889,"k3":0.8242,"k5":0.7651},{"s0":0.62,"id":0.62,"k1":1.1837,"k3":0.8514,"k5":0.8269},{"s0":0.63,"id":0.63,"k1":1.1777,"k3":0.8819,"k5":0.9028},{"s0":0.64,"id":0.64,"k1":1.1709,"k3":0.9147,"k5":0.9809},{"s0":0.65,"id":0.65,"k1":1.1633,"k3":0.9484,"k5":1.0479},{"s0":0.66,"id":0.66,"k1":1.155,"k3":0.9816,"k5":1.0955},{"s0":0.67,"id":0.67,"k1":1.1459,"k3":1.0131,"k5":1.123},{"s0":0.68,"id":0.68,"k1":1.1362,"k3":1.0418,"k5":1.1338},{"s0":0.69,"id":0.69,"k1":1.1258,"k3":1.0669,"k5":1.1318},{"s0":0.7,"id":0.7,"k1":1.1148,"k3":1.0881,"k5":1.1203},{"s0":0.71,"id":0.71,"k1":1.1031,"k3":1.1051,"k5":1.1025},{"s0":0.72,"id":0.72,"k1":1.0909,"k3":1.118,"k5":1.0824},{"s0":0.73,"id":0.73,"k1":1.0781,"k3":1.127,"k5":1.0642},{"s0":0.74,"id":0.74,"k1":1.0648,"k3":1.1324,"k5":1.0516},{"s0":0.75,"id":0.75,"k1":1.051,"k3":1.1344,"k5":1.0467},{"s0":0.76,"id":0.76,"k1":1.0368,"k3":1.1329,"k5":1.0505},{"s0":0.77,"id":0.77,"k1":1.0222,"k3":1.1279,"k5":1.0624},{"s0":0.78,"id":0.78,"k1":1.0073,"k3":1.1192,"k5":1.0803},{"s0":0.79,"id":0.79,"k1":0.992,"k3":1.1065,"k5":1.1007},{"s0":0.8,"id":0.8,"k1":0.9765,"k3":1.0895,"k5":1.1192},{"s0":0.81,"id":0.81,"k1":0.9608,"k3":1.0679,"k5":1.1315},{"s0":0.82,"id":0.82,"k1":0.9449,"k3":1.0417,"k5":1.1338},{"s0":0.83,"id":0.83,"k1":0.9289,"k3":1.0112,"k5":1.1218},{"s0":0.84,"id":0.84,"k1":0.9128,"k3":0.9767,"k5":1.0898},{"s0":0.85,"id":0.85,"k1":0.8968,"k3":0.9393,"k5":1.0315},{"s0":0.86,"id":0.86,"k1":0.8808,"k3":0.9,"k5":0.9469},{"s0":0.87,"id":0.87,"k1":0.8649,"k3":0.8602,"k5":0.8486},{"s0":0.88,"id":0.88,"k1":0.8492,"k3":0.8216,"k5":0.7598},{"s0":0.89,"id":0.89,"k1":0.8338,"k3":0.7857,"k5":0.702},{"s0":0.9,"id":0.9,"k1":0.8187,"k3":0.7539,"k5":0.682},{"s0":0.91,"id":0.91,"k1":0.8039,"k3":0.7273,"k5":0.6908},{"s0":0.92,"id":0.92,"k1":0.7896,"k3":0.7067,"k5":0.7126},{"s0":0.93,"id":0.93,"k1":0.7759,"k3":0.6924,"k5":0.7343},{"s0":0.94,"id":0.94,"k1":0.7627,"k3":0.6843,"k5":0.7486},{"s0":0.95,"id":0.95,"k1":0.7502,"k3":0.6818,"k5":0.7531},{"s0":0.96,"id":0.96,"k1":0.7385,"k3":0.6843,"k5":0.7486},{"s0":0.97,"id":0.97,"k1":0.7277,"k3":0.6905,"k5":0.7375},{"s0":0.98,"id":0.98,"k1":0.7177,"k3":0.6994,"k5":0.7231},{"s0":0.99,"id":0.99,"k1":0.7088,"k3":0.7098,"k5":0.7085},{"s0":1.0,"id":1.0,"k1":0.701,"k3":0.7207,"k5":0.6964}],"band1":[{"x":0.0,"lo":0.6818,"hi":1.1344},{"x":1.0,"lo":0.6818,"hi":1.1344}],"band2":[{"x":1,"lo":0.6818,"hi":1.1344},{"x":64,"lo":0.6818,"hi":1.1344}],"svd":[{"idx":1,"raw":1.0,"adamw":1.0,"muon":1.2007},{"idx":2,"raw":0.5543,"adamw":0.8475,"muon":1.1964},{"idx":3,"raw":0.3382,"adamw":0.5205,"muon":1.1935},{"idx":4,"raw":0.2587,"adamw":0.3883,"muon":1.1749},{"idx":5,"raw":0.1777,"adamw":0.3127,"muon":1.1506},{"idx":6,"raw":0.139,"adamw":0.2501,"muon":1.1341},{"idx":7,"raw":0.1122,"adamw":0.2177,"muon":1.1304},{"idx":8,"raw":0.1051,"adamw":0.1945,"muon":1.1269},{"idx":9,"raw":0.0732,"adamw":0.1593,"muon":1.1122},{"idx":10,"raw":0.0689,"adamw":0.1533,"muon":1.1037},{"idx":11,"raw":0.057,"adamw":0.1373,"muon":1.096},{"idx":12,"raw":0.0561,"adamw":0.1255,"muon":1.0942},{"idx":13,"raw":0.0495,"adamw":0.124,"muon":1.0746},{"idx":14,"raw":0.0449,"adamw":0.1107,"muon":1.0629},{"idx":15,"raw":0.0407,"adamw":0.105,"muon":1.0549},{"idx":16,"raw":0.0371,"adamw":0.0984,"muon":1.0364},{"idx":17,"raw":0.0352,"adamw":0.0934,"muon":1.0221},{"idx":18,"raw":0.0308,"adamw":0.0877,"muon":0.9834},{"idx":19,"raw":0.029,"adamw":0.0847,"muon":0.9444},{"idx":20,"raw":0.0278,"adamw":0.078,"muon":0.9384},{"idx":21,"raw":0.0261,"adamw":0.0754,"muon":0.9342},{"idx":22,"raw":0.0251,"adamw":0.0723,"muon":0.9319},{"idx":23,"raw":0.0231,"adamw":0.0705,"muon":0.9309},{"idx":24,"raw":0.0221,"adamw":0.063,"muon":0.9208},{"idx":25,"raw":0.0202,"adamw":0.0604,"muon":0.9076},{"idx":26,"raw":0.019,"adamw":0.0586,"muon":0.8924},{"idx":27,"raw":0.0175,"adamw":0.0544,"muon":0.8863},{"idx":28,"raw":0.0158,"adamw":0.0512,"muon":0.88},{"idx":29,"raw":0.0153,"adamw":0.0492,"muon":0.8593},{"idx":30,"raw":0.0138,"adamw":0.0473,"muon":0.8521},{"idx":31,"raw":0.0132,"adamw":0.0457,"muon":0.8331},{"idx":32,"raw":0.0125,"adamw":0.0428,"muon":0.8155},{"idx":33,"raw":0.0117,"adamw":0.0423,"muon":0.8028},{"idx":34,"raw":0.0103,"adamw":0.0394,"muon":0.7985},{"idx":35,"raw":0.0098,"adamw":0.0381,"muon":0.7961},{"idx":36,"raw":0.0085,"adamw":0.037,"muon":0.7891},{"idx":37,"raw":0.0083,"adamw":0.0349,"muon":0.7767},{"idx":38,"raw":0.0076,"adamw":0.0323,"muon":0.7655},{"idx":39,"raw":0.0072,"adamw":0.0292,"muon":0.7579},{"idx":40,"raw":0.0069,"adamw":0.0282,"muon":0.7531},{"idx":41,"raw":0.0066,"adamw":0.0275,"muon":0.7411},{"idx":42,"raw":0.006,"adamw":0.0241,"muon":0.7389},{"idx":43,"raw":0.0057,"adamw":0.0227,"muon":0.7304},{"idx":44,"raw":0.005,"adamw":0.0216,"muon":0.7276},{"idx":45,"raw":0.0048,"adamw":0.0213,"muon":0.7217},{"idx":46,"raw":0.0041,"adamw":0.0195,"muon":0.7155},{"idx":47,"raw":0.0034,"adamw":0.0188,"muon":0.7029},{"idx":48,"raw":0.0033,"adamw":0.0171,"muon":0.7007},{"idx":49,"raw":0.0028,"adamw":0.0157,"muon":0.6977},{"idx":50,"raw":0.0028,"adamw":0.0154,"muon":0.6957},{"idx":51,"raw":0.0024,"adamw":0.0138,"muon":0.6882},{"idx":52,"raw":0.0021,"adamw":0.013,"muon":0.6822},{"idx":53,"raw":0.002,"adamw":0.0113,"muon":0.6819},{"idx":54,"raw":0.0016,"adamw":0.0109,"muon":0.5902},{"idx":55,"raw":0.0015,"adamw":0.0087,"muon":0.5366},{"idx":56,"raw":0.0012,"adamw":0.0077,"muon":0.4558},{"idx":57,"raw":0.0012,"adamw":0.0064,"muon":0.4354},{"idx":58,"raw":0.0011,"adamw":0.0053,"muon":0.4271},{"idx":59,"raw":0.0009,"adamw":0.0048,"muon":0.3298},{"idx":60,"raw":0.0006,"adamw":0.0039,"muon":0.2364},{"idx":61,"raw":0.0005,"adamw":0.0033,"muon":0.1728},{"idx":62,"raw":0.0003,"adamw":0.0026,"muon":0.1185},{"idx":63,"raw":0.0002,"adamw":0.0015,"muon":0.0697},{"idx":64,"raw":0.0001,"adamw":0.0004,"muon":0.0281}]},"panels":[{"title":"五次多项式迭代 · $\\varphi(\\sigma) = 3.4445\\sigma - 4.7750\\sigma^3 + 2.0315\\sigma^5$","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"初始归一化奇异值 (0 至 1)","domain":[0,1.02]},"y":{"label":"映射后奇异值","domain":[0,1.28]},"grid":true,"marks":[{"mark":"areaY","data":"band1","x":"x","y1":"lo","y2":"hi","fill":"var(--teal)","fillOpacity":0.13},{"mark":"ruleY","data":[1.0],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"line","data":"ns","x":"s0","y":"id","stroke":"var(--stone)","strokeDasharray":"4 4"},{"mark":"line","data":"ns","x":"s0","y":"k1","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"ns","x":"s0","y":"k3","stroke":"var(--blue)","strokeWidth":1.6},{"mark":"line","data":"ns","x":"s0","y":"k5","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":[{"s0":1.0,"k1":0.701}],"x":"s0","y":"k1","fill":"var(--clay)","r":4.2,"tip":["s0","k1"]},{"mark":"text","data":[{"x":0.99,"y":0.56,"t":"右端红点: 0.701"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"}]},{"title":"第 1 层 $W_q$ ($64\\times 64$) 第 25 步奇异值谱实测","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"奇异值序号（第 1 至第 64，从大到小）","domain":[1,64]},"y":{"label":"奇异值大小","domain":[0,1.28]},"grid":true,"marks":[{"mark":"areaY","data":"band2","x":"x","y1":"lo","y2":"hi","fill":"var(--teal)","fillOpacity":0.13},{"mark":"ruleY","data":[1.0],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"line","data":"svd","x":"idx","y":"raw","stroke":"var(--clay)","strokeWidth":2.1},{"mark":"line","data":"svd","x":"idx","y":"adamw","stroke":"var(--orange)","strokeWidth":1.9,"strokeDasharray":"5 3"},{"mark":"line","data":"svd","x":"idx","y":"muon","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":"svd","x":"idx","y":"muon","fill":"var(--teal)","r":2.0,"tip":["idx","muon","adamw","raw"]},{"mark":"text","data":[{"x":63,"y":1.19,"t":"Muon：前 53 个方向落在 [0.68, 1.20]"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"},{"mark":"text","data":[{"x":14,"y":0.15,"t":"原始动量谱：尾部衰减 13,669 倍"}],"x":"x","y":"y","text":"t","textAnchor":"start","fill":"var(--clay)"}]}]}
```

### 5.3 月之暗面的规模化改进：单元素更新 RMS 对齐与权重衰减推导

当把原版 `Muon` 从中小规模实验扩展到百亿参数大模型预训练时，月之暗面（Moonshot AI，Liu, Su et al., 2025）在 *Muon is Scalable for LLM Training*[@liu2025] 中解决了两个关键的规模化衔接问题。

**第一，不同尺寸矩阵与 `AdamW` 之间的学习率迁移推导。**

设近似半正交矩阵 $O_t \in \mathbb{R}^{A \times B}$ 的秩为 $r = \min(A, B)$，且非零奇异值均约为 $1$。它的全体元素平方和等于其奇异值平方和：

$$
\|O_t\|_F^2 = \sum_{i=1}^{A} \sum_{j=1}^{B} O_{t, ij}^2 = \sum_{k=1}^{\min(A, B)} \sigma_k^2 \approx \min(A, B)
$$

把这份总能量均摊到 $A \cdot B$ 个矩阵元素上，单个参数元素的更新均方根幅度（Update RMS）为：

$$
\mathrm{RMS}(O_t) \triangleq \sqrt{\frac{1}{A B} \|O_t\|_F^2} \approx \sqrt{\frac{\min(A, B)}{A B}} = \frac{1}{\sqrt{\max(A, B)}}
$$

对比之前的长宽比因子可以看到：4.3 节 $\mathrm{RMS} \to \mathrm{RMS}$ 算子范数导出的理论因子是 $\sqrt{A / B}$（在降维层 $A < B$ 如 $W_{\mathrm{down}}$ 上更新 RMS 为 $\sqrt{A}/B$，Keller Jordan 的开源实现为防止降维层步幅减半而改用截断形式 $\sqrt{\max(1, A/B)}$，使单元素更新 RMS 成为 $\frac{\sqrt{\max(1, A/B)}}{\sqrt{\max(A, B)}} = \frac{1}{\sqrt{B}}$）。无论哪一种，单元素更新幅度都会随模型隐藏维宽度 $B = d_{\mathrm{in}}$ 的增大而按 $1/\sqrt{d_{\mathrm{in}}}$ 缩小。这导致每当调整隐藏维宽度，或者在同一网络内部面对不同宽度的注意力头、MLP 与专家层时，单元素步幅不统一，且必须为 `Muon` 单独搜索一套比 `AdamW` 大一个数量级的专用学习率（如 `lr = 0.02`）。

那么，成熟 `AdamW` 在训练稳态下的单元素更新 RMS 大约是多少？我们可以用随机过程算一个简洁的理论估计：假设中后期某坐标梯度序列 $\{g_t\}$ 近似为零均值、方差为 $\sigma^2$ 的独立同分布随机变量（$\mathbb{E}[g_t] = 0,\; \mathbb{E}[g_t^2] = \sigma^2$）。当步数 $t$ 足够大时：

- 二阶矩期望为 $\mathbb{E}[v_t] = (1 - \beta_2)\sum_{k=0}^\infty \beta_2^k \mathbb{E}[g_{t-k}^2] = \sigma^2$；
- 一阶矩平方期望（因跨步独立交叉项 $\mathbb{E}[g_i g_j] = 0$）为：

$$
\mathbb{E}[m_t^2] = (1 - \beta_1)^2 \sum_{k=0}^{\infty} \beta_1^{2k} \mathbb{E}[g_{t-k}^2] = \frac{(1 - \beta_1)^2}{1 - \beta_1^2} \sigma^2 = \frac{1 - \beta_1}{1 + \beta_1} \sigma^2
$$

当 $\beta_2$ 接近 $1$ 时，$v_t$ 在其期望 $\sigma^2$ 附近高度集中，采用一阶近似 $\mathbb{E}[m_t^2 / v_t] \approx \mathbb{E}[m_t^2] / \mathbb{E}[v_t]$，可得 `AdamW` 单元素无量纲更新步 $u_t = m_t / \sqrt{v_t}$ 的均方根幅度约为：

$$
\mathrm{RMS}(u_t^{\mathrm{AdamW}}) \approx \sqrt{\frac{\mathbb{E}[m_t^2]}{\mathbb{E}[v_t]}} = \sqrt{\frac{1 - \beta_1}{1 + \beta_1}}
$$

代入标准参数 $\beta_1 = 0.9$，立得 $\sqrt{0.1 / 1.9} \approx 0.229$（考虑真实梯度的局部时间正相关性，实测值稳定落在 $0.2 \sim 0.4$ 之间[@liu2025]）。

因此，只需给 `Muon` 的正交化矩阵 $O_t$ 乘上缩放因子 $0.2\sqrt{\max(A, B)}$，就能精确消掉分母 $\frac{1}{\sqrt{\max(A, B)}}$，将任意长宽尺寸矩阵的单元素更新 RMS 恒定对齐在 $0.2$ 附近：

$$
W_t = (1 - \eta \lambda) W_{t-1} - \eta \cdot 0.2\sqrt{\max(A, B)} \, O_t
$$

对齐之后，`Muon` 与负责词表和分类头的 `AdamW` 可以**直接共用完全相同的学习率调度器 $\eta_t$ 与权重衰减率 $\lambda$**，消除了跨规模调参成本。

**第二，为什么大规模长周期预训练必须引入解耦权重衰减？**

写出无权重衰减（$\lambda = 0$）时权重矩阵 Frobenius 范数平方的单步演化（记 $\Delta_t = \eta \cdot 0.2\sqrt{\max(A,B)}\,O_t$）：

$$
\|W_t\|_F^2 = \|W_{t-1} - \Delta_t\|_F^2 = \|W_{t-1}\|_F^2 - 2\langle W_{t-1}, \Delta_t \rangle_F + \|\Delta_t\|_F^2
$$

在训练后期梯度包含大量随机噪声时，与历史权重近似正交的更新分量使正二次项 $\|\Delta_t\|_F^2 \approx 0.04 \eta^2 A B$ 持续累加，缺少收缩力来平衡它，导致隐藏层权重模长 $\|W_t\|_F$ 随训练步数单调增长，引发注意力内积饱和与激活数值溢出。加入解耦衰减 $(1 - \eta \lambda)W_{t-1}$ 后，每一步提供约 $-2\eta\lambda\|W_{t-1}\|_F^2$ 的收缩项；当 $\langle W, \Delta_t \rangle_F \approx 0$ 时，令收缩项与注入项 $0.04 \eta^2 A B$ 相抵，参数均方根便收敛于有界平衡态 $\mathrm{RMS}(W_{\mathrm{eq}}) \approx \sqrt{0.02 \eta / \lambda}$[@liu2025]。

下面三组受控消融实验分别印证了 4.4 节与 5.3 节的三项理论结论：将词嵌入与分类头一并交给 `Muon` 会导致验证损失下降变慢并在后期回升；设 `wd = 0` 时隐藏层权重范数持续线性增长；而乘上 $0.2\sqrt{\max(A, B)}$ 后，从 $64 \times 64$ 到 $2048 \times 512$ 的单元素更新 RMS 始终稳定在 $0.17 \sim 0.19$ 之间。

```plot title="参数分流、解耦权重衰减与跨尺寸 RMS 对齐三组受控消融实验" note="前两面板测于双层 Mini-Transformer 360 步训练；右面板实测高斯随机矩阵经 5 步牛顿-舒尔茨迭代后的单元素均方根（横轴为长边维度 $A=\max(A,B)$：首点为 $64\times 64$ 方阵，其余长宽比固定为 $4:1$，即 $256\times 64$ 至 $2048\times 512$）。"
{"cols":3,"narrowCols":1,"legend":[{"label":"分流混合 / 含衰减 / $0.2\\sqrt{\\max(A,B)}$ 对齐","color":"var(--teal)","shape":"line"},{"label":"消融对照：全量 Muon / 无衰减 $\\lambda=0$ / 未缩放 $O_t$","color":"var(--clay)","shape":"dash"},{"label":"截断长宽比缩放 $\\sqrt{\\max(1, A/B)}$","color":"var(--orange)","shape":"line"}],"data":{"ab":[{"step":1,"loss_hybrid":4.943,"loss_all_muon":5.012,"wnorm_nowd":19.54,"wnorm_wd":19.52},{"step":8,"loss_hybrid":4.329,"loss_all_muon":4.829,"wnorm_nowd":19.65,"wnorm_wd":19.46},{"step":16,"loss_hybrid":3.555,"loss_all_muon":4.589,"wnorm_nowd":19.97,"wnorm_wd":19.58},{"step":24,"loss_hybrid":3.145,"loss_all_muon":4.284,"wnorm_nowd":20.49,"wnorm_wd":19.92},{"step":32,"loss_hybrid":2.921,"loss_all_muon":3.96,"wnorm_nowd":21.0,"wnorm_wd":20.26},{"step":40,"loss_hybrid":2.825,"loss_all_muon":3.703,"wnorm_nowd":21.56,"wnorm_wd":20.65},{"step":48,"loss_hybrid":2.796,"loss_all_muon":3.451,"wnorm_nowd":22.26,"wnorm_wd":21.18},{"step":56,"loss_hybrid":2.773,"loss_all_muon":3.258,"wnorm_nowd":23.01,"wnorm_wd":21.75},{"step":64,"loss_hybrid":2.778,"loss_all_muon":3.123,"wnorm_nowd":23.74,"wnorm_wd":22.31},{"step":72,"loss_hybrid":2.781,"loss_all_muon":3.039,"wnorm_nowd":24.42,"wnorm_wd":22.82},{"step":80,"loss_hybrid":2.775,"loss_all_muon":2.966,"wnorm_nowd":25.06,"wnorm_wd":23.28},{"step":88,"loss_hybrid":2.772,"loss_all_muon":2.906,"wnorm_nowd":25.64,"wnorm_wd":23.67},{"step":96,"loss_hybrid":2.778,"loss_all_muon":2.867,"wnorm_nowd":26.15,"wnorm_wd":23.98},{"step":104,"loss_hybrid":2.771,"loss_all_muon":2.836,"wnorm_nowd":26.58,"wnorm_wd":24.21},{"step":112,"loss_hybrid":2.759,"loss_all_muon":2.811,"wnorm_nowd":26.97,"wnorm_wd":24.4},{"step":120,"loss_hybrid":2.741,"loss_all_muon":2.786,"wnorm_nowd":27.33,"wnorm_wd":24.57},{"step":128,"loss_hybrid":2.732,"loss_all_muon":2.781,"wnorm_nowd":27.68,"wnorm_wd":24.73},{"step":136,"loss_hybrid":2.724,"loss_all_muon":2.769,"wnorm_nowd":28.04,"wnorm_wd":24.88},{"step":144,"loss_hybrid":2.701,"loss_all_muon":2.746,"wnorm_nowd":28.39,"wnorm_wd":25.04},{"step":152,"loss_hybrid":2.683,"loss_all_muon":2.736,"wnorm_nowd":28.75,"wnorm_wd":25.2},{"step":160,"loss_hybrid":2.663,"loss_all_muon":2.725,"wnorm_nowd":29.11,"wnorm_wd":25.37},{"step":168,"loss_hybrid":2.656,"loss_all_muon":2.712,"wnorm_nowd":29.47,"wnorm_wd":25.53},{"step":176,"loss_hybrid":2.65,"loss_all_muon":2.708,"wnorm_nowd":29.85,"wnorm_wd":25.71},{"step":184,"loss_hybrid":2.641,"loss_all_muon":2.704,"wnorm_nowd":30.22,"wnorm_wd":25.87},{"step":192,"loss_hybrid":2.642,"loss_all_muon":2.699,"wnorm_nowd":30.57,"wnorm_wd":26.02},{"step":200,"loss_hybrid":2.636,"loss_all_muon":2.686,"wnorm_nowd":30.91,"wnorm_wd":26.15},{"step":208,"loss_hybrid":2.647,"loss_all_muon":2.701,"wnorm_nowd":31.24,"wnorm_wd":26.27},{"step":216,"loss_hybrid":2.638,"loss_all_muon":2.698,"wnorm_nowd":31.58,"wnorm_wd":26.41},{"step":224,"loss_hybrid":2.656,"loss_all_muon":2.718,"wnorm_nowd":31.95,"wnorm_wd":26.58},{"step":232,"loss_hybrid":2.651,"loss_all_muon":2.72,"wnorm_nowd":32.3,"wnorm_wd":26.72},{"step":240,"loss_hybrid":2.659,"loss_all_muon":2.721,"wnorm_nowd":32.66,"wnorm_wd":26.86},{"step":248,"loss_hybrid":2.662,"loss_all_muon":2.723,"wnorm_nowd":33.01,"wnorm_wd":27.01},{"step":256,"loss_hybrid":2.659,"loss_all_muon":2.729,"wnorm_nowd":33.37,"wnorm_wd":27.17},{"step":264,"loss_hybrid":2.687,"loss_all_muon":2.756,"wnorm_nowd":33.73,"wnorm_wd":27.33},{"step":272,"loss_hybrid":2.679,"loss_all_muon":2.761,"wnorm_nowd":34.07,"wnorm_wd":27.47},{"step":280,"loss_hybrid":2.695,"loss_all_muon":2.777,"wnorm_nowd":34.42,"wnorm_wd":27.61},{"step":288,"loss_hybrid":2.699,"loss_all_muon":2.796,"wnorm_nowd":34.77,"wnorm_wd":27.77},{"step":296,"loss_hybrid":2.689,"loss_all_muon":2.806,"wnorm_nowd":35.1,"wnorm_wd":27.9},{"step":304,"loss_hybrid":2.672,"loss_all_muon":2.814,"wnorm_nowd":35.43,"wnorm_wd":28.0},{"step":312,"loss_hybrid":2.635,"loss_all_muon":2.84,"wnorm_nowd":35.74,"wnorm_wd":28.1},{"step":320,"loss_hybrid":2.619,"loss_all_muon":2.843,"wnorm_nowd":36.06,"wnorm_wd":28.22},{"step":328,"loss_hybrid":2.613,"loss_all_muon":2.864,"wnorm_nowd":36.38,"wnorm_wd":28.33},{"step":336,"loss_hybrid":2.585,"loss_all_muon":2.862,"wnorm_nowd":36.69,"wnorm_wd":28.43},{"step":344,"loss_hybrid":2.594,"loss_all_muon":2.873,"wnorm_nowd":37.02,"wnorm_wd":28.54},{"step":352,"loss_hybrid":2.602,"loss_all_muon":2.895,"wnorm_nowd":37.33,"wnorm_wd":28.65},{"step":360,"loss_hybrid":2.624,"loss_all_muon":2.91,"wnorm_nowd":37.63,"wnorm_wd":28.75}],"rms":[{"order":1,"shape":"64×64","unscaled":0.1088,"keller":0.1088,"moonshot":0.174,"s":"64"},{"order":2,"shape":"256×64","unscaled":0.0539,"keller":0.1079,"moonshot":0.1726,"s":"256"},{"order":3,"shape":"512×128","unscaled":0.0383,"keller":0.0766,"moonshot":0.1733,"s":"512"},{"order":4,"shape":"1024×256","unscaled":0.0298,"keller":0.0596,"moonshot":0.1908,"s":"1k"},{"order":5,"shape":"2048×512","unscaled":0.0211,"keller":0.0422,"moonshot":0.191,"s":"2k"}]},"panels":[{"title":"参数分流消融 · 验证集损失","height":250,"narrowHeight":235,"marginBottom":38,"x":{"label":"步数 Step"},"y":{"label":"Val Loss","domain":[2.32,5.1]},"grid":true,"marks":[{"mark":"line","data":"ab","x":"step","y":"loss_all_muon","stroke":"var(--clay)","strokeWidth":2.0,"strokeDasharray":"5 3"},{"mark":"line","data":"ab","x":"step","y":"loss_hybrid","stroke":"var(--teal)","strokeWidth":2.4},{"mark":"text","data":[{"step":355,"y":3.06,"t":"全量 Muon 升至 2.91"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"step":355,"y":2.42,"t":"分流混合 2.62"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"}]},{"title":"权重衰减对比 · 隐藏层 $\\|W\\|_F$","height":250,"narrowHeight":235,"marginBottom":38,"x":{"label":"步数 Step"},"y":{"label":"Frobenius 范数","domain":[18,40]},"grid":true,"marks":[{"mark":"line","data":"ab","x":"step","y":"wnorm_nowd","stroke":"var(--clay)","strokeWidth":2.1,"strokeDasharray":"5 3"},{"mark":"line","data":"ab","x":"step","y":"wnorm_wd","stroke":"var(--teal)","strokeWidth":2.4},{"mark":"text","data":[{"step":355,"y":38.6,"t":"无衰减增至 37.6"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"step":355,"y":23.6,"t":"含衰减稳定于 28.7"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"}]},{"title":"跨尺寸单元素更新 $\\mathrm{RMS}$","height":250,"narrowHeight":235,"marginBottom":38,"x":{"type":"point","domain":["64","256","512","1k","2k"],"label":"矩阵长边维度 A"},"y":{"label":"单元素 RMS","domain":[0,0.25]},"grid":true,"marks":[{"mark":"ruleY","data":[0.2],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"line","data":"rms","x":"s","y":"unscaled","stroke":"var(--clay)","strokeWidth":2.0,"strokeDasharray":"5 3"},{"mark":"line","data":"rms","x":"s","y":"keller","stroke":"var(--orange)","strokeWidth":1.9},{"mark":"line","data":"rms","x":"s","y":"moonshot","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":"rms","x":"s","y":"moonshot","fill":"var(--teal)","r":3.2,"tip":["shape","moonshot","keller","unscaled"]},{"mark":"text","data":[{"s":"2k","y":0.216,"t":"Moonshot 对齐 ≈ 0.19"}],"x":"s","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"}]}]}
```

---

## 六、硬件算术强度估算与四代优化器受控对比实验

### 6.1 为什么每步多做 5 轮大矩阵乘法，训练墙钟时间却几乎不增加？

初看 `Muon` 的算法流程，容易产生一个性能疑问：`AdamW` 每个参数只做几次标量加减乘除，而 `Muon` 要对每一块二维权重连跑 5 轮矩阵乘法，这是否会明显增加训练耗时？借助 GPU 的**屋顶线模型（Roofline Model）**与算术强度（Arithmetic Intensity，即每读写 1 字节显存所执行的浮点运算次数 FLOPs/Byte，注意 1 次乘加 MAC 计为 2 FLOPs）做一次定量估算即可看清差异。

保持全文记号 $W \in \mathbb{R}^{A \times B}$（$A = d_{\mathrm{out}}, B = d_{\mathrm{in}}$），记短边 $m = \min(A, B)$、长边 $M = \max(A, B)$，主权重与状态以 `float32`（每元素 4 字节）驻留于高带宽显存（HBM）：

1. **融合算子版 `AdamW` 的访存瓶颈**：单步更新需要从显存读取 $(W, G, M, V)$ 共 4 份张量，写回更新后的 $(W, M, V)$ 共 3 份张量，总显存流量约为 $7 \times 4 A B = 28 A B$ 字节；而每个元素仅执行约 $12$ 次标量浮点运算。算术强度仅为 $\frac{12 A B}{28 A B} \approx 0.43\;\text{FLOPs/Byte}$，远低于现代数据中心 GPU（如 H100 `bfloat16` 矩阵核心拐点约 $295\;\text{FLOPs/Byte}$）的平衡点，属于典型的**访存带宽受限（Memory-bound）**操作，且必须常驻保存一阶矩和二阶矩两张状态表。
2. **`Muon` 的矩阵算力占比估算**：`Muon` 省去了整张二阶矩 $V$ 表（内部二维层优化器状态显存减半）。经 5.1 节转置预处理后，迭代矩阵形状为 $m \times M$，转为 `bfloat16`（每元素 2 字节）。每一步迭代包含三次矩阵乘：$A_k = X_k X_k^\top$（$2 m^2 M$ FLOPs）、$A_k^2$（$2 m^3$ FLOPs）与 $B_k X_k$（$2 m^2 M$ FLOPs），5 步合计浮点运算量为 $5 \times (4 m^2 M + 2 m^3) = (20 + 10 m / M) m A B \le 30 m A B$ FLOPs。单次 `bfloat16` 矩阵乘的算术强度约为 $\frac{m}{3} \sim \frac{m}{2}\;\text{FLOPs/Byte}$（当 $m = 4096$ 时约为 $1{,}365 \sim 2{,}048\;\text{FLOPs/Byte}$，远高于 $295\;\text{FLOPs/Byte}$ 拐点），能够跑满 **Tensor Cores** 矩阵流水线。再与同一训练步的主干计算对比：全局批次 $N_{\mathrm{tok}} = B_{\mathrm{batch}} T$ 个词元经过该线性层时，前向 $X W^\top$、反向权重梯度 $\Delta^\top X$ 与反向输入梯度 $\Delta W$ 各需 $2 N_{\mathrm{tok}} A B$ FLOPs，合计 $6 N_{\mathrm{tok}} A B$ FLOPs；因此 `Muon` 额外增加的浮点运算比例满足：

$$
\frac{\mathrm{FLOPs}_{\mathrm{NS5}}}{\mathrm{FLOPs}_{\mathrm{fwd+bwd}}} = \frac{(20 + 10 m / M) m A B}{6 N_{\mathrm{tok}} A B} \le \frac{5 \min(A, B)}{N_{\mathrm{tok}}}
$$

在大语言模型预训练的标准配置下，短边 $\min(A, B)$ 通常为 $4{,}096 \sim 8{,}192$，而单步全局批词元数 $N_{\mathrm{tok}}$ 高达 $10^6 \sim 4 \times 10^6$，上式比值仅为 **$0.5\% \sim 2\%$**[@jordan2024][@liu2025]。以不到 $2\%$ 的额外矩阵运算比例换取每次迭代对全部低奇异值特征方向的均衡更新（在月之暗面的缩放定律实测中，达到相同损失所需的总训练词元与总算力节省约 $48\%$[@liu2025]），端到端训练时间反而显著缩短。

### 6.2 双层迷你 Transformer 上的四代优化器同台受控实验

为了在同一套简单透明的任务上观察上述理论推导的实际效果，我们构造了一个结合**齐夫偏置背景词分布**与**跨位置关联键值检索（Associative Recall）**的合成语言建模基准：词表大小 $V = 128$，序列长度 $T = 32$，每条序列前半段随机埋入 4 组形如 `Key → Value` 的配对，后半段穿插齐夫高频背景词并再次随机询问其中一个 `Key`，模型必须依靠多头自注意力精准对齐前文对应位置才能预测出正确的 `Value`。

我们在同一座双层 4 头迷你 Transformer（$D = 64, B = 32$）上分别运行 `SGD`、`SGD + Momentum`、全参数 `AdamW` 以及标准分流的 `Muon + AdamW` 各 360 步（其中 `Muon + AdamW` 与纯 `AdamW` 共用完全相同的学习率 $\eta = 5 \times 10^{-3}$ 与权重衰减率 $\lambda = 0.02$）：

```plot title="双层 4 头 Mini-Transformer 四代优化器受控对比：验证损失与跨位置键值检索准确率" note="词表 $V=128$，序列长 $T=32$，$D=64$，4 头，批大小 $B=32$；实线为两个随机种子的均值，半透明带为 $\pm 1$ 标准差。理论随机猜测交叉熵起点为 $\ln(128) \approx 4.85$。"
{"cols":2,"narrowCols":1,"xlabel":"训练步数 Step（双层 4 头 Mini-Transformer，齐夫偏置语料 + 跨位置键值检索，双随机种子均值 ±1 标准差）","legend":[{"label":"Muon+AdamW 混合（共用 $\\eta = 5\\times 10^{-3}$）","color":"var(--clay)","shape":"line"},{"label":"全参数 AdamW（$\\eta = 5\\times 10^{-3}$）","color":"var(--teal)","shape":"line"},{"label":"SGD + Momentum（$\\eta = 0.15$）","color":"var(--orange)","shape":"dash"},{"label":"纯 SGD（$\\eta = 0.25$）","color":"var(--stone)","shape":"dash"}],"data":{"bm":[{"opt":"sgd","step":1,"loss":4.958,"loss_lo":4.942,"loss_hi":4.974,"acc":1.4,"acc_lo":0.7,"acc_hi":2.1},{"opt":"sgd","step":8,"loss":4.44,"loss_lo":4.378,"loss_hi":4.503,"acc":1.9,"acc_lo":1.4,"acc_hi":2.4},{"opt":"sgd","step":16,"loss":3.978,"loss_lo":3.949,"loss_hi":4.007,"acc":1.6,"acc_lo":0.6,"acc_hi":2.5},{"opt":"sgd","step":24,"loss":3.718,"loss_lo":3.691,"loss_hi":3.744,"acc":2.0,"acc_lo":1.0,"acc_hi":2.9},{"opt":"sgd","step":32,"loss":3.558,"loss_lo":3.531,"loss_hi":3.584,"acc":2.6,"acc_lo":2.2,"acc_hi":3.0},{"opt":"sgd","step":40,"loss":3.438,"loss_lo":3.41,"loss_hi":3.467,"acc":4.2,"acc_lo":3.0,"acc_hi":5.4},{"opt":"sgd","step":48,"loss":3.335,"loss_lo":3.304,"loss_hi":3.367,"acc":5.1,"acc_lo":5.0,"acc_hi":5.3},{"opt":"sgd","step":56,"loss":3.241,"loss_lo":3.208,"loss_hi":3.274,"acc":5.0,"acc_lo":4.4,"acc_hi":5.7},{"opt":"sgd","step":64,"loss":3.159,"loss_lo":3.13,"loss_hi":3.188,"acc":6.9,"acc_lo":6.7,"acc_hi":7.0},{"opt":"sgd","step":72,"loss":3.093,"loss_lo":3.066,"loss_hi":3.12,"acc":7.0,"acc_lo":6.5,"acc_hi":7.4},{"opt":"sgd","step":80,"loss":3.036,"loss_lo":3.013,"loss_hi":3.059,"acc":6.1,"acc_lo":5.9,"acc_hi":6.3},{"opt":"sgd","step":88,"loss":2.988,"loss_lo":2.968,"loss_hi":3.008,"acc":7.0,"acc_lo":6.7,"acc_hi":7.2},{"opt":"sgd","step":96,"loss":2.957,"loss_lo":2.942,"loss_hi":2.971,"acc":7.8,"acc_lo":7.4,"acc_hi":8.1},{"opt":"sgd","step":104,"loss":2.923,"loss_lo":2.912,"loss_hi":2.933,"acc":7.4,"acc_lo":6.2,"acc_hi":8.7},{"opt":"sgd","step":112,"loss":2.901,"loss_lo":2.891,"loss_hi":2.911,"acc":7.4,"acc_lo":6.7,"acc_hi":8.1},{"opt":"sgd","step":120,"loss":2.881,"loss_lo":2.876,"loss_hi":2.886,"acc":7.7,"acc_lo":7.2,"acc_hi":8.2},{"opt":"sgd","step":128,"loss":2.87,"loss_lo":2.865,"loss_hi":2.875,"acc":7.3,"acc_lo":6.9,"acc_hi":7.6},{"opt":"sgd","step":136,"loss":2.857,"loss_lo":2.85,"loss_hi":2.863,"acc":6.8,"acc_lo":6.0,"acc_hi":7.7},{"opt":"sgd","step":144,"loss":2.846,"loss_lo":2.841,"loss_hi":2.85,"acc":7.2,"acc_lo":6.3,"acc_hi":8.0},{"opt":"sgd","step":152,"loss":2.838,"loss_lo":2.833,"loss_hi":2.842,"acc":6.5,"acc_lo":6.4,"acc_hi":6.5},{"opt":"sgd","step":160,"loss":2.829,"loss_lo":2.829,"loss_hi":2.83,"acc":8.1,"acc_lo":7.5,"acc_hi":8.7},{"opt":"sgd","step":168,"loss":2.825,"loss_lo":2.824,"loss_hi":2.827,"acc":7.3,"acc_lo":6.6,"acc_hi":8.0},{"opt":"sgd","step":176,"loss":2.822,"loss_lo":2.819,"loss_hi":2.825,"acc":7.2,"acc_lo":6.9,"acc_hi":7.4},{"opt":"sgd","step":184,"loss":2.816,"loss_lo":2.815,"loss_hi":2.816,"acc":7.4,"acc_lo":6.8,"acc_hi":8.0},{"opt":"sgd","step":192,"loss":2.816,"loss_lo":2.815,"loss_hi":2.817,"acc":7.2,"acc_lo":7.0,"acc_hi":7.3},{"opt":"sgd","step":200,"loss":2.809,"loss_lo":2.805,"loss_hi":2.813,"acc":7.9,"acc_lo":7.5,"acc_hi":8.3},{"opt":"sgd","step":208,"loss":2.812,"loss_lo":2.81,"loss_hi":2.815,"acc":7.2,"acc_lo":6.5,"acc_hi":7.8},{"opt":"sgd","step":216,"loss":2.81,"loss_lo":2.803,"loss_hi":2.816,"acc":7.7,"acc_lo":7.6,"acc_hi":7.8},{"opt":"sgd","step":224,"loss":2.803,"loss_lo":2.8,"loss_hi":2.806,"acc":7.5,"acc_lo":7.4,"acc_hi":7.5},{"opt":"sgd","step":232,"loss":2.807,"loss_lo":2.799,"loss_hi":2.815,"acc":6.6,"acc_lo":6.2,"acc_hi":6.9},{"opt":"sgd","step":240,"loss":2.806,"loss_lo":2.804,"loss_hi":2.808,"acc":7.8,"acc_lo":7.0,"acc_hi":8.6},{"opt":"sgd","step":248,"loss":2.798,"loss_lo":2.794,"loss_hi":2.801,"acc":7.9,"acc_lo":7.1,"acc_hi":8.6},{"opt":"sgd","step":256,"loss":2.802,"loss_lo":2.792,"loss_hi":2.811,"acc":8.2,"acc_lo":7.4,"acc_hi":8.9},{"opt":"sgd","step":264,"loss":2.796,"loss_lo":2.795,"loss_hi":2.798,"acc":8.1,"acc_lo":7.3,"acc_hi":8.8},{"opt":"sgd","step":272,"loss":2.795,"loss_lo":2.792,"loss_hi":2.797,"acc":7.0,"acc_lo":6.4,"acc_hi":7.5},{"opt":"sgd","step":280,"loss":2.795,"loss_lo":2.788,"loss_hi":2.802,"acc":8.5,"acc_lo":8.4,"acc_hi":8.6},{"opt":"sgd","step":288,"loss":2.791,"loss_lo":2.787,"loss_hi":2.795,"acc":7.5,"acc_lo":6.6,"acc_hi":8.3},{"opt":"sgd","step":296,"loss":2.792,"loss_lo":2.792,"loss_hi":2.793,"acc":8.1,"acc_lo":7.6,"acc_hi":8.6},{"opt":"sgd","step":304,"loss":2.796,"loss_lo":2.792,"loss_hi":2.8,"acc":8.0,"acc_lo":7.3,"acc_hi":8.7},{"opt":"sgd","step":312,"loss":2.803,"loss_lo":2.791,"loss_hi":2.816,"acc":7.5,"acc_lo":6.9,"acc_hi":8.0},{"opt":"sgd","step":320,"loss":2.788,"loss_lo":2.784,"loss_hi":2.791,"acc":7.9,"acc_lo":7.1,"acc_hi":8.6},{"opt":"sgd","step":328,"loss":2.791,"loss_lo":2.788,"loss_hi":2.794,"acc":6.8,"acc_lo":6.6,"acc_hi":7.0},{"opt":"sgd","step":336,"loss":2.79,"loss_lo":2.787,"loss_hi":2.792,"acc":7.2,"acc_lo":6.5,"acc_hi":7.9},{"opt":"sgd","step":344,"loss":2.788,"loss_lo":2.782,"loss_hi":2.794,"acc":7.5,"acc_lo":7.1,"acc_hi":7.8},{"opt":"sgd","step":352,"loss":2.788,"loss_lo":2.786,"loss_hi":2.79,"acc":7.0,"acc_lo":6.5,"acc_hi":7.5},{"opt":"sgd","step":360,"loss":2.788,"loss_lo":2.782,"loss_hi":2.794,"acc":7.3,"acc_lo":7.0,"acc_hi":7.5},{"opt":"momentum","step":1,"loss":4.985,"loss_lo":4.972,"loss_hi":4.998,"acc":1.1,"acc_lo":0.7,"acc_hi":1.5},{"opt":"momentum","step":8,"loss":4.167,"loss_lo":4.123,"loss_hi":4.212,"acc":1.5,"acc_lo":0.7,"acc_hi":2.3},{"opt":"momentum","step":16,"loss":3.473,"loss_lo":3.42,"loss_hi":3.527,"acc":3.8,"acc_lo":2.2,"acc_hi":5.4},{"opt":"momentum","step":24,"loss":3.125,"loss_lo":3.088,"loss_hi":3.163,"acc":5.7,"acc_lo":5.2,"acc_hi":6.2},{"opt":"momentum","step":32,"loss":2.942,"loss_lo":2.926,"loss_hi":2.957,"acc":7.1,"acc_lo":6.9,"acc_hi":7.3},{"opt":"momentum","step":40,"loss":2.861,"loss_lo":2.856,"loss_hi":2.865,"acc":8.0,"acc_lo":7.2,"acc_hi":8.7},{"opt":"momentum","step":48,"loss":2.829,"loss_lo":2.828,"loss_hi":2.83,"acc":7.2,"acc_lo":6.8,"acc_hi":7.6},{"opt":"momentum","step":56,"loss":2.811,"loss_lo":2.809,"loss_hi":2.812,"acc":6.9,"acc_lo":6.2,"acc_hi":7.5},{"opt":"momentum","step":64,"loss":2.808,"loss_lo":2.803,"loss_hi":2.814,"acc":7.1,"acc_lo":6.2,"acc_hi":8.0},{"opt":"momentum","step":72,"loss":2.804,"loss_lo":2.798,"loss_hi":2.81,"acc":7.4,"acc_lo":7.2,"acc_hi":7.5},{"opt":"momentum","step":80,"loss":2.799,"loss_lo":2.797,"loss_hi":2.801,"acc":8.0,"acc_lo":7.9,"acc_hi":8.0},{"opt":"momentum","step":88,"loss":2.799,"loss_lo":2.795,"loss_hi":2.802,"acc":5.8,"acc_lo":4.7,"acc_hi":6.8},{"opt":"momentum","step":96,"loss":2.798,"loss_lo":2.796,"loss_hi":2.8,"acc":6.9,"acc_lo":6.6,"acc_hi":7.2},{"opt":"momentum","step":104,"loss":2.8,"loss_lo":2.795,"loss_hi":2.805,"acc":8.8,"acc_lo":7.5,"acc_hi":10.1},{"opt":"momentum","step":112,"loss":2.793,"loss_lo":2.791,"loss_hi":2.796,"acc":7.2,"acc_lo":6.2,"acc_hi":8.2},{"opt":"momentum","step":120,"loss":2.792,"loss_lo":2.788,"loss_hi":2.795,"acc":8.0,"acc_lo":7.4,"acc_hi":8.5},{"opt":"momentum","step":128,"loss":2.799,"loss_lo":2.796,"loss_hi":2.802,"acc":6.7,"acc_lo":6.6,"acc_hi":6.7},{"opt":"momentum","step":136,"loss":2.793,"loss_lo":2.788,"loss_hi":2.798,"acc":6.7,"acc_lo":6.6,"acc_hi":6.8},{"opt":"momentum","step":144,"loss":2.794,"loss_lo":2.793,"loss_hi":2.795,"acc":7.5,"acc_lo":7.1,"acc_hi":7.9},{"opt":"momentum","step":152,"loss":2.795,"loss_lo":2.792,"loss_hi":2.799,"acc":6.0,"acc_lo":5.7,"acc_hi":6.2},{"opt":"momentum","step":160,"loss":2.791,"loss_lo":2.785,"loss_hi":2.797,"acc":7.3,"acc_lo":7.1,"acc_hi":7.4},{"opt":"momentum","step":168,"loss":2.793,"loss_lo":2.793,"loss_hi":2.793,"acc":6.7,"acc_lo":6.0,"acc_hi":7.5},{"opt":"momentum","step":176,"loss":2.795,"loss_lo":2.793,"loss_hi":2.798,"acc":6.9,"acc_lo":6.3,"acc_hi":7.5},{"opt":"momentum","step":184,"loss":2.792,"loss_lo":2.789,"loss_hi":2.796,"acc":7.8,"acc_lo":7.7,"acc_hi":7.9},{"opt":"momentum","step":192,"loss":2.794,"loss_lo":2.793,"loss_hi":2.796,"acc":7.4,"acc_lo":6.7,"acc_hi":8.1},{"opt":"momentum","step":200,"loss":2.785,"loss_lo":2.785,"loss_hi":2.785,"acc":7.2,"acc_lo":6.6,"acc_hi":7.8},{"opt":"momentum","step":208,"loss":2.789,"loss_lo":2.786,"loss_hi":2.792,"acc":8.4,"acc_lo":7.6,"acc_hi":9.2},{"opt":"momentum","step":216,"loss":2.795,"loss_lo":2.794,"loss_hi":2.797,"acc":7.6,"acc_lo":7.2,"acc_hi":8.0},{"opt":"momentum","step":224,"loss":2.791,"loss_lo":2.791,"loss_hi":2.791,"acc":7.2,"acc_lo":6.5,"acc_hi":7.8},{"opt":"momentum","step":232,"loss":2.788,"loss_lo":2.786,"loss_hi":2.79,"acc":7.5,"acc_lo":7.5,"acc_hi":7.5},{"opt":"momentum","step":240,"loss":2.79,"loss_lo":2.788,"loss_hi":2.793,"acc":6.8,"acc_lo":6.6,"acc_hi":6.9},{"opt":"momentum","step":248,"loss":2.791,"loss_lo":2.786,"loss_hi":2.796,"acc":8.1,"acc_lo":7.4,"acc_hi":8.7},{"opt":"momentum","step":256,"loss":2.788,"loss_lo":2.786,"loss_hi":2.789,"acc":8.6,"acc_lo":7.8,"acc_hi":9.4},{"opt":"momentum","step":264,"loss":2.787,"loss_lo":2.787,"loss_hi":2.787,"acc":7.2,"acc_lo":7.0,"acc_hi":7.3},{"opt":"momentum","step":272,"loss":2.787,"loss_lo":2.783,"loss_hi":2.79,"acc":7.2,"acc_lo":6.4,"acc_hi":8.0},{"opt":"momentum","step":280,"loss":2.785,"loss_lo":2.784,"loss_hi":2.787,"acc":8.3,"acc_lo":8.2,"acc_hi":8.3},{"opt":"momentum","step":288,"loss":2.788,"loss_lo":2.78,"loss_hi":2.796,"acc":7.1,"acc_lo":6.5,"acc_hi":7.6},{"opt":"momentum","step":296,"loss":2.787,"loss_lo":2.783,"loss_hi":2.791,"acc":7.1,"acc_lo":6.2,"acc_hi":8.0},{"opt":"momentum","step":304,"loss":2.791,"loss_lo":2.788,"loss_hi":2.795,"acc":8.0,"acc_lo":7.3,"acc_hi":8.7},{"opt":"momentum","step":312,"loss":2.792,"loss_lo":2.786,"loss_hi":2.797,"acc":6.8,"acc_lo":6.3,"acc_hi":7.2},{"opt":"momentum","step":320,"loss":2.787,"loss_lo":2.784,"loss_hi":2.79,"acc":7.2,"acc_lo":6.9,"acc_hi":7.5},{"opt":"momentum","step":328,"loss":2.8,"loss_lo":2.795,"loss_hi":2.804,"acc":7.0,"acc_lo":6.1,"acc_hi":7.9},{"opt":"momentum","step":336,"loss":2.783,"loss_lo":2.782,"loss_hi":2.785,"acc":7.0,"acc_lo":6.2,"acc_hi":7.8},{"opt":"momentum","step":344,"loss":2.789,"loss_lo":2.784,"loss_hi":2.794,"acc":7.4,"acc_lo":7.3,"acc_hi":7.5},{"opt":"momentum","step":352,"loss":2.784,"loss_lo":2.78,"loss_hi":2.788,"acc":7.6,"acc_lo":7.0,"acc_hi":8.1},{"opt":"momentum","step":360,"loss":2.787,"loss_lo":2.781,"loss_hi":2.793,"acc":7.4,"acc_lo":7.4,"acc_hi":7.4},{"opt":"adamw","step":1,"loss":4.726,"loss_lo":4.707,"loss_hi":4.745,"acc":2.6,"acc_lo":2.2,"acc_hi":2.9},{"opt":"adamw","step":8,"loss":3.602,"loss_lo":3.593,"loss_hi":3.611,"acc":4.1,"acc_lo":3.2,"acc_hi":5.0},{"opt":"adamw","step":16,"loss":2.963,"loss_lo":2.936,"loss_hi":2.99,"acc":6.5,"acc_lo":6.0,"acc_hi":7.0},{"opt":"adamw","step":24,"loss":2.822,"loss_lo":2.817,"loss_hi":2.826,"acc":5.3,"acc_lo":4.1,"acc_hi":6.5},{"opt":"adamw","step":32,"loss":2.796,"loss_lo":2.789,"loss_hi":2.803,"acc":7.1,"acc_lo":5.7,"acc_hi":8.5},{"opt":"adamw","step":40,"loss":2.789,"loss_lo":2.785,"loss_hi":2.792,"acc":6.4,"acc_lo":4.2,"acc_hi":8.6},{"opt":"adamw","step":48,"loss":2.786,"loss_lo":2.786,"loss_hi":2.787,"acc":6.4,"acc_lo":6.3,"acc_hi":6.5},{"opt":"adamw","step":56,"loss":2.783,"loss_lo":2.782,"loss_hi":2.784,"acc":6.2,"acc_lo":5.4,"acc_hi":7.1},{"opt":"adamw","step":64,"loss":2.79,"loss_lo":2.784,"loss_hi":2.796,"acc":6.0,"acc_lo":4.0,"acc_hi":7.9},{"opt":"adamw","step":72,"loss":2.783,"loss_lo":2.78,"loss_hi":2.787,"acc":5.5,"acc_lo":5.1,"acc_hi":6.0},{"opt":"adamw","step":80,"loss":2.78,"loss_lo":2.779,"loss_hi":2.781,"acc":7.2,"acc_lo":5.8,"acc_hi":8.6},{"opt":"adamw","step":88,"loss":2.785,"loss_lo":2.784,"loss_hi":2.786,"acc":8.0,"acc_lo":7.2,"acc_hi":8.7},{"opt":"adamw","step":96,"loss":2.787,"loss_lo":2.784,"loss_hi":2.791,"acc":8.9,"acc_lo":6.9,"acc_hi":10.8},{"opt":"adamw","step":104,"loss":2.776,"loss_lo":2.775,"loss_hi":2.777,"acc":10.0,"acc_lo":7.5,"acc_hi":12.4},{"opt":"adamw","step":112,"loss":2.785,"loss_lo":2.773,"loss_hi":2.796,"acc":9.3,"acc_lo":6.6,"acc_hi":11.9},{"opt":"adamw","step":120,"loss":2.774,"loss_lo":2.763,"loss_hi":2.785,"acc":10.6,"acc_lo":6.8,"acc_hi":14.4},{"opt":"adamw","step":128,"loss":2.778,"loss_lo":2.77,"loss_hi":2.786,"acc":9.3,"acc_lo":5.3,"acc_hi":13.3},{"opt":"adamw","step":136,"loss":2.775,"loss_lo":2.773,"loss_hi":2.776,"acc":11.8,"acc_lo":6.7,"acc_hi":16.8},{"opt":"adamw","step":144,"loss":2.767,"loss_lo":2.76,"loss_hi":2.774,"acc":11.5,"acc_lo":6.9,"acc_hi":16.1},{"opt":"adamw","step":152,"loss":2.772,"loss_lo":2.77,"loss_hi":2.775,"acc":13.1,"acc_lo":7.0,"acc_hi":19.1},{"opt":"adamw","step":160,"loss":2.766,"loss_lo":2.749,"loss_hi":2.784,"acc":13.1,"acc_lo":7.8,"acc_hi":18.5},{"opt":"adamw","step":168,"loss":2.765,"loss_lo":2.747,"loss_hi":2.783,"acc":14.2,"acc_lo":7.4,"acc_hi":20.9},{"opt":"adamw","step":176,"loss":2.76,"loss_lo":2.75,"loss_hi":2.771,"acc":15.0,"acc_lo":8.8,"acc_hi":21.3},{"opt":"adamw","step":184,"loss":2.757,"loss_lo":2.735,"loss_hi":2.778,"acc":17.3,"acc_lo":11.0,"acc_hi":23.5},{"opt":"adamw","step":192,"loss":2.745,"loss_lo":2.729,"loss_hi":2.761,"acc":18.5,"acc_lo":12.8,"acc_hi":24.1},{"opt":"adamw","step":200,"loss":2.734,"loss_lo":2.717,"loss_hi":2.751,"acc":19.4,"acc_lo":14.6,"acc_hi":24.2},{"opt":"adamw","step":208,"loss":2.74,"loss_lo":2.717,"loss_hi":2.762,"acc":18.6,"acc_lo":13.5,"acc_hi":23.7},{"opt":"adamw","step":216,"loss":2.721,"loss_lo":2.696,"loss_hi":2.746,"acc":21.3,"acc_lo":16.0,"acc_hi":26.6},{"opt":"adamw","step":224,"loss":2.728,"loss_lo":2.709,"loss_hi":2.746,"acc":19.9,"acc_lo":14.9,"acc_hi":24.8},{"opt":"adamw","step":232,"loss":2.719,"loss_lo":2.694,"loss_hi":2.743,"acc":21.8,"acc_lo":18.1,"acc_hi":25.5},{"opt":"adamw","step":240,"loss":2.713,"loss_lo":2.691,"loss_hi":2.734,"acc":21.9,"acc_lo":18.6,"acc_hi":25.3},{"opt":"adamw","step":248,"loss":2.709,"loss_lo":2.684,"loss_hi":2.735,"acc":22.5,"acc_lo":19.1,"acc_hi":25.9},{"opt":"adamw","step":256,"loss":2.701,"loss_lo":2.669,"loss_hi":2.734,"acc":22.3,"acc_lo":17.2,"acc_hi":27.4},{"opt":"adamw","step":264,"loss":2.705,"loss_lo":2.687,"loss_hi":2.724,"acc":23.7,"acc_lo":21.2,"acc_hi":26.2},{"opt":"adamw","step":272,"loss":2.702,"loss_lo":2.677,"loss_hi":2.726,"acc":23.9,"acc_lo":20.9,"acc_hi":26.9},{"opt":"adamw","step":280,"loss":2.696,"loss_lo":2.674,"loss_hi":2.718,"acc":23.2,"acc_lo":19.8,"acc_hi":26.6},{"opt":"adamw","step":288,"loss":2.705,"loss_lo":2.678,"loss_hi":2.733,"acc":21.7,"acc_lo":18.5,"acc_hi":25.0},{"opt":"adamw","step":296,"loss":2.705,"loss_lo":2.678,"loss_hi":2.733,"acc":23.3,"acc_lo":20.7,"acc_hi":25.9},{"opt":"adamw","step":304,"loss":2.695,"loss_lo":2.666,"loss_hi":2.725,"acc":24.7,"acc_lo":23.1,"acc_hi":26.3},{"opt":"adamw","step":312,"loss":2.705,"loss_lo":2.683,"loss_hi":2.726,"acc":24.1,"acc_lo":21.7,"acc_hi":26.6},{"opt":"adamw","step":320,"loss":2.689,"loss_lo":2.674,"loss_hi":2.703,"acc":24.0,"acc_lo":21.5,"acc_hi":26.5},{"opt":"adamw","step":328,"loss":2.693,"loss_lo":2.685,"loss_hi":2.702,"acc":25.0,"acc_lo":23.8,"acc_hi":26.1},{"opt":"adamw","step":336,"loss":2.677,"loss_lo":2.661,"loss_hi":2.692,"acc":25.9,"acc_lo":24.4,"acc_hi":27.3},{"opt":"adamw","step":344,"loss":2.684,"loss_lo":2.667,"loss_hi":2.701,"acc":25.5,"acc_lo":22.5,"acc_hi":28.5},{"opt":"adamw","step":352,"loss":2.687,"loss_lo":2.668,"loss_hi":2.707,"acc":24.5,"acc_lo":22.9,"acc_hi":26.0},{"opt":"adamw","step":360,"loss":2.698,"loss_lo":2.682,"loss_hi":2.713,"acc":23.7,"acc_lo":22.0,"acc_hi":25.5},{"opt":"muon_hybrid","step":1,"loss":4.929,"loss_lo":4.915,"loss_hi":4.944,"acc":1.5,"acc_lo":0.6,"acc_hi":2.4},{"opt":"muon_hybrid","step":8,"loss":4.269,"loss_lo":4.211,"loss_hi":4.327,"acc":5.8,"acc_lo":5.8,"acc_hi":5.8},{"opt":"muon_hybrid","step":16,"loss":3.487,"loss_lo":3.428,"loss_hi":3.547,"acc":6.4,"acc_lo":6.0,"acc_hi":6.8},{"opt":"muon_hybrid","step":24,"loss":3.119,"loss_lo":3.09,"loss_hi":3.148,"acc":6.1,"acc_lo":5.5,"acc_hi":6.6},{"opt":"muon_hybrid","step":32,"loss":2.917,"loss_lo":2.913,"loss_hi":2.922,"acc":8.1,"acc_lo":7.0,"acc_hi":9.2},{"opt":"muon_hybrid","step":40,"loss":2.829,"loss_lo":2.826,"loss_hi":2.832,"acc":8.2,"acc_lo":6.9,"acc_hi":9.4},{"opt":"muon_hybrid","step":48,"loss":2.798,"loss_lo":2.797,"loss_hi":2.798,"acc":7.2,"acc_lo":6.9,"acc_hi":7.5},{"opt":"muon_hybrid","step":56,"loss":2.775,"loss_lo":2.774,"loss_hi":2.776,"acc":7.2,"acc_lo":7.0,"acc_hi":7.4},{"opt":"muon_hybrid","step":64,"loss":2.786,"loss_lo":2.778,"loss_hi":2.794,"acc":7.2,"acc_lo":6.9,"acc_hi":7.4},{"opt":"muon_hybrid","step":72,"loss":2.779,"loss_lo":2.775,"loss_hi":2.782,"acc":8.1,"acc_lo":7.3,"acc_hi":8.9},{"opt":"muon_hybrid","step":80,"loss":2.773,"loss_lo":2.771,"loss_hi":2.775,"acc":9.0,"acc_lo":8.6,"acc_hi":9.5},{"opt":"muon_hybrid","step":88,"loss":2.774,"loss_lo":2.772,"loss_hi":2.776,"acc":8.3,"acc_lo":8.2,"acc_hi":8.3},{"opt":"muon_hybrid","step":96,"loss":2.772,"loss_lo":2.768,"loss_hi":2.777,"acc":10.6,"acc_lo":9.6,"acc_hi":11.6},{"opt":"muon_hybrid","step":104,"loss":2.767,"loss_lo":2.765,"loss_hi":2.77,"acc":12.9,"acc_lo":12.0,"acc_hi":13.9},{"opt":"muon_hybrid","step":112,"loss":2.758,"loss_lo":2.758,"loss_hi":2.758,"acc":13.8,"acc_lo":12.0,"acc_hi":15.5},{"opt":"muon_hybrid","step":120,"loss":2.744,"loss_lo":2.739,"loss_hi":2.749,"acc":19.3,"acc_lo":17.5,"acc_hi":21.2},{"opt":"muon_hybrid","step":128,"loss":2.731,"loss_lo":2.73,"loss_hi":2.731,"acc":21.0,"acc_lo":19.5,"acc_hi":22.5},{"opt":"muon_hybrid","step":136,"loss":2.721,"loss_lo":2.718,"loss_hi":2.725,"acc":22.3,"acc_lo":21.5,"acc_hi":23.0},{"opt":"muon_hybrid","step":144,"loss":2.705,"loss_lo":2.703,"loss_hi":2.708,"acc":23.6,"acc_lo":22.0,"acc_hi":25.3},{"opt":"muon_hybrid","step":152,"loss":2.692,"loss_lo":2.687,"loss_hi":2.697,"acc":24.3,"acc_lo":23.5,"acc_hi":25.1},{"opt":"muon_hybrid","step":160,"loss":2.681,"loss_lo":2.67,"loss_hi":2.692,"acc":26.8,"acc_lo":25.0,"acc_hi":28.6},{"opt":"muon_hybrid","step":168,"loss":2.676,"loss_lo":2.667,"loss_hi":2.684,"acc":26.1,"acc_lo":25.3,"acc_hi":27.0},{"opt":"muon_hybrid","step":176,"loss":2.67,"loss_lo":2.662,"loss_hi":2.677,"acc":26.7,"acc_lo":25.9,"acc_hi":27.5},{"opt":"muon_hybrid","step":184,"loss":2.667,"loss_lo":2.657,"loss_hi":2.676,"acc":24.9,"acc_lo":23.8,"acc_hi":26.0},{"opt":"muon_hybrid","step":192,"loss":2.663,"loss_lo":2.662,"loss_hi":2.664,"acc":26.3,"acc_lo":24.7,"acc_hi":27.9},{"opt":"muon_hybrid","step":200,"loss":2.656,"loss_lo":2.655,"loss_hi":2.658,"acc":27.1,"acc_lo":26.6,"acc_hi":27.6},{"opt":"muon_hybrid","step":208,"loss":2.665,"loss_lo":2.66,"loss_hi":2.67,"acc":28.2,"acc_lo":27.9,"acc_hi":28.4},{"opt":"muon_hybrid","step":216,"loss":2.661,"loss_lo":2.659,"loss_hi":2.662,"acc":30.1,"acc_lo":28.1,"acc_hi":32.1},{"opt":"muon_hybrid","step":224,"loss":2.676,"loss_lo":2.669,"loss_hi":2.683,"acc":30.1,"acc_lo":26.5,"acc_hi":33.7},{"opt":"muon_hybrid","step":232,"loss":2.67,"loss_lo":2.658,"loss_hi":2.682,"acc":32.6,"acc_lo":27.1,"acc_hi":38.1},{"opt":"muon_hybrid","step":240,"loss":2.667,"loss_lo":2.644,"loss_hi":2.691,"acc":36.2,"acc_lo":28.2,"acc_hi":44.2},{"opt":"muon_hybrid","step":248,"loss":2.668,"loss_lo":2.638,"loss_hi":2.699,"acc":40.0,"acc_lo":29.8,"acc_hi":50.3},{"opt":"muon_hybrid","step":256,"loss":2.655,"loss_lo":2.605,"loss_hi":2.705,"acc":45.1,"acc_lo":30.1,"acc_hi":60.1},{"opt":"muon_hybrid","step":264,"loss":2.66,"loss_lo":2.584,"loss_hi":2.736,"acc":50.1,"acc_lo":29.1,"acc_hi":71.2},{"opt":"muon_hybrid","step":272,"loss":2.651,"loss_lo":2.569,"loss_hi":2.733,"acc":55.7,"acc_lo":30.7,"acc_hi":80.7},{"opt":"muon_hybrid","step":280,"loss":2.658,"loss_lo":2.557,"loss_hi":2.759,"acc":57.7,"acc_lo":31.0,"acc_hi":84.5},{"opt":"muon_hybrid","step":288,"loss":2.663,"loss_lo":2.552,"loss_hi":2.773,"acc":59.7,"acc_lo":32.1,"acc_hi":87.2},{"opt":"muon_hybrid","step":296,"loss":2.675,"loss_lo":2.559,"loss_hi":2.791,"acc":61.7,"acc_lo":33.6,"acc_hi":89.7},{"opt":"muon_hybrid","step":304,"loss":2.677,"loss_lo":2.557,"loss_hi":2.797,"acc":64.6,"acc_lo":38.0,"acc_hi":91.2},{"opt":"muon_hybrid","step":312,"loss":2.687,"loss_lo":2.586,"loss_hi":2.787,"acc":66.2,"acc_lo":39.8,"acc_hi":92.5},{"opt":"muon_hybrid","step":320,"loss":2.696,"loss_lo":2.596,"loss_hi":2.797,"acc":68.5,"acc_lo":44.4,"acc_hi":92.6},{"opt":"muon_hybrid","step":328,"loss":2.711,"loss_lo":2.614,"loss_hi":2.809,"acc":68.2,"acc_lo":45.7,"acc_hi":90.6},{"opt":"muon_hybrid","step":336,"loss":2.72,"loss_lo":2.638,"loss_hi":2.803,"acc":70.7,"acc_lo":50.3,"acc_hi":91.0},{"opt":"muon_hybrid","step":344,"loss":2.739,"loss_lo":2.664,"loss_hi":2.814,"acc":72.4,"acc_lo":54.1,"acc_hi":90.6},{"opt":"muon_hybrid","step":352,"loss":2.758,"loss_lo":2.69,"loss_hi":2.825,"acc":74.1,"acc_lo":56.3,"acc_hi":91.9},{"opt":"muon_hybrid","step":360,"loss":2.778,"loss_lo":2.723,"loss_hi":2.833,"acc":77.0,"acc_lo":62.2,"acc_hi":91.8}]},"panels":[{"title":"验证集交叉熵损失（Cross-Entropy Loss）","height":270,"narrowHeight":235,"x":{"label":null,"domain":[0,365]},"y":{"label":"Val Loss","domain":[2.45,5.2]},"grid":true,"marks":[{"mark":"ruleY","data":[4.852],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"text","data":[{"x":358,"y":5.04,"t":"均匀随机起点 ln(128) = 4.85"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--muted)"},{"mark":"areaY","data":"bm","filter":{"opt":"adamw"},"x":"step","y1":"loss_lo","y2":"loss_hi","fill":"var(--teal)","fillOpacity":0.14},{"mark":"areaY","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y1":"loss_lo","y2":"loss_hi","fill":"var(--clay)","fillOpacity":0.15},{"mark":"line","data":"bm","filter":{"opt":"sgd"},"x":"step","y":"loss","stroke":"var(--stone)","strokeWidth":1.8,"strokeDasharray":"5 4"},{"mark":"line","data":"bm","filter":{"opt":"momentum"},"x":"step","y":"loss","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"bm","filter":{"opt":"adamw"},"x":"step","y":"loss","stroke":"var(--teal)","strokeWidth":2.2},{"mark":"line","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"loss","stroke":"var(--clay)","strokeWidth":2.5},{"mark":"dot","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"loss","fill":"var(--clay)","r":2.0,"tip":["step","loss"]}]},{"title":"跨位置键值检索准确率（Associative Recall %）","height":270,"narrowHeight":235,"x":{"label":null,"domain":[0,365]},"y":{"label":"检索准确率 (%)","domain":[-3,100]},"grid":true,"marks":[{"mark":"areaY","data":"bm","filter":{"opt":"adamw"},"x":"step","y1":"acc_lo","y2":"acc_hi","fill":"var(--teal)","fillOpacity":0.15},{"mark":"areaY","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y1":"acc_lo","y2":"acc_hi","fill":"var(--clay)","fillOpacity":0.16},{"mark":"line","data":"bm","filter":{"opt":"sgd"},"x":"step","y":"acc","stroke":"var(--stone)","strokeWidth":1.8,"strokeDasharray":"5 4"},{"mark":"line","data":"bm","filter":{"opt":"momentum"},"x":"step","y":"acc","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"bm","filter":{"opt":"adamw"},"x":"step","y":"acc","stroke":"var(--teal)","strokeWidth":2.2},{"mark":"line","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"acc","stroke":"var(--clay)","strokeWidth":2.6},{"mark":"dot","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"acc","fill":"var(--clay)","r":2.2,"tip":["step","acc"]},{"mark":"text","data":[{"x":358,"y":82,"t":"Muon+AdamW 77.0%"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"x":358,"y":15,"t":"全参数 AdamW 23.7%"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"},{"mark":"text","data":[{"x":358,"y":2,"t":"SGD / Momentum 7.4%"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--muted)"}]}]}
```

曲线演化的阶段特征与前五节的推导一一对应：前 50 步内，四组优化器都迅速拟合了齐夫高频背景词的一元分布，将整体损失从 $4.85$ 压至 $2.80$ 附近；此后，`SGD` 与普通 `Momentum` 由于梯度长期被高频背景词方向主导，负责跨位置匹配的诱导头（Induction Head，即在上下文中定位历史相同词元并复制其后继词元的双层注意力机制）对应的低奇异值方向难以成型，检索准确率始终停留在 $7.3\% \sim 7.4\%$；`AdamW` 在第 150 步后缓慢启动子空间对齐，360 步达到 $23.7\%$（注意 `Muon+AdamW` 在 250 步后验证集整体交叉熵微幅回升，是因为固定小训练集上高频背景位置出现了轻微过拟合，但需要精细多头对齐的跨位置键值检索准确率在约第 120 步率先越过相变阈值，最终升至 $77.0\%$）。

---

## 七、单文件完整 PyTorch 实现：迷你 Transformer 与 `Muon + AdamW` 混合训练

下面给出自包含的单文件 PyTorch 代码，将前文推导的每一个环节——混合精度安全的 `RMSNorm`、多头因果自注意力切分、5 步牛顿-舒尔茨迭代、月之暗面 RMS 对齐版 `Muon`、按诱导范数规则的参数分流，以及 1 个完整 Epoch（1000 条序列，批大小 20，共 50 个 Step）的训练循环——完整对应到代码行：

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

回顾全文推导，从标量梯度下降到现代大模型混合优化器的演进，本质上只围绕三个问题逐步深化：**如何利用历史梯度平滑噪声与曲率振荡**、**如何将权重衰减与自适应预条件正确解耦**，以及**如何为不同几何角色的层选择匹配其输入输出空间的诱导范数**：

```data title="五种优化器更新机制、对应约束范数与受控实验表现汇总" bars="检索率" mark="Muon+AdamW" note="检索率取自第六节双层 4 头 Mini-Transformer 跨位置键值检索实验（第 360 步均值；Adam+L2 重点见第三节衰减对比故未重复跑该项）。"
方案 | 更新信号与谱变换 | 权重衰减 | 隐含约束范数 | 检索率
SGD (+L2) | $g_t$（标量步长） | 混入 $g_t + \lambda\theta$ | $\|\Delta\theta\|_2$ | 7.3%
Momentum | $m_t$（一阶惯性） | 混入 $g_t + \lambda\theta$ | $\|\Delta\theta\|_2$ + 惯性 | 7.4%
Adam (+L2) | $\hat{m}_t / (\sqrt{\hat{v}_t} + \epsilon)$ | 与 $\sqrt{\hat{v}_t}$ 耦合失真 | $\|\Delta\theta\|_\infty$ | —
AdamW | $\hat{m}_t / (\sqrt{\hat{v}_t} + \epsilon)$ | 解耦 $(1-\eta\lambda)\theta$ | $\|\Delta\theta\|_\infty$ | 23.7%
Muon+AdamW | $\tilde{M}_t$ 经 5 步 NS5 | 解耦 $(1-\eta\lambda)W$ | $\|\Delta W\|_{\mathrm{RMS}\to\mathrm{RMS}}$ | 77.0%
```

把握住“显存四类张量的生命周期 $\to$ 线性层外积梯度 $G = \Delta^\top X$ 的谱偏斜成因 $\to$ 各层输入输出范数决定的 `Muon` / `AdamW` 分流”这一条主线，再去阅读 `modded-nanogpt`、`Moonlight` 或主流大模型预训练框架的优化器源码时，每一处矩阵转置、半精度转换与缩放系数便都有了清晰的数学落点。

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
