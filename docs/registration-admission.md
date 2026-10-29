# Registration admission controls

`server/registrationAdmission.ts` runs before wrapped registration and verification-resend routes, platform repository transactions, Firebase identity calls, and outbox dispatch. HTTP 429 includes `AUTH_RATE_LIMITED`, `ok: false`, `retryAfter` seconds, and the matching `Retry-After` header. The existing authenticated one-minute resend cooldown uses the same response shape.

Defaults use sliding windows:

| Scope | Registration | Verification resend |
| --- | --- | --- |
| Client IP / hour | 10 | 20 |
| Normalized identity / hour | 3 | 5 |
| Entire deployment / hour | 500 | 1000 |

Up to 200 distinct registration identities may reserve admission in a rolling 24-hour window. This is a conservative ceiling on newly pending/unverified registrations within that window: admitted failures, uncertain outcomes and subsequently verified accounts retain reservations until expiry. Retries for an existing reserved identity still consume IP/email/hour quotas. This avoids releasing capacity before an uncertain identity creation is resolved. It is not a count of all historical unverified Firebase accounts. Tune constants in `ADMISSION_LIMITS` after reviewing legitimate traffic and operational capacity.

Production Firestore uses the independent Admin-only `platform_admission/registration_v1` document with atomic Firestore transactions. It never loads platform state or changes its revision. Every instance must use the same database. Records contain SHA-256 hashes and timestamps, not raw emails/IPs, passwords or tokens. Hourly global caps bound the attempt array to 1500 rows; reservations are bounded to 200. Expired rows are pruned on admission; no TTL or extra indexes are required. A single document favors correctness at modest registration volume; sustained contention fails closed with HTTP 503 and Retry-After 30, rather than falling back to per-instance counters. An edge/WAF limit remains useful to protect this small shared-store read from volumetric attacks.

File mode uses `SYNDIK_DATA_DIR/admission/registration.json`, an independent small atomic file with a cross-process directory lock. Processes sharing that directory share limits. Separate local disks do not share limits: multi-instance deployments must use Firestore. A crashed file-mode process can leave an admission lock; after confirming no process owns it, remove that lock to recover. Store errors fail closed with `AUTH_ADMISSION_UNAVAILABLE`, before platform access.

IP selection uses Express `req.ip`. Keep `TRUST_PROXY_HOPS` matched to the actual ingress chain; the default 0 ignores forwarded headers. Never trust arbitrary client forwarding headers. Registration identities are trimmed/lowercased. Resend uses a locally verified server-session identity where available; Firebase JWT email/sub claims are only pre-authentication quota hints (stable across refresh), never authorization. The route still authenticates and checks its own per-account cooldown. Invalid/missing identities share an unknown bucket; arbitrary claims cannot bypass the IP/global caps or cause mail delivery without authentication.

Validation: `npm run test:security` includes real-route burst rejection with unreadable platform state, HTTP middleware counters proving no downstream repository/Firebase calls on rejected requests, normalized-email and IP quotas, resend identity stability, store failure behavior, reservation expiry, and concurrent independent file-store instances.
