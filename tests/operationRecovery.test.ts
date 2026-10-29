import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readOperationStatus, operationActorScope } from '../server/operationStatus';
import { withRequestDeadline } from '../firebase/requestDeadline';
const memory = new Map<string, string>();
const storage = { getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
const { remoteMutation, clearStateCache } = await import('../firebase/services');
const { setActiveAuthContext } = await import('../utils/security');
const events: any[] = [];
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: storage, sessionStorage: storage, dispatchEvent: (e: any) => { events.push(e.detail); return true; },
} });
const originalFetch = globalThis.fetch;
const session = (uid = 'recovery-owner') => setActiveAuthContext({ uid, role: 'syndic', email: '', displayName: uid }, 'synthetic-token-not-for-storage');
const json = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const reset = () => { clearStateCache(); memory.clear(); events.length = 0; session(); };
try {
  await test('reload reuses uploaded references and the original opId after an uncommitted response', async () => {
    reset(); let uploads = 0; const ids: string[] = []; const args: any[] = [];
    globalThis.fetch = (async (url, init) => {
      assert.ok(init?.signal);
      if (url === '/api/uploads') { uploads++; return json({ url: '/api/uploads/private-file', fileId: 'private-file' }); }
      if (url === '/api/operations/status') return json({ ok: true, status: 'not_found' });
      const body = JSON.parse(String(init?.body)); ids.push(body.operationId); args.push(body.args);
      if (ids.length === 1) throw new TypeError('connection interrupted');
      return json({ ok: true, result: { id: 'maintenance-result' } });
    }) as typeof fetch;
    const input = [{ buildingId: 'building', photoUrl: 'data:image/png;base64,SYNTHETICBLOB', password: 'never-store-password', token: 'never-store-token' }];
    await assert.rejects(remoteMutation('addMaintenanceRequest', input), /interrupted/);
    const saved = [...memory.values()].join('');
    for (const secret of ['never-store-password', 'never-store-token', 'SYNTHETICBLOB', 'synthetic-token-not-for-storage']) assert.ok(!saved.includes(secret));
    clearStateCache();
    await remoteMutation('addMaintenanceRequest', input);
    assert.equal(uploads, 1); assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.deepEqual(args[0], args[1]);
    assert.ok(events.some(e => e.phase === 'checking')); assert.ok(events.some(e => e.phase === 'settled'));
  });
  await test('pending, unavailable and expired lookups never dispatch a new command or discard its ID', async () => {
    for (const outcome of ['pending', 'unavailable', 'expired']) {
      reset(); let posts = 0;
      globalThis.fetch = (async (url) => {
        if (url === '/api/commands') { posts++; throw new Error('interrupted'); }
        if (outcome === 'unavailable') throw new Error('offline');
        return outcome === 'expired' ? json({ error: 'expired' }, 410) : json({ ok: true, status: 'pending' });
      }) as typeof fetch;
      await assert.rejects(remoteMutation('addAnnouncement', ['building', { title: 'A' }]));
      const saved = [...memory.values()]; clearStateCache();
      await assert.rejects(remoteMutation('addAnnouncement', ['building', { title: 'A' }]));
      assert.equal(posts, 1); assert.deepEqual([...memory.values()], saved);
    }
  });
  await test('a modified submission cannot bypass an unresolved operation for the same target', async () => {
    reset(); let posts = 0;
    globalThis.fetch = (async url => {
      if (url === '/api/commands') { posts++; throw new Error('interrupted'); }
      return json({ ok: true, status: 'not_found' });
    }) as typeof fetch;
    await assert.rejects(remoteMutation('addAnnouncement', ['building', { title: 'A' }]));
    clearStateCache();
    await assert.rejects(remoteMutation('addAnnouncement', ['building', { title: 'B' }]), /différente/);
    assert.equal(posts, 1);
  });
  await test('pending metadata is identity scoped and unavailable storage fails before dispatch', async () => {
    reset(); let posts = 0, checks = 0;
    globalThis.fetch = (async url => { if (url === '/api/operations/status') checks++; else posts++; throw new Error('interrupted'); }) as typeof fetch;
    await assert.rejects(remoteMutation('addAnnouncement', ['building', { title: 'A' }]));
    clearStateCache(); session('other-owner');
    await assert.rejects(remoteMutation('addAnnouncement', ['building', { title: 'A' }]));
    assert.equal(checks, 0); assert.equal(posts, 2); assert.equal(memory.size, 2);
    clearStateCache(); session('storage-denied');
    const original = storage.setItem; storage.setItem = () => { throw new Error('storage unavailable'); };
    try { await assert.rejects(remoteMutation('addAnnouncement', ['building', { title: 'A' }]), /storage unavailable/); }
    finally { storage.setItem = original; }
    assert.equal(posts, 2);
  });
  await test('deadline aborts both a stalled request and a stalled response body', async () => {
    for (const body of [false, true]) {
      globalThis.fetch = (async (_url, init) => {
        const wait = () => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
        return body ? { json: wait } : wait();
      }) as typeof fetch;
      await assert.rejects(withRequestDeadline('/synthetic', {}, r => r.json(), 5), /aborted/);
    }
  });
  await test('receipt lookup isolates users and scopes and waits for identity finalization', () => {
    const actor = { uid: 'owner', role: 'syndic', syndicId: 'cabinet' };
    const id = `op:${Date.now()}:synthetic-operation`;
    const receipt = { operation: 'addResident', actorScope: operationActorScope(actor), identityMutationId: 'intent', responseJson: JSON.stringify({ result: { id: 'resident' } }) };
    const state: any = { __operations: { [`owner:${id}`]: receipt }, __firebaseMutations_v1: { intent: { status: 'pending' } } };
    assert.equal(readOperationStatus(state, actor, id).status, 'pending');
    state.__firebaseMutations_v1.intent.status = 'finalized';
    assert.equal(readOperationStatus(state, actor, id).status, 'completed');
    assert.equal(readOperationStatus(state, { ...actor, uid: 'other' }, id).status, 'not_found');
    assert.throws(() => readOperationStatus(state, { ...actor, syndicId: 'other' }, id), /contexte/);
  });
} finally {
  clearStateCache(); setActiveAuthContext(null, null); globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'localStorage');
}
