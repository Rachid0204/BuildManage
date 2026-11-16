import type {
  BankStatementCSVRow,
  CastAGVoteInput,
  GenerateChargesResult,
} from '../shared/api/records';
import { STORAGE_KEYS } from '../shared/api/records';
import type {
  AddBuildingCommand,
  CreateQuittanceCommand,
  ToggleAGVotingCommand,
} from '../shared/domain/commands';
import type {
  AdminBillingConfigUpdateInput,
  AdminPlatformBillingConfig,
  Announcement,
  Apartment,
  AssembleeGenerale,
  Building,
  Charge,
  ChatMessage,
  Document,
  Invoice,
  MaintenanceRequest,
  MarketplaceItem,
  Notification,
  PayPalCurrency,
  PaymentPostingOptions,
  PaymentProof,
  Prestataire,
  PrestataireReview,
  PublicPlatformBillingConfig,
  Quittance,
  Resident,
  SubscriptionBankTransferRequest,
  SubscriptionPayment,
  SubscriptionPlan,
  Syndic,
  Transaction,
} from '../types';
import { notifyOperation } from '../utils/formFeedback';
import { normalizeMaintenanceRequestApartment } from '../utils/maintenanceDisplay';
import { getAuthenticatedRequestHeaders } from '../utils/security';
import { engineStorage } from './cache';
import {
  commandRequest,
  ephemeralInvitation,
  notifyStateUpdated,
  readSnapshot,
  remoteMutation,
  syncAllSharedStateFromServer,
} from './transport';
import { isRecord, sanitizeSnapshot } from './wire';
export { STORAGE_KEYS } from '../shared/api/records';
export type {
  BankStatementCSVRow,
  CastAGVoteInput,
  GenerateChargesResult,
  PrestataireAccountRecord,
  ResidentAccountRecord,
} from '../shared/api/records';
export { normalizeBillingPeriodKey } from '../shared/domain/billingPeriod';
export {
  clearStateCache,
  getKnownServerRevision,
  readSnapshot,
  remoteMutation,
  resetAllProductionData,
  syncAllSharedStateFromServer,
} from './transport';

export const getSyndics = async (): Promise<Syndic[]> => {
  await syncAllSharedStateFromServer();
  return readSnapshot<Syndic[]>(STORAGE_KEYS.SYNDICS, [])
    .filter((s) => !s.archivedAt)
    .map((s) => ({
      ...s,
      logoUrl: s.logoUrl ?? '',
      buildings: s.buildings
        .filter((b) => !b.archivedAt)
        .map((b) => ({
          ...b,
          residents: b.residents
            .filter((r) => !r.archivedAt)
            .map((r) => ({ ...r, ...ephemeralInvitation(r.id) })),
          apartments: b.apartments.filter((a) => !a.archivedAt),
        })),
    }));
};

export const saveSyndic = async (syndic: Syndic): Promise<Syndic> => {
  return remoteMutation('saveSyndic', [syndic]);
};

export const getAllSyndicsForAdmin = async (): Promise<Syndic[]> => {
  await syncAllSharedStateFromServer();
  return readSnapshot<Syndic[]>(STORAGE_KEYS.SYNDICS, []).map((s) => ({
    ...s,
    logoUrl: s.logoUrl ?? '',
    buildings: (s.buildings || [])
      .filter((b) => !b.archivedAt)
      .map((b) => ({
        ...b,
        residents: (b.residents || [])
          .filter((r) => !r.archivedAt)
          .map((r) => ({ ...r, ...ephemeralInvitation(r.id) })),
        apartments: (b.apartments || []).filter((a) => !a.archivedAt),
      })),
  }));
};

export const getSubscriptionPayments = async (): Promise<
  SubscriptionPayment[]
> => {
  await syncAllSharedStateFromServer();
  const payments = readSnapshot<SubscriptionPayment[]>(
    STORAGE_KEYS.SUBSCRIPTION_PAYMENTS,
    [],
  );
  return [...payments].sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  );
};

export const recordSubscriptionPayment = async (input: {
  syndicId: string;
  plan: SubscriptionPlan;
  months: number;
  reference: string;
  amount: number;
}) => {
  return remoteMutation('recordSubscriptionPayment', [input]);
};

