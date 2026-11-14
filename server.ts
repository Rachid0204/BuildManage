import express from 'express';
import { z } from 'zod';
import {
  installAiBodyParsers,
  registerAiEndpoints,
} from './server/aiEndpoints';
import { projectAssemblyForRole } from './server/assemblyPrivacy';
import { privateAttachments } from './server/attachments';
import { DependencyError } from './server/dependencyErrors';
import {
  CommandEnvelopeSchema,
  CommandIdentitySchema,
} from './server/domain/commandContracts';
import {
  createIdentityAction,
  registerIdentityRoutes,
} from './server/identity';
import {
  assertIdentityReady,
  identityMutationActor,
  identityRequestFingerprint,
  identityTransaction,
  pendingIdentityPlanId,
  queueFirebaseMutation,
  resumeIdentityMutations,
  resumeQueuedIdentityMutation,
} from './server/identityMutations';
import {
  assertFreshOperationId,
  LifecycleError,
  runLifecycle,
} from './server/lifecycle';
import {
  decrypt,
  deliverOutbox,
  encrypt,
  mailIsConfigured,
} from './server/mailer';
import { monthlyBillingJob } from './server/monthlyBillingJob';
import {
  actorIdentity,
  appendAudit,
  authorizeBillingBuilding,
  buildingFor,
  canWrite,
  generateScheduledMonthlyCharges,
  monthlyBillingHttpStatus,
  OperationError,
  recomputeMeeting,
  runOperation,
} from './server/operations';
import {
  operationActorScope,
  readOperationStatus,
} from './server/operationStatus';
import { hashPassword, verifyPassword } from './server/passwords';
import { validateProductionEnvironment } from './server/productionConfig';
import { registerLiveUpdates } from './server/realtime';
import {
  createAdmissionStore,
  registrationAdmission,
} from './server/registrationAdmission';
import { buildingReport } from './server/reports';
import {
  createRepository,
  currentState,
  sharedState,
} from './server/repository';
import { firebaseLinkedResidentIds } from './server/residentIdentity';
import {
  lifecycleStorage,
  readPrivateFile,
  savePrivateFile,
} from './server/uploads';

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import firebaseConfig from './firebase-applet-config.json';
import {
  accountUid,
  bindFirebaseAccount,
  executeFirebaseMutation,
  firebaseAdminAuth,
  firebasePasswordLogin,
  firebaseSessionUser,
  identityAccounts,
  migrateLegacyLogin,
  planFirebasePassword,
  registerFirebaseAccount,
  sendFirebaseVerification,
  usesFirebaseAuth,
} from './server/firebaseIdentity';
import type { AssembleeGenerale, Building } from './types';
import { applyResidentVote } from './utils/agVoting';
import {
  getBuildingReserveRate,
  isAlreadyHashedPassword,
} from './utils/security';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.SYNDIK_DATA_DIR || path.join(__dirname, ".data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

const HAS_CONFIGURED_SERVER_SECRET = (process.env.SYNDIK_SERVER_SECRET?.length || 0) >= 32;
const HAS_CONFIGURED_SESSION_SECRET = (process.env.SYNDIK_SESSION_SECRET?.length || 0) >= 32 || HAS_CONFIGURED_SERVER_SECRET;
const LEGACY_SERVER_SECRET = HAS_CONFIGURED_SERVER_SECRET
  ? process.env.SYNDIK_SERVER_SECRET!
  : process.env.NODE_ENV === "production" ? "" : crypto.randomBytes(32).toString("hex");
const SESSION_HMAC_SECRET = (process.env.SYNDIK_SESSION_SECRET?.length || 0) >= 32
  ? process.env.SYNDIK_SESSION_SECRET!
  : LEGACY_SERVER_SECRET;

interface ServerStore {
  __revision?: number;
  __resetAt?: number;
  __deletedIds?: Record<string, string[]>;
  [key: string]: any;
}

interface AuthCallerContext {
  sessionVersion?: number;
  firebaseAuthTime?: number;
  uid: string;
  email?: string;
  role: string;
  syndicId?: string;
  buildingId?: string;
  residentId?: string;
  prestataireId?: string;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(String(a || ""), "utf8");
  const bufB = Buffer.from(String(b || ""), "utf8");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function issueServerSessionToken(profile: Record<string, any>): string {
  const payload = {
    uid: String(profile.uid || ""),
    email: String(profile.email || "")
      .trim()
      .toLowerCase(),
    role: String(profile.role || "resident"),
    syndicId: profile.syndicId ? String(profile.syndicId) : undefined,
    buildingId: profile.buildingId ? String(profile.buildingId) : undefined,
    residentId: profile.residentId ? String(profile.residentId) : undefined,
    prestataireId: profile.prestataireId
      ? String(profile.prestataireId)
      : undefined,
    sessionVersion: currentState().__sessionVersions?.[profile.uid] || 0,
    firebaseAuthTime: profile.firebaseAuthTime,
    iat: Date.now(),
    exp: Date.now() + 12 * 3600 * 1000,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const hmacHex = crypto
    .createHmac("sha256", SESSION_HMAC_SECRET)
    .update(payloadB64)
    .digest("hex");
  return `syndik-srv1.${payloadB64}.${hmacHex}`;
}

function verifyServerSessionToken(token: string): AuthCallerContext | null {
  if (!token.startsWith("syndik-srv1.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [, payloadB64, providedHmac] = parts;
  if (!payloadB64 || !providedHmac) return null;
  const expectedHmac = crypto
    .createHmac("sha256", SESSION_HMAC_SECRET)
    .update(payloadB64)
    .digest("hex");
  if (!timingSafeStringEqual(providedHmac, expectedHmac)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    );
    if (!payload?.uid || !payload?.role) return null;
    if (typeof payload.exp === "number" && payload.exp < Date.now()) {
      return null;
    }
    return {
      sessionVersion: Number(payload.sessionVersion || 0),
      firebaseAuthTime: typeof payload.firebaseAuthTime === "number" ? payload.firebaseAuthTime : undefined,
      uid: String(payload.uid),
      email: payload.email ? String(payload.email).toLowerCase() : undefined,
      role: String(payload.role),
      syndicId: payload.syndicId ? String(payload.syndicId) : undefined,
      buildingId: payload.buildingId ? String(payload.buildingId) : undefined,
      residentId: payload.residentId ? String(payload.residentId) : undefined,
      prestataireId: payload.prestataireId
        ? String(payload.prestataireId)
        : undefined,
    };
  } catch {
    return null;
  }
}

function lookupCandidateProfilesInStore(
  store: ServerStore,
  uid: string,
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
        email: (p.email || u.email || "").trim().toLowerCase(),
        role: p.role || u.role || "syndic",
        syndicId: p.syndicId || u.syndicId,
        buildingId: p.buildingId || u.buildingId,
        apartmentId: p.apartmentId,
        residentId: p.residentId,
        prestataireId: p.prestataireId,
      });
    }
  }

  const resAccounts: any[] = Array.isArray(
    store.syndik_prod_resident_accounts_v1,
  )
    ? store.syndik_prod_resident_accounts_v1
    : [];
  for (const a of resAccounts) {
    const rId = a?.residentId;
    if (
      rId &&
      (uid === `user-res-${rId}` || uid === `res-${rId}` || uid === rId)
    ) {
      candidates.push({
        uid,
        email: (a.email || "").trim().toLowerCase(),
        role: "resident",
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
        email: (s.email || "").trim().toLowerCase(),
        role: "syndic",
        syndicId: s.id,
        buildingId: firstBldId,
      });
      if (firstBldId) {
        candidates.push({
          uid,
          email: (s.email || "").trim().toLowerCase(),
          role: "syndic",
          syndicId: s.id,
        });
      }
    }
    for (const b of s?.buildings || []) {
      for (const r of b?.residents || []) {
        if (
          r?.id &&
          (uid === `user-res-${r.id}` || uid === `res-${r.id}` || uid === r.id)
        ) {
          candidates.push({
            uid,
            email: (r.email || "").trim().toLowerCase(),
            role: "resident",
            syndicId: s.id,
            buildingId: b.id,
            apartmentId: r.apartmentId,
            residentId: r.id,
          });
        }
      }
    }
  }

  const prestAccounts: any[] = Array.isArray(
    store.syndik_prod_prestataire_accounts_v1,
  )
    ? store.syndik_prod_prestataire_accounts_v1
    : [];
  for (const a of prestAccounts) {
    const pId = a?.prestataireId;
    if (
      pId &&
      (uid === `user-prest-${pId}` || uid === `prov-${pId}` || uid === pId)
    ) {
      candidates.push({
        uid,
        email: (a.email || "").trim().toLowerCase(),
        role: "provider",
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
    if (
      p?.id &&
      (uid === `user-prest-${p.id}` || uid === `prov-${p.id}` || uid === p.id)
    ) {
      candidates.push({
        uid,
        email: (p.email || "").trim().toLowerCase(),
        role: "provider",
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
async function verifiedFirebaseIdentity(token: string) {
  try {
    const parts = token.split(".");
    if (
      parts.length !== 3 ||
      (JSON.parse(Buffer.from(parts[0], "base64url").toString()).alg !== "RS256" &&
        !(process.env.NODE_ENV !== "production" && process.env.FIREBASE_AUTH_EMULATOR_HOST))
    )
      return null;
    return await firebaseAdminAuth().verifyIdToken(token, true);
  } catch {
    return null;
  }
}

function invitationExpired(
  store: ServerStore,
  identity: Record<string, any>,
): boolean {
  if (!["resident", "provider"].includes(identity.role)) return false;
  const id =
    identity.role === "resident" ? identity.residentId : identity.prestataireId;
  const account = (
    store[
      identity.role === "resident"
        ? "syndik_prod_resident_accounts_v1"
        : "syndik_prod_prestataire_accounts_v1"
    ] || []
  ).find((a: any) =>
    identity.role === "resident" ? a.residentId === id : a.prestataireId === id,
  );
  const resource =
    identity.role === "resident"
      ? (store.syndik_prod_syndics_v1 || [])
          .flatMap((s: any) => s.buildings || [])
          .flatMap((b: any) => b.residents || [])
          .find((r: any) => r.id === id)
      : (store.syndik_prod_prestataires_v1 || []).find((p: any) => p.id === id);
  const expiry = resource?.invitationExpiresAt || account?.invitationExpiresAt;
  return (
    (account?.mustChangePassword ?? resource?.mustChangePassword ?? true) &&
    Boolean(expiry) &&
    Date.parse(expiry) < Date.now()
  );
}

async function extractAndVerifyCaller(
  req: express.Request,
  store: ServerStore,
): Promise<AuthCallerContext | null> {
  const cookie =
    req.path.startsWith("/api/uploads/") && req.method === "GET"
      ? String(req.headers.cookie || "")
          .split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith("syndik_session="))
          ?.slice(15)
      : undefined;
  const token =
    String(req.headers.authorization || "").replace(/^Bearer /, "") || cookie;
  if (!token) return null;
  let identity: AuthCallerContext | null = null;
  let firebaseIdentityUid: string | undefined;
  if (token.startsWith("syndik-srv1.")) {
    identity = verifyServerSessionToken(token);
  } else {
    // A client-computable signature is never an authentication credential.
    // Firebase signature, issuer, audience and expiry are verified by the Admin SDK.
    const decoded = await verifiedFirebaseIdentity(token);
    if (!decoded) return null;
    firebaseIdentityUid = decoded.uid;
    const bound = identityAccounts(store).find(a => a.firebaseUid === decoded.uid);
    let candidates = lookupCandidateProfilesInStore(store, bound ? accountUid(bound) : decoded.uid);
    if (!candidates.length && decoded.email_verified && decoded.email) {
      const known = identityAccounts(store).find(
        (u: any) =>
          !u.disabled && u.email?.trim().toLowerCase() === decoded.email!.toLowerCase(),
      );
      if (known)
        candidates = lookupCandidateProfilesInStore(store, accountUid(known));
    }
    identity = candidates.length ? { ...candidates[0], firebaseAuthTime: decoded.auth_time } as AuthCallerContext : null;
  }
  if (!identity) return null;
  const accounts = [
    ...(store.syndik_prod_registered_users_v1 || []),
    ...(store.syndik_prod_resident_accounts_v1 || []),
    ...(store.syndik_prod_prestataire_accounts_v1 || []),
  ].filter(
    (u: any) =>
      u.uid === identity!.uid ||
      u.profile?.uid === identity!.uid ||
      (identity!.role === "resident" &&
        u.residentId === identity!.residentId) ||
      (identity!.role === "provider" &&
        u.prestataireId === identity!.prestataireId),
  );
  if (accounts.some((u: any) => u.disabled)) return null;
  const account = accounts[0];
  assertIdentityReady(store, identity.uid);
  if (
    account?.disabled ||
    (token.startsWith("syndik-srv1.") &&
      (identity.sessionVersion || 0) !==
        (store.__sessionVersions?.[identity.uid] || 0))
  )
    return null;
  if (account?.firebaseUid && firebaseIdentityUid && account.firebaseUid !== firebaseIdentityUid) return null;
  const firebaseUser = await firebaseSessionUser(account || {}, identity.firebaseAuthTime);
  if (firebaseUser === null) return null;
  if (firebaseUser && account?.profile && account.profile.emailVerified !== firebaseUser.emailVerified)
    account.profile.emailVerified = firebaseUser.emailVerified;
  // Resolve current trusted membership on every request; a token does not grant a caller-selected tenant.
  const current = lookupCandidateProfilesInStore(store, identity.uid).find(
    (p) => p.role === identity!.role && p.email === identity!.email,
  );
  if (!current || invitationExpired(store, current)) return null;
  identityMutationActor(current as AuthCallerContext);
  return {
    ...account?.profile,
    ...current,
    firebaseAuthTime: identity.firebaseAuthTime,
    firebaseUid: account?.firebaseUid,
    emailVerified: firebaseUser?.emailVerified ?? account?.profile?.emailVerified,
    mustChangePassword:
      account?.mustChangePassword ??
      account?.profile?.mustChangePassword ??
      false,
  } as AuthCallerContext;
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
  caller: AuthCallerContext,
): AuthorizedScope {
  const syndics: any[] = Array.isArray(store.syndik_prod_syndics_v1)
    ? store.syndik_prod_syndics_v1
    : [];
  const prestatairesList: any[] = Array.isArray(
    store.syndik_prod_prestataires_v1,
  )
    ? store.syndik_prod_prestataires_v1
    : [];

  const callerResId =
    caller.residentId || caller.uid.replace(/^(user-res-|res-)/, "");
  const callerPrestId =
    caller.prestataireId || caller.uid.replace(/^(user-prest-|prov-)/, "");

  const authorizedSyndicIds = new Set<string>();
  const authorizedBuildingIds = new Set<string>();
  const authorizedSyndics: any[] = [];

  if (caller.role === "admin") {
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

  if (caller.role === "syndic") {
    for (const s of syndics) {
      if (
        s?.createdBy === caller.uid ||
        (caller.syndicId && s?.id === caller.syndicId)
      ) {
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

  if (caller.role === "resident") {
    // Audit P0-4: A resident is ONLY authorized for the specific building(s) they belong to, NEVER other buildings in the same syndic
    for (const s of syndics) {
      const residentBuildings = (s?.buildings || []).filter(
        (b: any) =>
          (caller.buildingId && b?.id === caller.buildingId) ||
          (Array.isArray(b?.residents) &&
            b.residents.some(
              (r: any) => r?.id === callerResId || r?.id === caller.uid,
            )),
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

  if (caller.role === "provider") {
    const matchedPrests = prestatairesList.filter(
      (p) => p?.id === callerPrestId || p?.id === caller.uid,
    );
    const providerBldIds = new Set<string>();
    if (caller.buildingId) providerBldIds.add(caller.buildingId);
    for (const p of matchedPrests) {
      if (p?.buildingId) providerBldIds.add(p.buildingId);
    }

    for (const s of syndics) {
      const providerBuildings = (s?.buildings || []).filter(
        (b: any) => b?.id && providerBldIds.has(b.id),
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

function filterStoreForCaller(store: ServerStore, caller: AuthCallerContext) {
  const linkedResidentIds = firebaseLinkedResidentIds(store);
  const scope = getAuthorizedScopeForCaller(store, caller),
    managed = ["admin", "syndic"].includes(caller.role),
    result: any = {};
  const clean = (value: any): any => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(
            ([k]) =>
              !["password", "passwordHash", "generatedPassword"].includes(k) &&
              (managed ||
                ![
                  "invitationCode",
                  "invitationToken",
                  "invitationExpiresAt",
                  "credentialsAuditLog",
                ].includes(k)),
          )
          .map(([k, v]) => [k, clean(v)]),
      );
    return value;
  };
  for (const [key, value] of Object.entries(store)) {
    if (key.startsWith("__")) continue;
    if (key === "syndik_prod_syndics_v1") {
      result[key] = scope.authorizedSyndics.map((s: any) => ({
        ...s,
        buildings: (s.buildings || [])
          .filter(
            (b: any) => scope.isAdmin || scope.authorizedBuildingIds.has(b.id),
          )
          .map((stored: any) => {
            const { reserveFundPercentage: _legacyRate, ...canonical } = stored;
            return { ...canonical, reserveFundRate: getBuildingReserveRate(stored),
              residents: (stored.residents || []).map((resident: any) => ({ ...resident,
                emailIdentityLinked: linkedResidentIds.has(resident.id) })) };
          })
          .map((b: any) =>
            managed
              ? b
              : {
                  ...b,
                  financials: {
                    balance: 0,
                    reserveFundBalance: 0,
                    transactions: [],
                  },
                  residents: (b.residents || []).map((r: any) =>
                    r.id === scope.callerResId
                      ? r
                      : {
                          id: r.id,
                          name: r.name,
                          isOwner: r.isOwner,
                          apartmentId: r.apartmentId,
                        },
                  ),
                  apartments: (b.apartments || []).map((a: any) => ({ ...a })),
                },
          ),
      }));
      continue;
    }
    if (!Array.isArray(value)) continue;
    if (key === "syndik_prod_notifications_v1")
      result[key] = value.filter(
        (n: any) =>
          n.userId === caller.uid ||
          (n.userId === "all" && scope.authorizedBuildingIds.has(n.buildingId)),
      );
    else if (key === "syndik_prod_registered_users_v1")
      result[key] = value.filter(
        (u: any) =>
          scope.isAdmin ||
          u.uid === caller.uid ||
          (managed && scope.authorizedBuildingIds.has(u.profile?.buildingId)),
      );
    else if (key.includes("_accounts_"))
      result[key] = value.filter(
        (a: any) =>
          scope.isAdmin ||
          (managed && scope.authorizedBuildingIds.has(a.buildingId)) ||
          (caller.role === "resident" && a.residentId === scope.callerResId) ||
          (caller.role === "provider" &&
            a.prestataireId === scope.callerPrestId),
      );
    else if (key === "syndik_prod_subscription_payments_v1")
      result[key] = value.filter(
        (p: any) =>
          scope.isAdmin ||
          (managed && scope.authorizedSyndicIds.has(p.syndicId)),
      );
    else if (key === "syndik_prod_audit_v1")
      result[key] = managed
        ? value.filter(
            (a: any) =>
              scope.isAdmin ||
              scope.authorizedBuildingIds.has(a.buildingId) ||
              scope.authorizedSyndicIds.has(a.syndicId),
          )
        : [];
    else
      result[key] = value.filter((item: any) => {
        if (
          !(scope.isAdmin || scope.authorizedBuildingIds.has(item.buildingId))
        )
          return false;
        if (key === "syndik_prod_chat_v1")
          return (
            !item.recipientId ||
            [item.senderId, item.recipientId].includes(
              caller.role === "resident"
                ? scope.callerResId
                : caller.role === "provider"
                  ? scope.callerPrestId
                  : caller.uid,
            )
          );
        if (key === "syndik_prod_maintenance_v1")
          return (
            managed ||
            (caller.role === "resident"
              ? item.residentId === scope.callerResId
              : [item.assignedTo, item.prestataireId].includes(
                  scope.callerPrestId,
                ))
          );
        if (
          [
            "syndik_prod_charges_v1",
            "syndik_prod_proofs_v1",
            "syndik_prod_invoices_v1",
            "syndik_prod_quittances_v1",
          ].includes(key)
        )
          return (
            managed ||
            (caller.role === "resident" &&
              item.residentId === scope.callerResId)
          );
        if (
          key === "syndik_prod_marketplace_v1" &&
          caller.role === "provider"
        )
          return false;
        return true;
      });
  }
  if (!managed && Array.isArray(result.syndik_prod_prestataires_v1))
    result.syndik_prod_prestataires_v1 = result.syndik_prod_prestataires_v1.map(
      (item: any) => {
        if (caller.role === "provider" && item?.id === scope.callerPrestId)
          return item;
        const {
          rib: _rib,
          bankName: _bankName,
          ice: _ice,
          rc: _rc,
          ifNumber: _ifNumber,
          contractRef: _contractRef,
          notes: _notes,
          ...publicFields
        } = item || {};
        return publicFields;
      },
    );
  if (Array.isArray(result.syndik_prod_ag_v1))
    result.syndik_prod_ag_v1 = result.syndik_prod_ag_v1.map(
      (assembly: AssembleeGenerale) => projectAssemblyForRole(assembly, caller.role),
    );
  return clean(result);
}

async function startServer() {
  validateProductionEnvironment();
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    Number(
      process.env.TRUST_PROXY_HOPS ??
        (process.env.K_SERVICE || process.env.NODE_ENV === "production" ? 1 : 0),
    ),
  );

  installAiBodyParsers(app);
  app.use(express.json({ limit: "15mb" }));

  process.env.SYNDIK_SERVER_SECRET ||= LEGACY_SERVER_SECRET;
  if (process.env.SYNDIK_SERVER_SECRET.length < 32) {
    process.env.SYNDIK_SERVER_SECRET = LEGACY_SERVER_SECRET;
  }
  process.env.SYNDIK_SESSION_SECRET ||= SESSION_HMAC_SECRET;
  process.env.SYNDIK_UPLOAD_BUCKET ||=
    firebaseConfig.storageBucket || "immogest-7faaf.firebasestorage.app";
  process.env.PUBLIC_APP_URL ||= "https://immogest.cloud.run";
  process.env.FIRESTORE_DATABASE_ID ||=
    firebaseConfig.firestoreDatabaseId || "(default)";
  const repository = createRepository(),
    sharedStore: ServerStore = sharedState;
  // Must precede every wrapped identity route and all platform transactions.
  app.use(registrationAdmission(createAdmissionStore(), req => {
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const caller = verifyServerSessionToken(token);
    return caller?.email || caller?.uid;
  }));
  const finalizeIdentityResponse: Parameters<typeof identityTransaction>[4] = (response, results, state, intent) => {
    const payload = response.payload;
    const actor = intent.actorUid && lookupCandidateProfilesInStore(state, intent.actorUid)[0];
    if (intent.actorUid && ((state.__sessionVersions?.[intent.actorUid] || 0) !== intent.actorVersion ||
        !actor || actor.role !== intent.actorRole || actor.syndicId !== intent.actorSyndicId ||
        identityAccounts(state).some(a => accountUid(a) === intent.actorUid && a.disabled))) {
      response.status = 401; response.payload = { ok: false, error: 'Session expirée. Reconnectez-vous.' }; return;
    }
    const credential = [...results].reverse().find(r => r?.authTime !== undefined);
    if (payload?.profile && credential) payload.profile.firebaseAuthTime = credential.authTime;
    const verification = results.find(r => r?.verificationEmailSent !== undefined);
    if (verification) payload.verificationEmailSent = verification.verificationEmailSent;
    if (payload?.token && payload.profile) payload.token = issueServerSessionToken(payload.profile);
    if (payload?.store && intent.actorUid) {
      const actor = lookupCandidateProfilesInStore(state, intent.actorUid)[0];
      payload.store = actor ? filterStoreForCaller(state, actor as AuthCallerContext) : {};
    }
    if (payload && 'revision' in payload) payload.revision = (state.__revision || 0) + 1;
  };
  const wrap =
    (handler: express.RequestHandler, transactional = true) => async (req: express.Request, res: express.Response) => {
      const requestId = crypto.randomUUID();
      res.setHeader('X-Request-ID', requestId);
      const json = res.json.bind(res),
        send = res.send.bind(res);
      let payload: any,
        format = "json",
        requestState: any,
        identityFinalized = false;
      try {
        const handle = async (state?: any) => {
          res.locals.afterCommit = undefined;
          requestState = state;
          res.locals.transactionState = state;
          res.statusCode = 200;
          res.json = ((value: any) => {
            payload = value;
            format = "json";
            return res;
          }) as any;
          res.send = ((value: any) => {
            payload = value;
            format = "send";
            return res;
          }) as any;
          await handler(req, res, error => { if (error) throw error; });
          if (
            res.statusCode >= 400 &&
            !["/api/auth/login", "/api/auth/recovery/request"].includes(
              req.path,
            )
          )
            throw Object.assign(new Error(payload?.error || "Rejected"), {
              rejected: true,
            });
        };
        if (transactional && ['/api/auth/register', '/api/auth/login', '/api/auth/change-password',
            '/api/auth/recovery/request', '/api/auth/logout', '/api/commands'].includes(req.path)) {
          const response = await identityTransaction(repository,
            identityRequestFingerprint(req.path, String(req.headers.authorization || req.headers.cookie || ''), req.body),
            async state => { await handle(state); return { payload, status: res.statusCode, format }; },
            executeFirebaseMutation, finalizeIdentityResponse, async (state, intent) => {
              if (['/api/auth/register', '/api/auth/login', '/api/auth/recovery/request'].includes(req.path)) return;
              const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
              let uid: string | undefined;
              if (token.startsWith('syndik-srv1.')) uid = verifyServerSessionToken(token)?.uid;
              else {
                try {
                  // Signature/expiry must still be valid. Revocation is the
                  // pending intent's own effect, so it cannot veto its recovery.
                  const decoded = await firebaseAdminAuth().verifyIdToken(token, false);
                  uid = accountUid(identityAccounts(state).find(a => a.firebaseUid === decoded.uid) || {});
                } catch {}
              }
              if (!uid || uid !== intent.actorUid || (state.__sessionVersions?.[uid] || 0) !== intent.actorVersion)
                throw new OperationError('Session expirée. Reconnectez-vous.', 401);
              const actor = lookupCandidateProfilesInStore(state, uid)[0];
              if (!actor || actor.role !== intent.actorRole || actor.syndicId !== intent.actorSyndicId ||
                  identityAccounts(state).some(a => accountUid(a) === uid && a.disabled))
                throw new OperationError('Accès à cette modification interdit.', 403);
            });
          payload = response.payload; format = response.format; res.statusCode = response.status;
          identityFinalized = Boolean(response.identityFinalized);
        }
        else if (transactional) await repository.transaction(handle);
        else await handle();
        if (res.statusCode < 400 && res.locals.afterCommit) {
          try { await res.locals.afterCommit(); }
          catch (error: any) {
            console.error(JSON.stringify({ event: 'firebase_email_failed', requestId, path: req.path,
              code: error.firebaseCode || 'EMAIL_DELIVERY_FAILED' }));
            if (['/api/auth/register', '/api/auth/login'].includes(req.path)) payload.verificationEmailSent = false;
            else { res.status(error.status || 503); payload = { error: error.message || 'Envoi impossible.', requestId }; }
          }
        }
        if (!identityFinalized && requestState && payload && typeof payload === "object" && "revision" in payload)
          payload.revision = requestState.__revision;
        if (payload?.token)
          res.cookie("syndik_session", payload.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 12 * 3600000,
            path: "/",
          });
      } catch (error: any) {
        if (!error.rejected) {
          res.status(error.status || (error.name === "ZodError" ? 400 : 500));
          payload = {
            ok: false,
            error:
              error instanceof OperationError || error instanceof DependencyError || error instanceof LifecycleError
                ? error.message
                : error.name === "ZodError" && Array.isArray(error.issues)
                ? JSON.stringify(error.issues.map((issue: any) => ({
                    path: issue.path,
                    code: issue.code,
                    message: "Valeur invalide",
                    minimum: issue.minimum,
                    maximum: issue.maximum,
                    validation: issue.validation,
                    received: issue.received === "undefined" ? "undefined" : undefined,
                  })))
                : "Enregistrement impossible. Veuillez réessayer.",
            code: error instanceof DependencyError ? error.code : error.name === 'ZodError' ? 'VALIDATION_ERROR' : error instanceof OperationError || error instanceof LifecycleError ? error.code : 'INTERNAL_ERROR',
            requestId,
          };
          format = "json";
          console.error(JSON.stringify({ event: 'request_failed', requestId, method: req.method,
            path: req.path, operation: String(req.body?.operation || '').slice(0, 100),
            code: payload.code, dependency: error instanceof DependencyError ? error.dependency : undefined,
            message: String(error instanceof DependencyError ? (error.cause as any)?.message : error.message).slice(0, 1000) }));
        }
      } finally {
        res.json = json;
        res.send = send;
      }
      if (
        res.statusCode < 400 &&
        [
          "/api/jobs/outbox",
          "/api/auth/register",
          "/api/auth/recovery/request",
          "/api/auth/verification/request",
        ].includes(req.path)
      )
        try {
          await deliverOutbox(
            repository,
            req.path === "/api/jobs/outbox" ? 25 : 1,
          );
        } catch (e) {
          console.error("Email dispatcher failed");
        }
      if (format === "send") send(payload);
      else json(payload);
    };
  const api = {
    get: (route: string, handler: (req: express.Request, res: express.Response) => unknown) => app.get(route, wrap(handler)),
    post: (route: string, handler: (req: express.Request, res: express.Response) => unknown) => app.post(route, wrap(handler)),
  };
  registerIdentityRoutes(api, extractAndVerifyCaller);
  registerLiveUpdates(app, repository, extractAndVerifyCaller);
  app.use("/api", (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // API Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", revision: process.env.K_REVISION || 'local', timestamp: new Date().toISOString() });
  });

  // Server-side authentication endpoint for Syndics, Residents (Email or CIN), and Providers (Prestataires)
  // Allows unauthenticated clients (new browser, incognito, mobile) to verify credentials against sharedStore
  api.post("/api/auth/login", async (req, res) => {
    const identifier = String(req.body?.identifier || req.body?.email || "")
        .trim()
        .toLowerCase(),
      password = String(req.body?.password || "");
    if (!identifier || !password || password.length > 200)
      return res.status(400).json({ error: "Identifiants invalides." });
    const attempts = (sharedStore.__authAttempts ??= {}),
      keys = [`ip:${req.ip}`, `account:${identifier}`].map((k) =>
        crypto.createHash("sha256").update(k).digest("hex"),
      );
    for (const [i, key] of keys.entries()) {
      if (!attempts[key] || attempts[key].since < Date.now() - 15 * 60000)
        attempts[key] = { count: 0, since: Date.now() };
      if (attempts[key].count >= (i === 0 ? 100 : 10))
        return res
          .status(429)
          .json({ error: "Trop de tentatives. Réessayez dans 15 minutes." });
    }
    const records = [
      ...(sharedStore.syndik_prod_registered_users_v1 || []),
      ...(sharedStore.syndik_prod_resident_accounts_v1 || []),
      ...(sharedStore.syndik_prod_prestataire_accounts_v1 || []),
    ];
    const account = records.find((u: any) => !u.disabled &&
      (u.email?.trim().toLowerCase() === identifier || u.cin?.trim().toLowerCase() === identifier ||
        u.profile?.cin?.trim().toLowerCase() === identifier));
    const uid = account ? accountUid(account) : '';
    if (uid) assertIdentityReady(sharedStore, uid);
    const wasLinked = Boolean(account?.firebaseUid);
    let firebaseCredential: Awaited<ReturnType<typeof firebasePasswordLogin>> | undefined;
    if (account) {
      if (account.firebaseUid) {
        const matching = records.filter((a: any) => accountUid(a) === uid);
        try {
          firebaseCredential = await firebasePasswordLogin(account.email.trim().toLowerCase(), password);
          if (firebaseCredential.user.uid !== account.firebaseUid) return res.status(401).json({ error: 'Identifiants invalides.' });
          if (matching.some((a: any) => a.password || a.passwordHash)) {
            for (const a of matching) { delete a.password; delete a.passwordHash; }
            (sharedStore.__sessionVersions ??= {})[uid] = (sharedStore.__sessionVersions?.[uid] || 0) + 1;
          }
        } catch (error: any) {
          if (error.status !== 401) throw error;
          if (matching.some((a: any) => a.password || a.passwordHash)) {
            const fbUser = await firebaseAdminAuth().getUser(account.firebaseUid).catch(() => null);
            if (fbUser && !fbUser.passwordHash && verifyPassword(password, account.passwordHash || account.password, account.email)) {
              planFirebasePassword(sharedStore, uid, account.firebaseUid, account.email.trim().toLowerCase(), password, true);
              for (const a of matching) { delete a.password; delete a.passwordHash; }
              (sharedStore.__sessionVersions ??= {})[uid] = (sharedStore.__sessionVersions?.[uid] || 0) + 1;
              firebaseCredential = { user: fbUser, idToken: '', authTime: Math.floor(Date.now() / 1000) };
            } else if (fbUser?.passwordHash) {
              for (const a of matching) { delete a.password; delete a.passwordHash; }
            }
          }
        }
      } else if (usesFirebaseAuth()) {
        if (verifyPassword(password, account.passwordHash || account.password, account.email)) {
          firebaseCredential = await migrateLegacyLogin(sharedStore, account, password);
        } else {
          // A pre-existing, VERIFIED Firebase identity is also proof of ownership
          // of this email, even when its password differs from the legacy hash.
          try {
            const existing = await firebasePasswordLogin(account.email.trim().toLowerCase(), password);
            if (existing.user.emailVerified) {
              bindFirebaseAccount(sharedStore, account, existing.user);
              firebaseCredential = existing;
            }
          } catch (error: any) { if (error.status !== 401) throw error; }
        }
      }
    }
    const passwordValid = account && (account.firebaseUid ? Boolean(firebaseCredential)
      : !usesFirebaseAuth() && verifyPassword(password, account.passwordHash || account.password, account.email));
    const trusted = lookupCandidateProfilesInStore(sharedStore, uid)[0];
    if (!passwordValid || !trusted || invitationExpired(sharedStore, trusted)) {
      for (const key of keys) attempts[key].count++;
      return res
        .status(401)
        .json({ error: "Identifiants invalides ou invitation expirée." });
    }
    for (const key of keys) delete attempts[key];
    if (!account.firebaseUid && !account.passwordHash?.startsWith("scrypt$v1$")) {
      const upgraded = hashPassword(password);
      for (const item of records)
        if (item.email?.toLowerCase() === account.email.toLowerCase()) {
          item.passwordHash = upgraded;
          delete item.password;
        }
      appendAudit(sharedStore, trusted as any, "credential_migrated");
    }
    const profile = {
      ...(sharedStore.syndik_prod_registered_users_v1 || []).find(
        (u: any) => u.uid === uid,
      )?.profile,
      ...trusted,
      firebaseAuthTime: firebaseCredential?.authTime,
      firebaseUid: account.firebaseUid,
      emailVerified: firebaseCredential?.user.emailVerified ?? account.profile?.emailVerified,
      mustChangePassword:
        account.mustChangePassword ??
        account.profile?.mustChangePassword ??
        false,
    };
    if (firebaseCredential && account.profile) account.profile.emailVerified = firebaseCredential.user.emailVerified;
    if (firebaseCredential?.idToken && !wasLinked && !firebaseCredential.user.emailVerified)
      res.locals.afterCommit = () => sendFirebaseVerification(firebaseCredential.idToken);
    return res.json({ ok: true, profile, firebaseAuth: Boolean(firebaseCredential), token: issueServerSessionToken(profile) });
  });

  api.post("/api/auth/firebase-session", async (req, res) => {
    const token = String(req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    const decoded = await verifiedFirebaseIdentity(token);
    if (!decoded || !decoded.email) {
      return res.status(401).json({
        error: "Une identité Firebase avec email vérifié est requise.",
      });
    }
    const linked = identityAccounts(sharedStore).find(a => a.firebaseUid === decoded.uid);
    if (!decoded.email_verified && !linked) return res.status(401).json({ error: 'Vérifiez votre adresse email.' });
    if (linked?.disabled) return res.status(403).json({ error: 'Compte désactivé.' });
    let candidates = lookupCandidateProfilesInStore(sharedStore, linked ? accountUid(linked) : decoded.uid);
    if (
      decoded.email_verified && process.env.SYNDIK_BOOTSTRAP_ADMIN_EMAIL?.toLowerCase() ===
        decoded.email.toLowerCase() &&
      !candidates.some((p) => p.role === "admin")
    ) {
      const profile = {
        uid: decoded.uid,
        email: decoded.email.toLowerCase(),
        role: "admin",
        displayName: decoded.name || "Admin",
        emailVerified: true,
      };
      (sharedStore.syndik_prod_registered_users_v1 ??= []).push({
        uid: decoded.uid,
        email: profile.email,
        profile,
      });
      candidates = [profile];
    }
    const registered: any[] = sharedStore.syndik_prod_registered_users_v1 || [];
    if (!candidates.length) {
      const known = identityAccounts(sharedStore).find(
        (u) => !u.disabled && u.email?.trim().toLowerCase() === decoded.email!.toLowerCase(),
      );
      if (known)
        candidates = lookupCandidateProfilesInStore(sharedStore, accountUid(known));
    }
    let profile = candidates[0];
    const knownAccount = identityAccounts(sharedStore).find(a => profile && accountUid(a) === profile.uid);
    if (knownAccount) assertIdentityReady(sharedStore, accountUid(knownAccount));
    if (knownAccount?.disabled) return res.status(403).json({ error: 'Compte désactivé.' });
    const fbUser = usesFirebaseAuth() ? await firebaseAdminAuth().getUser(decoded.uid) : undefined;
    if (knownAccount && fbUser) bindFirebaseAccount(sharedStore, knownAccount, fbUser);
    if (profile && invitationExpired(sharedStore, profile))
      return res.status(403).json({ error: "Invitation expirée." });
    if (!profile) {
      // A new verified Google/Firebase identity owns a fresh cabinet, with no existing tenant claims.
      const syndicId = `syndic-${crypto.randomUUID()}`;
      profile = {
        uid: decoded.uid,
        email: decoded.email.toLowerCase(),
        role: "syndic",
        syndicId,
        displayName: String(decoded.name || decoded.email.split("@")[0]).slice(
          0,
          150,
        ),
      };
      registered.push({
        uid: decoded.uid,
        email: profile.email,
        profile,
        createdAt: new Date().toISOString(),
      });
      sharedStore.syndik_prod_registered_users_v1 = registered;
      sharedStore.syndik_prod_syndics_v1 = [
        ...(sharedStore.syndik_prod_syndics_v1 || []),
        {
          id: syndicId,
          name: `Cabinet ${profile.displayName}`,
          email: profile.email,
          createdBy: decoded.uid,
          subscriptionPlan: "starter",
          subscriptionStatus: "trialing",
          subscriptionExpiry: new Date(
            Date.now() + 30 * 86400000,
          ).toISOString(),
          buildings: [],
        },
      ];

    }
    const firebaseAccount = identityAccounts(sharedStore).find(a => accountUid(a) === profile.uid);
    if (firebaseAccount && fbUser && firebaseAccount !== knownAccount) bindFirebaseAccount(sharedStore, firebaseAccount, fbUser);
    const storedProfile = registered.find((u) => u.uid === profile.uid)?.profile || {};
    profile = {
      ...storedProfile,
      ...profile,
      firebaseAuthTime: decoded.auth_time,
      firebaseUid: firebaseAccount?.firebaseUid,
      emailVerified: decoded.email_verified === true,
      displayName:
        storedProfile.displayName ||
        profile.displayName ||
        decoded.name ||
        decoded.email.split("@")[0],
    };
    return res.json({
      ok: true,
      profile,
      token: issueServerSessionToken(profile),
    });
  });

  // Self-registration endpoint for new non-admin accounts (Syndic / Resident / Provider)
  api.post("/api/auth/register", async (req, res) => {
    const { email, password, profile = {}, syndic } = req.body || {};
    const initial = syndic?.initialBuilding;
    if (
      initial &&
      (!Number.isInteger(initial.apartmentsCount) ||
        initial.apartmentsCount < 0 ||
        initial.apartmentsCount > 500 ||
        !Number.isFinite(initial.monthlyFees) ||
        initial.monthlyFees < 0 ||
        typeof initial.name !== "string" ||
        !initial.name.trim())
    ) {
      return res
        .status(400)
        .json({ error: "Configuration initiale de l’immeuble invalide." });
    }
    const emailNorm = String(email || "")
      .trim()
      .toLowerCase();
    const rawPass = String(password || "");
    const role = String(profile.role || "syndic");
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm) ||
      rawPass.length < 10 || rawPass.length > 200 ||
      isAlreadyHashedPassword(rawPass)
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "Identifiants d’inscription invalides." });
    }
    if (
      !["syndic", "resident", "provider"].includes(role) ||
      (req.body.role && req.body.role !== role)
    ) {
      return res.status(403).json({ ok: false, error: "Rôle non autorisé." });
    }
    const registered: any[] = sharedStore.syndik_prod_registered_users_v1 || [];
    const cabinets: any[] = sharedStore.syndik_prod_syndics_v1 || [];
    const accountEmails = [
      ...registered,
      ...(sharedStore.syndik_prod_resident_accounts_v1 || []),
      ...(sharedStore.syndik_prod_prestataire_accounts_v1 || []),
    ];
    if (
      accountEmails.some(
        (u: any) => u.email?.trim().toLowerCase() === emailNorm,
      )
    ) {
      return res.status(409).json({
        ok: false,
        error:
          "Ce compte existe déjà. Connectez-vous avec vos identifiants ou votre invitation.",
      });
    }
    if (
      (profile.syndicId && cabinets.some((s) => s.id === profile.syndicId)) ||
      (syndic?.id && cabinets.some((s) => s.id === syndic.id)) ||
      (role !== "syndic" &&
        (profile.syndicId ||
          profile.buildingId ||
          profile.residentId ||
          profile.prestataireId))
    ) {
      return res.status(403).json({
        ok: false,
        error:
          "Une invitation du syndic est nécessaire pour rejoindre un cabinet existant.",
      });
    }
    const firebaseCredential = usesFirebaseAuth()
      ? await registerFirebaseAccount(emailNorm, rawPass) : undefined;
    const uid = firebaseCredential?.user.uid || `usr-${crypto.randomUUID()}`;
    if (identityAccounts(sharedStore).some(a => accountUid(a) === uid))
      return res.status(409).json({ error: 'Cette identité possède déjà un compte. Connectez-vous.' });
    const cleanProfile: Record<string, any> = {
      uid,
      email: emailNorm,
      role,
      displayName: String(profile.displayName || emailNorm.split("@")[0]).slice(
        0,
        150,
      ),
      phone: String(profile.phone || "").slice(0, 40),
    };
    let createdSyndic: any;
    if (role === "syndic") {
      const syndicId = `syndic-${crypto.randomUUID()}`;
      const plan = ["starter", "professional", "enterprise"].includes(
        syndic?.subscriptionPlan,
      )
        ? syndic.subscriptionPlan
        : "starter";
      createdSyndic = {
        id: syndicId,
        createdBy: uid,
        name: String(syndic?.name || cleanProfile.displayName).slice(0, 200),
        email: emailNorm,
        phone: cleanProfile.phone,
        city: String(syndic?.city || "").slice(0, 100),
        logoUrl: "",
        subscriptionPlan: plan,
        subscriptionStatus: "trialing",
        subscriptionExpiry: new Date(Date.now() + 30 * 86400000).toISOString(),
        buildings: [],
      };
      if (initial) {
        const buildingId = `bld-${crypto.randomUUID()}`;
        const count = initial.apartmentsCount;
        const apartments = Array.from({ length: count }, (_, i) => ({
          id: `apt-${crypto.randomUUID()}`,
          buildingId,
          number: `${Math.floor(i / 4) + 1}0${(i % 4) + 1}`,
          floor: Math.floor(i / 4) + 1,
          area: 80,
          tantiemes: Math.floor(1000 / count) + (i < 1000 % count ? 1 : 0),
          coproType: "apartment",
          ownerId: null,
          tenantId: null,
          monthlyFees: initial.monthlyFees,
        }));
        createdSyndic.buildings = [
          {
            id: buildingId,
            syndicId,
            name: initial.name.trim().slice(0, 200),
            address: String(initial.address || "").slice(0, 300),
            city: createdSyndic.city,
            monthlySyndicFees: initial.monthlyFees,
            reserveFundRate: 5,
            apartments,
            residents: [],
            announcements: [],
            documents: [],
            financials: { balance: 0, reserveFundBalance: 0, transactions: [] },
          },
        ];
        cleanProfile.buildingId = buildingId;
        cleanProfile.buildingName = createdSyndic.buildings[0].name;
      }
      cleanProfile.syndicId = syndicId;
      cabinets.push(createdSyndic);
    }
    // Resident/provider public accounts remain unassigned; an existing invitation uses the login flow.
    cleanProfile.emailVerified = firebaseCredential ? firebaseCredential.user.emailVerified : process.env.NODE_ENV !== 'production';
    cleanProfile.firebaseAuthTime = firebaseCredential?.authTime;
    cleanProfile.firebaseUid = firebaseCredential?.user.uid;
    if (firebaseCredential?.idToken && !cleanProfile.emailVerified) {
      res.locals.afterCommit = () => sendFirebaseVerification(firebaseCredential.idToken);
    } else if (!firebaseCredential && process.env.NODE_ENV === 'production') {
      if (!mailIsConfigured()) return res.status(503).json({ error: 'Configurez le service email avant inscription.' });
      createIdentityAction(sharedStore, emailNorm, 'verify');
    }
    registered.push({ uid, email: emailNorm,
      ...(firebaseCredential ? { firebaseUid: firebaseCredential.user.uid } : { passwordHash: hashPassword(rawPass) }),
      profile: cleanProfile, createdAt: new Date().toISOString() });
    sharedStore.syndik_prod_registered_users_v1 = registered;
    sharedStore.syndik_prod_syndics_v1 = cabinets;

    return res.json({
      ok: true,
      profile: cleanProfile,
      firebaseAuth: Boolean(firebaseCredential),
      syndic: createdSyndic,
      token: issueServerSessionToken(cleanProfile),
      revision: sharedStore.__revision,
    });
  });

  // Server-side password update endpoint — strictly bound to the authenticated caller (Audit P0-3)
  api.post("/api/auth/change-password", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller) {
      return res
        .status(401)
        .json({ ok: false, error: "Unauthorized: authentication required" });
    }

    const newPassword = String(req.body?.newPassword || "").trim();
    if (
      !newPassword ||
      newPassword.length < 10 ||
      newPassword.length > 200 ||
      isAlreadyHashedPassword(newPassword)
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid password update parameters" });
    }

    const callerResId =
      caller.residentId ||
      (caller.role === "resident"
        ? caller.uid.replace(/^(user-res-|res-)/, "")
        : "");
    const callerPrestId =
      caller.prestataireId ||
      (caller.role === "provider"
        ? caller.uid.replace(/^(user-prest-|prov-)/, "")
        : "");
    const callerEmail = (caller.email || "").trim().toLowerCase();

    const requestedResId = req.body?.residentId
      ? String(req.body.residentId).trim()
      : "";
    const requestedPrestId = req.body?.prestataireId
      ? String(req.body.prestataireId).trim()
      : "";
    const requestedEmail = req.body?.email
      ? String(req.body.email).trim().toLowerCase()
      : "";

    // Audit P0-3: Reject any attempt to change another user's password
    if (requestedResId && requestedResId !== callerResId) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden: cannot change password for another resident account",
      });
    }
    if (requestedPrestId && requestedPrestId !== callerPrestId) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden: cannot change password for another provider account",
      });
    }
    if (requestedEmail && callerEmail && requestedEmail !== callerEmail) {
      return res.status(403).json({
        ok: false,
        error: "Forbidden: cannot change password for another email identity",
      });
    }

    const effectiveEmail = callerEmail || requestedEmail;
    if (!effectiveEmail) {
      return res
        .status(400)
        .json({ ok: false, error: "Missing account email context" });
    }

    const boundAccount = identityAccounts(sharedStore).find(a => accountUid(a) === caller.uid && a.firebaseUid);
    let firebaseAuthTime = caller.firebaseAuthTime;
    if (boundAccount) {
      planFirebasePassword(sharedStore, caller.uid, boundAccount.firebaseUid, effectiveEmail, newPassword, true);
    }
    const newPasswordHash = boundAccount ? undefined : hashPassword(newPassword);

    if (caller.role === "resident" && callerResId) {
      const resAccounts: any[] = Array.isArray(
        sharedStore.syndik_prod_resident_accounts_v1,
      )
        ? sharedStore.syndik_prod_resident_accounts_v1
        : [];
      sharedStore.syndik_prod_resident_accounts_v1 = resAccounts.map(
        (a: any) => {
          if (a?.residentId === callerResId) {
            const { password: _pw, ...rest } = a;
            return {
              ...rest,
              passwordHash: newPasswordHash,
              mustChangePassword: false,
            };
          }
          return a;
        },
      );

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
                invitationStatus: "accepted",
                mustChangePassword: false,
              };
            }
          }
        }
      }
      sharedStore.syndik_prod_syndics_v1 = syndics;
    }

    if (caller.role === "provider" && callerPrestId) {
      const prestAccounts: any[] = Array.isArray(
        sharedStore.syndik_prod_prestataire_accounts_v1,
      )
        ? sharedStore.syndik_prod_prestataire_accounts_v1
        : [];
      sharedStore.syndik_prod_prestataire_accounts_v1 = prestAccounts.map(
        (a: any) => {
          if (a?.prestataireId === callerPrestId) {
            const { password: _pw, ...rest } = a;
            return {
              ...rest,
              passwordHash: newPasswordHash,
              mustChangePassword: false,
            };
          }
          return a;
        },
      );

      const prestList: any[] = Array.isArray(
        sharedStore.syndik_prod_prestataires_v1,
      )
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
            invitationStatus: "accepted",
            mustChangePassword: false,
          };
        }
        return p;
      });
    }

    const regUsers: any[] = Array.isArray(
      sharedStore.syndik_prod_registered_users_v1,
    )
      ? sharedStore.syndik_prod_registered_users_v1
      : [];
    sharedStore.syndik_prod_registered_users_v1 = regUsers.map((u: any) => {
      if (u?.uid === caller.uid || u?.profile?.uid === caller.uid) {
        const { password: _pw, ...rest } = u;
        return {
          ...rest,
          passwordHash: newPasswordHash,
          profile: u.profile
            ? { ...u.profile, mustChangePassword: false }
            : u.profile,
        };
      }
      return u;
    });

    (sharedStore.__sessionVersions ??= {})[caller.uid] =
      (sharedStore.__sessionVersions?.[caller.uid] || 0) + 1;
    const profile = { ...caller, firebaseAuthTime, mustChangePassword: false };
    return res.json({
      ok: true,
      profile,
      firebaseAuth: Boolean(boundAccount),
      token: issueServerSessionToken(profile),
      revision: sharedStore.__revision,
    });
  });

  api.post("/api/ag/vote", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    const list: AssembleeGenerale[] = sharedStore.syndik_prod_ag_v1 || [];
    const index = list.findIndex((a) => a.id === req.body.agId);
    const ag = list[index];
    const scope = getAuthorizedScopeForCaller(sharedStore, caller);
    if (
      !ag ||
      (!scope.isAdmin && !scope.authorizedBuildingIds.has(ag.buildingId))
    )
      return res.status(403).json({ error: "Accès refusé." });
    const residentId =
      caller.role === "resident"
        ? scope.callerResId
        : ["admin", "syndic"].includes(caller.role)
          ? String(req.body.residentId || "")
          : "";
    if (
      !residentId ||
      (caller.role === "resident" &&
        req.body.residentId &&
        req.body.residentId !== residentId)
    ) {
      return res
        .status(403)
        .json({ error: "Identité du votant non autorisée." });
    }
    const cabinet = (sharedStore.syndik_prod_syndics_v1 || []).find((s: any) =>
      (s.buildings || []).some((b: Building) => b.id === ag.buildingId),
    );
    const building: Building | undefined = cabinet?.buildings?.find(
      (b: Building) => b.id === ag.buildingId,
    );
    if (!building)
      return res.status(404).json({ error: "Immeuble introuvable." });
    try {
      canWrite(caller, { ...building, syndicId: building.syndicId || cabinet?.id });
      const result = applyResidentVote(
        ag,
        ag.votingSnapshot || building,
        residentId,
        String(req.body.resolutionId || ""),
        req.body.choice,
        req.body.apartmentId,
        typeof req.body.comment === "string" ? req.body.comment : undefined,
      );
      recomputeMeeting(result);
      appendAudit(sharedStore, caller, "castResidentAGVote", building.id, {
        agId: ag.id,
        resolutionId: req.body.resolutionId,
        residentId,
      });
      list[index] = result;
      sharedStore.syndik_prod_ag_v1 = list;

      return res.json({ ag: projectAssemblyForRole(result, caller.role), revision: sharedStore.__revision });
    } catch (error) {
      return res.status(error instanceof OperationError ? error.status : 400).json({
        error: error instanceof Error ? error.message : "Vote invalide.",
      });
    }
  });

  // Audit Item 02: Authenticated shared-state GET with ETag & sinceRevision delta sync
  api.get("/api/shared-state", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller) {
      return res
        .status(401)
        .json({ ok: false, error: "Unauthorized: authentication required" });
    }
    const currentRevision = Number(sharedStore.__revision) || 0;
    const etag = `"rev-${currentRevision}-${caller.uid}"`;
    res.setHeader("ETag", etag);

    const sinceRev = Number(req.query.sinceRevision || 0);
    const ifNoneMatch = req.headers["if-none-match"];
    if (
      (sinceRev > 0 && sinceRev === currentRevision) ||
      ifNoneMatch === etag
    ) {
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
  api.post("/api/uploads", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    const buildingId = String(req.body?.buildingId || caller.buildingId || ""),
      b = buildingFor(caller, buildingId, false);
    canWrite(caller, b);
    const match = String(req.body?.dataUrl || "").match(
      /^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/,
    );
    if (!match) return res.status(400).json({ error: "Fichier invalide." });
    const bytes = Buffer.from(match[2], "base64"),
      mime = match[1];
    if (bytes.length > 5 * 1048576)
      return res.status(413).json({ error: "Fichier limité à 5 Mo." });
    const valid =
      mime === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : mime === "image/png"
          ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
          : mime === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : mime === "image/webp"
              ? bytes.subarray(0, 4).toString() === "RIFF" &&
                bytes.subarray(8, 12).toString() === "WEBP"
              : false;
    if (!valid)
      return res
        .status(400)
        .json({ error: "Format accepté : PDF, PNG, JPEG ou WebP." });
    const fileId = crypto
        .createHash("sha256")
        .update(`${buildingId}:${caller.uid}:`)
        .update(bytes)
        .digest("hex"),
      key = `private/${buildingId}/${fileId}`;
    if(sharedStore.__files?.[fileId]?.lifecycle==='deleting')throw new OperationError('Fichier en cours de suppression. Réessayez dans un instant.',409);
    await savePrivateFile(UPLOADS_DIR, fileId, key, bytes, mime);
    (sharedStore.__files ??= {})[fileId] = {
      fileId,
      key,
      mimeType: mime,
      buildingId,
      uploadedBy: caller.uid,
      name: String(req.body?.name || "document").slice(0, 200),
      sizeBytes: bytes.length,
      createdAt: sharedStore.__files?.[fileId]?.createdAt || new Date().toISOString(),
      lastUploadedAt: new Date().toISOString(),
    };
    return res.json({
      ok: true,
      fileId,
      url: `/api/uploads/${fileId}`,
      mimeType: mime,
      sizeBytes: bytes.length,
    });
  });
  api.get("/api/uploads/:fileId", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    const id = String(req.params.fileId),
      meta = sharedStore.__files?.[id];
    if (!meta) return res.status(404).json({ error: "Fichier introuvable." });
    const b = buildingFor(caller, meta.buildingId, false),
      publicDocument = (b.documents || []).some(
        (d: any) => d.url === `/api/uploads/${id}`,
      ),
      marketImage = (sharedStore.syndik_prod_marketplace_v1 || []).some(
        (m: any) =>
          m.buildingId === b.id &&
          (m.imageUrl === `/api/uploads/${id}` ||
            m.images?.includes(`/api/uploads/${id}`)),
      ),
      assigned = (sharedStore.syndik_prod_maintenance_v1 || []).some(
        (m: any) =>
          m.buildingId === b.id &&
          ((caller.role === 'provider' && caller.prestataireId &&
            [m.prestataireId, m.assignedTo].includes(caller.prestataireId)) ||
            (caller.role === 'resident' && caller.residentId && m.residentId === caller.residentId)) &&
          privateAttachments(m).has(`/api/uploads/${id}`),
      ),
      sharedInChat = (sharedStore.syndik_prod_chat_v1 || []).some((m: any) =>
        m.buildingId === b.id && m.attachmentUrl === `/api/uploads/${id}` &&
        (!m.recipientId || [m.senderId, m.recipientId].includes(actorIdentity(caller))));
    if (
      !["admin", "syndic"].includes(caller.role) &&
      meta.uploadedBy !== caller.uid &&
      !publicDocument &&
      !marketImage &&
      !assigned &&
      !sharedInChat
    )
      return res.status(403).json({ error: "Fichier privé." });
    const bytes = await readPrivateFile(UPLOADS_DIR, id, meta.key);
    res.setHeader("Content-Type", meta.mimeType);
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(bytes);
  });

  api.post('/api/operations/status', async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller) return res.status(401).json({ error: 'Authentification requise.' });
    const result = readOperationStatus(sharedStore, caller, req.body?.operationId);
    return res.json({ ok: true, ...result,
      ...(result.status === 'completed' ? { store: filterStoreForCaller(sharedStore, caller), revision: sharedStore.__revision || 0 } : {}) });
  });
  api.post("/api/commands", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    const command = CommandIdentitySchema.safeParse(req.body as unknown);
    if (!command.success) return res.status(400).json({ error: 'Opération invalide.' });
    const { operation, args, operationId } = command.data;
    const fingerprint = crypto
        .createHash("sha256")
        .update(JSON.stringify({ operation, args }))
        .digest("hex"),
      key = `${caller.uid}:${operationId}`,
      receipts = (sharedStore.__operations ??= {});
    if (receipts[key]) {
      if (receipts[key].fingerprint !== fingerprint)
        return res.status(409).json({
          error: "Identifiant déjà utilisé pour une autre opération.",
        });
      receipts[key].lastAccessAt = new Date().toISOString();
      if (receipts[key].identityMutationId) resumeQueuedIdentityMutation(sharedStore, receipts[key].identityMutationId);
      return res.json({
        ok: true,
        ...JSON.parse(
          receipts[key].encryptedResponse
            ? decrypt(receipts[key].encryptedResponse)
            : receipts[key].responseJson,
        ),
        store: filterStoreForCaller(sharedStore, caller),
        revision: sharedStore.__revision || 0,
      });
    }
    assertFreshOperationId(sharedStore,operationId);
    if (!CommandEnvelopeSchema.safeParse(command.data).success)
      return res.status(400).json({ error: 'Opération invalide.' });
    const firebaseBefore = new Map(identityAccounts(sharedStore).filter(a => a.firebaseUid)
      .map(a => [accountUid(a), { firebaseUid: a.firebaseUid, email: a.email,
        accountsJson: JSON.stringify(identityAccounts(sharedStore).filter(x => accountUid(x) === accountUid(a))) }]));
    const result = await runOperation(caller, operation, args, operationId, res.locals.transactionState);
    for (const [uid, before] of firebaseBefore) {
      const accounts = identityAccounts(sharedStore).filter(a => accountUid(a) === uid);
      if (JSON.stringify(accounts) !== before.accountsJson) assertIdentityReady(sharedStore, uid);
      if (accounts.some(a => a.email?.toLowerCase() !== before.email?.toLowerCase()))
        throw new OperationError('L’adresse liée à Firebase doit être modifiée par une procédure de vérification email.', 409);
      const secret = result?.generatedPassword || result?.invitationCode || result?.invitationToken;
      if (accounts.some(a => a.passwordHash) && secret &&
          accounts.some(a => verifyPassword(secret, a.passwordHash, a.email))) {
        planFirebasePassword(sharedStore, uid, before.firebaseUid, before.email, secret);
      }
      for (const a of accounts) { a.firebaseUid = before.firebaseUid; delete a.password; delete a.passwordHash; }
    }
    const resultMeta = Array.isArray(result)
        ? Object.fromEntries(
            Object.entries(result).filter(([k]) => !/^\d+$/.test(k)),
          )
        : undefined,
      responseJson = JSON.stringify({ operation, result, resultMeta });
    // Invitation secrets are returned once and kept encrypted in retry receipts.
    for (const cabinet of sharedStore.syndik_prod_syndics_v1 || [])
      for (const building of cabinet.buildings || [])
        for (const resident of building.residents || []) {
          delete resident.invitationCode;
          delete resident.invitationToken;
        }
    for (const provider of sharedStore.syndik_prod_prestataires_v1 || []) {
      delete provider.invitationCode;
      delete provider.invitationToken;
    }
    receipts[key] = {
      operation,
      actorScope: operationActorScope(caller),
      fingerprint,
      identityMutationId: pendingIdentityPlanId(),
      encryptedResponse: encrypt(responseJson),
      createdAt: new Date().toISOString(),
    };
    return res.json({
      ok: true,
      ...JSON.parse(responseJson),
      store: filterStoreForCaller(sharedStore, caller),
      revision: sharedStore.__revision || 0,
    });
  });
  api.get("/api/auth/session", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller) return res.status(401).json({ error: "Session expirée." });
    return res.json({
      ok: true,
      profile: caller,
      token: issueServerSessionToken(caller),
    });
  });
  api.post("/api/auth/logout", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    const firebaseAccount = caller && identityAccounts(sharedStore).find(a => accountUid(a) === caller.uid && a.firebaseUid);
    if (firebaseAccount) queueFirebaseMutation(sharedStore, { kind: 'revoke', target: caller.uid,
      firebaseUid: firebaseAccount.firebaseUid, email: firebaseAccount.email });
    if (caller)
      (sharedStore.__sessionVersions ??= {})[caller.uid] =
        (sharedStore.__sessionVersions?.[caller.uid] || 0) + 1;
    res.clearCookie("syndik_session", { path: "/" });
    return res.json({ ok: true });
  });
  api.get("/api/reports", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    return res.json(
      buildingReport(sharedStore, caller, String(req.query.buildingId || "")),
    );
  });
  api.get("/api/archives", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller || !["admin", "syndic"].includes(caller.role))
      return res.status(403).json({ error: "Accès refusé." });
    const scope = getAuthorizedScopeForCaller(sharedStore, caller);
    return res.json({
      buildings: scope.authorizedSyndics.flatMap((s: any) =>
        (s.buildings || [])
          .filter((b: any) => b.archivedAt)
          .map((b: any) => ({
            id: b.id,
            name: b.name,
            archivedAt: b.archivedAt,
          })),
      ),
    });
  });
  api.get("/api/ready", async (_req, res) =>
    res.json({ status: "ready", revision: sharedStore.__revision || 0, runtimeRevision: process.env.K_REVISION || 'local',
      checks: { databaseRead: 'ok', storageWrite: 'not_checked' } }),
  );
  api.get('/api/diagnostics', async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller || !['admin', 'syndic'].includes(caller.role))
      return res.status(403).json({ error: 'Accès réservé au gestionnaire.' });
    return res.json({
      revision: process.env.K_REVISION || 'local',
      database: { backend: process.env.SYNDIK_STATE_BACKEND || (process.env.NODE_ENV === 'production' ? 'firestore' : 'file'), id: process.env.FIRESTORE_DATABASE_ID, read: 'ok' },
      storage: { backend: process.env.NODE_ENV === 'production' || process.env.SYNDIK_UPLOAD_BACKEND === 'gcs' ? 'gcs' : 'file', bucket: process.env.SYNDIK_UPLOAD_BUCKET, write: 'not_checked' },
      sessionSecretConfigured: HAS_CONFIGURED_SESSION_SECRET,
      authenticationProvider: usesFirebaseAuth() ? 'firebase' : 'legacy',
      accountEmailProvider: usesFirebaseAuth() ? 'firebase' : 'sendgrid',
      firebaseAuthentication: { configured: Boolean(process.env.FIREBASE_API_KEY || firebaseConfig.apiKey), liveCheck: 'not_checked' },
      transactionalMailConfigured: mailIsConfigured(),
      warnings: HAS_CONFIGURED_SESSION_SECRET ? [] : ['SESSION_SECRET_NOT_CONFIGURED'],
    });
  });
  const scheduler = (req: express.Request) => {
    const secret = process.env.SYNDIK_SCHEDULER_SECRET || "";
    return (
      secret.length >= 32 &&
      timingSafeStringEqual(
        String(req.headers["x-syndik-scheduler"] || ""),
        secret,
      )
    );
  };
  app.post("/api/jobs/lifecycle",wrap(async(req:express.Request,res:express.Response)=>{
    if(!scheduler(req))return res.status(403).json({error:'Ordonnanceur non autorisé.'});
    return res.json(await runLifecycle(repository,lifecycleStorage(UPLOADS_DIR)));
  },false));
  app.post("/api/jobs/monthly-charges", wrap(monthlyBillingJob(repository, scheduler), false));
  api.get('/api/billing-runs', async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller) throw new OperationError('Authentification requise.', 401);
    const syndicId = String(req.query.syndicId || ''), buildingId = String(req.query.buildingId || '');
    authorizeBillingBuilding(sharedStore, caller, syndicId, buildingId);
    const runs = (sharedStore.__billingRuns || []).filter((r: any) => r.results.some((x: any) =>
      x.syndicId === syndicId && x.buildingId === buildingId && x.status === 'failed'));
    return res.json({ runs: runs.slice(-50).reverse().map((r: any) => ({ id: r.id, period: r.period,
      startedAt: r.startedAt, status: r.status,
      resolved: (sharedStore.__billingRuns || []).some((later: any) => later.period === r.period && later.startedAt >= r.startedAt && later.id !== r.id &&
        later.results.some((x: any) => x.syndicId === syndicId && x.buildingId === buildingId &&
          (x.status === 'succeeded' || (x.status === 'skipped' && x.reason === 'already_billed')))),
      results: r.results.filter((x: any) => x.syndicId === syndicId && x.buildingId === buildingId) })) });
  });
  app.post('/api/billing-runs/retry', wrap(async (req: express.Request, res: express.Response) => {
    const { syndicId, buildingId, runId } = z.object({ syndicId: z.string().min(1), buildingId: z.string().min(1), runId: z.string().uuid() }).parse(req.body);
    const input = await repository.transaction(async state => {
      const caller = await extractAndVerifyCaller(req, state);
      if (!caller) throw new OperationError('Authentification requise.', 401);
      authorizeBillingBuilding(state, caller, syndicId, buildingId);
      const run = (state.__billingRuns || []).find((r: any) => r.id === runId);
      if (!run) throw new OperationError('Exécution introuvable.', 404);
      return { caller, period: run.period };
    });
    const result = await generateScheduledMonthlyCharges(repository, input.period, String(res.getHeader('X-Request-ID')),
      { target: { syndicId, buildingId, runId, actor: input.caller } });
    return res.status(monthlyBillingHttpStatus(result)).json(result);
  }, false));
  api.post("/api/jobs/outbox", async (req, res) => {
    if (!scheduler(req))
      return res.status(403).json({ error: "Ordonnanceur non autorisé." });
    res.locals.afterCommit = () => resumeIdentityMutations(repository, executeFirebaseMutation, finalizeIdentityResponse);
    return res.json({ ok: true });
  });
  api.post("/api/jobs/overdue", async (req, res) => {
    if (!scheduler(req))
      return res.status(403).json({ error: "Ordonnanceur non autorisé." });
    for (const i of sharedStore.syndik_prod_invoices_v1 || [])
      if (
        i.status !== "paid" &&
        i.status !== "cancelled" &&
        Date.parse(i.dueDate) < Date.now()
      )
        i.status = "overdue";
    return res.json({ ok: true });
  });

  api.post("/api/shared-state", async (_req, res) =>
    res.status(403).json({
      error:
        "Les écritures globales sont désactivées. Utilisez les opérations serveur.",
    }),
  );
  api.post("/api/shared-state/reset", async (_req, res) =>
    res.status(403).json({ error: "La remise à zéro web est désactivée." }),
  );

  registerAiEndpoints({ post: (route, handler) => app.post(route, wrap(handler, false)) }, repository, extractAndVerifyCaller);

  if (!process.env.NODE_ENV || process.env.NODE_ENV === "development") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const assetsPath = path.join(distPath, "assets") + path.sep;
    // The HTML shell must be revalidated so a new release is picked up at once, and
    // it should not be framed by other origins. Vite content-hashes everything under
    // /assets, so those files never change in place and can be cached indefinitely.
    const shellHeaders = (res: express.Response) => {
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Frame-Options", "SAMEORIGIN");
      res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
    };
    app.use(
      express.static(distPath, {
        setHeaders(res, filePath) {
          res.setHeader("X-Content-Type-Options", "nosniff");
          if (filePath.startsWith(assetsPath))
            res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          else if (filePath.endsWith(".html")) shellHeaders(res);
        },
      }),
    );
    app.get("*all", async (req, res) => {
      if (req.path.startsWith("/api/")) {
        return res
          .status(404)
          .json({ ok: false, error: "API route not found" });
      }
      // A hashed file that no longer exists (an open tab from the previous release
      // lazy-loading a chunk) must fail as a 404. Answering with index.html and a
      // 200 turns it into an opaque "Unexpected token <" script error.
      if (req.path.startsWith("/assets/"))
        return res.status(404).type("text/plain").send("Not found");
      shellHeaders(res);
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  const shutdown = () => {
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 5000).unref();
    server.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

startServer().catch(error => {
  console.error(error instanceof Error ? error.message : "Server startup failed");
  process.exitCode = 1;
});



