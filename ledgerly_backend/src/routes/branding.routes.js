const { Router } = require('express');
const { body } = require('express-validator');
const multer = require('multer');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/branding.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(png|jpg|jpeg|gif|webp)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only image files (PNG, JPG, GIF, WebP) are allowed'), ok);
  },
});

const router = Router();
router.use(requireAuth, requireRole('owner'));

router.get('/', asyncHandler(ctrl.getBranding));
router.post('/logo', upload.single('logo'), asyncHandler(ctrl.uploadLogo));
router.put('/footer', [
  body('footer').optional().trim().isLength({ max: 200 }),
], validate, asyncHandler(ctrl.updateFooter));

module.exports = router;
