import type {
Charge,
MaintenanceRequest,
Notification,
Prestataire
} from '../../types';
export const STORAGE_KEYS = {
  SYNDICS: 'syndik_prod_syndics_v1',
  CHARGES: 'syndik_prod_charges_v1',
  PROOFS: 'syndik_prod_proofs_v1',
  QUITTANCES: 'syndik_prod_quittances_v1',
  INVOICES: 'syndik_prod_invoices_v1',
  AG: 'syndik_prod_ag_v1',
  PRESTATAIRES: 'syndik_prod_prestataires_v1',
  MAINTENANCE: 'syndik_prod_maintenance_v1',
  CHAT: 'syndik_prod_chat_v1',
  MARKETPLACE: 'syndik_prod_marketplace_v1',
  NOTIFICATIONS: 'syndik_prod_notifications_v1',
  RESIDENT_ACCOUNTS: 'syndik_prod_resident_accounts_v1',
  PRESTATAIRE_ACCOUNTS: 'syndik_prod_prestataire_accounts_v1',
  REGISTERED_USERS: 'syndik_prod_registered_users_v1',
};
export interface ResidentAccountRecord {
  residentId: string;
  email: string;
  cin?: string;
  phone?: string;
  passwordHash: string;
  password?: string; // Deprecated legacy field; never persisted
  name: string;
  isOwner: boolean;
  syndicId: string;
  buildingId: string;
  apartmentId?: string;
  createdAt: string;
  mustChangePassword?: boolean;
  invitationExpiresAt?: string;
}
export type GenerateChargesResult = Charge[] & {
  success: boolean;
  count: number;
  createdCount: number;
  skippedCount: number;
};
export interface BankStatementCSVRow {
  date: string;
  label: string;
  amount: number;
  reference?: string;
  bankName?: string;
}
export interface CastAGVoteInput {
  residentId: string;
  residentName: string;
  apartmentId?: string;
  apartmentNumber: string;
  tantiemes?: number;
  choice?: 'for' | 'against' | 'abstain';
  vote?: 'for' | 'against' | 'abstain';
  comment?: string;
}
export interface PrestataireAccountRecord {
  prestataireId: string;
  email: string;
  passwordHash: string;
  password?: string; // Deprecated legacy field; never persisted
  name: string;
  contactPerson: string;
  category: Prestataire['category'];
  syndicId: string;
  buildingId: string;
  createdAt: string;
  mustChangePassword?: boolean;
  invitationExpiresAt?: string;
}
export const RESIDENT_ACCOUNTS_KEY = STORAGE_KEYS.RESIDENT_ACCOUNTS;
export const PRESTATAIRE_ACCOUNTS_KEY = STORAGE_KEYS.PRESTATAIRE_ACCOUNTS;
// ==========================================
// 11. MAINTENANCE & STATUS TRACKER
// ==========================================
export const DEFAULT_MAINTENANCE_REQUESTS: MaintenanceRequest[] = [];
// ==========================================
// 13. NOTIFICATIONS (Audit Item 26)
// ==========================================
export const DEFAULT_NOTIFICATIONS: Notification[] = [];