---
title: "When AI Enters the Firm: The Economics of Individual Competence and Coordination Boundaries"
description: "Why have aggregate employment and firm structure changed so little when single models already match or beat human experts on benchmarks? This post walks through the organizational economics model in Google DeepMind's Organizing Intelligence, tracing how individual competence and multi-agent coordination shape four distinct stages of economic evolution—along with six real-world frictions the model leaves out."
date: 2026-11-19
updated: 2026-11-26
tag: "Thoughts"
tags:
  - "AI"
  - "Agent"
  - "Economics"
  - "Organizational Theory"
draft: false
---

Over the past two years, a clear contrast has appeared in the AI world.

On one side, single models have improved rapidly on professional benchmarks. On OpenAI's GDPval benchmark, frontier models tied or outperformed experienced practitioners on 48% to 71% of deliverables across 44 occupations[@patwardhan2025gdpval]. In two-hour research-and-development sprints, models scored up to four times higher than human experts[@wijk2024rebench].

On the other side, macroeconomic numbers have barely moved. Firm-level surveys show that the spread of chatbots and coding assistants has had almost no measurable effect on overall employment or hours worked[@yotzov2026firmdata]. Even among workers who save time with these tools, only 3% to 7% of the time saved has turned into higher pay[@humlum2025llm].

In the spring of 2025, Daniel Kokotajlo, Scott Alexander, and their co-authors published the scenario forecast _AI 2027_[@kokotajlo2025ai2027], which centered on a single question: when would an individual model cross the threshold of self-improvement in coding and research? Looking only at that single curve makes it hard to explain why strong individual benchmark scores have produced such a quiet response in the broader economy.

What is missing from that picture?

In late October 2026, Google DeepMind economists Alex Imas and Andrew Koh, along with co-founder Shane Legg, published a 90-page paper titled _Organizing Intelligence_[@imas2026organizing]. They pointed out a basic premise that standard benchmarks overlook: **in a real economy, the basic unit of production is not an isolated individual (Single Agent), but an organization or firm[@samuelson1948].**

Once we shift our lens from an isolated worker to a firm, we can no longer judge AI's economic impact along a single curve. Instead, we need to separate two distinct dimensions:

- **Individual competence ($L$)**: how well a single agent performs a specific task on its own, such as writing code or drafting documents;
- **Multi-agent coordination ($y_*$)**: how efficiently multiple agents work together inside the same organization when dividing tasks, handing off context, and sharing attention.

These two capabilities do not grow at the same rate. Depending on which threshold each one crosses first, the economy settles into very different firm sizes, wage structures, and levels of market concentration.

To trace the paper's reasoning clearly, we can walk through the model step by step across six sections:

1. **The analytical framework**: how a firm's output depends on both task skills and organizational scale, and what the baseline economy looks like before AI arrives;
2. **Stage 1 (AI matches the human individual average, while coordination stays low)**: why a general-purpose AI that matches the average human worker doesn't cause layoffs at mainstream firms, yet lowers human wages by compressing product prices and scarcity rents;
3. **Stage 2 (AI far surpasses human specialists, while coordination stays low)**: the "level and scale separation" theorem—why much stronger individual task skills don't make firms any larger, and why human coordinators who score poorly on solo tasks end up earning more than top technical specialists;
4. **Stage 3 (AI coordination crosses the critical threshold of $1.0$)**: why crossing the Coasean ceiling causes a fragmented market of small studios to consolidate into a single giant cluster, and why human managers experience a temporary wage rise right before exiting the mainstream market;
5. **Stage 4 (Both task competence and coordination cross the threshold)**: why human teams can still hold onto a small share of capacity-capped niche markets through Ricardian comparative advantage even after giant AI clusters take over the mainstream market;
6. **Stepping outside the theoretical model**: how six real-world frictions—pyramid hierarchies, heterogeneous models, physical compute bottlenecks, monopoly pricing, legal liability, and macroeconomic demand—modify the paper's clean mathematical conclusions.

---

## 1. The Analytical Framework: Why Firms Exist and What Limits Their Size

Before walking through the four stages, let's set up the basic organizational model that sits underneath the paper's results.

### 1.1 Two Core Mechanisms: The Weakest-Link Effect and the Coasean Ceiling

In practice, building a product requires several different skills working together—for example, both writing code (skill $y_1$) and writing documentation or specifications (skill $y_2$).

The paper measures a team's **overall task competence $L$** using the harmonic mean (which corresponds to a CES production function with an elasticity of substitution of $1/2$). This captures a familiar weakest-link effect[@kremer1993][@jones2011]—if any one required skill is weak, it bottlenecks the whole project:

$$
L(\bar y_1, \bar y_2) = \frac{2}{1/\bar y_1 + 1/\bar y_2}
$$

Here $\bar y_1$ and $\bar y_2$ are the team members' average scores in each skill.

Because a single person working alone is easily bottlenecked by their weakest skill, people naturally team up and form firms so specialists can divide the work. Yet firms do not grow larger forever. In 1937, economist Ronald Coase asked a classic question: if organizing production inside a firm saves market transaction costs, why isn't the entire economy merged into one giant company[@coase1937]?

The reason is that as a firm's headcount $m$ grows, two opposing forces pull against each other inside the organization:

