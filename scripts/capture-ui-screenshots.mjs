#!/usr/bin/env node
// @ts-check

import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readingFixtureHtml } from './reading-fixture.mjs'

/**
 * @typedef {'home' | 'article' | 'article-top' | 'article-inline-code' | 'article-math' | 'article-code' | 'article-table' | 'article-toc' | 'article-image' | 'article-data-block' | 'article-bottom' | 'markdown-fixture' | 'search' | 'search-initial' | 'search-results' | 'search-empty' | 'search-error' | 'categories' | 'tags' | 'category-term' | 'tag-term' | '404'} PageKey
 * @typedef {'dark' | 'light'} ThemeName
 * @typedef {{ key: PageKey, path: string, expectedStatus?: number }} PageDefinition
 * @typedef {{ name: string, width: number, height: number, isMobile?: boolean, hasTouch?: boolean, deviceScaleFactor?: number }} ViewportDefinition
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const agentRecordsRoot = path.join(projectRoot, 'docs', 'agent-records')
const defaultBaseUrl = 'http://127.0.0.1:3001'
const defaultLocale = 'zh'
const defaultArticleSlug = '折腾/xiaomi-book-pro-14'
const defaultPageKeys = /** @type {PageKey[]} */ ([
  'home',
  'article',
  'search',
  'categories',
  '404',
])
const allPageKeys = /** @type {PageKey[]} */ ([
  'home',
  'article',
  'article-top',
  'article-inline-code',
  'article-math',
  'article-code',
  'article-table',
  'article-toc',
  'article-image',
  'article-data-block',
  'article-bottom',
  'markdown-fixture',
  'search',
  'search-initial',
  'search-results',
  'search-empty',
  'search-error',
  'categories',
  'tags',
  'category-term',
  'tag-term',
  '404',
])
const viewportPresets = /** @type {Record<string, ViewportDefinition>} */ ({
  compact: {
    name: 'compact',
    width: 320,
    height: 812,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  },
  desktop: { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
  laptop: { name: 'laptop', width: 1024, height: 768, deviceScaleFactor: 1 },
  tablet: { name: 'tablet', width: 768, height: 1024, deviceScaleFactor: 1 },
  mobile: {
    name: 'mobile',
    width: 375,
    height: 812,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  },
  landscape: {
    name: 'landscape',
    width: 812,
    height: 375,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  },
  reflow200: { name: 'reflow200', width: 640, height: 900, deviceScaleFactor: 1 },
  w1280: { name: 'w1280', width: 1280, height: 960, deviceScaleFactor: 1 },
  w1440: { name: 'w1440', width: 1440, height: 960, deviceScaleFactor: 1 },
  w1728: { name: 'w1728', width: 1728, height: 960, deviceScaleFactor: 1 },
  w1920: { name: 'w1920', width: 1920, height: 960, deviceScaleFactor: 1 },
  1280: { name: '1280', width: 1280, height: 960, deviceScaleFactor: 1 },
  1440: { name: '1440', width: 1440, height: 960, deviceScaleFactor: 1 },
  1728: { name: '1728', width: 1728, height: 960, deviceScaleFactor: 1 },
  1920: { name: '1920', width: 1920, height: 960, deviceScaleFactor: 1 },
})
const defaultViewports = ['desktop', 'mobile']

/**
 * @param {string[]} args
 * @param {string} name
 * @returns {string | null}
 */
function readArg(args, name) {
  const withEquals = args.find((arg) => arg.startsWith(`${name}=`))

  if (withEquals) {
    return withEquals.slice(name.length + 1)
  }

  const index = args.indexOf(name)
  return index === -1 ? null : args[index + 1] || null
}

/**
 * @param {string[]} args
 * @param {string} name
 * @returns {string[]}
 */
function readRepeatedArgs(args, name) {
  const values = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg.startsWith(`${name}=`)) {
      values.push(arg.slice(name.length + 1))
    } else if (arg === name && args[index + 1]) {
      values.push(args[index + 1])
      index += 1
    }
  }

  return values
}

/**
 * @param {string | null} value
 * @returns {string[]}
 */
