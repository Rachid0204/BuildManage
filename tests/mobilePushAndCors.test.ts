import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildAllowedCorsOrigins,
  isAllowedCorsOrigin,
} from '../server/corsPolicy';
import {
  deliverPushOutbox,
  listUserDeviceTokens,
  queuePushNotification,
  registerDeviceToken,
  unregisterDeviceToken,
} from '../server/pushNotifications';
import { hashPasswordSync } from '../utils/security';

const ROOT = resolve(import.meta.dirname, '..');

function makeMemoryRepo(initial: Record<string, any> = {}) {
  const state: Record<string, any> = structuredClone(initial);
  return {
    state,
    async transaction<T>(fn: (s: any) => Promise<T> | T): Promise<T> {
      return await fn(state);
    },
  };
}

test('CORS policy allows Capacitor native origins and configured HTTPS origins, rejecting arbitrary third-party origins', () => {
  const prodEnv: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    PUBLIC_APP_URL: 'https://immogest.cloud.run',
    SYNDIK_CORS_ORIGINS: 'https://app.syndicunion.ma, http://insecure.example.com',
  };

  const allowed = buildAllowedCorsOrigins(prodEnv);
  assert.equal(allowed.has('capacitor://localhost'), true);
  assert.equal(allowed.has('https://localhost'), true);
  assert.equal(allowed.has('https://immogest.cloud.run'), true);
  assert.equal(allowed.has('https://app.syndicunion.ma'), true);
  // HTTP non-localhost origins must never be admitted
  assert.equal(allowed.has('http://insecure.example.com'), false);
  // Dev localhost HTTP origins must not be admitted in production
  assert.equal(allowed.has('http://localhost:3000'), false);

  assert.equal(isAllowedCorsOrigin('capacitor://localhost', prodEnv), true);
  assert.equal(isAllowedCorsOrigin('https://evil.attacker.ma', prodEnv), false);
});

test('Push token registry deduplicates shared devices, enforces 8-device cap, and isolates user unregistration', () => {
  const state: Record<string, any> = {};

  registerDeviceToken(state, {
    uid: 'user-a',
    token: 'fcm_token_shared_device_0001',
    platform: 'android',
    deviceLabel: 'Samsung A54',
  });
  assert.equal(listUserDeviceTokens(state, 'user-a').length, 1);

  // If the same physical phone signs into user-b, user-a must lose that token
  registerDeviceToken(state, {
    uid: 'user-b',
    token: 'fcm_token_shared_device_0001',
    platform: 'android',
    deviceLabel: 'Samsung A54',
  });
  assert.equal(listUserDeviceTokens(state, 'user-a').length, 0);
  assert.equal(listUserDeviceTokens(state, 'user-b').length, 1);

  // User-a cannot unregister user-b's token
  const crossRemoved = unregisterDeviceToken(state, {
    uid: 'user-a',
    token: 'fcm_token_shared_device_0001',
  });
  assert.equal(crossRemoved, 0);
  assert.equal(listUserDeviceTokens(state, 'user-b').length, 1);

  // Register 10 distinct devices for user-a and verify cap of 8
  for (let i = 0; i < 10; i++) {
    registerDeviceToken(state, {
      uid: 'user-a',
      token: `fcm_token_device_number_${String(i).padStart(4, '0')}`,
      platform: i % 2 === 0 ? 'android' : 'ios',
    });
  }
  assert.equal(listUserDeviceTokens(state, 'user-a').length, 8);

  // Invalid short tokens or unknown platforms are rejected
  assert.throws(() =>
    registerDeviceToken(state, {
      uid: 'user-a',
      token: 'short',
      platform: 'android',
    }),
  );
  assert.throws(() =>
    registerDeviceToken(state, {
      uid: 'user-a',
      token: 'valid_token_length_123456',
      platform: 'windows' as any,
    }),
  );
});

