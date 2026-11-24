# Production rollout and recovery

This release changes the data authority. Deploy the backend, migrate verified data,
then switch the frontend and rules together in a maintenance window. Do not deploy
only the deny-all rules while an old frontend still writes Firestore directly.

## Runtime and secrets

Use Node 22.9 or newer. `npm run check:local` builds without live secrets. Java 21
is needed only for `npm run test:emulator`.

| Variable | Where | Purpose |
| --- | --- | --- |
| `NODE_ENV=production` | Backend | Enforces durable Firestore and required configuration |
| `SYNDIK_STATE_BACKEND=firestore` | Backend | Required durable Firestore state adapter; local `file` mode is refused in production |
| `SYNDIK_UPLOAD_BACKEND=gcs` | Backend | Required private Cloud Storage upload adapter; local disk uploads are refused in production |
| `SYNDIK_SERVER_SECRET` | Backend secret store | At least 32 random characters, stable across instances; legacy session HMAC fallback and v1 encrypted records |
| `SYNDIK_SESSION_SECRET` | Backend secret store | Optional dedicated session HMAC signing key (at least 32 random characters, distinct from other secrets); falls back to `SYNDIK_SERVER_SECRET` |
| `SYNDIK_ENCRYPTION_KEYS` | Backend secret store | Required JSON keyring (`{"primary":{"kid":"enc-v2","key":"<32+ random chars>"},"retired":[]}`) for durable AES-GCM records; primary key must differ from signing secrets |
| `PUBLIC_APP_URL` | Backend | Exact public HTTPS origin, used for recovery links |
| `FIRESTORE_DATABASE_ID` | Backend | Exact named database in `deploy/target.json`; production rejects `(default)` |
| `GOOGLE_CLOUD_PROJECT` | Backend and migration job | Explicit staging/production project |
| `SYNDIK_UPLOAD_BUCKET` | Backend | Private Cloud Storage bucket for uploads |
| `SYNDIK_AUTH_PROVIDER` | Backend | Explicitly `firebase` in production; `legacy` is for nonproduction tests only |
| `FIREBASE_API_KEY` | Backend | Optional Firebase Web API key override; defaults to the checked-in Firebase app configuration |
| `SENDGRID_API_KEY` | Backend secret store | Optional legacy/general-purpose transactional email credential; unnecessary for Firebase account emails |
| `SENDGRID_FROM_EMAIL` | Backend | Optional verified sender for SendGrid only |
| `SYNDIK_SCHEDULER_SECRET` | Backend and Functions secret stores | Separate random secret, at least 32 characters |
| `SYNDIK_BACKEND_URL` | Functions | Public HTTPS backend origin |
| `SYNDIK_BOOTSTRAP_ADMIN_EMAIL` | Backend | Optional exact email of a verified Google account allowed to bootstrap platform administration |
| `SYNDIK_BACKUP_KEY` | Operator secret store | Separate backup encryption key, at least 32 random characters; required only for backup/restore |
| `TRUST_PROXY_HOPS` | Backend | Exact trusted reverse-proxy hop count; zero by default |
| `CSP_MODE` | Backend | Optional Content-Security-Policy mode: `report-only` (default) or `enforce` |

Use workload identity/application default credentials for the runtime service
account. Grant access only to the intended Firestore database and private upload
bucket. No service account key belongs in a frontend variable. Public Firebase web
configuration is separate from backend secrets. All instances must share the same
server and scheduler secrets. Rotate the server secret during a planned window:
existing sessions and unsent encrypted outbox bodies depend on it.

Bind `SYNDIK_SCHEDULER_SECRET` to the scheduled Functions with `firebase functions:secrets:set SYNDIK_SCHEDULER_SECRET`; the source declares that secret for each job. Set the nonsecret backend origin in the Functions environment.

The file adapter is for development and synthetic tests. Production requires explicit
`SYNDIK_STATE_BACKEND=firestore` and `SYNDIK_UPLOAD_BACKEND=gcs`; no fallback is allowed.
`/api/health` is a liveness probe; `/api/ready` also reads the configured database.
Provision a minimum of one instance if required for acceptable cold-start latency.
The supplied Dockerfile builds the frontend and compiled backend; it does not
include developer credentials or local data.

## Cloud Run startup and container verification

