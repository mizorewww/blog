#!/usr/bin/env node
// @ts-check

import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARTICLE_DESKTOP_TOC_BREAKPOINT,
  ARTICLE_RAIL_MAX_ZH_REM,
  ARTICLE_SHELL_MAX_WIDTH,
  ARTICLE_TOC_GAP,
  ARTICLE_TOC_WIDTH,
} from '../lib/articleLayout.ts'
import { readingFixtureHtml } from './reading-fixture.mjs'

/**
 * @typedef {import('@playwright/test').Browser} Browser
 * @typedef {import('@playwright/test').Page} Page
 * @typedef {'dark' | 'light'} ThemeName
 * @typedef {'compact' | 'mobile' | 'landscape' | 'reflow200' | 'tablet' | 'laptop' | 'desktop' | 'w1280' | 'w1440' | 'w1728' | 'w1920' | '1280' | '1440' | '1728' | '1920'} ViewportName
 * @typedef {{ width: number, height: number, isMobile?: boolean, hasTouch?: boolean, deviceScaleFactor: number }} ViewportDefinition
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {(page: Page, viewport: ViewportDefinition) => Promise<unknown>} ProbeCallback
 */

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const agentRecordsRoot = path.join(projectRoot, 'docs', 'agent-records')
const defaultBaseUrl = 'http://127.0.0.1:3001'

const viewportPresets = /** @type {Record<ViewportName, ViewportDefinition>} */ ({
  compact: { width: 320, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  mobile: { width: 375, height: 812, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  landscape: { width: 812, height: 375, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
  reflow200: { width: 640, height: 900, deviceScaleFactor: 1 },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 1 },
  laptop: { width: 1024, height: 768, deviceScaleFactor: 1 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  w1280: { width: 1280, height: 960, deviceScaleFactor: 1 },
  w1440: { width: 1440, height: 960, deviceScaleFactor: 1 },
  w1728: { width: 1728, height: 960, deviceScaleFactor: 1 },
  w1920: { width: 1920, height: 960, deviceScaleFactor: 1 },
  1280: { width: 1280, height: 960, deviceScaleFactor: 1 },
  1440: { width: 1440, height: 960, deviceScaleFactor: 1 },
  1728: { width: 1728, height: 960, deviceScaleFactor: 1 },
  1920: { width: 1920, height: 960, deviceScaleFactor: 1 },
})

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
 * @param {string} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
  return value.endsWith('/') ? value : `${value}/`
}

/**
 * @param {string} baseUrl
 * @param {string} pathname
 * @returns {string}
 */
function createUrl(baseUrl, pathname) {
  return new URL(pathname.replace(/^\//, ''), baseUrl).toString()
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

  throw new Error('Probe output must stay inside docs/agent-records/')
}

/**
 * @param {number} value
 * @returns {number}
 */
function round(value) {
  return Math.round(value * 10) / 10
}

/**
 * @param {Rect | null} rect
 * @returns {{ x: number, y: number, width: number, height: number, right: number, bottom: number } | null}
 */
function simplifyBox(rect) {
  return rect
    ? {
        x: round(rect.x),
        y: round(rect.y),
        width: round(rect.width),
        height: round(rect.height),
        right: round(rect.x + rect.width),
        bottom: round(rect.y + rect.height),
      }
    : null
}

/**
 * @param {Page} page
 * @returns {Promise<{ scrollWidth: number, clientWidth: number, overflowPx: number, scrollHeight: number, clientHeight: number }>}
 */
async function documentMetrics(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }))
}

/**
 * @param {Page} page
 * @param {string} selector
 * @returns {Promise<Rect>}
 */
async function elementBox(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
}

/**
 * @param {Page} page
 * @param {string} selector
 * @returns {Promise<Rect | null>}
 */
async function optionalElementBox(page, selector) {
  const locator = page.locator(selector).first()

  if ((await locator.count()) === 0) {
    return null
  }

  return elementBox(page, selector)
}

/**
 * @param {Page} page
 * @param {string} selector
 * @returns {Promise<Rect[]>}
 */
async function boxesForSelector(page, selector) {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
  )
}

/**
 * @param {Page} page
 * @param {string} selector
 * @returns {Promise<{ backgroundColor: string, boxShadow: string, color: string, fontSize: string, fontWeight: string, opacity: string }>}
 */
async function stylesForSelector(page, selector) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        color: style.color,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        opacity: style.opacity,
      }
    })
}

/**
 * @param {Page} page
 * @returns {Promise<Record<string, number>>}
 */
async function articleCoverage(page) {
  return page.locator('[data-article-body] .article-prose').evaluate((root) => {
    /**
     * @param {string} selector
     * @returns {number}
     */
    const count = (selector) => root.querySelectorAll(selector).length

    return {
      p: count('p'),
      h2: count('h2'),
      h3: count('h3'),
      h4: count('h4'),
      h5: count('h5'),
      h6: count('h6'),
      strong: count('strong'),
      em: count('em'),
      del: count('del'),
      ul: count('ul'),
      ol: count('ol'),
      li: count('li'),
      task: count('.task-list-item, input[type="checkbox"]'),
      a: count('a'),
      blockquote: count('blockquote'),
      inlineCode: count(':not(pre) > code'),
      linkedCode: count('a code'),
      fencedCode: count('pre code'),
      tables: count('table'),
      images: count('img'),
      figures: count('figure'),
      captions: count('figcaption'),
      hr: count('hr'),
      details: count('details'),
      summary: count('summary'),
      footnotes: count('.footnotes'),
      footnoteRefs: count('sup a[href^="#reading-fixture-footnote"], sup a[href^="#fn"]'),
      footnoteBackrefs: count('.data-footnote-backref, a[href^="#fnref"]'),
      kbd: count('kbd'),
      abbr: count('abbr'),
      mark: count('mark'),
      sub: count('sub'),
      sup: count('sup'),
      math: count('mjx-container'),
      longTokens: Array.from(root.querySelectorAll('p, li, td')).filter((element) =>
        /[A-Za-z0-9:/._-]{48,}/.test(element.textContent || '')
      ).length,
    }
  })
}

