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
  - deferred item status changes
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
- [x] Complete the deferred route, MDX, theme, icon, strict TypeScript, and script-sharing cleanup.
- [x] Verify with lint/type/build-equivalent checks and commit each batch atomically.

## Completed Refactors

- `contentlayer.config.ts` is now an entry file; implementation lives under `contentlayer/config/`.
- Home, category, and tag page data builders are shared through `lib/content/homePage.ts` and `lib/content/termPages.ts`.
- `ExpandablePostCard` delegates Git metadata, license copy, relative time, body preloading, and meta icons to focused modules.
- `ListLayoutWithTags` delegates expansion/popstate/scroll animation state to `usePostExpansion`; back-to-top is a separate component.
- Blog sidebars are split into `BlogFrame`, `ProfileSidebar`, `UtilitySidebar`, and `BlogWidgetCard`.
- Pending blog navigation motion is persisted in `sessionStorage` instead of relying only on a module variable.
- Root metadata uses the shared SEO generator, and `app/seo.tsx` is now `app/seo.ts`.
- Common post date selection is centralized in `lib/postDates.ts`.
- No-locale `app/` mirror routes and empty legacy blog route directories were removed; redirects now send historical `/`, `/tags`, and `/categories` paths to `/zh/...`.
- GitHub API access in Contentlayer uses `fetch` with timeout, retry, optional `GITHUB_TOKEN`/`GH_TOKEN`, and a `.contentlayer` cache.
- `siteMetadata` is typed TypeScript and script-side RSS/SEO helpers reuse shared locale, URL, post sorting, and date utilities.
- Post expansion again matches the pre-refactor behavior: prefetched body code updates the URL with history state and expands in place without waiting for App Router.
- Contentlayer writes generated ESM modules for server-rendered detail pages; list-page in-place expansion intentionally keeps the client Contentlayer runtime MDX path.
- `_post-data` body JSON generation and client body-code preloading are kept because they are required for the old animation behavior.
- Dark surface/border colors are semantic Tailwind tokens, strict TypeScript is enabled, ESLint unused variables is re-enabled, and `ecmaVersion` is set to `2022`.
- Theme-aware TradingView widgets use `next-themes`; icons are resolved from `lucide-react`'s generated icon map.
- Production builds generate Contentlayer data before `next build` instead of loading the Contentlayer webpack plugin, which avoids upstream webpack cache warnings from Contentlayer's dynamic generated-module import.

## Verification

- `yarn tsc --noEmit --pretty false`
- `yarn eslint --fix app components data lib layouts scripts contentlayer.config.ts contentlayer eslint.config.mjs`
- `yarn build`

## Completed Deferred Items

The previous deferred list has been closed in the follow-up branch:

- The App Router-only post-open experiment was reverted for UX: the current static export interaction model preserves manual URL updates plus in-place expansion.
- Contentlayer runtime MDX eval was removed from server-rendered detail pages, but remains in the client expansion path until a browser-loadable MDX module pipeline replaces `_post-data`.
- Hard-coded dark surface colors were replaced by semantic tokens where they appeared in the reviewed UI paths.
- `strict: true` is enabled.
- No-locale static route implementations were removed and replaced with redirect rules.

## Remaining Watch Items

- The lucide icon registry is generated from source and MDX usage so articles can still use arbitrary `:icon-*:` shortcodes without bundling the entire lucide icon map.
- The restored client expansion path requires `unsafe-eval` for Contentlayer runtime MDX. Removing it again needs a replacement that still lets the list page render prefetched post bodies before route navigation.
