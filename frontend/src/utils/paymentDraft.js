// Draft persistence for the Payment "Process Payment" / "Confirm Payment" modals.
// Scoped per logged-in username AND per transaction — Payment team members work
// one transaction at a time, and the active transaction is already locked via
// queue_status = 'processing'. This is purely a reload-safety net for the
// in-progress, not-yet-parked case; the DB-backed payment_detail draft
// (is_draft, draft_balances_json, draft_credit_applied, 2-minute autosave,
// park/unpark) remains the source of truth and is untouched by this.
const DRAFT_KEY_PREFIX = 'payment_draft_'

function draftKey(username, transactionId) {
  return `${DRAFT_KEY_PREFIX}${username}_${transactionId}`
}

export function loadPaymentDraft(username, transactionId) {
  if (!username || !transactionId) return null
  try {
    const raw = localStorage.getItem(draftKey(username, transactionId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function savePaymentDraft(username, transactionId, draft) {
  if (!username || !transactionId) return
  try {
    localStorage.setItem(draftKey(username, transactionId), JSON.stringify(draft))
  } catch {
    // localStorage can throw if full/disabled — fail silently, never block the UI.
  }
}

export function clearPaymentDraft(username, transactionId) {
  if (!username || !transactionId) return
  try {
    localStorage.removeItem(draftKey(username, transactionId))
  } catch {
    // ignore
  }
}
