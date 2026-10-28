import { bankDate } from '../../shared/domain/paymentDates';
import type { PaymentDates, PaymentPostingOptions } from '../../types';
import type { DomainContext } from './context';
import { OperationError } from './errors';

export function paymentDates(context: DomainContext, buildingId: string, actual: string | undefined,
  submitted: string, options: PaymentPostingOptions = {}): PaymentDates {
  const bankTransactionDate = actual === undefined ? undefined : bankDate(actual);
  const defaultDate = bankTransactionDate ?? bankDate(submitted);
  const postingDate = options.postingDate === undefined ? defaultDate : bankDate(options.postingDate);
  const reason = options.priorPeriodAdjustmentReason?.trim();
  const closed = (date: string) => Boolean(context.state.__closedPeriods?.[`${buildingId}:${date.slice(0, 7)}`]);
  if (closed(postingDate)) throw new OperationError('Période comptable clôturée pour la date de comptabilisation.', 409);
  if (postingDate !== defaultDate || closed(defaultDate)) {
    if (!['syndic', 'admin'].includes(context.actor.role) || !options.postingDate || !reason || reason.length < 3 || reason.length > 1000)
      throw new OperationError('Ajustement explicite requis : date de comptabilisation ouverte et motif obligatoires.', 409);
  }
  return { bankTransactionDate, submissionDate: submitted, postingDate,
    ...(reason ? { priorPeriodAdjustmentReason: reason } : {}) };
}
