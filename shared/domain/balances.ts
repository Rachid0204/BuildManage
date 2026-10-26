import type { Building } from '../../types';
/**
 * Fund totals = one opening balance + signed ledger movements, in integer centimes.
 * Canonical openings (including zero) take precedence over the legacy working alias.
 * Aggregate-only legacy records infer their opening from stored total minus ledger delta.
 * This is a read-only projection: no stored totals, aliases or ledger entries are migrated.
 */
export function computeBuildingFinancialBalances(building?: Building | null): {
  workingBalance: number;
  operatingBalance: number;
  reserveBalance: number;
} {
  if (!building) {
    return { workingBalance: 0, operatingBalance: 0, reserveBalance: 0 };
  }

  const financials = building.financials;
  const transactions = financials?.transactions || (building as any)?.transactions || [];
  const toCentimes = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const amount = Number(value);
    return Number.isFinite(amount) ? Math.round(amount * 100) : undefined;
  };
  let workingDelta = 0, reserveDelta = 0;
  for (const transaction of transactions) {
    const amount = toCentimes(transaction.amount) ?? 0;
    const signed = transaction.type === 'expense' ? -Math.abs(amount)
      : transaction.type === 'income' ? Math.abs(amount) : amount;
    if (transaction.fundType === 'reserve') reserveDelta += signed;
    else workingDelta += signed;
  }

  const openingWorking = toCentimes(financials?.openingWorkingBalance)
    ?? toCentimes(financials?.openingBalance)
    ?? ((toCentimes(financials?.balance) ?? workingDelta) - workingDelta);
  const openingReserve = toCentimes(financials?.openingReserveBalance)
    ?? ((toCentimes(financials?.reserveFundBalance) ?? reserveDelta) - reserveDelta);
  const working = (openingWorking + workingDelta) / 100 || 0;
  const reserve = (openingReserve + reserveDelta) / 100 || 0;
  return {
    workingBalance: working,
    operatingBalance: working,
    reserveBalance: reserve,
  };
}

export const computeBuildingFundBalances = computeBuildingFinancialBalances;

