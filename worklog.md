# Ledgerly v2 Upgrade — Work Log

This file tracks all work done on the Ledgerly v2 feature upgrade build.
Target repo: `theExceptionalSam/ledgerly` (Express + Vite, NOT the Next.js sandbox).
Working directory: `/home/z/my-project/ledgerly-work/ledgerly/`

## Branding (extracted from provided zip)
- Ink/Primary (navy): `#14213D`
- Paper/background: `#F6F6F3`
- Ledger Green (paid): `#1B7A43`
- Ledger Amber (partial): `#C77D22`
- Ledger Red (outstanding): `#B3261E`
- Neutral (body text): `#5B5B54`
- Headings: Newsreader SemiBold (serif); Body/UI: Inter Medium (sans)
- App already uses this palette in `styles.css` — only "School Finance Tracker" → "Ledgerly" rename + logo assets needed.

## Codebase conventions
- Backend: CommonJS (`require`), `better-sqlite3` sync API, `db.prepare().run/all/get`, `recordAudit()` helper, `requireAuth`/`requireRole` middleware, express-validator, `Router()`.
- Frontend: React 18 hooks, `api` client (`get/post/put/del/upload/download`), `useAuth()` context, CSS classes (not Tailwind), `Modal` pattern, `naira()`/`statusMeta()`/`todayISO()` from `utils/format.js`.
- Repo paths: `ledgerly_backend/` and `ledgerly_frontend/` (NOT `backend/`/`frontend/` as spec text says — adapting to actual repo structure, keeping all SQL/routes/field names exactly as specified).

---
Task ID: util-termii
Agent: general-purpose
Task: Create a swappable messaging-provider interface for sending SMS/WhatsApp via Termii (Nigerian messaging API), with a `normalizePhone` helper and a facade `index.js` so callers don't depend on Termii directly.

Work Log:
1. Read `/home/z/my-project/worklog.md` to confirm CommonJS conventions and repo layout (`ledgerly_backend/src/...`, no axios/node-fetch, use built-in `fetch`).
2. Verified target backend dir exists: `ledgerly_backend/src/services` did not yet exist — created `ledgerly_backend/src/services/messaging/`.
3. Wrote `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/services/messaging/termii.js`:
   - `normalizePhone(input)`: trims, strips internal whitespace, strips leading `+`, strips leading `00`, and converts 11-digit Nigerian local numbers starting with `0` to `234…`. Returns plain international form (no `+`, no `00`).
   - `sendMessage({ to, channel, message })`:
     - Reads `TERMII_API_KEY` from `process.env`; throws `Error('TERMII_API_KEY is not configured')` if missing/empty (no network call attempted).
     - Reads `TERMII_SENDER_ID` for the SMS `from` field.
     - Builds Termii POST `/api/sms/send` body: SMS → `{ api_key, to, from, sms, type:'plain', channel:'generic' }`; WhatsApp → `{ api_key, to, sms, type:'plain', channel:'whatsapp' }`.
     - Uses `AbortController` with 15s timeout, `Content-Type: application/json`, built-in `fetch`.
     - Parses JSON; success when `code === 'ok'` or `message_id` present → returns `{ success: true, providerMessageId }`.
     - Non-ok HTTP or missing `message_id` → `{ success: false, error: response.message || 'Termii request failed' }`.
     - Network/abort errors caught → `{ success: false, error: err.message }` (timeout → 'Termii request timed out').
   - Exports `{ sendMessage, normalizePhone }`.
4. Wrote `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/services/messaging/index.js`:
   - `const termii = require('./termii');` and re-exports `sendMessage` + `normalizePhone`.
   - Comment: "Currently routes to Termii. Swap this file to change providers without touching callers."
5. Ran the required smoke test (no real API call). Output:
   - `normalize 0803: 2348031234567`
   - `normalize +234: 2348031234567`
   - `normalize 234: 2348031234567`
   - `no-key threw (expected): TERMII_API_KEY is not configured`
   All four expectations confirmed. No npm packages installed; no other files touched.

Stage Summary:
Two files created implementing the swappable Termii messaging provider:
- `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/services/messaging/termii.js` — provider implementation with `sendMessage` + `normalizePhone`.
- `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/services/messaging/index.js` — swappable facade re-exporting the Termii implementation.

