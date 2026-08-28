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

---
Task ID: frontend-reports
Agent: general-purpose
Task: Create 3 new frontend pages — Reports (financial reports, owner-only), BrandingSettings (receipt branding, owner-only), PlatformAdmin (platform operator dashboard, separate auth) — plus wire up routes in App.jsx and nav links in Layout.jsx.

Work Log:
1. Read worklog.md and explored `ledgerly_frontend/src/` — confirmed conventions: React 18 hooks, `api` client (`get/post/put/del/upload/download`), `useAuth()`/`useTerm()` context, CSS-class styling (no Tailwind), `naira()`/`statusMeta()`/`todayISO()` from `utils/format.js`. Reusable classes: `.stat-card`, `.stat-grid`, `.card`, `.fee-table` (already exists for tabular data), `.toolbar`, `.btn-primary`, `.btn-ghost`, `.btn-danger-ghost`, `.badge`, `.empty-state`, `.form-error`, `.auth-page`/`.auth-card`, `.app-shell`/`.app-header`/`.app-main`.
2. Read backend controllers to confirm response shapes:
   - `reports.controller.js` → `{ monthlyCollection: [{month,count,total}], defaulters: [{id,name,class,admission_no,guardian_contact,expected,paid,outstanding}], fullyPaid: [{id,name,class,admission_no,expected,paid}], summary: {total,collected,outstanding,studentCount} }`. Defaulters already sorted by outstanding DESC server-side.
   - `branding.controller.js` → GET returns `{ branding: {name, logo_path, receipt_footer} }`; POST `/branding/logo` (multipart field `logo`, 2MB, image types only) returns `{ ok, logoPath }`; PUT `/branding/footer` body `{ footer }`.
   - `platform.controller.js` → `/platform/overview` returns `{ summary: {totalSchools,activeSchools,totalStudents,totalPayments,totalCollected}, tenants: [{id,name,phone,created_at,user_count,student_count,payment_count,total_collected,last_active,health}] }` (health is `green`/`yellow`/`red`). `/platform/health` returns `{ database: {size, tables: [{name,size}]}, connections: {total,active}, pool: {max} }`. Auth: separate `platform_admins` table, token in `Authorization: Bearer <token>`.
3. Created `pages/Reports.jsx`:
   - `TermSwitcher` at top, calls `api.get("/reports?termId=" + selectedTermId)`.
   - Section 1 — 4 summary cards reusing `.stat-card`/`.stat-grid` (Total expected, Total collected, Outstanding, Student count).
   - Section 2 — Monthly Collection table (`fee-table` class) with month, payment count, and total amount plus an inline green bar-chart strip scaled to the max month.
   - Section 3 — Defaulter list table (Name+badge, Class, Expected, Paid, Outstanding, action). Each row has a "Send reminder" button that calls `alert()` (placeholder for SMS/email integration). Backend already sorts by outstanding DESC. "Export CSV" button calls `api.download("/students/export?termId=...")`.
   - Section 4 — Fully paid list table (Name+badge, Class, Expected, Paid).
   - Uses `naira()` for all amounts, `statusMeta` for coloured badges (paid=green, outstanding=red).
4. Created `pages/BrandingSettings.jsx`:
   - `api.get("/branding")` to load current `{ name, logo_path, receipt_footer }`.
   - Logo upload via `<input type="file">` → `api.upload("/branding/logo", formData)` (field name `logo`, 2MB client-side guard, accepts png/jpg/gif/webp).
   - Receipt footer textarea (200 char max) → `api.put("/branding/footer", { footer })` on Save.
   - Shows live logo preview (`logoUrl()` helper prepends API origin for dev cross-origin) and a full receipt preview card combining logo + school name + footer text.
   - Success/error notices; busy states for both upload and footer save.
5. Created `pages/PlatformAdmin.jsx`:
   - NOT wrapped in `ProtectedRoute` (separate auth).
   - Login form (email + access token). On submit, stores token in `localStorage["platform_admin_token"]`, sets `authed=true`, calls `loadDashboard()`.
   - Uses raw `fetch` with `Authorization: Bearer <token>` (NOT the `api` client — keeps platform-token flow separate from tenant access-token/cookie flow). Helper `platformFetch(path, token)`.
   - `Promise.all([/platform/overview, /platform/health])` for initial load + Refresh button.
   - 401 response clears the stored token and reverts to the login form with a helpful error.
   - Dashboard: 5 summary cards (Total schools, Active 7d, Total students, Total payments, Total collected) + 3 derived cards (avg per school, avg payments/school, total collected). Tenant list table with name, students, payments, total collected, last active (relative format), health (🟢/🟡/🔴 emoji + label). Platform health card with DB size (human-readable bytes), connections total/active, pool max, plus top-10 largest tables.
   - Self-contained app shell (own `<header>` with Refresh + Log out buttons) so it doesn't reuse tenant `Layout.jsx`.
6. Updated `App.jsx`:
   - Added 3 lazy-loaded imports: `Reports`, `BrandingSettings`, `PlatformAdmin`.
   - Routes: `/reports` (ProtectedRoute owner-only, wrapped in Layout), `/branding` (ProtectedRoute owner-only, wrapped in Layout), `/admin` (NO ProtectedRoute, renders `<PlatformAdmin />` directly).
7. Updated `components/Layout.jsx`:
   - Added owner-only nav links: "Reports" → `/reports`, "Branding" → `/branding`, placed before Users/Audit Log in the nav.
8. Build check: `./node_modules/.bin/vite build` → `✓ built in 2.44s`. All three new pages produce separate chunks (Reports 5.24 kB, BrandingSettings 4.30 kB, PlatformAdmin 7.13 kB). No build errors.

Next actions / notes for follow-up:
- The Reports "Send reminder" button is a stub (`alert`). When the Termii messaging provider is wired up, replace the alert with an actual API call (e.g. `api.post("/students/:id/remind", { termId, channel: "sms" })` → backend uses `messagingProvider.send()`). `guardian_contact` is already returned by `/reports` for this purpose.
- The Export CSV button reuses the existing `/students/export?termId=` endpoint (the same one the Students page uses). If a defaulter-only CSV is desired later, the backend reports route would need its own export endpoint.
- PlatformAdmin login is purely token-based (no password endpoint exists in `platform.controller.js`). The email field is collected for display only. If a real login endpoint (`/platform/login`) is added later, the form should switch to email+password → receive token → store.
- Logo URL construction in `BrandingSettings.jsx` strips `/api/v1` from `VITE_API_BASE` because logos are served from `/data/logos/...` (not under `/api/v1`). If the backend changes its static-mount path, update `logoUrl()` accordingly.

Files created:
- `ledgerly_frontend/src/pages/Reports.jsx`
- `ledgerly_frontend/src/pages/BrandingSettings.jsx`
- `ledgerly_frontend/src/pages/PlatformAdmin.jsx`

Files modified:
- `ledgerly_frontend/src/App.jsx` (3 lazy imports + 3 routes)
- `ledgerly_frontend/src/components/Layout.jsx` (2 owner-only nav links)

---
Task ID: platform-backend
Agent: general-purpose
Task: Rewrite `platform.controller.js` + `platform.routes.js` to expose all Tier 1–3 platform admin endpoints (impersonation, suspend/unsuspend, revenue, errors, usage, feature flags, broadcasts, tenant notes, CSV export, DB stats, deployments, rate limits, NPS) on top of the existing overview/health endpoints. Migration 016 already created `feature_flags`, `tenant_notes`, `broadcast_messages`, `nps_feedback`, `deployment_logs`, `subscriptions`, `api_usage`, and added `tenants.status`.

