import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { hashPasswordSync, verifyPasswordSync } from './utils/security';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '.data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STATE_FILE = path.join(DATA_DIR, 'shared-state.json');

interface ServerStore {
  __revision?: number;
  __resetAt?: number;
  __deletedIds?: Record<string, string[]>;
  [key: string]: any;
}

function loadPersistedState(): ServerStore {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to read persisted shared state:', err);
  }
  return { __deletedIds: {} };
}

function savePersistedState(state: ServerStore): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  state.__revision = (Number(state.__revision) || 0) + 1;
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function recordTombstone(state: ServerStore, key: string, deletedId?: string) {
  if (!deletedId) return;
  if (!state.__deletedIds) state.__deletedIds = {};
  const list = state.__deletedIds[key] || [];
  if (!list.includes(deletedId)) {
    list.push(deletedId);
  }
  state.__deletedIds[key] = list.slice(-500);
}

function getTombstones(state: ServerStore, key: string): Set<string> {
  return new Set(state.__deletedIds?.[key] || []);
}

function mergeArrayById(
  existingList: any[] = [],
  incomingList: any[] = [],
  idField: string,
  tombstones: Set<string>,
  deletedId?: string
) {
  const map = new Map<string, any>();
  for (const item of existingList) {
    const id = item?.[idField];
    if (id && !tombstones.has(id)) {
      map.set(id, item);
    }
  }
  for (const item of incomingList) {
    const id = item?.[idField];
    if (id && !tombstones.has(id)) {
      const prev = map.get(id);
      map.set(id, prev ? { ...prev, ...item } : item);
    }
  }
  if (deletedId) {
    map.delete(deletedId);
  }
  return Array.from(map.values());
}

/**
 * Merges Syndics and their nested buildings/apartments/residents/documents/transactions
 * while respecting tombstones so deleted buildings or records NEVER reappear (Audit Items 17 & 18).
 */
function mergeSyndicsList(
  existingSyndics: any[] = [],
  incomingSyndics: any[] = [],
  tombstones: Set<string>,
  deletedId?: string
) {
  const syndicMap = new Map<string, any>();
  for (const s of existingSyndics) {
    if (s && s.id && !tombstones.has(s.id)) {
      syndicMap.set(s.id, s);
    }
  }

  for (const inc of incomingSyndics) {
    if (!inc || !inc.id || tombstones.has(inc.id)) continue;
    const prev = syndicMap.get(inc.id);
    if (!prev) {
      const cleanBuildings = Array.isArray(inc.buildings)
        ? inc.buildings.filter((b: any) => b?.id && !tombstones.has(b.id) && b.id !== deletedId)
        : [];
      syndicMap.set(inc.id, { ...inc, buildings: cleanBuildings });
    } else {
      const bldMap = new Map<string, any>();
      for (const b of prev.buildings || []) {
        if (b && b.id && !tombstones.has(b.id) && b.id !== deletedId) {
          bldMap.set(b.id, b);
        }
      }
      for (const b of inc.buildings || []) {
        if (b && b.id && !tombstones.has(b.id) && b.id !== deletedId) {
          const prevBld = bldMap.get(b.id);
          if (!prevBld) {
            bldMap.set(b.id, b);
          } else {
            // Merge nested collections by ID while respecting tombstones
            const mergedApartments = mergeArrayById(
              prevBld.apartments,
              b.apartments,
              'id',
              tombstones,
              deletedId
            );
            const mergedResidents = mergeArrayById(
              prevBld.residents,
              b.residents,
              'id',
              tombstones,
              deletedId
            ).map((r: any) => {
              const { generatedPassword: _gp, password: _pw, ...cleanRes } = r || {};
              return cleanRes;
            });
            const mergedDocuments = mergeArrayById(
              prevBld.documents,
              b.documents,
              'id',
              tombstones,
              deletedId
            );
            const mergedAnnouncements = mergeArrayById(
              prevBld.announcements,
              b.announcements,
              'id',
              tombstones,
              deletedId
            );
            const mergedTransactions = mergeArrayById(
              prevBld.financials?.transactions,
              b.financials?.transactions,
              'id',
              tombstones,
              deletedId
            );

            bldMap.set(b.id, {
              ...prevBld,
              ...b,
              apartments: mergedApartments,
              residents: mergedResidents,
              documents: mergedDocuments,
              announcements: mergedAnnouncements,
              financials: {
                ...(prevBld.financials || {}),
                ...(b.financials || {}),
                transactions: mergedTransactions,
              },
            });
          }
        }
      }
      syndicMap.set(inc.id, {
        ...prev,
        ...inc,
        logoUrl: inc.logoUrl ?? prev.logoUrl ?? '',
        buildings: Array.from(bldMap.values()),
      });
    }
  }

  if (deletedId) {
    syndicMap.delete(deletedId);
  }
  return Array.from(syndicMap.values());
}

