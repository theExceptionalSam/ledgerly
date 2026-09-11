const { Router } = require('express');
const { query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/aged-debtors.controller');

const router = Router();

// Aged debtors is a financial/audit report — owner and accountant only.
// Bursars and assistants don't get to see the school's outstanding-debt picture.
router.use(requireAuth, requireRole('owner', 'accountant'));

// GET /api/v1/aged-debtors?termId=<uuid>
// Returns the aged-debtors report for the given term (or the current term if
// termId is omitted). See the controller for the bucketing logic.
router.get('/', [
  query('termId').optional().isUUID(),
], validate, asyncHandler(ctrl.getAgedDebtors));

// GET /api/v1/aged-debtors/boarding?termId=<uuid>
// Boarding-specific aged-debtors report — same shape as `/` but filtered to
// students with student_type = 'boarding'. Used to surface boarding students
// who haven't paid their boarding-related fees.
router.get('/boarding', [
  query('termId').optional().isUUID(),
], validate, asyncHandler(ctrl.getBoardingReport));

module.exports = router;
