import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { allocateBudgetInCentimes, centimes } from '../shared/domain/money';
import { buildAnnualRepartitionSummary } from '../shared/annualRepartition';
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
    cases.push(weights.some(weight => weight > 0) ? weights : [1, ...weights.slice(1)]);
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
    proof: state.syndik_prod_proofs_v1.find((proof: any) => proof.id === 'proof-b'),
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
    proof: state.syndik_prod_proofs_v1.find((proof: any) => proof.id === 'proof-b'),
    building: state.syndik_prod_syndics_v1[1],
    receipts: state.syndik_prod_quittances_v1,
  });

  const reconciled = await commands.runOperation(actorA, 'reconcileBankStatementCSV', ['building-a', [
    { date: today, label: 'Lot 1 Resident building-a', amount: 100, reference: 'A4-OWN-ROW' },
  ], {}], 'a4-reconcile-own-building');
  assert.equal(reconciled.matchedCount, 1);
  assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 100);
  assert.equal(state.syndik_prod_charges_v1[1].paidAmount, 0);
  assert.equal(state.syndik_prod_proofs_v1.find((proof: any) => proof.id === 'proof-b').status, 'pending');
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
      SENDGRID_API_KEY: '', SENDGRID_FROM_EMAIL: '',
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
    state.syndik_prod_charges_v1 = [];
    const cabinet = state.syndik_prod_syndics_v1[0];
    cabinet.buildings[0].apartments = cabinet.buildings[0].apartments.slice(0, 1);
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

test('overdue status is preserved across partial payments, opening arrears, and reversals; reversal requires opening balances and logs negative balance', async () => {
  const state: any = fixture();
  const pastDue = '2025-01-10';
  state.syndik_prod_charges_v1[0].dueDate = pastDue;
  state.syndik_prod_charges_v1[0].status = 'overdue';
  const commands = service(state);

  // Partial payment via createQuittance on overdue charge preserves 'overdue' status
  const q1 = await commands.runOperation(actorA, 'createQuittance', [{
    chargeId: 'charge-a',
    buildingId: 'building-a',
    buildingName: 'Building building-a',
    syndicId: 'cab-a',
    syndicName: 'Cabinet cab-a',
    apartmentId: 'lot-building-a-1',
    apartmentNumber: '1',
    residentId: 'resident-a',
    residentName: 'Resident building-a',
    amount: 40,
    chargesCourantesAmount: 40,
    reserveFundAmount: 0,
    paymentMethod: 'virement',
    paymentDate: today,
    periodCovered: month,
    paymentId: 'pay-partial-1',
  }], 'inv-partial-1');
  assert.equal(state.syndik_prod_charges_v1[0].status, 'overdue');
  assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 40);

  // Second partial payment via createQuittance completes charge -> 'paid'
  await commands.runOperation(actorA, 'createQuittance', [{
    chargeId: 'charge-a',
    buildingId: 'building-a',
    buildingName: 'Building building-a',
    syndicId: 'cab-a',
    syndicName: 'Cabinet cab-a',
    apartmentId: 'lot-building-a-1',
    apartmentNumber: '1',
    residentId: 'resident-a',
    residentName: 'Resident building-a',
    amount: 60,
    chargesCourantesAmount: 60,
    reserveFundAmount: 0,
    paymentMethod: 'virement',
    paymentDate: today,
    periodCovered: month,
    paymentId: 'pay-partial-2',
  }], 'inv-partial-2');
  assert.equal(state.syndik_prod_charges_v1[0].status, 'paid');
  assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 100);

  // Spend 80 MAD so reversing 60 MAD pushes operating balance negative (-40 MAD: +40 +60 -80 -60)
  await commands.runOperation(actorA, 'addTransaction', ['building-a', {
    type: 'expense',
    fundType: 'courant',
    category: 'maintenance',
    description: 'Emergency repair',
    amount: 80,
    date: today,
    paymentMethod: 'virement',
    invoiceNumber: 'F-80',
    thirdPartyName: 'Prestataire Test',
  }], 'inv-expense-80');

  // Reversing second partial payment restores 'overdue' status, preserves paidAt (since 40 MAD remains paid), and audits resultingNegativeBalance
  await commands.runOperation(actorA, 'reversePayment', ['building-a', 'pay-partial-2', 'Chèque rejeté'], 'inv-rev-2');
  assert.equal(state.syndik_prod_charges_v1[0].status, 'overdue');
  assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 40);
  assert.ok(state.syndik_prod_charges_v1[0].paidAt, 'paidAt should be preserved when remaining paidAmount > 0');
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.balance, -40);
  const revAudit = state.syndik_prod_audit_v1.find((a: any) => a.operation === 'reversePayment');
  assert.equal(revAudit?.detail?.resultingNegativeBalance, true);
  assert.ok(q1.id);

  // importOpeningArrears for a past period creates charge directly as 'overdue'
  await commands.runOperation(actorA, 'importOpeningArrears', ['building-a', [{
    apartmentId: 'lot-building-a-2',
    residentId: 'resident-a',
    period: '2025-02',
    amount: 250,
    reason: 'Reprise historique 2025',
  }]], 'inv-opening-arrear');
  const arrear = state.syndik_prod_charges_v1.find((c: any) => c.id === 'opening:building-a:lot-building-a-2:2025-02');
  assert.equal(arrear?.status, 'overdue');

  // Reversal rejected if openingBalancesRecordedAt is missing
  const origOpening = state.syndik_prod_syndics_v1[0].buildings[0].financials.openingBalancesRecordedAt;
  delete state.syndik_prod_syndics_v1[0].buildings[0].financials.openingBalancesRecordedAt;
  await assert.rejects(
    commands.runOperation(actorA, 'reversePayment', ['building-a', 'pay-partial-1', 'Missing opening check'], 'inv-rev-no-opening'),
    /soldes initiaux|ouverture/i
  );
  state.syndik_prod_syndics_v1[0].buildings[0].financials.openingBalancesRecordedAt = origOpening;
});

