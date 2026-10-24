import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as money from '../utils/security';

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
const building = () => read(K.SYNDICS)[0].buildings[0];
function reset(rate: Record<string, number> = { reserveFundRate: 5, reserveFundPercentage: 5 }) {
  values.clear();
  write(K.SYNDICS, [{ id: 'rate-s', name: 'Rate cabinet', createdBy: 'rate-owner',
    subscriptionPlan: 'starter', subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01', buildings: [{
      id: 'rate-b', syndicId: 'rate-s', name: 'Rate building', address: 'Synthetic address', city: 'Casablanca',
      monthlySyndicFees: 100, ...rate,
      apartments: [{ id: 'rate-lot', buildingId: 'rate-b', number: '1', floor: 1, area: 80,
        ownerId: 'rate-resident', tenantId: null, monthlyFees: 100, tantiemes: 1000 }],
      residents: [{ id: 'rate-resident', name: 'Rate resident', email: 'resident@rate.invalid', phone: '0600000000',
        isOwner: true, apartmentId: 'rate-lot', hasAccount: true }], documents: [], announcements: [],
      financials: { balance: 0, reserveFundBalance: 0, transactions: [], openingWorkingBalance: 0,
        openingReserveBalance: 0, openingBalancesRecordedAt: '2026-01-01T00:00:00.000Z' },
    }] }]);
  for (const key of [K.QUITTANCES, K.PROOFS, K.INVOICES, K.CHARGES]) write(key, []);
}
function charge(id: string, amount = 100) {
  const value = { id, syndicId: 'rate-s', buildingId: 'rate-b', residentId: 'rate-resident',
    apartmentId: 'rate-lot', amount, paidAmount: 0, status: 'unpaid', period: '2026-10', dueDate: '2026-10-05' };
  write(K.CHARGES, [...read(K.CHARGES), value]);
  return value;
}
function receiptInput(id: string, amount = 100) {
  return { chargeId: id, syndicId: 'rate-s', syndicName: 'Rate cabinet', buildingId: 'rate-b', buildingName: 'Rate building',
    residentId: 'rate-resident', residentName: 'Rate resident', apartmentId: 'rate-lot', apartmentNumber: '1', amount,
    paymentId: `payment-${id}`, paymentDate: new Date().toISOString(), paymentMethod: 'virement' as const,
    periodCovered: '2026-10', referenceNumber: `reference-${id}` };
}
const fund = (paymentId: string, name: string) => building().financials.transactions
  .filter((entry: any) => entry.paymentId === paymentId && entry.fundType === name)
  .reduce((sum: number, entry: any) => sum + Math.round(entry.amount * 100), 0) / 100;

