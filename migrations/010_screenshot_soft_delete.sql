-- Migration 010: Screenshot soft-delete tombstone
--
-- Adds three nullable columns to time_entry_screenshots so that screenshots
-- can be removed operationally (e.g. sensitive screen content) without
-- destroying the audit trail.
--
-- Deletion model:
--   live row:      deleted_at IS NULL
--   tombstone:     deleted_at IS NOT NULL, deleted_by = admin user id, delete_reason = text
--
-- The GCS storage object is NOT deleted by the soft-delete path.  The
-- storageKey column is preserved on the tombstone row as an audit trail.
-- A separate purge job can clean orphaned GCS objects using storageKey.
--
-- All user-facing queries and analytics must add:
--   AND deleted_at IS NULL
-- alongside the existing:
--   AND storage_key NOT LIKE 'pending-%'
--
-- Cascade hard-delete (from parent time_entry / user / project deletion) is
-- intentionally left unchanged — that path represents "work was deleted", not
-- "evidence was removed", and no tombstone is appropriate.

ALTER TABLE time_entry_screenshots
  ADD COLUMN IF NOT EXISTS deleted_at    timestamp,
  ADD COLUMN IF NOT EXISTS deleted_by    varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason varchar(500);

-- Partial index only covers tombstoned rows (zero cost for live rows)
CREATE INDEX IF NOT EXISTS idx_screenshots_deleted
  ON time_entry_screenshots (deleted_at)
  WHERE deleted_at IS NOT NULL;
