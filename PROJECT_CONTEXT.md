# Lash Meatshop POS — Project Context

## 1. Context & Requirements

- Fully **offline** deployment. No internet access at runtime, anywhere.
- Web-based POS accessed via LAN browser on each terminal (no installed client app).
- Single server PC hosts everything (DB + app). Client terminals only need a browser.

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
| Real-time | Native WebSocket — FastAPI built-in on backend, browser WebSocket API on frontend |
| Backend | Python 3.12 + FastAPI + asyncpg |
| ORM / Migrations | SQLAlchemy + Alembic |
| Database | PostgreSQL 16 |
| Reverse proxy | Nginx |
| Containers | Docker Compose — 4 containers: nginx, backend, postgres, backup |
| Redis | Not used — `pg_notify` covers broadcasting if ever needed |
| Socket.io | Not used — native WebSocket is sufficient at 27 connections |

---

## 3. Transaction Flows

There are two customer types, each following a different pipeline.
The `customer_type` field on `sales_transaction` determines which flow applies.

### Walk-In Flow

```
Receiver Team → Payment Team → Releasing Team
```

| Step | Actor | Action | transaction_status |
|---|---|---|---|
| 1 | Receiver | Creates transaction, inputs order + customer details | `pending_payment` |
| 2 | Payment | Picks from queue, processes payment | `pending_payment` → `pending_settlement` |
| 3 | Releasing | Confirms actual weight | `pending_settlement` → `settled` / `completed` |

### Online Flow

```
Receiver Team → Releasing Team → Payment Team → Releasing Team (ship)
```

| Step | Actor | Action | transaction_status |
|---|---|---|---|
| 1 | Receiver | Creates transaction, inputs order + customer details | `pending_settlement` |
| 2 | Releasing | Confirms items available, prepares for shipment | `pending_settlement` → `pending_payment` |
| 3 | Payment | Processes payment (records online ref number) | `pending_payment` → `completed` |

> Substandard kilo is rare for online orders since customers order per unit/box.
> The system still supports it via `parent_transaction_id` if it occurs.

### Queue Mechanism

The queue is not a message broker. It is a filtered view of `sales_transaction`
by `transaction_status` and `queue_status`:

```sql
-- Payment team queue
SELECT * FROM sales_transaction
WHERE transaction_status = 'pending_payment'
AND queue_status = 'waiting'
ORDER BY walkin_at ASC;

-- Releasing team queue
SELECT * FROM sales_transaction
WHERE transaction_status = 'pending_settlement'
AND queue_status = 'waiting'
ORDER BY payment_at ASC;
```

### Queue Status Within a Phase

