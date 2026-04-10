-- Migration 006: Add keyboard/mouse activity percent columns to time_entry_screenshots
-- These store the fraction of the 60-second window before each capture where
-- global input (keyboard or pointer) was detected by the desktop agent.

ALTER TABLE time_entry_screenshots
  ADD COLUMN IF NOT EXISTS keyboard_activity_percent integer,
  ADD COLUMN IF NOT EXISTS mouse_activity_percent integer;
