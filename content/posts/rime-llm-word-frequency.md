---
title: "用基座大模型给 Rime 离线蒸馏词频与语法模型"
description: "从 librime 的整句打分公式出发，分析现有扩展词表与语法模型在概率尺度上的偏差，并用 Qwen3-14B-Base 在离线阶段完成前缀树词频校准、对称提示词领域增益与 lm_head 点互信息语法模型蒸馏。"
date: 2026-11-25
tag: "技术"
tags:
  - "rime"
  - "llm"
  - "ime"
  - "distillation"
---

Rime 输入法在整句解码（`librime` 的 `poet.cc` 与 `dict_compiler.cc`）时，沿着音节图做宽度为 7 的束搜索（Beam Search）。从前文 `context` 转移到下一个候选词 `word` 时，路径增量得分由两项相加决定：

$$
\text{Score}(\text{context} \to \text{word}) = \ln\big(\text{dict\_weight}(\text{word})\big) + \text{Octagram::Query}(\text{context}, \text{word})
$$

第一项来自词表文件（`.dict.yaml`）中的静态词频，对应候选词的无条件先验对数概率 $\ln P(\text{word})$；第二项来自 `librime-octagram` 语法模型（`.gram`），对应给定前文时的上下文修正量。

要使整句解码排在第一位的候选路径恰好对应自然语言中概率最高的词序列，这两份静态数据需要满足两个条件：

1. **所有参与合并的词表必须处在同一经验词频尺度上**，使 $\ln(\text{dict\_weight}(w))$ 与 $\ln P(w)$ 成正比（差一个全局常数）；
2. **因为第一项已经加过一次 $\ln P(\text{word})$，第二项 `Octagram::Query` 给出的应当是点互信息（PMI）**：
   $$
   \text{PMI}(\text{context}, \text{word}) = \ln P(\text{word} \mid \text{context}) - \ln P(\text{word})
   $$
   这样两项相加才等于马尔可夫条件对数概率 $\ln P(\text{word} \mid \text{context})$。

