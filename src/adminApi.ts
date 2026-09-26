// Organizer session and API helpers. The session token lives in localStorage so an organizer's phone stays
// signed in between visits (the server expires it after 14 days, or on sign out).
const tokenKey = 'pbb-admin-token'

export type AdminUser = { id: string; username: string; name: string; role: 'owner' | 'organizer'; disabled: boolean; createdAt: string; lastLoginAt: string | null }

export function readToken() {
  try { return window.localStorage.getItem(tokenKey) || '' } catch { return '' }
}

export function storeToken(token: string) {
  try {
    if (token) window.localStorage.setItem(tokenKey, token)
    else window.localStorage.removeItem(tokenKey)
  } catch { /* storage unavailable: the session lasts for this page only */ }
}

export function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function api<T>(path: string, options: RequestInit = {}, token = ''): Promise<T> {
  let response: Response
  try { response = await fetch(`/api${path}`, { ...options, cache: 'no-cache', headers: { 'Content-Type': 'application/json', ...authHeaders(token), ...options.headers } }) }
  catch { throw new Error('Cannot reach the tournament server. Check the Wi-Fi connection and try again.') }
  const data = await response.json().catch(() => null)
  if (!data) throw new Error('The tournament server is not responding. Make sure it is running, then try again.')
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed.'), { status: response.status })
  return data as T
}

/** Downloads an organizer-only file (CSV or backup) with the session token. */
export async function download(path: string, token: string, fallbackName: string) {
  const response = await fetch(`/api${path}`, { headers: authHeaders(token) }).catch(() => null)
  if (!response) throw new Error('Cannot reach the tournament server.')
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Download failed.')
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') || '')?.[1] || fallbackName
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url; link.download = name
  document.body.append(link); link.click(); link.remove()
  URL.revokeObjectURL(url)
}
