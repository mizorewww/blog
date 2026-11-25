---
title: "From Transformer Matrix Flows to Modern Optimizer Derivations (SGD → AdamW → Muon)"
description: "Starting from autoregressive language modeling, we classify the four tensor families in VRAM across inference and training, derive cross-entropy and linear-layer backpropagation, trace four generations of entrywise optimizers, and derive the matrix optimizer Muon from induced operator norms and Newton-Schulz iterations."
date: 2026-11-24
tag: "Tech"
tags:
  - "LLM"
  - "AI"
  - "Architecture"
draft: false
---

Deep learning courses and production codebases often meet across a noticeable conceptual gap.

Chapters on neural architectures—such as the Transformer[@vaswani2017]—revolve around three-dimensional activation tensors, multi-head subspace projections, and causal attention matrices. Chapters on optimization—such as SGD[@robbins1951] and AdamW[@loshchilov2019]—collapse every parameter in the network into a flat vector $\theta \in \mathbb{R}^p$ and study scalar coordinate updates on quadratic bowls.

The moment you open a real LLM pretraining script, those two narratives collide. What actually lives in GPU memory? Why is there no token-by-token loop during training? How does a scalar loss differentiate into 2D weight gradients—and how should 2D operators be stepped?

This post follows one continuous chain of derivations from bottom to top, fitting every piece onto the same map.

## Five Core Questions and Roadmap

Specifically, we answer five connected questions in order:

1. **What role does each "matrix" in VRAM play?** Token embeddings, $Q/K/V$ projections, $T \times T$ attention tables, the `KV Cache`, gradients, and momentum buffers coexist in GPU memory. Which belong to the model itself, and which are transient scaffolding?
2. **Why is inference sequential while training is parallel—and why does training take multiples more VRAM?** Chat generation produces one token at a time, yet training code feeds entire sequences in one shot without any token loop.
3. **How does a scalar loss turn back into 2D gradient matrices?** `loss.backward()` starts from a single number $L \in \mathbb{R}$ and produces a gradient matrix $G$ matching every weight $W$. What matrix contraction makes that happen—and why is the singular spectrum of $G$ so heavily skewed?
4. **What did each of the four entrywise optimizer generations fix?** Moving from `SGD` to `Momentum`, `Adam`, and `AdamW`, how do cold-start bias correction and decoupled weight decay emerge from first principles?
5. **Why does the 2D matrix optimizer `Muon` outperform entrywise methods?** When a parameter is a $d_{\mathrm{out}} \times d_{\mathrm{in}}$ linear operator, what geometry does elementwise scaling miss? How does `Muon`[@jordan2024][@liu2025] derive the semi-orthogonal step $U V^\top$ from induced operator norms, and compute it in five `bfloat16` matrix multiplications without SVD?

We tackle these in four stages.

Section 1 starts from autoregressive probability factorization and sorts all tensors across inference and training into four lifecycle families. Section 2 derives the forward and backward equations of a single training step, exposing the sum-of-outer-products structure of linear gradients.

Next comes optimization. Under a single variational lens—local linearization plus a proximal penalty or norm-ball constraint—Section 3 derives four generations of entrywise optimizers, and Sections 4–5 derive 2D spectral optimizers from `Shampoo` to `Muon` and Moonshot AI's scale alignment.

Finally, Sections 6–7 close the loop with a GPU Roofline analysis, controlled ablations, and a single-file runnable PyTorch script.

## Bird's-Eye Overview: Model, Inference, Training, and Optimizers on One Map

Before diving into equations, let us put the entire system on one mental map.

An LLM itself is remarkably simple: it is just a fixed set of **static parameter matrices $\Theta$** persisted on disk and in VRAM. That set holds the boundary vocabulary tables $E_{\mathrm{tok}}, W_{\mathrm{head}}$, $L$ stacked layers of 2D linear operators $W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}$, and 1D normalization gains $\gamma$.

Around that single set of weights $\Theta$, **inference** and **training** run two fundamentally different dataflows:

- **Inference is a read-only one-way pipeline** (Section 1). $\Theta$ stays frozen throughout. Prompt tokens first pass through a parallel `Prefill` GEMM stage that populates the `KV Cache`. Subsequent `Decode` steps feed just 1 new token row via matrix-vector products (GEMV) to sample one token at a time, freeing activations immediately after each layer.
- **Training is a parameter-mutating four-step closed loop** (Sections 2–5). **1. Parallel Forward** evaluates the whole sequence at once, keeping intermediate activations $X$ alive in VRAM. **2. Cross-Entropy Loss** reduces all predictions to a single scalar $L$. **3. Backward** contracts out the batch-and-token axis via $G = \Delta^\top X$ to form a same-shape gradient $G$ for every weight. **4. Optimizer Step** combines $G$ with historical states to overwrite $\Theta$—routing boundary vocabulary tables to `AdamW` (Section 3) and internal 2D linear operators (>95% of non-embedding weights) to `Muon` (Sections 4–5).

```sketch title="Bird's-Eye Overview: How Static Parameters $\Theta$ Sit Between Read-Only Inference and the 4-Step Training Loop" note="Blue denotes static model parameters $\Theta$; teal denotes transient activations or updates; violet denotes the inference KV Cache or momentum buffers; orange denotes backward gradient matrices."
<svg viewBox="0 0 704 292">
  <rect class="panel" x="0" y="0" width="216" height="292" rx="12"/>
  <text class="caps" x="18" y="24">INFERENCE · READ-ONLY FLOW</text>
  <g class="node clay"><rect x="18" y="42" width="180" height="32" rx="16"/><text class="mid b" x="108" y="58">Input Prompt Prefix</text></g>
  <path class="edge" d="M108 74 V92" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="18" y="96" width="180" height="44" rx="6"/><text class="mid b" x="108" y="111">1. Prefill Pass (GEMM)</text><text class="mid small" x="108" y="129">Parallel rows, freed at once</text></g>
  <path class="edge" d="M108 140 V158" marker-end="url(#arrow)"/>
  <g class="node violet"><rect x="18" y="162" width="180" height="44" rx="6"/><text class="mid b" x="108" y="177">2. Inference KV Cache</text><text class="mid small" x="108" y="195">Stores past K, V (+1 row/step)</text></g>
  <path class="edge" d="M108 206 V224" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="18" y="228" width="180" height="46" rx="6"/><text class="mid b" x="108" y="244">3. Token Decode (GEMV)</text><text class="mid small" x="108" y="262">1-row query samples next token</text></g>

  <rect class="panel" x="240" y="0" width="224" height="292" rx="12"/>
  <text class="caps" x="258" y="24">MODEL · STATIC PARAMS Θ</text>
  <g class="node blue"><rect x="258" y="42" width="188" height="54" rx="6"/><text class="mid b" x="352" y="59">Boundary Lookup &amp; Head</text><tex class="mid small" x="352" y="81">E_{\mathrm{tok}},\; W_{\mathrm{head}} \in \mathbb{R}^{V \times D}</tex></g>
  <g class="node blue"><rect x="258" y="108" width="188" height="78" rx="6"/><text class="mid b" x="352" y="126">Internal L-Layer 2D Ops</text><tex class="mid small" x="352" y="149">W_{q,k,v,o} \in \mathbb{R}^{D \times D}</tex><tex class="mid small" x="352" y="171">W_{\mathrm{up}}, W_{\mathrm{down}} \in \mathbb{R}^{4D \times D}</tex></g>
  <g class="node plain"><rect x="258" y="198" width="188" height="44" rx="6"/><text class="mid b" x="352" y="213">1D Norm Channel Gain</text><tex class="mid small" x="352" y="231">\gamma \in \mathbb{R}^D</tex></g>
  <text class="mid small b" x="352" y="268">Frozen in inference · Mutated in training</text>

  <path class="edge dash" d="M240 118 H202" marker-end="url(#arrow)"/>
  <path class="edge dash" d="M240 250 H202" marker-end="url(#arrow)"/>
  <text class="mid small" x="221" y="108">read</text>

  <rect class="panel" x="488" y="0" width="216" height="292" rx="12"/>
  <text class="caps" x="506" y="24">TRAINING · 4-STEP LOOP</text>
  <g class="node teal"><rect x="506" y="42" width="180" height="46" rx="6"/><text class="mid b" x="596" y="57">1. Parallel Forward</text><text class="mid small" x="596" y="75">Retains X in VRAM for bwd</text></g>
  <path class="edge" d="M596 88 V104" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="506" y="108" width="180" height="34" rx="17"/><text class="mid b" x="596" y="125">2. Cross-Entropy Scalar L</text></g>
  <path class="edge" d="M596 142 V158" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="506" y="162" width="180" height="48" rx="6"/><text class="mid b" x="596" y="178">3. Backward Pass</text><tex class="mid small" x="550" y="198">G = \Delta^\top X</tex><text class="small" x="588" y="198">(sums tokens)</text></g>
  <path class="edge" d="M596 210 V226" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="506" y="230" width="180" height="48" rx="6"/><text class="mid b" x="596" y="246">4. Dual-Optimizer step()</text><text class="mid small" x="596" y="265">AdamW (bounds) + Muon (2D)</text></g>

  <path class="edge dash" d="M464 65 H502" marker-end="url(#arrow)"/>
  <path class="edge hot" d="M506 254 H468" marker-end="url(#arrow)"/>
  <text class="mid small accent" x="486" y="244">write</text>
</svg>
<svg viewBox="0 0 340 508">
  <rect class="panel" x="0" y="0" width="340" height="148" rx="12"/>
  <text class="caps" x="16" y="24">MODEL · STATIC PARAMS Θ</text>
  <g class="node blue"><rect x="16" y="38" width="148" height="50" rx="6"/><text class="mid b" x="90" y="54">Boundary Tables</text><tex class="mid small" x="90" y="75">E_{\mathrm{tok}}, W_{\mathrm{head}}</tex></g>
  <g class="node blue"><rect x="174" y="38" width="150" height="50" rx="6"/><text class="mid b" x="249" y="54">Internal 2D Ops</text><tex class="mid small" x="249" y="75">W_{q..o}, W_{\mathrm{up}}, W_{\mathrm{down}}</tex></g>
  <text class="small b" x="16" y="114">Shapes fixed by architecture; saved in checkpoints</text>
  <text class="small" x="16" y="134">Read-only in inference · Updated in training</text>

  <rect class="panel" x="0" y="162" width="340" height="150" rx="12"/>
  <text class="caps" x="16" y="186">INFERENCE · READ-ONLY PIPELINE (SEC. 1)</text>
  <g class="node teal"><rect x="16" y="200" width="144" height="44" rx="6"/><text class="mid b" x="88" y="215">1. Prefill (GEMM)</text><text class="mid small" x="88" y="233">Parallel prefix pass</text></g>
  <path class="edge" d="M160 222 H178" marker-end="url(#arrow)"/>
  <g class="node violet"><rect x="182" y="200" width="142" height="44" rx="6"/><text class="mid b" x="253" y="215">2. KV Cache</text><text class="mid small" x="253" y="233">Stores past K, V</text></g>
  <path class="edge" d="M253 244 V258 H170 V262" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="16" y="264" width="308" height="34" rx="17"/><text class="mid b" x="170" y="281">3. Decode 1-row GEMV samples next token</text></g>

  <rect class="panel" x="0" y="326" width="340" height="182" rx="12"/>
  <text class="caps" x="16" y="350">TRAINING · 4-STEP CLOSED LOOP (SEC. 2–5)</text>
  <g class="node teal"><rect x="16" y="364" width="144" height="44" rx="6"/><text class="mid b" x="88" y="379">1. Forward Pass</text><text class="mid small" x="88" y="397">Caches activations X</text></g>
  <path class="edge" d="M160 386 H178" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="182" y="364" width="142" height="44" rx="22"/><text class="mid b" x="253" y="379">2. CE Loss</text><text class="mid small" x="253" y="397">Reduces to scalar L</text></g>
  <path class="edge" d="M253 408 V424 H90 V428" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="16" y="430" width="148" height="56" rx="6"/><text class="mid b" x="90" y="448">3. Backward</text><tex class="mid small" x="90" y="470">G = \Delta^\top X</tex></g>
  <path class="edge hot" d="M164 458 H180" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="184" y="430" width="140" height="56" rx="6"/><text class="mid b" x="254" y="448">4. Update Θ</text><text class="mid small" x="254" y="470">AdamW + Muon</text></g>
</svg>
```

---

## 1. Autoregressive Factorization and the Four Tensor Families in VRAM

### 1.1 What a Language Model Computes: Chain Rule of Probability and Token Embeddings

Let the vocabulary $\mathcal{V} = \{0, 1, \dots, V-1\}$ contain $V$ discrete tokens. Given a sequence $x_{1:T} = (x_1, x_2, \dots, x_T) \in \mathcal{V}^T$ of length $T$, the product rule of probability factors the joint distribution into next-token conditionals:

$$
p_\Theta(x_1, x_2, \dots, x_T) = \prod_{t=1}^{T} p_\Theta(x_t \mid x_1, \dots, x_{t-1})
$$

This factorization is exact—no conditional-independence assumption is made. Here $\Theta$ denotes all learnable parameters of the model.

An LLM's job is now concrete: build a $\Theta$-parameterized function that reads a prefix $x_{1:t}$ and outputs unnormalized log-scores (logits) $z_t \in \mathbb{R}^V$ over all $V$ candidate next tokens. Softmax then converts those logits into a valid probability distribution:

$$
p_\Theta(x_{t+1} = k \mid x_{1:t}) = \frac{\exp(z_{t,k})}{\sum_{m=0}^{V-1} \exp(z_{t,m})}, \qquad k \in \{0, \dots, V-1\}
$$

Discrete token IDs, however, are arbitrary dictionary labels—token `500` is not "twice" token `250`, and derivatives cannot act on integers.

So the network starts with a token embedding matrix $E_{\mathrm{tok}} \in \mathbb{R}^{V \times D}$, mapping each integer ID $x_t$ to row $x_t$ in $\mathbb{R}^D$. If we write $u_{x_t} \in \{0,1\}^V$ for the one-hot column vector with a $1$ at index $x_t$, row lookup is algebraically identical to the sparse product $u_{x_t}^\top E_{\mathrm{tok}} \in \mathbb{R}^{1 \times D}$.

Row lookup alone is still blind to word order. Dot products in self-attention are permutation-equivariant: without position signals, `"cat chased dog"` and `"dog chased cat"` simply permute the exact same output vectors.

We therefore inject positional encodings $E_{\mathrm{pos}} \in \mathbb{R}^{T \times D}$ to form the initial state $X^{(0)} \in \mathbb{R}^{T \times D}$ (or $\mathbb{R}^{B \times T \times D}$ across a batch of $B$ sequences). From there on, every sublayer adds its update back onto this shared highway via $X \leftarrow X + \mathrm{Sublayer}(X)$—the **residual stream**.

### 1.2 Forward Equations of a Single Transformer Block

Modern open-weights LLMs (Llama, Qwen, DeepSeek) use a bias-free Pre-RMSNorm decoder block[@vaswani2017][@zhang2019].

Take a single sequence's residual stream $X \in \mathbb{R}^{T \times D}$ with hidden width $D$. Before each sublayer, row-wise root-mean-square normalization maps each token vector $x \in \mathbb{R}^D$ to $\mathrm{RMSNorm}(x) = \frac{x}{\sqrt{\frac{1}{D}\sum_{i=1}^D x_i^2 + \epsilon}} \odot \gamma$, where $\epsilon > 0$ prevents division by zero, $\gamma \in \mathbb{R}^D$ is a learnable channel gain, and $\odot$ is elementwise multiplication (we prove its backward orthogonality in Section 2.1).

Each Transformer layer chains two sublayers in sequence.

**Sublayer 1 is Multi-Head Causal Self-Attention.** We normalize row by row into $H = \mathrm{RMSNorm}(X) \in \mathbb{R}^{T \times D}$ and project into queries, keys, and values:

$$
Q = H W_q^\top, \qquad K = H W_k^\top, \qquad V_{\mathrm{val}} = H W_v^\top
$$

Here $W_q, W_k, W_v$ all have shape $\mathbb{R}^{D \times D}$.

Why split into multiple heads? A single dot product across all $D$ dimensions would give each token only one attention distribution per layer, forcing coreference, syntax, and local idioms to fight over a single set of weights.

Instead, we slice $D$ into $H_{\mathrm{head}}$ parallel subspaces (heads) of width $d_k = D / H_{\mathrm{head}}$. In batched code, $(B, T, D)$ reshapes to $(B, T, H_{\mathrm{head}}, d_k)$ and transposes to $(B, H_{\mathrm{head}}, T, d_k)$. On head $h$'s slices $Q^{(h)}, K^{(h)}, V_{\mathrm{val}}^{(h)} \in \mathbb{R}^{T \times d_k}$, causal attention runs in three steps:

$$
S^{(h)} = \frac{Q^{(h)} \bigl(K^{(h)}\bigr)^\top}{\sqrt{d_k}} + M_{\mathrm{causal}}, \qquad P^{(h)} = \mathrm{softmax}\!\left(S^{(h)}\right), \qquad O^{(h)} = P^{(h)} V_{\mathrm{val}}^{(h)}
$$

Both $S^{(h)}$ and $P^{(h)}$ are $T \times T$ matrices. The causal mask $M_{\mathrm{causal}} \in \{0, -\infty\}^{T \times T}$ puts $0$ on and below the diagonal ($i \ge j$) and $-\infty$ strictly above it ($i < j$, where token $i$ would peek at future token $j$).

Since $\exp(-\infty) = 0$, row-wise Softmax makes $P^{(h)}$ strictly lower-triangular: row $i$'s output can only blend information from positions $\le i$.

Why divide by $\sqrt{d_k}$?

Suppose entries of $q, k \in \mathbb{R}^{d_k}$ are independent with zero mean and unit variance. Each product $q_m k_m$ has mean $0$ and variance $1$, so summing $d_k$ terms makes the dot-product variance grow linearly with head width:

$$
\mathrm{Var}(q^\top k) = \sum_{m=1}^{d_k} \mathrm{Var}(q_m k_m) = d_k
$$

Without $\frac{1}{\sqrt{d_k}}$, at $d_k = 64$ or $128$ the standard deviation reaches $8$–$11.3$. Peak scores tower over the rest of the row, pushing Softmax outputs $P_{i,a}$ into near one-hot saturation.

That saturation kills gradients. Differentiating Softmax gives the Jacobian $\partial P_{i,a} / \partial S_{i,b} = P_{i,a}(\delta_{ab} - P_{i,b})$. Once $P$ hardens to $0$s and $1$s, every entry of that Jacobian vanishes for both $a = b$ and $a \neq b$, starving $W_q$ and $W_k$ of gradient signal[@vaswani2017]. Dividing by $\sqrt{d_k}$ restores unit variance.

Finally, concatenating all $H_{\mathrm{head}}$ heads back into $O = [O^{(1)}, \dots, O^{(H_{\mathrm{head}})}] \in \mathbb{R}^{T \times D}$, multiplying by $W_o^\top$ ($W_o \in \mathbb{R}^{D \times D}$), and adding back to the residual stream yields $X' = X + O W_o^\top$.

**Sublayer 2 is the Position-wise FFN / MLP.** Normalizing again via $H' = \mathrm{RMSNorm}(X')$, we expand through $W_{\mathrm{up}} \in \mathbb{R}^{d_{\mathrm{ff}} \times D}$ (classically $d_{\mathrm{ff}} = 4D$), apply an elementwise nonlinearity $\sigma(\cdot)$ such as $\mathrm{SiLU}(z) = z / (1 + e^{-z})$, project back down via $W_{\mathrm{down}} \in \mathbb{R}^{D \times d_{\mathrm{ff}}}$, and add back to the residual stream:

$$
X_{\mathrm{out}} = X' + \sigma(H' W_{\mathrm{up}}^\top) W_{\mathrm{down}}^\top
$$

After $L$ stacked blocks, a final `RMSNorm` and multiplication by $W_{\mathrm{head}}^\top$ ($W_{\mathrm{head}} \in \mathbb{R}^{V \times D}$) produce the sequence logits $Z \in \mathbb{R}^{T \times V}$.

> **Note on PyTorch `nn.Linear` weight shapes**: calling `nn.Linear(in_features=64, out_features=256, bias=False)` stores `.weight` with transposed shape `(256, 64)`—that is, $(d_{\mathrm{out}}, d_{\mathrm{in}})$—and computes $H W^\top$. Because C/CUDA arrays are row-major, storing each output neuron's $d_{\mathrm{in}}$ weights contiguously along a row makes dot-product memory reads sequential. Throughout this post, every 2D weight $W \in \mathbb{R}^{A \times B}$ follows PyTorch layout with $A = d_{\mathrm{out}}$ rows and $B = d_{\mathrm{in}}$ columns.

### 1.3 The Four Tensor Families in GPU Memory

Every array in the equations above gets called a "matrix" in casual conversation. By mathematical role, shape scaling, and memory lifetime, however, they split cleanly into four distinct families:

```sketch title="Mathematical Roles and Lifetimes of the Four Tensor Families in VRAM" note="Static parameter shapes depend only on architecture hyperparameters; dynamic activations scale with batch B and sequence length T; the KV Cache grows token-by-token only during decoding; gradients and optimizer states are allocated alongside parameters only during training."
<svg viewBox="0 0 704 268">
  <rect class="panel" x="0" y="0" width="344" height="124" rx="12"/>
  <text class="caps" x="20" y="25">FAMILY 1 · PARAMETERS</text>
  <g class="node blue"><rect x="20" y="38" width="144" height="36" rx="4"/><text class="mid b" x="92" y="56">Static Weights</text></g>
  <g class="node plain"><rect x="174" y="38" width="150" height="36" rx="4"/><tex class="mid" x="249" y="56">W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}</tex></g>
  <text class="small" x="20" y="94">Shape fixed by model config; independent of length T</text>
  <text class="small b" x="20" y="112">Frozen in inference · Updated by optimizer in training</text>

  <rect class="panel" x="360" y="0" width="344" height="124" rx="12"/>
  <text class="caps" x="380" y="25">FAMILY 2 · ACTIVATIONS</text>
  <g class="node teal"><rect x="380" y="38" width="136" height="36" rx="4"/><text class="mid b" x="448" y="56">Activations</text></g>
  <g class="node plain"><rect x="526" y="38" width="158" height="36" rx="4"/><tex class="mid" x="605" y="56">X \in \mathbb{R}^{B \times T \times D},\; P \in \mathbb{R}^{T \times T}</tex></g>
  <text class="small" x="380" y="94">Computed on the fly per input batch (incl. attention P)</text>
  <text class="small b" x="380" y="112">Freed per layer in inference · Cached in training for bwd</text>

  <rect class="panel" x="0" y="140" width="344" height="128" rx="12"/>
  <text class="caps" x="20" y="165">FAMILY 3 · INFERENCE CACHE</text>
  <g class="node violet"><rect x="20" y="178" width="136" height="36" rx="4"/><text class="mid b" x="88" y="196">KV Cache</text></g>
  <g class="node plain"><rect x="166" y="178" width="158" height="36" rx="4"/><tex class="mid" x="245" y="196">K_{\mathrm{cache}} \in \mathbb{R}^{B \times H \times t \times d_k}</tex></g>
  <text class="small" x="20" y="234">Stores past token keys &amp; values; appends 1 row/step</text>
  <text class="small b" x="20" y="252">Inference-only resident · Never allocated in training</text>

  <rect class="panel" x="360" y="140" width="344" height="128" rx="12"/>
  <text class="caps" x="380" y="165">FAMILY 4 · TRAINING STATES</text>
  <g class="node clay"><rect x="380" y="178" width="136" height="36" rx="4"/><text class="mid b" x="448" y="196">Grads &amp; States</text></g>
  <g class="node plain"><rect x="526" y="178" width="158" height="36" rx="4"/><tex class="mid" x="605" y="196">G, M, V \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}</tex></g>
  <text class="small" x="380" y="234">Same-shape gradient G, 1st moment M, 2nd moment V</text>
  <text class="small accent" x="380" y="252">Training-only · Muon drops V on all internal 2D layers</text>
</svg>
<svg viewBox="0 0 340 524">
  <rect class="panel" x="0" y="0" width="340" height="120" rx="12"/>
  <text class="caps" x="16" y="24">1 · PARAMETERS</text>
  <g class="node blue"><rect x="16" y="36" width="132" height="34" rx="4"/><text class="mid b" x="82" y="53">Static Weights</text></g>
  <g class="node plain"><rect x="156" y="36" width="168" height="34" rx="4"/><tex class="mid" x="240" y="53">W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}</tex></g>
  <text class="small" x="16" y="90">Independent of T; the only tensors saved to disk</text>
  <text class="small b" x="16" y="108">Read-only in inference · Updated in training</text>

  <rect class="panel" x="0" y="132" width="340" height="120" rx="12"/>
  <text class="caps" x="16" y="156">2 · ACTIVATIONS</text>
  <g class="node teal"><rect x="16" y="168" width="132" height="34" rx="4"/><text class="mid b" x="82" y="185">Activations</text></g>
  <g class="node plain"><rect x="156" y="168" width="168" height="34" rx="4"/><tex class="mid" x="240" y="185">X,\; P \in \mathbb{R}^{T \times T}</tex></g>
  <text class="small" x="16" y="222">Computed per input batch, incl. attention matrix P</text>
  <text class="small b" x="16" y="240">Freed in inference · Cached in training for bwd</text>

  <rect class="panel" x="0" y="264" width="340" height="120" rx="12"/>
  <text class="caps" x="16" y="288">3 · INFERENCE CACHE</text>
  <g class="node violet"><rect x="16" y="300" width="132" height="34" rx="4"/><text class="mid b" x="82" y="317">KV Cache</text></g>
  <g class="node plain"><rect x="156" y="300" width="168" height="34" rx="4"/><tex class="mid" x="240" y="317">K_{\mathrm{cache}} \in \mathbb{R}^{B \times H \times t \times d_k}</tex></g>
  <text class="small" x="16" y="354">Saves past keys &amp; values; grows by 1 row per step</text>
  <text class="small b" x="16" y="372">Inference-only · Not allocated in training</text>

  <rect class="panel" x="0" y="396" width="340" height="128" rx="12"/>
  <text class="caps" x="16" y="420">4 · TRAINING STATES</text>
  <g class="node clay"><rect x="16" y="432" width="132" height="34" rx="4"/><text class="mid b" x="82" y="449">Grads &amp; States</text></g>
  <g class="node plain"><rect x="156" y="432" width="168" height="34" rx="4"/><tex class="mid" x="240" y="449">G, M, V \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}</tex></g>
  <text class="small" x="16" y="486">Same-shape grad G, momentum M, second moment V</text>
  <text class="small accent" x="16" y="506">Muon eliminates V across all internal 2D layers</text>
</svg>
```

Newcomers most often conflate **projection weights $W_q, W_k \in \mathbb{R}^{D \times D}$** with the **attention probability matrix $P \in \mathbb{R}^{T \times T}$**.

$W_q$ and $W_k$ are Family 1 static parameters. Whether the prompt has 4 tokens or 4,096 tokens, their shape stays locked at $D \times D$, and they are the actual weights updated by the optimizer.

$P$, by contrast, is a Family 2 transient activation. Its side length grows and shrinks with sequence length $T$, recording temporary token-to-token alignments inside a single forward pass—never saved in checkpoints and never stepped by an optimizer.

```sketch title="Static Projection Weights $W_q, W_k$ vs. Transient Attention Matrix $P$" note="Projection matrices $W_q, W_k$ have fixed shape $(D, D)$ shared across all inputs; the attention matrix $P$ has dynamic shape $(T, T)$ representing temporary token-to-token routing inside one sequence."
<svg viewBox="0 0 704 202">
  <rect class="panel" x="0" y="0" width="340" height="202" rx="12"/>
  <text class="small b" x="24" y="28">Family 1 Static Params: Query &amp; Key Projections</text>
  <g class="node blue"><rect x="24" y="46" width="144" height="58" rx="6"/><tex class="mid" x="96" y="65">W_q,\; W_k</tex><tex class="mid small" x="96" y="88">\mathbb{R}^{D \times D}\;(64 \times 64)</tex></g>
  <path class="edge" d="M168 75 H198" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="202" y="46" width="118" height="58" rx="6"/><text class="mid b" x="261" y="66">Updated by Opt</text><text class="mid small" x="261" y="88">Saved to weights</text></g>
  <text class="small" x="24" y="134">Shape fixed by hidden width D, independent of T</text>
  <text class="small b" x="24" y="156">Defines subspace maps for queries and keys</text>
  <text class="small" x="24" y="178">Primary target of spectral optimizer Muon (Sec. 4)</text>

  <rect class="panel" x="364" y="0" width="340" height="202" rx="12"/>
  <text class="small b" x="388" y="28">Family 2 Activation: Causal Attention Matrix</text>
  <g class="node plain"><rect x="388" y="46" width="148" height="58" rx="6"/><tex class="mid" x="462" y="65">P = \mathrm{softmax}(S)</tex><tex class="mid small" x="462" y="88">\mathbb{R}^{T \times T}</tex></g>
  <path class="edge hot" d="M536 75 H562" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="566" y="46" width="118" height="58" rx="6"/><text class="mid b" x="625" y="66">Transient Value</text><text class="mid small" x="625" y="88">Not a parameter</text></g>
  <text class="small" x="388" y="134">4×4 for a 4-token input; 100×100 for 100 tokens</text>
  <text class="small accent" x="388" y="156">Upper triangle is 0 by causal mask; freed after step</text>
  <text class="small" x="388" y="178">Used in backward pass only to route upstream grads</text>
</svg>
<svg viewBox="0 0 340 380">
  <rect class="panel" x="0" y="0" width="340" height="180" rx="12"/>
  <text class="small b" x="16" y="26">Family 1 Params: Projection Weights</text>
  <g class="node blue"><rect x="16" y="42" width="146" height="54" rx="6"/><tex class="mid" x="89" y="60">W_q,\; W_k</tex><tex class="mid small" x="89" y="82">\mathbb{R}^{D \times D}</tex></g>
  <path class="edge" d="M162 69 H188" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="192" y="42" width="132" height="54" rx="6"/><text class="mid b" x="258" y="61">Updated by Opt</text><text class="mid small" x="258" y="81">Saved to disk</text></g>
  <text class="small" x="16" y="124">Fixed shape D×D, independent of sequence length T</text>
  <text class="small b" x="16" y="146">Internal 2D operators updated by Muon</text>

  <rect class="panel" x="0" y="196" width="340" height="184" rx="12"/>
  <text class="small b" x="16" y="222">Family 2 Activation: Attention Matrix</text>
  <g class="node plain"><rect x="16" y="238" width="146" height="54" rx="6"/><tex class="mid" x="89" y="256">P = \mathrm{softmax}(S)</tex><tex class="mid small" x="89" y="278">\mathbb{R}^{T \times T}</tex></g>
  <path class="edge hot" d="M162 265 H188" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="192" y="238" width="132" height="54" rx="6"/><text class="mid b" x="258" y="257">Transient Data</text><text class="mid small" x="258" y="277">Not trainable</text></g>
  <text class="small" x="16" y="320">Scales as T×T per sequence; discarded after step</text>
  <text class="small accent" x="16" y="342">Upper triangle is 0 to block future token leakage</text>
</svg>
```

Comparing the mini Transformer used in Section 7 ($B=20, T=16, D=64, H=4, d_k=16, V=1000$) against a production 7B-class model summarizes all 14 tensors across the pipeline:

```data title="14 Tensor Types Across Transformer Inference and Training" mark="Attention $W_q \dots W_o$,FFN $W_{\mathrm{up}} / W_{\mathrm{down}}$" note="Production models (e.g., Llama 3 / Qwen) commonly use Grouped-Query Attention (GQA) to shrink the output rows of $W_k, W_v$ for a smaller KV Cache, and add a gate matrix $W_{\mathrm{gate}}$ in SwiGLU FFNs; all remain dense 2D linear operators."
Tensor & Symbol | Family | Mini Shape | Typical 7B Shape | Inference | Training
Inputs & targets $x, y$ | Token IDs | $(20, 16)$ | $(B, 4096)$ | Prefix only | Shifted by 1 token
Token emb $E_{\mathrm{tok}}$ | 1. Parameter | $(1000, 64)$ | $(128256, 4096)$ | Read-only lookup | AdamW step
Pos emb $E_{\mathrm{pos}}$ | 1. Parameter | $(32, 64)$ | Parameter-free RoPE | Broadcast add | AdamW step
Attention $W_q \dots W_o$ | 1. Parameter | Four $(64, 64)$ | $(4096, 4096)$ | Read-only GEMM | Muon orthogonal step
FFN $W_{\mathrm{up}} / W_{\mathrm{down}}$ | 1. Parameter | $(256,64)/(64,256)$ | $(11008, 4096)$ | Read-only GEMM | Muon orthogonal step
Norm gain $\gamma$ | 1. Parameter | $(64,)$ 1D | $(4096,)$ 1D | Channel scale | AdamW (wd=0)
LM head $W_{\mathrm{head}}$ | 1. Parameter | $(1000, 64)$ | $(128256, 4096)$ | Last-row logits | AdamW step
Residual & norm $X, H$ | 2. Activation | $(20, 16, 64)$ | $(B, T, 4096)$ | Freed per layer | Cached for backward
Multi-head $Q, K, V_{\mathrm{val}}$ | 2. Activation | $(20, 4, 16, 16)$ | $(B, 32, T, 128)$ | Freed per layer | Cached for backward
Attention $S, P$ | 2. Activation | $(20, 4, 16, 16)$ | $(B, 32, T, T)$ | Freed per layer | Cached or recomputed
Logit tensor $Z$ | 2. Activation | $(20, 16, 1000)$ | $(B, T, 128256)$ | Last row only | Full-seq CE loss
Cache $K/V_{\mathrm{cache}}$ | 3. KV Cache | $(1, 4, t, 16)$ | $(B, 8, t, 128)$ | +1 row per step | Not allocated
Weight grad $G$ | 4. Train State | Same as param | Same as param | Not allocated | Written in backward
Opt states $M, V$ | 4. Train State | Same as param | Same as param | Not allocated | Resident (Muon drops $V$)
```

### 1.4 Why Inference Needs a `KV Cache` While Training Runs in Parallel

Separating these four families—together with the lower-triangular structure of $M_{\mathrm{causal}}$—immediately explains why **inference splits into `Prefill` and `Decode`** whereas **training runs in parallel (`Teacher Forcing`)**.

Start with **inference**. Future tokens do not exist yet: given a prompt $x_{1:T_0}$, the model must sample $x_{T_0+1}$, append it to the prompt, and only then predict $x_{T_0+2}$.

That dependency splits generation into two stages:

1. **Prefill stage**. All $T_0$ prompt tokens arrive together. $H \in \mathbb{R}^{T_0 \times D}$ multiplies $W^\top \in \mathbb{R}^{D \times D}$ in one dense matrix-matrix product (GEMM), computing $K_{1:T_0}$ and $V_{1:T_0}$ across all $T_0$ positions and sampling the first new token $x_{T_0+1}$ from row $T_0$.
2. **Autoregressive Decode stage**. At step $t$, we hold $x_{1:t}$ and want $x_{t+1}$. What would happen if we naively fed the entire prefix $x_{1:t}$ back into the network?

   Because causal masking forbids positions $1 \dots t-1$ from reading position $t$, the first $t-1$ hidden states $h_1, \dots, h_{t-1}$ and their projected keys and values $k_1, \dots, k_{t-1}$, $v_1, \dots, v_{t-1}$ **would match the previous step bit for bit**. Better yet, predicting $x_{t+1}$ requires only the final output row $o_t$:

