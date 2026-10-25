# Durable Firebase identity mutations (C5)

Firestore repository callbacks may run up to twelve times under contention.
Firebase Auth mutations cannot participate in that transaction or roll back with it.
All server credential mutations therefore use a three-phase intent workflow.

1. **Prepare and commit.** Run the full authorized application handler, recording
   Firebase actions instead of executing them. Commit the intended account state,
   operation receipt and private `__firebaseMutations_v1` intent atomically. A
   private `__firebaseMutationLocks_v1` UID index gates pending accounts without
   scanning historical intents on ordinary authenticated reads. The
   operation UUID is allocated outside the retry callback; only the winning attempt's
   arguments survive. Scope, actor, target UIDs and creation time accompany it.
   Passwords, step results and the canonical response are AES-GCM encrypted with the
   existing stable `SYNDIK_SERVER_SECRET`. The request fingerprint is keyed HMAC;
   passwords and authorization headers are not stored in plaintext.
2. **Execute outside transactions.** Claim a five-minute lease, then run Firebase
   create/password/revocation/login/email steps outside the repository callback.
   Checkpoint each completed step before proceeding. Every action checks the exact
   Firebase UID/email binding; creation retries never overwrite an existing user.
   The account remains unavailable for login, session restoration and conflicting
   credential edits until finalization. Unrelated accounts remain usable.
3. **Finalize.** Mark the intent finalized, remove its encrypted action payload and
   refresh the canonical response/session metadata in a short transaction. Success
   is returned only after this commit. Existing command IDs retain their original
   invitation secret and operation receipt, including across renewed manager tokens.

## Failure and recovery

An aborted prepare/validation/commit performs no external mutation. After a committed
intent, an SDK/checkpoint/finalization error leaves the account pending and returns
`IDENTITY_MUTATION_PENDING` (503, or 409 for a competing or leased operation). The
matching original request can resume the same intent without minting a new secret.
Authenticated resumptions still verify signature, expiry, membership and the saved
session-version barrier. A refreshed manager token can resume its pending command
receipt after normal authentication; it cannot return that receipt as success early.

The existing protected `/api/jobs/outbox` dispatcher also resumes up to ten available
identity intents. Its existing five-minute Cloud Function schedule supplies the
scheduler secret; no new schedule or public recovery endpoint is introduced. A
live lease blocks another worker. A crash leaves an expiring lease and the durable
intent available to a later worker. Recovering one failed intent does not prevent
attempting the others.

**Delivery guarantee:** Firestore callback retries do not replay Firebase effects.
A crash after Firebase accepts a request but before its checkpoint is inherently
ambiguous: Firebase Auth has no caller-supplied idempotency key. That uncertain step
may repeat with the same UID and credential; completed checkpoints do not repeat.
Password changes are sets to the same value, account creation reconciles UID/email,
and repeated revocation is fail-closed while the account is pending. Pending intents
block newer credential changes, and finalized intents are never redispatched. Email
delivery may repeat after an ambiguous failure. This is resumable convergence, not
an exactly-once claim across a provider/network crash.

The five-minute lease exceeds the installed Admin SDK's normal bounded retry budget
(25-second Auth requests, up to four retries). The repository lease is not a Firebase
fencing token: an arbitrarily delayed provider request cannot be made transactional.
Do not delete a pending intent or manually unlock an account while investigating an
uncertain provider operation. A permanent UID/email collision stays pending for
operator reconciliation rather than overwriting someone else's identity.

## Compatibility and verification

No migration or historical account/financial rewrite is required. The private map is
created only when a credential mutation is committed and excluded from shared-state
projections. Legacy local-only accounts keep their existing path; migration creates
the Firebase identity after the intent commits, preserving the application UID.
Registration, password recovery, temporary credentials and logout keep their existing
HTTP response shapes. Keep the stable server encryption key across instances/restarts.

`npm run test:auth-concurrency` uses real local demo Auth/Firestore emulators and a
test-only preload to inject a conflict at the real Firestore commit boundary. The
production server has no fault-injection route or configuration. CI runs this suite
in addition to existing Auth, security, financial, browser and cloud simulation gates.