/**
 * @param {Page} page
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function inlineCodeMetrics(page) {
  const locator = page.locator('[data-article-body] .article-prose :not(pre) > code').first()

  if ((await locator.count()) === 0) {
    return null
  }

  return locator.evaluate((element) => {
    /**
     * @param {string} value
     * @returns {{ r: number, g: number, b: number, a: number } | null}
     */
    const parseColor = (value) => {
      const match = value.match(
        /rgba?\(\s*([0-9.]+)\s*,?\s+([0-9.]+)\s*,?\s+([0-9.]+)(?:\s*[/,]\s*([0-9.]+%?))?\s*\)/
      )

      if (!match) {
        return null
      }

      const alpha = match[4]?.endsWith('%')
        ? Number.parseFloat(match[4]) / 100
        : Number.parseFloat(match[4] || '1')

      return {
        r: Number.parseFloat(match[1]),
        g: Number.parseFloat(match[2]),
        b: Number.parseFloat(match[3]),
        a: alpha,
      }
    }
    /**
     * @param {{ r: number, g: number, b: number, a: number }} top
     * @param {{ r: number, g: number, b: number, a: number }} bottom
     * @returns {{ r: number, g: number, b: number, a: number }}
     */
    const composite = (top, bottom) => {
      const alpha = top.a + bottom.a * (1 - top.a)

      if (alpha === 0) {
        return { r: 0, g: 0, b: 0, a: 0 }
      }

      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
        a: alpha,
      }
    }
    /**
     * @param {number} channel
     * @returns {number}
     */
    const luminanceChannel = (channel) => {
      const normalized = channel / 255
      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    }
    /**
     * @param {{ r: number, g: number, b: number, a: number }} color
     * @returns {number}
     */
    const luminance = (color) =>
      0.2126 * luminanceChannel(color.r) +
      0.7152 * luminanceChannel(color.g) +
      0.0722 * luminanceChannel(color.b)
    /**
     * @param {{ r: number, g: number, b: number, a: number }} first
     * @param {{ r: number, g: number, b: number, a: number }} second
     * @returns {number}
     */
    const contrast = (first, second) => {
      const firstLuminance = luminance(first)
      const secondLuminance = luminance(second)
      const lighter = Math.max(firstLuminance, secondLuminance)
      const darker = Math.min(firstLuminance, secondLuminance)

      return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
    }
    /**
     * @param {Element} target
     * @returns {{ r: number, g: number, b: number, a: number }}
     */
    const effectiveBackground = (target) => {
      const chain = /** @type {Element[]} */ ([])
      let current = /** @type {Element | null} */ (target)

      while (current instanceof Element) {
        chain.push(current)
        current = current.parentElement
      }

      let result = getComputedStyle(document.documentElement).colorScheme.includes('dark')
        ? { r: 0, g: 0, b: 0, a: 1 }
        : { r: 255, g: 255, b: 255, a: 1 }

      for (const item of chain.reverse()) {
        const color = parseColor(getComputedStyle(item).backgroundColor)

        if (color && color.a > 0) {
          result = composite(color, result)
        }
      }

      return result
    }

    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const foreground = parseColor(style.color)
    const background = effectiveBackground(element)

    return {
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      },
      style: {
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        boxDecorationBreak:
          style.getPropertyValue('box-decoration-break') ||
          style.getPropertyValue('-webkit-box-decoration-break'),
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        paddingInlineStart: style.paddingInlineStart,
        paddingInlineEnd: style.paddingInlineEnd,
      },
      contrast: foreground ? contrast(foreground, background) : 0,
    }
  })
}

/**
 * @param {Page} page
 * @param {string} selector
 * @returns {Promise<Record<string, unknown> | null>}
 */
async function internalScrollMetrics(page, selector) {
  const locator = page.locator(selector).first()

  if ((await locator.count()) === 0) {
    return null
  }

  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)

    return {
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      },
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      overflowX: style.overflowX,
      backgroundImage: style.backgroundImage,
      backgroundAttachment: style.backgroundAttachment,
    }
  })
}

/**
 * @param {Page} page
 * @returns {Promise<Record<string, unknown>>}
 */
