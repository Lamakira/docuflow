# Screenshots — Architecture & Scaling

> Status: living document — updated as the system evolves.

---

## 1. Current State

### Flow (as of v0.1.3)

```
Desktop Agent
  └─ ScreenCaptureWorker (every 3–5 min, timer running)
       ├─ desktopCapturer.getSources() → PNG buffer
       │    └─ fallback: PowerShell Win32 GDI (if thumbnail empty)
       └─ SqliteQueue.enqueueScreenshot()
             └─ SyncWorker (every 30s)
                  ├─ POST /api/agent/screenshots/presign
                  │     → creates DB record (storageKey = "pending-{id}")
                  ├─ PUT  /api/agent/screenshots/upload/:id
                  │     → sharp: resize 1920px + WebP 75%
                  │     → upload to GCS via signed PUT URL
                  │     → update DB record (storageKey = "/objects/agent-screenshots/{id}.webp")
                  └─ POST /api/agent/screenshots/confirm
                        → validates storageKey not "pending-*"
```

### Storage

| Layer | Technology | Notes |
|-------|-----------|-------|
| Object storage | Google Cloud Storage (Replit sidecar) | Private bucket, server-relayed access |
| Database | PostgreSQL (Neon Serverless) | `time_entry_screenshots` table |
| Serving | Express `GET /api/time-tracking/screenshots/:id/image` | Proxies binary from GCS |

### DB Schema (`time_entry_screenshots`)

```sql
id            uuid PRIMARY KEY
timeEntryId   varchar  REFERENCES time_entries(id) ON DELETE CASCADE
userId        varchar  REFERENCES users(id) ON DELETE CASCADE
crmProjectId  varchar  REFERENCES crm_projects(id) ON DELETE CASCADE
storageKey    varchar(500)   -- "/objects/agent-screenshots/{id}.webp"
capturedAt    timestamp
createdAt     timestamp

-- Indexes
idx_screenshots_time_entry  ON (timeEntryId)
idx_screenshots_user        ON (userId)
idx_screenshots_project     ON (crmProjectId)
idx_screenshots_captured    ON (capturedAt)
```

### API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/time-tracking/screenshots` | session | List — filters: userId, timeEntryId, crmProjectId, startDate, endDate, limit (max 100), offset |
| `GET /api/time-tracking/screenshots/:id/image` | session | Serve binary from GCS (admin or owner) |
| `POST /api/agent/screenshots/presign` | device token | Create pending record + return uploadURL |
| `PUT /api/agent/screenshots/upload/:id` | device token | Receive PNG → compress WebP → upload GCS |
| `POST /api/agent/screenshots/confirm` | device token | Validate upload complete |

---

## 2. Current Limitations

| # | Limitation | Impact |
|---|-----------|--------|
| 1 | **Serving proxied via Express** — every image request hits the Node server, reads from GCS, streams to client | CPU/memory per image request; not cacheable at CDN level |
| 2 | **No signed URL for client** — client can't fetch directly from GCS | Every image = an authenticated Express round-trip |
| 3 | **No thumbnail generation** — full WebP served even for grid thumbnails (typically 150px wide) | ~500KB WebP sent where 20KB thumbnail would suffice |
| 4 | **Pending records not cleaned up** — if agent crashes mid-upload, `storageKey = "pending-*"` rows accumulate | DB bloat over time |
| 5 | **No upload rate limiting per device** — a rogue agent could flood GCS | Storage cost risk |
| 6 | **Shared DB dev/prod** — same Neon instance used by both Replit deployments | User lists mix between environments |
| 7 | **No retention policy** — screenshots kept indefinitely | GCS cost grows unbounded |

---

## 3. Target Architecture

```
Desktop Agent
  └─ Upload PNG → POST /api/agent/screenshots/presign
                      → Server generates GCS signed PUT URL (short TTL)
                      → Agent PUTs directly to GCS (bypass server)  ← future
  OR (current — server-relay, works without public GCS bucket)
       └─ PUT /api/agent/screenshots/upload/:id (server compresses + relays)

GCS bucket (private)
  └─ agent-screenshots/{id}.webp    ← full resolution
  └─ agent-screenshots/{id}_thumb.webp  ← 320×180 thumbnail  ← future

CDN (Cloudflare / GCS CDN)  ← future
  └─ Signed URLs with 1h TTL, served directly to browser
  └─ Browser caches thumbnails

Web App
  ├─ GET /api/time-tracking/screenshots
  │     → returns { id, capturedAt, thumbnailUrl (signed, 1h TTL), ... }  ← future
  │     → currently: no URL, client constructs /api/.../image
  └─ <img src="{thumbnailUrl}" loading="lazy" />
       → hits CDN directly, no Express involved  ← future
```

