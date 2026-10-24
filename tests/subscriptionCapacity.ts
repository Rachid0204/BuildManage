import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as policy from '../utils/subscriptionPolicy';
import { hashPasswordSync } from '../utils/security';

const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, String(value)),
  removeItem: (key: string) => values.delete(key),
} });
const svc = await import('../firebase/services');
const K = svc.STORAGE_KEYS;
const read = (key: string): any => JSON.parse(values.get(key) || '[]');
const write = (key: string, value: unknown) => values.set(key, JSON.stringify(value));
const count = (buildings?: any[]) => (policy as any).countActiveBuildings(buildings);
const capacity = (cabinet: any) => (policy as any).getBuildingCapacity(cabinet);
const newBuilding = (name = 'Replacement building') => ({ name, address: 'Synthetic address', city: 'Casablanca', monthlySyndicFees: 100 });
const building = (id: string, syndicId: string, archived = false) => ({ id, syndicId, ...newBuilding(id),
  ...(archived ? { archivedAt: '2026-01-01T00:00:00.000Z' } : {}),
  apartments: [], residents: [], documents: [], announcements: [],
  financials: { balance: 1000.01, reserveFundBalance: 500.02, openingWorkingBalance: 1000.01,
    openingReserveBalance: 500.02, transactions: [] },
});
function cabinet(id: string, active: number, archived = 0) {
  return { id, name: id, createdBy: 'capacity-owner', subscriptionPlan: 'starter', subscriptionStatus: 'active',
    subscriptionExpiry: '2099-01-01', buildings: [
      ...Array.from({ length: active }, (_, i) => building(`${id}-active-${i}`, id)),
      ...Array.from({ length: archived }, (_, i) => building(`${id}-archived-${i}`, id, true)),
    ] };
}
function reset(active = 4, archived = 0) {
  values.clear(); write(K.SYNDICS, [cabinet('capacity-s', active, archived)]);
  for (const key of [K.CHARGES, K.QUITTANCES, K.PROOFS, K.INVOICES]) write(key, []);
}

await test('canonical active count excludes archives, handles legacy empty flags and never writes records', () => {
  const rows = [building('active', 's'), building('archived', 's', true), { id: 'legacy', archivedAt: null }];
  const before = structuredClone(rows);
  assert.equal(count(rows), 2); assert.equal(count(), 0); assert.deepEqual(rows, before);
});
await test('capacity uses active counts and the canonical plan table, including a three-building test limit', () => {
  const original = policy.PLANS.starter.buildings;
  try {
    policy.PLANS.starter.buildings = 3;
    assert.deepEqual(capacity(cabinet('three', 2, 1)), { active: 2, limit: 3, available: 1, canAdd: true });
    assert.deepEqual(capacity(cabinet('three', 3, 1)), { active: 3, limit: 3, available: 0, canAdd: false });
    assert.deepEqual(capacity(cabinet('three', 4, 1)), { active: 4, limit: 3, available: 0, canAdd: false });
  } finally { policy.PLANS.starter.buildings = original; }
});
await test('archiving one of four starter buildings permits a replacement fourth active building', async () => {
  reset(); const stored = read(K.SYNDICS); stored[0].buildings[3].archivedAt = '2026-10-24'; write(K.SYNDICS, stored);
  const history = structuredClone(stored[0].buildings);
  await svc.addBuilding('capacity-s', newBuilding());
  const buildings = read(K.SYNDICS)[0].buildings;
  assert.equal(buildings.filter((b: any) => !b.archivedAt).length, 4);
  assert.equal(buildings.length, 5);
  for (const original of history) assert.deepEqual(buildings.find((b: any) => b.id === original.id), original);
});
await test('three-building fixture: archive one, create the third active building, then block a fourth', async () => {
  const original = policy.PLANS.starter.buildings;
  try {
    policy.PLANS.starter.buildings = 3; reset(2, 1);
    await svc.addBuilding('capacity-s', newBuilding());
    assert.equal(read(K.SYNDICS)[0].buildings.filter((b: any) => !b.archivedAt).length, 3);
    const before = [...values.entries()];
    await assert.rejects(() => svc.addBuilding('capacity-s', newBuilding('Over limit')), /3/);
    assert.deepEqual([...values.entries()], before);
  } finally { policy.PLANS.starter.buildings = original; }
});
await test('direct service cannot ignore a changed canonical plan limit with a duplicate hardcoded map', async () => {
  const original = policy.PLANS.starter.buildings;
  try {
    policy.PLANS.starter.buildings = 3; reset(3);
    const before = [...values.entries()];
    await assert.rejects(() => svc.addBuilding('capacity-s', newBuilding()), /3/);
    assert.deepEqual([...values.entries()], before);
  } finally { policy.PLANS.starter.buildings = original; }
});
await test('active capacity remains bounded for every configured plan', () => {
  for (const [plan, config] of Object.entries(policy.PLANS)) {
    const rows = Array.from({ length: config.buildings }, (_, index) => ({ id: `${plan}-${index}` }));
    assert.equal(capacity({ subscriptionPlan: plan, buildings: [...rows, { id: 'old', archivedAt: '2026-01-01' }] }).canAdd, false);
    assert.equal(capacity({ subscriptionPlan: plan, buildings: rows.slice(1) }).available, 1);
  }
});
await test('syndic/admin shared selectors exclude archived and permanently removed buildings without rewriting history', async () => {
  reset(2, 1); const stored = read(K.SYNDICS); stored[0].buildings = stored[0].buildings.filter((b: any) => b.id !== 'capacity-s-active-1');
  stored.push(cabinet('other', 1, 2)); write(K.SYNDICS, stored);
  const before = [...values.entries()];
  const view = await svc.getSyndics();
  assert.deepEqual(view.map(s => s.buildings.map(b => b.id)), [['capacity-s-active-0'], ['other-active-0']]);
  assert.equal(view.reduce((sum, s) => sum + count(s.buildings), 0), 2);
  assert.deepEqual([...values.entries()], before);
});

