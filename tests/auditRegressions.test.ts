import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FileRepository } from '../server/repository';
import { bindFirebaseAccount } from '../server/firebaseIdentity';
import { evaluateResolutionStatus } from '../shared/domain/voting';
import { applyResidentVote } from '../utils/agVoting';
import { createCommandService } from '../server/domain/command.service';
import { createSupportingService } from '../server/domain/supporting.service';
import { buildingReport } from '../server/reports';
import { generateScheduledMonthlyCharges } from '../server/operations';
import { escapeCSVCell, numberToFrenchWords, sanitizePdfText } from '../services/pdfService';
import {
  PLAN_CATALOG,
  PLANS,
  getEffectiveSubscriptionStatus,
  isUnlimitedPlan,
  subscriptionCanWrite,
} from '../utils/subscriptionPolicy';
import type { AGResolution, AssembleeGenerale } from '../types';

const actor = { uid: 'owner-1', role: 'syndic', syndicId: 'cab-1' } as const;

function baseState() {
  const fixed = '2026-01-15T10:00:00.000Z';
  return {
    syndik_prod_registered_users_v1: [
      {
        uid: 'owner-1',
        email: 'owner@test.ma',
        profile: { uid: 'owner-1', email: 'owner@test.ma', role: 'syndic', syndicId: 'cab-1', emailVerified: true },
      },
      {
        uid: 'user-res-res-1',
        email: 'res1@test.ma',
        passwordHash: 'keep-hash-1',
        profile: {
          uid: 'user-res-res-1',
          email: 'res1@test.ma',
          displayName: 'Resident 1',
          role: 'resident',
          syndicId: 'cab-1',
          buildingId: 'bld-1',
          residentId: 'res-1',
          phone: '0600000001',
          cin: 'AA111111',
          emailVerified: true,
        },
      },
      {
        uid: 'user-prest-prov-1',
        email: 'prov1@test.ma',
        passwordHash: 'keep-hash-p1',
        profile: {
          uid: 'user-prest-prov-1',
          email: 'prov1@test.ma',
          displayName: 'Prestataire 1',
          role: 'provider',
          syndicId: 'cab-1',
          buildingId: 'bld-1',
          prestataireId: 'prov-1',
          phone: '0600000002',
          prestataireCategory: 'Plomberie',
          providerCategory: 'Plomberie',
          emailVerified: true,
        },
      },
    ],
    syndik_prod_resident_accounts_v1: [
      {
        residentId: 'res-1',
        email: 'res1@test.ma',
        name: 'Resident 1',
        phone: '0600000001',
        cin: 'AA111111',
        isOwner: true,
        syndicId: 'cab-1',
        buildingId: 'bld-1',
        apartmentId: 'apt-1',
        passwordHash: 'keep-hash-1',
        mustChangePassword: false,
      },
    ],
    syndik_prod_prestataire_accounts_v1: [
      {
        prestataireId: 'prov-1',
        email: 'prov1@test.ma',
        name: 'Prestataire 1',
        contactPerson: 'Ali',
        category: 'Plomberie',
        syndicId: 'cab-1',
        buildingId: 'bld-1',
        passwordHash: 'keep-hash-p1',
        mustChangePassword: false,
      },
    ],
    syndik_prod_prestataires_v1: [
      {
        id: 'prov-1',
        syndicId: 'cab-1',
        buildingId: 'bld-1',
        name: 'Prestataire 1',
        contactPerson: 'Ali',
        category: 'Plomberie',
        phone: '0600000002',
        email: 'prov1@test.ma',
        hasAccount: true,
        mustChangePassword: false,
        active: true,
      },
    ],
    syndik_prod_syndics_v1: [
      {
        id: 'cab-1',
        name: 'Cabinet Test',
        createdBy: 'owner-1',
        subscriptionPlan: 'starter',
        subscriptionStatus: 'active',
        subscriptionExpiry: '2099-01-01',
        buildings: [
          {
            id: 'bld-1',
            syndicId: 'cab-1',
            name: 'Résidence Test',
            address: '10 Boulevard Test',
            city: 'Casablanca',
            monthlySyndicFees: 300,
            totalTantiemes: 1000,
            reserveFundRate: 0,
            apartments: [
              { id: 'apt-1', buildingId: 'bld-1', number: 'A1', floor: 1, area: 80, tantiemes: 600, ownerId: 'res-1', tenantId: null, monthlyFees: 300 },
              { id: 'apt-2', buildingId: 'bld-1', number: 'A2', floor: 1, area: 60, tantiemes: 400, ownerId: 'res-archived', tenantId: null, monthlyFees: 200 },
            ],
            residents: [
              {
                id: 'res-1',
                syndicId: 'cab-1',
                buildingId: 'bld-1',
                apartmentId: 'apt-1',
                name: 'Resident 1',
                email: 'res1@test.ma',
                phone: '0600000001',
                cin: 'AA111111',
                isOwner: true,
                hasAccount: true,
                mustChangePassword: false,
              },
              {
                id: 'res-archived',
                syndicId: 'cab-1',
                buildingId: 'bld-1',
                apartmentId: 'apt-2',
                name: 'Archived Resident',
                email: 'arch@test.ma',
                phone: '0600000099',
                isOwner: true,
                hasAccount: false,
                archivedAt: fixed,
              },
            ],
            documents: [],
            announcements: [],
            financials: {
              balance: 0,
              reserveFundBalance: 0,
              transactions: [],
              openingWorkingBalance: 0,
              openingReserveBalance: 0,
              openingBalancesRecordedAt: fixed,
            },
          },
        ],
      },
    ],
    syndik_prod_charges_v1: [],
    syndik_prod_invoices_v1: [],
    syndik_prod_quittances_v1: [],
    syndik_prod_proofs_v1: [],
    syndik_prod_notifications_v1: [],
    syndik_prod_audit_v1: [],
    __closedPeriods: {},
    __sessionVersions: {},
    __identityActions: {},
  } as any;
}

test('C1: bindFirebaseAccount with preserveCredentials=true keeps credentials, session versions, and identity actions intact', () => {
  const s1 = baseState();
  const target = s1.syndik_prod_registered_users_v1[1];
  target.password = 'legacy-secret';
  s1.__identityActions = { 'act-1': { email: 'res1@test.ma', kind: 'reset' } };
  const fbUser = { uid: 'fb-uid-1', email: 'res1@test.ma', emailVerified: true, disabled: false } as any;

  bindFirebaseAccount(s1, target, fbUser, true);

  assert.equal(target.firebaseUid, 'fb-uid-1');
  assert.equal(target.password, 'legacy-secret');
  assert.equal(target.passwordHash, 'keep-hash-1');
  assert.equal(s1.syndik_prod_resident_accounts_v1[0].passwordHash, 'keep-hash-1');
  assert.equal(s1.__sessionVersions['user-res-res-1'], undefined);
  assert.ok(s1.__identityActions['act-1'], 'identity actions must remain when preserveCredentials=true');

  // With preserveCredentials=false (default), credentials are wiped, session version increments, and email identityActions clear
  const s2 = baseState();
  const target2 = s2.syndik_prod_registered_users_v1[1];
  target2.password = 'legacy-secret';
  s2.__identityActions = {
    'act-1': { email: 'res1@test.ma', kind: 'reset' },
    'act-other': { email: 'other@test.ma', kind: 'reset' },
  };
  bindFirebaseAccount(s2, target2, fbUser, false);

  assert.equal(target2.firebaseUid, 'fb-uid-1');
  assert.equal(target2.password, undefined);
  assert.equal(target2.passwordHash, undefined);
  assert.equal(s2.syndik_prod_resident_accounts_v1[0].passwordHash, undefined);
  assert.equal(s2.__sessionVersions['user-res-res-1'], 1);
  assert.equal(s2.__identityActions['act-1'], undefined);
  assert.ok(s2.__identityActions['act-other']);
});

