---
title: "用基座大模型给 Rime 离线蒸馏词频与语法模型"
description: "Rime 扩展词库常把几百万百科词统一填成 60000 权重，现成语法模型里也混进了大量网页同音错别字。我用 Qwen3-14B-Base 在离线阶段给词表校准词频、用对称双提示词提升 CS 术语，并直接从 lm_head 蒸馏出 11.4 MiB 的 PMI 语法模型，整句与术语评测首选率从 38.03% 升至 92.25%，打字时依然是 0 毫秒静态查表。"
date: 2026-11-25
tag: "技术"
tags:
  - "rime"
  - "llm"
  - "ime"
  - "distillation"
---

我的主力输入法是 macOS 上的鼠须管（Rime），装了薄荷拼音、万象基础词库、雾凇英文词库，又加进了维基百科、维基词典、萌娘百科和中英混输等几个扩展词表。词条总数有两百多万，但平时写代码和技术文档时一直不好用：敲一串连续拼音，经常出冷门古人名、动漫词条或者同音错别字；敲 `kvhuancun`、`fenyezhuyili`、`dizhizishiying` 这类近两年的技术词，首选也几乎全错。

把配置目录 `~/Library/Rime` 拆开看了一遍，发现问题不在 Rime 引擎，而在底下喂给它的两份静态数据——**词典词频（Unigram）** 和 **语法搭配模型（`.gram`）**——都有硬伤。

