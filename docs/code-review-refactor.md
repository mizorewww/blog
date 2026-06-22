# Code Review Refactor Plan

Date: 2026-06-22
Branch: `refactor/code-review-architecture`

## Goals

- [x] Remove dead legacy route scaffolding and reduce duplicated default-locale page logic.
- [x] Move reusable term index/page metadata logic into shared content/view helpers.
- [x] Split large client components into focused hooks and components.
- [x] Move scattered UI copy into the locale dictionary where the current refactor touches it.
- [x] Modularize `contentlayer.config.ts` so Git history, remark, rehype, and document type code are isolated.
- [x] Add short-term guardrails around known hacks without changing the public URL model.
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

## Verification

- `yarn tsc --noEmit --pretty false`
- `yarn eslint --fix app components data lib layouts scripts contentlayer.config.ts contentlayer eslint.config.mjs`
- `yarn build`
- `yarn seo:check`

## Deferred Long-Term Items

These items need route architecture or content pipeline decisions beyond a mechanical refactor:

- Parallel Routes + Intercepting Routes replacement for the in-place post expansion URL flow.
- Migration away from Contentlayer runtime MDX evaluation.
- Semantic color token migration across all dark-mode hard-coded colors.
- Full strict TypeScript enablement.
- Full removal of no-locale static routes is deferred because the project uses `output: 'export'`; the current change keeps static `/`, `/categories`, and `/tags` compatibility while eliminating the duplicated implementation.
