const { Router } = require('express');
const { body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/subscriptions.controller');

const router = Router();
router.use(requireAuth);

router.get('/current', asyncHandler(ctrl.getCurrent));
router.get('/plans', asyncHandler(ctrl.listPlans));
router.post('/subscribe', [
  body('plan').isIn(['free', 'starter', 'standard', 'premium', 'enterprise']),
  body('billingCycle').isIn(['monthly', 'yearly']),
], validate, asyncHandler(ctrl.subscribe));

module.exports = router;
