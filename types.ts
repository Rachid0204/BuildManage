export type Language = 'en' | 'fr' | 'ar';

export type UserRole = 'admin' | 'syndic' | 'resident' | 'provider';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  syndicId?: string;
  buildingId?: string;
  buildingName?: string;
  apartmentId?: string;
  apartmentNumber?: string;
  isOwner?: boolean;
  cin?: string;
  phone?: string;
  photoURL?: string;
  providerCategory?: string;
  mustChangePassword?: boolean;
}

export interface CredentialAuditEntry {
  action: 'generated' | 'regenerated' | 'shared_pdf' | 'shared_copy';
  timestamp: string;
}

export interface Transaction {
  id: string;
  date: string; // ISO 8601 format
  description: string;
  amount: number; // positive for income, negative for expense
  category?:
    | 'maintenance'
    | 'fees'
    | 'salary'
    | 'utility'
    | 'reserve'
    | 'insurance'
    | 'bank_fees'
    | 'legal'
    | 'cleaning'
    | 'elevator'
    | 'reimbursement'
    | 'other';
  reference?: string;
  fundType?: 'courant' | 'reserve'; // Budget de fonctionnement vs Fonds de réserve obligatoire (Loi 106-12)
  documentType?: 'facture' | 'quittance' | 'recu' | 'devis' | 'releve' | 'autre';
  invoiceNumber?: string; // N° de facture fournisseur ou pièce comptable
  thirdPartyName?: string; // Nom du prestataire ou copropriétaire
  thirdPartyIce?: string; // Identifiant Commun de l'Entreprise (ICE) du prestataire
  bankName?: string; // Banque marocaine de l'opération
  lotNumber?: string; // Lot de copropriété concerné si applicable
  notes?: string;
}

export type PaymentMethod = 'virement' | 'cmi' | 'versement' | 'cheque' | 'especes';
export type ChargeType = 'courante' | 'exceptionnelle' | 'reserve';

export interface Charge {
  id: string;
  buildingId: string;
  apartmentId: string;
  residentId: string;
  amount: number;
  dueDate: string;
  status: 'pending' | 'paid' | 'overdue';
  invoiceId?: string;
  description: string;
  createdAt: string;
  type?: ChargeType;
  period?: string; // e.g. "Octobre 2026", "T4 2026"
  paymentMethod?: PaymentMethod;
  paymentProofId?: string;
  paidAt?: string;
}

export interface PaymentProof {
  id: string;
  chargeId: string;
  residentId: string;
  residentName: string;
  apartmentId: string;
  apartmentNumber: string;
  buildingId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  bankName: string; // e.g. Attijariwafa, CIH, BMCE, BCP, SGMB
  referenceNumber: string;
  submissionDate: string;
  receiptUrl?: string; // Data URL or storage URL
  receiptNote?: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  reviewedAt?: string;
}

export interface Quittance {
  id: string;
  quittanceNumber: string; // e.g. QUIT-2026-0042
  chargeId: string;
  invoiceId?: string;
  residentId: string;
  residentName: string;
  residentCin?: string;
  apartmentId: string;
  apartmentNumber: string;
  tantiemes: number;
  buildingId: string;
  buildingName: string;
  syndicId: string;
  syndicName: string;
  amount: number;
  chargesCourantesAmount?: number;
  reserveFundAmount?: number; // Loi 106-12 reserve fund contribution portion
  paymentMethod: PaymentMethod;
  paymentDate: string;
  periodCovered: string;
  bankName?: string;
  referenceNumber?: string;
  remarks?: string;
  createdAt: string;
  pdfUrl?: string;
}

export interface Invoice {
  id: string;
  syndicId: string;
  buildingId: string;
  residentId: string;
  invoiceNumber: string;
  totalAmount: number;
  status: 'unpaid' | 'paid' | 'overdue';
  createdAt: string;
  dueDate: string;
  pdfUrl?: string;
  chargeIds: string[];
}

export interface Financials {
  balance: number;
  transactions: Transaction[];
  pendingCharges?: number;
  overdueAmount?: number;
  reserveFundBalance?: number;
}

export interface Document {
  id: string;
  name: string;
  url: string; // URL to the document
  size: string; // e.g., "1.2 MB"
  uploadedAt: string; // ISO 8601 format
  category?: 'reglement' | 'pv_ag' | 'assurance' | 'contrat' | 'autre';
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string; // ISO 8601 format
  priority?: 'normal' | 'urgent';
}