test('C5: evaluateResolutionStatus resolves unapproved/tied/no-quorum items to rejected when AG is completed or closed', () => {
  const baseAg = (status: AssembleeGenerale['status'], quorumReached = true): AssembleeGenerale => ({
    id: 'ag-1',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    title: 'AG Ordinaire',
    type: 'ordinaire',
    date: '2026-06-01',
    time: '10:00',
    location: 'Hall',
    status,
    quorumRequired: 501,
    presentTantiemes: quorumReached ? 600 : 200,
    quorumReached,
    totalTantiemes: 1000,
    attendees: [],
    resolutions: [],
    isVotingOpen: status === 'in_progress',
  });
  const res = (majorityType: AGResolution['majorityType'], votesFor: number, votesAgainst: number): AGResolution => ({
    id: 'r-1',
    number: 1,
    title: 'Résolution',
    description: 'Desc',
    majorityType,
    votesFor,
    votesAgainst,
    votesAbstain: 0,
    status: 'pending',
    voters: [],
  });

  // In-progress keeps unapproved resolutions as pending
  assert.equal(evaluateResolutionStatus(res('simple', 0, 0), baseAg('in_progress', true)), 'pending');
  assert.equal(evaluateResolutionStatus(res('simple', 300, 100), baseAg('in_progress', false)), 'pending');
  assert.equal(evaluateResolutionStatus(res('absolute', 400, 100), baseAg('in_progress', true)), 'pending');
  assert.equal(evaluateResolutionStatus(res('three_quarters', 600, 100), baseAg('in_progress', true)), 'pending');
  assert.equal(evaluateResolutionStatus(res('unanimity', 900, 0), baseAg('in_progress', true)), 'pending');

  // Completed / closed resolves unapproved/tied/no-quorum to rejected
  for (const closedStatus of ['completed', 'closed'] as const) {
    assert.equal(evaluateResolutionStatus(res('simple', 300, 100), baseAg(closedStatus, false)), 'rejected');
    assert.equal(evaluateResolutionStatus(res('simple', 200, 200), baseAg(closedStatus, true)), 'rejected');
    assert.equal(evaluateResolutionStatus(res('simple', 0, 0), baseAg(closedStatus, true)), 'rejected');
    assert.equal(evaluateResolutionStatus(res('absolute', 450, 100), baseAg(closedStatus, true)), 'rejected');
    assert.equal(evaluateResolutionStatus(res('three_quarters', 700, 50), baseAg(closedStatus, true)), 'rejected');
    assert.equal(evaluateResolutionStatus(res('unanimity', 900, 0), baseAg(closedStatus, true)), 'rejected');
    // Actually approved still returns approved
    assert.equal(evaluateResolutionStatus(res('simple', 350, 150), baseAg(closedStatus, true)), 'approved');
    assert.equal(evaluateResolutionStatus(res('absolute', 501, 100), baseAg(closedStatus, true)), 'approved');
  }
});

test('H7: assertPeriod rejects calendar-rollover dates and accepts valid leap day 2024-02-29', async () => {
  const state = baseState();
  state.syndik_prod_syndics_v1[0].buildings[0].financials.openingWorkingBalance = 100;
  state.syndik_prod_syndics_v1[0].buildings[0].financials.balance = 100;
  const cmd = createCommandService(state);

  for (const badDate of ['2026-02-31', '2026-04-31', '2026-13-01']) {
    await assert.rejects(
      cmd.runOperation(actor, 'addTransaction', ['bld-1', {
        description: 'Dépense test',
        amount: 50,
        type: 'expense',
        category: 'maintenance',
        fundType: 'courant',
        date: badDate,
      }], `op-bad-${badDate}`),
      /Date comptable invalide/i,
    );
  }

  const trx = await cmd.runOperation(actor, 'addTransaction', ['bld-1', {
    description: 'Dépense année bissextile',
    amount: 50,
    type: 'expense',
    category: 'maintenance',
    fundType: 'courant',
    date: '2024-02-29',
  }], 'op-leap-day');
  assert.equal(trx.date, '2024-02-29');
});

test('M3: createQuittance allows snapshot recovery in closed period while rejecting new ledger posting in closed period', async () => {
  const state = baseState();
  const closedDate = '2026-01-10';
  const charge = {
    id: 'chg-1',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    apartmentId: 'apt-1',
    residentId: 'res-1',
    amount: 300,
    paidAmount: 300,
    status: 'paid',
    period: '2026-01',
    periodKey: '2026-01',
    dueDate: '2026-01-05',
  };
  const canonicalReceipt = {
    id: 'quit-bld-1:pay-1:chg-1',
    quittanceNumber: 'QUIT-2026-00001',
    paymentId: 'pay-1',
    chargeId: 'chg-1',
    syndicId: 'cab-1',
    syndicName: 'Cabinet Test',
    buildingId: 'bld-1',
    buildingName: 'Résidence Test',
    residentId: 'res-1',
    residentName: 'Resident 1',
    apartmentId: 'apt-1',
    apartmentNumber: 'A1',
    amount: 300,
    periodCovered: '2026-01',
    paymentDate: closedDate,
    paymentMethod: 'virement',
    reserveRateApplied: 0,
    reserveFundAmount: 0,
    chargesCourantesAmount: 300,
    createdAt: '2026-01-10T12:00:00.000Z',
  };
  state.syndik_prod_charges_v1.push(charge);
  state.syndik_prod_syndics_v1[0].buildings[0].financials.balance = 300;
  state.syndik_prod_syndics_v1[0].buildings[0].financials.transactions.push({
    id: 'trx-pay-1-courant',
    paymentId: 'pay-1',
    sourceChargeId: 'chg-1',
    date: closedDate,
    description: 'Paiement lot A1',
    amount: 300,
    type: 'income',
    category: 'fees',
    fundType: 'courant',
    receiptSnapshots: [canonicalReceipt],
  });
  // Period is now closed and quittance document is missing from syndik_prod_quittances_v1
  state.__closedPeriods = { 'bld-1:2026-01': { closedAt: '2026-02-01T00:00:00.000Z' } };

  const cmd = createCommandService(state);

  // Ledger-posting createQuittance in closed period must be rejected
  await assert.rejects(
    cmd.runOperation(actor, 'createQuittance', [{
      buildingId: 'bld-1',
      syndicId: 'cab-1',
      chargeId: 'chg-1',
      residentId: 'res-1',
      residentName: 'Resident 1',
      apartmentId: 'apt-1',
      apartmentNumber: 'A1',
      buildingName: 'Résidence Test',
      syndicName: 'Cabinet Test',
      amount: 300,
      periodCovered: '2026-01',
      paymentDate: closedDate,
      paymentMethod: 'virement',
      addTransactionToLedger: true,
    }], 'op-closed-ledger'),
    /Période comptable clôturée/i,
  );

  // Snapshot recovery (addTransactionToLedger: false) succeeds even when period is closed
  const recovered = await cmd.runOperation(actor, 'createQuittance', [{
    buildingId: 'bld-1',
    syndicId: 'cab-1',
    chargeId: 'chg-1',
    residentId: 'res-1',
    residentName: 'Resident 1',
    apartmentId: 'apt-1',
    apartmentNumber: 'A1',
    buildingName: 'Résidence Test',
    syndicName: 'Cabinet Test',
    amount: 300,
    periodCovered: '2026-01',
    paymentDate: closedDate,
    paymentMethod: 'virement',
    paymentId: 'pay-1',
    addTransactionToLedger: false,
  }], 'op-recover-closed');

  assert.equal(recovered.quittanceNumber, 'QUIT-2026-00001');
  assert.equal(state.syndik_prod_quittances_v1.length, 1);
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.balance, 300);
});

