import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDefaultLockMonth,
  findReversiblePayments,
  formatStatementsCsv,
  formatLedgerCsv,
} from '../components/views/finance/financeReportExport';
import type { Transaction } from '../types';

test('computeDefaultLockMonth returns previous calendar month across year boundaries', () => {
  assert.equal(computeDefaultLockMonth('2026-11-26'), '2026-10');
  assert.equal(computeDefaultLockMonth('2026-01-05'), '2025-12');
  assert.equal(computeDefaultLockMonth('2026-03-31'), '2026-02');
});

test('findReversiblePayments sums split reserve/operating entries and excludes reversed, transfer, and misc income', () => {
  const ledger = [
    // Valid payment split across courant (360) + reserve (40) = 400 MAD
    {
      id: 't1',
      paymentId: 'pay-valid',
      type: 'income',
      amount: 360,
      date: '2026-11-10',
      description: 'Cotisation Lot A1',
      sourceChargeId: 'chg-1',
    },
    {
      id: 't2',
      paymentId: 'pay-valid',
      type: 'income',
      amount: 40,
      date: '2026-11-10',
      description: 'Dotation réserve Lot A1',
      sourceChargeId: 'chg-1',
    },
    // Already reversed payment
    {
      id: 't3',
      paymentId: 'pay-reversed',
      type: 'income',
      amount: 250,
      date: '2026-11-05',
      description: 'Cotisation Lot B2',
      sourceChargeId: 'chg-2',
    },
    {
      id: 't4',
      type: 'expense',
      amount: -250,
      date: '2026-11-06',
      description: 'Contrepassation',
      reversalOf: 'pay-reversed',
    },
    // Inter-fund transfer (must not be reversible as resident payment)
    {
      id: 't5',
      paymentId: 'xf-1:in',
      transferId: 'xf-1',
      type: 'income',
      amount: 1000,
      date: '2026-11-02',
      description: 'Virement interne',
    },
    // Misc income without charge allocation (must not be reversible via reversePayment)
    {
      id: 't6',
      paymentId: 'misc-1',
      type: 'income',
      amount: 500,
      date: '2026-11-01',
      description: 'Remboursement assurance',
    },
  ] as unknown as Transaction[];

  const map = findReversiblePayments(ledger);
  assert.equal(map.size, 1);
  assert.deepEqual(map.get('pay-valid'), {
    paymentId: 'pay-valid',
    totalAmount: 400,
    description: 'Cotisation Lot A1',
    date: '2026-11-10',
  });
});

test('formatStatementsCsv and formatLedgerCsv emit UTF-8 BOM, localized headers, and escape spreadsheet formulas', () => {
  const statementsCsv = formatStatementsCsv(
    [
      {
        residentId: 'r1',
        name: '=HYPERLINK("http://evil")',
        billed: 900,
        paid: 550,
        openingArrearsBilled: 350,
        openingArrearsOutstanding: 350,
        outstanding: 350,
        over90Days: 0,
      },
    ],
    false,
  );

  assert.ok(statementsCsv.startsWith('\uFEFF"Copropriétaire";"Total appelé (MAD)";"Déjà payé (MAD)"'));
  assert.ok(statementsCsv.includes('"\'=HYPERLINK(""http://evil"")"'));
  assert.ok(!statementsCsv.includes('residentId'));

  const arStatementsCsv = formatStatementsCsv([], true);
  assert.ok(arStatementsCsv.startsWith('\uFEFF"المالك المشترك"'));

  const ledgerCsv = formatLedgerCsv(
    [
      {
        id: 'trx-1',
        date: '2026-11-12',
        description: '+Facture ascenseur',
        type: 'expense',
        fundType: 'courant',
        category: 'elevator',
        amount: -450,
        paymentMethod: 'virement',
        reference: 'VIR-99',
        thirdPartyName: 'Atlas Ascenseurs',
      } as Transaction,
    ],
    false,
  );
  assert.ok(ledgerCsv.startsWith('\uFEFF"Date";"Libellé";"Sens";"Fonds"'));
  assert.ok(ledgerCsv.includes('"\'+Facture ascenseur"'));
});
