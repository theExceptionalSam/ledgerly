const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const logger = require('../utils/logger');

// Bank reconciliation — upload a bank statement CSV, auto-match transactions to
// recorded payments by amount ±2 days, then review and manually fix any misses.
//
// CSV format: header row required. Recognised columns (case-insensitive): date,
// description, amount. Other columns are ignored. Amount may be negative (debit)
// or positive (credit) — only credits are reconciled against payments.

// Minimal RFC-4180-ish CSV parser. Handles quoted fields with embedded commas and
// doubled quotes (""). Good enough for bank exports; for pathological inputs use a
// streaming parser. We intentionally don't pull in a CSV dependency for this.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* swallow — handled by \n */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 0 && r.some((c) => c.trim() !== ''));
}

async function upload(req, res) {
  const { tenantId, id: userId } = req.user;
  if (!req.file) return res.status(400).json({ error: 'No CSV file uploaded' });

  const text = req.file.buffer.toString('utf8');
  const rows = parseCsv(text);
  if (rows.length < 2) return res.status(400).json({ error: 'CSV must have a header row and at least one transaction' });

  // First row is the header — find the columns we care about.
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf('date');
  const descIdx = header.indexOf('description');
  const amountIdx = header.indexOf('amount');
  if (dateIdx === -1 || amountIdx === -1) {
    return res.status(400).json({ error: 'CSV must have at least "date" and "amount" columns' });
  }

  const statementId = randomUUID();
  const txnRows = rows.slice(1);

  // Insert the statement header first, then each transaction row, then auto-match.
  // Auto-match: for each unmatched credit, look for a payment with the same amount
  // and a paid_on within ±2 days of the bank transaction date. We do the matching
  // in-process here (the typical statement is a few hundred rows) — for very large
  // statements this should be moved to a background job.
  let matched = 0;
  let unmatched = 0;
  await db.transaction(async (client) => {
    await db.query(
      `INSERT INTO bank_statements (id, tenant_id, filename, status, total_records, matched, unmatched, uploaded_by)
       VALUES ($1, $2, $3, 'processing', $4, 0, 0, $5)`,
      [statementId, tenantId, req.file.originalname, txnRows.length, userId],
      client
    );

    for (const r of txnRows) {
      const dateStr = (r[dateIdx] || '').trim();
      const description = descIdx !== -1 ? (r[descIdx] || '').trim() : null;
      const amount = parseFloat((r[amountIdx] || '').replace(/[^0-9.\-]/g, ''));
      if (!dateStr || !Number.isFinite(amount)) { unmatched++; continue; }

      const txnId = randomUUID();
      // Try auto-match: same amount, paid_on within ±2 days, not already matched.
      const { rows: matchRows } = await db.query(
        `SELECT p.id FROM payments p
         WHERE p.tenant_id = $1 AND p.amount = $2 AND p.reversed = 0
           AND p.id NOT IN (SELECT bt.matched_payment_id FROM bank_transactions bt WHERE bt.tenant_id = $1 AND bt.matched_payment_id IS NOT NULL)
           AND p.paid_on IS NOT NULL
           AND ABS(EXTRACT(EPOCH FROM (p.paid_on::date - $3::date))) <= 172800
         LIMIT 1`,
        [tenantId, amount, dateStr],
        client
      );
      const matchedPaymentId = matchRows[0]?.id || null;

      await db.query(
        `INSERT INTO bank_transactions (id, statement_id, tenant_id, date, description, amount, matched_payment_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [txnId, statementId, tenantId, dateStr, description, amount, matchedPaymentId, matchedPaymentId ? 'matched' : 'unmatched'],
        client
      );
      if (matchedPaymentId) matched++; else unmatched++;
    }

    await db.query(
      `UPDATE bank_statements SET status = 'completed', matched = $1, unmatched = $2 WHERE id = $3`,
      [matched, unmatched, statementId],
      client
    );
  });

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'bank_statement', entityId: statementId, ipAddress: req.ip, metadata: { filename: req.file.originalname, total: txnRows.length, matched, unmatched } });
  res.status(201).json({ id: statementId, total: txnRows.length, matched, unmatched });
}

async function getStatement(req, res) {
  const { statementId } = req.params;
  const { rows: stmtRows } = await db.query(
    `SELECT * FROM bank_statements WHERE id = $1 AND tenant_id = $2`,
    [statementId, req.user.tenantId]
  );
  const statement = stmtRows[0];
  if (!statement) return res.status(404).json({ error: 'Statement not found' });

  const { rows: transactions } = await db.query(
    `SELECT bt.id, bt.date, bt.description, bt.amount, bt.status, bt.matched_payment_id,
            p.amount AS payment_amount, s.name AS student_name, fh.name AS fee_head_name
     FROM bank_transactions bt
     LEFT JOIN payments p ON p.id = bt.matched_payment_id
     LEFT JOIN students s ON s.id = p.student_id
     LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
     WHERE bt.statement_id = $1
     ORDER BY bt.date DESC, bt.created_at DESC`,
    [statementId]
  );
  res.json({ statement, transactions });
}

async function match(req, res) {
  const { statementId } = req.params;
  const { bankTransactionId, paymentId } = req.body;

  // Verify the statement belongs to this tenant.
  const { rows: stmtRows } = await db.query(`SELECT id FROM bank_statements WHERE id = $1 AND tenant_id = $2`, [statementId, req.user.tenantId]);
  if (!stmtRows[0]) return res.status(404).json({ error: 'Statement not found' });

  // Verify the payment belongs to this tenant and isn't reversed.
  const { rows: payRows } = await db.query(`SELECT id FROM payments WHERE id = $1 AND tenant_id = $2 AND reversed = 0`, [paymentId, req.user.tenantId]);
  if (!payRows[0]) return res.status(404).json({ error: 'Payment not found' });

  const result = await db.query(
    `UPDATE bank_transactions SET matched_payment_id = $1, status = 'matched'
     WHERE id = $2 AND statement_id = $3 AND tenant_id = $4`,
    [paymentId, bankTransactionId, statementId, req.user.tenantId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Bank transaction not found' });

  // Recompute matched/unmatched totals on the statement.
  await db.query(
    `UPDATE bank_statements SET
       matched = (SELECT COUNT(*) FROM bank_transactions WHERE statement_id = $1 AND status = 'matched'),
       unmatched = (SELECT COUNT(*) FROM bank_transactions WHERE statement_id = $1 AND status = 'unmatched')
     WHERE id = $1`,
    [statementId]
  );
  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'update', entityType: 'bank_transaction', entityId: bankTransactionId, ipAddress: req.ip, metadata: { matchedTo: paymentId } });
  res.json({ ok: true });
}

async function unmatch(req, res) {
  const { statementId } = req.params;
  const { bankTransactionId } = req.body;
  const result = await db.query(
    `UPDATE bank_transactions SET matched_payment_id = NULL, status = 'unmatched'
     WHERE id = $1 AND statement_id = $2 AND tenant_id = $3`,
    [bankTransactionId, statementId, req.user.tenantId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Bank transaction not found' });

  await db.query(
    `UPDATE bank_statements SET
       matched = (SELECT COUNT(*) FROM bank_transactions WHERE statement_id = $1 AND status = 'matched'),
       unmatched = (SELECT COUNT(*) FROM bank_transactions WHERE statement_id = $1 AND status = 'unmatched')
     WHERE id = $1`,
    [statementId]
  );
  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'update', entityType: 'bank_transaction', entityId: bankTransactionId, ipAddress: req.ip, metadata: { unmatched: true } });
  res.json({ ok: true });
}

async function listStatements(req, res) {
  const { tenantId } = req.user;
  const { rows } = await db.query(
    `SELECT id, filename, status, total_records, matched, unmatched, created_at
     FROM bank_statements WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  res.json({ statements: rows });
}

module.exports = { upload, getStatement, match, unmatch, listStatements };
