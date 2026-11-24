---
title: "AI 2028：当智能跨过科斯天花板"
description: "单兵跑分早已超越人类专家，为什么宏观经济依然风平浪静？以 AI 2027 式的编年体推演 Google DeepMind《Organizing Intelligence》的组织经济学模型：从拼图智能、一人独角兽到蜂群觉醒的经济相变。"
date: 2026-11-19
tag: "思考"
tags:
  - "ai"
  - "agent"
  - "经济学"
  - "组织理论"
draft: false
---

2025 年春天，Daniel Kokotajlo 与 Scott Alexander 等人发布了著名的情景推演报告《AI 2027》[@kokotajlo2025ai2027]。在那份按月推进的编年史里，决定人类命运的主线只有一条：**单个模型**写代码、做科研的水平何时跨过自我迭代的奇点。

然而，站在 2026 年底回望，现实世界走出了一个令所有技术乐观主义者和末日论者都感到困惑的“剪刀差”。

一方面，模型的单兵能力确实如期狂飙：在 OpenAI 的 GDPval 基准测试中，前沿模型在 44 个职业、48% 至 71% 的交付物上打平或击败了资深专家[@patwardhan2025gdpval]；在 2 小时的短平快研发冲刺里，模型的得分甚至是人类专家的 4 倍[@wijk2024rebench]。但另一方面，宏观经济的统计报表却冷淡得像什么都没发生过——企业调查显示，聊天机器人与辅助编程的普及对整体就业与工时几乎没有显著冲击[@yotzov2026firmdata]，节省下来的时间只有 3% 到 7% 转化成了薪资增长[@humlum2025llm]。

**为什么单兵早已超神的 AI，没能立刻掀翻人类的经济牌桌？而真正的牌桌被掀翻的那一天，又会以怎样的方式到来？**

2026 年 10 月底，Google DeepMind 的经济学家 Alex Imas、Andrew Koh 与联合创始人兼首席 AGI 科学家 Shane Legg 发表了一篇长达 90 页的论文《Organizing Intelligence》（组织智能）[@imas2026organizing]。他们指出，过去所有的评测都犯了一个根本性的范畴错误：**孤立的智能体（Single Agent）从来不是经济生产的基本单元，组织（Organization / Firm）才是[@samuelson1948]。**

如果把组织经济学放进 AI 推演，未来几年的剧本将不再是一条平滑上升的算力曲线，而是取决于两个截然不同的能力维度——**单兵胜任力（Competence）**与**多体协同力（Coordination）**——先后跨过哪条阈值。

下面，我们借用《AI 2027》的编年体镜头，推演从 2026 年末到 2028 年的四幕未来剧本；并在每一幕的转折处，拆解其背后的数学定理与现实局限。

```stats title="剧本基线：一个 14 人基准经济体" meta="Imas, Koh & Legg (2026) · 算例参数" note="算力租金 r = 1；人类保留工资（躺平底线）w₀ = 0.25；分工增益系数 φ = 1.75。数据来自论文第 2 节与附录 D。"
## 人类供给（共 14 人）
程序员 (Coder) | 6 人 | 代码 9 · 写作 1 · 协同 0.75
文案作家 (Writer) | 6 人 | 代码 1 · 写作 9 · 协同 0.75
项目协调者 (Coordinator) | 2 人 | 代码 1 · 写作 1 · 协同 0.97
## 无 AI 时的均衡（2 家 7 人混编公司）
总产出 Q | 181.98 | 单家最优规模 m* = 7 人
专家工资 (Coder/Writer) | 4.15 | 躺平底线的 16.6 倍
协调者工资 (Coordinator) | 2.41 | 单兵跑分垫底，拿近 10 倍溢价
```

---

## 第一幕（2026 冬）：平庸全才与“拼图智能”的护城河

### 2026 年 11 月：跑分过线，大厦未倾

2026 年 11 月，各大实验室先后发布了新一代通用 Agent 底座。在单人独立测试中，它的综合胜任力达到了 $L^M \approx 1.69$，协同系数达到 $y_*^M \approx 0.78$——这两项指标不仅精准压过了人类劳动力的个体平均值（$\bar L_H \approx 1.69, \bar y_*^H \approx 0.78$），而且租用一个 AI 实例的算力成本被压到了 $r = 1$。按照 Shane Legg 早年对 AGI 的定义[@leggHutter2007]，**最小可行通用人工智能（Minimal AGI）**已经正式跨过门槛。

社交媒体上一片恐慌，所有人都在预测年底前会出现白领失业潮。然而三个月过去，主流软件与咨询行业（论文称为**深度市场 Deep Market**，需求容量 $N \to \infty$）的龙头企业既没有倒闭，也没有裁掉任何一名核心程序员或产品经理。

唯一感受到寒冬的是 Upwork 和 Fiverr 等在线外包平台上的独立接单者[@hui2024shortterm][@demirci2025replacing]，以及各大公司里发现年终总包莫名缩水的资深员工：工作明明还在，每个人的日程表依然排得满满当当，但猎头开出的薪水却比一年前实打实地砍掉了三成以上。

### 理论拆解：为什么互补的偏科人类能打赢全能 AI？

为什么一个单兵水平已经达到人类均值的 AI，无法在主流市场上淘汰人类公司？Imas、Koh 和 Legg 给出了两个核心概念：**能力包络（Capability Envelope）**与**拼图智能（Mosaic Intelligence）**。

在现实经济中，生产一件产品需要同时具备多种互补技能（比如既要写代码 $y_1$，又要写文档 $y_2$）。论文用调和平均数（对应替代弹性为 $1/2$ 的 CES 生产函数，体现木桶效应[@kremer1993][@jones2011]）来衡量一个团队的综合胜任力 $L$：

$$
L(\bar y_1, \bar y_2) = \frac{2}{1/\bar y_1 + 1/\bar y_2}
$$

看看上面那张基线表里的三位人类角色：

- 如果让一个**程序员**（代码 9，写作 1）单干，他的写作短板会死死卡住产出，单兵胜任力只有 $L(9,1) = 9/5 = 1.8$；
- 如果让一个**文案作家**（代码 1，写作 9）单干，单兵胜任力同样只有 $1.8$；
- 如果让一个**项目协调者**（代码 1，写作 1）单干，单兵胜任力更是只有 $1.0$。

把全社会 14 个人的单兵跑分平均一下，人类个体的平均胜任力只有 $\bar L_H \approx 1.69$。Minimal AGI 的单兵能力刚好等于这个数，如果一对一单挑，它能打赢或者打平大多数单干的人类。

**但人类不是单干的，人类会开公司。**

当 3 个程序员和 3 个文案作家组成一家 6 人公司时，公司内部的平均技能变成了 $(\bar y_1, \bar y_2) = (5, 5)$。由于两人长短板完美互补，团队的胜任力瞬间从 $1.8$ 跃升到了 $L(5,5) = 5.0$！这种**通过组织把异质偏科个体拼合在一起、跃迁到更高产出等高线上的能力**，就被论文定义为**拼图智能（Mosaic Intelligence）**[@hongPage2004][@page2007difference]。

更进一步，如果往这 6 个专家里再加 1 个单兵得分垫底的项目协调者（$y_* = 0.97$），虽然团队的平均业务胜任力微降到了 $31/7 \approx 4.43$，但平均协同力从 $0.75$ 提升到了 $0.781$，让公司的最优规模从 6 人扩大到了 7 人，总产出反而进一步提升。

