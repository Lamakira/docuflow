---
title: 'Read Loom transcripts from transcription responses'
type: 'bugfix'
created: '2026-08-10'
status: 'done'
baseline_commit: '78b9c8a1d2d3efcba63eb97a28f72945f70fed49'
context:
  - 'CONTEXT.md'
  - 'docs/adr/0014-serve-retrieval-and-ai-through-an-intelligence-module.md'
  - 'docs/adr/0018-build-in-a-parallel-environment-with-snapshot-rehearsed-cutover.md'
---

# Read Loom transcripts from transcription responses

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Loom extraction currently searches rendered markup even though the share page fetches a versioned, structured transcription response. That path has never returned a verified Transcript and can mistake unrelated page text for knowledge content.

**Approach:** Capture Loom's transcription JSON before navigation, validate schema `1.1.3`, and format each phrase's `ts` and `value` as immutable timestamped text. Use the page's VTT captions response when JSON is unavailable, while retaining clipboard, DOM, and Apollo extraction only when neither network representation gives a definitive result.

## Boundaries & Constraints

**Always:** Prefer transcription JSON over VTT; distinguish an absent endpoint from a valid empty transcript; coordinate asynchronous response-body reads before closing the browser; keep response bodies and signed URLs out of logs; sanitize the captured fixture; preserve the existing extractor result contract.

**Ask First:** Any change to persisted Transcript shape or downstream embedding; any change to Fathom; any expansion of Loom scraping beyond this existing legacy importer. Approval of this spec authorizes an issue-scoped maintenance exception to ADR-0014, which otherwise retires Loom browser scraping outright; it does not reverse that architectural decision.

**Never:** Commit the supplied Loom URL, recording identifiers, signed response URLs, participant data, meeting content, or production credentials/datasets; infer undocumented fields; silently accept an unknown schema version; treat an empty structured response as permission to scrape rendered page text.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Populated JSON | `schemaVersion: 1.1.3`, phrases with numeric `ts` and string `value` | Timestamped text in phrase order; JSON wins over VTT | Reject malformed phrases explicitly |
| Empty JSON | Valid `phrases: []` | `success: false`; no rendered-page fallback | Explain that the recording has no transcript |
| Schema drift | Unknown version or incompatible phrase shape | No text accepted or persisted | Return a schema-specific failure |
| JSON absent | Valid, non-empty `WEBVTT` response | Return timed VTT content | Empty/invalid VTT is definitive no-transcript |
| Network representations absent | Neither response is observed/readable | Run existing clipboard, DOM, then Apollo rungs | Preserve existing generic failure if all fail |

</frozen-after-approval>

## Code Map

- `server/browser-transcript.ts` -- Playwright lifecycle, transcript validation, Loom network capture, and legacy Loom/Fathom fallbacks.
- `tests/fakes/playwright.ts` -- provider-boundary fake for response timing, body settlement, and rendered-fallback suppression.
- `tests/fixtures/loom-transcription-1.1.3.json` -- sanitized captured response preserving the observed schema and field types.
- `tests/smoke/transcript-browser.test.ts` -- pure parser coverage plus fake-backed Loom extraction ordering and fallback tests.
- `tests/README.md` -- documents the fixture's provenance, sanitization, and browser-test boundary.

## Tasks & Acceptance

**Execution:**
- [x] `server/browser-transcript.ts` -- add typed pure parsers for Loom JSON/VTT and a bounded response collector; attach it before `page.goto`, freeze collection after navigation, settle matching JSON before VTT, and resolve a definitive network result before locating, clicking, or reading rendered UI; reject zero-duration VTT and support valid WebVTT header metadata; leave Fathom unchanged.
- [x] `tests/fakes/playwright.ts` -- add opt-in fake browser/page controls while retaining the default launch failure, so tests can assert listener-before-navigation, delayed body settlement, JSON precedence, bounded unreadable responses, and that definitive empty/network success never invokes rendered fallbacks.
- [x] `tests/fixtures/loom-transcription-1.1.3.json` -- create a content-neutral fixture from the captured populated response, retaining root/phrase/range structure while replacing text and identifiers.
- [x] `tests/smoke/transcript-browser.test.ts` -- pin supported schema formatting, empty transcript, malformed/schema-drift rejection, VTT fallback, timestamp validation, multiple/unreadable response handling, and end-to-end Loom extraction ordering against the provider fake.
- [x] `tests/README.md` -- record fixture safety, the fake-backed lifecycle coverage, and why the one live container check remains outside Vitest.

**Acceptance Criteria:**
- Given a public Loom recording with transcription schema `1.1.3`, when extraction runs inside the application image, then it returns the recording's phrase text with timestamps from `ts`.
- Given valid JSON with an empty phrase array, when extraction completes, then it returns `success: false` stating the recording has no transcript and does not inspect page text.
- Given a changed or malformed transcription schema, when the parser runs, then a deterministic test and runtime error identify the unsupported schema instead of accepting scraped content.
- Given no transcription JSON but a valid captions response, when extraction completes, then VTT timed text is returned before any DOM or clipboard fallback.
- Given Fathom extraction inputs, when the suite and typecheck run, then its existing clipboard/DOM behavior remains unchanged.

## Spec Change Log

- **Iteration 1 — async capture and verifier coverage:** Adversarial review found that the first derivation evaluated responses only after interacting with Loom's rendered transcript UI, snapshotted mutable response arrays without a completion barrier, could wait forever on response bodies, and tested only pure helpers. The Code Map and execution tasks now require a bounded collector frozen after navigation, network resolution before every rendered fallback, deterministic multi-response handling, WebVTT boundary coverage, and a provider-fake integration test. This avoids persisting fallback text despite a late/empty structured response and prevents hung extraction. **KEEP:** schema `1.1.3` validation; timestamped `ts` + `value` formatting without invented speaker/end fields; JSON-before-VTT precedence; sanitized fixture; no URL/body logging; definitive empty/schema errors; unchanged Fathom path; previously passing typecheck/build and pure parser behavior.

## Design Notes

The supplied recording established the real populated shape without exposing content: root keys are `phrases` and `schemaVersion`; schema `1.1.3` phrases contain numeric `ts`, string `value`, and `ranges`. The JSON does not expose speaker or end-time fields, so the formatter must not invent them. It emits each observed start time plus phrase text; VTT remains the fallback when its start/end cue timing is the only available representation.

Playwright emits `response` when status and headers arrive, before the body is necessarily ready. The listener therefore records body promises immediately, and extraction settles them after navigation before browser cleanup.

## Verification

**Commands:**
- `npm test -- tests/smoke/transcript-browser.test.ts` -- parser/schema cases and fake-backed response lifecycle/fallback ordering pass.
- `npm run check` -- TypeScript accepts the response and parser contracts.
- `npm run build` -- production bundle succeeds.
- `npm test` -- complete regression suite passes against the test database.
- `docker build -t docuflow:47 .` -- runtime image builds with its Playwright browser.
- Run the image-local extractor once with the supplied URL passed only at runtime -- populated response returns timestamped content; URL/content are not written to the repository or logs.

**Results:**
- Focused transcript suite: 26/26 passed.
- Full suite: 318/318 passed.
- Typecheck and production build: passed; existing bundler warnings unchanged.
- Docker image `docuflow:47`: built successfully at `sha256:3ac6db4c4479`.
- Image-local live extraction: succeeded from structured JSON with 19 timestamped lines; only redacted counts were emitted.
- Sensitive-data and whitespace audits: passed; supplied URL, recording ID, signed URLs, and captured meeting content are absent.
