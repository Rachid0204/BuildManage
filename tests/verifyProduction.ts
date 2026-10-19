/**
 * Production Verification & Security/Financial Regression Suite
 * Exercises actual application services in an isolated in-memory environment without network calls.
 */

// Set up in-memory localStorage before importing services
const memoryStore = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return memoryStore.size;
  },
  clear() {
    memoryStore.clear();
  },
  getItem(key: string) {
    return memoryStore.has(key) ? memoryStore.get(key)! : null;
  },
  key(index: number) {
    return Array.from(memoryStore.keys())[index] ?? null;
  },
  removeItem(key: string) {
    memoryStore.delete(key);
  },
  setItem(key: string, value: string) {
    memoryStore.set(key, String(value));
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

import {
  hashPasswordSync,
  verifyPasswordSync,
  createSignedSessionEnvelope,
  verifySignedSessionEnvelope,
  allocateBudgetCentimes,
  splitChargeReserveAndOperating,
  computeBuildingFundBalances,
} from '../utils/security';
import {
  saveSyndic,
  addBuilding,
  deleteBuilding,
  getSyndics,
  addResident,
  generateMonthlyCharges,
  getChargesForBuilding,
  submitPaymentProof,
  reviewPaymentProof,
  getQuittancesForBuilding,
  generateQuittanceForCharge,
  addTransaction,
  createAssembleeGenerale,
  castResidentAGVote,
  STORAGE_KEYS,
} from '../firebase/services';
import type { Syndic, UserProfile } from '../types';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`❌ REGRESSION CHECK FAILED: ${message}`);
    process.exit(1);
  }
}

