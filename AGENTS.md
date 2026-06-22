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
update_when:
  - agent workflow changes
  - quality gate changes
  - commit policy changes
supersedes:
superseded_by:
---

# AGENTS.md

## Required Skill

For implementation, refactor, repair, review, or quality-gate tasks, use `.agents/skills/codex-agent-workflow/SKILL.md`.

The workflow is subagent-first. When subagent tooling is available, spawn the relevant role agents from `.codex/agents` instead of self-reviewing the diff in the same agent context.

Required role sequence:

1. `docs_researcher`
2. `planner`
3. `implementation_agent`
4. `docs_writer` when docs or ADR updates are required
5. `gate_runner`
6. `binary_reviewer`
7. `deprecation_auditor`
8. `refactor_surgeon` only when `NOT_FEASIBLE` or gates fail
9. `final_checker`

If subagent tooling is unavailable, state the tool limitation and run the same role sequence locally.

## Core Workflow

Prefer small, reviewable diffs.

Follow existing repository conventions.

Preserve external behavior unless the task explicitly asks for behavior changes.

Do not perform unrelated rewrites.

Do not use documentation, TODO comments, deferred notes, or planning files as a substitute for implementation.

If the task is an implementation or refactor task, completion requires relevant source/test changes and passing quality gates.

Before planning implementation, investigate related technical documentation and check whether a mature library already solves the requirement. New libraries must have more than 1,000 GitHub stars unless the task explicitly approves an exception.

## Completion Rule

A task is complete only if all of the following are true:

1. The requested behavior is implemented in source code or tests.
2. Relevant deterministic checks have been run.
3. `git diff --name-only` matches the expected scope.
4. There are no new TODO / FIXME / HACK / DEFERRED / FOLLOW-UP comments unless explicitly requested by the task.
5. There are no new docs-only completion artifacts unless the task was explicitly documentation-only.
6. The binary reviewer returns `FEASIBLE`.
7. The final checker returns `READY_FOR_AGENT_COMMIT` or `READY_FOR_AGENT_DONE`.
8. Required ADR and documentation metadata checks pass.

## Forbidden Completion Patterns

Do not claim completion if:

- the implementation was moved to a document
- the fix was written as future work
- the code contains new TODO / FIXME / HACK / DEFERRED comments
- only docs, plans, notes, or checklists changed for an implementation task
- tests were weakened to match current behavior
- errors were hidden instead of fixed
- dead code was merely disconnected instead of removed
- old code was left around after replacement
- validation commands were not run or their failure was ignored
- documentation was used as a completion artifact for source work
- an ADR was required but not written

## Git Rule

Use atomic git commits for each small completed point when the task allows commits.

Before every commit, the implementing agent must run deterministic gates and receive a `FEASIBLE` binary review.

If the task allows commits and final checker returns `READY_FOR_AGENT_COMMIT`, the agent must create the atomic commit before reporting completion.

Do not combine unrelated changes into one commit.

Do not commit with failing gates.

Do not run destructive git commands.

## Review Rule

For review, follow `AI_CODE_QUALITY.md`.

The reviewer must return only one of:

- `FEASIBLE`
- `NOT_FEASIBLE`

No severity classes. No deferred categories. No acceptable-later bucket.

If there is a blocker, the verdict is `NOT_FEASIBLE`.
