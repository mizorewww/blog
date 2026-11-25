---
title: "用基座大模型给 Rime 离线蒸馏词频与语法模型"
description: "Rime 的第三方扩展词库（如维基百科、专业术语、中英混输）通常只有词条而没有词频，现成语法模型也受限于网页语料与分词噪声。本文介绍如何根据 librime 的打分公式，用 Qwen3-14B-Base 在离线阶段完成词频校准、对称提示词领域提权与 lm_head 点互信息语法模型蒸馏。"
date: 2026-11-25
tag: "技术"
tags:
  - "rime"
  - "llm"
  - "ime"
  - "distillation"
---

给 Rime 输入法扩充词库（比如加入维基百科、萌娘百科、中英混输或计算机专业术语）时，首先会遇到一个数据问题：**这些扩展词库只有词条和拼音，没有词频**。

像万象、雾凇这类主力基础词库，带有从大规模语料统计出的真实词频；但从百科标题或术语表导出的数百万扩展词条，原始数据只是一份词条列表。转换脚本在生成 `.dict.yaml` 时，要么把权重列留空，要么给整张表填一个统一的默认占位值。

把这些没有真实词频的扩展表合进输入法后，重码排序就会失真：生僻百科专名可能排到日常词前面，常用的中英混输或新近专业术语又排不上去。而到了整句连续输入阶段，现有的 `.gram` 语法模型依赖网页爬虫语料和 `jieba` 分词计数，既缺少近两年的技术词汇搭配，又把网页里的同音错别字带进了高分候选。

要修好词表排序和整句组词，需要做两件事：
1. 给没有词频的扩展词表补上与主力词库尺度一致的**单字/单词先验词频**；
2. 给常用词对算出准确的**上下文搭配得分**，编入 `.gram` 语法模型。

传统做法是自己收集几十 GB 的分领域语料，跑分词器再统计频次。但开源基座大模型（如 `Qwen3-14B-Base`）已经在数万亿 token 的多语种网页、百科、代码和论文上做完了下一词预测训练——每个词出现的先验概率、它属于哪个专业领域、以及两个词连在一起的条件概率，都已经编码在模型参数里了。

