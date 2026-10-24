import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Building } from '../types';
import { computeBuildingFinancialBalances, computeBuildingFundBalances, hashPasswordSync } from '../utils/security';

function assertBalances(financials: Record<string, unknown>, working: number, reserve: number) {
  const building = { financials } as unknown as Building;
  const before = structuredClone(building);
  const expected = { workingBalance: working, operatingBalance: working, reserveBalance: reserve };
  assert.deepEqual(computeBuildingFinancialBalances(building), expected);
  assert.deepEqual(computeBuildingFundBalances(building), expected);
  assert.deepEqual(building, before, 'Selectors must not migrate persisted fields or change ledger entries');
}

const payment = [
  { id: 'income-working', type: 'income', fundType: 'courant', amount: 95 },
  { id: 'income-reserve', type: 'income', fundType: 'reserve', amount: 5 },
];
const transfers = [
  ...payment,
  { id: 'expense-signed', type: 'expense', fundType: 'working', amount: -10.01 },
  { id: 'transfer-out', type: 'expense', fundType: 'operating', amount: 25.05 },
  { id: 'transfer-in', type: 'income', fundType: 'reserve', amount: 25.05 },
  { id: 'legacy-signed', fundType: 'courant', amount: -0.02 },
  { id: 'reserve-expense', type: 'expense', fundType: 'reserve', amount: -0.01 },
];
const cases: [string, Record<string, unknown>, number, number][] = [
  ['500 MAD opening reserve with zero transactions is counted exactly once', {
    balance: 1000, reserveFundBalance: 500, openingWorkingBalance: 1000,
    openingReserveBalance: 500, transactions: [],
  }, 1000, 500],
  ['legacy openingBalance alias with zero transactions matches the canonical model', {
    balance: 1000, reserveFundBalance: 500, openingBalance: 1000,
    openingReserveBalance: 500, transactions: [],
  }, 1000, 500],
  ['explicit openings work without stored aggregate caches', {
    openingWorkingBalance: 1000.01, openingReserveBalance: 500.02, transactions: [],
  }, 1000.01, 500.02],
  ['canonical zero is authoritative rather than falling back to stale caches', {
    balance: 9999, reserveFundBalance: 8888, openingWorkingBalance: 0,
    openingReserveBalance: 0, transactions: payment,
  }, 95, 5],
  ['legacy zero alias is also an explicit value', {
    balance: 9999, reserveFundBalance: 8888, openingBalance: 0,
    openingReserveBalance: 0, transactions: payment,
  }, 95, 5],
  ['canonical working opening wins over a conflicting deprecated alias', {
    balance: 1095, reserveFundBalance: 505, openingWorkingBalance: 1000,
    openingBalance: 9999, openingReserveBalance: 500, transactions: payment,
  }, 1095, 505],
  ['null canonical opening falls back to the legacy alias', {
    balance: 1000, reserveFundBalance: 500, openingWorkingBalance: null,
    openingBalance: 1000, openingReserveBalance: 500, transactions: [],
  }, 1000, 500],
  ['aggregate-only legacy zero-transaction balances remain unchanged', {
    balance: 1000.01, reserveFundBalance: 500.02, transactions: [],
  }, 1000.01, 500.02],
  ['aggregate-only legacy balances infer openings without replaying income twice', {
    balance: 1095.01, reserveFundBalance: 505.02, transactions: payment,
  }, 1095.01, 505.02],
  ['legacy alias preserves signed expenses and paired reserve transfers to the centime', {
    balance: 1059.93, reserveFundBalance: 530.06, openingBalance: 1000.01,
    openingReserveBalance: 500.02, transactions: transfers,
  }, 1059.93, 530.06],
  ['canonical fields preserve transfers even when aggregate caches are absent', {
    openingWorkingBalance: 1000.01, openingReserveBalance: 500.02, transactions: transfers,
  }, 1059.93, 530.06],
  ['aggregate-only legacy transfers preserve both stored fund totals', {
    balance: 1059.93, reserveFundBalance: 530.06, transactions: transfers,
  }, 1059.93, 530.06],
  ['ledger-only legacy records use zero openings when no aggregate cache exists', {
    transactions: payment,
  }, 95, 5],
  ['negative openings preserve deficits instead of taking absolute values', {
    balance: -12.34, reserveFundBalance: -0.01, openingWorkingBalance: -12.34,
    openingReserveBalance: -0.01, transactions: [],
  }, -12.34, -0.01],
  ['many centime entries are summed as integer centimes', {
    openingWorkingBalance: 0.1, openingReserveBalance: 500.02,
    transactions: Array.from({ length: 1000 }, (_, index) => ({
      id: `centime-${index}`, type: 'income', fundType: 'courant', amount: 0.01,
    })),
  }, 10.1, 500.02],
];
for (const [name, financials, working, reserve] of cases) {
  await test(name, () => assertBalances(financials, working, reserve));
}
await test('missing building remains a zero-balance read', () => {
  assert.deepEqual(computeBuildingFinancialBalances(null), { workingBalance: 0, operatingBalance: 0, reserveBalance: 0 });
});

