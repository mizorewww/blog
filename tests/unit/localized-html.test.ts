import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizeExportedHtmlLanguages,
  setHtmlLanguage,
} from '../../scripts/lib/localized-html.mjs'

describe('localized exported HTML', () => {
  it('replaces the existing document language without changing other HTML attributes', () => {
    expect(setHtmlLanguage('<html class="dark" lang="zh-CN"><body></body></html>', 'en-US')).toBe(
      '<html class="dark" lang="en-US"><body></body></html>'
    )
  })

  it('rejects exported documents without a language attribute', () => {
    expect(() => setHtmlLanguage('<html><body></body></html>', 'en-US')).toThrow(
      'Exported HTML document is missing a lang attribute'
    )
  })

  it('normalizes every localized document from the shared locale configuration', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'mizore-localized-html-'))
    const zhPath = path.join(outDir, 'zh', 'index.html')
    const enPath = path.join(outDir, 'en', 'post', 'index.html')

    try {
      await mkdir(path.dirname(zhPath), { recursive: true })
      await mkdir(path.dirname(enPath), { recursive: true })
      await writeFile(zhPath, '<html lang="zh-CN"><body>zh</body></html>')
      await writeFile(enPath, '<html lang="zh-CN"><body>en</body></html>')

      await normalizeExportedHtmlLanguages(outDir)

      expect(await readFile(zhPath, 'utf8')).toContain('<html lang="zh-CN">')
      expect(await readFile(enPath, 'utf8')).toContain('<html lang="en-US">')
    } finally {
      await rm(outDir, { recursive: true, force: true })
    }
  })
})
