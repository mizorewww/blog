import { expect, test, type Page } from '@playwright/test'

const HOME_PATH = '/zh/'
// Non-ASCII topic folders: page.url() is percent-encoded, while rendered href /
// data-* attributes keep the raw form. See article-reading.spec.ts.
const ARTICLE_HREF = '/zh/折腾/xiaomi-book-pro-14/'
const ARTICLE_PATH = encodeURI(ARTICLE_HREF)
// data-post-shell stores the contentlayer path (no leading/trailing slash).
const ARTICLE_CARD_KEY = 'zh/折腾/xiaomi-book-pro-14'
const RICH_ARTICLE_HREF = '/zh/技术/making-memoh-cheaper-on-telegram/'
const RICH_ARTICLE_PATH = encodeURI(RICH_ARTICLE_HREF)
const OLD_ARTICLE_PATH = '/zh/xiaomi-book-pro-14/'

type SwitchReturnProbe = {
  removedAt: number | null
  frames: { phase: string; treePhase: string }[]
}

type TreeFlightProbe = {
  removed: boolean
  frames: { phase: string; chrome: string; fontSize: number; lineHeight: number; trees: number }[]
  // First-frame overlay snapshot, only filled when a flight is observed — read
  // from assertion messages to diagnose stale-server or markup regressions.
  debug?: { overlays: number; html: string; url: string }
}

// Same install/sample/wait pattern as installTransitionProbe in
// article-reading.spec.ts, scoped to the phases of both transition overlays.
async function installSwitchReturnProbe(page: Page) {
  await page.evaluate(() => {
    const probe: SwitchReturnProbe = { removedAt: null, frames: [] }
    ;(window as unknown as { __switchReturnProbe?: SwitchReturnProbe }).__switchReturnProbe = probe

    let startedAt = 0
    let sampling = false
    const sample = (now: number) => {
      const cardOverlay = document.querySelector('[data-article-transition-overlay]')
      const treeOverlay = document.querySelector('[data-content-tree-transition-overlay]')

      if (!cardOverlay && !treeOverlay) {
        if (startedAt !== 0) {
          probe.removedAt = now - startedAt
          observer.disconnect()
          return
        }
      } else {
        if (startedAt === 0) {
          startedAt = now
        }

        probe.frames.push({
          phase: cardOverlay?.getAttribute('data-article-transition-phase') || '',
          treePhase: treeOverlay?.getAttribute('data-content-tree-transition-phase') || '',
        })
      }

      window.requestAnimationFrame(sample)
    }
    const observer = new MutationObserver(() => {
      if (
        !sampling &&
        (document.querySelector('[data-article-transition-overlay]') ||
          document.querySelector('[data-content-tree-transition-overlay]'))
      ) {
        sampling = true
        window.requestAnimationFrame(sample)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
  })
}

async function readSwitchReturnProbe(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __switchReturnProbe?: SwitchReturnProbe }).__switchReturnProbe
  )
}

async function waitForSwitchReturnProbe(page: Page) {
  await expect
    .poll(async () => (await readSwitchReturnProbe(page))?.removedAt, { timeout: 1_500 })
    .not.toBeNull()

  return (await readSwitchReturnProbe(page))!
}