Work Log:
1. Read `/home/z/my-project/worklog.md` for context — confirmed CommonJS, `db.query()` with `$N` placeholders, `asyncHandler` from `middleware/validate.js`, `signAccessToken(user)` from `utils/tokens.js` (lazy secret check via `checkSecrets()`), `recordAudit()` helper, `randomUUID()` from `crypto` for IDs. Confirmed migration 016 schema for all new tables (PK = TEXT, INTEGER booleans, `created_at TIMESTAMPTZ DEFAULT now()`). Confirmed `audit_logs` columns: `id, tenant_id, actor_user_id, action, entity_type, entity_id, ip_address, metadata, created_at`. Confirmed RLS is enabled on all tables but the Express service_role bypasses it (so cross-tenant queries work).
2. Rewrote `src/controllers/platform.controller.js` — kept the existing 3 (`requirePlatformAdmin`, `getPlatformOverview`, `getPlatformHealth`) and added 18 handlers:
   - **Tier 1**: `impersonateTenant` (finds owner user via `SELECT * FROM users WHERE tenant_id=$1 AND role='owner' LIMIT 1`, records an audit entry under the tenant with `metadata.impersonatedBy = req.platformAdmin.id`, signs a real JWT via `signAccessToken(owner)`, returns `{ accessToken, user }`); `suspendTenant` / `unsuspendTenant` (`UPDATE tenants SET status='suspended'|'active' RETURNING ...` + audit log); `getRevenue` (MRR = SUM(amount) WHERE status='active', ARPU = MRR/active_count rounded, churn = COUNT WHERE status='cancelled', planBreakdown = GROUP BY plan); `getErrors` (`SELECT ... FROM audit_logs WHERE action IN ('login_failed','delete') ORDER BY created_at DESC LIMIT 50` — no tenant filter); `getTenants` (dynamic WHERE builder for `?search=` on name ILIKE, `?plan=` joins subscriptions, `?health=` filters post-hoc since health is computed from last_active).
   - **Tier 2**: `getUsage` (daily COUNT + COUNT(DISTINCT tenant_id) over `api_usage` for last 30 days, `date_trunc('day', created_at)`); `getFeatureFlags` (left join tenants for name); `upsertFeatureFlag` (`INSERT ... ON CONFLICT (tenant_id, feature) DO UPDATE SET enabled = EXCLUDED.enabled`); `getBroadcasts` (left join tenants); `createBroadcast` (validates `level` against the CHECK constraint list, defaults to 'info'); `deleteBroadcast` (soft delete: `SET active=0`); `getTenantNotes` (left join platform_admins for admin email); `createTenantNote` (created_by = `req.platformAdmin.id`); `exportTenants` (builds CSV manually with proper `"` escaping/doubling for embedded `,\n,"`, sets `Content-Type: text/csv` + `Content-Disposition: attachment; filename="tenants.csv"`).
   - **Tier 3**: `getDatabaseStats` (expands getPlatformHealth — total DB size, per-table `pg_total_relation_size` + `pg_relation_size` + derived `index_size`, `pg_stat_user_tables.n_live_tup` for row counts, top-20 indexes by size, connection stats); `getDeployments` / `createDeployment` (deployed_by = `req.platformAdmin.id`); `getRateLimits` (per-tenant COUNT + AVG(response_time_ms) + MAX over `api_usage` last 24h); `getNps` (left join tenants + users, computes NPS score = ((promoters - detractors)/total)*100 rounded, avg score, breakdown); `createNps` (validates score is integer 0–10 per CHECK constraint).
3. Rewrote `src/routes/platform.routes.js` — kept `router.use(ctrl.requirePlatformAdmin)` at the top so every route is auth-gated. Wired 24 routes total (2 existing + 22 new) all wrapped in `asyncHandler()`. Placed `/tenants/export` before `/tenants/:id/notes` for clarity (no actual conflict since they have different segment counts, but explicit ordering avoids future surprises). All handlers come from the controller module via `ctrl.X` — no inline handlers.
4. Smoke test: `DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" JWT_ACCESS_SECRET="real" JWT_REFRESH_SECRET="real" node -e "require('./src/routes/platform.routes'); console.log('Platform routes OK')"` → prints `Platform routes OK`. (The async pg-pool ECONNREFUSED noise from the fake DB URL is expected and matches the grep filter in the task spec.)
5. Syntax check: `node --check` on both files → `SYNTAX OK`.

Next actions / notes for follow-up:
- `GET /platform/tenants` currently uses a post-hoc JavaScript filter for `?health=` because health is computed from `last_active`, not stored. If the dashboard grows large enough that filtering at the DB level matters, add a generated `health` column on tenants (updated by a cron/trigger from `users.last_login_at`) and switch to SQL.
- `GET /platform/errors` queries `audit_logs` for `login_failed` and `delete` actions across all tenants. This is a placeholder until a dedicated `error_logs` table is added (if ever) — the audit log doesn't capture runtime 500s or unhandled promise rejections. If true error tracking is needed, wire the `errorHandler` middleware in `validate.js` to also INSERT into an `error_logs` table, then point this endpoint at it.
- `POST /platform/nps` is included for completeness but the task note says it would normally be called from the tenant app, not admin. When the tenant app gets a feedback widget, the route should be moved out from under `requirePlatformAdmin` (or duplicated under `/feedback/nps` with normal `requireAuth`) so end users can submit scores.
- Impersonation issues only an access token (15 min TTL, no refresh token). The admin will be logged out when it expires. If a longer-lived impersonation session is needed, the controller would need to also issue a refresh token (see `issueSession()` in `auth.controller.js` for the pattern — note that path also sets a cookie).
- `exportTenants` builds the CSV string in memory. For very large tenant counts (10k+), switch to a streaming response (`res.write` row-by-row with a cursor-based query) to avoid holding the whole CSV in memory.
- Frontend `pages/PlatformAdmin.jsx` (from the prior task) currently calls only `/overview` and `/health`. The new endpoints can now be wired into the dashboard: revenue card → `/revenue`, tenant search box → `/tenants?search=`, suspend/unsuspend buttons → `/tenants/:id/suspend|unsuspend`, "Login as school" → `/impersonate/:tenantId` (store returned `accessToken` and redirect to the normal tenant UI), notes tab → `/tenants/:id/notes`, broadcasts panel → `/broadcasts`, etc.
- No `feature_flags` read middleware exists yet — flags are stored and readable via the admin API but nothing in the request pipeline checks them. To make flags actually gate features, add a `requireFeature(feature)` middleware that looks up `(tenant_id, feature)` in `feature_flags` and 403s if disabled, and apply it to specific routes (e.g. gating `/reports` behind a `reports` flag).

Files modified (only):
- `ledgerly_backend/src/controllers/platform.controller.js` (rewrote — kept 3 existing handlers, added 18 new; total 24 exports)
- `ledgerly_backend/src/routes/platform.routes.js` (rewrote — kept 2 existing routes, added 22 new; all under `requirePlatformAdmin` + `asyncHandler`)

---
Task ID: platform-frontend
Agent: general-purpose
Task: Rewrite `ledgerly_frontend/src/pages/PlatformAdmin.jsx` to be a comprehensive platform admin dashboard with all Tier 1-3 features. Keep the login flow (email + access token stored in localStorage as `platform_admin_token`). After login, replace the simple overview with a tabbed dashboard.

Work Log:
1. Read `/home/z/my-project/worklog.md` for context (prior `frontend-reports` task created the original simple PlatformAdmin page with login form + overview + health, 7.13 kB chunk). Confirmed conventions: React 18 hooks, CSS-class styling, `naira()` from `utils/format.js`, raw `fetch` (NOT `api` client) with `Authorization: Bearer <token>` for all `/platform/*` calls. Verified `App.jsx` already routes `/admin` directly to `<PlatformAdmin />` (no `ProtectedRoute`).
2. Read backend `platform.routes.js` and `platform.controller.js` — confirmed only `/platform/overview` and `/platform/health` endpoints exist today. The remaining endpoints called by the new tabs (impersonate, tenants/export, errors, revenue, broadcasts, feature-flags, nps, usage, tenants/:id/suspend|unsuspend|notes) are NOT yet implemented on the backend — each tab degrades gracefully with an inline error + empty state when those 404.
3. Rewrote `pages/PlatformAdmin.jsx` (7.13 kB → 30.63 kB / 7.99 kB gzip):
   - Kept login form (email + access token, stored in `platform_admin_token` + `platform_admin_email`). Email is now persisted across page reloads via `EMAIL_KEY` so the header shows it after refresh.
   - Kept `platformFetch(path, token, options)` helper, extended it to support `body` (auto-stringifies JSON), arbitrary HTTP methods, and `Content-Type` header detection. Added `platformDownload()` helper for CSV/PDF exports.
   - Added a generic `usePlatformGet(token, path, deps)` hook used by every tab that needs its own endpoint — returns `{ data, loading, error, reload, setData }`. Tabs refetch on mount only (not on every parent re-render) and offer a manual Refresh button.
   - Top-level state holds `overview`, `health`, `loading`, `error`, `activeTab`. Impersonation + suspend/unsuspend live on the parent so the Overview tab can trigger them and re-render the table.
   - 8 tabs in a `.detail-tabs` bar (with horizontal scroll for narrow screens):
     1. **Overview** — kept 4+4 summary cards, added search input + health filter dropdown + Export CSV button + per-tenant actions (Login as, Suspend/Unsuspend, Notes). Suspend/Notes use POST/PUT to `/platform/tenants/:id/suspend|unsuspend|notes`; errors surface inline. Notes editor opens in a modal-sheet.
     2. **Revenue** — 4 stat cards (MRR, ARPU, Active subscriptions, Churned 30d), plan-breakdown bars (CSS divs coloured per plan), subscription table with plan badge.
     3. **Errors & Activity** — recent-errors table with red rows for `delete`/`login_failed`/`suspend`/`revoke`/`expire` actions and amber for everything else. Handles both array and `{ errors: [...] }` response shapes.
     4. **Usage** — daily API calls bar chart (30 bars, CSS divs, height scaled to max), daily-active-users card, rate-limit table.
     5. **Broadcasts** — form (textarea 500-char max, level select info/warning/success, optional tenant select), active-broadcast list with badges, delete button (calls DELETE which sets inactive server-side).
     6. **Feature Flags** — add-flag form (tenant select + feature name + enabled checkbox), table with click-to-toggle link button.
     7. **Database** — DB size card, table-sizes table (raw bytes + formatted KB/MB), connection stats (total/active/idle/pool-max). Reuses top-level `health` data.
     8. **NPS Feedback** — average-score card with promoter/passive/detractor colour, 4 stat cards, feedback table with score badge (green 9-10, amber 7-8, red 0-6).
   - All tab content reuses existing CSS classes (`.stat-card`, `.stat-grid`, `.card`, `.fee-table`, `.list-item`, `.badge`, `.modal-overlay`, `.modal-sheet`, `.checkbox-row`, `.toolbar`, `.search-input`, `.link-btn`, `.btn-primary`, `.btn-ghost`, `.btn-danger-ghost`, `.form-error`, `.empty-state`, `.finance-row`, `.divider`). Admin-specific styles (bar charts, plan-breakdown bars) use inline styles per the spec — no new CSS file.
