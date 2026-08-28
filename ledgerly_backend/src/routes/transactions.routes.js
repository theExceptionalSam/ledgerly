const { Router } = require('express');
const { body, param, query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { exportLimiter } = require('../middleware/security');
const ctrl = require('../controllers/transactions.controller');

const router = Router();
router.use(requireAuth);

router.get('/', [
  query('type').optional().isIn(['income', 'expense']),
  query('termId').optional().isUUID(),
], validate, asyncHandler(ctrl.listTransactions));

router.get('/export', exportLimiter, asyncHandler(async (req, res) => {
  const db = require('../db');
  const { tenantId } = req.user;
  let termId = req.query.termId;
  if (!termId) {
    const { rows: tRows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
    termId = tRows[0]?.id;
  }
  const { rows } = await db.query(`SELECT * FROM transactions WHERE tenant_id = $1 AND reversed = 0 AND term_id = $2 ORDER BY occurred_on DESC`, [tenantId, termId]);
  const csv = ['Date,Type,Category,Amount,Description'];
  for (const t of rows) {
    csv.push([t.occurred_on, t.type, t.category, t.amount, t.description || ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send(csv.join('\n'));
}));

router.post('/', requireRole('owner', 'accountant', 'bursar'), [
  body('type').isIn(['income', 'expense']),
  body('category').trim().isLength({ min: 1, max: 80 }),
  body('amount').isFloat({ gt: 0 }),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
  body('occurredOn').isISO8601(),
  body('termId').optional().isUUID(),
], validate, asyncHandler(ctrl.createTransaction));

router.delete('/:id', requireRole('owner', 'accountant'), [param('id').isUUID()], validate, asyncHandler(ctrl.reverseTransaction));

module.exports = router;
