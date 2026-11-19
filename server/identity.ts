import { randomBytes, createHash } from "node:crypto";
import { currentState, type State } from "./repository";
import { hashPassword } from "./passwords";
import { isAlreadyHashedPassword } from "../utils/security";
import { mailIsConfigured, queueMail } from "./mailer";
import { OperationError, appendAudit } from "./operations";
import { usesFirebaseAuth, identityAccounts, accountUid, prepareFirebaseRecovery,
  sendFirebaseReset, sendFirebaseVerification, firebaseAdminAuth } from './firebaseIdentity';
import { queueFirebaseMutation } from './identityMutations';
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function createIdentityAction(
  state: State,
  email: string,
  kind: "reset" | "verify",
) {
  const token = randomBytes(32).toString("base64url"),
    hash = digest(token);
  (state.__identityActions ??= {})[hash] = {
    email: email.toLowerCase(),
    kind,
    expiresAt: Date.now() + 30 * 60000,
  };
  const url = new URL(
    "/account-action",
    process.env.PUBLIC_APP_URL || "http://localhost:3000",
  );
  url.searchParams.set("token", token);
  url.searchParams.set("mode", kind);
  queueMail(
    state,
    email,
    kind === "reset"
      ? "Réinitialisation ImmoGest"
      : "Vérifiez votre adresse ImmoGest",
    `Ouvrez ce lien personnel valable 30 minutes :\n${url}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez cet email.`,
  );
}
export function registerIdentityRoutes(api: any, authenticate: any) {
  api.post("/api/auth/recovery/request", async (req: any, res: any) => {
    const state = currentState(),
      email = String(req.body?.email || "")
        .toLowerCase()
        .trim();
    const account = identityAccounts(state).find(u => u.email?.toLowerCase() === email && !u.disabled);
    const firebase = usesFirebaseAuth() || Boolean(account?.firebaseUid);
    if (!firebase && !mailIsConfigured())
      return res
        .status(503)
        .json({ error: "Email indisponible. Contactez votre syndic." });
    const key = digest(`${req.ip}:${email}`),
      rate = (state.__recoveryAttempts ??= {})[key];
    if (rate && rate > Date.now() - 60000)
      return res.status(429).json({ error: "Veuillez patienter une minute." });
    state.__recoveryAttempts[key] = Date.now();
    if (firebase) {
      if (account) await prepareFirebaseRecovery(state, account);
      if (account) queueFirebaseMutation(state, { kind: 'reset', target: accountUid(account),
        firebaseUid: account.firebaseUid, email });
    } else if (account) createIdentityAction(state, email, 'reset');
    return res.json({
      ok: true,
      message: "Si un compte existe, un lien personnel sera envoyé.",
    });
  });
  api.post("/api/auth/verification/request", async (req: any, res: any) => {
    const state = currentState(),
      caller = await authenticate(req, state);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    const matching = identityAccounts(state).filter(
      (a: any) => !a.disabled && accountUid(a) === caller.uid,
    );
    const primary = matching[0];
    const needsVerification =
      (caller as any).emailVerified === false ||
      matching.some((a: any) => a?.profile?.emailVerified === false);
    if (needsVerification) {
      const lastVerificationAt = matching.reduce(
        (max: number, a: any) => Math.max(max, Number(a.lastVerificationAt) || 0),
        0,
      );
      if (lastVerificationAt > Date.now() - 60000) {
        const retryAfter = Math.max(
          1,
          Math.ceil((lastVerificationAt + 60000 - Date.now()) / 1000),
        );
        return res
          .status(429)
          .set('Retry-After', String(retryAfter))
          .json({ ok: false, code: 'AUTH_RATE_LIMITED', error: "Veuillez patienter une minute.", retryAfter });
      }
      const firebaseUid = matching.find((a: any) => a.firebaseUid)?.firebaseUid;
      if (firebaseUid) {
        const idToken = String(req.body?.idToken || '').trim();
        if (!idToken) {
          throw new OperationError(
            'Reconnectez-vous pour renvoyer le lien de vérification.',
            401,
          );
        }
        let decoded;
        try { decoded = await firebaseAdminAuth().verifyIdToken(idToken, true); }
        catch { throw new OperationError('Reconnectez-vous pour renvoyer le lien de vérification.', 401); }
        if (decoded.uid !== firebaseUid) throw new OperationError('Identité incorrecte.', 403);
        res.locals.afterCommit = () => sendFirebaseVerification(idToken);
      } else {
        const targetEmail = (primary?.email || caller.email || '').trim().toLowerCase();
        if (targetEmail) createIdentityAction(state, targetEmail, "verify");
      }
      const now = Date.now();
      for (const a of matching) a.lastVerificationAt = now;
    }
    return res.json({ ok: true });
  });
  api.post("/api/auth/recovery/complete", async (req: any, res: any) => {
    const state = currentState(),
      token = String(req.body?.token || ""),
      hash = digest(token),
      action = state.__identityActions?.[hash];
    if (!action || action.expiresAt < Date.now())
      throw new OperationError("Lien expiré ou déjà utilisé.", 400);
    const accounts = [
      ...(state.syndik_prod_registered_users_v1 || []),
      ...(state.syndik_prod_resident_accounts_v1 || []),
      ...(state.syndik_prod_prestataire_accounts_v1 || []),
    ].filter(
      (u: any) => u.email?.toLowerCase() === action.email && !u.disabled,
    );
    if (accounts.some(u => u.firebaseUid))
      throw new OperationError('Demandez un nouveau lien depuis la page de connexion.', 400);
    if (action.kind === "reset") {
      const password = String(req.body?.password || "");
      if (password.length < 10 || password.length > 200 || isAlreadyHashedPassword(password))
        throw new OperationError("Mot de passe : 10 caractères minimum.", 400);
      const passwordHash = hashPassword(password);
      for (const u of accounts) {
        u.passwordHash = passwordHash;
        delete u.password;
        u.mustChangePassword = false;
        if (u.profile) {
          u.profile.mustChangePassword = false;
          u.profile.emailVerified = true;
        }
      }
      for (const s of state.syndik_prod_syndics_v1 || [])
        for (const b of s.buildings || [])
          for (const r of b.residents || [])
            if (r.email?.toLowerCase() === action.email) {
              r.mustChangePassword = false;
              r.invitationStatus = "accepted";
              delete r.invitationToken;
              delete r.invitationCode;
            }
      for (const p of state.syndik_prod_prestataires_v1 || [])
        if (p.email?.toLowerCase() === action.email) {
          p.mustChangePassword = false;
          p.invitationStatus = "accepted";
          delete p.invitationToken;
          delete p.invitationCode;
        }
      for (const u of accounts) {
        const uid =
          u.uid ||
          u.profile?.uid ||
          (u.residentId
            ? `user-res-${u.residentId}`
            : `user-prest-${u.prestataireId}`);
        (state.__sessionVersions ??= {})[uid] =
          (state.__sessionVersions?.[uid] || 0) + 1;
      }
    } else
      for (const u of accounts) if (u.profile) u.profile.emailVerified = true;
    delete state.__identityActions[hash];
    appendAudit(
      state,
      { uid: "identity-service", role: "system" },
      `identity_${action.kind}`,
      undefined,
      { email: action.email },
    );
    return res.json({ ok: true });
  });
}


