# A6 production deployment contract

The canonical target is `buildmanage` in `europe-west1`, project `immogest-7faaf`.
`deploy/target.json` defines the service/project/database identity. Firebase Hosting's
`/api/**` rewrite and workflow target metadata are checked against it.
The GitHub workflow verifies code; it does not deploy. The external Cloud Build
trigger is not stored here and has not been inspected or modified by this change.

## Startup configuration

`server/productionConfig.ts` exports a typed Zod schema. Both `startServer()` and
`createRepository()` validate before fallback, SDK initialization or listening.
In production, invalid configuration exits with code 1 and
`PRODUCTION_CONFIG_INVALID`, listing field names only, never their values.
Development and emulator workflows retain their existing behavior.

Required keys are shown in `deploy/runtime.env.example`:

- `NODE_ENV=production`, explicit Firestore/GCS backends and Firebase auth.
- `GOOGLE_CLOUD_PROJECT` and `FIRESTORE_DATABASE_ID` must match the manifest.
  Explicitly set the project; do not assume Cloud Run injects this variable.
- `PUBLIC_APP_URL` must be an HTTPS origin without credentials, path or query.
- `SYNDIK_UPLOAD_BUCKET` must name the actual existing private upload bucket.
- `SYNDIK_SERVER_SECRET` and separate `SYNDIK_SCHEDULER_SECRET` must be stable,
  at least 32 characters, and not placeholder or repeated-pattern values.
- `SYNDIK_ENCRYPTION_KEYS` is a Secret Manager JSON keyring with a primary
  `{ "kid", "key" }` and optional retired decrypt-only entries. Each key is at
  least 32 characters and each key ID is unique. Configure a dedicated
  `SYNDIK_SESSION_SECRET`; it falls back to `SYNDIK_SERVER_SECRET` for older
  deployments. Generate keys cryptographically and keep them stable across
  revisions.

Optional service/project aliases must match the target when supplied.
Emulator hosts and test bypass flags are refused in production.

Session HMAC/cookie tokens use `SYNDIK_SESSION_SECRET` (or the legacy
`SYNDIK_SERVER_SECRET` fallback). Durable AES-GCM records use the independent
`SYNDIK_ENCRYPTION_KEYS` keyring. Envelopes carry a format version and key ID;
legacy v1 envelopes without a key ID still require the original server key.
For a rotation, deploy the new primary while retaining the old key as retired,
then run `npm run keys:rotate` against the authoritative repository. Confirm
the reported counts and run it again until it reports zero changes before
removing the retired key. Keep `SYNDIK_SERVER_SECRET` unchanged until all
legacy v1 records have been migrated. Signing-key rotations do not change durable
record decryption. Never paste key values into logs, PRs, or shell history.
The scheduler key must match the scheduled Functions configuration, whose
`SYNDIK_BACKEND_URL` must point to the authoritative backend.

## Deployment procedure

1. Review the existing Cloud Run service's nonsecret settings and Secret Manager
   bindings against the manifest. Verify the existing named database and bucket.
2. Set missing explicit settings and stable private secret bindings before
   deploying this revision. Never paste secrets into PRs or logs.
3. Run `npm run check:production-config` in the deployment environment. This is
   configuration validation only: it does not check IAM, quota, DNS or live access.
4. Deploy through the existing Cloud Build process, verify the new revision is
   ready and test login, state loading and uploads before routing traffic.
5. Deploy Hosting configuration if using Firebase Hosting, then verify `/api/**`
   resolves to `buildmanage`. No live deployment is performed by this PR.

Missing settings intentionally prevent the new revision from becoming ready.
No historical ledger, identity, upload lifecycle or A5 changes are included.

## Regression evidence

Before application changes, the permanent startup suite reported 8 tests:
1 passed, 7 failed. Missing/blank/short/default/repeated signing keys booted,
the repository accepted production file storage, and Hosting targeted the wrong
service. Expanded coverage also exercises redaction, required fields, emulator
bypasses, URL/target validation and source/compiled server startup.

Final verification: source and compiled startup suites each passed 17/17; A4
bundle budgets passed 11/11. C1/C2/C3/C4 passed 13/21/25/21; H2 passed 18; H3
passed 9 file-mode and 8 Firestore cases; H5 passed 26 in each backend mode;
C5 passed 16. Auth integration passed 54 checks. The full local gate (including
TypeScript, Firestore rules lint, Functions and production builds) passed.
Standard and Firestore-backed browser commands and Firebase browser auth flows
all exited 0. Browser suites include H1/H6. Cloud coverage uses local emulators
and simulated Storage; production IAM, quotas and deployment were not tested.
