import { getApps, initializeApp } from 'firebase-admin/app';
import type { UserRecord } from 'firebase-admin/auth';
import { getAuth } from 'firebase-admin/auth';
import config from '../firebase-applet-config.json' with { type: 'json' };
import { OperationError } from './operations';
import { assertOutsideTransaction, type State } from './repository';
import { queueFirebaseMutation, plannedIdentityUid, type FirebaseMutation } from './identityMutations';

// The legacy provider remains available for isolated regression tests and rollback.
// A linked account ALWAYS uses Firebase, even during rollback: old hashes cannot
// bypass a password reset that has already happened in Firebase.
export const usesFirebaseAuth = () => (process.env.SYNDIK_AUTH_PROVIDER ||
  (process.env.NODE_ENV === 'test' ? 'legacy' : 'firebase')) === 'firebase';

export function firebaseAdminAuth() {
  if (process.env.NODE_ENV === 'production' && process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new OperationError('Émulateur Firebase interdit en production.', 503);
  const app = getApps().find(a => a.name === 'buildmanage-server') || initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || config.projectId,
  }, 'buildmanage-server');
  return getAuth(app);
}

export class FirebaseIdentityError extends OperationError {
  constructor(public readonly firebaseCode: string, status = 503) {
    const message = status === 401 ? 'Identifiants invalides.'
      : status === 429 ? 'Trop de tentatives. Réessayez dans quelques minutes.'
      : status === 409 ? 'Ce compte Firebase existe déjà. Connectez-vous ou réinitialisez votre mot de passe.'
      : 'Le service Firebase Authentication est indisponible. Vérifiez sa configuration ou réessayez.';
    super(message, status);
  }
}

