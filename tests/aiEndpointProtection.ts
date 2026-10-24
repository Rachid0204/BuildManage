import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, request, type Server } from 'node:http';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { FirestoreRepository } from '../server/repository';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPassword } from '../server/passwords';
import { gzipSync } from 'node:zlib';
import { EventEmitter } from 'node:events';
import { registerAiEndpoints } from '../server/aiEndpoints';
import { DependencyError } from '../server/dependencyErrors';

const password = 'Synthetic-AI-Protection-42!';
const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const image = `data:image/png;base64,${png.toString('base64')}`;
const profiles = [
  { uid: 'ai-owner', role: 'syndic', syndicId: 'ai-cabinet', email: 'owner@ai.invalid' },
  { uid: 'user-res-ai-resident', role: 'resident', residentId: 'ai-resident', syndicId: 'ai-cabinet', buildingId: 'ai-building', email: 'resident@ai.invalid' },
  { uid: 'user-prest-ai-provider', role: 'provider', prestataireId: 'ai-provider', syndicId: 'ai-cabinet', buildingId: 'ai-building', email: 'provider@ai.invalid' },
  { uid: 'ai-admin', role: 'admin', email: 'admin@ai.invalid' },
  { uid: 'ai-expired-owner', role: 'syndic', syndicId: 'ai-expired', email: 'expired@ai.invalid' },
  { uid: 'ai-suspended-owner', role: 'syndic', syndicId: 'ai-suspended', email: 'suspended@ai.invalid' },
  { uid: 'ai-peer-owner', role: 'syndic', syndicId: 'ai-peer', email: 'peer@ai.invalid' },
];
const building = (id: string, syndicId: string, residentId: string, archivedAt?: string) => ({
  id, syndicId, name: id, archivedAt, residents: [{ id: residentId, syndicId, buildingId: id,
    email: 'resident@ai.invalid', name: 'AI Resident', phone: '0600000000', isOwner: true, hasAccount: true }],
  apartments: [{ id: `lot-${id}`, buildingId: id, ownerId: residentId, tenantId: null, monthlyFees: 100, tantiemes: 1000 }],
});
const seed = () => ({
  syndik_prod_registered_users_v1: profiles.map(p => ({ uid: p.uid, email: p.email, passwordHash: hashPassword(password),
    profile: { ...p, displayName: p.uid, emailVerified: true, mustChangePassword: false } })),
  syndik_prod_syndics_v1: [
    { id: 'ai-cabinet', createdBy: 'ai-owner', name: 'AI cabinet', subscriptionPlan: 'starter', subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01',
      buildings: [building('ai-building', 'ai-cabinet', 'ai-resident'), building('ai-other-building', 'ai-cabinet', 'ai-other-resident'),
        building('ai-archived', 'ai-cabinet', 'ai-archived-resident', '2025-01-01')] },
    ...['expired', 'suspended', 'peer'].map(kind => ({ id: `ai-${kind}`, createdBy: `ai-${kind}-owner`, name: kind,
      subscriptionPlan: 'starter', subscriptionStatus: kind === 'suspended' ? 'suspended' : 'active',
      subscriptionExpiry: kind === 'expired' ? '2000-01-01' : '2099-01-01', buildings: [building(`ai-${kind}-building`, `ai-${kind}`, `${kind}-resident`)] })),
  ],
  syndik_prod_prestataires_v1: [{ id: 'ai-provider', name: 'Provider', email: profiles[2].email, buildingId: 'ai-building', syndicId: 'ai-cabinet', hasAccount: true }],
  syndik_prod_charges_v1: [
    { id: 'ai-charge', syndicId: 'ai-cabinet', buildingId: 'ai-building', residentId: 'ai-resident', apartmentId: 'lot-ai-building', amount: 135, paidAmount: 35, status: 'pending' },
    { id: 'ai-other-charge', syndicId: 'ai-cabinet', buildingId: 'ai-other-building', residentId: 'ai-other-resident', apartmentId: 'lot-ai-other-building', amount: 90, status: 'pending' },
    { id: 'ai-other-lot-charge', syndicId: 'ai-cabinet', buildingId: 'ai-building', residentId: 'ai-other-resident', apartmentId: 'other-lot', amount: 80, status: 'pending' },
    { id: 'ai-peer-charge', syndicId: 'ai-peer', buildingId: 'ai-peer-building', residentId: 'peer-resident', apartmentId: 'lot-ai-peer-building', amount: 70, status: 'pending' },
  ],
  syndik_prod_proofs_v1: [
    { id: 'ai-proof', chargeId: 'ai-charge', syndicId: 'ai-cabinet', buildingId: 'ai-building', residentId: 'ai-resident', apartmentId: 'lot-ai-building', amount: 60, status: 'pending' },
    { id: 'ai-peer-proof', chargeId: 'ai-peer-charge', syndicId: 'ai-peer', buildingId: 'ai-peer-building', residentId: 'peer-resident', apartmentId: 'lot-ai-peer-building', amount: 70, status: 'pending' },
    { id: 'ai-approved-proof', chargeId: 'ai-charge', syndicId: 'ai-cabinet', buildingId: 'ai-building', residentId: 'ai-resident', apartmentId: 'lot-ai-building', amount: 60, status: 'approved' },
  ],
});
let directory: string, base: string, mock: Server;
let logs = '', calls: any[] = [], aborted = 0;
let mode: 'normal' | 'stall' | 'oversized' | 'failure' = 'normal';
const firestore = process.argv.includes('--firestore');
const deadlineMs = 1000; // Dedicated timeout workers; ordinary requests use the production default.
let repository: FirestoreRepository | undefined, firebase: App | undefined;
let fixture: string;
const children: ChildProcess[] = [];
const tokens = new Map<string, string>();
const stateFile = () => join(directory, 'shared-state.json');
const persisted = async (): Promise<any> => repository ? repository.transaction(async state => JSON.parse(JSON.stringify(state))) : JSON.parse(readFileSync(stateFile(), 'utf8'));
const change = async (run: (state: any) => void) => {
  if (repository) await repository.transaction(async state => { run(state); });
  else { const state = await persisted(); run(state); writeFileSync(stateFile(), JSON.stringify(state)); }
};
const reset = async () => { await change(state => { for (const k of Object.keys(state)) delete state[k]; Object.assign(state, seed()); }); calls = []; mode = 'normal'; };
async function api(route: string, uid?: string, body?: any, headers = {}, origin = base) {
  const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${tokens.get(uid)}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text(); let data: any; try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { status: response.status, headers: response.headers, data };
}
const announcement = (uid = 'ai-owner', extra = {}) => api('/api/ai/announcement', uid, { buildingId: 'ai-building', topic: 'Lift inspection', ...extra });
const proof = (uid = 'user-res-ai-resident', extra = {}) => api('/api/ai/verify-proof', uid, { chargeId: 'ai-charge', imageBase64: image, ...extra });

