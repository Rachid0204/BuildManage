import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { hashPasswordSync, computeSessionSignature } from '../utils/security';

const root = resolve(import.meta.dirname, '..');
const dataDir = mkdtempSync(join(tmpdir(), 'buildmanage-boundaries-'));
const password = 'Synthetic-Test-Password-42!';
const owner = { uid: 'owner-a', email: 'owner@audit.invalid', displayName: 'Owner', role: 'syndic' as const, syndicId: 's-a', buildingId: 'b-a' };
const unverifiedOwner = { uid: 'owner-unv', email: 'unverified@audit.invalid', displayName: 'Unverified', role: 'syndic' as const, syndicId: 's-unv', buildingId: 'b-unv', emailVerified: false };
const admin = { uid: 'admin-fixture', email: 'admin@audit.invalid', displayName: 'Admin', role: 'admin' as const };
const resident = (id: string, email: string) => ({ id, name: id, email, isOwner: true, hasAccount: true, mustChangePassword: false });
const record = (profile: typeof owner | typeof unverifiedOwner | typeof admin) => ({ uid: profile.uid, email: profile.email, passwordHash: hashPasswordSync(password, profile.email), profile });
const state = {
  syndik_prod_registered_users_v1: [record(owner), record(unverifiedOwner), record(admin)],
  syndik_prod_syndics_v1: [
    { id: 's-a', createdBy: owner.uid, subscriptionPlan: 'starter', subscriptionStatus: 'trialing', subscriptionExpiry: '2099-01-01', buildings: [
      { id: 'b-a', syndicId: 's-a', residents: [resident('r-a', 'a@audit.invalid')], apartments: [{ id: 'lot-a', number: '1', ownerId: 'r-a', tantiemes: 1000 }] },
    ] },
    { id: 's-unv', createdBy: unverifiedOwner.uid, subscriptionPlan: 'starter', subscriptionStatus: 'trialing', subscriptionExpiry: '2099-01-01', buildings: [
      { id: 'b-unv', syndicId: 's-unv', residents: [], apartments: [] },
    ] },
    { id: 's-b', createdBy: 'owner-b', buildings: [{ id: 'b-b', residents: [resident('r-b', 'b@audit.invalid')], apartments: [] }] },
  ],
  syndik_prod_resident_accounts_v1: [
    { residentId: 'r-a', email: 'a@audit.invalid', syndicId: 's-a', buildingId: 'b-a', passwordHash: hashPasswordSync(password, 'a@audit.invalid'), mustChangePassword: false },
    { residentId: 'r-b', email: 'b@audit.invalid', syndicId: 's-b', buildingId: 'b-b', passwordHash: hashPasswordSync(password, 'b@audit.invalid'), mustChangePassword: false },
  ],
  syndik_prod_charges_v1: [{ id: 'c-a', buildingId: 'b-a', syndicId: 's-a', residentId: 'r-a', amount: 100, paidAmount: 0, status: 'unpaid' },
    { id: 'c-b', buildingId: 'b-b', syndicId: 's-b', residentId: 'r-b', amount: 100, status: 'unpaid' }],
  syndik_prod_ag_v1: [{ id: 'ag-a', syndicId: 's-a', buildingId: 'b-a', status: 'in_progress', isVotingOpen: true, votingOpenedAt: '2026-01-01T00:00:00.000Z',
    totalTantiemes: 1000, quorumRequired: 500, attendees: [{ residentId: 'r-a', apartmentNumber: '1', status: 'present' }],
    resolutions: [{ id: 'resolution', majorityType: 'simple_24', votesFor: 0, votesAgainst: 0, votesAbstain: 0, status: 'pending', voterChoices: [] }] }],
  syndik_prod_chat_v1: [{ id: 'msg-a', syndicId: 's-a', buildingId: 'b-a', channelId: 'general', senderId: 'r-a', senderName: 'r-a', text: 'Private copropriete chat', createdAt: '2026-01-01T00:00:00.000Z' }],
};
writeFileSync(join(dataDir, 'shared-state.json'), JSON.stringify(state));
const port = await new Promise<number>((resolvePort) => { const server = createServer(); server.listen(0, '127.0.0.1', () => {
  const address = server.address(); const value = typeof address === 'object' && address ? address.port : 0;
  server.close(() => resolvePort(value));
}); });
const child = spawn(process.execPath, ['--import', join(root, 'tests/helpers/networkGuard.mjs'), '--import', 'tsx', 'server.ts'], {
  cwd: root, env: { ...process.env, PORT: String(port), NODE_ENV: 'test', SYNDIK_STATE_BACKEND: 'file', SYNDIK_DATA_DIR: dataDir,
    SYNDIK_SERVER_SECRET: 'synthetic-server-secret-12345678901234567890', FIREBASE_SERVICE_ACCOUNT_JSON: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stderr.on('data', (d) => { logs += d; });
const timeout = setTimeout(() => child.kill(), 30_000);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const call = async (route: string, headers: Record<string, string> = {}, body?: unknown) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const text = await response.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
};
try {
  await new Promise<void>((ready, reject) => {
    child.stdout.on('data', (d) => { logs += d; if (String(d).includes('Server running')) ready(); });
    child.on('error', reject); child.on('exit', (code) => reject(new Error(`Server exited: ${code}\n${logs}`)));
  });
  assert.equal((await call('/api/shared-state')).status, 401);
  const clientSignature = { ...bearer(`syndik-sess-${admin.uid}-${computeSessionSignature(admin)}`),
    'X-Syndik-Uid': admin.uid, 'X-Syndik-Role': 'admin' };
  assert.equal((await call('/api/shared-state', clientSignature)).status, 401);
  const jwt = [Buffer.from('{"alg":"none"}').toString('base64url'), Buffer.from('{"sub":"admin-fixture","role":"admin"}').toString('base64url'), 'unsigned-signature'].join('.');
  assert.equal((await call('/api/shared-state', bearer(jwt))).status, 401);
  const login = async (email: string) => {
    const result = await call('/api/auth/login', {}, { identifier: email, password }); assert.equal(result.status, 200); assert.ok(result.data.token);
    return bearer(result.data.token);
  };
  const ownerHeaders = await login(owner.email); const residentHeaders = await login('a@audit.invalid');
  assert.equal((await call('/api/auth/register', {}, { email: 'intruder@audit.invalid', password,
    profile: { role: 'syndic', syndicId: 's-b', buildingId: 'b-b' } })).status, 403);
  assert.equal((await call('/api/auth/register', {}, { email: 'intruder2@audit.invalid', password,
    profile: { role: 'resident', residentId: 'r-b', syndicId: 's-b', buildingId: 'b-b' } })).status, 403);
  const registered = await call('/api/auth/register', {}, { uid: admin.uid, email: 'new@audit.invalid', password,
    profile: { role: 'syndic', displayName: 'New owner' }, syndic: { name: 'New cabinet', subscriptionPlan: 'professional',
      initialBuilding: { name: 'New building', apartmentsCount: 8, monthlyFees: 250 } } });
  assert.equal(registered.status, 200); assert.notEqual(registered.data.profile.uid, admin.uid);
  assert.notEqual(registered.data.profile.syndicId, 's-b'); assert.equal(registered.data.syndic.createdBy, registered.data.profile.uid);
  assert.equal(registered.data.syndic.subscriptionStatus, 'trialing'); assert.equal(registered.data.syndic.buildings[0].apartments.length, 8);
  assert.equal(registered.data.syndic.buildings[0].apartments.reduce((sum: number, a: any) => sum + a.tantiemes, 0), 1000);
  const scope = await call('/api/shared-state', residentHeaders);
  assert.deepEqual(scope.data.store.syndik_prod_syndics_v1.map((s: any) => s.id), ['s-a']);
  assert.deepEqual(scope.data.store.syndik_prod_charges_v1.map((c: any) => c.id), ['c-a']);
  assert.equal((await call('/api/auth/change-password', residentHeaders, { email: 'b@audit.invalid', residentId: 'r-b', newPassword: 'Forbidden-Change-42!' })).status, 403);
  assert.equal((await call('/api/shared-state', residentHeaders, { key: 'syndik_prod_ag_v1', value: state.syndik_prod_ag_v1 })).status, 403);
  assert.equal((await call('/api/shared-state', residentHeaders, { key: 'syndik_prod_charges_v1', value: [{ id: 'c-b', buildingId: 'b-b', amount: 999 }] })).status, 403);
  assert.equal((await call('/api/shared-state', residentHeaders, { key: 'syndik_prod_proofs_v1', value: [{ id: 'proof', chargeId: 'c-a', buildingId: 'b-a', residentId: 'r-a', amount: 100, status: 'approved' }] })).status, 403);
  const vote = await call('/api/ag/vote', residentHeaders, { agId: 'ag-a', resolutionId: 'resolution', residentId: 'r-a', choice: 'for', tantiemes: 99999 });
  assert.equal(vote.status, 200); assert.equal(vote.data.ag.resolutions[0].votesFor, 1000);
  const repeated = await call('/api/ag/vote', residentHeaders, { agId: 'ag-a', resolutionId: 'resolution', choice: 'against' });
  assert.equal(repeated.status, 200); assert.equal(repeated.data.ag.resolutions[0].votesFor, 0); assert.equal(repeated.data.ag.resolutions[0].votesAgainst, 1000);
  assert.equal(repeated.data.ag.resolutions[0].voterChoices.length, 1);
  assert.equal((await call('/api/ag/vote', residentHeaders, { agId: 'ag-a', resolutionId: 'resolution', residentId: 'r-b', choice: 'for' })).status, 403);
  const escalation = { uid: 'promote-fixture', email: 'promote@audit.invalid', role: 'resident',
    passwordHash: hashPasswordSync(password, 'promote@audit.invalid'), profile: { uid: 'promote-fixture', role: 'admin', syndicId: 's-a', buildingId: 'b-a' } };
  assert.equal((await call('/api/shared-state', ownerHeaders, { key: 'syndik_prod_registered_users_v1', value: [escalation] })).status, 403);
  const entitlement = structuredClone(state.syndik_prod_syndics_v1[0]); entitlement.subscriptionStatus = 'active';
  assert.equal((await call('/api/shared-state', ownerHeaders, { key: 'syndik_prod_syndics_v1', value: [entitlement] })).status, 403);
  const upload = await call('/api/uploads', residentHeaders, { name: 'fixture.pdf', buildingId: 'b-a', dataUrl: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nPRIVATE-FIXTURE').toString('base64') });
  assert.equal(upload.status, 200); assert.equal((await call(upload.data.url)).status, 401);
  assert.equal((await call(upload.data.url, residentHeaders)).data, '%PDF-1.4\nPRIVATE-FIXTURE');
  assert.equal((await call(upload.data.url, await login('b@audit.invalid'))).status, 403);
  // Exercise the actual client against HTTP, dropping a committed response and simulating a reload.
  const nativeFetch = globalThis.fetch;
  const memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => { memory.set(k, v); }, removeItem: (k: string) => { memory.delete(k); } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  const client = await import('../firebase/services');
  const { setActiveAuthContext } = await import('../utils/security');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage, sessionStorage: storage, dispatchEvent: () => true } });
  setActiveAuthContext(owner, ownerHeaders.Authorization.slice(7));
  let commandPosts = 0, statusReads = 0, operationId = '';
  const interruptedArgs: import('../shared/api/commands').CommandArgs<'addAnnouncement'> = ['b-a', { title: 'Reload-safe announcement', content: 'Synthetic confidential text must not enter recovery storage.' }];
  try {
    globalThis.fetch = (async (url: any, init: any) => {
      if (url === '/api/commands') { commandPosts++; operationId = JSON.parse(init.body).operationId; }
      if (url === '/api/operations/status') statusReads++;
      const response = await nativeFetch(new URL(url, `http://127.0.0.1:${port}`), init);
      if (url === '/api/commands' && commandPosts === 1) {
        assert.equal(response.status, 200, await response.clone().text());
        await response.text();
        throw new TypeError('Synthetic connection lost after commit');
      }
      return response;
    }) as typeof fetch;
    await assert.rejects(client.remoteMutation('addAnnouncement', interruptedArgs), /connection lost/);
    assert.ok([...memory.values()].some(v => v.includes(operationId)));
    assert.ok([...memory.values()].every(v => !v.includes('confidential text') && !v.includes(ownerHeaders.Authorization)));
    client.clearStateCache(); // Drop all in-memory retry state; keep sessionStorage as a reload would.
    const recovered = await client.remoteMutation('addAnnouncement', interruptedArgs);
    assert.equal(recovered.title, 'Reload-safe announcement');
    assert.equal(commandPosts, 1); assert.equal(statusReads, 1);
    const persisted = JSON.parse(readFileSync(join(dataDir, 'shared-state.json'), 'utf8'));
    assert.equal(persisted.syndik_prod_syndics_v1[0].buildings[0].announcements.filter((a: any) => a.title === recovered.title).length, 1);
    assert.equal((await call('/api/operations/status', {}, { operationId })).status, 401);
    assert.equal((await call('/api/operations/status', residentHeaders, { operationId })).data.status, 'not_found');
    assert.equal((await call('/api/operations/status', ownerHeaders, { operationId })).data.status, 'completed');
    assert.equal((await call('/api/operations/status', ownerHeaders, { operationId: 'bad' })).status, 400);
    assert.equal((await call('/api/operations/status', ownerHeaders, { operationId: `op:${Date.now() - 15 * 86400000}:expired-test` })).status, 410);
    console.log('PASS: interrupted HTTP response survives client reload, resolves original receipt without command replay, and enforces receipt ownership.');
  } finally {
    client.clearStateCache(); setActiveAuthContext(null, null); globalThis.fetch = nativeFetch;
    Reflect.deleteProperty(globalThis, 'window'); Reflect.deleteProperty(globalThis, 'localStorage');
  }
  // Archiving a resident while an AG has open voting must be blocked (409) until the AG is closed.
  const blockedArchive = await call('/api/commands',ownerHeaders,{operation:'deleteResident',args:['r-a'],operationId:crypto.randomUUID()});
  assert.equal(blockedArchive.status,409,JSON.stringify(blockedArchive.data));
  const closedAg = await call('/api/commands',ownerHeaders,{operation:'toggleAGVoting',args:['ag-a',false],operationId:crypto.randomUUID()});
  assert.equal(closedAg.status,200,JSON.stringify(closedAg.data));
  const archived = await call('/api/commands',ownerHeaders,{operation:'deleteResident',args:['r-a'],operationId:crypto.randomUUID()});
  assert.equal(archived.status,200,JSON.stringify(archived.data));
  assert.equal((await call('/api/shared-state',residentHeaders)).status,401);

  // PR 1: Unverified user is gated (403 ONBOARDING_REQUIRED) on read/SSE endpoints while /api/auth/session works
  const unverifiedHeaders = await login(unverifiedOwner.email);
  assert.equal((await call('/api/auth/session', unverifiedHeaders)).status, 200);
  const gatedShared = await call('/api/shared-state', unverifiedHeaders);
  assert.equal(gatedShared.status, 403);
  assert.equal(gatedShared.data.code, 'ONBOARDING_REQUIRED');
  const gatedReports = await call('/api/reports?buildingId=b-unv', unverifiedHeaders);
  assert.equal(gatedReports.status, 403);
  assert.equal(gatedReports.data.code, 'ONBOARDING_REQUIRED');
  const gatedArchives = await call('/api/archives', unverifiedHeaders);
  assert.equal(gatedArchives.status, 403);
  assert.equal(gatedArchives.data.code, 'ONBOARDING_REQUIRED');
  const gatedDiagnostics = await call('/api/diagnostics', unverifiedHeaders);
  assert.equal(gatedDiagnostics.status, 403);
  assert.equal(gatedDiagnostics.data.code, 'ONBOARDING_REQUIRED');
  const gatedBillingRuns = await call('/api/billing-runs?syndicId=s-unv&buildingId=b-unv', unverifiedHeaders);
  assert.equal(gatedBillingRuns.status, 403);
  assert.equal(gatedBillingRuns.data.code, 'ONBOARDING_REQUIRED');
  const gatedEvents = await call('/api/events', unverifiedHeaders);
  assert.equal(gatedEvents.status, 403);
  assert.equal(gatedEvents.data.code, 'ONBOARDING_REQUIRED');

  // PR 1: Provider cannot see building documents, AG, or chat in shared-state, and cannot download building docs via /api/uploads/:id
  const docUpload = await call('/api/uploads', ownerHeaders, {
    name: 'reglement.pdf', buildingId: 'b-a',
    dataUrl: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4\nBUILDING-REGLEMENT').toString('base64'),
  });
  assert.equal(docUpload.status, 200);
  const attachDoc = await call('/api/commands', ownerHeaders, {
    operation: 'attachDocument',
    args: ['b-a', { fileId: docUpload.data.fileId }],
    operationId: crypto.randomUUID(),
  });
  assert.equal(attachDoc.status, 200, JSON.stringify(attachDoc.data));
  const provCreate = await call('/api/commands', ownerHeaders, {
    operation: 'savePrestataire',
    args: [{ id: 'p-lockdown', buildingId: 'b-a', name: 'Plombier Lock', contactPerson: 'Omar', category: 'plumbing', phone: '0600112233', email: 'provlock@audit.invalid', active: true }, true],
    operationId: crypto.randomUUID(),
  });
  assert.equal(provCreate.status, 200, JSON.stringify(provCreate.data));
  const provLogin = await call('/api/auth/login', {}, { identifier: 'provlock@audit.invalid', password: provCreate.data.result.generatedPassword });
  assert.equal(provLogin.status, 200, JSON.stringify(provLogin.data));
  const provHeadersInit = { Authorization: `Bearer ${provLogin.data.token}` };
  // Provider has mustChangePassword=true initially -> gated on shared-state
  assert.equal((await call('/api/shared-state', provHeadersInit)).status, 403);
  // Complete password change with leading/trailing spaces (PR 1: no asymmetric trim)
  const spacePassword = '  ProviderPass-42!  ';
  const changedPass = await call('/api/auth/change-password', provHeadersInit, { newPassword: spacePassword });
  assert.equal(changedPass.status, 200, JSON.stringify(changedPass.data));
  const provRelogin = await call('/api/auth/login', {}, { identifier: 'provlock@audit.invalid', password: spacePassword });
  assert.equal(provRelogin.status, 200, JSON.stringify(provRelogin.data));
  const provHeaders = { Authorization: `Bearer ${provRelogin.data.token}` };
  const provState = await call('/api/shared-state', provHeaders);
  assert.equal(provState.status, 200, JSON.stringify(provState.data));
  assert.deepEqual(provState.data.store.syndik_prod_syndics_v1[0].buildings[0].documents, []);
  assert.deepEqual(provState.data.store.syndik_prod_ag_v1, []);
  assert.deepEqual(provState.data.store.syndik_prod_chat_v1, []);
  assert.equal((await call(docUpload.data.url, provHeaders)).status, 403);

  console.log('PASS: registration isolation, token verification, roles, scoped voting, proof review and private files.');
  // Exhaust admission, then make the platform file unreadable: the real route
  // must still return 429, proving it never enters the platform transaction.
  let limited = false;
  for (let i = 0; i < 11; i++) {
    const response = await call('/api/auth/register', {}, { email: `burst${i}@audit.invalid`, password: 'short' });
    if (response.status === 429) { limited = true; break; }
    assert.equal(response.status, 400);
  }
  assert.ok(limited);
  writeFileSync(join(dataDir, 'shared-state.json'), 'unreadable platform state');
  const blocked = await call('/api/auth/register', {}, { email: 'last@audit.invalid', password });
  assert.equal(blocked.status, 429); assert.equal(blocked.data.code, 'AUTH_RATE_LIMITED');
  assert.equal(readFileSync(join(dataDir, 'shared-state.json'), 'utf8'), 'unreadable platform state');
  console.log('PASS: real registration route rejects bursts before reading platform state.');
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) { const done = new Promise<void>((r) => child.once('exit', () => r())); child.kill(); await done; }
  rmSync(dataDir, { recursive: true, force: true });
}