export interface MaintenanceStepUpdate {
  id: string;
  status: 'pending' | 'in_progress' | 'completed';
  title: string;
  note: string;
  updatedBy: string;
  updatedByRole: 'syndic' | 'resident' | 'provider';
  timestamp: string;
  photos?: string[];
  assignedTo?: string;
  cost?: number;
}

export interface MaintenanceRequest {
  id: string;
  buildingId: string;
  residentId: string;
  residentName?: string;
  apartmentNumber?: string;
  title?: string;
  location?: string;
  category: 'plumbing' | 'electrical' | 'common_area' | 'elevator' | 'cleaning' | 'security' | 'other';
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  photoUrl?: string;
  photos?: string[];
  assignedTo?: string; // Prestataire name or ID
  cost?: number;
  invoiceRef?: string;
  syndicNotes?: string;
  createdAt: string;
  completedAt?: string;
  updates?: MaintenanceStepUpdate[];
}

export interface PrestataireReview {
  id: string;
  residentId: string;
  residentName: string;
  apartmentNumber?: string;
  rating: number; // 1 to 5
  comment: string;
  date: string;
}

export interface Prestataire {
  id: string;
  buildingId?: string;
  syndicId: string;
  name: string;
  category:
    | 'plumbing'
    | 'electrical'
    | 'elevator'
    | 'cleaning'
    | 'security'
    | 'gardener'
    | 'locksmith'
    | 'painting'
    | 'air_conditioning'
    | 'insurance'
    | 'other';
  contactPerson: string;
  phone: string;
  email: string;
  ice?: string;
  rc?: string;
  active: boolean;
  notes?: string;
  // Community directory & ratings
  rating?: number;
  reviewsCount?: number;
  isVerifiedBySyndic?: boolean;
  isEmergency247?: boolean;
  whatsapp?: string;
  hourlyRate?: string;
  city?: string;
  specialties?: string[];
  reviews?: PrestataireReview[];
  hasAccount?: boolean;
  generatedPassword?: string;
  credentialsCreatedAt?: string;
  credentialsSharedAt?: string;
  credentialsLastSharedMethod?: 'pdf' | 'copy';
  credentialsAuditLog?: CredentialAuditEntry[];
  mustChangePassword?: boolean;
}

export interface Resident {
  id: string;
  name: string;
  email: string;
  phone: string;
  isOwner: boolean;
  syndicId: string; // Relation
  buildingId: string; // Relation
  apartmentId?: string; // Relation
  cin?: string; // Moroccan National Identity Card
  hasAccount?: boolean;
  generatedPassword?: string;
  credentialsCreatedAt?: string;
  credentialsSharedAt?: string;
  credentialsLastSharedMethod?: 'pdf' | 'copy';
  credentialsAuditLog?: CredentialAuditEntry[];
  mustChangePassword?: boolean;
}

export interface Apartment {
  id: string;
  number: string;
  floor: number;
  area: number; // in square meters
  buildingId: string; // Relation
  ownerId: string | null;
  tenantId: string | null;
  monthlyFees: number;
  tantiemes: number; // Quote-part in thousandths (e.g. 85 / 1000)
  coproType?: 'apartment' | 'duplex' | 'commercial' | 'parking' | 'box';
}

export interface AGVoteCast {
  residentId: string;
  residentName: string;
  apartmentId: string;
  apartmentNumber: string;
  tantiemes: number;
  vote: 'for' | 'against' | 'abstain';
  castAt: string;
  comment?: string;
}

export interface AGResolution {
  id: string;
  number: number;
  title: string;
  description: string;
  majorityType: 'simple' | 'absolute' | 'unanimity';
  votesFor: number; // weighted by tantiemes
  votesAgainst: number;
  votesAbstain: number;
  status: 'pending' | 'approved' | 'rejected';
  voters?: AGVoteCast[];
}

export interface AGAttendee {
  residentId: string;
  residentName: string;
  apartmentId: string;
  apartmentNumber: string;
  tantiemes: number;
  status: 'present' | 'represented' | 'absent';
  proxyHolderName?: string;
}

