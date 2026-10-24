import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashPasswordSync } from '../utils/security';
import { generateQuittancePDF } from '../services/pdfService';
import type { Quittance } from '../types';

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
const snapshot = () => JSON.stringify([...values.entries()]);
function reset(amount = 100) {
  values.clear();
  write(K.SYNDICS, [{ id: 'receipt-s', name: 'Receipt cabinet', createdBy: 'receipt-owner',
    subscriptionPlan: 'starter', subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01', buildings: [{
      id: 'receipt-b', syndicId: 'receipt-s', name: 'Receipt building', address: 'Synthetic address', city: 'Casablanca',
      monthlySyndicFees: 100, reserveFundRate: 5,
      apartments: [{ id: 'receipt-lot', buildingId: 'receipt-b', number: '1', floor: 1, area: 80,
        ownerId: 'receipt-resident', tenantId: null, monthlyFees: 100, tantiemes: 1000 }],
      residents: [{ id: 'receipt-resident', name: 'Receipt resident', email: 'resident@receipt.invalid', phone: '0600000000',
        isOwner: true, apartmentId: 'receipt-lot', hasAccount: true }], documents: [], announcements: [],
      financials: { balance: 0, reserveFundBalance: 0, transactions: [], openingWorkingBalance: 0,
        openingReserveBalance: 0, openingBalancesRecordedAt: '2026-01-01T00:00:00.000Z' },
    }] }]);
  for (const key of [K.QUITTANCES, K.PROOFS, K.INVOICES]) write(key, []);
  write(K.CHARGES, [{ id: 'receipt-charge', syndicId: 'receipt-s', buildingId: 'receipt-b', residentId: 'receipt-resident',
    apartmentId: 'receipt-lot', amount, paidAmount: 0, status: 'unpaid', period: '2026-10', dueDate: '2026-10-05' }]);
}
const input = (amount = 100, paymentId = 'real-payment') => ({
  chargeId: 'receipt-charge', syndicId: 'receipt-s', syndicName: 'Receipt cabinet', buildingId: 'receipt-b', buildingName: 'Receipt building',
  residentId: 'receipt-resident', residentName: 'Receipt resident', apartmentId: 'receipt-lot', apartmentNumber: '1', amount,
  paymentId, paymentDate: '2026-10-23', paymentMethod: 'virement' as const, periodCovered: '2026-10', referenceNumber: paymentId,
});
async function denied(fn: () => Promise<unknown>) {
  const before = snapshot(); await assert.rejects(fn); assert.equal(snapshot(), before, 'A rejected receipt must not change any persisted record');
}
async function originalOrRejected(fn: () => Promise<Quittance>, original: Quittance) {
  try { assert.deepEqual(await fn(), original); } catch (error) { if (error instanceof assert.AssertionError) throw error; }
}

