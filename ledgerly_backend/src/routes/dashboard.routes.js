const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { getDashboard } = require('../controllers/dashboard.controller');

const router = Router();
router.use(requireAuth);
router.get('/', getDashboard);

module.exports = router;
