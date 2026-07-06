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

## Team Roles

| Role | What they do |
|---|---|
| `walk_in` | Creates transactions, inputs orders, applies balance/credit at Walk-In phase |
| `payment` | Processes payment (cash/online/split), can park transactions |
| `releasing` | Confirms actual item weight, handles substandard kilo outcomes |
| `admin` | Full visibility — queues, reports, audit log, customer ledger |

---

## Confirmed Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12 + FastAPI + asyncpg + SQLAlchemy + Alembic |
| Frontend | React + Vite + TailwindCSS + PWA |
| State | React Query (server) + Zustand (client) |
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
- `walk_in`: Walk-In → Payment → Releasing
- `online`: Walk-In → Releasing → Payment → Releasing (ship)
- `customer_type` on `sales_transaction` determines which flow applies

### Queue = Status Filter, Not a Message Broker
- Payment queue: `transaction_status = 'pending_payment' AND queue_status = 'waiting'`
- Releasing queue: `transaction_status = 'pending_settlement' AND queue_status = 'waiting'`
- No RabbitMQ, no Redis queues — just a PostgreSQL status column + WebSocket broadcast

### Queue Locking
- When a team member grabs a transaction: `queue_status → 'processing'`,
  `processing_by_user_id` set — no other member can grab it
- When parked: `queue_status → 'parked'`, `processing_by_user_id → NULL`,
  `parked_by_user_id` + `parked_at` recorded — any member can unpark it

### WebSocket Must Broadcast on Two Events
1. `transaction_status` change → broadcast to **next team's** room
2. `queue_status` change → broadcast to **current team's** room

### Customer Balance/Credit
- `customer.net_balance`: positive = credit (store owes customer),
  negative = utang (customer owes store)
- Always one net number — never split into separate credit/balance fields for display
- All movements recorded in `customer_ledger` as append-only entries with `running_balance`
- Balance/credit line items are added at Walk-In phase only — never at Payment

### Balance Settlement Without New Order
- Transaction with only `balance_settlement` line items
- Goes Walk-In → Payment → `completed` (skips Releasing entirely)

---

## Database Rules

- All enum values are defined as PostgreSQL `ENUM` types in `schema.sql` — use them,
  never pass raw strings for enum columns
- All timestamps are `TIMESTAMPTZ` — always timezone-aware
- `updated_at` is maintained by the `set_updated_at()` trigger — never set it manually
- `"user"` is a PostgreSQL reserved word — always double-quote it in queries
- `balance_due` on `sales_transaction` is a generated column — never write to it
- Indexes are defined in `schema.sql` — do not add duplicates
- Always return the full transaction chain (parent + all children via `parent_transaction_id`)
  when returning a transaction to the frontend

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

---

## Frontend Rules

- Role-based routing — each team sees only their screen on login
- Walk-In screen: transaction creation only, no queue view
- Payment screen: queue filtered to `pending_payment`, payment form, park button
- Releasing screen: queue filtered to `pending_settlement`, weight confirmation form
- Admin screen: full access, all queues, audit log, reports
- PWA service worker must handle LAN reconnect gracefully — rehydrate queue on reconnect
- TailwindCSS only — no external UI component libraries unless explicitly instructed

---

## Project Structure

```
lash-meatshop-pos/
├── CLAUDE.md                  ← you are here
├── PROJECT_CONTEXT.md         ← full business context and build plan
├── docker-compose.yml
├── nginx.conf
├── database/
│   └── schema.sql             ← PostgreSQL schema, source of truth
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic/               ← migrations
│   ├── app/
│   │   ├── main.py
│   │   ├── routers/           ← one file per domain (transactions, customers, products...)
│   │   ├── models/            ← SQLAlchemy models
│   │   ├── schemas/           ← Pydantic request/response schemas
│   │   ├── services/          ← business logic (substandard calc, ledger updates...)
│   │   └── websocket/         ← WebSocket manager and broadcast helpers
│   └── tests/
└── frontend/
    ├── src/
    │   ├── pages/             ← WalkIn, Payment, Releasing, Admin
    │   ├── components/
    │   ├── hooks/             ← useWebSocket, useQueue, useTransaction
    │   └── store/             ← Zustand stores
    └── dist/                  ← built output served by nginx
```