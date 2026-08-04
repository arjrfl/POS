"""Create throwaway LOADTEST_ customers and products via the real API.

Never targets anything but the local dev Docker Compose stack. Refuses to run
if loadtest_data.json already exists (run teardown_test_data.py first).
"""

import json
import sys
from pathlib import Path

import requests

BASE_URL = "http://localhost"
ADMIN_USERNAME = "admin_user"
ADMIN_PASSWORD = "password123"

DATA_FILE = Path(__file__).parent / "loadtest_data.json"

NUM_CUSTOMERS = 5
NUM_PRODUCTS = 10


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


def create_customer(token: str, index: int) -> dict:
    resp = requests.post(
        f"{BASE_URL}/api/customers",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "full_name": f"LOADTEST_Customer_{index}",
            "address": "LOADTEST — no real address",
            "contact_number": None,
        },
        timeout=10,
    )
    resp.raise_for_status()
    body = resp.json()
    if body["error"]:
        raise RuntimeError(f"Customer creation failed: {body['error']}")
    return body["data"]


def create_product(token: str, index: int) -> dict:
    resp = requests.post(
        f"{BASE_URL}/api/products",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "product_name": f"LOADTEST_Product_{index}",
            "brand_name": "LOADTEST",
            "unit_weight_kg": "1.000",
            # admin role requires unit_price_php > 0 — arbitrary but realistic price
            "unit_price_php": "150.00",
            # very large so stock never runs out and no real product is ever touched
            "stock_quantity": "999999",
        },
        timeout=10,
    )
    resp.raise_for_status()
    body = resp.json()
    if body["error"]:
        raise RuntimeError(f"Product creation failed: {body['error']}")
    return body["data"]


def main() -> None:
    if DATA_FILE.exists():
        print(
            f"{DATA_FILE} already exists — refusing to run. "
            "Run teardown_test_data.py first to clean up any prior load test data."
        )
        sys.exit(1)

    print(f"Logging in as {ADMIN_USERNAME}...")
    token = login()

    print(f"Creating {NUM_CUSTOMERS} throwaway customers...")
    customers = [create_customer(token, i) for i in range(1, NUM_CUSTOMERS + 1)]

    print(f"Creating {NUM_PRODUCTS} throwaway products...")
    products = [create_product(token, i) for i in range(1, NUM_PRODUCTS + 1)]

    data = {
        "customer_ids": [c["id"] for c in customers],
        "product_ids": [p["id"] for p in products],
        "products": [
            {
                "id": p["id"],
                "unit_price_php": str(p["unit_price_php"]),
                "unit_weight_kg": str(p["unit_weight_kg"]),
            }
            for p in products
        ],
    }
    DATA_FILE.write_text(json.dumps(data, indent=2))

    print(f"\nCreated {len(customers)} customers: {data['customer_ids']}")
    print(f"Created {len(products)} products: {data['product_ids']}")
    print(f"Wrote {DATA_FILE}")


if __name__ == "__main__":
    main()
