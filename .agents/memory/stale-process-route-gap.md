---
name: Stale process / missing route diagnosis
description: New API routes added to routes.ts aren't served until the server process restarts; Vite catch-all masks this by returning HTML with HTTP 200
---

## The Rule
When diagnosing "API calls appear to succeed (200 OK) but return no data", always check whether the endpoint is actually registered in the running server process — not just in the source file.

**Why:** tsx/nodemon does not always hot-reload large route files reliably. The old process stays up with the pre-change route list. New `app.get/post()` calls are never reached. Vite's catch-all serves all unmatched paths as `text/html` with 200 OK.

**How the symptom looks:**
- POST /api/some/new/route → 200 HTML (not JSON, no DB write)
- `apiRequest` returns the Response object (not JSON), `Array.isArray(result)` → false → UI shows empty state
- DB has 0 rows even though server logs show "200" for the POST

**How to apply:**
1. `curl -s http://localhost:5000/api/new/route | head -c 100` — if you see `<!DOCTYPE html>`, the route isn't registered.
2. Restart the workflow (`Start application`) to reload all routes.
3. Re-curl — should now return `{"message":"Unauthorized"}` for unauthenticated requests.

**Note:** The `executeSql` sandbox connects to the same Neon/Replit Postgres as the server (verify by checking known user UUIDs match).