// Records the single flight tree's chrome + inherited density on every frame
// of a flight. The overlay morphs one tree between the sidebar density
// (14px/24px) and the rail density (13px/18.85px) continuously with the glide,
// so it already matches the real tree when it exits over it.
async function installTreeFlightProbe(page: Page) {
  await page.evaluate(() => {
    const probe: TreeFlightProbe = { removed: false, frames: [] }
    ;(window as unknown as { __treeFlightProbe?: TreeFlightProbe }).__treeFlightProbe = probe

    let sampling = false
    const sample = () => {
      const overlay = document.querySelector('[data-content-tree-transition-overlay]')
      const navs = overlay ? Array.from(overlay.querySelectorAll('[data-content-tree]')) : []

      if (!overlay || navs.length === 0) {
        if (probe.frames.length > 0) {
          probe.removed = true
          observer.disconnect()
          return
        }
      } else {
        const nav = navs[0]
        const style = getComputedStyle(nav)
        if (!probe.debug) {
          probe.debug = {
            overlays: document.querySelectorAll('[data-content-tree-transition-overlay]').length,
            html: overlay.innerHTML.slice(0, 400),
            url: window.location.pathname,
          }
        }
        probe.frames.push({
          phase: overlay.getAttribute('data-content-tree-transition-phase') || '',
          chrome: nav.getAttribute('data-content-tree-chrome') || '',
          fontSize: parseFloat(style.fontSize),
          lineHeight: parseFloat(style.lineHeight),
          trees: navs.length,
        })
      }

      window.requestAnimationFrame(sample)
    }
    const observer = new MutationObserver(() => {
      if (
        !sampling &&
        document.querySelector('[data-content-tree-transition-overlay] [data-content-tree]')
      ) {
        sampling = true
        window.requestAnimationFrame(sample)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })
  })
}

async function readTreeFlightProbe(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __treeFlightProbe?: TreeFlightProbe }).__treeFlightProbe
  )
}

async function waitForTreeFlightProbe(page: Page) {
  await expect
    .poll(async () => (await readTreeFlightProbe(page))?.removed, { timeout: 1_500 })
    .toBe(true)

  return (await readTreeFlightProbe(page))!
}

test('list pages keep a date-sorted center and an unlabeled tree on the right', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  const tree = page.locator('.blog-sidebar-right [data-content-tree]')
  await expect(tree).toBeVisible()
  await expect(tree.getByRole('heading', { name: '文章导航' })).toHaveClass(/sr-only/)
  await expect(page.locator('body')).not.toContainText('文件夹')
  await expect(page.getByText('folder view', { exact: false })).toHaveCount(0)

  const dates = await page
    .locator('[data-post-shell] [data-article-transition-date] time')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('datetime') || ''))
  const sorted = [...dates].sort((left, right) => right.localeCompare(left))
  expect(dates).toEqual(sorted)

  const folder = tree.getByRole('button', { name: '折腾' })
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
  await expect(tree.locator('a[data-content-tree-post="折腾/xiaomi-book-pro-14"]')).toBeVisible()

  await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'false')
  await folder.click()
  await expect(folder).toHaveAttribute('aria-expanded', 'true')
})

test('article pages use a three-column tree rail at 1024px and hide it below', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await page.goto(ARTICLE_PATH)

  const tree = page.locator('[data-article-content-tree] [data-content-tree]')
  await expect(page.locator('.article-toc-desktop')).toBeVisible()
  await expect(page.locator('[data-article-surface]')).toBeVisible()
  await expect(tree).toBeVisible()
  await expect(tree.locator('a[data-content-tree-post="折腾/xiaomi-book-pro-14"]')).toHaveAttribute(
    'aria-current',
    'page'
  )

  await page.setViewportSize({ width: 1023, height: 900 })
  await expect(page.locator('[data-article-content-tree]')).toBeHidden()
})

test('list tree post links open the article with a structured tree overlay', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  const treeLink = page.locator(
    `.blog-sidebar-right [data-content-tree] a[data-blog-post-link][href="${ARTICLE_HREF}"]`
  )
  await expect(treeLink).toBeVisible()
  await treeLink.click()

  await expect
    .poll(async () => page.locator('[data-content-tree-transition-overlay]').count())
    .toBeGreaterThan(0)
  await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toContainText(
    '入手这台 Xiaomi Book Pro 14 的理由其实挺简单'
  )
})

