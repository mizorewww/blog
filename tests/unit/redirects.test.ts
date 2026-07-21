import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants.js'
import nextConfig from '../../next.config.js'
import {
  parseRedirects,
  toCaddyRedirectDirectives,
  toNextRedirects,
} from '../../scripts/lib/redirects.mjs'
import { writeCaddyfile } from '../../scripts/preview-static/caddy.mjs'

describe('redirect helpers', () => {
  it('uses shared redirects only in development and preserves production export', async () => {
    const developmentConfig = await nextConfig(PHASE_DEVELOPMENT_SERVER)
    const productionConfig = await nextConfig(PHASE_PRODUCTION_BUILD)

    expect(developmentConfig.output).toBeUndefined()
    expect(developmentConfig.skipTrailingSlashRedirect).toBe(true)
    expect(await developmentConfig.redirects?.()).toContainEqual({
      source: '/blog/:splat*',
      destination: '/zh/:splat*',
      statusCode: 301,
    })
    expect(productionConfig.output).toBe('export')
    expect(productionConfig.redirects).toBeUndefined()
  })

  it('parses comments, blank lines, explicit statuses, and the default status', () => {
    const redirects = parseRedirects(`
# Legacy routes
/ /zh/ 301

/search /zh/search/
`)

    expect(redirects).toEqual([
      { source: '/', destination: '/zh/', statusCode: 301 },
      { source: '/search', destination: '/zh/search/', statusCode: 302 },
    ])
  })

  it('adapts literal and wildcard rules for Next redirects', () => {
    const redirects = parseRedirects(`
/ /zh/ 301
/blog/* /zh/:splat 301
`)

    expect(toNextRedirects(redirects)).toEqual([
      { source: '/', destination: '/zh/', statusCode: 301 },
      { source: '/blog/:splat*/', destination: '/zh/:splat*/', statusCode: 301 },
      { source: '/blog/:splat*', destination: '/zh/:splat*', statusCode: 301 },
    ])
  })

  it('adapts the same rules for Caddy redirects', () => {
    const redirects = parseRedirects(`
/ /zh/ 301
/blog/* /zh/:splat 301
`)

    expect(toCaddyRedirectDirectives(redirects)).toEqual([
      '\tredir / /zh/ 301',
      '\t@redirect_1 path_regexp redirect_1 ^/blog/(.*)$',
      '\troute @redirect_1 {',
      '\t\turi strip_prefix /blog',
      '\t\theader >Location "%2F" "/"',
      '\t\tredir * /zh{%path} 301',
      '\t}',
    ])
  })

  it('serves exported route directories without adding a trailing slash', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'mizore-caddy-'))
    const outDir = path.join(projectRoot, 'out')
    const toolsDir = path.join(projectRoot, 'tools')

    try {
      await mkdir(outDir)
      await mkdir(toolsDir)
      await writeFile(path.join(outDir, '_redirects'), '/blog/* /zh/:splat 301\n')

      const caddyfilePath = await writeCaddyfile({ port: '3012', projectRoot, toolsDir })
      const caddyfile = await readFile(caddyfilePath, 'utf8')

      expect(caddyfile).toContain('\t\tredir * /zh{%path} 301')
      expect(caddyfile).toContain('\tfile_server {\n\t\tdisable_canonical_uris\n\t}')
    } finally {
      await rm(projectRoot, { recursive: true, force: true })
    }
  })
})