$$
o_t^{(h)} = \sum_{j=1}^{t} P_{t,j}^{(h)} v_j^{(h)}, \qquad P_{t, :}^{(h)} = \mathrm{softmax}\!\left(\frac{q_t^{(h)} K_{1:t}^{(h)\top}}{\sqrt{d_k}}\right) \in \mathbb{R}^{1 \times t}
$$

Neither old queries $q_1, \dots, q_{t-1}$ nor the upper $t-1$ rows of the $t \times t$ attention matrix are ever used.

By caching $K_{1:t-1}$ and $V_{1:t-1}$ in VRAM—the `KV Cache`—step $t$ feeds only the single new row $h_t \in \mathbb{R}^{1 \times D}$. Three matrix-vector products (GEMVs) produce $q_t, k_t, v_t$, append $k_t, v_t$ to form $K_{1:t}, V_{1:t}$, and evaluate a slim $(1, d_k) \times (d_k, t)$ product.

Counting multiply-accumulates (MACs, $1\;\text{MAC} = 2\;\text{FLOPs}$) per layer shows how much work that saves.

Without a `KV Cache`, recomputing projections at length $t$ costs $\mathcal{O}(t D^2)$ and attention costs $\mathcal{O}(t^2 D)$; summed from $T_0$ to $N$, total work explodes as $\mathcal{O}(N^2 D^2 + N^3 D)$. With a `KV Cache`, each step projects one row in $\mathcal{O}(D^2)$ and scans $t$ cached keys in $\mathcal{O}(t D)$, cutting cumulative work to $\mathcal{O}(N D^2 + N^2 D)$.

Now flip to **training**.

During training, the entire ground-truth sequence $x_{1:T+1}$ from the corpus is already sitting in memory. We feed $x_{1:T}$ as inputs and the shifted sequence $x_{2:T+1}$ as targets (**Teacher Forcing**).

Because $M_{\mathrm{causal}}$ already blocks row $t$ from reading columns $j > t$ inside the matrix, a single $(B, T, D) \times (D, D)$ GEMM evaluates all $B \times T$ prefix-prediction tasks simultaneously. GPU Tensor Cores run at full tilt, and no `KV Cache` is ever allocated.

```sketch title="Full-Flow LLM Inference Matrix Shapes: Tracking Dimension Alignment & Contraction with Unit Blocks" note="Each discrete square represents one scalar entry ($T_0=3, D=4, d_k=2, d_{\mathrm{ff}}=6, V=6$). Dashed arcs connect matching inner dimensions summed out in matrix multiplication; moving from Stage 1 to Stage 2 collapses every $T_0=3$-row activation into a single $1$-row strip while appending just $1$ row to the violet KV Cache."
<svg viewBox="0 0 704 700">
  <rect class="panel" x="0" y="0" width="704" height="456" rx="12"/>
  <text class="caps" x="18" y="22">STAGE 1 · PREFILL</text>
  <text class="small b" x="156" y="22">Parallel prompt pass (prefix T₀=3, hidden D=4, head dim 2, FFN dim 6, vocab V=6)</text>

  <text class="small b" x="20" y="46">1. Lookup &amp; head projection: shared inner D=4 (blue) contracts out, leaving 3 rows × 2 cols</text>
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
  <text class="mid small" x="120" y="110">3 rows</text>

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

  <text class="small" x="426" y="86">Same shape for K and V:</text>
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
  <text class="small b" x="520" y="128" fill="var(--violet-ink)">← Saved to KV Cache</text>
  <text class="small" x="520" y="146">Reused in Decode steps</text>

  <line x1="18" y1="194" x2="686" y2="194" stroke="var(--line)" stroke-dasharray="3 3"/>

  <text class="small b" x="20" y="216">2. Causal attention &amp; head concat: Q Kᵀ cancels inner dim 2 into lower-triangular [3×3], then × V</text>
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
    <text class="mid small b" x="384.5" y="239" fill="var(--violet-ink)">H1</text>
    <path d="M374 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM388 256h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM374 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM388 270h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM374 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM388 284h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <line x1="403" y1="250" x2="428" y2="250" stroke="var(--violet)" stroke-width="2"/>
    <line x1="403" y1="247" x2="403" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="428" y1="247" x2="428" y2="253" stroke="var(--violet)" stroke-width="1.5"/>
    <text class="mid small b" x="415.5" y="239" fill="var(--violet-ink)">H2</text>
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
  <text class="small" x="556" y="268">Dashed cell = 0</text>
  <text class="small mute" x="556" y="286">Causal future mask</text>

  <line x1="18" y1="322" x2="686" y2="322" stroke="var(--line)" stroke-dasharray="3 3"/>

  <text class="small b" x="20" y="344">3. FFN (4→6→4) &amp; LM head: take only the last row [1×4] × head [4×6] = logits [1×6]</text>
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
  <text class="mid small accent" x="369" y="400">row 3</text>
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
  <text class="small b" x="238" y="494">Step t=4: activations collapse to 1 row [1×4]; KV Cache appends 1 new row</text>

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
    <text class="mid small b" x="258.5" y="530" fill="var(--clay-ink)">3 old + 1 new</text>
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
  <text class="mid small" x="547" y="546">2H+FFN</text>
  <g>
    <line x1="582" y1="548" x2="663" y2="548" stroke="var(--orange)" stroke-width="2"/>
    <line x1="582" y1="545" x2="582" y2="551" stroke="var(--orange)" stroke-width="1.5"/>
    <line x1="663" y1="545" x2="663" y2="551" stroke="var(--orange)" stroke-width="1.5"/>
    <tex class="mid small orange" x="622.5" y="537">V=6</tex>
    <path d="M584 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM598 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM612 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM626 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM640 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM654 554h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
    <tex class="mid small" x="622.5" y="583">z_4\;(1\!\times\!6)</tex>
  </g>

  <text class="small b" x="20" y="650">Static weights (blue) keep fixed shapes; 3-row Prefill activations shrink to 1-row strips in Decode</text>
  <text class="small" x="20" y="672">Violet cells are cached K, V from prefix tokens 1..3; clay cells are the single new row appended at t=4</text>
</svg>
<svg viewBox="0 0 340 634">
  <rect class="panel" x="0" y="0" width="340" height="346" rx="12"/>
  <text class="caps" x="16" y="22">1 · PREFILL (3-ROW PARALLEL GEMM)</text>
  <text class="small b" x="16" y="44">Project: [3×4] × [4×2] → inner 4 cancels to [3×2]</text>
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

  <text class="small b" x="16" y="176">Causal attention: [3×2]×[2×3] = [3×3] lower-tri</text>
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
  <text class="small" x="16" y="282">Take row 3 [1×4] × LM head [4×6] = logits [1×6]</text>
  <g>
    <path d="M28 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM40.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM53 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM65.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.15"/>
  </g>
  <path class="edge" d="M84 301 H124" marker-end="url(#arrow)"/>
  <g>
    <path d="M134 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM146.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM159 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM171.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM184 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM196.5 296h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  </g>
  <tex class="small" x="214" y="301">z_3\;(1\!\times\!6)</tex>

  <rect class="panel" x="0" y="362" width="340" height="272" rx="12"/>
  <text class="caps" x="16" y="384">2 · DECODE (1-ROW QUERY + APPEND ROW 4)</text>
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
    <text class="mid small b" x="111.8" y="407" fill="var(--clay-ink)">3 old+1</text>
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
  <text class="small b" x="16" y="516">Attention shrinks from [3×3] to a 1-row strip [1×4]</text>
  <text class="small" x="16" y="540">Clay cells mark the single new row appended to cache</text>
  <g>
    <path d="M28 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM40.5 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM53 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM65.5 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM78 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2zM90.5 562h6q2 0 2 2v6q0 2-2 2h-6q-2 0-2-2v-6q0-2 2-2z" fill="var(--orange-wash)" stroke="var(--orange)" stroke-width="1.15"/>
  </g>
  <tex class="small" x="112" y="567">z_4\;(1\!\times\!6)\;\longrightarrow\;x_5</tex>
  <text class="small mute" x="16" y="606">Static weights stay fixed; dynamic activations are 1 row</text>
</svg>
```

### 1.5 Unfolding the Matrices: Hand-Tracing a 3-Token Sentence Through `Prefill` and `Decode`

Compact matrix symbols and block diagrams summarize the architecture cleanly. Still, newcomers often hit a wall when asking what happens *inside* the brackets: how do actual numbers move step by step from token IDs to attention outputs?

Let us shrink the dimensions to small integers we can multiply in our heads and unfold every matrix on the page.

Take a 5-token vocabulary $V = 5$ (`0:<pad>`, `1:cat`, `2:chases`, `3:dog`, `4:runs`), hidden width $D = 3$, and single-head width $d_k = 2$. Suppose the prompt is the 3-token prefix `["cat", "chases", "dog"]`, mapped to integer IDs $(1, 2, 3)$.

**Step 1: Embedding lookup as one-hot row selection.** Unfold the static embedding table $E_{\mathrm{tok}} \in \mathbb{R}^{5 \times 3}$. Selecting rows $(1, 2, 3)$ is identical to left-multiplying by a $3 \times 5$ one-hot matrix $U$ (omitting positional offsets here and denoting the unit-RMS rows directly as $H$):

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
\leftarrow \text{token 1 ("cat")} \\
\leftarrow \text{token 2 ("chases")} \\
\leftarrow \text{token 3 ("dog")}
\end{matrix}
$$

Nothing mysterious happens here: embedding lookup simply copies rows 1, 2, and 3 out of the vocabulary table into a $3 \times 3$ activation matrix, leaving unused vocabulary rows (0 and 4) untouched.

**Step 2: Linear projections into $Q, K, V_{\mathrm{val}}$.** Multiply $H\;(3 \times 3)$ on the right by the static transposed projection matrices $W_q^\top, W_k^\top, W_v^\top \in \mathbb{R}^{3 \times 2}$:

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

Top-left entry $Q_{1,1} = 2$, for example, is the dot product of row 1 of $H$ ($[1, 0, 1]$) with column 1 of $W_q^\top$ ($[1, 0, 1]^\top$): $1\times 1 + 0\times 0 + 1\times 1 = 2$.

Notice a key structural fact: **linear projections remix features strictly within each token's own row—the 3 tokens have not talked to one another yet**. Meanwhile, $K$ and $V_{\mathrm{val}}$ are stored in VRAM as the initial 3-row `KV Cache`.

**Step 3: Four-stage causal self-attention (dot products $\to$ mask $\to$ Softmax $\to$ weighted sum of $V$).** Now tokens interact across positions. First multiply $Q\;(3\times 2)$ by $K^\top\;(2\times 3)$ to get all pairwise dot products:

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

Divide by $\sqrt{d_k} = \sqrt{2} \approx 1.414$, add the causal mask $M_{\mathrm{causal}}$ (replacing every above-diagonal entry $i < j$ with $-\infty$), and apply row-wise Softmax $P_{i,j} = e^{S_{i,j}} / \sum_c e^{S_{i,c}}$ (since $e^{-\infty} = 0$, future weights vanish identically):

$$
S = \frac{Q K^\top}{\sqrt{2}} + M_{\mathrm{causal}} \approx
\begin{bmatrix}
2.12 & -\infty & -\infty \\
1.41 & 0.71 & -\infty \\
2.12 & 1.41 & 2.12
\end{bmatrix}
\;\xrightarrow{\text{row Softmax}}\;
P \approx
\begin{bmatrix}
1.00 & 0 & 0 \\
0.67 & 0.33 & 0 \\
0.40 & 0.20 & 0.40
\end{bmatrix}
$$

Multiplying the lower-triangular probability table $P\;(3\times 3)$ into $V_{\mathrm{val}}\;(3\times 2)$ yields:

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

Reading $P V_{\mathrm{val}}$ one row at a time strips away all abstraction:
- **Row 1 (`"cat"`)**: $1.00 \times [3, 1] + 0 + 0 = [3.00, 1.00]$, seeing only itself;
- **Row 2 (`"chases"`)**: $0.67 \times [3, 1] + 0.33 \times [1, 3] + 0 = [2.34, 1.66]$, pulling $67\%$ of `"cat"`'s value vector into `"chases"` while remaining blind to future token `"dog"`;
- **Row 3 (`"dog"`)**: $0.40 \times [3, 1] + 0.20 \times [1, 3] + 0.40 \times [2, 2] = [2.20, 1.80]$, pooling context across all 3 prefix tokens. At the end of `Prefill`, only this final row is projected through the FFN and LM head $W_{\mathrm{head}}^\top$—suppose sampling picks token `4:runs`.

**Step 4: Advancing to `Decode` step $t = 4$ (why a single row suffices).** Now we feed newly sampled `4:runs` to predict token 5.

Look back at Step 3: because the first 3 tokens cannot see token 4, rows 1..3 of $K$ and $V_{\mathrm{val}}$ never change. Step 4 **never builds a $4 \times 3$ input matrix**—it looks up only the single row $h_4 = [1, 0, -1] \in \mathbb{R}^{1 \times 3}$ and runs three tiny vector-matrix products:

$$
q_4 = h_4 W_q^\top = \begin{bmatrix} 0 & 1 \end{bmatrix}, \qquad
k_4 = h_4 W_k^\top = \begin{bmatrix} 0 & 1 \end{bmatrix}, \qquad
v_4 = h_4 W_v^\top = \begin{bmatrix} 1 & -1 \end{bmatrix}
$$

Appending $k_4, v_4$ as row 4 of the cached $3 \times 2$ tables forms $K_{1:4}, V_{1:4} \in \mathbb{R}^{4 \times 2}$, after which attention reduces to a single $1 \times 4$ dot-product strip:

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

Taking that 4-weight average of $V_{1:4}$ gives $o_4 = p_4 V_{1:4} = 0.20[3,1] + 0.20[1,3] + 0.40[2,2] + 0.20[1,-1] = [1.80, 1.40] \in \mathbb{R}^{1 \times 2}$—without ever materializing the upper 3 rows of a $4 \times 4$ attention matrix.

```sketch title="Unfolded Numeric Walkthrough: Cell-by-Cell Matrix Transformations in 3-Token Prefill and Step-4 Decode" note="Replacing abstract symbols with hand-verifiable numbers ($d_k=2$, scale $\sqrt{2}\approx 1.41$). Stage 1 shows how causal masking turns each output row into a convex combination of visible value vectors; Stage 2 shows step-4 decoding computing $o_4$ from a single query row $q_4$ and a 1-row append to the violet KV Cache."
<svg viewBox="0 0 704 494">
  <rect class="panel" x="0" y="0" width="704" height="256" rx="12"/>
  <text class="caps" x="18" y="22">STAGE 1 · PREFILL NUMERIC TRACE</text>
  <text class="small b" x="18" y="44">3-token prefix ["cat", "chases", "dog"] (highlighting Row 2 blending past &amp; masking future)</text>

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
  <text class="mid small accent" x="207" y="125">+mask</text>

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
  <text class="small b" x="30" y="223">Row 2 ("chases"): 0.67×[3, 1] ("cat") + 0.33×[1, 3] ("chases") + 0×[2, 2] ("dog" masked) = [2.34, 1.66]</text>

  <rect class="panel" x="0" y="272" width="704" height="222" rx="12"/>
  <text class="caps" x="18" y="294">STAGE 2 · DECODE STEP 4 NUMERIC TRACE</text>
  <text class="small b" x="18" y="316">Feed 1-row query q₄=[0, 1], append clay col/row 4 to KV Cache, compute 1×4 weights only</text>

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
  <text class="mid small mute" x="163.0" y="347.0">3 cached + 1 new</text>
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

  <text class="small" x="18" y="472">Weighted sum: 0.20×[3,1] + 0.20×[1,3] + 0.40×[2,2] + 0.20×[1,-1] (new row 4) = [1.80, 1.40] (rows 1..3 reused)</text>
</svg>
<svg viewBox="0 0 340 632">
  <rect class="panel" x="0" y="0" width="340" height="368" rx="12"/>
  <text class="caps" x="14" y="22">1 · PREFILL (3-TOKEN MATRICES)</text>
  <text class="small b" x="14" y="44">1. Scores &amp; causal mask: upper triangle = -∞</text>

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

  <text class="small b" x="14" y="182">2. Row softmax × V: weighted sum of visible rows</text>
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

  <text class="small" x="14" y="318">Row 2: 0.67×[3,1] + 0.33×[1,3] = [2.34, 1.66]</text>
  <text class="small mute" x="14" y="342">Row 1 weights [1,0,0] cannot peek at tokens 2..3</text>

  <rect class="panel" x="0" y="384" width="340" height="248" rx="12"/>
  <text class="caps" x="14" y="406">2 · DECODE (STEP 4 · 1 ROW + KV APPEND)</text>
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

  <text class="small" x="14" y="612">Computes 1×4 row only; clay = appended token 4</text>
</svg>
```

The two empirical figures below put concrete byte counts and operation totals on these mechanisms.

In the first chart's 6-layer `float32` model ($V=2000, D=256, L=6$, 4 bytes per parameter), static weights total $5.82 \times 10^6$ parameters ($1.04 \times 10^6$ in boundary tables and $4.72 \times 10^6$ in internal 2D matrices), taking just $22.2\;\text{MB}$.

Turn on training at $B=16, T=64$, however, and stashed forward activations across the 6 layers consume $103.8\;\text{MB}$—nearly $5\times$ the weights themselves. Meanwhile, `Muon+AdamW` drops second-moment buffers $V$ from all internal 2D layers, leaving only $4.2\;\text{MB}$ of $V$ states on the boundary parameters.

The second chart tracks cumulative MACs across a 4-layer model decoding from prefix length $T_0=8$ out to $t=120$ with and without a `KV Cache`.

```echarts title="VRAM Breakdown of a 6-Layer Transformer Across Inference and Three Training Optimizers" height="360" note="Measured tensor byte counts on a 6-layer Transformer ($V=2000, D=256$, 8 heads, fp32, batch $B=16$, length $T=64$). Training retains forward activations and allocates gradients $G$ plus state buffers; Muon+AdamW eliminates second-moment $V$ on all internal 2D layers (keeping only 4.2 MB on boundary params)."
{"tooltip":{"trigger":"axis","axisPointer":{"type":"shadow"},"valueFormatter":"{value} MB"},"legend":{},"grid":{"top":68,"left":58,"right":12,"bottom":44},"xAxis":{"type":"category","axisLabel":{"interval":0,"lineHeight":15},"data":["Decode\n(KV)","Vanilla\nSGD","AdamW","Muon+\nAdamW"]},"yAxis":{"type":"value","max":200,"interval":50,"axisLabel":{"formatter":"{value} MB"}},"series":[{"name":"Weights W","type":"bar","stack":"vram","itemStyle":{"color":"var(--blue)"},"data":[22.2,22.2,22.2,22.2]},{"name":"KV Cache","type":"bar","stack":"vram","itemStyle":{"color":"var(--sky)"},"data":[12.0,0.0,0.0,0.0]},{"name":"Gradients G","type":"bar","stack":"vram","itemStyle":{"color":"var(--orange)"},"data":[0.0,22.2,22.2,22.2]},{"name":"Momentum M","type":"bar","stack":"vram","itemStyle":{"color":"var(--violet)"},"data":[0.0,0.0,22.2,22.2]},{"name":"2nd Moment V","type":"bar","stack":"vram","itemStyle":{"color":"var(--clay)"},"data":[0.0,0.0,22.2,4.2]},{"name":"Activations","type":"bar","stack":"vram","itemStyle":{"color":"var(--teal)"},"data":[0.2,103.8,103.8,103.8]}]}
```

```plot title="Autoregressive Decoding from Prefix 8 to Length 120: KV Cache Cuts Cumulative MACs to Near-Linear" note="4-layer Transformer ($D=128, V=512$) after an 8-token Prefill ($T_0=8$), followed by 112 autoregressive Decode steps ($t=9 \dots 120$). Cumulative MACs drop from 6,758.5M to 109.7M (-98.4%)."
{"xlabel":"Sequence length $t$ (Prefill finishes at $t=8$, followed by 112 Decode steps for $t=9 \\dots 120$)","legend":[{"label":"Without KV Cache (recompute full prefix $\\mathcal{O}(t D^2 + t^2 D)$)","color":"var(--clay)","shape":"dash"},{"label":"With KV Cache (new token only $\\mathcal{O}(D^2 + t D)$)","color":"var(--teal)","shape":"line"},{"label":"98.4% redundant compute avoided","color":"var(--clay)","shape":"band"}],"data":{"kv":[{"t":8,"no_cache":6.9,"kv_cache":6.9},{"t":12,"no_cache":43.1,"kv_cache":10.3},{"t":16,"no_cache":93.4,"kv_cache":13.8},{"t":20,"no_cache":157.9,"kv_cache":17.3},{"t":24,"no_cache":236.6,"kv_cache":20.8},{"t":28,"no_cache":329.8,"kv_cache":24.3},{"t":32,"no_cache":437.6,"kv_cache":27.8},{"t":36,"no_cache":560.0,"kv_cache":31.4},{"t":40,"no_cache":697.3,"kv_cache":34.9},{"t":44,"no_cache":849.5,"kv_cache":38.5},{"t":48,"no_cache":1016.9,"kv_cache":42.1},{"t":52,"no_cache":1199.4,"kv_cache":45.7},{"t":56,"no_cache":1397.3,"kv_cache":49.4},{"t":60,"no_cache":1610.7,"kv_cache":53.0},{"t":64,"no_cache":1839.7,"kv_cache":56.7},{"t":68,"no_cache":2084.4,"kv_cache":60.4},{"t":72,"no_cache":2345.0,"kv_cache":64.1},{"t":76,"no_cache":2621.7,"kv_cache":67.8},{"t":80,"no_cache":2914.4,"kv_cache":71.5},{"t":84,"no_cache":3223.5,"kv_cache":75.2},{"t":88,"no_cache":3548.9,"kv_cache":79.0},{"t":92,"no_cache":3890.9,"kv_cache":82.8},{"t":96,"no_cache":4249.5,"kv_cache":86.6},{"t":100,"no_cache":4624.9,"kv_cache":90.4},{"t":104,"no_cache":5017.3,"kv_cache":94.2},{"t":108,"no_cache":5426.7,"kv_cache":98.1},{"t":112,"no_cache":5853.2,"kv_cache":101.9},{"t":116,"no_cache":6297.2,"kv_cache":105.8},{"t":120,"no_cache":6758.5,"kv_cache":109.7}]},"height":290,"narrowHeight":240,"y":{"label":"Cumulative MACs (millions)","domain":[0,7300]},"x":{"label":null,"domain":[8,122]},"grid":true,"marks":[{"mark":"areaY","data":"kv","x":"t","y1":"kv_cache","y2":"no_cache","fill":"var(--clay)","fillOpacity":0.12},{"mark":"ruleX","data":[8],"stroke":"var(--stone)","strokeDasharray":"4 3"},{"mark":"line","data":"kv","x":"t","y":"no_cache","stroke":"var(--clay)","strokeWidth":2.2,"strokeDasharray":"6 4"},{"mark":"line","data":"kv","x":"t","y":"kv_cache","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":"kv","x":"t","y":"no_cache","fill":"var(--clay)","r":2.5,"tip":["t","no_cache","kv_cache"]},{"mark":"text","data":[{"t":10,"y":5600,"txt":"← Prefill ends (t=8)"}],"x":"t","y":"y","text":"txt","textAnchor":"start","fill":"var(--muted)"},{"mark":"text","data":[{"t":108,"y":6650,"txt":"6,759M"}],"x":"t","y":"y","text":"txt","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"t":116,"y":520,"txt":"110M (-98.4%)"}],"x":"t","y":"y","text":"txt","textAnchor":"end","fill":"var(--teal)"}]}
```

With "optimizers only mutate Family 1 static parameters $\Theta$" established, the next question is how a single scalar loss $L$ differentiates backward into a full two-dimensional gradient matrix $G$ for every weight layer.

---

## 2. Normalization Scale Invariance and Matrix Backpropagation

Now that we know optimizers only mutate Family 1 static weights $\Theta$, let us zoom inside a single training step and work out its backward calculus.

Doing so explains why forward activations dominate training memory, while establishing two properties that drive the rest of the post: **how `RMSNorm` pins hidden-layer input RMS to $1$**, and **why linear-layer gradients $G$ form a sum of rank-one outer products**.

### 2.1 Origin of `RMSNorm` and Proof of Radial Gradient Orthogonality

Original Transformers used `LayerNorm`. Given a token vector $x \in \mathbb{R}^D$, it computes the mean $\mu = \frac{1}{D}\sum_{i=1}^D x_i$, then the centered variance $\sigma^2 = \frac{1}{D}\sum_{i=1}^D (x_i - \mu)^2$, and outputs $\frac{x - \mu}{\sqrt{\sigma^2 + \epsilon}} \odot \gamma + \beta$. On GPUs, because variance depends on the mean, every vector forces two cross-channel reductions whose memory latency outweighs arithmetic.

In 2019, Zhang and Sennrich proposed a clean subtraction: `LayerNorm` stabilizes deep networks not by subtracting the mean (shift invariance), but by dividing by vector norm (scale invariance)[@zhang2019].

Dropping mean-centering and bias $\beta$ leaves Root Mean Square Layer Normalization (`RMSNorm`):

$$
r(x) = \sqrt{\frac{1}{D} \sum_{i=1}^{D} x_i^2 + \epsilon}, \qquad y = \mathrm{RMSNorm}(x) = \frac{x}{r(x)} \odot \gamma = \hat{x} \odot \gamma
$$

where $\gamma \in \mathbb{R}^D$ is initialized to all ones. Two geometric properties follow right away.

**First, forward outputs stay at unit RMS.** As $\epsilon \to 0$ with $\gamma = \mathbf{1}$, $\hat{x} = x / r(x)$ identically satisfies $\frac{1}{D}\|\hat{x}\|_2^2 = 1$. Every linear layer $W$ immediately after `RMSNorm` therefore receives inputs of unit root-mean-square magnitude—the exact fact that selects our operator norm in Section 4.

**Second, backward gradients are radially orthogonal to $x$ and inversely damped.** At $\epsilon = 0$, for any $\alpha > 0$, $\mathrm{RMSNorm}(\alpha x) = \mathrm{RMSNorm}(x)$: purely stretching $x$ leaves the output unchanged.

What does that imply for backward gradients? Let $\delta_y = \partial L / \partial y \in \mathbb{R}^D$ be the upstream gradient and set $\tilde{\delta} = \delta_y \odot \gamma$. Using $\partial r / \partial x_j = \frac{x_j}{D r}$, differentiate with respect to $x_j$:

$$
\frac{\partial L}{\partial x_j} = \sum_{i=1}^{D} \tilde{\delta}_i \frac{\partial}{\partial x_j}\left(\frac{x_i}{r}\right) = \frac{\tilde{\delta}_j}{r} - \sum_{i=1}^{D} \tilde{\delta}_i \frac{x_i x_j}{D r^3} = \frac{1}{r}\left(\tilde{\delta}_j - \hat{x}_j \cdot \frac{1}{D}\langle \tilde{\delta}, \hat{x} \rangle\right)
$$

In vector form:

$$
\nabla_x L = \frac{1}{r(x)}\left(I_D - \frac{\hat{x} \hat{x}^\top}{D}\right) \tilde{\delta}, \qquad \nabla_\gamma L = \delta_y \odot \hat{x}
$$

Since $\frac{1}{D}\hat{x}^\top \hat{x} = 1$, left-multiplying $\nabla_x L$ by $x^\top = r(x)\hat{x}^\top$ cancels the two terms identically:

$$
x^\top \nabla_x L = \hat{x}^\top \tilde{\delta} - \frac{\hat{x}^\top \hat{x}}{D} \hat{x}^\top \tilde{\delta} = 0
$$

The inner product is zero! Every backward gradient arriving at $x$ lies strictly in the tangent hyperplane orthogonal to $x$, never pushing its radial length up or down. Better still, the prefactor $\frac{1}{r(x)}$ acts as a built-in shock absorber: if an activation norm spikes by $\alpha$, its backward gradient shrinks by $1/\alpha$, curbing norm blowups in deep residual stacks[@zhang2019].

### 2.2 Derivative of Cross-Entropy Loss with Respect to Logits

Next, step to the end of the forward pass to see where backpropagation starts.

Take a batch of $B=20$ sequences of length $T=16$, totaling $N = B \times T = 320$ prediction positions. Flatten the output logits into $Z \in \mathbb{R}^{N \times V}$, with true next-token ID $y_n \in \{0, \dots, V-1\}$ at row $n$.

Cross-entropy averages the negative log-likelihood of the true token across all $N$ rows:

$$
L = -\frac{1}{N} \sum_{n=1}^{N} \ln P_{n, y_n} = -\frac{1}{N} \sum_{n=1}^{N} \left(Z_{n, y_n} - \ln \sum_{m=0}^{V-1} e^{Z_{n, m}}\right)
$$

where $P_{n, k} = e^{Z_{n,k}} / \sum_{m=0}^{V-1} e^{Z_{n,m}}$. Notice a handy sanity check: at random initialization, logits are nearly equal so $P_{n, k} \approx 1/V$, placing step-1 loss right around $\ln V$ ($\ln 1000 \approx 6.91$, or $\ln 128 \approx 4.85$).

Now differentiate with respect to logit $Z_{n, j}$. Because row $n$'s probabilities depend only on row $n$'s logits, all terms $n' \neq n$ drop out:

$$
\frac{\partial L}{\partial Z_{n, j}} = -\frac{1}{N}\left(\frac{\partial Z_{n, y_n}}{\partial Z_{n, j}} - \frac{1}{\sum_{m=0}^{V-1} e^{Z_{n, m}}} \cdot \frac{\partial}{\partial Z_{n, j}} \sum_{m=0}^{V-1} e^{Z_{n, m}}\right) = -\frac{1}{N}\left(\mathbf{1}_{j = y_n} - \frac{e^{Z_{n, j}}}{\sum_{m=0}^{V-1} e^{Z_{n, m}}}\right)
$$

Collecting entries gives a remarkably clean starting error matrix $\Delta^{(Z)} = \partial L / \partial Z \in \mathbb{R}^{N \times V}$:

$$
\Delta_{n, j}^{(Z)} = \frac{\partial L}{\partial Z_{n, j}} = \frac{1}{N}\left(P_{n, j} - \mathbf{1}_{j = y_n}\right)
$$

Predicted probabilities minus one-hot targets, divided by $N$.

On the true column $j = y_n$, $(P_{n, y_n} - 1)/N$ is negative, telling gradient descent to lift the target logit. On every wrong column $j \neq y_n$, $+P_{n, j}/N$ is positive—the more probability mass wasted on a wrong token, the harder its score is pushed down. Every row sums identically to zero.

### 2.3 Linear-Layer Matrix Calculus and the Root Cause of Spectral Skew

With the top-level error in hand, consider any internal bias-free linear layer $Y = X W^\top$.

Merge batch and sequence into $N = B \cdot T$ rows. Inputs are $X \in \mathbb{R}^{N \times d_{\mathrm{in}}}$, weights are $W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$, outputs are $Y \in \mathbb{R}^{N \times d_{\mathrm{out}}}$, and upstream backpropagation supplies $\Delta = \partial L / \partial Y \in \mathbb{R}^{N \times d_{\mathrm{out}}}$.

Write out $Y$ in scalar form:

$$
Y_{n, i} = \sum_{k=1}^{d_{\mathrm{in}}} X_{n, k} W_{i, k}
$$

Track a single weight entry $W_{i, j}$: across every token $n = 1, \dots, N$, it appears only inside output column $i$'s $k = j$ term, with local derivative $\partial Y_{n, i} / \partial W_{i, j} = X_{n, j}$.

Summing over all $N$ token positions via the multivariable chain rule gives:

$$
G_{i, j} \triangleq \frac{\partial L}{\partial W_{i, j}} = \sum_{n=1}^{N} \sum_{p=1}^{d_{\mathrm{out}}} \frac{\partial L}{\partial Y_{n, p}} \frac{\partial Y_{n, p}}{\partial W_{i, j}} = \sum_{n=1}^{N} \Delta_{n, i} X_{n, j} = \sum_{n=1}^{N} (\Delta^\top)_{i, n} X_{n, j}
$$

Look at the right-hand side: that is entry $(i, j)$ of $\Delta^\top\;(d_{\mathrm{out}} \times N)$ multiplied by $X\;(N \times d_{\mathrm{in}})$!

Differentiating with respect to $X_{n, j}$ works the same way: because $X_{n, j}$ feeds all $d_{\mathrm{out}}$ output channels of row $n$, summing over $i$ yields $(\Delta W)_{n, j}$. Side by side, the two backward contractions are:

$$
G = \frac{\partial L}{\partial W} = \Delta^\top X = \sum_{n=1}^{N} \delta_n x_n^\top \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}, \qquad \frac{\partial L}{\partial X} = \Delta W \in \mathbb{R}^{N \times d_{\mathrm{in}}}
$$

where $\delta_n \in \mathbb{R}^{d_{\mathrm{out}}}$ and $x_n \in \mathbb{R}^{d_{\mathrm{in}}}$ are column vectors for token $n$'s upstream error and layer input.

