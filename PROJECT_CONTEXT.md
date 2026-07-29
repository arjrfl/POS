# Lash Meatshop POS — Project Context

## 1. Context & Requirements

- Fully **offline** deployment. No internet access at runtime, anywhere.
- Web-based POS accessed via LAN browser on each terminal (no installed client app).
- Single server PC hosts everything (DB + app). Client terminals only need a browser.
- All 27 client terminals must use **Google Chrome** (same fixed version, auto-update disabled)

| Role | Members | PCs |
|---|---|---|
| Receiver | 6 | 6 |
| Payment | 10 | 10 |
| Releasing | 10 | 10 |
| Admin | 1 | 1 |
| **Total client terminals** | | **27** |
| Database/app server | — | 1 |

---

## 2. Confirmed Stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TailwindCSS + PWA |
| Frontend state | React Query (server state) + Zustand (client state) |
| Real-time | Native WebSocket — FastAPI built-in, browser WebSocket API on frontend |
| Backend | Python 3.12 + FastAPI + asyncpg |
| ORM / Migrations | SQLAlchemy + Alembic |
| Database | PostgreSQL 16 |
| Reverse proxy | Nginx |
| Containers | Docker Compose — 4 containers: nginx, backend, postgres, backup |
| Redis | Not used |
| Socket.io | Not used — native WebSocket sufficient at 27 connections |

---

## 3. Transaction Flows

### Walk-In Customer Flow

```
Receiver → Payment → Releasing
```

| Step | Actor | Action | transaction_status |
|---|---|---|---|
| 1 | Receiver | Creates transaction, inputs order + customer details | `pending_payment` |
| 2 | Payment | Grabs, processes payment | `pending_payment` → `pending_settlement` |
| 3 | Releasing | Confirms actual weight | `pending_settlement` → `completed` or `pending_adjustment` |

### Online Customer Flow

```
Receiver → Releasing (confirm-ready) → Payment (pay) → Releasing (complete-online)
```

Online orders are per unit/box, not per weight — there's no substandard-kilo variance
to confirm, so Releasing's first touch is just "items ready" (stock leaves the shelf
here). Payment still has to collect payment before Releasing gives a final handover
confirmation — that confirmation is a real second Releasing step in the DB
(`pending_handover` status, `POST /confirm-handover` is NOT used here — see
`POST /complete-online` in `transaction_service.py`), not an automatic complete.

| Step | Actor | Action | transaction_status |
|---|---|---|---|
| 1 | Receiver | Creates transaction | `pending_settlement` (skips Payment first) |
| 2 | Releasing | Confirms items ready, stock decremented | `pending_settlement` → `pending_payment` |
| 3 | Payment | Processes payment (online ref number) | `pending_payment` → `pending_handover` |
| 4 | Releasing | Confirms handover (`POST /complete-online`) | `pending_handover` → `completed` |

> At step 2 (Releasing, `pending_settlement`), Releasing may also
> correct order items (QTY/Est. Weight/Unit Count only, no add or
> delete) before confirming items ready — see §6a below. This is a
> pre-payment estimate correction, not the substandard/variance
> flow in §6, and never produces an adjustment/refund child.

### Balance Settlement Only Flow

```
Receiver → Payment → completed (Releasing skipped entirely)
```

- Receiver creates with "Balance Settlement Only" toggle checked
- transaction_type: `balance_settlement`
- Always goes to Payment regardless of customer_type (walk_in or online)
- Must be paid in full — no partial payment allowed

---

## 4. Transaction Status Values

| Status | Meaning |
|---|---|
| `pending_payment` | walk_in: Walk-In done, waiting for Team Payment. online: Releasing done, waiting for Team Payment |
| `pending_settlement` | walk_in: Payment done, waiting for Team Releasing to confirm weight. online: Walk-In done, goes DIRECTLY to Releasing (skips Payment first) |
| `pending_adjustment` | Releasing found variance, child adjustment/refund sent to Payment queue, waiting for resolution |
| `settled` | Payment has resolved the adjustment/refund child (paid, partially paid, or saved as credit). Parent is waiting for Releasing's final handover confirmation (`POST /confirm-handover`) before moving to `completed` |
| `pending_handover` | online only, no substandard variance: Payment has confirmed payment for the order. Waiting on Releasing's final confirmation (`POST /complete-online`) before moving to `completed`. Distinct from `settled`, which is reserved for substandard adjustment/refund resolution |
| `completed` | Fully done |
| `voided` | Cancelled |

