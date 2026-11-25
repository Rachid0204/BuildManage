# Session Transport Design: Web `HttpOnly` Cookie & Native Bearer Separation

**Branch:** `design/session-transport`  
**Status:** Step 1 — Design proposal awaiting approval (no code changes made yet)  
**Target Service:** Cloud Run `buildmanage` (`europe-west1`, project `immogest-7faaf`)

---

## 0. Verified Current State (Evidence in `main`)

| Layer | File & Lines | Current Behavior | Security / Transport Gap |
| --- | --- | --- | --- |
| Client session persistence | `contexts/AuthContext.tsx:115, 198-215` | `persistSession()` stores `{ profile, signature, issuedAt, serverToken }` in `localStorage` under `SESSION_STORAGE_KEY` (`syndik_auth_session_v1`) and passes `serverToken` into `setActiveAuthContext()`. | Any XSS primitive or malicious browser extension running in the web origin can exfiltrate the 12-hour `syndik-srv1.*` bearer token from `localStorage`. |
| Client request headers | `utils/security.ts:154-220` | `getAuthenticatedRequestHeaders()` reads `inMemoryAuthHeaderToken` or falls back to `localStorage.getItem('syndik_auth_session_v1')`, attaching `Authorization: Bearer <serverToken>` plus client-side `X-Syndik-*` context fields. | Couples `inMemoryUserContext` (`X-Syndik-Uid`, `X-Syndik-Building`) to the presence of a readable `serverToken`. |
| Client state sync & mutations | `firebase/transport.ts:133-136, 319-336, 512-516` & `firebase/liveSync.ts:163-167` | `syncAllSharedStateFromServer()` aborts early with `if (!headers['Authorization']) return null;`. `performRemoteMutation()` reads `getAuthenticatedRequestHeaders()['X-Syndik-Uid']` to namespace `operationRecovery.ts` (`sessionStorage`) and enforce `requireSameIdentity()`. | Removing `Authorization` on web without decoupling `hasActiveAuthSession()` / `getActiveSessionUid()` would silently skip state sync and break durable command recovery. |
| Server cookie issuance | `server.ts:1228-1235` | `wrap()` already sets `res.cookie('syndik_session', payload.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 12 * 3600000, path: '/' })` whenever a `< 400` response contains `payload.token` (`/api/auth/login`, `/api/auth/firebase-session`, `/api/auth/register`, `/api/auth/change-password`, `/api/auth/session`). | Cookie is already issued on every session mint/refresh, **and** `payload.token` is simultaneously returned in JSON. |
| Server credential verification | `server.ts:466-480` (`extractAndVerifyCaller`), `server.ts:1015-1031` (`hasValidCallerCredential`), `server.ts:1102-1106` (`registrationAdmission`), `server.ts:1194-1204` (`identityTransaction` `authorizeResume`) | `extractAndVerifyCaller` and `hasValidCallerCredential` read `syndik_session` **only** when `req.path.startsWith('/api/uploads/') && req.method === 'GET'`. `registrationAdmission` and `identityTransaction`'s `authorizeResume` ignore `req.headers.cookie` altogether. | Web API reads, SSE (`/api/events`), and all mutations cannot authenticate via `syndik_session` yet; no CSRF gate exists for cookie-authenticated mutations. |
| Native mobile shells | `capacitor.config.ts:10-16`, `utils/apiBase.ts:22-43`, `server/corsPolicy.ts:3-7, 27-48` | Android runs on `https://localhost` and iOS runs on `capacitor://localhost`, calling `VITE_API_BASE_URL` (`https://immogest.cloud.run`) cross-origin. | `SameSite=Strict` cookies are never sent cross-site, and iOS `WKWebView` ITP / `capacitor://` scheme rules make cross-origin cookies unreliable on mobile. |

---

## (a) Web Cookie Authentication & Layered CSRF Defence

### 1. How the Web App Authenticates API Calls
When web cookie session mode is enabled (`!isNativeApp()` and feature flag active):

1. **Zero bearer token in web storage or JS memory:**
   - On `/api/auth/login`, `/api/auth/register`, `/api/auth/firebase-session`, `/api/auth/change-password`, and `/api/auth/session`, Express sets the `syndik_session` cookie:
     - `HttpOnly: true` (inaccessible to `document.cookie` and XSS)
     - `Secure: process.env.NODE_ENV === 'production'` (HTTPS-only in production)
     - `SameSite: 'strict'`
     - `Path: '/'` (required so both `/api/*` and `<img src="/api/uploads/...">` / PDF downloads receive it)
     - `Max-Age: 43200` seconds (12 hours, matching `issueServerSessionToken`)
   - When the client sends `X-Syndik-Session-Transport: cookie` (or when `SESSION_TRANSPORT_MODE=cookie-enforced` after the rollout window), the server omits `token` from the JSON response body (or the web client ignores `data.token` during the `dual` compatibility window) and **never** writes `serverToken` to `localStorage`, `sessionStorage`, or `inMemoryAuthHeaderToken`.
   - `localStorage['syndik_auth_session_v1']` on web retains **only** a non-secret UI hint envelope `{ sessionTransport: 'cookie', profile, signature, issuedAt }` (no `serverToken`). This non-secret hint is **never** trusted as an authentication credential; it exists solely so:
     - Anonymous visitors on `/welcome` or `/login` do not make an unnecessary `/api/auth/session` call or see a `503` outage banner when unauthenticated, and
     - Existing transient-outage UX (`Connexion au serveur interrompue` / `Réessayer la connexion` / `Se connecter à nouveau`) continues to know whether the browser tab expected an active session while `GET /api/auth/session` re-verifies the `HttpOnly` cookie on every load/reload.
   - If `syndik_auth_session_v1` is absent on a protected route (e.g. a newly opened tab or Playwright `page.request.post('/api/auth/login')` sharing the browser cookie jar), `restoreSession()` performs one `GET /api/auth/session` probe with `credentials: 'same-origin'`: `200` hydrates `profile` and writes the non-secret hint; `401` resolves cleanly to `'empty'`.

