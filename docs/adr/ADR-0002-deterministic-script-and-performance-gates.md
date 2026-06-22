---
status: active
audience: agent
authority: source-of-truth
owner: codex-agent
last_verified: 2026-06-23
verified_by: command
related_code:
  - package.json
  - tsconfig.scripts.json
  - scripts/agent-watchdog.mjs
  - QUALITY_GATES.md
  - .agents/skills/codex-agent-workflow/SKILL.md
update_when:
  - package scripts change
  - TypeScript project config changes
  - performance budget changes
  - quality gate changes
supersedes:
superseded_by:
---

# ADR-0002: Deterministic Script And Performance Gates

Status: accepted
Date: 2026-06-23
Owner: codex-agent
Related code: `package.json`, `tsconfig.scripts.json`, `scripts/agent-watchdog.mjs`, `QUALITY_GATES.md`, `.agents/skills/codex-agent-workflow/SKILL.md`
Supersedes:
Superseded by:

## Context

IDE diagnostics can flag JavaScript and MJS maintenance files even when the normal Next.js TypeScript check passes. The existing `yarn typecheck` path validates the app and Contentlayer output, but it does not enable TypeScript `checkJs` for maintained JavaScript scripts and config files.

Performance can also regress through route output, image handling, static asset growth, third-party client dependencies, or accidental MDX payload expansion. Those regressions need deterministic checks before LLM review.

TypeScript documents that `checkJs` reports errors in JavaScript files included in the project: <https://www.typescriptlang.org/tsconfig/checkJs.html>.

TypeScript also documents `node16`/`nodenext` module resolution for modern Node.js ESM/CJS behavior: <https://www.typescriptlang.org/tsconfig/moduleResolution.html>.

Next.js documents package bundling and notes that smaller bundles reduce JavaScript execution time and improve Core Web Vitals: <https://nextjs.org/docs/app/guides/package-bundling>.

## Decision

We add `tsconfig.scripts.json` and `yarn typecheck:scripts` for maintained JS/MJS config and script files. The config enables `checkJs` while excluding generated `.contentlayer`, `.next`, and `out` output so diagnostics stay actionable.

We add `yarn perf:check` as the performance regression gate. It runs a production build, static HTML quality checks, and static asset budget checks.

We add `scripts/agent-watchdog.mjs` and `yarn agent:watchdog` so long command-backed role work can emit heartbeats and a deterministic timeout result. The maximum role timeout is 1,800 seconds.

`yarn check` now includes `yarn typecheck:scripts`. `QUALITY_GATES.md` and the workflow skill require `yarn perf:check` for rendering, bundle, image, parsing, serialization, caching, startup, route output, or third-party client dependency changes.

## Consequences

Benefits:

- IDE-visible JS/MJS diagnostics are promoted into deterministic gates.
- Generated output no longer pollutes JS checking.
- Performance-sensitive diffs have a named gate instead of relying on review judgment.
- Long-running role work has heartbeat and timeout evidence.

Costs:

- `yarn check` has one more TypeScript invocation.
- Performance-sensitive changes require a production build before approval.
- JS maintenance scripts may need JSDoc or small code adjustments to remain type-checkable.

Future limits:

- Static asset budgets cannot prove runtime interaction performance.
- Lighthouse or browser-based performance budgets can be added later if the project needs page-level lab metrics.
- `checkJs` improves script coverage but is not a substitute for tests around script behavior.

## Rejected alternatives

Rejected: enable `checkJs` directly in the root `tsconfig.json`.

Reason: it scans generated `.contentlayer`, `.next`, and `out` files and produces noisy diagnostics unrelated to maintained source.

Rejected: rely on IDE warnings without adding a command.

Reason: agent workflows and CI need deterministic, reproducible gates before LLM review.

Rejected: use only LLM review for performance regressions.

Reason: static output size, HTML issues, and payload growth are cheaper and more stable to check with scripts.
