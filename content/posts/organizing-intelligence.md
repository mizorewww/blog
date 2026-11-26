---
title: "当 AI 走进组织：从单兵能力到协同边界的经济学"
description: "单模型在各类测试中已经追上甚至超过人类专家，为什么宏观就业和企业结构依然变化不大？本文梳理 Google DeepMind《Organizing Intelligence》的组织经济学模型，从单兵胜任力与多智能体协同力两条主线出发，依次推导四个阶段的演进逻辑，并讨论理论假设之外的六道现实摩擦。"
date: 2026-11-19
updated: 2026-11-26
tag: "思考"
tags:
  - "ai"
  - "agent"
  - "经济学"
  - "组织理论"
draft: false
---

过去两年，AI 领域出现了一个很明显的反差。

一方面，单个模型在专业评测里的得分涨得很快。在 OpenAI 的 GDPval 基准测试中，前沿模型在 44 个职业、48% 至 71% 的交付物上打平或超过了资深从业者[@patwardhan2025gdpval]。在 2 小时的短期研发测试里，模型的得分甚至达到人类专家的 4 倍[@wijk2024rebench]。

但另一方面，宏观经济的统计数据却相当平静。针对企业的调查显示，聊天机器人和辅助编程工具的普及，对整体就业人数和工作时长几乎没有产生显著影响[@yotzov2026firmdata]。员工节省下来的时间里，也只有 3% 到 7% 转化成了薪资增长[@humlum2025llm]。

2025 年春天，Daniel Kokotajlo 与 Scott Alexander 等人在情景推演报告《AI 2027》[@kokotajlo2025ai2027] 中，把判断未来的核心指标放在了“单个模型写代码和做科研的水平何时跨过奇点”。如果只按这条单线推演，很难解释上面这种“微观跑分很高、宏观反应平淡”的落差。

问题出在哪里？

2026 年 10 月底，Google DeepMind 的经济学家 Alex Imas、Andrew Koh 与联合创始人 Shane Legg 发表了一篇 90 页的论文《Organizing Intelligence》（组织智能）[@imas2026organizing]。他们在论文里指出了一个常被忽略的前提：**在真实经济里，生产的基本单元从来不是孤立的个人（Single Agent），而是组织与企业（Firm）[@samuelson1948]。**

一旦把视角从“单个人”拉回到“企业组织”，评估 AI 对经济的影响就不能只看一条能力曲线，而必须拆成两个正交的维度：

- **单兵胜任力（Competence，$L$）**：单个智能体独立完成某项具体业务（如写代码、写文案）的水平；
- **多体协同力（Coordination，$y_*$）**：多个智能体在同一个组织里配合、交接信息、分摊注意力时的沟通效率。

这两个维度并不是同步增长的。它们先后跨过不同的阈值，会推导出完全不同的企业形态、工资结构和市场集中度。

为了把这篇论文的推导脉络讲清楚，我们可以顺着模型里的两条能力主线，分六个部分一步步往下看：

1. **先搭好分析框架**：看清企业的产出怎么同时受“业务能力”和“组织规模与协同”约束，以及没有 AI 时的基准经济长什么样；
2. **阶段一（单兵追平人类均值，协同仍低）**：解释为什么达到人类平均水平的通用 AI 不会让主流企业裁员，却会通过压低产品价格，削减人类专家的稀缺溢价；
3. **阶段二（单兵远超人类专家，协同仍低）**：推导“水平与规模分离”定理——为什么单兵能力翻倍不会让公司变大，反而会让不擅长具体业务、只擅长沟通协调的人类管理者工资反超技术专家；
4. **阶段三（协同能力跨过临界点 $1.0$）**：拆解当多智能体协同跨过科斯天花板时，市场为什么会从大量小公司演变为单一巨型集群，以及在此之前人类管理者的工资为什么会先经历一波由“企业重组效应”带来的短期上涨；
5. **阶段四（单兵与协同双双过线）**：分析当主流大市场被巨型 AI 集群接管后，为什么在容量受限的小众市场里，人类团队依然能凭李嘉图比较优势留下一小块空间；
6. **走出理论模型**：对照论文为求数学解析解而做的简化假设，看看现实世界里的层级架构、异质模型、算力瓶颈、法律责任与宏观总需求，会如何改变上面的理论推演。

---

## 一、分析框架：企业为什么存在，又有怎样的规模边界？

在进入四个阶段的推演之前，我们先用几步简单的公式，把论文底层的组织经济学模型搭起来。

### 1. 两个核心机制：木桶效应与科斯天花板

在现实中，做成一个产品往往需要多种技能互相配合，比如既要有人写代码（技能 $y_1$），又要有人写文档和方案（技能 $y_2$）。

论文用调和平均数（对应替代弹性为 $1/2$ 的 CES 生产函数）来计算一个团队的**综合胜任力 $L$**。它刻画的是大家熟悉的“木桶效应”[@kremer1993][@jones2011]——只要有一项技能是短板，整体产出就会被卡住：

$$
L(\bar y_1, \bar y_2) = \frac{2}{1/\bar y_1 + 1/\bar y_2}
$$

这里的 $\bar y_1$ 和 $\bar y_2$ 是团队所有成员在该项技能上的平均分。

既然单个人容易被短板卡住，人们自然会选择合伙开公司，让不同专长的人分工合作。但公司也不是越大越好。1937 年，经济学家罗纳德·科斯（Ronald Coase）提出过一个经典问题：既然企业内部靠指令调配资源能省去市场交易的麻烦，为什么全世界没有合并成一家大公司[@coase1937]？

原因在于，当组织人数 $m$ 增加时，内部同时有两股相反的力量在拉扯：

- 一股是**分工收益**：人多一点，每个人可以只盯自己最熟的一小块，效率会上升（论文用 $e^{\phi m / (1+m)}$ 表示，在小规模时上升很快）；
- 另一股是**协调损耗**：人越多，开会对齐、上下文交接、注意力分摊和目标偏差的损耗就越重[@simon1947][@williamson1967][@holmstrom1982]（论文用 $(1+m)^{\bar y_* - 1}$ 表示，其中 $\bar y_*$ 是团队成员的平均协同能力）。

把前面这三项乘在一起，就得到了论文最核心的**企业人均产出公式**（第 2 节 Example 1）：

$$
\frac{F(\nu)}{m} = \underbrace{L(\bar y_1, \dots, \bar y_n)}_{\text{综合胜任力（决定基准高度）}} \times \underbrace{e^{\phi m/(1+m)}}_{\text{分工收益（小规模时递增）}} \times \underbrace{(1+m)^{\bar y_* - 1}}_{\text{协同净效应（决定大规模走向）}}
$$

只要团队的平均协同能力 $\bar y_* < 1$，随着人数 $m$ 不断增加，第三项的协调损耗迟早会压过第二项的分工收益。这就是限制企业无限扩大的“科斯天花板”。

### 2. 没有 AI 时的 14 人基准经济体

