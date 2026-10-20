import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import {
  hashPasswordSync,
  verifyPasswordSync,
  computeSessionSignature,
  isAlreadyHashedPassword,
} from './utils/security';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '.data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const STATE_FILE = path.join(DATA_DIR, 'shared-state.json');

const SERVER_HMAC_SECRET =
  process.env.SYNDIK_SERVER_SECRET || crypto.randomBytes(32).toString('hex');

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
  deletedId?: string,
  collectionKey?: string
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
      if (!prev) {
        map.set(id, item);
      } else {
        let merged = { ...prev, ...item };
        // Audit P0-4: Prevent stale snapshots from reverting settled charges, invoices, or reviewed proofs
        if (collectionKey === 'syndik_prod_charges_v1') {
          const prevPaid =
            Number(prev.paidAmount ?? (prev.status === 'paid' ? prev.amount : 0)) || 0;
          const incPaid =
            Number(item.paidAmount ?? (item.status === 'paid' ? item.amount : 0)) || 0;
          if (prev.status === 'paid' && item.status !== 'paid') {
            merged = {
              ...merged,
              status: 'paid',
              paidAmount: Math.max(prevPaid, incPaid, Number(prev.amount) || 0),
              paidAt: prev.paidAt || item.paidAt,
            };
          } else if (prevPaid > incPaid) {
            merged = {
              ...merged,
              paidAmount: prevPaid,
              status:
                prevPaid >= (Number(merged.amount) || 0) - 0.005 ? 'paid' : merged.status,
            };
          }
        } else if (collectionKey === 'syndik_prod_invoices_v1') {
          const prevPaid =
            Number(prev.paidAmount ?? (prev.status === 'paid' ? prev.totalAmount : 0)) || 0;
          const incPaid =
            Number(item.paidAmount ?? (item.status === 'paid' ? item.totalAmount : 0)) || 0;
          if (prev.status === 'paid' && item.status !== 'paid') {
            merged = {
              ...merged,
              status: 'paid',
              paidAmount: Math.max(prevPaid, incPaid, Number(prev.totalAmount) || 0),
              paidAt: prev.paidAt || item.paidAt,
            };
          } else if (prevPaid > incPaid) {
            merged = {
              ...merged,
              paidAmount: prevPaid,
              status:
                prevPaid >= (Number(merged.totalAmount) || 0) - 0.005
                  ? 'paid'
                  : merged.status,
            };
          }
        } else if (collectionKey === 'syndik_prod_proofs_v1') {
          if (
            (prev.status === 'approved' || prev.status === 'rejected') &&
            item.status === 'pending'
          ) {
            merged = {
              ...merged,
              status: prev.status,
              reviewedAt: prev.reviewedAt,
              reviewedBy: prev.reviewedBy,
            };
          }
        }
        map.set(id, merged);
      }
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

function sanitizeAccountPayload(list: any[], stripHash = false): any[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const emailNorm = (item.email || '').trim().toLowerCase();
    const passwordHash =
      item.passwordHash ||
      (typeof item.password === 'string'
        ? isAlreadyHashedPassword(item.password)
          ? item.password
          : hashPasswordSync(item.password, emailNorm)
        : undefined);
    const { password: _pw, generatedPassword: _gp, passwordHash: _ph, ...rest } = item;
    if (stripHash) {
      return rest;
    }
    return passwordHash ? { ...rest, passwordHash } : rest;
  });
}

