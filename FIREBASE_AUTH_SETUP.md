# Firebase account emails for ImmoGest

Firebase Authentication now owns new email/password credentials and sends account
verification and password reset emails. The existing application sessions and
server-owned role/building memberships remain in use. No SendGrid subscription is
required for these account emails. Invoice and other general notification emails
remain a separate, optional SendGrid integration; in-app notifications still work.

## Before deploying this change

1. Open https://console.firebase.google.com/project/immogest-7faaf/authentication/providers.
   In **Authentication > Sign-in method**, enable **Email/Password**, then Save.
   Keep Google enabled. Email-link/passwordless sign-in is not needed. In
   Authentication settings, set the password policy minimum length to **10** and
   enforcement to **Require**, so Firebase-hosted password resets preserve the
   app’s minimum password length.
2. In **Authentication > Settings > Authorized domains**, add
   `immogest.cloud.run`. Retain existing Firebase/Google sign-in domains.
3. In **Authentication > Templates**, review **Email address verification** and
   **Password reset**. Use ImmoGest as the sender name. Keep Firebase's hosted
   action handler (`...firebaseapp.com/__/auth/action`) for this rollout. The
   application sends a continue URL pointing to `https://immogest.cloud.run/login`.
   These emails use Firebase's managed sender, not the Gmail address entered in
   SendGrid. A custom email action domain is optional and requires its own setup.
4. In Google Cloud **IAM**, grant the Cloud Run runtime service account
   `174234637104-compute@developer.gserviceaccount.com` the **Firebase Authentication
   Admin** role (`roles/firebaseauth.admin`) in project `immogest-7faaf`, unless it
   already has equivalent permissions. The backend must create, read and update
   Firebase users. It uses application default credentials; no downloaded service
   account key or Service Account Token Creator role is needed for this flow.
5. In Cloud Run service **buildmanage**, preserve the existing database and storage
   configuration and set:

   | Environment variable | Value |
   | --- | --- |
   | `SYNDIK_AUTH_PROVIDER` | `firebase` |
   | `PUBLIC_APP_URL` | `https://immogest.cloud.run` |
   | `SYNDIK_UPLOAD_BUCKET` | `immogest-7faaf-uploads` |

   Configure one stable secret `SYNDIK_SERVER_SECRET` of at least 32 random
   characters across all revisions and instances. Do not expose it in screenshots.
   `FIREBASE_API_KEY` is an optional backend override of the existing Firebase Web
   API key in `firebase-applet-config.json`; its key restrictions must allow the
   Identity Toolkit API from the backend. Frontend Firebase config must use the
   same project. Never set `FIREBASE_AUTH_EMULATOR_HOST` in production.
6. Back up application state and deploy the reviewed GitHub change through the
   existing Cloud Build trigger. A Cloud Run environment-variable redeploy by
   itself does not install this code. No Firestore data/schema import is needed.

## Existing accounts and recovery

- Existing app UIDs, cabinets, roles, resident CIN logins, and provider assignments
  remain unchanged. A successful legacy password login creates or authenticates
  the corresponding Firebase identity and persists its binding. Local password
  hashes are removed only from that linked identity.
- If the email already has a Firebase identity, the submitted Firebase password
  must authenticate; the app never overwrites an unrelated Firebase password to
  complete migration. A verified Google identity can link through Google sign-in.
- Forgot-password can migrate an account that has never logged in since this
  release. A newly created Firebase user has no usable password until the emailed
  reset finishes. If delivery fails, retry recovery; the app does not restore an
  old local hash as a bypass. An unrelated unverified Firebase identity causes a
  conflict requiring verification/operator review, rather than silently claiming
  an existing cabinet.
- Firebase email verification is synchronized on login/session refresh. Firebase
  disables and password-reset/revocation timestamps are checked on authenticated
  requests, including application-issued sessions. This adds a Firebase Admin
  lookup to requests from migrated accounts; authentication fails closed during
  Firebase outages. Membership and tenant permissions still come from app data.
- Resident/provider invitation regeneration retains the Firebase binding, updates
  the temporary password in Firebase and revokes prior sessions. An email change
  on an already linked identity is refused until a verified email-change flow is
  provided; it must not silently transfer access to another person.
- Old custom verification/reset links stop working for a linked account. Request
  a fresh Firebase link from the login or verification screen.
- For rollback, keep this release and set `SYNDIK_AUTH_PROVIDER=legacy` to stop new
  migrations. Already linked accounts continue using Firebase. Reverting to the
  old authentication implementation would strand accounts whose local hashes
  have been removed. Application JSON backups do not back up Firebase passwords.

## Verify the live rollout

Create one account using an inbox you control. Confirm it appears in Firebase
Authentication > Users, the verification email arrives, the link verifies it, and
refreshing ImmoGest opens the correct cabinet. Log out and log back in, request a
password reset, and confirm the old password and old app session stop working.
Also confirm one existing account and one resident invitation retain their proper
role and building. Do not use dummy accounts in the production tenant database.

`/api/diagnostics` reports the selected authentication/email providers and whether
a key is configured; its `liveCheck: not_checked` deliberately does not claim that
provider permissions or delivery have been tested. Check Cloud Run logs for
`firebase_email_failed` if a message does not arrive. Firebase quotas still apply.

## Local checks

`npm run check:local` covers the existing isolated regression suite and builds.
`npm run test:auth` runs real Firebase Auth emulator integration checks with a
`demo-buildmanage` project and no outgoing email. `npm run test:auth:browser` checks
registration, browser SDK sign-in, verification resend, refresh and verified
onboarding in Chromium. Both run in GitHub Actions. Emulator connection in the
browser is restricted to development on localhost; production bundles cannot use it.

References:
- https://firebase.google.com/docs/auth/web/password-auth
- https://firebase.google.com/docs/reference/rest/auth
- https://firebase.google.com/docs/auth/admin/manage-sessions
- https://firebase.google.com/docs/auth/limits
