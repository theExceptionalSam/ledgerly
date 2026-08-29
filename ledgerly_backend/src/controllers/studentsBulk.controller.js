const { randomUUID } = require('crypto');
const XLSX = require('xlsx');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { autoSyncClassFees } = require('./students.controller');

// Bulk student import from an Excel (.xlsx/.xls) or CSV file.
// Expected headers (first row): Name | Class | Admission No | Parent Contact
//
// After the bulk INSERT, auto-syncs fees: for each new student, replicates the
// fee assignments that other active students in the same class already have for
// the current term. So if you've already set up fees for "JSS 1" students, every
// new "JSS 1" student in this upload automatically gets the same fees.
//
// Performance: the upload is committed as a SINGLE bulk INSERT with N value tuples,
// rather than one INSERT per row. This caps the round-trips to the DB at 1 regardless
// of how many students are in the file (up to the 1000-row cap).

const HEADER_ALIASES = {
  name: ['name', 'student name', 'fullname', 'full name'],
  class: ['class', 'class name'],
  admissionNo: ['admission no', 'admission number', 'admissionno'],
  guardianContact: ['parent contact', 'guardian contact', 'parent phone', 'guardian phone', 'phone'],
};

function mapHeaders(headerRow) {
  const map = {};
  (headerRow || []).forEach((raw, idx) => {
    const key = String(raw ?? '').trim().toLowerCase();
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(key)) map[field] = idx;
    }
  });
  return map;
}

async function bulkUpload(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { tenantId, id: userId } = req.user;
  let workbook;
  try {
    workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
  } catch {
    return res.status(400).json({ error: 'Could not read the file. Upload a valid .xlsx, .xls or .csv file.' });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return res.status(400).json({ error: 'The file has no sheets' });

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  // Skip fully empty rows, then use the first non-empty row as the header
  while (rows.length && rows[0].every((c) => String(c ?? '').trim() === '')) rows.shift();
  if (rows.length < 2) return res.status(400).json({ error: 'The file has a header row but no student rows' });

  const cols = mapHeaders(rows[0]);
  if (cols.name === undefined || cols.class === undefined) {
    return res.status(400).json({ error: 'Missing required columns: "Name" and "Class" must be present in the first row' });
  }

  const inserted = [];
  const insertedWithClass = []; // [{ id, class }] for auto-sync
  const failed = [];
  const limit = Math.min(rows.length - 1, 1000);

  // Pass 1: validate every row, collect the values for valid rows.
  // Each row contributes 7 columns: (id, tenant_id, name, class, admission_no, guardian_contact, created_by).
  const valueTuples = [];
  const params = [];
  for (let i = 1; i <= limit; i++) {
    const row = rows[i];
    const name = String(row[cols.name] ?? '').trim();
    const klass = String(row[cols.class] ?? '').trim();
    const admissionNo = cols.admissionNo !== undefined ? String(row[cols.admissionNo] ?? '').trim() : '';
    const guardianContact = cols.guardianContact !== undefined ? String(row[cols.guardianContact] ?? '').trim() : '';

    const rowNumber = i + 1; // 1-based, matching what the user sees in Excel
    if (!name || !klass) {
      failed.push({ row: rowNumber, reason: 'Name and class are required' });
      continue;
    }

    const id = randomUUID();
    valueTuples.push(id);
    inserted.push(id);
    insertedWithClass.push({ id, klass: klass.slice(0, 60) });
    params.push(
      id,
      tenantId,
      name.slice(0, 150),
      klass.slice(0, 60),
      admissionNo.slice(0, 60) || null,
      guardianContact.slice(0, 120) || null,
      userId
    );
  }

  // Pass 2: one bulk INSERT for all valid rows. Each tuple is ($N..$N+6), numbered
  // per-query starting at $1. A single INSERT is atomic on its own, so no
  // explicit transaction is required.
  if (params.length > 0) {
    const tuples = [];
    for (let i = 0; i < valueTuples.length; i++) {
      const base = i * 7;
      tuples.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`);
    }
    const sql = `
      INSERT INTO students (id, tenant_id, name, class, admission_no, guardian_contact, created_by)
      VALUES ${tuples.join(', ')}
    `;
    await db.query(sql, params);
  }

  // Pass 3: auto-sync fees for each new student. Replicates the fee assignments
  // that other active students in the same class already have for the current
  // term. Runs after the INSERT so the students exist in the DB. Errors here
  // are non-fatal — the students are already inserted; we just log and continue.
  let feesSynced = 0;
  for (const { id, klass } of insertedWithClass) {
    try {
      feesSynced += await autoSyncClassFees(tenantId, id, klass);
    } catch (e) {
      // Non-fatal — student is already inserted, just couldn't sync fees.
      console.error('[bulkUpload] autoSyncClassFees failed for', id, ':', e.message);
    }
  }

  if (inserted.length > 0) {
    await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'student_bulk', ipAddress: req.ip, metadata: { imported: inserted.length, failed: failed.length, feesAutoSynced: feesSynced } });
  }
  res.status(201).json({ imported: inserted.length, failed, feesSynced });
}

// Generates a one-row example workbook users can fill in and re-upload.
function bulkTemplate(req, res) {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Name', 'Class', 'Admission No', 'Parent Contact'],
    ['Amaka Johnson', 'JSS 1', 'SUN/2026/001', '08031234567'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Students');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="ledgerly-students-template.xlsx"');
  res.send(buffer);
}

module.exports = { bulkUpload, bulkTemplate };
