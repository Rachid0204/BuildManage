import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_LEGAL_FRAMEWORK,
  LegalFrameworkUpdateSchema,
  resolveLegalFramework,
} from '../shared/legalFramework';
import { createCommandService } from '../server/domain/command.service';

const actor = { uid: 'owner-1', role: 'syndic', syndicId: 'cab-1' } as const;

function makeTestState() {
  const nextYear = new Date(Date.now() + 200 * 86_400_000).toISOString();
  return {
    syndik_prod_registered_users_v1: [
      {
        uid: 'owner-1',
        email: 'owner@test.ma',
        profile: { uid: 'owner-1', email: 'owner@test.ma', role: 'syndic', syndicId: 'cab-1', emailVerified: true },
      },
    ],
    syndik_prod_syndics_v1: [
      {
        id: 'cab-1',
        name: 'Cabinet Test',
        email: 'owner@test.ma',
        subscriptionPlan: 'enterprise',
        subscriptionStatus: 'active',
        subscriptionExpiry: nextYear,
        buildings: [
          {
            id: 'bld-existing',
            syndicId: 'cab-1',
            name: 'Résidence Existante',
            address: '10 Rue Atlas',
            city: 'Casablanca',
            totalTantiemes: 1000,
            reserveFundRate: 5,
            apartments: [
              { id: 'apt-1', number: 'A1', floor: 1, area: 80, ownerId: 'res-1', monthlyFees: 300, tantiemes: 60 },
              { id: 'apt-2', number: 'A2', floor: 1, area: 80, ownerId: 'res-2', monthlyFees: 300, tantiemes: 60 },
              { id: 'apt-3', number: 'A3', floor: 2, area: 80, ownerId: 'res-3', monthlyFees: 300, tantiemes: 60 },
              { id: 'apt-4', number: 'A4', floor: 3, area: 400, ownerId: 'res-4', monthlyFees: 900, tantiemes: 820 },
            ],
            residents: [
              { id: 'res-1', name: 'Owner One', email: 'r1@test.ma', isOwner: true, buildingId: 'bld-existing', syndicId: 'cab-1', apartmentId: 'apt-1' },
              { id: 'res-2', name: 'Owner Two', email: 'r2@test.ma', isOwner: true, buildingId: 'bld-existing', syndicId: 'cab-1', apartmentId: 'apt-2' },
              { id: 'res-3', name: 'Owner Three', email: 'r3@test.ma', isOwner: true, buildingId: 'bld-existing', syndicId: 'cab-1', apartmentId: 'apt-3' },
              { id: 'res-4', name: 'Owner Four', email: 'r4@test.ma', isOwner: true, buildingId: 'bld-existing', syndicId: 'cab-1', apartmentId: 'apt-4' },
            ],
            financials: {
              balance: 0,
              reserveFundBalance: 0,
              openingBalancesRecordedAt: '2026-01-01T00:00:00.000Z',
              transactions: [],
            },
            announcements: [],
            documents: [],
          },
        ],
      },
    ],
    syndik_prod_charges_v1: [
      {
        id: 'chg-1',
        syndicId: 'cab-1',
        buildingId: 'bld-existing',
        apartmentId: 'apt-1',
        residentId: 'res-1',
        period: '2026-05',
        dueDate: '2026-05-31T00:00:00.000Z',
        amount: 300,
        paidAmount: 0,
        status: 'pending',
        createdAt: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'chg-2',
        syndicId: 'cab-1',
        buildingId: 'bld-existing',
        apartmentId: 'apt-2',
        residentId: 'res-2',
        period: '2026-06',
        dueDate: '2026-06-30T00:00:00.000Z',
        amount: 300,
        paidAmount: 0,
        status: 'pending',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    syndik_prod_quittances_v1: [] as any[],
    syndik_prod_invoices_v1: [] as any[],
    syndik_prod_proofs_v1: [] as any[],
    syndik_prod_ag_v1: [] as any[],
    syndik_prod_audit_v1: [] as any[],
  };
}

test('resolveLegalFramework merges partial overrides safely and Zod schema rejects invalid bounds', () => {
  const defaults = resolveLegalFramework(undefined);
  assert.equal(defaults.rules.defaultReserveFundPercent, 5);
  assert.equal(defaults.rules.maxProxiesPerHolder, 3);
  assert.equal(defaults.rules.maxProxyTantiemesSharePercent, 10);
  assert.equal(defaults.rules.convocationNoticeDays, 15);
  assert.equal(defaults.rules.miseEnDemeureNoticeDays, 30);
  assert.ok(defaults.citations.statuteShortFr.includes('18-00'));

  const merged = resolveLegalFramework({
    effectiveDate: '2028-01-01',
    citations: { statuteShortFr: 'Loi n° 45-28 relative à la copropriété' },
    rules: { defaultReserveFundPercent: 10, maxProxiesPerHolder: 2 },
  });
  assert.equal(merged.citations.statuteShortFr, 'Loi n° 45-28 relative à la copropriété');
  assert.equal(merged.citations.statuteShortAr, DEFAULT_LEGAL_FRAMEWORK.citations.statuteShortAr);
  assert.equal(merged.rules.defaultReserveFundPercent, 10);
  assert.equal(merged.rules.maxProxiesPerHolder, 2);
  assert.equal(merged.rules.maxProxyTantiemesSharePercent, 10);

  // Reject out-of-bounds statutory thresholds
  assert.equal(
    LegalFrameworkUpdateSchema.safeParse({ rules: { maxProxiesPerHolder: 0 } }).success,
    false,
  );
  assert.equal(
    LegalFrameworkUpdateSchema.safeParse({ rules: { defaultReserveFundPercent: 85 } }).success,
    false,
  );
});

test('assembly.service enforces customized maxProxiesPerHolder and maxProxyTantiemesSharePercent dynamically', async () => {
  const state: any = makeTestState();
  state.__legalFrameworkConfig = {
    citations: { agProxyRefFr: 'Loi n° 45-28 (Art. 19)' },
    rules: {
      maxProxiesPerHolder: 2,
      maxProxyTantiemesSharePercent: 15, // 15% of 1000 = 150 tantiemes
    },
  };
  const cmd = createCommandService(state);

  const ag = await cmd.runOperation(
    actor,
    'createAssembleeGenerale',
    [
      {
        buildingId: 'bld-existing',
        title: 'AGO 2028',
        type: 'AGO',
        convocationNumber: 1,
        date: '2028-05-10',
        time: '18:00',
        location: 'Salon',
        resolutions: [{ title: 'Budget', majorityType: 'simple' }],
      },
    ],
    'op-ag-custom-1',
  );

  // Under default rules, 120 tantiemes (60 + 60) would have been rejected (> 10% = 100).
  // Under 15% cap, 2 proxies totaling 120 tantiemes are ACCEPTED!
  await cmd.runOperation(actor, 'updateAGAttendee', [ag.id, 'res-1', 'represented', 'Karim Mandataire'], 'op-p1');
  await cmd.runOperation(actor, 'updateAGAttendee', [ag.id, 'res-2', 'represented', 'Karim Mandataire'], 'op-p2');

  // 3rd proxy is REJECTED because maxProxiesPerHolder was lowered to 2, with the updated law reference in the error!
  await assert.rejects(
    cmd.runOperation(actor, 'updateAGAttendee', [ag.id, 'res-3', 'represented', 'Karim Mandataire'], 'op-p3'),
    /Loi n° 45-28 \(Art\. 19\).*2 procuration/i,
  );
});

test('prospective immutability: new buildings inherit updated defaultReserveFundPercent while existing buildings and issued quittances stay untouched', async () => {
  const state: any = makeTestState();
  const cmd = createCommandService(state);

  // 1. Issue a quittance BEFORE any law change
  const qBefore = await cmd.runOperation(
    actor,
    'createQuittance',
    [
      {
        chargeId: 'chg-1',
        buildingId: 'bld-existing',
        buildingName: 'Résidence Existante',
        syndicId: 'cab-1',
        syndicName: 'Cabinet Test',
        residentId: 'res-1',
        residentName: 'Owner One',
        apartmentId: 'apt-1',
        apartmentNumber: 'A1',
        amount: 300,
        periodCovered: '2026-05',
        paymentDate: '2026-05-10T10:00:00.000Z',
        paymentMethod: 'virement',
        bankName: 'Attijariwafa Bank',
        referenceNumber: 'VIR-BEFORE-LAW',
        addTransactionToLedger: true,
      },
    ],
    'op-quit-before',
  );
  assert.ok(qBefore.legalCitationFr?.includes('18-00'));
  assert.equal(qBefore.reserveFundAmount, 15); // 5% of 300

  // 2. Now amend the legal framework (new law + 10% default reserve fund for new buildings)
  state.__legalFrameworkConfig = {
    citations: {
      statuteShortFr: 'Loi n° 45-28 réformant la copropriété',
      statuteShortAr: 'القانون رقم 45-28 المتعلق بالملكية المشتركة',
    },
    rules: {
      defaultReserveFundPercent: 10,
    },
  };

  // 3. Existing building keeps its explicit 5% reserveFundRate; historical quittance keeps its original legalCitationFr
  const qAfterOnExistingBuilding = await cmd.runOperation(
    actor,
    'createQuittance',
    [
      {
        chargeId: 'chg-2',
        buildingId: 'bld-existing',
        buildingName: 'Résidence Existante',
        syndicId: 'cab-1',
        syndicName: 'Cabinet Test',
        residentId: 'res-2',
        residentName: 'Owner Two',
        apartmentId: 'apt-2',
        apartmentNumber: 'A2',
        amount: 300,
        periodCovered: '2026-06',
        paymentDate: '2026-06-10T10:00:00.000Z',
        paymentMethod: 'virement',
        bankName: 'Attijariwafa Bank',
        referenceNumber: 'VIR-AFTER-LAW',
        addTransactionToLedger: true,
      },
    ],
    'op-quit-after',
  );
  assert.equal(qAfterOnExistingBuilding.reserveFundAmount, 15, 'Existing building explicit 5% rate is preserved');
  assert.equal(qAfterOnExistingBuilding.legalCitationFr, 'Loi n° 45-28 réformant la copropriété');
  const savedOldQuit = state.syndik_prod_quittances_v1.find((q: any) => q.id === qBefore.id);
  assert.ok(savedOldQuit.legalCitationFr.includes('18-00'), 'Historical receipt citation was never rewritten');

  // 4. Newly created building omitting reserveFundRate inherits the new 10% statutory default!
  const newBld = await cmd.runOperation(
    actor,
    'addBuilding',
    [
      'cab-1',
      {
        name: 'Résidence Nouvelle Loi',
        address: '99 Bd Mohammed VI',
        city: 'Rabat',
        monthlySyndicFees: 300,
        totalTantiemes: 1000,
      },
    ],
    'op-add-new-bld',
  );
  assert.equal(newBld.reserveFundRate, 10);
});
