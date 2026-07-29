export function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'just now'
  if (diffMin === 1) return '1 min ago'
  if (diffMin < 60) return `${diffMin} mins ago`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr === 1) return '1 hour ago'
  if (diffHr < 24) return `${diffHr} hours ago`

  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
}

// Abbreviated form ("2m ago", "1h ago") for compact table rows — a separate
// function so the existing card-style screens (Releasing, Admin) keep their
// current wording untouched.
export function timeAgoShort(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`

  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

// Parked-card staleness: flat 3-hour threshold, not configurable.
export const PARKED_STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000

export function isParkedStale(parked_at, now = Date.now()) {
  if (!parked_at) return false
  return now - new Date(parked_at).getTime() >= PARKED_STALE_THRESHOLD_MS
}

// "3h 24m" elapsed form for the stale-parked badge — distinct from
// timeAgo/timeAgoShort's "Xh ago" wording since this shows raw duration.
export function formatElapsedDuration(dateString, now = Date.now()) {
  const diffMs = now - new Date(dateString).getTime()
  const diffMin = Math.max(0, Math.floor(diffMs / 60000))
  const hours = Math.floor(diffMin / 60)
  const mins = diffMin % 60
  return `${hours}h ${mins}m`
}

// "YYYY-MM-DD HH:MM:SS", 24-hour, local time — the Order Slip receipt's DATE
// field, deliberately distinct from timeAgo/timeAgoShort's relative wording.
export function formatReceiptDate(dateString) {
  const d = new Date(dateString)
  const pad = (n) => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return `${date} ${time}`
}