---

## 5. Queue Mechanism

The queue is a filtered view of `sales_transaction` by status:

```sql
-- Payment queue
SELECT * FROM sales_transaction
WHERE transaction_status = 'pending_payment'
AND queue_status = 'waiting'
ORDER BY walkin_at ASC;

-- Releasing queue (settlement, adjustment-pending, substandard-resolved-awaiting-
-- handover, and plain-online-awaiting-handover cards — no queue_status restriction;
-- processing/parked cards are included too and rendered with their own card styling)
SELECT * FROM sales_transaction
WHERE transaction_status IN ('pending_settlement', 'pending_adjustment', 'settled', 'pending_handover')
ORDER BY created_at DESC;
```

### Queue Status Values

| queue_status | Meaning |
|---|---|
| `waiting` | Available for any team member to grab |
| `processing` | Locked by a specific member (`processing_by_user_id`) |
| `parked` | Temporarily set aside — any member can unpark |
| `done` | Phase complete, moved to next queue |

### Auto-Release on Disconnect
When a user's WebSocket disconnects (refresh, logout, browser close):
- Any transaction they were processing auto-releases back to `waiting`
- Broadcasts to current team's room so others see it become available

### Stale-Parked Highlight (client-side only)
A `parked` card on the Payment or Releasing queue whose `parked_at` is 3+
hours old renders with a red highlight (`bg-red-50`/`border-l-red-500`,
overriding the normal yellow parked styling) plus a "Parked Xh Ym" duration
badge. Flat 3-hour threshold, hardcoded — not configurable. Purely a
frontend re-render on a 60-second timer against the existing `parked_at`
field; no new endpoint, no WebSocket event, no Admin Dashboard change. This
is separate from and does not replace `QueueMonitorSection`'s own
(currently unwired, deprioritized) ">30min" concept mentioned in §14 item 6
— that refers to a different, unbuilt component.

---

## 6. Substandard Kilo Flow (Releasing)

Releasing confirms actual weight per item using a **per-item edit modal** (not bulk form).

### Per-Item Edit Modal
- Opens with actual weight defaulting to `transaction_item.estimated_weight_kg`
- Shows live variance calculation as user types
- After confirming: row colored green (exact), yellow (heavier), blue (lighter)
- Items can be re-edited after confirmation (edit button always stays active)

### After All Items Confirmed

**Exact weight (balance_due = 0):**
- Transaction auto-completes → `completed`

**Any variance (balance_due != 0):**
- Single button only: **[ Send to Payment for Adjustment ]**
- Generates child transaction (type: `adjustment` if heavier, `refund` if lighter)
- Child → Payment queue (`pending_payment`)
- Parent → `pending_adjustment` (stays visible in Releasing queue as read-only)
- When Payment resolves child → parent → `settled` (stays visible in Releasing's
  queue as a read-only "Payment Resolved" card, not completed yet)
- Releasing then gives a final handover confirmation (`POST /{id}/confirm-handover`)
  — this is where stock actually leaves for this flow — which moves the parent to
  `completed` and it disappears from the Releasing queue

### What Releasing Does NOT Do
- Does NOT offer "Save as Balance" option
- Does NOT offer "Save as Credit" option
- Does NOT auto-deduct from customer credit
- All financial decisions belong to Payment team

---

## 6a. Online Pre-Payment Item Correction (Releasing)

Online transactions have no substandard-kilo variance concept (they
are per-unit/box, not per-weight). Instead, Releasing's first touch
allows correcting the Receiver's estimated order before it is priced
and sent to Payment — because the customer may have changed the
order via channels outside the system (messenger, phone, etc.) after
the Receiver already created the transaction.

- Endpoint: `PATCH /api/transactions/{id}/releasing-items`
- Scope: `online` + `original` + `pending_settlement`, grabbed by
  the requesting Releasing user
