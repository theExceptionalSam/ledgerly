const { Router } = require('express');
const { asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/data-export.controller');

const router = Router();

// Full data export is owner-only — the response contains every user, student,
// payment, receipt, and audit-log row for the tenant, so it's the most
// sensitive read in the system. Bursars/accountants get the reconciliation
// and aged-debtors reports instead; only the owner can pull the raw dump.
router.use(requireAuth, requireRole('owner'));

// GET /api/v1/data-export/export-all
// Downloads a JSON file containing every tenant-owned row. See controller for
// the table list and the columns that are intentionally excluded (password
// hashes, signing secrets, token hashes, 2FA secrets).
router.get('/export-all', asyncHandler(ctrl.exportAllData));

module.exports = router;
