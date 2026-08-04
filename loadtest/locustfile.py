"""Locust load test for the Lash Meatshop POS backend.

Targets the LOCAL dev Docker Compose stack (nginx on http://localhost) ONLY —
never staging, never the production server. Run setup_test_data.py first.

Safety note: the local dev stack is not an isolated sandbox — a real browser
session may be open against it concurrently (seed users, seed products, real
customers). Every queue interaction below (grab/pay/confirm-weight/confirm-
ready/resolve/complete-exact) is filtered to transactions whose customer_id
is one of the LOADTEST_ customers created by setup_test_data.py, so this load
test can never grab, pay, or otherwise mutate a real transaction sitting in
a shared queue.

See README.md for usage.
"""

import itertools
import json
import random
import time
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlparse

import gevent
import websocket
from locust import HttpUser, between, events, task

DATA_FILE = Path(__file__).parent / "loadtest_data.json"

LOADTEST_DATA: dict = {}

RECEIVER_USERNAMES = itertools.cycle(["receiver_user", "receiver_user2", "receiver_user3"])
PAYMENT_USERNAMES = itertools.cycle(["payment_user", "payment_user2", "payment_user3"])
RELEASING_USERNAMES = itertools.cycle(["releasing_user", "releasing_user2", "releasing_user3"])

PASSWORD = "password123"

# Cached after first lookup — payment_method table never changes mid-run
_PAYMENT_METHOD_IDS: dict[str, int] = {}


@events.test_start.add_listener
def load_loadtest_data(environment, **kwargs):
    if not DATA_FILE.exists():
        raise RuntimeError(
            f"{DATA_FILE} not found — run setup_test_data.py before starting the load test."
        )
    global LOADTEST_DATA
    LOADTEST_DATA = json.loads(DATA_FILE.read_text())


class WSLoadClient:
    """Recv-only WS client — matches real usage: the frontend never sends
    anything after connect, it only receives broadcasts (see CLAUDE.md's
    WebSocket Rooms section). Every received message is reported to Locust
    as a "WS recv:<room>" line, right alongside the HTTP request lines."""

    def __init__(self, environment, room, token, host="localhost"):
        self.environment = environment
        self.room = room
        self.ws = websocket.create_connection(
            f"ws://{host}/ws/{room}?token={token}", timeout=10
        )
        self.greenlet = gevent.spawn(self._listen_loop)

    def _listen_loop(self):
        while True:
            start = time.time()
            try:
                msg = self.ws.recv()
                self.environment.events.request.fire(
                    request_type="WS",
                    name=f"recv:{self.room}",
                    response_time=(time.time() - start) * 1000,
                    response_length=len(msg),
                    exception=None,
                )
            except Exception as e:
                self.environment.events.request.fire(
                    request_type="WS",
                    name=f"recv:{self.room}",
                    response_time=0,
                    response_length=0,
                    exception=e,
                )
                return

    def close(self):
        gevent.kill(self.greenlet)
        try:
            self.ws.close()
        except Exception:
            pass


def get_payment_method_id(user: "BaseAuthUser", name: str) -> int | None:
    if name in _PAYMENT_METHOD_IDS:
        return _PAYMENT_METHOD_IDS[name]
    resp = user.authed_request("GET", "/api/payment-methods", name="/api/payment-methods")
    body = resp.json()
    if body.get("error"):
        return None
    for method in body["data"]:
        _PAYMENT_METHOD_IDS[method["payment_method_name"]] = method["id"]
    return _PAYMENT_METHOD_IDS.get(name)