async function startApplication(timeoutMs = 20000) {
  const portServer = createServer(); await new Promise<void>(r => portServer.listen(0, '127.0.0.1', r));
  const port = (portServer.address() as any).port; await new Promise<void>(r => portServer.close(() => r()));
  const origin = `http://127.0.0.1:${port}`;
  const worker = spawn(process.execPath, ['--import', './tests/helpers/networkGuard.mjs', '--import', './tests/helpers/geminiStub.mjs', '--import', 'tsx', 'server.ts'], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), SYNDIK_STATE_BACKEND: firestore ? 'firestore' : 'file', SYNDIK_DATA_DIR: directory,
      GOOGLE_CLOUD_PROJECT: 'demo-buildmanage', FIRESTORE_DATABASE_ID: '(default)', GOOGLE_APPLICATION_CREDENTIALS: '',
      SYNDIK_AUTH_PROVIDER: 'legacy', SYNDIK_SERVER_SECRET: 'synthetic-ai-server-secret-123456789012345',
      GEMINI_API_KEY: 'synthetic-ai-key', API_KEY: '', AI_TEST_ENDPOINT: fixture, AI_PROCESSING_TIMEOUT_MS: String(timeoutMs), SENDGRID_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(worker); worker.stdout!.on('data', b => { logs += b; }); worker.stderr!.on('data', b => { logs += b; });
  for (let i = 0; i < 150; i++) {
    try { if ((await api('/api/health', undefined, undefined, {}, origin)).status === 200) return { worker, origin }; } catch {}
    if (worker.exitCode !== null) throw new Error(logs);
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('AI test server did not start');
}
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'buildmanage-ai-protection-'));
  writeFileSync(stateFile(), JSON.stringify(seed()));
  if (firestore) {
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:'), 'Use the local demo Firestore emulator only');
    firebase = initializeApp({ projectId: 'demo-buildmanage' }); repository = new FirestoreRepository('(default)');
  }
  await reset();
  mock = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const payload = JSON.parse(raw); calls.push(payload);
    if (mode === 'stall') { response.on('close', () => { if (!response.writableEnded) aborted++; });
      setTimeout(() => { if (!response.destroyed) response.end('{}'); }, deadlineMs + 2500).unref(); return; }
    if (mode === 'failure') { response.writeHead(503); response.end('{}'); return; }
    const text = mode === 'oversized' ? 'x'.repeat(100000) : JSON.stringify(payload).includes('inlineData')
      ? JSON.stringify({ extractedAmount: 100, extractedReference: 'AI-REF', extractedBank: 'Synthetic', confidence: 0.9 })
      : 'Inspection prévue samedi.';
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] }));
  });
  await new Promise<void>(r => mock.listen(0, '127.0.0.1', r));
  fixture = `http://127.0.0.1:${(mock.address() as any).port}`;
  ({ origin: base } = await startApplication());
  for (const p of profiles) { const result = await api('/api/auth/login', undefined, { identifier: p.email, password });
    assert.equal(result.status, 200, JSON.stringify(result)); tokens.set(p.uid, result.data.token); }
});
after(async () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) { const done = new Promise(r => child.once('exit', r)); child.kill(); await done; }
  if (mock) { mock.closeAllConnections(); await new Promise<void>(r => mock.close(() => r())); }
  if (directory) rmSync(directory, { recursive: true, force: true });
  if (firebase) await deleteApp(firebase);
});