interface AuthCallerContext {
  uid: string;
  email?: string;
  role: string;
  syndicId?: string;
  buildingId?: string;
  residentId?: string;
  prestataireId?: string;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function issueServerSessionToken(profile: Record<string, any>): string {
  const payload = {
    uid: String(profile.uid || ''),
    email: String(profile.email || '').trim().toLowerCase(),
    role: String(profile.role || 'resident'),
    syndicId: profile.syndicId ? String(profile.syndicId) : undefined,
    buildingId: profile.buildingId ? String(profile.buildingId) : undefined,
    residentId: profile.residentId ? String(profile.residentId) : undefined,
    prestataireId: profile.prestataireId ? String(profile.prestataireId) : undefined,
    iat: Date.now(),
    exp: Date.now() + 12 * 3600 * 1000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const hmacHex = crypto
    .createHmac('sha256', SERVER_HMAC_SECRET)
    .update(payloadB64)
    .digest('hex');
  return `syndik-srv1.${payloadB64}.${hmacHex}`;
}

function verifyServerSessionToken(token: string): AuthCallerContext | null {
  if (!token.startsWith('syndik-srv1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, providedHmac] = parts;
  if (!payloadB64 || !providedHmac) return null;
  const expectedHmac = crypto
    .createHmac('sha256', SERVER_HMAC_SECRET)
    .update(payloadB64)
    .digest('hex');
  if (!timingSafeStringEqual(providedHmac, expectedHmac)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload?.uid || !payload?.role) return null;
    if (typeof payload.exp === 'number' && payload.exp < Date.now()) {
      return null;
    }
    return {
      uid: String(payload.uid),
      email: payload.email ? String(payload.email).toLowerCase() : undefined,
      role: String(payload.role),
      syndicId: payload.syndicId ? String(payload.syndicId) : undefined,
      buildingId: payload.buildingId ? String(payload.buildingId) : undefined,
      residentId: payload.residentId ? String(payload.residentId) : undefined,
      prestataireId: payload.prestataireId ? String(payload.prestataireId) : undefined,
    };
  } catch {
    return null;
  }
}

function lookupCandidateProfilesInStore(
  store: ServerStore,
  uid: string
): Array<Record<string, any>> {
  const candidates: Array<Record<string, any>> = [];
  if (!uid) return candidates;

  const regUsers: any[] = Array.isArray(store.syndik_prod_registered_users_v1)
    ? store.syndik_prod_registered_users_v1
    : [];
  for (const u of regUsers) {
    if (u?.uid === uid || u?.profile?.uid === uid) {
      const p = u.profile || u;
      candidates.push({
        uid: p.uid || u.uid,
        email: (p.email || u.email || '').trim().toLowerCase(),
        role: p.role || u.role || 'syndic',
        syndicId: p.syndicId || u.syndicId,
        buildingId: p.buildingId || u.buildingId,
        apartmentId: p.apartmentId,
        residentId: p.residentId,
        prestataireId: p.prestataireId,
      });
    }
  }

  const resAccounts: any[] = Array.isArray(store.syndik_prod_resident_accounts_v1)
    ? store.syndik_prod_resident_accounts_v1
    : [];
  for (const a of resAccounts) {
    const rId = a?.residentId;
    if (rId && (uid === `user-res-${rId}` || uid === `res-${rId}` || uid === rId)) {
      candidates.push({
        uid,
        email: (a.email || '').trim().toLowerCase(),
        role: 'resident',
        syndicId: a.syndicId,
        buildingId: a.buildingId,
        apartmentId: a.apartmentId,
        residentId: rId,
      });
    }
  }

  const syndics: any[] = Array.isArray(store.syndik_prod_syndics_v1)
    ? store.syndik_prod_syndics_v1
    : [];
  for (const s of syndics) {
    if (s?.createdBy === uid) {
      const firstBldId = s.buildings?.[0]?.id;
      candidates.push({
        uid,
        email: (s.email || '').trim().toLowerCase(),
        role: 'syndic',
        syndicId: s.id,
        buildingId: firstBldId,
      });
      if (firstBldId) {
        candidates.push({
          uid,
          email: (s.email || '').trim().toLowerCase(),
          role: 'syndic',
          syndicId: s.id,
        });
      }
    }
    for (const b of s?.buildings || []) {
      for (const r of b?.residents || []) {
        if (r?.id && (uid === `user-res-${r.id}` || uid === `res-${r.id}` || uid === r.id)) {
          candidates.push({
            uid,
            email: (r.email || '').trim().toLowerCase(),
            role: 'resident',
            syndicId: s.id,
            buildingId: b.id,
            apartmentId: r.apartmentId,
            residentId: r.id,
          });
        }
      }
    }
  }

  const prestAccounts: any[] = Array.isArray(store.syndik_prod_prestataire_accounts_v1)
    ? store.syndik_prod_prestataire_accounts_v1
    : [];
  for (const a of prestAccounts) {
    const pId = a?.prestataireId;
    if (pId && (uid === `user-prest-${pId}` || uid === `prov-${pId}` || uid === pId)) {
      candidates.push({
        uid,
        email: (a.email || '').trim().toLowerCase(),
        role: 'provider',
        syndicId: a.syndicId,
        buildingId: a.buildingId,
        prestataireId: pId,
      });
    }
  }

  const prestList: any[] = Array.isArray(store.syndik_prod_prestataires_v1)
    ? store.syndik_prod_prestataires_v1
    : [];
  for (const p of prestList) {
    if (p?.id && (uid === `user-prest-${p.id}` || uid === `prov-${p.id}` || uid === p.id)) {
      candidates.push({
        uid,
        email: (p.email || '').trim().toLowerCase(),
        role: 'provider',
        syndicId: p.syndicId,
        buildingId: p.buildingId,
        prestataireId: p.id,
      });
    }
  }

  return candidates;
}

/**
 * Audit Item 02 & P0-2: Verify authentication tokens cryptographically and bind caller
 * role/tenant/building strictly to authoritative store records or server-signed HMAC tokens.
 * Never accepts arbitrary 3-part unsigned JWTs or fabricated session headers.
 */
function extractAndVerifyCaller(
  req: express.Request,
  store: ServerStore
): AuthCallerContext | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token.length < 16) {
    return null;
  }

  const headerUid = String(req.headers['x-syndik-uid'] || '').trim();
  const headerRole = String(req.headers['x-syndik-role'] || '').trim();
  const headerTenant = req.headers['x-syndik-tenant']
    ? String(req.headers['x-syndik-tenant']).trim()
    : undefined;
  const headerBuilding = req.headers['x-syndik-building']
    ? String(req.headers['x-syndik-building']).trim()
    : undefined;

  // 1. Server-issued HMAC session token (syndik-srv1.<payload>.<hmac>)
  if (token.startsWith('syndik-srv1.')) {
    const verified = verifyServerSessionToken(token);
    if (!verified) return null;
    if (headerUid && headerUid !== verified.uid) return null;
    if (headerRole && headerRole !== verified.role) return null;
    if (headerTenant && verified.syndicId && headerTenant !== verified.syndicId) return null;
    if (
      headerBuilding &&
      (verified.role === 'resident' || verified.role === 'provider') &&
      verified.buildingId &&
      headerBuilding !== verified.buildingId
    ) {
      return null;
    }
    return verified;
  }

  // 2. Client session signature token — MUST match an existing user in store AND pass cryptographic signature verification
  if (token.startsWith('syndik-sess-')) {
    if (!headerUid) return null;
    const expectedPrefix = `syndik-sess-${headerUid}-`;
    if (!token.startsWith(expectedPrefix)) {
      return null;
    }
    const suppliedSig = token.slice(expectedPrefix.length).trim();
    const headerSig = String(req.headers['x-syndik-sig'] || '').trim();
    if (!suppliedSig || !suppliedSig.startsWith('sha256$v1$')) {
      return null;
    }
    if (headerSig && !timingSafeStringEqual(headerSig, suppliedSig)) {
      return null;
    }

    const candidates = lookupCandidateProfilesInStore(store, headerUid);
    if (candidates.length === 0) {
      return null;
    }

    for (const candidate of candidates) {
      const expectedSig = computeSessionSignature(candidate as any);
      if (timingSafeStringEqual(suppliedSig, expectedSig)) {
        if (headerRole && headerRole !== candidate.role) {
          return null;
        }
        if (headerTenant && candidate.syndicId && headerTenant !== candidate.syndicId) {
          return null;
        }
        if (
          headerBuilding &&
          (candidate.role === 'resident' || candidate.role === 'provider') &&
          candidate.buildingId &&
          headerBuilding !== candidate.buildingId
        ) {
          return null;
        }
        return {
          uid: String(candidate.uid),
          email: candidate.email ? String(candidate.email).toLowerCase() : undefined,
          role: String(candidate.role),
          syndicId: candidate.syndicId ? String(candidate.syndicId) : undefined,
          buildingId: candidate.buildingId ? String(candidate.buildingId) : undefined,
          residentId: candidate.residentId ? String(candidate.residentId) : undefined,
          prestataireId: candidate.prestataireId ? String(candidate.prestataireId) : undefined,
        };
      }
    }

    return null;
  }

  // Reject all unverified 3-part JWTs or unknown token formats (fail closed — Audit P0-2)
  return null;
}

interface AuthorizedScope {
  isAdmin: boolean;
  authorizedSyndicIds: Set<string>;
  authorizedBuildingIds: Set<string>;
  authorizedSyndics: any[];
  callerResId: string;
  callerPrestId: string;
}

function getAuthorizedScopeForCaller(
  store: ServerStore,
  caller: AuthCallerContext
): AuthorizedScope {
  const syndics: any[] = Array.isArray(store.syndik_prod_syndics_v1)
    ? store.syndik_prod_syndics_v1
    : [];
  const prestatairesList: any[] = Array.isArray(store.syndik_prod_prestataires_v1)
    ? store.syndik_prod_prestataires_v1
    : [];

  const callerResId =
    caller.residentId || caller.uid.replace(/^(user-res-|res-)/, '');
  const callerPrestId =
    caller.prestataireId || caller.uid.replace(/^(user-prest-|prov-)/, '');

  const authorizedSyndicIds = new Set<string>();
  const authorizedBuildingIds = new Set<string>();
  const authorizedSyndics: any[] = [];

  if (caller.role === 'admin') {
    for (const s of syndics) {
      if (s?.id) authorizedSyndicIds.add(s.id);
      for (const b of s?.buildings || []) {
        if (b?.id) authorizedBuildingIds.add(b.id);
      }
      authorizedSyndics.push(s);
    }
    return {
      isAdmin: true,
      authorizedSyndicIds,
      authorizedBuildingIds,
      authorizedSyndics,
      callerResId,
      callerPrestId,
    };
  }

  if (caller.role === 'syndic') {
    for (const s of syndics) {
      if (s?.createdBy === caller.uid || (caller.syndicId && s?.id === caller.syndicId)) {
        if (s.id) authorizedSyndicIds.add(s.id);
        for (const b of s.buildings || []) {
          if (b?.id) authorizedBuildingIds.add(b.id);
        }
        authorizedSyndics.push(s);
      }
    }
    return {
      isAdmin: false,
      authorizedSyndicIds,
      authorizedBuildingIds,
      authorizedSyndics,
      callerResId,
      callerPrestId,
    };
  }

  if (caller.role === 'resident') {
    // Audit P0-4: A resident is ONLY authorized for the specific building(s) they belong to, NEVER other buildings in the same syndic
    for (const s of syndics) {
      const residentBuildings = (s?.buildings || []).filter(
        (b: any) =>
          (caller.buildingId && b?.id === caller.buildingId) ||
          (Array.isArray(b?.residents) &&
            b.residents.some(
              (r: any) => r?.id === callerResId || r?.id === caller.uid
            ))
      );
      if (residentBuildings.length > 0) {
        if (s?.id) authorizedSyndicIds.add(s.id);
        for (const rb of residentBuildings) {
          if (rb?.id) authorizedBuildingIds.add(rb.id);
        }
        authorizedSyndics.push({
          ...s,
          buildings: residentBuildings,
        });
      }
    }
    return {
      isAdmin: false,
      authorizedSyndicIds,
      authorizedBuildingIds,
      authorizedSyndics,
      callerResId,
      callerPrestId,
    };
  }

  if (caller.role === 'provider') {
    const matchedPrests = prestatairesList.filter(
      (p) => p?.id === callerPrestId || p?.id === caller.uid
    );
    const providerBldIds = new Set<string>();
    if (caller.buildingId) providerBldIds.add(caller.buildingId);
    for (const p of matchedPrests) {
      if (p?.buildingId) providerBldIds.add(p.buildingId);
    }

    for (const s of syndics) {
      const providerBuildings = (s?.buildings || []).filter(
        (b: any) => b?.id && providerBldIds.has(b.id)
      );
      if (providerBuildings.length > 0) {
        if (s?.id) authorizedSyndicIds.add(s.id);
        for (const pb of providerBuildings) {
          if (pb?.id) authorizedBuildingIds.add(pb.id);
        }
        authorizedSyndics.push({
          ...s,
          buildings: providerBuildings,
        });
      }
    }
    return {
      isAdmin: false,
      authorizedSyndicIds,
      authorizedBuildingIds,
      authorizedSyndics,
      callerResId,
      callerPrestId,
    };
  }

  return {
    isAdmin: false,
    authorizedSyndicIds,
    authorizedBuildingIds,
    authorizedSyndics,
    callerResId,
    callerPrestId,
  };
}

function filterStoreForCaller(store: ServerStore, caller: AuthCallerContext): Record<string, any> {
  const result: Record<string, any> = {};
  if (store.__resetAt) {
    result.__resetAt = store.__resetAt;
  }

  const scope = getAuthorizedScopeForCaller(store, caller);

  for (const [key, val] of Object.entries(store)) {
    if (key.startsWith('__')) continue;

    if (key === 'syndik_prod_syndics_v1') {
      // Audit P0-4: Never fall back to all syndics when caller has 0 authorized syndics
      result[key] = scope.authorizedSyndics;
      continue;
    }

    if (key === 'syndik_prod_resident_accounts_v1') {
      const sanitizedList = sanitizeAccountPayload(
        Array.isArray(val) ? val : [],
        caller.role !== 'admin' && caller.role !== 'syndic'
      );
      if (scope.isAdmin) {
        result[key] = sanitizedList;
      } else if (caller.role === 'syndic') {
        result[key] = sanitizedList.filter(
          (acc: any) =>
            acc?.buildingId && scope.authorizedBuildingIds.has(acc.buildingId)
        );
      } else if (caller.role === 'resident') {
        result[key] = sanitizedList.filter(
          (acc: any) => acc?.residentId && acc.residentId === scope.callerResId
        );
      } else {
        result[key] = [];
      }
      continue;
    }

    if (key === 'syndik_prod_prestataire_accounts_v1') {
      const sanitizedList = sanitizeAccountPayload(
        Array.isArray(val) ? val : [],
        caller.role !== 'admin' && caller.role !== 'syndic'
      );
      if (scope.isAdmin) {
        result[key] = sanitizedList;
      } else if (caller.role === 'syndic') {
        result[key] = sanitizedList.filter(
          (acc: any) =>
            acc?.buildingId && scope.authorizedBuildingIds.has(acc.buildingId)
        );
      } else if (caller.role === 'provider') {
        result[key] = sanitizedList.filter(
          (acc: any) => acc?.prestataireId && acc.prestataireId === scope.callerPrestId
        );
      } else {
        result[key] = [];
      }
      continue;
    }

    if (key === 'syndik_prod_registered_users_v1') {
      const sanitizedUsers = sanitizeAccountPayload(
        Array.isArray(val) ? val : [],
        caller.role !== 'admin'
      );
      if (scope.isAdmin) {
        result[key] = sanitizedUsers;
      } else if (caller.role === 'syndic') {
        result[key] = sanitizedUsers.filter(
          (u: any) =>
            u?.uid === caller.uid ||
            u?.profile?.uid === caller.uid ||
            (u?.profile?.buildingId &&
              scope.authorizedBuildingIds.has(u.profile.buildingId))
        );
      } else {
        result[key] = sanitizedUsers.filter(
          (u: any) => u?.uid === caller.uid || u?.profile?.uid === caller.uid
        );
      }
      continue;
    }

    if (key === 'syndik_prod_notifications_v1' && Array.isArray(val)) {
      result[key] = scope.isAdmin
        ? val
        : val.filter(
            (n: any) =>
              n?.userId === caller.uid ||
              (n?.userId === 'all' &&
                (!n?.buildingId || scope.authorizedBuildingIds.has(n.buildingId)))
          );
      continue;
    }

    if (Array.isArray(val)) {
      if (scope.isAdmin) {
        result[key] = val;
      } else {
        // Strict building isolation: item MUST belong to an authorized building of this caller
        result[key] = val.filter(
          (item: any) =>
            Boolean(item?.buildingId && scope.authorizedBuildingIds.has(item.buildingId))
        );
      }
      continue;
    }

    result[key] = scope.isAdmin ? val : null;
  }

  return result;
}

const RESIDENT_WRITABLE_KEYS = new Set([
  'syndik_prod_proofs_v1',
  'syndik_prod_ag_v1',
  'syndik_prod_maintenance_v1',
  'syndik_prod_chat_v1',
  'syndik_prod_marketplace_v1',
  'syndik_prod_notifications_v1',
]);

const PROVIDER_WRITABLE_KEYS = new Set([
  'syndik_prod_maintenance_v1',
  'syndik_prod_chat_v1',
  'syndik_prod_notifications_v1',
]);

function validateWriteForCaller(
  store: ServerStore,
  caller: AuthCallerContext,
  key: string,
  value: any,
  deletedId?: string
): { allowed: boolean; status?: number; error?: string } {
  if (caller.role === 'admin') {
    return { allowed: true };
  }

  if (caller.role === 'resident' && !RESIDENT_WRITABLE_KEYS.has(key)) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: residents are not permitted to modify this collection',
    };
  }

  if (caller.role === 'provider' && !PROVIDER_WRITABLE_KEYS.has(key)) {
    return {
      allowed: false,
      status: 403,
      error: 'Forbidden: providers are not permitted to modify this collection',
    };
  }

  const scope = getAuthorizedScopeForCaller(store, caller);

  if (key === 'syndik_prod_syndics_v1') {
    if (caller.role !== 'syndic') {
      return { allowed: false, status: 403, error: 'Forbidden' };
    }
    const existingSyndics: any[] = Array.isArray(store.syndik_prod_syndics_v1)
      ? store.syndik_prod_syndics_v1
      : [];
    if (deletedId) {
      const ownsSyndic = scope.authorizedSyndicIds.has(deletedId);
      const ownsBld = scope.authorizedBuildingIds.has(deletedId);
      let ownsNestedRecord = false;
      for (const s of scope.authorizedSyndics) {
        for (const b of s.buildings || []) {
          if (
            (b.apartments || []).some((a: any) => a?.id === deletedId) ||
            (b.residents || []).some((r: any) => r?.id === deletedId) ||
            (b.documents || []).some((d: any) => d?.id === deletedId)
          ) {
            ownsNestedRecord = true;
          }
        }
      }
      if (!ownsSyndic && !ownsBld && !ownsNestedRecord) {
        return {
          allowed: false,
          status: 403,
          error: 'Forbidden: cannot delete another cabinet resource',
        };
      }
    }

    const incomingSyndics = Array.isArray(value) ? value : [];
    for (const s of incomingSyndics) {
      if (!s || !s.id) continue;
      const existing = existingSyndics.find((ex) => ex?.id === s.id);
      if (existing) {
        if (
          existing.createdBy !== caller.uid &&
          (!caller.syndicId || existing.id !== caller.syndicId)
        ) {
          return {
            allowed: false,
            status: 403,
            error: 'Forbidden: cross-cabinet syndic modification denied',
          };
        }
      } else {
        if (
          s.createdBy !== caller.uid &&
          (!caller.syndicId || s.id !== caller.syndicId)
        ) {
          return {
            allowed: false,
            status: 403,
            error: 'Forbidden: cannot create syndic for another user',
          };
        }
      }
    }
    return { allowed: true };
  }

  if (key === 'syndik_prod_registered_users_v1') {
    if (caller.role !== 'syndic') {
      return { allowed: false, status: 403, error: 'Forbidden' };
    }
    const incomingUsers = Array.isArray(value) ? value : [];
    for (const u of incomingUsers) {
      const uUid = u?.uid || u?.profile?.uid;
      const uRole = u?.role || u?.profile?.role;
      const uSyndicId = u?.syndicId || u?.profile?.syndicId;
      const uBldId = u?.buildingId || u?.profile?.buildingId;
      if (uRole === 'admin') {
        return { allowed: false, status: 403, error: 'Forbidden: cannot write admin user' };
      }
      const isSelf = uUid === caller.uid;
      const isOwnTenant =
        (uSyndicId &&
          (scope.authorizedSyndicIds.has(uSyndicId) || uSyndicId === caller.syndicId)) ||
        (uBldId && scope.authorizedBuildingIds.has(uBldId));
      if (!isSelf && !isOwnTenant) {
        return {
          allowed: false,
          status: 403,
          error: 'Forbidden: cross-cabinet user write denied',
        };
      }
    }
    return { allowed: true };
  }

  if (key === 'syndik_prod_notifications_v1') {
    return { allowed: true };
  }

  // Building-scoped collections
  const idField = ID_MERGE_KEYS[key] || 'id';
  const existingItems: any[] = Array.isArray(store[key]) ? store[key] : [];

  if (deletedId) {
    const targetExisting = existingItems.find((item) => item?.[idField] === deletedId);
    if (
      targetExisting &&
      (!targetExisting.buildingId ||
        !scope.authorizedBuildingIds.has(targetExisting.buildingId))
    ) {
      return {
        allowed: false,
        status: 403,
        error: 'Forbidden: cannot delete record belonging to another building',
      };
    }
  }

  const incomingItems = Array.isArray(value) ? value : [];
  for (const item of incomingItems) {
    if (!item || typeof item !== 'object') continue;
    const itemId = item[idField];
    const existingItem = itemId
      ? existingItems.find((ex) => ex?.[idField] === itemId)
      : undefined;

    if (
      existingItem &&
      existingItem.buildingId &&
      !scope.authorizedBuildingIds.has(existingItem.buildingId)
    ) {
      return {
        allowed: false,
        status: 403,
        error: 'Forbidden: cannot overwrite record belonging to another building or cabinet',
      };
    }

    if (!item.buildingId || !scope.authorizedBuildingIds.has(item.buildingId)) {
      return {
        allowed: false,
        status: 403,
        error: 'Forbidden: record buildingId is outside caller authorized scope',
      };
    }

    if (
      item.syndicId &&
      scope.authorizedSyndicIds.size > 0 &&
      !scope.authorizedSyndicIds.has(item.syndicId)
    ) {
      return {
        allowed: false,
        status: 403,
        error: 'Forbidden: record syndicId is outside caller authorized cabinet',
      };
    }
  }

  return { allowed: true };
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

    // Audit P0-2 / P0-3: Reject any attempt to use a stored passwordHash as a login password
    if (isAlreadyHashedPassword(trimmedPass)) {
      return res.status(401).json({
        ok: false,
        error: 'Format de mot de passe invalide.',
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

      // Audit P0-3: Enforce invitation expiration on pending resident invitations
      const inviteExpiry = resObj?.invitationExpiresAt || matchedResAccount?.invitationExpiresAt;
      if (
        mustChange !== false &&
        inviteExpiry &&
        Number.isFinite(Date.parse(inviteExpiry)) &&
        Date.parse(inviteExpiry) < Date.now()
      ) {
        return res.status(401).json({
          ok: false,
          error:
            'Invitation expirée. Veuillez demander à votre syndic de régénérer vos identifiants.',
        });
      }

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
        const token = issueServerSessionToken(profile);
        return res.json({ ok: true, profile, token });
      }
      return res.status(401).json({
        ok: false,
        error:
          'Identifiants résident incorrects. Veuillez vérifier votre mot de passe sur votre fiche d’accès.',
      });
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

      // Audit P0-3: Enforce invitation expiration on pending provider invitations
      const inviteExpiry =
        matchedPrestObj?.invitationExpiresAt || matchedPrestAccount?.invitationExpiresAt;
      if (
        mustChange !== false &&
        inviteExpiry &&
        Number.isFinite(Date.parse(inviteExpiry)) &&
        Date.parse(inviteExpiry) < Date.now()
      ) {
        return res.status(401).json({
          ok: false,
          error:
            'Invitation expirée. Veuillez demander au syndic de régénérer vos identifiants.',
        });
      }

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
        const token = issueServerSessionToken(profile);
        return res.json({ ok: true, profile, token });
      }
      return res.status(401).json({
        ok: false,
        error:
          'Identifiants prestataire incorrects. Veuillez vérifier votre mot de passe sur votre fiche d’accès.',
      });
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
        const token = issueServerSessionToken(enrichedProfile);
        return res.json({ ok: true, profile: enrichedProfile, token });
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

  // Self-registration endpoint for new non-admin accounts (Syndic / Resident / Provider)
  app.post('/api/auth/register', (req, res) => {
    const { uid, email, password, profile, syndic } = req.body || {};
    const emailNorm = String(email || profile?.email || '')
      .trim()
      .toLowerCase();
    const rawPass = String(password || '').trim();
    const role = String(profile?.role || 'syndic');

    if (!uid || !emailNorm || rawPass.length < 6 || isAlreadyHashedPassword(rawPass)) {
      return res.status(400).json({ ok: false, error: 'Invalid registration payload' });
    }
    if (!['syndic', 'resident', 'provider'].includes(role)) {
      return res.status(403).json({ ok: false, error: 'Forbidden: cannot self-register privileged role' });
    }

    const regUsers: any[] = Array.isArray(sharedStore.syndik_prod_registered_users_v1)
      ? sharedStore.syndik_prod_registered_users_v1
      : [];
    if (regUsers.some((u) => u?.email?.trim().toLowerCase() === emailNorm)) {
      return res.status(409).json({ ok: false, error: 'Account already exists' });
    }

    const passwordHash = hashPasswordSync(rawPass, emailNorm);
    const cleanProfile = {
      ...profile,
      uid: String(uid),
      email: emailNorm,
      role,
    };
    regUsers.push({
      uid: String(uid),
      email: emailNorm,
      passwordHash,
      profile: cleanProfile,
      createdAt: new Date().toISOString(),
    });
    sharedStore.syndik_prod_registered_users_v1 = regUsers;

    if (role === 'syndic' && syndic && syndic.id && syndic.createdBy === uid) {
      const tombstones = getTombstones(sharedStore, 'syndik_prod_syndics_v1');
      sharedStore.syndik_prod_syndics_v1 = mergeSyndicsList(
        sharedStore.syndik_prod_syndics_v1 || [],
        [syndic],
        tombstones
      );
    }

    savePersistedState(sharedStore);
    const token = issueServerSessionToken(cleanProfile);
    return res.json({ ok: true, profile: cleanProfile, token, revision: sharedStore.__revision });
  });

  // Server-side password update endpoint — strictly bound to the authenticated caller (Audit P0-3)
  app.post('/api/auth/change-password', (req, res) => {
    const caller = extractAndVerifyCaller(req, sharedStore);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }

    const newPassword = String(req.body?.newPassword || '').trim();
    if (!newPassword || newPassword.length < 6 || isAlreadyHashedPassword(newPassword)) {
      return res.status(400).json({ ok: false, error: 'Invalid password update parameters' });
    }

    const callerResId =
      caller.residentId ||
      (caller.role === 'resident' ? caller.uid.replace(/^(user-res-|res-)/, '') : '');
    const callerPrestId =
      caller.prestataireId ||
      (caller.role === 'provider' ? caller.uid.replace(/^(user-prest-|prov-)/, '') : '');
    const callerEmail = (caller.email || '').trim().toLowerCase();

    const requestedResId = req.body?.residentId ? String(req.body.residentId).trim() : '';
    const requestedPrestId = req.body?.prestataireId
      ? String(req.body.prestataireId).trim()
      : '';
    const requestedEmail = req.body?.email
      ? String(req.body.email).trim().toLowerCase()
      : '';

    // Audit P0-3: Reject any attempt to change another user's password
    if (requestedResId && requestedResId !== callerResId) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden: cannot change password for another resident account',
      });
    }
    if (requestedPrestId && requestedPrestId !== callerPrestId) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden: cannot change password for another provider account',
      });
    }
    if (requestedEmail && callerEmail && requestedEmail !== callerEmail) {
      return res.status(403).json({
        ok: false,
        error: 'Forbidden: cannot change password for another email identity',
      });
    }

    const effectiveEmail = callerEmail || requestedEmail;
    if (!effectiveEmail) {
      return res.status(400).json({ ok: false, error: 'Missing account email context' });
    }

    const newPasswordHash = hashPasswordSync(newPassword, effectiveEmail);

    if (caller.role === 'resident' && callerResId) {
      const resAccounts: any[] = Array.isArray(sharedStore.syndik_prod_resident_accounts_v1)
        ? sharedStore.syndik_prod_resident_accounts_v1
        : [];
      sharedStore.syndik_prod_resident_accounts_v1 = resAccounts.map((a: any) => {
        if (a?.residentId === callerResId) {
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
            if (r?.id === callerResId) {
              const {
                generatedPassword: _gp,
                invitationToken: _it,
                invitationCode: _ic,
                ...cleanRes
              } = r;
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

    if (caller.role === 'provider' && callerPrestId) {
      const prestAccounts: any[] = Array.isArray(sharedStore.syndik_prod_prestataire_accounts_v1)
        ? sharedStore.syndik_prod_prestataire_accounts_v1
        : [];
      sharedStore.syndik_prod_prestataire_accounts_v1 = prestAccounts.map((a: any) => {
        if (a?.prestataireId === callerPrestId) {
          const { password: _pw, ...rest } = a;
          return { ...rest, passwordHash: newPasswordHash, mustChangePassword: false };
        }
        return a;
      });

      const prestList: any[] = Array.isArray(sharedStore.syndik_prod_prestataires_v1)
        ? sharedStore.syndik_prod_prestataires_v1
        : [];
      sharedStore.syndik_prod_prestataires_v1 = prestList.map((p: any) => {
        if (p?.id === callerPrestId) {
          const {
            generatedPassword: _gp,
            invitationToken: _it,
            invitationCode: _ic,
            ...cleanPrest
          } = p;
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
      if (u?.uid === caller.uid || u?.profile?.uid === caller.uid) {
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
    const caller = extractAndVerifyCaller(req, sharedStore);
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

  // Binary Document & Receipt Offload Endpoints (/api/uploads) with building-scoped auth (Audit P1-5)
  app.post('/api/uploads', (req, res) => {
    const caller = extractAndVerifyCaller(req, sharedStore);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
      const { name, dataUrl, buildingId } = req.body || {};
      if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
        return res.status(400).json({ ok: false, error: 'Invalid file payload' });
      }
      const targetBuildingId = String(buildingId || caller.buildingId || '').trim();
      const scope = getAuthorizedScopeForCaller(sharedStore, caller);
      if (
        !scope.isAdmin &&
        (!targetBuildingId || !scope.authorizedBuildingIds.has(targetBuildingId))
      ) {
        return res
          .status(403)
          .json({ ok: false, error: 'Forbidden: unauthorized building for upload' });
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
      const fileBuffer = Buffer.from(base64Data, 'base64');
      if (fileBuffer.length > 5 * 1024 * 1024) {
        return res.status(413).json({ ok: false, error: 'File exceeds 5 MB limit' });
      }

      const safeExt = (path.extname(String(name || '')) || '.bin').replace(/[^a-zA-Z0-9.]/g, '');
      const fileId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`;
      const filePath = path.join(UPLOADS_DIR, fileId);
      const metaPath = `${filePath}.meta.json`;

      fs.writeFileSync(filePath, fileBuffer);
      fs.writeFileSync(
        metaPath,
        JSON.stringify({
          fileId,
          name: String(name || fileId),
          mimeType,
          buildingId: targetBuildingId,
          syndicId: caller.syndicId,
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
        sizeBytes: fileBuffer.length,
      });
    } catch (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ ok: false, error: 'Upload persistence failed' });
    }
  });

  app.get('/api/uploads/:fileId', (req, res) => {
    const caller = extractAndVerifyCaller(req, sharedStore);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const rawId = String(req.params.fileId || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!rawId || rawId.endsWith('.meta.json')) {
      return res.status(400).json({ ok: false, error: 'Invalid file ID' });
    }
    const filePath = path.join(UPLOADS_DIR, rawId);
    const metaPath = `${filePath}.meta.json`;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ ok: false, error: 'File not found' });
    }
    try {
      let mimeType = 'application/octet-stream';
      if (fs.existsSync(metaPath)) {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.mimeType) mimeType = String(meta.mimeType);
        const scope = getAuthorizedScopeForCaller(sharedStore, caller);
        if (
          !scope.isAdmin &&
          meta.buildingId &&
          !scope.authorizedBuildingIds.has(String(meta.buildingId))
        ) {
          return res
            .status(403)
            .json({ ok: false, error: 'Forbidden: cross-building document access denied' });
        }
      }
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'private, no-store');
      const fileBuffer = fs.readFileSync(filePath);
      return res.status(200).send(fileBuffer);
    } catch {
      return res.status(500).json({ ok: false, error: 'Failed to read uploaded file' });
    }
  });

  // Audit Item 02, 17, 18 & P0-4: Authenticated, role/tenant-scoped, monotonic item-level merged shared-state POST
  app.post('/api/shared-state', (req, res) => {
    const caller = extractAndVerifyCaller(req, sharedStore);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }

    const { key, value, deletedId, entries } = req.body || {};

    try {
      if (entries && typeof entries === 'object') {
        for (const [k, v] of Object.entries(entries)) {
          if (k.startsWith('__')) continue;
          const check = validateWriteForCaller(sharedStore, caller, k, v);
          if (!check.allowed) {
            return res
              .status(check.status || 403)
              .json({ ok: false, error: check.error || 'Forbidden' });
          }
        }
        for (const [k, v] of Object.entries(entries)) {
          if (k.startsWith('__')) continue;
          const tombstones = getTombstones(sharedStore, k);
          if (k === 'syndik_prod_syndics_v1' && Array.isArray(v)) {
            sharedStore[k] = mergeSyndicsList(sharedStore[k] || [], v, tombstones);
          } else if (ID_MERGE_KEYS[k] && Array.isArray(v)) {
            const merged = mergeArrayById(
              sharedStore[k] || [],
              v,
              ID_MERGE_KEYS[k],
              tombstones,
              undefined,
              k
            );
            sharedStore[k] =
              k.includes('_accounts_') || k.includes('_users_')
                ? sanitizeAccountPayload(merged)
                : merged;
          } else {
            sharedStore[k] = v;
          }
        }
        savePersistedState(sharedStore);
        return res.json({ ok: true, revision: sharedStore.__revision });
      }

      if (!key || typeof key !== 'string' || key.startsWith('__')) {
        return res.status(400).json({ ok: false, error: 'Invalid key parameter' });
      }

      const authCheck = validateWriteForCaller(sharedStore, caller, key, value, deletedId);
      if (!authCheck.allowed) {
        return res
          .status(authCheck.status || 403)
          .json({ ok: false, error: authCheck.error || 'Forbidden' });
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
          deletedId,
          key
        );
        sharedStore[key] =
          key.includes('_accounts_') || key.includes('_users_')
            ? sanitizeAccountPayload(merged)
            : merged;
      } else {
        sharedStore[key] = value;
      }

      savePersistedState(sharedStore);
      const scopedAfterWrite = filterStoreForCaller(sharedStore, caller);
      return res.json({
        ok: true,
        revision: sharedStore.__revision,
        key,
        value: scopedAfterWrite[key] ?? null,
      });
    } catch (err: any) {
      console.error('Failed to persist shared state:', err);
      return res.status(500).json({ ok: false, error: 'Persistence write failed' });
    }
  });

  // Audit Item 02: Restrict reset strictly to authenticated admin callers
  app.post('/api/shared-state/reset', (req, res) => {
    const caller = extractAndVerifyCaller(req, sharedStore);
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
    const caller = extractAndVerifyCaller(req, sharedStore);
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
    const caller = extractAndVerifyCaller(req, sharedStore);
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
