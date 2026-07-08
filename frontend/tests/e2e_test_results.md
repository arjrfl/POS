# End-to-End Test Results — Full Docker Stack

Run on 2026-07-07/08 against the full 4-container `docker compose` stack
(nginx + backend + postgres + backup), built and started fresh per the
steps below, using the existing seed data (4 role users, 5 customers, 8+
products) already persisted in the `pgdata` volume. Browser verification
used a temporary Playwright install (not saved to `package.json`, fully
removed afterward) driving real Chromium against `http://localhost` (port
80, through nginx) — no dev server involved.

## 1. `nginx.conf`

Written at the project root exactly as specified (SPA fallback on `/`,
`/api/` proxy, `/ws/` proxy with `Upgrade`/`Connection` headers and a
3600s read timeout). `docker-compose.yml` already mounted it to
`/etc/nginx/conf.d/default.conf` — no compose changes needed. **The file
was previously empty (0 bytes)**, found and flagged (not fixed) during an
earlier session; this is the actual fix.

## 2. Production build

```
cd frontend && npm run build
```

Succeeded in ~1s, 124 modules transformed. `dist/` confirmed present with
`index.html`, `assets/` (JS/CSS/logo), `manifest.webmanifest`, and the PWA
service worker files (`sw.js`, `workbox-*.js`, `registerSW.js`).

## 3–4. Docker stack

```
docker compose down       # removed 4 containers + network, pgdata volume untouched
docker compose up --build -d
docker compose ps
```

All 4 containers came up clean, no restart loops, no errors in any
container's logs:

| Container | Status |
|---|---|
| `lash-meatshop-pos-nginx-1` | Up |
| `lash-meatshop-pos-backend-1` | Up |
| `lash-meatshop-pos-postgres-1` | Up (existing data preserved — "Skipping initialization") |
| `lash-meatshop-pos-backup-1` | Up |

(`docker compose ps` reports plain "Up" rather than "healthy" — the
compose file has no `HEALTHCHECK`/`healthcheck:` directives defined, so
there's no formal health state to report. Verified actual health
functionally instead: `curl http://localhost/` → 200, `curl
http://localhost/api/health` → `{"status":"ok",...}`, and a full login
round-trip through the nginx proxy — see below.)

## 5. Browser verification

All 9 checklist items **PASSED**. Two persistent, non-reloaded browser
tabs (Payment and Releasing) were kept open throughout specifically to
prove "updates live, no refresh" rather than just asserting on a
post-reload state.

| # | Check | Result |
|---|---|---|
| 1 | Login page loads with logo and green branding | ✅ Logo image present, "Lash Meatshop POS" heading in green, green "Log in" button |
| 2 | Login works for all 4 roles | ✅ `walk_in_user`, `payment_user`, `releasing_user`, `admin_user` all authenticated successfully |
| 3 | Each role lands on their correct page | ✅ `/walkin`, `/payment`, `/releasing`, `/admin` respectively |
| 4 | Walk-In creates a transaction → appears in Payment queue | ✅ Created `TXN-20260707-0016` (Pedro Reyes, Chicken Breast) |
| 5 | Payment queue updates live (no refresh) | ✅ New transaction appeared in the **already-open** Payment tab within ~1s, no reload |
| 6 | Payment processes → appears in Releasing queue | ✅ Cash payment for exact total; transaction appeared in the **already-open** Releasing tab live |
| 7 | Releasing confirms weight and completes | ✅ Exact-weight match → auto-resolved to `completed` |
| 8 | Admin dashboard shows the completed transaction | ✅ "Transactions Today" incremented, `TXN-20260707-0016` listed as `Completed` in Recent Transactions |
| 9 | WebSocket reconnects after killing/restarting the backend | ✅ See below |

### WebSocket reconnect — detail

1. `docker kill lash-meatshop-pos-backend-1` while the Payment tab's
   socket was live.
2. Browser console immediately logged the expected connection failure
   (`WebSocket handshake: Unexpected response code: 502` — nginx
   correctly reporting it has nothing to proxy to; this is the *correct*
   failure mode, not a bug).
3. `docker start lash-meatshop-pos-backend-1`, waited for
   `/api/health` to respond again, then gave the client's exponential
   backoff (`useWebSocket.js`, 1s → 2s → ... capped at 30s) a few more
   seconds.
4. Created a second Walk-In transaction (`TXN-20260707-0017`, Maria
   Santos, Pork Belly) **without touching the Payment tab at all** — it
   appeared in that same tab within seconds, proving the socket
   reconnected and resumed receiving live events on its own, exactly as
   `useWebSocket.js`'s reconnect loop is designed to do.

The three `WebSocket handshake ... 502` console errors captured during
this test (one each for the Payment, Releasing, and Admin tabs, all of
which had a room subscription open when the backend was killed) are
**expected and benign** — they're the disconnect being correctly
detected, immediately before the reconnect logic took over. No other
console errors or page errors occurred anywhere in the run.

## Issues found

- **`nginx.conf` was empty** before this task (0 bytes) — this is what
  step 1 fixes. Flagged in an earlier session's notes, not fixed until
  now since it was out of scope for that task.
- No other issues found. All 9 checklist items pass; zero unexpected
  console/page errors across 4 concurrent authenticated sessions plus a
  live backend outage/recovery cycle.