export const adminArchiveCabinet = async (
  syndicId: string,
): Promise<Syndic> => {
  return remoteMutation('adminArchiveCabinet', [syndicId]);
};

export const adminRestoreCabinet = async (
  syndicId: string,
): Promise<Syndic> => {
  return remoteMutation('adminRestoreCabinet', [syndicId]);
};

export const voidSubscriptionPayment = async (
  paymentId: string,
  reason: string,
): Promise<SubscriptionPayment> => {
  return remoteMutation('voidSubscriptionPayment', [paymentId, reason]);
};

export const getSubscriptionBankTransferRequests = async (
  syndicId?: string,
): Promise<SubscriptionBankTransferRequest[]> => {
  await syncAllSharedStateFromServer();
  const requests = readSnapshot<SubscriptionBankTransferRequest[]>(
    STORAGE_KEYS.SUBSCRIPTION_REQUESTS,
    [],
  );
  const filtered = syndicId
    ? requests.filter((r) => r.syndicId === syndicId)
    : requests;
  return [...filtered].sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  );
};

export const submitSubscriptionBankTransfer = async (input: {
  syndicId: string;
  plan: SubscriptionPlan;
  months: number;
  transferReference: string;
  bankName: string;
  transferDate: string;
  proofUrl?: string;
  notes?: string;
}): Promise<SubscriptionBankTransferRequest> => {
  return remoteMutation('submitSubscriptionBankTransfer', [input]);
};

export const reviewSubscriptionBankTransfer = async (input: {
  requestId: string;
  action: 'approve' | 'reject';
  rejectionReason?: string;
}): Promise<{
  request: SubscriptionBankTransferRequest;
  payment?: SubscriptionPayment;
}> => {
  return remoteMutation('reviewSubscriptionBankTransfer', [input]);
};

async function billingJsonRequest<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  let parsed: Record<string, unknown> = {};
  try {
    const json: unknown = await response.json();
    if (isRecord(json)) parsed = json;
  } catch {
    // Non-JSON response handled below
  }
  if (!response.ok || parsed.ok === false) {
    const message =
      typeof parsed.error === 'string' && parsed.error
        ? parsed.error
        : response.status === 401
          ? 'Authentification requise.'
          : response.status === 403
            ? 'Accès refusé.'
            : 'Erreur lors de l’opération de facturation.';
    throw new Error(message);
  }
  return parsed as T;
}

export const getSubscriptionBillingConfig =
  async (): Promise<PublicPlatformBillingConfig> => {
    const data = await billingJsonRequest<{
      ok: boolean;
      config: PublicPlatformBillingConfig;
    }>('/api/subscription/billing-config', {
      method: 'GET',
      headers: getAuthenticatedRequestHeaders(),
      cache: 'no-store',
    });
    return data.config;
  };

export const getAdminBillingConfig =
  async (): Promise<AdminPlatformBillingConfig> => {
    const data = await billingJsonRequest<{
      ok: boolean;
      config: AdminPlatformBillingConfig;
    }>('/api/admin/billing-config', {
      method: 'GET',
      headers: getAuthenticatedRequestHeaders(),
      cache: 'no-store',
    });
    return data.config;
  };

export const saveAdminBillingConfig = async (
  input: AdminBillingConfigUpdateInput,
): Promise<AdminPlatformBillingConfig> => {
  const data = await billingJsonRequest<{
    ok: boolean;
    config: AdminPlatformBillingConfig;
  }>('/api/admin/billing-config', {
    method: 'PUT',
    headers: getAuthenticatedRequestHeaders(),
    body: JSON.stringify(input),
  });
  return data.config;
};

export const testPayPalBillingConnection = async (overrides?: {
  env?: 'sandbox' | 'live';
  clientId?: string;
  clientSecret?: string;
}): Promise<{ ok: boolean; env: string; message: string }> => {
  return billingJsonRequest<{ ok: boolean; env: string; message: string }>(
    '/api/admin/billing-config/test-paypal',
    {
      method: 'POST',
      headers: getAuthenticatedRequestHeaders(),
      body: JSON.stringify(overrides || {}),
    },
  );
};

