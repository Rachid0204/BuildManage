# A3.1 verification

Baseline: `8673494156679ff4eb24c9f4839e70b16580fbff` (A5 and container smoke checks merged).
Implementation: `00f782e1821f199a4ada8e55866deb2b4568b960`.
Scope stops at A3.1. No API routes, client fetchers or persistence adapters were rewritten.

## Extraction and contracts

The plan in `a3-1-kernel-plan.md` preceded code changes. `shared/domain/`
contains money, balance, voting and capacity helpers plus the five requested strict
TypeScript command contracts. Contracts are compile-time only; existing transport
validation remains authoritative. Compatibility exports preserve current imports.

The original math lived primarily in `utils/security.ts`, `utils/agVoting.ts` and
`utils/subscriptionPolicy.ts`, called by `firebase/services.ts` and server operations.
Those algorithms were frozen independently in `tests/fixtures/a31/` before extraction.
The private services centime validator and inline service/server quorum arithmetic
were also extracted. `server/domain.ts` contains storage bridging and mutation dispatch,
not domain arithmetic, so it is intentionally unchanged.

The first parity execution failed because `shared/domain/money` did not yet exist.
After extraction, **454/454** exact equality and purity checks pass. Fixtures cover
fractional reserve rates, recorded historical allocations, centime remainders,
canonical zero openings, legacy aggregates, fractional voting weights and active
building capacity. Frozen references do not import the new kernel. Existing financial
and API regression suites additionally exercise the service/operation adapters.

Purity checks inspect TypeScript syntax: only erased imports from `types.ts` are
allowed; runtime/dynamic imports, browser globals, transport identifiers, implicit
clock and randomness dependencies are rejected. The extracted modules have no
browser, HTTP, repository or middleware dependencies.

## Verification results

| Gate | Result |
| --- | --- |
| `test:domain-kernel` | 454/454 |
| A4 `test:bundle` | 11/11 |
| A6 deployment contract, source / compiled | 17/17 / 17/17 |
| A5 storage lifecycle, file / Firestore | 15/15 / 18/18 |
| C1 assembly privacy | 13/13 |
| C2 opening balances | 21/21 |
| C3 reserve rate | 25/25 |
| C4 quittance integrity | 21/21 |
| C5 authentication concurrency | 16/16 |
| H2 subscription capacity | 18/18 |
| H3 monthly billing, file / Firestore | 9/9 / 8/8 |
| H5 AI capability/quota protection, file / Firestore | 26/26 / 26/26 |
| H4 HTTP authorization/security boundaries | Passed |
| Business verification, payment boundaries, cache isolation | Passed |
| Production readiness and encrypted recovery | Passed |
| Firebase authentication integration | 54 checks passed |
| Firestore integration and browser database denial | Passed |
| Authentication browser | Passed |
| Standard browser, including H1/H6 | 61 passed, 1 expected cloud-only skip |
| Cloud browser, Firestore/Admin Storage simulation | 62/62 |
| TypeScript frontend and Functions | Passed |
| Configured rules linter | Passed |
| Functions compilation and production frontend/server build | Passed |
| Compiled HTTP startup | Passed on ports 3000 and 31847 |
| Production Docker smoke | Passed in GitHub CI |

The configured linter checks Firestore rules, not repository-wide TypeScript style.
Emulator/cloud simulation checks use isolated test data, not production services.
Local runs use Node 24.22.1, Java 21 and portable Chromium 153; CI uses Node 22 and
the repository's pinned Playwright browser. Docker is unavailable locally; its CI
job succeeded in run https://github.com/Rachid0204/BuildManage/actions/runs/40420603329.

The first standard browser run had 59 passes, one cloud-only skip and two locator/
navigation failures. Both failed cases passed on a targeted rerun (2/2), followed
by a full run with 61 passes and the expected cloud-only skip. The cloud run passed
all 62 cases, including the skipped case. No application code was changed to obtain
these rerun results. The initial failures are not hidden.