```sketch title="Full-Flow LLM Training Matrix Shapes: Tracking Cached Activations, Transpose Contraction & Dual Optimizers" note="Batch tokens $N = B \times T = 5$ (clay rows), input dim $d_{\mathrm{in}}=4$ (blue cols), output dim $d_{\mathrm{out}}=3$ (violet cols). Stage 2 right shows how the $5$ horizontal columns of $\Delta_Y^\top$ pair with and cancel the $5$ vertical rows of cached $X$, leaving a $12$-cell gradient $G\;[3\times 4]$ identical in shape to $W$."
<svg viewBox="0 0 704 684">
  <rect class="panel" x="0" y="0" width="704" height="196" rx="12"/>
  <text class="caps" x="18" y="22">STAGE 1 · FORWARD &amp; LOSS</text>
  <text class="small b" x="218" y="22">Parallel forward &amp; all-token loss (batch tokens N=5, in=4, out=3, vocab V=6)</text>

  <g>
    <line x1="56" y1="68" x2="56" y2="135" stroke="var(--clay)" stroke-width="2"/>
    <line x1="53" y1="68" x2="59" y2="68" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="53" y1="135" x2="59" y2="135" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="51" y="101.5">N=5</tex>
    <line x1="62" y1="62" x2="115" y2="62" stroke="var(--blue)" stroke-width="2"/>
    <line x1="62" y1="59" x2="62" y2="65" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="115" y1="59" x2="115" y2="65" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="mid small blue" x="88.5" y="51">d_{{\mathrm{{in}}}}=4</tex>
    <path d="M64 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM78 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM92 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM106 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM64 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM78 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM92 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM106 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM64 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM78 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM92 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM106 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM64 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM78 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM92 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM106 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM64 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM78 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM92 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM106 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <tex class="mid small" x="88.5" y="151">X\;(5\!\times\!4)</tex>
  </g>
  <rect class="window" x="8" y="44" width="116" height="118" rx="6"/>
  <text class="mid small accent" x="66" y="176">Cached for Stage 3</text>

  <tex class="mid b" x="140" y="102">\times</tex>
  <g>
    <line x1="168" y1="75" x2="168" y2="128" stroke="var(--blue)" stroke-width="2"/>
    <line x1="165" y1="75" x2="171" y2="75" stroke="var(--blue)" stroke-width="1.5"/>
    <line x1="165" y1="128" x2="171" y2="128" stroke="var(--blue)" stroke-width="1.5"/>
    <tex class="end small blue" x="163" y="101.5">4</tex>
    <line x1="174" y1="69" x2="213" y2="69" stroke="var(--violet)" stroke-width="2"/>
    <line x1="174" y1="66" x2="174" y2="72" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="213" y1="66" x2="213" y2="72" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="mid small violet" x="193.5" y="58">d_{{\mathrm{{out}}}}=3</tex>
    <path d="M176 75h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM190 75h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM204 75h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM176 89h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM190 89h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM204 89h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM176 103h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM190 103h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM204 103h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM176 117h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM190 117h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM204 117h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--blue-wash)" stroke="var(--blue)" stroke-width="1.15"/>
    <tex class="mid small" x="193.5" y="150">W^\top\;(4\!\times\!3)</tex>
  </g>
  <path d="M88.5 60.0 Q131.2 52.0 166.0 101.5" fill="none" stroke="var(--blue)" stroke-width="1.25" stroke-dasharray="3 2"/>
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
  <text class="mid small" x="329" y="89">to LM</text>
  <text class="mid small" x="329" y="118">head</text>

  <g>
    <line x1="378" y1="68" x2="378" y2="135" stroke="var(--clay)" stroke-width="2"/>
    <line x1="375" y1="68" x2="381" y2="68" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="375" y1="135" x2="381" y2="135" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="end small clay" x="373" y="101.5">5</tex>
    <line x1="384" y1="62" x2="465" y2="62" stroke="var(--orange)" stroke-width="2"/>
    <line x1="384" y1="59" x2="384" y2="65" stroke="var(--orange)" stroke-width="1.5"/>
    <line x1="465" y1="59" x2="465" y2="65" stroke="var(--orange)" stroke-width="1.5"/>
    <text class="mid small b" x="424.5" y="51" fill="var(--orange-ink)">V=6 vocab</text>
    <path d="M386 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 68h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM386 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 82h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM386 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 96h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM386 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 110h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM386 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM400 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM414 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM428 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM442 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2zM456 124h7q2 0 2 2v7q0 2-2 2h-7q-2 0-2-2v-7q0-2 2-2z" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.15"/>
    <rect x="412" y="68" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <rect x="454" y="82" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <rect x="398" y="96" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <rect x="440" y="110" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <rect x="384" y="124" width="11" height="11" rx="2" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.5"/>
    <tex class="mid small" x="424.5" y="151">Z\;(5\!\times\!6)</tex>
  </g>
  <path class="edge" d="M475 102 H533" marker-end="url(#arrow)"/>
  <text class="mid small" x="504" y="88">5-row</text>
  <text class="mid small mute" x="504" y="118">mean CE</text>

  <g>
    <rect x="554" y="88" width="24" height="24" rx="4" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.6"/>
    <tex class="mid small b" x="566" y="100">L</tex>
    <text class="small b" x="588" y="96">Scalar (1×1)</text>
    <text class="small mute" x="588" y="114">Backward root</text>
  </g>

  <rect class="panel" x="0" y="212" width="704" height="246" rx="12"/>
  <text class="caps" x="18" y="234">STAGE 2 &amp; 3 · BACKWARD</text>
  <text class="small b" x="196" y="234">Upstream grad [5×3] splits: left propagates error; right transposes to cancel N=5</text>

  <text class="small b" x="20" y="260">Left branch (to lower layer): inner 3 cancels, keeps N=5</text>
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
  <text class="small mute" x="20" y="438">Forward multiplies by Wᵀ [4×3]; backward by W [3×4]</text>

  <line x1="322" y1="250" x2="322" y2="444" stroke="var(--line)" stroke-dasharray="4 3"/>

  <text class="small b" x="340" y="260">Right branch (weight grad): token axis N=5 sums out</text>
  <g>
    <line x1="362" y1="312" x2="362" y2="351" stroke="var(--violet)" stroke-width="2"/>
    <line x1="359" y1="312" x2="365" y2="312" stroke="var(--violet)" stroke-width="1.5"/>
    <line x1="359" y1="351" x2="365" y2="351" stroke="var(--violet)" stroke-width="1.5"/>
    <tex class="end small violet" x="357" y="331.5">3</tex>
    <line x1="368" y1="306" x2="435" y2="306" stroke="var(--clay)" stroke-width="2"/>
    <line x1="368" y1="303" x2="368" y2="309" stroke="var(--clay)" stroke-width="1.5"/>
    <line x1="435" y1="303" x2="435" y2="309" stroke="var(--clay)" stroke-width="1.5"/>
    <text class="mid small b" x="401.5" y="295" fill="var(--clay-ink)">N=5 cols</text>
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
  <text class="small accent" x="340" y="438">N=5 cancels out: G [3×4] matches W [3×4] cell for cell</text>

  <rect class="panel" x="0" y="474" width="704" height="210" rx="12"/>
  <text class="caps" x="18" y="496">STAGE 4 · OPTIMIZER STEP</text>
  <text class="small b" x="210" y="496">Given the 12-cell gradient G [3×4]: entrywise AdamW vs matrix-spectral Muon</text>

  <text class="small b" x="20" y="522">A · Entrywise AdamW: scales all 12 cells independently</text>
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
  <text class="small mute" x="20" y="622">Cells never see each other (ideal for embeddings &amp; head)</text>
  <text class="small mute" x="20" y="642">Stores two 12-cell state buffers: M and V</text>

  <line x1="346" y1="510" x2="346" y2="664" stroke="var(--line)" stroke-dasharray="4 3"/>

  <text class="small b" x="364" y="522">B · Matrix-Spectral Muon: drops V, orthogonalizes [3×4]</text>
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
  <text class="small accent" x="364" y="622">Flattens full singular spectrum (for internal 2D layers)</text>
  <text class="small" x="364" y="642">No second-moment V [3×4] needed (50% less state VRAM)</text>
</svg>
<svg viewBox="0 0 340 660">
  <rect class="panel" x="0" y="0" width="340" height="190" rx="12"/>
  <text class="caps" x="16" y="22">1 · FORWARD (N=5 PARALLEL &amp; CACHED)</text>
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
  <text class="small" x="16" y="168">X [5×4] stays in VRAM to compute G in backward pass</text>

  <rect class="panel" x="0" y="206" width="340" height="236" rx="12"/>
  <text class="caps" x="16" y="228">2 · BACKWARD (TRANSPOSE CANCELS N=5)</text>
  <text class="small b" x="16" y="252">Weight grad: 5 cols of ΔYᵀ pair with 5 rows of X</text>
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
  <text class="small accent" x="16" y="394">N=5 sums out: G [3×4] matches W [3×4] cell for cell</text>
  <text class="small mute" x="16" y="418">Left branch [5×3]×[3×4] = [5×4] flows to earlier layers</text>

  <rect class="panel" x="0" y="458" width="340" height="202" rx="12"/>
  <text class="caps" x="16" y="480">3 · OPTIMIZER (CELLWISE VS WHOLE-MATRIX)</text>
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
  <text class="small b" x="16" y="566">Muon: orthogonalizes [3×4] as one operator, drops V</text>
  <text class="small" x="16" y="592">AdamW: stores V [3×4], scales 12 cells independently</text>
  <text class="small mute" x="16" y="618">2D hidden layers → Muon; embeddings &amp; head → AdamW</text>
</svg>
```

Those two compact formulas unlock four central facts of LLM engineering and optimization:

1. **Why $G$ always matches the shape of $W$**. The batch-and-token count $N$ is the shared inner axis contracted out in $\Delta^\top X$, leaving $(d_{\mathrm{out}}, d_{\mathrm{in}})$ no matter what $B$ or $T$ you choose.
2. **Why training VRAM dwarfs inference VRAM**. Computing $\Delta^\top X$ explicitly multiplies against the forward activation $X$. If you freed $X$ during the forward pass, you could not form $G$.

   Attention is no different: $\Delta_V = P^\top \Delta_O$, $\Delta_Q = \frac{1}{\sqrt{d_k}}\Delta_S K$, and $\Delta_K = \frac{1}{\sqrt{d_k}}\Delta_S^\top Q$ all read forward $Q, K, V_{\mathrm{val}}, P$. FlashAttention avoids storing the $T \times T$ matrix $P$ in HBM by recomputing tiles in SRAM, yet $Q, K, V_{\mathrm{val}}$ and layer inputs must still stay resident (unless activation checkpointing trades extra forward compute for memory).
3. **Why `zero_grad()` is required every step**. When full batches exceed VRAM, training splits a step into micro-batches and calls `loss.backward()` repeatedly, accumulating (`+=`) each $\Delta^\top X$ into `W.grad` before stepping once. Because PyTorch accumulates by default, single-batch steps must clear stale gradients explicitly.
4. **Why neural gradient matrices have heavily skewed singular spectra**. Look at the outer-product sum $G = \sum_{n=1}^N \delta_n x_n^\top$. Natural language tokens follow a heavy-tailed Zipf distribution: frequent function words and shared syntax recur in every batch, packing the energy of $\frac{1}{N}X^\top X$ into a few dominant directions.

   Stacked together, $G$ becomes sharply anisotropic. Its top few singular values tower orders of magnitude above the dozens or hundreds of tail singular directions carrying rare knowledge and fine-grained circuits.

### 2.4 Unfolding Backpropagation: Hand-Tracing 2-Token Cross-Entropy and Outer-Product Gradients

Let us plug small numbers into Sections 2.2 and 2.3 as well, watching a scalar loss $L$ unfold back into a 2D weight gradient $G$—and seeing a $67\times$ singular-value gap appear before our eyes.

**Step 1: From logits $Z$ to top-level gradient $\Delta^{(Z)}$.** Take $N = 2$ positions over a 3-token vocabulary $V = 3$, with true target IDs $y_1 = 0$ and $y_2 = 1$ ($Y_{\mathrm{true}} = \begin{bsmallmatrix} 1 & 0 & 0 \\ 0 & 1 & 0 \end{bsmallmatrix}$). Suppose forward logits $Z \in \mathbb{R}^{2 \times 3}$ are:

$$
Z = \begin{bmatrix} 2.0 & 1.0 & 0.0 \\ 0.0 & 2.0 & 1.0 \end{bmatrix}
\;\xrightarrow{\text{row Softmax}}\;
P \approx \begin{bmatrix} 0.67 & 0.24 & 0.09 \\ 0.09 & 0.67 & 0.24 \end{bmatrix}
$$

Mean cross-entropy is a single scalar: $L = -\frac{1}{2}(\ln 0.67 + \ln 0.67) \approx 0.40$. Plugging into $\Delta^{(Z)} = \frac{1}{N}(P - Y_{\mathrm{true}})$ with $N = 2$:

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

The signs read cleanly: target cells get $-0.17$ so $Z - \eta \Delta^{(Z)}$ boosts true tokens, while wrong candidates get $+0.12$ or $+0.05$ in proportion to how badly the model over-scored them.

**Step 2: Two-way backward split inside $Y = X W^\top$.** Zoom into an internal layer mapping $d_{\mathrm{in}} = 3 \to d_{\mathrm{out}} = 2$, with stashed forward input $X \in \mathbb{R}^{2 \times 3}$ and weights $W \in \mathbb{R}^{2 \times 3}$:

$$
X = \begin{bmatrix} 1 & 2 & 0 \\ 1 & 2 & 1 \end{bmatrix}, \qquad
W = \begin{bmatrix} 1.0 & 0.5 & -1.0 \\ -0.5 & 1.0 & 1.0 \end{bmatrix}, \qquad
Y = X W^\top =
\begin{bmatrix} 1 & 2 & 0 \\ 1 & 2 & 1 \end{bmatrix}
\begin{bmatrix} 1.0 & -0.5 \\ 0.5 & 1.0 \\ -1.0 & 1.0 \end{bmatrix}
= \begin{bmatrix} 2.0 & 1.5 \\ 1.0 & 2.5 \end{bmatrix}
$$

Suppose upstream backpropagation passes down $\Delta_Y = \begin{bsmallmatrix} -0.6 & 0.2 \\ -0.4 & 0.2 \end{bsmallmatrix} \in \mathbb{R}^{2 \times 2}$. Backprop splits into two branches:

1. **Left branch to earlier activations $X$**. Multiply by untransposed $W$, contracting out $d_{\mathrm{out}} = 2$ to restore a $2 \times 3$ gradient matching $X$:

$$
\Delta_X = \Delta_Y W =
\begin{bmatrix} -0.6 & 0.2 \\ -0.4 & 0.2 \end{bmatrix}
\begin{bmatrix} 1.0 & 0.5 & -1.0 \\ -0.5 & 1.0 & 1.0 \end{bmatrix}
=
\begin{bmatrix} -0.7 & -0.1 & 0.8 \\ -0.5 & 0.0 & 0.6 \end{bmatrix} \in \mathbb{R}^{2 \times 3}
$$

2. **Right branch to this layer's weight gradient $G$**. Transpose $\Delta_Y$ and multiply into stashed $X$. Splitting across tokens $n = 1, 2$ exposes the two rank-one outer products $\delta_1 x_1^\top + \delta_2 x_2^\top$:

$$
G = \Delta_Y^\top X =
\begin{bmatrix} -0.6 & -0.4 \\ 0.2 & 0.2 \end{bmatrix}
\begin{bmatrix} 1 & 2 & 0 \\ 1 & 2 & 1 \end{bmatrix}
=
\underbrace{\begin{bmatrix} -0.6 \\ 0.2 \end{bmatrix} \begin{bmatrix} 1 & 2 & 0 \end{bmatrix}}_{\text{token 1 outer }\delta_1 x_1^\top}
+
\underbrace{\begin{bmatrix} -0.4 \\ 0.2 \end{bmatrix} \begin{bmatrix} 1 & 2 & 1 \end{bmatrix}}_{\text{token 2 outer }\delta_2 x_2^\top}
=
\begin{bmatrix} -0.6 & -1.2 & 0.0 \\ 0.2 & 0.4 & 0.0 \end{bmatrix}
+
\begin{bmatrix} -0.4 & -0.8 & -0.4 \\ 0.2 & 0.4 & 0.2 \end{bmatrix}
=
\begin{bmatrix} -1.0 & -2.0 & -0.4 \\ 0.4 & 0.8 & 0.2 \end{bmatrix}
$$

Look closely at $G = \begin{bsmallmatrix} -1.0 & -2.0 & -0.4 \\ 0.4 & 0.8 & 0.2 \end{bsmallmatrix}$.

Because both tokens shared the frequent features $[1, 2]$ in the first two columns, row 1 is $-2.5\times$ row 2 there. Only column 3 ($-0.4$ vs. $0.2$, coming from token 2's unique 3rd feature `1`) breaks exact collinearity.

Taking the square roots of the eigenvalues of $G G^\top = \begin{bsmallmatrix} 5.16 & -2.08 \\ -2.08 & 0.84 \end{bsmallmatrix}$ reveals the two singular values:

$$
\sigma_1(G) \approx 2.449, \qquad \sigma_2(G) \approx 0.037 \qquad (\sigma_1 / \sigma_2 \approx 67.1)
$$

Even across two tokens, shared input directions open a **$67\times$ singular-value gap**—the exact bottleneck Section 4 will solve.

```sketch title="Unfolded Numeric Walkthrough: 2-Token Cross-Entropy Gradient and Rank-One Outer-Product Weight Gradient" note="Step 1 shows $\Delta^{(Z)} = (P - Y_{\mathrm{true}})/N$ assigning negative entries to ground-truth columns and positive entries elsewhere; Step 2 unfolds $G = \Delta_Y^\top X$ as the cellwise sum of token rank-1 matrices $\delta_1 x_1^\top + \delta_2 x_2^\top$, revealing how shared features create a 67× singular-value skew."
<svg viewBox="0 0 704 432">
  <rect class="panel" x="0" y="0" width="704" height="194" rx="12"/>
  <text class="caps" x="18" y="22">STEP 1 · CROSS-ENTROPY GRADIENT UNFOLDED</text>
  <text class="small b" x="18" y="44">Teal = true target cols (neg grad → raises logit); orange = wrong cols (pos grad → lowers logit)</text>

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
  <text class="caps" x="18" y="232">STEP 2 · LINEAR WEIGHT GRADIENT: TRANSPOSE MATMUL = SUM OF OUTER PRODUCTS</text>
  <text class="small b" x="18" y="254">Token axis N=2 contracts out; because both tokens share [1, 2] in cols 1..2, G has a 67× singular-value skew (2.45 vs 0.037)</text>

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
  <text class="mid small mute" x="299.0" y="283.0">token 1 outer</text>
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
  <text class="mid small mute" x="449.0" y="283.0">token 2 outer</text>
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

  <text class="small accent" x="18" y="406">Only col 3 (clay -0.4, 0.2) breaks row collinearity → dominant σ₁=2.45 vs tiny σ₂=0.037</text>
</svg>
<svg viewBox="0 0 340 578">
  <rect class="panel" x="0" y="0" width="340" height="232" rx="12"/>
  <text class="caps" x="14" y="22">1 · CROSS-ENTROPY GRADIENT</text>
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
  <text class="small" x="176" y="140">True col = -0.17</text>
  <text class="small mute" x="176" y="160">Wrong cols &gt; 0</text>
  <text class="small b" x="14" y="212">Subtracting ηΔ raises true-token logits</text>

  <rect class="panel" x="0" y="248" width="340" height="330" rx="12"/>
  <text class="caps" x="14" y="270">2 · WEIGHT GRAD = TOKEN OUTER SUM</text>
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
  <text class="small mute" x="14" y="556">Shared prefix features naturally skew singular values</text>
</svg>
```

Once $G$ is computed, how should `optimizer.step()` update the weights? We begin with flat vectors and derive four generations of entrywise optimizers.

---

## 3. Proximal Steepest Descent and Four Generations of Entrywise Optimizers

To compare `SGD`, `Momentum`, `Adam`, `AdamW`, and eventually `Muon` under one roof, we start from **proximal steepest descent**.

Let $\theta_{t-1} \in \mathbb{R}^p$ be the parameter vector after step $t-1$, and let $g_t = \nabla L_t(\theta_{t-1}) \in \mathbb{R}^p$ be the mini-batch gradient. Linearizing the loss around $\theta_{t-1}$ gives $L_t(\theta) \approx L_t(\theta_{t-1}) + \langle g_t, \theta - \theta_{t-1} \rangle$.

Because a linear approximation holds only locally—minimizing a bare linear function over $\mathbb{R}^p$ would run off to $-\infty$—we add a quadratic proximal penalty to restrain step size:

$$
\theta_t = \mathrm{arg}\min_{\theta \in \mathbb{R}^p} \left\{ \langle g_t, \theta - \theta_{t-1} \rangle + \frac{1}{2\eta} \|\theta - \theta_{t-1}\|_2^2 \right\}
$$

with learning rate $\eta > 0$. Setting the gradient with respect to $\theta$ to zero yields:

$$
g_t + \frac{1}{\eta}(\theta_t - \theta_{t-1}) = 0 \quad \Longrightarrow \quad \theta_t = \theta_{t-1} - \eta g_t
$$

This is classical **Stochastic Gradient Descent (SGD)**[@robbins1951].

Notice the hidden assumption inside that one-line proof: saying "$-\eta g_t$ is steepest descent" **is true only when you measure step length with the isotropic Euclidean norm $\|\cdot\|_2$**. Whenever curvature differs wildly across directions, Euclidean distance becomes the wrong local ruler.

### 3.1 Generation 1: `SGD` Bottlenecks Under Ill-Conditioned Curvature

Take a simple 2D anisotropic canyon:

$$
L(\theta_1, \theta_2) = \frac{1}{2}\lambda_1 \theta_1^2 + \frac{1}{2}\lambda_2 \theta_2^2, \qquad 0 < \lambda_1 \ll \lambda_2
$$

Its gradient is $(\lambda_1 \theta_1, \lambda_2 \theta_2)^\top$, its minimum sits at $(0, 0)$, and its **condition number** is $\kappa \triangleq \lambda_2 / \lambda_1 \gg 1$.

Under vanilla gradient descent, each coordinate evolves as an independent geometric series:

$$
\theta_{t, 1} = (1 - \eta \lambda_1)^t \theta_{0, 1}, \qquad \theta_{t, 2} = (1 - \eta \lambda_2)^t \theta_{0, 2}
$$

To keep the steep coordinate $\theta_2$ from diverging, we need $|1 - \eta \lambda_2| < 1$, locking a ceiling onto the learning rate:

$$
0 < \eta < \frac{2}{\lambda_2}
$$

Whenever $\frac{1}{\lambda_2} < \eta < \frac{2}{\lambda_2}$, the ratio $1 - \eta \lambda_2$ is negative, so $\theta_{t, 2}$ flips sign every step and zigzags violently across the canyon walls.

Meanwhile, the flat valley floor $\theta_1$ pays the price. Because $\eta$ is capped below $2/\lambda_2$, per-step contraction along $\theta_1$ cannot beat:

$$
1 - \eta \lambda_1 > 1 - \frac{2\lambda_1}{\lambda_2} = 1 - \frac{2}{\kappa}
$$

Using $\ln(1 - u) \approx -u$, shrinking $\theta_1$'s error by $\varepsilon$ takes $t \ge \frac{\kappa}{2}\ln(1/\varepsilon)$ steps. In deep networks where $\kappa \sim 10^4$–$10^6$, vanilla `SGD` crawls along flat valleys.

### 3.2 Generation 2: Polyak Heavy-Ball Momentum and Nesterov Lookahead Reformulation

How do we damp wall-to-wall oscillations while speeding up steady progress down the valley?

In 1964, Boris Polyak modeled a damped heavy ball rolling down a potential surface, accumulating an exponential moving average (EMA) of historical gradients[@polyak1964]:

$$
m_t = \beta_1 m_{t-1} + (1 - \beta_1) g_t, \qquad \theta_t = \theta_{t-1} - \eta m_t
$$

(Code often drops $(1 - \beta_1)$ as $u_t = \mu u_{t-1} + g_t$, folding the constant $1/(1-\mu)$ into $\eta$.) Checking two extreme gradient sequences shows why EMA works:

- **Steady valley direction** ($g_\tau = g$ every step). For large $t$, $m_t = (1 - \beta_1)\sum_{k=0}^\infty \beta_1^k g = g$, preserving full forward thrust (or amplifying step size $10\times$ at $\mu = 0.9$ in the unscaled convention).
- **Alternating wall direction** ($g_\tau = (-1)^\tau g$ every step). Opposite signs cancel inside the geometric series, leaving steady-state amplitude:

$$
|m_t| = (1 - \beta_1) |g| \left|\sum_{k=0}^{\infty} (-\beta_1)^k\right| = \frac{1 - \beta_1}{1 + \beta_1} |g|
$$

At $\beta_1 = 0.9$, $\frac{1 - 0.9}{1 + 0.9} \approx 0.0526$—nearly $95\%$ of cross-wall oscillation is damped away! On convex quadratics, optimal momentum cuts complexity from $\mathcal{O}(\kappa)$ down to $\mathcal{O}(\sqrt{\kappa})$.

In 1983, Yurii Nesterov added a crisp lookahead insight[@nesterov1983]: since inertia is about to carry us to $x_{t-1} + \mu v_{t-1}$ anyway, why evaluate the gradient at the old point $x_{t-1}$? **Slide to the lookahead point first, and evaluate the gradient there**:

$$
v_t = \mu v_{t-1} - \eta \nabla L(x_{t-1} + \mu v_{t-1}), \qquad x_t = x_{t-1} + v_t
$$

At first glance, $\nabla L(x_{t-1} + \mu v_{t-1})$ looks like it needs an extra forward/backward pass.

A simple change of variables avoids any extra pass. Both PyTorch's `SGD(..., nesterov=True)` and `Muon` store the lookahead point itself as the model parameter $\theta_{t-1} \triangleq x_{t-1} + \mu v_{t-1}$, so ordinary backprop directly hands back $g_t = \nabla L(\theta_{t-1})$.

Setting $M_t \triangleq -v_t / \eta$ ($v_t = -\eta M_t$ and $M_t = \mu M_{t-1} + g_t$), rewrite $\theta_t$ in terms of $\theta_{t-1}$:

$$
\begin{aligned}
\theta_t &= x_t + \mu v_t = (x_{t-1} + v_t) + \mu v_t \\
&= (x_{t-1} + \mu v_{t-1}) - \mu v_{t-1} + (1 + \mu) v_t \\
&= \theta_{t-1} + \eta \mu M_{t-1} - \eta (1 + \mu)(\mu M_{t-1} + g_t) \\
&= \theta_{t-1} - \eta \bigl(g_t + \mu (\mu M_{t-1} + g_t)\bigr) = \theta_{t-1} - \eta (g_t + \mu M_t)
\end{aligned}
$$

Defining $\tilde{M}_t \triangleq g_t + \mu M_t$ recovers the exact two-line recurrence `M = mu * M + G; tilde_M = G + mu * M` inside `Muon` in Section 7.

Compared with heavy-ball momentum $M_t = g_t + \mu M_{t-1}$, Nesterov lookahead $\tilde{M}_t = (1 + \mu)g_t + \mu^2 M_{t-1}$ boosts the weight on the fresh gradient $g_t$ by $(1 + \mu)$, braking earlier into bends.

### 3.3 Generation 3: Adaptive Preconditioning and Adam's Bias Correction

Momentum tames curvature within a layer, yet deep Transformers also suffer huge gradient scale gaps across layers and token frequencies: a rare token row may see gradients of $10^{-5}$ while an attention weight sees $10^1$.

Go back to our proximal objective and replace Euclidean distance $\|\theta - \theta_{t-1}\|_2^2$ with a diagonal Riemannian metric $(\theta - \theta_{t-1})^\top D_t (\theta - \theta_{t-1})$ for $D_t = \mathrm{diag}(d_{t,1}, \dots, d_{t,p}) \succ 0$:

$$
\theta_t = \mathrm{arg}\min_{\theta \in \mathbb{R}^p} \left\{ \langle g_t, \theta - \theta_{t-1} \rangle + \frac{1}{2\eta} (\theta - \theta_{t-1})^\top D_t (\theta - \theta_{t-1}) \right\} \quad \Longrightarrow \quad \theta_t = \theta_{t-1} - \eta D_t^{-1} g_t
$$

Each coordinate now gets its own step-size scale. Three milestones built $D_t$ step by step:

- **AdaGrad (2011)[@duchi2011]**. Sum all past squared gradients $G_{\mathrm{sum}, t} = \sum_{\tau=1}^t g_\tau \odot g_\tau$ and set $D_t = \mathrm{diag}\!\left(\sqrt{G_{\mathrm{sum}, t}} + \epsilon\right)$. Great for sparse convex online learning, its monotonically growing denominator eventually freezes learning rates on long non-convex runs.
- **RMSProp (2012)**. Replace infinite summation with a leaky EMA over a window of $\approx \frac{1}{1-\beta_2}$ steps: $v_t = \beta_2 v_{t-1} + (1 - \beta_2) (g_t \odot g_t)$, dividing by $\sqrt{v_t} + \epsilon$.
- **Adam (2015)[@kingma2015]**. Pair first-moment momentum $m_t$ in the numerator with second-moment $v_t$ in the denominator, starting from $m_0 = 0, v_0 = 0$:

$$
m_t = \beta_1 m_{t-1} + (1 - \beta_1) g_t, \qquad v_t = \beta_2 v_{t-1} + (1 - \beta_2) g_t^2
$$

(Here $g_t^2$ means elementwise $g_t \odot g_t$.)

**Why does `Adam` need cold-start bias correction?**

Unroll $v_t$ back to step $1$:

$$
v_t = (1 - \beta_2) \sum_{i=1}^{t} \beta_2^{t-i} g_i^2
$$

Take expectations on both sides. Writing $\sigma_{g,t}^2 \triangleq \mathbb{E}[g_t^2]$ (with non-stationary remainder $\zeta$), the finite geometric sum $\sum_{k=0}^{t-1} \beta_2^k = \frac{1 - \beta_2^t}{1 - \beta_2}$ gives:

$$
\mathbb{E}[v_t] = (1 - \beta_2) \sum_{i=1}^{t} \beta_2^{t-i} \mathbb{E}[g_i^2] = \sigma_{g,t}^2 (1 - \beta_2) \frac{1 - \beta_2^t}{1 - \beta_2} + \zeta = \sigma_{g,t}^2 (1 - \beta_2^t) + \zeta
$$

And similarly $\mathbb{E}[m_t] = \mathbb{E}[g_t](1 - \beta_1^t) + \zeta'$. Because zero initial states $m_0 = 0, v_0 = 0$ hold the leftover weights $\beta_1^t$ and $\beta_2^t$, both raw averages are biased toward zero early on.

Check what happens at step $t = 1$ without correction under standard $\beta_1 = 0.9, \beta_2 = 0.999$:

$$
\frac{|m_1|}{\sqrt{v_1}} = \frac{(1 - \beta_1)|g_1|}{\sqrt{(1 - \beta_2) g_1^2}} = \frac{1 - 0.9}{\sqrt{1 - 0.999}} = \frac{0.1}{\sqrt{0.001}} \approx 3.162
$$

Because $\beta_2$ sits much closer to $1$ than $\beta_1$, the denominator shrinks toward zero far harder than the numerator! Step 1 overshoots by **$3.16\times$** (or $10\times$ at $\beta_2 = 0.9999$), risking immediate instability.

Dividing each EMA by its accumulated weight $(1 - \beta_1^t)$ and $(1 - \beta_2^t)$ removes that bias cleanly:

$$
\hat{m}_t = \frac{m_t}{1 - \beta_1^t}, \qquad \hat{v}_t = \frac{v_t}{1 - \beta_2^t}, \qquad \theta_t = \theta_{t-1} - \eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}
$$

Now $|\hat{m}_1| / \sqrt{\hat{v}_1} = 1$ at step $1$, and both correction factors fade to $1$ as $t \to \infty$.

Statistically, $\hat{m}_t / \sqrt{\hat{v}_t}$ is a per-coordinate **empirical signal-to-noise ratio (SNR)**. Steady gradients saturate near $\pm 1$; near a minimum where $\mathbb{E}[g_t] \to 0$, mini-batch noise keeps $\hat{v}_t > 0$ while sign cancellation drives $\hat{m}_t \to 0$, automatically annealing steps[@kingma2015].

### 3.4 Generation 4: Non-Equivalence of $L_2$ Regularization and Decoupled Weight Decay (`AdamW`)

Left unchecked, minimizing cross-entropy on finite data pushes redundant weights to large norms, over-sharpening logits and hurting generalization.

From a Bayesian MAP view, placing an isotropic Gaussian prior $p(\theta) \propto \exp\!\left(-\frac{\lambda}{2}\|\theta\|_2^2\right)$ on the weights adds a quadratic **$L_2$ penalty** to the loss:

$$
L_{\mathrm{reg}}(\theta) = L(\theta) + \frac{\lambda}{2}\|\theta\|_2^2 \quad \Longrightarrow \quad \nabla L_{\mathrm{reg}}(\theta) = \nabla L(\theta) + \lambda \theta
$$

Separately, Hanson and Pratt (1988) defined **weight decay** as directly shrinking weights each step via $(1 - w)\theta_{t-1}$.

In vanilla `SGD`, substituting $\nabla L_{\mathrm{reg}}$ gives:

$$
\theta_t = \theta_{t-1} - \eta (g_t + \lambda \theta_{t-1}) = (1 - \eta \lambda)\theta_{t-1} - \eta g_t
$$

With $w = \eta \lambda$, the two are identical! Lulled by that coincidence, deep learning frameworks implemented `weight_decay` by adding `wd * theta` onto `g_t`.

Yet once practitioners switched to `Adam`, models trained with `Adam` + $L_2$ regularization consistently generalized worse than `SGD + Momentum`.

In 2019, Loshchilov and Hutter proved why[@loshchilov2019].

Take any preconditioned optimizer with positive-definite preconditioner $P_t \succ 0$ and true decoupled decay $w$:

$$
\theta_t = (1 - w)\theta_{t-1} - \eta P_t^{-1} \nabla L(\theta_{t-1})
$$

Ask: does there exist *any* fixed regularizer $R(\theta)$ such that optimizing $\tilde{L}(\theta) = L(\theta) + R(\theta)$ without decoupled decay produces the same step?

When $P_t$ changes over time, no time-independent $R(\theta)$ can match it at all. Even if $P_t = P$ is held constant, equating the two updates requires:

$$
\theta_{t-1} - \eta P^{-1}\bigl(\nabla L(\theta_{t-1}) + \nabla R(\theta_{t-1})\bigr) = (1 - w)\theta_{t-1} - \eta P^{-1} \nabla L(\theta_{t-1})
$$

Canceling shared terms and left-multiplying by $P$ exposes the hidden regularizer:

$$
\nabla R(\theta_{t-1}) = \frac{w}{\eta} P \theta_{t-1} \quad \Longleftrightarrow \quad R(\theta) = \frac{w}{2\eta} \theta^\top P \theta
$$

Two sharp conclusions jump out:

1. **Equivalence holds almost nowhere**. Isotropic $L_2$ penalty $\frac{\lambda}{2}\|\theta\|_2^2$ equals weight decay **if and only if $P_t = c I$** (`SGD`).
2. **Coupled $L_2$ inside `Adam` penalizes the wrong weights**. In `Adam`, $P_t = \mathrm{diag}\!\left(\sqrt{\hat{v}_t} + \epsilon\right)$ differs per coordinate. Adding $\lambda \theta_{t-1}$ into $g_t^{\mathrm{L2}} = g_t + \lambda \theta_{t-1}$ both pollutes $\hat{v}_t^{\mathrm{L2}}$ and (at $\beta_1 = 0$) turns the step into:

$$
\theta_{t, i} = \theta_{t-1, i} - \eta \frac{g_{t, i} + \lambda \theta_{t-1, i}}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon} = \left(1 - \frac{\eta \lambda}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon}\right)\theta_{t-1, i} - \eta \frac{g_{t, i}}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon}
$$

Look at the effective decay factor $\frac{\eta \lambda}{\sqrt{\hat{v}_{t, i}^{\mathrm{L2}}} + \epsilon}$: it gets divided by historical gradient RMS!

Active weights with large gradients ($\sqrt{\hat{v}_{t,i}} \gg 1$) escape shrinkage almost completely, while quiet weights ($\sqrt{\hat{v}_{t,i}} \ll 1$) are crushed—inverting the isotropic Gaussian prior.

`AdamW` fixes the bug in one stroke by pulling weight decay outside the preconditioner:

$$
\theta_t = (1 - \eta \lambda)\theta_{t-1} - \eta \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}
$$

