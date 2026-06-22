---
name: codex-agent-workflow
description: Use for implementation, refactor, repair, review, or quality-gate tasks in this repo. Orchestrates Codex subagents with deterministic gates, binary review, bounded repair, and final agent readiness checks.
status: active
audience: agent
authority: source-of-truth
owner: codex-agent
last_verified: 2026-06-23
verified_by: command
related_code:
  - .codex/agents
  - AGENTS.md
  - CODEX_WORKFLOW.md
  - QUALITY_GATES.md
  - scripts/agent-watchdog.mjs
update_when:
  - agent orchestration changes
  - documentation governance changes
  - quality gate changes
supersedes:
superseded_by:
---

# Codex Agent Workflow

This repo uses agent-only checks. Deterministic gates and reviewer agents decide readiness.

## Required Orchestration

Use this flow for every implementation or refactor task:

1. `docs_researcher`: spawn a subagent to inspect related technical documentation and library candidates.
2. `planner`: spawn a subagent to define scope, expected write set, library decision, and ADR/doc needs.
3. `implementation_agent`: implement the smallest source/test change.
4. `docs_writer`: spawn only when docs or ADR updates are required.
5. `gate_runner`: spawn a subagent to run deterministic gates.
6. `binary_reviewer`: spawn a subagent to run binary review.
7. `deprecation_auditor`: spawn a subagent to run deprecation and stale-doc audit.
8. `refactor_surgeon`: spawn only when gates, review, or audit return a concrete blocker.
9. `final_checker`: spawn a subagent to run final readiness check.
10. `implementation_agent`: create an atomic commit when the task allows commits and all checks pass.

If subagent tooling is unavailable, state the tool limitation in the result and run the same roles locally.

## Agent Roles

Use these `.codex/agents` roles:

- `docs_researcher`: researches official docs and library candidates before planning.
- `planner`: turns research into an implementation plan, library decision, and ADR/doc requirement.
- `implementation_agent`: edits source/tests for the requested task.
- `docs_writer`: writes required docs/ADRs with metadata, never as source-work completion.
- `gate_runner`: runs deterministic commands and deferred-marker scans.
- `binary_reviewer`: returns only `FEASIBLE` or `NOT_FEASIBLE`.
- `deprecation_auditor`: checks stale docs, deprecated APIs, superseded docs, and deferred docs.
- `refactor_surgeon`: fixes exactly one concrete blocker.
- `final_checker`: verifies readiness after gates and review pass.

Prefer spawning `docs_researcher`, `planner`, `gate_runner`, `binary_reviewer`, `deprecation_auditor`, and `final_checker` as separate subagents. Spawn implementation, docs, or repair subagents only when their write scope is disjoint and bounded.

## Subagent Liveness And Timeout

Sequential orchestration must wait for an explicit terminal result from each required role.

- Do not guess that a subagent is dead, idle, or successful.
- Do not skip a required role because a prior role was slow.
- Use a maximum role timeout of 1,800 seconds.
- If the runner supports subagent wait timeouts, set the wait timeout to 1,800 seconds.
- If the role is executed through a shell command, wrap it with `yarn agent:watchdog --label <role> --timeout-seconds 1800 -- <command>`.
- The child role must wake the orchestrator by returning its configured output format before the timeout.
- If the tooling supports status prompts, send one status or wakeup request before recording timeout.
- If no terminal result exists after the timeout, record `SUBAGENT_TIMEOUT` with role, elapsed seconds, and last observed output; then follow the repair/blocker path.
- Heartbeats from `agent:watchdog` are evidence, not pass results.

## Research And Library Rule

Before implementation planning:

- Use official technical documentation first.
- Prefer primary sources for framework/API behavior.
- If a library could satisfy the requirement, identify candidates before writing custom code.
- New libraries must have more than 1,000 GitHub stars, current maintenance signals, and compatible licensing unless the task explicitly approves an exception.
- Record source URLs, access date, library decision, and rejected candidates in the planner output.

If no suitable library exists, the plan must say why custom implementation is appropriate.

## Documentation Placement

Use these locations:

- ADRs: `docs/adr/ADR-0001-short-slug.md`, then increment the number.
- Research notes: `docs/research/YYYY-MM-DD-topic.md` when source-backed research must be retained.
- Durable guides: `docs/guides/topic.md` unless an existing source-of-truth doc is clearly the right place.
- Existing source-of-truth docs: update `docs/architecture.md`, `docs/development.md`, `docs/deployment.md`, or `docs/content.md` when their domain changes.
- Agent workflow docs: keep orchestration in `.agents/skills/codex-agent-workflow/SKILL.md`, role behavior in `.codex/agents/*.toml`, and repository rules in `AGENTS.md`.