Smoke test passes: phone normalization converts local `0803…`, `+234…`, and `234…` forms to `2348031234567`, and the missing-API-key path throws `TERMII_API_KEY is not configured` without making a network call. No real Termii API call was made. Callers can `require('./services/messaging')` and call `sendMessage(...)` / `normalizePhone(...)`; swapping providers only requires editing `index.js`. No other files (`.env`, `server.js`, routes, controllers) were modified; no packages installed.

---
Task ID: util-pdf
Agent: general-purpose
Task: Create a PDF receipt generator (`src/utils/receipt-pdf.js`) for school fee payments using pdfkit. Produce an A4 branded receipt with header band, billed-to block, details table (with amount-in-words), total band, and footer. Return a `Buffer` via a Promise.

Work Log:
1. Installed `pdfkit@0.15.2` in `ledgerly_backend/` (resolved from `^0.15.0`). npm emitted an allow-scripts warning for the pre-existing `better-sqlite3` postinstall (node-gyp); pdfkit itself is pure JS and installed cleanly. No script approval was required for pdfkit.
2. Verified the Naira sign (₦, U+20A6) does NOT render with pdfkit's built-in Helvetica — WinAnsi encoding silently substitutes it with the broken-bar `¦` (confirmed via `pdftotext` extraction). Built-in `Times-Bold` has the same limitation.
3. Located Unicode-capable TTF substitutes shipped on the host: `/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf` and `/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf`. Registered these with pdfkit (`doc.registerFont`) as `NairaSans-Bold` and `NairaSerif-Bold`, used ONLY on the two text runs that contain the ₦ symbol (the "Amount Paid (figures)" row and the green total band). Every other text run uses the spec'd built-in `Helvetica`/`Helvetica-Bold`/`Times-Roman`/`Times-Bold`. Verified via `pdftotext` that the ₦ now extracts correctly from the generated PDF.
4. Wrote `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/utils/receipt-pdf.js` (CommonJS). Exports `generateReceiptPdf({...})` returning `Promise<Buffer>`, plus the helpers `numberToWords`, `formatNaira`, `formatDate`, `capitalizeMethod` for reuse/testing.
   - `numberToWords(n)` handles 0–999,999,999 with proper "and"/hyphen rules; 0 → "Zero"; 15000 → "Fifteen Thousand"; amounts are suffixed with " Naira Only" at the call site.
   - `formatNaira(amount)` → "₦15,000" (thousands separators, no decimals).
   - `formatDate("2026-01-15")` → "15 Jan 2026" (parses Y/M/D directly to avoid UTC off-by-one).
   - `capitalizeMethod` maps cash/bank_transfer/pos/cheque/online (with a generic snake_case fallback).
   - Layout follows spec: 80pt navy header band with school name (Times-Bold 18pt), letter-spaced "OFFICIAL RECEIPT" (Helvetica 10pt), receipt number top-right (Helvetica-Bold 11pt); right-aligned date + term lines; navy 1pt rule; "BILLED TO" label; student name (Times-Bold 14pt); class/admission meta line; 6-row details table with 0.5pt pale row borders; light-tint total band with green Times-Bold 16pt amount; centered footer rule + italic disclaimer. A4 portrait, 50pt margins. Buffer collected via `doc.on('data')`/`'end'` and resolved on `doc.end()`.
5. Ran the prescribed smoke test. Generated `/tmp/test-receipt.pdf` (10,158 bytes, well above the 1,000-byte threshold). Verified with `pdftotext` that all expected content is present: school name, receipt number, "OFFICIAL RECEIPT", "Date: 15 Jan 2026", "Term: First Term", "BILLED TO", "Amaka Johnson", "Class: Primary 3 · Admission No: LHA/003/22", all six detail rows with values, "₦15,000" (Naira sign intact), "Fifteen Thousand Naira Only", "Cash", "TOTAL PAID ₦15,000", and the footer disclaimer. Also spot-checked helper edge cases (0, 15, 15000, 1234567, 999999999; all five method codes; thousands-separator formatting at 1,250,000).
6. No other files were touched. `package.json`/`package-lock.json` were updated only by `npm install pdfkit`.

