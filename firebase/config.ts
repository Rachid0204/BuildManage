import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import firebaseConfigJson from '../firebase-applet-config.json';

// Keep this as a direct import.meta.env access so Vite replaces it in the browser.
// Optional chaining on import.meta itself prevents Vite's environment substitution.
const metaEnv = (import.meta as { env?: Record<string, string | boolean | undefined> }).env || {};

const nodeEnv =
  typeof process !== 'undefined' && process.env
    ? (process.env as Record<string, string | undefined>)
    : {};

const readEnv = (key: string, fallback: string): string => {
  const val = metaEnv[key] ?? nodeEnv[key];
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;
};

export const firebaseConfig = {
  apiKey: readEnv('VITE_FIREBASE_API_KEY', firebaseConfigJson.apiKey),
  authDomain: readEnv('VITE_FIREBASE_AUTH_DOMAIN', firebaseConfigJson.authDomain),
  projectId: readEnv('VITE_FIREBASE_PROJECT_ID', firebaseConfigJson.projectId),
  storageBucket: readEnv('VITE_FIREBASE_STORAGE_BUCKET', firebaseConfigJson.storageBucket),
  messagingSenderId: readEnv(
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    firebaseConfigJson.messagingSenderId
  ),
  appId: readEnv('VITE_FIREBASE_APP_ID', firebaseConfigJson.appId),
  measurementId: readEnv(
    'VITE_FIREBASE_MEASUREMENT_ID',
    firebaseConfigJson.measurementId || ''
  ),
  firestoreDatabaseId: readEnv(
    'VITE_FIRESTORE_DATABASE_ID',
    firebaseConfigJson.firestoreDatabaseId || '(default)'
  ),
};

export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

const isBrowserRuntime = typeof window !== 'undefined' && typeof document !== 'undefined';

// Canonical environment flag: uses local/shared-state engine in Node tests or when VITE_USE_MOCK_DATA=true
export const isMock =
  !isBrowserRuntime || readEnv('VITE_USE_MOCK_DATA', 'false') === 'true';

export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
const authEmulatorUrl = readEnv('VITE_FIREBASE_AUTH_EMULATOR_URL', '');
if (isBrowserRuntime && authEmulatorUrl && metaEnv.DEV &&
    ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
    ['localhost', '127.0.0.1'].includes(new URL(authEmulatorUrl).hostname)) {
  connectAuthEmulator(auth, authEmulatorUrl, { disableWarnings: true });
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

