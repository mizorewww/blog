type PostBodyData = {
  bodyCode?: unknown
}

const bodyCodeCache = new Map<string, string>()
const pendingBodyCodeRequests = new Map<string, Promise<string | null>>()

function encodePostPath(postPath: string) {
  return postPath.split('/').map(encodeURIComponent).join('/')
}

export function getPostBodyDataUrl(postPath: string) {
  return `/_post-data/${encodePostPath(postPath)}.json`
}

export function getPreloadedPostBody(postPath: string) {
  return bodyCodeCache.get(postPath) || null
}

export async function preloadPostBody(postPath: string) {
  const cachedBodyCode = getPreloadedPostBody(postPath)

  if (cachedBodyCode) {
    return cachedBodyCode
  }

  const pendingRequest = pendingBodyCodeRequests.get(postPath)

  if (pendingRequest) {
    return pendingRequest
  }

  const request = fetch(getPostBodyDataUrl(postPath), {
    credentials: 'same-origin',
  })
    .then(async (response) => {
      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as PostBodyData

      if (typeof data.bodyCode !== 'string') {
        return null
      }

      bodyCodeCache.set(postPath, data.bodyCode)
      return data.bodyCode
    })
    .catch(() => null)
    .finally(() => {
      pendingBodyCodeRequests.delete(postPath)
    })

  pendingBodyCodeRequests.set(postPath, request)

  return request
}
