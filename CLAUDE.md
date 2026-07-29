# CLAUDE.md — Lash Meatshop POS

## Read These First — Always

Before writing any code in this project, read both files completely:

- `PROJECT_CONTEXT.md` — full business logic, all transaction flows, team roles,
  substandard kilo scenarios, balance/credit system, online vs walk-in flows,
  architecture, confirmed stack, and build order
- `database/schema.sql` — the PostgreSQL schema. This is the source of truth for
  all data models. Never invent column names, table names, or enum values —
  always reference this file

---

## What This Project Is

An offline LAN-based POS system for a meat shop. 27 browser terminals on a LAN,
all pointing to one server PC running Docker (nginx + FastAPI + PostgreSQL).
No internet at runtime. No cloud. No external services.

---

## Current Build Status

- Backend: fully built and tested (all 7 flows passing)
- Frontend: Receiver, Payment, Releasing screens built and refined
- Admin screen: Dashboard, Customers, Products, Transaction History, and Users
  tabs all built and wired into the TabBar. A `QueueMonitorSection` component
  exists in `frontend/src/components/admin/` but is not wired into
  `Admin.jsx`/`TabBar` — not reachable from the UI yet.
- Product CRUD is available in both Releasing (Inventory tab) and Admin
  (Products tab). Both are fully functional and share the same underlying
  components (`frontend/src/components/inventory/`); changes made in either
  screen broadcast live to both.
- Batch 5 (production readiness): NOT YET DONE
- All 27 client terminals must use Google Chrome (fixed version, auto-update disabled)

---

## Team Roles

| Role | DB value | What they do |
|---|---|---|
| `receiver` | `receiver` | Creates transactions, inputs orders. Previously called "walk_in" — renamed. |
| `payment` | `payment` | Processes payment (cash/online/split), can park transactions, handles balance/credit decisions |
| `releasing` | `releasing` | Confirms actual item weight, sends variance to Payment — NO financial decisions |
| `admin` | `admin` | Full visibility — queues, reports, audit log, customer ledger |

`role_id` on `"user"` is set once at account creation (`POST /api/users`) and
is immutable afterward — `PATCH /api/users/{id}` only accepts `full_name` and
`username`, never `role_id`. There is no role-promotion/demotion feature. To
change a user's role, an admin deactivates the old account and creates a new
one with the correct role. This is an intentional simplicity tradeoff, not an
oversight.

---

## Confirmed Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12 + FastAPI + asyncpg + SQLAlchemy + Alembic |
| Frontend | React + Vite + TailwindCSS + PWA |
| State | React Query (server state) + Zustand (client state) |
| Real-time | Native WebSocket — FastAPI built-in + browser WebSocket API |
| Database | PostgreSQL 16 |
| Proxy | Nginx |
| Containers | Docker Compose: nginx, backend, postgres, backup |
| Charting (Dashboard only) | recharts |

recharts is approved specifically for Admin Dashboard charts (Top Products
pie chart). Do not use it for any other UI, and do not add a second
charting library.

Do not introduce Redis, Socket.io, Celery, GraphQL, Next.js, or any other
dependency not listed above without explicit instruction.

---

## Brand Theme

Chrome-only color tokens, defined in `tailwind.config.js` under
`theme.extend.colors.brand`:

| Token | Hex |
|---|---|
| `brand-black` | `#0A0A0A` |
| `brand-charcoal` | `#1C1C1C` |
| `brand-gold` | `#D4AF37` |
| `brand-gold-light` | `#E5C766` |
| `brand-gold-dark` | `#B8952C` |
| `brand-white` | `#FFFFFF` |
| `brand-cream` | `#FAF9F4` |

These tokens style **chrome only**: Navbar, primary/secondary buttons, modal
headers (`Modal`/`FullScreenModal`), the Admin TabBar, Queue/Order Details
panel borders, focus rings, checkboxes, and plain text links. They do NOT
apply to functional status colors, which remain gray/blue/yellow/green/amber/
purple/red as documented elsewhere in this file (Number Formatting section
notwithstanding — see Frontend Rules for card/badge status colors).

