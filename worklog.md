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

---
Task ID: pg-misc
Agent: general-purpose
Task: Convert four controllers (dashboard, terms, fee-heads, receipts) from SQLite (better-sqlite3 sync) to PostgreSQL (pg async) using the new `db.query()` / `db.transaction()` API in `src/db/index.js`.

Work Log:
1. Read `/home/z/my-project/worklog.md` for conventions (CommonJS, `recordAudit` now async, `db.query` auto-converts `?` → `$N`).
2. Read all four target controllers + `src/db/index.js` + `src/utils/audit.js` to confirm the new API surface (async `query(sql, params, client?)` returning `{ rows, rowCount }`; async `transaction(async (client) => …)`; async `recordAudit(...)`).
3. Converted **dashboard.controller.js**: `getDashboard` → `async`. Five sequential lookups converted: current-term lookup (`.get` → `rows[0]`), fee totals aggregate (`.get`), collected sum (`.get`), per-student aggregate (`.all` → `rows`), and the two transactions-table sums (`.get`). All params wrapped in arrays. No `db.transaction()` use; no `recordAudit()` calls; no `datetime('now')` use. Result-shape preserved (`{ expected, collected, outstanding, studentCount, fullyPaid, partial, fullyOutstanding, otherIncome, expenditure, netPosition, termId }` and the zero-term early return).
4. Converted **terms.controller.js**: `listTerms`, `createTerm`, `setCurrentTerm` → all `async`.
   - `createTerm`: `db.transaction(() => {…})` → `await db.transaction(async (client) => {…})`; both inner `db.prepare().run()` calls converted to `await db.query(sql, [params], client)`. `recordAudit(...)` → `await recordAudit(...)`.
   - `setCurrentTerm`: term existence check via `.get` → `rows[0]`; the swap transaction converted the same way (two `UPDATE`s passed `client`). `recordAudit` awaited.
   - `listTerms`: `.all()` → `{ rows: terms }`.
5. Converted **fee-heads.controller.js**: `listFeeHeads`, `createFeeHead`, `deactivateFeeHead`, `bulkAssign` → all `async`.
   - `bulkAssign`: head/term existence checks via `.get` → `rows[0]`; students list via `.all` → `{ rows: students }`. The `db.transaction(() => { for (const s of students) {…} })` converted to `await db.transaction(async (client) => { for (const s of students) {…} })` with every inner `db.prepare().get()`/`.run()` rewritten as `await db.query(sql, [params], client)` — both the existence check, the conditional `UPDATE`, and the `INSERT`. `recordAudit` awaited.
   - `createFeeHead` + `deactivateFeeHead`: `.get`/`.run` converted; `recordAudit` awaited.
6. Converted **receipts.controller.js**: `buildReceiptNumber` + `issueReceipt` → `async`.
   - `buildReceiptNumber`: `.get(...).n` → `await db.query(...)` then `rows[0].n`.
   - `issueReceipt`: payment lookup (`.get` → `rows[0]`), tenant lookup (`.get` → `rows[0]`), idempotency check (`SELECT * FROM receipts` `.get` → `rows[0]`). The `db.transaction(() => {…})` for the insert converted to `await db.transaction(async (client) => {…})`: the re-check `SELECT` and the `INSERT` both use `client`. `recordAudit` awaited. `generateReceiptPdf` was already Promise-returning and the existing `.then()/.catch()` chain was preserved (so the response is sent after the buffer resolves) — no change needed there.
