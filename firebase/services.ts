import type { AddBuildingCommand, CreateQuittanceCommand, PostIncomeCommand, ToggleAGVotingCommand } from '../shared/domain/commands';
import { allocateBudgetInCentimes, splitChargeReserveAndOperating, getBuildingReserveRate, getRecordedReserveSplit, centimes } from '../shared/domain/money';
import { legacyQuorum } from '../shared/domain/voting';
import { engineStorage, clearBusinessCache } from './cache';
import { notifyOperation, readableError } from '../utils/formFeedback';
import { getServerRuntime } from './serverRuntime';
import { applyResidentVote, evaluateResolutionStatus } from '../utils/agVoting';
import { auth, isMock } from './config';
import type {
  Syndic,
  Building,
  Resident,
  Apartment,
  Charge,
  Invoice,
  Transaction,
  MaintenanceRequest,
  MaintenanceStepUpdate,
  Announcement,
  Notification,
  Document,
  PaymentProof,
  Quittance,
  AssembleeGenerale,
  AGResolution,
  AGVoteCast,
  Prestataire,
  PrestataireReview,
  ChatMessage,
  MarketplaceItem,
  CredentialAuditEntry,
} from '../types';
import {
  mockSyndics,
  mockCharges,
  mockPaymentProofs,
  mockQuittances,
  mockAssembleesGenerales,
  mockPrestataires,
  mockChatMessages,
  mockMarketplaceItems,
} from '../data/mockData';
import {
  ResidentSchema,
  ApartmentSchema,
  BuildingSchema,
  SyndicSchema,
} from '../utils/validation';
import {
  hashPasswordSync,
  isAlreadyHashedPassword,
  getAuthenticatedRequestHeaders,
  generateSecureRandomDigits,
} from '../utils/security';
import { getBuildingCapacity } from '../shared/domain/subscription';

// Canonical persistence mode: local cache + authenticated shared server + Cloud Firestore mirror
const isLocalEngineEnabled = true;

// Shared production storage keys (zero mock data)
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

const LEGACY_TEST_KEYS = [
  'syndik_reactive_syndics',
  'syndik_reactive_charges',
  'syndik_reactive_proofs',
  'syndik_reactive_quittances',
  'syndik_reactive_ag',
  'syndik_reactive_prestataires_v2',
  'syndik_reactive_maintenance_v2',
  'syndik_reactive_chat_v1',
  'syndik_reactive_marketplace_v1',
  'syndik_reactive_notifications_v1',
  'syndik_resident_accounts_v1',
  'syndik_prestataire_accounts_v1',
  'syndik_registered_users_v1',
  'syndik_mock_user',
];

const broadcastChannel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('syndik_realtime_sync')
    : null;

function notifyStateUpdated(key: string, broadcast = true) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('syndik-state-updated', { detail: { key } }));
  }
  try {
    if (broadcast) broadcastChannel?.postMessage({ type: 'STATE_UPDATED', key, timestamp: Date.now() });
  } catch {
    // ignore broadcast errors
  }
}

/**
 * Strips plaintext passwords from Syndic/Resident/Prestataire records before persisting to
 * engineStorage or sending over the network (Audit Item 03).
 */
function stripPlaintextCredentialsForStorage<T>(key: string, val: T): T {
  if (!val) return val;
  if (key === STORAGE_KEYS.SYNDICS && Array.isArray(val)) {
    return val.map((syndic: any) => ({
      ...syndic,
      buildings: Array.isArray(syndic.buildings)
        ? syndic.buildings.map((bld: any) => ({
            ...bld,
            residents: Array.isArray(bld.residents)
              ? bld.residents.map((res: any) => {
                  const { generatedPassword: _gp, password: _pw, ...cleanRes } = res || {};
                  return cleanRes;
                })
              : [],
          }))
        : [],
    })) as unknown as T;
  }
  if (key === STORAGE_KEYS.PRESTATAIRES && Array.isArray(val)) {
    return val.map((prest: any) => {
      const { generatedPassword: _gp, password: _pw, ...cleanPrest } = prest || {};
      return cleanPrest;
    }) as unknown as T;
  }
  if (
    (key === STORAGE_KEYS.RESIDENT_ACCOUNTS ||
      key === STORAGE_KEYS.PRESTATAIRE_ACCOUNTS ||
      key === STORAGE_KEYS.REGISTERED_USERS) &&
    Array.isArray(val)
  ) {
    return val.map((acc: any) => {
      const emailNorm = (acc?.email || '').trim().toLowerCase();
      const passwordHash =
        acc?.passwordHash ||
        (typeof acc?.password === 'string'
          ? isAlreadyHashedPassword(acc.password)
            ? acc.password
            : hashPasswordSync(acc.password, emailNorm)
          : '');
      const { password: _pw, generatedPassword: _gp, ...cleanAcc } = acc || {};
      return { ...cleanAcc, passwordHash };
    }) as unknown as T;
  }
  return val;
}

export function sanitizeAccountRecordsInStorage(): void {
  if (typeof engineStorage === 'undefined') return;
  const keysToSanitize = [
    STORAGE_KEYS.SYNDICS,
    STORAGE_KEYS.PRESTATAIRES,
    STORAGE_KEYS.RESIDENT_ACCOUNTS,
    STORAGE_KEYS.PRESTATAIRE_ACCOUNTS,
    STORAGE_KEYS.REGISTERED_USERS,
  ];
  for (const key of keysToSanitize) {
    try {
      const raw = engineStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const sanitized = stripPlaintextCredentialsForStorage(key, parsed);
      engineStorage.setItem(key, JSON.stringify(sanitized));
    } catch {
      // ignore malformed JSON
    }
  }
}

let lastKnownServerRevision = 0;
let lastSyncTimestampMs = 0;
let inflightSyncPromise: Promise<Record<string, any> | null> | null = null;
let stateCacheGeneration = 0;
const syncControllers = new Set<AbortController>();
export const getKnownServerRevision = () => lastKnownServerRevision;

function cacheServerStore(store: Record<string, any>) {
  for (const key of Object.values(STORAGE_KEYS)) {
    const value = store[key];
    const next = value === undefined || value === null ? null : JSON.stringify(stripPlaintextCredentialsForStorage(key, value));
    if (engineStorage.getItem(key) === next) continue;
    if (next === null) engineStorage.removeItem(key);
    else engineStorage.setItem(key, next);
    notifyStateUpdated(key, false);
  }
}

export async function pushKeyToSharedServer<T>(
  key: string,
  val: T,
  deletedId?: string,
  options?: { background?: boolean }
): Promise<T> {
  const sanitizedVal = stripPlaintextCredentialsForStorage(key, val);
  if (getServerRuntime() || typeof window === 'undefined') return sanitizedVal;
  throw new Error('Utilisez une opération serveur explicite.');
  const headers = getAuthenticatedRequestHeaders();
  const isNetworkBlockedSim =
    typeof engineStorage !== 'undefined' &&
    engineStorage.getItem('syndik_simulate_network_offline') === 'true';

  if (isNetworkBlockedSim) {
    try {
      engineStorage.setItem('syndik_sync_status_v1', 'failed');
    } catch {
      // ignore
    }
    if (!options?.background) {
      throw new Error('Synchronisation serveur interrompue (réseau hors ligne).');
    }
    return sanitizedVal;
  }

  // In isolated Node unit tests with native fetch and no active session, skip network call unless fetch is mocked
  const isNativeUnconfiguredNodeFetch =
    typeof window === 'undefined' &&
    !headers['Authorization'] &&
    (typeof fetch === 'undefined' || fetch.toString().includes('[native code]'));

  if (isNativeUnconfiguredNodeFetch) {
    return sanitizedVal;
  }

  try {
    const res = await fetch('/api/shared-state', {
      method: 'POST',
      headers,
      body: JSON.stringify({ key, value: sanitizedVal, deletedId }),
    });
    if (!res.ok) {
      try {
        engineStorage.setItem('syndik_sync_status_v1', 'failed');
      } catch {
        // ignore
      }
      if (!options?.background) {
        throw new Error(`Échec d’écriture serveur durable (HTTP ${res.status})`);
      }
      return sanitizedVal;
    }
    try {
      engineStorage.setItem('syndik_sync_status_v1', 'synced');
    } catch {
      // ignore
    }
    const contentType = res.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (typeof data?.revision === 'number') {
        lastKnownServerRevision = data.revision;
        lastSyncTimestampMs = Date.now();
      }
      if (data && data.ok && data.value !== undefined && data.value !== null) {
        const cleanServerVal = stripPlaintextCredentialsForStorage(key, data.value as T);
        try {
          engineStorage.setItem(key, JSON.stringify(cleanServerVal));
        } catch {
          // ignore
        }
        return cleanServerVal;
      }
    }
    return sanitizedVal;
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    const causeCode = String(err?.cause?.code || '');
    const isRelativeUrlNodeError =
      causeCode === 'ERR_INVALID_URL' ||
      msg.includes('Failed to parse URL') ||
      msg.includes('Invalid URL');
    if (isRelativeUrlNodeError) {
      return sanitizedVal;
    }
    try {
      engineStorage.setItem('syndik_sync_status_v1', 'failed');
    } catch {
      // ignore
    }
    if (!options?.background) {
      throw err instanceof Error
        ? err
        : new Error('Échec de synchronisation durable avec le serveur.');
    }
    return sanitizedVal;
  }
}

export async function syncAllSharedStateFromServer(
  force: boolean = false
): Promise<Record<string, any> | null> {
  if (getServerRuntime()) return null;
  const headers = getAuthenticatedRequestHeaders();
  if (!headers['Authorization']) {
    return null;
  }

  // Coalesce concurrent sync requests fired on view mount
  if (inflightSyncPromise && !force) {
    return inflightSyncPromise;
  }
  if (!force && Date.now() - lastSyncTimestampMs < 1200 && lastKnownServerRevision > 0) {
    return null;
  }

  const generation = stateCacheGeneration;
  const controller = new AbortController();
  syncControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 15000);
  const task = (async () => {
    try {
      const url =
        !force && lastKnownServerRevision > 0
          ? `/api/shared-state?sinceRevision=${lastKnownServerRevision}`
          : '/api/shared-state';
      const res = await fetch(url, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: controller.signal,
      });
      if (generation !== stateCacheGeneration) return null;
      if (!res.ok) {
        if ([401, 403].includes(res.status) && typeof window !== 'undefined')
          window.dispatchEvent(new CustomEvent('syndik-session-invalid'));
        const failure = await readCommandResponse(res);
        throw new Error(failure.error || 'Chargement des données impossible.');
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('Le service de données ne répond pas correctement. Réessayez ou contactez le gestionnaire.');

      const data = await res.json();
      if (generation !== stateCacheGeneration) return null;
      if (!data || !data.ok) throw new Error('Le service de données ne répond pas correctement. Réessayez ou contactez le gestionnaire.');
      if (typeof data.revision === 'number' && data.revision < lastKnownServerRevision) return null;

      if (typeof data.revision === 'number') {
        lastKnownServerRevision = data.revision;
      }
      lastSyncTimestampMs = Date.now();

      if (data.unchanged || !data.store) {
        return null;
      }

      const serverStore = data.store as Record<string, any>;
      const trackedKeys = Object.values(STORAGE_KEYS);

      if (typeof window !== 'undefined' && serverStore.__resetAt) {
        const localResetAt = engineStorage.getItem('syndik_prod_last_reset_at');
        if (localResetAt !== String(serverStore.__resetAt)) {
          for (const k of trackedKeys) {
            engineStorage.removeItem(k);
          }
          engineStorage.setItem('syndik_prod_last_reset_at', String(serverStore.__resetAt));
        }
      }

      cacheServerStore(serverStore);
      return serverStore;
    } catch (error) {
      if (generation !== stateCacheGeneration) return null;
      throw error;
    } finally {
      clearTimeout(timeout);
      syncControllers.delete(controller);
    }
  })();

  inflightSyncPromise = task;
  const release = () => { if (inflightSyncPromise === task) inflightSyncPromise = null; };
  void task.then(release, release);
  return task;
}

export async function resetAllProductionData(): Promise<void> { throw new Error('Remise à zéro désactivée : utilisez la sauvegarde et restauration.'); }

// Purge any legacy test/mock keys in browser and sanitize credentials
if (typeof window !== 'undefined') {
  for (const key of Object.values(STORAGE_KEYS)) window.localStorage.removeItem(key);
  for (const oldKey of LEGACY_TEST_KEYS) {
    engineStorage.removeItem(oldKey);
  }
  sanitizeAccountRecordsInStorage();
  void syncAllSharedStateFromServer().catch(() => {});
}

// Helper to get or initialize local storage item
function getLocalItem<T>(key: string, defaultVal: T): T {
  try {
    const item = engineStorage.getItem(key);
    if (!item) {
      const cleanDefault = stripPlaintextCredentialsForStorage(key, defaultVal);
      engineStorage.setItem(key, JSON.stringify(cleanDefault));

      return cleanDefault;
    }
    return JSON.parse(item) as T;
  } catch (e) {
    console.error(`Error reading ${key} from engineStorage:`, e);
    return defaultVal;
  }
}

function setLocalItem<T>(key: string, val: T, deletedId?: string): void {
  try {
    if (deletedId) {
      const rawTombstones = engineStorage.getItem('syndik_deleted_building_ids_v1');
      const tombstones: string[] = rawTombstones ? JSON.parse(rawTombstones) : [];
      if (!tombstones.includes(deletedId)) {
        tombstones.push(deletedId);
        engineStorage.setItem('syndik_deleted_building_ids_v1', JSON.stringify(tombstones));
      }
    }
    const sanitized = stripPlaintextCredentialsForStorage(key, val);
    engineStorage.setItem(key, JSON.stringify(sanitized));

    notifyStateUpdated(key);
  } catch (e) {
    console.error(`Error writing ${key} to engineStorage:`, e);
  }
}

// Firestore Collection Names
const SYNDICS_COL = 'syndics';
const BUILDINGS_COL = 'buildings';
const APARTMENTS_COL = 'apartments';
const RESIDENTS_COL = 'residents';
const CHARGES_COL = 'charges';
const INVOICES_COL = 'invoices';
const TRANSACTIONS_COL = 'transactions';
const MAINTENANCE_COL = 'maintenance';
const NOTIFICATIONS_COL = 'notifications';
const PROOFS_COL = 'payment_proofs';
const QUITTANCES_COL = 'quittances';
const AG_COL = 'assemblees_generales';
const PRESTATAIRES_COL = 'prestataires';

async function syncSyndicToFirestoreIfAuthenticated(syndic: Syndic): Promise<void> {
  if (isMock) return;
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const cleanSyndic = stripPlaintextCredentialsForStorage(STORAGE_KEYS.SYNDICS, [syndic])[0];
  const payload = {
    id: String(cleanSyndic.id).slice(0, 128),
    name: String(cleanSyndic.name || 'Cabinet Syndic').slice(0, 200),
    logoUrl: String(cleanSyndic.logoUrl ?? '').slice(0, 2048),
    email: String(cleanSyndic.email || user.email || 'contact@syndik.ma').slice(0, 254),
    ...(cleanSyndic.phone ? { phone: String(cleanSyndic.phone).slice(0, 40) } : {}),
    ...(cleanSyndic.city ? { city: String(cleanSyndic.city).slice(0, 100) } : {}),
    ...(cleanSyndic.ice ? { ice: String(cleanSyndic.ice).slice(0, 32) } : {}),
    ...(cleanSyndic.rc ? { rc: String(cleanSyndic.rc).slice(0, 64) } : {}),
    subscriptionPlan: ['starter', 'professional', 'enterprise'].includes(cleanSyndic.subscriptionPlan)
      ? cleanSyndic.subscriptionPlan
      : 'starter',
    subscriptionStatus: ['active', 'expired', 'cancelled', 'trialing'].includes(cleanSyndic.subscriptionStatus)
      ? cleanSyndic.subscriptionStatus
      : 'trialing',
    ...(cleanSyndic.subscriptionExpiry
      ? { subscriptionExpiresAt: String(cleanSyndic.subscriptionExpiry).slice(0, 64) }
      : {}),
    createdBy: String(cleanSyndic.createdBy || user.uid)
      .replace(/[^a-zA-Z0-9_\-]/g, '-')
      .slice(0, 128),
    buildings: Array.isArray(cleanSyndic.buildings) ? cleanSyndic.buildings.slice(0, 50) : [],
  };

  try {
    const { setDoc, doc, db } = await import('./legacyClient');
    await setDoc(doc(db, SYNDICS_COL, payload.id), payload);
  } catch {
    // Keep UI flow uninterrupted
  }
}

export async function syncAuthAccountsFromFirestore(): Promise<void> {
  // Audit P0-1: Account credentials and password hashes are verified server-side (/api/auth/login)
  // and are NEVER stored in or fetched from public Firestore collections.
  return;
}

export async function syncPasswordChangeToFirestore(_params: {
  role: 'resident' | 'provider' | 'syndic' | 'admin';
  residentId?: string;
  prestataireId?: string;
  passwordHash: string;
}): Promise<void> {
  // Audit P0-1: Password hashes are updated via authenticated /api/auth/change-password, never written to public Firestore collections.
  return;
}

