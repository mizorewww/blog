---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-07-11
verified_by: source citation
related_code:
  - app/theme-providers.tsx
  - components/AppShell.tsx
  - components/ArticleCardPresentation.tsx
  - components/ArticleGitMeta.tsx
  - components/ArticleTransitionContext.tsx
  - components/PostCard.tsx
  - components/PostMeta.tsx
  - components/BlogListNavigationRecorder.tsx
  - components/ArticleReturnLink.tsx
  - components/animata/ArticleCardTransitionOverlay.tsx
  - components/animata/ArticleRouteSkeleton.tsx
  - components/animata/motion.ts
  - layouts/PostLayout.tsx
  - lib/articleReturn.ts
  - lib/articleTransition.ts
  - lib/blogRouteState.ts
  - tests/e2e/article-card-transition.spec.ts
  - tests/e2e/article-navigation.spec.ts
  - tests/unit/articleTransition.test.ts
update_when:
  - article open or return transition behavior changes
  - transition snapshot geometry or ownership changes
  - article navigation, history, or scroll ownership changes
  - reduced-motion policy changes
  - Motion or Next.js transition APIs change
supersedes:
superseded_by:
---

# ADR-0008: App Store Article Card Transition

Status: accepted
Date: 2026-07-10
Amended: 2026-07-11
Owner: codex-agent
Related code: `app/theme-providers.tsx`, `components/AppShell.tsx`, `components/ArticleCardPresentation.tsx`, `components/ArticleGitMeta.tsx`, `components/ArticleTransitionContext.tsx`, `components/PostCard.tsx`, `components/PostMeta.tsx`, `components/BlogListNavigationRecorder.tsx`, `components/ArticleReturnLink.tsx`, `components/animata/ArticleCardTransitionOverlay.tsx`, `components/animata/ArticleRouteSkeleton.tsx`, `components/animata/motion.ts`, `layouts/PostLayout.tsx`, `lib/articleReturn.ts`, `lib/articleTransition.ts`, `lib/blogRouteState.ts`, `tests/e2e/article-card-transition.spec.ts`, `tests/e2e/article-navigation.spec.ts`, `tests/unit/articleTransition.test.ts`
Amends: the article-overlay, maximum-displacement, 220 ms transition, and validated opening-handoff pixel visibility and presentation-staging constraints in ADR-0007 only; it does not amend static destination DOM ownership
Supersedes:
Superseded by:

## Context

ADR-0007 separated article content from the list and made each article URL an independent, statically rendered reading page. That boundary fixed direct-entry, refresh, no-JavaScript, history, and long-document layout failures, but the replacement pending skeleton does not preserve the visual relationship between the card the reader selected and the article that opens. The requested interaction is the visual guidance of the iOS App Store: the selected card appears to expand into a bounded reading surface, and a proven return appears to settle back into its source card, while the URL and content remain route-first.

This is a continuity problem, not a request to restore inline article disclosure. The article body must remain owned by the destination route and directly visible in static HTML. A transition layer therefore cannot clone the live card DOM, host MDX, become an interactive modal, intercept navigation, delay history traversal, or take ownership of scroll restoration.

The decision is based on the following primary documentation, accessed 2026-07-11:

- Next.js [`Link`](https://nextjs.org/docs/app/api-reference/components/link) documents native anchor attributes, client navigation, prefetching, and default history/scroll behavior. [Static exports](https://nextjs.org/docs/app/guides/static-exports) defines the deployment boundary that requires final article HTML to stand alone. Next.js marks [`experimental.viewTransition`](https://nextjs.org/docs/app/api-reference/config/next-config-js/viewTransition) experimental and not recommended for production.
- Motion documents transform-based [`layout` and `layoutId` animations](https://motion.dev/docs/react-layout-animations), its official [iOS App Store card example](https://motion.dev/examples/react-app-store), and [`AnimatePresence`](https://motion.dev/docs/react-animate-presence) for retaining a visual element through exit. Its [accessibility guide](https://motion.dev/docs/react-accessibility) specifies `MotionConfig reducedMotion="user"` and replacing large transform motion for reduced-motion users. Its [installation guide](https://motion.dev/docs/react-installation) confirms App Router support and the existing `motion/react` client boundary.
- MDN documents that [`popstate`](https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event) follows history traversal, that [`history.scrollRestoration`](https://developer.mozilla.org/en-US/docs/Web/API/History/scrollRestoration) controls browser restoration mode, and that [`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion) expresses the user's request to minimize nonessential motion.

The initial structured snapshot treated card metadata as one flattened visual block and allowed the overlay title to fade before the destination title took over. Because `PostCard`, the snapshot, and `PostLayout` could render that title with different font metrics, the handoff exposed a perceptible flash. A later shared-presentation repair still exposed destination pixels before card motion completed: the destination cover appeared early, while controls and article-only metadata that had no source counterpart flashed beneath or above the snapshot. The continuity contract therefore needs to cover every element visible on the source card and explicitly stage destination-only presentation, not only project the card surface and cover.

## Decision

Keep ADR-0007's route-first content and navigation architecture. Add one App Store-inspired, presentation-only transition layer above route content using the already-installed Motion package. No dependency is added, and the experimental Next.js/React View Transition integration is not enabled.

The transition layer follows these ownership rules:

- Every article target remains an ordinary Next.js `Link`. The observer may capture a plain primary navigation and render transition state, but it must not call `preventDefault()`, replace the link action, set `scroll: false`, or defer navigation until animation completion. Modified clicks, new tabs, downloads, external targets, and failed capture keep native behavior and do not start the large transition.
- The visual is a fixed, structured React snapshot with `aria-hidden="true"` and `pointer-events: none`. It is reconstructed from the minimum serialized card fields and measured rectangles; it never uses `cloneNode()`, cloned interactive descendants, copied article HTML, or client MDX evaluation. It cannot receive focus or obscure the semantic destination from assistive technology.
- `PostCard`, `ArticleCardTransitionOverlay`, and the shared header region in `PostLayout` must consume one presentation contract. The elements visible on a full source card are typed separately as surface, cover, title, Git-relative update text, source affordance, summary, published date, primary tag, and read-more affordance. Metadata must not be flattened into one opaque string or DOM fragment because each child needs an explicit identity, order, and layout target.
- Surface, cover, title, Git information, summary, published date, and primary tag persist into the article header. Their typography, line height, order, wrapping constraints, and destination geometry must be identical between the overlay's final frame and `PostLayout`; each child receives its own layout projection. Persistent elements must not use an opacity crossfade to conceal mismatched rendering. The Git-relative update text is frozen when the source snapshot is captured so a clock tick or hydration cannot change the string during the transition.
- The read-more affordance remains source-only and inert inside the overlay. It preserves its layout space while it smoothly fades during expansion, and it is restored as the collapse approaches the source card; it must not become a focusable or self-referential article-page control. No other source-card element may disappear abruptly at route handoff.
- After the target pathname has committed during a validated full-`PostCard` opening, the fixed transition layer may add an inert opaque page underlay behind the structured card snapshot. The underlay exists only until both signals are true: the target route has committed and the card motion has reached its destination geometry. It prevents the destination cover and other destination pixels from being painted into the user's topmost view before handoff; it does not unmount, hide, restyle, or gate the semantic destination DOM beneath it.
- Destination-only presentation is limited to explicitly marked, bounded article-header controls and article-only metadata. Only those marked header elements may use `opacity: 0` while a validated opening is active, followed by a `180 ms` reveal after the card snapshot and underlay hand off. The article body and every body ancestor are outside this marker contract and remain statically visible beneath the presentation-only layers. Shared surface, cover, title, Git information, summary, published date, and primary tag never use an opacity crossfade: their snapshot remains the topmost painted representation through the final motion frame, then hands off to pixel-compatible destination rendering. Unmarked destination content remains static and must not acquire transition state accidentally.
- The underlay is opening-only. Only an already validated full-`PostCard` opening may obscure destination pixels, and only for the bounded interval ending at handoff. Direct entry, refresh, modified or new-tab navigation, incomplete capture, invalid geometry, route failure or mismatch, interrupted motion, and every return path render no underlay. Return continues to use the article snapshot and restored card target without covering the list page.
- A full `PostCard` source supplies the typed presentation fields and measured viewport rectangle so the complete card morphs. An article link from search results or a sidebar, where full card data and geometry are unavailable, uses the single-article skeleton snapshot rather than inventing a partial card. Missing data, an invalid rectangle, storage failure, route mismatch, interruption, or a viewport resize immediately removes every presentation layer and clears destination-only staging, leaving ordinary routing and destination pixels visible.
- The overlay is fixed to the viewport at `z-index: 40`; the Header remains above it at `z-index: 50`. It does not change document layout or lock scrolling. At `320px` and `390px`, the destination surface spans the viewport width, begins at `top: 72px`, and has `border-radius: 0`. At `1440px`, it is `780px` wide, centered horizontally, begins at `top: 120px`, and has an `8px` radius. Intermediate widths interpolate through responsive CSS constraints without covering the Header.
- A normal open transition lasts `380 ms`; a proven return transition lasts `340 ms`. Both use easing `[0.32, 0.72, 0, 1]`. The opening snapshot expands from the measured source card to the destination reading-surface geometry while the route commits independently. The snapshot may remain just long enough to finish its own bounded exit, but the real article is not withheld, opacity-gated, or height-animated beneath it.
- A return action starts history or fallback Link navigation immediately. It does not wait for the `340 ms` animation. A collapse snapshot is allowed only when the current article has a proven same-tab list source and the restored destination exposes the matching full card target. After the list route commits, it resolves the target's current rectangle and settles there. If the target is absent, virtualized away, changed, or invalid, the overlay disappears immediately; the application does not scroll to manufacture a target.
- Browser and Next.js remain the only owners of route history and scroll. The transition does not set `history.scrollRestoration`, synthesize `popstate`, save or restore `scrollY`, add history entries, correct Back position, or smooth-scroll. It observes committed path changes only to advance or dispose visual state.
- `AnimatePresence` may retain only the inert snapshot while it exits. It must not retain the old route, old `PostCard` tree, article body, focusable controls, or scroll container. Motion `layoutId` is not shared across simultaneously live route trees; geometry is explicit so stale list and article layouts never become competing owners.
- `MotionConfig reducedMotion="user"` remains application-wide. When reduced motion is requested, large translation and scale morphs are disabled. Navigation and content commit immediately; after at most a brief snapshot cue, the destination presentation appears immediately, with no underlay wait or `180 ms` staged reveal. The final content, focus result, and history result are identical.

The article body and its ancestors remain outside the transition snapshot. They must not use `height: 0 -> auto`, full-body opacity gating, delayed mounting, or route-dependent `AnimatePresence`. The snapshot can visually suggest expansion, but the implementation remains two independent route documents connected by an inert overlay.

## Consequences

Benefits:

- A selected full card provides a single, legible motion path toward the article reading surface without reviving list-owned article state.
- Direct entry, refresh, no-JavaScript reading, modified clicks, and static export remain correct because the effect is progressive enhancement over ordinary links.
- The real article can commit and become readable independently of animation duration, dropped frames, missing geometry, or Motion runtime failure.
- Return motion can reinforce spatial memory when a validated browser restoration exposes the same card, while native history remains authoritative.

Costs:

- The persistent app shell needs a small transition state machine and structured visual duplicate of `PostCard`; card visual changes must keep the snapshot contract synchronized.
- Browser tests must inspect early, mid, end, and settled frames across mobile and desktop, not only the final URL.
- Browser tests must inspect rendered pixels and determine the topmost painted layer at the cover, shared fields, and destination-only controls; DOM presence or computed opacity on an obscured descendant is not sufficient evidence of a correct handoff.
- The `380 ms` and `340 ms` bands are deliberate exceptions to ADR-0007's standard `220 ms` ceiling, and the full-card transform is a deliberate exception to its `8 px` displacement ceiling.
- Search and sidebar origins cannot produce an exact shared-card morph and intentionally retain a destination-shaped skeleton fallback.

Constraints:

- ADR-0007 still governs route ownership, server-rendered article DOM visibility, return provenance, and scroll behavior. This ADR revises only its claim that all article-opening overlays are skeletons, its duration/displacement limits for this one inert transition layer, and the topmost-pixel visibility/presentation staging allowed during a validated opening handoff.
- ADR-0003 still prohibits sending MDX runtime code to list routes or evaluating article code in the browser.
- Transition snapshots and their underlay/staging state are disposable visual hints. Any ambiguity must immediately remove all of them and expose the already-mounted destination pixels; only a validated full-card opening may obscure those pixels until its defined handoff, never by delaying navigation or changing final-content DOM ownership.

## Rejected alternatives

Rejected: restore inline card expansion and render the article body inside the list.

Reason: it reintroduces two content owners, long-document height animation, route ambiguity, and scroll coordination failures that ADR-0007 removed.

Rejected: clone the selected DOM subtree into a fixed overlay.

Reason: cloned IDs and controls create semantic and focus hazards, DOM structure is not a stable data contract, and copied layout can retain event or style assumptions. A small structured snapshot is explicit, inert, and testable.

Rejected: prevent the Link, finish the open animation, and then navigate; or delay Back until collapse finishes.

Reason: animation failure would become navigation failure, modified-click semantics would diverge, and the application would compete with browser history and scroll restoration.

Rejected: enable Next.js `experimental.viewTransition` or add another animation library.

Reason: Next.js still labels its deeper View Transition integration experimental and not recommended for production. The installed Motion package already supplies the required fixed-element transform and exit lifecycle.

Rejected: animate or crossfade the entire article body.

Reason: readable static content must not wait for hydration or animation, and a long-document visual gate would recreate the accessibility and performance failures of the former disclosure model.
