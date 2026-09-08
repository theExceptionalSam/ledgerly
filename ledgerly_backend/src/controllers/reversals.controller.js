const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { createNotification } = require('./notifications.controller');

// Reversal approval workflow.
//
// Direct payment reversal is owner-only (see payments.controller.reversePayment).
// Bursars and accountants who need to correct a recorded payment submit a
// reversal request here; the owner then approves or rejects it. Approval
// performs the actual payment reversal (UPDATE payments SET reversed = 1) in
// the same transaction that flips the request status to 'approved'.
//
// This separation prevents a single staff member from both recording and
// erasing a payment without oversight — the bursar who recorded a payment
// cannot also reverse it; only the owner can.

// Any staff member (owner / accountant / bursar) can request a reversal. The
// request is recorded as 'pending' and does NOT touch the payment row. The
// owner is notified so they can act on it.
async function requestReversal(req, res) {
  const { tenantId, id: userId, role } = req.user;
  const { paymentId, reason } = req.body;

  // Only staff can request — parents can't (they don't have staff tokens here
  // anyway, but the explicit guard documents intent).
  if (!['owner', 'accountant', 'bursar'].includes(role)) {
    return res.status(403).json({ error: 'Only staff members can request a payment reversal' });
  }

  // Verify the payment belongs to this tenant and is not already reversed.
  const { rows: paymentRows } = await db.query(
    `SELECT id, reversed FROM payments WHERE id = $1 AND tenant_id = $2`,
    [paymentId, tenantId]
  );
  const payment = paymentRows[0];
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  if (payment.reversed) return res.status(400).json({ error: 'Payment is already reversed' });

  // Reject duplicate pending requests for the same payment — one outstanding
  // request at a time keeps the approval queue unambiguous.
  const { rows: existingRows } = await db.query(
    `SELECT id FROM reversal_requests WHERE payment_id = $1 AND tenant_id = $2 AND status = 'pending'`,
    [paymentId, tenantId]
  );
  if (existingRows[0]) {
    return res.status(409).json({ error: 'A pending reversal request already exists for this payment' });
  }

  const id = randomUUID();
  await db.query(
    `INSERT INTO reversal_requests (id, tenant_id, payment_id, requested_by, reason, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [id, tenantId, paymentId, userId, reason.trim()]
  );

  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'create',
    entityType: 'reversal_request',
    entityId: id,
    ipAddress: req.ip,
    metadata: { paymentId, reason: reason.trim(), status: 'pending' },
  });

  // Notify all owners so they can act on the request. Best-effort — a
  // notification failure must not break the request submission.
  try {
    const { rows: owners } = await db.query(
      `SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' AND status = 'active'`,
      [tenantId]
    );
    for (const o of owners) {
      await createNotification(
        tenantId, o.id, 'reversal_requested', 'Payment reversal requested',
        `A staff member has requested a payment reversal. Reason: ${reason.trim()}`,
        'reversal_request', id
      );
    }
  } catch (err) {
    // Logged by the caller's error handler if it bubbles — but we swallow it
    // here so the request itself still succeeds.
  }

  res.status(201).json({ id, status: 'pending' });
}

// Owner-only — list pending reversal requests for the tenant. Includes the
// payment + student + requester context so the owner can decide without a
// second round-trip per request.
async function listReversalRequests(req, res) {
  const { tenantId } = req.user;
  // Optional status filter — defaults to 'pending' (the actionable queue). The
  // owner can pass ?status=approved|rejected|all to see history.
  const statusFilter = req.query.status && String(req.query.status).toLowerCase() !== 'all'
    ? String(req.query.status).toLowerCase()
    : 'pending';

  const params = [tenantId];
  let statusClause = '';
  if (statusFilter !== 'all') {
    params.push(statusFilter);
    statusClause = `AND rr.status = $${params.length}`;
  }

  const { rows } = await db.query(`
    SELECT rr.id, rr.reason, rr.status, rr.created_at, rr.approved_at,
           rr.payment_id, rr.requested_by, rr.approved_by,
           p.amount, p.method, p.paid_on, p.note AS payment_note, p.reversed,
           s.name AS student_name, s.class AS student_class,
           fh.name AS fee_head_name,
           t.name AS term_name,
           req.name AS requested_by_name,
           app.name AS approved_by_name
    FROM reversal_requests rr
    JOIN payments p ON p.id = rr.payment_id
    LEFT JOIN students s ON s.id = p.student_id
    LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
    LEFT JOIN terms t ON t.id = p.term_id
    LEFT JOIN users req ON req.id = rr.requested_by
    LEFT JOIN users app ON app.id = rr.approved_by
    WHERE rr.tenant_id = $1 ${statusClause}
    ORDER BY rr.created_at DESC
    LIMIT 200
  `, params);

  res.json({ requests: rows });
}

