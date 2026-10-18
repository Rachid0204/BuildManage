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
import { auth, db, functions, OperationType, handleFirestoreError } from './config';
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
  AGVoteCast,
  Prestataire,
  PrestataireReview,
  ChatMessage,
  MarketplaceItem,
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

// Keep rich business logic engine active while syncing with shared server & Cloud Firestore
const isMock = true;

// Shared production storage keys (zero mock data)
export const STORAGE_KEYS = {
  SYNDICS: 'syndik_prod_syndics_v1',
  CHARGES: 'syndik_prod_charges_v1',
  PROOFS: 'syndik_prod_proofs_v1',
  QUITTANCES: 'syndik_prod_quittances_v1',
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

export async function pushKeyToSharedServer<T>(
  key: string,
  val: T,
  deletedId?: string
): Promise<T> {
  try {
    const res = await fetch('/api/shared-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: val, deletedId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.ok && data.value !== undefined && data.value !== null) {
        try {
          localStorage.setItem(key, JSON.stringify(data.value));
        } catch {
          // ignore
        }
        return data.value as T;
      }
    }
  } catch {
    // Server endpoint may be unavailable in static preview; localStorage + Firestore remain active
  }
  return val;
}

export async function syncAllSharedStateFromServer(): Promise<Record<string, any> | null> {
  try {
    const res = await fetch('/api/shared-state', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.ok || !data.store) return null;

    const serverStore = data.store as Record<string, any>;
    const trackedKeys = Object.values(STORAGE_KEYS);

    // If the server store was explicitly reset more recently than our local reset marker, clear local keys first
    if (typeof window !== 'undefined' && serverStore.__resetAt) {
      const localResetAt = localStorage.getItem('syndik_prod_last_reset_at');
      if (localResetAt !== serverStore.__resetAt) {
        for (const k of trackedKeys) {
          localStorage.removeItem(k);
        }
        localStorage.setItem('syndik_prod_last_reset_at', String(serverStore.__resetAt));
      }
    }

    for (const key of trackedKeys) {
      const serverVal = serverStore[key];
      if (serverVal !== undefined && serverVal !== null) {
        localStorage.setItem(key, JSON.stringify(serverVal));
      } else {
        const localRaw = localStorage.getItem(key);
        if (localRaw) {
          try {
            const parsed = JSON.parse(localRaw);
            void pushKeyToSharedServer(key, parsed);
          } catch {
            // ignore
          }
        }
      }
    }
    return serverStore;
  } catch {
    return null;
  }
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
    await fetch('/api/shared-state/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
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

// Purge any legacy test/mock keys in browser and run initial sync
if (typeof window !== 'undefined') {
  for (const oldKey of LEGACY_TEST_KEYS) {
    localStorage.removeItem(oldKey);
  }
  void syncAllSharedStateFromServer();
}

// Helper to get or initialize local storage item
function getLocalItem<T>(key: string, defaultVal: T): T {
  try {
    const item = localStorage.getItem(key);
    if (!item) {
      localStorage.setItem(key, JSON.stringify(defaultVal));
      void pushKeyToSharedServer(key, defaultVal);
      return defaultVal;
    }
    return JSON.parse(item) as T;
  } catch (e) {
    console.error(`Error reading ${key} from localStorage:`, e);
    return defaultVal;
  }
}

function setLocalItem<T>(key: string, val: T, deletedId?: string): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    void pushKeyToSharedServer(key, val, deletedId);
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
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;

  const payload = {
    id: String(syndic.id).slice(0, 128),
    name: String(syndic.name || 'Cabinet Syndic').slice(0, 200),
    email: String(syndic.email || user.email || 'contact@syndik.ma').slice(0, 254),
    ...(syndic.phone ? { phone: String(syndic.phone).slice(0, 40) } : {}),
    subscriptionPlan: ['starter', 'professional', 'enterprise'].includes(syndic.subscriptionPlan)
      ? syndic.subscriptionPlan
      : 'professional',
    subscriptionStatus: ['active', 'expired', 'cancelled'].includes(syndic.subscriptionStatus)
      ? syndic.subscriptionStatus
      : 'active',
    ...(syndic.subscriptionExpiry
      ? { subscriptionExpiresAt: String(syndic.subscriptionExpiry).slice(0, 64) }
      : {}),
    createdBy: String(syndic.createdBy || user.uid).replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 128),
    buildings: Array.isArray(syndic.buildings) ? syndic.buildings.slice(0, 50) : [],
  };

  try {
    await setDoc(doc(db, SYNDICS_COL, payload.id), payload);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
      try {
        handleFirestoreError(error, OperationType.WRITE, `${SYNDICS_COL}/${payload.id}`);
      } catch {
        // Logged structured FirestoreErrorInfo; keep UI flow uninterrupted
      }
    }
  }
}

// ==========================================
// 1. SYNDIC & TENANT DATA
// ==========================================

export const getSyndics = async (): Promise<Syndic[]> => {
  await syncAllSharedStateFromServer();
  const localSyndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);

  // If authenticated with Firebase Auth, also merge any Syndic records from Cloud Firestore
  const user = auth.currentUser;
  if (user && user.emailVerified) {
    try {
      const q =
        user.email === 'wahbi.rachid@gmail.com'
          ? query(collection(db, SYNDICS_COL))
          : query(collection(db, SYNDICS_COL), where('createdBy', '==', user.uid));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const mergedMap = new Map<string, Syndic>();
        for (const s of localSyndics) {
          mergedMap.set(s.id, s);
        }
        for (const docSnap of snapshot.docs) {
          const data = docSnap.data() as any;
          const existing = mergedMap.get(docSnap.id);
          const firestoreSyndic: Syndic = {
            ...existing,
            ...data,
            id: docSnap.id,
            subscriptionExpiry:
              data.subscriptionExpiresAt ||
              data.subscriptionExpiry ||
              existing?.subscriptionExpiry ||
              new Date(Date.now() + 365 * 86400000).toISOString(),
            buildings:
              Array.isArray(data.buildings) && data.buildings.length > 0
                ? data.buildings
                : existing?.buildings || [],
          };
          mergedMap.set(docSnap.id, firestoreSyndic);
        }
        const mergedList = Array.from(mergedMap.values());
        setLocalItem(STORAGE_KEYS.SYNDICS, mergedList);
        return mergedList;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Missing or insufficient permissions')) {
        try {
          handleFirestoreError(error, OperationType.LIST, SYNDICS_COL);
        } catch {
          // continue with shared server + local state
        }
      }
    }
  }

  return localSyndics;
};