async function articleRailAlignmentMetrics(page) {
  return page.locator('[data-article-body] .article-prose').evaluate((root) => {
    const paragraph = root.querySelector(':scope > p')
    const surface = document.querySelector('[data-article-surface]')

    if (!(paragraph instanceof HTMLElement) || !(surface instanceof HTMLElement)) {
      throw new Error('Missing article rail alignment target')
    }

    /**
     * @param {Element} element
     * @returns {{ left: number, right: number, width: number, height: number }}
     */
    const rect = (element) => {
      const bounds = element.getBoundingClientRect()

      return {
        left: Math.round(bounds.left * 10) / 10,
        right: Math.round(bounds.right * 10) / 10,
        width: Math.round(bounds.width * 10) / 10,
        height: Math.round(bounds.height * 10) / 10,
      }
    }
    const reference = rect(paragraph)
    /**
     * @param {string} name
     * @param {Element} element
     * @returns {{ name: string, left: number, right: number, width: number }}
     */
    const edgeDelta = (name, element) => {
      const bounds = rect(element)

      return {
        name,
        left: Math.round((bounds.left - reference.left) * 10) / 10,
        right: Math.round((bounds.right - reference.right) * 10) / 10,
        width: Math.round((bounds.width - reference.width) * 10) / 10,
      }
    }
    const directSelectors = [
      ['h2', ':scope > h2'],
      ['h3', ':scope > h3'],
      ['h4', ':scope > h4'],
      ['h5', ':scope > h5'],
      ['h6', ':scope > h6'],
      ['ul', ':scope > ul'],
      ['ol', ':scope > ol'],
      ['blockquote', ':scope > blockquote'],
      ['details', ':scope > details'],
      ['figure', ':scope > .article-figure'],
      ['figcaption', ':scope > .article-figure figcaption'],
      ['shiki', ':scope > figure[data-rehype-pretty-code-figure]'],
      ['shiki-pre', ':scope > figure[data-rehype-pretty-code-figure] [data-code-pre]'],
      ['table', ':scope > .article-table-scroll'],
      ['math', ":scope > mjx-container[jax='SVG'][display='true']"],
      ['pre', ':scope > pre'],
      ['data-block', ':scope > .article-data-block'],
      ['footnotes', ':scope > .footnotes'],
    ]
    const directEdges = directSelectors.flatMap(([name, selector]) => {
      const element = root.querySelector(selector)

      return element ? [edgeDelta(name, element)] : []
    })
    const railEdges = Array.from(document.querySelectorAll('.article-content-rail'))
      .filter((element) => {
        const bounds = element.getBoundingClientRect()

        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          element instanceof HTMLElement &&
          !!element.closest('[data-article-surface]')
        )
      })
      .map((element, index) => edgeDelta(`rail-${index}`, element))
    const scrollSurfaces = [
      'figure[data-rehype-pretty-code-figure] [data-code-pre]',
      '.article-table-scroll',
      "mjx-container[jax='SVG'][display='true']",
      ':scope > pre',
    ].flatMap((selector) => {
      const element = selector.startsWith(':scope')
        ? root.querySelector(selector)
        : root.querySelector(selector)

      if (!(element instanceof HTMLElement)) {
        return []
      }

      const style = getComputedStyle(element)

      return [
        {
          selector,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowPx: element.scrollWidth - element.clientWidth,
          overflowX: style.overflowX,
          backgroundImage: style.backgroundImage,
          backgroundAttachment: style.backgroundAttachment,
        },
      ]
    })
    const toc = document.querySelector('.article-toc-desktop')
    const tocRect = toc instanceof HTMLElement ? toc.getBoundingClientRect() : null
    const tocVisible =
      toc instanceof HTMLElement &&
      !!tocRect &&
      getComputedStyle(toc).display !== 'none' &&
      tocRect.width > 0 &&
      tocRect.height > 0
    /**
     * @param {string | undefined} value
     * @returns {number}
     */
    const parseAlpha = (value) =>
      value?.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value || '1')
    /**
     * @param {string} value
     * @returns {number}
     */
    const parseLightness = (value) =>
      value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value)
    /**
     * @param {number} channel
     * @returns {number}
     */
    const srgbChannel = (channel) => {
      const clamped = Math.min(1, Math.max(0, channel))

      return (clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055) * 255
    }
    /**
     * @param {number} l
     * @param {number} a
     * @param {number} b
     * @param {number} alpha
     * @returns {{ r: number, g: number, b: number, a: number }}
     */
    const oklabToRgba = (l, a, b, alpha) => {
      const lPrime = l + 0.3963377774 * a + 0.2158037573 * b
      const mPrime = l - 0.1055613458 * a - 0.0638541728 * b
      const sPrime = l - 0.0894841775 * a - 1.291485548 * b
      const l3 = lPrime ** 3
      const m3 = mPrime ** 3
      const s3 = sPrime ** 3

      return {
        r: srgbChannel(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
        g: srgbChannel(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
        b: srgbChannel(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
        a: alpha,
      }
    }
    /**
     * @param {string} value
     * @returns {{ r: number, g: number, b: number, a: number } | null}
     */
    const parseColor = (value) => {
      const rgb = value.match(
        /rgba?\(\s*([0-9.]+)\s*,?\s+([0-9.]+)\s*,?\s+([0-9.]+)(?:\s*[/,]\s*([0-9.]+%?))?\s*\)/
      )

      if (rgb) {
        return {
          r: Number.parseFloat(rgb[1]),
          g: Number.parseFloat(rgb[2]),
          b: Number.parseFloat(rgb[3]),
          a: parseAlpha(rgb[4]),
        }
      }

      const oklab = value.match(
        /oklab\(\s*([^)\s]+)\s+([^)\s]+)\s+([^)\s/]+)(?:\s*\/\s*([^)\s]+))?\s*\)/
      )

      if (oklab) {
        return oklabToRgba(
          parseLightness(oklab[1]),
          Number.parseFloat(oklab[2]),
          Number.parseFloat(oklab[3]),
          parseAlpha(oklab[4])
        )
      }

      const oklch = value.match(
        /oklch\(\s*([^)\s]+)\s+([^)\s]+)\s+([^)\s/]+)(?:\s*\/\s*([^)\s]+))?\s*\)/
      )

      if (oklch) {
        const hue = (Number.parseFloat(oklch[3]) * Math.PI) / 180
        const chroma = Number.parseFloat(oklch[2])

        return oklabToRgba(
          parseLightness(oklch[1]),
          chroma * Math.cos(hue),
          chroma * Math.sin(hue),
          parseAlpha(oklch[4])
        )
      }

      return null
    }
    /**
     * @param {{ r: number, g: number, b: number, a: number }} top
     * @param {{ r: number, g: number, b: number, a: number }} bottom
     * @returns {{ r: number, g: number, b: number, a: number }}
     */
    const composite = (top, bottom) => {
      const alpha = top.a + bottom.a * (1 - top.a)

      if (alpha === 0) {
        return { r: 0, g: 0, b: 0, a: 0 }
      }

      return {
        r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
        g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
        b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
        a: alpha,
      }
    }
    /**
     * @param {number} channel
     * @returns {number}
     */
    const luminanceChannel = (channel) => {
      const normalized = channel / 255

      return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    }
    /**
     * @param {{ r: number, g: number, b: number, a: number }} color
     * @returns {number}
     */
    const luminance = (color) =>
      0.2126 * luminanceChannel(color.r) +
      0.7152 * luminanceChannel(color.g) +
      0.0722 * luminanceChannel(color.b)
    /**
     * @param {{ r: number, g: number, b: number, a: number }} first
     * @param {{ r: number, g: number, b: number, a: number }} second
     * @returns {number}
     */
    const contrast = (first, second) => {
      const lighter = Math.max(luminance(first), luminance(second))
      const darker = Math.min(luminance(first), luminance(second))

      return (lighter + 0.05) / (darker + 0.05)
    }
    /**
     * @param {Element} target
     * @returns {{ r: number, g: number, b: number, a: number }}
     */
    const effectiveBackground = (target) => {
      const chain = /** @type {Element[]} */ ([])
      let current = /** @type {Element | null} */ (target)

      while (current) {
        chain.push(current)
        current = current.parentElement
      }

      let result = getComputedStyle(document.documentElement).colorScheme.includes('dark')
        ? { r: 0, g: 0, b: 0, a: 1 }
        : { r: 255, g: 255, b: 255, a: 1 }

      for (const item of chain.reverse()) {
        const color = parseColor(getComputedStyle(item).backgroundColor)

        if (color && color.a > 0) {
          result = composite(color, result)
        }
      }

      return result
    }
    /**
     * @param {Element} target
     * @returns {number}
     */
    const inheritedOpacity = (target) => {
      let opacity = 1
      let current = /** @type {Element | null} */ (target)

      while (current instanceof HTMLElement) {
        opacity *= Number.parseFloat(getComputedStyle(current).opacity)
        current = current.parentElement
      }

      return opacity
    }
    /**
     * @param {HTMLElement} target
     * @returns {number}
     */
    const renderedContrast = (target) => {
      const foreground = parseColor(getComputedStyle(target).color)

      if (!foreground) {
        return 0
      }

      const background = effectiveBackground(target)
      const paintedForeground = composite(
        { ...foreground, a: foreground.a * inheritedOpacity(target) },
        background
      )

      return Math.round(contrast(paintedForeground, background) * 100) / 100
    }
    const surfaceRect = surface.getBoundingClientRect()
    const groupLeft = Math.min(surfaceRect.left, tocVisible ? tocRect.left : surfaceRect.left)
    const groupRight = Math.max(surfaceRect.right, tocVisible ? tocRect.right : surfaceRect.right)
    const tocHeading = tocVisible && toc instanceof HTMLElement ? toc.querySelector('h2') : null
    const tocHeadingContrast = tocHeading instanceof HTMLElement ? renderedContrast(tocHeading) : 0
    const table = root.querySelector(':scope > .article-table-scroll')
    const tableRect = table instanceof HTMLElement ? table.getBoundingClientRect() : null
    const tableInner = table instanceof HTMLElement ? table.querySelector('table') : null
    const tableHeader = table instanceof HTMLElement ? table.querySelector('th') : null
    const tableEvenCell =
      table instanceof HTMLElement ? table.querySelector('tbody tr:nth-child(even) td') : null
    const tableMetrics =
      table instanceof HTMLElement && tableRect && tableInner instanceof HTMLElement
        ? {
            width: Math.round(tableRect.width * 10) / 10,
            left: Math.round(tableRect.left * 10) / 10,
            clientWidth: table.clientWidth,
            scrollWidth: table.scrollWidth,
            overflowX: getComputedStyle(table).overflowX,
            tableWidth: Math.round(tableInner.getBoundingClientRect().width * 10) / 10,
            tableComputedWidth: getComputedStyle(tableInner).width,
            containerComputedWidth: getComputedStyle(table).width,
            thBackground:
              tableHeader instanceof HTMLElement
                ? getComputedStyle(tableHeader).backgroundColor
                : '',
            evenRowBackground:
              tableEvenCell instanceof HTMLElement
                ? getComputedStyle(tableEvenCell).backgroundColor
                : '',
          }
        : null

    return {
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      },
      paragraph: reference,
      directEdges,
      railEdges,
      scrollSurfaces,
      table: tableMetrics,
      layout: {
        groupCenterOffset:
          Math.round(((groupLeft + groupRight) / 2 - window.innerWidth / 2) * 10) / 10,
        surfaceCenterOffset:
          Math.round(((surfaceRect.left + surfaceRect.right) / 2 - window.innerWidth / 2) * 10) /
          10,
        textCenterOffset:
          Math.round(((reference.left + reference.right) / 2 - window.innerWidth / 2) * 10) / 10,
        textLeftInset: Math.round((reference.left - surfaceRect.left) * 10) / 10,
        paragraphLeft: Math.round(reference.left * 10) / 10,
        paragraphRight: Math.round(reference.right * 10) / 10,
        surfaceLeft: Math.round(surfaceRect.left * 10) / 10,
        surfaceRight: Math.round(surfaceRect.right * 10) / 10,
      },
      toc:
        tocVisible && toc instanceof HTMLElement && tocRect
          ? {
              width: Math.round(tocRect.width * 10) / 10,
              gapFromSurface: Math.round((surfaceRect.left - tocRect.right) * 10) / 10,
              leftMargin: Math.round(tocRect.left * 10) / 10,
              position: getComputedStyle(toc).position,
              opacity: Math.round(Number.parseFloat(getComputedStyle(toc).opacity) * 100) / 100,
              headingContrast: tocHeadingContrast,
              items: Array.from(toc.querySelectorAll('a span')).map((item) => {
                const itemElement = /** @type {HTMLElement} */ (item)
                const rect = itemElement.getBoundingClientRect()
                const lineHeight = Number.parseFloat(getComputedStyle(itemElement).lineHeight) || 20

                return {
                  text: itemElement.textContent?.trim() || '',
                  clientWidth: itemElement.clientWidth,
                  scrollWidth: itemElement.scrollWidth,
                  lines: Math.max(1, Math.round(rect.height / lineHeight)),
                  contrast: renderedContrast(itemElement),
                  clipped: itemElement.scrollWidth > itemElement.clientWidth + 1,
                }
              }),
            }
          : null,
    }
  })
}