The canonical service is `buildmanage` in `europe-west1`, project `immogest-7faaf`.
Use [the production contract](docs/deployment-contract.md) and
[the runtime manifest](deploy/runtime.env.example) for the complete required settings.
A port timeout can mean the process exited before listening. Inspect the first
application error for `PRODUCTION_CONFIG_INVALID`; increasing the timeout will
not fix missing configuration. The server already binds `0.0.0.0` and honors `PORT`.

Keep existing stable secrets and Secret Manager bindings. GitHub build secrets and
frontend `VITE_*` variables do not configure Cloud Run runtime settings. Do not
regenerate the server encryption/session secret to fix a startup failure.
Use the Dockerfile command `node dist-server/server.js`; remove obsolete overrides.
`/api/health` confirms HTTP liveness; `/api/ready` checks database readiness.

After `npm ci && npm run build`, run `npm run test:startup` for compiled health and
frontend HTTP checks on ports 3000 and 31847. `npm run test:container` builds and
starts the actual runtime-only Docker image on both ports with networking disabled.
Both use disposable random secrets and no credentials. These tests do not establish
production IAM, database readiness, bucket access or email delivery. CI runs both.

## Troubleshooting a failed revision

When `server/productionConfig.ts` rejects the runtime environment at the start of
`startServer()`, the container exits with code `1` before opening the HTTP listener.
Cloud Run surfaces that symptom generically as:
`container failed to start and listen on PORT=8080`.

Before exiting, the process writes one structured JSON line to `stderr` with
`severity: "ERROR"`, `event: "production_config_invalid"`, `fields: [...]`, and
`message: "PRODUCTION_CONFIG_INVALID: ..."`. Non-secret target/mode fields report
`expected X, got Y`; secret and keyring values are never logged.

### Finding the failure in Cloud Logging

Filter Cloud Logging by the structured event on the Cloud Run service:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="buildmanage"
resource.labels.location="europe-west1"
jsonPayload.event="production_config_invalid"
```

### Operator `gcloud` commands

Run these read-only commands from an authorized workstation to inspect the
deployed service name, environment bindings, and revision error logs (secret
bindings appear as `secretKeyRef` names/versions rather than secret values):

```bash
# 1. List Cloud Run services in europe-west1 (verify canonical service name is buildmanage)
gcloud run services list \
  --project=immogest-7faaf \
  --region=europe-west1

# 2. Describe revision status, plain env vars, and Secret Manager bindings
gcloud run services describe buildmanage \
  --project=immogest-7faaf \
  --region=europe-west1 \
  --format="yaml(status.latestCreatedRevisionName,status.latestReadyRevisionName,status.conditions,spec.template.spec.containers[0].env)"

# 3. Read structured startup validation errors and container ERROR logs
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="buildmanage" AND resource.labels.location="europe-west1" AND (jsonPayload.event="production_config_invalid" OR severity>=ERROR)' \
  --project=immogest-7faaf \
  --limit=20 \
  --format="table(timestamp,resource.labels.revision_name,jsonPayload.event,jsonPayload.fields,jsonPayload.message,textPayload)"