class BaseAuthUser(HttpUser):
    abstract = True
    username_cycle: "itertools.cycle" = None
    ws_room: str | None = None

    def on_start(self):
        self.username = next(self.username_cycle)
        self.token = None
        self._login()
        self.ws_client = None
        if self.ws_room:
            ws_host = urlparse(self.host).netloc or urlparse(self.host).path
            self.ws_client = WSLoadClient(self.environment, self.ws_room, self.token, host=ws_host)

    def on_stop(self):
        if self.ws_client:
            self.ws_client.close()

    def _login(self):
        resp = self.client.post(
            "/api/auth/login",
            json={"username": self.username, "password": PASSWORD},
            name="/api/auth/login",
        )
        body = resp.json()
        if body.get("error"):
            raise RuntimeError(f"login failed for {self.username}: {body['error']}")
        self.token = body["data"]["access_token"]

    def authed_request(self, method, url, *, name=None, expected_extra_statuses=(), **kwargs):
        """Wraps self.client.request with the Authorization header, sliding-JWT
        token refresh (see CLAUDE.md Session Management), and explicit success/
        failure marking so expected non-2xx outcomes (e.g. a 409 lost queue-grab
        race under concurrent load) don't pollute the failure rate.

        Locust's catch_response, when left unmarked, still falls back to
        raise_for_status()-based pass/fail (see clients.py ResponseContextManager.
        __exit__) — success()/failure() must always be called explicitly, or an
        expected non-2xx status will be counted as a failure anyway."""
        headers = kwargs.pop("headers", {}) or {}
        headers["Authorization"] = f"Bearer {self.token}"
        with self.client.request(
            method, url, headers=headers, name=name or url, catch_response=True, **kwargs
        ) as resp:
            refreshed = resp.headers.get("X-Refreshed-Token")
            if refreshed:
                self.token = refreshed
            if resp.status_code >= 400 and resp.status_code not in expected_extra_statuses:
                resp.failure(f"{method} {name or url} -> {resp.status_code}: {resp.text[:200]}")
            else:
                resp.success()
            return resp

    def loadtest_customer_ids(self) -> set[int]:
        return set(LOADTEST_DATA.get("customer_ids", []))


class ReceiverUser(BaseAuthUser):
    weight = 6
    wait_time = between(3, 10)
    username_cycle = RECEIVER_USERNAMES
    ws_room = None  # Receiver has no live queue of its own — no persistent WS

    @task(8)
    def create_walkin_transaction(self):
        self._create_transaction(customer_type="walk_in")

    @task(2)
    def create_online_transaction(self):
        self._create_transaction(customer_type="online")

    def _create_transaction(self, customer_type: str):
        if not LOADTEST_DATA:
            return

        customer_id = random.choice(LOADTEST_DATA["customer_ids"])
        products = random.sample(
            LOADTEST_DATA["products"], k=random.randint(1, min(3, len(LOADTEST_DATA["products"])))
        )

        items = []
        for product in products:
            unit_count = random.randint(1, 3)
            weight = round(random.uniform(0.5, 3.0), 3)
            items.append(
                {
                    "item_type": "product",
                    "product_id": product["id"],
                    "unit_count": unit_count,
                    "estimated_weight_kg": str(weight),
                    "quantity_kg": str(weight),
                    "unit_price": product["unit_price_php"],
                }
            )

        payload = {
            "customer_id": customer_id,
            "customer_type": customer_type,
            "transaction_type": "original",
            "items": items,
        }
        self.authed_request("POST", "/api/transactions", json=payload, name="/api/transactions [create]")

    # TODO: balance_settlement-only transactions deferred — needs a customer
    # with existing utang, adds setup complexity; revisit in a v2 if useful


class PaymentUser(BaseAuthUser):
    weight = 10
    wait_time = between(3, 10)
    username_cycle = PAYMENT_USERNAMES
    ws_room = "payment-queue"

    @task
    def list_queue(self):
        self.authed_request("GET", "/api/transactions", name="/api/transactions [payment queue]")

    @task
    def grab_and_pay(self):
        if not LOADTEST_DATA:
            return

        resp = self.authed_request("GET", "/api/transactions", name="/api/transactions [payment queue]")
        body = resp.json()
        if body.get("error"):
            return

        loadtest_ids = self.loadtest_customer_ids()
        candidates = [
            t
            for t in body["data"]["items"]
            if t["transaction_status"] == "pending_payment"
            and t["queue_status"] == "waiting"
            and t["customer_id"] in loadtest_ids
        ]
        if not candidates:
            return

        transaction = random.choice(candidates)
        transaction_id = transaction["id"]

        grab_resp = self.authed_request(
            "POST",
            f"/api/transactions/{transaction_id}/grab",
            name="/api/transactions/[id]/grab",
            expected_extra_statuses=(409,),
        )
        if grab_resp.status_code != 200:
            return  # lost the grab race to another payment user — expected under load

        cash_method_id = get_payment_method_id(self, "cash")
        if cash_method_id is None:
            return

        total_due = Decimal(str(transaction["total_due"]))
        payload = {
            "payments": [
                {
                    "payment_method_id": cash_method_id,
                    "amount": str(total_due),
                    "tendered_amount": str(total_due),
                }
            ],
            "amount_paid": str(total_due),
            "is_partial": False,
        }
        self.authed_request(
            "POST", f"/api/transactions/{transaction_id}/pay", json=payload, name="/api/transactions/[id]/pay"
        )

    # TODO: partial payment, Edit Items modal, balance/credit checkboxes, and
    # refund resolve-as-credit are deferred for a v2 — this v1 covers the core
    # grab -> pay-full happy path plus queue polling load


