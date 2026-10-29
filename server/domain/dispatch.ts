import type { State } from '../repository';
import type { Syndic } from '../../types';
import type { BackendMethods, BackendCommand } from '../../shared/api/commands';
import { createAssemblyService } from './assembly.service';
import { createBuildingService } from './building.service';
import type { DomainContext } from './context';
import { AddBuildingSchema, CreateQuittanceSchema } from './contracts';
import { isRecord, parseBackendCommand } from './commandContracts';
import { OperationError, type Actor } from './errors';
import { createFinanceService } from './finance.service';
import { createSupportingService } from './supporting.service';

type Scope = { cabinetId?: string; buildingId?: string };
/** Runtime adapter for coordinator inputs; dispatch itself accepts a discriminated union. */
export async function dispatchMutation(
  state: State,
  actor: Actor,
  operation: string,
  args: unknown[],
  scope: Scope = {},
) {
  return dispatchCommand(
    state,
    actor,
    parseBackendCommand(operation, args),
    scope,
  );
}
export async function dispatchCommand(
  state: State,
  actor: Actor,
  command: BackendCommand,
  scope: Scope = {},
) {
  const first: unknown = command.args[0];
  if (command.operation === 'addBuilding')
    AddBuildingSchema.parse({
      syndicId: command.args[0],
      building: command.args[1],
    });
  if (command.operation === 'createQuittance')
    CreateQuittanceSchema.parse(first);
  const cabinets: Syndic[] = state.syndik_prod_syndics_v1 || [];
  const buildingId =
    scope.buildingId ||
    (isRecord(first) && typeof first.buildingId === 'string'
      ? first.buildingId
      : cabinets.flatMap((s) => s.buildings).find((b) => b.id === first)?.id);
  const cabinetId =
    scope.cabinetId ||
    (command.operation === 'addBuilding'
      ? command.args[0]
      : cabinets.find((s) => s.buildings.some((b) => b.id === buildingId))
          ?.id || actor.syndicId);
  const cabinet = cabinets.find((s) => s.id === cabinetId);
  if (
    cabinet &&
    actor.role !== 'admin' &&
    actor.syndicId !== cabinetId &&
    cabinet.createdBy !== actor.uid
  )
    throw new OperationError('Cabinet non autorisé.', 403);
  const context: DomainContext = {
    state,
    actor,
    cabinetId,
    buildingId,
    authenticatedUserRole: actor.role,
  };
  const methods: BackendMethods = {
    ...createFinanceService(context),
    ...createBuildingService(context),
    ...createAssemblyService(context),
    ...createSupportingService(context),
  };
  switch (command.operation) {
    case 'generateMonthlyCharges':
      return methods.generateMonthlyCharges(...command.args);
    case 'submitPaymentProof':
      return methods.submitPaymentProof(...command.args);
    case 'approvePaymentProofsBatch':
      return methods.approvePaymentProofsBatch(...command.args);
    case 'reviewPaymentProof':
      return methods.reviewPaymentProof(...command.args);
    case 'createQuittance':
      return methods.createQuittance(...command.args);
    case 'reconcileBankStatementCSV':
      return methods.reconcileBankStatementCSV(...command.args);
    case 'generateQuittanceForCharge':
      return methods.generateQuittanceForCharge(...command.args);
    case 'addTransaction':
      return methods.addTransaction(...command.args);
    case 'createInvoiceForResident':
      return methods.createInvoiceForResident(...command.args);
    case 'recordPayment':
      return methods.recordPayment(...command.args);
    case 'addBuilding':
      return methods.addBuilding(...command.args);
    case 'updateBuilding':
      return methods.updateBuilding(...command.args);
    case 'deleteBuilding':
      return methods.deleteBuilding(...command.args);
    case 'addApartment':
      return methods.addApartment(...command.args);
    case 'addApartmentsBulk':
      return methods.addApartmentsBulk(...command.args);
    case 'rebalanceBuildingTantiemes':
      return methods.rebalanceBuildingTantiemes(...command.args);
    case 'updateApartment':
      return methods.updateApartment(...command.args);
    case 'deleteApartment':
      return methods.deleteApartment(...command.args);
    case 'generateChargesFromAGResolution':
      return methods.generateChargesFromAGResolution(...command.args);
    case 'saveSyndic':
      return methods.saveSyndic(...command.args);
    case 'addResident':
      return methods.addResident(...command.args);
    case 'updateResident':
      return methods.updateResident(...command.args);
    case 'regenerateResidentCredentials':
      return methods.regenerateResidentCredentials(...command.args);
    case 'recordResidentCredentialShare':
      return methods.recordResidentCredentialShare(...command.args);
    case 'deleteResident':
      return methods.deleteResident(...command.args);
    case 'savePrestataire':
      return methods.savePrestataire(...command.args);
    case 'regeneratePrestataireCredentials':
      return methods.regeneratePrestataireCredentials(...command.args);
    case 'recordPrestataireCredentialShare':
      return methods.recordPrestataireCredentialShare(...command.args);
    case 'deletePrestataire':
      return methods.deletePrestataire(...command.args);
    case 'addPrestataireReview':
      return methods.addPrestataireReview(...command.args);
    case 'addMaintenanceRequest':
      return methods.addMaintenanceRequest(...command.args);
    case 'updateMaintenanceRequest':
      return methods.updateMaintenanceRequest(...command.args);
    case 'addAnnouncement':
      return methods.addAnnouncement(...command.args);
    case 'deleteDocument':
      return methods.deleteDocument(...command.args);
    case 'markNotificationAsRead':
      return methods.markNotificationAsRead(...command.args);
    case 'sendChatMessage':
      return methods.sendChatMessage(...command.args);
    case 'toggleChatMessageLike':
      return methods.toggleChatMessageLike(...command.args);
    case 'addMarketplaceItem':
      return methods.addMarketplaceItem(...command.args);
    case 'updateMarketplaceItemStatus':
      return methods.updateMarketplaceItemStatus(...command.args);
    case 'deleteMarketplaceItem':
      return methods.deleteMarketplaceItem(...command.args);
  }
}