// ==========================================
// 1. SYNDIC & TENANT DATA
// ==========================================

export const getSyndics = async (): Promise<Syndic[]> => { await syncAllSharedStateFromServer(); return getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []).filter((s: any) => !s.archivedAt).map(s => ({ ...s, logoUrl: s.logoUrl ?? '', buildings: s.buildings.filter((b: any) => !b.archivedAt).map(b => ({ ...b, residents: b.residents.filter((r: any) => !r.archivedAt).map(r => ({ ...r,...ephemeralInvites.get(r.id) })), apartments: b.apartments.filter((a: any) => !a.archivedAt) })) })); };

export const saveSyndic = async (syndic: Syndic): Promise<Syndic> => {
  if (typeof window !== 'undefined') return remoteMutation('saveSyndic', [syndic]);

  const normalizedSyndic: Syndic = {
    ...syndic,
    logoUrl: syndic.logoUrl ?? '',
  };
  const validation = SyndicSchema.safeParse(normalizedSyndic);
  if (!validation.success) {
    console.warn('Syndic validation warning:', validation.error.message);
  }

  await syncAllSharedStateFromServer();
  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  const index = syndics.findIndex((s) => s.id === normalizedSyndic.id);
  let savedSyndic: Syndic;
  if (index >= 0) {
    savedSyndic = {
      ...syndics[index],
      ...normalizedSyndic,
      logoUrl: normalizedSyndic.logoUrl ?? syndics[index].logoUrl ?? '',
      buildings: Array.isArray(normalizedSyndic.buildings)
        ? normalizedSyndic.buildings
        : syndics[index].buildings || [],
    };
    syndics[index] = savedSyndic;
  } else {
    savedSyndic = {
      ...normalizedSyndic,
      logoUrl: normalizedSyndic.logoUrl ?? '',
      buildings: Array.isArray(normalizedSyndic.buildings) ? normalizedSyndic.buildings : [],
    };
    syndics.unshift(savedSyndic);
  }

  await pushKeyToSharedServer(STORAGE_KEYS.SYNDICS, syndics);
  setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
  await syncSyndicToFirestoreIfAuthenticated(savedSyndic);
  return savedSyndic;
};

// ==========================================
// 2. BUILDINGS
// ==========================================

export const getBuildingsForSyndic = async (syndicId: string): Promise<Building[]> => {
  await syncAllSharedStateFromServer();
  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  const targetSyndic = syndics.find((s) => s.id === syndicId);
  return targetSyndic?.buildings || [];
};

export const addBuilding = async (
  syndicId: string,
  buildingData: AddBuildingCommand['building']
) => {
  if (typeof window !== 'undefined') return remoteMutation('addBuilding', [syndicId, buildingData]);

  const { apartments, ...coreBuilding } = buildingData;
  const validation = BuildingSchema.safeParse({ ...coreBuilding, syndicId,
    reserveFundRate: coreBuilding.reserveFundRate !== undefined ? coreBuilding.reserveFundRate
      : coreBuilding.reserveFundPercentage !== undefined ? coreBuilding.reserveFundPercentage : 5 });
  if (!validation.success) {
    throw new Error('Invalid Building Data: ' + validation.error.message);
  }

  await syncAllSharedStateFromServer();
  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  const syndic = syndics.find((s) => s.id === syndicId);
  if (!syndic) throw new Error('Syndic introuvable ou non autorisé');

  // Audit Item 21: Enforce subscription status & building limits
  const isExpired =
    syndic.subscriptionStatus === 'expired' ||
    syndic.subscriptionStatus === 'cancelled' ||
    (syndic.subscriptionExpiry && new Date(syndic.subscriptionExpiry).getTime() < Date.now());
  if (isExpired) {
    throw new Error(
      'Abonnement expiré. Veuillez renouveler votre abonnement pour ajouter un nouvel immeuble.'
    );
  }
  const { limit: maxBuildings, canAdd } = getBuildingCapacity(syndic);
  if (!canAdd) {
    throw new Error(
      `Limite atteinte pour le forfait ${syndic.subscriptionPlan} (${maxBuildings} immeuble(s) max).`
    );
  }

  const newBuildingId = crypto.randomUUID();
  const totalLots = apartments?.length || 0;
  const baseTantiemes = totalLots > 0 ? Math.floor(1000 / totalLots) : 100;
  const remainderTantiemes = totalLots > 0 ? 1000 - baseTantiemes * totalLots : 0;

  const generatedApts: Apartment[] = (apartments || []).map((apt, idx) => ({
    id: `apt-${crypto.randomUUID()}`,
    buildingId: newBuildingId,
    number: apt.number,
    floor: apt.floor,
    area: apt.area,
    monthlyFees: apt.monthlyFees ?? coreBuilding.monthlySyndicFees,
    tantiemes:
      apt.tantiemes ??
      (baseTantiemes + (idx < remainderTantiemes ? 1 : 0)),
    coproType: apt.coproType || 'apartment',
    ownerId: null,
    tenantId: null,
  }));

  const newBuilding: Building = {
    id: newBuildingId,
    syndicId: syndic.id,
    name: coreBuilding.name,
    address: coreBuilding.address,
    city: coreBuilding.city,
    monthlySyndicFees: coreBuilding.monthlySyndicFees,
    totalTantiemes: 1000,
    reserveFundRate: validation.data.reserveFundRate,
    bankName: coreBuilding.bankName,
    bankRib: coreBuilding.bankRib,
    managerName: coreBuilding.managerName,
    managerPhone: coreBuilding.managerPhone,
    residents: [],
    apartments: generatedApts,
    announcements: [],
    documents: [],
    financials: { balance: 0, reserveFundBalance: 0, transactions: [] },
  };

  syndic.buildings.push(newBuilding);
  await pushKeyToSharedServer(STORAGE_KEYS.SYNDICS, syndics);
  setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
  await syncSyndicToFirestoreIfAuthenticated(syndic);
  return newBuilding;
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
  > & { syncApartmentFees?: boolean }
) => {
  if (typeof window !== 'undefined') return remoteMutation('updateBuilding', [buildingId, updates]);

  const { syncApartmentFees, ...buildingUpdates } = updates;
  BuildingSchema.partial().parse(buildingUpdates);
  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const idx = syndic.buildings.findIndex((b) => b.id === buildingId);
      if (idx >= 0) {
        const bld = syndic.buildings[idx];
        const updatedBuilding: Building = {
          ...bld,
          ...buildingUpdates,
          reserveFundRate: buildingUpdates.reserveFundRate ?? getBuildingReserveRate(bld),
        };
        delete updatedBuilding.reserveFundPercentage;
        if (syncApartmentFees && typeof buildingUpdates.monthlySyndicFees === 'number') {
          updatedBuilding.apartments = updatedBuilding.apartments.map((apt) => ({
            ...apt,
            monthlyFees: buildingUpdates.monthlySyndicFees!,
          }));
        }
        syndic.buildings[idx] = updatedBuilding;
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        void syncSyndicToFirestoreIfAuthenticated(syndic);
        return updatedBuilding;
      }
    }
    throw new Error('Building not found');
  }

  const { doc, db, updateDoc } = await import('./legacyClient');
  const docRef = doc(db, BUILDINGS_COL, buildingId);
  await updateDoc(docRef, buildingUpdates as any);
  return { id: buildingId, ...buildingUpdates };
};

export const deleteBuilding = async (buildingId: string) => {
  if (typeof window !== 'undefined') return remoteMutation('deleteBuilding', [buildingId]);

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const idx = syndic.buildings.findIndex((b) => b.id === buildingId);
      if (idx >= 0) {
        syndic.buildings.splice(idx, 1);
        // Audit Item 18: Pass buildingId as deletedId tombstone so shared server never restores it
        await pushKeyToSharedServer(STORAGE_KEYS.SYNDICS, syndics, buildingId);
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics, buildingId);
        void syncSyndicToFirestoreIfAuthenticated(syndic);
        return true;
      }
    }
    return true;
  }

  const { deleteDoc, doc, db } = await import('./legacyClient');
  await deleteDoc(doc(db, BUILDINGS_COL, buildingId));
  return true;
};

// ==========================================
// 3. APARTMENTS & TANTIÈMES (SINGLE & BULK)
// ==========================================

export const addApartment = async (apartmentData: Omit<Apartment, 'id'>) => {
  if (typeof window !== 'undefined') return remoteMutation('addApartment', [apartmentData]);

  const validation = ApartmentSchema.safeParse(apartmentData);
  if (!validation.success) {
    throw new Error('Invalid Apartment Data: ' + validation.error.message);
  }

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === apartmentData.buildingId);
      if (bld) {
        const newApt: Apartment = {
          id: `apt-${crypto.randomUUID()}`,
          ...apartmentData,
          monthlyFees: apartmentData.monthlyFees ?? bld.monthlySyndicFees,
          tantiemes: apartmentData.tantiemes ?? 100,
          coproType: apartmentData.coproType ?? 'apartment',
        };
        bld.apartments.push(newApt);

        if (newApt.ownerId) {
          const owner = bld.residents.find((r) => r.id === newApt.ownerId);
          if (owner) owner.apartmentId = newApt.id;
        }
        if (newApt.tenantId) {
          const tenant = bld.residents.find((r) => r.id === newApt.tenantId);
          if (tenant) tenant.apartmentId = newApt.id;
        }

        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        void syncSyndicToFirestoreIfAuthenticated(syndic);
        return newApt;
      }
    }
  }

  const { addDoc, collection, db } = await import('./legacyClient');
  const docRef = await addDoc(collection(db, APARTMENTS_COL), apartmentData);
  return { id: docRef.id, ...apartmentData };
};

export const addApartmentsBulk = async (
  buildingId: string,
  apartmentsList: Omit<Apartment, 'id' | 'buildingId'>[]
) => {
  if (typeof window !== 'undefined') return remoteMutation('addApartmentsBulk', [buildingId, apartmentsList]);

  if (!apartmentsList.length) return [];

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === buildingId);
      if (bld) {
        const existingNumbers = new Set(
          bld.apartments.map((a) => a.number.trim().toLowerCase())
        );
        const createdApartments: Apartment[] = [];
        const baseTimestamp = Date.now();

        apartmentsList.forEach((aptData, idx) => {
          const normalizedNum = aptData.number.trim().toLowerCase();
          if (existingNumbers.has(normalizedNum)) return;
          existingNumbers.add(normalizedNum);

          const newApt: Apartment = {
            id: `apt-${baseTimestamp}-${idx}`,
            buildingId,
            number: aptData.number.trim(),
            floor: Number(aptData.floor) || 0,
            area: Number(aptData.area) || 60,
            monthlyFees:
              aptData.monthlyFees !== undefined && aptData.monthlyFees !== null
                ? Number(aptData.monthlyFees)
                : bld.monthlySyndicFees,
            tantiemes: Number(aptData.tantiemes) || 100,
            coproType: aptData.coproType || 'apartment',
            ownerId: aptData.ownerId || null,
            tenantId: aptData.tenantId || null,
          };
          bld.apartments.push(newApt);
          createdApartments.push(newApt);
        });

        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        void syncSyndicToFirestoreIfAuthenticated(syndic);
        return createdApartments;
      }
    }
    throw new Error('Building not found');
  }

  const created: Apartment[] = [];
  for (const apt of apartmentsList) {
    const payload = { ...apt, buildingId };
    const { addDoc, collection, db } = await import('./legacyClient');
    const docRef = await addDoc(collection(db, APARTMENTS_COL), payload);
    created.push({ id: docRef.id, ...payload });
  }
  return created;
};

export const rebalanceBuildingTantiemes = async (buildingId: string) => {
  if (typeof window !== 'undefined') return remoteMutation('rebalanceBuildingTantiemes', [buildingId]);

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === buildingId);
      if (bld && bld.apartments.length > 0) {
        const totalArea = bld.apartments.reduce((sum, a) => sum + (Number(a.area) || 1), 0);
        let allocated = 0;
        bld.apartments = bld.apartments.map((apt, idx) => {
          if (idx === bld.apartments.length - 1) {
            return { ...apt, tantiemes: Math.max(1, 1000 - allocated) };
          }
          const share = Math.max(1, Math.round(((Number(apt.area) || 1) / totalArea) * 1000));
          allocated += share;
          return { ...apt, tantiemes: share };
        });
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        void syncSyndicToFirestoreIfAuthenticated(syndic);
        return bld.apartments;
      }
    }
  }
  return [];
};

export const updateApartment = async (apartment: Apartment) => {
  if (typeof window !== 'undefined') return remoteMutation('updateApartment', [apartment]);

  const validation = ApartmentSchema.safeParse(apartment);
  if (!validation.success) {
    throw new Error('Invalid Apartment Data: ' + validation.error.message);
  }

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === apartment.buildingId);
      if (bld) {
        const idx = bld.apartments.findIndex((a) => a.id === apartment.id);
        if (idx >= 0) {
          const prevApt = bld.apartments[idx];
          bld.apartments[idx] = { ...prevApt, ...apartment };

          if (prevApt.ownerId && prevApt.ownerId !== apartment.ownerId) {
            const oldOwner = bld.residents.find((r) => r.id === prevApt.ownerId);
            if (oldOwner && oldOwner.apartmentId === apartment.id) {
              const otherOwned = bld.apartments.find(
                (a) => a.id !== apartment.id && (a.ownerId === oldOwner.id || a.tenantId === oldOwner.id)
              );
              oldOwner.apartmentId = otherOwned?.id || undefined;
            }
          }
          if (prevApt.tenantId && prevApt.tenantId !== apartment.tenantId) {
            const oldTenant = bld.residents.find((r) => r.id === prevApt.tenantId);
            if (oldTenant && oldTenant.apartmentId === apartment.id) {
              const otherRented = bld.apartments.find(
                (a) => a.id !== apartment.id && (a.ownerId === oldTenant.id || a.tenantId === oldTenant.id)
              );
              oldTenant.apartmentId = otherRented?.id || undefined;
            }
          }
          if (apartment.ownerId) {
            const newOwner = bld.residents.find((r) => r.id === apartment.ownerId);
            if (newOwner) newOwner.apartmentId = apartment.id;
          }
          if (apartment.tenantId) {
            const newTenant = bld.residents.find((r) => r.id === apartment.tenantId);
            if (newTenant) newTenant.apartmentId = apartment.id;
          }

          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
          void syncSyndicToFirestoreIfAuthenticated(syndic);
          return apartment;
        }
      }
    }
  }

  const { doc, db, updateDoc } = await import('./legacyClient');
  const docRef = doc(db, APARTMENTS_COL, apartment.id);
  await updateDoc(docRef, apartment as any);
  return apartment;
};

export const deleteApartment = async (apartmentId: string) => {
  if (typeof window !== 'undefined') return remoteMutation('deleteApartment', [apartmentId]);

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      for (const bld of syndic.buildings) {
        const idx = bld.apartments.findIndex((a) => a.id === apartmentId);
        if (idx >= 0) {
          bld.apartments.splice(idx, 1);
          bld.residents.forEach((res) => {
            if (res.apartmentId === apartmentId) {
              const fallbackApt = bld.apartments.find(
                (a) => a.ownerId === res.id || a.tenantId === res.id
              );
              res.apartmentId = fallbackApt?.id || undefined;
            }
          });
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics, apartmentId);
          return true;
        }
      }
    }
    return true;
  }

  const { deleteDoc, doc, db } = await import('./legacyClient');
  await deleteDoc(doc(db, APARTMENTS_COL, apartmentId));
  return true;
};

// ==========================================
// 4. RESIDENTS & HASHED CREDENTIALS (Audit Item 03)
// ==========================================

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

const RESIDENT_ACCOUNTS_KEY = STORAGE_KEYS.RESIDENT_ACCOUNTS;

function generateTempPassword(name: string): string {
  const cleanPrefix =
    name
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 4)
      .toUpperCase() || 'RES';
  const digits = generateSecureRandomDigits(32);
  return `Syndik-${cleanPrefix}${digits}!`;
}

