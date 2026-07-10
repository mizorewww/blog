---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-07-10
verified_by: command
related_code:
  - app/[locale]/[...slug]/page.tsx
  - app/[locale]/[...slug]/loading.tsx
  - app/[locale]/loading.tsx
  - layouts/ListLayoutWithTags.tsx
  - components/ExpandablePostCard.tsx
  - components/AppShell.tsx
  - components/Link.tsx
  - components/animata
  - lib/content/posts.ts
  - lib/i18n.ts
  - lib/listPosts.ts
  - tests/e2e
update_when:
  - article or list route rendering changes
  - article return navigation changes
  - scroll restoration ownership changes
  - animation or reduced-motion policy changes
  - route loading skeleton geometry changes
supersedes: docs/adr/ADR-0005-adopt-animata-for-blog-animation.md
superseded_by:
---

# ADR-0007: Route-First Article Reading

Status: accepted
Date: 2026-07-10
Owner: codex-agent
Related code: `app/[locale]/[...slug]/page.tsx`, `app/[locale]/[...slug]/loading.tsx`, `app/[locale]/loading.tsx`, `layouts/ListLayoutWithTags.tsx`, `components/ExpandablePostCard.tsx`, `components/AppShell.tsx`, `components/Link.tsx`, `components/animata`, `lib/content/posts.ts`, `lib/i18n.ts`, `lib/listPosts.ts`, `tests/e2e`
Supersedes: ADR-0005
Superseded by:

## Context

The article route currently reuses the complete blog list, locates one card inside that list, and reveals the selected MDX body as a disclosure. Opening and closing therefore require route-motion context, card reflow, long-document height interpolation, delayed scroll restoration, and coordination with the generic page transition.

That model has several structural failures. A direct article request can place unrelated cards before the requested article. The close control can be thousands of pixels below the article heading and can call browser Back without a valid in-site destination. A parent route commit can unmount the body before its exit transition finishes. Fixed animation and scroll timers disagree with both actual layout duration and reduced-motion settings. Animating a full article from `height: 0` to `height: auto` also makes layout work proportional to document size.

The stable content boundary from ADR-0003 remains valid: list routes must not receive compiled MDX runtime code, and the browser must not evaluate it. The missing decision is how list and article routes should own layout, navigation, loading, scroll, and motion.

## Decision

Article reading is route-first:

- Blog list, category, tag, and search results use ordinary Next.js `Link` navigation. Plain primary clicks, modified clicks, new-tab behavior, focus, prefetching, and accessibility semantics stay with Next.js and the browser. Animation correctness must not depend on intercepting a list link.
- A list route RSC renders only serialized card data. It does not render, import, or carry any article MDX body.
- An article route RSC renders only the requested article, its table of contents, and adjacent-article navigation. It does not render the complete article list or represent the article as an expanded list card.
- The requested article body is present in the server-rendered static HTML and visible by default. JavaScript, hydration, Motion, and route history are not prerequisites for reading it.
- Article-specific client behavior is limited to small islands such as reading progress, an interactive table of contents, copy controls, widgets, and the return control. These islands do not own the article body or its initial visibility.

The article header provides an explicit return control. Its normal destination is the localized home route. It may use `history.back()` only when an explicit, current-tab navigation marker proves that the immediately preceding entry is a same-origin blog list route and that it opened the current article. The marker may be recorded by a plain `Link` interaction, but it must not prevent or replace the Link navigation. Direct requests, refreshes, external referrers, new tabs, expired or mismatched markers, and unknown history all use the localized home fallback. A return action must never leave the site because history provenance is assumed.

The browser and Next.js are the single owners of route scroll behavior. The application does not use `scroll: false`, saved `scrollY`, delayed scroll restoration, temporary scroll runway, smooth-scroll timers, or post-route correction for article open and return. A validated browser Back uses native history restoration. The localized-home fallback performs normal Link navigation.

The article body is not a disclosure. It must not use height interpolation, opacity gating, `AnimatePresence` exit, or a client-mounted collapsed state. Motion is limited to optional, local opacity and transform effects on small interface elements or bounded article-header media. Those effects finish within 220 ms, move no more than 8 px, do not delay readable content, and do not cause layout movement. A single interaction has at most one primary visible animation.

Use two timing bands:

- Fast feedback: 160-180 ms.
- Standard route or component feedback: 200-220 ms.

The application-level Motion configuration uses `reducedMotion="user"`. Reduced-motion mode removes nonessential transforms, stagger, smooth scrolling, and animation-dependent waits. Content and focus behavior remain identical.

Loading UI is route-specific and matches the destination geometry. List routes use list skeletons, article routes use a single-reader skeleton, and term or search routes use their own shape or no skeleton when the route is already static and immediate. A route must not briefly display a three-column article-card skeleton before resolving to a different layout.

## Consequences

Benefits:

- Direct, refreshed, and JavaScript-disabled article requests put the requested content first and keep it readable.
- List and article RSC payloads have explicit, testable content boundaries.
- Opening an article no longer animates document height or coordinates multiple scroll owners.
- Return behavior is deterministic for list-origin navigation and safe for direct entry.
- Reduced-motion behavior no longer depends on animation timers.
- Loading states preserve destination geometry and reduce layout shifts.

Costs:

- The previous illusion that a card expands in place is removed.
- Article and list routes need distinct layouts and loading states.
- Native Back restoration can vary by browser, so browser tests must cover supported desktop and mobile viewports without adding corrective scroll logic.
- A reliable same-tab source marker adds a small client boundary around the return action, even though article rendering remains server-first.

Constraints:

- ADR-0003 continues to govern MDX compilation and the prohibition on client MDX evaluation.
- Motion and Animata-derived primitives may remain for bounded UI effects, but ADR-0005 no longer governs article route ownership, list expansion, scroll orchestration, or animation timing.
- Intermediate animation and scroll states are part of browser validation; a final URL assertion alone is insufficient.

## Rejected alternatives

Rejected: continue repairing the inline list-card expansion and collapse state machine.

Reason: the long-document layout, route commit, body lifetime, and scroll-restoration conflicts are consequences of that ownership model, not isolated easing defects.

Rejected: present articles in an overlay, drawer, or modal above the list.

Reason: article URLs must remain directly loadable, refreshable, linkable, searchable, and readable without client state. An overlay also preserves two competing page layouts and focus/scroll owners.

Rejected: adopt experimental View Transition APIs or a new transition library.

Reason: the repair does not require a new dependency. Route-first rendering, native history, and the installed Motion primitives cover the bounded effects while avoiding experimental lifecycle coupling.

Rejected: keep one generic loading skeleton for every blog route.

Reason: a skeleton that does not match the destination layout introduces the same geometry flash that loading UI is intended to prevent.
