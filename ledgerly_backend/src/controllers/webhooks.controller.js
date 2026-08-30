const { randomUUID } = require('crypto');
const crypto = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const logger = require('../utils/logger');

// Webhook endpoints — let tenants register a URL + a list of events they want to
// be notified about. When an event fires inside the app (payment recorded, term
// closed, etc.), deliverWebhook() POSTs the payload to every matching endpoint,
// signing the body with HMAC-SHA256 using the endpoint's secret.
//
// Deliveries are recorded in webhook_deliveries for retry/audit. The actual HTTP
// POST uses the built-in fetch (Node 18+) — no axios.

async function listEndpoints(req, res) {
  const { rows } = await db.query(
    `SELECT id, url, events, active, created_at
     FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.user.tenantId]
  );
  const endpoints = rows.map((e) => ({ ...e, events: typeof e.events === 'string' ? JSON.parse(e.events) : e.events }));
  res.json({ endpoints });
}

async function createEndpoint(req, res) {
  const { url, events } = req.body;
  const id = randomUUID();
  // 32-byte secret, hex-encoded — shared with the tenant so they can verify signatures.
  const secret = crypto.randomBytes(32).toString('hex');
  await db.query(
    `INSERT INTO webhook_endpoints (id, tenant_id, url, secret, events)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, req.user.tenantId, url, secret, JSON.stringify(events || [])]
  );
  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'create', entityType: 'webhook_endpoint', entityId: id, ipAddress: req.ip, metadata: { url, events } });
  // The secret is returned ONCE — the tenant must store it. Subsequent listEndpoints
  // calls only return the id/url/events, never the secret.
  res.status(201).json({ id, url, events: events || [], secret });
}

async function deleteEndpoint(req, res) {
  const { id } = req.params;
  const result = await db.query(`DELETE FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2`, [id, req.user.tenantId]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Endpoint not found' });
  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'delete', entityType: 'webhook_endpoint', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

// PATCH /webhooks/:id — toggle `active` (INTEGER 0/1) and/or edit the `events`
// array (stored as a JSON string in the DB). Only fields present in the body are
// updated. Useful because delete+recreate would rotate the secret, which the
// tenant would then have to redistribute.
async function updateEndpoint(req, res) {
  const { id } = req.params;
  const { active, events } = req.body;
  if (active === undefined && events === undefined) {
    return res.status(400).json({ error: 'Provide at least one of `active` or `events` to update' });
  }

  // Build the update dynamically — only set the fields that were provided.
  const sets = [];
  const params = [];
  let idx = 1;
  if (active !== undefined) {
    sets.push(`active = $${idx++}`);
    params.push(active);
  }
  if (events !== undefined) {
    sets.push(`events = $${idx++}`);
    params.push(JSON.stringify(events));
  }
  params.push(id, req.user.tenantId);
  const result = await db.query(
    `UPDATE webhook_endpoints SET ${sets.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx++}`,
    params
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Endpoint not found' });

  await recordAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'update', entityType: 'webhook_endpoint', entityId: id, ipAddress: req.ip, metadata: { active, events } });

  // SELECT the updated row back so the caller sees the new state. `events` is
  // stored as a JSON string — parse it to an array for the response.
  const { rows } = await db.query(
    `SELECT id, url, events, active, created_at FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2`,
    [id, req.user.tenantId]
  );
  const updated = rows[0];
  if (updated) {
    updated.events = typeof updated.events === 'string' ? JSON.parse(updated.events) : updated.events;
  }
  res.json({ endpoint: updated });
}

// Internal helper — exported so other controllers can fire webhooks without going
// through a route. For each endpoint matching the event, POST the payload with an
// X-Ledgerly-Signature header (HMAC-SHA256 of the body, hex). Failures are logged
// and recorded in webhook_deliveries with status='failed'; a future retry worker
// can re-attempt.
async function deliverWebhook(tenantId, event, payload) {
  const { rows } = await db.query(
    `SELECT * FROM webhook_endpoints WHERE tenant_id = $1 AND active = 1`,
    [tenantId]
  );
  const body = JSON.stringify({ event, payload, deliveredAt: new Date().toISOString() });

  for (const ep of rows) {
    let events = ep.events;
    if (typeof events === 'string') {
      try { events = JSON.parse(events); } catch { events = []; }
    }
    // '*' = subscribe to all events; otherwise must match exactly.
    if (!Array.isArray(events) || (events.length > 0 && !events.includes('*') && !events.includes(event))) continue;

    const deliveryId = randomUUID();
    const signature = crypto.createHmac('sha256', ep.secret).update(body).digest('hex');
    let status = 'failed';
    let responseCode = null;
    try {
      const resp = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ledgerly-Signature': signature, 'X-Ledgerly-Event': event },
        body,
        signal: AbortSignal.timeout(10000),
      });
      responseCode = resp.status;
      status = resp.status >= 200 && resp.status < 300 ? 'delivered' : 'failed';
    } catch (err) {
      logger.warn({ err: err.message, url: ep.url, msg: 'Webhook delivery failed' });
    }
    await db.query(
      `INSERT INTO webhook_deliveries (id, endpoint_id, event, payload, status, response_code, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, 1)`,
      [deliveryId, ep.id, event, body, status, responseCode]
    );
  }
}

// GET /webhooks/:id/deliveries — paginated delivery history for one endpoint.
// Verifies the endpoint belongs to the tenant (so a tenant can't read another
// tenant's delivery history by guessing endpoint IDs), then returns the most
// recent deliveries with a total count for the pager. page/pageSize are clamped
// to safe bounds (1-200) so a caller can't request an unbounded result set.
async function listDeliveries(req, res) {
  const { id } = req.params;  // endpoint ID
  const { page = 1, pageSize = 50 } = req.query;

  // Verify the endpoint belongs to the tenant
  const { rows: epRows } = await db.query(
    `SELECT id FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2`,
    [id, req.user.tenantId]
  );
  if (!epRows[0]) return res.status(404).json({ error: 'Endpoint not found' });

  const limit = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
  const offset = (Math.max(parseInt(page, 10) || 1, 1) - 1) * limit;

  const [countRes, rowsRes] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS total FROM webhook_deliveries WHERE endpoint_id = $1`, [id]),
    db.query(
      `SELECT id, event, status, response_code, attempts, created_at
       FROM webhook_deliveries WHERE endpoint_id = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    ),
  ]);
  res.json({ deliveries: rowsRes.rows, total: countRes.rows[0].total, page: Math.max(parseInt(page, 10) || 1, 1), pageSize: limit });
}

module.exports = { listEndpoints, createEndpoint, deleteEndpoint, deliverWebhook, updateEndpoint, listDeliveries };
