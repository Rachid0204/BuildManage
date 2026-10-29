import type {
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
  PaymentPostingOptions,
  PaymentProof,
  Prestataire,
  PrestataireReview,
  Quittance,
  Resident,
  SubscriptionPlan,
  Syndic,
  Transaction,
} from '../../types';
import type {
  AddBuildingCommand,
  CreateQuittanceCommand,
} from '../domain/commands';
import type { BankStatementCSVRow, GenerateChargesResult } from './records';

/** Public domain methods only. Internal financial helpers cannot be dispatched. */
export interface BackendMethods {
  generateMonthlyCharges: (
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
  ) => Promise<GenerateChargesResult>;
  submitPaymentProof: (
    proofData: Omit<PaymentProof, 'id' | 'submissionDate' | 'status'>,
  ) => Promise<PaymentProof>;
  approvePaymentProofsBatch: (
    buildingId: string,
    proofIds?: string[],
  ) => Promise<{
    approvedCount: number;
    totalAmountMad: number;
    quittances: Quittance[];
  }>;
  reviewPaymentProof: (
    proofId: string,
    decision: 'approved' | 'rejected' | 'approve' | 'reject',
    rejectionReason?: string,
    options?: PaymentPostingOptions,
  ) => Promise<{
    proof: PaymentProof;
    quittance?: Quittance;
    success: boolean;
  }>;
  createQuittance: (input: CreateQuittanceCommand) => Promise<Quittance>;
  reconcileBankStatementCSV: (
    buildingId: string,
    rows: BankStatementCSVRow[],
    options?: PaymentPostingOptions & { preview?: boolean },
  ) => Promise<{
    preview: Array<{
      bankTransactionDate?: string;
      postingDate?: string;
      amount: number;
      label: string;
    }>;
    matchedCount: number;
    unmatchedCount: number;
    totalReconciledMad: number;
    quittances: Quittance[];
  }>;
  generateQuittanceForCharge: (
    chargeOrId: Charge | string,
    buildingIdOrPaymentMethod?: string,
    referenceNumber?: string,
    bankName?: string,
  ) => Promise<Quittance>;
  addTransaction: (
    buildingId: string,
    transaction: Omit<Transaction, 'id'>,
  ) => Promise<Transaction | undefined>;
  createInvoiceForResident: (
    residentId: string,
    buildingId: string,
    syndicId: string,
  ) => Promise<Invoice>;
  recordPayment: (
    invoice: Invoice,
    amount: number,
    method: string,
    paymentReference?: string,
  ) => Promise<boolean>;
  addBuilding: (
    syndicId: string,
    buildingData: AddBuildingCommand['building'],
  ) => Promise<Building>;
  updateBuilding: (
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
  ) => Promise<Building>;
  deleteBuilding: (buildingId: string) => Promise<boolean>;
  addApartment: (
    apartmentData: Omit<Apartment, 'id'>,
  ) => Promise<Apartment | undefined>;
  addApartmentsBulk: (
    buildingId: string,
    apartmentsList: Omit<Apartment, 'id' | 'buildingId'>[],
  ) => Promise<Apartment[]>;
  rebalanceBuildingTantiemes: (
    buildingId: string,
  ) => Promise<Apartment[] | undefined>;
  updateApartment: (apartment: Apartment) => Promise<Apartment | undefined>;
  deleteApartment: (apartmentId: string) => Promise<boolean>;
  generateChargesFromAGResolution: (
    agId: string,
    resolutionId: string,
  ) => Promise<{ createdCharges: Charge[]; totalAllocatedMad: number }>;
  saveSyndic: (syndic: Syndic) => Promise<Syndic>;
  addResident: (
    residentData: Omit<Resident, 'id'>,
    generateCredentials?: boolean,
  ) => Promise<Resident>;
  updateResident: (resident: Resident) => Promise<Resident>;
  regenerateResidentCredentials: (residentId: string) => Promise<Resident>;
  recordResidentCredentialShare: (
    residentId: string,
    method: 'pdf' | 'copy',
  ) => Promise<Resident | null>;
  deleteResident: (residentId: string) => Promise<boolean>;
  savePrestataire: (
    prestataire: Prestataire,
    generateCredentials?: boolean,
  ) => Promise<Prestataire>;
  regeneratePrestataireCredentials: (
    prestataireId: string,
  ) => Promise<Prestataire>;
  recordPrestataireCredentialShare: (
    prestataireId: string,
    method: 'pdf' | 'copy',
  ) => Promise<Prestataire | null>;
  deletePrestataire: (prestataireId: string) => Promise<boolean>;
  addPrestataireReview: (
    prestataireId: string,
    review: Omit<PrestataireReview, 'id' | 'date'>,
  ) => Promise<Prestataire | null>;
  addMaintenanceRequest: (
    request: Omit<MaintenanceRequest, 'id'>,
  ) => Promise<MaintenanceRequest>;
  updateMaintenanceRequest: (
    id: string,
    updates: Partial<MaintenanceRequest>,
    stepInfo?: {
      title?: string;
      note?: string;
      updatedBy?: string;
      updatedByRole?: 'syndic' | 'resident' | 'provider';
      stepPhotos?: string[];
    },
  ) => Promise<Pick<MaintenanceRequest, 'id'> & Partial<MaintenanceRequest>>;
  addAnnouncement: (
    buildingId: string,
    announcementData: {
      title: string;
      content: string;
      priority?: 'normal' | 'urgent';
    },
  ) => Promise<Announcement>;
  deleteDocument: (docToDelete: Document) => Promise<boolean>;
  markNotificationAsRead: (notificationId: string) => Promise<boolean>;
  sendChatMessage: (
    message: Omit<ChatMessage, 'id' | 'createdAt'>,
  ) => Promise<ChatMessage>;
  toggleChatMessageLike: (
    messageId: string,
    userId: string,
  ) => Promise<ChatMessage | null>;
  addMarketplaceItem: (
    item: Omit<MarketplaceItem, 'id' | 'createdAt'>,
  ) => Promise<MarketplaceItem>;
  updateMarketplaceItemStatus: (
    itemId: string,
    status: MarketplaceItem['status'],
  ) => Promise<boolean>;
  deleteMarketplaceItem: (itemId: string) => Promise<boolean>;
}

