export type UserRole = 'admin' | 'syndic' | 'resident' | 'provider';

export type Language = 'fr' | 'ar';

export type SubscriptionPlan = 'starter' | 'professional' | 'enterprise';

export type SubscriptionStatus = 'active' | 'expired' | 'cancelled' | 'trialing';

export type PaymentMethod =
  | 'virement'
  | 'cheque'
  | 'especes'
  | 'cmi'
  | 'versement'
  | 'versement_especes';

export type ChatChannelType =
  | 'general'
  | 'syndic'
  | 'help'
  | 'marketplace'
  | 'travaux'
  | 'voisinage'
  | 'urgences';

export type View =
  | 'dashboard'
  | 'buildings'
  | 'apartments'
  | 'residents'
  | 'financials'
  | 'maintenance'
  | 'documents'
  | 'announcements'
  | 'ag'
  | 'prestataires'
  | 'analytics'
  | 'settings'
  | 'chat'
  | 'marketplace';

export interface UserProfile {
  firebaseUid?: string;
  emailVerified?: boolean;
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  role: UserRole;
  syndicId?: string;
  buildingId?: string;
  buildingName?: string;
  apartmentId?: string;
  apartmentNumber?: string;
  residentId?: string;
  prestataireId?: string;
  prestataireCategory?: string;
  providerCategory?: string;
  isOwner?: boolean;
  phone?: string;
  cin?: string;
  mustChangePassword?: boolean;
}

export interface CredentialAuditEntry {
  action: 'generated' | 'regenerated' | 'shared_pdf' | 'shared_copy';
  timestamp: string;
  by?: string;
}

export interface Resident {
  archivedAt?: string;
  /** Server-derived account binding; never accepted as identity authority on writes. */
  readonly emailIdentityLinked?: boolean;
  id: string;
  name: string;
  email: string;
  phone: string;
  cin?: string;
  /** Nonexclusive primary/display lot. Apartment.ownerId/tenantId define associations. */
  apartmentId?: string;
  isOwner: boolean;
  buildingId: string;
  syndicId: string;
  hasAccount?: boolean;
  generatedPassword?: string;
  invitationToken?: string;
  invitationCode?: string;
  invitationExpiresAt?: string;
  invitationStatus?: 'pending' | 'accepted' | 'expired';
  credentialsCreatedAt?: string;
  credentialsSharedAt?: string;
  credentialsLastSharedMethod?: 'pdf' | 'copy';
  credentialsAuditLog?: CredentialAuditEntry[];
  mustChangePassword?: boolean;
}

export interface Apartment {
  archivedAt?: string;
  id: string;
  number: string;
  floor: number;
  area: number;
  ownerId: string | null;
  tenantId: string | null;
  monthlyFees: number;
  tantiemes?: number;
  coproType?: 'apartment' | 'duplex' | 'commercial' | 'villa';
  buildingId: string;
}

export interface Charge {
  periodKey?: string;
  id: string;
  syndicId: string;
  buildingId: string;
  apartmentId: string;
  residentId: string;
  amount: number;
  paidAmount?: number;
  paidAt?: string;
  paymentMethod?: PaymentMethod | string;
  dueDate: string;
  status: 'unpaid' | 'pending' | 'paid' | 'overdue';
  period?: string;
  description?: string;
  invoiceId?: string | null;
  chargeType?: 'courante' | 'exceptionnelle_travaux' | 'fonds_reserve' | 'opening_arrears';
  tantiemesApplied?: number;
  createdAt: string;
}

export interface PaymentDates {
  bankTransactionDate?: string;
  submissionDate?: string;
  postingDate?: string;
  priorPeriodAdjustmentReason?: string;
}
export interface PaymentPostingOptions {
  postingDate?: string;
  priorPeriodAdjustmentReason?: string;
}

