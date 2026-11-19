import {
  isChargeEffectivelyOverdue as isChargeEffectivelyOverduePure,
  resolveOpenStatus as resolveOpenStatusPure,
} from './domain/paymentDates';

/** Returns YYYY-MM-DD in Africa/Casablanca timezone. */
export function todayCasablancaIsoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
  }).format(now);
}

/** Resolves open status using Morocco's Africa/Casablanca calendar date by default. */
export function resolveOpenStatus(
  dueDate: string | undefined | null,
  remainingCents: number,
  today: string = todayCasablancaIsoDate(),
): 'paid' | 'overdue' | 'unpaid' {
  return resolveOpenStatusPure(dueDate, remainingCents, today);
}

/** Determines whether a charge is effectively overdue relative to Morocco's calendar date. */
export function isChargeEffectivelyOverdue(
  charge: {
    status?: string;
    amount?: number;
    paidAmount?: number;
    dueDate?: string;
  },
  today: string = todayCasablancaIsoDate(),
): boolean {
  return isChargeEffectivelyOverduePure(charge, today);
}
