import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { createHmac } from 'node:crypto';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FirestoreRepository } from '../server/repository';
import { hashPassword } from '../server/passwords';
import { identityTransaction, queueFirebaseMutation } from '../server/identityMutations';

assert.ok(process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:'), 'Requires local Firestore');
assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:'), 'Requires local Auth');
process.env.GOOGLE_CLOUD_PROJECT ||= 'demo-buildmanage';
assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'demo-buildmanage');
const app = initializeApp({ projectId: 'demo-buildmanage' });
const auth = getAuth(app), repo = new FirestoreRepository('(default)');
const directory = mkdtempSync(join(tmpdir(), 'auth-concurrency-'));
const probe = join(directory, 'probe.json'), traceFile = probe + '.trace';
writeFileSync(probe, '{}'); writeFileSync(traceFile, '');
const listener = createServer();
await new Promise<void>(r => listener.listen(0, '127.0.0.1', r));
const port = (listener.address() as any).port;
await new Promise<void>(r => listener.close(() => r()));
const args = ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx',
  '--import', './tests/helpers/authConcurrencyProbe.ts', 'server.ts'];
const serverEnv = { ...process.env, NODE_ENV: 'test', SYNDIK_AUTH_PROVIDER: 'firebase', PORT: String(port),
    SYNDIK_STATE_BACKEND: 'firestore', FIRESTORE_DATABASE_ID: '(default)', FIREBASE_API_KEY: 'demo-key',
    PUBLIC_APP_URL: `http://localhost:${port}`, SYNDIK_DATA_DIR: directory,
    AUTH_CONCURRENCY_PROBE: probe, SYNDIK_SERVER_SECRET: 'synthetic-concurrency-secret-123456789012345',
    SYNDIK_SCHEDULER_SECRET: 'synthetic-scheduler-secret-123456789012345', SENDGRID_API_KEY: '', SENDGRID_FROM_EMAIL: '' };