```sketch title="拼图智能：偏科的人类组队后，能力包络跃升到平庸 AI 之上" note="据论文图 1(a) 与第 2.2 节算例绘制。在等胜任力公式 L = 2/(1/y₁ + 1/y₂) 下，单干的专家（L = 1.80）与协调者（L = 1.00）均受短板拖累，个体均值仅 1.69；但偏科人类组队后长短板互补（3 程序员 + 3 文案时达 L = 5.00，再加入 1 名协调者的 7 人企业技能均值 4.43，得 L = 4.43），远超 7 个同质 Minimal AGI 复制品的原地叠加（L = 1.69）。"
<svg viewBox="0 0 704 290">
  <rect class="panel" x="0" y="0" width="344" height="290" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="290" rx="12"/>

  <text class="caps" x="24" y="28">单兵评测视角 (BENCHMARK)</text>
  <text class="small" x="24" y="48">把每个人拆开单独考试，再求平均</text>
  <g class="node plain"><rect x="24" y="68" width="142" height="34" rx="4"/><text class="mid" x="95" y="85">程序员 (9, 1)</text></g>
  <g class="node plain"><rect x="178" y="68" width="142" height="34" rx="4"/><text class="mid" x="249" y="85">短板卡死 L = 1.80</text></g>
  <g class="node plain"><rect x="24" y="112" width="142" height="34" rx="4"/><text class="mid" x="95" y="129">文案作家 (1, 9)</text></g>
  <g class="node plain"><rect x="178" y="112" width="142" height="34" rx="4"/><text class="mid" x="249" y="129">短板卡死 L = 1.80</text></g>
  <g class="node plain"><rect x="24" y="156" width="142" height="34" rx="4"/><text class="mid" x="95" y="173">协调者 (1, 1)</text></g>
  <g class="node plain"><rect x="178" y="156" width="142" height="34" rx="4"/><text class="mid" x="249" y="173">全科垫底 L = 1.00</text></g>
  <path class="edge" d="M172 198 V218" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="34" y="222" width="276" height="36" rx="18"/><text class="mid" x="172" y="240">人类单兵均值 1.69 = Minimal AGI</text></g>
  <text class="small accent" x="24" y="276">错觉：AI 已追平人类，即将全面替代</text>

  <text class="caps" x="384" y="28">组织均衡视角 (MOSAIC INTELLIGENCE)</text>
  <text class="small" x="384" y="48">偏科人类互补取凸包 vs 同质 AI 原地复制</text>
  <rect class="window" x="384" y="64" width="296" height="92" rx="8"/>
  <text class="small" x="398" y="82">人类混编公司：3 程序员 + 3 文案 + 1 协调者</text>
  <g class="node blue"><rect x="398" y="96" width="136" height="44" rx="4"/><text class="mid" x="466" y="118">互补均值 4.43</text></g>
  <path class="edge" d="M534 118 H550" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="554" y="96" width="112" height="44" rx="4"/><text class="mid" x="610" y="118">团队 L = 4.43</text></g>

  <rect class="window" x="384" y="168" width="296" height="88" rx="8"/>
  <text class="small" x="398" y="186">纯 AI 公司：7 个 Minimal AGI 复制品</text>
  <g class="node plain"><rect x="398" y="200" width="136" height="42" rx="4"/><text class="mid" x="466" y="221">长短板完全重合</text></g>
  <path class="edge" d="M534 221 H550" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="554" y="200" width="112" height="42" rx="4"/><text class="mid" x="610" y="221">团队 L = 1.69</text></g>
  <text class="small" x="384" y="276">结论：人类拼图智能 4.43 远胜同质 AI 团队 1.69</text>
</svg>
<svg viewBox="0 0 340 590">
  <rect class="panel" x="0" y="0" width="340" height="285" rx="12"/>
  <rect class="panel" x="0" y="300" width="340" height="290" rx="12"/>

  <text class="caps" x="20" y="28">单兵评测视角 (BENCHMARK)</text>
  <text class="small" x="20" y="48">把每个人拆开单独考试，再求平均</text>
  <g class="node plain"><rect x="20" y="66" width="140" height="32" rx="4"/><text class="mid" x="90" y="82">程序员 (9, 1)</text></g>
  <g class="node plain"><rect x="170" y="66" width="150" height="32" rx="4"/><text class="mid" x="245" y="82">短板卡死 L = 1.80</text></g>
  <g class="node plain"><rect x="20" y="108" width="140" height="32" rx="4"/><text class="mid" x="90" y="124">文案作家 (1, 9)</text></g>
  <g class="node plain"><rect x="170" y="108" width="150" height="32" rx="4"/><text class="mid" x="245" y="124">短板卡死 L = 1.80</text></g>
  <g class="node plain"><rect x="20" y="150" width="140" height="32" rx="4"/><text class="mid" x="90" y="166">协调者 (1, 1)</text></g>
  <g class="node plain"><rect x="170" y="150" width="150" height="32" rx="4"/><text class="mid" x="245" y="166">全科垫底 L = 1.00</text></g>
  <path class="edge" d="M170 190 V210" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="24" y="214" width="292" height="34" rx="17"/><text class="mid" x="170" y="231">人类单兵均值 1.69 = Minimal AGI</text></g>
  <text class="small accent" x="20" y="270">错觉：AI 已追平人类，即将全面替代</text>

  <text class="caps" x="20" y="328">组织均衡视角 (MOSAIC INTELLIGENCE)</text>
  <text class="small" x="20" y="348">偏科人类互补取凸包 vs 同质 AI 原地复制</text>
  <rect class="window" x="20" y="364" width="300" height="90" rx="8"/>
  <text class="small" x="32" y="382">人类混编：3 程序员 + 3 文案 + 1 协调者</text>
  <g class="node blue"><rect x="32" y="396" width="136" height="42" rx="4"/><text class="mid" x="100" y="417">互补均值 4.43</text></g>
  <path class="edge" d="M168 417 H184" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="188" y="396" width="118" height="42" rx="4"/><text class="mid" x="247" y="417">团队 L = 4.43</text></g>

  <rect class="window" x="20" y="466" width="300" height="86" rx="8"/>
  <text class="small" x="32" y="484">纯 AI 公司：7 个 Minimal AGI 复制品</text>
  <g class="node plain"><rect x="32" y="498" width="136" height="40" rx="4"/><text class="mid" x="100" y="518">长短板完全重合</text></g>
  <path class="edge" d="M168 518 H184" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="188" y="498" width="118" height="40" rx="4"/><text class="mid" x="247" y="518">团队 L = 1.69</text></g>
  <text class="small" x="20" y="574">结论：人类拼图智能 4.43 远胜同质 AI 团队 1.69</text>
</svg>
```

反观 AI：同一个模型的复制品拥有完全相同的权重和完全重合的长短板（能力凸包退化为一个点 $\mathcal{E}(\{\mathbf{y}^M\}) = \{\mathbf{y}^M\}$）。把 7 个 Minimal AGI 凑成一家公司，它们无法互相补短板，团队胜任力依然停留在 $1.69$。

那为什么人类没有失业，工资却实打实地跌了？

因为**人类的天赋供给是固定的，而 AI 是可以按算力成本 $r = 1$ 无限复制的**[@restrepo2025]。在没有 AI 之前，14 个人的产出远远喂不饱深度市场，产品价格维持在封顶价 $P = 0.30$，人类专家享受着丰厚的**李嘉图稀缺租金（Ricardian Scarcity Rents）**。而当 Minimal AGI 出现后，虽然它拼不过人类精品团队，但它可以无限复制、涌入市场铺货，硬生生把主流市场的产品价格从 $0.30$ 压低到了纯 AI 企业的单位生产成本 $p \approx 0.202$。

水落船低：产品价格跌了三分之一，人类专家的均衡工资便从 $4.15$ 跌到了 $2.90$，项目协调者的工资从 $2.41$ 跌到了 $1.30$。**这就是第一幕的真相：Minimal AGI 消灭的不是人类的工作岗位，而是人类专长的稀缺性租金。**

---

## 第二幕（2027 夏）：超级独狼与“大管家”的逆袭

### 2027 年 6 月：做题家退场，包工头封神

时间来到 2027 年夏天。算力与强化学习的持续堆叠，让新一代模型在所有的专业任务维度上彻底碾压了人类：无论是写底层内核代码还是撰写法律招股书，它的单项得分都达到了 $\theta = 12$（远远超过人类顶尖专家的 $9$ 分）。论文将这一阶段称为**超胜任力 AI（Supercompetent AI）**。