- Update-only: QTY, Est. Weight, Unit Count per item — no add,
  delete, or revert
- Recomputes `estimated_amount`/`total_due`; does not touch
  `actual_amount` or any `actual_*` column
- UI: pencil icon per row, single-item modal, current-vs-new columns
- Confirm Items Ready is disabled until every item has been opened
  and saved at least once (frontend-session state, resets on
  re-grab — no DB persistence)
- No adjustment/refund child is ever generated by this flow
- Audit logging: each successful correction writes one
  `transaction_item_audit_log` row (`edit_source =
  'releasing_item_correction'`, action `"updated"` per touched item) —
  see CLAUDE.md Database Rules

---

## 6b. End-of-Day Auto-Void

A nightly scheduled job (no manual trigger) voids transactions still stuck
before Payment/Releasing has finished with them at end of day, so they don't
linger into the next business day.

- Runs from a plain asyncio background task started at FastAPI startup
  (`app/services/scheduler_service.py`) — no new scheduling dependency.
  Time is configurable via `END_OF_DAY_VOID_HOUR`/`END_OF_DAY_VOID_MINUTE`
  env vars (default 23:59, server-local time)
- Eligibility is intentionally narrow — **not** "all incomplete
  transactions." Only:
  - `transaction_status = 'pending_payment' AND customer_type = 'walk_in'`, OR
  - `transaction_status = 'pending_settlement'` (either `customer_type`)

  — **AND `queue_status = 'waiting'` in both cases.** The status/
  customer_type pair is the only guarantee that `product.stock_quantity`
  hasn't been touched yet for that transaction (confirmed against the flow
  tables in §3 above). `queue_status = 'waiting'` on top of that guarantees
  no team member currently has it grabbed (`processing`) or set aside
  (`parked`) — a transaction actively being worked on must never be
  auto-voided out from under whoever holds it, even if its status/
  customer_type otherwise match. Every other incomplete status — online's
  own `pending_payment`, `pending_adjustment`, `settled`, `pending_handover`
  — has already moved stock and is explicitly out of scope
- Any nonzero `credit_applied` or `balance_settled` on the voided
  transaction is reversed via new compensating `customer_ledger` rows
  (append-only — existing rows are never edited or deleted), so the
  customer's `net_balance` ends up exactly as if the transaction never
  existed
- Sets `transaction_status = 'voided'`, resets the queue lock fields
  (`queue_status → 'done'`, `processing_by_user_id`/`parked_by_user_id`/
  `parked_at → NULL`), writes a `transaction_void_log` row and a
  `transaction_audit_log` row, and broadcasts the status change to the
  team room that had it (payment-queue or releasing-queue) plus admin —
  same as any other status transition
- Attributed to a seeded `system_auto_void` account (`is_active = FALSE`,
  can never log in) — not a real admin login
- Each transaction is voided in its own try/except so one bad row can't
  block the rest of the nightly batch
- Implementation: `run_end_of_day_auto_void` in `transaction_service.py`
- `run_end_of_day_auto_void(db, dry_run=True)` reports what WOULD be voided
  (same eligibility query, no writes, no broadcasts) instead of actually
  voiding anything. **This is the mandatory way to verify this function
  outside the real nightly schedule** — always call `dry_run=True` first,
  inspect every id in the returned list, and only make a real
  (`dry_run=False`) call if every single one is recognized/expected. This
  function scans the whole table, not just rows you created, so an unscoped
  real call against shared/live data will void whatever else is eligible at
  that moment — see the incident note on transaction 14/15 in
  `transaction_audit_log` for exactly what that looked like in practice

---

## 7. Payment Team Responsibilities

Payment handles ALL financial decisions:

### Payment Options
- Cash only, Online only (GCash/Maya/Bank Transfer), Split (cash + online)
- One `payment_detail` row per method
- Split = two rows

### Balance/Credit in Payment Modal
- Per-transaction balance checkboxes (not one combined checkbox)
- Each `balance_added` ledger entry shown as separate checkbox with order_number + amount
- Customer chooses WHICH specific transaction balance to settle
- Checking any balance = must pay FULL amount (no partial when balance checked)
- Credit applied = reduces total, partial payment still allowed
- Source transactions shown when checkbox checked

