---
status: active
audience: agent
authority: source-of-truth
owner: codex-agent
last_verified: 2026-06-23
verified_by: command
related_code:
  - .agents/skills/codex-agent-workflow/SKILL.md
  - .codex/agents
  - scripts/agent-watchdog.mjs
update_when:
  - agent orchestration changes
  - commit policy changes
  - docs governance changes
supersedes:
superseded_by:
---

# CODEX_WORKFLOW.md

This repository uses a deterministic-first Codex workflow.

LLMs are allowed to implement and review, but deterministic gates are authoritative.

Use `.agents/skills/codex-agent-workflow/SKILL.md` as the orchestration source of truth.

The old `.codex/prompts/*.md` flow has been replaced by project skill orchestration plus `.codex/agents/*.toml` role definitions.

## Sequential Orchestration

Every sequential role must return its configured terminal output before the next role starts.

The orchestrating agent must not guess that a subagent is dead, successful, or safe to skip. The maximum wait for a role is 1,800 seconds. Use native subagent wait timeouts when available; for command-backed roles, use:

```bash
yarn agent:watchdog --label <role> --timeout-seconds 1800 -- <command>
```

If tooling supports a status or wakeup prompt, send one before recording timeout. If the role still has no terminal result, record `SUBAGENT_TIMEOUT` and route the task to repair/blocker handling.

## State Machine

### S0 - Research

Use the `docs_researcher` role.

Investigate related technical documentation and library candidates before planning.

New libraries must have more than 1,000 GitHub stars unless the task explicitly approves an exception.

### S1 - Planning

Use the `planner` role.

The task must be small enough to review as one diff.

Decide whether an ADR is required.

### S2 - Codex Implementation

Use the `implementation_agent` role.

Rules:

- keep diff small
- follow repo conventions
- do not perform unrelated rewrites
- do not defer work into docs
- do not add TODO/HACK/FIXME/DEFERRED as completion
- do not commit before gates and binary review pass
- spawn sidecar subagents for independent checks when tooling is available

### S3 - Documentation

Use the `docs_writer` role only when docs were requested or source behavior changed in a way that requires documentation.

Documentation is never completion evidence for implementation/refactor work.

### S4 - Deterministic Gates

Use the `gate_runner` role.

Run gates from `QUALITY_GATES.md`, including `yarn typecheck:scripts` for maintained JS/MJS files.

If any required gate fails, state becomes `S7 - Repair`.

### S5 - Binary Review

Use the `binary_reviewer` role.

Reviewer returns only:

- `FEASIBLE`
- `NOT_FEASIBLE`

If `NOT_FEASIBLE`, state becomes `S7 - Repair`.

### S6 - Deprecation Audit

Use the `deprecation_auditor` role.

Check stale docs, deprecated APIs, superseded ADRs, and deferred-doc patterns.

### S7 - Repair

Use the `refactor_surgeon` role.

Repair only the concrete blocker.

Do not perform broad refactor.

After repair, return to S4.

Maximum repair loops: 2.

If still `NOT_FEASIBLE` after 2 repair loops, stop and report the concrete blocker. Do not keep trying.

### S8 - Final Check

Use the `final_checker` role.

Final check confirms:

- deterministic gates pass
- reviewer says `FEASIBLE`
- no deferred work
- no docs-only completion
- git diff scope is expected
- required ADR/docs metadata is present

## Commit Rule

For implementation tasks, create one atomic commit for each small completed point when the task allows commits.

Before every commit:

1. Deterministic gates must pass.
2. Binary reviewer must return `FEASIBLE`.
3. Final check must return `READY_FOR_AGENT_COMMIT`.

Do not commit unrelated files.

Do not merge unless the task explicitly asks for it and all agent checks pass.

## Docs Rule

Documentation changes are allowed only when:

1. The task requested documentation; or
2. Source behavior changed and docs must be updated.

Documentation is never a substitute for implementation.

Important docs must include the metadata front matter defined in `docs/adr/ADR-0001-agent-workflow-and-docs-governance.md`.