test('announcement denies resident and provider capabilities before any model call', async () => {
  await reset(); const results = await Promise.all(['user-res-ai-resident', 'user-prest-ai-provider'].map(uid => announcement(uid)));
  assert.deepEqual(results.map(r => r.status), [403, 403]);
  assert.equal(calls.length, 0);
});
test('both AI endpoints require a valid authenticated session', async () => {
  await reset(); assert.equal((await api('/api/ai/announcement', undefined, { topic: 'Test' })).status, 401);
  assert.equal((await api('/api/ai/verify-proof', undefined, { imageBase64: image })).status, 401); assert.equal(calls.length, 0);
});
test('authorized syndic and admin can draft announcements for an active building', async () => {
  await reset(); for (const uid of ['ai-owner', 'ai-admin']) { const r = await announcement(uid); assert.equal(r.status, 200); assert.equal(r.data.content, 'Inspection prévue samedi.'); }
  assert.equal(calls.length, 2);
});
test('announcement rejects foreign, archived and missing building scopes', async () => {
  await reset(); assert.equal((await announcement('ai-peer-owner')).status, 403);
  assert.equal((await announcement('ai-owner', { buildingId: 'ai-archived' })).status, 409);
  assert.equal((await announcement('ai-owner', { buildingId: undefined })).status, 400); assert.equal(calls.length, 0);
});
test('expired and suspended subscriptions cannot spend AI resources, including admin requests', async () => {
  await reset(); for (const kind of ['expired', 'suspended']) for (const uid of [`ai-${kind}-owner`, 'ai-admin'])
    assert.equal((await announcement(uid, { buildingId: `ai-${kind}-building` })).status, 402);
  assert.equal(calls.length, 0);
});
test('resident OCR denies other buildings, lots, cabinets and inconsistent identifiers', async () => {
  await reset(); for (const extra of [{ chargeId: 'ai-other-charge' }, { chargeId: 'ai-other-lot-charge' }, { chargeId: 'ai-peer-charge' },
    { apartmentId: 'another-lot' }, { buildingId: 'ai-other-building' }, { proofId: 'ai-peer-proof' }]) {
    const r = await proof('user-res-ai-resident', extra); assert.ok([403, 404].includes(r.status), JSON.stringify(r));
  }
  assert.equal(calls.length, 0);
});
test('resident OCR uses stored outstanding amount and never approves or changes a ledger', async () => {
  await reset(); const before = await persisted(); const r = await proof('user-res-ai-resident', { expectedAmount: 9999, expectedBank: 'forged' });
  assert.equal(r.status, 200); assert.equal(r.data.verified, false);
  const sent = JSON.stringify(calls[0]); assert.match(sent, /100/); assert.doesNotMatch(sent, /9999|forged/);
  const after = await persisted();
  for (const key of Object.keys(before)) if (!['__revision', '__aiUsage_v1'].includes(key)) assert.deepEqual(after[key], before[key]);
});
test('manager OCR requires an authorized pending proof and rejects provider capability', async () => {
  await reset(); assert.equal((await proof('user-prest-ai-provider')).status, 403);
  assert.equal((await proof('ai-owner')).status, 400);
  assert.equal((await proof('ai-owner', { chargeId: undefined, proofId: 'ai-peer-proof' })).status, 403);
  assert.equal((await proof('ai-owner', { chargeId: undefined, proofId: 'ai-approved-proof' })).status, 409);
  const r = await proof('ai-owner', { chargeId: undefined, proofId: 'ai-proof', expectedAmount: 9999 });
  assert.equal(r.status, 200); assert.equal(r.data.verified, false); assert.match(JSON.stringify(calls[0]), /60/); assert.equal(calls.length, 1);
});
test('announcement rejects oversized JSON and topics before model work', async () => {
  await reset(); assert.equal((await announcement('ai-owner', { topic: 'x'.repeat(2001) })).status, 413);
  assert.equal((await announcement('ai-owner', { padding: 'x'.repeat(17 * 1024) })).status, 413); assert.equal(calls.length, 0);
});
test('OCR rejects oversized decoded images and raw JSON before model work', async () => {
  await reset(); const bytes = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024)]);
  assert.equal((await proof('user-res-ai-resident', { imageBase64: `data:image/png;base64,${bytes.toString('base64')}` })).status, 413);
  assert.equal((await proof('user-res-ai-resident', { padding: 'x'.repeat(3 * 1024 * 1024) })).status, 413); assert.equal(calls.length, 0);
});
test('OCR rejects malformed base64, mismatched magic bytes and unsupported formats', async () => {
  await reset(); for (const imageBase64 of ['%%%not-base64', 'data:image/png;base64,aGVsbG8=', 'data:text/html;base64,PGgxPg=='])
    assert.ok([400, 415].includes((await proof('user-res-ai-resident', { imageBase64 })).status));
  assert.equal(calls.length, 0);
});
test('stalled upstream requests abort at the configured deadline without locking other requests', { timeout: 12000 }, async () => {
  await reset(); const fast = await startApplication(deadlineMs);
  assert.equal((await api('/api/shared-state', 'ai-owner', undefined, {}, fast.origin)).status, 200);
  mode = 'stall'; const before = aborted, started = Date.now();
  const pending = api('/api/ai/announcement', 'ai-owner', { buildingId: 'ai-building', topic: 'Stalled call' }, {}, fast.origin);
  await new Promise(r => setTimeout(r, 150));
  const read = await api('/api/shared-state', 'ai-owner'); assert.equal(read.status, 200); assert.ok(Date.now() - started < 900);
  const result = await Promise.race([pending, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Missing AI deadline')), deadlineMs + 3000).unref())]);
  assert.equal(result.status, 504); assert.equal(result.data.code, 'AI_TIMEOUT'); assert.ok(Date.now() - started < deadlineMs + 1500);
  for (let i = 0; i < 20 && aborted === before; i++) await new Promise(r => setTimeout(r, 25));
  assert.ok(aborted > before, 'Upstream socket must be cancelled'); mode = 'normal';
});
test('provider response size is bounded before JSON parsing', async () => {
  await reset(); mode = 'oversized'; assert.equal((await announcement()).status, 502);
});
test('user burst quota spans both endpoints and returns retry metadata', async () => {
  await reset(); for (let i = 0; i < 5; i++) assert.equal((await announcement()).status, 200);
  const r = await proof('ai-owner', { chargeId: undefined, proofId: 'ai-proof' });
  assert.equal(r.status, 429); assert.equal(r.data.code, 'AI_RATE_LIMITED'); assert.ok(Number(r.headers.get('Retry-After')) > 0); assert.equal(calls.length, 5);
});
test('invalid and unauthorized requests do not consume valid processing capacity', async () => {
  await reset(); for (let i = 0; i < 6; i++) { assert.equal((await announcement('user-res-ai-resident')).status, 403); assert.equal((await announcement('ai-owner', { topic: '' })).status, 400); }
  assert.equal((await announcement()).status, 200); assert.equal(calls.length, 1);
});

test('oversized declared bodies are rejected before their body is read or parsed', async () => {
  await reset(); const started = Date.now();
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(base + '/api/ai/announcement', { method: 'POST', headers: {
      Authorization: `Bearer ${tokens.get('ai-owner')}`, 'Content-Type': 'application/json', 'Content-Length': String(17 * 1024),
    } }, response => { response.resume(); response.on('end', () => { clearTimeout(timer); resolve(response.statusCode!); req.destroy(); }); });
    const timer = setTimeout(() => { req.destroy(); resolve(0); }, 2500);
    req.on('error', error => { if ((error as any).code !== 'ECONNRESET') reject(error); }); req.write('{');
  });
  assert.equal(status, 413); assert.ok(Date.now() - started < 1200); assert.equal(calls.length, 0);
});
test('OCR applies subscription and current lot assignment guards', async () => {
  await reset(); await change(state => { state.syndik_prod_syndics_v1[0].subscriptionStatus = 'past_due'; });
  assert.equal((await proof()).status, 402);
  await reset(); await change(state => { state.syndik_prod_syndics_v1[0].buildings[0].apartments[0].ownerId = 'other-person'; });
  assert.equal((await proof()).status, 403); assert.equal(calls.length, 0);
});
test('persisted user hourly and daily limits survive expired burst windows', async () => {
  for (const [count, age] of [[20, 120000], [100, 2 * 3600000]]) {
    await reset(); await change(state => { state.__aiUsage_v1 = { 'user:ai-owner': Array(count).fill(Date.now() - age) }; });
    const r = await announcement(); assert.equal(r.status, 429); assert.ok(Number(r.headers.get('Retry-After')) > 0);
    assert.equal(calls.length, 0);
  }
});
test('persisted cabinet minute, hourly and daily limits constrain all its users', async () => {
  for (const [count, age] of [[20, 1000], [100, 120000], [500, 2 * 3600000]]) {
    await reset(); await change(state => { state.__aiUsage_v1 = { 'cabinet:ai-cabinet': Array(count).fill(Date.now() - age) }; });
    assert.equal((await announcement('ai-admin')).status, 429); assert.equal(calls.length, 0);
  }
  await reset(); await change(state => { state.__aiUsage_v1 = { 'cabinet:ai-cabinet': Array(19).fill(Date.now()) }; });
  assert.equal((await announcement('ai-owner')).status, 200);
  assert.equal((await announcement('ai-admin')).status, 429);
  assert.equal(calls.length, 1);
});
test('expired windows and other cabinets do not leak quota, and usage stays private', async () => {
  await reset(); await change(state => { state.__aiUsage_v1 = { 'user:ai-owner': Array(100).fill(Date.now() - 86401000),
    'cabinet:ai-peer': Array(500).fill(Date.now()) }; });
  assert.equal((await announcement()).status, 200);
  const r = await api('/api/shared-state', 'ai-owner'); assert.equal(r.data.store.__aiUsage_v1, undefined);
  const state = await persisted(); assert.equal(state.__aiUsage_v1['user:ai-owner'].length, 1);
});
test('concurrent requests across instances atomically share quotas, including after a restart', { timeout: 45000 }, async () => {
  await reset(); const peer = await startApplication();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => api('/api/ai/announcement', 'ai-owner',
    { buildingId: 'ai-building', topic: 'Concurrent protected request' }, {}, i % 2 ? base : peer.origin)));
  const detail = JSON.stringify(results.map(r => ({ status: r.status, code: r.data.code })));
  assert.equal(results.filter(r => r.status === 200).length, 5, detail); assert.equal(results.filter(r => r.status === 429).length, 3, detail);
  const done = new Promise(r => peer.worker.once('exit', r)); peer.worker.kill(); await done;
  const restarted = await startApplication();
  assert.equal((await api('/api/ai/announcement', 'ai-owner', { buildingId: 'ai-building', topic: 'After restart' }, {}, restarted.origin)).status, 429);
  assert.equal(calls.length, 5);
});
test('accepted provider failures still consume quota', async () => {
  await reset(); mode = 'failure'; for (let i = 0; i < 5; i++) assert.equal((await announcement()).status, 502);
  mode = 'normal'; assert.equal((await announcement()).status, 429); assert.equal(calls.length, 5);
});