```

### Field-by-field checklist

| Field in `fields` | What to check |
| --- | --- |
| `NODE_ENV` | Must equal `production` (set in `Dockerfile`; remove any override setting another value). |
| `SYNDIK_STATE_BACKEND` | Must equal `firestore`. |
| `SYNDIK_UPLOAD_BACKEND` | Must equal `gcs`. |
| `SYNDIK_AUTH_PROVIDER` | Must equal `firebase`. |
| `GOOGLE_CLOUD_PROJECT` | Must be explicitly set to `immogest-7faaf` (`deploy/target.json` `projectId`); Cloud Run does not inject it automatically. |
| `FIRESTORE_DATABASE_ID` | Must equal `ai-studio-immogest-6d16b790-183d-49fd-9d4f-086d99dc2be3` (`deploy/target.json` `databaseId`); `(default)` is rejected. |
| `PUBLIC_APP_URL` | Must be a bare `https://` origin (`https://immogest.cloud.run`) with no path, query, hash, credentials, or `localhost`. |
| `SYNDIK_UPLOAD_BUCKET` | Must be a valid GCS bucket name (`3–222` lowercase alphanumeric/`.`/`_`/`-` characters, e.g. `immogest-7faaf-uploads`) for the private upload bucket. |
| `SYNDIK_SERVER_SECRET` | Bind from Secret Manager: >= 32 random chars, trimmed, >= 12 distinct chars, not a placeholder or repeated pattern. Preserve the existing stable secret across deploys. |
| `SYNDIK_SESSION_SECRET` | Optional Secret Manager binding; when set, must satisfy the 32+ random-char rules and differ from `SYNDIK_SERVER_SECRET`, `SYNDIK_SCHEDULER_SECRET`, and the primary encryption key. |
| `SYNDIK_ENCRYPTION_KEYS` | Bind from Secret Manager: valid JSON `{"primary":{"kid":"<id>","key":"<32+ random chars>"},"retired":[...]}` with unique `kid` identifiers, 32+ char keys, and a primary key distinct from `SYNDIK_SERVER_SECRET` and `SYNDIK_SESSION_SECRET`. |
| `SYNDIK_SCHEDULER_SECRET` | Bind from Secret Manager: >= 32 random chars, distinct from `SYNDIK_SERVER_SECRET` and `SYNDIK_SESSION_SECRET`, matching the scheduled Cloud Functions secret. |
| `K_SERVICE` / `CLOUD_RUN_SERVICE` | Cloud Run sets `K_SERVICE` automatically to the service name; must equal `buildmanage` (`deploy/target.json` `service`). Deploying to a differently named Cloud Run service fails validation. |
| `CLOUD_RUN_PROJECT_ID` / `FIREBASE_PROJECT_ID` | Optional; if set, must equal `immogest-7faaf` (`deploy/target.json` `projectId`). |
| `CLOUD_RUN_REGION` | Optional; if set, must equal `europe-west1` (`deploy/target.json` `region`). |
| `TRUST_PROXY_HOPS` | Optional; if set, must contain digits only (e.g. `1` behind Cloud Run). |
| `CSP_MODE` | Optional; if set, must equal `report-only` (default) or `enforce`. |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `STORAGE_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST`, `FUNCTIONS_EMULATOR`, `SYNDIK_TEST_MODE` | Must be unset (or empty) in production; emulator hosts and test bypasses are refused. |

## Firebase account email setup

For switching an existing Cloud Run deployment from SendGrid account emails to
Firebase Authentication, follow [FIREBASE_AUTH_SETUP.md](FIREBASE_AUTH_SETUP.md).
The provider must be enabled and the runtime account authorized before deployment.
This does not require the general data migration below.

## Data migration

1. Freeze old writes, disable the old monthly billing schedule, and download the
   actual `shared-state.json` from the old server. Browser caches and old Firestore
   mirrors may contain divergent records: reconcile these before importing.
2. Retain a protected original copy and record cabinet/building/resident counts,
   issued invoices, receipts, charge balances, bank balances, and reserve balances.
   Resolve duplicate billing events, invoice claims, missing links, and unexplained
   balances. Do not synthesize payments to make a reconciliation pass.
3. In a separate staging project, configure the server variables above and run:

   ```bash
   npm run state:admin -- import --in /secure/legacy-state.json --legacy-json
   npm run state:admin -- import --in /secure/legacy-state.json --legacy-json --apply
   npm run state:admin -- audit
   npm run state:admin -- export --out /secure/staging-backup.enc.json
   ```

   Import is a dry run by default and refuses a nonempty target unless `--replace`
   is explicit. Import normalizes building tenant links, wraps legacy digests with
   scrypt, clears stale identity actions/outbox/operation receipts, and revokes old
   sessions. Successful legacy logins upgrade to direct scrypt. Existing raw legacy
   invitation codes should be revoked/regenerated before accepting real residents.
   New invitation codes are shown in the creating manager session and encrypted in
   retry receipts; they are removed from persisted resident/provider entities. Copy
   or export them during that session, or regenerate a new invitation if lost.
4. Compare the same reconciliation totals and ownership links in staging. Confirm
   opening working and reserve balances once per building in Financials, including
   zero balances. Existing ledger entries are preserved and added to those opening
   amounts. Import unpaid opening arrears separately; it creates debt, not cash.
5. Rehearse an encrypted restore into an isolated staging database, then repeat the
   verified migration into production during the maintenance window.
