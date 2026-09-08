const db = require('../db');
const { recordAudit } = require('../utils/audit');

// Full data export — returns ALL tenant data as a JSON download.
//
// This is the "data portability" endpoint. A school that wants to leave
// Ledgerly can call this once and get a single JSON document containing every
// row they own, with relationships preserved (foreign keys are kept as the raw
// UUIDs so the importing system can reconstruct the graph). It's also useful
// for offline backups and for handing to an auditor.
//
// Owner-only (see data-export.routes.js) — the full export includes every
// user, student, payment, receipt, and audit-log row for the tenant, so it's
// the most sensitive read endpoint in the system.
//
// Schema notes (deviations from the original spec, all verified against
// migrations 001-022 + schema.sql):
//   - tenants has NO `email` column (data_protection_contact is the closest
//     analogue). We export the white-label columns too so the importing
//     system can reproduce the school's branding.
//   - There is no `sessions` table — the academic-session table is named
//     `academic_sessions` and carries id/name/is_current/created_at (no
//     start/end dates; those live on `terms`).
//   - There is no `settings` table — tenant-level settings are columns on the
//     tenants row (already exported above). The separate settings table is
//     `tenant_messaging_settings` (SMS/WhatsApp config) — we export that.
//   - receipts.voided_by is included alongside voided_at/void_reason because
//     it's audit-relevant (who voided a receipt matters as much as when/why).
//   - webhook_endpoints.secret is intentionally NOT exported (it's a signing
//     secret, not portable data). The same applies to users.password_hash,
//   - users.twofa_secret, refresh_tokens.token_hash, api_keys.key_hash,
//     verification_codes.code_hash — none of those columns are selected.
async function exportAllData(req, res) {
  const { tenantId, id: userId } = req.user;

  // Export all tenant-owned tables in parallel. Each query is tenant-scoped
  // (WHERE tenant_id = $1) so a bug in any single query can't leak another
  // tenant's data. The audit_logs query is capped at 10000 rows (newest first)
  // to keep the export size bounded for very active tenants — the bursar can
  // pull older audit history from the audit-logs endpoint if needed.
  const [
    tenants, users, students, feeHeads, terms, academicSessions,
    payments, receipts, transactions, studentFeeAssignments, auditLogs,
    paymentPlans, feeTemplates, webhooks, dataRequests, messagingSettings,
    budgets, reversalRequests,
  ] = await Promise.all([
    db.query(`SELECT id, name, phone, data_protection_contact, currency, language, custom_domain, primary_color, parent_company, created_at FROM tenants WHERE id = $1`, [tenantId]),
    db.query(`SELECT id, name, email, role, status, created_at FROM users WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, name, class, admission_no, guardian_contact, status, created_at FROM students WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, name, is_active, created_at FROM fee_heads WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, name, start_date, end_date, is_current, closed_at, session_id, created_at FROM terms WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, name, is_current, created_at FROM academic_sessions WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, student_id, fee_head_id, term_id, amount, method, note, paid_on, reversed, recorded_by, created_at FROM payments WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, payment_id, receipt_number, issued_by, issued_at, voided_at, voided_by, void_reason FROM receipts WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, type, category, amount, description, occurred_on, reversed, recorded_by, created_at FROM transactions WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, student_id, fee_head_id, term_id, expected_amount, discount_amount, discount_reason, created_at FROM student_fee_assignments WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, action, entity_type, entity_id, actor_user_id, ip_address, metadata, created_at FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10000`, [tenantId]),
    db.query(`SELECT id, student_id, fee_head_id, term_id, total_amount, installments, paid_installments, late_fee, status, created_at FROM payment_plans WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, name, class_name, items, created_at FROM fee_templates WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, url, events, active, created_at FROM webhook_endpoints WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, type, status, requested_by, processed_at, created_at FROM data_requests WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT tenant_id, reminders_enabled, default_channel, message_template FROM tenant_messaging_settings WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, term_id, class_name, expected_amount, created_by, created_at FROM budgets WHERE tenant_id = $1`, [tenantId]),
    db.query(`SELECT id, payment_id, requested_by, reason, status, approved_by, approved_at, created_at FROM reversal_requests WHERE tenant_id = $1`, [tenantId]),
  ]);

  const exportData = {
    exportDate: new Date().toISOString(),
    schemaVersion: 'v2',
    tenantId,
    tenant: tenants.rows[0] || null,
    users: users.rows,
    students: students.rows,
    feeHeads: feeHeads.rows,
    terms: terms.rows,
    academicSessions: academicSessions.rows,
    payments: payments.rows,
    receipts: receipts.rows,
    transactions: transactions.rows,
    studentFeeAssignments: studentFeeAssignments.rows,
    auditLogs: auditLogs.rows,
    paymentPlans: paymentPlans.rows,
    feeTemplates: feeTemplates.rows,
    webhooks: webhooks.rows,
    dataRequests: dataRequests.rows,
    messagingSettings: messagingSettings.rows[0] || null,
    budgets: budgets.rows,
    reversalRequests: reversalRequests.rows,
  };

  // Record the export in the audit trail. Await so the audit row is durable
  // before the response is sent — if a school exports, we want a record of it.
  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'export',
    entityType: 'tenant',
    entityId: tenantId,
    ipAddress: req.ip,
    metadata: { fullExport: true, tableCount: 18 },
  });

  // Send as an attachment so browsers prompt "Save As" rather than rendering
  // a multi-MB JSON blob inline. The filename includes the tenant id + epoch
  // so repeated exports don't clobber each other on disk.
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="ledgerly-export-${tenantId}-${Date.now()}.json"`);
  res.json(exportData);
}

module.exports = { exportAllData };
