@echo off
REM ============================================================================
REM launch-chrome-terminal.bat
REM
REM WHY --unsafely-treat-insecure-origin-as-secure is here:
REM   Chrome only allows a page to register a Service Worker on a "secure
REM   context" — HTTPS, or the special-cased http://localhost. This app is a
REM   Workbox PWA (see CLAUDE.md > Confirmed Stack / Frontend Deploy Notes)
REM   that in production is served over plain HTTP on http://meatshop.local
REM   and http://192.168.1.58 — neither of which is localhost. Plain HTTP
REM   (not self-signed HTTPS) was a deliberate choice to keep setup simple on
REM   this closed, offline LAN — see PROJECT_CONTEXT.md §13. Without this
REM   flag, Chrome silently refuses to register the service worker on those
REM   origins, which silently breaks the PWA's "LAN reconnect" queue
REM   rehydration behavior (see CLAUDE.md Frontend Rules) even though
REM   everything else in the app looks and works fine. This flag tells Chrome
REM   to trust exactly these origins as secure without needing real TLS.
REM   The origin list matches CORS_ALLOWED_ORIGINS from the CORS hardening
REM   work (see CLAUDE.md Deployment Status).
REM
REM   --user-data-dir is REQUIRED for the flag above to take effect at all —
REM   Chrome ignores --unsafely-treat-insecure-origin-as-secure when launched
REM   against the default profile. A dedicated profile directory also lays
REM   groundwork for the still-open Chrome kiosk-mode task (PROJECT_CONTEXT.md
REM   §13) — that setup can build on this same profile dir instead of
REM   starting from scratch.
REM
REM   This script is a standalone reference today, meant to be MERGED into
REM   whatever kiosk-mode launch shortcut eventually gets built and deployed
REM   to all 27 terminals — it is not meant to be run twice / stacked with a
REM   separate kiosk launcher once that exists.
REM ============================================================================

set "CHROME_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
set "USER_DATA_DIR=%LOCALAPPDATA%\MeatshopChromeKiosk"

REM Production hostname — NOT used on the dev laptop. Dev's http://localhost
REM already gets Chrome's built-in secure-context exemption for free, so this
REM flag/script has no effect there and is only needed on real terminals.
set "APP_URL=http://meatshop.local"

start "" "%CHROME_EXE%" ^
    --user-data-dir="%USER_DATA_DIR%" ^
    --unsafely-treat-insecure-origin-as-secure="http://meatshop.local,http://192.168.1.58" ^
    "%APP_URL%"
