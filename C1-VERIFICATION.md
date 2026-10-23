# C1: assembly snapshot privacy — verification record

Scope: C1 only. C2–C4 remain deferred for separate approval.

Implementation commit: 604f0ac36212447217d7df15ad97ae6404dcd025. Base: main@6d2f054b2f85bef22ab56c15c83ab1a2d59666bc.

## Compatibility handling

Existing rich Firestore snapshots are sanitized on read for residents and providers through a field allowlist, including active, closed and completed assemblies and direct vote responses. Reads do not modify persisted records. Syndic/admin visibility remains scoped by existing authorization.

New snapshots store only building/cabinet identifiers, voter identifiers/names/ownership flags and lot identifiers/numbers/owner IDs/voting shares. There is no bulk migration, reconciliation or dedicated migration helper. Historical snapshots, cast votes, quorum, share calculations and ledgers are not rewritten.

The regression fixture deliberately gives the historical snapshot 300/700 shares and current lots 600/400 shares. A legacy vote retains 300/700 weighting; a new snapshot uses 600/400. Closed records and financial ledger entries are checked for equality.

## Files changed

- server/assemblyPrivacy.ts: minimal snapshot allowlist and role-specific response projection.
- server.ts: apply the projection to scoped shared-state responses and direct vote responses.
- server/operations.ts: minimize new snapshots at voting open.
- types.ts and utils/agVoting.ts: explicit minimal snapshot type accepted by voting calculations.
- tests/assemblyPrivacy.ts: permanent regression coverage written and run before the fix.
- package.json and .github/workflows/deploy.yml: run the new suite locally and in CI.
- C1-VERIFICATION.md: this compatibility and exact-output record.

## Verification environment

Node v24.19.0; npm 11.9.0. Emulator commands used an isolated Java 21 runtime, cached Firestore emulator 1.22.0 and the demo-buildmanage project. Browser commands used a local Chromium executable. No production accounts, Firestore data or uploads were used.

The production build and all existing regression suites passed. The configured linter checks Firestore rules; no unrelated lint expansion was included in C1. The expected Firestore PERMISSION_DENIED messages are assertions that direct browser writes remain blocked. npm proxy and color warnings are included verbatim below.

Outputs below are captured command output, without truncation.

## 01-before-fix.log

Command: `npm run test:assembly-privacy`

Exit code: 1. Expected failure before application changes: 13 tests, 2 passed, 11 failed.

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> immogest@0.0.0 test:assembly-privacy
> node --import ./tests/helpers/networkGuard.mjs --import tsx tests/assemblyPrivacy.ts

✖ provider: in_progress legacy assembly hides all owner contacts and preserves voting history (9.811387ms)
✖ provider: closed legacy assembly hides all owner contacts and preserves voting history (4.47328ms)
✖ provider: completed legacy assembly hides all owner contacts and preserves voting history (4.1681ms)
✖ one@assembly.invalid: in_progress legacy assembly hides all owner contacts and preserves voting history (4.048048ms)
✖ one@assembly.invalid: closed legacy assembly hides all owner contacts and preserves voting history (4.435435ms)
✖ one@assembly.invalid: completed legacy assembly hides all owner contacts and preserves voting history (4.241989ms)
✖ peer@assembly.invalid: in_progress legacy assembly hides all owner contacts and preserves voting history (3.828549ms)
✖ peer@assembly.invalid: closed legacy assembly hides all owner contacts and preserves voting history (3.843431ms)
✖ peer@assembly.invalid: completed legacy assembly hides all owner contacts and preserves voting history (3.588204ms)
✔ Syndic retains historical snapshot and current management contacts; reads never migrate stored history (4.96748ms)
✖ Resident vote response is private and uses frozen 300/700 shares instead of current 600/400 shares (6.923246ms)
✔ Provider cannot cast an owner vote; closed legacy assemblies remain immutable (11.782224ms)
✖ New voting snapshots persist only the voting allowlist; voting and closing remain functional (15.945568ms)
ℹ tests 13
ℹ suites 0
ℹ pass 2
ℹ fail 11
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 99.798137

✖ failing tests:

test at tests/assemblyPrivacy.ts:1:7397
✖ provider: in_progress legacy assembly hides all owner contacts and preserves voting history (9.811387ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:169:9)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:165:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:7397
✖ provider: closed legacy assembly hides all owner contacts and preserves voting history (4.47328ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:169:9)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:165:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:7397
✖ provider: completed legacy assembly hides all owner contacts and preserves voting history (4.1681ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:169:9)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:165:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:7397
✖ one@assembly.invalid: in_progress legacy assembly hides all owner contacts and preserves voting history (4.048048ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:169:9)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:165:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:7397
✖ one@assembly.invalid: closed legacy assembly hides all owner contacts and preserves voting history (4.435435ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:169:9)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:165:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:7397
✖ one@assembly.invalid: completed legacy assembly hides all owner contacts and preserves voting history (4.241989ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:169:9)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:165:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:7397
✖ peer@assembly.invalid: in_progress legacy assembly hides all owner contacts and preserves voting history (3.828549ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:169:9)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:165:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:7397
✖ peer@assembly.invalid: closed legacy assembly hides all owner contacts and preserves voting history (3.843431ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:169:9)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:165:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:7397
✖ peer@assembly.invalid: completed legacy assembly hides all owner contacts and preserves voting history (3.588204ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:169:9)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:165:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:8891
✖ Resident vote response is private and uses frozen 300/700 shares instead of current 600/400 shares (6.923246ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
  
    [
      'apartments',
      'id',
  +   'managerPhone',
      'residents',
      'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:132:10)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:204:5)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:191:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }

test at tests/assemblyPrivacy.ts:1:10412
✖ New voting snapshots persist only the voting allowlist; voting and closing remain functional (15.945568ms)
  AssertionError [ERR_ASSERTION]: Only voter identity and ownership flags may leave the API
  + actual - expected
  
    [
  +   'apartmentId',
  +   'buildingId',
  +   'cin',
  +   'email',
  +   'hasAccount',
      'id',
      'isOwner',
  +   'mustChangePassword',
      'name',
  +   'phone',
  +   'privateContact',
  +   'syndicId'
    ]
  
      at assertPrivateSnapshotAbsent (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:134:12)
      at TestContext.<anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:230:5)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1389:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3)
      at async <anonymous> (/workspace/scratch/1d4188578022/buildmanage-firebase/tests/assemblyPrivacy.ts:220:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: [Array],
    expected: [Array],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

## 02-after-fix.log

Command: `npm run test:assembly-privacy`

Exit code: 0. 13 tests passed; no failures or skips.

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> immogest@0.0.0 test:assembly-privacy
> node --import ./tests/helpers/networkGuard.mjs --import tsx tests/assemblyPrivacy.ts

✔ provider: in_progress legacy assembly hides all owner contacts and preserves voting history (11.019839ms)
✔ provider: closed legacy assembly hides all owner contacts and preserves voting history (6.14746ms)
✔ provider: completed legacy assembly hides all owner contacts and preserves voting history (5.576828ms)
✔ one@assembly.invalid: in_progress legacy assembly hides all owner contacts and preserves voting history (5.698488ms)
✔ one@assembly.invalid: closed legacy assembly hides all owner contacts and preserves voting history (4.140994ms)
✔ one@assembly.invalid: completed legacy assembly hides all owner contacts and preserves voting history (6.451926ms)
✔ peer@assembly.invalid: in_progress legacy assembly hides all owner contacts and preserves voting history (7.06173ms)
✔ peer@assembly.invalid: closed legacy assembly hides all owner contacts and preserves voting history (4.77786ms)
✔ peer@assembly.invalid: completed legacy assembly hides all owner contacts and preserves voting history (2.984343ms)
✔ Syndic retains historical snapshot and current management contacts; reads never migrate stored history (4.943374ms)
✔ Resident vote response is private and uses frozen 300/700 shares instead of current 600/400 shares (7.893406ms)
✔ Provider cannot cast an owner vote; closed legacy assemblies remain immutable (12.678201ms)
✔ New voting snapshots persist only the voting allowlist; voting and closing remain functional (57.162802ms)
ℹ tests 13
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 157.873611
```

## 03-typecheck.log

Command: `npm run typecheck`

Exit code: 0. Frontend/server and Cloud Functions TypeScript checks.

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> immogest@0.0.0 typecheck
> tsc --noEmit && tsc -p functions/tsconfig.json --noEmit

```

## 04-test-verify.log

Command: `npm run test:verify`

Exit code: 0. Existing security, persistence and financial regressions.

```text

> immogest@0.0.0 test:verify
> node --import ./tests/helpers/networkGuard.mjs --import tsx tests/verifyProduction.ts

🔒 Running ImmoGest Security, Persistence & Financial Regression Suite...

✅ [01/03] Password hashing & signed session envelope tamper check passed.
✅ [16] Centime budget allocation (100.00 MAD conserved) & configured 5% reserve passed.
✅ [12] Idempotent monthly charge generation (French + ISO period normalization) passed.
✅ [13] Idempotent payment proof approval, 95/5 MAD reserve ledger split & partial payment reconciliation passed.
✅ [14/16] Read-only missing receipt generation & 5% reserve split passed.
✅ [15] Reserve fund single-counting, zero-balance & legacy opening balance preservation passed.
✅ [20] AG voting session status, attendee eligibility, cross-lot hijack rejection & authoritative tantième weight checks passed.
✅ [Phase 3/4] AG budget-to-charges, CSV bank reconciliation safety, partial quittance & stale-object invoice payment checks passed.
✅ [Auth] Resident & Prestataire credential generation, regeneration, edit preservation & registry sync passed.
✅ [18] Building deletion tombstones & foreground network write failure propagation passed.

🎉 ALL REGRESSION CHECKS PASSED SUCCESSFULLY.
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

## 05-test-business.log

Command: `npm run test:business`

Exit code: 0. Existing payment boundary regressions.

```text

> immogest@0.0.0 test:business
> node --import ./tests/helpers/networkGuard.mjs --import tsx tests/paymentBoundaries.ts

PASS: manual retry identity, conflicting reuse, overpayment, reserve split and missing receipt recovery.
PASS: proof ownership and overpayment are rejected before state changes.
PASS: exact lot identifiers, debit rejection, amount matching and bank-reference reimport.
PASS: stored invoice authority, unique charge linking, idempotency and reserve reconciliation.
PASS: manual and proof payments update the linked invoice; proof receipt recovery never posts twice.
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

## 06-test-cache.log

Command: `npm run test:cache`

Exit code: 0. Existing cache identity and revision regressions.

```text

> immogest@0.0.0 test:cache
> node --import ./tests/helpers/networkGuard.mjs --import tsx tests/cacheBoundaries.ts

PASS: delayed reads and completed mutations cannot refill another identity's cache.
PASS: a delayed refresh cannot overwrite a newer committed mutation.
PASS: same-millisecond journal entries retain unique identities and reconcile exactly.
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

## 07-test-security.log

Command: `npm run test:security`

Exit code: 0. Existing HTTP authorization and private file regressions.

```text

> immogest@0.0.0 test:security
> node --import ./tests/helpers/networkGuard.mjs --import tsx tests/httpBoundaries.ts

PASS: registration isolation, token verification, roles, scoped voting, proof review and private files.
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

## 08-test-production.log

Command: `npm run test:production`

Exit code: 0. Existing production/concurrency/period-lock/voting regressions.

```text

> immogest@0.0.0 test:production
> node --import ./tests/helpers/networkGuard.mjs --import tsx tests/productionReadiness.ts

PASS: malformed snapshot denial, record ownership and provider/resident completion.
PASS: cross-process concurrent payments, exact fund split, retries, rollback, reversals and period locks.
PASS: scoped finance exports, private files, safe upload types and server-owned chat identity.
PASS: server-owned voting roll, named-lot weights, immutable finalized results.
PASS: account email changes regenerate strong invitations, encrypt retry data and revoke previous sessions.
PASS: backend expiry, separate platform subscription receipts and building limit.
PASS: encrypted recovery, single-use tokens, legacy hash upgrade, cross-instance session revocation, unified scheduled billing and restart durability.
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

## 09-test-recovery.log

Command: `npm run test:recovery`

Exit code: 0. Existing encrypted backup and recovery regressions.

```text

> immogest@0.0.0 test:recovery
> node --import ./tests/helpers/networkGuard.mjs --import tsx tests/adminRecovery.ts

PASS: encrypted backup, dry run, replacement guard, wrong-key rejection, legacy credential protection and restore session revocation.
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

## 10-lint.log

Command: `npm run lint`

Exit code: 0. Repository-configured linter: eslint firestore.rules.

```text

> immogest@0.0.0 lint
> eslint firestore.rules

npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

## 11-build-functions.log

Command: `npm run build:functions`

Exit code: 0. Cloud Functions compilation.

```text

> immogest@0.0.0 build:functions
> tsc -p functions/tsconfig.json

npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
```

## 12-build.log

Command: `npm run build`

Exit code: 0. Production Express and Vite bundles.

```text

> immogest@0.0.0 build
> npm run build:server && vite build


> immogest@0.0.0 build:server
> esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-server/server.js

vite v6.4.4 building for production...
transforming...
✓ 2960 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                      1.67 kB │ gzip:   0.67 kB
dist/assets/index-C3W-_wrG.css                      85.68 kB │ gzip:  14.04 kB
dist/assets/Announcements-C39v8rHj.js                5.66 kB │ gzip:   2.33 kB
dist/assets/Settings-DVUUSQHJ.js                     5.77 kB │ gzip:   2.01 kB
dist/assets/Analytics-CQfOR6_v.js                    7.86 kB │ gzip:   2.72 kB
dist/assets/Documents-Dah4KIWK.js                    9.34 kB │ gzip:   3.37 kB
dist/assets/icons-DWKaEOzm.js                       10.82 kB │ gzip:   2.95 kB
dist/assets/CommunityChat-xdt2ag1M.js               14.22 kB │ gzip:   4.94 kB
dist/assets/Dashboard-D3E7n6Ov.js                   15.02 kB │ gzip:   4.66 kB
dist/assets/Buildings-zdnUGP3j.js                   18.53 kB │ gzip:   5.66 kB
dist/assets/ServiceProvidersDirectory-BSGBlY0e.js   20.83 kB │ gzip:   6.80 kB
dist/assets/Residents-CvPcXkgt.js                   26.81 kB │ gzip:   7.33 kB
dist/assets/ResidentAGVoting-DvMRe1Gh.js            28.34 kB │ gzip:   7.98 kB
dist/assets/Apartments-CQZTUxTa.js                  28.55 kB │ gzip:   7.47 kB
dist/assets/purify.es-CAi2OJFm.js                   30.47 kB │ gzip:  11.73 kB
dist/assets/Prestataires-X_-jEGv7.js                33.00 kB │ gzip:   8.86 kB
dist/assets/AssembleeGenerale-BZeX4iO_.js           33.71 kB │ gzip:   9.46 kB
dist/assets/Maintenance-B7lN5Va1.js                 41.87 kB │ gzip:  12.22 kB
dist/assets/MarketplaceView-DwwM520Q.js             45.67 kB │ gzip:  13.00 kB
dist/assets/vendor-DAKuxKMx.js                      93.84 kB │ gzip:  30.55 kB
dist/assets/Financials-BWLbw5gm.js                 100.78 kB │ gzip:  24.24 kB
dist/assets/index.es-DoOkqn1n.js                   159.77 kB │ gzip:  53.55 kB
dist/assets/html2canvas.esm-QH1iLAAe.js            202.38 kB │ gzip:  48.04 kB
dist/assets/pdf-B1osmd6d.js                        391.44 kB │ gzip: 129.14 kB
dist/assets/charts-DyG5E_2K.js                     410.93 kB │ gzip: 111.48 kB
dist/assets/firebase-BFWyMyIu.js                   687.09 kB │ gzip: 171.57 kB
dist/assets/index-DumRZrqa.js                      882.77 kB │ gzip: 301.84 kB
✓ built in 7.25s
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

  dist-server/server.js  305.3kb

⚡ Done in 24ms
```

## 13-test-ui.log

Command: `npm run test:ui`

Exit code: 0. 32 passed; 1 cloud-only case skipped here and passed in the cloud-backed run below.

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> immogest@0.0.0 test:ui
> playwright test


Running 33 tests using 1 worker

(node:31) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓   1 tests/ui/residentForms.spec.ts:294:1 › typing preserves focus and caret in payment and marketplace forms; dialog keyboard controls still work (5.4s)
  ✓   2 tests/ui/residentForms.spec.ts:368:1 › receipt picker opens by click and keyboard, confirms the file, and resets only when removed or reopened (2.3s)
  -   3 tests/ui/residentForms.spec.ts:420:1 › storage permission and missing-bucket failures explain the problem without losing the payment form
  ✓   4 tests/ui/residentForms.spec.ts:448:1 › resident uploads a private receipt, sees errors, retries once, and syndic approves the remaining balance (3.4s)
  ✓   5 tests/ui/residentForms.spec.ts:599:1 › a rejected proof can be resubmitted from the exact charge on mobile in Arabic (4.3s)
  ✓   6 tests/ui/residentForms.spec.ts:693:1 › building creation explains missing fields, keeps the draft on failure and closes only after saving (3.4s)
  ✓   7 tests/ui/residentForms.spec.ts:713:1 › lot and resident forms retain drafts on failures and persist complete records (4.4s)
  ✓   8 tests/ui/residentForms.spec.ts:744:1 › maintenance validates required fields, preserves failed reports and saves the selected urgency (2.7s)
  ✓   9 tests/ui/residentForms.spec.ts:764:1 › announcements, provider and assembly forms explain missing information and save real data (5.8s)
  ✓  10 tests/ui/residentForms.spec.ts:803:1 › expense form saves a positive input as one negative ledger entry (2.1s)
  ✓  11 tests/ui/residentForms.spec.ts:821:1 › Arabic mobile form validation is visible, focuses the missing field and does not overflow (2.6s)
  ✓  12 tests/ui/residentForms.spec.ts:835:1 › password recovery errors stay inside the dialog and short reset passwords are explained (886ms)
  ✓  13 tests/ui/residentForms.spec.ts:851:1 › retry after a lost publication response reuses the upload and does not create a duplicate listing (1.7s)
  ✓  14 tests/ui/residentForms.spec.ts:882:1 › document upload rejects unsupported files and previews the actual private PDF (2.7s)
  ✓  15 tests/ui/residentForms.spec.ts:898:1 › cabinet settings and chat preserve input after errors and save successfully on retry (4.0s)
  ✓  16 tests/ui/residentForms.spec.ts:924:1 › admin cabinet creation validates and retries, and provider reports require a note before saving (2.4s)
  ✓  17 tests/ui/residentForms.spec.ts:953:1 › monthly charges use the period selected in the form (1.9s)
  ✓  18 tests/ui/residentForms.spec.ts:965:1 › 250 MAD monthly fees stay fixed as residents are added and opening setup unlocks payment approval (5.1s)
  ✓  19 tests/ui/residentForms.spec.ts:1070:1 › server validation returns safe field details instead of an unexplained save failure (97ms)
  ✓  20 tests/ui/residentForms.spec.ts:1083:1 › temporary session failures preserve credentials and offer retry instead of silently logging out (3.8s)
  ✓  21 tests/ui/residentForms.spec.ts:1098:1 › connection retry verifies the saved session without reloading and transient outages recover automatically (6.3s)
  ✓  22 tests/ui/residentForms.spec.ts:1123:1 › a newly created provider is assigned by ID through the maintenance form and can be unassigned (4.5s)
  ✓  23 tests/ui/residentForms.spec.ts:1163:1 › offline recovery preserves an open form and live changes appear without page navigation (2.9s)
  ✓  24 tests/ui/residentForms.spec.ts:1187:1 › live state changes update separate resident and syndic sessions through payment approval (3.8s)
  ✓  25 tests/ui/residentForms.spec.ts:1250:1 › live updates fall back to background reads when the event stream is unavailable (3.0s)
  ✓  26 tests/ui/residentForms.spec.ts:1268:1 › authenticated live events publish committed revisions without exposing business records (133ms)
  ✓  27 tests/ui/residentForms.spec.ts:1310:1 › database read failures offer recovery instead of claiming the account has no cabinet (3.8s)
  ✓  28 tests/ui/residentForms.spec.ts:1321:1 › every syndic module renders through an authenticated navigation without browser exceptions (15.9s)
  ✓  29 tests/ui/residentForms.spec.ts:1337:1 › owner and tenant can visit every resident module and cannot enter admin or syndic routes (7.0s)
  ✓  30 tests/ui/residentForms.spec.ts:1370:1 › maintenance assignment, private attachments, completion, notifications and accounting remain connected across roles (459ms)
  ✓  31 tests/ui/residentForms.spec.ts:1403:1 › private chat attachments reach the named recipient and stay private to other accounts (278ms)
  ✓  32 tests/ui/residentForms.spec.ts:1417:1 › deployment diagnostics expose safe configuration to managers and deny other roles (261ms)
  ✓  33 tests/ui/residentForms.spec.ts:1432:1 › building archive confirmation preserves records and the archive view restores the building (3.2s)

  1 skipped
  32 passed (1.9m)
```

## 14-test-auth.log

Command: `npm run test:auth`

Exit code: 0. 51 checks using the real local Firebase Authentication emulator.

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> immogest@0.0.0 test:auth
> firebase emulators:exec --project demo-buildmanage --only auth "node --import ./tests/helpers/networkGuard.mjs --import tsx tests/firebaseAuthentication.ts"

i  emulators: Starting emulators: auth
i  emulators: Detected demo project ID "demo-buildmanage", emulated services will use a demo configuration and attempts to access non-emulated services for this project will fail.
i  Running script: node --import ./tests/helpers/networkGuard.mjs --import tsx tests/firebaseAuthentication.ts
i  To verify the email address new@example.test, follow this link: http://127.0.0.1:9098/emulator/action?mode=verifyEmail&lang=en&oobCode=kk0iDbZcZ0SlMuihEqkRRdZuGlp_6SZ6-XKAxcj1sMV1KkftuuxAPc&apiKey=fake-api-key&continueUrl=http%3A%2F%2Flocalhost%3A40177%2Flogin
i  To verify the email address resident@example.test, follow this link: http://127.0.0.1:9098/emulator/action?mode=verifyEmail&lang=en&oobCode=_xSX3rzx2rjvZtVe-Nbtrm6as7DAJs6mWWa3pgtUUgUPLAFisdFX3w&apiKey=fake-api-key&continueUrl=http%3A%2F%2Flocalhost%3A40177%2Flogin
i  To reset the password for recovery@example.test, follow this link: http://127.0.0.1:9098/emulator/action?mode=resetPassword&lang=en&oobCode=XRaT8pjk6vzjBttttZpHuIDIjehcsEq_mTF7tAbxAIR5jYj77A7D80&apiKey=fake-api-key&continueUrl=http%3A%2F%2Flocalhost%3A40177%2Flogin&newPassword=NEW_PASSWORD_HERE
i  To reset the password for new@example.test, follow this link: http://127.0.0.1:9098/emulator/action?mode=resetPassword&lang=en&oobCode=IDGMBL6zJj39JVoEnQspA0DtY5dd6N9fKROh6s603_U3h5_OrPU2ut&apiKey=fake-api-key&continueUrl=http%3A%2F%2Flocalhost%3A40177%2Flogin&newPassword=NEW_PASSWORD_HERE
Firebase Authentication integration passed (51 checks, real local Auth emulator).
✔  Script exited successfully (code 0)
i  emulators: Shutting down emulators.
i  auth: Stopping Authentication Emulator
i  hub: Stopping emulator hub
i  logging: Stopping Logging Emulator
```

## 15-test-emulator.log

Command: `npm run test:emulator`

Exit code: 0. Runs npm run test:integration against local Firestore, including denied browser access.

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> immogest@0.0.0 test:emulator
> firebase emulators:exec --project demo-buildmanage --only firestore "npm run test:integration"

i  emulators: Starting emulators: firestore
i  emulators: Detected demo project ID "demo-buildmanage", emulated services will use a demo configuration and attempts to access non-emulated services for this project will fail.
i  firestore: Firestore Emulator logging to firestore-debug.log
✔  firestore: Firestore Emulator was started in standard edition.
✔  firestore: Firestore Emulator UI websocket is running on 9150.
i  Running script: npm run test:integration
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> immogest@0.0.0 test:integration
> node --import tsx tests/firestoreIntegration.ts

PASS: live revision listener observes commits from another Firestore repository.
[2026-10-23T21:23:53.326Z]  @firebase/firestore: Firestore (12.19.0): GrpcConnection RPC 'Write' stream 0x3556b375 error. Code: 7 Message: 7 PERMISSION_DENIED: 
false for 'create' @ L6, false for 'update' @ L6
[2026-10-23T21:23:53.351Z]  @firebase/firestore: Firestore (12.19.0): GrpcConnection RPC 'Write' stream 0x3556b376 error. Code: 7 Message: 7 PERMISSION_DENIED: 
false for 'create' @ L6, false for 'update' @ L6
[2026-10-23T21:23:53.385Z]  @firebase/firestore: Firestore (12.19.0): GrpcConnection RPC 'Write' stream 0x3556b378 error. Code: 7 Message: 7 PERMISSION_DENIED: 
false for 'create' @ L6, false for 'update' @ L6
[2026-10-23T21:23:53.392Z]  @firebase/firestore: Firestore (12.19.0): GrpcConnection RPC 'Write' stream 0x3556b379 error. Code: 7 Message: 7 PERMISSION_DENIED: 
false for 'create' @ L6, false for 'update' @ L6
[2026-10-23T21:23:53.420Z]  @firebase/firestore: Firestore (12.19.0): GrpcConnection RPC 'Write' stream 0x3556b37b error. Code: 7 Message: 7 PERMISSION_DENIED: 
false for 'create' @ L6, false for 'update' @ L6
[2026-10-23T21:23:53.428Z]  @firebase/firestore: Firestore (12.19.0): GrpcConnection RPC 'Write' stream 0x3556b37c error. Code: 7 Message: 7 PERMISSION_DENIED: 
false for 'create' @ L6, false for 'update' @ L6
PASS: Firestore staged bulk writes, repeated history identities, Unicode chunks, cross-repository concurrency, rollback and denied browser reads/writes.
PASS: large generation replacement commits without read locks or revision resets.
✔  Script exited successfully (code 0)
i  emulators: Shutting down emulators.
i  firestore: Stopping Firestore Emulator
i  hub: Stopping emulator hub
i  logging: Stopping Logging Emulator
```

## 16-test-auth-browser.log

Command: `npm run test:auth:browser`

Exit code: 0. Chromium registration, SDK sign-in, resend, persistence and email verification.

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> immogest@0.0.0 test:auth:browser
> firebase emulators:exec --project demo-buildmanage --only auth "node --import ./tests/helpers/networkGuard.mjs --import tsx tests/firebaseAuthBrowser.ts"

i  emulators: Starting emulators: auth
i  emulators: Detected demo project ID "demo-buildmanage", emulated services will use a demo configuration and attempts to access non-emulated services for this project will fail.
i  Running script: node --import ./tests/helpers/networkGuard.mjs --import tsx tests/firebaseAuthBrowser.ts
i  To verify the email address browser@example.test, follow this link: http://127.0.0.1:9098/emulator/action?mode=verifyEmail&lang=en&oobCode=bvaXYTFtoJnybgYV2-ZkgIjG-kfPu7ymH7VrqTkdFTh1lUbWfJ-d1b&apiKey=fake-api-key&continueUrl=http%3A%2F%2F127.0.0.1%3A38255%2Flogin
i  To verify the email address browser@example.test, follow this link: http://127.0.0.1:9098/emulator/action?mode=verifyEmail&lang=en&oobCode=UqWYPz2nfjrVNWsc3OBx_Y4WQtKinMllxL3-Y-KcXTHqxe8Ais0qtO&apiKey=fake-api-key&continueUrl=http%3A%2F%2F127.0.0.1%3A38255%2Flogin
Firebase browser registration, SDK sign-in, resend, persistence and verification passed.
✔  Script exited successfully (code 0)
i  emulators: Shutting down emulators.
i  auth: Stopping Authentication Emulator
i  hub: Stopping emulator hub
i  logging: Stopping Logging Emulator
```

## 17-test-ui-cloud.log

Command: `npx firebase emulators:exec --project demo-buildmanage --only firestore "npm run test:ui:cloud"`

Exit code: 0. 33 passed against local Firestore and the Admin Storage SDK adapter.

```text
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
i  emulators: Starting emulators: firestore
i  emulators: Detected demo project ID "demo-buildmanage", emulated services will use a demo configuration and attempts to access non-emulated services for this project will fail.
i  firestore: Firestore Emulator logging to firestore-debug.log
✔  firestore: Firestore Emulator was started in standard edition.
✔  firestore: Firestore Emulator UI websocket is running on 9150.
i  Running script: npm run test:ui:cloud
npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.

> immogest@0.0.0 test:ui:cloud
> node tests/helpers/runCloudUi.mjs


Running 33 tests using 1 worker

(node:115) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
  ✓   1 tests/ui/residentForms.spec.ts:294:1 › typing preserves focus and caret in payment and marketplace forms; dialog keyboard controls still work (5.4s)
  ✓   2 tests/ui/residentForms.spec.ts:368:1 › receipt picker opens by click and keyboard, confirms the file, and resets only when removed or reopened (2.0s)
  ✓   3 tests/ui/residentForms.spec.ts:420:1 › storage permission and missing-bucket failures explain the problem without losing the payment form (1.5s)
  ✓   4 tests/ui/residentForms.spec.ts:448:1 › resident uploads a private receipt, sees errors, retries once, and syndic approves the remaining balance (3.4s)
  ✓   5 tests/ui/residentForms.spec.ts:599:1 › a rejected proof can be resubmitted from the exact charge on mobile in Arabic (4.2s)
  ✓   6 tests/ui/residentForms.spec.ts:693:1 › building creation explains missing fields, keeps the draft on failure and closes only after saving (3.5s)
  ✓   7 tests/ui/residentForms.spec.ts:713:1 › lot and resident forms retain drafts on failures and persist complete records (4.3s)
  ✓   8 tests/ui/residentForms.spec.ts:744:1 › maintenance validates required fields, preserves failed reports and saves the selected urgency (2.7s)
  ✓   9 tests/ui/residentForms.spec.ts:764:1 › announcements, provider and assembly forms explain missing information and save real data (6.3s)
  ✓  10 tests/ui/residentForms.spec.ts:803:1 › expense form saves a positive input as one negative ledger entry (2.3s)
  ✓  11 tests/ui/residentForms.spec.ts:821:1 › Arabic mobile form validation is visible, focuses the missing field and does not overflow (2.7s)
  ✓  12 tests/ui/residentForms.spec.ts:835:1 › password recovery errors stay inside the dialog and short reset passwords are explained (868ms)
  ✓  13 tests/ui/residentForms.spec.ts:851:1 › retry after a lost publication response reuses the upload and does not create a duplicate listing (2.2s)
  ✓  14 tests/ui/residentForms.spec.ts:882:1 › document upload rejects unsupported files and previews the actual private PDF (2.7s)
  ✓  15 tests/ui/residentForms.spec.ts:898:1 › cabinet settings and chat preserve input after errors and save successfully on retry (4.0s)
  ✓  16 tests/ui/residentForms.spec.ts:924:1 › admin cabinet creation validates and retries, and provider reports require a note before saving (2.4s)
  ✓  17 tests/ui/residentForms.spec.ts:953:1 › monthly charges use the period selected in the form (1.8s)
  ✓  18 tests/ui/residentForms.spec.ts:965:1 › 250 MAD monthly fees stay fixed as residents are added and opening setup unlocks payment approval (5.1s)
  ✓  19 tests/ui/residentForms.spec.ts:1070:1 › server validation returns safe field details instead of an unexplained save failure (158ms)
  ✓  20 tests/ui/residentForms.spec.ts:1083:1 › temporary session failures preserve credentials and offer retry instead of silently logging out (3.6s)
  ✓  21 tests/ui/residentForms.spec.ts:1098:1 › connection retry verifies the saved session without reloading and transient outages recover automatically (6.7s)
  ✓  22 tests/ui/residentForms.spec.ts:1123:1 › a newly created provider is assigned by ID through the maintenance form and can be unassigned (4.5s)
  ✓  23 tests/ui/residentForms.spec.ts:1163:1 › offline recovery preserves an open form and live changes appear without page navigation (2.9s)
  ✓  24 tests/ui/residentForms.spec.ts:1187:1 › live state changes update separate resident and syndic sessions through payment approval (3.9s)
  ✓  25 tests/ui/residentForms.spec.ts:1250:1 › live updates fall back to background reads when the event stream is unavailable (2.9s)
  ✓  26 tests/ui/residentForms.spec.ts:1268:1 › authenticated live events publish committed revisions without exposing business records (181ms)
  ✓  27 tests/ui/residentForms.spec.ts:1310:1 › database read failures offer recovery instead of claiming the account has no cabinet (4.0s)
  ✓  28 tests/ui/residentForms.spec.ts:1321:1 › every syndic module renders through an authenticated navigation without browser exceptions (15.3s)
  ✓  29 tests/ui/residentForms.spec.ts:1337:1 › owner and tenant can visit every resident module and cannot enter admin or syndic routes (6.8s)
  ✓  30 tests/ui/residentForms.spec.ts:1370:1 › maintenance assignment, private attachments, completion, notifications and accounting remain connected across roles (811ms)
  ✓  31 tests/ui/residentForms.spec.ts:1403:1 › private chat attachments reach the named recipient and stay private to other accounts (377ms)
  ✓  32 tests/ui/residentForms.spec.ts:1417:1 › deployment diagnostics expose safe configuration to managers and deny other roles (336ms)
  ✓  33 tests/ui/residentForms.spec.ts:1432:1 › building archive confirmation preserves records and the archive view restores the building (3.2s)

  33 passed (1.9m)
✔  Script exited successfully (code 0)
i  emulators: Shutting down emulators.
i  firestore: Stopping Firestore Emulator
i  hub: Stopping emulator hub
i  logging: Stopping Logging Emulator
```