await test('three 100 MAD document-only requests cannot turn one payment into 300 MAD of official receipts', async () => {
  reset(); const original = await svc.createQuittance(input());
  for (const id of ['invented-copy-1', 'invented-copy-2']) {
    await originalOrRejected(() => svc.createQuittance({ ...input(100, id), addTransactionToLedger: false }), original);
  }
  assert.equal(read(K.QUITTANCES).length, 1);
  assert.equal(read(K.QUITTANCES).reduce((n: number, q: Quittance) => n + Math.round(q.amount * 100), 0), 10000);
});
await test('partial document-only reissues cannot spend an already-receipted allocation again', async () => {
  reset(); await svc.createQuittance(input());
  for (const amount of [40, 60, 100]) await denied(() => svc.createQuittance({ ...input(amount, `fake-${amount}`), addTransactionToLedger: false }));
});
await test('paidAmount alone is not evidence of a confirmed payment or permission to number a receipt', async () => {
  reset(); const charges = read(K.CHARGES); charges[0].paidAmount = 100; charges[0].status = 'paid'; write(K.CHARGES, charges);
  await denied(() => svc.createQuittance({ ...input(), addTransactionToLedger: false }));
});
await test('disabled posting cannot mint an official number for a legacy unreceipted journal payment', async () => {
  reset(); const original = await svc.createQuittance(input());
  write(K.QUITTANCES, []);
  const cabinets = read(K.SYNDICS);
  for (const row of cabinets[0].buildings[0].financials.transactions) delete row.receiptSnapshots;
  write(K.SYNDICS, cabinets);
  await denied(() => svc.createQuittance({ ...input(), quittanceNumber: original.quittanceNumber + '-NEW', addTransactionToLedger: false }));
});
await test('a normal retry and read-only redownload return the exact original canonical number', async () => {
  reset(); const original = await svc.createQuittance(input()); const before = snapshot();
  assert.deepEqual(await svc.createQuittance(input()), original);
  assert.deepEqual(await svc.createQuittance({ ...input(), quittanceNumber: 'CLIENT-RENUMBER', addTransactionToLedger: false }), original);
  assert.deepEqual(await svc.generateQuittanceForCharge('receipt-charge'), original);
  assert.equal(snapshot(), before);
});
await test('missing receipt recovery restores the original number and snapshot without minting or posting', async () => {
  reset(); const original = await svc.createQuittance(input());
  const financials = structuredClone(building().financials);
  write(K.QUITTANCES, []);
  assert.deepEqual(await svc.generateQuittanceForCharge('receipt-charge'), original);
  assert.deepEqual(building().financials, financials);
  assert.deepEqual(read(K.QUITTANCES), [original]);
});
await test('new receipt numbers are server-owned even when the request supplies one', async () => {
  reset(); await denied(() => svc.createQuittance({ ...input(), quittanceNumber: 'FAKE-OFFICIAL-001' }));
});
await test('two real partial payments have separate canonical receipts and conserve the paid total', async () => {
  reset(); const first = await svc.createQuittance(input(40, 'first'));
  const second = await svc.createQuittance(input(60, 'second'));
  assert.notEqual(first.quittanceNumber, second.quittanceNumber);
  assert.equal(read(K.QUITTANCES).reduce((sum: number, q: Quittance) => sum + Math.round(q.amount * 100), 0), 10000);
  await denied(() => svc.createQuittance({ ...input(1, 'extra'), addTransactionToLedger: false }));
});
await test('invoice confirmation creates one canonical receipt for each verified charge allocation', async () => {
  reset(60); const charges = read(K.CHARGES);
  charges.push({ ...charges[0], id: 'receipt-charge-2', amount: 40, period: '2026-11' }); write(K.CHARGES, charges);
  const invoice = await svc.createInvoiceForResident('receipt-resident', 'receipt-b', 'receipt-s');
  await svc.recordPayment(invoice, 100, 'virement', 'invoice-confirmed');
  const receipts: Quittance[] = read(K.QUITTANCES);
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map(q => q.amount).sort((a, b) => a - b), [40, 60]);
  assert.equal(receipts.reduce((sum, q) => sum + Math.round(q.reserveFundAmount! * 100), 0), 500);
  assert.equal(new Set(receipts.map(q => q.quittanceNumber)).size, 2);
  assert.equal(receipts.every(q => q.paymentId === 'invoice-confirmed'), true);
  const before = snapshot(); await svc.recordPayment(invoice, 100, 'virement', 'invoice-confirmed'); assert.equal(snapshot(), before);
});
await test('existing legacy receipts retain their original number and unchanged PDF structure', async () => {
  reset(); const original: Quittance = { ...input(), id: 'legacy-receipt', quittanceNumber: 'QUIT-2024-00731',
    createdAt: '2024-03-01T10:00:00.000Z', reserveFundAmount: 5, chargesCourantesAmount: 95 };
  write(K.QUITTANCES, [original]);
  const before = generateQuittancePDF(original, building(), undefined, undefined, undefined, { autoDownload: false });
  const result = await svc.createQuittance({ ...input(), addTransactionToLedger: false });
  const after = generateQuittancePDF(result, building(), undefined, undefined, undefined, { autoDownload: false });
  assert.deepEqual(result, original); assert.equal(before.fileName, after.fileName);
  assert.deepEqual((before.doc.internal as any).pages, (after.doc.internal as any).pages);
  assert.equal(Math.round(before.doc.internal.pageSize.getWidth()), 210);
  assert.match(after.fileName, /QUIT-2024-00731/);
});