export interface PaymentProof extends PaymentDates {
  id: string;
  chargeId: string;
  buildingId: string;
  syndicId?: string;
  residentId: string;
  residentName: string;
  apartmentId?: string;
  apartmentNumber: string;
  amount: number;
  paymentMethod: PaymentMethod;
  bankName: string;
  referenceNumber: string;
  submissionDate: string;
  receiptNote?: string;
  receiptUrl?: string;
  proofImageUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedAt?: string;
  rejectionReason?: string;
  matchScore?: number;
  matchStatus?: 'exact_match' | 'partial_match' | 'unmatched';
  matchedChargeAmount?: number;
}

export interface Quittance extends PaymentDates {
  /** Rate captured when the payment was posted; absent for undocumented/mixed legacy allocations. */
  reserveRateApplied?: number;
  voidedAt?: string;
  voidReason?: string;
  paymentId?: string;
  id: string;
  quittanceNumber: string;
  chargeId: string;
  buildingId: string;
  buildingName: string;
  syndicId: string;
  syndicName: string;
  residentId: string;
  residentName: string;
  residentCin?: string;
  apartmentId?: string;
  apartmentNumber: string;
  tantiemes?: number;
  amount: number;
  chargesCourantesAmount?: number;
  reserveFundAmount?: number;
  periodCovered: string;
  paymentDate: string;
  paymentMethod: PaymentMethod | string;
  referenceNumber?: string;
  bankName?: string;
  remarks?: string;
  createdAt: string;
}

export interface Invoice {
  items?: Array<{description:string;period:string;amount:number}>;
  issuedTo?: Pick<Resident, "name" | "email" | "phone" | "cin" | "isOwner">;
  paymentIds?: string[];
  id: string;
  syndicId: string;
  buildingId: string;
  residentId: string;
  invoiceNumber: string;
  totalAmount: number;
  paidAmount?: number;
  status: 'unpaid' | 'paid' | 'overdue' | 'cancelled';
  createdAt: string;
  dueDate: string;
  chargeIds: string[];
  pdfUrl?: string | null;
}

export interface Transaction extends PaymentDates {
  /** Canonical receipts captured atomically with this confirmed payment; never renumber on recovery. */
  receiptSnapshots?: Quittance[];
  reserveRateApplied?: number;
  paymentAllocations?: Array<{ chargeId: string; amount: number }>;
  reversalOf?: string;
  paymentId?: string;
  sourceChargeId?: string;
  sourceInvoiceId?: string;
  id: string;
  date: string;
  description: string;
  amount: number;
  type?: 'income' | 'expense';
  category:
    | 'fees'
    | 'maintenance'
    | 'utility'
    | 'salary'
    | 'insurance'
    | 'reserve'
    | 'elevator'
    | 'cleaning'
    | 'security'
    | 'bank_fees'
    | 'legal'
    | 'reimbursement'
    | 'other';
  fundType?: 'courant' | 'reserve' | 'working' | 'operating';
  paymentMethod?: PaymentMethod | string;
  reference?: string;
  documentType?: 'facture' | 'quittance' | 'recu' | 'releve' | 'devis' | 'autre';
  invoiceNumber?: string;
  thirdPartyName?: string;
  thirdPartyIce?: string;
  lotNumber?: string;
  bankName?: string;
  notes?: string;
}

export interface MaintenanceStepUpdate {
  id: string;
  status: 'pending' | 'in_progress' | 'completed';
  title: string;
  note: string;
  updatedBy: string;
  updatedByRole: 'resident' | 'syndic' | 'provider';
  timestamp: string;
  photos?: string[];
  assignedTo?: string;
  cost?: number;
}

export interface MaintenanceRequest {
  id: string;
  buildingId: string;
  syndicId?: string;
  residentId: string;
  residentName?: string;
  apartmentNumber?: string;
  title?: string;
  description: string;
  category:
    | 'elevator'
    | 'plumbing'
    | 'electrical'
    | 'common_area'
    | 'cleaning'
    | 'security'
    | 'other';
  location?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority?: 'low' | 'medium' | 'high' | 'emergency';
  createdAt: string;
  completedAt?: string;
  date?: string;
  assignedTo?: string;
  prestataireId?: string;
  estimatedCompletionDate?: string;
  cost?: number;
  invoiceRef?: string;
  photoUrl?: string;
  photos?: string[];
  syndicNotes?: string;
  updates?: MaintenanceStepUpdate[];
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string;
  priority?: 'normal' | 'urgent';
  category?: 'general' | 'travaux' | 'coupure_eau_elec' | 'ag' | 'securite';
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type?: 'invoice' | 'maintenance' | 'announcement' | 'general';
  createdAt: string;
  read: boolean;
  link?: string;
}