Stage Summary:
- File created: `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/utils/receipt-pdf.js`
- pdfkit version installed: `0.15.2` (resolved from `^0.15.0`)
- Smoke test result: PDF generated successfully, **10,158 bytes** (threshold was >1,000). All expected text and the ₦ symbol verified via `pdftotext`.
- Deviation from spec (justified): built-in `Helvetica-Bold`/`Times-Bold` cannot encode the ₦ sign (U+20A6) — pdfkit substitutes it with `¦`. Two text runs (the figures row value and the total-band amount) therefore use registered DejaVu Sans/Serif Bold TTFs (`/usr/share/fonts/truetype/dejavu/`) as Unicode-capable stand-ins. Visually indistinguishable from Helvetica-Bold/Times-Bold at body sizes; all other text uses the spec'd built-in fonts.
- Next actions for downstream agents: wire `generateReceiptPdf` into the payments controller's receipt-download endpoint (likely `GET /api/payments/:id/receipt`) — it should fetch the payment + student + tenant + fee head + term + recorded-by user, build the options object, call `generateReceiptPdf(...)`, and stream the buffer back as `Content-Type: application/pdf` with `Content-Disposition: inline; filename="receipt-<receiptNumber>.pdf"`. Consider also attaching the buffer to the receipt email (nodemailer/resend) if/when that flow is built.

---
Task ID: main-build
Agent: orchestrator (Z.ai Code)
Task: Implement full Ledgerly v2 upgrade (Phases 0-6) + frontend + branding

Work Log:
- Phase 0: Created migrations/ folder + runner in db/index.js, migrations tracking table, pre-upgrade backup logic
- Phase 1: Migration 001 (terms), terms controller/routes, default term on school registration, me endpoint returns currentTerm
- Phase 2: Migrations 002 (fee_heads + student_fee_assignments) + 003 (payments fee_head_id/term_id), fee-heads controller/routes, student fee endpoints (GET/POST fees, POST discount), payments now require feeHeadId, dashboard term-scoped + assignment-based totals, default 7 fee heads seeded on registration
- Phase 3: Migration 004 (receipts), receipt PDF generator (pdfkit, subagent-built), receipts controller with idempotent receipt numbering, GET /payments/:paymentId/receipt route
- Phase 4: Bulk assign controller + route (POST /fee-heads/:id/bulk-assign)
- Phase 5: Migration 005 (reminders + tenant_messaging_settings), Termii messaging service (subagent-built), reminders controller (settings, send, bulk, list), bulk rate limiter (3/hour/tenant), reminders_enabled gate
- Phase 6: Migration 006 (DROP COLUMN fee_amount), removed fee_amount from createStudent + bulk upload, updated template, schema.sql is pre-upgrade snapshot
- Frontend: TermContext + TermSwitcher, Terms page, FeeHeads page (bulk-assign modal), MessagingSettings page, Dashboard/Students/Finance term-scoped, Students.jsx fee table + multi-line PaymentModal + receipt buttons + reminder button + reminder history tab, Layout branding (Ledgerly logo + name), App routes, API client openPdf helper, Google Fonts (Inter + Newsreader), branding assets
- Fixed: Resend SDK lazy-init (server crashed on empty API key), receipt PDF await (was returning Promise not Buffer), fee heads seeded on registration (migration seed only runs at migration time for existing tenants)
- Verified: All 6 migrations apply + idempotent, API tests pass (fee heads, assignments, discounts, payments, dashboard, receipts, bulk assign, messaging, rate limiter), frontend builds, Agent Browser confirms registration→verify→dashboard→students→fee table→payment→receipt all work

Stage Summary:
- 6 new migration files, 4 new backend controllers, 4 new route files, 1 PDF util, 1 messaging service
- 4 new frontend pages, 1 new context, 1 new component, API client extended
- All existing controllers/routes/pages updated for term-scoping + itemised fees
- Backend API fully verified via curl tests; frontend verified via Agent Browser (dashboard shows correct ₦70k/₦30k/₦40k figures, fee table renders per-head breakdown, naira symbol displays correctly)
- Ready to commit and push
