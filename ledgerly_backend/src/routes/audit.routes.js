const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { listAuditLogs } = require('../controllers/audit.controller');

const router = Router();
router.use(requireAuth, requireRole('owner'));
router.get('/', listAuditLogs);

module.exports = router;
