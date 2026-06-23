---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-06-23
verified_by: command
related_code:
  - package.json
  - vitest.config.ts
  - playwright.config.ts
  - tests
  - lib/content/terms.ts
  - components/TermIndexView.tsx
update_when:
  - test commands change
  - quality gate policy changes
  - term route data shape changes
supersedes:
superseded_by:
---

# ADR-0004: Add Test Harness And Preserve Term Labels

Status: accepted
Date: 2026-06-23
Owner: codex-agent
Related code: `package.json`, `vitest.config.ts`, `playwright.config.ts`, `tests`, `lib/content/terms.ts`, `components/TermIndexView.tsx`
Supersedes:
Superseded by:

## Context

The repository already has deterministic static gates, but the article expansion and collapse path depends on browser history, App Router navigation, scroll position, and animation timing. Static type and lint checks cannot verify that returning from an expanded article restores the exact list scroll position.

The tag and category model also used the route slug as the only term key. That made route generation simple, but it lost the original display label for terms such as `Next.js`.

## Decision

Add Vitest for pure helper regression tests and Playwright for production-like static preview smoke tests. Unit tests cover term, URL, route-state, and script utility behavior. Playwright covers the article open, scroll, collapse, and reduced-motion restoration workflow in a real browser.

Change the internal term data shape from slug-only counts to term summaries:

```ts
type TermSummary = {
  slug: string
  label: string
  count: number
}
```

Routes continue to use slugs. UI, aria labels, metadata, and JSON-LD use the preserved label.

## Consequences

Benefits:

- Scroll restoration has a deterministic browser regression test.
- Pure route and term helpers are protected by fast unit tests.
- Term labels no longer lose punctuation, case, or non-ASCII display text.
- Future refactors can run smaller, focused tests before full static builds.

Costs:

- Dependency install size increases because Playwright brings browser automation tooling.
- E2E tests require a production-like build and preview server, so they are slower than unit tests.
- Quality gate documentation must account for both fast unit checks and heavier browser smoke checks.

## Rejected alternatives

Rejected: use jsdom or Testing Library as the primary coverage for the collapse bug.

Reason: the bug depends on real browser scroll behavior, App Router route commits, and media preferences.

Rejected: keep slug-only term counts and format slugs for display.

Reason: formatting cannot recover original labels such as `Next.js`.

Rejected: add Lighthouse CI in the same change.

Reason: Lighthouse adds noisy lab performance thresholds and is not required to fix the current behavior or refactor safely.