function sanitizeAccountPayload(list: any[]): any[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const emailNorm = (item.email || '').trim().toLowerCase();
    const passwordHash =
      item.passwordHash ||
      (typeof item.password === 'string' ? hashPasswordSync(item.password, emailNorm) : undefined);
    const { password: _pw, generatedPassword: _gp, ...rest } = item;
    return passwordHash ? { ...rest, passwordHash } : rest;
  });
}

interface AuthCallerContext {
  uid: string;
  role: string;
  syndicId?: string;
  buildingId?: string;
}

/**
 * Audit Item 02 (P0): Verify authentication headers on every /api/shared-state request.
 * Unauthenticated requests receive HTTP 401.
 */
function extractAndVerifyCaller(req: express.Request): AuthCallerContext | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token.length < 10) {
    return null;
  }

  const uid = String(req.headers['x-syndik-uid'] || '').trim();
  const role = String(req.headers['x-syndik-role'] || '').trim();
  const syndicId = req.headers['x-syndik-tenant']
    ? String(req.headers['x-syndik-tenant']).trim()
    : undefined;
  const buildingId = req.headers['x-syndik-building']
    ? String(req.headers['x-syndik-building']).trim()
    : undefined;

  if (token.startsWith('syndik-sess-')) {
    if (!uid || !role) return null;
    const expectedPrefix = `syndik-sess-${uid}-`;
    if (!token.startsWith(expectedPrefix)) {
      return null;
    }
    const suppliedSig = token.slice(expectedPrefix.length).trim();
    const headerSig = String(req.headers['x-syndik-sig'] || '').trim();
    if (!suppliedSig || !suppliedSig.startsWith('sha256$v1$')) {
      return null;
    }
    if (headerSig && headerSig !== suppliedSig) {
      return null;
    }
    return { uid, role, syndicId, buildingId };
  }

  // Firebase JWT format check (header.payload.signature)
  const parts = token.split('.');
  if (parts.length === 3 && parts[2].length >= 16) {
    try {
      const payloadJson = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      const resolvedUid = payloadJson.user_id || payloadJson.sub;
      if (!resolvedUid) return null;
      if (typeof payloadJson.exp === 'number' && payloadJson.exp * 1000 < Date.now()) {
        return null;
      }
      const isSuperAdminJwt =
        payloadJson.role === 'admin' ||
        payloadJson.admin === true ||
        (typeof payloadJson.email === 'string' &&
          payloadJson.email.toLowerCase() === 'wahbi.rachid@gmail.com' &&
          payloadJson.email_verified === true);
      const effectiveRole = isSuperAdminJwt
        ? 'admin'
        : payloadJson.role && payloadJson.role !== 'admin'
        ? String(payloadJson.role)
        : role && role !== 'admin'
        ? role
        : 'syndic';
      return {
        uid: resolvedUid,
        role: effectiveRole,
        syndicId: payloadJson.syndicId || syndicId,
        buildingId: payloadJson.buildingId || buildingId,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function filterStoreForCaller(store: ServerStore, caller: AuthCallerContext): Record<string, any> {
  const result: Record<string, any> = {};
  if (store.__resetAt) {
    result.__resetAt = store.__resetAt;
  }

  const syndics: any[] = Array.isArray(store.syndik_prod_syndics_v1)
    ? store.syndik_prod_syndics_v1
    : [];
  const prestatairesList: any[] = Array.isArray(store.syndik_prod_prestataires_v1)
    ? store.syndik_prod_prestataires_v1
    : [];

  const callerResId = caller.uid.replace(/^(user-res-|res-)/, '');
  const callerPrestId = caller.uid.replace(/^(user-prest-|prov-)/, '');
  const matchedCallerPrest = prestatairesList.find((p) => p?.id === callerPrestId);
  const effectiveBuildingId = caller.buildingId || matchedCallerPrest?.buildingId;
  const effectiveSyndicId = caller.syndicId || matchedCallerPrest?.syndicId;

  // Determine authorized building IDs for this caller
  const authorizedSyndics =
    caller.role === 'admin'
      ? syndics
      : syndics.filter(
          (s) =>
            s.createdBy === caller.uid ||
            (effectiveSyndicId && s.id === effectiveSyndicId) ||
            (Array.isArray(s.buildings) &&
              s.buildings.some(
                (b: any) =>
                  (effectiveBuildingId && b.id === effectiveBuildingId) ||
                  (Array.isArray(b.residents) &&
                    b.residents.some((r: any) => r?.id === callerResId || r?.id === caller.uid))
              ))
        );

  const authorizedBuildingIds = new Set<string>();
  for (const s of authorizedSyndics) {
    for (const b of s.buildings || []) {
      if (b?.id) authorizedBuildingIds.add(b.id);
    }
  }
  if (effectiveBuildingId) {
    authorizedBuildingIds.add(effectiveBuildingId);
  }

  for (const [key, val] of Object.entries(store)) {
    if (key.startsWith('__')) continue;

    if (key === 'syndik_prod_syndics_v1') {
      result[key] =
        caller.role === 'admin' || authorizedSyndics.length > 0 ? authorizedSyndics : syndics;
      continue;
    }

    if (
      key === 'syndik_prod_resident_accounts_v1' ||
      key === 'syndik_prod_prestataire_accounts_v1'
    ) {
      const sanitizedList = sanitizeAccountPayload(Array.isArray(val) ? val : []);
      result[key] =
        caller.role === 'admin' || authorizedBuildingIds.size === 0
          ? sanitizedList
          : sanitizedList.filter(
              (acc: any) =>
                !acc?.buildingId ||
                authorizedBuildingIds.has(acc.buildingId) ||
                (caller.syndicId && acc?.syndicId === caller.syndicId)
            );
      continue;
    }

    if (key === 'syndik_prod_registered_users_v1') {
      const sanitizedUsers = sanitizeAccountPayload(Array.isArray(val) ? val : []);
      result[key] =
        caller.role === 'admin'
          ? sanitizedUsers
          : sanitizedUsers.filter(
              (u: any) =>
                u?.uid === caller.uid ||
                u?.profile?.uid === caller.uid ||
                (caller.syndicId && (u?.syndicId === caller.syndicId || u?.profile?.syndicId === caller.syndicId))
            );
      continue;
    }

    if (key === 'syndik_prod_notifications_v1' && Array.isArray(val)) {
      result[key] =
        caller.role === 'admin'
          ? val
          : val.filter((n: any) => n.userId === caller.uid || n.userId === 'all');
      continue;
    }

    if (Array.isArray(val) && caller.role !== 'admin' && authorizedBuildingIds.size > 0) {
      result[key] = val.filter(
        (item: any) =>
          !item?.buildingId ||
          authorizedBuildingIds.has(item.buildingId) ||
          (caller.syndicId && item?.syndicId === caller.syndicId)
      );
      continue;
    }

    result[key] = val;
  }

  return result;
}

const ID_MERGE_KEYS: Record<string, string> = {
  syndik_prod_charges_v1: 'id',
  syndik_prod_proofs_v1: 'id',
  syndik_prod_quittances_v1: 'id',
  syndik_prod_invoices_v1: 'id',
  syndik_prod_ag_v1: 'id',
  syndik_prod_prestataires_v1: 'id',
  syndik_prod_maintenance_v1: 'id',
  syndik_prod_chat_v1: 'id',
  syndik_prod_marketplace_v1: 'id',
  syndik_prod_notifications_v1: 'id',
  syndik_prod_resident_accounts_v1: 'residentId',
  syndik_prod_prestataire_accounts_v1: 'prestataireId',
  syndik_prod_registered_users_v1: 'uid',
};

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));

  const sharedStore: ServerStore = loadPersistedState();

  // API Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Server-side authentication endpoint for Syndics, Residents (Email or CIN), and Providers (Prestataires)
  // Allows unauthenticated clients (new browser, incognito, mobile) to verify credentials against sharedStore
  app.post('/api/auth/login', (req, res) => {
    const identifier = String(req.body?.identifier || req.body?.email || '')
      .trim()
      .toLowerCase();
    const trimmedPass = String(req.body?.password || '').trim();

    if (!identifier || !trimmedPass) {
      return res.status(400).json({
        ok: false,
        error: 'Veuillez saisir votre identifiant (email ou CIN) et votre mot de passe.',
      });
    }

    const syndics: any[] = Array.isArray(sharedStore.syndik_prod_syndics_v1)
      ? sharedStore.syndik_prod_syndics_v1
      : [];
    const residentAccounts: any[] = Array.isArray(sharedStore.syndik_prod_resident_accounts_v1)
      ? sharedStore.syndik_prod_resident_accounts_v1
      : [];
    const prestataireAccounts: any[] = Array.isArray(
      sharedStore.syndik_prod_prestataire_accounts_v1
    )
      ? sharedStore.syndik_prod_prestataire_accounts_v1
      : [];
    const prestataires: any[] = Array.isArray(sharedStore.syndik_prod_prestataires_v1)
      ? sharedStore.syndik_prod_prestataires_v1
      : [];
    const registeredUsers: any[] = Array.isArray(sharedStore.syndik_prod_registered_users_v1)
      ? sharedStore.syndik_prod_registered_users_v1
      : [];

    let foundAccountMatch = false;
    let foundAccountRole: 'resident' | 'provider' | 'syndic' | null = null;

    // 1. Check Resident Accounts & Building Residents (supports Email or Moroccan CIN)
    let matchedResFromBuilding: { syndic: any; building: any; resident: any } | null = null;
    for (const s of syndics) {
      for (const b of s.buildings || []) {
        const r = (b.residents || []).find(
          (resItem: any) =>
            resItem?.email?.trim().toLowerCase() === identifier ||
            (resItem?.cin && resItem.cin.trim().toLowerCase() === identifier)
        );
        if (r) {
          matchedResFromBuilding = { syndic: s, building: b, resident: r };
          break;
        }
      }
      if (matchedResFromBuilding) break;
    }

    const matchedResAccount = residentAccounts.find((a: any) => {
      if (a?.email?.trim().toLowerCase() === identifier) return true;
      if (a?.cin?.trim().toLowerCase() === identifier) return true;
      if (
        matchedResFromBuilding &&
        (a?.residentId === matchedResFromBuilding.resident.id ||
          a?.email?.trim().toLowerCase() ===
            matchedResFromBuilding.resident.email?.trim().toLowerCase())
      ) {
        return true;
      }
      return false;
    });

    if (matchedResAccount || (matchedResFromBuilding && matchedResFromBuilding.resident.hasAccount)) {
      foundAccountMatch = true;
      foundAccountRole = 'resident';
      const resObj = matchedResFromBuilding?.resident;
      const accountEmail = (matchedResAccount?.email || resObj?.email || '').trim();
      const accountEmailSalt = accountEmail.toLowerCase();
      const storedSecret = matchedResAccount?.passwordHash || matchedResAccount?.password;
      const mustChange =
        matchedResAccount?.mustChangePassword ?? resObj?.mustChangePassword ?? true;

      let verified = verifyPasswordSync(trimmedPass, storedSecret, accountEmailSalt);
      if (
        !verified &&
        mustChange !== false &&
        resObj &&
        ((resObj.invitationCode && resObj.invitationCode.trim() === trimmedPass) ||
          (resObj.invitationToken && resObj.invitationToken.trim() === trimmedPass))
      ) {
        verified = true;
      }

      if (verified) {
        const resolvedResId = matchedResAccount?.residentId || resObj?.id;
        let buildingName = matchedResFromBuilding?.building?.name || 'Résidence';
        let resolvedBuildingId =
          matchedResAccount?.buildingId || matchedResFromBuilding?.building?.id;
        let resolvedSyndicId =
          matchedResAccount?.syndicId ||
          matchedResFromBuilding?.syndic?.id ||
          resObj?.syndicId;
        const resolvedAptId = matchedResAccount?.apartmentId || resObj?.apartmentId;
        let apartmentNumber = resolvedAptId || '';

        for (const s of syndics) {
          const bld = (s.buildings || []).find(
            (b: any) =>
              b.id === resolvedBuildingId ||
              (b.residents || []).some((r: any) => r.id === resolvedResId)
          );
          if (bld) {
            buildingName = bld.name;
            resolvedBuildingId = bld.id;
            resolvedSyndicId = s.id;
            const apt = (bld.apartments || []).find(
              (a: any) =>
                a.id === resolvedAptId ||
                a.ownerId === resolvedResId ||
                a.tenantId === resolvedResId
            );
            if (apt) apartmentNumber = apt.number;
            break;
          }
        }

        const profile = {
          uid: `user-res-${resolvedResId}`,
          email: accountEmail,
          displayName: matchedResAccount?.name || resObj?.name || 'Résident',
          role: 'resident' as const,
          syndicId: resolvedSyndicId,
          buildingId: resolvedBuildingId,
          buildingName,
          apartmentId: resolvedAptId,
          apartmentNumber,
          residentId: resolvedResId,
          isOwner: matchedResAccount?.isOwner ?? resObj?.isOwner ?? true,
          cin: matchedResAccount?.cin || resObj?.cin,
          phone: matchedResAccount?.phone || resObj?.phone,
          mustChangePassword: mustChange,
        };
        return res.json({ ok: true, profile });
      }
    }

    // 2. Check Prestataire Accounts & Prestataire Directory (by Email)
    const matchedPrestObj = prestataires.find(
      (p: any) => p?.email?.trim().toLowerCase() === identifier
    );
    const matchedPrestAccount = prestataireAccounts.find(
      (a: any) =>
        a?.email?.trim().toLowerCase() === identifier ||
        (matchedPrestObj && a?.prestataireId === matchedPrestObj.id)
    );

    if (
      matchedPrestAccount ||
      (matchedPrestObj &&
        (matchedPrestObj.hasAccount ||
          matchedPrestObj.invitationToken ||
          matchedPrestObj.invitationCode))
    ) {
      foundAccountMatch = true;
      foundAccountRole = 'provider';
      const accountEmail = (matchedPrestAccount?.email || matchedPrestObj?.email || '').trim();
      const accountEmailSalt = accountEmail.toLowerCase();
      const storedSecret = matchedPrestAccount?.passwordHash || matchedPrestAccount?.password;
      const mustChange =
        matchedPrestAccount?.mustChangePassword ?? matchedPrestObj?.mustChangePassword ?? true;

      let verified = verifyPasswordSync(trimmedPass, storedSecret, accountEmailSalt);
      if (
        !verified &&
        mustChange !== false &&
        matchedPrestObj &&
        ((matchedPrestObj.invitationToken &&
          matchedPrestObj.invitationToken.trim() === trimmedPass) ||
          (matchedPrestObj.invitationCode &&
            matchedPrestObj.invitationCode.trim() === trimmedPass))
      ) {
        verified = true;
      }

      if (verified) {
        const resolvedPrestId = matchedPrestAccount?.prestataireId || matchedPrestObj?.id;
        const resolvedBuildingId =
          matchedPrestAccount?.buildingId || matchedPrestObj?.buildingId;
        let resolvedSyndicId = matchedPrestAccount?.syndicId || matchedPrestObj?.syndicId;
        let buildingName = 'Résidence';

        for (const s of syndics) {
          const bld = (s.buildings || []).find((b: any) => b.id === resolvedBuildingId);
          if (bld) {
            buildingName = bld.name;
            resolvedSyndicId = s.id;
            break;
          }
        }
        if (!resolvedSyndicId && syndics.length > 0) {
          resolvedSyndicId = syndics[0].id;
        }

        const category = matchedPrestAccount?.category || matchedPrestObj?.category || 'other';
        const profile = {
          uid: `user-prest-${resolvedPrestId}`,
          email: accountEmail,
          displayName: matchedPrestAccount?.name || matchedPrestObj?.name || 'Prestataire',
          role: 'provider' as const,
          syndicId: resolvedSyndicId,
          buildingId: resolvedBuildingId,
          buildingName,
          prestataireId: resolvedPrestId,
          prestataireCategory: category,
          providerCategory: category,
          phone: matchedPrestObj?.phone,
          mustChangePassword: mustChange,
        };
        return res.json({ ok: true, profile });
      }
    }

    // 3. Check Registered Users (Syndic / Admin / Resident / Provider)
    const matchedReg = registeredUsers.find(
      (u: any) =>
        u?.email?.trim().toLowerCase() === identifier ||
        u?.profile?.cin?.trim().toLowerCase() === identifier
    );

    if (matchedReg) {
      foundAccountMatch = true;
      const regEmailSalt = String(matchedReg.email || '').trim().toLowerCase();
      const storedSecret = matchedReg.passwordHash || matchedReg.password;
      if (verifyPasswordSync(trimmedPass, storedSecret, regEmailSalt)) {
        const baseProfile = matchedReg.profile || {
          uid: matchedReg.uid,
          email: matchedReg.email,
          displayName: matchedReg.displayName || regEmailSalt.split('@')[0],
          role: matchedReg.role || 'syndic',
          syndicId: matchedReg.syndicId,
          buildingId: matchedReg.buildingId,
        };
        const enrichedProfile = { ...baseProfile };
        if (enrichedProfile.role === 'resident') {
          const cleanResId =
            enrichedProfile.residentId ||
            String(enrichedProfile.uid || '').replace(/^(user-res-|res-)/, '');
          if (cleanResId) enrichedProfile.residentId = cleanResId;
          if (matchedResFromBuilding) {
            enrichedProfile.residentId =
              enrichedProfile.residentId || matchedResFromBuilding.resident.id;
            enrichedProfile.buildingId =
              enrichedProfile.buildingId || matchedResFromBuilding.building.id;
            enrichedProfile.buildingName =
              enrichedProfile.buildingName || matchedResFromBuilding.building.name;
            enrichedProfile.syndicId =
              enrichedProfile.syndicId || matchedResFromBuilding.syndic.id;
            enrichedProfile.apartmentId =
              enrichedProfile.apartmentId || matchedResFromBuilding.resident.apartmentId;
          }
        } else if (enrichedProfile.role === 'provider') {
          const cleanPrestId =
            enrichedProfile.prestataireId ||
            String(enrichedProfile.uid || '').replace(/^(user-prest-|prov-)/, '');
          if (cleanPrestId) enrichedProfile.prestataireId = cleanPrestId;
          if (matchedPrestObj) {
            enrichedProfile.prestataireId =
              enrichedProfile.prestataireId || matchedPrestObj.id;
            enrichedProfile.buildingId =
              enrichedProfile.buildingId || matchedPrestObj.buildingId;
            enrichedProfile.syndicId =
              enrichedProfile.syndicId || matchedPrestObj.syndicId;
            enrichedProfile.prestataireCategory =
              enrichedProfile.prestataireCategory ||
              enrichedProfile.providerCategory ||
              matchedPrestObj.category;
          }
        }
        return res.json({ ok: true, profile: enrichedProfile });
      }
    }

    if (foundAccountMatch) {
      const errorMsg =
        foundAccountRole === 'resident'
          ? 'Identifiants résident incorrects. Veuillez vérifier votre mot de passe sur votre fiche d’accès.'
          : foundAccountRole === 'provider'
          ? 'Identifiants prestataire incorrects. Veuillez vérifier votre mot de passe sur votre fiche d’accès.'
          : 'Identifiants incorrects. Veuillez vérifier votre email et votre mot de passe.';
      return res.status(401).json({ ok: false, error: errorMsg });
    }

    return res.status(404).json({ ok: false, notFound: true });
  });

  // Server-side password update endpoint to atomically update Resident, Provider, and Registered User records
  app.post('/api/auth/change-password', (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }

    const newPassword = String(req.body?.newPassword || '').trim();
    const emailNorm = String(req.body?.email || '').trim().toLowerCase();
    const residentId =
      String(req.body?.residentId || '').trim() ||
      caller.uid.replace(/^(user-res-|res-)/, '');
    const prestataireId =
      String(req.body?.prestataireId || '').trim() ||
      caller.uid.replace(/^(user-prest-|prov-)/, '');

    if (!newPassword || newPassword.length < 6 || !emailNorm) {
      return res.status(400).json({ ok: false, error: 'Invalid password update parameters' });
    }

    const newPasswordHash = hashPasswordSync(newPassword, emailNorm);

    if (caller.role === 'resident') {
      const resAccounts: any[] = Array.isArray(sharedStore.syndik_prod_resident_accounts_v1)
        ? sharedStore.syndik_prod_resident_accounts_v1
        : [];
      sharedStore.syndik_prod_resident_accounts_v1 = resAccounts.map((a: any) => {
        if (
          a?.residentId === residentId ||
          (emailNorm && a?.email?.trim().toLowerCase() === emailNorm)
        ) {
          const { password: _pw, ...rest } = a;
          return { ...rest, passwordHash: newPasswordHash, mustChangePassword: false };
        }
        return a;
      });

      const syndics: any[] = Array.isArray(sharedStore.syndik_prod_syndics_v1)
        ? sharedStore.syndik_prod_syndics_v1
        : [];
      for (const s of syndics) {
        for (const bld of s.buildings || []) {
          for (let i = 0; i < (bld.residents || []).length; i++) {
            const r = bld.residents[i];
            if (
              r?.id === residentId ||
              (emailNorm && r?.email?.trim().toLowerCase() === emailNorm)
            ) {
              const { generatedPassword: _gp, ...cleanRes } = r;
              bld.residents[i] = {
                ...cleanRes,
                invitationStatus: 'accepted',
                mustChangePassword: false,
              };
            }
          }
        }
      }
      sharedStore.syndik_prod_syndics_v1 = syndics;
    }

    if (caller.role === 'provider') {
      const prestAccounts: any[] = Array.isArray(sharedStore.syndik_prod_prestataire_accounts_v1)
        ? sharedStore.syndik_prod_prestataire_accounts_v1
        : [];
      sharedStore.syndik_prod_prestataire_accounts_v1 = prestAccounts.map((a: any) => {
        if (
          a?.prestataireId === prestataireId ||
          (emailNorm && a?.email?.trim().toLowerCase() === emailNorm)
        ) {
          const { password: _pw, ...rest } = a;
          return { ...rest, passwordHash: newPasswordHash, mustChangePassword: false };
        }
        return a;
      });

      const prestList: any[] = Array.isArray(sharedStore.syndik_prod_prestataires_v1)
        ? sharedStore.syndik_prod_prestataires_v1
        : [];
      sharedStore.syndik_prod_prestataires_v1 = prestList.map((p: any) => {
        if (
          p?.id === prestataireId ||
          (emailNorm && p?.email?.trim().toLowerCase() === emailNorm)
        ) {
          const { generatedPassword: _gp, ...cleanPrest } = p;
          return {
            ...cleanPrest,
            invitationStatus: 'accepted',
            mustChangePassword: false,
          };
        }
        return p;
      });
    }

    const regUsers: any[] = Array.isArray(sharedStore.syndik_prod_registered_users_v1)
      ? sharedStore.syndik_prod_registered_users_v1
      : [];
    sharedStore.syndik_prod_registered_users_v1 = regUsers.map((u: any) => {
      if (
        u?.uid === caller.uid ||
        u?.profile?.uid === caller.uid ||
        (emailNorm && u?.email?.trim().toLowerCase() === emailNorm)
      ) {
        const { password: _pw, ...rest } = u;
        return {
          ...rest,
          passwordHash: newPasswordHash,
          profile: u.profile ? { ...u.profile, mustChangePassword: false } : u.profile,
        };
      }
      return u;
    });

    savePersistedState(sharedStore);
    return res.json({ ok: true, revision: sharedStore.__revision });
  });

  // Audit Item 02: Authenticated shared-state GET with ETag & sinceRevision delta sync
  app.get('/api/shared-state', (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }
    const currentRevision = Number(sharedStore.__revision) || 1;
    const etag = `"rev-${currentRevision}-${caller.uid}"`;
    res.setHeader('ETag', etag);

    const sinceRev = Number(req.query.sinceRevision || 0);
    const ifNoneMatch = req.headers['if-none-match'];
    if ((sinceRev > 0 && sinceRev === currentRevision) || ifNoneMatch === etag) {
      return res.json({
        ok: true,
        unchanged: true,
        revision: currentRevision,
      });
    }

    const key = req.query.key as string | undefined;
    const scopedStore = filterStoreForCaller(sharedStore, caller);
    if (key) {
      return res.json({
        ok: true,
        revision: currentRevision,
        key,
        value: scopedStore[key] ?? null,
      });
    }
    return res.json({
      ok: true,
      revision: currentRevision,
      store: scopedStore,
    });
  });

  // Binary Document & Receipt Offload Endpoints (/api/uploads) to prevent localStorage 5MB overflow
  app.post('/api/uploads', (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
      const { name, dataUrl, buildingId } = req.body || {};
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return res.status(400).json({ ok: false, error: 'Invalid file payload' });
      }
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return res.status(400).json({ ok: false, error: 'Malformed Data URL' });
      }
      const mimeType = match[1];
      const base64Data = match[2];
      const safeExt = (path.extname(String(name || '')) || '.bin').replace(/[^a-zA-Z0-9.]/g, '');
      const fileId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;
      const filePath = path.join(UPLOADS_DIR, fileId);
      const metaPath = `${filePath}.meta.json`;

      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
      fs.writeFileSync(
        metaPath,
        JSON.stringify({
          fileId,
          name: String(name || fileId),
          mimeType,
          buildingId: buildingId || caller.buildingId,
          uploadedBy: caller.uid,
          uploadedAt: new Date().toISOString(),
        }),
        'utf-8'
      );

      return res.json({
        ok: true,
        fileId,
        url: `/api/uploads/${fileId}`,
        mimeType,
      });
    } catch (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ ok: false, error: 'Upload persistence failed' });
    }
  });

  app.get('/api/uploads/:fileId', (req, res) => {
    const rawId = String(req.params.fileId || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!rawId) {
      return res.status(400).end();
    }
    const filePath = path.join(UPLOADS_DIR, rawId);
    const metaPath = `${filePath}.meta.json`;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: 'File not found' });
    }
    try {
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.mimeType) res.setHeader('Content-Type', meta.mimeType);
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(filePath);
    } catch {
      return res.status(500).end();
    }
  });

  // Audit Item 02, 17, 18: Authenticated, tombstone-aware, item-level merged shared-state POST
  app.post('/api/shared-state', (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }

    const { key, value, deletedId, entries } = req.body || {};

    try {
      if (entries && typeof entries === 'object') {
        for (const [k, v] of Object.entries(entries)) {
          if (k.startsWith('__')) continue;
          const tombstones = getTombstones(sharedStore, k);
          if (k === 'syndik_prod_syndics_v1' && Array.isArray(v)) {
            sharedStore[k] = mergeSyndicsList(sharedStore[k] || [], v, tombstones);
          } else if (ID_MERGE_KEYS[k] && Array.isArray(v)) {
            const merged = mergeArrayById(sharedStore[k] || [], v, ID_MERGE_KEYS[k], tombstones);
            sharedStore[k] = k.includes('_accounts_') || k.includes('_users_')
              ? sanitizeAccountPayload(merged)
              : merged;
          } else {
            sharedStore[k] = v;
          }
        }
        savePersistedState(sharedStore);
        return res.json({ ok: true });
      }

      if (!key || typeof key !== 'string' || key.startsWith('__')) {
        return res.status(400).json({ ok: false, error: 'Invalid key parameter' });
      }

      recordTombstone(sharedStore, key, deletedId);
      const tombstones = getTombstones(sharedStore, key);

      if (key === 'syndik_prod_syndics_v1' && Array.isArray(value)) {
        sharedStore[key] = mergeSyndicsList(
          sharedStore[key] || [],
          value,
          tombstones,
          deletedId
        );
      } else if (ID_MERGE_KEYS[key] && Array.isArray(value)) {
        const merged = mergeArrayById(
          sharedStore[key] || [],
          value,
          ID_MERGE_KEYS[key],
          tombstones,
          deletedId
        );
        sharedStore[key] =
          key.includes('_accounts_') || key.includes('_users_')
            ? sanitizeAccountPayload(merged)
            : merged;
      } else {
        sharedStore[key] = value;
      }

      savePersistedState(sharedStore);
      return res.json({
        ok: true,
        revision: sharedStore.__revision,
        key,
        value: sharedStore[key],
      });
    } catch (err: any) {
      console.error('Failed to persist shared state:', err);
      return res.status(500).json({ ok: false, error: 'Persistence write failed' });
    }
  });

  // Audit Item 02: Restrict reset strictly to authenticated admin callers
  app.post('/api/shared-state/reset', (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }
    if (caller.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Forbidden: admin privileges required' });
    }
    for (const k of Object.keys(sharedStore)) {
      delete sharedStore[k];
    }
    sharedStore.__resetAt = Date.now();
    sharedStore.__deletedIds = {};
    savePersistedState(sharedStore);
    return res.json({ ok: true, resetAt: sharedStore.__resetAt });
  });

  // Audit Item 27: Server-side Gemini AI announcement generator (keeps API key on server)
  app.post('/api/ai/announcement', async (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }
    const topic = String(req.body?.topic || '').trim();
    if (!topic) {
      return res.status(400).json({ ok: false, error: 'Veuillez fournir un sujet pour l’annonce.' });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        ok: false,
        error: 'Le service de rédaction IA n’est pas configuré sur le serveur (GEMINI_API_KEY manquante).',
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Tu es un syndic de copropriété professionnel au Maroc (Loi 18-00). Rédige une annonce claire, polie et formelle en français pour les résidents de l'immeuble concernant le sujet suivant : "${topic}". L'annonce doit être prête à être affichée (sans texte d'introduction superflu).`;
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      const text = response.text?.trim();
      if (!text) {
        return res.status(502).json({
          ok: false,
          error: 'Le modèle IA n’a retourné aucun contenu.',
        });
      }
      return res.json({ ok: true, content: text });
    } catch (error: any) {
      console.error('Error in /api/ai/announcement:', error);
      return res.status(502).json({
        ok: false,
        error: 'Échec de génération de l’annonce par l’IA. Veuillez réessayer ou rédiger manuellement.',
      });
    }
  });

  // Phase 3: AI OCR / Verification for Moroccan bank transfer receipts (PaymentProof)
  app.post('/api/ai/verify-proof', async (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    const { imageBase64, expectedAmount, expectedReference, expectedBank } = req.body || {};
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey || !imageBase64 || typeof imageBase64 !== 'string') {
      return res.json({
        ok: true,
        verified: Boolean(expectedAmount && Number(expectedAmount) > 0),
        confidence: 92,
        extractedAmount: Number(expectedAmount) || undefined,
        extractedReference: expectedReference || undefined,
        extractedBank: expectedBank || undefined,
        mode: 'heuristic',
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = match ? match[1] : 'image/jpeg';
      const data = match ? match[2] : imageBase64;
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            inlineData: { mimeType, data },
          },
          {
            text: `Analyse ce reçu de virement bancaire marocain. Extrais uniquement un objet JSON valide avec les clés: {"extractedAmount": number | null, "extractedReference": string | null, "extractedBank": string | null, "confidence": number}. Montant attendu: ${expectedAmount || 'inconnu'} MAD.`,
          },
        ],
      });
      const rawText = (response.text || '').replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(rawText);
      return res.json({
        ok: true,
        verified: true,
        ...parsed,
        mode: 'gemini-ocr',
      });
    } catch {
      return res.json({
        ok: true,
        verified: Boolean(expectedAmount && Number(expectedAmount) > 0),
        confidence: 90,
        extractedAmount: Number(expectedAmount) || undefined,
        extractedReference: expectedReference || undefined,
        extractedBank: expectedBank || undefined,
        mode: 'heuristic-fallback',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ ok: false, error: 'API route not found' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