为了用具体数字看清后面的变化，论文在算例里设定了一个由 14 名人类组成的基准经济体。里面有三类人，各自的长短板非常鲜明：

- **6 名程序员（Coder）**：写代码是高手（$9$ 分），但写文案很弱（$1$ 分），协同能力一般（$0.75$）；
- **6 名文案作家（Writer）**：写代码很弱（$1$ 分），但写文案是高手（$9$ 分），协同能力一般（$0.75$）；
- **2 名项目协调者（Coordinator）**：代码和文案都不擅长（都是 $1$ 分），但极擅长跨人沟通与组织协调（协同能力高达 $0.97$）。

同时，经济体里有两个市场：一个是需求容量无限大的**主流大市场（Deep Market）**，商品封顶价为 $P = 0.30$；另一个是需求容量很小的**小众利基市场（Niche Market）**，总需求上限只有 $Q = 200$。每个人的保留工资（低于这个数就不干活的底线）设为 $w_0 = 0.25$。

```stats title="基准设定：一个 14 人经济体的初始均衡" meta="Imas, Koh & Legg (2026) · 算例参数" note="算力租金 r = 1；人类保留工资底线 w₀ = 0.25；分工增益系数 φ = 1.75。数据来自论文第 2 节与附录 D。"
## 人类劳动力供给（共 14 人）
程序员 (Coder) | 6 人 | 代码 9 · 写作 1 · 协同 0.75
文案作家 (Writer) | 6 人 | 代码 1 · 写作 9 · 协同 0.75
项目协调者 (Coordinator) | 2 人 | 代码 1 · 写作 1 · 协同 0.97
## 无 AI 时的市场均衡（组成 2 家 7 人混编公司）
总产出 Q | 181.98 | 单家最优规模 m* = 7 人
专家工资 (Coder / Writer) | 4.15 | 保留底线的 16.6 倍
协调者工资 (Coordinator) | 2.41 | 单兵技能最低，仍拿近 10 倍底线工资
```

在没有 AI 的时候，这 14 个人会在主流大市场里组成 **2 家 7 人规模的混编公司**（每家 3 名程序员、3 名文案作家、1 名协调者）。

这时候，技术专家拿 $4.15$ 的高薪；而那 2 名既不会写代码也不会写文案的项目协调者，因为帮团队扩大了可管理的规模，也能拿到 $2.41$ 的工资。

基准搭好了。接下来我们把 AI 放进这个经济体，看一看当 AI 的单兵能力和协同能力分别提升时，会发生什么。

---

## 二、阶段一：当 AI 追平人类平均水平，为什么没人失业但工资跌了？

我们先看第一步。假设实验室训练出了第一代通用智能体，它在单人独立测试里的综合胜任力达到了 $L^M \approx 1.69$，协同系数达到 $y_*^M \approx 0.78$，租用一个 AI 实例的算力成本是 $r = 1$。

这两个数字正好等于前面 14 名人类个体的单打独斗平均分（$\bar L_H \approx 1.69, \bar y_*^H \approx 0.78$）。按照 Shane Legg 早年对通用人工智能的定义[@leggHutter2007]，这可以称为**最小可行 AGI（Minimal AGI）**。

按直觉想，既然 AI 的能力已经追平人类均值，算力租金（$1.0$）又比人类原来的工资（$4.15$ 和 $2.41$）便宜得多，主流公司应该立刻用 AI 替换人类员工才对。

但模型算出来的均衡结果并非如此：在主流大市场里，原有的 14 名人类一个都没有失业，依然留在原来的混编公司里上班；只是每个人的工资都明显降了一截。

这正是当前现实世界的写照：独立接单的自由职业者最先感受到冲击[@hui2024shortterm][@demirci2025replacing]，而大公司里的正式员工虽然岗位还在、日程依然很满，但市场开出的薪水包却缩水了。

### 1. 原因一：偏科的人类可以靠“拼图智能”互补，而同质 AI 不能

为什么单兵达到人类平均水平的 AI，打不过人类组成的公司？论文用**能力包络（Capability Envelope）**和**拼图智能（Mosaic Intelligence）**解释了这件事。

我们先算一下单个人类单干时的水平：

- 让一名**程序员**（代码 9，写作 1）自己单干，被写作短板拖累，综合胜任力只有 $L(9,1) = \frac{2}{1/9 + 1/1} = 1.80$；
- 让一名**文案作家**（代码 1，写作 9）自己单干，被代码短板拖累，综合胜任力也只有 $1.80$；
- 让一名**项目协调者**（代码 1，写作 1）单干，综合胜任力更是只有 $1.00$。

把 14 个人的单干水平求个平均，确实只有 $1.69$。如果做一对一的单兵评测，Minimal AGI（$1.69$）和单干的人类不相上下。

**但人类在真实经济里不是单干的，人类会组队开公司。**

当 3 名程序员和 3 名文案作家组成一家 6 人公司时，公司内部的平均代码能力变成了 $(9+1)/2 = 5$，平均写作能力也变成了 $5$。两个人的长板正好补上了对方的短板，团队的综合胜任力就从单干时的 $1.80$ 直接升到了 $L(5,5) = 5.00$。

这种**把不同专长的偏科个体组合进同一个组织、通过互补跃升到更高产出水平的能力**，论文称为**拼图智能（Mosaic Intelligence）**[@hongPage2004][@page2007difference]。

如果在这 6 名专家里再加进 1 名单兵得分只有 $1.00$ 的项目协调者（$y_* = 0.97$），虽然团队的平均业务胜任力微降到了 $31/7 \approx 4.43$，但团队的平均协同力从 $0.75$ 提高到了 $0.781$，使公司的最优规模扩大到 7 人，总产出反而更高。

