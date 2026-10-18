# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Default Deny**: All paths not explicitly matched in `firestore.rules` are denied by default (`match /{document=**} { allow read, write: if false; }`).
2. **Authentication & Verification**: All write operations require an authenticated user (`isSignedIn()`) with verified email (`isVerified()`) or bootstrapped SaaS Admin (`isAdmin()`).
3. **Path Variable Hardening**: Every single-document operation (`get`, `create`, `update`, `delete`) validates its path ID variable with `isValidId(id)` (`id is string && id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$')`).
4. **Strict Blueprint Validation (`isValidSyndic`, `isValidUserProfile`, `isValidPrestataire`)**: Every `create` and `update` operation enforces strict key allowlists (`hasAll` / `hasOnly`), string length bounds (`.size() <= MAX`), array size bounds (`buildings.size() <= 50`), and immutable ownership (`createdBy` / `uid`).
5. **PII & List Query Protection**: `users/{userId}` restricts reads strictly to the document owner (`request.auth.uid == userId`) or `isAdmin()`. Every `allow list` rule enforces `resource.data` ownership or `isAdmin()`.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Write**: `auth = null` attempting `create` on `/syndics/syn-1` -> `PERMISSION_DENIED`.
2. **Unverified Email Spoof**: `auth = { uid: 'u1', token: { email: 'wahbi.rachid@gmail.com', email_verified: false } }` attempting admin write -> `PERMISSION_DENIED`.
3. **Shadow Field Injection**: `create` on `/syndics/syn-1` including `{ isSuperVerified: true }` -> `PERMISSION_DENIED` (blocked by `keys().hasOnly(...)`).
4. **Identity Spoofing on Create**: User `u1` creating `/syndics/syn-1` with `createdBy: 'u2'` -> `PERMISSION_DENIED`.
5. **Self-Assigned Admin Role**: User `u1` creating `/users/u1` with `role: 'admin'` without being bootstrapped admin -> `PERMISSION_DENIED`.
6. **Privilege Escalation on Update**: User `u1` updating `/users/u1` to change `role: 'admin'` -> `PERMISSION_DENIED`.
7. **Owner Mutation on Update**: User `u1` updating `/syndics/syn-1` to change `createdBy: 'u2'` -> `PERMISSION_DENIED`.
8. **ID Poisoning Attack**: Document ID exceeding 128 chars or containing invalid characters -> `PERMISSION_DENIED` (`isValidId` check).
9. **Value Poisoning / Oversized String**: Updating `name` with a 5,000-character string -> `PERMISSION_DENIED` (`name.size() <= 200`).
10. **Unbounded Array Exhaustion**: Updating `buildings` with 100 items -> `PERMISSION_DENIED` (`buildings.size() <= 50`).
11. **PII Blanket Read**: User `u2` attempting `get` on `/users/u1` -> `PERMISSION_DENIED`.
12. **Unfiltered List Scraping**: Non-admin user attempting unfiltered `list` on `/users` -> `PERMISSION_DENIED`.

## 3. Conflict & Red Team Audit Report
- **Identity Spoofing**: Blocked on all collections via `incoming().createdBy == request.auth.uid` and `incoming().uid == userId`.
- **State Shortcutting**: Subscription status and plan values are constrained to valid enums (`['starter', 'professional', 'enterprise']` and `['active', 'expired', 'cancelled']`).
- **Resource Poisoning**: Every string has `.size() <= MAX` and every array has `.size() <= 50`.
- **Update Validation Gate**: Every `allow update` begins with `isValid[Entity](incoming())` and uses action-based `affectedKeys().hasOnly(...)` plus `|| isAdmin()`.
