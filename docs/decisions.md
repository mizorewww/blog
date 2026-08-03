# 架构决策记录

本文件按时间记录项目的重要架构决策。每条决策包含背景、决策和后果；被取代的决策保留原文位置并标注去向。当前的规范性描述以 [architecture.md](./architecture.md) 为准，本文件回答"为什么这样做"。

## ADR-0001 Agent 工作流与文档治理

日期：2026-06-23

**背景**：仓库需要一套 agent 开发流程，避免把文档、计划、清单当作实现完成，也需要统一何时调研外部资料、何时采用库、何时记录架构决策。

**决策**：建立 subagent 编排流程：调研、规划、实现、评审分角色执行，确定性门禁（lint、typecheck、测试等）的权威高于 LLM 判断，评审只有 `FEASIBLE` / `NOT_FEASIBLE` 二元结论；重要决策写 ADR。

**后果**：2026-07 流程从 9 个角色精简为 3 个（planner / implementer / reviewer），ADR 目录合并为本文件，文档元数据门禁随之移除。现行规则见 [AGENTS.md](../AGENTS.md)。

## ADR-0002 确定性脚本检查与性能门禁

日期：2026-06-23

**背景**：`yarn typecheck` 只覆盖 Next.js 应用与 Contentlayer 类型，维护用的 JS/MJS 脚本没有 TypeScript 检查；性能回退（路由输出、图片、静态资源、第三方依赖）也缺少确定性拦截。

**决策**：增加 `yarn typecheck:scripts`（独立 tsconfig 对脚本启用 `checkJs`）和 `yarn perf:check`（生产构建 + 静态 HTML 质量检查 + 资源预算）。性能敏感改动必须通过后者。

**后果**：脚本质量和静态产物体积有了可复现的门禁；两者至今仍是提交前的必跑项。

## ADR-0003 移除浏览器端 MDX 求值

日期：2026-06-23

**背景**：列表页展开文章时曾把 Contentlayer 编译后的 MDX runtime code 作为 JSON 发到浏览器，在客户端重建正文。这需要 CSP 放行 `eval`，且无法正确 hydration 正文里的交互组件。

**决策**：文章正文只通过构建期生成的 MDX 模块在文章路由的服务端边界（`MDXServerRenderer`）渲染；列表 RSC payload 只携带可序列化的卡片数据，不含正文和编译后代码；CSP 不为文章渲染开放 eval。

**后果**：浏览器不再执行 MDX runtime code，列表/文章的数据边界明确。此约束至今有效，由构建后检查和 e2e 共同保证。

## ADR-0004 测试设施与 term 显示名保留

日期：2026-06-23

**背景**：路由优先的阅读架构依赖真实导航、history、滚动恢复和禁用 JavaScript 行为，静态检查无法验证；同时分类/标签只用 slug 作为键，丢失了 `Next.js` 这类原始显示名。

**决策**：引入 Vitest（单元）+ Playwright（浏览器）双层测试；term 数据模型同时保留 slug（路由用）和原始 label（展示、aria、metadata、JSON-LD 用）。

**后果**：浏览器行为合同有了自动化验证；term 路由为 slug 形式（如 `nextjs`），页面显示原始名称。

## ADR-0005 采用 Animata 动效方案（已被 ADR-0007 取代）

日期：2026-06-23，2026-07-10 被取代

**背景**：文章展开/收起、滚动定位和 loading 动效散落在手写工具里，混合了业务状态和 RAF 动画循环；内部链接使用普通锚点，页面切换有整页刷新闪烁。

**决策**：以复制源码的方式引入 Animata 组件（`components/animata/`），用 `motion` 统一页面切换、卡片 reflow、loading 等动效，内部链接改用 Next.js `Link`。

**后果**：动效有了统一所有者。但其中"文章作为列表卡片展开"的所有权模型随后被证明有结构性缺陷，由 ADR-0007 重新决策。Motion 与 Animata 组件仍保留，只用于 ADR-0007/0008 允许的有界动效。

## ADR-0006 采用 Pagefind 静态搜索

日期：2026-07-04

**背景**：博客没有搜索功能；站点是纯静态导出，搜索必须无服务端依赖。

**决策**：采用 Pagefind。构建后处理先校正导出 HTML 的 `<html lang>`，再运行 Pagefind 生成索引；浏览器在 `/[locale]/search/` 页面按需加载 Pagefind runtime，中英文自动分索引。FlexSearch、Fuse.js、Algolia DocSearch 分别因手动索引管线、非全文定位、外部服务依赖被否决。

**后果**：搜索零服务依赖、双语自动支持；索引每次构建重新生成，搜索资源只在搜索页加载。

## ADR-0007 路由优先的文章阅读

日期：2026-07-10（取代 ADR-0005 的文章/列表所有权部分）

**背景**：此前的"列表内展开文章"模型有结构性失败：直达文章 URL 会先渲染无关卡片；关闭按钮可能离文章标题几千像素，且可能在没有站内来源时调用 Back 离开站点；长文高度插值动画让布局开销与文档长度成正比。

**决策**：文章 URL 是独立阅读页，不是列表卡片的展开状态。

