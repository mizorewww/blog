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
  - scripts/check-doc-metadata.mjs
  - scripts/agent-watchdog.mjs
  - eslint.config.mjs
  - knip.json
update_when:
  - package scripts change
  - TypeScript project config changes
  - lint rules change
  - documentation metadata policy changes
supersedes:
superseded_by:
---

# QUALITY_GATES.md

This file defines deterministic gates. These gates are more authoritative than the LLM reviewer.

If any required deterministic gate fails, the verdict is `NOT_FEASIBLE`.

The reviewer may add semantic concerns, but it cannot override a failed deterministic gate.

## Required Gates

Run the gates that exist in this repo.

If a command does not exist, report it as `NOT_AVAILABLE`, not as passed.

For this repo, the known project-level commands are:

```bash
yarn lint:check
yarn format:check
yarn typecheck
yarn typecheck:scripts
yarn docs:check
yarn deadcode:check
yarn perf:check
yarn check
yarn verify
yarn agent:watchdog
```

### 1. Git Diff Scope

Required:

```bash
git status --short
git diff --name-only
git diff --stat
```

Fail if:

- implementation task changed only docs/plans/notes
- unexpected generated files were added
- temporary scripts or artifacts were left behind
- old replacement files remain without reason

### 2. Type Checking

For TypeScript projects, run the repo's existing typecheck command.

This repo uses:

```bash
yarn typecheck
yarn typecheck:scripts
```

`yarn typecheck` covers the Next.js TypeScript app and generated Contentlayer types.

`yarn typecheck:scripts` enables TypeScript `checkJs` for maintained JavaScript and MJS configuration/scripts without scanning generated `.contentlayer`, `.next`, or `out` output.

Fail if either typecheck command fails.

### 3. Lint

Run the repo's existing lint command.

This repo uses:

```bash
yarn lint:check
```

Fail if lint fails.

### 4. Formatting

Run the repo's existing format check.

This repo uses:

```bash
yarn format:check
```

Fail if format check fails.

Recommended lint rules for AI-code workflows:

- no-warning-comments
- report unused eslint-disable comments
- no-restricted-syntax for forbidden patterns if already configured
- max-lines-per-function
- complexity or cognitive-complexity
- @typescript-eslint/no-explicit-any
- @typescript-eslint/no-unsafe-assignment
- rules against unused vars/imports
- rules against eslint-disable without description

### 5. Unit Tests

Run affected unit tests if a test command exists.

Common examples:

```bash
pnpm test
npm test
yarn test
vitest run
jest
```

Fail if tests fail.

Fail if tests were weakened to match implementation.

### 6. Documentation Metadata

Run the repo's documentation metadata check.

This repo uses:

```bash
yarn docs:check
```

Fail if a governed document is missing required metadata.

Fail if implementation/refactor work produces docs as the only completion artifact.

### 7. Architecture/Dependency Scan

Recommended tools:

```bash
dependency-cruiser
madge
```

This repo does not currently enable an architecture scan command. Report it as `NOT_AVAILABLE` unless a future task adds one.

Use for:

- circular dependencies
- forbidden import direction
- production code importing tests
- cross-layer imports
- missing package dependencies
- orphan modules

Fail if new architecture violations are introduced.

### 8. Dead Code / Unused Export Scan

Recommended tool:

```bash
knip
```

This repo uses:

```bash
yarn deadcode:check
```

Use for:

- unused files
- unused exports
- unused dependencies
- missing dependencies

Fail if new unused files/exports/dependencies are introduced without reason.

### 9. Duplicate Code Scan

Recommended tool:

```bash
jscpd
```

This repo does not currently enable a duplicate-code scan command. Report it as `NOT_AVAILABLE` unless a future task adds one.

Use for:

- copy-paste blocks
- duplicated implementation after AI-generated expansion

Fail if the diff introduces meaningful duplicated logic.

### 10. Static Security / Pattern Scan

Recommended tools:

```bash
semgrep
codeql
sonarqube
```

This repo does not currently enable a dedicated security scan command. Report it as `NOT_AVAILABLE` unless a future task adds one.

Use for:

- dangerous APIs
- insecure patterns
- hardcoded secrets
- injection risks
- unsafe filesystem/network handling
- known security issues

Fail if new security findings are introduced.

### 11. Mutation Testing

Recommended tool:

```bash
stryker
```

Use when tests are suspicious.

Especially useful when:

- Codex added tests
- tests only confirm current implementation
- tests might not catch wrong behavior
- reviewer suspects happy-path-only coverage

Fail if relevant mutants survive in changed logic and the task depends on test strength.

### 12. Performance Gates

Recommended tools:

```bash
size-limit
lighthouse-ci
rollup-plugin-visualizer
```

Use when the change touches:

- rendering hot paths
- bundle entrypoints
- dependency imports
- parsing/serialization
- loops over large data
- caching
- startup path

This repo has:

```bash
yarn perf:check
yarn size:budget
yarn quality:html
```

`yarn perf:check` runs a production build, static HTML quality checks, and static asset budget checks.

Run it when a diff touches rendering, bundle entrypoints, image handling, parsing/serialization, caching, startup code, route output, or third-party client dependencies.

Fail if:

- bundle budget regresses
- Lighthouse CI budget regresses
- hot path complexity obviously worsens
- new heavy dependency is added without approval in the task

## Deferred / TODO Gate

Before review, inspect new diff for:

```text
TODO
FIXME
HACK
DEFERRED
FOLLOW-UP
TEMP
WORKAROUND
placeholder
stub
future work
not implemented
```

If newly introduced in source/test files, fail unless explicitly approved by the task.

If newly introduced in docs as a substitute for implementation, fail.

## Gate Result Format

The gate runner must report:

```text
GATE_RESULT: PASS
COMMANDS_RUN:
- command - PASS

NOT_AVAILABLE:
- command - reason

FAILURES:
- none

DIFF_SCOPE:
- changed files summary

DEFERRED_CHECK:
- PASS
```

or:

```text
GATE_RESULT: FAIL
COMMANDS_RUN:
- command - PASS/FAIL

NOT_AVAILABLE:
- command - reason

FAILURES:
- concrete failure

DIFF_SCOPE:
- changed files summary

DEFERRED_CHECK:
- PASS/FAIL; evidence if FAIL
```
