"""Clean up all LOADTEST_ throwaway data created by setup_test_data.py.

Order (respects parent_transaction_id ON DELETE RESTRICT and
transaction_item.product_id ON DELETE RESTRICT — see schema.sql):
  1. Delete adjustment/refund CHILD transactions (raw SQL, last resort — no
     hard-delete transaction endpoint exists; scoped to exact IDs found via
     the real API, never a broader DELETE)
  2. Delete PARENT transactions (raw SQL, same scoping)
  3. Hard-delete the 10 loadtest products via DELETE /api/products/{id}
  4. Soft-delete the 5 loadtest customers via DELETE /api/customers/{id}
  5. Delete loadtest_data.json
  6. Re-verify zero remaining LOADTEST_ rows

Never touches seed users, seed products, real customers, or any
product.stock_quantity outside the 10 throwaway loadtest products.
"""

import json
import subprocess
import sys
from pathlib import Path

import requests

BASE_URL = "http://localhost"
ADMIN_USERNAME = "admin_user"
ADMIN_PASSWORD = "password123"

REPO_ROOT = Path(__file__).parent.parent
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
DATA_FILE = Path(__file__).parent / "loadtest_data.json"


def login() -> str:
    resp = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_USERNAME, "password": ADMIN_PASSWORD},
        timeout=10,
    )
    resp.raise_for_status()
    body = resp.json()
    if body["error"]:
        raise RuntimeError(f"Login failed: {body['error']}")
    return body["data"]["access_token"]


def get_all_transactions_for_customer(token: str, customer_id: int) -> list[dict]:
    all_txns: list[dict] = []
    page = 1
    while True:
        resp = requests.get(
            f"{BASE_URL}/api/transactions",
            headers={"Authorization": f"Bearer {token}"},
            params={
                "customer_id": customer_id,
                "include_payment_status": "true",
                "page": page,
                "page_size": 100,
            },
            timeout=10,
        )
        resp.raise_for_status()
        body = resp.json()
        if body["error"]:
            raise RuntimeError(f"Failed to list transactions for customer {customer_id}: {body['error']}")
        items = body["data"]["items"]
        all_txns.extend(items)
        if len(items) < 100:
            break
        page += 1
    return all_txns


def run_psql(sql: str) -> None:
    result = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(COMPOSE_FILE),
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "pos",
            "-d",
            "lash_meatshop_db",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            sql,
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"psql command failed:\n{result.stdout}\n{result.stderr}")
    print(result.stdout.strip())


def delete_transactions_by_id(ids: list[int]) -> None:
    if not ids:
        return
    # ids are ints sourced from our own prior API responses, not user input —
    # safe to interpolate directly into the IN (...) list
    id_list = ",".join(str(int(i)) for i in ids)
    run_psql(f"DELETE FROM sales_transaction WHERE id IN ({id_list});")


def delete_product(token: str, product_id: int) -> None:
    resp = requests.delete(
        f"{BASE_URL}/api/products/{product_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    resp.raise_for_status()
    body = resp.json()
    if body["error"]:
        raise RuntimeError(f"Failed to delete product {product_id}: {body['error']}")


def deactivate_customer(token: str, customer_id: int) -> None:
    resp = requests.delete(
        f"{BASE_URL}/api/customers/{customer_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=10,
    )
    resp.raise_for_status()
    body = resp.json()
    if body["error"]:
        raise RuntimeError(f"Failed to deactivate customer {customer_id}: {body['error']}")


def main() -> None:
    if not DATA_FILE.exists():
        print(f"{DATA_FILE} not found — nothing to tear down.")
        sys.exit(0)

    data = json.loads(DATA_FILE.read_text())
    customer_ids: list[int] = data["customer_ids"]
    product_ids: list[int] = data["product_ids"]

    print("Logging in as admin_user...")
    token = login()

    print(f"Finding all transactions for {len(customer_ids)} loadtest customers...")
    child_ids: list[int] = []
    parent_ids: list[int] = []
    for customer_id in customer_ids:
        for txn in get_all_transactions_for_customer(token, customer_id):
            if txn["parent_transaction_id"] is not None:
                child_ids.append(txn["id"])
            else:
                parent_ids.append(txn["id"])

    print(f"Found {len(child_ids)} child transactions, {len(parent_ids)} parent transactions.")

    print("Deleting child transactions (adjustment/refund)...")
    delete_transactions_by_id(child_ids)

    print("Deleting parent transactions...")
    delete_transactions_by_id(parent_ids)

    print(f"Hard-deleting {len(product_ids)} loadtest products...")
    for product_id in product_ids:
        delete_product(token, product_id)

    print(f"Soft-deleting {len(customer_ids)} loadtest customers...")
    for customer_id in customer_ids:
        deactivate_customer(token, customer_id)

    print("\nVerifying cleanup...")
    ok = True

    for customer_id in customer_ids:
        remaining = get_all_transactions_for_customer(token, customer_id)
        if remaining:
            print(f"  WARNING: customer {customer_id} still has {len(remaining)} transactions: "
                  f"{[t['id'] for t in remaining]}")
            ok = False

    resp = requests.get(
        f"{BASE_URL}/api/products",
        headers={"Authorization": f"Bearer {token}"},
        params={"search": "LOADTEST"},
        timeout=10,
    )
    resp.raise_for_status()
    remaining_products = resp.json()["data"]
    if remaining_products:
        print(f"  WARNING: {len(remaining_products)} LOADTEST products still exist: "
              f"{[p['id'] for p in remaining_products]}")
        ok = False

    for customer_id in customer_ids:
        resp = requests.get(
            f"{BASE_URL}/api/customers/{customer_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        customer = resp.json()["data"]
        if customer["customer_status"] != "inactive":
            print(f"  WARNING: customer {customer_id} is not inactive: {customer['customer_status']}")
            ok = False

    DATA_FILE.unlink()
    print(f"\nDeleted {DATA_FILE}")

    if ok:
        print(
            f"\nCleanup confirmed: 0 remaining transactions, 0 remaining LOADTEST products, "
            f"{len(customer_ids)} customers soft-deleted (inactive, as expected — no hard-delete "
            "customer endpoint exists)."
        )
    else:
        print("\nCleanup completed with warnings above — investigate before considering this done.")
        sys.exit(1)


if __name__ == "__main__":
    main()
