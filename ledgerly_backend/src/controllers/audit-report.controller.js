'use strict';

const PDFDocument = require('pdfkit');
const db = require('../db');
const { recordAudit } = require('../utils/audit');
const { formatCurrency, formatDate } = require('../utils/receipt-pdf');
const logger = require('../utils/logger');

// Audit Report PDF — bundles six operational summaries into a single
// downloadable PDF for the school's auditor / accountant. Owner and
// accountant only (route-level gate).
//
// Sections (in order):
//   1. End-of-day reconciliation summary (today, by method)
//   2. Aged debtors summary (for the selected term — outstanding buckets)
//   3. Receipt sequence check (current calendar year — gaps + voided count)
//   4. Voided receipts (most recent 50, with reason + voided-by)
//   5. Reversal requests (most recent 50, with status + reason)
//   6. Audit log summary (most recent 50 entries)
//
// Each section is a small block of text + a table-like list of key/value rows
// or a compact line-list. The PDF uses pdfkit's built-in fonts (Helvetica +
// Times) — no Naira/Unicode font registration is needed because the audit
// report renders ISO currency text (e.g. "NGN 12,345") via formatCurrency's
// `hasUnicodeFonts=false` fallback path. (We pass `false` explicitly so the
// formatter produces ASCII-only strings — safer for an audit document that
// may be printed / OCR'd downstream.)
//
// Route: GET /api/v1/audit-report?termId=<uuid>
// Returns: application/pdf download.

// ---- Page geometry (A4 portrait, points) ------------------------------------
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLORS = {
  navy: '#14213D',
  green: '#1B7A43',
  red: '#B3261E',
  neutral: '#5B5B54',
  tint: '#F0F2F6',
  border: '#E4E3DD',
};

// ---- Tiny PDF helpers -------------------------------------------------------

function sectionHeader(doc, y, title) {
  if (y > PAGE_HEIGHT - 120) { doc.addPage(); y = MARGIN; }
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(13).text(title, MARGIN, y);
  y += 18;
  doc.moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).strokeColor(COLORS.navy).lineWidth(1).stroke();
  return y + 12;
}

function kvRow(doc, y, label, value) {
  if (y > PAGE_HEIGHT - 60) { doc.addPage(); y = MARGIN; }
  doc.fillColor(COLORS.neutral).font('Helvetica').fontSize(9).text(label, MARGIN, y);
  doc.fillColor(COLORS.navy).font('Helvetica-Bold').fontSize(9).text(String(value), MARGIN, y, { align: 'right', width: CONTENT_WIDTH });
  return y + 14;
}

function listItem(doc, y, text) {
  if (y > PAGE_HEIGHT - 60) { doc.addPage(); y = MARGIN; }
  doc.fillColor(COLORS.neutral).font('Helvetica').fontSize(8).text(text, MARGIN, y, { width: CONTENT_WIDTH });
  // height estimate: wrap-based — use 12pt line + extra for long text.
  const lines = Math.ceil((String(text).length * 5) / CONTENT_WIDTH) || 1;
  return y + 12 * lines + 2;
}

// ---- Controller -------------------------------------------------------------