只要在**离线阶段**把这些概率分布从模型里读出来，转换成 Rime 原有的 `.dict.yaml` 整数权重和 `.gram` 双数组前缀树，打字时就完全不需要运行神经网络，依然是 0 毫秒延迟的静态内存映射查表。全套工具、评测器与生成好的词库和语法模型已开源在 [mizorewww/rime-qwen-freq](https://github.com/mizorewww/rime-qwen-freq)。

---

## 一、先看 Rime 是怎么给候选词打分的

要决定应该从大模型里提取什么物理量，先要看 Rime 引擎在底层是怎么用词表和语法模型算分的。

在 `librime` 源码（`poet.cc` 与 `dict_compiler.cc`）中，整句输入沿着音节图做宽度为 7 的束搜索（Beam Search）。当路径从前文 `context` 走到下一个候选词 `word` 时，这一步的增量得分由两项相加：

$$
\text{Score}(\text{context} \to \text{word}) = \ln \text{weight}(\text{word}) + \text{Octagram}(\text{context}, \text{word})
$$

其中：
- 第一项 $\ln \text{weight}(\text{word})$ 来自 `.dict.yaml` 词表里的权重列，代表这个词在没有上文时的**对数先验概率 $\ln P(\text{word})$**；
- 第二项 $\text{Octagram}(\text{context}, \text{word})$ 来自 `librime-octagram` 插件查询 `.gram` 文件返回的分数，代表**看到前文 `context` 后对当前词的上下文加分**。

如果希望整句解码排第一的候选路径恰好是自然语言里条件概率最高的那句话，上面两项之和就应该等于真实的马尔可夫条件对数概率 $\ln P(\text{word} \mid \text{context})$。对比公式两边，可以推出这两份静态数据必须满足的数学条件：

1. **所有合并词表的权重 $\text{weight}(w)$ 必须与词项概率 $P(w)$ 成正比**。这样取对数后 $\ln \text{weight}(w) = \ln P(w) + C$，不同词表之间只差同一个全局常数 $C$，放在一起比大小才公平；
2. **`.gram` 语法模型存的不能是共现频次，而应当是点互信息（PMI）**。因为第一项已经加过一次 $\ln P(\text{word})$ 了，要让两项相加等于 $\ln P(\text{word} \mid \text{context})$，第二项 `Octagram` 必须把被加重的那份先验扣掉：
   $$
   \text{PMI}(\text{context}, \text{word}) = \ln P(\text{word} \mid \text{context}) - \ln P(\text{word})
   $$
   它的含义很直观：**看到上文之后，当前词出现的概率比它平时单独出现时提升了多少倍**。

对照这两个条件检查本机原有的词表和语法包，就能看清现有数据的问题出在哪里。

### 1. 现有扩展词表：缺少词频，与主力词库尺度脱节

主力基础词库 `wanxiang_jichu.dict.yaml` 的权重来自真实语料统计，全表中位数（P50）是 `279`，$99\%$ 分位（P99）是 `5,256`，最高频词上限为 `350,000`。

而第三方扩展词表（维基百科 `zhwiki` 172.8 万条、维基词典 `zhwiktionary` 28.6 万条、萌娘百科 `moegirl` 13.0 万条、中英混输 `wanxiang_mixed`、英文扩展 `rime_ice.en` 等）原本只有词条列表，没有词频数据。转换工具只能做两种粗略处理：
- 中英混输与英文扩展表直接省掉了权重列，编译时落回极低默认值，常用技术词很难排到前面；
- 214.4 万条百科词条被转换脚本统一填上了默认占位值 `60000`。这使所有生僻百科词条在公式第一项中都拿到 $\ln(60000) \approx 11.0$ 的高分，压过了基础词库里 $99.9\%$ 的日常词。比如连续输入 `fanxiangchuanboyutidu` 时，`zhwiki` 里的明代人名“范骧”会排在“反向”前面，输出“范骧传播与梯度”。

此外，多份词表直接合并还带来了大量重复行：`wanxiang_jichu` 里有 131.4 万行（$88\%$）与 `rime_mint.base` 完全重复，百科词表与基础词库重复 36.2 万行，英文表 `easy_en` 74.5 万行里有 57.4 万行权重为 `0`，使编译后的 `build/*.bin` 膨胀到了 `296.0 MiB`。

### 2. 现有 `.gram` 语法包：分词阶数偏差导致漏收成语、奖励错别字

我写了一个 C++ 小工具遍历本机原有的 `wanxiang-lts-zh-hans.gram`（体积 `400.8 MiB`，共 6,549 万条记录），去查常见成语和同音错别字的分值（`-1` 表示未收录，解码时扣 `-6.0` 分；收录项数字越大加分越高）：

- 正字 `川流不息 = -1`（未收录），同音错字 `穿流不息 = 180,687`（净加 `+4.07` 分）；
- 正字 `莫名其妙 = -1`（未收录），同音错字 `莫明其妙 = 164,433`（净加 `+2.44` 分）；
- 正字 `再接再厉 = 176,835`（加 `+3.68`），同音错字 `再接再励 = 200,616`（加 `+6.06`）；
- 其他高分错字还有 `整行医院 = 231,925`、`初略统计 = 235,638`、`强联通分量 = 223,327`、`方向传播 = 177,727`。

为什么正字成语反而没收进去、网页错别字却拿了高分？原因在于上游的构建脚本：它先用 `jieba` 给 48 GB 网页语料分词，再喂给 KenLM 统计 $n$-gram 概率，最后把每阶的概率**乘上该阶的词条总种类数 `ngrams_counts[n]`** 转成整数：

- 正常的四字成语（如“川流不息”、“莫名其妙”）在 `jieba` 词典里本来就是一个完整的词，分词时不会被切开，只能算作 **1-gram**。1-gram 的总种类数很小，乘出来四舍五入就下溢归零被丢掉了。本机词典里权重 $\ge 25$ 的 3~6 字词组和成语，在原版 `.gram` 里一共因此漏掉了 **28.7 万条**。
- 相反，网页上的同音错别字（“穿流不息”、“再接再励”、“整行医院”）不在 `jieba` 词典里，被切碎成了 **2-gram 或 3-gram**（如 `"穿 / 流 / 不息"`），乘上了 3-gram 千万量级的基数，直接变成了 18 万~23 万的高分。结果敲 `xiwangdajiazaijiezaili` 时，语法模型自己就会把正字改成“希望大家再接再励”。

```sketch title="Rime 打分公式中的两项数据问题：扩展词表缺少真实词频与语法模型分词阶数偏差" note="词表先验项（.dict.yaml）：扩展词表原始数据无词频，留空或填统一占位值；语法模型项（.gram）：结巴分词 1-gram 与 3-gram 基数差异导致成语下溢、错字高分。"
<svg viewBox="0 0 704 250">
  <rect class="panel" x="0" y="0" width="344" height="250" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="250" rx="12"/>
  <text class="caps" x="24" y="28">UNIGRAM PRIOR</text>
  <text class="small b ink" x="24" y="52">基础词库 wanxiang_jichu（有语料词频）</text>
  <g class="node teal"><rect x="24" y="64" width="136" height="32" rx="4"/><text class="mid" x="92" y="80">P50 = 279</text></g>
  <g class="node plain"><rect x="168" y="64" width="152" height="32" rx="4"/><text class="mid" x="244" y="80">P99 = 5,256</text></g>
  <text class="small b ink" x="24" y="124">扩展词表 zhwiki / 词典 / 萌娘 / 混输</text>
  <g class="node clay"><rect x="24" y="136" width="296" height="34" rx="6"/><text class="mid" x="172" y="153">原始数据无词频（留空或统一填占位值）</text></g>
  <text class="small accent" x="24" y="196">无法区分词条常见度，与基础词库尺度脱节</text>
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
  <text class="small b ink" x="20" y="52">基础词库 wanxiang_jichu（有语料词频）</text>
  <g class="node teal"><rect x="20" y="64" width="142" height="32" rx="4"/><text class="mid" x="91" y="80">P50 = 279</text></g>
  <g class="node plain"><rect x="170" y="64" width="150" height="32" rx="4"/><text class="mid" x="245" y="80">P99 = 5,256</text></g>
  <text class="small b ink" x="20" y="122">扩展词表 zhwiki / 词典 / 萌娘 / 混输</text>
  <g class="node clay"><rect x="20" y="134" width="300" height="34" rx="6"/><text class="mid" x="170" y="151">原始数据无词频（留空或填统一占位值）</text></g>
  <text class="small accent" x="20" y="194">无法区分常见度，与基础词库尺度脱节</text>
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

---

## 二、具体做法（上）：怎么用大模型给无词频词表补词频

先解决第一个问题：手头有 225.5 万条没有真实词频的中文、百科和中英混输词条，怎么用 `Qwen3-14B-Base` 给它们算出和万象基础词库尺度一致的整数词频？

整个流程分三步：**固定前文读取生成概率 $\to$ 用主力词库当标尺做回归映射 $\to$ 用前缀树合并重复计算**。

### 1. 模型怎么给一个词打分：在固定语境下读取每一步的预测概率

基座大模型的核心能力是：给定一段前文，输出词表里所有 token（Qwen3 词表共 151,936 个 token）作为下一个位置的概率分布。

要测量任意一个词条 $w$ 在自然语言里有多常见，先固定一段中立的通用前文，例如：
`C = "日常与百科常见词条："`
然后测量模型在这段话后面**接着写出词条 $w$ 的条件概率 $P(w \mid C)$**。

以词条 `"深度学习"` 为例，分词器会把它切成 `["深度", "学习"]` 两个 token。算分不需要让模型自由生成，只需做一次已知文本的前向计算（Teacher Forcing）：
1. 在前文 `"日常与百科常见词条："` 的最后一个位置，从模型预测的下一词概率分布里，直接查出 `"深度"` 这个 token 的对数概率 $\ln P(\text{深度} \mid C)$；
2. 在 `"日常与百科常见词条：深度"` 的位置，再从模型预测的下一词分布里，查出 `"学习"` 的对数概率 $\ln P(\text{学习} \mid C, \text{深度})$；
3. 根据概率乘法链式法则，把两步的对数概率加起来，就是模型写出整个词的对数似然：
   $$
   \ln P(\text{深度学习} \mid C) = \ln P(\text{深度} \mid C) + \ln P(\text{学习} \mid C, \text{深度})
   $$

一般地，对任意包含 $k$ 个 token 的词条 $w = (t_1, t_2, \dots, t_k)$，它的总对数概率就是 $k$ 步条件对数概率之和：

$$
\ln P(w \mid C) = \sum_{i=1}^{k} \ln P(t_i \mid C, t_1, \dots, t_{i-1})
$$

这个值为什么能反映词频？因为模型在预训练时见过越多次的词，在 `"日常与百科常见词条："` 后面预测出它的概率就越高；常见词（如 `"机器学习"`、`"原神"`）算出来的对数概率明显高于生僻词（如 `"朗格汉斯细胞"`）。

### 2. 为什么不能直接用这个概率，以及怎么对齐到万象词库尺度

拿到每个词的 $\ln P(w \mid C)$ 之后，还不能直接把它指数化写进词表，因为存在两个问题：

- **长词连乘偏置**：每一步的概率都小于 $1$（对数都是负数）。一个 4 字词如果被切成 3 个 token，就要累加 3 个负数；而一个 2 字词可能只有 1 个 token，只算 1 个负数。直接比总和，长词天然比短词小几个数量级；如果改用平均每步概率 $\frac{1}{k}\ln P(w \mid C)$，又会反过来高估多字生僻词。
- **量纲不一致**：模型输出的是负对数似然（比如 $-5.4$、$-13.2$），而现有主力词库（如万象 `wanxiang_jichu`）使用的是 `1 ~ 350,000` 的正整数，英文词库 `easy_en` 使用的是 `900,000 ~ 999,995` 的线性整数。

**解决办法是：直接拿主力词库里已有的真实词频当“标尺”，训练一个回归校准器。**

具体做法很直接：主力词库 `rime_mint.base` 和 `wanxiang_jichu` 里本来就有几十万个带真实语料权重的词。我按词长和频次分层抽样出 `100,000` 个词作为参照锚点，同样用上面的方法算出它们在 `Qwen3-14B-Base` 下的概率特征：
- **总对数概率**与**平均每步对数概率**（反映整体常见度）；
- **首尾 token 对数概率**；
- **最小单步对数概率**（专门用来识别百科里的残缺标题：比如带半截括号或生硬拼接的词条，在拼接处那一步的转移概率会极低）；
- **词长特征**（token 个数 $k$、字符字数 $|w|$、token 序号统计量）。

这 10 万个锚点词既有“模型算出的概率特征”，又有“万象词库里的真实权重 $y = \log_{10}(\text{weight} + 1)$”。用它们训练一棵正则化梯度提升树（`HistGradientBoostingRegressor`），回归树就会自动学出**在不同字数和 token 长度下，多高的模型概率对应万象词库里多大的整数权重**。

最后，因为最小二乘回归预测出的数值分布标准差 $\sigma_{\hat{y}}$ 会比真实词频的标准差 $\sigma_y$ 略窄（高频端偏低、低频端偏高），在输出前做一次简单的线性方差对齐，把分布跨度还原回锚点词库的真实宽度：

$$
\hat{y}_{\text{cal}}(w) = \mu_y + \min\!\left(1.25,\; \frac{\sigma_y}{\sigma_{\hat{y}}}\right)\big(\hat{y}(w) - \mu_{\hat{y}}\big)
$$

再用 $10^{\hat{y}_{\text{cal}}(w)} - 1$ 转回正整数，所有无词频扩展词表就都落到了和万象基础词库完全一致的 `1 ~ 350,000` 尺度上。

在 `15,000` 个留出验证词上，这套映射的对数决定系数 $R^2 = 0.623$，Spearman 秩相关系数 $\rho = 0.733$。比如不在训练锚点里的常见词 `"原神"`，校准后权重为 `11,889`（万象真实权重为 `12,425`）；而生僻百科词 `"朗格汉斯细胞"` 从原来的占位值 `60000` 回落到了 `5`。

```sketch title="直接提取做法的局限与离线锚点校准流程" note="所有模型计算均在离线阶段一次性完成，运行时仅加载编译后的静态表。"
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

### 3. 225 万条词怎么算得完：把共享前缀合并成一棵前缀树

如果把 225.5 万个中文词条一条条独立送进 `Qwen3-14B-Base`，计算量会非常大。但观察词表就能发现，大量词条的前半截是完全一样的。

比如 `"注意力"`、`"注意力机制"`、`"注意力权重"`、`"注意力分数"` 这四个词，它们在算到 `"注意力"` 这一步时，前面的输入都是 `"日常与百科常见词条：注意力"`。因为在自回归 Transformer 里，前面的 token 看不见后面的 token（Causal Mask），所以这四个词在 `"注意力"` 这个位置算出来的隐状态向量和下一词概率分布是**完全相同**的。

利用这一点，在送进 GPU 之前先把所有词条的真前缀合并成一棵 **BPE 前缀树（Prefix Trie）**：
- 任何共享的前缀在树上只有一个节点，在 Transformer 里只计算一次；
- 在 `"注意力"` 节点算完一次 `lm_head` 概率分布后，直接从同一个输出分布里把后面接 `"机制"`、`"权重"`、`"分数"` 的概率一次性全部取出来；
- 只把树的叶子路径按相同长度分批送进 GPU，同一个 batch 内长度完全一致，没有一个 `pad` 填充 token 浪费算力。

这棵前缀树把 2,254,614 个词条压缩成了 1,110,808 条叶子路径（压缩比 $2.03\times$），在单张 RTX A6000 上吞吐达到 737 词/秒，与逐词独立前向的最大绝对误差只有 `0.040`。回写完所有校准权重后，我顺带删掉了跨表重复行以及 `easy_en` 中的 57.4 万行零权重词，使编译后的 `build/*.bin` 从 `296.0 MiB` 降到了 `170.4 MiB`（减少 $42.4\%$）。

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

---

## 三、具体做法（中）：怎么只给 CS / AI 术语提权，不搞乱日常词

校准好通用词频后，第二个需求是：平时写代码和技术文档较多，希望计算机与 AI 领域的专业词汇（如 `"算子融合"`、`"推测解码"`、`"前缀树"`、`"幂等性"`）词频稍微高一点。

### 1. 为什么只拼一句领域提示词会失灵

最容易想到的做法是把前面的语境换成一句领域提示词，比如：
`"在计算机科学中，"`
然后按 $\ln P(w \mid \text{“在计算机科学中，”})$ 给词条加权。

但这招在实践里行不通。因为在这句话后面，模型预测概率最高的依然是 `"的"`、`"问题"`、`"方法"`、`"可以"`、`"一个"` 这类高频通用词。单看一个词在领域提示词后面的绝对概率，里面既包含了“它和计算机领域有多相关”，也混入了“它本身在中文里有多常见”。如果直接按这个概率加分，大量日常虚词也会跟着涨分，打乱正常语序。

### 2. 对称双提示词相减：把词本身的基础概率约掉

要分离出纯粹的“领域相关性”，不看单个提示词下的绝对概率，而是构造两句**句式结构完全对称**的提示词：
- 领域语境 $C_{\text{CS}}$：`"计算机科学与人工智能术语："`
- 通用语境 $C_{\text{gen}}$：`"日常与百科常见词条："`

把刚才那棵前缀树分别接在这两句提示词后面各跑一遍前向，然后对每个词取**两者的对数概率之差**。按贝叶斯公式 $P(w \mid C) = P(C \mid w)P(w)/P(C)$ 展开，词条自身的先验概率 $P(w)$ 在分子和分母中刚好抵消：

$$
\Delta_{\text{CS}}(w) = \ln \frac{P(w \mid C_{\text{CS}})}{P(w \mid C_{\text{gen}})} = \ln \frac{P(C_{\text{CS}} \mid w)\,P(w)}{P(C_{\text{gen}} \mid w)\,P(w)} + \text{const} = \ln \frac{P(C_{\text{CS}} \mid w)}{P(C_{\text{gen}} \mid w)} + \text{const}
$$

对数相减等于概率相除。它测量的不再是“这个词出现的绝对概率有多大”，而是**“把语境从日常切到计算机时，这个词出现的概率放大了多少倍”**：
- **对日常通用词（如 `"问题"`、`"方法"`）**：它在两个语境下都很常见，概率比接近 $1$，对数差 $\Delta_{\text{CS}} \approx 0$，不会获得额外加分；
- **对非计算机领域的热词（如 `"原神"`、`"B站"`）**：它在通用语境下常见，但在严肃的计算机术语语境下反而少见，相减结果是负数（实测 `"原神"` 为 $-3.50$，`"B站"` 为 $-2.64$），同样不加分；
- **对真正的计算机与 AI 术语**：它在通用语境下出现概率低，但一进入计算机语境概率就大幅上升，相减会得到显著的正数（实测 `"算子融合"` 为 $+7.56$，`"前缀树"` 为 $+6.12$，`"推测解码"` 为 $+4.24$，`"幂等性"` 为 $+4.21$，`"零拷贝"` 为 $+2.57$）。

### 3. 只在超过阈值时叠加有界增益

为了完全不干扰日常词汇的排序，前面的回归校准树严格只在通用语境 $C_{\text{gen}}$ 的特征上训练。

只有当一个词的 $\Delta_{\text{CS}}(w) > 1.3\text{ nats}$（即在 CS 语境下出现的概率比通用语境高出 $e^{1.3} \approx 3.7$ 倍以上）时，才在它的 $\log_{10}$ 通用权重上叠加一段有界线性增益（上限 $+0.54$，即最多在通用权重基础上放大约 $3.5$ 倍）：

$$
\text{tilt}(w) = \text{clip}\!\big((\Delta_{\text{CS}}(w) - 1.3) \times 0.135,\; 0,\; 0.54\big)
$$

这样一来，`"算子融合"` 的权重从通用值 `79` 提升到 `278`，`"前缀树"` 从 `51` 提升到 `178`，`"推测解码"` 从 `48` 提升到 `122`；而 $\Delta_{\text{CS}} \le 1.3$ 的所有日常词、百科词和游戏动漫词（如 `"原神"` `11,889`、`"朗格汉斯细胞"` `5`）权重保持不变。

顺带利用算出来的 $\Delta_{\text{CS}}(w) \ge 2.5$，我还从基础词库里自动筛出了 `1,463` 条技术词，与 `523` 条人工校对过多音字读音的新近术语（如 `模[mó]型`、`量[liàng]化`、`可重[chóng]入`、`幂[mì]等`、`栈[zhàn]帧`）合并成了独立的 `cs_ai.dict.yaml`（共 `1,986` 条）。

```sketch title="对称双提示词相减：消去基础词频，分离领域对数几率比" note="括号内数值为 Qwen3-14B-Base 实测对数几率差（单位 nats）。"
<svg viewBox="0 0 704 218">
  <rect class="panel" x="0" y="0" width="704" height="218" rx="12"/>
  <text class="caps" x="24" y="28">FRAME-MATCHED BAYESIAN LOG-ODDS LIFT</text>
  <g class="node blue"><rect x="20" y="46" width="268" height="34" rx="4"/><text class="mid" x="154" y="63">领域：“计算机科学与人工智能术语：”</text></g>
  <g class="node plain"><rect x="20" y="92" width="268" height="34" rx="4"/><text class="mid" x="154" y="109">通用：“日常与百科常见词条：”</text></g>
  <path class="edge" d="M288 63 H306 V86 H320" marker-end="url(#arrow)"/>
  <path class="edge" d="M288 109 H306 V86 H320" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="324" y="66" width="168" height="40" rx="4"/><tex class="mid" x="408" y="86" width="136">\Delta_{\text{CS}} = \ln \frac{P(w \mid C_{\text{CS}})}{P(w \mid C_{\text{gen}})}</tex></g>
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
  <g class="node orange"><rect x="20" y="140" width="300" height="40" rx="4"/><tex class="mid" x="170" y="160" width="256">\Delta_{\text{CS}} = \ln P(w\mid C_{\text{CS}}) - \ln P(w\mid C_{\text{gen}})</tex></g>
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

---

## 四、具体做法（下）：怎么从大模型直接蒸馏 `.gram` 语法模型

修好静态词表后，单打一个词的排序已经准了；但连续输入整句话时，还需要 `.gram` 语法模型告诉 Rime 哪两个词连在一起更合理。

如第一节所推导，`.gram` 对词对 $(w_1, w_2)$ 应当存储点互信息：

$$
\text{PMI}(w_1, w_2) = \ln P(w_2 \mid w_1) - \ln P(w_2)
$$

也就是说，只有当“看到上文 $w_1$ 后，$w_2$ 出现的概率显著高于 $w_2$ 平时的单字/单词概率”时，它们才算真正的搭配。

### 1. 为什么不用生成语料，而是直接读模型的 `lm_head` 输出矩阵

如果让大模型先采样生成几亿字文本，再用 `jieba` 分词、跑 KenLM 统计，不仅非常慢，还会把第一节提到的 `jieba` 分词阶数偏差重新引回来。

但换个角度想：当把上文词 $w_1$ 送进 `Qwen3-14B-Base` 时，模型在 $w_1$ 结尾位置的隐状态 $h(w_1)$ 乘上输出层矩阵 `lm_head` 并做归一化后，**输出的 151,936 维向量本身就已经给出了词表里每一个 token 接在 $w_1$ 后面的精确条件概率**。

如果每个候选下文词 $w_2$ 都要单独拼在 $w_1$ 后面跑一次模型，5 万个上文词乘 9 万个下文词就是 45 亿次前向传播，根本算不完。但我统计了中文词表里最常用的约 9 万个词，发现了一个很好的分布性质：
- 其中 **`16,950` 个高频词在 Qwen3 词表里本身就是单个 token**（记为集合 $\mathcal{V}_1$，例如 `"传播"`、`"机制"`、`"命中"`、`"分析"`）；
- 另外 **`65,005` 个词恰好由 2 个 token 组成**（记为集合 $\mathcal{V}_2$，例如 `"解码"` = `["解", "码"]`）。

利用这个性质，可以分三步把数十亿组词对的 PMI 直接从 `lm_head` 矩阵里读出来：

1. **单 token 后续词（$w_2 \in \mathcal{V}_1$）：一次矩阵切片算完 8.5 亿词对**
   选词频最高的 `50,000` 个核心词（含全部 CS 术语）作为上文词 $w_1$，在 GPU 上跑一遍前向，拿到每个 $w_1$ 后的 151,936 维对数概率向量。
   直接从这个向量里切出 $\mathcal{V}_1$ 对应的 `16,950` 列，就能一次拿到全部 16,950 个单 token 词接在 $w_1$ 后面的条件对数概率 $\ln P(w_2 \mid w_1)$。再减去它们在无上文时的先验对数概率 $\ln P(w_2)$，**不需要拼词重跑模型，在单张 RTX A6000 上不到 2 分钟就能把 $50{,}000 \times 16{,}950 \approx 8.5$ 亿组双词搭配的 PMI 全部算完**。
2. **双 token 后续词（$w_2 = (t_1, t_2) \in \mathcal{V}_2$）：只对高潜力的首 token 往前多走 1 步**
   如果后一个词由两个 token $(t_1, t_2)$ 组成，它的条件对数概率是 $\ln P(t_1 \mid w_1) + \ln P(t_2 \mid w_1, t_1)$。
   注意第一项 $\ln P(t_1 \mid w_1)$ 在刚才第一步的输出向量里**已经算好了**。我直接从第一步的向量里，为每个 $w_1$ 挑出 $\mathcal{V}_2$ 中首 token 概率和 PMI 最高的前几个候选 $t_1$，只把这些高潜力的 $(w_1, t_1)$ 拼起来再往后多跑 1 个 token。需要追加计算的短序列总共只有 `145,079` 条，在 A6000 上约 6 分钟就能从第二步的输出向量里把所有对应的第二个 token $t_2$ 的概率也读出来。
3. **句尾收敛标记（`词$`）：顺带汇总句末标点概率**
   在第一步每个 $w_1$ 的输出向量里，把句号（`、` `。` `！` `？` `；` `\n`）和结束符 EOS 的概率加起来，就代表这个词有多适合放在一句话的末尾收尾，直接转成 Rime 所需的 `词$` 条目（共生成 `7,992` 条）。

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

### 2. 为什么这套方法不会漏成语，也不会给错别字打高分

对比第一节里传统 `jieba` + KenLM 的问题，可以直接看出这套做法为什么有效：
- **没有分词器阶数偏差**：不再用 `jieba` 去切语料，也不会把 1-gram 和 3-gram 乘上不同的基数；无论是双词搭配还是词典里的四字成语，都统一按大模型的条件对数概率与 PMI 映射到同一个整数区间。
- **天然过滤同音错别字**：在 `Qwen3-14B-Base` 的 `lm_head` 分布里，正字搭配（如 `"反向"+"传播"`、`"强"+"连通"`、`"川流不息"`、`"再接再厉"`）的条件概率远高于同音错字（`"方向"+"传播"`、`"强"+"联通"`、`"穿流不息"`、`"再接再励"`），错别字在模型概率下进不了高分候选。
- **覆盖新近技术搭配**：像 `"推测"+"解码"`、`"缓存"+"命中"`、`"分页"+"注意力"`、`"算子"+"融合"` 这些在旧网页语料里频次不够的搭配，在 14B 模型的条件分布里都有很高的 PMI，能够被完整提取出来。

### 3. 为什么要严格控制写入 `.gram` 的准入门槛（`-6.0` 未命中惩罚的影响）

算出词对 $(w_1, w_2)$ 的有效增益（以 $\text{PMI}$ 为主，微调流利度）后，怎么存进 `.gram` 文件？

`librime-octagram` 的双数组前缀树以拼接后的完整字符串 `w1w2`（例如 `"反向传播"`、`"推测解码"`）作为查询键，值则是一个正整数 $v = \text{round}\big((14.0 + \text{bonus}) \times 10000\big)$。在运行时查表命中一条记录后，Rime 会按下式把整数 $v$ 还原为对数加分（默认 `collocation_penalty = -14.0`）：

$$
s_{\text{hit}} = -14.0 + \frac{v}{10000}
$$

而如果某个词对**没有写进 `.gram`**（查表返回 `-1`），Rime 会固定给它扣 **`non_collocation_penalty = -6.0` 分**。

这两个规则合在一起，会产生一个很大的台阶：一个词对只要被写进 `.gram` 并给一个较小的正分（比如 $+1.5$，对应整数 `155,000`），它相对于“没写进 `.gram` 的词对”就一下子多出了 **$+7.5$ 个自然对数单位（相当于概率放大约 $1{,}800$ 倍）**。

我第一版实验时把准入条件设得比较宽（$\ln P(w_2 \mid w_1) \ge -8.0$），结果很多只是勉强能接上、但并不常用的弱组合也被写进了 `.gram`（文件体积 `53.6 MiB`）。这些弱组合一旦进表，就跨过了 `-6.0` 的惩罚台阶，反过来去和正常搭配抢分，导致测试集首选率只有 `83.80%`。

看清这个机制后，我把准入条件收紧为 **$\ln P(w_2 \mid w_1) \ge -5.65$ 且 $\text{PMI}(w_1, w_2) \ge 2.35$**，只允许高置信度的真实搭配进表，其余一律留给 `-6.0` 惩罚挡住。这样不仅把纯蒸馏模型 `qwen14b-zh-hans.gram` 的体积从 `53.6 MiB` 压到了 **`11.4 MiB`（`1,031,842` 条记录，压缩包 `9.4 MiB`）**，测试集首选率反而从 `83.80%` 升到了 **`90.85%`**。

### 4. 两种产物：`11.4 MiB` 纯蒸馏版与 `385.5 MiB` 存量清洗融合版

除了编译出完全不依赖外部语料的 `11.4 MiB` 纯蒸馏 `.gram`（已开源在 GitHub Releases），我还写了一个 C++ 工具 `tools/gram_tool.cc`，用来清洗并融合本机原有的 400.8 MiB `wanxiang-lts-zh-hans.gram`：
1. **扫描同音疑似错字**：遍历原版 `.gram` 里分值 $\ge 158{,}000$、长度 3~6 字且不在基础词典中的条目，按平翘舌与前后鼻音归一化后与基础词典词条做同音碰撞匹配，找出 `203,796` 对同音或近音候选；
2. **用 14B 逐字概率比对去噪**：计算正字与疑似错字的逐字平均对数概率 $\frac{1}{|w|} \ln P(w \mid C)$。为防止误删字形完全不同的古语词（如“秾纤适宜”），限定只清理仅差 1~2 个同音字且模型概率大幅落后的条目，共删掉 **`48,178` 条**网页同音错搭；
3. **补回漏收成语并归并**：把原版因 `jieba` 1-gram 下溢漏掉的词典成语经 14B 评分后补回，剪掉原版低于 `140,000` 的弱尾项，再与 14B 蒸馏出的 103.2 万条高 PMI 搭配流式归并，生成 `wanxiang-qwen14b-zh-hans.gram`（体积从 `400.8 MiB` 降至 `385.5 MiB`）。

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

---

## 五、端到端 `librime` 消融评测与使用方法

为了检验上面每一步改动对真实打字解码的贡献，我写了一个动态链接本机 `librime`、`librime-octagram` 与 `librime-lua` 的 C++ 评测器（`rime-qwen-freq bench`）。评测默认在零用户词典（0-`userdb`）的临时隔离沙箱中运行，不依赖也不修改本机的个人输入历史。

测试集（`bench/bench_cases.tsv`）共 142 条长度不超过 25 键的连续全拼输入，包含六个类别：40 条 CS/AI 连续整句、35 条技术复合词与多音词、20 条中英混输、12 条上下文联想消歧、18 条百科抢权与同音混淆用例，以及 17 条日常口语对照语句。

四个阶段的实测首选准确率如下：

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

结果可以概括为三点：

1. **给无词频扩展词表补齐真实词频带来了最大一部分提升（总体首选率 `38.03% → 88.73%`）**：把 225.5 万条扩展与混合词条对齐到万象词频尺度、并加入 `cs_ai` 领域增益后，35 条 CS 术语和 20 条中英混输词条全部首选命中（`100.0%`），CS 连续整句准确率从 `22.5%`（9/40）升到了 `82.5%`（33/40）。
2. **`11.4 MiB` 的纯大模型蒸馏 `.gram` 总体表现超过了 `400.8 MiB` 的原版语料 `.gram`（`90.85%` vs `88.73%`）**：完全不依赖外部语料、直接从 `Qwen3-14B-Base` 输出头提取的 `qwen14b-zh-hans.gram`，体积只有原版的 $1/35$。在同音混淆（`77.8%` vs `66.7%`）、上下文消歧（`83.3%` vs `75.0%`）和 CS 整句（`85.0%` vs `82.5%`）上，纯蒸馏版都高于原版语料模型，仅在 1 条日常口语惯用语上未命中（日常语句 `16/17`）。
3. **纯蒸馏版与清洗融合版各有取舍（总体 `90.85%` vs `92.25%`）**：融合版保留了大语料的日常短语覆盖，使 CS 整句准确率进一步升到 `95.0%`（38/40）、日常语句回到 `100.0%`（17/17）、逐字准确率达到 `97.79%`。但在“同音混淆”一项上，融合版（`61.1%`，11/18）低于纯 14B 蒸馏版（`77.8%`，14/18）。原因在于错字扫描只清退了词典外的非词错搭，而像 `"说话直接了当"`（正字为 `"直截了当"`）、`"损失已经熟练了"`（近音误替 `"收敛"`）这类由合法词条拼出来的网页高频误用仍留在原版语料树里；纯 14B 蒸馏模型则没有这类网页噪声。

### 开源词库与复现命令

代码、评测器以及用 `Qwen3-14B-Base` 生成好的词表和独立语法模型已发布在 [mizorewww/rime-qwen-freq](https://github.com/mizorewww/rime-qwen-freq)。不想跑模型的用户可以直接在 [Releases](https://github.com/mizorewww/rime-qwen-freq/releases/latest) 下载 `qwen14b-zh-hans.gram.gz`、`cs_ai.dict.yaml.gz`、`zhwiki.dict.yaml.gz` 等成品文件，解压放进 Rime 目录重新部署即可。

如果要在自己的词表上运行或换成其他专业领域（改一行 `--domain-prompt` 即可）：

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
