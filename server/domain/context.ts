import type { State } from '../repository';
import type { Actor } from './errors';
/** One repository transaction and one authenticated scope; never process-global. */
export interface DomainContext {
  state: State;
  cabinetId?: string;
  buildingId?: string;
  authenticatedUserRole: Actor['role'];
  actor: Actor;
}
export type BackendMethods = Record<string, (...args: any[]) => any>;

/** Defense in depth for service construction; the coordinator applies operation-specific policy. */
export function assertContext(context: DomainContext): void {
 if(context.authenticatedUserRole!==context.actor.role)throw new Error('Authenticated role mismatch');
 const cabinet=(context.state.syndik_prod_syndics_v1 || []).find((s:any)=>s.id===context.cabinetId);
 if(cabinet && context.actor.role!=='admin' && context.actor.syndicId!==cabinet.id && cabinet.createdBy!==context.actor.uid)
  throw new Error('Cabinet non autorisé.');
 if(context.buildingId && cabinet && !cabinet.buildings?.some((b:any)=>b.id===context.buildingId))throw new Error('Immeuble non autorisé.');
}
