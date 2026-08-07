-- Migration 007: Add raw event count columns to time_entry_screenshots
-- keyboard_count: total keydown events in the 60-second window before capture (uiohook mode only).
-- mouse_count:    total pointer events (mousedown + mousemove throttled + wheel) in the same window.
-- Both are null when uiohook-napi was unavailable (powerMonitor fallback mode).

ALTER TABLE time_entry_screenshots
  ADD COLUMN IF NOT EXISTS keyboard_count integer,
  ADD COLUMN IF NOT EXISTS mouse_count integer;
