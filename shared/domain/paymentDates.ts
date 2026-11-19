/** Strict calendar validation; accepts ISO dates/timestamps and bank DD/MM/YYYY dates. */
export function bankDate(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Date bancaire invalide.');
  const raw = value.trim();
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  const iso = local ? `${local[3]}-${local[2]}-${local[1]}` : raw;
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(iso))
    throw new Error('Date bancaire invalide (AAAA-MM-JJ ou JJ/MM/AAAA).');
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const time = iso.includes('T') ? iso.slice(11, 19).split(':').map(Number) : [0, 0, 0];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
      time[0] > 23 || time[1] > 59 || time[2] > 59)
    throw new Error('Date bancaire invalide.');
  return iso.slice(0, 10);
}

/**
 * Pure canonical status for a charge or invoice based on remaining balance (centimes)
 * and a caller-supplied YYYY-MM-DD reference date.
 */
export function resolveOpenStatus(
  dueDate: string | undefined | null,
  remainingCents: number,
  todayIso: string,
): 'paid' | 'overdue' | 'unpaid' {
  if (remainingCents <= 0) return 'paid';
  const due = typeof dueDate === 'string' ? dueDate.slice(0, 10) : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(due) && /^\d{4}-\d{2}-\d{2}$/.test(todayIso) && due < todayIso) {
    return 'overdue';
  }
  return 'unpaid';
}

export function isChargeEffectivelyOverdue(
  charge: {
    status?: string;
    amount?: number;
    paidAmount?: number;
    dueDate?: string;
  },
  todayIso: string,
): boolean {
  if (charge.status === 'paid') return false;
  const remainingCents =
    Math.round((Number(charge.amount) || 0) * 100) -
    Math.round((Number(charge.paidAmount) || 0) * 100);
  if (remainingCents <= 0) return false;
  if (charge.status === 'overdue') return true;
  return resolveOpenStatus(charge.dueDate, remainingCents, todayIso) === 'overdue';
}