Explicitly excluded from the brand palette — leave these exactly as-is:
- Item Edit Modal (Releasing) variance row colors: green (exact), amber
  (heavier), blue (lighter)
- Queue card processing (`bg-blue-50`) / parked (`bg-yellow-50`) styling,
  and the "Unpark" amber action button
- Stale-parked queue card styling (Payment + Releasing queues): a parked
  card whose `parked_at` is 3+ hours old switches to
  `bg-red-50 border-l-4 border-l-red-500` (takes precedence over the
  normal yellow parked styling) and shows a "Parked Xh Ym" duration badge.
  Flat 3-hour threshold, not configurable. Passive visual-only — no toast,
  WebSocket push, or Admin Dashboard change
- `pending_adjustment` "Awaiting Payment" purple pill (Releasing queue)
- `pending_handover`/`settled` queue-card entry buttons in Releasing
  (indigo "Confirm Handover", green "Review & Confirm") — tied to their
  card's status color, not general chrome
- Admin Customers tab "Balance & Credit" red/green amount coloring
- Toast success (green) / error (red) colors
- Substandard ADJUSTMENT/REFUND badges in Payment UI

---

## Critical Business Rules

### Transactions — Never Mutate, Always Extend
- A completed or settled transaction is immutable
- Substandard kilo outcomes always generate a **child transaction** linked via
  `parent_transaction_id` — never edit the original
- transaction types: `original`, `adjustment`, `refund`, `balance_settlement`
  (`credit_usage` was removed from `transaction_type_enum` — it was never
  produced by any code path; credit application happens via the
  `sales_transaction.credit_applied` field, not a typed transaction row.
  Note: `transaction_item.item_type` still has a separate, still-valid
  `credit_usage` value — unaffected by this change.)

### Two Customer Flows — Different Pipeline Order
- `walk_in`: Receiver → Payment → Releasing
- `online`: Receiver → Releasing (confirm-ready) → Payment (pay) → Releasing (complete-online,
  `pending_handover` status) — a real second Releasing touch, not just an auto-complete
- `customer_type` on `sales_transaction` determines which flow applies

### Queue = Status Filter, Not a Message Broker
- Payment queue: `transaction_status = 'pending_payment'`
- Releasing queue: `transaction_status IN ('pending_settlement', 'pending_adjustment', 'settled', 'pending_handover')`
  — `settled` and `pending_handover` cards are read-only/awaiting-handover, not grabbable
- Payment/Releasing queues are NOT additionally filtered by `queue_status = 'waiting'` at the API
  level — processing/parked transactions still come back in the list (rendered with the
  processing/parked card styling) so teammates can see who's working on what; only the Receiver
  queue enforces `queue_status = 'waiting'` server-side
- No RabbitMQ, no Redis — just PostgreSQL status column + WebSocket broadcast

### Queue Locking
- When a team member grabs: `queue_status → 'processing'`, `processing_by_user_id` set
- When parked: `queue_status → 'parked'`, `processing_by_user_id → NULL`
- On WebSocket disconnect: auto-release any transactions the user was processing back to 'waiting'
- Grab is race-safe: `_get_transaction_for_update()` (`transaction_service.py:545`) uses
  `SELECT ... FOR UPDATE` to row-lock the transaction before `grab_transaction()`
  (`transaction_service.py:609`) checks `queue_status`, so two concurrent grabs on the
  same transaction can't both succeed. The losing request gets a `QueueConflictError`
  → HTTP 409 (`transactions.py:160`), and the frontend shows a toast without marking
  the transaction as open on that terminal

### WebSocket Must Broadcast on Two Events
1. `transaction_status` change → broadcast to **next team's** room
2. `queue_status` change → broadcast to **current team's** room

### WebSocket Rooms
- `payment-queue` → payment role only
- `releasing-queue` → releasing role only
- `admin` → admin role only

### Customer Balance/Credit — Role Separation
- `customer.net_balance`: positive = credit, negative = balance/utang
- Balance/credit decisions happen at PAYMENT phase only — NOT at Releasing
- Releasing only confirms physical weights and sends variances to Payment
- Payment team handles: collecting balance, applying credit, partial payments

