const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { generateReceiptPdf } = require('../utils/receipt-pdf');

// Phase 3: Receipts.
// One receipt per payment. If a receipt already exists for the payment, return
// it instead of creating a duplicate. Receipt numbers are sequential per tenant
// per calendar year, formatted <XXX>-<YYYY>-<NNNNN>.

function buildReceiptNumber(tenantId, tenantName) {
  const year = new Date().getFullYear();
  const prefix = (tenantName || 'LED').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'LED';
  const count = db.prepare(`
    SELECT COUNT(*) AS n FROM receipts
    WHERE tenant_id = ? AND receipt_number LIKE ?
  `).get(tenantId, `${prefix}-${year}-%`).n;
  const counter = String(count + 1).padStart(5, '0');
  return `${prefix}-${year}-${counter}`;
}

function issueReceipt(req, res) {
  const { tenantId, id: userId } = req.user;
  const { paymentId } = req.params;

  const payment = db.prepare(`
    SELECT p.*, s.name AS student_name, s.class AS student_class, s.admission_no,
           fh.name AS fee_head_name, u.name AS recorded_by_name, t.name AS term_name
    FROM payments p
    JOIN students s ON s.id = p.student_id
    LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
    LEFT JOIN users u ON u.id = p.recorded_by
    LEFT JOIN terms t ON t.id = p.term_id
    WHERE p.id = ? AND p.tenant_id = ?
  `).get(paymentId, tenantId);

  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.reversed) return res.status(400).json({ error: 'Cannot issue a receipt for a reversed payment' });

  const tenant = db.prepare(`SELECT name FROM tenants WHERE id = ?`).get(tenantId);

  // Idempotent: if a receipt already exists for this payment, regenerate the
  // PDF from the existing receipt number (no duplicate row, no new number).
  let receipt = db.prepare(`SELECT * FROM receipts WHERE payment_id = ? AND tenant_id = ?`).get(paymentId, tenantId);

  if (!receipt) {
    const receiptId = randomUUID();
    const receiptNumber = buildReceiptNumber(tenantId, tenant.name);
    const insert = db.transaction(() => {
      // Re-check inside the transaction in case of a concurrent insert.
      const existing = db.prepare(`SELECT * FROM receipts WHERE payment_id = ? AND tenant_id = ?`).get(paymentId, tenantId);
      if (existing) return existing;
      db.prepare(`
        INSERT INTO receipts (id, tenant_id, payment_id, receipt_number, issued_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(receiptId, tenantId, paymentId, receiptNumber, userId);
      return { id: receiptId, receipt_number: receiptNumber, issued_at: new Date().toISOString() };
    });
    receipt = insert();

    recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'receipt', entityId: receipt.id, ipAddress: req.ip, metadata: { paymentId, receiptNumber: receipt.receipt_number } });
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
