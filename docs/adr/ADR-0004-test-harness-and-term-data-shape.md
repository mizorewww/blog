---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-07-10
verified_by: command
related_code:
  - package.json
  - vitest.config.ts
  - playwright.config.ts
  - tests
  - app/[locale]/page.tsx
  - app/[locale]/[...slug]/page.tsx
  - lib/content/terms.ts
  - components/TermIndexView.tsx
update_when:
  - test commands change
  - quality gate policy changes
  - article route browser contract changes
  - reduced-motion or route loading coverage changes
  - term route data shape changes
supersedes:
superseded_by:
---

# ADR-0004: Add Test Harness And Preserve Term Labels

Status: accepted
Date: 2026-06-23
Owner: codex-agent
Related code: `package.json`, `vitest.config.ts`, `playwright.config.ts`, `tests`, `app/[locale]/page.tsx`, `app/[locale]/[...slug]/page.tsx`, `lib/content/terms.ts`, `components/TermIndexView.tsx`
Supersedes:
Superseded by:

## Context

The repository already has deterministic static gates, but the route-first article contract defined by ADR-0007 depends on real navigation, browser history, native scroll restoration, JavaScript availability, media preferences, and observable animation timing. Static type and lint checks cannot verify ordinary link semantics, an independent article document, a safe return destination, stable intermediate frames, or loading UI that matches the destination route.

The tag and category model also used the route slug as the only term key. That made route generation simple, but it lost the original display label for terms such as `Next.js`.

## Decision

Add Vitest for pure helper regression tests and Playwright for production-like static preview smoke tests. Unit tests cover term, URL, route-helper, and script utility behavior. Playwright covers the route-first article workflow in a real browser:

- List cards retain ordinary link behavior, including modified clicks and new tabs.
- An article URL renders only the requested article as a readable independent document.
- Direct requests, refreshes, new tabs, and JavaScript-disabled visits keep the requested article visible.
- The article return control uses a safe localized fallback when provenance is unknown, while a validated list-origin Back relies on native browser scroll restoration.
- Normal and reduced-motion modes reach the same content and focus results without animation-dependent waits.
- Early, completion, and stable frames expose layout or scroll movement that a final URL assertion would miss.
- List, article, term, and search navigation use loading UI that matches the destination geometry.

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

- Route-first navigation, safe return behavior, and native Back restoration have deterministic browser regression coverage.
- Pure route and term helpers are protected by fast unit tests.
- Term labels no longer lose punctuation, case, or non-ASCII display text.
- Future refactors can run smaller, focused tests before full static builds.

Costs:

- Dependency install size increases because Playwright brings browser automation tooling.
- E2E tests require a production-like build and preview server, so they are slower than unit tests.
- Quality gate documentation must account for both fast unit checks and heavier browser smoke checks.

## Rejected alternatives

Rejected: use jsdom or Testing Library as the primary coverage for the route-first article workflow.

Reason: the contract depends on real link and history behavior, native scroll restoration, static route output, JavaScript-disabled rendering, media preferences, and animation intermediate frames.

Rejected: keep slug-only term counts and format slugs for display.

Reason: formatting cannot recover original labels such as `Next.js`.

Rejected: add Lighthouse CI in the same change.

Reason: Lighthouse adds noisy lab performance thresholds and is not required to fix the current behavior or refactor safely.