export const createPayPalSubscriptionOrder = async (input: {
  syndicId: string;
  plan: SubscriptionPlan;
  months: number;
  paymentSourceHint?: 'paypal' | 'card';
}): Promise<{
  ok: boolean;
  orderId: string;
  currency: PayPalCurrency;
  amount: number;
  amountMad: number;
}> => {
  return billingJsonRequest<{
    ok: boolean;
    orderId: string;
    currency: PayPalCurrency;
    amount: number;
    amountMad: number;
  }>('/api/subscription/paypal/create-order', {
    method: 'POST',
    headers: getAuthenticatedRequestHeaders(),
    body: JSON.stringify(input),
  });
};

export const capturePayPalSubscriptionOrder = async (input: {
  orderId: string;
  syndicId: string;
  methodHint?: 'paypal' | 'card';
}): Promise<{
  ok: boolean;
  alreadyCaptured?: boolean;
  payment: SubscriptionPayment;
}> => {
  const data = await billingJsonRequest<{
    ok: boolean;
    alreadyCaptured?: boolean;
    payment: SubscriptionPayment;
  }>('/api/subscription/paypal/capture-order', {
    method: 'POST',
    headers: getAuthenticatedRequestHeaders(),
    body: JSON.stringify(input),
  });
  await syncAllSharedStateFromServer(true);
  notifyStateUpdated(STORAGE_KEYS.SYNDICS);
  notifyStateUpdated(STORAGE_KEYS.SUBSCRIPTION_PAYMENTS);
  return data;
};

export const uploadSubscriptionProof = async (
  syndicId: string,
  file: File,
): Promise<{
  url: string;
  fileId: string;
  mimeType: string;
  sizeBytes: number;
}> => {
  const dataUrl = await readFileAsDurableDataUrl(file);
  const { response, data } = await commandRequest(
    '/api/subscription/upload-proof',
    {
      method: 'POST',
      headers: getAuthenticatedRequestHeaders(),
      body: JSON.stringify({
        syndicId,
        name: file.name,
        dataUrl,
      }),
    },
  );
  if (!response.ok || !data.ok || typeof data.url !== 'string') {
    throw new Error(data.error || 'Échec du téléversement du justificatif.');
  }
  return {
    url: data.url,
    fileId: data.url.split('/').pop() || '',
    mimeType: file.type || 'application/pdf',
    sizeBytes: file.size,
  };
};

