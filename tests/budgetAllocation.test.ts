import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocateBudgetInCentimes, centimes } from '../shared/domain/money';
import { createCommandService } from '../server/domain/command.service';

await test('largest remainder conserves every centime and preserves zero weights', () => {
  for (const budget of [0, .01, .03, 1.005, 1000, 9999.99]) {
    for (const weights of [[1, 1, 1], [0, 100, 200], [.125, .375, 1.5], [0, 0, 7]]) {
      const allocations = allocateBudgetInCentimes(budget, weights.map((tantiemes, i) => ({ id: String(i), tantiemes })), 1000);
      assert.equal([...allocations.values()].reduce((sum, value) => sum + centimes(value), 0), centimes(budget));
      weights.forEach((weight, i) => { if (weight === 0) assert.equal(allocations.get(String(i)), 0); });
    }
  }
});

await test('invalid budgets and weights fail explicitly, including empty and all-zero targets', () => {
  for (const budget of [NaN, Infinity, -1, Number.MAX_VALUE])
    assert.throws(() => allocateBudgetInCentimes(budget, [{ id: 'lot', tantiemes: 1 }]));
  for (const weights of [[], [0], [0, 0], [NaN, 1], [Infinity, 1], [-1, 2]])
    assert.throws(() => allocateBudgetInCentimes(1000, weights.map((tantiemes, i) => ({ id: String(i), tantiemes }))));
  assert.throws(() => allocateBudgetInCentimes(0, [{ id: 'lot', tantiemes: 0 }]), /strictement positive/);
  assert.throws(() => allocateBudgetInCentimes(10, [{ id: 'same', tantiemes: 1 }, { id: 'same', tantiemes: 1 }]));
});

const actor = { uid: 'owner', role: 'syndic', syndicId: 'cab' } as const;
function fixture(weights = [100, 100, 100]): any {
  return {
    syndik_prod_syndics_v1: [{ id: 'cab', createdBy: 'owner', subscriptionPlan: 'starter', subscriptionStatus: 'active', subscriptionExpiry: '2099-01-01', buildings: [{
      id: 'building', syndicId: 'cab', name: 'Building', address: 'Street', city: 'Tanger',
      apartments: weights.map((tantiemes, i) => ({ id: `lot-${i}`, buildingId: 'building', number: String(i), ownerId: `resident-${i}`, tenantId: null, tantiemes, monthlyFees: 100 })),
      residents: weights.map((_, i) => ({ id: `resident-${i}`, buildingId: 'building', syndicId: 'cab', name: `Owner ${i}`, email: `owner${i}@example.test`, isOwner: true })),
      financials: { balance: 0, reserveFundBalance: 0, transactions: [] },
    }] }],
    syndik_prod_charges_v1: [],
    syndik_prod_ag_v1: [{ id: 'ag', buildingId: 'building', syndicId: 'cab', title: 'Meeting', date: '2026-10-01', status: 'completed', resolutions: [{ id: 'resolution', number: 1, title: 'Works', status: 'approved', budgetAmount: 1000 }] }],
  };
}
const building = (state: any) => state.syndik_prod_syndics_v1[0].buildings[0];
async function generate(state: any, assembly: boolean, budget = 1000) {
  return createCommandService(state).runOperation(actor,
    assembly ? 'generateChargesFromAGResolution' : 'generateMonthlyCharges',
    assembly ? ['ag', 'resolution'] : ['building', 'cab', '2026-10', { totalBudgetToSplit: budget }], 'c3-budget');
}
for (const assembly of [false, true]) {
  const label = assembly ? 'assembly' : 'monthly';
  await test(`${label} conserves budget across multiple lots and idempotent retries`, async () => {
    const state = fixture();
    await generate(state, assembly);
    assert.equal(state.syndik_prod_charges_v1.reduce((sum: number, c: any) => sum + centimes(c.amount), 0), 100000);
    const before = structuredClone(state.syndik_prod_charges_v1);
    await generate(state, assembly);
    assert.deepEqual(state.syndik_prod_charges_v1, before);
  });
  await test(`${label} preserves a zero-weight unassigned lot without losing money`, async () => {
    const state = fixture([0, 100, 200]);
    building(state).apartments[0].ownerId = null;
    await generate(state, assembly);
    assert.equal(state.syndik_prod_charges_v1.reduce((sum: number, c: any) => sum + centimes(c.amount), 0), 100000);
    assert.ok(state.syndik_prod_charges_v1.every((c: any) => c.apartmentId !== 'lot-0'));
  });
  await test(`${label} rejects unresolved positive-weight payers without any mutation`, async () => {
    for (const broken of ['unassigned', 'dangling', 'archived', 'foreign']) {
      const state = fixture([100, 100]);
      if (broken === 'unassigned') building(state).apartments[1].ownerId = null;
      if (broken === 'dangling') building(state).apartments[1].ownerId = 'missing';
      if (broken === 'archived') building(state).residents[1].archivedAt = '2026-01-01';
      if (broken === 'foreign') building(state).residents[1].syndicId = 'other';
      const before = structuredClone(state);
      await assert.rejects(generate(state, assembly), /Payeur actif introuvable/);
      assert.deepEqual(state, before);
    }
  });
  await test(`${label} rejects all-zero weights without mutation`, async () => {
    const state = fixture([0, 0]);
    const before = structuredClone(state);
    await assert.rejects(generate(state, assembly), /strictement positive/);
    assert.deepEqual(state, before);
  });
  await test(`${label} completes compatible partial billing without duplicating existing charges`, async () => {
    const state = fixture();
    await generate(state, assembly);
    const retained = structuredClone(state.syndik_prod_charges_v1[0]);
    state.syndik_prod_charges_v1 = [retained];
    await generate(state, assembly);
    assert.equal(state.syndik_prod_charges_v1.length, 3);
    assert.deepEqual(state.syndik_prod_charges_v1.find((c: any) => c.id === retained.id), retained);
    assert.equal(state.syndik_prod_charges_v1.reduce((sum: number, c: any) => sum + centimes(c.amount), 0), 100000);
  });
  await test(`${label} excludes archived lots consistently from allocation and posting`, async () => {
    const state = fixture();
    building(state).apartments[0].archivedAt = '2026-01-01';
    building(state).apartments[0].ownerId = null;
    await generate(state, assembly);
    assert.equal(state.syndik_prod_charges_v1.length, 2);
    assert.ok(state.syndik_prod_charges_v1.every((c: any) => c.amount === 500));
  });
  await test(`${label} rejects conflicting partial billing instead of undercharging`, async () => {
    const state = fixture();
    await generate(state, assembly);
    state.syndik_prod_charges_v1 = state.syndik_prod_charges_v1.slice(0, 1);
    state.syndik_prod_charges_v1[0].amount = 1;
    const before = structuredClone(state);
    await assert.rejects(generate(state, assembly), /incompatible/);
    assert.deepEqual(state, before);
  });
}
