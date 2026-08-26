const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Fee heads are the catalogue of chargeable items a school bills for (Tuition,
// Boarding, Feeding, etc.). They are soft-deleted (is_active = 0), never hard
// deleted, because student_fee_assignments reference them.

async function listFeeHeads(req, res) {
  const { tenantId } = req.user;
  const { rows: heads } = await db.query(`
    SELECT * FROM fee_heads WHERE tenant_id = $1 AND is_active = 1 ORDER BY name
  `, [tenantId]);
  res.json({ feeHeads: heads });
}

async function createFeeHead(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name } = req.body;

  const { rows } = await db.query(`SELECT id FROM fee_heads WHERE tenant_id = $1 AND name = $2`, [tenantId, name]);
  const existing = rows[0];
  if (existing) return res.status(409).json({ error: 'A fee head with this name already exists' });

  const id = randomUUID();
  await db.query(`INSERT INTO fee_heads (id, tenant_id, name) VALUES ($1, $2, $3)`, [id, tenantId, name]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'fee_head', entityId: id, ipAddress: req.ip, metadata: { name } });
  res.status(201).json({ id });
}

async function deactivateFeeHead(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows } = await db.query(`SELECT id FROM fee_heads WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const head = rows[0];
  if (!head) return res.status(404).json({ error: 'Fee head not found' });

  await db.query(`UPDATE fee_heads SET is_active = 0 WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'fee_head', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

// Phase 4: Bulk fee assignment by class.
// Assigns one fee head to every active student in a class for a given term.
async function bulkAssign(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: feeHeadId } = req.params;
  const { termId, class: klass, expectedAmount, overwriteExisting } = req.body;

  const { rows: headRows } = await db.query(`SELECT id FROM fee_heads WHERE id = $1 AND tenant_id = $2 AND is_active = 1`, [feeHeadId, tenantId]);
  const head = headRows[0];
  if (!head) return res.status(404).json({ error: 'Fee head not found' });

  const { rows: termRows } = await db.query(`SELECT id FROM terms WHERE id = $1 AND tenant_id = $2`, [termId, tenantId]);
  const term = termRows[0];
  if (!term) return res.status(404).json({ error: 'Term not found' });

  const { rows: students } = await db.query(`SELECT id FROM students WHERE tenant_id = $1 AND class = $2 AND status = 'active'`, [tenantId, klass]);

  let assigned = 0;
  let skipped = 0;

  // Per-student loop is intentional: each student may or may not already have an
  // assignment for this (head, term), and the overwriteExisting flag controls
  // update-vs-skip on conflict. All queries use the transaction client so the
  // whole batch commits atomically (or rolls back on any error).
  await db.transaction(async (client) => {
    for (const s of students) {
      const { rows } = await db.query(`
        SELECT id FROM student_fee_assignments
        WHERE student_id = $1 AND fee_head_id = $2 AND term_id = $3
      `, [s.id, feeHeadId, termId], client);
      const existing = rows[0];

      if (existing) {
        if (overwriteExisting) {
          await db.query(`UPDATE student_fee_assignments SET expected_amount = $1 WHERE id = $2`, [expectedAmount, existing.id], client);
          assigned++;
        } else {
          skipped++;
        }
      } else {
        await db.query(`
          INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [randomUUID(), tenantId, s.id, feeHeadId, termId, expectedAmount, userId], client);
        assigned++;
      }
    }
  });

  await recordAudit({
    tenantId, actorUserId: userId, action: 'create', entityType: 'bulk_fee_assignment', entityId: feeHeadId,
    ipAddress: req.ip, metadata: { feeHeadId, class: klass, expectedAmount, assigned, skipped },
  });

  res.json({ assigned, skipped });
}

module.exports = { listFeeHeads, createFeeHead, deactivateFeeHead, bulkAssign };