export const openAuthenticatedUpload = async (url: string): Promise<void> => {
  const headers = getAuthenticatedRequestHeaders();
  delete headers['Content-Type'];
  delete headers['Accept'];
  const response = await fetch(url, { method: 'GET', headers });
  if (!response.ok) {
    throw new Error('Impossible d’ouvrir le justificatif.');
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
};

export const getBuildingsForSyndic = async (
  syndicId: string,
): Promise<Building[]> => {
  await syncAllSharedStateFromServer();
  const syndics = readSnapshot<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
  const targetSyndic = syndics.find((s) => s.id === syndicId && !s.archivedAt);
  return (targetSyndic?.buildings || [])
    .filter((b) => !b.archivedAt)
    .map((b) => ({
      ...b,
      residents: b.residents
        .filter((r) => !r.archivedAt)
        .map((r) => ({ ...r, ...ephemeralInvitation(r.id) })),
      apartments: b.apartments.filter((a) => !a.archivedAt),
    }));
};

export const addBuilding = async (
  syndicId: string,
  buildingData: AddBuildingCommand['building'],
) => {
  return remoteMutation('addBuilding', [syndicId, buildingData]);
};

export const updateBuilding = async (
  buildingId: string,
  updates: Partial<
    Pick<
      Building,
      | 'name'
      | 'address'
      | 'city'
      | 'monthlySyndicFees'
      | 'reserveFundRate'
      | 'bankName'
      | 'bankRib'
      | 'managerName'
      | 'managerPhone'
    >
  > & { syncApartmentFees?: boolean },
) => {
  return remoteMutation('updateBuilding', [buildingId, updates]);
};

export const deleteBuilding = async (buildingId: string) => {
  return remoteMutation('deleteBuilding', [buildingId]);
};

export const addApartment = async (apartmentData: Omit<Apartment, 'id'>) => {
  return remoteMutation('addApartment', [apartmentData]);
};

export const addApartmentsBulk = async (
  buildingId: string,
  apartmentsList: Omit<Apartment, 'id' | 'buildingId'>[],
) => {
  return remoteMutation('addApartmentsBulk', [buildingId, apartmentsList]);
};

export const rebalanceBuildingTantiemes = async (buildingId: string) => {
  return remoteMutation('rebalanceBuildingTantiemes', [buildingId]);
};

export const updateApartment = async (apartment: Apartment) => {
  return remoteMutation('updateApartment', [apartment]);
};

export const assignApartmentOwner = async (input: {
  buildingId: string;
  apartmentId: string;
  residentId: string | null;
  expectedOwnerId: string | null;
  reason: string;
}): Promise<Apartment> => {
  return remoteMutation('assignApartmentOwner', [input]);
};

export const deleteApartment = async (apartmentId: string) => {
  return remoteMutation('deleteApartment', [apartmentId]);
};

export const addResident = async (
  residentData: Omit<Resident, 'id'>,
  generateCredentials: boolean = true,
): Promise<Resident> => {
  return remoteMutation('addResident', [residentData, generateCredentials]);
};

export const updateResident = async (resident: Resident): Promise<Resident> => {
  return remoteMutation('updateResident', [resident]);
};

export const regenerateResidentCredentials = async (
  residentId: string,
): Promise<Resident> => {
  return remoteMutation('regenerateResidentCredentials', [residentId]);
};

export const recordResidentCredentialShare = async (
  residentId: string,
  method: 'pdf' | 'copy',
): Promise<Resident | null> => {
  return remoteMutation('recordResidentCredentialShare', [residentId, method]);
};

export const deleteResident = async (residentId: string) => {
  return remoteMutation('deleteResident', [residentId]);
};

export const getChargesForBuilding = async (
  buildingId: string,
): Promise<Charge[]> => {
  await syncAllSharedStateFromServer();
  const charges = readSnapshot<Charge[]>(STORAGE_KEYS.CHARGES, []);
  return charges.filter((c) => c.buildingId === buildingId);
};

export const getChargesForResident = async (
  residentId: string,
): Promise<Charge[]> => {
  await syncAllSharedStateFromServer();
  const charges = readSnapshot<Charge[]>(STORAGE_KEYS.CHARGES, []);
  return charges.filter((c) => c.residentId === residentId);
};

export const generateMonthlyCharges = async (
  buildingId: string,
  syndicId: string,
  periodOrOptions?:
    | string
    | {
        useTantiemes?: boolean;
        periodName?: string;
        totalMonthlyBudget?: number;
        totalBudgetToSplit?: number;
        chargeType?: Charge['chargeType'];
      },
  maybeOptions?:
    | boolean
    | {
        chargeType?: Charge['chargeType'];
        totalBudgetToSplit?: number;
        totalMonthlyBudget?: number;
        useTantiemes?: boolean;
      },
): Promise<GenerateChargesResult> => {
  return remoteMutation('generateMonthlyCharges', [
    buildingId,
    syndicId,
    periodOrOptions,
    maybeOptions,
  ]);
};

export const getPaymentProofsForBuilding = async (
  buildingId: string,
): Promise<PaymentProof[]> => {
  await syncAllSharedStateFromServer();
  const proofs = readSnapshot<PaymentProof[]>(STORAGE_KEYS.PROOFS, []);
  return proofs.filter((p) => p.buildingId === buildingId);
};

export const getPaymentProofsForResident = async (
  residentId: string,
): Promise<PaymentProof[]> => {
  await syncAllSharedStateFromServer();
  const proofs = readSnapshot<PaymentProof[]>(STORAGE_KEYS.PROOFS, []);
  return proofs.filter((p) => p.residentId === residentId);
};

export const submitPaymentProof = async (
  proofData: Omit<PaymentProof, 'id' | 'submissionDate' | 'status'>,
): Promise<PaymentProof> => {
  return remoteMutation('submitPaymentProof', [proofData]);
};

export const approvePaymentProofsBatch = async (
  buildingId: string,
  proofIds?: string[],
  options?: PaymentPostingOptions,
): Promise<{
  approvedCount: number;
  totalAmountMad: number;
  quittances: Quittance[];
}> => {
  return remoteMutation(
    'approvePaymentProofsBatch',
    options === undefined ? [buildingId, proofIds] : [buildingId, proofIds, options],
  );
};

export const reconcileBankStatementCSV = async (
  buildingId: string,
  rows: BankStatementCSVRow[],
  options: PaymentPostingOptions & { preview?: boolean } = {},
): Promise<{
  preview?: Array<{
    bankTransactionDate?: string;
    postingDate?: string;
    amount: number;
    label: string;
  }>;
  matchedCount: number;
  unmatchedCount: number;
  totalReconciledMad: number;
  quittances: Quittance[];
}> => {
  return remoteMutation('reconcileBankStatementCSV', [
    buildingId,
    rows,
    options,
  ]);
};

export const reviewPaymentProof = async (
  proofId: string,
  decision: 'approved' | 'rejected' | 'approve' | 'reject',
  rejectionReason?: string,
  options: PaymentPostingOptions = {},
): Promise<{
  proof: PaymentProof;
  quittance?: Quittance;
  success: boolean;
}> => {
  const canonicalDecision =
    decision === 'approve'
      ? 'approved'
      : decision === 'reject'
        ? 'rejected'
        : decision;
  return remoteMutation('reviewPaymentProof', [
    proofId,
    canonicalDecision,
    rejectionReason,
    options,
  ]);
};

export const getQuittancesForBuilding = async (
  buildingId: string,
): Promise<Quittance[]> => {
  await syncAllSharedStateFromServer();
  const quittances = readSnapshot<Quittance[]>(STORAGE_KEYS.QUITTANCES, []);
  return quittances.filter((q) => q.buildingId === buildingId && !q.voidedAt);
};

export const getQuittancesForResident = async (
  residentId: string,
): Promise<Quittance[]> => {
  await syncAllSharedStateFromServer();
  const quittances = readSnapshot<Quittance[]>(STORAGE_KEYS.QUITTANCES, []);
  return quittances.filter((q) => q.residentId === residentId && !q.voidedAt);
};

export const createQuittance = async (
  input: CreateQuittanceCommand,
): Promise<Quittance> => {
  return remoteMutation('createQuittance', [input]);
};

export const generateQuittanceForCharge = async (
  chargeOrId: Charge | string,
  buildingIdOrPaymentMethod: string = 'virement',
  referenceNumber?: string,
  bankName?: string,
): Promise<Quittance> => {
  return remoteMutation('generateQuittanceForCharge', [
    chargeOrId,
    buildingIdOrPaymentMethod,
    referenceNumber,
    bankName,
  ]);
};

export const getAssembleesGeneralesForBuilding = async (
  buildingId: string,
): Promise<AssembleeGenerale[]> => {
  await syncAllSharedStateFromServer();
  const agList = readSnapshot<AssembleeGenerale[]>(STORAGE_KEYS.AG, []);
  return agList.filter((ag) => ag.buildingId === buildingId);
};

export const saveAssembleeGenerale = async (
  ag: AssembleeGenerale,
): Promise<AssembleeGenerale> => {
  return remoteMutation('saveAssembleeGenerale', [ag]);
};

export const createAssembleeGenerale = async (
  agInput: Omit<AssembleeGenerale, 'id'> & { id?: string },
): Promise<AssembleeGenerale> => {
  return remoteMutation('createAssembleeGenerale', [agInput]);
};

export const castResidentAGVote = async (
  agId: string,
  resolutionId: string,
  residentIdOrPayload: string | CastAGVoteInput,
  residentNameArg?: string,
  apartmentIdArg?: string,
  apartmentNumberArg?: string,
  _suppliedTantiemes?: number,
  choiceArg?: 'for' | 'against' | 'abstain',
  commentArg?: string,
): Promise<AssembleeGenerale> => {
  const isObjectCall =
    typeof residentIdOrPayload === 'object' && residentIdOrPayload !== null;
  const residentId: string = isObjectCall
    ? residentIdOrPayload.residentId
    : String(residentIdOrPayload);
  const residentName = isObjectCall
    ? residentIdOrPayload.residentName
    : residentNameArg || 'Copropriétaire';
  const apartmentId = isObjectCall
    ? residentIdOrPayload.apartmentId || ''
    : apartmentIdArg || '';
  const apartmentNumber = isObjectCall
    ? residentIdOrPayload.apartmentNumber
    : apartmentNumberArg || '';
  const choice: 'for' | 'against' | 'abstain' = isObjectCall
    ? residentIdOrPayload.choice || residentIdOrPayload.vote || 'for'
    : choiceArg || 'for';
  const comment = isObjectCall ? residentIdOrPayload.comment : commentArg;
  const { response, data } = await commandRequest('/api/ag/vote', {
    method: 'POST',
    headers: getAuthenticatedRequestHeaders(),
    body: JSON.stringify({
      agId,
      resolutionId,
      residentId,
      apartmentId,
      choice,
      comment,
    }),
  });
  if (!response.ok || !isRecord(data.ag) || data.ag.id !== agId)
    throw new Error(data.error || 'Le vote a échoué.');
  const ag = sanitizeSnapshot(data.ag) as AssembleeGenerale;
  const list = readSnapshot<AssembleeGenerale[]>(STORAGE_KEYS.AG, []);
  const index = list.findIndex((a) => a.id === agId);
  if (index >= 0) list[index] = ag;
  else list.push(ag);
  engineStorage.setItem(STORAGE_KEYS.AG, JSON.stringify(list));
  notifyStateUpdated(STORAGE_KEYS.AG);
  notifyOperation({ operation: 'castResidentAGVote' });
  return ag;
};

export const toggleAGVoting = async (
  agId: ToggleAGVotingCommand['agId'],
  isOpen: ToggleAGVotingCommand['isOpen'],
): Promise<AssembleeGenerale> => {
  return remoteMutation('toggleAGVoting', [agId, isOpen]);
};

export const generateChargesFromAGResolution = async (
  agId: string,
  resolutionId: string,
): Promise<{ createdCharges: Charge[]; totalAllocatedMad: number }> => {
  return remoteMutation('generateChargesFromAGResolution', [
    agId,
    resolutionId,
  ]);
};

export const recordAGVote = async (
  agId: string,
  resolutionId: string,
  voteType: 'for' | 'against' | 'abstain',
  tantiemesWeight: number,
  voterInfo?: {
    residentId: string;
    residentName: string;
    apartmentId: string;
    apartmentNumber: string;
  },
): Promise<AssembleeGenerale> => {
  return remoteMutation('recordAGVote', [
    agId,
    resolutionId,
    voteType,
    tantiemesWeight,
    voterInfo,
  ]);
};

export const updateAGAttendee = async (
  agId: string,
  residentId: string,
  status: 'present' | 'represented' | 'absent',
  proxyHolderName?: string,
): Promise<AssembleeGenerale> => {
  return remoteMutation('updateAGAttendee', [
    agId,
    residentId,
    status,
    proxyHolderName,
  ]);
};

export const getPrestatairesForBuilding = async (
  buildingId: string,
): Promise<Prestataire[]> => {
  await syncAllSharedStateFromServer();
  return readSnapshot<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, [])
    .filter((p) => p.buildingId === buildingId && !p.archivedAt)
    .map((p) => ({ ...p, ...ephemeralInvitation(p.id) }));
};

