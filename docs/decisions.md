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

日期：2026-07-10，2026-07-11 修订（修正 ADR-0007 的覆盖层形态、时长/位移上限和打开交接期的像素可见性条款），2026-08-21 修订（卡片意图先淡入页面色 underlay 再 morph；返回同样使用 underlay，并在卡片回位后淡出）

**背景**：ADR-0007 解决了内容所有权，但打开文章时的 skeleton 无法保持"所选卡片"与"目标文章"之间的视觉连续性。目标是在不恢复列表内展开的前提下，提供 iOS App Store 式的卡片 morph 引导。

**决策**：在路由之上增加一个纯表现层，使用已安装的 Motion，不新增依赖：

- 快照是 fixed、`aria-hidden`、`pointer-events: none` 的结构化 React 元素，由最小卡片字段和实测矩形重建，不 `cloneNode()`、不复制正文；打开 380ms、验证返回 340ms，easing `[0.32, 0.72, 0, 1]`。
- `PostCard`、快照与 `PostLayout` 共享头部消费同一展示合同：surface、cover、title、Git 更新时间、源码入口、summary、date、primary tag、read-more 分别建模、逐 child 投影，禁止 opacity crossfade 交接。
- 已验证的完整卡片意图从第 0 帧在快照背后淡入 fixed/inert 页面色 underlay（160ms / easeOut），卡片保持来源矩形；underlay 不透明后再 morph。目标提交后另加一层不透明 commit barrier，直到路由与卡片动画同时 ready，但不提前启动 morph。返回在 waiting/returning 同样淡入 underlay，卡片回位后再淡出。destination-only 头部元素可在交接后以 180ms reveal。正文及其祖先不属于该标记合同，始终静态可见。
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

## ADR-0011 采用 remark-math + rehype-mathjax 构建期公式渲染

日期：2026-08-03

**背景**：文章需要排版数学公式（如成本建模），站点是纯静态导出，公式渲染必须零客户端 JS、零额外 CSS/字体资产。候选方案是 KaTeX（rehype-katex）与 MathJax（rehype-mathjax）。

**决策**：

- 采用 remark-math 解析 `$$` 公式语法，rehype-mathjax（`rehype-mathjax/svg` 子路径）在构建期把公式渲染成内联 SVG。渲染引擎是 mathjax-full（MathJax v3，Apache-2.0，10,889 stars，2026-08-03 查询）。
- 用户明确否决 KaTeX，选择 MathJax。
- remark-math / rehype-mathjax 来自 remarkjs/remark-math monorepo（MIT，514 stars），低于 1,000 stars 门槛；豁免理由：unified collective 官方数学插件，生态内无替代品，渲染引擎本身达标。用户已知悉并接受。
- remark-math 配置 `singleDollarTextMath: false`：仓库有 `$AAPL` ticker shortcode（remarkTradingViewWidgets）和 `$0.0028` 这类货币文本，不禁用单 `$` 会被误解析为行内公式；行内公式改用同一行内的 `$$...$$` 书写。
- 选 SVG 输出而非 CHTML：零 CSS、零字体文件、零资产预算影响，SVG 用 `currentColor` 跟随明暗主题。
- 插件顺序：rehype-mathjax 必须排在 rehype-pretty-code 之前（math 插件整体替换 `language-math` 节点，pretty-code 会把渲染产物当代码破坏）。

