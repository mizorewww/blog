import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { localeConfig, locales } from '../../lib/i18n.ts'

/**
 * @param {string} html - exported HTML document
 * @param {string} htmlLang - locale-specific HTML language
 * @returns {string}
 */
export function setHtmlLanguage(html, htmlLang) {
  const openingHtmlPattern = /<html\b([^>]*)\blang=(['"])[^'"]*\2([^>]*)>/i

  if (!openingHtmlPattern.test(html)) {
    throw new Error('Exported HTML document is missing a lang attribute')
  }

  return html.replace(openingHtmlPattern, `<html$1lang=$2${htmlLang}$2$3>`)
}

/**
 * @param {string} directory - directory to scan recursively
 * @returns {Promise<string[]>}
 */
async function findHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)

      if (entry.isDirectory()) {
        return findHtmlFiles(entryPath)
      }

      return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : []
    })
  )

  return files.flat()
}

/**
 * @param {string} outDir - Next static export directory
 * @returns {Promise<void>}
 */
export async function normalizeExportedHtmlLanguages(outDir) {
  for (const locale of locales) {
    const htmlLang = localeConfig[locale].htmlLang
    const files = await findHtmlFiles(path.join(outDir, locale))

    await Promise.all(
      files.map(async (file) => {
        const html = await readFile(file, 'utf8')
        await writeFile(file, setHtmlLanguage(html, htmlLang))
      })
    )
  }
}
