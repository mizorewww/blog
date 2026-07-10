---
status: active
audience: agent
authority: note
owner: docs-maintainer
last_verified: 2026-07-10
verified_by: command
related_code:
  - app/[locale]/[...slug]/page.tsx
  - layouts/PostLayout.tsx
  - layouts/ListLayoutWithTags.tsx
  - components/PostCard.tsx
  - components/MDXServerRenderer.tsx
  - components/ArticleReturnLink.tsx
  - components/BlogListNavigationRecorder.tsx
  - lib/articleReturn.ts
  - contentlayer/config
  - lib/content/posts.ts
  - lib/listPosts.ts
  - scripts/postbuild.mjs
update_when:
  - refactor status changes
  - architecture changes
  - article rendering boundaries change
  - historical cleanup records need correction
supersedes:
superseded_by:
---

# Code Review Refactor Plan

Date: 2026-06-22
Branches: `refactor/code-review-architecture`, `refactor/complete-deferred-goals`

This note records the scope and durable outcomes of the 2026-06 refactor. It is not the source of truth for current article interaction. [ADR-0007](./adr/ADR-0007-route-first-article-reading.md) governs route-first reading, return navigation, scroll ownership, loading geometry, and animation limits; [architecture.md](./architecture.md) describes the current boundaries.

## Goals

- [x] Remove dead legacy route scaffolding and reduce duplicated default-locale page logic.
- [x] Move reusable term index/page metadata logic into shared content/view helpers.
- [x] Split large client components into focused hooks and components.
- [x] Move scattered UI copy into the locale dictionary where the current refactor touches it.
- [x] Modularize `contentlayer.config.ts` so Git history, remark, rehype, and document type code are isolated.
- [x] Add short-term guardrails around known hacks without changing the public URL model.
- [x] Complete the queued route, MDX, theme, icon, strict TypeScript, and script-sharing cleanup.
- [x] Verify with lint/type/build-equivalent checks and commit each batch atomically.

## Completed Refactors

- `contentlayer.config.ts` is now an entry file; implementation lives under `contentlayer/config/`.
- Home, category, and tag page data builders are shared through `lib/content/homePage.ts` and `lib/content/termPages.ts`.
- The former `ExpandablePostCard` delegated Git metadata, license copy, relative time, route prefetching, and meta icons to focused modules. It was later replaced by the route-first `PostCard` and `PostLayout` split from ADR-0007.
- Blog sidebars are split into `BlogFrame`, `ProfileSidebar`, `UtilitySidebar`, and `BlogWidgetCard`.
- Root metadata uses the shared SEO generator, and `app/seo.tsx` is now `app/seo.ts`.
- Common post date selection is centralized in `lib/postDates.ts`.
- No-locale `app/` mirror routes and empty legacy blog route directories were removed; redirects now send historical `/`, `/tags`, and `/categories` paths to `/zh/...`.
- GitHub API access in Contentlayer uses `fetch` with timeout, retry, optional `GITHUB_TOKEN`/`GH_TOKEN`, and a `.contentlayer` cache.
- `siteMetadata` is typed TypeScript and script-side RSS/SEO helpers reuse shared locale, URL, post sorting, and date utilities.
- Contentlayer writes generated ESM modules for server-rendered detail pages, and list routes receive card projections instead of compiled MDX code.
- `_post-data` body JSON generation and client body-code preloading were removed with the browser eval path.
- Dark surface/border colors are semantic Tailwind tokens, strict TypeScript is enabled, ESLint unused variables is re-enabled, and `ecmaVersion` is set to `2022`.
- Theme-aware TradingView widgets use `next-themes`; icons are resolved from `lucide-react`'s generated icon map.
- Production builds generate Contentlayer data before `next build` instead of loading the Contentlayer webpack plugin, which avoids upstream webpack cache warnings from Contentlayer's dynamic generated-module import.

The same refactor also introduced sessionStorage pending motion, `useBlogExpansionState`, list-card body disclosure, `scroll: false`, and delayed position restoration to preserve the earlier expansion interaction. Those details are historical, not durable outcomes. ADR-0007 superseded that route/list state machine, and its implementation files have been removed.

## Verification

- `yarn tsc --noEmit --pretty false`
- `yarn eslint --fix app components data lib layouts scripts contentlayer.config.ts contentlayer eslint.config.mjs`
- `yarn build`

## Completed Cleanup Items

The durable cleanup outcomes are:

- Contentlayer runtime MDX eval was removed from server-rendered detail pages and from the former client expansion path. Article bodies render through a static detail route boundary.
- Hard-coded dark surface colors were replaced by semantic tokens where they appeared in the reviewed UI paths.
- `strict: true` is enabled.
- No-locale static route implementations were removed and replaced with redirect rules.

## Remaining Watch Items

- The lucide icon registry is generated from source and MDX usage so articles can still use arbitrary `:icon-*:` shortcodes without bundling the entire lucide icon map.
- Article visibility in the static export must remain independent of route loading boundaries. The localized ancestor and article `loading.tsx` files were removed because their streaming handoff hides the final article when JavaScript is disabled; ordinary in-app article links instead use the presentation-only `ArticleRouteSkeleton` overlay.
- Safe article return is implemented through an explicit same-tab, same-origin list marker. Reviews must keep direct entry, refresh, new-tab entry, expired markers, and unknown history on the localized-home fallback.
