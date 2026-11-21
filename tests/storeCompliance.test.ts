import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import {
  cancelAccountDeletionRequest,
  getActiveAccountDeletionRequest,
  submitAccountDeletionRequest,
} from '../server/accountDeletion';
import {
  listUserDeviceTokens,
  registerDeviceToken,
} from '../server/pushNotifications';
import type { State } from '../server/repository';

const ROOT = process.cwd();

test('account deletion request validates confirmation email, protects admins, revokes push tokens, and supports cancel', () => {
  const state: State = {};
  const uid = 'res-user-1';
  const email = 'resident@example.ma';

  registerDeviceToken(state, {
    uid,
    token: 'fcm_token_for_deletion_test_0123456789abcdef',
    platform: 'android',
  });
  assert.equal(listUserDeviceTokens(state, uid).length, 1);

  // Email mismatch rejected
  const badEmail = submitAccountDeletionRequest(state, {
    uid,
    email,
    role: 'resident',
    confirmEmail: 'wrong@example.ma',
  });
  assert.equal(badEmail.ok, false);
  if (!badEmail.ok) assert.equal(badEmail.status, 400);

  // Super-admin protected from self-deletion lockout
  const adminAttempt = submitAccountDeletionRequest(state, {
    uid: 'admin-1',
    email: 'admin@example.ma',
    role: 'admin',
    confirmEmail: 'admin@example.ma',
  });
  assert.equal(adminAttempt.ok, false);
  if (!adminAttempt.ok) assert.equal(adminAttempt.status, 403);

  // Valid resident request revokes push tokens immediately and persists idempotently
  const created = submitAccountDeletionRequest(state, {
    uid,
    email,
    role: 'resident',
    displayName: 'Salma Bennani',
    confirmEmail: '  RESIDENT@EXAMPLE.MA  ',
    reason: 'Départ de la résidence',
  });
  assert.equal(created.ok, true);
  if (created.ok) {
    assert.equal(created.alreadyPending, false);
    assert.equal(created.request.status, 'pending');
    assert.equal(created.request.revokedPushTokens, 1);
  }
  assert.equal(listUserDeviceTokens(state, uid).length, 0);
  assert.ok(getActiveAccountDeletionRequest(state, uid));

  // Idempotent repeat returns existing pending request
  const repeat = submitAccountDeletionRequest(state, {
    uid,
    email,
    role: 'resident',
    confirmEmail: email,
  });
  assert.equal(repeat.ok, true);
  if (repeat.ok) assert.equal(repeat.alreadyPending, true);

  // Cancel restores active state
  const cancelResult = cancelAccountDeletionRequest(state, uid);
  assert.equal(cancelResult.cancelled, true);
  assert.equal(getActiveAccountDeletionRequest(state, uid), null);
});

test('mobile-build.yml workflow builds Android debug APK, signed release AAB, and optional iOS verification', () => {
  const workflowPath = path.join(ROOT, '.github', 'workflows', 'mobile-build.yml');
  assert.ok(existsSync(workflowPath), 'Missing .github/workflows/mobile-build.yml');
  const yml = readFileSync(workflowPath, 'utf8');
  assert.match(yml, /npm run mobile:build:android/);
  assert.match(yml, /assembleDebug/);
  assert.match(yml, /bundleRelease/);
  assert.match(yml, /ANDROID_GOOGLE_SERVICES_JSON_BASE64/);
  assert.match(yml, /ANDROID_KEYSTORE_BASE64/);
  assert.match(yml, /xcodebuild/);
});

test('Live Express server enforces auth on /api/account/deletion-request and keeps records server-private', async () => {
  const port = 34000 + Math.floor(Math.random() * 10000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const tmpFile = path.join('/tmp', `syndik-del-test-${Date.now()}.json`);
  const secret = randomBytes(32).toString('hex');

  const child = spawn(
    process.execPath,
    ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', 'server.ts'],
    {
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: 'test',
        SYNDIK_TEST_MODE: 'true',
        SYNDIK_STATE_BACKEND: 'file',
        SYNDIK_STATE_FILE: tmpFile,
        SYNDIK_SERVER_SECRET: secret,
        SYNDIK_AUTH_PROVIDER: 'local',
        SYNDIK_PUSH_ENABLED: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let ready = false;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server failed to start')), 12_000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('Server running')) {
        ready = true;
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      if (!ready) {
        clearTimeout(timer);
        reject(new Error(`Server exited early (${code})`));
      }
    });
  });

  try {
    // 1. Unauthenticated requests refused with 401
    const unauth = await fetch(`${baseUrl}/api/account/deletion-request`);
    assert.equal(unauth.status, 401);

    // 2. Register a Syndic account
    const email = `syndic.del.${Date.now()}@example.ma`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'StrongPassword#2026!',
        displayName: 'Cabinet Deletion Test',
        role: 'syndic',
        companyName: 'Cabinet Deletion Test',
        phone: '0661001122',
        city: 'Casablanca',
      }),
    });
    assert.equal(regRes.status, 200);
    const regData = (await regRes.json()) as { token: string };
    const authHeaders = {
      Authorization: `Bearer ${regData.token}`,
      'Content-Type': 'application/json',
    };

    // Register a push token first
    const pushRes = await fetch(`${baseUrl}/api/devices/push-token`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        token: 'fcm_live_deletion_test_token_1234567890abcdef',
        platform: 'ios',
      }),
    });
    assert.equal(pushRes.status, 200);

    // 3. Submit deletion request
    const postRes = await fetch(`${baseUrl}/api/account/deletion-request`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ confirmEmail: email, reason: 'Test compliance' }),
    });
    assert.equal(postRes.status, 201);
    const postData = (await postRes.json()) as {
      ok: boolean;
      request: { id: string; status: string; revokedPushTokens: number };
    };
    assert.equal(postData.ok, true);
    assert.equal(postData.request.status, 'pending');
    assert.equal(postData.request.revokedPushTokens, 1);

    // Push tokens were revoked
    const tokensAfter = await fetch(`${baseUrl}/api/devices/push-token`, {
      headers: authHeaders,
    });
    const tokensJson = (await tokensAfter.json()) as { count: number };
    assert.equal(tokensJson.count, 0);

    // GET returns active request
    const getRes = await fetch(`${baseUrl}/api/account/deletion-request`, {
      headers: authHeaders,
    });
    assert.equal(getRes.status, 200);
    const getData = (await getRes.json()) as { request: { id: string } | null };
    assert.equal(getData.request?.id, postData.request.id);

    // Private store key never leaked in /api/shared-state
    const stateRes = await fetch(`${baseUrl}/api/shared-state`, {
      headers: authHeaders,
    });
    const stateData = (await stateRes.json()) as { store: Record<string, unknown> };
    assert.equal('__accountDeletionRequests_v1' in stateData.store, false);

    // 4. Cancel request
    const delRes = await fetch(`${baseUrl}/api/account/deletion-request`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    assert.equal(delRes.status, 200);
    const delJson = (await delRes.json()) as { ok: boolean; cancelled: boolean };
    assert.equal(delJson.cancelled, true);
  } finally {
    child.kill('SIGTERM');
  }
});