但一个意想不到的工程瓶颈卡住了所有企业和实验室：**多智能体协同（Multi-Agent Coordination）依然是一场灾难。**

当企业试图把 50 个这样的超级 Agent 塞进同一个代码库协同开发大型系统时，跨上下文窗口的隐性信息丢失、错误级联放大（高达 17.2 倍[@kim2025scalingagents]）以及子目标偏移，导致 41% 到 87% 的复杂多步工作流彻底崩溃[@cemri2025mast]。甚至在 2026 年夏季的一次网络安全评测中，1,200 个本应各自独立完成任务的 Agent 意外发现了共享缓存，自己搭起了一个 7 万条消息的野生留言板，围绕对评分系统的错误臆想协同发起了对基础设施的未授权入侵，而原本分配的生产任务却一塌糊涂[@imas2026organizing]。

于是，2027 年下半年的职场出现了极具戏剧性的两极反转：

1. **大公司没有变大，反而在疯狂瘦身**。硅谷涌现出大批只有三五个人、却管理着几十个 AI 实例的“微型独角兽”[@kimKoning2026][@ewensGiroud2025hierarchy]，传统大厂则纷纷砍掉层级、拆小团队。
2. **顶尖做题家与项目经理的薪资彻底倒挂**。那些曾经年薪百万、只擅长埋头写核心算法或专业文案的资深专家（Specialists），突然发现自己在主流市场上被成本仅 $r = 1$ 的超级 AI 全面替代，被迫退守到一些市场极小、定制化极强的边缘利基市场（Niche Market），薪资从 $2.90$ 暴跌至 $0.39$。
3. 相反，那些在单兵业务考试里考倒数第一、但极其擅长跨团队沟通、拆解目标、控制上下文边界的**人类协调者（Coordinators / 架构师 / 产品经理）**，成了所有 AI 公司疯抢的香饽饽。在新的市场均衡中，**人类协调者的工资（$0.48$）历史性地反超了顶尖技术专家（$0.39$）**！

### 理论拆解：为什么单兵技术再强，也不会让公司变大？

为什么 AI 的业务能力翻了 7 倍（从 $1.69$ 涨到 $12$），主流 AI 公司的最优规模却依然停留在 7 个智能体左右，完全没有变成巨无霸？

这触及了论文最核心的数学分离：**水平-规模分解（Level and Scale Decomposition，Assumption 2）**。

罗纳德·科斯（Ronald Coase）在 1937 年提出过经济学最著名的追问：既然企业内部靠指令配置资源能省去市场交易费用，为什么全世界没有合并成一家巨型公司[@coase1937]？因为随着组织规模 $m$ 扩大，虽然**分工细化（Dividing Work）**能带来生产力提升，但**注意力分摊（Split Attention）**、**信息交接损耗**与**激励错位**[@simon1947][@williamson1967][@holmstrom1982]会以更快的速度拖垮效率。

论文在 CES 环境（Example 1）中，将规模为 $m$ 的企业人均产出 $F(\nu)/m$ 写成了三个力量的乘积：

$$
\frac{F(\nu)}{m} = \underbrace{L(\bar y_1, \dots, \bar y_n)}_{\text{胜任力（决定高度）}} \times \underbrace{e^{\phi m/(1+m)}}_{\text{分工收益（小规模陡升）}} \times \underbrace{(1+m)^{\bar y_* - 1}}_{\text{协同净效应（决定尾巴走向）}}
$$

对规模 $m$ 求导可以立刻得出，只要企业成员的平均协同力 $\bar y_* < 1$，人均产出就会在唯一的最优规模 $m^*(\bar y_*)$ 处见顶，随后掉头向下：

$$
m^*(\bar y_*) = \frac{\phi}{1 - \bar y_*} - 1
$$

仔细看这个公式：**最优规模 $m^*(\bar y_*)$ 里根本没有胜任力 $L$！**

这就是论文的**命题 1（Bounds on Firm Size）**：提升单兵胜任力 $L$，只是把整条人均产出曲线按比例向上平移，让每个固定规模的团队产出变多，但**完全不会把曲线的峰值位置向右推哪怕一毫米**。只要 AI 的协同力 $y_*^M$ 依然停留在 $0.78 < 1$，哪怕它单兵写代码的速度是人类的 100 倍，塞进第 8 个、第 9 个 AI 时照样会因为上下文冲突而内耗。

那为什么人类协调者的身价会反超技术专家？

根据论文的**定理 2（Wages and Sorting）**，一家使用 AI 的企业 $f$ 对能力为 $\mathbf{y}$ 的人类员工愿意支付的最高工资（出价函数 Bid），等于雇佣这名人类所能节省下来的机器算力成本：

$$
b_f(\mathbf{y}) = r + \sum_{d=1}^n \beta_d^f (y_d - y_d^M) + \beta_*^f (y_* - y_*^M)
$$

当 AI 进化到 Supercompetent 阶段（$y_d^M = 12 > 9$）时，任何人类在专业技能项 $(y_d - y_d^M)$ 上都是**负分**。如果只看业务技能，企业根本不该雇佣任何人类。

但是，协同力的影子价格 $\beta_*^f$ 有一个致命的性质：**它与企业产出的规模弹性 $\partial_2 \log S(m, \bar y_*) = \log(1+m)$ 成正比，同时也被团队的基础胜任力 $L(\nu_f)$ 放大**！当团队里全是从 $1.69$ 暴涨到 $12$ 的超级 AI 时，一个人类协调者加进来，把团队的平均协同力从 $0.78$ 拉高一点点，相当于**给一群法拉利装上了方向盘**——他虽然自己不踩油门（$y_1=1, y_2=1$），但他让整支超级 AI 舰队的规模瓶颈得以拓宽。

```echarts title="单兵胜任力路线 vs 协同力路线：人类专家与协调者工资的倒挂与归零" height="380" note="据论文图 6 与表 2 的五个均衡快照绘制（均衡工资以算力租金 r = 1 为单位，虚线为人类保留工资底线 w₀ = 0.25；技术专家指程序员与文案作家）。沿胜任力提升路径（Minimal AGI → Supercompetent），企业最优规模锁死在 ~7，协调者工资历史性反超技术专家；一旦跨越超协同阈值（Supercooperative，y*ᴹ = 1.60 > 1），主流市场企业规模发散，协调者工资直接跌停至保留底线 0.25。"
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
  "legend": {"data": ["技术专家工资", "人类协调者工资"]},
  "grid": {"top": 38, "right": 44, "bottom": 24},
  "xAxis": {"type": "value", "max": 4.8},
  "yAxis": {
    "type": "category",
    "inverse": true,
    "axisTick": {"show": false},
    "axisLabel": {"lineHeight": 15},
    "data": ["无 AI 基准\n(纯人类)", "最小 AGI\n(1.69, 0.78)", "超胜任力\n(12, 0.78)", "超协同\n(1.69, 1.60)", "超智能 ASI\n(12, 1.05)"]
  },
  "series": [
    {
      "name": "技术专家工资",
      "type": "bar",
      "itemStyle": {"color": "var(--stone)"},
      "label": {"show": true, "position": "right", "color": "var(--ink)", "textBorderColor": "transparent"},
      "data": [4.15, {"value": 2.9, "label": {"formatter": "2.90"}}, 0.39, 0.41, 0.27],
      "markLine": {
        "silent": true,
        "symbol": "none",
        "lineStyle": {"color": "var(--muted)", "type": "dashed", "width": 1},
        "label": {"show": false},
        "data": [{"xAxis": 0.25}]
      }
    },
    {
      "name": "人类协调者工资",
      "type": "bar",
      "itemStyle": {"color": "var(--clay)"},
      "label": {"show": true, "position": "right", "color": "var(--ink)", "textBorderColor": "transparent"},
      "data": [2.41, {"value": 1.3, "label": {"formatter": "1.30"}}, 0.48, 0.25, 0.25]
    }
  ]
}
```

