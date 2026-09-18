-- School KYC / bio-data — collected after registration, required before
-- dashboard access. Fields align with Nigerian NDPR requirements and
-- Ministry of Education school registration data.
--
-- Context: after a school registers and verifies their email, the owner
-- must complete a KYC / bio-data form before they can access the
-- dashboard. This is required for NDPR (Nigeria Data Protection Regulation)
-- compliance and trust — we need to know who we're onboarding before
-- letting them touch student PII.
--
-- All columns are added with IF NOT EXISTS so the migration is idempotent
-- and safe to re-run. The KYC columns are nullable (except the boolean
-- flags) because a tenant row is created at registration time, before any
-- KYC data exists. `kyc_completed` defaults to FALSE so new tenants start
-- in the "must complete KYC" state; the school-kyc.controller.submitKyc
-- handler flips it to TRUE (and stamps kyc_completed_at) once the form is
-- submitted. The frontend AuthContext + ProtectedRoute read these flags
-- to gate access to the dashboard.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS school_type TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS education_level TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS year_established TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS school_motto TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lga TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS school_email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS school_website TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS registration_number TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS registration_type TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tax_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS student_count_estimate INTEGER;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS staff_count INTEGER;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS calendar_type TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS classes_offered TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kyc_completed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kyc_completed_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tos_accepted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS privacy_accepted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS signature TEXT;