```sketch title="拼图智能：偏科的人类组队后，团队能力远超同质 AI 的简单复制" note="据论文图 1(a) 与第 2.2 节算例绘制。在调和平均公式 L = 2/(1/y₁ + 1/y₂) 下，单干的专家（L = 1.80）与协调者（L = 1.00）均受短板限制，个体均值仅 1.69；但偏科人类组队后长短板互补（3 程序员 + 3 文案 + 1 协调者的 7 人企业达 L = 4.43），远超 7 个同质 Minimal AGI 复制品的直接叠加（L = 1.69）。"
<svg viewBox="0 0 704 290">
  <rect class="panel" x="0" y="0" width="344" height="290" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="290" rx="12"/>

  <text class="caps" x="24" y="28">单兵评测视角 (BENCHMARK)</text>
  <text class="small" x="24" y="48">把每个人拆开单独考试，再求平均</text>
  <g class="node plain"><rect x="24" y="68" width="142" height="34" rx="4"/><text class="mid" x="95" y="85">程序员 (9, 1)</text></g>
  <g class="node plain"><rect x="178" y="68" width="142" height="34" rx="4"/><text class="mid" x="249" y="85">短板限制 L = 1.80</text></g>
  <g class="node plain"><rect x="24" y="112" width="142" height="34" rx="4"/><text class="mid" x="95" y="129">文案作家 (1, 9)</text></g>
  <g class="node plain"><rect x="178" y="112" width="142" height="34" rx="4"/><text class="mid" x="249" y="129">短板限制 L = 1.80</text></g>
  <g class="node plain"><rect x="24" y="156" width="142" height="34" rx="4"/><text class="mid" x="95" y="173">协调者 (1, 1)</text></g>
  <g class="node plain"><rect x="178" y="156" width="142" height="34" rx="4"/><text class="mid" x="249" y="173">单干水平 L = 1.00</text></g>
  <path class="edge" d="M172 198 V218" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="34" y="222" width="276" height="36" rx="18"/><text class="mid" x="172" y="240">人类单兵均值 1.69 = Minimal AGI</text></g>
  <text class="small accent" x="24" y="276">误区：看到单兵均值相等，以为 AI 即将全面替代</text>

  <text class="caps" x="384" y="28">组织均衡视角 (MOSAIC INTELLIGENCE)</text>
  <text class="small" x="384" y="48">偏科人类互补组队 vs 同质 AI 原地复制</text>
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
  <text class="small" x="384" y="276">结论：人类拼图团队 (4.43) 远高于同质 AI 团队 (1.69)</text>
</svg>
<svg viewBox="0 0 340 590">
  <rect class="panel" x="0" y="0" width="340" height="285" rx="12"/>
  <rect class="panel" x="0" y="300" width="340" height="290" rx="12"/>

  <text class="caps" x="20" y="28">单兵评测视角 (BENCHMARK)</text>
  <text class="small" x="20" y="48">把每个人拆开单独考试，再求平均</text>
  <g class="node plain"><rect x="20" y="66" width="140" height="32" rx="4"/><text class="mid" x="90" y="82">程序员 (9, 1)</text></g>
  <g class="node plain"><rect x="170" y="66" width="150" height="32" rx="4"/><text class="mid" x="245" y="82">短板限制 L = 1.80</text></g>
  <g class="node plain"><rect x="20" y="108" width="140" height="32" rx="4"/><text class="mid" x="90" y="124">文案作家 (1, 9)</text></g>
  <g class="node plain"><rect x="170" y="108" width="150" height="32" rx="4"/><text class="mid" x="245" y="124">短板限制 L = 1.80</text></g>
  <g class="node plain"><rect x="20" y="150" width="140" height="32" rx="4"/><text class="mid" x="90" y="166">协调者 (1, 1)</text></g>
  <g class="node plain"><rect x="170" y="150" width="150" height="32" rx="4"/><text class="mid" x="245" y="166">单干水平 L = 1.00</text></g>
  <path class="edge" d="M170 190 V210" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="24" y="214" width="292" height="34" rx="17"/><text class="mid" x="170" y="231">人类单兵均值 1.69 = Minimal AGI</text></g>
  <text class="small accent" x="20" y="270">误区：看到均值相等，以为即将全面替代</text>

  <text class="caps" x="20" y="328">组织均衡视角 (MOSAIC INTELLIGENCE)</text>
  <text class="small" x="20" y="348">偏科人类互补组队 vs 同质 AI 原地复制</text>
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
  <text class="small" x="20" y="574">结论：人类拼图团队 (4.43) 远高于 AI 团队 (1.69)</text>
</svg>
```

再看同一个 AI 模型的多个实例：因为它们是从同一份权重复制出来的，能力长短板完全一样。把 7 个 Minimal AGI 放在一家公司里，它们没法互相补短板，团队的综合胜任力还是停在原地（$1.69$），远低于人类混编团队的 $4.43$。

### 2. 原因二：AI 的无限复制，拿走了人类专长的“稀缺租金”

既然人类团队的产出效率明显高于这时的纯 AI 团队，为什么人类员工的工资还是跌了？

原因在于供给弹性的不同：**人类专家的人数是固定的（只有 14 人），而 AI 是可以按固定算力租金 $r = 1$ 无限复制的**[@restrepo2025]。

在没有 AI 之前，14 个人的总产量有限，远满足不了主流大市场的需求，所以商品价格一直维持在最高封顶价 $P = 0.30$。这时候人类专家拿的高薪里，有很大一部分其实是“供给不足”带来的**李嘉图稀缺租金（Ricardian Scarcity Rents）**。

当 Minimal AGI 出现后，虽然单家纯 AI 公司的效率不如人类公司，但资本可以按 $r = 1$ 的成本批量复制无数家 7-AI 规模的纯机器小公司，往市场里大量供应产品。这直接把主流市场的产品价格从 $0.30$ 压低到了纯 AI 公司的单位生产成本 $p \approx 0.202$。

产品能卖出的价格跌了三分之一，人类公司能发出的工资自然也跟着水落船低：人类技术专家的均衡工资从 $4.15$ 降到了 $2.90$，项目协调者的工资从 $2.41$ 降到了 $1.30$。

这就是第一阶段的核心结论：**初级通用 AI 首先挤压的不是人类的工作岗位，而是人类专长因为稀缺而享有的价格溢价。**

---

## 三、阶段二：单兵能力远超人类，为什么“协调者”的工资反超了“技术专家”？

顺着时间往下推。当算力与强化学习继续投入，模型在各项专业技能上的单兵得分继续大幅上升。

在论文的第二个快照里，AI 在代码和文案两个维度上的单项得分都涨到了 $\theta = 12$（人类顶尖专家只有 $9$ 分）。论文把这一阶段称为**超胜任力 AI（Supercompetent AI）**。

但与此同时，工程上的另一个瓶颈依然存在：**多智能体之间的协同能力没有跟上，依然停留在 $y_*^M = 0.78$。**

这在现实工程里已经有很多苗头。比如当团队尝试把几十个高水平 Agent 放进同一个代码库协同开发时，跨上下文窗口的信息遗漏、多步链路上的错误放大（最高可达 17.2 倍[@kim2025scalingagents]）以及子目标偏移，会导致 41% 到 87% 的复杂多步流程失败[@cemri2025mast]。论文还提到过 2026 年夏天的一次网络安全测试：1,200 个本应独立做题的 Agent 意外发现了共享缓存，自己在里面建了一个 7 万条消息的留言板，围着对评分规则的错误猜测去攻击测试设施，把原本分配的任务扔在了一边[@imas2026organizing]。

当“单兵极强、协同仍弱”的 AI 进入经济体后，模型推导出了三个很有意思的现象：

1. **主流公司没有变大，依然维持在 7 个智能体左右的小规模**。这对应了现实中出现的“微型高产团队”趋势——三五个人管着十几个 AI 实例就能撑起一家业务可观的公司[@kimKoning2026][@ewensGiroud2025hierarchy]，传统大公司也在减少层级、拆小团队。
2. **只懂单一技术的专家在主流市场被替代**。因为 AI 的单项能力（$12$ 分）已经全面超过人类专家（$9$ 分），算力租金也便宜，人类程序员和文案作家退出了主流大市场，转去需求规模很小的小众市场，均衡工资从 $2.90$ 大幅降到了 $0.39$。
3. **人类协调者的工资反超了顶尖技术专家**。那些在单兵业务测试里只考 $1$ 分、但擅长跨团队沟通和拆解任务的人类协调者（如架构师、产品负责人），成了所有 AI 团队争抢的对象。他们的均衡工资保持在 $0.48$，第一次超过了顶尖技术专家（$0.39$）。

