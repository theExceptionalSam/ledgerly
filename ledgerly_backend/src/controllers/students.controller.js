const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Every query below is scoped by tenant_id taken from the authenticated session (req.user.tenantId),
// never from client input. This is the tenant-isolation boundary.
//
// Phase 2: billing is now per-term, per-fee-head. List/detail/dashboard calls accept ?termId=
// and default to the tenant's current term when omitted, so callers always get a sensible scope.
//
// Postgres migration note: db.query() is async (pg) and uses native $N placeholders. Every
// function that touches the db is async, and recordAudit() is awaited. recordAudit() accepts an
// optional client so audit writes can join the caller's open transaction.

async function resolveTermId(tenantId, termId) {
  if (termId) return termId;
  const { rows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
  const current = rows[0];
  return current ? current.id : null;
}

// Auto-sync fees: when a new student is added to a class, replicate the fee
// assignments that other active students in the same class already have for
// the current term. This means once you've set up fees for one student in a
// class (via bulk-assign or individual assignment), every new student added
// to that class automatically gets the same fees — no manual setup needed.
//
// Returns the number of fee assignments created (0 if the class had no
// existing assignments or there's no current term).
//
// BUGFIX: the student_fee_assignments table has `created_by TEXT NOT NULL`
// (no default) — the previous INSERT omitted it, so every replication was
// silently failing with a not-null violation (caught & logged in bulkUpload,
// thrown as a 500 from createStudent AFTER the student row had already been
// inserted). We now thread `actorUserId` through and write it into the
// replicated rows.
async function autoSyncClassFees(tenantId, studentId, klass, actorUserId) {
  if (!klass) return 0;
  const termId = await resolveTermId(tenantId, null);
  if (!termId) return 0;

  // Find the fee assignments that OTHER active students in the same class have
  // for the current term. DISTINCT ON (fee_head_id) picks one row per fee head
  // so we don't duplicate if multiple students have slightly different amounts
  // (we take the first one — typically they're all the same since bulk-assign
  // sets them uniformly).
  const { rows: templates } = await db.query(
    `SELECT DISTINCT ON (sfa.fee_head_id)
            sfa.fee_head_id, sfa.expected_amount, sfa.discount_amount, sfa.discount_reason
     FROM student_fee_assignments sfa
     JOIN students s ON s.id = sfa.student_id
     WHERE sfa.tenant_id = $1 AND sfa.term_id = $2
       AND s.class = $3 AND s.status = 'active'
       AND sfa.student_id != $4
     ORDER BY sfa.fee_head_id, sfa.created_at DESC`,
    [tenantId, termId, klass, studentId]
  );

  if (templates.length === 0) return 0;

  let created = 0;
  for (const t of templates) {
    // Skip if this student already has an assignment for this fee head + term
    // (e.g. if createStudent is called twice for the same student).
    const { rows: existing } = await db.query(
      `SELECT id FROM student_fee_assignments WHERE student_id = $1 AND fee_head_id = $2 AND term_id = $3`,
      [studentId, t.fee_head_id, termId]
    );
    if (existing[0]) continue;

    await db.query(
      `INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, discount_amount, discount_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), tenantId, studentId, t.fee_head_id, termId, t.expected_amount, t.discount_amount || 0, t.discount_reason || null, actorUserId]
    );
    created++;
  }
  return created;
}

async function listStudents(req, res) {
  const { tenantId } = req.user;
  const termId = await resolveTermId(tenantId, req.query.termId);
  const showArchived = req.query.status === 'archived';

  // --- Archived view (no pagination needed — archived lists are small) ---
  if (showArchived) {
    const { rows } = await db.query(`
      SELECT s.id, s.name, s.class, s.admission_no, s.guardian_contact, s.status, s.created_at
      FROM students s
      WHERE s.tenant_id = $1 AND s.status = 'archived'
      ORDER BY s.name ASC
    `, [tenantId]);
    return res.json({ students: rows, total: rows.length });
  }

  // --- Active view with pagination ---
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  // Allow up to 500 students per page so dropdowns (e.g. PaymentPlans "New
  // plan" → student select) can fetch all active students in one request.
  // The previous cap of 200 silently truncated tenants with >200 students,
  // so the dropdown appeared "missing" students. 500 covers even large
  // schools while still bounding the query cost.
  const pageSize = Math.min(parseInt(req.query.pageSize, 10) || 50, 500);
  const offset = (page - 1) * pageSize;
  const search = req.query.search;

  // NOTE: when there is no current term (and no termId query param), termId
  // is null. We do NOT early-return an empty list — that previously made the
  // PaymentPlans student dropdown appear empty for tenants that hadn't yet
  // marked a term as current, even though they had active students. Instead
  // we fall through: the COALESCE subqueries below return 0 for the
  // expected/paid aggregates when termId is null (NULL = anything is never
  // true in SQL), so the rows still come back, just with zeroed balances.
  // The Students page already handles the "no current term" case by showing
  // status='unset', which matches this behaviour.

  // Build the WHERE clause for search (server-side, case-insensitive)
  let searchSql = '';
  const params = [termId, termId, tenantId];
  if (search && search.trim()) {
    searchSql = ` AND (s.name ILIKE $4 OR s.class ILIKE $4 OR s.admission_no ILIKE $4 OR s.guardian_contact ILIKE $4)`;
    params.push(`%${search.trim()}%`);
  }

  // Get total count for pagination
  const countParams = search ? [tenantId, `%${search.trim()}%`] : [tenantId];
  const countSql = search
    ? `SELECT COUNT(*) AS total FROM students s WHERE s.tenant_id = $1 AND s.status = 'active' AND (s.name ILIKE $2 OR s.class ILIKE $2 OR s.admission_no ILIKE $2 OR s.guardian_contact ILIKE $2)`
    : `SELECT COUNT(*) AS total FROM students s WHERE s.tenant_id = $1 AND s.status = 'active'`;
  const { rows: countRows } = await db.query(countSql, countParams);
  const total = parseInt(countRows[0].total, 10);

  // Get the page of students
  const pageParams = [...params, pageSize, offset];
  const { rows: students } = await db.query(`
    SELECT s.id, s.name, s.class, s.admission_no, s.guardian_contact,
      COALESCE((SELECT SUM(sfa.expected_amount - sfa.discount_amount)
                FROM student_fee_assignments sfa
                WHERE sfa.student_id = s.id AND sfa.term_id = $1), 0) AS expected,
      COALESCE((SELECT SUM(p.amount)
                FROM payments p
                WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) AS paid
    FROM students s
    WHERE s.tenant_id = $3 AND s.status = 'active'${searchSql}
    ORDER BY s.name ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `, pageParams);

  const withStatus = students.map(s => {
    const expected = Number(s.expected) || 0;
    const paid = Number(s.paid) || 0;
    const outstanding = Math.max(expected - paid, 0);
    let status = 'unset';
    if (expected > 0) {
      status = paid >= expected ? 'paid' : paid > 0 ? 'partial' : 'outstanding';
    }
    return { ...s, expected, paid, outstanding, status };
  });

  res.json({ students: withStatus, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

async function createStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { name, class: klass, admissionNo, guardianContact } = req.body;

  const id = randomUUID();
  await db.query(`
    INSERT INTO students (id, tenant_id, name, class, admission_no, guardian_contact, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [id, tenantId, name, klass, admissionNo || null, guardianContact || null, userId]);

  // Auto-sync fees: replicate the fee assignments that other students in the
  // same class already have for the current term. Non-fatal — if sync fails
  // (e.g. no current term, or no other students in the class have fees yet),
  // the student is still created; feesSynced comes back as 0 and the user can
  // set up fees manually later. Wrapped in try/catch so a transient DB error
  // here doesn't 500 the whole createStudent call (which would leave the
  // student row orphaned — it's already been INSERTed above with no
  // transaction).
  let feesSynced = 0;
  try {
    feesSynced = await autoSyncClassFees(tenantId, id, klass, userId);
  } catch (e) {
    console.error('[createStudent] autoSyncClassFees failed for', id, ':', e.message);
  }

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'student', entityId: id, ipAddress: req.ip, metadata: feesSynced > 0 ? { feesAutoSynced: feesSynced } : undefined });
  res.status(201).json({ id, feesSynced });
}

async function updateStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;
  const { name, class: klass, admissionNo, guardianContact } = req.body;

  const { rows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  await db.query(`
    UPDATE students SET name = $1, class = $2, admission_no = $3, guardian_contact = $4
    WHERE id = $5 AND tenant_id = $6
  `, [name, klass, admissionNo || null, guardianContact || null, id, tenantId]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

// Soft delete only — financial history must never be hard-deleted for audit integrity
async function archiveStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'Student not found' });

  await db.query(`UPDATE students SET status = 'archived' WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'student', entityId: id, ipAddress: req.ip });
  res.json({ ok: true });
}

// Restore an archived student back to active status. Financial history is
// untouched — the student simply reappears in the active list.
async function restoreStudent(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id } = req.params;

  const { rows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2 AND status = 'archived'`, [id, tenantId]);
  if (!rows[0]) return res.status(404).json({ error: 'Archived student not found' });

  await db.query(`UPDATE students SET status = 'active' WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'student', entityId: id, ipAddress: req.ip, metadata: { action: 'restored' } });
  res.json({ ok: true });
}

// Bulk archive — soft-deletes multiple students in a single UPDATE. Financial history is
// preserved for each. Returns the count archived (rowCount from the bulk UPDATE).
async function bulkArchiveStudents(req, res) {
  const { tenantId, id: userId } = req.user;
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided' });
  }

  let archived = 0;
  await db.transaction(async (client) => {
    const result = await db.query(
      `UPDATE students SET status = 'archived' WHERE id = ANY($1::text[]) AND tenant_id = $2 AND status = 'active'`,
      [ids, tenantId], client
    );
    archived = result.rowCount;
  });

  if (archived > 0) {
    await recordAudit({ tenantId, actorUserId: userId, action: 'delete', entityType: 'student_bulk', ipAddress: req.ip, metadata: { archived } });
  }
  res.json({ archived });
}

// Bulk restore — flips multiple archived students back to 'active' in a single
// UPDATE. Mirrors bulkArchiveStudents. Financial history is untouched; the
// students simply reappear in the active list.
async function bulkRestoreStudents(req, res) {
  const { tenantId, id: userId } = req.user;
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'No student IDs provided' });
  }

  let restored = 0;
  await db.transaction(async (client) => {
    const result = await db.query(
      `UPDATE students SET status = 'active' WHERE id = ANY($1::text[]) AND tenant_id = $2 AND status = 'archived'`,
      [ids, tenantId], client
    );
    restored = result.rowCount;
  });

  if (restored > 0) {
    await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'student_bulk', entityId: null, ipAddress: req.ip, metadata: { restored } });
  }
  res.json({ restored });
}

async function getStudentDetail(req, res) {
  const { tenantId } = req.user;
  const { id } = req.params;
  const termId = await resolveTermId(tenantId, req.query.termId);

  const { rows: studentRows } = await db.query(`SELECT id, name, class, admission_no, guardian_contact, status, created_at FROM students WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const student = studentRows[0];
  if (!student) return res.status(404).json({ error: 'Student not found' });

  let payments = [];
  if (termId) {
    const { rows: paymentRows } = await db.query(`
        SELECT p.id, p.amount, p.method, p.note, p.paid_on, p.fee_head_id, p.term_id, p.created_at, fh.name AS fee_head_name, u.name AS recorded_by_name
        FROM payments p
        LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
        LEFT JOIN users u ON u.id = p.recorded_by
        WHERE p.student_id = $1 AND p.tenant_id = $2 AND p.term_id = $3 AND p.reversed = 0
        ORDER BY p.paid_on DESC
    `, [id, tenantId, termId]);
    payments = paymentRows;
  }

  const fees = termId ? await getStudentFeesInternal(tenantId, id, termId) : [];

  // No audit entry for `action: 'access'` — auditing every student detail view bloats the
  // audit log and the query is already scoped by tenant_id.
  res.json({ student, payments, fees, termId });
}

// --- Phase 2: itemised fee assignments ---

async function getStudentFeesInternal(tenantId, studentId, termId) {
  const { rows } = await db.query(`
    SELECT sfa.id, sfa.fee_head_id, sfa.term_id, sfa.expected_amount, sfa.discount_amount,
           sfa.discount_reason, fh.name AS fee_head_name,
           COALESCE((SELECT SUM(p.amount) FROM payments p
                     WHERE p.student_id = sfa.student_id AND p.fee_head_id = sfa.fee_head_id
                       AND p.term_id = sfa.term_id AND p.reversed = 0), 0) AS paid
    FROM student_fee_assignments sfa
    JOIN fee_heads fh ON fh.id = sfa.fee_head_id
    WHERE sfa.tenant_id = $1 AND sfa.student_id = $2 AND sfa.term_id = $3
    ORDER BY fh.name
  `, [tenantId, studentId, termId]);
  return rows.map(a => ({
    ...a,
    outstanding: Math.max(a.expected_amount - a.discount_amount - a.paid, 0),
  }));
}

async function getStudentFees(req, res) {
  const { tenantId } = req.user;
  const { id } = req.params;
  const termId = await resolveTermId(tenantId, req.query.termId);
  if (!termId) return res.json({ fees: [] });

  const { rows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
  const student = rows[0];
  if (!student) return res.status(404).json({ error: 'Student not found' });

  res.json({ fees: await getStudentFeesInternal(tenantId, id, termId) });
}

async function assignStudentFee(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: studentId } = req.params;
  const { feeHeadId, termId, expectedAmount } = req.body;

  const { rows: studentRows } = await db.query(`SELECT id FROM students WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [studentId, tenantId]);
  const student = studentRows[0];
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const { rows: headRows } = await db.query(`SELECT id FROM fee_heads WHERE id = $1 AND tenant_id = $2 AND is_active = 1`, [feeHeadId, tenantId]);
  const head = headRows[0];
  if (!head) return res.status(404).json({ error: 'Fee head not found' });

  const { rows: termRows } = await db.query(`SELECT id FROM terms WHERE id = $1 AND tenant_id = $2`, [termId, tenantId]);
  const term = termRows[0];
  if (!term) return res.status(404).json({ error: 'Term not found' });

  // Upsert: insert, or update expected_amount if the (student, head, term) row already exists.
  //
  // Race condition handling: two concurrent assignStudentFee calls for the same
  // (student, fee_head, term) triple both pass the SELECT above and race on the
  // INSERT. The loser fails with PostgreSQL error 23505 (unique_violation on
  // (student_id, fee_head_id, term_id)). Instead of surfacing as a 500, we
  // re-fetch the winner's row and UPDATE its expected_amount — same effect as
  // the happy-path upsert above.
  const { rows: existingRows } = await db.query(`SELECT id FROM student_fee_assignments WHERE student_id = $1 AND fee_head_id = $2 AND term_id = $3`, [studentId, feeHeadId, termId]);
  const existing = existingRows[0];
  let assignmentId;
  if (existing) {
    await db.query(`UPDATE student_fee_assignments SET expected_amount = $1 WHERE id = $2`, [expectedAmount, existing.id]);
    assignmentId = existing.id;
  } else {
    assignmentId = randomUUID();
    try {
      await db.query(`
        INSERT INTO student_fee_assignments (id, tenant_id, student_id, fee_head_id, term_id, expected_amount, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [assignmentId, tenantId, studentId, feeHeadId, termId, expectedAmount, userId]);
    } catch (err) {
      if (err && err.code === '23505') {
        // Another concurrent call won the race — re-fetch its row and UPDATE.
        const { rows: winnerRows } = await db.query(`SELECT id FROM student_fee_assignments WHERE student_id = $1 AND fee_head_id = $2 AND term_id = $3`, [studentId, feeHeadId, termId]);
        const winner = winnerRows[0];
        if (winner) {
          await db.query(`UPDATE student_fee_assignments SET expected_amount = $1 WHERE id = $2`, [expectedAmount, winner.id]);
          assignmentId = winner.id;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'fee_assignment', entityId: assignmentId, ipAddress: req.ip, metadata: { studentId, feeHeadId, termId, expectedAmount } });
  res.status(201).json({ id: assignmentId });
}

async function applyDiscount(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: studentId, assignmentId } = req.params;
  const { discountAmount, discountReason } = req.body;

  const { rows: assignmentRows } = await db.query(`
    SELECT sfa.id FROM student_fee_assignments sfa
    JOIN students s ON s.id = sfa.student_id
    WHERE sfa.id = $1 AND sfa.student_id = $2 AND sfa.tenant_id = $3
  `, [assignmentId, studentId, tenantId]);
  const assignment = assignmentRows[0];
  if (!assignment) return res.status(404).json({ error: 'Fee assignment not found' });

  await db.query(`
    UPDATE student_fee_assignments
    SET discount_amount = $1, discount_reason = $2, discount_approved_by = $3
    WHERE id = $4
  `, [discountAmount, discountReason || null, userId, assignmentId]);

  await recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'discount', entityId: assignmentId, ipAddress: req.ip, metadata: { studentId, discountAmount, discountReason } });
  res.json({ ok: true });
}

module.exports = { listStudents, createStudent, updateStudent, archiveStudent, restoreStudent, bulkArchiveStudents, bulkRestoreStudents, getStudentDetail, getStudentFees, assignStudentFee, applyDiscount, autoSyncClassFees };
