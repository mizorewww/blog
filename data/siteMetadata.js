const siteMetadata = {
  title: 'mizorewww',
  author: 'mizorewww',
  headerTitle: 'mizorewww',
  description: 'mizorewww 的个人博客',
  language: 'zh-CN',
  theme: 'dark', // system, dark or light
  siteUrl: 'https://mizore.blog',
  siteRepo: 'https://github.com/mizorewww/blog',
  socialBanner: '/static/images/twitter-card.png',
  email: 'www@mizore.blog',
  github: 'https://github.com/mizorewww',
  x: 'https://x.com/mizorewww',
  telegram: 'https://t.me/aac6fef',
  locale: 'en-US',
  analytics: {
    umami: {
      websiteId: process.env.NEXT_UMAMI_ID,
    },
  },
}

module.exports = siteMetadata
