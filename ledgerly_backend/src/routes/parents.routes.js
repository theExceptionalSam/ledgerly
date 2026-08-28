const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireParent } = require('../middleware/auth');
const ctrl = require('../controllers/parents.controller');

const router = Router();

// Public — register + login. Must be mounted before requirePasswordNotForced.
router.post('/register', [
  body('phone').trim().matches(/^[+0-9][0-9\s-]{6,19}$/).withMessage('Enter a valid phone number'),
  body('name').trim().isLength({ min: 2, max: 120 }),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('studentId').isUUID(),
], validate, asyncHandler(ctrl.register));

router.post('/login', [
  body('phone').trim().notEmpty(),
  body('password').notEmpty(),
], validate, asyncHandler(ctrl.login));

// Parent-authenticated — uses requireParent (separate token type from staff auth).
router.use(requireParent);

router.get('/me', asyncHandler(ctrl.me));
router.get('/students/:id/fees', [param('id').isUUID()], validate, asyncHandler(ctrl.studentFees));
router.get('/students/:id/payments', [param('id').isUUID()], validate, asyncHandler(ctrl.studentPayments));

module.exports = router;
