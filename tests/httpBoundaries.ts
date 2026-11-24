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
const resident = (id: string, email: string, cin?: string) => ({ id, name: id, email, ...(cin ? { cin } : {}), isOwner: true, hasAccount: true, mustChangePassword: false });
const record = (profile: typeof owner | typeof unverifiedOwner | typeof admin) => ({ uid: profile.uid, email: profile.email, passwordHash: hashPasswordSync(password, profile.email), profile });
const state = {
  syndik_prod_registered_users_v1: [record(owner), record(unverifiedOwner), record(admin)],
  syndik_prod_syndics_v1: [
    { id: 's-a', createdBy: owner.uid, subscriptionPlan: 'starter', subscriptionStatus: 'trialing', subscriptionExpiry: '2099-01-01', buildings: [
      { id: 'b-a', syndicId: 's-a', residents: [resident('r-a', 'a@audit.invalid', 'AB123456')], apartments: [{ id: 'lot-a', number: '1', ownerId: 'r-a', tantiemes: 1000 }] },
    ] },
    { id: 's-unv', createdBy: unverifiedOwner.uid, subscriptionPlan: 'starter', subscriptionStatus: 'trialing', subscriptionExpiry: '2099-01-01', buildings: [
      { id: 'b-unv', syndicId: 's-unv', residents: [], apartments: [] },
    ] },
    { id: 's-b', createdBy: 'owner-b', buildings: [{ id: 'b-b', residents: [resident('r-b', 'b@audit.invalid', 'AB123456')], apartments: [] }] },
  ],
  syndik_prod_resident_accounts_v1: [
    { residentId: 'r-a', email: 'a@audit.invalid', syndicId: 's-a', buildingId: 'b-a', passwordHash: hashPasswordSync(password, 'a@audit.invalid'), mustChangePassword: false },
    { residentId: 'r-b', email: 'b@audit.invalid', cin: 'AB123456', syndicId: 's-b', buildingId: 'b-b', passwordHash: hashPasswordSync(password, 'b@audit.invalid'), mustChangePassword: false },
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
    TRUST_PROXY_HOPS: '1', SYNDIK_SERVER_SECRET: 'synthetic-server-secret-12345678901234567890', FIREBASE_SERVICE_ACCOUNT_JSON: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stderr.on('data', (d) => { logs += d; });
const timeout = setTimeout(() => child.kill(), 45_000);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const call = async (route: string, headers: Record<string, string> = {}, body?: unknown) => {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) });
  const text = await response.text(); let data: any; try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
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

  // Regression: per-route body limits, zero-write bad login throttling, non-DoS lockout, and pre-transaction webhook rejection.
  const readPersisted = () => JSON.parse(readFileSync(join(dataDir, 'shared-state.json'), 'utf8'));
  const revBeforeAbuse = readPersisted().__revision;
  const oversized = { identifier: owner.email, password: 'wrong', pad: 'x'.repeat(140_000) };
  assert.equal((await call('/api/auth/login', { 'X-Forwarded-For': '203.0.113.5' }, oversized)).status, 413);
  assert.equal((await call('/api/ag/vote', ownerHeaders, { agId: 'ag-a', resolutionId: 'resolution', choice: 'for', pad: 'x'.repeat(140_000) })).status, 413);
  assert.equal((await call('/api/webhooks/paypal', { 'X-Forwarded-For': '203.0.113.6' }, { event_type: 'PAYMENT.CAPTURE.COMPLETED', pad: 'x'.repeat(140_000) })).status, 413);
  assert.equal(readPersisted().__revision, revBeforeAbuse);

  // Valid large upload (>100 KB) still succeeds for authenticated user, while unauthenticated upload is rejected 401 before buffering.
  const largePdf = Buffer.alloc(180_000, 0x20);
  Buffer.from('%PDF-1.4\n').copy(largePdf);
  assert.equal((await call('/api/uploads', {}, { name: 'unauth.pdf', buildingId: 'b-a', dataUrl: 'data:application/pdf;base64,' + largePdf.toString('base64') })).status, 401);
  assert.equal(readPersisted().__revision, revBeforeAbuse);
  const largeUpload = await call('/api/uploads', ownerHeaders, { name: 'large.pdf', buildingId: 'b-a', dataUrl: 'data:application/pdf;base64,' + largePdf.toString('base64') });
  assert.equal(largeUpload.status, 200, JSON.stringify(largeUpload.data));

  const revBeforeBadLogins = readPersisted().__revision;

  // N bad logins from attacker IP (even spoofing leftmost X-Forwarded-For with TRUST_PROXY_HOPS=1) -> 429 with ZERO repository writes.
  for (let i = 0; i < 10; i++) {
    const bad = await call('/api/auth/login', { 'X-Forwarded-For': `198.51.100.${i}, 203.0.113.10` }, { identifier: owner.email, password: `wrong-${i}` });
    assert.equal(bad.status, 401);
    const snap = readPersisted();
    assert.equal(snap.__revision, revBeforeBadLogins);
    assert.equal('__authAttempts' in snap, false);
  }
  const lockedAttacker = await call('/api/auth/login', { 'X-Forwarded-For': '198.51.100.250, 203.0.113.10' }, { identifier: owner.email, password: 'wrong-11' });
  assert.equal(lockedAttacker.status, 429);
  assert.ok(Number(lockedAttacker.headers.get('retry-after')) > 0);
  assert.equal(readPersisted().__revision, revBeforeBadLogins);

  // Legitimate owner on another IP is NOT locked out, and 65+ valid logins from a shared CGNAT/office IP succeed without false-positive 429s!
  for (let i = 0; i < 65; i++) {
    const legitOwner = await call('/api/auth/login', { 'X-Forwarded-For': '203.0.113.20' }, { identifier: owner.email, password });
    assert.equal(legitOwner.status, 200);
  }

  // Same non-DoS protection when an attacker targets a resident's Moroccan CIN.
  const revAfterLegit = readPersisted().__revision;
  for (let i = 0; i < 10; i++) {
    const badCin = await call('/api/auth/login', { 'X-Forwarded-For': '203.0.113.11' }, { identifier: 'AB123456', password: `wrong-cin-${i}` });
    assert.equal(badCin.status, 401);
  }
  assert.equal((await call('/api/auth/login', { 'X-Forwarded-For': '203.0.113.11' }, { identifier: 'AB123456', password: 'wrong-cin-11' })).status, 429);
  assert.equal(readPersisted().__revision, revAfterLegit);
  const legitCin = await call('/api/auth/login', { 'X-Forwarded-For': '203.0.113.21' }, { identifier: 'AB123456', password });
  assert.equal(legitCin.status, 200);

  // PayPal webhook with missing or junk headers is rejected 400 with zero repository writes or gateway events.
  const revBeforeWebhook = readPersisted().__revision;
  const junkPayPalCases: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [
    { headers: {}, body: { event_type: 'PAYMENT.CAPTURE.COMPLETED' } },
    {
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://evil.invalid/cert.pem',
        'paypal-transmission-id': 'tx-junk-1',
        'paypal-transmission-sig': 'JUNK-SIG',
        'paypal-transmission-time': new Date().toISOString(),
      },
      body: { event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    },
    {
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
        'paypal-transmission-id': 'tx-junk-2',
        'paypal-transmission-sig': 'JUNK-SIG',
        'paypal-transmission-time': 'not-an-iso-timestamp',
      },
      body: { event_type: 'PAYMENT.CAPTURE.COMPLETED' },
    },
  ];
  for (const c of junkPayPalCases) {
    const res = await call('/api/webhooks/paypal', { 'X-Forwarded-For': '203.0.113.30', ...c.headers }, c.body);
    assert.equal(res.status, 400);
  }
  assert.equal(readPersisted().__revision, revBeforeWebhook);
  assert.equal((readPersisted().__gatewayEvents || []).length, 0);

  // Exhaust admission, then make the platform file unreadable: the real routes
  // must still reject before ever entering the platform transaction.
  let limited = false;
  for (let i = 0; i < 11; i++) {
    const response = await call('/api/auth/register', {}, { email: `burst${i}@audit.invalid`, password: 'short' });
    if (response.status === 429) { limited = true; break; }
    assert.equal(response.status, 400);
  }
  assert.ok(limited);
  const readyWarm = await call('/api/ready', { 'X-Forwarded-For': '203.0.113.70' });
  assert.equal(readyWarm.status, 200);
  assert.equal(readyWarm.data.status, 'ready');
  assert.equal(readyWarm.data.revision, revBeforeWebhook);

  writeFileSync(join(dataDir, 'shared-state.json'), 'unreadable platform state');
  // Within the short readiness cache window, /api/ready serves the cached revision without hitting disk; >60/min from one IP returns 429.
  assert.equal((await call('/api/ready', { 'X-Forwarded-For': '203.0.113.70' })).status, 200);
  let readyLimited = false;
  for (let i = 0; i < 65; i++) {
    const rr = await call('/api/ready', { 'X-Forwarded-For': '203.0.113.71' });
    if (rr.status === 429) { readyLimited = true; break; }
  }
  assert.equal(readyLimited, true);
  // Malformed CMI callback rejected 400 FAILURE before touching repository.transaction.
  const badCmiPreDb = await fetch(`http://127.0.0.1:${port}/api/webhooks/cmi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-For': '203.0.113.72' },
    body: 'oid=bad&amount=10',
  });
  assert.equal(badCmiPreDb.status, 400);
  assert.equal(await badCmiPreDb.text(), 'FAILURE');

  // Browser security headers on every HTML shell route and API response + CSP parsing.
  const parseCsp = (raw: string): Map<string, string[]> => {
    assert.ok(raw.length > 0 && !/[\r\n\0]/.test(raw), 'CSP must be a non-empty single-line header');
    const directives = new Map<string, string[]>();
    const parts = raw.split(';').map((s) => s.trim()).filter(Boolean);
    assert.ok(parts.length >= 8, `Expected structured CSP directives, got: ${raw}`);
    for (const part of parts) {
      const tokens = part.split(/\s+/).filter(Boolean);
      const name = tokens[0]?.toLowerCase();
      assert.ok(name && /^[a-z0-9-]+$/.test(name), `Invalid directive name in: ${part}`);
      assert.equal(directives.has(name), false, `Duplicate CSP directive: ${name}`);
      directives.set(name, tokens.slice(1));
    }
    return directives;
  };
  for (const htmlRoute of ['/', '/index.html', '/login', '/privacy']) {
    const htmlRes = await fetch(`http://127.0.0.1:${port}${htmlRoute}`);
    assert.equal(htmlRes.status, 200, `Expected 200 HTML for ${htmlRoute}`);
    assert.match(htmlRes.headers.get('content-type') || '', /text\/html/i);
    const hsts = htmlRes.headers.get('strict-transport-security') || '';
    assert.match(hsts, /max-age=15552000\b/);
    assert.equal(/preload/i.test(hsts), false, 'HSTS must not include preload');
    const perms = htmlRes.headers.get('permissions-policy') || '';
    assert.match(perms, /camera=\(self\)/);
    assert.match(perms, /microphone=\(\)/);
    assert.match(perms, /geolocation=\(\)/);
    assert.equal(htmlRes.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.equal(htmlRes.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(htmlRes.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(htmlRes.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(htmlRes.headers.get('content-security-policy'), null);
    const cspRaw = htmlRes.headers.get('content-security-policy-report-only') || '';
    const csp = parseCsp(cspRaw);
    assert.deepEqual(csp.get('default-src'), ["'self'"]);
    const scriptSrc = csp.get('script-src') || [];
    assert.ok(scriptSrc.includes("'self'"));
    assert.ok(scriptSrc.includes('https://www.paypal.com'));
    assert.ok(scriptSrc.includes('https://apis.google.com'));
    assert.equal(scriptSrc.includes("'unsafe-inline'"), false, 'script-src must not allow unsafe-inline');
    assert.equal(scriptSrc.includes("'unsafe-eval'"), false, 'script-src must not allow unsafe-eval');
    const connectSrc = csp.get('connect-src') || [];
    assert.ok(connectSrc.includes("'self'"));
    assert.ok(connectSrc.includes('https://identitytoolkit.googleapis.com'));
    assert.ok(connectSrc.includes('https://securetoken.googleapis.com'));
    assert.ok(connectSrc.includes('https://www.paypal.com'));
    const frameSrc = csp.get('frame-src') || [];
    assert.ok(frameSrc.includes('https://www.paypal.com'));
    assert.ok(frameSrc.includes('https://immogest-7faaf.firebaseapp.com'));
    assert.ok(frameSrc.includes('https://accounts.google.com'));
    const imgSrc = csp.get('img-src') || [];
    assert.ok(imgSrc.includes("'self'") && imgSrc.includes('data:') && imgSrc.includes('blob:'));
    assert.deepEqual(csp.get('report-uri'), ['/api/csp-report']);
  }
  const apiHealth = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(apiHealth.status, 200);
  assert.match(apiHealth.headers.get('strict-transport-security') || '', /max-age=15552000\b/);
  assert.equal(apiHealth.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
  assert.match(apiHealth.headers.get('permissions-policy') || '', /camera=\(self\)/);
  assert.equal(apiHealth.headers.get('x-content-type-options'), 'nosniff');

  // With shared-state.json unreadable, POST /api/csp-report still returns 204, logs one sanitized JSON line, enforces tiny 8kb limit, rate-limits, and NEVER calls repository.
  const logsBeforeCsp = logs.length;
  const cspReportRes = await fetch(`http://127.0.0.1:${port}/api/csp-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/csp-report', 'X-Forwarded-For': '203.0.113.80' },
    body: JSON.stringify({
      'csp-report': {
        'document-uri': 'https://immogest.cloud.run/login?token=secret-query-marker',
        'blocked-uri': 'https://evil.invalid/inject.js?leak=secret-query-marker',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        disposition: 'report',
        'status-code': 200,
      },
    }),
  });
  assert.equal(cspReportRes.status, 204);
  const newCspLogs = logs.slice(logsBeforeCsp).trim().split('\n').filter(Boolean);
  assert.equal(newCspLogs.length, 1, `Expected 1 JSON log line for CSP report, got: ${JSON.stringify(newCspLogs)}`);
  const parsedCspLog = JSON.parse(newCspLogs[0]);
  assert.equal(parsedCspLog.event, 'csp_violation_report');
  assert.equal(parsedCspLog.severity, 'WARNING');
  assert.equal(parsedCspLog.effectiveDirective, 'script-src-elem');
  assert.equal(parsedCspLog.blockedUri, 'https://evil.invalid/inject.js');
  assert.equal(newCspLogs[0].includes('secret-query-marker'), false, 'CSP log must strip query tokens');

  // Tiny body limit (~8kb) rejects 12kb CSP report with 413 without touching repository.
  const oversizedCsp = await fetch(`http://127.0.0.1:${port}/api/csp-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/csp-report', 'X-Forwarded-For': '203.0.113.81' },
    body: JSON.stringify({ 'csp-report': { 'blocked-uri': 'x'.repeat(12_000) } }),
  });
  assert.equal(oversizedCsp.status, 413);

  // Rate limit on POST /api/csp-report blocks floods with 429 before body parsing and without touching repository.
  let cspRateLimited = false;
  for (let i = 0; i < 35; i++) {
    const r = await fetch(`http://127.0.0.1:${port}/api/csp-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/csp-report', 'X-Forwarded-For': '203.0.113.82' },
      body: '{"csp-report":{"effective-directive":"img-src"}}',
    });
    if (r.status === 429) { cspRateLimited = true; break; }
  }
  assert.equal(cspRateLimited, true);

  const blocked = await call('/api/auth/register', {}, { email: 'last@audit.invalid', password });
  assert.equal(blocked.status, 429); assert.equal(blocked.data.code, 'AUTH_RATE_LIMITED');
  assert.equal((await call('/api/auth/login', { 'X-Forwarded-For': '203.0.113.10' }, { identifier: owner.email, password: 'any' })).status, 429);
  assert.equal((await call('/api/auth/login', { 'X-Forwarded-For': '203.0.113.40' }, oversized)).status, 413);
  // Exhaust pre-body recovery IP limit (10/15m), then send an oversized body: 429 (not 413/500) proves the IP limiter runs BEFORE body parsing and BEFORE repository.transaction.
  for (let i = 0; i < 10; i++) {
    assert.equal((await call('/api/auth/recovery/request', { 'X-Forwarded-For': '203.0.113.60' }, { email: 'invalid-no-at' })).status, 200);
  }
  const preBodyBlocked = await call('/api/auth/recovery/request', { 'X-Forwarded-For': '99.99.99.99, 203.0.113.60' }, oversized);
  assert.equal(preBodyBlocked.status, 429);
  assert.equal((await call('/api/webhooks/paypal', { 'X-Forwarded-For': '203.0.113.30', ...junkPayPalCases[1].headers }, junkPayPalCases[1].body)).status, 400);
  assert.equal((await call('/api/shared-state')).status, 401);
  assert.equal((await call('/api/commands', {}, { operation: 'deleteBuilding', args: ['b-a'], operationId: 'op:1234567890123:unauth' })).status, 401);
  assert.equal((await call('/api/auth/firebase-session', {}, {})).status, 401);
  assert.equal(readFileSync(join(dataDir, 'shared-state.json'), 'utf8'), 'unreadable platform state');
  console.log('PASS: body limits, IP rate limits, non-DoS login lockouts, security headers, CSP report-only, and webhook/auth guards stop before platform state.');
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) { const done = new Promise<void>((r) => child.once('exit', () => r())); child.kill(); await done; }
  rmSync(dataDir, { recursive: true, force: true });
}


