# SyndicUnion — Capacitor Mobile App Build & Store Release Guide

**App Name:** `SyndicUnion`  
**Bundle ID / Application ID:** `ma.syndicunion.app`  
**Deep-Link Scheme:** `syndicunion://`  
**Native Shell:** Capacitor 8 (`android/` + `ios/` Swift Package Manager)

---

## 1. Architecture Overview

- **Zero-Web-Overhead Native Bridge ([`utils/nativeBridge.ts`](../utils/nativeBridge.ts)):** Web and Cloud Run deployments keep a 0 KiB Capacitor footprint because native plugins are accessed via `window.Capacitor.Plugins` at runtime and all `@capacitor/*` packages live in `devDependencies` (excluded from the Cloud Run production container via `npm ci --omit=dev`).
- **Cross-Origin API Routing ([`utils/apiBase.ts`](../utils/apiBase.ts)) & Strict CORS ([`server/corsPolicy.ts`](../server/corsPolicy.ts)):** Mobile builds inject `VITE_API_BASE_URL` at build time (defaulting to `deploy/target.json#publicAppUrl`) while Cloud Run allows `capacitor://localhost`, `https://localhost`, `PUBLIC_APP_URL`, and optional `SYNDIK_CORS_ORIGINS`.
- **Native Capabilities:**
  - **1-Tap PDF / CSV Share Sheet:** `@capacitor/filesystem` + `@capacitor/share` for all 16 jsPDF documents, CSV exports, and authenticated upload receipts.
  - **Native Camera:** `@capacitor/camera` inside `CameraCaptureModal` for payment proofs, maintenance incidents, and marketplace photos.
  - **Push Notifications (FCM + APNs):** `@capacitor/push-notifications` + `hooks/useNativePush.ts` + server device token registry (`__deviceTokens_v1`) and transactional outbox (`__pushOutbox`) in `server/pushNotifications.ts`.
  - **Shell & Deep Links:** `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/browser`, `@capacitor/app` (Android back button + `syndicunion://` routing).
- **Apple App Store Compliance (Guidelines 3.1.1 & 4.8):**
  - Native launches open directly into authentication (`showLanding` defaults to `false` on native).
  - On iOS native (`isIosNativeApp()`), cabinet subscription modals display current status and official downloadable/shareable PDF invoices while omitting external SaaS checkout forms/links and skipping third-party PayPal SDK loading.
  - Web popup Google OAuth is hidden inside Capacitor WebViews to prevent `403 disallowed_useragent` and satisfy Apple Guideline 4.8.

---

## 2. Local Build & Sync Commands

```bash
# Regenerate resources/, Android mipmaps/splashes, and iOS AppIcon/Splash assets
npm run mobile:assets

# Build web assets targeting the production HTTPS API and sync both Android & iOS
npm run mobile:build

# Override backend API target (e.g. staging)
VITE_API_BASE_URL=https://staging.syndicunion.ma npm run mobile:build

# Sync a single platform
npm run mobile:build:android
npm run mobile:build:ios

# Open native IDEs
npm run mobile:open:android   # Android Studio
npm run mobile:open:ios       # Xcode (macOS)

# Run automated mobile CORS, push notification & Capacitor config verification
npm run test:mobile
npm run test:capacitor
```

---

## 3. Firebase Push Notifications Setup (Android FCM + iOS APNs)

Backend dispatch (`server/pushNotifications.ts`) uses `firebase-admin/messaging` targeting Android channel `syndik_alerts` (created automatically in `MainActivity.java`) and APNs badge/sound alerts.

### Android (FCM)
1. In **Firebase Console → Project Settings → Your Apps**, register Android app `ma.syndicunion.app`.
2. Download `google-services.json` and place it at:
   `android/app/google-services.json` *(gitignored — never commit)*.
3. `android/app/build.gradle` automatically detects `google-services.json` and applies `com.google.gms.google-services`.

### iOS (APNs via FCM)
1. In **Apple Developer Portal → Keys**, create an **Apple Push Notifications service (APNs)** `.p8` key and note the **Key ID** and **Team ID**.
2. In **Firebase Console → Project Settings → Cloud Messaging → Apple app configuration**, register iOS app `ma.syndicunion.app` and upload the `.p8` key.
3. Download `GoogleService-Info.plist` and add it to the `App` target in Xcode at `ios/App/App/GoogleService-Info.plist` *(gitignored — never commit)*.
4. In Xcode:
   - Add **Signing & Capabilities → Push Notifications** and verify **Background Modes → Remote notifications** is enabled.
   - Add Swift Package `https://github.com/firebase/firebase-ios-sdk` (`FirebaseCore` + `FirebaseMessaging`) to target `App`. `AppDelegate.swift` already contains conditional `#if canImport(FirebaseMessaging)` bridging so APNs device tokens automatically convert to FCM registration tokens.

---

## 4. Android Play Store Release (AAB)

1. Generate a release upload keystore (store securely outside git):
   ```bash
   keytool -genkey -v -keystore syndicunion-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias syndicunion
   ```
2. Run `npm run mobile:build:android`.
3. Open `android/` in Android Studio (`npm run mobile:open:android`) → **Build → Generate Signed App Bundle / APK → Android App Bundle (`.aab`)**.
4. Bump `versionCode` and `versionName` in `android/app/build.gradle` before each Play Console upload.
5. Verify Play Console Data Safety declarations: Email/account auth, optional camera photos (payment proofs & maintenance), Firebase Cloud Messaging device token for notifications.

---

## 5. iOS App Store / TestFlight Release

1. On macOS with Xcode 16+, run `npm run mobile:build:ios` and `npm run mobile:open:ios`.
2. Select target **App** → **Signing & Capabilities**:
   - Set **Team** and confirm **Bundle Identifier** is `ma.syndicunion.app`.
   - Bump **Version** (`MARKETING_VERSION`) and **Build** (`CURRENT_PROJECT_VERSION`).
3. Choose **Any iOS Device (arm64)** → **Product → Archive** → **Distribute App → App Store Connect**.
4. **App Review Notes (Guideline 3.1.1 B2B Companion App):**
   - Provide a demo Syndic account and a demo Resident account in App Store Connect Review Information.
   - Note that SyndicUnion is a B2B Moroccan property management (Loi 18-00 / 106-12) companion app; cabinet SaaS contracts are provisioned externally on the web portal, while the iOS app provides account access, property operations, official PDF invoices/receipts, and real-world condo fee proof submission without any in-app subscription purchase flow.