await test('5% to 20% edit allocates 20 MAD of the next 100 MAD payment to reserve', async () => {
  reset(); charge('edited');
  await svc.updateBuilding('rate-b', { reserveFundRate: 20 });
  const receipt = await svc.createQuittance(receiptInput('edited'));
  assert.equal(receipt.reserveFundAmount, 20);
  assert.equal(receipt.chargesCourantesAmount, 80);
  assert.equal(building().financials.reserveFundBalance, 20);
  assert.equal(fund('payment-edited', 'reserve'), 20);
});
await test('editing a rate preserves historical 5% ledger rows and issued receipts byte for byte', async () => {
  reset(); charge('old'); charge('new');
  const old = await svc.createQuittance(receiptInput('old'));
  const historical = structuredClone({ receipt: old, financials: building().financials });
  await svc.updateBuilding('rate-b', { reserveFundRate: 20 });
  assert.deepEqual(building().financials, historical.financials);
  assert.deepEqual(read(K.QUITTANCES).find((q: any) => q.id === old.id), historical.receipt);
  await svc.createQuittance(receiptInput('new'));
  assert.equal(fund('payment-old', 'reserve'), 5);
  assert.equal(fund('payment-new', 'reserve'), 20);
  for (const row of historical.financials.transactions) {
    assert.deepEqual(building().financials.transactions.find((t: any) => t.id === row.id), row);
  }
});
await test('new payment rows and receipts retain the applied rate independently of later edits', async () => {
  reset(); charge('snapshot');
  const receipt = await svc.createQuittance(receiptInput('snapshot'));
  assert.equal((receipt as any).reserveRateApplied, 5);
  for (const row of building().financials.transactions) assert.equal(row.reserveRateApplied, 5);
  await svc.updateBuilding('rate-b', { reserveFundRate: 20 });
  assert.deepEqual(await svc.createQuittance(receiptInput('snapshot')), receipt);
});
await test('7.5% of 135 MAD reserves 10.13 MAD and retains exactly 124.87 MAD operating', async () => {
  reset(); charge('fractional', 135);
  await svc.updateBuilding('rate-b', { reserveFundRate: 7.5 });
  const receipt = await svc.createQuittance(receiptInput('fractional', 135));
  assert.equal(receipt.reserveFundAmount, 10.13);
  assert.equal(receipt.chargesCourantesAmount, 124.87);
  assert.equal(Math.round(receipt.reserveFundAmount! * 100) + Math.round(receipt.chargesCourantesAmount! * 100), 13500);
  assert.equal((receipt as any).reserveRateApplied, 7.5);
});
for (const rate of [0, 100]) await test(`${rate}% is respected rather than falling back to the legacy 5% alias`, async () => {
  reset(); charge(`boundary-${rate}`);
  await svc.updateBuilding('rate-b', { reserveFundRate: rate });
  const receipt = await svc.createQuittance(receiptInput(`boundary-${rate}`));
  assert.equal(receipt.reserveFundAmount, rate);
  assert.equal(receipt.chargesCourantesAmount, 100 - rate);
});
for (const rate of [-0.01, 100.01, NaN, Infinity]) await test(`invalid rate ${rate} is rejected without changing stored data`, async () => {
  reset(); const before = [...values.entries()];
  await assert.rejects(() => svc.updateBuilding('rate-b', { reserveFundRate: rate }));
  assert.deepEqual([...values.entries()], before);
});
await test('new buildings store the canonical rate only and accept percentage-only legacy create input', async () => {
  reset();
  const created = await svc.addBuilding('rate-s', { name: 'Legacy create', address: 'Synthetic address', city: 'Casablanca',
    monthlySyndicFees: 100, reserveFundPercentage: 7.5 });
  assert.equal(created.reserveFundRate, 7.5);
  assert.equal(Object.hasOwn(created, 'reserveFundPercentage'), false);
});
await test('canonical and legacy create inputs reject null, strings and out-of-range rates atomically', async () => {
  for (const field of ['reserveFundRate', 'reserveFundPercentage']) for (const rate of [null, '20', -1, 101]) {
    reset(); const before = [...values.entries()];
    await assert.rejects(() => svc.addBuilding('rate-s', { name: 'Invalid create', address: 'Synthetic address',
      city: 'Casablanca', monthlySyndicFees: 100, [field]: rate } as any));
    assert.deepEqual([...values.entries()], before);
  }
});
await test('canonical read precedence handles conflicting fields, percentage-only records and explicit zero', () => {
  const resolve = (money as any).getBuildingReserveRate;
  assert.equal(resolve({ reserveFundRate: 20, reserveFundPercentage: 5 }), 20);
  assert.equal(resolve({ reserveFundPercentage: 7.5 }), 7.5);
  assert.equal(resolve({ reserveFundRate: 0, reserveFundPercentage: 5 }), 0);
  assert.equal(resolve({}), 5);
});
await test('recovery of a missing old receipt uses its posted 5% amounts after a 20% edit', async () => {
  reset(); charge('recovery');
  const old = await svc.createQuittance(receiptInput('recovery'));
  await svc.updateBuilding('rate-b', { reserveFundRate: 20 });
  write(K.QUITTANCES, []);
  const before = structuredClone(building().financials);
  const recovered = await svc.generateQuittanceForCharge('recovery');
  assert.equal(recovered.reserveFundAmount, old.reserveFundAmount);
  assert.equal(recovered.chargesCourantesAmount, old.chargesCourantesAmount);
  assert.equal((recovered as any).reserveRateApplied, 5);
  assert.deepEqual(building().financials, before);
});
await test('receipt recovery for mixed historical rates preserves 25 MAD reserve, not today’s 40 MAD', async () => {
  reset(); charge('mixed', 200);
  const old = await svc.createQuittance({ ...receiptInput('mixed'), amount: 100, paymentId: 'mixed-old' });
  await svc.updateBuilding('rate-b', { reserveFundRate: 20 });
  const newer = await svc.createQuittance({ ...receiptInput('mixed'), amount: 100, paymentId: 'mixed-new' });
  write(K.QUITTANCES, []);
  // C4 recovers the original receipt for each payment, rather than minting an aggregate receipt.
  const recovered = await Promise.all([old, newer].map(receipt => svc.createQuittance({ ...receipt, addTransactionToLedger: false })));
  assert.deepEqual(recovered, [old, newer]);
  assert.equal(recovered.reduce((sum, receipt) => sum + receipt.reserveFundAmount!, 0), 25);
  assert.equal(recovered.reduce((sum, receipt) => sum + receipt.chargesCourantesAmount!, 0), 175);
  assert.deepEqual(recovered.map(receipt => receipt.reserveRateApplied), [5, 20]);
});
await test('legacy ledger rows without a rate snapshot retain their original known MAD allocation', async () => {
  reset(); charge('legacy-ledger');
  const old = await svc.createQuittance(receiptInput('legacy-ledger'));
  const cabinets = read(K.SYNDICS);
  for (const row of cabinets[0].buildings[0].financials.transactions) {
    delete row.reserveRateApplied; delete row.receiptSnapshots;
  }
  write(K.SYNDICS, cabinets); write(K.QUITTANCES, [{ ...old, reserveRateApplied: undefined }]);
  await svc.updateBuilding('rate-b', { reserveFundRate: 20 });
  const recovered = await svc.generateQuittanceForCharge('legacy-ledger');
  assert.equal(recovered.reserveFundAmount, 5);
  assert.equal((recovered as any).reserveRateApplied, undefined);
});
await test('undocumented historical receipts never borrow the current building rate', async () => {
  reset({ reserveFundRate: 20 }); const old = charge('unknown'); old.paidAmount = 100; old.status = 'paid'; write(K.CHARGES, [old]);
  const before = structuredClone(building().financials);
  // C4 requires reconciliation before numbering an undocumented historical payment.
  await assert.rejects(() => svc.generateQuittanceForCharge(old.id), /original introuvable/);
  assert.deepEqual(building().financials, before);
  assert.deepEqual(read(K.QUITTANCES), []);
  assert.equal((money as any).getRecordedReserveSplit({ amount: 100 }), undefined);
});
await test('receipt display uses recorded MAD or its own applied rate; never a building rate', () => {
  const recorded = (money as any).getRecordedReserveSplit;
  assert.equal(recorded({ amount: 135, reserveRateApplied: 7.5 }).reserveFundAmount, 10.13);
  assert.equal(recorded({ amount: 100, reserveFundAmount: 5, chargesCourantesAmount: 95, reserveRateApplied: 20 }).reserveFundAmount, 5);
  assert.equal(recorded({ amount: 100 }), undefined);
});
await test('historical report reserve totals use the recorded 5/20 MAD allocations, not a current percentage', () => {
  const total = (money as any).getRecordedReserveTotal;
  assert.equal(total([{ amount: 100, reserveFundAmount: 5, chargesCourantesAmount: 95 },
    { amount: 100, reserveFundAmount: 20, chargesCourantesAmount: 80 }], 200), 25);
});
await test('historical report totals remain unknown when allocation or payment coverage is undocumented', () => {
  const total = (money as any).getRecordedReserveTotal;
  assert.equal(total([{ amount: 100 }], 100), undefined);
  assert.equal(total([], 100), undefined);
  assert.equal(total([], 0), 0);
});
await test('invoice payments and approved payment proofs use the same canonical rate snapshot', async () => {
  reset(); charge('invoice');
  const invoice = await svc.createInvoiceForResident('rate-resident', 'rate-b', 'rate-s');
  await svc.updateBuilding('rate-b', { reserveFundRate: 20 });
  await svc.recordPayment(invoice, 100, 'virement', 'invoice-rate');
  assert.equal(fund('invoice-rate', 'reserve'), 20);
  for (const row of building().financials.transactions) assert.equal(row.reserveRateApplied, 20);
  charge('proof');
  const proof = await svc.submitPaymentProof({ ...receiptInput('proof'), residentName: 'Rate resident', bankName: 'Synthetic bank' });
  const approved = await svc.reviewPaymentProof(proof.id, 'approved');
  assert.equal(approved.quittance?.reserveFundAmount, 20);
});

