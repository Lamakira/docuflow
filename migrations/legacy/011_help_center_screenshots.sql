-- Help Center article images: slot id → public object path (/public-objects/…)
ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS help_center_screenshots jsonb;