function splitList(value) {
  return value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

/**
 * @param {string[]} args
 * @returns {PageKey[]}
 */
function parsePageKeys(args) {
  const values = [
    ...splitList(readArg(args, '--pages')),
    ...readRepeatedArgs(args, '--page').flatMap((value) => splitList(value)),
  ]

  if (values.length === 0) {
    return defaultPageKeys
  }

  const validKeys = new Set(allPageKeys)
  return values.map((value) => {
    if (!validKeys.has(/** @type {PageKey} */ (value))) {
      throw new Error(`Unknown page "${value}". Use one of: ${allPageKeys.join(', ')}`)
    }

    return /** @type {PageKey} */ (value)
  })
}

/**
 * @param {string[]} args
 * @returns {ViewportDefinition[]}
 */
function parseViewports(args) {
  const values = [
    ...splitList(readArg(args, '--viewports')),
    ...readRepeatedArgs(args, '--viewport').flatMap((value) => splitList(value)),
  ]
  const selected = values.length === 0 ? defaultViewports : values

  return selected.map((value) => {
    const preset = viewportPresets[value]

    if (!preset) {
      throw new Error(
        `Unknown viewport "${value}". Use one of: ${Object.keys(viewportPresets).join(', ')}`
      )
    }

    return preset
  })
}

/**
 * @param {string[]} args
 * @returns {ThemeName[]}
 */
function parseThemes(args) {
  const theme = readArg(args, '--theme') || 'dark'

  if (theme === 'both') {
    return ['dark', 'light']
  }

  if (theme !== 'dark' && theme !== 'light') {
    throw new Error('Expected --theme to be "dark", "light", or "both"')
  }

  return [theme]
}

/**
 * @param {string | null} value
 * @returns {number}
 */
function parseTextScale(value) {
  if (!value) {
    return 100
  }

  const parsed = Number.parseInt(value, 10)

  if (!Number.isFinite(parsed) || parsed < 50 || parsed > 300) {
    throw new Error('Expected --text-scale to be an integer between 50 and 300')
  }

  return parsed
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value : `${value}/`
}

/**
 * @param {string} label
 * @returns {string}
 */
function sanitizeLabel(label) {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(label)) {
    throw new Error('Screenshot label must use letters, numbers, underscores, or hyphens')
  }

  return label
}

/**
 * @param {string} targetPath
 * @returns {string}
 */
function resolveAgentRecordsPath(targetPath) {
  const resolved = path.resolve(projectRoot, targetPath)
  const relative = path.relative(agentRecordsRoot, resolved)

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved
  }

  throw new Error('Screenshot output must stay inside docs/agent-records/')
}

/**
 * @param {string} locale
 * @param {string} articlePath
 * @returns {Record<PageKey, PageDefinition>}
 */