```sketch title="Dataflow Comparison: Coupled $L_2$ Regularization vs. Decoupled Weight Decay (AdamW)" note="Under coupled $L_2$, the penalty $\lambda\theta_{t-1}$ enters the gradient and gets divided by $\sqrt{\hat{v}_t}$, distorting per-coordinate shrinkage; AdamW applies uniform multiplicative decay directly to the weights."
<svg viewBox="0 0 704 224">
  <rect class="panel" x="0" y="0" width="704" height="104" rx="12"/>
  <text class="caps" x="20" y="24">COUPLED ADAM + L2 REGULARIZATION</text>
  <g class="node plain"><rect x="20" y="40" width="154" height="38" rx="4"/><tex class="mid" x="97" y="59">g_t + \lambda \theta_{t-1}</tex></g>
  <path class="edge hot" d="M174 59 H204" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="208" y="40" width="194" height="38" rx="4"/><tex class="mid" x="305" y="59">\div \left(\sqrt{\hat{v}_t^{\mathrm{L2}}} + \epsilon\right)</tex></g>
  <path class="edge hot" d="M402 59 H432" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="436" y="40" width="248" height="38" rx="4"/><text class="mid small b" x="560" y="59">High-grad ~0 decay; low-grad over-shrunk</text></g>

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
  <g class="node clay"><rect x="16" y="98" width="308" height="52" rx="4"/><tex class="mid" x="170" y="115">1 - \frac{\eta \lambda}{\sqrt{\hat{v}_t^{\mathrm{L2}}} + \epsilon}</tex><text class="mid small" x="170" y="137">High-grad stalls; low-grad over-shrunk</text></g>

  <rect class="panel" x="0" y="186" width="340" height="170" rx="12"/>
  <text class="caps" x="16" y="210">ADAMW · DECOUPLED</text>
  <g class="node plain"><rect x="16" y="224" width="144" height="34" rx="4"/><tex class="mid" x="88" y="241">g_t = \nabla L(\theta_{t-1})</tex></g>
  <path class="edge" d="M160 241 H180" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="184" y="224" width="140" height="34" rx="4"/><tex class="mid" x="254" y="241">\hat{m}_t / \sqrt{\hat{v}_t}</tex></g>
  <path class="edge" d="M170 258 V280" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="16" y="284" width="308" height="52" rx="4"/><tex class="mid" x="170" y="303">\theta_t = (1 - \eta \lambda)\theta_{t-1} - \eta \hat{m}_t / \sqrt{\hat{v}_t}</tex><text class="mid small" x="170" y="325">All coordinates decay at identical rate</text></g>
</svg>
```

The numerical verification below puts both results side by side.

The left panel plots 26 steps of `SGD`, `Momentum`, and `AdamW` on the $\kappa = 36$ canyon $L(\theta_1, \theta_2) = 0.5\theta_1^2 + 18\theta_2^2$. The right panel runs `Adam+L2` versus `AdamW` on two redundant weights initialized at $2.5$ under zero-mean alternating gradient noise of amplitude $40$ versus $0.05$: under `Adam+L2`, the high-gradient weight stalls at $2.39$, whereas both `AdamW` curves overlap identically.

```plot title="Entrywise Optimizer Verification: Ill-Conditioned Trajectories and Coupled $L_2$ Decay Distortion" note="Left: 26 steps on $L(\theta_1, \theta_2) = 0.5\theta_1^2 + 18\theta_2^2$ ($\kappa = 36$). Right: decay toward zero under zero-mean alternating noise ($\theta_1$ amp 40, $\theta_2$ amp 0.05, init $2.5$, $\eta=0.02, \lambda=0.4$)."
{"cols":2,"narrowCols":1,"legend":[{"label":"SGD / Adam+$L_2$ high-grad $\\theta_1$","color":"var(--clay)","shape":"line"},{"label":"Momentum / Adam+$L_2$ low-grad $\\theta_2$","color":"var(--orange)","shape":"dash"},{"label":"AdamW (per-axis adaptation & isotropic decay)","color":"var(--teal)","shape":"line"}],"data":{"canyon":[{"opt":"SGD","step":0,"w1":-3.4,"w2":0.78},{"opt":"SGD","step":1,"w1":-3.223,"w2":-0.68},{"opt":"SGD","step":2,"w1":-3.056,"w2":0.593},{"opt":"SGD","step":3,"w1":-2.897,"w2":-0.517},{"opt":"SGD","step":4,"w1":-2.746,"w2":0.451},{"opt":"SGD","step":5,"w1":-2.603,"w2":-0.393},{"opt":"SGD","step":6,"w1":-2.468,"w2":0.343},{"opt":"SGD","step":7,"w1":-2.34,"w2":-0.299},{"opt":"SGD","step":8,"w1":-2.218,"w2":0.261},{"opt":"SGD","step":9,"w1":-2.103,"w2":-0.227},{"opt":"SGD","step":10,"w1":-1.993,"w2":0.198},{"opt":"SGD","step":11,"w1":-1.89,"w2":-0.173},{"opt":"SGD","step":12,"w1":-1.791,"w2":0.151},{"opt":"SGD","step":13,"w1":-1.698,"w2":-0.131},{"opt":"SGD","step":14,"w1":-1.61,"w2":0.115},{"opt":"SGD","step":15,"w1":-1.526,"w2":-0.1},{"opt":"SGD","step":16,"w1":-1.447,"w2":0.087},{"opt":"SGD","step":17,"w1":-1.372,"w2":-0.076},{"opt":"SGD","step":18,"w1":-1.3,"w2":0.066},{"opt":"SGD","step":19,"w1":-1.233,"w2":-0.058},{"opt":"SGD","step":20,"w1":-1.169,"w2":0.05},{"opt":"SGD","step":21,"w1":-1.108,"w2":-0.044},{"opt":"SGD","step":22,"w1":-1.05,"w2":0.038},{"opt":"SGD","step":23,"w1":-0.996,"w2":-0.033},{"opt":"SGD","step":24,"w1":-0.944,"w2":0.029},{"opt":"SGD","step":25,"w1":-0.895,"w2":-0.025},{"opt":"SGD","step":26,"w1":-0.848,"w2":0.022},{"opt":"Momentum","step":0,"w1":-3.4,"w2":0.78},{"opt":"Momentum","step":1,"w1":-3.281,"w2":0.203},{"opt":"Momentum","step":2,"w1":-3.061,"w2":-0.812},{"opt":"Momentum","step":3,"w1":-2.761,"w2":-0.325},{"opt":"Momentum","step":4,"w1":-2.4,"w2":0.513},{"opt":"Momentum","step":5,"w1":-1.998,"w2":0.604},{"opt":"Momentum","step":6,"w1":-1.575,"w2":-0.077},{"opt":"Momentum","step":7,"w1":-1.147,"w2":-0.579},{"opt":"Momentum","step":8,"w1":-0.731,"w2":-0.292},{"opt":"Momentum","step":9,"w1":-0.339,"w2":0.329},{"opt":"Momentum","step":10,"w1":0.018,"w2":0.461},{"opt":"Momentum","step":11,"w1":0.332,"w2":-0.004},{"opt":"Momentum","step":12,"w1":0.596,"w2":-0.408},{"opt":"Momentum","step":13,"w1":0.808,"w2":-0.249},{"opt":"Momentum","step":14,"w1":0.966,"w2":0.204},{"opt":"Momentum","step":15,"w1":1.071,"w2":0.346},{"opt":"Momentum","step":16,"w1":1.126,"w2":0.035},{"opt":"Momentum","step":17,"w1":1.135,"w2":-0.283},{"opt":"Momentum","step":18,"w1":1.103,"w2":-0.206},{"opt":"Momentum","step":19,"w1":1.037,"w2":0.121},{"opt":"Momentum","step":20,"w1":0.942,"w2":0.257},{"opt":"Momentum","step":21,"w1":0.826,"w2":0.052},{"opt":"Momentum","step":22,"w1":0.694,"w2":-0.193},{"opt":"Momentum","step":23,"w1":0.554,"w2":-0.166},{"opt":"Momentum","step":24,"w1":0.412,"w2":0.067},{"opt":"Momentum","step":25,"w1":0.272,"w2":0.188},{"opt":"Momentum","step":26,"w1":0.139,"w2":0.057},{"opt":"AdamW","step":0,"w1":-3.4,"w2":0.78},{"opt":"AdamW","step":1,"w1":-3.15,"w2":0.53},{"opt":"AdamW","step":2,"w1":-2.901,"w2":0.287},{"opt":"AdamW","step":3,"w1":-2.653,"w2":0.061},{"opt":"AdamW","step":4,"w1":-2.406,"w2":-0.133},{"opt":"AdamW","step":5,"w1":-2.163,"w2":-0.278},{"opt":"AdamW","step":6,"w1":-1.922,"w2":-0.362},{"opt":"AdamW","step":7,"w1":-1.686,"w2":-0.39},{"opt":"AdamW","step":8,"w1":-1.454,"w2":-0.371},{"opt":"AdamW","step":9,"w1":-1.229,"w2":-0.318},{"opt":"AdamW","step":10,"w1":-1.011,"w2":-0.242},{"opt":"AdamW","step":11,"w1":-0.802,"w2":-0.152},{"opt":"AdamW","step":12,"w1":-0.602,"w2":-0.057},{"opt":"AdamW","step":13,"w1":-0.412,"w2":0.033},{"opt":"AdamW","step":14,"w1":-0.235,"w2":0.112},{"opt":"AdamW","step":15,"w1":-0.071,"w2":0.172},{"opt":"AdamW","step":16,"w1":0.079,"w2":0.21},{"opt":"AdamW","step":17,"w1":0.213,"w2":0.225},{"opt":"AdamW","step":18,"w1":0.332,"w2":0.217},{"opt":"AdamW","step":19,"w1":0.434,"w2":0.19},{"opt":"AdamW","step":20,"w1":0.52,"w2":0.148},{"opt":"AdamW","step":21,"w1":0.589,"w2":0.096},{"opt":"AdamW","step":22,"w1":0.642,"w2":0.04},{"opt":"AdamW","step":23,"w1":0.68,"w2":-0.015},{"opt":"AdamW","step":24,"w1":0.702,"w2":-0.063},{"opt":"AdamW","step":25,"w1":0.71,"w2":-0.101},{"opt":"AdamW","step":26,"w1":0.705,"w2":-0.126}],"pts":[{"w1":-3.4,"w2":0.78,"lbl":"Start (-3.4, 0.78)"},{"w1":0.0,"w2":0.0,"lbl":"Minimum (0, 0)"}],"decay":[{"step":0,"l2_hi":2.5,"l2_lo":2.5,"aw_hi":2.5,"aw_lo":2.5},{"step":5,"l2_hi":2.469,"l2_lo":2.4,"aw_hi":2.374,"aw_lo":2.374},{"step":10,"l2_hi":2.465,"l2_lo":2.301,"aw_hi":2.278,"aw_lo":2.278},{"step":15,"l2_hi":2.459,"l2_lo":2.202,"aw_hi":2.185,"aw_lo":2.185},{"step":20,"l2_hi":2.457,"l2_lo":2.105,"aw_hi":2.099,"aw_lo":2.099},{"step":25,"l2_hi":2.453,"l2_lo":2.009,"aw_hi":2.015,"aw_lo":2.015},{"step":30,"l2_hi":2.451,"l2_lo":1.915,"aw_hi":1.937,"aw_lo":1.937},{"step":35,"l2_hi":2.447,"l2_lo":1.822,"aw_hi":1.859,"aw_lo":1.859},{"step":40,"l2_hi":2.446,"l2_lo":1.732,"aw_hi":1.787,"aw_lo":1.787},{"step":45,"l2_hi":2.442,"l2_lo":1.644,"aw_hi":1.715,"aw_lo":1.715},{"step":50,"l2_hi":2.441,"l2_lo":1.559,"aw_hi":1.649,"aw_lo":1.649},{"step":55,"l2_hi":2.437,"l2_lo":1.476,"aw_hi":1.583,"aw_lo":1.583},{"step":60,"l2_hi":2.436,"l2_lo":1.395,"aw_hi":1.522,"aw_lo":1.522},{"step":65,"l2_hi":2.433,"l2_lo":1.317,"aw_hi":1.461,"aw_lo":1.461},{"step":70,"l2_hi":2.431,"l2_lo":1.242,"aw_hi":1.404,"aw_lo":1.404},{"step":75,"l2_hi":2.428,"l2_lo":1.169,"aw_hi":1.348,"aw_lo":1.348},{"step":80,"l2_hi":2.426,"l2_lo":1.099,"aw_hi":1.296,"aw_lo":1.296},{"step":85,"l2_hi":2.423,"l2_lo":1.031,"aw_hi":1.244,"aw_lo":1.244},{"step":90,"l2_hi":2.421,"l2_lo":0.967,"aw_hi":1.196,"aw_lo":1.196},{"step":95,"l2_hi":2.418,"l2_lo":0.905,"aw_hi":1.148,"aw_lo":1.148},{"step":100,"l2_hi":2.417,"l2_lo":0.846,"aw_hi":1.104,"aw_lo":1.104},{"step":105,"l2_hi":2.413,"l2_lo":0.789,"aw_hi":1.059,"aw_lo":1.059},{"step":110,"l2_hi":2.412,"l2_lo":0.735,"aw_hi":1.019,"aw_lo":1.019},{"step":115,"l2_hi":2.408,"l2_lo":0.684,"aw_hi":0.977,"aw_lo":0.977},{"step":120,"l2_hi":2.407,"l2_lo":0.635,"aw_hi":0.94,"aw_lo":0.94},{"step":125,"l2_hi":2.403,"l2_lo":0.589,"aw_hi":0.902,"aw_lo":0.902},{"step":130,"l2_hi":2.402,"l2_lo":0.545,"aw_hi":0.867,"aw_lo":0.867},{"step":135,"l2_hi":2.399,"l2_lo":0.504,"aw_hi":0.832,"aw_lo":0.832},{"step":140,"l2_hi":2.397,"l2_lo":0.465,"aw_hi":0.801,"aw_lo":0.801},{"step":145,"l2_hi":2.394,"l2_lo":0.428,"aw_hi":0.768,"aw_lo":0.768},{"step":150,"l2_hi":2.392,"l2_lo":0.393,"aw_hi":0.739,"aw_lo":0.739}]},"panels":[{"title":"Ill-Conditioned Quadratic · $L(\\theta_1, \\theta_2) = 0.5\\theta_1^2 + 18\\theta_2^2$","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"Flat-axis parameter θ₁","domain":[-3.7,0.95]},"y":{"label":"Steep-axis parameter θ₂","domain":[-0.92,0.92]},"grid":true,"marks":[{"mark":"ruleY","data":[0],"stroke":"var(--line)"},{"mark":"ruleX","data":[0],"stroke":"var(--line)"},{"mark":"line","data":"canyon","filter":{"opt":"SGD"},"x":"w1","y":"w2","stroke":"var(--clay)","strokeWidth":1.8},{"mark":"line","data":"canyon","filter":{"opt":"Momentum"},"x":"w1","y":"w2","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"canyon","filter":{"opt":"AdamW"},"x":"w1","y":"w2","stroke":"var(--teal)","strokeWidth":2.4},{"mark":"dot","data":"canyon","filter":{"opt":"AdamW"},"x":"w1","y":"w2","fill":"var(--teal)","r":2.2,"tip":["opt","step","w1","w2"]},{"mark":"dot","data":"pts","x":"w1","y":"w2","fill":"var(--ink)","r":4.2},{"mark":"text","data":[{"w1":-3.3,"w2":0.84,"t":"Start"}],"x":"w1","y":"w2","text":"t","textAnchor":"start","fill":"var(--ink)"},{"mark":"text","data":[{"w1":0.0,"w2":-0.22,"t":"Minimum (0, 0)"}],"x":"w1","y":"w2","text":"t","textAnchor":"middle","fill":"var(--ink)"}]},{"title":"Decoupled Weight Decay · High-Grad $\\theta_1$ vs Low-Grad $\\theta_2$","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"Step t","domain":[0,155]},"y":{"label":"Parameter value","domain":[0,2.75]},"grid":true,"marks":[{"mark":"line","data":"decay","x":"step","y":"l2_hi","stroke":"var(--clay)","strokeWidth":2.4},{"mark":"line","data":"decay","x":"step","y":"l2_lo","stroke":"var(--orange)","strokeWidth":2.0,"strokeDasharray":"5 3"},{"mark":"line","data":"decay","x":"step","y":"aw_hi","stroke":"var(--teal)","strokeWidth":2.6},{"mark":"line","data":"decay","x":"step","y":"aw_lo","stroke":"var(--blue)","strokeWidth":1.8,"strokeDasharray":"2 3"},{"mark":"dot","data":"decay","x":"step","y":"l2_hi","fill":"var(--clay)","r":2,"tip":["step","l2_hi","l2_lo","aw_hi"]},{"mark":"text","data":[{"step":148,"y":2.54,"t":"Adam+L2 high-grad stalls at 2.39"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"step":148,"y":1.78,"t":"AdamW both decay equally to 0.74"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"},{"mark":"text","data":[{"step":148,"y":0.22,"t":"Adam+L2 low-grad shrinks to 0.39"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--orange)"}]}]}
```

One practical detail follows right away: why set `weight_decay = 0.0` on 1D `RMSNorm` gains $\gamma$ (and biases) in `AdamW`?

Initialized to $1$, $\gamma$ merely rescales unit-RMS channels and accounts for under $0.05\%$ of total parameters—there is no high-rank overfitting capacity to regularize. Pulling $\gamma$ toward $0$ only dampens layer outputs and forces adjacent linear weights to inflate in compensation.

---

## 4. From Entrywise Norms to 2D Operator Spectral Norms: Deriving `Muon`

`AdamW` gives us the modern entrywise baseline.

Now connect the two facts established in Sections 1 and 2: over $95\%$ of non-embedding weights in a Transformer ($W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}$) are 2D linear operators $W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$, and their gradients $G = \sum_{n=1}^N \delta_n x_n^\top$ carry heavily skewed singular spectra.

What geometry does `AdamW` actually impose when handed such a 2D matrix?

### 4.1 AdamW's Hidden Geometry: Steepest Descent Under the Entrywise Max Norm

To compare non-Euclidean norms cleanly, rewrite Section 3's proximal penalty in constrained **normalized steepest descent** form.

Let $\langle A, B \rangle_F \triangleq \mathrm{tr}(A^\top B) = \sum_{i, j} A_{i, j} B_{i, j}$ denote the Frobenius inner product, with $\|A\|_F = \sqrt{\langle A, A \rangle_F}$. Given any matrix norm $\|\cdot\|$ and step budget $\eta > 0$, steepest descent inside the $\|\cdot\|$-ball solves:

$$
\Delta W^* = \mathrm{arg}\min_{\|\Delta W\| \le \eta} \langle G, \Delta W \rangle_F
$$

(By Lagrangian duality, the ball-constrained solution points in the exact same direction as the quadratic penalty while normalizing step length to $\|\Delta W^*\| = \eta$. Under the Frobenius norm $\|\Delta W\|_F \le \eta$, for example, $\Delta W^* = -\eta G / \|G\|_F$.)

Now turn off `Adam`'s memory ($\beta_1 = 0, \beta_2 = 0, \epsilon \to 0$) to expose its instantaneous skeleton: each cell $(i, j)$ steps by $-\eta \frac{G_{i, j}}{\sqrt{G_{i, j}^2}} = -\eta \,\mathrm{sign}(G_{i, j})$ (`SignSGD`).

Which matrix norm produces that exact step? The **entrywise max norm** $\|\Delta W\|_{\max} \triangleq \max_{i, j} |\Delta W_{i, j}|$—the $\ell_\infty$ norm of the flattened matrix:

$$
\min_{\|\Delta W\|_{\max} \le \eta} \langle G, \Delta W \rangle_F = \min_{\forall i, j:\; |\Delta W_{i, j}| \le \eta} \sum_{i=1}^{d_{\mathrm{out}}} \sum_{j=1}^{d_{\mathrm{in}}} G_{i, j} \Delta W_{i, j} \quad \Longrightarrow \quad \Delta W_{i, j}^* = -\eta \,\mathrm{sign}(G_{i, j})
$$

In one sentence: **`AdamW` is EMA-smoothed steepest descent under the entrywise $\ell_\infty$ norm**[@bernstein2024].

Treating a $d_{\mathrm{out}} \times d_{\mathrm{in}}$ linear operator as $d_{\mathrm{out}} \cdot d_{\mathrm{in}}$ uncoupled scalar boxes has two structural flaws:

1. **It depends on an arbitrary coordinate basis**. Rotating hidden states via $h \mapsto Q h$ ($Q^\top Q = I$) preserves Euclidean/RMS geometry, yet elementwise sign is not rotation-equivariant ($\mathrm{sign}(Q G) \neq Q \,\mathrm{sign}(G)$).
2. **Equalizing entries does not equalize singular subspaces**. When $G$ is dominated by a single rank-$1$ outer product $u v^\top$, taking elementwise signs gives $\mathrm{sign}(u v^\top) = \mathrm{sign}(u)\,\mathrm{sign}(v)^\top$—**still a rank-$1$ matrix**! Dividing each cell by $\sqrt{\hat{v}_{i, j}}$ cannot wake up the dozens of weak tail singular subspaces underneath.

Plug the exact $2 \times 3$ gradient $G = \begin{bsmallmatrix} -1.0 & -2.0 & -0.4 \\ 0.4 & 0.8 & 0.2 \end{bsmallmatrix}$ from Section 2.4 into step $t = 1$ of bias-corrected `Adam` ($\hat{M}_1 = G$, $\hat{V}_1 = G \odot G = \begin{bsmallmatrix} 1.00 & 4.00 & 0.16 \\ 0.16 & 0.64 & 0.04 \end{bsmallmatrix}$, neglecting $\epsilon$):

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

Look at what just happened.

Every cell now has magnitude $1$—yet because row 2 became the exact negative of row 1, the update collapsed into a **rank-1 matrix** ($\sigma_1 \approx 2.45,\; \sigma_2 = \mathbf{0.00}$)! The subtle column-3 signal ($\sigma_2 \approx 0.037$) that distinguished token 2 from token 1 was wiped out completely.

As a preview, the semi-orthogonal polar factor $U V^\top$ derived next maps the very same $G$ to the full-rank matrix $\begin{bsmallmatrix} -0.438 & -0.877 & +0.199 \\ +0.089 & +0.178 & \mathbf{+0.980} \end{bsmallmatrix}$ ($\sigma_1 = \sigma_2 = 1$), dedicating $98\%$ of neuron 2's step directly to that novel 3rd feature.

### 4.2 Algebraic Simplification from `Shampoo` to Its Stateless Limit

How can we precondition a matrix gradient while preserving row-column coupling?

Flattening $W \in \mathbb{R}^{A \times B}$ into full-matrix `AdaGrad` would build an $(AB) \times (AB)$ covariance table—$2.8 \times 10^{14}$ floats for one $4096 \times 4096$ layer, dead on arrival.

In 2018, Gupta, Koren, and Singer proposed **Shampoo**[@gupta2018]: factor the preconditioner via a Kronecker product into a left row covariance $L_t = \sum_{s=1}^t G_s G_s^\top \in \mathbb{R}^{A \times A}$ and a right column covariance $R_t = \sum_{s=1}^t G_s^\top G_s \in \mathbb{R}^{B \times B}$, stepping along $L_t^{-1/4} G_t R_t^{-1/4}$.

Why the $-1/4$ exponent instead of `AdaGrad`'s $-1/2$? Check the units: $L_t$ and $R_t$ are both quadratic in $G$ ($G^2$), so left-multiplying by $L_t^{-1/4}$ ($G^{-1/2}$) and right-multiplying by $R_t^{-1/4}$ ($G^{-1/2}$) together cancel one power of $G_t$.

Later experiments uncovered a surprise: turning off cross-step accumulation in `Shampoo` and evaluating the instantaneous stateless form $((G G^\top)^+)^{1/4} G ((G^\top G)^+)^{1/4}$ (where $(\cdot)^+$ is the Moore-Penrose pseudoinverse) on current momentum not only avoids degradation—it often converges faster[@bernstein2024]!

Let us simplify that bilateral $-1/4$ power algebraically.

Let $G \in \mathbb{R}^{A \times B}$ have rank $r \le \min(A, B)$ with **reduced SVD**:

$$
G = U \Sigma V^\top
$$

where $U \in \mathbb{R}^{A \times r}$ ($U^\top U = I_r$) and $V \in \mathbb{R}^{B \times r}$ ($V^\top V = I_r$) have orthonormal columns, and $\Sigma = \mathrm{diag}(\sigma_1, \dots, \sigma_r)$ holds positive singular values $\sigma_1 \ge \dots \ge \sigma_r > 0$. (Keep in mind the identity $\|G\|_F^2 = \mathrm{tr}(G^\top G) = \sum_{i=1}^r \sigma_i^2$.)

Form the left and right Gram matrices:

$$
G G^\top = (U \Sigma V^\top)(V \Sigma U^\top) = U \Sigma^2 U^\top, \qquad G^\top G = (V \Sigma U^\top)(U \Sigma V^\top) = V \Sigma^2 V^\top
$$

Taking the $1/4$ power of the pseudoinverse raises each positive entry of $\Sigma^2$ to $-1/4$, giving $\Sigma^{-1/2}$:

$$
((G G^\top)^+)^{1/4} = U \Sigma^{-1/2} U^\top, \qquad ((G^\top G)^+)^{1/4} = V \Sigma^{-1/2} V^\top
$$

Multiply left, middle, and right together using $U^\top U = I_r$ and $V^\top V = I_r$:

$$
((G G^\top)^+)^{1/4} G ((G^\top G)^+)^{1/4} = \bigl(U \Sigma^{-1/2} U^\top\bigr)(U \Sigma V^\top)\bigl(V \Sigma^{-1/2} V^\top\bigr) = U \Sigma^{-1/2} \Sigma \Sigma^{-1/2} V^\top = U I_r V^\top = U V^\top
$$

The entire singular-value matrix $\Sigma$ cancels out!

No matter how many orders of magnitude separated $\sigma_1$ from $\sigma_r$, every active singular value becomes $1$. At full rank $r = \min(A, B)$, $U V^\top \in \mathbb{R}^{A \times B}$ is the nearest **semi-orthogonal matrix** to $G$.

### 4.3 First-Principles Derivation: Steepest Descent Under the Induced RMS-to-RMS Operator Norm

In *Old Optimizer, New Norm* (2024), Bernstein and Newhouse showed an even deeper truth: $U V^\top$ needs no second-order Hessian story at all—it is the **exact first-order steepest-descent step under the natural induced operator norm of hidden linear layers**[@bernstein2024].

Let us derive it from scratch.

Consider an internal linear map $y = W x$ sending $x \in \mathbb{R}^{d_{\mathrm{in}}}$ to $y \in \mathbb{R}^{d_{\mathrm{out}}}$. Recall from Section 2.1 that `RMSNorm` measures hidden vectors in **root-mean-square norm**:

$$
\|x\|_{\mathrm{RMS}} \triangleq \frac{1}{\sqrt{d_{\mathrm{in}}}} \|x\|_2, \qquad \|y\|_{\mathrm{RMS}} \triangleq \frac{1}{\sqrt{d_{\mathrm{out}}}} \|y\|_2
$$

Stepping $W \to W + \Delta W$ shifts the layer output on input $x$ by $\Delta y = \Delta W x$.

To keep that output RMS perturbation bounded regardless of widths $d_{\mathrm{in}}, d_{\mathrm{out}}$, the natural ruler on $\Delta W$ is the worst-case output RMS shift per unit input RMS—the **induced $\mathrm{RMS} \to \mathrm{RMS}$ operator norm**:

$$
\|\Delta W\|_{\mathrm{RMS} \to \mathrm{RMS}} \triangleq \max_{x \neq 0} \frac{\|\Delta W x\|_{\mathrm{RMS}}}{\|x\|_{\mathrm{RMS}}} = \max_{x \neq 0} \frac{\frac{1}{\sqrt{d_{\mathrm{out}}}}\|\Delta W x\|_2}{\frac{1}{\sqrt{d_{\mathrm{in}}}}\|x\|_2} = \sqrt{\frac{d_{\mathrm{in}}}{d_{\mathrm{out}}}} \max_{\|x\|_2 = 1} \|\Delta W x\|_2 = \sqrt{\frac{d_{\mathrm{in}}}{d_{\mathrm{out}}}}\, \sigma_1(\Delta W)
$$

It is simply the aspect-ratio factor times the largest singular value $\sigma_1(\Delta W)$ (spectral norm)!

Given lookahead momentum $\tilde{M} = U \Sigma V^\top = \sum_{i=1}^r \sigma_i u_i v_i^\top$ ($\sigma_i > 0$), steepest descent inside this induced norm ball solves:

$$
\min_{\|\Delta W\|_{\mathrm{RMS} \to \mathrm{RMS}} \le \eta} \langle \tilde{M}, \Delta W \rangle_F \quad \Longleftrightarrow \quad \min_{\sigma_1(\Delta W) \le \eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}} \mathrm{tr}(\tilde{M}^\top \Delta W)
$$

Expand the inner product via cyclic trace invariance:

$$
\langle \tilde{M}, \Delta W \rangle_F = \mathrm{tr}\!\left(\sum_{i=1}^{r} \sigma_i v_i u_i^\top \Delta W\right) = \sum_{i=1}^{r} \sigma_i \, u_i^\top \Delta W v_i
$$

Because $\|u_i\|_2 = \|v_i\|_2 = 1$, Cauchy-Schwarz bounds every term $i \in \{1, \dots, r\}$ by the spectral norm ceiling:

$$
|u_i^\top \Delta W v_i| \le \|u_i\|_2 \, \|\Delta W v_i\|_2 \le \sigma_1(\Delta W) \le \eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}}
$$

Multiplying by $\sigma_i > 0$ and summing gives a tight lower bound:

$$
\langle \tilde{M}, \Delta W \rangle_F = \sum_{i=1}^{r} \sigma_i \, u_i^\top \Delta W v_i \ge -\eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}} \sum_{i=1}^{r} \sigma_i
$$

When does equality hold? If and only if $u_i^\top \Delta W v_i = -\eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}$ holds **simultaneously across all $r$ active singular directions**!

Plug in the semi-orthogonal candidate:

$$
\Delta W^* = -\eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}} \, U V^\top
$$

It sits right on the boundary $\sigma_1(\Delta W^*) = \eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}$ and attains $u_i^\top \Delta W^* v_i = -\eta \sqrt{d_{\mathrm{out}} / d_{\mathrm{in}}}$ for every $i$ (uniquely at full rank).

That is the geometric heart of **Muon**: a Frobenius ball follows skewed singular values as-is, an entrywise $\ell_\infty$ box levels isolated cells, whereas the $\mathrm{RMS} \to \mathrm{RMS}$ operator ball **marches all $r$ orthogonal feature subspaces forward at equal speed**.

```sketch title="Geometric Comparison of Steepest Descent Under Three Matrix Norm Balls" note="Under the Frobenius ball, updates concentrate along the top singular direction; under the entrywise $\ell_\infty$ cube, cell magnitudes equalize without fixing low-rank skew; under the operator spectral norm, all nonzero singular values map to $1$."
<svg viewBox="0 0 704 228">
  <rect class="panel" x="0" y="0" width="224" height="228" rx="12"/>
  <text class="caps" x="20" y="25">1 · FROBENIUS NORM BALL</text>
  <circle cx="112" cy="96" r="40" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.5"/>
  <path class="edge hot" d="M112 96 L146 75" marker-end="url(#arrow)"/>
  <tex class="small mid" x="112" y="162">\|\Delta W\|_F \le \eta \implies -\eta G / \|G\|_F</tex>
  <text class="small mid mute" x="112" y="186">Preserves singular-value skew</text>
  <text class="small mid mute" x="112" y="206">Step dominated by top σ₁</text>

  <rect class="panel" x="240" y="0" width="224" height="228" rx="12"/>
  <text class="caps" x="260" y="25">2 · ENTRYWISE MAX NORM</text>
  <rect x="312" y="56" width="80" height="80" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.5"/>
  <path class="edge" d="M352 96 L390 58" marker-end="url(#arrow)"/>
  <tex class="small mid" x="352" y="162">\|\Delta W\|_{\max} \le \eta \implies -\eta\,\mathrm{sign}(G)</tex>
  <text class="small mid mute" x="352" y="186">EMA-smoothed form gives AdamW</text>
  <text class="small mid mute" x="352" y="206">Balances entries, keeps low rank</text>

  <rect class="panel" x="480" y="0" width="224" height="228" rx="12"/>
  <text class="caps" x="500" y="25">3 · OPERATOR SPECTRAL NORM</text>
  <ellipse cx="592" cy="96" rx="58" ry="16" transform="rotate(-18 592 96)" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.25" stroke-dasharray="4 3"/>
  <circle cx="592" cy="96" r="38" fill="none" stroke="var(--blue)" stroke-width="2"/>
  <tex class="small mid b" x="592" y="96" width="64">U \Sigma V^\top \mapsto U V^\top</tex>
  <tex class="small mid" x="592" y="162">\|\Delta W\|_{\mathrm{RMS}\to\mathrm{RMS}} \le \eta</tex>
  <text class="small mid mute" x="592" y="186">Maps all singular values to 1</text>
  <text class="small mid mute" x="592" y="206">Tail subspaces learn at full speed</text>
</svg>
<svg viewBox="0 0 340 492">
  <rect class="panel" x="0" y="0" width="340" height="152" rx="12"/>
  <text class="caps" x="16" y="24">1 · FROBENIUS NORM BALL</text>
  <circle cx="68" cy="88" r="34" fill="var(--card)" stroke="var(--node-line)" stroke-width="1.5"/>
  <path class="edge hot" d="M68 88 L98 70" marker-end="url(#arrow)"/>
  <tex class="small" x="122" y="68">\|\Delta W\|_F \le \eta \implies -\eta G / \|G\|_F</tex>
  <text class="small mute" x="122" y="94">Dominated by top singular dir</text>
  <text class="small mute" x="122" y="116">Tail subspaces barely move</text>

  <rect class="panel" x="0" y="168" width="340" height="152" rx="12"/>
  <text class="caps" x="16" y="192">2 · ENTRYWISE MAX NORM</text>
  <rect x="34" y="222" width="68" height="68" fill="var(--teal-wash)" stroke="var(--teal)" stroke-width="1.5"/>
  <path class="edge" d="M68 256 L100 224" marker-end="url(#arrow)"/>
  <tex class="small" x="122" y="236">\|\Delta W\|_{\max} \le \eta \implies -\eta\,\mathrm{sign}(G)</tex>
  <text class="small mute" x="122" y="262">Smoothed form corresponds to AdamW</text>
  <text class="small mute" x="122" y="284">Leaves matrix rank skew intact</text>

  <rect class="panel" x="0" y="336" width="340" height="156" rx="12"/>
  <text class="caps" x="16" y="360">3 · SPECTRAL NORM (MUON)</text>
  <ellipse cx="68" cy="426" rx="44" ry="13" transform="rotate(-18 68 426)" fill="var(--clay-wash)" stroke="var(--clay)" stroke-width="1.25" stroke-dasharray="3 2"/>
  <circle cx="68" cy="426" r="32" fill="none" stroke="var(--blue)" stroke-width="2"/>
  <tex class="small" x="122" y="404">U \Sigma V^\top \mapsto U V^\top</tex>
  <text class="small mute" x="122" y="430">Exact induced operator-norm step</text>
  <text class="small mute" x="122" y="452">Every orthogonal subspace steps by 1</text>
</svg>
```

