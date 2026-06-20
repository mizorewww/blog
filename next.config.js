const { withContentlayer } = require('next-contentlayer2')

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
    images: {
      unoptimized: true,
    },
  })
}