export interface AssembleeGenerale {
  id: string;
  buildingId: string;
  syndicId: string;
  title: string;
  type: 'AGO' | 'AGE'; // Ordinary vs Extraordinary General Meeting
  date: string; // ISO format or date string
  time: string;
  location: string;
  status: 'convened' | 'in_progress' | 'closed' | 'pv_generated';
  isVotingOpen?: boolean; // Digital voting enabled for co-owners
  votingClosesAt?: string;
  quorumRequired: number; // usually 500/1000 for 1st call
  totalTantiemes: number; // typically 1000
  presentTantiemes: number;
  quorumReached: boolean;
  agendaItems: string[];
  resolutions: AGResolution[];
  attendees: AGAttendee[];
  presidentName?: string;
  secretaryName?: string;
  pvGeneratedAt?: string;
}

export interface Building {
  id: string;
  syndicId: string; // Relation
  name: string;
  address: string;
  city: string;
  monthlySyndicFees: number;
  totalTantiemes?: number; // Default 1000
  reserveFundRate?: number; // e.g. 5% of budget required by Law 106-12
  bankName?: string;
  bankRib?: string; // 24-digit Moroccan RIB
  // Hydrated fields for UI
  residents: Resident[];
  apartments: Apartment[];
  announcements: Announcement[];
  documents: Document[];
  financials: Financials;
  managerName?: string;
  managerPhone?: string;
}

export type SubscriptionPlan = 'starter' | 'professional' | 'enterprise';
export type SubscriptionStatus = 'active' | 'expired' | 'cancelled';

export interface Syndic {
  id: string;
  name: string;
  logoUrl: string;
  createdBy: string; // Admin UID
  subscriptionPlan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  subscriptionExpiry: string; // ISO 8601 format
  buildings: Building[]; // Hydrated
  syndicType?: 'professionnel' | 'benevole';
  phone?: string;
  email?: string;
  address?: string;
  city?: string;

  // Legal Fields for Compliance (Morocco)
  ice?: string; // Identifiant Commun de l'Entreprise
  taxId?: string; // Identifiant Fiscal (IF)
  rc?: string; // Registre de Commerce
  patente?: string; // Taxe Professionnelle
  bankName?: string;
  rib?: string;
}

export type NotificationType =
  | 'invoice'
  | 'maintenance'
  | 'announcement'
  | 'system'
  | 'payment_proof'
  | 'quittance'
  | 'ag';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  createdAt: string;
  link?: string; // Optional link to redirect user
}

// ==========================================
// CHAT & COMMUNITY COMMUNICATION
// ==========================================
export type ChatChannelType = 'general' | 'syndic' | 'help' | 'direct' | 'marketplace';

export interface ChatMessage {
  id: string;
  buildingId: string;
  channelId: string; // 'general' | 'syndic' | 'help' | direct channel ID | marketplace conversation ID
  senderId: string;
  senderName: string;
  senderRole: 'syndic' | 'resident' | 'admin';
  senderApartment?: string; // e.g. "Lot A-102"
  recipientId?: string; // for direct messages
  recipientName?: string;
  content: string;
  createdAt: string;
  badge?: string; // e.g. "Annonce Syndic", "Urgent", "Entraide", "Souk"
  likes?: string[]; // IDs of users who liked
  marketplaceItemId?: string;
  marketplaceItemTitle?: string;
  marketplaceItemPrice?: number;
  marketplaceItemImage?: string;
}

export interface ChatChannel {
  id: string;
  name: string;
  description: string;
  type: ChatChannelType;
  iconName?: string;
}

// ==========================================
// RESIDENT MARKETPLACE ("LE SOUK")
// ==========================================
export type MarketplaceCategory =
  | 'furniture'
  | 'appliances'
  | 'kids'
  | 'bricolage'
  | 'services'
  | 'electronics'
  | 'other';

export type MarketplaceListingType = 'sale' | 'free' | 'service' | 'exchange';
export type MarketplaceCondition = 'new' | 'like_new' | 'good' | 'fair';
export type MarketplaceStatus = 'available' | 'reserved' | 'sold';

export interface MarketplaceItem {
  id: string;
  buildingId: string;
  residentId: string;
  residentName: string;
  apartmentNumber: string;
  phone: string;
  whatsapp?: string;
  title: string;
  description: string;
  category: MarketplaceCategory;
  type: MarketplaceListingType;
  price: number; // in MAD, 0 for free/don
  condition?: MarketplaceCondition;
  status: MarketplaceStatus;
  imageUrl?: string;
  images?: string[]; // Multiple photos uploaded by resident
  createdAt: string;
}

