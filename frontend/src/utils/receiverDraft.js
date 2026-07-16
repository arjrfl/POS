// Draft persistence for the Receiver "New Transaction" modal. Scoped per
// logged-in username since terminals are shared browsers but usernames differ.
const DRAFT_KEY_PREFIX = 'receiver_draft_transaction_'

function draftKey(username) {
  return `${DRAFT_KEY_PREFIX}${username}`
}

export function loadReceiverDraft(username) {
  if (!username) return null
  try {
    const raw = localStorage.getItem(draftKey(username))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveReceiverDraft(username, draft) {
  if (!username) return
  try {
    localStorage.setItem(draftKey(username), JSON.stringify(draft))
  } catch {
    // localStorage can throw if full/disabled — fail silently, never block the UI.
  }
}

export function clearReceiverDraft(username) {
  if (!username) return
  try {
    localStorage.removeItem(draftKey(username))
  } catch {
    // ignore
  }
}
