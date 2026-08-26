-- Phase 6: Drop the deprecated fee_amount column.
-- All billing now flows through student_fee_assignments. The column was kept
-- until Phase 6 for rollback safety; it is no longer read or written by any code.
-- SQLite 3.35+ supports DROP COLUMN directly (no table rebuild needed).

ALTER TABLE students DROP COLUMN fee_amount;
