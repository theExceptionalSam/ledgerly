const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('./notifications.controller');
const logger = require('../utils/logger');

// Online (Paystack) payment integration.
//
// The initiate endpoint creates an online_payments row with status='pending' and
// returns a reference + (placeholder) authorization URL. The actual Paystack
// Initialize call is a TODO — for now the reference is enough for the front end to
// poll the status endpoint.
//
// The webhook endpoint is called by Paystack after the customer pays. We verify
// the event signature against PAYSTACK_SECRET (TODO), and on success we record a
// real payment, mark the online_payments row as 'success', and issue a receipt.

function buildReference() {
  // 'LDP-' prefix + base36 timestamp + random suffix — short, sortable, unique.
  return `LDP-${Date.now().toString(36)}-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

async function initiate(req, res) {
  const { tenantId, id: userId } = req.user;
  const { studentId, feeHeadId, termId, amount, parentPhone } = req.body;

  const id = randomUUID();
  const reference = buildReference();
  await db.query(
    `INSERT INTO online_payments (id, tenant_id, student_id, fee_head_id, term_id, amount, reference, status, parent_phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
    [id, tenantId, studentId, feeHeadId || null, termId || null, amount, reference, parentPhone || null]
  );
  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'online_payment', entityId: id, ipAddress: req.ip, metadata: { reference, amount, studentId } });

  // TODO: call Paystack POST /transaction/initialize with { email, amount, reference, callback_url }
  // and return the returned authorization_url. Until that integration is wired up,
  // return a placeholder URL pointing at the front end's payment-status page.
  const authorizationUrl = `${process.env.WEB_BASE_URL || ''}/payments/online/status?reference=${reference}`;
  res.status(201).json({ reference, authorizationUrl });
}

// Parent-initiated online payment — used by the ParentPortal frontend.
//
// Mirrors `initiate` above, but authenticates via `req.parent` (parent token,
// not staff token) and enforces that the parent is linked to the student they're
// paying for. Without this check a parent could initiate payments (and get
// Paystack references) for arbitrary student IDs.
//
// Note: `requireParent` sets `req.parent = { id, tenantId }` only — `phone` is
// NOT on the token payload, so we fetch it from the `parents` row in the same
// query that verifies the parent↔student link (one round-trip, no N+1).
async function initiateForParent(req, res) {
  const { tenantId, id: parentId } = req.parent;
  const { studentId, feeHeadId, termId, amount } = req.body;

  // Verify the parent is linked to this student AND fetch their phone in one
  // query (security check + parent_phone population in a single round-trip).
  const { rows: linkRows } = await db.query(
    `SELECT p.phone
     FROM parents p
     JOIN parent_students ps ON ps.parent_id = p.id
     WHERE p.id = $1 AND ps.student_id = $2`,
    [parentId, studentId]
  );
  if (!linkRows[0]) return res.status(403).json({ error: 'This student is not linked to your account' });
  const phone = linkRows[0].phone;

  const id = randomUUID();
  const reference = buildReference();
  await db.query(
    `INSERT INTO online_payments (id, tenant_id, student_id, fee_head_id, term_id, amount, reference, status, parent_phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)`,
    [id, tenantId, studentId, feeHeadId || null, termId || null, amount, reference, phone]
  );
  // No staff audit here — the parent initiated it. Could add a parent audit if needed.

  // TODO: call Paystack POST /transaction/initialize (same TODO as the staff endpoint)
  const authorizationUrl = `${process.env.WEB_BASE_URL || ''}/payments/online/status?reference=${reference}`;
  res.status(201).json({ reference, authorizationUrl });
}