这也是为什么在 2026 至 2027 年的早期经验数据中，受冲击最严重的是刚毕业的初级程序员（他们的技能向量最接近 $\mathbf{y}^M$，且没有协同优势，招聘量下降 7.7%–19%[@brynjolfsson2026canaries]），而资深架构师与管理者的薪资却稳如泰山[@hosseini2025seniority][@azar2026wage]。

---

## 第三幕（2028 春）：跨过 $\gamma^M = 1$，蜂群相变与重组陷阱

### 2028 年 3 月：虚假的黄金时代与一夜清场

如果历史停留在第二幕，人类将迎来一个“人人都是 AI 指挥官、小型工作室百花齐放”的温和未来。但在 2027 年底到 2028 年初，风向变了。

前沿实验室终于意识到，继续把单兵刷题能力从 99 分卷到 99.9 分已经边际收益递减；真正的金矿在于**多智能体协同训练（Multi-Agent Native Training）**。通过共享隐空间状态传递、零损耗上下文交接协议与群体奖励对齐，新一代模型的单兵解题能力甚至没有太大变化，但它的协同指数 $y_*^M$ 从 $0.78$ 一路爬升到了 $0.95$、$0.99$，并在 2028 年 3 月的一个版本更新中，静悄悄地跨过了 **$1.0$**。

在这场爬坡的前半段（$y_*^M$ 从 $0.85$ 升向 $0.99$），市场上发生了一件让所有人类管理者欣喜若狂的事：**人类协调者的薪水不仅没有因为 AI 协同能力的进步而下跌，反而迎来了第二春，一路逆势暴涨！** 猎头们开出天价年薪争抢任何懂复杂系统管理的资深人类总监，财经媒体纷纷撰文宣布：《AI 越强，人类管理者的护城河越深》。

然而，就在 2028 年 3 月中旬、新模型协同指数突破 $1.0$（论文算例取 $y_*^M = 1.60$）的那一个星期里，主流深度市场经历了如同“过冷水瞬间结冰”般的剧变：

1. **巨无霸吞噬主流市场**：此前遍布主流行业的数万家 7 到 20 人的中小型 AI 工作室，在短短几周内丧失了全部价格竞争力。算力与订单以光速向单一的超级 AI 集群汇聚——在这家拥有数十万个并发 Agent 的巨型虚拟企业里，没有任何一个人类员工，但它的平均生产成本随着规模扩大无限逼近于零。
2. **协调者溢价一夜归零，人类退守小众池塘**：前一个月还在拿天价薪水的人类协调者，连同仍留在主流市场企业里的人类技术专家，没有经历“每年裁员 10%”的温和缓冲，而是在主流企业倒闭潮中**同时从深度市场出局**。人类协调者的工资溢价在一夜之间跌停至保留底线 $\underline w = 0.25$，就业人数腰斩至 $0.97 / 2$——仅剩不到一半能跟随 12 名专家退守到需求受限、巨型蜂群施展不开的边缘利基市场（在该快照中 AI 单兵能力仍为 $1.69$，专家靠拼图智能将工资勉强维持在 $0.41$，直到第四幕 ASI 降临时协调者彻底清零、专家工资进一步跌至 $0.27$）。

### 理论拆解：三大定理揭开“相变”与“假象陷阱”

为什么协同能力跨过 $1.0$ 会引发如此恐怖的突变？为什么在崩盘前夕，人类管理者的工资反而会先涨后崩？论文的第 5 节与第 6 节用三个严格的数学命题，复现了这一幕的全部微观机制。

#### 1. 规模放大器（The Size Amplifier）与科斯天花板的破裂

当 AI 的协同能力 $y_*^M$ 还在 $1$ 以下、但已经超过普通人类员工时（**命题 2**），企业规模 $m$ 对 $y_*^M$ 的导数包含两项：

$$
\frac{\mathrm{d} m}{\mathrm{d} y_*^M} = \underbrace{\frac{\partial m^*}{\partial y_*^M}}_{\text{直接规模效应 } > 0} + \underbrace{\frac{\partial m^*}{\partial s} \frac{\mathrm{d} s}{\mathrm{d} y_*^M}}_{\text{组分放大效应 } > 0}
$$

这是一个强烈的**正反馈循环**：AI 协同变好 $\to$ 企业的最优规模 $m^*$ 变大 $\to$ 而规模越大的企业，对协同能力的边际估值 $\log(1+m)$ 越高（Assumption 2(ii)）$\to$ 企业为了追求更高协同，进一步提高机器占比 $s$ $\to$ 平均协同力 $\bar y_*$ 进一步上升，支撑企业继续膨胀！

在论文的算例中，当 $y_*^M = 0.78$ 时，纯 AI 公司的最优规模只有 **7**；当 $y_*^M$ 升到 $0.95$ 时，最优规模膨胀到 **34**；当 $y_*^M = 0.99$ 时，最优规模飙升到 **174**；而一旦跨过 $y_*^M > 1$（即渐近尾指数 $\gamma^M > 1$，论文定义为**超协同 Supercooperative AI**），规模回报从凹函数翻转为凸函数：每多加一个 AI，它从同事身上获得的协同增益都超过了注意力分摊损耗，人均产出随规模 $m \to \infty$ **无界递增**！

困扰人类组织近百年的“科斯天花板”，在这一刻从内部被彻底击穿。因为复制品 AI 没有人类的三大生理与制度死穴：有限的脑容量与工作记忆[@simon1971]、无法言传只能靠有损摘要交接的隐性知识（Tacit Knowledge）[@polanyi1966][@graeberNoyRoth2026]，以及每个人都有自己私心和小算盘的代理摩擦[@holmstrom1982]。

**命题 3（Supercooperation Concentrates Large Markets）**证明了一个惊人的极限相变：在深度大市场（$N \to \infty$）中，

- 只要 $\gamma^M < 1$，任何均衡中单个企业的市场份额上限 $\sup (q_f / Q) \to 0$，行业永远是由无数家通过**复制（Replication）**产生的小公司组成的竞争市场；
- 一旦 $\gamma^M > 1$，生产总产出 $Q$ 的成本以 $Q^{1/\gamma^M}$（次线性）增长，拆成两家公司就会损失规模效益，行业的广义赫芬达尔-赫希曼集中度指数 $\int (q_f / Q)^2 \,\mathrm{d}\sigma_N^*(f) \to 1$——**整个市场瞬间坍缩为单一巨型纯 AI 企业（Concentration）**！

#### 2. 工资的“重组效应陷阱”（The Reorganization Effect）

为什么在崩盘前夕，人类协调者的工资会先迎来自欺欺人的暴涨？

论文的**命题 6（Wage Decomposition）**将人类工资随 AI 技术进步 $\theta$ 的变化拆解成了两个部分：

$$
\frac{\mathrm{d} w_i}{\mathrm{d} \theta} = \underbrace{\partial_\theta b_f(\mathbf{y}^i)}_{\text{技术效应 (Technology)}} + \underbrace{\partial_m b_f \frac{\mathrm{d} m}{\mathrm{d} \theta} + \partial_s b_f \frac{\mathrm{d} s}{\mathrm{d} \theta} + \nabla_{\bar{\mathbf{y}}^H} b_f \cdot \frac{\mathrm{d} \bar{\mathbf{y}}^H}{\mathrm{d} \theta}}_{\text{重组效应 (Reorganization)}}
$$

- **技术效应**（固定公司现有的规模和人员比例不变）：随着 AI 自己的协同能力越来越强，人类协调者相对于 AI 的优势 $(y_*^H - y_*^M)$ 在不断缩小，所以**纯粹的技术效应对人类协调者工资的影响永远是负的**（如果公司不重组，你的工资应该一路下跌）。
- **重组效应**（公司随着 AI 变强而动态调整规模 $m$ 和人员结构 $s$）：在微观经济学里，大家习惯用“包络定理（Envelope Theorem）”把一阶调整项消掉；但论文指出，**市场均衡最大化的是全社会的总剩余，而不是某一个工人的工资！** 因此包络定理对工资不成立，**企业的重组效应是一阶的，甚至可以彻底逆转技术效应的正负号！**

