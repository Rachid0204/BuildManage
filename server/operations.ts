import { billingPayer } from './domain/billingAllocation';
import { randomUUID } from 'node:crypto';
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
export interface MonthlyBuildingResult {
  syndicId: string;
  buildingId: string;
  operationId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  created: number;
  reason?: string;
  code?: string;
  httpStatus?: number;
  retryable?: boolean;
  attempts: number;
}

export const monthlyBillingHttpStatus = (run: { results: MonthlyBuildingResult[] }) =>
  run.results.some(r => r.status === 'failed' && r.retryable) ? 503 : 200;

export function classifyBillingFailure(error: any) {
  const domain = error instanceof OperationError, dependency = error instanceof DependencyError;
  const validation = error?.name === 'ZodError';
  const retryable = dependency ? error.reason === 'unavailable' : domain ? error.status >= 500 || error.status === 429 : !validation;
  return { retryable, httpStatus: domain || dependency ? error.status : validation ? 400 : 500,
    reason: domain || dependency ? error.message : validation ? 'Configuration de facturation invalide.' : 'La facturation de cet immeuble a échoué.',
    code: dependency ? error.code : domain ? error.code : validation ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR' };
}

export function authorizeBillingBuilding(state: State, actor: Actor, syndicId: string, buildingId: string) {
  const cabinet = (state.syndik_prod_syndics_v1 || []).find((s: any) => s.id === syndicId);
  const building = cabinet?.buildings?.find((b: any) => b.id === buildingId);
  if (!building || !['admin', 'syndic'].includes(actor.role) ||
      (actor.role !== 'admin' && cabinet.createdBy !== actor.uid && actor.syndicId !== cabinet.id))
    throw new OperationError('Immeuble non autorisé.', 403);
  return building;
}

interface BillingOptions {
  retryRunId?: string;
  target?: { syndicId: string; buildingId: string; runId: string; actor: Actor };
  // Injectable clock wait for deterministic retry tests; never supplied by HTTP callers.
  wait?: (ms: number) => Promise<void>;
}

/** Commit each building before proceeding; a rejected building owns its rollback. */
export async function generateScheduledMonthlyCharges(repository: StateRepository, period: string, requestId?: string, options: BillingOptions = {}) {
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).parse(period);
  const runId = randomUUID(), startedAt = new Date().toISOString();
  const candidates = await repository.transaction(async state => {
    if (options.target) {
      const t = options.target;
      authorizeBillingBuilding(state, t.actor, t.syndicId, t.buildingId);
      const previous = (state.__billingRuns || []).find((r: any) => r.id === t.runId && r.period === period);
      if (!previous?.results.some((r: any) => r.syndicId === t.syndicId && r.buildingId === t.buildingId && r.status === 'failed'))
        throw new OperationError('Échec de facturation introuvable.', 404);
      return [{ syndicId: t.syndicId, buildingId: t.buildingId }];
    }
    if (options.retryRunId) {
      const previous = (state.__billingRuns || []).find((r: any) => r.id === options.retryRunId && r.period === period);
      if (!previous) throw new OperationError('Exécution introuvable.', 404);
      return previous.results.filter((r: MonthlyBuildingResult) => r.status === 'failed' && r.retryable)
        .map(({ syndicId, buildingId }: MonthlyBuildingResult) => ({ syndicId, buildingId }));
    }
    return (state.syndik_prod_syndics_v1 || []).flatMap((s: any) =>
      (s.buildings || []).map((b: any) => ({ syndicId: s.id as string, buildingId: b.id as string })));
  });
  const results: MonthlyBuildingResult[] = [];
  const persist = async (completed = false) => repository.transaction(async state => {
    const run = { id: runId, requestId, period, startedAt, updatedAt: new Date().toISOString(),
      status: completed ? 'completed' : 'running', ...(completed ? { completedAt: new Date().toISOString() } : {}),
      ...(options.retryRunId ? { retryOf: options.retryRunId } : {}),
      ...(options.target ? { retryOf: options.target.runId, actorUid: options.target.actor.uid } : {}),
      ...totals(), results: structuredClone(results) };
    const runs = state.__billingRuns ??= [];
    const index = runs.findIndex((r: any) => r.id === runId);
    if (index < 0) runs.push(run); else runs[index] = run;
  });
  const totals = () => ({ ok: !results.some(r => r.status === 'failed'), total: candidates.length,
    succeeded: results.filter(r => r.status === 'succeeded').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    failed: results.filter(r => r.status === 'failed').length,
    created: results.reduce((sum, r) => sum + r.created, 0) });
  await persist();
  for (const candidate of candidates) {
    const operationId = `scheduled:${candidate.buildingId}:${period}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await repository.transaction(async state => {
        const skipped = (reason: string): MonthlyBuildingResult =>
          ({ ...candidate, operationId, status: 'skipped', created: 0, reason, attempts: attempt });
        if (options.target) {
          createCommandService(state).canWrite(options.target.actor, { ...authorizeBillingBuilding(state, options.target.actor, candidate.syndicId, candidate.buildingId), syndicId: candidate.syndicId });
        }
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
        for (const lot of building.apartments.filter((a: any) => !a.archivedAt)) {
          if ((lot.monthlyFees ?? building.monthlySyndicFees ?? 0) > 0 && !billingPayer({ ...building, syndicId: cabinet.id }, lot))
            throw new OperationError(`Payeur actif introuvable pour le lot ${lot.number || lot.id}. Corrigez l’affectation avant facturation.`, 400, 'BILLING_PAYER_INVALID');
        }
        const charges = await runOperation(
          { uid: cabinet.createdBy, role: 'syndic', syndicId: cabinet.id },
          'generateMonthlyCharges', [building.id, cabinet.id, period], operationId, state);
        return charges.length > 0
          ? { ...candidate, operationId, status: 'succeeded' as const, created: charges.length, attempts: attempt }
          : skipped(charges.skippedCount > 0 ? 'already_billed' : 'no_eligible_lots');
      });
      // Only committed outcomes contribute to the response, including on repository retries.
      results.push(result);
    } catch (error: any) {
      const failure = classifyBillingFailure(error);
      console.error(JSON.stringify({ event: 'monthly_billing_failed', requestId, runId, ...candidate, period, attempt,
        ...failure, message: String(error?.message || error).slice(0, 1000) }));
      if (failure.retryable && attempt < 3) {
        results.push({ ...candidate, operationId, status: 'failed', created: 0, attempts: attempt, ...failure });
        await persist();
        results.pop();
        await (options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms))))(1000 * 2 ** (attempt - 1));
        continue;
      }
      results.push({ ...candidate, operationId, status: 'failed', created: 0, attempts: attempt, ...failure });
    }
    break;
    }
    await persist();
  }
  await persist(true);
  return { id: runId, startedAt, period, ...totals(), results };
}