await test('inflated paidAmount cannot fund receipts beyond confirmed journal allocations', async () => {
  reset(200); const original = await svc.createQuittance(input());
  const charges = read(K.CHARGES); charges[0].paidAmount = 150; write(K.CHARGES, charges);
  write(K.QUITTANCES, [original, { ...original, id: 'unverified-legacy', paymentId: 'not-posted',
    quittanceNumber: 'LEGACY-EXTRA', amount: 50 }]);
  await denied(() => svc.createQuittance(input(50, 'next-real-payment')));
});
await test('ambiguous unlinked legacy receipts block allocating the same old payment again', async () => {
  reset(200); const first = await svc.createQuittance(input(100, 'first'));
  await svc.createQuittance(input(100, 'second'));
  write(K.QUITTANCES, [{ ...first, id: 'unlinked-legacy', paymentId: undefined, quittanceNumber: 'LEGACY-100' }]);
  await denied(() => svc.createQuittance({ ...input(100, 'first'), addTransactionToLedger: false }));
});
await test('posting mode must be a boolean, not a truthy string that silently posts a payment', async () => {
  reset(); await denied(() => svc.createQuittance({ ...input(), addTransactionToLedger: 'false' as any }));
});
await test('a receipt number retained only in a journal snapshot is never reused for a later payment', async () => {
  reset(200); const first = await svc.createQuittance(input(100, 'first'));
  write(K.QUITTANCES, []);
  const second = await svc.createQuittance(input(100, 'second'));
  assert.notEqual(first.quittanceNumber, second.quittanceNumber);
  const recovered = await svc.createQuittance({ ...input(100, 'first'), addTransactionToLedger: false });
  assert.deepEqual(recovered, first);
  assert.equal(read(K.QUITTANCES).reduce((sum: number, q: Quittance) => sum + q.amount, 0), 200);
});
await test('fractional invoice allocations conserve the exact recorded reserve centimes across receipts', async () => {
  reset(67.5); await svc.updateBuilding('receipt-b', { reserveFundRate: 7.5 });
  const charges = read(K.CHARGES); charges.push({ ...charges[0], id: 'second-charge', period: '2026-11' }); write(K.CHARGES, charges);
  const invoice = await svc.createInvoiceForResident('receipt-resident', 'receipt-b', 'receipt-s');
  await svc.recordPayment(invoice, 135, 'virement', 'fractional-invoice');
  const receipts: Quittance[] = read(K.QUITTANCES);
  assert.equal(receipts.length, 2);
  assert.equal(receipts.reduce((sum, q) => sum + Math.round(q.reserveFundAmount! * 100), 0), 1013);
  assert.equal(receipts.reduce((sum, q) => sum + Math.round(q.chargesCourantesAmount! * 100), 0), 12487);
  assert.equal(building().financials.reserveFundBalance, 10.13);
  const before = structuredClone(building().financials); write(K.QUITTANCES, []);
  for (const receipt of receipts) assert.deepEqual(await svc.createQuittance({ ...receipt, addTransactionToLedger: false }), receipt);
  assert.deepEqual(building().financials, before);
});

await test('payment identities must be nonempty strings before any payment or number is created', async () => {
  for (const paymentId of ['', '   ', 42, {}, ['fake'], null]) {
    reset(); await denied(() => svc.createQuittance({ ...input(), paymentId: paymentId as any }));
  }
});

reset();
const directory = mkdtempSync(join(tmpdir(), 'buildmanage-quittance-integrity-'));
const stateFile = join(directory, 'shared-state.json');
const password = 'Synthetic-Receipt-Password-42!';
const profile = { uid: 'receipt-owner', email: 'manager@receipt.invalid', displayName: 'Receipt manager',
  role: 'syndic', syndicId: 'receipt-s', emailVerified: true };
