# Integration Test Results — All 7 Transaction Flows

Run on 2026-07-07 against a disposable Postgres 16 instance loaded from
`database/schema.sql` and seeded via `python -m app.core.seed` (the seed data
from Prompt 13: 4 role users, 5 customers with mixed `net_balance`, 8
products). Exercised through the FastAPI app in-process (`TestClient`, both
REST and WebSocket), asserting on responses, `GET /api/customers/{id}`
(`net_balance` + `customer_ledger`), and `transaction_audit_log` (queried
directly via `psql`, since no endpoint exposes it yet).

Test script: [`test_integration_flows.py`](test_integration_flows.py) — not a
pytest suite (`httpx`/`pytest` aren't project dependencies), a standalone
script with inline `assert`s. Prerequisites and run instructions are in its
docstring. **113 checks run, 113 passed, 0 failed.**

**Update:** the Flow 7 gap originally found in this document (see git history
for the prior version) has been fixed. `confirm_items_ready` /
`POST /{id}/confirm-ready` was added as Releasing's dedicated first touch for
online orders, `resolve_substandard` now refuses to run on an online
transaction still at `pending_settlement` (400, redirecting to
`/confirm-ready`), and `process_payment` was verified (no change needed) to
already resolve online `pending_payment` orders straight to `completed`.
Flow 7 was re-run in full below along with the rest of the suite as an
implicit regression check for Flows 1–6, none of which were touched.

The live `docker compose` stack (already running locally) was **not** used
for this pass: its `nginx.conf` is an empty file (0 bytes — proxies nothing)
and its `backend` container image predates the transaction endpoints built in
this project so far. Neither was touched, per "no new code" — this test run
used an isolated Postgres container instead.

---

## Flow 1 — Standard walk-in transaction (exact weight)

Walk-In creates → Payment grabs + pays → Releasing grabs + confirms exact
weight → completed.

| Step | transaction_status | queue_status | WebSocket broadcast |
|---|---|---|---|
| Create (Jose Ramirez, 1.000kg chicken @ 220.00) | `pending_payment` | `waiting` | `transaction_status_changed` → `payment-queue` (+admin) |
| Payment grabs | `pending_payment` | `processing` | `queue_status_changed` → `payment-queue` (+admin) |
| Payment pays 220.00 cash exact | `pending_settlement` | `waiting` | `transaction_status_changed` → `releasing-queue` (+admin) |
| Releasing grabs | `pending_settlement` | `processing` | `queue_status_changed` → `releasing-queue` (+admin) |
| Releasing confirms 1.000kg actual | `pending_settlement` (unchanged) | `processing` (unchanged) | none — `confirm_weight` never touches status |
| Releasing resolves (`balance_due` = 0.00) | `completed` | `done` | `transaction_status_changed` → **admin only** |

- `balance_due` correctly auto-computed to `0.00` by the DB generated column.
- `customer.net_balance` untouched (-75.50 → -75.50) — correct, exact-match flows never touch the ledger.
- `transaction_audit_log`: 7 entries, one per status transition above (creation, grab×2, pay's dual transaction_status+queue_status pair, resolve's dual pair) — full trail, no gaps.
- All 22 checks for this flow **PASSED**.

---

## Flow 2 — Substandard walk-in, more, customer pays now

Walk-In creates → Payment pays → Releasing confirms heavier weight (1.500kg
vs 1.000kg estimated) → resolve `pay_now` → child `adjustment` pushed to
Payment → Payment pays child → completed.

Customer: Ana Garcia (`net_balance` = 0.00, no credit — forces the `pay_now`
branch instead of auto-cover).

| Step | Parent status | Parent queue | Child | WebSocket |
|---|---|---|---|---|
| Confirm weight: 1.500kg → `actual_amount` 330.00 | `pending_settlement` | `processing` | — | — |
| `balance_due` = +110.00 (customer owes more) | | | | |
| Resolve `pay_now` | **`settled`** | **`done`** | created: `adjustment`, parent_id=parent, `pending_payment`/`waiting`, `total_due`=110.00 | `transaction_status_changed` → **payment-queue** (+admin), for the **child's** id |
| Payment grabs + pays child 110.00 | (parent stays `settled`) | | `completed` / `done` — **skips Releasing entirely** | |

- `customer.net_balance` untouched throughout (0.00 → 0.00) — correct: money for `pay_now` moves via the child's own `payment_detail` row, not the ledger.
- `get_transaction_chain` on the parent correctly returns `{parent: settled, child: completed}`.
- Parent `transaction_audit_log`: 7 entries (same shape as Flow 1, but final pair is `pending_settlement→settled` / `processing→done`).
- Child `transaction_audit_log`: 4 entries (creation, grab, pay's dual pair) — no releasing-grab entry, confirming the child correctly bypassed Releasing.
- All 16 checks for this flow **PASSED**.

---

## Flow 3 — Substandard walk-in, more, customer saves as utang

Same setup as Flow 2 but 1.400kg actual (vs 1.000kg estimated) →
`balance_due` = +88.00, resolved with `outcome: "utang"` instead.

Customer: Ana Garcia again — her `net_balance` was untouched by Flow 2, so
she still starts this flow at 0.00 (no credit), correctly forcing the
`utang` branch to actually apply.

| Check | Result |
|---|---|
| `balance_due` | 88.00 |
| Resolve → `transaction_status` | `settled` |
| Resolve → `queue_status` | `done` |
| Child created? | No |
| Broadcast | `transaction_status_changed` → **admin only** (`settled` isn't a queue-owning status) |
| `customer.net_balance` | 0.00 → **-88.00** |
| `customer_ledger` entry | `entry_type=balance_added`, `amount=88.00`, `running_balance=-88.00` |
| `transaction_audit_log` | 7 entries, full trail |

All 12 checks **PASSED**.

---

## Flow 4 — Substandard walk-in, less, save as credit

Walk-In creates (2.000kg estimated) → Payment pays 440.00 → Releasing
confirms 1.000kg actual (`actual_amount` 220.00) → `balance_due` = -220.00 →
resolve `save_credit`.

Customer: Juan Dela Cruz (`net_balance` = 0.00, **no existing utang** — this
matters, see Flow 3's/the earlier design discussion: a customer *with*
existing utang would instead auto-net, skipping the outcome decision
entirely. Juan has none, so the `save_credit` outcome is actually exercised).

| Check | Result |
|---|---|
| `balance_due` | -220.00 |
| Resolve → `transaction_status` | `settled` |
| Resolve → `queue_status` | `done` |
| Child created? | No |
| Broadcast | admin only |
| `customer.net_balance` | 0.00 → **220.00** |
| `customer_ledger` entry | `entry_type=credit_added`, `amount=220.00`, `running_balance=220.00` |
| `transaction_audit_log` | 7 entries, full trail |

All 13 checks **PASSED**.

---

## Flow 5 — Walk-in transaction with existing balance settled at Walk-In

Walk-In creates a transaction with **both** a product line item (1.000kg
chicken, 220.00) **and** a `balance_settlement` item (150.00) in the same
request → Payment pays the *combined* total → Releasing confirms exact
weight → completed.

Customer: Maria Santos, starting at `net_balance` = -150.00 (full utang).

| Check | Result |
|---|---|
| `estimated_amount` (product only) | 220.00 |
| `total_due` (220.00 + 150.00 balance_settled) | **370.00** |
| `customer.net_balance` updated **at creation**, before any payment | -150.00 → **0.00** |
| `customer_ledger` entry (at creation) | `entry_type=balance_settled`, `amount=150.00` |
| Payment collects the full combined 370.00 | 200 OK |
| Releasing confirms exact weight → `balance_due` | 0.00 |
| Resolve → final status | `completed` / `done` |
| `net_balance` after payment/releasing | unchanged at 0.00 (balance/credit only ever moves at Walk-In, never at Payment — confirmed) |
| `transaction_audit_log` | 7 entries, full trail |

All 14 checks **PASSED**. Confirms CLAUDE.md's rule: *"Balance/credit line
items are added at Walk-In phase only — never at Payment."*

---

## Flow 6 — Balance settlement only (no new order)

Walk-In creates a transaction with **only** a `balance_settlement` item (no
product items at all) → Payment pays → completed directly, **Releasing is
skipped entirely**.

Customer: Jose Ramirez, starting at `net_balance` = -75.50 (settling in
full).

| Check | Result |
|---|---|
| `estimated_amount` (no product items) | 0.00 |
| `total_due` | 75.50 |
| `transaction_status` at creation | `pending_payment` (still the normal walk_in phase order) |
| `customer.net_balance` at creation | -75.50 → **0.00** |
| Payment pays 75.50 | 200 OK |
| `transaction_status` after payment | **`completed`** directly — confirmed **not** `pending_settlement` |
| `queue_status` after payment | `done` |
| Broadcast | `transaction_status_changed` → **admin only**; a parallel `releasing-queue` connection was round-tripped with ping/pong to prove nothing landed there |
| `transaction_audit_log` | 4 entries (creation, grab, pay's dual pair) — **no** releasing-grab entry, confirming Releasing was never touched |

All 13 checks **PASSED**. This exercises the `skip_releasing` logic in the
`POST /{id}/pay` router (item-type detection) added for exactly this case.

---

## Flow 7 — Online customer flow

**Result: gap fixed, flow now fully closes end-to-end.** The previous run of
this document found that Releasing had no way to move an online transaction
from `pending_settlement` to `pending_payment` (see PROJECT_CONTEXT.md
section 3's Online Flow table: *"2 | Releasing | Confirms items available,
prepares for shipment | pending_settlement → pending_payment"*) — only
weight-confirmation (`confirm_weight`/`resolve_substandard`) existed, which
resolves straight to `completed`/`settled` and was never meant to apply to
online orders' first Releasing touch at all.

**Fix:** added `confirm_items_ready` / `POST /{id}/confirm-ready` as
Releasing's dedicated online-only action — sets `actual_amount =
estimated_amount` (no weight variance for per-unit/box online orders per
PROJECT_CONTEXT.md's note), transitions `pending_settlement → pending_payment`
/ `waiting`, and broadcasts to `payment-queue`. `resolve_substandard` now
guards against being called on an online transaction still at
`pending_settlement`, returning 400 with a message pointing at
`/confirm-ready` instead. `process_payment` needed **no changes** — its
existing `customer_type == walk_in` branch check already correctly falls
through to the `completed`/`done` branch for any non-walk-in transaction,
which now includes online orders once they reach `pending_payment` via
`confirm-ready`.

Walk-In creates (`customer_type=online`) → Releasing grabs → Releasing
`confirm-ready` → Payment grabs → Payment pays with online ref number →
completed.

| Step | transaction_status | queue_status | WebSocket broadcast |
|---|---|---|---|
| Create (online, Pedro Reyes, 1.000kg chicken) | `pending_settlement` | `waiting` | `transaction_status_changed` → **releasing-queue** (+admin) |
| Releasing grabs | `pending_settlement` | `processing` | `queue_status_changed` → releasing-queue (+admin) |
| Releasing `POST /confirm-ready` | **`pending_payment`** | **`waiting`** | `transaction_status_changed` → **payment-queue** (+admin) |
| Payment grabs | `pending_payment` | `processing` | `queue_status_changed` → payment-queue (+admin) |
| Payment `POST /pay` (GCash, ref `GC-ONLINE-0007`, no cash) | **`completed`** | **`done`** | `transaction_status_changed` → **admin only** |

Additional checks:

- `actual_amount == estimated_amount == 220.00` after `confirm-ready` — confirms the "no weight variance" rule.
- `releasing_user_id` / `releasing_at` recorded by `confirm-ready`; `processing_by_user_id` correctly cleared.
- `cash_tendered` / `change_given` both `0.00` — a fully-online payment leaves no cash trail.
- `payment_detail` row recorded with `ref_number="GC-ONLINE-0007"` and the GCash `payment_method_id` — the online ref number is now actually persisted, which it never was before this fix.
- `customer.net_balance` untouched by a clean online sale (no credit/balance involved).
- Calling `confirm-ready` a second time on the same transaction → **409** (`transaction_status` is no longer `pending_settlement`).
- Calling `resolve` on a *different* online transaction still sitting at `pending_settlement` → **400**, `"Use /confirm-ready for online orders at this stage"` — confirms the new guard fires without needing `confirm_weight` to have been called first.
- `transaction_audit_log`: 7 entries — creation, grab(releasing), `confirm-ready`'s dual transaction_status/queue_status pair, grab(payment), `pay`'s dual pair. Full trail across **both** the Releasing and Payment touches, closing the gap the previous run flagged (that run only ever produced 4 entries, since Payment was never actually reached).

All 28 checks for this flow **PASSED**.

---

## Summary

| Flow | Outcome |
|---|---|
| 1 — Standard walk-in, exact weight | ✅ PASS (22/22 checks) |
| 2 — Substandard, overage, pay_now | ✅ PASS (16/16 checks) |
| 3 — Substandard, overage, utang | ✅ PASS (12/12 checks) |
| 4 — Substandard, shortage, save_credit | ✅ PASS (13/13 checks) |
| 5 — Balance settled at Walk-In + new order | ✅ PASS (14/14 checks) |
| 6 — Balance settlement only | ✅ PASS (13/13 checks) |
| 7 — Online customer flow | ✅ PASS (28/28 checks) — gap fixed |

**113/113 assertions passed.** All `transaction_status`/`queue_status`
transitions, `customer.net_balance` updates, `customer_ledger` entries,
WebSocket room targeting, and `transaction_audit_log` trails matched
expectations for all 7 flows. Flow 1–6 were re-run unchanged as a regression
check alongside the Flow 7 fix — nothing in the walk-in flow logic was
touched, and nothing regressed.
