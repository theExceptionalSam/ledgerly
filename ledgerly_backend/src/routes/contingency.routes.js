const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/contingency.controller');

const router = Router();
router.use(requireAuth, requireRole('owner', 'accountant'));

// List plans (optional ?status= filter)
router.get('/', [
  query('status').optional().isIn(['draft','prepared','monitoring','triggered','active','under_review','resolved','archived']),
], validate, asyncHandler(ctrl.listPlans));

// Dashboard summary (for the finance dashboard widget)
router.get('/summary', asyncHandler(ctrl.getDashboardSummary));

// Automated trigger check (runs on dashboard load or via cron)
router.post('/check-triggers', asyncHandler(ctrl.checkTriggers));

// Get a single plan with its event log
router.get('/:id', [param('id').isUUID()], validate, asyncHandler(ctrl.getPlan));

// Create a new plan
router.post('/', [
  body('title').trim().isLength({ min: 3, max: 200 }),
  body('risk_description').trim().isLength({ min: 10, max: 2000 }),
], validate, asyncHandler(ctrl.createPlan));

// Update plan details
router.put('/:id', [param('id').isUUID()], validate, asyncHandler(ctrl.updatePlan));

// Change plan status (activate, resolve, etc.)
router.post('/:id/status', [
  param('id').isUUID(),
  body('status').isIn(['draft','prepared','monitoring','triggered','active','under_review','resolved','archived']),
  body('note').optional().trim().isLength({ max: 500 }),
], validate, asyncHandler(ctrl.changeStatus));

module.exports = router;
