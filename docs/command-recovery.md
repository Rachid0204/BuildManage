# Browser command recovery

Before sending a command (including upload preparation), the client writes an identity-scoped record to sessionStorage. It contains an operation ID, command name, safe target IDs, timestamp, SHA-256 request fingerprint and any already-uploaded private file references. It never stores arguments, response bodies, passwords, authentication tokens or file blobs. The fingerprint matches a resubmitted form without retaining its values. Session storage survives a tab reload but is intentionally not shared across independent tabs or retained after the tab is closed.

Unresolved requests are checked **before resubmission** using authenticated `POST /api/operations/status` with the original operation ID. The UI displays a checking-result status while this request is pending.

- A completed receipt restores the original result and current authorized state without sending the command again.
- A missing, unexpired receipt permits retry with the same operation ID and uploaded file references. This remains safe if the original request commits after the status check: backend receipt fingerprint validation and transaction serialization still apply.
- Pending identity finalization, status lookup failures, expired receipts, and incompatible authorization scopes block resubmission. They do not silently mint a new operation ID.
- A changed form for the same unresolved command/target must first resolve the earlier request. If it completed, the user reviews the refreshed state before submitting a new command.
- Known validation rejections clear pending metadata; network uncertainty, timeouts, authentication failures, conflicts and throttling retain it.
- Storage failures block dispatch. Capacity is bounded to 100 outstanding records and 64 KiB per user rather than evicting unresolved requests.

`/api/operations/status` uses the authenticated UID as the receipt namespace and verifies the role/cabinet/resident/provider scope captured at execution. It does not execute commands, expose another user's receipt, or declare an unfinished Firebase identity plan successful. Existing receipt-retention rules apply: expired operations require checking the business records rather than automatic replay with a new ID.

Mutation, upload, voting, and operation-status requests have a 15-second AbortController deadline covering both headers and body consumption, matching state synchronization. Identity changes abort outstanding requests and prevent delayed responses from populating another identity's cache. Aborting a browser request does not imply a server rollback; pending metadata is retained for recovery.

Verification includes real HTTP commit-then-response-loss recovery, cross-user receipt isolation, same-ID replay after an uncommitted interruption, preserved uploaded references, storage failure, timeouts, identity changes, and pending/expired receipt handling. The browser publication regression reloads the tab before resubmission.
