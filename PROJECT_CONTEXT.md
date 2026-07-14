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
Receiver → Releasing → Payment → completed
```

| Step | Actor | Action | transaction_status |
|---|---|---|---|
| 1 | Receiver | Creates transaction | `pending_settlement` |
| 2 | Releasing | Confirms items ready | `pending_settlement` → `pending_payment` |
| 3 | Payment | Processes payment (online ref number) | `pending_payment` → `completed` |

### Balance Settlement Only Flow

```
Receiver → Payment → completed (Releasing skipped entirely)
```

- Receiver creates with "Balance Settlement Only" toggle checked
- transaction_type: `balance_settlement`
- Always goes to Payment regardless of customer_type (walk_in or online)
- Must be paid in full — no partial payment allowed

### Return to Receiver Flow (walk_in only)

```
Payment → Receiver (edit) → Payment → Releasing
```

- Payment returns transaction when customer wants to change their order
- Only walk_in transactions can be returned (online cannot)
- Receiver can only edit ITEMS — not customer or customer_type
- transaction_status: `pending_edit` while at Receiver

---

## 4. Transaction Status Values

| Status | Meaning |
|---|---|
| `pending_payment` | Waiting for Payment team |
| `pending_settlement` | Payment done, waiting for Releasing to confirm weight |
| `pending_edit` | Returned from Payment to Receiver for item editing (walk_in only) |
| `pending_adjustment` | Releasing found variance, child sent to Payment, waiting for resolution |
| `settled` | Releasing confirmed with variance, outcome recorded |
| `completed` | Fully done |
| `voided` | Cancelled |

---

## 5. Queue Mechanism

The queue is a filtered view of `sales_transaction` by status:

```sql
-- Receiver queue (returned for editing)
SELECT * FROM sales_transaction
WHERE transaction_status = 'pending_edit'
AND queue_status = 'waiting'
ORDER BY updated_at ASC;

-- Payment queue
SELECT * FROM sales_transaction
WHERE transaction_status = 'pending_payment'
AND queue_status = 'waiting'
ORDER BY walkin_at ASC;

-- Releasing queue (both settlement and adjustment waiting)
SELECT * FROM sales_transaction
WHERE transaction_status IN ('pending_settlement', 'pending_adjustment')
AND queue_status = 'waiting'
ORDER BY payment_at ASC;
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
- When Payment resolves child → parent auto-completes → disappears from Releasing queue

### What Releasing Does NOT Do
- Does NOT offer "Save as Balance" option
- Does NOT offer "Save as Credit" option
- Does NOT auto-deduct from customer credit
- All financial decisions belong to Payment team

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

### Return to Receiver
- [ Return to Receiver ] button in Order Details (walk_in transactions only)
- Asks confirmation before returning
- Transaction disappears from Payment queue, appears in Receiver queue

---

## 8. Receiver Screen

### Layout
- Single queue view (not two-panel)
- One [ + Create Transaction ] button opens Create modal (full-screen)
- Queue shows only `pending_edit` transactions (returned from Payment)
- Receiver's own created transactions do NOT appear in receiver queue

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

### Edit Transaction Modal (pending_edit)
- Opens when Receiver grabs a returned transaction
- Items pre-populated, can add/remove items only
- Customer and customer_type are read-only (cannot change)
- [ Save & Send to Payment ] → PATCH items + resubmit
- [ Cancel ] → releases grab

---

## 9. UI Standards (All Screens)

### Layout
- No whole-page scroll on any screen
- 60% left panel (queue) / 40% right panel (order details)
- Both panels: `bg-gray-100 border border-gray-400 rounded-lg`
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

- [ ] Fix multiple WebSocket connections per user (structural issue in useWebSocket hook)
- [ ] End-of-day auto-void for incomplete transactions (TODO comment in transaction_service.py)
- [ ] Plain HTTP vs self-signed HTTPS across the LAN
- [ ] Backup destination: USB drive vs NAS vs second PC
- [ ] Static IP scheme for server + `hosts` file entries for all 27 terminals
- [ ] Whether a standby/failover server PC is in budget
- [ ] Parked transaction timeout threshold (alert admin after 30 mins)
- [ ] Load test with ~27 simulated concurrent connections
- [ ] Admin screen build
- [ ] Alembic migration workflow finalized
- [ ] Environment hardening (CORS tightened for production)
- [ ] Chrome kiosk mode setup on all 27 terminals
- [ ] Chrome auto-update disabled on all terminals

---

## 14. What Remains to Build

### Admin Screen (`/admin`) — NOT YET STARTED
Sidebar navigation with sections:
1. **Dashboard** — transactions today count, total sales today, pending queue counts
2. **Transactions** — full list with filters (date, status, customer type, customer search)
   - Click row → expand full transaction chain (parent + children)
3. **Customers** — list with search, click → customer detail + full ledger history
4. **Products** — CRUD (admin only)
5. **Queue Monitor** — live view of all queues, parked alerts (flag >30 mins), all roles

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