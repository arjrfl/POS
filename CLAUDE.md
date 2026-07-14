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
- Admin screen: NOT YET BUILT
- Batch 5 (production readiness): NOT YET DONE
- Known deferred issue: multiple WebSocket connections per user (fix in Batch 5)
- All 27 client terminals must use Google Chrome (fixed version, auto-update disabled)

---

## Team Roles

| Role | DB value | What they do |
|---|---|---|
| `receiver` | `receiver` | Creates transactions, inputs orders. Previously called "walk_in" — renamed. |
| `payment` | `payment` | Processes payment (cash/online/split), can park transactions, handles balance/credit decisions |
| `releasing` | `releasing` | Confirms actual item weight, sends variance to Payment — NO financial decisions |
| `admin` | `admin` | Full visibility — queues, reports, audit log, customer ledger |

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

Do not introduce Redis, Socket.io, Celery, GraphQL, Next.js, or any other
dependency not listed above without explicit instruction.

---

## Critical Business Rules

### Transactions — Never Mutate, Always Extend
- A completed or settled transaction is immutable
- Substandard kilo outcomes always generate a **child transaction** linked via
  `parent_transaction_id` — never edit the original
- transaction types: `original`, `adjustment`, `refund`, `balance_settlement`, `credit_usage`

### Two Customer Flows — Different Pipeline Order
- `walk_in`: Receiver → Payment → Releasing
- `online`: Receiver → Releasing → Payment (no second Releasing in DB, just marked complete)
- `customer_type` on `sales_transaction` determines which flow applies

### Queue = Status Filter, Not a Message Broker
- Payment queue: `transaction_status = 'pending_payment' AND queue_status = 'waiting'`
- Releasing queue: `transaction_status IN ('pending_settlement', 'pending_adjustment') AND queue_status = 'waiting'`
- Receiver queue: `transaction_status = 'pending_edit'` (returned from Payment for editing)
- No RabbitMQ, no Redis — just PostgreSQL status column + WebSocket broadcast

### Queue Locking
- When a team member grabs: `queue_status → 'processing'`, `processing_by_user_id` set
- When parked: `queue_status → 'parked'`, `processing_by_user_id → NULL`
- On WebSocket disconnect: auto-release any transactions the user was processing back to 'waiting'

### WebSocket Must Broadcast on Two Events
1. `transaction_status` change → broadcast to **next team's** room
2. `queue_status` change → broadcast to **current team's** room

### WebSocket Rooms
- `receiver-queue` → receiver role only
- `payment-queue` → payment role only
- `releasing-queue` → releasing role only
- `admin` → admin role only

### Return to Receiver Flow (walk_in only)
- Payment can return a walk_in transaction to Receiver for item editing
- `transaction_status → 'pending_edit'`, broadcasts to `receiver-queue`
- Receiver can only edit ITEMS (not customer or customer type)
- After editing: Receiver resubmits → `pending_payment` → back to Payment queue
- Online transactions CANNOT be returned to Receiver

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

### Substandard Kilo — Payment Resolution
- `adjustment` children (customer owes more): normal payment flow (cash/online/split), same as any transaction
- `refund` children (store owes customer): resolved via a single **[ Save as Credit ]**
  button only — no cash/online payment fields shown, no `payment_detail` row created
  - `POST /api/transactions/{id}/resolve-as-credit` adds the amount to
    `customer.net_balance` and logs a `credit_added` `customer_ledger` entry
  - The old code path that lets a `refund` transaction flow through the normal
    `/pay` endpoint is still in the codebase (see comment above that route) but
    is intentionally not surfaced in the UI — may be re-enabled later
- After Payment resolves child → parent auto-completes → disappears from releasing queue

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
- Key transaction endpoints:
  - `POST /api/transactions` — create (receiver)
  - `POST /api/transactions/{id}/grab` — lock transaction
  - `POST /api/transactions/{id}/park` — park transaction
  - `POST /api/transactions/{id}/unpark` — unpark transaction
  - `POST /api/transactions/{id}/pay` — process payment
  - `POST /api/transactions/{id}/return-to-receiver` — send back for editing (payment only, walk_in only)
  - `PATCH /api/transactions/{id}/items` — edit items (receiver only, pending_edit only)
  - `POST /api/transactions/{id}/resubmit` — resubmit to payment after editing
  - `POST /api/transactions/{id}/confirm-weight` — confirm actual weights (releasing)
  - `POST /api/transactions/{id}/confirm-ready` — online orders ready (releasing)
  - `POST /api/transactions/{id}/resolve` — resolve substandard, outcome: "send_to_payment" only
  - `POST /api/transactions/{id}/resolve-as-credit` — resolve a `refund`-type child as
    customer credit (payment only, `pending_payment` only, no payment method involved)
  - `PUT /api/transactions/{id}/payment-drafts` — save draft payment entries
  - `GET /api/customers/{id}/balance-entries` — get per-transaction balance entries

---

## Frontend Rules

- Role-based routing — each team sees only their screen on login
- Receiver screen (`/walkin`): queue of `pending_edit` + create modal + edit modal
- Payment screen (`/payment`): queue of `pending_payment`, payment modal with drafts
- Releasing screen (`/releasing`): queue of `pending_settlement` + `pending_adjustment`
- Admin screen (`/admin`): NOT YET BUILT
- No page scroll on any screen — panels scroll internally only
- All screens: 60% left (queue) / 40% right (order details) split
- Queue panels: `bg-gray-100 border border-gray-400 rounded-lg`
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
    │   ├── assets/logo.png
    │   ├── pages/
    │   │   ├── WalkIn.jsx     ← Receiver screen
    │   │   ├── Payment.jsx
    │   │   ├── Releasing.jsx
    │   │   └── Admin.jsx      ← NOT YET BUILT
    │   ├── components/
    │   │   ├── layout/
    │   │   ├── ui/
    │   │   └── ErrorBoundary.jsx
    │   ├── hooks/
    │   │   ├── useWebSocket.js
    │   │   ├── useQueue.js
    │   │   └── useAuth.js
    │   ├── store/
    │   │   ├── authStore.js
    │   │   └── notificationStore.js
    │   ├── services/
    │   │   └── api.js          ← relative URLs only, never localhost
    │   └── utils/
    │       ├── format.js       ← formatCurrency
    │       └── id.js           ← generateId (HTTP-safe, no crypto.randomUUID)
    └── dist/
```