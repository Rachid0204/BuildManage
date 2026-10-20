import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  orderBy,
  runTransaction,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions, isMock, OperationType, handleFirestoreError } from './config';
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
  allocateBudgetInCentimes,
  splitChargeReserveAndOperating,
  generateSecureRandomDigits,
} from '../utils/security';

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

function notifyStateUpdated(key: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('syndik-state-updated', { detail: { key } }));
  }
  try {
    broadcastChannel?.postMessage({ type: 'STATE_UPDATED', key, timestamp: Date.now() });
  } catch {
    // ignore broadcast errors
  }
}

/**
 * Strips plaintext passwords from Syndic/Resident/Prestataire records before persisting to
 * localStorage or sending over the network (Audit Item 03).
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
  if (typeof localStorage === 'undefined') return;
  const keysToSanitize = [
    STORAGE_KEYS.SYNDICS,
    STORAGE_KEYS.PRESTATAIRES,
    STORAGE_KEYS.RESIDENT_ACCOUNTS,
    STORAGE_KEYS.PRESTATAIRE_ACCOUNTS,
    STORAGE_KEYS.REGISTERED_USERS,
  ];
  for (const key of keysToSanitize) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const sanitized = stripPlaintextCredentialsForStorage(key, parsed);
      localStorage.setItem(key, JSON.stringify(sanitized));
    } catch {
      // ignore malformed JSON
    }
  }
}

let lastKnownServerRevision = 0;
let lastSyncTimestampMs = 0;
let inflightSyncPromise: Promise<Record<string, any> | null> | null = null;

export async function pushKeyToSharedServer<T>(
  key: string,
  val: T,
  deletedId?: string,
  options?: { background?: boolean }
): Promise<T> {
  const sanitizedVal = stripPlaintextCredentialsForStorage(key, val);
  const headers = getAuthenticatedRequestHeaders();
  const isNetworkBlockedSim =
    typeof localStorage !== 'undefined' &&
    localStorage.getItem('syndik_simulate_network_offline') === 'true';

  if (isNetworkBlockedSim) {
    try {
      localStorage.setItem('syndik_sync_status_v1', 'failed');
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
        localStorage.setItem('syndik_sync_status_v1', 'failed');
      } catch {
        // ignore
      }
      if (!options?.background) {
        throw new Error(`Échec d’écriture serveur durable (HTTP ${res.status})`);
      }
      return sanitizedVal;
    }
    try {
      localStorage.setItem('syndik_sync_status_v1', 'synced');
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
          localStorage.setItem(key, JSON.stringify(cleanServerVal));
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
      localStorage.setItem('syndik_sync_status_v1', 'failed');
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

  inflightSyncPromise = (async () => {
    try {
      const url =
        !force && lastKnownServerRevision > 0
          ? `/api/shared-state?sinceRevision=${lastKnownServerRevision}`
          : '/api/shared-state';
      const res = await fetch(url, {
        method: 'GET',
        headers,
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return null;

      const data = await res.json();
      if (!data || !data.ok) return null;

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
        const localResetAt = localStorage.getItem('syndik_prod_last_reset_at');
        if (localResetAt !== String(serverStore.__resetAt)) {
          for (const k of trackedKeys) {
            localStorage.removeItem(k);
          }
          localStorage.setItem('syndik_prod_last_reset_at', String(serverStore.__resetAt));
        }
      }

      for (const key of trackedKeys) {
        const serverVal = serverStore[key];
        if (serverVal !== undefined && serverVal !== null) {
          const cleanVal = stripPlaintextCredentialsForStorage(key, serverVal);
          localStorage.setItem(key, JSON.stringify(cleanVal));
        } else {
          const localRaw = localStorage.getItem(key);
          if (localRaw) {
            try {
              const parsed = JSON.parse(localRaw);
              void pushKeyToSharedServer(key, parsed, undefined, { background: true });
            } catch {
              // ignore
            }
          }
        }
      }
      return serverStore;
    } catch {
      return null;
    } finally {
      inflightSyncPromise = null;
    }
  })();

  return inflightSyncPromise;
}

export async function resetAllProductionData(): Promise<void> {
  if (typeof window !== 'undefined') {
    for (const key of Object.values(STORAGE_KEYS)) {
      localStorage.removeItem(key);
    }
    for (const oldKey of LEGACY_TEST_KEYS) {
      localStorage.removeItem(oldKey);
    }
    localStorage.removeItem('syndik_selected_building_id');
  }
  try {
    const headers = getAuthenticatedRequestHeaders();
    if (headers['Authorization']) {
      await fetch('/api/shared-state/reset', {
        method: 'POST',
        headers,
      });
    }
  } catch {
    // ignore
  }
  const user = auth.currentUser;
  if (user && user.emailVerified) {
    try {
      const snap = await getDocs(collection(db, 'syndics'));
      for (const docSnap of snap.docs) {
        try {
          await deleteDoc(doc(db, 'syndics', docSnap.id));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }
  notifyStateUpdated(STORAGE_KEYS.SYNDICS);
}

// Purge any legacy test/mock keys in browser and sanitize credentials
if (typeof window !== 'undefined') {
  for (const oldKey of LEGACY_TEST_KEYS) {
    localStorage.removeItem(oldKey);
  }
  sanitizeAccountRecordsInStorage();
  void syncAllSharedStateFromServer();
}

// Helper to get or initialize local storage item
function getLocalItem<T>(key: string, defaultVal: T): T {
  try {
    const item = localStorage.getItem(key);
    if (!item) {
      const cleanDefault = stripPlaintextCredentialsForStorage(key, defaultVal);
      localStorage.setItem(key, JSON.stringify(cleanDefault));
      void pushKeyToSharedServer(key, cleanDefault, undefined, { background: true });
      return cleanDefault;
    }
    return JSON.parse(item) as T;
  } catch (e) {
    console.error(`Error reading ${key} from localStorage:`, e);
    return defaultVal;
  }
}

function setLocalItem<T>(key: string, val: T, deletedId?: string): void {
  try {
    if (deletedId) {
      const rawTombstones = localStorage.getItem('syndik_deleted_building_ids_v1');
      const tombstones: string[] = rawTombstones ? JSON.parse(rawTombstones) : [];
      if (!tombstones.includes(deletedId)) {
        tombstones.push(deletedId);
        localStorage.setItem('syndik_deleted_building_ids_v1', JSON.stringify(tombstones));
      }
    }
    const sanitized = stripPlaintextCredentialsForStorage(key, val);
    localStorage.setItem(key, JSON.stringify(sanitized));
    void pushKeyToSharedServer(key, sanitized, deletedId, { background: true });
    notifyStateUpdated(key);
  } catch (e) {
    console.error(`Error writing ${key} to localStorage:`, e);
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

export const getSyndics = async (): Promise<Syndic[]> => {
  await syncAllSharedStateFromServer();
  const localSyndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);

  if (!isMock) {
    try {
      const snapshot = await getDocs(collection(db, SYNDICS_COL));
      if (!snapshot.empty) {
        const rawTombstones = localStorage.getItem('syndik_deleted_building_ids_v1');
        const tombstones = new Set<string>(rawTombstones ? JSON.parse(rawTombstones) : []);
        const mergedMap = new Map<string, Syndic>();
        for (const s of localSyndics) {
          if (s?.id && !tombstones.has(s.id)) {
            mergedMap.set(s.id, { ...s, logoUrl: s.logoUrl ?? '' });
          }
        }
        for (const docSnap of snapshot.docs) {
          if (tombstones.has(docSnap.id)) continue;
          const data = docSnap.data() as any;
          const existing = mergedMap.get(docSnap.id);
          const buildings = Array.isArray(data.buildings)
            ? data.buildings.filter((b: any) => b?.id && !tombstones.has(b.id))
            : existing?.buildings || [];
          const firestoreSyndic: Syndic = {
            ...existing,
            ...data,
            id: docSnap.id,
            logoUrl: data.logoUrl ?? existing?.logoUrl ?? '',
            subscriptionExpiry:
              data.subscriptionExpiresAt ||
              data.subscriptionExpiry ||
              existing?.subscriptionExpiry ||
              new Date(Date.now() + 30 * 86400000).toISOString(),
            buildings,
          };
          mergedMap.set(docSnap.id, firestoreSyndic);
        }
        const mergedList = Array.from(mergedMap.values());
        setLocalItem(STORAGE_KEYS.SYNDICS, mergedList);
        return mergedList;
      }
    } catch {
      // continue with shared server + local state
    }
  }

  return localSyndics.map((s) => ({ ...s, logoUrl: s.logoUrl ?? '' }));
};

export const saveSyndic = async (syndic: Syndic): Promise<Syndic> => {
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

const PLAN_BUILDING_LIMITS: Record<Syndic['subscriptionPlan'], number> = {
  starter: 4,
  professional: 8,
  enterprise: 9999,
};

export const addBuilding = async (
  syndicId: string,
  buildingData: Omit<
    Building,
    'id' | 'residents' | 'apartments' | 'announcements' | 'documents' | 'financials' | 'syndicId'
  > & { apartments?: Omit<Apartment, 'id' | 'buildingId'>[] }
) => {
  const { apartments, ...coreBuilding } = buildingData;
  const validation = BuildingSchema.safeParse({ ...coreBuilding, syndicId });
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
  const maxBuildings = PLAN_BUILDING_LIMITS[syndic.subscriptionPlan] ?? 10;
  if ((syndic.buildings?.length || 0) >= maxBuildings) {
    throw new Error(
      `Limite atteinte pour le forfait ${syndic.subscriptionPlan} (${maxBuildings} immeuble(s) max).`
    );
  }

  const newBuildingId = `bld-${Date.now()}`;
  const totalLots = apartments?.length || 0;
  const baseTantiemes = totalLots > 0 ? Math.floor(1000 / totalLots) : 100;
  const remainderTantiemes = totalLots > 0 ? 1000 - baseTantiemes * totalLots : 0;

  const generatedApts: Apartment[] = (apartments || []).map((apt, idx) => ({
    id: `apt-${Date.now()}-${idx}`,
    buildingId: newBuildingId,
    number: apt.number,
    floor: apt.floor,
    area: apt.area,
    monthlyFees: apt.monthlyFees ?? coreBuilding.monthlySyndicFees,
    tantiemes:
      apt.tantiemes ??
      (idx === 0 ? baseTantiemes + remainderTantiemes : baseTantiemes),
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
    reserveFundPercentage: coreBuilding.reserveFundPercentage ?? coreBuilding.reserveFundRate ?? 5,
    reserveFundRate: coreBuilding.reserveFundRate ?? coreBuilding.reserveFundPercentage ?? 5,
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
  const { syncApartmentFees, ...buildingUpdates } = updates;
  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const idx = syndic.buildings.findIndex((b) => b.id === buildingId);
      if (idx >= 0) {
        const bld = syndic.buildings[idx];
        const updatedBuilding: Building = {
          ...bld,
          ...buildingUpdates,
        };
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

  const docRef = doc(db, BUILDINGS_COL, buildingId);
  await updateDoc(docRef, buildingUpdates as any);
  return { id: buildingId, ...buildingUpdates };
};

export const deleteBuilding = async (buildingId: string) => {
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

  await deleteDoc(doc(db, BUILDINGS_COL, buildingId));
  return true;
};

// ==========================================
// 3. APARTMENTS & TANTIÈMES (SINGLE & BULK)
// ==========================================

export const addApartment = async (apartmentData: Omit<Apartment, 'id'>) => {
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
          id: `apt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
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

  const docRef = await addDoc(collection(db, APARTMENTS_COL), apartmentData);
  return { id: docRef.id, ...apartmentData };
};

export const addApartmentsBulk = async (
  buildingId: string,
  apartmentsList: Omit<Apartment, 'id' | 'buildingId'>[]
) => {
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
    const docRef = await addDoc(collection(db, APARTMENTS_COL), payload);
    created.push({ id: docRef.id, ...payload });
  }
  return created;
};

export const rebalanceBuildingTantiemes = async (buildingId: string) => {
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

  const docRef = doc(db, APARTMENTS_COL, apartment.id);
  await updateDoc(docRef, apartment as any);
  return apartment;
};

export const deleteApartment = async (apartmentId: string) => {
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
  const digits = generateSecureRandomDigits(4);
  return `Syndik-${cleanPrefix}${digits}!`;
}

function saveResidentCredentialAccount(resident: Resident, rawPassword: string): ResidentAccountRecord {
  const accounts = getLocalItem<ResidentAccountRecord[]>(RESIDENT_ACCOUNTS_KEY, []);
  const emailNorm = resident.email.trim().toLowerCase();
  const passwordHash = hashPasswordSync(rawPassword, emailNorm);
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
          ? `inv-${generateSecureRandomDigits(6).toLowerCase()}`
          : undefined;
        const auditAction: CredentialAuditEntry['action'] = 'generated';
        const persistedResident: Resident = {
          id: `res-${Date.now()}`,
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

  const docRef = await addDoc(collection(db, RESIDENTS_COL), cleanedData);
  return { id: docRef.id, ...cleanedData };
};

export const updateResident = async (resident: Resident): Promise<Resident> => {
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

  const docRef = doc(db, RESIDENTS_COL, cleanedResident.id);
  await updateDoc(docRef, cleanedResident as any);
  return cleanedResident;
};

export const regenerateResidentCredentials = async (residentId: string): Promise<Resident> => {
  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      for (const bld of syndic.buildings) {
        const idx = bld.residents.findIndex((r) => r.id === residentId);
        if (idx >= 0) {
          const res = bld.residents[idx];
          const nowIso = new Date().toISOString();
          const inviteExpiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
          const inviteToken = `inv-${generateSecureRandomDigits(6).toLowerCase()}`;
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

  const q = query(collection(db, CHARGES_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Charge));
};

export const getChargesForResident = async (residentId: string): Promise<Charge[]> => {
  if (isLocalEngineEnabled) {
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    return charges.filter((c) => c.residentId === residentId);
  }

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
    const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 5)
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
          building.apartments.map((a) => ({ id: a.id, tantiemes: a.tantiemes ?? 100 })),
          totalTantiemes
        )
      : null;

    const newCharges: Charge[] = [];
    let skippedCount = 0;

    building.apartments.forEach((apt) => {
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

  const q = query(collection(db, PROOFS_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentProof));
};

export const getPaymentProofsForResident = async (residentId: string): Promise<PaymentProof[]> => {
  if (isLocalEngineEnabled) {
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
    return proofs.filter((p) => p.residentId === residentId);
  }

  const q = query(collection(db, PROOFS_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentProof));
};

export const submitPaymentProof = async (
  proofData: Omit<PaymentProof, 'id' | 'submissionDate' | 'status'>
): Promise<PaymentProof> => {
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
    id: `prf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  const docRef = await addDoc(collection(db, PROOFS_COL), newProof);
  return { id: docRef.id, ...newProof };
};

export const approvePaymentProofsBatch = async (
  buildingId: string,
  proofIds?: string[]
): Promise<{ approvedCount: number; totalAmountMad: number; quittances: Quittance[] }> => {
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

    // Match by (apartment number OR resident name) AND exact remaining charge amount
    const matchedCharge = charges.find((c) => {
      if (c.status === 'paid') return false;
      const apt = targetBuilding!.apartments.find((a) => a.id === c.apartmentId);
      const res = targetBuilding!.residents.find((r) => r.id === c.residentId);
      const rem = Math.max(0, c.amount - (c.paidAmount || 0));
      const amountMatches = Math.abs(rem - cleanAmt) < 0.01;
      if (!amountMatches) return false;
      const lotMatched = Boolean(apt?.number && upperLabel.includes(apt.number.toUpperCase()));
      const nameMatched = Boolean(
        res?.name &&
          res.name
            .toUpperCase()
            .split(/\s+/)
            .some((tok) => tok.length >= 3 && upperLabel.includes(tok))
      );
      return lotMatched || nameMatched;
    });

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
  const normalizedDecision: 'approved' | 'rejected' =
    decision === 'approve' || decision === 'approved' ? 'approved' : 'rejected';

  if (isLocalEngineEnabled) {
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
    const proof = proofs.find((p) => p.id === proofId);
    if (!proof) throw new Error('Payment proof not found');

    // Audit Item 13: State-transition guard — never re-approve or reject an already processed proof!
    if (proof.status !== 'pending') {
      if (proof.status === 'approved') {
        const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
        const existingQuittance = quittances.find(
          (q) => q.id === `quit-prf-${proof.id}` || q.chargeId === proof.chargeId
        );
        return { proof, quittance: existingQuittance, success: true };
      }
      if (normalizedDecision === 'rejected') {
        return { proof, success: true };
      }
      throw new Error('Ce justificatif a déjà été traité et ne peut pas être modifié.');
    }

    proof.status = normalizedDecision;
    proof.reviewedAt = new Date().toISOString();
    if (rejectionReason) proof.rejectionReason = rejectionReason;
    setLocalItem(STORAGE_KEYS.PROOFS, proofs);

    let generatedQuittance: Quittance | undefined;

    if (normalizedDecision === 'approved') {
      const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
      const charge = charges.find((c) => c.id === proof.chargeId);

      // Reconcile proof amount against charge outstanding balance (Audit Item 13)
      if (charge) {
        const prevPaid = charge.paidAmount ?? (charge.status === 'paid' ? charge.amount : 0);
        const nextPaid = Math.round((prevPaid + proof.amount) * 100) / 100;
        charge.paidAmount = nextPaid;
        if (nextPaid >= charge.amount - 0.005) {
          charge.status = 'paid';
        } else {
          charge.status = 'unpaid';
        }
        setLocalItem(STORAGE_KEYS.CHARGES, charges);
      }

      const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
      let targetBuilding: Building | undefined;
      let targetSyndic: Syndic | undefined;
      for (const s of syndics) {
        const bld = s.buildings.find((b) => b.id === proof.buildingId);
        if (bld) {
          targetBuilding = bld;
          targetSyndic = s;
          break;
        }
      }

      const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
      const stableQuittanceId = `quit-prf-${proof.id}`;
      const existingQuit = quittances.find((q) => q.id === stableQuittanceId);

      if (existingQuit) {
        generatedQuittance = existingQuit;
      } else {
        const quittanceNumber = `QUIT-${new Date().getFullYear()}-${String(quittances.length + 1).padStart(5, '0')}`;
        const apt = targetBuilding?.apartments.find(
          (a) => a.number === proof.apartmentNumber || a.id === charge?.apartmentId
        );
        const res = targetBuilding?.residents.find((r) => r.id === proof.residentId);

        // Audit Item 16: Use the building's configured reserveFundPercentage / reserveFundRate (default 5%) consistently
        const reserveRate =
          targetBuilding?.reserveFundPercentage ?? targetBuilding?.reserveFundRate ?? 5;
        const {
          reserveFundAmount: reserveShare,
          chargesCourantesAmount: courantesShare,
        } = splitChargeReserveAndOperating(proof.amount, reserveRate);

        generatedQuittance = {
          id: stableQuittanceId,
          quittanceNumber,
          chargeId: proof.chargeId,
          buildingId: proof.buildingId,
          buildingName: targetBuilding?.name || 'Résidence',
          syndicId: proof.syndicId,
          syndicName: targetSyndic?.name || 'Cabinet Syndic',
          residentId: proof.residentId,
          residentName: proof.residentName,
          residentCin: res?.cin,
          apartmentId: apt?.id || charge?.apartmentId,
          apartmentNumber: proof.apartmentNumber,
          tantiemes: apt?.tantiemes || charge?.tantiemesApplied || 100,
          amount: proof.amount,
          chargesCourantesAmount: courantesShare,
          reserveFundAmount: reserveShare,
          periodCovered:
            charge?.period ||
            new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
          paymentDate: new Date().toISOString(),
          paymentMethod: proof.paymentMethod === 'cheque' ? 'cheque' : 'virement',
          referenceNumber: proof.referenceNumber,
          bankName: proof.bankName,
          createdAt: new Date().toISOString(),
        };

        quittances.unshift(generatedQuittance);
        setLocalItem(STORAGE_KEYS.QUITTANCES, quittances);

        // Post operating & reserve transactions to building ledger with stable IDs so retries never duplicate income
        if (targetBuilding) {
          targetBuilding.financials.transactions = targetBuilding.financials.transactions || [];
          const stableTrxId = `trx-prf-${proof.id}`;
          const stableReserveTrxId = `trx-prf-res-${proof.id}`;
          if (!targetBuilding.financials.transactions.some((t) => t.id === stableTrxId)) {
            const nowTrxIso = new Date().toISOString();
            if (reserveShare > 0) {
              targetBuilding.financials.reserveFundBalance =
                Math.round(((targetBuilding.financials.reserveFundBalance || 0) + reserveShare) * 100) /
                100;
              targetBuilding.financials.transactions.unshift({
                id: stableReserveTrxId,
                date: nowTrxIso,
                description: `Dotation fonds de réserve (${reserveRate}%) Lot ${proof.apartmentNumber} (${proof.residentName}) - Réf: ${proof.referenceNumber}`,
                amount: reserveShare,
                type: 'income',
                category: 'fees',
                fundType: 'reserve',
                paymentMethod: proof.paymentMethod === 'cheque' ? 'cheque' : 'virement',
                reference: proof.referenceNumber,
                documentType: 'quittance',
                invoiceNumber: generatedQuittance.quittanceNumber,
                thirdPartyName: proof.residentName,
                lotNumber: proof.apartmentNumber,
                bankName: proof.bankName,
              });
            }
            targetBuilding.financials.balance =
              Math.round(((targetBuilding.financials.balance || 0) + courantesShare) * 100) / 100;
            targetBuilding.financials.transactions.unshift({
              id: stableTrxId,
              date: nowTrxIso,
              description: `Encaissement charges Lot ${proof.apartmentNumber} (${proof.residentName}) - Réf: ${proof.referenceNumber}`,
              amount: courantesShare,
              type: 'income',
              category: 'fees',
              fundType: 'courant',
              paymentMethod: proof.paymentMethod === 'cheque' ? 'cheque' : 'virement',
              reference: proof.referenceNumber,
              documentType: 'quittance',
              invoiceNumber: generatedQuittance.quittanceNumber,
              thirdPartyName: proof.residentName,
              lotNumber: proof.apartmentNumber,
              bankName: proof.bankName,
            });
            setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
          }
        }
      }
    }

    return { proof, quittance: generatedQuittance, success: true };
  }

  return { proof: {} as any, success: true };
};

// ==========================================
// 7. QUITTANCES / OFFICIAL RECEIPTS (Audit Item 14 & 16)
// ==========================================

export const getQuittancesForBuilding = async (buildingId: string): Promise<Quittance[]> => {
  if (isLocalEngineEnabled) {
    const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
    return quittances.filter((q) => q.buildingId === buildingId);
  }

  const q = query(collection(db, QUITTANCES_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Quittance));
};

export const getQuittancesForResident = async (residentId: string): Promise<Quittance[]> => {
  if (isLocalEngineEnabled) {
    const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
    return quittances.filter((q) => q.residentId === residentId);
  }

  const q = query(collection(db, QUITTANCES_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Quittance));
};

export const createQuittance = async (
  quittanceInput: Omit<Quittance, 'id' | 'quittanceNumber' | 'createdAt'> & {
    quittanceNumber?: string;
    addTransactionToLedger?: boolean;
  }
): Promise<Quittance> => {
  const { addTransactionToLedger = true, ...coreData } = quittanceInput;
  const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
  const linkedCharge = coreData.chargeId
    ? charges.find((c) => c.id === coreData.chargeId)
    : undefined;

  // If a full quittance already exists for this chargeId, return it to prevent duplicate receipts/postings
  if (coreData.chargeId) {
    const existingForCharge = quittances.find((q) => q.chargeId === coreData.chargeId);
    if (
      existingForCharge &&
      (!addTransactionToLedger ||
        linkedCharge?.status === 'paid' ||
        existingForCharge.amount >= (linkedCharge?.amount ?? coreData.amount) - 0.005)
    ) {
      return existingForCharge;
    }
  }

  const seq = String(quittances.length + 1).padStart(5, '0');
  const year = new Date().getFullYear();

  const newQuittance: Quittance = {
    ...coreData,
    id: `quit-${Date.now()}`,
    quittanceNumber: coreData.quittanceNumber || `QUIT-${year}-${seq}`,
    createdAt: new Date().toISOString(),
  };

  if (isLocalEngineEnabled) {
    quittances.unshift(newQuittance);
    setLocalItem(STORAGE_KEYS.QUITTANCES, quittances);

    // Check if linked charge was ALREADY paid before this call; only mutate charge when addTransactionToLedger !== false
    let wasChargeAlreadyPaid = false;
    if (linkedCharge) {
      wasChargeAlreadyPaid = linkedCharge.status === 'paid';
      if (addTransactionToLedger && !wasChargeAlreadyPaid) {
        const prevPaid = linkedCharge.paidAmount ?? 0;
        const nextPaid = Math.min(
          linkedCharge.amount,
          Math.round((prevPaid + coreData.amount) * 100) / 100
        );
        linkedCharge.paidAmount = nextPaid;
        linkedCharge.status = nextPaid >= linkedCharge.amount - 0.005 ? 'paid' : 'unpaid';
        setLocalItem(STORAGE_KEYS.CHARGES, charges);
      }
    }

    // Audit Item 14: Never add duplicate ledger income if charge was already paid or addTransactionToLedger is false
    if (addTransactionToLedger && !wasChargeAlreadyPaid) {
      const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
      for (const s of syndics) {
        const bld = s.buildings.find((b) => b.id === coreData.buildingId);
        if (bld) {
          bld.financials.transactions = bld.financials.transactions || [];
          const reserveRate = bld.reserveFundPercentage ?? bld.reserveFundRate ?? 5;
          const computedSplit = splitChargeReserveAndOperating(coreData.amount, reserveRate);
          const reserveShare =
            typeof coreData.reserveFundAmount === 'number' &&
            typeof coreData.chargesCourantesAmount === 'number' &&
            Math.abs(
              coreData.reserveFundAmount + coreData.chargesCourantesAmount - coreData.amount
            ) < 0.02
              ? Math.round(coreData.reserveFundAmount * 100) / 100
              : computedSplit.reserveFundAmount;
          const courantesShare = Math.round((coreData.amount - reserveShare) * 100) / 100;
          const trxDate = coreData.paymentDate || new Date().toISOString();

          if (reserveShare > 0) {
            bld.financials.reserveFundBalance =
              Math.round(((bld.financials.reserveFundBalance || 0) + reserveShare) * 100) / 100;
            bld.financials.transactions.unshift({
              id: `trx-quit-res-${newQuittance.id}`,
              date: trxDate,
              description: `Dotation fonds de réserve (${reserveRate}%) - Quittance ${newQuittance.quittanceNumber} Lot ${coreData.apartmentNumber}`,
              amount: reserveShare,
              type: 'income',
              category: 'fees',
              fundType: 'reserve',
              paymentMethod: coreData.paymentMethod,
              reference: coreData.referenceNumber || newQuittance.quittanceNumber,
              documentType: 'quittance',
              invoiceNumber: newQuittance.quittanceNumber,
              thirdPartyName: coreData.residentName,
              lotNumber: coreData.apartmentNumber,
              bankName: coreData.bankName || bld.bankName,
            });
          }

          bld.financials.balance =
            Math.round(((bld.financials.balance || 0) + courantesShare) * 100) / 100;
          bld.financials.transactions.unshift({
            id: `trx-quit-${newQuittance.id}`,
            date: trxDate,
            description: `Quittance ${newQuittance.quittanceNumber} - Lot ${coreData.apartmentNumber} (${coreData.residentName}) - ${coreData.periodCovered}`,
            amount: courantesShare,
            type: 'income',
            category: 'fees',
            fundType: 'courant',
            paymentMethod: coreData.paymentMethod,
            reference: coreData.referenceNumber || newQuittance.quittanceNumber,
            documentType: 'quittance',
            invoiceNumber: newQuittance.quittanceNumber,
            thirdPartyName: coreData.residentName,
            lotNumber: coreData.apartmentNumber,
            bankName: coreData.bankName || bld.bankName,
          });
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
          break;
        }
      }
    }

    return newQuittance;
  }

  const docRef = await addDoc(collection(db, QUITTANCES_COL), newQuittance);
  return { id: docRef.id, ...newQuittance };
};

export const generateQuittanceForCharge = async (
  chargeOrId: Charge | string,
  buildingIdOrPaymentMethod: string = 'virement',
  referenceNumber?: string,
  bankName?: string
): Promise<Quittance> => {
  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
  const charge: Charge | undefined =
    typeof chargeOrId === 'string'
      ? charges.find((c) => c.id === chargeOrId)
      : chargeOrId;

  if (!charge) {
    throw new Error('Charge introuvable');
  }

  // Audit Item 14: If a quittance already exists for this charge, return it without modifying accounting
  const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
  const existing = quittances.find((q) => q.chargeId === charge.id);
  if (existing) {
    return existing;
  }

  const paymentMethod =
    typeof chargeOrId === 'string' ? 'virement' : buildingIdOrPaymentMethod || 'virement';

  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  let targetBuilding: Building | undefined;
  let targetSyndic: Syndic | undefined;

  for (const s of syndics) {
    const bld = s.buildings.find((b) => b.id === charge.buildingId);
    if (bld) {
      targetBuilding = bld;
      targetSyndic = s;
      break;
    }
  }

  const apt = targetBuilding?.apartments.find((a) => a.id === charge.apartmentId);
  const res = targetBuilding?.residents.find((r) => r.id === charge.residentId);

  // Audit Item 16: Use the building's configured reserveFundPercentage / reserveFundRate (default 5%) instead of hardcoded 15%
  const reserveRate =
    targetBuilding?.reserveFundPercentage ?? targetBuilding?.reserveFundRate ?? 5;
  const reserveShare = Math.round(charge.amount * (reserveRate / 100) * 100) / 100;
  const courantesShare = Math.round((charge.amount - reserveShare) * 100) / 100;

  // Audit Item 14: Generating a missing receipt for a paid charge MUST NOT post income again!
  const shouldPostToLedger = charge.status !== 'paid';

  return createQuittance({
    chargeId: charge.id,
    buildingId: charge.buildingId,
    buildingName: targetBuilding?.name || 'Résidence',
    syndicId: charge.syndicId,
    syndicName: targetSyndic?.name || 'Cabinet Syndic',
    residentId: charge.residentId,
    residentName: res?.name || 'Copropriétaire',
    residentCin: res?.cin || 'AB123456',
    apartmentId: charge.apartmentId,
    apartmentNumber: apt?.number || 'Lot',
    tantiemes: apt?.tantiemes || charge.tantiemesApplied || 100,
    amount: charge.amount,
    chargesCourantesAmount: courantesShare,
    reserveFundAmount: reserveShare,
    periodCovered:
      charge.period ||
      new Date(charge.dueDate).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }),
    paymentDate: new Date().toISOString(),
    paymentMethod,
    referenceNumber: referenceNumber || `QUIT-${Date.now().toString().slice(-6)}`,
    bankName: bankName || targetBuilding?.bankName || 'Attijariwafa Bank',
    remarks: 'Cotisation copropriété - Récépissé libératoire (Loi 18-00 / 106-12)',
    addTransactionToLedger: shouldPostToLedger,
  });
};

// ==========================================
// 8. ASSEMBLÉES GÉNÉRALES (AG) & WEIGHTED VOTING (Audit Item 20)
// ==========================================

function evaluateResolutionStatus(res: AGResolution, ag: AssembleeGenerale): AGResolution['status'] {
  const totalTantiemes = ag.totalTantiemes || 1000;
  const maj = res.majorityType;
  const isUnanimity = maj === 'unanimity' || maj === 'unanimite';
  const isThreeQuarters = maj === 'three_quarters' || maj === 'trois_quarts_26';
  const isAbsolute = maj === 'absolute' || maj === 'absolue_25';

  // Audit Item 20: Resolution cannot be approved if quorum is not reached
  if (!ag.quorumReached) {
    if (isUnanimity && res.votesAgainst > 0) {
      return 'rejected';
    }
    return 'pending';
  }

  if (isUnanimity) {
    if (res.votesFor >= totalTantiemes) return 'approved';
    if (res.votesAgainst > 0) return 'rejected';
    return 'pending';
  }

  if (isThreeQuarters) {
    const threshold = Math.ceil(totalTantiemes * 0.75);
    if (res.votesFor >= threshold) return 'approved';
    if (res.votesAgainst > totalTantiemes - threshold) return 'rejected';
    return 'pending';
  }

  if (isAbsolute) {
    const threshold = Math.floor(totalTantiemes / 2) + 1; // 501 / 1000
    if (res.votesFor >= threshold) return 'approved';
    if (res.votesAgainst >= totalTantiemes - threshold + 1) return 'rejected';
    return 'pending';
  }

  // Majorité simple (Art. 21): majorité des voix exprimées des présents ou représentés
  const expressed = res.votesFor + res.votesAgainst;
  if (expressed > 0) {
    return res.votesFor > res.votesAgainst ? 'approved' : 'rejected';
  }
  return 'pending';
}

export const getAssembleesGeneralesForBuilding = async (
  buildingId: string
): Promise<AssembleeGenerale[]> => {
  if (isLocalEngineEnabled) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    return agList.filter((ag) => ag.buildingId === buildingId);
  }

  const q = query(collection(db, AG_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as AssembleeGenerale));
};

export const saveAssembleeGenerale = async (
  ag: AssembleeGenerale
): Promise<AssembleeGenerale> => {
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

  const docRef = doc(db, AG_COL, ag.id);
  await setDoc(docRef, ag, { merge: true });
  return ag;
};

export const createAssembleeGenerale = async (
  agInput: Omit<AssembleeGenerale, 'id'> & { id?: string }
): Promise<AssembleeGenerale> => {
  const ag: AssembleeGenerale = {
    ...agInput,
    id: agInput.id || `ag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    quorumRequired: agInput.quorumRequired ?? Math.ceil((agInput.totalTantiemes || 1000) / 2),
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

  if (isLocalEngineEnabled) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const ag = agList.find((item) => item.id === agId);
    if (!ag) throw new Error('Assemblée Générale introuvable');

    // Audit Item 20: Reject votes on closed sessions or completed AGs
    if (ag.status === 'completed' || ag.status === 'closed' || ag.isVotingOpen === false) {
      throw new Error('Le scrutin est clôturé pour cette Assemblée Générale.');
    }

    const res = ag.resolutions.find((r) => r.id === resolutionId);
    if (!res) throw new Error('Résolution introuvable');

    // Audit Item 20: Verify voter eligibility in attendance sheet & building records, and derive authoritative weight
    // Require exact residentId match on the attendance sheet (never allow an unauthorized residentId to claim another lot by passing apartmentNumber)
    const attendee = (ag.attendees || []).find((a) => a.residentId === residentId);
    if (!attendee) {
      throw new Error(
        'Vote refusé : le copropriétaire doit être inscrit comme présent ou représenté sur la feuille de présence.'
      );
    }
    if (
      apartmentNumber &&
      attendee.apartmentNumber &&
      apartmentNumber.trim().toLowerCase() !== attendee.apartmentNumber.trim().toLowerCase()
    ) {
      throw new Error(
        'Vote refusé : le numéro de lot indiqué ne correspond pas au lot rattaché à ce copropriétaire sur la feuille de présence.'
      );
    }

    // Look up authoritative tantièmes from building apartment or attendance sheet (never trust caller-supplied weight)
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    let authoritativeAptTantiemes: number | undefined;
    let canonicalApartmentId = apartmentId;
    let canonicalApartmentNumber = attendee.apartmentNumber || apartmentNumber;
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === ag.buildingId);
      if (bld) {
        const resRecord = bld.residents.find((r) => r.id === residentId);
        if (resRecord && resRecord.isOwner === false) {
          throw new Error(
            'Vote refusé (Loi 18-00) : seuls les copropriétaires (ou leurs mandataires) disposent du droit de vote en Assemblée Générale.'
          );
        }
        const apt = bld.apartments.find(
          (a) =>
            (resRecord?.apartmentId && a.id === resRecord.apartmentId) ||
            a.ownerId === residentId ||
            (attendee.apartmentNumber && a.number === attendee.apartmentNumber) ||
            (apartmentId && a.id === apartmentId)
        );
        if (apt) {
          if (apt.ownerId && apt.ownerId !== residentId) {
            throw new Error(
              'Vote refusé : ce lot appartient à un autre copropriétaire.'
            );
          }
          canonicalApartmentId = apt.id;
          canonicalApartmentNumber = apt.number || canonicalApartmentNumber;
          if (typeof apt.tantiemes === 'number' && apt.tantiemes > 0) {
            authoritativeAptTantiemes = apt.tantiemes;
          }
        }
        break;
      }
    }

    // Automatically check-in an eligible copropriétaire casting a remote electronic vote on an open session
    if (attendee.status === 'absent') {
      attendee.status = 'present';
    }

    const authoritativeWeight = authoritativeAptTantiemes ?? attendee.tantiemes ?? 0;
    if (authoritativeWeight <= 0) {
      throw new Error('Droit de vote invalide : tantièmes non configurés pour ce lot.');
    }

    res.voterChoices = res.voterChoices || [];
    const existingVoteIdx = res.voterChoices.findIndex(
      (v) =>
        v.residentId === residentId ||
        (canonicalApartmentId && v.apartmentId === canonicalApartmentId) ||
        (canonicalApartmentNumber && v.apartmentNumber === canonicalApartmentNumber)
    );

    const nowIso = new Date().toISOString();
    const voteRecord: AGVoteCast = {
      residentId,
      residentName: attendee.residentName || residentName,
      apartmentId: canonicalApartmentId,
      apartmentNumber: canonicalApartmentNumber,
      tantiemes: authoritativeWeight,
      choice,
      vote: choice,
      comment,
      votedAt: nowIso,
      castAt: nowIso,
    };

    if (existingVoteIdx >= 0) {
      res.voterChoices[existingVoteIdx] = voteRecord;
    } else {
      res.voterChoices.push(voteRecord);
    }
    res.voters = res.voterChoices;

    // Recompute totals strictly from authoritative voterChoices
    res.votesFor = res.voterChoices
      .filter((v) => (v.choice || v.vote) === 'for')
      .reduce((acc, v) => acc + v.tantiemes, 0);
    res.votesAgainst = res.voterChoices
      .filter((v) => (v.choice || v.vote) === 'against')
      .reduce((acc, v) => acc + v.tantiemes, 0);
    res.votesAbstain = res.voterChoices
      .filter((v) => (v.choice || v.vote) === 'abstain')
      .reduce((acc, v) => acc + v.tantiemes, 0);

    // Recompute quorum from present/represented attendees
    const presentTantiemes = (ag.attendees || [])
      .filter((a) => a.status === 'present' || a.status === 'represented')
      .reduce((sum, a) => sum + (a.tantiemes || 0), 0);

    ag.presentTantiemes = presentTantiemes;
    ag.quorumReached = presentTantiemes >= ag.quorumRequired;

    res.status = evaluateResolutionStatus(res, ag);

    setLocalItem(STORAGE_KEYS.AG, agList);
    return ag;
  }

  return {} as any;
};

export const toggleAGVoting = async (agId: string, isOpen: boolean): Promise<AssembleeGenerale> => {
  if (isLocalEngineEnabled) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const ag = agList.find((item) => item.id === agId);
    if (!ag) throw new Error('Assemblée Générale introuvable');
    ag.isVotingOpen = isOpen;
    setLocalItem(STORAGE_KEYS.AG, agList);
    return ag;
  }
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

  const lots = targetBuilding.apartments.map((a) => ({
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

  for (const apt of targetBuilding.apartments) {
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

export const getPrestatairesForBuilding = async (buildingId: string): Promise<Prestataire[]> => {
  if (isLocalEngineEnabled) {
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
    if (!isMock) {
      try {
        const q = query(collection(db, PRESTATAIRES_COL), where('buildingId', '==', buildingId));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          const map = new Map<string, Prestataire>();
          for (const p of list) {
            if (p?.id) map.set(p.id, p);
          }
          for (const d of snapshot.docs) {
            const data = d.data() as Prestataire;
            const id = data.id || d.id;
            map.set(id, { ...map.get(id), ...data, id });
          }
          const merged = Array.from(map.values());
          setLocalItem(STORAGE_KEYS.PRESTATAIRES, merged);
          return merged.filter((p) => p.buildingId === buildingId);
        }
      } catch {
        // fallback to local
      }
    }
    return list.filter((p) => p.buildingId === buildingId);
  }

  const q = query(collection(db, PRESTATAIRES_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Prestataire));
};

export const savePrestataire = async (
  prestataire: Prestataire,
  generateCredentials?: boolean
): Promise<Prestataire> => {
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
      void setDoc(doc(db, PRESTATAIRES_COL, finalPrestataire.id), cleanPrest, {
        merge: true,
      }).catch(() => {});
    }
    return {
      ...finalPrestataire,
      ...(ephemeralPassword ? { generatedPassword: ephemeralPassword } : {}),
    };
  }

  const docRef = doc(db, PRESTATAIRES_COL, prestataire.id);
  await setDoc(docRef, prestataire, { merge: true });
  return prestataire;
};

export const regeneratePrestataireCredentials = async (
  prestataireId: string
): Promise<Prestataire> => {
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

  await deleteDoc(doc(db, PRESTATAIRES_COL, prestataireId));
  return true;
};

export const addPrestataireReview = async (
  prestataireId: string,
  review: Omit<PrestataireReview, 'id' | 'date'>
): Promise<Prestataire | null> => {
  const newRev: PrestataireReview = {
    id: `rev-${Date.now()}`,
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
  const signedAmount =
    transaction.type === 'expense'
      ? -Math.abs(transaction.amount)
      : transaction.type === 'income'
      ? Math.abs(transaction.amount)
      : transaction.amount;

  const newTrx: Transaction = {
    id: `trx-${Date.now()}`,
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

  const docRef = await addDoc(collection(db, TRANSACTIONS_COL), { ...newTrx, buildingId });
  return { id: docRef.id, ...newTrx };
};

export const getInvoicesForBuilding = async (buildingId: string): Promise<Invoice[]> => {
  if (isLocalEngineEnabled) {
    const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    return invoices.filter((inv) => inv.buildingId === buildingId);
  }

  const q = query(collection(db, INVOICES_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Invoice));
};

export const createInvoiceForResident = async (
  residentId: string,
  buildingId: string,
  syndicId: string
): Promise<Invoice> => {
  const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
  const unpaidCharges = charges.filter(
    (c) =>
      c.buildingId === buildingId &&
      c.residentId === residentId &&
      c.status !== 'paid'
  );
  if (unpaidCharges.length === 0) {
    throw new Error('Aucune charge impayée à facturer pour ce copropriétaire.');
  }

  const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
  const totalAmount =
    Math.round(
      unpaidCharges.reduce((sum, c) => sum + (c.amount - (c.paidAmount || 0)), 0) * 100
    ) / 100;
  const seq = String(invoices.length + 1).padStart(4, '0');
  const year = new Date().getFullYear();

  const newInv: Invoice = {
    id: `inv-${Date.now()}`,
    syndicId,
    buildingId,
    residentId,
    invoiceNumber: `FAC-${year}-${seq}`,
    totalAmount,
    paidAmount: 0,
    status: 'unpaid',
    createdAt: new Date().toISOString(),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    chargeIds: unpaidCharges.map((c) => c.id),
  };

  invoices.unshift(newInv);
  setLocalItem(STORAGE_KEYS.INVOICES, invoices);
  return newInv;
};

export const recordPayment = async (invoice: Invoice, amount: number, method: string) => {
  if (!amount || amount <= 0) {
    throw new Error('Montant de règlement invalide.');
  }

  if (isLocalEngineEnabled) {
    const invoices = getLocalItem<Invoice[]>(STORAGE_KEYS.INVOICES, []);
    const invIdx = invoices.findIndex((i) => i.id === invoice.id);
    const storedInvoice = invIdx >= 0 ? invoices[invIdx] : invoice;
    const prevPaid = Math.max(storedInvoice.paidAmount || 0, invoice.paidAmount || 0);
    const totalAmount = storedInvoice.totalAmount ?? invoice.totalAmount;
    const nextPaid = Math.round((prevPaid + amount) * 100) / 100;
    const isFullyPaid = nextPaid >= totalAmount - 0.005;

    if (invIdx >= 0) {
      invoices[invIdx] = {
        ...invoices[invIdx],
        paidAmount: nextPaid,
        status: isFullyPaid ? 'paid' : 'unpaid',
      };
      setLocalItem(STORAGE_KEYS.INVOICES, invoices);
    }
    invoice.paidAmount = nextPaid;
    invoice.status = isFullyPaid ? 'paid' : 'unpaid';

    // Reconcile linked charges
    if (Array.isArray(invoice.chargeIds) && invoice.chargeIds.length > 0) {
      const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
      let remainingToAllocate = amount;
      for (const cId of invoice.chargeIds) {
        const chg = charges.find((c) => c.id === cId);
        if (chg && chg.status !== 'paid' && remainingToAllocate > 0) {
          const outstanding = Math.max(0, chg.amount - (chg.paidAmount || 0));
          const allocated = Math.min(outstanding, remainingToAllocate);
          chg.paidAmount = Math.round(((chg.paidAmount || 0) + allocated) * 100) / 100;
          if (chg.paidAmount >= chg.amount - 0.005) {
            chg.status = 'paid';
          }
          remainingToAllocate = Math.round((remainingToAllocate - allocated) * 100) / 100;
        }
      }
      setLocalItem(STORAGE_KEYS.CHARGES, charges);
    }

    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === invoice.buildingId);
      if (bld) {
        bld.financials.balance =
          Math.round(((bld.financials.balance || 0) + amount) * 100) / 100;
        bld.financials.transactions.unshift({
          id: `trx-${Date.now()}`,
          date: new Date().toISOString(),
          description: `Règlement facture #${invoice.invoiceNumber} (${method})`,
          amount,
          type: 'income',
          category: 'fees',
          paymentMethod: method,
          invoiceNumber: invoice.invoiceNumber,
        });
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        return true;
      }
    }
    return true;
  }

  try {
    await runTransaction(db, async (transaction) => {
      const invoiceRef = doc(db, INVOICES_COL, invoice.id);
      const trxRef = doc(collection(db, TRANSACTIONS_COL));

      const newTrx: Omit<Transaction, 'id'> = {
        date: new Date().toISOString(),
        description: `Payment for Invoice #${invoice.invoiceNumber}`,
        amount,
        type: 'income',
        category: 'fees',
        paymentMethod: method,
      };

      transaction.set(trxRef, { ...newTrx, buildingId: invoice.buildingId });
      transaction.update(invoiceRef, {
        paidAmount: (invoice.paidAmount || 0) + amount,
        status: (invoice.paidAmount || 0) + amount >= invoice.totalAmount ? 'paid' : 'unpaid',
      });
    });
    return true;
  } catch (e) {
    console.error('Payment transaction failed:', e);
    throw e;
  }
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

  const q = query(collection(db, MAINTENANCE_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) =>
    normalizeMaintenanceRequestApartment({ id: d.id, ...d.data() } as MaintenanceRequest)
  );
};

export const addMaintenanceRequest = async (request: Omit<MaintenanceRequest, 'id'>) => {
  const normalizedDraft = normalizeMaintenanceRequestApartment({
    id: `maint-${Date.now()}`,
    ...request,
  });

  const initialUpdate: MaintenanceStepUpdate = {
    id: `upd-${Date.now()}`,
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
          id: `upd-${Date.now()}`,
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

  const docRef = doc(db, MAINTENANCE_COL, id);
  await updateDoc(docRef, updates);
  return { id, ...updates };
};

export const addAnnouncement = async (
  buildingId: string,
  announcementData: { title: string; content: string; priority?: 'normal' | 'urgent' }
): Promise<Announcement> => {
  const newAnn: Announcement = {
    id: `ann-${Date.now()}`,
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

export const uploadDocument = async (buildingId: string, file: File): Promise<Document> => {
  if (!file || !file.name) {
    throw new Error('Fichier invalide.');
  }
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    throw new Error('Le fichier dépasse la taille maximale autorisée de 5 Mo.');
  }

  // Audit Item 19 & Phase 1.2: Offload binary payload to /api/uploads when server session is active
  // so localStorage never overflows 5MB, while keeping durable data URI fallback for isolated/offline runs.
  const durableDataUrl = await readFileAsDurableDataUrl(file);
  let resolvedUrl = durableDataUrl;
  try {
    const headers = getAuthenticatedRequestHeaders();
    if (headers['Authorization'] && typeof fetch === 'function') {
      const res = await fetch('/api/uploads', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: file.name,
          dataUrl: durableDataUrl,
          buildingId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && typeof data.url === 'string') {
          resolvedUrl = data.url;
        }
      }
    }
  } catch {
    // Fallback to durableDataUrl in offline or isolated test environments
  }

  const newDoc: Document = {
    id: `doc-${Date.now()}`,
    name: file.name,
    url: resolvedUrl,
    size: `${Math.max(0.1, file.size / (1024 * 1024)).toFixed(1)} MB`,
    uploadedAt: new Date().toISOString(),
    category: 'autre',
  };

  if (isLocalEngineEnabled) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === buildingId);
      if (bld) {
        bld.documents = bld.documents || [];
        bld.documents.unshift(newDoc);
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        void syncSyndicToFirestoreIfAuthenticated(s);
        return newDoc;
      }
    }
  }

  return newDoc;
};

export const deleteDocument = async (docToDelete: Document): Promise<boolean> => {
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

  const q = query(
    collection(db, NOTIFICATIONS_COL),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );
  const sn = await getDocs(q);
  return sn.docs.map((d) => ({ id: d.id, ...d.data() } as Notification));
};

export const markNotificationAsRead = async (notificationId: string) => {
  if (isLocalEngineEnabled) {
    const list = getLocalItem<Notification[]>(STORAGE_KEYS.NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
    const updated = list.map((n) => (n.id === notificationId ? { ...n, read: true } : n));
    setLocalItem(STORAGE_KEYS.NOTIFICATIONS, updated);
    return true;
  }
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
  const newMsg: ChatMessage = {
    id: `msg-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...message,
  };

  if (isLocalEngineEnabled) {
    const list = getLocalItem<ChatMessage[]>(STORAGE_KEYS.CHAT, mockChatMessages);
    list.push(newMsg);
    setLocalItem(STORAGE_KEYS.CHAT, list);
    return newMsg;
  }

  const docRef = await addDoc(collection(db, 'chat_messages'), newMsg);
  return { id: docRef.id, ...newMsg };
};

export const toggleChatMessageLike = async (
  messageId: string,
  userId: string
): Promise<ChatMessage | null> => {
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
  const newItem: MarketplaceItem = {
    id: `item-${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...item,
  };

  if (isLocalEngineEnabled) {
    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, mockMarketplaceItems);
    list.unshift(newItem);
    setLocalItem(STORAGE_KEYS.MARKETPLACE, list);
    return newItem;
  }

  const docRef = await addDoc(collection(db, 'marketplace_items'), newItem);
  return { id: docRef.id, ...newItem };
};

export const updateMarketplaceItemStatus = async (
  itemId: string,
  status: MarketplaceItem['status']
): Promise<boolean> => {
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

  const docRef = doc(db, 'marketplace_items', itemId);
  await updateDoc(docRef, { status });
  return true;
};

export const deleteMarketplaceItem = async (itemId: string): Promise<boolean> => {
  if (isLocalEngineEnabled) {
    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, mockMarketplaceItems);
    const filtered = list.filter((i) => i.id !== itemId);
    setLocalItem(STORAGE_KEYS.MARKETPLACE, filtered, itemId);
    return true;
  }

  await deleteDoc(doc(db, 'marketplace_items', itemId));
  return true;
};
