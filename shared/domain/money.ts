import type { Building, Quittance } from '../../types';
/**
 * Centime-accurate budget allocation using largest-remainder method (Audit Item 16).
 * Guarantees that the sum of allocated amounts across lots equals totalBudgetMad to the exact centime.
 */
export function allocateBudgetInCentimes(
  totalBudgetMad: number,
  lots: { id: string; tantiemes: number }[],
  totalTantiemesOverride?: number
): Map<string, number> {
  const result = new Map<string, number>();
  const totalBudgetCentimes = centimes(totalBudgetMad);
  if (totalTantiemesOverride !== undefined &&
      (!Number.isFinite(totalTantiemesOverride) || totalTantiemesOverride < 0))
    throw new Error('Tantièmes invalides.');
  if (lots.some(lot => !Number.isFinite(lot.tantiemes) || lot.tantiemes < 0) ||
      new Set(lots.map(lot => lot.id)).size !== lots.length)
    throw new Error('Lots ou tantièmes invalides.');
  const denominator = lots.reduce((sum, lot) => sum + lot.tantiemes, 0);
  if (!Number.isFinite(denominator) || denominator <= 0)
    throw new Error('La somme des tantièmes doit être strictement positive.');

  const floors = lots.map((lot, idx) => {
    const share = lot.tantiemes;
    const exactCentimes = totalBudgetCentimes * (share / denominator);
    const floored = Math.floor(exactCentimes);
    const remainder = exactCentimes - floored;
    return { id: lot.id, idx, floored, remainder };
  });

  const allocatedCentimes = floors.reduce((acc, f) => acc + f.floored, 0);
  let leftoverCentimes = totalBudgetCentimes - allocatedCentimes;

  const sortedByRemainder = floors.filter(item => lots[item.idx].tantiemes > 0).sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) {
      return b.remainder - a.remainder;
    }
    return a.idx - b.idx;
  });

  for (let i = 0; i < sortedByRemainder.length && leftoverCentimes > 0; i++) {
    sortedByRemainder[i].floored += 1;
    leftoverCentimes -= 1;
  }

  if (leftoverCentimes !== 0 ||
      floors.reduce((sum, item) => sum + item.floored, 0) !== totalBudgetCentimes)
    throw new Error('La répartition ne conserve pas le budget en centimes.');
  for (const item of floors) {
    result.set(item.id, item.floored / 100);
  }

  if ([...result.values()].reduce((sum, value) => sum + centimes(value), 0) !== totalBudgetCentimes)
    throw new Error('La répartition ne conserve pas le budget en centimes.');
  return result;
}

export const allocateBudgetCentimes = allocateBudgetInCentimes;

/** Canonical configuration wins, including zero; percentage-only legacy records remain readable. */
export function getBuildingReserveRate(building?: Pick<Building, 'reserveFundRate' | 'reserveFundPercentage'>): number {
  const rate = building?.reserveFundRate ?? building?.reserveFundPercentage ?? 5;
  return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : 5;
}

/** Historical display must use recorded MAD amounts or the payment's own captured rate. */
export function getRecordedReserveSplit(receipt: Pick<Quittance,
  'amount' | 'reserveFundAmount' | 'chargesCourantesAmount' | 'reserveRateApplied'>): {
    reserveFundAmount: number; chargesCourantesAmount: number; reservePercentageUsed?: number;
  } | undefined {
  if (!Number.isFinite(receipt.amount) || receipt.amount < 0) return undefined;
  const total = Math.round(receipt.amount * 100);
  const cents = (value?: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) : undefined;
  let reserve = cents(receipt.reserveFundAmount), operating = cents(receipt.chargesCourantesAmount);
  const rate = receipt.reserveRateApplied;
  const knownRate = typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : undefined;
  if (reserve === undefined && operating === undefined) {
    return knownRate === undefined ? undefined : splitChargeReserveAndOperating(receipt.amount, knownRate);
  }
  reserve ??= total - operating!;
  operating ??= total - reserve;
  if (reserve < 0 || operating < 0 || reserve + operating !== total) return undefined;
  return { reserveFundAmount: reserve / 100, chargesCourantesAmount: operating / 100, reservePercentageUsed: knownRate };
}

/** Annual historical totals require documented allocations covering the recorded paid amount. */
export function getRecordedReserveTotal(receipts: Quittance[], paidAmount: number): number | undefined {
  const active = receipts.filter(receipt => !receipt.voidedAt);
  const allocations = active.map(getRecordedReserveSplit);
  if (allocations.some(split => !split) ||
      active.reduce((sum, receipt) => sum + Math.round(receipt.amount * 100), 0) !== Math.round(paidAmount * 100)) return undefined;
  return allocations.reduce((sum, split) => sum + Math.round(split!.reserveFundAmount * 100), 0) / 100;
}

/**
 * Splits a paid charge amount into operating (chargesCourantesAmount) and reserve (reserveFundAmount)
 * using the building's configured reserve percentage (default 5%) in centimes so the two parts sum to amountMad.
 */
export function splitChargeReserveAndOperating(
  amountMad: number,
  reservePercentage = 5
): {
  chargesCourantesAmount: number;
  reserveFundAmount: number;
  reservePercentageUsed: number;
} {
  const pct =
    Number.isFinite(reservePercentage) && reservePercentage >= 0 && reservePercentage <= 100
      ? reservePercentage
      : 5;
  const totalCentimes = Math.round(Math.max(0, Number(amountMad) || 0) * 100);
  const reserveCentimes = Math.round((totalCentimes * pct) / 100);
  const operatingCentimes = totalCentimes - reserveCentimes;
  return {
    chargesCourantesAmount: operatingCentimes / 100,
    reserveFundAmount: reserveCentimes / 100,
    reservePercentageUsed: pct,
  };
}


export function centimes(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount * 100))) throw new Error('Montant invalide.');
  return Math.round(amount * 100);
}

