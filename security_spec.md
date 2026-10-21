# Security and accounting contract

The backend is the authority for identities, tenant membership and financial state.
A Firebase browser token must be verified by the Admin SDK; custom sessions are
server HMAC tokens bound to current membership and a revocation version. Browser
session envelopes and user-provided roles are not authorization credentials.

All business writes use `/api/commands` or another specific authenticated operation.
`/api/shared-state` is a filtered read view; snapshot writes and web resets are
forbidden. Firestore and Storage deny direct client access, including clients
claiming an admin role. Admin SDK IAM is configured separately at deployment.

Every command validates role, tenant, building and record ownership. Generated
identifiers and actor identity come from trusted state. Provider status updates are
limited to assigned interventions; resident proofs and requests belong to that
resident. Private chat messages have explicit peers. File access checks private
ownership, shared document attachment, marketplace publication or assigned work.

A repository transaction encloses authorization, idempotency receipts, domain
updates and audit records. HTTP success is released only after durable commit.
There are no external email sends inside a database transaction. Firestore's global
revision protects cross-instance correctness; large writes stage a generation and
atomically switch the active pointer. The file adapter is local development only.

Financial operations use integer centimes for allocation and validate stored
invoices/charges. Partial payments cannot exceed the remaining balance. Monthly
billing normalizes periods and uses one engine for manual and scheduled execution.
Opening arrears never create cash income. Opening cash balances are confirmed once.
Reversals append inverse journal entries, retain original transactions and void
superseded receipts. Closed periods reject new entries for their dates; admin
reopening requires an audit reason. Platform subscriptions are separate from
resident/property funds. AI OCR cannot approve payments, and CMI is unavailable.

Passwords use salted scrypt on the server. Legacy account digests are protected
with scrypt on import and upgraded on successful login. New invitation secrets use
cryptographic randomness, are retained in manager memory for sharing, and are
removed from persisted resident/provider entities. Idempotent response bodies and
email outbox bodies are encrypted at rest with the server secret. Identity actions
use hashed random, expiring, single-use tokens. Password changes/resets, credential
regeneration and logout revoke prior custom sessions. Archived accounts, including
legacy credential-store accounts, cannot keep using a prior token.

Assembly vote weights come from named, owned lots. The ownership roll is frozen
when voting opens. Clients cannot supply accepted totals or mutate the resolutions
after opening. Finalization recomputes results; completed meetings are immutable.

Regression coverage lives in `tests/httpBoundaries.ts`, `tests/paymentBoundaries.ts`,
`tests/productionReadiness.ts`, `tests/adminRecovery.ts` and
`tests/firestoreIntegration.ts`. The older domain suite also remains in place.
The emulator suite checks bulk generation, concurrency, rollback and client denial.
Run `npm run check:local` and `npm run test:emulator` before release.

See DEPLOYMENT.md for migration, IAM, key management, backups, live integration
acceptance and capacity limits. Local tests are not evidence that production
services or legal templates have been approved.