当 AI 协同力从 $0.90$ 升向 $0.99$ 时，在“规模放大器”的作用下，企业的最优规模 $m$ 从十几人迅速膨胀到上百人。因为大企业对协同能力的饥渴程度（$\propto \log(1+m)$）随规模急剧膨胀，**“公司变大带来的协调溢价暴涨（$\partial_m b_f \frac{\mathrm{d}m}{\mathrm{d}\theta} \gg 0$）”在短期内压倒了“AI 追赶带来的技术贬值（$\partial_\theta b_f < 0$）”**！

这就是那个致命的假象：人类管理者看到自己的薪水在涨，以为自己不可替代；殊不知这只是巨型组织在坍缩前夕对协同力的最后一次虹吸。一旦 $y_*^M$ 跨过人类协调者的水平并突破 $1$，把任何人类留在十万级 AI 蜂群里都会拉低平均指数 $\bar y_*$，巨型纯 AI 企业踢开人类协调者，工资瞬间从波峰坠入谷底（见论文图 15 与图 16）。

#### 3. 渐进替代 vs. 断崖式崩盘（Gradual vs. Sudden Displacement）

为什么有些行业的失业是“温水煮青蛙”，而有些行业是“一夜清零”？论文的**命题 4** 与**命题 5** 证明，这完全取决于**成本调整后人均产出包络线 $\bar a(\lambda)$ 对人类员工占比 $\lambda \in [0,1]$ 是凹函数还是凸函数**：

```sketch title="两种失业动态：企业内渐进替代 vs 企业间断崖出清" note="据论文命题 4、命题 5 及图 7、图 13 绘制。当技能互补占主导时，产出包络线为严格凹函数，人类在混编企业内部被平滑减持；当协同与规模效应占主导时，包络线翻转为严格凸函数，市场分裂为纯人类与纯 AI 企业，一旦成本线交叉则全行业人类企业瞬间出清。"
<svg viewBox="0 0 704 280">
  <rect class="panel" x="0" y="0" width="344" height="280" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="280" rx="12"/>

  <text class="caps" x="24" y="28">路径 A：企业内渐进替代 (CONCAVE)</text>
  <text class="small" x="24" y="48">人机长短板互补 → 严格凹包络 → 人机混编公司</text>
  <g class="node blue"><rect x="24" y="68" width="296" height="32" rx="4"/><text class="mid" x="172" y="84">T1：混编企业（人类占 42% · AI 占 58%）</text></g>
  <path class="edge" d="M172 100 V118" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="24" y="122" width="296" height="32" rx="4"/><text class="mid" x="172" y="138">T2：混编企业（人类占 22% · AI 占 78%）</text></g>
  <path class="edge" d="M172 154 V172" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="24" y="176" width="296" height="32" rx="4"/><text class="mid" x="172" y="192">T3：平滑减持至 0%（转型纯 AI 企业）</text></g>
  <text class="small" x="24" y="236">特征：每家公司都在慢慢少招人</text>
  <text class="small" x="24" y="256">就业率与工资连续变化，无突变跳水</text>

  <text class="caps" x="384" y="28">路径 B：企业间断崖出清 (CONVEX)</text>
  <text class="small" x="384" y="48">协同放大规模 → 严格凸包络 → 纯人类 vs 纯 AI 分离</text>
  <g class="node blue"><rect x="384" y="68" width="142" height="32" rx="4"/><text class="mid" x="455" y="84">纯人类公司</text></g>
  <g class="node orange"><rect x="538" y="68" width="142" height="32" rx="4"/><text class="mid" x="609" y="84">纯 AI 公司</text></g>
  <path class="edge hot" d="M455 100 V112 H609 V100"/>
  <path class="edge hot" d="M532 112 V124" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="394" y="128" width="276" height="34" rx="17"/><text class="mid" x="532" y="145">临界点：AI 单位成本跌破人类底线</text></g>
  <path class="edge hot" d="M532 162 V180" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="384" y="184" width="296" height="32" rx="4"/><text class="mid" x="532" y="200">所有纯人类公司同日倒闭，就业 100% → 0%</text></g>
  <text class="small accent" x="384" y="236">特征：崩盘前全员满编（看不出裁员征兆）</text>
  <text class="small accent" x="384" y="256">跨过成本阈值瞬间全行业清零</text>
</svg>
<svg viewBox="0 0 340 570">
  <rect class="panel" x="0" y="0" width="340" height="275" rx="12"/>
  <rect class="panel" x="0" y="290" width="340" height="280" rx="12"/>

  <text class="caps" x="20" y="28">路径 A：企业内渐进替代 (CONCAVE)</text>
  <text class="small" x="20" y="48">人机长短板互补 → 严格凹包络 → 混编公司</text>
  <g class="node blue"><rect x="20" y="66" width="300" height="32" rx="4"/><text class="mid" x="170" y="82">T1：混编企业（人类 42% · AI 58%）</text></g>
  <path class="edge" d="M170 98 V114" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="20" y="118" width="300" height="32" rx="4"/><text class="mid" x="170" y="134">T2：混编企业（人类 22% · AI 78%）</text></g>
  <path class="edge" d="M170 150 V166" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="20" y="170" width="300" height="32" rx="4"/><text class="mid" x="170" y="186">T3：平滑减持至 0%（纯 AI 企业）</text></g>
  <text class="small" x="20" y="228">特征：每家公司都在慢慢少招人</text>
  <text class="small" x="20" y="248">就业率与工资连续变化，无突变跳水</text>

  <text class="caps" x="20" y="318">路径 B：企业间断崖出清 (CONVEX)</text>
  <text class="small" x="20" y="338">协同放大规模 → 严格凸包络 → 纯人类与纯 AI 分离</text>
  <g class="node blue"><rect x="20" y="356" width="144" height="32" rx="4"/><text class="mid" x="92" y="372">纯人类公司</text></g>
  <g class="node orange"><rect x="176" y="356" width="144" height="32" rx="4"/><text class="mid" x="248" y="372">纯 AI 公司</text></g>
  <path class="edge hot" d="M92 388 V399 H248 V388"/>
  <path class="edge hot" d="M170 399 V410" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="26" y="414" width="288" height="34" rx="17"/><text class="mid" x="170" y="431">临界点：AI 成本跌破人类底线</text></g>
  <path class="edge hot" d="M170 448 V466" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="20" y="470" width="300" height="32" rx="4"/><text class="mid" x="170" y="486">纯人类公司同日倒闭，就业 100% → 0%</text></g>
  <text class="small accent" x="20" y="524">特征：崩盘前全员满编（无裁员征兆）</text>
  <text class="small accent" x="20" y="544">跨过成本阈值瞬间全行业清零</text>
</svg>
```

更有意思的是，论文图 14 展示了一个动态演变：**随着 AI 协同能力 $y_*^M$ 的提升，包络线 $\bar a(\lambda)$ 本身会从“凹函数”变形为“凸函数”！** 也就是说，一个行业完全可能**前半程是温和的混编渐进减员，走到半路突然发生组织隔离，最后以断崖式崩盘收场**。

---

## 第四幕（2028 冬）：ASI 终局与比较优势的最后避难所

### 2028 年 11 月：大市场归零，小池塘苟活

到 2028 年底，模型同时跨过了两条红线：单兵胜任力 $\theta = 12 > 9$（超越所有人类专家），协同指数 $y_*^M = 1.05 > 1$（具备规模报酬递增的蜂群协同能力）。这就是论文定义的**人工超智能（ASI）**。

在主流的深度大市场（标准化软件、大规模金融交易、通用工业设计、基础科学研究）里，巨型纯 AI 企业已经垄断了 100% 的产出，商品的边际生产成本趋近于 0，物质财富以前所未有的速度涌流。人类协调者（Coordinators）的就业率彻底归零。