6. Switch traffic, deploy Firestore and Storage rules and Functions from the same
   commit, verify the first generated charges, and enable exactly one schedule.

The new canonical collections are `platform_internal`, `platform_state`, and
`platform_generations`. Existing `syndics`, `charges`, and `invoices` collections are
legacy mirrors; they do not feed the new ledger. Never enable old write triggers
or import mirrors automatically. The legacy exported trigger names are retained
as no-ops during rollout so a redeploy replaces their old behavior.

## Backup and restore

Run encrypted export on a scheduled operator job using the same repository config.
Copy the resulting `.enc.json` file to a separate private retention bucket. Use a
new filename per export; existing backups are never overwritten. Retain the backup
key separately and verify access during regular restore drills. An example initial
policy is daily snapshots retained for 30 days; choose actual RPO/RTO with the owner.
Back up the private upload bucket too: JSON state backups contain file metadata,
not file bytes. Versioned objects/retention must cover both stores.

```bash
npm run state:admin -- import --in /secure/backup.enc.json
# Only in the intended target, with traffic stopped and after reconciliation:
npm run state:admin -- import --in /secure/backup.enc.json --apply --replace
npm run state:admin -- audit
```

The AES-GCM authentication tag rejects incorrect keys or tampered backups. Do not
roll back only the application image after a data-format migration. Restore a
verified compatible snapshot with traffic stopped, or deploy a forward fix.

Large writes stage a complete Firestore generation and atomically switch one
revision pointer. A failed attempt can leave an unreferenced staging generation.
For A5 scheduled cleanup, follow [the lifecycle rollout contract](docs/storage-lifecycle.md):
all active writers must support deletion claims before enabling the collector.
For manual cleanup, stop traffic and record the active
`platform_internal/state_revision.generation`, preserve it, and recursively delete
only old unreferenced generations after a verified backup. Do not delete a live or
recent generation while a transaction could still be staging it.

The development file adapter uses an exclusive directory lock. After a machine
crash, stop all local servers and remove a stale `.state-lock` directory only after
confirming that no local process owns the database. This does not apply to production.

## Staging acceptance before real users

- Verify registration email, reset email, resend cooldown, expired/single-use link,
  password change, Google login and logout across two browsers.
- Verify owner, tenant, provider, syndic and admin scope with two real cabinets.
  Confirm private receipts are inaccessible to another resident.
- Use two backend instances to post partial payments concurrently. Reconcile
  charges, invoice paid amounts, reserve split, journal entries and receipt records.
- Confirm monthly generation from both manual UI and the scheduler creates one set
  of charges for a period. Validate the Casablanca schedule and retry a failed run.
- Close a financial period, reject a mutation, reopen as admin with a recorded
  reason, reverse an allocated payment, and retain/void its receipt.
- Freeze an assembly ownership roll, vote on behalf of named lots, finalize it,
  verify its results and generate its approved assessment once.
- Complete an assigned maintenance intervention as provider, confirm as resident,
  reopen it and verify the event history. Check marketplace buyer conversations.
- Open generated French/Arabic invoices/receipts on desktop and mobile. Check actual
  banking details and long documents; obtain the owner's review of legal templates.
- Verify SendGrid delivery and retries, Storage IAM, database IAM, alert routing,
  backup scheduling, a full restore drill, and the deployed readiness probe.
- Measure latency and Firestore read/write costs with representative data. The
  repository currently reads the aggregate state and uses a global revision to
serialize writes. Bulk staging runs outside read locks, with an atomic revision
comparison before activation. It protects correctness but is a pilot architecture, not a
  claim of unbounded multi-tenant throughput. Partition tenant aggregates and add
  paginated queries before a large rollout.

Monitor HTTP 5xx/409/429 rates, job errors, outstanding invoices, failed/outstanding
outbox messages and backup age. Email is at-least-once delivery: a provider timeout
after acceptance can lead to a retry. Do not claim guaranteed exactly-once email.
Stop rollout if reconciliation fails or required live integrations are unverified.

## Card payments

CMI checkout and callback remain unavailable. There is no simulated financial
success. Bank transfer, deposit, cheque and cash are recorded by authorized managers;
residents submit proofs for human review. A future card gateway must post through
the same idempotent operation service after merchant-tested webhook verification.

