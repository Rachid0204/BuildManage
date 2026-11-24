import express from 'express';
import { z } from 'zod';
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
  queueMail,
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
import { ProductionConfigError, validateProductionEnvironment } from './server/productionConfig';
import { createApiCorsMiddleware } from './server/corsPolicy';
import {
  cancelAccountDeletionRequest,
  getActiveAccountDeletionRequest,
  submitAccountDeletionRequest,
} from './server/accountDeletion';
import {
  deliverPushOutbox,
  listUserDeviceTokens,
  queuePushNotification,
  registerDeviceToken,
  sanitizePushPlatform,
  sanitizePushToken,
  unregisterDeviceToken,
} from './server/pushNotifications';
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
import {
  activatePlatformSubscription,
  voidPlatformSubscriptionPayment,
} from './server/domain/building.service';
import {
  buildCmiCheckoutPayload,
  normalizeCmiCurrencyCode,
  normalizeCmiEnv,
  runCmiSelfTest,
  verifyCmiCallbackHash,
} from './server/cmiBilling';
import {
  capturePayPalOrder,
  computeSubscriptionPricing,
  createPayPalOrder,
  getPayPalAccessToken,
  getPayPalOrder,
  recordGatewayEvent,
  resolveAndValidatePromoCode,
  resolvePlatformBillingConfig,
  updatePlatformBillingConfig,
  verifyPayPalWebhookSignature,
} from './server/paypalBilling';
import { PLANS } from './shared/domain/subscription';
import type {
  AdminBillingConfigUpdateInput,
  AssembleeGenerale,
  Building,
  SubscriptionPlan,
  SubscriptionPromoCode,
} from './types';
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

  const prestList: any[] = Array.isArray(store.syndik_prod_prestataires_v1)
    ? store.syndik_prod_prestataires_v1
    : [];
  const isProviderInactive = (pId?: string) => {
    if (!pId) return false;
    const rec = prestList.find((p: any) => p?.id === pId);
    return Boolean(rec && (rec.archivedAt || rec.active === false));
  };

  const regUsers: any[] = Array.isArray(store.syndik_prod_registered_users_v1)
    ? store.syndik_prod_registered_users_v1
    : [];
  for (const u of regUsers) {
    if (u?.disabled) continue;
    if (u?.uid === uid || u?.profile?.uid === uid) {
      const p = u.profile || u;
      const role = p.role || u.role || "syndic";
      if (role === "provider" && isProviderInactive(p.prestataireId)) continue;
      candidates.push({
        uid: p.uid || u.uid,
        email: (p.email || u.email || "").trim().toLowerCase(),
        role,
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
    if (a?.disabled) continue;
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
        if (r?.archivedAt) continue;
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
    if (a?.disabled) continue;
    const pId = a?.prestataireId;
    if (isProviderInactive(pId)) continue;
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
  for (const p of prestList) {
    if (p?.archivedAt || p?.active === false) continue;
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
    // Audit P0-4 & PR3 #20: A resident is ONLY authorized for active (non-archived) building(s) they belong to
    for (const s of syndics) {
      if (s?.archivedAt) continue;
      const residentBuildings = (s?.buildings || []).filter(
        (b: any) =>
          !b?.archivedAt &&
          ((caller.buildingId && b?.id === caller.buildingId) ||
            (Array.isArray(b?.residents) &&
              b.residents.some(
                (r: any) =>
                  !r?.archivedAt &&
                  (r?.id === callerResId || r?.id === caller.uid),
              ))),
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
      (p) =>
        !p?.archivedAt &&
        p?.active !== false &&
        (p?.id === callerPrestId || p?.id === caller.uid),
    );
    const providerBldIds = new Set<string>();
    if (caller.buildingId) providerBldIds.add(caller.buildingId);
    for (const p of matchedPrests) {
      if (p?.buildingId) providerBldIds.add(p.buildingId);
    }

    for (const s of syndics) {
      if (s?.archivedAt) continue;
      const providerBuildings = (s?.buildings || []).filter(
        (b: any) => !b?.archivedAt && b?.id && providerBldIds.has(b.id),
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
            (b: any) =>
              (scope.isAdmin || scope.authorizedBuildingIds.has(b.id)) &&
              (managed || !b.archivedAt),
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
              : caller.role === "provider"
                ? {
                    ...b,
                    bankName: undefined,
                    bankRib: undefined,
                    ice: undefined,
                    rc: undefined,
                    monthlySyndicFees: 0,
                    reserveFundRate: 0,
                    financials: {
                      balance: 0,
                      reserveFundBalance: 0,
                      transactions: [],
                    },
                    residents: [],
                    apartments: (b.apartments || []).map((a: any) => ({
                      id: a.id,
                      buildingId: a.buildingId,
                      number: a.number,
                      floor: a.floor,
                      coproType: a.coproType,
                    })),
                    announcements: [],
                    documents: [],
                  }
                : (() => {
                    const callerRes = (b.residents || []).find(
                      (r: any) =>
                        !r.archivedAt &&
                        (r.id === scope.callerResId || r.id === caller.uid),
                    );
                    const callerIsOwner = callerRes?.isOwner === true;
                    return {
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
                      documents: (b.documents || []).filter((d: any) => {
                        const vis = d?.visibility || "all";
                        if (vis === "syndic_only") return false;
                        if (vis === "owners_only") return callerIsOwner;
                        return true;
                      }),
                    };
                  })(),
          ),
      }));
      continue;
    }
    if (!Array.isArray(value)) continue;
    if (key === "syndik_prod_notifications_v1")
      result[key] = value
        .filter(
          (n: any) =>
            n.userId === caller.uid ||
            (n.userId === "all" && scope.authorizedBuildingIds.has(n.buildingId)),
        )
        .map((n: any) =>
          n.userId === "all"
            ? {
                ...n,
                read: Boolean(
                  n.read ||
                    (Array.isArray(n.readBy) && n.readBy.includes(caller.uid)),
                ),
              }
            : n,
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
    else if (key === "syndik_prod_subscription_requests_v1")
      result[key] = value.filter(
        (r: any) =>
          scope.isAdmin ||
          (managed && scope.authorizedSyndicIds.has(r.syndicId)),
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
        if (key === "syndik_prod_chat_v1") {
          if (caller.role === "provider") return false;
          if (!item.recipientId) return true;
          if (caller.role === "resident") {
            return [item.senderId, item.recipientId].includes(scope.callerResId);
          }
          const bldOwnerSyndicId = (store.syndik_prod_syndics_v1 || []).find(
            (s: any) =>
              (s.buildings || []).some((b: any) => b.id === item.buildingId),
          )?.id;
          return [item.senderId, item.recipientId].some(
            (p) =>
              p === caller.uid ||
              (bldOwnerSyndicId && p === bldOwnerSyndicId) ||
              scope.authorizedSyndicIds.has(p),
          );
        }
        if (key === "syndik_prod_ag_v1") {
          if (caller.role === "provider") return false;
          if (caller.role === "resident") {
            const building = (store.syndik_prod_syndics_v1 || [])
              .flatMap((s: any) => s.buildings || [])
              .find((b: any) => b.id === item.buildingId);
            const residentRec = building?.residents?.find(
              (r: any) =>
                !r.archivedAt &&
                (r.id === scope.callerResId || r.id === caller.uid),
            );
            if (!residentRec || residentRec.isOwner !== true) return false;
          }
        }
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
      (assembly: AssembleeGenerale) =>
        projectAssemblyForRole(
          assembly,
          caller.role,
          caller.role === "resident" ? scope.callerResId : undefined,
        ),
    );
  return clean(result);
}

function assertOnboarded(caller: AuthCallerContext, state: Record<string, any>) {
  const accounts = identityAccounts(state).filter(
    (u: any) => !u.disabled && accountUid(u) === caller.uid,
  );
  if (
    (caller as any).emailVerified === false ||
    accounts.some((u: any) => u?.profile?.emailVerified === false)
  ) {
    throw new OperationError(
      "Vérifiez votre adresse email.",
      403,
      "ONBOARDING_REQUIRED",
    );
  }
  if (
    (caller as any).mustChangePassword ||
    accounts.some(
      (u: any) => u?.mustChangePassword || u?.profile?.mustChangePassword,
    )
  ) {
    throw new OperationError(
      "Changez votre mot de passe initial avant de continuer.",
      403,
      "ONBOARDING_REQUIRED",
    );
  }
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

  app.use(express.json({ limit: "15mb" }));
  app.use("/api", createApiCorsMiddleware());

  process.env.SYNDIK_SERVER_SECRET ||= LEGACY_SERVER_SECRET;
  if (process.env.SYNDIK_SERVER_SECRET.length < 32) {
    process.env.SYNDIK_SERVER_SECRET = LEGACY_SERVER_SECRET;
  }
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
      if (
        res.statusCode < 400 &&
        ["/api/commands", "/api/ag/vote", "/api/jobs/outbox"].includes(req.path)
      ) {
        if (req.path === "/api/jobs/outbox") {
          await deliverPushOutbox(repository, 25).catch(() => {});
        } else {
          void deliverPushOutbox(repository, 10).catch(() => {});
        }
      }
      if (format === "send") send(payload);
      else json(payload);
    };
  const api = {
    get: (route: string, handler: (req: express.Request, res: express.Response) => unknown) => app.get(route, wrap(handler)),
    post: (route: string, handler: (req: express.Request, res: express.Response) => unknown) => app.post(route, wrap(handler)),
  };
  registerIdentityRoutes(api, extractAndVerifyCaller);
  registerLiveUpdates(app, repository, async (req, state) => {
    const caller = await extractAndVerifyCaller(req, state);
    if (caller) assertOnboarded(caller, state);
    return caller;
  });
  app.use("/api", (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // API Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", revision: process.env.K_REVISION || 'local', timestamp: new Date().toISOString() });
  });

  // Mobile Push Notification Device Token Registry (FCM / APNs)
  app.get("/api/devices/push-token", async (req, res) => {
    try {
      const outcome = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) return { status: 401, body: { ok: false, error: "Authentification requise." } };
        const tokens = listUserDeviceTokens(state, caller.uid);
        return {
          status: 200,
          body: {
            ok: true,
            count: tokens.length,
            platforms: [...new Set(tokens.map((t) => t.platform))],
          },
        };
      });
      return res.status(outcome.status).json(outcome.body);
    } catch {
      return res.status(500).json({ ok: false, error: "Impossible de lire les appareils enregistrés." });
    }
  });

  app.post("/api/devices/push-token", async (req, res) => {
    try {
      const token = sanitizePushToken(req.body?.token);
      const platform = sanitizePushPlatform(req.body?.platform);
      const deviceLabel =
        typeof req.body?.deviceLabel === "string"
          ? req.body.deviceLabel.trim().slice(0, 80)
          : undefined;
      const outcome = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) return { status: 401, body: { ok: false, error: "Authentification requise." } };
        if (!token || !platform) {
          return { status: 400, body: { ok: false, error: "Jeton push ou plateforme invalide." } };
        }
        const record = registerDeviceToken(state, {
          uid: caller.uid,
          token,
          platform,
          deviceLabel,
        });
        return {
          status: 200,
          body: { ok: true, platform: record.platform, updatedAt: record.updatedAt },
        };
      });
      return res.status(outcome.status).json(outcome.body);
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: err?.message || "Enregistrement du jeton push impossible." });
    }
  });

  app.delete("/api/devices/push-token", async (req, res) => {
    try {
      const rawToken = typeof req.body?.token === "string" ? req.body.token.trim() : undefined;
      const outcome = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) return { status: 401, body: { ok: false, error: "Authentification requise." } };
        if (rawToken && rawToken !== "*" && !sanitizePushToken(rawToken)) {
          return { status: 400, body: { ok: false, error: "Jeton push invalide." } };
        }
        const removed = unregisterDeviceToken(state, { uid: caller.uid, token: rawToken });
        return { status: 200, body: { ok: true, removed } };
      });
      return res.status(outcome.status).json(outcome.body);
    } catch {
      return res.status(500).json({ ok: false, error: "Suppression du jeton push impossible." });
    }
  });

  // Account Deletion Requests (CNDP Law 09-08, Apple App Store Guideline 5.1.1(v), Google Play Data Safety)
  app.get("/api/account/deletion-request", async (req, res) => {
    try {
      const outcome = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) return { status: 401, body: { ok: false, error: "Authentification requise." } };
        const active = getActiveAccountDeletionRequest(state, caller.uid);
        return {
          status: 200,
          body: {
            ok: true,
            request: active
              ? {
                  id: active.id,
                  status: active.status,
                  requestedAt: active.requestedAt,
                  revokedPushTokens: active.revokedPushTokens,
                }
              : null,
          },
        };
      });
      return res.status(outcome.status).json(outcome.body);
    } catch {
      return res.status(500).json({ ok: false, error: "Lecture du statut de suppression impossible." });
    }
  });

  app.post("/api/account/deletion-request", async (req, res) => {
    try {
      const confirmEmail = typeof req.body?.confirmEmail === "string" ? req.body.confirmEmail : "";
      const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
      const outcome = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) return { status: 401, body: { ok: false, error: "Authentification requise." } };
        const result = submitAccountDeletionRequest(state, {
          uid: caller.uid,
          email: caller.email || "",
          role: caller.role,
          syndicId: caller.syndicId,
          confirmEmail,
          reason,
        });
        if (!result.ok) {
          return { status: result.status, body: { ok: false, error: result.error } };
        }
        return {
          status: result.alreadyPending ? 200 : 201,
          body: {
            ok: true,
            alreadyPending: result.alreadyPending,
            request: {
              id: result.request.id,
              status: result.request.status,
              requestedAt: result.request.requestedAt,
              revokedPushTokens: result.request.revokedPushTokens,
            },
          },
        };
      });
      if (outcome.status === 201) {
        void deliverOutbox(repository, 2).catch(() => {});
      }
      return res.status(outcome.status).json(outcome.body);
    } catch {
      return res.status(500).json({ ok: false, error: "Enregistrement de la demande de suppression impossible." });
    }
  });

  app.delete("/api/account/deletion-request", async (req, res) => {
    try {
      const outcome = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) return { status: 401, body: { ok: false, error: "Authentification requise." } };
        const { cancelled } = cancelAccountDeletionRequest(state, caller.uid);
        return { status: 200, body: { ok: true, cancelled } };
      });
      return res.status(outcome.status).json(outcome.body);
    } catch {
      return res.status(500).json({ ok: false, error: "Annulation de la demande impossible." });
    }
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
    const registered: any[] = (sharedStore.syndik_prod_registered_users_v1 ??= []);
    if (
      decoded.email_verified &&
      process.env.SYNDIK_BOOTSTRAP_ADMIN_EMAIL?.toLowerCase() ===
        decoded.email.toLowerCase() &&
      !candidates.some((p) => p.role === "admin")
    ) {
      const emailLower = decoded.email.toLowerCase();
      const existingIdx = registered.findIndex(
        (u: any) =>
          !u.disabled &&
          (u.uid === decoded.uid ||
            u.firebaseUid === decoded.uid ||
            u.email?.trim().toLowerCase() === emailLower),
      );
      const existing = existingIdx >= 0 ? registered[existingIdx] : undefined;
      const profile = {
        ...(existing?.profile || {}),
        uid: existing?.uid || decoded.uid,
        email: emailLower,
        role: "admin",
        displayName:
          existing?.profile?.displayName || decoded.name || "Admin",
        emailVerified: true,
      };
      if (existingIdx >= 0) {
        registered[existingIdx] = {
          ...existing,
          uid: profile.uid,
          email: emailLower,
          profile,
        };
      } else {
        registered.push({
          uid: profile.uid,
          email: emailLower,
          profile,
        });
      }
      candidates = [profile];
    }
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
    const verifiedNow = fbUser
      ? fbUser.emailVerified === true
      : decoded.email_verified === true;
    profile = {
      ...storedProfile,
      ...profile,
      firebaseAuthTime: decoded.auth_time,
      firebaseUid: firebaseAccount?.firebaseUid,
      emailVerified: verifiedNow,
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
        (u: any) => !u.disabled && u.email?.trim().toLowerCase() === emailNorm,
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

    const newPassword = String(req.body?.newPassword || "");
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

  const CastVoteBodySchema = z.object({
    agId: z.string().min(1).max(200),
    resolutionId: z.string().min(1).max(200),
    choice: z.enum(["for", "against", "abstain"]),
    residentId: z.string().max(200).optional(),
    apartmentId: z.string().max(200).optional(),
    comment: z.string().max(1000).optional(),
    allowOverrideResidentVote: z.boolean().optional(),
  });

  api.post("/api/ag/vote", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    assertOnboarded(caller, sharedStore);
    const parsedBody = CastVoteBodySchema.safeParse(req.body);
    if (!parsedBody.success)
      return res.status(400).json({ error: "Paramètres de vote invalides." });
    const body = parsedBody.data;
    const list: AssembleeGenerale[] = sharedStore.syndik_prod_ag_v1 || [];
    const index = list.findIndex((a) => a.id === body.agId);
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
          ? String(body.residentId || "")
          : "";
    if (
      !residentId ||
      (caller.role === "resident" &&
        body.residentId &&
        body.residentId !== residentId)
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
        body.resolutionId,
        body.choice,
        body.apartmentId || undefined,
        body.comment,
        {
          actorRole: caller.role as "resident" | "syndic" | "admin",
          actorUid: caller.uid,
          allowOverrideResidentVote: Boolean(body.allowOverrideResidentVote),
        },
      );
      recomputeMeeting(result);
      appendAudit(sharedStore, caller, "castResidentAGVote", building.id, {
        agId: ag.id,
        resolutionId: body.resolutionId,
        residentId,
        apartmentId: body.apartmentId || undefined,
      });
      list[index] = result;
      sharedStore.syndik_prod_ag_v1 = list;

      return res.json({
        ag: projectAssemblyForRole(
          result,
          caller.role,
          caller.role === "resident" ? scope.callerResId : undefined,
        ),
        revision: sharedStore.__revision,
      });
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
    assertOnboarded(caller, sharedStore);
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

  const decodeValidatedUploadBytes = (dataUrlRaw: unknown) => {
    const match = String(dataUrlRaw || "").match(
      /^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/,
    );
    if (!match) return null;
    const bytes = Buffer.from(match[2], "base64"),
      mime = match[1];
    if (bytes.length > 5 * 1048576) {
      throw new OperationError("Fichier limité à 5 Mo.", 413);
    }
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
    if (!valid) {
      throw new OperationError(
        "Format accepté : PDF, PNG, JPEG ou WebP.",
        400,
      );
    }
    return { bytes, mime };
  };

  // Binary Document & Receipt Offload Endpoints (/api/uploads) with building-scoped auth (Audit P1-5)
  app.post(
    "/api/uploads",
    wrap(async (req, res) => {
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller)
          throw new OperationError("Authentification requise.", 401);
        assertOnboarded(caller, state);
        const buildingId = String(req.body?.buildingId || caller.buildingId || ""),
          b = buildingFor(caller, buildingId, false);
        canWrite(caller, b);
        const decoded = decodeValidatedUploadBytes(req.body?.dataUrl);
        if (!decoded) throw new OperationError("Fichier invalide.", 400);
        const { bytes, mime } = decoded;
        const fileId = crypto
            .createHash("sha256")
            .update(`${buildingId}:${caller.uid}:`)
            .update(bytes)
            .digest("hex"),
          key = `private/${buildingId}/${fileId}`;
        if (state.__files?.[fileId]?.lifecycle === "deleting")
          throw new OperationError(
            "Fichier en cours de suppression. Réessayez dans un instant.",
            409,
          );
        return { caller, buildingId, fileId, key, bytes, mime };
      });

      await savePrivateFile(
        UPLOADS_DIR,
        preflight.fileId,
        preflight.key,
        preflight.bytes,
        preflight.mime,
      );

      await repository.transaction(async (state) => {
        if (state.__files?.[preflight.fileId]?.lifecycle === "deleting")
          throw new OperationError(
            "Fichier en cours de suppression. Réessayez dans un instant.",
            409,
          );
        (state.__files ??= {})[preflight.fileId] = {
          fileId: preflight.fileId,
          key: preflight.key,
          mimeType: preflight.mime,
          buildingId: preflight.buildingId,
          uploadedBy: preflight.caller.uid,
          name: String(req.body?.name || "document").slice(0, 200),
          sizeBytes: preflight.bytes.length,
          createdAt:
            state.__files?.[preflight.fileId]?.createdAt ||
            new Date().toISOString(),
          lastUploadedAt: new Date().toISOString(),
        };
      });

      return res.json({
        ok: true,
        fileId: preflight.fileId,
        url: `/api/uploads/${preflight.fileId}`,
        mimeType: preflight.mime,
        sizeBytes: preflight.bytes.length,
      });
    }, false),
  );

  app.post(
    "/api/subscription/upload-proof",
    wrap(async (req, res) => {
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller)
          throw new OperationError("Authentification requise.", 401);
        if (!["admin", "syndic"].includes(caller.role))
          throw new OperationError("Opération réservée au syndic.", 403);
        assertOnboarded(caller, state);

        const requestedSyndicId = String(
          req.body?.syndicId || caller.syndicId || "",
        ).trim();
        const syndics = state.syndik_prod_syndics_v1 || [];
        const s = syndics.find((cab: any) =>
          requestedSyndicId
            ? cab.id === requestedSyndicId
            : cab.createdBy === caller.uid || caller.syndicId === cab.id,
        );
        if (
          !s ||
          (caller.role !== "admin" &&
            s.createdBy !== caller.uid &&
            caller.syndicId !== s.id)
        ) {
          throw new OperationError("Cabinet non autorisé.", 403);
        }
        if (s.archivedAt) {
          throw new OperationError(
            "Cabinet archivé : impossible de téléverser un justificatif.",
            409,
          );
        }
        if (caller.role !== "admin" && s.subscriptionStatus === "cancelled") {
          throw new OperationError(
            "Votre compte est suspendu. Contactez l'administration.",
            403,
          );
        }

        const decoded = decodeValidatedUploadBytes(req.body?.dataUrl);
        if (!decoded) throw new OperationError("Fichier invalide.", 400);
        const { bytes, mime } = decoded;
        const fileId = crypto
            .createHash("sha256")
            .update(`sub:${s.id}:${caller.uid}:`)
            .update(bytes)
            .digest("hex"),
          key = `private/subscription-${s.id}/${fileId}`;
        if (state.__files?.[fileId]?.lifecycle === "deleting")
          throw new OperationError(
            "Fichier en cours de suppression. Réessayez dans un instant.",
            409,
          );
        return { caller, syndicId: s.id as string, fileId, key, bytes, mime };
      });

      await savePrivateFile(
        UPLOADS_DIR,
        preflight.fileId,
        preflight.key,
        preflight.bytes,
        preflight.mime,
      );

      await repository.transaction(async (state) => {
        if (state.__files?.[preflight.fileId]?.lifecycle === "deleting")
          throw new OperationError(
            "Fichier en cours de suppression. Réessayez dans un instant.",
            409,
          );
        (state.__files ??= {})[preflight.fileId] = {
          fileId: preflight.fileId,
          key: preflight.key,
          mimeType: preflight.mime,
          scope: "subscription",
          syndicId: preflight.syndicId,
          uploadedBy: preflight.caller.uid,
          name: String(req.body?.name || "justificatif-virement").slice(0, 200),
          sizeBytes: preflight.bytes.length,
          createdAt:
            state.__files?.[preflight.fileId]?.createdAt ||
            new Date().toISOString(),
          lastUploadedAt: new Date().toISOString(),
        };
      });

      return res.json({
        ok: true,
        fileId: preflight.fileId,
        url: `/api/uploads/${preflight.fileId}`,
        mimeType: preflight.mime,
        sizeBytes: preflight.bytes.length,
      });
    }, false),
  );

  app.get(
    "/api/uploads/:fileId",
    wrap(async (req, res) => {
      const id = String(req.params.fileId);
      const authorized = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller)
          throw new OperationError("Authentification requise.", 401);
        assertOnboarded(caller, state);
        const meta = state.__files?.[id];
        if (!meta || meta.deletedAt) throw new OperationError("Fichier introuvable.", 404);
        if (meta.scope === "subscription") {
          const ownerSyndic =
            caller.role === "syndic" &&
            (state.syndik_prod_syndics_v1 || []).some(
              (s: any) =>
                s.id === meta.syndicId &&
                (s.createdBy === caller.uid || caller.syndicId === s.id),
            );
          if (
            caller.role !== "admin" &&
            meta.uploadedBy !== caller.uid &&
            !ownerSyndic
          ) {
            throw new OperationError("Fichier privé.", 403);
          }
          return { key: meta.key as string, mimeType: meta.mimeType as string };
        }
        const b = buildingFor(caller, meta.buildingId, false),
          callerResidentRec =
            caller.role === "resident"
              ? (b.residents || []).find(
                  (r: any) =>
                    !r.archivedAt &&
                    (r.id === actorIdentity(caller) || r.id === caller.uid),
                )
              : undefined,
          publicDocument =
            caller.role !== "provider" &&
            (b.documents || []).some((d: any) => {
              if (d.url !== `/api/uploads/${id}`) return false;
              const vis = d.visibility || "all";
              if (vis === "syndic_only") return false;
              if (vis === "owners_only") return callerResidentRec?.isOwner === true;
              return true;
            }),
          marketImage =
            caller.role !== "provider" &&
            (state.syndik_prod_marketplace_v1 || []).some(
              (m: any) =>
                m.buildingId === b.id &&
                (m.imageUrl === `/api/uploads/${id}` ||
                  m.images?.includes(`/api/uploads/${id}`)),
            ),
          assigned = (state.syndik_prod_maintenance_v1 || []).some(
            (m: any) =>
              m.buildingId === b.id &&
              ((caller.role === "provider" &&
                caller.prestataireId &&
                [m.prestataireId, m.assignedTo].includes(
                  caller.prestataireId,
                )) ||
                (caller.role === "resident" &&
                  caller.residentId &&
                  m.residentId === caller.residentId)) &&
              privateAttachments(m).has(`/api/uploads/${id}`),
          ),
          sharedInChat =
            caller.role !== "provider" &&
            (state.syndik_prod_chat_v1 || []).some(
              (m: any) =>
                m.buildingId === b.id &&
                m.attachmentUrl === `/api/uploads/${id}` &&
                (!m.recipientId ||
                  [m.senderId, m.recipientId].includes(actorIdentity(caller))),
            );
        if (
          !["admin", "syndic"].includes(caller.role) &&
          meta.uploadedBy !== caller.uid &&
          !publicDocument &&
          !marketImage &&
          !assigned &&
          !sharedInChat
        ) {
          throw new OperationError("Fichier privé.", 403);
        }
        return { key: meta.key as string, mimeType: meta.mimeType as string };
      });

      const bytes = await readPrivateFile(UPLOADS_DIR, id, authorized.key);
      res.setHeader("Content-Type", authorized.mimeType);
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(bytes);
    }, false),
  );

  // Platform Subscription Billing Configuration, PayPal, CMI Morocco, Cash, Promos & Observability Routes
  const AdminBillingConfigPaypalSchema = z.object({
    enabled: z.boolean(),
    env: z.enum(["sandbox", "live"]),
    checkoutMode: z.enum(["standard", "expanded"]),
    clientId: z.string().max(300),
    clientSecret: z.string().max(300).optional(),
    clearClientSecret: z.boolean().optional(),
    webhookId: z.string().max(200).optional(),
    clearWebhookId: z.boolean().optional(),
    allowLiveWithoutWebhook: z.boolean().optional(),
    currency: z.enum(["EUR", "USD"]),
    madPerUnit: z.number().positive().max(1_000_000),
    planPrices: z
      .object({
        starter: z.number().positive().max(1_000_000).optional(),
        professional: z.number().positive().max(1_000_000).optional(),
        enterprise: z.number().positive().max(1_000_000).optional(),
      })
      .optional(),
  });
  const AdminBillingConfigBankSchema = z.object({
    enabled: z.boolean(),
    bankName: z.string().max(120),
    accountHolder: z.string().max(160),
    rib: z.string().max(64),
    iban: z.string().max(64).optional(),
    swift: z.string().max(32).optional(),
    ice: z.string().max(40).optional(),
    instructionsFr: z.string().max(1500).optional(),
    instructionsAr: z.string().max(1500).optional(),
  });
  const AdminBillingConfigCmiSchema = z.object({
    enabled: z.boolean(),
    env: z.enum(["test", "production"]),
    clientId: z.string().max(120),
    storeKey: z.string().max(256).optional(),
    clearStoreKey: z.boolean().optional(),
    currencyCode: z.enum(["504", "978", "840"]).optional(),
    lang: z.enum(["fr", "ar"]).optional(),
    shopUrl: z.string().max(300).optional(),
  });
  const AdminBillingConfigCashSchema = z.object({
    enabled: z.boolean(),
    acceptedChannels: z.array(
      z.enum(["office", "wafacash", "cashplus", "baridcash", "check"]),
    ),
    beneficiaryName: z.string().max(160),
    officeAddress: z.string().max(300).optional(),
    officeHours: z.string().max(120).optional(),
    contactPhone: z.string().max(40).optional(),
    whatsapp: z.string().max(40).optional(),
    maxCashAmountMad: z.number().min(0).max(1_000_000).optional(),
    requireProofUpload: z.boolean().optional(),
    instructionsFr: z.string().max(1500).optional(),
    instructionsAr: z.string().max(1500).optional(),
  });
  const AdminBillingConfigIssuerSchema = z.object({
    companyName: z.string().max(160).optional(),
    legalForm: z.string().max(40).optional(),
    ice: z.string().max(40).optional(),
    rc: z.string().max(40).optional(),
    ifNumber: z.string().max(40).optional(),
    patente: z.string().max(40).optional(),
    cnss: z.string().max(40).optional(),
    address: z.string().max(250).optional(),
    city: z.string().max(80).optional(),
    email: z.string().max(120).optional(),
    phone: z.string().max(40).optional(),
    whatsapp: z.string().max(40).optional(),
    vatRate: z.union([z.literal(0), z.literal(20)]).optional(),
    invoicePrefix: z.string().max(12).optional(),
    receiptPrefix: z.string().max(12).optional(),
  });
  const AdminBillingConfigCommercialSchema = z.object({
    gracePeriodDays: z.number().int().min(0).max(30).optional(),
    multiMonthDiscounts: z
      .object({
        m3: z.number().min(0).max(50).optional(),
        m6: z.number().min(0).max(50).optional(),
        m12: z.number().min(0).max(50).optional(),
      })
      .optional(),
  });
  const AdminBillingConfigSchema = z.union([
    z.object({
      resetToEnv: z.literal(true),
      paypal: AdminBillingConfigPaypalSchema.optional(),
      bankTransfer: AdminBillingConfigBankSchema.optional(),
      cmi: AdminBillingConfigCmiSchema.optional(),
      cashPayment: AdminBillingConfigCashSchema.optional(),
      issuerProfile: AdminBillingConfigIssuerSchema.optional(),
      commercialPolicy: AdminBillingConfigCommercialSchema.optional(),
    }),
    z.object({
      resetToEnv: z.literal(false).optional(),
      paypal: AdminBillingConfigPaypalSchema,
      bankTransfer: AdminBillingConfigBankSchema,
      cmi: AdminBillingConfigCmiSchema.optional(),
      cashPayment: AdminBillingConfigCashSchema.optional(),
      issuerProfile: AdminBillingConfigIssuerSchema.optional(),
      commercialPolicy: AdminBillingConfigCommercialSchema.optional(),
    }),
  ]);

  const resolvePublicOrigin = (req: express.Request, configuredShopUrl?: string): string => {
    if (configuredShopUrl && /^https?:\/\//i.test(configuredShopUrl.trim())) {
      try {
        return new URL(configuredShopUrl.trim()).origin;
      } catch {
        // fallback below
      }
    }
    const envOrigin = String(process.env.PUBLIC_APP_URL || "").trim();
    if (envOrigin && /^https?:\/\//i.test(envOrigin)) {
      try {
        return new URL(envOrigin).origin;
      } catch {
        // fallback below
      }
    }
    const proto =
      String(req.headers["x-forwarded-proto"] || req.protocol || "http")
        .split(",")[0]
        .trim() || "http";
    const host = String(req.headers["x-forwarded-host"] || req.get("host") || "localhost").split(",")[0].trim();
    return `${proto}://${host}`;
  };

  api.get("/api/subscription/billing-config", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (!["admin", "syndic"].includes(caller.role))
      return res.status(403).json({ error: "Opération réservée au syndic." });
    assertOnboarded(caller, sharedStore);
    const resolved = resolvePlatformBillingConfig(sharedStore);
    return res.json({ ok: true, config: resolved.publicConfig });
  });

  api.get("/api/admin/billing-config", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const resolved = resolvePlatformBillingConfig(sharedStore);
    return res.json({ ok: true, config: resolved.adminConfig });
  });

  app.put(
    "/api/admin/billing-config",
    wrap(async (req, res) => {
      const caller = await extractAndVerifyCaller(req, sharedStore);
      if (!caller)
        return res.status(401).json({ error: "Authentification requise." });
      if (caller.role !== "admin")
        return res.status(403).json({ error: "Administration uniquement." });
      assertOnboarded(caller, sharedStore);
      const parsed = AdminBillingConfigSchema.parse(
        req.body,
      ) as AdminBillingConfigUpdateInput;
      const updated = updatePlatformBillingConfig(
        sharedStore,
        caller.uid,
        parsed,
      );
      recordGatewayEvent(sharedStore, {
        gateway: "system",
        eventType: parsed.resetToEnv
          ? "BILLING_CONFIG_RESET_TO_ENV"
          : "BILLING_CONFIG_UPDATED",
        status: "ok",
        httpStatus: 200,
        message: parsed.resetToEnv
          ? "Configuration passerelles réinitialisée aux variables d’environnement."
          : `Passerelles mises à jour (CMI:${updated.cmi.enabled ? "ON" : "OFF"}, PayPal:${updated.paypal.enabled ? "ON" : "OFF"}, Virement:${updated.bankTransfer.enabled ? "ON" : "OFF"}, Espèces:${updated.cashPayment.enabled ? "ON" : "OFF"}).`,
      });
      appendAudit(
        sharedStore,
        caller,
        "updatePlatformBillingConfig",
        undefined,
        {
          paypalEnabled: updated.paypal.enabled,
          paypalEnv: updated.paypal.env,
          paypalCheckoutMode: updated.paypal.checkoutMode,
          paypalCurrency: updated.paypal.currency,
          bankTransferEnabled: updated.bankTransfer.enabled,
          cmiEnabled: updated.cmi.enabled,
          cmiEnv: updated.cmi.env,
          cashPaymentEnabled: updated.cashPayment.enabled,
          gracePeriodDays: updated.commercialPolicy.gracePeriodDays,
          vatRate: updated.issuerProfile.vatRate,
        },
      );
      return res.json({ ok: true, config: updated });
    }, true),
  );

  app.post(
    "/api/admin/billing-config/test-paypal",
    wrap(async (req, res) => {
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (caller.role !== "admin")
          throw new OperationError("Administration uniquement.", 403);
        assertOnboarded(caller, state);
        const resolved = resolvePlatformBillingConfig(state).paypalSecrets;
        const bodyEnv =
          req.body?.env === "live" || req.body?.env === "sandbox"
            ? req.body.env
            : resolved.env;
        const clientId =
          typeof req.body?.clientId === "string" && req.body.clientId.trim()
            ? req.body.clientId.trim()
            : resolved.clientId;
        const clientSecret =
          typeof req.body?.clientSecret === "string" &&
          req.body.clientSecret.trim()
            ? req.body.clientSecret.trim()
            : resolved.clientSecret;
        return { env: bodyEnv, clientId, clientSecret };
      });
      await getPayPalAccessToken(preflight);
      return res.json({
        ok: true,
        env: preflight.env,
        message: "Connexion OAuth PayPal vérifiée avec succès.",
      });
    }, false),
  );

  app.post(
    "/api/admin/billing-config/test-cmi",
    wrap(async (req, res) => {
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (caller.role !== "admin")
          throw new OperationError("Administration uniquement.", 403);
        assertOnboarded(caller, state);
        const resolved = resolvePlatformBillingConfig(state).cmiSecrets;
        const env =
          req.body?.env === "production" || req.body?.env === "test"
            ? normalizeCmiEnv(req.body.env)
            : resolved.env;
        const clientId =
          typeof req.body?.clientId === "string" && req.body.clientId.trim()
            ? req.body.clientId.trim()
            : resolved.clientId;
        const storeKey =
          typeof req.body?.storeKey === "string" && req.body.storeKey.trim()
            ? req.body.storeKey.trim()
            : resolved.storeKey;
        const currencyCode = req.body?.currencyCode
          ? normalizeCmiCurrencyCode(req.body.currencyCode)
          : resolved.currencyCode;
        return { env, clientId, storeKey, currencyCode };
      });
      const result = runCmiSelfTest(preflight);
      return res.json(result);
    }, false),
  );

  const ValidatePromoSchema = z.object({
    plan: z.enum(["starter", "professional", "enterprise"]),
    months: z.number().int().min(1).max(12),
    promoCode: z.string().max(64).optional(),
  });

  api.post("/api/subscription/validate-promo", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (!["admin", "syndic"].includes(caller.role))
      return res.status(403).json({ error: "Opération réservée au syndic." });
    assertOnboarded(caller, sharedStore);
    const body = ValidatePromoSchema.parse(req.body);
    const billing = resolvePlatformBillingConfig(sharedStore).publicConfig;
    const promo = body.promoCode?.trim()
      ? resolveAndValidatePromoCode(
          sharedStore,
          body.promoCode,
          body.plan as SubscriptionPlan,
          body.months,
        )
      : undefined;
    const pricing = computeSubscriptionPricing(
      billing,
      body.plan as SubscriptionPlan,
      body.months,
      promo,
    );
    return res.json({
      ok: true,
      pricing,
      ...(promo
        ? {
            promo: {
              code: promo.code,
              discountType: promo.discountType,
              discountValue: promo.discountValue,
              description: promo.description || "",
            },
          }
        : {}),
    });
  });

  const CreatePayPalOrderSchema = z.object({
    syndicId: z.string().min(1).max(200),
    plan: z.enum(["starter", "professional", "enterprise"]),
    months: z.number().int().min(1).max(12),
    paymentSourceHint: z.enum(["paypal", "card"]).optional(),
    promoCode: z.string().max(64).optional(),
  });

  app.post(
    "/api/subscription/paypal/create-order",
    wrap(async (req, res) => {
      const body = CreatePayPalOrderSchema.parse(req.body);
      const prepared = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (!["admin", "syndic"].includes(caller.role))
          throw new OperationError("Opération réservée au syndic.", 403);
        assertOnboarded(caller, state);
        const s = (state.syndik_prod_syndics_v1 || []).find(
          (cab: any) => cab.id === body.syndicId,
        );
        if (
          !s ||
          (caller.role !== "admin" &&
            s.createdBy !== caller.uid &&
            caller.syndicId !== s.id)
        ) {
          throw new OperationError("Cabinet non autorisé.", 403);
        }
        if (s.archivedAt) {
          throw new OperationError(
            "Cabinet archivé : impossible de renouveler l'abonnement.",
            409,
          );
        }
        if (caller.role !== "admin" && s.subscriptionStatus === "cancelled") {
          throw new OperationError(
            "Votre compte est suspendu. Contactez l'administration.",
            403,
          );
        }
        const billing = resolvePlatformBillingConfig(state);
        if (!billing.paypalSecrets.enabled) {
          throw new OperationError(
            "Le paiement en ligne PayPal n'est pas configuré.",
            400,
          );
        }
        const promo = body.promoCode?.trim()
          ? resolveAndValidatePromoCode(
              state,
              body.promoCode,
              body.plan as SubscriptionPlan,
              body.months,
            )
          : undefined;
        const pricing = computeSubscriptionPricing(
          billing.publicConfig,
          body.plan as SubscriptionPlan,
          body.months,
          promo,
        );
        const intentId = `sub-${crypto.randomUUID()}`;
        const intents = (state.__paypalIntents ??= {});
        // Prune completed or expired intents older than 30 days
        const cutoff = Date.now() - 30 * 86_400_000;
        for (const [k, v] of Object.entries(intents) as [string, any][]) {
          if (v?.createdAt && Date.parse(v.createdAt) < cutoff) {
            delete intents[k];
          }
        }
        intents[intentId] = {
          intentId,
          syndicId: s.id,
          actorUid: caller.uid,
          plan: body.plan,
          months: body.months,
          amountMad: pricing.amountMad,
          paypalCurrency: pricing.paypalCurrency,
          paypalCents: pricing.paypalCents,
          ...(promo ? { promoCode: promo.code } : {}),
          ...(body.paymentSourceHint
            ? { paymentSourceHint: body.paymentSourceHint }
            : {}),
          status: "created",
          createdAt: new Date().toISOString(),
        };
        return {
          intentId,
          cabinetName: String(s.name || "ImmoGest"),
          pricing,
          creds: {
            env: billing.paypalSecrets.env,
            clientId: billing.paypalSecrets.clientId,
            clientSecret: billing.paypalSecrets.clientSecret,
          },
          paymentSourceHint: body.paymentSourceHint,
        };
      });

      const order = await createPayPalOrder(prepared.creds, {
        currency: prepared.pricing.paypalCurrency,
        amountValue: prepared.pricing.paypalAmountString,
        customId: prepared.intentId,
        requestId: prepared.intentId,
        description: `ImmoGest ${body.plan} (${body.months} mois) - ${prepared.cabinetName}`,
        paymentSourceHint: prepared.paymentSourceHint,
      });

      await repository.transaction(async (state) => {
        (state.__paypalOrders ??= {})[order.orderId] = prepared.intentId;
        if (state.__paypalIntents?.[prepared.intentId]) {
          state.__paypalIntents[prepared.intentId].orderId = order.orderId;
        }
      });

      return res.json({
        ok: true,
        orderId: order.orderId,
        currency: prepared.pricing.paypalCurrency,
        amount: prepared.pricing.paypalAmount,
        amountMad: prepared.pricing.amountMad,
      });
    }, false),
  );

  const CapturePayPalOrderSchema = z.object({
    orderId: z.string().min(4).max(120),
    syndicId: z.string().min(1).max(200),
    methodHint: z.enum(["paypal", "card"]).optional(),
  });

  app.post(
    "/api/subscription/paypal/capture-order",
    wrap(async (req, res) => {
      const body = CapturePayPalOrderSchema.parse(req.body);
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (!["admin", "syndic"].includes(caller.role))
          throw new OperationError("Opération réservée au syndic.", 403);
        assertOnboarded(caller, state);
        const s = (state.syndik_prod_syndics_v1 || []).find(
          (cab: any) => cab.id === body.syndicId,
        );
        if (
          !s ||
          (caller.role !== "admin" &&
            s.createdBy !== caller.uid &&
            caller.syndicId !== s.id)
        ) {
          throw new OperationError("Cabinet non autorisé.", 403);
        }
        if (s.archivedAt) {
          throw new OperationError("Cabinet archivé.", 409);
        }
        if (caller.role !== "admin" && s.subscriptionStatus === "cancelled") {
          throw new OperationError(
            "Votre compte est suspendu. Contactez l'administration.",
            403,
          );
        }
        const existing = (
          state.syndik_prod_subscription_payments_v1 || []
        ).find(
          (p: any) => !p.voidedAt && p.externalOrderId === body.orderId,
        );
        if (existing) {
          if (existing.syndicId !== body.syndicId) {
            throw new OperationError(
              "Cette commande appartient à un autre cabinet.",
              403,
            );
          }
          return {
            alreadyCaptured: true as const,
            payment: existing,
            store: filterStoreForCaller(state, caller),
            revision: state.__revision || 0,
          };
        }
        const mappedIntentId = state.__paypalOrders?.[body.orderId];
        const mappedIntent = mappedIntentId
          ? state.__paypalIntents?.[mappedIntentId]
          : undefined;
        if (mappedIntent && mappedIntent.syndicId !== body.syndicId) {
          throw new OperationError(
            "Commande PayPal associée à un autre cabinet.",
            403,
          );
        }
        const billing = resolvePlatformBillingConfig(state);
        if (!billing.paypalSecrets.enabled) {
          throw new OperationError(
            "Le paiement en ligne PayPal n'est pas configuré.",
            400,
          );
        }
        return {
          alreadyCaptured: false as const,
          caller,
          hasMappedIntent: Boolean(mappedIntent),
          creds: {
            env: billing.paypalSecrets.env,
            clientId: billing.paypalSecrets.clientId,
            clientSecret: billing.paypalSecrets.clientSecret,
          },
        };
      });

      if (preflight.alreadyCaptured) {
        return res.json({
          ok: true,
          alreadyCaptured: true,
          payment: preflight.payment,
          store: preflight.store,
          revision: preflight.revision,
        });
      }

      if (!preflight.hasMappedIntent) {
        // Crash-recovery path: verify ownership via read-only GET order before capturing funds.
        const remoteOrder = await getPayPalOrder(preflight.creds, body.orderId);
        const ownerVerified = await repository.transaction(async (state) => {
          const recoveredIntent = remoteOrder.customId
            ? state.__paypalIntents?.[remoteOrder.customId]
            : undefined;
          return Boolean(
            recoveredIntent && recoveredIntent.syndicId === body.syndicId,
          );
        });
        if (!ownerVerified) {
          throw new OperationError(
            "Commande PayPal introuvable ou non autorisée pour ce cabinet.",
            403,
          );
        }
      }

      const capture = await capturePayPalOrder(preflight.creds, body.orderId);

      const finalized = await repository.transaction(async (state) => {
        const caller = preflight.caller;
        const payments = (state.syndik_prod_subscription_payments_v1 ??= []);
        const existing = payments.find(
          (p: any) => !p.voidedAt && p.externalOrderId === body.orderId,
        );
        if (existing) {
          if (existing.syndicId !== body.syndicId) {
            throw new OperationError(
              "Commande PayPal associée à un autre cabinet.",
              403,
            );
          }
          return {
            alreadyCaptured: true,
            payment: existing,
            store: filterStoreForCaller(state, caller),
            revision: state.__revision || 0,
          };
        }

        const intentKey = state.__paypalOrders?.[body.orderId] || capture.customId;
        const intent = intentKey ? state.__paypalIntents?.[intentKey] : undefined;
        if (!intent || intent.syndicId !== body.syndicId) {
          throw new OperationError(
            "Commande PayPal introuvable ou non autorisée pour ce cabinet.",
            403,
          );
        }
        if (
          capture.status !== "COMPLETED" ||
          (capture.captureStatus && capture.captureStatus !== "COMPLETED")
        ) {
          throw new OperationError(
            "Paiement PayPal non finalisé (statut : " + capture.status + ").",
            402,
          );
        }
        if (
          capture.currency !== intent.paypalCurrency ||
          capture.amountCents !== intent.paypalCents
        ) {
          throw new OperationError(
            "Montant ou devise PayPal incohérent avec la commande.",
            409,
          );
        }

        const method =
          capture.hasCardPaymentSource ||
          body.methodHint === "card" ||
          intent.paymentSourceHint === "card"
            ? ("card" as const)
            : ("paypal" as const);

        const payment = activatePlatformSubscription(state, caller, {
          syndicId: intent.syndicId,
          plan: intent.plan as SubscriptionPlan,
          months: Number(intent.months),
          reference: capture.captureId || capture.orderId,
          amountMad: Number(intent.amountMad),
          method,
          currency: intent.paypalCurrency,
          chargedAmount: Number(intent.paypalCents) / 100,
          ...(intent.promoCode ? { promoCode: String(intent.promoCode) } : {}),
          externalOrderId: capture.orderId,
          ...(capture.captureId ? { externalCaptureId: capture.captureId } : {}),
          auditOperation: "paypalCaptureSubscription",
        });

        intent.status = "completed";
        intent.orderId = capture.orderId;
        intent.paymentId = payment.id;
        (state.__paypalOrders ??= {})[capture.orderId] = intentKey;
        recordGatewayEvent(state, {
          gateway: "paypal",
          eventType: "CAPTURE_ORDER_COMPLETED",
          status: "ok",
          httpStatus: 200,
          syndicId: intent.syndicId,
          orderId: capture.orderId,
          reference: payment.reference,
          message: `Capture PayPal (${method}) réussie — ${payment.amount} MAD (${payment.invoiceNumber || payment.id}).`,
        });

        return {
          alreadyCaptured: false,
          payment,
          store: filterStoreForCaller(state, caller),
          revision: (state.__revision || 0) + 1,
        };
      });

      return res.json({
        ok: true,
        alreadyCaptured: finalized.alreadyCaptured,
        payment: finalized.payment,
        store: finalized.store,
        revision: finalized.revision,
      });
    }, false),
  );

  app.post(
    "/api/webhooks/paypal",
    wrap(async (req, res) => {
      const authAlgo = String(req.headers["paypal-auth-algo"] || "").trim();
      const certUrl = String(req.headers["paypal-cert-url"] || "").trim();
      const transmissionId = String(
        req.headers["paypal-transmission-id"] || "",
      ).trim();
      const transmissionSig = String(
        req.headers["paypal-transmission-sig"] || "",
      ).trim();
      const transmissionTime = String(
        req.headers["paypal-transmission-time"] || "",
      ).trim();

      if (
        !authAlgo ||
        !certUrl ||
        !transmissionId ||
        !transmissionSig ||
        !transmissionTime
      ) {
        await repository.transaction(async (state) => {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType: String(req.body?.event_type || "WEBHOOK"),
            status: "rejected",
            httpStatus: 400,
            message: "En-têtes de signature PayPal manquants.",
          });
        });
        return res
          .status(400)
          .json({ error: "En-têtes de signature PayPal manquants." });
      }

      const webhookCreds = await repository.transaction(async (state) => {
        const secrets = resolvePlatformBillingConfig(state).paypalSecrets;
        return {
          env: secrets.env,
          clientId: secrets.clientId,
          clientSecret: secrets.clientSecret,
          webhookId: secrets.webhookId,
        };
      });

      if (
        !webhookCreds.clientId ||
        !webhookCreds.clientSecret ||
        !webhookCreds.webhookId
      ) {
        return res
          .status(503)
          .json({ error: "Webhook PayPal non configuré sur ce serveur." });
      }

      const verified = await verifyPayPalWebhookSignature(
        {
          env: webhookCreds.env,
          clientId: webhookCreds.clientId,
          clientSecret: webhookCreds.clientSecret,
        },
        {
          authAlgo,
          certUrl,
          transmissionId,
          transmissionSig,
          transmissionTime,
          webhookId: webhookCreds.webhookId,
          webhookEvent: req.body,
        },
      );
      if (!verified) {
        await repository.transaction(async (state) => {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType: String(req.body?.event_type || "WEBHOOK"),
            status: "rejected",
            httpStatus: 401,
            message: "Signature webhook PayPal invalide.",
          });
        });
        return res
          .status(401)
          .json({ error: "Signature webhook PayPal invalide." });
      }

      const eventType = String(req.body?.event_type || "");
      const resource = (req.body?.resource || {}) as Record<string, any>;

      if (
        eventType === "PAYMENT.CAPTURE.REFUNDED" ||
        eventType === "PAYMENT.CAPTURE.REVERSED"
      ) {
        const refundId = String(resource.id || "").trim();
        const relatedOrderId = String(
          resource.supplementary_data?.related_ids?.order_id || "",
        ).trim();
        const captureLink = Array.isArray(resource.links)
          ? resource.links.find((l: any) => l?.rel === "up")?.href || ""
          : "";
        const linkedCaptureId =
          String(
            resource.supplementary_data?.related_ids?.capture_id || "",
          ).trim() ||
          (/\/captures\/([^/?]+)/.exec(String(captureLink))?.[1] || "").trim() ||
          (eventType === "PAYMENT.CAPTURE.REVERSED" ? refundId : "");
        const customId = String(resource.custom_id || "").trim();

        const outcome = await repository.transaction(async (state) => {
          const payments =
            state.syndik_prod_subscription_payments_v1 || [];
          const intentPaymentId = customId
            ? state.__paypalIntents?.[customId]?.paymentId
            : undefined;
          const match = payments.find(
            (p: any) =>
              !p.voidedAt &&
              ((linkedCaptureId && p.externalCaptureId === linkedCaptureId) ||
                (relatedOrderId && p.externalOrderId === relatedOrderId) ||
                (intentPaymentId && p.id === intentPaymentId)),
          );
          if (!match) {
            recordGatewayEvent(state, {
              gateway: "paypal",
              eventType,
              status: "ignored",
              httpStatus: 200,
              orderId: relatedOrderId || undefined,
              reference: linkedCaptureId || refundId || undefined,
              message: "Paiement introuvable ou déjà annulé.",
            });
            return { ignored: true, reason: "payment_not_found_or_already_voided" };
          }
          const reason =
            eventType === "PAYMENT.CAPTURE.REFUNDED"
              ? `Remboursement PayPal (${refundId || linkedCaptureId || relatedOrderId})`
              : `Annulation / contestation PayPal (${refundId || linkedCaptureId || relatedOrderId})`;
          voidPlatformSubscriptionPayment(
            state,
            { uid: "paypal:webhook", role: "admin" },
            match.id,
            reason,
            "paypalWebhookRefundSubscription",
          );
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType,
            status: "ok",
            httpStatus: 200,
            syndicId: match.syndicId,
            orderId: relatedOrderId || undefined,
            reference: match.reference,
            message: reason,
          });
          return { ignored: false, voidedPaymentId: match.id };
        });
        return res.json({ ok: true, eventType, ...outcome });
      }

      if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
        return res.json({ ok: true, ignored: true, eventType });
      }
      const captureStatus = String(resource.status || "");
      const captureId = String(resource.id || "").trim();
      const relatedOrderId = String(
        resource.supplementary_data?.related_ids?.order_id || "",
      ).trim();
      const customId = String(resource.custom_id || "").trim();
      const currency = String(resource.amount?.currency_code || "").toUpperCase();
      const parsedAmount = Number(resource.amount?.value);
      const amountCents = Number.isFinite(parsedAmount)
        ? Math.round(parsedAmount * 100)
        : -1;

      if (captureStatus !== "COMPLETED" || (!customId && !relatedOrderId)) {
        return res.json({ ok: true, ignored: true });
      }

      const outcome = await repository.transaction(async (state) => {
        const intentKey =
          customId || (relatedOrderId && state.__paypalOrders?.[relatedOrderId]);
        const intent = intentKey
          ? state.__paypalIntents?.[intentKey]
          : undefined;
        if (!intent) {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType,
            status: "ignored",
            httpStatus: 200,
            orderId: relatedOrderId || undefined,
            reference: captureId || undefined,
            message: "Intent PayPal inconnu.",
          });
          return { ignored: true, reason: "unknown_intent" };
        }
        if (
          currency !== intent.paypalCurrency ||
          amountCents !== intent.paypalCents
        ) {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType,
            status: "rejected",
            httpStatus: 400,
            syndicId: intent.syndicId,
            orderId: relatedOrderId || undefined,
            reference: captureId || undefined,
            message: "Montant ou devise webhook PayPal incohérent.",
          });
          throw new OperationError(
            "Montant ou devise webhook PayPal incohérent.",
            400,
          );
        }
        const payment = activatePlatformSubscription(
          state,
          { uid: "paypal:webhook", role: "admin" },
          {
            syndicId: intent.syndicId,
            plan: intent.plan as SubscriptionPlan,
            months: Number(intent.months),
            reference: captureId || relatedOrderId || intent.intentId,
            amountMad: Number(intent.amountMad),
            method: intent.paymentSourceHint === "card" ? "card" : "paypal",
            currency: intent.paypalCurrency,
            chargedAmount: Number(intent.paypalCents) / 100,
            ...(intent.promoCode ? { promoCode: String(intent.promoCode) } : {}),
            externalOrderId: relatedOrderId || intent.orderId || captureId,
            ...(captureId ? { externalCaptureId: captureId } : {}),
            auditOperation: "paypalWebhookSubscription",
          },
        );
        intent.status = "completed";
        if (relatedOrderId) {
          intent.orderId = relatedOrderId;
          (state.__paypalOrders ??= {})[relatedOrderId] = intentKey;
        }
        intent.paymentId = payment.id;
        recordGatewayEvent(state, {
          gateway: "paypal",
          eventType,
          status: "ok",
          httpStatus: 200,
          syndicId: intent.syndicId,
          orderId: relatedOrderId || intent.orderId || undefined,
          reference: payment.reference,
          message: `Abonnement activé via webhook PayPal (${payment.invoiceNumber || payment.id}).`,
        });
        return { ignored: false, paymentId: payment.id };
      });

      return res.json({ ok: true, ...outcome });
    }, false),
  );

  // --- Moroccan CMI 3D-Secure Hosted Payment Page & Callback Engine ---
  const CreateCmiPaymentSchema = z.object({
    syndicId: z.string().min(1).max(200),
    plan: z.enum(["starter", "professional", "enterprise"]),
    months: z.number().int().min(1).max(12),
    lang: z.enum(["fr", "ar"]).optional(),
    promoCode: z.string().max(64).optional(),
  });

  app.post(
    "/api/subscription/cmi/create-payment",
    wrap(async (req, res) => {
      const body = CreateCmiPaymentSchema.parse(req.body);
      const prepared = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (!["admin", "syndic"].includes(caller.role))
          throw new OperationError("Opération réservée au syndic.", 403);
        assertOnboarded(caller, state);
        const s = (state.syndik_prod_syndics_v1 || []).find(
          (cab: any) => cab.id === body.syndicId,
        );
        if (
          !s ||
          (caller.role !== "admin" &&
            s.createdBy !== caller.uid &&
            caller.syndicId !== s.id)
        ) {
          throw new OperationError("Cabinet non autorisé.", 403);
        }
        if (s.archivedAt) {
          throw new OperationError(
            "Cabinet archivé : impossible de renouveler l'abonnement.",
            409,
          );
        }
        if (caller.role !== "admin" && s.subscriptionStatus === "cancelled") {
          throw new OperationError(
            "Votre compte est suspendu. Contactez l'administration.",
            403,
          );
        }
        const activeBuildings = (s.buildings || []).filter(
          (b: any) => !b.archivedAt,
        ).length;
        const planLimit = PLANS[body.plan].buildings;
        if (activeBuildings > planLimit) {
          throw new OperationError(
            `Impossible de passer au forfait ${body.plan} : ${activeBuildings} immeuble(s) actif(s) pour une limite de ${planLimit}.`,
            409,
          );
        }
        const billing = resolvePlatformBillingConfig(state);
        if (!billing.cmiSecrets.enabled) {
          throw new OperationError(
            "Le paiement par carte marocaine (CMI) n'est pas configuré.",
            400,
          );
        }
        const promo = body.promoCode?.trim()
          ? resolveAndValidatePromoCode(
              state,
              body.promoCode,
              body.plan as SubscriptionPlan,
              body.months,
            )
          : undefined;
        const pricing = computeSubscriptionPricing(
          billing.publicConfig,
          body.plan as SubscriptionPlan,
          body.months,
          promo,
        );

        const oid = `CMI-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        const intents = (state.__cmiIntents ??= {});
        const cutoff = Date.now() - 30 * 86_400_000;
        for (const [k, v] of Object.entries(intents) as [string, any][]) {
          if (v?.createdAt && Date.parse(v.createdAt) < cutoff) {
            delete intents[k];
          }
        }
        intents[oid] = {
          oid,
          syndicId: s.id,
          actorUid: caller.uid,
          plan: body.plan,
          months: body.months,
          amountMad: pricing.amountMad,
          amountMadCents: pricing.amountMadCents,
          currencyCode: billing.cmiSecrets.currencyCode,
          currencyLabel: billing.cmiSecrets.currencyLabel,
          ...(promo ? { promoCode: promo.code } : {}),
          status: "created",
          createdAt: new Date().toISOString(),
        };

        const origin = resolvePublicOrigin(req, billing.cmiSecrets.shopUrl);
        const checkout = buildCmiCheckoutPayload({
          env: billing.cmiSecrets.env,
          clientId: billing.cmiSecrets.clientId,
          storeKey: billing.cmiSecrets.storeKey,
          oid,
          amountValue: pricing.cmiAmountString,
          currencyCode: billing.cmiSecrets.currencyCode,
          lang: body.lang || billing.cmiSecrets.lang,
          okUrl: `${origin}/api/subscription/cmi/return?status=ok&oid=${encodeURIComponent(oid)}`,
          failUrl: `${origin}/api/subscription/cmi/return?status=fail&oid=${encodeURIComponent(oid)}`,
          shopUrl: billing.cmiSecrets.shopUrl || `${origin}/`,
          callbackUrl: `${origin}/api/webhooks/cmi`,
          billToName: String(s.name || "Cabinet Syndic"),
          email: String(s.email || caller.email || ""),
          tel: String(s.phone || ""),
          description: `Abonnement ${body.plan} (${body.months} mois)`,
        });

        recordGatewayEvent(state, {
          gateway: "cmi",
          eventType: "CMI_CHECKOUT_INITIATED",
          status: "ok",
          httpStatus: 200,
          syndicId: s.id,
          orderId: oid,
          message: `Session CMI initialisée (${pricing.amountMad} MAD · ${body.plan} × ${body.months}m).`,
        });

        return {
          oid,
          amountMad: pricing.amountMad,
          currency: billing.cmiSecrets.currencyLabel,
          gatewayUrl: checkout.gatewayUrl,
          fields: checkout.fields,
        };
      });

      return res.json({ ok: true, ...prepared });
    }, false),
  );

  // CMI redirects the user's browser via HTTP POST to okUrl / failUrl; convert safely to 303 SPA redirect.
  const handleCmiBrowserReturn = (req: express.Request, res: express.Response) => {
    const rawStatus = String(
      req.query.status || req.body?.Response || "",
    ).toLowerCase();
    const status = rawStatus === "ok" || rawStatus === "approved" ? "ok" : "fail";
    const oid = String(req.query.oid || req.body?.oid || "")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 64);
    const params = new URLSearchParams({ cmi_return: status });
    if (oid) params.set("oid", oid);
    return res.redirect(303, `/?${params.toString()}`);
  };
  app.post(
    "/api/subscription/cmi/return",
    express.urlencoded({ extended: false }),
    handleCmiBrowserReturn,
  );
  app.get("/api/subscription/cmi/return", handleCmiBrowserReturn);

  // Official CMI Server-to-Server Callback (expects plain-text ACTION=POSTAUTH / APPROVED / FAILURE)
  app.post(
    "/api/webhooks/cmi",
    express.urlencoded({ extended: false }),
    wrap(async (req, res) => {
      const payload = (req.body && typeof req.body === "object"
        ? req.body
        : {}) as Record<string, unknown>;
      const oid = String(payload.oid || "").trim();
      const procReturnCode = String(payload.ProcReturnCode || "").trim();
      const responseLabel = String(payload.Response || "").trim();
      const transId = String(
        payload.TransId || payload.AuthCode || payload.transid || "",
      ).trim();
      const callbackAmount = Number(payload.amount);
      const callbackAmountCents = Number.isFinite(callbackAmount)
        ? Math.round(callbackAmount * 100)
        : -1;
      const callbackCurrency = String(payload.currency || "").trim();

      const replyPlain = (code: number, token: "ACTION=POSTAUTH" | "APPROVED" | "FAILURE") => {
        res.status(code).type("text/plain").send(token);
      };

      const outcome = await repository.transaction(async (state) => {
        const cmiSecrets = resolvePlatformBillingConfig(state).cmiSecrets;
        if (!cmiSecrets.storeKey || !cmiSecrets.clientId) {
          recordGatewayEvent(state, {
            gateway: "cmi",
            eventType: "CMI_CALLBACK",
            status: "error",
            httpStatus: 503,
            orderId: oid || undefined,
            message: "Passerelle CMI non configurée sur ce serveur.",
          });
          return { code: 503, token: "FAILURE" as const };
        }

        if (!verifyCmiCallbackHash(payload, cmiSecrets.storeKey)) {
          recordGatewayEvent(state, {
            gateway: "cmi",
            eventType: "CMI_CALLBACK_INVALID_HASH",
            status: "rejected",
            httpStatus: 200,
            orderId: oid || undefined,
            reference: transId || undefined,
            message: "Signature SHA-512 CMI (HASH) invalide — transaction rejetée.",
          });
          return { code: 200, token: "FAILURE" as const };
        }

        const intent = oid ? state.__cmiIntents?.[oid] : undefined;
        if (!intent) {
          recordGatewayEvent(state, {
            gateway: "cmi",
            eventType: "CMI_CALLBACK_UNKNOWN_OID",
            status: "rejected",
            httpStatus: 200,
            orderId: oid || undefined,
            message: "Commande CMI (oid) introuvable.",
          });
          return { code: 200, token: "FAILURE" as const };
        }

        if (procReturnCode !== "00") {
          intent.status = "failed";
          intent.lastProcReturnCode = procReturnCode;
          recordGatewayEvent(state, {
            gateway: "cmi",
            eventType: "CMI_PAYMENT_DECLINED",
            status: "ignored",
            httpStatus: 200,
            syndicId: intent.syndicId,
            orderId: oid,
            reference: transId || undefined,
            message: `Paiement CMI refusé (ProcReturnCode=${procReturnCode || "?"}, Response=${responseLabel || "?"}).`,
          });
          return { code: 200, token: "APPROVED" as const };
        }

        if (
          callbackAmountCents !== Number(intent.amountMadCents) ||
          (callbackCurrency && callbackCurrency !== String(intent.currencyCode))
        ) {
          recordGatewayEvent(state, {
            gateway: "cmi",
            eventType: "CMI_AMOUNT_MISMATCH",
            status: "rejected",
            httpStatus: 200,
            syndicId: intent.syndicId,
            orderId: oid,
            reference: transId || undefined,
            message: `Montant ou devise CMI incohérent (reçu ${callbackAmount} / ${callbackCurrency}, attendu ${intent.amountMad} / ${intent.currencyCode}).`,
          });
          return { code: 200, token: "FAILURE" as const };
        }

        const payment = activatePlatformSubscription(
          state,
          { uid: "cmi:webhook", role: "admin" },
          {
            syndicId: intent.syndicId,
            plan: intent.plan as SubscriptionPlan,
            months: Number(intent.months),
            reference: transId || oid,
            amountMad: Number(intent.amountMad),
            method: "cmi",
            currency: (intent.currencyLabel || "MAD") as "MAD" | "EUR" | "USD",
            chargedAmount: Number(intent.amountMad),
            ...(intent.promoCode ? { promoCode: String(intent.promoCode) } : {}),
            externalOrderId: oid,
            ...(transId ? { externalCaptureId: transId } : {}),
            auditOperation: "cmiWebhookSubscription",
          },
        );

        intent.status = "completed";
        intent.paymentId = payment.id;
        intent.transId = transId || undefined;
        recordGatewayEvent(state, {
          gateway: "cmi",
          eventType: "CMI_PAYMENT_POSTAUTH",
          status: "ok",
          httpStatus: 200,
          syndicId: intent.syndicId,
          orderId: oid,
          reference: payment.reference,
          message: `Paiement CMI validé (ACTION=POSTAUTH) — ${payment.amount} MAD (${payment.invoiceNumber || payment.id}).`,
        });
        return { code: 200, token: "ACTION=POSTAUTH" as const };
      });

      return replyPlain(outcome.code, outcome.token);
    }, false),
  );

  // --- Admin Promo Code CRUD ---
  const PromoCreateSchema = z.object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/),
    discountType: z.enum(["percent", "fixed_mad"]),
    discountValue: z.number().positive().max(100_000),
    active: z.boolean().optional(),
    applicablePlans: z
      .array(z.enum(["starter", "professional", "enterprise"]))
      .optional(),
    minMonths: z.number().int().min(1).max(12).optional(),
    maxUses: z.number().int().min(1).max(100_000).optional(),
    validUntil: z.string().max(40).optional(),
    description: z.string().max(240).optional(),
  });

  api.get("/api/admin/promos", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const promos: SubscriptionPromoCode[] = sharedStore.__subscriptionPromos || [];
    return res.json({ ok: true, promos: [...promos].reverse() });
  });

  api.post("/api/admin/promos", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const parsed = PromoCreateSchema.parse(req.body);
    if (parsed.discountType === "percent" && parsed.discountValue > 95) {
      throw new OperationError("La remise en pourcentage ne peut dépasser 95%.", 400);
    }
    const normalizedCode = parsed.code.trim().toUpperCase();
    const promos: SubscriptionPromoCode[] = (sharedStore.__subscriptionPromos ??= []);
    if (promos.some((p) => p.code.toUpperCase() === normalizedCode)) {
      throw new OperationError("Ce code promotionnel existe déjà.", 409);
    }
    const promo: SubscriptionPromoCode = {
      id: crypto.randomUUID(),
      code: normalizedCode,
      discountType: parsed.discountType,
      discountValue: Number(parsed.discountValue.toFixed(2)),
      active: parsed.active ?? true,
      ...(parsed.applicablePlans?.length
        ? { applicablePlans: parsed.applicablePlans }
        : {}),
      ...(parsed.minMonths ? { minMonths: parsed.minMonths } : {}),
      ...(parsed.maxUses ? { maxUses: parsed.maxUses } : {}),
      usedCount: 0,
      ...(parsed.validUntil?.trim() ? { validUntil: parsed.validUntil.trim() } : {}),
      ...(parsed.description?.trim()
        ? { description: parsed.description.trim() }
        : {}),
      createdAt: new Date().toISOString(),
      createdBy: caller.uid,
    };
    promos.push(promo);
    appendAudit(sharedStore, caller, "adminCreatePromoCode", undefined, {
      promoId: promo.id,
      code: promo.code,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
    });
    return res.json({ ok: true, promo });
  });

  app.patch(
    "/api/admin/promos/:id",
    wrap(async (req, res) => {
      const caller = await extractAndVerifyCaller(req, sharedStore);
      if (!caller)
        return res.status(401).json({ error: "Authentification requise." });
      if (caller.role !== "admin")
        return res.status(403).json({ error: "Administration uniquement." });
      assertOnboarded(caller, sharedStore);
      const promos: SubscriptionPromoCode[] = sharedStore.__subscriptionPromos || [];
      const promo = promos.find((p) => p.id === req.params.id);
      if (!promo) throw new OperationError("Code promo introuvable.", 404);
      if (typeof req.body?.active === "boolean") {
        promo.active = req.body.active;
      }
      if (typeof req.body?.description === "string") {
        promo.description = req.body.description.trim().slice(0, 240);
      }
      if (typeof req.body?.validUntil === "string") {
        const trimmed = req.body.validUntil.trim();
        if (trimmed) promo.validUntil = trimmed;
        else delete promo.validUntil;
      }
      if (req.body?.maxUses !== undefined) {
        const n = Number(req.body.maxUses);
        if (Number.isInteger(n) && n >= 1) promo.maxUses = n;
        else if (req.body.maxUses === null || req.body.maxUses === "") delete promo.maxUses;
      }
      appendAudit(sharedStore, caller, "adminUpdatePromoCode", undefined, {
        promoId: promo.id,
        code: promo.code,
        active: promo.active,
      });
      return res.json({ ok: true, promo });
    }, true),
  );

  app.delete(
    "/api/admin/promos/:id",
    wrap(async (req, res) => {
      const caller = await extractAndVerifyCaller(req, sharedStore);
      if (!caller)
        return res.status(401).json({ error: "Authentification requise." });
      if (caller.role !== "admin")
        return res.status(403).json({ error: "Administration uniquement." });
      assertOnboarded(caller, sharedStore);
      const promos: SubscriptionPromoCode[] = sharedStore.__subscriptionPromos || [];
      const idx = promos.findIndex((p) => p.id === req.params.id);
      if (idx < 0) throw new OperationError("Code promo introuvable.", 404);
      const [removed] = promos.splice(idx, 1);
      appendAudit(sharedStore, caller, "adminDeletePromoCode", undefined, {
        promoId: removed.id,
        code: removed.code,
      });
      return res.json({ ok: true });
    }, true),
  );

  // --- Admin Audit Trail & Gateway Webhook Monitor ---
  api.get("/api/admin/audit-logs", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const operation = String(req.query.operation || "").trim().toLowerCase();
    const search = String(req.query.q || "").trim().toLowerCase();
    const all = [...(sharedStore.syndik_prod_audit_v1 || [])].reverse();
    const filtered = all
      .filter((entry: any) => {
        if (operation && String(entry.operation || "").toLowerCase() !== operation) {
          return false;
        }
        if (!search) return true;
        return JSON.stringify(entry).toLowerCase().includes(search);
      })
      .slice(0, limit);
    return res.json({ ok: true, logs: filtered, total: all.length });
  });

  api.get("/api/admin/gateway-events", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const gateway = String(req.query.gateway || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase();
    const all = [...(sharedStore.__gatewayEvents || [])].reverse();
    const filtered = all
      .filter((ev: any) => {
        if (gateway && String(ev.gateway || "").toLowerCase() !== gateway) return false;
        if (status && String(ev.status || "").toLowerCase() !== status) return false;
        return true;
      })
      .slice(0, limit);
    return res.json({ ok: true, events: filtered, total: all.length });
  });

  // --- Admin Renewal Dunning Reminder (with 24h anti-spam cooldown) ---
  app.post(
    "/api/admin/cabinets/:id/send-reminder",
    wrap(async (req, res) => {
      const dispatched = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (caller.role !== "admin")
          throw new OperationError("Administration uniquement.", 403);
        assertOnboarded(caller, state);
        const syndic = (state.syndik_prod_syndics_v1 || []).find(
          (s: any) => s.id === req.params.id,
        );
        if (!syndic) throw new OperationError("Cabinet introuvable.", 404);
        if (syndic.archivedAt)
          throw new OperationError("Cabinet archivé.", 409);
        const targetEmail = String(syndic.email || "").trim();
        if (!targetEmail || !/^\S+@\S+\.\S+$/.test(targetEmail)) {
          throw new OperationError(
            "Ce cabinet ne dispose pas d'une adresse email valide.",
            400,
          );
        }
        const sentMap = (state.__renewalRemindersSent ??= {});
        const lastSentIso = sentMap[syndic.id];
        const cooldownMs = 24 * 3600 * 1000;
        if (lastSentIso && Date.now() - Date.parse(lastSentIso) < cooldownMs) {
          throw new OperationError(
            "Un rappel a déjà été envoyé à ce cabinet au cours des dernières 24 heures.",
            429,
          );
        }
        const billing = resolvePlatformBillingConfig(state).publicConfig;
        const expiryFormatted = syndic.subscriptionExpiry
          ? new Date(syndic.subscriptionExpiry).toLocaleDateString("fr-MA")
          : "—";
        const planPrice =
          PLANS[syndic.subscriptionPlan as SubscriptionPlan]?.price ?? 390;
        const subject = `Rappel de renouvellement — Abonnement ${billing.issuerProfile?.companyName || "Syndik"} (${syndic.name})`;
        const bodyLines = [
          `Bonjour ${syndic.name},`,
          "",
          `Votre abonnement (${syndic.subscriptionPlan} — ${planPrice} MAD/mois) arrive à échéance le ${expiryFormatted}.`,
          "Connectez-vous à votre espace Syndic pour renouveler votre abonnement (Carte CMI Maroc, PayPal, Virement RIB ou Espèces / Agence).",
          ...(billing.issuerProfile?.phone
            ? [`Support : ${billing.issuerProfile.phone}`]
            : []),
          "",
          `Cordialement,`,
          billing.issuerProfile?.companyName || "Équipe Syndik",
        ];
        const mailReady = mailIsConfigured();
        if (mailReady) {
          queueMail(state, targetEmail, subject, bodyLines.join("\n"));
        }
        const nowIso = new Date().toISOString();
        const notifs = (state.syndik_prod_notifications_v1 ??= []);
        const targetUsers = (state.syndik_prod_registered_users_v1 || []).filter(
          (u: any) =>
            !u.disabled &&
            u.profile?.role === "syndic" &&
            (u.uid === syndic.createdBy || u.profile?.syndicId === syndic.id),
        );
        const notifiedUids = new Set<string>(
          targetUsers.map((u: any) => String(u.uid)),
        );
        if (syndic.createdBy) notifiedUids.add(String(syndic.createdBy));
        for (const uid of notifiedUids) {
          const reminderTitle = "Rappel de renouvellement d'abonnement";
          const reminderBody = `Votre abonnement (${syndic.subscriptionPlan}) arrive à échéance le ${expiryFormatted}.`;
          notifs.push({
            id: crypto.randomUUID(),
            userId: uid,
            title: reminderTitle,
            message: `${reminderBody} Renouvelez par CMI, PayPal, Virement ou Espèces.`,
            type: "warning",
            read: false,
            link: "/settings",
            createdAt: nowIso,
          });
          queuePushNotification(state, {
            uid,
            title: reminderTitle,
            body: reminderBody,
            type: "warning",
            link: "/settings",
          });
        }
        sentMap[syndic.id] = nowIso;
        appendAudit(state, caller, "adminSendRenewalReminder", undefined, {
          syndicId: syndic.id,
          email: targetEmail,
          emailQueued: mailReady,
          inAppRecipients: notifiedUids.size,
          subscriptionExpiry: syndic.subscriptionExpiry,
        });
        return {
          email: targetEmail,
          sentAt: nowIso,
          emailQueued: mailReady,
          inAppRecipients: notifiedUids.size,
        };
      });
      if (dispatched.emailQueued) {
        await deliverOutbox(repository, 5).catch(() => {});
      }
      void deliverPushOutbox(repository, 5).catch(() => {});
      return res.json({
        ok: true,
        email: dispatched.email,
        sentAt: dispatched.sentAt,
        emailQueued: dispatched.emailQueued,
        inAppRecipients: dispatched.inAppRecipients,
        message: dispatched.emailQueued
          ? `Rappel envoyé par email (${dispatched.email}) et notification portail.`
          : `Notification de renouvellement envoyée dans le portail du cabinet (SMTP/SendGrid non configuré).`,
      });
    }, false),
  );

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
    assertOnboarded(caller, sharedStore);
    return res.json(
      buildingReport(sharedStore, caller, String(req.query.buildingId || "")),
    );
  });
  api.get("/api/archives", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller || !["admin", "syndic"].includes(caller.role))
      return res.status(403).json({ error: "Accès refusé." });
    assertOnboarded(caller, sharedStore);
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
    assertOnboarded(caller, sharedStore);
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
    assertOnboarded(caller, sharedStore);
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
      assertOnboarded(caller, state);
      const b = authorizeBillingBuilding(state, caller, syndicId, buildingId);
      b.syndicId = syndicId;
      canWrite(caller, b);
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
    const todayCasablanca = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Casablanca",
    }).format(new Date());
    let updatedInvoices = 0;
    let updatedCharges = 0;
    for (const i of sharedStore.syndik_prod_invoices_v1 || []) {
      const due = typeof i.dueDate === "string" ? i.dueDate.slice(0, 10) : "";
      if (
        i.status !== "paid" &&
        i.status !== "cancelled" &&
        /^\d{4}-\d{2}-\d{2}$/.test(due) &&
        due < todayCasablanca
      ) {
        if (i.status !== "overdue") updatedInvoices++;
        i.status = "overdue";
      }
    }
    for (const c of sharedStore.syndik_prod_charges_v1 || []) {
      const due = typeof c.dueDate === "string" ? c.dueDate.slice(0, 10) : "";
      const remainingCents =
        Math.round((Number(c.amount) || 0) * 100) -
        Math.round((Number(c.paidAmount) || 0) * 100);
      if (
        c.status !== "paid" &&
        remainingCents > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(due) &&
        due < todayCasablanca
      ) {
        if (c.status !== "overdue") updatedCharges++;
        c.status = "overdue";
      }
    }
    return res.json({ ok: true, updatedInvoices, updatedCharges });
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
    const guidesPath = path.join(distPath, "guides", "screenshots") + path.sep;
    const iconsPath = path.join(distPath, "icons") + path.sep;
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
          else if (filePath.startsWith(guidesPath))
            res.setHeader("Cache-Control", "public, max-age=86400");
          else if (filePath.startsWith(iconsPath))
            res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
          else if (filePath.endsWith(".webmanifest")) {
            res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache");
          } else if (path.basename(filePath) === "sw.js") {
            res.setHeader("Cache-Control", "no-cache");
          } else if (filePath.endsWith(".html")) shellHeaders(res);
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
      if (
        req.path.startsWith("/assets/") ||
        req.path.startsWith("/guides/screenshots/") ||
        req.path.startsWith("/icons/")
      )
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
  if (!(error instanceof ProductionConfigError)) {
    console.error(error instanceof Error ? error.message : "Server startup failed");
  }
  process.exitCode = 1;
});



