# Smoke Test Results

Run on 2026-07-07 against the live Docker stack (nginx + backend + postgres),
after seeding via `python -m app.core.seed` inside the `backend` container.

Seed data: 1 user per role (`walk_in_user`, `payment_user`, `releasing_user`,
`admin_user`, all password `password123`), 5 customers (mixed net_balance:
zero, negative/utang, positive/credit, missing address, missing contact
number), 8 products (chicken, pork, beef, realistic per-kg prices).

<!--
1. POST /api/auth/login with each of the 4 seeded users
   walk_in_user   -> 200, role_name=walk_in,   access_token present
   payment_user   -> 200, role_name=payment,   access_token present
   releasing_user -> 200, role_name=releasing, access_token present
   admin_user     -> 200, role_name=admin,     access_token present
   PASS - all 4 logins returned a valid token.

2. GET /api/customers with walk_in_user token
   -> 200, data = 5 customers (Ana Garcia, Jose Ramirez, Juan Dela Cruz,
      Maria Santos, Pedro Reyes)
   PASS - all 5 seeded customers returned.

3. GET /api/products with payment_user token (any authenticated role)
   -> 200, data = 8 products (Beef Brisket, Beef Cube Steak, Chicken Breast,
      Chicken Thigh, Ground Pork, Pork Belly, Pork Chop, Whole Chicken)
   PASS - all 8 seeded products returned.

4. POST /api/products with walk_in_user token
   -> 403 {"data": null, "error": "Not enough permissions"}
   PASS - write access correctly restricted to admin only.

5. WebSocket connect to /ws/payment-queue?token=<payment_user token>
   -> handshake accepted, ping -> pong received
   PASS - payment role connects to its own queue room.

6. WebSocket connect to /ws/releasing-queue?token=<walk_in_user token>
   -> connection closed with code 4003 (role not permitted for this room)
   PASS - wrong-role connection correctly rejected.

All 6 checks passed. No code changes were needed as a result of this pass -
auth, customers, products, and websocket routers all behave as built.
-->