/**
 * @param {number} width
 * @returns {number}
 */
function articleShellLeft(width) {
  if (width < 640) {
    return 0
  }

  return (width - Math.min(ARTICLE_SHELL_MAX_WIDTH, width - 30)) / 2
}

/**
 * @param {number} width
 * @param {number} [textScale]
 * @returns {number}
 */
function articleGutterPx(width, textScale = 100) {
  const rootPx = 16 * (textScale / 100)
  const vw = width * 0.05
  return Math.min(Math.max(1.25 * rootPx, vw), 2.5 * rootPx)
}

/**
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>[]}
 */
function alignmentFailures(row) {
  const failures = /** @type {Record<string, unknown>[]} */ ([])
  const metrics = /** @type {Record<string, unknown>} */ (row.metrics)
  const viewport = /** @type {ViewportDefinition} */ (row.viewport)
  const textScale = typeof row.textScale === 'number' ? row.textScale : 100
  const document = /** @type {{ overflowPx: number }} */ (metrics.document)
  const layout =
    /** @type {{ groupCenterOffset: number, surfaceCenterOffset: number, textCenterOffset: number, textLeftInset: number, paragraphLeft: number, paragraphRight: number, surfaceLeft: number, surfaceRight: number }} */ (
      metrics.layout
    )
  const toc =
    /** @type {{ width: number, gapFromSurface: number, leftMargin: number, position: string, opacity: number, headingContrast: number, items: { text: string, clientWidth: number, scrollWidth: number, lines: number, contrast: number, clipped: boolean }[] } | null} */ (
      metrics.toc
    )
  const breakoutNames = new Set(['figure', 'shiki', 'shiki-pre', 'math', 'pre'])
  const tableNames = new Set(['table'])
  const captionNames = new Set(['figcaption'])
  const edgeGroups = [
    .../** @type {{ name: string, left: number, right: number, width: number }[]} */ (
      metrics.directEdges
    ),
    .../** @type {{ name: string, left: number, right: number, width: number }[]} */ (
      metrics.railEdges
    ),
  ]
  const railAlignedEdges = edgeGroups.filter(
    (edge) =>
      !breakoutNames.has(edge.name) && !tableNames.has(edge.name) && !captionNames.has(edge.name)
  )
  const breakoutEdges = edgeGroups.filter((edge) => breakoutNames.has(edge.name))
  const tableEdges = edgeGroups.filter((edge) => tableNames.has(edge.name))
  const captionEdges = edgeGroups.filter((edge) => captionNames.has(edge.name))
  const table =
    /** @type {{ width: number, left: number, clientWidth: number, scrollWidth: number, overflowX: string, tableWidth: number, tableComputedWidth: string, containerComputedWidth: string, thBackground: string, evenRowBackground: string } | null} */ (
      metrics.table
    )

  if (document.overflowPx > 0) {
    failures.push({ kind: 'page-overflow', overflowPx: document.overflowPx })
  }

  for (const edge of railAlignedEdges) {
    const maxDelta = Math.max(Math.abs(edge.left), Math.abs(edge.right), Math.abs(edge.width))

    if (maxDelta > 1) {
      failures.push({ kind: 'edge-drift', edge, maxDelta })
    }
  }

  for (const edge of breakoutEdges) {
    const breakoutLeft = layout.paragraphLeft + edge.left
    const breakoutRight = layout.paragraphRight + edge.right
    const leftInset = breakoutLeft - layout.surfaceLeft
    const rightInset = layout.surfaceRight - breakoutRight
    if (edge.width < -1 || Math.abs(leftInset - rightInset) > 2) {
      failures.push({ kind: 'breakout-misaligned', edge, leftInset, rightInset })
    }
  }

  for (const edge of tableEdges) {
    if (!table) {
      failures.push({ kind: 'table-missing', edge })
      continue
    }
    const breakoutMax = layout.surfaceRight - layout.surfaceLeft
    if (table.width > breakoutMax + 1) {
      failures.push({ kind: 'table-too-wide', width: table.width, breakoutMax })
    }
    if (/^100%/.test(table.containerComputedWidth) || table.tableComputedWidth === '100%') {
      failures.push({
        kind: 'table-stretched',
        containerComputedWidth: table.containerComputedWidth,
        tableComputedWidth: table.tableComputedWidth,
      })
    }
    if (table.width > Math.max(table.tableWidth, table.scrollWidth) + 2) {
      failures.push({
        kind: 'table-not-fit-content',
        width: table.width,
        tableWidth: table.tableWidth,
      })
    }
    if (
      row.route === '/zh/making-memoh-cheaper-on-telegram/' &&
      !row.fixture &&
      viewport.width >= ARTICLE_DESKTOP_TOC_BREAKPOINT &&
      row.textScale === 100
    ) {
      const compactTableMax = ARTICLE_RAIL_MAX_ZH_REM * 16 * 0.75
      const paragraphWidth = layout.paragraphRight - layout.paragraphLeft
      if (table.width > compactTableMax || table.width >= paragraphWidth - 80) {
        failures.push({
          kind: 'table-not-compact',
          width: table.width,
          compactTableMax,
          paragraphWidth,
        })
      }
    }
    if (viewport.width >= ARTICLE_DESKTOP_TOC_BREAKPOINT) {
      if (Math.abs(edge.left) > 1) {
        failures.push({ kind: 'table-left-misaligned', edge })
      }
    } else if (Math.abs(edge.left + edge.right) > 2) {
      failures.push({ kind: 'table-not-centered', edge })
    }
    if (
      table.scrollWidth > table.clientWidth + 1 &&
      !['auto', 'scroll'].includes(table.overflowX)
    ) {
      failures.push({ kind: 'table-overflow-hidden', overflowX: table.overflowX })
    }
    if (!table.thBackground || table.thBackground === 'rgba(0, 0, 0, 0)') {
      failures.push({ kind: 'table-header-unstyled', thBackground: table.thBackground })
    }
    if (table.evenRowBackground === table.thBackground) {
      failures.push({ kind: 'table-zebra-missing', evenRowBackground: table.evenRowBackground })
    }
  }

  for (const edge of captionEdges) {
    if (edge.width > 1 || Math.abs(edge.left + edge.right) > 2) {
      failures.push({ kind: 'caption-misaligned', edge })
    }
  }

  if (viewport.width < ARTICLE_DESKTOP_TOC_BREAKPOINT && Math.abs(layout.surfaceCenterOffset) > 1) {
    failures.push({ kind: 'surface-offset', offset: layout.surfaceCenterOffset })
  }

  if (viewport.width < ARTICLE_DESKTOP_TOC_BREAKPOINT) {
    if (Math.abs(layout.textCenterOffset - layout.surfaceCenterOffset) > 1) {
      failures.push({ kind: 'text-offset', offset: layout.textCenterOffset })
    }
  } else {
    const gutter = articleGutterPx(viewport.width, textScale)
    if (layout.textLeftInset < gutter - 1 || layout.textLeftInset > gutter + 1) {
      failures.push({ kind: 'text-left-inset', inset: layout.textLeftInset, gutter })
    }
  }

  if (viewport.width >= ARTICLE_DESKTOP_TOC_BREAKPOINT) {
    if (!toc) {
      failures.push({ kind: 'toc-missing' })
    } else {
      if (toc.width < ARTICLE_TOC_WIDTH - 1 || toc.width > ARTICLE_TOC_WIDTH + 1) {
        failures.push({ kind: 'toc-width', width: toc.width })
      }

      if (toc.gapFromSurface < ARTICLE_TOC_GAP - 1 || toc.gapFromSurface > ARTICLE_TOC_GAP + 1) {
        failures.push({ kind: 'toc-gap', gap: toc.gapFromSurface })
      }

      if (Math.abs(toc.leftMargin - articleShellLeft(viewport.width)) > 1) {
        failures.push({ kind: 'toc-left-margin', leftMargin: toc.leftMargin })
      }

      if (toc.position !== 'sticky') {
        failures.push({ kind: 'toc-position', position: toc.position })
      }

      if (toc.opacity !== 1) {
        failures.push({ kind: 'toc-opacity', opacity: toc.opacity })
      }

      if (toc.headingContrast < 4.5) {
        failures.push({ kind: 'toc-heading-contrast', contrast: toc.headingContrast })
      }

      for (const item of toc.items) {
        if (item.clipped || item.scrollWidth > item.clientWidth + 1) {
          failures.push({ kind: 'toc-label-overflow', item })
        }

        if (item.contrast < 4.5) {
          failures.push({ kind: 'toc-label-contrast', item })
        }

        if (textScale === 100 && item.lines > 4) {
          failures.push({ kind: 'toc-label-lines', item })
        }
      }
    }
  } else {
    if (toc) {
      failures.push({ kind: 'toc-visible-before-wide', width: viewport.width })
    }

    if (Math.abs(layout.textCenterOffset) > 1) {
      failures.push({ kind: 'text-offset-before-wide', offset: layout.textCenterOffset })
    }
  }

  for (const item of /** @type {{ selector: string, overflowPx: number, overflowX: string, backgroundImage: string, backgroundAttachment: string }[]} */ (
    metrics.scrollSurfaces
  )) {
    if (
      item.overflowPx > 0 &&
      (!['auto', 'scroll'].includes(item.overflowX) ||
        !item.backgroundImage.includes('linear-gradient') ||
        !item.backgroundAttachment.includes('local'))
    ) {
      failures.push({ kind: 'scroll-affordance', item })
    }
  }

  return failures.map((failure) => ({
    route: row.route,
    theme: row.theme,
    textScale: row.textScale,
    viewport,
    ...failure,
  }))
}