---

## 4. Quick Wins (Applied ✅ / Proposed 🔲)

### Applied now

| # | Win | Where |
|---|-----|-------|
| ✅ | **WebP compression 75% + resize to 1920px** via sharp | `server/agentRoutes.ts` — upload handler |
| ✅ | **Pagination** (`limit` max 100, `offset`) | `GET /api/time-tracking/screenshots` |
| ✅ | **Filter `pending-*` records** from list API | `storage.getTimeEntryScreenshots()` |
| ✅ | **Lazy loading** (`<img loading="lazy">`) | `ScreencastsPage.tsx` |
| ✅ | **Indexes** on userId, capturedAt, timeEntryId, crmProjectId | `shared/schema.ts` |

### Proposed — next steps

| Priority | Win | Effort | Impact |
|----------|-----|--------|--------|
| 🔲 High | **Thumbnail generation** — generate a 320×180 WebP alongside the full image at upload time | Low (add second sharp pass in upload handler) | -95% bandwidth for grid view |
| 🔲 High | **Signed URLs in list API** — return `thumbnailUrl` + `fullUrl` as short-lived GCS signed URLs | Medium | Offload image serving from Express entirely |
| 🔲 Medium | **Pending record cleanup** — cron job or DB trigger to delete `pending-*` rows older than 24h | Low | DB hygiene |
| 🔲 Medium | **Retention policy** — delete screenshots older than N days (configurable per workspace) | Medium | GCS cost control |
| 🔲 Medium | **Upload rate limiting** — max N screenshots per device per hour | Low | Abuse prevention |
| 🔲 Low | **Separate dev/prod DB** — distinct Neon instances per environment | Infra | Env isolation |
| 🔲 Low | **CDN** — Cloudflare in front of GCS signed URLs | Infra | Cache hit ratio |
| 🔲 Low | **arm64 macOS build** — add `macos-latest` (M1) job alongside existing Intel build | CI | Native M1 support |

---

## 5. Thumbnail Generation — Implementation Sketch

When the thumbnail quick win is ready to implement, the upload handler becomes:

```typescript
// In PUT /api/agent/screenshots/upload/:id

const [fullBuffer, thumbBuffer] = await Promise.all([
  sharp(rawBuffer).resize({ width: 1920, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer(),
  sharp(rawBuffer).resize({ width: 320, height: 180, fit: "cover" }).webp({ quality: 70 }).toBuffer(),
]);

// Upload both in parallel
const [, ] = await Promise.all([
  uploadToGCS(`agent-screenshots/${id}.webp`, fullBuffer, "image/webp"),
  uploadToGCS(`agent-screenshots/${id}_thumb.webp`, thumbBuffer, "image/webp"),
]);

// DB: store both keys
await storage.updateTimeEntryScreenshot(id, {
  storageKey: `/objects/agent-screenshots/${id}.webp`,
  thumbnailKey: `/objects/agent-screenshots/${id}_thumb.webp`,  // new column needed
});
```

The list API would then return `thumbnailUrl` instead of forcing clients to call `/image`.

---

## 6. Cost Estimates (rough)

| Scenario | Screenshots/day/user | GCS storage/month (10 users, 1 year) | Bandwidth |
|----------|---------------------|--------------------------------------|-----------|
| Current (WebP 75%, 1920px) | ~24 | ~1.4 GB | Full WebP per view |
| With thumbnails (320px, WebP 70%) | ~24 | +~60 MB for thumbs | -95% for grid, full only on click |
| With retention (90 days) | ~24 | ~120 MB rolling | Stable |

GCS pricing (us-central1): ~$0.020/GB/month storage, $0.12/GB egress.
With 10 users + thumbnails + 90-day retention: **< $5/month**.
