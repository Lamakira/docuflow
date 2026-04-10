-- Migration 008: Add allowed_timezones column to org_settings
-- Stores an admin-curated IANA timezone list for the Screencasts page dropdown.
-- Null / empty array = no restriction (each user's browser timezone is used).

ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS allowed_timezones jsonb;