export interface Document {
  id: string;
  name: string;
  url: string;
  size: string;
  uploadedAt: string;
  mimeType?: string;
  storagePath?: string;
  category?: 'reglement_copropriete' | 'pv_ag' | 'contrat' | 'budget' | 'assurance' | 'autre';
}

export type BuildingDocument = Document;

export interface AGVoteCast {
  residentId: string;
  residentName: string;
  apartmentId?: string;
  apartmentNumber: string;
  tantiemes: number;
  choice?: 'for' | 'against' | 'abstain';
  vote?: 'for' | 'against' | 'abstain';
  comment?: string;
  votedAt?: string;
  castAt?: string;
}

export interface AGResolution {
  id: string;
  number: number;
  title: string;
  description: string;
  majorityType:
    | 'simple'
    | 'absolute'
    | 'three_quarters'
    | 'unanimity'
    | 'simple_24'
    | 'absolue_25'
    | 'trois_quarts_26'
    | 'unanimite';
  /** Requires a positive budget before voting opens. */
  generatesCharges?: boolean;
  budgetAmount?: number;
  chargesGeneratedAt?: string;
  generatedChargesCount?: number;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  status: 'pending' | 'approved' | 'rejected';
  voterChoices?: AGVoteCast[];
  voters?: AGVoteCast[];
}

export interface AGAttendee {
  residentId: string;
  residentName: string;
  apartmentNumber: string;
  tantiemes: number;
  status: 'present' | 'represented' | 'absent';
  proxyHolderName?: string;
}

/** Frozen voting inputs only; owner contact and financial data belong to the building. */
export interface AGVotingSnapshot {
  id: Building['id'];
  syndicId: Building['syndicId'];
  residents: Pick<Resident, 'id' | 'name' | 'isOwner'>[];
  apartments: Pick<Apartment, 'id' | 'number' | 'ownerId' | 'tantiemes'>[];
}

export interface AssembleeGenerale {
  votingSnapshot?: AGVotingSnapshot;
  id: string;
  buildingId: string;
  syndicId: string;
  title: string;
  type: 'ordinaire' | 'extraordinaire' | 'AGO' | 'AGE';
  date: string;
  time: string;
  location: string;
  status: 'planned' | 'convocations_sent' | 'in_progress' | 'completed' | 'closed' | 'upcoming';
  isVotingOpen?: boolean;
  convocationSentAt?: string;
  totalTantiemes: number;
  presentTantiemes: number;
  quorumRequired?: number;
  quorumReached: boolean;
  resolutions: AGResolution[];
  attendees: AGAttendee[];
  presidentName?: string;
  secretaryName?: string;
  agendaItems?: string[];
  pvSummary?: string;
  createdAt?: string;
}

export interface PrestataireReview {
  id: string;
  residentId?: string;
  residentName?: string;
  apartmentNumber?: string;
  authorName?: string;
  authorRole?: 'syndic' | 'resident';
  rating: number;
  comment: string;
  date: string;
}