export const savePrestataire = async (
  prestataire: Prestataire,
  generateCredentials?: boolean,
): Promise<Prestataire> => {
  return remoteMutation('savePrestataire', [prestataire, generateCredentials]);
};

export const regeneratePrestataireCredentials = async (
  prestataireId: string,
): Promise<Prestataire> => {
  return remoteMutation('regeneratePrestataireCredentials', [prestataireId]);
};

export const recordPrestataireCredentialShare = async (
  prestataireId: string,
  method: 'pdf' | 'copy',
): Promise<Prestataire | null> => {
  return remoteMutation('recordPrestataireCredentialShare', [
    prestataireId,
    method,
  ]);
};

export const deletePrestataire = async (
  prestataireId: string,
): Promise<boolean> => {
  return remoteMutation('deletePrestataire', [prestataireId]);
};

export const addPrestataireReview = async (
  prestataireId: string,
  review: Omit<PrestataireReview, 'id' | 'date'>,
): Promise<Prestataire | null> => {
  return remoteMutation('addPrestataireReview', [prestataireId, review]);
};

export const addTransaction = async (
  buildingId: string,
  transaction: Omit<Transaction, 'id'>,
) => {
  return remoteMutation('addTransaction', [buildingId, transaction]);
};

export const transferFunds = async (
  buildingId: string,
  input: {
    fromFund: 'courant' | 'reserve';
    toFund: 'courant' | 'reserve';
    amount: number;
    date: string;
    reason: string;
  },
) => {
  return remoteMutation('transferFunds', [buildingId, input]);
};

