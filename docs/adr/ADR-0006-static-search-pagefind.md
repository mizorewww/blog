---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-07-21
verified_by: command
related_code:
  - app/[locale]/search/page.tsx
  - components/SearchPageClient.tsx
  - components/Header.tsx
  - app/layout.tsx
  - app/localized-html.tsx
  - scripts/lib/localized-html.mjs
  - scripts/postbuild.mjs
  - scripts/asset-budget.mjs
  - scripts/quality-html.sh
  - knip.json
  - package.json
update_when:
  - search library changes
  - search index generation changes
  - search UI integration changes
supersedes:
superseded_by:
---

# ADR-0006: Adopt Pagefind For Static Site Search

Status: accepted
Date: 2026-07-04
Owner: codex-agent
Related code: `app/[locale]/search/page.tsx`, `components/SearchPageClient.tsx`, `components/Header.tsx`, `app/layout.tsx`, `app/localized-html.tsx`, `scripts/lib/localized-html.mjs`, `scripts/postbuild.mjs`, `scripts/asset-budget.mjs`, `scripts/quality-html.sh`, `knip.json`, `package.json`
Supersedes:
Superseded by:

## Context

The blog had no search functionality. With ~25 articles across zh/en locales and growing, discovering specific content required manual browsing by tag/category or scrolling the infinite list. The user requested search with a fast-to-integrate solution.

The site uses Next.js 15.5 static export (`output: 'export'`), so the search solution must work without a Node server — it must be a client-side or build-time-only solution.

## Decision

Adopt **Pagefind** (`pagefind` npm package, v1.5.2) as the static search solution.

Pagefind is a build-time indexer that scans the `out/` static HTML directory after `next build` completes and generates a self-contained search index in `out/pagefind/`. The browser loads the Pagefind runtime (WASM + JS) at search time, performing client-side search with zero server dependency.

Key characteristics:

- **Post-build indexing**: after static export, `scripts/postbuild.mjs` normalizes each localized document's `<html lang>` and then runs `pagefind --site out`. The index lives in `out/pagefind/` (gitignored, regenerated each build).
- **Zero-config multilingual**: Pagefind reads the normalized `zh-CN`/`en-US` `<html lang>` values and creates per-language indexes automatically. The top-level server root starts from the default language, `app/localized-html.tsx` keeps browser navigation path-aware, and `scripts/lib/localized-html.mjs` guarantees exported documents are correct before indexing. CJK tokenization is built into the extended binary; English stemming is automatic.
- **Pre-built WAI-ARIA UI**: The Pagefind Component UI (`pagefind-component-ui.js` + `.css`) provides accessible `<pagefind-searchbox>` web components with automatic UI text translation matching the site language.
- **Dedicated search page**: A `/[locale]/search/` route renders the search box. The Header has a search icon linking to this page. The Pagefind assets load only on the search page (not on every page), keeping non-search pages lightweight.
- **Dynamic asset loading**: `components/SearchPageClient.tsx` injects the Pagefind CSS/JS via `useEffect` DOM manipulation, avoiding Next.js bundler conflicts with build-generated assets and TypeScript custom-element declaration issues.

## Consequences

Benefits:

- Search works on a fully static site with no server, no API keys, and no external service.
- zh/en multilingual search is automatic — no manual language filtering or CJK configuration.
- The search index regenerates on every build, always reflecting current content.
- The pre-built UI is WAI-ARIA compliant and self-translating.
- Pagefind assets in `out/pagefind/` are excluded from `quality:html` and `asset-budget` gates (they are third-party search infrastructure, not site content).

Costs:

- `pagefind` adds a devDependency (Rust binary, platform-specific subpackage `@pagefind/linux-x64`).
- The search page loads Pagefind WASM at runtime (~tens of kB for a small blog); this is a lazy load isolated to the search route.
- The build step is slightly longer (Pagefind indexing pass).
- Knip must ignore the `pagefind` binary since it is invoked via `execSync` in a build script, not imported as a module.

## Rejected alternatives

Rejected: **FlexSearch** (13.7k stars, Apache-2.0).

Reason: client-side-only library requiring manual JSON index generation from the content layer, custom UI, and manual CJK tokenization. Pagefind handles all of these automatically by scanning the built HTML.

Rejected: **Fuse.js** (20.4k stars, Apache-2.0).

Reason: designed for fuzzy matching against small in-memory JSON arrays, not full-text site search. Requires a manual data pipeline and no built-in multilingual support.

Rejected: **Algolia DocSearch** (hosted SaaS).

Reason: requires an account, API key, and external Algolia servers. Conflicts with the self-hosted static-export model and introduces external dependencies and privacy considerations.

Rejected: **Pagefind modal trigger on every page** (Header `<pagefind-modal-trigger>`).

Reason: loads the Pagefind Component UI JS/CSS on every page even when the user does not search. The dedicated search page approach loads search assets only on `/search/`, keeping all other pages lightweight.