test('submitPaymentProof rejects overlapping pending proofs exceeding remaining charge balance', async () => {
  const state: any = fixture();
  state.__files = {
    'proof-1.pdf': { uploadedBy: 'resident-a', buildingId: 'building-a' },
    'proof-2.pdf': { uploadedBy: 'resident-a', buildingId: 'building-a' },
  };
  const commands = service(state);
  const residentActor = {
    uid: 'resident-a',
    role: 'resident',
    syndicId: 'cab-a',
    buildingId: 'building-a',
    residentId: 'resident-a',
  } as const;
  state.syndik_prod_charges_v1[0].amount = 100;
  state.syndik_prod_charges_v1[0].paidAmount = 0;

  await commands.runOperation(residentActor, 'submitPaymentProof', [{
    chargeId: 'charge-a',
    buildingId: 'building-a',
    syndicId: 'cab-a',
    apartmentId: 'lot-building-a-1',
    apartmentNumber: '1',
    residentId: 'resident-a',
    residentName: 'Resident building-a',
    amount: 70,
    paymentMethod: 'virement',
    bankName: 'CIH Bank',
    referenceNumber: 'REF-PEND-1',
    bankTransactionDate: today,
    receiptUrl: '/api/uploads/proof-1.pdf',
  }], 'inv-proof-1');

  await assert.rejects(
    commands.runOperation(residentActor, 'submitPaymentProof', [{
      chargeId: 'charge-a',
      buildingId: 'building-a',
      syndicId: 'cab-a',
      apartmentId: 'lot-building-a-1',
      apartmentNumber: '1',
      residentId: 'resident-a',
      residentName: 'Resident building-a',
      amount: 40,
      paymentMethod: 'virement',
      bankName: 'CIH Bank',
      referenceNumber: 'REF-PEND-2',
      bankTransactionDate: today,
      receiptUrl: '/api/uploads/proof-2.pdf',
    }], 'inv-proof-2'),
    /justificatif|attente|solde|montant/i
  );
});

test('generateMonthlyCharges parses Arabic and English months and cleanly rejects invalid free-text periods', async () => {
  const state: any = fixture();
  state.syndik_prod_charges_v1 = [];
  const commands = service(state);

  const arabicGenerated = await commands.runOperation(
    actorA,
    'generateMonthlyCharges',
    ['building-a', 'cab-a', 'مارس 2027', {}],
    'inv-arabic-period'
  );
  assert.equal(arabicGenerated.length, 2);
  assert.equal(arabicGenerated[0].periodKey, '2027-03');
  assert.equal(arabicGenerated[0].dueDate, '2027-03-05');

  await assert.rejects(
    commands.runOperation(
      actorA,
      'generateMonthlyCharges',
      ['building-a', 'cab-a', 'Trimestre spécial été', {}],
      'inv-invalid-period'
    ),
    /période|AAAA-MM|Date comptable invalide/i
  );
});

