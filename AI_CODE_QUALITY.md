---
status: active
audience: agent
authority: source-of-truth
owner: codex-agent
last_verified: 2026-06-23
verified_by: command
related_code:
  - .codex/agents/binary-reviewer.toml
  - .agents/skills/codex-agent-workflow/SKILL.md
update_when:
  - review criteria changes
  - quality gate changes
  - agent role changes
supersedes:
superseded_by:
---

# AI_CODE_QUALITY.md

This file defines the review standard for agent-written code.

The reviewer must use a binary verdict only:

- `FEASIBLE`: safe to proceed to final agent check
- `NOT_FEASIBLE`: must go back to repair

There are no intermediate categories.

## Binary Decision Rule

Return `NOT_FEASIBLE` if any of the following is true:

1. Requested behavior is not implemented.
2. Implementation is replaced by docs, TODOs, deferred notes, or planning text.
3. New TODO / FIXME / HACK / DEFERRED / FOLLOW-UP comments are introduced without explicit task instruction.
4. The diff is docs-only for a source-code task.
5. Tests were changed to fit wrong behavior.
6. Tests only cover the current fixture or happy path when the task requires broader behavior.
7. Production code contains test-specific branches.
8. The implementation hardcodes expected test output.
9. The implementation bypasses the intended architecture instead of fixing the root cause.
10. Dead code is merely disconnected rather than removed.
11. Old implementation is left beside a replacement without a compatibility reason.
12. Errors are swallowed or hidden with silent fallback.
13. Sleep, timeout, retry, or polling is used as a band-aid for lifecycle/race bugs.
14. Public API, data shape, persistence format, or error semantics changed without being called out.
15. Deterministic quality gates fail.
16. Relevant validation was not run.
17. The reviewer cannot tell whether behavior changed.
18. Required tech-stack research, library-quality check, ADR, or docs metadata is missing.
19. Documentation is used as a completion artifact for implementation/refactor work.

Return `FEASIBLE` only if all of the following are true:

1. The implementation appears to satisfy the requested behavior.
2. The diff modifies the expected source/test files.
3. No deferred work is used as completion.
4. No new scanner failure exists.
5. Tests/checks relevant to the change were run.
6. The code does not obviously bypass existing architecture.
7. The code does not obviously create a monolithic boundary problem.
8. The code does not obviously reinvent existing utilities or dependencies.
9. The result is ready for final agent check.

## Evidence Rule

The reviewer must not speculate.

Every `NOT_FEASIBLE` decision must include concrete evidence:

- file path
- line or symbol
- exact reason
- required repair

If evidence is weak, ask a question, but do not invent a blocker.

## Output Format

The reviewer output must be exactly:

```text
VERDICT: FEASIBLE
EVIDENCE:
- none

REQUIRED_REPAIR:
- none
```

or:

```text
VERDICT: NOT_FEASIBLE
EVIDENCE:
- file:line_or_symbol - concrete blocker

REQUIRED_REPAIR:
- exact repair required before re-review
```

## No Deferred Rule

The following words are suspicious in new diff:

- TODO
- FIXME
- HACK
- DEFERRED
- FOLLOW-UP
- TEMP
- WORKAROUND
- later
- future work
- not implemented
- placeholder
- stub

They are not automatically illegal in old unchanged code.

They are illegal when newly introduced as a substitute for completing the requested implementation.