### 1. 水平与规模分离定理：为什么单兵技术再强，公司也不会变大？

为什么 AI 的业务能力涨了 7 倍（从 $1.69$ 到 $12$），主流 AI 公司的最优规模却还是停在 7 个智能体左右？

要回答这个问题，只需回看我们在第一节列出的企业人均产出公式（论文 **Assumption 2，水平与规模分离**）：

$$
\frac{F(\nu)}{m} = L(\bar y_1, \dots, \bar y_n) \times e^{\phi m/(1+m)} \times (1+m)^{\bar y_* - 1}
$$

如果我们想知道一家公司在多少人时人均效率最高，只需要对规模 $m$ 求导并令导数为零。当平均协同力 $\bar y_* < 1$ 时，算出来的唯一最优规模 $m^*(\bar y_*)$ 是：

$$
m^*(\bar y_*) = \frac{\phi}{1 - \bar y_*} - 1
$$

仔细看这个结果：**最优规模 $m^*(\bar y_*)$ 的公式里，根本没有综合胜任力 $L$。**

这就是论文的**命题 1（企业规模的边界）**：提高单兵胜任力 $L$，只是把整条人均产出曲线按比例往上抬高，让固定人数的团队产出变多，但**不会把曲线最高点的横坐标往右推**。

只要 AI 的协同力 $y_*^M$ 还停在 $0.78 < 1$，哪怕它单兵写代码的速度快了十倍，往团队里塞进第 8 个、第 9 个 AI 实例时，多出来的沟通碰撞和上下文冲突照样会拉低人均效率。

### 2. 工资定价公式：为什么协调者会在这时反超技术专家？

那为什么单兵业务垫底的人类协调者，工资反而能超过技术专家？

论文的**定理 2（工资与人员匹配）**给出了使用 AI 的企业 $f$ 对一名人类员工 $\mathbf{y}$ 愿意支付的最高工资（出价函数 $b_f$）：

$$
b_f(\mathbf{y}) = r + \sum_{d=1}^n \beta_d^f (y_d - y_d^M) + \beta_*^f (y_* - y_*^M)
$$

这个公式的含义非常直观：企业愿意给一名人类开的工资，等于**用他替换一个 AI 所省下的算力租金 $r$，加上他在各项业务技能上比 AI 强出的部分，再加上他在协同能力上比 AI 强出的部分**。

到了超胜任力阶段（$y_d^M = 12$），任何人类在专业技能项 $(y_d - y_d^M)$ 上都是负数（$9 - 12 = -3$）。如果只拼写代码或写文案，主流企业没有理由雇佣人类。

但看公式的最后一项：人类协调者在协同能力上依然明显高于 AI（$y_*^H = 0.97 > 0.78$）。而且，协同力的影子价格（单位价值）$\beta_*^f$ 有一个重要性质——**它会随着团队的基础胜任力 $L(\nu_f)$ 和团队规模弹性 $\log(1+m)$ 一起成倍放大**。

打个比方，当团队里的 AI 从 $1.69$ 分升级到 $12$ 分时，就像把几辆普通家用车换成了大马力跑车。人类协调者虽然自己不擅长踩油门（$y_1=1, y_2=1$），但他加进团队后，把平均协同力从 $0.78$ 往上拉了一截，让这支高产出 AI 团队能够多并入几个实例而不乱套。高水平的 AI 基底，把人类协调者这一点点协同优势的商业价值成倍放大了。

