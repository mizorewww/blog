export function getSameDocumentFragmentId(href: string, currentHref: string) {
  try {
    const currentUrl = new URL(currentHref)
    const targetUrl = new URL(href, currentUrl)

    if (
      targetUrl.origin !== currentUrl.origin ||
      targetUrl.pathname !== currentUrl.pathname ||
      targetUrl.search !== currentUrl.search ||
      targetUrl.hash.length <= 1
    ) {
      return null
    }

    return decodeURIComponent(targetUrl.hash.slice(1)) || null
  } catch {
    return null
  }
}
