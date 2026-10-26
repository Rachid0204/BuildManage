# A3.1 extraction plan

Baseline: 8673494156679ff4eb24c9f4839e70b16580fbff. Scope ends before A3.2.

## Target

Use shared/domain with money.ts (centime conversion, largest-remainder allocation,
reserve splitting and recorded receipt allocations), balances.ts (canonical opening
and ledger projection), voting.ts (resolution majority and quorum arithmetic),
subscription.ts (H2 active-building capacity), and commands.ts (strict TypeScript
command payloads). Both runtimes import these modules; legacy utility exports remain
compatibility entry points. server/domain.ts remains the mutation adapter: it has no
domain arithmetic to extract and its storage bridge must remain in A3.1.

Preserve C2 canonical zero openings and aggregate-only legacy inference, C3 fractional
reserve rates and historical receipt amounts, and H2 archived-building exclusion.
Preserve legacy ceil-half and canonical floor-half-plus-one quorum policies separately.
Do not change historical snapshot weights or round fractional voting weights.

## Contracts

SetOpeningBalancesCommand: buildingId, working, reserve, reason.
PostIncomeCommand: buildingId, amount, paymentId, transaction details.
CreateQuittanceCommand: existing receipt creation payload.
AddBuildingCommand: existing building creation payload.
ToggleAGVotingCommand: agId, isOpen.
These are compile-time contracts; transport validation and endpoint payloads stay intact.

## Parity and purity

Freeze pre-extraction calculations as independent test-only legacy references. Run
identical fractional split, allocation, balance, capacity and voting fixtures through
both implementations using strict equality. First execute with missing kernel imports
to record the red gate, then extract unchanged functions. Add an import/purity guard.
Kernel modules may import types only from types.ts; no browser storage, HTTP,
repository, randomness or implicit clock dependencies are permitted.

## Verification

Run parity, check:local, auth, auth-concurrency, auth:browser, emulator, ui, ui:cloud
and container startup checks. Record actual outcomes and distinguish unavailable
emulators/browser/container infrastructure from passing checks. No route rewrites,
fetcher changes, services.ts removal, live deployment or A3.2 work.
