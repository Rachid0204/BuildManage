import type { Apartment, Building } from '../../types';
import { centimes } from '../../shared/domain/money';

/** Explicit links take priority; a broken link must not silently bill somebody else. */
export function billingPayer(building: Building, apartment: Apartment): string | undefined {
  const id = apartment.ownerId || apartment.tenantId;
  const resident = id
    ? building.residents.find(r => r.id === id)
    : building.residents.find(r => r.apartmentId === apartment.id && !(r as any).archivedAt);
  return resident && !(resident as any).archivedAt && resident.buildingId === building.id &&
    resident.syndicId === building.syndicId ? resident.id : undefined;
}

export function assertBudgetConserved(amounts: number[], budget: number): void {
  if (amounts.reduce((sum, amount) => sum + centimes(amount), 0) !== centimes(budget))
    throw new Error('Les charges ne conservent pas le budget en centimes.');
}

export function requireBudgetPayer(apartment: Apartment, residentId: string | undefined): void {
  if ((apartment.tantiemes ?? 100) > 0 && !residentId)
    throw new Error(`Payeur actif introuvable pour le lot ${apartment.number || apartment.id}. Corrigez l’affectation avant facturation.`);
}
