const { Router } = require('express');
const { asyncHandler } = require('../middleware/validate');
const ctrl = require('../controllers/platform.controller');

const router = Router();

// All routes require platform admin auth
router.use(ctrl.requirePlatformAdmin);

// --- Existing ---
router.get('/overview', asyncHandler(ctrl.getPlatformOverview));
router.get('/health', asyncHandler(ctrl.getPlatformHealth));

// --- Tier 1: Critical ---
router.post('/impersonate/:tenantId', asyncHandler(ctrl.impersonateTenant));
router.post('/tenants/:id/suspend', asyncHandler(ctrl.suspendTenant));
router.post('/tenants/:id/unsuspend', asyncHandler(ctrl.unsuspendTenant));
router.get('/revenue', asyncHandler(ctrl.getRevenue));
router.get('/errors', asyncHandler(ctrl.getErrors));

// `/tenants/export` MUST come before `/tenants/:id/...` so Express doesn't
// match "export" as a tenant id (it wouldn't here since the methods differ,
// but explicit ordering keeps the intent clear and avoids future surprises).
router.get('/tenants', asyncHandler(ctrl.getTenants));
router.get('/tenants/export', asyncHandler(ctrl.exportTenants));

// --- Tier 2: Important ---
router.get('/usage', asyncHandler(ctrl.getUsage));

router.get('/feature-flags', asyncHandler(ctrl.getFeatureFlags));
router.post('/feature-flags', asyncHandler(ctrl.upsertFeatureFlag));

router.get('/broadcasts', asyncHandler(ctrl.getBroadcasts));
router.post('/broadcasts', asyncHandler(ctrl.createBroadcast));
router.delete('/broadcasts/:id', asyncHandler(ctrl.deleteBroadcast));

router.get('/tenants/:id/notes', asyncHandler(ctrl.getTenantNotes));
router.post('/tenants/:id/notes', asyncHandler(ctrl.createTenantNote));

// --- Tier 3: Nice to have ---
router.get('/database', asyncHandler(ctrl.getDatabaseStats));

router.get('/deployments', asyncHandler(ctrl.getDeployments));
router.post('/deployments', asyncHandler(ctrl.createDeployment));

router.get('/rate-limits', asyncHandler(ctrl.getRateLimits));

router.get('/nps', asyncHandler(ctrl.getNps));
router.post('/nps', asyncHandler(ctrl.createNps));

module.exports = router;
