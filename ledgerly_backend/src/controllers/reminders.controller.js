const { randomUUID } = require('crypto');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { sendMessage } = require('../services/messaging');

// Phase 5: Parent-facing reminders (SMS/WhatsApp).
// reminders_enabled defaults to 0. Manual and bulk sends are both blocked
// until the owner explicitly turns it on in settings — this is a consent and
// cost-control gate, not optional.

const DEFAULT_TEMPLATE = 'Dear parent/guardian, {studentName} has an outstanding balance of NGN {outstanding} for {termName}. Kindly clear this at your earliest convenience. — {schoolName}';

function getSettingsRow(tenantId) {
  let row = db.prepare(`SELECT * FROM tenant_messaging_settings WHERE tenant_id = ?`).get(tenantId);
  if (!row) {
    db.prepare(`INSERT INTO tenant_messaging_settings (tenant_id) VALUES (?)`).run(tenantId);
    row = db.prepare(`SELECT * FROM tenant_messaging_settings WHERE tenant_id = ?`).get(tenantId);
  }
  return row;
}

function getSettings(req, res) {
  const { tenantId } = req.user;
  res.json({ settings: getSettingsRow(tenantId) });
}

function updateSettings(req, res) {
  const { tenantId, id: userId } = req.user;
  const { remindersEnabled, defaultChannel, messageTemplate } = req.body;

  getSettingsRow(tenantId); // ensure row exists
  db.prepare(`
    UPDATE tenant_messaging_settings
    SET reminders_enabled = ?, default_channel = ?, message_template = ?
    WHERE tenant_id = ?
  `).run(remindersEnabled ? 1 : 0, defaultChannel || 'sms', messageTemplate || DEFAULT_TEMPLATE, tenantId);

  recordAudit({ tenantId, actorUserId: userId, action: 'update', entityType: 'messaging_settings', entityId: tenantId, ipAddress: req.ip, metadata: { remindersEnabled } });
  res.json({ ok: true });
}

function renderTemplate(template, vars) {
  return template
    .replace(/\{studentName\}/g, vars.studentName)
    .replace(/\{outstanding\}/g, vars.outstanding)
    .replace(/\{termName\}/g, vars.termName)
    .replace(/\{schoolName\}/g, vars.schoolName);
}

function computeOutstanding(tenantId, studentId, termId) {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) AS expected,
      COALESCE((SELECT SUM(p.amount) FROM payments p
                WHERE p.student_id = sfa.student_id AND p.term_id = sfa.term_id AND p.reversed = 0), 0) AS paid
    FROM student_fee_assignments sfa
    WHERE sfa.tenant_id = ? AND sfa.student_id = ? AND sfa.term_id = ?
  `).get(tenantId, studentId, termId);
  return Math.max((Number(row.expected) || 0) - (Number(row.paid) || 0), 0);
}

async function sendReminder(req, res) {
  const { tenantId, id: userId } = req.user;
  const { id: studentId } = req.params;
  const { channel } = req.body;

  const settings = getSettingsRow(tenantId);
  if (!settings.reminders_enabled) {
    return res.status(403).json({ error: 'Reminders are disabled. Enable them in Messaging Settings first.' });
  }

  const student = db.prepare(`SELECT * FROM students WHERE id = ? AND tenant_id = ? AND status = 'active'`).get(studentId, tenantId);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const term = db.prepare(`SELECT * FROM terms WHERE tenant_id = ? AND is_current = 1`).get(tenantId);
  if (!term) return res.status(400).json({ error: 'No current term set' });

  const outstanding = computeOutstanding(tenantId, studentId, term.id);
  if (outstanding <= 0) {
    return res.status(400).json({ error: 'This student has no outstanding balance for the current term' });
  }

  const tenant = db.prepare(`SELECT name FROM tenants WHERE id = ?`).get(tenantId);
  const message = renderTemplate(settings.message_template, {
    studentName: student.name,
    outstanding: outstanding.toLocaleString('en-NG'),
    termName: term.name,
    schoolName: tenant.name,
  });

  const useChannel = channel || settings.default_channel;
  const reminderId = randomUUID();

  let result;
  try {
    result = await sendMessage({ to: student.guardian_contact || '', channel: useChannel, message });
  } catch (err) {
    result = { success: false, error: err.message };
  }

  db.prepare(`
    INSERT INTO reminders (id, tenant_id, student_id, channel, message, status, provider_message_id, sent_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(reminderId, tenantId, studentId, useChannel, message, result.success ? 'sent' : 'failed', result.providerMessageId || null, userId);

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'reminder', entityId: reminderId, ipAddress: req.ip, metadata: { studentId, channel: useChannel, status: result.success ? 'sent' : 'failed' } });

  if (!result.success) {
    return res.status(200).json({ ok: false, status: 'failed', error: result.error });
  }
  res.json({ ok: true, status: 'sent' });
}