test('M3: reversePayment cannot double-reverse or over-reverse a charge balance', async () => {
  const state = baseState();
  const openDate = new Date().toISOString().slice(0, 10);
  state.syndik_prod_charges_v1.push({
    id: 'chg-rev-1',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    apartmentId: 'apt-1',
    residentId: 'res-1',
    amount: 300,
    paidAmount: 0,
    status: 'unpaid',
    period: openDate.slice(0, 7),
    periodKey: openDate.slice(0, 7),
    dueDate: openDate,
  });

  const cmd = createCommandService(state);
  const receipt = await cmd.runOperation(actor, 'createQuittance', [{
    buildingId: 'bld-1',
    syndicId: 'cab-1',
    chargeId: 'chg-rev-1',
    residentId: 'res-1',
    residentName: 'Resident 1',
    apartmentId: 'apt-1',
    apartmentNumber: 'A1',
    buildingName: 'Résidence Test',
    syndicName: 'Cabinet Test',
    amount: 200,
    periodCovered: openDate.slice(0, 7),
    paymentDate: openDate,
    paymentMethod: 'virement',
    paymentId: 'pay-rev-1',
  }], 'op-create-for-rev');
  assert.equal(receipt.amount, 200);
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.balance, 200);

  // First reversal succeeds
  const ok = await cmd.runOperation(actor, 'reversePayment', ['bld-1', 'pay-rev-1', 'Chèque sans provision'], 'op-rev-1');
  assert.equal(ok, true);
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.balance, 0);
  assert.equal(state.syndik_prod_charges_v1[0].paidAmount, 0);
  assert.ok(state.syndik_prod_quittances_v1[0].voidedAt);

  // Second reversal (double-reverse) is rejected
  await assert.rejects(
    cmd.runOperation(actor, 'reversePayment', ['bld-1', 'pay-rev-1', 'Deuxième tentative'], 'op-rev-2'),
    /déjà contrepassé/i,
  );

  // Over-reversal (charge paidAmount less than transaction amount) is rejected
  const state2 = baseState();
  state2.syndik_prod_charges_v1.push({
    id: 'chg-over-1',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    apartmentId: 'apt-1',
    residentId: 'res-1',
    amount: 300,
    paidAmount: 50,
    status: 'unpaid',
    period: openDate.slice(0, 7),
    periodKey: openDate.slice(0, 7),
    dueDate: openDate,
  });
  state2.syndik_prod_syndics_v1[0].buildings[0].financials.balance = 200;
  state2.syndik_prod_syndics_v1[0].buildings[0].financials.transactions.push({
    id: 'trx-over-1',
    paymentId: 'pay-over-1',
    sourceChargeId: 'chg-over-1',
    date: openDate,
    description: 'Paiement incohérent',
    amount: 200,
    type: 'income',
    category: 'fees',
    fundType: 'courant',
  });
  await assert.rejects(
    createCommandService(state2).runOperation(actor, 'reversePayment', ['bld-1', 'pay-over-1', 'Test'], 'op-rev-over'),
    /Solde de charge incohérent/i,
  );
});

