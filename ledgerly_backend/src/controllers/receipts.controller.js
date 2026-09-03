const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { generateReceiptPdf } = require('../utils/receipt-pdf');
const logger = require('../utils/logger');

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

// Lazy-init: the Resend client is only constructed when an API key is present,
// so the server boots fine in dev without an email transport configured.
// Mirrors src/utils/otp.js — kept local to receipts so a failure in the email
// transport can't break OTP issuance (and vice versa).
let resend = null;
function getResend() {
  if (resend) return resend;
  const { Resend } = require('resend');
  resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

// Simple email-shape check used to decide whether the student's
// guardian_contact is emailable. Mirrors the typical "looks like an email"
// regex — intentionally permissive on the local-part and TLD length.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // For parent-initiated receipts, userId is null (parents aren't in the users
  // table). The receipts.issued_by column has a FK to users + is NOT NULL, so
  // we look up the tenant's owner to use as issued_by. This is correct
  // semantically — the school (via its owner) is the receipt issuer, even when
  // the download is triggered by a parent.
  let issuedById = userId;
  if (!issuedById) {
    const { rows: ownerRows } = await db.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1`,
      [tenantId]
    );
    if (!ownerRows[0]) return res.status(500).json({ error: 'No owner found for this tenant — cannot issue receipt' });
    issuedById = ownerRows[0].id;
  }

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

  // Load the tenant's name + branding columns. logo_data_url (base64 data
  // URL) and receipt_footer are nullable; if absent, generateReceiptPdf falls
  // back to the default header (school name only) and the default two-line
  // footer. logo_data_url is the canonical storage (Render's filesystem is
  // ephemeral so we keep logos in the DB).
  const { rows: tenantRows } = await db.query(
    `SELECT name, logo_path, logo_data_url, receipt_footer FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const tenant = tenantRows[0];

  // Idempotent: if a receipt already exists for this payment, regenerate the
  // PDF from the existing receipt number (no duplicate row, no new number).
  const { rows: receiptRows } = await db.query(`SELECT * FROM receipts WHERE payment_id = $1 AND tenant_id = $2`, [paymentId, tenantId]);
  let receipt = receiptRows[0];
  // Track whether THIS call actually inserted a new receipt row. We must only
  // record an audit entry when a new receipt is created — not when an existing
  // receipt is re-fetched (either by the outer check above or by the inner
  // re-check inside the transaction during a concurrent call). Previously the
  // `recordAudit` below ran whenever we entered the `if (!receipt)` block,
  // which produced duplicate audit entries for the same receipt on re-download
  // and on concurrent issueReceipt calls.
  let createdNew = false;

  if (!receipt) {
    // The transaction returns `{ receipt, createdNew }` so we can tell apart
    // "this call inserted" (audit) from "this call lost the race and re-fetched
    // a concurrent winner" (do NOT audit — the winner already did).
    const result = await db.transaction(async (client) => {
      // Re-check inside the transaction in case of a concurrent insert.
      const { rows: existingRows } = await db.query(`SELECT * FROM receipts WHERE payment_id = $1 AND tenant_id = $2`, [paymentId, tenantId], client);
      if (existingRows[0]) return { receipt: existingRows[0], createdNew: false };

      // Lock the tenant's receipt rows for the current year to serialize
      // concurrent inserts. We can't use FOR UPDATE with MAX() (Postgres
      // doesn't allow FOR UPDATE with aggregate functions), so we lock the
      // underlying rows first with a plain SELECT ... FOR UPDATE, then compute
      // the MAX in a separate query. Two concurrent transactions serialize:
      // the second blocks on the FOR UPDATE until the first commits, then sees
      // the new MAX and increments from there.
      const { prefix, year, pattern } = buildPrefix(tenant.name);
      // Lock the rows (returns 0 rows on the first receipt of the year — that's
      // fine, the UNIQUE constraint backstops that race).
      await db.query(
        `SELECT id FROM receipts WHERE tenant_id = $1 AND receipt_number LIKE $2 FOR UPDATE`,
        [tenantId, pattern], client
      );
      const { rows: maxRows } = await db.query(
        `SELECT COALESCE(MAX(receipt_number), '') AS max_no FROM receipts WHERE tenant_id = $1 AND receipt_number LIKE $2`,
        [tenantId, pattern], client
      );
      const maxNo = maxRows[0].max_no;
      const nextCounter = parseCounter(maxNo) + 1;
      const receiptNumber = `${prefix}-${year}-${String(nextCounter).padStart(5, '0')}`;

      const receiptId = randomUUID();
      await db.query(`
        INSERT INTO receipts (id, tenant_id, payment_id, receipt_number, issued_by)
        VALUES ($1, $2, $3, $4, $5)
      `, [receiptId, tenantId, paymentId, receiptNumber, issuedById], client);
      return { receipt: { id: receiptId, receipt_number: receiptNumber, issued_at: new Date().toISOString() }, createdNew: true };
    });
    receipt = result.receipt;
    createdNew = result.createdNew;

    if (createdNew) {
      await recordAudit({ tenantId, actorUserId: issuedById, action: 'create', entityType: 'receipt', entityId: receipt.id, ipAddress: req.ip, metadata: { paymentId, receiptNumber: receipt.receipt_number } });
    }
  }

  // The receipt row is now committed (either newly-inserted above or
  // already-existing from a prior call). The endpoint is idempotent, so if
  // PDF generation fails the user can simply re-download later — the receipt
  // WAS issued, the audit log is correct, only the PDF download failed.
  try {
    const pdfBuffer = await generateReceiptPdf({
      tenant: { name: tenant.name },
      student: { name: payment.student_name, class: payment.student_class, admission_no: payment.admission_no },
      feeHeadName: payment.fee_head_name || 'General',
      payment: { amount: payment.amount, method: payment.method, paid_on: payment.paid_on },
      receiptNumber: receipt.receipt_number,
      termName: payment.term_name || 'N/A',
      recordedByName: payment.recorded_by_name || 'Staff',
      branding: { logoDataUrl: tenant.logo_data_url, footerText: tenant.receipt_footer },
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receipt.receipt_number}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack, msg: 'PDF generation failed' });
    res.status(500).json({ error: 'Could not generate receipt PDF: ' + err.message });
  }
}