function saveResidentCredentialAccount(resident: Resident, rawPassword: string): ResidentAccountRecord {
  const accounts = getLocalItem<ResidentAccountRecord[]>(RESIDENT_ACCOUNTS_KEY, []);
  const emailNorm = resident.email.trim().toLowerCase();
  const passwordHash = getServerRuntime()?.hashPassword(rawPassword) || hashPasswordSync(rawPassword, emailNorm);
  const record: ResidentAccountRecord = {
    residentId: resident.id,
    email: resident.email.trim(),
    cin: resident.cin?.trim() || undefined,
    phone: resident.phone?.trim() || undefined,
    passwordHash,
    name: resident.name,
    isOwner: resident.isOwner,
    syndicId: resident.syndicId,
    buildingId: resident.buildingId,
    apartmentId: resident.apartmentId,
    createdAt: resident.credentialsCreatedAt || new Date().toISOString(),
    mustChangePassword: resident.mustChangePassword ?? true,
    invitationExpiresAt: resident.invitationExpiresAt,
  };
  const existingIdx = accounts.findIndex(
    (a) => a.residentId === resident.id || a.email.toLowerCase() === emailNorm
  );
  if (existingIdx >= 0) {
    accounts[existingIdx] = record;
  } else {
    accounts.push(record);
  }
  setLocalItem(RESIDENT_ACCOUNTS_KEY, accounts);

  // Also synchronize any matching entry in REGISTERED_USERS so all local registries carry the complete Resident UserProfile
  try {
    const regUsers = getLocalItem<any[]>(STORAGE_KEYS.REGISTERED_USERS, []);
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    let buildingName = 'Résidence';
    let apartmentNumber = resident.apartmentId || '';
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === resident.buildingId);
      if (bld) {
        buildingName = bld.name;
        const apt = bld.apartments.find((a) => a.id === resident.apartmentId);
        if (apt) apartmentNumber = apt.number;
        break;
      }
    }
    const canonicalUid = `user-res-${resident.id}`;
    const canonicalProfile = {
      uid: canonicalUid,
      email: emailNorm,
      displayName: resident.name,
      role: 'resident' as const,
      syndicId: resident.syndicId,
      buildingId: resident.buildingId,
      buildingName,
      apartmentId: resident.apartmentId,
      apartmentNumber,
      residentId: resident.id,
      cin: resident.cin?.trim() || undefined,
      phone: resident.phone?.trim() || undefined,
      isOwner: resident.isOwner,
      mustChangePassword: resident.mustChangePassword ?? true,
    };
    const regIdx = regUsers.findIndex(
      (u) =>
        u?.email?.toLowerCase() === emailNorm ||
        u?.uid === canonicalUid ||
        u?.uid === `res-${resident.id}` ||
        u?.profile?.residentId === resident.id
    );
    const regEntry = {
      uid: canonicalUid,
      email: emailNorm,
      passwordHash,
      profile: canonicalProfile,
      createdAt: record.createdAt,
    };
    if (regIdx >= 0) {
      regUsers[regIdx] = regEntry;
    } else {
      regUsers.push(regEntry);
    }
    setLocalItem(STORAGE_KEYS.REGISTERED_USERS, regUsers);
  } catch {
    // ignore
  }

  return record;
}

export const addResident = async (
  residentData: Omit<Resident, 'id'>,
  generateCredentials: boolean = true
): Promise<Resident> => {
  if (typeof window !== 'undefined') return remoteMutation('addResident', [residentData, generateCredentials]);

  const cleanedData = {
    ...residentData,
    apartmentId: residentData.apartmentId || undefined,
    cin: residentData.cin?.trim() || undefined,
  };
  const validation = ResidentSchema.safeParse(cleanedData);
  if (!validation.success) {
    throw new Error('Invalid Resident Data: ' + validation.error.message);
  }

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === cleanedData.buildingId);
      if (bld) {
        const nowIso = new Date().toISOString();
        const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
        const inviteToken = generateCredentials
          ? `inv-${generateSecureRandomDigits(32).toLowerCase()}`
          : undefined;
        const auditAction: CredentialAuditEntry['action'] = 'generated';
        const persistedResident: Resident = {
          id: crypto.randomUUID(),
          ...cleanedData,
          hasAccount: !!generateCredentials,
          invitationStatus: generateCredentials ? 'pending' : undefined,
          invitationToken: inviteToken,
          invitationCode: inviteToken,
          invitationExpiresAt: generateCredentials ? inviteExpiresAt : undefined,
          credentialsCreatedAt: generateCredentials ? nowIso : undefined,
          credentialsAuditLog: generateCredentials
            ? [{ action: auditAction, timestamp: nowIso }]
            : [],
          mustChangePassword: generateCredentials ? true : undefined,
        };
        delete (persistedResident as any).generatedPassword;
        bld.residents.push(persistedResident);

        if (persistedResident.apartmentId) {
          const apt = bld.apartments.find((a) => a.id === persistedResident.apartmentId);
          if (apt) {
            if (persistedResident.isOwner) {
              apt.ownerId = persistedResident.id;
            } else {
              apt.tenantId = persistedResident.id;
            }
          }
        }

        if (generateCredentials && inviteToken) {
          saveResidentCredentialAccount(persistedResident, inviteToken);
        }

        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        void syncSyndicToFirestoreIfAuthenticated(syndic);
        return persistedResident;
      }
    }
  }

  const { addDoc, collection, db } = await import('./legacyClient');
  const docRef = await addDoc(collection(db, RESIDENTS_COL), cleanedData);
  return { id: docRef.id, ...cleanedData };
};

export const updateResident = async (resident: Resident): Promise<Resident> => {
  if (typeof window !== 'undefined') return remoteMutation('updateResident', [resident]);

  const { generatedPassword: ephemeralPassword, ...residentWithoutPassword } = resident;
  const cleanedResident: Resident = {
    ...residentWithoutPassword,
    apartmentId: resident.apartmentId || undefined,
    cin: resident.cin?.trim() || undefined,
  };
  const validation = ResidentSchema.safeParse(cleanedResident);
  if (!validation.success) {
    throw new Error('Invalid Resident Data: ' + validation.error.message);
  }

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === cleanedResident.buildingId);
      if (bld) {
        const idx = bld.residents.findIndex((r) => r.id === cleanedResident.id);
        if (idx >= 0) {
          const prevResident = bld.residents[idx];
          const mergedResident: Resident = {
            ...prevResident,
            ...cleanedResident,
          };
          bld.residents[idx] = mergedResident;

          bld.apartments.forEach((apt) => {
            if (apt.id !== mergedResident.apartmentId) {
              if (apt.ownerId === mergedResident.id) apt.ownerId = null;
              if (apt.tenantId === mergedResident.id) apt.tenantId = null;
            }
          });

          if (mergedResident.apartmentId) {
            const targetApt = bld.apartments.find((a) => a.id === mergedResident.apartmentId);
            if (targetApt) {
              if (mergedResident.isOwner) {
                targetApt.ownerId = mergedResident.id;
                if (targetApt.tenantId === mergedResident.id) targetApt.tenantId = null;
              } else {
                targetApt.tenantId = mergedResident.id;
                if (targetApt.ownerId === mergedResident.id) targetApt.ownerId = null;
              }
            }
          }

          if (mergedResident.hasAccount && ephemeralPassword) {
            saveResidentCredentialAccount(mergedResident, ephemeralPassword);
          } else if (mergedResident.hasAccount) {
            const activeTempPass =
              mergedResident.mustChangePassword !== false
                ? mergedResident.invitationCode || mergedResident.invitationToken
                : undefined;
            if (activeTempPass) {
              saveResidentCredentialAccount(mergedResident, activeTempPass);
            } else {
              const accounts = getLocalItem<ResidentAccountRecord[]>(RESIDENT_ACCOUNTS_KEY, []);
              const accIdx = accounts.findIndex((a) => a.residentId === mergedResident.id);
              if (accIdx >= 0) {
                accounts[accIdx] = {
                  ...accounts[accIdx],
                  email: mergedResident.email.trim(),
                  cin: mergedResident.cin?.trim() || undefined,
                  phone: mergedResident.phone?.trim() || undefined,
                  name: mergedResident.name,
                  isOwner: mergedResident.isOwner,
                  apartmentId: mergedResident.apartmentId,
                  invitationExpiresAt: mergedResident.invitationExpiresAt,
                };
                setLocalItem(RESIDENT_ACCOUNTS_KEY, accounts);
              }
            }
          }

          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
          void syncSyndicToFirestoreIfAuthenticated(syndic);
          return mergedResident;
        }
      }
    }
  }

  const { doc, db, updateDoc } = await import('./legacyClient');
  const docRef = doc(db, RESIDENTS_COL, cleanedResident.id);
  await updateDoc(docRef, cleanedResident as any);
  return cleanedResident;
};

export const regenerateResidentCredentials = async (residentId: string): Promise<Resident> => {
  if (typeof window !== 'undefined') return remoteMutation('regenerateResidentCredentials', [residentId]);

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      for (const bld of syndic.buildings) {
        const idx = bld.residents.findIndex((r) => r.id === residentId);
        if (idx >= 0) {
          const res = bld.residents[idx];
          const nowIso = new Date().toISOString();
          const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
          const inviteToken = `inv-${generateSecureRandomDigits(32).toLowerCase()}`;
          const prevLog = Array.isArray(res.credentialsAuditLog) ? res.credentialsAuditLog : [];
          const actionType: CredentialAuditEntry['action'] = res.hasAccount
            ? 'regenerated'
            : 'generated';
          const updated: Resident = {
            ...res,
            hasAccount: true,
            invitationStatus: 'pending',
            invitationToken: inviteToken,
            invitationCode: inviteToken,
            invitationExpiresAt: inviteExpiresAt,
            credentialsCreatedAt: nowIso,
            credentialsAuditLog: [
              { action: actionType, timestamp: nowIso },
              ...prevLog,
            ].slice(0, 20),
            mustChangePassword: true,
          };
          delete (updated as any).generatedPassword;
          bld.residents[idx] = updated;
          saveResidentCredentialAccount(updated, inviteToken);
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
          void syncSyndicToFirestoreIfAuthenticated(syndic);
          return updated;
        }
      }
    }
  }
  throw new Error('Resident not found');
};

export const recordResidentCredentialShare = async (
  residentId: string,
  method: 'pdf' | 'copy'
): Promise<Resident | null> => {
  if (typeof window !== 'undefined') return remoteMutation('recordResidentCredentialShare', [residentId, method]);

  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  for (const syndic of syndics) {
    for (const bld of syndic.buildings) {
      const idx = bld.residents.findIndex((r) => r.id === residentId);
      if (idx >= 0) {
        const res = bld.residents[idx];
        const nowIso = new Date().toISOString();
        const prevLog = Array.isArray(res.credentialsAuditLog) ? res.credentialsAuditLog : [];
        const actionType: CredentialAuditEntry['action'] =
          method === 'pdf' ? 'shared_pdf' : 'shared_copy';
        const updated: Resident = {
          ...res,
          credentialsSharedAt: nowIso,
          credentialsLastSharedMethod: method,
          credentialsAuditLog: [
            { action: actionType, timestamp: nowIso },
            ...prevLog,
          ].slice(0, 20),
        };
        bld.residents[idx] = updated;
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        void syncSyndicToFirestoreIfAuthenticated(syndic);
        return updated;
      }
    }
  }
  return null;
};

export const deleteResident = async (residentId: string) => {
  if (typeof window !== 'undefined') return remoteMutation('deleteResident', [residentId]);

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      for (const bld of syndic.buildings) {
        const idx = bld.residents.findIndex((r) => r.id === residentId);
        if (idx >= 0) {
          bld.residents.splice(idx, 1);
          bld.apartments.forEach((apt) => {
            if (apt.ownerId === residentId) apt.ownerId = null;
            if (apt.tenantId === residentId) apt.tenantId = null;
          });
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics, residentId);

          const accounts = getLocalItem<ResidentAccountRecord[]>(RESIDENT_ACCOUNTS_KEY, []);
          setLocalItem(
            RESIDENT_ACCOUNTS_KEY,
            accounts.filter((a) => a.residentId !== residentId),
            residentId
          );
          return true;
        }
      }
    }
    return true;
  }

  const { deleteDoc, doc, db } = await import('./legacyClient');
  await deleteDoc(doc(db, RESIDENTS_COL, residentId));
  return true;
};

// ==========================================
// 5. CHARGES & TANTIÈMES ENGINE (Audit Items 12 & 16)
// ==========================================

export const getChargesForBuilding = async (buildingId: string): Promise<Charge[]> => {
  if (isLocalEngineEnabled) {
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    return charges.filter((c) => c.buildingId === buildingId);
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, CHARGES_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Charge));
};

export const getChargesForResident = async (residentId: string): Promise<Charge[]> => {
  if (isLocalEngineEnabled) {
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    return charges.filter((c) => c.residentId === residentId);
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, CHARGES_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Charge));
};

export type GenerateChargesResult = Charge[] & {
  success: boolean;
  count: number;
  createdCount: number;
  skippedCount: number;
};

const FRENCH_MONTHS_TO_NUM: Record<string, string> = {
  janvier: '01',
  jan: '01',
  fevrier: '02',
  février: '02',
  fev: '02',
  fév: '02',
  mars: '03',
  mar: '03',
  avril: '04',
  avr: '04',
  mai: '05',
  juin: '06',
  juillet: '07',
  juil: '07',
  aout: '08',
  août: '08',
  septembre: '09',
  sep: '09',
  sept: '09',
  octobre: '10',
  oct: '10',
  novembre: '11',
  nov: '11',
  decembre: '12',
  décembre: '12',
  dec: '12',
  déc: '12',
};

