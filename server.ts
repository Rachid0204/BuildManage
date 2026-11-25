import express from 'express';
import { z } from 'zod';
import { projectAssemblyForRole } from './server/assemblyPrivacy';
import { DependencyError } from './server/dependencyErrors';
import {
  CommandEnvelopeSchema,
  CommandIdentitySchema,
} from './server/domain/commandContracts';
import { registerIdentityRoutes } from './server/identity';
import {
  assertIdentityReady,
  identityMutationActor,
  identityRequestFingerprint,
  identityTransaction,
  pendingIdentityPlanId,
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
  appendAudit,
  authorizeBillingBuilding,
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
import { verifyPassword } from './server/passwords';
import { ProductionConfigError, validateProductionEnvironment } from './server/productionConfig';
import { createApiCorsMiddleware } from './server/corsPolicy';
import { deliverPushOutbox } from './server/pushNotifications';
import { registerLiveUpdates } from './server/realtime';
import {
  createAdmissionStore,
  registrationAdmission,
} from './server/registrationAdmission';
import {
  EphemeralGatewayEventBuffer,
  bodyParserErrorHandler,
  createLoginAttemptGuard,
  createUnauthenticatedIpRateLimiter,
} from './server/requestGuard';
import { registerAdminRoutes } from './server/routes/admin';
import {
  registerAuthRoutes,
  registerAuthSessionRoutes,
} from './server/routes/auth';
import {
  registerCmiSubscriptionRoutes,
  registerSubscriptionRoutes,
} from './server/routes/subscription';
import type {
  AuthCallerContext,
  AuthorizedScope,
  ServerStore,
} from './server/routes/types';
import { registerUploadsRoutes } from './server/routes/uploads';
import {
  registerCmiWebhookRoutes,
  registerPayPalWebhookRoutes,
} from './server/routes/webhooks';
import {
  applyHtmlShellHeaders,
  createCspReportHandler,
  createSecurityHeadersMiddleware,
} from './server/securityHeaders';
import {
  canonicalAuthFingerprintInput,
  clearSessionCookie,
  createSessionCsrfMiddleware,
  extractRequestCredential,
  setSessionCookie,
  shouldOmitJsonSessionToken,
  verifyCookieCsrf,
} from './server/sessionTransport';
import { buildingReport } from './server/reports';
import {
  createRepository,
  currentState,
  sharedState,
} from './server/repository';
import { firebaseLinkedResidentIds } from './server/residentIdentity';
import { lifecycleStorage } from './server/uploads';

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import firebaseConfig from './firebase-applet-config.json';
import {
  accountUid,
  executeFirebaseMutation,
  firebaseAdminAuth,
  firebaseSessionUser,
  identityAccounts,
  planFirebasePassword,
  usesFirebaseAuth,
} from './server/firebaseIdentity';
import type {
  AssembleeGenerale,
  Building,
  GatewayEventRecord,
} from './types';
import { applyResidentVote } from './utils/agVoting';
import { getBuildingReserveRate } from './utils/security';


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
  const credential = extractRequestCredential(req);
  if (!credential || !credential.token) return null;
  if (credential.source === "cookie" && !verifyCookieCsrf(req).ok) {
    return null;
  }
  const token = credential.token;
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

  process.env.SYNDIK_SERVER_SECRET ||= LEGACY_SERVER_SECRET;
  if (process.env.SYNDIK_SERVER_SECRET.length < 32) {
    process.env.SYNDIK_SERVER_SECRET = LEGACY_SERVER_SECRET;
  }
  process.env.SYNDIK_UPLOAD_BUCKET ||=
    firebaseConfig.storageBucket || "immogest-7faaf.firebasestorage.app";
  process.env.PUBLIC_APP_URL ||= "https://immogest.cloud.run";
  process.env.FIRESTORE_DATABASE_ID ||=
    firebaseConfig.firestoreDatabaseId || "(default)";

  const hasValidCallerCredential = async (req: express.Request): Promise<boolean> => {
    const credential = extractRequestCredential(req);
    if (!credential || !credential.token) return false;
    if (credential.source === "cookie" && !verifyCookieCsrf(req).ok) {
      return false;
    }
    const token = credential.token;
    if (token.startsWith("syndik-srv1.")) {
      return Boolean(verifyServerSessionToken(token));
    }
    return Boolean(await verifiedFirebaseIdentity(token));
  };

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

  app.use(createSecurityHeadersMiddleware());
  app.use("/api", createApiCorsMiddleware());
  // Rate-limit unauthenticated routes and verify cookie CSRF BEFORE body parsing and BEFORE any repository transaction.
  app.use("/api", createUnauthenticatedIpRateLimiter());
  app.use("/api", createSessionCsrfMiddleware());

  const jsonDefaultParser = express.json({ limit: "100kb" });
  const jsonCommandParser = express.json({ limit: "1mb" });
  const jsonUploadParser = express.json({ limit: "8mb" });
  const jsonCspReportParser = express.json({
    limit: "8kb",
    type: ["application/json", "application/csp-report", "application/reports+json"],
  });
  const urlencodedCmiParser = express.urlencoded({ extended: false, limit: "32kb" });

  app.use("/api", async (req, res, next) => {
    const fullPath = `/api${req.path}`.replace(/\/+$/, "");
    if (
      req.method === "POST" &&
      (fullPath === "/api/uploads" || fullPath === "/api/subscription/upload-proof")
    ) {
      if (!(await hasValidCallerCredential(req))) {
        return void res.status(401).json({ ok: false, error: "Authentification requise." });
      }
      return jsonUploadParser(req, res, next);
    }
    if (req.method === "POST" && fullPath === "/api/commands") {
      if (!(await hasValidCallerCredential(req))) {
        return void res.status(401).json({ ok: false, error: "Authentification requise." });
      }
      return jsonCommandParser(req, res, next);
    }
    if (req.method === "POST" && fullPath === "/api/csp-report") {
      return jsonCspReportParser(req, res, next);
    }
    if (
      req.method === "POST" &&
      (fullPath === "/api/webhooks/cmi" || fullPath === "/api/subscription/cmi/return")
    ) {
      return urlencodedCmiParser(req, res, next);
    }
    return jsonDefaultParser(req, res, next);
  });
  app.use("/api", bodyParserErrorHandler);

  // Stateless CSP violation collector: logs one JSON line and never touches repository or admission stores.
  app.post("/api/csp-report", createCspReportHandler());

  const repository = createRepository(),
    sharedStore: ServerStore = sharedState,
    loginGuard = createLoginAttemptGuard(),
    ephemeralGatewayEvents = new EphemeralGatewayEventBuffer<GatewayEventRecord>(100);
  let readyCache: { revision: number; expiresAt: number } | undefined;
  // Must precede every wrapped identity route and all platform transactions.
  app.use(registrationAdmission(createAdmissionStore(), req => {
    const credential = extractRequestCredential(req);
    if (!credential || !credential.token) return undefined;
    if (credential.source === 'cookie' && !verifyCookieCsrf(req).ok) return undefined;
    const caller = verifyServerSessionToken(credential.token);
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
  const PUBLIC_WRAPPED_PATHS = new Set([
    "/api/ready",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/firebase-session",
    "/api/auth/recovery/request",
    "/api/auth/recovery/complete",
    "/api/webhooks/paypal",
    "/api/webhooks/cmi",
  ]);
  const wrap =
    (handler: express.RequestHandler, transactional = true) => async (req: express.Request, res: express.Response) => {
      const requestId = crypto.randomUUID();
      res.setHeader('X-Request-ID', requestId);
      if (req.path.startsWith("/api/jobs/")) {
        if (!scheduler(req)) {
          return void res.status(403).json({ error: "Ordonnanceur non autorisé." });
        }
      } else if (!PUBLIC_WRAPPED_PATHS.has(req.path)) {
        if (!(await hasValidCallerCredential(req))) {
          if (req.path === "/api/auth/logout") {
            clearSessionCookie(res);
            return void res.json({ ok: true });
          }
          if (req.path === "/api/archives") {
            return void res.status(403).json({ error: "Accès refusé." });
          }
          if (req.path === "/api/diagnostics") {
            return void res.status(403).json({ error: "Accès réservé au gestionnaire." });
          }
          return void res.status(401).json({ ok: false, error: "Authentification requise." });
        }
      }
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
          if (res.statusCode >= 400)
            throw Object.assign(new Error(payload?.error || "Rejected"), {
              rejected: true,
            });
        };
        if (transactional && ['/api/auth/register', '/api/auth/login', '/api/auth/change-password',
            '/api/auth/recovery/request', '/api/auth/logout', '/api/commands'].includes(req.path)) {
          const response = await identityTransaction(repository,
            identityRequestFingerprint(req.path, canonicalAuthFingerprintInput(req), req.body),
            async state => { await handle(state); return { payload, status: res.statusCode, format }; },
            executeFirebaseMutation, finalizeIdentityResponse, async (state, intent) => {
              if (['/api/auth/register', '/api/auth/login', '/api/auth/recovery/request'].includes(req.path)) return;
              const extracted = extractRequestCredential(req);
              if (extracted?.source === 'cookie' && !verifyCookieCsrf(req).ok) {
                throw new OperationError('Requête cross-site refusée.', 403, 'CSRF_REJECTED');
              }
              const token = extracted?.token || '';
              let uid: string | undefined;
              if (token.startsWith('syndik-srv1.')) uid = verifyServerSessionToken(token)?.uid;
              else if (token) {
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
        if (payload?.token) {
          setSessionCookie(res, payload.token);
          if (shouldOmitJsonSessionToken(req)) {
            const { token: _omitted, ...rest } = payload;
            payload = rest;
          }
        }
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
    post: (
      route: string,
      handler: (req: express.Request, res: express.Response) => unknown,
      preflight?: express.RequestHandler,
    ) => (preflight ? app.post(route, preflight, wrap(handler)) : app.post(route, wrap(handler))),
  };
  registerIdentityRoutes(api, extractAndVerifyCaller, loginGuard);
  registerLiveUpdates(
    app,
    repository,
    async (req, state) => {
      const caller = await extractAndVerifyCaller(req, state);
      if (caller) assertOnboarded(caller, state);
      return caller;
    },
    hasValidCallerCredential,
  );
  app.use("/api", (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  // API Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", revision: process.env.K_REVISION || 'local', timestamp: new Date().toISOString() });
  });

  registerAuthRoutes(app, {
    api,
    repository,
    sharedStore,
    loginGuard,
    hasValidCallerCredential,
    extractAndVerifyCaller,
    verifiedFirebaseIdentity,
    lookupCandidateProfilesInStore,
    invitationExpired,
    issueServerSessionToken,
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

  registerUploadsRoutes(app, {
    wrap,
    repository,
    extractAndVerifyCaller,
    assertOnboarded,
    uploadsDir: UPLOADS_DIR,
  });

  registerSubscriptionRoutes(app, {
    api,
    wrap,
    repository,
    sharedStore,
    extractAndVerifyCaller,
    assertOnboarded,
    filterStoreForCaller,
  });

  registerPayPalWebhookRoutes(app, {
    wrap,
    repository,
  });

  registerCmiSubscriptionRoutes(app, {
    wrap,
    repository,
    extractAndVerifyCaller,
    assertOnboarded,
  });

  registerCmiWebhookRoutes(app, {
    wrap,
    repository,
    ephemeralGatewayEvents,
  });

  registerAdminRoutes(app, {
    api,
    wrap,
    repository,
    sharedStore,
    extractAndVerifyCaller,
    assertOnboarded,
    ephemeralGatewayEvents,
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
  registerAuthSessionRoutes(app, {
    api,
    sharedStore,
    extractAndVerifyCaller,
    issueServerSessionToken,
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
  app.get(
    "/api/ready",
    wrap(async (_req, res) => {
      const now = Date.now();
      let revision: number;
      if (readyCache && readyCache.expiresAt > now) {
        revision = readyCache.revision;
      } else {
        revision = repository.readRevision
          ? await repository.readRevision()
          : await repository.transaction(async (s) => Number(s.__revision) || 0);
        readyCache = { revision, expiresAt: now + 2000 };
      }
      return res.json({
        status: "ready",
        revision,
        runtimeRevision: process.env.K_REVISION || "local",
        checks: { databaseRead: "ok", storageWrite: "not_checked" },
      });
    }, false),
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

  app.post("/api/shared-state", (_req, res) =>
    res.status(403).json({
      error:
        "Les écritures globales sont désactivées. Utilisez les opérations serveur.",
    }),
  );
  app.post("/api/shared-state/reset", (_req, res) =>
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
    const distPath =
      process.env.NODE_ENV !== "production" && process.env.SYNDIK_TEST_DIST_DIR
        ? path.resolve(process.env.SYNDIK_TEST_DIST_DIR)
        : path.join(process.cwd(), "dist");
    const assetsPath = path.join(distPath, "assets") + path.sep;
    const guidesPath = path.join(distPath, "guides", "screenshots") + path.sep;
    const iconsPath = path.join(distPath, "icons") + path.sep;
    // The HTML shell must be revalidated so a new release is picked up at once, and
    // it should not be framed by other origins. Vite content-hashes everything under
    // /assets, so those files never change in place and can be cached indefinitely.
    const shellHeaders = (res: express.Response) => {
      applyHtmlShellHeaders(res);
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



