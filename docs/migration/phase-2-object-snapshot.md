# The object snapshot

- **Recorded:** 2026-08-13
- **Ticket:** [#59](https://github.com/Lamakira/docuflow/issues/59). That ticket's title and half its scope still say **Cloudflare R2**; [ADR-0023](../adr/0023-prefer-replit-provided-capability-wherever-an-exit-can-be-proved.md) replaced R2 with **Replit App Storage** and [PR #72](https://github.com/Lamakira/docuflow/pull/72) did the adapter work. Read the ticket for its object-plane requirements, not for its provider.
- **Status:** procedure documented and **exercised once against a synthetic corpus**. The bucket itself, and everything that needs a real one, is unfinished — see [What is still open](#what-is-still-open).

Objects are the other half of [ADR-0018](../adr/0018-build-in-a-parallel-environment-with-snapshot-rehearsed-cutover.md)'s snapshot pair. [`phase-2-deployments-and-databases.md`](phase-2-deployments-and-databases.md) covers the database half; this covers the copy that goes with it, the evidence it leaves, and the two checks that say whether it worked.

## What the copy is, and what it is not

[ADR-0022](../adr/0022-provision-r2-in-phase-2-and-replace-the-gcs-move-with-a-snapshot-copy.md) specifies it and ADR-0023 leaves that specification intact — none of it depended on which vendor held the bucket:

- **Operator-run and out-of-band.** A read-only production-side credential and a write-scoped destination credential meet only in the operator's session, on a machine that is neither this repository, its CI, nor this project's Secrets. No job in this environment performs the copy, and nothing writes back toward production.
- **Key-preserving.** Destination object name equals source object name. No re-keying, no flattening, no prefix rewrite. ADR-0012 makes the database row the authority over object identity, and the bucket name and prefix are configuration — which is exactly what lets a restored database resolve against a differently named bucket.
- **Ordered at or after its paired database export.** Objects are creation-only, so a later copy is a superset of what the earlier export names. The reverse order manufactures dangling keys that are an artifact of sequencing rather than of the migration. `objects:manifest` refuses timestamps in that order rather than recording them.
- **Never loaded into a development environment.** ADR-0021's residency rule binds the object half identically to the database half.

So the tooling here does not perform the copy. It produces the evidence and checks the result.

## The commands

```bash
# On the operator's machine, after staging the copied objects:
npm run objects:manifest -- --from ./staged --exported-at <iso> --copied-at <iso> --out manifest.json

# Where the app runs, against the destination bucket:
npm run objects:listing -- --bucket <bucket> --prefix .private/ > listing.txt

# Either machine:
npm run objects:reconcile -- --manifest manifest.json --listing listing.txt
npm run objects:reconcile -- --manifest manifest.json --bucket <bucket>   # lists it directly
```

The manifest is the Phase 2 evidence artifact under ADR-0017's evidence rule: keys, sizes, SHA-256 checksums, counts, and both snapshot timestamps. It names **no credential, no bucket secret, and no signed URL** — keys and checksums grant nothing on their own.

**Reconciliation is asymmetric, and the asymmetry is the point.** A key the manifest names and the destination lacks is a failed copy. A key the destination holds that the manifest does not name is expected and is reported for the record rather than as a fault: anything written after the source was read is a superset. Sizes are compared only where the destination reports one — App Storage lists names alone, which is why the manifest carries checksums taken at the source.

**One artifact serves both checks.** [`scripts/snapshot-rehearsal.ts`](../../scripts/snapshot-rehearsal.ts) asks the same question from the database's side — every storage key a restored row names must resolve — and reads this same manifest:

```bash
npm run snapshot:check -- --keys manifest.json
```

## `list` is part of the port now

[`server/storagePort.ts`](../../server/storagePort.ts) gained `list`, and it is worth saying why a capability no request path uses belongs on the seam. ADR-0023 adopts a Replit-provided capability **only where an exit can be demonstrated**, and the exit it names for App Storage is "list-then-download, a script DocuFlow writes and owns, with a cost that is knowable". A port that cannot enumerate makes that exit unwritable — the decision would rest on a capability the code could not reach. It is also what reconciles a copy against the destination.

Both providers implement it. The Google adapter pages internally through `getFiles`, because a short read looks exactly like a copy that missed objects. The App Storage adapter maps the SDK's own listing and filters out the `.acl.json` siblings it writes beside each object — those are the adapter's bookkeeping, not workspace content, and reporting them would make every policy file look like an object the database failed to name.

## Exercised once against a synthetic corpus — 2026-08-13

Four staged objects, 44 bytes, no production data and no bucket involved.

| Case | Result |
| --- | --- |
| Manifest of the staged copy | 4 objects, 44 bytes, keys + sizes + SHA-256, both timestamps |
| Destination missing one object | **exit 1** — `missing: .private/uploads/doc-missing` |
| Destination holding it at the wrong size | **exit 1** — `size differs: manifest 12, destination 3` |
| Complete destination, plus an object written after the export | **exit 0** — reconciled, 1 extra reported as expected |
| The manifest read by the dangling-key verifier | 4 keys, same artifact |
| A copy dated **before** its export | **refused**, with ADR-0022's ordering rule as the reason |

The three failing cases are recorded deliberately. A reconciliation that has only ever been shown passing has not been shown to fail.

Automated coverage: [`tests/smoke/object-snapshot.test.ts`](../../tests/smoke/object-snapshot.test.ts) and [`tests/smoke/storage-list.test.ts`](../../tests/smoke/storage-list.test.ts).

## What is still open

Everything below needs a real App Storage bucket, and none of it can be closed from the repository.

| | |
| --- | --- |
| App Storage bucket created | **Yes** — 2026-08-13, `replit-objstore-b63748fd-…` |
| `PRIVATE_OBJECT_DIR` / `PUBLIC_OBJECT_SEARCH_PATHS` naming it, in the workspace **and** in Deployment secrets | **Set** 2026-08-13, in both, and in [`.replit`](../../.replit) so a re-clone carries them. The placeholders they replaced were `/docuflow/.private` and `/docuflow/public` |
| Upload, download, and delete succeed in the published environment | *(unrecorded)* |
| Legacy key preservation demonstrated on a seeded object | *(unrecorded)* |
| No `storage.googleapis.com` URL or GCS credential reachable from this environment | *(unrecorded)* |

**The placeholder roots are not only an upload problem.** [`scripts/snapshot-rehearsal.ts`](../../scripts/snapshot-rehearsal.ts) reads those same roots to decide which bucket is *ours*, and ADR-0023 made that the only distinguisher — a production URL and one of ours share the `storage.googleapis.com` host. Point the roots at a bucket that does not exist and every storage URL in a restored database reads as foreign. Fix the roots before rehearsing, not after.

## What ADR-0023 still owes

PR #72 recorded an amendment that decision needs and did not write: ADR-0023 justified regressing Phase 1's gate G1 on the grounds that App Storage is "a standard client library against a bucket, not a sidecar", and the probe on 2026-08-13 disproved it — the Google client cannot reach an App Storage bucket at all, and access runs through `REPL_IDENTITY` and the connectors host. That answers, badly, the one question ADR-0023 left open for this ticket: the exit path runs on the platform being exited. It is weakened rather than void — the SDK's own list and download are what `list` above now exposes — but the decision text should say so.