const directory = mkdtempSync(join(tmpdir(), 'buildmanage-opening-balances-'));
const file = join(directory, 'shared-state.json');
const password = 'Synthetic-Opening-Password-42!';
const owner = {
  uid: 'opening-owner', email: 'manager@opening.invalid', role: 'syndic',
  displayName: 'Opening manager', syndicId: 's-opening', emailVerified: true,
};
const resident = {
  id: 'r-opening', name: 'Opening resident', email: 'resident@opening.invalid', phone: '0600000000',
  isOwner: true, hasAccount: true, apartmentId: 'lot-opening', mustChangePassword: false,
};
const residentProfile = {
  uid: 'user-res-r-opening', email: resident.email, role: 'resident', displayName: resident.name,
  syndicId: 's-opening', buildingId: 'b-opening', residentId: resident.id, emailVerified: true,
};
const building = (id: string, financials: Record<string, unknown>) => ({
  id, syndicId: owner.syndicId, name: id, address: 'Synthetic address', city: 'Casablanca',
  monthlySyndicFees: 100, totalTantiemes: 1000, reserveFundRate: 5, reserveFundPercentage: 5,
  residents: id === 'b-opening' ? [resident] : [],
  apartments: id === 'b-opening' ? [{
    id: 'lot-opening', number: '1', buildingId: id, ownerId: resident.id, tenantId: null,
    floor: 1, area: 80, monthlyFees: 100, tantiemes: 1000,
  }] : [],
  documents: [], announcements: [], financials,
});
const legacyFinancials = {
  balance: 1059.93, reserveFundBalance: 530.06,
  openingBalance: 1000.01, openingReserveBalance: 500.02, transactions: structuredClone(transfers),
};
writeFileSync(file, JSON.stringify({
  syndik_prod_registered_users_v1: [owner, residentProfile].map(profile => ({
    uid: profile.uid, email: profile.email, passwordHash: hashPasswordSync(password, profile.email), profile,
  })),
  syndik_prod_syndics_v1: [{
    id: owner.syndicId, name: 'Opening cabinet', createdBy: owner.uid, subscriptionPlan: 'starter',
    subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01', buildings: [
      building('b-opening', { balance: 0, reserveFundBalance: 0, transactions: [] }),
      building('b-legacy', legacyFinancials),
    ],
  }],
}));
const listener = createServer();
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = (listener.address() as { port: number }).port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const child = spawn(process.execPath, ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', 'server.ts'], {
  env: {
    ...process.env, PORT: String(port), NODE_ENV: 'test', SYNDIK_AUTH_PROVIDER: 'legacy',
    SYNDIK_STATE_BACKEND: 'file', SYNDIK_DATA_DIR: directory,
    SYNDIK_SERVER_SECRET: 'synthetic-opening-secret-12345678901234567890',
    GEMINI_API_KEY: '', API_KEY: '', SENDGRID_API_KEY: '', FIREBASE_AUTH_EMULATOR_HOST: '',
  }, stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(child, 'exit');
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
const timeout = setTimeout(() => child.kill(), 90000);
const disk = () => JSON.parse(readFileSync(file, 'utf8'));
const storedBuilding = (id = 'b-opening') => disk().syndik_prod_syndics_v1[0].buildings.find((b: any) => b.id === id);
async function call(route: string, token?: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() as any };
}
const command = (token: string, operation: string, args: unknown[]) =>
  call('/api/commands', token, { operation, args, operationId: crypto.randomUUID() });