async function runVerification() {
  console.log('🔒 Running ImmoGest Security, Persistence & Financial Regression Suite...\n');

  // 1. Password Hashing & Session Authority (Audit Items 01 & 03)
  const hashed = hashPasswordSync('Wahbi@2026', 'wahbi.rachid@gmail.com');
  assert(!hashed.includes('Wahbi@2026'), 'Hashed password must never contain plaintext');
  assert(
    verifyPasswordSync('Wahbi@2026', hashed, 'wahbi.rachid@gmail.com') === true,
    'Correct password must verify against hash'
  );
  assert(
    verifyPasswordSync('WrongPass123!', hashed, 'wahbi.rachid@gmail.com') === false,
    'Wrong password must be rejected'
  );

  const sampleProfile: UserProfile = {
    uid: 'user-1',
    email: 'syndic@cabinet.ma',
    displayName: 'Cabinet Atlas',
    role: 'syndic',
    syndicId: 'syndic-1',
  };
  const signedEnvelope = createSignedSessionEnvelope(sampleProfile);
  assert(
    verifySignedSessionEnvelope(signedEnvelope)?.role === 'syndic',
    'Valid signed session envelope must restore profile'
  );
  const tamperedEnvelope = {
    ...signedEnvelope,
    profile: { ...signedEnvelope.profile, role: 'admin' as const },
  };
  assert(
    verifySignedSessionEnvelope(tamperedEnvelope) === null,
    'Tampered session role in localStorage must be rejected'
  );
  console.log('✅ [01/03] Password hashing & signed session envelope tamper check passed.');

  // 2. Centime Allocation & Reserve Percentages (Audit Item 16)
  const allocations = allocateBudgetCentimes(100, [
    { id: 'apt-1', tantiemes: 333 },
    { id: 'apt-2', tantiemes: 333 },
    { id: 'apt-3', tantiemes: 334 },
  ]);
  const totalAllocated =
    (allocations.get('apt-1') || 0) +
    (allocations.get('apt-2') || 0) +
    (allocations.get('apt-3') || 0);
  assert(
    Math.round(totalAllocated * 100) === 10000,
    `100 MAD split across 333/333/334 shares must equal 100.00 MAD exactly (got ${totalAllocated})`
  );

  const split5Pct = splitChargeReserveAndOperating(100, 5);
  assert(
    split5Pct.reserveFundAmount === 5 && split5Pct.chargesCourantesAmount === 95,
    '5% building reserve must allocate 5 MAD reserve and 95 MAD operating'
  );
  console.log('✅ [16] Centime budget allocation (100.00 MAD conserved) & configured 5% reserve passed.');

  // 3. Setup Tenant, Building, Apartment, Resident & Verify No Plaintext Credentials
  const syndic: Syndic = {
    id: 'syndic-test-1',
    name: 'Cabinet Test',
    email: 'contact@cabinet-test.ma',
    logoUrl: '',
    createdBy: 'uid-syndic-1',
    subscriptionPlan: 'starter',
    subscriptionStatus: 'active',
    subscriptionExpiry: new Date(Date.now() + 30 * 86400000).toISOString(),
    buildings: [],
  };
  await saveSyndic(syndic);

  const createdBld = await addBuilding(syndic.id, {
    name: 'Résidence Anfa',
    address: '10 Bd d Anfa',
    city: 'Casablanca',
    postalCode: '20000',
    managerName: 'Karim',
    monthlySyndicFees: 500,
    reserveFundPercentage: 5,
    apartments: [
      {
        number: 'A1',
        floor: 1,
        area: 100,
        tantiemes: 500,
        coproType: 'apartment',
        ownerId: null,
        tenantId: null,
        monthlyFees: 500,
      },
      {
        number: 'A2',
        floor: 1,
        area: 100,
        tantiemes: 500,
        coproType: 'apartment',
        ownerId: null,
        tenantId: null,
        monthlyFees: 0, // Deliberately configured zero fee
      },
    ],
  });

  const apt1 = createdBld.apartments[0];
  const apt2 = createdBld.apartments[1];
  assert(apt2.monthlyFees === 0, 'Deliberately configured zero monthlyFees must remain 0');

  const resident1 = await addResident(
    {
      name: 'Youssef Alami',
      email: 'youssef@example.ma',
      phone: '0600000001',
      syndicId: syndic.id,
      buildingId: createdBld.id,
      apartmentId: apt1.id,
      isOwner: true,
    },
    true
  );
  assert(
    resident1.generatedPassword === undefined && Boolean(resident1.invitationCode),
    'Resident record must store expiring invitationCode without generatedPassword'
  );

  // 4. Repeat Monthly Charge Generation Uniqueness (Audit Item 12)
  const firstRun = await generateMonthlyCharges(
    createdBld.id,
    syndic.id,
    'Octobre 2026',
    false
  );
  const secondRun = await generateMonthlyCharges(
    createdBld.id,
    syndic.id,
    'Octobre 2026',
    false
  );
  const allCharges = await getChargesForBuilding(createdBld.id);
  assert(
    firstRun.length === 1 && secondRun.length === 0 && allCharges.length === 1,
    `Repeating monthly charge generation for the same period must produce 1 charge (got ${allCharges.length})`
  );
  console.log('✅ [12] Idempotent monthly charge generation passed.');

  // 5. Payment Proof Re-approval & Partial Payment Handling (Audit Item 13)
  const targetCharge = allCharges[0];
  const proof100 = await submitPaymentProof({
    chargeId: targetCharge.id,
    residentId: resident1.id,
    residentName: resident1.name,
    apartmentId: apt1.id,
    apartmentNumber: apt1.number,
    buildingId: createdBld.id,
    amount: 100,
    paymentMethod: 'virement',
    bankName: 'Attijariwafa Bank',
    referenceNumber: 'VIR-100',
  });

  await reviewPaymentProof(proof100.id, 'approved');
  // Re-approving the exact same proof a second time must be idempotent
  await reviewPaymentProof(proof100.id, 'approved');

  const quittancesAfterPartial = await getQuittancesForBuilding(createdBld.id);
  const syndicsAfterPartial = await getSyndics();
  const bldAfterPartial = syndicsAfterPartial[0].buildings[0];
  const chargesAfterPartial = await getChargesForBuilding(createdBld.id);

  assert(
    quittancesAfterPartial.length === 1,
    `Re-approving same proof twice must create only 1 quittance (got ${quittancesAfterPartial.length})`
  );
  assert(
    bldAfterPartial.financials.balance === 100,
    `Re-approving 100 MAD proof twice must result in 100 MAD balance (got ${bldAfterPartial.financials.balance})`
  );
  assert(
    chargesAfterPartial[0].status === 'unpaid' && chargesAfterPartial[0].paidAmount === 100,
    'Partial 100 MAD payment against 500 MAD charge must leave charge unpaid with paidAmount=100'
  );
  console.log('✅ [13] Idempotent payment proof approval & partial payment reconciliation passed.');

  // 6. Generating Missing Receipt for Paid Charge Must Not Add Income Again (Audit Item 14)
  const proofRemaining = await submitPaymentProof({
    chargeId: targetCharge.id,
    residentId: resident1.id,
    residentName: resident1.name,
    apartmentId: apt1.id,
    apartmentNumber: apt1.number,
    buildingId: createdBld.id,
    amount: 400,
    paymentMethod: 'virement',
    bankName: 'Attijariwafa Bank',
    referenceNumber: 'VIR-400',
  });
  await reviewPaymentProof(proofRemaining.id, 'approved');

  const balanceBeforeReissue = (await getSyndics())[0].buildings[0].financials.balance;
  assert(balanceBeforeReissue === 500, `Expected balance 500 MAD, got ${balanceBeforeReissue}`);

  // Simulate missing receipt or re-download via generateQuittanceForCharge
  localStorage.setItem(STORAGE_KEYS.QUITTANCES, JSON.stringify([]));
  const reissuedQuittance = await generateQuittanceForCharge(targetCharge.id, createdBld.id);
  const balanceAfterReissue = (await getSyndics())[0].buildings[0].financials.balance;

  assert(
    balanceAfterReissue === 500,
    `Generating missing quittance for paid charge must never alter balance (expected 500, got ${balanceAfterReissue})`
  );
  assert(
    reissuedQuittance.reserveFundAmount === 25 &&
      reissuedQuittance.chargesCourantesAmount === 475,
    `500 MAD charge in 5% reserve building must split into 25 MAD reserve and 475 MAD operating`
  );
  console.log('✅ [14/16] Read-only missing receipt generation & 5% reserve split passed.');

  // 7. Reserve Fund KPI Single-Counting & Zero Reserve Preservation (Audit Item 15)
  const zeroReserveCheck = computeBuildingFundBalances(
    (await getSyndics())[0].buildings[0]
  );
  assert(
    zeroReserveCheck.reserveBalance === 0,
    `Zero reserve balance must display 0, not 20% of operating balance (got ${zeroReserveCheck.reserveBalance})`
  );

  await addTransaction(createdBld.id, {
    description: 'Dotation Fonds de Réserve',
    amount: 100,
    type: 'income',
    category: 'reserve',
    fundType: 'reserve',
    date: new Date().toISOString(),
  });
  const afterReserveTrx = computeBuildingFundBalances(
    (await getSyndics())[0].buildings[0]
  );
  assert(
    afterReserveTrx.reserveBalance === 100,
    `Single 100 MAD reserve contribution must equal 100 MAD, never 200 MAD (got ${afterReserveTrx.reserveBalance})`
  );
  console.log('✅ [15] Reserve fund balance single-counting & zero-balance preservation passed.');

  // 8. AG Voting Validation: Closed Sessions, Eligibility & Authoritative Tantièmes (Audit Item 20)
  const ag = await createAssembleeGenerale({
    buildingId: createdBld.id,
    syndicId: syndic.id,
    title: 'AGO 2026',
    type: 'ordinaire',
    date: '2026-11-15',
    time: '18:00',
    location: 'Casablanca',
    status: 'closed',
    convocationSentAt: new Date().toISOString(),
    totalTantiemes: 1000,
    presentTantiemes: 500,
    quorumReached: false,
    attendees: [
      {
        residentId: resident1.id,
        residentName: resident1.name,
        apartmentNumber: apt1.number,
        tantiemes: 500,
        status: 'present',
      },
    ],
    resolutions: [
      {
        id: 'res-1',
        number: 1,
        title: 'Budget 2027',
        description: 'Adoption du budget',
        majorityType: 'simple_24',
        votesFor: 0,
        votesAgainst: 0,
        votesAbstain: 0,
        status: 'pending',
        voterChoices: [],
      },
    ],
  });

  let closedRejected = false;
  try {
    await castResidentAGVote(ag.id, 'res-1', {
      residentId: resident1.id,
      residentName: resident1.name,
      apartmentNumber: apt1.number,
      tantiemes: 999,
      choice: 'for',
    });
  } catch {
    closedRejected = true;
  }
  assert(closedRejected, 'Closed AG session must reject votes');

  // Open another AG where voter is absent and tries to supply forged weight
  const openAg = await createAssembleeGenerale({
    buildingId: createdBld.id,
    syndicId: syndic.id,
    title: 'AGE 2026',
    type: 'extraordinaire',
    date: '2026-12-01',
    time: '18:00',
    location: 'Casablanca',
    status: 'in_progress',
    convocationSentAt: new Date().toISOString(),
    totalTantiemes: 1000,
    presentTantiemes: 500,
    quorumReached: true,
    attendees: [
      {
        residentId: resident1.id,
        residentName: resident1.name,
        apartmentNumber: apt1.number,
        tantiemes: 500,
        status: 'present',
      },
    ],
    resolutions: [
      {
        id: 'res-open-1',
        number: 1,
        title: 'Approbation comptes',
        description: 'Vote ordinaire',
        majorityType: 'simple_24',
        votesFor: 0,
        votesAgainst: 0,
        votesAbstain: 0,
        status: 'pending',
        voterChoices: [],
      },
    ],
  });

  let unauthorizedVoterRejected = false;
  try {
    await castResidentAGVote(openAg.id, 'res-open-1', {
      residentId: 'unauthorized-resident-999',
      residentName: 'Intrus',
      apartmentNumber: 'Z99',
      tantiemes: 900,
      choice: 'for',
    });
  } catch {
    unauthorizedVoterRejected = true;
  }
  assert(unauthorizedVoterRejected, 'Unauthorized voter absent from building/attendance must be rejected');

  // Authorized voter submits forged weight 999 -> service must enforce authoritative 500 tantièmes
  const updatedAg = await castResidentAGVote(openAg.id, 'res-open-1', {
    residentId: resident1.id,
    residentName: resident1.name,
    apartmentNumber: apt1.number,
    tantiemes: 999,
    choice: 'for',
  });
  assert(
    updatedAg?.resolutions[0].votesFor === 500,
    `Authoritative tantièmes (500) must override caller-supplied weight (999), got ${updatedAg?.resolutions[0].votesFor}`
  );
  console.log('✅ [20] AG voting session status, attendee eligibility & authoritative tantième weight checks passed.');

  // 9. Building Deletion Tombstones (Audit Item 18)
  await deleteBuilding(createdBld.id);
  const syndicsAfterDelete = await getSyndics();
  const deletedTombstones = JSON.parse(
    localStorage.getItem('syndik_deleted_building_ids_v1') || '[]'
  );
  assert(
    syndicsAfterDelete[0].buildings.length === 0 &&
      deletedTombstones.includes(createdBld.id),
    'Deleted building must be removed and recorded in deletion tombstones'
  );
  console.log('✅ [18] Building deletion & tombstone persistence passed.');

  console.log('\n🎉 ALL REGRESSION CHECKS PASSED SUCCESSFULLY.');
}

runVerification().catch((err) => {
  console.error('❌ Verification failed with unhandled error:', err);
  process.exit(1);
});
