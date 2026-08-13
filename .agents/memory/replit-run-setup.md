---
name: DocuFlow Replit run setup
description: Non-obvious constraints for running DocuFlow on Replit (DB driver, package firewall, storage provider)
---

- Replit's built-in Postgres proxy is not reachable over Neon's WebSocket driver.
  **Why:** boot defaults to the Neon serverless driver; the local proxy exposes plain TCP only.
  **How to apply:** keep `DB_DRIVER=pg` set in the Replit environment.
- The Replit package firewall can block a pinned transitive dependency (it did for an XML parser pulled by the Google storage SDK). Fix by upgrading the direct dependency to a release that depends on the patched major, not by bypassing the firewall.
- Storage provider selection is credential-driven: supplying a GCS key selects GCS; supplying none selects Replit App Storage. App Storage has no signed URLs and no bucket-creation API reachable from the agent — a bucket must be created in the workspace App Storage tool before uploads work.