export const saveSyndic = async (syndic: Syndic): Promise<Syndic> => {
  const validation = SyndicSchema.safeParse(syndic);
  if (!validation.success) {
    console.warn('Syndic validation warning:', validation.error.message);
  }

  await syncAllSharedStateFromServer();
  const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
  const index = syndics.findIndex((s) => s.id === syndic.id);
  let savedSyndic: Syndic;
  if (index >= 0) {
    savedSyndic = {
      ...syndics[index],
      ...syndic,
      buildings:
        Array.isArray(syndic.buildings) && syndic.buildings.length > 0
          ? syndic.buildings
          : syndics[index].buildings || [],
    };
    syndics[index] = savedSyndic;
  } else {
    savedSyndic = {
      ...syndic,
      buildings: Array.isArray(syndic.buildings) ? syndic.buildings : [],
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
  const syndic = syndics.find((s) => s.id === syndicId) || syndics[0];
  if (!syndic) throw new Error('Syndic not found');

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
    monthlyFees: apt.monthlyFees || coreBuilding.monthlySyndicFees,
    tantiemes:
      apt.tantiemes ||
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
    reserveFundRate: coreBuilding.reserveFundRate ?? 5,
    bankName: coreBuilding.bankName,
    bankRib: coreBuilding.bankRib,
    managerName: coreBuilding.managerName,
    managerPhone: coreBuilding.managerPhone,
    residents: [],
    apartments: generatedApts,
    announcements: [],
    documents: [],
    financials: { balance: 0, transactions: [] },
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
  if (isMock) {
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
  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const idx = syndic.buildings.findIndex((b) => b.id === buildingId);
      if (idx >= 0) {
        syndic.buildings.splice(idx, 1);
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
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

  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === apartmentData.buildingId);
      if (bld) {
        const newApt: Apartment = {
          id: `apt-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          ...apartmentData,
          tantiemes: apartmentData.tantiemes ?? 100,
          coproType: apartmentData.coproType ?? 'apartment',
        };
        bld.apartments.push(newApt);

        // Sync resident apartmentId if ownerId or tenantId provided
        if (newApt.ownerId) {
          const owner = bld.residents.find((r) => r.id === newApt.ownerId);
          if (owner) owner.apartmentId = newApt.id;
        }
        if (newApt.tenantId) {
          const tenant = bld.residents.find((r) => r.id === newApt.tenantId);
          if (tenant) tenant.apartmentId = newApt.id;
        }

        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
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

  if (isMock) {
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
          if (existingNumbers.has(normalizedNum)) return; // Skip duplicates
          existingNumbers.add(normalizedNum);

          const newApt: Apartment = {
            id: `apt-${baseTimestamp}-${idx}`,
            buildingId,
            number: aptData.number.trim(),
            floor: Number(aptData.floor) || 0,
            area: Number(aptData.area) || 60,
            monthlyFees: Number(aptData.monthlyFees) || bld.monthlySyndicFees,
            tantiemes: Number(aptData.tantiemes) || 100,
            coproType: aptData.coproType || 'apartment',
            ownerId: aptData.ownerId || null,
            tenantId: aptData.tenantId || null,
          };
          bld.apartments.push(newApt);
          createdApartments.push(newApt);
        });

        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
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
  if (isMock) {
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

  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === apartment.buildingId);
      if (bld) {
        const idx = bld.apartments.findIndex((a) => a.id === apartment.id);
        if (idx >= 0) {
          const prevApt = bld.apartments[idx];
          bld.apartments[idx] = { ...prevApt, ...apartment };

          // Bidirectional sync with residents
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
  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      for (const bld of syndic.buildings) {
        const idx = bld.apartments.findIndex((a) => a.id === apartmentId);
        if (idx >= 0) {
          bld.apartments.splice(idx, 1);
          // Unlink any resident pointing to this deleted apartment
          bld.residents.forEach((res) => {
            if (res.apartmentId === apartmentId) {
              const fallbackApt = bld.apartments.find(
                (a) => a.ownerId === res.id || a.tenantId === res.id
              );
              res.apartmentId = fallbackApt?.id || undefined;
            }
          });
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
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
// 4. RESIDENTS & AUTOMATIC CREDENTIALS
// ==========================================

export interface ResidentAccountRecord {
  residentId: string;
  email: string;
  password: string;
  name: string;
  isOwner: boolean;
  syndicId: string;
  buildingId: string;
  apartmentId?: string;
  createdAt: string;
  mustChangePassword?: boolean;
}

const RESIDENT_ACCOUNTS_KEY = STORAGE_KEYS.RESIDENT_ACCOUNTS;

function generateTempPassword(name: string): string {
  const cleanPrefix =
    name
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 4)
      .toUpperCase() || 'RES';
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `Syndik-${cleanPrefix}${digits}!`;
}

function saveResidentCredentialAccount(resident: Resident, password: string): ResidentAccountRecord {
  const accounts = getLocalItem<ResidentAccountRecord[]>(RESIDENT_ACCOUNTS_KEY, []);
  const record: ResidentAccountRecord = {
    residentId: resident.id,
    email: resident.email.trim(),
    password,
    name: resident.name,
    isOwner: resident.isOwner,
    syndicId: resident.syndicId,
    buildingId: resident.buildingId,
    apartmentId: resident.apartmentId,
    createdAt: resident.credentialsCreatedAt || new Date().toISOString(),
    mustChangePassword: resident.mustChangePassword ?? true,
  };
  const existingIdx = accounts.findIndex(
    (a) => a.residentId === resident.id || a.email.toLowerCase() === resident.email.toLowerCase()
  );
  if (existingIdx >= 0) {
    accounts[existingIdx] = record;
  } else {
    accounts.push(record);
  }
  setLocalItem(RESIDENT_ACCOUNTS_KEY, accounts);
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

  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      const bld = syndic.buildings.find((b) => b.id === cleanedData.buildingId);
      if (bld) {
        const nowIso = new Date().toISOString();
        const password = generateCredentials ? generateTempPassword(cleanedData.name) : undefined;
        const newResident: Resident = {
          id: `res-${Date.now()}`,
          ...cleanedData,
          hasAccount: !!generateCredentials,
          generatedPassword: password,
          credentialsCreatedAt: generateCredentials ? nowIso : undefined,
          credentialsAuditLog: generateCredentials
            ? [{ action: 'generated', timestamp: nowIso }]
            : [],
          mustChangePassword: generateCredentials ? true : undefined,
        };
        bld.residents.push(newResident);

        // Link resident to apartment if apartmentId provided
        if (newResident.apartmentId) {
          const apt = bld.apartments.find((a) => a.id === newResident.apartmentId);
          if (apt) {
            if (newResident.isOwner) {
              apt.ownerId = newResident.id;
            } else {
              apt.tenantId = newResident.id;
            }
          }
        }

        if (generateCredentials && password) {
          saveResidentCredentialAccount(newResident, password);
        }

        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        void syncSyndicToFirestoreIfAuthenticated(syndic);
        return newResident;
      }
    }
  }

  const docRef = await addDoc(collection(db, RESIDENTS_COL), cleanedData);
  return { id: docRef.id, ...cleanedData };
};

export const updateResident = async (resident: Resident): Promise<Resident> => {
  const cleanedResident: Resident = {
    ...resident,
    apartmentId: resident.apartmentId || undefined,
    cin: resident.cin?.trim() || undefined,
  };
  const validation = ResidentSchema.safeParse(cleanedResident);
  if (!validation.success) {
    throw new Error('Invalid Resident Data: ' + validation.error.message);
  }

  if (isMock) {
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

          // Bidirectional sync with apartments
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

          if (mergedResident.hasAccount && mergedResident.generatedPassword) {
            saveResidentCredentialAccount(mergedResident, mergedResident.generatedPassword);
          }

          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
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
  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      for (const bld of syndic.buildings) {
        const idx = bld.residents.findIndex((r) => r.id === residentId);
        if (idx >= 0) {
          const res = bld.residents[idx];
          const nowIso = new Date().toISOString();
          const newPassword = generateTempPassword(res.name);
          const prevLog = Array.isArray(res.credentialsAuditLog) ? res.credentialsAuditLog : [];
          const updated: Resident = {
            ...res,
            hasAccount: true,
            generatedPassword: newPassword,
            credentialsCreatedAt: nowIso,
            credentialsAuditLog: [
              { action: res.hasAccount ? 'regenerated' : 'generated', timestamp: nowIso },
              ...prevLog,
            ].slice(0, 20),
            mustChangePassword: true,
          };
          bld.residents[idx] = updated;
          saveResidentCredentialAccount(updated, newPassword);
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
        const updated: Resident = {
          ...res,
          credentialsSharedAt: nowIso,
          credentialsLastSharedMethod: method,
          credentialsAuditLog: [
            { action: method === 'pdf' ? 'shared_pdf' : 'shared_copy', timestamp: nowIso },
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
  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const syndic of syndics) {
      for (const bld of syndic.buildings) {
        const idx = bld.residents.findIndex((r) => r.id === residentId);
        if (idx >= 0) {
          bld.residents.splice(idx, 1);
          // Clean up apartment owner/tenant refs
          bld.apartments.forEach((apt) => {
            if (apt.ownerId === residentId) apt.ownerId = null;
            if (apt.tenantId === residentId) apt.tenantId = null;
          });
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);

          // Remove stored credentials
          const accounts = getLocalItem<ResidentAccountRecord[]>(RESIDENT_ACCOUNTS_KEY, []);
          setLocalItem(
            RESIDENT_ACCOUNTS_KEY,
            accounts.filter((a) => a.residentId !== residentId)
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
// 5. CHARGES & TANTIÈMES ENGINE
// ==========================================

export const getChargesForBuilding = async (buildingId: string): Promise<Charge[]> => {
  if (isMock) {
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    return charges.filter((c) => c.buildingId === buildingId);
  }

  const q = query(collection(db, CHARGES_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Charge));
};

export const getChargesForResident = async (residentId: string): Promise<Charge[]> => {
  if (isMock) {
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    return charges.filter((c) => c.residentId === residentId);
  }

  const q = query(collection(db, CHARGES_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Charge));
};

export const generateMonthlyCharges = async (
  buildingId: string,
  syndicId: string,
  options?: { useTantiemes?: boolean; periodName?: string; totalMonthlyBudget?: number }
) => {
  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    const syndic = syndics.find((s) => s.id === syndicId);
    const building = syndic?.buildings.find((b) => b.id === buildingId);

    if (!building) throw new Error('Building not found');

    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    const now = new Date();
    const period = options?.periodName || now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 15).toISOString().split('T')[0];

    let createdCount = 0;
    const totalTantiemes = building.totalTantiemes || 1000;
    const totalBudget = options?.totalMonthlyBudget || building.apartments.reduce((acc, a) => acc + (a.monthlyFees || building.monthlySyndicFees), 0);

    for (const apt of building.apartments) {
      const responsibleId = apt.ownerId || apt.tenantId;
      if (!responsibleId) continue;

      // Fee calculation: either by tantièmes share or configured fee
      let calculatedFee = apt.monthlyFees || building.monthlySyndicFees;
      if (options?.useTantiemes && apt.tantiemes) {
        calculatedFee = Math.round((totalBudget * (apt.tantiemes / totalTantiemes)));
      }

      const newCharge: Charge = {
        id: `chg-${Date.now()}-${apt.id}`,
        buildingId,
        apartmentId: apt.id,
        residentId: responsibleId,
        amount: calculatedFee,
        dueDate,
        status: 'pending',
        type: 'courante',
        period,
        description: `Appel de charges ${period} - Lot ${apt.number}`,
        createdAt: new Date().toISOString(),
      };

      charges.unshift(newCharge);
      createdCount++;
    }

    setLocalItem(STORAGE_KEYS.CHARGES, charges);
    return { success: true, count: createdCount };
  }

  // Cloud function in production
  try {
    const generateFn = httpsCallable(functions, 'generateMonthlyCharges');
    const result = await generateFn({ buildingId, syndicId, options });
    return result.data;
  } catch (error) {
    console.error('Error generating charges:', error);
    throw error;
  }
};

// ==========================================
// 6. PAYMENT PROOFS & VALIDATION WORKFLOW
// ==========================================

export const getPaymentProofsForBuilding = async (buildingId: string): Promise<PaymentProof[]> => {
  if (isMock) {
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
    return proofs.filter((p) => p.buildingId === buildingId);
  }

  const q = query(collection(db, PROOFS_COL), where('buildingId', '==', buildingId), orderBy('submissionDate', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentProof));
};

export const getPaymentProofsForResident = async (residentId: string): Promise<PaymentProof[]> => {
  if (isMock) {
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
    return proofs.filter((p) => p.residentId === residentId);
  }

  const q = query(collection(db, PROOFS_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as PaymentProof));
};

export const submitPaymentProof = async (proofData: Omit<PaymentProof, 'id' | 'submissionDate' | 'status'>): Promise<PaymentProof> => {
  const newProof: PaymentProof = {
    id: `proof-${Date.now()}`,
    ...proofData,
    submissionDate: new Date().toISOString(),
    status: 'pending',
  };

  if (isMock) {
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
    proofs.unshift(newProof);
    setLocalItem(STORAGE_KEYS.PROOFS, proofs);

    // Update charge reference
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    const charge = charges.find((c) => c.id === proofData.chargeId);
    if (charge) {
      charge.paymentProofId = newProof.id;
      setLocalItem(STORAGE_KEYS.CHARGES, charges);
    }

    return newProof;
  }

  const docRef = await addDoc(collection(db, PROOFS_COL), newProof);
  return { id: docRef.id, ...newProof };
};

export const reviewPaymentProof = async (
  proofId: string,
  decision: 'approve' | 'reject',
  rejectionReason?: string
): Promise<{ success: boolean; quittance?: Quittance }> => {
  if (isMock) {
    const proofs = getLocalItem<PaymentProof[]>(STORAGE_KEYS.PROOFS, mockPaymentProofs);
    const proof = proofs.find((p) => p.id === proofId);
    if (!proof) throw new Error('Proof not found');

    proof.status = decision === 'approve' ? 'approved' : 'rejected';
    proof.reviewedAt = new Date().toISOString();
    if (decision === 'reject') proof.rejectionReason = rejectionReason;
    setLocalItem(STORAGE_KEYS.PROOFS, proofs);

    // If approved, update charge and issue quittance and add financial transaction!
    if (decision === 'approve') {
      const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
      const charge = charges.find((c) => c.id === proof.chargeId);
      if (charge) {
        charge.status = 'paid';
        charge.paidAt = new Date().toISOString();
        charge.paymentMethod = proof.paymentMethod;
        setLocalItem(STORAGE_KEYS.CHARGES, charges);
      }

      // Find syndic & building
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

      const apartment = targetBuilding?.apartments.find((a) => a.id === proof.apartmentId);

      // Issue Quittance
      const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
      const quittanceCount = quittances.length + 1;
      const quittanceNumber = `QUIT-${new Date().getFullYear()}-${String(quittanceCount).padStart(4, '0')}`;

      const newQuittance: Quittance = {
        id: `quit-${Date.now()}`,
        quittanceNumber,
        chargeId: proof.chargeId,
        residentId: proof.residentId,
        residentName: proof.residentName,
        apartmentId: proof.apartmentId,
        apartmentNumber: proof.apartmentNumber,
        tantiemes: apartment?.tantiemes || 100,
        buildingId: proof.buildingId,
        buildingName: targetBuilding?.name || 'Copropriété',
        syndicId: targetSyndic?.id || 'syndic-1',
        syndicName: targetSyndic?.name || 'Syndic',
        amount: proof.amount,
        paymentMethod: proof.paymentMethod,
        paymentDate: proof.submissionDate,
        periodCovered: charge?.period || 'Charges courantes',
        createdAt: new Date().toISOString(),
      };

      quittances.unshift(newQuittance);
      setLocalItem(STORAGE_KEYS.QUITTANCES, quittances);

      // Add transaction into building ledger and update balance
      if (targetBuilding) {
        const newTrx: Transaction = {
          id: `trx-${Date.now()}`,
          date: new Date().toISOString(),
          description: `Virement reçu - Lot ${proof.apartmentNumber} (${proof.residentName}) - Réf: ${proof.referenceNumber}`,
          amount: proof.amount,
          type: 'income',
          category: 'fees',
          paymentMethod: proof.paymentMethod,
          reference: proof.referenceNumber,
        };
        targetBuilding.financials.balance += proof.amount;
        targetBuilding.financials.transactions.unshift(newTrx);
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
      }

      return { success: true, quittance: newQuittance };
    }

    return { success: true };
  }

  // Live Firestore logic
  const docRef = doc(db, PROOFS_COL, proofId);
  await updateDoc(docRef, {
    status: decision === 'approve' ? 'approved' : 'rejected',
    rejectionReason: rejectionReason || null,
    reviewedAt: new Date().toISOString(),
  });
  return { success: true };
};

// ==========================================
// 7. QUITTANCES
// ==========================================

export const getQuittancesForBuilding = async (buildingId: string): Promise<Quittance[]> => {
  if (isMock) {
    const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
    return quittances.filter((q) => q.buildingId === buildingId);
  }

  const q = query(collection(db, QUITTANCES_COL), where('buildingId', '==', buildingId), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Quittance));
};

export const getQuittancesForResident = async (residentId: string): Promise<Quittance[]> => {
  if (isMock) {
    const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
    return quittances.filter((q) => q.residentId === residentId);
  }

  const q = query(collection(db, QUITTANCES_COL), where('residentId', '==', residentId), orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Quittance));
};

export const createQuittance = async (
  data: Omit<Quittance, 'id' | 'createdAt' | 'quittanceNumber'> & { quittanceNumber?: string; addTransactionToLedger?: boolean }
): Promise<Quittance> => {
  const currentYear = new Date().getFullYear();

  if (isMock) {
    const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
    const quittanceCount = quittances.length + 1;
    const finalNumber = data.quittanceNumber || `QUIT-${currentYear}-${String(quittanceCount).padStart(4, '0')}`;

    const newQuittance: Quittance = {
      id: `quit-${Date.now()}`,
      ...data,
      quittanceNumber: finalNumber,
      createdAt: new Date().toISOString(),
    };

    quittances.unshift(newQuittance);
    setLocalItem(STORAGE_KEYS.QUITTANCES, quittances);

    // Update corresponding charge to paid if linked
    if (data.chargeId) {
      const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
      const charge = charges.find((c) => c.id === data.chargeId);
      if (charge) {
        charge.status = 'paid';
        charge.paidAt = data.paymentDate || new Date().toISOString();
        charge.paymentMethod = data.paymentMethod;
        setLocalItem(STORAGE_KEYS.CHARGES, charges);
      }
    }

    // Optionally record income transaction in building ledger
    if (data.addTransactionToLedger !== false && data.buildingId) {
      const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
      for (const s of syndics) {
        const bld = s.buildings.find((b) => b.id === data.buildingId);
        if (bld) {
          const newTrx: Transaction = {
            id: `trx-${Date.now()}`,
            date: data.paymentDate || new Date().toISOString(),
            description: `Cotisation reçue - Lot ${data.apartmentNumber} (${data.residentName}) - ${data.periodCovered}`,
            amount: data.amount,
            type: 'income',
            category: 'fees',
            paymentMethod: data.paymentMethod,
            reference: data.referenceNumber || newQuittance.quittanceNumber,
            documentType: 'quittance',
          };
          bld.financials.balance += data.amount;
          bld.financials.transactions.unshift(newTrx);
          setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
          break;
        }
      }
    }

    return newQuittance;
  }

  // Live Firestore logic
  const quittanceCount = Date.now().toString().slice(-4);
  const finalNumber = data.quittanceNumber || `QUIT-${currentYear}-${quittanceCount}`;
  const newQuittance: Quittance = {
    id: `quit-${Date.now()}`,
    ...data,
    quittanceNumber: finalNumber,
    createdAt: new Date().toISOString(),
  };

  const docRef = await addDoc(collection(db, QUITTANCES_COL), newQuittance);
  return { id: docRef.id, ...newQuittance };
};

export const generateQuittanceForCharge = async (
  chargeId: string,
  buildingId: string
): Promise<Quittance> => {
  if (isMock) {
    const quittances = getLocalItem<Quittance[]>(STORAGE_KEYS.QUITTANCES, mockQuittances);
    const existing = quittances.find((q) => q.chargeId === chargeId);
    if (existing) return existing;

    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    const charge = charges.find((c) => c.id === chargeId);
    if (!charge) throw new Error('Charge introuvable');

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

    const apt = targetBuilding?.apartments.find((a) => a.id === charge.apartmentId);
    const res = targetBuilding?.residents.find((r) => r.id === charge.residentId);

    const reserveShare = Math.round(charge.amount * 0.15);
    const courantesShare = charge.amount - reserveShare;

    return createQuittance({
      chargeId: charge.id,
      residentId: charge.residentId,
      residentName: res?.name || 'Copropriétaire',
      residentCin: res?.cin || 'AB123456',
      apartmentId: charge.apartmentId,
      apartmentNumber: apt?.number || 'Lot',
      tantiemes: apt?.tantiemes || 100,
      buildingId: buildingId,
      buildingName: targetBuilding?.name || 'Copropriété',
      syndicId: targetSyndic?.id || 'syndic-1',
      syndicName: targetSyndic?.name || 'Syndic',
      amount: charge.amount,
      chargesCourantesAmount: courantesShare,
      reserveFundAmount: reserveShare,
      paymentMethod: charge.paymentMethod || 'virement',
      paymentDate: charge.paidAt || charge.createdAt || new Date().toISOString(),
      periodCovered: charge.period || 'Charges courantes',
      bankName: targetBuilding?.bankName || 'Attijariwafa Bank',
      referenceNumber: `REC-${charge.id.slice(-6)}`,
    });
  }

  // Live Firestore logic fallback
  const q = query(collection(db, QUITTANCES_COL), where('chargeId', '==', chargeId));
  const snapshot = await getDocs(q);
  if (!snapshot.empty) {
    return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Quittance;
  }
  return createQuittance({
    chargeId,
    residentId: 'unknown',
    residentName: 'Copropriétaire',
    apartmentId: 'unknown',
    apartmentNumber: 'Lot',
    tantiemes: 100,
    buildingId,
    buildingName: 'Copropriété',
    syndicId: 'syndic-1',
    syndicName: 'Syndic',
    amount: 0,
    paymentMethod: 'virement',
    paymentDate: new Date().toISOString(),
    periodCovered: 'Charges courantes',
  });
};

// ==========================================
// 8. ASSEMBLÉE GÉNÉRALE (AG) & QUORUM
// ==========================================

export const getAssembleesGeneralesForBuilding = async (buildingId: string): Promise<AssembleeGenerale[]> => {
  if (isMock) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    return agList.filter((ag) => ag.buildingId === buildingId);
  }

  const q = query(collection(db, AG_COL), where('buildingId', '==', buildingId), orderBy('date', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as AssembleeGenerale));
};

export const saveAssembleeGenerale = async (ag: AssembleeGenerale): Promise<AssembleeGenerale> => {
  if (isMock) {
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

export const castResidentAGVote = async (
  agId: string,
  resolutionId: string,
  residentId: string,
  residentName: string,
  apartmentId: string,
  apartmentNumber: string,
  tantiemes: number,
  vote: 'for' | 'against' | 'abstain',
  comment?: string
): Promise<AssembleeGenerale> => {
  if (isMock) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const ag = agList.find((item) => item.id === agId);
    if (!ag) throw new Error('Assemblée Générale introuvable');

    const res = ag.resolutions.find((r) => r.id === resolutionId);
    if (!res) throw new Error('Résolution introuvable');

    if (!res.voters) {
      res.voters = [];
    }

    // Check if resident already voted on this resolution
    const existingIndex = res.voters.findIndex((v) => v.residentId === residentId);
    if (existingIndex >= 0) {
      const oldVote = res.voters[existingIndex];
      // subtract old vote weight
      if (oldVote.vote === 'for') res.votesFor = Math.max(0, res.votesFor - oldVote.tantiemes);
      else if (oldVote.vote === 'against') res.votesAgainst = Math.max(0, res.votesAgainst - oldVote.tantiemes);
      else if (oldVote.vote === 'abstain') res.votesAbstain = Math.max(0, res.votesAbstain - oldVote.tantiemes);

      res.voters[existingIndex] = {
        residentId,
        residentName,
        apartmentId,
        apartmentNumber,
        tantiemes,
        vote,
        castAt: new Date().toISOString(),
        comment,
      };
    } else {
      res.voters.push({
        residentId,
        residentName,
        apartmentId,
        apartmentNumber,
        tantiemes,
        vote,
        castAt: new Date().toISOString(),
        comment,
      });
    }

    // Add new weight based on resident's tantièmes
    if (vote === 'for') res.votesFor += tantiemes;
    else if (vote === 'against') res.votesAgainst += tantiemes;
    else if (vote === 'abstain') res.votesAbstain += tantiemes;

    // Automatically mark resident as present in the attendance sheet
    const attendee = ag.attendees.find((a) => a.residentId === residentId);
    if (attendee && attendee.status === 'absent') {
      attendee.status = 'present';
    }

    // Recalculate present tantiemes and quorum
    const presentTantiemes = ag.attendees
      .filter((a) => a.status === 'present' || a.status === 'represented')
      .reduce((sum, a) => sum + (a.tantiemes || 0), 0);
    ag.presentTantiemes = presentTantiemes;
    ag.quorumReached = presentTantiemes >= ag.quorumRequired;

    // Legal status check under Moroccan Law 18-00
    if (res.majorityType === 'absolute') {
      // Majorité absolue (Art. 22): au moins 501 / 1000 tantièmes de la copropriété
      res.status = res.votesFor >= 501 ? 'approved' : (res.votesAgainst >= 500 ? 'rejected' : 'pending');
    } else if (res.majorityType === 'unanimity') {
      // Unanimité (Art. 23): 1000 / 1000 tantièmes
      res.status = res.votesFor >= (ag.totalTantiemes || 1000) ? 'approved' : (res.votesAgainst > 0 ? 'rejected' : 'pending');
    } else {
      // Majorité simple (Art. 21): majorité des voix exprimées des copropriétaires présents ou représentés
      const expressed = res.votesFor + res.votesAgainst;
      if (expressed > 0) {
        res.status = res.votesFor > res.votesAgainst ? 'approved' : 'rejected';
      }
    }

    setLocalItem(STORAGE_KEYS.AG, agList);
    return ag;
  }

  const docRef = doc(db, AG_COL, agId);
  return {} as any;
};

export const toggleAGVoting = async (agId: string, isOpen: boolean): Promise<AssembleeGenerale> => {
  if (isMock) {
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

  if (isMock) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const ag = agList.find((item) => item.id === agId);
    if (!ag) throw new Error('AG not found');

    const res = ag.resolutions.find((r) => r.id === resolutionId);
    if (res) {
      if (voteType === 'for') res.votesFor += tantiemesWeight;
      else if (voteType === 'against') res.votesAgainst += tantiemesWeight;
      else res.votesAbstain += tantiemesWeight;

      // Check majority
      const quorumMajority = res.majorityType === 'absolute' ? 501 : 350;
      res.status = res.votesFor >= quorumMajority ? 'approved' : 'rejected';
    }

    setLocalItem(STORAGE_KEYS.AG, agList);
    return ag;
  }

  const docRef = doc(db, AG_COL, agId);
  return {} as any;
};

export const updateAGAttendee = async (
  agId: string,
  residentId: string,
  status: 'present' | 'represented' | 'absent',
  proxyHolderName?: string
): Promise<AssembleeGenerale> => {
  if (isMock) {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, mockAssembleesGenerales);
    const ag = agList.find((item) => item.id === agId);
    if (!ag) throw new Error('AG not found');

    const att = ag.attendees.find((a) => a.residentId === residentId);
    if (att) {
      att.status = status;
      if (proxyHolderName) att.proxyHolderName = proxyHolderName;
    }

    // Recompute quorum in real-time based on present/represented tantièmes
    const presentTantiemes = ag.attendees
      .filter((a) => a.status === 'present' || a.status === 'represented')
      .reduce((sum, a) => sum + (a.tantiemes || 0), 0);

    ag.presentTantiemes = presentTantiemes;
    ag.quorumReached = presentTantiemes >= ag.quorumRequired;

    setLocalItem(STORAGE_KEYS.AG, agList);
    return ag;
  }

  return {} as any;
};

// ==========================================
// 9. PRESTATAIRES (SERVICE PROVIDERS) & CREDENTIALS
// ==========================================

export interface PrestataireAccountRecord {
  prestataireId: string;
  email: string;
  password: string;
  name: string;
  contactPerson: string;
  category: Prestataire['category'];
  syndicId: string;
  buildingId: string;
  createdAt: string;
  mustChangePassword?: boolean;
}

const PRESTATAIRE_ACCOUNTS_KEY = STORAGE_KEYS.PRESTATAIRE_ACCOUNTS;

function savePrestataireCredentialAccount(
  prestataire: Prestataire,
  password: string
): PrestataireAccountRecord {
  const accounts = getLocalItem<PrestataireAccountRecord[]>(PRESTATAIRE_ACCOUNTS_KEY, []);
  const record: PrestataireAccountRecord = {
    prestataireId: prestataire.id,
    email: prestataire.email.trim(),
    password,
    name: prestataire.name,
    contactPerson: prestataire.contactPerson,
    category: prestataire.category,
    syndicId: prestataire.syndicId,
    buildingId: prestataire.buildingId,
    createdAt: prestataire.credentialsCreatedAt || new Date().toISOString(),
    mustChangePassword: prestataire.mustChangePassword ?? true,
  };
  const existingIdx = accounts.findIndex(
    (a) =>
      a.prestataireId === prestataire.id ||
      (prestataire.email && a.email.toLowerCase() === prestataire.email.toLowerCase())
  );
  if (existingIdx >= 0) {
    accounts[existingIdx] = record;
  } else {
    accounts.push(record);
  }
  setLocalItem(PRESTATAIRE_ACCOUNTS_KEY, accounts);
  return record;
}

export const getPrestatairesForBuilding = async (buildingId: string): Promise<Prestataire[]> => {
  if (isMock) {
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
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
  if (isMock) {
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
    const index = list.findIndex((p) => p.id === prestataire.id);
    const prev = index >= 0 ? list[index] : undefined;

    let finalPrestataire: Prestataire = {
      ...prev,
      ...prestataire,
    };

    if (generateCredentials && finalPrestataire.email) {
      const nowIso = new Date().toISOString();
      const newPassword =
        finalPrestataire.generatedPassword || generateTempPassword(finalPrestataire.name);
      const prevLog = Array.isArray(finalPrestataire.credentialsAuditLog)
        ? finalPrestataire.credentialsAuditLog
        : [];
      finalPrestataire = {
        ...finalPrestataire,
        hasAccount: true,
        generatedPassword: newPassword,
        credentialsCreatedAt: nowIso,
        credentialsAuditLog: [
          { action: prev?.hasAccount ? 'regenerated' : 'generated', timestamp: nowIso },
          ...prevLog,
        ].slice(0, 20),
        mustChangePassword: finalPrestataire.mustChangePassword ?? true,
      };
      savePrestataireCredentialAccount(finalPrestataire, newPassword);
    } else if (finalPrestataire.hasAccount && finalPrestataire.generatedPassword && finalPrestataire.email) {
      savePrestataireCredentialAccount(finalPrestataire, finalPrestataire.generatedPassword);
    }

    if (index >= 0) {
      list[index] = finalPrestataire;
    } else {
      list.unshift(finalPrestataire);
    }
    setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);
    return finalPrestataire;
  }

  const docRef = doc(db, PRESTATAIRES_COL, prestataire.id);
  await setDoc(docRef, prestataire, { merge: true });
  return prestataire;
};

export const regeneratePrestataireCredentials = async (
  prestataireId: string
): Promise<Prestataire> => {
  if (isMock) {
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
    const idx = list.findIndex((p) => p.id === prestataireId);
    if (idx >= 0) {
      const prest = list[idx];
      const nowIso = new Date().toISOString();
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
      const updated: Prestataire = {
        ...prest,
        email: fallbackEmail,
        hasAccount: true,
        generatedPassword: newPassword,
        credentialsCreatedAt: nowIso,
        credentialsAuditLog: [
          { action: prest.hasAccount ? 'regenerated' : 'generated', timestamp: nowIso },
          ...prevLog,
        ].slice(0, 20),
        mustChangePassword: true,
      };
      list[idx] = updated;
      savePrestataireCredentialAccount(updated, newPassword);
      setLocalItem(STORAGE_KEYS.PRESTATAIRES, list);
      return updated;
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
    const updated: Prestataire = {
      ...prest,
      credentialsSharedAt: nowIso,
      credentialsLastSharedMethod: method,
      credentialsAuditLog: [
        { action: method === 'pdf' ? 'shared_pdf' : 'shared_copy', timestamp: nowIso },
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
  if (isMock) {
    const list = getLocalItem<Prestataire[]>(STORAGE_KEYS.PRESTATAIRES, mockPrestataires);
    const filtered = list.filter((p) => p.id !== prestataireId);
    setLocalItem(STORAGE_KEYS.PRESTATAIRES, filtered);

    const accounts = getLocalItem<PrestataireAccountRecord[]>(PRESTATAIRE_ACCOUNTS_KEY, []);
    setLocalItem(
      PRESTATAIRE_ACCOUNTS_KEY,
      accounts.filter((a) => a.prestataireId !== prestataireId)
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

  if (isMock) {
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
// 10. FINANCIAL TRANSACTIONS & INVOICES
// ==========================================

export const addTransaction = async (buildingId: string, transaction: Omit<Transaction, 'id'>) => {
  const newTrx: Transaction = {
    id: `trx-${Date.now()}`,
    ...transaction,
  };

  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === buildingId);
      if (bld) {
        bld.financials.transactions = bld.financials.transactions || [];
        bld.financials.transactions.unshift(newTrx);

        // Separate operating fund vs mandatory reserve fund (Law 106-12)
        if (transaction.fundType === 'reserve') {
          bld.financials.reserveFundBalance = (bld.financials.reserveFundBalance || 0) + newTrx.amount;
        } else {
          bld.financials.balance += newTrx.amount;
        }

        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        return newTrx;
      }
    }
  }

  const docRef = await addDoc(collection(db, TRANSACTIONS_COL), { ...transaction, buildingId });
  return { id: docRef.id, ...transaction };
};

export const getInvoicesForBuilding = async (buildingId: string): Promise<Invoice[]> => {
  if (isMock) {
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, mockCharges);
    const bldCharges = charges.filter((c) => c.buildingId === buildingId);
    return bldCharges.map((c, i) => ({
      id: `inv-${c.id}`,
      syndicId: 'syndic-1',
      buildingId,
      residentId: c.residentId,
      invoiceNumber: `FAC-2026-${String(i + 1).padStart(4, '0')}`,
      totalAmount: c.amount,
      status: c.status === 'paid' ? 'paid' : (c.status === 'overdue' ? 'overdue' : 'unpaid'),
      createdAt: c.createdAt,
      dueDate: c.dueDate,
      chargeIds: [c.id],
    }));
  }

  const q = query(collection(db, INVOICES_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as Invoice));
};

export const createInvoiceForResident = async (residentId: string, buildingId: string, syndicId: string) => {
  const newInv: Invoice = {
    id: `inv-${Date.now()}`,
    syndicId,
    buildingId,
    residentId,
    invoiceNumber: `FAC-2026-${Math.floor(1000 + Math.random() * 9000)}`,
    totalAmount: 350,
    status: 'unpaid',
    createdAt: new Date().toISOString(),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    chargeIds: [],
  };
  return newInv;
};

export const recordPayment = async (invoice: Invoice, amount: number, method: string) => {
  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === invoice.buildingId);
      if (bld) {
        bld.financials.balance += amount;
        bld.financials.transactions.unshift({
          id: `trx-${Date.now()}`,
          date: new Date().toISOString(),
          description: `Règlement facture #${invoice.invoiceNumber} (${method})`,
          amount,
          type: 'income',
          category: 'fees',
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
      };

      transaction.set(trxRef, { ...newTrx, buildingId: invoice.buildingId });
      transaction.update(invoiceRef, { status: 'paid' });
    });
    return true;
  } catch (e) {
    console.error('Payment transaction failed:', e);
    throw e;
  }
};

export const initiateCmiPayment = async (invoiceId: string) => {
  return {
    action: 'https://testpayment.cmi.co.ma/fim/est3Dgate',
    params: {
      clientid: '600000001',
      amount: '350.00',
      okUrl: window.location.href,
      failUrl: window.location.href,
      TranType: '0',
      storetype: '3d_pay_hosting',
      oid: invoiceId,
      hash: 'mock_cmi_hash',
    },
  };
};

// ==========================================
// 11. MAINTENANCE & STATUS TRACKER
// ==========================================

const DEFAULT_MAINTENANCE_REQUESTS: MaintenanceRequest[] = [];

export const getMaintenanceRequestsForBuilding = async (buildingId: string): Promise<MaintenanceRequest[]> => {
  if (isMock) {
    const list = getLocalItem<MaintenanceRequest[]>(STORAGE_KEYS.MAINTENANCE, DEFAULT_MAINTENANCE_REQUESTS);
    return list.filter((m) => m.buildingId === buildingId);
  }

  const q = query(collection(db, MAINTENANCE_COL), where('buildingId', '==', buildingId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceRequest));
};

export const getMaintenanceRequestsForResident = async (residentId: string): Promise<MaintenanceRequest[]> => {
  if (isMock) {
    const list = getLocalItem<MaintenanceRequest[]>(STORAGE_KEYS.MAINTENANCE, DEFAULT_MAINTENANCE_REQUESTS);
    return list.filter((m) => m.residentId === residentId);
  }

  const q = query(collection(db, MAINTENANCE_COL), where('residentId', '==', residentId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceRequest));
};

export const addMaintenanceRequest = async (request: Omit<MaintenanceRequest, 'id'>) => {
  const initialUpdate: MaintenanceStepUpdate = {
    id: `upd-${Date.now()}`,
    status: request.status || 'pending',
    title: 'Signalement créé et transmis au Syndic',
    note: request.description,
    updatedBy: request.residentName
      ? `${request.residentName}${request.apartmentNumber ? ` (${request.apartmentNumber})` : ''}`
      : 'Copropriétaire',
    updatedByRole: 'resident',
    timestamp: request.createdAt || new Date().toISOString(),
    photos: request.photos || (request.photoUrl ? [request.photoUrl] : undefined),
  };

  const newReq: MaintenanceRequest = {
    id: `maint-${Date.now()}`,
    ...request,
    updates: request.updates && request.updates.length > 0 ? request.updates : [initialUpdate],
  };

  if (isMock) {
    const list = getLocalItem<MaintenanceRequest[]>(STORAGE_KEYS.MAINTENANCE, DEFAULT_MAINTENANCE_REQUESTS);
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
  if (isMock) {
    const list = getLocalItem<MaintenanceRequest[]>(STORAGE_KEYS.MAINTENANCE, DEFAULT_MAINTENANCE_REQUESTS);
    const idx = list.findIndex((m) => m.id === id);
    if (idx >= 0) {
      const existing = list[idx];
      const mergedPhotos = stepInfo?.stepPhotos?.length
        ? [...(existing.photos || (existing.photoUrl ? [existing.photoUrl] : [])), ...stepInfo.stepPhotos]
        : updates.photos || existing.photos;

      const existingUpdates = existing.updates || [];
      let nextUpdates = [...existingUpdates];

      if (stepInfo && (stepInfo.note || stepInfo.title || updates.status !== existing.status || stepInfo.stepPhotos?.length)) {
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

  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === buildingId);
      if (bld) {
        bld.announcements = bld.announcements || [];
        bld.announcements.unshift(newAnn);
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        return newAnn;
      }
    }
  }

  return newAnn;
};

// ==========================================
// 12. DOCUMENTS
// ==========================================

export const uploadDocument = async (buildingId: string, file: File): Promise<Document> => {
  const newDoc: Document = {
    id: `doc-${Date.now()}`,
    name: file.name,
    url: '#',
    size: `${Math.max(0.1, file.size / (1024 * 1024)).toFixed(1)} MB`,
    uploadedAt: new Date().toISOString(),
    category: 'autre',
  };

  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      const bld = s.buildings.find((b) => b.id === buildingId);
      if (bld) {
        bld.documents = bld.documents || [];
        bld.documents.unshift(newDoc);
        setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
        return newDoc;
      }
    }
  }

  return newDoc;
};

