export function absoluteSiteUrl(siteUrl: string, path = '') {
  const normalizedPath = path ? `/${path.replace(/^\/+/, '')}` : '/'
  const url = new URL(normalizedPath, siteUrl).toString()

  return url.endsWith('/') ? url : `${url}/`
}

export function decodeRouteParam(value: string) {
  let decoded = value

  for (let index = 0; index < 3; index += 1) {
    try {
      const nextDecoded = decodeURIComponent(decoded)

      if (nextDecoded === decoded) {
        return decoded
      }

      decoded = nextDecoded
    } catch {
      return decoded
    }
  }

  return decoded
}