| queue_status | Meaning |
|---|---|
| `waiting` | Visible and available for any team member to grab |
| `processing` | Locked by a specific team member (`processing_by_user_id`) |
| `parked` | Temporarily set aside (e.g. customer's online payment is delayed) |
| `done` | Phase complete, moved to next team's queue |

When a team member grabs a transaction:
- `queue_status` → `processing`
- `processing_by_user_id` set to that member
- Other members on the same team cannot grab it

When a transaction is parked:
- `queue_status` → `parked`
- `processing_by_user_id` → NULL (released)
- `parked_by_user_id` + `parked_at` recorded for accountability
- Any member can unpark it

### WebSocket Events

On every `transaction_status` change:
- Broadcast to the **next team's** room (`payment-queue`, `releasing-queue`)
- Terminal adds the transaction to their live queue without refresh

On every `queue_status` change:
- Broadcast to the **current team's** room
- `processing` → other members see it as locked
- `parked` → reappears as available
- `done` → disappears from current queue

No polling needed. Polling stays as a reconnect fallback only.

---

## 4. Substandard Kilo Flows

Occurs when actual item weight differs from estimated weight at Releasing phase.
The original transaction is NEVER mutated. A child transaction is always generated.

### More Than Expected (customer owes extra)

Example: paid for 2kg (₱200), actual is 3kg (₱300), balance due ₱100.

**Option A — Customer pays balance now:**
- Releasing generates child transaction (type: `adjustment`, parent: `transac-001`)
- Child pushed to Payment queue
- Customer returns to Payment, pays ₱100
- Child transaction → `completed`, customer gets item

**Option B — Save as utang:**
- ₱100 recorded in `customer_ledger` (entry_type: `balance_added`)
- `customer.net_balance` updated
- `transac-001` → `settled`
- Customer gets item, owes ₱100 on next visit

**Auto-deduct from existing credit:**
- If `customer.net_balance` is positive (has credit) and covers the balance due
- System auto-deducts, records `credit_auto_used` in `customer_ledger`
- No return to Payment team needed

### Less Than Expected (store owes customer)

Example: paid for 5kg (₱500), actual is 3kg (₱300), store owes ₱200.

**Option A — Refund now:**
- Releasing generates child transaction (type: `refund`, parent: `transac-001`)
- Child pushed to Payment queue
- Customer goes to Payment, receives ₱200
- Child transaction → `completed`, customer gets item

**Option B — Save as credit:**
- ₱200 recorded in `customer_ledger` (entry_type: `credit_added`)
- `customer.net_balance` updated
- `transac-001` → `settled`
- Customer gets item, has ₱200 credit for next visit

---

## 5. Customer Balance & Credit Flows

### Net Balance Logic

```
customer.net_balance:
  positive = CREDIT  → store owes customer
  negative = BALANCE → customer owes store (utang)

Always one net number. Never shown as separate credit/balance values.
```

### Walk-In with Existing Balance/Credit

At Walk-In phase, system checks `customer.net_balance` and alerts team member.
Team member adds line items to the transaction accordingly:

| item_type | Effect on total_due |
|---|---|
| `product` | Adds to total (normal item) |
| `balance_settlement` | Adds to total (customer paying off utang) |
| `credit_usage` | Deducts from total (using stored credit) |

The total at Walk-In is the final amount Payment processes. No balance/credit
adjustments happen at the Payment phase.

### Balance Settlement Only (no new order)

1. Receiver creates transaction with only `balance_settlement` line items
2. Pushed to Payment queue (`transaction_status`: `pending_payment`)
3. Payment processes payment — Releasing is skipped entirely
4. Transaction → `completed` at Payment

---

## 6. Payment Options

All handled by `payment_detail` table. One row per method; multiple rows for split.

| Scenario | payment_detail rows |
|---|---|
| Cash only | 1 row: method=cash, tendered_amount filled, ref_number NULL |
| Online only (GCash, Maya) | 1 row: method=gcash/maya, ref_number filled, tendered_amount NULL |
| Split cash + online | 2 rows: one per method |

`change_given` on `sales_transaction` is the cash change amount.
Online payments are always exact — no change involved.

---

## 7. Architecture Overview

```
Client terminals (27 PCs)              Database server PC (offline, Docker host)
┌──────────────────────────┐           ┌──────────────────────────────────────┐
│  Receiver team  (6 PCs)  │           │  nginx       (reverse proxy)          │
│  Payment team  (10 PCs)  │──LAN──────│  backend     (FastAPI + WebSocket)    │
│  Releasing team(10 PCs)  │  (offline)│  postgresql  (primary datastore)      │
│  Admin          (1 PC)   │           │  backup      (nightly pg_dump)        │
└──────────────────────────┘           └──────────────────────────────────────┘
```

---

## 8. Docker Setup (4 Containers)

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
    entrypoint: [
      '/bin/sh', '-c',
      'while true; do sleep 86400;
       pg_dump -h postgres -U pos lash_meatshop_db
       > /backups/lash_meatshop_$(date +%F).sql; done'
    ]
    environment:
      - PGPASSWORD=${DB_PASSWORD}
    volumes:
      - ./backups:/backups
    depends_on: [postgres]

volumes:
  pgdata:
```

Nginx nginx proxy nginx config routes:
- `/` → static frontend files
- `/api/` → FastAPI backend
- `/ws/` → FastAPI WebSocket (with Upgrade headers)

---

## 9. Offline Build Steps

All steps below must be done on an internet-connected machine first, then transferred.

1. **Docker images** — pull and save while online:
   ```bash
   docker save nginx:stable -o nginx.tar
   docker save postgres:16 -o postgres.tar
   docker save backend:latest -o backend.tar
   # On the server:
   docker load -i nginx.tar && docker load -i postgres.tar && docker load -i backend.tar
   ```

2. **Frontend build** — build online, ship only `dist/` to server:
   ```bash
   npm install && npm run build
   ```

3. **Backend dependencies** — vendor Python packages online:
   ```bash
   pip download -r requirements.txt -d ./wheels
   # On the server:
   pip install --no-index --find-links=./wheels -r requirements.txt
   ```

4. **Database schema** — run on first boot:
   ```bash
   docker compose exec postgres psql -U pos -d lash_meatshop_db \
     -f /schema/schema.sql
   ```

5. **TLS** — plain HTTP is acceptable inside a closed LAN. Self-signed cert is
   recommended if any sensitivity around payment data is a concern.

6. **Local naming** — static LAN IP on server, `hosts` entry on every terminal:
   ```
   192.168.1.xxx   pos.local
   ```

7. **Kiosk mode** — each terminal auto-launches on boot:
   ```bash
   chrome --kiosk --app=http://pos.local/
   ```

8. **Auto-start** — `restart: always` handles container recovery. Add a systemd
   unit to ensure Docker starts before Compose on server reboot.

---

## 10. Reliability

All 27 terminals depend on one server. No cloud fallback exists.

- **UPS on the server** — power cut mid-transaction risks corrupted DB writes
- **RAID 1 or second drive** — the backup container only helps if the machine survives
- **Documented restore procedure**:
  ```bash
  docker compose up -d
  docker compose exec postgres psql -U pos -d lash_meatshop_db \
    < /backups/lash_meatshop_YYYY-MM-DD.sql
  ```
- **Standby server PC** *(optional)* — second PC with Docker + compose files ready.
  Turns a full-day outage into ~20 minute recovery.

---

## 11. Role-Specific Screens

| Screen | Queue filter | WebSocket room | Key actions |
|---|---|---|---|
| Walk-In | None (creates transactions) | — | Input order, apply credit/settle balance, push to Payment |
| Payment | `transaction_status = pending_payment` | `payment-queue` | Grab, process payment (cash/online/split), park, push to Releasing |
| Releasing | `transaction_status = pending_settlement` | `releasing-queue` | Grab, confirm weight, handle substandard/refund, complete |
| Admin | All transactions | All rooms | Monitor queues, parked alerts, audit log, customer ledger, reports |

---

## 12. Open Items

- [ ] Plain HTTP vs self-signed HTTPS across the LAN
- [ ] Backup destination: USB drive vs NAS vs second PC
- [ ] Static IP scheme for server + `hosts` file entries for all 27 terminals
- [ ] Whether a standby/failover server PC is in budget
- [ ] Parked transaction timeout threshold (e.g. alert admin after 30 mins)

---

## 13. Build Order

1. Set up PostgreSQL container, run `database/schema.sql`, verify all tables and enums
2. Scaffold FastAPI backend with asyncpg connection + health-check endpoint
3. Implement transaction CRUD: create, status update, queue grab/release/park
4. Add WebSocket server with role-based rooms; wire status and queue changes to broadcasts
5. Scaffold React + Vite PWA frontend; confirm it builds to static files nginx can serve
6. Write `nginx.conf`: `/` → static, `/api/` → FastAPI, `/ws/` → WebSocket
7. Bring up all 4 containers locally (while still online); verify end-to-end
8. Build Walk-In screen — create transaction, line items, balance/credit handling
9. Build Payment screen — queue view, cash/online/split payment, park flow
10. Build Releasing screen — queue view, weight confirmation, substandard handling
11. Build Admin screen — full transaction view, audit log, customer ledger, reports
12. Full offline dry run: disconnect internet, restart stack, test all 7 flows end-to-end
13. Load test with ~27 simulated concurrent connections before rollout