# ImmoGest / Syndik Maroc

French/Arabic property-management SaaS for Moroccan syndic cabinets, residents,
providers and platform administrators. Includes buildings, lots, charge billing,
payment review, invoices/receipts, maintenance, assemblies/voting, documents, chat,
marketplace, financial exports and subscription controls.

## Run locally

Use Node 22.9 or newer. Live secrets are unnecessary for local builds and synthetic
regression tests.

```bash
npm ci
npm run check:local
npm run dev
```

The development app runs on `http://localhost:3000`. It uses `.data` for local data.
Copy `.env.example` to `.env.local` when configuring optional integrations. These
variables are loaded by the start/dev scripts; production requires durable services.

## Verification

```bash
npm run typecheck
npm run lint
npm run test:verify
npm run test:business
npm run test:security
npm run test:production
npm run test:recovery
npm run test:emulator  # Java 21; local demo project only
npm run build:functions
npm run build
```

HTTP tests use isolated synthetic data, local processes and a network guard. The
Firestore suite validates staged bulk writes, concurrent repositories, rollback and
client denial against a local emulator. No real accounts, email or payment services
are contacted. A passing build does not establish live integration readiness.

## Architecture and workflow

- The authenticated backend is the single authority. Explicit commands enforce
  tenant, role, record ownership and subscription policy. Broad snapshot writes
  and web resets are disabled.
- Production uses Admin SDK Firestore transactions; development uses an atomic
  locked file adapter. Browser business state is an in-memory view, cleared on
  identity changes. Firestore and Storage deny direct browser access.
- Related financial records commit together. Retries have durable operation
  receipts; invoice payments store charge allocations. Reversals preserve the
  original journal and void receipts. Financial periods can be closed, with admin
  reopening and an audit reason. Opening arrears are separate from opening cash.
- Manual and scheduled billing use the same backend operation and period keys.
  Initial billing creates persisted, itemized invoices. Owner-first lot liability
  is used consistently. Expired subscriptions allow consultation and export while
  blocking mutations; plan limits are checked in the backend.
- New passwords and invitations use scrypt and cryptographic randomness. Custom
  account recovery uses expiring single-use tokens and an encrypted email outbox.
  Password resets, credential regeneration and logout revoke server sessions.
- Providers update only assigned interventions. Completion awaits the resident or
  syndic's confirmation. Marketplace conversations have explicit buyer/seller peers.
- Assembly vote totals and weights are server-derived. Ownership is frozen on
  opening, resolutions cannot change after voting starts, and finalized meetings
  are immutable.
- PDFs embed a licensed Arabic-capable font, use actual persisted records, and do
  not fabricate a QR verification service, seal, signature or banking information.

## Deployment

Read [DEPLOYMENT.md](DEPLOYMENT.md) before switching traffic. This release needs a
coordinated data migration, backend/rules/functions rollout, private uploads,
transactional mail and scheduled jobs. `npm start` serves the compiled backend and
frontend after `npm run build`. The workflow verifies and uploads build artifacts;
it does not deploy to live infrastructure.

Local/emulator checks cannot prove IAM, real email delivery, merchant integration,
restore timing or production capacity. Those acceptance steps are explicit in the
runbook. CMI is disabled pending a real merchant-tested integration.