writeFileSync(stateFile, JSON.stringify({
  syndik_prod_syndics_v1: read(K.SYNDICS), syndik_prod_charges_v1: read(K.CHARGES),
  syndik_prod_registered_users_v1: [{ uid: profile.uid, email: profile.email, profile, passwordHash: hashPasswordSync(password, profile.email) }],
}));
const listener = createServer(); await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port; await new Promise<void>(resolve => listener.close(() => resolve()));
const child = spawn(process.execPath, ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', 'server.ts'], {
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test', SYNDIK_AUTH_PROVIDER: 'legacy',
    SYNDIK_STATE_BACKEND: 'file', SYNDIK_DATA_DIR: directory, SYNDIK_SERVER_SECRET: 'synthetic-receipt-secret-12345678901234567890123',
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
  const paid = await command(token, 'createQuittance', [input()]); assert.equal(paid.status, 200, JSON.stringify(paid.data));
  const original = paid.data.result;
  await test('API fresh operation IDs cannot manufacture new receipts with posting disabled', async () => {
    const results = await Promise.all(Array.from({ length: 3 }, (_, i) => command(token, 'createQuittance', [{
      ...input(100, `unposted-${i}`), addTransactionToLedger: false,
    }])));
    for (const result of results) if (result.status === 200) assert.deepEqual(result.data.result, original);
    const receipts = disk().syndik_prod_quittances_v1;
    assert.equal(receipts.length, 1); assert.equal(receipts.reduce((sum: number, q: Quittance) => sum + q.amount, 0), 100);
  });
  await test('API no-reference redownload never turns an operation ID into a payment reference', async () => {
    const payload = { ...input(), paymentId: undefined, referenceNumber: undefined, addTransactionToLedger: false };
    const before = structuredClone(disk().syndik_prod_syndics_v1);
    const response = await command(token, 'createQuittance', [payload]);
    if (response.status === 200) assert.deepEqual(response.data.result, original);
    assert.equal(disk().syndik_prod_quittances_v1.length, 1);
    assert.deepEqual(disk().syndik_prod_syndics_v1, before);
  });
  await test('API rejects a second or fractional unposted receipt after the payment is fully receipted', async () => {
    const before = structuredClone(disk().syndik_prod_quittances_v1);
    const response = await command(token, 'createQuittance', [{ ...input(50, 'fake-partial'), addTransactionToLedger: false }]);
    assert.equal(response.status, 400, JSON.stringify(response.data)); assert.deepEqual(disk().syndik_prod_quittances_v1, before);
  });
  await test('API rejects malformed explicit payment identities instead of replacing them with an operation ID', async () => {
    const generated = await command(token, 'generateMonthlyCharges', ['receipt-b', 'receipt-s', '2036-10', false]);
    assert.equal(generated.status, 200, JSON.stringify(generated.data));
    const charge = generated.data.result[0];
    for (const paymentId of ['', '   ', 42, {}, ['fake'], null]) {
      const before = structuredClone(disk().syndik_prod_syndics_v1);
      const response = await command(token, 'createQuittance', [{ ...input(), chargeId: charge.id, paymentId, periodCovered: charge.period }]);
      assert.equal(response.status, 400, JSON.stringify(response.data));
      assert.deepEqual(disk().syndik_prod_syndics_v1, before);
    }
  });
  await test('reversed payments cannot be resurrected from a saved receipt identity', async () => {
    const reversed = await command(token, 'reversePayment', ['receipt-b', 'real-payment', 'Synthetic reversal']);
    assert.equal(reversed.status, 200, JSON.stringify(reversed.data));
    const receipts = structuredClone(disk().syndik_prod_quittances_v1);
    const response = await command(token, 'createQuittance', [{ ...input(), addTransactionToLedger: false }]);
    assert.equal(response.status, 400); assert.deepEqual(disk().syndik_prod_quittances_v1, receipts);
  });
} finally { clearTimeout(timeout); child.kill(); await exited; rmSync(directory, { recursive: true, force: true }); }
