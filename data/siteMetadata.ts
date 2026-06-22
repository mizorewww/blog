export type SiteMetadata = {
  title: string
  author: string
  headerTitle: string
  description: string
  language: string
  theme: 'system' | 'dark' | 'light'
  siteUrl: string
  siteRepo: string
  socialBanner: string
  email: string
  github: string
  x: string
  telegram: string
  locale: string
  analytics: {
    umami: {
      websiteId?: string
    }
  }
}

const siteMetadata: SiteMetadata = {
  title: 'mizorewww',
  author: 'mizorewww',
  headerTitle: 'mizorewww',
  description: '喵喵喵？',
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

export default siteMetadata