### Partial Payment
- Allowed: `original` and `adjustment` transaction types, no balance checked
- Blocked: `balance_settlement` type, or any balance checkbox checked
- Remaining → saved as `balance_added` in `customer_ledger`
- Transaction still goes to Releasing after partial payment

### Substandard Resolution — Refund Children (store owes customer)
- Order Details shows a CREDIT ADJUSTMENT badge, "Linked to: {parent_order_number}", and
  "Store owes customer ₱X for weight variance" — no payment method fields at all
- Single button: **[ Save as Credit ]** → `POST /api/transactions/{id}/resolve-as-credit`
  - Adds `total_due` to `customer.net_balance`, logs a `credit_added` ledger entry
  - Child → `completed`; parent (if still `pending_adjustment`) → `completed` too
  - No `payment_detail` row is created for this path
- Adjustment children (customer owes more) are unaffected — still go through the
  normal cash/online/split payment flow
- The old behavior of letting a `refund` transaction flow through the normal
  `/pay` endpoint (a cash/online payout) still exists in the backend code, but
  is intentionally not exposed in the current Payment UI — may be re-enabled later
- Note: because no `payment_detail` row is created, refund children must be
  excluded from any cash/sales aggregate (e.g. Admin Dashboard's Total Sales
  Today) — see the locked rule in CLAUDE.md.

### Payment Draft Entries
- Entries saved as drafts in `payment_detail` (`is_draft = TRUE`)
- Balance checkbox state saved in `draft_balances_json`
- All draft state restored when transaction is unparked
- Auto-save every 2 minutes while modal is open

### Park Flow
- Payment member can park from within the payment modal
- [ Park Transaction ] button in modal footer
- Saves draft entries first, then parks
- Any payment member can unpark (not just the one who parked)

---

## 8. Receiver Screen

### Layout
- No queue view — Receiver has no queue of its own
- One [ + Create Transaction ] button opens Create modal (full-screen)

### Create Transaction Modal
- Customer selector with "Add Customer" option when not found
- Customer Type dropdown: Select / Walk-In / Online (chip with × when selected)
- Balance Settlement Only toggle (appears when customer has utang)
  - Disables product section
  - transaction_type → `balance_settlement`
  - Always goes to Payment (not Releasing)
- Product selector with fields: Estimated Weight, Unit Price (read-only), Unit Count, QTY
- QTY auto-fills from last-touched field (Estimated Weight OR Unit Count)
- Order Summary table: QTY | UNIT | ARTICLES | UNIT PRICE | AMOUNT | [🗑]
- Change-guard modal when customer/type is changed with items present

---

## 9. UI Standards (All Screens)

Chrome colors (nav, buttons, panel borders, modals) follow the Brand Theme
in CLAUDE.md (black/gold/white). Status colors below are unaffected and
remain locked.

### Layout
- No whole-page scroll on any screen
- 60% left panel (queue) / 40% right panel (order details)
- Both panels: `bg-gray-100 border border-brand-black/20 rounded-lg`
- "Queue" label above left panel, "Order Details" label above right panel

### Queue Cards (compact, not table)
Three-column layout per card:
- LEFT: order_number (font-mono font-bold text-base) + customer name below
- MIDDLE: customer_type badge + queue_status pill (side by side, never stacked)
- RIGHT: total (if shown) + action button (side by side, never stacked)
- Card: `px-4 py-3 border border-gray-200 rounded-md mb-1`
- Processing: `bg-blue-50 border-l-4 border-l-blue-400`
- Parked: `bg-yellow-50 border-l-4 border-l-yellow-400`

### Queue Lock
When a transaction is active in Order Details:
- Queue dims: `opacity-50 pointer-events-none`
- Yellow banner: "Finish the current transaction before processing another"
- Clears when Order Details is emptied

### Order Details Items Table
All screens use: QTY | UNIT | ARTICLES | UNIT PRICE | AMOUNT
- ARTICLES = product_name bold + brand_name small gray below
- All amounts: `formatCurrency` (₱3,000.00 not ₱3000.00)

