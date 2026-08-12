# Object storage cost model

- **Recorded:** 2026-08-12
- **Revision:** [`ac3dfb02b44549e2414aab7ba971bed2ed52dbe9`](https://github.com/Lamakira/docuflow/commit/ac3dfb02b44549e2414aab7ba971bed2ed52dbe9) (`main`)
- **Status:** **A model, not a measurement.** Capture behaviour below is read from source. Object *sizes* and working hours are assumptions, stated and isolated so they can be replaced with measurements without redoing the arithmetic.
- **Written for:** [#58](https://github.com/Lamakira/docuflow/issues/58), which owns the spend baseline and the 80%-of-budget alerts, and [#59](https://github.com/Lamakira/docuflow/issues/59), which owns the bucket.

[ADR-0016](../adr/0016-host-on-render-neon-and-r2-with-an-independent-aws-evidence-account.md) sets a €300–500/month launch ceiling and names "Tracking Policy retention as the structural storage-cost lever". This note prices what that lever is holding back, and finds that the lever does not exist yet.

Relative links are navigation aids. Audit each at the revision pinned above, not at a later branch tip.

## What the code actually does

Every figure here is read from source, not assumed.

| Behaviour | Value | Where |
| --- | --- | --- |
| Capture format | **Full-screen PNG**, lossless, no quality setting and no downscale | [`ScreenCaptureWorker.ts:4`](../../desktop-agent/src/workers/ScreenCaptureWorker.ts) |
| Capture resolution | **1920×1080** | `ScreenCaptureWorker.ts:284` |
| Capture interval | **3–5 minutes, randomised** | `ScreenCaptureWorker.ts:4`, floor enforced at `:130` |
| Interval default | `captureIntervalMinMin: 3`, `captureIntervalMaxMin: 5` | [`shared/schema.ts:1336`](../../shared/schema.ts) |
| Interval bounds | Admin-settable, **3 min minimum, 15 min maximum** | [`server/routes.ts:3066`](../../server/routes.ts), clamped in [`AdminPage.tsx:2140`](../../client/src/pages/AdminPage.tsx) |
| Oversize guard | Captures over **5 MB** are skipped, not compressed | `ScreenCaptureWorker.ts:29` |
| Agent-side pruning | `pruneOldScreenshots(maxAgeDays = 30)`, run once at agent startup | `ScreenCaptureWorker.ts:347` |

**That last row is about the device's own disk, not the object store**, and it is the single most expensive misreading available in this area. Its own comment says it keeps "the screenshots directory bounded" — the directory on the laptop.

## The finding that dominates the model: nothing ever deletes an object

[`server/objectStorage.ts`](../../server/objectStorage.ts) contains **no delete call of any kind**, and no scheduled purge exists anywhere in `server/`. In the database layer, `softDeleteTimeEntryScreenshot` writes a `deletedAt` tombstone and `deleteTimeEntryScreenshot` is documented "for internal use only (e.g. tests)" ([`server/storage.ts:325`](../../server/storage.ts)). Both operate on the **row**. Neither reclaims the **bytes**.

So an administrator deleting a screenshot removes it from every view and from nothing else, and object storage is **monotonic**: it only grows, for the life of the deployment, at a rate set by fleet size.

ADR-0016's "Tracking Policy retention" lever is therefore not a setting anyone can turn. It is unbuilt, it has no ticket, and every retention figure below describes what the bill *would* be if it existed.

## Assumptions

Two, both isolated here so a measurement can replace them:

- **Average PNG ≈ 800 KB.** A 1920×1080 lossless screenshot of UI content typically lands between 300 KB and 1.5 MB; flat text-heavy screens compress well, photographic wallpaper does not. The 5 MB guard at `:29` implies someone has already met the top of that range. **This is the assumption the whole model is most sensitive to** — see [Sensitivity](#sensitivity).
- **176 tracked hours per device per month** — 8 h/day × 22 working days. Capture runs while tracking is active, so this is tracked time, not calendar time.

At the 3–5 minute default the mean interval is 4 minutes, so **15 captures/hour → 2,640 captures/device/month → ≈ 2.06 GB/device/month**.

Fleet sizes come from ADR-0016: launch at ≤100 Devices, a month-12 envelope of ~1,000 Devices.

## R2 at these volumes

Rates verified against Cloudflare's published pricing on 2026-08-12: Standard storage **$0.015/GB-month**, Class A (writes) **$4.50/million**, Class B (reads) **$0.36/million**, **egress $0** on any storage class. Free tier: 10 GB-month, 1 M Class A, 10 M Class B.

Monthly storage cost at steady state, by retention window:

| Retention | 100 devices (launch) | 1,000 devices (month 12) |
| --- | --- | --- |
| 30 days | ~$3 | ~$31 |
| 90 days | ~$9 | ~$93 |
| 365 days | ~$37 | ~$371 |
| **None — today's behaviour** | **grows ~$3/month, without limit** | **grows ~$31/month, without limit** |

Operations, at 1,000 devices: 2.64 M writes/month, less the 1 M free tier, is **~$7/month**. Reads stay inside the 10 M free tier — screenshots are written constantly and read rarely. Egress is $0.

**The unbounded row is the one in force.** At 1,000 devices with no retention, object storage passes €300/month somewhere around month ten and does not stop, against a ceiling meant to cover the entire platform.

## Two levers, both cheaper than changing provider

**Format is worth more than anything else here.** Lossless PNG is 5–10× larger than WebP or JPEG at quality 80 for content nobody inspects pixel-perfect. Applying that factor divides every cell in the table above by the same amount: the $371 case becomes roughly $40–75. It is one worker file, and it has no ticket.

**Interval is already configurable and already deployed.** The 15-minute maximum is 3.75× cheaper than the 3–5 minute default, needs no code, and is a Tracking Policy an administrator sets today. It is also a product decision about evidence density, not purely a cost one.

Combined — 15-minute interval plus a lossy format — the 1,000-device 90-day case falls from ~$93/month to roughly $4/month.

## Sensitivity

The model rests on the 800 KB average. At **400 KB** halve every figure; at **1.5 MB** nearly double them. Nothing else in the arithmetic moves the result by more than the fleet-size assumption already does.

**Measure before anyone commits to a number.** Sampling real captures across the actual device population costs an afternoon and replaces the one assumption carrying the whole model.

## Provider comparison, and what is still unmeasured

| | R2 | Google Cloud Storage |
| --- | --- | --- |
| Storage | $0.015/GB-month | **Not verified** — see below |
| Egress | $0, uncapped, any class | **Not verified** |
| Free tier | 10 GB-month, 1 M Class A, 10 M Class B | 5 GB-month, 5,000 Class A, 50,000 Class B — **`us-east1`/`us-west1`/`us-central1` only** |
| Free egress | Always | 100 GB/month, **from North America only** |

GCS's always-free tier is restricted to three US regions. This deployment is EU-resident, so **for this environment that free tier is zero** — not small.

GCS's per-GB storage and egress rates could not be extracted: the pricing page is JavaScript-rendered and truncates on fetch, and the documentation mirror redirects back to it. They are deliberately left blank rather than filled from memory. Pull them from the GCP console or the pricing calculator to finish this table.

**Egress is not the discriminator here.** Screenshots are write-heavy and read-almost-never, so the transfer difference between providers is small; the cost is accumulation. The one workload where zero-egress is a real line item is desktop installer delivery — ADR-0018's cutover includes a forced fleet update, which is every device pulling an installer at once.

## Replit App Storage as a third option

Replit's documentation describes App Storage as "backed by Google Cloud Storage (GCS)", reachable through the standard `@google-cloud/storage` client library and not only Replit's own SDK — which is the client [`server/objectStorage.ts`](../../server/objectStorage.ts) already uses. It is provisioned with the Replit App and colocated with the published geography, which would settle the residency question without a separate jurisdiction setting.

It carries the same custody question as the Replit-provisioned database and the Replit-managed Clerk tenant: Replit is the GCS customer, not DocuFlow. It would also re-introduce a Replit storage dependency of the kind Phase 1's gate G1 removed and the Phase 1 record marks **Verified**.

The coupling is genuinely weaker than the retired connector — a standard client library against a bucket is not a sidecar — so this is a custody and gate-regression question, not an API lock-in one. Recorded as an option with its cost named; not recommended here, and not decided here.

## What this note does not settle

- The **format change** has no ticket and no owner.
- The **object retention** capability has no ticket and no owner. ADR-0016 assumes it exists.
- **GCS rates** are unmeasured, so the provider comparison is half-priced.
- **Average object size** is assumed, not sampled.

None of these blocks provisioning. All of them block a spend baseline that means anything, which is what #58 has to produce.
