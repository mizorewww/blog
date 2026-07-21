---
status: active
audience: both
authority: source-of-truth
owner: codex-agent
last_verified: 2026-07-21
verified_by: command
related_code:
  - app/layout.tsx
  - app/localized-html.tsx
  - app/[locale]/layout.tsx
  - app/not-found.tsx
  - app/[locale]/not-found.tsx
  - components/NotFoundPage.tsx
  - next.config.js
  - public/_redirects
  - scripts/lib/localized-html.mjs
  - scripts/lib/redirects.mjs
  - scripts/postbuild.mjs
  - scripts/preview-static/caddy.mjs
  - tests/e2e/dev-preview-parity.spec.ts
  - tests/unit/localized-html.test.ts
  - tests/unit/redirects.test.ts
update_when:
  - root layout or not-found ownership changes
  - locale or exported HTML language handling changes
  - development or static preview redirect behavior changes
  - static export or Pagefind sequencing changes
  - development and preview parity coverage changes
supersedes:
superseded_by:
---

# ADR-0009: Stable Root Layout And Local Server Parity

Status: accepted
Date: 2026-07-21
Owner: codex-agent
Related code: `app/layout.tsx`, `app/localized-html.tsx`, `app/[locale]/layout.tsx`, `app/not-found.tsx`, `app/[locale]/not-found.tsx`, `components/NotFoundPage.tsx`, `next.config.js`, `public/_redirects`, `scripts/lib/localized-html.mjs`, `scripts/lib/redirects.mjs`, `scripts/postbuild.mjs`, `scripts/preview-static/caddy.mjs`, `tests/e2e/dev-preview-parity.spec.ts`, `tests/unit/localized-html.test.ts`, `tests/unit/redirects.test.ts`
Supersedes:
Superseded by:

## Context

The application previously put its only document layout under the dynamic `[locale]` segment while
also defining a root `app/not-found.tsx`. Production preview served already-exported files, but the
Next.js 15.5 development server had to compile unmatched routes through a root that did not own an
`html` and `body` document. This made `yarn dev` fail for behavior that appeared valid through the
static preview server.

The two local servers also had independent redirect implementations. Static preview translated the
exported `_redirects` file into Caddy directives, while the development server relied on Next.js
defaults. Wildcard captures, encoded Unicode paths, and trailing slashes could therefore produce
different status or `Location` results.

Moving the document root above `[locale]` creates a language problem for a static bilingual site. A
single server root cannot obtain dynamic-segment params, but each exported document and the Pagefind
index must still use the route's correct `zh-CN` or `en-US` language.

## Decision

Use `app/layout.tsx` as the only document root. It is a server component and owns `html`, `head`,
`body`, global CSS, providers, analytics, speculation rules, and `AppShell`. The localized layout
keeps locale static params and metadata but does not emit another document root.

Use two coordinated language mechanisms:

- `app/localized-html.tsx` derives the locale from the current pathname, emits a path-aware inline
  language assignment for the initial browser document, and updates `document.documentElement.lang`
  during client navigation.
- `scripts/lib/localized-html.mjs` normalizes every `out/{locale}/**/*.html` document after static
  export and before Pagefind indexing. Pagefind therefore reads final `zh-CN` and `en-US` document
  languages rather than the root layout's default language.

Keep standard root and localized `not-found.tsx` files, both rendering the shared
`components/NotFoundPage.tsx`. The shared client component derives localized labels from the pathname;
both entry points set the same title and use the same page structure. Next.js 15.5 development may
return a different raw streaming 404 shell before hydration than Caddy returns from the exported
`404/index.html`. The supported parity contract is the browser-observable result after the framework
has rendered: HTTP status, title, document language, localized heading and description, and back-link
target. Raw response byte equality is not a contract.

Enable `output: 'export'` only outside `PHASE_DEVELOPMENT_SERVER`. Development keeps Contentlayer's
Next.js integration and reads canonical redirect rules from `public/_redirects`. Static preview reads
the copied `out/_redirects`. Both use `scripts/lib/redirects.mjs` to parse rules and translate wildcard
captures; Caddy disables its own canonical-URI redirects so they do not override repository rules.

Add `yarn test:e2e:parity` as the cross-server contract gate. It creates a production export, starts
the Caddy preview and Next.js development server together, and compares redirect status and
destinations plus representative localized pages and custom 404 results. Unit tests cover exported
HTML language normalization and both redirect translators.

## Consequences

Benefits:

- Every route, including root-level misses, has a stable server-owned document layout in development.
- Development and preview derive legacy redirects from one repository-owned file and one parser.
- Exported language metadata remains correct for browsers and Pagefind despite the static root layout.
- Root and locale-aware 404 routes share presentation and browser-visible behavior.
- A dedicated browser gate detects local-server drift independently of the normal preview-only E2E
  suite.

Costs:

- Browser language ownership spans a small client component and a deterministic post-build
  normalization step.
- The parity gate runs a production build and two local servers, so it is more expensive than a unit
  test or the preview-only browser suite.
- Framework-internal development 404 markup is intentionally not byte-identical to exported static
  HTML; consumers must rely on the browser-observable contract.

## Rejected alternatives

Rejected: keep the document root under `[locale]` and use an experimental global not-found route.

Reason: it leaves root fallback compilation dependent on an experimental path and does not establish a
stable document owner shared by matched and unmatched routes.

Rejected: make the root layout dynamically inspect request headers or cookies for locale.

Reason: request-bound server APIs conflict with static export, and locale identity is already encoded
in the pathname.

Rejected: maintain separate redirect lists in `next.config.js` and the Caddy preview generator.

Reason: duplicated rules can drift in status codes, wildcard semantics, Unicode handling, and trailing
slash behavior.

Rejected: require raw development and preview 404 HTML to be identical.

Reason: the Next.js development server owns its streaming and hydration transport, while preview serves
the static export. Browser-visible status, metadata, content, language, and navigation are the durable
application contract.
