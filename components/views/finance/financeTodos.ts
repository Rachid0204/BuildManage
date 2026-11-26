import { normalizeBillingPeriodKey } from '../../../shared/domain/billingPeriod';

export type FinanceTodo =
  | { kind: 'verifyTransfers'; count: number }
  | { kind: 'overdue'; residents: number; amount: number }
  | { kind: 'chargesNotIssued'; period: string }
  | { kind: 'unmatchedBankRows'; count: number };

export interface BuildFinanceTodosInput {
  pendingProofsCount: number;
  overdueResidentsCount: number;
  overdueAmount: number;
  charges: ReadonlyArray<{ period?: string; chargeType?: string }>;
  currentPeriod: string;
  unmatchedBankRows: number;
  hasBillableLots?: boolean;
}

export function buildFinanceTodos(input: BuildFinanceTodosInput): FinanceTodo[] {
  const todos: FinanceTodo[] = [];

  if (input.pendingProofsCount > 0) {
    todos.push({ kind: 'verifyTransfers', count: input.pendingProofsCount });
  }

  if (input.overdueResidentsCount > 0) {
    todos.push({
      kind: 'overdue',
      residents: input.overdueResidentsCount,
      amount: Math.max(0, Math.round((input.overdueAmount || 0) * 100) / 100),
    });
  }

  const normalizedCurrent = normalizeBillingPeriodKey(input.currentPeriod || '');
  const hasBillableLots = input.hasBillableLots ?? true;
  if (hasBillableLots && normalizedCurrent) {
    const issuedForPeriod = input.charges.some(
      (charge) =>
        (charge.chargeType || 'courante') === 'courante' &&
        normalizeBillingPeriodKey(charge.period || '') === normalizedCurrent,
    );
    if (!issuedForPeriod) {
      todos.push({ kind: 'chargesNotIssued', period: normalizedCurrent });
    }
  }

  if (input.unmatchedBankRows > 0) {
    todos.push({ kind: 'unmatchedBankRows', count: input.unmatchedBankRows });
  }

  return todos;
}
