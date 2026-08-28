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

module.exports = { listEndpoints, createEndpoint, deleteEndpoint, deliverWebhook };