export function normalizeBillingPeriodKey(periodStr: string): string {
  const cleaned = (periodStr || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleaned) return '';

  // Match ISO YYYY-MM or YYYY/MM
  const isoMatch = cleaned.match(/^(\d{4})[-/](\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}`;
  }

  // Match MM/YYYY or MM-YYYY
  const revIsoMatch = cleaned.match(/^(\d{1,2})[-/](\d{4})$/);
  if (revIsoMatch) {
    return `${revIsoMatch[2]}-${revIsoMatch[1].padStart(2, '0')}`;
  }

  // Match French month + year (e.g. "octobre 2026" or "2026 octobre")
  const tokens = cleaned.split(/[\s\-_/]+/);
  let foundYear: string | undefined;
  let foundMonth: string | undefined;
  for (const tok of tokens) {
    if (/^\d{4}$/.test(tok)) {
      foundYear = tok;
    } else if (FRENCH_MONTHS_TO_NUM[tok]) {
      foundMonth = FRENCH_MONTHS_TO_NUM[tok];
    }
  }
  if (foundYear && foundMonth) {
    return `${foundYear}-${foundMonth}`;
  }

  return cleaned;
}

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
      }
): Promise<GenerateChargesResult> => {
  if (typeof window !== 'undefined') return remoteMutation('generateMonthlyCharges', [buildingId, syndicId, periodOrOptions, maybeOptions]);

  const now = new Date();
  const defaultPeriod = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  const resolvedPeriod =
    typeof periodOrOptions === 'string'
      ? periodOrOptions.trim() || defaultPeriod
      : periodOrOptions?.periodName?.trim() || defaultPeriod;

  const normalizedMaybeOptions =
    typeof maybeOptions === 'boolean'
      ? { useTantiemes: maybeOptions }
      : maybeOptions || {};

  const opts =
    typeof periodOrOptions === 'object' && periodOrOptions !== null
      ? { ...periodOrOptions, ...normalizedMaybeOptions }
      : normalizedMaybeOptions;

  const resolvedChargeType: Charge['chargeType'] = opts.chargeType || 'courante';
  const normalizedPeriodKey = normalizeBillingPeriodKey(resolvedPeriod);

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    const syndic = syndics.find((s) => s.id === syndicId) || syndics.find((s) => s.buildings.some((b) => b.id === buildingId));
    const building = syndic?.buildings.find((b) => b.id === buildingId);

    if (!building) {
      const empty = Object.assign([] as Charge[], {
        success: false,
        count: 0,
        createdCount: 0,
        skippedCount: 0,
      });
      return empty;
    }

    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    const [billingYear, billingMonth] = normalizedPeriodKey.split('-').map(Number);
    const dueDate = new Date(Date.UTC(billingYear, billingMonth - 1, 5))
      .toISOString()
      .split('T')[0];

    const totalTantiemes = building.totalTantiemes || 1000;
    const budgetToSplit = opts.totalBudgetToSplit ?? opts.totalMonthlyBudget;
    const useTantiemesBudget =
      typeof budgetToSplit === 'number' && budgetToSplit > 0 && opts.useTantiemes !== false;

    // Precompute centime-exact allocations across all apartments in the building (Audit Item 16)
    const centimeAllocationMap = useTantiemesBudget
      ? allocateBudgetInCentimes(
          budgetToSplit!,
          building.apartments.filter((a: any) => !a.archivedAt).map((a) => ({ id: a.id, tantiemes: a.tantiemes ?? 100 })),
          totalTantiemes
        )
      : null;

    const newCharges: Charge[] = [];
    let skippedCount = 0;

    building.apartments.filter((a: any) => !a.archivedAt).forEach((apt) => {
      const residentId =
        apt.ownerId ||
        apt.tenantId ||
        building.residents.find((r) => r.apartmentId === apt.id)?.id;
      if (!residentId) return;

      // Audit Item 12: Stable period uniqueness check per (buildingId, apartmentId, normalizedPeriod, chargeType)
      const alreadyBilled = charges.some(
        (existing) =>
          existing.buildingId === buildingId &&
          existing.apartmentId === apt.id &&
          normalizeBillingPeriodKey(existing.period || '') === normalizedPeriodKey &&
          (existing.chargeType || 'courante') === resolvedChargeType
      );
      if (alreadyBilled) {
        skippedCount += 1;
        return;
      }

      const shares = apt.tantiemes ?? 100;
      // Audit Item 16: Respect explicitly configured 0 fee via ?? instead of ||
      const baseFee = apt.monthlyFees ?? building.monthlySyndicFees ?? 0;
      const computedAmount = centimeAllocationMap
        ? centimeAllocationMap.get(apt.id) ?? baseFee
        : Math.round(baseFee * 100) / 100;

      const stableId = `chg-${buildingId}-${apt.id}-${normalizedPeriodKey.replace(/[^a-z0-9]/g, '_')}-${resolvedChargeType}`;
      const newCharge: Charge = {
        id: stableId,
        syndicId: building.syndicId || syndicId,
        buildingId,
        apartmentId: apt.id,
        residentId,
        amount: computedAmount,
        paidAmount: 0,
        dueDate,
        status: 'unpaid',
        period: resolvedPeriod,
        periodKey: normalizedPeriodKey,
        chargeType: resolvedChargeType,
        tantiemesApplied: shares,
        createdAt: now.toISOString(),
      };
      newCharges.push(newCharge);
    });

    if (newCharges.length > 0) {
      const updated = [...newCharges, ...charges];
      setLocalItem(STORAGE_KEYS.CHARGES, updated);
    }

    return Object.assign(newCharges, {
      success: true,
      count: newCharges.length,
      createdCount: newCharges.length,
      skippedCount,
    });
  }

  const { httpsCallable, functions } = await import('./legacyClient');
  const generateChargesFn = httpsCallable(functions, 'generateMonthlyCharges');
  const res = await generateChargesFn({
    buildingId,
    syndicId,
    period: resolvedPeriod,
    options: opts,
  });
  const data = (res.data as any) || {};
  return Object.assign((data.charges || []) as Charge[], {
    success: true,
    count: data.count || 0,
    createdCount: data.count || 0,
    skippedCount: data.skippedCount || 0,
  });
};

// ==========================================
// 6. PAYMENT PROOFS & VALIDATION WORKFLOW (Audit Item 13 & 16)
// ==========================================

export const getPaymentProofsForBuilding = async (buildingId: string): Promise<PaymentProof[]> => {
  if (isLocalEngineEnabled) {
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
    return proofs.filter((p) => p.buildingId === buildingId);
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, PROOFS_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentProof));
};

export const getPaymentProofsForResident = async (residentId: string): Promise<PaymentProof[]> => {
  if (isLocalEngineEnabled) {
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
    return proofs.filter((p) => p.residentId === residentId);
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, PROOFS_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentProof));
};

export const submitPaymentProof = async (
  proofData: Omit<PaymentProof, 'id' | 'submissionDate' | 'status'>
): Promise<PaymentProof> => {
  if (typeof window !== 'undefined') return remoteMutation('submitPaymentProof', [proofData]);

  if (!proofData.amount || proofData.amount <= 0) {
    throw new Error('Le montant du justificatif doit être supérieur à 0 MAD.');
  }

  // Phase 3.1: Pre-compute confidence score against target Charge for 1-click batch approval
  let matchScore = 70;
  let matchStatus: PaymentProof['matchStatus'] = 'partial_match';
  let matchedChargeAmount: number | undefined;
  try {
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    const targetCharge = charges.find((c) => c.id === proofData.chargeId);
    if (targetCharge) {
      const remaining = Math.max(0, targetCharge.amount - (targetCharge.paidAmount || 0));
      matchedChargeAmount = remaining;
      if (Math.abs(proofData.amount - remaining) < 0.01) {
        matchScore = proofData.referenceNumber && proofData.referenceNumber.trim().length >= 3 ? 98 : 92;
        matchStatus = 'exact_match';
      } else if (proofData.amount <= remaining) {
        matchScore = 82;
        matchStatus = 'partial_match';
      } else {
        matchScore = 45;
        matchStatus = 'unmatched';
      }
    }
  } catch {
    // ignore
  }

  const newProof: PaymentProof = {
    id: `prf-${crypto.randomUUID()}`,
    submissionDate: new Date().toISOString(),
    status: 'pending',
    matchScore,
    matchStatus,
    matchedChargeAmount,
    ...proofData,
  };

  if (isLocalEngineEnabled) {
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
    proofs.unshift(newProof);
    setLocalItem(STORAGE_KEYS.PROOFS, proofs);
    return newProof;
  }

  const { addDoc, collection, db } = await import('./legacyClient');
  const docRef = await addDoc(collection(db, PROOFS_COL), newProof);
  return { id: docRef.id, ...newProof };
};

export const approvePaymentProofsBatch = async (
  buildingId: string,
  proofIds?: string[]
): Promise<{ approvedCount: number; totalAmountMad: number; quittances: Quittance[] }> => {
  if (typeof window !== 'undefined') return remoteMutation('approvePaymentProofsBatch', [buildingId, proofIds]);

  const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
  const candidates = proofs.filter((p) => {
    if (p.buildingId !== buildingId || p.status !== 'pending') return false;
    if (Array.isArray(proofIds) && proofIds.length > 0) {
      return proofIds.includes(p.id);
    }
    if (p.matchStatus === 'exact_match' || (p.matchScore && p.matchScore >= 90)) return true;
    const chg = charges.find((c) => c.id === p.chargeId);
    if (!chg) return false;
    const remaining = Math.max(0, chg.amount - (chg.paidAmount || 0));
    return Math.abs(p.amount - remaining) < 0.01;
  });

  let approvedCount = 0;
  let totalAmountMad = 0;
  const quittances: Quittance[] = [];

  for (const cand of candidates) {
    const res = await reviewPaymentProof(cand.id, 'approved');
    if (res.success) {
      approvedCount += 1;
      totalAmountMad = Math.round((totalAmountMad + cand.amount) * 100) / 100;
      if (res.quittance) quittances.push(res.quittance);
    }
  }

  return { approvedCount, totalAmountMad, quittances };
};

export interface BankStatementCSVRow {
  date: string;
  label: string;
  amount: number;
  reference?: string;
  bankName?: string;
}

export const reconcileBankStatementCSV = async (
  buildingId: string,
  rows: BankStatementCSVRow[]
): Promise<{
  matchedCount: number;
  unmatchedCount: number;
  totalReconciledMad: number;
  quittances: Quittance[];
}> => {
  if (typeof window !== 'undefined') return remoteMutation('reconcileBankStatementCSV', [buildingId, rows]);

  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  let targetBuilding: Building | undefined;
  let targetSyndic: Syndic | undefined;
  for (const s of syndics) {
    const bld = s.buildings.find((b) => b.id === buildingId);
    if (bld) {
      targetBuilding = bld;
      targetSyndic = s;
      break;
    }
  }
  if (!targetBuilding) {
    throw new Error('Immeuble introuvable pour le rapprochement bancaire.');
  }

  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges).filter(
    (c) => c.buildingId === buildingId && c.status !== 'paid'
  );
  const existingProofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs).filter(
    (p) => p.buildingId === buildingId
  );
  const seenBankEventKeys = new Set<string>(
    existingProofs
      .map((p) => (p.referenceNumber || '').trim().toUpperCase())
      .filter(Boolean)
  );

  let matchedCount = 0;
  let unmatchedCount = 0;
  let totalReconciledMad = 0;
  const generatedQuittances: Quittance[] = [];

  for (const row of rows) {
    const rawAmt = Number(row.amount);
    // Reject non-positive (debit/zero/NaN) rows — never Math.abs() a bank debit into an income receipt
    if (!Number.isFinite(rawAmt) || rawAmt <= 0) {
      unmatchedCount += 1;
      continue;
    }
    const cleanAmt = Math.round(rawAmt * 100) / 100;
    if (cleanAmt <= 0) { unmatchedCount += 1; continue; }
    const upperLabel = (row.label || '').trim().toUpperCase();
    const cleanRef = (row.reference || '').trim().toUpperCase();
    const bankEventKey = cleanRef
      ? cleanRef
      : `CSV-${buildingId}-${(row.date || '').trim()}-${cleanAmt.toFixed(2)}-${upperLabel.replace(/[^A-Z0-9]/g, '_').slice(0, 48)}`;

    // Bank-event idempotency: never reconcile the same bank row twice across repeated imports or within the same file
    if (seenBankEventKeys.has(bankEventKey)) {
      unmatchedCount += 1;
      continue;
    }

    const tokenMatch = (label: string, value: string) => {
      const escaped = value.trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return escaped.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(label);
    };
    const eligible = charges.filter((c) => c.status !== 'paid' &&
      Math.round((c.amount - (c.paidAmount || 0)) * 100) === Math.round(cleanAmt * 100));
    const lots = eligible.filter((c) => tokenMatch(upperLabel,
      targetBuilding!.apartments.find((a) => a.id === c.apartmentId)?.number || ''));
    const names = lots.length ? lots : eligible.filter((c) => {
      const name = targetBuilding!.residents.find((r) => r.id === c.residentId)?.name || '';
      return name.trim().length >= 3 && tokenMatch(upperLabel, name);
    });
    const matchedCharge = names.length === 1 ? names[0] : undefined;

    if (matchedCharge) {
      seenBankEventKeys.add(bankEventKey);
      const apt = targetBuilding.apartments.find((a) => a.id === matchedCharge.apartmentId);
      const res = targetBuilding.residents.find((r) => r.id === matchedCharge.residentId);
      const submitted = await submitPaymentProof({
        chargeId: matchedCharge.id,
        buildingId,
        syndicId: targetSyndic?.id,
        residentId: matchedCharge.residentId,
        residentName: res?.name || 'Copropriétaire',
        apartmentId: matchedCharge.apartmentId,
        apartmentNumber: apt?.number || 'Lot',
        amount: cleanAmt,
        paymentMethod: 'virement',
        bankName: row.bankName || targetBuilding.bankName || 'Banque Copropriété',
        referenceNumber: bankEventKey,
        receiptNote: `Rapprochement CSV bancaire : ${row.label}`,
      });
      const approved = await reviewPaymentProof(submitted.id, 'approved');
      if (approved.quittance) generatedQuittances.push(approved.quittance);
      matchedCharge.status = 'paid';
      matchedCount += 1;
      totalReconciledMad = Math.round((totalReconciledMad + cleanAmt) * 100) / 100;
    } else {
      unmatchedCount += 1;
    }
  }

  return {
    matchedCount,
    unmatchedCount,
    totalReconciledMad,
    quittances: generatedQuittances,
  };
};

export const reviewPaymentProof = async (
  proofId: string,
  decision: 'approved' | 'rejected' | 'approve' | 'reject',
  rejectionReason?: string
): Promise<{ proof: PaymentProof; quittance?: Quittance; success: boolean }> => {
  const canonicalDecision = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : decision;
  if (typeof window !== 'undefined') return remoteMutation('reviewPaymentProof', [proofId, canonicalDecision, rejectionReason]);

  if (!['approved', 'approve', 'rejected', 'reject'].includes(decision)) throw new Error('Décision invalide.');
  const approved = decision === 'approved' || decision === 'approve';
  const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
  const proof = proofs.find((p) => p.id === proofId);
  if (!proof) throw new Error('Justificatif introuvable.');
  if (proof.status !== 'pending') {
    if ((proof.status === 'approved') !== approved) throw new Error('Ce justificatif a déjà été traité.');
    const existing = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances)
      .find((q) => q.paymentId === `proof:${proof.id}` || q.id === `quit-prf-${proof.id}`);
    if (!approved || existing) return { proof, success: true, quittance: existing };
    // A missing receipt can be rebuilt from its stable posted payment without posting again.
  }
  let quittance: Quittance | undefined;
  if (approved) {
    const charge = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges).find((c) => c.id === proof.chargeId);
    const syndic = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics)
      .find((s) => s.id === charge?.syndicId);
    const building = syndic?.buildings.find((b) => b.id === proof.buildingId);
    if (!charge || !syndic || !building || charge.buildingId !== building.id || charge.residentId !== proof.residentId ||
      (proof.syndicId && proof.syndicId !== syndic.id)) throw new Error('Justificatif non lié à cette charge.');
    const apartment = building.apartments.find((a) => a.id === charge.apartmentId);
    if (!apartment || (proof.apartmentId && proof.apartmentId !== apartment.id) || proof.apartmentNumber !== apartment.number) {
      throw new Error('Lot non lié au justificatif.');
    }
    quittance = await createQuittance({ paymentId: `proof:${proof.id}`, chargeId: charge.id,
      buildingId: building.id, buildingName: building.name, syndicId: syndic.id, syndicName: syndic.name,
      residentId: proof.residentId, residentName: building.residents.find((r) => r.id === proof.residentId)?.name || proof.residentName,
      apartmentId: apartment.id, apartmentNumber: apartment.number, amount: proof.amount,
      paymentDate: proof.submissionDate, paymentMethod: proof.paymentMethod, periodCovered: charge.period || '',
      bankName: proof.bankName, referenceNumber: proof.referenceNumber, addTransactionToLedger: true });
  }
  // Validation/posting must finish before the proof becomes approved.
  proof.status = approved ? 'approved' : 'rejected'; proof.reviewedAt = new Date().toISOString();
  if (!approved) proof.rejectionReason = rejectionReason;
  setLocalItem(STORAGE_KEYS.PROOFS, proofs);
  return { proof, quittance, success: true };

};

// ==========================================
// 7. QUITTANCES / OFFICIAL RECEIPTS (Audit Item 14 & 16)
// ==========================================

export const getQuittancesForBuilding = async (buildingId: string): Promise<Quittance[]> => {
  if (isLocalEngineEnabled) {
    const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
    return quittances.filter((q) => q.buildingId === buildingId && !q.voidedAt);
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, QUITTANCES_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Quittance));
};

export const getQuittancesForResident = async (residentId: string): Promise<Quittance[]> => {
  if (isLocalEngineEnabled) {
    const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
    return quittances.filter((q) => q.residentId === residentId && !q.voidedAt);
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, QUITTANCES_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Quittance));
};

function paidAmount(charge: Charge): number { return charge.paidAmount ?? (charge.status === 'paid' ? charge.amount : 0); }
function outstanding(charge: Charge): number { return Math.max(0, centimes(charge.amount) - centimes(paidAmount(charge))); }
function postIncome(building: Building, amount: number, paymentId: string, details: PostIncomeCommand['details']) {
  const split = splitChargeReserveAndOperating(amount, getBuildingReserveRate(building));
  building.financials.transactions ||= [];
  for (const [fundType, value] of [['courant', split.chargesCourantesAmount], ['reserve', split.reserveFundAmount]] as const) {
    if (value === 0) continue;
    building.financials.transactions.unshift({ ...details, reserveRateApplied: split.reservePercentageUsed,
      id: `trx-${paymentId}-${fundType}`, paymentId,
      date: details.date || new Date().toISOString(), description: details.description || 'Encaissement',
      amount: value, type: 'income', category: 'fees', fundType });
  }
  building.financials.balance = Math.round(((building.financials.balance ?? 0) + split.chargesCourantesAmount) * 100) / 100;
  building.financials.reserveFundBalance = Math.round(((building.financials.reserveFundBalance ?? 0) + split.reserveFundAmount) * 100) / 100;
  return split;
}

function receiptScope(receipt: Quittance, building: Building, charge: Charge) {
  return receipt.buildingId === building.id && receipt.syndicId === building.syndicId && receipt.chargeId === charge.id;
}

function assertReceiptCapacity(receipts: Quittance[], building: Building, charge: Charge, additional = 0) {
  const receipted = receipts.filter(q => !q.voidedAt && receiptScope(q, building, charge))
    .reduce((sum, q) => sum + centimes(q.amount), 0);
  const journal = building.financials.transactions;
  const reversed = new Set(journal.map(row => row.reversalOf).filter(Boolean));
  const payments = new Map<string, Transaction[]>();
  for (const row of journal) if (row.type === 'income' && row.paymentId && !reversed.has(row.paymentId)) {
    const rows = payments.get(row.paymentId) || []; rows.push(row); payments.set(row.paymentId, rows);
  }
  const verified = [...payments.values()].reduce((sum, rows) => sum + (allocationAmount(rows, charge.id) ?? 0), 0);
  if (receipted + additional > Math.min(centimes(paidAmount(charge)), verified)) {
    throw new Error('Montant déjà quittancé : rapprochez les reçus et les paiements enregistrés.');
  }
}

function allocationAmount(rows: Transaction[], chargeId: string): number | undefined {
  if (!rows.length || rows.some(row => row.type !== 'income' || !Number.isFinite(row.amount) || row.amount < 0)) return undefined;
  const total = rows.reduce((sum, row) => sum + centimes(row.amount), 0);
  if (rows.every(row => row.sourceChargeId === chargeId)) return total;
  const allocations = rows[0].paymentAllocations;
  if (!allocations || rows.some(row => JSON.stringify(row.paymentAllocations) !== JSON.stringify(allocations)) ||
      new Set(allocations.map(a => a.chargeId)).size !== allocations.length ||
      allocations.reduce((sum, a) => sum + centimes(a.amount), 0) !== total) return undefined;
  const allocation = allocations.find(a => a.chargeId === chargeId);
  return allocation ? centimes(allocation.amount) : undefined;
}

function numberedReceipt(core: Omit<Quittance, 'id' | 'quittanceNumber' | 'createdAt'>,
  split: NonNullable<ReturnType<typeof getRecordedReserveSplit>>, receipts: Quittance[], syndics: Syndic[]): Quittance {
  // Include the durable journal snapshots: deleting a receipt document must never free its number.
  const prefix = `QUIT-${new Date().getFullYear()}-`;
  const history = [...receipts, ...syndics.flatMap(s => (s.buildings || []).flatMap(b =>
    (b.financials?.transactions || []).flatMap(row => row.receiptSnapshots || [])))];
  const max = history.filter(q => q.syndicId === core.syndicId && typeof q.quittanceNumber === 'string' && q.quittanceNumber.startsWith(prefix))
    .reduce((n, q) => {
      const sequence = Number(q.quittanceNumber.slice(prefix.length));
      return Number.isSafeInteger(sequence) && sequence >= 0 ? Math.max(n, sequence) : n;
    }, 0);
  if (!Number.isSafeInteger(max + 1)) throw new Error('Séquence de quittance invalide : rapprochement nécessaire.');
  return { ...core, reserveRateApplied: split.reservePercentageUsed, reserveFundAmount: split.reserveFundAmount,
    chargesCourantesAmount: split.chargesCourantesAmount,
    id: `quit-${[core.buildingId, core.paymentId!, core.chargeId].map(encodeURIComponent).join(':')}`,
    quittanceNumber: `${prefix}${String(max + 1).padStart(5, '0')}`, createdAt: new Date().toISOString() };
}

export const createQuittance = async (
  input: CreateQuittanceCommand
): Promise<Quittance> => {
  if (typeof window !== 'undefined') return remoteMutation('createQuittance', [input]);

  if (input.addTransactionToLedger !== undefined && typeof input.addTransactionToLedger !== 'boolean') {
    throw new Error('Mode de comptabilisation invalide.');
  }
  if (input.paymentId !== undefined && (typeof input.paymentId !== 'string' || !input.paymentId.trim() || input.paymentId.length > 3000)) {
    throw new Error('Référence de paiement invalide.');
  }
  const { addTransactionToLedger = true, ...core } = input;
  const amount = centimes(core.amount);
  if (amount <= 0) throw new Error('Montant du paiement invalide.');
  const receipts = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  const building = syndics.find((s) => s.id === core.syndicId)?.buildings.find((b) => b.id === core.buildingId);
  if (!building) throw new Error('Immeuble hors du cabinet.');
  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
  const matches = charges.filter((c) => c.buildingId === core.buildingId && c.syndicId === core.syndicId &&
    c.residentId === core.residentId && (!core.apartmentId || c.apartmentId === core.apartmentId) &&
    (core.chargeId ? c.id === core.chargeId : normalizeBillingPeriodKey(c.period || '') === normalizeBillingPeriodKey(core.periodCovered)));
  const charge = matches.length === 1 ? matches[0] : undefined;
  if (!charge) throw new Error('Sélectionnez une charge unique liée à ce paiement.');
  const lot = building.apartments.find((a) => a.id === charge.apartmentId);
  if (!building.residents.some((r) => r.id === core.residentId) || !lot || lot.number !== core.apartmentNumber) {
    throw new Error('Copropriétaire ou lot non lié à cette charge.');
  }
  core.chargeId = charge.id; core.amount = amount / 100;
  const paymentId = addTransactionToLedger ? (core.paymentId || (core.referenceNumber?.trim() ?
    `manual:${core.buildingId}:${charge.id}:${core.paymentMethod}:${core.referenceNumber.trim()}` : undefined)) : core.paymentId;
  if (addTransactionToLedger && !paymentId) throw new Error('Référence unique de paiement obligatoire.');
  if (paymentId && building.financials.transactions.some((t: any) => t.reversalOf === paymentId)) throw new Error("Paiement contrepassé : enregistrez un nouveau règlement.");
  const scoped = receipts.filter(q => !q.voidedAt && receiptScope(q, building, charge));
  const candidates = scoped.filter(q => paymentId ? q.paymentId === paymentId : centimes(q.amount) === amount);
  if (candidates.length > 1) throw new Error('Plusieurs reçus historiques : sélectionnez le reçu original.');
  const existing = candidates[0];
  if (existing) {
    if (existing.residentId !== core.residentId || centimes(existing.amount) !== amount || existing.paymentMethod !== core.paymentMethod) {
      throw new Error('Référence de paiement déjà utilisée avec des données différentes.');
    }
    if (existing.paymentId && building.financials.transactions.some(t => t.reversalOf === existing.paymentId)) {
      throw new Error('Paiement contrepassé : reçu annulé.');
    }
    return existing;
  }
  const posted = building.financials.transactions.filter(t => paymentId && t.paymentId === paymentId);
  const snapshots = building.financials.transactions.filter(t => t.type === 'income' && (!paymentId || t.paymentId === paymentId))
    .flatMap(t => t.receiptSnapshots || []).filter(q => receiptScope(q, building, charge) && centimes(q.amount) === amount);
  const saved = [...new Map(snapshots.map(q => [q.id, q])).values()];
  if (saved.length > 1) throw new Error('Sélectionnez la référence du paiement enregistré.');
  const original = saved[0];
  if (original) {
    if (scoped.some(q => !q.paymentId) || receipts.some(q => q.id === original.id && q.voidedAt)) {
      throw new Error('Reçu historique non lié ou annulé : rapprochement nécessaire.');
    }
    const rows = building.financials.transactions.filter(t => t.paymentId === original.paymentId);
    if (original.voidedAt || original.residentId !== core.residentId || original.paymentMethod !== core.paymentMethod ||
        building.financials.transactions.some(t => t.reversalOf === original.paymentId) || allocationAmount(rows, charge.id) !== amount) {
      throw new Error('Paiement ou ventilation du reçu non valide.');
    }
    assertReceiptCapacity(receipts, building, charge, amount);
    setLocalItem(STORAGE_KEYS.QUITTANCES, [original, ...receipts]);
    return original;
  }
  if (!addTransactionToLedger || posted.length) {
    throw new Error('Aucun paiement suffisant avec reçu canonique enregistré : rapprochement nécessaire.');
  }
  if (core.quittanceNumber) throw new Error('La numérotation des quittances est réservée au serveur.');
  assertReceiptCapacity(receipts, building, charge);
  let split: ReturnType<typeof getRecordedReserveSplit>;
  const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
  if (addTransactionToLedger && !posted.length) {
    if (amount > outstanding(charge)) throw new Error('Le paiement dépasse le solde restant de la charge.');
    const linked = invoices.filter((i) => i.chargeIds.includes(charge.id) && i.status !== 'cancelled');
    if (linked.length > 1) throw new Error('Plusieurs factures couvrent cette charge : rapprochement nécessaire.');
    const invoice = linked[0];
    if (invoice && (invoice.syndicId !== core.syndicId || invoice.buildingId !== core.buildingId ||
      invoice.residentId !== core.residentId || amount > centimes(invoice.totalAmount) - centimes(invoice.paidAmount ?? 0))) {
      throw new Error('Facture liée incompatible avec ce paiement.');
    }
    charge.paidAmount = (centimes(paidAmount(charge)) + amount) / 100;
    charge.status = outstanding(charge) === 0 ? 'paid' : 'unpaid'; charge.paidAt = core.paymentDate; charge.paymentMethod = core.paymentMethod;
    if (invoice) {
      invoice.paidAmount = (centimes(invoice.paidAmount ?? 0) + amount) / 100;
      invoice.status = centimes(invoice.paidAmount) === centimes(invoice.totalAmount) ? 'paid' : 'unpaid';
      invoice.paymentIds = [...(invoice.paymentIds || []), paymentId!]; charge.invoiceId = invoice.id;
    }
    split = postIncome(building, core.amount, paymentId!, { sourceChargeId: charge.id, sourceInvoiceId: invoice?.id,
      date: core.paymentDate, paymentMethod: core.paymentMethod, reference: core.referenceNumber,
      description: `Paiement lot ${lot.number}`, documentType: 'quittance' });
  }
  if (allocationAmount(building.financials.transactions.filter(t => t.paymentId === paymentId), charge.id) !== amount || !split) {
    throw new Error('Encaissement non confirmé.');
  }
  assertReceiptCapacity(receipts, building, charge, amount);
  const receipt = numberedReceipt({ ...core, paymentId }, split, receipts, syndics);
  building.financials.transactions.find(t => t.paymentId === paymentId)!.receiptSnapshots = [receipt];
  setLocalItem(STORAGE_KEYS.CHARGES, charges); setLocalItem(STORAGE_KEYS.INVOICES, invoices);
  setLocalItem(STORAGE_KEYS.SYNDICS, syndics); setLocalItem(STORAGE_KEYS.QUITTANCES, [receipt, ...receipts]);
  return receipt;
};

export const generateQuittanceForCharge = async (
  chargeOrId: Charge | string,
  buildingIdOrPaymentMethod: string = 'virement',
  referenceNumber?: string,
  bankName?: string
): Promise<Quittance> => {
  if (typeof window !== 'undefined') return remoteMutation('generateQuittanceForCharge', [chargeOrId, buildingIdOrPaymentMethod, referenceNumber, bankName]);

  const chargeId = typeof chargeOrId === 'string' ? chargeOrId : chargeOrId.id;
  const charge = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges).find(c => c.id === chargeId);
  if (!charge) throw new Error('Charge introuvable');
  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  const building = syndics.find(s => s.id === charge.syndicId)?.buildings.find(b => b.id === charge.buildingId);
  if (!building) throw new Error('Immeuble introuvable');
  const receipts = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
  const existing = receipts.find(q => !q.voidedAt && receiptScope(q, building, charge));
  const saved = building.financials.transactions.filter(t => t.type === 'income' &&
    !building.financials.transactions.some(reversal => reversal.reversalOf === t.paymentId))
    .flatMap(t => t.receiptSnapshots || []).find(q => receiptScope(q, building, charge));
  const original = existing || saved;
  if (!original) throw new Error('Reçu original introuvable : rapprochez le paiement avant toute émission.');
  return createQuittance({ ...original, addTransactionToLedger: false });
};

// ==========================================
// 8. ASSEMBLÉES GÉNÉRALES (AG) & WEIGHTED VOTING (Audit Item 20)
// ==========================================


export const getAssembleesGeneralesForBuilding = async (
  buildingId: string
): Promise<AssembleeGenerale[]> => {
  if (isLocalEngineEnabled) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    return agList.filter((ag) => ag.buildingId === buildingId);
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, AG_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as AssembleeGenerale));
};

export const saveAssembleeGenerale = async (
  ag: AssembleeGenerale
): Promise<AssembleeGenerale> => {
  if (typeof window !== 'undefined') return remoteMutation('saveAssembleeGenerale', [ag]);

  if (isLocalEngineEnabled) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const index = agList.findIndex((item) => item.id === ag.id);
    if (index >= 0) {
      agList[index] = ag;
    } else {
      agList.unshift(ag);
    }
    setLocalItem(STORAGE_KEYS.AG, agList);
    return ag;
  }

  const { doc, db, setDoc } = await import('./legacyClient');
  const docRef = doc(db, AG_COL, ag.id);
  await setDoc(docRef, ag, { merge: true });
  return ag;
};

export const createAssembleeGenerale = async (
  agInput: Omit<AssembleeGenerale, 'id'> & { id?: string }
): Promise<AssembleeGenerale> => {
  if (typeof window !== 'undefined') return remoteMutation('createAssembleeGenerale', [agInput]);

  const ag: AssembleeGenerale = {
    ...agInput,
    id: agInput.id || `ag-${crypto.randomUUID()}`,
    quorumRequired: agInput.quorumRequired ?? legacyQuorum(agInput.totalTantiemes || 1000),
    isVotingOpen:
      agInput.isVotingOpen ??
      (agInput.status !== 'completed' && agInput.status !== 'closed'),
  };
  return saveAssembleeGenerale(ag);
};

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

export const castResidentAGVote = async (
  agId: string,
  resolutionId: string,
  residentIdOrPayload: string | CastAGVoteInput,
  residentNameArg?: string,
  apartmentIdArg?: string,
  apartmentNumberArg?: string,
  _suppliedTantiemes?: number,
  choiceArg?: 'for' | 'against' | 'abstain',
  commentArg?: string
): Promise<AssembleeGenerale> => {
  const isObjectCall = typeof residentIdOrPayload === 'object' && residentIdOrPayload !== null;
  const residentId: string = isObjectCall
    ? residentIdOrPayload.residentId
    : String(residentIdOrPayload);
  const residentName = isObjectCall
    ? residentIdOrPayload.residentName
    : residentNameArg || 'Copropriétaire';
  const apartmentId = isObjectCall ? residentIdOrPayload.apartmentId || '' : apartmentIdArg || '';
  const apartmentNumber = isObjectCall
    ? residentIdOrPayload.apartmentNumber
    : apartmentNumberArg || '';
  const choice: 'for' | 'against' | 'abstain' = isObjectCall
    ? residentIdOrPayload.choice || residentIdOrPayload.vote || 'for'
    : choiceArg || 'for';
  const comment = isObjectCall ? residentIdOrPayload.comment : commentArg;

  if (typeof window !== 'undefined') {
    const response = await fetch('/api/ag/vote', { method: 'POST', headers: getAuthenticatedRequestHeaders(),
      body: JSON.stringify({ agId, resolutionId, residentId, apartmentId, choice, comment }) });
    const data = await response.json();
    if (!response.ok || !data.ag) throw new Error(data.error || 'Le vote a échoué.');
    const list = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const index = list.findIndex((a) => a.id === agId);
    if (index >= 0) list[index] = data.ag; else list.push(data.ag);
    engineStorage.setItem(STORAGE_KEYS.AG, JSON.stringify(list));
    notifyStateUpdated(STORAGE_KEYS.AG);
    return data.ag;
  }
  const list = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
  const index = list.findIndex((a) => a.id === agId);
  const building = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics)
    .flatMap((x) => x.buildings).find((b) => b.id === list[index]?.buildingId);
  if (index < 0 || !building) throw new Error('Assemblée introuvable.');
  if (apartmentNumber && !building.apartments.some((a) => a.ownerId === residentId && a.number === apartmentNumber)) {
    throw new Error('Lot non lié au copropriétaire.');
  }
  const result = applyResidentVote(list[index], building, residentId, resolutionId, choice, apartmentId || undefined, comment);
  list[index] = result; setLocalItem(STORAGE_KEYS.AG, list); return result;

};

export const toggleAGVoting = async (agId: ToggleAGVotingCommand['agId'], isOpen: ToggleAGVotingCommand['isOpen']): Promise<AssembleeGenerale> => {
  if (typeof window !== 'undefined') return remoteMutation('toggleAGVoting', [agId, isOpen]);

  if (isLocalEngineEnabled) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const ag = agList.find((item) => item.id === agId);
    if (!ag) throw new Error('Assemblée Générale introuvable');
    ag.isVotingOpen = isOpen;
    setLocalItem(STORAGE_KEYS.AG, agList);
    return ag;
  }
  const { doc, db, updateDoc } = await import('./legacyClient');
  const docRef = doc(db, AG_COL, agId);
  await updateDoc(docRef, { isVotingOpen: isOpen });
  return {} as any;
};

/**
 * Phase 4.1: Generates prorated calls for funds (Appels de fonds Loi 18-00 Art. 24 / 37)
 * across all building lots using exact centime allocation when an AG resolution with a budget is adopted.
 */
export const generateChargesFromAGResolution = async (
  agId: string,
  resolutionId: string
): Promise<{ createdCharges: Charge[]; totalAllocatedMad: number }> => {
  if (typeof window !== 'undefined') return remoteMutation('generateChargesFromAGResolution', [agId, resolutionId]);

  const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
  const ag = agList.find((item) => item.id === agId);
  if (!ag) throw new Error('Assemblée Générale introuvable');

  const res = ag.resolutions.find((r) => r.id === resolutionId);
  if (!res) throw new Error('Résolution introuvable');
  if (res.status !== 'approved') {
    throw new Error('Seules les résolutions adoptées peuvent générer des appels de fonds.');
  }
  const budgetMad = Number(res.budgetAmount) || 0;
  if (budgetMad <= 0) {
    throw new Error('Aucun budget (MAD) n’est associé à cette résolution.');
  }

  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  let targetBuilding: Building | undefined;
  let targetSyndicId = ag.syndicId;
  for (const s of syndics) {
    const bld = s.buildings.find((b) => b.id === ag.buildingId);
    if (bld) {
      targetBuilding = bld;
      targetSyndicId = s.id;
      break;
    }
  }
  if (!targetBuilding || targetBuilding.apartments.length === 0) {
    throw new Error('Aucun lot configuré dans cet immeuble pour répartir le budget voté.');
  }

  const lots = targetBuilding.apartments.filter((a: any) => !a.archivedAt).map((a) => ({
    id: a.id,
    tantiemes: a.tantiemes || 100,
  }));
  const allocations = allocateBudgetInCentimes(
    budgetMad,
    lots,
    targetBuilding.totalTantiemes || 1000
  );

  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
  const nowIso = new Date().toISOString();
  const dueDate = new Date(Date.now() + 30 * 86400000).toISOString();
  const createdCharges: Charge[] = [];
  let totalAllocatedMad = 0;

  for (const apt of targetBuilding.apartments.filter((a: any) => !a.archivedAt)) {
    const shareMad = allocations.get(apt.id) || 0;
    if (shareMad <= 0) continue;
    const residentId =
      apt.ownerId ||
      apt.tenantId ||
      targetBuilding.residents.find((r) => r.apartmentId === apt.id)?.id ||
      `owner-${apt.id}`;
    const deterministicId = `chg-ag-${ag.id}-${res.id}-${apt.id}`;
    if (charges.some((c) => c.id === deterministicId)) continue;

    const newCharge: Charge = {
      id: deterministicId,
      syndicId: targetSyndicId,
      buildingId: targetBuilding.id,
      apartmentId: apt.id,
      residentId,
      amount: shareMad,
      paidAmount: 0,
      dueDate,
      status: 'unpaid',
      period: `AG ${new Date(ag.date).getFullYear()} - Rés. #${res.number}`,
      description: `Appel de fonds AG (${ag.title}) — Résolution #${res.number}: ${res.title}`,
      chargeType: 'exceptionnelle_travaux',
      tantiemesApplied: apt.tantiemes || 100,
      createdAt: nowIso,
    };
    charges.unshift(newCharge);
    createdCharges.push(newCharge);
    totalAllocatedMad = Math.round((totalAllocatedMad + shareMad) * 100) / 100;
  }

  setLocalItem(STORAGE_KEYS.CHARGES, charges);
  res.chargesGeneratedAt = nowIso;
  res.generatedChargesCount = createdCharges.length;
  setLocalItem(STORAGE_KEYS.AG, agList);

  return { createdCharges, totalAllocatedMad };
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
  }
): Promise<AssembleeGenerale> => {
  if (typeof window !== 'undefined') return remoteMutation('recordAGVote', [agId, resolutionId, voteType, tantiemesWeight, voterInfo]);

  if (voterInfo) {
    return castResidentAGVote(
      agId,
      resolutionId,
      voterInfo.residentId,
      voterInfo.residentName,
      voterInfo.apartmentId,
      voterInfo.apartmentNumber,
      tantiemesWeight,
      voteType
    );
  }

  if (isLocalEngineEnabled) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const ag = agList.find((item) => item.id === agId);
    if (!ag) throw new Error('AG not found');
    if (ag.status === 'completed' || ag.isVotingOpen === false) {
      throw new Error('Le scrutin est clôturé pour cette Assemblée Générale.');
    }

    const res = ag.resolutions.find((r) => r.id === resolutionId);
    if (res) {
      if (voteType === 'for') res.votesFor += tantiemesWeight;
      else if (voteType === 'against') res.votesAgainst += tantiemesWeight;
      else res.votesAbstain += tantiemesWeight;

      res.status = evaluateResolutionStatus(res, ag);
    }

    setLocalItem(STORAGE_KEYS.AG, agList);
    return ag;
  }

  return {} as any;
};

