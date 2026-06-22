# Code Review Refactor Plan

Date: 2026-06-22
Branch: `refactor/code-review-architecture`

## Goals

- [ ] Remove dead legacy route scaffolding and reduce duplicated default-locale page logic.
- [ ] Move reusable term index/page metadata logic into shared content/view helpers.
- [ ] Split large client components into focused hooks and components.
- [ ] Move scattered UI copy into the locale dictionary where the current refactor touches it.
- [ ] Modularize `contentlayer.config.ts` so Git history, remark, rehype, and document type code are isolated.
- [ ] Add short-term guardrails around known hacks without changing the public URL model.
- [ ] Verify with lint/type/build-equivalent checks and commit each batch atomically.

## Deferred Long-Term Items

These items need route architecture or content pipeline decisions beyond a mechanical refactor:

- Parallel Routes + Intercepting Routes replacement for the in-place post expansion URL flow.
- Migration away from Contentlayer runtime MDX evaluation.
- Semantic color token migration across all dark-mode hard-coded colors.
- Full strict TypeScript enablement.