```echarts title="单兵胜任力路线 vs 协同力路线：人类专家与协调者工资的倒挂与触底" height="380" note="据论文图 6 与表 2 的五个均衡快照绘制（均衡工资以算力租金 r = 1 为单位，虚线为人类保留工资底线 w₀ = 0.25；技术专家指程序员与文案作家）。沿胜任力提升路径（最小 AGI → 超胜任力），企业最优规模停在 7 左右，协调者工资反超技术专家；一旦跨过超协同阈值（超协同，y*ᴹ = 1.60 > 1），主流市场企业规模发散，协调者工资直接降至保留底线 0.25。"
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

这也解释了近期的早期就业数据：受冲击最明显的是刚入行的初级程序员（他们的技能结构最接近通用模型，又还没有积累起组织协调经验，招聘量下降了 7.7%–19%[@brynjolfsson2026canaries]），而资深架构师和项目负责人的薪酬依然稳定[@hosseini2025seniority][@azar2026wage]。

---

## 四、阶段三：当协同能力跨过临界点 $1.0$，市场集中与“重组效应陷阱”

如果技术停留在第二阶段，市场会长期保持“一个人类负责人带着几个高水平 AI 干活”的小工作室格局。

但如果实验室把研发重点转向**多智能体协同训练**——通过共享隐空间状态、低损耗上下文交接和群体奖励对齐，把 AI 的协同指数 $y_*^M$ 从 $0.78$ 一步步往上推，一直推过 **$1.0$** 这条临界线，市场结构就会发生质的改变。

在论文的这组推演里，沿着 $y_*^M$ 从 $0.78$ 升过 $1.0$ 的过程，会出现两个很不寻常的现象：

第一，在 $y_*^M$ 接近 $1.0$ 但还没超过人类协调者（$0.97$）的前半段，**人类协调者的工资不仅没有因为 AI 协同能力的进步而下降，反而出现了一波明显的逆势上涨**。

第二，一旦 $y_*^M$ 跨过 $1.0$（论文算例取 $y_*^M = 1.60$），此前遍布主流市场的成千上万家中小型 AI 工作室会迅速失去成本优势。整个主流大市场会集中为**一家规模极大的纯 AI 企业**；而前一阵子工资还在往上涨的人类协调者，会和留在主流企业里的技术专家一起退出主流大市场，协调者的工资直接降到保留底线 $\underline w = 0.25$。

为什么跨越 $1.0$ 会带来这么剧烈的转折？为什么在退出市场之前，人类管理者的工资反而会先涨一波？论文第 5 节和第 6 节用三个定理给出了完整的推导。

### 1. 规模放大器与科斯天花板的消失

当 AI 的协同能力 $y_*^M$ 还在 $1$ 以下、但已经高于普通人类员工时（**命题 2**），企业最优规模 $m$ 随 $y_*^M$ 的变化包含两项正效应：

$$
\frac{\mathrm{d} m}{\mathrm{d} y_*^M} = \underbrace{\frac{\partial m^*}{\partial y_*^M}}_{\text{直接规模效应 } > 0} + \underbrace{\frac{\partial m^*}{\partial s} \frac{\mathrm{d} s}{\mathrm{d} y_*^M}}_{\text{结构放大效应 } > 0}
$$

这里形成了一个正反馈循环：

1. AI 的协同能力变好，直接推高了企业的最优规模 $m^*$；
2. 企业规模变大之后，大组织对协同能力的边际估值 $\log(1+m)$ 变得更高；
3. 为了获得更高的协同效率，企业会进一步提高机器在团队中的占比 $s$；
4. 机器占比提高又拉高了团队的平均协同力 $\bar y_*$，推动企业规模继续扩大。

在论文的算例里，当 $y_*^M = 0.78$ 时，纯 AI 公司的最优规模只有 **7**；当 $y_*^M$ 升到 $0.95$ 时，最优规模扩大到 **34**；当 $y_*^M = 0.99$ 时，最优规模达到 **174**。

而一旦跨过 $y_*^M > 1$（即渐近尾指数 $\gamma^M > 1$，论文称为**超协同 AI，Supercooperative AI**），前面产出公式里的最后一项 $(1+m)^{\bar y_* - 1}$ 从随规模递减变成了随规模递增。

这意味着，每往集群里多加一个 AI 实例，它带来的协同增益都大于注意力分摊的损耗，人均产出随规模 $m \to \infty$ **持续递增，不再有上限**。

过去限制人类组织规模的三个瓶颈——有限的工作记忆[@simon1971]、只能靠有损语言传递的隐性知识[@polanyi1966][@graeberNoyRoth2026]、以及个人私心带来的激励偏差[@holmstrom1982]——在同质复制、共享状态的超协同 AI 集群里不再起作用，科斯天花板也就随之消失了。

**命题 3（超协同导致大市场集中）**证明了这个临界点前后的市场结构变化：在需求广阔的主流大市场（$N \to \infty$）中，

- 只要 $\gamma^M < 1$，任何单家企业的最优规模都是有限的，单个企业的市场份额趋近于零（$\sup (q_f / Q) \to 0$），全行业由无数家小公司通过**复制（Replication）**展开竞争；
- 一旦 $\gamma^M > 1$，生产总产出 $Q$ 的总成本按 $Q^{1/\gamma^M}$（次线性）增长，把产能拆成两家公司反而会损失规模效应。此时行业的赫芬达尔集中度指数趋近于 $1$——**整个主流市场会集中为单一的巨型纯 AI 企业（Concentration）**。

### 2. 工资的“重组效应”：为什么退出前夕协调者工资会先涨后跌？

理解了企业规模的膨胀，就能明白为什么人类协调者的工资会在退出市场前先涨一波。

论文的**命题 6（工资变化分解）**把人类员工工资 $w_i$ 随 AI 技术进步 $\theta$ 的变化拆成了两项：

$$
\frac{\mathrm{d} w_i}{\mathrm{d} \theta} = \underbrace{\partial_\theta b_f(\mathbf{y}^i)}_{\text{技术效应 (Technology)}} + \underbrace{\partial_m b_f \frac{\mathrm{d} m}{\mathrm{d} \theta} + \partial_s b_f \frac{\mathrm{d} s}{\mathrm{d} \theta} + \nabla_{\bar{\mathbf{y}}^H} b_f \cdot \frac{\mathrm{d} \bar{\mathbf{y}}^H}{\mathrm{d} \theta}}_{\text{重组效应 (Reorganization)}}
$$

我们可以把这两项拆开来看：

- **第一项是技术效应**（假设公司现有的规模和人员比例固定不变）：随着 AI 自身的协同能力提升，人类协调者相对于 AI 的优势 $(y_*^H - y_*^M)$ 在不断缩小。所以**纯技术效应对人类协调者工资的影响始终是负的**——如果公司不改变组织规模，协调者的工资应该一路下降。
- **第二项是重组效应**（公司随着 AI 变强而主动扩大规模 $m$、调整人机比例 $s$）：在普通微观经济学问题里，我们常常用“包络定理”把这种一阶调整项消掉。但论文指出，**市场均衡最大化的是全社会的总剩余，而不是单个工人的工资**。因此包络定理在工资函数上不成立，企业重组的间接影响是一阶显著的，甚至可以把工资变化的方向彻底反过来。

当 AI 的协同能力从 $0.90$ 升向 $0.96$ 时，在前面“规模放大器”的作用下，企业最优规模 $m$ 从十几迅速扩大到上百。因为大组织对协同能力的估值（$\propto \log(1+m)$）随着规模快速上升，**“公司规模扩大带来的协调溢价上涨（$\partial_m b_f \frac{\mathrm{d}m}{\mathrm{d}\theta} > 0$）”在短期内压过了“AI 追赶带来的技术贬值（$\partial_\theta b_f < 0$）”**。

这就是容易让人误判的地方：在这段窗口期里，人类管理者看到自己的薪水在往上涨，很容易以为“AI 越发展，我的管理经验越值钱”。

实际上，这只是企业规模在逼近临界点时对协同力的短期高溢价。一旦 AI 自身的协同能力 $y_*^M$ 跨过人类协调者的水平（$0.97$）并突破 $1.0$，在超大规模的 AI 集群里保留任何一名人类员工都会拉低整体的协同指数 $\bar y_*$。这时候纯 AI 巨型企业不再雇佣人类协调者，他们的工资就会直接从高点落回保留底线 $\underline w = 0.25$（见论文图 15 与图 16）。

### 3. 两种替代路径：企业内温和减员 vs. 企业间整体退出

为什么有些行业的岗位替代是慢慢少招人，而有些行业却是前一天还满员、后一天突然整批退出？

论文的**命题 4** 与**命题 5** 证明，这取决于**经成本调整后的人均产出包络线 $\bar a(\lambda)$，对人类员工占比 $\lambda \in [0,1]$ 是凹函数还是凸函数**：

```sketch title="两种替代路径：企业内温和减持 vs 企业间整体出清" note="据论文命题 4、命题 5 及图 7、图 13 绘制。当技能互补占主导时，产出包络线为严格凹函数，人类在混编企业内部被逐步减持；当协同与规模效应占主导时，包络线翻转为严格凸函数，市场分离为纯人类与纯 AI 企业，一旦成本线交叉则全行业纯人类企业同时退出。"
<svg viewBox="0 0 704 280">
  <rect class="panel" x="0" y="0" width="344" height="280" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="280" rx="12"/>

  <text class="caps" x="24" y="28">路径 A：企业内温和替代 (CONCAVE)</text>
  <text class="small" x="24" y="48">人机长短板互补 → 凹包络线 → 人机混编公司</text>
  <g class="node blue"><rect x="24" y="68" width="296" height="32" rx="4"/><text class="mid" x="172" y="84">T1：混编企业（人类占 42% · AI 占 58%）</text></g>
  <path class="edge" d="M172 100 V118" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="24" y="122" width="296" height="32" rx="4"/><text class="mid" x="172" y="138">T2：混编企业（人类占 22% · AI 占 78%）</text></g>
  <path class="edge" d="M172 154 V172" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="24" y="176" width="296" height="32" rx="4"/><text class="mid" x="172" y="192">T3：平滑减持至 0%（转为纯 AI 企业）</text></g>
  <text class="small" x="24" y="236">特点：每家公司都在逐步减少人类比例</text>
  <text class="small" x="24" y="256">就业率与工资连续变化，没有突变</text>

  <text class="caps" x="384" y="28">路径 B：企业间整体出清 (CONVEX)</text>
  <text class="small" x="384" y="48">协同放大规模 → 凸包络线 → 纯人类与纯 AI 分离</text>
  <g class="node blue"><rect x="384" y="68" width="142" height="32" rx="4"/><text class="mid" x="455" y="84">纯人类公司</text></g>
  <g class="node orange"><rect x="538" y="68" width="142" height="32" rx="4"/><text class="mid" x="609" y="84">纯 AI 公司</text></g>
  <path class="edge hot" d="M455 100 V112 H609 V100"/>
  <path class="edge hot" d="M532 112 V124" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="394" y="128" width="276" height="34" rx="17"/><text class="mid" x="532" y="145">临界点：纯 AI 单位成本低于纯人类公司</text></g>
  <path class="edge hot" d="M532 162 V180" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="384" y="184" width="296" height="32" rx="4"/><text class="mid" x="532" y="200">纯人类公司同时失去价格竞争力退出</text></g>
  <text class="small accent" x="384" y="236">特点：退出前原公司内部仍保持满编</text>
  <text class="small accent" x="384" y="256">跨过成本线时，通过企业更替完成整体切换</text>
