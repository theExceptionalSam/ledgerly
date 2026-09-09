const { randomUUID } = require('crypto');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
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

// SECURITY (SSRF): validate webhook target URLs to stop tenants from pointing the
// server at internal infrastructure (cloud metadata services like
// 169.254.169.254, localhost, RFC-1918 ranges, link-local, etc.). The check runs
// at registration time (here) AND at delivery time (in deliverWebhook), so a URL
// whose DNS later resolves to an internal IP is still rejected. The delivery-time
// check is the strong boundary; the registration check gives early feedback.
//
// In production we additionally require HTTPS so a tenant can't exfiltrate the
// HMAC-signed payload over plaintext HTTP to a sniffer on the path.
function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  // IPv4 literals
  if (net.isIPv4(h)) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 10) return true;                              // 10.0.0.0/8
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;        // 192.168.0.0/16
    if (parts[0] === 127) return true;                            // loopback
    if (parts[0] === 0) return true;                              // 0.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true;        // link-local (AWS/GCP metadata!)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
  }
  // IPv6 literals
  if (net.isIPv6(h)) {
    if (h === '::1' || h === '::') return true;                   // loopback / unspecified
    if (h.startsWith('fc') || h.startsWith('fd')) return true;    // unique-local fc00::/7
    if (h.startsWith('fe80')) return true;                        // link-local
    if (h.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 — re-check the embedded IPv4
      return isPrivateHost(h.slice('::ffff:'.length));
    }
  }
  // Hostnames
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;
  return false;
}

// Resolves a hostname and rejects if ANY resolved address is private/internal.
// Throws on DNS failure or private-IP resolution. Used at delivery time so a
// URL whose DNS rotates to an internal IP is still blocked.
async function assertPublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateHost(hostname)) throw new Error('Target host resolves to a private/internal address');
    return;
  }
  let addrs;
  try {
    addrs = await dns.resolve4(hostname);
  } catch (e4) {
    // Try IPv6 if IPv4 didn't resolve
    try { addrs = await dns.resolve6(hostname); } catch (e6) { throw new Error('Could not resolve webhook host'); }
  }
  for (const a of addrs) {
    if (isPrivateHost(a)) throw new Error('Target host resolves to a private/internal address');
  }
}

// Validates a webhook URL at registration time. Throws an Error with a
// user-facing message if the URL is unacceptable.
function validateWebhookUrl(url) {
  let parsed;
  try { parsed = new URL(url); }
  catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must use http or https');
  }
  // In production, require HTTPS so the signed payload isn't exposed in transit.
  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
    throw new Error('HTTPS URLs are required for webhook endpoints in production');
  }
  if (!parsed.hostname) throw new Error('URL must include a hostname');
  // Block userinfo (http://user:pass@host) — it's a vector for header injection
  // and credential leakage to logs.
  if (parsed.username || parsed.password) throw new Error('URL must not contain credentials');
  // Reject obviously-private hostnames synchronously (DNS-based check happens at
  // delivery time — we don't block registration on a transient DNS failure, but
  // we DO block obvious internal literals here).
  if (isPrivateHost(parsed.hostname)) {
    throw new Error('Webhook URLs pointing to private or internal addresses are not allowed');
  }
  // Block default ports that are commonly internal services
  if (parsed.port && ['5432', '6379', '3306', '27017', '22', '25'].includes(parsed.port)) {
    throw new Error('Webhook URLs targeting common internal service ports are not allowed');
  }
}

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
  // SECURITY: validate the URL before persisting — rejects private IPs,
  // internal hostnames, non-http(s) schemes, and credentials in the URL.
  try {
    validateWebhookUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
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
      // SSRF defence-in-depth: re-validate the URL and resolve the host to make
      // sure it doesn't point at a private/internal address. A URL registered
      // before this check existed, or one whose DNS rotates to an internal IP
      // after registration, is blocked here at delivery time.
      let parsed;
      try { parsed = new URL(ep.url); }
      catch { throw new Error('Invalid URL'); }
      await assertPublicHost(parsed.hostname);

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