test('H8 & Reports: generateMonthlyCharges preserves periodName, skips archived residents, bills alongside opening_arrears, and over90Days subtracts paidAmount', async () => {
  const state = baseState();
  // Existing opening_arrears charge for 2026-11 on apt-1 must NOT block courante billing for 2026-11
  state.syndik_prod_charges_v1.push({
    id: 'opening:bld-1:apt-1:2026-11',
    buildingId: 'bld-1',
    syndicId: 'cab-1',
    apartmentId: 'apt-1',
    residentId: 'res-1',
    period: '2026-11',
    periodKey: '2026-11',
    amount: 500,
    paidAmount: 200,
    status: 'unpaid',
    dueDate: '2024-01-01',
    chargeType: 'opening_arrears',
    openingArrears: true,
  });

  const cmd = createCommandService(state);
  const created = await cmd.runOperation(actor, 'generateMonthlyCharges', ['bld-1', { periodName: '2026-11' }], 'op-gen-2026-11');

  assert.equal(created.length, 1, 'should only bill active resident apt-1 and ignore archived resident on apt-2');
  assert.equal(created[0].residentId, 'res-1');
  assert.equal(created[0].period, '2026-11');
  assert.equal(created[0].periodKey, '2026-11');
  assert.equal(created[0].chargeType, 'courante');
  assert.equal(created[0].amount, 300);

  // Verify buildingReport over90Days subtracts paidAmount on partially paid overdue charge
  const dir = await mkdtemp(join(tmpdir(), 'audit-reg-'));
  let report: any;
  try {
    await new FileRepository(dir).transaction(async (repoState) => {
      Object.assign(repoState, state);
      report = buildingReport(repoState, actor, 'bld-1');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const stmt = report.statements.find((s: any) => s.residentId === 'res-1');
  assert.ok(stmt);
  assert.equal(stmt.billed, 800);
  assert.equal(stmt.paid, 200);
  assert.equal(stmt.outstanding, 600);
  assert.equal(stmt.over90Days, 300, '500 overdue minus 200 paidAmount = 300 over90Days');
});

test('M2: updateResident and savePrestataire non-reinvite else branch propagates profile updates to registered_users', async () => {
  const state = baseState();
  const supporting = createSupportingService({
    state,
    actor,
    authenticatedUserRole: actor.role,
    cabinetId: 'cab-1',
    buildingId: 'bld-1',
  });

  await supporting.updateResident({
    id: 'res-1',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    apartmentId: 'apt-1',
    name: 'Resident Updated',
    email: 'res1@test.ma',
    phone: '0612345678',
    cin: 'BB999999',
    isOwner: true,
    hasAccount: true,
    mustChangePassword: false,
  });

  const regRes = state.syndik_prod_registered_users_v1.find((u: any) => u.uid === 'user-res-res-1');
  assert.equal(regRes.profile.displayName, 'Resident Updated');
  assert.equal(regRes.profile.phone, '0612345678');
  assert.equal(regRes.profile.cin, 'BB999999');
  assert.equal(state.syndik_prod_resident_accounts_v1[0].phone, '0612345678');
  assert.equal(state.syndik_prod_resident_accounts_v1[0].cin, 'BB999999');

  await supporting.savePrestataire({
    id: 'prov-1',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    name: 'Prestataire Updated',
    contactPerson: 'Karim',
    category: 'electrical',
    phone: '0698765432',
    email: 'prov1@test.ma',
    hasAccount: true,
    mustChangePassword: false,
    active: true,
    rating: 5,
  });

  const regProv = state.syndik_prod_registered_users_v1.find((u: any) => u.uid === 'user-prest-prov-1');
  assert.equal(regProv.profile.displayName, 'Prestataire Updated');
  assert.equal(regProv.profile.phone, '0698765432');
  assert.equal(regProv.profile.prestataireCategory, 'electrical');
  assert.equal(regProv.profile.providerCategory, 'electrical');
  assert.equal(state.syndik_prod_prestataire_accounts_v1[0].category, 'electrical');
  assert.equal(state.syndik_prod_prestataire_accounts_v1[0].contactPerson, 'Karim');
});

test('H17: numberToFrenchWords formats French numbers, millions, milliards, and centime rounding boundaries', () => {
  assert.equal(numberToFrenchWords(0), 'Zéro dirhams');
  assert.equal(numberToFrenchWords(80), 'Quatre-vingts dirhams');
  assert.equal(numberToFrenchWords(81), 'Quatre-vingt-un dirhams');
  assert.equal(numberToFrenchWords(180), 'Cent quatre-vingts dirhams');
  assert.equal(numberToFrenchWords(1.999), 'Deux dirhams');
  assert.equal(numberToFrenchWords(1_000_000), 'Un million dirhams');
  assert.equal(numberToFrenchWords(2_000_000), 'Deux millions dirhams');
  assert.equal(numberToFrenchWords(1_000_000_000), 'Un milliard dirhams');
  assert.equal(numberToFrenchWords(2_000_000_000), 'Deux milliards dirhams');
});

test('Rule #1 (worksFundTarget): AG extraordinary-works charges route payment splits per resolution', async () => {
  const state = baseState();
  const bld = state.syndik_prod_syndics_v1[0].buildings[0];
  bld.reserveFundRate = 20;
  bld.apartments[1].archivedAt = '2026-01-16T00:00:00.000Z';
  bld.apartments[0].tantiemes = 1000;
  const openMonth = new Date().toISOString().slice(0, 7);
  const openDate = `${openMonth}-10`;

  state.syndik_prod_ag_v1 = [
    {
      id: 'ag-works-1',
      syndicId: 'cab-1',
      buildingId: 'bld-1',
      title: 'AG Extraordinaire Travaux',
      type: 'extraordinaire',
      date: openDate,
      time: '18:00',
      location: 'Hall',
      status: 'completed',
      quorumRequired: 501,
      presentTantiemes: 1000,
      quorumReached: true,
      totalTantiemes: 1000,
      isVotingOpen: false,
      attendees: [
        { residentId: 'res-1', residentName: 'Resident 1', apartmentNumber: 'A1', tantiemes: 1000, status: 'present' },
      ],
      resolutions: [
        {
          id: 'res-courant',
          number: 1,
          title: 'Ravalement courant',
          description: 'Courant',
          majorityType: 'simple',
          votesFor: 1000,
          votesAgainst: 0,
          votesAbstain: 0,
          status: 'approved',
          voters: [],
          budgetAmount: 1000,
          generatesCharges: true,
          worksFundTarget: 'courant',
        },
        {
          id: 'res-reserve',
          number: 2,
          title: 'Étanchéité réserve',
          description: 'Réserve',
          majorityType: 'simple',
          votesFor: 1000,
          votesAgainst: 0,
          votesAbstain: 0,
          status: 'approved',
          voters: [],
          budgetAmount: 1000,
          generatesCharges: true,
          worksFundTarget: 'reserve',
        },
        {
          id: 'res-default',
          number: 3,
          title: 'Travaux taux immeuble',
          description: 'Défaut',
          majorityType: 'simple',
          votesFor: 1000,
          votesAgainst: 0,
          votesAbstain: 0,
          status: 'approved',
          voters: [],
          budgetAmount: 1000,
          generatesCharges: true,
          worksFundTarget: 'default',
        },
      ],
    },
  ];

  const cmd = createCommandService(state);
  await cmd.runOperation(actor, 'generateChargesFromAGResolution', ['ag-works-1', 'res-courant'], 'op-ag-courant');
  await cmd.runOperation(actor, 'generateChargesFromAGResolution', ['ag-works-1', 'res-reserve'], 'op-ag-reserve');
  await cmd.runOperation(actor, 'generateChargesFromAGResolution', ['ag-works-1', 'res-default'], 'op-ag-default');

  const chgCourant = state.syndik_prod_charges_v1.find((c: any) => c.id === 'chg-ag-ag-works-1-res-courant-apt-1');
  const chgReserve = state.syndik_prod_charges_v1.find((c: any) => c.id === 'chg-ag-ag-works-1-res-reserve-apt-1');
  const chgDefault = state.syndik_prod_charges_v1.find((c: any) => c.id === 'chg-ag-ag-works-1-res-default-apt-1');
  assert.equal(chgCourant.worksFundTarget, 'courant');
  assert.equal(chgReserve.worksFundTarget, 'reserve');
  assert.equal(chgDefault.worksFundTarget, undefined);

  const qCourant = await cmd.runOperation(actor, 'createQuittance', [{
    buildingId: 'bld-1', syndicId: 'cab-1', chargeId: chgCourant.id, residentId: 'res-1', residentName: 'Resident 1',
    apartmentId: 'apt-1', apartmentNumber: 'A1', buildingName: 'Résidence Test', syndicName: 'Cabinet Test',
    amount: 1000, periodCovered: chgCourant.period, paymentDate: openDate, paymentMethod: 'virement', paymentId: 'pay-w-1',
  }], 'op-pay-w-1');
  assert.equal(qCourant.reserveRateApplied, 0);
  assert.equal(qCourant.reserveFundAmount, 0);
  assert.equal(qCourant.chargesCourantesAmount, 1000);

  const qReserve = await cmd.runOperation(actor, 'createQuittance', [{
    buildingId: 'bld-1', syndicId: 'cab-1', chargeId: chgReserve.id, residentId: 'res-1', residentName: 'Resident 1',
    apartmentId: 'apt-1', apartmentNumber: 'A1', buildingName: 'Résidence Test', syndicName: 'Cabinet Test',
    amount: 1000, periodCovered: chgReserve.period, paymentDate: openDate, paymentMethod: 'virement', paymentId: 'pay-w-2',
  }], 'op-pay-w-2');
  assert.equal(qReserve.reserveRateApplied, 100);
  assert.equal(qReserve.reserveFundAmount, 1000);
  assert.equal(qReserve.chargesCourantesAmount, 0);

  const qDefault = await cmd.runOperation(actor, 'createQuittance', [{
    buildingId: 'bld-1', syndicId: 'cab-1', chargeId: chgDefault.id, residentId: 'res-1', residentName: 'Resident 1',
    apartmentId: 'apt-1', apartmentNumber: 'A1', buildingName: 'Résidence Test', syndicName: 'Cabinet Test',
    amount: 1000, periodCovered: chgDefault.period, paymentDate: openDate, paymentMethod: 'virement', paymentId: 'pay-w-3',
  }], 'op-pay-w-3');
  assert.equal(qDefault.reserveRateApplied, 20);
  assert.equal(qDefault.reserveFundAmount, 200);
  assert.equal(qDefault.chargesCourantesAmount, 800);

  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.balance, 1800);
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.reserveFundBalance, 1200);
});

test('Rule #2 (monthly billing): scheduled billing starts with owner assignment, rejects unlinked payer, allows open future month, and skips 0 MAD tantiemes lots', async () => {
  // 1) Scheduled monthly billing rejects unlinked active lot with monthlyFees > 0
  const sFail = baseState();
  const dir1 = await mkdtemp(join(tmpdir(), 'rule2-fail-'));
  try {
    const repo1 = new FileRepository(dir1);
    await repo1.transaction(async (repoState) => { Object.assign(repoState, sFail); });
    const runFail = await generateScheduledMonthlyCharges(repo1, '2026-11');
    assert.equal(runFail.failed, 1);
    assert.equal(runFail.results[0].code, 'BILLING_PAYER_INVALID');
    assert.equal(runFail.results[0].httpStatus, 400);
  } finally {
    await rm(dir1, { recursive: true, force: true });
  }

  // 2) Scheduled monthly billing bills owner (even when tenant also exists) and skips archived lots
  const sOk = baseState();
  const bldOk = sOk.syndik_prod_syndics_v1[0].buildings[0];
  bldOk.residents.push({
    id: 'res-tenant',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    apartmentId: 'apt-1',
    name: 'Tenant 1',
    email: 'ten1@test.ma',
    phone: '0600000010',
    isOwner: false,
    hasAccount: false,
  });
  bldOk.apartments[0].tenantId = 'res-tenant';
  bldOk.apartments[1].archivedAt = '2026-01-20T00:00:00.000Z';

  const dir2 = await mkdtemp(join(tmpdir(), 'rule2-ok-'));
  try {
    const repo2 = new FileRepository(dir2);
    await repo2.transaction(async (repoState) => { Object.assign(repoState, sOk); });
    const runOk = await generateScheduledMonthlyCharges(repo2, '2026-11');
    assert.equal(runOk.succeeded, 1);
    assert.equal(runOk.created, 1);
    await repo2.transaction(async (after) => {
      assert.equal(after.syndik_prod_charges_v1.length, 1);
      assert.equal(after.syndik_prod_charges_v1[0].residentId, 'res-1');
    });
  } finally {
    await rm(dir2, { recursive: true, force: true });
  }

  // 3) Manual generateMonthlyCharges allows open future period when current period is closed and skips 0 MAD tantiemes lots
  const sManual = baseState();
  const bldM = sManual.syndik_prod_syndics_v1[0].buildings[0];
  bldM.residents.push({
    id: 'res-2',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    apartmentId: 'apt-2',
    name: 'Resident 2',
    email: 'res2@test.ma',
    phone: '0600000003',
    isOwner: true,
    hasAccount: false,
  });
  bldM.apartments[1].ownerId = 'res-2';
  bldM.apartments[1].tantiemes = 0;
  bldM.apartments[0].tantiemes = 1000;
  sManual.__closedPeriods = { 'bld-1:2026-03': { closedAt: '2026-04-01T00:00:00.000Z' } };

  const cmd = createCommandService(sManual);
  await assert.rejects(
    cmd.runOperation(actor, 'generateMonthlyCharges', ['bld-1', 'cab-1', '2026-03'], 'op-closed-2026-03'),
    /Période comptable clôturée/i,
  );
  const futureCharges = await cmd.runOperation(
    actor,
    'generateMonthlyCharges',
    ['bld-1', 'cab-1', '2026-04', { useTantiemes: true, totalMonthlyBudget: 600 }],
    'op-open-2026-04',
  );
  assert.equal(futureCharges.length, 1, 'zero-MAD lot with 0 tantiemes must be skipped in useTantiemes mode');
  assert.equal(futureCharges[0].apartmentId, 'apt-1');
  assert.equal(futureCharges[0].amount, 600);
});

test('Rule #3 (overdraft block & statement opening arrears): addTransaction enforces fund balance unless overridden with reason, and buildingReport exposes openingArrearsBilled & openingArrearsOutstanding', async () => {
  const state = baseState();
  const bld = state.syndik_prod_syndics_v1[0].buildings[0];
  bld.financials.openingWorkingBalance = 100;
  bld.financials.balance = 100;
  const openDate = new Date().toISOString().slice(0, 10);
  const cmd = createCommandService(state);

  await assert.rejects(
    cmd.runOperation(actor, 'addTransaction', ['bld-1', {
      description: 'Dépense dépassant le solde',
      amount: 150,
      type: 'expense',
      category: 'maintenance',
      fundType: 'courant',
      date: openDate,
    }], 'op-overdraft-blocked'),
    (err: any) => err?.code === 'INSUFFICIENT_FUND_BALANCE' && err?.status === 409,
  );

  const overridden = await cmd.runOperation(actor, 'addTransaction', ['bld-1', {
    description: 'Réparation urgente ascenseur',
    amount: 150,
    type: 'expense',
    category: 'elevator',
    fundType: 'courant',
    date: openDate,
    overdraftOverrideReason: 'Avance urgence validée par le conseil syndical',
  }], 'op-overdraft-allowed');
  assert.equal(overridden.amount, -150);
  assert.equal(overridden.overdraftOverrideReason, 'Avance urgence validée par le conseil syndical');
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.balance, -50);
  const overrideAudit = state.syndik_prod_audit_v1.find((a: any) => a.operation === 'overdraftExpenseOverride');
  assert.ok(overrideAudit);
  assert.equal(overrideAudit.detail.reason, 'Avance urgence validée par le conseil syndical');

  // Opening arrears statement breakdown
  state.syndik_prod_charges_v1.push(
    {
      id: 'open-1', buildingId: 'bld-1', syndicId: 'cab-1', apartmentId: 'apt-1', residentId: 'res-1',
      period: '2025-12', periodKey: '2025-12', amount: 500, paidAmount: 200, status: 'unpaid',
      dueDate: '2025-12-05', chargeType: 'opening_arrears', openingArrears: true,
    },
    {
      id: 'curr-1', buildingId: 'bld-1', syndicId: 'cab-1', apartmentId: 'apt-1', residentId: 'res-1',
      period: '2026-01', periodKey: '2026-01', amount: 300, paidAmount: 100, status: 'unpaid',
      dueDate: '2026-01-05', chargeType: 'courante',
    },
  );
  const dir = await mkdtemp(join(tmpdir(), 'audit-reg-r3-'));
  let report: any;
  try {
    await new FileRepository(dir).transaction(async (repoState) => {
      Object.assign(repoState, state);
      report = buildingReport(repoState, actor, 'bld-1');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const stmt = report.statements.find((s: any) => s.residentId === 'res-1');
  assert.equal(stmt.billed, 800);
  assert.equal(stmt.paid, 300);
  assert.equal(stmt.outstanding, 500);
  assert.equal(stmt.openingArrearsBilled, 500);
  assert.equal(stmt.openingArrearsOutstanding, 300);
});

test('FIN-011/013/014: transferFunds, voidInvoice, and reverseExpense enforce invariants, closed periods, and tenant isolation', async () => {
  const state = baseState();
  const bld = state.syndik_prod_syndics_v1[0].buildings[0];
  bld.financials.openingWorkingBalance = 500;
  bld.financials.balance = 500;
  bld.financials.openingReserveBalance = 300;
  bld.financials.reserveFundBalance = 300;
  const openDate = new Date().toISOString().slice(0, 10);
  const foreignActor = { uid: 'owner-other', role: 'syndic', syndicId: 'cab-other' } as const;
  const cmd = createCommandService(state);

  // 1. transferFunds
  const transferRes = await cmd.runOperation(actor, 'transferFunds', ['bld-1', {
    fromFund: 'courant', toFund: 'reserve', amount: 250, date: openDate, reason: 'Dotation réserve votée AG',
  }], 'op-trf-1');
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.balance, 250);
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.reserveFundBalance, 550);
  assert.equal(transferRes.outTransaction.transferDirection, 'out');
  assert.equal(transferRes.inTransaction.transferDirection, 'in');

  await assert.rejects(
    cmd.runOperation(actor, 'transferFunds', ['bld-1', {
      fromFund: 'courant', toFund: 'reserve', amount: 300, date: openDate, reason: 'Dépassement fonds',
    }], 'op-trf-over'),
    (err: any) => err?.code === 'INSUFFICIENT_FUND_BALANCE' && err?.status === 409,
  );
  await assert.rejects(
    cmd.runOperation(actor, 'transferFunds', ['bld-1', {
      fromFund: 'courant', toFund: 'courant', amount: 10, date: openDate, reason: 'Même fonds',
    }], 'op-trf-same'),
    /identiques|invalides/i,
  );
  await assert.rejects(
    cmd.runOperation(foreignActor, 'transferFunds', ['bld-1', {
      fromFund: 'courant', toFund: 'reserve', amount: 10, date: openDate, reason: 'Cross-tenant',
    }], 'op-trf-foreign'),
    /autorisé/i,
  );

  // 2. reverseExpense
  const exp = await cmd.runOperation(actor, 'addTransaction', ['bld-1', {
    description: 'Facture étanchéité', amount: 120, type: 'expense', category: 'reserve',
    fundType: 'reserve', date: openDate,
  }], 'op-exp-res');
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.reserveFundBalance, 430);

  // Cannot reverse transfer entry or income entry
  await assert.rejects(
    cmd.runOperation(actor, 'reverseExpense', ['bld-1', transferRes.outTransaction.id, 'Interdit'], 'op-rev-trf'),
    /virements internes/i,
  );
  await assert.rejects(
    cmd.runOperation(foreignActor, 'reverseExpense', ['bld-1', exp.id, 'Cross-tenant'], 'op-rev-foreign'),
    /autorisé/i,
  );

  const revExp = await cmd.runOperation(actor, 'reverseExpense', ['bld-1', exp.id, 'Avoir fournisseur'], 'op-rev-exp-1');
  assert.equal(revExp.reversalOf, exp.id);
  assert.equal(revExp.type, 'income');
  assert.equal(state.syndik_prod_syndics_v1[0].buildings[0].financials.reserveFundBalance, 550);

  // Double reversal blocked
  await assert.rejects(
    cmd.runOperation(actor, 'reverseExpense', ['bld-1', exp.id, 'Doublon'], 'op-rev-exp-2'),
    /déjà contrepassée/i,
  );

  // 3. voidInvoice
  state.syndik_prod_charges_v1.push({
    id: 'chg-inv-1', syndicId: 'cab-1', buildingId: 'bld-1', apartmentId: 'apt-1', residentId: 'res-1',
    amount: 300, paidAmount: 0, status: 'unpaid', period: '2026-05', periodKey: '2026-05', dueDate: '2026-05-05',
  });
  const invoice = await cmd.runOperation(actor, 'createInvoiceForResident', ['res-1', 'bld-1', 'cab-1'], 'op-inv-create');
  assert.equal(state.syndik_prod_charges_v1[0].invoiceId, invoice.id);

  await assert.rejects(
    cmd.runOperation(foreignActor, 'voidInvoice', ['bld-1', invoice.id, 'Cross-tenant'], 'op-void-foreign'),
    /autorisé/i,
  );
  const voided = await cmd.runOperation(actor, 'voidInvoice', ['bld-1', invoice.id, 'Erreur de facturation'], 'op-void-1');
  assert.equal(voided, true);
  assert.equal(state.syndik_prod_invoices_v1[0].status, 'cancelled');
  assert.equal(state.syndik_prod_invoices_v1[0].voidReason, 'Erreur de facturation');
  assert.ok(state.syndik_prod_invoices_v1[0].voidedAt);
  assert.equal(state.syndik_prod_charges_v1[0].invoiceId, undefined);

  await assert.rejects(
    cmd.runOperation(actor, 'voidInvoice', ['bld-1', invoice.id, 'Deuxième annulation'], 'op-void-2'),
    /déjà annulée/i,
  );

  // Closed period blocks transferFunds and reverseExpense
  state.__closedPeriods = { [`bld-1:${openDate.slice(0, 7)}`]: { closedAt: new Date().toISOString() } };
  await assert.rejects(
    cmd.runOperation(actor, 'transferFunds', ['bld-1', {
      fromFund: 'reserve', toFund: 'courant', amount: 50, date: openDate, reason: 'Période close',
    }], 'op-trf-closed'),
    /clôturée/i,
  );
});

