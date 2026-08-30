-- Custom receipt branding: school logo upload.
-- Tenants can upload a logo that appears on receipt PDFs.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_path TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS receipt_footer TEXT;