test('generateChargesFromAGResolution enforces owner-only liability for capital works', async () => {
  const state: any = fixture();
  const b = state.syndik_prod_syndics_v1[0].buildings[0];
  b.residents.push({
    id: 'tenant-only',
    syndicId: 'cab-a',
    buildingId: 'building-a',
    apartmentId: 'lot-building-a-2',
    name: 'Locataire Lot 2',
    email: 'tenant@a4.invalid',
    phone: '0611111111',
    isOwner: false,
    hasAccount: false,
  });
  // Case 1: tenant-only lot (no ownerId) must be rejected so tenant is never billed for capital works
  b.apartments[1].ownerId = null;
  b.apartments[1].tenantId = 'tenant-only';
  state.syndik_prod_ag_v1 = [{
    id: 'ag-works-1',
    syndicId: 'cab-a',
    buildingId: 'building-a',
    title: 'AG Travaux Étanchéité',
    date: today,
    status: 'closed',
    resolutions: [{
      id: 'res-works-1',
      number: 1,
      title: 'Réfection étanchéité terrasse',
      description: 'Budget exceptionnel 2000 MAD',
      majorityRequired: 'three_quarters',
      status: 'approved',
      generatesCharges: true,
      budgetAmount: 2000,
    }],
  }];
  const commands = service(state);
  await assert.rejects(
    commands.runOperation(
      actorA,
      'generateChargesFromAGResolution',
      ['ag-works-1', 'res-works-1'],
      'inv-ag-tenant-only-reject'
    ),
    /copropriétaire|payeur|assigné/i
  );

  // Case 2: lot with both owner and tenant bills the owner, never the tenant
  b.apartments[1].ownerId = 'resident-a';
  const result = await commands.runOperation(
    actorA,
    'generateChargesFromAGResolution',
    ['ag-works-1', 'res-works-1'],
    'inv-ag-owner-only'
  );
  assert.equal(result.createdCharges.length, 2);
  assert.ok(result.createdCharges.every((c: any) => c.residentId === 'resident-a'), 'all capital-works charges must be billed to the owner, never the tenant');
});

test('reconcileBankStatementCSV supports invoice-number matching, multi-charge combined transfers, and structured unmatched rows', async () => {
  const state: any = fixture();
  state.syndik_prod_charges_v1 = [
    {
      id: 'c-lot1-jan', syndicId: 'cab-a', buildingId: 'building-a', apartmentId: 'lot-building-a-1',
      residentId: 'resident-a', period: '2026-01', periodKey: '2026-01', amount: 150, paidAmount: 0, status: 'overdue', dueDate: '2026-01-10',
    },
    {
      id: 'c-lot1-feb', syndicId: 'cab-a', buildingId: 'building-a', apartmentId: 'lot-building-a-1',
      residentId: 'resident-a', period: '2026-02', periodKey: '2026-02', amount: 150, paidAmount: 0, status: 'overdue', dueDate: '2026-02-10',
    },
    {
      id: 'c-lot2-mar', syndicId: 'cab-a', buildingId: 'building-a', apartmentId: 'lot-building-a-2',
      residentId: 'resident-a', period: '2026-03', periodKey: '2026-03', amount: 220, paidAmount: 0, status: 'unpaid', dueDate: today,
    },
  ];
  state.syndik_prod_invoices_v1 = [
    {
      id: 'inv-fac-99',
      syndicId: 'cab-a',
      buildingId: 'building-a',
      residentId: 'resident-a',
      invoiceNumber: 'FAC-2026-0099',
      totalAmount: 220,
      paidAmount: 0,
      status: 'unpaid',
      createdAt: today + 'T08:00:00.000Z',
      dueDate: today,
      chargeIds: ['c-lot2-mar'],
    },
  ];
  const commands = service(state);
  const res = await commands.runOperation(actorA, 'reconcileBankStatementCSV', ['building-a', [
    { date: today, label: 'VIR FAC-2026-0099', amount: 220, reference: 'CSV-INV-99' },
    { date: today, label: 'VIR Lot 1 Resident building-a (2 mois)', amount: 300, reference: 'CSV-MULTI-2M' },
    { date: today, label: 'VIR inconnu sans correspondance', amount: 777, reference: 'CSV-UNKNOWN' },
    { date: today, label: 'Frais tenue compte', amount: -50, reference: 'CSV-DEBIT' },
  ], {}], 'inv-csv-enhanced');

  assert.equal(res.matchedCount, 2);
  assert.equal(res.totalReconciledMad, 520);
  assert.equal(state.syndik_prod_invoices_v1[0].status, 'paid');
  assert.equal(state.syndik_prod_charges_v1.find((c: any) => c.id === 'c-lot1-jan').status, 'paid');
  assert.equal(state.syndik_prod_charges_v1.find((c: any) => c.id === 'c-lot1-feb').status, 'paid');
  assert.equal(state.syndik_prod_charges_v1.find((c: any) => c.id === 'c-lot2-mar').status, 'paid');
  assert.equal(res.unmatchedRows.length, 2);
  assert.equal(res.unmatchedRows.find((r: any) => r.reference === 'CSV-UNKNOWN')?.reason, 'no_match');
  assert.equal(res.unmatchedRows.find((r: any) => r.reference === 'CSV-DEBIT')?.reason, 'non_positive');
});