test('CSV formula-injection & PDF control/bidi sanitization', () => {
  assert.equal(escapeCSVCell('=1+1'), `"'=1+1"`);
  assert.equal(escapeCSVCell(' =cmd|" /C calc"!A0'), `"' =cmd|"" /C calc""!A0"`);
  assert.equal(escapeCSVCell('\t@SUM(A1:A2)'), `"'	@SUM(A1:A2)"`);
  assert.equal(escapeCSVCell('+100'), `"'+100"`);
  assert.equal(escapeCSVCell('-50'), `"'${'-50'}"`);
  assert.equal(escapeCSVCell('Résidence Atlas'), `"Résidence Atlas"`);

  assert.equal(sanitizePdfText('Atlas\u0007\u202EMaroc\u2066'), 'Atlas Maroc');
  assert.equal(sanitizePdfText('دار السلام'), 'dar alslam');
});

test('Admin subscription policy & CRUD: effective status distinguishes trialing vs expired, 6-month payment extends cleanly, voidPayment frees reference, and archive/restore enforces write lock', async () => {
  const fixedNow = Date.parse('2026-11-15T12:00:00.000Z');
  assert.equal(
    getEffectiveSubscriptionStatus({ subscriptionStatus: 'trialing', subscriptionExpiry: '2026-11-28T00:00:00.000Z' }, fixedNow),
    'trialing',
  );
  assert.equal(
    getEffectiveSubscriptionStatus({ subscriptionStatus: 'trialing', subscriptionExpiry: '2026-11-15' }, fixedNow),
    'trialing',
  );
  assert.equal(
    getEffectiveSubscriptionStatus({ subscriptionStatus: 'trialing', subscriptionExpiry: '2026-11-10T00:00:00.000Z' }, fixedNow),
    'expired',
  );
  assert.equal(
    getEffectiveSubscriptionStatus({ subscriptionStatus: 'active', subscriptionExpiry: '2027-05-15T23:59:59.999Z' }, fixedNow),
    'active',
  );
  assert.equal(
    getEffectiveSubscriptionStatus({ subscriptionStatus: 'cancelled', subscriptionExpiry: '2027-05-15T23:59:59.999Z' }, fixedNow),
    'cancelled',
  );
  assert.equal(
    subscriptionCanWrite({ subscriptionStatus: 'trialing', subscriptionExpiry: '2099-01-01T00:00:00.000Z' }),
    true,
  );
  assert.equal(
    subscriptionCanWrite({ subscriptionStatus: 'cancelled', subscriptionExpiry: '2099-01-01T00:00:00.000Z' }),
    false,
  );

  assert.equal(
    isUnlimitedPlan(PLANS.enterprise.buildings),
    true,
  );
  assert.equal(
    isUnlimitedPlan(PLANS.professional.buildings),
    false,
  );
  assert.equal(PLAN_CATALOG.starter.priceMad, PLANS.starter.price);
  assert.equal(PLAN_CATALOG.professional.priceMad, PLANS.professional.price);
  assert.equal(PLAN_CATALOG.enterprise.priceMad, PLANS.enterprise.price);

  const proSixMonths = PLANS.professional.price * 6;
  const entSixMonths = PLANS.enterprise.price * 6;

  const state = baseState();
  const cab = state.syndik_prod_syndics_v1[0];
  cab.subscriptionPlan = 'professional';
  cab.subscriptionStatus = 'trialing';
  cab.subscriptionExpiry = new Date(Date.now() + 14 * 86_400_000).toISOString();
  (state as any).syndik_prod_subscription_payments_v1 = [];

  const adminActor = { uid: 'admin-1', role: 'admin' } as const;
  const cmd = createCommandService(state);

  // Non-admin cannot record payment or archive cabinet
  await assert.rejects(
    cmd.runOperation(actor, 'recordSubscriptionPayment', [{
      syndicId: 'cab-1', plan: 'professional', months: 6, reference: 'VIR-UNAUTH', amount: proSixMonths,
    }], 'op-sub-unauth'),
    /Administration uniquement/i,
  );
  await assert.rejects(
    cmd.runOperation(actor, 'adminArchiveCabinet', ['cab-1'], 'op-arch-unauth'),
    /Administration uniquement/i,
  );

  // Admin records 6-month payment: status becomes active, expiry extends by 6 months, payment metadata populated
  const payment = await cmd.runOperation(adminActor, 'recordSubscriptionPayment', [{
    syndicId: 'cab-1', plan: 'professional', months: 6, reference: 'VIR-2026-6M', amount: proSixMonths,
  }], 'op-sub-6m');
  assert.equal(payment.syndicId, 'cab-1');
  assert.equal(payment.syndicName, cab.name);
  assert.equal(payment.months, 6);
  assert.equal(payment.amount, proSixMonths);
  assert.equal(payment.subscriptionStatus, 'active');
  assert.equal(cab.subscriptionStatus, 'active');
  assert.equal(getEffectiveSubscriptionStatus(cab), 'active');

  // Admin can update cabinet profile + trialing/active status via saveSyndic
  await cmd.runOperation(adminActor, 'saveSyndic', [{
    id: 'cab-1',
    name: 'Cabinet Test Modifié',
    city: 'Rabat',
    ice: '001234567000089',
    subscriptionPlan: 'enterprise',
    subscriptionStatus: 'trialing',
    subscriptionExpiry: '2027-06-01T23:59:59.999Z',
  }], 'op-save-cab-admin');
  assert.equal(cab.name, 'Cabinet Test Modifié');
  assert.equal(cab.city, 'Rabat');
  assert.equal(cab.subscriptionPlan, 'enterprise');
  assert.equal(cab.subscriptionStatus, 'trialing');

  // Voiding requires >=3 char reason and frees reference for reuse
  await assert.rejects(
    cmd.runOperation(adminActor, 'voidSubscriptionPayment', [payment.id, 'no'], 'op-void-short'),
    /motif/i,
  );
  const voided = await cmd.runOperation(adminActor, 'voidSubscriptionPayment', [payment.id, 'Virement rejeté par la banque'], 'op-void-ok');
  assert.ok(voided.voidedAt);
  assert.equal(voided.voidReason, 'Virement rejeté par la banque');

  // Reusing same reference succeeds once previous payment is voided
  const reentered = await cmd.runOperation(adminActor, 'recordSubscriptionPayment', [{
    syndicId: 'cab-1', plan: 'enterprise', months: 6, reference: 'VIR-2026-6M', amount: entSixMonths,
  }], 'op-sub-reuse');
  assert.equal(reentered.amount, entSixMonths);
  assert.equal((state as any).syndik_prod_subscription_payments_v1.length, 2);

  // Archiving blocks syndic writes and payment recording; restoring re-enables
  await cmd.runOperation(adminActor, 'adminArchiveCabinet', ['cab-1'], 'op-arch-cab');
  assert.ok(cab.archivedAt);
  await assert.rejects(
    cmd.runOperation(actor, 'addAnnouncement', ['bld-1', { title: 'Test', content: 'Blocked' }], 'op-write-arch'),
    /Cabinet archivé/i,
  );
  await assert.rejects(
    cmd.runOperation(adminActor, 'recordSubscriptionPayment', [{
      syndicId: 'cab-1', plan: 'enterprise', months: 1, reference: 'VIR-ARCH-BLOCK', amount: PLANS.enterprise.price,
    }], 'op-sub-arch'),
    /Cabinet archivé/i,
  );

  await cmd.runOperation(adminActor, 'adminRestoreCabinet', ['cab-1'], 'op-rest-cab');
  assert.equal(cab.archivedAt, undefined);
  const ann = await cmd.runOperation(actor, 'addAnnouncement', ['bld-1', { title: 'Ouvert', content: 'Cabinet restauré' }], 'op-write-restored');
  assert.equal(ann.title, 'Ouvert');
});

