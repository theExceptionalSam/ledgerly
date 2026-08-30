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

/**
 * @swagger
 * /auth/register-school:
 *   post:
 *     summary: Register a new school (tenant) and its owner
 *     description: Creates a tenant record, an owner user (pending verification), and emails an OTP. After OTP verification the owner can log in.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [schoolName, ownerName, phone, email, password]
 *             properties:
 *               schoolName: { type: string, minLength: 2, maxLength: 200 }
 *               ownerName:  { type: string, minLength: 2, maxLength: 120 }
 *               phone:      { type: string, description: "E.164-ish, e.g. +234..." }
 *               email:      { type: string, format: email }
 *               password:   { type: string, description: ">=10 chars, 1 uppercase + 1 digit" }
 *     responses:
 *       201: { description: Registration started — OTP emailed }
 *       409: { description: Email or school name already taken }
 *       422: { description: Validation error }
 */
router.post('/register-school', authLimiter, [
  body('schoolName').trim().isLength({ min: 2, max: 200 }),
  body('ownerName').trim().isLength({ min: 2, max: 120 }),
  body('phone').trim().matches(/^[+0-9][0-9\s-]{6,19}$/).withMessage('Enter a valid phone number'),
  body('email').isEmail().normalizeEmail(),
  strongPassword,
], validate, asyncHandler(ctrl.registerSchool));

/**
 * @swagger
 * /auth/verify-otp:
 *   post:
 *     summary: Verify the OTP emailed during registration
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, code]
 *             properties:
 *               email: { type: string, format: email }
 *               code:  { type: string, description: "6-digit OTP" }
 *     responses:
 *       200: { description: Account verified — you can now log in }
 *       400: { description: Invalid or expired OTP }
 */
router.post('/verify-otp', authLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('code').trim().isLength({ min: 6, max: 6 }).isNumeric(),
], validate, asyncHandler(ctrl.verifyOtp));

/**
 * @swagger
 * /auth/resend-otp:
 *   post:
 *     summary: Resend the registration OTP
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: OTP resent (if a pending registration exists) }
 */
router.post('/resend-otp', authLimiter, [
  body('email').isEmail().normalizeEmail(),
], validate, asyncHandler(ctrl.resendOtp));

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Sign in a staff user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful — returns access + refresh tokens (httpOnly cookies) and the user profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:       { type: string, format: uuid }
 *                     email:    { type: string }
 *                     name:     { type: string }
 *                     role:     { type: string, enum: [owner, bursar, accountant, teacher] }
 *                     tenantId: { type: string, format: uuid }
 *       401: { description: Incorrect email or password }
 *       403: { description: Account disabled / not verified }
 */
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

router.post('/refresh', asyncHandler(ctrl.refresh));
router.post('/logout', asyncHandler(ctrl.logout));
router.post('/logout-all', requireAuth, asyncHandler(ctrl.logoutAll));
router.get('/me', requireAuth, asyncHandler(ctrl.me));

module.exports = router;
