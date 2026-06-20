export function absoluteSiteUrl(siteUrl: string, path = '') {
  const normalizedPath = path ? `/${path.replace(/^\/+/, '')}` : '/'
  const url = new URL(normalizedPath, siteUrl).toString()

  return url.endsWith('/') ? url : `${url}/`
}
