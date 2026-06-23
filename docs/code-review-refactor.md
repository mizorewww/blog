---
status: active
audience: agent
authority: note
owner: docs-maintainer
last_verified: 2026-06-23
verified_by: command
related_code:
  - app
  - components
  - contentlayer
  - lib
  - layouts
update_when:
  - refactor status changes
  - architecture changes
  - cleanup item status changes
supersedes:
superseded_by:
---

# Code Review Refactor Plan

Date: 2026-06-22
Branches: `refactor/code-review-architecture`, `refactor/complete-deferred-goals`

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
- `ExpandablePostCard` delegates Git metadata, license copy, relative time, route prefetching, and meta icons to focused modules.
- `ListLayoutWithTags` delegates expansion route/list state to `useBlogExpansionState`; visible animation is centralized in `components/animata`.
- Blog sidebars are split into `BlogFrame`, `ProfileSidebar`, `UtilitySidebar`, and `BlogWidgetCard`.
- Pending blog navigation motion is persisted in `sessionStorage` instead of relying only on a module variable.
- Root metadata uses the shared SEO generator, and `app/seo.tsx` is now `app/seo.ts`.
- Common post date selection is centralized in `lib/postDates.ts`.
- No-locale `app/` mirror routes and empty legacy blog route directories were removed; redirects now send historical `/`, `/tags`, and `/categories` paths to `/zh/...`.
- GitHub API access in Contentlayer uses `fetch` with timeout, retry, optional `GITHUB_TOKEN`/`GH_TOKEN`, and a `.contentlayer` cache.
- `siteMetadata` is typed TypeScript and script-side RSS/SEO helpers reuse shared locale, URL, post sorting, and date utilities.
- Post expansion keeps route-aware reading state while relying on App Router static article route prefetch instead of client MDX runtime code.
- Contentlayer writes generated ESM modules for server-rendered detail pages; list-page expansion now enters the static article route and lets Animata-derived components own visible route and body transitions after route commit.
- `_post-data` body JSON generation and client body-code preloading were removed with the browser eval path.
- Dark surface/border colors are semantic Tailwind tokens, strict TypeScript is enabled, ESLint unused variables is re-enabled, and `ecmaVersion` is set to `2022`.
- Theme-aware TradingView widgets use `next-themes`; icons are resolved from `lucide-react`'s generated icon map.
- Production builds generate Contentlayer data before `next build` instead of loading the Contentlayer webpack plugin, which avoids upstream webpack cache warnings from Contentlayer's dynamic generated-module import.

## Verification

- `yarn tsc --noEmit --pretty false`
- `yarn eslint --fix app components data lib layouts scripts contentlayer.config.ts contentlayer eslint.config.mjs`
- `yarn build`

## Completed Cleanup Items

The previous cleanup list has been closed in the follow-on branch:

- The post-open interaction now uses static article route prefetch plus route commit: clicking a card enters the article route with `router.push(..., { scroll: false })`, while collapse routes back to the original list URL and preserves the return context for scroll restoration.
- Contentlayer runtime MDX eval was removed from server-rendered detail pages and from the client expansion path. Article bodies now render through the static detail route.
- Hard-coded dark surface colors were replaced by semantic tokens where they appeared in the reviewed UI paths.
- `strict: true` is enabled.
- No-locale static route implementations were removed and replaced with redirect rules.

## Remaining Watch Items

- The lucide icon registry is generated from source and MDX usage so articles can still use arbitrary `:icon-*:` shortcodes without bundling the entire lucide icon map.
- The restored expansion path depends on App Router static route prefetch. Cold route payloads can delay the Animata route transition, so production preview checks should cover hover/focus prefetch and click-to-visible-feedback timing.
