# A5 operational lifecycle

Implementation checkpoint; full verification is pending. Do not deploy or merge yet.

- Command responses: sliding 14-day retention, at most 100 examined per invocation.
  Retries refresh lastAccessAt; pending identity intents and leases are retained.
  New browser/Functions command IDs include their creation timestamp. Expired
  unknown IDs return 410 rather than replaying mutations. Legacy commands have a
  persisted 14-day transition window before unknown legacy IDs require refresh.
- Generation staging: parent metadata exists before record writes, with heartbeat
  updates. After 24 hours of inactivity a collector transaction checks the active
  generation and claims obsolete trees. Staging and activation check the claim.
  Each pass discovers at most 100 legacy record references, examines 10 parent
  markers and deletes at most 100 records. Legacy unmarked trees get a 24-hour
  discovery grace period. Active generation and legacy platform_state stay intact.
- Uploads: a 7-day grace period, 50 candidates per pass, conservative references
  across all persisted business data, including archived finance/AG records.
  Deletion claims commit before byte deletion and block new references. Failed
  removals remain retryable; GCS generation preconditions preserve replaced objects.
  Pending identity mutations conservatively defer file collection.
- Encryption: new values use v1: followed by the existing AES-GCM payload. Legacy
  unprefixed ciphertext still decrypts using the unchanged server key. Unknown
  versions fail closed. This introduces format versioning, not automatic rotation.
- A scheduler-secret-protected endpoint and hourly scheduled Function drive work.
  A distributed 10-minute lease and hourly start limit prevent repeated invocation
  spikes. Cloud Function deployment is required to activate the schedule.

The existing repository still loads a complete business snapshot for transactions;
A5 caps cleanup mutations and uses paginated maintenance/storage queries but does
not replace that read architecture (A2). Local development filesystem inventories
use directory reads; production GCS inventories are paginated. Audit logs, ledgers,
receipts, legal archives and durable identity audit intents are not TTL-deleted.

Recovered fail-first run against approved A6: 12 tests, 1 passed, 11 failed.
