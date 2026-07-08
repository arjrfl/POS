"""
End-to-end integration test for all 7 transaction flows described in
PROJECT_CONTEXT.md sections 3 and 4, run against the seeded data from
`app.core.seed`.

Not a pytest suite (httpx/pytest aren't project dependencies yet) — this is a
standalone script meant to be run directly against a disposable Postgres
instance:

    pip install httpx   # not a current backend dependency, needed only to run this
    docker run -d --name pos_test_pg -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=testpass \
        -e POSTGRES_DB=lash_meatshop_db -p 55432:5432 \
        -v ./database/schema.sql:/docker-entrypoint-initdb.d/schema.sql postgres:16
    # backend/.env pointing DATABASE_URL at that container
    python -m app.core.seed
    python tests/test_integration_flows.py

It uses FastAPI's TestClient (in-process ASGI, supports both REST and
WebSocket) for everything reachable over the API, and shells out to `psql`
via docker exec for the one thing no endpoint exposes: transaction_audit_log.
"""

import subprocess
import sys

sys.path.insert(0, "c:/Users/User/OneDrive/Desktop/lash-meatshop-pos/backend")

from fastapi.testclient import TestClient

from app.main import app

PASSWORD = "password123"
CASH_ID = 1
GCASH_ID = 2


def psql(sql: str) -> str:
    result = subprocess.run(
        ["docker", "exec", "pos_test_pg", "psql", "-U", "pos", "-d", "lash_meatshop_db", "-t", "-A", "-F", "|", "-c", sql],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def audit_log(transaction_id: int) -> list[str]:
    rows = psql(
        f"SELECT change_type, old_value, new_value FROM transaction_audit_log "
        f"WHERE transaction_id = {transaction_id} ORDER BY id"
    )
    return [line for line in rows.splitlines() if line]


def record(line: str) -> None:
    print(line)


def check(label: str, condition: bool, detail: str = "") -> None:
    status = "PASS" if condition else "FAIL"
    record(f"  [{status}] {label}" + (f" — {detail}" if detail else ""))
    assert condition, f"{label}: {detail}"


with TestClient(app) as client:
    tokens = {
        role: client.post("/api/auth/login", json={"username": f"{role}_user", "password": PASSWORD}).json()["data"]["access_token"]
        for role in ("walk_in", "payment", "releasing", "admin")
    }

    def auth(role):
        return {"Authorization": f"Bearer {tokens[role]}"}

    customers = {c["full_name"]: c for c in client.get("/api/customers", headers=auth("walk_in")).json()["data"]}
    products = {p["product_name"]: p for p in client.get("/api/products", headers=auth("walk_in")).json()["data"]}
    chicken = products["Chicken Breast"]
    chicken_id, price = chicken["id"], str(chicken["unit_price_php"])  # 220.00/kg

    def get_customer(customer_id):
        return client.get(f"/api/customers/{customer_id}", headers=auth("walk_in")).json()["data"]

    def get_tx(tx_id):
        return client.get(f"/api/transactions/{tx_id}", headers=auth("admin")).json()["data"]

    # =====================================================================
    # FLOW 1 — Standard walk-in transaction, exact weight
    # =====================================================================
    record("\n## FLOW 1 — Standard walk-in (exact weight)")
    jose = customers["Jose Ramirez"]
    jose_balance_before = jose["net_balance"]

    with client.websocket_connect(f"/ws/payment-queue?token={tokens['payment']}") as payment_ws:
        r = client.post(
            "/api/transactions",
            json={
                "customer_id": jose["id"],
                "customer_type": "walk_in",
                "items": [{"item_type": "product", "product_id": chicken_id, "estimated_weight_kg": "1.000", "unit_count": 1, "quantity_kg": "1.000", "unit_price": price}],
            },
            headers=auth("walk_in"),
        )
        tx = r.json()["data"]
        check("create -> 201", r.status_code == 201)
        check("transaction_status == pending_payment", tx["transaction_status"] == "pending_payment")
        check("queue_status == waiting", tx["queue_status"] == "waiting")

        event = payment_ws.receive_json()
        check(
            "creation broadcast -> payment-queue (transaction_status_changed, pending_payment)",
            event["type"] == "transaction_status_changed" and event["new_status"] == "pending_payment",
            str(event),
        )

    with client.websocket_connect(f"/ws/releasing-queue?token={tokens['releasing']}") as releasing_ws:
        r = client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("payment"))
        check("payment grab -> 200, queue_status processing", r.status_code == 200 and r.json()["data"]["queue_status"] == "processing")

        r = client.post(
            f"/api/transactions/{tx['id']}/pay",
            json={"payments": [{"payment_method_id": CASH_ID, "amount": tx["total_due"], "tendered_amount": tx["total_due"]}]},
            headers=auth("payment"),
        )
        paid = r.json()["data"]
        check("pay -> 200", r.status_code == 200)
        check("transaction_status == pending_settlement", paid["transaction_status"] == "pending_settlement")
        check("queue_status == waiting", paid["queue_status"] == "waiting")
        check("processing_by_user_id cleared", paid["processing_by_user_id"] is None)

        event = releasing_ws.receive_json()
        check(
            "payment broadcast -> releasing-queue (transaction_status_changed, pending_settlement)",
            event["type"] == "transaction_status_changed" and event["new_status"] == "pending_settlement",
            str(event),
        )

    r = client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("releasing"))
    check("releasing grab -> 200, queue_status processing", r.status_code == 200 and r.json()["data"]["queue_status"] == "processing")

    item_id = paid["items"][0]["id"]
    r = client.post(
        f"/api/transactions/{tx['id']}/confirm-weight",
        json={"items": [{"transaction_item_id": item_id, "actual_weight_kg": "1.000"}]},
        headers=auth("releasing"),
    )
    confirmed = r.json()["data"]
    check("confirm-weight -> 200", r.status_code == 200)
    check("balance_due == 0.00", confirmed["balance_due"] == "0.00", confirmed["balance_due"])
    check("transaction_status unchanged (still pending_settlement)", confirmed["transaction_status"] == "pending_settlement")

    with client.websocket_connect(f"/ws/admin?token={tokens['admin']}") as admin_ws:
        r = client.post(f"/api/transactions/{tx['id']}/resolve", json={"outcome": "pay_now"}, headers=auth("releasing"))
        resolved = r.json()["data"]
        check("resolve -> 200", r.status_code == 200)
        check("transaction_status == completed", resolved["transaction_status"] == "completed")
        check("queue_status == done", resolved["queue_status"] == "done")
        check("no child created", resolved["children"] == [])

        event = admin_ws.receive_json()
        check(
            "resolve broadcast -> admin (transaction_status_changed, completed)",
            event["type"] == "transaction_status_changed" and event["new_status"] == "completed",
            str(event),
        )

    jose_balance_after = get_customer(jose["id"])["net_balance"]
    check("net_balance untouched by exact-match flow", jose_balance_after == jose_balance_before, f"{jose_balance_before} -> {jose_balance_after}")

    logs = audit_log(tx["id"])
    check(
        "audit_log has creation + grab(payment) + pay(x2) + grab(releasing) + resolve(x2) = 7 entries",
        len(logs) == 7,
        f"{len(logs)} entries: {logs}",
    )
    record(f"  audit_log for tx {tx['id']}: {logs}")
    flow1_tx_id = tx["id"]

    # =====================================================================
    # FLOW 2 — Substandard walk-in, more, customer pays now
    # =====================================================================
    record("\n## FLOW 2 — Substandard walk-in, overage, pay_now")
    ana = customers["Ana Garcia"]
    ana_balance_before = ana["net_balance"]

    r = client.post(
        "/api/transactions",
        json={
            "customer_id": ana["id"],
            "customer_type": "walk_in",
            "items": [{"item_type": "product", "product_id": chicken_id, "estimated_weight_kg": "1.000", "unit_count": 1, "quantity_kg": "1.000", "unit_price": price}],
        },
        headers=auth("walk_in"),
    )
    tx = r.json()["data"]
    client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("payment"))
    r = client.post(
        f"/api/transactions/{tx['id']}/pay",
        json={"payments": [{"payment_method_id": CASH_ID, "amount": tx["total_due"], "tendered_amount": tx["total_due"]}]},
        headers=auth("payment"),
    )
    paid = r.json()["data"]
    client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("releasing"))

    item_id = paid["items"][0]["id"]
    r = client.post(
        f"/api/transactions/{tx['id']}/confirm-weight",
        json={"items": [{"transaction_item_id": item_id, "actual_weight_kg": "1.500"}]},
        headers=auth("releasing"),
    )
    confirmed = r.json()["data"]
    check("actual_amount == 330.00 (1.5kg * 220)", confirmed["actual_amount"] == "330.00", confirmed["actual_amount"])
    check("balance_due == 110.00", confirmed["balance_due"] == "110.00", confirmed["balance_due"])

    with client.websocket_connect(f"/ws/payment-queue?token={tokens['payment']}") as payment_ws:
        r = client.post(f"/api/transactions/{tx['id']}/resolve", json={"outcome": "pay_now"}, headers=auth("releasing"))
        resolved = r.json()["data"]
        check("resolve pay_now -> 200", r.status_code == 200)
        check("parent transaction_status == settled", resolved["transaction_status"] == "settled")
        check("parent queue_status == done", resolved["queue_status"] == "done")
        check("exactly one child created", len(resolved["children"]) == 1, resolved["children"])
        child = resolved["children"][0]
        check("child transaction_type == adjustment", child["transaction_type"] == "adjustment")
        check("child transaction_status == pending_payment", child["transaction_status"] == "pending_payment")
        check("child queue_status == waiting", child["queue_status"] == "waiting")
        check("child total_due == 110.00", child["total_due"] == "110.00", child["total_due"])
        check("child.parent_transaction_id == parent id", child["parent_transaction_id"] == tx["id"])

        event = payment_ws.receive_json()
        check(
            "child broadcast -> payment-queue (transaction_status_changed, pending_payment)",
            event["type"] == "transaction_status_changed" and event["transaction_id"] == child["id"] and event["new_status"] == "pending_payment",
            str(event),
        )

    check("customer net_balance untouched by pay_now (money moves via child payment)", get_customer(ana["id"])["net_balance"] == ana_balance_before)

    # pay off the child to close the loop
    client.post(f"/api/transactions/{child['id']}/grab", headers=auth("payment"))
    r = client.post(
        f"/api/transactions/{child['id']}/pay",
        json={"payments": [{"payment_method_id": CASH_ID, "amount": "110.00", "tendered_amount": "110.00"}]},
        headers=auth("payment"),
    )
    child_paid = r.json()["data"]
    check("child pay -> 200, transaction_status == completed (skips Releasing)", r.status_code == 200 and child_paid["transaction_status"] == "completed")
    check("child queue_status == done", child_paid["queue_status"] == "done")

    chain = client.get(f"/api/transactions/{tx['id']}/chain", headers=auth("admin")).json()["data"]
    chain_by_id = {t["id"]: t["transaction_status"] for t in chain}
    check("chain shows parent settled + child completed", chain_by_id == {tx["id"]: "settled", child["id"]: "completed"}, chain_by_id)

    parent_logs = audit_log(tx["id"])
    child_logs = audit_log(child["id"])
    record(f"  parent audit_log ({tx['id']}): {parent_logs}")
    record(f"  child audit_log ({child['id']}): {child_logs}")
    check(
        "parent audit_log complete (creation, grab, pay x2, grab, resolve x2 = 7)",
        len(parent_logs) == 7,
        len(parent_logs),
    )
    check(
        "child audit_log complete (creation, grab, pay x2 = 4 — skip_releasing means no releasing-grab)",
        len(child_logs) == 4,
        len(child_logs),
    )

    # =====================================================================
    # FLOW 3 — Substandard walk-in, more, customer saves as utang
    # =====================================================================
    record("\n## FLOW 3 — Substandard walk-in, overage, utang")
    ana_balance_before = get_customer(ana["id"])["net_balance"]
    check("Ana still has no credit going into flow 3", ana_balance_before == "0.00", ana_balance_before)

    r = client.post(
        "/api/transactions",
        json={
            "customer_id": ana["id"],
            "customer_type": "walk_in",
            "items": [{"item_type": "product", "product_id": chicken_id, "estimated_weight_kg": "1.000", "unit_count": 1, "quantity_kg": "1.000", "unit_price": price}],
        },
        headers=auth("walk_in"),
    )
    tx = r.json()["data"]
    client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("payment"))
    r = client.post(
        f"/api/transactions/{tx['id']}/pay",
        json={"payments": [{"payment_method_id": CASH_ID, "amount": tx["total_due"], "tendered_amount": tx["total_due"]}]},
        headers=auth("payment"),
    )
    paid = r.json()["data"]
    client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("releasing"))
    item_id = paid["items"][0]["id"]
    r = client.post(
        f"/api/transactions/{tx['id']}/confirm-weight",
        json={"items": [{"transaction_item_id": item_id, "actual_weight_kg": "1.400"}]},
        headers=auth("releasing"),
    )
    confirmed = r.json()["data"]
    check("balance_due == 88.00", confirmed["balance_due"] == "88.00", confirmed["balance_due"])

    with client.websocket_connect(f"/ws/admin?token={tokens['admin']}") as admin_ws:
        r = client.post(f"/api/transactions/{tx['id']}/resolve", json={"outcome": "utang"}, headers=auth("releasing"))
        resolved = r.json()["data"]
        check("resolve utang -> 200", r.status_code == 200)
        check("transaction_status == settled", resolved["transaction_status"] == "settled")
        check("queue_status == done", resolved["queue_status"] == "done")
        check("no child created", resolved["children"] == [])

        event = admin_ws.receive_json()
        check("resolve broadcast -> admin (settled)", event["new_status"] == "settled", str(event))

    ana_after = get_customer(ana["id"])
    check("net_balance decreased by 88.00 (0 -> -88.00)", ana_after["net_balance"] == "-88.00", ana_after["net_balance"])
    ledger_entry = next(e for e in ana_after["ledger_entries"] if e["transaction_id"] == tx["id"])
    check("ledger entry_type == balance_added", ledger_entry["entry_type"] == "balance_added", ledger_entry)
    check("ledger amount == 88.00", ledger_entry["amount"] == "88.00", ledger_entry)
    check("ledger running_balance == -88.00", ledger_entry["running_balance"] == "-88.00", ledger_entry)

    logs = audit_log(tx["id"])
    record(f"  audit_log for tx {tx['id']}: {logs}")
    check(
        "audit_log complete (creation, grab-payment, pay x2, grab-releasing, resolve x2 = 7)",
        len(logs) == 7,
        len(logs),
    )

    # =====================================================================
    # FLOW 4 — Substandard walk-in, less, save as credit
    # =====================================================================
    record("\n## FLOW 4 — Substandard walk-in, shortage, save_credit")
    juan = customers["Juan Dela Cruz"]
    juan_balance_before = juan["net_balance"]
    check("Juan starts with no utang/credit", juan_balance_before == "0.00", juan_balance_before)

    r = client.post(
        "/api/transactions",
        json={
            "customer_id": juan["id"],
            "customer_type": "walk_in",
            "items": [{"item_type": "product", "product_id": chicken_id, "estimated_weight_kg": "2.000", "unit_count": 1, "quantity_kg": "2.000", "unit_price": price}],
        },
        headers=auth("walk_in"),
    )
    tx = r.json()["data"]
    client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("payment"))
    r = client.post(
        f"/api/transactions/{tx['id']}/pay",
        json={"payments": [{"payment_method_id": CASH_ID, "amount": tx["total_due"], "tendered_amount": tx["total_due"]}]},
        headers=auth("payment"),
    )
    paid = r.json()["data"]
    client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("releasing"))
    item_id = paid["items"][0]["id"]
    r = client.post(
        f"/api/transactions/{tx['id']}/confirm-weight",
        json={"items": [{"transaction_item_id": item_id, "actual_weight_kg": "1.000"}]},
        headers=auth("releasing"),
    )
    confirmed = r.json()["data"]
    check("balance_due == -220.00", confirmed["balance_due"] == "-220.00", confirmed["balance_due"])

    with client.websocket_connect(f"/ws/admin?token={tokens['admin']}") as admin_ws:
        r = client.post(f"/api/transactions/{tx['id']}/resolve", json={"outcome": "save_credit"}, headers=auth("releasing"))
        resolved = r.json()["data"]
        check("resolve save_credit -> 200", r.status_code == 200)
        check("transaction_status == settled", resolved["transaction_status"] == "settled")
        check("queue_status == done", resolved["queue_status"] == "done")
        check("no child created", resolved["children"] == [])

        event = admin_ws.receive_json()
        check("resolve broadcast -> admin (settled)", event["new_status"] == "settled", str(event))

    juan_after = get_customer(juan["id"])
    check("net_balance increased by 220.00 (0 -> 220.00)", juan_after["net_balance"] == "220.00", juan_after["net_balance"])
    ledger_entry = next(e for e in juan_after["ledger_entries"] if e["transaction_id"] == tx["id"])
    check("ledger entry_type == credit_added", ledger_entry["entry_type"] == "credit_added", ledger_entry)
    check("ledger amount == 220.00", ledger_entry["amount"] == "220.00", ledger_entry)
    check("ledger running_balance == 220.00", ledger_entry["running_balance"] == "220.00", ledger_entry)

    logs = audit_log(tx["id"])
    record(f"  audit_log for tx {tx['id']}: {logs}")
    check(
        "audit_log complete (creation, grab-payment, pay x2, grab-releasing, resolve x2 = 7)",
        len(logs) == 7,
        len(logs),
    )

    # =====================================================================
    # FLOW 5 — Walk-in with existing balance settled at Walk-In
    # =====================================================================
    record("\n## FLOW 5 — Existing balance settled at Walk-In alongside a new order")
    maria = customers["Maria Santos"]
    maria_balance_before = maria["net_balance"]
    check("Maria starts with -150.00 utang", maria_balance_before == "-150.00", maria_balance_before)

    r = client.post(
        "/api/transactions",
        json={
            "customer_id": maria["id"],
            "customer_type": "walk_in",
            "items": [
                {"item_type": "product", "product_id": chicken_id, "estimated_weight_kg": "1.000", "unit_count": 1, "quantity_kg": "1.000", "unit_price": price},
                {"item_type": "balance_settlement", "reference_transaction_id": flow1_tx_id},
            ],
            "balance_settled": "150.00",
        },
        headers=auth("walk_in"),
    )
    tx = r.json()["data"]
    check("create -> 201", r.status_code == 201)
    check("estimated_amount == 220.00 (product only)", tx["estimated_amount"] == "220.00", tx["estimated_amount"])
    check("total_due == 370.00 (220 + 150 balance_settled)", tx["total_due"] == "370.00", tx["total_due"])

    maria_at_creation = get_customer(maria["id"])
    check("net_balance updated at CREATION, before payment (-150 -> 0.00)", maria_at_creation["net_balance"] == "0.00", maria_at_creation["net_balance"])
    settle_entry = next(e for e in maria_at_creation["ledger_entries"] if e["transaction_id"] == tx["id"])
    check("ledger entry_type == balance_settled", settle_entry["entry_type"] == "balance_settled", settle_entry)
    check("ledger amount == 150.00", settle_entry["amount"] == "150.00", settle_entry)

    client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("payment"))
    r = client.post(
        f"/api/transactions/{tx['id']}/pay",
        json={"payments": [{"payment_method_id": CASH_ID, "amount": "370.00", "tendered_amount": "370.00"}]},
        headers=auth("payment"),
    )
    paid = r.json()["data"]
    check("pay full combined total (370.00) -> 200", r.status_code == 200)
    check("transaction_status == pending_settlement", paid["transaction_status"] == "pending_settlement")

    client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("releasing"))
    item_id = next(i["id"] for i in paid["items"] if i["item_type"] == "product")
    r = client.post(
        f"/api/transactions/{tx['id']}/confirm-weight",
        json={"items": [{"transaction_item_id": item_id, "actual_weight_kg": "1.000"}]},
        headers=auth("releasing"),
    )
    confirmed = r.json()["data"]
    check("balance_due == 0.00", confirmed["balance_due"] == "0.00", confirmed["balance_due"])

    r = client.post(f"/api/transactions/{tx['id']}/resolve", json={"outcome": "pay_now"}, headers=auth("releasing"))
    resolved = r.json()["data"]
    check("resolve -> completed", resolved["transaction_status"] == "completed" and resolved["queue_status"] == "done")

    check("net_balance unchanged by payment/releasing (still 0.00)", get_customer(maria["id"])["net_balance"] == "0.00")

    logs = audit_log(tx["id"])
    record(f"  audit_log for tx {tx['id']}: {logs}")
    check(
        "audit_log complete (creation, grab-payment, pay x2, grab-releasing, resolve x2 = 7)",
        len(logs) == 7,
        len(logs),
    )

    # =====================================================================
    # FLOW 6 — Balance settlement only (no new order)
    # =====================================================================
    record("\n## FLOW 6 — Balance settlement only, no new order")
    jose_before = get_customer(jose["id"])
    check("Jose still has -75.50 utang (untouched by flow 1)", jose_before["net_balance"] == "-75.50", jose_before["net_balance"])

    r = client.post(
        "/api/transactions",
        json={
            "customer_id": jose["id"],
            "customer_type": "walk_in",
            "items": [{"item_type": "balance_settlement", "reference_transaction_id": flow1_tx_id}],
            "balance_settled": "75.50",
        },
        headers=auth("walk_in"),
    )
    tx = r.json()["data"]
    check("create -> 201", r.status_code == 201)
    check("estimated_amount == 0.00 (no product items)", tx["estimated_amount"] == "0.00", tx["estimated_amount"])
    check("total_due == 75.50", tx["total_due"] == "75.50", tx["total_due"])
    check("transaction_status == pending_payment (still walk_in flow)", tx["transaction_status"] == "pending_payment")
    check("no product items on this transaction", all(i["item_type"] == "balance_settlement" for i in tx["items"]))

    jose_at_creation = get_customer(jose["id"])
    check("net_balance settled at creation (-75.50 -> 0.00)", jose_at_creation["net_balance"] == "0.00", jose_at_creation["net_balance"])

    client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("payment"))

    with client.websocket_connect(f"/ws/releasing-queue?token={tokens['releasing']}") as releasing_ws:
        with client.websocket_connect(f"/ws/admin?token={tokens['admin']}") as admin_ws:
            r = client.post(
                f"/api/transactions/{tx['id']}/pay",
                json={"payments": [{"payment_method_id": CASH_ID, "amount": "75.50", "tendered_amount": "75.50"}]},
                headers=auth("payment"),
            )
            paid = r.json()["data"]
            check("pay -> 200", r.status_code == 200)
            check("transaction_status == completed DIRECTLY (no Releasing)", paid["transaction_status"] == "completed", paid["transaction_status"])
            check("queue_status == done", paid["queue_status"] == "done")

            admin_event = admin_ws.receive_json()
            check(
                "payment broadcast -> admin only (completed)",
                admin_event["type"] == "transaction_status_changed" and admin_event["new_status"] == "completed",
                str(admin_event),
            )

            # prove releasing-queue got nothing for this transaction: round-trip a ping
            releasing_ws.send_text("ping")
            pong = releasing_ws.receive_text()
            check("releasing-queue received nothing (ping/pong round-trips cleanly)", pong == "pong", pong)

    logs = audit_log(tx["id"])
    record(f"  audit_log for tx {tx['id']}: {logs}")
    check("audit_log complete (creation, grab-payment, pay x2 = 4, no releasing step)", len(logs) == 4, len(logs))

    # =====================================================================
    # FLOW 7 — Online customer flow
    # =====================================================================
    record("\n## FLOW 7 — Online customer flow")
    pedro = customers["Pedro Reyes"]
    pedro_balance_before = pedro["net_balance"]

    with client.websocket_connect(f"/ws/releasing-queue?token={tokens['releasing']}") as releasing_ws:
        r = client.post(
            "/api/transactions",
            json={
                "customer_id": pedro["id"],
                "customer_type": "online",
                "items": [{"item_type": "product", "product_id": chicken_id, "estimated_weight_kg": "1.000", "unit_count": 1, "quantity_kg": "1.000", "unit_price": price}],
            },
            headers=auth("walk_in"),
        )
        tx = r.json()["data"]
        check("create -> 201", r.status_code == 201)
        check("transaction_status == pending_settlement (online skips straight to Releasing)", tx["transaction_status"] == "pending_settlement")
        check("queue_status == waiting", tx["queue_status"] == "waiting")

        event = releasing_ws.receive_json()
        check(
            "creation broadcast -> releasing-queue (pending_settlement)",
            event["type"] == "transaction_status_changed" and event["new_status"] == "pending_settlement",
            str(event),
        )

    r = client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("releasing"))
    check("releasing grab -> 200, queue_status processing", r.status_code == 200 and r.json()["data"]["queue_status"] == "processing")

    with client.websocket_connect(f"/ws/payment-queue?token={tokens['payment']}") as payment_ws:
        r = client.post(f"/api/transactions/{tx['id']}/confirm-ready", headers=auth("releasing"))
        ready = r.json()["data"]
        check("confirm-ready -> 200", r.status_code == 200)
        check("transaction_status == pending_payment", ready["transaction_status"] == "pending_payment", ready["transaction_status"])
        check("queue_status == waiting", ready["queue_status"] == "waiting", ready["queue_status"])
        check("actual_amount == estimated_amount (220.00, no weight variance)", ready["actual_amount"] == ready["estimated_amount"] == "220.00", ready)
        check("processing_by_user_id cleared", ready["processing_by_user_id"] is None)
        check("releasing_user_id / releasing_at recorded", ready["releasing_user_id"] is not None and ready["releasing_at"] is not None)

        event = payment_ws.receive_json()
        check(
            "confirm-ready broadcast -> payment-queue (transaction_status_changed, pending_payment)",
            event["type"] == "transaction_status_changed" and event["new_status"] == "pending_payment",
            str(event),
        )

    # confirm-ready must not work a second time (already moved past pending_settlement)
    r = client.post(f"/api/transactions/{tx['id']}/confirm-ready", headers=auth("releasing"))
    check("confirm-ready again -> 409 (no longer pending_settlement)", r.status_code == 409, r.text)

    # resolve_substandard must refuse an online transaction still sitting at
    # pending_settlement — exercised here on a second online transaction, since
    # this one has already moved past that stage
    r2 = client.post(
        "/api/transactions",
        json={
            "customer_id": pedro["id"],
            "customer_type": "online",
            "items": [{"item_type": "product", "product_id": chicken_id, "estimated_weight_kg": "1.000", "unit_count": 1, "quantity_kg": "1.000", "unit_price": price}],
        },
        headers=auth("walk_in"),
    )
    tx_guard = r2.json()["data"]
    client.post(f"/api/transactions/{tx_guard['id']}/grab", headers=auth("releasing"))
    r2 = client.post(f"/api/transactions/{tx_guard['id']}/resolve", json={"outcome": "pay_now"}, headers=auth("releasing"))
    check(
        "resolve on online+pending_settlement -> 400 (must use confirm-ready instead)",
        r2.status_code == 400 and "confirm-ready" in r2.json()["error"],
        r2.text,
    )

    r = client.post(f"/api/transactions/{tx['id']}/grab", headers=auth("payment"))
    check("payment grab -> 200, queue_status processing", r.status_code == 200 and r.json()["data"]["queue_status"] == "processing")

    with client.websocket_connect(f"/ws/admin?token={tokens['admin']}") as admin_ws:
        r = client.post(
            f"/api/transactions/{tx['id']}/pay",
            json={"payments": [{"payment_method_id": GCASH_ID, "amount": "220.00", "ref_number": "GC-ONLINE-0007"}]},
            headers=auth("payment"),
        )
        paid = r.json()["data"]
        check("pay with online ref number -> 200", r.status_code == 200)
        check("transaction_status == completed", paid["transaction_status"] == "completed", paid["transaction_status"])
        check("queue_status == done", paid["queue_status"] == "done", paid["queue_status"])
        check("cash_tendered == 0.00 (fully online)", paid["cash_tendered"] == "0.00", paid["cash_tendered"])
        check("change_given == 0.00", paid["change_given"] == "0.00", paid["change_given"])
        check(
            "payment_detail recorded with ref_number",
            len(paid["payment_details"]) == 1
            and paid["payment_details"][0]["ref_number"] == "GC-ONLINE-0007"
            and paid["payment_details"][0]["payment_method_id"] == GCASH_ID,
            paid["payment_details"],
        )

        event = admin_ws.receive_json()
        check(
            "payment broadcast -> admin only (transaction_status_changed, completed)",
            event["type"] == "transaction_status_changed" and event["new_status"] == "completed",
            str(event),
        )

    check("customer.net_balance untouched by a clean online sale", get_customer(pedro["id"])["net_balance"] == pedro_balance_before)

    logs = audit_log(tx["id"])
    record(f"  audit_log for tx {tx['id']}: {logs}")
    check(
        "audit_log has full trail: creation, grab(releasing), confirm-ready(x2), grab(payment), pay(x2) = 7",
        len(logs) == 7,
        f"{len(logs)} entries: {logs}",
    )

    record("\nALL FLOW ASSERTIONS PASSED — Flow 7 online flow now fully closes without a gap")
