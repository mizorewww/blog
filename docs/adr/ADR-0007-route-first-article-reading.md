---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-07-10
verified_by: command
related_code:
  - app/[locale]/[...slug]/page.tsx
  - app/[locale]/categories/page.tsx
  - app/[locale]/categories/[category]/page.tsx
  - app/[locale]/tags/page.tsx
  - app/[locale]/tags/[tag]/page.tsx
  - app/theme-providers.tsx
  - layouts/PostLayout.tsx
  - layouts/ListLayoutWithTags.tsx
  - components/PostCard.tsx
  - components/AppShell.tsx
  - components/ArticleReturnLink.tsx
  - components/BlogListNavigationRecorder.tsx
  - components/ArticleReader.tsx
  - components/ArticleTableOfContents.tsx
  - components/animata/ArticleRouteSkeleton.tsx
  - lib/articleFragment.ts
  - lib/articleReturn.ts
  - lib/blogRouteState.ts
  - lib/content/posts.ts
  - lib/listPosts.ts
  - tests/e2e/article-navigation.spec.ts
  - tests/e2e/term-routes.spec.ts
update_when:
  - article or list route rendering changes
  - article return navigation changes
  - scroll restoration ownership changes
  - animation or reduced-motion policy changes
  - route loading or static HTML visibility changes
supersedes: docs/adr/ADR-0005-adopt-animata-for-blog-animation.md
superseded_by:
---

# ADR-0007: Route-First Article Reading

Status: accepted
Date: 2026-07-10
Owner: codex-agent
Related code: `app/[locale]/[...slug]/page.tsx`, `app/[locale]/categories/page.tsx`, `app/[locale]/categories/[category]/page.tsx`, `app/[locale]/tags/page.tsx`, `app/[locale]/tags/[tag]/page.tsx`, `app/theme-providers.tsx`, `layouts/PostLayout.tsx`, `layouts/ListLayoutWithTags.tsx`, `components/PostCard.tsx`, `components/AppShell.tsx`, `components/ArticleReturnLink.tsx`, `components/BlogListNavigationRecorder.tsx`, `components/ArticleReader.tsx`, `components/ArticleTableOfContents.tsx`, `components/animata/ArticleRouteSkeleton.tsx`, `lib/articleFragment.ts`, `lib/articleReturn.ts`, `lib/blogRouteState.ts`, `lib/content/posts.ts`, `lib/listPosts.ts`, `tests/e2e/article-navigation.spec.ts`, `tests/e2e/term-routes.spec.ts`
Supersedes: ADR-0005
Amended by: ADR-0008 for the article transition overlay, duration, and displacement clauses only
Superseded by:

## Context

The previous article route reused the complete blog list, located one card inside that list, and revealed the selected MDX body as a disclosure. Opening and closing therefore required route-motion context, card reflow, long-document height interpolation, delayed scroll restoration, and coordination with the generic page transition.

That model had several structural failures. A direct article request could place unrelated cards before the requested article. The close control could be thousands of pixels below the article heading and could call browser Back without a valid in-site destination. A parent route commit could unmount the body before its exit transition finished. Fixed animation and scroll timers disagreed with both actual layout duration and reduced-motion settings. Animating a full article from `height: 0` to `height: auto` also made layout work proportional to document size.

The stable content boundary from ADR-0003 remains valid: list routes must not receive compiled MDX runtime code, and the browser must not evaluate it. The missing decision is how list and article routes should own layout, navigation, loading, scroll, and motion.

## Decision

Article reading is route-first:

- Blog list, category, tag, and search results use ordinary Next.js `Link` navigation. Plain primary clicks, modified clicks, new-tab behavior, focus, prefetching, and accessibility semantics stay with Next.js and the browser. Animation correctness must not depend on intercepting a list link.
- A list route RSC renders only serialized card data. It does not render, import, or carry any article MDX body.
- An article route RSC renders only the requested article, its table of contents, and adjacent-article navigation. It does not render the complete article list or represent the article as an expanded list card.
- The requested article body is present in the server-rendered static HTML and visible by default. JavaScript, hydration, Motion, and route history are not prerequisites for reading it.
- Article-specific client behavior is limited to small islands such as reading progress, an interactive table of contents, copy controls, widgets, and the return control. `ArticleReader` may wrap server-rendered children only to retain the article DOM ref used by `ReadingProgress` and to capture plain same-document fragment clicks. It delegates URL validation to `lib/articleFragment.ts`, preserves the existing Next.js history state with `replaceState()`, and scrolls the validated target without smooth behavior so a fragment does not insert a history entry. It does not import article data or MDX, transform its children, or control body visibility. These islands do not own the article body or its initial visibility.

