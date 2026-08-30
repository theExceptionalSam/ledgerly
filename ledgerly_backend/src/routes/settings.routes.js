const { Router } = require('express');
const { body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/settings.controller');

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.getSettings));

router.put('/', [
  body('currency').optional().isLength({ min: 3, max: 3 }).isAlpha(),
  body('language').optional().isIn(['en', 'fr', 'ha', 'yo', 'ig']),
  body('primary_color').optional().matches(/^#[0-9A-Fa-f]{6}$/).withMessage('Must be a #RRGGBB hex color'),
  body('parent_company').optional().trim().isLength({ max: 200 }),
], validate, asyncHandler(ctrl.updateSettings));

module.exports = router;
