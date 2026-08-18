# The evidence account

- **Recorded:** 2026-08-14
- **Ticket:** [#57](https://github.com/Lamakira/docuflow/issues/57).
- **Two of its nouns are stale.** It says the export comes from **Neon** and that secrets live in **Render environment groups**; [ADR-0021](../adr/0021-run-the-compute-on-replit-and-supersede-the-render-hosting-decision.md) moved the compute plane and the database to Replit after it was written, so the export reads this environment's Replit-hosted database and the job's variables live in Replit Secrets. ADR-0015's secret tiering and ADR-0016's confinement rule are unchanged, and are exactly what the "backup job's environment and nowhere else" arrangement below satisfies.
- **Status: there is no AWS account yet.** The export, its encryption, its evidence record, and the key layout are built and tested. The bucket, the Object Lock demonstration, and the credential scoping are unstarted, and every acceptance criterion is unrecorded. See [What is still open](#what-is-still-open).

## Why this account exists at all

Everything else in this environment is Replit. If that account is lost, suspended, or reached by someone who should not have reached it, the database and every backup of it go together — a copy held by the thing being copied is not a second copy. ADR-0015 asks for an evidence copy the environment cannot alter; [ADR-0016](../adr/0016-host-on-render-neon-and-r2-with-an-independent-aws-evidence-account.md) makes it an S3 bucket in a standalone AWS account with **Object Lock in compliance mode**, and puts the credentials that write to it in the backup job's environment and nowhere else.

Compliance mode is the part worth being precise about, because it is unlike every other control here. It is not a permission an administrator can revoke: for the length of an object's retention, **nobody can delete or overwrite it** — not an IAM policy change, not the account root, not AWS support. That is what makes it evidence rather than a backup, and it is also why the retention period is a one-way door, below.

[ADR-0021](../adr/0021-run-the-compute-on-replit-and-supersede-the-render-hosting-decision.md) raises the stakes since #57 was written. Its point-in-time-restore amendment was **Contested** until [#53](https://github.com/Lamakira/docuflow/issues/53) read the published database's host suffix on 2026-08-18: **production is Helium**. The database-reference branch therefore governs — checkpoint rollback, not PITR — and **these exports are the recovery point of record**, not a secondary copy. This is the ticket that decides whether losing the database is survivable, and it should not be scheduled as though it were paperwork.

## What the tooling does, and what it deliberately does not

[`scripts/evidence-export.ts`](../../scripts/evidence-export.ts) takes the dump, encrypts it, writes the artifact and its evidence record, and prints the upload command. **It does not upload.** Two reasons, and the second outlives the first:

- There is no bucket yet.
- The credential that writes to the evidence bucket belongs in the backup job's environment. ADR-0016 confines it there, and that confinement *is* the argument for a separate account — a credential this repository could hold is a bucket this repository could have altered. This is the same division [ADR-0022](../adr/0022-provision-r2-in-phase-2-and-replace-the-gcs-move-with-a-snapshot-copy.md) draws for the object copy, taken for the same reason.

```bash
npm run evidence:export  -- --out ./evidence --retain-days 35
npm run evidence:verify  -- --manifest ./evidence/manifest.json --file ./evidence/docuflow-….dump.enc
npm run evidence:decrypt -- --manifest ./evidence/manifest.json --file ./evidence/docuflow-….dump.enc --out ./restore.dump
```

`export` prints the `aws s3api put-object` line to run next, with the Object Lock flags already filled in. `verify` is the half that matters more than it looks: it re-reads the artifact, checks the ciphertext against the manifest, decrypts it, and checks the plaintext against the manifest too. **An export that cannot be decrypted is otherwise discovered at the restore drill**, which is the worst possible moment and, under a compliance lock, an unfixable one. `decrypt` is what the drill itself runs, and it checks the plaintext against the manifest before writing — `pg_restore` on a dump that decrypted to the wrong bytes fails deep in the restore, hours in.

Automated coverage: [`tests/smoke/evidence-export.test.ts`](../../tests/smoke/evidence-export.test.ts).

### Exercised once against a synthetic database — 2026-08-14

PostgreSQL 16.14 in a throwaway container, 500 rows and 2,000 rows across two tables, no production data and no bucket. The whole chain, including a real restore, because a backup that has only been shown to *write* has not been shown to be a backup.

| Case | Result |
| --- | --- |
| `export` against a live database | 17,604-byte dump, 17,639 bytes encrypted, manifest written with both checksums |
| Key printed for the upload | `db/2026/08/14/docuflow-20260814T020000Z.dump.enc`, lock until `2026-09-18T02:00:00.000Z` |
| `verify` on the artifact as written | **exit 0** — ciphertext checksum matches, decrypts, plaintext checksum matches |
| `verify` under a different key | **exit 1** — named as a key-or-tampering failure, not as Node's raw cipher error |
| `verify` on a single flipped byte | **exit 1** — caught at the ciphertext checksum, before the cipher was reached |
| `decrypt` then `pg_restore` into a fresh database | **exit 0** — 500 clients and 2,000 notes restored, content digests identical to the source |
| No `pg_dump` on the host | **refused by name**, with the reason there is no substitute |

Two things that only running it revealed. The restore path said "decrypt to a working file" and **no command did that** — `verify` decrypts in memory and discards it — so `evidence:decrypt` exists because of this exercise. And `pg_dump` **refuses a literal space in the connection URL** whatever care is taken passing it: *"unexpected spaces found in …, use percent-encoded spaces (%20) instead."* A password with a space has to arrive already encoded, which is a property of the variable rather than of this script, and is the sort of thing that surfaces at 2am on the first night otherwise.

## The key layout

Declared now, before the audit port exists, because #57 asks for it and because the cheap moment to fix a key layout is before anything is written under a lock that forbids renaming.

```
db/<YYYY>/<MM>/<DD>/docuflow-<YYYYMMDD>T<HHMMSS>Z.dump.enc
audit/<YYYY>/<MM>/<DD>/<segment>.jsonl.enc
```

Zero-padded, UTC, date as a path rather than only as a filename. Three things want that shape and none of them is aesthetics: a lifecycle rule addresses a prefix, `aws s3 ls` gives a lexicographic listing and nothing else — so padding is what makes it read chronologically — and a restore drill asks for one day.

`audit/` has no producer. ADR-0015's append-only audit table and its closed-segment export are a later phase; there is no audit table in [`migrations/`](../../migrations) today. The prefix is reserved, not populated.

## Encryption, and what the key costs

The dump is encrypted with **AES-256-GCM before it leaves the process**, under `EVIDENCE_EXPORT_KEY` — 64 hex characters, held outside AWS. Server-side encryption would leave the bucket's holder able to read the database; this arrangement means possession of the bucket is not possession of the data.

GCM rather than CBC because an evidence copy that cannot detect tampering is not evidence. The bucket refuses overwrites; the cipher refuses everything that arrives by another route.

**Losing that key is unrecoverable in a specific and expensive way.** The exports become unreadable, and because compliance mode forbids deletion they also cannot be cleaned up — they sit there, unreadable, billed, until their retention expires. Where the key is escrowed is a decision this document does not make and the table below records as open.

## Retention is a one-way door

`--retain-days` is **required and has no default.** Compliance-mode retention can be extended and never shortened, by anyone, so the number is a commitment to store and to pay for the full term. A default here would be a bill nobody chose, on objects nobody can delete.

ADR-0016 asks for daily exports and a bounded backup window but does not name the number, and ADR-0015's retention rules "live with their owning modules". So the figure is genuinely undecided and is recorded as such below rather than guessed at in a flag default.

## Where the nightly job runs — undecided

**Nothing in this environment schedules anything.** ADR-0013's worker is Phase 3 and does not exist. Two candidates, and one hard constraint that applies to both.

The constraint: **`pg_dump` is not present on this host, and the [`Dockerfile`](../../Dockerfile) installs no `postgresql-client`.** A logical export has no substitute — a hand-rolled `SELECT` of every table restores in the wrong order and carries no schema — so whichever home is chosen has to supply the binary, and at a version compatible with the server it dumps. The script refuses by name rather than producing a partial artifact.

| | For | Against |
| --- | --- | --- |
| **A Replit Scheduled deployment** | ADR-0021 rejected Scheduled as the *worker's* home because a process that stops between runs cannot hold ADR-0013's lease; a nightly export holds no lease, so that objection does not transfer. Keeps `DATABASE_URL` and the AWS credentials out of CI entirely, which is the stronger reading of ADR-0016's confinement. | ADR-0021 also established that deployment type is one-per-App, so this is a third Replit project. `pg_dump` has to be available in its image. |
| **A GitHub Actions scheduled workflow** | Diffable, reviewable, and free; the schedule is in the repository where a reviewer sees it. | The evidence credential and this environment's `DATABASE_URL` become GitHub secrets. ADR-0018 permits it — it bars *production* credentials from CI — but ADR-0016 asked for the evidence credential to be confined to the backup job's environment, and CI is a wider blast radius than that sentence intends. |

Recorded as a decision to make, not made here.

## The restore path

The drill this is all for, in the order it runs:

1. **Fetch** the artifact for the chosen date from the evidence account, using a credential scoped to that account.
2. **Verify before restoring.** `npm run evidence:verify -- --manifest <m> --file <artifact>`. Both checksums, and the decrypt. A restore that begins against an artifact nobody has verified is a drill that measures the wrong thing.
3. **Decrypt** to a working file: `npm run evidence:decrypt -- --manifest <m> --file <artifact> --out restore.dump`. Passing the manifest is what makes it check the plaintext before writing.
4. **`pg_restore`** into a database that is **not** this environment's, and not production. ADR-0021's residency rule binds this: a restored snapshot may not be loaded into a Replit development database.
5. **Replay the Erasure Journal**, so data erased before the snapshot does not come back alive. **This step cannot be performed today** — the Erasure Journal exists in ADR-0015 and ADR-0016 and in no code or migration in this repository. A drill run before it exists is a restore drill and not the compliance evidence ADR-0016 describes, and should be recorded as the former.
6. **Verify the schema** against the journal: `npm run db:verify`.
7. **Record** the elapsed time against ADR-0016's RTO of four hours.

## The drills, scheduled and not run

ADR-0016 asks for two, and #57 says to schedule them rather than run them here.

| Drill | Cadence | What it proves | First due |
| --- | --- | --- | --- |
| Timed restore with Erasure Journal replay, recorded in-repo | Quarterly | The RTO of four hours is real, and erased data stays erased | *(unscheduled — and step 5 above is unbuildable until the Erasure Journal exists)* |
| Restore-from-export independence drill | Annually | The environment can be rebuilt from the evidence account alone, with no Replit involvement | *(unscheduled)* |

## What is still open

Nothing here is repository work. Every row needs an AWS account that does not exist yet.

| | |
| --- | --- |
| AWS account created, standalone, fresh credentials (ADR-0018) | *(unrecorded — none exists)* |
| S3 bucket in Frankfurt, Object Lock **enabled at creation** | *(unrecorded — Object Lock cannot be turned on for an existing bucket, so this is decided once)* |
| Default retention mode and period | *(undecided — see [Retention is a one-way door](#retention-is-a-one-way-door))* |
| `EVIDENCE_EXPORT_KEY` generated, and escrowed somewhere that survives losing this environment | *(unrecorded)* |
| Where the nightly job runs | *(undecided)* |
| `pg_dump` available there, at a compatible version | *(unrecorded)* |
| **One export completes and lands in the bucket** | *(unrecorded — acceptance)* |
| **Delete of a locked object fails, demonstrated and recorded** | *(unrecorded — acceptance)* |
| **Overwrite of a locked object fails, demonstrated and recorded** | *(unrecorded — acceptance)* |
| **Backup credentials shown scoped to that account only** | *(unrecorded — acceptance)* |
| Spend alert covering the new AWS bill | *(unrecorded — [#58](https://github.com/Lamakira/docuflow/issues/58) carries per-provider alerts, and its ticket predates this account)* |

The two demonstrations are the rows worth insisting on. An Object Lock configuration that has only ever been seen accepting a write has not been shown to refuse one, and refusing is the entire property being bought.
