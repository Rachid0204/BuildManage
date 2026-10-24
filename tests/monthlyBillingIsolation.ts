import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { FileRepository, FirestoreRepository, type StateRepository } from '../server/repository';
import { hashPasswordSync } from '../utils/security';

const backend = process.argv.includes('--firestore') ? 'firestore' : 'file';
if (backend === 'firestore') {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
  process.env.GOOGLE_CLOUD_PROJECT ||= 'demo-buildmanage';
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'demo-buildmanage');
}
const directory = mkdtempSync(join(tmpdir(), 'buildmanage-monthly-isolation-'));
const app = backend === 'firestore' ? initializeApp({ projectId: 'demo-buildmanage' }) : undefined;
const repository: StateRepository = backend === 'firestore' ? new FirestoreRepository('(default)') : new FileRepository(directory);
const secret = 'synthetic-monthly-billing-secret-12345678901234567890';
const password = 'Synthetic-Monthly-Password-42!';
const period = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit' })
  .formatToParts(new Date());
const month = `${period.find(p => p.type === 'year')!.value}-${period.find(p => p.type === 'month')!.value}`;
const profiles = [
  { uid: 'monthly-owner', email: 'owner@monthly.invalid', displayName: 'Monthly owner', role: 'syndic', syndicId: 's-monthly', emailVerified: true },
  { uid: 'monthly-admin', email: 'admin@monthly.invalid', displayName: 'Monthly admin', role: 'admin', emailVerified: true },
];
const accounts = profiles.map(profile => ({ uid: profile.uid, email: profile.email, profile,
  passwordHash: hashPasswordSync(password, profile.email) }));
