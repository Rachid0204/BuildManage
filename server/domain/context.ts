import type { State } from '../repository';
import type { Actor } from './errors';
import type { Syndic } from '../../types';
export type {
  BackendMethods,
  BackendCommand,
  BackendResponse,
} from '../../shared/api/commands';
/** One repository transaction and one authenticated scope; never process-global. */
export interface DomainContext {
  state: State;
  cabinetId?: string;
  buildingId?: string;
  authenticatedUserRole: Actor['role'];
  actor: Actor;
}
export function assertContext(context: DomainContext): void {
  if (context.authenticatedUserRole !== context.actor.role)
    throw new Error('Authenticated role mismatch');
  const cabinets: Syndic[] = context.state.syndik_prod_syndics_v1 || [];
  const cabinet = cabinets.find((s) => s.id === context.cabinetId);
  if (
    cabinet &&
    context.actor.role !== 'admin' &&
    context.actor.syndicId !== cabinet.id &&
    cabinet.createdBy !== context.actor.uid
  )
    throw new Error('Cabinet non autorisé.');
  if (
    context.buildingId &&
    cabinet &&
    !cabinet.buildings.some((b) => b.id === context.buildingId)
  )
    throw new Error('Immeuble non autorisé.');
}