let logs = '';
function start(portOverride = port) {
  const child = spawn(process.execPath, args, { env: { ...serverEnv, PORT: String(portOverride) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; }); return child;
}
let child = start();
const password = 'Original-Test-Password-42!', replacement = 'Replacement-Test-Password-43!';
const api = async (path: string, body?: any, token?: string) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  return { status: response.status, data: await response.json() };
};
const events = () => readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const arm = (fault: any = {}) => { writeFileSync(probe, JSON.stringify(fault)); writeFileSync(traceFile, ''); };
let sequence = 0;
async function fixture(linked = true) {
  const uid = 'c5-' + (++sequence), email = `${uid}@example.test`, residentId = uid + '-resident';
  if (linked) await auth.createUser({ uid, email, password, emailVerified: true });
  const profile = { uid, email, role: 'syndic', syndicId: uid + '-cabinet', emailVerified: true, displayName: uid };
  const account = { uid, email, profile, ...(linked ? { firebaseUid: uid } : { passwordHash: hashPassword(password) }) };
  await repo.transaction(async state => {
    (state.syndik_prod_registered_users_v1 ??= []).push(account);
    (state.syndik_prod_syndics_v1 ??= []).push({ id: profile.syndicId, createdBy: uid, name: uid,
      subscriptionStatus: 'active', subscriptionPlan: 'starter', subscriptionExpiry: '2099-01-01', buildings: [] });
  });
  const login = linked ? await api('/api/auth/login', { identifier: email, password }) : undefined;
  if (login) assert.equal(login.status, 200, JSON.stringify(login));
  return { uid, email, profile, token: login?.data.token, residentId };
}
async function accepts(email: string, candidate: string) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: candidate, returnSecureToken: true }) });
  return response.ok;
}
const intents = () => repo.transaction(async s => structuredClone(Object.values(s.__firebaseMutations_v1 || {})) as any[]);
let passed = 0, failed = 0;
async function test(name: string, run: () => Promise<void>) {
  try { arm(); await run(); passed++; console.log('PASS: ' + name); }
  catch (error) { failed++; console.error('FAIL: ' + name + '\n' + String(error)); }
  finally { arm(); }
}
try {
  for (let i = 0; i < 200; i++) {
    try { if ((await api('/api/health')).status === 200) break; } catch {}
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise(r => setTimeout(r, 100));
  }
  await repo.transaction(async state => { for (const key of Object.keys(state)) delete state[key]; });
  await test('password mutation executes once despite a real Firestore commit retry', async () => {
    const f = await fixture(); arm({ commitFailure: 'retry' });
    const response = await api('/api/auth/change-password', { newPassword: replacement }, f.token);
    assert.equal(response.status, 200, JSON.stringify(response));
    assert.equal(events().filter(e => e.kind === 'commit-retry').length, 1);
    assert.equal(events().filter(e => e.kind === 'updateUser').length, 1);
    assert.equal(events().filter(e => e.kind === 'revokeRefreshTokens').length, 1);
    assert.ok(await accepts(f.email, replacement));
  });
  await test('an aborted intent commit never modifies Firebase credentials', async () => {
    const f = await fixture(); arm({ commitFailure: 'abort' });
    assert.ok((await api('/api/auth/change-password', { newPassword: replacement }, f.token)).status >= 400);
    assert.equal(events().filter(e => ['updateUser', 'revokeRefreshTokens'].includes(e.kind)).length, 0);
    assert.ok(await accepts(f.email, password)); assert.equal(await accepts(f.email, replacement), false);
  });
  await test('all credential effects run strictly outside repository transaction context', async () => {
    const f = await fixture(); arm();
    assert.equal((await api('/api/auth/change-password', { newPassword: replacement }, f.token)).status, 200);
    const effects = events().filter(e => ['updateUser', 'revokeRefreshTokens'].includes(e.kind));
    assert.equal(effects.length, 2); assert.ok(effects.every(e => !e.inTransaction), JSON.stringify(effects));
  });
  await test('successful password mutation has a finalized encrypted durable intent', async () => {
    const f = await fixture(); arm();
    assert.equal((await api('/api/auth/change-password', { newPassword: replacement }, f.token)).status, 200);
    const rows = (await intents()).filter(i => i.targets?.includes(f.uid));
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'finalized');
    assert.ok(rows[0].operationId && rows[0].createdAt && rows[0].finalizedAt && rows[0].scope);
    assert.ok(!JSON.stringify(rows).includes(replacement));
  });
  await test('partial Firebase failure remains pending and matching retry resumes without resetting twice', async () => {
    const f = await fixture(); arm({ authFailure: 'revokeRefreshTokens' });
    const first = await api('/api/auth/change-password', { newPassword: replacement }, f.token);
    assert.ok(first.status >= 400);
    assert.equal((await api('/api/auth/session', undefined, f.token)).status, 409);
    const retry = await api('/api/auth/change-password', { newPassword: replacement }, f.token);
    assert.equal(retry.status, 200, JSON.stringify(retry));
    assert.equal(events().filter(e => e.kind === 'updateUser').length, 1);
    assert.ok((await intents()).some(i => i.targets?.includes(f.uid) && i.status === 'finalized'));
  });
  await test('logout revocation executes once after the session invalidation commits', async () => {
    const f = await fixture(); arm({ commitFailure: 'retry' });
    assert.equal((await api('/api/auth/logout', {}, f.token)).status, 200);
    assert.equal(events().filter(e => e.kind === 'revokeRefreshTokens').length, 1);
    assert.ok(events().filter(e => e.kind === 'revokeRefreshTokens').every(e => !e.inTransaction));
  });
  await test('legacy migration creates the external account once, after commit, preserving UID', async () => {
    const f = await fixture(false); arm({ commitFailure: 'retry' });
    const response = await api('/api/auth/login', { identifier: f.email, password });
    assert.equal(response.status, 200, JSON.stringify(response)); assert.equal(response.data.profile.uid, f.uid);
    const calls = events().filter(e => e.kind === 'createUser'); assert.equal(calls.length, 1); assert.equal(calls[0].inTransaction, false);
    assert.ok((await intents()).some(i => i.targets?.includes(f.uid) && i.status === 'finalized'));
  });
  await test('aborted registration commit creates no orphan Firebase account', async () => {
    const email = 'c5-aborted-registration@example.test'; arm({ commitFailure: 'abort' });
    const response = await api('/api/auth/register', { email, password, profile: { role: 'syndic' }, syndic: { name: 'Synthetic cabinet' } });
    assert.ok(response.status >= 400);
    await assert.rejects(auth.getUserByEmail(email), (e: any) => e.code === 'auth/user-not-found');
  });
  await test('pending intent blocks a Firebase-token session and competing password change', async () => {
    const f = await fixture(); arm({ authFailure: 'revokeRefreshTokens' });
    assert.equal((await api('/api/auth/change-password', { newPassword: replacement }, f.token)).status, 503);
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email, password: replacement, returnSecureToken: true }) });
    const credential = await response.json(); assert.ok(credential.idToken);
    assert.equal((await api('/api/auth/firebase-session', {}, credential.idToken)).status, 409);
    assert.equal((await api('/api/auth/change-password', { newPassword: 'Competing-Password-44!' }, f.token)).status, 409);
    assert.equal(events().filter(e => e.kind === 'updateUser').length, 1);
    assert.equal((await api('/api/auth/change-password', { newPassword: replacement }, f.token)).status, 200);
  });
  await test('credential regeneration commits a canonical intent and retries the same secret', async () => {
    const f = await fixture(); const uid = `user-res-${f.residentId}`, email = `${uid}@example.test`;
    await auth.createUser({ uid, email, password, emailVerified: true });
    await repo.transaction(async s => {
      s.syndik_prod_syndics_v1.find((x: any) => x.id === f.profile.syndicId).buildings = [{
        id: f.uid + '-building', syndicId: f.profile.syndicId, name: 'Building', monthlySyndicFees: 100,
        apartments: [{ id: f.uid + '-lot', number: '1', ownerId: f.residentId, tantiemes: 1000 }],
        residents: [{ id: f.residentId, name: 'Resident', email, phone: '0600000000', cin: f.uid, isOwner: true,
          syndicId: f.profile.syndicId, buildingId: f.uid + '-building', apartmentId: f.uid + '-lot', hasAccount: true }],
        documents: [], financials: { balance: 0, transactions: [] } }];
      (s.syndik_prod_registered_users_v1 ??= []).push({ uid, email, firebaseUid: uid,
        profile: { uid, email, role: 'resident', syndicId: f.profile.syndicId, buildingId: f.uid + '-building', residentId: f.residentId, emailVerified: true } });
      (s.syndik_prod_resident_accounts_v1 ??= []).push({ residentId: f.residentId, email, firebaseUid: uid,
        syndicId: f.profile.syndicId, buildingId: f.uid + '-building', mustChangePassword: false });
    });
    const command = { operation: 'regenerateResidentCredentials', args: [f.residentId], operationId: 'c5-regenerate-resident-00001' };
    arm({ commitFailure: 'retry', authFailure: 'revokeRefreshTokens' });
    assert.equal((await api('/api/commands', command, f.token)).status, 503);
    // A renewed manager token may resume, but must not return the Phase A receipt
    // as success before its pending Firebase credential has been applied.
    const fresh = await api('/api/auth/login', { identifier: f.email, password }); assert.equal(fresh.status, 200);
    const result = await api('/api/commands', command, fresh.data.token); assert.equal(result.status, 200, JSON.stringify(result));
    const secret = result.data.result.invitationCode || result.data.result.invitationToken;
    assert.ok(secret && await accepts(email, secret));
    assert.equal(events().filter(e => e.kind === 'updateUser').length, 1);
    const retry = await api('/api/commands', command, fresh.data.token);
    assert.equal(retry.status, 200); assert.deepEqual(retry.data.result, result.data.result);
    assert.ok((await intents()).some(i => i.targets?.includes(uid) && i.status === 'finalized'));
  });
  await test('an uncertain step checkpoint resumes safely and cannot replay over a newer credential', async () => {
    const f = await fixture(); arm({ failCheckpointAfter: 'revokeRefreshTokens' });
    assert.equal((await api('/api/auth/change-password', { newPassword: replacement }, f.token)).status, 503);
    const rows = (await intents()).filter(i => i.targets?.includes(f.uid)); assert.equal(rows.length, 1);
    const operationId = rows[0].operationId;
    const retry = await api('/api/auth/change-password', { newPassword: replacement }, f.token);
    assert.equal(retry.status, 200, JSON.stringify(retry));
    assert.equal(events().filter(e => e.kind === 'updateUser').length, 1);
    assert.equal(events().filter(e => e.kind === 'revokeRefreshTokens').length, 2, 'Only the uncertain revoke may repeat');
    const newer = 'Newest-Password-45!';
    assert.equal((await api('/api/auth/change-password', { newPassword: newer }, retry.data.token)).status, 200);
    assert.ok(await accepts(f.email, newer));
    assert.ok((await intents()).some(i => i.operationId === operationId && i.status === 'finalized'));
    const job = await fetch(`http://127.0.0.1:${port}/api/jobs/outbox`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Syndik-Scheduler': serverEnv.SYNDIK_SCHEDULER_SECRET }, body: '{}' });
    assert.equal(job.status, 200); assert.ok(await accepts(f.email, newer));
  });
  await test('a restart resumes persisted intent through the existing protected outbox scheduler', async () => {
    const f = await fixture(); arm({ authFailure: 'revokeRefreshTokens' });
    assert.equal((await api('/api/auth/change-password', { newPassword: replacement }, f.token)).status, 503);
    child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); child = start();
    for (let n = 0; n < 100; n++) { try { if ((await api('/api/health')).status === 200) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
    assert.equal((await api('/api/jobs/outbox', {})).status, 403);
    const job = await fetch(`http://127.0.0.1:${port}/api/jobs/outbox`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Syndik-Scheduler': serverEnv.SYNDIK_SCHEDULER_SECRET }, body: '{}' });
    assert.equal(job.status, 200); assert.ok(await accepts(f.email, replacement));
    assert.equal(events().filter(e => e.kind === 'updateUser').length, 1);
    assert.ok((await intents()).some(i => i.targets?.includes(f.uid) && i.status === 'finalized'));
    assert.equal((await api('/api/auth/login', { identifier: f.email, password: replacement })).status, 200);
  });
  await test('two server instances share one intent and one Firebase credential execution', async () => {
    const f = await fixture(); const socket = createServer();
    await new Promise<void>(r => socket.listen(0, '127.0.0.1', r)); const secondPort = (socket.address() as any).port;
    await new Promise<void>(r => socket.close(() => r())); const second = start(secondPort);
    try {
      for (let n = 0; n < 100; n++) { try { if ((await fetch(`http://127.0.0.1:${secondPort}/api/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
      arm({ delay: true }); const body = { newPassword: replacement };
      const results = await Promise.all([api('/api/auth/change-password', body, f.token),
        fetch(`http://127.0.0.1:${secondPort}/api/auth/change-password`, { method: 'POST', headers: {
          'Content-Type': 'application/json', Authorization: `Bearer ${f.token}` }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, data: await r.json() }))]);
      assert.ok(results.some(r => r.status === 200), JSON.stringify(results));
      assert.ok(results.every(r => [200, 409].includes(r.status)), JSON.stringify(results));
      assert.equal(events().filter(e => e.kind === 'updateUser').length, 1);
      assert.equal((await intents()).filter(i => i.targets?.includes(f.uid)).length, 1);
    } finally { second.kill('SIGTERM'); await new Promise(r => second.once('exit', r)); }
  });
  await test('late application validation rollback dispatches no planned external effects', async () => {
    const f = await fixture(); let effects = 0;
    await assert.rejects(identityTransaction(repo, 'synthetic-late-validation', async s => {
      queueFirebaseMutation(s, { kind: 'password', target: f.uid, firebaseUid: f.uid, email: f.email, password: replacement });
      s.__lateValidation = { shouldRollback: true };
      throw new Error('Late business validation failed');
    }, async () => { effects++; }, () => {}, async () => {}), /Late business validation/);
    assert.equal(effects, 0); assert.ok(await accepts(f.email, password));
    await repo.transaction(async s => assert.equal(s.__lateValidation, undefined));
    assert.equal((await intents()).filter(i => i.targets?.includes(f.uid)).length, 0);
  });
  await test('private intents and encrypted credential arguments never enter shared-state responses or logs', async () => {
    const f = await fixture(); arm();
    assert.equal((await api('/api/auth/change-password', { newPassword: replacement }, f.token)).status, 200);
    const login = await api('/api/auth/login', { identifier: f.email, password: replacement });
    const response = await api('/api/shared-state', undefined, login.data.token); assert.equal(response.status, 200);
    assert.ok(!JSON.stringify(response.data).includes('__firebaseMutations_v1'));
    assert.ok(!JSON.stringify(response.data).includes('encryptedPlan'));
    assert.ok(!logs.includes(password) && !logs.includes(replacement));
  });
  await test('an expired original bearer cannot resume an intent to obtain a new session', async () => {
    const f = await fixture(); arm({ authFailure: 'revokeRefreshTokens' });
    const parts = f.token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    claims.exp = Date.now() + 3000;
    const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = createHmac('sha256', serverEnv.SYNDIK_SERVER_SECRET).update(encoded).digest('hex');
    const shortToken = `syndik-srv1.${encoded}.${signature}`;
    assert.equal((await api('/api/auth/change-password', { newPassword: replacement }, shortToken)).status, 503);
    const calls = events().filter(e => e.kind === 'revokeRefreshTokens').length;
    await new Promise(r => setTimeout(r, Math.max(0, claims.exp - Date.now()) + 30));
    assert.equal((await api('/api/auth/change-password', { newPassword: replacement }, shortToken)).status, 401);
    assert.equal(events().filter(e => e.kind === 'revokeRefreshTokens').length, calls);
    writeFileSync(probe, '{}');
    const job = await fetch(`http://127.0.0.1:${port}/api/jobs/outbox`, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'X-Syndik-Scheduler': serverEnv.SYNDIK_SCHEDULER_SECRET }, body: '{}' });
    assert.equal(job.status, 200); assert.ok((await intents()).some(i => i.targets?.includes(f.uid) && i.status === 'finalized'));
  });
} finally {
  child.kill('SIGTERM'); await new Promise(r => child.once('exit', r));
  await deleteApp(app); rmSync(directory, { recursive: true, force: true });
}
console.log(`C5 auth concurrency: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
