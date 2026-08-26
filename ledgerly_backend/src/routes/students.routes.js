const { Router } = require('express');
const { body, param } = require('express-validator');
const multer = require('multer');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/students.controller');
const bulkCtrl = require('../controllers/studentsBulk.controller');
const remindersCtrl = require('../controllers/reminders.controller');

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

router.get('/', ctrl.listStudents);
router.get('/bulk/template', bulkCtrl.bulkTemplate);
router.post('/bulk', requireRole('owner', 'bursar', 'accountant'), upload.single('file'), bulkCtrl.bulkUpload);
router.get('/:id', [param('id').isUUID()], validate, ctrl.getStudentDetail);

// Phase 2: itemised fee assignments
router.get('/:id/fees', [param('id').isUUID()], validate, ctrl.getStudentFees);
router.post('/:id/fees', requireRole('owner', 'bursar', 'accountant'), [
  param('id').isUUID(),
  body('feeHeadId').isUUID(),
  body('termId').isUUID(),
  body('expectedAmount').isFloat({ min: 0 }),
], validate, ctrl.assignStudentFee);

router.post('/:id/fees/:assignmentId/discount', requireRole('owner'), [
  param('id').isUUID(),
  param('assignmentId').isUUID(),
  body('discountAmount').isFloat({ min: 0 }),
  body('discountReason').optional({ checkFalsy: true }).trim().isLength({ max: 300 }).escape(),
], validate, ctrl.applyDiscount);

// Phase 5: send a reminder (SMS/WhatsApp) to a student's parent
router.post('/:id/reminder', requireRole('owner', 'bursar', 'accountant'), [
  param('id').isUUID(),
  body('channel').optional().isIn(['sms', 'whatsapp']),
], validate, remindersCtrl.sendReminder);

router.post('/', requireRole('owner', 'bursar', 'accountant'), [
  body('name').trim().isLength({ min: 1, max: 150 }).escape(),
  body('class').trim().isLength({ min: 1, max: 60 }).escape(),
  body('admissionNo').optional({ checkFalsy: true }).trim().isLength({ max: 60 }).escape(),
  body('guardianContact').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).escape(),
], validate, ctrl.createStudent);

router.put('/:id', requireRole('owner', 'bursar', 'accountant'), [
  param('id').isUUID(),
  body('name').trim().isLength({ min: 1, max: 150 }).escape(),
  body('class').trim().isLength({ min: 1, max: 60 }).escape(),
  body('admissionNo').optional({ checkFalsy: true }).trim().isLength({ max: 60 }).escape(),
  body('guardianContact').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).escape(),
], validate, ctrl.updateStudent);

router.delete('/:id', requireRole('owner', 'bursar'), [param('id').isUUID()], validate, ctrl.archiveStudent);

module.exports = router;