export interface Prestataire {
  archivedAt?: string;
  id: string;
  syndicId: string;
  buildingId: string;
  name: string;
  contactPerson: string;
  category:
    | 'plumbing'
    | 'electrical'
    | 'elevator'
    | 'security'
    | 'cleaning'
    | 'gardener'
    | 'locksmith'
    | 'painting'
    | 'air_conditioning'
    | 'insurance'
    | 'other';
  phone: string;
  whatsapp?: string;
  email: string;
  city?: string;
  address?: string;
  ice?: string;
  rc?: string;
  contractRef?: string;
  contractType?: 'mensuel' | 'annuel' | 'ponctuel';
  monthlyRetainer?: number;
  hourlyRate?: number | string;
  availability?: '24/7' | 'business_hours' | 'on_call';
  verified?: boolean;
  isVerifiedBySyndic?: boolean;
  isEmergency247?: boolean;
  active?: boolean;
  responseTimeHours?: number;
  rating: number;
  reviewsCount?: number;
  reviews?: PrestataireReview[];
  completedJobsCount?: number;
  interventionsCount?: number;
  totalPaid?: number;
  description?: string;
  notes?: string;
  specialties?: string[];
  status?: 'active' | 'inactive';
  hasAccount?: boolean;
  generatedPassword?: string;
  invitationToken?: string;
  invitationCode?: string;
  invitationExpiresAt?: string;
  invitationStatus?: 'pending' | 'accepted' | 'expired';
  credentialsCreatedAt?: string;
  credentialsSharedAt?: string;
  credentialsLastSharedMethod?: 'pdf' | 'copy';
  credentialsAuditLog?: CredentialAuditEntry[];
  mustChangePassword?: boolean;
}

export interface ChatMessage {
  id: string;
  buildingId: string;
  channelId: ChatChannelType | string;
  senderId: string;
  senderName: string;
  senderRole: 'syndic' | 'resident' | 'provider';
  senderApartment?: string;
  apartmentNumber?: string;
  recipientId?: string;
  recipientName?: string;
  content: string;
  badge?: string;
  marketplaceItemId?: string;
  marketplaceItemTitle?: string;
  marketplaceItemPrice?: number;
  marketplaceItemImage?: string;
  attachmentUrl?: string;
  attachmentName?: string;
  isPinned?: boolean;
  likes?: string[];
  createdAt: string;
}

export type MarketplaceCategory =
  | 'mobilier'
  | 'electromenager'
  | 'parking'
  | 'services'
  | 'enfants'
  | 'don_gratuit'
  | 'autre'
  | string;

export type MarketplaceListingType = 'sale' | 'free' | 'service' | string;

export type MarketplaceCondition =
  | 'neuf'
  | 'tres_bon_etat'
  | 'bon_etat'
  | 'a_depanner'
  | 'new'
  | 'like_new'
  | 'good'
  | 'fair';

export interface MarketplaceItem {
  id: string;
  buildingId: string;
  sellerId?: string;
  sellerName?: string;
  sellerPhone?: string;
  residentId?: string;
  residentName?: string;
  apartmentNumber: string;
  phone?: string;
  whatsapp?: string;
  title: string;
  description: string;
  category: MarketplaceCategory;
  type?: MarketplaceListingType;
  price: number;
  isFree?: boolean;
  condition?: MarketplaceCondition;
  imageUrl?: string;
  images?: string[];
  status: 'available' | 'reserved' | 'sold';
  createdAt: string;
}

export interface Building {
  archivedAt?: string;
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode?: string;
  syndicId: string;
  monthlySyndicFees: number;
  totalTantiemes?: number;
  /** Legacy read/create-input alias. New building writes use reserveFundRate only. */
  reserveFundPercentage?: number;
  reserveFundRate?: number;
  bankName?: string;
  bankRib?: string;
  ice?: string;
  rc?: string;
  managerName?: string;
  managerPhone?: string;
  residents: Resident[];
  apartments: Apartment[];
  announcements: Announcement[];
  documents: Document[];
  financials: {
    balance: number;
    reserveFundBalance?: number;
    openingWorkingBalance?: number;
    /** Legacy working opening alias, read for compatibility but no longer written. */
    openingBalance?: number;
    openingReserveBalance?: number;
    openingBalancesRecordedAt?: string;
    transactions: Transaction[];
  };
}

export interface Syndic {
  archivedAt?: string;
  id: string;
  name: string;
  logoUrl?: string;
  createdBy: string;
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiry: string;
  subscriptionExpiresAt?: string;
  ice?: string;
  taxId?: string;
  rc?: string;
  patente?: string;
  if_number?: string;
  bankName?: string;
  rib?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  buildings: Building[];
}




