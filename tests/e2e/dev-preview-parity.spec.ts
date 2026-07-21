import { expect, test, type Browser } from '@playwright/test'

const previewPort = Number(process.env.PLAYWRIGHT_PORT || 3011)
const devPort = Number(process.env.PLAYWRIGHT_DEV_PORT || 3010)
const previewBaseUrl = `http://127.0.0.1:${previewPort}`
const devBaseUrl = `http://127.0.0.1:${devPort}`
const parityEnabled = process.env.PLAYWRIGHT_DEV_PREVIEW_PARITY === '1'

type PageSnapshot = {
  status: number
  title: string
  htmlLang: string | null
  heading: string
  description: string
  backLink: string | null
}

async function capturePage(browser: Browser, baseUrl: string, pathname: string) {
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    const response = await page.goto(`${baseUrl}${pathname}`)
    await page.locator('h1').waitFor()
    const description = page.locator('h1 + p')
    const backLink = page.locator('h1 + p + a')

    return {
      status: response?.status() || 0,
      title: await page.title(),
      htmlLang: await page.locator('html').getAttribute('lang'),
      heading: await page.locator('h1').innerText(),
      description: (await description.count()) > 0 ? (await description.textContent()) || '' : '',
      backLink: (await backLink.count()) > 0 ? await backLink.getAttribute('href') : null,
    } satisfies PageSnapshot
  } finally {
    await context.close()
  }
}

test.describe('development and static preview parity', () => {
  test.skip(!parityEnabled, 'Run with yarn test:e2e:parity')

  test('shared redirects preserve status, destination, Unicode, and trailing slashes', async ({
    request,
  }) => {
    for (const pathname of [
      '/',
      '/categories',
      '/categories/',
      '/blog/xiaomi-book-pro-14',
      '/blog/xiaomi-book-pro-14/',
      '/blog/%E6%8A%98%E8%85%BE/',
    ]) {
      const [development, preview] = await Promise.all([
        request.get(`${devBaseUrl}${pathname}`, { maxRedirects: 0 }),
        request.get(`${previewBaseUrl}${pathname}`, { maxRedirects: 0 }),
      ])

      expect({ status: development.status(), location: development.headers().location }).toEqual({
        status: preview.status(),
        location: preview.headers().location,
      })
    }
  })

  for (const [pathname, htmlLang] of [
    ['/zh/', 'zh-CN'],
    ['/en/', 'en-US'],
    ['/zh/categories/%E6%8A%98%E8%85%BE/', 'zh-CN'],
  ] as const) {
    test(`${pathname} renders the same localized document`, async ({ browser }) => {
      const [development, preview] = await Promise.all([
        capturePage(browser, devBaseUrl, pathname),
        capturePage(browser, previewBaseUrl, pathname),
      ])

      expect(development.status).toBe(200)
      expect(preview.status).toBe(200)
      expect(development.htmlLang).toBe(htmlLang)
      expect(preview.htmlLang).toBe(htmlLang)
      expect(development.heading).toBe(preview.heading)
    })
  }

  for (const pathname of ['/missing', '/zh/missing', '/en/missing']) {
    test(`${pathname} renders the same custom 404`, async ({ browser }) => {
      const [development, preview] = await Promise.all([
        capturePage(browser, devBaseUrl, pathname),
        capturePage(browser, previewBaseUrl, pathname),
      ])

      expect(development).toEqual(preview)
      expect(development.status).toBe(404)
      expect(development.title).toBe('404 | mizorewww')
      expect(development.backLink).toBe('/')
    })
  }
})