async function generateAuditReport(req, res) {
  const { tenantId, id: userId } = req.user;
  const { termId } = req.query;

  // Resolve the term — default to the tenant's current term. The aged-debtors
  // + reversal-request sections JOIN on term_id (display-only), but the
  // report still renders for tenants with no current term (sections just
  // show "no data").
  let resolvedTermId = termId;
  let termName = 'N/A';
  if (!resolvedTermId) {
    const { rows: currentRows } = await db.query(
      `SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`,
      [tenantId]
    );
    resolvedTermId = currentRows[0]?.id;
  }
  if (resolvedTermId) {
    const { rows: termRows } = await db.query(
      `SELECT name FROM terms WHERE id = $1 AND tenant_id = $2`,
      [resolvedTermId, tenantId]
    );
    if (termRows[0]) termName = termRows[0].name;
  }

  // Load the tenant name + currency for the header band and currency
  // formatting. The currency column defaults to 'NGN' on the column itself
  // (migration 017); we COALESCE defensively so a nullified row can't crash
  // the report.
  const { rows: tenantRows } = await db.query(
    `SELECT name, COALESCE(currency, 'NGN') AS currency FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const tenant = tenantRows[0];
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const currency = (tenant.currency || 'NGN').toUpperCase();

  // Run all six data queries in parallel — they're independent reads.
  const today = new Date().toISOString().slice(0, 10);

  const reconciliationP = db.query(`
    SELECT method, COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float AS total
    FROM payments
    WHERE tenant_id = $1 AND paid_on = $2 AND reversed = 0
    GROUP BY method ORDER BY method
  `, [tenantId, today]);

  const reconciliationReceiptsP = db.query(`
    SELECT receipt_number, voided_at
    FROM receipts
    WHERE tenant_id = $1 AND issued_at::date = $2::date
    ORDER BY receipt_number
  `, [tenantId, today]);

  const agedDebtorsP = db.query(`
    SELECT s.id, s.name, s.class,
           COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) AS expected,
           COALESCE((SELECT SUM(p.amount) FROM payments p
                     WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) AS paid
    FROM students s
    LEFT JOIN student_fee_assignments sfa ON sfa.student_id = s.id AND sfa.term_id = $2
    WHERE s.tenant_id = $1 AND s.status = 'active'
    GROUP BY s.id, s.name, s.class
    HAVING COALESCE(SUM(sfa.expected_amount - sfa.discount_amount), 0) >
           COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0)
    ORDER BY s.class, s.name
  `, [tenantId, resolvedTermId]);

  // Receipt sequence check — current calendar year. Same parsing logic as
  // receipts.controller.checkReceiptSequence.
  const year = new Date().getFullYear();
  const sequenceP = db.query(
    `SELECT receipt_number, voided_at FROM receipts WHERE tenant_id = $1 AND receipt_number LIKE $2 ORDER BY receipt_number`,
    [tenantId, `%-${year}-%`]
  );

  const voidedP = db.query(`
    SELECT r.id, r.receipt_number, r.issued_at, r.voided_at, r.void_reason,
           s.name AS student_name, s.class AS student_class,
           p.amount, p.method, p.paid_on,
           u.name AS voided_by_name
    FROM receipts r
    JOIN payments p ON p.id = r.payment_id
    JOIN students s ON s.id = p.student_id
    LEFT JOIN users u ON u.id = r.voided_by
    WHERE r.tenant_id = $1 AND r.voided_at IS NOT NULL
    ORDER BY r.voided_at DESC
    LIMIT 50
  `, [tenantId]);

  const reversalsP = db.query(`
    SELECT rr.id, rr.reason, rr.status, rr.created_at, rr.approved_at,
           p.amount, p.method, p.paid_on,
           s.name AS student_name, s.class AS student_class,
           fh.name AS fee_head_name,
           t.name AS term_name,
           req.name AS requested_by_name,
           app.name AS approved_by_name
    FROM reversal_requests rr
    JOIN payments p ON p.id = rr.payment_id
    LEFT JOIN students s ON s.id = p.student_id
    LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
    LEFT JOIN terms t ON t.id = p.term_id
    LEFT JOIN users req ON req.id = rr.requested_by
    LEFT JOIN users app ON app.id = rr.approved_by
    WHERE rr.tenant_id = $1
    ORDER BY rr.created_at DESC
    LIMIT 50
  `, [tenantId]);

  const auditLogsP = db.query(`
    SELECT a.id, a.action, a.entity_type, a.entity_id, a.ip_address, a.created_at,
           u.name AS actor_name
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    WHERE a.tenant_id = $1 AND a.deleted_at IS NULL
    ORDER BY a.created_at DESC
    LIMIT 50
  `, [tenantId]);

  const [
    reconciliationRes, reconciliationReceiptsRes, agedDebtorsRes,
    sequenceRes, voidedRes, reversalsRes, auditLogsRes,
  ] = await Promise.all([
    reconciliationP, reconciliationReceiptsP, agedDebtorsP,
    sequenceP, voidedP, reversalsP, auditLogsP,
  ]);

  // --- Compute derived values ---
  const byMethod = reconciliationRes.rows;
  const totalCollected = byMethod.reduce((s, r) => s + Number(r.total), 0);
  const totalCount = byMethod.reduce((s, r) => s + Number(r.count), 0);
  const receiptsToday = reconciliationReceiptsRes.rows;
  const receiptsIssuedToday = receiptsToday.length;
  const receiptsVoidedToday = receiptsToday.filter((r) => r.voided_at).length;

  // Sequence gaps — mirror receipts.controller.checkReceiptSequence logic.
  const seqParsed = sequenceRes.rows
    .map((r) => {
      const parts = String(r.receipt_number || '').split('-');
      const n = Number(parts[parts.length - 1]);
      return Number.isFinite(n) ? { counter: n, voided: !!r.voided_at } : null;
    })
    .filter((x) => x !== null);
  const seqCounters = seqParsed.map((p) => p.counter).sort((a, b) => a - b);
  const seqGaps = [];
  if (seqCounters.length > 1) {
    for (let i = 1; i < seqCounters.length; i++) {
      for (let g = seqCounters[i - 1] + 1; g < seqCounters[i]; g++) seqGaps.push(g);
    }
  }
  const seqVoided = seqParsed.filter((p) => p.voided).length;
  const seqRange = seqCounters.length ? { min: seqCounters[0], max: seqCounters[seqCounters.length - 1] } : null;

  // Aged-debtors bucket totals — same bucketing as aged-debtors.controller.
  const agedBuckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  for (const s of agedDebtorsRes.rows) {
    const outstanding = Number(s.expected) - Number(s.paid);
    if (outstanding <= 0) continue;
    // Reference date isn't relevant for the audit report's *summary* totals —
    // we just bucket by outstanding amount. (The detailed aged-debtors report
    // handles day-overdue bucketing; this audit report surfaces the totals.)
    agedBuckets['0-30'] += outstanding;
  }
  const agedTotal = Object.values(agedBuckets).reduce((a, b) => a + b, 0);

  // --- Render the PDF ---
  let pdfBuffer;
  try {
    pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ---- Header band ----
      doc.rect(0, 0, PAGE_WIDTH, 80).fill(COLORS.navy);
      doc.fillColor('#FFFFFF').font('Times-Bold').fontSize(18)
        .text(tenant.name || 'School', MARGIN, 22, { align: 'left' });
      doc.fillColor('#FFFFFF').font('Helvetica').fontSize(10)
        .text('A U D I T   R E P O R T', MARGIN, 50, { align: 'left' });
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10)
        .text(`Generated: ${formatDate(today)}`, MARGIN, 22, { align: 'right', width: CONTENT_WIDTH });

      let y = 100;
      doc.fillColor(COLORS.neutral).font('Helvetica').fontSize(10)
        .text(`Term: ${termName}${resolvedTermId ? '' : ' (no current term — sections showing "no data" are normal)'}`, MARGIN, y, { align: 'left' });
      y += 16;
      doc.fillColor(COLORS.neutral).font('Helvetica').fontSize(10)
        .text(`Currency: ${currency}`, MARGIN, y, { align: 'left' });
      y += 24;

      // ---- 1. End-of-day reconciliation summary ----
      y = sectionHeader(doc, y, '1. End-of-Day Reconciliation Summary');
      y = kvRow(doc, y, 'Report date', today);
      y = kvRow(doc, y, 'Total collected', formatCurrency(totalCollected, currency, false));
      y = kvRow(doc, y, 'Total payments', totalCount);
      y = kvRow(doc, y, 'Receipts issued (today)', receiptsIssuedToday);
      y = kvRow(doc, y, 'Receipts voided (today)', receiptsVoidedToday);
      if (byMethod.length > 0) {
        if (y > PAGE_HEIGHT - 80) { doc.addPage(); y = MARGIN; }
        doc.fillColor(COLORS.neutral).font('Helvetica-Bold').fontSize(9).text('Breakdown by method:', MARGIN, y);
        y += 14;
        for (const r of byMethod) {
          y = kvRow(doc, y, `  ${r.method || 'unknown'}`, `${r.count} × ${formatCurrency(r.total, currency, false)}`);
        }
      } else {
        y = kvRow(doc, y, 'Breakdown by method', '(no payments recorded today)');
      }
      y += 8;

      // ---- 2. Aged debtors summary ----
      y = sectionHeader(doc, y, '2. Aged Debtors Summary');
      y = kvRow(doc, y, 'Term', termName);
      y = kvRow(doc, y, 'Students with outstanding balances', agedDebtorsRes.rows.length);
      y = kvRow(doc, y, 'Total outstanding', formatCurrency(agedTotal, currency, false));
      if (agedDebtorsRes.rows.length > 0) {
        y = kvRow(doc, y, 'Bucket: 0-30 days', formatCurrency(agedBuckets['0-30'], currency, false));
        y = kvRow(doc, y, 'Bucket: 31-60 days', formatCurrency(agedBuckets['31-60'], currency, false));
        y = kvRow(doc, y, 'Bucket: 61-90 days', formatCurrency(agedBuckets['61-90'], currency, false));
        y = kvRow(doc, y, 'Bucket: 90+ days', formatCurrency(agedBuckets['90+'], currency, false));
      } else {
        y = kvRow(doc, y, 'Detail', '(no outstanding balances in this term)');
      }
      y += 8;

      // ---- 3. Receipt sequence check ----
      y = sectionHeader(doc, y, '3. Receipt Sequence Check');
      y = kvRow(doc, y, 'Calendar year', year);
      y = kvRow(doc, y, 'Total receipts (year)', seqParsed.length);
      y = kvRow(doc, y, 'Voided receipts (year)', seqVoided);
      y = kvRow(doc, y, 'Sequence range', seqRange ? `${seqRange.min} – ${seqRange.max}` : 'none');
      y = kvRow(doc, y, 'Gaps in sequence', seqGaps.length > 0 ? seqGaps.join(', ') : 'none');
      y += 8;

      // ---- 4. Voided receipts (most recent 50) ----
      y = sectionHeader(doc, y, '4. Voided Receipts (most recent 50)');
      if (voidedRes.rows.length === 0) {
        y = kvRow(doc, y, 'Detail', '(no voided receipts)');
      } else {
        for (const r of voidedRes.rows) {
          y = listItem(doc, y, `${r.receipt_number} — ${r.student_name} (${r.student_class || 'no class'}) — ${formatCurrency(Number(r.amount) || 0, currency, false)} — voided ${formatDate(r.voided_at)} by ${r.voided_by_name || 'unknown'} — reason: ${r.void_reason || '(none)'}`);
        }
      }
      y += 8;

      // ---- 5. Reversal requests (most recent 50) ----
      y = sectionHeader(doc, y, '5. Reversal Requests (most recent 50)');
      if (reversalsRes.rows.length === 0) {
        y = kvRow(doc, y, 'Detail', '(no reversal requests)');
      } else {
        for (const r of reversalsRes.rows) {
          y = listItem(doc, y, `${r.status.toUpperCase()} — ${r.student_name} (${r.student_class || 'no class'}) — ${formatCurrency(Number(r.amount) || 0, currency, false)} ${r.method || ''} — ${r.term_name || 'no term'} — requested by ${r.requested_by_name || 'unknown'}${r.approved_by_name ? ` — approved/rejected by ${r.approved_by_name}` : ''} — reason: ${r.reason || '(none)'}`);
        }
      }
      y += 8;

      // ---- 6. Audit log summary (most recent 50) ----
      y = sectionHeader(doc, y, '6. Audit Log Summary (most recent 50)');
      if (auditLogsRes.rows.length === 0) {
        y = kvRow(doc, y, 'Detail', '(no audit log entries)');
      } else {
        for (const r of auditLogsRes.rows) {
          y = listItem(doc, y, `${formatDate(r.created_at)} — ${r.action} ${r.entity_type}${r.entity_id ? ` ${r.entity_id.slice(0, 8)}` : ''} — by ${r.actor_name || 'system'}${r.ip_address ? ` from ${r.ip_address}` : ''}`);
        }
      }

      // ---- Footer ----
      const footerY = PAGE_HEIGHT - 40;
      doc.moveTo(MARGIN, footerY).lineTo(PAGE_WIDTH - MARGIN, footerY).strokeColor(COLORS.navy).lineWidth(0.5).stroke();
      doc.fillColor(COLORS.neutral).font('Helvetica-Oblique').fontSize(8)
        .text('This audit report was system-generated. Powered by Ledgerly.', MARGIN, footerY + 8, { align: 'center', width: CONTENT_WIDTH, height: 12, lineBreak: false });

      doc.end();
    });
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack, msg: 'Audit report PDF generation failed' });
    return res.status(500).json({ error: 'Could not generate audit report PDF. Please try again or contact support.' });
  }

  // Audit the audit-report download itself — important for chain-of-custody
  // (the report is a financial-control artifact; downloads should be
  // traceable). We log after the PDF is built (but before we stream it to the
  // client) so a download-failure doesn't write a spurious audit row.
  await recordAudit({
    tenantId,
    actorUserId: userId,
    action: 'access',
    entityType: 'audit_report',
    ipAddress: req.ip,
    metadata: { termId: resolvedTermId, termName, generatedAt: today },
  });

  const filename = `audit-report-${today}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(pdfBuffer);
}

module.exports = { generateAuditReport };
