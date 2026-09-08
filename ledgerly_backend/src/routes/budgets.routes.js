const { Router } = require('express');
const { query, body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/budgets.controller');

const router = Router();
router.use(requireAuth);

// All authenticated staff can read budgets and the summary — they're
// informational and already gated by requireAuth (which rejects parent tokens).
// Only the owner can set or delete a budget (it's a financial target).

// GET /api/v1/budgets?termId=<uuid>  — list budgets (optionally filtered by term)
router.get('/', [
  query('termId').optional().isUUID(),
], validate, asyncHandler(ctrl.listBudgets));

// GET /api/v1/budgets/summary?termId=<uuid>  — term rollup for the dashboard.
// Registered BEFORE POST / and DELETE /:id so the literal /summary path isn't
// shadowed by a future /:id GET (defensive ordering, matches the receipts router).
router.get('/summary', [
  query('termId').isUUID(),
], validate, asyncHandler(ctrl.getBudgetSummary));

// POST /api/v1/budgets  — create or update a budget (owner only)
router.post('/', requireRole('owner'), [
  body('termId').isUUID(),
  body('className').trim().notEmpty(),
  body('expectedAmount').isFloat({ gt: 0 }),
], validate, asyncHandler(ctrl.upsertBudget));

// DELETE /api/v1/budgets/:id  — delete a budget (owner only)
router.delete('/:id', requireRole('owner'), [
  param('id').isUUID(),
], validate, asyncHandler(ctrl.deleteBudget));

module.exports = router;