export const voidInvoice = async (
  buildingId: string,
  invoiceId: string,
  reason: string,
): Promise<boolean> => {
  return remoteMutation('voidInvoice', [buildingId, invoiceId, reason]);
};

export const reverseExpense = async (
  buildingId: string,
  transactionId: string,
  reason: string,
): Promise<Transaction> => {
  return remoteMutation('reverseExpense', [buildingId, transactionId, reason]);
};

export const getInvoicesForBuilding = async (
  buildingId: string,
): Promise<Invoice[]> => {
  await syncAllSharedStateFromServer();
  const invoices = readSnapshot<Invoice[]>(STORAGE_KEYS.INVOICES, []);
  return invoices.filter((inv) => inv.buildingId === buildingId);
};

export const createInvoiceForResident = async (
  residentId: string,
  buildingId: string,
  syndicId: string,
): Promise<Invoice> => {
  return remoteMutation('createInvoiceForResident', [
    residentId,
    buildingId,
    syndicId,
  ]);
};

export const recordPayment = async (
  invoice: Invoice,
  amount: number,
  method: string,
  paymentReference?: string,
  options?: PaymentPostingOptions,
) => {
  return remoteMutation(
    'recordPayment',
    options === undefined
      ? [invoice, amount, method, paymentReference]
      : [invoice, amount, method, paymentReference, options],
  );
};