class ReleasingUser(BaseAuthUser):
    weight = 10
    wait_time = between(3, 10)
    username_cycle = RELEASING_USERNAMES
    ws_room = "releasing-queue"

    @task(3)
    def list_queue(self):
        self.authed_request("GET", "/api/transactions", name="/api/transactions [releasing queue]")

    @task(3)
    def grab_and_confirm_weight(self):
        self._grab_and_process(customer_type="walk_in")

    @task(1)
    def grab_and_confirm_ready(self):
        self._grab_and_process(customer_type="online")

    def _list_candidates(self, customer_type: str):
        resp = self.authed_request("GET", "/api/transactions", name="/api/transactions [releasing queue]")
        body = resp.json()
        if body.get("error"):
            return None, []

        loadtest_ids = self.loadtest_customer_ids()
        candidates = [
            t
            for t in body["data"]["items"]
            if t["transaction_status"] == "pending_settlement"
            and t["queue_status"] == "waiting"
            and t["customer_type"] == customer_type
            and t["customer_id"] in loadtest_ids
        ]
        return body, candidates

    def _grab_and_process(self, customer_type: str):
        if not LOADTEST_DATA:
            return

        _, candidates = self._list_candidates(customer_type)
        if not candidates:
            return

        transaction = random.choice(candidates)
        transaction_id = transaction["id"]

        grab_resp = self.authed_request(
            "POST",
            f"/api/transactions/{transaction_id}/grab",
            name="/api/transactions/[id]/grab",
            expected_extra_statuses=(409,),
        )
        if grab_resp.status_code != 200:
            return  # lost the grab race — expected under load

        if customer_type == "online":
            self.authed_request(
                "POST",
                f"/api/transactions/{transaction_id}/confirm-ready",
                name="/api/transactions/[id]/confirm-ready",
            )
            return

        # walk_in: confirm actual weight per item — mostly exact matches, with
        # an occasional small variance that gets sent to Payment for adjustment
        product_items = [item for item in transaction["items"] if item["item_type"] == "product"]
        is_exact = random.random() > 0.1  # ~90% exact, ~10% variance
        variance_index = None if is_exact else random.randrange(len(product_items))

        weight_items = []
        for index, item in enumerate(product_items):
            actual_quantity_kg = Decimal(str(item["quantity_kg"]))
            if index == variance_index:
                delta = Decimal(str(round(random.uniform(0.05, 0.2), 3)))
                actual_quantity_kg += delta if random.random() > 0.5 else -delta
            weight_items.append(
                {
                    "transaction_item_id": item["id"],
                    "actual_weight_kg": item.get("estimated_weight_kg"),
                    "actual_unit_count": item["unit_count"],
                    "actual_quantity_kg": str(actual_quantity_kg),
                }
            )

        self.authed_request(
            "POST",
            f"/api/transactions/{transaction_id}/confirm-weight",
            json={"items": weight_items},
            name="/api/transactions/[id]/confirm-weight",
        )

        if is_exact:
            self.authed_request(
                "POST",
                f"/api/transactions/{transaction_id}/complete-exact",
                name="/api/transactions/[id]/complete-exact",
            )
        else:
            self.authed_request(
                "POST",
                f"/api/transactions/{transaction_id}/resolve",
                json={"outcome": "send_to_payment"},
                name="/api/transactions/[id]/resolve",
            )

    # TODO: confirm-handover / complete-online final-handover steps and the
    # online pre-payment item-correction PATCH are deferred for v2


class AdminUser(BaseAuthUser):
    weight = 1
    wait_time = between(5, 15)
    username_cycle = itertools.cycle(["admin_user"])
    ws_room = "admin"

    @task
    def top_products(self):
        self.authed_request(
            "GET", "/api/admin/dashboard/top-products", name="/api/admin/dashboard/top-products"
        )

    @task
    def list_customers(self):
        self.authed_request("GET", "/api/customers", name="/api/customers")

    @task
    def transaction_history(self):
        self.authed_request("GET", "/api/transactions", name="/api/transactions [admin history]")