- 列表路由只渲染卡片数据，文章路由只渲染当前文章、TOC 和相邻导航；正文在静态 HTML 中默认可见，不依赖 JavaScript、hydration 或动画。
- 返回控制默认指向本地化首页；只有同标签页、同源、同 locale 的一次性来源凭证与当前文章精确匹配时才用 `history.back()`，凭证在 hydration 时验证并立即清除。
- 浏览器和 Next.js 是滚动的唯一所有者：不用 `scroll: false`、不保存 scrollY、不做延迟恢复。
- 动效限两档（fast 160-180ms / standard 200-220ms），位移不超过 8px；正文不做高度展开、透明度门控或退出折叠。
- 本地化祖先、文章、分类/标签路由不设 `loading.tsx`（静态导出的 streaming fallback 会在禁用 JS 时藏住最终内容）。

**后果**：直达、刷新、无脚本阅读都直接得到可读正文；返回行为确定且安全。后续 ADR-0008 在不动正文所有权的前提下补充了一个纯视觉的卡片转场层。

## ADR-0008 App Store 风格文章卡片转场

日期：2026-07-10，2026-07-11 修订（修正 ADR-0007 的覆盖层形态、时长/位移上限和打开交接期的像素可见性条款）

**背景**：ADR-0007 解决了内容所有权，但打开文章时的 skeleton 无法保持"所选卡片"与"目标文章"之间的视觉连续性。目标是在不恢复列表内展开的前提下，提供 iOS App Store 式的卡片 morph 引导。

**决策**：在路由之上增加一个纯表现层，使用已安装的 Motion，不新增依赖：

- 快照是 fixed、`aria-hidden`、`pointer-events: none` 的结构化 React 元素，由最小卡片字段和实测矩形重建，不 `cloneNode()`、不复制正文；打开 380ms、验证返回 340ms，easing `[0.32, 0.72, 0, 1]`。
- `PostCard`、快照与 `PostLayout` 共享头部消费同一展示合同：surface、cover、title、Git 更新时间、源码入口、summary、date、primary tag、read-more 分别建模、逐 child 投影，禁止 opacity crossfade 交接。
- 已验证的完整卡片打开可在目标提交后于快照背后加 fixed/inert/opaque underlay，直到路由与卡片动画同时 ready；destination-only 头部元素可在交接后以 180ms reveal。正文及其祖先不属于该标记合同，始终静态可见。
- 导航不等动画：Link 立即执行，返回立即执行；缺数据、无效矩形、resize、中断等一律立即退化为普通导航。reduced motion 只保留极短提示。

**后果**：完整卡片有连贯的视觉引导，直达/刷新/无脚本路径完全不受影响；搜索和侧栏来源使用单篇 skeleton 快照。转场合同细节见 [architecture.md](./architecture.md#文章卡片转场)。

## ADR-0009 稳定根布局与本地服务器一致性

日期：2026-07-10 之后

**背景**：文档根布局曾在 `[locale]` 动态段下，Next.js 15.5 开发服务器处理根级未知路由时缺少稳定的 `html`/`body` 所有者；开发服务器与静态 preview 各自实现重定向，wildcard、Unicode 和 trailing slash 行为可能不一致。

**决策**：

- `app/layout.tsx` 作为唯一文档根（服务端组件），`[locale]/layout.tsx` 只管静态参数与 metadata。
- 语言由两层机制保证：`app/localized-html.tsx` 按 pathname 同步浏览器文档的 `lang`；构建后处理在 Pagefind 索引前校正每个导出 HTML 的 `<html lang>`。
- 根级与 locale 级 `not-found.tsx` 共用 `components/NotFoundPage.tsx`；parity 合同是浏览器可观察的 status、title、lang、文案和链接，不要求响应字节一致。
- `public/_redirects` 是历史 URL 重定向的唯一权威来源，开发服务器和 Caddy preview 用同一 parser 读取；新增 `yarn test:e2e:parity` 作为双服务器一致性门禁。

**后果**：开发与 preview 的路由行为可对齐验证；导出文档和搜索索引的语言正确。

## ADR-0010 Coding Agent 撰写博客流程

日期：2026-08-03

**背景**：博客内容由 MDX/MD 文件驱动，frontmatter 字段、slug 规则、多语言关联和构建验证已有明确约定，但 agent 缺少标准化的写作入口；同时希望引入中文文本润色能力，提升文章自然度。

**决策**：

- 新增 `yarn write-blog` CLI（`scripts/write-blog.mjs`），提供 `create` 子命令统一生成博客文件：
  - 校验 `--locale`（zh/en）、必填 `--title`、可选 `--slug`（中文标题必须显式提供）。
  - 生成 `date` 默认为当天，支持 `summary`、`categories`、`tags`、`translationKey`、`authors`、`image`、`draft`。
  - 输出符合 `docs/content.md` 规范的 YAML frontmatter。
  - 创建 `content/blog/{locale}/{slug}.md` 后自动运行 `yarn content:generate` 验证。
- 新增 agent 指令 `.agents/instructions/write-blog.md`，定义从选题、生成 frontmatter、撰写正文、humanizer-zh 润色、构建验证到提交的完整博客撰写流程。
- 以 vendored 形式引入 `humanizer-zh`（`.agents/skills/humanizer-zh/`），作为 Claude Code Skill 供 agent 在润色中文文本时引用；它不是 npm 包，不加入 `package.json` dependencies。
- 简化 `package.json` 开发脚本：新增 `format` 别名，将 `check` 调整为失败更快的顺序，同时保留 AGENTS.md 要求的所有确定性门禁命令。

**后果**：agent 撰写博客有统一入口和校验流程；`humanizer-zh` 的规则可被 agent 主动应用，但因其为 prompt-based skill，润色质量仍依赖 agent 正确读取并执行；vendored skill 需要手动更新。中文标题不会自动生成拼音 slug，必须显式传入 `--slug`。
