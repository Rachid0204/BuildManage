import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import capacitorConfig from '../capacitor.config';
import { isAllowedCorsOrigin } from '../server/corsPolicy';

const ROOT = process.cwd();
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function assertValidPng(relPath: string): void {
  const fullPath = path.join(ROOT, relPath);
  assert.ok(existsSync(fullPath), `Missing PNG asset: ${relPath}`);
  const header = readFileSync(fullPath).subarray(0, 8);
  assert.ok(header.equals(PNG_SIGNATURE), `Invalid PNG signature in ${relPath}`);
}

const REQUIRED_PLUGINS = [
  '@capacitor/app',
  '@capacitor/browser',
  '@capacitor/camera',
  '@capacitor/filesystem',
  '@capacitor/push-notifications',
  '@capacitor/share',
  '@capacitor/splash-screen',
  '@capacitor/status-bar',
];

test('capacitor.config.ts matches SyndicUnion identity and CORS allowlist', () => {
  assert.equal(capacitorConfig.appId, 'ma.syndicunion.app');
  assert.equal(capacitorConfig.appName, 'SyndicUnion');
  assert.equal(capacitorConfig.webDir, 'dist');
  assert.equal(capacitorConfig.server?.androidScheme, 'https');
  assert.equal(capacitorConfig.server?.iosScheme, 'capacitor');

  // Verify native WebView origins are allowed by production CORS policy
  const prodEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    PUBLIC_APP_URL: 'https://immogest.cloud.run',
  };
  assert.equal(
    isAllowedCorsOrigin(`${capacitorConfig.server?.androidScheme}://localhost`, prodEnv),
    true,
  );
  assert.equal(
    isAllowedCorsOrigin(`${capacitorConfig.server?.iosScheme}://localhost`, prodEnv),
    true,
  );
  assert.equal(capacitorConfig.plugins?.SplashScreen?.launchAutoHide, false);
});

test('all 8 required Capacitor native plugins are installed and linked into Android & iOS', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const plugin of REQUIRED_PLUGINS) {
    assert.ok(allDeps[plugin], `Missing ${plugin} in package.json`);
  }

  const androidSettings = readFileSync(
    path.join(ROOT, 'android', 'capacitor.settings.gradle'),
    'utf8',
  );
  const iosPackageSwift = readFileSync(
    path.join(ROOT, 'ios', 'App', 'CapApp-SPM', 'Package.swift'),
    'utf8',
  );

  for (const plugin of REQUIRED_PLUGINS) {
    const shortName = plugin.replace('@capacitor/', '');
    assert.ok(
      androidSettings.includes(`@capacitor/${shortName}`),
      `Android capacitor.settings.gradle missing ${plugin}`,
    );
    assert.ok(
      iosPackageSwift.toLowerCase().includes(shortName.replace(/-/g, '')),
      `iOS Package.swift missing ${plugin}`,
    );
  }
});

test('Android native shell configures RTL, permissions, deep link, and syndik_alerts channel', () => {
  const manifest = readFileSync(
    path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    'utf8',
  );
  assert.match(manifest, /android:supportsRtl="true"/);
  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.match(manifest, /android\.permission\.CAMERA/);
  assert.match(manifest, /android:scheme="@string\/custom_url_scheme"/);
  assert.match(manifest, /default_notification_channel_id/);
  assert.match(manifest, /android:value="syndik_alerts"/);

  const stringsXml = readFileSync(
    path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
    'utf8',
  );
  assert.match(stringsXml, /<string name="app_name">SyndicUnion<\/string>/);
  assert.match(stringsXml, /<string name="custom_url_scheme">syndicunion<\/string>/);

  const mainActivity = readFileSync(
    path.join(ROOT, 'android', 'app', 'src', 'main', 'java', 'ma', 'syndicunion', 'app', 'MainActivity.java'),
    'utf8',
  );
  assert.match(mainActivity, /ALERTS_CHANNEL_ID\s*=\s*"syndik_alerts"/);
  assert.match(mainActivity, /createNotificationChannel/);

  const buildGradle = readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
  assert.match(buildGradle, /applicationId\s+"ma\.syndicunion\.app"/);
});

test('iOS native shell configures SyndicUnion bundle ID, FR/AR locales, deep link, privacy keys, and APNs/FCM hooks', () => {
  const infoPlist = readFileSync(path.join(ROOT, 'ios', 'App', 'App', 'Info.plist'), 'utf8');
  assert.match(infoPlist, /<key>CFBundleDisplayName<\/key>\s*<string>SyndicUnion<\/string>/);
  assert.match(infoPlist, /<string>syndicunion<\/string>/);
  assert.match(infoPlist, /<key>NSCameraUsageDescription<\/key>/);
  assert.match(infoPlist, /<key>NSPhotoLibraryUsageDescription<\/key>/);
  assert.match(infoPlist, /<key>NSPhotoLibraryAddUsageDescription<\/key>/);
  assert.match(infoPlist, /<key>UIBackgroundModes<\/key>[\s\S]*?<string>remote-notification<\/string>/);
  assert.match(infoPlist, /<key>CFBundleLocalizations<\/key>[\s\S]*?<string>fr<\/string>[\s\S]*?<string>ar<\/string>/);

  const pbxproj = readFileSync(
    path.join(ROOT, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'),
    'utf8',
  );
  assert.match(pbxproj, /PRODUCT_BUNDLE_IDENTIFIER = ma\.syndicunion\.app;/);

  const appDelegate = readFileSync(
    path.join(ROOT, 'ios', 'App', 'App', 'AppDelegate.swift'),
    'utf8',
  );
  assert.match(appDelegate, /didRegisterForRemoteNotificationsWithDeviceToken/);
  assert.match(appDelegate, /capacitorDidRegisterForRemoteNotifications/);
  assert.match(appDelegate, /didFailToRegisterForRemoteNotificationsWithError/);
});

test('brand icons, splash assets, gitignore secrets, and dockerignore boundaries are in place', () => {
  for (const png of [
    'resources/icon-only.png',
    'resources/icon-foreground.png',
    'resources/icon-background.png',
    'resources/splash.png',
    'resources/splash-dark.png',
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png',
    'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png',
    'android/app/src/main/res/drawable/splash.png',
    'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    'ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png',
  ]) {
    assertValidPng(png);
  }

  const dockerignore = readFileSync(path.join(ROOT, '.dockerignore'), 'utf8');
  assert.match(dockerignore, /^android$/m);
  assert.match(dockerignore, /^ios$/m);
  assert.match(dockerignore, /^resources$/m);

  const gitignore = readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /android\/app\/google-services\.json/);
  assert.match(gitignore, /ios\/App\/App\/GoogleService-Info\.plist/);
  assert.match(gitignore, /\*\.keystore/);
});