我用 `Qwen/Qwen3-14B-Base` 在离线阶段重做了这两份数据：先通过前缀树去重与锚点回归把两百多万无词频词条对齐到真实词频尺度，再用对称双提示词的对数几率差把计算机与 AI 术语温和调高，最后直接从语言模型的输出头 `lm_head` 蒸馏了一份点互信息（PMI）语法模型，并清理了原版语法包里的同音错别字。全套工具、评测器、预构建词库和独立语法模型都已开源在 [mizorewww/rime-qwen-freq](https://github.com/mizorewww/rime-qwen-freq)。

```stats title="改造前后的核心实测变化" meta="librime 1.16 · Qwen3-14B-Base" note="端到端评测在零用户词典（0-userdb）沙箱中运行，共 142 条无截断拼音用例，直接调用鼠须管内置 librime.1.dylib 与 librime-octagram.dylib 解码。"
## 解码准确率与体积
总体首选率 | +54.22% | 38.03% → 92.25%（131/142）
CS 整句盲打 | +72.50% | 22.5% → 95.0%（38/40）
编译后词表体积 | -42.4% | 296.0 MiB → 170.4 MiB（去重降噪）
打字推理延迟 | 0 ms | 纯离线蒸馏，运行时只查静态表
```

## 原来的配置到底坏在哪里

先看几个改造前直接调用原生 `librime` 解码出来的真实翻车例子：

```cases title="原配置在真实 librime 解码下的典型翻车" note="输入均为不加空格的连续全拼且长度不超过 25 键；原配置与新配置使用同一套拼音拼写规则。"
## CASE_01 技术整句被百科人名抢权
tag: 假常数 60000
q: fanxiangchuanboyutidu
新配置（14B 词表 + 融合 .gram） | ok | 反向传播与梯度
原配置 | bad | 范骧传播与梯度
备注 | note | zhwiki 中明代人物“范骧”被硬编码为 60000，压过“反向”

## CASE_02 专业复合词缺失且被冷门词条切碎
tag: 缺术语 + 抢权
q: fenyezhuyili / dizhizishiying
新配置（14B 词表 + 融合 .gram） | ok | 分页注意力 / 低秩自适应
原配置 | bad | 分页朱议沥 / 地之子石英
备注 | note | 明代宗室“朱议沥”与萌娘词条“地之子”权重均为 60000

## CASE_03 错别字搭配叠加百科词条把整句带偏
tag: 错搭 + 60000
q: anbujiubanchonggou
新配置（14B 词表 + 融合 .gram） | ok | 按部就班重构
原配置 | bad | 按步就班冲沟
备注 | note | 原版 .gram 给错字“按步就班”加分，叠加百科词“冲沟”（60000）盖过“重构”

## CASE_04 语法模型自己把正字改成了错别字
tag: 脏语料错搭
q: xiwangdajiazaijiezaili
新配置（14B 词表 + 融合 .gram） | ok | 希望大家再接再厉
原配置 | bad | 希望大家再接再励
备注 | note | 原版 .gram 中错别字“再接再励”（200616）得分高于正字“再接再厉”（176835）
```

把 `dicts/` 下的所有 `.dict.yaml` 扫一遍，问题很集中：

1. **214 万条百科与二创词条被填死了 `60000` 权重**。主力基础词库 `wanxiang_jichu` 是按真实语料统计的，词频中位数只有 `279`，99 分位也才 `5,256`。而第三方转换来的 `zhwiki`（172.8 万条）、`zhwiktionary`（28.6 万条）、`moegirl`（13.0 万条）为了省事，把每一行的权重全写成了 `60000`——相当于这 214 万个生僻词条全部排在日常词的 99.9% 分位之上。
2. **中英混输与英文扩展表完全没有词频**。`wanxiang_mixed`、`rime_ice.en`、`rime_ice.en_ext` 连第 3 列都没有，落回极低默认权重，`kvhuancun` 很难排到前面。
3. **跨表大量重复与零权重废词**。`wanxiang_jichu` 里有 **88%（131.4 万条）** 的 `(词, 无调拼音)` 与 `rime_mint.base` 完全重复，还有 15 行写成了 `6N`、`436N` 这样的脏字符串；英文表 `easy_en` 74.5 万行里有 **57.4 万行权重是 0**，把英文索引 `melt_eng.prism.bin` 撑到了 103.1 MiB（清理后仅 29.1 MiB）。

```sketch title="原词库里的两处结构硬伤：假常数倒挂与大量无效重复" note="数值来自本机 ~/Library/Rime 改造前实测统计。"
<svg viewBox="0 0 704 250">
  <rect class="panel" x="0" y="0" width="344" height="250" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="250" rx="12"/>
  <text class="caps" x="24" y="28">WEIGHT INVERSION</text>
  <text class="small b ink" x="24" y="52">主力基础词库 wanxiang_jichu</text>
  <g class="node teal"><rect x="24" y="64" width="136" height="32" rx="4"/><text class="mid" x="92" y="80">P50 = 279</text></g>
  <g class="node plain"><rect x="168" y="64" width="152" height="32" rx="4"/><text class="mid" x="244" y="80">P99 = 5,256</text></g>
  <text class="small b ink" x="24" y="124">扩展词表 zhwiki / 词典 / 萌娘（214 万条）</text>
  <g class="node clay"><rect x="24" y="136" width="296" height="36" rx="6"/><text class="mid" x="172" y="154">100% 填死常数 60,000</text></g>
  <text class="small accent" x="24" y="198">生僻百科词权重是日常词中位数的 215 倍</text>
  <text class="small mute" x="24" y="220">整句切分时优先吞掉音节，把常见词挤出候选</text>

  <text class="caps" x="384" y="28">TABLE BLOAT</text>
  <g class="node plain"><rect x="384" y="54" width="296" height="34" rx="4"/><text class="mid" x="532" y="71">wanxiang_jichu：131.4 万条重复（88%）</text></g>
  <g class="node plain"><rect x="384" y="98" width="296" height="34" rx="4"/><text class="mid" x="532" y="115">zhwiki / 词典 / 萌娘：36.2 万条重复</text></g>
  <g class="node plain"><rect x="384" y="142" width="296" height="34" rx="4"/><text class="mid" x="532" y="159">easy_en：57.4 万条 0 权重废词（77%）</text></g>
  <path class="edge" d="M532 176 V194" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="384" y="198" width="296" height="32" rx="4"/><text class="mid" x="532" y="214">296.0 MiB → 170.4 MiB（-42.4%）</text></g>
</svg>
<svg viewBox="0 0 340 500">
  <rect class="panel" x="0" y="0" width="340" height="240" rx="12"/>
  <rect class="panel" x="0" y="254" width="340" height="246" rx="12"/>
  <text class="caps" x="20" y="28">WEIGHT INVERSION</text>
  <text class="small b ink" x="20" y="52">主力基础词库 wanxiang_jichu</text>
  <g class="node teal"><rect x="20" y="64" width="142" height="32" rx="4"/><text class="mid" x="91" y="80">P50 = 279</text></g>
  <g class="node plain"><rect x="170" y="64" width="150" height="32" rx="4"/><text class="mid" x="245" y="80">P99 = 5,256</text></g>
  <text class="small b ink" x="20" y="122">扩展词表 zhwiki / 词典 / 萌娘</text>
  <g class="node clay"><rect x="20" y="134" width="300" height="34" rx="6"/><text class="mid" x="170" y="151">214 万条全部填死 60,000</text></g>
  <text class="small accent" x="20" y="194">生僻词权重是日常词中位数的 215 倍</text>
  <text class="small mute" x="20" y="216">整句切分时把常见词挤出首选</text>

  <text class="caps" x="20" y="282">TABLE BLOAT</text>
  <g class="node plain"><rect x="20" y="302" width="300" height="32" rx="4"/><text class="mid" x="170" y="318">基础词库间重复：131.4 万条（88%）</text></g>
  <g class="node plain"><rect x="20" y="342" width="300" height="32" rx="4"/><text class="mid" x="170" y="358">百科与基础重复：36.2 万条</text></g>
  <g class="node plain"><rect x="20" y="382" width="300" height="32" rx="4"/><text class="mid" x="170" y="398">英文 0 权重废词：57.4 万条</text></g>
  <path class="edge" d="M170 414 V434" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="20" y="438" width="300" height="32" rx="4"/><text class="mid" x="170" y="454">296.0 MiB → 170.4 MiB（-42.4%）</text></g>
</svg>
```

## 为什么值得用基座大模型，以及三个容易踩的坑

以前要给这几百万词补词频，只能自己去爬几十 GB 网页、跑结巴分词再统计频数。但开源基座模型（如 `Qwen3-14B-Base`）本来就在数万亿 token 的多语种、百科、代码和论文上做完了下一词预测训练——每个词在自然语境里出现的概率，已经编码在模型权重里了。只要在**离线阶段**把这些概率读出来转成整数写回 `.dict.yaml`，打字时完全不需要跑神经网络，依然是 Rime 原本的毫秒级查表。

不过真动手时，最容易想到的三条捷径其实都走不通：

1. **直接拿 Tokenizer 的 BPE 合并序号当词频**。BPE 词表只收录了约 15 万个子词，里面大量是 `"的时"`、`"了一"` 这种跨词粘连碎片，没有多音字注音，而且合并序号是线性的，还原不出齐夫定律（Zipf's law）下几万倍的真实频次差距。
2. **直接把序列对数似然 $\log P(w)$ 转成权重**。长词要连乘更多 token 的条件概率，天然比短词小几个数量级（比如 4 字常见成语的联合概率往往低于生僻 2 字词）；而且裸概率没法和现有万象词库的 `1 ~ 350,000` 或英文词库的 `900,000 ~ 999,995` 混在一起排序。
3. **直接拼一句提示词（例如 `"在计算机科学中"`）来抬高专业词**。在这句提示词后面，`"的"`、`"问题"`、`"方法"`、`"可以"` 这类高频通用词的出现概率同样很高；如果直接按 $\log P(w \mid \text{“在计算机科学中”})$ 加权，大量日常虚词和半截词也会跟着涨分。

```sketch title="三种常见捷径各自的断点，以及离线蒸馏校准的闭环" note="所有神经网络计算都在离线一次性完成，产物仍是纯静态词表与双数组前缀树。"
<svg viewBox="0 0 704 252">
  <rect class="panel" x="0" y="0" width="328" height="252" rx="12"/>
  <rect class="panel" x="344" y="0" width="360" height="252" rx="12"/>
  <text class="caps" x="24" y="28">SHORTCUTS THAT FAIL</text>
  <g class="node plain"><rect x="24" y="48" width="280" height="32" rx="4"/><text class="mid" x="164" y="64">抠 BPE 合并秩 → 含“的时”碎片、仅 15 万</text></g>
  <text class="small accent" x="24" y="96">✗ 缺几百万专名，且抹平了齐夫长尾差距</text>
  <g class="node plain"><rect x="24" y="112" width="280" height="32" rx="4"/><text class="mid" x="164" y="128">直接用序列对数概率 → 长词连乘吃亏</text></g>
  <text class="small accent" x="24" y="160">✗ 尺度与现有万象 / ECDICT 词库完全脱节</text>
  <g class="node plain"><rect x="24" y="176" width="280" height="32" rx="4"/><text class="mid" x="164" y="192">单提示词“在计算机科学中” → 虚词跟着涨</text></g>
  <text class="small accent" x="24" y="224">✗ 混入了词本身的基础常见度</text>

  <text class="caps" x="368" y="28">OFFLINE DISTILLATION</text>
  <g class="node blue"><rect x="368" y="48" width="312" height="32" rx="4"/><text class="mid" x="524" y="64">1. BPE 前缀树精确前向（共享前缀只算一次）</text></g>
  <path class="edge" d="M524 80 V96" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="368" y="98" width="312" height="32" rx="4"/><text class="mid" x="524" y="114">2. 对称双提示词相减，提取纯粹领域增益</text></g>
  <path class="edge" d="M524 130 V146" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="368" y="148" width="312" height="32" rx="4"/><text class="mid" x="524" y="164">3. 用主力词库 10 万锚点回归并还原方差</text></g>
  <path class="edge" d="M524 180 V196" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="394" y="198" width="260" height="34" rx="17"/><text class="mid" x="524" y="215">写入静态词表与 .gram（运行时 0 ms）</text></g>
</svg>
<svg viewBox="0 0 340 500">
  <rect class="panel" x="0" y="0" width="340" height="238" rx="12"/>
  <rect class="panel" x="0" y="252" width="340" height="248" rx="12"/>
  <text class="caps" x="20" y="26">SHORTCUTS THAT FAIL</text>
  <g class="node plain"><rect x="20" y="44" width="300" height="30" rx="4"/><text class="mid" x="170" y="59">抠 BPE 合并秩：含子词碎片、缺专名</text></g>
  <text class="small accent" x="20" y="90">✗ 线性序号抹平了齐夫长尾差距</text>
  <g class="node plain"><rect x="20" y="106" width="300" height="30" rx="4"/><text class="mid" x="170" y="121">直接用序列对数概率：长词连乘吃亏</text></g>
  <text class="small accent" x="20" y="152">✗ 尺度与现有主力词库无法混排</text>
  <g class="node plain"><rect x="20" y="168" width="300" height="30" rx="4"/><text class="mid" x="170" y="183">单提示词加权：“的/问题”跟着涨分</text></g>
  <text class="small accent" x="20" y="214">✗ 没有扣掉日常语境下的基础概率</text>

  <text class="caps" x="20" y="278">OFFLINE DISTILLATION</text>
  <g class="node blue"><rect x="20" y="296" width="300" height="32" rx="4"/><text class="mid" x="170" y="312">1. BPE 前缀树精确前向（2.03× 压缩）</text></g>
  <path class="edge" d="M170 328 V342" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="20" y="344" width="300" height="32" rx="4"/><text class="mid" x="170" y="360">2. 对称双提示词做差提取领域增益</text></g>
  <path class="edge" d="M170 376 V390" marker-end="url(#arrow)"/>
  <g class="node blue"><rect x="20" y="392" width="300" height="32" rx="4"/><text class="mid" x="170" y="408">3. 10 万真实词频锚点回归对齐尺度</text></g>
  <path class="edge" d="M170 424 V438" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="30" y="440" width="280" height="34" rx="17"/><text class="mid" x="170" y="457">生成静态词表与 .gram（0 ms 延迟）</text></g>
</svg>
```

## 第一步：前缀树打分、锚点校准与对称领域增益

### 1. 用前缀树（Prefix Trie）算精确条件概率

给一个词 $w = (t_1, t_2, \dots, t_k)$ 打分，不需要让模型自由生成，而是把它拼在固定语境 $C$ 后面做一次前向传播（Teacher Forcing），按链式法则把每一步真实落在该词下一个 token 上的对数概率加起来：

$$
\log P(w \mid C) = \sum_{i=1}^{k} \log P(t_i \mid C, t_1, \dots, t_{i-1})
$$

225.5 万个中文词条如果逐条独立跑 `Qwen3-14B-Base`，大量共享前缀（比如 `"中华人民共和国..."`、`"注意力..."`、`"计算机..."`）会被重复算成百上千次。

考虑到因果注意力（Causal Mask）下前缀的隐状态看不见后面的 token，我先把所有词条的真前缀 $t_{1:k-1}$ 建成一棵 **BPE 前缀树**，只把树的叶子路径按相同长度分批送进 GPU。树上每个内部节点只由第一条经过它的叶子负责在 GPU 上做稀疏索引收集（直接算 `z[row, tok] - logsumexp(z)`，不把 `[batch, 151936]` 的大张量拷回内存）。

```sketch title="BPE 前缀树去重：百万词条的共享前缀在 Transformer 里只算一次" note="实测 2,254,614 个中文词条被压缩为 1,110,808 条最长真前缀路径（2.03 倍压缩），与逐词独立前向的最大绝对误差仅 0.040。"
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

### 2. 用主力词库做锚点回归，消除词长偏置

为了把模型特征准确映射到现有词库的整数尺度，我从 `rime_mint.base` 与 `wanxiang_jichu` 里按词长和量级分层抽样 100,000 个带真实权重的词作为监督锚点，把每个词的 11 维特征——总对数概率 `sum_lp`、首尾 token 概率、平均概率 `mean_lp`、**最弱一环概率 `min_lp`**（专门识别百科里的残缺标题，比如带横杠或半截括号的词条）、token 数、字数、BPE 序号统计量——喂给正则化梯度提升树（`HistGradientBoostingRegressor`），去拟合 $\log_{10}(\text{weight} + 1)$。

因为树模型做最小二乘回归时预测方差 $\sigma_{\hat{y}}$ 会比真实词频方差 $\sigma_y$ 略窄（高频端偏保守、低频端不够低），最后再加一步线性方差还原：

$$
\hat{y}_{\text{cal}}(w) = \mu_y + \min\!\left(1.25,\; \frac{\sigma_y}{\sigma_{\hat{y}}}\right)\big(\hat{y}(w) - \mu_{\hat{y}}\big)
$$

在 15,000 个留出验证词上，单通用语境下 $R^2 = 0.623$，Spearman 秩相关 $\rho = 0.733$（双语境模式下 `Qwen3.5-0.8B-Base` 可达 $R^2 = 0.637$、$\rho = 0.735$）。像 `"原神"` 这样不在训练锚点里的验证词，模型校准出来是 `11,889`，万象真实词频是 `12,425`；而生僻词 `"朗格汉斯细胞"` 自动落回 `5`，不再因为 `60000` 的假权重排到前面。

### 3. 给 CS / AI / ML 词汇调频：用对称双提示词的贝叶斯对数几率差

前面提到，单写一句 `"在计算机科学中"` 会把通用虚词也一起抬高。要测一个词**到底有多属于计算机与人工智能领域**，可以把两个句式结构完全对称的提示词配成一对：

- 通用语境 $C_{\text{gen}}$：`"日常与百科常见词条："`
- 领域语境 $C_{\text{CS}}$：`"计算机科学与人工智能术语："`

同一棵前缀树分别挂在这两个前缀后面各跑一遍，两式相减：

$$
\Delta_{\text{CS}}(w) = \log P(w \mid C_{\text{CS}}) - \log P(w \mid C_{\text{gen}}) = \log \frac{P(C_{\text{CS}} \mid w)}{P(C_{\text{gen}} \mid w)} + \text{const}
$$

根据贝叶斯公式，这一减把词本身的基础常见度 $\log P(w)$ 消掉，剩下的就是**领域富集度（点互信息）**。基础词频校准器只在 $C_{\text{gen}}$ 上训练，避免干扰日常词的原有排序；只有当 $\Delta_{\text{CS}}(w) > 1.3\text{ nats}$（即在 CS 语境出现几率超过通用语境约 $3.7$ 倍）时，才按斜率加上有界对数增益（上限 $+0.54$，约放大 $3.5$ 倍）。

```sketch title="对称双提示词相减：消掉基础词频，只给真正的专业词加分" note="括号内数值为 Qwen3-14B-Base 实测对数几率差（单位 nats）。"
<svg viewBox="0 0 704 218">
  <rect class="panel" x="0" y="0" width="704" height="218" rx="12"/>
  <text class="caps" x="24" y="28">FRAME-MATCHED BAYESIAN LOG-ODDS LIFT</text>
  <g class="node blue"><rect x="20" y="46" width="268" height="34" rx="4"/><text class="mid" x="154" y="63">领域：“计算机科学与人工智能术语：”</text></g>
  <g class="node plain"><rect x="20" y="92" width="268" height="34" rx="4"/><text class="mid" x="154" y="109">通用：“日常与百科常见词条：”</text></g>
  <path class="edge" d="M288 63 H306 V86 H320" marker-end="url(#arrow)"/>
  <path class="edge" d="M288 109 H306 V86 H320" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="324" y="66" width="168" height="40" rx="4"/><tex class="mid" x="408" y="86" width="136">\Delta_{\text{CS}} = \log \frac{P(w \mid C_{\text{CS}})}{P(w \mid C_{\text{gen}})}</tex></g>
  <path class="edge" d="M492 86 H510 V58 H524" marker-end="url(#arrow)"/>
  <path class="edge" d="M492 86 H510 V116 H524" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="528" y="42" width="156" height="32" rx="4"/><text class="mid" x="606" y="58">算子融合 +7.56 → ×3.5</text></g>
  <g class="node plain"><rect x="528" y="100" width="156" height="32" rx="4"/><text class="mid" x="606" y="116">原神 -3.50 → ×1.0</text></g>
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

实测跑出来的 $\Delta_{\text{CS}}$ 分界很清晰，基础词库里原本已有的一些技术词也能被自动识别出来：

```data title="Qwen3-14B-Base 对不同词条的领域对数几率差与校准权重" bars="增益 $\Delta_{\text{CS}}$" mark="算子融合,推测解码" note="权重列括号内为通用语境校准值；当 $\Delta_{\text{CS}} > 1.3\text{ nats}$ 时触发有界对数提升，负值词条保留原校准权重。"
词条 | 权重 | 增益 $\Delta_{\text{CS}}$
算子融合 | 278（79） | +7.56
前缀树 | 178（51） | +6.12
推测解码 | 122（48） | +4.24
幂等性 | 124（49） | +4.21
机器学习 | 31847（13761） | +4.00
深度学习 | 30025（13905） | +3.78
零拷贝 | 208（140） | +2.57
5G | 23685（23685） | +0.41
B站 | 19384（19384） | -2.64
朗格汉斯细胞 | 5（5） | -2.71
三角力量 | 189（189） | -3.15
原神 | 11889（11889） | -3.50
```

另外还用同一套 14B 概率清理了个人用户词典 `rime_mint.userdb`（不读取任何个人笔记，只检查 Rime 自己的按键历史库）：删掉了 `2,012` 条 `c <= 0` 的残留影子记录、`23` 条 `"啊啊啊啊"` 式的连击噪点，以及 `562` 条只敲过一两次且模型困惑度很高的手滑错词，`c >= 3` 的常用记录保持不动。

## 第二步：能不能用大模型直接蒸馏一个 N-gram 语法模型？

把词表修好之后，单打一个词基本准了，但连续敲半句话时还是能看出短板。自然会想到下一个问题：**既然静态词表（Unigram）能蒸馏，Rime 用来管整句组词的 `.gram` 语法模型（N-gram）能不能也用大模型蒸馏？**

去读了 `librime`（`poet.cc`、`dict_compiler.cc`）和 `librime-octagram`（`octagram.cc`、`gram_db.cc`）的 C++ 源码，并写工具把本机 400.8 MiB 的 `wanxiang-lts-zh-hans.gram` 完整遍历了一遍，看清了三件事。

### 1. Rime 的打分公式决定了 `.gram` 最该存的是点互信息（PMI）

不少文章把 `.gram` 说成 KenLM 的直接封装，其实不是。在 `poet.cc` 的整句 Beam Search（宽度为 7）里，从前文 `context` 跨到候选词 `word` 的路径增量得分是：

$$
\text{Score}(\text{context} \to \text{word}) = \ln\big(\text{dict\_weight}(\text{word})\big) + \text{Octagram::Query}(\text{context}, \text{word})
$$

注意第一项**已经加过一次 `word` 自身的对数先验 $\ln P(\text{word})$** 了。如果想让整条句子的总分严格等于马尔可夫链对数概率 $\sum_i \ln P(w_i \mid w_{i-1}, w_{i-2})$，第二项 `Octagram::Query` 真正应该给出的不是联合频次，也不是裸条件概率，而是**上文带来的条件对数增益（点互信息 PMI）**：

$$
\text{PMI}(\text{context}, \text{word}) = \ln P(\text{word} \mid \text{context}) - \ln P(\text{word})
$$

如果往 `.gram` 里塞未扣除自身词频的共现次数，高频词就会在词表和语法模型里被算两次分。

### 2. 原版 400.8 MiB `.gram` 里的意外发现：结巴分词把错别字算成了高分，把真成语漏掉了

完整遍历本机 `wanxiang-lts-zh-hans.gram`，里面一共有 **65,493,408 条**记录（77.6% 是 4 字搭配，句尾 `$` 收敛标记只有 6,746 条）。拿一批常见词和同音错字去查，查出了一组反直觉的结果：

- **正字缺失（`-1`，整句解码时罚 `-6.0`），错别字反而有高分奖励**：
  - `川流不息 = -1`，而错别字 **`穿流不息 = 180,687`**（净加分 `+4.07`，一正一反相差 **10 个自然对数单位，约 23,000 倍**）；
  - `莫名其妙 = -1`，而错别字 **`莫明其妙 = 164,433`**；
  - `再接再厉 = 176,835`，而错别字 **`再接再励 = 200,616`**（这就是前面敲 `xiwangdajiazaijiezaili` 会直接上屏错别字的原因）；
  - 此外还有 `整行医院 = 231,925`、`初略统计 = 235,638`、`打做一团 = 235,675`、`强联通分量 = 223,327`、`方向传播 = 177,727`。
- **新领域搭配成片缺失**：`推测解码 = -1`、`缓存命中 = -1`（虽然有 5 字 `缓存命中率`，但敲 4 字 `缓存命中` 直接受 `-6.0` 惩罚）、`旋转位置编码 = -1`。

对照公开的构建脚本就能理解原因：传统流程先用 `jieba` 给 48 GB 网页语料分词，再喂给 KenLM `lmplz -o 3`，最后把各阶条件概率乘以该阶词条种类数 `ngrams_counts[order]` 转成整数。**真正的四字成语（如“川流不息”、“莫名其妙”、“迫不及待”）在结巴词典里是一个完整的词（1-gram）**，1-gram 总种类数很小，乘出来四舍五入就下溢丢掉了（本机词典里权重 $\ge 25$ 的 3~6 字词条和成语，在原版 `.gram` 里一共漏掉了 **28.7 万条**）；反过来，**网页里的错别字（“穿流不息”、“再接再励”、“整行医院”）不在结巴词典里，被切碎成了 2-gram 或 3-gram**，乘上了 3-gram 千万级的基数，算出了 18 万~23 万的高分。

```sketch title="为什么语料分词统计会漏掉真成语、奖励错别字，而直接蒸馏 lm_head 不会" note="数值为本机原版 wanxiang-lts-zh-hans.gram 实测查询结果；未命中记为 -1（解码罚 -6.0）。"
<svg viewBox="0 0 704 244">
  <rect class="panel" x="0" y="0" width="344" height="244" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="244" rx="12"/>
  <text class="caps" x="24" y="28">CORPUS + JIEBA + KENLM</text>
  <g class="node plain"><rect x="24" y="48" width="296" height="32" rx="4"/><text class="mid" x="172" y="64">正字“川流不息” → 结巴切成 1-gram</text></g>
  <text class="small accent" x="24" y="96">✗ 乘 1-gram 小基数下溢 → .gram 缺失（-1，罚 -6.0）</text>
  <g class="node clay"><rect x="24" y="114" width="296" height="32" rx="6"/><text class="mid" x="172" y="130">错字“穿流不息” → 切碎成 2/3-gram</text></g>
  <text class="small accent" x="24" y="162">✗ 乘 3-gram 千万级基数 → 算至 180,687（+4.07）</text>
  <text class="small mute" x="24" y="196">同理：莫名其妙(-1) vs 莫明其妙(164,433)</text>
  <text class="small mute" x="24" y="216">再接再厉(176,835) vs 再接再励(200,616)</text>

  <text class="caps" x="384" y="28">DIRECT LM_HEAD PMI + AUDIT</text>
  <g class="node blue"><rect x="384" y="48" width="296" height="32" rx="4"/><text class="mid" x="532" y="64">同音碰撞扫描 + 14B 逐字概率比对</text></g>
  <text class="small teal b" x="384" y="96">✓ 清退 48,178 条网页同音错搭，补回漏收成语</text>
  <g class="node teal"><rect x="384" y="114" width="296" height="32" rx="4"/><text class="mid" x="532" y="130">直接从 lm_head 计算精确条件增益 PMI</text></g>
  <text class="small teal b" x="384" y="162">✓ 零爬虫错字噪声，同时补齐 CS 搭配与句尾 $</text>
  <text class="small mute" x="384" y="196">独立纯蒸馏模型仅 11.4 MiB（压缩后 9.4 MiB）</text>
  <text class="small mute" x="384" y="216">融合去噪模型从 400.8 MiB 降至 385.5 MiB</text>
</svg>
<svg viewBox="0 0 340 486">
  <rect class="panel" x="0" y="0" width="340" height="232" rx="12"/>
  <rect class="panel" x="0" y="246" width="340" height="240" rx="12"/>
  <text class="caps" x="20" y="26">CORPUS + JIEBA + KENLM</text>
  <g class="node plain"><rect x="20" y="44" width="300" height="30" rx="4"/><text class="mid" x="170" y="59">正字“川流不息” → 结巴视为 1-gram</text></g>
  <text class="small accent" x="20" y="90">✗ 基数小被丢弃 → 缺失（-1，罚 -6.0）</text>
  <g class="node clay"><rect x="20" y="106" width="300" height="30" rx="6"/><text class="mid" x="170" y="121">错字“穿流不息” → 切碎成 2/3-gram</text></g>
  <text class="small accent" x="20" y="152">✗ 乘大基数升至 180,687（奖 +4.07）</text>
  <text class="small mute" x="20" y="182">莫名其妙(-1) vs 莫明其妙(164,433)</text>
  <text class="small mute" x="20" y="202">再接再厉(176,835) vs 再接再励(200,616)</text>

  <text class="caps" x="20" y="272">DIRECT LM_HEAD PMI + AUDIT</text>
  <g class="node blue"><rect x="20" y="290" width="300" height="30" rx="4"/><text class="mid" x="170" y="305">同音碰撞扫描 + 14B 概率比对</text></g>
  <text class="small teal b" x="20" y="336">✓ 清退 48,178 条同音错字，补回漏收成语</text>
  <g class="node teal"><rect x="20" y="352" width="300" height="30" rx="4"/><text class="mid" x="170" y="367">直接从 lm_head 计算精确 PMI 增益</text></g>
  <text class="small teal b" x="20" y="398">✓ 零错字噪声，补齐 CS 搭配与句尾 $</text>
  <text class="small mute" x="20" y="430">纯蒸馏 .gram 仅 11.4 MiB（.gz 9.4 MiB）</text>
  <text class="small mute" x="20" y="452">融合去噪版从 400.8 MiB 降至 385.5 MiB</text>
</svg>
```

### 3. 不用生成语料：利用 `lm_head` 矩阵一次性展开数十亿词对

如果先让 `Qwen3-14B-Base` 采样生成几亿字文本再去跑 KenLM，耗时很长，还会引入采样噪声。

换个角度看：词表里常用的中文候选词有近 9 万个，其中 **16,950 个高频词在 Qwen3 的词表里本身就是单个 token**（$\mathcal{V}_1$），另有 **65,005 个词恰好由两个 token 组成**（$\mathcal{V}_2$）。这意味着：

1. **单 token 后续词矩阵直读**：选词频最高的 50,000 个核心词（含全部 CS 术语）作为上文词 $w_1$，在 RTX A6000 上跑一遍前向，拿到每个 $w_1$ 结尾的隐状态 $h(w_1)$。乘一次 `lm_head` 得到整个词表的对数概率向量后，直接切出 $\mathcal{V}_1$ 对应的 16,950 列，在 GPU 上做一次矩阵减法 $\log P(w_2 \mid w_1) - \log P(w_2)$——**不到 2 分钟就能把 $50{,}000 \times 16{,}950 \approx 8.5$ 亿组二词搭配的精确条件概率和 PMI 全部算完**。
2. **双 token 后续词一步前缀展开**：同时在同一个输出向量里挑出 $\mathcal{V}_2$ 中 PMI 最高的候选首 token $t_1$，把 $(w_1, t_1)$ 拼起来再往前走 1 步（约 14.5 万条短序列，A6000 上约 6 分钟），就能把所有双 token 后续词 $w_2 = (t_1, t_2)$ 的精确概率也读出来。
3. **提取句尾 `$` 收敛分**：在 $h(w_1)$ 的输出分布上把句号、问号、感叹号和换行的概率加起来，就得到了这个词放在句尾收束的概率 $\log P(\text{EOS} \mid w_1)$，转成 `词$` 补上原版 `.gram` 句尾标记偏少的缺口。

```sketch title="在 lm_head 输出向量上一次性展开单 token 词对、双 token 前缀与句尾标记" note="单张 RTX A6000 总耗时 16.6 分钟（含 56.5 万条同音错字审计与成语修复）。"
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
  <text class="small mute" x="24" y="206">设置稀疏准入门槛（cond_lp ≥ -5.65 且 PMI ≥ 2.35），避免把边缘搭配抬过 -6.0 未命中惩罚线</text>
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
  <text class="small mute" x="20" y="264">准入门槛：cond_lp ≥ -5.65 且 PMI ≥ 2.35</text>
  <text class="small mute" x="20" y="286">防止边缘搭配跨过 -6.0 未命中防线</text>
  <text class="small teal b" x="20" y="308">单卡 A6000 全流程耗时 16.6 分钟</text>
</svg>
```

这里还有一个容易忽略的细节：**`Octagram` 的 `-6.0` 稀疏门槛效应**。

在 `rime_mint.custom.yaml` 里，未命中 `.gram` 的词对默认受 `non_collocation_penalty = -6.0` 惩罚，而一旦写进 `.gram`，哪怕给最低一档正分 `+1.5`（对应存储值 `155,000`），也相当于增加了 **$7.5$ 个自然对数单位（约 $1{,}800$ 倍）** 的跳变。第一版测试时，我把准入门槛放得太宽（`cond_lp >= -8.0`），结果大量条件概率偏低的边缘搭配（比如童话语境里罕见的 `"住在礼物"`，或生硬拼接的跨词组合）混进了 `.gram`，抹掉了原本保护正常搭配的 `-6.0` 惩罚差，导致 53.6 MiB 的初版纯蒸馏模型在整句评测上只有 `83.80%`。把准入门槛收紧到 **`cond_lp >= -5.65` 且 `PMI >= 2.35`** 后，这些低置信度词对被过滤掉，纯蒸馏 `.gram` 的体积降到了 **11.4 MiB（103.2 万条键）**，端到端首选率反而升到了 **`90.85%`**。

同时，我对原版万象 `.gram` 里所有不在基础词典中、但与词典词条同音或单字近音碰撞的高分项（20.4 万对）做了 14B 逐字概率审计，只清退单字错字或完全同音且概率落后超过 12~33 倍的确凿错搭（共拉黑 **48,178 条**，保留 `"秾纤适宜"`、`"俭以防匮"` 等生僻古雅词不误伤），再把原版低于 `140,000` 的弱尾项剪掉，与 14B 蒸馏出的 103.2 万条搭配流式归并成自用的 `wanxiang-qwen14b-zh-hans.gram`（**385.5 MiB**，比原版 400.8 MiB 缩减了 15.3 MiB）。

## 端到端 `librime` 消融评测

为了验证每一步各自带来了多少真实变化，我写了一个动态加载 `librime`、`librime-octagram` 和 `librime-lua` 的 C++ 评测器（`rime-qwen-freq bench`），默认在隔离的零用户词典（0-`userdb`）沙箱中运行，避免污染或依赖个人输入历史。测试集共 142 条不超过 25 键的连续拼音输入，包含 40 条 CS/AI 连续整句、35 条技术复合词与多音词、20 条中英混输、12 条上下文联想消歧、18 条百科抢权与同音错字陷阱，以及 17 条日常口语防退化护栏句：

```plot title="四个阶段的 librime 端到端首选准确率消融对比" note="测试集共 142 条（bench/bench_cases.tsv，零 userdb 隔离环境）；纯 14B 开源 .gram 体积仅 11.4 MiB，整体准确率已超过 400.8 MiB 的原版语料 .gram。"
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
      "y": {"label": null, "domain": ["CS 整句", "CS 术语", "中英混输", "上下文消歧", "错字陷阱", "日常护栏"]},
      "grid": true,
      "marks": [
        {"mark": "link", "data": [
          {"cat": "CS 整句", "x1": 22.5, "x2": 95.0},
          {"cat": "CS 术语", "x1": 40.0, "x2": 100.0},
          {"cat": "中英混输", "x1": 5.0, "x2": 100.0},
          {"cat": "上下文消歧", "x1": 41.7, "x2": 83.3},
          {"cat": "错字陷阱", "x1": 44.4, "x2": 77.8},
          {"cat": "日常护栏", "x1": 100.0, "x2": 100.0}
        ], "x1": "x1", "x2": "x2", "y1": "cat", "y2": "cat", "stroke": "var(--line)", "strokeWidth": 2},
        {"mark": "dot", "data": [
          {"cat": "CS 整句", "v": 22.5},
          {"cat": "CS 术语", "v": 40.0},
          {"cat": "中英混输", "v": 5.0},
          {"cat": "上下文消歧", "v": 41.7},
          {"cat": "错字陷阱", "v": 44.4},
          {"cat": "日常护栏", "v": 100.0}
        ], "x": "v", "y": "cat", "fill": "var(--stone)", "r": 4.5, "tip": ["cat", "v"]},
        {"mark": "dot", "data": [
          {"cat": "CS 整句", "v": 85.0},
          {"cat": "CS 术语", "v": 100.0},
          {"cat": "中英混输", "v": 100.0},
          {"cat": "上下文消歧", "v": 83.3},
          {"cat": "错字陷阱", "v": 77.8},
          {"cat": "日常护栏", "v": 94.1}
        ], "x": "v", "y": "cat", "dy": -3.2, "fill": "var(--teal)", "r": 4.2, "tip": ["cat", "v"]},
        {"mark": "dot", "data": [
          {"cat": "CS 整句", "v": 95.0},
          {"cat": "CS 术语", "v": 100.0},
          {"cat": "中英混输", "v": 100.0},
          {"cat": "上下文消歧", "v": 83.3},
          {"cat": "错字陷阱", "v": 61.1},
          {"cat": "日常护栏", "v": 100.0}
        ], "x": "v", "y": "cat", "dy": 3.2, "fill": "var(--clay)", "r": 4.5, "tip": ["cat", "v"]}
      ]
    }
  ]
}
```

几个值得说明的结果：

- **修好静态词表带来了主要提升（`38.03% → 88.73%`）**：把百科的 `60000` 假常数还原成真实长尾词频、补齐 `cs_ai` 与中英混输权重后，35 个 CS 术语和 20 个中英混输词条全部达到 **100% 首选命中**，CS 连续整句准确率也从 `22.5%` 升到了 `82.5%`。
- **11.4 MiB 的纯大模型蒸馏 `.gram` 整体超过了 400.8 MiB 的语料 `.gram`（`90.85%` vs `88.73%`）**：不依赖任何外部文本语料、只从 `Qwen3-14B-Base` 的 `lm_head` 蒸馏出的独立语法模型，体积只有原版的约 **1/35**，但在错字陷阱（`77.8%` vs `66.7%`）、上下文消歧（`83.3%` vs `75.0%`）和 CS 整句（`85.0%` vs `82.5%`）上都更高，只在个别日常口语惯用语上略低（日常护栏 `16/17`）。
- **纯蒸馏 `.gram` 与融合去噪 `.gram` 各有取舍（总体 `90.85%` vs `92.25%`）**：融合版保留了大语料的日常搭配骨架，CS 整句盲打进一步升至 **`95.0%`（38/40）**，日常护栏回到 **`100%`（17/17）**，逐字准确率达 **`97.79%`**；但在“错字陷阱”一项上，融合版（`61.1%`，11/18）低于纯 14B 蒸馏版（`77.8%`，14/18）。原因很具体：我的错字审计只清退了词典外错别字，而像 `"说话直接了当"`（正字为 `"直截了当"`）、`"损失已经熟练了"`（近音误替 `"收敛"`）这类由合法词条拼出来的网页高频习惯误用仍留在原版语料树里，纯 14B 蒸馏模型则完全没有这类网页噪声。

## 开源词库、语法模型与工具用法

整套代码、C++ `.gram` 编译合并工具、`librime` 基准评测器，以及用 `Qwen3-14B-Base` 算好的成品词库和独立语法模型，都已经放到 GitHub 仓库 [mizorewww/rime-qwen-freq](https://github.com/mizorewww/rime-qwen-freq)（MIT 协议）。

如果你用的是万象、薄荷或雾凇这类常见全拼/双拼方案，不需要装 PyTorch，直接去 [Releases](https://github.com/mizorewww/rime-qwen-freq/releases/latest) 下载压缩包放进 Rime 目录重新部署即可：

- **成品词表**：`cs_ai.dict.yaml.gz`（1,986 条校对过多音字的 CS/AI/系统术语）、去重校准后的 `zhwiki`、`zhwiktionary`、`moegirl`、`web_slang`、`wanxiang_mixed`、`rime_ice.en`、`rime_ice.en_ext`。
- **纯蒸馏语法模型**：`qwen14b-zh-hans.gram.gz`（压缩包 9.4 MiB，解压后 11.4 MiB，含 103.2 万条高 PMI 搭配与句尾 `$` 标记）。

如果你想在自己的自定义词库上重跑，或者换别的专业领域（比如医学、法律、金融），改一行对称提示词就能复用同一套流程：

```bash
git clone https://github.com/mizorewww/rime-qwen-freq.git
cd rime-qwen-freq
pip install -e ".[score]"

# 1. 扫描本地 Rime 目录，查看哪些词表缺权重或填了假常数
rime-qwen-freq inspect

# 2. 用对称双提示词离线校准词频并提升目标领域词汇
rime-qwen-freq extract -o payload.json.gz
rime-qwen-freq score -i payload.json.gz -o scores.tar.gz \
  --model Qwen/Qwen3-14B-Base \
  --domain-prompt "计算机科学与人工智能术语：" \
  --general-prompt "日常与百科常见词条："
rime-qwen-freq apply -p payload.json.gz -s scores.tar.gz --deploy

# 3. 直接从语言模型蒸馏 .gram 语法搭配并编译
rime-qwen-freq distill-ngram -o distilled_ngrams.tsv.gz --model Qwen/Qwen3-14B-Base
gunzip -k distilled_ngrams.tsv.gz
c++ -O3 -std=c++17 tools/gram_tool.cc -o gram_tool
./gram_tool build distilled_ngrams.tsv qwen14b-zh-hans.gram

# 4. 在隔离沙箱中调用本机原生 librime 跑端到端准确率评测
rime-qwen-freq bench --rime-dir ~/Library/Rime --schema rime_mint
```

输入法每次击键的响应预算只有几毫秒，把大模型直接放进输入法进程既费电又增加延迟。更合适的分工是在离线阶段用基座模型算好词频先验、领域区分度和词间互信息，导出成原有的静态词表与双数组前缀树，打字时仍然只做内存映射查表。
