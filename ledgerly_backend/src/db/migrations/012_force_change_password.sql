-- Add force_change_password flag for invited users.
-- When an owner invites a user, this is set to 1. The user must change
-- their password before they can access any non-auth endpoints.

ALTER TABLE users ADD COLUMN IF NOT EXISTS force_change_password INTEGER NOT NULL DEFAULT 0;
