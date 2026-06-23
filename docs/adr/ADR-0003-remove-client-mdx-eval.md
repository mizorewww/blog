---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-06-23
verified_by: command
related_code:
  - components/ExpandablePostCard.tsx
  - layouts/ListLayoutWithTags.tsx
  - lib/blogRouteState.ts
  - lib/hooks/usePostExpansion.ts
  - components/MDXServerRenderer.tsx
  - scripts/postbuild.mjs
  - public/_headers
update_when:
  - MDX rendering path changes
  - article expansion behavior changes
  - Content Security Policy changes
  - static export route behavior changes
supersedes:
superseded_by:
---

# ADR-0003: Remove Client MDX Eval From Article Expansion

Status: accepted
Date: 2026-06-23
Owner: codex-agent
Related code: `components/ExpandablePostCard.tsx`, `layouts/ListLayoutWithTags.tsx`, `lib/blogRouteState.ts`, `lib/hooks/usePostExpansion.ts`, `components/MDXServerRenderer.tsx`, `scripts/postbuild.mjs`, `public/_headers`
Supersedes:
Superseded by:

## Context

The blog is a static Next.js App Router export. Contentlayer compiles MDX at build time, and article detail pages already render generated MDX modules through `MDXServerRenderer`.

The list-page expansion path previously generated public post-body JSON containing Contentlayer runtime MDX code and reconstructed the article body in the browser. That preserved the in-place expansion animation, but it required browser-side JavaScript evaluation and a Content Security Policy eval exception.

The project still needs the article expansion animation. Replacing the body with an injected HTML fragment would preserve some visual behavior, but MDX content can contain client components such as code-copy controls and TradingView widgets. Static HTML injection would not hydrate those components correctly.

## Decision

Article bodies render only through the static article detail route. List pages keep carrying only card data.

Cards prefetch the target article route when they enter the viewport, receive focus, or are hovered. On “continue reading”, the card stores the existing motion context, calls `router.push(postHref, { scroll: false })`, and lets the article detail route render the body with `MDXServerRenderer`.

After the detail route commits, `usePostExpansion` consumes the pending motion context and plays the existing expansion animation. During explicit collapse, the card stores a collapse motion context and routes back to the original list URL so home, tag, and category pages regain their server-rendered list data before `usePostExpansion` plays the collapse animation.

The `_post-data` generation step and client MDX runtime renderer are removed. The Cloudflare Pages CSP no longer includes the eval exception for article expansion.

## Consequences

Benefits:

- Browser code no longer evaluates Contentlayer MDX runtime strings.
- Public build output no longer exposes article body runtime code through post-body JSON.
- MDX client components keep their normal React hydration path on article routes.
- The existing list-to-article expansion and collapse animation remains the user-facing transition.
- CSP is stricter.

Costs:

- A cold article route payload can delay the start of the expansion animation.
- Production preview must verify route prefetch behavior because development mode does not match production prefetch semantics.
- The animation now depends on App Router route commit timing rather than local body-code availability.

Limits:

- The site still allows inline scripts for existing JSON-LD, speculation rules, analytics, and TradingView integration.
- This decision does not migrate away from Contentlayer2 or change the MDX authoring model.

## Rejected alternatives

Rejected: inject build-time-rendered HTML fragments into the list page.

Reason: injected HTML would not hydrate MDX client components such as code-copy controls and TradingView widgets.

Rejected: keep client MDX runtime code and only document the risk.

Reason: the architecture can preserve the animation without browser-side MDX evaluation.

Rejected: migrate the entire content pipeline to a new MDX library in this change.

Reason: the existing detail route already has a build-time MDX rendering boundary. A full content migration is much larger than the current safety and animation goal.