reset();
const apiCabinets = read(K.SYNDICS);
apiCabinets[0].buildings.push(
  { ...structuredClone(building()), id: 'rate-conflict', reserveFundRate: 20, reserveFundPercentage: 5 },
  { ...structuredClone(building()), id: 'rate-legacy', reserveFundRate: undefined, reserveFundPercentage: 7.5 },
);
const directory = mkdtempSync(join(tmpdir(), 'buildmanage-reserve-rate-'));
const stateFile = join(directory, 'shared-state.json');
const password = 'Synthetic-Rate-Password-42!';
const profile = { uid: 'rate-owner', email: 'manager@rate.invalid', displayName: 'Rate manager',
  role: 'syndic', syndicId: 'rate-s', emailVerified: true };
writeFileSync(stateFile, JSON.stringify({
  syndik_prod_syndics_v1: apiCabinets,
  syndik_prod_registered_users_v1: [{ uid: profile.uid, email: profile.email, profile,
    passwordHash: money.hashPasswordSync(password, profile.email) }],
}));
const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port; await new Promise<void>(resolve => listener.close(() => resolve()));
const child = spawn(process.execPath, ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', 'server.ts'], {
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', SYNDIK_AUTH_PROVIDER: 'legacy',
    SYNDIK_STATE_BACKEND: 'file', SYNDIK_DATA_DIR: directory, SYNDIK_SERVER_SECRET: 'synthetic-reserve-rate-secret-12345678901234567890',
    GEMINI_API_KEY: '', API_KEY: '', SENDGRID_API_KEY: '', FIREBASE_AUTH_EMULATOR_HOST: '' }, stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(child, 'exit'); let logs = '';
