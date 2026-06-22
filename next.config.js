const { withContentlayer } = require('next-contentlayer2')
const { execFileSync } = require('node:child_process')

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
module.exports = () => {
  const plugins = [withContentlayer]
  return plugins.reduce((acc, next) => next(acc), {
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
  })
}