export const deleteDocument = async (docToDelete: Document): Promise<boolean> => {
  if (isMock) {
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, mockSyndics);
    for (const s of syndics) {
      for (const bld of s.buildings) {
        if (bld.documents) {
          bld.documents = bld.documents.filter((d) => d.id !== docToDelete.id);
        }
      }
    }
    setLocalItem(STORAGE_KEYS.SYNDICS, syndics);
    return true;
  }
  return true;
};

// ==========================================
// 13. NOTIFICATIONS
// ==========================================

const DEFAULT_NOTIFICATIONS: Notification[] = [];

export const getUserNotifications = async (userId: string): Promise<Notification[]> => {
  if (isMock) {
    const list = getLocalItem<Notification[]>(STORAGE_KEYS.NOTIFICATIONS, DEFAULT_NOTIFICATIONS);
    return list;
  }

  const q = query(collection(db, NOTIFICATIONS_COL), where('userId', '==', userId), orderBy('createdAt', 'desc'));
  const sn = await getDocs(q);
  return sn.docs.map((d) => ({ id: d.id, ...d.data() } as Notification));
};

export const markNotificationAsRead = async (notificationId: string) => {
  if (isMock) {
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
// 14. CHAT & MESSAGERIE COPROPRIÉTÉ
// ==========================================

export const getChatMessages = async (
  buildingId: string,
  channelId?: string
): Promise<ChatMessage[]> => {
  if (isMock) {
    const list = getLocalItem<ChatMessage[]>(STORAGE_KEYS.CHAT, mockChatMessages);
    const buildingMsgs = list.filter((m) => m.buildingId === buildingId);
    if (channelId) {
      if (channelId === 'marketplace') {
        return buildingMsgs.filter((m) => m.channelId === 'marketplace' || m.channelId.startsWith('market-'));
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

  if (isMock) {
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
  if (isMock) {
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
  if (isMock) {
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

  if (isMock) {
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
  if (isMock) {
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
  if (isMock) {
    const list = getLocalItem<MarketplaceItem[]>(STORAGE_KEYS.MARKETPLACE, mockMarketplaceItems);
    const filtered = list.filter((i) => i.id !== itemId);
    setLocalItem(STORAGE_KEYS.MARKETPLACE, filtered);
    return true;
  }

  await deleteDoc(doc(db, 'marketplace_items', itemId));
  return true;
};

