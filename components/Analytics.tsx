import DeferredUmami from '@/components/DeferredUmami'

type UmamiConfig = {
  websiteId?: string
  src?: string
}

type AnalyticsConfig = {
  umami?: UmamiConfig
}

export default function Analytics({ config }: { config?: AnalyticsConfig }) {
  const umami = config?.umami

  if (process.env.NODE_ENV !== 'production' || !umami?.websiteId) {
    return null
  }

  return (
    <DeferredUmami
      src={umami.src || 'https://analytics.umami.is/script.js'}
      websiteId={umami.websiteId}
    />
  )
}
