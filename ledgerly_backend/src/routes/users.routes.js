const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/users.controller');

const router = Router();
router.use(requireAuth);

const strongPassword = body('newPassword')
  .isLength({ min: 10 }).withMessage('Password must be at least 10 characters')
  .matches(/[A-Z]/).withMessage('Password must include an uppercase letter')
  .matches(/[0-9]/).withMessage('Password must include a number');

// Change own password — any authenticated user
router.post('/change-password', [
  body('currentPassword').notEmpty(),
  strongPassword,
], validate, asyncHandler(ctrl.changePassword));

// User management — owner only
router.use(requireRole('owner'));

router.get('/', asyncHandler(ctrl.listUsers));

router.post('/', [
  body('name').trim().isLength({ min: 2, max: 120 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 10 }).withMessage('Password must be at least 10 characters').matches(/[A-Z]/).withMessage('Password must include an uppercase letter').matches(/[0-9]/).withMessage('Password must include a number'),
  body('role').isIn(['bursar', 'accountant', 'assistant']),
], validate, asyncHandler(ctrl.createUser));

router.put('/:id', [
  param('id').isUUID(),
  body('name').optional().trim().isLength({ min: 2, max: 120 }),
  body('role').optional().isIn(['bursar', 'accountant', 'assistant']),
  body('status').optional().isIn(['active', 'disabled']),
], validate, asyncHandler(ctrl.updateUser));

router.delete('/:id', [
  param('id').isUUID(),
], validate, asyncHandler(ctrl.deleteUser));

module.exports = router;
