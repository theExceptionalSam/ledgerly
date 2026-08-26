const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Terms are the academic session/term scope for all v2 billing. Every tenant
// has at least one (backfilled at migration time); owners can add more and
// switch the "current" term. Switching never deletes or hides prior-term data.

function listTerms(req, res) {
  const { tenantId } = req.user;
  const terms = db.prepare(`
    SELECT * FROM terms WHERE tenant_id = ? ORDER BY created_at DESC
  `).all(tenantId);
  res.json({ terms });
}

function createTerm(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, startDate, endDate, setCurrent } = req.body;

  const id = randomUUID();
  const insert = db.transaction(() => {
    if (setCurrent) {
      db.prepare(`UPDATE terms SET is_current = 0 WHERE tenant_id = ?`).run(tenantId);
    }
    db.prepare(`
      INSERT INTO terms (id, tenant_id, name, start_date, end_date, is_current)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, tenantId, name, startDate || null, endDate || null, setCurrent ? 1 : 0);
  });
  insert();

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'term', entityId: id, ipAddress: req.ip, metadata: { name, setCurrent } });
  res.status(201).json({ id });
}

function setCurrentTerm(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const term = db.prepare(`SELECT id FROM terms WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!term) return res.status(404).json({ error: 'Term not found' });

  const swap = db.transaction(() => {
    db.prepare(`UPDATE terms SET is_current = 0 WHERE tenant_id = ?`).run(tenantId);
    db.prepare(`UPDATE terms SET is_current = 1 WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
  });
  swap();

  recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'term', entityId: id, ipAddress: req.ip, metadata: { setCurrent: true } });
  res.json({ ok: true });
}

module.exports = { listTerms, createTerm, setCurrentTerm };
