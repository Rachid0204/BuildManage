import { decrypt } from './mailer';
import { assertFreshOperationId } from './lifecycle';
import { OperationError, type Actor } from './domain/errors';
import type { State } from './repository';

export const operationActorScope = (actor: Actor) => JSON.stringify([
  actor.role, actor.syndicId || '', actor.buildingId || '', actor.residentId || '', actor.prestataireId || '',
]);

/** Read-only recovery: never dispatch a command or treat an unfinished identity plan as committed. */
export function readOperationStatus(state: State, actor: Actor, operationId: unknown) {
  if (typeof operationId !== 'string' || !/^[a-zA-Z0-9:_-]{16,150}$/.test(operationId))
    throw new OperationError('Opération invalide.', 400);
  const receipt = state.__operations?.[`${actor.uid}:${operationId}`];
  if (!receipt) {
    assertFreshOperationId(state, operationId);
    return { status: 'not_found' };
  }
  if (!receipt.actorScope || receipt.actorScope !== operationActorScope(actor))
    throw new OperationError('Le contexte de cette opération a changé. Vérifiez son résultat dans les données avant de continuer.', 403);
  if (receipt.identityMutationId && state.__firebaseMutations_v1?.[receipt.identityMutationId]?.status !== 'finalized')
    return { status: 'pending', operation: receipt.operation };
  if (receipt.status === 'pending' || receipt.status === 'running') return { status: 'pending', operation: receipt.operation };
  const response = JSON.parse(receipt.encryptedResponse ? decrypt(receipt.encryptedResponse) : receipt.responseJson);
  return { status: 'completed', operation: receipt.operation, result: response.result, resultMeta: response.resultMeta };
}
