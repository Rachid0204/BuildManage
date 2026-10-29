import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { allocateBudgetInCentimes, centimes } from '../shared/domain/money';
import { createCommandService } from '../server/domain/command.service';
import { hashPasswordSync } from '../utils/security';

const month = new Date().toISOString().slice(0, 7);
const today = new Date().toISOString().slice(0, 10);
const actorA = { uid: 'owner-a', role: 'syndic', syndicId: 'cab-a' } as const;
const actorB = { uid: 'owner-b', role: 'syndic', syndicId: 'cab-b' } as const;
const password = 'A4-Invariant-Password-42!';
const apartment = (id: string, buildingId: string, number: string, ownerId: string) => ({
  id, buildingId, number, floor: 1, area: 50, tantiemes: 500, ownerId, tenantId: null, monthlyFees: 100,
});
function building(id: string, syndicId: string, residentId: string, multipleLots = false) {
  const residents = [{ id: residentId, syndicId, buildingId: id, apartmentId: 'lot-' + id + '-1',
    name: 'Resident ' + id, email: residentId + '@a4.invalid', phone: '0600000000', isOwner: true, hasAccount: false }];
  const apartments = [apartment('lot-' + id + '-1', id, '1', residentId)];
  if (multipleLots) apartments.push(apartment('lot-' + id + '-2', id, '2', residentId));
  return {
    id, syndicId, name: 'Building ' + id, address: '1 Test Street', city: 'Casablanca',
    monthlySyndicFees: 100, totalTantiemes: multipleLots ? 1000 : 500, reserveFundRate: 0,
    residents, apartments, documents: [], announcements: [],
    financials: { balance: 0, reserveFundBalance: 0, transactions: [],
      openingWorkingBalance: 0, openingReserveBalance: 0, openingBalancesRecordedAt: '2026-01-01T00:00:00.000Z' },
  };
}
function fixture() {
  const a = building('building-a', 'cab-a', 'resident-a', true);
  const b = building('building-b', 'cab-b', 'resident-b');
  const account = (uid: string, email: string, role: string, syndicId: string) => ({
    uid, email, passwordHash: hashPasswordSync(password, email),
    profile: { uid, email, role, syndicId, emailVerified: true, displayName: uid },
  });
  return {
    syndik_prod_registered_users_v1: [
      account('owner-a', 'owner-a@a4.invalid', 'syndic', 'cab-a'),
      account('owner-b', 'owner-b@a4.invalid', 'syndic', 'cab-b'),
    ],
    syndik_prod_syndics_v1: [
      { id: 'cab-a', name: 'Cabinet A', createdBy: 'owner-a', subscriptionPlan: 'starter',
        subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01', buildings: [a] },
      { id: 'cab-b', name: 'Cabinet B', createdBy: 'owner-b', subscriptionPlan: 'starter',
        subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01', buildings: [b] },
    ],
    syndik_prod_charges_v1: [
      { id: 'charge-a', syndicId: 'cab-a', buildingId: 'building-a', apartmentId: 'lot-building-a-1',
        residentId: 'resident-a', period: month, periodKey: month, amount: 100, paidAmount: 0, status: 'unpaid', dueDate: today },
      { id: 'charge-b', syndicId: 'cab-b', buildingId: 'building-b', apartmentId: 'lot-building-b-1',
        residentId: 'resident-b', period: month, periodKey: month, amount: 100, paidAmount: 0, status: 'unpaid', dueDate: today },
    ],
    syndik_prod_proofs_v1: [],
    syndik_prod_quittances_v1: [],
    syndik_prod_invoices_v1: [],
    syndik_prod_notifications_v1: [],
    syndik_prod_audit_v1: [],
    __closedPeriods: {},
  };
}
const service = (state: any) => createCommandService(state);
const noMutation = (before: unknown, after: unknown) => assert.deepEqual(after, before);

test('centime allocation conserves every budget and never leaks shares to zero-weight lots', () => {
  let seed = 0x4a31f00d;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % limit;
  };
  const cases: number[][] = [
    [0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1], [0, 0, 9, 0],
    [1, 2, 3, 4, 5], [500, 0, 500, 0],
  ];
  for (let i = 0; i < 500; i++) {
    const weights = Array.from({ length: 1 + random(24) }, () => random(1001));
    if (weights.every(weight => weight === 0)) weights[random(weights.length)] = 1;
    cases.push(weights);
  }
  const budgets = [0, 0.01, 0.03, 1.01, 1000.99, 999999.99];
  for (let i = 0; i < 500; i++) budgets.push(random(100000000) / 100);
  for (const [caseIndex, weights] of cases.entries()) {
    for (const budget of budgets) {
      const result = allocateBudgetInCentimes(budget, weights.map((tantiemes, index) => ({
        id: 'lot-' + caseIndex + '-' + index, tantiemes,
      })));
      assert.equal([...result.values()].reduce((sum, amount) => sum + centimes(amount), 0), centimes(budget),
        'allocation must conserve budget ' + budget + ' for weights ' + weights.join(','));
      weights.forEach((weight, index) => {
        if (weight === 0) assert.equal(result.get('lot-' + caseIndex + '-' + index), 0,
          'a zero-weight lot must not receive a remainder centime');
      });
    }
  }
  assert.throws(() => allocateBudgetInCentimes(1, [{ id: 'zero-a', tantiemes: 0 }, { id: 'zero-b', tantiemes: 0 }]));
});

test('payment confirmation and reconciliation remain scoped to the selected cabinet and building', async () => {
  const state: any = fixture();
  state.syndik_prod_proofs_v1.push({
    id: 'proof-b', syndicId: 'cab-b', buildingId: 'building-b', chargeId: 'charge-b',
    apartmentId: 'lot-building-b-1', apartmentNumber: '1', residentId: 'resident-b',
    amount: 100, paymentMethod: 'virement', status: 'pending', submissionDate: today + 'T10:00:00.000Z',
  });
  const beforeForeign = structuredClone({
    charge: state.syndik_prod_charges_v1[1],
    proof: state.syndik_prod_proofs_v1[0],
    building: state.syndik_prod_syndics_v1[1],
    receipts: state.syndik_prod_quittances_v1,
  });
  const commands = service(state);
  await assert.rejects(commands.runOperation(actorA, 'reviewPaymentProof', ['proof-b', 'approved'], 'a4-review-foreign-proof'),
    /autorisé|immeuble/i);
  await assert.rejects(commands.runOperation(actorA, 'reconcileBankStatementCSV', ['building-b', [
    { date: today, label: 'Lot 1 Resident building-b', amount: 100, reference: 'A4-FOREIGN-ROW' },
  ], {}], 'a4-reconcile-foreign-building'), /autorisé|immeuble/i);
  await assert.rejects(commands.runOperation(actorA, 'reversePayment', ['building-b', 'foreign-payment', 'unauthorized'], 'a4-reverse-foreign-building'),
    /autorisé|immeuble/i);
  noMutation(beforeForeign, {
    charge: state.syndik_prod_charges_v1[1],
    proof: state.syndik_prod_proofs_v1[0],
    building: state.syndik_prod_syndics_v1[1],
    receipts: state.syndik_prod_quittances_v1,
  });

  const reconciled = await commands.runOperation(actorA, 'reconcileBankStatementCSV', ['building-a', [
    { date: today, label: 'Lot 1 Resident building-a', amount: 100, reference: 'A4-OWN-ROW' },
  ], {}], 'a4-reconcile-own-building');
  assert.equal(reconciled.matchedCount, 1);
  assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 100);
  assert.equal(state.syndik_prod_charges_v1[1].paidAmount, 0);
  assert.equal(state.syndik_prod_proofs_v1[0].status, 'pending');
});

