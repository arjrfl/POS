# Load Test Harness — Lash Meatshop POS

Isolated dev tooling for load-testing the backend. Lives entirely outside
`backend/` and `frontend/`, with its own pinned dependencies
(`locust`, `websocket-client` only). Never touches the backend Docker image
or anything that ships to production.

**Only ever run this against the LOCAL dev Docker Compose stack at
`http://localhost`. Never staging, never the production server PC.**

## Safety note

The local dev stack may not be an isolated sandbox — a real browser session
can be open against it concurrently, using the same seed users this tool
also logs in as (`receiver_user`, `payment_user`, `releasing_user`, etc.).
To make this safe to run at any time:

- All data this tool creates or mutates is prefixed `LOADTEST_` — 5 throwaway
  customers, 10 throwaway products, and whatever transactions the run
  generates against them.
- Every queue action in `locustfile.py` (grab, pay, confirm-weight,
  confirm-ready, resolve, complete-exact) filters candidates to transactions
  whose `customer_id` belongs to a `LOADTEST_` customer before acting on
  them. A real transaction sitting in a shared Payment/Releasing queue is
  never grabbed, paid, or otherwise mutated by this tool, even though the
  queue list endpoints themselves aren't filtered that way.
- Seed users, seed products, and real customers/products are never touched
  by `setup_test_data.py` or `teardown_test_data.py`.

## Setup (PowerShell)

```powershell
cd loadtest
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 1. Create throwaway test data (assumes the dev stack is already up,
#    migrated, and seeded — this script does not manage the stack itself)
python setup_test_data.py

# 2. Run headless smoke test (27 users, ramp 5/sec, 3 minutes)
locust -f locustfile.py --host http://localhost --headless `
  -u 27 -r 5 -t 3m --csv=smoke_test_results

# 3. ALWAYS clean up afterward
python teardown_test_data.py
```

## Interactive mode

```powershell
locust -f locustfile.py --host http://localhost
```

Then open http://localhost:8089 — Locust's own web UI, a different port
than nginx's `:80`, no conflict with the app itself.

## What gets simulated

Weighted mix matching the real terminal counts (6 receiver : 10 payment :
10 releasing : 1 admin out of 27):

- **ReceiverUser** — creates walk_in and online transactions against
  `LOADTEST_` customers/products. No persistent WebSocket (Receiver has no
  live queue).
- **PaymentUser** — polls the payment queue, grabs a `LOADTEST_` transaction
  when one is waiting, pays it in full via cash. Holds a WS connection to
  `payment-queue`.
- **ReleasingUser** — polls the releasing queue, grabs a `LOADTEST_`
  walk_in transaction and confirms weight (mostly exact, occasionally a
  small variance sent to Payment for adjustment), or grabs a `LOADTEST_`
  online transaction and confirms items ready. Holds a WS connection to
  `releasing-queue`.
- **AdminUser** — reads the dashboard, customer list, and transaction
  history. Holds a WS connection to `admin`.

Every WebSocket connection is recv-only (matches real usage — the frontend
never sends anything after connect) and reports each received broadcast to
Locust as a `WS recv:<room>` line, alongside the HTTP request lines.

## Known limitations (v1)

- Partial payment, Payment's Edit Items modal, balance/credit checkboxes,
  and refund resolve-as-credit are not exercised — deferred to a v2.
- Releasing's confirm-handover / complete-online final-handover steps and
  the online pre-payment item-correction PATCH are not exercised — deferred
  to a v2.
- Balance-settlement-only transactions are not created (needs a customer
  with existing utang, adds setup complexity) — deferred to a v2.
- The WS connection's token is never refreshed mid-connection, same as real
  production behavior (see CLAUDE.md Session Management). If
  `ACCESS_TOKEN_EXPIRE_MINUTES` is short, keep the run duration under it, or
  treat an eventual WS drop as expected, not a bug.
