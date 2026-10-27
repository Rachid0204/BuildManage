import type { State } from '../repository';
import { createAssemblyService } from './assembly.service';
import { createBuildingService } from './building.service';
import type { BackendMethods,DomainContext } from './context';
import { AddBuildingSchema,CreateQuittanceSchema } from './contracts';
import { OperationError,type Actor } from './errors';
import { createFinanceService } from './finance.service';
import { createSupportingService } from './supporting.service';

export async function dispatchMutation(state: State, actor: Actor, operation: string, args: any[], scope: {cabinetId?:string;buildingId?:string} = {}) {
  const first=args[0];
  if(operation==='addBuilding')AddBuildingSchema.parse({syndicId:args[0],building:args[1]});
  if(operation==='createQuittance')CreateQuittanceSchema.parse(args[0]);
  const buildingId=scope.buildingId || (typeof first==='object' ? first?.buildingId :
    (state.syndik_prod_syndics_v1 || []).flatMap((s: any)=>s.buildings || []).find((b: any)=>b.id===first)?.id);
  const cabinetId=scope.cabinetId || (operation==='addBuilding' ? first :
    (state.syndik_prod_syndics_v1 || []).find((s: any)=>s.buildings?.some((b: any)=>b.id===buildingId))?.id || actor.syndicId);
  const cabinet=(state.syndik_prod_syndics_v1 || []).find((s: any)=>s.id===cabinetId);
  if(cabinet && actor.role!=='admin' && actor.syndicId!==cabinetId && cabinet.createdBy!==actor.uid)
    throw new OperationError('Cabinet non autorisé.',403);
  const context: DomainContext={state,actor,cabinetId,buildingId,authenticatedUserRole:actor.role};
  const methods: BackendMethods={};
  Object.assign(methods,createFinanceService(context,methods),createBuildingService(context,methods),createAssemblyService(context,methods),createSupportingService(context,methods));
  if(!Object.hasOwn(methods,operation))throw new Error('Unknown operation');
  return methods[operation](...args);
}
