const db = require('../db');
const { recordAudit } = require('../utils/audit');

// School KYC / bio-data controller.
//
// Three handlers:
//   GET  /api/v1/school-kyc         — returns the current KYC status + all KYC
//                                     fields for the caller's tenant
//   POST /api/v1/school-kyc         — validates + saves the KYC form, flips
//                                     kyc_completed to true (initial onboarding)
//   PUT  /api/v1/school-kyc         — partial update of KYC fields (later edits
//                                     from Settings → School Profile)
//
// Required-vs-optional field lists are mirrored between submitKyc (server-side
// guard) and the express-validator chain in routes/school-kyc.routes.js. The
// route-level chain is the first line of defense; the controller's explicit
// check exists so a misconfigured client (or a future route that reuses the
// controller) can't bypass validation.

// Columns the KYC form is allowed to write. Centralised so submitKyc and
// updateKyc can't drift on which fields are accepted. `kyc_completed`,
// `kyc_completed_at`, `tos_accepted`, `privacy_accepted`, and `signature` are
// set explicitly below — they're NOT user-editable via updateKyc.
const KYC_FIELDS = [
  'school_type',
  'education_level',
  'year_established',
  'school_motto',
  'address',
  'lga',
  'state',
  'school_email',
  'school_website',
  'registration_number',
  'registration_type',
  'tax_id',
  'student_count_estimate',
  'staff_count',
  'calendar_type',
  'classes_offered',
];

// Snake-case DB columns → camelCase API keys. Kept as a flat list (rather than
// a map) because the conversion is a simple regex; a map would duplicate every
// key. `kyc_completed` and `kyc_completed_at` are exposed separately so the
// frontend can show "submitted on <date>" without re-deriving it.
function rowToPayload(row) {
  if (!row) {
    return { kycCompleted: false };
  }
  const out = { kycCompleted: !!row.kyc_completed };
  for (const col of KYC_FIELDS) {
    out[col] = row[col] === undefined ? null : row[col];
  }
  out.tosAccepted = !!row.tos_accepted;
  out.privacyAccepted = !!row.privacy_accepted;
  out.signature = row.signature || null;
  out.kycCompletedAt = row.kyc_completed_at || null;
  return out;
}

