---
name: codex-agent-workflow
description: Use for implementation, refactor, repair, review, or quality-gate tasks in this repo. Orchestrates three Codex subagents (planner, implementer, reviewer) with deterministic gates and a bounded repair loop.
---

# Codex Agent Workflow

仓库规则见 `AGENTS.md`。本文件只定义三角色编排。

## 角色与顺序

每个实现或重构任务按以下顺序执行：

1. `planner`：调研官方文档与候选库，定义写集、库决策、文档/决策记录需求。
2. `implementer`：实现最小源码/测试改动，按需更新文档。
3. `reviewer`：运行确定性门禁，返回 `FEASIBLE` 或 `NOT_FEASIBLE`，并给出最终就绪结论。

reviewer 返回 `NOT_FEASIBLE` 时，`implementer` 只修复给出的具体 blocker，然后重新评审。最多 2 轮修复循环；仍不通过则停止并报告 blocker。

reviewer 通过且任务允许提交时，`implementer` 创建原子提交。

如果 subagent 工具不可用，在结果中说明工具限制，并按同样顺序在本地执行各角色。

## Subagent 存活与超时

顺序编排必须等到每个角色的终结输出，不得猜测 subagent 已死、闲置或成功。

- 每个角色最长等待 1,800 秒。
- 命令形式执行的角色用 watchdog 包装：
  `yarn agent:watchdog --label <role> --timeout-seconds 1800 -- <command>`
- 工具支持状态询问时，记录超时前先发一次状态/唤醒请求。
- 超时后记录 `SUBAGENT_TIMEOUT`（角色、已耗时、最后观察到的输出），转入修复/blocker 路径。
- watchdog 心跳是存活证据，不是通过结果。

## 角色输出契约

- planner 输出 `PLAN_RESULT`（scope / write_set / library_decision / decision_record_required / docs_required / validation / citations / risks）。
- implementer 输出 `IMPLEMENTATION_RESULT`（changed_files / behavior_change / commands_run / not_verified / risk）。
- reviewer 输出 `REVIEW_RESULT`（gates / verdict / evidence / required_repair / deprecation_audit / final_status），final_status 为 `READY_FOR_AGENT_COMMIT`、`READY_FOR_AGENT_DONE` 或 `NOT_READY`。

## 文档位置

- 架构、API、数据形状、依赖、部署、安全、性能、流程决策：追加到 `docs/decisions.md`。
- 行为变化：更新 `docs/architecture.md`、`docs/development.md`、`docs/content.md` 或 `docs/deployment.md` 中对应文档。
- 不创建完成笔记、done 清单或计划文件作为源码工作的完成证据。