test('tree overlay shows source chrome during hold and does not replay collapsible enter', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 900 })

  let releaseArticleRequest!: () => void
  const articleRequestReleased = new Promise<void>((resolve) => {
    releaseArticleRequest = resolve
  })

  await page.route(`**${ARTICLE_PATH}index.txt*`, async (route) => {
    await articleRequestReleased
    await route.continue()
  })

  await page.goto(HOME_PATH)

  const treeLink = page.locator(
    `.blog-sidebar-right [data-content-tree] a[data-blog-post-link][href="${ARTICLE_HREF}"]`
  )
  await expect(treeLink).toBeVisible()
  const clickPromise = treeLink.click()

  try {
    const overlay = page.locator('[data-content-tree-transition-overlay]')
    const sourceTree = overlay.locator('[data-content-tree-chrome="sidebar"]')
    await expect(overlay).toBeVisible()
    await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
    await expect(sourceTree).toHaveAttribute('data-content-tree-flight', 'true')
    await expect(overlay.locator('[data-animata-collapsible]')).toHaveCount(0)
    await expect(sourceTree.locator('[data-content-tree-open="true"]')).not.toHaveCount(0)
    await expect(sourceTree.locator('[data-content-tree-folder="折腾"]')).toHaveAttribute(
      'data-content-tree-open',
      'true'
    )
    await expect(
      sourceTree.locator('[data-content-tree-post="折腾/xiaomi-book-pro-14"]')
    ).toBeVisible()

    const box = await overlay.boundingBox()
    expect(box).not.toBeNull()
    expect(box?.width).toBeGreaterThan(80)
    expect(box?.width).toBeLessThan(400)
  } finally {
    releaseArticleRequest()
    await clickPromise
  }

  await expect(page).toHaveURL(ARTICLE_PATH)
})

test('tree overlay morphs one tree between the sidebar and rail chrome on open and return', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  const treeLink = page.locator(
    `.blog-sidebar-right [data-content-tree] a[data-blog-post-link][href="${ARTICLE_HREF}"]`
  )
  await expect(treeLink).toBeVisible()

  await installTreeFlightProbe(page)
  await treeLink.click()
  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toBeVisible()

  const openProbe = await waitForTreeFlightProbe(page)
  expect(openProbe.frames.length).toBeGreaterThan(0)
  expect(openProbe.frames.some((frame) => frame.phase === 'opening')).toBe(true)
  // A single tree renders the whole flight; the density morphs continuously
  // from the sidebar chrome (14px/24px) to the rail chrome (13px/18.85px), so
  // no frame ever shows a size jump.
  expect(
    openProbe.frames.every((frame) => frame.trees === 1),
    JSON.stringify({
      debug: openProbe.debug,
      frames: openProbe.frames.map((f) => [f.phase, f.chrome, f.trees, f.fontSize]),
    })
  ).toBe(true)
  const openFirst = openProbe.frames[0]
  const openLast = openProbe.frames[openProbe.frames.length - 1]
  expect(openFirst.chrome).toBe('sidebar')
  expect(Math.abs(openFirst.fontSize - 14)).toBeLessThanOrEqual(0.1)
  expect(Math.abs(openFirst.lineHeight - 24)).toBeLessThanOrEqual(0.2)
  expect(openLast.chrome).toBe('rail')
  expect(Math.abs(openLast.fontSize - 13)).toBeLessThanOrEqual(0.1)
  expect(Math.abs(openLast.lineHeight - 18.85)).toBeLessThanOrEqual(0.2)
  expect(openProbe.frames.some((frame) => frame.fontSize > 13.1 && frame.fontSize < 13.9)).toBe(
    true
  )
  expect(openProbe.frames.every((frame) => frame.fontSize >= 12.9 && frame.fontSize <= 14.1)).toBe(
    true
  )
  // The chrome flips with the glide start: all sidebar frames precede all rail
  // frames.
  const openChromes = openProbe.frames.map((frame) => frame.chrome)
  expect(openChromes.lastIndexOf('sidebar')).toBeLessThan(openChromes.indexOf('rail'))

  await installTreeFlightProbe(page)
  await page.locator('a[data-article-transition-destination-only]').click()
  await expect(page).toHaveURL(HOME_PATH)

  const returnProbe = await waitForTreeFlightProbe(page)
  expect(returnProbe.frames.length).toBeGreaterThan(0)
  expect(returnProbe.frames.some((frame) => frame.phase === 'returning')).toBe(true)
  expect(returnProbe.frames.every((frame) => frame.trees === 1)).toBe(true)
  const returnFirst = returnProbe.frames[0]
  const returnLast = returnProbe.frames[returnProbe.frames.length - 1]
  expect(returnFirst.chrome).toBe('rail')
  expect(Math.abs(returnFirst.fontSize - 13)).toBeLessThanOrEqual(0.1)
  expect(returnLast.chrome).toBe('sidebar')
  expect(Math.abs(returnLast.fontSize - 14)).toBeLessThanOrEqual(0.1)
  expect(returnProbe.frames.some((frame) => frame.fontSize > 13.1 && frame.fontSize < 13.9)).toBe(
    true
  )
  const returnChromes = returnProbe.frames.map((frame) => frame.chrome)
  expect(returnChromes.lastIndexOf('rail')).toBeLessThan(returnChromes.indexOf('sidebar'))
})

