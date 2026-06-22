import { execFileSync } from 'node:child_process'
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants.js'

function getGitOutput(args) {
  try {
    return execFileSync('git', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const gitFullCommitHash = process.env.VERCEL_GIT_COMMIT_SHA || getGitOutput(['rev-parse', 'HEAD'])
const gitShortCommitHash = gitFullCommitHash
  ? gitFullCommitHash.slice(0, 7)
  : getGitOutput(['rev-parse', '--short', 'HEAD'])

/**
 * @type {import('next').NextConfig}
 **/
export default async function nextConfig(phase) {
  const config = {
    output: 'export',
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
  }

  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const { withContentlayer } = await import('next-contentlayer2')
    return withContentlayer(config)
  }

  return config
}
