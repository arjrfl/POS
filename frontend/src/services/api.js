import { useAuthStore } from '../store/authStore'

const BASE_URL = '/api'

async function request(path, { method = 'GET', body, headers } = {}) {
  const token = useAuthStore.getState().token

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const envelope = await res.json().catch(() => null)

  // A 401 with no token attached is a login failure, not an expired session —
  // let it fall through to the normal error below instead of forcing a redirect.
  if (res.status === 401 && token) {
    useAuthStore.getState().logout()
    window.location.href = '/'
    throw new Error('Session expired')
  }

  if (!res.ok || envelope?.error) {
    throw new Error(envelope?.error || `Request failed with status ${res.status}`)
  }

  return envelope?.data
}

export const get = (path) => request(path)
export const post = (path, body) => request(path, { method: 'POST', body })
export const patch = (path, body) => request(path, { method: 'PATCH', body })
export const del = (path) => request(path, { method: 'DELETE' })
