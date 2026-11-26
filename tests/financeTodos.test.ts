import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinanceTodos } from '../components/views/finance/financeTodos';

test('buildFinanceTodos returns empty list when everything is up to date and current period is issued', () => {
  const todos = buildFinanceTodos({
    pendingProofsCount: 0,
    overdueResidentsCount: 0,
    overdueAmount: 0,
    charges: [{ period: '2026-11', chargeType: 'courante' }],
    currentPeriod: '2026-11',
    unmatchedBankRows: 0,
    hasBillableLots: true,
  });
  assert.deepEqual(todos, []);
});

test('buildFinanceTodos matches current period across localized French/Arabic period strings', () => {
  const frTodos = buildFinanceTodos({
    pendingProofsCount: 0,
    overdueResidentsCount: 0,
    overdueAmount: 0,
    charges: [{ period: 'Novembre 2026', chargeType: 'courante' }],
    currentPeriod: '2026-11',
    unmatchedBankRows: 0,
    hasBillableLots: true,
  });
  assert.deepEqual(frTodos, []);

  const worksOnlyTodos = buildFinanceTodos({
    pendingProofsCount: 0,
    overdueResidentsCount: 0,
    overdueAmount: 0,
    charges: [{ period: '2026-11', chargeType: 'travaux' }],
    currentPeriod: '2026-11',
    unmatchedBankRows: 0,
    hasBillableLots: true,
  });
  assert.deepEqual(worksOnlyTodos, [{ kind: 'chargesNotIssued', period: '2026-11' }]);
});

test('buildFinanceTodos suppresses chargesNotIssued when building has no billable lots linked yet', () => {
  const todos = buildFinanceTodos({
    pendingProofsCount: 0,
    overdueResidentsCount: 0,
    overdueAmount: 0,
    charges: [],
    currentPeriod: '2026-11',
    unmatchedBankRows: 0,
    hasBillableLots: false,
  });
  assert.deepEqual(todos, []);
});

test('buildFinanceTodos orders todos: verifyTransfers -> overdue -> chargesNotIssued -> unmatchedBankRows', () => {
  const todos = buildFinanceTodos({
    pendingProofsCount: 2,
    overdueResidentsCount: 5,
    overdueAmount: 7400,
    charges: [{ period: '2026-10', chargeType: 'courante' }],
    currentPeriod: '2026-11',
    unmatchedBankRows: 3,
    hasBillableLots: true,
  });

  assert.deepEqual(todos, [
    { kind: 'verifyTransfers', count: 2 },
    { kind: 'overdue', residents: 5, amount: 7400 },
    { kind: 'chargesNotIssued', period: '2026-11' },
    { kind: 'unmatchedBankRows', count: 3 },
  ]);
});