test('Transactional push outbox skips users with no tokens, delivers multicast payloads, and prunes unregistered FCM tokens', async () => {
  const repo = makeMemoryRepo({});

  // Web-only user with no tokens does not bloat outbox
  const skipped = queuePushNotification(repo.state, {
    uid: 'web-only-user',
    title: 'Nouvelle charge',
    body: 'Votre cotisation mensuelle est disponible.',
    type: 'charge',
    link: '/resident',
  });
  assert.equal(skipped, null);

  registerDeviceToken(repo.state, {
    uid: 'res-1',
    token: 'fcm_valid_phone_token_001',
    platform: 'android',
  });
  registerDeviceToken(repo.state, {
    uid: 'res-1',
    token: 'fcm_stale_uninstalled_002',
    platform: 'ios',
  });

  const queued = queuePushNotification(repo.state, {
    uid: 'res-1',
    title: 'Scrutin AGO Ouvert',
    body: 'Votez depuis votre espace SyndicUnion.',
    type: 'ag',
    link: '/resident',
  });
  assert.ok(queued);

  const sentBatches: Array<{ tokens: string[]; title: string; link: string }> = [];
  const summary = await deliverPushOutbox(repo as any, 5, async (payload) => {
    sentBatches.push({
      tokens: payload.tokens,
      title: payload.title,
      link: payload.data.link,
    });
    return {
      successCount: 1,
      failureCount: 1,
      invalidTokens: ['fcm_stale_uninstalled_002'],
    };
  });

  assert.equal(summary.processed, 1);
  assert.equal(summary.delivered, 1);
  assert.equal(summary.prunedTokens, 1);
  assert.equal(sentBatches.length, 1);
  assert.deepEqual(sentBatches[0].tokens.sort(), [
    'fcm_stale_uninstalled_002',
    'fcm_valid_phone_token_001',
  ]);
  assert.equal(sentBatches[0].link, '/resident');

  // Stale token was pruned automatically; valid token remains intact
  const remaining = listUserDeviceTokens(repo.state, 'res-1');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].token, 'fcm_valid_phone_token_001');
  assert.equal(repo.state.__pushOutbox[queued.id].status, 'sent');
});