### Releasing Queue Cards
- No total shown on cards
- `pending_adjustment` cards show as read-only "Awaiting Payment" purple pill
- No action button on `pending_adjustment` cards

---

## 10. Architecture Overview

```
Client terminals (27 PCs — Chrome only)    Database server PC (Docker host)
┌──────────────────────────┐           ┌──────────────────────────────────────┐
│  Receiver team  (6 PCs)  │           │  nginx       (reverse proxy)          │
│  Payment team  (10 PCs)  │──LAN──────│  backend     (FastAPI + WebSocket)    │
│  Releasing team(10 PCs)  │  (offline)│  postgresql  (primary datastore)      │
│  Admin          (1 PC)   │           │  backup      (nightly pg_dump)        │
└──────────────────────────┘           └──────────────────────────────────────┘
```

---

## 11. Docker Setup (4 Containers)

```yaml
services:
  nginx:
    image: nginx:stable
    ports: ['80:80']
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
      - ./frontend/dist:/usr/share/nginx/html
    depends_on: [backend]
    restart: always

  backend:
    build: ./backend
    environment:
      - DATABASE_URL=postgres://pos:${DB_PASSWORD}@postgres:5432/lash_meatshop_db
    depends_on: [postgres]
    restart: always

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_USER=pos
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=lash_meatshop_db
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: always

  backup:
    image: postgres:16
    entrypoint: ['/bin/sh', '-c',
      'while true; do sleep 86400;
       pg_dump -h postgres -U pos lash_meatshop_db
       > /backups/lash_meatshop_$(date +%F).sql; done']
    environment:
      - PGPASSWORD=${DB_PASSWORD}
    volumes:
      - ./backups:/backups
    depends_on: [postgres]

volumes:
  pgdata:
```

---

## 12. Reliability

- **UPS on the server** — power cut mid-transaction risks corrupted DB writes
- **RAID 1 or second drive** — backup container only helps if machine survives
- **Documented restore procedure**:
  ```bash
  docker compose up -d
  docker compose exec postgres psql -U pos -d lash_meatshop_db \
    < /backups/lash_meatshop_YYYY-MM-DD.sql
  ```
- **Standby server PC** *(optional)* — turns full-day outage into ~20 min recovery

---

## 13. Open Items (Batch 5 — Production Readiness)

- [x] Plain HTTP vs self-signed HTTPS — DECIDED: staying on plain HTTP.
    Chrome's --unsafely-treat-insecure-origin-as-secure flag covers the
    PWA service-worker secure-context requirement instead. See
    deployment/launch-chrome-terminal.bat and CLAUDE.md Frontend Deploy
    Notes. To be applied to all 27 terminals alongside the still-pending
    kiosk-mode setup.
- [x] Backup destination — RESOLVED: relying on the existing docker
    `backup` container's nightly local pg_dump only. Off-machine backup
    explicitly declined by client. See §13a for full note.
- [ ] Static IP scheme for server + `hosts` file entries for all 27 terminals
- [ ] Whether a standby/failover server PC is in budget
- [x] Parked transaction timeout threshold — DONE: flat 3-hour, client-side
  visual highlight only (red card + "Parked Xh Ym" badge) on Payment and
  Releasing queue cards, no alert/notification. See Queue Mechanism note above.
- [ ] Load test with ~27 simulated concurrent connections
- [x] Alembic migration workflow — FINALIZED: dual-source (schema.sql +
    Alembic) retained, with scripts/verify-schema-parity.ps1 as a
    mandatory drift-check before any schema-changing commit. A baseline
    migration (`101b1dc45309`) was added 2026-07-29 so the Alembic chain
    is now fully replayable from an empty database — verify-schema-parity.ps1
    passes both paths with zero diff, and this has zero effect on
    already-provisioned databases (schema.sql + `alembic stamp head`
    remains the only real deploy path). See CLAUDE.md Database Rules for
    details.
- [~] CORS hardening — code done (dev/staging), env value still needs
  to be set on the production server's .env (see §13a)
