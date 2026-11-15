import type { SubscriptionStatus } from '../types';
export * from '../shared/domain/subscription';

export function getEffectiveSubscriptionStatus(
  cabinet: {
    subscriptionStatus?: string;
    subscriptionExpiry?: string;
  },
  nowMs: number = Date.now(),
): SubscriptionStatus {
  if (cabinet.subscriptionStatus === 'cancelled') return 'cancelled';
  const rawExpiry = (cabinet.subscriptionExpiry || '').trim();
  const normalizedExpiry = /^\d{4}-\d{2}-\d{2}$/.test(rawExpiry)
    ? `${rawExpiry}T23:59:59.999Z`
    : rawExpiry;
  const expiryMs = Date.parse(normalizedExpiry);
  if (
    cabinet.subscriptionStatus === 'expired' ||
    !Number.isFinite(expiryMs) ||
    expiryMs <= nowMs
  ) {
    return 'expired';
  }
  if (cabinet.subscriptionStatus === 'trialing') return 'trialing';
  if (cabinet.subscriptionStatus === 'active') return 'active';
  return 'expired';
}

export function subscriptionCanWrite(cabinet: {
  subscriptionStatus?: string;
  subscriptionExpiry?: string;
}) {
  const effective = getEffectiveSubscriptionStatus(cabinet);
  return effective === 'active' || effective === 'trialing';
}