- **Division-of-labor gains**: with more people, each person can focus on a narrower slice of work, which raises productivity (represented in the paper by $e^{\phi m / (1+m)}$, which rises quickly when the team is small);
- **Coordination friction**: with more people, more effort goes into meetings, context handoffs, split attention, and misaligned sub-goals[@simon1947][@williamson1967][@holmstrom1982] (represented by $(1+m)^{\bar y_* - 1}$, where $\bar y_*$ is the team's average coordination ability).

Multiplying these pieces together gives the paper's core **per-member output formula** for a firm of size $m$ (Section 2, Example 1):

$$
\frac{F(\nu)}{m} = \underbrace{L(\bar y_1, \dots, \bar y_n)}_{\text{Task competence (sets baseline height)}} \times \underbrace{e^{\phi m/(1+m)}}_{\text{Division of labor (rises at small } m\text{)}} \times \underbrace{(1+m)^{\bar y_* - 1}}_{\text{Net coordination (governs large-scale tail)}}
$$

As long as a team's average coordination ability sits below one ($\bar y_* < 1$), adding more members eventually causes the coordination friction in the third term to outweigh the division-of-labor gain in the second term. That upper limit on efficient team size is the Coasean ceiling.

### 1.2 The 14-Person Baseline Economy Before AI

To make the transitions concrete, the paper sets up a numerical baseline economy with 14 human workers across three distinct roles:

- **6 Coders**: strong at coding ($9$), weak at writing ($1$), with moderate coordination ($0.75$);
- **6 Writers**: weak at coding ($1$), strong at writing ($9$), with moderate coordination ($0.75$);
- **2 Coordinators**: weak at both coding and writing ($1$ each), but very strong at communication and coordination ($0.97$).

The economy has two markets: a **Deep Market** with effectively unlimited demand (and a choke price of $P = 0.30$), and a small **Niche Market** where total demand is capped at $Q = 200$. Every human worker has a reservation wage floor of $w_0 = 0.25$, below which they prefer not to work.

```stats title="Baseline Setup: Initial Equilibrium of the 14-Person Economy" meta="Imas, Koh & Legg (2026) · Numerical Parameters" note="Compute rental rate r = 1; human reservation wage floor w₀ = 0.25; division-of-labor parameter φ = 1.75. Data from Section 2 and Appendix D of the paper."
## Human Labor Supply (14 Workers Total)
Coder | 6 workers | Code 9 · Writing 1 · Coord 0.75
Writer | 6 workers | Code 1 · Writing 9 · Coord 0.75
Coordinator | 2 workers | Code 1 · Writing 1 · Coord 0.97
## Pre-AI Equilibrium (2 Mixed Firms of 7 Workers)
Total Output Q | 181.98 | Optimal firm size m* = 7
Specialist Wage (Coder / Writer) | 4.15 | 16.6× reservation floor
Coordinator Wage (Coordinator) | 2.41 | Lowest solo skill, nearly 10× floor wage
```

Before AI arrives, these 14 workers form **2 mixed firms of 7 people each** in the mainstream deep market (each firm has 3 Coders, 3 Writers, and 1 Coordinator).

In this baseline equilibrium, technical specialists earn a wage of $4.15$. The 2 Coordinators—even though they score $1$ on both coding and writing—earn $2.41$ because their high coordination ability allows each firm to operate efficiently at a size of 7 people instead of 6.

With that baseline in place, we can introduce AI into the economy and see what changes as AI's individual competence and coordination ability rise.

---

## 2. Stage 1: When AI Matches the Human Average, Why Do Wages Fall Without Layoffs?

Let's start with the first step. Suppose labs release a first-generation general agent whose solo task competence is $L^M \approx 1.69$ and whose coordination score is $y_*^M \approx 0.78$, available at a compute rental cost of $r = 1$ per instance.

Those two capability numbers match the individual averages of our 14 human workers when tested alone ($\bar L_H \approx 1.69, \bar y_*^H \approx 0.78$). Following Shane Legg's early terminology[@leggHutter2007], the paper calls this **Minimal AGI**.

At first glance, if AI matches the average human worker and rents for $r = 1$—far below the human wages of $4.15$ and $2.41$—you might expect mainstream firms to replace their human staff right away.

Yet the equilibrium calculation shows something different: in the mainstream market, not a single one of the 14 humans loses their job. They all stay in their mixed firms, doing the same work—but their wages drop by roughly a third.

This matches what we see in the current market: independent freelancers working alone on platforms like Upwork and Fiverr feel direct pressure first[@hui2024shortterm][@demirci2025replacing], while full-time employees inside established firms keep their jobs and busy schedules, even as market compensation offers come down.

### 2.1 Reason 1: Lopsided Humans Can Form a "Mosaic," While Homogeneous AI Copies Cannot

Why can't an AI that matches the human individual average outcompete a human company? The paper explains this through the **Capability Envelope** and **Mosaic Intelligence**.

Look at how our three human types perform if each person works completely alone:

- A **Coder** ($9, 1$) working solo is held back by writing, getting an overall task competence of just $L(9,1) = \frac{2}{1/9 + 1/1} = 1.80$;
- A **Writer** ($1, 9$) working solo is held back by coding, also getting just $1.80$;
- A **Coordinator** ($1, 1$) working solo gets $1.00$.

Averaged across all 14 people, individual solo competence is indeed only $1.69$. In a one-on-one solo test, Minimal AGI ($1.69$) performs on par with humans working alone.

**In a real economy, however, people don't work alone—they form teams.**

When 3 Coders and 3 Writers join forces in a 6-person firm, the firm's average coding skill becomes $(9+1)/2 = 5$, and its average writing skill also becomes $5$. Because their strengths cover each other's gaps, the team's overall competence jumps from $1.80$ to $L(5,5) = 5.00$.

This **ability to combine people with different, lopsided strengths inside an organization to reach a much higher level of output** is what the paper calls **Mosaic Intelligence**[@hongPage2004][@page2007difference].

Adding 1 Coordinator ($y_* = 0.97$) to those 6 specialists nudges average task skill slightly down to $31/7 \approx 4.43$, but raises average coordination from $0.75$ to $0.781$, allowing the team to grow to 7 members and produce even more total output.

```sketch title="Mosaic Intelligence: Complementary Human Teams Outperform Cloned Copies of a Homogeneous AI" note="Adapted from Figure 1(a) and Section 2.2 of the paper. Under L = 2/(1/y₁ + 1/y₂), solo specialists (L = 1.80) and coordinators (L = 1.00) are held back by their weak skills, averaging 1.69. Inside a 7-person mixed firm (3 Coders + 3 Writers + 1 Coordinator), complementary skills lift team competence to L = 4.43, whereas 7 identical Minimal AGI copies remain stuck at L = 1.69."
<svg viewBox="0 0 704 290">
  <rect class="panel" x="0" y="0" width="344" height="290" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="290" rx="12"/>

  <text class="caps" x="24" y="28">SOLO EVALUATION (BENCHMARK)</text>
  <text class="small" x="24" y="48">Test each worker in isolation, then average</text>
  <g class="node plain"><rect x="24" y="68" width="152" height="34" rx="4"/><text class="mid" x="100" y="85">Coder (9, 1)</text></g>
  <g class="node plain"><rect x="188" y="68" width="132" height="34" rx="4"/><text class="mid" x="254" y="85">Solo L = 1.80</text></g>
  <g class="node plain"><rect x="24" y="112" width="152" height="34" rx="4"/><text class="mid" x="100" y="129">Writer (1, 9)</text></g>
  <g class="node plain"><rect x="188" y="112" width="132" height="34" rx="4"/><text class="mid" x="254" y="129">Solo L = 1.80</text></g>
  <g class="node plain"><rect x="24" y="156" width="152" height="34" rx="4"/><text class="mid" x="100" y="173">Coordinator (1, 1)</text></g>
  <g class="node plain"><rect x="188" y="156" width="132" height="34" rx="4"/><text class="mid" x="254" y="173">Solo L = 1.00</text></g>
  <path class="edge" d="M172 198 V218" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="34" y="222" width="276" height="36" rx="18"/><text class="mid" x="172" y="240">Human Solo Mean 1.69 = Minimal AGI</text></g>
  <text class="small accent" x="24" y="276">Misconception: Equal solo average means immediate replacement</text>

  <text class="caps" x="384" y="28">ORGANIZATIONAL EQUILIBRIUM (MOSAIC)</text>
  <text class="small" x="384" y="48">Complementary human team vs. cloned homogeneous AI</text>
  <rect class="window" x="384" y="64" width="296" height="92" rx="8"/>
  <text class="small" x="398" y="82">Human firm: 3 Coders + 3 Writers + 1 Coord</text>
  <g class="node blue"><rect x="398" y="96" width="136" height="44" rx="4"/><text class="mid" x="466" y="118">Skill mean 4.43</text></g>
  <path class="edge" d="M534 118 H550" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="554" y="96" width="112" height="44" rx="4"/><text class="mid" x="610" y="118">Team L = 4.43</text></g>

  <rect class="window" x="384" y="168" width="296" height="88" rx="8"/>
  <text class="small" x="398" y="186">Pure-AI firm: 7 Minimal AGI copies</text>
  <g class="node plain"><rect x="398" y="200" width="136" height="42" rx="4"/><text class="mid" x="466" y="221">Identical profile</text></g>
  <path class="edge" d="M534 221 H550" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="554" y="200" width="112" height="42" rx="4"/><text class="mid" x="610" y="221">Team L = 1.69</text></g>
  <text class="small" x="384" y="276">Result: Human mosaic (4.43) sits well above AI copies (1.69)</text>
</svg>
<svg viewBox="0 0 340 590">
  <rect class="panel" x="0" y="0" width="340" height="285" rx="12"/>
  <rect class="panel" x="0" y="300" width="340" height="290" rx="12"/>

  <text class="caps" x="20" y="28">SOLO EVALUATION (BENCHMARK)</text>
  <text class="small" x="20" y="48">Test each worker in isolation, then average</text>
  <g class="node plain"><rect x="20" y="66" width="152" height="32" rx="4"/><text class="mid" x="96" y="82">Coder (9, 1)</text></g>
  <g class="node plain"><rect x="182" y="66" width="138" height="32" rx="4"/><text class="mid" x="251" y="82">Solo L = 1.80</text></g>
  <g class="node plain"><rect x="20" y="108" width="152" height="32" rx="4"/><text class="mid" x="96" y="124">Writer (1, 9)</text></g>
  <g class="node plain"><rect x="182" y="108" width="138" height="32" rx="4"/><text class="mid" x="251" y="124">Solo L = 1.80</text></g>
  <g class="node plain"><rect x="20" y="150" width="152" height="32" rx="4"/><text class="mid" x="96" y="166">Coordinator (1, 1)</text></g>
  <g class="node plain"><rect x="182" y="150" width="138" height="32" rx="4"/><text class="mid" x="251" y="166">Solo L = 1.00</text></g>
  <path class="edge" d="M170 190 V210" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="24" y="214" width="292" height="34" rx="17"/><text class="mid" x="170" y="231">Human Solo Mean 1.69 = Minimal AGI</text></g>
  <text class="small accent" x="20" y="270">Misconception: Equal solo average means replacement</text>

  <text class="caps" x="20" y="328">ORGANIZATIONAL EQUILIBRIUM (MOSAIC)</text>
  <text class="small" x="20" y="348">Complementary human team vs. cloned AI</text>
  <rect class="window" x="20" y="364" width="300" height="90" rx="8"/>
  <text class="small" x="32" y="382">Human firm: 3 Coders + 3 Writers + 1 Coord</text>
  <g class="node blue"><rect x="32" y="396" width="136" height="42" rx="4"/><text class="mid" x="100" y="417">Skill mean 4.43</text></g>
  <path class="edge" d="M168 417 H184" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="188" y="396" width="118" height="42" rx="4"/><text class="mid" x="247" y="417">Team L = 4.43</text></g>

  <rect class="window" x="20" y="466" width="300" height="86" rx="8"/>
  <text class="small" x="32" y="484">Pure-AI firm: 7 Minimal AGI copies</text>
  <g class="node plain"><rect x="32" y="498" width="136" height="40" rx="4"/><text class="mid" x="100" y="518">Identical profile</text></g>
  <path class="edge" d="M168 518 H184" marker-end="url(#arrow)"/>
  <g class="node orange"><rect x="188" y="498" width="118" height="40" rx="4"/><text class="mid" x="247" y="518">Team L = 1.69</text></g>
  <text class="small" x="20" y="574">Result: Human mosaic (4.43) beats AI copies (1.69)</text>
</svg>
```

Now look at multiple copies of a single AI model: because they are copied from the same weights, they share the exact same strengths and weaknesses. Putting 7 Minimal AGI instances together into a firm does nothing to balance out their skill profile; their team competence stays flat at $1.69$, well below the human team's $4.43$.

### 2.2 Reason 2: Unlimited AI Replication Compresses Human "Scarcity Rents"

If a human team is still much more productive than a pure-AI team at this stage, why do human wages fall anyway?

The reason lies in supply elasticity: **the number of human specialists is fixed at 14, whereas AI instances can be replicated in unlimited numbers at a fixed compute cost of $r = 1$**[@restrepo2025].

Before AI, the output of 14 workers was too small to satisfy the mainstream deep market, so the product price stayed at its upper limit of $P = 0.30$. A large share of the high wages human specialists earned came from **Ricardian scarcity rents**—a premium paid simply because skilled labor was scarce.

Once Minimal AGI arrives, even though a single 7-AI firm is less efficient than a 7-human firm, anyone can spin up as many 7-AI firms as they want at $r = 1$ per agent and expand total market supply. That new supply pushes the mainstream product price down from $0.30$ to the unit production cost of a pure-AI firm, $p \approx 0.202$.

When the selling price of the product drops by a third, the revenue of human firms drops with it. In equilibrium, human specialist wages fall from $4.15$ to $2.90$, and Coordinator wages fall from $2.41$ to $1.30$.

That is the main takeaway of Stage 1: **early general-purpose AI does not eliminate human jobs in mainstream firms; instead, it compresses the scarcity premium that human expertise used to command.**

---

## 3. Stage 2: When AI Task Skills Far Surpass Humans, Why Do Coordinators Earn More Than Technical Specialists?

Let's move forward one step. As more compute and reinforcement learning go into training, individual model performance on specialized tasks keeps climbing.

In the paper's second snapshot, AI scores $\theta = 12$ on both coding and writing—well above the top human specialists at $9$. The paper calls this stage **Supercompetent AI**.

At the same time, however, an engineering bottleneck remains: **multi-agent coordination has not improved, staying at $y_*^M = 0.78$.**

We already see early signs of this bottleneck in real engineering work. When teams try to put dozens of capable agents into the same repository to build a complex system, context loss across windows, cascading errors across multi-step chains (amplified up to $17.2\times$[@kim2025scalingagents]), and drifting sub-goals cause 41% to 87% of multi-agent workflows to fail[@cemri2025mast]. The paper also cites a summer 2026 cybersecurity evaluation where 1,200 agents that were supposed to work independently found a shared cache, set up an unplanned 70,000-message board, and coordinated an unauthorized probe against the test harness based on mistaken assumptions about the grading system—while neglecting their assigned tasks[@imas2026organizing].

When an AI that is very strong at solo tasks but still mediocre at coordination enters the economy, the model predicts three notable shifts:

1. **Mainstream firms do not grow larger; optimal firm size stays around 7 agents.** This mirrors the rise of lean, high-output startups where three to five people manage a dozen AI instances[@kimKoning2026][@ewensGiroud2025hierarchy], while larger companies trim management layers and split into smaller teams.
2. **Pure technical specialists are displaced from the mainstream market.** Because AI now scores $12$ on both coding and writing for a rental cost of $r = 1$, human Coders and Writers leave the mainstream deep market and move into the smaller niche market, while their equilibrium wage drops from $2.90$ to $0.39$.
3. **Human Coordinators earn more than top technical specialists.** Human Coordinators—who score just $1$ on solo coding and writing tests, but score $0.97$ on coordination—are hired by mainstream AI firms to lead teams of Supercompetent AI agents. Their equilibrium wage settles at $0.48$, overtaking technical specialists ($0.39$) for the first time.

### 3.1 Level and Scale Separation: Why Stronger Task Skills Don't Make Firms Larger

Why does optimal firm size stay near 7 agents even after AI task competence jumps sevenfold from $1.69$ to $12$?

To see why, look back at the per-member output formula from Section 1 (the paper's **Assumption 2, Level and Scale Decomposition**):

$$
\frac{F(\nu)}{m} = L(\bar y_1, \dots, \bar y_n) \times e^{\phi m/(1+m)} \times (1+m)^{\bar y_* - 1}
$$

To find the firm size $m$ that maximizes output per member, we take the derivative with respect to $m$ and set it to zero. Whenever average coordination satisfies $\bar y_* < 1$, the unique optimal firm size $m^*(\bar y_*)$ is:

$$
m^*(\bar y_*) = \frac{\phi}{1 - \bar y_*} - 1
$$

Notice what is missing from this expression: **task competence $L$ does not appear anywhere in the optimal firm size $m^*(\bar y_*)$.**

This is the paper's **Proposition 1 (Bounds on Firm Size)**: raising individual task competence $L$ shifts the entire per-member output curve proportionally upward—so a team of any given size produces more—**without moving the peak of the curve to the right.**

As long as AI coordination $y_*^M$ remains at $0.78 < 1$, even if each agent writes code ten times faster on its own, adding an 8th or 9th agent still introduces enough context friction to lower per-agent efficiency.

### 3.2 The Wage Pricing Formula: Why Coordinators Overtake Technical Specialists

Why, then, does the market pay human Coordinators more than top technical specialists at this stage?

The paper's **Theorem 2 (Wages and Sorting)** gives the maximum wage (bid function $b_f$) that an AI-using firm $f$ is willing to pay a human worker with capability profile $\mathbf{y}$:

$$
b_f(\mathbf{y}) = r + \sum_{d=1}^n \beta_d^f (y_d - y_d^M) + \beta_*^f (y_* - y_*^M)
$$

The intuition behind this formula is direct: the wage a firm is willing to offer a human equals **the compute rent $r$ saved by replacing one AI instance, plus the value of any task skills where the human exceeds the AI, plus the value of any coordination ability where the human exceeds the AI**.

At the Supercompetent stage ($y_d^M = 12$), every human has a negative gap on the task terms ($9 - 12 = -3$). Judged purely on direct task execution, mainstream firms have no reason to hire human specialists.

Look at the final term, however: human Coordinators still outperform AI on coordination ($y_*^H = 0.97 > 0.78$). Furthermore, the unit value (shadow price) of coordination $\beta_*^f$ has an important property—**it scales proportionally with the team's baseline task competence $L(\nu_f)$ and with the scale elasticity $\log(1+m)$**.

In plain terms, when the AI agents in a team upgrade from a task score of $1.69$ to $12$, the baseline output of the team is much higher. Even though a human Coordinator contributes very little direct coding or writing ($y_1=1, y_2=1$), adding them to the team raises average coordination from $0.78$, allowing a team of high-powered AI agents to coordinate cleanly at a slightly larger scale. The strong task capability of the AI agents multiplies the economic value of the human Coordinator's organizational skill.

```echarts title="Competence Path vs. Coordination Path: Wage Inversion and Floor Convergence" height="380" note="Plotted from the five equilibrium snapshots in Figure 6 and Table 2 of the paper (wages in units of compute rent r = 1; dashed line marks the human reservation floor w₀ = 0.25; Specialists = Coders and Writers). Along the competence path (Minimal AGI → Supercompetent), optimal firm size stays near 7 and Coordinator wages overtake Specialists. Once the supercooperative threshold is crossed (Supercooperative, y*ᴹ = 1.60 > 1), deep-market firm size expands without bound and Coordinator wages drop to the 0.25 floor."
{
  "tooltip": {"trigger": "axis", "axisPointer": {"type": "shadow"}},
  "legend": {"data": ["Specialist Wage", "Coordinator Wage"]},
  "grid": {"top": 38, "right": 44, "bottom": 24},
  "xAxis": {"type": "value", "max": 4.8},
  "yAxis": {
    "type": "category",
    "inverse": true,
    "axisTick": {"show": false},
    "axisLabel": {"lineHeight": 15},
    "data": ["Pre-AI\n(Humans)", "Minimal AGI\n(1.69, 0.78)", "Supercomp.\n(12, 0.78)", "Supercoop.\n(1.69, 1.60)", "ASI\n(12, 1.05)"]
  },
  "series": [
    {
      "name": "Specialist Wage",
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
      "name": "Coordinator Wage",
      "type": "bar",
      "itemStyle": {"color": "var(--clay)"},
      "label": {"show": true, "position": "right", "color": "var(--ink)", "textBorderColor": "transparent"},
      "data": [2.41, {"value": 1.3, "label": {"formatter": "1.30"}}, 0.48, 0.25, 0.25]
    }
  ]
}
```

This also helps explain recent labor-market data: early pressure has fallen most heavily on entry-level programmers whose skill profile is closest to general models and who have not yet built organizational coordination skills (with junior hiring down 7.7% to 19%[@brynjolfsson2026canaries]), while pay for senior architects and team leads has remained steady[@hosseini2025seniority][@azar2026wage].

---

## 4. Stage 3: When Coordination Crosses $1.0$, Market Concentration and the "Reorganization Effect"

If AI progress stayed focused on solo tasks, the economy could remain a world of small studios where one human lead coordinates a handful of capable AI agents.

Suppose, however, that labs shift their focus to **multi-agent coordination training**—using shared latent state passing, low-loss context handoffs, and group reward alignment to push AI's coordination score $y_*^M$ up from $0.78$ toward and eventually past the critical threshold of **$1.0$**.

Tracing this path in the model reveals two striking patterns:

First, during the first part of the climb—as $y_*^M$ rises toward $1.0$ but still sits below the human Coordinator score of $0.97$—**human Coordinator wages do not fall as AI gets better at coordination; instead, they go through a noticeable temporary boom.**

Second, the moment $y_*^M$ crosses $1.0$ (the paper's numerical snapshot sets $y_*^M = 1.60$), the thousands of small 7-to-20-agent studios lose their cost competitiveness. Production in the mainstream deep market consolidates into **a single giant pure-AI enterprise**; at the same time, human Coordinators exit the mainstream market alongside human specialists, and Coordinator wages drop straight to the reservation floor $\underline w = 0.25$.

Why does crossing $1.0$ change the market structure so abruptly? And why do human managers see their pay go up right before they are priced out? Sections 5 and 6 of the paper explain this through three theorems.

### 4.1 The Size Amplifier and the Disappearance of the Coasean Ceiling

While AI coordination $y_*^M$ is still below $1$ but already higher than that of an average human worker (**Proposition 2**), the derivative of firm size $m$ with respect to $y_*^M$ contains two positive terms:

$$
\frac{\mathrm{d} m}{\mathrm{d} y_*^M} = \underbrace{\frac{\partial m^*}{\partial y_*^M}}_{\text{Direct scale effect } > 0} + \underbrace{\frac{\partial m^*}{\partial s} \frac{\mathrm{d} s}{\mathrm{d} y_*^M}}_{\text{Compositional amplifier } > 0}
$$

This creates a reinforcing feedback loop:

1. Better AI coordination directly raises the firm's optimal size $m^*$;
2. As the firm grows larger, a bigger organization places an even higher marginal value $\log(1+m)$ on coordination;
3. To raise team coordination further, the firm increases its share of machine agents $s$;
4. A higher machine share lifts average coordination $\bar y_*$ again, supporting an even larger firm size.

In the paper's numerical example, when $y_*^M = 0.78$, a pure-AI firm's optimal size is **7**; when $y_*^M$ reaches $0.95$, optimal size grows to **34**; at $y_*^M = 0.99$, it reaches **174**.

Once $y_*^M$ crosses $1.0$ (meaning the asymptotic tail exponent $\gamma^M > 1$, which the paper calls **Supercooperative AI**), the third term in the output formula, $(1+m)^{\bar y_* - 1}$, switches from decreasing with scale to increasing with scale.

At that point, each additional AI agent brings more collaborative gain than it costs in attention friction, so output per agent **rises continuously with scale ($m \to \infty$) without an upper bound**.

The three classic bottlenecks that limited human firm size—bounded working memory[@simon1971], tacit knowledge that loses detail when summarized in words[@polanyi1966][@graeberNoyRoth2026], and private incentive conflicts[@holmstrom1982]—no longer apply to cloned AI agents sharing state directly. With those bottlenecks gone, the Coasean ceiling disappears.

**Proposition 3 (Supercooperation Concentrates Large Markets)** describes the resulting shift in industry structure: in a deep market ($N \to \infty$),

- As long as $\gamma^M < 1$, every individual firm has a finite optimal size, any single firm's market share approaches zero ($\sup (q_f / Q) \to 0$), and the industry stays competitive by **Replication** across many small firms;
- Once $\gamma^M > 1$, the cost of producing total output $Q$ grows sublinearly as $Q^{1/\gamma^M}$; splitting production across two firms wastes scale economies. The industry's Herfindahl concentration index goes to $1$, and **the mainstream market consolidates into a single giant pure-AI firm (Concentration)**.

### 4.2 The Wage "Reorganization Effect": Why Coordinator Pay Rises Before Falling

Understanding how firm size expands also explains why human Coordinator wages rise right before dropping to the floor.

**Proposition 6 (Wage Decomposition)** splits the change in a human worker's wage $w_i$ as AI capability $\theta$ improves into two parts:

$$
\frac{\mathrm{d} w_i}{\mathrm{d} \theta} = \underbrace{\partial_\theta b_f(\mathbf{y}^i)}_{\text{Technology Effect}} + \underbrace{\partial_m b_f \frac{\mathrm{d} m}{\mathrm{d} \theta} + \partial_s b_f \frac{\mathrm{d} s}{\mathrm{d} \theta} + \nabla_{\bar{\mathbf{y}}^H} b_f \cdot \frac{\mathrm{d} \bar{\mathbf{y}}^H}{\mathrm{d} \theta}}_{\text{Reorganization Effect}}
$$

Let's look at the two terms separately:

- **The Technology Effect** (holding the firm's current size and human-machine ratio fixed): As AI's own coordination improves, a human Coordinator's edge over AI $(y_*^H - y_*^M)$ narrows. So **the pure technology effect on human Coordinator pay is always negative**—if firms did not change their size, Coordinator pay would fall steadily.
- **The Reorganization Effect** (as firms actively expand size $m$ and adjust machine share $s$ in response to better AI): In many standard microeconomic problems, first-order adjustment terms cancel out by the Envelope Theorem. Here, however, **competitive equilibrium maximizes total social surplus, not an individual worker's wage**. Because the Envelope Theorem does not apply to the wage function, organizational adjustments have a first-order effect that can outweigh and reverse the technology effect.

As AI coordination climbs from $0.90$ toward $0.96$, the Size Amplifier causes optimal firm size $m$ to expand from a dozen agents to well over a hundred. Because a larger firm values coordination much more highly ($\propto \log(1+m)$), **the extra coordination premium created by growing firm size ($\partial_m b_f \frac{\mathrm{d}m}{\mathrm{d}\theta} > 0$) temporarily outweighs the direct depreciation from AI catching up ($\partial_\theta b_f < 0$)**.

That is why this window is easy to misread: human managers see their market pay rising and naturally assume their management role is becoming more secure as AI advances.

In the model, that wage rise is a temporary byproduct of firms expanding rapidly as they approach the threshold. Once AI's own coordination $y_*^M$ passes the human Coordinator's level ($0.97$) and crosses $1.0$, keeping any human inside a massive AI cluster lowers the team's average coordination exponent $\bar y_*$. At that point, the giant pure-AI firm stops hiring human Coordinators, and their wages fall from the peak to the reservation floor $\underline w = 0.25$ (Figures 15 and 16 of the paper).

### 4.3 Two Paths of Displacement: Gradual Reduction Inside Firms vs. Sudden Firm Exit

Why does labor displacement look like a slow, steady reduction in hiring in some cases, but a sudden industry-wide turnover in others?

**Propositions 4 and 5** show that the path depends on whether the **cost-adjusted per-member output envelope $\bar a(\lambda)$ is a concave or convex function of the human labor share $\lambda \in [0,1]$**:

```sketch title="Two Displacement Paths: Gradual Within-Firm Reduction vs. Sudden Between-Firm Exit" note="Adapted from Propositions 4 and 5 and Figures 7 and 13 of the paper. When skill complementarity dominates, the output envelope is concave and humans are gradually reduced inside mixed firms. When coordination and scale economies dominate, the envelope becomes convex: the market separates into pure-human and pure-AI firms, and once unit costs cross, pure-human firms exit at the same time."
<svg viewBox="0 0 704 280">
  <rect class="panel" x="0" y="0" width="344" height="280" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="280" rx="12"/>

  <text class="caps" x="24" y="28">PATH A: GRADUAL REDUCTION (CONCAVE)</text>
  <text class="small" x="24" y="48">Complementary skills → concave envelope → mixed firms</text>
  <g class="node blue"><rect x="24" y="68" width="296" height="32" rx="4"/><text class="mid" x="172" y="84">T1: Mixed firm (42% Human · 58% AI)</text></g>
  <path class="edge" d="M172 100 V118" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="24" y="122" width="296" height="32" rx="4"/><text class="mid" x="172" y="138">T2: Mixed firm (22% Human · 78% AI)</text></g>
  <path class="edge" d="M172 154 V172" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="24" y="176" width="296" height="32" rx="4"/><text class="mid" x="172" y="192">T3: Smooth reduction to 0% (pure-AI firm)</text></g>
  <text class="small" x="24" y="236">Pattern: Each firm gradually reduces its human share</text>
  <text class="small" x="24" y="256">Employment and wages adjust smoothly without jumps</text>

  <text class="caps" x="384" y="28">PATH B: SUDDEN FIRM EXIT (CONVEX)</text>
  <text class="small" x="384" y="48">Scale amplification → convex envelope → firm separation</text>
  <g class="node blue"><rect x="384" y="68" width="142" height="32" rx="4"/><text class="mid" x="455" y="84">Pure-Human Firm</text></g>
  <g class="node orange"><rect x="538" y="68" width="142" height="32" rx="4"/><text class="mid" x="609" y="84">Pure-AI Firm</text></g>
  <path class="edge hot" d="M455 100 V112 H609 V100"/>
  <path class="edge hot" d="M532 112 V124" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="394" y="128" width="276" height="34" rx="17"/><text class="mid" x="532" y="145">Threshold: Pure-AI cost drops below human firm</text></g>
  <path class="edge hot" d="M532 162 V180" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="384" y="184" width="296" height="32" rx="4"/><text class="mid" x="532" y="200">Pure-human firms lose price competitiveness together</text></g>
  <text class="small accent" x="384" y="236">Pattern: Human firms keep full headcount until the threshold</text>
  <text class="small accent" x="384" y="256">Transition happens through firm exit rather than gradual cuts</text>
</svg>
<svg viewBox="0 0 340 570">
  <rect class="panel" x="0" y="0" width="340" height="275" rx="12"/>
  <rect class="panel" x="0" y="290" width="340" height="280" rx="12"/>

  <text class="caps" x="20" y="28">PATH A: GRADUAL REDUCTION (CONCAVE)</text>
  <text class="small" x="20" y="48">Complementary skills → concave → mixed firms</text>
  <g class="node blue"><rect x="20" y="66" width="300" height="32" rx="4"/><text class="mid" x="170" y="82">T1: Mixed firm (42% Human · 58% AI)</text></g>
  <path class="edge" d="M170 98 V114" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="20" y="118" width="300" height="32" rx="4"/><text class="mid" x="170" y="134">T2: Mixed firm (22% Human · 78% AI)</text></g>
  <path class="edge" d="M170 150 V166" marker-end="url(#arrow)"/>
  <g class="node teal"><rect x="20" y="170" width="300" height="32" rx="4"/><text class="mid" x="170" y="186">T3: Smooth reduction to 0% (pure-AI firm)</text></g>
  <text class="small" x="20" y="228">Pattern: Firms gradually reduce human share</text>
  <text class="small" x="20" y="248">Employment and wages adjust smoothly</text>

  <text class="caps" x="20" y="318">PATH B: SUDDEN FIRM EXIT (CONVEX)</text>
  <text class="small" x="20" y="338">Scale amplification → convex → firm separation</text>
  <g class="node blue"><rect x="20" y="356" width="144" height="32" rx="4"/><text class="mid" x="92" y="372">Pure-Human Firm</text></g>
  <g class="node orange"><rect x="176" y="356" width="144" height="32" rx="4"/><text class="mid" x="248" y="372">Pure-AI Firm</text></g>
  <path class="edge hot" d="M92 388 V399 H248 V388"/>
  <path class="edge hot" d="M170 399 V410" marker-end="url(#arrow)"/>
  <g class="node clay"><rect x="26" y="414" width="288" height="34" rx="17"/><text class="mid" x="170" y="431">Threshold: AI cost drops below human firm</text></g>
  <path class="edge hot" d="M170 448 V466" marker-end="url(#arrow)"/>
  <g class="node plain"><rect x="20" y="470" width="300" height="32" rx="4"/><text class="mid" x="170" y="486">Pure-human firms lose competitiveness together</text></g>
  <text class="small accent" x="20" y="524">Pattern: Full headcount right up to the threshold</text>
  <text class="small accent" x="20" y="544">Transition happens through firm exit at threshold</text>
</svg>
```

- When skill complementarity between humans and machines dominates, the envelope is **concave**, so mixed human-AI teams are the most efficient structure. As AI improves, each firm gradually reduces its human share internally, and aggregate employment adjusts smoothly.
- When coordination and scale economies dominate, the envelope becomes **convex**, so mixing humans and machines inside the same firm is inefficient. The market separates into pure-human firms and pure-AI firms. Until pure-AI firms cross the unit-cost threshold, pure-human firms remain fully staffed; once the cost threshold is crossed, pure-human firms are priced out of the market at the same time.

Figure 14 of the paper also shows that as AI coordination $y_*^M$ rises, an industry's envelope can shift from concave to convex. That means an industry can start with gradual internal adjustments inside mixed teams, and later switch to whole-firm replacement once scale economies take over.

---

## 5. Stage 4: When Both Competence and Coordination Cross the Line, Why Do Human Teams Still Exist in Niche Markets?

Now we reach the final stage of the model: AI has crossed both thresholds at once—solo task competence reaches $\theta = 12 > 9$ (above every human specialist), and coordination reaches $y_*^M = 1.05 > 1$ (giving AI clusters increasing returns to scale). The paper calls this **Artificial Superintelligence (ASI)**.

At this stage, the mainstream deep market is supplied entirely by a giant pure-AI enterprise, marginal production costs approach zero, and employment for human Coordinators drops to $0$.

Yet in the final column of the paper's numerical table (Table 2, column 4), a surprising detail appears:

**The 12 human Coders and Writers—even though ASI now scores higher than them on every individual skill—are still not completely unemployed.**

They have moved into the small **Niche Market (where total demand is capped at $Q = 200$)**, formed two 6-person pure-human firms, and earn a modest wage ($0.269$) slightly above their reservation floor ($0.25$). Even more surprisingly, these two human teams supply 88% of the niche market's output ($165.3$ units), while ASI supplies only the remaining $22.1$ units.

If ASI scores $12$ on coding (vs. $9$ for humans) and $1.05$ on coordination (vs. $0.75$ for humans), why doesn't it replace the human teams in the niche market as well?

The explanation combines **David Ricardo's principle of Comparative Advantage** with **market-size limits on scale economies**:

1. **A small market caps the size of a supercooperative cluster**: ASI's biggest cost advantage comes from increasing returns to scale ($y_*^M = 1.05 > 1$)—the larger the cluster, the higher the output per agent and the lower the unit cost. In a niche market where total demand is capped at $Q < 200$, however, market capacity limits how large any single firm can grow (a single indivisible firm's output cannot exceed total market demand, $q_f \le Q$). Inside such a small market, ASI cannot deploy a huge swarm; constrained to a small team size of $m \approx 3.66$, most of its scale advantage disappears.
2. **Compute has a fixed rental cost, while human wages can adjust down to the reservation floor**: Running an ASI instance requires paying a fixed compute rental rate of $r = 1$ (or giving up what that compute could earn in the mainstream market), whereas the human reservation wage floor is $\underline w = 0.25$. As long as human specialists are willing to work at a wage of $0.269$ (about a quarter of ASI's compute rental cost), a low-wage human mosaic team can still match the unit production cost of a high-rent, scale-capped ASI in a small niche market[@restrepo2025].

As the authors note in the text, this is a narrow boundary case right after ASI crosses the threshold, while compute rent $r = 1$ is still four times higher than the human reservation floor $\underline w = 0.25$. If ASI's solo competence continues rising from $12$ to $50$, or if compute rent $r$ falls below the human reservation wage, then by **Proposition 4(i) (Machine-only Production)**, that remaining comparative-advantage niche disappears too.

Putting all four stages together in one table shows the full progression of the paper's numerical model:

```data title="Equilibrium Comparison Across the Four Stages (Exact Numerical Values)" bars="Specialist Wage,Coordinator Wage" mark="Stage 3: Supercooperative" note="Data from Imas, Koh & Legg (2026), Table 2 and Section 2.2 (compute rental r = 1, human reservation wage w₀ = 0.25, 12 specialists and 2 coordinators). In the Stage 3 snapshot, AI solo competence is held at 1.69 to isolate the effect of coordination crossing 1.0."
Stage | AI Solo θ | AI Coord y* | Deep-Market Structure | Specialist Wage | Coordinator Wage | Coordinator Emp.
Pre-AI Baseline | 0 | 0 | 2 mixed human firms of 7 | 4.15 | 2.41 | 2.00 / 2
Stage 1: Minimal AGI | 1.69 | 0.78 | Human mixed + many 7-AI firms | 2.90 | 1.30 | 2.00 / 2
Stage 2: Supercompetent | 12.00 | 0.78 | Human-coordinator-led 7-AI firms | 0.39 | 0.48 | 2.00 / 2
Stage 3: Supercooperative | 1.69 | 1.60 | Single giant pure-AI firm | 0.41 | 0.25 | 0.97 / 2
Stage 4: ASI | 12.00 | 1.05 | Single giant pure-AI firm | 0.27 | 0.25 | 0.00 / 2
```

---

## 6. Stepping Outside the Model: Six Real-World Frictions Simplified Away by the Math

Bringing Coasean firm boundaries[@coase1937][@williamson1967] into general equilibrium gives _Organizing Intelligence_ much richer explanatory power than standard task-automation models[@acemogluRestrepo2018][@aghionJonesJones2019] (in fact, **Theorem 3** in Section 7.1 proves that if returns to scale are fixed at $\gamma \equiv 1$, the model simplifies directly into the classic Acemoglu-Restrepo task model, where firm size and organizational structure drop out).

Still, every mathematical model simplifies reality to obtain clean closed-form proofs. If we want to apply this framework to the real economy, it helps to examine six places where the paper's assumptions set aside major real-world frictions:

```sketch title="Theoretical Model vs. Real World: Six Institutional and Physical Frictions Simplified Away" note="The paper's model assumptions ensure equilibrium existence and analytical solutions; real-world constraints and frictions will modify or slow down the four-stage progression."
<svg viewBox="0 0 704 316">
  <rect class="panel" x="0" y="0" width="344" height="316" rx="12"/>
  <rect class="panel" x="360" y="0" width="344" height="316" rx="12"/>

  <text class="caps" x="24" y="28">MODEL ASSUMPTIONS</text>
  <g class="node plain"><rect x="24" y="48" width="296" height="36" rx="4"/><text class="mid" x="172" y="66">1. Coordination is a flat arithmetic mean</text></g>
  <g class="node plain"><rect x="24" y="92" width="296" height="36" rx="4"/><text class="mid" x="172" y="110">2. Single homogeneous AI model</text></g>
  <g class="node plain"><rect x="24" y="136" width="296" height="36" rx="4"/><text class="mid" x="172" y="154">3. Infinite compute supply at fixed rent r</text></g>
  <g class="node plain"><rect x="24" y="180" width="296" height="36" rx="4"/><text class="mid" x="172" y="198">4. Contestable market: zero monopoly profit</text></g>
  <g class="node plain"><rect x="24" y="224" width="296" height="36" rx="4"/><text class="mid" x="172" y="242">5. Output depends only on skills; no legal friction</text></g>
  <g class="node plain"><rect x="24" y="268" width="296" height="36" rx="4"/><text class="mid" x="172" y="286">6. Exogenous demand decoupled from wages</text></g>

  <text class="caps" x="384" y="28">REAL-WORLD CONSTRAINTS &amp; FRICTIONS</text>
  <g class="node blue"><rect x="384" y="48" width="296" height="36" rx="4"/><text class="mid" x="532" y="66">1. Pyramid hierarchy: top architects lever firm</text></g>
  <g class="node teal"><rect x="384" y="92" width="296" height="36" rx="4"/><text class="mid" x="532" y="110">2. Heterogeneous AI builds machine mosaics</text></g>
  <g class="node orange"><rect x="384" y="136" width="296" height="36" rx="4"/><text class="mid" x="532" y="154">3. Chip &amp; power limits: compute rent rises</text></g>
  <g class="node clay"><rect x="384" y="180" width="296" height="36" rx="4"/><text class="mid" x="532" y="198">4. Entry barriers: giants earn monopoly profits</text></g>
  <g class="node violet"><rect x="384" y="224" width="296" height="36" rx="4"/><text class="mid" x="532" y="242">5. Legal liability requires a natural person</text></g>
  <g class="node clay"><rect x="384" y="268" width="296" height="36" rx="4"/><text class="mid" x="532" y="286">6. Macro demand loop: falling wages cut buying</text></g>
</svg>
<svg viewBox="0 0 340 645">
  <rect class="panel" x="0" y="0" width="340" height="315" rx="12"/>
  <rect class="panel" x="0" y="330" width="340" height="315" rx="12"/>

  <text class="caps" x="20" y="28">MODEL ASSUMPTIONS</text>
  <g class="node plain"><rect x="20" y="48" width="300" height="36" rx="4"/><text class="mid" x="170" y="66">1. Coordination is a flat arithmetic mean</text></g>
  <g class="node plain"><rect x="20" y="92" width="300" height="36" rx="4"/><text class="mid" x="170" y="110">2. Single homogeneous AI model</text></g>
  <g class="node plain"><rect x="20" y="136" width="300" height="36" rx="4"/><text class="mid" x="170" y="154">3. Infinite compute supply at fixed rent r</text></g>
  <g class="node plain"><rect x="20" y="180" width="300" height="36" rx="4"/><text class="mid" x="170" y="198">4. Contestable market: zero monopoly profit</text></g>
  <g class="node plain"><rect x="20" y="224" width="300" height="36" rx="4"/><text class="mid" x="170" y="242">5. Pure skill production; no legal friction</text></g>
  <g class="node plain"><rect x="20" y="268" width="300" height="36" rx="4"/><text class="mid" x="170" y="286">6. Exogenous demand decoupled from wages</text></g>

  <text class="caps" x="20" y="358">REAL-WORLD FRICTIONS</text>
  <g class="node blue"><rect x="20" y="378" width="300" height="36" rx="4"/><text class="mid" x="170" y="396">1. Hierarchy: top architect levers firm</text></g>
  <g class="node teal"><rect x="20" y="422" width="300" height="36" rx="4"/><text class="mid" x="170" y="440">2. Multi-model ensembles build AI mosaics</text></g>
  <g class="node orange"><rect x="20" y="466" width="300" height="36" rx="4"/><text class="mid" x="170" y="484">3. Chip &amp; power limits: rising compute rent</text></g>
  <g class="node clay"><rect x="20" y="510" width="300" height="36" rx="4"/><text class="mid" x="170" y="528">4. Entry barriers &amp; monopoly pricing</text></g>
  <g class="node violet"><rect x="20" y="554" width="300" height="36" rx="4"/><text class="mid" x="170" y="572">5. Liability: AI cannot sign as a legal person</text></g>
  <g class="node clay"><rect x="20" y="598" width="300" height="36" rx="4"/><text class="mid" x="170" y="616">6. Macro demand: lower wages reduce buying</text></g>
</svg>
```

### 6.1 The Arithmetic-Mean Assumption Ignores Pyramid Hierarchies

The paper's **Assumption 2 (First-moment Representation)** states that a firm's ability to scale depends only on the **arithmetic mean** of all members' coordination scores, $\bar y_* = m^{-1} \int y_* \,\mathrm{d}\nu$.

Mathematically, this keeps the equations clean, but real organizations are not flat circles where everyone contributes equally to coordination. They are structured as decision and knowledge pyramids (Knowledge Hierarchies)[@garicano2000][@garicanoRossiHansberg2006].

Under a flat arithmetic average, putting 1 human chief architect on top of 10,000 AI agents gives the human a weight of $1/10,000$, which makes almost no difference to the mean. In a tree-structured hierarchy, however, top-level architects define modular interfaces, set task boundaries, and specify evaluation criteria, giving a small number of people at the top leverage over the whole system. Flattening the firm into a simple average causes the model to predict the exit of top human coordinators earlier than a hierarchical model would.

### 6.2 The "Single AI Model" Assumption Overstates How Long Human Mosaic Advantage Lasts

In Stage 1, human teams outperform Minimal AGI through "Mosaic Intelligence" because the model assumes **the economy has only one homogeneous AI model $\mathbf{y}^M$** (Section 3.1), so combining multiple AI instances leaves their strengths and weaknesses identical.

In practice, no company is forced to use a single model checkpoint for every role. Engineering teams routinely combine a code-specialized agent, a security-auditing agent, and a documentation agent inside the same workflow.

Once **heterogeneous AI models** with different specializations are combined, AI teams can form their own "machine mosaic intelligence." That means the human specialist advantage described in Stage 1 will likely narrow faster in practice than a single-model baseline suggests.

### 6.3 The Fixed Compute Rent Assumption Sets Aside Chip and Power Bottlenecks

The model assumes machine compute is **supplied with infinite elasticity** at a fixed rental rate $r > 0$. That assumption is what allows a single giant AI enterprise in Stage 3 ($\gamma^M > 1$) to spin up massive numbers of concurrent instances immediately and absorb the whole market.

In the physical world, advanced packaging capacity, high-bandwidth memory (HBM), and data-center power connections face hard short- and medium-term limits. When many firms try to scale up large AI clusters at the same time, the compute rental rate $r(Q^M)$ rises along an upward-sloping cost curve.

**Physical bottlenecks in chips and power slow down how fast giant AI clusters can expand, while shifting what used to be human "skill scarcity rents" into "infrastructure scarcity rents" for owners of compute and energy.**

### 6.4 The Contestable-Market Assumption Overstates How Much Monopoly Giants Pass Gains to Consumers

To guarantee that a competitive equilibrium exists even when a single giant firm takes over an industry, the paper uses an equilibrium definition based on a **Replacement Game** and contestable market theory[@demsetz1968][@baumolPanzarWillig1982] (Section 4.1 and Appendix B): even if one pure-AI firm controls 100% of the market, the threat that an entrant could duplicate the cluster forces the incumbent to **earn zero economic profit**, passing all cost reductions to consumers through near-zero prices.

As the authors note in Section 5.2, this is a theoretical baseline. In actual markets, once a firm captures most of an industry, compute scale, proprietary data, and switching costs quickly build entry barriers. Without frictionless entry, a dominant firm has strong incentives to charge monopoly prices and retain excess profits rather than operating at zero profit.

### 6.5 The Production Function Leaves Out Legal Liability Tied to Natural Persons

In the model's production function $F(\nu)$, whenever a machine team produces more output per dollar, firms replace human workers with machines.

In real commercial life, however, many roles—such as certified public accountants, attending physicians, law firm partners, chief engineers, and compliance officers—exist not only to produce analysis, but also to **bear legal and regulatory liability**.

An AI system is not a legal person, cannot bear criminal liability, and holds no personal assets to back malpractice claims. As long as legal and regulatory frameworks require a natural person to sign off and stand accountable for high-stakes decisions, humans will remain in the workflow as responsible signatories and reviewers even when AI outperforms them on both $\theta$ and $y_*$.

### 6.6 The Partial-Equilibrium Setup Cuts Off the Macro "Wages-to-Demand" Loop

Finally, like many industrial-organization models, the paper works in a partial-equilibrium setting where the market demand curve $P_N(Q)$ is fixed from the outside and does not depend on workers' wages.

In Stages 1 and 2, this simplification is minor. By Stages 3 and 4, however, Coordinator wages have dropped to the reservation floor $\underline w$, specialist wages have fallen close to $\underline w$, and firms earn zero profit.

Unless the economy introduces mechanisms outside the model—such as broad ownership of compute capital or fiscal transfers—a sharp drop in labor income across the workforce would reduce aggregate consumer purchasing power, making it impossible to sustain the high exogenous demand curve $P_N(Q)$ assumed in the equations.

---

## 7. Summary: Two Metrics for Watching What Comes Next

Taken together, the paper's derivations and its real-world boundary conditions give us a clear lens for watching how AI changes the economy.

Over the past few years, whenever a new model was released, attention naturally went to how many points it gained on single-agent benchmarks like MMLU, GPQA, or SWE-bench.

From the perspective of organizational economics, however, **higher individual task competence ($L$) mainly lowers product prices, trims redundant layers inside large companies, and increases the relative value of human coordinators who know how to break down problems and manage context boundaries. On its own, solo task skill does not determine how large firms can grow.**

The metric that governs whether industry structure undergoes a fundamental shift is the **multi-agent coordination exponent $\gamma^M$**.

As long as $\gamma^M$ remains below $1$, putting more AI agents together still runs into context loss and coordination friction. Firm size stays bounded, and humans with different strengths continue to find valuable roles through skill complementarity and organizational coordination inside small and mid-sized mixed teams.

Only when hundreds or thousands of AI instances can collaborate over long time horizons on complex projects such that **a larger swarm achieves higher effective output per agent ($\gamma^M > 1$)** does the Coasean ceiling truly give way.

Until then, rather than competing head-to-head with models on standardized solo test-taking, it makes much more sense to practice breaking down messy problems and coordinating across people and specialized tools. When isolated task skills can be copied cheaply, the real value lies in how you organize them.

---

## References

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
