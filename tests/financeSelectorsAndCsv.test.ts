import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitCsvRecord,
  parseBankCsvAmount,
  parseBankCsvRows,
} from '../components/views/finance/bankCsv';
import {
  computeAvailableFiscalYears,
  computeFinanceOverviewStats,
  groupOverdueChargesByResident,
  computeAgingBuckets,
  filterTransactions,
  computeFilteredTransactionStats,
  filterQuittances,
  computeQuittanceTotals,
  computeChargePreview,
} from '../components/views/finance/financeSelectors';
import type { Building, Charge, PaymentProof, Quittance, Transaction } from '../types';

test('parseBankCsvAmount handles Moroccan spaced MAD amounts, comma decimals, and signed debits', () => {
  assert.equal(parseBankCsvAmount('1 250,50 MAD'), 1250.5);
  assert.equal(parseBankCsvAmount('2.400,75 DH'), 2400.75);
  assert.equal(parseBankCsvAmount('-350,00'), -350);
  assert.ok(Number.isNaN(parseBankCsvAmount('non-numeric')));
});

test('parseBankCsvRows handles semicolon headers with quoted decimals and credit/debit columns', () => {
  const csv = [
    '\uFEFFDate;Libellé;Référence;Débit;Crédit',
    '2026-11-02;"Virement Lot A1, Nadia";VIR-001;;"1 250,50 MAD"',
    '2026-11-05;"Facture Redal";FAC-99;"420,25";',
  ].join('\r\n');

  assert.deepEqual(splitCsvRecord('2026-11-02;"Virement Lot A1, Nadia";VIR-001', ';'), [
    '2026-11-02',
    'Virement Lot A1, Nadia',
    'VIR-001',
  ]);

  const rows = parseBankCsvRows(csv);
  assert.deepEqual(rows, [
    {
      date: '2026-11-02',
      label: 'Virement Lot A1, Nadia',
      amount: 1250.5,
      reference: 'VIR-001',
    },
    {
      date: '2026-11-05',
      label: 'Facture Redal',
      amount: -420.25,
      reference: 'FAC-99',
    },
  ]);
});

test('computeAvailableFiscalYears merges 5-year rolling window with charge years sorted descending', () => {
  const charges = [
    { period: '2020-05', dueDate: '2020-05-31' },
    { period: 'Janvier 2028', dueDate: '2028-01-31' },
  ] as Charge[];
  const years = computeAvailableFiscalYears(charges, 2026);
  assert.deepEqual(years, [2028, 2026, 2025, 2024, 2023, 2022, 2020]);
});

test('groupOverdueChargesByResident aggregates multi-lot owners, oldest dueDate, and computeAgingBuckets buckets accurately', () => {
  const building = {
    id: 'b1',
    name: 'Résidence Test',
    syndicId: 's1',
    address: 'Casablanca',
    city: 'Casablanca',
    monthlySyndicFees: 300,
    totalTantiemes: 1000,
    apartments: [
      { id: 'a1', number: 'A1', floor: 1, area: 80, ownerId: 'r1', tenantId: null, monthlyFees: 300, buildingId: 'b1' },
      { id: 'a2', number: 'A2', floor: 1, area: 90, ownerId: 'r1', tenantId: null, monthlyFees: 350, buildingId: 'b1' },
    ],
    residents: [
      { id: 'r1', name: 'Youssef Tazi', email: 'y@t.ma', phone: '0600000000', isOwner: true, buildingId: 'b1', syndicId: 's1' },
    ],
    financials: { balance: 1200, reserveFund: 500, transactions: [] },
  } as unknown as Building;

  const charges: Charge[] = [
    {
      id: 'c1',
      syndicId: 's1',
      buildingId: 'b1',
      apartmentId: 'a1',
      residentId: 'r1',
      amount: 300,
      paidAmount: 100,
      dueDate: '2026-11-10',
      status: 'overdue',
      createdAt: '2026-11-01',
    },
    {
      id: 'c2',
      syndicId: 's1',
      buildingId: 'b1',
      apartmentId: 'a2',
      residentId: 'r1',
      amount: 350,
      paidAmount: 0,
      dueDate: '2026-07-01',
      status: 'overdue',
      createdAt: '2026-07-01',
    },
    {
      id: 'c3',
      syndicId: 's1',
      buildingId: 'b1',
      apartmentId: 'a1',
      residentId: 'r1',
      amount: 300,
      paidAmount: 0,
      dueDate: '2099-12-31',
      status: 'pending',
      createdAt: '2026-11-01',
    },
  ];

  const grouped = groupOverdueChargesByResident(charges, building, 'Copropriétaire');
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].residentName, 'Youssef Tazi');
  assert.equal(grouped[0].apartmentNumber, 'A1, A2');
  assert.equal(grouped[0].totalOverdue, 550);
  assert.equal(grouped[0].overdueCount, 2);
  assert.equal(grouped[0].oldestDate, '2026-07-01');

  const aging = computeAgingBuckets(charges, '2026-11-26');
  assert.deepEqual(aging, {
    d0_30: 200,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 350,
  });

  const proofs = [{ id: 'p1', status: 'pending' }, { id: 'p2', status: 'approved' }] as PaymentProof[];
  const overview = computeFinanceOverviewStats(building, charges, proofs);
  assert.equal(overview.pendingChargesTotal, 300);
  assert.equal(overview.overdueChargesTotal, 550);
  assert.equal(overview.pendingProofsCount, 1);
});