test('buildAnnualRepartitionSummary isolates fiscalYear, uses integer centimes, includes archived lots with activity, and respects totalTantiemes', () => {
  const b: any = building('b-rep', 'cab-a', 'res-1', true);
  b.totalTantiemes = 10000;
  b.apartments[0].tantiemes = 6000;
  b.apartments[1].tantiemes = 4000;
  b.apartments[1].archivedAt = '2026-06-01T00:00:00.000Z';

  const charges: any[] = [
    { id: 'c2026-1', buildingId: 'b-rep', apartmentId: 'lot-b-rep-1', residentId: 'res-1', period: '2026-01', periodKey: '2026-01', dueDate: '2026-01-10', amount: 100.1, paidAmount: 50.05, status: 'overdue' },
    { id: 'c2026-2', buildingId: 'b-rep', apartmentId: 'lot-b-rep-2', residentId: 'res-1', period: '2026-02', periodKey: '2026-02', dueDate: '2026-02-10', amount: 200.2, paidAmount: 200.2, status: 'paid' },
    { id: 'c2025-old', buildingId: 'b-rep', apartmentId: 'lot-b-rep-1', residentId: 'res-1', period: '2025-12', periodKey: '2025-12', dueDate: '2025-12-10', amount: 999, paidAmount: 0, status: 'overdue' },
  ];
  const quittances: any[] = [
    { id: 'q2026', buildingId: 'b-rep', apartmentId: 'lot-b-rep-1', residentId: 'res-1', amount: 50.05, paymentDate: '2026-01-15', createdAt: '2026-01-15', periodCovered: '2026-01', chargesCourantesAmount: 45.05, reserveFundAmount: 5 },
    { id: 'q2026-void', buildingId: 'b-rep', apartmentId: 'lot-b-rep-1', residentId: 'res-1', amount: 100, paymentDate: '2026-01-16', createdAt: '2026-01-16', periodCovered: '2026-01', voidedAt: '2026-01-20', chargesCourantesAmount: 90, reserveFundAmount: 10 },
    { id: 'q2025', buildingId: 'b-rep', apartmentId: 'lot-b-rep-1', residentId: 'res-1', amount: 300, paymentDate: '2025-11-15', createdAt: '2025-11-15', periodCovered: '2025-11', chargesCourantesAmount: 270, reserveFundAmount: 30 },
  ];

  const summary = buildAnnualRepartitionSummary(b, charges, quittances, 2026);
  assert.equal(summary.totalTantiemes, 10000);
  assert.equal(summary.rows.length, 2, 'archived lot with 2026 activity must remain in 2026 closing report');
  assert.equal(summary.totalCalledMad, 300.3);
  assert.equal(summary.totalPaidMad, 250.25);
  assert.equal(summary.totalRemainingMad, 50.05);
  assert.equal(summary.totalReserveMad, 5);
  assert.equal(summary.receiptCount, 1);
});

