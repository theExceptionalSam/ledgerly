const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { bulkReminderLimiter } = require('../middleware/security');
const ctrl = require('../controllers/reminders.controller');

const router = Router();
router.use(requireAuth);

// This router is mounted at both /api/v1/reminders and /api/v1/messaging-settings.
// GET / is ambiguous between the two mounts, so we dispatch on baseUrl.
router.get('/', (req, res, next) => {
  if (req.baseUrl === '/api/v1/messaging-settings') return ctrl.getSettings(req, res);
  return ctrl.listReminders(req, res);
});

// PUT / only makes sense at /messaging-settings (updateSettings).
router.put('/', requireRole('owner'), [
  body('remindersEnabled').optional().isBoolean(),
  body('defaultChannel').optional().isIn(['sms', 'whatsapp']),
  body('messageTemplate').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
], validate, ctrl.updateSettings);

// Bulk send — rate-limited to 3 per hour per tenant.
router.post('/bulk', requireRole('owner'), bulkReminderLimiter, [
  body('termId').optional().isUUID(),
  body('minOutstanding').optional().isFloat({ min: 0 }),
], validate, ctrl.bulkSendReminders);

module.exports = router;