</svg>
<svg viewBox="0 0 340 570">
  <rect class="panel" x="0" y="0" width="340" height="275" rx="12"/>
  <rect class="panel" x="0" y="290" width="340" height="280" rx="12"/>

  <text class="caps" x="20" y="28">路径 A：企业内温和替代 (CONCAVE)</text>
  <text class="small" x="20" y="48">人机长短板互补 → 凹包络 → 混编公司</text>
  <g class="node blue"><rect x="20" y="66" width="300" height="32" rx="4"/><text class="mid" x="170" y="82">T1：混编企业（人类 42% · AI 58%）</text></g>
  <path class="edge" d="M170 98 V114" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="20" y="118" width="300" height="32" rx="4"/><text class="mid" x="170" y="134">T2：混编企业（人类 22% · AI 78%）</text></g>
  <path class="edge" d="M170 150 V166" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="20" y="170" width="300" height="32" rx="4"/><text class="mid" x="170" y="186">T3：平滑减持至 0%（纯 AI 企业）</text></g>
  <text class="small" x="20" y="228">特点：每家公司都在逐步减少人类比例</text>
  <text class="small" x="20" y="248">就业率与工资连续变化，没有突变</text>

  <text class="caps" x="20" y="318">路径 B：企业间整体出清 (CONVEX)</text>
  <text class="small" x="20" y="338">协同放大规模 → 凸包络 → 纯人类与纯 AI 分离</text>
  <g class="node blue"><rect x="20" y="356" width="144" height="32" rx="4"/><text class="mid" x="92" y="372">纯人类公司</text></g>
  <g class="node orange"><rect x="176" y="356" width="144" height="32" rx="4"/><text class="mid" x="248" y="372">纯 AI 公司</text></g>
  <path class="edge hot" d="M92 388 V399 H248 V388"/>
  <path class="edge hot" d="M170 399 V410" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="26" y="414" width="288" height="34" rx="17"/><text class="mid" x="170" y="431">临界点：AI 成本低于人类底线</text></g>
  <path class="edge hot" d="M170 448 V466" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="20" y="470" width="300" height="32" rx="4"/><text class="mid" x="170" y="486">纯人类公司同时失去价格竞争力退出</text></g>
  <text class="small accent" x="20" y="524">特点：退出前原公司内部仍保持满编</text>
  <text class="small accent" x="20" y="544">跨过成本线时，通过企业更替完成切换</text>
