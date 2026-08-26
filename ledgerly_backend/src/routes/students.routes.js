const { Router } = require('express');
const { body, param } = require('express-validator');
const multer = require('multer');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/students.controller');
const bulkCtrl = require('../controllers/studentsBulk.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx, .xls or .csv files are allowed'), ok);
  },
});

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(ctrl.listStudents));
router.get('/bulk/template', asyncHandler(bulkCtrl.bulkTemplate));
router.get('/export', asyncHandler(async (req, res) => {
  const db = require('../db');
  const { tenantId } = req.user;
  let termId = req.query.termId;
  if (!termId) {
    const { rows: tRows } = await db.query(`SELECT id FROM terms WHERE tenant_id = $1 AND is_current = 1`, [tenantId]);
    termId = tRows[0]?.id;
  }
  const { rows } = await db.query(`
    SELECT s.name, s.class, s.admission_no, s.guardian_contact,
      COALESCE((SELECT SUM(sfa.expected_amount - sfa.discount_amount) FROM student_fee_assignments sfa WHERE sfa.student_id = s.id AND sfa.term_id = $2), 0) AS expected,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.student_id = s.id AND p.term_id = $2 AND p.reversed = 0), 0) AS paid
    FROM students s WHERE s.tenant_id = $1 AND s.status = 'active' ORDER BY s.name
  `, [tenantId, termId]);
  const csv = ['Name,Class,Admission No,Parent Contact,Expected,Paid,Outstanding'];
  for (const s of rows) {
    const out = Math.max(Number(s.expected) - Number(s.paid), 0);
    csv.push([s.name, s.class, s.admission_no || '', s.guardian_contact || '', s.expected, s.paid, out].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="students.csv"');
  res.send(csv.join('\n'));
}));
router.post('/bulk', requireRole('owner', 'bursar', 'accountant'), upload.single('file'), asyncHandler(bulkCtrl.bulkUpload));
router.post('/bulk/archive', requireRole('owner', 'bursar'), [
  body('ids').isArray({ min: 1 }),
], validate, asyncHandler(ctrl.bulkArchiveStudents));
router.get('/:id', [param('id').isUUID()], validate, asyncHandler(ctrl.getStudentDetail));

// Phase 2: itemised fee assignments
router.get('/:id/fees', [param('id').isUUID()], validate, asyncHandler(ctrl.getStudentFees));
router.post('/:id/fees', requireRole('owner', 'bursar', 'accountant'), [
  param('id').isUUID(),
  body('feeHeadId').isUUID(),
  body('termId').isUUID(),
  body('expectedAmount').isFloat({ min: 0 }),
], validate, asyncHandler(ctrl.assignStudentFee));

router.post('/:id/fees/:assignmentId/discount', requireRole('owner'), [
  param('id').isUUID(),
  param('assignmentId').isUUID(),
  body('discountAmount').isFloat({ min: 0 }),
  body('discountReason').optional({ checkFalsy: true }).trim().isLength({ max: 300 }),
], validate, asyncHandler(ctrl.applyDiscount));

router.post('/', requireRole('owner', 'bursar', 'accountant'), [
  body('name').trim().isLength({ min: 1, max: 150 }),
  body('class').trim().isLength({ min: 1, max: 60 }),
  body('admissionNo').optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body('guardianContact').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
], validate, asyncHandler(ctrl.createStudent));

router.put('/:id', requireRole('owner', 'bursar', 'accountant'), [
  param('id').isUUID(),
  body('name').trim().isLength({ min: 1, max: 150 }),
  body('class').trim().isLength({ min: 1, max: 60 }),
  body('admissionNo').optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
  body('guardianContact').optional({ checkFalsy: true }).trim().isLength({ max: 120 }),
], validate, asyncHandler(ctrl.updateStudent));

router.delete('/:id', requireRole('owner', 'bursar'), [param('id').isUUID()], validate, asyncHandler(ctrl.archiveStudent));

module.exports = router;