export const updateAGAttendee = async (
  agId: string,
  residentId: string,
  status: 'present' | 'represented' | 'absent',
  proxyHolderName?: string
): Promise<AssembleeGenerale> => {
  if (typeof window !== 'undefined') return remoteMutation('updateAGAttendee', [agId, residentId, status, proxyHolderName]);

  if (isLocalEngineEnabled) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const ag = agList.find((item) => item.id === agId);
    if (!ag) throw new Error('AG not found');

    const att = ag.attendees.find((a) => a.residentId === residentId);
    if (att) {
      att.status = status;
      if (proxyHolderName) att.proxyHolderName = proxyHolderName;
    }

    const presentTantiemes = ag.attendees
      .filter((a) => a.status === 'present' || a.status === 'represented')
      .reduce((sum, a) => sum + (a.tantiemes || 0), 0);

    ag.presentTantiemes = presentTantiemes;
    ag.quorumReached = presentTantiemes >= ag.quorumRequired;

    // Re-evaluate all resolution statuses when quorum changes
    ag.resolutions.forEach((res) => {
      res.status = evaluateResolutionStatus(res, ag);
    });

    setLocalItem(STORAGE_KEYS.AG, agList);
    return ag;
  }

  return {} as any;
};

// ==========================================
// 9. PRESTATAIRES (SERVICE PROVIDERS) & HASHED CREDENTIALS
// ==========================================

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