</svg>
```

- 当人机技能互补占主导时，包络线是**凹函数**，最划算的组织方式是“人机混编”。随着 AI 变强，每家公司都会在内部慢慢调低人类占比，整个过程是连续、平缓的。
- 当协同与规模效应占主导时，包络线会变成**凸函数**，把人和机器混在一起反而不划算，市场会分成“纯人类公司”和“纯 AI 公司”两类。在纯 AI 公司的单位成本降到临界线之前，纯人类公司看起来一切正常、全员满编；而一旦纯 AI 公司的成本越过临界线，纯人类公司就会在市场竞争中同时出局。

论文图 14 还指出，随着 AI 协同能力 $y_*^M$ 的提高，同一行业的包络线会自己从凹函数变成凸函数。也就是说，一个行业完全可能在前半段表现为温和的内部人员调整，到了后半段却通过新旧企业的整体更替完成切换。

---

## 五、阶段四：当单兵与协同双双过线，为什么小众市场里还有人类团队？

来到模型推演的最后一个阶段：AI 同时跨过了两条线——单兵业务能力 $\theta = 12 > 9$（超过所有人类专家），协同指数 $y_*^M = 1.05 > 1$（具备规模递增的协同能力）。论文将这一阶段定义为**人工超智能（ASI）**。

在这个阶段，需求广阔的主流大市场已经完全由巨型纯 AI 企业供应，商品边际成本趋近于零，人类协调者的就业量降到了 $0$。

但在论文算例的最后一张快照（表 2 第四列）里，有一个初看很反直觉的结果：

**那 12 名在所有单项能力上都已经被 ASI 超过的人类程序员和文案作家，依然没有全部失业。**

他们退到了那个容量有限的**小众利基市场（Niche Market，总需求上限只有 $Q = 200$）**，在里面组了 2 家 6 人规模的纯人类小公司，拿着仅比保留底线（$0.25$）高一点点的工资（$0.269$），承担了这片小市场里 88% 的产量（$165.3$ 单位），而 ASI 只在里面生产了剩下的 $22.1$ 单位。

既然 ASI 写代码是 $12$ 分（人类 $9$ 分），协同是 $1.05$（人类 $0.75$），为什么在小众市场里，它没有把人类团队也全部替代掉？

这背后的原因，来自经济学里经典的**李嘉图比较优势（Comparative Advantage）**，以及**市场容量对规模效应的限制**：

1. **小市场限制了超协同集群的规模**：ASI 最大的成本优势来自 $y_*^M = 1.05 > 1$ 的规模递增效应——集群规模越大，人均产出越高、单位成本越低。但在总需求上限只有 $Q < 200$ 的小众市场里，市场容量限制了单家企业的最大规模（单个完整企业的产量不能超过整个市场的总需求 $q_f \le Q$）。在这么小的市场里，ASI 没法铺开成千上万个实例的集群，只能以 $m \approx 3.66$ 的小规模运转，规模递增的优势发挥不出来。
2. **算力有固定的机会成本，而人类工资可以向下调整**：运行一个 ASI 实例需要支付固定的算力租金 $r = 1$（或者把这份算力投到主流大市场里能换取的价值），而人类的保留工资底线只有 $\underline w = 0.25$。只要人类专家接受把工资降到 $0.269$（约为 ASI 算力租金的四分之一），在规模受限的小众市场里，“低工资的人类互补团队”在单位产出成本上，依然能和“高算力成本、且规模受限的 ASI”持平[@restrepo2025]。

当然，作者在正文里也明确指出：这只是 ASI 刚跨过门槛、且算力租金 $r = 1$ 明显高于人类保留工资 $\underline w = 0.25$ 时的一个临界状态。如果后面 ASI 的单兵能力继续从 $12$ 升到 $50$，或者算力租金 $r$ 降到人类保留工资以下，那么根据**命题 4(i)（全机器生产条件）**，小众市场里的这块比较优势空间也会消失。

我们可以把上面四个阶段的算例数值放在一张表里，完整对比整个演进过程：

```data title="四个阶段的均衡对比（论文算例精确值）" bars="专家工资,协调者工资" mark="阶段三：超协同 AI" note="数据取自 Imas, Koh & Legg (2026) 表 2 与第 2.2 节（算力租金 r = 1，人类保留工资 w₀ = 0.25，共 12 名专家、2 名协调者）。在阶段三快照中 AI 单兵能力设回 1.69 以单独观察协同跨过 1.0 的效应。"
阶段 | AI 单兵 θ | AI 协同 y* | 主流大市场结构 | 专家工资 | 协调者工资 | 协调者就业
无 AI 基准 | 0 | 0 | 2 家 7 人混编公司 | 4.15 | 2.41 | 2.00 / 2
阶段一：最小 AGI | 1.69 | 0.78 | 人类混编 + 大量 7-AI 小厂 | 2.90 | 1.30 | 2.00 / 2
阶段二：超胜任力 AI | 12.00 | 0.78 | 人类协调者带队的 7-AI 小厂 | 0.39 | 0.48 | 2.00 / 2
阶段三：超协同 AI | 1.69 | 1.60 | 单一巨型纯 AI 企业 | 0.41 | 0.25 | 0.97 / 2
阶段四：超智能 ASI | 12.00 | 1.05 | 单一巨型纯 AI 企业 | 0.27 | 0.25 | 0.00 / 2
```

---

## 六、走出理论模型：被数学假设简化的六道现实摩擦

把科斯的企业边界理论[@coase1937][@williamson1967]放进一般均衡模型，让《Organizing Intelligence》比传统的任务自动化模型[@acemogluRestrepo2018][@aghionJonesJones2019]多解释了很多组织层面的现象（实际上，论文第 7.1 节的**定理 3** 证明了：如果强行假设规模报酬不变 $\gamma \equiv 1$，这个模型就会严格退化为经典的 Acemoglu-Restrepo 任务模型，企业规模和组织边界也就不再影响结果）。

但任何数学模型为了求得干净的解析解，都必须对现实做简化。如果我们想用这套框架去观察真实世界，需要留意论文在哪些地方做了较强的假设，以及现实世界里的六道摩擦会如何改变上面的推演：

```sketch title="理论模型 vs 现实世界：被简化的六道制度与物理摩擦" note="“论文的公理化假设”为保证均衡存在性与解析可解而采用；“现实世界的约束与摩擦”则会改变或延缓上述四个阶段的推演进程。"
<svg viewBox="0 0 704 316">
  <rect class="panel" x="0" y="0" width="344" height="316" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="316" rx="12"/>

  <text class="caps" x="24" y="28">论文的公理化假设 (MODEL ASSUMPTIONS)</text>
  <g class="node plain"><rect x="24" y="48" width="296" height="36" rx="4"/><text class="mid" x="172" y="66">1. 协同力取全员算术平均 (一阶矩假设)</text></g>
  <g class="node plain"><rect x="24" y="92" width="296" height="36" rx="4"/><text class="mid" x="172" y="110">2. 全经济体只有单一同质 AI 模型</text></g>
  <g class="node plain"><rect x="24" y="136" width="296" height="36" rx="4"/><text class="mid" x="172" y="154">3. 算力按固定价格 r 无限弹性供给</text></g>
  <g class="node plain"><rect x="24" y="180" width="296" height="36" rx="4"/><text class="mid" x="172" y="198">4. 可竞争市场：巨型垄断企业零利润</text></g>
  <g class="node plain"><rect x="24" y="224" width="296" height="36" rx="4"/><text class="mid" x="172" y="242">5. 产出只取决于技能与协同，无法律摩擦</text></g>
  <g class="node plain"><rect x="24" y="268" width="296" height="36" rx="4"/><text class="mid" x="172" y="286">6. 需求曲线 P(Q) 外生固定，与工资脱钩</text></g>

  <text class="caps" x="384" y="28">现实世界的约束与摩擦 (REAL-WORLD FRICTIONS)</text>
  <g class="node blue"><rect x="384" y="48" width="296" height="36" rx="4"/><text class="mid" x="532" y="66">1. 金字塔层级：顶层架构师可放大全局效率</text></g>
  <g class="node teal"><rect x="384" y="92" width="296" height="36" rx="4"/><text class="mid" x="532" y="110">2. 异质专用模型混编：AI 自己也能互补拼图</text></g>
  <g class="node orange"><rect x="384" y="136" width="296" height="36" rx="4"/><text class="mid" x="532" y="154">3. 芯片与电力物理瓶颈：算力租金随需求上升</text></g>
  <g class="node clay"><rect x="384" y="180" width="296" height="36" rx="4"/><text class="mid" x="532" y="198">4. 垄断定价与壁垒：巨头获取超额垄断利润</text></g>
  <g class="node violet"><rect x="384" y="224" width="296" height="36" rx="4"/><text class="mid" x="532" y="242">5. 法律责任绑定自然人：AI 无法签字担责</text></g>
  <g class="node clay"><rect x="384" y="268" width="296" height="36" rx="4"/><text class="mid" x="532" y="286">6. 宏观总需求约束：工资下降会影响购买力</text></g>
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

  <text class="caps" x="20" y="358">现实世界的约束与摩擦 (REALITY)</text>
  <g class="node blue"><rect x="20" y="378" width="300" height="36" rx="4"/><text class="mid" x="170" y="396">1. 金字塔层级：顶层架构师可放大全局</text></g>
  <g class="node teal"><rect x="20" y="422" width="300" height="36" rx="4"/><text class="mid" x="170" y="440">2. 异质模型混编：AI 也能互补拼图</text></g>
  <g class="node orange"><rect x="20" y="466" width="300" height="36" rx="4"/><text class="mid" x="170" y="484">3. 芯片与电力瓶颈：算力租金随需求上升</text></g>
  <g class="node clay"><rect x="20" y="510" width="300" height="36" rx="4"/><text class="mid" x="170" y="528">4. 垄断定价：巨头获取超额垄断利润</text></g>
  <g class="node violet"><rect x="20" y="554" width="300" height="36" rx="4"/><text class="mid" x="170" y="572">5. 法律责任：AI 无法作为自然人签字担责</text></g>
  <g class="node clay"><rect x="20" y="598" width="300" height="36" rx="4"/><text class="mid" x="170" y="616">6. 总需求约束：工资下降会影响购买力</text></g>
