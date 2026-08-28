const { Router } = require('express');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/apikeys.controller');

const router = Router();
router.use(requireAuth, requireRole('owner'));

router.get('/', asyncHandler(ctrl.listKeys));
router.post('/', [
  body('name').trim().isLength({ min: 1, max: 120 }),
  body('permissions').optional().isIn(['read', 'read_write']),
], validate, asyncHandler(ctrl.createKey));
router.delete('/:id', [param('id').isUUID()], validate, asyncHandler(ctrl.revokeKey));

module.exports = router;