The article header provides an explicit return control. Its normal destination is the localized home route. It may use `history.back()` only when an explicit, current-tab navigation marker proves that a same-origin, same-locale blog list opened the current article through a plain primary `Link` interaction. The marker stores only the source URL, exact target URL, and creation time; history length is not a history-index signal and is not stored. During article hydration, the return island accepts only a fresh marker created after the current document time origin for the exact article URL, immediately clears it, and retains the proven result only in that article-path-keyed component instance. Time spent reading does not expire an already proven instance. Direct requests, refreshes, external referrers, new tabs, expired or mismatched markers, article-to-article navigation, and unknown history all use the localized home fallback. Recording must not prevent or replace Link navigation, and a return action must never leave the site because history provenance is assumed.

The browser and Next.js are the single owners of route scroll behavior. The application does not use `scroll: false`, saved `scrollY`, delayed scroll restoration, temporary scroll runway, smooth-scroll timers, or post-route correction for article open and return. A validated browser Back uses native history restoration. The localized-home fallback performs normal Link navigation. A plain same-document fragment anchor inside the article validates its same-origin pathname, search, decoded target ID, and target existence, then uses `history.replaceState()` with the existing Next.js history state before scrolling the target without smooth behavior. This updates the shareable hash without inserting an entry between the proven article and its list source. Modified clicks and new-tab targets retain native behavior.

The article body is not a disclosure. It must not use height interpolation, opacity gating, `AnimatePresence` exit, or a client-mounted collapsed state. Motion is normally limited to optional, local opacity and transform effects on small interface elements or bounded article-header media. Those effects finish within 220 ms, move no more than 8 px, do not delay readable content, and do not cause layout movement. A single interaction has at most one primary visible animation. ADR-0008 defines one narrow exception: an inert fixed snapshot may use a longer, larger transform to connect a source card and the independent article route. That snapshot never owns, gates, or retains the article body.

Use two timing bands:

- Fast feedback: 160-180 ms.
- Standard route or component feedback: 200-220 ms.

The application-level Motion configuration uses `reducedMotion="user"`. Reduced-motion mode removes nonessential transforms, stagger, smooth scrolling, and animation-dependent waits. Content and focus behavior remain identical.

Loading UI is opt-in and must match the destination geometry. The localized ancestor, article route, and category/tag index and detail routes do not define `loading.tsx`: with this static export, a streaming fallback can leave the final content in a hidden `S:0` segment behind a `B:0` boundary when JavaScript is disabled, which violates the server-first content contract. These routes expose their pre-rendered final HTML directly. An ordinary in-app article Link may trigger a presentation-only overlay in `AppShell`; ADR-0008 changes that overlay from an always-skeletal pending state to a structured full-card snapshot when complete card data and geometry exist, with the single-article skeleton retained for search and sidebar origins. The overlay does not prevent or replace Link navigation. Modified clicks, direct requests, refreshes, and JavaScript-disabled loads do not depend on it. Search uses its already-rendered shell and local result loading state. No route may briefly display a skeleton for a different destination geometry.

## Consequences

Benefits:

- Direct, refreshed, and JavaScript-disabled article and term requests put the requested content first and keep it readable.
- List and article RSC payloads have explicit, testable content boundaries.
- Opening an article no longer animates document height or coordinates multiple scroll owners.
- Return behavior is deterministic for list-origin navigation and safe for direct entry.
- Reduced-motion behavior no longer depends on animation timers.
- The optional article-link fallback preserves reader geometry without making static article visibility depend on a streaming boundary.

Costs:

- Inline expansion is removed, but ADR-0008 permits a route-independent App Store-style snapshot to visually connect the card and reading surface without moving the body back into the list.
- Article and list routes need distinct layouts, and client article navigation needs a small disposable transition overlay.
- Native Back restoration can vary by browser, so browser tests must cover supported desktop and mobile viewports without adding corrective scroll logic.
- A reliable same-tab source marker adds a small client boundary around the return action, even though article rendering remains server-first.

Constraints:

- ADR-0003 continues to govern MDX compilation and the prohibition on client MDX evaluation.
- Motion and Animata-derived primitives may remain for bounded UI effects, but ADR-0005 no longer governs article route ownership, list expansion, scroll orchestration, or animation timing.
- Intermediate animation and scroll states are part of browser validation; a final URL assertion alone is insufficient.

## Rejected alternatives

Rejected: continue repairing the inline list-card expansion and collapse state machine.

Reason: the long-document layout, route commit, body lifetime, and scroll-restoration conflicts are consequences of that ownership model, not isolated easing defects.

Rejected: present the readable article itself in a persistent overlay, drawer, or modal above the list.

Reason: article URLs must remain directly loadable, refreshable, linkable, searchable, and readable without client state. A persistent reading overlay also preserves two competing page layouts and focus/scroll owners. ADR-0008's fixed snapshot is allowed because it is short-lived, inert, presentation-only, and never contains or owns the article.

Rejected: adopt experimental View Transition APIs or a new transition library.

Reason: the repair does not require a new dependency. Route-first rendering, native history, and the installed Motion primitives cover the bounded effects while avoiding experimental lifecycle coupling.

Rejected: keep one generic loading skeleton for every blog route.

Reason: a skeleton that does not match the destination layout introduces the same geometry flash that loading UI is intended to prevent.