Do not create completion notes, done checklists, or planning artifacts as proof that source work is complete.

## Documentation Metadata

Every governed document must start with front matter:

```yaml
---
status: active | draft | deprecated | superseded
audience: human | agent | both
authority: source-of-truth | guide | note | research
owner: <name or role>
last_verified: YYYY-MM-DD
verified_by: command | agent review | source citation
related_code:
  - path/to/file
update_when:
  - public API changes
  - data shape changes
  - behavior changes
supersedes:
superseded_by:
---
```

Use `yarn docs:check` to verify required metadata.

## ADR Rule

Write an ADR when a task changes or chooses:

- architecture boundaries
- public API, data shape, persistence, or error semantics
- dependency/library adoption or replacement
- security, deployment, or performance policy
- agent workflow, docs governance, or quality gates
- deprecation, supersession, or compatibility strategy

ADR files must use:

```markdown
# ADR-0001: <decision>

Status: proposed | accepted | superseded | deprecated
Date:
Owner:
Related code:
Supersedes:
Superseded by:

## Context

Why the decision is needed.

## Decision

What was decided.

## Consequences

Benefits, costs, and future constraints.

## Rejected alternatives

What was rejected and why.
```

## State Machine

S0 research:

- Use `docs_researcher`.
- Inspect related technical docs and library candidates.
- Enforce the more-than-1,000-GitHub-stars rule for new libraries unless explicitly exempted.

S1 planning:

- Use `planner`.
- Keep the task small enough to review as one diff.
- Decide expected write set, library choice, docs need, and ADR need.

S2 implementation:

- Use `implementation_agent`.
- Keep diffs small.
- Do not defer implementation into docs, TODOs, or planning files.
- Do not commit.

S3 documentation:

- Use `docs_writer` only for requested docs, ADRs, or docs required by behavior changes.
- Docs cannot be the completion artifact for source work.
- All governed docs must pass `yarn docs:check`.

S4 deterministic gates:

- Use `gate_runner`.
- Follow `QUALITY_GATES.md`.
- Required local commands include `git status --short`, `git diff --name-only`, `git diff --stat`, `git diff --check`, `yarn format:check`, `yarn lint:check`, `yarn typecheck`, `yarn typecheck:scripts`, `yarn docs:check`, and `yarn deadcode:check`.
- Run `yarn perf:check` when the diff touches rendering, bundle, image, parsing, serialization, caching, startup code, route output, or third-party client dependencies.
- If any required gate fails, go to S7.

S5 binary review:

- Use `binary_reviewer`.
- Follow `AI_CODE_QUALITY.md`.
- Verdict must be exactly `FEASIBLE` or `NOT_FEASIBLE`.
- If `NOT_FEASIBLE`, go to S7.

S6 deprecation audit:

- Use `deprecation_auditor`.
- Check stale docs, deprecated APIs, superseded docs, and deferred documentation.
- If blockers exist, go to S7.

S7 repair:

- Use `refactor_surgeon`.
- Repair exactly one concrete blocker.
- Maximum repair loops: 2.
- After repair, return to S4.
- If still blocked after 2 loops, report the blocker and stop.

S8 final check:

- Use `final_checker`.
- Confirm deterministic gates passed, binary review is `FEASIBLE`, no deferred work was introduced, and diff scope is expected.
- Confirm required ADRs and documentation metadata are present.

## Gate Commands

Use commands that exist in this repo:

```bash
git status --short
git diff --name-only
git diff --stat
git diff --check
yarn lint:check
yarn format:check
yarn typecheck
yarn typecheck:scripts
yarn docs:check
yarn deadcode:check
yarn perf:check
yarn check
yarn verify
yarn agent:watchdog --label <role> --timeout-seconds 1800 -- <command>
```

Report missing commands as `NOT_AVAILABLE`, not passed.

## Forbidden Completion

Do not claim completion if:

- implementation was replaced by docs
- fix was written as future work
- new TODO/FIXME/HACK/DEFERRED/FOLLOW-UP comments were added as completion
- source task changed only docs/plans/checklists
- tests were weakened
- errors were hidden
- dead code was disconnected instead of removed
- old replacement code was left around without compatibility reason
- validation was not run
- required subagent checks were skipped while subagent tooling was available
- required ADR was not written
- governed docs are missing metadata
- docs were used as the only completion artifact for source work

## Output Discipline

Each role must use its configured output format. Keep reports short, evidence-based, and file-specific.
