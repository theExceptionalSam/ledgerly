const { Router } = require('express');
const multer = require('multer');
const { body, param } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/bankrecon.controller');

const router = Router();
router.use(requireAuth, requireRole('owner', 'accountant'));

// In-memory storage — the CSV is parsed and discarded in the same request. 2 MB
// cap is enough for ~20k rows, which is well beyond any realistic bank statement.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

router.post('/upload', upload.single('file'), asyncHandler(ctrl.upload));

router.get('/:statementId', [param('statementId').isUUID()], validate, asyncHandler(ctrl.getStatement));

router.post('/:statementId/match', [
  param('statementId').isUUID(),
  body('bankTransactionId').isUUID(),
  body('paymentId').isUUID(),
], validate, asyncHandler(ctrl.match));

router.post('/:statementId/unmatch', [
  param('statementId').isUUID(),
  body('bankTransactionId').isUUID(),
], validate, asyncHandler(ctrl.unmatch));

module.exports = router;