现有的社区开源扩展词库与预编译 `.gram` 语法包在这两个条件上都存在明显偏差。我用 `Qwen/Qwen3-14B-Base` 在离线阶段重新计算并生成了这两份静态数据，工具代码、C++ `.gram` 编译合并器、`librime` 端到端评测器以及预构建词库均已开源在 [mizorewww/rime-qwen-freq](https://github.com/mizorewww/rime-qwen-freq)。

## 一、现有词表与语法模型的两类数据偏差

检查常见配置（如薄荷拼音或雾凇拼音叠加万象基础词库、维基百科等扩展词表，配合 `wanxiang-lts-zh-hans.gram` 语法模型），可以定位出两类具体的数据问题。

### 1. 词表层面的常数权重倒挂与跨表冗余

在主力基础词库 `wanxiang_jichu.dict.yaml` 中，词频按语料统计赋权，全表权重中位数（P50）为 `279`，$99\%$ 分位（P99）为 `5,256`，最高频词上限为 `350,000`。

而第三方转换的百科与词典扩展表——`zhwiki`（172.8 万条）、`zhwiktionary`（28.6 万条）、`moegirl`（13.0 万条），合计 214.4 万条词条——由于缺乏语料频次统计，将每一行的权重统一写成了常数 `60000`。在 `dict_compiler.cc` 编译词表时，这 214.4 万个低频专名全部获得 $\ln(60000) \approx 11.0$ 的先验分，高于基础词库中 $99.9\%$ 的日常词汇。例如连续输入 `fanxiangchuanboyutidu` 时，`zhwiki` 中权重为 `60000` 的明代人名“范骧”会排在“反向”之前，解码出“范骧传播与梯度”；输入 `fenyezhuyili` 时，明代宗室人名“朱议沥”（`60000`）会优先匹配后三个音节，输出“分页朱议沥”。

此外，中英混输词表（`wanxiang_mixed`）与部分英文扩展词表（`rime_ice.en`、`rime_ice.en_ext`）未提供权重列，编译时回退到极低默认值；同时不同词表之间存在大量重复记录：`wanxiang_jichu` 的 149.4 万行中有 131.4 万行（$88\%$）的 `(词, 无调拼音)` 与 `rime_mint.base` 完全重合，百科词表与基础词库重合 36.2 万行，英文表 `easy_en` 的 74.5 万行中有 57.4 万行权重为 `0`（占 $77\%$），使编译后的 `build/*.bin` 体积达到 `296.0 MiB`（其中英文索引 `melt_eng.prism.bin` 占 `103.1 MiB`）。

### 2. 语法模型层面的分词阶数偏差与语料错别字

遍历 `wanxiang-lts-zh-hans.gram` 的双数组前缀树（共 `65,493,408` 条记录，体积 `400.8 MiB`，其中 $77.6\%$ 为 4 字项，句尾 `$` 标记 `6,746` 条），查询常见成语与同音错别字，可以看到如下对比（未收录项返回 `-1`，解码时按 `non_collocation_penalty = -6.0` 扣分；收录项按 $-14.0 + v / 10000$ 计分）：

- `川流不息 = -1`（扣 `-6.0`），同音错字 `穿流不息 = 180,687`（加 `+4.07`）；
- `莫名其妙 = -1`（扣 `-6.0`），同音错字 `莫明其妙 = 164,433`（加 `+2.44`）；
- `再接再厉 = 176,835`（加 `+3.68`），同音错字 `再接再励 = 200,616`（加 `+6.06`）；
- 其他高分错字条目包括 `整行医院 = 231,925`、`初略统计 = 235,638`、`打做一团 = 235,675`、`强联通分量 = 223,327`、`方向传播 = 177,727`；
- 近年的技术搭配（如 `推测解码`、`旋转位置编码`、4 字 `缓存命中`）查询结果均为 `-1`。

产生这一现象的原因在于传统的构建流程：上游脚本先用 `jieba` 对网页语料分词，再交由 KenLM `lmplz -o 3` 统计 N-gram，最后将各阶条件概率乘以该阶的词条总种类数 `ngrams_counts[order]` 并取对数转为整数。

在这个流程下，**收录在 `jieba` 词典中的正常四字成语（如“川流不息”、“莫名其妙”、“迫不及待”）在分词阶段被切为单个词（1-gram）**，由于 1-gram 的种类基数远小于 2-gram 和 3-gram，相乘后数值下溢被丢弃（本机词典中权重 $\ge 25$ 的 3~6 字词条和成语，在原版 `.gram` 中共缺失 `287,497` 条）；相反，**网页中的错别字（如“穿流不息”、“再接再励”、“整行医院”）不在 `jieba` 词典内，被切分为两到三个词（2-gram 或 3-gram）**，乘上千万级的 3-gram 基数后得到了 `164,000 ~ 235,000` 的数值。结果当输入 `xiwangdajiazaijiezaili` 时，即使词表中“再接再厉”权重正常，语法模型的 $+2.38\text{ nats}$ 差值也会把整句首选改为“希望大家再接再励”。

```sketch title="Rime 整句打分公式中的两项数据偏差：词表常数权重倒挂与语法模型分词阶数偏差" note="词表先验项（.dict.yaml）：214.4 万条扩展词统一填为 60000；语法模型项（.gram）：结巴分词 1-gram 与 3-gram 基数差异导致成语下溢、错字高分。"
<svg viewBox="0 0 704 250">
  <rect class="panel" x="0" y="0" width="344" height="250" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="250" rx="12"/>
  <text class="caps" x="24" y="28">UNIGRAM PRIOR</text>
  <text class="small b ink" x="24" y="52">基础词库 wanxiang_jichu（语料频次）</text>
  <g class="node teal"><rect x="24" y="64" width="136" height="32" rx="4"/><text class="mid" x="92" y="80">P50 = 279</text></g>
  <g class="node plain"><rect x="168" y="64" width="152" height="32" rx="4"/><text class="mid" x="244" y="80">P99 = 5,256</text></g>
  <text class="small b ink" x="24" y="124">扩展词表 zhwiki / 词典 / 萌娘（214.4 万条）</text>
  <g class="node clay"><rect x="24" y="136" width="296" height="34" rx="6"/><text class="mid" x="172" y="153">全部填写固定常数 60,000</text></g>
  <text class="small accent" x="24" y="196">低频专名先验分高于 99.9% 的日常词汇</text>
  <text class="small mute" x="24" y="218">跨表重复与零权重行占 225 万条（编译后 296.0 MiB）</text>

  <text class="caps" x="384" y="28">OCTAGRAM CONTEXT</text>
  <g class="node plain"><rect x="384" y="48" width="296" height="32" rx="4"/><text class="mid" x="532" y="64">正字“川流不息” → 结巴切为 1-gram</text></g>
  <text class="small accent" x="384" y="96">乘 1-gram 小基数下溢丢失 → 查询为 -1（扣 6.0）</text>
  <g class="node clay"><rect x="384" y="114" width="296" height="32" rx="6"/><text class="mid" x="532" y="130">错字“穿流不息” → 切分为 2/3-gram</text></g>
  <text class="small accent" x="384" y="162">乘 3-gram 千万级基数 → 存入 180,687（加 4.07）</text>
  <text class="small mute" x="384" y="196">莫名其妙 (-1) vs 莫明其妙 (164,433)</text>
  <text class="small mute" x="384" y="218">再接再厉 (176,835) vs 再接再励 (200,616)</text>
</svg>
<svg viewBox="0 0 340 500">
  <rect class="panel" x="0" y="0" width="340" height="240" rx="12"/>
  <rect class="panel" x="0" y="254" width="340" height="246" rx="12"/>
  <text class="caps" x="20" y="28">UNIGRAM PRIOR</text>
  <text class="small b ink" x="20" y="52">基础词库 wanxiang_jichu</text>
  <g class="node teal"><rect x="20" y="64" width="142" height="32" rx="4"/><text class="mid" x="91" y="80">P50 = 279</text></g>
  <g class="node plain"><rect x="170" y="64" width="150" height="32" rx="4"/><text class="mid" x="245" y="80">P99 = 5,256</text></g>
  <text class="small b ink" x="20" y="122">扩展词表 zhwiki / 词典 / 萌娘</text>
  <g class="node clay"><rect x="20" y="134" width="300" height="34" rx="6"/><text class="mid" x="170" y="151">214.4 万条全部填写 60,000</text></g>
  <text class="small accent" x="20" y="194">低频专名先验分高于 99.9% 的日常词</text>
  <text class="small mute" x="20" y="216">跨表重复与零权重行共 225 万条</text>

  <text class="caps" x="20" y="282">OCTAGRAM CONTEXT</text>
  <g class="node plain"><rect x="20" y="300" width="300" height="30" rx="4"/><text class="mid" x="170" y="315">正字“川流不息” → 结巴切为 1-gram</text></g>
  <text class="small accent" x="20" y="346">乘 1-gram 小基数下溢 → 查询 -1（扣 6.0）</text>
  <g class="node clay"><rect x="20" y="362" width="300" height="30" rx="6"/><text class="mid" x="170" y="377">错字“穿流不息” → 切分为 2/3-gram</text></g>
  <text class="small accent" x="20" y="408">乘 3-gram 大基数 → 180,687（加 4.07）</text>
  <text class="small mute" x="20" y="438">莫名其妙 (-1) vs 莫明其妙 (164,433)</text>
  <text class="small mute" x="20" y="458">再接再厉 (176,835) vs 再接再励 (200,616)</text>
</svg>
```

## 二、词表词频的离线估计与尺度对齐

开源基座语言模型（如 `Qwen3-14B-Base`）在数万亿 token 的多语种网页、百科、代码与论文语料上完成了自回归预训练，词项在自然文本中的出现概率已经编码在模型参数中。只要在离线阶段将模型给出的条件概率提取出来，对齐到现有主力词库的整数尺度并写回 `.dict.yaml`，运行时依然是纯静态查表。

### 1. 为什么不能直接使用 BPE 序号或裸序列似然

从语言模型中提取词频时，有两种直接做法在数学上不成立：

1. **直接使用 Tokenizer 的 BPE 合并序号**：BPE 词表仅包含约 15 万个子词，其中大量是 `"的时"`、`"了一"` 这类跨词边界的统计片段，不包含两百多万个专有名词与复合词；同时合并序号是线性排列的整数，无法还原幂律分布（Zipf's law）下跨越五个数量级的真实频次比。
2. **直接将词条序列的对数似然 $\log P(w \mid C)$ 映射为权重**：设词条 $w$ 分词后为 $(t_1, t_2, \dots, t_k)$，由概率链式法则：
   $$
   \log P(w \mid C) = \sum_{i=1}^{k} \log P(t_i \mid C, t_1, \dots, t_{i-1})
   $$
   由于每一步条件概率均小于 $1$（对数为负），token 数 $k$ 越多的长词累加的负项越多，其联合概率天然比短词低几个数量级（例如常见四字成语的联合似然往往低于生僻二字词）。此外，裸对数似然与现有万象词库（`1 ~ 350,000`）或英文 ECDICT 词库（`900,000 ~ 999,995`）的数值尺度不一致，直接转换会破坏现有词库的排序。

因此，合理的流程是：先用前缀树高效算出每个词条在固定语境下的精确 token 级概率特征，再以现有主力词库中已有的真实词频作为监督锚点，训练回归模型消除词长偏置并完成尺度对齐。

```sketch title="直接提取做法的局限与离线校准流程" note="所有模型计算均在离线阶段一次性完成，运行时仅加载编译后的静态表。"
<svg viewBox="0 0 704 252">
  <rect class="panel" x="0" y="0" width="328" height="252" rx="12"/>
  <rect class="panel" x="344" y="0" width="360" height="252" rx="12"/>
  <text class="caps" x="24" y="28">NAIVE APPROACHES</text>
  <g class="node plain"><rect x="24" y="48" width="280" height="32" rx="4"/><text class="mid" x="164" y="64">直接取 BPE 合并序号（仅 15 万子词）</text></g>
  <text class="small accent" x="24" y="96">含跨词边界碎片，线性序号无法反映幂律频次差</text>
  <g class="node plain"><rect x="24" y="112" width="280" height="32" rx="4"/><text class="mid" x="164" y="128">直接用序列联合似然作为权重</text></g>
  <text class="small accent" x="24" y="160">长词连乘条件概率偏小，且与现有词库量纲不兼容</text>
  <g class="node plain"><rect x="24" y="176" width="280" height="32" rx="4"/><text class="mid" x="164" y="192">单一提示词“在计算机科学中”加权</text></g>
  <text class="small accent" x="24" y="224">未扣除无条件先验，高频通用虚词同步上涨</text>

  <text class="caps" x="368" y="28">CALIBRATED PIPELINE</text>
  <g class="node blue"><rect x="368" y="48" width="312" height="32" rx="4"/><text class="mid" x="524" y="64">1. BPE 前缀树前向计算精确 token 概率特征</text></g>
  <path class="edge" d="M524 80 V96" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="368" y="98" width="312" height="32" rx="4"/><text class="mid" x="524" y="114">2. 用主力词库 10 万经验锚点回归并还原方差</text></g>
  <path class="edge" d="M524 130 V146" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="368" y="148" width="312" height="32" rx="4"/><text class="mid" x="524" y="164">3. 对称双提示词相减，叠加领域对数几率增益</text></g>
  <path class="edge" d="M524 180 V196" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="394" y="198" width="260" height="34" rx="17"/><text class="mid" x="524" y="215">导出静态词表与 .gram（运行时 0 ms）</text></g>
</svg>
<svg viewBox="0 0 340 500">
  <rect class="panel" x="0" y="0" width="340" height="238" rx="12"/>
  <rect class="panel" x="0" y="252" width="340" height="248" rx="12"/>
  <text class="caps" x="20" y="26">NAIVE APPROACHES</text>
  <g class="node plain"><rect x="20" y="44" width="300" height="30" rx="4"/><text class="mid" x="170" y="59">直接取 BPE 合并序号：仅 15 万子词</text></g>
  <text class="small accent" x="20" y="90">含跨词碎片，线性序号无法反映幂律差距</text>
  <g class="node plain"><rect x="20" y="106" width="300" height="30" rx="4"/><text class="mid" x="170" y="121">直接用序列对数似然：长词连乘偏小</text></g>
  <text class="small accent" x="20" y="152">尺度与现有万象 / ECDICT 词库不兼容</text>
  <g class="node plain"><rect x="20" y="168" width="300" height="30" rx="4"/><text class="mid" x="170" y="183">单一领域提示词：“的/问题”同步上涨</text></g>
  <text class="small accent" x="20" y="214">未扣除词条在日常语境下的基础概率</text>

  <text class="caps" x="20" y="278">CALIBRATED PIPELINE</text>
  <g class="node blue"><rect x="20" y="296" width="300" height="32" rx="4"/><text class="mid" x="170" y="312">1. BPE 前缀树前向（2.03× 路径压缩）</text></g>
  <path class="edge" d="M170 328 V342" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="20" y="344" width="300" height="32" rx="4"/><text class="mid" x="170" y="360">2. 10 万经验词频锚点回归与方差还原</text></g>
  <path class="edge" d="M170 376 V390" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="20" y="392" width="300" height="32" rx="4"/><text class="mid" x="170" y="408">3. 对称双提示词相减叠加领域增益</text></g>
  <path class="edge" d="M170 424 V438" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="30" y="440" width="280" height="34" rx="17"/><text class="mid" x="170" y="457">导出静态词表与 .gram（0 ms 延迟）</text></g>
</svg>
```

### 2. BPE 前缀树去重前向（Prefix-Trie Teacher Forcing）

待评分的中文与混合词条去重后共 `2,254,614` 条。如果逐条独立拼接语境前缀 $C$ 送入 `Qwen3-14B-Base`，大量共享前缀（如以 `"注意力"`、`"计算机"`、`"中华人民共和国"` 开头的词条）在 Transformer 中的前几步隐状态会被重复计算。

由于自回归因果掩码（Causal Mask）下位置 $i$ 的隐状态只依赖前缀 $(C, t_1, \dots, t_i)$，与后续 token 无关，可以将所有词条的真前缀 $t_{1:k-1}$ 构建为一棵 **BPE 前缀树**：

- 只将前缀树的叶子路径按相同 token 长度分组打包送入 GPU，同一批次内长度完全一致，无需 `pad` 填充；
- 树上的每个内部节点对应一条转移边集合，仅分配给经过该节点的第一条叶子路径负责取值；
- 在 GPU 上只对被分配的隐状态位置执行 `lm_head` 投影与 `logsumexp` 归约，通过稀疏索引直接取出目标后继 token 的对数概率 `z[row, tok] - logsumexp(z)`，不把 `[batch, 151936]` 的完整词表分布拷回主机内存。

```sketch title="BPE 前缀树去重：共享前缀在 Transformer 中只计算一次" note="实测 2,254,614 个中文词条被压缩为 1,110,808 条最长真前缀路径（2.03 倍压缩），与逐词独立前向的最大绝对误差为 0.040。"
<svg viewBox="0 0 704 220">
  <rect class="panel" x="0" y="0" width="704" height="220" rx="12"/>
  <text class="caps" x="24" y="28">PREFIX-TRIE TEACHER FORCING</text>
  <g class="node blue"><rect x="24" y="92" width="128" height="36" rx="4"/><text class="mid" x="88" y="110">语境前缀 C</text></g>
  <path class="edge" d="M152 110 H194" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="198" y="92" width="96" height="36" rx="4"/><text class="mid" x="246" y="110">注意力</text></g>
  <path class="edge" d="M294 110 H324 V58 H356" marker-end="url(#arrow)"/>
  <path class="edge" d="M294 110 H356" marker-end="url(#arrow)"/>
  <path class="edge" d="M294 110 H324 V162 H356" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="360" y="42" width="96" height="32" rx="4"/><text class="mid" x="408" y="58">机制</text></g>
  <g class="node teal"><rect x="360" y="94" width="96" height="32" rx="4"/><text class="mid" x="408" y="110">权重</text></g>
  <g class="node teal"><rect x="360" y="146" width="96" height="32" rx="4"/><text class="mid" x="408" y="162">分数</text></g>
  <rect class="window" x="484" y="38" width="196" height="146" rx="8"/>
  <text class="small b ink" x="500" y="64">GPU 稀疏收集</text>
  <text class="small mute" x="500" y="88">在“注意力”位置算一次</text>
  <text class="small mute" x="500" y="108">lm_head + logsumexp，</text>
  <text class="small mute" x="500" y="128">同时读出全部子分支边概率</text>
  <text class="small teal b" x="500" y="156">737 词/秒（单卡 A6000）</text>
  <text class="small mute" x="24" y="198">同长度叶子路径聚合成零填充批次，避免 pad token 浪费算力</text>
</svg>
<svg viewBox="0 0 340 310">
  <rect class="panel" x="0" y="0" width="340" height="310" rx="12"/>
  <text class="caps" x="20" y="26">PREFIX-TRIE SCORING</text>
  <g class="node blue"><rect x="20" y="44" width="124" height="32" rx="4"/><text class="mid" x="82" y="60">语境前缀 C</text></g>
  <path class="edge" d="M144 60 H176" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="180" y="44" width="140" height="32" rx="4"/><text class="mid" x="250" y="60">共享前缀：注意力</text></g>
  <path class="edge" d="M250 76 V96 H70 V112" marker-end="url(#arrow)"/>
  <path class="edge" d="M250 76 V96 H170 V112" marker-end="url(#arrow)"/>
  <path class="edge" d="M250 76 V96 H270 V112" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="24" y="116" width="92" height="30" rx="4"/><text class="mid" x="70" y="131">机制</text></g>
  <g class="node teal"><rect x="124" y="116" width="92" height="30" rx="4"/><text class="mid" x="170" y="131">权重</text></g>
  <g class="node teal"><rect x="224" y="116" width="92" height="30" rx="4"/><text class="mid" x="270" y="131">分数</text></g>
  <rect class="window" x="20" y="166" width="300" height="122" rx="8"/>
  <text class="small b ink" x="36" y="190">225.5 万词 → 111.1 万条叶子路径</text>
  <text class="small mute" x="36" y="214">共享节点只算一次 lm_head + logsumexp</text>
  <text class="small mute" x="36" y="236">GPU 端稀疏索引收集，零填充批次</text>
  <text class="small teal b" x="36" y="262">单卡 A6000 吞吐 737 词/秒，误差 0.040</text>
</svg>
```

### 3. 锚点回归校准与方差还原

从已有真实权重的 `rime_mint.base` 与 `wanxiang_jichu` 中，按词长和频次分位分层抽样 `100,000` 个词条作为监督锚点。对每个词条提取 11 维特征：

- 序列总对数概率 `sum_lp`、首 token 对数概率 `first_lp`、末 token 对数概率 `last_lp`、平均步对数概率 `mean_lp`、最小步对数概率 `min_lp`（用于识别含不自然断点的残缺百科标题）；
- token 数量 $k$、字符长度 $|w|$、首/最大/平均 token ID 以及字符集类别（纯中文、中英混合、纯英文）。

使用梯度提升树（`HistGradientBoostingRegressor`）在锚点集上拟合目标值 $y = \log_{10}(\text{weight} + 1)$。由于均方误差回归得到的预测分布标准差 $\sigma_{\hat{y}}$ 小于真实词频的对数标准差 $\sigma_y$，预测值向均值收缩，因此在输出前做一次线性方差还原：

$$
\hat{y}_{\text{cal}}(w) = \mu_y + \min\!\left(1.25,\; \frac{\sigma_y}{\sigma_{\hat{y}}}\right)\big(\hat{y}(w) - \mu_{\hat{y}}\big)
$$

在 `15,000` 个留出验证词上，单通用语境下验证集 $R^2 = 0.623$，平均绝对误差 $\text{MAE}_{\log_{10}} = 0.471$，Spearman 秩相关系数 $\rho = 0.733$（双语境特征下 `Qwen3.5-0.8B-Base` 为 $R^2 = 0.637$、$\rho = 0.735$）。未参与训练的常见词 `"原神"` 校准权重为 `11,889`（万象原值为 `12,425`），低频百科专名 `"朗格汉斯细胞"` 校准后权重为 `5`。英文词表同样以 `easy_en` 中的 ECDICT 非零权重为锚点，自动识别出窄区间线性尺度（`900,000 ~ 999,995`）并完成回归校准。

完成词频回写后，同步剔除了跨表完全重复的 `(词, 拼音)` 行以及 `easy_en` 中的 `574,295` 条零权重行，Rime 编译产物 `build/*.bin` 从 `296.0 MiB` 降至 `170.4 MiB`（缩减 $42.4\%$）。

## 三、领域词汇提升：对称提示词的对数几率比

在日常打字之外，如果希望提高计算机与人工智能（CS / AI / ML）术语的优先级，不能直接使用单个领域提示词（如 $C = \text{“在计算机科学中”}$）的概率作为加分项——因为 $\log P(w \mid C)$ 包含了词条本身的先验 $\log P(w)$，高频通用词（如 `"的"`、`"问题"`、`"方法"`）在该提示词后同样具有很高的条件概率。

要分离出词条与目标领域的纯粹关联度，可以构造一对句式结构对称的提示词：

- 通用语境 $C_{\text{gen}}$：`"日常与百科常见词条："`
- 领域语境 $C_{\text{CS}}$：`"计算机科学与人工智能术语："`

将同一棵前缀树分别接在 $C_{\text{CS}}$ 与 $C_{\text{gen}}$ 后各执行一次前向传播，计算两者的对数概率差：

$$
\Delta_{\text{CS}}(w) = \log P(w \mid C_{\text{CS}}) - \log P(w \mid C_{\text{gen}}) = \log \frac{P(C_{\text{CS}} \mid w)}{P(C_{\text{gen}} \mid w)} + \text{const}
$$

由贝叶斯公式，词条本身的基础常见度 $\log P(w)$ 在相减时抵消，$\Delta_{\text{CS}}(w)$ 对应词条在 CS 领域相对于通用语境的对数几率比（Log-Odds Lift）。

为了不改变日常词汇的原有排序，回归校准模型严格只使用通用语境 $C_{\text{gen}}$ 下的特征训练；仅当 $\Delta_{\text{CS}}(w) > 1.3\text{ nats}$（即在 CS 语境下出现几率比通用语境高出 $e^{1.3} \approx 3.67$ 倍）时，才在 $\log_{10}$ 权重空间叠加有界线性增益：

$$
\text{tilt}(w) = \text{clip}\!\big((\Delta_{\text{CS}}(w) - 1.3) \times 0.135,\; 0,\; 0.54\big)
$$

上限 $+0.54$ 对应在通用校准权重的基础上最多放大 $10^{0.54} \approx 3.47$ 倍。

```sketch title="对称双提示词相减：消去基础词频，分离领域对数几率比" note="括号内数值为 Qwen3-14B-Base 实测对数几率差（单位 nats）。"
<svg viewBox="0 0 704 218">
  <rect class="panel" x="0" y="0" width="704" height="218" rx="12"/>
  <text class="caps" x="24" y="28">FRAME-MATCHED BAYESIAN LOG-ODDS LIFT</text>
  <g class="node blue"><rect x="20" y="46" width="268" height="34" rx="4"/><text class="mid" x="154" y="63">领域：“计算机科学与人工智能术语：”</text></g>
  <g class="node plain"><rect x="20" y="92" width="268" height="34" rx="4"/><text class="mid" x="154" y="109">通用：“日常与百科常见词条：”</text></g>
  <path class="edge" d="M288 63 H306 V86 H320" marker-end="url(#arrow)"/>
  <path class="edge" d="M288 109 H306 V86 H320" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="324" y="66" width="168" height="40" rx="4"/><tex class="mid" x="408" y="86" width="136">\Delta_{\text{CS}} = \log \frac{P(w \mid C_{\text{CS}})}{P(w \mid C_{\text{gen}})}</tex></g>
  <path class="edge" d="M492 86 H504 V58 H514" marker-end="url(#arrow)"/>
  <path class="edge" d="M492 86 H504 V116 H514" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="518" y="42" width="166" height="32" rx="4"/><text class="mid" x="601" y="58">算子融合 +7.56 → ×3.5</text></g>
  <g class="node plain"><rect x="518" y="100" width="166" height="32" rx="4"/><text class="mid" x="601" y="116">原神 -3.50 → ×1.0</text></g>
  <text class="small mute" x="24" y="162">同时按对数几率差 ≥ 2.5 从基础词库筛出 1,463 条技术词，与 523 条校对过多音字的术语</text>
  <text class="small mute" x="24" y="184">合并为独立的 cs_ai.dict.yaml（共 1,986 条，含推测解码、分页注意力、双数组字典树、KV缓存等）</text>
</svg>
<svg viewBox="0 0 340 336">
  <rect class="panel" x="0" y="0" width="340" height="336" rx="12"/>
  <text class="caps" x="20" y="26">BAYESIAN DOMAIN LIFT</text>
  <g class="node blue"><rect x="20" y="42" width="276" height="30" rx="4"/><text class="mid" x="158" y="57">领域：“计算机科学与人工智能术语：”</text></g>
  <g class="node plain"><rect x="20" y="80" width="276" height="30" rx="4"/><text class="mid" x="158" y="95">通用：“日常与百科常见词条：”</text></g>
  <path class="edge" d="M296 57 H312 V95 H296"/>
  <path class="edge" d="M312 76 H320 V124 H170 V136" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="20" y="140" width="300" height="40" rx="4"/><tex class="mid" x="170" y="160" width="256">\Delta_{\text{CS}} = \log P(w\mid C_{\text{CS}}) - \log P(w\mid C_{\text{gen}})</tex></g>
  <path class="edge" d="M170 180 V194 H92 V206" marker-end="url(#arrow)"/>
  <path class="edge" d="M170 180 V194 H248 V206" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="20" y="210" width="144" height="32" rx="4"/><text class="mid" x="92" y="226">算子融合 +7.56</text></g>
  <g class="node plain"><rect x="176" y="210" width="144" height="32" rx="4"/><text class="mid" x="248" y="226">原神 -3.50</text></g>
  <text class="small teal b" x="58" y="260">加权 ×3.5</text>
  <text class="small mute" x="214" y="260">原权重 ×1.0</text>
  <text class="small mute" x="20" y="290">自动挖掘 + 多音字校对共 1,986 条术语</text>
  <text class="small mute" x="20" y="312">独立打包为 cs_ai.dict.yaml</text>
</svg>
```

在 `Qwen3-14B-Base` 的实测结果中，领域词与非领域词的对数几率比区分明确：例如 `算子融合`（$\Delta_{\text{CS}} = +7.56$，权重从通用校准值 `79` 提升至 `278`）、`前缀树`（$+6.12$，`51` $\to$ `178`）、`推测解码`（$+4.24$，`48` $\to$ `122`）、`幂等性`（$+4.21$，`49` $\to$ `124`）、`零拷贝`（$+2.57$，`140` $\to$ `208`）均触发提升；而日常或非本领域词条如 `5G`（$+0.41$，保持 `23,685`）、`B站`（$-2.64$，保持 `19,384`）、`朗格汉斯细胞`（$-2.71$，保持 `5`）、`原神`（$-3.50$，保持 `11,889`）均不满足 $\Delta_{\text{CS}} > 1.3$，完全保留通用语境下的校准权重。

利用计算出的 $\Delta_{\text{CS}}(w) \ge 2.5$（且通用对数似然不低于阈值），我还从基础词库中自动筛出了 `1,463` 条技术词条，与 `523` 条人工校对过多音字读音（如 `模[mó]型`、`量[liàng]化`、`可重[chóng]入`、`幂[mì]等`、`栈[zhàn]帧`）的术语合并为独立的 `cs_ai.dict.yaml`（共 `1,986` 条）。同时，使用同一套 14B 概率模型对本地个人用户词典 `rime_mint.userdb` 做了过滤，移除了 `2,012` 条 `c <= 0` 的失效记录、`23` 条单字重复连击记录以及 `562` 条仅输入过 1~2 次且模型似然极低的误敲词条（`c >= 3` 的高频记录保持不变）。

## 四、从语言模型输出头直接蒸馏 `.gram` 语法模型

校准静态词表后，单次输入一个词条的排序已经准确，但连续输入整句时仍依赖 `.gram` 语法模型提供跨词搭配分。如前文公式所示，`Octagram::Query(w_1, w_2)` 应当给出点互信息 $\text{PMI}(w_1, w_2) = \ln P(w_2 \mid w_1) - \ln P(w_2)$。

### 1. 利用 `lm_head` 输出分布矩阵直接计算双词 PMI

如果先让语言模型采样生成文本，再用分词器切分、跑 KenLM 统计频次，不仅耗时，还会再次引入分词器的词表边界偏差。事实上，给定上文词 $w_1$，模型最后一步隐状态 $h(w_1)$ 经输出头 `lm_head` 投影与 Log-Softmax 归一化后，输出的 $151{,}936$ 维向量就已经给出了所有可能后续 token 的精确条件概率分布。

统计中文词表中的约 9 万个常用候选词，其中 **`16,950` 个高频词在 Qwen3 的词表中本身就是单个 token**（记为 $\mathcal{V}_1$），另有 **`65,005` 个词恰好由两个 token 组成**（记为 $\mathcal{V}_2$）。利用这一分布特征，可以在 RTX A6000 上分三步直接读出语法模型所需的条目：

1. **单 token 后续词矩阵切片（$w_2 \in \mathcal{V}_1$）**：取词频最高的 `50,000` 个核心词（含全部 CS 术语）作为上文词 $w_1$，接在通用语句前缀后跑一次前向传播，在输出对数概率矩阵中直接切出 $\mathcal{V}_1$ 对应的 `16,950` 列，减去各词在无上文时的先验对数概率 $\ln P(w_2)$，约 2 分钟即可完成 $50{,}000 \times 16{,}950 \approx 8.5 \times 10^8$ 组二词搭配的条件概率与 PMI 计算。
2. **双 token 后续词一步前缀展开（$w_2 = (t_1, t_2) \in \mathcal{V}_2$）**：在同一输出分布中，对每个 $w_1$ 选出 $\mathcal{V}_2$ 中首 token 条件概率与 PMI 较高的前 $K$ 个首 token $t_1$，将 $(w_1, t_1)$ 拼接为新序列再向前推进 1 步（共 `145,079` 条短序列，A6000 上耗时约 6 分钟），从第二步输出向量中读取 $t_2$ 的条件对数概率，相加即得 $\ln P(w_2 \mid w_1)$。
3. **句尾收敛标记（`词$`）**：在 $w_1$ 的输出分布上汇总句末标点（`、`、`。`、`！`、`？`、`；`、`\n` 及 EOS token）的概率和 $\ln P(\text{EOS} \mid w_1)$，对句尾概率较高的词生成 `词$` 条目（共 `7,992` 条），用于辅助 `poet.cc` 在句末位置收敛。

```sketch title="在 lm_head 输出分布上展开单 token 词对、双 token 前缀与句尾标记" note="单张 RTX A6000 总耗时 16.6 分钟（含 56.5 万条同音错字比对与漏收成语评分）。"
<svg viewBox="0 0 704 228">
  <rect class="panel" x="0" y="0" width="704" height="228" rx="12"/>
  <text class="caps" x="24" y="28">DIRECT LOGIT MATRIX &amp; 1-STEP TREE EXPANSION</text>
  <g class="node clay"><rect x="24" y="92" width="136" height="36" rx="18"/><text class="mid" x="92" y="110">50,000 个上文词</text></g>
  <path class="edge" d="M160 110 H188" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="192" y="92" width="144" height="36" rx="4"/><text class="mid" x="264" y="110">输出头概率向量</text></g>
  <path class="edge" d="M336 110 H366 V54 H396" marker-end="url(#arrow)"/>
  <path class="edge" d="M336 110 H396" marker-end="url(#arrow)"/>
  <path class="edge" d="M336 110 H366 V166 H396" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="400" y="38" width="280" height="32" rx="4"/><text class="mid" x="540" y="54">单 token 后续词（8.5 亿词对，2 分钟）</text></g>
  <g class="node plain"><rect x="400" y="94" width="280" height="32" rx="4"/><text class="mid" x="540" y="110">首 token 展开一步 → 覆盖双 token 词</text></g>
  <g class="node violet"><rect x="400" y="150" width="280" height="32" rx="4"/><text class="mid" x="540" y="166">聚合句末标点概率 → 7,992 条句尾 $</text></g>
  <text class="small mute" x="24" y="206">准入条件：cond_lp ≥ -5.65 且 PMI ≥ 2.35，防止低概率搭配跨过 -6.0 未命中惩罚阈值</text>
</svg>
<svg viewBox="0 0 340 330">
  <rect class="panel" x="0" y="0" width="340" height="330" rx="12"/>
  <text class="caps" x="20" y="26">DIRECT LOGIT EXPANSION</text>
  <g class="node clay"><rect x="20" y="44" width="136" height="32" rx="16"/><text class="mid" x="88" y="60">5 万个上文词</text></g>
  <path class="edge" d="M156 60 H182" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="186" y="44" width="134" height="32" rx="4"/><text class="mid" x="253" y="60">输出头概率向量</text></g>
  <path class="edge" d="M253 76 V96 H18 V218"/>
  <path class="edge" d="M18 134 H32" marker-end="url(#arrow)"/>
  <path class="edge" d="M18 176 H32" marker-end="url(#arrow)"/>
  <path class="edge" d="M18 218 H32" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="36" y="118" width="284" height="32" rx="4"/><text class="mid" x="178" y="134">单 token 矩阵直读（8.5 亿词对）</text></g>
  <g class="node plain"><rect x="36" y="160" width="284" height="32" rx="4"/><text class="mid" x="178" y="176">首 token 展开 1 步（双 token 词）</text></g>
  <g class="node violet"><rect x="36" y="202" width="284" height="32" rx="4"/><text class="mid" x="178" y="218">句末标点聚合（生成 7,992 条词$）</text></g>
  <text class="small mute" x="20" y="264">准入条件：cond_lp ≥ -5.65 且 PMI ≥ 2.35</text>
  <text class="small mute" x="20" y="286">防止低概率搭配跨过 -6.0 未命中惩罚阈值</text>
  <text class="small teal b" x="20" y="308">单卡 A6000 全流程耗时 16.6 分钟</text>
</svg>
```

### 2. `Octagram` 未命中惩罚与稀疏准入阈值

在 `librime-octagram` 的实现中，`.gram` 双数组前缀树里存储的正整数 $v$ 按下式还原为对数得分（默认 `collocation_penalty = -14.0`，缩放因子 `10000`）：

$$
s_{\text{hit}} = -14.0 + \frac{v}{10000}
$$

而当某个词对未收录在 `.gram` 中（查询返回 `-1`）时，引擎固定返回 `non_collocation_penalty = -6.0`。

这一分段定义带来了一个阈值效应：任何词对只要被写入 `.gram` 且存储值 $v \ge 155{,}000$（即 $s_{\text{hit}} \ge +1.5$），它相对于未收录词对就会获得至少 $+7.5\text{ nats}$（约 $1{,}800$ 倍）的固定跳变。如果蒸馏时的准入阈值放得过宽（例如初版尝试的 $\ln P(w_2 \mid w_1) \ge -8.0$），大量条件概率偏低的弱搭配也会被写入 `.gram` 并跨过 `-6.0` 的惩罚线，从而缩窄了高频正确搭配与非常规搭配之间的得分差（初版 `53.6 MiB` 纯蒸馏模型在测试集上的首选率为 `83.80%`）。

将准入条件收紧为 **$\ln P(w_2 \mid w_1) \ge -5.65$ 且 $\text{PMI}(w_1, w_2) \ge 2.35$** 后，低概率边缘词对不再写入前缀树，纯蒸馏模型 `qwen14b-zh-hans.gram` 的键数量收敛到 **`1,031,842` 条**，文件体积从 `53.6 MiB` 降至 **`11.4 MiB`（`.gz` 压缩包 `9.4 MiB`）**，端到端首选率则从 `83.80%` 升至 **`90.85%`**。

### 3. 存量语料 `.gram` 的同音错字清洗与流式归并

除了编译纯蒸馏的 `11.4 MiB` 独立模型，我还用 C++ 编写了基于 `darts.h` 的 `.gram` 工具 `tools/gram_tool.cc`，对原有的 `wanxiang-lts-zh-hans.gram` 做了一次清洗与合并：

1. **同音与近音碰撞扫描**：遍历原版 `.gram` 中数值 $\ge 158{,}000$、长度在 3~6 字之间且不在基础词典中的条目，将每个汉字按平翘舌（`zh/ch/sh` $\to$ `z/c/s`）与前后鼻音（`ing/eng/ang` $\to$ `in/en/an`）归一化后与基础词典词条做哈希匹配，共扫出 `203,796` 对同音或单字近音候选。
2. **14B 逐字概率比对**：用 `Qwen3-14B-Base` 计算候选条目与对应正字词条的逐字平均对数概率 $\text{sum\_lp} / |w|$。为避免误删多字不同的古语词（如“秾纤适宜”与近音词“浓香四溢”有 4 个字不同），限定仅当两词字形汉明距离为 1（模糊音匹配）或 $\le 2$（严格同音）且疑似错字的逐字概率显著低于正字时才判定为错别字，共清退 **`48,178` 条**网页同音错搭。
3. **补回漏收成语与归并编译**：将原版 `.gram` 中遗漏的 `28.7` 万条词典成语/词组经 14B 评分后补回高置信度项，剪除原版低于 `140,000` 的弱尾项，再与 14B 蒸馏出的 `103.2` 万条搭配按字典序流式归并，编译为 `wanxiang-qwen14b-zh-hans.gram`（`61,781,930` 条键，体积从 `400.8 MiB` 降至 `385.5 MiB`）。

```sketch title="语料分词统计与直接读取 lm_head 蒸馏及清洗流程的对比" note="纯蒸馏模型体积为 11.4 MiB（约为原版 400.8 MiB 的 1/35）；融合去噪模型体积为 385.5 MiB。"
<svg viewBox="0 0 704 224">
  <rect class="panel" x="0" y="0" width="344" height="224" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="224" rx="12"/>
  <text class="caps" x="24" y="28">CORPUS + JIEBA + KENLM</text>
  <g class="node plain"><rect x="24" y="48" width="296" height="32" rx="4"/><text class="mid" x="172" y="64">48 GB 网页语料 → 结巴分词 → KenLM</text></g>
  <text class="small accent" x="24" y="102">1. 词典内四字成语按 1-gram 缩放，下溢丢失</text>
  <text class="small accent" x="24" y="126">2. 网页同音错字切为 2/3-gram，获高分奖励</text>
  <text class="small accent" x="24" y="150">3. 句尾 $ 标记仅 6,746 条，缺少新近技术搭配</text>
  <text class="small mute" x="24" y="192">产物：wanxiang-lts-zh-hans.gram（400.8 MiB）</text>

  <text class="caps" x="384" y="28">LM_HEAD PMI DISTILLATION &amp; AUDIT</text>
  <g class="node blue"><rect x="384" y="48" width="296" height="32" rx="4"/><text class="mid" x="532" y="64">直接读取 lm_head 计算精确双词 PMI</text></g>
  <path class="edge" d="M532 80 V96" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="384" y="100" width="296" height="32" rx="4"/><text class="mid" x="532" y="116">纯蒸馏模型：11.4 MiB（.gz 9.4 MiB）</text></g>
  <path class="edge dash" d="M532 132 V148" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="384" y="152" width="296" height="32" rx="4"/><text class="mid" x="532" y="168">可选归并版：清退错字后 385.5 MiB</text></g>
  <text class="small mute" x="384" y="204">103.2 万条高 PMI 搭配 + 7,992 条句尾 $ 标记</text>
</svg>
<svg viewBox="0 0 340 440">
  <rect class="panel" x="0" y="0" width="340" height="206" rx="12"/>
  <rect class="panel" x="0" y="220" width="340" height="220" rx="12"/>
  <text class="caps" x="20" y="26">CORPUS + JIEBA + KENLM</text>
  <g class="node plain"><rect x="20" y="44" width="300" height="30" rx="4"/><text class="mid" x="170" y="59">网页语料 → 结巴分词 → KenLM</text></g>
  <text class="small accent" x="20" y="98">1. 词典内成语按 1-gram 缩放下溢丢失</text>
  <text class="small accent" x="20" y="122">2. 网页同音错字切为 2/3-gram 获高分</text>
  <text class="small accent" x="20" y="146">3. 缺少句尾 $ 标记与新近技术搭配</text>
  <text class="small mute" x="20" y="182">原版体积：400.8 MiB（6,549 万键）</text>

  <text class="caps" x="20" y="246">LM_HEAD PMI DISTILLATION</text>
  <g class="node blue"><rect x="20" y="264" width="300" height="30" rx="4"/><text class="mid" x="170" y="279">直接读取 lm_head 计算精确 PMI</text></g>
  <path class="edge" d="M170 294 V310" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="20" y="314" width="300" height="30" rx="4"/><text class="mid" x="170" y="329">纯蒸馏模型：11.4 MiB（.gz 9.4 MiB）</text></g>
  <path class="edge dash" d="M170 344 V360" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="20" y="364" width="300" height="30" rx="4"/><text class="mid" x="170" y="379">可选归并版：清退错字后 385.5 MiB</text></g>
  <text class="small mute" x="20" y="416">含 103.2 万条搭配与 7,992 条句尾 $</text>
</svg>
```

## 五、端到端 `librime` 消融评测与使用方法

为了量化每一层改动对实际解码的影响，我编写了直接动态加载 `librime`、`librime-octagram` 与 `librime-lua` 的 C++ 评测器（`rime-qwen-freq bench`）。评测默认在隔离的零用户词典（0-`userdb`）临时沙箱中运行，不读取也不修改本机正在使用的 `*.userdb`。

测试集（`bench/bench_cases.tsv`）共 142 条长度不超过 25 键的连续全拼输入，分为六个子集：40 条 CS/AI 连续整句、35 条技术复合词与多音词、20 条中英混输、12 条上下文联想消歧、18 条百科抢权与同音混淆用例，以及 17 条日常口语对照语句。四个阶段在相同拼音规则下的评测结果如下：

```plot title="四个阶段的 librime 端到端首选准确率消融对比" note="测试集共 142 条（bench/bench_cases.tsv，零 userdb 隔离环境）；纯 14B 开源 .gram 体积为 11.4 MiB，总体首选率高于 400.8 MiB 的原版语料 .gram。"
{
  "cols": 2,
  "xlabel": "首选准确率 (%)",
  "legend": [
    {"label": "原配置基线", "color": "var(--stone)", "shape": "dot"},
    {"label": "+ 14B 词表校准", "color": "var(--blue)", "shape": "dot"},
    {"label": "纯 14B 开源 .gram（11.4 MiB）", "color": "var(--teal)", "shape": "dot"},
    {"label": "14B 词表 + 融合 .gram", "color": "var(--clay)", "shape": "dot"}
  ],
  "panels": [
    {
      "title": "分阶段总体首选率（Top-1 %）",
      "height": 270,
      "narrowHeight": 230,
      "x": {"domain": [0, 114], "label": null},
      "y": {"label": null, "domain": ["原配置基线", "+ 14B 词表校准", "+ 纯 14B .gram", "+ 融合去噪 .gram"]},
      "grid": true,
      "marks": [
        {"mark": "barX", "data": [
          {"stage": "原配置基线", "acc": 38.03, "c": "base"},
          {"stage": "+ 14B 词表校准", "acc": 88.73, "c": "dict"},
          {"stage": "+ 纯 14B .gram", "acc": 90.85, "c": "pure"},
          {"stage": "+ 融合去噪 .gram", "acc": 92.25, "c": "hyb"}
        ], "x": "acc", "y": "stage", "fill": "c", "tip": ["stage", "acc"]},
        {"mark": "text", "data": [
          {"stage": "原配置基线", "acc": 38.03, "lbl": "38.0%"},
          {"stage": "+ 14B 词表校准", "acc": 88.73, "lbl": "88.7%"},
          {"stage": "+ 纯 14B .gram", "acc": 90.85, "lbl": "90.9%"},
          {"stage": "+ 融合去噪 .gram", "acc": 92.25, "lbl": "92.3%"}
        ], "x": "acc", "y": "stage", "text": "lbl", "dx": 22, "fill": "var(--ink)"}
      ],
      "color": {
        "domain": ["base", "dict", "pure", "hyb"],
        "range": ["var(--stone)", "var(--blue)", "var(--teal)", "var(--clay)"]
      }
    },
    {
      "title": "分题型首选率对比（%）",
      "height": 270,
      "narrowHeight": 240,
      "x": {"domain": [0, 108], "label": null},
      "y": {"label": null, "domain": ["CS 整句", "CS 术语", "中英混输", "上下文消歧", "同音混淆", "日常语句"]},
      "grid": true,
      "marks": [
        {"mark": "link", "data": [
          {"cat": "CS 整句", "x1": 22.5, "x2": 95.0},
          {"cat": "CS 术语", "x1": 40.0, "x2": 100.0},
          {"cat": "中英混输", "x1": 5.0, "x2": 100.0},
          {"cat": "上下文消歧", "x1": 41.7, "x2": 83.3},
          {"cat": "同音混淆", "x1": 44.4, "x2": 77.8},
          {"cat": "日常语句", "x1": 100.0, "x2": 100.0}
        ], "x1": "x1", "x2": "x2", "y1": "cat", "y2": "cat", "stroke": "var(--line)", "strokeWidth": 2},
        {"mark": "dot", "data": [
          {"cat": "CS 整句", "v": 22.5},
          {"cat": "CS 术语", "v": 40.0},
          {"cat": "中英混输", "v": 5.0},
          {"cat": "上下文消歧", "v": 41.7},
          {"cat": "同音混淆", "v": 44.4},
          {"cat": "日常语句", "v": 100.0}
        ], "x": "v", "y": "cat", "fill": "var(--stone)", "r": 4.5, "tip": ["cat", "v"]},
        {"mark": "dot", "data": [
          {"cat": "CS 整句", "v": 85.0},
          {"cat": "CS 术语", "v": 100.0},
          {"cat": "中英混输", "v": 100.0},
          {"cat": "上下文消歧", "v": 83.3},
          {"cat": "同音混淆", "v": 77.8},
          {"cat": "日常语句", "v": 94.1}
        ], "x": "v", "y": "cat", "dy": -3.2, "fill": "var(--teal)", "r": 4.2, "tip": ["cat", "v"]},
        {"mark": "dot", "data": [
          {"cat": "CS 整句", "v": 95.0},
          {"cat": "CS 术语", "v": 100.0},
          {"cat": "中英混输", "v": 100.0},
          {"cat": "上下文消歧", "v": 83.3},
          {"cat": "同音混淆", "v": 61.1},
          {"cat": "日常语句", "v": 100.0}
        ], "x": "v", "y": "cat", "dy": 3.2, "fill": "var(--clay)", "r": 4.5, "tip": ["cat", "v"]}
      ]
    }
  ]
}
```

从消融结果可以看到三点：

1. **词表先验校准提供了最大幅度的准确率提升（总体首选率从 `38.03%` 升至 `88.73%`，逐字准确率从 `65.38%` 升至 `96.28%`）**：将 214.4 万条百科词条的 `60000` 常数还原为长尾分布、补齐 `cs_ai` 与中英混输权重后，35 条 CS 术语与 20 条中英混输词条全部首选命中（`100.0%`），CS 整句准确率从 `22.5%`（9/40）升至 `82.5%`（33/40）。
2. **`11.4 MiB` 的纯蒸馏 `.gram` 总体表现优于 `400.8 MiB` 的原版语料 `.gram`（`90.85%` vs `88.73%`）**：完全不依赖外部文本语料、仅从 `Qwen3-14B-Base` 输出头蒸馏出的 `qwen14b-zh-hans.gram`，体积约为原版的 $1/35$，在同音混淆（`77.8%` vs `66.7%`）、上下文消歧（`83.3%` vs `75.0%`）和 CS 整句（`85.0%` vs `82.5%`）上均高于原版语料模型，仅在 1 条日常口语惯用语上未命中（日常语句 `16/17`）。
3. **纯蒸馏模型与融合去噪模型之间的取舍（总体 `90.85%` vs `92.25%`）**：融合模型保留了大语料的日常短语覆盖，使 CS 整句首选率进一步升至 `95.0%`（38/40）、日常语句回到 `100.0%`（17/17）、逐字准确率达到 `97.79%`；但在“同音混淆”子集上，融合模型（`61.1%`，11/18）低于纯 14B 蒸馏模型（`77.8%`，14/18）。原因在于前文的错字过滤只清理了词典外的非词错搭，而像 `"说话直接了当"`（正字为 `"直截了当"`）、`"损失已经熟练了"`（近音误替 `"收敛"`）这类由合法词典词条拼合而成的网页高频误用仍保留在原版语料树中；纯 14B 蒸馏模型则不含这类网页共现噪声。

### 开源词库与复现命令

代码、评测器以及基于 `Qwen3-14B-Base` 构建好的词表和独立语法模型已发布在 [mizorewww/rime-qwen-freq](https://github.com/mizorewww/rime-qwen-freq)（[Releases](https://github.com/mizorewww/rime-qwen-freq/releases/latest) 页面可直接下载 `qwen14b-zh-hans.gram.gz`、`cs_ai.dict.yaml.gz`、`zhwiki.dict.yaml.gz` 等成品压缩包，解压放入 Rime 目录重新部署即可使用）。

如需在本地自定义词表上运行或更换其他领域提示词：

```bash
git clone https://github.com/mizorewww/rime-qwen-freq.git
cd rime-qwen-freq
pip install -e ".[score]"
c++ -O3 -std=c++17 tools/gram_tool.cc -o gram_tool

# 1. 扫描并校准本地 Rime 词表（支持 --domain-prompt 指定目标领域）
rime-qwen-freq inspect
rime-qwen-freq run --model Qwen/Qwen3-14B-Base \
  --domain-prompt "计算机科学与人工智能术语：" \
  --general-prompt "日常与百科常见词条：" --deploy

# 2. 从语言模型蒸馏并编译独立 .gram 语法模型
rime-qwen-freq distill-ngram -o ngrams.tsv.gz --model Qwen/Qwen3-14B-Base
gunzip -k ngrams.tsv.gz && ./gram_tool build ngrams.tsv qwen14b-zh-hans.gram

# 3. 在零 userdb 隔离沙箱中运行原生 librime 端到端评测
rime-qwen-freq bench --rime-dir ~/Library/Rime --schema rime_mint
```
