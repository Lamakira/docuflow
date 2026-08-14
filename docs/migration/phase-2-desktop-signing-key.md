# The desktop signing key

- **Recorded:** 2026-08-14
- **Ticket:** [#56](https://github.com/Lamakira/docuflow/issues/56), carrying Phase 1 gate **G9** reassigned to Phase 2 by [ADR-0020](../adr/0020-reassign-the-deployment-observable-phase-1-gates-to-phase-2.md).
- **The ticket says Render; the host is Replit.** [ADR-0021](../adr/0021-run-the-compute-on-replit-and-supersede-the-render-hosting-decision.md) superseded ADR-0016 on the compute plane after #56 was written, so "the correct Render environment group per ADR-0015 secret tiers" reads, on this platform, as **Replit Secrets, per project and per environment**. ADR-0015's tiering is unchanged and is what the two-pane arrangement below satisfies. Read the ticket for its key requirements, not for its host.
- **Status:** procedure, runbook, and attestation shape documented. **Every deployed-environment observation is unrecorded** — see [What is still open](#what-is-still-open). Nothing here closes G9.

## What the repository already proves, and what it cannot

[Issue #23](https://github.com/Lamakira/docuflow/issues/23) / [PR #32](https://github.com/Lamakira/docuflow/pull/32) removed the generated fallback and pinned the behaviour in tests. That work is done and this ticket adds no code to it:

| Behaviour | Where it lives | Where it is pinned |
| --- | --- | --- |
| `<key-id>:<secret>` parsing, id pattern, 32-character secret floor | [`server/signingKeys.ts`](../../server/signingKeys.ts) | [`tests/smoke/config.test.ts`](../../tests/smoke/config.test.ts) |
| Boot refusal on an absent, malformed, or too-short key, and on a pair naming one id twice | [`server/config.ts`](../../server/config.ts) | [`tests/smoke/config.test.ts`](../../tests/smoke/config.test.ts) |
| Every issued token carries the signing key's id as `kid`; both keys verify during overlap; the retired key stops verifying once cleared | [`server/desktopTokens.ts`](../../server/desktopTokens.ts) | [`tests/smoke/desktop-tokens.test.ts`](../../tests/smoke/desktop-tokens.test.ts) |

What none of it proves is the thing G9 asks for. A test boots a module with a key it just made up; **persistence is the property that the key an operator set is still the key the process reads after that process is gone**, and no test can observe that because no test outlives a deployment. The repository-observable half of G9 has been closed since PR #32. The half that remains is entirely an observation about a running environment, and it is the only reason this ticket is open.

## What must never enter this record

ADR-0015's rule and the ticket's acceptance both say it: the attestation records the fact without the material. Concretely, for this key:

**Never recorded.** The secret half of `JWT_SECRET` or `JWT_PREVIOUS_SECRET`; any HMAC; **any whole access token**. That last one is easy to get wrong, because a token looks like evidence — it names the key and carries a timestamp. Its third segment is an HMAC of the first two under the secret, which is material derived from the secret, and the whole token is a live bearer credential for an hour besides. Paste a token into an attestation and the attestation is now the credential.

**Safe to record.** The key **id** — the half before the colon — which is not a secret and never was: it rides in the clear in the `kid` header of every token that key signs, which is the entire reason it exists. Timestamps. HTTP status codes. The `desktop tokens on key …` clause of the boot line, which [`server/config.ts`](../../server/config.ts) prints by id and never by secret.

## Provisioning

The key is generated for this environment and exists nowhere else. ADR-0018 forbids a production value here, and the isolation is not only about secrecy: a key shared with production would make a rotation exercise in this environment a fleet-wide sign-out in that one.

```bash
echo "$(date -u +%Y-%m):$(openssl rand -hex 32)"    # e.g. 2026-08:<64 hex characters>
```

The `YYYY-MM` id convention is what [`docs/CONFIGURATION.md`](../CONFIGURATION.md#desktop-access-token-signing-keys) and [`.env.example`](../../.env.example) already use. Any short printable string works — letters, digits, `.`, `-`, `_` — but a date is what makes two ids sort into the order they were introduced, which is what a rotation record is read for.

Where it goes, and the part that is not one place:

- **The parallel project only.** The Replit App is `docuflow`; production is a different App named `Techma documentation platform`. Confirmed separate on 2026-08-13 in [`phase-2-deployments-and-databases.md`](phase-2-deployments-and-databases.md#the-publish-record). Nothing is copied between them in either direction.
- **Two panes, both required.** The workspace's Secrets and the Publishing tool's **Deployment secrets** are separate stores — observed 2026-08-13. That separation *is* ADR-0015's per-environment scoping, and its consequence is that **setting a variable in the workspace proves nothing about the published app.** The workspace's `JWT_SECRET` was generated on 2026-08-13; whether the published environment has one, and whether it is a different one, is unrecorded below.
- **Not in `.replit`.** That file is in the repository. It may hold `PORT`, `DB_DRIVER`, and the bucket roots; it may never hold a secret.
- **Not in a workspace `.env`.** A git-ignored `.env` does not travel to the published environment — the deployment reads Secrets and `.replit` and nothing else.

## What "restart" means on an Autoscale deployment

This is the part the attestation has to get right, and the part a Render-shaped ticket did not have to think about.

[`.replit`](../../.replit) sets `deploymentTarget = "autoscale"`. Autoscale instances are request-driven: they start on demand, there may be several at once, and they go away when traffic does. [`server/config.ts`](../../server/config.ts) resolves the environment **once at module load** and freezes it, so an instance holds whatever the Secrets said at the moment it started, for the whole of its life.

Three things follow, and they are why "restart the service and confirm tokens still verify" is not one observation:

- **A configuration change does not reach a running instance.** It reaches the next instance to start. Changing a Secret and immediately curling the app can hit an instance that started before the change and prove nothing.
- **There is no single before-and-after.** During a rotation the fleet can hold two configurations at the same time — one instance minting under the new key, another still minting under the old one. That is not a fault; it is why [`docs/CONFIGURATION.md`](../CONFIGURATION.md#rotating-the-key) counts the overlap window from the **last** instance to pick the new value up rather than from the first.
- **An attestation must therefore say which restart it observed and how the instance was identified**, or it is a sentence about an unspecified process. Read the boot line rather than inferring from a 200.

The corollary for the rotation runbook: the hour of overlap does not start when `JWT_PREVIOUS_SECRET` is set. It starts when the last instance that was minting under the old key has gone.

## The probe

`GET /api/agent/capabilities` ([`server/agentRoutes.ts`](../../server/agentRoutes.ts)) is the cheapest honest question to ask of a token. It is authenticated by `isAgentAuthenticated`, returns `{"requiresTask":…}`, and changes nothing.

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" \
  "$APP_URL/api/agent/capabilities"
```

Read the status precisely, because three of them mean different things and only one is about the key:

| Status | What it says |
| --- | --- |
| `200` | The signature verified against a key this instance holds, the token has not expired, and the device is live. **This is the verification result the attestation wants.** |
| `401` | Either the signature did not verify against any key this instance holds, or the token has expired. An hour-old token gives the same 401 as a wrong key — so record the issue time, or the attestation cannot tell a key failure from a clock. |
| `403` | The signature verified and the **device** is revoked. A pass for the purposes of this attestation, and worth not mistaking for a failure. |
| `500` | The device lookup hit the database. Says nothing about the key. |

The token itself comes from `POST /api/agent/auth/login` with a synthetic account, or from `POST /api/agent/auth/refresh` with a paired device's token. Both mint under the instance's current key. Keep the token in a shell variable for the length of the exercise and out of the record.

To read the id a token names without trusting the server's own report of it — the header is the first dot-separated segment, base64url, and contains no secret material:

```bash
node -e 'console.log(Buffer.from(process.argv[1].split(".")[0], "base64url").toString())' "$TOKEN"
# {"alg":"HS256","typ":"JWT","kid":"2026-08"}
```

`base64url` rather than a `base64 -d` pipeline because JWT segments carry no
padding, which GNU `base64` refuses outright — a decoder that silently prints
nothing is the wrong tool for reading the one field this attestation turns on.

## The restart attestation

1. Confirm the published app is serving and read its boot line. Record the `desktop tokens on key …` clause — that is the key id before.
2. Mint a token. Record the issue time (UTC) and the `kid` from its header. Do not record the token.
3. Restart. Record **what was done** — a redeploy, or an idle-scale-down followed by a cold start — because the two are different events with the same symptom.
4. Read the new instance's boot line. Record the key id after. It should equal the id before: this step is about the key surviving, not changing.
5. Present the token from step 2. Record the status.

| | |
| --- | --- |
| Key id before restart, from the boot line | *(unrecorded)* |
| Token minted at (UTC), and the `kid` it carries | *(unrecorded)* |
| Restart mechanism | *(unrecorded — redeploy or cold start; they are not the same event)* |
| Restart timestamp (UTC) | *(unrecorded)* |
| Key id after restart, from the boot line | *(unrecorded)* |
| Pre-restart token presented after the restart | *(unrecorded — `200` is the pass)* |
| Time between mint and probe | *(unrecorded — must be under an hour, or a `401` is the TTL and not the key)* |

**A failure here has one likely cause and it is worth naming in advance.** If the id after differs from the id before, the published environment did not have `JWT_SECRET` in its Deployment secrets and something else supplied one — which, given that boot refuses an absent key, would mean the value came from a place this record has not accounted for. That is a finding, not a retry.

## The rotation attestation

The three steps are [`docs/CONFIGURATION.md`](../CONFIGURATION.md#rotating-the-key)'s and are unchanged. What this environment adds is where the values live and how long "wait" is.

1. **Introduce.** In the **Deployment secrets** pane: move the current `JWT_SECRET` verbatim into `JWT_PREVIOUS_SECRET`, and put the new `<new-id>:<new-secret>` in `JWT_SECRET`. The two ids must differ; boot refuses a pair that names one id twice. Redeploy.
2. **Wait.** One access-token lifetime — an hour — counted from the moment the **last** instance holding the old-only configuration has gone, not from the redeploy. On Autoscale that is a claim about instance lifetime, so record how it was established rather than assuming the redeploy replaced everything at once.
3. **Retire.** Clear `JWT_PREVIOUS_SECRET`. Redeploy. The old key's tokens stop verifying, which is the point.

Probe at each step with a token minted before it.

| | |
| --- | --- |
| Outgoing key id | *(unrecorded)* |
| Incoming key id | *(unrecorded)* |
| Introduce — timestamp (UTC) | *(unrecorded)* |
| Boot line during overlap | *(unrecorded — expect `key <new>, retiring <old>`)* |
| Token minted under the outgoing key, presented during overlap | *(unrecorded — `200` is the pass; this is the criterion "old-version tokens still verify")* |
| `kid` on a token minted during overlap | *(unrecorded — expect the incoming id; this is "new tokens carry the new version")* |
| How the last old-configuration instance was established to be gone | *(unrecorded)* |
| Retire — timestamp (UTC) | *(unrecorded)* |
| Boot line after retirement | *(unrecorded — expect the incoming id alone)* |
| Token minted under the outgoing key, presented after retirement | *(unrecorded — `401` is the pass)* |

That last row is the one worth exercising rather than assuming. A rotation shown only to keep old tokens working has not been shown to end.

## Startup refusal in the deployed environment

The refusal is pinned in [`tests/smoke/config.test.ts`](../../tests/smoke/config.test.ts) and was seen to fire in the **development workspace** on 2026-08-13, where the app would not start until a `JWT_SECRET` was supplied. Neither is the deployed observation the ticket asks for.

Confirming it in the published environment means deliberately publishing a broken configuration, and the cost of that is not known here. Two things are true and one is not:

- The refusal happens at **run**, not at build. [`.replit`](../../.replit)'s Build command is `npm run build && node dist/migrate.mjs`, and the migration runner needs `DATABASE_URL` rather than `JWT_SECRET` — so a deliberately broken key builds cleanly and fails when the instance starts.
- The failure is therefore a failing deployment rather than a failing build, which is a different log to read and a different thing to recover from.
- **Whether the previously published version keeps serving while the broken one fails to start is unrecorded**, and it decides whether this is a safe exercise or an outage. ADR-0021 records that a published Replit app is rolled back by rolling the project to an earlier checkpoint and publishing again — not by redeploying a prior image — which is a reason to establish the answer before rather than after.

| | |
| --- | --- |
| Absent `JWT_SECRET` refused in the deployed environment | *(unrecorded)* |
| Malformed `JWT_SECRET` refused in the deployed environment | *(unrecorded)* |
| The message names the variable | *(unrecorded — [`tests/smoke/config.test.ts`](../../tests/smoke/config.test.ts) pins that it does)* |
| What the deployment did while refusing | *(unrecorded — kept serving the previous version, or went down)* |
| Recovery step and how long it took | *(unrecorded)* |

Absent `JWT_SECRET` refused in the **development workspace**: **Yes** — 2026-08-13, recorded in [`phase-2-deployments-and-databases.md`](phase-2-deployments-and-databases.md#secrets-and-the-boot-refusal).

## What is still open

Every row above marked *(unrecorded)*, and nothing else. There is no repository work outstanding on G9 — the code, the tests, and the runbook are complete, and the gate is held open by observations that only a person with the Replit console can make.

| | |
| --- | --- |
| `JWT_SECRET` present in the published environment's Deployment secrets | *(unrecorded)* |
| Its value is distinct from production's | *(unrecorded — required by ADR-0018)* |
| Restart attestation | *(unrecorded)* |
| Rotation attestation | *(unrecorded)* |
| Deployed startup refusal | *(unrecorded)* |

Until those are filled, G9 stays **Partial** in [`phase-1-stabilization.md`](phase-1-stabilization.md#phase-1-gates), and this document is the procedure rather than the proof.