### Balance Settlement Rules
- Balance settlement only transaction: Receiver → Payment → completed (skips Releasing)
- Balance settlement transactions CANNOT be partially paid — must be full payment
- Collecting balance during a transaction CANNOT be partially paid
- Applying credit does NOT block partial payment (credit just reduces the target)
- Per-transaction balance checkboxes: each balance_added ledger entry shown separately
  so customer can choose WHICH specific transaction balance to settle

### Partial Payment Rules
- Allowed for: `original` and `adjustment` transaction types ONLY
- Blocked when: `transaction_type = 'balance_settlement'`
- Blocked when: any balance checkbox is checked (balances_to_settle > 0)
- Allowed when: credit is applied (credit just reduces target, partial of reduced amount is fine)
- Remaining amount after partial → saved as new balance_added in customer_ledger
- Partial payment transactions still go to Releasing (items still need to be released)

### Substandard Kilo — Releasing Role
- Releasing confirms actual weights per item (per-item edit modal, not bulk form)
- After all items confirmed, if variance exists:
  → ONLY action: "Send to Payment for Adjustment"
  → Generates child transaction (adjustment or refund)
  → Parent → `pending_adjustment` status
  → Child → Payment queue
- Releasing does NOT offer: save as balance, save as credit, auto-deduct credit
- Those decisions belong to Payment team

### Online Pre-Payment Item Correction — Releasing Role
- Distinct from Substandard Kilo above: this happens BEFORE payment,
  on `online` transactions only, at Releasing's first touch
  (`pending_settlement`, before Confirm Items Ready is clicked)
- Purpose: correct the Receiver's estimated order (customer changed
  their mind via out-of-system communication) before the order is
  priced and sent to Payment — not a weight-variance resolution, so
  it never generates an adjustment/refund child transaction
