const { Router } = require('express');
const { query } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureFlag');
const ctrl = require('../controllers/receipts.controller');

const router = Router();
router.use(requireAuth);

// List receipts (optional filters: studentId, from, to, page, pageSize)
/**
 * @swagger
 * /receipts:
 *   get:
 *     summary: List issued receipts for the current tenant
 *     tags: [Receipts]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: studentId, schema: { type: string, format: uuid } }
 *       - { in: query, name: from,       schema: { type: string, format: date-time } }
 *       - { in: query, name: to,         schema: { type: string, format: date-time } }
 *       - { in: query, name: page,       schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: pageSize,   schema: { type: integer, minimum: 1, maximum: 200 } }
 *     responses:
 *       200:
 *         description: Paginated list of receipts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:     { type: array, items: { type: object } }
 *                 total:    { type: integer }
 *                 page:     { type: integer }
 *                 pageSize: { type: integer }
 *       401: { description: Unauthorized }
 *       403: { description: Receipts feature not enabled for this school }
 */
router.get('/', [
  query('studentId').optional().isUUID(),
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 200 }),
], validate, requireFeature('receipts'), asyncHandler(ctrl.listReceipts));

module.exports = router;
