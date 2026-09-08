const { Router } = require('express');
const { query, param, body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { requireFeature } = require('../middleware/featureFlag');
const ctrl = require('../controllers/receipts.controller');

const router = Router();
router.use(requireAuth);

// Specific GET routes (voided register, sequence check) MUST be registered
// before any potential `GET /:id` route — Express matches in registration
// order, so a literal path like /voided must come first to avoid being
// captured by a param route. There's currently no GET /:id on this router,
// but registering the specific paths first is the safe ordering convention.

// Voided receipt register — owner or accountant. Audit view of all receipts
// that have been voided (not deleted) for this tenant.
/**
 * @swagger
 * /receipts/voided:
 *   get:
 *     summary: List voided receipts for the current tenant
 *     tags: [Receipts]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page,       schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: pageSize,   schema: { type: integer, minimum: 1, maximum: 200 } }
 *     responses:
 *       200: { description: Paginated list of voided receipts }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — owner or accountant only }
 */
router.get('/voided', requireRole('owner', 'accountant'), [
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 200 }),
], validate, requireFeature('receipts'), asyncHandler(ctrl.listVoidedReceipts));

// Receipt sequence integrity check — owner or accountant. Scans receipt
// numbers for the current calendar year and reports any gaps in the sequence.
/**
 * @swagger
 * /receipts/sequence-check:
 *   get:
 *     summary: Check receipt number sequence for gaps in the current year
 *     tags: [Receipts]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Sequence integrity report
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 gaps:           { type: array, items: { type: integer } }
 *                 totalReceipts:  { type: integer }
 *                 expectedSequence: { type: integer }
 *                 year:           { type: integer }
 *                 voidedCount:    { type: integer }
 *       401: { description: Unauthorized }
 *       403: { description: Forbidden — owner or accountant only }
 */
router.get('/sequence-check', requireRole('owner', 'accountant'), requireFeature('receipts'), asyncHandler(ctrl.checkReceiptSequence));

// List receipts (optional filters: studentId, from, to, includeVoided, page, pageSize)
/**
 * @swagger
 * /receipts:
 *   get:
 *     summary: List issued receipts for the current tenant
 *     tags: [Receipts]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: studentId,     schema: { type: string, format: uuid } }
 *       - { in: query, name: from,          schema: { type: string, format: date-time } }
 *       - { in: query, name: to,            schema: { type: string, format: date-time } }
 *       - { in: query, name: includeVoided, schema: { type: boolean } }
 *       - { in: query, name: page,          schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: pageSize,      schema: { type: integer, minimum: 1, maximum: 200 } }
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
  query('includeVoided').optional().isBoolean(),
  query('page').optional().isInt({ min: 1 }),
  query('pageSize').optional().isInt({ min: 1, max: 200 }),
], validate, requireFeature('receipts'), asyncHandler(ctrl.listReceipts));

// Void a receipt — owner only. Marks the receipt voided (not deleted) with
// who/when/why. The receipt number stays allocated (it can never be reused).
/**
 * @swagger
 * /receipts/{id}/void:
 *   post:
 *     summary: Void a receipt (owner only)
 *     tags: [Receipts]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, maxLength: 500 }
 *     responses:
 *       200: { description: Receipt voided }
 *       400: { description: Already voided / missing reason }
 *       403: { description: Forbidden — owner only }
 *       404: { description: Receipt not found }
 */
router.post('/:id/void', requireRole('owner'), [
  param('id').isUUID(),
  body('reason').trim().isLength({ min: 3, max: 500 }),
], validate, requireFeature('receipts'), asyncHandler(ctrl.voidReceipt));

module.exports = router;