test('PR1 Hardening: credential provisioning sets emailVerified, guards archived entities, allows disabled email reuse, validates saveSyndic, and locks provider chat', async () => {
  const state: any = baseState();
  const cmd = createCommandService(state);
  const adminActor = { uid: 'admin-1', role: 'admin', email: 'admin@test.ma' };
  const providerActor = {
    uid: 'user-prest-prov-1',
    role: 'provider',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    prestataireId: 'prov-1',
    email: 'prov1@test.ma',
  };

  // 1. Provisioning resident & prestataire credentials sets emailVerified: true and matches strictly by ID
  const createdRes = await cmd.runOperation(
    actor,
    'addResident',
    [{
      syndicId: 'cab-1',
      buildingId: 'bld-1',
      name: 'Nouveau Copro',
      email: 'copro.verified@test.ma',
      phone: '0612345678',
      cin: 'BB998877',
      isOwner: true,
    }],
    'op-pr1-add-res',
  );
  const regRes = state.syndik_prod_registered_users_v1.find((u: any) => u.uid === `user-res-${createdRes.id}`);
  assert.equal(regRes?.profile?.emailVerified, true);

  const createdProv = await cmd.runOperation(
    actor,
    'savePrestataire',
    [{
      id: 'prov-pr1',
      buildingId: 'bld-1',
      name: 'Elec Pro',
      contactPerson: 'Karim',
      category: 'electrical',
      phone: '0698765432',
      email: 'elec.verified@test.ma',
      active: true,
    }, true],
    'op-pr1-add-prov',
  );
  const regProv = state.syndik_prod_registered_users_v1.find((u: any) => u.uid === `user-prest-${createdProv.id}`);
  assert.equal(regProv?.profile?.emailVerified, true);

  // 2. Archiving resident/prestataire blocks credential regeneration & sharing and frees email for reuse
  await cmd.runOperation(actor, 'deleteResident', [createdRes.id], 'op-pr1-del-res');
  await assert.rejects(
    cmd.runOperation(actor, 'regenerateResidentCredentials', [createdRes.id], 'op-pr1-regen-arch-res'),
    /archivé/i,
  );
  await assert.rejects(
    cmd.runOperation(actor, 'recordResidentCredentialShare', [createdRes.id, 'email'], 'op-pr1-share-arch-res'),
    /archivé/i,
  );
  const reusedRes = await cmd.runOperation(
    actor,
    'addResident',
    [{
      syndicId: 'cab-1',
      buildingId: 'bld-1',
      name: 'Remplacant Copro',
      email: 'copro.verified@test.ma',
      phone: '0612345679',
      cin: 'CC112233',
      isOwner: true,
    }],
    'op-pr1-reuse-res-email',
  );
  assert.equal(reusedRes.email, 'copro.verified@test.ma');

  await cmd.runOperation(actor, 'deletePrestataire', [createdProv.id], 'op-pr1-del-prov');
  await assert.rejects(
    cmd.runOperation(actor, 'regeneratePrestataireCredentials', [createdProv.id], 'op-pr1-regen-arch-prov'),
    /archivé/i,
  );

  // 3. adminCreateCabinet rejects case-insensitive duplicate email across active registries
  await assert.rejects(
    cmd.runOperation(adminActor, 'adminCreateCabinet', [{
      name: 'Cabinet Doublon',
      email: 'RES1@TEST.MA',
      managerName: 'Manager',
      password: 'ValidPassword123!',
      plan: 'starter',
    }], 'op-pr1-dup-cab'),
    /existant/i,
  );

  // 4. saveSyndic rejects malformed subscriptionExpiry and archived cabinets, and normalizes YYYY-MM-DD
  await assert.rejects(
    cmd.runOperation(adminActor, 'saveSyndic', [{
      id: 'cab-1',
      subscriptionExpiry: 'not-a-date',
    }], 'op-pr1-bad-expiry'),
    /expiration invalide/i,
  );
  const normalizedCab = await cmd.runOperation(adminActor, 'saveSyndic', [{
    id: 'cab-1',
    subscriptionExpiry: '2028-03-15',
  }], 'op-pr1-norm-expiry');
  assert.equal(normalizedCab.subscriptionExpiry, '2028-03-15T23:59:59.999Z');

  await cmd.runOperation(adminActor, 'adminArchiveCabinet', ['cab-1'], 'op-pr1-arch-cab');
  await assert.rejects(
    cmd.runOperation(adminActor, 'saveSyndic', [{ id: 'cab-1', name: 'Blocked Edit' }], 'op-pr1-save-arch-cab'),
    /archivé/i,
  );
  await cmd.runOperation(adminActor, 'adminRestoreCabinet', ['cab-1'], 'op-pr1-rest-cab');

  // 5. External providers cannot send or like community chat messages
  await assert.rejects(
    cmd.runOperation(providerActor, 'sendChatMessage', [{
      buildingId: 'bld-1',
      channelId: 'general',
      content: 'Provider spam',
    }], 'op-pr1-prov-chat'),
    /interdit/i,
  );
  const syndicMsg = await cmd.runOperation(actor, 'sendChatMessage', [{
    buildingId: 'bld-1',
    channelId: 'general',
    content: 'Bonjour les copropriétaires',
  }], 'op-pr1-syndic-chat');
  await assert.rejects(
    cmd.runOperation(providerActor, 'toggleChatMessageLike', [syndicMsg.id], 'op-pr1-prov-like'),
    /interdit/i,
  );

  // 6. Multi-building resident membership works in buildingFor even when buildingId differs from primary
  state.syndik_prod_syndics_v1[0].buildings.push({
    id: 'bld-2',
    syndicId: 'cab-1',
    name: 'Residence 2',
    address: '2 Rue Atlas',
    city: 'Casablanca',
    monthlySyndicFees: 200,
    apartments: [],
    residents: [{ id: 'res-1', name: 'Resident 1', email: 'res1@test.ma', isOwner: true }],
    documents: [],
    announcements: [],
    financials: { balance: 0, reserveFundBalance: 0, transactions: [] },
  });
  const residentActor = {
    uid: 'user-res-res-1',
    role: 'resident',
    syndicId: 'cab-1',
    buildingId: 'bld-1',
    residentId: 'res-1',
    email: 'res1@test.ma',
  };
  const b2 = cmd.buildingFor(residentActor, 'bld-2', false);
  assert.equal(b2.id, 'bld-2');
});