/** Commands coordinated outside the domain dispatch table. */
export interface CoordinatedMethods {
  saveAssembleeGenerale: (ag: AssembleeGenerale) => Promise<AssembleeGenerale>;
  createAssembleeGenerale: (
    ag: Omit<AssembleeGenerale, 'id'>,
  ) => Promise<AssembleeGenerale>;
  toggleAGVoting: (agId: string, isOpen: boolean) => Promise<AssembleeGenerale>;
  recordAGVote: (
    agId: string,
    resolutionId: string,
    voteType: 'for' | 'against' | 'abstain',
    tantiemesWeight: number,
    voterInfo?: {
      residentId: string;
      residentName: string;
      apartmentId?: string;
      apartmentNumber: string;
    },
  ) => Promise<AssembleeGenerale>;
  updateAGAttendee: (
    agId: string,
    residentId: string,
    status: 'present' | 'represented' | 'absent',
    proxyHolderName?: string,
  ) => Promise<AssembleeGenerale>;
  attachDocument: (
    buildingId: string,
    document: { fileId: string } | { name: string; dataUrl: string },
  ) => Promise<Document>;
  assignApartmentOwner: (input: {
    buildingId: string;
    apartmentId: string;
    residentId: string | null;
    expectedOwnerId: string | null;
    reason: string;
  }) => Promise<Apartment>;
  confirmMaintenanceCompletion: (
    id: string,
    reason: string,
  ) => Promise<MaintenanceRequest>;
  reopenMaintenance: (
    id: string,
    reason: string,
  ) => Promise<MaintenanceRequest>;
  setOpeningBalances: (
    buildingId: string,
    balances: { working: number; reserve: number; reason: string },
  ) => Promise<Building['financials']>;
  closeFinancialPeriod: (
    buildingId: string,
    period: string,
    reason: string,
  ) => Promise<boolean>;
  reopenFinancialPeriod: (
    buildingId: string,
    period: string,
    reason: string,
  ) => Promise<boolean>;
  reversePayment: (
    buildingId: string,
    paymentId: string,
    reason: string,
  ) => Promise<boolean>;
  importOpeningArrears: (
    buildingId: string,
    rows: Array<{
      apartmentId: string;
      residentId: string;
      amount: number;
      period: string;
      description?: string;
    }>,
  ) => Promise<boolean>;
  restoreArchived: (
    kind: string,
    id: string,
  ) => Promise<Building | Apartment | Resident | Prestataire>;
  adminCreateCabinet: (input: {
    name: string;
    email: string;
    managerName: string;
    password: string;
    phone?: string;
    city?: string;
    plan: SubscriptionPlan;
    initialBuilding?: {
      name: string;
      address: string;
      apartmentsCount: number;
      monthlyFees: number;
    };
  }) => Promise<Syndic>;
  recordSubscriptionPayment: (input: {
    syndicId: string;
    plan: SubscriptionPlan;
    months: number;
    reference: string;
    amount: number;
  }) => Promise<{
    id: string;
    syndicId: string;
    plan: SubscriptionPlan;
    months: number;
    reference: string;
    amount: number;
  }>;
}
// The server supplies createdAt; the transport must not manufacture a new retry identity.
export type CommandMethods = Omit<BackendMethods, 'addMaintenanceRequest'> &
  CoordinatedMethods & {
    addMaintenanceRequest: (
      input: Omit<MaintenanceRequest, 'id' | 'createdAt'>,
    ) => Promise<MaintenanceRequest>;
  };
export type CommandName = keyof CommandMethods;
export type CommandArgs<K extends CommandName> = Parameters<CommandMethods[K]>;
export type CommandResult<K extends CommandName> = Awaited<
  ReturnType<CommandMethods[K]>
>;
export type CommandRequest = {
  [K in CommandName]: {
    operation: K;
    args: CommandArgs<K>;
    operationId: string;
  };
}[CommandName];
export type CommandResponse =
  | {
      [K in CommandName]: {
        ok: true;
        operation: K;
        result: CommandResult<K>;
        revision?: number;
      };
    }[CommandName]
  | { ok: false; error: string; code?: string; requestId?: string };
export type BackendOperation = keyof BackendMethods;
export type BackendCommand = {
  [K in BackendOperation]: {
    operation: K;
    args: Parameters<BackendMethods[K]>;
  };
}[BackendOperation];
export type BackendResponse = {
  [K in BackendOperation]: {
    operation: K;
    result: Awaited<ReturnType<BackendMethods[K]>>;
  };
}[BackendOperation];