test('reversal is building-scoped and preserves historical bank dates; closed periods reject new postings', async () => {
  const state: any = fixture();
  const date = month + '-10';
  const bankDate = month + '-08';
  for (const [index, buildingId] of ['building-a', 'building-b'].entries()) {
    const charge = state.syndik_prod_charges_v1[index];
    charge.paidAmount = charge.amount;
    charge.status = 'paid';
    const cabinet = state.syndik_prod_syndics_v1[index];
    cabinet.buildings[0].financials.balance = 100;
    cabinet.buildings[0].financials.transactions.push({
      id: 'income-' + index, type: 'income', amount: 100, paymentId: 'shared-payment-id',
      paymentMethod: 'virement', date: date + 'T12:00:00.000Z',
      bankTransactionDate: bankDate, postingDate: date,
      submissionDate: month + '-12T12:00:00.000Z',
      paymentAllocations: [{ chargeId: charge.id, amount: 100 }],
      receiptSnapshots: [],
    });
    state.syndik_prod_quittances_v1.push({
      id: 'receipt-' + index, syndicId: cabinet.id, buildingId, chargeId: charge.id,
      residentId: charge.residentId, apartmentId: charge.apartmentId, amount: 100,
      paymentId: 'shared-payment-id', paymentMethod: 'virement', bankTransactionDate: bankDate,
      postingDate: date, submissionDate: month + '-12T12:00:00.000Z',
    });
  }
  const commands = service(state);
  await commands.runOperation(actorA, 'reversePayment',
    ['building-a', 'shared-payment-id', 'duplicate payment reference in separate cabinets'], 'a4-reverse-cabinet-a');
  const a = state.syndik_prod_syndics_v1[0].buildings[0];
  const b = state.syndik_prod_syndics_v1[1].buildings[0];
  assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 0);
  assert.equal(state.syndik_prod_charges_v1[1].paidAmount, 100);
  assert.equal(a.financials.balance, 0);
  assert.equal(b.financials.balance, 100);
  assert.ok(a.financials.transactions.some((entry: any) => entry.reversalOf === 'shared-payment-id'));
  assert.ok(!b.financials.transactions.some((entry: any) => entry.reversalOf === 'shared-payment-id'));
  assert.equal(a.financials.transactions.find((entry: any) => entry.id === 'income-0').bankTransactionDate, bankDate);
  assert.equal(b.financials.transactions.find((entry: any) => entry.id === 'income-1').bankTransactionDate, bankDate);
  assert.ok(state.syndik_prod_quittances_v1[0].voidedAt);
  assert.equal(state.syndik_prod_quittances_v1[1].voidedAt, undefined);
  await assert.rejects(commands.runOperation(actorA, 'reversePayment',
    ['building-b', 'shared-payment-id', 'foreign reference'], 'a4-reverse-foreign-cabinet'), /autorisé|immeuble/i);

  await commands.runOperation(actorA, 'closeFinancialPeriod', ['building-a', month, 'A4 invariant test'], 'a4-close-period');
  const originalA = structuredClone(a.financials.transactions.find((entry: any) => entry.id === 'income-0'));
  await assert.rejects(commands.runOperation(actorA, 'reversePayment',
    ['building-a', 'shared-payment-id', 'closed period'], 'a4-reverse-closed-period'), /clôturée/i);
  assert.deepEqual(a.financials.transactions.find((entry: any) => entry.id === 'income-0'), originalA,
    'a closed period must not rewrite historical payment or bank dates');
});