function building(id: string) {
  return { id, syndicId: 's-monthly', name: `Building ${id}`, address: 'Synthetic address', city: 'Casablanca',
    monthlySyndicFees: 135.25, totalTantiemes: 1000, reserveFundRate: 7.5,
    residents: [{ id: `r-${id}`, buildingId: id, syndicId: 's-monthly', name: `Owner ${id}`, email: `${id}@monthly.invalid`, isOwner: true }],
    apartments: [{ id: `lot-${id}`, buildingId: id, number: '1', ownerId: `r-${id}`, tenantId: null, tantiemes: 1000, monthlyFees: 135.25 }],
    announcements: [], documents: [],
    financials: { balance: 1000.01, reserveFundBalance: 500.02, openingWorkingBalance: 1000.01,
      openingReserveBalance: 500.02, openingBalancesRecordedAt: '2026-01-01T00:00:00.000Z', transactions: [] },
  };
}
function seed() {
  return { syndik_prod_registered_users_v1: structuredClone(accounts),
    syndik_prod_syndics_v1: [{ id: 's-monthly', name: 'Monthly cabinet', createdBy: 'monthly-owner', subscriptionPlan: 'starter',
      subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01', buildings: ['A', 'B', 'C'].map(building) }],
    syndik_prod_charges_v1: [], syndik_prod_invoices_v1: [], syndik_prod_quittances_v1: [],
    syndik_prod_notifications_v1: [], syndik_prod_audit_v1: [],
    __closedPeriods: { [`B:${month}`]: { reason: 'Synthetic closed period', actorUid: 'monthly-admin', closedAt: new Date().toISOString() } },
  };
}
const snapshot = () => repository.transaction(async state => structuredClone(state));
async function reset(change?: (state: any) => void) {
  const state = seed(); change?.(state);
  await repository.transaction(async current => {
    for (const key of Object.keys(current)) delete current[key];
    Object.assign(current, state);
  });
}
const processes: ChildProcess[] = [];
const exits: Promise<unknown>[] = [];
async function start() {
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  const child = spawn(process.execPath, ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', 'server.ts'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', SYNDIK_TEST_MODE: 'true', SYNDIK_AUTH_PROVIDER: 'legacy',
      SYNDIK_STATE_BACKEND: backend, SYNDIK_DATA_DIR: directory, FIRESTORE_DATABASE_ID: '(default)',
      GOOGLE_CLOUD_PROJECT: 'demo-buildmanage', GCLOUD_PROJECT: 'demo-buildmanage',
      SYNDIK_SERVER_SECRET: secret, SYNDIK_SCHEDULER_SECRET: secret,
      GEMINI_API_KEY: '', API_KEY: '', SENDGRID_API_KEY: '', FIREBASE_AUTH_EMULATOR_HOST: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(child); exits.push(once(child, 'exit'));
  let logs = '';
  child.stdout!.on('data', data => { logs += data; }); child.stderr!.on('data', data => { logs += data; });
  for (let attempt = 0; attempt < 200 && !logs.includes('Server running'); attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(logs.includes('Server running'), logs);
  return `http://127.0.0.1:${port}`;
}
async function call(origin: string, path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() as any };
}
const job = (origin: string) => call(origin, '/api/jobs/monthly-charges', {}, { 'X-Syndik-Scheduler': secret });
const charges = (state: any, id: string) => state.syndik_prod_charges_v1.filter((c: any) => c.buildingId === id && c.periodKey === month);
const invoices = (state: any, id: string) => state.syndik_prod_invoices_v1.filter((i: any) => i.buildingId === id);
function summary(result: any, counts: { total: number; succeeded: number; skipped: number; failed: number; created: number }) {
  assert.equal(result.status, 200, JSON.stringify(result.data));
  for (const [key, value] of Object.entries(counts)) assert.equal(result.data[key], value, key);
  assert.equal(result.data.period, month);
  assert.equal(result.data.ok, counts.failed === 0);
  assert.equal(result.data.results.length, counts.total);
  assert.equal(result.data.succeeded + result.data.skipped + result.data.failed, result.data.total);
}
try {
  await reset();
  const [first, second] = await Promise.all([start(), start()]);
  await test(`${backend}: scheduler authorization rejects requests without changing state`, async () => {
    await reset(); const before = await snapshot();
    assert.equal((await call(first, '/api/jobs/monthly-charges', {})).status, 403);
    assert.equal((await call(first, '/api/jobs/monthly-charges', {}, { 'X-Syndik-Scheduler': 'wrong-secret' })).status, 403);
    assert.deepEqual(await snapshot(), before);
  });
  await test(`${backend}: closed B cannot roll back A or prevent C from committing charges and invoices`, async () => {
    await reset(); const before = await snapshot();
    const result = await job(first); const after = await snapshot();
    if (result.status !== 200) {
      assert.equal(charges(after, 'A').length, 0, 'Legacy request-wide rollback must be captured');
      console.log(`Fail-first reproduction: HTTP ${result.status}; A=${charges(after, 'A').length}, B=${charges(after, 'B').length}, C=${charges(after, 'C').length}; ${result.data.error}`);
    }
    summary(result, { total: 3, succeeded: 2, skipped: 0, failed: 1, created: 2 });
    for (const id of ['A', 'C']) {
      assert.equal(charges(after, id).length, 1); assert.equal(invoices(after, id).length, 1);
      assert.equal(charges(after, id)[0].amount, 135.25);
      assert.equal(charges(after, id)[0].invoiceId, invoices(after, id)[0].id);
      assert.ok(after.syndik_prod_audit_v1.some((a: any) => a.detail?.operationId === `scheduled:${id}:${month}`));
    }
    assert.equal(charges(after, 'B').length, 0); assert.equal(invoices(after, 'B').length, 0);
    const failed = result.data.results.find((r: any) => r.buildingId === 'B');
    assert.equal(failed.status, 'failed'); assert.equal(failed.httpStatus, 409); assert.match(failed.reason, /Période comptable clôturée/);
    for (let i = 0; i < 3; i++) assert.deepEqual(after.syndik_prod_syndics_v1[0].buildings[i].financials, before.syndik_prod_syndics_v1[0].buildings[i].financials);
  });
  await test(`${backend}: reopening B and retrying creates only B, preserving A/C invoice numbers and notifications`, async () => {
    await reset(); await job(first); const original = await snapshot();
    const login = await call(first, '/api/auth/login', { identifier: profiles[1].email, password });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const reopened = await call(first, '/api/commands', { operation: 'reopenFinancialPeriod', args: ['B', month, 'Synthetic reopening'], operationId: crypto.randomUUID() }, { Authorization: `Bearer ${login.data.token}` });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.data));
    summary(await job(second), { total: 3, succeeded: 1, skipped: 2, failed: 0, created: 1 });
    const after = await snapshot();
    for (const id of ['A', 'C']) { assert.deepEqual(charges(after, id), charges(original, id)); assert.deepEqual(invoices(after, id), invoices(original, id)); }
    for (const id of ['A', 'B', 'C']) { assert.equal(charges(after, id).length, 1); assert.equal(invoices(after, id).length, 1); }
    assert.equal(after.syndik_prod_notifications_v1.length, 3);
    const all = await snapshot();
    summary(await job(first), { total: 3, succeeded: 0, skipped: 3, failed: 0, created: 0 });
    const retried = await snapshot();
    for (const key of ['syndik_prod_charges_v1', 'syndik_prod_invoices_v1', 'syndik_prod_notifications_v1']) assert.deepEqual(retried[key], all[key]);
  });
  await test(`${backend}: an invoice failure after charge generation rolls back that building alone`, async () => {
    await reset(state => { state.__closedPeriods = {}; state.syndik_prod_syndics_v1[0].buildings[1].residents = []; });
    const result = await job(first);
    summary(result, { total: 3, succeeded: 2, skipped: 0, failed: 1, created: 2 });
    const after = await snapshot();
    assert.equal(charges(after, 'B').length, 0); assert.equal(invoices(after, 'B').length, 0);
    assert.equal(after.syndik_prod_notifications_v1.filter((n: any) => n.buildingId === 'B').length, 0);
    for (const id of ['A', 'C']) assert.equal(charges(after, id).length, 1);
    assert.equal(result.data.results.find((r: any) => r.buildingId === 'B').status, 'failed');
  });
  await test(`${backend}: invalid building shares do not stop the remaining buildings`, async () => {
    await reset(state => { state.__closedPeriods = {}; state.syndik_prod_syndics_v1[0].buildings[1].apartments[0].tantiemes = -1; });
    const result = await job(first);
    summary(result, { total: 3, succeeded: 2, skipped: 0, failed: 1, created: 2 });
    assert.match(result.data.results.find((r: any) => r.buildingId === 'B').reason, /Tantièmes invalides/);
    assert.equal(charges(await snapshot(), 'B').length, 0);
  });
  await test(`${backend}: archived/setup/inactive/onboarding buildings have granular skip results`, async () => {
    await reset(state => {
      state.__closedPeriods = {};
      state.syndik_prod_syndics_v1[0].buildings[1].archivedAt = new Date().toISOString();
      state.syndik_prod_syndics_v1[0].buildings[2].address = '';
      const inactive = structuredClone(state.syndik_prod_syndics_v1[0]);
      inactive.id = 's-inactive'; inactive.subscriptionStatus = 'expired'; inactive.buildings = [{ ...building('D'), syndicId: inactive.id }];
      const onboarding = structuredClone(inactive);
      onboarding.id = 's-onboarding'; onboarding.subscriptionStatus = 'active'; onboarding.createdBy = 'unverified'; onboarding.buildings = [{ ...building('E'), syndicId: onboarding.id }];
      state.syndik_prod_syndics_v1.push(inactive, onboarding);
      state.syndik_prod_registered_users_v1.push({ uid: 'unverified', profile: { emailVerified: false } });
    });
    const result = await job(first);
    summary(result, { total: 5, succeeded: 1, skipped: 4, failed: 0, created: 1 });
    assert.deepEqual(Object.fromEntries(result.data.results.filter((r: any) => r.status === 'skipped').map((r: any) => [r.buildingId, r.reason])),
      { B: 'archived', C: 'setup', D: 'inactive', E: 'onboarding' });
  });
  await test(`${backend}: concurrent jobs on separate server instances never duplicate charges or invoices`, async () => {
    await reset(state => { state.__closedPeriods = {}; });
    const responses = await Promise.all([job(first), job(second)]);
    for (const result of responses) assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(responses.reduce((sum, r) => sum + r.data.created, 0), 3);
    const after = await snapshot();
    assert.equal(after.syndik_prod_charges_v1.length, 3); assert.equal(after.syndik_prod_invoices_v1.length, 3);
    assert.equal(after.syndik_prod_notifications_v1.length, 3);
    assert.equal(new Set(after.syndik_prod_invoices_v1.map((i: any) => i.invoiceNumber)).size, 3);
    for (const id of ['A', 'B', 'C']) assert.equal(charges(after, id).length, 1);
  });
  await test(`${backend}: an empty batch returns an empty successful summary`, async () => {
    await reset(state => { state.syndik_prod_syndics_v1 = []; });
    const result = await job(first);
    summary(result, { total: 0, succeeded: 0, skipped: 0, failed: 0, created: 0 });
    assert.equal(result.data.ok, true);
  });
  if (backend === 'file') await test('file: scheduler authentication happens before reading an unavailable repository', async () => {
    const path = join(directory, 'shared-state.json'), previous = readFileSync(path);
    try {
      writeFileSync(path, '{synthetic-corrupt-test-file');
      assert.equal((await call(first, '/api/jobs/monthly-charges', {})).status, 403);
      assert.equal(readFileSync(path, 'utf8'), '{synthetic-corrupt-test-file');
    } finally { writeFileSync(path, previous); }
  });
} finally {
  for (const child of processes) child.kill();
  await Promise.all(exits);
  if (app) await deleteApp(app);
  rmSync(directory, { recursive: true, force: true });
}
