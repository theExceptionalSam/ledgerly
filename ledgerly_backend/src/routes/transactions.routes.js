const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/transactions.controller');

const router = Router();
router.use(requireAuth);

router.get('/', [
  query('type').optional().isIn(['income', 'expense']),
  query('termId').optional().isUUID(),
], validate, ctrl.listTransactions);

router.post('/', requireRole('owner', 'accountant', 'bursar'), [
  body('type').isIn(['income', 'expense']),
  body('category').trim().isLength({ min: 1, max: 80 }).escape(),
  body('amount').isFloat({ gt: 0 }),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 300 }).escape(),
  body('occurredOn').isISO8601(),
  body('termId').optional().isUUID(),
], validate, ctrl.createTransaction);

router.delete('/:id', requireRole('owner', 'accountant'), [param('id').isUUID()], validate, ctrl.reverseTransaction);

module.exports = router;