### 4.4 Deriving the Dual-Optimizer Parameter Routing Rule from Induced Norms

Every production `Muon` setup enforces a strict split: internal 2D projections (`W_q, W_k, W_v, W_o, W_up, W_down`) go to `Muon`, while boundary embeddings (`tok_emb, pos_emb`), `lm_head`, and 1D `RMSNorm` gains stay on `AdamW`[@jordan2024][@liu2025].

Why shouldn't $E_{\mathrm{tok}}$ and $W_{\mathrm{head}}$—which are also large 2D matrices—go into `Muon` too?

You do not need trial and error to see why; just check **the induced norms of their own input and output spaces**[@bernstein2024]:

1. **Token embedding table $E_{\mathrm{tok}} \in \mathbb{R}^{V \times D}$ ($\ell_1 \to \mathrm{RMS}$)**. Its input is a one-hot vector $u \in \mathbb{R}^V$ measured in $\ell_1$ norm $\|u\|_1 = 1$, and its output enters the residual stream measured in $\|\cdot\|_{\mathrm{RMS}}$.

   Because a convex function on the $\ell_1$ polytope hits its maximum at an extreme one-hot vertex $u = e_v$:

$$
\|\Delta E_{\mathrm{tok}}^\top\|_{\ell_1 \to \mathrm{RMS}} = \max_{\|u\|_1 = 1} \|\Delta E_{\mathrm{tok}}^\top u\|_{\mathrm{RMS}} = \max_{v \in \{0, \dots, V-1\}} \|\Delta E_{\mathrm{tok}}[v, :]\|_{\mathrm{RMS}}
$$

   It takes a row-by-row maximum—**vocabulary rows are geometrically decoupled**! Moreover, a mini-batch touches at most $B \times T$ rows while most rows stay zero; global orthogonalization would needlessly tangle frequent and rare words together.
2. **Output LM head $W_{\mathrm{head}} \in \mathbb{R}^{V \times D}$ ($\mathrm{RMS} \to \ell_\infty$)**. Mapping unit-RMS hidden states $h \in \mathbb{R}^D$ to logits $z = W_{\mathrm{head}} h \in \mathbb{R}^V$, Softmax shifts are governed by $\max_v |z_v| = \|z\|_\infty$. Its induced norm $\|\Delta W_{\mathrm{head}}\|_{\mathrm{RMS} \to \ell_\infty} = \max_v \sqrt{D}\,\|\Delta W_{\mathrm{head}}[v, :]\|_2$ likewise decouples across vocabulary rows, making `AdamW` a natural fit[@jordan2024][@liu2025].
3. **1D `RMSNorm` vector $\gamma \in \mathbb{R}^D$**. Even viewed as a $D \times 1$ matrix, its rank is at most $1$—a single singular value $\sigma_1 = \|\gamma\|_2$ has no inter-direction skew to flatten, and orthogonalizing it would destroy per-channel scaling.

```sketch title="Dual-Optimizer Parameter Routing Dictated by Input-Output Space Norms" note="Only 2D linear operators mapping continuous hidden RMS spaces to RMS spaces ($\mathrm{RMS} \to \mathrm{RMS}$) call for spectral orthogonalization; row-decoupled vocabulary boundaries and 1D gains belong to AdamW."
<svg viewBox="0 0 704 218">
  <rect class="panel" x="0" y="0" width="340" height="218" rx="12"/>
  <text class="caps" x="20" y="25">INTERNAL 2D OPERATORS · MUON</text>
  <g class="node blue"><rect x="20" y="40" width="300" height="44" rx="6"/><tex class="mid" x="170" y="62">W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}</tex></g>
  <path class="edge" d="M170 84 V106" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="20" y="110" width="300" height="50" rx="6"/><tex class="mid" x="170" y="129">\mathrm{RMS} \to \mathrm{RMS} \implies \Delta W \propto -U V^\top</tex><text class="mid small" x="170" y="149">Flattens spectrum · Drops 2nd moment V</text></g>
  <text class="small" x="20" y="190">Continuous hidden maps (&gt;95% of non-vocab params)</text>

  <rect class="panel" x="364" y="0" width="340" height="218" rx="12"/>
  <text class="caps" x="384" y="25">BOUNDARY &amp; 1D PARAMS · ADAMW</text>
  <g class="node plain"><rect x="384" y="40" width="300" height="44" rx="6"/><tex class="mid" x="534" y="62">E_{\mathrm{tok}}, E_{\mathrm{pos}}, W_{\mathrm{head}}, \gamma_{\mathrm{norm}}</tex></g>
  <path class="edge" d="M534 84 V106" marker-end="url(#arrow)"/>
  <g class="node violet"><rect x="384" y="110" width="300" height="50" rx="6"/><tex class="mid" x="534" y="128">\ell_1 \to \mathrm{RMS},\; \mathrm{RMS} \to \ell_\infty\;\;(\max_v \|W_{v,:}\|_2)</tex><text class="mid small" x="534" y="149">Decoupled per token row → AdamW (1D wd=0)</text></g>
  <text class="small" x="384" y="190">Prevents cross-token crosstalk &amp; logit drift</text>
</svg>
<svg viewBox="0 0 340 392">
  <rect class="panel" x="0" y="0" width="340" height="186" rx="12"/>
  <text class="caps" x="16" y="24">INTERNAL 2D · MUON</text>
  <g class="node blue"><rect x="16" y="38" width="308" height="42" rx="6"/><tex class="mid" x="170" y="59">W_q, W_k, W_v, W_o, W_{\mathrm{up}}, W_{\mathrm{down}}</tex></g>
  <path class="edge" d="M170 80 V100" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="16" y="104" width="308" height="48" rx="6"/><tex class="mid" x="170" y="122">\mathrm{RMS} \to \mathrm{RMS} \implies -U V^\top</tex><text class="mid small" x="170" y="141">Spectral step · Eliminates buffer V</text></g>
  <text class="small" x="16" y="172">Hidden linear maps (&gt;95% of non-vocab params)</text>

  <rect class="panel" x="0" y="202" width="340" height="190" rx="12"/>
  <text class="caps" x="16" y="226">BOUNDARY &amp; 1D · ADAMW</text>
  <g class="node plain"><rect x="16" y="240" width="308" height="42" rx="6"/><tex class="mid" x="170" y="261">E_{\mathrm{tok}}, E_{\mathrm{pos}}, W_{\mathrm{head}}, \gamma_{\mathrm{norm}}</tex></g>
  <path class="edge" d="M170 282 V302" marker-end="url(#arrow)"/>
  <g class="node violet"><rect x="16" y="306" width="308" height="48" rx="6"/><text class="mid b" x="170" y="324">Row-decoupled → Adaptive AdamW</text><text class="mid small" x="170" y="343">Avoids token crosstalk; wd=0 on 1D gains</text></g>
  <text class="small" x="16" y="376">Preserves independent per-token step scales</text>
</svg>
```

---

## 5. Odd-Degree Newton-Schulz Iteration and Scalable RMS Alignment

Theory asks for $O_t = U V^\top$. Calling exact `torch.linalg.svd` on hundreds of $4096 \times 4096$ matrices every step, however, would stall GPU pipelines: exact SVD relies on sequential `float32` bidiagonalization and Givens sweeps that cannot exploit half-precision Tensor Cores.

In October 2024, Keller Jordan, Bernstein, and collaborators introduced **Muon (MomentUm Orthogonalized by Newton-Schulz)**[@jordan2024], replacing exact SVD with **five `bfloat16` odd-degree matrix polynomial steps**.

### 5.1 Why Odd Matrix Polynomials Preserve Left and Right Singular Vectors

Let $X \in \mathbb{R}^{A \times B}$ have reduced SVD $X = U \Sigma V^\top$. Check what happens when we alternate $X$ and $X^\top$ in odd products:

$$
\begin{aligned}
(X X^\top) X &= (U \Sigma V^\top)(V \Sigma U^\top)(U \Sigma V^\top) = U \Sigma (V^\top V) \Sigma (U^\top U) \Sigma V^\top = U \Sigma^3 V^\top \\
(X X^\top)^2 X &= (U \Sigma^2 U^\top)^2 (U \Sigma V^\top) = U \Sigma^5 V^\top
\end{aligned}
$$

Even powers like $X X^\top = U \Sigma^2 U^\top$ wipe out $V^\top$ and alter the matrix shape to $A \times A$. **Only odd products $(X X^\top)^m X$ preserve both singular bases $U$ and $V^\top$ intact!**

Consequently, for any odd quintic $\varphi(\sigma) = a \sigma + b \sigma^3 + c \sigma^5$, setting $A_k = X_k X_k^\top$ and iterating pure matrix multiplications

$$
X_{k+1} = a X_k + (b A_k + c A_k^2) X_k
$$

freezes $U$ and $V^\top$ while applying $\varphi$ scalar-wise to every singular value on the diagonal:

$$
X_{k+1} = U \varphi(\Sigma_k) V^\top, \qquad \sigma_{k+1, i} = \varphi(\sigma_{k, i}) = a \sigma_{k, i} + b \sigma_{k, i}^3 + c \sigma_{k, i}^5
$$

Two lightweight preprocessing steps come before $k = 0$:

1. **Frobenius pre-normalization into $[0, 1]$**. Because $c \sigma^5$ blows up for $\sigma > 1$, every initial singular value must sit inside $[0, 1]$. Since $\|\tilde{M}_t\|_F^2 = \sum_{j=1}^r \sigma_j^2 \ge \sigma_1^2$, a single division suffices:

$$
X_0 = \frac{\tilde{M}_t}{\|\tilde{M}_t\|_F + \epsilon}
$$

   Every $\sigma_{0, i}$ now lands in $[0, 1]$ without ever estimating $\sigma_1$. Any positive scalar factor cancels out in $\frac{c \tilde{M}_t}{\|c \tilde{M}_t\|_F}$ as well—which is why `Muon`'s momentum $M_t = \mu M_{t-1} + G_t$ needs neither $(1-\mu)$ nor `Adam`-style bias correction.
2. **Tall-matrix transpose ($A > B$ saves >90% compute)**. When rows exceed columns (say $W_{\mathrm{up}} \in \mathbb{R}^{256 \times 64}$ with $A = 4B$), forming $X_k X_k^\top$ builds an $A \times A$ Gram matrix costing $(2A^2 B + A^3)$ MACs per step.

   Transposing $X_0$ into a $B \times A$ wide matrix first shrinks the Gram matrix to $B \times B$, cutting per-step MACs from $96 B^3$ down to $9 B^3$ at $A = 4B$—and transposing back after 5 steps is bit-exact.

### 5.2 Classical Newton-Schulz vs. `Muon`'s Minimax Coefficients

Where do the three coefficients $(a, b, c)$ come from? Start with **classical Newton-Schulz**.

Applying Newton's method directly to $g(s) = s^2 - 1 = 0$ gives $s_{k+1} = \frac{1}{2}(s_k + s_k^{-1})$, which still demands a matrix inverse $X_k^{-1}$.

To banish inversion, apply Newton's method to $f(s) = s^{-2} - 1 = 0$ instead! That puts $f'(s) = -2s^{-3}$ in the denominator, flipping negative exponents into pure positive odd powers:

$$
s_{k+1} = s_k - \frac{f(s_k)}{f'(s_k)} = s_k - \frac{s_k^{-2} - 1}{-2 s_k^{-3}} = \frac{3}{2}s_k - \frac{1}{2}s_k^3
$$

Extending to a quintic $\varphi_{\mathrm{classic}}(\sigma) = a\sigma + b\sigma^3 + c\sigma^5$ with third-order local tangency at $\sigma = 1$ ($\varphi(1) = 1,\; \varphi'(1) = 0,\; \varphi''(1) = 0$) solves:

$$
\begin{cases}
a + b + c = 1 \\
a + 3b + 5c = 0 \\
6b + 20c = 0
\end{cases}
\quad \Longrightarrow \quad
(a, b, c)_{\mathrm{classic}} = \left(\frac{15}{8},\; -\frac{10}{8},\; \frac{3}{8}\right) = (1.875,\; -1.25,\; 0.375)
$$

In LLM training, however, dividing a $4096 \times 4096$ skewed gradient by $\|\tilde{M}_t\|_F$ pushes dozens of tail singular values down into $[10^{-3}, 10^{-2}]$. Near zero, $\sigma^3$ and $\sigma^5$ vanish, so per-step lift equals the origin slope $\varphi'(0) = a$. Five steps of $a = 1.875$ give at most $1.875^5 \approx 23.2\times$ lift—leaving $\sigma_0 = 0.01$ stuck at $0.21$.

Here Jordan et al. made a sharp engineering call.

Under noisy `bfloat16` gradients with 7 mantissa bits, polishing singular values to $1.000000$ buys nothing; what matters is **lifting tiny tail singular values as fast as possible within 5 steps**.

Relaxing $\varphi(1) = 1$ so $\varphi^{(5)}(\sigma)$ equiripples inside $[1 - \delta, 1 + \delta]$ around $1$ unlocks a much steeper origin slope[@jordan2024]:

$$
(a, b, c)_{\mathrm{Muon}} = (3.4445,\; -4.7750,\; 2.0315)
$$

Two quick checks show why this wins:

- **Tail lift jumps $21\times$**. Raising $a$ from $1.875$ to $3.4445$ boosts 5-step small-signal gain to $3.4445^5 \approx 484.4\times$, pulling $\sigma_0 = 0.01$ right up to $\varphi^{(5)}(0.01) \approx 0.70$.
- **Why $\varphi(1) = 3.4445 - 4.7750 + 2.0315 = 0.7010 \neq 1$?** That is not a typo, but the deliberate trough of the equiripple band: every $\sigma_0 \in [0.01, 1.0]$ lands inside $[0.68, 1.13]$ after 5 steps (with tiny values in $(0, 0.01)$ peaking no higher than $\max \varphi \approx 1.20$).

To see how plain matrix multiplications uncover a hidden singular direction without SVD, let us unfold all 5 steps on a $2 \times 2$ skewed momentum matrix:

$$
\tilde{M} =
\underbrace{\begin{bmatrix} 10 & 10 \\ 10 & 10 \end{bmatrix}}_{\text{dominant mode }\sigma_1 = 20.0}
+
\underbrace{\begin{bmatrix} -0.1 & +0.1 \\ +0.1 & -0.1 \end{bmatrix}}_{\text{weak orthogonal mode }\sigma_2 = 0.2}
=
\begin{bmatrix}
9.9 & 10.1 \\
10.1 & 9.9
\end{bmatrix}
$$

All four entries hover near $+10$, differing by just $0.2$.

Entrywise sign (`SignSGD` / memoryless `Adam`) sees four positive numbers and outputs the rank-1 matrix $\begin{bsmallmatrix} 1 & 1 \\ 1 & 1 \end{bsmallmatrix}$ ($\sigma = [2, 0]$), erasing the anti-diagonal mode. Yet the true orthogonal polar factor is the swap matrix $U V^\top = \begin{bsmallmatrix} 0 & 1 \\ 1 & 0 \end{bsmallmatrix}$ ($\sigma = [1, 1]$).

Now run `Muon`'s quintic recursion $X_{k+1} = 3.4445 X_k + (-4.7750 A_k + 2.0315 A_k^2) X_k$ with zero SVD:

1. **Step 0 pre-normalization**. $\|\tilde{M}\|_F = \sqrt{400.04} \approx 20.001$, giving $X_0 = \begin{bsmallmatrix} 0.495 & 0.505 \\ 0.505 & 0.495 \end{bsmallmatrix}$ with singular values $(1.000, 0.010)$.
2. **Why step 1 pulls $0.495$ and $0.505$ apart**. Gram matrix $A_0 = X_0 X_0^\top \approx \begin{bsmallmatrix} 0.50005 & 0.49995 \\ 0.49995 & 0.50005 \end{bsmallmatrix}$ has eigenvalue $1$ along $\begin{bsmallmatrix} 1 \\ 1 \end{bsmallmatrix}$, so $-4.7750 A_0 X_0$ brakes the dominant mode down to $0.701$. Along $\begin{bsmallmatrix} -1 \\ 1 \end{bsmallmatrix}$, its eigenvalue is $0.01^2 = 0.0001$, so cubic/quintic damping vanishes while $3.4445 X_0$ amplifies the tiny gap $3.4445\times$ into $X_1 = \begin{bsmallmatrix} 0.333 & 0.368 \\ 0.368 & 0.333 \end{bsmallmatrix}$!
3. **Unfolding all five iterations ($k = 1 \dots 5$)**:

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

Five plain matrix multiplications cancel the diagonal background to $-0.001$ and isolate the swap operator $\approx 0.70\begin{bsmallmatrix} 0 & 1 \\ 1 & 0 \end{bsmallmatrix}$, flattening $100:1$ skew into $(0.699,\; 0.697)$.

```sketch title="Unfolded Numeric Walkthrough: Cell-by-Cell Evolution of a 100:1 Skewed Matrix Under SGD, Sign/Adam, and 5-Step Newton-Schulz" note="Input $\tilde{M} = \begin{bsmallmatrix}9.9 & 10.1\\10.1 & 9.9\end{bsmallmatrix}$ combines dominant $\sigma_1=20.0$ with tail $\sigma_2=0.2$. Entrywise sign collapses to a rank-1 all-ones matrix because all 4 entries are positive; 5 Newton-Schulz polynomial steps isolate the hidden orthogonal swap matrix via pure matrix multiplications."
<svg viewBox="0 0 704 446">
  <rect class="panel" x="0" y="0" width="704" height="206" rx="12"/>
  <text class="caps" x="18" y="22">1 · SAME 100:1 SKEWED MATRIX UNDER THREE UPDATE RULES</text>
  <text class="small b" x="18" y="44">Input = [[10,10],[10,10]] (σ₁=20) + [[-0.1,0.1],[0.1,-0.1]] (σ₂=0.2): tiny differential mode buried under +10</text>

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
  <text class="mid small b" x="241" y="76">SGD / Frobenius Norm</text>
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
  <text class="mid small mute" x="241" y="175">Keeps 100:1 skew</text>

  <rect x="336" y="58" width="166" height="132" rx="8" fill="var(--card)" stroke="var(--clay)"/>
  <text class="mid small b" x="419" y="76" fill="var(--clay-ink)">Entrywise Sign / Adam</text>
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
  <text class="mid small accent" x="419" y="175">Wipes out σ₂ completely</text>

  <rect x="514" y="58" width="172" height="132" rx="8" fill="var(--card)" stroke="var(--teal)"/>
  <text class="mid small b" x="600" y="76" fill="var(--teal-ink)">Muon Exact Polar UVᵀ</text>
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
  <text class="mid small" x="600" y="175">Both subspaces step = 1</text>

  <rect class="panel" x="0" y="222" width="704" height="224" rx="12"/>
  <text class="caps" x="18" y="244">2 · 5-STEP NEWTON-SCHULZ PURE MATMUL EVOLUTION (ZERO SVD)</text>
  <text class="small b" x="18" y="266">Watch diagonal common-mode shrink to ~0 while anti-diagonal differential mode amplifies into an orthogonal swap</text>

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

  <text class="small" x="18" y="424">By step 5, diagonal drops to -0.001, anti-diagonal rises to 0.698, flattening singular ratio from 100:1 to 1.003:1</text>
</svg>
<svg viewBox="0 0 340 604">
  <rect class="panel" x="0" y="0" width="340" height="278" rx="12"/>
  <text class="caps" x="14" y="22">1 · THREE UPDATE RULES UNFOLDED</text>
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
  <text class="small" x="116" y="60">= 10×ones (dominant)</text>
  <text class="small accent" x="116" y="80">+ 0.1×anti-diag (tail)</text>

  <text class="small b" x="20" y="136" fill="var(--clay-ink)">Entrywise Sign</text>
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
  <text class="small mute" x="20" y="232">Erases ±0.1 signal</text>

  <text class="small b" x="182" y="136" fill="var(--teal-ink)">Muon Polar UVᵀ</text>
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
  <text class="small mute" x="182" y="232">Restores swap matrix</text>

  <rect class="panel" x="0" y="294" width="340" height="310" rx="12"/>
  <text class="caps" x="14" y="316">2 · 5-STEP NEWTON-SCHULZ TRACE</text>

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

  <text class="small" x="14" y="560">5 rounds of pure matrix multiplies, zero SVD</text>
  <text class="small b" x="14" y="582" fill="var(--teal-ink)">Singular ratio flattens from 100:1 to 0.699 : 0.697</text>
</svg>
```

The left panel below plots $\varphi^{(k)}(\sigma)$ at $k = 1, 3, 5$; the right panel measures all 64 singular values of Layer 1's `W_q` momentum at step 25 of our 2-layer Transformer.

The contrast is stark: raw momentum spans $13{,}669\times$, and even `AdamW`'s entrywise step still decays by over $2{,}000\times$. Five Newton-Schulz steps place the top 53 singular values squarely inside $[0.68, 1.20]$.

```plot title="Newton-Schulz Quintic Composition Curves and Measured Transformer $W_q$ Singular Spectrum" note="Left: $\varphi(\sigma) = 3.4445\sigma - 4.7750\sigma^3 + 2.0315\sigma^5$ composed 1, 3, and 5 times. Right: all 64 singular values of Layer-1 $W_q$ at step 25 of a 2-layer Mini-Transformer ($D=64$; raw momentum and AdamW updates normalized by $\sigma_1$ to compare spectral shape)."
{"cols":2,"narrowCols":1,"legend":[{"label":"Muon 5-step $\\varphi^{(5)}(\\sigma)$ / $O_t$ spectrum","color":"var(--teal)","shape":"line"},{"label":"1-step map / AdamW update spectrum","color":"var(--orange)","shape":"dash"},{"label":"Raw momentum $\\tilde{M}_t$ spectrum (13,669× ratio)","color":"var(--clay)","shape":"line"},{"label":"$[0.01, 1]$ target band $[0.68, 1.13]$","color":"var(--teal)","shape":"band"}],"data":{"ns":[{"s0":0.0,"id":0.0,"k1":0.0,"k3":0.0,"k5":0.0},{"s0":0.01,"id":0.01,"k1":0.0344,"k3":0.4001,"k5":0.6989},{"s0":0.02,"id":0.02,"k1":0.0689,"k3":0.7506,"k5":0.6818},{"s0":0.03,"id":0.03,"k1":0.1032,"k3":1.012,"k5":1.1223},{"s0":0.04,"id":0.04,"k1":0.1375,"k3":1.1626,"k5":0.9514},{"s0":0.05,"id":0.05,"k1":0.1716,"k3":1.2016,"k5":0.7581},{"s0":0.06,"id":0.06,"k1":0.2056,"k3":1.1482,"k5":1.0056},{"s0":0.07,"id":0.07,"k1":0.2395,"k3":1.0355,"k5":1.1325},{"s0":0.08,"id":0.08,"k1":0.2731,"k3":0.9023,"k5":0.9524},{"s0":0.09,"id":0.09,"k1":0.3065,"k3":0.7843,"k5":0.7005},{"s0":0.1,"id":0.1,"k1":0.3397,"k3":0.7071,"k5":0.7121},{"s0":0.11,"id":0.11,"k1":0.3726,"k3":0.6818,"k5":0.7531},{"s0":0.12,"id":0.12,"k1":0.4051,"k3":0.7053,"k5":0.7145},{"s0":0.13,"id":0.13,"k1":0.4374,"k3":0.7629,"k5":0.6843},{"s0":0.14,"id":0.14,"k1":0.4692,"k3":0.8339,"k5":0.786},{"s0":0.15,"id":0.15,"k1":0.5007,"k3":0.8974,"k5":0.9409},{"s0":0.16,"id":0.16,"k1":0.5318,"k3":0.9374,"k5":1.0279},{"s0":0.17,"id":0.17,"k1":0.5624,"k3":0.9454,"k5":1.0427},{"s0":0.18,"id":0.18,"k1":0.5925,"k3":0.9219,"k5":0.9967},{"s0":0.19,"id":0.19,"k1":0.6222,"k3":0.8745,"k5":0.8842},{"s0":0.2,"id":0.2,"k1":0.6514,"k3":0.815,"k5":0.7468},{"s0":0.21,"id":0.21,"k1":0.68,"k3":0.7566,"k5":0.6824},{"s0":0.22,"id":0.22,"k1":0.708,"k3":0.7109,"k5":0.7072},{"s0":0.23,"id":0.23,"k1":0.7354,"k3":0.6856,"k5":0.7461},{"s0":0.24,"id":0.24,"k1":0.7623,"k3":0.6841,"k5":0.7489},{"s0":0.25,"id":0.25,"k1":0.7885,"k3":0.7053,"k5":0.7145},{"s0":0.26,"id":0.26,"k1":0.8141,"k3":0.7451,"k5":0.6823},{"s0":0.27,"id":0.27,"k1":0.8389,"k3":0.7974,"k5":0.7172},{"s0":0.28,"id":0.28,"k1":0.8631,"k3":0.8558,"k5":0.8377},{"s0":0.29,"id":0.29,"k1":0.8866,"k3":0.9145,"k5":0.9804},{"s0":0.3,"id":0.3,"k1":0.9094,"k3":0.9689,"k5":1.0796},{"s0":0.31,"id":0.31,"k1":0.9314,"k3":1.0162,"k5":1.1248},{"s0":0.32,"id":0.32,"k1":0.9526,"k3":1.055,"k5":1.1342},{"s0":0.33,"id":0.33,"k1":0.973,"k3":1.0851,"k5":1.1226},{"s0":0.34,"id":0.34,"k1":0.9927,"k3":1.1071,"k5":1.0998},{"s0":0.35,"id":0.35,"k1":1.0115,"k3":1.122,"k5":1.0748},{"s0":0.36,"id":0.36,"k1":1.0295,"k3":1.1308,"k5":1.0556},{"s0":0.37,"id":0.37,"k1":1.0467,"k3":1.1343,"k5":1.0469},{"s0":0.38,"id":0.38,"k1":1.063,"k3":1.1329,"k5":1.0504},{"s0":0.39,"id":0.39,"k1":1.0784,"k3":1.1268,"k5":1.0647},{"s0":0.4,"id":0.4,"k1":1.093,"k3":1.1161,"k5":1.0859},{"s0":0.41,"id":0.41,"k1":1.1067,"k3":1.1004,"k5":1.1083},{"s0":0.42,"id":0.42,"k1":1.1195,"k3":1.0797,"k5":1.1261},{"s0":0.43,"id":0.43,"k1":1.1314,"k3":1.0542,"k5":1.1342},{"s0":0.44,"id":0.44,"k1":1.1423,"k3":1.0244,"k5":1.1288},{"s0":0.45,"id":0.45,"k1":1.1524,"k3":0.9911,"k5":1.1056},{"s0":0.46,"id":0.46,"k1":1.1615,"k3":0.9558,"k5":1.0602},{"s0":0.47,"id":0.47,"k1":1.1698,"k3":0.9199,"k5":0.9923},{"s0":0.48,"id":0.48,"k1":1.177,"k3":0.885,"k5":0.9106},{"s0":0.49,"id":0.49,"k1":1.1834,"k3":0.8528,"k5":0.8303},{"s0":0.5,"id":0.5,"k1":1.1889,"k3":0.8244,"k5":0.7654},{"s0":0.51,"id":0.51,"k1":1.1934,"k3":0.8006,"k5":0.722},{"s0":0.52,"id":0.52,"k1":1.197,"k3":0.7818,"k5":0.6978},{"s0":0.53,"id":0.53,"k1":1.1997,"k3":0.7681,"k5":0.6869},{"s0":0.54,"id":0.54,"k1":1.2014,"k3":0.7592,"k5":0.6831},{"s0":0.55,"id":0.55,"k1":1.2023,"k3":0.755,"k5":0.6821},{"s0":0.56,"id":0.56,"k1":1.2022,"k3":0.7552,"k5":0.6822},{"s0":0.57,"id":0.57,"k1":1.2013,"k3":0.7598,"k5":0.6832},{"s0":0.58,"id":0.58,"k1":1.1995,"k3":0.7689,"k5":0.6874},{"s0":0.59,"id":0.59,"k1":1.1968,"k3":0.7827,"k5":0.6987},{"s0":0.6,"id":0.6,"k1":1.1933,"k3":0.8011,"k5":0.7229},{"s0":0.61,"id":0.61,"k1":1.1889,"k3":0.8242,"k5":0.7651},{"s0":0.62,"id":0.62,"k1":1.1837,"k3":0.8514,"k5":0.8269},{"s0":0.63,"id":0.63,"k1":1.1777,"k3":0.8819,"k5":0.9028},{"s0":0.64,"id":0.64,"k1":1.1709,"k3":0.9147,"k5":0.9809},{"s0":0.65,"id":0.65,"k1":1.1633,"k3":0.9484,"k5":1.0479},{"s0":0.66,"id":0.66,"k1":1.155,"k3":0.9816,"k5":1.0955},{"s0":0.67,"id":0.67,"k1":1.1459,"k3":1.0131,"k5":1.123},{"s0":0.68,"id":0.68,"k1":1.1362,"k3":1.0418,"k5":1.1338},{"s0":0.69,"id":0.69,"k1":1.1258,"k3":1.0669,"k5":1.1318},{"s0":0.7,"id":0.7,"k1":1.1148,"k3":1.0881,"k5":1.1203},{"s0":0.71,"id":0.71,"k1":1.1031,"k3":1.1051,"k5":1.1025},{"s0":0.72,"id":0.72,"k1":1.0909,"k3":1.118,"k5":1.0824},{"s0":0.73,"id":0.73,"k1":1.0781,"k3":1.127,"k5":1.0642},{"s0":0.74,"id":0.74,"k1":1.0648,"k3":1.1324,"k5":1.0516},{"s0":0.75,"id":0.75,"k1":1.051,"k3":1.1344,"k5":1.0467},{"s0":0.76,"id":0.76,"k1":1.0368,"k3":1.1329,"k5":1.0505},{"s0":0.77,"id":0.77,"k1":1.0222,"k3":1.1279,"k5":1.0624},{"s0":0.78,"id":0.78,"k1":1.0073,"k3":1.1192,"k5":1.0803},{"s0":0.79,"id":0.79,"k1":0.992,"k3":1.1065,"k5":1.1007},{"s0":0.8,"id":0.8,"k1":0.9765,"k3":1.0895,"k5":1.1192},{"s0":0.81,"id":0.81,"k1":0.9608,"k3":1.0679,"k5":1.1315},{"s0":0.82,"id":0.82,"k1":0.9449,"k3":1.0417,"k5":1.1338},{"s0":0.83,"id":0.83,"k1":0.9289,"k3":1.0112,"k5":1.1218},{"s0":0.84,"id":0.84,"k1":0.9128,"k3":0.9767,"k5":1.0898},{"s0":0.85,"id":0.85,"k1":0.8968,"k3":0.9393,"k5":1.0315},{"s0":0.86,"id":0.86,"k1":0.8808,"k3":0.9,"k5":0.9469},{"s0":0.87,"id":0.87,"k1":0.8649,"k3":0.8602,"k5":0.8486},{"s0":0.88,"id":0.88,"k1":0.8492,"k3":0.8216,"k5":0.7598},{"s0":0.89,"id":0.89,"k1":0.8338,"k3":0.7857,"k5":0.702},{"s0":0.9,"id":0.9,"k1":0.8187,"k3":0.7539,"k5":0.682},{"s0":0.91,"id":0.91,"k1":0.8039,"k3":0.7273,"k5":0.6908},{"s0":0.92,"id":0.92,"k1":0.7896,"k3":0.7067,"k5":0.7126},{"s0":0.93,"id":0.93,"k1":0.7759,"k3":0.6924,"k5":0.7343},{"s0":0.94,"id":0.94,"k1":0.7627,"k3":0.6843,"k5":0.7486},{"s0":0.95,"id":0.95,"k1":0.7502,"k3":0.6818,"k5":0.7531},{"s0":0.96,"id":0.96,"k1":0.7385,"k3":0.6843,"k5":0.7486},{"s0":0.97,"id":0.97,"k1":0.7277,"k3":0.6905,"k5":0.7375},{"s0":0.98,"id":0.98,"k1":0.7177,"k3":0.6994,"k5":0.7231},{"s0":0.99,"id":0.99,"k1":0.7088,"k3":0.7098,"k5":0.7085},{"s0":1.0,"id":1.0,"k1":0.701,"k3":0.7207,"k5":0.6964}],"band1":[{"x":0.0,"lo":0.6818,"hi":1.1344},{"x":1.0,"lo":0.6818,"hi":1.1344}],"band2":[{"x":1,"lo":0.6818,"hi":1.1344},{"x":64,"lo":0.6818,"hi":1.1344}],"svd":[{"idx":1,"raw":1.0,"adamw":1.0,"muon":1.2007},{"idx":2,"raw":0.5543,"adamw":0.8475,"muon":1.1964},{"idx":3,"raw":0.3382,"adamw":0.5205,"muon":1.1935},{"idx":4,"raw":0.2587,"adamw":0.3883,"muon":1.1749},{"idx":5,"raw":0.1777,"adamw":0.3127,"muon":1.1506},{"idx":6,"raw":0.139,"adamw":0.2501,"muon":1.1341},{"idx":7,"raw":0.1122,"adamw":0.2177,"muon":1.1304},{"idx":8,"raw":0.1051,"adamw":0.1945,"muon":1.1269},{"idx":9,"raw":0.0732,"adamw":0.1593,"muon":1.1122},{"idx":10,"raw":0.0689,"adamw":0.1533,"muon":1.1037},{"idx":11,"raw":0.057,"adamw":0.1373,"muon":1.096},{"idx":12,"raw":0.0561,"adamw":0.1255,"muon":1.0942},{"idx":13,"raw":0.0495,"adamw":0.124,"muon":1.0746},{"idx":14,"raw":0.0449,"adamw":0.1107,"muon":1.0629},{"idx":15,"raw":0.0407,"adamw":0.105,"muon":1.0549},{"idx":16,"raw":0.0371,"adamw":0.0984,"muon":1.0364},{"idx":17,"raw":0.0352,"adamw":0.0934,"muon":1.0221},{"idx":18,"raw":0.0308,"adamw":0.0877,"muon":0.9834},{"idx":19,"raw":0.029,"adamw":0.0847,"muon":0.9444},{"idx":20,"raw":0.0278,"adamw":0.078,"muon":0.9384},{"idx":21,"raw":0.0261,"adamw":0.0754,"muon":0.9342},{"idx":22,"raw":0.0251,"adamw":0.0723,"muon":0.9319},{"idx":23,"raw":0.0231,"adamw":0.0705,"muon":0.9309},{"idx":24,"raw":0.0221,"adamw":0.063,"muon":0.9208},{"idx":25,"raw":0.0202,"adamw":0.0604,"muon":0.9076},{"idx":26,"raw":0.019,"adamw":0.0586,"muon":0.8924},{"idx":27,"raw":0.0175,"adamw":0.0544,"muon":0.8863},{"idx":28,"raw":0.0158,"adamw":0.0512,"muon":0.88},{"idx":29,"raw":0.0153,"adamw":0.0492,"muon":0.8593},{"idx":30,"raw":0.0138,"adamw":0.0473,"muon":0.8521},{"idx":31,"raw":0.0132,"adamw":0.0457,"muon":0.8331},{"idx":32,"raw":0.0125,"adamw":0.0428,"muon":0.8155},{"idx":33,"raw":0.0117,"adamw":0.0423,"muon":0.8028},{"idx":34,"raw":0.0103,"adamw":0.0394,"muon":0.7985},{"idx":35,"raw":0.0098,"adamw":0.0381,"muon":0.7961},{"idx":36,"raw":0.0085,"adamw":0.037,"muon":0.7891},{"idx":37,"raw":0.0083,"adamw":0.0349,"muon":0.7767},{"idx":38,"raw":0.0076,"adamw":0.0323,"muon":0.7655},{"idx":39,"raw":0.0072,"adamw":0.0292,"muon":0.7579},{"idx":40,"raw":0.0069,"adamw":0.0282,"muon":0.7531},{"idx":41,"raw":0.0066,"adamw":0.0275,"muon":0.7411},{"idx":42,"raw":0.006,"adamw":0.0241,"muon":0.7389},{"idx":43,"raw":0.0057,"adamw":0.0227,"muon":0.7304},{"idx":44,"raw":0.005,"adamw":0.0216,"muon":0.7276},{"idx":45,"raw":0.0048,"adamw":0.0213,"muon":0.7217},{"idx":46,"raw":0.0041,"adamw":0.0195,"muon":0.7155},{"idx":47,"raw":0.0034,"adamw":0.0188,"muon":0.7029},{"idx":48,"raw":0.0033,"adamw":0.0171,"muon":0.7007},{"idx":49,"raw":0.0028,"adamw":0.0157,"muon":0.6977},{"idx":50,"raw":0.0028,"adamw":0.0154,"muon":0.6957},{"idx":51,"raw":0.0024,"adamw":0.0138,"muon":0.6882},{"idx":52,"raw":0.0021,"adamw":0.013,"muon":0.6822},{"idx":53,"raw":0.002,"adamw":0.0113,"muon":0.6819},{"idx":54,"raw":0.0016,"adamw":0.0109,"muon":0.5902},{"idx":55,"raw":0.0015,"adamw":0.0087,"muon":0.5366},{"idx":56,"raw":0.0012,"adamw":0.0077,"muon":0.4558},{"idx":57,"raw":0.0012,"adamw":0.0064,"muon":0.4354},{"idx":58,"raw":0.0011,"adamw":0.0053,"muon":0.4271},{"idx":59,"raw":0.0009,"adamw":0.0048,"muon":0.3298},{"idx":60,"raw":0.0006,"adamw":0.0039,"muon":0.2364},{"idx":61,"raw":0.0005,"adamw":0.0033,"muon":0.1728},{"idx":62,"raw":0.0003,"adamw":0.0026,"muon":0.1185},{"idx":63,"raw":0.0002,"adamw":0.0015,"muon":0.0697},{"idx":64,"raw":0.0001,"adamw":0.0004,"muon":0.0281}]},"panels":[{"title":"Quintic Polynomial Map · $\\varphi^{(k)}(\\sigma)$ for $k=1, 3, 5$","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"Pre-normalized singular value σ₀ ∈ [0, 1]","domain":[0,1.02]},"y":{"label":"Mapped singular value","domain":[0,1.28]},"grid":true,"marks":[{"mark":"areaY","data":"band1","x":"x","y1":"lo","y2":"hi","fill":"var(--teal)","fillOpacity":0.13},{"mark":"ruleY","data":[1.0],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"line","data":"ns","x":"s0","y":"id","stroke":"var(--stone)","strokeDasharray":"4 4"},{"mark":"line","data":"ns","x":"s0","y":"k1","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"ns","x":"s0","y":"k3","stroke":"var(--blue)","strokeWidth":1.6},{"mark":"line","data":"ns","x":"s0","y":"k5","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":[{"s0":1.0,"k1":0.701}],"x":"s0","y":"k1","fill":"var(--clay)","r":4.2,"tip":["s0","k1"]},{"mark":"text","data":[{"x":0.99,"y":0.56,"t":"φ(1) = 0.701"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"}]},{"title":"Measured Layer-1 $W_q$ Singular Spectrum (Step 25, 64 dims)","height":280,"narrowHeight":245,"marginBottom":38,"x":{"label":"Singular value index i (1 → 64)","domain":[1,64]},"y":{"label":"Normalized singular value (log)","domain":[0,1.28]},"grid":true,"marks":[{"mark":"areaY","data":"band2","x":"x","y1":"lo","y2":"hi","fill":"var(--teal)","fillOpacity":0.13},{"mark":"ruleY","data":[1.0],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"line","data":"svd","x":"idx","y":"raw","stroke":"var(--clay)","strokeWidth":2.1},{"mark":"line","data":"svd","x":"idx","y":"adamw","stroke":"var(--orange)","strokeWidth":1.9,"strokeDasharray":"5 3"},{"mark":"line","data":"svd","x":"idx","y":"muon","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":"svd","x":"idx","y":"muon","fill":"var(--teal)","r":2.0,"tip":["idx","muon","adamw","raw"]},{"mark":"text","data":[{"x":63,"y":1.19,"t":"Top 53 singular values ∈ [0.68, 1.20]"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"},{"mark":"text","data":[{"x":14,"y":0.15,"t":"Raw momentum decays 13,669×"}],"x":"x","y":"y","text":"t","textAnchor":"start","fill":"var(--clay)"}]}]}
```

### 5.3 Moonshot AI's Scaling Improvements: Update RMS Alignment and Decoupled Weight Decay

Taking `Muon` from small benchmarks to 100B-scale LLM pretraining runs into two practical hurdles: how to reuse `AdamW` learning-rate schedules without retuning, and how to keep weight norms bounded over long horizons.

In early 2025, Moonshot AI (Liu, Su et al.) solved both in *Muon is Scalable for LLM Training*[@liu2025].

**First: aligning entrywise update RMS across shapes and with `AdamW`.**

Let $O_t \in \mathbb{R}^{A \times B}$ have full rank $r = \min(A, B)$ with singular values near $1$. Its squared Frobenius norm is:

$$
\|O_t\|_F^2 = \sum_{i=1}^{A} \sum_{j=1}^{B} O_{t, ij}^2 = \sum_{k=1}^{\min(A, B)} \sigma_k^2 \approx \min(A, B)
$$

Spread across $A \cdot B$ entries, the per-element root-mean-square update magnitude is:

$$
\mathrm{RMS}(O_t) \triangleq \sqrt{\frac{1}{A B} \|O_t\|_F^2} \approx \sqrt{\frac{\min(A, B)}{A B}} = \frac{1}{\sqrt{\max(A, B)}}
$$

That reveals the scaling snag. Under either Section 4.3's $\sqrt{A / B}$ factor or Keller Jordan's clamped $\sqrt{\max(1, A/B)}$, entrywise update RMS shrinks as $1/\sqrt{d_{\mathrm{in}}}$ whenever model width grows—forcing separate learning-rate sweeps across widths and across attention, MLP, and MoE layers.

Instead, ask: **what is `AdamW`'s steady-state entrywise update RMS?**

Model late-stage coordinate gradients $\{g_t\}$ as zero-mean i.i.d. random variables with variance $\sigma^2$. For large $t$:

- $\mathbb{E}[v_t] = (1 - \beta_2)\sum_{k=0}^\infty \beta_2^k \mathbb{E}[g_{t-k}^2] = \sigma^2$;
- With zero cross-step correlation:

$$
\mathbb{E}[m_t^2] = (1 - \beta_1)^2 \sum_{k=0}^{\infty} \beta_1^{2k} \mathbb{E}[g_{t-k}^2] = \frac{(1 - \beta_1)^2}{1 - \beta_1^2} \sigma^2 = \frac{1 - \beta_1}{1 + \beta_1} \sigma^2
$$

Since $\beta_2$ near $1$ concentrates $v_t$ around $\sigma^2$, $\mathbb{E}[m_t^2 / v_t] \approx \mathbb{E}[m_t^2] / \mathbb{E}[v_t]$ gives `AdamW`'s dimensionless step $u_t = m_t / \sqrt{v_t}$ an entrywise RMS of:

$$
\mathrm{RMS}(u_t^{\mathrm{AdamW}}) \approx \sqrt{\frac{\mathbb{E}[m_t^2]}{\mathbb{E}[v_t]}} = \sqrt{\frac{1 - \beta_1}{1 + \beta_1}}
$$

At $\beta_1 = 0.9$, $\sqrt{0.1 / 1.9} \approx 0.229$ ($0.2$–$0.4$ empirically in real LLM runs[@liu2025]).

Multiplying $O_t$ by $0.2\sqrt{\max(A, B)}$ cancels $1/\sqrt{\max(A, B)}$ and pins `Muon`'s entrywise update RMS right around $0.2$ on every matrix shape:

$$
W_t = (1 - \eta \lambda) W_{t-1} - \eta \cdot 0.2\sqrt{\max(A, B)} \, O_t
$$

`Muon` and boundary `AdamW` now **share the exact same learning-rate schedule $\eta_t$ and weight decay $\lambda$** with zero extra tuning.

**Second: why long pretraining runs require decoupled weight decay.**

Without weight decay ($\lambda = 0$), writing $\Delta_t = \eta \cdot 0.2\sqrt{\max(A,B)}\,O_t$, the squared Frobenius norm evolves as:

$$
\|W_t\|_F^2 = \|W_{t-1} - \Delta_t\|_F^2 = \|W_{t-1}\|_F^2 - 2\langle W_{t-1}, \Delta_t \rangle_F + \|\Delta_t\|_F^2
$$

Under noisy late-stage gradients nearly orthogonal to $W_{t-1}$, the positive injection $\|\Delta_t\|_F^2 \approx 0.04 \eta^2 A B$ piles up every step without any restoring pull, driving $\|W_t\|_F$ upward until attention logits overflow.

Adding decoupled decay $(1 - \eta \lambda)W_{t-1}$ supplies $-2\eta\lambda\|W_{t-1}\|_F^2$ of damping each step, stabilizing weights at the bounded equilibrium $\mathrm{RMS}(W_{\mathrm{eq}}) \approx \sqrt{0.02 \eta / \lambda}$[@liu2025].

The three ablations below confirm all three claims: routing vocabulary tables to `Muon` hurts loss; setting `wd = 0` lets $\|W\|_F$ drift linearly; and $0.2\sqrt{\max(A, B)}$ holds update RMS steady at $0.17$–$0.19$ from $64 \times 64$ to $2048 \times 512$.

```plot title="Controlled Ablations: Parameter Routing, Decoupled Weight Decay, and Cross-Shape RMS Alignment" note="Left & center: 360 steps on a 2-layer Mini-Transformer. Right: measured entrywise RMS of Gaussian matrices after 5 Newton-Schulz steps across longer dimension $A=\max(A,B)$ ($64\times 64$ square, then $4:1$ aspect ratio from $256\times 64$ to $2048\times 512$)."
{"cols":3,"narrowCols":1,"legend":[{"label":"Hybrid routing / With WD / $0.2\\sqrt{\\max(A,B)}$ aligned","color":"var(--teal)","shape":"line"},{"label":"Ablation: All-Muon / No WD $\\lambda=0$ / Unscaled $O_t$","color":"var(--clay)","shape":"dash"},{"label":"Clamped aspect scale $\\sqrt{\\max(1, A/B)}$","color":"var(--orange)","shape":"line"}],"data":{"ab":[{"step":1,"loss_hybrid":4.943,"loss_all_muon":5.012,"wnorm_nowd":19.54,"wnorm_wd":19.52},{"step":8,"loss_hybrid":4.329,"loss_all_muon":4.829,"wnorm_nowd":19.65,"wnorm_wd":19.46},{"step":16,"loss_hybrid":3.555,"loss_all_muon":4.589,"wnorm_nowd":19.97,"wnorm_wd":19.58},{"step":24,"loss_hybrid":3.145,"loss_all_muon":4.284,"wnorm_nowd":20.49,"wnorm_wd":19.92},{"step":32,"loss_hybrid":2.921,"loss_all_muon":3.96,"wnorm_nowd":21.0,"wnorm_wd":20.26},{"step":40,"loss_hybrid":2.825,"loss_all_muon":3.703,"wnorm_nowd":21.56,"wnorm_wd":20.65},{"step":48,"loss_hybrid":2.796,"loss_all_muon":3.451,"wnorm_nowd":22.26,"wnorm_wd":21.18},{"step":56,"loss_hybrid":2.773,"loss_all_muon":3.258,"wnorm_nowd":23.01,"wnorm_wd":21.75},{"step":64,"loss_hybrid":2.778,"loss_all_muon":3.123,"wnorm_nowd":23.74,"wnorm_wd":22.31},{"step":72,"loss_hybrid":2.781,"loss_all_muon":3.039,"wnorm_nowd":24.42,"wnorm_wd":22.82},{"step":80,"loss_hybrid":2.775,"loss_all_muon":2.966,"wnorm_nowd":25.06,"wnorm_wd":23.28},{"step":88,"loss_hybrid":2.772,"loss_all_muon":2.906,"wnorm_nowd":25.64,"wnorm_wd":23.67},{"step":96,"loss_hybrid":2.778,"loss_all_muon":2.867,"wnorm_nowd":26.15,"wnorm_wd":23.98},{"step":104,"loss_hybrid":2.771,"loss_all_muon":2.836,"wnorm_nowd":26.58,"wnorm_wd":24.21},{"step":112,"loss_hybrid":2.759,"loss_all_muon":2.811,"wnorm_nowd":26.97,"wnorm_wd":24.4},{"step":120,"loss_hybrid":2.741,"loss_all_muon":2.786,"wnorm_nowd":27.33,"wnorm_wd":24.57},{"step":128,"loss_hybrid":2.732,"loss_all_muon":2.781,"wnorm_nowd":27.68,"wnorm_wd":24.73},{"step":136,"loss_hybrid":2.724,"loss_all_muon":2.769,"wnorm_nowd":28.04,"wnorm_wd":24.88},{"step":144,"loss_hybrid":2.701,"loss_all_muon":2.746,"wnorm_nowd":28.39,"wnorm_wd":25.04},{"step":152,"loss_hybrid":2.683,"loss_all_muon":2.736,"wnorm_nowd":28.75,"wnorm_wd":25.2},{"step":160,"loss_hybrid":2.663,"loss_all_muon":2.725,"wnorm_nowd":29.11,"wnorm_wd":25.37},{"step":168,"loss_hybrid":2.656,"loss_all_muon":2.712,"wnorm_nowd":29.47,"wnorm_wd":25.53},{"step":176,"loss_hybrid":2.65,"loss_all_muon":2.708,"wnorm_nowd":29.85,"wnorm_wd":25.71},{"step":184,"loss_hybrid":2.641,"loss_all_muon":2.704,"wnorm_nowd":30.22,"wnorm_wd":25.87},{"step":192,"loss_hybrid":2.642,"loss_all_muon":2.699,"wnorm_nowd":30.57,"wnorm_wd":26.02},{"step":200,"loss_hybrid":2.636,"loss_all_muon":2.686,"wnorm_nowd":30.91,"wnorm_wd":26.15},{"step":208,"loss_hybrid":2.647,"loss_all_muon":2.701,"wnorm_nowd":31.24,"wnorm_wd":26.27},{"step":216,"loss_hybrid":2.638,"loss_all_muon":2.698,"wnorm_nowd":31.58,"wnorm_wd":26.41},{"step":224,"loss_hybrid":2.656,"loss_all_muon":2.718,"wnorm_nowd":31.95,"wnorm_wd":26.58},{"step":232,"loss_hybrid":2.651,"loss_all_muon":2.72,"wnorm_nowd":32.3,"wnorm_wd":26.72},{"step":240,"loss_hybrid":2.659,"loss_all_muon":2.721,"wnorm_nowd":32.66,"wnorm_wd":26.86},{"step":248,"loss_hybrid":2.662,"loss_all_muon":2.723,"wnorm_nowd":33.01,"wnorm_wd":27.01},{"step":256,"loss_hybrid":2.659,"loss_all_muon":2.729,"wnorm_nowd":33.37,"wnorm_wd":27.17},{"step":264,"loss_hybrid":2.687,"loss_all_muon":2.756,"wnorm_nowd":33.73,"wnorm_wd":27.33},{"step":272,"loss_hybrid":2.679,"loss_all_muon":2.761,"wnorm_nowd":34.07,"wnorm_wd":27.47},{"step":280,"loss_hybrid":2.695,"loss_all_muon":2.777,"wnorm_nowd":34.42,"wnorm_wd":27.61},{"step":288,"loss_hybrid":2.699,"loss_all_muon":2.796,"wnorm_nowd":34.77,"wnorm_wd":27.77},{"step":296,"loss_hybrid":2.689,"loss_all_muon":2.806,"wnorm_nowd":35.1,"wnorm_wd":27.9},{"step":304,"loss_hybrid":2.672,"loss_all_muon":2.814,"wnorm_nowd":35.43,"wnorm_wd":28.0},{"step":312,"loss_hybrid":2.635,"loss_all_muon":2.84,"wnorm_nowd":35.74,"wnorm_wd":28.1},{"step":320,"loss_hybrid":2.619,"loss_all_muon":2.843,"wnorm_nowd":36.06,"wnorm_wd":28.22},{"step":328,"loss_hybrid":2.613,"loss_all_muon":2.864,"wnorm_nowd":36.38,"wnorm_wd":28.33},{"step":336,"loss_hybrid":2.585,"loss_all_muon":2.862,"wnorm_nowd":36.69,"wnorm_wd":28.43},{"step":344,"loss_hybrid":2.594,"loss_all_muon":2.873,"wnorm_nowd":37.02,"wnorm_wd":28.54},{"step":352,"loss_hybrid":2.602,"loss_all_muon":2.895,"wnorm_nowd":37.33,"wnorm_wd":28.65},{"step":360,"loss_hybrid":2.624,"loss_all_muon":2.91,"wnorm_nowd":37.63,"wnorm_wd":28.75}],"rms":[{"order":1,"shape":"64×64","unscaled":0.1088,"keller":0.1088,"moonshot":0.174,"s":"64"},{"order":2,"shape":"256×64","unscaled":0.0539,"keller":0.1079,"moonshot":0.1726,"s":"256"},{"order":3,"shape":"512×128","unscaled":0.0383,"keller":0.0766,"moonshot":0.1733,"s":"512"},{"order":4,"shape":"1024×256","unscaled":0.0298,"keller":0.0596,"moonshot":0.1908,"s":"1k"},{"order":5,"shape":"2048×512","unscaled":0.0211,"keller":0.0422,"moonshot":0.191,"s":"2k"}]},"panels":[{"title":"Routing Ablation · Val Loss","height":250,"narrowHeight":235,"marginBottom":38,"x":{"label":"Step"},"y":{"label":"Val Loss","domain":[2.32,5.1]},"grid":true,"marks":[{"mark":"line","data":"ab","x":"step","y":"loss_all_muon","stroke":"var(--clay)","strokeWidth":2.0,"strokeDasharray":"5 3"},{"mark":"line","data":"ab","x":"step","y":"loss_hybrid","stroke":"var(--teal)","strokeWidth":2.4},{"mark":"text","data":[{"step":355,"y":3.06,"t":"All-Muon rises to 2.91"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"step":355,"y":2.42,"t":"Hybrid 2.62"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"}]},{"title":"Weight Decay · Hidden $\\|W\\|_F$","height":250,"narrowHeight":235,"marginBottom":38,"x":{"label":"Step"},"y":{"label":"Frobenius norm","domain":[18,40]},"grid":true,"marks":[{"mark":"line","data":"ab","x":"step","y":"wnorm_nowd","stroke":"var(--clay)","strokeWidth":2.1,"strokeDasharray":"5 3"},{"mark":"line","data":"ab","x":"step","y":"wnorm_wd","stroke":"var(--teal)","strokeWidth":2.4},{"mark":"text","data":[{"step":355,"y":38.6,"t":"No WD grows to 37.6"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"step":355,"y":23.6,"t":"With WD stabilizes at 28.7"}],"x":"step","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"}]},{"title":"Cross-Shape Update $\\mathrm{RMS}$","height":250,"narrowHeight":235,"marginBottom":38,"x":{"type":"point","domain":["64","256","512","1k","2k"],"label":"Longer matrix side A"},"y":{"label":"Entrywise RMS","domain":[0,0.25]},"grid":true,"marks":[{"mark":"ruleY","data":[0.2],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"line","data":"rms","x":"s","y":"unscaled","stroke":"var(--clay)","strokeWidth":2.0,"strokeDasharray":"5 3"},{"mark":"line","data":"rms","x":"s","y":"keller","stroke":"var(--orange)","strokeWidth":1.9},{"mark":"line","data":"rms","x":"s","y":"moonshot","stroke":"var(--teal)","strokeWidth":2.5},{"mark":"dot","data":"rms","x":"s","y":"moonshot","fill":"var(--teal)","r":3.2,"tip":["shape","moonshot","keller","unscaled"]},{"mark":"text","data":[{"s":"2k","y":0.216,"t":"Moonshot RMS ≈ 0.19"}],"x":"s","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"}]}]}
```

---

## 6. Roofline Arithmetic Intensity and Four-Generation Controlled Benchmark

### 6.1 Why Five Extra Matrix Multiplications Barely Move Wall-Clock Step Time

At first glance, running five matrix-multiplication steps per weight layer sounds far slower than `AdamW`'s scalar arithmetic.

A quick GPU **Roofline** calculation—counting arithmetic intensity in $\text{FLOPs/Byte}$ ($1\;\text{MAC} = 2\;\text{FLOPs}$)—shows why wall-clock overhead is tiny.

Write $m = \min(A, B)$ and $M = \max(A, B)$ for $W \in \mathbb{R}^{A \times B}$, with `float32` master weights and states (4 bytes/entry) in HBM:

1. **Fused `AdamW` is memory-bandwidth bound**. Each step reads $(W, G, M, V)$ and writes $(W, M, V)$—$28 A B$ bytes of HBM traffic for ~12 scalar FLOPs per entry. Its arithmetic intensity is just $0.43\;\text{FLOPs/Byte}$, hundreds of times below a modern GPU's ridge point (~$295\;\text{FLOPs/Byte}$ on H100 `bfloat16` Tensor Cores), while keeping two state buffers in VRAM.
2. **`Muon` runs in the Tensor Core sweet spot at <2% relative FLOPs**. First, `Muon` drops $V$, halving 2D state memory. Second, transposed to $m \times M$ in `bfloat16`, 5 NS steps execute $A_k = X_k X_k^\top$, $A_k^2$, and $B_k X_k$ for at most $(20 + 10 m / M) m A B \le 30 m A B$ FLOPs total.

   At $m = 4096$, those `bfloat16` GEMMs hit $1{,}365$–$2{,}048\;\text{FLOPs/Byte}$, saturating Tensor Cores. Compare that against the $6 N_{\mathrm{tok}} A B$ forward+backward FLOPs of the layer on a global batch of $N_{\mathrm{tok}} = B_{\mathrm{batch}} T$ tokens:

$$
\frac{\mathrm{FLOPs}_{\mathrm{NS5}}}{\mathrm{FLOPs}_{\mathrm{fwd+bwd}}} = \frac{(20 + 10 m / M) m A B}{6 N_{\mathrm{tok}} A B} \le \frac{5 \min(A, B)}{N_{\mathrm{tok}}}
$$

In standard LLM pretraining ($\min(A, B) \in [4{,}096,\; 8{,}192]$ and $N_{\mathrm{tok}} \in [10^6,\; 4 \times 10^6]$), that overhead is a mere **$0.5\%$–$2\%$**[@jordan2024][@liu2025]!

Spending under $2\%$ extra Tensor Core FLOPs to equalize all tail singular subspaces cuts the total training tokens needed to reach the same validation loss by ~**48%** in Moonshot AI's scaling runs[@liu2025].

### 6.2 Controlled Benchmark Across Four Optimizer Generations on a 2-Layer Transformer

To watch all four generations compete on a transparent task, we build a synthetic benchmark combining **Zipf-skewed filler tokens** with **in-context associative recall**.

We set $V = 128$ and $T = 32$. Four random `Key → Value` pairs are planted in the first half of each sequence, followed by Zipfian filler and a query for one `Key`. Answering requires two-layer attention to form an induction-head circuit that locates the matching `Key` and copies its `Value`.

We train the exact same 2-layer, 4-head Mini-Transformer ($D = 64, B = 32$) for 360 steps under `SGD`, `SGD + Momentum`, `AdamW`, and `Muon + AdamW` (with the last two sharing the exact same $\eta = 5 \times 10^{-3}$ and $\lambda = 0.02$):

```plot title="Four Optimizer Generations on a 2-Layer 4-Head Mini-Transformer: Val Loss & Associative Recall" note="Vocab $V=128$, length $T=32$, $D=64$, 4 heads, batch $B=32$; solid curves show 2-seed means and shaded bands show $\pm 1$ SD. Uniform random cross-entropy starts at $\ln(128) \approx 4.85$."
{"cols":2,"narrowCols":1,"xlabel":"Training step (2-layer 4-head Mini-Transformer, Zipf background + associative recall, mean ±1 SD over 2 seeds)","legend":[{"label":"Muon+AdamW hybrid (shared $\\eta = 5\\times 10^{-3}$)","color":"var(--clay)","shape":"line"},{"label":"Full-model AdamW ($\\eta = 5\\times 10^{-3}$)","color":"var(--teal)","shape":"line"},{"label":"SGD + Momentum ($\\eta = 0.15$)","color":"var(--orange)","shape":"dash"},{"label":"Vanilla SGD ($\\eta = 0.25$)","color":"var(--stone)","shape":"dash"}],"data":{"bm":[{"opt":"sgd","step":1,"loss":4.958,"loss_lo":4.942,"loss_hi":4.974,"acc":1.4,"acc_lo":0.7,"acc_hi":2.1},{"opt":"sgd","step":8,"loss":4.44,"loss_lo":4.378,"loss_hi":4.503,"acc":1.9,"acc_lo":1.4,"acc_hi":2.4},{"opt":"sgd","step":16,"loss":3.978,"loss_lo":3.949,"loss_hi":4.007,"acc":1.6,"acc_lo":0.6,"acc_hi":2.5},{"opt":"sgd","step":24,"loss":3.718,"loss_lo":3.691,"loss_hi":3.744,"acc":2.0,"acc_lo":1.0,"acc_hi":2.9},{"opt":"sgd","step":32,"loss":3.558,"loss_lo":3.531,"loss_hi":3.584,"acc":2.6,"acc_lo":2.2,"acc_hi":3.0},{"opt":"sgd","step":40,"loss":3.438,"loss_lo":3.41,"loss_hi":3.467,"acc":4.2,"acc_lo":3.0,"acc_hi":5.4},{"opt":"sgd","step":48,"loss":3.335,"loss_lo":3.304,"loss_hi":3.367,"acc":5.1,"acc_lo":5.0,"acc_hi":5.3},{"opt":"sgd","step":56,"loss":3.241,"loss_lo":3.208,"loss_hi":3.274,"acc":5.0,"acc_lo":4.4,"acc_hi":5.7},{"opt":"sgd","step":64,"loss":3.159,"loss_lo":3.13,"loss_hi":3.188,"acc":6.9,"acc_lo":6.7,"acc_hi":7.0},{"opt":"sgd","step":72,"loss":3.093,"loss_lo":3.066,"loss_hi":3.12,"acc":7.0,"acc_lo":6.5,"acc_hi":7.4},{"opt":"sgd","step":80,"loss":3.036,"loss_lo":3.013,"loss_hi":3.059,"acc":6.1,"acc_lo":5.9,"acc_hi":6.3},{"opt":"sgd","step":88,"loss":2.988,"loss_lo":2.968,"loss_hi":3.008,"acc":7.0,"acc_lo":6.7,"acc_hi":7.2},{"opt":"sgd","step":96,"loss":2.957,"loss_lo":2.942,"loss_hi":2.971,"acc":7.8,"acc_lo":7.4,"acc_hi":8.1},{"opt":"sgd","step":104,"loss":2.923,"loss_lo":2.912,"loss_hi":2.933,"acc":7.4,"acc_lo":6.2,"acc_hi":8.7},{"opt":"sgd","step":112,"loss":2.901,"loss_lo":2.891,"loss_hi":2.911,"acc":7.4,"acc_lo":6.7,"acc_hi":8.1},{"opt":"sgd","step":120,"loss":2.881,"loss_lo":2.876,"loss_hi":2.886,"acc":7.7,"acc_lo":7.2,"acc_hi":8.2},{"opt":"sgd","step":128,"loss":2.87,"loss_lo":2.865,"loss_hi":2.875,"acc":7.3,"acc_lo":6.9,"acc_hi":7.6},{"opt":"sgd","step":136,"loss":2.857,"loss_lo":2.85,"loss_hi":2.863,"acc":6.8,"acc_lo":6.0,"acc_hi":7.7},{"opt":"sgd","step":144,"loss":2.846,"loss_lo":2.841,"loss_hi":2.85,"acc":7.2,"acc_lo":6.3,"acc_hi":8.0},{"opt":"sgd","step":152,"loss":2.838,"loss_lo":2.833,"loss_hi":2.842,"acc":6.5,"acc_lo":6.4,"acc_hi":6.5},{"opt":"sgd","step":160,"loss":2.829,"loss_lo":2.829,"loss_hi":2.83,"acc":8.1,"acc_lo":7.5,"acc_hi":8.7},{"opt":"sgd","step":168,"loss":2.825,"loss_lo":2.824,"loss_hi":2.827,"acc":7.3,"acc_lo":6.6,"acc_hi":8.0},{"opt":"sgd","step":176,"loss":2.822,"loss_lo":2.819,"loss_hi":2.825,"acc":7.2,"acc_lo":6.9,"acc_hi":7.4},{"opt":"sgd","step":184,"loss":2.816,"loss_lo":2.815,"loss_hi":2.816,"acc":7.4,"acc_lo":6.8,"acc_hi":8.0},{"opt":"sgd","step":192,"loss":2.816,"loss_lo":2.815,"loss_hi":2.817,"acc":7.2,"acc_lo":7.0,"acc_hi":7.3},{"opt":"sgd","step":200,"loss":2.809,"loss_lo":2.805,"loss_hi":2.813,"acc":7.9,"acc_lo":7.5,"acc_hi":8.3},{"opt":"sgd","step":208,"loss":2.812,"loss_lo":2.81,"loss_hi":2.815,"acc":7.2,"acc_lo":6.5,"acc_hi":7.8},{"opt":"sgd","step":216,"loss":2.81,"loss_lo":2.803,"loss_hi":2.816,"acc":7.7,"acc_lo":7.6,"acc_hi":7.8},{"opt":"sgd","step":224,"loss":2.803,"loss_lo":2.8,"loss_hi":2.806,"acc":7.5,"acc_lo":7.4,"acc_hi":7.5},{"opt":"sgd","step":232,"loss":2.807,"loss_lo":2.799,"loss_hi":2.815,"acc":6.6,"acc_lo":6.2,"acc_hi":6.9},{"opt":"sgd","step":240,"loss":2.806,"loss_lo":2.804,"loss_hi":2.808,"acc":7.8,"acc_lo":7.0,"acc_hi":8.6},{"opt":"sgd","step":248,"loss":2.798,"loss_lo":2.794,"loss_hi":2.801,"acc":7.9,"acc_lo":7.1,"acc_hi":8.6},{"opt":"sgd","step":256,"loss":2.802,"loss_lo":2.792,"loss_hi":2.811,"acc":8.2,"acc_lo":7.4,"acc_hi":8.9},{"opt":"sgd","step":264,"loss":2.796,"loss_lo":2.795,"loss_hi":2.798,"acc":8.1,"acc_lo":7.3,"acc_hi":8.8},{"opt":"sgd","step":272,"loss":2.795,"loss_lo":2.792,"loss_hi":2.797,"acc":7.0,"acc_lo":6.4,"acc_hi":7.5},{"opt":"sgd","step":280,"loss":2.795,"loss_lo":2.788,"loss_hi":2.802,"acc":8.5,"acc_lo":8.4,"acc_hi":8.6},{"opt":"sgd","step":288,"loss":2.791,"loss_lo":2.787,"loss_hi":2.795,"acc":7.5,"acc_lo":6.6,"acc_hi":8.3},{"opt":"sgd","step":296,"loss":2.792,"loss_lo":2.792,"loss_hi":2.793,"acc":8.1,"acc_lo":7.6,"acc_hi":8.6},{"opt":"sgd","step":304,"loss":2.796,"loss_lo":2.792,"loss_hi":2.8,"acc":8.0,"acc_lo":7.3,"acc_hi":8.7},{"opt":"sgd","step":312,"loss":2.803,"loss_lo":2.791,"loss_hi":2.816,"acc":7.5,"acc_lo":6.9,"acc_hi":8.0},{"opt":"sgd","step":320,"loss":2.788,"loss_lo":2.784,"loss_hi":2.791,"acc":7.9,"acc_lo":7.1,"acc_hi":8.6},{"opt":"sgd","step":328,"loss":2.791,"loss_lo":2.788,"loss_hi":2.794,"acc":6.8,"acc_lo":6.6,"acc_hi":7.0},{"opt":"sgd","step":336,"loss":2.79,"loss_lo":2.787,"loss_hi":2.792,"acc":7.2,"acc_lo":6.5,"acc_hi":7.9},{"opt":"sgd","step":344,"loss":2.788,"loss_lo":2.782,"loss_hi":2.794,"acc":7.5,"acc_lo":7.1,"acc_hi":7.8},{"opt":"sgd","step":352,"loss":2.788,"loss_lo":2.786,"loss_hi":2.79,"acc":7.0,"acc_lo":6.5,"acc_hi":7.5},{"opt":"sgd","step":360,"loss":2.788,"loss_lo":2.782,"loss_hi":2.794,"acc":7.3,"acc_lo":7.0,"acc_hi":7.5},{"opt":"momentum","step":1,"loss":4.985,"loss_lo":4.972,"loss_hi":4.998,"acc":1.1,"acc_lo":0.7,"acc_hi":1.5},{"opt":"momentum","step":8,"loss":4.167,"loss_lo":4.123,"loss_hi":4.212,"acc":1.5,"acc_lo":0.7,"acc_hi":2.3},{"opt":"momentum","step":16,"loss":3.473,"loss_lo":3.42,"loss_hi":3.527,"acc":3.8,"acc_lo":2.2,"acc_hi":5.4},{"opt":"momentum","step":24,"loss":3.125,"loss_lo":3.088,"loss_hi":3.163,"acc":5.7,"acc_lo":5.2,"acc_hi":6.2},{"opt":"momentum","step":32,"loss":2.942,"loss_lo":2.926,"loss_hi":2.957,"acc":7.1,"acc_lo":6.9,"acc_hi":7.3},{"opt":"momentum","step":40,"loss":2.861,"loss_lo":2.856,"loss_hi":2.865,"acc":8.0,"acc_lo":7.2,"acc_hi":8.7},{"opt":"momentum","step":48,"loss":2.829,"loss_lo":2.828,"loss_hi":2.83,"acc":7.2,"acc_lo":6.8,"acc_hi":7.6},{"opt":"momentum","step":56,"loss":2.811,"loss_lo":2.809,"loss_hi":2.812,"acc":6.9,"acc_lo":6.2,"acc_hi":7.5},{"opt":"momentum","step":64,"loss":2.808,"loss_lo":2.803,"loss_hi":2.814,"acc":7.1,"acc_lo":6.2,"acc_hi":8.0},{"opt":"momentum","step":72,"loss":2.804,"loss_lo":2.798,"loss_hi":2.81,"acc":7.4,"acc_lo":7.2,"acc_hi":7.5},{"opt":"momentum","step":80,"loss":2.799,"loss_lo":2.797,"loss_hi":2.801,"acc":8.0,"acc_lo":7.9,"acc_hi":8.0},{"opt":"momentum","step":88,"loss":2.799,"loss_lo":2.795,"loss_hi":2.802,"acc":5.8,"acc_lo":4.7,"acc_hi":6.8},{"opt":"momentum","step":96,"loss":2.798,"loss_lo":2.796,"loss_hi":2.8,"acc":6.9,"acc_lo":6.6,"acc_hi":7.2},{"opt":"momentum","step":104,"loss":2.8,"loss_lo":2.795,"loss_hi":2.805,"acc":8.8,"acc_lo":7.5,"acc_hi":10.1},{"opt":"momentum","step":112,"loss":2.793,"loss_lo":2.791,"loss_hi":2.796,"acc":7.2,"acc_lo":6.2,"acc_hi":8.2},{"opt":"momentum","step":120,"loss":2.792,"loss_lo":2.788,"loss_hi":2.795,"acc":8.0,"acc_lo":7.4,"acc_hi":8.5},{"opt":"momentum","step":128,"loss":2.799,"loss_lo":2.796,"loss_hi":2.802,"acc":6.7,"acc_lo":6.6,"acc_hi":6.7},{"opt":"momentum","step":136,"loss":2.793,"loss_lo":2.788,"loss_hi":2.798,"acc":6.7,"acc_lo":6.6,"acc_hi":6.8},{"opt":"momentum","step":144,"loss":2.794,"loss_lo":2.793,"loss_hi":2.795,"acc":7.5,"acc_lo":7.1,"acc_hi":7.9},{"opt":"momentum","step":152,"loss":2.795,"loss_lo":2.792,"loss_hi":2.799,"acc":6.0,"acc_lo":5.7,"acc_hi":6.2},{"opt":"momentum","step":160,"loss":2.791,"loss_lo":2.785,"loss_hi":2.797,"acc":7.3,"acc_lo":7.1,"acc_hi":7.4},{"opt":"momentum","step":168,"loss":2.793,"loss_lo":2.793,"loss_hi":2.793,"acc":6.7,"acc_lo":6.0,"acc_hi":7.5},{"opt":"momentum","step":176,"loss":2.795,"loss_lo":2.793,"loss_hi":2.798,"acc":6.9,"acc_lo":6.3,"acc_hi":7.5},{"opt":"momentum","step":184,"loss":2.792,"loss_lo":2.789,"loss_hi":2.796,"acc":7.8,"acc_lo":7.7,"acc_hi":7.9},{"opt":"momentum","step":192,"loss":2.794,"loss_lo":2.793,"loss_hi":2.796,"acc":7.4,"acc_lo":6.7,"acc_hi":8.1},{"opt":"momentum","step":200,"loss":2.785,"loss_lo":2.785,"loss_hi":2.785,"acc":7.2,"acc_lo":6.6,"acc_hi":7.8},{"opt":"momentum","step":208,"loss":2.789,"loss_lo":2.786,"loss_hi":2.792,"acc":8.4,"acc_lo":7.6,"acc_hi":9.2},{"opt":"momentum","step":216,"loss":2.795,"loss_lo":2.794,"loss_hi":2.797,"acc":7.6,"acc_lo":7.2,"acc_hi":8.0},{"opt":"momentum","step":224,"loss":2.791,"loss_lo":2.791,"loss_hi":2.791,"acc":7.2,"acc_lo":6.5,"acc_hi":7.8},{"opt":"momentum","step":232,"loss":2.788,"loss_lo":2.786,"loss_hi":2.79,"acc":7.5,"acc_lo":7.5,"acc_hi":7.5},{"opt":"momentum","step":240,"loss":2.79,"loss_lo":2.788,"loss_hi":2.793,"acc":6.8,"acc_lo":6.6,"acc_hi":6.9},{"opt":"momentum","step":248,"loss":2.791,"loss_lo":2.786,"loss_hi":2.796,"acc":8.1,"acc_lo":7.4,"acc_hi":8.7},{"opt":"momentum","step":256,"loss":2.788,"loss_lo":2.786,"loss_hi":2.789,"acc":8.6,"acc_lo":7.8,"acc_hi":9.4},{"opt":"momentum","step":264,"loss":2.787,"loss_lo":2.787,"loss_hi":2.787,"acc":7.2,"acc_lo":7.0,"acc_hi":7.3},{"opt":"momentum","step":272,"loss":2.787,"loss_lo":2.783,"loss_hi":2.79,"acc":7.2,"acc_lo":6.4,"acc_hi":8.0},{"opt":"momentum","step":280,"loss":2.785,"loss_lo":2.784,"loss_hi":2.787,"acc":8.3,"acc_lo":8.2,"acc_hi":8.3},{"opt":"momentum","step":288,"loss":2.788,"loss_lo":2.78,"loss_hi":2.796,"acc":7.1,"acc_lo":6.5,"acc_hi":7.6},{"opt":"momentum","step":296,"loss":2.787,"loss_lo":2.783,"loss_hi":2.791,"acc":7.1,"acc_lo":6.2,"acc_hi":8.0},{"opt":"momentum","step":304,"loss":2.791,"loss_lo":2.788,"loss_hi":2.795,"acc":8.0,"acc_lo":7.3,"acc_hi":8.7},{"opt":"momentum","step":312,"loss":2.792,"loss_lo":2.786,"loss_hi":2.797,"acc":6.8,"acc_lo":6.3,"acc_hi":7.2},{"opt":"momentum","step":320,"loss":2.787,"loss_lo":2.784,"loss_hi":2.79,"acc":7.2,"acc_lo":6.9,"acc_hi":7.5},{"opt":"momentum","step":328,"loss":2.8,"loss_lo":2.795,"loss_hi":2.804,"acc":7.0,"acc_lo":6.1,"acc_hi":7.9},{"opt":"momentum","step":336,"loss":2.783,"loss_lo":2.782,"loss_hi":2.785,"acc":7.0,"acc_lo":6.2,"acc_hi":7.8},{"opt":"momentum","step":344,"loss":2.789,"loss_lo":2.784,"loss_hi":2.794,"acc":7.4,"acc_lo":7.3,"acc_hi":7.5},{"opt":"momentum","step":352,"loss":2.784,"loss_lo":2.78,"loss_hi":2.788,"acc":7.6,"acc_lo":7.0,"acc_hi":8.1},{"opt":"momentum","step":360,"loss":2.787,"loss_lo":2.781,"loss_hi":2.793,"acc":7.4,"acc_lo":7.4,"acc_hi":7.4},{"opt":"adamw","step":1,"loss":4.726,"loss_lo":4.707,"loss_hi":4.745,"acc":2.6,"acc_lo":2.2,"acc_hi":2.9},{"opt":"adamw","step":8,"loss":3.602,"loss_lo":3.593,"loss_hi":3.611,"acc":4.1,"acc_lo":3.2,"acc_hi":5.0},{"opt":"adamw","step":16,"loss":2.963,"loss_lo":2.936,"loss_hi":2.99,"acc":6.5,"acc_lo":6.0,"acc_hi":7.0},{"opt":"adamw","step":24,"loss":2.822,"loss_lo":2.817,"loss_hi":2.826,"acc":5.3,"acc_lo":4.1,"acc_hi":6.5},{"opt":"adamw","step":32,"loss":2.796,"loss_lo":2.789,"loss_hi":2.803,"acc":7.1,"acc_lo":5.7,"acc_hi":8.5},{"opt":"adamw","step":40,"loss":2.789,"loss_lo":2.785,"loss_hi":2.792,"acc":6.4,"acc_lo":4.2,"acc_hi":8.6},{"opt":"adamw","step":48,"loss":2.786,"loss_lo":2.786,"loss_hi":2.787,"acc":6.4,"acc_lo":6.3,"acc_hi":6.5},{"opt":"adamw","step":56,"loss":2.783,"loss_lo":2.782,"loss_hi":2.784,"acc":6.2,"acc_lo":5.4,"acc_hi":7.1},{"opt":"adamw","step":64,"loss":2.79,"loss_lo":2.784,"loss_hi":2.796,"acc":6.0,"acc_lo":4.0,"acc_hi":7.9},{"opt":"adamw","step":72,"loss":2.783,"loss_lo":2.78,"loss_hi":2.787,"acc":5.5,"acc_lo":5.1,"acc_hi":6.0},{"opt":"adamw","step":80,"loss":2.78,"loss_lo":2.779,"loss_hi":2.781,"acc":7.2,"acc_lo":5.8,"acc_hi":8.6},{"opt":"adamw","step":88,"loss":2.785,"loss_lo":2.784,"loss_hi":2.786,"acc":8.0,"acc_lo":7.2,"acc_hi":8.7},{"opt":"adamw","step":96,"loss":2.787,"loss_lo":2.784,"loss_hi":2.791,"acc":8.9,"acc_lo":6.9,"acc_hi":10.8},{"opt":"adamw","step":104,"loss":2.776,"loss_lo":2.775,"loss_hi":2.777,"acc":10.0,"acc_lo":7.5,"acc_hi":12.4},{"opt":"adamw","step":112,"loss":2.785,"loss_lo":2.773,"loss_hi":2.796,"acc":9.3,"acc_lo":6.6,"acc_hi":11.9},{"opt":"adamw","step":120,"loss":2.774,"loss_lo":2.763,"loss_hi":2.785,"acc":10.6,"acc_lo":6.8,"acc_hi":14.4},{"opt":"adamw","step":128,"loss":2.778,"loss_lo":2.77,"loss_hi":2.786,"acc":9.3,"acc_lo":5.3,"acc_hi":13.3},{"opt":"adamw","step":136,"loss":2.775,"loss_lo":2.773,"loss_hi":2.776,"acc":11.8,"acc_lo":6.7,"acc_hi":16.8},{"opt":"adamw","step":144,"loss":2.767,"loss_lo":2.76,"loss_hi":2.774,"acc":11.5,"acc_lo":6.9,"acc_hi":16.1},{"opt":"adamw","step":152,"loss":2.772,"loss_lo":2.77,"loss_hi":2.775,"acc":13.1,"acc_lo":7.0,"acc_hi":19.1},{"opt":"adamw","step":160,"loss":2.766,"loss_lo":2.749,"loss_hi":2.784,"acc":13.1,"acc_lo":7.8,"acc_hi":18.5},{"opt":"adamw","step":168,"loss":2.765,"loss_lo":2.747,"loss_hi":2.783,"acc":14.2,"acc_lo":7.4,"acc_hi":20.9},{"opt":"adamw","step":176,"loss":2.76,"loss_lo":2.75,"loss_hi":2.771,"acc":15.0,"acc_lo":8.8,"acc_hi":21.3},{"opt":"adamw","step":184,"loss":2.757,"loss_lo":2.735,"loss_hi":2.778,"acc":17.3,"acc_lo":11.0,"acc_hi":23.5},{"opt":"adamw","step":192,"loss":2.745,"loss_lo":2.729,"loss_hi":2.761,"acc":18.5,"acc_lo":12.8,"acc_hi":24.1},{"opt":"adamw","step":200,"loss":2.734,"loss_lo":2.717,"loss_hi":2.751,"acc":19.4,"acc_lo":14.6,"acc_hi":24.2},{"opt":"adamw","step":208,"loss":2.74,"loss_lo":2.717,"loss_hi":2.762,"acc":18.6,"acc_lo":13.5,"acc_hi":23.7},{"opt":"adamw","step":216,"loss":2.721,"loss_lo":2.696,"loss_hi":2.746,"acc":21.3,"acc_lo":16.0,"acc_hi":26.6},{"opt":"adamw","step":224,"loss":2.728,"loss_lo":2.709,"loss_hi":2.746,"acc":19.9,"acc_lo":14.9,"acc_hi":24.8},{"opt":"adamw","step":232,"loss":2.719,"loss_lo":2.694,"loss_hi":2.743,"acc":21.8,"acc_lo":18.1,"acc_hi":25.5},{"opt":"adamw","step":240,"loss":2.713,"loss_lo":2.691,"loss_hi":2.734,"acc":21.9,"acc_lo":18.6,"acc_hi":25.3},{"opt":"adamw","step":248,"loss":2.709,"loss_lo":2.684,"loss_hi":2.735,"acc":22.5,"acc_lo":19.1,"acc_hi":25.9},{"opt":"adamw","step":256,"loss":2.701,"loss_lo":2.669,"loss_hi":2.734,"acc":22.3,"acc_lo":17.2,"acc_hi":27.4},{"opt":"adamw","step":264,"loss":2.705,"loss_lo":2.687,"loss_hi":2.724,"acc":23.7,"acc_lo":21.2,"acc_hi":26.2},{"opt":"adamw","step":272,"loss":2.702,"loss_lo":2.677,"loss_hi":2.726,"acc":23.9,"acc_lo":20.9,"acc_hi":26.9},{"opt":"adamw","step":280,"loss":2.696,"loss_lo":2.674,"loss_hi":2.718,"acc":23.2,"acc_lo":19.8,"acc_hi":26.6},{"opt":"adamw","step":288,"loss":2.705,"loss_lo":2.678,"loss_hi":2.733,"acc":21.7,"acc_lo":18.5,"acc_hi":25.0},{"opt":"adamw","step":296,"loss":2.705,"loss_lo":2.678,"loss_hi":2.733,"acc":23.3,"acc_lo":20.7,"acc_hi":25.9},{"opt":"adamw","step":304,"loss":2.695,"loss_lo":2.666,"loss_hi":2.725,"acc":24.7,"acc_lo":23.1,"acc_hi":26.3},{"opt":"adamw","step":312,"loss":2.705,"loss_lo":2.683,"loss_hi":2.726,"acc":24.1,"acc_lo":21.7,"acc_hi":26.6},{"opt":"adamw","step":320,"loss":2.689,"loss_lo":2.674,"loss_hi":2.703,"acc":24.0,"acc_lo":21.5,"acc_hi":26.5},{"opt":"adamw","step":328,"loss":2.693,"loss_lo":2.685,"loss_hi":2.702,"acc":25.0,"acc_lo":23.8,"acc_hi":26.1},{"opt":"adamw","step":336,"loss":2.677,"loss_lo":2.661,"loss_hi":2.692,"acc":25.9,"acc_lo":24.4,"acc_hi":27.3},{"opt":"adamw","step":344,"loss":2.684,"loss_lo":2.667,"loss_hi":2.701,"acc":25.5,"acc_lo":22.5,"acc_hi":28.5},{"opt":"adamw","step":352,"loss":2.687,"loss_lo":2.668,"loss_hi":2.707,"acc":24.5,"acc_lo":22.9,"acc_hi":26.0},{"opt":"adamw","step":360,"loss":2.698,"loss_lo":2.682,"loss_hi":2.713,"acc":23.7,"acc_lo":22.0,"acc_hi":25.5},{"opt":"muon_hybrid","step":1,"loss":4.929,"loss_lo":4.915,"loss_hi":4.944,"acc":1.5,"acc_lo":0.6,"acc_hi":2.4},{"opt":"muon_hybrid","step":8,"loss":4.269,"loss_lo":4.211,"loss_hi":4.327,"acc":5.8,"acc_lo":5.8,"acc_hi":5.8},{"opt":"muon_hybrid","step":16,"loss":3.487,"loss_lo":3.428,"loss_hi":3.547,"acc":6.4,"acc_lo":6.0,"acc_hi":6.8},{"opt":"muon_hybrid","step":24,"loss":3.119,"loss_lo":3.09,"loss_hi":3.148,"acc":6.1,"acc_lo":5.5,"acc_hi":6.6},{"opt":"muon_hybrid","step":32,"loss":2.917,"loss_lo":2.913,"loss_hi":2.922,"acc":8.1,"acc_lo":7.0,"acc_hi":9.2},{"opt":"muon_hybrid","step":40,"loss":2.829,"loss_lo":2.826,"loss_hi":2.832,"acc":8.2,"acc_lo":6.9,"acc_hi":9.4},{"opt":"muon_hybrid","step":48,"loss":2.798,"loss_lo":2.797,"loss_hi":2.798,"acc":7.2,"acc_lo":6.9,"acc_hi":7.5},{"opt":"muon_hybrid","step":56,"loss":2.775,"loss_lo":2.774,"loss_hi":2.776,"acc":7.2,"acc_lo":7.0,"acc_hi":7.4},{"opt":"muon_hybrid","step":64,"loss":2.786,"loss_lo":2.778,"loss_hi":2.794,"acc":7.2,"acc_lo":6.9,"acc_hi":7.4},{"opt":"muon_hybrid","step":72,"loss":2.779,"loss_lo":2.775,"loss_hi":2.782,"acc":8.1,"acc_lo":7.3,"acc_hi":8.9},{"opt":"muon_hybrid","step":80,"loss":2.773,"loss_lo":2.771,"loss_hi":2.775,"acc":9.0,"acc_lo":8.6,"acc_hi":9.5},{"opt":"muon_hybrid","step":88,"loss":2.774,"loss_lo":2.772,"loss_hi":2.776,"acc":8.3,"acc_lo":8.2,"acc_hi":8.3},{"opt":"muon_hybrid","step":96,"loss":2.772,"loss_lo":2.768,"loss_hi":2.777,"acc":10.6,"acc_lo":9.6,"acc_hi":11.6},{"opt":"muon_hybrid","step":104,"loss":2.767,"loss_lo":2.765,"loss_hi":2.77,"acc":12.9,"acc_lo":12.0,"acc_hi":13.9},{"opt":"muon_hybrid","step":112,"loss":2.758,"loss_lo":2.758,"loss_hi":2.758,"acc":13.8,"acc_lo":12.0,"acc_hi":15.5},{"opt":"muon_hybrid","step":120,"loss":2.744,"loss_lo":2.739,"loss_hi":2.749,"acc":19.3,"acc_lo":17.5,"acc_hi":21.2},{"opt":"muon_hybrid","step":128,"loss":2.731,"loss_lo":2.73,"loss_hi":2.731,"acc":21.0,"acc_lo":19.5,"acc_hi":22.5},{"opt":"muon_hybrid","step":136,"loss":2.721,"loss_lo":2.718,"loss_hi":2.725,"acc":22.3,"acc_lo":21.5,"acc_hi":23.0},{"opt":"muon_hybrid","step":144,"loss":2.705,"loss_lo":2.703,"loss_hi":2.708,"acc":23.6,"acc_lo":22.0,"acc_hi":25.3},{"opt":"muon_hybrid","step":152,"loss":2.692,"loss_lo":2.687,"loss_hi":2.697,"acc":24.3,"acc_lo":23.5,"acc_hi":25.1},{"opt":"muon_hybrid","step":160,"loss":2.681,"loss_lo":2.67,"loss_hi":2.692,"acc":26.8,"acc_lo":25.0,"acc_hi":28.6},{"opt":"muon_hybrid","step":168,"loss":2.676,"loss_lo":2.667,"loss_hi":2.684,"acc":26.1,"acc_lo":25.3,"acc_hi":27.0},{"opt":"muon_hybrid","step":176,"loss":2.67,"loss_lo":2.662,"loss_hi":2.677,"acc":26.7,"acc_lo":25.9,"acc_hi":27.5},{"opt":"muon_hybrid","step":184,"loss":2.667,"loss_lo":2.657,"loss_hi":2.676,"acc":24.9,"acc_lo":23.8,"acc_hi":26.0},{"opt":"muon_hybrid","step":192,"loss":2.663,"loss_lo":2.662,"loss_hi":2.664,"acc":26.3,"acc_lo":24.7,"acc_hi":27.9},{"opt":"muon_hybrid","step":200,"loss":2.656,"loss_lo":2.655,"loss_hi":2.658,"acc":27.1,"acc_lo":26.6,"acc_hi":27.6},{"opt":"muon_hybrid","step":208,"loss":2.665,"loss_lo":2.66,"loss_hi":2.67,"acc":28.2,"acc_lo":27.9,"acc_hi":28.4},{"opt":"muon_hybrid","step":216,"loss":2.661,"loss_lo":2.659,"loss_hi":2.662,"acc":30.1,"acc_lo":28.1,"acc_hi":32.1},{"opt":"muon_hybrid","step":224,"loss":2.676,"loss_lo":2.669,"loss_hi":2.683,"acc":30.1,"acc_lo":26.5,"acc_hi":33.7},{"opt":"muon_hybrid","step":232,"loss":2.67,"loss_lo":2.658,"loss_hi":2.682,"acc":32.6,"acc_lo":27.1,"acc_hi":38.1},{"opt":"muon_hybrid","step":240,"loss":2.667,"loss_lo":2.644,"loss_hi":2.691,"acc":36.2,"acc_lo":28.2,"acc_hi":44.2},{"opt":"muon_hybrid","step":248,"loss":2.668,"loss_lo":2.638,"loss_hi":2.699,"acc":40.0,"acc_lo":29.8,"acc_hi":50.3},{"opt":"muon_hybrid","step":256,"loss":2.655,"loss_lo":2.605,"loss_hi":2.705,"acc":45.1,"acc_lo":30.1,"acc_hi":60.1},{"opt":"muon_hybrid","step":264,"loss":2.66,"loss_lo":2.584,"loss_hi":2.736,"acc":50.1,"acc_lo":29.1,"acc_hi":71.2},{"opt":"muon_hybrid","step":272,"loss":2.651,"loss_lo":2.569,"loss_hi":2.733,"acc":55.7,"acc_lo":30.7,"acc_hi":80.7},{"opt":"muon_hybrid","step":280,"loss":2.658,"loss_lo":2.557,"loss_hi":2.759,"acc":57.7,"acc_lo":31.0,"acc_hi":84.5},{"opt":"muon_hybrid","step":288,"loss":2.663,"loss_lo":2.552,"loss_hi":2.773,"acc":59.7,"acc_lo":32.1,"acc_hi":87.2},{"opt":"muon_hybrid","step":296,"loss":2.675,"loss_lo":2.559,"loss_hi":2.791,"acc":61.7,"acc_lo":33.6,"acc_hi":89.7},{"opt":"muon_hybrid","step":304,"loss":2.677,"loss_lo":2.557,"loss_hi":2.797,"acc":64.6,"acc_lo":38.0,"acc_hi":91.2},{"opt":"muon_hybrid","step":312,"loss":2.687,"loss_lo":2.586,"loss_hi":2.787,"acc":66.2,"acc_lo":39.8,"acc_hi":92.5},{"opt":"muon_hybrid","step":320,"loss":2.696,"loss_lo":2.596,"loss_hi":2.797,"acc":68.5,"acc_lo":44.4,"acc_hi":92.6},{"opt":"muon_hybrid","step":328,"loss":2.711,"loss_lo":2.614,"loss_hi":2.809,"acc":68.2,"acc_lo":45.7,"acc_hi":90.6},{"opt":"muon_hybrid","step":336,"loss":2.72,"loss_lo":2.638,"loss_hi":2.803,"acc":70.7,"acc_lo":50.3,"acc_hi":91.0},{"opt":"muon_hybrid","step":344,"loss":2.739,"loss_lo":2.664,"loss_hi":2.814,"acc":72.4,"acc_lo":54.1,"acc_hi":90.6},{"opt":"muon_hybrid","step":352,"loss":2.758,"loss_lo":2.69,"loss_hi":2.825,"acc":74.1,"acc_lo":56.3,"acc_hi":91.9},{"opt":"muon_hybrid","step":360,"loss":2.778,"loss_lo":2.723,"loss_hi":2.833,"acc":77.0,"acc_lo":62.2,"acc_hi":91.8}]},"panels":[{"title":"Validation Cross-Entropy Loss","height":270,"narrowHeight":235,"x":{"label":null,"domain":[0,365]},"y":{"label":"Val Loss","domain":[2.45,5.2]},"grid":true,"marks":[{"mark":"ruleY","data":[4.852],"stroke":"var(--stone)","strokeDasharray":"3 3"},{"mark":"text","data":[{"x":358,"y":5.04,"t":"Uniform random ln(128) = 4.85"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--muted)"},{"mark":"areaY","data":"bm","filter":{"opt":"adamw"},"x":"step","y1":"loss_lo","y2":"loss_hi","fill":"var(--teal)","fillOpacity":0.14},{"mark":"areaY","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y1":"loss_lo","y2":"loss_hi","fill":"var(--clay)","fillOpacity":0.15},{"mark":"line","data":"bm","filter":{"opt":"sgd"},"x":"step","y":"loss","stroke":"var(--stone)","strokeWidth":1.8,"strokeDasharray":"5 4"},{"mark":"line","data":"bm","filter":{"opt":"momentum"},"x":"step","y":"loss","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"bm","filter":{"opt":"adamw"},"x":"step","y":"loss","stroke":"var(--teal)","strokeWidth":2.2},{"mark":"line","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"loss","stroke":"var(--clay)","strokeWidth":2.5},{"mark":"dot","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"loss","fill":"var(--clay)","r":2.0,"tip":["step","loss"]}]},{"title":"Associative Recall Accuracy (%)","height":270,"narrowHeight":235,"x":{"label":null,"domain":[0,365]},"y":{"label":"Recall (%)","domain":[-3,100]},"grid":true,"marks":[{"mark":"areaY","data":"bm","filter":{"opt":"adamw"},"x":"step","y1":"acc_lo","y2":"acc_hi","fill":"var(--teal)","fillOpacity":0.15},{"mark":"areaY","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y1":"acc_lo","y2":"acc_hi","fill":"var(--clay)","fillOpacity":0.16},{"mark":"line","data":"bm","filter":{"opt":"sgd"},"x":"step","y":"acc","stroke":"var(--stone)","strokeWidth":1.8,"strokeDasharray":"5 4"},{"mark":"line","data":"bm","filter":{"opt":"momentum"},"x":"step","y":"acc","stroke":"var(--orange)","strokeWidth":1.8,"strokeDasharray":"5 3"},{"mark":"line","data":"bm","filter":{"opt":"adamw"},"x":"step","y":"acc","stroke":"var(--teal)","strokeWidth":2.2},{"mark":"line","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"acc","stroke":"var(--clay)","strokeWidth":2.6},{"mark":"dot","data":"bm","filter":{"opt":"muon_hybrid"},"x":"step","y":"acc","fill":"var(--clay)","r":2.2,"tip":["step","acc"]},{"mark":"text","data":[{"x":358,"y":82,"t":"Muon+AdamW 77.0%"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--clay)"},{"mark":"text","data":[{"x":358,"y":15,"t":"Full AdamW 23.7%"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--teal)"},{"mark":"text","data":[{"x":358,"y":2,"t":"SGD / Momentum 7.4%"}],"x":"x","y":"y","text":"t","textAnchor":"end","fill":"var(--muted)"}]}]}
```

Every phase of these curves echoes our derivations.

In the first 50 steps, all four optimizers quickly fit high-probability Zipfian unigram frequencies, pulling loss down from $4.85$ to ~$2.80$. Past step 50, their paths diverge sharply.

`SGD` and `Momentum` stay swamped by dominant filler gradients, leaving low-singular-value induction-head circuits stalled at $7.3\%$–$7.4\%$ recall. `AdamW` slowly begins aligning subspaces after step 150, reaching $23.7\%$ at step 360.

`Muon + AdamW`, by contrast, crosses the induction phase transition around step 120 and climbs to **$77.0\%$** recall! (Its mild validation-loss uptick past step 250 simply reflects slight overfitting on fixed-corpus filler tokens while associative recall keeps rising.)

---

## 7. Complete Single-File PyTorch Implementation: Mini-Transformer with `Muon + AdamW`

The self-contained PyTorch script below wires every piece together—mixed-precision-safe `RMSNorm`, multi-head causal attention, 5-step Newton-Schulz orthogonalization, Moonshot RMS-aligned `Muon`, induced-norm parameter routing, and a 50-step training loop:

```python
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import TensorDataset, DataLoader


# =====================================================================
# 1. Quintic Newton-Schulz Iteration & Custom Muon Optimizer
# =====================================================================
def zeropower_via_newtonschulz5(G: torch.Tensor, steps: int = 5, eps: float = 1e-7) -> torch.Tensor:
    """Map G = U * Sigma * V^T to approximate semi-orthogonal U * V^T in 5 matmul steps."""
    assert G.ndim == 2, "Newton-Schulz orthogonalization applies only to 2D matrix parameters"
    a, b, c = (3.4445, -4.7750, 2.0315)
    X = G.bfloat16() if G.is_cuda else G.float()

    # Pre-normalize by Frobenius norm so all initial singular values lie in [0, 1]
    X = X / (X.norm() + eps)

    # Transpose tall matrices (A > B) so A_k = X @ X.T has smaller shape B x B
    transposed = False
    if X.size(0) > X.size(1):
        X = X.T
        transposed = True

    # Odd matrix polynomial recurrence: X_{k+1} = a * X_k + (b * A_k + c * A_k^2) * X_k
    for _ in range(steps):
        A = X @ X.T
        B = b * A + c * (A @ A)
        X = a * X + B @ X

    if transposed:
        X = X.T
    return X.to(G.dtype)


class Muon(torch.optim.Optimizer):
    """Muon optimizer for internal 2D Transformer matrices (with decoupled WD & RMS scaling)."""
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
                G = W.grad  # 2D gradient matrix of shape (d_out, d_in) matching W

                # Only first-moment momentum M is stored; no second-moment buffer V is needed
                state = self.state[W]
                if "momentum_buffer" not in state:
                    state["momentum_buffer"] = torch.zeros_like(G)
                M = state["momentum_buffer"]

                # 1. Nesterov lookahead momentum: M_t = mu * M_{t-1} + G_t, tilde_M = G_t + mu * M_t
                M.mul_(mu).add_(G)
                tilde_M = G + mu * M

                # 2. 5-step Newton-Schulz orthogonalization
                O_t = zeropower_via_newtonschulz5(tilde_M, steps=5)

                # 3. Decoupled weight decay: W <- (1 - lr * wd) * W
                if wd != 0:
                    W.mul_(1.0 - lr * wd)

                # 4. Entrywise update RMS alignment (moonshot mode shares AdamW's lr directly)
                A, B = W.size(0), W.size(1)
                scale = 0.2 * (max(A, B) ** 0.5) if scale_mode == "moonshot" else max(1.0, A / B) ** 0.5
                W.add_(O_t, alpha=-lr * scale)
        return loss


# =====================================================================
# 2. Mini-Transformer Language Model Definition
# =====================================================================
class RMSNorm(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(dim))  # 1D gain (dim,) -> AdamW (wd=0)
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

        # Boundary discrete lookup tables -> AdamW
        self.tok_emb = nn.Embedding(vocab_size, d_model)
        self.pos_emb = nn.Embedding(max_len, d_model)

        # Internal 2D attention projections (.weight shape (64, 64)) -> Muon
        self.norm1 = RMSNorm(d_model)
        self.W_q = nn.Linear(d_model, d_model, bias=False)
        self.W_k = nn.Linear(d_model, d_model, bias=False)
        self.W_v = nn.Linear(d_model, d_model, bias=False)
        self.W_o = nn.Linear(d_model, d_model, bias=False)

        # Internal 2D FFN layers (W_up: (256, 64), W_down: (64, 256)) -> Muon
        self.norm2 = RMSNorm(d_model)
        self.W_up   = nn.Linear(d_model, 4 * d_model, bias=False)
        self.W_down = nn.Linear(4 * d_model, d_model, bias=False)

        # Output vocabulary head (1000, 64) -> AdamW
        self.norm_final = RMSNorm(d_model)
        self.lm_head = nn.Linear(d_model, vocab_size, bias=False)

    def forward(self, idx: torch.Tensor) -> torch.Tensor:
        B, T = idx.shape
        pos = torch.arange(0, T, device=idx.device)

        # (B, T, D) + (T, D) [broadcast across batch] -> (B, T, D)
        x = self.tok_emb(idx) + self.pos_emb(pos)

        # Sublayer 1: Pre-RMSNorm + Multi-Head Causal Self-Attention
        h = self.norm1(x)
        q = self.W_q(h).view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        k = self.W_k(h).view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        v = self.W_v(h).view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        attn_out = F.scaled_dot_product_attention(q, k, v, is_causal=True)
        attn_out = attn_out.transpose(1, 2).contiguous().view(B, T, self.d_model)
        x = x + self.W_o(attn_out)

        # Sublayer 2: Pre-RMSNorm + SiLU Feed-Forward Network
        h = self.norm2(x)
        x = x + self.W_down(F.silu(self.W_up(h)))

        return self.lm_head(self.norm_final(x))


# =====================================================================
# 3. Parameter Routing & 1-Epoch (50 Steps) Training Loop
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

    # 1,000 modulo-1000 counting sequences, batch_size=20 -> 1 Epoch = 50 Steps
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

        logits = model(x_batch)                                                # 1. Forward pass
        loss = F.cross_entropy(logits.reshape(-1, 1000), y_batch.reshape(-1))  # 2. Cross-entropy loss
        opt_muon.zero_grad(); opt_adamw.zero_grad()                            # 3. Clear stale grads
        loss.backward()                                                        # 4. Backward contraction
        opt_muon.step(); opt_adamw.step()                                      # 5. Dual-optimizer step

        if step == 1 or step % 10 == 0:
            print(f"Epoch 1 | Step [{step:2d}/50] | Loss: {loss.item():.4f}")
```

Running this script drops cross-entropy smoothly from near the uniform random baseline $\ln(1000) \approx 6.91$:

```text
Epoch 1 | Step [ 1/50] | Loss: 7.1004
Epoch 1 | Step [10/50] | Loss: 6.7182
Epoch 1 | Step [20/50] | Loss: 6.2750
Epoch 1 | Step [30/50] | Loss: 5.7630
Epoch 1 | Step [40/50] | Loss: 5.0782
Epoch 1 | Step [50/50] | Loss: 4.5468
```

---

## Summary: Modern Optimizer Evolution at a Glance

Looking back across all seven sections, the arc from scalar gradient descent to modern hybrid LLM optimizers answers three successive questions:

1. **How do we smooth gradient noise and canyon oscillation with history?** (`SGD` $\to$ `Momentum` / Nesterov lookahead)
2. **How do we decouple weight shrinkage from adaptive preconditioning?** (`Adam + L2` $\to$ `AdamW`)
3. **How do we match each layer's update norm to the true geometry of its input and output spaces?** (boundary tables on `AdamW`, internal $\mathrm{RMS}\to\mathrm{RMS}$ operators on `Muon`)

```data title="Summary of Five Optimizer Generations: Update Signals, Implicit Norms, and Benchmark Recall" bars="Recall" mark="Muon+AdamW" note="Recall comes from the Section 6 2-layer 4-head Mini-Transformer associative recall benchmark at step 360 (Adam+L2 is omitted from that run since its decay distortion is isolated in Section 3.4)."
Optimizer | Update Signal & Transform | Weight Decay | Implicit Norm Ball | Recall
SGD (+L2) | $g_t$ (scalar step) | Coupled $g_t + \lambda\theta$ | $\|\Delta\theta\|_2$ | 7.3%
Momentum | $m_t$ (heavy-ball EMA) | Coupled $g_t + \lambda\theta$ | $\|\Delta\theta\|_2$ + inertia | 7.4%
Adam (+L2) | $\hat{m}_t / (\sqrt{\hat{v}_t} + \epsilon)$ | Distorted by $\sqrt{\hat{v}_t}$ | $\|\Delta\theta\|_\infty$ | —
AdamW | $\hat{m}_t / (\sqrt{\hat{v}_t} + \epsilon)$ | Decoupled $(1-\eta\lambda)\theta$ | $\|\Delta\theta\|_\infty$ | 23.7%
Muon+AdamW | $\tilde{M}_t$ via 5-step NS5 | Decoupled $(1-\eta\lambda)W$ | $\|\Delta W\|_{\mathrm{RMS}\to\mathrm{RMS}}$ | 77.0%
```

Hold onto this single thread—**four tensor lifetimes in VRAM $\to$ rank-one outer-product gradients $G = \Delta^\top X$ that skew singular spectra $\to$ the induced-norm split between `Muon` and `AdamW`**. Open `modded-nanogpt`, `Moonlight`, or any modern pretraining codebase next, and every matrix transpose, `bfloat16` cast, and $0.2\sqrt{\max(A, B)}$ scaling factor reads as a direct consequence of linear algebra.

## References

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

## System Mental Map: Static Parameters Across Inference and Training Dataflows

An LLM itself is simply a fixed set of **static parameter matrices $\Theta$** persisted on disk and in VRAM — boundary tables $E_{\mathrm{tok}}, W_{\mathrm{head}}$, $L$ layers of 2D operators $W_{q,k,v,o}, W_{\mathrm{up}}, W_{\mathrm{down}}$, and 1D gain vectors $\gamma$. Two distinct dataflows operate around this single $\Theta$:

1. **Inference is a read-only one-way pipeline**: $\Theta$ stays frozen; prompt tokens first pass through a parallel **{{c1::Prefill}}** GEMM stage that is compute-bound to populate the historical `KV Cache`, after which **{{c1::Decode}}** feeds one $1 \times D$ token row per step via matrix-vector products that are **{{c2::memory-bandwidth}}**-bound, freeing transient activations immediately.
2. **Training is a parameter-mutating four-step closed loop**: **Forward** runs full-sequence parallel GEMMs while stashing layer activations $X$ $\to$ **Loss** reduces predictions to a single scalar $L$ $\to$ **Backward** contracts axes to produce same-shape gradients $G$ $\to$ **Optimizer Step** mutates $\Theta$ by geometric role, routing boundary tables and 1D gains to **{{c3::AdamW}}** and internal 2D linear operators — over $95\%$ of non-embedding weights — to **{{c3::Muon}}**.

Extra

Big-picture anchor: before reading any LLM systems code, ask which dataflow you are in. Inference spends VRAM on the `KV Cache` to avoid recomputing prefix keys/values and stalls on HBM bandwidth during 1-row decoding; training spends several-fold VRAM on stashed activations and optimizer states to unlock full-sequence GEMM parallelism while battling singular-spectrum ill-conditioning.

type: cloze
tags: ML/LLM ML/Architecture ML/Systems ML/BigPicture
uuid: d9c5d7cd-4cb8-42ea-b2c3-53a8417dbf58

---

## Four Tensor Families in VRAM: Lifetimes and Diagnostic Boundaries

Across Transformer inference and training, arrays casually lumped together as "matrices" divide strictly into four lifecycle families:

1. **{{c1::Static parameter matrices $\Theta$}}** — weights such as $E_{\mathrm{tok}}, W_{q,k,v,o}, W_{\mathrm{up}}, W_{\mathrm{down}}, W_{\mathrm{head}}$ whose shapes depend solely on architecture hyperparameters, never on sequence length $T$; they are the only tensors saved in checkpoints and mutated by optimizers.
2. **{{c2::Dynamic activation tensors}}** — per-batch intermediates such as residual stream $X$, multi-head $Q, K, V_{\mathrm{val}}$, and causal attention matrix $P \in \mathbb{R}^{B \times H \times T \times T}$; freed layer-by-layer in inference, but **{{c2::stashed until backward finishes}}** in training to feed chain-rule contractions.
3. **{{c3::Inference KV Cache}}** — prefix buffers of shape $(B, H, t, d_k)$ that persist only during autoregressive decoding and grow by $1$ row per step; never allocated in parallel training.
4. **{{c4::Training gradients and optimizer states $G, M, V$}}** — same-shape buffers paired with every trainable tensor exclusively during training, where `Muon` eliminates the entire second-moment table $V$ on internal 2D layers.

Extra

Core diagnostic boundary: never confuse projection weights $W_q, W_k \in \mathbb{R}^{D \times D}$ — Family 1 cross-position operators learned and persisted in checkpoints — with the attention probability matrix $P \in \mathbb{R}^{T \times T}$ — a Family 2 transient within-sentence alignment table destroyed right after the step.

type: cloze
tags: ML/LLM ML/Architecture ML/Systems ML/BigPicture
uuid: afc258eb-cc7b-489d-a880-0f626c4d8e4e

---

Front

## Systems Asymmetry: Sequential Memory-Light Inference vs Parallel Memory-Heavy Training

For the exact same Transformer architecture, answer two foundational systems questions:
1. Why must chat inference split into `Prefill` + `Decode` with a sequential `KV Cache`, whereas training has no token loop, allocates no `KV Cache`, and feeds the entire sequence in one parallel pass?
2. Why does training the exact same model require several times more VRAM than running inference?

Back

1. **Target availability + causal masking dictate execution geometry**:
   - **Inference (future tokens unknown)**: token $t+1$ depends on sampling at step $t$. Because the causal mask forbids positions $1 \dots t-1$ from reading token $t$, historical keys and values $K_{1:t-1}, V_{1:t-1}$ never change; caching them reduces each `Decode` step to a single $1 \times D$ GEMV, cutting cumulative MACs up to length $N$ from $\mathcal{O}(N^2 D^2 + N^3 D)$ down to **$\mathcal{O}(N D^2 + N^2 D)$** (at the cost of low arithmetic intensity that is HBM bandwidth-bound).
   - **Training (Teacher Forcing — full sequence known)**: ground-truth tokens $x_{1:T+1}$ are available upfront. Packing $x_{1:T}$ into $(B, T, D)$ with the upper-triangular mask $M_{\mathrm{causal}}$ evaluates all $B \times T$ prefix predictions simultaneously in high-arithmetic-intensity GEMMs, needing no `KV Cache`.
2. **Backward chain-rule dependencies dictate peak VRAM**:
   - Inference discards intermediate activations right after each layer, retaining only static parameters $\Theta$ and the `KV Cache`.
   - Training must keep **all $L$-layer forward activations** in VRAM to compute backward contractions (such as $G = \Delta^\top X$ and attention gradients), alongside **same-shape gradients $G$** and **optimizer states $M, V$**.

type: basic
tags: ML/LLM ML/Systems ML/BigPicture
uuid: 7e4f76ca-28d3-4d78-96ff-f79deff0d09b

---

## Shape Causal Law I: Why Linear Weights Omit $T$ While Attention Matrices Must Be $T \times T$

Given batch size $B$, sequence length $T$, vocabulary size $V$, hidden width $D$, head count $H$, and FFN width $d_{\mathrm{ff}}$, trace both the exact shapes and their structural causes:

1. **Vocabulary boundary & residual backbone**: because calculus derivatives cannot act on discrete integer IDs, the token embedding table $E_{\mathrm{tok}} \in$ **{{c1::$\mathbb{R}^{V \times D}$}}** performs sparse one-hot row lookup $u_{x_t}^\top E_{\mathrm{tok}}$, combining with positional encodings to form the 3D residual stream $X \in$ **{{c1::$\mathbb{R}^{B \times T \times D}$}}** — often flattened to $N \times D$ with $N = B T$.
2. **Why projection and MLP weights never contain $T$**: attention projections $W_{q,k,v,o} \in$ **{{c2::$\mathbb{R}^{D \times D}$}}** and FFN up-projection $W_{\mathrm{up}} \in$ **{{c2::$\mathbb{R}^{d_{\mathrm{ff}} \times D}$}}** have shapes independent of context length $T$ because linear layers are **position-shared row-wise operators** — they remix feature columns within each token independently, with zero cross-token communication.
3. **Why causal attention must exhibit $T \times T$**: multiplying per-head slices $Q^{(h)}, K^{(h)} \in \mathbb{R}^{B \times T \times d_k}$ as $Q^{(h)}(K^{(h)})^\top$ contracts out the shared feature axis $d_k$, producing the causal attention probability tensor $P \in$ **{{c3::$\mathbb{R}^{B \times H \times T \times T}$}}** — the sole lower-triangular routing table where tokens interact **pairwise across positions**.

Extra

Shape intuition: checking how sequence length $T$ enters any tensor immediately reveals its role — no $T$ means a reusable position-shared operator; a single $T$ means per-token hidden representations; $T \times T$ marks pairwise token mixing and the quadratic long-context bottleneck.

type: cloze
tags: ML/LLM ML/TensorShapes ML/Architecture
uuid: 0e13c807-9091-4ce8-899a-d47d27f93b72

---

## Shape Causal Law II: Multi-Head Split $D = H \times d_k$, Variance Scaling, and Decode Asymmetry

Multi-head causal self-attention reshapes and transposes $(B, T, D)$ into a 4D tensor $(B, H, T, d_k)$ where $D = H \times d_k$:

1. **Subspace diversity & $\sqrt{d_k}$ gradient protection**: splitting $D$ into $H$ parallel heads lets one layer track distinct syntactic and semantic relations simultaneously; when entries of $q, k \in \mathbb{R}^{d_k}$ have zero mean and unit variance, the unscaled dot product $q^\top k$ has variance **{{c1::$d_k$}}**, so dividing by **{{c1::$\sqrt{d_k}$}}** restores unit variance and prevents Softmax from collapsing into one-hot saturation where its Jacobian $P_{i,a}(\delta_{ab} - P_{i,b}) \to 0$ kills gradients.
2. **Why step-$t$ Decode pits $1$ query row against $t$ KV rows**: at autoregressive `Decode` step $t$, only token $t+1$ needs to be predicted, so the query slice $Q_t$ shrinks along the sequence axis to **{{c2::$1$}}** row of shape $1 \times d_k$, whereas cached keys and values $K_{1:t}, V_{1:t}$ hold all **{{c2::$t$}}** rows — $t-1$ cached past rows plus $1$ newly appended row, giving `KV Cache` shape $(B, H, t, d_k)$.
3. **Single-row decode attention shape**: instead of a $t \times t$ square matrix, step-$t$ attention collapses into a single row vector $P_{t,:} = \mathrm{softmax}(q_t K_{1:t}^\top / \sqrt{d_k}) \in$ **{{c3::$\mathbb{R}^{1 \times t}$}}**, which multiplies $V_{1:t}$ of shape $t \times d_k$ to emit $o_t \in \mathbb{R}^{1 \times d_k}$ without ever forming the first $t-1$ attention rows.

Extra

Shape intuition: why is there no "Q Cache"? Under causal masking, past positions neither predict new tokens nor ever attend forward to token $t$, so $q_{1:t-1}$ are never reused; only the newest token uses its single query $q_t$ to scan all $t$ historical keys $K_{1:t}$ and blend values $V_{1:t}$.

type: cloze
tags: ML/LLM ML/TensorShapes ML/Attention
uuid: 8ad91d70-3f99-41d1-a8f7-70387c52aef0

---

## Shape Causal Law III: Axis-Contraction Law of Backprop and Activation Stashing

For a bias-free linear layer $Y = X W^\top$ with flattened input $X \in \mathbb{R}^{N \times d_{\mathrm{in}}}$, weight $W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$, and upstream error $\Delta = \nabla_Y L \in \mathbb{R}^{N \times d_{\mathrm{out}}}$, you never need to memorize index derivatives — simply ask **which shared inner axis must contract out**:

1. **Weight gradient $G = \nabla_W L$ of target shape $d_{\mathrm{out}} \times d_{\mathrm{in}}$**: formed from $\Delta$ of shape $N \times d_{\mathrm{out}}$ and $X$ of shape $N \times d_{\mathrm{in}}$ by contracting out the shared **batch-token axis $N$**, leaving the unique valid product $G =$ **{{c1::$\Delta^\top X$}}**.
2. **Downstream input gradient $\nabla_X L$ of target shape $N \times d_{\mathrm{in}}$**: formed from $\Delta$ of shape $N \times d_{\mathrm{out}}$ and $W$ of shape $d_{\mathrm{out}} \times d_{\mathrm{in}}$ by contracting out the shared **output-channel axis $d_{\mathrm{out}}$**, leaving the unique valid product $\nabla_X L =$ **{{c2::$\Delta W$}}** — forward multiplies by $W^\top$, backward multiplies by un-transposed $W$.
3. **Direct systems consequence**: because computing $G = \Delta^\top X$ multiplies upstream errors directly against forward input $X$, training **{{c3::must retain $X$ in VRAM until this layer's backward pass completes}}**; likewise, accumulating `W.grad` across micro-batches splits the sum over $N$ into exact block inner products, which is why single-batch steps require `zero_grad()`.

Extra

Dimensional elimination rule: every parameter gradient contracts out the token axis $N$ so $G$ matches the static shape of $W$ regardless of batch size or context length, whereas every activation gradient preserves $N$ on the outside.

type: cloze
tags: ML/Backprop ML/TensorShapes ML/Systems
uuid: ec5f558e-411b-42f7-a4cb-8405a8fdb54e

---

## Shape Causal Law IV: Scalar Loss Expansion to Logit Gradients and PyTorch Row-Major Layout

Connect the shape transitions and memory layout at both ends of a training step over $N = B T$ token positions and vocabulary size $V$:

1. **Step-1 loss sanity-check anchor**: at random initialization, candidate token probabilities sit near uniform $P_{n,k} \approx 1/V$, giving an exact expected cross-entropy baseline of **{{c1::$\ln V$}}** — about $6.91$ when $V = 1000$, the first number to check when debugging any pretraining script.
2. **How scalar $L \in \mathbb{R}$ blooms back into $N \times V$ errors**: differentiating mean cross-entropy with respect to flattened logits $Z \in \mathbb{R}^{N \times V}$ yields $\Delta^{(Z)} = \nabla_Z L =$ **{{c2::$\frac{1}{N}(P - Y_{\mathrm{true}})$}}** — negative on the ground-truth column to push its logit up, positive on wrong columns proportional to their predicted probability $P_{n,j}$ to push them down, with every row summing identically to $0$.
3. **Why PyTorch `nn.Linear(d_in, d_out)` stores `.weight` transposed as $(d_{\mathrm{out}}, d_{\mathrm{in}})$**: forward computes $Y = X W^\top$ because C/CUDA arrays use **{{c3::row-major contiguous}}** memory layout — placing all $d_{\mathrm{in}}$ weights of each output neuron in one contiguous row maximizes cache locality during inner products.

Extra

Code-reading intuition: whenever optimizer code writes `A, B = W.size(0), W.size(1)` on a PyTorch `nn.Linear` weight, remember that row count $A = d_{\mathrm{out}}$ is always the output dimension and column count $B = d_{\mathrm{in}}$ is always the input dimension.

type: cloze
tags: ML/Backprop ML/TensorShapes ML/LLM
uuid: a1a379a8-df19-4c02-b846-0ec5dfecf66f

---

## Research Taste I: Subtractive Design in RMSNorm and Tangent-Space Orthogonality (Zhang & Sennrich)

`LayerNorm` requires two sequential cross-channel reductions per token vector — mean $\mu$ first, then variance $\sigma^2$ — creating memory-latency overhead. Zhang & Sennrich asked whether stability truly requires shift invariance or only scale invariance, dropping mean-centering and bias $\beta$ to define $y = \frac{x}{r(x)} \odot \gamma$ with $r(x) = \sqrt{\frac{1}{D}\sum_{i=1}^D x_i^2 + \epsilon}$:

1. **Pure positive scale invariance**: as $\epsilon \to 0$, for any scalar $\alpha > 0$, $\mathrm{RMSNorm}(\alpha x) =$ **{{c1::$\mathrm{RMSNorm}(x)$}}**, anchoring every vector entering the next linear layer near unit root-mean-square norm $\|x\|_{\mathrm{RMS}} \approx 1$.
2. **Tangent-space orthogonality & auto-damping**: the input gradient $\nabla_x L = \frac{1}{r(x)}\!\left(I_D - \frac{\hat{x}\hat{x}^\top}{D}\right)\tilde{\delta}$ identically satisfies **{{c2::$x^\top \nabla_x L = 0$}}** — backpropagated signals lie strictly orthogonal to the radial direction $x$, while the prefactor $1 / r(x)$ scales gradients inversely with activation magnitude to curb residual-stream blowup.
3. **Scale-regularization boundary**: the 1D channel gain $\gamma \in \mathbb{R}^D$, initialized to all ones with negligible parameter count, must use `weight_decay =` **{{c3::0.0}}** in `AdamW` rather than being pulled toward zero.

Extra

Takeaway for Research Taste: high-taste architectural work subtracts down to the minimal sufficient mechanism. Dropping mean-centering saves a GPU reduction pass while leaving a clean spherical tangent geometry and unit-RMS input metric — the exact precondition that later makes the $\mathrm{RMS} \to \mathrm{RMS}$ induced operator norm natural for `Muon`. Always audit how weight decay interacts with scale-invariant layers.

type: cloze
tags: ML/LLM ML/Normalization ML/ResearchTaste
uuid: 57bb375a-c283-416c-8afb-4966a1776bf7

---

## Research Taste II: Seeing Spectral Skew Directly from the Sum-of-Outer-Products Gradient

When looking at a linear layer's weight gradient $G = \Delta^\top X \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$, strong research intuition immediately expands the matrix contraction across the $N$ tokens into a **sum of rank-one outer products**:

$$
G = {{c1::\sum_{n=1}^{N} \delta_n x_n^\top}}
$$

1. **Why real data inevitably skews singular values**: natural-language token frequencies follow a heavy-tailed **{{c2::Zipf's Law}}** and hidden states share dominant common-mode directions, concentrating $\frac{1}{N}X^\top X$ and $G$ into a handful of huge top singular values while dozens or hundreds of tail singular directions carrying rare knowledge and fine alignment sit $10^3 \sim 10^4\times$ weaker.
2. **The scalar step-size dilemma**: on an ill-conditioned valley with condition number $\kappa = \lambda_{\max} / \lambda_{\min} \gg 1$, stability along the steepest direction caps scalar learning rate at $\eta <$ **{{c3::$2 / \lambda_{\max}$}}**, forcing top curvature modes near oscillation while flat or tail directions shrink error by only $1 - \mathcal{O}(1/\kappa)$ per step and stagnate — taking $\mathcal{O}(\kappa)$ steps in plain `SGD` and $\mathcal{O}(\sqrt{\kappa})$ even with momentum.

Extra

Takeaway for Research Taste: diagnose optimization bottlenecks by pairing the algebraic form of the gradient with the statistics of the data. "Rank-one outer-product sum $\times$ Zipfian token distribution" directly explains why LLM gradient spectra have overfed heads and starving tails — framing the exact problem that adaptive preconditioning and spectral orthogonalization aim to solve.

type: cloze
tags: ML/Backprop ML/Optimizer ML/ResearchTaste
uuid: b8f94085-608f-48a2-ab45-4266c5c21a25

---

## Research Taste III: Boundary-Step Dimensional Checking and Coordinate SNR in Adam (Kingma & Ba)

`Adam` initializes $m_0 = 0, v_0 = 0$ and updates $m_t = \beta_1 m_{t-1} + (1-\beta_1) g_t$ and $v_t = \beta_2 v_{t-1} + (1-\beta_2) g_t^2$. Inspecting its $t=1$ boundary behavior and dimensionless ratio reveals two core insights:

1. **Zero-init bias & the Step-1 overshoot spike**: under stationary second moment $\sigma_{g,t}^2 = \mathbb{E}[g_t^2]$, geometric summation gives $\mathbb{E}[v_t] =$ **{{c1::$\sigma_{g,t}^2 (1 - \beta_2^t)$}}**. Because standard $\beta_2 = 0.999$ sits much closer to $1$ than $\beta_1 = 0.9$, the denominator is biased toward zero far more strongly than the numerator; without bias correction, Step-1 update magnitude jumps to $|m_1| / \sqrt{v_1} = \frac{1-\beta_1}{\sqrt{1-\beta_2}} \approx$ **{{c2::$3.162$}}** times $\eta$ — or $10\times$ at $\beta_2 = 0.9999$ — risking early overshoot.
2. **Statistical meaning of the dimensionless step**: after dividing by $(1-\beta_1^t)$ and $(1-\beta_2^t)$, the ratio $\frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}$ strips raw gradient units and measures each coordinate's **{{c3::empirical signal-to-noise ratio}}** — saturating near magnitude $1$ when gradients point consistently, while automatically annealing toward $0$ near minima where mini-batch noise cancels in $\hat{m}_t$ but keeps $\hat{v}_t > 0$.

Extra

Takeaway for Research Taste: make a habit of checking $t=1$ and $t \to \infty$ limits and unit cancellation on every stateful recurrence. Contrast why `Muon` needs neither $(1-\mu)$ scaling nor bias correction on $M_t = \mu M_{t-1} + G_t$: its Frobenius pre-normalization $\tilde{M}_t / \|\tilde{M}_t\|_F$ cancels any positive scalar factor identically!

type: cloze
tags: ML/Optimizer ML/ResearchTaste
uuid: dea1b6d7-1921-4271-b3ce-9e89cecda22c

---

Front

## Research Taste IV: Catching Hidden Coupling Bugs — Why Adam + L2 Lets Large-Gradient Weights Escape Decay (Loshchilov & Hutter)

Because adding $\lambda \theta_{t-1}$ to the gradient is algebraically identical to weight decay in plain `SGD`, early frameworks reused Pattern A inside `Adam`, degrading generalization until decoupled `AdamW` (Pattern B):

```python
# Pattern A: Coupled L2 regularization
g = grad + wd * param
param -= lr * m_hat / (v_hat.sqrt() + eps)

# Pattern B: AdamW decoupled weight decay
param *= (1.0 - lr * wd)
param -= lr * m_hat / (v_hat.sqrt() + eps)
```

1. For a symmetric positive-definite preconditioned update $\theta_t = \theta_{t-1} - \eta P^{-1} \nabla \tilde{L}(\theta_{t-1})$, what regularizer $R(\theta)$ is required to match uniform weight decay $(1 - w)\theta_{t-1}$, and when does it equal standard $L_2$ regularization?
2. How does Pattern A distort regularization across coordinates, and what transferable research-taste lesson does this teach?

Back

1. **L2-vs-weight-decay non-equivalence theorem**:
   Setting $\theta_{t-1} - \eta P^{-1}(\nabla L + \nabla R) = (1 - w)\theta_{t-1} - \eta P^{-1}\nabla L$ and left-multiplying by $P$ yields $\nabla R(\theta) = \frac{w}{\eta} P \theta$, meaning the effective regularizer is **$R(\theta) = \frac{w}{2\eta}\theta^\top P \theta$** (and no fixed $R(\theta)$ exists at all when $P_t$ changes over time). Isotropic Gaussian prior $\frac{\lambda}{2}\|\theta\|_2^2$ equals weight decay **if and only if $P = c I$** (as in plain `SGD`).
2. **Large-gradient weights escape shrinkage**:
   In `Adam`, $P_t = \mathrm{diag}(\sqrt{\hat{v}_t} + \epsilon)$ divides the coupled $\lambda \theta_{t-1,i}$ penalty by $\sqrt{\hat{v}_{t,i}}$, making coordinate $i$'s effective shrinkage rate $\frac{\eta \lambda}{\sqrt{\hat{v}_{t,i}} + \epsilon}$ — **active weights with large historical gradients ($\sqrt{\hat{v}_{t,i}} \gg 1$) barely decay**, quiet weights are over-compressed, and $\lambda\theta$ pollutes moment buffers. `AdamW` applies $(1 - \eta \lambda)\theta_{t-1}$ outside the preconditioner so every decayed weight shrinks uniformly at rate $\eta \lambda$.
3. **Takeaway for Research Taste**:
   Watch out for **hidden coupling bugs when composing modular abstractions**. Two implementations that coincide under an isotropic Euclidean metric (`SGD`) silently diverge once combined with an adaptive metric ($P_t^{-1}$); always write down and verify the joint update equation when combining mechanisms.

type: basic
tags: ML/Optimizer ML/ResearchTaste
uuid: 2b7741e8-caef-4b46-84a1-948e102d03ac

---

## Research Taste V: Reframing Optimizer Choice as Choosing the Natural Induced Norm (Bernstein & Newhouse)

Under norm-ball steepest descent $\Delta W^* = \mathrm{arg}\min_{\|\Delta W\| \le \eta} \langle \tilde{M}, \Delta W \rangle_F$, Bernstein & Newhouse reframed optimizer design around a single geometric question — **which norm properly measures a step $\Delta W \in \mathbb{R}^{d_{\mathrm{out}} \times d_{\mathrm{in}}}$?**

1. **`AdamW`'s entrywise $\ell_\infty$ blind spot**: in the memoryless limit $\|\Delta W\|_{\max} = \max_{i,j}|\Delta W_{i,j}| \le \eta$, the steepest step is **{{c1::$-\eta\,\mathrm{sign}(G)$}}**. Treating a 2D linear operator as isolated scalar cells breaks orthogonal rotation equivariance, and whenever $G$ is dominated by a rank-one outer product $u v^\top$, $\mathrm{sign}(u v^\top) = \mathrm{sign}(u)\,\mathrm{sign}(v)^\top$ stays **{{c1::rank-one}}**, flattening cell magnitudes while wiping out weak orthogonal feature subspaces.
2. **`Muon` from first principles — the $\mathrm{RMS} \to \mathrm{RMS}$ induced operator norm**: because `RMSNorm` feeds unit-RMS vectors into hidden layers, bounding the maximum output RMS shift per unit input RMS yields $\|\Delta W\|_{\mathrm{RMS}\to\mathrm{RMS}} = \sqrt{\frac{d_{\mathrm{in}}}{d_{\mathrm{out}}}}\,\sigma_1(\Delta W) \le \eta$; for reduced SVD $\tilde{M} = U \Sigma V^\top$, the exact steepest-descent step is:
$$
\Delta W^* = {{c2::-\eta \sqrt{\frac{d_{\mathrm{out}}}{d_{\mathrm{in}}}} \, U V^\top}}
$$
3. **Spectral equalization & stateless `Shampoo` equivalence**: the semi-orthogonal polar factor $U V^\top$ — identical to simplifying stateless two-sided `Shampoo` $((G G^\top)^+)^{1/4} G ((G^\top G)^+)^{1/4}$ — maps every nonzero singular value $\sigma_1 \ge \dots \ge \sigma_r > 0$ **{{c3::uniformly to $1$}}**, advancing all $r$ orthogonal feature subspaces at equal stride.

Extra

Takeaway for Research Taste: the cleanest breakthroughs simplify the conceptual frame rather than adding machinery. Once you stop flattening 2D weight matrices into 1D vectors and endow them with the $\mathrm{RMS} \to \mathrm{RMS}$ operator norm dictated by surrounding activations, semi-orthogonal polar updates arise directly as exact first-order steepest descent — without invoking fragile second-order Hessian approximations.

type: cloze
tags: ML/Optimizer ML/Muon ML/ResearchTaste
uuid: 6844d1f2-54ca-48b2-882f-3aefadfe687d

---

## Research Taste VI: Rejecting One-Size-Fits-All — Induced-Norm Routing Between Muon and AdamW

Why must vocabulary boundary matrices $E_{\mathrm{tok}} \in \mathbb{R}^{V \times D}$ and $W_{\mathrm{head}} \in \mathbb{R}^{V \times D}$ NEVER be routed to `Muon` despite being 2D tensors? Testing each module's own input-to-output induced norm gives the exact boundary:

1. **Token embedding table ($\ell_1 \to \mathrm{RMS}$)**: inputs are discrete one-hot vectors with $\|u\|_1 = 1$, and maximizing over $\ell_1$-ball vertices gives $\|\Delta E_{\mathrm{tok}}^\top\|_{\ell_1 \to \mathrm{RMS}} = \max_v \|\Delta E_{\mathrm{tok}}[v, :]\|_{\mathrm{RMS}}$, which **{{c1::decouples completely across vocabulary rows}}**; global spectral orthogonalization would spuriously mix rare and frequent token subspaces across sparsely activated rows.
2. **Output scoring head ($\mathrm{RMS} \to \ell_\infty$) & 1D gains $\gamma$**: Softmax sensitivity is governed by max logit shift $\|z\|_\infty$, whose induced norm likewise decouples row-by-row across candidate tokens, while 1D vector $\gamma \in \mathbb{R}^D$ has rank at most $1$ with no multi-singular-value skew. Thus embeddings, `lm_head`, and 1D gains stay on **{{c2::AdamW}}**, reserving `Muon` for internal 2D hidden operators.
3. Fill in the parameter-routing condition at Blank 3:

```python
muon_params, adamw_decay, adamw_nodecay = [], [], []
for name, p in model.named_parameters():
    is_embed_or_head = ("emb" in name) or ("lm_head" in name)
    if ____:  # [Blank 3]
        muon_params.append(p)
    elif p.ndim >= 2:
        adamw_decay.append(p)
    else:
        adamw_nodecay.append(p)
```

Blank 3 is **{{c3::p.ndim == 2 and not is_embed_or_head}}**.

Extra

Takeaway for Research Taste: real taste shows in respecting the domain of validity of an idea rather than forcing a single hammer onto every tensor. Route optimizers by the operator contract in the computation graph — dense rotations between continuous RMS spaces belong to `Muon`, whereas row-indexed dictionary lookups and logit margins belong to `AdamW`.

type: cloze
tags: ML/Optimizer ML/Muon ML/LLM ML/ResearchTaste
uuid: 2e046ac9-a596-4daf-9692-6436e2ea9a4f

---

## Research Taste VII: Hardware Co-Design & Minimax Trade-Offs in 5-Step Newton-Schulz (Keller Jordan)

Exact `torch.linalg.svd` relies on sequential `float32` bidiagonalization that starves GPU Tensor Cores. Exploiting odd-power singular-vector invariance $(X X^\top)^m X = U \Sigma^{2m+1} V^\top$, `Muon` approximates $U V^\top$ via 5 `bfloat16` GEMM iterations:

```python
def zeropower_via_newtonschulz5(G, steps=5, eps=1e-7):
    a, b, c = (3.4445, -4.7750, 2.0315)
    X = G.bfloat16()
    X = ____  # [Blank 1]
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

1. **Blank 1 — SVD-free convergence-domain scaling**: because quintic polynomials diverge rapidly above $1$, pre-normalizing via **{{c1::X / (X.norm() + eps)}}** uses $\|\tilde{M}\|_F = \sqrt{\sum \sigma_j^2} \ge \sigma_1$ to bound all initial singular values inside $[0, 1]$.
2. **Tall-matrix transpose trick**: transposing whenever rows exceed columns — such as $4D \times D$ in $W_{\mathrm{up}}$ — shrinks the Gram matrix $A = X X^\top$ to side length **{{c2::$\min(d_{\mathrm{out}}, d_{\mathrm{in}})$}}**, cutting per-step MACs on $4D \times D$ from $96 D^3$ down to $9 D^3$ — over $90\%$ savings.
3. **Minimax coefficient trade-off**: classical Taylor coefficients $(1.875, -1.25, 0.375)$ enforce exact tangency $\varphi(1) = 1$ but amplify tiny singular values by at most $1.875^5 \approx 23.2\times$ in 5 steps; `Muon`'s minimax tuple $(3.4445, -4.7750, 2.0315)$ deliberately sacrifices $\varphi(1) = 1$ — giving $\varphi(1) = 0.701$ and tolerating $[0.68, 1.20]$ ripple — to boost origin slope to $3.4445^5 \approx$ **{{c3::$484$}}** times tail singular-value amplification!

Extra

Takeaway for Research Taste: textbook algorithm-hardware co-design. Recognizing that 7-bit `bfloat16` stochastic gradients gain nothing from $1.000000$ precision at the fixed point — while desperately needing steep amplification near $\sigma_0 \sim 10^{-2}$ within a 5-step budget — turns an equiripple polynomial into a $20.9\times$ stronger tail booster running at peak Tensor Core throughput.

type: cloze
tags: ML/Optimizer ML/Muon ML/Numerical ML/ResearchTaste
uuid: c33457db-7599-4024-9e4f-d56728375db1

---

## Research Taste VIII: Scaling Taste — Update-RMS Alignment and Roofline Accounting (Moonshot AI)

Scaling `Muon` to multi-billion-parameter LLM pretraining in Moonlight required solving hyperparameter transfer across model widths, late-training weight norm drift, and true hardware overhead:

1. **Matching entrywise Update RMS to inherit `AdamW` schedules**: a full-rank semi-orthogonal matrix $O_t \in \mathbb{R}^{A \times B}$ satisfies $\|O_t\|_F^2 \approx \min(A, B)$, so its entrywise RMS is $\mathrm{RMS}(O_t) \approx$ **{{c1::$1 / \sqrt{\max(A, B)}$}}** — shrinking as hidden width grows — whereas steady-state `AdamW` at $\beta_1 = 0.9$ maintains dimensionless entrywise update $\mathrm{RMS} \approx \sqrt{\frac{1-\beta_1}{1+\beta_1}} \approx 0.229$ (empirically $\approx 0.2$). Multiplying by the width-canceling factor and adding decoupled weight decay yields:
$$
W_t = {{c2::(1 - \eta \lambda) W_{t-1} - \eta \cdot 0.2\sqrt{\max(A, B)} \, O_t}}
$$
2. **Why decoupled weight decay $(1 - \eta\lambda)$ is mandatory at scale**: without shrinkage, noisy orthogonal updates accumulate positive $\|\Delta_t\|_F^2$ every step, driving $\|W_t\|_F$ monotonically upward until attention logits saturate and overflow; decoupled decay stabilizes weights at equilibrium $\mathrm{RMS}(W_{\mathrm{eq}}) \approx \sqrt{0.02\eta / \lambda}$.
3. **Roofline & batch-token ($N_{\mathrm{tok}}$) FLOPs accounting**: `Muon` drops the second-moment buffer $V$ on internal 2D weights — halving 2D optimizer-state VRAM — and relative to the $6 N_{\mathrm{tok}} A B$ forward+backward FLOPs of that layer, 5-step `NS5` adds at most **{{c3::$\frac{5 \min(A, B)}{N_{\mathrm{tok}}}$}}** FLOPs, which at pretraining batch sizes $N_{\mathrm{tok}} \sim 10^6$ is just **$0.5\% \sim 2\%$**!

Extra

Takeaway for Research Taste: two habits of great scaling engineering — (1) identify width-invariant statistics (entrywise Update RMS $\approx 0.2$) so a new optimizer shares the exact same learning-rate schedule and weight decay as `AdamW` with zero retuning; (2) always divide extra optimizer FLOPs by global batch tokens $N_{\mathrm{tok}}$ and check Roofline arithmetic intensity before assuming matrix multiplications are "expensive".

type: cloze
tags: ML/Optimizer ML/Muon ML/Systems ML/ResearchTaste
uuid: 8d3083fc-66bb-470f-92c4-a02293ca8615