// Returns the KYC status + all KYC fields for the current tenant.
// Used by the frontend to pre-fill the form (in case the user navigates away
// and comes back) and to decide whether to redirect to /school-kyc.
async function getKycStatus(req, res) {
  const { tenantId } = req.user;
  const { rows } = await db.query(
    `SELECT school_type, education_level, year_established, school_motto, address,
            lga, state, school_email, school_website, registration_number,
            registration_type, tax_id, student_count_estimate, staff_count,
            calendar_type, classes_offered, kyc_completed, kyc_completed_at,
            tos_accepted, privacy_accepted, signature
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  res.json(rowToPayload(rows[0]));
}

// Validates that all required KYC fields are present + non-empty.
// Returns an array of `{ field, message }` details — empty array means valid.
// express-validator already enforces these on the route, but this is a
// defense-in-depth check (and a clearer error surface for the client).
function validateRequired(body) {
  const details = [];
  const required = [
    ['school_type', 'School type is required'],
    ['education_level', 'Education level is required'],
    ['year_established', 'Year established is required (4-digit year)'],
    ['address', 'Full address is required'],
    ['lga', 'LGA is required'],
    ['state', 'State is required'],
    ['registration_number', 'Registration number is required'],
    ['registration_type', 'Registration type is required'],
    ['calendar_type', 'Academic calendar type is required'],
    ['classes_offered', 'Please select at least one class offered'],
    ['signature', 'Digital signature is required'],
  ];
  for (const [field, message] of required) {
    const v = body[field];
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      details.push({ field, message });
    }
  }
  if (!body.tos_accepted || body.tos_accepted === 'false' || body.tos_accepted === false) {
    details.push({ field: 'tos_accepted', message: 'You must accept the Terms of Service' });
  }
  if (!body.privacy_accepted || body.privacy_accepted === 'false' || body.privacy_accepted === false) {
    details.push({ field: 'privacy_accepted', message: 'You must accept the Privacy Policy' });
  }
  const studentCount = Number(body.student_count_estimate);
  if (!Number.isInteger(studentCount) || studentCount < 1) {
    details.push({ field: 'student_count_estimate', message: 'Student count must be a positive whole number' });
  }
  return details;
}

// Submits the KYC form (initial onboarding). Sets kyc_completed = true and
// stamps kyc_completed_at. Idempotent — re-submitting just overwrites the
// stored fields and re-stamps the timestamp.
async function submitKyc(req, res) {
  const { tenantId, id: userId } = req.user;
  const body = req.body || {};

  const details = validateRequired(body);
  if (details.length > 0) {
    return res.status(400).json({ error: 'Please complete all required fields', details });
  }

  // Coerce student_count_estimate to int — express-validator already validated
  // it's an integer in range, this is just to satisfy the pg parameter binding.
  const values = {
    school_type: body.school_type,
    education_level: body.education_level,
    year_established: body.year_established,
    school_motto: body.school_motto || null,
    address: body.address,
    lga: body.lga,
    state: body.state,
    school_email: body.school_email || null,
    school_website: body.school_website || null,
    registration_number: body.registration_number,
    registration_type: body.registration_type,
    tax_id: body.tax_id || null,
    student_count_estimate: Number(body.student_count_estimate),
    staff_count: body.staff_count ? Number(body.staff_count) : null,
    calendar_type: body.calendar_type,
    classes_offered: body.classes_offered,
    tos_accepted: true,
    privacy_accepted: true,
    signature: body.signature,
    kyc_completed: true,
    kyc_completed_at: new Date().toISOString(),
  };

  // Build a single UPDATE — $N placeholders for each column. The column list
  // is fixed (KYC_FIELDS + the audit flags) so we don't need a dynamic builder.
  const cols = [
    'school_type', 'education_level', 'year_established', 'school_motto',
    'address', 'lga', 'state', 'school_email', 'school_website',
    'registration_number', 'registration_type', 'tax_id',
    'student_count_estimate', 'staff_count', 'calendar_type', 'classes_offered',
    'tos_accepted', 'privacy_accepted', 'signature',
    'kyc_completed', 'kyc_completed_at',
  ];
  const params = cols.map((c) => values[c]);
  const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');

  await db.query(
    `UPDATE tenants SET ${setClause} WHERE id = $${cols.length + 1}`,
    [...params, tenantId]
  );

  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'create',
    entityType: 'school_kyc',
    entityId: tenantId,
    ipAddress: req.ip,
    metadata: { kycCompleted: true },
  });

  res.json({ ok: true, kycCompleted: true });
}

// Partial update of KYC fields — used by the Settings → School Profile page
// to edit KYC data later (after onboarding is complete). Does NOT require all
// fields, and does NOT flip kyc_completed / kyc_completed_at (those are set
// only by submitKyc). Only accepts the columns listed in KYC_FIELDS — the
// agreement flags and signature are not editable here (the user already
// accepted them at onboarding).
async function updateKyc(req, res) {
  const { tenantId, id: userId } = req.user;
  const body = req.body || {};

  // Build the SET clause from whichever KYC fields are present in the body.
  // This is intentionally permissive — the Settings page may only send the
  // subset of fields the user actually changed. Empty arrays are fine; the
  // UPDATE just becomes a no-op.
  const sets = [];
  const params = [];
  for (const col of KYC_FIELDS) {
    if (body[col] !== undefined) {
      params.push(body[col]);
      sets.push(`${col} = $${params.length}`);
    }
  }

  if (sets.length > 0) {
    params.push(tenantId);
    await db.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params
    );
    await recordAudit({
      tenantId,
      actorUserId: userId,
      action: 'update',
      entityType: 'school_kyc',
      entityId: tenantId,
      ipAddress: req.ip,
      metadata: { fields: sets.map((s) => s.split(' =')[0]) },
    });
  }

  // Return the refreshed KYC status so the client can update its local copy.
  const { rows } = await db.query(
    `SELECT school_type, education_level, year_established, school_motto, address,
            lga, state, school_email, school_website, registration_number,
            registration_type, tax_id, student_count_estimate, staff_count,
            calendar_type, classes_offered, kyc_completed, kyc_completed_at,
            tos_accepted, privacy_accepted, signature
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  res.json(rowToPayload(rows[0]));
}

module.exports = { getKycStatus, submitKyc, updateKyc };