const PRESTATAIRE_ACCOUNTS_KEY = STORAGE_KEYS.PRESTATAIRE_ACCOUNTS;

function savePrestataireCredentialAccount(
  prestataire: Prestataire,
  rawPassword: string
): PrestataireAccountRecord {
  const accounts = getLocalItem<PrestataireAccountRecord[]>(PRESTATAIRE_ACCOUNTS_KEY, []);
  const emailNorm = prestataire.email.trim().toLowerCase();
  const passwordHash = hashPasswordSync(rawPassword, emailNorm);
  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  let resolvedSyndicId = prestataire.syndicId;
  let buildingName = 'Résidence';
  for (const s of syndics) {
    const bld = s.buildings.find((b) => b.id === prestataire.buildingId);
    if (bld) {
      buildingName = bld.name;
      resolvedSyndicId = s.id;
      break;
    }
  }
  if (!resolvedSyndicId && syndics.length > 0) {
    resolvedSyndicId = syndics[0].id;
  }

  const record: PrestataireAccountRecord = {
    prestataireId: prestataire.id,
    email: prestataire.email.trim(),
    passwordHash,
    name: prestataire.name,
    contactPerson: prestataire.contactPerson,
    category: prestataire.category,
    syndicId: resolvedSyndicId || prestataire.syndicId,
    buildingId: prestataire.buildingId,
    createdAt: prestataire.credentialsCreatedAt || new Date().toISOString(),
    mustChangePassword: prestataire.mustChangePassword ?? true,
    invitationExpiresAt: prestataire.invitationExpiresAt,
  };
  const existingIdx = accounts.findIndex(
    (a) =>
      a.prestataireId === prestataire.id ||
      (prestataire.email && a.email.toLowerCase() === emailNorm)
  );
  if (existingIdx >= 0) {
    accounts[existingIdx] = record;
  } else {
    accounts.push(record);
  }
  setLocalItem(PRESTATAIRE_ACCOUNTS_KEY, accounts);

  // Synchronize REGISTERED_USERS so all local registries carry the complete Provider UserProfile
  try {
    const regUsers = getLocalItem<any[]>(STORAGE_KEYS.REGISTERED_USERS, []);
    const canonicalUid = `user-prest-${prestataire.id}`;
    const canonicalProfile = {
      uid: canonicalUid,
      email: emailNorm,
      displayName: prestataire.name,
      role: 'provider' as const,
      syndicId: record.syndicId,
      buildingId: prestataire.buildingId,
      buildingName,
      prestataireId: prestataire.id,
      prestataireCategory: prestataire.category,
      providerCategory: prestataire.category,
      phone: prestataire.phone?.trim() || undefined,
      mustChangePassword: prestataire.mustChangePassword ?? true,
    };
    const regIdx = regUsers.findIndex(
      (u) =>
        u?.email?.toLowerCase() === emailNorm ||
        u?.uid === canonicalUid ||
        u?.uid === `prov-${prestataire.id}` ||
        u?.profile?.prestataireId === prestataire.id
    );
    const regEntry = {
      uid: canonicalUid,
      email: emailNorm,
      passwordHash,
      profile: canonicalProfile,
      createdAt: record.createdAt,
    };
    if (regIdx >= 0) {
      regUsers[regIdx] = regEntry;
    } else {
      regUsers.push(regEntry);
    }
    setLocalItem(STORAGE_KEYS.REGISTERED_USERS, regUsers);
  } catch {
    // ignore
  }

  return record;
}

export const getPrestatairesForBuilding = async (buildingId: string): Promise<Prestataire[]> => { await syncAllSharedStateFromServer(); return getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, []).filter((p: any) => p.buildingId === buildingId && !p.archivedAt).map(p=>({ ...p,...ephemeralInvites.get(p.id) })); };

export const savePrestataire = async (
  prestataire: Prestataire,
  generateCredentials?: boolean
): Promise<Prestataire> => {
  if (typeof window !== 'undefined') return remoteMutation('savePrestataire', [prestataire, generateCredentials]);

  if (isLocalEngineEnabled) {
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
    const index = list.findIndex((p) => p.id === prestataire.id);
    const prev = index >= 0 ? list[index] : undefined;

    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    let resolvedSyndicId = prestataire.syndicId || prev?.syndicId;
    if (!resolvedSyndicId) {
      const ownerSyndic = syndics.find((s) =>
        s.buildings.some((b) => b.id === prestataire.buildingId)
      );
      resolvedSyndicId = ownerSyndic?.id || syndics[0]?.id || '';
    }

    let finalPrestataire: Prestataire = {
      ...prev,
      ...prestataire,
      syndicId: resolvedSyndicId,
    };
    let ephemeralPassword: string | undefined;

    if (generateCredentials && finalPrestataire.email) {
      const nowIso = new Date().toISOString();
      const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      ephemeralPassword =
        finalPrestataire.generatedPassword || generateTempPassword(finalPrestataire.name);
      const prevLog = Array.isArray(finalPrestataire.credentialsAuditLog)
        ? finalPrestataire.credentialsAuditLog
        : [];
      const actionType: CredentialAuditEntry['action'] = prev?.hasAccount
        ? 'regenerated'
        : 'generated';
      finalPrestataire = {
        ...finalPrestataire,
        hasAccount: true,
        invitationStatus: 'pending',
        invitationToken: ephemeralPassword,
        invitationCode: ephemeralPassword,
        invitationExpiresAt: finalPrestataire.invitationExpiresAt || inviteExpiresAt,
        credentialsCreatedAt: nowIso,
        credentialsAuditLog: [
          { action: actionType, timestamp: nowIso },
          ...prevLog,
        ].slice(0, 20),
        mustChangePassword: finalPrestataire.mustChangePassword ?? true,
      };
      delete (finalPrestataire as any).generatedPassword;
      savePrestataireCredentialAccount(finalPrestataire, ephemeralPassword);
    } else if (finalPrestataire.hasAccount && finalPrestataire.generatedPassword && finalPrestataire.email) {
      ephemeralPassword = finalPrestataire.generatedPassword;
      finalPrestataire.invitationToken = finalPrestataire.invitationToken || ephemeralPassword;
      finalPrestataire.invitationCode = finalPrestataire.invitationCode || ephemeralPassword;
      finalPrestataire.invitationExpiresAt =
        finalPrestataire.invitationExpiresAt || new Date(Date.now() + 7 * 86400000).toISOString();
      delete (finalPrestataire as any).generatedPassword;
      savePrestataireCredentialAccount(finalPrestataire, ephemeralPassword);
    } else if (finalPrestataire.hasAccount && finalPrestataire.email) {
      const activeTempPass =
        finalPrestataire.mustChangePassword !== false
          ? finalPrestataire.invitationToken || finalPrestataire.invitationCode
          : undefined;
      if (activeTempPass) {
        savePrestataireCredentialAccount(finalPrestataire, activeTempPass);
      } else {
        const accounts = getLocalItem<PrestataireAccountRecord[]>(PRESTATAIRE_ACCOUNTS_KEY, []);
        const accIdx = accounts.findIndex((a) => a.prestataireId === finalPrestataire.id);
        if (accIdx >= 0) {
          accounts[accIdx] = {
            ...accounts[accIdx],
            email: finalPrestataire.email.trim(),
            name: finalPrestataire.name,
            contactPerson: finalPrestataire.contactPerson,
            category: finalPrestataire.category,
            syndicId: finalPrestataire.syndicId,
            buildingId: finalPrestataire.buildingId,
            invitationExpiresAt: finalPrestataire.invitationExpiresAt,
          };
          setLocalItem(PRESTATAIRE_ACCOUNTS_KEY, accounts);
        }
      }
    }

    if (index >= 0) {
      list[index] = finalPrestataire;
    } else {
      list.unshift(finalPrestataire);
    }
    setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);
    if (!isMock) {
      const cleanPrest = JSON.parse(JSON.stringify(finalPrestataire));
      const { setDoc, doc, db } = await import('./legacyClient');
      void setDoc(doc(db, PRESTATAIRES_COL, finalPrestataire.id), cleanPrest, {
        merge: true,
      }).catch(() => {});
    }
    return {
      ...finalPrestataire,
      ...(ephemeralPassword ? { generatedPassword: ephemeralPassword } : {}),
    };
  }

  const { doc, db, setDoc } = await import('./legacyClient');
  const docRef = doc(db, PRESTATAIRES_COL, prestataire.id);
  await setDoc(docRef, prestataire, { merge: true });
  return prestataire;
};

export const regeneratePrestataireCredentials = async (
  prestataireId: string
): Promise<Prestataire> => {
  if (typeof window !== 'undefined') return remoteMutation('regeneratePrestataireCredentials', [prestataireId]);

  if (isLocalEngineEnabled) {
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
    const idx = list.findIndex((p) => p.id === prestataireId);
    if (idx >= 0) {
      const prest = list[idx];
      const nowIso = new Date().toISOString();
      const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
      const fallbackEmail =
        prest.email?.trim() ||
        `contact@${
          prest.name
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .slice(0, 12) || 'prestataire'
        }.ma`;
      const newPassword = generateTempPassword(prest.name);
      const prevLog = Array.isArray(prest.credentialsAuditLog) ? prest.credentialsAuditLog : [];
      const actionType: CredentialAuditEntry['action'] = prest.hasAccount
        ? 'regenerated'
        : 'generated';
      const updated: Prestataire = {
        ...prest,
        email: fallbackEmail,
        hasAccount: true,
        invitationStatus: 'pending',
        invitationToken: newPassword,
        invitationCode: newPassword,
        invitationExpiresAt: inviteExpiresAt,
        credentialsCreatedAt: nowIso,
        credentialsAuditLog: [
          { action: actionType, timestamp: nowIso },
          ...prevLog,
        ].slice(0, 20),
        mustChangePassword: true,
      };
      delete (updated as any).generatedPassword;
      list[idx] = updated;
      savePrestataireCredentialAccount(updated, newPassword);
      setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);
      if (!isMock) {
        const cleanPrest = JSON.parse(JSON.stringify(updated));
        const { setDoc, doc, db } = await import('./legacyClient');
        void setDoc(doc(db, PRESTATAIRES_COL, updated.id), cleanPrest, { merge: true }).catch(
          () => {}
        );
      }
      return { ...updated, generatedPassword: newPassword };
    }
  }
  throw new Error('Prestataire introuvable');
};

export const recordPrestataireCredentialShare = async (
  prestataireId: string,
  method: 'pdf' | 'copy'
): Promise<Prestataire | null> => {
  if (typeof window !== 'undefined') return remoteMutation('recordPrestataireCredentialShare', [prestataireId, method]);

  const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
  const idx = list.findIndex((p) => p.id === prestataireId);
  if (idx >= 0) {
    const prest = list[idx];
    const nowIso = new Date().toISOString();
    const prevLog = Array.isArray(prest.credentialsAuditLog) ? prest.credentialsAuditLog : [];
    const actionType: CredentialAuditEntry['action'] =
      method === 'pdf' ? 'shared_pdf' : 'shared_copy';
    const updated: Prestataire = {
      ...prest,
      credentialsSharedAt: nowIso,
      credentialsLastSharedMethod: method,
      credentialsAuditLog: [
        { action: actionType, timestamp: nowIso },
        ...prevLog,
      ].slice(0, 20),
    };
    list[idx] = updated;
    setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);
    return updated;
  }
  return null;
};

export const deletePrestataire = async (prestataireId: string): Promise<boolean> => {
  if (typeof window !== 'undefined') return remoteMutation('deletePrestataire', [prestataireId]);

  if (isLocalEngineEnabled) {
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
    const filtered = list.filter((p) => p.id !== prestataireId);
    setLocalItem(STORAGE_KEYS.PRESTATAIRES, filtered, prestataireId);

    const accounts = getLocalItem<PrestataireAccountRecord[]>(PRESTATAIRE_ACCOUNTS_KEY, []);
    setLocalItem(
      PRESTATAIRE_ACCOUNTS_KEY,
      accounts.filter((a) => a.prestataireId !== prestataireId),
      prestataireId
    );
    return true;
  }

  const { deleteDoc, doc, db } = await import('./legacyClient');
  await deleteDoc(doc(db, PRESTATAIRES_COL, prestataireId));
  return true;
};

export const addPrestataireReview = async (
  prestataireId: string,
  review: Omit<PrestataireReview, 'id' | 'date'>
): Promise<Prestataire | null> => {
  if (typeof window !== 'undefined') return remoteMutation('addPrestataireReview', [prestataireId, review]);

  const newRev: PrestataireReview = {
    id: `rev-${crypto.randomUUID()}`,
    date: new Date().toISOString().split('T')[0],
    ...review,
  };

  if (isLocalEngineEnabled) {
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
    const prest = list.find((p) => p.id === prestataireId);
    if (prest) {
      prest.reviews = prest.reviews || [];
      prest.reviews.unshift(newRev);
      prest.reviewsCount = prest.reviews.length;
      const total = prest.reviews.reduce((sum, r) => sum + r.rating, 0);
      prest.rating = Math.round((total / prest.reviews.length) * 10) / 10;
      setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);
      return prest;
    }
    return null;
  }

  return null;
};

