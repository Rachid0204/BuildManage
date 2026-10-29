# A3: client transport and strict command boundaries

The production browser now reads server-projected snapshots and submits authenticated commands. It no longer contains a local mutation engine, direct Firestore/Functions adapters, credential migration writes, or financial posting implementations.

## Module ownership

- `firebase/services.ts`: typed public query selectors and command wrappers, including upload and vote transport.
- `firebase/transport.ts`: authenticated requests, memory snapshot hydration, revision ordering, deadlines, identity changes, and durable retry/upload recovery. `firebase/liveSync.ts` validates SSE revision messages before synchronization.
- `shared/api/commands.ts`: explicit method signatures and operation-discriminated request/response unions. Callers cannot select an arbitrary result type or invoke internal financial helpers.
- `server/domain/commandContracts.ts`: known-operation wire envelopes and backend tuple framing. The coordinator still owns object validation, capability checks, scope and accounting policy. Historical receipt lookup precedes validation against the current operation catalog, so removed operations can still recover committed results.
- `server/domain/dispatch.ts`: a typed, exhaustive switch over public methods. The unused dynamically populated peer registry is removed.
- `tests/fixtures/legacy/`: the frozen legacy oracle and its Node storage/SDK adapters. Existing legacy regression callers now import these fixtures explicitly; HTTP recovery/cache tests continue exercising the production client.

The old `server/domain.ts`, `firebase/serverRuntime.ts`, `firebase/legacyClient.ts`, unused merge/tombstone helpers, and no-op persistence calls are removed from production sources. The browser cache stores server snapshots in memory and strips credential material; mutation requests remain server-authoritative.

## Strictness and regression protection

Both TypeScript configurations enable `strict: true`, without excluding legacy fixtures or suppressing production diagnostics. The resulting fixes handle optional historical fields, absent records, correctly typed Express handlers, and form callback parameter variance.

`tests/commandTypes.ts` contains compile-only negative checks for unknown operations, invalid arguments, mismatched responses and inaccessible internal helpers. `tests/transportBoundaries.test.ts` checks both production import graphs, rejects malformed wire/tuple envelopes, and prohibits explicit `any` and diagnostic suppressions in the client/dispatch contracts. The bundle gate now checks every chunk, including deferred chunks, for legacy modules and Firebase data SDKs.

## Local bundle comparison

Measured with the same lockfile and build environment against main commit `34dc233832ef63ad863af399a503929748b11056`:

| Measure | Before | After |
| --- | ---: | ---: |
| Legacy adapter chunk, gzip bytes | 157,255 | 0 (removed) |
| Initial JavaScript graph, gzip bytes | 235,626 | 200,846 |
| All emitted JavaScript, gzip bytes | 1,034,780 | 844,505 |

The client service source shrank from approximately 3,600 lines to 730 lines of typed selectors and wrappers, with retry/snapshot transport in a separate module. Production bundle and all 12 bundle-budget checks pass locally. Full validation also includes strict TypeScript, backend/kernel parity, financial invariants, HTTP/security/recovery regressions, Firebase emulator/browser suites, compiled startup, and the Docker smoke workflow.