test('article tree switches fade the reading surface without moving TOC or tree', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 900 })

  let releaseArticleRequest!: () => void
  const articleRequestReleased = new Promise<void>((resolve) => {
    releaseArticleRequest = resolve
  })

  await page.route(`**${RICH_ARTICLE_PATH}index.txt*`, async (route) => {
    await articleRequestReleased
    await route.continue()
  })

  await page.goto(ARTICLE_PATH)

  const nextLink = page.locator(
    `[data-article-content-tree] a[data-blog-post-link][href="${RICH_ARTICLE_HREF}"]`
  )
  await expect(nextLink).toBeVisible()
  const clickPromise = nextLink.click()

  try {
    await expect
      .poll(async () => page.locator('[data-article-surface-veil]').count())
      .toBeGreaterThan(0)
    await expect(page.locator('[data-content-tree-transition-overlay]')).toHaveCount(0)
  } finally {
    releaseArticleRequest()
    await clickPromise
  }

  await expect(page).toHaveURL(RICH_ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toBeVisible()
})

test('closing after an article tree switch flies the card and tree back to the list', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  const cardLink = page
    .locator(`[data-post-shell="${ARTICLE_CARD_KEY}"]`)
    .locator(':scope > a[data-blog-post-link]')
  await expect(cardLink).toBeVisible()
  await cardLink.click()
  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toBeVisible()
  // Let the opening overlays fully land and exit so the switch starts from a
  // settled retained session.
  await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
  await expect(page.locator('[data-content-tree-transition-overlay]')).toHaveCount(0)

  const nextLink = page.locator(
    `[data-article-content-tree] a[data-blog-post-link][href="${RICH_ARTICLE_HREF}"]`
  )
  await expect(nextLink).toBeVisible()
  await nextLink.click()
  await expect(page).toHaveURL(RICH_ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toBeVisible()
  await expect(page.locator('[data-article-surface-veil]')).toHaveCount(0)

  await installSwitchReturnProbe(page)
  await page.locator('a[data-article-transition-destination-only]').click()

  // The reissued marker makes the close a proven history.back() onto the list,
  // and the retained (retargeted) session runs the normal return sequence.
  await expect(page).toHaveURL(HOME_PATH)
  await expect(page.locator(`[data-post-shell="${ARTICLE_CARD_KEY}"]`)).toBeVisible()

  const probe = await waitForSwitchReturnProbe(page)
  const phases = probe.frames.map((frame) => frame.phase)
  const waitingIndex = phases.indexOf('return-waiting')
  const returningIndex = phases.indexOf('returning')

  expect(waitingIndex).toBeGreaterThanOrEqual(0)
  expect(returningIndex).toBeGreaterThan(waitingIndex)
  expect(probe.frames.some((frame) => frame.treePhase === 'returning')).toBe(true)
})

test('an article tree switch replaces history so browser Back reaches the list', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  const cardLink = page
    .locator(`[data-post-shell="${ARTICLE_CARD_KEY}"]`)
    .locator(':scope > a[data-blog-post-link]')
  await expect(cardLink).toBeVisible()
  await cardLink.click()
  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toBeVisible()
  await expect(page.locator('[data-article-transition-overlay]')).toHaveCount(0)
  await expect(page.locator('[data-content-tree-transition-overlay]')).toHaveCount(0)

  const nextLink = page.locator(
    `[data-article-content-tree] a[data-blog-post-link][href="${RICH_ARTICLE_HREF}"]`
  )
  await expect(nextLink).toBeVisible()
  await nextLink.click()
  await expect(page).toHaveURL(RICH_ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toBeVisible()

  // The rail link replaces the history entry, so Back skips the switched-from
  // article and lands on the list the card was opened from.
  await page.goBack()
  await expect(page).toHaveURL(HOME_PATH)
  await expect(page.locator(`[data-post-shell="${ARTICLE_CARD_KEY}"]`)).toBeVisible()
})

