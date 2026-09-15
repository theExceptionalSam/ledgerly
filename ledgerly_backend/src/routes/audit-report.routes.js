const { Router } = require('express');
const { query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/audit-report.controller');

// Bundled audit-report PDF — financial-control artifact. Owner and accountant
// only (mirrors the aged-debtors role gate; bursars / assistants don't get to
// pull the full audit picture).
const router = Router();
router.use(requireAuth, requireRole('owner', 'accountant'));

// GET /api/v1/audit-report?termId=<uuid>
// Returns a PDF download bundling: EOD reconciliation, aged-debtors summary,
// receipt-sequence check, voided receipts, reversal requests, and the audit
// log summary (last 50 entries).
router.get('/', [
  query('termId').optional().isUUID(),
], validate, asyncHandler(ctrl.generateAuditReport));

module.exports = router;
