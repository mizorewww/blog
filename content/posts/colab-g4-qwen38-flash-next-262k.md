{"title":"在单张 Colab G4 (96GB) 上跑满 262K 上下文的 Qwen3.8-Flash-Next：显存账本、踩坑与 176 tok/s 投机解码实录","description":"把 176B 总参数（125B MoE + 51B PLE N-gram 表）的 Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4 塞进单张 Google Colab G4 (RTX PRO 6000 Blackwell 96GB)：47.7 GiB 词表锁页卸载、Mamba 状态池瘦身、预编译 SM120 算子避开 cicc OOM、3-shard 草稿目录削去 200 秒加载耗时，开启 NEXTN 投机解码跑出 176.6 tok/s 与 472K KV 池。附交互式一键部署脚本。","date":"2026-11-10","tag":"技术","tags":["llm","sglang","Google Drive","CLI","成本优化"]}
---

Google Colab 近期在付费订阅里上线了 **G4 GPU** 实例——底层是一张 **NVIDIA RTX PRO 6000 Blackwell Server Edition**（`SM120` 架构，96 GB GDDR7 显存，搭配 176 GiB 系统内存与 236 GB 本地 NVMe），每小时只消耗约 8 到 9 个计算单元。

与此同时，`Qwen3.8-Flash-Next`（以及社区移除安全拒绝的红队研究构建 [`dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4`](https://huggingface.co/dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4)）作为 Qwen4 架构的预览版，给出了一个看似矛盾的体型：**总参数量高达 176B，原生支持 262K（262,144 tokens）上下文，即使是 4-bit 的 NVFP4 量化权重，仓库总体积也有 125.96 GiB（135.25 GB）**。

126 GiB 的权重，能不能塞进单张 96 GB 显存的 Colab G4？不仅要塞进去，能不能跑满 262K 上下文、开启内置的 MTP（Multi-Token Prediction）投机解码，并用 Cloudflare Tunnel 安全反代出来接进本地的 `pi` Coding Agent 日常干活？

答案是**不仅能，而且单流生成速度可以跑到 132 至 176.6 tokens/s，同时预留出 47.2 万 tokens（不开启 MTP 时为 94.6 万 tokens）的 FP8 KV Cache 池**。但如果你照着常规方式直接启动，会在半路上连续撞上 Google Drive FUSE `mmap` 龟速、Blackwell `SM120` 首次编译 `cicc` 撑爆 176 GB 内存触发 OOM Killer、以及 MTP 草稿加载器把 206 个分片重复扫描一遍三大暗礁。

我把整套环境安装、预编译算子直灌、3-shard 草稿目录剥离、Google Drive 按需挂载/备份与 Cloudflare 隧道反代封装成了一个双模式（支持本地交互式向导与 `colab run` 远端直跑）的单文件脚本，开源在 [mizorewww/colab-qwen38-g4](https://github.com/mizorewww/colab-qwen38-g4)。本文先给出 5 分钟上手指南，再完整复盘背后的显存账本与工程排障过程。

```stats title="单卡 Colab G4 实测账本" meta="RTX PRO 6000 Blackwell 96GB · SGLang 0.5.23" note="实测数据来自 Colab G4 实例（gpu-g4-s-use5a1）运行 dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4。"
## 推理与上下文
峰值吞吐 | +176.6 tok/s | 开启 NEXTN 投机解码（Accept len 3.27）
常规吞吐 | 80.6 tok/s | 关闭 MTP 时的单流 Decode 吞吐
KV 池容量 | +472,384 tok | 开启 MTP 时的 FP8 KV 池（262K 的 1.8 倍）
最大 KV 池 | +946,624 tok | 关闭 MTP 时的 FP8 KV 池（262K 的 3.6 倍）
## 内存与启动耗时
GPU 常驻权重 | 81.86 GB | 96 GB 显存中预留完池子后仍余 5.91 GB
Host RAM 占用 | 74.0 GiB | 176 GiB 系统内存中锁定 47.7 GiB PLE 词表
算子编译耗时 | +0.0 s | 命中预编译 fused_moe_120.so（原需 ~900s）
草稿头加载 | +1.8 s | 3-shard 符号链接剥离（原需 202.0s）
```

---

## 五分钟上手指南：交互式向导与一键部署

为了照顾第一次使用、Google 云盘里还没有下载过 126 GiB 权重的读者，脚本设计成了**本地交互式向导**与**远端 `colab` CLI 直跑**双模式自适应。

### 1. 前置准备

你需要一个有 G4 配额的 Google Colab Pro / Pro+ 账号，并在本地安装 [`google-colab-cli`](https://github.com/googlecolab/google-colab-cli)：

```bash
uv tool install google-colab-cli

# 首次使用需通过 gcloud 登录并授予 Colab 所需的四个 scope：
gcloud auth application-default login \
  --scopes=openid,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/colaboratory

# 验证登录态：
colab sessions
```

接着克隆部署仓库：

```bash
git clone https://github.com/mizorewww/colab-qwen38-g4.git
cd colab-qwen38-g4
```

### 2. 方式一：本地交互式向导（推荐首次使用）

直接在本地终端运行：

```bash
python3 run_qwen38_g4.py
```

脚本检测到当前运行在你的本地电脑上，会启动五步交互式向导（直接按回车即可采用默认推荐项，或加 `-y` 全自动执行）：

1. **Colab 会话名**（默认 `qwen38-g4`）：自动检查已有会话，若不存在则调用 `colab new -s qwen38-g4 --gpu G4` 分配实例。
2. **权重加载与 Google Drive 策略**：
   - **`[1] Fast Direct NVMe`（推荐首次使用）**：无需挂载 Google Drive，也不消耗云盘空间。Colab G4 实例到 HuggingFace Xet CDN 的内网吞吐高达 400 至 500 MB/s，约 6.5 分钟即可把 126 GiB 权重直接拉取到实例的本地 NVMe（`/content/...`）。
   - **`[2] Mount Google Drive`（适合云盘有充足空间、希望持久化权重的用户）**：向导会自动调用 `colab drivemount` 在终端打印 OAuth 授权链接引导你点选同意；若云盘 `/content/drive/MyDrive/models/...` 中已有权重则多线程拷入本地 NVMe，若首次使用尚无权重，可在服务启动同时在后台把权重自动备份进云盘（需确保 Google Drive 剩余空间大于 136 GB）。
3. **推理加速模式**：
   - **`[1] Enable MTP Speculative Decoding (NEXTN)`（默认）**：开启 1 层 MTP 投机解码，单流吞吐 120 至 176.6 tok/s，FP8 KV Cache 池容量 472,384 tokens（足够跑满 262K 上下文）。
   - **`[2] High-Capacity Mode (No-MTP)`**：关闭 MTP，单流吞吐 ~80.6 tok/s，FP8 KV Cache 池扩大至 946,624 tokens。
4. **SGLang API Key**：默认自动生成随机高强度 Bearer Key（如 `sk-qwen38-...`），防止公网 `trycloudflare.com` 临时隧道被未授权扫描调用。
5. **自动写入 `pi` 配置**：服务就绪后，向导可一键将反代地址与兼容性参数写入 `~/.pi/agent/models.json`。

### 3. 方式二：仅用 `colab` CLI 单命令直跑

`run_qwen38_g4.py` 顶部内置了 `#!/usr/bin/env -S colab run` shebang。如果你不需要交互式问答，可以直接用 `colab` CLI 把脚本丢到远端 G4 实例上跑：

```bash
# 从零分配 G4 实例并在远端一键拉起服务（--keep 在脚本结束后保留实例）：
colab run --gpu G4 --keep -s qwen38-g4 --timeout 1800 run_qwen38_g4.py

# 或者直接作为可执行文件运行：
./run_qwen38_g4.py

# 若实例已存在，在已有会话上重跑/重启服务：
colab exec -s qwen38-g4 --timeout 1800 -f run_qwen38_g4.py
```

部署完成后，终端会输出反代地址与鉴权密钥：

```text
========================================================================
DEPLOYMENT SUCCESSFUL (total: 480.4s | env: 0.2s | weights: 0.1s | sglang+warmup: 480.1s)
TUNNEL_BASE_URL=https://revenue-recommended-individuals-exports.trycloudflare.com/v1
API_KEY=sk-qwen38-g4-cyber-9f8a7b6c5d4e3f2a
MODEL_ID=dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4
========================================================================
```

```sketch title="从本地客户端到 Colab G4 的完整请求链路" note="Cloudflare Quick Tunnel 提供公网 TLS 接入，SGLang 在入口层校验 Bearer API Key；未携带正确密钥的请求直接返回 401。"
<svg viewBox="0 0 704 168">
  <rect class="panel" x="0" y="0" width="704" height="168" rx="12"/>
  <text class="caps" x="24" y="28">LOCAL MAC / LINUX</text>
  <text class="caps" x="252" y="28">CLOUDFLARE EDGE</text>
  <text class="caps" x="456" y="28">GOOGLE COLAB G4 VM</text>

  <g class="node clay"><rect x="24" y="56" width="164" height="36" rx="18"/><text class="mid" x="106" y="74">pi / OpenAI Client</text></g>
  <text class="small" x="106" y="114" text-anchor="middle">Bearer sk-qwen38-...</text>

  <path class="edge" d="M188 74 H244" marker-end="url(#arrow)"/>
  <text class="small" x="216" y="64" text-anchor="middle">HTTPS</text>

  <g class="node orange"><rect x="248" y="56" width="164" height="36" rx="6"/><text class="mid" x="330" y="74">trycloudflare.com</text></g>
  <text class="small" x="330" y="114" text-anchor="middle">QUIC Tunnel → :30000</text>

  <path class="edge" d="M412 74 H452" marker-end="url(#arrow)"/>

  <rect class="window" x="456" y="42" width="224" height="104" rx="8"/>
  <g class="node teal"><rect x="472" y="56" width="192" height="36" rx="6"/><text class="mid" x="568" y="74">SGLang 0.5.23 (NVFP4)</text></g>
  <g class="node blue"><rect x="472" y="100" width="92" height="32" rx="4"/><text class="mid" x="518" y="116">VRAM 96GB</text></g>
  <g class="node violet"><rect x="572" y="100" width="92" height="32" rx="4"/><text class="mid" x="618" y="116">RAM 176GB</text></g>
</svg>
<svg viewBox="0 0 340 310">
  <rect class="panel" x="0" y="0" width="340" height="310" rx="12"/>
  <text class="caps" x="20" y="26">1. LOCAL CLIENT</text>
  <g class="node clay"><rect x="20" y="38" width="300" height="34" rx="17"/><text class="mid" x="170" y="55">pi / OpenAI Client (Bearer Key)</text></g>
  <path class="edge" d="M170 72 V102" marker-end="url(#arrow)"/>
  <text class="small" x="180" y="90">HTTPS</text>

  <text class="caps" x="20" y="122">2. CLOUDFLARE EDGE</text>
  <g class="node orange"><rect x="20" y="132" width="300" height="34" rx="6"/><text class="mid" x="170" y="149">trycloudflare.com QUIC Tunnel</text></g>
  <path class="edge" d="M170 166 V196" marker-end="url(#arrow)"/>

  <rect class="window" x="20" y="200" width="300" height="92" rx="8"/>
  <g class="node teal"><rect x="32" y="212" width="276" height="34" rx="6"/><text class="mid" x="170" y="229">SGLang 0.5.23 (:30000)</text></g>
  <g class="node blue"><rect x="32" y="252" width="134" height="30" rx="4"/><text class="mid" x="99" y="267">VRAM 96GB</text></g>
  <g class="node violet"><rect x="174" y="252" width="134" height="30" rx="4"/><text class="mid" x="241" y="267">RAM 176GB</text></g>
</svg>
```

> **切记释放实例**：用完后执行 `colab stop -s qwen38-g4` 并用 `colab sessions` 确认列表为空，避免后台空转消耗计算单元。

---

## 第一本账：126 GiB 权重为什么能塞进 96 GB 显存？

拿到 `dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4` 时，第一反应往往是“单卡 96 GB 根本装不下”——它的 HuggingFace 仓库共有 422 个文件，其中 206 个是 `.safetensors` 权重分片，总大小 **125.96 GiB（135.25 GB）**。

但当我们把这 206 个分片按模块拆开，就会看到 Qwen4 预览架构（`Qwen4ExpForConditionalGeneration`）最核心的设计巧思：

| 权重模块 | 分片文件 | 精度 | 体积 (GiB) | 运行时驻留位置 |
| --- | --- | --- | ---: | --- |
| MoE 路由专家（48 层 × 512 专家，top-10） | `layer-00000..00047-experts-*.safetensors`（192 个） | NVFP4 (`W4A4`) | 63.32 GiB | **GPU VRAM** |
| 稠密注意力、共享专家、视觉编码器、MTP 头 | `model-bf16-00001..00012.safetensors`（4 个） | BF16 | 14.91 GiB | **GPU VRAM** |
| 51B N-gram Embedding 查找表（PLE） | `model-plefp8-00000..00009.safetensors`（10 个） | FP8 (`E4M3`) | 47.66 GiB | **Host Pinned RAM** |
| **合计** | **206 个分片** | **混合精度** | **125.89 GiB** | **78.23 GiB GPU + 47.66 GiB CPU** |

原来，176B 总参数里只有 **125B** 是真正参与矩阵乘法的神经网络主干（其中路由专家已用 NVIDIA ModelOpt 量化为 4-bit `NVFP4`，占 63.32 GiB；其余稠密层、共享专家与 MTP 草稿头保留为 `BF16`，占 14.91 GiB，合计 **78.23 GiB**）。

剩下的 **51B 参数（47.66 GiB）** 是一张确定性的 **N-gram Embedding 查找表（Per-Layer Embedding, PLE）**。它根据当前 token 与前几个 token 组成的局部 n-gram 直接按索引查表注入特征，几乎不消耗算力，而且**查表地址在进入网络前就已经确定**。

```sketch title="125.9 GiB 混合精度权重的硬件分流" note="数据来自仓库 206 个 safetensors 分片实测体积。开启 --ple-offload-embedding 后，47.66 GiB 的 FP8 N-gram 表常驻 176 GiB 系统锁页内存，GPU 仅需装入 78.23 GiB 核心权重。"
<svg viewBox="0 0 704 220">
  <rect class="panel" x="0" y="0" width="704" height="220" rx="12"/>
  <text class="caps" x="24" y="28">CHECKPOINT ON NVME (125.9 GIB)</text>
  <text class="caps" x="380" y="28">RUNTIME MEMORY PLACEMENT</text>

  <rect class="window" x="24" y="44" width="260" height="152" rx="8"/>
  <g class="node teal"><rect x="36" y="56" width="236" height="44" rx="4"/><text class="mid" x="154" y="78">NVFP4 路由专家 · 63.32 GiB</text></g>
  <g class="node blue"><rect x="36" y="106" width="236" height="32" rx="4"/><text class="mid" x="154" y="122">BF16 稠密层 + MTP · 14.91 GiB</text></g>
  <g class="node violet"><rect x="36" y="144" width="236" height="40" rx="4"/><text class="mid" x="154" y="164">FP8 PLE N-gram 表 · 47.66 GiB</text></g>

  <path class="edge" d="M284 88 H376" marker-end="url(#arrow)"/>
  <text class="small" x="330" y="78" text-anchor="middle">78.23 GiB</text>
  <path class="edge dash" d="M272 164 H376" marker-end="url(#arrow)"/>
  <text class="small" x="330" y="154" text-anchor="middle">异步预取</text>

  <rect class="window" x="380" y="44" width="300" height="82" rx="8"/>
  <g class="node teal"><rect x="392" y="56" width="276" height="58" rx="6"/><text class="mid" x="530" y="77">GPU VRAM · 96 GB GDDR7 (SM120)</text><text class="small" x="530" y="97" text-anchor="middle">常驻 78.23 GiB (含 MTP 运行态 81.8 GiB)</text></g>

  <rect class="window" x="380" y="134" width="300" height="62" rx="8"/>
  <g class="node violet"><rect x="392" y="144" width="276" height="42" rx="6"/><text class="mid" x="530" y="165">Host Pinned RAM · 47.66 / 176 GiB</text></g>
</svg>
<svg viewBox="0 0 340 360">
  <rect class="panel" x="0" y="0" width="340" height="360" rx="12"/>
  <text class="caps" x="20" y="26">1. CHECKPOINT (125.9 GIB)</text>
  <rect class="window" x="20" y="36" width="300" height="136" rx="8"/>
  <g class="node teal"><rect x="32" y="48" width="276" height="36" rx="4"/><text class="mid" x="170" y="66">NVFP4 路由专家 · 63.32 GiB</text></g>
  <g class="node blue"><rect x="32" y="90" width="276" height="32" rx="4"/><text class="mid" x="170" y="106">BF16 稠密 + MTP · 14.91 GiB</text></g>
  <g class="node violet"><rect x="32" y="128" width="276" height="34" rx="4"/><text class="mid" x="170" y="145">FP8 PLE 词表 · 47.66 GiB</text></g>

  <path class="edge" d="M170 172 V202" marker-end="url(#arrow)"/>

  <text class="caps" x="20" y="220">2. COLAB G4 MEMORY</text>
  <g class="node teal"><rect x="20" y="230" width="300" height="54" rx="6"/><text class="mid" x="170" y="250">GPU VRAM (96 GB GDDR7)</text><text class="small" x="170" y="270" text-anchor="middle">加载 78.23 GiB 主干权重</text></g>
  <g class="node violet"><rect x="20" y="294" width="300" height="48" rx="6"/><text class="mid" x="170" y="313">Host Pinned RAM (176 GiB)</text><text class="small" x="170" y="331" text-anchor="middle">--ple-offload-embedding 锁定 47.66 GiB</text></g>
</svg>
```

因此，只要在 SGLang 启动时加上 `--ple-offload-embedding`，这 47.66 GiB 的 FP8 查找表就会被锁定在 Colab G4 充裕的 **176 GiB 系统内存**中，通过 PCIe 异步预取与 GPU 计算重叠；真正需要装进 96 GB 显存的只有 78.23 GiB。

---

## 第二本账：为什么剩余十几 GB 显存能塞下 262K 甚至 946K 上下文？

把 78.23 GiB 权重装进 96 GB 显存（扣除 CUDA 上下文后进程可用约 `94.17 GiB`）后，回收完加载器临时变量：
- **不开启 MTP 时**，模型常驻显存为 **74.7 GiB**，剩下 **19.4 GiB**；
- **开启 MTP（`NEXTN`）时**，模型加草稿头常驻显存为 **81.8 GiB**，仅剩下 **12.3 GiB**。

如果是传统的 48 层标准 Transformer，12.3 GiB 显存连 64K 上下文都捉襟见肘。为什么我们实测在开启 MTP 时能分出 **472,384 tokens** 的 KV 池、关闭 MTP 时更是高达 **946,624 tokens**？

秘密在于 `config.json` 里的 `layer_types`：

1. **48 层里只有 12 层是全注意力（`full_attention`）**：
   模型采用 **3:1 混合架构**——每 4 层中，前 3 层是 **Gated DeltaNet（GDN，线性注意力）**，只有第 4 层是运行 **Qwen Sparse Attention（QSA）** 的全注意力层。
   - **36 层 GDN 线性注意力**把历史压缩在固定大小的状态矩阵里，**不随序列长度增长**。在 `bfloat16` 下，每个 Mamba/GDN 状态槽（slot）固定只占 **0.055 GiB（约 56 MB）**。
   - **12 层 QSA 全注意力**每层只有 `num_key_value_heads = 2`、`head_dim = 256`。开启 `--kv-cache-dtype fp8_e4m3` 后，12 层合算下来**每个 token 的 KV Cache 仅占约 12.5 KiB**（含 QSA 微块索引缓存）。算下来，**一整条 262,144 tokens 的满上下文，在 FP8 下只消耗约 3.1 GiB 显存**！

```sketch title="3:1 混合架构：只有四分之一的层随上下文长度增长" note="48 层解码器由 12 个 [3 × GDN + 1 × QSA] 周期组成。GDN 状态大小恒定，只有 12 层 QSA 产生每 token 约 12.5 KiB 的 FP8 KV Cache。"
<svg viewBox="0 0 704 176">
  <rect class="panel" x="0" y="0" width="704" height="176" rx="12"/>
  <text class="caps" x="24" y="28">REPEATED 12 TIMES (48 LAYERS TOTAL)</text>

  <rect class="window" x="24" y="42" width="656" height="112" rx="8"/>
  <g class="node plain"><rect x="40" y="58" width="136" height="40" rx="4"/><text class="mid" x="108" y="78">GDN Linear #1</text></g>
  <path class="edge" d="M176 78 H196" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="200" y="58" width="136" height="40" rx="4"/><text class="mid" x="268" y="78">GDN Linear #2</text></g>
  <path class="edge" d="M336 78 H356" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="360" y="58" width="136" height="40" rx="4"/><text class="mid" x="428" y="78">GDN Linear #3</text></g>
  <path class="edge" d="M496 78 H516" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="520" y="58" width="144" height="40" rx="4"/><text class="mid" x="592" y="78">QSA Full Attn #4</text></g>

  <text class="small" x="268" y="128" text-anchor="middle">36 层恒定大小循环状态（每槽共 56 MB，与上下文长度无关）</text>
  <text class="small" x="592" y="128" text-anchor="middle">仅 12 层产生 FP8 KV</text>
</svg>
<svg viewBox="0 0 340 248">
  <rect class="panel" x="0" y="0" width="340" height="248" rx="12"/>
  <text class="caps" x="20" y="26">12 × HYBRID BLOCK (48 LAYERS)</text>
  <rect class="window" x="20" y="38" width="300" height="192" rx="8"/>
  <g class="node plain"><rect x="36" y="52" width="268" height="32" rx="4"/><text class="mid" x="170" y="68">GDN Linear #1–#3 (恒定 56MB/槽)</text></g>
  <path class="edge" d="M170 84 V108" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="36" y="112" width="268" height="36" rx="4"/><text class="mid" x="170" y="130">QSA Full Attention #4 (2 KV heads)</text></g>
  <text class="small" x="170" y="176" text-anchor="middle">全模型仅 12 层产生 KV Cache</text>
  <text class="small" x="170" y="196" text-anchor="middle">262K tokens 在 FP8 下仅需 ~3.1 GiB</text>
</svg>
```

2. **真正的显存刺客是默认高并发下的 Mamba 状态池**：
   在 SGLang 官方的 RTX PRO 6000 多并发配方里，默认设置了 64 并发（分配 192 个 Mamba 状态槽），光这 192 个固定槽位就吃掉了 $192 \times 0.055\text{ GiB} \approx 10.56\text{ GiB}$ 显存，导致留给 KV Cache 的空间只剩 2 到 3 GiB（78K 至 138K tokens），跑不满 262K。
   而在我们个人使用（如接入 `pi` 或 IDE）的场景下，并发只需要 2 到 4 路。只要把 `--max-mamba-cache-size` 压到 `20`（配合 `SGLANG_OPT_MAMBA_SKIP_DECODE_LOCK=1` 与 `extra_buffer_lazy`），Mamba 状态池瞬间从 `10.56 GiB` 缩小到 **`1.15 GiB`**，腾出的近 9 GiB 显存全部拨给 FP8 KV Cache 池：

```sketch title="压低 Mamba 并发槽位，把显存还给 262K KV Cache 池" note="默认 64 并发配比中 192 个 Mamba 槽占掉 10.56 GiB，KV 池不足 262K；本文 4 并发 + MTP 配比中 20 个槽仅占 1.15 GiB，开启 MTP 仍获 472K KV 池。"
<svg viewBox="0 0 704 216">
  <rect class="panel" x="0" y="0" width="704" height="216" rx="12"/>
  <text class="caps" x="24" y="28">DEFAULT 64-CONCURRENCY POOL (12.8 GIB BUDGET)</text>
  <g class="node clay"><rect x="24" y="42" width="460" height="36" rx="4"/><text class="mid" x="254" y="60">192 × Mamba State Slots · 10.56 GiB (82%)</text></g>
  <g class="node plain"><rect x="488" y="42" width="104" height="36" rx="4"/><text class="mid" x="540" y="60">KV 2.2G</text></g>
  <text class="accent" x="604" y="60">✗ 仅 98K tok</text>

  <text class="caps" x="24" y="118">OUR 4-CONCURRENCY + MTP POOL (12.3 GIB REMAINING)</text>
  <g class="node blue"><rect x="24" y="132" width="64" height="36" rx="4"/><text class="mid" x="56" y="150">1.15G</text></g>
  <g class="node teal"><rect x="92" y="132" width="280" height="36" rx="4"/><text class="mid" x="232" y="150">FP8 KV Pool · 5.86 GiB (472,384 tok)</text></g>
  <g class="node plain"><rect x="376" y="132" width="216" height="36" rx="4"/><text class="mid" x="484" y="150">Activation Slack · 5.91 GB</text></g>
  <text class="small" x="604" y="150"><tspan class="b">✓ 1.8× 262K</tspan></text>
</svg>
<svg viewBox="0 0 340 276">
  <rect class="panel" x="0" y="0" width="340" height="276" rx="12"/>
  <text class="caps" x="20" y="26">1. DEFAULT 64-WAY (✗ 98K TOK)</text>
  <g class="node clay"><rect x="20" y="38" width="236" height="34" rx="4"/><text class="mid" x="138" y="55">192 Mamba Slots · 10.6G</text></g>
  <g class="node plain"><rect x="260" y="38" width="60" height="34" rx="4"/><text class="mid" x="290" y="55">KV 2G</text></g>

  <text class="caps" x="20" y="110">2. OUR MTP CONFIG (✓ 472K TOK)</text>
  <g class="node blue"><rect x="20" y="122" width="300" height="34" rx="4"/><text class="mid" x="170" y="139">20 Mamba Slots · 1.15 GiB</text></g>
  <g class="node teal"><rect x="20" y="162" width="300" height="34" rx="4"/><text class="mid" x="170" y="179">FP8 KV Pool · 5.86 GiB (472K tok)</text></g>
  <g class="node plain"><rect x="20" y="202" width="300" height="34" rx="4"/><text class="mid" x="170" y="219">Activation Headroom · 5.91 GB</text></g>
</svg>
```

---

## 三次实测踩坑与工程排障

纸面账本算通之后，真正上机启动时我们连续排除了三个深坑，把原本需要 **45 分钟且中途必挂** 的启动过程压缩到了 **8 分钟稳态就绪**。

### 坑一：Google Drive FUSE 上的 `mmap` 4KB 随机缺页风暴

第一次尝试时，我们把模型下载到了挂载的 `/content/drive/MyDrive/models/...` 上，然后直接把 `--model-path` 指过去。结果 SGLang 的多线程加载器跑出了令人绝望的速度：**加载一个只有 337 MB 的专家分片竟然要 20 到 40 秒，206 个分片预计耗时超过 1.5 小时**。

用 `py-spy dump` 抓取 `sglang::scheduler` 的调用栈后发现：
- 每个 337 MB 的 `layer-*-experts-*.safetensors` 内部包含 **1,536 个独立的小 tensor**（128 个专家的 weight 与 scale）；
- `safetensors` 默认使用 `mmap` 映射文件，当主线程逐个把 1,536 个小 tensor 拷入 GPU 时，会在 `fuse.drive`（单进程 Google Drive FUSE 守护进程）上触发海量 4KB 随机缺页中断；
- 更糟的是，Colab G4 的本地 `/` 分区本身就有 **236 GB 高速 NVMe**，且 Colab 机器到 HuggingFace Xet CDN 的内网拉取速度高达 **400 至 500 MB/s**。

**解决**：脚本一律将运行期权重放在本地 NVMe（`/content/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4`），从本地 NVMe 多线程读取 206 个分片仅需约 7 分钟；Google Drive 仅用于持久化备份或首次拉取配置。同时我们发现 `hf-xet` 的 Rust 线程池在 Python 3.13 进程退出阶段偶尔会在打印完 `✓ Downloaded` 后死锁挂起，因此在脚本里加了日志监控，一旦确认 `Downloaded` 且 206 个分片全部落盘便立即回收子进程：

```python src="https://github.com/mizorewww/colab-qwen38-g4/blob/8b858eec456207c5e0b909375366b97c5b0d44d4/run_qwen38_g4.py#L188-L214" title="高速拉取权重至本地 NVMe 并规避 hf-xet 退出死锁"
def download_from_hf_to_nvme():
    log(f"Downloading weights to local NVMe {LOCAL_MODEL_DIR} via HuggingFace Xet (~400 MB/s)...")
    with open("/content/hf_download.log", "w") as f:
        p = subprocess.Popen(
            f'export PATH="/tools/node/bin:/usr/local/bin:$PATH" && '
            f'HF_XET_HIGH_PERFORMANCE=1 hf download {MODEL_ID} --local-dir {LOCAL_MODEL_DIR}',
            shell=True,
            stdout=f,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            close_fds=True,
            start_new_session=True,
        )
    # Monitor hf_download.log; hf-xet can hang at C++ atexit after printing "Downloaded", so kill once all 206 shards are on disk
    last_prog = ""
    while p.poll() is None:
        dl_txt = subprocess.getoutput("cat /content/hf_download.log 2>/dev/null | tr '\r' '\n'")
        lines = [l for l in dl_txt.splitlines() if l.strip()]
        if lines and lines[-1] != last_prog:
            last_prog = lines[-1]
            if "Fetching" in last_prog or "Downloaded" in last_prog:
                log(f"  [hf] {last_prog[:100]}")
        if "Downloaded" in dl_txt and len(glob.glob(os.path.join(LOCAL_MODEL_DIR, "*.safetensors"))) >= 206:
            subprocess.run(f"kill -9 -{p.pid} 2>/dev/null || pkill -9 -f 'hf download' || true", shell=True)
            break
        time.sleep(5)
```

### 坑二：Blackwell `SM120` 首次 JIT 编译拉起 20+ 个 `cicc` 撑爆 176 GB 内存

当 206 个分片终于在本地 NVMe 上加载完毕、94.6 万 tokens 的 KV Cache 池也分配成功后，进程却在 `Running FlashInfer autotune` / `Capture CUDA graph` 阶段突然暴毙：

```text
RuntimeError: Rank 0 scheduler died during initialization (exit code: -9).
```

检查内核 `dmesg -T` 抓到了真凶：

```text
[Tue Nov 10 05:26:27 2026] [ 373804] 0 373804 1807149 1540207 13053952 0 0 cicc
[Tue Nov 10 05:26:27 2026] [ 374491] 0 374491 1807149 1491774 12652544 0 0 cicc
[Tue Nov 10 05:26:27 2026] oom-kill:constraint=CONSTRAINT_NONE,cpuset=jupyter-children,task=cicc,pid=372182
[Tue Nov 10 05:26:27 2026] Out of memory: Killed process 372182 (cicc) total-vm:8551452kB, anon-rss:6624236kB
```

原来：
1. RTX PRO 6000 Blackwell 的架构代号是 `SM120`（`sm_120f`），SGLang 在 `SM120` 上运行 `modelopt_fp4` 时会选用 `flashinfer_cutlass` 后端，并在首次执行时用 `ninja` + `nvcc` JIT 编译 `fused_moe_120`（包含 **96 个 CUTLASS 分组 GEMM `.cu` 模板文件**）；
2. Colab G4 拥有 48 个虚拟 CPU 核心，`ninja` 默认按核数并发拉起了 **20 多个 `cicc`（NVIDIA CUDA 编译器前端）进程**，每个 `cicc` 进程吃掉 **5 至 6.6 GB 内存**；
3. 此时系统内存里已经锁定了 `47.7 GiB` 的 PLE 表，再加上未释放的 `safetensors` 页缓存与 130 GB 的 `cicc` 编译峰值，瞬间击穿 176 GiB 容器内存上限触发 Linux OOM Killer！
4. 即便加上 `MAX_JOBS=2` 限制编译并发保住性命，单靠 2 个线程把 96 个 `.cu` 文件编完也要花掉整整 **15 分钟**。

**解决**：我们把编译好的 `fused_moe_120.so`（60 MB，压缩后仅 `8.3 MB`）以及 Triton / TileLang / Speculative Tree 预编译算子包（`3.2 MB`）直接发布在 GitHub 仓库的 [Release `v1.0.0`](https://github.com/mizorewww/colab-qwen38-g4/releases/tag/v1.0.0) 中。脚本在 Step 1 用 **2 秒钟**下载解压，并在 `/usr/local/bin/ninja` 安装一个轻量级包装器——只要目标目录里已经存在预编译好的 `.so`，`ninja` 直接返回 `0`，**将 15 分钟的编译耗时和百 GB 编译内存开销彻底归零**；同时加上 `--weight-loader-drop-cache-after-load` 与 `--disable-prefill-cuda-graph`，让运行态 Host RAM 稳稳停在 74 GiB（空闲 102 GiB）：

```python src="https://github.com/mizorewww/colab-qwen38-g4/blob/8b858eec456207c5e0b909375366b97c5b0d44d4/run_qwen38_g4.py#L97-L136" title="2 秒恢复预编译 SM120 算子并绕过 ninja 重编"
    moe_so_dir = "/root/.cache/sglang/.cache/flashinfer/0.7.2/120f/cached_ops/fused_moe_120"
    moe_so_path = f"{moe_so_dir}/fused_moe_120.so"
    os.makedirs(moe_so_dir, exist_ok=True)

    if not os.path.exists(moe_so_path) or os.path.getsize(moe_so_path) < 1000000:
        run_cmd(
            f'curl -fsSL "{GITHUB_RELEASE_BASE}/fused_moe_120.so.xz" -o /tmp/fused_moe_120.so.xz',
            log_path="/content/setup_env.log",
            check=False,
        )
        if os.path.exists("/tmp/fused_moe_120.so.xz") and os.path.getsize("/tmp/fused_moe_120.so.xz") > 1000000:
            run_cmd(f"xz -dc /tmp/fused_moe_120.so.xz > {moe_so_path} && chmod +x {moe_so_path} && rm -f /tmp/fused_moe_120.so.xz")
            log("Restored precompiled fused_moe_120.so (60MB) from GitHub Release!")

    if not os.path.isdir("/root/.cache/sglang/triton"):
        run_cmd(
            f'curl -fsSL "{GITHUB_RELEASE_BASE}/other_kernels.tar.xz" -o /tmp/other_kernels.tar.xz && '
            f'tar -xJf /tmp/other_kernels.tar.xz -C /root && rm -f /tmp/other_kernels.tar.xz',
            log_path="/content/setup_env.log",
            check=False,
        )
        log("Restored precompiled Triton & FlashInfer auxiliary kernels from GitHub Release!")

    # Install ninja wrapper so FlashInfer immediately uses precompiled .so without rebuilding 96 .cuda.o files
    ninja_wrapper = """#!/usr/bin/env python3
import glob, os, sys
if "-C" in sys.argv:
    d = sys.argv[sys.argv.index("-C") + 1]
    if any(os.path.getsize(p) > 10240 for p in glob.glob(os.path.join(d, "*.so"))):
        sys.exit(0)
os.execv("/usr/bin/ninja", ["/usr/bin/ninja"] + sys.argv[1:])
"""
    if os.path.exists("/usr/local/bin/ninja"):
        os.unlink("/usr/local/bin/ninja")
    with open("/usr/local/bin/ninja", "w") as f:
        f.write(ninja_wrapper)
    os.chmod("/usr/local/bin/ninja", 0o755)
```

### 坑三：开启 MTP 投机解码后，草稿加载器把 206 个分片又扫了一遍

解决前两个问题后，我们开启了模型内置的 `NEXTN` MTP 投机解码（`--speculative-algorithm NEXTN`）。观察启动日志时发现了一个反常现象：主模型加载完 206 个分片后，MTP 草稿模型加载器（`Qwen4ExpForCausalLMMTP`）紧接着又启动了一轮 `0/206` 的多线程分片扫描，额外花掉了 **202.02 秒（3 分 22 秒）**，而最终加载出来的草稿头其实只有 `0.51 GB`！

检查 `model.safetensors.index.json` 的 `weight_map` 即可发现：在全部 206 个 `.safetensors` 文件里，带有 `mtp.*` 前缀的权重**只存在于 `model-bf16-00010.safetensors`、`model-bf16-00011.safetensors` 和 `model-bf16-00012.safetensors` 这 3 个文件中**。因为默认没有指定独立的 `--speculative-draft-model-path`，加载器对主目录执行 `glob("*.safetensors")`，把其余 203 个毫不相干的专家分片和 PLE 分片全都白白打开读了一遍。

```sketch title="3-Shard 符号链接目录：把 MTP 草稿头加载从 202 秒砍到 1.8 秒" note="默认共用主目录时，Draft Loader 盲目遍历全部 206 个分片（耗时 202.0s）；3-Shard 符号链接目录仅暴露含 mtp.* 的 3 个 BF16 分片与过滤索引（耗时 1.8s）。"
<svg viewBox="0 0 704 204">
  <rect class="panel" x="0" y="0" width="340" height="204" rx="12"/>
  <text class="caps" x="24" y="28">DEFAULT DRAFT LOAD (202.0 S)</text>
  <g class="node plain"><rect x="24" y="46" width="292" height="34" rx="4"/><text class="mid" x="170" y="63">扫描 192 × layer-*.safetensors (无 mtp)</text></g>
  <g class="node plain"><rect x="24" y="86" width="292" height="34" rx="4"/><text class="mid" x="170" y="103">扫描 11 × plefp8/bf16 (无 mtp)</text></g>
  <g class="node clay"><rect x="24" y="126" width="292" height="34" rx="4"/><text class="mid" x="170" y="143">读取 3 × model-bf16-00010..12 (含 mtp.*)</text></g>
  <text class="accent" x="170" y="184" text-anchor="middle">✗ 203 个分片被无效遍历，白等 3 分 22 秒</text>

  <rect class="panel" x="364" y="0" width="340" height="204" rx="12"/>
  <text class="caps" x="388" y="28">3-SHARD SYMLINK DIR (1.8 S)</text>
  <rect class="window" x="388" y="46" width="292" height="114" rx="8"/>
  <g class="node blue"><rect x="404" y="60" width="260" height="36" rx="4"/><text class="mid" x="534" y="78">过滤后 index.json (仅保留 mtp.*)</text></g>
  <g class="node teal"><rect x="404" y="106" width="260" height="38" rx="4"/><text class="mid" x="534" y="125">Symlink 3 × model-bf16-00010..12</text></g>
  <text class="small" x="534" y="184" text-anchor="middle"><tspan class="b">✓ 0 字节额外磁盘占用，1.8 秒加载完成</tspan></text>
</svg>
<svg viewBox="0 0 340 340">
  <rect class="panel" x="0" y="0" width="340" height="162" rx="12"/>
  <text class="caps" x="20" y="24">1. DEFAULT DRAFT LOAD (✗ 202.0 S)</text>
  <g class="node plain"><rect x="20" y="36" width="300" height="32" rx="4"/><text class="mid" x="170" y="52">盲扫 203 个无关分片 (layer-* / plefp8)</text></g>
  <g class="node clay"><rect x="20" y="74" width="300" height="32" rx="4"/><text class="mid" x="170" y="90">读取 3 个含 mtp.* 的分片</text></g>
  <text class="accent" x="170" y="134" text-anchor="middle">✗ 耗时 202.02 秒</text>

  <rect class="panel" x="0" y="178" width="340" height="162" rx="12"/>
  <text class="caps" x="20" y="202">2. 3-SHARD SYMLINK DIR (✓ 1.8 S)</text>
  <g class="node blue"><rect x="20" y="214" width="300" height="32" rx="4"/><text class="mid" x="170" y="230">过滤后 index.json (仅保留 mtp.*)</text></g>
  <g class="node teal"><rect x="20" y="252" width="300" height="32" rx="4"/><text class="mid" x="170" y="268">Symlink 3 × model-bf16-00010..12</text></g>
  <text class="small" x="170" y="312" text-anchor="middle"><tspan class="b">✓ 耗时 1.8 秒（省去 200 秒）</tspan></text>
</svg>
```

**解决**：我们在脚本里写了一个 `prepare_mtp_draft_dir()` 函数，在 `/content/Qwen3.8-Flash-Next-MTP-Draft` 下只为这 3 个分片建立符号链接（0 额外磁盘占用），并生成一份只包含 `mtp.*` 映射的 `model.safetensors.index.json`，再将其传给 `--speculative-draft-model-path`：

```python src="https://github.com/mizorewww/colab-qwen38-g4/blob/8b858eec456207c5e0b909375366b97c5b0d44d4/run_qwen38_g4.py#L139-L167" title="构造 3-Shard MTP 极速草稿目录"
def prepare_mtp_draft_dir():
    """Create a 3-shard symlink directory containing only MTP draft weights so MTP draft loads in ~1.8s instead of ~202s!"""
    os.makedirs(LOCAL_MTP_DRAFT_DIR, exist_ok=True)
    idx_path = os.path.join(LOCAL_MODEL_DIR, "model.safetensors.index.json")
    if not os.path.exists(idx_path):
        return
    with open(idx_path) as f:
        idx = json.load(f)
    wm = idx["weight_map"]
    mtp_wm = {k: v for k, v in wm.items() if "mtp" in k}
    mtp_shards = sorted(set(mtp_wm.values()))

    for fname in os.listdir(LOCAL_MODEL_DIR):
        if fname.startswith(".") or fname.endswith(".safetensors") or fname == "model.safetensors.index.json":
            continue
        src = os.path.join(LOCAL_MODEL_DIR, fname)
        dst = os.path.join(LOCAL_MTP_DRAFT_DIR, fname)
        if os.path.isfile(src) and not os.path.exists(dst):
            os.symlink(src, dst)

    for shard in mtp_shards:
        src = os.path.join(LOCAL_MODEL_DIR, shard)
        dst = os.path.join(LOCAL_MTP_DRAFT_DIR, shard)
        if not os.path.exists(dst):
            os.symlink(src, dst)

    with open(os.path.join(LOCAL_MTP_DRAFT_DIR, "model.safetensors.index.json"), "w") as f:
        json.dump({"metadata": idx.get("metadata", {}), "weight_map": mtp_wm}, f, indent=2)
```

---

## 启动耗时拆解与 MTP 投机解码实测

完成上述三项优化后，SGLang 引擎在启动末尾输出的精确阶段计时如下：

```text
[08:40:23] max_total_num_tokens=472384, chunked_prefill_size=4096, max_prefill_tokens=16384, max_running_requests=4, context_len=262144, available_gpu_mem=5.91 GB
[08:40:24] Engine startup timings (s): load_weight=440.89, kv_cache_allocation=0.95, scheduler_e2e=452.29, cuda_graph={prefill=0.00, decode=0.00, target_verify=3.09, draft_prefill=0.00, draft_decode=2.71, draft_extend=1.22}, tokenizer_e2e=460.09
[08:40:28] The server is fired up and ready to roll!
```

```data title="SGLang (开启 NEXTN 投机解码) 启动至可用耗时拆解" mark="MTP 草稿头,SM120 算子" note="单位：秒（s）。优化前主模型走 Drive FUSE mmap 且触发 SM120 首次编译；优化后走本地 NVMe、Release 预编译算子与 3-shard 草稿目录。全新实例首次拉取 126 GiB 权重另需约 400s。"
阶段 | 优化前 | 优化后 | 耗时变化
环境与缓存 | 45.0s | 12.8s | −71.6%
主模型加载 | 2112.6s | 439.1s | −79.2%
MTP 草稿头 | 202.0s | 1.8s | −99.1%
SM120 算子 | 900.0s | 0.0s | −100.0%
显存池分配 | 3.4s | 1.0s | −70.6%
CUDA Graph | 13.9s | 7.0s | −49.6%
内部 Warmup | 12.0s | 4.0s | −66.7%
```

再看开启 MTP（`--speculative-algorithm NEXTN --speculative-num-steps 3 --speculative-eagle-topk 1 --speculative-num-draft-tokens 4`）前后的实测生成速度对比：

```data title="单流 Decode 吞吐与投机接受率实测" mark="NEXTN 峰值" note="在 Colab G4 上通过 Cloudflare Tunnel 实测单流请求（cuda graph: True）。关闭 MTP 时 KV 池为 946,624 tokens，开启 MTP 时为 472,384 tokens。"
阶段 | 吞吐 (tok/s) | 接受长 | 接受率
无 MTP | 80.6 | 1.00 | -
NEXTN 采样 | 130.0 | 2.45 | 48%
NEXTN 中段 | 160.0 | 2.98 | 66%
NEXTN 峰值 | 176.6 | 3.27 | 76%
```

在代码生成与技术问答场景下，1 层 MTP 草稿头每步预测 4 个草稿 token，平均能被主模型一次验证通过 **2.45 至 3.27 个 token**，将单流生成速度从 `80.6 tokens/s` 直接推高到了 **`130 ~ 176.6 tokens/s`**，端到端体感延迟接近翻倍提速。

完整的 SGLang 启动参数构造如下：

```python src="https://github.com/mizorewww/colab-qwen38-g4/blob/8b858eec456207c5e0b909375366b97c5b0d44d4/run_qwen38_g4.py#L294-L348" title="SGLang 262K 上下文 + MTP NEXTN 启动配置"
def step4_start_sglang_and_wait() -> float:
    mode_label = "MTP Speculative Decoding (NEXTN)" if ENABLE_MTP else "Standard High-Capacity (No-MTP)"
    log(f"Step 4/4: Launching SGLang Server [{mode_label} + 262K Context]...")
    subprocess.run("pkill -9 -f '[s]glang' || true", shell=True)

    spec_flags = ""
    if ENABLE_MTP:
        spec_flags = f"""  --speculative-draft-model-path {LOCAL_MTP_DRAFT_DIR} \\
  --speculative-algorithm NEXTN \\
  --speculative-num-steps 3 \\
  --speculative-eagle-topk 1 \\
  --speculative-num-draft-tokens 4 \\
  --speculative-draft-kv-cache-dtype fp8_e4m3 \\
  --enable-linear-replayssm-spec \\
  --max-running-requests 4 \\
  --max-mamba-cache-size 20 \\
  --chunked-prefill-size 4096 \\
  --mem-fraction-static 0.95 \\"""
    else:
        spec_flags = """  --max-running-requests 8 \\
  --max-mamba-cache-size 24 \\
  --chunked-prefill-size 8192 \\
  --mem-fraction-static 0.93 \\"""

    sglang_sh = f"""#!/bin/bash
set -ex
export PATH="/tools/node/bin:/usr/local/bin:$PATH"
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
export SGLANG_OPT_MAMBA_SKIP_DECODE_LOCK=1
export MAX_JOBS=4
export CMAKE_BUILD_PARALLEL_LEVEL=4
export FLASHINFER_JIT_MAX_JOBS=4

exec sglang serve \\
  --model-path {LOCAL_MODEL_DIR} \\
  --served-model-name {MODEL_ID} \\
  --tp-size 1 \\
  --quantization modelopt_fp4 \\
  --attention-backend flashinfer \\
  --kv-cache-dtype fp8_e4m3 \\
  --mamba-ssm-dtype bfloat16 \\
  --ple-offload-embedding \\
  --mamba-radix-cache-strategy extra_buffer_lazy \\
{spec_flags}
  --disable-flashinfer-autotune \\
  --weight-loader-drop-cache-after-load \\
  --cuda-graph-max-bs-decode 4 \\
  --disable-prefill-cuda-graph \\
  --reasoning-parser qwen3 \\
  --tool-call-parser qwen3_coder \\
  --model-loader-extra-config '{{"enable_multithread_load": true}}' \\
  --api-key {API_KEY} \\
  --host 0.0.0.0 \\
  --port 30000
"""
```

---

## 接入 `pi` Coding Agent 的两个兼容性细节

如果你使用脚本的本地交互式向导（`python3 run_qwen38_g4.py`），向导会自动把反代地址写进 `~/.pi/agent/models.json`。如果手动把 `Qwen3.8-Flash-Next` 配进 `pi` 或其他 OpenAI 兼容客户端，有两个必须注意的模板校验细节：

1. **禁用 `developer` 角色（`supportsDeveloperRole: false`）**：
   OpenAI 新版接口对推理模型默认发送 `"role": "developer"`，但 `Qwen3.8-Flash-Next` 的 Jinja 聊天模板严格校验角色名只能是 `system | user | assistant | tool`，收到 `developer` 会直接返回 `400 Unexpected message role`。在 `models.json` 中设置 `"compat": {"supportsStore": false, "supportsDeveloperRole": false}` 即可让 `pi` 回退为标准 `system` 角色。
2. **映射思考强度（`thinkingLevelMap`）**：
   模型聊天模板只接受 `low`、`medium`、`xhigh` 三档 `reasoning_effort`，如果客户端传了 `"high"` 会返回 `400 Unexpected reasoning effort high`。在 `thinkingLevelMap` 中把 `"high"` 映射到 `"xhigh"` 即可无缝兼容。

配置完成后，直接在终端用 `pi` 实测调用远端 G4 上的模型执行多步工具探测：

```bash
pi --model "colab-g4/dealignai/Qwen3.8-Flash-Next-CYBERSECURITY-NVFP4" -p "看一下本机配置"
```

模型在 `xhigh` 思考深度下自动通过 `--tool-call-parser qwen3_coder` 发起工具调用并汇总本机硬件、运行时与会话状态，首轮 ~9.5K tokens 系统提示词自动命中 SGLang Unified Radix Cache，后续轮次几乎零等待。

---

## 小结

把一个 176B 总参数、126 GiB 体积、262K 上下文的混合架构大模型塞进单张 96 GB 的 Colab G4 里跑出 176 tok/s，靠的不是蛮力，而是顺着架构的纹理去拆解账本：

- **分清什么该留显存、什么该去内存**：78.2 GiB 计算权重留给 GDDR7，47.7 GiB 查表权重交给 176 GiB 锁页内存；
- **分清什么随序列增长、什么随并发增长**：36 层 GDN 状态槽按实际并发从 192 槽砍到 20 槽，就能为 12 层稀疏全注意力腾出近百万 tokens 的 FP8 KV 池；
- **把一次性编译与重复 I/O 挡在热路径之外**：预编译好 `SM120` 算子、用 3 个符号链接隔离 MTP 草稿头，每次冷启动就能少等近 20 分钟。

全套脚本与预编译算子均已开源在 [github.com/mizorewww/colab-qwen38-g4](https://github.com/mizorewww/colab-qwen38-g4)。
