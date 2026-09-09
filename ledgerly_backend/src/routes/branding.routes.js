const { Router } = require('express');
const { body } = require('express-validator');
const multer = require('multer');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/branding.controller');

// SECURITY: file uploads are validated in two layers:
//   1. multer fileFilter rejects anything whose declared MIME type OR filename
//      extension isn't an allowed image type. Both are checked because either
//      alone can be spoofed — a malicious file could declare image/png in the
//      Content-Type header but carry a .html extension, or vice versa.
//   2. The controller (branding.controller.uploadLogo) inspects the first few
//      bytes of the buffer (magic bytes) and rejects the upload if they don't
//      match a known image signature. This catches the case where both the
//      filename and Content-Type are spoofed — the actual bytes still have to
//      look like a PNG/JPEG/GIF/WebP, otherwise the upload is refused.
// Without the magic-byte check, an attacker could upload arbitrary content
// (HTML with embedded JS, an EXE, an SVG with embedded script) by naming it
// logo.png. The data URL would be stored in tenants.logo_data_url and later
// embedded into receipt PDFs by pdfkit's image() call. While pdfkit's image
// parser would likely reject non-image bytes, the magic-byte check is the
// right boundary to enforce because it doesn't depend on pdfkit's robustness.
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const extOk = /\.(png|jpg|jpeg|gif|webp)$/i.test(file.originalname);
    const mimeOk = ALLOWED_IMAGE_MIME.has((file.mimetype || '').toLowerCase());
    const ok = extOk && mimeOk;
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
