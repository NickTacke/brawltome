export type AccountLinks = {
  signIn: string
  verifySteam: string
}

function readApiOrigin(publicApiUrl: string | undefined): string {
  const failure = 'account links: PUBLIC_API_URL must be the http origin of the public api'

  if (!publicApiUrl) throw new Error(failure)

  let url: URL

  try {
    url = new URL(publicApiUrl)
  } catch {
    throw new Error(failure)
  }

  const isHttp = url.protocol === 'http:' || url.protocol === 'https:'
  const hasExtras = url.username || url.password || url.pathname !== '/' || url.search || url.hash

  if (!isHttp || hasExtras) throw new Error(failure)

  return url.origin
}

/**
 * Sign-in and steam verification run on the api, which sets the cookies, so these are plain links the browser
 * follows to it, the same routes the old site used.
 */
export function accountLinks(publicApiUrl: string | undefined): AccountLinks {
  const apiOrigin = readApiOrigin(publicApiUrl)

  return {
    signIn: `${apiOrigin}/auth/discord/login`,
    verifySteam: `${apiOrigin}/auth/steam/link`,
  }
}
