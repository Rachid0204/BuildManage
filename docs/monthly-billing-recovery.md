# Monthly billing recovery

Each invocation stores a `__billingRuns` record with its ID, billing period, request ID, timestamps, completion status, counts, and tenant/building results. Each result includes attempts and a safe failure reason/code. Per-building transactions still commit charges, invoices, and notifications together. Progress is saved between buildings and before transient retry waits.

## Retry policy

- Domain/configuration errors (closed periods, invalid weights, missing payers) and dependency access/missing-resource errors require correction. They are recorded without automatic building retries.
- Dependency unavailability, rate limiting, and unexpected errors are retried up to three building attempts, waiting 1 then 2 seconds outside transactions.
- The HTTP job returns 503 when any failed result is retryable. Configuration-only failures return 200 with `ok: false`; the scheduled function explicitly logs them as errors without retrying them.
- The scheduled function makes at most three backend requests, waiting 5 then 10 seconds, each with a 120-second timeout. When a previous run ID is available, only its transient failed buildings are selected. A lost response safely replays the original period under the existing charge identity. The maximum is nine building attempts in one scheduled invocation.
- The month is derived from the event timestamp in Africa/Casablanca, so retries cannot switch to a different month. Retries happen inside the function; Pub/Sub publication success alone does not indicate billing success.
- Exhausted infrastructure failures throw from the scheduled function and remain visible in logs and stored runs. If the database is unavailable even for summary persistence, the request fails and logs the error; a summary cannot be guaranteed until storage recovers.

## Manager recovery

The financial view lists up to 50 failed runs for the selected building, including reasons and attempt counts. Correct the configuration, then choose **Relancer cet immeuble**. The server checks manager role and cabinet/building scope, accepts only a building that failed in the selected run, and uses that run's period. Successful later issuance marks the failure as resolved. Charges, invoices, and notifications from successful buildings are preserved on replay.

The endpoints are `GET /api/billing-runs?syndicId=…&buildingId=…` and `POST /api/billing-runs/retry` with `{runId, syndicId, buildingId}`. Billing history is internal state, excluded from shared-state exports; the history endpoint projects only the authorized building's results.
