# A3.2 backend domain verification

Baseline: approved A3.1, `129bd75c73fc1fa75fa0a0fc223914985af93750`.
Implementation: `06d7ce62ef4a0236e33ef6adc659f1ddaa588e1c`.

## Architecture and scope

`server/domain/finance.service.ts` owns charges, income/receipt posting, invoices,
opening balances, period controls and reversals. `building.service.ts` owns building
creation, lot changes, subscription capacity, archiving and restoration.
`assembly.service.ts` owns meetings, immutable voting snapshots, quorum, ballots and
resolution charges. `supporting.service.ts` holds the other reachable mutations
(residents, providers, maintenance, announcements, messaging and marketplace), so
none of the production commands needs to fall back to the frontend services.

`command.service.ts` preserves the existing authorization and audit coordinator.
It captures an explicitly supplied repository transaction state. Commands carry an
authenticated actor and explicit cabinet/building/role context into the services.
Backend Zod validators cover the five shared command contracts; existing stricter
authorization, accounting and historical allocation checks remain in place.

Express supplies its active transaction through `res.locals.transactionState`.
Scheduled billing supplies each building's own repository transaction. Services do
not open or commit transactions; the existing repository/identity-intent mechanism
still owns atomic commits, retries and rollback. Detached record reads preserve the
old copy-on-write and credential-sanitization semantics, using plain repository
state rather than a browser storage interface. No mock records are imported.

`server/operations.ts` retains query/audit compatibility wrappers at the repository
boundary. Those wrappers may access repository AsyncLocalStorage; no domain module
reads `currentState()` or uses process-global storage. `server/domain.ts` is marked
deprecated and used only by the legacy parity oracle. A production bundle test
proves that neither it nor frontend services/cache/config/runtime or mock data is
reachable from the server entrypoint. Browser-facing `firebase/services.ts` is
unchanged. A3.3 and production deployment are outside this change.

## Fail-first parity evidence

The plan was written before production edits. The first run of
`tests/backendDomainParity.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the absent
`server/domain/command.service` module. A frozen copy of the approved coordinator
calls the existing legacy `executeMutation` path, while the new path calls backend
services. Deterministic time and UUIDs allow exact comparison of full repository
state, returned payloads, receipt sequences and rejection messages/statuses.

`setOpeningBalances` never existed in `executeMutation`; canonical AG voting also
already had stronger snapshot/quorum rules than the client primitive. Those cases
compare the approved coordinator paths. The private `postIncome` helper is exercised
through both receipt issuance and invoice payment, including exact 7.5%/centime ledger
rows. Additional cases cover duplicate payments, successive receipt numbers,
overpayment, frozen openings, closed periods/meetings, capacity, archiving/restoration
and foreign cabinet access. These fixtures establish parity for the exercised cases,
not an exhaustive proof for all possible inputs.

All **19/19 backend tests pass**, including parallel explicit contexts with poisoned
global storage, real repository rollback after a failed second financial step, and
the production bundle dependency check. The first extraction also exposed an error
message altered by a mechanical edit; exact error parity caught it and it was restored.

## Full verification gate

| Gate / command | Result |
| --- | --- |
| `test:backend-domain` | 19/19 |
| A3.1 `test:domain-kernel` | 454/454 |
| A4 `test:bundle` | 11/11 |
| A6 `test:deployment-contract` / `:built` | 17/17 each |
| A5 `test:storage-lifecycle`, file / Firestore | 15/15 / 18/18 |
| H4 `test:security` | Passed |
| H5 `test:ai-protection`, file / Firestore | 26/26 each |
| C5 `test:auth-concurrency` | 16/16 |
| H2 `test:subscription-capacity` | 18/18 |
| H3 `test:monthly-billing`, file / Firestore | 9/9 / 8/8 |
| C1 `test:assembly-privacy` | 13/13 |
| C2 `test:opening-balances` | 21/21 |
| C3 `test:reserve-rate` | 25/25 |
| C4 `test:quittance-integrity` | 21/21 |
| `test:verify`, `test:business`, `test:cache` | Passed |
| `test:production`, `test:recovery` | Passed |
| `test:integration` via `test:emulator` | Passed, including live revision and client denial |
| `test:auth` | 54 checks passed |
| H1/H6 and all other standard UI tests, `test:ui` | 61 passed, 1 expected cloud-only skip |
| `test:auth:browser` | Passed |
| `test:ui:cloud` under Firestore emulator | 62/62 |
| `typecheck` (frontend and Functions) | Passed |
| `lint` | Passed (configured Firestore rules linter) |
| `build:functions`, `build` | Passed |
| `test:startup` | Passed on ports 3000 and 31847 |
| `test:container` | Passed in CI; Docker is unavailable locally |

`check:local` completed with exit code 0. Authentication and Firestore suites use
local emulators; cloud UI simulation uses Firestore and Admin Storage test paths,
not production data. Local tools: Node 24.22.1, Java 21, portable Chromium 153.
GitHub CI uses Node 22 and the pinned Playwright browser. CI run:
https://github.com/Rachid0204/BuildManage/actions/runs/40451192882.

The follow-up commit adds this report and removes trailing whitespace only.
Backend parity (19/19), kernel parity (454/454), TypeScript and whitespace checks
were repeated after that cleanup. The final documentation/whitespace commit may
trigger another CI run; its status is separate from the completed local gate.