/**
 * @param {Page} page
 * @returns {Promise<Record<string, unknown>>}
 */
async function articleTopMetrics(page) {
  return page.evaluate(() => {
    /**
     * @param {DOMRect} rect
     * @returns {{ x: number, y: number, width: number, height: number, right: number, bottom: number }}
     */
    const box = (rect) => ({
      x: Math.round(rect.x * 10) / 10,
      y: Math.round(rect.y * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
      right: Math.round(rect.right * 10) / 10,
      bottom: Math.round(rect.bottom * 10) / 10,
    })
    /**
     * @param {HTMLElement | null} element
     * @returns {{ fontSize: string, lineHeight: string, fontWeight: string, marginTop: string, marginBottom: string, color: string, backgroundColor: string, backgroundImage: string, borderColor: string, overflowX: string, whiteSpace: string } | null}
     */
    const styles = (element) => {
      if (!element) {
        return null
      }

      const style = getComputedStyle(element)

      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        marginTop: style.marginTop,
        marginBottom: style.marginBottom,
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        overflowX: style.overflowX,
        whiteSpace: style.whiteSpace,
      }
    }
    /**
     * @param {HTMLElement} element
     * @returns {{ top: number, count: number, width: number }[]}
     */
    const lineCounts = (element) => {
      const range = document.createRange()
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const lines = new Map()

      while (walker.nextNode()) {
        const node = walker.currentNode
        const text = node.textContent || ''

        for (let index = 0; index < text.length; index += 1) {
          if (text[index] === '\n') {
            continue
          }

          range.setStart(node, index)
          range.setEnd(node, index + 1)

          for (const rect of Array.from(range.getClientRects())) {
            if (rect.width === 0 || rect.height === 0) {
              continue
            }

            const top = Math.round(rect.top)
            const current = lines.get(top) || { top, count: 0, width: 0 }

            current.count += 1
            current.width = Math.max(
              current.width,
              rect.right - element.getBoundingClientRect().left
            )
            lines.set(top, current)
          }
        }
      }

      range.detach()

      return Array.from(lines.values()).sort((first, second) => first.top - second.top)
    }
    /**
     * @param {number[]} values
     * @returns {number}
     */
    const median = (values) => {
      if (values.length === 0) {
        return 0
      }

      const sorted = [...values].sort((first, second) => first - second)
      return sorted[Math.floor(sorted.length / 2)]
    }

    const surface = document.querySelector('[data-article-surface]')
    const body = document.querySelector('[data-article-body]')
    const prose = document.querySelector('[data-article-body] .article-prose')
    const h1 = document.querySelector('h1')
    const h2 = document.querySelector('[data-article-body] .article-prose h2')
    const h3 = document.querySelector('[data-article-body] .article-prose h3')
    const firstParagraph = document.querySelector('[data-article-body] .article-prose > p')
    const toc = document.querySelector('.article-toc-desktop')

    if (
      !(surface instanceof HTMLElement) ||
      !(body instanceof HTMLElement) ||
      !(prose instanceof HTMLElement) ||
      !(h1 instanceof HTMLElement) ||
      !(firstParagraph instanceof HTMLElement)
    ) {
      throw new Error('Missing reading probe target')
    }

    const firstParagraphRect = firstParagraph.getBoundingClientRect()
    const counts = lineCounts(firstParagraph)
    const countValues = counts.map((line) => line.count)
    const surfaceRect = surface.getBoundingClientRect()
    const tocRect = toc instanceof HTMLElement ? toc.getBoundingClientRect() : null
    const tocVisible =
      toc instanceof HTMLElement &&
      !!tocRect &&
      getComputedStyle(toc).display !== 'none' &&
      tocRect.width > 0 &&
      tocRect.height > 0
    const tocItems =
      tocVisible && toc instanceof HTMLElement
        ? Array.from(toc.querySelectorAll('a span')).map((item) => ({
            text: item.textContent?.trim() || '',
            clientWidth: item.clientWidth,
            scrollWidth: item.scrollWidth,
            lines: Math.round(item.getBoundingClientRect().height / 20),
          }))
        : []
    const groupLeft = Math.min(surfaceRect.left, tocVisible ? tocRect.left : surfaceRect.left)
    const groupRight = Math.max(surfaceRect.right, tocVisible ? tocRect.right : surfaceRect.right)

    return {
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      },
      surface: box(surfaceRect),
      body: box(body.getBoundingClientRect()),
      prose: box(prose.getBoundingClientRect()),
      h1: { rect: box(h1.getBoundingClientRect()), style: styles(h1) },
      h2:
        h2 instanceof HTMLElement
          ? { rect: box(h2.getBoundingClientRect()), style: styles(h2) }
          : null,
      h3:
        h3 instanceof HTMLElement
          ? { rect: box(h3.getBoundingClientRect()), style: styles(h3) }
          : null,
      firstParagraph: {
        rect: box(firstParagraphRect),
        style: styles(firstParagraph),
        textLength: firstParagraph.textContent?.trim().length || 0,
        lineCounts: counts,
        medianCharsPerLine: median(countValues),
        maxCharsPerLine: Math.max(...countValues),
        visibleHeight:
          Math.round(
            (Math.min(firstParagraphRect.bottom, window.innerHeight) -
              Math.max(firstParagraphRect.top, 0)) *
              10
          ) / 10,
      },
      toc:
        tocVisible && toc instanceof HTMLElement && tocRect
          ? {
              rect: box(tocRect),
              gapFromSurface: Math.round((tocRect.left - surfaceRect.right) * 10) / 10,
              items: tocItems,
            }
          : null,
      layout: {
        groupCenterOffset:
          Math.round(((groupLeft + groupRight) / 2 - window.innerWidth / 2) * 10) / 10,
      },
    }
  })
}