2. **Client `fetch` wrapper & header contract:**
   - Every web API call (`contexts/AuthContext.tsx`, `firebase/transport.ts`, `firebase/services.ts`, `firebase/liveSync.ts`, `components/views/*`, `hooks/useNativePush.ts`) sends:
     - `credentials: 'same-origin'` on web (`!isNativeApp()`), or `'include'` only when an explicit cross-origin `VITE_API_BASE_URL` dev setup is used on web; native Capacitor keeps `Authorization: Bearer <token>` with `credentials: 'omit'`.
     - Custom header `X-Syndik-CSRF: 1` on all client `fetch` requests from `getAuthenticatedRequestHeaders()` and auth endpoints (`/api/auth/logout`, `/api/auth/change-password`, etc.).
   - `firebase/liveSync.ts` already uses `fetch(apiUrl('/api/events'), { headers: getAuthenticatedRequestHeaders(), ... })` rather than `new EventSource(...)`, so SSE `/api/events` automatically carries both the same-origin `syndik_session` cookie and `X-Syndik-CSRF: 1`.
   - `GET /api/uploads/:fileId` continues to work for top-level/embedded browser loads (`<img>`, `<a download>`, `fetch`) via `SameSite=Strict` + tenant/building authorization in `extractAndVerifyCaller`.

3. **Unified server credential extraction:**
   - Introduce a single helper `extractRequestCredential(req, env)` used consistently across:
     1. `extractAndVerifyCaller(req, store)` (`server.ts:466`)
     2. `hasValidCallerCredential(req)` (`server.ts:1015`, used by `wrap()` and `registerLiveUpdates` preauthorization)
     3. `registrationAdmission` `authenticated(req)` (`server.ts:1102`)
     4. `identityTransaction` `identityRequestFingerprint` and `authorizeResume` (`server.ts:1190-1204`)
   - Precedence rule:
     1. If `Authorization: Bearer <token>` is non-empty, `source = 'bearer'` (CSRF cookie check not required because cross-site attackers cannot set `Authorization`).
     2. Else if `syndik_session` cookie is present (and cookie transport flag is enabled, or `GET /api/uploads/*`), `source = 'cookie'`.
     3. Else `null`.
   - **Important anti-fallback rule:** If an `Authorization` header is present and invalid/expired, fail closed (`401`) rather than silently falling back to a stale or different user's `syndik_session` cookie.

### 2. Multi-Layer CSRF Defence for Cookie-Authenticated Requests
Whenever `source === 'cookie'`, the server enforces defense-in-depth CSRF checks **before** executing the handler or opening a repository transaction:

| Layer | Check | What It Blocks |
| --- | --- | --- |
| **1. `SameSite=Strict` cookie** | `syndik_session` is set with `SameSite=Strict; HttpOnly; Secure` (prod) | Browser withholds the cookie on all cross-site navigations, `<form>` posts, `<img>`, and `fetch` calls from external domains. |
| **2. Required custom header (`X-Syndik-CSRF: 1`)** | Required on **every** non-safe (`POST`, `PUT`, `PATCH`, `DELETE`) cookie-authenticated request (and on JSON/SSE cookie `GET`s except browser-navigable `GET /api/uploads/:fileId`). Added to `Access-Control-Allow-Headers` in `server/corsPolicy.ts`. | HTML `<form>` submissions, `navigator.sendBeacon`, and simple CORS requests cannot set custom headers without triggering a CORS preflight, which `createApiCorsMiddleware` rejects (`403`) for non-allowlisted origins. |
| **3. `Origin` / `Referer` allowlist check** | On cookie-authenticated state-changing methods (`POST`, `PUT`, `PATCH`, `DELETE`): if `Origin` is present, it must match a **web** origin in `buildAllowedCorsOrigins(env)` (`PUBLIC_APP_URL`, `SYNDIK_CORS_ORIGINS`, plus `localhost` in non-prod — **excluding** `capacitor://localhost` and `https://localhost` for cookie auth). If `Origin` is absent, `Referer` (when present) must parse to an allowed web origin. If **both** `Origin` and `Referer` are absent on a mutation, `X-Syndik-CSRF: 1` + `Sec-Fetch-Site` still gate it (strictly rejecting if `Origin` is `"null"`). | Blocks cross-origin and sandboxed-iframe (`Origin: null`) forgery even if a browser bug or sibling subdomain bypasses `SameSite`. |
| **4. Fetch Metadata (`Sec-Fetch-Site`)** | When the browser sends `Sec-Fetch-Site` on a cookie-authenticated request: reject (`403`, `{ ok: false, error: 'Requête cross-site refusée.', code: 'CSRF_REJECTED' }`) if `Sec-Fetch-Site` is `'cross-site'` or `'same-site'` (blocks sibling-subdomain attacks if a custom domain ever has untrusted subdomains). Only `'same-origin'` (and `'none'` solely on safe `GET /api/uploads/:fileId` direct navigation) is permitted. | Protects against same-site subdomain cookie tossing / cross-origin attacks in all Chromium/Firefox/Safari browsers without relying on `SameSite` alone. |

