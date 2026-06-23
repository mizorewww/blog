---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-06-23
verified_by: source citation
related_code:
  - components/animata
  - components/Link.tsx
  - layouts/ListLayoutWithTags.tsx
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
Related code: `components/animata`, `components/Link.tsx`, `layouts/ListLayoutWithTags.tsx`, `lib/hooks/useBlogExpansionState.ts`, `lib/postLayout.ts`, `package.json`
Supersedes:
Superseded by:

## Context

The blog previously kept article expansion, collapse, scroll positioning, and body reveal animation in local utilities. That preserved the route-aware reading experience, but it mixed business state with hand-written easing, requestAnimationFrame loops, Tailwind transition classes, and loading behavior.

The site also rendered internal links through plain anchors. That bypassed Next.js App Router client navigation for normal internal links and could show a full document reload flash while moving between static pages.

The user requirement is to migrate animation-related behavior to <https://animata.design/>, keep loading SPA-like, delete replaced custom animation code, and make this the future rule.

## Decision

Adopt Animata as a vendored component pattern rather than an npm package. Animata's official docs describe it as a React and Tailwind component collection that is copied into a project, so selected primitives live under `components/animata/`.

Use `motion`, `clsx`, and `tailwind-merge` as supporting dependencies for the adapted Animata primitives. `motion` owns layout, reveal, collapse, route, and menu animation. `clsx` and `tailwind-merge` provide the conventional `cn` helper used by Animata/shadcn-style components.

Replace the old article animation utilities with:

- `components/animata/*` for visual animation and skeleton loading.
- `lib/hooks/useBlogExpansionState.ts` for article route/list state only.
- `lib/postLayout.ts` for direct scroll positioning and restoration only.
- `components/Link.tsx` backed by Next.js `Link` for internal client-side navigation.

Route-level `loading.tsx` files render the shared Animata skeleton so App Router transitions keep a stable shell instead of showing a blank flash.

New animation or loading work must reuse or extend `components/animata/*`. When a custom animation is replaced, the old hand-written animation code must be removed in the same change.

## Consequences

Benefits:

- Animation behavior has one owner: the Animata-derived component layer.
- Blog-specific route and scroll restoration logic no longer contains custom easing or RAF animation loops.
- Internal navigation uses App Router client transitions and prefetching, reducing visible reload flashes.
- Loading UI is shared and consistent across home, article, tag, and category routes.
- The future development rule is explicit and reviewable.

Costs:

- `motion`, `clsx`, and `tailwind-merge` increase dependency surface and bundle review scope.
- Animata snippets must be adapted to this design system and audited for reduced-motion behavior before use.
- Exact article expansion timing is now owned by Motion layout/reveal primitives rather than a local duration constant.

## Rejected alternatives

Rejected: install the npm package named `animata`.

Reason: it is unrelated to animata.design and is stale.

Rejected: keep the old local post animation helpers and only wrap components with Animata names.

Reason: that would leave the replaced custom animation wheel in place and violate the migration requirement.

Rejected: rely only on Next.js `loading.tsx` while keeping plain internal anchors.

Reason: plain anchors can still trigger full document navigations, so they do not provide SPA-style loading.
