---
status: active
audience: agent
authority: source-of-truth
owner: codex-agent
last_verified: 2026-06-23
verified_by: command
related_code:
  - AGENTS.md
  - CODEX_WORKFLOW.md
  - QUALITY_GATES.md
  - .agents/skills/codex-agent-workflow/SKILL.md
  - .codex/agents
  - scripts/check-doc-metadata.mjs
  - scripts/agent-watchdog.mjs
update_when:
  - agent workflow changes
  - documentation placement changes
  - ADR policy changes
  - quality gate changes
supersedes:
superseded_by:
---

# ADR-0001: Agent Workflow And Docs Governance

Status: accepted
Date: 2026-06-23
Owner: codex-agent
Related code: `AGENTS.md`, `CODEX_WORKFLOW.md`, `QUALITY_GATES.md`, `.agents/skills/codex-agent-workflow/SKILL.md`, `.codex/agents`, `scripts/check-doc-metadata.mjs`, `scripts/agent-watchdog.mjs`
Supersedes:
Superseded by:

## Context

The repository needs an agent-only workflow that does not treat docs, plans, notes, or checklists as implementation completion. Agents also need a consistent way to decide when to research external technical sources, when to adopt libraries, where to put durable docs, and when architectural decisions require ADRs.

Without explicit governance, stale docs can look authoritative, implementation work can be displaced into prose, and dependency choices can be made without checking mature existing libraries.

## Decision

We use `.agents/skills/codex-agent-workflow/SKILL.md` as the orchestration source of truth and `.codex/agents/*.toml` as role definitions.

Every implementation/refactor task starts with `docs_researcher`, then `planner`, then implementation. The research step must inspect related official technical documentation and library candidates. New libraries require more than 1,000 GitHub stars, current maintenance signals, and compatible licensing unless the task explicitly approves an exception.

Sequential subagent work must wait for terminal role output instead of guessing that a subagent is dead or safe to skip. Each role has a maximum 1,800 second timeout. Command-backed long-running roles use `yarn agent:watchdog --label <role> --timeout-seconds 1800 -- <command>` to emit heartbeats and timeout evidence.

We add these role agents:

- `docs_researcher`
- `planner`
- `docs_writer`
- `deprecation_auditor`

We keep `eslint-plugin-jsx-a11y` as a direct dev dependency because the ESLint config explicitly extends `plugin:jsx-a11y/recommended`. Its repository reports 3.6k GitHub stars and documents both legacy and flat-config usage: <https://github.com/jsx-eslint/eslint-plugin-jsx-a11y>.

We adopt `knip` for lightweight dependency/dead-code gate coverage. Its repository reports 11.6k GitHub stars and its docs describe unused dependency/export/file detection: <https://github.com/webpro-nl/knip> and <https://knip.dev/>.

Documentation placement is:

- ADRs in `docs/adr/ADR-0001-short-slug.md`
- retained research notes in `docs/research/YYYY-MM-DD-topic.md`
- durable guides in `docs/guides/topic.md`
- existing source-of-truth domain docs updated in place under `docs/`
- agent workflow docs in `.agents/skills/codex-agent-workflow/SKILL.md`, `.codex/agents/*.toml`, and root workflow documents

Every governed document must have metadata front matter with status, audience, authority, owner, verification, related code, update triggers, and supersession fields. `yarn docs:check` enforces this for root workflow docs, `docs/**/*.md`, and the project workflow skill.

Docs cannot be used as a completion artifact for implementation/refactor work. For source tasks, docs are only allowed when explicitly requested, when an ADR is required, or when source behavior changed and durable docs must be updated.

## Consequences

Benefits:

- Agent work starts with current technical context and library due diligence.
- Architecture and dependency decisions become traceable.
- Stale or superseded docs are easier to detect.
- Documentation metadata is checked deterministically.
- Docs-only completion for source work is explicitly blocked.

Costs:

- More subagents run per task.
- Small tasks have extra research and planning overhead.
- ADR numbering and metadata require maintenance.

Future limits:

- Library star count is a maturity heuristic, not a correctness guarantee.
- Some niche libraries may need explicit exceptions.
- `docs:check` verifies metadata shape, not semantic accuracy.

## Rejected alternatives

Rejected: keep prompt markdown files in `.codex/prompts`.

Reason: prompt files duplicated workflow state and made role orchestration harder to keep consistent.

Rejected: allow docs as completion evidence for source work.

Reason: implementation/refactor tasks must be completed in source or tests; docs can only be supporting changes.

Rejected: place all new docs directly under `docs/`.

Reason: ADRs, research notes, durable guides, and source-of-truth domain docs have different lifecycles and authority levels.

Rejected: allow new dependencies without maturity checks.

Reason: agents need a default bias toward maintained, widely adopted libraries or explicit exceptions.