// Paystack webhook — NO auth (the request comes from Paystack's servers, not from
// an authenticated user). The signature is verified against PAYSTACK_SECRET.
async function webhook(req, res) {
  // TODO: verify x-paystack-signature against HMAC-SHA512 of the raw body with PAYSTACK_SECRET.
  // For now, just log the event so we can see what Paystack sends during integration testing.
  const event = req.body || {};
  logger.info({ event: event.event, reference: event.data?.reference, msg: 'Paystack webhook received' });

  if (event.event === 'charge.success' && event.data?.status === 'success') {
    const reference = event.data.reference;
    const { rows } = await db.query(`SELECT * FROM online_payments WHERE reference = $1`, [reference]);
    const online = rows[0];
    if (!online) {
      // Paystack may send webhooks for transactions we don't track — acknowledge so it doesn't retry.
      return res.status(200).json({ ok: true, ignored: 'unknown reference' });
    }
    if (online.status === 'success') {
      // Idempotent — already processed. Don't double-record the payment.
      return res.status(200).json({ ok: true, deduplicated: true });
    }

    // Record the real payment — same INSERT shape as payments.controller.recordPayment,
    // but recorded_by is NULL (Paystack, not a user). The student/fee_head/term come
    // from the online_payments row, so we don't trust the webhook payload for those.
    const paymentId = randomUUID();
    await db.transaction(async (client) => {
      await db.query(
        `INSERT INTO payments (id, tenant_id, student_id, amount, method, note, paid_on, recorded_by, fee_head_id, term_id, idempotency_key)
         VALUES ($1, $2, $3, $4, 'online', $5, $6, NULL, $7, $8, $9)`,
        [
          paymentId,
          online.tenant_id,
          online.student_id,
          online.amount,
          `Online payment ${reference}`,
          new Date().toISOString().slice(0, 10),
          online.fee_head_id,
          online.term_id,
          reference,
        ],
        client
      );
      await db.query(
        `UPDATE online_payments SET status = 'success', paystack_response = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(event.data), online.id],
        client
      );
    });

    // Generate a receipt number sequentially per tenant per year (same scheme as
    // receipts.controller, but inline because we don't have a req.user context here).
    const { rows: tenantRows } = await db.query(`SELECT name FROM tenants WHERE id = $1`, [online.tenant_id]);
    const tenantName = tenantRows[0]?.name || 'LED';
    const year = new Date().getFullYear();
    const prefix = tenantName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'LED';
    const pattern = `${prefix}-${year}-%`;
    const { rows: maxRows } = await db.query(
      `SELECT COALESCE(MAX(receipt_number), '') AS max_no FROM receipts WHERE tenant_id = $1 AND receipt_number LIKE $2`,
      [online.tenant_id, pattern]
    );
    const nextCounter = (String(maxRows[0].max_no).split('-').pop() >> 0) + 1;
    const receiptNumber = `${prefix}-${year}-${String(nextCounter).padStart(5, '0')}`;
    await db.query(
      `INSERT INTO receipts (id, tenant_id, payment_id, receipt_number, issued_by)
       VALUES ($1, $2, $3, $4, NULL)`,
      [randomUUID(), online.tenant_id, paymentId, receiptNumber]
    );

    // Notify tenant owners that an online payment came in.
    const { rows: owners } = await db.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' AND status = 'active'`,
      [online.tenant_id]
    );
    for (const owner of owners) {
      await createNotification(online.tenant_id, owner.id, 'online_payment', 'Online payment received',
        `A payment of ${online.amount} was received online (ref ${reference}).`, 'payment', paymentId);
    }
  }

  // Always 200 so Paystack doesn't retry. Errors are logged, not surfaced.
  res.status(200).json({ ok: true });
}

async function listOnlinePayments(req, res) {
  const { rows } = await db.query(
    `SELECT op.id, op.reference, op.amount, op.status, op.parent_phone, op.created_at,
            s.name AS student_name, fh.name AS fee_head_name, t.name AS term_name
     FROM online_payments op
     LEFT JOIN students s ON s.id = op.student_id
     LEFT JOIN fee_heads fh ON fh.id = op.fee_head_id
     LEFT JOIN terms t ON t.id = op.term_id
     WHERE op.tenant_id = $1
     ORDER BY op.created_at DESC
     LIMIT 200`,
    [req.user.tenantId]
  );
  res.json({ payments: rows });
}

module.exports = { initiate, initiateForParent, webhook, listOnlinePayments };
