const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Fee heads are the catalogue of chargeable items a school bills for (Tuition,
// Boarding, Feeding, etc.). They are soft-deleted (is_active = 0), never hard
// deleted, because student_fee_assignments reference them.

function listFeeHeads(req, res) {
  const { tenantId } = req.user;
  const heads = db.prepare(`
    SELECT * FROM fee_heads WHERE tenant_id = ? AND is_active = 1 ORDER BY name
  `).all(tenantId);
  res.json({ feeHeads: heads });
}

function createFeeHead(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name } = req.body;

  const existing = db.prepare(`SELECT id FROM fee_heads WHERE tenant_id = ? AND name = ?`).get(tenantId, name);
  if (existing) return res.status(409).json({ error: 'A fee head with this name already exists' });

  const id = randomUUID();
  db.prepare(`INSERT INTO fee_heads (id, tenant_id, name) VALUES (?, ?, ?)`).run(id, tenantId, name);

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'fee_head', entityId: id, ipAddress: req.ip, metadata: { name } });
  res.status(201).json({ id });
}

function deactivateFeeHead(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const head = db.prepare(`SELECT id FROM fee_heads WHERE id = ? AND tenant_id = ?`).get(id, tenantId);
  if (!head) return res.status(404).json({ error: 'Fee head not found' });

  db.prepare(`UPDATE fee_heads SET is_active = 0 WHERE id = ? AND tenant_id = ?`).run(id, tenantId);
  recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'fee_head', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

// Phase 4: Bulk fee assignment by class.
// Assigns one fee head to every active student in a class for a given term.
function bulkAssign(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: feeHeadId } = req.params;
  const { termId, class: klass, expectedAmount, overwriteExisting } = req.body;

  const head = db.prepare(`SELECT id FROM fee_heads WHERE id = ? AND tenant_id = ? AND is_active = 1`).get(feeHeadId, tenantId);
  if (!head) return res.status(404).json({ error: 'Fee head not found' });

  const term = db.prepare(`SELECT id FROM terms WHERE id = ? AND tenant_id = ?`).get(termId, tenantId);
  if (!term) return res.status(404).json({ error: 'Term not found' });

  const students = db.prepare(`SELECT id FROM students WHERE tenant_id = ? AND class = ? AND status = 'active'`).all(tenantId, klass);

  let assigned = 0;
  let skipped = 0;

  const run = db.transaction(() => {
    for (const s of students) {
      const existing = db.prepare(`
        SELECT id FROM student_fee_assignments
        WHERE student_id = ? AND fee_head_id = ? AND term_id = ?
      `).get(s.id, feeHeadId, termId);

      if (existing) {
        if (overwriteExisting) {
          db.prepare(`UPDATE student_fee_assignments SET expected_amount = ? WHERE id = ?`).run(expectedAmount, existing.id);
          assigned++;
        } else {
          skipped++;
        }
      } else {
        db.prepare(`
          INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), tenantId, s.id, feeHeadId, termId, expectedAmount, userId);
        assigned++;
      }
    }
  });
  run();

  recordAudit({
    tenantId, actorUserId: userId, action: 'create', entityType: 'bulk_fee_assignment', entityId: feeHeadId,
    ipAddress: req.ip, metadata: { feeHeadId, class: klass, expectedAmount, assigned, skipped },
  });

  res.json({ assigned, skipped });
}

module.exports = { listFeeHeads, createFeeHead, deactivateFeeHead, bulkAssign };