test('filterTransactions and computeFilteredTransactionStats exclude inter-fund transfers in all-funds view and exclude reversals from gross totals', () => {
  const allTransactions = [
    { id: 't-inc', date: '2026-11-01', description: 'Cotisation A1', amount: 500, type: 'income', fundType: 'courant', category: 'fees' },
    { id: 't-exp', date: '2026-11-02', description: 'Facture ascenseur', amount: -200, type: 'expense', fundType: 'courant', category: 'elevator' },
    { id: 't-rev-orig', date: '2026-11-03', description: 'Erreur saisie', amount: -150, type: 'expense', fundType: 'courant', category: 'other' },
    { id: 't-rev-entry', date: '2026-11-04', description: 'Contrepassation', amount: 150, type: 'income', fundType: 'courant', category: 'other', reversalOf: 't-rev-orig' },
    { id: 't-xfer-out', date: '2026-11-05', description: 'Virement interne', amount: -100, type: 'expense', fundType: 'courant', transferId: 'xf-1' },
    { id: 't-xfer-in', date: '2026-11-05', description: 'Virement interne', amount: 100, type: 'income', fundType: 'reserve', transferId: 'xf-1' },
  ] as Transaction[];

  const allFiltered = filterTransactions(allTransactions, {
    fund: 'all',
    type: 'all',
    category: 'all',
    search: '',
  });
  const statsAll = computeFilteredTransactionStats(allTransactions, allFiltered, 'all');
  assert.deepEqual(statsAll, {
    income: 500,
    expense: 200,
    net: 300,
    count: 6,
  });

  const searchElevator = filterTransactions(allTransactions, {
    fund: 'courant',
    type: 'expense',
    category: 'all',
    search: 'ascenseur',
  });
  assert.equal(searchElevator.length, 1);
  assert.equal(searchElevator[0].id, 't-exp');
});

test('filterQuittances and computeQuittanceTotals exclude voided receipts from active totals and computeChargePreview allocates tantiemes', () => {
  const quittances = [
    {
      id: 'q1',
      quittanceNumber: 'QUIT-01',
      residentName: 'Nadia',
      apartmentNumber: 'A1',
      amount: 400,
      chargesCourantesAmount: 360,
      reserveFundAmount: 40,
      paymentMethod: 'virement',
    },
    {
      id: 'q2',
      quittanceNumber: 'QUIT-02',
      residentName: 'Karim',
      apartmentNumber: 'B2',
      amount: 400,
      chargesCourantesAmount: 360,
      reserveFundAmount: 40,
      paymentMethod: 'especes',
      voidedAt: '2026-11-10T00:00:00Z',
    },
  ] as Quittance[];

  assert.equal(filterQuittances(quittances, 'nadia', 'all').length, 1);
  assert.equal(filterQuittances(quittances, '', 'virement').length, 1);
  assert.deepEqual(computeQuittanceTotals(quittances), {
    activeCount: 1,
    totalAmount: 400,
    totalReserveFundAmount: 40,
  });

  const building = {
    id: 'b1',
    totalTantiemes: 1000,
    monthlySyndicFees: 250,
    apartments: [
      { id: 'a1', number: 'A1', ownerId: 'r1', tenantId: null, monthlyFees: 300, tantiemes: 600 },
      { id: 'a2', number: 'A2', ownerId: null, tenantId: null, monthlyFees: 200, tantiemes: 400 },
    ],
    residents: [{ id: 'r1', apartmentId: 'a1' }],
  } as unknown as Building;

  const preview = computeChargePreview({
    building,
    charges: [],
    periodName: '2026-11',
    useTantiemes: true,
    totalBudgetInput: '1000',
  });
  assert.equal(preview.vacantLotsInTantiemesMode, 1);
  assert.deepEqual(preview.chargePreview, [{ id: 'a1', number: 'A1', existing: false, amount: 600 }]);
});