test('resident profile edits preserve ownership of every linked lot', async () => {
  const state: any = fixture();
  const cabinet = state.syndik_prod_syndics_v1[0];
  const buildingA = cabinet.buildings[0];
  const resident = buildingA.residents[0];
  assert.deepEqual(buildingA.apartments.map((lot: any) => lot.ownerId), ['resident-a', 'resident-a']);
  await service(state).runOperation(actorA, 'updateResident', [{
    ...resident, name: 'Resident Updated', email: 'resident-updated@a4.invalid', phone: '0612345678',
  }], 'a4-update-resident');
  assert.deepEqual(buildingA.apartments.map((lot: any) => lot.ownerId), ['resident-a', 'resident-a']);
  assert.equal(buildingA.residents[0].apartmentId, 'lot-building-a-1');
  assert.equal(buildingA.residents[0].name, 'Resident Updated');
});

const serverRoot = resolve(import.meta.dirname, '..');
async function unusedPort() {
  const server = createServer();
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolveClose => server.close(() => resolveClose()));
  return port;
}
async function startHttpServer(directory: string) {
  const port = await unusedPort();
  const child = spawn(process.execPath, [
    '--import', resolve(serverRoot, 'tests/helpers/networkGuard.mjs'), '--import', 'tsx', 'server.ts',
  ], {
    cwd: serverRoot,
    env: {
      ...process.env, PORT: String(port), NODE_ENV: 'test', SYNDIK_TEST_MODE: 'true',
      SYNDIK_AUTH_PROVIDER: 'legacy', SYNDIK_STATE_BACKEND: 'file', SYNDIK_DATA_DIR: directory,
      SYNDIK_SERVER_SECRET: 'a4-server-secret-012345678901234567890',
      SYNDIK_SCHEDULER_SECRET: 'a4-scheduler-secret-012345678901234567890',
      FIREBASE_AUTH_EMULATOR_HOST: '', FIREBASE_SERVICE_ACCOUNT_JSON: '',
      GEMINI_API_KEY: '', API_KEY: '', SENDGRID_API_KEY: '', SENDGRID_FROM_EMAIL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout!.on('data', chunk => { logs += chunk; });
  child.stderr!.on('data', chunk => { logs += chunk; });
  for (let i = 0; i < 300 && !logs.includes('Server running'); i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Server exited before readiness: ' + logs);
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50));
  }
  assert.ok(logs.includes('Server running'), 'server did not become ready: ' + logs);
  return { child, origin: 'http://127.0.0.1:' + port };
}
async function stopHttpServer(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise(resolveTimeout => { timer = setTimeout(resolveTimeout, 5000); });
  await Promise.race([exited, timeout]);
  clearTimeout(timer!);
  if (child.exitCode === null && child.signalCode === null) {
    const stopped = once(child, 'exit');
    child.kill('SIGKILL');
    await stopped;
  }
}
async function post(origin: string, route: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(origin + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() as any };
}
async function writeFixture(directory: string, state: any) {
  await writeFile(join(directory, 'shared-state.json'), JSON.stringify(state));
}
async function tempState() { return mkdtemp(join(tmpdir(), 'buildmanage-a4-invariants-')); }

test('public command endpoint recovers a committed result after server reload without duplicating it', async () => {
  const directory = await tempState();
  let child: ChildProcess | undefined;
  try {
    const state = fixture();
    await writeFixture(directory, state);
    let server = await startHttpServer(directory);
    child = server.child;
    const login = await post(server.origin, '/api/auth/login', { identifier: 'owner-a@a4.invalid', password });
    assert.equal(login.status, 200, JSON.stringify(login.data));
    const headers = { Authorization: 'Bearer ' + login.data.token };
    const command = {
      operation: 'addAnnouncement',
      args: ['building-a', { title: 'Committed announcement', content: 'Persisted through restart', priority: 'normal' }],
      operationId: 'a4:reload-after-commit:20261029',
    };
    const committed = await post(server.origin, '/api/commands', command, headers);
    assert.equal(committed.status, 200, JSON.stringify(committed.data));
    assert.equal(committed.data.ok, true);
    await stopHttpServer(child);
    child = undefined;

    server = await startHttpServer(directory);
    child = server.child;
    const recovery = await post(server.origin, '/api/operations/status', { operationId: command.operationId }, headers);
    assert.equal(recovery.status, 200, JSON.stringify(recovery.data));
    assert.equal(recovery.data.status, 'completed');
    const replay = await post(server.origin, '/api/commands', command, headers);
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    assert.equal(replay.data.ok, true);
    const saved = JSON.parse(await readFile(join(directory, 'shared-state.json'), 'utf8'));
    assert.equal(saved.syndik_prod_syndics_v1[0].buildings[0].announcements.length, 1);
    assert.ok(saved.__operations['owner-a:' + command.operationId]);
  } finally {
    await stopHttpServer(child);
    await rm(directory, { recursive: true, force: true });
  }
});

test('public scheduler endpoint commits successful buildings when one period is closed', async () => {
  const directory = await tempState();
  let child: ChildProcess | undefined;
  try {
    const state: any = fixture();
    const cabinet = state.syndik_prod_syndics_v1[0];
    const buildingB = state.syndik_prod_syndics_v1[1].buildings[0];
    buildingB.syndicId = 'cab-a';
    buildingB.residents[0].syndicId = 'cab-a';
    cabinet.buildings.push(buildingB, building('building-c', 'cab-a', 'resident-c'));
    state.syndik_prod_syndics_v1.pop();
    cabinet.buildings.forEach((row: any) => {
      row.monthlySyndicFees = 135.25;
      row.totalTantiemes = 1000;
      row.reserveFundRate = 7.5;
      row.residents[0].buildingId = row.id;
      row.residents[0].syndicId = 'cab-a';
      row.apartments[0].buildingId = row.id;
      row.apartments[0].tantiemes = 1000;
      row.apartments[0].monthlyFees = 135.25;
      row.financials = { balance: 0, reserveFundBalance: 0, transactions: [],
        openingWorkingBalance: 0, openingReserveBalance: 0, openingBalancesRecordedAt: '2026-01-01T00:00:00.000Z' };
    });
    state.__closedPeriods = { ['building-b:' + month]: { reason: 'closed for A4 test', actorUid: 'owner-a' } };
    await writeFixture(directory, state);
    const server = await startHttpServer(directory);
    child = server.child;
    const result = await post(server.origin, '/api/jobs/monthly-charges', { period: month }, {
      'X-Syndik-Scheduler': 'a4-scheduler-secret-012345678901234567890',
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.ok, false);
    assert.equal(result.data.total, 3);
    assert.equal(result.data.succeeded, 2);
    assert.equal(result.data.failed, 1);
    const saved = JSON.parse(await readFile(join(directory, 'shared-state.json'), 'utf8'));
    const periodCharges = saved.syndik_prod_charges_v1.filter((charge: any) => charge.periodKey === month);
    assert.deepEqual(periodCharges.map((charge: any) => charge.buildingId).sort(), ['building-a', 'building-c']);
    assert.equal(saved.__billingRuns.at(-1).results.find((entry: any) => entry.buildingId === 'building-b').status, 'failed');
  } finally {
    await stopHttpServer(child);
    await rm(directory, { recursive: true, force: true });
  }
});
