export * from '../shared/domain/subscription';
export function subscriptionCanWrite(cabinet: any) {
  return (
    ["active", "trialing"].includes(cabinet.subscriptionStatus) &&
    Number.isFinite(Date.parse(cabinet.subscriptionExpiry)) &&
    Date.parse(cabinet.subscriptionExpiry) > Date.now()
  );
}