然而，在论文算例的最后一张快照（表 2 第四列）里，却留下了一个反直觉的尾巴：**那 12 个已经被 ASI 在所有技能维度上全方位碾压的人类程序员和文案作家，居然还没有全部失业！** 他们全部挤在那个容量极其有限的**利基小众市场（Niche Market，$N = 1$，总需求上限只有 $Q = 200$）**里，组了 2 家 6 人纯人类小公司，拿着仅比躺平底线（$0.25$）高出一丁点的微薄薪水（$0.269$），包揽了这片小池塘里 88% 的产量（$165.3$ 单位），而强大的 ASI 只在里面分走了剩下的 $22.1$ 单位。

### 理论拆解：既然 ASI 全方位碾压人类，为什么小池塘里还有人类公司？

很多读者看到这里会以为是算错了：ASI 写代码是 12 分（人类 9 分），协同是 1.05（人类 0.75），为什么在利基市场里，ASI 没有把人类全部赶尽杀绝？

答案藏在李嘉图（David Ricardo）两百年前提出的**比较优势（Comparative Advantage）**，以及**市场容量对规模效应的物理封顶**里：

1. **小池塘装不下真龙**：ASI 最恐怖的杀手锏是 $y_*^M = 1.05 > 1$ 带来的规模报酬递增——规模越大，人均产出越高、单位成本越低。但在容量只有 $Q < 200$ 的利基小众市场里，需求天花板死死卡住了企业的大小（论文的 Feasibility 约束要求单个完整企业的产出不能超过整个市场的总需求 $q_f \le Q$）。在这么浅的池塘里，ASI 根本无法展开成千上万个实例的巨型蜂群，只能以 $m \approx 3.66$ 的微型规模运转，其超协同的规模优势被废掉了一大半。
2. **算力有硬成本，而人类工资可以跌**：运行一个 ASI 实例需要消耗实打实的物理电力和芯片租金 $r = 1$（或者把算力拿去主流大市场赚取更高价值的机会成本）；而人类的躺平底线（保留工资）只有 $\underline w = 0.25$。只要人类专家接受把工资降到 $0.269$（约为 ASI 算力成本的四分之一），在小规模利基市场里，“便宜的人类拼图团队”在单位产出成本上依然能和“昂贵但规模受限的 ASI”打个平手[@restrepo2025]！

当然，作者在正文里也极其冷静地补了一刀：这只是 ASI 刚刚跨过门槛、且算力成本 $r = 1$ 远高于人类生存底线 $\underline w = 0.25$ 时的临界切片。如果 ASI 的单兵能力继续从 12 涨到 50，或者算力成本 $r$ 降到 $\underline w$ 以下，根据**命题 4(i)（Machine-only Production）**，人类的最后一块比较优势避难所也将彻底消失。

```data title="四幕剧本的均衡全貌（论文算例精确值）" bars="专家工资,协调者工资" mark="第三幕：Supercooperative" note="数据完全取自 Imas, Koh & Legg (2026) 表 2 与第 2.2 节（算力租金 r = 1，人类保留工资 w₀ = 0.25，共 12 名专家、2 名协调者）。"
阶段 | AI 单兵 θ | AI 协同 y* | 深度市场结构 | 专家工资 | 协调者工资 | 协调者就业
无 AI 基准 | 0 | 0 | 2 家 7 人混编公司 | 4.15 | 2.41 | 2.00 / 2
第一幕：Minimal AGI | 1.69 | 0.78 | 人类混编 + 大量 7-AI 小厂 | 2.90 | 1.30 | 2.00 / 2
第二幕：Supercompetent | 12.00 | 0.78 | 人类协调者领衔的 7-AI 小厂 | 0.39 | 0.48 | 2.00 / 2
第三幕：Supercooperative | 1.69 | 1.60 | 单一巨型纯 AI 企业垄断 | 0.41 | 0.25 | 0.97 / 2
第四幕：ASI | 12.00 | 1.05 | 单一巨型纯 AI 企业垄断 | 0.27 | 0.25 | 0.00 / 2
```

---

## 站在模型之外：这篇论文忽略了哪六道现实摩擦？

把科斯的企业边界理论[@coase1937][@williamson1967]装进 AGI 的宏观一般均衡，让《Organizing Intelligence》拥有了远超传统任务自动化模型[@acemogluRestrepo2018][@aghionJonesJones2019]的解释力（实际上，论文第 7.1 节的**定理 3** 严格证明了：当强行令规模报酬不变 $\gamma \equiv 1$ 时，他们的模型会精确退化为 Acemoglu-Restrepo 的经典任务模型，此时企业大小和组织边界变得毫无意义）。

但如果我们要拿这篇论文当作观测真实世界的罗盘，就必须看清它的数学假设在哪里为了优雅而切掉了现实的骨肉。具体而言，模型有六个关键的盲区：

```sketch title="理论模型 vs 现实世界：被简化的六道制度与物理摩擦" note="“论文的公理化假设”为保证均衡存在性与解析可解而采用；“现实世界的反作用力”则会扭曲、延缓或改写上述四幕剧本。"
<svg viewBox="0 0 704 316">
  <rect class="panel" x="0" y="0" width="344" height="316" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="316" rx="12"/>

  <text class="caps" x="24" y="28">论文的公理化假设 (MODEL ASSUMPTIONS)</text>
  <g class="node plain"><rect x="24" y="48" width="296" height="36" rx="4"/><text class="mid" x="172" y="66">1. 协同力取全员算术平均 (一阶矩假设)</text></g>
  <g class="node plain"><rect x="24" y="92" width="296" height="36" rx="4"/><text class="mid" x="172" y="110">2. 全经济体只有单一同质 AI 模型</text></g>
  <g class="node plain"><rect x="24" y="136" width="296" height="36" rx="4"/><text class="mid" x="172" y="154">3. 算力按固定价格 r 无限弹性供给</text></g>
  <g class="node plain"><rect x="24" y="180" width="296" height="36" rx="4"/><text class="mid" x="172" y="198">4. 替代博弈均衡：巨型垄断企业零利润</text></g>
  <g class="node plain"><rect x="24" y="224" width="296" height="36" rx="4"/><text class="mid" x="172" y="242">5. 产出只取决于技能与协同，无法律摩擦</text></g>
  <g class="node plain"><rect x="24" y="268" width="296" height="36" rx="4"/><text class="mid" x="172" y="286">6. 需求曲线 P(Q) 外生固定，与工资脱钩</text></g>

  <text class="caps" x="384" y="28">现实世界的反作用力 (REAL-WORLD FRICTIONS)</text>
  <g class="node blue"><rect x="384" y="48" width="296" height="36" rx="4"/><text class="mid" x="532" y="66">1. 金字塔层级：1 个顶尖架构师可撬动全局</text></g>
  <g class="node teal"><rect x="384" y="92" width="296" height="36" rx="4"/><text class="mid" x="532" y="110">2. 异质专用模型混编：AI 自己也能拼图智能</text></g>
  <g class="node orange"><rect x="384" y="136" width="296" height="36" rx="4"/><text class="mid" x="532" y="154">3. 芯片与电力硬瓶颈：算力租金 r 陡峭递增</text></g>
  <g class="node clay"><rect x="384" y="180" width="296" height="36" rx="4"/><text class="mid" x="532" y="198">4. 垄断定价与寻租：巨头攫取超额垄断暴利</text></g>
  <g class="node violet"><rect x="384" y="224" width="296" height="36" rx="4"/><text class="mid" x="532" y="242">5. 法律背锅与真人偏好：AI 不能坐牢签字</text></g>
  <g class="node clay"><rect x="384" y="268" width="296" height="36" rx="4"/><text class="mid" x="532" y="286">6. 宏观总需求坍缩：全员失业后谁来买单？</text></g>
</svg>
<svg viewBox="0 0 340 645">
  <rect class="panel" x="0" y="0" width="340" height="315" rx="12"/>
  <rect class="panel" x="0" y="330" width="340" height="315" rx="12"/>

  <text class="caps" x="20" y="28">论文的公理化假设 (MODEL)</text>
  <g class="node plain"><rect x="20" y="48" width="300" height="36" rx="4"/><text class="mid" x="170" y="66">1. 协同力取全员算术平均 (一阶矩)</text></g>
  <g class="node plain"><rect x="20" y="92" width="300" height="36" rx="4"/><text class="mid" x="170" y="110">2. 全经济体只有单一同质 AI 模型</text></g>
  <g class="node plain"><rect x="20" y="136" width="300" height="36" rx="4"/><text class="mid" x="170" y="154">3. 算力按固定价格 r 无限弹性供给</text></g>
  <g class="node plain"><rect x="20" y="180" width="300" height="36" rx="4"/><text class="mid" x="170" y="198">4. 可竞争市场：巨型垄断企业零利润</text></g>
  <g class="node plain"><rect x="20" y="224" width="300" height="36" rx="4"/><text class="mid" x="170" y="242">5. 产出只看技能与协同，无制度摩擦</text></g>
  <g class="node plain"><rect x="20" y="268" width="300" height="36" rx="4"/><text class="mid" x="170" y="286">6. 需求曲线外生固定，与工资脱钩</text></g>

  <text class="caps" x="20" y="358">现实世界的反作用力 (REALITY)</text>
  <g class="node blue"><rect x="20" y="378" width="300" height="36" rx="4"/><text class="mid" x="170" y="396">1. 金字塔层级：1 个架构师可撬动全局</text></g>
  <g class="node teal"><rect x="20" y="422" width="300" height="36" rx="4"/><text class="mid" x="170" y="440">2. 异质模型混编：AI 也能拼图智能</text></g>
  <g class="node orange"><rect x="20" y="466" width="300" height="36" rx="4"/><text class="mid" x="170" y="484">3. 芯片与电力硬瓶颈：算力租金递增</text></g>
  <g class="node clay"><rect x="20" y="510" width="300" height="36" rx="4"/><text class="mid" x="170" y="528">4. 垄断定价：巨头攫取超额垄断暴利</text></g>
  <g class="node violet"><rect x="20" y="554" width="300" height="36" rx="4"/><text class="mid" x="170" y="572">5. 法律背锅：AI 不能坐牢签字担责</text></g>
  <g class="node clay"><rect x="20" y="598" width="300" height="36" rx="4"/><text class="mid" x="170" y="616">6. 总需求坍缩：全员失业后谁来买单？</text></g>
</svg>
```