**后果**：公式在构建期渲染为内联 SVG，无运行时成本；单 `$` 保持字面值，ticker 与货币文本不受影响；LaTeX 语法错误不会中断构建，公式位置渲染出带错误说明的标记（`merror`），需要作者目视检查。用法见 [content.md](./content.md#数学公式)。

## ADR-0012 本地 Playwright UI 截图流程

日期：2026-08-04

**背景**：UI/UX 改动需要可重复的渲染证据，但当前仓库没有视觉快照门禁。直接引入新的视觉回归服务或图片对比库会扩大依赖面，也容易把局部 polish 变成脆弱的 CI 截图维护成本。

**决策**：

- 复用现有 `@playwright/test`，新增 `yarn ui:screenshots` 本地命令，通过 Chromium 捕捉代表性首页、文章、搜索、分类和 404 页面。
- 截图默认访问已启动的静态 preview，覆盖 desktop `1440x900` 与 mobile `375x812`，默认 dark theme，可用参数切换 light/both、页面集合、viewport、locale、文章路径和 base URL。
- 文章阅读检查支持局部页面键：`article-top`、`article-math`、`article-code`、`article-toc`、`article-image`、`article-bottom`。`compact` viewport 固定为 `320x812`，用于验证 320px reflow。
- 截图输出到 `docs/agent-records/screenshots/<label>/`。该目录由本机 agent 记录使用，通过 Git ignore 机制保持不提交。
- 截图与 probe 输出必须限制在 `docs/agent-records/` 内；路径越界直接失败。截图捕捉使用 reduced motion，并在每次导航后确认根节点主题 class，再等待 Header 与主内容动画稳定后保存。
- 不新增依赖，不把截图作为 source-controlled snapshot，也不把图片对比加入 CI gate。确定性质量仍由 format、lint、typecheck、unit、e2e、deadcode 和 perf 检查负责。

**后果**：UI 审阅可以获得稳定、可复跑的本地截图证据，同时仓库不承担图片资产 churn 和视觉像素差异门禁。脚本只负责捕捉；服务未启动、响应码异常或页面未到达预期状态时直接失败。

## ADR-0013 文章阅读系统优先级

日期：2026-08-04

**背景**：文章页是博客的核心使用路径。旧布局把 16:9 大封面、标题卡、更新时间/source、额外作者/标签/commit 详情和移动 TOC 都放在正文之前，导致首段在 `1440x900` 与手机 viewport 中都靠后出现。MDX 中的行间公式、代码块控件、长目录标题和标题锚点也分别存在 320px 重排问题。

**决策**：

- 文章 header 只保留阅读决策必需信息：封面、标题、更新时间/source、摘要、发布日期和主标签。作者、次级标签和 commit 列表移到正文后的 `details` 区域。
- 文章封面改为阅读页专用比例：`320px`/手机宽度下约 `2:1`，`640px` 以上约 `2.8:1`。列表卡片仍使用自己的卡片比例，`ArticleCardPresentation` 通过 `variant` 显式区分卡片与文章页样式，转场 overlay 在 source/destination 间切换对应 variant。
- 正文使用 `article-prose` 作用域承载长文排版。正文测量保持在 60-75ch 范围内；普通段落、列表、标题、引用、脚注等不得制造页面级横向滚动。
- 代码块、表格和行间 MathJax 是允许二维内容的例外，只能在自身容器内横向滚动。复制控件放在代码前的工具行，复制失败必须显示并宣告可恢复提示。
- 标题锚点不再依赖负向位移或 hover-only 发现；hash 跳转目标保留固定 header offset。桌面 TOC 长标题允许换行，不再单行截断。
- 内容图片必须有符合用途的 alt；Markdown 图片继承文章内圆角和黑/白低透明 outline，有 title 时显示 caption。

**后果**：文章首屏优先给正文让路，辅助信息仍可访问；MDX 元素在 320px reflow 下通过内部滚动处理宽内容，页面根部保持单向滚动。转场、TOC、代码复制、MathJax 和图片行为由 article e2e 几何/行为断言覆盖，截图只作为人工审阅证据。

## ADR-0014 全站发现界面与工具化 UI 量化

日期：2026-08-04

**背景**：文章阅读系统完成后，剩余问题集中在发现与全局 shell：移动 header 视觉拥挤但必须保留 44px 关键命中区；首页首卡在 `375x812` 中约 `394px` 高，首屏只能扫到约一张卡；搜索初始态标题、输入和空白垂直占用偏大；分类/标签 chip 约 `55px` 高并形成同权重的"药丸墙"；桌面左右侧栏与主列表共用强卡片 chrome，削弱主列表优先级。

**决策**：

- 移动 header 的语言切换改为单一"切到另一语言"按钮；桌面保留双段语言切换。Logo、主题、菜单、RSS 和页脚社交链接使用真实可量化的目标盒，移动关键控件保持 `44px` 以上，桌面 RSS 至少 `40px`。
- 列表卡片和文章页头部分离密度：`ArticleCardPresentation` 的 card variant 更紧凑并限制摘要行数，文章 variant 保留 Phase 1 的阅读层级。列表封面在移动端使用更浅比例，文章转场 marker 与图片性能属性保持不变。
- 侧栏 widget 改为低视觉权重 surface：更轻的背景、ring/shadow、标题和统计文本，让中间主列表成为桌面首要视觉对象。侧栏分类/tag 链接仍保持 `44px` 可点击盒，内部文字可更轻。
- 搜索页保留稳定 live region、`aria-busy` 和 Pagefind 静态搜索路径，同时压缩初始态垂直占用，补齐输入提示文案、结果/空/错误视觉状态和 320px 几何断言。
- 分类/标签 index chip 使用紧凑视觉层级，保持 `44px` 点击盒、长词断行、current/link 语义和 locale 路径。
- Header 的移动 disclosure 覆盖 `<1024px`，桌面导航从 `lg` 开始显示，防止中文导航在 640px/768px 和 200% reflow 宽度下被挤成竖排；RSS 和双段语言切换同步到同一断点。
- 分类/标签 detail 页面显示紧凑的上下文标题（如 `分类：折腾`、`#Linux`），不再只有屏幕阅读器标题；404 页面在移动端顶端对齐，让错误码、说明和返回链接都进入首屏。
- Footer 元信息按语义单元换行，commit badge 自身不带行首分隔符，避免窄屏出现孤立标点。
- `AppShell` 在客户端 route change 后把焦点移到 `main`，使用 `preventScroll` 避免破坏浏览器/Next.js 的滚动所有权。
- 本地 UI 工具从截图扩展到可复现的数值 probe。截图继续保存在 ignored agent records，不成为 CI 像素门禁；行为由 e2e 几何、状态和可访问性断言负责。

**后果**：发现页在移动端能更快扫到多篇文章，搜索和 term 页面状态更明确，桌面侧栏不再与主列表争夺同等权重。由于 header、route focus、搜索、term 和 screenshot/probe 工具都涉及交互或静态 preview，相关改动必须跑 `test:e2e` 和 `perf:check`。

## ADR-0015 Reading Max 长文排版与本地证据合同

日期：2026-08-04

**背景**：文章页仍存在两个会直接影响长文阅读的问题：普通正文在实际渲染中落回 `16px / 28px` 的弱层级，暗色 inline code 仍使用浅色 token；同时缺少覆盖 `1280`、`1728`、`1920`、真实 200% 文本缩放和 Markdown family 的确定性检查。

**决策**：

- `article-prose` 成为文章正文排版唯一源，使用比 Tailwind Typography 默认更高的作用域优先级覆盖正文、标题、inline code、列表、引用、表格、图片、脚注和 details 等样式；Shiki fenced code 继续由代码块组件与高亮主题控制。
- 普通正文使用响应式阅读字号与 `1.65` 行高。英文正文 measure 以 `40rem` 为上限，中文通过 `html:lang(zh)` 放宽到 `46rem`，以实测字符行长同时满足中英文阈值（rail 上限后续由 ADR-0016 修订为 49rem/56rem）。
- 暗色 inline code 使用正文专用暗色 foreground/background/border token，显式清除浅色 gradient；链接里的 inline code 复用同一 surface 和 border，仅前景色进入链接角色。每个暗色 inline code 对比度必须不低于 `4.5:1`。
- 本地 `ui:screenshots` 与 `ui:probe` 复用 Playwright，不新增视觉测试依赖。截图和 JSON 只写入 `docs/agent-records/reading-max/`；测试用 Markdown fixture 来自共享 `scripts/reading-fixture.mjs`，不加入公开内容或路由。
- E2E 以计算后的几何和样式为准，覆盖中英文 320-1920px line measure、首段可见高度、wide TOC、dark inline code、真实 rich article 的 code/table/MathJax 内部滚动、200% 文本缩放和 Markdown family fixture。

**后果**：文章页的阅读宽度、字号、暗色 code surface 和 Markdown family 行为可由浏览器测试与本地 evidence 复现；截图仍用于人工目视检查，不进入 source-controlled 像素门禁。后续改变正文排版、代码块、表格、MathJax、图片或文章布局时，需要同步更新 Reading Max 阈值或重新采集 evidence。

## ADR-0016 文章共享阅读 Rail 与宽屏 TOC 光学平衡

日期：2026-08-04，2026-08-17 修订（rail 上限 49rem/56rem、≥1024px 正文 rail 贴左、表格改 fit-content 紧凑、布局常量收敛至 lib/articleLayout.ts、DOM wrapper 扁平化）

**背景**：Reading Max 后，文章页仍有多条横向参照线：header/body、正文段落、代码块、表格、MathJax、图片、license、文章详情和上下篇导航分别由不同 padding 或 `max-width` 控制。宽屏 TOC 从 `1280px` 开始贴在正文右侧时，容易让主阅读列随辅助导航一起偏离视口中心；代码、表格和行间公式虽可内部滚动，但边缘提示不一致。

**决策**：

- `article-reading-surface` 暴露 `--article-rail-width`，`article-content-rail` 与文字类 `article-prose` 直接子元素共用同一 rail。英文 rail 上限为 `49rem`，中文为 `56rem`；移动和 `640px` 附近由响应式 gutter 控制。宽元素（`pre`、Shiki figure、图片 figure、行间 MathJax）在 surface 内 breakout 到 `calc(100% - 2 * gutter)`，`figcaption` 与文字元素仍保持 rail。表格单独使用 `fit-content` 紧凑尺寸、左对齐，仅在超出 breakout 上限时容器内横向滚动，不再全宽 breakout。布局常量的编译期唯一来源是 `lib/articleLayout.ts`，`css/tailwind.css` 的 `.article-shell` 自定义属性以 `/* Keep these tokens in sync with lib/articleLayout.ts */` 同步。
- 正文直系文字 block family、`.article-data-block`、脚注、license notice、文章详情和上下篇导航都以首段外边缘为对齐基准。二维内容仍只允许容器内部横向滚动，但容器本身可以比 rail 更宽。
- 桌面 TOC 从 `1024px` 开始显示，位于左侧，宽 `256px`、距 surface `36px`。`article-shell` 上限为 `1440px` 并在视口居中；surface 不再固定 `780px`，而是占据 shell 右侧剩余栏宽。正文 rail 在 surface 内贴左对齐（左缘 = surface 左缘 + gutter），TOC 不参与 rail 对齐计算。
- `1024px` 及以上必须保留可见左侧 TOC，并贴齐居中 `article-shell` 的左缘。文章打开转场和 skeleton 的目标 geometry 使用同一个 surface 合同：`<640px` 全宽、`640–1023px` 居中 shell、`≥1024px` 为 shell 减去 `292px` 后的右侧栏。
- 表格、行间 MathJax、plain pre 和 Shiki pre 使用相同的 local/scroll gradient 边缘提示，明暗色由 article surface 变量控制。
- test-only fixture 覆盖 fixture embed、plain pre 和脚注 backref；`ui:probe` 的顶层 `readingAlignment` 节点输出 edge delta、rail delta、surface/text center offset、text left inset（textLeftInset）、页面 overflow、TOC 宽度/间距/左侧边距、TOC label overflow、200% 文本缩放和 scroll affordance failure summary。

**后果**：文章阅读页只有一条正文 rail，宽屏时正文 rail 贴左对齐、视觉重心稳定，TOC 保持可见但从属于正文。后续新增文章内数据组件时，若它是正文语义块，应加入 `article-data-block` 或 `article-content-rail`；若它是二维内容，必须保留内部滚动和边缘提示。`≥1024px` 的 surface 扣除随后由 [ADR-0017](#adr-0017-obsidian-主题目录与内容树-chrome) 修订为 `584px`，以容纳右侧内容树。

## ADR-0017 Obsidian 主题目录与内容树 chrome

日期：2026-08-17，2026-08-17 修订（树 overlay 放弃 layout、快照冻结 chrome/展开态、slug 去掉误带的 `.md`），2026-08-21 修订（companion 先保持来源矩形，再与卡片共享 Phase B 时钟；companion 返回为 340ms）

**背景**：文章已在 git 中维护，但写作入口在 Obsidian。需要把现有平铺文章迁到主题子目录，并在列表/文章页提供可展开的内容树，同时不能复活已被否决的 `/{locale}/folders/...` 产品页或可见「文件夹」文案。卡片转场已有 ADR-0008 overlay 合同；内容树位移和文章切换淡入淡出必须停在同一所有权边界内。

**决策**：

- Obsidian vault 的 `06_Blog` 是指向 `content/blog` 的符号链接，git 仍是内容权威。Templater `Blog.md` 和可选插件符号链接只记录在 `docs/content.md`，不提交 vault 文件。
- 公开 URL 使用嵌套 slug：`/{locale}/{topic}/{basename}/`。basename 不含 `.md` / `.mdx`。`yarn write-blog`、Templater 和 Contentlayer `blogSlug` 都会去掉 slug 或 flattenedPath 末尾误带的扩展名，避免 `post.md.md` 泄漏进 URL。旧平铺 URL 在 `public/_redirects` 写字面 301（含无斜杠与有斜杠）。不增加 folder listing 路由。
- 内容树是未加标题的 chrome：列表右侧栏在最近文章之上，文章页 `≥1024px` 成为 `TOC | surface | tree`。文件夹行只展开/折叠，文章叶子是普通 `Link`。无障碍名称只有 sr-only 的「文章导航」/ `Article navigation`。
- 文章 RSC 可以携带紧凑树（title/path/slug），必须从 locale `sourcePosts` 构建，不能从过滤后的 term 列表构建。
- 三列几何：TOC `256` + 间距 `36` + surface + 间距 `36` + tree `256`。桌面卡片目标面宽度为 `shell − 584`，left 仍从 shell 左缘加上 TOC 列。
- 列表→文章的树位移是 ADR-0008 的 chrome companion：Phase A 保持来源或文章 destination rectangle，Phase B 与卡片共享同一时钟（打开 `380 ms`，companion 返回 `340 ms`，easing `[0.32, 0.72, 0, 1]`），结构化 React 快照，禁止 `cloneNode()`。快照必须冻结来源 chrome（`sidebar` / `rail`）、来源 rectangle、节点和当前展开文件夹；飞行中不得切换 chrome，也不得重播 `CollapsiblePanel` 入场。树 overlay 是 rail 尺寸的 fixed 面，只 tween 显式 `top` / `left` / `width` / `height`，不得使用 Motion `layout`、`layoutRoot` 或 scale projection。卡片 overlay 仍是唯一的 `layout` / `layoutRoot` 所有者。companion 返回不得在卡片 Phase C 结束前自行完成。`<1024px` 时树 destination 为 `null`，树 overlay 保持 idle，只播卡片序列。树点击的 solo 路径仍是双向 `380 ms`，不做背景 hold。
- 意图分流：`card` = 卡片 overlay + 树 companion，取消 veil；`tree-open` = 树 overlay + 阅读面 veil，无卡片 overlay；`article-switch` = 仅 veil。文章→文章只允许覆盖阅读面的 paint-only veil（`180–220 ms`），静态 HTML 里正文及其祖先保持 `opacity: 1`。无 JS 和直达不走 overlay。
- 代码块工具行去掉 `min-h-12`，复制/源码控件保持 `min-h-11`（44px）。

**后果**：主题目录同时服务 Obsidian 和站点导航，而不引入第二套内容产品。后续改文章几何、内容树或代码工具行时，必须同步 `lib/articleLayout.ts`、e2e 目标宽度和 `public/_redirects`。树转场不能再引入第二个 layoutRoot，以免和 ADR-0008 卡片 morph 抢投影。
