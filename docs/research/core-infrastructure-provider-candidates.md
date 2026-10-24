# Core infrastructure and SaaS provider candidates

**Research date:** 2026-08-05  
**Supports:** [GitHub issue #2](https://github.com/Lamakira/docuflow/issues/2) and the [backend architecture map](https://github.com/Lamakira/docuflow/issues/1)  
**Decision status:** research only; this document does not select the final architecture.

## Question and constraints

Which concrete providers are credible candidates for DocuFlow's authentication, relational database hosting, application deployment, object storage, background jobs, transactional email, billing, secrets, and observability?

The comparison applies the architecture-map constraints: a centrally operated multi-tenant cloud SaaS; one primary EU region with multi-zone resilience, encrypted backups and tested recovery; GDPR compliance with SOC 2/ISO 27001 readiness; incremental replacement of the production system; one backend for the web and desktop clients; public APIs and signed webhooks; and replaceable adapters where switching cost is meaningful.

Prices below are indicative public list prices observed on the research date, before tax, support, commitments, egress, and workload-specific extras. They are useful for comparing cost shape, not budgeting. Compliance claims are provider attestations, not a conclusion that DocuFlow becomes compliant by using them.

## Existing-system integration baseline

The current repository is a TypeScript Express application with Drizzle over PostgreSQL/Neon, server-side sessions and Passport/OpenID Connect, Google Cloud Storage, and Resend. This matters because PostgreSQL, containers, S3-compatible storage, OIDC, SMTP/email APIs, and OpenTelemetry are low-friction seams. Moving business authorization, Workspace ownership, subscriptions, or entitlements into provider-specific models would create a much deeper migration and lock-in boundary.

The strongest provider-neutral seams are therefore:

- application-owned `User`, `Workspace`, `Membership`, role/capability, subscription and entitlement records, linked to external provider IDs;
- ordinary PostgreSQL plus migrations and periodic portable logical backups;
- an S3-shaped object-store interface, with authorization kept in DocuFlow;
- an application outbox plus idempotent job handlers, even when a managed queue executes them;
- narrow adapters for identity, email, billing, secrets and telemetry export.

## Summary matrix

| Category | Primary candidates | Best-documented advantage | Main decision risk |
| --- | --- | --- | --- |
| Authentication | WorkOS AuthKit; Clerk; ZITADEL Cloud | AuthKit and Clerk model organizations/memberships; ZITADEL documents a Europe cloud region | External identity models must not become DocuFlow's authoritative Workspace/capability model; confirm contractual EU residency |
| PostgreSQL | AWS RDS/Aurora PostgreSQL; Neon; Supabase | AWS has the deepest multi-AZ/compliance controls; Neon minimizes current migration; Supabase bundles auth/storage and RLS | Operational burden vs platform coupling; validate RPO/RTO and backup export |
| App deployment | AWS ECS/Fargate; Render; Fly.io | AWS offers maximum control; Render is simplest coherent PaaS; Fly has many EU regions and portable Machines | AWS complexity vs PaaS resilience/control ceilings |
| Object storage | AWS S3; Cloudflare R2 EU; Backblaze B2 EU | S3 is the reference capability set; R2 has EU jurisdiction and no egress fee; B2 is inexpensive and S3-compatible | Lifecycle/versioning/event compatibility and cross-provider egress |
| Jobs | AWS SQS + EventBridge Scheduler; Trigger.dev; Upstash Workflow/QStash | AWS gives durable primitives; Trigger.dev gives long-running TypeScript workflows; Upstash is low-ops HTTP delivery | Data location, provider semantics, and workflow-code lock-in |
| Email | Amazon SES; Resend; Postmark (procurement fallback) | SES supports Frankfurt and low usage pricing; Resend is already integrated and developer-friendly | Resend stores account/email metadata in the US even when sending from Ireland |
| Billing | Stripe Billing; Paddle Billing | Stripe is composable and widely integrated; Paddle is merchant of record and absorbs tax/compliance operations | Stripe leaves merchant/tax operations to DocuFlow; Paddle costs more and changes legal/customer relationship |
| Secrets | AWS Secrets Manager; deployment-platform secrets; 1Password Secrets Automation | AWS supports IAM, rotation, audit and replication; platform-native secrets are simplest | Native PaaS secret stores may lack rotation/audit portability; another vendor adds operational surface |
| Observability | Grafana Cloud + Sentry; Better Stack; CloudWatch (+ Sentry) | Grafana supplies EU-hosted full telemetry; Sentry supplies application errors; Better Stack is an integrated EU-default option | Telemetry cost, PII leakage, overlapping tools, and retention controls |

## 1. Authentication

### WorkOS AuthKit

WorkOS is a close functional fit for future enterprise needs. Organizations and organization memberships are first-class and support many-to-many user membership, pending/active/inactive lifecycle, role information, SSO, Directory Sync and SCIM. Its session JWT can carry `org_id`, role and permission claims. AuthKit is publicly documented as free up to one million MAU, while live SSO and Directory Sync connections are separately billable ([users and organizations](https://workos.com/docs/authkit/users-organizations), [sessions](https://workos.com/docs/authkit/sessions), [environments and pricing shape](https://workos.com/docs/authkit/environments)).

**Fit:** excellent path to later enterprise SSO/SCIM and it resembles DocuFlow's membership lifecycle. **Complexity:** medium; hosted identity plus webhook reconciliation. **Lock-in:** high if DocuFlow delegates its authoritative roles, permissions or organization lifecycle. **Open procurement item:** the reviewed public documentation did not establish a selectable EU data-residency region for AuthKit; require a contractual answer, DPA/subprocessor review, deletion/retention details and outage/export procedure before selection.

### Clerk

Clerk explicitly supports optional personal accounts alongside organizations, unlimited organizations per user, an active organization, invitations, roles and permissions. That maps unusually well to DocuFlow's individual-or-organization Workspace and active Workspace UX. However, organizations without the B2B add-on have membership limits, and Clerk's own B2B Billing plans do not synchronize with existing Stripe products ([organization configuration and limits](https://clerk.com/docs/guides/organizations/configure), [organization management](https://clerk.com/docs/guides/organizations/create-and-manage), [B2B billing](https://clerk.com/docs/guides/billing/for-b2b)).

**Fit:** fastest hosted UX for individual/team switching. **Complexity:** low to medium. **Lock-in:** high if UI components, organization records and authorization all become authoritative. **Open procurement item:** as with WorkOS, confirm EU residency and contractual compliance scope rather than infer it from an EU-facing product.

### ZITADEL Cloud

ZITADEL offers OIDC/OAuth/SAML, service accounts, organizations and a documented Europe cloud region; its public pricing currently starts at $100/month for Pro with 25,000 daily active users and usage dimensions for identity providers, management API requests and audit history ([Europe region](https://zitadel.com/docs/guides/manage/cloud/egress), [pricing](https://zitadel.com/pricing/detail)). It also has a self-hostable codebase, although self-hosting is out of scope for DocuFlow.

**Fit:** strong standards and portability posture with explicit European hosting. **Complexity:** medium to high; more identity-system design and custom UX than Clerk. **Lock-in:** medium because standards and a self-hosted escape route reduce, but do not remove, migration cost.

### Authentication research conclusion

All three remain viable. WorkOS is the enterprise-identity specialist, Clerk is the closest individual/team product-model accelerator, and ZITADEL has the clearest residency/portability story. In every path, DocuFlow should own Workspace, Membership status, billable-seat rules and capability evaluation; the identity provider should authenticate identities and optionally supply enterprise federation signals.

## 2. Relational database hosting

### AWS RDS/Aurora PostgreSQL

RDS PostgreSQL offers PostgreSQL compatibility with Multi-AZ options, backups/PITR, replicas, IAM integration, encryption and region-scoped operation. AWS documents Multi-AZ PostgreSQL clusters in Frankfurt and Stockholm, and its GDPR program includes SCCs plus SOC and ISO attestations ([RDS regional features](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RegionsAndAvailabilityZones.html), [AWS GDPR center](https://aws.amazon.com/compliance/gdpr-center/)).

**Fit:** strongest control plane for the agreed EU multi-zone and compliance posture. **Complexity:** high; VPC, IAM, patching policy, parameter groups, alarms, capacity and cost management remain DocuFlow responsibilities. **Lock-in:** medium: SQL and `pg_dump` are portable, but Aurora-specific features, IAM auth and AWS networking are not. **Cost:** workload/configuration dependent; obtain a Frankfurt calculator estimate for at least primary + standby, storage, backups, proxy and transfer.

### Neon

Neon is the smallest migration from the existing `@neondatabase/serverless`/Drizzle integration. Its architecture preserves PostgreSQL semantics and adds autoscaling, branching and point-in-time restore. Public Launch pricing is usage based ($0.106/CU-hour and $0.35/GB-month, with a seven-day restore window); Scale adds longer restore, exportable telemetry, private networking and SLA/compliance features ([pricing](https://neon.com/pricing)).

**Fit:** lowest code churn and good development branching. **Complexity:** low. **Lock-in:** low to medium at SQL level, higher for scale-to-zero, branching and platform auth. **Open item:** verify exact EU project region, zone-failure architecture, backup export, contractual RPO/RTO and whether the chosen plan's SOC 2/SLA evidence satisfies the readiness target.

### Supabase Postgres

Supabase deploys each project to one primary region, including exact AWS EU regions such as Frankfurt, Paris, Ireland, Stockholm and Zurich. It bundles dedicated PostgreSQL, Auth, Storage, APIs, Realtime and functions. It is SOC 2 Type 2 compliant; public Pro pricing starts at $25/month with daily backups for seven days, while PITR is a material add-on (about $100/month for seven days at the published rate). ([regions](https://supabase.com/docs/guides/platform/regions), [security and SOC 2](https://supabase.com/docs/guides/security/soc-2-compliance), [pricing](https://supabase.com/pricing), [backups/PITR](https://supabase.com/docs/guides/platform/backups)).

**Fit:** high if the decision intentionally consolidates database, auth and file policy around PostgreSQL RLS. **Complexity:** low initially. **Lock-in:** medium: PostgreSQL data is portable, but Auth, Storage metadata, generated APIs and RLS-coupled client access deepen the platform seam. **Resilience caveat:** a single primary region plus backups is not by itself proof of multi-zone failover; validate the compute tier and recovery design.

### Database research conclusion

AWS is the control/resilience benchmark, Neon is the incremental-migration benchmark, and Supabase is the consolidation benchmark. The decision needs explicit RPO/RTO and capacity inputs. Regardless of provider, keep standard migrations, regular restore tests, encrypted independent logical exports, and tenant-isolation tests.

## 3. Application deployment

### AWS ECS on Fargate

ECS/Fargate runs ordinary containers in a VPC and can distribute services across availability zones. It composes directly with RDS, S3, SQS, Secrets Manager and CloudWatch. Fargate charges for allocated vCPU/memory/storage time rather than a fixed PaaS tier ([AWS Fargate decision guide](https://docs.aws.amazon.com/pdfs/decision-guides/latest/fargate-or-lambda/fargate-or-lambda.pdf), [AWS pricing approach](https://aws.amazon.com/pricing/)).

**Fit:** maximum alignment with single-EU-region/multi-AZ controls, background workers, private networking and auditability. **Complexity:** highest: IaC, load balancers, IAM, deployment pipelines, autoscaling, image registry, networking, patch policy and cost controls. **Lock-in:** medium; containers move, infrastructure definitions and managed-service integrations do not.

### Render

Render has a Frankfurt region, Docker/native web and private services, background workers, cron jobs, managed PostgreSQL, private networking, preview environments and declarative Blueprints. Region cannot currently be changed in place. Render Postgres HA uses an asynchronous standby on a geographically separate node in the same region, with automatic failover but possible loss of the latest few seconds of writes ([regions](https://render.com/docs/regions), [Blueprint specification](https://render.com/docs/blueprint-spec), [Postgres HA behavior](https://render.com/docs/postgresql-high-availability), [product/pricing surface](https://render.com/pricing)).

**Fit:** simplest coherent PaaS for the existing Node process and workers. **Complexity:** low. **Lock-in:** low for containerized apps, medium for Blueprints, environment groups and managed datastores. **Risk:** fewer knobs and a narrower regional topology than AWS; the documented asynchronous HA limitation must be reconciled with the eventual RPO.

### Fly.io

Fly Machines run containers/VMs in Amsterdam, Stockholm, Paris and Frankfurt among other regions. Small shared Machines start around $5.92/month for 1 GB RAM; EU public egress is listed at $0.02/GB. Machines and volumes are region-bound, and raw volumes are single-host storage that applications must replicate themselves ([regions](https://fly.io/docs/reference/regions/), [pricing](https://fly.io/docs/about/pricing/), [volume limitations](https://fly.io/docs/volumes/overview/)).

**Fit:** strong container portability and regional placement; useful for stateless API/workers. **Complexity:** medium. **Lock-in:** low to medium. **Risk:** avoid self-managed state on raw Fly Volumes for the authoritative database; managed Postgres or an external database requires separate resilience diligence.

### Deployment research conclusion

AWS is the control-heavy path; Render is the low-operations path; Fly is the portable edge-oriented path. The topology decision should price at least two API instances, two worker instances, load balancing, staging, deploy previews, logs, database HA and backups—not a single starter container.

## 4. Object storage

### Amazon S3

S3 is the reference interface and offers versioning, lifecycle policies, Object Lock, event notifications, KMS integration, audit logs and region selection. AWS documents encryption and fine-grained object-access logging within its GDPR/compliance program ([AWS GDPR center](https://aws.amazon.com/compliance/gdpr-center/)).

**Fit:** deepest controls and cleanest integration if compute is on AWS. **Complexity:** medium because bucket/IAM/KMS/lifecycle policies must be designed. **Lock-in:** low at basic API level, medium for events, Object Lock and IAM. **Cost:** storage is inexpensive but request classes, retrieval and internet/cross-cloud egress can dominate document-heavy workloads.

### Cloudflare R2

R2 is S3-compatible, offers an `eu` jurisdiction that guarantees objects are stored within the EU, and currently lists standard storage at $0.015/GB-month, Class A at $4.50/million, Class B at $0.36/million, with no direct R2 egress fee ([EU jurisdiction and limitations](https://developers.cloudflare.com/r2/reference/data-location/), [pricing](https://developers.cloudflare.com/r2/pricing/)).

**Fit:** attractive for document download/preview traffic and explicit EU storage. **Complexity:** low to medium. **Lock-in:** low at the S3 adapter, medium for Cloudflare-specific delivery/events. **Risk:** test every required S3 feature, signed upload, lifecycle, legal hold, virus-scan and event path; “S3-compatible” does not mean feature-identical.

### Backblaze B2

B2 provides an EU Central account region and an S3-compatible API. Its public price starts at $6.95/TB-month, with free egress up to three times average stored data and additional egress at $0.01/GB; Backblaze states SOC 2 Type 2 support ([regions](https://www.backblaze.com/docs/cloud-storage-data-regions), [pricing](https://www.backblaze.com/cloud-storage/pricing), [transaction/egress pricing](https://www.backblaze.com/cloud-storage/transaction-pricing), [compliance](https://www.backblaze.com/cloud-storage)).

**Fit:** low-cost document/archive candidate. **Complexity:** low. **Lock-in:** low through S3 compatibility. **Risk:** benchmark latency and validate notification, retention, key-management and audit requirements before using it for interactive document workflows.

### Storage research conclusion

All three support an S3-shaped seam, so portability is realistic. S3 is strongest on control breadth, R2 on EU jurisdiction plus egress economics, and B2 on simple storage economics. Do not use provider ACLs as the sole business-authorization model; authorize in DocuFlow and issue short-lived signed operations. Require object versioning/retention, malware scanning, immutable audit metadata and deletion workflows in the architecture decision.

## 5. Background jobs and schedules

### AWS SQS + EventBridge Scheduler

SQS supplies persistent pull queues; EventBridge supplies event routing/scheduling. AWS documents at-least-once delivery, FIFO ordering where required, retries and SQS dead-letter queues for failed schedules ([AWS messaging decision guide](https://docs.aws.amazon.com/pdfs/decision-guides/latest/sns-or-sqs-or-eventbridge/sns-or-sqs-or-eventbridge.pdf), [Scheduler DLQs](https://docs.aws.amazon.com/scheduler/latest/UserGuide/configuring-schedule-dlq.html)).

**Fit:** durable, region-local primitives for outbox consumers, email, webhooks, file processing and notifications. **Complexity:** medium to high; DocuFlow implements workers, idempotency, tracing, replay tooling and workflow state. **Lock-in:** medium at infrastructure/API level; application handlers stay portable.

### Trigger.dev

Trigger.dev provides TypeScript durable tasks, schedules, queues, retries, observability and long-running execution. Cloud pricing starts with free credits, Hobby at $10/month and Pro at $50/month plus compute/run usage. It allows execution in `eu-central-1`, but explicitly says the execution region does **not** change where payloads, outputs, tags or logs are stored ([pricing](https://trigger.dev/pricing), [region semantics](https://trigger.dev/docs/triggering), [limits](https://trigger.dev/docs/limits)).

**Fit:** excellent developer experience for document processing and multi-step workflows. **Complexity:** low. **Lock-in:** medium to high because task semantics and state live in the platform. **Residency risk:** execution in Frankfurt is insufficient for the EU-data constraint unless control-plane/payload storage is contractually acceptable.

### Upstash Workflow/QStash

QStash is HTTP-based messaging/scheduling with retries and delivery guarantees; Workflow adds durable steps. Usage-based Workflow is publicly priced at $1 per 100,000 steps, while its production pack with SLA/SOC 2/Prometheus/Datadog is $200/month. Published limits include concurrency, message size, log retention and DLQ retention ([overview](https://upstash.com/docs/qstash/overall/getstarted), [pricing and limits](https://upstash.com/pricing/workflow)).

**Fit:** low-ops scheduled HTTP jobs and webhook delivery. **Complexity:** low. **Lock-in:** medium; HTTP handlers remain portable, workflow step/state semantics do not. **Open item:** confirm processing/data regions and DPA for payloads before shortlist advancement.

### Jobs research conclusion

SQS/EventBridge is the safest primitive foundation when AWS is selected; Trigger.dev is the richest TypeScript workflow accelerator; QStash is the lightest HTTP-oriented option. Regardless of vendor, the architecture needs an application outbox, idempotency keys, deduplication, bounded retries, DLQs, replay authorization, tenant/workspace provenance and PII-minimized payloads.

## 6. Transactional email

### Amazon SES

SES has a Frankfurt endpoint and integrates with AWS IAM, events and monitoring. Current Essentials pricing is $0.16 per 1,000 messages for the first 10 million, plus outbound data; à-la-carte pricing remains documented as another option. AWS applies the shared-responsibility model and supports GDPR contractual mechanisms ([regional endpoints](https://docs.aws.amazon.com/general/latest/gr/ses.html), [pricing](https://aws.amazon.com/ses/pricing/), [data protection](https://docs.aws.amazon.com/ses/latest/dg/data-protection.html)).

**Fit:** low unit cost and strong regional integration. **Complexity:** medium because reputation, suppression, templates, event handling and deliverability tooling need more work. **Lock-in:** low behind an email adapter.

### Resend

Resend is already integrated. It supports sending from Ireland, is SOC 2 Type II/GDPR aligned and has a DPA, but documents that account data, email metadata, logs and API records remain stored in the US regardless of sending region. The free tier is 3,000 transactional emails/month with a 100/day cap; paid quotas and overage apply ([region and residency semantics](https://resend.com/docs/dashboard/domains/regions), [security](https://resend.com/docs/security), [quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits)).

**Fit:** lowest migration and good developer experience. **Complexity:** low. **Lock-in:** low through a narrow adapter. **Risk:** US metadata storage needs a documented transfer assessment and a strict no-sensitive-content policy; EU dispatch is not EU residency.

### Postmark procurement fallback

Postmark is a mature transactional-email specialist and can remain a procurement comparison for deliverability/support. Its public pricing is monthly-volume based with overages ([pricing FAQ](https://postmarkapp.com/support/article/1285-pricing-billing-faq)). The reviewed sources did not establish an EU-resident data plane, so it should not advance without explicit DPA, subprocessor, location and retention evidence.

### Email research conclusion

SES is the regional/control candidate; Resend is the incremental/developer-experience candidate. Keep templates and delivery-event state in DocuFlow, include workspace provenance in internal events, never place document/activity content in email unless required, and process provider webhooks idempotently.

## 7. Subscription billing

### Stripe Billing

Stripe Billing supports subscriptions, invoices, hosted checkout/customer portal, schedules, usage meters and webhooks. In France/Euro pricing, standard EEA cards are listed at 1.5% + €0.25 and Billing pay-as-you-go at 0.7% of Billing volume ([France payments pricing](https://stripe.com/en-fr/pricing), [Billing pricing](https://stripe.com/es/billing/pricing), [Billing capabilities](https://docs.stripe.com/billing)).

**Fit:** strong API ecosystem and a natural source for payment/subscription facts while DocuFlow owns entitlements and billable-seat calculations. **Complexity:** medium; DocuFlow remains merchant, handles tax configuration/accounting obligations, webhook reconciliation and support. **Lock-in:** medium because subscription history and payment methods are difficult to migrate, although local mirrors and adapters help.

### Paddle Billing

Paddle acts as merchant of record, taking responsibility for payments, tax collection/filing, fraud and chargebacks. Public pay-as-you-go pricing is 5% + $0.50 per checkout transaction. Paddle supplies subscription lifecycle webhooks and recommends keeping a local subscription database updated from them; it states SOC 2 Type 2 and GDPR support ([pricing and merchant services](https://www.paddle.com/pricing), [provisioning via webhooks](https://developer.paddle.com/build/subscriptions/provision-access-webhooks/), [GDPR/MoR role](https://www.paddle.com/legal/gdpr), [SOC 2](https://www.paddle.com/legal/soc-2-compliance)).

**Fit:** substantially lowers international tax/compliance operations. **Complexity:** lower operationally, but merchant-of-record customer/legal flows must be accepted by product and finance. **Lock-in:** high: Paddle is the reseller and controls more of the buyer/subscription relationship. **Cost:** materially higher percentage at modest ticket sizes, partly purchasing tax/fraud/support operations.

### Billing research conclusion

This is a business-model decision as much as an engineering choice. Stripe is the composable PSP/Billing path; Paddle is the MoR path. In either case, provider state is not the authorization check: persist a webhook-driven local subscription projection, calculate Billable Seats from accepted active Memberships, derive entitlements deterministically, verify signatures, make event handling idempotent and provide reconciliation jobs.

## 8. Secrets management

### AWS Secrets Manager

Secrets Manager encrypts and audits secrets, supports fine-grained IAM, automatic rotation and cross-region replication. It has a 99.99% regional SLA; usage has no minimum, while secrets, API calls, optional KMS keys and Lambda-based rotation are metered ([product capabilities](https://aws.amazon.com/secrets-manager/), [rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html), [pricing model and audit](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html), [SLA](https://aws.amazon.com/about-aws/whats-new/2023/12/aws-secrets-manager-service-level-agreement/)).

**Fit:** strongest if AWS hosts workloads; workload identity avoids static deploy credentials. **Complexity:** medium. **Lock-in:** medium through IAM/rotation integration.

### Deployment-platform secrets

Render, as the representative PaaS candidate, supports encrypted environment variables, secret files and reusable environment groups; Blueprints can declare placeholders without committing values. Changes can trigger deployments, and Docker build secrets require care to avoid image-layer exposure ([Render secret configuration](https://render.com/docs/configure-environment-variables), [Docker secret guidance](https://render.com/docs/docker-secrets)).

**Fit:** simplest early-stage operations. **Complexity:** low. **Lock-in:** medium because access/audit/rotation behavior follows the deployment platform. **Risk:** verify least-privilege access, access logs, version history, rotation without restart, break-glass and CI federation before treating PaaS environment variables as the sole production vault.

### 1Password Secrets Automation

1Password supplies service accounts, CLI/CI integrations, secret references, Connect and automated synchronization into deployment platforms ([Secrets Automation overview](https://1password.com/developers/secrets-management)).

**Fit:** useful if the team already uses 1Password and workloads span providers. **Complexity:** medium because it adds another production dependency/sync path. **Lock-in:** medium. **Open item:** obtain plan pricing, EU account/data-residency details, SLA, rotation and audit evidence during procurement.

### Secrets research conclusion

Prefer cloud-native workload identity plus a regional managed vault when the deployment provider supports it. PaaS-native secrets are acceptable only after the control gaps are tested. Never copy one long-lived master credential across web, worker, desktop integration and CI; define separate identities, scopes, rotation and emergency revocation.

## 9. Observability

### Grafana Cloud plus Sentry

Grafana Cloud provides managed metrics, logs, traces and profiles using OpenTelemetry/Prometheus-compatible interfaces. It offers EU Germany (`eu-central-1`) and other EU stacks and states SOC 2, ISO 27001 and GDPR coverage. Free includes limited usage; Pro starts at $19/month plus usage with 30-day logs/traces and 13-month metrics retention. Sentry adds purpose-built application error/performance diagnosis and allows even free organizations to store data in Germany ([Grafana regions](https://grafana.com/docs/grafana-cloud/security-and-account-management/regional-availability/), [Grafana compliance](https://grafana.com/docs/learning-hub/which-grafana/02-understand-your-options/10-data-residency-and-compliance/), [Grafana pricing](https://grafana.com/pricing/), [Sentry Germany residency](https://sentry.io/changelog/data-storage-location-in-germany-is-generally-available/)).

**Fit:** strongest open-protocol, full-signal path; Sentry is valuable for web/desktop exception workflows. **Complexity:** medium because two vendors can overlap on traces and alerts. **Lock-in:** low to medium when OpenTelemetry is the only instrumentation boundary; higher for Sentry-specific workflows.

### Better Stack

Better Stack combines logs, traces, metrics, errors, uptime, heartbeats, on-call and status pages. It says data is EU-hosted by default, with Germany selectable, and states SOC 2 Type 2/GDPR support. The free tier includes small telemetry allowances; a current telemetry bundle starts around $30/month monthly for 40 GB each of logs/traces/metrics, while pay-as-you-go logs/traces list $0.10/GB ingestion plus retention ([pricing, residency and controls](https://betterstack.com/pricing), [Germany region and own-bucket option](https://betterstack.com/community/blog/changelog-9-advanced-data-options-for-everyone/)).

**Fit:** low-operations unified stack and simple EU posture. **Complexity:** low. **Lock-in:** medium, reduced by Sentry SDK and standard telemetry support. **Risk:** validate query model, high-cardinality costs, audit-log price, PII controls and desktop crash-symbol handling.

### AWS CloudWatch plus Sentry

CloudWatch natively aggregates AWS logs, metrics, alarms and service telemetry; most AWS services emit basic metrics automatically. Pricing is granular/pay-as-you-go and includes a small free allocation, but AWS warns the structure varies by ingestion, storage, queries, alarms and other features ([features](https://aws.amazon.com/cloudwatch/features/), [pricing](https://aws.amazon.com/cloudwatch/pricing/)). Pairing Sentry retains a better application-error workflow and EU-hosted error data.

**Fit:** simplest infrastructure telemetry when all hosting is AWS. **Complexity:** medium; dashboards/query experience and cost controls require deliberate design. **Lock-in:** high if instrumentation targets CloudWatch APIs directly, lower if applications emit OpenTelemetry.

### Observability research conclusion

Instrument once with OpenTelemetry and structured, PII-minimized events; route through a collector so vendors remain replaceable. Grafana+Sentry is the open-protocol/full-depth path, Better Stack the consolidated path, and CloudWatch+Sentry the AWS-native path. None replaces an application audit log: product/security audit records require their own immutable schema, retention and access policy.

## Coherent bundles for later decision sessions

These are comparison frames, not recommendations:

| Bundle | Components | Operational profile | Principal trade-off |
| --- | --- | --- | --- |
| AWS-centered control | WorkOS/Clerk/ZITADEL; ECS/Fargate; RDS PostgreSQL; S3; SQS/EventBridge; SES; Stripe/Paddle; Secrets Manager; CloudWatch + Sentry | Highest control and clearest multi-AZ composition; highest platform-engineering load | Compliance/resilience depth versus complexity and AWS coupling |
| PaaS incremental | WorkOS/Clerk/ZITADEL; Render; Neon; R2/B2/S3; Render workers or QStash; Resend; Stripe/Paddle; PaaS secrets; Better Stack/Sentry | Lowest migration effort and fastest delivery | Several vendors, weaker unified IAM/networking, more contractual residency checks |
| Postgres platform consolidation | Supabase DB/Auth/Storage with Render/Fly compute; managed workflow/email/billing; Grafana/Sentry | Small team can operate broad capabilities quickly | Deep coupling across identity, file policy, APIs and RLS; resilience tier must be verified |

## Cross-cutting findings and decision gates

1. **The primary hosting/database choice is the root decision.** It determines whether native AWS services reduce complexity or whether best-of-breed SaaS avoids an oversized platform team.
2. **EU region labels are not equivalent.** Execution, primary data, account metadata, logs, backups, support access and subprocessors can reside differently. Resend and Trigger.dev explicitly demonstrate this distinction.
3. **Multi-zone cannot be inferred from “managed.”** Require written topology, RPO/RTO, failover behavior and restore-test evidence for the exact plan.
4. **Compliance is shared responsibility.** Obtain DPA/SCCs, subprocessor list, deletion/retention commitments, breach terms, audit reports and data-flow diagrams for every processor.
5. **Keep business authority local.** Workspace, Membership, capability, Billable Seat and entitlement truth belongs in DocuFlow, reconciled from identity/billing events rather than delegated wholesale.
6. **Outbox and idempotency are provider-independent requirements.** Billing, identity, email and public webhook delivery all require signed events, deduplication, replay and observable reconciliation.
7. **Open interfaces meaningfully reduce replacement cost.** Standard PostgreSQL, OIDC, S3, containers, SMTP/email adapters and OpenTelemetry are worthwhile even when a concrete provider is chosen.

Before a final provider ADR, collect:

- expected monthly active users, Workspaces, seats, database size/IOPS/connections, document storage/download, job volume/duration, emails, billing volume, and telemetry ingestion;
- target availability/SLO, RPO, RTO, retention and deletion schedules;
- current production region/provider/account constraints and a complete migration inventory;
- procurement answers for EU processing locations, DPAs/SCCs, subprocessors, audit-report access, SLAs, export/deletion and support access;
- three workload-based total-cost estimates: launch, 10× and 100×, including HA, staging, support, backups, egress and observability.

## Research disposition

No category has a single winner without the unresolved service-topology, RPO/RTO, workload and merchant-of-record decisions. The candidate set is narrow enough for the architecture tickets to make explicit choices without repeating broad provider discovery. Provider facts and prices should be revalidated during each ADR because cloud capabilities and pricing change frequently.
