const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Fee templates — a reusable catalogue of fee items (e.g. "SS1 First Term Bundle"
// = Tuition 50k + Boarding 30k + Feeding 15k). Apply a template to one or more
// students to bulk-create student_fee_assignments for the current term.

async function listTemplates(req, res) {
  const { rows } = await db.query(
    `SELECT id, name, class_name, items, created_at
     FROM fee_templates WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [req.user.tenantId]
  );
  // items is stored as a JSON string — parse it for the client.
  const templates = rows.map((t) => ({ ...t, items: typeof t.items === 'string' ? JSON.parse(t.items) : t.items }));
  res.json({ templates });
}

async function createTemplate(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, className, items } = req.body;
  // items: [{ feeHeadId, expectedAmount }] — validated by the route. We store as
  // JSON text (the items column is TEXT, not JSONB — keeps the migration simple).
  const id = randomUUID();
  await db.query(
    `INSERT INTO fee_templates (id, tenant_id, name, class_name, items, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, tenantId, name, className || null, JSON.stringify(items || []), userId]
  );
  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'fee_template', entityId: id, ipAddress: req.ip, metadata: { name, className, itemCount: (items || []).length } });
  res.status(201).json({ id });
}

async function applyTemplate(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: templateId } = req.params;
  const { studentIds, class: className } = req.body;

  // Load the template + verify ownership.
  const { rows: tplRows } = await db.query(`SELECT * FROM fee_templates WHERE id = $1 AND tenant_id = $2`, [templateId, tenantId]);
  const template = tplRows[0];
  if (!template) return res.status(404).json({ error: 'Template not found' });
  const items = typeof template.items === 'string' ? JSON.parse(template.items) : template.items;
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Template has no items' });

  // Resolve target students: explicit list OR everyone in a class.
  let targets;
  if (Array.isArray(studentIds) && studentIds.length > 0) {
    const { rows } = await db.query(`SELECT id FROM students WHERE id = ANY($1::text[]) AND tenant_id = $2 AND status = 'active'`, [studentIds, tenantId]);
    targets = rows.map((r) => r.id);
  } else if (className) {
    const { rows } = await db.query(`SELECT id FROM students WHERE tenant_id = $1 AND class = $2 AND status = 'active'`, [tenantId, className]);
    targets = rows.map((r) => r.id);
  } else {
    return res.status(400).json({ error: 'Provide studentIds[] or class' });
  }

  if (targets.length === 0) return res.status(400).json({ error: 'No matching students' });

  // Resolve the current term — assignments are always for the current term.
  const { rows: termRows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
  if (!termRows[0]) return res.status(400).json({ error: 'No current term set' });
  const termId = termRows[0].id;

  let created = 0;
  await db.transaction(async (client) => {
    for (const studentId of targets) {
      for (const item of items) {
        // Upsert: if an assignment already exists for (student, head, term),
        // update the expected_amount; otherwise insert.
        const { rows: existing } = await db.query(
          `SELECT id FROM student_fee_assignments WHERE student_id = $1 AND fee_head_id = $2 AND term_id = $3`,
          [studentId, item.feeHeadId, termId],
          client
        );
        if (existing[0]) {
          await db.query(`UPDATE student_fee_assignments SET expected_amount = $1 WHERE id = $2`, [item.expectedAmount, existing[0].id], client);
        } else {
          await db.query(
            `INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomUUID(), tenantId, studentId, item.feeHeadId, termId, item.expectedAmount, userId],
            client
          );
          created++;
        }
      }
    }
  });

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'fee_template_apply', entityId: templateId, ipAddress: req.ip, metadata: { templateId, students: targets.length, created } });
  res.json({ applied: targets.length, created });
}

module.exports = { listTemplates, createTemplate, applyTemplate };
