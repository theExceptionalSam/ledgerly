-- Store tenant logos as base64 data URLs in the database instead of on the
-- filesystem. Render's filesystem is ephemeral — files written to data/logos/
-- are lost on every redeploy, so a logo that uploaded fine would be missing
-- by the time the next receipt PDF was generated. Persisting the data URL in
-- the tenants row keeps the logo with the tenant row across deploys.
--
-- logo_path is kept for backward compatibility (existing rows are not
-- rewritten); new uploads write only logo_data_url.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_data_url TEXT;