/**
 * @param {Browser} browser
 * @param {ThemeName} theme
 * @param {ViewportName} viewportName
 * @param {number} [textScale]
 * @returns {Promise<{ context: import('@playwright/test').BrowserContext, page: Page, viewport: ViewportDefinition, assertNoToolInitErrors: () => void }>}
 */
async function createPage(browser, theme, viewportName, textScale = 100) {
  const viewport = viewportPresets[viewportName]
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

  return { context, page, viewport, assertNoToolInitErrors }
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isToolInitError(text) {
  return text.includes('documentElement') || text.includes('classList')
}

/**
 * @param {Page} page
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
      throw new Error(`Probe tool init emitted errors: ${messages.join(' | ')}`)
    }
  }
}

/**
 * @param {Page} page
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
 * @param {Page} page
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
 * @param {Page} page
 * @returns {Promise<void>}
 */
async function injectReadingFixture(page) {
  await page.evaluate((fixtureHtml) => {
    const prose = document.querySelector('[data-article-body] .article-prose')
    if (!(prose instanceof HTMLElement)) {
      throw new Error('Missing article prose fixture target')
    }

    prose.innerHTML = fixtureHtml
  }, readingFixtureHtml)
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @param {ThemeName} theme
 * @param {ViewportName} viewportName
 * @param {string} pathname
 * @param {ProbeCallback} callback
 * @param {number} [textScale]
 * @returns {Promise<unknown>}
 */
async function withPage(
  browser,
  baseUrl,
  theme,
  viewportName,
  pathname,
  callback,
  textScale = 100
) {
  const { context, page, viewport, assertNoToolInitErrors } = await createPage(
    browser,
    theme,
    viewportName,
    textScale
  )

  try {
    const response = await page.goto(createUrl(baseUrl, pathname), { waitUntil: 'load' })
    const status = response?.status() || 0

    if (status >= 400 && !pathname.includes('__ui_probe_missing__')) {
      throw new Error(`${pathname} returned ${status}`)
    }

    await ensureStableTheme(page, theme)
    await applyTextScale(page, textScale)
    await page.evaluate(() => document.fonts?.ready.then(() => undefined))
    const result = await callback(page, viewport)
    assertNoToolInitErrors()
    return result
  } finally {
    await page.close()
    await context.close()
  }
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<unknown[]>}
 */
async function probeHeader(browser, baseUrl) {
  const scenarios = []

  for (const viewportName of /** @type {ViewportName[]} */ (['compact', 'mobile', 'desktop'])) {
    scenarios.push(
      await withPage(browser, baseUrl, 'dark', viewportName, '/zh/', async (page, viewport) => {
        const targets = {
          logo: simplifyBox(await elementBox(page, '[data-header-logo] a')),
          languageMobile: simplifyBox(
            await optionalElementBox(page, '[data-language-switcher-mobile]')
          ),
          languageDesktop: simplifyBox(
            await optionalElementBox(page, '[data-language-switcher-desktop]')
          ),
          theme: simplifyBox(await elementBox(page, 'header button[aria-label="切换暗色模式"]')),
          menu: simplifyBox(await optionalElementBox(page, 'header button[aria-label="打开导航"]')),
          rss: simplifyBox(await optionalElementBox(page, 'header a[href="/feed.xml"]')),
        }

        return {
          viewport: viewportName,
          width: viewport.width,
          document: await documentMetrics(page),
          header: simplifyBox(await elementBox(page, 'header')),
          controls: simplifyBox(await elementBox(page, '[data-header-controls]')),
          targets,
        }
      })
    )
  }

  return scenarios
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<Record<string, unknown>>}
 */
async function probeHomeDensity(browser, baseUrl) {
  return {
    compact: await withPage(browser, baseUrl, 'dark', 'compact', '/zh/', async (page, viewport) => {
      const cards = (await boxesForSelector(page, '[data-post-shell]')).map(simplifyBox)
      const firstCard = cards[0]
      const visibleCardTops = cards.filter((box) => box && box.y < viewport.height).length
      const fullyVisibleCards = cards.filter((box) => box && box.bottom <= viewport.height).length

      return {
        viewport: 'compact',
        document: await documentMetrics(page),
        firstCard,
        secondCard: cards[1] || null,
        visibleCardTops,
        fullyVisibleCards,
      }
    }),
    mobile: await withPage(browser, baseUrl, 'dark', 'mobile', '/zh/', async (page, viewport) => {
      const cards = (await boxesForSelector(page, '[data-post-shell]')).map(simplifyBox)
      const firstCard = cards[0]
      const visibleCardTops = cards.filter((box) => box && box.y < viewport.height).length
      const fullyVisibleCards = cards.filter((box) => box && box.bottom <= viewport.height).length

      return {
        viewport: 'mobile',
        document: await documentMetrics(page),
        firstCard,
        secondCard: cards[1] || null,
        visibleCardTops,
        fullyVisibleCards,
      }
    }),
    desktopWeight: await withPage(browser, baseUrl, 'dark', 'desktop', '/zh/', async (page) => ({
      document: await documentMetrics(page),
      mainCard: {
        box: simplifyBox(await elementBox(page, '[data-post-shell]')),
        styles: await stylesForSelector(page, '[data-post-shell]'),
      },
      profileCard: {
        box: simplifyBox(await elementBox(page, '[data-profile-card]')),
        styles: await stylesForSelector(page, '[data-profile-card]'),
      },
      widgetCard: {
        box: simplifyBox(await elementBox(page, '[data-blog-widget-card]')),
        styles: await stylesForSelector(page, '[data-blog-widget-card]'),
      },
    })),
  }
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<Record<string, unknown>>}
 */
async function probeTermChips(browser, baseUrl) {
  const result = /** @type {Record<string, unknown>} */ ({})

  for (const [key, pathname] of [
    ['categories', '/zh/categories/'],
    ['tags', '/zh/tags/'],
  ]) {
    result[key] = await withPage(browser, baseUrl, 'dark', 'mobile', pathname, async (page) => {
      const boxes = (await boxesForSelector(page, '[data-term-chip]')).map(simplifyBox)
      const heights = boxes.map((box) => box?.height || 0)

      return {
        document: await documentMetrics(page),
        count: boxes.length,
        minHeight: round(Math.min(...heights)),
        maxHeight: round(Math.max(...heights)),
        first: boxes[0],
      }
    })
  }

  return result
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<Record<string, unknown>>}
 */
async function probeSearch(browser, baseUrl) {
  const initial = await withPage(
    browser,
    baseUrl,
    'light',
    'compact',
    '/zh/search/',
    async (page) => ({
      document: await documentMetrics(page),
      heading: simplifyBox(await elementBox(page, '#search-page-heading')),
      inputShell: simplifyBox(await elementBox(page, '[role="search"] > div')),
      resultsRegion: simplifyBox(await elementBox(page, '[data-search-results]')),
      state: await page.locator('[data-search-results]').getAttribute('data-search-state'),
    })
  )

  const results = await withPage(
    browser,
    baseUrl,
    'light',
    'compact',
    '/zh/search/',
    async (page) => {
      await page.getByRole('searchbox').fill('小米')
      await page.locator('[data-search-result-card]').first().waitFor({ state: 'visible' })

      return {
        document: await documentMetrics(page),
        state: await page.locator('[data-search-results]').getAttribute('data-search-state'),
        firstResult: simplifyBox(await elementBox(page, '[data-search-result-card]')),
        resultCountText: await page.getByRole('status').textContent(),
      }
    }
  )

  const empty = await withPage(
    browser,
    baseUrl,
    'light',
    'compact',
    '/zh/search/',
    async (page) => {
      await page.getByRole('searchbox').fill('zzzxxyqnohit260804')
      await page.locator('[data-search-results][data-search-state="empty"]').waitFor()

      return {
        document: await documentMetrics(page),
        state: await page.locator('[data-search-results]').getAttribute('data-search-state'),
        statusText: await page.getByRole('status').textContent(),
      }
    }
  )

  const { context, page, assertNoToolInitErrors } = await createPage(browser, 'light', 'compact')
  await page.route('**/pagefind/pagefind.js', (route) => route.abort())

  try {
    await page.goto(createUrl(baseUrl, '/zh/search/'), { waitUntil: 'load' })
    await ensureStableTheme(page, 'light')
    await page.getByRole('searchbox').fill('小米')
    await page.locator('[data-search-results][data-search-state="error"]').waitFor()
    assertNoToolInitErrors()

    return {
      initial,
      results,
      empty,
      error: {
        document: await documentMetrics(page),
        state: await page.locator('[data-search-results]').getAttribute('data-search-state'),
        statusText: await page.getByRole('status').textContent(),
      },
    }
  } finally {
    await page.close()
    await context.close()
  }
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<Record<string, unknown>>}
 */
async function probeNotFound(browser, baseUrl) {
  const result = /** @type {Record<string, unknown>} */ ({})

  for (const locale of ['zh', 'en']) {
    const scenarios = /** @type {Record<string, unknown>} */ ({})

    for (const [name, theme, viewportName] of /** @type {[string, ThemeName, ViewportName][]} */ ([
      ['compact', locale === 'zh' ? 'dark' : 'light', 'compact'],
      ['mobileLight', 'light', 'mobile'],
      ['mobileDark', 'dark', 'mobile'],
    ])) {
      scenarios[name] = await withPage(
        browser,
        baseUrl,
        theme,
        viewportName,
        `/${locale}/__ui_probe_missing__/`,
        async (page, viewport) => {
          const content = simplifyBox(await elementBox(page, '[data-not-found-content]'))
          const code = simplifyBox(await elementBox(page, '[data-not-found-code]'))
          const homeLinkBox = simplifyBox(await elementBox(page, 'main a'))

          return {
            theme,
            viewport: viewportName,
            document: await documentMetrics(page),
            content,
            code,
            codeInFirstViewport: code ? code.y < viewport.height : false,
            homeLink: {
              box: homeLinkBox,
              href: await page.locator('main a').first().getAttribute('href'),
              inFirstViewport: homeLinkBox ? homeLinkBox.y < viewport.height : false,
            },
          }
        }
      )
    }

    result[locale] = scenarios
  }

  return result
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<unknown[]>}
 */
async function probeOverflowMatrix(browser, baseUrl) {
  const routes = [
    '/zh/',
    '/en/',
    '/zh/search/',
    '/zh/categories/',
    '/zh/tags/',
    '/zh/xiaomi-book-pro-14/',
  ]
  const viewports = /** @type {ViewportName[]} */ ([
    'compact',
    'mobile',
    'landscape',
    'reflow200',
    'tablet',
    'laptop',
    'w1280',
    'desktop',
    'w1728',
    'w1920',
  ])
  const rows = []

  for (const viewportName of viewports) {
    for (const route of routes) {
      rows.push(
        await withPage(browser, baseUrl, 'dark', viewportName, route, async (page) => ({
          viewport: viewportName,
          route,
          document: await documentMetrics(page),
        }))
      )
    }
  }

  return rows
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<unknown[]>}
 */
async function probeReadingArticleTop(browser, baseUrl) {
  const routes = [
    { language: 'zh', path: '/zh/xiaomi-book-pro-14/' },
    { language: 'en', path: '/en/xiaomi-book-pro-14/' },
  ]
  const viewports = /** @type {ViewportName[]} */ ([
    'compact',
    'mobile',
    'reflow200',
    'tablet',
    'laptop',
    'w1280',
    'w1440',
    'w1728',
    'w1920',
  ])
  const rows = []

  for (const route of routes) {
    for (const viewportName of viewports) {
      for (const theme of /** @type {ThemeName[]} */ (['light', 'dark'])) {
        rows.push(
          await withPage(
            browser,
            baseUrl,
            theme,
            viewportName,
            route.path,
            async (page, viewport) => ({
              route: route.path,
              language: route.language,
              theme,
              viewport,
              metrics: await articleTopMetrics(page),
              inlineCode: await inlineCodeMetrics(page),
            })
          )
        )
      }
    }
  }

  return rows
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<unknown[]>}
 */
async function probeReadingFixture(browser, baseUrl) {
  const viewports = /** @type {ViewportName[]} */ ([
    'compact',
    'reflow200',
    'tablet',
    'w1440',
    'w1920',
  ])
  const rows = []

  for (const viewportName of viewports) {
    for (const theme of /** @type {ThemeName[]} */ (['light', 'dark'])) {
      rows.push(
        await withPage(
          browser,
          baseUrl,
          theme,
          viewportName,
          '/zh/xiaomi-book-pro-14/',
          async (page, viewport) => {
            await injectReadingFixture(page)

            return {
              theme,
              viewport,
              document: await documentMetrics(page),
              coverage: await articleCoverage(page),
              inlineCode: await inlineCodeMetrics(page),
              linkedCode: await internalScrollMetrics(
                page,
                '[data-article-body] .article-prose a code'
              ),
              preCode: await internalScrollMetrics(
                page,
                '[data-article-body] .article-prose pre code'
              ),
              table: await internalScrollMetrics(page, '[data-article-body] .article-table-scroll'),
              longToken: await internalScrollMetrics(
                page,
                '[data-article-body] .article-prose p:last-child'
              ),
            }
          }
        )
      )
    }
  }

  return rows
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<Record<string, unknown>>}
 */
async function probeReadingCoverage(browser, baseUrl) {
  const result = /** @type {Record<string, unknown>} */ ({})

  for (const [key, route] of [
    ['zh', '/zh/xiaomi-book-pro-14/'],
    ['en', '/en/xiaomi-book-pro-14/'],
    ['rich', '/zh/making-memoh-cheaper-on-telegram/'],
    ['feature', '/zh/blog-git-metadata-and-icons/'],
  ]) {
    result[key] = await withPage(browser, baseUrl, 'dark', 'desktop', route, (page) =>
      articleCoverage(page)
    )
  }

  result.fixture = await withPage(
    browser,
    baseUrl,
    'dark',
    'desktop',
    '/zh/xiaomi-book-pro-14/',
    async (page) => {
      await injectReadingFixture(page)
      return articleCoverage(page)
    }
  )

  return result
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<unknown[]>}
 */
async function probeReadingRichContent(browser, baseUrl) {
  const scenarios = [
    {
      name: 'math',
      theme: 'light',
      viewportName: 'compact',
      selector: "mjx-container[jax='SVG'][display='true']",
    },
    {
      name: 'code',
      theme: 'dark',
      viewportName: 'compact',
      selector: 'figure[data-rehype-pretty-code-figure] [data-code-pre]',
    },
    {
      name: 'table',
      theme: 'dark',
      viewportName: 'compact',
      selector: '[data-article-body] .article-table-scroll',
    },
  ]
  const rows = []

  for (const scenario of scenarios) {
    rows.push(
      await withPage(
        browser,
        baseUrl,
        /** @type {ThemeName} */ (scenario.theme),
        /** @type {ViewportName} */ (scenario.viewportName),
        '/zh/making-memoh-cheaper-on-telegram/',
        async (page, viewport) => ({
          name: scenario.name,
          theme: scenario.theme,
          viewport,
          document: await documentMetrics(page),
          target: await internalScrollMetrics(page, scenario.selector),
        })
      )
    )
  }

  return rows
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<unknown[]>}
 */
async function probeReadingTextScale200(browser, baseUrl) {
  const routes = [
    '/zh/xiaomi-book-pro-14/',
    '/en/xiaomi-book-pro-14/',
    '/zh/making-memoh-cheaper-on-telegram/',
  ]
  const rows = []

  for (const route of routes) {
    rows.push(
      await withPage(
        browser,
        baseUrl,
        'dark',
        'reflow200',
        route,
        async (page, viewport) => {
          const rootFont = await page.evaluate(
            () => getComputedStyle(document.documentElement).fontSize
          )

          return {
            route,
            theme: 'dark',
            viewport,
            rootFont,
            document: await documentMetrics(page),
            articleTop: await articleTopMetrics(page),
            inlineCode: await inlineCodeMetrics(page),
            codePre: await internalScrollMetrics(
              page,
              'figure[data-rehype-pretty-code-figure] [data-code-pre]'
            ),
            math: await internalScrollMetrics(page, "mjx-container[jax='SVG'][display='true']"),
            table: await internalScrollMetrics(page, '[data-article-body] .article-table-scroll'),
          }
        },
        200
      )
    )
  }

  return rows
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<Record<string, unknown>>}
 */
async function probeReadingAlignment(browser, baseUrl) {
  const routes = [
    '/zh/xiaomi-book-pro-14/',
    '/en/xiaomi-book-pro-14/',
    '/zh/making-memoh-cheaper-on-telegram/',
    '/zh/kde-plasma-obsdian-web-clipper/',
    '/zh/blog-git-metadata-and-icons/',
  ]
  const viewports = /** @type {ViewportName[]} */ ([
    'compact',
    'mobile',
    'reflow200',
    'tablet',
    'laptop',
    'w1280',
    'w1440',
    'w1728',
    'w1920',
  ])
  const rows = []

  for (const route of routes) {
    for (const viewportName of viewports) {
      for (const theme of /** @type {ThemeName[]} */ (['light', 'dark'])) {
        rows.push(
          await withPage(browser, baseUrl, theme, viewportName, route, async (page, viewport) => ({
            route,
            fixture: false,
            theme,
            textScale: 100,
            viewport,
            metrics: await articleRailAlignmentMetrics(page),
          }))
        )
      }
    }
  }

  for (const viewportName of viewports) {
    for (const theme of /** @type {ThemeName[]} */ (['light', 'dark'])) {
      rows.push(
        await withPage(
          browser,
          baseUrl,
          theme,
          viewportName,
          '/zh/xiaomi-book-pro-14/',
          async (page, viewport) => {
            await injectReadingFixture(page)

            return {
              route: '/zh/xiaomi-book-pro-14/',
              fixture: true,
              theme,
              textScale: 100,
              viewport,
              metrics: await articleRailAlignmentMetrics(page),
            }
          }
        )
      )
    }
  }

  for (const route of [...routes, '__fixture__']) {
    for (const viewportName of /** @type {ViewportName[]} */ (['reflow200', 'w1440'])) {
      for (const theme of /** @type {ThemeName[]} */ (['light', 'dark'])) {
        rows.push(
          await withPage(
            browser,
            baseUrl,
            theme,
            viewportName,
            route === '__fixture__' ? '/zh/xiaomi-book-pro-14/' : route,
            async (page, viewport) => {
              const fixture = route === '__fixture__'

              if (fixture) {
                await injectReadingFixture(page)
              }

              return {
                route: fixture ? '/zh/xiaomi-book-pro-14/' : route,
                fixture,
                theme,
                textScale: 200,
                viewport,
                metrics: await articleRailAlignmentMetrics(page),
              }
            },
            200
          )
        )
      }
    }
  }

  const failures = rows.flatMap((row) =>
    alignmentFailures(/** @type {Record<string, unknown>} */ (row))
  )

  return {
    thresholds: {
      maxEdgeDeltaPx: 1,
      maxSurfaceCenterOffsetPx: 1,
      maxTextCenterOffsetPx: 1,
      wideTocWidthPx: [ARTICLE_TOC_WIDTH - 1, ARTICLE_TOC_WIDTH + 1],
      wideTocGapPx: [ARTICLE_TOC_GAP - 1, ARTICLE_TOC_GAP + 1],
      wideTocOpacity: 1,
      minTocTextContrast: 4.5,
      desktopTocStartsAtPx: ARTICLE_DESKTOP_TOC_BREAKPOINT,
    },
    rows,
    summary: {
      rowCount: rows.length,
      failureCount: failures.length,
      failures,
    },
  }
}

/**
 * @param {Browser} browser
 * @param {string} baseUrl
 * @returns {Promise<Record<string, unknown>>}
 */
async function probeReadingMax(browser, baseUrl) {
  return {
    articleTop: await probeReadingArticleTop(browser, baseUrl),
    coverage: await probeReadingCoverage(browser, baseUrl),
    fixture: await probeReadingFixture(browser, baseUrl),
    richContent: await probeReadingRichContent(browser, baseUrl),
    textScale200: await probeReadingTextScale200(browser, baseUrl),
  }
}

async function main() {
  const rawArgs = process.argv.slice(2)
  const baseUrl = normalizeBaseUrl(readArg(rawArgs, '--base-url') || defaultBaseUrl)
  const outputPath =
    readArg(rawArgs, '--out') || path.join(agentRecordsRoot, 'comprehensive-after-probe.json')
  const safeOutputPath = resolveAgentRecordsPath(outputPath)
  const browser = await chromium.launch()

  try {
    const data = {
      generatedAt: new Date().toISOString(),
      baseUrl,
      baselineNotes: {
        homeMobileFirstCardHeightBeforePx: 394,
        homeMobileFirstViewportBefore: 'about one card',
        searchInitialBefore: 'heading/input/empty space occupied excessive vertical space',
        termChipVisualHeightBeforePx: 55,
      },
      header: await probeHeader(browser, baseUrl),
      homeDensity: await probeHomeDensity(browser, baseUrl),
      termChips: await probeTermChips(browser, baseUrl),
      search: await probeSearch(browser, baseUrl),
      notFound: await probeNotFound(browser, baseUrl),
      overflowMatrix: await probeOverflowMatrix(browser, baseUrl),
      readingMax: await probeReadingMax(browser, baseUrl),
      readingAlignment: await probeReadingAlignment(browser, baseUrl),
    }

    await mkdir(path.dirname(safeOutputPath), { recursive: true })
    await writeFile(safeOutputPath, `${JSON.stringify(data, null, 2)}\n`)
    console.log(`Wrote ${safeOutputPath}`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
