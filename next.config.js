import { readFile } from 'node:fs/promises'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js'
import { getGitOutput } from './scripts/lib/git-exec.mjs'
import { parseRedirects, toNextRedirects } from './scripts/lib/redirects.mjs'

const gitFullCommitHash = process.env.VERCEL_GIT_COMMIT_SHA || getGitOutput(['rev-parse', 'HEAD'])
const gitShortCommitHash = gitFullCommitHash
  ? gitFullCommitHash.slice(0, 7)
  : getGitOutput(['rev-parse', '--short', 'HEAD'])

/**
 * @param {string} phase
 * @returns {Promise<import('next').NextConfig>}
 */
export default async function nextConfig(phase) {
  /** @type {import('next').NextConfig} */
  const config = {
    reactStrictMode: true,
    trailingSlash: true,
    pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
    env: {
      NEXT_PUBLIC_GIT_COMMIT_HASH: gitShortCommitHash,
      NEXT_PUBLIC_GIT_COMMIT_FULL_HASH: gitFullCommitHash,
    },
    images: {
      unoptimized: true,
    },
    webpack: (webpackConfig, { isServer }) => {
      // In dev the client compiler sets splitChunks to false — only the
      // production client build has cache groups to extend.
      const splitChunks = webpackConfig.optimization.splitChunks

      if (!isServer && splitChunks && typeof splitChunks === 'object' && splitChunks.cacheGroups) {
        // Keep echarts/zrender in a single named chunk so the async-only chart
        // bundle is easy to identify in size reports and budgets. Note: do not
        // re-introduce a webpackChunkName: "echarts" magic comment on the
        // dynamic import — the name collision silently disables this split.
        splitChunks.cacheGroups.echarts = {
          test: /[\\/]node_modules[\\/](echarts|zrender)[\\/]/,
          name: 'echarts',
          chunks: 'all',
          // Must outrank Next's built-in `lib` cache group (priority 30).
          priority: 50,
          enforce: true,
          reuseExistingChunk: true,
        }
      }

      return webpackConfig
    },
  }

  if (phase === PHASE_DEVELOPMENT_SERVER) {
    config.skipTrailingSlashRedirect = true
    config.redirects = async () => {
      const redirects = await readFile(new URL('./public/_redirects', import.meta.url), 'utf8')
      return toNextRedirects(parseRedirects(redirects))
    }

    const { withContentlayer } = await import('next-contentlayer2')
    return withContentlayer(config)
  }

  config.output = 'export'
  return config
}
