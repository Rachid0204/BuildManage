import assert from 'node:assert/strict';

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value); },
  removeItem: (key: string) => { memory.delete(key); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
const { syncAllSharedStateFromServer, remoteMutation, clearStateCache, addTransaction, STORAGE_KEYS } = await import('../firebase/services');
const { setActiveAuthContext } = await import('../utils/security');
const { engineStorage } = await import('../firebase/cache');
const originalFetch = globalThis.fetch;
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, dispatchEvent: () => true } });
const session = (id: string) => setActiveAuthContext({ uid: id, displayName: id, role: 'syndic', email: `${id}@synthetic.invalid` }, `synthetic-token-${id}`);
const payload = (id: string) => ({ ok: true, revision: 1, store: { [STORAGE_KEYS.SYNDICS]: [{ id }] } });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
try {
  session('old');
  let release!: (response: Response) => void;
  globalThis.fetch = (() => new Promise<Response>(resolve => { release = resolve; })) as typeof fetch;
  const delayed = syncAllSharedStateFromServer(true);
  clearStateCache();
  session('current');
  globalThis.fetch = (async () => json(payload('current'))) as typeof fetch;
  await syncAllSharedStateFromServer(true);
  release(json(payload('old')));
  await delayed;
  assert.equal(JSON.parse(engineStorage.getItem(STORAGE_KEYS.SYNDICS)!)[0].id, 'current');

  session('old');
  globalThis.fetch = (() => new Promise<Response>(resolve => { release = resolve; })) as typeof fetch;
  const mutation = remoteMutation('addAnnouncement', ['synthetic-building', { title: 'Old identity', content: 'Synthetic content' }]);
  const rejected = assert.rejects(mutation, /session a changé/);
  clearStateCache();
  session('current');
  engineStorage.setItem(STORAGE_KEYS.SYNDICS, JSON.stringify([{ id: 'current' }]));
  release(json({ ...payload('old'), result: true }));
  await rejected;
  assert.equal(JSON.parse(engineStorage.getItem(STORAGE_KEYS.SYNDICS)!)[0].id, 'current');
  console.log('PASS: delayed reads and completed mutations cannot refill another identity\'s cache.');
  clearStateCache();
  session('current');
  globalThis.fetch = (async (_url, options) => options?.method === 'POST'
    ? json({ ...payload('after-write'), revision: 3, result: true })
    : new Promise<Response>(resolve => { release = resolve; })) as typeof fetch;
  const staleRead = syncAllSharedStateFromServer(true);
  await remoteMutation('addAnnouncement', ['synthetic-building', { title: 'New announcement', content: 'Saved content' }]);
  release(json({ ...payload('before-write'), revision: 2 }));
  await staleRead;
  assert.equal(JSON.parse(engineStorage.getItem(STORAGE_KEYS.SYNDICS)!)[0].id, 'after-write');
  console.log('PASS: a delayed refresh cannot overwrite a newer committed mutation.');
} finally {
  clearStateCache();
  setActiveAuthContext(null, null);
  globalThis.fetch = originalFetch;
  Reflect.deleteProperty(globalThis, 'window');
}

// Fast imports and multiple workers can create records within the same millisecond.
storage.setItem(STORAGE_KEYS.SYNDICS, JSON.stringify([{ id: 'synthetic-cabinet', buildings: [{ id: 'synthetic-building', financials: { balance: 0, reserveFundBalance: 0, transactions: [] } }] }]));
const now = Date.now;
Date.now = () => 1234567890;
try {
  const transactions = await Promise.all(Array.from({ length: 12 }, (_, index) => addTransaction('synthetic-building', {
    date: '2026-10-22', description: `Synthetic expense ${index}`, amount: 1,
    type: 'expense', fundType: 'courant', category: 'maintenance', paymentMethod: 'especes',
  })));
  assert.equal(new Set(transactions.map(transaction => transaction.id)).size, 12);
  const financials = JSON.parse(storage.getItem(STORAGE_KEYS.SYNDICS)!)[0].buildings[0].financials;
  assert.equal(financials.transactions.length, 12);
  assert.equal(financials.balance, -12);
  console.log('PASS: same-millisecond journal entries retain unique identities and reconcile exactly.');
} finally { Date.now = now; }
