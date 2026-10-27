/** Repository/HTTP compatibility boundary. Domain services receive explicit transaction state. */
import { z } from 'zod';
import { subscriptionCanWrite } from '../utils/subscriptionPolicy';
import { DependencyError } from './dependencyErrors';
import { createCommandService } from './domain/command.service';
import { OperationError,type Actor } from './domain/errors';
import { currentState,type State,type StateRepository } from './repository';
export { OperationError } from './domain/errors';
export type { Actor } from './domain/errors';
export const actorIdentity = (actor: Actor) => createCommandService({}).actorIdentity(actor);
export const appendAudit = (state: State, ...args: Parameters<ReturnType<typeof createCommandService>['appendAudit']> extends [any, ...infer R] ? R : never) => createCommandService(state).appendAudit(state, ...args);
export const cabinetFor = (actor: Actor, id: string) => createCommandService(currentState()).cabinetFor(actor, id);
export const buildingFor = (actor: Actor, id: string, managed = true) => createCommandService(currentState()).buildingFor(actor, id, managed);
export const canWrite = (actor: Actor, building: any) => createCommandService(currentState()).canWrite(actor, building);
export const recomputeMeeting = (ag: any) => createCommandService({}).recomputeMeeting(ag);
export const runOperation = (actor: Actor, operation: string, args: any[], operationId: string, state: State = currentState()) => createCommandService(state).runOperation(actor, operation, args, operationId);
interface MonthlyBuildingResult {
  syndicId: string;
  buildingId: string;
  operationId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  created: number;
  reason?: string;
  code?: string;
  httpStatus?: number;
}

/** Commit each building before proceeding; a rejected building owns its rollback. */
export async function generateScheduledMonthlyCharges(repository: StateRepository, period: string, requestId?: string) {
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(period);
  const candidates = await repository.transaction(async state =>
    (state.syndik_prod_syndics_v1 || []).flatMap((s: any) =>
      (s.buildings || []).map((b: any) => ({ syndicId: s.id as string, buildingId: b.id as string }))));
  const results: MonthlyBuildingResult[] = [];
  for (const candidate of candidates) {
    const operationId = `scheduled:${candidate.buildingId}:${period}`;
    try {
      const result = await repository.transaction(async state => {
        const skipped = (reason: string): MonthlyBuildingResult =>
          ({ ...candidate, operationId, status: 'skipped', created: 0, reason });
        // Re-resolve records and eligibility after the previous building commits.
        const cabinet = (state.syndik_prod_syndics_v1 || []).find((s: any) => s.id === candidate.syndicId);
        const building = cabinet?.buildings?.find((b: any) => b.id === candidate.buildingId);
        if (!cabinet || !building) return skipped('not_found');
        const owner = (state.syndik_prod_registered_users_v1 || []).find((u: any) => u.uid === cabinet.createdBy);
        if (owner?.disabled || owner?.profile?.emailVerified === false || owner?.profile?.mustChangePassword)
          return skipped('onboarding');
        if (!subscriptionCanWrite(cabinet)) return skipped('inactive');
        if (building.archivedAt) return skipped('archived');
        if (!building.address?.trim() || !building.city?.trim()) return skipped('setup');
        const charges = await runOperation(
          { uid: cabinet.createdBy, role: 'syndic', syndicId: cabinet.id },
          'generateMonthlyCharges', [building.id, cabinet.id, period], operationId, state);
        return charges.length > 0
          ? { ...candidate, operationId, status: 'succeeded' as const, created: charges.length }
          : skipped(charges.skippedCount > 0 ? 'already_billed' : 'no_eligible_lots');
      });
      // Only committed outcomes contribute to the response, including on repository retries.
      results.push(result);
    } catch (error: any) {
      const domainError = error instanceof OperationError;
      const dependencyError = error instanceof DependencyError;
      const validationError = error?.name === 'ZodError';
      const httpStatus = domainError || dependencyError ? error.status : validationError ? 400 : 500;
      const reason = domainError || dependencyError ? error.message : validationError
        ? 'Configuration de facturation invalide.' : 'La facturation de cet immeuble a échoué.';
      const code = dependencyError ? error.code : domainError ? 'OPERATION_REJECTED'
        : validationError ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR';
      results.push({ ...candidate, operationId, status: 'failed', created: 0, reason, code, httpStatus });
      console.error(JSON.stringify({ event: 'monthly_billing_failed', requestId, ...candidate, period, operationId,
        code, message: String(error?.message || error).slice(0, 1000) }));
    }
  }
  const succeeded = results.filter(r => r.status === 'succeeded').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'failed').length;
  return { ok: failed === 0, period, total: results.length, succeeded, skipped, failed,
    created: results.reduce((sum, r) => sum + r.created, 0), results };
}