// ==========================================
// 10. FINANCIAL TRANSACTIONS & INVOICES (Audit Items 04, 15, 25)
// ==========================================

export const addTransaction = async (buildingId: string, transaction: Omit<Transaction, 'id'>) => {
  if (typeof window !== 'undefined') return remoteMutation('addTransaction', [buildingId, transaction]);

  const signedAmount =
    transaction.type === 'expense'
      ? -Math.abs(transaction.amount)
      : transaction.type === 'income'
      ? Math.abs(transaction.amount)
      : transaction.amount;

  const newTrx: Transaction = {
    id: `trx-${crypto.randomUUID()}`,
    ...transaction,
    amount: Math.round(signedAmount * 100) / 100,
    type: signedAmount >= 0 ? 'income' : 'expense',
  };

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === buildingId);
      if (bld) {
        bld.financials.transactions = bld.financials.transactions || [];
        bld.financials.transactions.unshift(newTrx);

        // Separate operating fund vs mandatory reserve fund (Law 106-12)
        if (transaction.fundType === 'reserve') {
          bld.financials.reserveFundBalance =
            Math.round(((bld.financials.reserveFundBalance ?? 0) + newTrx.amount) * 100) / 100;
        } else {
          bld.financials.balance =
            Math.round(((bld.financials.balance ?? 0) + newTrx.amount) * 100) / 100;
        }

        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        return newTrx;
      }
    }
  }

  const { addDoc, collection, db } = await import('./legacyClient');
  const docRef = await addDoc(collection(db, TRANSACTIONS_COL), { ...newTrx, buildingId });
  return { id: docRef.id, ...newTrx };
};

export const getInvoicesForBuilding = async (buildingId: string): Promise<Invoice[]> => {
  if (isLocalEngineEnabled) {
    const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    return invoices.filter((inv) => inv.buildingId === buildingId);
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, INVOICES_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Invoice));
};

export const createInvoiceForResident = async (
  residentId: string,
  buildingId: string,
  syndicId: string
): Promise<Invoice> => {
  if (typeof window !== 'undefined') return remoteMutation('createInvoiceForResident', [residentId, buildingId, syndicId]);

  const building = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics).find((s) => s.id === syndicId)?.buildings.find((b) => b.id === buildingId);
  if (!building?.residents.some((r) => r.id === residentId)) throw new Error('Copropriétaire hors de cet immeuble.');
  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
  const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
  const eligible = charges.filter((c) => c.syndicId === syndicId && c.buildingId === buildingId &&
    c.residentId === residentId && !c.invoiceId && outstanding(c) > 0);
  if (!eligible.length) {
    const existing = invoices.find((i) => i.syndicId === syndicId && i.buildingId === buildingId && i.residentId === residentId &&
      i.status !== 'paid' && i.status !== 'cancelled');
    if (existing) return existing;
    throw new Error('Aucune nouvelle charge impayée à facturer.');
  }
  const invoice: Invoice = { id: `inv-${crypto.randomUUID()}`, syndicId, buildingId, residentId,
    invoiceNumber: `FAC-${new Date().getFullYear()}-${String(invoices.length + 1).padStart(4, '0')}`,
    totalAmount: eligible.reduce((sum, c) => sum + outstanding(c), 0) / 100, paidAmount: 0, status: 'unpaid',
    createdAt: new Date().toISOString(), dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    chargeIds: eligible.map((c) => c.id), items: eligible.map(c => ({ description:c.description || "Charges de copropriété",period:c.period,amount:outstanding(c)/100 })), issuedTo: Object.fromEntries(Object.entries(building.residents.find(r=>r.id===residentId)!).filter(([key])=>["name","email","phone","cin","isOwner"].includes(key))) as any };
  for (const charge of eligible) charge.invoiceId = invoice.id;
  setLocalItem(STORAGE_KEYS.CHARGES, charges); setLocalItem(STORAGE_KEYS.INVOICES, [invoice, ...invoices]);
  return invoice;
};

export const recordPayment = async (invoice: Invoice, amount: number, method: string, paymentReference?: string) => {
  if (typeof window !== 'undefined') return remoteMutation('recordPayment', [invoice, amount, method, paymentReference]);

  const cents = centimes(amount);
  if (cents <= 0) throw new Error('Montant invalide.');
  const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
  const current = invoices.find((i) => i.id === invoice.id);
  if (!current || current.status === 'cancelled') throw new Error('Facture introuvable ou annulée.');
  const paymentId = paymentReference || `invoice:${crypto.randomUUID()}`;
  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  const building = syndics.find((s) => s.id === current.syndicId)?.buildings.find((b) => b.id === current.buildingId);
  if (!building) throw new Error('Immeuble hors du cabinet.');
  const previous = building.financials.transactions.filter((t) => t.paymentId === paymentId);
  if (previous.length) {
    if (previous.some((t) => t.sourceInvoiceId !== current.id || t.paymentMethod !== method) ||
      previous.reduce((sum, t) => sum + centimes(t.amount), 0) !== cents) throw new Error('Référence déjà utilisée.');
    return true;
  }
  if (cents > centimes(current.totalAmount) - centimes(current.paidAmount ?? 0)) throw new Error('Paiement supérieur au solde de la facture.');
  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
  const linked = [...new Set(current.chargeIds)].map((id) => {
    const c = charges.find((charge) => charge.id === id);
    if (!c || c.syndicId !== current.syndicId || c.buildingId !== current.buildingId || c.residentId !== current.residentId ||
      (c.invoiceId && c.invoiceId !== current.id)) throw new Error('Charge non liée à la facture.');
    return c;
  });
  if (cents > linked.reduce((sum, c) => sum + outstanding(c), 0)) throw new Error('Paiement supérieur aux charges dues.');
  let remaining = cents;
  const paymentAllocations: Array<{ chargeId: string; amount: number }> = [];
  for (const charge of linked) {
    const allocated = Math.min(remaining, outstanding(charge));
    if (allocated) paymentAllocations.push({ chargeId: charge.id, amount: allocated / 100 });
    charge.paidAmount = (centimes(paidAmount(charge)) + allocated) / 100;
    charge.status = outstanding(charge) === 0 ? 'paid' : 'unpaid'; charge.invoiceId = current.id;
    remaining -= allocated;
  }
  current.paidAmount = (centimes(current.paidAmount ?? 0) + cents) / 100;
  current.status = centimes(current.paidAmount) === centimes(current.totalAmount) ? 'paid' : 'unpaid';
  current.paymentIds = [...(current.paymentIds || []), paymentId];
  const receipts = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
  const split = postIncome(building, cents / 100, paymentId, { sourceInvoiceId: current.id, paymentMethod: method,
    description: `Paiement facture ${current.invoiceNumber}`, invoiceNumber: current.invoiceNumber, paymentAllocations });
  for (const allocation of paymentAllocations) {
    assertReceiptCapacity(receipts, building, linked.find(c => c.id === allocation.chargeId)!, centimes(allocation.amount));
  }
  const reserves = allocateBudgetInCentimes(split.reserveFundAmount, paymentAllocations.map(a => ({ id: a.chargeId, tantiemes: centimes(a.amount) })));
  const snapshots: Quittance[] = [];
  for (const allocation of paymentAllocations) {
    const charge = linked.find(c => c.id === allocation.chargeId)!;
    const apartment = building.apartments.find(a => a.id === charge.apartmentId);
    const resident = building.residents.find(r => r.id === charge.residentId);
    if (!apartment || !resident) throw new Error('Lot ou résident non lié au paiement.');
    const reserve = reserves.get(charge.id) || 0;
    const receipt = numberedReceipt({ paymentId, chargeId: charge.id, syndicId: current.syndicId,
      syndicName: syndics.find(s => s.id === current.syndicId)?.name || '', buildingId: building.id, buildingName: building.name,
      residentId: resident.id, residentName: resident.name, apartmentId: apartment.id, apartmentNumber: apartment.number,
      amount: allocation.amount, periodCovered: charge.period || '', paymentDate: new Date().toISOString(), paymentMethod: method,
      referenceNumber: paymentReference }, { reserveFundAmount: reserve,
      chargesCourantesAmount: (centimes(allocation.amount) - centimes(reserve)) / 100, reservePercentageUsed: split.reservePercentageUsed }, receipts, syndics);
    receipts.unshift(receipt); snapshots.push(receipt);
  }
  building.financials.transactions.find(t => t.paymentId === paymentId)!.receiptSnapshots = snapshots;
  setLocalItem(STORAGE_KEYS.INVOICES, invoices); setLocalItem(STORAGE_KEYS.CHARGES, charges);
  setLocalItem(STORAGE_KEYS.SYNDICS, syndics); setLocalItem(STORAGE_KEYS.QUITTANCES, receipts);
  return true;
};

export const initiateCmiPayment = async (invoiceId: string) => {
  const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
  const matchedInvoice = invoices.find((i) => i.id === invoiceId);
  const matchedCharge = charges.find((c) => c.id === invoiceId);
  const outstandingAmount = matchedInvoice
    ? Math.max(0, matchedInvoice.totalAmount - (matchedInvoice.paidAmount || 0))
    : matchedCharge
    ? Math.max(0, matchedCharge.amount - (matchedCharge.paidAmount || 0))
    : 0;

  if (outstandingAmount <= 0) {
    throw new Error('Facture ou échéance introuvable ou déjà réglée.');
  }

  const formattedAmount = outstandingAmount.toFixed(2);
  const rnd = `${Date.now()}`;
  const signatureDigest = hashPasswordSync(
    `${invoiceId}|${formattedAmount}|504|${rnd}`,
    'cmi_gateway'
  );

  return {
    action: '/api/cmi/checkout-disabled',
    params: {
      clientid: 'CMI_DISABLED_UNTIL_MERCHANT_LIVE',
      amount: formattedAmount,
      currency: '504',
      okUrl: typeof window !== 'undefined' ? window.location.href : '',
      failUrl: typeof window !== 'undefined' ? window.location.href : '',
      TranType: 'PreAuth',
      storetype: '3d_pay_hosting',
      oid: invoiceId,
      rnd,
      hashAlgorithm: 'ver3',
      hash: signatureDigest,
    },
  };
};

// ==========================================
// 11. MAINTENANCE & STATUS TRACKER
// ==========================================

const DEFAULT_MAINTENANCE_REQUESTS: MaintenanceRequest[] = [];

function normalizeMaintenanceRequestApartment(req: MaintenanceRequest): MaintenanceRequest {
  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  let targetBld: Building | undefined;
  for (const s of syndics) {
    const found = s.buildings.find((b) => b.id === req.buildingId);
    if (found) {
      targetBld = found;
      break;
    }
  }
  if (!targetBld) return req;

  const apartments = targetBld.apartments || [];
  const residents = targetBld.residents || [];
  const resObj = residents.find(
    (r) =>
      r.id === req.residentId ||
      `res-${r.id}` === req.residentId ||
      (req.residentName && r.name.trim().toLowerCase() === req.residentName.trim().toLowerCase())
  );

  const resolveAptNum = (aptId?: string): string | undefined => {
    if (!aptId) return undefined;
    const direct = apartments.find((a) => a.id === aptId);
    if (direct?.number && !direct.number.startsWith('apt-')) {
      return direct.number.replace(/^(Lot|شقة)\s+/i, '').trim();
    }
    const idxMatch = aptId.match(/apt-\d+-(\d+)/);
    if (idxMatch) {
      const idx = parseInt(idxMatch[1], 10);
      const byIdx = apartments[idx];
      if (byIdx?.number && !byIdx.number.startsWith('apt-')) {
        return byIdx.number.replace(/^(Lot|شقة)\s+/i, '').trim();
      }
      return String(idx + 1);
    }
    return undefined;
  };

  let resolvedNumber = req.apartmentNumber;
  const linkedApt =
    (resObj?.apartmentId && apartments.find((a) => a.id === resObj.apartmentId)) ||
    apartments.find(
      (a) =>
        a.ownerId === req.residentId ||
        a.tenantId === req.residentId ||
        (resObj && (a.ownerId === resObj.id || a.tenantId === resObj.id))
    );

  if (linkedApt?.number && !linkedApt.number.startsWith('apt-')) {
    resolvedNumber = `Lot ${linkedApt.number.replace(/^(Lot|شقة)\s+/i, '').trim()}`;
  } else if (req.apartmentNumber && /apt-[\w-]+/.test(req.apartmentNumber)) {
    const idMatch = req.apartmentNumber.match(/apt-[\w-]+/);
    const num = resolveAptNum(idMatch?.[0]) || resolveAptNum(resObj?.apartmentId);
    if (num) resolvedNumber = `Lot ${num}`;
  } else if (!req.apartmentNumber && resObj?.apartmentId) {
    const num = resolveAptNum(resObj.apartmentId);
    if (num) resolvedNumber = `Lot ${num}`;
  }

  return {
    ...req,
    residentName: req.residentName || resObj?.name,
    apartmentNumber: resolvedNumber,
  };
}

export const getMaintenanceRequestsForBuilding = async (
  buildingId: string
): Promise<MaintenanceRequest[]> => {
  if (isLocalEngineEnabled) {
    const list = getLocalItem<MaintenanceRequest[]>(
      STORAGE_KEYS.MAINTENANCE,
      DEFAULT_MAINTENANCE_REQUESTS
    );
    return list
      .filter((m) => m.buildingId === buildingId)
      .map((m) => normalizeMaintenanceRequestApartment(m));
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, MAINTENANCE_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) =>
    normalizeMaintenanceRequestApartment({ id: d.id, ...d.data() } as MaintenanceRequest)
  );
};

export const getMaintenanceRequestsForResident = async (
  residentId: string
): Promise<MaintenanceRequest[]> => {
  if (isLocalEngineEnabled) {
    const list = getLocalItem<MaintenanceRequest[]>(
      STORAGE_KEYS.MAINTENANCE,
      DEFAULT_MAINTENANCE_REQUESTS
    );
    return list
      .filter((m) => m.residentId === residentId)
      .map((m) => normalizeMaintenanceRequestApartment(m));
  }

  const { query, collection, db, where, getDocs } = await import('./legacyClient');
  const q = query(collection(db, MAINTENANCE_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) =>
    normalizeMaintenanceRequestApartment({ id: d.id, ...d.data() } as MaintenanceRequest)
  );
};

export const addMaintenanceRequest = async (request: Omit<MaintenanceRequest, 'id'>) => {
  if (typeof window !== 'undefined') return remoteMutation('addMaintenanceRequest', [request]);

  const normalizedDraft = normalizeMaintenanceRequestApartment({
    id: crypto.randomUUID(),
    ...request,
  });

  const initialUpdate: MaintenanceStepUpdate = {
    id: `upd-${crypto.randomUUID()}`,
    status: normalizedDraft.status || 'pending',
    title: 'Signalement créé et transmis au Syndic',
    note: normalizedDraft.description,
    updatedBy: normalizedDraft.residentName
      ? `${normalizedDraft.residentName}${normalizedDraft.apartmentNumber ? ` (${normalizedDraft.apartmentNumber})` : ''}`
      : 'Copropriétaire',
    updatedByRole: 'resident',
    timestamp: normalizedDraft.createdAt || new Date().toISOString(),
    photos:
      normalizedDraft.photos ||
      (normalizedDraft.photoUrl ? [normalizedDraft.photoUrl] : undefined),
  };

  const newReq: MaintenanceRequest = {
    ...normalizedDraft,
    updates:
      normalizedDraft.updates && normalizedDraft.updates.length > 0
        ? normalizedDraft.updates
        : [initialUpdate],
  };

  if (isLocalEngineEnabled) {
    const list = getLocalItem<MaintenanceRequest[]>(
      STORAGE_KEYS.MAINTENANCE,
      DEFAULT_MAINTENANCE_REQUESTS
    );
    list.unshift(newReq);
    setLocalItem(STORAGE_KEYS.MAINTENANCE, list);
    return newReq;
  }

  const { addDoc, collection, db } = await import('./legacyClient');
  const docRef = await addDoc(collection(db, MAINTENANCE_COL), newReq);
  return { id: docRef.id, ...newReq };
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
  }
) => {
  if (typeof window !== 'undefined') return remoteMutation('updateMaintenanceRequest', [id, updates, stepInfo]);

  if (isLocalEngineEnabled) {
    const list = getLocalItem<MaintenanceRequest[]>(
      STORAGE_KEYS.MAINTENANCE,
      DEFAULT_MAINTENANCE_REQUESTS
    );
    const idx = list.findIndex((m) => m.id === id);
    if (idx >= 0) {
      const existing = list[idx];
      const mergedPhotos = stepInfo?.stepPhotos?.length
        ? [
            ...(existing.photos || (existing.photoUrl ? [existing.photoUrl] : [])),
            ...stepInfo.stepPhotos,
          ]
        : updates.photos || existing.photos;

      const existingUpdates = existing.updates || [];
      const nextUpdates = [...existingUpdates];

      if (
        stepInfo &&
        (stepInfo.note ||
          stepInfo.title ||
          updates.status !== existing.status ||
          stepInfo.stepPhotos?.length)
      ) {
        const statusLabel =
          (updates.status || existing.status) === 'completed'
            ? 'Intervention clôturée et vérifiée'
            : (updates.status || existing.status) === 'in_progress'
            ? 'Intervention en cours / Mise à jour de suivi'
            : 'Mise à jour du dossier';

        const newStep: MaintenanceStepUpdate = {
          id: `upd-${crypto.randomUUID()}`,
          status: updates.status || existing.status,
          title: stepInfo.title || statusLabel,
          note:
            stepInfo.note ||
            updates.syndicNotes ||
            `Statut mis à jour vers : ${updates.status || existing.status}`,
          updatedBy: stepInfo.updatedBy || 'SyndicPro Gestion (Bureau Syndic)',
          updatedByRole: stepInfo.updatedByRole || 'syndic',
          timestamp: new Date().toISOString(),
          photos: stepInfo.stepPhotos?.length ? stepInfo.stepPhotos : undefined,
          assignedTo: updates.assignedTo || existing.assignedTo,
          cost: updates.cost !== undefined ? updates.cost : existing.cost,
        };
        nextUpdates.push(newStep);
      }

      list[idx] = {
        ...existing,
        ...updates,
        photos: mergedPhotos,
        photoUrl: mergedPhotos && mergedPhotos.length > 0 ? mergedPhotos[0] : existing.photoUrl,
        updates: nextUpdates,
      };
      setLocalItem(STORAGE_KEYS.MAINTENANCE, list);
      return list[idx];
    }
    return { id, ...updates };
  }

  const { doc, db, updateDoc } = await import('./legacyClient');
  const docRef = doc(db, MAINTENANCE_COL, id);
  await updateDoc(docRef, updates);
  return { id, ...updates };
};

