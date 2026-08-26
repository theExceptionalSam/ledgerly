const { Router } = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/security');
const ctrl = require('../controllers/auth.controller');

const router = Router();

const strongPassword = body('password')
  .isLength({ min: 10 }).withMessage('Password must be at least 10 characters')
  .matches(/[A-Z]/).withMessage('Password must include an uppercase letter')
  .matches(/[0-9]/).withMessage('Password must include a number');

router.post('/register-school', authLimiter, [
  body('schoolName').trim().isLength({ min: 2, max: 200 }).escape(),
  body('ownerName').trim().isLength({ min: 2, max: 120 }).escape(),
  body('phone').trim().matches(/^[+0-9][0-9\s-]{6,19}$/).withMessage('Enter a valid phone number'),
  body('email').isEmail().normalizeEmail(),
  strongPassword,
], validate, ctrl.registerSchool);

router.post('/verify-otp', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('code').trim().isLength({ min: 6, max: 6 }).isNumeric(),
], validate, ctrl.verifyOtp);

router.post('/resend-otp', authLimiter, [
  body('email').isEmail().normalizeEmail(),
], validate, ctrl.resendOtp);

router.post('/login', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, ctrl.login);

router.post('/refresh', authLimiter, ctrl.refresh);
router.post('/logout', ctrl.logout);
router.post('/logout-all', requireAuth, ctrl.logoutAll);
router.get('/me', requireAuth, ctrl.me);

module.exports = router;