- Update-only: no add, no delete, no revert/snapshot mechanism
  (unlike Payment's Edit Items, which has all of those)
- UI: per-row pencil icon on the online items table (same visual
  slot as substandard's pencil), opening a single-item modal with
  current values (read-only) beside new values (editable) —
  Est. Weight, Unit Count, QTY. Unit Price is never editable.
- Confirm Items Ready is disabled until every product item on the
  transaction has had its edit modal opened and Saved at least once
  (even with no value changes) — a small checkmark/dot next to the
  pencil marks an item as checked
- "Checked" state is tracked in frontend component state only, NOT
  persisted to the database. It resets whenever the transaction is
  released/parked and re-grabbed — consistent with the existing
  rule that a WebSocket disconnect auto-releases an in-progress
  transaction back to `waiting`
- Audit logging: this endpoint (like Payment's Edit Items) writes a
  `transaction_item_audit_log` row (`edit_source = 'releasing_item_correction'`)
  on every successful edit — see Database Rules above

### End-of-Day Auto-Void
- Scheduled nightly job only — no manual trigger endpoint. Runs from a plain
  asyncio background task started at FastAPI startup (`app/services/
  scheduler_service.py`), no new scheduling dependency (no APScheduler/Celery)
- Time is configurable via `END_OF_DAY_VOID_HOUR`/`END_OF_DAY_VOID_MINUTE` env
  vars (default 23:59, server-local time)
- Eligibility is narrow — **not** "all incomplete transactions." Only:
  `transaction_status = 'pending_payment' AND customer_type = 'walk_in'`, OR
  `transaction_status = 'pending_settlement'` (either customer_type) —
  **AND `queue_status = 'waiting'` in both cases.** The status/customer_type
  pair is the only guarantee that `product.stock_quantity` hasn't been
  touched yet; `queue_status = 'waiting'` on top of that guarantees no team
  member currently has the transaction grabbed (`processing`) or set aside
  (`parked`) — either of those means someone is actively working it, so it
  must never be auto-voided out from under them even if its status/
  customer_type otherwise match. Every other incomplete status (online's own
  `pending_payment`, `pending_adjustment`, `settled`, `pending_handover`) has
  already moved stock and is explicitly out of scope
- Any nonzero `credit_applied`/`balance_settled` on a voided transaction is
  reversed via new compensating `customer_ledger` rows (append-only —
  existing rows are never edited/deleted) so the customer's `net_balance`
  ends up exactly as if the transaction never existed
- Sets `transaction_status = 'voided'`, resets queue lock fields, writes a
  `transaction_void_log` row and a `transaction_audit_log` row, and
  broadcasts the status change like any other transition
- Attributed to a seeded `system_auto_void` account (see Seed Users below),
  never a real admin login
- Each transaction is voided in its own try/except so one bad row can't
  block the rest of the nightly batch
- Implementation: `run_end_of_day_auto_void` in `transaction_service.py`
- `run_end_of_day_auto_void(db, dry_run=True)` reports what WOULD be voided
  (same eligibility query, no writes, no broadcasts) — one dict per
  candidate transaction. **Mandatory testing rule for this function
  specifically:** never call it with `dry_run=False` against a shared/live
  database without calling `dry_run=True` first and confirming every id in
  the returned list is recognized/expected (e.g. your own test data). This
  function scans the *entire* table, not just rows you created — an
  unscoped real call against shared data will void whatever else happens to
  be eligible at that moment. If the dry-run list contains anything
  unrecognized, stop and investigate instead of proceeding

### Substandard Kilo — Payment Resolution
- `adjustment` children (customer owes more): normal payment flow (cash/online/split), same as any transaction
- `refund` children (store owes customer): resolved via a single **[ Save as Credit ]**
  button only — no cash/online payment fields shown, no `payment_detail` row created
  - `POST /api/transactions/{id}/resolve-as-credit` adds the amount to
    `customer.net_balance` and logs a `credit_added` `customer_ledger` entry
  - The old code path that lets a `refund` transaction flow through the normal
    `/pay` endpoint is still in the codebase (see comment above that route) but
    is intentionally not surfaced in the UI — may be re-enabled later
  - **Refund children are credit-only, not cash (locked rule):**
    `refund`-type transactions never produce a `payment_detail` row under
    the current UI — resolved via `/resolve-as-credit` only, which just
    adds `total_due` to `customer.net_balance` as a `credit_added` ledger
    entry. No cash changes hands. Any cash/sales aggregate (e.g. Total
    Sales Today on the Admin Dashboard) must exclude
    `transaction_type = 'refund'` rows entirely — do not add, subtract,
    or otherwise fold them into a revenue figure. If the dormant
    cash-payout `/pay` path for refunds is ever reactivated, this
    exclusion rule must be revisited.
- After Payment resolves child → parent → `settled` (stays in Releasing's queue,
  read-only, as a "Payment Resolved" card) → Releasing confirms handover
  (`POST /{id}/confirm-handover`, this is where stock actually leaves) → `completed`
  → disappears from Releasing queue

### Payment Draft Entries
- Payment entries are saved as drafts (`is_draft = TRUE` in `payment_detail`)
- Drafts persist through park/unpark cycles
- Balance checkbox state saved in `draft_balances_json` on first draft row
- On unpark: entries AND balance checkbox state are restored
- Auto-save drafts every 2 minutes (not 30 seconds)

### Number Formatting
- All currency values use comma separators: ₱3,000.00 not ₱3000.00
- Use `formatCurrency` utility from `src/utils/format.js` everywhere

### HTTP Compatibility
- Never use `crypto.randomUUID()` — use `generateId()` from `src/utils/id.js`
  (crypto.randomUUID fails on HTTP/LAN, only works on HTTPS)
- All API calls use relative URLs (`/api/`) never hardcoded `localhost`
- WebSocket uses `ws://${window.location.hostname}/ws/${room}?token=${token}`

---

## Frontend Deploy Notes
- `frontend/dist` is bind-mounted into nginx — `npm run build` alone is
  enough for frontend-only changes. No docker restart needed.
- `nginx.conf` changes DO need: docker compose exec nginx nginx -s reload
- App is a Workbox PWA (autoUpdate). After any deploy, the FIRST browser
  reload on a given terminal may still show the old build — this is
  expected SW lifecycle behavior, not a broken deploy. A second reload
  always has the update.
- Cache-Control policy (already applied in nginx.conf):
  - /assets/* (hashed): long-cache, immutable
  - sw.js, workbox-*.js, registerSW.js, manifest.webmanifest, index.html: no-cache
- Never assume a UI prompt "worked" from Claude Code's own summary —
  always confirm against http://localhost (real nginx), and expect the
  one-extra-reload SW quirk before flagging something as still broken.

---

## Database Rules

- All enum values are defined as PostgreSQL `ENUM` types in `schema.sql`
- All timestamps are `TIMESTAMPTZ` — always timezone-aware
- `updated_at` is maintained by `set_updated_at()` trigger — never set manually
- `"user"` is a PostgreSQL reserved word — always double-quote it in queries
- `balance_due` on `sales_transaction` is a generated column — never write to it
- Indexes are defined in `schema.sql` — do not add duplicates
- Always return the full transaction chain (parent + all children) when returning a transaction
- `payment_detail.is_draft` = TRUE for draft entries, FALSE for confirmed entries
- `payment_detail.draft_balance_settled`, `draft_credit_applied`, `draft_balances_json`
  are only meaningful on is_draft=TRUE rows
- `customer.created_by_user_id` — which user created the customer record
  (set at insert from the "Add Customer" flow); NULL for rows created
  before this column existed (no backfill)
- `product_audit_log` only records manual product-management actions
  (create/update/adjust-stock/activate/deactivate from the Inventory/Products
  UI) — a transaction fulfilling normally (Releasing confirm-weight,
  complete-exact, confirm-handover, online confirm-ready) decrements
  `product.stock_quantity` directly and does NOT write an audit log row;
  that's routine inventory movement, not a product-management event
- `transaction_item_audit_log` (`item_edit_source_enum`: `payment_item_edit` |
  `releasing_item_correction`) records item-content edits from Payment's Edit
  Items (`PATCH /{id}/items`) and Releasing's online pre-payment item
  correction (`PATCH /{id}/releasing-items`) — one row per successful PATCH
  call, `old_value`/`new_value` as index-aligned JSON arrays covering only the
  items touched in that call, each entry tagged with an `action`
  (`added`/`updated`/`deleted`/`restored` for Payment; always `updated` for
  Releasing). Completely separate from `transaction_audit_log`/
  `audit_change_type_enum` above, which only tracks `transaction_status`/
  `queue_status` phase moves — the two audit systems never share rows,
  columns, or enum values. No UI currently reads this table.

---

## API Rules

- All endpoints under `/api/`
- WebSocket connections under `/ws/`
- Never return raw database errors or stack traces to the frontend
- All responses use consistent envelope:
  ```json
  { "data": ..., "error": null }
  { "data": null, "error": "message" }
  ```
- Auth via JWT — role embedded in token, enforced at every endpoint
- Full endpoint list, grouped by router file (`backend/app/routers/`):

  **Transactions** (`transactions.py`, prefix `/api/transactions`)
  - `POST /` — create (receiver)
  - `GET /` — list/queue (role-filtered — see Queue = Status Filter above)
  - `GET /history` — completed + voided transactions
  - `GET /{id}` — get one (full parent+child chain)
  - `GET /{id}/chain` — just the parent+child chain
  - `POST /{id}/grab` — lock transaction (payment, releasing, receiver)
  - `POST /{id}/park` — park transaction (payment, releasing)
  - `POST /{id}/unpark` — unpark transaction (payment, releasing)
  - `POST /{id}/release` — release a grabbed transaction back to waiting (payment, releasing, receiver)
  - `PUT /{id}/payment-drafts` — save draft payment entries (payment)
  - `PATCH /{id}/items` — edit items during Payment phase, walk_in +
    original transactions only, must be grabbed by requester (payment).
    Also triggers a one-time capture of `original_items_snapshot` the first
    time this is confirmed for a transaction (never overwritten afterward).
    Writes one `transaction_item_audit_log` row per call
    (`edit_source = 'payment_item_edit'`) — see Database Rules above
  - `POST /{id}/revert-items` — restore items to Receiver's original list,
    walk_in + original transactions only, must be grabbed by requester
    (payment). Requires an existing snapshot (i.e. at least one prior Edit
    Items confirm this Payment-phase visit)
  - `POST /{id}/pay` — process payment (payment); still fully supports `refund`-type
    transactions server-side, but Payment's UI no longer opens the payment modal
    for those — see `/resolve-as-credit`
  - `POST /{id}/confirm-weight` — confirm actual weights, walk_in (releasing)
  - `POST /{id}/confirm-ready` — mark online order items ready, no weight variance (releasing)
  - `POST /{id}/resolve` — resolve substandard variance, outcome: "send_to_payment" only (releasing)
  - `PATCH /{id}/releasing-items` — update-only item correction during
    Releasing's FIRST touch on an online transaction, before
    Confirm Items Ready. Scope: `customer_type = 'online'`,
    `transaction_type = 'original'`, `transaction_status =
    'pending_settlement'`, must be grabbed by the requester
    (releasing). No add/delete — only existing `transaction_item`
    rows' `quantity_kg`/`unit_count`/`estimated_weight_kg` may change.
    Only item_ids present in the request body are updated; unlisted
    items are left untouched. `estimated_amount`/`total_due` recompute
    from ALL items on the transaction afterward, per the locked
    `total_due` formula. `actual_amount` and all `actual_*` columns
    stay NULL — this is not the substandard/variance flow. Writes one
    `transaction_item_audit_log` row per call
    (`edit_source = 'releasing_item_correction'`) — see Database Rules above
  - `POST /{id}/complete-exact` — auto-complete when confirmed weight is exact, `balance_due = 0` (releasing)
  - `GET /{id}/handover-outcome` — how a `settled` transaction's adjustment/refund
    child was resolved, for display before handover (releasing)
  - `POST /{id}/confirm-handover` — final handover confirmation for a `settled`
    transaction (substandard adjustment/refund flow) → `completed` (releasing)
  - `POST /{id}/complete-online` — final handover confirmation for a `pending_handover`
    transaction (plain online flow, no variance) → `completed` (releasing)
  - `POST /{id}/resolve-as-credit` — resolve a `refund`-type child as customer
    credit (payment only, `pending_payment` only, no payment method involved)

  **Products** (`products.py`, prefix `/api/products`)
  - `GET /` — list (active-only unless caller is releasing/admin)
  - `GET /{id}` — get one
  - `GET /{id}/history` — product_audit_log entries (releasing, admin)
  - `POST /` — create (releasing, admin)
  - `PATCH /{id}` — update (releasing, admin)
  - `POST /{id}/adjust-stock` — manual stock adjustment, logged (releasing, admin)
  - `POST /{id}/toggle-status` — activate/deactivate, logged (releasing, admin)
  - `DELETE /{id}` — hard delete (releasing, admin); 409 if the product has
    any `transaction_item` rows (`transaction_item.product_id` is
    `ON DELETE RESTRICT`) — deactivate via toggle-status instead in that case.
    `product_audit_log` rows for the product cascade-delete. Broadcasts
    `product_changed` with change_type `"deleted"` to releasing-queue + admin

  **Customers** (`customers.py`, prefix `/api/customers`)
  - `GET /` — list (search by name, active only)
  - `GET /{id}` — get one, with ledger entries + totals (Admin Customers tab)
  - `GET /{id}/ledger?category=balance|credit` — outstanding balance/credit
    ledger entries for a customer (Admin Customers tab)
  - `GET /{id}/balance-entries` — outstanding balance entries (payment only)
  - `GET /{id}/credit-entries` — outstanding credit entries (payment only)
  - `POST /` — create (admin, receiver)
  - `PATCH /{id}` — update (admin, receiver)
  - `DELETE /{id}` — soft-delete, sets `customer_status = inactive` (admin, receiver)

  **Payment Methods** (`payment_methods.py`, prefix `/api/payment-methods`)
  - `GET /` — list

  **Admin** (`admin.py`, prefix `/api/admin`)
  - `GET /dashboard/top-products` — top 10 products by revenue for the
    current month (admin only)

  **Auth** (`auth.py`, prefix `/api/auth`)
  - `POST /login`

  Notes:
  - `GET /api/transactions?customer_id={id}&include_payment_status=true` —
    a customer's transaction history with derived `payment_status`
    (full/partial/voided); same list endpoint as the Transaction History
    tab, not a separate `/customers/{id}/transactions` route
  - WebSocket connections are under `/ws/{room}` — see `ws.py`, not a REST router

---

## Session Management

- Sliding JWT session: `refresh_token_middleware` in `backend/app/main.py`
  reissues a fresh token (`X-Refreshed-Token` response header) on every
  authenticated HTTP request with a still-valid token, so an actively-used
  terminal is never logged out mid-transaction. An idle terminal's token
  expires normally after `ACCESS_TOKEN_EXPIRE_MINUTES`.
- Every authenticated REST request also re-verifies `is_active` against the
  DB in real time (not just at login) — a deactivated account is rejected
  on its very next request regardless of remaining token lifetime. This
  runs in the same middleware, before the route handler executes, so a
  deactivated account can't complete an action and get a refreshed token in
  the same request — it's rejected outright with 401 and the message
  "Your account has been deactivated. Please contact an administrator."
  `is_active` is never trusted from the JWT itself — the token doesn't
  carry it at all (claims are just `user_id`, `username`, `role_name`).
- WebSocket connections opened before deactivation are NOT proactively
  closed — they may continue receiving broadcasts until the client's next
  REST call or reconnect. This is an accepted limitation (WS delivers
  read-only UI updates; all state-changing actions still go through REST,
  where the check is enforced), not a bug to fix here.
- Frontend: any 401 response (`frontend/src/services/api.js`) clears the
  auth store and redirects to `/` — the same handling for an expired token
  and a deactivated account, deliberately no special-cased message.

---

## Frontend Rules

- Role-based routing — each team sees only their screen on login
- Receiver screen (`/walkin`): create modal only — no queue (Return-to-Receiver flow removed)
- Payment screen (`/payment`): queue of `pending_payment`, payment modal with drafts
- Releasing screen (`/releasing`): queue of `pending_settlement` + `pending_adjustment`
  + `settled` + `pending_handover` (see Queue = Status Filter above), plus an Inventory
  tab for product CRUD — shared components with Admin's Products tab
  - Online transactions at `pending_settlement` (pre-Confirm-Items-
    Ready) show a per-row pencil icon for item correction (update-only,
    no add/delete) with a before/after value comparison in the modal.
    Confirm Items Ready is disabled until every item has been checked
    at least once (see Online Pre-Payment Item Correction rule above).
- Admin screen (`/admin`): TabBar navigation — Dashboard, Customers, Products,
  Transaction History, and Users tabs all built and wired into the TabBar.
  `QueueMonitorSection.jsx` exists under `components/admin/` but is not wired
  into the TabBar/page.
  - Dashboard tab: summary cards (Transactions Today, Total Sales Today,
    Pending in Payment, Pending in Releasing) + `TopProductsChart`
  - Customers tab: searchable list (Name/Contact/Net Balance/Status,
    sticky header, scoped scroll, Search-button triggered) + "View Details"
    modal with 3 sections:
    - Customer Details (50%): Name, Contact, Address, Status pill,
      Total Balance, Total Credit, Date Listed, Listed By
    - Balance & Credit (50%): tab toggle, Order #/Date/Amount, shows only
      outstanding/unused items, tab-colored (red/green)
    - Transaction History (full width): Order #/Type/Date/Total/Status/
      Action — Status is derived `payment_status` (full/partial/voided),
      Action is an inert "View" button (reserved for future)
  - Products tab: shares the same components as Releasing's Inventory tab
    (`frontend/src/components/inventory/`) — add/edit, adjust stock,
    activate/deactivate, and per-product audit history tagged with the
    acting user's role ("Releasing" or "Admin"). Not admin-only — both
    screens read/write the same rows and stay in sync via the
    `product_changed` WebSocket broadcast
- No page scroll on any screen — panels scroll internally only
- All screens: 60% left (queue) / 40% right (order details) split
- Queue panels: `bg-gray-100 border border-brand-black/20 rounded-lg`
  (chrome border color — see Brand Theme above)
- Queue cards: compact two-line cards, NOT table layout
- "Queue" label above left panel, "Order Details" label above right panel
- PWA service worker handles LAN reconnect — rehydrate queue on reconnect
- TailwindCSS only — no external UI component libraries
- Error boundary wraps all role pages — shows "Something went wrong + Reload" not blank white
- All ₱ values use `formatCurrency` from `src/utils/format.js`
- All IDs use `generateId()` from `src/utils/id.js` (never `crypto.randomUUID`)

---

## Seed Users (password: "password123" for all)

| Username | Role |
|---|---|
| receiver_user | receiver |
| receiver_user2 | receiver |
| receiver_user3 | receiver |
| payment_user | payment |
| payment_user2 | payment |
| payment_user3 | payment |
| releasing_user | releasing |
| releasing_user2 | releasing |
| releasing_user3 | releasing |
| admin_user | admin |
| system_auto_void | admin (system-only — `is_active = FALSE`, cannot log in; exists only for end-of-day auto-void attribution; never delete or reactivate) |

---

## Project Structure

```
lash-meatshop-pos/
├── CLAUDE.md
├── PROJECT_CONTEXT.md
├── docker-compose.yml
├── nginx.conf
├── database/
│   └── schema.sql
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic/
│   ├── app/
│   │   ├── main.py
│   │   ├── routers/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   └── websocket/
│   └── tests/
└── frontend/
    ├── src/
    │   ├── assets/meatshop-logo.png
    │   ├── pages/
    │   │   ├── Login.jsx
    │   │   ├── WalkIn.jsx     ← Receiver screen
    │   │   ├── Payment.jsx
    │   │   ├── Releasing.jsx
    │   │   └── Admin.jsx      ← Admin screen (Dashboard/Customers/Products/Transaction History)
    │   ├── components/
    │   │   ├── admin/         ← DashboardSection, TopProductsChart, CustomersSection,
    │   │   │                     CustomerDetailPanel, ProductsSection, TransactionsSection,
    │   │   │                     TransactionChainDetails, TabBar, QueueMonitorSection (unwired)
    │   │   ├── inventory/     ← AdjustStockModal, ChangeHistoryModal, InventoryView
    │   │   │                     (shared by Releasing's Inventory tab and Admin's Products tab)
    │   │   ├── layout/        ← Navbar, PageLayout
    │   │   ├── payment/       ← QueuePanel, QueueTransactionRow, PaymentModal,
    │   │   │                     PaymentConfirmationModal, TransactionDetailPanel,
    │   │   │                     TransactionHistory, ArticleRows, OriginalTransactionLink
    │   │   ├── queue/         ← TransactionCard
    │   │   ├── releasing/     ← QueuePanel, QueueTransactionRow, ReleaseProcessor,
    │   │   │                     ItemEditModal, SubstandardResolution, HandoverOutcomeModal,
    │   │   │                     PaymentConfirmedModal
    │   │   ├── ui/            ← Badge, Button, Card, FullScreenModal, Input, Modal, Toast
    │   │   ├── walkin/        ← CreateTransactionModal, CustomerSelector, AddCustomerModal,
    │   │   │                     ProductSelector, OrderSummaryPanel
    │   │   ├── ErrorBoundary.jsx
    │   │   └── ProtectedRoute.jsx
    │   ├── hooks/
    │   │   ├── useWebSocket.js
    │   │   ├── useQueue.js
    │   │   ├── useAuth.js
    │   │   ├── useArticleRows.js
    │   │   ├── useCustomer.js
    │   │   ├── usePaymentMethods.js
    │   │   ├── useProducts.js
    │   │   └── useTransactions.js
    │   ├── store/
    │   │   ├── authStore.js
    │   │   └── notificationStore.js
    │   ├── services/
    │   │   └── api.js          ← relative URLs only, never localhost
    │   └── utils/
    │       ├── format.js       ← formatCurrency
    │       ├── id.js           ← generateId (HTTP-safe, no crypto.randomUUID)
    │       ├── customerType.js
    │       ├── paymentMethod.js
    │       ├── paymentDraft.js
    │       ├── receiverDraft.js
    │       ├── transactionStatus.js
    │       └── time.js
    └── dist/
```