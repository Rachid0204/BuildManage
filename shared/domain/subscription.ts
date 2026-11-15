export const PLANS = {
  starter: { price: 190, buildings: 4 },
  professional: { price: 390, buildings: 8 },
  enterprise: { price: 790, buildings: 9999 },
};
/** Unlimited plan capacity threshold. */
export function isUnlimitedPlan(limit: number): boolean {
  return limit >= 9999;
}
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

