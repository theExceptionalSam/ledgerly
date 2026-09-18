const { Router } = require('express');
const { body } = require('express-validator');
const { validate, asyncHandler } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/school-kyc.controller');

// School KYC routes — all endpoints require an authenticated staff session.
// requirePasswordNotForced has already run (mounted in server.js before this
// router), so a user with force_change_password=1 would already be blocked.
const router = Router();
router.use(requireAuth);

// GET /api/v1/school-kyc — returns the current KYC status + all fields.
router.get('/', asyncHandler(ctrl.getKycStatus));

// POST /api/v1/school-kyc — submit the KYC form (initial onboarding).
// The validator chain enforces the required-field rules; submitKyc has its
// own defense-in-depth check too. `tos_accepted` / `privacy_accepted` arrive
// as the string "true" from the JSON body (the frontend sends booleans, but
// express-validator's equals() coerces to string for comparison — using
// equals('true') accepts both the boolean true and the string "true").
router.post('/', [
  body('school_type').isIn(['day', 'boarding', 'mixed']),
  body('education_level').isIn(['nursery', 'primary', 'secondary', 'mixed']),
  body('year_established').matches(/^\d{4}$/),
  body('address').trim().isLength({ min: 5, max: 500 }),
  body('lga').trim().notEmpty(),
  body('state').trim().notEmpty(),
  body('registration_number').trim().notEmpty(),
  body('registration_type').isIn(['cac', 'ministry', 'private', 'mission', 'government']),
  body('student_count_estimate').isInt({ min: 1, max: 100000 }),
  body('calendar_type').isIn(['3-term', 'semester', 'other']),
  body('classes_offered').trim().notEmpty(),
  body('tos_accepted').equals('true'),
  body('privacy_accepted').equals('true'),
  body('signature').trim().isLength({ min: 3, max: 100 }),
  // Optional fields — present in the body but not required.
  body('school_motto').optional({ nullable: true }).trim().isLength({ max: 200 }),
  body('school_email').optional({ nullable: true }).isEmail().normalizeEmail(),
  body('school_website').optional({ nullable: true }).trim().isLength({ max: 300 }),
  body('tax_id').optional({ nullable: true }).trim().isLength({ max: 100 }),
  body('staff_count').optional({ nullable: true }).isInt({ min: 0, max: 100000 }),
], validate, asyncHandler(ctrl.submitKyc));

// PUT /api/v1/school-kyc — partial update (Settings → School Profile later).
router.put('/', asyncHandler(ctrl.updateKyc));

module.exports = router;