export const addAnnouncement = async (
  buildingId: string,
  announcementData: { title: string; content: string; priority?: 'normal' | 'urgent' }
): Promise<Announcement> => {
  if (typeof window !== 'undefined') return remoteMutation('addAnnouncement', [buildingId, announcementData]);

  const newAnn: Announcement = {
    id: crypto.randomUUID(),
    title: announcementData.title,
    content: announcementData.content,
    date: new Date().toISOString(),
    priority: announcementData.priority || 'normal',
  };

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === buildingId);
      if (bld) {
        bld.announcements = bld.announcements || [];
        bld.announcements.unshift(newAnn);
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        void syncSyndicToFirestoreIfAuthenticated(s);
        return newAnn;
      }
    }
  }

  return newAnn;
};

// ==========================================
// 12. DURABLE DOCUMENTS (Audit Item 19)
// ==========================================

const MAX_DOCUMENT_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MiB

async function readFileAsDurableDataUrl(file: File): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string' && reader.result.startsWith('data:')) {
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
  if (typeof (file as any).arrayBuffer === 'function') {
    const ab = await (file as any).arrayBuffer();
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

export const uploadDocument = async (buildingId: string,file: File): Promise<Document> => {
  const dataUrl = await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Lecture impossible.'));reader.readAsDataURL(file);});
  const response = await fetch('/api/uploads',{method:'POST',headers:getAuthenticatedRequestHeaders(),body:JSON.stringify({buildingId,name:file.name,dataUrl})});
  const result = await readCommandResponse(response);if (!response.ok) throw new Error(result.error || 'Téléversement impossible.');
  return remoteMutation('attachDocument',[buildingId,{fileId:result.fileId}]);
};

export const deleteDocument = async (docToDelete: Document): Promise<boolean> => {
  if (typeof window !== 'undefined') return remoteMutation('deleteDocument', [docToDelete]);

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      for (const bld of s.buildings) {
        if (bld.documents) {
          bld.documents = bld.documents.filter((d) => d.id !== docToDelete.id);
        }
      }
    }
    setLocalItem(STORAGE_KEYS.SYNDICS, syndics, docToDelete.id);
    return true;
  }
  return true;
};

// ==========================================
// 13. NOTIFICATIONS (Audit Item 26)
// ==========================================

const DEFAULT_NOTIFICATIONS: Notification[] = [];

export const getUserNotifications = async (userId: string): Promise<Notification[]> => {
  if (isLocalEngineEnabled) {
    await syncAllSharedStateFromServer();
    const list = getLocalItem<Notification[]>(STORAGE_KEYS.NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
    // Audit Item 26: Filter notifications by recipient userId
    return list.filter((n) => n.userId === userId || n.userId === 'all');
  }

  const { query, collection, db, where, orderBy, getDocs } = await import('./legacyClient');
  const q = query(
    collection(db, NOTIFICATIONS_COL),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  const sn = await getDocs(q);
  return sn.docs.map((d) => ({ id: d.id, ...d.data() } as Notification));
};

export const markNotificationAsRead = async (notificationId: string) => {
  if (typeof window !== 'undefined') return remoteMutation('markNotificationAsRead', [notificationId]);

  if (isLocalEngineEnabled) {
    const list = getLocalItem<Notification[]>(STORAGE_KEYS.NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
    const updated = list.map((n) => (n.id === notificationId ? { ...n, read: true } : n));
    setLocalItem(STORAGE_KEYS.NOTIFICATIONS, updated);
    return true;
  }
  const { doc, db, updateDoc } = await import('./legacyClient');
  const docRef = doc(db, NOTIFICATIONS_COL, notificationId);
  await updateDoc(docRef, { read: true });
  return true;
};

// ==========================================
// 14. CHAT & MESSAGERIE COPROPRIÉTÉ (Audit Item 26)
// ==========================================

export const getChatMessages = async (
  buildingId: string,
  channelId?: string
): Promise<ChatMessage[]> => {
  if (isLocalEngineEnabled) {
    await syncAllSharedStateFromServer();
    const list = getLocalItem<ChatMessage[]>(STORAGE_KEYS.CHAT, mockChatMessages);
    const buildingMsgs = list.filter((m) => m.buildingId === buildingId);
    if (channelId) {
      if (channelId === 'marketplace') {
        return buildingMsgs.filter(
          (m) => m.channelId === 'marketplace' || m.channelId.startsWith('market-')
        );
      }
      return buildingMsgs.filter((m) => m.channelId === channelId);
    }
    return buildingMsgs;
  }

  const { query, collection, db, where, orderBy, getDocs } = await import('./legacyClient');
  const q = channelId
    ? query(
        collection(db, 'chat_messages'),
        where('buildingId', '==', buildingId),
        where('channelId', '==', channelId),
        orderBy('createdAt', 'asc')
      )
    : query(
        collection(db, 'chat_messages'),
        where('buildingId', '==', buildingId),
        orderBy('createdAt', 'asc')
      );
  const sn = await getDocs(q);
  return sn.docs.map((d) => ({ id: d.id, ...d.data() } as ChatMessage));
};

export const sendChatMessage = async (
  message: Omit<ChatMessage, 'id' | 'createdAt'>
): Promise<ChatMessage> => {
  if (typeof window !== 'undefined') return remoteMutation('sendChatMessage', [message]);

  const newMsg: ChatMessage = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...message,
  };

  if (isLocalEngineEnabled) {
    const list = getLocalItem<ChatMessage[]>(STORAGE_KEYS.CHAT, mockChatMessages);
    list.push(newMsg);
    setLocalItem(STORAGE_KEYS.CHAT, list);
    return newMsg;
  }

  const { addDoc, collection, db } = await import('./legacyClient');
  const docRef = await addDoc(collection(db, 'chat_messages'), newMsg);
  return { id: docRef.id, ...newMsg };
};

export const toggleChatMessageLike = async (
  messageId: string,
  userId: string
): Promise<ChatMessage | null> => {
  if (typeof window !== 'undefined') return remoteMutation('toggleChatMessageLike', [messageId, userId]);

  if (isLocalEngineEnabled) {
    const list = getLocalItem<ChatMessage[]>(STORAGE_KEYS.CHAT, mockChatMessages);
    const msg = list.find((m) => m.id === messageId);
    if (msg) {
      msg.likes = msg.likes || [];
      if (msg.likes.includes(userId)) {
        msg.likes = msg.likes.filter((id) => id !== userId);
      } else {
        msg.likes.push(userId);
      }
      setLocalItem(STORAGE_KEYS.CHAT, list);
      return msg;
    }
  }
  return null;
};

// ==========================================
// 15. RESIDENT MARKETPLACE ("LE SOUK")
// ==========================================

export const getMarketplaceItems = async (
  buildingId: string
): Promise<MarketplaceItem[]> => {
  if (isLocalEngineEnabled) {
    await syncAllSharedStateFromServer();
    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, mockMarketplaceItems);
    return list.filter((item) => item.buildingId === buildingId);
  }

  const { query, collection, db, where, orderBy, getDocs } = await import('./legacyClient');
  const q = query(
    collection(db, 'marketplace_items'),
    where('buildingId', '==', buildingId),
    orderBy('createdAt', 'desc')
  );
  const sn = await getDocs(q);
  return sn.docs.map((d) => ({ id: d.id, ...d.data() } as MarketplaceItem));
};

export const addMarketplaceItem = async (
  item: Omit<MarketplaceItem, 'id' | 'createdAt'>
): Promise<MarketplaceItem> => {
  if (typeof window !== 'undefined') return remoteMutation('addMarketplaceItem', [item]);

  const newItem: MarketplaceItem = {
    id: `item-${crypto.randomUUID()}`,
    createdAt: new Date().toISOString(),
    ...item,
  };

  if (isLocalEngineEnabled) {
    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, mockMarketplaceItems);
    list.unshift(newItem);
    setLocalItem(STORAGE_KEYS.MARKETPLACE, list);
    return newItem;
  }

  const { addDoc, collection, db } = await import('./legacyClient');
  const docRef = await addDoc(collection(db, 'marketplace_items'), newItem);
  return { id: docRef.id, ...newItem };
};

export const updateMarketplaceItemStatus = async (
  itemId: string,
  status: MarketplaceItem['status']
): Promise<boolean> => {
  if (typeof window !== 'undefined') return remoteMutation('updateMarketplaceItemStatus', [itemId, status]);

  if (isLocalEngineEnabled) {
    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, mockMarketplaceItems);
    const it = list.find((i) => i.id === itemId);
    if (it) {
      it.status = status;
      setLocalItem(STORAGE_KEYS.MARKETPLACE, list);
      return true;
    }
    return false;
  }

  const { doc, db, updateDoc } = await import('./legacyClient');
  const docRef = doc(db, 'marketplace_items', itemId);
  await updateDoc(docRef, { status });
  return true;
};

export const deleteMarketplaceItem = async (itemId: string): Promise<boolean> => {
  if (typeof window !== 'undefined') return remoteMutation('deleteMarketplaceItem', [itemId]);

  if (isLocalEngineEnabled) {
    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, mockMarketplaceItems);
    const filtered = list.filter((i) => i.id !== itemId);
    setLocalItem(STORAGE_KEYS.MARKETPLACE, filtered, itemId);
    return true;
  }

  const { deleteDoc, doc, db } = await import('./legacyClient');
  await deleteDoc(doc(db, 'marketplace_items', itemId));
  return true;
};

const pendingOperations = new Map<string, string>();
const ephemeralInvites = new Map<string, any>();
const preparedOperations = new Map<string, unknown[]>();
const inflightOperations = new Map<string, Promise<unknown>>();
export function clearStateCache() { stateCacheGeneration++; for (const controller of syncControllers) controller.abort(); syncControllers.clear(); inflightSyncPromise = null; clearBusinessCache(); pendingOperations.clear(); preparedOperations.clear(); inflightOperations.clear(); ephemeralInvites.clear(); lastKnownServerRevision = 0; lastSyncTimestampMs = 0; }
export function remoteMutation<T = any>(operation: string, args: unknown[]): Promise<T> {
  args = [...args];
  while (args.length && args.at(-1) === undefined) args.pop();
  const requestKey = JSON.stringify({ operation, args });
  const pending = inflightOperations.get(requestKey);
  if (pending) return pending as Promise<T>;
  const task = performRemoteMutation<T>(operation, args, requestKey).finally(() => {
    if (inflightOperations.get(requestKey) === task) inflightOperations.delete(requestKey);
  });
  inflightOperations.set(requestKey, task);
  return task;
}

async function performRemoteMutation<T>(operation: string, args: unknown[], requestKey: string): Promise<T> {
  const generation = stateCacheGeneration;
  const requireSameIdentity = () => { if (generation !== stateCacheGeneration) throw new Error('La session a changé. Recommencez depuis votre espace.'); };
  try {
  const first: any = args[0];
  const linked = typeof first === 'string' ? [STORAGE_KEYS.MAINTENANCE, STORAGE_KEYS.MARKETPLACE, STORAGE_KEYS.CHAT].flatMap(key => JSON.parse(engineStorage.getItem(key) || '[]')).find(item => item.id === first) : undefined;
  const buildingId = first?.buildingId || linked?.buildingId;
  if (preparedOperations.has(requestKey)) args = preparedOperations.get(requestKey)!;
  else if (buildingId) {
    const uploaded = new Map<string, Promise<string>>();
    const upload = async (value: any, key = ''): Promise<any> => {
      if (typeof value === 'string' && value.startsWith('data:') && ['photoUrl','photos','images','imageUrl','receiptUrl','attachmentUrl','stepPhotos'].includes(key)) {
        let pending = uploaded.get(value);
        if (!pending) {
          pending = (async () => {
            const response = await fetch('/api/uploads', { method: 'POST', headers: getAuthenticatedRequestHeaders(), body: JSON.stringify({ buildingId, name: 'piece-jointe', dataUrl: value }) });
            const result = await readCommandResponse(response);
            if (!response.ok) throw new Error(result.error || 'Téléversement impossible.');
            return result.url as string;
          })();
          uploaded.set(value, pending);
        }
        return pending;
      }
      if (Array.isArray(value)) return Promise.all(value.map(item => upload(item,key)));
      if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([field,item]) => [field,await upload(item,field)])));
      return value;
    };
    args = await upload(args);
    requireSameIdentity();
    preparedOperations.set(requestKey, args);
  }
  requireSameIdentity();
  // Keep one identity and the same uploaded file URLs across an uncertain response.
  const operationId = pendingOperations.get(requestKey) || `op:${Date.now()}:${crypto.randomUUID()}`;
  pendingOperations.set(requestKey, operationId);
  const response = await fetch('/api/commands', { method: 'POST', headers: getAuthenticatedRequestHeaders(), body: JSON.stringify({ operation,args,operationId }) });
  const data = await readCommandResponse(response);
  requireSameIdentity();
  if (!response.ok) {
    if (response.status < 500) { pendingOperations.delete(requestKey); preparedOperations.delete(requestKey); }
    throw new Error(data.error || 'Enregistrement impossible.');
  }
  pendingOperations.delete(requestKey);
  preparedOperations.delete(requestKey);
  if (data.result?.id && (data.result.invitationCode || data.result.invitationToken)) ephemeralInvites.set(data.result.id,{ invitationCode:data.result.invitationCode,invitationToken:data.result.invitationToken });
  if (data.store && (typeof data.revision !== 'number' || data.revision >= lastKnownServerRevision)) {
    if (typeof data.revision === 'number') lastKnownServerRevision = data.revision;
    lastSyncTimestampMs = Date.now();
    cacheServerStore(data.store);
  }
  for (const key of Object.values(STORAGE_KEYS)) notifyStateUpdated(key);
  notifyOperation({ operation });
  return (Array.isArray(data.result) ? Object.assign(data.result,data.resultMeta || {}) : data.result) as T;
  } catch (error) {
    if (generation === stateCacheGeneration) notifyOperation({ operation, error: error instanceof Error ? error.message : 'Enregistrement impossible.' });
    throw error;
  }
}

async function readCommandResponse(response: Response): Promise<any> {
  try {
    const result = await response.json();
    if (!response.ok && result.error) {
      const isAr = typeof window !== 'undefined' && window.localStorage.getItem('syndik_lang') === 'ar';
      result.error = readableError(result.error, isAr);
      if (result.requestId && ['INTERNAL_ERROR', 'DATABASE_ACCESS', 'DATABASE_MISSING', 'DATABASE_UNAVAILABLE', 'STORAGE_ACCESS', 'STORAGE_MISSING', 'STORAGE_UNAVAILABLE'].includes(result.code))
        result.error += `\n${isAr ? 'مرجع الدعم' : 'Référence pour le support'} : ${result.requestId}`;
    }
    return result;
  }
  catch {
    if (response.status === 413) throw new Error('Fichier trop volumineux. Joignez un fichier de 5 Mo maximum.');
    if (response.status === 401) throw new Error('Authentification requise.');
    if (response.status === 429) throw new Error('Trop de demandes. Patientez un instant avant de réessayer.');
    throw new Error('Le serveur est temporairement indisponible. Réessayez dans un instant.');
  }
}

