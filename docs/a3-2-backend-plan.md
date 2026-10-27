# A3.2 backend domain architecture

Baseline: approved A3.1, main 129bd75c73fc1fa75fa0a0fc223914985af93750.

## Ownership and transactions

Create server/domain/finance.service.ts, building.service.ts and assembly.service.ts
for repository-state calculations and mutations. Supporting nonfinancial commands
need a separate supporting service so the server can fully stop importing the browser
service module. Extract only reachable server behavior, with no Firebase client SDK,
browser cache, network fetch, mock fixtures or process-global storage adapter.

The command coordinator retains the existing authorization, period-lock, audit,
identity, idempotency and lifecycle rules. It receives the active repository state
explicitly; domain services operate on that transaction's state and do not open nested
transactions or commit independently. File/Firestore repository and identity intent
code continue to own retries, commits and rollback. Express passes the transaction
state into command dispatch. Scheduled billing passes each building's transaction.

Each command receives explicit authenticated role/user, cabinet and building scope.
No new domain service calls currentState or reads an ambient actor. Existing query
adapters may retain compatibility access at the boundary, outside the domain layer.
server/domain.ts is retained only as a deprecated legacy test entrypoint; production
imports must not reach it or firebase/services.ts. Browser services remain unchanged.

## Validation

A3.1 contracts are TypeScript interfaces, not runtime schemas. Add backend Zod
validation typed against those contracts, before service dispatch, preserving existing
normalization and rejection behavior. Existing stricter authorization and financial
checks remain in the command coordinator. IDs and role are trusted only from the
authenticated context; payload tenant IDs never override it.

## Parity before extraction

Freeze the approved server command coordinator as a test-only oracle calling the
legacy executeMutation path. Compare full repository deltas, payloads, receipt
numbers and error status/messages with deterministic clock/UUID fixtures. Note:
setOpeningBalances is not an executeMutation operation, and canonical toggleAGVoting
has stronger snapshot/quorum rules than that primitive. Their oracle must therefore
be the approved coordinator, not an invented legacy command. postIncome is private;
exercise it through createQuittance/recordPayment and compare exact ledger rows.
Cover closed periods, capacity, archived restoration, foreign cabinet access and
concurrent independent contexts. First run must fail with missing new domain imports.

## Gate

Run backend parity, A3.1 parity, all registered local/backend regression suites,
authentication/concurrency, Firestore integration, browser/auth/cloud simulation,
TypeScript, rules lint, Functions and production builds. Preserve A3.1 behavior;
no client thinning, endpoint redesign, live deployment or A3.3 work.