async function bulkSendReminders(req, res) {
  const { tenantId, id: userId } = req.user;
  const { termId, minOutstanding } = req.body;
  const threshold = typeof minOutstanding === 'number' ? minOutstanding : 0;

  const settings = getSettingsRow(tenantId);
  if (!settings.reminders_enabled) {
    return res.status(403).json({ error: 'Reminders are disabled. Enable them in Messaging Settings first.' });
  }

  const term = termId
    ? db.prepare(`SELECT * FROM terms WHERE id = ? AND tenant_id = ?`).get(termId, tenantId)
    : db.prepare(`SELECT * FROM terms WHERE tenant_id = ? AND is_current = 1`).get(tenantId);
  if (!term) return res.status(400).json({ error: 'No current term set' });

  // Students with outstanding > threshold in this term.
  const students = db.prepare(`
    SELECT s.id, s.name, s.guardian_contact,
      COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) AS expected,
      COALESCE((SELECT SUM(p.amount) FROM payments p
                WHERE p.student_id = s.id AND p.term_id = ? AND p.reversed = 0), 0) AS paid
    FROM students s
    JOIN student_fee_assignments sfa ON sfa.student_id = s.id AND sfa.term_id = ?
    WHERE s.tenant_id = ? AND s.status = 'active'
    GROUP BY s.id
  `).all(term.id, term.id, tenantId);

  const tenant = db.prepare(`SELECT name FROM tenants WHERE id = ?`).get(tenantId);
  let sent = 0;
  let failed = 0;

  for (const s of students) {
    const outstanding = Math.max((Number(s.expected) || 0) - (Number(s.paid) || 0), 0);
    if (outstanding <= threshold) continue;

    const message = renderTemplate(settings.message_template, {
      studentName: s.name,
      outstanding: outstanding.toLocaleString('en-NG'),
      termName: term.name,
      schoolName: tenant.name,
    });

    let result;
    try {
      result = await sendMessage({ to: s.guardian_contact || '', channel: settings.default_channel, message });
    } catch (err) {
      result = { success: false, error: err.message };
    }

    db.prepare(`
      INSERT INTO reminders (id, tenant_id, student_id, channel, message, status, provider_message_id, sent_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), tenantId, s.id, settings.default_channel, message, result.success ? 'sent' : 'failed', result.providerMessageId || null, userId);

    if (result.success) sent++;
    else failed++;
  }

  recordAudit({ tenantId, actorUserId: userId, action: 'create', entityType: 'bulk_reminder', entityId: term.id, ipAddress: req.ip, metadata: { sent, failed, termId: term.id } });
  res.json({ sent, failed });
}

function listReminders(req, res) {
  const { tenantId } = req.user;
  const { studentId } = req.query;

  const rows = studentId
    ? db.prepare(`
        SELECT r.*, s.name AS student_name FROM reminders r
        JOIN students s ON s.id = r.student_id
        WHERE r.tenant_id = ? AND r.student_id = ?
        ORDER BY r.created_at DESC
      `).all(tenantId, studentId)
    : db.prepare(`
        SELECT r.*, s.name AS student_name FROM reminders r
        JOIN students s ON s.id = r.student_id
        WHERE r.tenant_id = ?
        ORDER BY r.created_at DESC
      `).all(tenantId);

  res.json({ reminders: rows });
}

module.exports = { getSettings, updateSettings, sendReminder, bulkSendReminders, listReminders };