child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
const timeout = setTimeout(() => child.kill(), 90000);
const disk = () => JSON.parse(readFileSync(stateFile, 'utf8'));
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
  const login = await call('/api/auth/login', undefined, { identifier: profile.email, password });
  assert.equal(login.status, 200); const token = login.data.token;
  await test('API read projects canonical precedence and percentage-only legacy rates without writing records', async () => {
    const before = structuredClone(disk().syndik_prod_syndics_v1);
    const response = await call('/api/shared-state', token);
    assert.equal(response.status, 200);
    const buildings = response.data.store.syndik_prod_syndics_v1[0].buildings;
    for (const [id, rate] of [['rate-conflict', 20], ['rate-legacy', 7.5]]) {
      const b = buildings.find((item: any) => item.id === id);
      assert.equal(b.reserveFundRate, rate);
      assert.equal(Object.hasOwn(b, 'reserveFundPercentage'), false);
    }
    assert.deepEqual(disk().syndik_prod_syndics_v1, before);
  });
  await test('API rejects out-of-range reserve rates before mutating building or ledger', async () => {
    for (const rate of [-1, 101]) {
      const before = disk().syndik_prod_syndics_v1;
      const result = await command(token, 'updateBuilding', ['rate-b', { reserveFundRate: rate }]);
      assert.equal(result.status, 400, JSON.stringify(result.data));
      assert.deepEqual(disk().syndik_prod_syndics_v1, before);
    }
  });
  await test('API edit normalizes the building rate without changing historical financial state', async () => {
    const before = structuredClone(disk().syndik_prod_syndics_v1[0].buildings[0].financials);
    const updated = await command(token, 'updateBuilding', ['rate-b', { reserveFundRate: 20 }]);
    assert.equal(updated.status, 200, JSON.stringify(updated.data));
    const b = updated.data.result;
    assert.equal(b.reserveFundRate, 20); assert.equal(Object.hasOwn(b, 'reserveFundPercentage'), false);
    assert.deepEqual(disk().syndik_prod_syndics_v1[0].buildings[0].financials, before);
  });
  await test('API create validates canonical and legacy rate inputs consistently', async () => {
    for (const field of ['reserveFundRate', 'reserveFundPercentage']) for (const rate of [null, '20', -1, 101]) {
      const before = structuredClone(disk().syndik_prod_syndics_v1);
      const result = await command(token, 'addBuilding', ['rate-s', { name: 'Invalid API create', address: 'Synthetic address',
        city: 'Casablanca', monthlySyndicFees: 100, [field]: rate }]);
      assert.equal(result.status, 400, JSON.stringify(result.data));
      assert.deepEqual(disk().syndik_prod_syndics_v1, before);
    }
  });
} finally { clearTimeout(timeout); child.kill(); await exited; rmSync(directory, { recursive: true, force: true }); }
