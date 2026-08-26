-- Phase 5 removal: drop the reminders and tenant_messaging_settings tables.
-- The Termii SMS/WhatsApp feature has been removed from the product. This
-- migration cleans up any database that already ran 005_reminders.sql.
-- Fresh installs that never ran 005 are unaffected (DROP TABLE IF EXISTS).

DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS tenant_messaging_settings;