**Explicit CSRF exemptions (endpoints that do NOT authenticate with `syndik_session`):**
- Webhooks & payment gateway callbacks: `POST /api/webhooks/paypal`, `POST /api/webhooks/cmi`, `POST /api/subscription/cmi/return` (verified via PayPal signature / CMI HMAC, ignore `syndik_session`).
- Browser CSP telemetry: `POST /api/csp-report` (stateless, ignores `syndik_session`).
- Cloud Scheduler jobs: `POST /api/jobs/*` (authenticated via `X-Syndik-Scheduler` secret, ignore `syndik_session`).
- Pre-session public endpoints: `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/recovery/request`, `POST /api/auth/recovery/complete`, `POST /api/auth/firebase-session` (uses `Authorization: Bearer <firebaseIdToken>`). Note: if a browser already holds an old `syndik_session` cookie when calling `/api/auth/login`, `/api/auth/login` still checks `Origin`/`Sec-Fetch-Site` when present (preventing login-CSRF) or requires `Content-Type: application/json` + `X-Syndik-CSRF: 1` from the SPA.

> **Deployment Topology Note (Cloud Run vs. Firebase Hosting `/api/**` rewrite):**  
> `deploy/target.json` sets `PUBLIC_APP_URL` to `https://immogest.cloud.run`, where Cloud Run serves Express directly and forwards `Cookie: syndik_session=...` untouched. However, `firebase.json` also defines a Firebase Hosting `/api/**` rewrite to Cloud Run `buildmanage`. **Firebase Hosting's CDN strips all incoming cookies except `__session`** before proxying to Cloud Run.  
> - While traffic hits Cloud Run directly (`https://immogest.cloud.run` or a custom domain mapped directly to Cloud Run), `syndik_session` works natively with zero changes.  
> - If traffic is ever routed through Firebase Hosting's `/api/**` proxy, either custom domain mapping must stay directly on Cloud Run **or** the cookie helper can optionally read `syndik_session` first and fall back to `__session` (issuing `__session` only when `FIREBASE_HOSTING_COOKIE=true`). By default, we keep `syndik_session` as specified.

---

## (b) What Stays Bearer-Based (Capacitor & Firebase ID Tokens) & Native Storage Comparison

### 1. Flows That Remain Token / Bearer-Based
1. **Capacitor Android & iOS Shells (`isNativeApp() === true` in `utils/nativeBridge.ts`):**
   - Android (`https://localhost`) and iOS (`capacitor://localhost`) communicate cross-origin with `https://immogest.cloud.run`.
   - Every authenticated mobile API request continues to send `Authorization: Bearer <syndik-srv1...>` + `X-Syndik-Client-Platform: android | ios`.
   - Server responses to native clients (`X-Syndik-Client-Platform: android | ios`, or any login/refresh during `dual` mode and whenever `Authorization` / native platform header is used) continue returning `token` in the JSON payload.
2. **Firebase ID-Token Exchange & Verification Flows (Both Web and Native):**
   - `POST /api/auth/firebase-session` (`contexts/AuthContext.tsx:230`, `server.ts:1627-1769`): The client obtains a short-lived Firebase ID token from the Firebase Auth SDK (`user.getIdToken()`) and sends `Authorization: Bearer <firebaseIdToken>` once to exchange it for a server session (`syndik_session` cookie on web; `serverToken` bearer on native).
   - `POST /api/auth/verification/request` (`components/views/EmailVerificationGate.tsx:16-20`): Sends `{ idToken: await auth.currentUser?.getIdToken(true) }` in the JSON body alongside the session credential (cookie + `X-Syndik-CSRF: 1` on web, `Bearer` on native).
   - Direct Admin SDK bearer verification in `extractAndVerifyCaller` (`server.ts:485-502`): Kept intact for existing integration tests (`tests/firebaseAuthentication.ts`) and recovery probes.

### 2. Native Token Storage Comparison (Capacitor Android & iOS)