export const getMaintenanceRequestsForBuilding = async (
  buildingId: string,
): Promise<MaintenanceRequest[]> => {
  await syncAllSharedStateFromServer();
  const list = readSnapshot<MaintenanceRequest[]>(STORAGE_KEYS.MAINTENANCE, []);
  const syndics = readSnapshot<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
  return list
    .filter((m) => m.buildingId === buildingId)
    .map((m) => normalizeMaintenanceRequestApartment(m, syndics));
};

export const getMaintenanceRequestsForResident = async (
  residentId: string,
): Promise<MaintenanceRequest[]> => {
  await syncAllSharedStateFromServer();
  const list = readSnapshot<MaintenanceRequest[]>(STORAGE_KEYS.MAINTENANCE, []);
  const syndics = readSnapshot<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
  return list
    .filter((m) => m.residentId === residentId)
    .map((m) => normalizeMaintenanceRequestApartment(m, syndics));
};

export const addMaintenanceRequest = async (
  request: Omit<MaintenanceRequest, 'id' | 'createdAt'> & {
    createdAt?: string;
  },
) => {
  const { createdAt: _createdAt, ...input } = request;
  return remoteMutation('addMaintenanceRequest', [input]);
};

export const updateMaintenanceRequest = async (
  id: string,
  updates: Partial<MaintenanceRequest>,
  stepInfo?: {
    title?: string;
    note?: string;
    updatedBy?: string;
    updatedByRole?: 'syndic' | 'resident' | 'provider';
    stepPhotos?: string[];
  },
) => {
  return remoteMutation('updateMaintenanceRequest', [id, updates, stepInfo]);
};