function createPageDefinitions(locale, articlePath) {
  return {
    home: { key: 'home', path: `/${locale}/` },
    article: { key: 'article', path: articlePath },
    'article-top': { key: 'article-top', path: articlePath },
    'article-inline-code': { key: 'article-inline-code', path: articlePath },
    'article-math': { key: 'article-math', path: articlePath },
    'article-code': { key: 'article-code', path: articlePath },
    'article-table': { key: 'article-table', path: articlePath },
    'article-toc': { key: 'article-toc', path: articlePath },
    'article-image': { key: 'article-image', path: articlePath },
    'article-data-block': { key: 'article-data-block', path: articlePath },
    'article-bottom': { key: 'article-bottom', path: articlePath },
    'markdown-fixture': { key: 'markdown-fixture', path: articlePath },
    search: { key: 'search', path: `/${locale}/search/` },
    'search-initial': { key: 'search-initial', path: `/${locale}/search/` },
    'search-results': { key: 'search-results', path: `/${locale}/search/` },
    'search-empty': { key: 'search-empty', path: `/${locale}/search/` },
    'search-error': { key: 'search-error', path: `/${locale}/search/` },
    categories: { key: 'categories', path: `/${locale}/categories/` },
    tags: { key: 'tags', path: `/${locale}/tags/` },
    'category-term': { key: 'category-term', path: `/${locale}/categories/折腾/` },
    'tag-term': { key: 'tag-term', path: `/${locale}/tags/linux/` },
    404: { key: '404', path: `/${locale}/__ui_screenshot_missing__/`, expectedStatus: 404 },
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {PageKey} key
 * @returns {Promise<void>}
 */
async function waitForReady(page, key) {
  if (key === 'home') {
    await page.locator('[data-post-shell]').first().waitFor({ state: 'visible' })
  } else if (key.startsWith('article') || key === 'markdown-fixture') {
    await page.locator('[data-article-body]').waitFor({ state: 'visible' })
  } else if (key.startsWith('search')) {
    await page.getByRole('searchbox').waitFor({ state: 'visible' })
  } else if (key === 'categories' || key === 'tags') {
    await page.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' })
  } else if (key === 'category-term' || key === 'tag-term') {
    await page.locator('[data-post-shell]').first().waitFor({ state: 'visible' })
  } else {
    await page.locator('[data-not-found-code]').waitFor({ state: 'visible' })
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {number} [offset]
 * @returns {Promise<void>}
 */
async function scrollLocatorIntoCapture(page, locator, offset = 96) {
  await locator.waitFor({ state: 'visible' })
  await locator.evaluate((element, captureOffset) => {
    const rect = element.getBoundingClientRect()
    window.scrollTo(0, window.scrollY + rect.top - captureOffset)
  }, offset)
}

/**
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<void>}
 */
async function waitForImageReady(locator) {
  await locator.evaluate(async (element) => {
    if (!(element instanceof HTMLImageElement)) {
      throw new Error('Expected image capture target to be an HTML image')
    }

    if (!element.complete || element.naturalWidth === 0) {
      await new Promise((resolve, reject) => {
        element.addEventListener('load', resolve, { once: true })
        element.addEventListener('error', reject, { once: true })
      })
    }

    if (typeof element.decode === 'function') {
      await element.decode()
    }
  })
}

/**
 * @param {import('@playwright/test').Locator} locator
 * @returns {Promise<void>}
 */
async function waitForElementAnimations(locator) {
  await locator.evaluate(async (element) => {
    const animations = element.getAnimations({ subtree: true })
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
  })
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function waitForStableCaptureMotion(page) {
  for (const selector of ['header', '#main-content']) {
    const locator = page.locator(selector).first()

    if ((await locator.count()) > 0) {
      await waitForElementAnimations(locator)
    }
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {ThemeName} theme
 * @returns {Promise<void>}
 */
async function ensureStableTheme(page, theme) {
  const apply = async () => {
    await page.evaluate((selectedTheme) => {
      localStorage.setItem('theme', selectedTheme)
      const root = document.documentElement
      root.classList.toggle('light', selectedTheme === 'light')
      root.classList.toggle('dark', selectedTheme === 'dark')
      root.style.colorScheme = selectedTheme
    }, theme)
  }
  const waitForTheme = async () => {
    await page.waitForFunction(
      (selectedTheme) => {
        const root = document.documentElement
        return root.classList.contains('dark') === (selectedTheme === 'dark')
      },
      theme,
      { timeout: 3000 }
    )
  }

  await apply()
  await waitForTheme()
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
  await apply()
  await waitForTheme()
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} textScale
 * @returns {Promise<void>}
 */
async function applyTextScale(page, textScale) {
  await page.evaluate((scale) => {
    const root = document.documentElement
    if (scale === 100) {
      root.style.removeProperty('font-size')
    } else {
      root.style.fontSize = `${scale}%`
    }
  }, textScale)

  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  )
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
async function injectReadingFixture(page) {
  await page.evaluate((fixtureHtml) => {
    const prose = document.querySelector(
      '[data-article-body].article-prose, [data-article-body] .article-prose'
    )
    if (!(prose instanceof HTMLElement)) {
      throw new Error('Missing article prose fixture target')
    }

    prose.innerHTML = fixtureHtml
  }, readingFixtureHtml)
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {PageKey} key
 * @returns {Promise<void>}
 */
async function configurePageBeforeNavigation(page, key) {
  await page.unroute('**/pagefind/pagefind.js').catch(() => undefined)

  if (key === 'search-error') {
    await page.route('**/pagefind/pagefind.js', (route) => route.abort())
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {PageKey} key
 * @param {{ searchQuery: string, emptyQuery: string }} options
 * @returns {Promise<void>}
 */
async function prepareSearchCapture(page, key, options) {
  if (key === 'search' || key === 'search-initial') {
    return
  }

  const searchbox = page.getByRole('searchbox')
  const query = key === 'search-empty' ? options.emptyQuery : options.searchQuery

  await searchbox.fill(query)

  if (key === 'search-results') {
    const firstResult = page.locator('[data-search-result-card]').first()
    await firstResult.waitFor({ state: 'visible' })
    await waitForElementAnimations(firstResult)
  } else if (key === 'search-empty') {
    await page.locator('[data-search-results][data-search-state="empty"]').waitFor()
  } else if (key === 'search-error') {
    await page.locator('[data-search-results][data-search-state="error"]').waitFor()
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {PageKey} key
 * @param {{ searchQuery: string, emptyQuery: string }} options
 * @returns {Promise<void>}
 */
async function prepareCapture(page, key, options) {
  await waitForReady(page, key)
  await page.evaluate(() => document.fonts?.ready.then(() => undefined))

  if (key.startsWith('search')) {
    await prepareSearchCapture(page, key, options)
    return
  }

  if (key === 'article-top' || key === 'article') {
    await page.evaluate(() => window.scrollTo(0, 0))
    return
  }

  if (key === 'article-inline-code') {
    await scrollLocatorIntoCapture(
      page,
      page
        .locator(
          '[data-article-body].article-prose :not(pre) > code, [data-article-body] .article-prose :not(pre) > code'
        )
        .first()
    )
    return
  }

  if (key === 'markdown-fixture') {
    await injectReadingFixture(page)
    await waitForImageReady(page.locator('[data-article-body] img').first())
    await scrollLocatorIntoCapture(page, page.locator('#reading-fixture-h2').first(), 104)
    return
  }

  if (key === 'article-math') {
    await scrollLocatorIntoCapture(page, page.locator("mjx-container[display='true']").first())
    return
  }

  if (key === 'article-code') {
    await scrollLocatorIntoCapture(
      page,
      page.locator('figure[data-rehype-pretty-code-figure]').first()
    )
    return
  }

  if (key === 'article-table') {
    await scrollLocatorIntoCapture(page, page.locator('.article-table-scroll').first())
    return
  }

  if (key === 'article-toc') {
    const tocButton = page.locator('.article-toc-mobile button').first()

    if (await tocButton.isVisible()) {
      await tocButton.click()
      await page.locator('.article-toc-mobile nav').waitFor({ state: 'visible' })
    } else {
      await page.locator('.article-toc-desktop').scrollIntoViewIfNeeded()
    }

    return
  }

  if (key === 'article-image') {
    const image = page.locator('[data-article-body] img').first()

    await scrollLocatorIntoCapture(page, image)
    await waitForImageReady(image)
    return
  }

  if (key === 'article-data-block') {
    await scrollLocatorIntoCapture(page, page.locator('.article-data-block').first())
    return
  }

  if (key === 'article-bottom') {
    const bottomTarget = page.locator('.article-post-nav, [data-article-reader] footer').last()
    await bottomTarget.scrollIntoViewIfNeeded()
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string | null} selector
 * @returns {Promise<void>}
 */
async function applyOptionalScroll(page, selector) {
  if (!selector) {
    return
  }

  await scrollLocatorIntoCapture(page, page.locator(selector).first())
}

/**
 * @param {string} baseUrl
 * @param {string} pagePath
 * @returns {string}
 */
function createCaptureUrl(baseUrl, pagePath) {
  return new URL(pagePath.replace(/^\//, ''), baseUrl).toString()
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isToolInitError(text) {
  return text.includes('documentElement') || text.includes('classList')
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {() => void}
 */
function trackToolInitErrors(page) {
  const messages = /** @type {string[]} */ ([])

  page.on('pageerror', (error) => {
    if (isToolInitError(error.message)) {
      messages.push(error.message)
    }
  })

  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'error' && isToolInitError(text)) {
      messages.push(text)
    }
  })

  return () => {
    if (messages.length > 0) {
      throw new Error(`Screenshot tool init emitted errors: ${messages.join(' | ')}`)
    }
  }
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const label = sanitizeLabel(readArg(rawArgs, '--label') || 'manual')
  const locale = readArg(rawArgs, '--locale') || defaultLocale
  const articlePath = readArg(rawArgs, '--article-path') || `/${locale}/${defaultArticleSlug}/`
  const baseUrl = normalizeBaseUrl(readArg(rawArgs, '--base-url') || defaultBaseUrl)
  const fullPage = rawArgs.includes('--full-page')
  const selector = readArg(rawArgs, '--selector')
  const scrollToSelector = readArg(rawArgs, '--scroll-to')
  const searchQuery = readArg(rawArgs, '--search-query') || '小米'
  const emptyQuery = readArg(rawArgs, '--empty-query') || 'zzzxxyqnohit260804'
  const textScale = parseTextScale(readArg(rawArgs, '--text-scale'))
  const outputDir =
    readArg(rawArgs, '--out-dir') || path.join(agentRecordsRoot, 'screenshots', label)
  const safeOutputDir = resolveAgentRecordsPath(outputDir)
  const themes = parseThemes(rawArgs)
  const pageKeys = parsePageKeys(rawArgs)
  const viewports = parseViewports(rawArgs)
  const pageDefinitions = createPageDefinitions(locale, articlePath)
  const searchOptions = { searchQuery, emptyQuery }

  await mkdir(safeOutputDir, { recursive: true })

  const browser = await chromium.launch()

  try {
    for (const theme of themes) {
      for (const viewport of viewports) {
        const context = await browser.newContext({
          colorScheme: theme,
          deviceScaleFactor: viewport.deviceScaleFactor,
          hasTouch: viewport.hasTouch,
          isMobile: viewport.isMobile,
          reducedMotion: 'reduce',
          viewport: { width: viewport.width, height: viewport.height },
        })

        await context.addInitScript(
          /**
           * @param {{ selectedTheme: ThemeName, selectedTextScale: number }} options
           */
          ({ selectedTheme, selectedTextScale }) => {
            localStorage.setItem('theme', selectedTheme)
            const root = document.documentElement
            if (root) {
              root.classList.toggle('light', selectedTheme === 'light')
              root.classList.toggle('dark', selectedTheme === 'dark')
              root.style.colorScheme = selectedTheme
              if (selectedTextScale === 100) {
                root.style.removeProperty('font-size')
              } else {
                root.style.fontSize = `${selectedTextScale}%`
              }
            }
          },
          { selectedTheme: theme, selectedTextScale: textScale }
        )

        const page = await context.newPage()
        const assertNoToolInitErrors = trackToolInitErrors(page)

        try {
          for (const key of pageKeys) {
            const definition = pageDefinitions[key]
            const url = createCaptureUrl(baseUrl, definition.path)

            await configurePageBeforeNavigation(page, definition.key)

            const response = await page.goto(url, { waitUntil: 'load' })
            const status = response?.status() || 0

            if (definition.expectedStatus) {
              if (status !== definition.expectedStatus) {
                throw new Error(
                  `${definition.path} returned ${status}, expected ${definition.expectedStatus}`
                )
              }
            } else if (status >= 400 || status === 0) {
              throw new Error(`${definition.path} returned ${status}`)
            }

            await ensureStableTheme(page, theme)
            await applyTextScale(page, textScale)
            await prepareCapture(page, definition.key, searchOptions)
            await applyOptionalScroll(page, scrollToSelector)
            await ensureStableTheme(page, theme)
            await applyTextScale(page, textScale)
            await waitForStableCaptureMotion(page)

            const textScaleSuffix = textScale === 100 ? '' : `-textscale${textScale}`
            const fileName = `${definition.key}-${theme}-${viewport.name}-${viewport.width}x${viewport.height}${textScaleSuffix}.png`
            const filePath = path.join(safeOutputDir, fileName)
            if (selector) {
              await page.locator(selector).first().screenshot({ path: filePath })
            } else {
              await page.screenshot({ path: filePath, fullPage })
            }
            assertNoToolInitErrors()
            console.log(`Captured ${filePath}`)
          }
        } finally {
          await page.close()
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