7. No SQL strings were rewritten — relied on `db.query`'s `convertPlaceholders` (`?` → `$N`). No `datetime('now')` use existed in any of these four files, so no `now()` substitutions were required.
8. Verified all four modules load: `DATABASE_URL="postgres://x:x@127.0.0.1:5432/x" DB_SSL=false node -e "require('./src/controllers/dashboard.controller'); require('./src/controllers/terms.controller'); require('./src/controllers/fee-heads.controller'); require('./src/controllers/receipts.controller'); console.log('All 4 OK')"`. Output: `All 4 OK`. (The follow-up `[db] Initialization failed: connect ECONNREFUSED 127.0.0.1:5432` is expected — there's no real Postgres in the sandbox; the `require()` calls themselves all succeed, which is the verification gate.)

Stage Summary:
- Four controllers converted in place, no path changes, no signature changes for callers (still `(req, res) =>`, now async):
  - `src/controllers/dashboard.controller.js` — `getDashboard` async; 5 sequential queries awaited.
  - `src/controllers/terms.controller.js` — `listTerms`/`createTerm`/`setCurrentTerm` async; 2 transactions converted; 3 `recordAudit` calls awaited.
  - `src/controllers/fee-heads.controller.js` — `listFeeHeads`/`createFeeHead`/`deactivateFeeHead`/`bulkAssign` async; bulk-assign transaction loop fully awaited with `client` passed to each inner query; 3 `recordAudit` calls awaited.
  - `src/controllers/receipts.controller.js` — `buildReceiptNumber`/`issueReceipt` async; idempotent insert transaction converted with `client`; 1 `recordAudit` awaited; PDF promise chain preserved.
- All SQL strings left as-is (`?` placeholders auto-converted by `db.query`).
- Verification: all four modules `require()` cleanly under a stub `DATABASE_URL`. No runtime DB calls exercised in the sandbox.
- Next actions: end-to-end smoke against a real Postgres instance (registration → term switch → fee-head bulk-assign → payment → receipt issue/PDF) to confirm the converted controllers behave identically to their SQLite predecessors; check that route handlers (in `src/routes/`) don't need to be made async-aware (Express handles async route returns fine as long as rejections are caught — none of these handlers throw unhandled rejections since `generateReceiptPdf`'s `.catch` is the only Promise chain, and it's already in place).

---
Task ID: pg-core
Agent: general-purpose
Task: Convert three controllers (students, payments, transactions) from SQLite (better-sqlite3 sync API) to PostgreSQL (pg async API), targeting the new `db.query()` / `db.transaction()` async API in `src/db/index.js`.

Work Log:
1. Read `/home/z/my-project/worklog.md` for context (CommonJS, better-sqlite3 sync → pg async migration in progress, `db.query()` auto-converts `?` to `$N`, `recordAudit()` is now async).
2. Read `src/db/index.js` to confirm the API surface: `db.query(sql, params, client?)` returns `{ rows, rowCount }`; `db.transaction(async (client) => {...})` releases the client on resolve/reject; the `convertPlaceholders` helper means SQL strings can keep their `?` placeholders unchanged.
3. Read `src/utils/audit.js` to confirm `recordAudit` is `async` and uses `$1..$8` placeholders already (its body was already migrated).
4. Converted `src/controllers/students.controller.js` (8 exported fns + 2 internal helpers):
   - `resolveTermId(tenantId, termId)` → `async`; `db.prepare(sql).get(tenantId)` → `const { rows } = await db.query(sql, [tenantId]); const current = rows[0];`.
   - `getStudentFeesInternal(tenantId, studentId, termId)` → `async`; the `.all(...).map(a => ({...}))` chain became `const { rows } = await db.query(sql, [...]); return rows.map(a => ({...}));`. All callers (`getStudentDetail`, `getStudentFees`) now `await` it.
   - `listStudents`, `createStudent`, `updateStudent`, `archiveStudent`, `getStudentDetail`, `getStudentFees`, `assignStudentFee`, `applyDiscount` → all `async`. Each `.prepare(sql).get(params)` became `const { rows } = await db.query(sql, [params]); const x = rows[0];`, each `.all(params)` became `const { rows } = await db.query(sql, [params]);`, each `.run(params)` became `await db.query(sql, [params]);`.
   - All 6 `recordAudit({...})` calls now `await`ed.
   - The complex `listStudents` SQL (with two correlated subqueries + outer WHERE, sharing `?` numbering) was left exactly as-is — `db.query`'s `convertPlaceholders` handles the `?` → `$1, $2, $3` rewrite.
   - `getStudentDetail` previously used a ternary `const payments = termId ? db.prepare(...).all(...) : [];`. Split into `let payments = []; if (termId) { ... }` to keep the `await` clean.
5. Converted `src/controllers/payments.controller.js` (2 exported fns):
   - `recordPayment` → `async`. Reads (student/head/term/idempotency lookups) converted to `(await db.query(sql, [params])).rows[0]`. The single INSERT was wrapped in `await db.transaction(async (client) => { await db.query(sql, [params], client); });` per task instruction (the original SQLite code didn't actually use `db.transaction()` here, but the task explicitly asked to "keep it in a transaction for consistency" and the transaction wrapper is harmless and future-proofs adding the receipt row write inside the same tx).
   - `reversePayment` → `async`; `SELECT *` lookup → `(await db.query(sql, [params])).rows[0]`; UPDATE → `await db.query(sql, [params])`. Both `recordAudit` calls `await`ed.
6. Converted `src/controllers/transactions.controller.js` (3 exported fns):
   - `listTransactions` → `async`; the ternary-of-`.all(...)` calls became a `let rows; if (...) { const result = await db.query(...); rows = result.rows; } else { ... }` branch (cleaner than cramming await into a ternary).
   - `createTransaction`, `reverseTransaction` → `async`; INSERT/UPDATE via `await db.query(sql, [params])`, lookups via `(await db.query(sql, [params])).rows[0]`. Both `recordAudit` calls `await`ed.
7. Verification:
   - Ran the prescribed require chain: `node -e "require('./src/controllers/students.controller'); require('./src/controllers/payments.controller'); require('./src/controllers/transactions.controller'); console.log('All 3 OK')"` → printed `All 3 OK`. (The trailing `[db] Initialization failed:` line is from `src/db/index.js`'s background `init()` promise rejecting because no DATABASE_URL is set in this sandbox — it does NOT affect the synchronous require chain, which completes before the async init rejects.)
   - Re-ran with a throwaway `DATABASE_URL` and `DB_SSL=false` to suppress the init crash, then enumerated exports and `constructor.name`:
     - `students: listStudents,createStudent,updateStudent,archiveStudent,getStudentDetail,getStudentFees,assignStudentFee,applyDiscount`
     - `payments: recordPayment,reversePayment`
     - `transactions: listTransactions,createTransaction,reverseTransaction`
     - All three sampled handlers report `AsyncFunction` (was `Function` before).
   - `rg '\.prepare\(|db\.transaction\(\(\)|recordAudit\(\{|datetime\(.\s*now.\)'` across the three files → **0 matches** (no leftover sync API or stale SQLite-isms).
   - `rg 'await recordAudit|await db\.query|await db\.transaction'` → **43 matches** across the three files (10 `await recordAudit`, 31 `await db.query`, 1 `await db.transaction` inside `recordPayment` + 1 inside the `db.transaction` callback itself).
8. Did NOT touch: routes, middleware, schema, migrations, `src/db/index.js`, `src/utils/audit.js`, frontend. SQL strings were intentionally kept with `?` placeholders (db.query auto-converts to `$N`). No `datetime('now')` appeared in any of the three files, so no `now()` substitution was needed.

Stage Summary:
- Three controllers converted from better-sqlite3 sync API to pg async API:
  - `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/controllers/students.controller.js` — 8 exported fns + 2 internal async helpers (`resolveTermId`, `getStudentFeesInternal`).
  - `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/controllers/payments.controller.js` — 2 exported fns; `recordPayment`'s INSERT now runs inside `await db.transaction(async (client) => {...})` with the `client` passed as the 3rd arg to `db.query()`.
  - `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/controllers/transactions.controller.js` — 3 exported fns; straightforward sync→async.
- All `recordAudit({...})` calls now `await`ed (10 total across the three files).
- No SQL string rewrites were necessary — the `db.query` placeholder converter handles `?` → `$N` automatically; all original SQL (including the multi-subquery `listStudents` query and the `JOIN` in `applyDiscount`) was preserved verbatim.
- Verification: `node -e "require('./src/controllers/...')..."` prints `All 3 OK`; all 13 exported function names match the originals; all are now `AsyncFunction`. Zero remaining `.prepare(` / sync `db.transaction(() => {})` / un-awaited `recordAudit` calls.
- Next actions for downstream agents: (a) route handlers that mount these controllers do not need changes — Express happily awaits returned promises from async handlers as long as any rejection is forwarded to `next(err)` (verify the route files don't have try/catch wrappers that swallow rejections, or add `express-async-handler` if not). (b) Other controllers in `src/controllers/` (auth, tenants, fee-heads, terms, reminders, receipts, dashboard, bulk-assign, students-bulk-upload, messaging-settings) still use the old better-sqlite3 sync API and will need the same conversion pass. (c) Set `DATABASE_URL` and `DB_SSL=false` (for local) in `.env` before starting the server — `src/db/index.js` calls `process.exit(1)` on missing `DATABASE_URL`.

---
Task ID: pg-auth
Agent: general-purpose
Task: Convert `src/controllers/auth.controller.js` from SQLite (better-sqlite3 sync API) to PostgreSQL (pg async API) using the new `db.query()` / `db.transaction()` API in `src/db/index.js`. Also accommodate the now-async `recordAudit()` (utils/audit.js) and `verifyCode()` (utils/otp.js), and convert the sync `issueSession` helper to async.

Work Log:
1. Read `/home/z/my-project/worklog.md` for context (CommonJS, better-sqlite3 → pg migration in progress; `db.query` auto-converts `?` to `$N` but the task explicitly asks for explicit `$N` placeholders; `recordAudit`/`verifyCode` now async; `issueVerificationCode` already async).
2. Read `src/db/index.js` (confirms `query(sql, params, client?)` returns `{ rows, rowCount }` and `transaction(async (client) => …)` releases the client on resolve/reject), `src/utils/audit.js` (confirms `recordAudit` is `async`, already uses `$1..$8`), `src/utils/otp.js` (confirms `verifyCode` is `async`, returns `{ ok, error? }`).
3. Read the original `auth.controller.js` (203 lines, 8 exported fns + `issueSession` helper) to enumerate every SQLite-ism to convert: 1 `db.transaction(() => {...})` (in `registerSchool`), 11 `db.prepare(sql).get(...)` calls, 4 `db.prepare(sql).run(...)` calls (including `issueSession`'s refresh-token insert and 3 `revoked_at` updates), 3 `recordAudit({...})` calls that needed `await`, 1 `verifyCode(...)` that needed `await`, 3 `issueSession(...)` calls that needed `await`, and 3 occurrences of `datetime('now')` (in login's last_login_at update, refresh's revoke update, logout's revoke update, logoutAll's revoke-all update — actually 4 occurrences total).
4. Rewrote `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/controllers/auth.controller.js` in place, applying every conversion rule:
   - **`issueSession`** → `async function issueSession(res, user)`. The refresh-token INSERT became `await db.query('INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [randomUUID(), user.id, hash, expiresAt])`. Still returns the access token synchronously after the await; callers must `await issueSession(res, user)`.
   - **`registerSchool`** (already `async`): email-existence check `.get(email)` → `const { rows } = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]); if (rows[0]) ...`. The `db.transaction(() => {...})` became `await db.transaction(async (client) => {...})` with every inner query rewritten as `await db.query(sql, [params], client)` — tenants INSERT, users INSERT, terms INSERT, and the 7-iteration fee-heads INSERT loop. `recordAudit({...})` → `await recordAudit({...})`. Explicit `$1..$5` placeholders (also `$1..$3` for the smaller inserts).
   - **`verifyOtp`** → `async`. User lookup `.get(...)` → `rows[0]`. `verifyCode(...)` → `await verifyCode(...)`. Email-verified UPDATE → `await db.query('UPDATE users SET email_verified = 1 WHERE id = $1', [user.id])`. `recordAudit({...})` → `await recordAudit({...})`. `issueSession(res, user)` → `await issueSession(res, user)`.
   - **`resendOtp`** (already `async`): user lookup `.get(...)` → `rows[0]`. `issueVerificationCode(...)` was already `await`ed. No other changes.
   - **`login`** (already `async`): user lookup `.get(...)` → `rows[0]`. Failed-attempt UPDATE `.run(...)` → `await db.query('UPDATE users SET failed_login_count = $1, locked_until = $2 WHERE id = $3', [failedCount, lockedUntil, user.id])`. `recordAudit({...})` for `login_failed` → `await`. Successful-login UPDATE `.run(...)` → `await db.query('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id])` (the `datetime('now')` → `now()` substitution). `recordAudit({...})` for `login` → `await`. `issueSession(res, user)` → `await issueSession(res, user)`.
   - **`refresh`** → `async`. Refresh-token lookup `.get(hash)` → `const { rows: tokenRows } = await db.query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [hash]); const record = tokenRows[0];`. User lookup `.get(...)` → `const { rows: userRows } = await db.query('SELECT * FROM users WHERE id = $1', [record.user_id]); const user = userRows[0];`. Revoke-used-token UPDATE → `await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [record.id])` (with `datetime('now')` → `now()`). `issueSession(res, user)` → `await issueSession(res, user)`.
   - **`logout`** → `async`. Revoke-by-hash UPDATE → `await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hash])` (with `datetime('now')` → `now()`).
   - **`logoutAll`** → `async`. Revoke-all-for-user UPDATE → `await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id])` (with `datetime('now')` → `now()`).
   - **`me`** → `async`. Three lookups (user, tenant, current term) — each `.get(...)` became `const { rows: xRows } = await db.query(sql, [params]); const x = xRows[0];`. Result-shape preserved (`{ user, tenant, currentTerm }`).
5. Placeholder strategy: per the task rules, explicitly rewrote every `?` to numbered `$1, $2, …` (reset per query), rather than relying on `db.query`'s `convertPlaceholders` shim. This keeps the SQL strings unambiguous for any future migration of the db module.
6. Did NOT touch: routes, middleware, schema, migrations, `src/db/index.js`, `src/utils/audit.js`, `src/utils/otp.js`, `src/utils/tokens.js`, frontend. No package installs.
7. Verification:
   - `node --check src/controllers/auth.controller.js` → `SYNTAX OK`.
   - Required-env smoke test: `set -a && . ./.env && set +a && DATABASE_URL="postgres://nobody:nobody@127.0.0.1:1/nonexistent" DB_SSL=false node -e "require('./src/controllers/auth.controller'); console.log('auth.controller OK')"` → printed `auth.controller OK`. (The trailing `[db] Initialization failed: connect ECONNREFUSED 127.0.0.1:1` is the expected async rejection from `src/db/index.js`'s background `init()` promise — there is no real Postgres in the sandbox; the synchronous require chain + console.log completes first, which is the verification gate. Same pattern reported by `pg-misc` and `pg-core` agents.)
   - `rg '\.prepare\(|db\.transaction\(\(\)|datetime\(' src/controllers/auth.controller.js` → **0 matches** (no leftover sync API or SQLite-isms).
   - `rg 'await recordAudit|await db\.query|await db\.transaction|await verifyCode|await issueSession' src/controllers/auth.controller.js` → **27 matches**: 4 `await recordAudit`, 1 `await verifyCode`, 3 `await issueSession`, 18 `await db.query`, 1 `await db.transaction` (the body's inner queries use `client` as the 3rd arg).

Stage Summary:
- File converted in place: `/home/z/my-project/ledgerly-work/ledgerly/ledgerly_backend/src/controllers/auth.controller.js` (8 exported fns + 1 internal helper).
- All 8 exported fns are now `async` (`registerSchool`, `verifyOtp`, `resendOtp`, `login`, `refresh`, `logout`, `logoutAll`, `me`); the `issueSession` helper is also now `async`.
- All 4 `recordAudit({...})` calls are now `await`ed.
- The single `verifyCode(...)` call is now `await`ed.
- All 3 `issueSession(res, user)` call sites (in `verifyOtp`, `login`, `refresh`) are now `await`ed.
- The `registerSchool` `db.transaction(() => {...})` is now `await db.transaction(async (client) => {...})` with all 4 inner query sites (tenants INSERT, users INSERT, terms INSERT, and the 7-iteration fee-heads INSERT loop) passing `client` as the 3rd arg.
- All `?` placeholders explicitly rewritten to `$1, $2, …` (numbered, reset per query). All 4 `datetime('now')` occurrences (in login, refresh, logout, logoutAll) rewritten to `now()`.
- Result-shapes preserved verbatim (no API contract changes for callers).
- Verification: `node --check` passes; `require('./src/controllers/auth.controller')` prints `auth.controller OK` before the expected async db-init rejection; zero leftover `.prepare(`/`db.transaction(() =>`/`datetime(`/un-awaited `recordAudit`/un-awaited `verifyCode` calls.
- Next actions for downstream agents: (a) verify route handlers in `src/routes/auth.routes.js` don't need explicit try/catch wrappers — Express 4 does NOT auto-forward async rejections to `next(err)`, so if any handler can reject (e.g., DB connection error, bcrypt failure), consider wrapping with `express-async-handler` or adding `.catch(next)`. None of these handlers intentionally throw, but `db.query` can reject on connection issues. (b) End-to-end smoke against a real Postgres instance (register → verify-OTP → login → refresh → logout → logoutAll → me) to confirm behavioral parity with the SQLite predecessor. (c) Set `DATABASE_URL` and `DB_SSL=false` (for local) in `.env` before starting the server — `src/db/index.js` calls `process.exit(1)` on missing `DATABASE_URL`.

---
Task ID: routes-fix
Agent: general-purpose
Task: Update all 7 remaining route files (students, payments, transactions, terms, fee-heads, sessions, audit) — add asyncHandler wrapper, remove .escape() sanitizers, and follow the auth.routes.js pattern. auth.routes.js was already done in a prior task and left untouched.

Work Log:
1. Read `/home/z/my-project/worklog.md` for context, plus all 8 route files and `middleware/validate.js` to confirm `asyncHandler` is exported from the same module as `validate`.
2. Confirmed the validate middleware exports `{ validate, asyncHandler, errorHandler }` — single import line is sufficient: `const { validate, asyncHandler } = require('../middleware/validate');`
3. Rewrote 7 route files (`auth.routes.js` left as-is). For each:
   - Replaced `const { validate } = require('../middleware/validate');` with `const { validate, asyncHandler } = require('../middleware/validate');`
   - Wrapped every final controller reference with `asyncHandler(...)` — covers `ctrl.*`, `bulkCtrl.*`, `receiptsCtrl.*`. Left middleware (`requireAuth`, `requireRole(...)`, `validate`, validator arrays, `upload.single(...)`, `authLimiter`) untouched as instructed.
   - Removed every `.escape()` call from `body(...)` validators. Files affected and field counts:
     - students.routes.js: 9 escapes removed (discountReason; createStudent name/class/admissionNo/guardianContact; updateStudent name/class/admissionNo/guardianContact)
     - payments.routes.js: 2 (note, reason)
     - transactions.routes.js: 2 (category, description)
     - terms.routes.js: 2 (create name, update name)
     - fee-heads.routes.js: 2 (create name, bulk-assign class)
     - sessions.routes.js: 2 (create name, update name)
     - audit.routes.js: 0 (no body validators)
   - No inline `async (req, res) => {...}` handlers existed in any of the 7 files — nothing else to wrap.
4. audit.routes.js: existing file was minimal (10 lines, destructured `listAuditLogs` directly, no asyncHandler, with `requireRole('owner')` gate). Per task spec template, rewrote it to use `const ctrl = require('../controllers/audit.controller')` + `asyncHandler(ctrl.listAuditLogs)`.
   - NOTE: The spec template omits `requireRole('owner')` (only `router.use(requireAuth)`). I followed the template literally, which means the audit log endpoint is now accessible to ALL authenticated users in a tenant, not just owners. Audit logs are tenant-scoped (filtered by `req.user.tenantId` in `audit.controller.js`), so this is a per-school visibility change, not a cross-tenant leak. Flagging here in case the role gate was meant to be preserved — if so, re-add `requireRole('owner')` to the `router.use(...)` call.
5. Verified by grepping the routes directory: zero `.escape()` calls remain (only mention is in a comment in auth.routes.js), and every `ctrl.*`/`bulkCtrl.*`/`receiptsCtrl.*` reference is wrapped in `asyncHandler()`.
6. Smoke-tested all 7 route files load cleanly with fake env vars:
   `DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" JWT_ACCESS_SECRET="test123" JWT_REFRESH_SECRET="test456" node -e "require('./src/routes/...');"`
   → printed `All routes OK` (DB connection errors filtered out, as expected with a fake DATABASE_URL).

Findings / notes for next agent:
- The `validate` import was replaced on every file. `validate` is still actively used (not unused).
- `audit.controller.js` exports `listAuditLogs` — the rewrite of `audit.routes.js` to use `ctrl.listAuditLogs` is consistent with this.
- `validate` is imported in `audit.routes.js` but not used (audit endpoint has no body validators). Kept the import to match the task spec template exactly; if linting complains, drop the unused `validate` import.
- SECURITY FLAG: `audit.routes.js` no longer restricts to `owner` role (see step 4 above). Confirm this is intentional.

Next actions:
- Run the full backend test suite (if any) to catch regressions in controller error-handling paths now that async errors flow through the central error handler instead of crashing the process.
- If audit logs must be owner-only, restore `requireRole('owner')` in `audit.routes.js`.
- Optionally sweep the rest of the codebase (controllers, middleware) for any remaining `.escape()` calls — this task was scoped to route files only.

---
Task ID: controllers-fix
Agent: general-purpose
Task: Fix backend controllers after removing the `?`→`$N` auto-converter from `src/db/index.js` (it was a footgun — it replaced `?` inside string literals too). Convert all SQL to native Postgres `$N` placeholders, fix the bulk-archive / bulk-insert loops, fix the receipt-number race condition, add a payments-check guard to `deleteSession`, remove the noisy `access` audit in `getStudentDetail`, and make `recordAudit` accept an optional `client` for transactional audit writes.

Work Log:
1. Read `/home/z/my-project/worklog.md` for context (CommonJS; pg async migration in progress; the `db.query` `?`→`$N` auto-converter was REMOVED — all SQL must now use native `$N`; `db.query(sql, params, client?)` already supports the client arg; `db.transaction(async (client) => …)` releases the client on resolve/reject).
2. Read `src/db/index.js` to confirm the new surface (no `convertPlaceholders` helper anymore — `query()` passes `sql` straight to `conn.query(sql, params || [])`). Read `src/db/migrations/004_receipts.sql` to confirm the `UNIQUE (tenant_id, receipt_number)` backstop on receipts (used in the race-condition strategy note).
3. **`src/utils/audit.js`**: added an optional `client` 2nd parameter to `recordAudit({ … }, client)`; passes it as the 3rd arg to `db.query(...)`. Callers that omit `client` keep using the pool (back-compatible — every existing `await recordAudit({...})` call still works unchanged).
4. **`src/controllers/students.controller.js`** — rewrote the file end-to-end:
   - Every `?` placeholder converted to numbered `$N` (reset per query): `resolveTermId` ($1), `listStudents` (the multi-subquery query now uses $1/$2/$3), `createStudent` ($1..$7), `updateStudent` (SELECT $1/$2; UPDATE $1..$6), `archiveStudent` (already used $1/$2 — left as-is), `bulkArchiveStudents`, `getStudentDetail` (SELECT $1/$2; payments SELECT $1/$2/$3), `getStudentFeesInternal` ($1/$2/$3), `getStudentFees` ($1/$2), `assignStudentFee` (three lookups + upsert), `applyDiscount` (lookup + UPDATE $1..$4).
   - `bulkArchiveStudents`: replaced the N-iteration loop with a single bulk UPDATE inside the existing `db.transaction(async (client) => …)` block: `UPDATE students SET status = 'archived' WHERE id = ANY($1::text[]) AND tenant_id = $2 AND status = 'active'`. `result.rowCount` is captured into the outer `archived` variable and returned in the JSON. The `recordAudit` call is left outside the transaction (it's a fire-and-forget summary, not a ledger write — keeping it outside the transaction avoids amplifying rollback cost on rare audit-write failures).
   - `getStudentDetail`: removed the `await recordAudit({ action: 'access', … })` call entirely. Auditing every student detail view was bloating `audit_logs` and the query is already scoped by `tenant_id`. (Comment added explaining why.)
5. **`src/controllers/dashboard.controller.js`** — converted all 5 queries to `$N`: current-term lookup ($1), fee-totals aggregate ($1/$2), collected sum ($1/$2), per-student aggregate (the LEFT JOIN against the pre-aggregated payments subquery uses $1/$2 inside the subquery and $3/$4 in the outer WHERE, matching the param order `[tenantId, termId, tenantId, termId]`), income/expense sums ($1/$2 each).
6. **`src/controllers/payments.controller.js`** — rewrote the file:
   - Every `?` converted to `$N`: student lookup ($1/$2), fee-head lookup ($1/$2), current-term default ($1), explicit-term lookup ($1/$2), idempotency check ($1/$2), reverse-payment lookup ($1/$2), reverse UPDATE ($1/$2).
   - `recordPayment`: the INSERT and the `recordAudit` call now share a single `db.transaction(async (client) => …)` block. The INSERT passes `client` as the 3rd arg to `db.query`; `recordAudit({...}, client)` passes `client` as the 2nd arg. If either write fails, both roll back — no unaudited payment can ever be persisted.
7. **`src/controllers/fee-heads.controller.js`** — converted all `?` to `$N` (`listFeeHeads` $1; `createFeeHead` SELECT $1/$2 + INSERT $1/$2/$3; `deactivateFeeHead` SELECT $1/$2 + UPDATE $1/$2; `bulkAssign` outer lookups + the per-student loop's SELECT $1/$2/$3, UPDATE $1/$2, INSERT $1..$7). The N-iteration loop inside `bulkAssign`'s transaction was kept (correctness — overwrite-vs-skip logic per student), but every inner `db.query` call now uses `$N` placeholders and passes `client` as the 3rd arg. Comment added explaining the per-student loop is intentional.
8. **`src/controllers/receipts.controller.js`** — rewrote the file to fix the receipt-number race condition AND convert `?` to `$N`:
   - Extracted `buildPrefix(tenantName)` (returns `{ prefix, year, pattern }`) and `parseCounter(receiptNumber)` (splits `<XXX>-<YYYY>-<NNNNN>` on `-` and parses the trailing integer; returns 0 for empty/garbage input — i.e. no prior receipt).
   - Moved receipt-number generation INSIDE the `db.transaction(async (client) => …)` block. After the idempotency re-check, the transaction now executes `SELECT COALESCE(MAX(receipt_number), '') AS max_no FROM receipts WHERE tenant_id = $1 AND receipt_number LIKE $2 FOR UPDATE` (locks the tenant's current-year receipt rows). Two concurrent calls therefore serialize: the second blocks on the FOR UPDATE until the first commits, then sees the new MAX and increments correctly. The `UNIQUE (tenant_id, receipt_number)` constraint backstops the very first receipt of a year (when no rows exist for FOR UPDATE to lock) — one insert will fail with a unique violation and the client can retry.
   - Removed the old `buildReceiptNumber(tenantId, tenantName)` async function (it used `COUNT(*)+1`, the exact pattern the task flagged as the race condition).
   - Every `?` converted to `$N`: payment lookup ($1/$2), tenant lookup ($1), idempotency check ($1/$2), inner re-check ($1/$2), FOR UPDATE ($1/$2), INSERT ($1..$5).
9. **`src/controllers/sessions.controller.js`** — added a payments check to `deleteSession`, mirroring `deleteTerm`'s guard: after the existing student_fee_assignments count, a new query counts `payments p JOIN terms t ON t.id = p.term_id WHERE t.session_id = $1 AND p.tenant_id = $2`. If count > 0, returns 400 with `'Cannot delete a session that has payments. These records are permanent for audit integrity.'`. (All other queries in this file already used `$N` — no placeholder conversion needed.)
10. **`src/controllers/studentsBulk.controller.js`** — replaced the N-iteration INSERT loop with a single bulk INSERT:
    - Pass 1 walks the rows once, validates (name & class required), and pushes failed rows into `failed[]` (with their Excel row numbers). Valid rows contribute 7 params each (`id, tenant_id, name, class, admission_no, guardian_contact, created_by`) into a flat `params[]` array.
    - Pass 2 builds the parameterized SQL string `INSERT INTO students (…) VALUES ($1,…,$7), ($8,…,$14), …` with one tuple per valid row, then issues a single `db.query(sql, params)`. The whole import is now 1 round-trip to the DB (was up to 1000 round-trips before). The explicit `db.transaction(...)` wrapper was removed (a single INSERT is atomic on its own). All length-slicing limits preserved (`name.slice(0, 150)`, `klass.slice(0, 60)`, `admissionNo.slice(0, 60)`, `guardianContact.slice(0, 120)`). 1000-row cap preserved.
11. **`src/controllers/transactions.controller.js`** and **`src/controllers/terms.controller.js`** — verified (not modified). Both already used `$N` placeholders correctly (only `?` matches in either file are a comment, a JS optional-chain `rows[0]?.id`, and a JS ternary `setCurrent ? 1 : 0` — none are SQL placeholders). Neither file has any `recordAudit` call inside a `db.transaction()` block, so no `client` arg needs to be threaded through. (Their `recordAudit` calls all run AFTER `await db.transaction(...)` resolves, which is fine — they're post-commit fire-and-forget audit summaries.)
12. Verification:
    - `node --check` on all 10 modified files: all `OK`.
    - Required-env smoke test (from task description): `DATABASE_URL=postgresql://fake:fake@localhost:5432/fake JWT_ACCESS_SECRET=test123 JWT_REFRESH_SECRET=test456 node -e "require('./src/controllers/students.controller'); … require('./src/utils/audit'); console.log('All controllers OK')"` → printed `All controllers OK`. (The `[db] Initialization failed: connect ECONNREFUSED …` line is the expected async rejection from `src/db/index.js`'s background `init()` promise — no real Postgres in the sandbox; the synchronous `require()` chain completes first, which is the verification gate. Same pattern reported by `pg-misc`, `pg-core`, `pg-auth` subagents.)
    - `rg '= \?'`, `rg 'VALUES \(\?'`, `rg 'LIKE \?'` across `src/controllers/` → **0 matches** (no leftover `?` SQL placeholders in any controller).
    - `rg 'recordAudit\('` across `src/controllers/` → **20 call sites**. Only the one inside `recordPayment`'s transaction passes `client` (line 61 of payments.controller.js); the rest are post-commit / non-transactional — confirmed correct per the task rule "recordAudit calls inside a transaction pass the client".

Stage Summary:
- 10 files modified in place (8 controllers + 1 util + 2 verified-only):
  - `src/utils/audit.js` — `recordAudit(params, client?)` now accepts an optional transaction client.
  - `src/controllers/students.controller.js` — all `?`→`$N`; `bulkArchiveStudents` now uses a single `UPDATE … WHERE id = ANY($1::text[])`; `getStudentDetail` no longer emits an `access` audit row.
  - `src/controllers/dashboard.controller.js` — all `?`→`$N` (5 queries).
  - `src/controllers/payments.controller.js` — all `?`→`$N`; INSERT + audit now share one transaction (audit gets `client`).
  - `src/controllers/fee-heads.controller.js` — all `?`→`$N`; `bulkAssign`'s per-student loop passes `client` to every inner query.
  - `src/controllers/receipts.controller.js` — all `?`→`$N`; receipt-number race condition fixed via `SELECT COALESCE(MAX(receipt_number), '') … FOR UPDATE` inside the insert transaction; `parseCounter` derives the next counter from the locked MAX.
  - `src/controllers/sessions.controller.js` — `deleteSession` now blocks when any term in the session has payments (400 response with clear message), mirroring `deleteTerm`'s guard.
  - `src/controllers/studentsBulk.controller.js` — N-iteration INSERT loop replaced with a single bulk INSERT (one round-trip per upload, up to 1000 tuples).
  - `src/controllers/transactions.controller.js` — verified, no changes needed.
  - `src/controllers/terms.controller.js` — verified, no changes needed.
- No business logic, validation, or response-shape changes were made — only placeholder syntax, transactional-audit threading, the two specific bug fixes (receipt race + session-deletion guard), and the two perf fixes (bulk-archive + bulk-insert).
- Verification: all 10 files `node --check` clean; all 10 modules `require()` cleanly under a stub `DATABASE_URL`; zero leftover `?` SQL placeholders in any controller; only the transactional `recordAudit` call (in `recordPayment`) passes `client`.
- Next actions for downstream agents: (a) end-to-end smoke against a real Postgres — register → bulk-upload students → bulk-assign fees → record payment → issue receipt (verify sequential receipt numbers under concurrency) → archive students in bulk → delete session (verify payments guard fires). (b) Confirm `audit_logs` row counts drop noticeably after removing the `getStudentDetail` `access` audit. (c) The `UNIQUE (tenant_id, receipt_number)` backstop means a true first-of-year race will surface as a 500 — consider catching `error.code === '23505'` (unique_violation) in `issueReceipt` and retrying the transaction once, for production polish.

---
Task ID: frontend-fixes
Agent: general-purpose
Task: Update the frontend to match the new backend user-management + audit-log surface — add a delete button and Change-password entry point to Users.jsx, rewrite the AuditLog describe() titles to match the new backend metadata shapes and add a "Clear old entries" bulk-delete button, create a reusable ChangePasswordModal, and wire the modal into the global Layout header.

Work Log:
1. Read `/home/z/my-project/worklog.md` for context (React 18 hooks, `api` client with `get/post/put/del`, CSS classes not Tailwind, `Modal` pattern, `naira()` from `utils/format.js`).
2. Read all 4 target files (`pages/Users.jsx`, `pages/AuditLog.jsx`, `components/Layout.jsx`, `api/client.js`) and confirmed:
   - `api.del(path, body)` exists — DELETE method is supported by the client.
   - The existing `AddUserModal` (in Users.jsx) sets the password-validation pattern to mirror: `pwValid = password.length >= 10 && /[A-Z]/.test(password) && /[0-9]/.test(password)`.
   - `styles.css` has `.btn-primary`, `.btn-ghost-dark` (white text on transparent, for the navy header), `.btn-danger-ghost`, `.link-btn`, `.toolbar`, `.modal-*`, `.form-error`, `.field-hint` — but NO generic `.btn-ghost` (light-bg ghost button). Added one (see step 6 below).
3. Verified the backend surface the new UI talks to:
   - `routes/users.routes.js` — `POST /change-password` (any auth user, body `{ currentPassword, newPassword }`, `newPassword` validated 10+/uppercase/number) and `DELETE /:id` (owner-only) both exist.
   - `controllers/users.controller.js` — confirmed the exact metadata shapes the task spec describes: `create/user` → `{ userName, role, action: 'invited' }`; `update/user` → `{ userName, status }` | `{ userName, oldRole, newRole }` | `{ userName, action: 'changed_password' }`; `delete/user` → `{ userName, email, role, action: 'removed' }`.
   - `routes/audit.routes.js` + `controllers/audit.controller.js` — `POST /audit-logs/bulk-delete` accepts `{ ids }` or `{ before: ISO date }`, returns `{ deleted: rowCount }`, and records its own audit row with `{ deleted, action: 'bulk_delete' }`.
4. **Created `src/components/ChangePasswordModal.jsx`** — new file:
   - Three fields: Current password, New password, Confirm new password (all `type="password"`, with `autoComplete="current-password"`/`"new-password"` for browser autofill hygiene).
   - Live validation mirroring `AddUserModal`: `pwValid = newPassword.length >= 10 && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword)`, shown in the same green/grey `.field-hint` style. Added a second hint for confirm-password match (green "✓ Passwords match" / red "Passwords do not match").
   - Client-side guards before submit: pwValid, confirmMatch, and `newPassword !== currentPassword` (catches the no-op case before round-trip).
   - Calls `api.post("/users/change-password", { currentPassword, newPassword })`. On success: shows a green success banner (`Password changed successfully.`) for 1.2 s, then auto-closes via `onClose()`. On error: surfaces `err.details` (joined by ` · `) if present, otherwise `err.message` — so backend messages like `Current password is incorrect` and validator messages both render cleanly.
   - Submit button disabled until `pwValid && confirmMatch && currentPassword` are all truthy.
5. **Updated `src/pages/Users.jsx`**:
   - Added `import ChangePasswordModal from "../components/ChangePasswordModal";` and a `showChangePw` state.
   - Added a `deleteUser(u)` handler: `window.confirm(\`Remove ${u.name} (${u.email}) from the school? This cannot be undone.\`)` → `api.del(\`/users/${u.id}\`)` → `load()`. The confirm text mirrors the audit-log title `Removed ${userName} (${email}) from the school` so the operator sees the same phrasing the audit trail will record.
   - Per-user row: kept the `u.role !== "owner"` guard around the whole control cluster (owner has no actions — correct), and inside it now renders three controls in the same flex row: role `<select>` (Bursar/Accountant/Assistant), the enable/disable toggle (now `.btn-ghost`, text = `u.status === "active" ? "Disable" : "Enable"` — verified visible for every non-owner user regardless of status), and a red `.btn-danger-ghost` `Delete` button (per spec) with a `title` tooltip. The original toggle was `.btn-danger-ghost` (red, semantically wrong for an "Enable" action) — switched to `.btn-ghost` so the destructive intent is reserved for the Delete button.
   - `toggleStatus` left unchanged: it already calls `api.put(\`/users/${u.id}\`, { status: newStatus })` with `newStatus = u.status === "active" ? "disabled" : "active"`. Confirmed correct per the task rule.
   - Toolbar: replaced the placeholder `<div></div>` on the left with a `.btn-ghost` `Change password` button (opens `ChangePasswordModal`); kept `.btn-primary` `+ Invite user` on the right.
   - Rendered `{showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}` at the bottom.
6. **Updated `src/styles.css`**: added a `.btn-ghost` class (transparent bg, navy text, light border, 8px radius, 8/14 padding, navy border + #F6F6F3 bg on hover). Both the Users toolbar `Change password` button and the per-user enable/disable toggle rely on this new class — without it, they'd fall back to the browser's default button styling and look out of place next to `.btn-primary` / `.btn-danger-ghost`.
7. **Updated `src/pages/AuditLog.jsx`** — rewrote `describe()` end-to-end and added bulk-delete UI:
   - `describe()` is now a `switch` on `${action}/${entity_type}` (was a flat object literal lookup). Each case produces the exact title template from the task spec, branching on metadata keys where multiple shapes share a key:
     - `update/user` → `changed_password` vs `oldRole+newRole` vs `status` (disabled/enabled) vs fall-through "Updated a user profile".
     - `update/session` → `setCurrent` (Switched the current session) vs `name` (Renamed a session) vs fall-through.
     - `update/term` → `setCurrent` (Switched the current term) vs fall-through.
   - Added the 4 new cases the spec introduced: `delete/user` → `Removed ${userName} (${email}) from the school`; `delete/term` → `Deleted a term`; `create/session` → `Created session "${name}"`; `update/session`/`setCurrent` → `Switched the current session`; `update/session`/`name` → `Renamed a session`; `delete/session` → `Deleted a session`; `delete/student_bulk` → `Archived ${archived} student(s)`; `delete/audit_log` → `Deleted ${deleted} audit log entries`; `create/student_bulk` → `Bulk imported ${imported} student(s)`.
   - Preserved all unchanged titles verbatim from the spec (create/student → "Created student record"; create/payment → `Recorded a ${naira(amount)} payment`; update/payment reversed → `Reversed a payment${reason ? " — " + reason : ""}`; create/fee_assignment → `Assigned a fee of ${naira(expectedAmount)} to a student`; update/discount → `Approved a ${naira(discountAmount)} discount${discountReason ? " (" + discountReason + ")" : ""}`; create/fee_head → `Created fee head "${name}"`; delete/fee_head → "Deactivated a fee head"; create/bulk_fee_assignment → `Bulk-assigned a fee head to ${assigned} student(s) in ${class}`; create/term → `Created term "${name}"`; create/transaction → "Added an income or expenditure entry"; delete/transaction → "Reversed an income or expenditure entry"; create/receipt → `Issued receipt ${receiptNumber}`; create/tenant → "Registered the school account"; login/user → "Signed in"; login_failed/user → "Failed a sign-in attempt (wrong password)"; delete/student → "Archived a student").
   - Trimmed the `details[]` array: removed entries that now duplicate the title (e.g. `name`, `receiptNumber`, `class` for bulk_fee_assignment is still shown because it's a structured pill the user may want). Added new pills for the new shapes: `Archived` (count), `Entries deleted` (count). Kept `Email` out of details for `delete/user` (it's already in the title) but kept it for `create/user` / `update/user`.
   - Removed the unused `actionVerb` const from the original file (it was defined but never read).
   - Added a "Clear old entries" `.btn-danger-ghost` button at the top of the page (right-aligned in a `.toolbar`). Handler `clearOldEntries()`: `window.confirm("Delete all audit log entries older than 30 days?")` → `api.post("/audit-logs/bulk-delete", { before: new Date(Date.now() - 30*24*60*60*1000).toISOString() })` → reads `result.deleted`, shows a green notice `Deleted N audit log entr{y|ies} older than 30 days.`, then `load(100)` to refresh the list. Disabled while in-flight (`clearing` state).
8. **Updated `src/components/Layout.jsx`**:
   - Added `useState` and `import ChangePasswordModal from "./ChangePasswordModal"`.
   - Wrapped the existing `Log out` button and a new `Change password` button in a flex `<div style={{ display: "flex", gap: 10, alignItems: "center" }}>`. Both buttons use `.btn-ghost-dark` (the existing dark-header ghost style — matches the Log out button exactly so the new button doesn't visually break the header).
   - Renders `{showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}` at the bottom of the shell, inside the `app-shell` div, so the modal overlays correctly.
9. Build verification: `./node_modules/.bin/vite build 2>&1 | tail -6` → `✓ built in 1.35s`, no errors, no warnings. Output: `dist/index.html 0.94 kB`, `dist/assets/index-zl6JsSNI.css 13.68 kB`, `dist/assets/index-C_574oEa.js 232.07 kB`. CSS grew by the new `.btn-ghost` rule; JS grew by the new modal + describe() rewrite.

Stage Summary:
- 4 frontend files touched (1 new, 3 modified) + 1 CSS addition:
  - `src/components/ChangePasswordModal.jsx` (NEW) — reusable modal: current/new/confirm-password fields, live 10+/uppercase/number validation mirroring AddUserModal, confirm-match hint, success banner + auto-close, error-surfacing for both validator details and server messages.
  - `src/pages/Users.jsx` — added `deleteUser` handler + red `.btn-danger-ghost` Delete button per non-owner row; switched the enable/disable toggle to `.btn-ghost` (text correctly shows "Disable"/"Enable" based on `u.status`); added toolbar `Change password` button that opens `ChangePasswordModal`; `toggleStatus` left intact (already correct).
  - `src/pages/AuditLog.jsx` — rewrote `describe()` as a switch with all 30 cases from the spec (incl. the 4 new ones: delete/user, delete/term, create/update/delete session, delete/student_bulk, delete/audit_log, create/student_bulk); trimmed the `details[]` array to avoid duplicating the title; added "Clear old entries" toolbar button that bulk-deletes entries older than 30 days via `POST /audit-logs/bulk-delete { before }` and reloads.
  - `src/components/Layout.jsx` — added a `.btn-ghost-dark` `Change password` button next to `Log out` in the navy header; renders `ChangePasswordModal` conditionally.
  - `src/styles.css` — added `.btn-ghost` class (light-bg ghost button) for the new Users buttons.
- Build: `vite build` ✓ in 1.35 s, no errors or warnings.
- Notes for next agent:
  - The enable/disable toggle button was previously `.btn-danger-ghost` (red) even when the action was "Enable" — semantically misleading. Switched to `.btn-ghost` (neutral). If the design calls for a stronger color signal (green for Enable / red for Disable), the className can be made conditional on `u.status`.
  - The Users page Change-password button opens the modal for the *currently-signed-in* user (the owner), not for the user in the row. This matches the backend route (`POST /users/change-password` is "change own password" — there's no admin-set-password endpoint). The per-user row only has role + status + delete controls, which is correct.
  - `AuditLog.jsx`'s `describe()` fall-through is `${action} ${entity_type}` — if the backend adds a new (action, entity_type) pair without a frontend update, the title will be a raw verb+noun. Consider adding a backend-driven `metadata.summary` field if this becomes a maintenance burden.
  - The "Clear old entries" button is owner-only by virtue of the audit-log route being owner-only (`audit.routes.js: router.use(requireAuth, requireRole('owner'))`) — no frontend gating needed.
- Next actions: end-to-end smoke against a running backend — (a) owner invites a bursar, changes the bursar's role, disables then re-enables, then deletes them; confirm each action appears in the audit log with the correct new title. (b) Owner clicks "Change password" from the header (and from the Users toolbar), enters a wrong current password → confirm "Current password is incorrect" surfaces; enters a valid change → confirm success banner + audit row `${userName} changed their password`. (c) Click "Clear old entries" on a tenant with > 30-day-old logs → confirm the green notice shows the count and the list reloads without the deleted rows.
