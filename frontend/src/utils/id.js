// crypto.randomUUID() is only defined in secure contexts (HTTPS, or localhost).
// This app runs over plain HTTP on a LAN (e.g. http://192.168.1.xxx), which
// browsers don't treat as secure, so it falls back to a non-cryptographic id.
export const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10)
}
