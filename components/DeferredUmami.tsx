'use client'

import { useEffect } from 'react'

export default function DeferredUmami({ src, websiteId }: { src: string; websiteId: string }) {
  useEffect(() => {
    const prerenderingDocument = document as Document & { prerendering?: boolean }

    const loadScript = () => {
      if (document.querySelector('script[data-umami-loader="true"]')) {
        return
      }

      const script = document.createElement('script')
      script.async = true
      script.defer = true
      script.src = src
      script.dataset.umamiLoader = 'true'
      script.dataset.websiteId = websiteId
      document.head.appendChild(script)
    }

    if (prerenderingDocument.prerendering) {
      document.addEventListener('prerenderingchange', loadScript, { once: true })
      return () => document.removeEventListener('prerenderingchange', loadScript)
    }

    loadScript()
  }, [src, websiteId])

  return null
}
