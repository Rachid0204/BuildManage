# AI endpoint contract

Both endpoints authenticate the server session and resolve current records before
reserving processing capacity. A building/cabinet must be active, the caller must
have completed email verification and any required password change, and the
cabinet subscription must be current and `active` or `trialing`. Subscription
checks also apply to Admin AI requests. OCR never approves a payment, posts a
ledger entry, or issues a receipt.

## Announcement drafting

`POST /api/ai/announcement`, JSON `{ "buildingId": "…", "topic": "…" }`.

- Syndic: the building must belong to a cabinet they manage.
- Admin: an explicit active building is required.
- Resident and Prestataire: HTTP 403.
- Topic maximum: 2,000 JavaScript string characters; JSON maximum: 16 KiB.
- A missing server Gemini key returns 503 without consuming a processing quota.
- Success returns `{ "ok": true, "content": "…" }`; publication is a separate command.

## Advisory payment-proof OCR

`POST /api/ai/verify-proof` accepts an `imageBase64` data URL plus:

- Resident: `chargeId` for their own outstanding charge in a currently assigned,
  active owner/tenant lot. An optional `proofId` must refer to that same resident,
  charge, lot and building, and be pending.
- Syndic/Admin: `proofId` for an authorized pending proof. If `chargeId` is also
  supplied, it must match the proof. Managers cannot OCR arbitrary unlinked charges.
- Prestataire: HTTP 403.

An optional `buildingId`/`apartmentId` must match the stored target. Expected
amount/reference/bank are resolved from that target; legacy client `expected*`
fields are ignored. The image is caller-supplied advisory input, not proof of
receipt authenticity or permission to approve the payment. This route does not
fetch arbitrary file URLs.

JSON is limited to 3 MiB. Decoded images are limited to 2 MiB and must use canonical
base64 with a PNG, JPEG or WebP data-URL MIME type and matching file signature.
PDF and other formats are not accepted by this image endpoint.

Responses always set `verified: false`. A model error or an unconfigured OCR
provider returns a confidence-zero heuristic result using stored expectations;
timeouts and oversized provider responses remain explicit errors.

## Consumption and deadlines

Both endpoints share these rolling windows:

| Scope | 60 seconds | 60 minutes | 24 hours |
| --- | ---: | ---: | ---: |
| User, across cabinets | 5 | 20 | 100 |
| Cabinet, across users | 20 | 100 | 500 |

Quota reservations commit atomically in the configured repository before provider
I/O, so instances and restarts share them. Reservations are queued within an
instance to avoid local write contention; other
instances still enforce the same atomic counters. Queue wait is inside the
processing deadline, and abandoned requests are skipped before accessing storage.
Accepted attempts count on provider failure or timeout. Unauthorized/invalid
requests do not. Only timestamps and
internal user/cabinet keys are persisted under `__aiUsage_v1`; image/prompt/model
content is not stored there. Entries older than 24 hours are pruned on reservation.
These private counters are excluded from client shared-state responses. Existing
databases start with empty counters; historical usage is not reconstructed.

`AI_PROCESSING_TIMEOUT_MS` defaults to 20,000 ms; values outside 1,000–30,000 ms
use that default. It bounds body reception and, separately, provider processing.
The processing deadline includes authorization and quota reservation as well as
provider work; aborted reservations cannot later start a provider call.
Processing timeout (504) or client disconnection aborts the actual upstream fetch.
AI calls never hold a repository transaction open. Provider response bytes are
limited to 64 KiB and generation output is capped at 2,048 tokens.

Compressed JSON bodies are refused before decompression. Oversized declared or
streamed bodies return JSON 413 before JSON parsing. Interrupted/slow uploads
return 408; error-path drains have a bounded lifetime.

Errors contain `ok: false`, `code`, `error`, and `requestId`, with the same request
ID in `X-Request-ID`. Quota rejection is 429 / `AI_RATE_LIMITED` and includes
`Retry-After` in seconds. Subscription rejection is 402; unauthorized scopes are
403/404. Cancellable provider connections use the existing Gemini model through
its HTTP protocol; no model/key configuration changes or new dependency are needed.