test('slow request bodies receive a bounded JSON timeout before authentication or processing', async () => {
  await reset(); const fast = await startApplication(deadlineMs);
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(fast.origin + '/api/ai/announcement', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Content-Length': '100', Authorization: `Bearer ${tokens.get('ai-owner')}`,
    } }, response => { response.resume(); response.on('end', () => { clearTimeout(timer); resolve(response.statusCode!); req.destroy(); }); });
    const timer = setTimeout(() => { req.destroy(); resolve(0); }, deadlineMs + 2500);
    req.on('error', e => { if ((e as any).code !== 'ECONNRESET') reject(e); }); req.write('{');
  });
  assert.equal(status, 408); assert.equal(calls.length, 0);
});
test('compressed JSON and non-JSON content types are rejected before parsing', async () => {
  await reset();
  for (const [headers, body] of [
    [{ 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, gzipSync(JSON.stringify({ topic: 'Test', buildingId: 'ai-building' }))],
    [{ 'Content-Type': 'text/plain' }, Buffer.from('not JSON')],
  ] as const) {
    const response = await fetch(base + '/api/ai/announcement', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${tokens.get('ai-owner')}` }, body });
    assert.equal(response.status, 415); assert.equal((await response.json()).ok, false);
  }
  assert.equal(calls.length, 0);
});
test('unverified accounts and required password changes cannot consume AI resources', async () => {
  for (const updates of [{ emailVerified: false }, { mustChangePassword: true }]) {
    await reset(); await change(state => Object.assign(state.syndik_prod_registered_users_v1[0].profile, updates));
    assert.equal((await announcement()).status, 403); assert.equal(calls.length, 0);
  }
  await reset(); await change(state => {
    const profile = state.syndik_prod_registered_users_v1.find((u: any) => u.uid === 'user-res-ai-resident').profile;
    state.syndik_prod_registered_users_v1 = state.syndik_prod_registered_users_v1.filter((u: any) => u.uid !== profile.uid);
    state.syndik_prod_resident_accounts_v1 = [{ residentId: 'ai-resident', email: profile.email,
      buildingId: 'ai-building', syndicId: 'ai-cabinet', mustChangePassword: false, profile: { ...profile, emailVerified: false } }];
  });
  assert.equal((await proof()).status, 403); assert.equal(calls.length, 0);
});

test('unavailable quota storage fails closed with its database error before any provider call', async () => {
  await reset(); let handler: any;
  const failure = new DependencyError('database', 'unavailable', new Error('private SDK details'));
  registerAiEndpoints({ post: (route, run) => { if (route === '/api/ai/announcement') handler = run; } },
    { transaction: async () => { throw failure; } }, async () => { throw new Error('Authentication must not run without storage'); });
  const response = Object.assign(new EventEmitter(), { destroyed: false });
  await assert.rejects(handler({ body: { buildingId: 'ai-building', topic: 'Test' } }, response, () => {}), (error: any) => {
    assert.equal(error.status, 503); assert.equal(error.code, 'DATABASE_UNAVAILABLE');
    assert.doesNotMatch(error.message, /private SDK details/); return true;
  });
  assert.equal(calls.length, 0);
});