try {
  for (let attempt = 0; attempt < 200 && !logs.includes('Server running'); attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(logs.includes('Server running'), logs);
  const login = async (email: string) => {
    const response = await call('/api/auth/login', undefined, { identifier: email, password });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.data.token as string;
  };
  const token = await login(owner.email), residentToken = await login(resident.email);
  await test('API: recording 500 MAD reserve before any transaction displays 500, never 1000', async () => {
    const result = await command(token, 'setOpeningBalances', ['b-opening', {
      working: 1000, reserve: 500, reason: 'Verified opening balances',
    }]);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.result.openingWorkingBalance, 1000);
    assert.equal(result.data.result.openingReserveBalance, 500);
    assert.equal(storedBuilding().financials.transactions.length, 0);
    assertBalances(result.data.result, 1000, 500);
  });
  await test('API: initial 100 MAD charge payment adds 95 working and 5 reserve exactly once', async () => {
    const billing = await command(token, 'generateMonthlyCharges', ['b-opening', owner.syndicId, new Date().toISOString().slice(0, 7)]);
    assert.equal(billing.status, 200, JSON.stringify(billing.data));
    const invoice = disk().syndik_prod_invoices_v1[0];
    const paid = await command(token, 'recordPayment', [invoice, 100, 'virement', 'opening-payment-100']);
    assert.equal(paid.status, 200, JSON.stringify(paid.data));
    assertBalances(storedBuilding().financials, 1095, 505);
    assert.equal(storedBuilding().financials.balance, 1095);
    assert.equal(storedBuilding().financials.reserveFundBalance, 505);
  });
  await test('API: payment reversal returns exactly to 1000/500 and preserves original ledger entries', async () => {
    const original = structuredClone(storedBuilding().financials.transactions);
    const reversed = await command(token, 'reversePayment', ['b-opening', 'opening-payment-100', 'Synthetic annulment']);
    assert.equal(reversed.status, 200, JSON.stringify(reversed.data));
    const current = storedBuilding().financials;
    assert.equal(current.transactions.length, 4);
    for (const entry of original) assert.deepEqual(current.transactions.find((t: any) => t.id === entry.id), entry);
    assert.equal(current.transactions.filter((t: any) => t.reversalOf === 'opening-payment-100').length, 2);
    assert.equal(disk().syndik_prod_charges_v1[0].paidAmount, 0);
    assert.equal(disk().syndik_prod_invoices_v1[0].paidAmount, 0);
    assertBalances(current, 1000, 500);
  });
  await test('API: legacy read is non-mutating and confirmed alias normalization preserves centimes and transfers', async () => {
    const before = storedBuilding('b-legacy').financials;
    const read = await call('/api/shared-state', token);
    assert.equal(read.status, 200);
    const legacy = read.data.store.syndik_prod_syndics_v1[0].buildings.find((b: any) => b.id === 'b-legacy');
    assertBalances(legacy.financials, 1059.93, 530.06);
    assert.deepEqual(storedBuilding('b-legacy').financials, before);
    const normalized = await command(token, 'setOpeningBalances', ['b-legacy', {
      working: 1000.01, reserve: 500.02, reason: 'Confirm existing legacy openings without changing history',
    }]);
    assert.equal(normalized.status, 200, JSON.stringify(normalized.data));
    const current = storedBuilding('b-legacy').financials;
    assert.deepEqual(current.transactions, before.transactions);
    assert.equal(current.balance, before.balance);
    assert.equal(current.reserveFundBalance, before.reserveFundBalance);
    assert.equal(current.openingWorkingBalance, 1000.01);
    assert.equal(current.openingReserveBalance, 500.02);
    assert.equal(Object.hasOwn(current, 'openingBalance'), false, 'The deprecated write alias must not remain a competing opening');
    assertBalances(current, 1059.93, 530.06);
  });
  await test('API: confirmed openings stay frozen and residents cannot change them', async () => {
    const before = storedBuilding().financials;
    const duplicate = await command(token, 'setOpeningBalances', ['b-opening', { working: 0, reserve: 0, reason: 'Denied overwrite' }]);
    assert.equal(duplicate.status, 409);
    const denied = await command(residentToken, 'setOpeningBalances', ['b-opening', { working: 0, reserve: 0, reason: 'Denied resident edit' }]);
    assert.equal(denied.status, 403);
    const secondReversal = await command(token, 'reversePayment', ['b-opening', 'opening-payment-100', 'Denied duplicate reversal']);
    assert.equal(secondReversal.status, 409);
    assert.deepEqual(storedBuilding().financials, before);
  });
} finally {
  clearTimeout(timeout);
  child.kill();
  await exited;
  rmSync(directory, { recursive: true, force: true });
}
