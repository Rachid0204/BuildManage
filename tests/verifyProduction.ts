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
  approvePaymentProofsBatch,
  reconcileBankStatementCSV,
  getQuittancesForBuilding,
  createQuittance,
  generateQuittanceForCharge,
  addTransaction,
  createInvoiceForResident,
  recordPayment,
  getInvoicesForBuilding,
  createAssembleeGenerale,
  castResidentAGVote,
  generateChargesFromAGResolution,
  regenerateResidentCredentials,
  updateResident,
  savePrestataire,
  regeneratePrestataireCredentials,
  uploadDocument,
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
  assert(
    verifyPasswordSync(hashed, hashed, 'wahbi.rachid@gmail.com') === false,
    'Supplying the stored passwordHash itself as candidatePassword must be rejected (hash-as-password bypass check)'
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

  // 4. Repeat Monthly Charge Generation Uniqueness across French and ISO period formats (Audit Item 12)
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
  const thirdRunIso = await generateMonthlyCharges(
    createdBld.id,
    syndic.id,
    '2026-10',
    false
  );
  const allCharges = await getChargesForBuilding(createdBld.id);
  assert(
    firstRun.length === 1 &&
      secondRun.length === 0 &&
      thirdRunIso.length === 0 &&
      allCharges.length === 1,
    `Repeating monthly charge generation for 'Octobre 2026' and '2026-10' must produce 1 charge (got ${allCharges.length})`
  );
  console.log('✅ [12] Idempotent monthly charge generation (French + ISO period normalization) passed.');

  // 5. Payment Proof Re-approval, Partial Payment & Reserve Split (Audit Item 13 & 15)
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
    bldAfterPartial.financials.balance === 95 &&
      bldAfterPartial.financials.reserveFundBalance === 5,
    `Re-approving 100 MAD proof in 5% reserve building must post 95 MAD operating and 5 MAD reserve (got balance=${bldAfterPartial.financials.balance}, reserve=${bldAfterPartial.financials.reserveFundBalance})`
  );
  assert(
    chargesAfterPartial[0].status === 'unpaid' && chargesAfterPartial[0].paidAmount === 100,
    'Partial 100 MAD payment against 500 MAD charge must leave charge unpaid with paidAmount=100'
  );
  console.log('✅ [13] Idempotent payment proof approval, 95/5 MAD reserve ledger split & partial payment reconciliation passed.');

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

  const bldBeforeReissue = (await getSyndics())[0].buildings[0];
  const balanceBeforeReissue = bldBeforeReissue.financials.balance;
  const reserveBeforeReissue = bldBeforeReissue.financials.reserveFundBalance;
  assert(
    balanceBeforeReissue === 475 && reserveBeforeReissue === 25,
    `Expected operating balance 475 MAD and reserve 25 MAD (total 500 MAD), got balance=${balanceBeforeReissue}, reserve=${reserveBeforeReissue}`
  );

  // Simulate missing receipt or re-download via generateQuittanceForCharge
  localStorage.setItem(STORAGE_KEYS.QUITTANCES, JSON.stringify([]));
  const reissuedQuittance = await generateQuittanceForCharge(targetCharge.id, createdBld.id);
  const bldAfterReissue = (await getSyndics())[0].buildings[0];
  const balanceAfterReissue = bldAfterReissue.financials.balance;
  const reserveAfterReissue = bldAfterReissue.financials.reserveFundBalance;

  assert(
    balanceAfterReissue === 475 && reserveAfterReissue === 25,
    `Generating missing quittance for paid charge must never alter balance (expected 475/25, got ${balanceAfterReissue}/${reserveAfterReissue})`
  );
  assert(
    reissuedQuittance.reserveFundAmount === 25 &&
      reissuedQuittance.chargesCourantesAmount === 475,
    `500 MAD charge in 5% reserve building must split into 25 MAD reserve and 475 MAD operating`
  );
  console.log('✅ [14/16] Read-only missing receipt generation & 5% reserve split passed.');

  // 7. Reserve Fund KPI Single-Counting, Zero Reserve & Legacy Opening Balance Preservation (Audit Item 15)
  const bldZeroReserveClone = JSON.parse(
    JSON.stringify((await getSyndics())[0].buildings[0])
  );
  bldZeroReserveClone.financials.reserveFundBalance = 0;
  bldZeroReserveClone.financials.transactions = bldZeroReserveClone.financials.transactions.filter(
    (t: any) => t.fundType !== 'reserve' && t.category !== 'reserve'
  );
  const zeroReserveCheck = computeBuildingFundBalances(bldZeroReserveClone);
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
    afterReserveTrx.reserveBalance === 125,
    `25 MAD from charge reserve + single 100 MAD reserve contribution must equal 125 MAD, never double-counted (got ${afterReserveTrx.reserveBalance})`
  );

  // Verify legacy opening balance preservation (stored balance 1,000 + 100 income transaction -> 1,100)
  const legacyBld = {
    financials: {
      balance: 1100,
      reserveFundBalance: 0,
      transactions: [
        {
          id: 'trx-leg-1',
          date: new Date().toISOString(),
          description: 'Encaissement',
          amount: 100,
          type: 'income' as const,
          category: 'fees' as const,
          fundType: 'courant' as const,
        },
      ],
    },
  };
  const legacyBalances = computeBuildingFundBalances(legacyBld as any);
  assert(
    legacyBalances.operatingBalance === 1100,
    `Legacy opening balance 1,000 plus 100 income must display 1,100 (got ${legacyBalances.operatingBalance})`
  );
  console.log('✅ [15] Reserve fund single-counting, zero-balance & legacy opening balance preservation passed.');

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

  // Attempt to cast a second vote for lot A1 using a different residentId supplying apartmentNumber: 'A1'
  let crossLotHijackRejected = false;
  try {
    await castResidentAGVote(openAg.id, 'res-open-1', {
      residentId: 'res-hijack-2',
      residentName: 'Autre Résident',
      apartmentNumber: apt1.number,
      choice: 'for',
    });
  } catch {
    crossLotHijackRejected = true;
  }
  assert(
    crossLotHijackRejected,
    'Casting a vote as another residentId supplying apartmentNumber A1 must be rejected'
  );
  console.log('✅ [20] AG voting session status, attendee eligibility, cross-lot hijack rejection & authoritative tantième weight checks passed.');

  // 8b. AG Adopted Resolution -> Prorated Calls for Funds & Batch Proof / CSV Reconciliation Safety
  updatedAg.resolutions[0].budgetAmount = 2000;
  updatedAg.resolutions[0].status = 'approved';
  localStorage.setItem(STORAGE_KEYS.AG, JSON.stringify([updatedAg]));
  const agChargesOut = await generateChargesFromAGResolution(updatedAg.id, 'res-open-1');
  assert(
    agChargesOut.createdCharges.length === 2 && agChargesOut.totalAllocatedMad === 2000,
    `Expected 2 prorated AG charges totaling 2000 MAD, got ${agChargesOut.createdCharges.length} (${agChargesOut.totalAllocatedMad} MAD)`
  );

  // CSV safety: negative debit row (-500) and wrong-amount lot match (1 MAD) must be rejected
  const csvBadRows = await reconcileBankStatementCSV(createdBld.id, [
    {
      date: new Date().toISOString(),
      label: 'PRELEVEMENT FRAIS BANCAIRES LOT A1',
      amount: -1000,
      reference: 'DEB-001',
    },
    {
      date: new Date().toISOString(),
      label: 'VIREMENT LOT A1',
      amount: 1,
      reference: 'VIR-WRONG-AMT',
    },
  ]);
  assert(
    csvBadRows.matchedCount === 0 && csvBadRows.unmatchedCount === 2,
    `Negative bank debit (-1000) and mismatched amount (1 MAD vs 1000 MAD) must never reconcile a charge (matched=${csvBadRows.matchedCount})`
  );

  const csvReconciled = await reconcileBankStatementCSV(createdBld.id, [
    {
      date: new Date().toISOString(),
      label: 'VIREMENT LOT A1 YOUSSEF ALAMI',
      amount: 1000,
      reference: 'VIR-CSV-001',
    },
  ]);
  assert(
    csvReconciled.matchedCount === 1 && csvReconciled.totalReconciledMad === 1000,
    `Expected 1 CSV wire reconciled for 1000 MAD, got ${csvReconciled.matchedCount}`
  );

  // Re-importing the exact same CSV row must be idempotently skipped even when another 1,000 MAD charge (apt2) is still unpaid
  const csvDuplicateImport = await reconcileBankStatementCSV(createdBld.id, [
    {
      date: new Date().toISOString(),
      label: 'VIREMENT LOT A2 YOUSSEF ALAMI',
      amount: 1000,
      reference: 'VIR-CSV-001',
    },
  ]);
  assert(
    csvDuplicateImport.matchedCount === 0 && csvDuplicateImport.unmatchedCount === 1,
    `Re-importing the same bank reference VIR-CSV-001 must not reconcile a second charge (matched=${csvDuplicateImport.matchedCount})`
  );

  const remainingAgCharge = agChargesOut.createdCharges.find((c) => c.apartmentId === apt2.id)!;
  await submitPaymentProof({
    chargeId: remainingAgCharge.id,
    residentId: resident1.id,
    residentName: resident1.name,
    apartmentId: apt2.id,
    apartmentNumber: apt2.number,
    buildingId: createdBld.id,
    amount: 1000,
    paymentMethod: 'virement',
    bankName: 'CIH Bank',
    referenceNumber: 'VIR-BATCH-002',
  });
  const batchApproved = await approvePaymentProofsBatch(createdBld.id);
  assert(
    batchApproved.approvedCount === 1 && batchApproved.totalAmountMad === 1000,
    `Expected 1 exact-match proof batch-approved for 1000 MAD, got ${batchApproved.approvedCount}`
  );

  // Direct createQuittance partial payment & document-only mode + stale invoice recordPayment (60 + 40 = 100)
  const novCharges = await generateMonthlyCharges(createdBld.id, syndic.id, '2026-11', false);
  const novCharge = novCharges[0];
  novCharge.amount = 100;
  const storedChargesForNov = await getChargesForBuilding(createdBld.id);
  const novIdx = storedChargesForNov.findIndex((c) => c.id === novCharge.id);
  storedChargesForNov[novIdx].amount = 100;
  localStorage.setItem(STORAGE_KEYS.CHARGES, JSON.stringify(storedChargesForNov));

  // Document-only quittance (addTransactionToLedger: false) must NOT mark charge paid
  await createQuittance({
    chargeId: novCharge.id,
    buildingId: createdBld.id,
    buildingName: createdBld.name,
    syndicId: syndic.id,
    syndicName: syndic.name,
    residentId: resident1.id,
    residentName: resident1.name,
    apartmentId: apt1.id,
    apartmentNumber: apt1.number,
    tantiemes: 500,
    amount: 40,
    chargesCourantesAmount: 38,
    reserveFundAmount: 2,
    periodCovered: '2026-11',
    paymentDate: new Date().toISOString(),
    paymentMethod: 'virement',
    referenceNumber: 'DOC-ONLY-40',
    addTransactionToLedger: false,
  });
  const afterDocOnly = (await getChargesForBuilding(createdBld.id)).find(
    (c) => c.id === novCharge.id
  )!;
  assert(
    afterDocOnly.status === 'unpaid' && (afterDocOnly.paidAmount || 0) === 0,
    `createQuittance with addTransactionToLedger: false must not mark charge paid (status=${afterDocOnly.status}, paidAmount=${afterDocOnly.paidAmount})`
  );

  // Clear doc-only quittance and create a 40 MAD partial quittance with addTransactionToLedger: true
  localStorage.setItem(
    STORAGE_KEYS.QUITTANCES,
    JSON.stringify(
      (await getQuittancesForBuilding(createdBld.id)).filter(
        (q) => q.referenceNumber !== 'DOC-ONLY-40'
      )
    )
  );
  await createQuittance({
    chargeId: novCharge.id,
    buildingId: createdBld.id,
    buildingName: createdBld.name,
    syndicId: syndic.id,
    syndicName: syndic.name,
    residentId: resident1.id,
    residentName: resident1.name,
    apartmentId: apt1.id,
    apartmentNumber: apt1.number,
    tantiemes: 500,
    amount: 40,
    chargesCourantesAmount: 38,
    reserveFundAmount: 2,
    periodCovered: '2026-11',
    paymentDate: new Date().toISOString(),
    paymentMethod: 'virement',
    referenceNumber: 'PARTIAL-40',
    addTransactionToLedger: true,
  });
  const afterPartialQuit = (await getChargesForBuilding(createdBld.id)).find(
    (c) => c.id === novCharge.id
  )!;
  assert(
    afterPartialQuit.status === 'unpaid' && afterPartialQuit.paidAmount === 40,
    `40 MAD quittance on 100 MAD charge must set paidAmount=40 and status='unpaid' (got status=${afterPartialQuit.status}, paidAmount=${afterPartialQuit.paidAmount})`
  );

  // Invoice partial payment with stale caller object: 60 MAD + 40 MAD on a 100 MAD invoice -> 100 MAD paid
  const decCharges = await generateMonthlyCharges(createdBld.id, syndic.id, '2026-12', false);
  const decCharge = decCharges[0];
  const allChgsDec = await getChargesForBuilding(createdBld.id);
  // Mark novCharge paid so createInvoiceForResident bills only decCharge (100 MAD)
  allChgsDec.forEach((c) => {
    if (c.id === novCharge.id) {
      c.paidAmount = 100;
      c.status = 'paid';
    }
    if (c.id === decCharge.id) {
      c.amount = 100;
      c.paidAmount = 0;
      c.status = 'unpaid';
    }
  });
  localStorage.setItem(STORAGE_KEYS.CHARGES, JSON.stringify(allChgsDec));

  const createdInv = await createInvoiceForResident(resident1.id, createdBld.id, syndic.id);
  const staleInvoiceCopy1 = { ...createdInv, paidAmount: 0 };
  const staleInvoiceCopy2 = { ...createdInv, paidAmount: 0 };
  await recordPayment(staleInvoiceCopy1, 60, 'virement');
  await recordPayment(staleInvoiceCopy2, 40, 'virement');
  const storedInvAfter2 = (await getInvoicesForBuilding(createdBld.id)).find(
    (i) => i.id === createdInv.id
  )!;
  assert(
    storedInvAfter2.paidAmount === 100 && storedInvAfter2.status === 'paid',
    `Two partial invoice payments (60 + 40) with stale caller reference must accumulate to 100 MAD paid (got paidAmount=${storedInvAfter2.paidAmount}, status=${storedInvAfter2.status})`
  );
  console.log('✅ [Phase 3/4] AG budget-to-charges, CSV bank reconciliation safety, partial quittance & stale-object invoice payment checks passed.');

  // 8c. Resident & Prestataire Credential Generation, Regeneration, Edit Preservation & Registry Sync
  const regRes = await regenerateResidentCredentials(resident1.id);
  const resInvitePass = regRes.invitationCode || regRes.invitationToken || '';
  assert(Boolean(resInvitePass), 'Regenerated resident must have a valid invitationCode/invitationToken');
  const editedRes = await updateResident({
    ...regRes,
    cin: 'BK987654',
    phone: '0611223344',
  });
  assert(
    editedRes.invitationCode === resInvitePass && editedRes.cin === 'BK987654',
    'Editing a resident must preserve invitationCode and update CIN'
  );
  const resAccounts = JSON.parse(localStorage.getItem(STORAGE_KEYS.RESIDENT_ACCOUNTS) || '[]');
  const matchedResAcc = resAccounts.find((a: any) => a.residentId === resident1.id);
  assert(
    matchedResAcc &&
      matchedResAcc.cin === 'BK987654' &&
      verifyPasswordSync(resInvitePass, matchedResAcc.passwordHash, resident1.email.toLowerCase()),
    'Resident account hash must verify against invitationCode and carry updated CIN'
  );

  const createdPrest = await savePrestataire(
    {
      id: 'prest-test-1',
      syndicId: '',
      buildingId: createdBld.id,
      name: 'Atlas Ascenseurs SARL',
      contactPerson: 'Hassan',
      category: 'elevator',
      phone: '0522001122',
      email: 'contact@atlas-ascenseurs.ma',
      rating: 4.9,
      active: true,
    },
    true
  );
  const prestPass = createdPrest.generatedPassword || createdPrest.invitationToken || '';
  assert(
    Boolean(prestPass) && createdPrest.syndicId === syndic.id,
    'Saved prestataire with credentials must have temporary password and resolved syndicId'
  );
  const regenPrest = await regeneratePrestataireCredentials(createdPrest.id);
  const regenPrestPass = regenPrest.generatedPassword || regenPrest.invitationToken || '';
  assert(
    Boolean(regenPrestPass) && regenPrestPass !== prestPass,
    'Regenerated prestataire must receive a new temporary password'
  );
  const prestAccounts = JSON.parse(localStorage.getItem(STORAGE_KEYS.PRESTATAIRE_ACCOUNTS) || '[]');
  const matchedPrestAcc = prestAccounts.find((a: any) => a.prestataireId === createdPrest.id);
  assert(
    matchedPrestAcc &&
      matchedPrestAcc.syndicId === syndic.id &&
      verifyPasswordSync(
        regenPrestPass,
        matchedPrestAcc.passwordHash,
        'contact@atlas-ascenseurs.ma'
      ),
    'Prestataire account hash must verify against regenerated password'
  );
  const regUsers = JSON.parse(localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS) || '[]');
  const syncedResUser = regUsers.find((u: any) => u.profile?.residentId === resident1.id);
  const syncedPrestUser = regUsers.find((u: any) => u.profile?.prestataireId === createdPrest.id);
  assert(
    syncedResUser?.profile?.residentId === resident1.id &&
      syncedPrestUser?.profile?.prestataireId === createdPrest.id &&
      syncedPrestUser?.profile?.prestataireCategory === 'elevator',
    'REGISTERED_USERS must stay synchronized with canonical residentId and prestataireId/prestataireCategory'
  );
  console.log('✅ [Auth] Resident & Prestataire credential generation, regeneration, edit preservation & registry sync passed.');

  // 9. Durable 70,000-byte Document Upload Preservation & Blocked Network Write Failure Propagation (Audit Items 18 & 19)
  const raw70k = new Uint8Array(70000);
  for (let i = 0; i < raw70k.length; i++) {
    raw70k[i] = i % 251;
  }
  const synthetic70kFile = {
    name: 'pv-ag-70k.pdf',
    size: raw70k.byteLength,
    type: 'application/pdf',
    arrayBuffer: async () => raw70k.buffer,
  } as unknown as File;
  const uploadedDoc = await uploadDocument(createdBld.id, synthetic70kFile);
  const b64Payload = uploadedDoc.url.split(',')[1] || '';
  const decodedBytes = Buffer.from(b64Payload, 'base64');
  assert(
    decodedBytes.length === 70000 && decodedBytes[69999] === 69999 % 251,
    `70,000-byte upload must preserve all 70,000 bytes without 65,536-byte truncation (got ${decodedBytes.length} bytes)`
  );
  console.log('✅ [19] 70,000-byte document upload binary integrity preserved without truncation.');

  // 10. Building Deletion Tombstones & Foreground Network Error Propagation (Audit Item 18)
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

  // Simulate active session + blocked network write (e.g. offline/403/500) -> saveSyndic must reject and mark syndik_sync_status_v1 = 'failed'
  localStorage.setItem('syndik_auth_session_v1', JSON.stringify(signedEnvelope));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('Failed to fetch: simulated network outage');
  }) as unknown as typeof fetch;
  let networkFailurePropagated = false;
  try {
    await saveSyndic(syndicsAfterDelete[0]);
  } catch {
    networkFailurePropagated = true;
  } finally {
    globalThis.fetch = originalFetch;
    localStorage.removeItem('syndik_auth_session_v1');
  }
  assert(
    networkFailurePropagated && localStorage.getItem('syndik_sync_status_v1') === 'failed',
    'Blocked network write during foreground saveSyndic must reject and mark syndik_sync_status_v1 = failed'
  );
  console.log('✅ [18] Building deletion tombstones & foreground network write failure propagation passed.');

  console.log('\n🎉 ALL REGRESSION CHECKS PASSED SUCCESSFULLY.');
}

runVerification().catch((err) => {
  console.error('❌ Verification failed with unhandled error:', err);
  process.exit(1);
});