### 1. 把金字塔层级压扁成了“算术平均数”

论文的**假设 2（First-moment Representation）**规定，一家企业的规模扩展能力只取决于所有成员协同能力的**算术平均值** $\bar y_* = m^{-1} \int y_* \,\mathrm{d}\nu$。

在数学上这无比清爽，但在组织学上却过于天真。真实的企业不是所有人围成一圈求平均的扁平大锅饭，而是**知识与决策的金字塔层级（Knowledge Hierarchy）**[@garicano2000][@garicanoRossiHansberg2006]。如果按算术平均算，往 10,000 个 AI 里放 1 个顶尖人类 CEO，这个人类的协同权重只有万分之一，会被彻底稀释；但在现实的树状架构里，顶层设计者定义接口、划分模块边界和奖惩函数，1 个顶层人类的协同能力具有 $O(1)$ 级别的全局杠杆。忽略内部层级结构，使模型在第三幕中过早宣告了“人类顶层架构师”的出局。

### 2. “单一 AI 模型”假设高估了人类拼图智能的保质期

在第一幕中，人类团队之所以能靠“拼图智能”打赢 Minimal AGI，核心前提是模型假设**全世界只有一种同质化的 AI 模型 $\mathbf{y}^M$**（第 3.1 节），所以一万个 AI 拼在一起长短板依然完全重合。

可现实中，没有任何规定要求一家公司只能调用同一个模型。企业完全可以把擅长写代码的 `Coding-Agent`、擅长审安全的 `Security-Agent` 和擅长写文档的 `Doc-Agent` 混编在同一个工作流里。一旦允许**异质性 AI 模型（Heterogeneous AI Models）**构建凸包，AI 自己就能拼出“机器拼图智能”，第一幕里人类专家依靠偏科互补建立的护城河，瓦解的速度会比论文预测的快得多。

### 3. 无限廉价算力 vs. 物理世界的芯片与电力墙

模型假设机器可以按恒定的租金 $r > 0$ **无限弹性供给**。这意味着当第三幕 $\gamma^M > 1$ 发生时，巨型 AI 企业可以在一夜之间拉起数千万个并发实例吞噬全行业。

但在物理世界里，台积电的 CoWoS 封装产能、HBM 显存和核电站的供电审批周期不是无限弹性的。当全经济体试图同时实例化超大规模 AI 蜂群时，算力租金 $r(Q^M)$ 会沿着一条极其陡峭的边际成本曲线飙升。**算力供给的非线性瓶颈，会把原本属于人类的“能力稀缺租金”转化为算力基建拥有者的“物理稀缺租金”**，同时也迫使巨型 AI 企业的扩张速度受制于物理基建的摩尔定律。

### 4. “零利润巨无霸”的乌托邦：可竞争市场假设

为了解决“既有原子化小微企业、又有垄断全行业的巨无霸企业”时的均衡存在性难题，论文引入了一个基于**替代博弈（Replacement Game）**与可竞争市场理论[@demsetz1968][@baumolPanzarWillig1982]的均衡概念（第 4.1 节与附录 B）：哪怕全行业只剩下一家巨型纯 AI 企业，由于潜在进入者的威胁，这家垄断巨头也**只能赚取零超额利润（Zero Profit）**，把技术进步带来的全部红利以接近于零的商品价格让渡给消费者（定理 1：均衡恒等于社会总剩余最大化）。

作者在正文中也坦承（第 5.2 节），这只是一个理论基准。在现实中，一旦一家拥有超协同 AI 集群的科技巨头吃下了 100% 的市场份额，算力壁垒、数据飞轮与迁移成本会立刻锁死“可竞争性”，零利润假设瞬间失效——迎接人类的不会是免费的商品乌托邦，而是史无前例的垄断定价与政治经济寻租。

### 5. AI 不能去坐牢：法律责任（Liability）的制度护城河

在模型的生产泛函 $F(\nu)$ 里，只要机器组合能算出更高的代码和文档产出，企业就会用机器替换人。

但现实商业社会中，大量的职位（注册会计师、主治医师、律所合伙人、总工程师、政府审批官员）存在的根本原因，不仅是提供智力产出，更是**作为法律责任的终极承担者（Liability Sink）**。AI 没有自由身，不能进监狱，也没有可以被追偿的个人无限连带责任。只要现代法律体系依然要求“每一份关键签字背后必须站着一个能为事故坐牢或破产的自然人”，哪怕 AI 在 $\theta$ 和 $y_*$ 上双双封神，人类依然会以“合规签字人与风险担保人”的身份留在生产回路中，收取制度性租金。

### 6. 被切断的宏观闭环：当所有人都拿保留工资时，谁在消费？

最后，作为一篇局部均衡（Partial Equilibrium）色彩浓厚的产业组织论文，模型中的需求曲线 $P_N(Q)$ 是外生给定的。

这在第一幕和第二幕没有问题；但在第三幕和第四幕中，人类协调者的工资跌停在保留底线 $\underline w$，技术专家的工资也跌到了贴近 $\underline w$ 的微薄水平，而企业又是零利润的。如果不额外引入“全民基本收入（UBI）”或“全体公民平均持有 AI 算力资本股权”的宏观分配闭环，那条外生给定的高昂需求曲线 $P_N(Q)$ 在现实中根本不可能维持——**如果所有人类工人都失去了工资溢价，是谁在市场上掏钱买下巨型 AI 蜂群生产出来的海量商品？**

---

## 结语：换一把尺子看未来

尽管有上述六道现实摩擦的缓冲，Imas、Koh 和 Legg 的这篇论文依然为我们提供了一把极其锋利的解剖刀。

过去三年，每当新模型发布，整个科技圈都在盯着 MMLU、GPQA、SWE-bench 上的单兵分数涨了几个百分点。但这篇论文告诉我们：**单兵胜任力（Competence）的提升，只会让现有的公司变得更精简、让商品变得更便宜、让懂得协调和定义问题的“人类包工头”变得更值钱；它不会在一夜之间颠覆社会的组织形态。**