test('reduced motion skips tree translate and the surface veil', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  await page
    .locator(
      `.blog-sidebar-right [data-content-tree] a[data-blog-post-link][href="${ARTICLE_HREF}"]`
    )
    .click()

  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-surface-veil]')).toHaveCount(0)
  await expect(page.locator('[data-article-body]')).toBeVisible()
})

test('closing an article conceals the real sidebar card until the tree overlay lands', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(HOME_PATH)

  const cardLink = page
    .locator(`[data-post-shell="${ARTICLE_CARD_KEY}"]`)
    .locator(':scope > a[data-blog-post-link]')
  await expect(cardLink).toBeVisible()
  await cardLink.click()
  await expect(page).toHaveURL(ARTICLE_PATH)
  await expect(page.locator('[data-article-body]')).toBeVisible()
  // Let the opening tree overlay fully land and exit before closing, otherwise the
  // return starts from a mid-open tree state and never settles.
  await expect(page.locator('[data-content-tree-transition-overlay]')).toHaveCount(0)

  // Record the real sidebar card's opacity on every frame of the return flight.
  await page.evaluate(() => {
    const win = window as unknown as { __cardReturnLog: { ret: string; opacity: string }[] }
    win.__cardReturnLog = []
    const frame = () => {
      const main = document.querySelector('main')
      const card = document.querySelector('.blog-sidebar-right section:has([data-content-tree])')
      win.__cardReturnLog.push({
        ret: main?.getAttribute('data-content-tree-transition-return') || '',
        opacity: card ? getComputedStyle(card).opacity : 'none',
      })
      window.requestAnimationFrame(frame)
    }
    window.requestAnimationFrame(frame)
  })

  const sidebarCard = page.locator('.blog-sidebar-right section:has([data-content-tree])')
  await page.locator('a[data-article-transition-destination-only]').click()
  await expect(page).toHaveURL(HOME_PATH)
  // The card stays concealed for the whole return and is only revealed once the
  // tree overlay has landed and exited, so the reveal marks the end of the return.
  await expect(sidebarCard).toHaveCSS('opacity', '1')

  const log = await page.evaluate(
    () =>
      (window as unknown as { __cardReturnLog: { ret: string; opacity: string }[] }).__cardReturnLog
  )

  const returningFrames = log.filter((frame) => frame.ret === 'returning')
  expect(returningFrames.length).toBeGreaterThan(0)
  // The real card (background included) stays hidden for the whole return so the
  // overlay alone represents it. Concealing only the tree nav let the empty card
  // background flash underneath the overlay's own card as it faded in.
  expect(returningFrames.every((frame) => frame.opacity === '0')).toBe(true)
  await expect(sidebarCard).toBeVisible()
})

test('old flat article URLs permanently redirect to topic folders', async ({ request }) => {
  const response = await request.get(OLD_ARTICLE_PATH, { maxRedirects: 0 })

  expect(response.status()).toBe(301)
  expect(response.headers().location).toBe(ARTICLE_PATH)
})

test.describe('no-js content tree', () => {
  test.use({ javaScriptEnabled: false })

  test('renders open folders and post leaves in static HTML', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(HOME_PATH)

    const tree = page.locator('.blog-sidebar-right [data-content-tree]')
    await expect(tree).toBeVisible()
    await expect(tree.getByRole('button', { name: '折腾' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(tree.locator('a[data-content-tree-post="折腾/xiaomi-book-pro-14"]')).toBeVisible()
    await expect(page.locator('body')).not.toContainText('文件夹')
  })
})
