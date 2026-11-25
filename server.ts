import express from 'express';
import { projectAssemblyForRole } from './server/assemblyPrivacy';
import { DependencyError } from './server/dependencyErrors';
import { registerIdentityRoutes } from './server/identity';
import {
  assertIdentityReady,
  identityMutationActor,
  identityRequestFingerprint,
  identityTransaction,
} from './server/identityMutations';
import { LifecycleError } from './server/lifecycle';
import { deliverOutbox } from './server/mailer';
import { OperationError } from './server/operations';
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
  registerCommandRoutes,
  registerPlatformReadRoutes,
  registerSharedStateGuardRoutes,
  registerStateAndVoteRoutes,
} from './server/routes/commands';
import { registerJobsRoutes } from './server/routes/jobs';
import {
  registerCmiSubscriptionRoutes,
  registerSubscriptionRoutes,
} from './server/routes/subscription';
import type {
  AuthCallerContext,
  AuthorizedScope,
  ServerStore,
} from './server/routes/types';
import { registerStaticRoutes } from './server/routes/static';
import { registerUploadsRoutes } from './server/routes/uploads';
import {
  registerCmiWebhookRoutes,
  registerPayPalWebhookRoutes,
} from './server/routes/webhooks';
import {
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
import {
  createRepository,
  currentState,
  sharedState,
} from './server/repository';
import { firebaseLinkedResidentIds } from './server/residentIdentity';

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
} from './server/firebaseIdentity';
import type {
  AssembleeGenerale,
  GatewayEventRecord,
} from './types';
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

  registerStateAndVoteRoutes(app, {
    api,
    sharedStore,
    extractAndVerifyCaller,
    assertOnboarded,
    getAuthorizedScopeForCaller,
    filterStoreForCaller,
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

  registerCommandRoutes(app, {
    api,
    sharedStore,
    extractAndVerifyCaller,
    filterStoreForCaller,
  });
  registerAuthSessionRoutes(app, {
    api,
    sharedStore,
    extractAndVerifyCaller,
    issueServerSessionToken,
  });
  registerPlatformReadRoutes(app, {
    api,
    wrap,
    repository,
    sharedStore,
    extractAndVerifyCaller,
    assertOnboarded,
    getAuthorizedScopeForCaller,
    hasConfiguredSessionSecret: HAS_CONFIGURED_SESSION_SECRET,
    firebaseApiKey: firebaseConfig.apiKey,
  });
  registerJobsRoutes(app, {
    api,
    wrap,
    repository,
    sharedStore,
    scheduler,
    extractAndVerifyCaller,
    assertOnboarded,
    finalizeIdentityResponse,
    uploadsDir: UPLOADS_DIR,
  });

  registerSharedStateGuardRoutes(app, {});

  await registerStaticRoutes(app, {});

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