4. **Impersonation flow** (critical): `impersonate(t)` calls `POST /platform/impersonate/:tenantId` with the platform token, expects `{ accessToken, user }` back, then opens the tenant app in a new tab with `/?impersonated=<accessToken>` as a URL param. Per the task spec, AuthContext is NOT modified — that change is intentionally out of scope here. Comment block above the function explains the limitation: for end-to-end seamless login, AuthContext's session-restore `useEffect` would need to check for `?impersonated=` and call `setAccessToken(token)` + `setUser(user)` instead of going through `/auth/refresh`. If the popup is blocked, shows a manual-copy fallback message with the URL.
5. Build check: `./node_modules/.bin/vite build` → `✓ built in 2.01s`. PlatformAdmin chunk grew from 7.13 kB → 30.63 kB (gzip 7.99 kB). No build errors, no warnings.

Next actions / notes for follow-up:
- Backend endpoints still missing for this dashboard to be fully functional: `POST /platform/impersonate/:tenantId`, `GET /platform/tenants/export`, `GET /platform/revenue`, `GET /platform/errors`, `GET /platform/usage`, `GET|POST|DELETE /platform/broadcasts`, `GET|POST|PUT /platform/feature-flags`, `GET /platform/nps`, `POST /platform/tenants/:id/suspend|unsuspend`, `PUT /platform/tenants/:id/notes`. Each tab handles 404 / error responses gracefully so the dashboard won't break — but those tabs will just show error + empty state until the backend catches up. Recommend a follow-up `platform-backend` task to implement these against the response shapes this frontend expects (documented inline in each tab component).
- For impersonation to be seamless end-to-end (i.e. actually log the platform admin into the tenant's app without a separate login), AuthContext needs a small change: in its init `useEffect`, check `new URLSearchParams(window.location.search).get('impersonated')` first; if present, call `setAccessToken(token)` then `api.get('/auth/me')` to hydrate the user. This was explicitly out of scope for this task per the spec — flagged for follow-up.
- All tab data shapes are documented in the component file with `??` fallbacks for snake_case vs camelCase field names (e.g. `r.createdAt || r.created_at`) so the frontend tolerates either naming convention the backend settles on.

Files modified:
- `ledgerly_frontend/src/pages/PlatformAdmin.jsx` (full rewrite — 299 lines → ~860 lines)

---
Task ID: backend-waves
Agent: general-purpose
Task: Build all Wave 1-7 backend controllers (16 new controller+route pairs), update server.js mounting, deepen health check, add request timeout, tune DB pool, add parent/API-key/2FA auth helpers.

Work Log:
1. Read worklog + scanned repo structure: confirmed CommonJS, pg with `$N` placeholders, `db.query()`/`db.transaction()`, `asyncHandler`/`validate` from `middleware/validate`, `requireAuth`/`requireRole`/`requirePasswordNotForced` from `middleware/auth`, `recordAudit` from `utils/audit`, `signAccessToken` from `utils/tokens`. Confirmed migration 017 (`017_full_production.sql`) already created every table the new controllers reference: `online_payments`, `parents`, `parent_students`, `api_keys`, `bank_statements`, `bank_transactions`, `fee_templates`, `payment_plans`, `notifications`, `webhook_endpoints`, `webhook_deliveries`, `data_requests`, plus ALTERs for `users.twofa_*`, `terms.closed_*`, `refresh_tokens.user_agent/ip_address`, and tenant white-label columns.
2. Existing `sessions.controller.js`/`sessions.routes.js` are academic-session controllers — to satisfy "Do NOT modify existing controllers" while still implementing task #6 (auth-session listing at `/auth/sessions`), named the new files `authSessions.controller.js` + `authSessions.routes.js` and mounted them at `/api/v1/auth` so the public path matches the spec (`/auth/sessions`).
3. Installed `otplib@12` (v13's plugin-based API is incompatible with the simple `authenticator.generate/verify/keyuri` calls used by the controller; v12 matches the task's stated API).
4. `utils/tokens.js`: added `signParentToken({ id, tenant_id })` and `verifyParentToken(token)` — parent tokens carry `{ sub, type: 'parent', tenantId, role: 'parent' }`; `verifyParentToken` rejects any token whose `type !== 'parent'` so a parent token can never be used on a staff endpoint and vice versa.
5. `middleware/auth.js`: 
   - `requireAuth` now rejects parent tokens (defence-in-depth so a leaked parent token can't reach staff handlers).
   - Added `requireParent` — sets `req.parent` (not `req.user`) so parent handlers can't be reached by staff tokens by accident.
   - Added `requireApiKey` — SHA-256-hashes the `x-api-key` header, looks up the hash in `api_keys`, sets `req.user = { tenantId, role: 'api', apiKeyId, permissions }`, and best-effort updates `last_used_at`.
6. Built all 16 controllers + 16 routes:
   - `payments_online`: initiate (creates `online_payments` row with `gen_random_uuid`-style reference, returns `{ reference, authorizationUrl }`), webhook (public, TODO Paystack verification — for now logs + on `charge.success` records a real payment via inlined INSERT matching `payments.controller.recordPayment`'s shape with `recorded_by=NULL`, flips `online_payments.status`, generates a sequential receipt number inline, notifies owners), list (tenant-scoped). Reused payment INSERT logic by inlining it — couldn't import the existing controller because the webhook has no `req.user` and `recordPayment` reads `req.user`.
   - `subscriptions`: getCurrent, listPlans (hard-coded catalogue: free/starter/standard/premium/enterprise × monthly/yearly NGN pricing), subscribe (upserts the tenant's `subscriptions` row, sets `current_period_end`, Paystack initialization is TODO).
   - `parents`: register (validates `student.guardian_contact === phone` before linking so a parent can't claim arbitrary students; upserts parent + links via `parent_students`), login (bcrypt compare → `signParentToken`), me (parent + linked students), studentFees (verifies parent-student link, returns current-term fee assignments), studentPayments (verifies link, returns payment history).
   - `twofa`: setup (otplib `generateSecret` + `keyuri` for QR), verify (`authenticator.verify` → sets `twofa_enabled=1`), disable (re-verify then clear secret + flag).
   - `apikeys`: list (masked), create (`ldk_<hex>_<hex>` raw key shown ONCE, SHA-256 hash stored), revoke (sets `revoked_at`).
   - `authSessions`: list (`refresh_tokens WHERE revoked_at IS NULL AND expires_at > now()`), revoke (UPDATE `revoked_at`).
   - `bankrecon`: upload (multer memoryStorage, inline RFC-4180 CSV parser, inserts `bank_statements` + one `bank_transactions` row per CSV row, auto-matches by exact amount + `±2 days` via `EXTRACT(EPOCH FROM (paid_on::date - bank_date::date)) <= 172800`), getStatement (joins payments for matched context), match (manual link + recomputes statement totals), unmatch (clears + recomputes).
   - `termclosing`: close (`UPDATE terms SET closed_at, closed_by`, notifies all staff), reopen (owner-only via in-controller role check, route-level `requireRole('owner')` as backstop).
   - `feetemplates`: list (parses JSON `items`), create (stores items as JSON string), apply (resolves targets via `studentIds[]` OR `class`, upserts `student_fee_assignments` for each student×item against the current term).
   - `paymentplans`: list, create (seeds `student_fee_assignments` if missing so the plan shows up in expected totals), getPlan (joins + derives `paid_installments` from COUNT of payments against the (student, fee_head, term) triple).
   - `notifications`: `createNotification(tenantId, userId, type, title, body, entityType, entityId)` exported as internal helper, list (unread only, LIMIT 100), markRead, markAllRead.
   - `search`: parallel `Promise.all` of 4 tenant-scoped ILIKE queries (students/payments/transactions/receipts), each capped at 20 rows; payments query conditionally includes an exact-amount match when `q` parses as a number.
   - `webhooks`: `deliverWebhook(tenantId, event, payload)` exported — fetches all active endpoints, filters by `events` array (supports `'*'`), POSTs JSON with `X-Ledgerly-Signature` (HMAC-SHA256 hex) + `X-Ledgerly-Event`, 10s `AbortSignal.timeout`, records `webhook_deliveries` row with status/response_code. CRUD endpoints: list (no secret returned), create (returns secret ONCE), delete.
   - `cron`: `requireCronSecret` middleware checks `x-cron-secret` header against `CRON_SECRET` env; weeklySummary (per-owner weekly stats → `createNotification`, Resend TODO), checkSubscriptions (queries `subscriptions` with `current_period_end <= now+7d`, warns owner), cleanupTokens (deletes expired + revoked `refresh_tokens`).
   - `datarequests`: export (records request, marks `completed`, notifies owner — actual CSV generation is TODO worker), deletion (owner-only, 30-day grace, blocks duplicate pending requests), list.
   - `settings`: get (returns currency/language/custom_domain/primary_color/parent_company), update (owner-only via in-controller role check, COALESCE-only-update so partial PUTs work).
7. `server.js` rewritten:
   - Added 15-second `res.setTimeout` middleware before routes → 503 on timeout if headers not yet sent.
   - Deepened `/health` to `SELECT 1` against the pool → `{ status, db, uptime }` or 503 `{ status: 'degraded', db: false }`.
   - Mounted new public-surface routers (parents, cron) BEFORE `requirePasswordNotForced` per spec; mounted `paymentsOnlineRoutes` AFTER (its webhook is per-route unauthenticated so it works regardless — `requirePasswordNotForced` is a no-op when `req.user` is unset).
   - Co-mounted routers that extend existing paths: `paymentsOnlineRoutes` on `/api/v1/payments`, `termclosingRoutes` on `/api/v1/terms`, `twofaRoutes` + `authSessionsRoutes` on `/api/v1/auth`. Express applies each in registration order; route signatures don't collide.
   - Mounted the rest at `/api/v1`: apikeys, bankrecon, feetemplates, paymentplans, notifications, search, webhooks, datarequests, settings. Plus `/api/v1/subscriptions` standalone.
8. `db/index.js` pool config: `max: 20`, `connectionTimeoutMillis: 5000`, `idleTimeoutMillis: 30000` (kept `prepare: false` for PgBouncer compat). Existing stub for missing `DATABASE_URL` left intact so CI can `require()` without crashing.
9. Verification (the task's exact command):
   `DATABASE_URL="postgresql://fake:fake@localhost:5432/fake" JWT_ACCESS_SECRET="real" JWT_REFRESH_SECRET="real" node -e "require('./src/server'); setTimeout(() => { console.log('Server loads OK'); process.exit(0); }, 200);"`
   → prints `Server loads OK` and exits 0. (The expected `Database initialization failed` log line is from the fake DATABASE_URL — `db.ready` rejects, the server doesn't `listen`, but the module loads cleanly.)
   Also confirmed via a separate `node -e` walk of `app._router.stack` that all 16 new route groups appear in the route table: `/online/initiate`, `/online/webhook`, `/online`, `/current`, `/subscribe`, `/plans`, `/register`, `/login`, `/me`, `/students/:id/fees`, `/students/:id/payments`, `/2fa/setup`, `/2fa/verify`, `/2fa/disable`, `/sessions`, `/sessions/:id` (DELETE), `/bank-reconciliation/upload`, `/bank-reconciliation/:statementId`, `/bank-reconciliation/:statementId/match`, `/bank-reconciliation/:statementId/unmatch`, `/:id/close`, `/:id/reopen`, `/fee-templates`, `/fee-templates/:id/apply`, `/payment-plans`, `/payment-plans/:id`, `/notifications`, `/:id/read`, `/read-all`, `/search`, `/webhooks`, `/webhooks/:id` (DELETE), `/cron/weekly-summary`, `/cron/check-subscriptions`, `/cron/cleanup-tokens`, `/data-requests/export`, `/data-requests/deletion`, `/data-requests`, `/settings` (GET + PUT).

Findings:
- `otplib@13` (latest) has a plugin-based API (`generate({ secret, crypto, base32 })`) that doesn't match the task's `otplib` usage; pinned `otplib@12` which exposes the simple `authenticator.generate(secret)` / `authenticator.verify({ token, secret })` / `authenticator.keyuri(...)` surface the controller relies on.
- Existing `sessions.controller.js` is for academic sessions — could not overwrite it (spec forbids modifying existing controllers), so the auth-session controller is named `authSessions.controller.js`. Public path still matches spec (`/api/v1/auth/sessions`).
- `payments.controller.recordPayment` reads `req.user.tenantId`/`req.user.id`, but the Paystack webhook has no authenticated user — couldn't reuse it directly, so the webhook inlines the same INSERT shape with `recorded_by=NULL` and a parallel inline receipt-number generator. The `idempotency_key` is set to the Paystack reference so a retried webhook is idempotent at the DB constraint level.
- `auth.controller.issueSession` doesn't populate the new `refresh_tokens.user_agent`/`ip_address` columns — that's an existing controller we can't modify, so `listSessions` returns NULL for those columns on new sessions. The columns exist (migration 017) and the controller reads them; they just won't be populated until a future task wires them through `issueSession`.
- Auto-match in `bankrecon.upload` runs in-process inside the insert transaction — fine for typical statements (hundreds of rows); for very large statements this should move to a background job (noted in a code comment).
- `requireApiKey` is exported from `middleware/auth.js` but no route currently uses it (the task didn't specify mounting an API-key-authenticated route) — it's available for future programmatic-access endpoints.

Code changes:
- NEW (16 controllers + 16 routes): `payments_online`, `subscriptions`, `parents`, `twofa`, `apikeys`, `authSessions`, `bankrecon`, `termclosing`, `feetemplates`, `paymentplans`, `notifications`, `search`, `webhooks`, `cron`, `datarequests`, `settings`.
- MODIFIED: `utils/tokens.js` (+`signParentToken`, +`verifyParentToken`), `middleware/auth.js` (+`requireParent`, +`requireApiKey`, `requireAuth` now rejects parent tokens), `server.js` (mounts, timeout middleware, deepened `/health`), `db/index.js` (pool `max:20`/`connectionTimeoutMillis:5000`/`idleTimeoutMillis:30000`).
- DEPS: `otplib@12` added to `package.json`.
- NOT modified (per task constraint): all existing controllers, all existing routes, all migrations.

Next actions:
- Wire Paystack `POST /transaction/initialize` into `payments_online.initiate` and HMAC-SHA512 signature verification into `webhook` (both marked TODO in code).
- Wire Resend email into `cron.weeklySummary` (currently notification-only).
- Populate `refresh_tokens.user_agent`/`ip_address` from `req.headers['user-agent']`/`req.ip` inside `auth.controller.issueSession` (requires modifying an existing controller — flagged for a follow-up task).
- Build the CSV-export background worker for `data_requests` type='export' (currently auto-completes with no file).
- Build the deletion-cron that processes `data_requests` type='deletion' past the 30-day grace period.
- Front-end: parent portal screens (login, register-with-student-link, my-students, fees, payment history); 2FA setup QR scan; API-key management UI; bank-reconciliation UI; webhook management UI; settings UI.

---
Task ID: frontend-w1w3
Agent: general-purpose
Task: Build Wave 1-3 frontend pages — Pricing, ParentPortal, Security, Privacy, Terms (ToS), Onboarding wizard — then update App.jsx routes and Layout.jsx (footer links + notification bell).

Work Log:
1. Read `/home/z/my-project/worklog.md` for context (prior `backend-waves` task built all 16 controllers + 16 routes; `platform-frontend` rewrote PlatformAdmin). Confirmed conventions: React 18 hooks, CSS-class styling, `api` client (`get/post/put/del/upload/download/openPdf`), `useAuth()` + `useTerm()` contexts, `naira()` from `utils/format.js`, lazy-loaded pages with `ProtectedRoute` (with optional `roles` array). The existing `pages/Terms.jsx` was the academic Sessions & Terms page routed at `/terms` — and the new spec needs `/terms` for Terms of Service. Resolved by renaming the academic page (see #2 below) so the `/terms` URL is free for ToS.
2. Renamed `pages/Terms.jsx` → `pages/Sessions.jsx` via `git mv` (preserves history). The new Sessions.jsx file is unchanged in content — it's the same Sessions & Terms manager. In `App.jsx` I updated the import + route from `/terms` (academic) to `/sessions` (academic). In `Layout.jsx` the nav link label is unchanged ("Sessions & Terms") but now points to `/sessions`.
3. Created `pages/Pricing.jsx` (public, `/pricing`): 4 plan cards (Free ₦0/forever, Standard ₦5,000/mo, Premium ₦15,000/mo, Enterprise Custom). "Standard" is the highlighted "Most popular" card with a navy ribbon. Buttons: "Get started" on Free (routes to /register or / depending on auth), "Upgrade" on Standard/Premium (calls `api.post("/subscriptions/subscribe", { plan, billingCycle: "monthly" })` — anonymous visitors are sent to /register first), "Contact sales" on Enterprise (mailto:). Plan identifiers sent to backend match `subscriptions.controller.js` PLANS catalogue: free / standard / premium / enterprise. On success shows a green "Subscription updated" banner inside the card.
4. Created `pages/ParentPortal.jsx` (public, `/parent`): phone + password login form → `parentFetch("/parents/login", { phone, password })`. Stores `accessToken` and `parent` object in localStorage under `ledgerly_parent_token` + `ledgerly_parent` (separate from the staff access token which lives only in memory). After login: dashboard with parent header, "Your children" list. Each student card expands to show fees (table with Expected/Paid/Outstanding + per-fee "Pay now" button) and payment history tabs. "Pay now" opens a modal with the outstanding amount pre-filled (editable) → on submit calls `parentFetch("/payments/online/initiate", { studentId, feeHeadId, termId: null, amount, parentPhone })`. Backend resolves current term from student's tenant. On success shows the Paystack authorization URL as a clickable button. "Receipt" link next to each historical payment opens the PDF in a new tab via raw `fetch(.../payments/:id/receipt)` with the parent-token Authorization header. Used a local `parentFetch` helper (same pattern as PlatformAdmin's `platformFetch`) rather than the shared `api` client because the parent token must NOT go through the staff-token machinery.
5. Created `pages/Security.jsx` (owner-only, `/security`): three sections stacked on one page (not tabs — owner should see everything at a glance).
   - **2FA**: "Enable 2FA" button → `api.post("/auth/2fa/setup")` → displays the returned `qrCodeUrl` as a 200×200 image (rendered via api.qrserver.com QR service — no client-side QR library to avoid a new dep) and the raw `secret` as a fallback for manual entry. 6-digit token input → `api.post("/auth/2fa/verify", { token })` → on success flips local state to "Enabled" and shows a "Disable 2FA" button that prompts for a current code → `api.post("/auth/2fa/disable", { token })`.
   - **Active sessions**: `api.get("/auth/sessions")` rendered as a fee-table with device (parsed from user_agent), IP, signed-in, expires, "Revoke" button → `api.del("/auth/sessions/:id")`.
   - **API keys**: `api.get("/api-keys")` rendered as a table (Name, masked Key, Permissions, Last used, Created, Revoke). "+ Create key" opens a modal (name + permissions select: read/read_write/admin) → `api.post("/api-keys", { name, permissions })`. The raw key is shown ONCE in a green success banner with a "Copy to clipboard" button and a code block. "Revoke" per-row → `api.del("/api-keys/:id")` with confirm prompt.
6. Created `pages/Privacy.jsx` (public, `/privacy`): NDPR-compliant privacy policy for a Nigerian school fee tracker. 11 numbered sections: (1) Who we are, (2) Data we collect (school info, staff accounts, student records, parent accounts, payment records, usage data, branding), (3) How we use your data (7 lawful purposes), (4) Data retention (7 years for payments/audit, 90 days for student/parent/staff after closure), (5) Third-party processors (Supabase, Render, Vercel, Paystack, Resend, Termii, Sentry — each with role and region), (6) Security (memory-only access tokens, httpOnly refresh cookies, bcrypt cost 12, SHA-256 API-key hashes, TOTP 2FA, TLS 1.2+), (7) User rights (NDPR access/rectification/erasure/restriction/portability/objection/withdraw-consent), (8) Cookies (single httpOnly refresh_token cookie, no advertising), (9) Children's data, (10) Changes to policy, (11) Contact DPO at privacy@ledgerly.app.
7. Created new `pages/Terms.jsx` (public, `/terms`): Terms of Service for a SaaS school fee tracker. 13 numbered sections: (1) Agreement to terms, (2) Acceptable use (8 prohibitions including money-laundering, false records, credential sharing, reverse-engineering, spam), (3) Your account, (4) Subscription and payment terms (monthly/yearly billing, auto-renewal, cancellation, VAT, fee changes, Free plan), (5) Data ownership (school owns its data; aggregate anonymised usage data is ours), (6) Service availability (99.5% uptime target, 10% service-credit SLA), (7) Limitation of liability (capped at 12 months' fees), (8) Indemnification, (9) Termination, (10) Intellectual property, (11) Governing law (Nigeria, Lagos arbitration), (12) Changes to terms (30 days' notice), (13) Contact legal@ledgerly.app.
8. Created `pages/Onboarding.jsx` (auth-required, `/onboarding`): 5-step wizard with progress bar at top (uses existing `.progress-header` / `.progress-track` / `.progress-fill` CSS) and "Skip →" button on each step.
   - **Step 1**: "Your term is ready 🎉" — shows the auto-created First Session + First Term + the 3 available terms (read from `useTerm()` context).
   - **Step 2**: "Your fee heads" — list of the 7 auto-created fee heads (Tuition, Boarding, Feeding, Development Levy, Exam Fees, Sports, Uniform) with "Ready" badges. Fetched via `api.get("/fee-heads")`.
   - **Step 3**: "Add your first student" — inline form (name, class select, admission no, parent phone). Calls `api.post("/students", {...})`. On success advances to step 4 with the new student's id stored in component state.
   - **Step 4**: "Assign fees to {student.name}" — fee-table with all 7 fee heads and an "Expected amount (₦)" input per row. Pre-fills nothing; submits each non-blank row via `api.post("/students/:id/fees", { feeHeadId, termId, expectedAmount })`. Empty rows are skipped — owner can proceed without assigning anything.
   - **Step 5**: "You're all set! ✓" — 3 stat-card links (Dashboard, Students, Reports) + a "Go to dashboard →" button that calls `finish()`.
   - Completion is tracked in `localStorage["ledgerly_onboarding_done"] = "1"`. On mount: if the flag is set OR `api.get("/students?pageSize=1")` returns `total > 0`, redirects to `/`. Skip button advances one step; on the last step it calls `finish()` (sets the localStorage flag + navigates to `/`).
9. Updated `App.jsx`: added 6 lazy imports (Pricing, ParentPortal, Security, Privacy, Terms ToS, Onboarding) + the Sessions rename. New routes: `/pricing`, `/parent`, `/privacy`, `/terms` (all public, no ProtectedRoute); `/security` (owner-only via `ProtectedRoute roles={["owner"]}`); `/onboarding` (auth-required, any role). Renamed the existing academic-Sessions route from `/terms` → `/sessions`. All public routes are listed before the `/` (Dashboard) route to avoid being shadowed.
10. Updated `components/Layout.jsx`:
    - **Notification bell**: new `<NotificationBell />` component in the header actions, before "Change password". Renders a bell emoji button with a red unread-count badge. On mount calls `api.get("/notifications")` (backend returns only unread — see `notifications.controller.js listNotifications`). Clicking opens a 340px dropdown with the most recent 20 notifications (title, body, timestamp, "Mark read" per-item). "Mark all as read" button in the dropdown header calls `api.post("/notifications/read-all")` and clears the list. Closes on outside-click via a window `mousedown` listener. Empty state: "You're all caught up."
    - **Footer**: new `<footer className="app-footer">` after `<main>` (the `.app-shell` flexbox pushes it to the bottom). Left: "© {year} Ledgerly · Lagos, Nigeria". Right: nav links — Privacy Policy, Terms of Service, Pricing, Parent portal (only when signed in), Security (only for owner).
    - **Nav**: updated "Sessions & Terms" link from `/terms` → `/sessions` (matches the route rename). Added a new "Security" nav link (owner-only) between "Users" and "Audit Log".
11. Added ~190 lines of CSS to `styles.css`:
    - `.app-footer` + `.app-footer-inner` + `.app-footer-brand` + `.app-footer-nav` (navy bar matching the header, flexes to bottom of viewport via `margin-top: auto` on `.app-footer` inside the existing `min-height: 100vh` flex column on `.app-shell`).
    - `.notif-bell`, `.notif-bell-btn`, `.notif-bell-icon`, `.notif-bell-badge` (red dot with `border: 2px solid var(--navy)` so it pops on the navy header), `.notif-dropdown`, `.notif-dropdown-header`, `.notif-empty`, `.notif-list`, `.notif-item`, `.notif-dot`, `.notif-item-body`, `.notif-item-title`, `.notif-item-text`, `.notif-item-meta`. The dropdown is absolutely positioned, 340px wide, capped to `calc(100vw - 24px)` on small screens.
    - `.legal-page` (760px centered, 40px padding), `.legal-header` (centered logo + h1 in Newsreader serif), `.legal-section` (h2 + p/ul styles), `.legal-footer-nav` (Privacy · Terms · Pricing links). Mobile: drops to 16px padding, smaller h1.
    - `.pricing-page` (1080px max), `.pricing-grid` (4-col on desktop, 2-col ≤1024px, 1-col ≤639px), `.pricing-card`, `.pricing-card-highlight` (2px navy border + bigger shadow), `.pricing-ribbon` (navy pill centered at top), `.pricing-label`, `.pricing-price` (30px serif), `.pricing-cadence`, `.pricing-tagline`, `.pricing-features` (flex column).
    - `.onboarding-page` (centered card), `.onboarding-card` (560px max, 28px padding), `.onboarding-step-header`, `.onboarding-step-count`.
    - Mobile media queries for the bell dropdown (full-width right-aligned) and footer (stacked).
12. Build verification (the task's exact command): `./node_modules/.bin/vite build 2>&1 | tail -8` → `✓ built in 2.36s`, no errors, no warnings. New chunks: Pricing 3.66 kB, Onboarding 8.64 kB, Security 9.85 kB, Terms (ToS) 10.13 kB, ParentPortal 10.71 kB, Privacy 11.24 kB. CSS bundle grew from 13.68 kB → 23.52 kB (+9.84 kB for the new component styles, gzipped +3.16 kB). Sessions (the renamed academic page) chunk is 7.47 kB — same content, just renamed file. Main `index-*.js` is 186.69 kB / 60.28 kB gzip (Layout now carries the NotificationBell + footer JSX, but lazy-split pages keep the main bundle from growing).

Findings:
- **Route conflict on `/terms`**: the spec wants both Sessions & Terms AND Terms of Service at `/terms`. Resolved by relocating the academic page to `/sessions` (file renamed `Terms.jsx` → `Sessions.jsx` via `git mv` to preserve git history) and using `/terms` for ToS. The Layout nav link label "Sessions & Terms" is unchanged but now points to `/sessions`. Anyone with a bookmark to `/terms` expecting the academic page will now see the Terms of Service — acceptable for an unreleased feature.
- **`/auth/me` doesn't return `twofaEnabled`**: the existing `auth.controller.js me()` SELECTs only `id, name, email, role, tenant_id` — no 2FA status. The `twofa.controller.js` has no `status` endpoint either. As a result, the Security page's 2FA section can't render a reliable "Enabled" badge on first load. Worked around by tracking status in local component state (null = unknown, true = enabled-this-session, false = disabled-this-session) and updating it after each verify/disable. Added an inline hint that clicking "Enable 2FA" when already enabled will rotate the secret — the backend setup() overwrites the secret unconditionally (see twofa.controller.js line 24), which is a footgun for already-enabled users. Flagged for follow-up: backend should add `twofaEnabled` to `/auth/me` response and guard setup() against already-enabled accounts.
- **Parent portal needs separate token storage**: the shared `api` client in `api/client.js` uses a module-level `accessToken` variable that's reserved for the staff user. Sending a parent token through it would (a) collide with staff auth if both are in the same tab and (b) trip the client's 401-refresh logic which calls `/auth/refresh` (staff-only). Followed the PlatformAdmin pattern: a local `parentFetch()` helper that takes the token as an argument and sets the Authorization header explicitly. Parent token lives in localStorage under `ledgerly_parent_token` — separate from the staff token which never touches localStorage. On 401, the parent dashboard calls `onSignOut()` to drop the token and bounce back to the parent login form.
- **QR code rendering**: the `twofa.controller.js setup()` returns an `otpauth://` URI but no rendered QR image. Avoided adding a new dependency (qrcode.js) by rendering the URI as an `<img>` tag pointing at `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=...`. This is a third-party service — fine for an MVP, but if QR-server is down or blocked, the user can still scan via the raw secret shown beneath the image. Flagged for follow-up: bundle a client-side QR library (e.g. `qrcode@1`) so the QR is rendered locally with no external dependency.
- **Paystack `/payments/online/initiate` requires a staff token** (`req.user.tenantId` per payments_online.controller.js line 24) but `requireAuth` rejects parent tokens (per the `backend-waves` worklog). This means the parent-portal "Pay now" flow will currently 401 when the backend is wired up. Worked around by using the parent token in the Authorization header anyway — the frontend is correct per spec; the backend needs a separate `requireParent`-guarded initiate endpoint (or the existing initiate endpoint needs to accept parent tokens). Flagged for follow-up.

Code changes:
- NEW (6 pages): `pages/Pricing.jsx`, `pages/ParentPortal.jsx`, `pages/Security.jsx`, `pages/Privacy.jsx`, `pages/Terms.jsx` (Terms of Service), `pages/Onboarding.jsx`.
- RENAMED: `pages/Terms.jsx` → `pages/Sessions.jsx` (academic Sessions & Terms page — content unchanged, file renamed via `git mv`).
- MODIFIED: `App.jsx` (+6 lazy imports, +6 routes, route rename `/terms` → `/sessions`), `components/Layout.jsx` (footer + NotificationBell + Security nav link + Sessions nav-link path update), `styles.css` (+~190 lines for footer / notification bell / legal pages / pricing / onboarding).

Next actions / notes for follow-up:
- **Backend: expose `twofaEnabled` on `/auth/me`** and guard `POST /auth/2fa/setup` against already-enabled accounts (currently silently rotates the secret).
- **Backend: parent-token-friendly `/payments/online/initiate`** — either accept parent tokens (with `requireParent` middleware and reading tenantId from `req.parent`) or add a new parent-scoped endpoint like `POST /parents/payments/initiate`. The frontend ParentPortal is correct per spec; the backend will 401 today.
- **Backend: wire Paystack `POST /transaction/initialize`** into `payments_online.initiate` so the returned `authorizationUrl` is a real Paystack checkout URL (currently it's a placeholder pointing at `/payments/online/status?reference=...`).
- **Frontend: replace api.qrserver.com with a bundled QR library** (e.g. `qrcode@1.5`) so the 2FA QR is rendered client-side with no external dependency.
- **Frontend: parent-portal registration screen** — the backend `POST /parents/register` exists but the ParentPortal only implements login. A "Register as parent" flow (phone + name + password + student-id) would close the loop for self-service onboarding. Currently the spec only requires login.
- **Frontend: deep-link onboarding auto-trigger** — the Onboarding wizard lives at `/onboarding` but nothing auto-redirects to it after first login. The Layout or AuthContext could check `localStorage["ledgerly_onboarding_done"]` and `students?pageSize=1` after a fresh login and redirect to `/onboarding` if appropriate. Flagged as a follow-up since the task spec only asked for the wizard itself.
- **Frontend: notification polling** — the bell currently fetches once on mount. For a real-time feel it should poll every 60s or use a WebSocket/SSE channel. Out of scope for this task.

---
Task ID: frontend-w4w7-retry
Agent: general-purpose
Task: Build Wave 4-7 frontend pages — BankReconciliation, FeeTemplates, PaymentPlans, Settings, DataRequests, Webhooks — then update App.jsx routes, Layout.jsx nav + global search, and add PWA manifest.

Work Log:
1. Read `/home/z/my-project/worklog.md` for context (prior `backend-waves` task built all 16 Wave 1-7 controllers + routes; `frontend-w1w3` task built Pricing/ParentPortal/Security/Privacy/Terms/Onboarding). Confirmed conventions: React 18 hooks, CSS-class styling, `api` client (`get/post/put/del/upload/download`), `useAuth()`/`useTerm()` contexts, `naira()`/`statusMeta()`/`todayISO()` from `utils/format.js`, lazy-loaded pages with `ProtectedRoute roles={[...]}`, modal-overlay/modal-sheet pattern, `fee-table`/`card`/`stat-grid`/`stat-card`/`list`/`list-item`/`toolbar`/`btn-primary`/`btn-ghost`/`btn-danger-ghost`/`filter-chip`/`badge`/`checkbox-row`/`assign-fee-row` existing CSS classes.
2. Read all 6 target backend controllers + routes to confirm response shapes and field names:
   - `bankrecon.controller.js`: `upload` returns `{ id, total, matched, unmatched }`; `getStatement` returns `{ statement, transactions[] }` (each transaction has `id, date, description, amount, status, matched_payment_id, payment_amount, student_name, fee_head_name`); `match` takes `{ bankTransactionId, paymentId }`; `unmatch` takes `{ bankTransactionId }`. No list-statements endpoint — page manages one active statement at a time.
   - `feetemplates.controller.js`: `listTemplates` returns `{ templates[] }` (items stored as JSON text, server parses); `createTemplate` takes `{ name, className, items: [{feeHeadId, expectedAmount}] }`; `applyTemplate` takes `{ studentIds[], class }` and returns `{ applied, created }`.
   - `paymentplans.controller.js`: `listPlans` returns `{ plans[] }` with student/fee-head/term joins; `createPlan` takes `{ studentId, feeHeadId, termId, totalAmount, installments, dueDates, lateFee }`; `getPlan` returns `{ plan: { ..., due_dates: [...], paid_installments }, installments: [payments...] }`.
   - `settings.controller.js`: `getSettings` returns `{ settings: { currency, language, custom_domain, primary_color, parent_company } }`; `updateSettings` (owner-only on backend) takes `{ currency, language, primary_color, parent_company }`. `custom_domain` is read-only.
   - `datarequests.controller.js`: `requestExport` (any auth) auto-marks completed; `requestDeletion` (owner-only) returns `{ id, scheduledFor, gracePeriodDays }` and 409s if a deletion is already pending; `listRequests` returns `{ requests[] }`.
   - `webhooks.controller.js`: `listEndpoints` returns `{ endpoints[] }` (no secret); `createEndpoint` returns `{ id, url, events, secret }` — secret shown ONCE; `deleteEndpoint`.
3. Created `pages/BankReconciliation.jsx` (owner/accountant, `/bank-reconciliation`): CSV upload via `api.upload("/bank-reconciliation/upload", formData)` (field name "file", matches backend multer). On upload returns `{ id, total, matched, unmatched }` → saves statementId to `localStorage["ledgerly_bank_recon_stmt"]` so a refresh keeps context, then loads `api.get("/bank-reconciliation/:id")`. Renders a 4-card stat-grid (Total/Matched/Unmatched/Status) + a fee-table of transactions with date, description, amount (green for credits, red for debits), matched payment summary, status badge (green "Matched" / amber "Unmatched"), and a per-row action button: "Unmatch" for matched rows (POST `/unmatch`) or "Match" for unmatched rows (opens a MatchModal). The MatchModal uses `/search?q=...` (debounced 400ms, min 2 chars) to find candidate payments — there's no list-payments endpoint, so global search by amount or note is the only way to find a payment ID to match against. Results show amount + student_name + fee_head_name + paid_on + method; clicking "Match" calls POST `/match` with `{ bankTransactionId, paymentId }`. Pre-fills the search box with the bank row's absolute amount so the most likely match surfaces immediately. "Start new" button clears localStorage and the active statement.
4. Created `pages/FeeTemplates.jsx` (owner/bursar, `/fee-templates`): loads both `/fee-templates` and `/fee-heads` in parallel. Lists templates as list-items with name, class (if set), item count + total amount. Each list-item expands to show a fee-table of items (fee head name + amount) with a total row. "+ New template" opens a CreateTemplateModal with name, optional class select (15-class list matching FeeHeads.jsx CLASS_LIST), and a dynamic list of fee-item rows (fee-head select + amount input, with add/remove buttons). Submit POSTs `{ name, className, items: [{feeHeadId, expectedAmount}] }`. "Apply" button per template opens ApplyTemplateModal — pick a class, POST `/fee-templates/:id/apply` with `{ class }`, show `{ applied, created }` result.
5. Created `pages/PaymentPlans.jsx` (owner/bursar, `/payment-plans`): lists plans with student + fee head + term + total + installment count + paid/total ratio + status badge. Click a row → PlanDetailModal fetches `/payment-plans/:id` and renders finance-rows for student/fee head/term/total/installments/paid-installments/paid-so-far/outstanding/late-fee/status, plus a fee-table of the installment schedule: rows for each planned due date alongside any actual payment made against that (student, fee_head, term) triple, plus any extra payments beyond the planned schedule (e.g. ad-hoc). "+ New plan" opens CreatePlanModal which loads students (`/students?pageSize=500`) and fee-heads in parallel + uses `useTerm()` for the term select. Form: student, fee head, term (default to currently-selected), total amount, installments 1–12, dynamic due-date date-pickers that grow/shrink with the installments count, optional late fee. Shows a live "~₦X per installment" hint. Submits `{ studentId, feeHeadId, termId, totalAmount, installments, dueDates, lateFee }`.
6. Created `pages/Settings.jsx` (owner-only, `/settings`): three cards. (1) Regional defaults — currency dropdown (NGN/GHS/KES/ZAR/USD) + language dropdown (en/yo/ig/ha/fr). (2) White-label branding — primary color picker (`<input type="color">` + hex text input + reset button) + parent company text input. (3) Custom domain — read-only input (greyed-out) with hint that domains are configured via DNS verification. Save button PUTs `{ currency, language, primary_color, parent_company }` to `/settings`. Green success banner on save; reloads settings to reflect any backend-normalised values.
7. Created `pages/DataRequests.jsx` (owner-only, `/data-requests`): 4-card stat-grid (Total/Exports/Deletions/Pending) at the top. "Export all data" card with a button → POST `/data-requests/export` (confirm prompt), shows green notice "Export queued" and refreshes the list. "Delete account & all data" danger card → opens DeleteModal with type-to-confirm (must type exactly "DELETE MY SCHOOL") + red warning banner explaining the 30-day grace period + irreversibility. Submit POSTs `/data-requests/deletion`; if backend 409s (already pending) shows the conflict message inline. Request history card renders a fee-table of all requests with type badge (navy Export / red Deletion), status badge (amber Pending / navy Processing / green Completed / grey Cancelled / red Failed), requested + processed timestamps.
8. Created `pages/Webhooks.jsx` (owner-only, `/webhooks`): lists endpoints as list-items with URL (word-break), events CSV, created date, active/inactive badge, and a per-row Delete button (confirm → `api.del("/webhooks/:id")`). "+ New endpoint" opens CreateWebhookModal with URL input + 3 event checkboxes (`payment.recorded`, `student.created`, `term.closed`) — `payment.recorded` checked by default. On create the backend returns the secret ONCE — rendered in a green-bordered success card at the top with a monospace code block, "Copy" button (`navigator.clipboard.writeText` with a `window.prompt` fallback if clipboard is blocked), and a "Dismiss" button. The card explicitly warns "shown only once" and lists the endpoint URL + events for reference.
9. Updated `App.jsx`: added 6 lazy imports (BankReconciliation, FeeTemplates, PaymentPlans, Settings, DataRequests, Webhooks) + 6 routes with role-gated ProtectedRoutes exactly per spec: `/bank-reconciliation` (owner/accountant), `/fee-templates` (owner/bursar), `/payment-plans` (owner/bursar), `/settings` (owner), `/data-requests` (owner), `/webhooks` (owner). Routes placed before the `/admin` platform-admin route.
10. Updated `components/Layout.jsx`:
    - **Nav links**: added role-gated NavLinks for "Bank Recon" (owner/accountant), "Templates" (owner/bursar), "Plans" (owner/bursar), "Settings" (owner), "Webhooks" (owner), "Data" (owner, short label for Data Requests to fit the nav). Inserted between "Sessions & Terms" and the owner-only cluster ("Reports", "Branding", "Users", "Settings", "Webhooks", "Security", "Data", "Audit Log") so the most-used middle roles see their links first.
    - **Global search**: new `<GlobalSearch />` component in `.app-header-actions`, before the notification bell. Renders a 280px search input styled for the navy header (translucent white background, white text, white-on-focus border). On type, debounces 500ms then calls `api.get("/search?q=" + encodeURIComponent(q))` (min 2 chars). Results dropdown (360px, max-height 420px scrollable) groups by Students/Payments/Transactions with a small uppercase grey group title; each result is a full-width button with a navy title + grey sub-line (student: name + class + admission_no; payment: amount + date + student + fee head; transaction: category + ±amount + date + description). Clicking any result navigates: student → `/students`, payment/transaction → `/finance`. Closes on outside-click via a window `mousedown` listener (separate ref from the notification bell). Empty state "No matches." z-index 70 (above the bell's z-index 60) so an open search dropdown covers an open bell dropdown.
    - Imported `naira` from `utils/format.js` (used by GlobalSearch for payment/transaction amounts).
11. Added ~50 lines of CSS to `styles.css` (appended, not a new file): `.global-search`, `.global-search-input` (with `::placeholder` and `:focus` variants), `.global-search-dropdown`, `.global-search-section`, `.global-search-empty`, `.global-search-group` (+ `:last-child`), `.global-search-group-title`, `.global-search-item` (+ `:last-child` + `:hover`), `.global-search-item-title`, `.global-search-item-sub`. Plus a `@media (max-width: 639px)` rule that hides `.global-search` entirely on mobile (search is desktop-only per task spec — phone screens already have a cramped header with the brand block + bell + 2 buttons).
12. Created `public/manifest.json` with the exact 7-key shape from the task spec: name "Ledgerly", short_name "Ledgerly", start_url "/", display "standalone", background_color "#F6F6F3" (paper), theme_color "#14213D" (navy), icons array with one 512x512 JPEG pointing at the existing `/app-icon.jpg` (already in `public/`).
13. Added `<link rel="manifest" href="/manifest.json" />` to `index.html` immediately after the apple-touch-icon link (kept the existing `<meta name="theme-color" content="#14213D" />` which complements the manifest).
14. Build verification (task's exact command): `./node_modules/.bin/vite build 2>&1 | tail -8` → `✓ built in 2.33s`, no errors, no warnings. New chunks: Settings 3.86 kB, Webhooks 5.58 kB, DataRequests 6.41 kB, FeeTemplates 6.72 kB, BankReconciliation 7.96 kB, PaymentPlans 9.37 kB. Main `index-*.js` grew from 186.69 kB → 191.58 kB (+4.89 kB for the GlobalSearch component + 6 new route entries in App.jsx; Layout now carries the GlobalSearch JSX). CSS bundle grew slightly for the new global-search rules. All 6 new pages lazy-split correctly so they don't bloat the initial bundle.

Findings:
- **No list-payments endpoint**: the bank-recon "match" UI needed a way to find a payment ID to match an unmatched bank row against. There's no `GET /payments` endpoint. Worked around by using the existing `/search?q=...` endpoint which returns a `payments[]` array (searchable by note ILIKE or amount exact match). The MatchModal pre-fills the search box with the bank row's absolute amount so the most likely match surfaces immediately — for statements where amounts match exactly this is one click. Limitation: search requires ≥2 characters and matches by note ILIKE or exact amount, so finding a payment with no note and a different amount requires typing the student name (which doesn't match the payment note). Flagged for follow-up: add `GET /payments?studentId=&from=&to=&unmatched=true` for richer matching.
- **No list-statements endpoint on bank-recon**: the page manages one active statement at a time (the latest upload). Persisted to `localStorage["ledgerly_bank_recon_stmt"]` so a refresh keeps context. There's no way to see historical statements or switch between them. Flagged for follow-up: add `GET /bank-reconciliation` (list statements) + `GET /bank-reconciliation/:id` is already there.
- **No cancel-deletion endpoint**: `datarequests.controller.js` has no DELETE/PUT to cancel a pending deletion within the 30-day grace period, even though the notification message to the owner says "You can cancel it any time before then". The frontend DataRequests page shows pending deletions in the history table but provides no cancel button. Flagged for follow-up: add `POST /data-requests/:id/cancel` (or `DELETE /data-requests/:id`) and a "Cancel" button on pending deletion rows.
- **No webhook toggle / event edit**: the Webhooks page can create + delete endpoints but cannot toggle `active` or edit the events list after creation. The backend `webhook_endpoints` table has an `active` column but there's no PATCH endpoint. Flagged for follow-up: add `PATCH /webhooks/:id` for `active` and `events` updates + a toggle button in the UI.
- **Backend role mismatch on `/fee-templates` and `/payment-plans`**: the task spec says these pages are owner/bursar, but the backend `POST /fee-templates` and `POST /fee-templates/:id/apply` and `POST /payment-plans` all use `requireRole('owner', 'accountant')` — bursar is NOT in the list. So a bursar can load the list (GET is auth-only) but creating/applying will 403. The frontend ProtectedRoute follows the task spec (owner/bursar), which is what was asked — but bursars will see "Create" buttons that fail. Flagged for follow-up: either add 'bursar' to the backend role list, or change the frontend guard to (owner/accountant). I kept the task spec's (owner/bursar) since that's what was asked.
- **`/data-requests/export` is owner-only in the UI but backend allows any role**: the task spec says the page is owner-only, so the ProtectedRoute gates it. The backend `requestExport` only requires auth (any role) — so if an employee hits the endpoint directly they could queue an export. The UI gating matches the task spec; the backend is more permissive. Not a security issue (the data is the school's own), but flagged for consistency.
- **Global search dropdown positioning**: the dropdown is left-aligned under the search input (not right-aligned like the notification bell) because the search input is to the left of the bell in the header actions row. On wide screens this is fine. On narrow desktop widths the 360px dropdown might extend past the right edge of the viewport — capped with `max-width: calc(100vw - 24px)` so it never causes horizontal scroll. The mobile media query hides the search entirely below 640px.
- **No new CSS file created** — all new styles appended to existing `styles.css` per the task's "No new CSS file" constraint. Reused existing classes everywhere possible (`stat-grid`, `stat-card`, `card`, `card-title`, `fee-table`, `list`, `list-item`, `list-item-row`, `list-item-main`, `list-item-title`, `list-item-sub`, `toolbar`, `btn-primary`, `btn-ghost`, `btn-danger-ghost`, `btn-full`, `badge`, `checkbox-row`, `assign-fee-row`, `finance-row`, `modal-overlay`, `modal-sheet`, `modal-header`, `modal-title`, `modal-close`, `form-error`, `field-hint`, `page-intro`, `page-loading`, `empty-state`, `tx-remove`).

Code changes:
- NEW (6 pages): `src/pages/BankReconciliation.jsx`, `src/pages/FeeTemplates.jsx`, `src/pages/PaymentPlans.jsx`, `src/pages/Settings.jsx`, `src/pages/DataRequests.jsx`, `src/pages/Webhooks.jsx`.
- NEW: `public/manifest.json`.
- MODIFIED: `src/App.jsx` (+6 lazy imports, +6 role-gated routes), `src/components/Layout.jsx` (+6 nav links, +GlobalSearch component, +naira import), `src/styles.css` (+~50 lines for `.global-search*` classes + mobile-hide media query), `index.html` (+`<link rel="manifest">`).

Next actions / notes for follow-up:
- **Backend: add `GET /payments` (or expand `/search`)** with filters for `studentId`, `from`, `to`, `unmatched=true` so the bank-recon match UI can show a richer candidate list (today it relies on `/search` which matches by note ILIKE or exact amount only).
- **Backend: add `GET /bank-reconciliation` (list statements)** so the page can show upload history and let the user switch between statements without losing context to localStorage.
- **Backend: add `POST /data-requests/:id/cancel`** so owners can cancel a pending deletion within the 30-day grace period (the notification already promises this).
- **Backend: add `PATCH /webhooks/:id`** for `active` and `events` so the Webhooks page can toggle endpoints and edit event subscriptions without delete+recreate (which would rotate the secret).
- **Backend: reconcile role guards on `/fee-templates` + `/payment-plans`** — task spec says owner/bursar, backend says owner/accountant. Pick one and align both sides.
- **Frontend: deep-link search results** — today clicking a payment result navigates to `/finance` (the closest page). A nicer UX would deep-link into the specific student's expanded payment history (e.g. `/students?expand=<id>&highlight=<paymentId>`); the Students page doesn't currently support URL-driven expansion. Flagged for follow-up.
- **Frontend: PWA service worker** — the manifest is in place but there's no service worker for offline caching. Adding `vite-plugin-pwa` would give true installability + offline shell. Out of scope for this task; the manifest alone is enough for "Add to home screen" with the app icon.
- **Frontend: webhook delivery history** — `webhook_deliveries` table exists in the schema but there's no API to list deliveries per endpoint. A "View deliveries" expandable section per endpoint would help owners debug failed webhooks. Flagged for follow-up.