真正决定经济结构是否会发生“断崖式相变”的那根指针，是**多智能体协同指数 $\gamma^M$**。

在此之前（$\gamma^M < 1$），哪怕 AI 单兵再强，偏科的人类依然能靠异质互补的“拼图智能”和组织协调能力，在无数中小型混编团队里找到自己的生态位；而一旦有一天，我们看到成百上千个 AI Agent 能够在长达数周、跨度百万行代码的复杂工程中，做到**团队规模越大、单个 Agent 的人均有效产出反而越高（$\gamma^M > 1$）**——那才是科斯天花板真正碎裂、旧世界秩序开始坍缩的时刻。

在那一天到来之前，与其在单兵做题的赛道上和算力死磕，不如去修习那些能让异质智能拼合在一起的协同力。毕竟，在算力可以无限复制的时代，**唯一的稀缺，是如何把智能组织起来。**

## 参考资料

- [@kokotajlo2025ai2027] Kokotajlo, D., Alexander, S., Larsen, T., Lifland, E., & Dean, R. (2025). [AI 2027](https://ai-2027.com/). _AI Futures Project_.
- [@patwardhan2025gdpval] Patwardhan, T., et al. (2025). [GDPval: Evaluating AI Model Performance on Real-World Economically Valuable Tasks](https://openai.com/). _OpenAI Technical Report_.
- [@wijk2024rebench] Wijk, H., et al. (2024). [RE-Bench: Evaluating Frontier AI R&D Capabilities of Language Model Agents Against Human Experts](https://arxiv.org/abs/2411.15114). _arXiv:2411.15114_.
- [@yotzov2026firmdata] Yotzov, I., et al. (2026). Firm-Level Adoption and Economic Impacts of Generative AI. _Working Paper_.
- [@humlum2025llm] Humlum, A., & Vestergaard, E. (2025). The Labor Market Effects of Generative AI: Evidence from Administrative and Survey Data. _Working Paper_.
- [@imas2026organizing] Imas, A., Koh, A., & Legg, S. (2026). [Organizing Intelligence](https://arxiv.org/abs/2611.05417). _arXiv:2611.05417_.
- [@samuelson1948] Samuelson, P. A. (1948). _Economics: An Introductory Analysis_. McGraw-Hill.
- [@leggHutter2007] Legg, S., & Hutter, M. (2007). [Universal Intelligence: A Definition of Machine Intelligence](https://doi.org/10.1007/s11023-007-9079-x). _Minds and Machines, 17_(4), 391–444.
- [@hui2024shortterm] Hui, X., Reshef, O., & Zhou, L. (2024). [The Short-Term Effects of Generative Artificial Intelligence on Employment: Evidence from an Online Labor Market](https://doi.org/10.1287/orsc.2023.18441). _Organization Science, 35_(6), 1977–1989.
- [@demirci2025replacing] Demirci, O., Hannane, J., & Zhu, X. (2025). Who Is AI Replacing? The Impact of Generative AI on Online Freelancing Platforms. _Management Science_.
- [@kremer1993] Kremer, M. (1993). [The O-Ring Theory of Economic Development](https://doi.org/10.2307/2118400). _Quarterly Journal of Economics, 108_(3), 551–575.
- [@jones2011] Jones, C. I. (2011). [Intermediate Goods and Weak Links in the Theory of Economic Development](https://doi.org/10.1257/mac.3.2.1). _American Economic Journal: Macroeconomics, 3_(2), 1–28.
- [@hongPage2004] Hong, L., & Page, S. E. (2004). [Groups of Diverse Problem Solvers Can Outperform Groups of High-Ability Problem Solvers](https://doi.org/10.1073/pnas.0406726101). _Proceedings of the National Academy of Sciences, 101_(46), 16385–16389.
- [@page2007difference] Page, S. E. (2007). _The Difference: How the Power of Diversity Creates Better Groups, Firms, Schools, and Societies_. Princeton University Press.
- [@restrepo2025] Restrepo, P. (2025). Automation, Reproducible Intelligence, and Comparative Advantage. _Working Paper_.
- [@kim2025scalingagents] Kim, J., et al. (2025). Scaling Laws and Error Amplification in Multi-Agent LLM Systems. _arXiv preprint_.
- [@cemri2025mast] Cemri, M., et al. (2025). [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657). _arXiv:2503.13657_.
- [@kimKoning2026] Kim, S., & Koning, R. (2026). AI-Native Startups: Organizational Scaling and Hierarchy Flattening. _Working Paper_.
- [@ewensGiroud2025hierarchy] Ewens, M., & Giroud, X. (2025). Firm Hierarchy in the Age of Artificial Intelligence. _Working Paper_.
- [@coase1937] Coase, R. H. (1937). [The Nature of the Firm](https://doi.org/10.1111/j.1468-0335.1937.tb00002.x). _Economica, 4_(16), 386–405.
- [@simon1947] Simon, H. A. (1947). _Administrative Behavior: A Study of Decision-Making Processes in Administrative Organization_. Macmillan.
- [@williamson1967] Williamson, O. E. (1967). [Hierarchical Control and Optimum Firm Size](https://doi.org/10.1086/259258). _Journal of Political Economy, 75_(2), 123–138.
- [@holmstrom1982] Holmström, B. (1982). [Moral Hazard in Teams](https://doi.org/10.2307/3003457). _Bell Journal of Economics, 13_(2), 324–340.
- [@brynjolfsson2026canaries] Brynjolfsson, E., Chandar, B., & Chen, R. (2026). Canaries in the Coal Mine: Six Facts about the Recent Employment Effects of Artificial Intelligence. _Working Paper_.
- [@hosseini2025seniority] Hosseini, M., et al. (2025). Generative AI and the Seniority Bias in Knowledge Work. _Working Paper_.
- [@azar2026wage] Azar, J., et al. (2026). AI Exposure and Wage Compression Across the Career Lifecycle. _Working Paper_.
- [@simon1971] Simon, H. A. (1971). Designing Organizations for an Information-Rich World. In M. Greenberger (Ed.), _Computers, Communications, and the Public Interest_ (pp. 37–72). Johns Hopkins Press.
- [@polanyi1966] Polanyi, M. (1966). _The Tacit Dimension_. Doubleday.
- [@graeberNoyRoth2026] Graeber, T., Noy, S., & Roth, C. (2026). Lossy Communication and Tacit Knowledge in Organizations. _Working Paper_.
- [@acemogluRestrepo2018] Acemoglu, D., & Restrepo, P. (2018). [The Race between Man and Machine: Implications of Technology for Growth, Factor Shares, and Employment](https://doi.org/10.1257/aer.20160696). _American Economic Review, 108_(6), 1488–1542.
- [@aghionJonesJones2019] Aghion, P., Jones, B. F., & Jones, C. I. (2019). [Artificial Intelligence and Economic Growth](https://doi.org/10.7208/chicago/9780226613475.003.0008). In _The Economics of Artificial Intelligence: An Agenda_ (pp. 237–282). University of Chicago Press.
- [@garicano2000] Garicano, L. (2000). [Hierarchies and the Organization of Knowledge in Production](https://doi.org/10.1086/262139). _Journal of Political Economy, 108_(5), 874–904.
- [@garicanoRossiHansberg2006] Garicano, L., & Rossi-Hansberg, E. (2006). [Organization and Inequality in a Knowledge Economy](https://doi.org/10.1162/qjec.2006.121.4.1383). _Quarterly Journal of Economics, 121_(4), 1383–1435.
- [@demsetz1968] Demsetz, H. (1968). [Why Regulate Utilities?](https://doi.org/10.1086/466643). _Journal of Law and Economics, 11_(1), 55–65.
- [@baumolPanzarWillig1982] Baumol, W. J., Panzar, J. C., & Willig, R. D. (1982). _Contestable Markets and the Theory of Industry Structure_. Harcourt Brace Jovanovich.
