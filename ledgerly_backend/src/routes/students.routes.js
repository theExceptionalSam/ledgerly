const { Router } = require('express');
const { body, param } = require('express-validator');
const multer = require('multer');
const { validate } = require('../middleware/validate');
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

router.get('/', ctrl.listStudents);
router.get('/bulk/template', bulkCtrl.bulkTemplate);
router.post('/bulk', requireRole('owner', 'bursar', 'accountant'), upload.single('file'), bulkCtrl.bulkUpload);
router.get('/:id', [param('id').isUUID()], validate, ctrl.getStudentDetail);

router.post('/', requireRole('owner', 'bursar', 'accountant'), [
  body('name').trim().isLength({ min: 1, max: 150 }).escape(),
  body('class').trim().isLength({ min: 1, max: 60 }).escape(),
  body('admissionNo').optional({ checkFalsy: true }).trim().isLength({ max: 60 }).escape(),
  body('guardianContact').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).escape(),
  body('feeAmount').isFloat({ min: 0 }),
], validate, ctrl.createStudent);

router.put('/:id', requireRole('owner', 'bursar', 'accountant'), [
  param('id').isUUID(),
  body('name').trim().isLength({ min: 1, max: 150 }).escape(),
  body('class').trim().isLength({ min: 1, max: 60 }).escape(),
  body('admissionNo').optional({ checkFalsy: true }).trim().isLength({ max: 60 }).escape(),
  body('guardianContact').optional({ checkFalsy: true }).trim().isLength({ max: 120 }).escape(),
  body('feeAmount').isFloat({ min: 0 }),
], validate, ctrl.updateStudent);

router.delete('/:id', requireRole('owner', 'bursar'), [param('id').isUUID()], validate, ctrl.archiveStudent);

module.exports = router;
