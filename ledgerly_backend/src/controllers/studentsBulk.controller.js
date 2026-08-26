const { randomUUID } = require('crypto');
const XLSX = require('xlsx');
const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Bulk student import from an Excel (.xlsx/.xls) or CSV file.
// Expected headers (first row): Name | Class | Admission No | Parent Contact
// (Fee Amount is no longer imported — fee heads are assigned per student after creation.)

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
  const failed = [];
  const insertSql = `
    INSERT INTO students (id, tenant_id, name, class, admission_no, guardian_contact, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `;
  const limit = Math.min(rows.length - 1, 1000);

  await db.transaction(async (client) => {
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
      await db.query(insertSql, [
        id, tenantId, name.slice(0, 150), klass.slice(0, 60),
        admissionNo.slice(0, 60) || null, guardianContact.slice(0, 120) || null, userId
      ], client);
      inserted.push(id);
    }
  });

  if (inserted.length > 0) {
    await recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'student_bulk', ipAddress: req.ip, metadata: { imported: inserted.length, failed: failed.length } });
  }
  res.status(201).json({ imported: inserted.length, failed });
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
