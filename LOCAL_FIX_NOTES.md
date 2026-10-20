# Authorization and payment repairs

Base: 7600bb68b0f6798e7bf38d25c9b94cf3d98227b1.
Branch: fix/authorization-and-payment-boundaries.

## Implemented scope

- Removed backend authentication by public client signatures. Server-issued sessions resolve current membership; Firebase tokens use Admin SDK verification and a server session exchange. Login/profile restoration no longer grants backend identity from local password comparisons or arbitrary local profiles.
- Registration generates account/cabinet IDs and the 30-day trial on the server. It cannot join an existing cabinet by submitting its ID. Existing invited residents/providers use their invitation login; new public resident/provider accounts remain unassigned. Initial building setup remains supported through validated registration fields.
- Rejected inconsistent role/UID/tenant fields and unauthorized membership changes in registered-user writes. Cabinet ownership and subscription fields cannot be changed by a non-admin snapshot write. Restored verified-email requirements for the bootstrap Firestore admin rule.
- Removed resident whole-meeting writes. Added an authenticated vote operation with authoritative ownership, lot, attendance, weight and result calculation. Residents cannot submit another resident's vote or replace meeting totals. Existing quorum/majority and remote-owner check-in policies are retained.
- Kept resident financial records scoped to the billed resident. Resident proof submissions must be pending, owned by the caller and within the charge balance; review belongs to the manager.
- Matched CSV lot identifiers at token boundaries and required a single eligible match. Ambiguous rows stay unmatched. Debit, amount and bank-reference replay protections remain.
- Validated payer/lot/charge relationships and remaining balance before proof approval. Invalid approvals do not first mark proofs approved.
- Added stable manual payment identities, conflict detection and missing-receipt recovery. A repeated 40 MAD payment stays at 40; an intentional next payment uses a new reference/operation ID.
- Reconciled manual/proof payments with an existing invoice, claimed charges during invoice creation, and used stored invoice state for allocations. Invoice payments share the configured reserve split.
- Read-only receipt creation requires an existing paid amount and never changes accounting. The manual form retains an operation ID, displays the configured reserve rate and surfaces payment errors.
- Password-change UI waits for server success and cannot silently complete through a local credential fallback.

## Verification

Run from a normal clean checkout:

    npm ci
    npm run check:local

check:local performs frontend/Functions type checks, Firestore rules lint, the existing service suite, new payment boundary tests, actual Express HTTP authorization tests, Functions compilation and frontend build. Tests use synthetic memory/temp stores and block external network calls. Production credentials are not required.

HTTP tests cover arbitrary/known-profile forged sessions, registration claiming another cabinet, conflicting roles, cross-account password changes, private finance scope, resident meeting overwrite, scoped voting, proof review, protected entitlements and private file delivery.

Payment tests cover exact lot 1/10 matching, debit/excess/replay handling, partial payment retries, conflicting references, overpayments, wrong payer, receipt recovery, stored invoice authority, unique charge linking, reserve reconciliation and proof/invoice updates.

The previous service fixtures were corrected to assign a real owner before paying the second lot and to reject a document for an unpaid charge. These strengthen the business assertions rather than bypassing validation.

## Limits and deployment follow-up

This is a scoped repair batch, not a claim that all original audit findings are closed.

- The active financial engine still uses local/shared-state updates and Firestore mirroring. Multi-device financial updates are not an atomic canonical database transaction; migration, reconciliation and concurrent/reversal workflows remain required.
- The existing legacy password hashing scheme remains for compatibility. Moving all credentials to supported Auth/password storage and auditing previously created privileged records require a separate migration.
- Live Firebase/Google sign-in, deployed rules, email, gateways, AI, browser accessibility and staging deployment were not exercised by these isolated checks.
- Clean installation against the committed lockfile and the CI Node runtime require an environment with registry access. Local validation used the dependencies available in the review environment.
- Configure a stable SYNDIK_SERVER_SECRET for a deployed server session lifecycle. Without one, the server uses a process-random secret. SYNDIK_DATA_DIR must refer to durable storage when the backend's local JSON/file persistence is used in deployment. Tests override it with disposable temporary storage.
- CMI remains disabled. No production data, secrets, deployment or customer notification is modified by running the checks.
