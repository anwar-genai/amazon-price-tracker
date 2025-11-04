# Amazon Price Tracker – Project Guide

This repo contains a backend, a Streamlit dashboard, and a Chrome extension that work together to track Amazon product prices and alert on drops.

## Extension (Chrome)

- Location: `extension/`
- Manifest: MV3

### Features implemented
- Popup
  - Detects current Amazon product (title/price/image) and lets you track it with an optional target price.
  - Shows tracked products from the backend; clicking opens the Amazon page.
  - “Already tracked ✓” state when a product is already in your list.
  - Update target price and Untrack actions per item.
  - Settings button to open Streamlit dashboard (default `http://localhost:8501`).
- Background service worker
  - Polls the backend on a configurable interval.
  - Toolbar badge shows count of items at/below target.
  - Optional notifications for price drops that deep-link to the product.
  - Context menu: right‑click → “Track this product” (page or link).
- Options page
  - Configure API Base URL, refresh interval (minutes), and notifications on/off (saved to `chrome.storage.sync`).
- URL handling
  - Canonicalizes Amazon URLs (strips query/hash) to avoid duplicates for the same ASIN.

### Quick start (local)
1. Backend running at `http://localhost:8000` (see Backend section).
2. Streamlit dashboard at `http://localhost:8501`.
3. Chrome → `chrome://extensions` → enable Developer mode → Load unpacked → select `extension/`.
4. Open an Amazon product page (`/dp/...`), open the popup, and track a product.

### Options
- In the extension card → Details → Extension options (or open `extension/options.html`).
  - API Base URL (default `http://localhost:8000/api`).
  - Refresh interval (default 30 minutes, min 1).
  - Enable notifications (default on).

### API endpoints used by the extension
- `GET  /api/products` → list
- `POST /api/products` body `{ url, target_price|null }`
- `PATCH /api/products/{id}` body `{ target_price|null }`
- `DELETE /api/products/{id}`
- `GET  /api/notifications` → list `{ id, title, message, url, image_url }[]`

If your backend differs, update `popup.js` and `background.js` accordingly.

### Supported Amazon domains
Configured in `manifest.json` under `content_scripts.matches` and `host_permissions` for popular regions (`.com`, `.co.uk`, `.de`, `.fr`, `.ca`, `.in`, `.com.au`, `.co.jp`, `.it`, `.es`, `.nl`, `.com.mx`, `.com.br`, `.com.tr`, `.ae`, `.sa`, `.sg`). Add more if needed.

### Packaging for the Web Store
- Zip only the contents of `extension/` (not the parent folder or backend).
- Ensure icons exist at 16/48/128 px and are PNG.
- Replace local API URL with your production HTTPS endpoint and update `host_permissions`.
- Provide screenshots, 128×128 icon, and privacy policy.

### Known limitations / caveats
- Product parsing relies on Amazon DOM selectors and may need updates for regional layouts.
- Streamlit dashboard doesn’t auto-push updates; use auto-refresh or SSE/WebSocket for live updates.
- Notifications depend on `GET /api/notifications` being populated by the backend.

### Future improvements (recommended)
1. Price history sparkline in the popup
   - Backend: add `GET /api/products/{id}/history` (date, price).
   - Frontend: render tiny sparkline (canvas) next to price; hover tooltip.
2. Currency and locale support
   - Detect region and format prices with `Intl.NumberFormat`.
   - Normalize prices to a base currency in backend to compare across regions (optional).
3. Options enhancements
   - Dashboard URL setting; toggle floating in‑page “Track Price” button.
   - Per-notification throttle and quiet hours.
4. URL canonicalization by ASIN
   - Extract ASIN and store as canonical key; dedupe by ASIN.
5. Better product detection
   - Add fallback selectors and a MutationObserver for dynamically changing prices.
6. i18n
   - `_locales/` strings for name/description/UI for key languages.
7. Telemetry (privacy‑respecting)
   - Anonymous error counts (on/off in Options) to improve stability.

---

## Backend
- Exposes REST endpoints listed above. Must handle CORS for the extension.
- Should persist products, current price, target price, and (optionally) history.
- `GET /api/notifications` can be generated when current price ≤ target price or via scheduled jobs.

## Streamlit Dashboard
- Visual management of tracked products and price trends.
- Consider adding auto-refresh (e.g., `streamlit-autorefresh`) to reflect new items without manual refresh.

## Development tips
- After changing scripts or manifest, Reload in `chrome://extensions`.
- Service worker logs: extension card → Service worker → Inspect.
- Test on multiple Amazon regions; verify CSS selectors and currency formatting.