test('PR 2 AG Governance: Law 18-00/106-12 quorum, 2nd convocation, open simple majority, multi-lot voting, proxy caps & override guard', async () => {
  const state = baseState();
  const bld = state.syndik_prod_syndics_v1[0].buildings[0];
  // Build a 5-lot building (total 1000 tantiemes):
  // res-1 owns apt-1 (60 t.) AND apt-1b (40 t.) -> multi-lot owner (100 t. total)
  // res-2 owns apt-2 (50 t.)
  // res-3 owns apt-3 (50 t.)
  // res-4 owns apt-4 (50 t.)
  // res-5 owns apt-5 (750 t.) -> single lot > 10% for Art. 16-6 exception test
  bld.residents = [
    { id: 'res-1', name: 'Owner Multi', email: 'm1@test.ma', isOwner: true, buildingId: 'bld-1', syndicId: 'cab-1', apartmentId: 'apt-1' },
    { id: 'res-2', name: 'Owner Two', email: 'm2@test.ma', isOwner: true, buildingId: 'bld-1', syndicId: 'cab-1', apartmentId: 'apt-2' },
    { id: 'res-3', name: 'Owner Three', email: 'm3@test.ma', isOwner: true, buildingId: 'bld-1', syndicId: 'cab-1', apartmentId: 'apt-3' },
    { id: 'res-4', name: 'Owner Four', email: 'm4@test.ma', isOwner: true, buildingId: 'bld-1', syndicId: 'cab-1', apartmentId: 'apt-4' },
    { id: 'res-5', name: 'Owner Big', email: 'm5@test.ma', isOwner: true, buildingId: 'bld-1', syndicId: 'cab-1', apartmentId: 'apt-5' },
  ];
  bld.apartments = [
    { id: 'apt-1', number: 'A1', floor: 1, area: 60, ownerId: 'res-1', monthlyFees: 200, tantiemes: 60 },
    { id: 'apt-1b', number: 'A1B', floor: 1, area: 40, ownerId: 'res-1', monthlyFees: 150, tantiemes: 40 },
    { id: 'apt-2', number: 'A2', floor: 2, area: 50, ownerId: 'res-2', monthlyFees: 200, tantiemes: 50 },
    { id: 'apt-3', number: 'A3', floor: 3, area: 50, ownerId: 'res-3', monthlyFees: 200, tantiemes: 50 },
    { id: 'apt-4', number: 'A4', floor: 4, area: 50, ownerId: 'res-4', monthlyFees: 200, tantiemes: 50 },
    { id: 'apt-5', number: 'A5', floor: 5, area: 500, ownerId: 'res-5', monthlyFees: 1000, tantiemes: 750 },
  ];
  bld.totalTantiemes = 1000;

  const cmd = createCommandService(state);

  // 1. Metadata validation rejects empty title & invalid convocationNumber
  await assert.rejects(
    cmd.runOperation(actor, 'createAssembleeGenerale', [{
      buildingId: 'bld-1', title: '   ', type: 'AGO', date: '2026-06-01', time: '18:00', location: 'Hall',
      resolutions: [{ title: 'R1', majorityType: 'simple' }],
    }], 'op-pr2-bad-title'),
    /titre/i,
  );

  // 2. Create 2nd convocation AG (Law 18-00 Art. 18 — deliberates without quorum)
  const ag2 = await cmd.runOperation(actor, 'createAssembleeGenerale', [{
    buildingId: 'bld-1',
    title: 'AGO 2026 - 2ème Convocation',
    type: 'AGO',
    convocationNumber: 2,
    date: '2026-06-15',
    time: '18:00',
    location: 'Hall',
    resolutions: [{ id: 'res-simple', title: 'Approbation comptes', majorityType: 'simple' }],
  }], 'op-pr2-create-ag2');
  assert.equal(ag2.convocationNumber, 2);
  assert.equal(ag2.quorumRequired, 501);
  assert.equal(ag2.attendees.length, 6, 'One attendee row per owned lot including multi-lot owner');

  // 3. Art. 16-6 proxy caps enforcement
  await assert.rejects(
    cmd.runOperation(actor, 'updateAGAttendee', [ag2.id, 'res-2', 'represented', '   '], 'op-pr2-proxy-empty'),
    /mandataire/i,
  );
  await assert.rejects(
    cmd.runOperation(actor, 'updateAGAttendee', [ag2.id, 'res-2', 'represented', 'Cabinet Test'], 'op-pr2-proxy-syndic'),
    /syndic/i,
  );
  // Valid 1st & 2nd proxies to Mandataire Ali (50 + 50 = 100 <= 10% of 1000)
  await cmd.runOperation(actor, 'updateAGAttendee', [ag2.id, 'res-2', 'represented', 'Mandataire Ali'], 'op-pr2-proxy-1');
  await cmd.runOperation(actor, 'updateAGAttendee', [ag2.id, 'res-3', 'represented', 'Mandataire Ali'], 'op-pr2-proxy-2');
  // 3rd proxy to Mandataire Ali would push cumulative tantiemes to 150 > 100 (10%) -> rejected!
  await assert.rejects(
    cmd.runOperation(actor, 'updateAGAttendee', [ag2.id, 'res-4', 'represented', 'Mandataire Ali'], 'op-pr2-proxy-10pct'),
    /10%|Art\. 16-6/i,
  );
  // Single-mandant exception: 1 owner (res-5) with 750 t. (>10%) represented alone by a distinct mandataire IS allowed
  await cmd.runOperation(actor, 'updateAGAttendee', [ag2.id, 'res-5', 'represented', 'Mandataire Solo'], 'op-pr2-proxy-solo');
  // Adding a 2nd mandant to Mandataire Solo (750 + 50 = 800 > 10%) is rejected!
  await assert.rejects(
    cmd.runOperation(actor, 'updateAGAttendee', [ag2.id, 'res-4', 'represented', 'Mandataire Solo'], 'op-pr2-proxy-solo2'),
    /10%|Art\. 16-6/i,
  );
  // Reset res-5 back to absent so quorumReached remains false (< 501) for our 2nd convocation test
  await cmd.runOperation(actor, 'updateAGAttendee', [ag2.id, 'res-5', 'absent'], 'op-pr2-reset-r5');

  // 4. Open voting -> convocationNumber becomes immutable
  const opened = await cmd.runOperation(actor, 'toggleAGVoting', [ag2.id, true], 'op-pr2-open');
  assert.equal(opened.isVotingOpen, true);
  await assert.rejects(
    cmd.runOperation(actor, 'saveAssembleeGenerale', [{ ...opened, convocationNumber: 1 }], 'op-pr2-mutate-conv'),
    /convocation/i,
  );

  // 5. Manager cannot record a vote for an absent owner (res-4)
  await assert.rejects(
    cmd.runOperation(actor, 'recordAGVote', [ag2.id, 'res-simple', 'for', 50, {
      residentId: 'res-4', residentName: 'Owner Four', apartmentId: 'apt-4', apartmentNumber: 'A4',
    }], 'op-pr2-absent-vote'),
    /absent|présence/i,
  );

  // 6. Multi-lot owner res-1 votes independently on apt-1 ('for', 60 t.) and apt-1b ('against', 40 t.)
  const res1Actor = { uid: 'user-res-res-1', role: 'resident', syndicId: 'cab-1', buildingId: 'bld-1', residentId: 'res-1', email: 'm1@test.ma' };
  const currentAg2 = state.syndik_prod_ag_v1.find((a: any) => a.id === ag2.id);
  const afterLot1 = applyResidentVote(
    currentAg2,
    currentAg2.votingSnapshot,
    'res-1',
    'res-simple',
    'for',
    'apt-1',
    'Réserve lot A1',
    { actorRole: 'resident', actorUid: res1Actor.uid },
  );
  const afterLot1b = applyResidentVote(
    afterLot1,
    afterLot1.votingSnapshot!,
    'res-1',
    'res-simple',
    'against',
    'apt-1b',
    'Contre sur lot A1B',
    { actorRole: 'resident', actorUid: res1Actor.uid },
  );
  // Persist into state
  const agIdx = state.syndik_prod_ag_v1.findIndex((a: any) => a.id === ag2.id);
  state.syndik_prod_ag_v1[agIdx] = afterLot1b;
  assert.equal(afterLot1b.resolutions[0].votesFor, 60);
  assert.equal(afterLot1b.resolutions[0].votesAgainst, 40);
  assert.equal(afterLot1b.resolutions[0].voterChoices?.length, 2, 'Distinct ballots for apt-1 and apt-1b');
  // Partial simple-majority ballot while open MUST remain pending (not prematurely approved!)
  assert.equal(afterLot1b.resolutions[0].status, 'pending', 'Open simple majority stays pending while unbeatable threshold not met');

  // 7. Syndic cannot silently overwrite resident-cast ballot unless allowOverrideResidentVote: true
  await assert.rejects(
    cmd.runOperation(actor, 'recordAGVote', [ag2.id, 'res-simple', 'against', 60, {
      residentId: 'res-1', residentName: 'Owner Multi', apartmentId: 'apt-1', apartmentNumber: 'A1',
    }], 'op-pr2-silent-override'),
    /déjà voté|rectification/i,
  );
  // With explicit override flag + comment, syndic override succeeds and preserves comment
  const overridden = await cmd.runOperation(actor, 'recordAGVote', [ag2.id, 'res-simple', 'for', 60, {
    residentId: 'res-1', residentName: 'Owner Multi', apartmentId: 'apt-1', apartmentNumber: 'A1',
    comment: 'Confirmé en séance', allowOverrideResidentVote: true,
  }], 'op-pr2-explicit-override');
  const lot1Ballot = overridden.resolutions[0].voterChoices.find((v: any) => v.apartmentId === 'apt-1');
  assert.equal(lot1Ballot.comment, 'Confirmé en séance');
  assert.equal(lot1Ballot.castByRole, 'syndic');

  // 8. Close 2nd-convocation AG with presentTantiemes = 200 (< 501): simple majority approves despite no 1st-convocation quorum!
  assert.equal(overridden.quorumReached, false);
  const closed = await cmd.runOperation(actor, 'saveAssembleeGenerale', [{
    ...overridden, status: 'completed', isVotingOpen: false,
  }], 'op-pr2-close-ag2');
  assert.equal(closed.resolutions[0].status, 'approved', '2nd convocation approves simple majority without 1st-convocation quorum');
});