test('Live Express server enforces CORS allowlist and authenticated /api/devices/push-token CRUD while keeping tokens private', async () => {
  const port = await new Promise<number>((done, reject) => {
    const listener = createServer();
    listener.on('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const p = (listener.address() as { port: number }).port;
      listener.close(() => done(p));
    });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = mkdtempSync(join(tmpdir(), 'syndik-mobile-cors-push-'));
  const testPassword = 'Mobile-Push-Test-Password-2026!';
  const seed = {
    syndik_prod_registered_users_v1: [
      {
        uid: 'mob-res-1',
        email: 'resident@syndicunion.ma',
        profile: {
          uid: 'mob-res-1',
          email: 'resident@syndicunion.ma',
          displayName: 'Salma Berrada',
          role: 'resident',
          residentId: 'res-mob-1',
          syndicId: 'syndic-1',
          buildingId: 'bld-1',
          apartmentId: 'apt-1',
          isOwner: true,
          emailVerified: true,
        },
        passwordHash: hashPasswordSync(testPassword, 'resident@syndicunion.ma'),
      },
    ],
    syndik_prod_syndics_v1: [
      {
        id: 'syndic-1',
        name: 'Cabinet Test',
        email: 'syndic@syndicunion.ma',
        subscriptionPlan: 'professional',
        subscriptionStatus: 'active',
        subscriptionExpiry: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        buildings: [
          {
            id: 'bld-1',
            syndicId: 'syndic-1',
            name: 'Résidence Test',
            city: 'Casablanca',
            totalTantiemes: 1000,
            apartments: [
              {
                id: 'apt-1',
                buildingId: 'bld-1',
                number: 'A1',
                tantiemes: 1000,
                monthlyFee: 300,
                residentId: 'res-mob-1',
                ownerId: 'res-mob-1',
                status: 'occupied',
              },
            ],
            residents: [
              {
                id: 'res-mob-1',
                buildingId: 'bld-1',
                syndicId: 'syndic-1',
                name: 'Salma Berrada',
                email: 'resident@syndicunion.ma',
                isOwner: true,
                hasAccount: true,
                apartmentId: 'apt-1',
              },
            ],
            financials: { currentBalance: 0, reserveBalance: 0, transactions: [] },
            announcements: [],
            documents: [],
          },
        ],
      },
    ],
    syndik_prod_notifications_v1: [],
  };
  writeFileSync(join(tempDir, 'shared-state.json'), JSON.stringify(seed), 'utf8');

  let logs = '';
  const proc: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      SYNDIK_STATE_BACKEND: 'file',
      SYNDIK_UPLOAD_BACKEND: 'file',
      SYNDIK_DATA_DIR: tempDir,
      SYNDIK_SERVER_SECRET: 'mobile-push-cors-test-secret-0123456789abcdef',
      SENDGRID_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout?.on('data', (d) => (logs += String(d)));
  proc.stderr?.on('data', (d) => (logs += String(d)));

  try {
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`Server exited early:\n${logs}`);
      try {
        const res = await fetch(`${baseUrl}/api/health`);
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.equal(ready, true, `Server failed to boot:\n${logs}`);

    // 1. CORS preflight accepts capacitor://localhost
    const okPreflight = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: { Origin: 'capacitor://localhost' },
    });
    assert.equal(okPreflight.status, 204);
    assert.equal(
      okPreflight.headers.get('access-control-allow-origin'),
      'capacitor://localhost',
    );

    // 2. CORS preflight rejects untrusted third-party origin
    const badPreflight = await fetch(`${baseUrl}/api/health`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://malicious.example.com' },
    });
    assert.equal(badPreflight.status, 403);
    assert.equal(badPreflight.headers.get('access-control-allow-origin'), null);

    // 3. Unauthenticated push token registration is rejected with 401
    const unauth = await fetch(`${baseUrl}/api/devices/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'fcm_test_token_1234567890', platform: 'android' }),
    });
    assert.equal(unauth.status, 401);

    // 4. Login as resident & register / read / delete device push token
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'resident@syndicunion.ma',
        password: testPassword,
      }),
    });
    const loginData = (await loginRes.json()) as { token?: string };
    assert.equal(loginRes.status, 200);
    assert.ok(loginData.token);

    const authHeaders = {
      Authorization: `Bearer ${loginData.token}`,
      'Content-Type': 'application/json',
    };

    const regRes = await fetch(`${baseUrl}/api/devices/push-token`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        token: 'fcm_live_resident_token_001',
        platform: 'ios',
        deviceLabel: 'iPhone 15',
      }),
    });
    assert.equal(regRes.status, 200);

    const getRes = await fetch(`${baseUrl}/api/devices/push-token`, {
      method: 'GET',
      headers: authHeaders,
    });
    const getData = (await getRes.json()) as { ok: boolean; count: number; platforms: string[] };
    assert.equal(getData.ok, true);
    assert.equal(getData.count, 1);
    assert.deepEqual(getData.platforms, ['ios']);

    // 5. Verify raw device tokens never leak into /api/shared-state snapshot
    const stateRes = await fetch(`${baseUrl}/api/shared-state`, {
      method: 'GET',
      headers: authHeaders,
    });
    const stateText = await stateRes.text();
    assert.equal(stateText.includes('fcm_live_resident_token_001'), false);
    assert.equal(stateText.includes('__deviceTokens_v1'), false);

    // 6. Delete token on logout
    const delRes = await fetch(`${baseUrl}/api/devices/push-token`, {
      method: 'DELETE',
      headers: authHeaders,
      body: JSON.stringify({ token: 'fcm_live_resident_token_001' }),
    });
    const delData = (await delRes.json()) as { ok: boolean; removed: number };
    assert.equal(delRes.status, 200);
    assert.equal(delData.removed, 1);
  } finally {
    if (!proc.killed) {
      proc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
