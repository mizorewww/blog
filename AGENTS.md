# AGENTS.md

本仓库使用三个 agent 角色完成开发任务。确定性门禁的权威高于 LLM 判断。

角色定义在 `.codex/agents/`，编排细节见 `.agents/skills/codex-agent-workflow/SKILL.md`。

## 三个角色

1. **planner** — 调研与规划。查官方文档和候选库（新库必须超过 1,000 GitHub stars，除非任务明确豁免），定义写集，决定是否需要更新文档或在 `docs/decisions.md` 记录决策。
2. **implementer** — 实现、文档与修复。写最小的源码/测试改动，按需更新文档，修复 reviewer 返回的具体 blocker。
3. **reviewer** — 门禁、评审与终检。跑确定性门禁，做二元评审（`FEASIBLE` / `NOT_FEASIBLE`），检查废弃 API 和过期文档，给出最终就绪结论。

流程：`planner → implementer → reviewer`。reviewer 返回 blocker 时由 implementer 修复后重新评审，最多 2 轮；仍不通过则停止并报告 blocker。

有 subagent 工具时必须用 subagent 执行各角色；没有时说明工具限制并在本地按同样顺序执行。

## 核心规则

- 小 diff，遵循仓库现有约定，不做无关重写。
- 文档、TODO、计划文件不能代替实现。
- 实现任务的完成标准：行为已落地、相关检查通过、`git diff` 范围符合预期、reviewer 通过。
- 实现任务只有文档变化不算完成。

## 确定性门禁

按 diff 范围运行存在的命令；命令不存在时报告 `NOT_AVAILABLE`，不得当作通过。

```bash
git status --short && git diff --name-only && git diff --stat && git diff --check
yarn format:check
yarn lint:check
yarn test:unit
yarn typecheck
yarn typecheck:scripts
yarn deadcode:check
```

条件门禁：

- 改动涉及路由、浏览器交互、滚动或静态预览行为：`yarn test:e2e`
- 改动涉及渲染、bundle、图片、解析/序列化、缓存、启动路径、路由输出或第三方客户端依赖：`yarn perf:check`

新 diff 中扫描 `TODO` / `FIXME` / `HACK` / `DEFERRED` / `FOLLOW-UP` / `TEMP` / `WORKAROUND` / `placeholder` / `stub` / `future work` / `not implemented`；未经任务明确批准不得新增。

## 二元评审标准

出现以下任一情况即 `NOT_FEASIBLE`：

- 请求的行为未实现，或实现被文档/TODO/计划文字代替
- 源码任务的 diff 只有文档
- 确定性门禁失败，或相关验证未运行
- 测试被改成迁就错误行为，或只覆盖 happy path
- 错误被吞掉或用 silent fallback 隐藏
- 用 sleep/timeout/retry/polling 掩盖生命周期或竞态 bug
- 死代码只是断开而非删除，或新旧实现并存
- 公共 API、数据形状、持久化格式或错误语义改变但未声明
- 新库缺少 1,000+ stars 证据或明确豁免
- 无法判断行为是否改变

评审输出必须给出具体证据：文件、行号或符号、原因、所需修复。

## Git 规则

- 任务允许提交时，每个完成的小点创建一个原子提交。
- 提交前必须通过确定性门禁且 reviewer 通过。
- 不混入无关改动，不在门禁失败时提交，不运行破坏性 git 命令。

## 文档规则

以下情况记录到 `docs/decisions.md`：架构边界、公共 API、数据形状、依赖采用或替换、部署/安全/性能策略、agent 流程变化。行为变化时同步更新 `docs/` 下对应文档。

文档更新只在任务要求或源码行为变化时进行，且永远不是源码工作的完成证据。