async function request(action: string, body: Record<string, unknown>) {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  firebaseAdminAuth(); // Refuse an emulator in production, including REST calls.
  const base = emulator ? `http://${emulator}/identitytoolkit.googleapis.com/v1` : 'https://identitytoolkit.googleapis.com/v1';
  const key = process.env.FIREBASE_API_KEY || config.apiKey;
  let response: Response;
  try {
    response = await fetch(`${base}/accounts:${action}?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Firebase-Locale': 'fr' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
  } catch { throw new FirebaseIdentityError('NETWORK_ERROR'); }
  const data = await response.json();
  if (!response.ok) {
    const code = String(data.error?.message || 'UNKNOWN').split(' : ')[0];
    throw new FirebaseIdentityError(code,
      ['INVALID_LOGIN_CREDENTIALS', 'INVALID_PASSWORD', 'EMAIL_NOT_FOUND', 'USER_DISABLED'].includes(code) ? 401
      : ['TOO_MANY_ATTEMPTS_TRY_LATER', 'QUOTA_EXCEEDED'].includes(code) ? 429
      : code === 'EMAIL_EXISTS' ? 409 : 503);
  }
  return data;
}

export const accountUid = (account: any): string => account.uid || account.profile?.uid ||
  (account.residentId ? `user-res-${account.residentId}` : account.prestataireId ? `user-prest-${account.prestataireId}` : '');
export const identityAccounts = (state: State): any[] => [
  ...(state.syndik_prod_registered_users_v1 || []),
  ...(state.syndik_prod_resident_accounts_v1 || []),
  ...(state.syndik_prod_prestataire_accounts_v1 || []),
];

async function userByEmail(email: string): Promise<UserRecord | undefined> {
  try { return await firebaseAdminAuth().getUserByEmail(email); }
  catch (error: any) {
    if (error.code === 'auth/user-not-found') return undefined;
    throw new FirebaseIdentityError('ADMIN_LOOKUP_FAILED');
  }
}

export function bindFirebaseAccount(state: State, account: any, user: UserRecord, preserveCredentials = false) {
  const uid = accountUid(account), email = String(account.email).trim().toLowerCase();
  if (!uid || user.disabled || user.email?.toLowerCase() !== email ||
      (account.firebaseUid && account.firebaseUid !== user.uid))
    throw new FirebaseIdentityError('IDENTITY_MISMATCH', 401);
  const linkedElsewhere = identityAccounts(state).some(a =>
    a.firebaseUid === user.uid && accountUid(a) !== uid);
  if (linkedElsewhere) throw new FirebaseIdentityError('IDENTITY_COLLISION', 409);
  const firstLink = !account.firebaseUid;
  let clearedCredentials = false;
  for (const a of identityAccounts(state).filter(a => accountUid(a) === uid)) {
    a.firebaseUid = user.uid;
    if (!preserveCredentials) {
      if (a.password || a.passwordHash) clearedCredentials = true;
      delete a.password; delete a.passwordHash;
    }
    if (a.profile) a.profile.emailVerified = user.emailVerified;
  }
  if (!preserveCredentials && (firstLink || clearedCredentials)) {
    (state.__sessionVersions ??= {})[uid] = (state.__sessionVersions?.[uid] || 0) + 1;
    for (const [key, action] of Object.entries(state.__identityActions || {}))
      if ((action as any).email === email) delete state.__identityActions[key];
  }
}

export async function firebasePasswordLogin(email: string, password: string) {
  const data = await request('signInWithPassword', { email, password, returnSecureToken: true });
  const user = await firebaseAdminAuth().getUser(data.localId);
  if (user.disabled || user.email?.toLowerCase() !== email.toLowerCase())
    throw new FirebaseIdentityError('IDENTITY_MISMATCH', 401);
  const claims = JSON.parse(Buffer.from(data.idToken.split('.')[1], 'base64url').toString());
  return { user, idToken: String(data.idToken), authTime: Number(claims.auth_time) };
}

export async function registerFirebaseAccount(email: string, password: string) {
  // Retrying after a database failure can finish the same Firebase identity.
  // Existing identities are never overwritten: the submitted Firebase password
  // must authenticate before any application profile can be provisioned.
  const existing = await userByEmail(email);
  if (existing) return firebasePasswordLogin(email, password);
  const uid = plannedIdentityUid();
  // The application identity and intent commit together; authentication stays
  // blocked until create/login/verification and finalization have completed.
  const { currentState } = await import('./repository');
  return planNewAccount(currentState(), uid, email, password, false, true);
}

function planNewAccount(state: State, uid: string, email: string, password?: string, emailVerified = false, verify = false) {
  queueFirebaseMutation(state, { kind: 'create', target: uid, firebaseUid: uid, email, password, emailVerified });
  if (password) queueFirebaseMutation(state, { kind: 'login', target: uid, firebaseUid: uid, email, password });
  if (verify && !emailVerified) queueFirebaseMutation(state, { kind: 'verify', target: uid, firebaseUid: uid, email });
  return { user: { uid, email, emailVerified, disabled: false } as UserRecord, idToken: '', authTime: Math.floor(Date.now() / 1000) };
}

export function planFirebasePassword(state: State, target: string, firebaseUid: string, email: string, password: string, login = false) {
  queueFirebaseMutation(state, { kind: 'password', target, firebaseUid, email, password });
  queueFirebaseMutation(state, { kind: 'revoke', target, firebaseUid, email });
  if (login) queueFirebaseMutation(state, { kind: 'login', target, firebaseUid, email, password });
}

export async function executeFirebaseMutation(action: FirebaseMutation, results: any[]) {
  assertOutsideTransaction();
  const auth = firebaseAdminAuth();
  if (action.kind === 'create') {
    let user = await userByEmail(action.email);
    if (!user) {
      try { user = await auth.createUser({ uid: action.firebaseUid, email: action.email,
        ...(action.password ? { password: action.password } : {}), emailVerified: action.emailVerified }); }
      catch (error: any) {
        if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error;
        user = await userByEmail(action.email);
      }
    }
    if (!user || user.uid !== action.firebaseUid || user.disabled || user.email?.toLowerCase() !== action.email.toLowerCase())
      throw new FirebaseIdentityError('IDENTITY_COLLISION', 409);
    return { uid: user.uid };
  }
  // Re-check the binding before every credential side effect. A stale intent
  // must never overwrite a different Firebase identity that reused an email.
  const user = await auth.getUser(action.firebaseUid);
  if (user.email?.toLowerCase() !== action.email.toLowerCase() || user.disabled)
    throw new FirebaseIdentityError('IDENTITY_MISMATCH', 409);
  if (action.kind === 'password') { await auth.updateUser(action.firebaseUid, { password: action.password }); return null; }
  if (action.kind === 'revoke') { await auth.revokeRefreshTokens(action.firebaseUid); return null; }
  if (action.kind === 'login') {
    const credential = await firebasePasswordLogin(action.email, action.password!);
    if (credential.user.uid !== action.firebaseUid) throw new FirebaseIdentityError('IDENTITY_MISMATCH', 409);
    return { authTime: credential.authTime, idToken: credential.idToken };
  }
  if (action.kind === 'verify') {
    const idToken = [...results].reverse().find(r => r?.idToken)?.idToken;
    if (!idToken) throw new FirebaseIdentityError('MISSING_VERIFICATION_SESSION');
    try { await sendFirebaseVerification(idToken); return { verificationEmailSent: true }; }
    catch { return { verificationEmailSent: false }; }
  }
  if (action.kind === 'reset') { await sendFirebaseReset(action.email); return null; }
}

export async function migrateLegacyLogin(state: State, account: any, password: string) {
  const email = account.email.trim().toLowerCase(), uid = accountUid(account);
  let user = await userByEmail(email);
  if (!user) {
    const credential = planNewAccount(state, uid, email, password, account.profile?.emailVerified === true, true);
    bindFirebaseAccount(state, account, credential.user);
    return credential;
  }
  // In particular, never reset an existing Google/Firebase user's password here.
  const credential = await firebasePasswordLogin(email, password);
  bindFirebaseAccount(state, account, credential.user);
  return credential;
}

export async function prepareFirebaseRecovery(state: State, account: any) {
  const email = account.email.trim().toLowerCase(), uid = accountUid(account);
  let user = await userByEmail(email);
  if (!user) {
    user = planNewAccount(state, uid, email, undefined, account.profile?.emailVerified === true).user;
  }
  if (!user || (!account.firebaseUid && user.uid !== uid && !user.emailVerified))
    throw new FirebaseIdentityError('UNVERIFIED_IDENTITY_COLLISION', 409);
  bindFirebaseAccount(state, account, user, true);
}

const continueUrl = () => new URL('/login', process.env.PUBLIC_APP_URL || 'https://immogest.cloud.run').toString();
export const sendFirebaseVerification = (idToken: string) => request('sendOobCode', {
  requestType: 'VERIFY_EMAIL', idToken, continueUrl: continueUrl(),
});
export async function sendFirebaseReset(email: string) {
  try { await request('sendOobCode', { requestType: 'PASSWORD_RESET', email, continueUrl: continueUrl() }); }
  catch (error) {
    if (!(error instanceof FirebaseIdentityError) || error.firebaseCode !== 'EMAIL_NOT_FOUND') throw error;
  }
}

export async function firebaseSessionUser(account: any, authTime?: number) {
  if (!account.firebaseUid) return undefined;
  let user: UserRecord;
  try { user = await firebaseAdminAuth().getUser(account.firebaseUid); }
  catch (error: any) {
    if (error.code === 'auth/user-not-found') return null;
    throw new FirebaseIdentityError('ADMIN_LOOKUP_FAILED');
  }
  if (user.disabled || user.email?.toLowerCase() !== account.email?.toLowerCase() ||
      !Number.isFinite(authTime) || Number(authTime) < Date.parse(user.tokensValidAfterTime || '') / 1000)
    return null;
  return user;
}
