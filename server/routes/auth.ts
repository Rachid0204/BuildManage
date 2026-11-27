import crypto from "crypto";
import type express from "express";
import {
  cancelAccountDeletionRequest,
  getActiveAccountDeletionRequest,
  submitAccountDeletionRequest,
} from "../accountDeletion";
import {
  accountUid,
  bindFirebaseAccount,
  firebaseAdminAuth,
  firebasePasswordLogin,
  identityAccounts,
  migrateLegacyLogin,
  planFirebasePassword,
  registerFirebaseAccount,
  sendFirebaseVerification,
  usesFirebaseAuth,
} from "../firebaseIdentity";
import { createIdentityAction } from "../identity";
import { resolveLegalFramework } from "../../shared/legalFramework";
import { assertIdentityReady, queueFirebaseMutation } from "../identityMutations";
import { deliverOutbox, mailIsConfigured } from "../mailer";
import { appendAudit } from "../operations";
import { hashPassword, verifyPassword } from "../passwords";
import {
  listUserDeviceTokens,
  registerDeviceToken,
  sanitizePushPlatform,
  sanitizePushToken,
  unregisterDeviceToken,
} from "../pushNotifications";
import type { StateRepository } from "../repository";
import { normalizedClientIp, type LoginAttemptGuard } from "../requestGuard";
import { clearSessionCookie } from "../sessionTransport";
import { isAlreadyHashedPassword } from "../../utils/security";
import type {
  ExtractAndVerifyCallerFn,
  HasValidCallerCredentialFn,
  ServerStore,
  WrappedApi,
} from "./types";

export interface AuthRoutesDeps {
  api: WrappedApi;
  repository: StateRepository;
  sharedStore: ServerStore;
  loginGuard: LoginAttemptGuard;
  hasValidCallerCredential: HasValidCallerCredentialFn;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  verifiedFirebaseIdentity: (token: string) => Promise<any>;
  lookupCandidateProfilesInStore: (
    store: ServerStore,
    uid: string,
  ) => Array<Record<string, any>>;
  invitationExpired: (
    store: ServerStore,
    identity: Record<string, any>,
  ) => boolean;
  issueServerSessionToken: (profile: Record<string, any>) => string;
}

export interface AuthSessionRoutesDeps {
  api: WrappedApi;
  sharedStore: ServerStore;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  issueServerSessionToken: (profile: Record<string, any>) => string;
}

export function registerAuthRoutes(app: express.Express, deps: AuthRoutesDeps) {
  const {
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
  } = deps;

  // Mobile Push Notification Device Token Registry (FCM / APNs)
  app.get("/api/devices/push-token", async (req, res) => {
    if (!(await hasValidCallerCredential(req))) {
      return res.status(401).json({ ok: false, error: "Authentification requise." });
    }
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
    if (!(await hasValidCallerCredential(req))) {
      return res.status(401).json({ ok: false, error: "Authentification requise." });
    }
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
    if (!(await hasValidCallerCredential(req))) {
      return res.status(401).json({ ok: false, error: "Authentification requise." });
    }
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

  // Account Deletion Requests (CNDP data privacy, Apple App Store Guideline 5.1.1(v), Google Play Data Safety)
  app.get("/api/account/deletion-request", async (req, res) => {
    if (!(await hasValidCallerCredential(req))) {
      return res.status(401).json({ ok: false, error: "Authentification requise." });
    }
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
    if (!(await hasValidCallerCredential(req))) {
      return res.status(401).json({ ok: false, error: "Authentification requise." });
    }
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
    if (!(await hasValidCallerCredential(req))) {
      return res.status(401).json({ ok: false, error: "Authentification requise." });
    }
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
  const loginPreflight: express.RequestHandler = async (req, res, next) => {
    const identifier = String(req.body?.identifier || req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");
    if (!identifier || identifier.length > 320 || !password || password.length > 200) {
      return void res.status(400).json({ error: "Identifiants invalides." });
    }
    const ip = normalizedClientIp(req);
    const decision = loginGuard.checkBeforeLogin(ip, identifier);
    if (!decision.allowed) {
      return void res
        .status(429)
        .set("Retry-After", String(decision.retryAfter))
        .json({
          ok: false,
          code: "AUTH_RATE_LIMITED",
          error: "Trop de tentatives. Réessayez dans 15 minutes.",
          retryAfter: decision.retryAfter,
        });
    }
    if (decision.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
    }
    next();
  };
  api.post("/api/auth/login", async (req, res) => {
    const identifier = String(req.body?.identifier || req.body?.email || "")
        .trim()
        .toLowerCase(),
      password = String(req.body?.password || ""),
      clientIp = normalizedClientIp(req);
    if (!identifier || identifier.length > 320 || !password || password.length > 200)
      return res.status(400).json({ error: "Identifiants invalides." });
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
          if (firebaseCredential.user.uid !== account.firebaseUid) {
            loginGuard.recordLoginFailure(clientIp, identifier);
            return res.status(401).json({ error: 'Identifiants invalides.' });
          }
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
      loginGuard.recordLoginFailure(clientIp, identifier);
      return res
        .status(401)
        .json({ error: "Identifiants invalides ou invitation expirée." });
    }
    loginGuard.clearAccountIp(clientIp, identifier);
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
  }, loginPreflight);

  const firebaseSessionPreflight: express.RequestHandler = async (req, res, next) => {
    const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
    const decoded = await verifiedFirebaseIdentity(token);
    if (!decoded || !decoded.email) {
      return void res.status(401).json({
        error: "Une identité Firebase avec email vérifié est requise.",
      });
    }
    res.locals.verifiedFirebaseDecoded = decoded;
    next();
  };
  api.post("/api/auth/firebase-session", async (req, res) => {
    const decoded =
      res.locals.verifiedFirebaseDecoded ||
      (await verifiedFirebaseIdentity(
        String(req.headers.authorization || "").replace(/^Bearer /, ""),
      ));
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
  }, firebaseSessionPreflight);

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
            reserveFundRate: resolveLegalFramework(sharedStore.__legalFrameworkConfig).rules
              .defaultReserveFundPercent,
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
}

export function registerAuthSessionRoutes(
  _app: express.Express,
  deps: AuthSessionRoutesDeps,
) {
  const { api, sharedStore, extractAndVerifyCaller, issueServerSessionToken } =
    deps;

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
    clearSessionCookie(res);
    return res.json({ ok: true });
  });
}
