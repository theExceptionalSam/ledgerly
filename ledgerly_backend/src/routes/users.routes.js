const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/users.controller');

const router = Router();
router.use(requireAuth, requireRole('owner'));

const strongPassword = body('password')
  .isLength({ min: 10 }).withMessage('Password must be at least 10 characters')
  .matches(/[A-Z]/).withMessage('Password must include an uppercase letter')
  .matches(/[0-9]/).withMessage('Password must include a number');

router.get('/', asyncHandler(ctrl.listUsers));

router.post('/', [
  body('name').trim().isLength({ min: 2, max: 120 }),
  body('email').isEmail().normalizeEmail(),
  strongPassword,
  body('role').isIn(['bursar', 'accountant', 'assistant']),
], validate, asyncHandler(ctrl.createUser));

router.put('/:id', [
  param('id').isUUID(),
  body('name').optional().trim().isLength({ min: 2, max: 120 }),
  body('role').optional().isIn(['bursar', 'accountant', 'assistant']),
  body('status').optional().isIn(['active', 'disabled']),
], validate, asyncHandler(ctrl.updateUser));

module.exports = router;
