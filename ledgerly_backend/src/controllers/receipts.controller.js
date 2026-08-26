const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { generateReceiptPdf } = require('../utils/receipt-pdf');

// Phase 3: Receipts.
// One receipt per payment. If a receipt already exists for the payment, return
// it instead of creating a duplicate. Receipt numbers are sequential per tenant
// per calendar year, formatted <XXX>-<YYYY>-<NNNNN>.
//
// Race-condition strategy: the receipt number is generated INSIDE the insert
// transaction, after taking a `SELECT ... FOR UPDATE` lock on the tenant's
// receipt rows for the current year. Two concurrent calls into issueReceipt()
// therefore serialize: the second waits for the first to commit, then sees the
// new MAX(receipt_number) and increments from there. (The UNIQUE(tenant_id,
// receipt_number) constraint is a backstop for the very first receipt of a
// year, when no rows exist yet for FOR UPDATE to lock.)

function buildPrefix(tenantName) {
  const year = new Date().getFullYear();
  const prefix = (tenantName || 'LED').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'LED';
  return { prefix, year, pattern: `${prefix}-${year}-%` };
}

// Parses a receipt_number of the form "<XXX>-<YYYY>-<NNNNN>" and returns its
// integer counter. Returns 0 for empty/garbage input (i.e. no prior receipt).
function parseCounter(receiptNumber) {
  if (!receiptNumber) return 0;
  const parts = String(receiptNumber).split('-');
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : 0;
}

async function issueReceipt(req, res) {
  const { tenantId, id: userId } = req.user;
  const { paymentId } = req.params;

  const { rows: paymentRows } = await db.query(`
    SELECT p.*, s.name AS student_name, s.class AS student_class, s.admission_no,
           fh.name AS fee_head_name, u.name AS recorded_by_name, t.name AS term_name
    FROM payments p
    JOIN students s ON s.id = p.student_id
    LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
    LEFT JOIN users u ON u.id = p.recorded_by
    LEFT JOIN terms t ON t.id = p.term_id
    WHERE p.id = $1 AND p.tenant_id = $2
  `, [paymentId, tenantId]);
  const payment = paymentRows[0];

  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.reversed) return res.status(400).json({ error: 'Cannot issue a receipt for a reversed payment' });

  const { rows: tenantRows } = await db.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);
  const tenant = tenantRows[0];

  // Idempotent: if a receipt already exists for this payment, regenerate the
  // PDF from the existing receipt number (no duplicate row, no new number).
  const { rows: receiptRows } = await db.query(`SELECT * FROM receipts WHERE payment_id = $1 AND tenant_id = $2`, [paymentId, tenantId]);
  let receipt = receiptRows[0];

  if (!receipt) {
    receipt = await db.transaction(async (client) => {
      // Re-check inside the transaction in case of a concurrent insert.
      const { rows: existingRows } = await db.query(`SELECT * FROM receipts WHERE payment_id = $1 AND tenant_id = $2`, [paymentId, tenantId], client);
      if (existingRows[0]) return existingRows[0];

      // Lock the tenant's receipt rows for the current year to serialize
      // concurrent inserts. The second concurrent transaction blocks here
      // until the first commits; it then sees the new MAX and increments
      // from there instead of racing on a stale counter.
      const { prefix, year, pattern } = buildPrefix(tenant.name);
      const { rows: maxRows } = await db.query(
        `SELECT COALESCE(MAX(receipt_number), '') AS max_no FROM receipts WHERE tenant_id = $1 AND receipt_number LIKE $2 FOR UPDATE`,
        [tenantId, pattern], client
      );
      const maxNo = maxRows[0].max_no;
      const nextCounter = parseCounter(maxNo) + 1;
      const receiptNumber = `${prefix}-${year}-${String(nextCounter).padStart(5, '0')}`;

      const receiptId = randomUUID();
      await db.query(`
        INSERT INTO receipts (id, tenant_id, payment_id, receipt_number, issued_by)
        VALUES ($1, $2, $3, $4, $5)
      `, [receiptId, tenantId, paymentId, receiptNumber, userId], client);
      return { id: receiptId, receipt_number: receiptNumber, issued_at: new Date().toISOString() };
    });

    await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'receipt', entityId: receipt.id, ipAddress: req.ip, metadata: { paymentId, receiptNumber: receipt.receipt_number } });
  }

  // generateReceiptPdf returns a Promise (pdfkit streams asynchronously) — await it.
  generateReceiptPdf({
    tenant: { name: tenant.name },
    student: { name: payment.student_name, class: payment.student_class, admission_no: payment.admission_no },
    feeHeadName: payment.fee_head_name || 'General',
    payment: { amount: payment.amount, method: payment.method, paid_on: payment.paid_on },
    receiptNumber: receipt.receipt_number,
    termName: payment.term_name || 'N/A',
    recordedByName: payment.recorded_by_name || 'Staff',
  }).then((pdfBuffer) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receipt.receipt_number}.pdf"`);
    res.send(pdfBuffer);
  }).catch((err) => {
    console.error('[receipts] PDF generation failed:', err.message);
    res.status(500).json({ error: 'Could not generate receipt PDF' });
  });
}

module.exports = { issueReceipt };
