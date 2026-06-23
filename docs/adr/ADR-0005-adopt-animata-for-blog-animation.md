---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-06-23
verified_by: source citation
related_code:
  - components/AppShell.tsx
  - components/animata
  - components/animata/PageTransition.tsx
  - components/LanguageSwitcher.tsx
  - components/Link.tsx
  - app/[locale]/loading.tsx
  - app/[locale]/[...slug]/loading.tsx
  - layouts/ListLayoutWithTags.tsx
  - lib/blogRouteState.ts
  - lib/hooks/useBlogExpansionState.ts
  - lib/postLayout.ts
  - package.json
update_when:
  - animation library changes
  - route loading behavior changes
  - client navigation behavior changes
supersedes:
superseded_by:
---

# ADR-0005: Adopt Animata For Blog Animation

Status: accepted
Date: 2026-06-23
Owner: codex-agent
Related code: `components/AppShell.tsx`, `components/animata`, `components/animata/PageTransition.tsx`, `components/LanguageSwitcher.tsx`, `components/Link.tsx`, `app/[locale]/loading.tsx`, `app/[locale]/[...slug]/loading.tsx`, `layouts/ListLayoutWithTags.tsx`, `lib/blogRouteState.ts`, `lib/hooks/useBlogExpansionState.ts`, `lib/postLayout.ts`, `package.json`
Supersedes:
Superseded by:

## Context

The blog previously kept article expansion, collapse, scroll positioning, and body reveal animation in local utilities. That preserved the route-aware reading experience, but it mixed business state with hand-written easing, requestAnimationFrame loops, Tailwind transition classes, and loading behavior.

The site also rendered internal links through plain anchors. That bypassed Next.js App Router client navigation for normal internal links and could show a full document reload flash while moving between static pages.

The user requirement is to migrate animation-related behavior to <https://animata.design/>, keep loading SPA-like, preserve intentional article and page-switch animation, delete replaced custom animation code, and make this the future rule.

## Decision

Adopt Animata as a vendored component pattern rather than an npm package. Animata's official docs describe it as a React and Tailwind component collection that is copied into a project, so selected primitives live under `components/animata/`.

Use `motion`, `clsx`, and `tailwind-merge` as supporting dependencies for the adapted Animata primitives. `motion` owns intentional page switches, post positioning, card reflow, reveal, collapse, loading, menu animation, and active indicators. `clsx` and `tailwind-merge` provide the conventional `cn` helper used by Animata/shadcn-style components.

Replace the old article animation utilities with:

- `components/animata/*` for visual animation and skeleton loading.
- `components/animata/PageTransition.tsx` mounted by `components/AppShell.tsx` for normal route/page switches.
- `lib/hooks/useBlogExpansionState.ts` for article route/list state, motion phase orchestration, user-input cancellation, and cleanup of Motion controls.
- `lib/postLayout.ts` for DOM measurement, temporary scroll runway, direct positioning, and Motion-backed scroll/top interpolation.
- `lib/blogRouteState.ts` for route classification shared by the page transition and article state machine.
- `components/Link.tsx` backed by Next.js `Link` for internal client-side navigation.

Normal route switches are animated by the Animata/Motion page transition. The transition compares the previous and next normalized pathnames and suppresses itself only when `lib/blogRouteState.ts` reports a pending article expansion, pending article collapse, or current browser Back list-return context. Direct navigation from an article route to tags, categories, or another normal page still uses the generic page transition because the article expansion state machine does not own that flow.

Route-level `loading.tsx` files render the shared Animata skeleton so App Router transitions keep a stable shell instead of showing a blank flash. The skeleton is pending navigation/loading UI, not a post-commit replay effect. Initial render, already-rendered route content, and unchanged cards do not replay entry animation after content has committed; post expansion, collapse, card reflow, route/page switches, language active-state changes, and back-to-top scrolling remain animated through Animata/Motion primitives. Motion-driven scroll positioning must reserve enough temporary runway for bottom-of-list posts, and explicit user scroll input must cancel active programmatic scroll controls instead of rebounding.

New animation or loading work must reuse or extend `components/animata/*`, or use a mature library when it clearly reduces custom code and fits the route/article ownership boundaries. When a custom animation is replaced, the old hand-written animation code must be removed in the same change.

## Consequences

Benefits:

- Animation behavior has one owner: the Animata-derived component layer.
- Blog-specific route and scroll restoration logic no longer contains custom easing or RAF animation loops.
- Internal navigation uses App Router client transitions and prefetching, reducing visible reload flashes.
- Loading UI is shared and consistent across home, article, tag, and category routes.
- Normal page switches animate without masking article-specific expansion/collapse motion.
- The future development rule is explicit and reviewable.

Costs:

- `motion`, `clsx`, and `tailwind-merge` increase dependency surface and bundle review scope.
- Animata snippets must be adapted to this design system and audited for reduced-motion behavior before use.
- Exact article expansion timing is now owned by Motion layout/reveal primitives rather than a local duration constant.
- Route classification must stay in sync with article URL rules so generic page transitions do not run during article open/close flows.

## Rejected alternatives

Rejected: install the npm package named `animata`.

Reason: it is unrelated to animata.design and is stale.

Rejected: keep the old local post animation helpers and only wrap components with Animata names.

Reason: that would leave the replaced custom animation wheel in place and violate the migration requirement.

Rejected: rely only on Next.js `loading.tsx` while keeping plain internal anchors.

Reason: plain anchors can still trigger full document navigations, so they do not provide SPA-style loading.

Rejected: adopt Next.js experimental View Transitions for this repair.

Reason: the local Next.js and React versions do not expose the current stable Link/ViewTransition APIs, and the Next.js option is still marked experimental for production use.

Rejected: adopt `next-view-transitions` for this repair.

Reason: it is mature enough to consider, but it targets basic App Router transitions and would add risk around this blog's custom article expansion/collapse state machine without reducing the current narrow Motion implementation.
