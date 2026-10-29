import { z } from 'zod';
import type { BackendMethods, BackendCommand } from '../../shared/api/commands';
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Tuple framing and primitive types are validated here. Domain objects have already
 * passed the coordinator's operation-specific validation and authorization. */
const backendArguments = {
  generateMonthlyCharges: z.tuple([
    z.string(),
    z.string(),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z
        .union([
          z.string(),
          z.custom<Parameters<BackendMethods['generateMonthlyCharges']>[2]>(
            isRecord,
          ),
        ])
        .optional(),
    ),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z
        .union([
          z.boolean(),
          z.custom<Parameters<BackendMethods['generateMonthlyCharges']>[3]>(
            isRecord,
          ),
        ])
        .optional(),
    ),
  ]),
  submitPaymentProof: z.tuple([
    z.custom<Parameters<BackendMethods['submitPaymentProof']>[0]>(isRecord),
  ]),
  approvePaymentProofsBatch: z.tuple([
    z.string(),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z.array(z.string()).optional(),
    ),
  ]),
  reviewPaymentProof: z.tuple([
    z.string(),
    z.union([
      z.literal('approved'),
      z.literal('rejected'),
      z.literal('approve'),
      z.literal('reject'),
    ]),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z.string().optional(),
    ),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z
        .custom<Parameters<BackendMethods['reviewPaymentProof']>[3]>(isRecord)
        .optional(),
    ),
  ]),
  createQuittance: z.tuple([
    z.custom<Parameters<BackendMethods['createQuittance']>[0]>(isRecord),
  ]),
  reconcileBankStatementCSV: z.tuple([
    z.string(),
    z.array(
      z.custom<
        Parameters<BackendMethods['reconcileBankStatementCSV']>[1][number]
      >(isRecord),
    ),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z
        .custom<
          Parameters<BackendMethods['reconcileBankStatementCSV']>[2]
        >(isRecord)
        .optional(),
    ),
  ]),
  generateQuittanceForCharge: z.tuple([
    z.union([
      z.custom<Parameters<BackendMethods['generateQuittanceForCharge']>[0]>(
        isRecord,
      ),
      z.string(),
    ]),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z.string().optional(),
    ),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z.string().optional(),
    ),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z.string().optional(),
    ),
  ]),
  addTransaction: z.tuple([
    z.string(),
    z.custom<Parameters<BackendMethods['addTransaction']>[1]>(isRecord),
  ]),
  createInvoiceForResident: z.tuple([z.string(), z.string(), z.string()]),
  recordPayment: z.tuple([
    z.custom<Parameters<BackendMethods['recordPayment']>[0]>(isRecord),
    z.number().finite(),
    z.string(),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z.string().optional(),
    ),
  ]),
  addBuilding: z.tuple([
    z.string(),
    z.custom<Parameters<BackendMethods['addBuilding']>[1]>(isRecord),
  ]),
  updateBuilding: z.tuple([
    z.string(),
    z.custom<Parameters<BackendMethods['updateBuilding']>[1]>(isRecord),
  ]),
  deleteBuilding: z.tuple([z.string()]),
  addApartment: z.tuple([
    z.custom<Parameters<BackendMethods['addApartment']>[0]>(isRecord),
  ]),
  addApartmentsBulk: z.tuple([
    z.string(),
    z.array(
      z.custom<Parameters<BackendMethods['addApartmentsBulk']>[1][number]>(
        isRecord,
      ),
    ),
  ]),
  rebalanceBuildingTantiemes: z.tuple([z.string()]),
  updateApartment: z.tuple([
    z.custom<Parameters<BackendMethods['updateApartment']>[0]>(isRecord),
  ]),
  deleteApartment: z.tuple([z.string()]),
  generateChargesFromAGResolution: z.tuple([z.string(), z.string()]),
  saveSyndic: z.tuple([
    z.custom<Parameters<BackendMethods['saveSyndic']>[0]>(isRecord),
  ]),
  addResident: z.tuple([
    z.custom<Parameters<BackendMethods['addResident']>[0]>(isRecord),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z.boolean().optional(),
    ),
  ]),
  updateResident: z.tuple([
    z.custom<Parameters<BackendMethods['updateResident']>[0]>(isRecord),
  ]),
  regenerateResidentCredentials: z.tuple([z.string()]),
  recordResidentCredentialShare: z.tuple([
    z.string(),
    z.union([z.literal('pdf'), z.literal('copy')]),
  ]),
  deleteResident: z.tuple([z.string()]),
  savePrestataire: z.tuple([
    z.custom<Parameters<BackendMethods['savePrestataire']>[0]>(isRecord),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z.boolean().optional(),
    ),
  ]),
  regeneratePrestataireCredentials: z.tuple([z.string()]),
  recordPrestataireCredentialShare: z.tuple([
    z.string(),
    z.union([z.literal('pdf'), z.literal('copy')]),
  ]),
  deletePrestataire: z.tuple([z.string()]),
  addPrestataireReview: z.tuple([
    z.string(),
    z.custom<Parameters<BackendMethods['addPrestataireReview']>[1]>(isRecord),
  ]),
  addMaintenanceRequest: z.tuple([
    z.custom<Parameters<BackendMethods['addMaintenanceRequest']>[0]>(isRecord),
  ]),
  updateMaintenanceRequest: z.tuple([
    z.string(),
    z.custom<Parameters<BackendMethods['updateMaintenanceRequest']>[1]>(
      isRecord,
    ),
    z.preprocess(
      (value) => (value === null ? undefined : value),
      z
        .custom<
          Parameters<BackendMethods['updateMaintenanceRequest']>[2]
        >(isRecord)
        .optional(),
    ),
  ]),
  addAnnouncement: z.tuple([
    z.string(),
    z.custom<Parameters<BackendMethods['addAnnouncement']>[1]>(isRecord),
  ]),
  deleteDocument: z.tuple([
    z.custom<Parameters<BackendMethods['deleteDocument']>[0]>(isRecord),
  ]),
  markNotificationAsRead: z.tuple([z.string()]),
  sendChatMessage: z.tuple([
    z.custom<Parameters<BackendMethods['sendChatMessage']>[0]>(isRecord),
  ]),
  toggleChatMessageLike: z.tuple([z.string(), z.string()]),
  addMarketplaceItem: z.tuple([
    z.custom<Parameters<BackendMethods['addMarketplaceItem']>[0]>(isRecord),
  ]),
  updateMarketplaceItemStatus: z.tuple([
    z.string(),
    z.enum(['available', 'sold', 'reserved']),
  ]),
  deleteMarketplaceItem: z.tuple([z.string()]),
} satisfies {
  [K in keyof BackendMethods]: z.ZodType<
    Parameters<BackendMethods[K]>,
    z.ZodTypeDef,
    unknown
  >;
};
// Historical receipts may refer to operations removed from today's dispatch table.
export const CommandIdentitySchema = z.object({
  operation: z.string().min(1),
  args: z.array(z.unknown()).max(10),
  operationId: z.string().regex(/^[a-zA-Z0-9:_-]{16,150}$/),
});
export const CommandEnvelopeSchema = CommandIdentitySchema.extend({
  operation: z.enum([
    'generateMonthlyCharges',
    'submitPaymentProof',
    'approvePaymentProofsBatch',
    'reviewPaymentProof',
    'createQuittance',
    'reconcileBankStatementCSV',
    'generateQuittanceForCharge',
    'addTransaction',
    'createInvoiceForResident',
    'recordPayment',
    'addBuilding',
    'updateBuilding',
    'deleteBuilding',
    'addApartment',
    'addApartmentsBulk',
    'rebalanceBuildingTantiemes',
    'updateApartment',
    'deleteApartment',
    'generateChargesFromAGResolution',
    'saveSyndic',
    'addResident',
    'updateResident',
    'regenerateResidentCredentials',
    'recordResidentCredentialShare',
    'deleteResident',
    'savePrestataire',
    'regeneratePrestataireCredentials',
    'recordPrestataireCredentialShare',
    'deletePrestataire',
    'addPrestataireReview',
    'addMaintenanceRequest',
    'updateMaintenanceRequest',
    'addAnnouncement',
    'deleteDocument',
    'markNotificationAsRead',
    'sendChatMessage',
    'toggleChatMessageLike',
    'addMarketplaceItem',
    'updateMarketplaceItemStatus',
    'deleteMarketplaceItem',
    'saveAssembleeGenerale',
    'createAssembleeGenerale',
    'toggleAGVoting',
    'recordAGVote',
    'updateAGAttendee',
    'attachDocument',
    'assignApartmentOwner',
    'confirmMaintenanceCompletion',
    'reopenMaintenance',
    'setOpeningBalances',
    'closeFinancialPeriod',
    'reopenFinancialPeriod',
    'reversePayment',
    'importOpeningArrears',
    'restoreArchived',
    'adminCreateCabinet',
    'recordSubscriptionPayment',
  ]),
  args: z.array(z.unknown()).max(10),
  operationId: z.string().regex(/^[a-zA-Z0-9:_-]{16,150}$/),
});
export function parseBackendCommand(
  operation: string,
  args: unknown[],
): BackendCommand {
  if (!Object.hasOwn(backendArguments, operation))
    throw new Error('Unknown operation');
  const name = operation as keyof typeof backendArguments;
  // The lookup preserves the operation/tuple pairing; TypeScript cannot correlate
  // a dynamically indexed schema with its discriminant without this assertion.
  const schema = backendArguments[name];
  const padded = [...args];
  while (padded.length < schema.items.length) padded.push(undefined);
  return { operation: name, args: schema.parse(padded) } as BackendCommand;
}
