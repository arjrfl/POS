import { useAuthStore } from '../store/authStore'

const BASE_URL = '/api'

// Endpoints whose own 401 is a business-rule rejection, not an expired/invalid
// token — see the request() 401 handling below.
const REAUTH_401_PATHS = /\/transactions\/\d+\/void$/

async function request(path, { method = 'GET', body, headers } = {}) {
  const token = useAuthStore.getState().token

  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // fetch() itself only throws on network failure (offline, wrong host,
    // server unreachable) — give that a message worth showing a user instead
    // of the browser's raw "Failed to fetch".
    throw new Error('Network error — check your connection')
  }

  // Sliding session: a still-valid token gets silently reissued on every
  // authenticated request (see backend's refresh_token_middleware). Swap it
  // in without any user-visible action so an active terminal never expires.
  const refreshedToken = res.headers.get('X-Refreshed-Token')
  if (refreshedToken) {
    useAuthStore.getState().setToken(refreshedToken)
  }

  const envelope = await res.json().catch(() => null)

  // A 401 with no token attached is a login failure, not an expired session —
  // let it fall through to the normal error below instead of forcing a redirect.
  // Same for the void endpoint's re-authentication check: that 401 means
  // "wrong password", not "your session/token is invalid" — forcing a global
  // logout there would kick the admin out of their own session instead of
  // just rejecting the void attempt (see VoidTransactionModal).
  if (res.status === 401 && token && !REAUTH_401_PATHS.test(path)) {
    useAuthStore.getState().logout()
    window.location.href = '/'
    throw new Error('Session expired')
  }

  if (!res.ok || envelope?.error) {
    const error = new Error(envelope?.error || `Request failed with status ${res.status}`)
    error.status = res.status
    throw error
  }

  return envelope?.data
}

export const get = (path) => request(path)
export const post = (path, body) => request(path, { method: 'POST', body })
export const put = (path, body) => request(path, { method: 'PUT', body })
export const patch = (path, body) => request(path, { method: 'PATCH', body })
export const del = (path) => request(path, { method: 'DELETE' })

// For endpoints that return a raw file (e.g. CSV export) instead of the
// {data, error} envelope — errors still come back envelope-shaped (see
// http_exception_handler), only the success path differs.
export async function getFile(path) {
  const token = useAuthStore.getState().token

  let res
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    throw new Error('Network error — check your connection')
  }

  const refreshedToken = res.headers.get('X-Refreshed-Token')
  if (refreshedToken) {
    useAuthStore.getState().setToken(refreshedToken)
  }

  if (res.status === 401 && token) {
    useAuthStore.getState().logout()
    window.location.href = '/'
    throw new Error('Session expired')
  }

  if (!res.ok) {
    const envelope = await res.json().catch(() => null)
    const error = new Error(envelope?.error || `Request failed with status ${res.status}`)
    error.status = res.status
    throw error
  }

  const disposition = res.headers.get('Content-Disposition') || ''
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/)

  return { blob: await res.blob(), filename: filenameMatch ? filenameMatch[1] : null }
}
