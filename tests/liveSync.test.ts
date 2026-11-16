import assert from 'node:assert/strict';
import { test } from 'node:test';

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storage,
});

let navigatorOnline = true;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    get onLine() {
      return navigatorOnline;
    },
  },
});

const dispatchedEvents: string[] = [];
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: storage,
    sessionStorage: storage,
    dispatchEvent: (event: { type?: string }) => {
      if (event?.type) dispatchedEvents.push(event.type);
      return true;
    },
  },
});

const { startLiveSync } = await import('../firebase/liveSync');
const {
  SyncHttpError,
  clearStateCache,
  remoteMutation,
  syncAllSharedStateFromServer,
  STORAGE_KEYS,
} = await import('../firebase/services');
const { setActiveAuthContext } = await import('../utils/security');

const originalFetch = globalThis.fetch;

function sseResponse(frames: string[], holdOpen = false): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      if (!holdOpen && !cancelled) {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function flushMicrotasks(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

function setupSession(uid = 'live-sync-user') {
  clearStateCache();
  memory.clear();
  dispatchedEvents.length = 0;
  navigatorOnline = true;
  setActiveAuthContext(
    {
      uid,
      role: 'admin',
      email: `${uid}@synthetic.invalid`,
      displayName: 'Admin Synthetic',
    },
    'synthetic-live-sync-token',
  );
}

try {
  await test('single transient shared-state failure retries quietly and does not show offline banner', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    setupSession();

    let sharedStateCalls = 0;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === '/api/events') {
        return sseResponse([': heartbeat\n\n'], true);
      }
      if (url.startsWith('/api/shared-state')) {
        sharedStateCalls++;
        if (sharedStateCalls === 1) {
          return jsonResponse({ error: 'Temporary contention' }, 503);
        }
        return jsonResponse({
          ok: true,
          revision: 4,
          store: { [STORAGE_KEYS.SYNDICS]: [] },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const statuses: string[] = [];
    let unauthorizedCount = 0;
    const conn = startLiveSync(
      (s) => statuses.push(s),
      () => unauthorizedCount++,
    );

    try {
      await flushMicrotasks();
      t.mock.timers.tick(80);
      await flushMicrotasks();

      assert.equal(sharedStateCalls, 1);
      assert.equal(
        statuses.includes('offline'),
        false,
        `Unexpected offline status on single transient failure: ${JSON.stringify(statuses)}`,
      );

      t.mock.timers.tick(1250);
      await flushMicrotasks();

      assert.equal(sharedStateCalls, 2);
      assert.equal(statuses.includes('offline'), false);
      assert.equal(statuses.at(-1), 'live');
      assert.equal(unauthorizedCount, 0);
    } finally {
      conn.stop();
    }
  });

  await test('two consecutive failures while online enter offline and auto-recover when server responds', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    setupSession();

    let failReads = true;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === '/api/events') {
        return jsonResponse({ error: 'SSE unavailable' }, 503);
      }
      if (url.startsWith('/api/shared-state')) {
        if (failReads) {
          return jsonResponse({ error: 'Outage' }, 503);
        }
        return jsonResponse({
          ok: true,
          revision: 5,
          store: { [STORAGE_KEYS.SYNDICS]: [] },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const statuses: string[] = [];
    const conn = startLiveSync(
      (s) => statuses.push(s),
      () => {},
    );

    try {
      await flushMicrotasks();
      t.mock.timers.tick(80);
      await flushMicrotasks();
      assert.equal(statuses.includes('offline'), false);

      t.mock.timers.tick(1250);
      await flushMicrotasks();
      assert.equal(statuses.at(-1), 'offline');

      failReads = false;
      t.mock.timers.tick(3100);
      await flushMicrotasks();
      assert.equal(statuses.at(-1), 'polling');
    } finally {
      conn.stop();
    }
  });

  await test('hung pre-reconnect sync cannot revert status back to offline after reconnect or markSynced', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    setupSession();

    let rejectHungSync!: (err: Error) => void;
    let hungSignalAborted = false;
    let sharedStateCalls = 0;

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url === '/api/events') {
        return sseResponse([': heartbeat\n\n'], true);
      }
      if (url.startsWith('/api/shared-state')) {
        sharedStateCalls++;
        if (sharedStateCalls === 1) {
          init?.signal?.addEventListener('abort', () => {
            hungSignalAborted = true;
          });
          // Simulate a stuck promise that rejects late, after reconnect() already started a new epoch.
          return await new Promise<Response>((_resolve, reject) => {
            rejectHungSync = reject;
          });
        }
        return jsonResponse({
          ok: true,
          revision: 9,
          store: { [STORAGE_KEYS.SYNDICS]: [] },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const statuses: string[] = [];
    const conn = startLiveSync(
      (s) => statuses.push(s),
      () => {},
    );

    try {
      await flushMicrotasks();
      t.mock.timers.tick(80);
      await flushMicrotasks();
      assert.equal(sharedStateCalls, 1);

      conn.reconnect();
      assert.equal(hungSignalAborted, true);
      assert.equal(statuses.includes('connecting'), true);

      await flushMicrotasks();
      assert.equal(sharedStateCalls, 2);
      assert.equal(statuses.at(-1), 'live');

      // Late rejection of the pre-reconnect sync must be ignored completely.
      rejectHungSync(new Error('Late timeout from pre-reconnect request'));
      await flushMicrotasks();

      assert.equal(statuses.includes('offline'), false);
      assert.equal(statuses.at(-1), 'live');

      // Simulate markSynced invalidating a slow in-flight failure.
      conn.markSynced();
      await flushMicrotasks();
      assert.equal(statuses.at(-1), 'live');
    } finally {
      conn.stop();
    }
  });

  await test('401/403 on shared-state or events triggers onUnauthorized cleanly without offline banner or retry loops', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });

    for (const authEndpoint of ['shared-state', 'events'] as const) {
      setupSession(`auth-${authEndpoint}`);
      let eventCalls = 0;
      let sharedCalls = 0;
      let unauthorized = 0;
      let resolvedAuth = false;

      globalThis.fetch = (async (input) => {
        const url = String(input);
        if (url === '/api/events') {
          eventCalls++;
          if (authEndpoint === 'events' && !resolvedAuth) {
            return new Response('Forbidden', { status: 403 });
          }
          return sseResponse([': heartbeat\n\n'], true);
        }
        if (url.startsWith('/api/shared-state')) {
          sharedCalls++;
          if (authEndpoint === 'shared-state' && !resolvedAuth) {
            return new Response('Unauthorized', { status: 401 });
          }
          return jsonResponse({
            ok: true,
            revision: 12,
            unchanged: sharedCalls > 1,
            store: { [STORAGE_KEYS.SYNDICS]: [] },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      }) as typeof fetch;

      const statuses: string[] = [];
      const conn = startLiveSync(
        (s) => statuses.push(s),
        () => unauthorized++,
      );

      try {
        await flushMicrotasks();
        t.mock.timers.tick(80);
        await flushMicrotasks();

        assert.equal(unauthorized, 1);
        assert.equal(statuses.includes('offline'), false);

        const callsWhilePaused = { eventCalls, sharedCalls };
        t.mock.timers.tick(15_000);
        await flushMicrotasks();
        assert.deepEqual(
          { eventCalls, sharedCalls },
          callsWhilePaused,
          'Must not keep polling or reconnecting SSE while session refresh is pending',
        );

        resolvedAuth = true;
        conn.reconnect();
        await flushMicrotasks();
        t.mock.timers.tick(80);
        await flushMicrotasks();

        assert.equal(statuses.includes('offline'), false);
        assert.equal(statuses.at(-1), 'live');
      } finally {
        conn.stop();
      }
    }
  });

  await test('SyncHttpError preserves HTTP status even on non-JSON 502/401 error bodies and emits events correctly', async () => {
    setupSession();

    globalThis.fetch = (async () =>
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      })) as typeof fetch;

    await assert.rejects(
      syncAllSharedStateFromServer(true),
      (error: unknown) =>
        error instanceof SyncHttpError && error.status === 502,
    );

    globalThis.fetch = (async () =>
      new Response('Plain 401 Unauthorized', {
        status: 401,
        headers: { 'Content-Type': 'text/plain' },
      })) as typeof fetch;

    await assert.rejects(
      syncAllSharedStateFromServer(true),
      (error: unknown) =>
        error instanceof SyncHttpError && error.status === 401,
    );
    assert.equal(dispatchedEvents.includes('syndik-session-invalid'), true);

    dispatchedEvents.length = 0;
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === '/api/commands') {
        return jsonResponse({ ok: true, revision: 20, result: true });
      }
      return jsonResponse({ ok: true, revision: 20, unchanged: true });
    }) as typeof fetch;

    await syncAllSharedStateFromServer(true);
    assert.equal(dispatchedEvents.includes('syndik-sync-succeeded'), true);

    dispatchedEvents.length = 0;
    await remoteMutation('addAnnouncement', [
      'b-1',
      { title: 'Note', content: 'Synthetic note' },
    ]);
    assert.equal(dispatchedEvents.includes('syndik-sync-succeeded'), true);
  });

  await test('healthy SSE heartbeats reset exponential backoff and goOffline/false navigator.onLine behave accurately', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    setupSession();

    let sseAttempt = 0;
    let simulateOfflineNetwork = false;
    globalThis.fetch = (async (input) => {
      if (simulateOfflineNetwork) {
        throw new TypeError('Failed to fetch');
      }
      const url = String(input);
      if (url === '/api/events') {
        sseAttempt++;
        if (sseAttempt <= 3) {
          return jsonResponse({ error: 'Startup error' }, 503);
        }
        // Attempt 4 simulates clean 60s expiry (closes after heartbeat); subsequent attempts stay open
        return sseResponse([': heartbeat\n\n'], sseAttempt >= 5);
      }
      if (url.startsWith('/api/shared-state')) {
        return jsonResponse({ ok: true, revision: 7, store: {} });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const statuses: string[] = [];
    const conn = startLiveSync(
      (s) => statuses.push(s),
      () => {},
    );

    try {
      await flushMicrotasks(); // attempt 1 (fails) -> 1000ms timer
      t.mock.timers.tick(1050);
      await flushMicrotasks(); // attempt 2 (fails) -> 2000ms timer
      t.mock.timers.tick(2050);
      await flushMicrotasks(); // attempt 3 (fails) -> 4000ms timer
      t.mock.timers.tick(4050);
      await flushMicrotasks(); // attempt 4 (succeeds, receives heartbeat, resets attempt=0)

      assert.equal(sseAttempt, 4);

      // Should reconnect after 1000ms (base delay, NOT 8000ms!), confirming backoff reset.
      t.mock.timers.tick(1050);
      await flushMicrotasks();
      assert.equal(sseAttempt, 5);

      // Browser offline event immediately reports 'offline'.
      navigatorOnline = false;
      simulateOfflineNetwork = true;
      conn.goOffline();
      assert.equal(statuses.at(-1), 'offline');

      // Reconnect probes real network -> transitions 'connecting' -> back to 'offline' immediately on failure #1 when !navigator.onLine.
      conn.reconnect();
      assert.equal(statuses.includes('connecting'), true);
      await flushMicrotasks();
      assert.equal(statuses.at(-1), 'offline');

      // Even if navigator.onLine stays falsely false (VPN/proxy/sandbox), once real fetches succeed, reconnect/fallback recovers cleanly to 'live'!
      simulateOfflineNetwork = false;
      conn.reconnect();
      assert.equal(statuses.at(-1), 'connecting');
      await flushMicrotasks();
      assert.equal(statuses.at(-1), 'live');
    } finally {
      conn.stop();
    }
  });

  await test('markSynced blocks late in-flight failures from showing offline and routine SSE reconnect skips unchanged revision', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    setupSession();

    let sseCalls = 0;
    let sharedCalls = 0;
    let rejectSlowRead!: (reason: Error) => void;

    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url === '/api/events') {
        sseCalls++;
        if (sseCalls === 1) {
          // Initial connect: emits revision 10 and closes cleanly at 60s expiry
          return sseResponse(['event: revision\ndata: {"revision": 10}\n\n'], false);
        }
        if (sseCalls === 2) {
          // Routine reconnect: revision unchanged (still 10), should not trigger shared-state poll
          return sseResponse(['event: revision\ndata: {"revision": 10}\n\n'], true);
        }
        // Later reconnect with bumped revision (11) MUST trigger shared-state poll
        return sseResponse(['event: revision\ndata: {"revision": 11}\n\n'], true);
      }
      if (url.startsWith('/api/shared-state')) {
        sharedCalls++;
        if (sharedCalls === 1) {
          return jsonResponse({
            ok: true,
            revision: 10,
            store: { [STORAGE_KEYS.SYNDICS]: [] },
          });
        }
        if (sharedCalls === 2) {
          return await new Promise<Response>((_resolve, reject) => {
            rejectSlowRead = reject;
          });
        }
        return jsonResponse({
          ok: true,
          revision: 11,
          store: { [STORAGE_KEYS.SYNDICS]: [] },
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const statuses: string[] = [];
    const conn = startLiveSync(
      (s) => statuses.push(s),
      () => {},
    );

    try {
      await flushMicrotasks();
      t.mock.timers.tick(80);
      await flushMicrotasks();
      assert.equal(sharedCalls, 1);

      // Routine SSE reconnect after 1000ms with same revision 10 skips redundant poll
      t.mock.timers.tick(1050);
      await flushMicrotasks();
      t.mock.timers.tick(100);
      await flushMicrotasks();
      assert.equal(sseCalls, 2);
      assert.equal(sharedCalls, 1);

      // Simulate manual refresh starting a slow sync, while an external command/sync already succeeded (markSynced)
      conn.refresh();
      t.mock.timers.tick(80);
      await flushMicrotasks();
      assert.equal(sharedCalls, 2);

      conn.markSynced();
      rejectSlowRead(new Error('Slow read failed after newer sync succeeded'));
      await flushMicrotasks();
      t.mock.timers.tick(1500);
      await flushMicrotasks();
      assert.equal(statuses.includes('offline'), false);
    } finally {
      conn.stop();
    }
  });
} finally {
  clearStateCache();
  setActiveAuthContext(null, null);
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'localStorage');
}
