export const PLANS = {
  starter: { price: 200, buildings: 4 },
  professional: { price: 350, buildings: 8 },
  enterprise: { price: 500, buildings: 9999 },
};
export function subscriptionCanWrite(cabinet: any) {
  return (
    ["active", "trialing"].includes(cabinet.subscriptionStatus) &&
    Number.isFinite(Date.parse(cabinet.subscriptionExpiry)) &&
    Date.parse(cabinet.subscriptionExpiry) > Date.now()
  );
}