const cabinets = [cabinet('workflow', 0), cabinet('restore-below', 3, 1), cabinet('restore-full', 4, 1),
  cabinet('restore-over', 5, 1), cabinet('race-create', 3, 2), cabinet('race-restore', 3, 2),
  cabinet('already-active', 4), { ...cabinet('expired', 0, 1), subscriptionStatus: 'expired' },
  { ...cabinet('foreign', 0, 1), createdBy: 'foreign-owner' }];
const directory = mkdtempSync(join(tmpdir(), 'buildmanage-capacity-'));
const stateFile = join(directory, 'shared-state.json');
const password = 'Synthetic-Capacity-Password-42!';
const profiles = [
  { uid: 'capacity-owner', email: 'owner@capacity.invalid', displayName: 'Capacity owner', role: 'syndic', syndicId: 'workflow', emailVerified: true },
  { uid: 'capacity-admin', email: 'admin@capacity.invalid', displayName: 'Capacity admin', role: 'admin', emailVerified: true },
];
writeFileSync(stateFile, JSON.stringify({ syndik_prod_syndics_v1: cabinets,
  syndik_prod_registered_users_v1: profiles.map(profile => ({ uid: profile.uid, email: profile.email, profile,
    passwordHash: hashPasswordSync(password, profile.email) })),
}));
const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port; await new Promise<void>(resolve => listener.close(() => resolve()));
const child = spawn(process.execPath, ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', 'server.ts'], {
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', SYNDIK_AUTH_PROVIDER: 'legacy',
    SYNDIK_STATE_BACKEND: 'file', SYNDIK_DATA_DIR: directory, SYNDIK_SERVER_SECRET: 'synthetic-capacity-secret-123456789012345678901',
    GEMINI_API_KEY: '', API_KEY: '', SENDGRID_API_KEY: '', FIREBASE_AUTH_EMULATOR_HOST: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(child, 'exit'); let logs = '';
child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
const timeout = setTimeout(() => child.kill(), 90000);
const disk = () => JSON.parse(readFileSync(stateFile, 'utf8'));
const storedCabinet = (id: string) => disk().syndik_prod_syndics_v1.find((s: any) => s.id === id);
async function call(route: string, token?: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  }); return { status: response.status, data: await response.json() as any };
}
const command = (token: string, operation: string, args: unknown[]) => call('/api/commands', token, { operation, args, operationId: crypto.randomUUID() });
try {
  for (let attempt = 0; attempt < 200 && !logs.includes('Server running'); attempt++) {
    if (child.exitCode !== null) throw new Error(logs); await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(logs.includes('Server running'), logs);
  const tokens: string[] = [];
  for (const profile of profiles) {
    const login = await call('/api/auth/login', undefined, { identifier: profile.email, password });
    assert.equal(login.status, 200); tokens.push(login.data.token);
  }
  const [owner, admin] = tokens;
  await test('API creates four, archives one, then creates a replacement without the service duplicate guard blocking it', async () => {
    const created = [];
    for (let index = 0; index < 4; index++) {
      const result = await command(owner, 'addBuilding', ['workflow', newBuilding(`Workflow ${index}`)]);
      assert.equal(result.status, 200, JSON.stringify(result.data)); created.push(result.data.result);
    }
    const archived = await command(owner, 'deleteBuilding', [created[3].id]); assert.equal(archived.status, 200);
    const preserved = structuredClone(storedCabinet('workflow').buildings);
    const replacement = await command(owner, 'addBuilding', ['workflow', newBuilding()]);
    assert.equal(replacement.status, 200, JSON.stringify(replacement.data));
    assert.equal(storedCabinet('workflow').buildings.filter((b: any) => !b.archivedAt).length, 4);
    for (const old of preserved) assert.deepEqual(storedCabinet('workflow').buildings.find((b: any) => b.id === old.id), old);
  });
  await test('restoring below capacity succeeds without changing financial records', async () => {
    const before = structuredClone(storedCabinet('restore-below').buildings.at(-1));
    const result = await command(owner, 'restoreArchived', ['buildings', before.id]); assert.equal(result.status, 200, JSON.stringify(result.data));
    const after = storedCabinet('restore-below').buildings.at(-1);
    delete before.archivedAt; assert.deepEqual(after, before);
  });
  for (const id of ['restore-full', 'restore-over']) for (const [role, token] of [['syndic', owner], ['admin', admin]]) {
    await test(`${role}: restore at/above capacity returns a clear 409 limit error and changes nothing (${id})`, async () => {
      const before = structuredClone(storedCabinet(id));
      const result = await command(token, 'restoreArchived', ['buildings', `${id}-archived-0`]);
      assert.equal(result.status, 409, JSON.stringify(result.data)); assert.match(result.data.error, /Limite.*forfait.*atteinte/i);
      assert.deepEqual(storedCabinet(id), before);
    });
  }
  await test('concurrent creates claim the final active slot once, even with many archived records', async () => {
    const results = await Promise.all([0, 1].map(i => command(owner, 'addBuilding', ['race-create', newBuilding(`Race ${i}`)])));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal(storedCabinet('race-create').buildings.filter((b: any) => !b.archivedAt).length, 4);
    assert.equal(storedCabinet('race-create').buildings.filter((b: any) => b.archivedAt).length, 2);
  });
  await test('concurrent restores claim the final active slot once', async () => {
    const results = await Promise.all([0, 1].map(i => command(owner, 'restoreArchived', ['buildings', `race-restore-archived-${i}`])));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    assert.equal(storedCabinet('race-restore').buildings.filter((b: any) => !b.archivedAt).length, 4);
  });
  await test('restoring an already-active building is a capacity-neutral retry at a full plan', async () => {
    const before = structuredClone(storedCabinet('already-active'));
    const result = await command(owner, 'restoreArchived', ['buildings', 'already-active-active-0']);
    assert.equal(result.status, 200, JSON.stringify(result.data)); assert.deepEqual(storedCabinet('already-active'), before);
  });
  await test('expired subscriptions still cannot restore buildings despite having free capacity', async () => {
    const before = structuredClone(storedCabinet('expired'));
    const result = await command(owner, 'restoreArchived', ['buildings', 'expired-archived-0']);
    assert.equal(result.status, 402); assert.deepEqual(storedCabinet('expired'), before);
  });
  await test('restoration preserves tenant authorization and never resurrects a permanently absent building', async () => {
    const foreign = structuredClone(storedCabinet('foreign'));
    assert.equal((await command(owner, 'restoreArchived', ['buildings', 'foreign-archived-0'])).status, 403);
    assert.equal((await command(admin, 'restoreArchived', ['buildings', 'permanently-deleted'])).status, 404);
    assert.deepEqual(storedCabinet('foreign'), foreign);
  });
} finally { clearTimeout(timeout); child.kill(); await exited; rmSync(directory, { recursive: true, force: true }); }
