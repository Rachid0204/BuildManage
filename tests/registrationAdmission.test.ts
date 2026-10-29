import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { admit, createAdmissionStore, registrationAdmission, type AdmissionState, type AdmissionStore } from '../server/registrationAdmission';

const blank = (): AdmissionState => ({ attempts: [], reservations: [] });
await test('HTTP IP/email bursts and resends stop before repository or Firebase calls', async () => {
  let state = blank(), transactions = 0, firebaseCalls = 0;
  const store: AdmissionStore = { update: async run => run(state) };
  const app = express();
  app.set('trust proxy', 1); // Test-only simulated trusted ingress.
  app.use(express.json());
  app.use(registrationAdmission(store));
  const repository = { transaction: async () => { transactions++; firebaseCalls++; } };
  app.post(['/api/auth/register', '/api/auth/verification/request'], async (_req, res) => {
    await repository.transaction(); res.json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const call = (email: string, ip: string, route = '/api/auth/register', authorization = '') => fetch(`http://127.0.0.1:${address.port}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, Authorization: authorization }, body: JSON.stringify({ email }),
  });
  const blocked = async (response: Response, before: number) => {
    assert.equal(response.status, 429);
    const data = await response.json(); assert.equal(data.code, 'AUTH_RATE_LIMITED'); assert.equal(data.ok, false);
    assert.ok(Number(response.headers.get('retry-after')) > 0);
    assert.equal(Number(response.headers.get('retry-after')), data.retryAfter);
    assert.equal(transactions, before); assert.equal(firebaseCalls, before);
  };
  try {
    for (let i = 0; i < 10; i++) assert.equal((await call(`user${i}@example.test`, '192.0.2.1')).status, 200);
    await blocked(await call('next@example.test', '192.0.2.1'), 10);
    state = blank();
    for (let i = 0; i < 3; i++) assert.equal((await call(i % 2 ? '  PERSON@EXAMPLE.TEST ' : 'person@example.test', `192.0.2.${i + 2}`)).status, 200);
    await blocked(await call('Person@Example.Test', '192.0.2.99'), 13);
    state = blank();
    for (let i = 0; i < 5; i++) {
      const token = `Bearer header.${Buffer.from(JSON.stringify({ email: 'verify@example.test', sub: 'user', iat: i })).toString('base64url')}.signature`;
      assert.equal((await call('', `192.0.2.${i + 2}`, '/api/auth/verification/request', token)).status, 200);
    }
    const token = `Bearer header.${Buffer.from(JSON.stringify({ email: 'VERIFY@example.test' })).toString('base64url')}.signature`;
    await blocked(await call('', '192.0.2.99', '/api/auth/verification/request', token), 18);
    store.update = async () => { throw new Error('store offline'); };
    assert.equal((await call('new@example.test', '192.0.2.99')).status, 503);
    assert.equal(transactions, 18);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

await test('rolling reservation cap, expiry and bounded state survive distinct IPs', () => {
  const state = blank(), now = 100000000;
  for (let i = 0; i < 200; i++) assert.equal(admit(state, 'register', `ip${i}`, `email${i}`, now).allowed, true);
  assert.equal(admit(state, 'register', 'other', 'other', now).allowed, false);
  assert.equal(admit(state, 'register', 'other', 'other', now + 3600001).allowed, false);
  assert.equal(state.reservations.length, 200);
  assert.equal(admit(state, 'register', 'other', 'other', now + 86400000).allowed, true);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.attempts.length, 1);
});

await test('two admission stores atomically share quotas without platform state or plaintext identities', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'admission-'));
  const old = { dir: process.env.SYNDIK_DATA_DIR, backend: process.env.SYNDIK_STATE_BACKEND };
  process.env.SYNDIK_DATA_DIR = directory; process.env.SYNDIK_STATE_BACKEND = 'file';
  try {
    const stores = [createAdmissionStore(), createAdmissionStore()];
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => stores[i % 2].update(s => admit(s, 'register', 'same-ip', `identity${i}@example.test`))));
    assert.equal(results.filter(r => r.allowed).length, 10);
    const raw = await readFile(path.join(directory, 'admission/registration.json'), 'utf8');
    assert.ok(!raw.includes('example.test')); assert.ok(!raw.includes('same-ip'));
    await assert.rejects(readFile(path.join(directory, 'shared-state.json')), { code: 'ENOENT' });
    assert.equal((await createAdmissionStore().update(s => admit(s, 'register', 'same-ip', 'new@example.test'))).allowed, false);
  } finally {
    for (const [key, value] of [['SYNDIK_DATA_DIR', old.dir], ['SYNDIK_STATE_BACKEND', old.backend]]) {
      if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
