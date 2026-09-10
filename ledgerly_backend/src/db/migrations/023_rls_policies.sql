-- Enable Row Level Security on the two tenant-owned tables that don't have it yet.
--
-- Context: migration 015_enable_rls.sql enabled RLS on the original 15 tables.
-- Two newer tables — `budgets` (022) and `reversal_requests` (020) — were added
-- without enabling RLS. This migration closes that gap so EVERY tenant-owned
-- table has RLS enabled.
--
-- Defense-in-depth model:
--   * The Express backend connects via Supabase's pooler using the `postgres`
--     superuser role, which BYPASSES RLS entirely. So the app is unaffected.
--   * RLS with ZERO policies = "deny all" for any non-superuser role.
--   * If an attacker obtains a non-superuser DB connection (e.g., a leaked
--     read-only analytics role, or the Supabase anon key used via PostgREST),
--     they cannot read or modify any data in any tenant-owned table.
--
-- We intentionally do NOT add permissive policies. Adding `USING (true)` policies
-- would WEAKEN security by allowing anon/authenticated roles to read everything.
-- The correct setup is RLS enabled + 0 policies = locked down for non-superusers.
--
-- Platform-level tables (platform_admins, migrations, refresh_tokens) are out of
-- scope here — migration 015 already enabled RLS on `migrations` and
-- `platform_admins`. `refresh_tokens` is owned by user_id (not tenant_id) and is
-- also already covered by migration 015.

ALTER TABLE IF EXISTS budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reversal_requests ENABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: re-assert RLS on every tenant-owned table from the
-- original set. ENABLE ROW LEVEL SECURITY is idempotent (a no-op if already
-- enabled), so this is safe to re-run and documents the full intended scope.
-- If a table is renamed or dropped in the future, the IF EXISTS guard prevents
-- the migration from failing.
ALTER TABLE IF EXISTS tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS students ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fee_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS student_fee_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS academic_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS parent_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS online_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS data_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fee_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS broadcast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tenant_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS nps_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS deployment_logs ENABLE ROW LEVEL SECURITY;

-- NOTE: No CREATE POLICY statements. With RLS enabled and zero policies, the
-- default behaviour for any non-superuser role is "deny all" (deny SELECT,
-- INSERT, UPDATE, DELETE). This is the desired defense-in-depth posture.