- [ ] Chrome kiosk mode setup on all 27 terminals
- [ ] Chrome auto-update disabled on all terminals

---

## 13a. Deployment Status

- Production server PC: static IP `192.168.1.58` (manually assigned,
  DHCP disabled). Intended hostname `http://meatshop.local` — requires a
  manual `hosts` file entry added individually on each of the 27
  terminals; not automatic.
- As of 2026-07-29: a TEST deployment is in progress on this server,
  running from the `staging` branch — not yet a full go-live to all 27
  terminals.
- Deployed via manual command relay: Claude Code Desktop is deliberately
  NOT installed on the server PC (kept minimal footprint). Commands are
  written in the planning chat and run manually on the server via
  TeamViewer, one step at a time.
- Fresh secrets (`DB_PASSWORD`, `SECRET_KEY`) were generated directly on
  the server itself — never shared with or stored in the dev environment.
- Backup destination: RESOLVED — client has decided to rely solely on
  the existing docker `backup` container's nightly local `pg_dump`
  (writes to ./backups on the same server PC/drive as pgdata). No
  USB/NAS/off-site backup will be configured. Client is explicitly
  aware this does not protect against server drive failure or physical
  loss/theft/disaster — accepted risk, not an oversight.
- ⚠️ Backend port 8000 is directly exposed in `docker-compose.yml`
  alongside nginx's port 80 — bypasses nginx entirely. Flagged for the
  still-deferred CORS/environment hardening Batch 5 item above.
- CORS hardening: env-driven allow_origins implemented on dev/staging
  (CORS_ALLOWED_ORIGINS env var, no wildcard fallback). Still needs
  CORS_ALLOWED_ORIGINS=http://meatshop.local,http://192.168.1.58 added
  to the server's .env — pending, to be done on SERVER PC alongside the
  remaining deployment steps.
- This test deployment runs `schema.sql` against a genuinely fresh
  database, which is exactly the scenario that surfaced the
  `transaction_item_audit_log` FK-ordering bug fixed just before this
  deployment — see the "Fresh-install fix" note in CLAUDE.md's Database
  Rules section.

---

## 14. What Remains to Build

### Admin Screen (`/admin`) — IN PROGRESS
TabBar navigation with tabs:
1. **Dashboard** — ✅ DONE — transactions today count, total sales today,
   pending queue counts, top products chart
2. **Transaction History** — ✅ DONE — full list with filters (date, status,
   customer type, customer search), paginated
   - Click row → expand full transaction chain (parent + children)
3. **Customers** — ✅ DONE — list with search, click → customer detail +
   "View Details" modal (customer info, balance/credit ledger, full
   transaction history)
4. **Products** — ✅ DONE — full CRUD (add/edit, adjust stock,
   activate/deactivate, audit history with role attribution), shared with
   Releasing's Inventory tab via the same underlying components — dual
   ownership, not admin-only. Changes in either screen broadcast live to
   the other over WebSocket
5. **Users** — ✅ DONE — `UsersSection.jsx`, `UserFormModal.jsx`,
   `ResetPasswordModal.jsx`, `UserHistoryModal.jsx` all built and wired into
   the TabBar. Backend `users.py` has full CRUD (list/get/create/update/
   reset-password/toggle-status/delete), gated by `require_role("admin")`.
   Backend rule: `role_id` is set once at creation and immutable afterward —
   `PATCH /api/users/{id}` only accepts `full_name`/`username`. Changing a
   user's role means deactivating the old account and creating a new one
   with the correct role — intentional simplicity tradeoff, not an oversight.
6. **Queue Monitor** — NOT WIRED IN — `QueueMonitorSection.jsx` exists
   (live view of Payment/Releasing queues, parked >30min alerts) but is not
   wired into the Admin page/TabBar. Explicitly deprioritized/skipped per
   discussion, not forgotten.

### Batch 5 — Production Readiness
See Open Items above.

---

## 15. Git Branch Strategy

```
main     ← last known fully working milestone (deploy from here)
  └── staging  ← pre-deployment testing
        └── dev  ← active development
              └── feature/*  ← one branch per feature
```

Flow: feature/* → dev → staging → main