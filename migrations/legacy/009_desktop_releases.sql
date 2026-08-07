-- Migration 009: Desktop installer release registry
--
-- Stores one row per build artifact published by CI.
-- The backend serves stable download URLs that 302-redirect to the GCS URL,
-- insulating users and the desktop agent's auto-update check from GCS paths.
--
-- Only one row per platform has is_latest = true at any time.
-- The POST /api/internal/desktop-releases endpoint atomically demotes the
-- previous latest and inserts the new one in a single transaction.

CREATE TABLE IF NOT EXISTS desktop_releases (
  id           varchar        PRIMARY KEY DEFAULT gen_random_uuid(),
  version      varchar(50)    NOT NULL,
  platform     varchar(20)    NOT NULL,
  filename     varchar(255)   NOT NULL,
  storage_url  text           NOT NULL,
  file_size    bigint,
  sha256       varchar(64),
  is_latest    boolean        NOT NULL DEFAULT false,
  published_at timestamp      DEFAULT now(),
  created_at   timestamp      DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_desktop_releases_platform_latest
  ON desktop_releases (platform, is_latest);
