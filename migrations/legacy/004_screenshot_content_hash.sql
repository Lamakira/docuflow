-- Add content_hash to time_entry_screenshots for identical-screenshot detection.
-- Computed server-side (SHA-256 of raw PNG bytes) during upload.
-- Existing rows will have NULL — filter only applies to new captures.
ALTER TABLE time_entry_screenshots
  ADD COLUMN IF NOT EXISTS content_hash varchar(64);

CREATE INDEX IF NOT EXISTS idx_screenshots_content_hash
  ON time_entry_screenshots (content_hash)
  WHERE content_hash IS NOT NULL;
