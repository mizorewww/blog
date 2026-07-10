---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-07-10
verified_by: command
related_code:
  - app/[locale]/[...slug]/page.tsx
  - components/MDXServerRenderer.tsx
  - lib/content/posts.ts
  - lib/listPosts.ts
  - scripts/postbuild.mjs
  - public/_headers
update_when:
  - MDX rendering path changes
  - list or article RSC payload boundaries change
  - Content Security Policy changes
  - static export route behavior changes
supersedes:
superseded_by:
---

# ADR-0003: Remove Client MDX Eval From Article Expansion

Status: accepted
Date: 2026-06-23
Owner: codex-agent
Related code: `app/[locale]/[...slug]/page.tsx`, `components/MDXServerRenderer.tsx`, `lib/content/posts.ts`, `lib/listPosts.ts`, `scripts/postbuild.mjs`, `public/_headers`
Supersedes:
Superseded by:

## Context

The blog is a static Next.js App Router export. Contentlayer compiles MDX at build time, and article detail pages already render generated MDX modules through `MDXServerRenderer`.

The list-page expansion path previously generated public post-body JSON containing Contentlayer runtime MDX code and reconstructed the article body in the browser. That preserved the in-place expansion animation, but it required browser-side JavaScript evaluation and a Content Security Policy eval exception.

MDX content can contain client components such as code-copy controls and TradingView widgets. Replacing the route-rendered body with an injected HTML fragment would not hydrate those components correctly.

## Decision

Article bodies render only through the static article detail route. List pages carry only serialized card data and do not import, serialize, or expose compiled MDX body code. The article route imports the requested generated MDX module at build time and renders it through `MDXServerRenderer`, preserving normal React rendering and hydration for MDX client islands.

ADR-0007 supersedes this ADR's former interaction details. It governs ordinary Link navigation, the dedicated article layout, return behavior, loading geometry, scroll ownership, and bounded motion. Those behaviors must not reintroduce client MDX evaluation or place article body code in a list RSC payload.

The `_post-data` generation step and client MDX runtime renderer are removed. The Cloudflare Pages CSP no longer includes the eval exception for article expansion.

## Consequences

Benefits:

- Browser code no longer evaluates Contentlayer MDX runtime strings.
- Public build output no longer exposes article body runtime code through post-body JSON.
- MDX client components keep their normal React hydration path on article routes.
- Article navigation and animation can change independently without weakening the MDX rendering boundary.
- CSP is stricter.

Costs:

- Article routes must keep a server-rendered MDX boundary and hydrate any client islands normally.
- Build and performance checks must continue proving that list payloads do not contain compiled MDX bodies.

Limits:

- The site still allows inline scripts for existing JSON-LD, speculation rules, analytics, and TradingView integration.
- This decision does not migrate away from Contentlayer2 or change the MDX authoring model.

## Rejected alternatives

Rejected: inject build-time-rendered HTML fragments into the list page.

Reason: injected HTML would not hydrate MDX client components such as code-copy controls and TradingView widgets.

Rejected: keep client MDX runtime code and only document the risk.

Reason: static article routes can preserve full MDX behavior without browser-side MDX evaluation.

Rejected: migrate the entire content pipeline to a new MDX library in this change.

Reason: the existing detail route already has a build-time MDX rendering boundary. A full content migration is much larger than the current safety and animation goal.
