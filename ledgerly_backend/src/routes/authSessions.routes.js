const { Router } = require('express');
const { param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/authSessions.controller');

const router = Router();
router.use(requireAuth);

router.get('/sessions', asyncHandler(ctrl.listSessions));
router.delete('/sessions/:id', [param('id').isUUID()], validate, asyncHandler(ctrl.revokeSession));

module.exports = router;