// Owner-only — approve a pending reversal request. Sets status='approved',
// then performs the actual payment reversal (UPDATE payments SET reversed = 1)
// and records audit — all in a single transaction so the request status and
// the payment reversal can never diverge.
async function approveReversal(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows: reqRows } = await db.query(
    `SELECT rr.*, p.reversed AS payment_reversed
     FROM reversal_requests rr
     JOIN payments p ON p.id = rr.payment_id
     WHERE rr.id = $1 AND rr.tenant_id = $2`,
    [id, tenantId]
  );
  const request = reqRows[0];
  if (!request) return res.status(404).json({ error: 'Reversal request not found' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: `Reversal request is already ${request.status}` });
  }
  if (request.payment_reversed) {
    // The payment was reversed by some other path (e.g. the owner used direct
    // reversePayment). Mark the request approved-but-already-reversed so the
    // queue clears, and tell the caller.
    await db.query(
      `UPDATE reversal_requests SET status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2 AND tenant_id = $3`,
      [userId, id, tenantId]
    );
    return res.json({ ok: true, alreadyReversed: true });
  }

  await db.transaction(async (client) => {
    // Flip the request to approved and reverse the payment in the same
    // transaction. If either write fails, both roll back — the request stays
    // pending and the payment stays live.
    await db.query(
      `UPDATE reversal_requests SET status = 'approved', approved_by = $1, approved_at = now() WHERE id = $2 AND tenant_id = $3`,
      [userId, id, tenantId], client
    );
    await db.query(
      `UPDATE payments SET reversed = 1 WHERE id = $1 AND tenant_id = $2`,
      [request.payment_id, tenantId], client
    );
    await recordAudit({
      tenantId,
      actorUserId: userId,
      action: 'update',
      entityType: 'payment',
      entityId: request.payment_id,
      ipAddress: req.ip,
      metadata: { reversed: true, reason: request.reason, reversalRequestId: id, via: 'approval' },
    }, client);
  });

  // Best-effort notification to the requester — they're told their reversal
  // was approved. Fire-and-forget.
  try {
    await createNotification(
      tenantId, request.requested_by, 'reversal_approved', 'Reversal request approved',
      `Your reversal request has been approved by the owner. Payment ${request.payment_id} has been reversed.`,
      'reversal_request', id
    );
  } catch {}

  res.json({ ok: true });
}

// Owner-only — reject a pending reversal request. Sets status='rejected' with
// no change to the payment. An optional rejection reason can be supplied in
// the body and is stored in the audit trail (the request row's own reason
// field is the requester's text, not the owner's, so we don't overwrite it).
async function rejectReversal(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { rejectionReason } = req.body || {};

  const { rows: reqRows } = await db.query(
    `SELECT * FROM reversal_requests WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  const request = reqRows[0];
  if (!request) return res.status(404).json({ error: 'Reversal request not found' });
  if (request.status !== 'pending') {
    return res.status(400).json({ error: `Reversal request is already ${request.status}` });
  }

  await db.query(
    `UPDATE reversal_requests SET status = 'rejected', approved_by = $1, approved_at = now() WHERE id = $2 AND tenant_id = $3`,
    [userId, id, tenantId]
  );

  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'update',
    entityType: 'reversal_request',
    entityId: id,
    ipAddress: req.ip,
    metadata: { status: 'rejected', paymentId: request.payment_id, rejectionReason: rejectionReason ? String(rejectionReason).trim().slice(0, 300) : null },
  });

  // Best-effort notification to the requester.
  try {
    await createNotification(
      tenantId, request.requested_by, 'reversal_rejected', 'Reversal request rejected',
      `Your reversal request has been rejected by the owner.`,
      'reversal_request', id
    );
  } catch {}

  res.json({ ok: true });
}

module.exports = { requestReversal, listReversalRequests, approveReversal, rejectReversal };
