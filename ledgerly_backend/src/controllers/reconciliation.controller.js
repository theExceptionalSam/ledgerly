const db = require('../db');

// End-of-day cash reconciliation report.
//
// For a given date (default: today, in UTC), returns:
//   - Total payments recorded that day, broken down by method
//     (cash, bank_transfer, pos, cheque, online, ...) — excludes reversed
//     payments (reversed = 1) so the bursar's "cash collected" number isn't
//     inflated by payments that were later undone.
//   - Number of receipts issued that day (including voided ones — a voided
//     receipt still occupies a number in the sequence).
//   - The first and last receipt number of the day (so the bursar can verify
//     against their physical receipt book).
//   - Any gaps in the day's receipt-number sequence. Receipt numbers are
//     monotonically increasing within a calendar year per tenant, so any
//     integer in the day's [min..max] range that has no receipt row is a
//     genuinely skipped number — a potential fraud indicator (or evidence of
//     a hard-deleted receipt, which shouldn't happen in this codebase).
//   - The full list of payments recorded that day, with receipt numbers and
//     student/fee-head context, so the bursar can reconcile each entry against
//     their cash box.
//
// This lets the bursar verify three things at end of day:
//   1. The cash they collected matches what was recorded (byMethod.cash).
//   2. No receipt numbers were skipped (gapsInSequence is empty).
//   3. They can "cash up" with confidence (totalCollected reconciles to the
//      sum of physical cash + bank slips + POS merchant totals).
//
// The report works for any past date (not just today), so a bursar who missed
// a day can catch up. ?date=YYYY-MM-DD; defaults to today (UTC).
async function getDailyReconciliation(req, res) {
  const { tenantId } = req.user;
  const { date } = req.query; // YYYY-MM-DD, default today (UTC)

  // Default to today's UTC date. paid_on is stored as TEXT in YYYY-MM-DD
  // format, so a direct equality comparison works without timezone gymnastics.
  const reportDate = date || new Date().toISOString().slice(0, 10);

  // --- Total payments by method for the day ---
  // reversed = 0 excludes payments that were later undone (a reversed payment
  // is still in the table for audit, but the bursar didn't actually keep that
  // cash). The ::float cast defeats pg's string-from-numeric behaviour so the
  // JSON serializer emits numbers, not strings.
  const { rows: byMethod } = await db.query(`
    SELECT method, COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float AS total
    FROM payments
    WHERE tenant_id = $1 AND paid_on = $2 AND reversed = 0
    GROUP BY method ORDER BY method
  `, [tenantId, reportDate]);

  const totalCollected = byMethod.reduce((sum, r) => sum + Number(r.total), 0);
  const totalCount = byMethod.reduce((sum, r) => sum + Number(r.count), 0);

  // --- Receipts issued that day (including voided) ---
  // issued_at is TIMESTAMPTZ; cast both sides to ::date for a clean calendar-
  // day comparison. ORDER BY receipt_number so the min/max extraction below
  // is just rows[0] / rows[rows.length-1].
  const { rows: receipts } = await db.query(`
    SELECT receipt_number, voided_at, void_reason
    FROM receipts
    WHERE tenant_id = $1 AND issued_at::date = $2::date
    ORDER BY receipt_number
  `, [tenantId, reportDate]);

  // Check for gaps in the receipt-number sequence. The receipt number format
  // is "<prefix>-<year>-<NNNNN>" (see receipts.controller.issueReceipt), so
  // the counter is the last dash-separated segment. Receipt numbers are
  // monotonically increasing within a calendar year per tenant, which means
  // any integer in the day's [min..max] range that has no receipt row was
  // genuinely never issued — a gap. (A voided receipt is still a row in the
  // table, so it fills its slot and does NOT count as a gap.)
  const receiptNumbers = receipts.map(r => r.receipt_number).filter(Boolean);
  const gaps = [];
  if (receiptNumbers.length > 1) {
    const parsed = receiptNumbers
      .map(rn => {
        const parts = String(rn).split('-');
        return parseInt(parts[parts.length - 1], 10);
      })
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    for (let i = 1; i < parsed.length; i++) {
      if (parsed[i] !== parsed[i - 1] + 1) {
        // Gap found — every integer between parsed[i-1]+1 and parsed[i]-1 is
        // a skipped receipt number. Report each one individually so the
        // bursar can investigate.
        for (let g = parsed[i - 1] + 1; g < parsed[i]; g++) {
          gaps.push(g);
        }
      }
    }
  }

  // --- Detailed payments list for the day ---
  // Joined with students (always present — FK), fee_heads (nullable — a
  // payment could in theory have no fee head), and receipts (nullable if the
  // receipt hasn't been issued yet, though in practice every payment gets a
  // receipt in the same transaction). voided_at is surfaced so the bursar can
  // see which receipts were voided that day (the payment row is still live —
  // voiding a receipt doesn't reverse the payment).
  const { rows: payments } = await db.query(`
    SELECT p.id, p.amount, p.method, p.note, p.paid_on,
           s.name AS student_name, s.class AS student_class,
           fh.name AS fee_head_name,
           r.receipt_number, r.voided_at
    FROM payments p
    JOIN students s ON s.id = p.student_id
    LEFT JOIN fee_heads fh ON fh.id = p.fee_head_id
    LEFT JOIN receipts r ON r.payment_id = p.id
    WHERE p.tenant_id = $1 AND p.paid_on = $2 AND p.reversed = 0
    ORDER BY p.created_at
  `, [tenantId, reportDate]);

  res.json({
    date: reportDate,
    summary: {
      totalCollected,
      totalCount,
      byMethod,
      receiptsIssued: receipts.length,
      receiptsVoided: receipts.filter(r => r.voided_at).length,
      firstReceipt: receiptNumbers[0] || null,
      lastReceipt: receiptNumbers[receiptNumbers.length - 1] || null,
      gapsInSequence: gaps,
    },
    payments,
  });
}

module.exports = { getDailyReconciliation };
