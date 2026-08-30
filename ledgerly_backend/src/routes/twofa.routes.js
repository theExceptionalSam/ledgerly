const { Router } = require('express');
const { body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/twofa.controller');

const router = Router();
router.use(requireAuth);

router.post('/2fa/setup', asyncHandler(ctrl.setup));
router.post('/2fa/verify', [
  body('token').trim().isLength({ min: 6, max: 6 }).isNumeric(),
], validate, asyncHandler(ctrl.verify));
router.post('/2fa/disable', [
  body('token').trim().isLength({ min: 6, max: 6 }).isNumeric(),
], validate, asyncHandler(ctrl.disable));

module.exports = router;
