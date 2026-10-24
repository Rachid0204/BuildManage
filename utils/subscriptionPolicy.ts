export const PLANS = {
  starter: { price: 200, buildings: 4 },
  professional: { price: 350, buildings: 8 },
  enterprise: { price: 500, buildings: 9999 },
};
/** Archives stay persisted for history; only active buildings consume subscription capacity. */
export function countActiveBuildings(buildings?: readonly { id?: string; archivedAt?: unknown }[] | null): number {
  return (buildings || []).filter(building => !building.archivedAt).length;
}

export function getBuildingCapacity(cabinet: {
  subscriptionPlan: keyof typeof PLANS;
  buildings?: readonly { id?: string; archivedAt?: unknown }[];
}) {
  const active = countActiveBuildings(cabinet.buildings);
  const limit = PLANS[cabinet.subscriptionPlan]?.buildings ?? 0;
  return { active, limit, available: Math.max(0, limit - active), canAdd: active < limit };
}

export function subscriptionCanWrite(cabinet: any) {
  return (
    ["active", "trialing"].includes(cabinet.subscriptionStatus) &&
    Number.isFinite(Date.parse(cabinet.subscriptionExpiry)) &&
    Date.parse(cabinet.subscriptionExpiry) > Date.now()
  );
}