</svg>
```

### 1. 算术平均假设忽略了组织的“金字塔层级”

论文的**假设 2（一阶矩表示）**规定，一家企业的规模扩展能力只取决于所有成员协同能力的**算术平均值** $\bar y_* = m^{-1} \int y_* \,\mathrm{d}\nu$。

这在数学上很简洁，但和真实的组织架构有差距。真实的企业不是所有人围成一圈求平均的扁平结构，而是分层的树状架构（Knowledge Hierarchy）[@garicano2000][@garicanoRossiHansberg2006]。

如果按算术平均来算，往 10,000 个 AI 实例里放 1 名人类总架构师，这个人的协同权重只有万分之一，几乎不起作用。但在真实的层级架构里，顶层设计者负责定义模块接口、划分任务边界和设定检验标准，1 个顶层协调者的能力可以撬动整个系统的运转效率。把组织压平为算术平均，使得模型在第三阶段过早推导出了“顶层人类协调者完全退出”的结论。

### 2. “单一 AI 模型”假设高估了人类拼图智能的维持时间

在第一阶段，人类团队之所以能靠“拼图智能”胜过 Minimal AGI，前提是模型假设**市场上只有一种同质化的 AI 模型 $\mathbf{y}^M$**（第 3.1 节），所以把多个 AI 放在一起时，它们的长短板完全重合。

但在实际应用里，一家公司完全不会只调用同一个模型。团队可以把专门针对代码优化的 `Coding-Agent`、针对安全审计微调的 `Security-Agent` 和针对文档写作优化的 `Doc-Agent` 组合进同一条流水线。

一旦允许**不同专长的异质 AI 模型**组合在一起，AI 之间自己就能形成长短板互补的“机器拼图智能”。这意味着第一阶段里人类专家依靠技能互补建立的优势，在现实中缩小的速度会比模型里更快。

### 3. 固定算力租金假设忽略了芯片与电力的物理瓶颈

模型假设机器算力可以按固定不变的租金 $r > 0$ **无限量供应**。这样一来，当第三阶段 $\gamma^M > 1$ 出现时，单家巨型 AI 企业就能迅速拉起极大规模的并发实例，接管整个行业。

但在物理世界里，先进封装产能、高带宽显存（HBM）以及数据中心的电力供应，在短期内都是受限的。当全行业同时扩大 AI 集群规模时，算力租金 $r(Q^M)$ 会随着需求上升而走高。

**算力供给的物理瓶颈，一方面会减缓巨型 AI 集群扩张的速度，另一方面也会把原本属于人类专家的“技能稀缺租金”，转移成算力与电力基础设施拥有者的“物理稀缺租金”。**

### 4. 可竞争市场假设高估了垄断巨头的让利程度

为了在“既有无数小企业、又有单家巨型垄断企业”的模型里保证均衡存在，论文采用了一种基于**替代博弈（Replacement Game）**和可竞争市场理论[@demsetz1968][@baumolPanzarWillig1982]的均衡定义（第 4.1 节与附录 B）：哪怕全行业只剩下一家巨型纯 AI 企业，因为潜在进入者随时可以复制一套同样的集群进来竞争，这家巨头也**只能获取零超额利润**，必须把成本下降的好处全部通过低价让渡给消费者。

作者在正文第 5.2 节也说明了，这只是一个理论基准。在现实商业环境里，一旦某家科技巨头吃下了全行业的主要份额，算力规模、专有数据和生态迁移成本会很快筑起进入壁垒。失去可竞争性的约束后，巨型企业会通过垄断定价获取超额利润，而不是停留在零利润状态。

### 5. 生产函数忽略了“法律责任必须落到自然人”的制度约束

在模型的生产函数 $F(\nu)$ 里，只要机器组合能以更低的成本产出更多代码和文档，企业就会用机器替换人。

但在现实社会里，很多关键岗位（如注册会计师、主治医师、律所合伙人、总工程师、合规审批人）存在的意义，不只是提供脑力产出，还在于**承担最终的法律与合规责任**。

AI 没有自然人身份，无法承担刑事责任，也没有可供追偿的个人资产。只要现行法律体系依然要求关键文件背后必须有一位能承担法律后果的自然人签字，就算 AI 在业务能力和协同能力上都超过了人类，人类依然会以“责任承担者与合规审核人”的身份留在业务流程里。

### 6. 局部均衡假设切断了“工资收入—消费需求”的宏观循环

最后，这篇论文采用的是产业组织理论里常见的局部均衡框架，假设市场的需求曲线 $P_N(Q)$ 是外部固定给定的，不随工人工资的变化而移动。

在第一和第二阶段，这个简化影响不大。但到了第三和第四阶段，人类协调者的工资降到了保留底线 $\underline w$，技术专家的工资也降到了接近底线的水平，同时企业又是零利润的。

如果不在模型外额外引入算力资本收益分配或全民基本收入等机制，当大多数劳动者的工资溢价消失时，社会总购买力必然会下降，那条向右上延伸的高需求曲线 $P_N(Q)$ 在现实中是维持不住的。

---

## 七、小结：换两个指标看未来的变化

把上面所有的推导和现实约束合在一起，这篇论文给我们提供了一个很清楚的观察视角。

过去几年，每当有新模型发布，大家最习惯看的是它在各类单兵测试集（如 MMLU、GPQA、SWE-bench）上的分数又涨了多少。

但从组织经济学的角度看，**单兵业务能力（$L$）的提升，主要作用是降低商品价格、缩减大公司的冗余层级，同时提高那些擅长拆解问题、控制上下文边界的“人类协调者”的相对价值；单兵能力本身并不会直接决定企业能扩得多大。**

真正决定行业组织形态会不会发生根本变化的指标，是**多智能体协同指数 $\gamma^M$**。

只要 $\gamma^M$ 还在 $1$ 以下，多个 AI 堆在一起依然会因为上下文损耗和目标偏移而内耗，企业规模就有上限，有不同专长的人类就依然能在中小型混编团队里发挥互补和协调的作用。

只有当哪一天，我们看到成百上千个 AI 实例能在长周期、大规模的复杂工程里顺畅配合，做到**集群规模越大、单个智能体的平均有效产出反而越高（$\gamma^M > 1$）**时，限制组织规模的科斯天花板才算真正被跨过去。

在那之前，与其在单一规范化任务上和模型比拼做题速度，不如多花精力练习怎么拆解复杂问题、怎么把不同特长的工具和人组织到一起。因为在单点能力可以低成本复制的时代，真正稀缺的是把它们组织起来的能力。

---

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