| Criteria | Option 1: `@capacitor/preferences` (`SharedPreferences` / `NSUserDefaults`) | Option 2 (Recommended Target): Native Hardware-Backed Secure Storage (iOS Keychain + Android Keystore `EncryptedSharedPreferences`) | Current WebView `localStorage` on Native |
| --- | --- | --- | --- |
| **Underlying OS primitive** | Android `SharedPreferences` XML file; iOS `NSUserDefaults` `.plist` file in app container. | iOS Keychain Services (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`); Android `AndroidKeyStore` AES-256-GCM wrapping `SharedPreferences` (e.g. `@aparajita/capacitor-secure-storage` / `@capacitor-community/secure-storage` or tiny Capacitor Swift/Java bridge in `ios/App` + `android/app`). | Chromium / `WKWebView` unencrypted SQLite/LevelDB storage inside app sandbox, also readable by any WebView JS XSS. |
| **Encryption at rest** | **No** application-layer encryption beyond OS full-disk encryption (plaintext on rooted Android, unencrypted ADB/iTunes backups unless excluded). | **Yes** — hardware-backed Secure Enclave / StrongBox / TEE key wrapping; `ThisDeviceOnly` prevents migration via device backups. | **No** — plaintext inside WebView profile directory. |
| **Persistence & eviction** | Survives OS WebView cache eviction (unlike `WKWebView` `localStorage`, which iOS can purge under storage pressure). | Survives OS WebView storage pressure. *(Note: iOS Keychain entries survive app uninstall unless cleared on first-launch check via a `NSUserDefaults` install marker.)* | Subject to iOS `WKWebView` eviction; wiped if WebView data is cleared. |
| **XSS exposure inside WebView** | Still reachable from JS via `window.Capacitor.Plugins` if an XSS payload executes inside the WebView (mitigated by strict CSP from PR #63). | Still reachable via plugin bridge if arbitrary JS runs in WebView, **unless** paired with strict CSP (`script-src 'self'`), short TTL (12h), and session-version revocation. | Directly readable synchronously via `localStorage.getItem(...)`. |
| **Build & release impact** | Requires adding `@capacitor/preferences` + `npx cap sync` + rebuilding APK/AAB & IPA (`mobile-build.yml` / Xcode). | Requires either adding a Capacitor 8-compatible secure-storage plugin **or** a ~60-line first-party `SyndikSecureStorage` Capacitor plugin registered in `MainActivity.java` + `AppDelegate.swift` (zero third-party supply-chain dependency!), plus native binary rebuild. | Zero native rebuild, works in already-shipped APK/IPA builds. |

**Proposed Native Storage Plan:**
- **Zero-web-bundle rule preserved (`utils/nativeBridge.ts`):** Keep the 0 KiB web Capacitor footprint (`npm run test:bundle`) by accessing native storage strictly through `window.Capacitor.Plugins` asynchronously on boot (`hydrateNativeSession()`) into `inMemoryAuthHeaderToken`, never importing native packages into the web bundle.
- **Compatibility for already-installed mobile binaries:** In Step 2, add an async `nativeSessionStorage` adapter in `utils/nativeBridge.ts` that prefers `Capacitor.Plugins.SecureStorage` (if present in the native shell), falls back to `Capacitor.Plugins.Preferences` (if present), and falls back with one-way migration+delete from `localStorage` only inside `isNativeApp()` when running inside an older native binary that has not yet been rebuilt. On web (`!isNativeApp()`), `localStorage` **never** reads or writes `serverToken` once migrated.
- *(Decision checkpoint at end of doc: confirm whether Step 2 should stay strictly web+JS bridge ready without touching `android/` & `ios/` native code, or also include the ~60-line first-party `SecureStorage` plugin in `android/` + `ios/`.)*

---

## (c) Logout, Session-Version Revocation & 12-Hour Expiry

### 1. 12-Hour Expiry Alignment
- `issueServerSessionToken(profile)` (`server.ts:200-226`) embeds `iat: Date.now()` and `exp: Date.now() + 12 * 3600 * 1000` (43,200,000 ms) inside the HMAC-SHA256-signed `syndik-srv1.<payloadB64>.<hmac>` token.
- `res.cookie('syndik_session', ...)` (`server.ts:1229-1235`) sets `maxAge: 12 * 3600 * 1000` (43,200 s).
- **Cryptographic enforcement independent of browser clock:** Even if a client or attacker tampers with cookie `Max-Age`/`Expires` attributes in their cookie jar, `verifyServerSessionToken()` (`server.ts:246-248`) enforces `payload.exp < Date.now()` on the server using the HMAC-authenticated payload and rejects expired cookies with `401` (clearing `syndik_session` on `401` from `/api/auth/session`).
- **Session refresh behavior (`GET /api/auth/session`):** `GET /api/auth/session` (`server.ts:4145-4153`) verifies caller membership, account enabled status, Firebase revocation (`firebaseSessionUser`), and `__sessionVersions[uid]`, then issues a fresh `syndik-srv1` token (`wrap` updates `Set-Cookie: syndik_session=...`). To prevent indefinite silent extension without user activity if desired, we keep the existing behavior where active reloads/verifications refresh the 12h cookie while inactive sessions hard-expire at 12 hours, and Firebase `auth_time` / `tokensValidAfterTime` remains enforced via `firebaseSessionUser()`.

### 2. Immediate Server-Side Revocation (`__sessionVersions`)
- Every issued `syndik-srv1` token (whether stored in the web `HttpOnly` cookie or native `Bearer` storage) embeds `sessionVersion: state.__sessionVersions?.[uid] || 0` (`server.ts:213`).
- `extractAndVerifyCaller()` (`server.ts:522-526`) rejects any token whose `identity.sessionVersion !== (store.__sessionVersions?.[identity.uid] || 0)`.
- All existing revocation triggers automatically invalidate **both** web `syndik_session` cookies and mobile `Bearer` tokens simultaneously across all Cloud Run instances:
  - Explicit logout (`POST /api/auth/logout`, `server.ts:4160-4161`, plus Firebase refresh-token revocation `kind: 'revoke'`)
  - Password change (`POST /api/auth/change-password`, `server.ts:2126-2127` — bumps `__sessionVersions[uid]` and atomically sets a replacement `syndik_session` cookie for the active caller while invalidating all other tabs/devices)
  - Password recovery completion (`POST /api/auth/recovery/complete`)
  - Resident/provider archiving, account disabling, or cabinet/building deactivation (`server/domain/building.service.ts:1571-1572`, `lookupCandidateProfilesInStore`)

### 3. Clean Cookie Clearing & Local Interruption Reset
- Define canonical cookie options in one constant `SESSION_COOKIE_OPTIONS`:
  ```ts
  {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  }
  ```
- **Fix `res.clearCookie` attribute parity (`server.ts:1147, 4162`):** Currently `res.clearCookie('syndik_session', { path: '/' })` omits `httpOnly`, `secure`, and `sameSite: 'strict'`. Modern browsers and Express 5 require matching cookie attributes (`SESSION_COOKIE_OPTIONS` without `maxAge`) to reliably evict an `HttpOnly; Secure; SameSite=Strict` cookie.
- **Unauthenticated / expired logout (`server.ts:1145-1149`):** When `POST /api/auth/logout` is called with an already-expired or revoked `syndik_session` cookie (and valid CSRF headers), `wrap()` still clears `syndik_session` with `SESSION_COOKIE_OPTIONS` and returns `200 { ok: true }`.
- **Local-only reset during backend outage (`resetToSignIn` in `contexts/AuthContext.tsx`):**
  - Existing tests (`tests/ui/residentForms.spec.ts:1342-1372` and `tests/firebaseAuthBrowser.ts:71-84`) require that clicking *"Se connecter à nouveau"* during a `503` session outage clears the **local** browser session and returns to `/login` **without** bumping `__sessionVersions[uid]` on the server (so other signed-in devices are not logged out!).
  - Because JS cannot delete an `HttpOnly` cookie directly when the server is unreachable, `resetToSignIn()` clears `localStorage.removeItem('syndik_auth_session_v1')` and `setActiveAuthContext(null, null)` (so the SPA immediately stops treating the tab as signed in and renders `/login`, where signing in overwrites `syndik_session`), and optionally fires a best-effort stateless `POST /api/auth/clear-cookie` (which clears `syndik_session` via `Set-Cookie` **without** touching the repository or bumping `__sessionVersions`).

---

## (d) Preserving `identityRequestFingerprint` & Durable Operation Recovery (`firebase/operationRecovery.ts`)

### 1. Server-Side `identityTransaction` & `identityRequestFingerprint` (`server/identityMutations.ts` & `server.ts:1187-1214`)
Inspecting `server.ts:1187-1214` revealed **two critical places** that must be updated together for cookie-authenticated mutations (`/api/commands`, `/api/auth/change-password`, `/api/auth/logout`):

1. **Canonical credential input to `identityRequestFingerprint` (`server.ts:1190`):**
   - Currently `server.ts:1190` calls:
     ```ts
     identityRequestFingerprint(req.path, String(req.headers.authorization || req.headers.cookie || ''), req.body)
     ```
   - Hashing raw `req.headers.cookie` has two flaws:
     - Unrelated cookies (or whitespace/ordering differences in `Cookie:` headers) would alter the HMAC fingerprint and miss a pending `__firebaseMutations_v1` intent on retry.
     - During the compatibility window, if a request sent `Authorization: Bearer <T>` and a retry sent `Cookie: syndik_session=<T>`, the raw strings `'Bearer <T>'` vs `'syndik_session=<T>'` would not match even though `<T>` is identical.
   - **Fix:** Pass canonical `canonicalAuthFingerprintInput(req)`:
     - On public pre-auth routes (`/api/auth/login`, `/api/auth/register`, `/api/auth/recovery/request`), pass `''` (so stale cookies never affect login/register fingerprints).
     - On authenticated routes (`/api/commands`, `/api/auth/change-password`, `/api/auth/logout`), extract the verified raw token `<T>` (from `Authorization: Bearer <T>` or `syndik_session=<T>`) and normalize to `Bearer ${token}`.
   - **Across token refreshes on `/api/commands`:** As already designed in `server.ts:4076-4082` and `docs/identity-mutations.md`, if a tab reloads and `GET /api/auth/session` mints a new `syndik_session` cookie (new `iat`/`exp`) before retrying an interrupted `/api/commands` identity mutation, `prepare(state)` authenticates the caller via the new cookie, matches `receipts[`${caller.uid}:${operationId}`]` using the **command body** fingerprint, and calls `resumeQueuedIdentityMutation(sharedStore, receipts[key].identityMutationId)` (`plan.resumeId`). Thus **both** same-cookie retries and post-reload refreshed-cookie retries converge on the original `operationId`.

2. **`authorizeResume` cookie support (`server.ts:1194-1204`):**
   - Currently `authorizeResume` reads **only** `req.headers.authorization`:
     ```ts
     const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
     ```
   - With web cookie auth, `req.headers.authorization` is empty, so resuming a pending `IDENTITY_MUTATION_PENDING` intent with the same `syndik_session` cookie would fail with `401 Session expirée`!
   - **Fix:** Use the exact same `extractRequestCredential(req)` helper inside `authorizeResume` (after CSRF verification in `wrap()`) so `syndik-srv1.*` tokens from `syndik_session` verify `uid === intent.actorUid` and `state.__sessionVersions[uid] === intent.actorVersion` identically to `Bearer` tokens.

### 2. Client-Side Durable Operation Recovery (`firebase/operationRecovery.ts` & `firebase/transport.ts`)
- `firebase/operationRecovery.ts` stores pending command metadata in `window.sessionStorage` under `syndik_pending_operations_v1:${uid}` (`operationId`, `operation`, `target`, `fingerprint`, `uploads`, `startedAt` — **never** tokens, arguments, or secrets).
- Today, `firebase/transport.ts` couples identity awareness to `getAuthenticatedRequestHeaders()`:
  - Line 134: `if (!headers['Authorization']) return null;`
  - Line 320: `requireSameIdentity` checks `getAuthenticatedRequestHeaders()['X-Syndik-Uid'] !== uid`
  - Line 324: `const uid = getAuthenticatedRequestHeaders()['X-Syndik-Uid']; if (!uid) throw new Error('Authentification requise.');`
- **How we keep this working cleanly without any bearer token on web:**
  1. `utils/security.ts`: Decouple `inMemoryUserContext` (`{ uid, role, syndicId, buildingId }`) from `inMemoryAuthHeaderToken`:
     - On web (`!isNativeApp()`), `setActiveAuthContext(profile, null)` populates `inMemoryUserContext` (and exposes `hasActiveAuthSession(): boolean` and `getActiveAuthUid(): string | undefined`), while `Authorization` is **omitted** whenever `token` is `null`.
     - `getAuthenticatedRequestHeaders()` always includes `'X-Syndik-CSRF': '1'` and, when `inMemoryUserContext` (or native bearer) is active, sets `X-Syndik-Uid` / `X-Syndik-Building` for client-side correlation (while ensuring `server/corsPolicy.ts` allows `X-Syndik-CSRF` — or keeping client-only identity reads in `getActiveAuthContext()` so unnecessary `X-Syndik-Uid`/`Sig` wire headers don't clutter requests).
     - *Cleaner option (recommended):* Read `uid` and `buildingId` in `firebase/transport.ts` from a dedicated `getActiveAuthContext()` export in `utils/security.ts` rather than parsing outbound HTTP headers, and send only `Content-Type`, `Accept`, `X-Syndik-CSRF: 1` (plus `Authorization` & `X-Syndik-Client-Platform` on native) over the wire!
  2. **Tab reload sequence with pending operation:**
     - User submits a mutation -> `savePending(uid, record)` writes to `sessionStorage['syndik_pending_operations_v1:<uid>']` -> network drops after server commits.
     - User reloads tab -> `AuthContext.restoreSession()` calls `GET /api/auth/session` with `syndik_session` cookie -> receives `{ ok: true, profile }` -> calls `setActiveAuthContext(profile, null)` **before** rendering authenticated views.
     - User resubmits form -> `performRemoteMutation()` reads `uid` from `getActiveAuthContext()`, finds the pending `record` in `sessionStorage`, calls `POST /api/operations/status` (authenticated via `syndik_session` cookie + `X-Syndik-CSRF: 1`), receives `{ status: 'completed', result, store }`, reconciles state, and clears the pending `sessionStorage` entry without re-executing the command.

---

## (e) Phased Rollout with Compatibility Window (Zero Forced Logouts)

### Feature Flags
1. **Server environment flag (`SESSION_TRANSPORT_MODE`):**
   - Values: `'bearer-only'` | `'dual'` *(default in Step 2)* | `'cookie-web'`
   - Validated in `server/productionConfig.ts` (optional env var defaulting to `'dual'`).
   - Behavior by mode:
     - `'bearer-only'` (instant rollback mode): Exact pre-change server behavior — `syndik_session` cookie accepted only on `GET /api/uploads/*`; JSON responses include `token`.
     - `'dual'` (**Step 2 default — compatibility window**):
       - Server accepts **both** `Authorization: Bearer <token>` and `syndik_session` cookie (with full CSRF enforcement whenever `source === 'cookie'`).
       - `POST /api/auth/*` and `GET /api/auth/session` always set `Set-Cookie: syndik_session=...; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=43200`.
       - JSON responses omit `token` **only** when the caller explicitly sends `X-Syndik-Session-Transport: cookie`; legacy web tabs (cached JS bundle) and Capacitor mobile clients still receive `token` in JSON as needed.
     - `'cookie-web'` (post-window hardening): Same as `'dual'`, except non-native requests without `X-Syndik-Client-Platform: android | ios` never receive `token` in JSON responses even if they omit `X-Syndik-Session-Transport`.
2. **Frontend runtime/build flag (`VITE_WEB_SESSION_TRANSPORT`):**
   - Values: `'cookie'` *(default in Step 2)* | `'bearer'` (instant client rollback).

### Zero-Logout Migration Sequence for Signed-In Web Users
Suppose a syndic or resident signed in **before** this deployment:
- **Case 1 (Signed in < 12h ago on same origin):** Their browser **already** received `Set-Cookie: syndik_session=...` from `server.ts:1229` when they logged in! And their `localStorage['syndik_auth_session_v1']` currently holds `{ profile, signature, issuedAt, serverToken }`.
- **Case 2 (Cookie missing, e.g. cleared cookies or older flow, while `serverToken` is still valid in `localStorage`):**
  1. User loads the newly deployed web bundle (`VITE_WEB_SESSION_TRANSPORT='cookie'`, server `SESSION_TRANSPORT_MODE='dual'`).
  2. `restoreSession()` detects legacy `cached.serverToken` inside `localStorage['syndik_auth_session_v1']`.
  3. **One-time silent migration:** Only if `cached.serverToken` is present, `restoreSession()` sends `GET /api/auth/session` with `Authorization: Bearer ${cached.serverToken}` + `credentials: 'same-origin'` + `X-Syndik-Session-Transport: cookie`.
  4. Server validates the session, sets fresh `HttpOnly` `syndik_session` cookie on the response, and returns `{ ok: true, profile }`.
  5. Client `persistSession(profile)` **immediately overwrites `localStorage['syndik_auth_session_v1']` without `serverToken`** (`{ sessionTransport: 'cookie', profile, signature, issuedAt }`) and sets `setActiveAuthContext(profile, null)`.
  6. Every subsequent API call in that tab and future reloads uses **only** the `HttpOnly` `syndik_session` cookie + `X-Syndik-CSRF: 1`.
- **Multi-tab safety during the compatibility window:** Because `SESSION_TRANSPORT_MODE='dual'` does not bump `__sessionVersions` during migration and accepts both `Bearer` and `syndik_session`, an unrefreshed background tab running yesterday's JS bundle continues working until refreshed, while refreshed tabs operate token-free.
- **After ≥ 12 hours in production** (the maximum lifetime of any pre-deploy session): Every active web session has naturally rotated into `syndik_session`, and `SESSION_TRANSPORT_MODE` can optionally be tightened from `'dual'` to `'cookie-web'` with a one-line env var update.
- **Rollback:** Setting `SESSION_TRANSPORT_MODE=bearer-only` (or reverting the Cloud Run revision) restores legacy behavior without touching Firestore state or invalidating `__sessionVersions`.

---

## (f) Test Plan (Step 2)

Following Rule 4, we will first add regression assertions that fail before the implementation and pass after it, then run the full verification suite:

### 1. HTTP Boundary & Security Regression Suite (`tests/httpBoundaries.ts` — `npm run test:security`)
1. **Cookie-only authentication across read, SSE, upload, and mutation endpoints:**
   - Log in via `POST /api/auth/login` with `X-Syndik-Session-Transport: cookie`: assert `Set-Cookie` contains `syndik_session=...`, `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=43200`, and response JSON omits `token`.
   - Call `GET /api/auth/session`, `GET /api/shared-state`, `GET /api/events` (SSE), `POST /api/uploads`, `GET /api/uploads/:id`, and `POST /api/commands` using **only** `Cookie: syndik_session=...` + `X-Syndik-CSRF: 1` + allowed `Origin` (`no Authorization header`): assert `200` and tenant isolation still holds.
2. **Layered CSRF rejections on cookie-authenticated mutations (zero state mutation):**
   - `POST /api/commands`, `POST /api/auth/change-password`, and `POST /api/auth/logout` with `Cookie: syndik_session=...` **missing** `X-Syndik-CSRF` -> `403` (`CSRF_REJECTED`), `shared-state.json` `__revision` unchanged.
   - `POST /api/commands` with `Cookie: syndik_session=...` + `X-Syndik-CSRF: 1` + disallowed `Origin: https://evil.example` -> `403`, state unchanged.
   - `POST /api/commands` with `Cookie: syndik_session=...` + `X-Syndik-CSRF: 1` + `Origin: capacitor://localhost` (native origin attempting cookie auth) -> `403`, state unchanged.
   - `POST /api/commands` with `Cookie: syndik_session=...` + `X-Syndik-CSRF: 1` + `Sec-Fetch-Site: cross-site` or `Sec-Fetch-Site: same-site` -> `403`, state unchanged.
3. **Capacitor Bearer compatibility:**
   - `POST /api/auth/login` with `Origin: capacitor://localhost` and `X-Syndik-Client-Platform: ios` returns `data.token`; subsequent `GET /api/shared-state` and `POST /api/commands` with `Authorization: Bearer <token>` + `Origin: capacitor://localhost` (no cookie, no `X-Syndik-CSRF`) succeed (`200`), and `OPTIONS` preflight allows `X-Syndik-CSRF`.
4. **Anti-fallback, expiry, password-change rotation, and logout revocation:**
   - Corrupt `Authorization: Bearer bad` alongside a valid `Cookie: syndik_session=...` -> fails closed (`401`).
   - Expired `syndik-srv1` cookie (`exp` in past) -> `401`.
   - `POST /api/auth/change-password` via cookie bumps `__sessionVersions[uid]`, sets rotated `syndik_session` cookie, and old cookie immediately returns `401`.
   - `POST /api/auth/logout` via cookie bumps `__sessionVersions[uid]`, emits `Set-Cookie: syndik_session=; ... Max-Age=0` with `HttpOnly; SameSite=Strict; Path=/`, and replaying the pre-logout cookie returns `401`.
5. **Cookie-authenticated durable operation recovery & `identityTransaction` resume:**
   - Run the interrupted-HTTP-response `remoteMutation('addAnnouncement', ...)` reload simulation in `tests/httpBoundaries.ts` in **cookie mode** (`setActiveAuthContext(owner, null)` + cookie jar, no `Authorization` header): assert `POST /api/operations/status` recovers the original receipt (`commandPosts === 1`, `statusReads === 1`) and `sessionStorage` contains neither confidential payload text nor any session token.
   - Verify `identityRequestFingerprint` + `authorizeResume` with `Cookie: syndik_session=...` (including when unrelated cookies are also present in `Cookie:`).
6. **Flag rollback (`SESSION_TRANSPORT_MODE=bearer-only`):**
   - Verify cookie-only `GET /api/shared-state` is rejected (`401`) while `GET /api/uploads/:id` cookie access and `Bearer` auth continue working.

### 2. Chromium End-to-End Browser Suites (`tests/ui/residentForms.spec.ts` & `tests/firebaseAuthBrowser.ts` — `npm run test:ui`, `npm run test:auth:browser`)
1. **No bearer token in `localStorage` or `sessionStorage`:**
   - Sign in through the real login form in Chromium; assert `localStorage.getItem('syndik_auth_session_v1')` has **no `serverToken`** and neither `localStorage` nor `sessionStorage` contains `'syndik-srv1.'`.
   - Reload the page (`page.reload()`), verify authenticated dashboard renders via `HttpOnly` `syndik_session` cookie (`document.cookie` does **not** contain `syndik_session`), submit a resident payment proof upload + mutation, and verify logout clears session state and redirects cleanly.
2. **Legacy `localStorage` compatibility migration in browser:**
   - Seed legacy `{ profile, signature, issuedAt, serverToken }` in `localStorage` with an empty cookie jar, navigate to `/financials`: assert user stays signed in, `syndik_session` `HttpOnly` cookie is established, and `serverToken` is scrubbed from `localStorage`.
3. **Existing outage & recovery tests (`tests/ui/residentForms.spec.ts:1308-1434`, `tests/firebaseAuthBrowser.ts`):**
   - Update test helper assertions that previously inspected `JSON.parse(localStorage.getItem('syndik_auth_session_v1')!).serverToken` to assert the non-secret `sessionTransport: 'cookie'` hint + `HttpOnly` browser context cookie, while preserving every outage, draft-retention, retry, and local-reset invariant.

### 3. Full Pre-PR Verification Gate
- `npm run typecheck`
- `npm run lint`
- `npm run test:security` (`tests/httpBoundaries.ts`)
- `npm run test:auth` & `npm run test:auth-concurrency` & `npm run test:auth:browser`
- `npm run test:mobile` & `npm run test:capacitor` & `npm run test:live-sync` & `npm run test:production` & `npm run test:deployment-contract`
- `npm run test:ui`
- `npm run build` & `npm run test:bundle`

---

## Approved Design Decisions (Step 1 → Step 2)

1. **Web `localStorage` non-secret hint (Approved — Recommended):** Keep `{ sessionTransport: 'cookie', profile, signature, issuedAt }` (**without** `serverToken`) in `localStorage['syndik_auth_session_v1']` so `/welcome` remains zero-call for anonymous visitors and all `503` session-outage / draft-retention / local-reset flows continue working unchanged.
2. **Native Capacitor scope in Step 2 (Approved — Recommended):** Keep `android/` and `ios/` native Swift/Java sources untouched in this PR (preserving 0 KiB web bundle overhead) while adding an async `nativeSessionStorage` adapter in `utils/nativeBridge.ts` (`SecureStorage` → `Preferences` → native-only `localStorage` fallback gated strictly behind `isNativeApp()`).
3. **Cloud Run vs. Firebase Hosting cookie name (Approved — Recommended):** Default to `syndik_session` for direct Cloud Run (`PUBLIC_APP_URL = https://immogest.cloud.run`), and support an optional `SESSION_COOKIE_NAME` (`'syndik_session' | '__session'`, validated in `server/productionConfig.ts`) so switching to `__session` is a zero-code configuration toggle if traffic ever routes through Firebase Hosting `/api/**` rewrites.

