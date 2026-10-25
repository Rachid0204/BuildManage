# A5 operational lifecycle

A5 implementation. Deployment and merge remain subject to review.

- Command responses: sliding 14-day retention, at most 100 examined per invocation.
  Retries refresh lastAccessAt; pending identity intents and leases are retained.
  New browser/Functions command IDs include their creation timestamp. Expired
  unknown IDs return 410 rather than replaying mutations. Legacy commands have a
  persisted 14-day transition window before unknown legacy IDs require refresh.
  All existing receipts are retained throughout that transition, including legacy
  identifiers that happen to resemble the new timestamped format.
- Generation staging: parent metadata exists before record writes, with heartbeat
  updates. After 24 hours of inactivity a collector transaction checks the active
  generation and claims obsolete trees. Staging and activation check the claim.
  Each pass discovers at most 100 legacy record references, examines 10 parent
  markers and deletes at most 100 records. Legacy unmarked trees get a 24-hour
  discovery grace period. Active generation and legacy platform_state stay intact.
- Uploads: a 7-day grace period, 50 candidates per pass, conservative references
  across all persisted business data, including archived finance/AG records.
  Claims and finalization are batched: at most three repository snapshots per
  50-file page, rather than two per object. Deletion claims commit before byte
  deletion and block new references. Failed
  removals remain retryable; GCS generation preconditions preserve replaced objects.
  Pending identity mutations conservatively defer file collection.
- Encryption: new values use v1: followed by the existing AES-GCM payload. Legacy
  unprefixed ciphertext still decrypts using the unchanged server key. Version v1
  identifies that existing derived key; future versions require an explicit key
  mapping while retaining v1 for old records. Unknown versions fail closed. No
  key rotation is performed.
- A scheduler-secret-protected endpoint and hourly scheduled Function drive work.
  A distributed 10-minute lease and hourly start limit prevent repeated invocation
  spikes. Cloud Function deployment is required to activate the schedule.

The existing repository still loads a complete business snapshot for transactions;
A5 caps cleanup mutations and uses paginated maintenance/storage queries but does
not replace that read architecture (A2). Local development filesystem inventories
use directory reads; production GCS inventories are paginated. Audit logs, ledgers,
receipts, legal archives and durable identity audit intents are not TTL-deleted.

Recovered fail-first run against approved A6: 12 tests, 1 passed, 11 failed.

Rollout: deploy A5 to all active backend writers before enabling the scheduled
cleanup Function. Older revisions do not implement deletion-claim fencing. Keep
old revisions out of traffic while collection is enabled. The existing Firestore
platform_state fallback is deliberately retained for compatibility. Rejected proof
files remain protected while a proof, ledger or audit record still references them.
Retention windows define eligibility; bounded passes may take longer to drain a
backlog. Failed deletion claims are retained for retry and returned as counters.

Verification (2026-10-26):

| Gate | Result |
| --- | --- |
| A5 local / Firestore lifecycle | 15/15 / 18/18 |
| A6 source / compiled contract | 17/17 / 17/17 |
| A4 bundle budget | 11/11 |
| C1 / C2 / C3 / C4 | 13/13 / 21/21 / 25/25 / 21/21 |
| H2 capacity | 18/18 |
| H3 file / Firestore billing | 9/9 / 8/8 |
| H5 file / Firestore controls | 26/26 / 26/26 |
| C5 Firebase concurrency | 16/16 |
| Authentication integration | 54 checks passed |
| Standard browser (including H1 and H6) | 61 passed, 1 cloud-only skip |
| Authentication browser | Passed |
| Cloud-backed browser | 62/62 |
| TypeScript / rules linter / Functions / production build | Passed |

The registered business, payment, cache, HTTP security, production readiness,
recovery and Firestore integration gates also passed. Tests use local emulators,
not the production database or bucket. The configured linter checks Firestore
security rules; it is not a repository-wide TypeScript style check.

An HTTP regression first exposed INTERNAL_ERROR instead of OPERATION_EXPIRED;
error mapping now preserves the explicit 410 code and message. Emulator fixtures
use isolated named databases.

Additional fail-first evidence: the 50-file quota test observed 102 snapshots
before batching, then passed with three. A replacement-object test exposed loss
of the original pending generation; first-claim precedence now preserves the
original deletion precondition, so a replaced object is retained.

Resume verification: the transition regression initially reported 15 tests,
14 passed and 1 failed; preserving all legacy receipts during the grace window
restored 15/15 passing. The Firestore run includes 18/18 passing lifecycle tests,
including staging activation contention and concurrent proof attachment.
