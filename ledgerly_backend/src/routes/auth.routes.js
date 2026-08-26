const { Router } = require('express');
const { body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const ctrl = require('../controllers/auth.controller');

const router = Router();

const strongPassword = body('password')
  .isLength({ min: 10 }).withMessage('Password must be at least 10 characters')
  .matches(/[A-Z]/).withMessage('Password must include an uppercase letter')
  .matches(/[0-9]/).withMessage('Password must include a number');

// .escape() removed — React escapes at render time; storing HTML entities
// corrupts data (e.g. O'Brien becomes O&#39;Brien in the DB).
router.post('/register-school', authLimiter, [
  body('schoolName').trim().isLength({ min: 2, max: 200 }),
  body('ownerName').trim().isLength({ min: 2, max: 120 }),
  body('phone').trim().matches(/^[+0-9][0-9\s-]{6,19}$/).withMessage('Enter a valid phone number'),
  body('email').isEmail().normalizeEmail(),
  strongPassword,
], validate, asyncHandler(ctrl.registerSchool));

router.post('/verify-otp', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('code').trim().isLength({ min: 6, max: 6 }).isNumeric(),
], validate, asyncHandler(ctrl.verifyOtp));

router.post('/resend-otp', authLimiter, [
  body('email').isEmail().normalizeEmail(),
], validate, asyncHandler(ctrl.resendOtp));

router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, asyncHandler(ctrl.login));

// Password reset flow
router.post('/forgot-password', authLimiter, [
  body('email').isEmail().normalizeEmail(),
], validate, asyncHandler(ctrl.forgotPassword));

router.post('/reset-password', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('token').notEmpty(),
  strongPassword,
], validate, asyncHandler(ctrl.resetPassword));

router.post('/refresh', authLimiter, asyncHandler(ctrl.refresh));
router.post('/logout', asyncHandler(ctrl.logout));
router.post('/logout-all', requireAuth, asyncHandler(ctrl.logoutAll));
router.get('/me', requireAuth, asyncHandler(ctrl.me));

module.exports = router;
