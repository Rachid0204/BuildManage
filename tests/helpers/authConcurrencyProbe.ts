// Test-process preload only. Inject faults at the REAL Firestore commit boundary.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { currentState } from '../../server/repository';

if (process.env.NODE_ENV !== 'test' || process.env.GOOGLE_CLOUD_PROJECT !== 'demo-buildmanage' ||
    !process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST?.startsWith('127.0.0.1:')) throw new Error('Local demo emulators required');
const file = process.env.AUTH_CONCURRENCY_PROBE!;
const settings = () => JSON.parse(readFileSync(file, 'utf8'));
const trace = (kind: string) => {
  let inTransaction = false;
  try { currentState(); inTransaction = true; } catch {}
  appendFileSync(file + '.trace', JSON.stringify({ kind, inTransaction }) + '\n');
};
const original = Firestore.prototype.runTransaction;
Firestore.prototype.runTransaction = function (this: Firestore, ...args: any[]) {
  const config = settings();
  if (config.commitFailure) {
    const mode = config.commitFailure; delete config.commitFailure; writeFileSync(file, JSON.stringify(config));
    trace('commit-' + mode);
    return Promise.reject(Object.assign(new Error('Synthetic commit conflict'), { code: mode === 'retry' ? 10 : 9 }));
  }
  return original.apply(this, args as any);
} as any;
const auth = getAuth(initializeApp({ projectId: 'demo-buildmanage' }, 'buildmanage-server'));
for (const method of ['updateUser', 'revokeRefreshTokens', 'createUser'] as const) {
  const original = auth[method].bind(auth) as any;
  (auth as any)[method] = async (...args: any[]) => {
    trace(method);
    const config = settings();
    if (config.delay && method === 'updateUser') await new Promise(r => setTimeout(r, 500));
    if (config.authFailure === method) {
      delete config.authFailure; writeFileSync(file, JSON.stringify(config));
      throw Object.assign(new Error('Synthetic Firebase interruption'), { code: 'auth/internal-error' });
    }
    const result = await original(...args);
    if (config.failCheckpointAfter === method) {
      delete config.failCheckpointAfter; config.commitFailure = 'abort'; writeFileSync(file, JSON.stringify(config));
    }
    return result;
  };
}