// List receipts for the tenant with optional filters. Tenant-scoped — the
// tenant_id from req.user is always applied, never trusted from input.
async function listReceipts(req, res) {
  const { tenantId } = req.user;
  const { studentId, from, to } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);

  // Build WHERE clauses incrementally. The tenant_id is always $1; additional
  // filters get appended as $2, $3, ... and tracked in the params array.
  const where = ['r.tenant_id = $1'];
  const params = [tenantId];
  if (studentId) {
    params.push(studentId);
    where.push(`p.student_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`p.paid_on >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`p.paid_on <= $${params.length}`);
  }

  const whereClause = where.join(' AND ');

  // Total count for pagination — run in parallel with the page query.
  const countParams = params.slice();
  const countRes = db.query(
    `SELECT COUNT(*)::int AS total
     FROM receipts r
     JOIN payments p ON p.id = r.payment_id
     WHERE ${whereClause}`,
    countParams
  );

  const pageParams = params.slice();
  pageParams.push(pageSize);
  pageParams.push((page - 1) * pageSize);
  const pageRes = db.query(
    `SELECT r.id, r.receipt_number, r.issued_at, r.payment_id,
            p.amount, p.method, p.paid_on,
            s.name AS student_name, s.class AS student_class,
            fh.name AS fee_head_name,
            u.name AS issued_by_name
     FROM receipts r
     JOIN payments p ON p.id = r.payment_id
     JOIN students s ON s.id = p.student_id
     LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
     LEFT JOIN users u ON u.id = r.issued_by
     WHERE ${whereClause}
     ORDER BY r.issued_at DESC
     LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
    pageParams
  );

  const [countResult, pageResult] = await Promise.all([countRes, pageRes]);
  const total = countResult.rows[0] ? countResult.rows[0].total : 0;

  res.json({ receipts: pageResult.rows, total, page, pageSize });
}

// Email a receipt PDF to the student's guardian_contact. Only fires if the
// contact "looks like" an email — otherwise the caller is told to update the
// student record first. Idempotent: re-sending the same receipt is allowed.
async function emailReceipt(req, res) {
  const { tenantId, id: userId } = req.user;
  const { paymentId } = req.params;

  // 1. Load payment + student + tenant + receipt (same JOINs as issueReceipt).
  const { rows: paymentRows } = await db.query(`
    SELECT p.*, s.name AS student_name, s.class AS student_class, s.admission_no,
           s.guardian_contact,
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
  if (payment.reversed) return res.status(400).json({ error: 'Cannot email a receipt for a reversed payment' });

  const { rows: tenantRows } = await db.query(
    `SELECT name, logo_path, logo_data_url, receipt_footer FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const tenant = tenantRows[0];

  const { rows: receiptRows } = await db.query(
    `SELECT * FROM receipts WHERE payment_id = $1 AND tenant_id = $2`,
    [paymentId, tenantId]
  );
  const receipt = receiptRows[0];

  // 2. A receipt must already exist — this endpoint emails, it does not issue.
  if (!receipt) {
    return res.status(400).json({ error: 'No receipt has been issued for this payment yet. Issue one first.' });
  }

  // 3. Validate that guardian_contact looks like an email. If not, ask the
  // caller to update the student record — there's no ad-hoc "send to this
  // address" override on purpose (it would let a bursar exfiltrate any
  // receipt to an arbitrary mailbox).
  const guardianContact = (payment.guardian_contact || '').trim();
  if (!EMAIL_RE.test(guardianContact)) {
    return res.status(400).json({ error: "Guardian contact is not an email address. Update the student's guardian contact to email a receipt." });
  }

  // 4. Email transport must be configured. If not, tell the caller to
  // download the PDF directly instead of failing silently.
  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: 'Email sending is not configured. Download the receipt instead.' });
  }

  // 5. Generate the PDF. Failures here bubble up to the global error handler
  // as a 500 — we haven't sent the email yet, so no half-sent state.
  let pdfBuffer;
  try {
    pdfBuffer = await generateReceiptPdf({
      tenant: { name: tenant.name },
      student: { name: payment.student_name, class: payment.student_class, admission_no: payment.admission_no },
      feeHeadName: payment.fee_head_name || 'General',
      payment: { amount: payment.amount, method: payment.method, paid_on: payment.paid_on },
      receiptNumber: receipt.receipt_number,
      termName: payment.term_name || 'N/A',
      recordedByName: payment.recorded_by_name || 'Staff',
      branding: { logoDataUrl: tenant.logo_data_url, footerText: tenant.receipt_footer },
    });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack, msg: 'Receipt PDF generation failed for email' });
    return res.status(500).json({ error: 'Could not generate receipt PDF: ' + err.message });
  }

  // 6. Send via Resend. The from address falls back to Resend's shared test
  // address (only works for sending to the account owner's own email on the
  // free plan) — production deploys should set RESEND_FROM_EMAIL to a
  // verified-domain address.
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Ledgerly <onboarding@resend.dev>';
  const amountFmt = `₦${Number(payment.amount || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
  const html = `
    <div style="font-family:sans-serif;max-width:560px;margin:auto;color:#14213D">
      <h2 style="margin-bottom:4px">${escapeHtml(tenant.name)}</h2>
      <p style="margin-top:0;color:#5B5B54">Receipt <strong>${escapeHtml(receipt.receipt_number)}</strong></p>
      <p style="color:#5B5B54">Hello,</p>
      <p style="color:#5B5B54">
        A payment receipt from <strong>${escapeHtml(tenant.name)}</strong> is attached to this email.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;color:#5B5B54">
        <tr><td style="padding:6px 0;border-bottom:1px solid #E4E3DD">Student</td><td style="padding:6px 0;border-bottom:1px solid #E4E3DD;text-align:right;color:#14213D;font-weight:bold">${escapeHtml(payment.student_name)}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #E4E3DD">Fee head</td><td style="padding:6px 0;border-bottom:1px solid #E4E3DD;text-align:right;color:#14213D">${escapeHtml(payment.fee_head_name || 'General')}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #E4E3DD">Date paid</td><td style="padding:6px 0;border-bottom:1px solid #E4E3DD;text-align:right;color:#14213D">${escapeHtml(payment.paid_on || '')}</td></tr>
        <tr><td style="padding:6px 0;border-bottom:1px solid #E4E3DD">Amount</td><td style="padding:6px 0;border-bottom:1px solid #E4E3DD;text-align:right;color:#1B7A43;font-weight:bold">${escapeHtml(amountFmt)}</td></tr>
      </table>
      <p style="color:#5B5B54">Please find the receipt attached as a PDF.</p>
      <p style="color:#5B5B54;font-size:12px;margin-top:32px">This is a system-generated email. Powered by Ledgerly.</p>
    </div>
  `;

  try {
    await getResend().emails.send({
      from: fromEmail,
      to: guardianContact,
      subject: `Receipt ${receipt.receipt_number} from ${tenant.name}`,
      html,
      attachments: [{ filename: `${receipt.receipt_number}.pdf`, content: pdfBuffer }],
    });
  } catch (emailError) {
    logger.error({ err: emailError.message, stack: emailError.stack, msg: 'Failed to email receipt via Resend' });
    return res.status(502).json({ error: 'Email delivery failed: ' + emailError.message });
  }

  // 7. Audit + respond. The audit row records the recipient so a future
  // investigation can see who the receipt was sent to (without storing the
  // PDF body itself — that lives only in the email + the receipts endpoint).
  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'create',
    entityType: 'receipt',
    entityId: receipt.id,
    ipAddress: req.ip,
    metadata: { paymentId, receiptNumber: receipt.receipt_number, emailedTo: guardianContact },
  });

  res.json({ ok: true, emailedTo: guardianContact });
}

// Minimal HTML escaper — used by emailReceipt to safely interpolate
// tenant/student/free-form strings into the email HTML body.
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = { issueReceipt, listReceipts, emailReceipt };
