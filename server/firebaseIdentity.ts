import { getApps, initializeApp } from 'firebase-admin/app';
import type { UserRecord } from 'firebase-admin/auth';
import { getAuth } from 'firebase-admin/auth';
import config from '../firebase-applet-config.json' with { type: 'json' };
import { OperationError } from './operations';
import type { State } from './repository';

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

export function bindFirebaseAccount(state: State, account: any, user: UserRecord) {
  const uid = accountUid(account), email = String(account.email).trim().toLowerCase();
  if (!uid || user.disabled || user.email?.toLowerCase() !== email ||
      (account.firebaseUid && account.firebaseUid !== user.uid))
    throw new FirebaseIdentityError('IDENTITY_MISMATCH', 401);
  const linkedElsewhere = identityAccounts(state).some(a =>
    a.firebaseUid === user.uid && accountUid(a) !== uid);
  if (linkedElsewhere) throw new FirebaseIdentityError('IDENTITY_COLLISION', 409);
  const firstLink = !account.firebaseUid;
  for (const a of identityAccounts(state).filter(a => accountUid(a) === uid)) {
    a.firebaseUid = user.uid;
    delete a.password; delete a.passwordHash;
    if (a.profile) a.profile.emailVerified = user.emailVerified;
  }
  if (firstLink) {
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
  try { await request('signUp', { email, password, returnSecureToken: true }); }
  catch (error) {
    if (!(error instanceof FirebaseIdentityError) || error.firebaseCode !== 'EMAIL_EXISTS') throw error;
  }
  return firebasePasswordLogin(email, password);
}

export async function migrateLegacyLogin(state: State, account: any, password: string) {
  const email = account.email.trim().toLowerCase(), uid = accountUid(account);
  let user = await userByEmail(email);
  if (!user) {
    try { user = await firebaseAdminAuth().createUser({ uid, email, password,
      emailVerified: account.profile?.emailVerified === true }); }
    catch (error: any) {
      if (error.code !== 'auth/email-already-exists') throw new FirebaseIdentityError('MIGRATION_FAILED');
    }
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
    try { user = await firebaseAdminAuth().createUser({ uid, email,
      emailVerified: account.profile?.emailVerified === true }); }
    catch (error: any) {
      if (error.code !== 'auth/email-already-exists') throw new FirebaseIdentityError('MIGRATION_FAILED');
      user = await userByEmail(email);
    }
  }
  if (!user || (!account.firebaseUid && user.uid !== uid && !user.emailVerified))
    throw new FirebaseIdentityError('UNVERIFIED_IDENTITY_COLLISION', 409);
  bindFirebaseAccount(state, account, user);
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