export const addAnnouncement = async (
  buildingId: string,
  announcementData: {
    title: string;
    content: string;
    priority?: 'normal' | 'urgent';
  },
): Promise<Announcement> => {
  return remoteMutation('addAnnouncement', [buildingId, announcementData]);
};

const MAX_DOCUMENT_UPLOAD_BYTES = 5 * 1024 * 1024;

async function readFileAsDurableDataUrl(file: File): Promise<string> {
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    throw new Error('Fichier limité à 5 Mo.');
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (
          typeof reader.result === 'string' &&
          reader.result.startsWith('data:')
        ) {
          resolve(reader.result);
        } else {
          reject(new Error('Format de fichier non lisible'));
        }
      };
      reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
      reader.readAsDataURL(file);
    });
  }
  // Node / synthetic test environment fallback where FileReader is absent
  if (typeof file.arrayBuffer === 'function') {
    const ab = await file.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let b64: string;
    if (typeof Buffer !== 'undefined') {
      b64 = Buffer.from(bytes).toString('base64');
    } else {
      const chunkSize = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      b64 = btoa(binary);
    }
    const mime = file.type || 'application/pdf';
    return `data:${mime};base64,${b64}`;
  }
  return `data:${file.type || 'application/pdf'};base64,JVBERi0xLjQK`;
}

export const uploadDocument = async (
  buildingId: string,
  file: File,
): Promise<Document> => {
  const dataUrl = await readFileAsDurableDataUrl(file);
  return remoteMutation('attachDocument', [
    buildingId,
    { name: file.name, dataUrl },
  ]);
};

export const deleteDocument = async (
  docToDelete: Document,
): Promise<boolean> => {
  return remoteMutation('deleteDocument', [docToDelete]);
};

export const getUserNotifications = async (
  userId: string,
): Promise<Notification[]> => {
  await syncAllSharedStateFromServer();
  const list = readSnapshot<Notification[]>(STORAGE_KEYS.NOTIFICATIONS, []);
  // Audit Item 26: Filter notifications by recipient userId
  return list.filter((n) => n.userId === userId || n.userId === 'all');
};

export const markNotificationAsRead = async (notificationId: string) => {
  return remoteMutation('markNotificationAsRead', [notificationId]);
};

export const getChatMessages = async (
  buildingId: string,
  channelId?: string,
): Promise<ChatMessage[]> => {
  await syncAllSharedStateFromServer();
  const list = readSnapshot<ChatMessage[]>(STORAGE_KEYS.CHAT, []);
  const buildingMsgs = list.filter((m) => m.buildingId === buildingId);
  if (channelId) {
    if (channelId === 'marketplace') {
      return buildingMsgs.filter(
        (m) =>
          m.channelId === 'marketplace' || m.channelId.startsWith('market-'),
      );
    }
    return buildingMsgs.filter((m) => m.channelId === channelId);
  }
  return buildingMsgs;
};

export const sendChatMessage = async (
  message: Omit<ChatMessage, 'id' | 'createdAt'>,
): Promise<ChatMessage> => {
  return remoteMutation('sendChatMessage', [message]);
};

export const toggleChatMessageLike = async (
  messageId: string,
  userId: string,
): Promise<ChatMessage | null> => {
  return remoteMutation('toggleChatMessageLike', [messageId, userId]);
};

export const getMarketplaceItems = async (
  buildingId: string,
): Promise<MarketplaceItem[]> => {
  await syncAllSharedStateFromServer();
  const list = readSnapshot<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, []);
  return list.filter((item) => item.buildingId === buildingId);
};

export const addMarketplaceItem = async (
  item: Omit<MarketplaceItem, 'id' | 'createdAt'>,
): Promise<MarketplaceItem> => {
  return remoteMutation('addMarketplaceItem', [item]);
};

export const updateMarketplaceItemStatus = async (
  itemId: string,
  status: MarketplaceItem['status'],
): Promise<boolean> => {
  return remoteMutation('updateMarketplaceItemStatus', [itemId, status]);
};

export const deleteMarketplaceItem = async (
  itemId: string,
): Promise<boolean> => {
  return remoteMutation('deleteMarketplaceItem', [itemId]);
};
