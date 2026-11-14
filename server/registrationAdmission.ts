import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import type { Request, RequestHandler } from 'express';

type Kind = 'register' | 'verify';
type Attempt = { at: number; ip: string; identity: string; kind: Kind };
export type AdmissionState = { attempts: Attempt[]; reservations: { at: number; identity: string }[] };
export type Decision = { allowed: boolean; retryAfter: number };
export interface AdmissionStore {
  update(run: (state: AdmissionState) => Decision): Promise<Decision>;
}
const HOUR = 3600000, DAY = 24 * HOUR;
export const ADMISSION_LIMITS = { registerIp: 10, registerIdentity: 3, verifyIp: 20, verifyIdentity: 5,
  registerGlobal: 500, verifyGlobal: 1000, reservations: 200 };
const empty = (): AdmissionState => ({ attempts: [], reservations: [] });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Atomic sliding windows. Store only hashed identifiers, never tokens or passwords. */
export function admit(state: AdmissionState, kind: Kind, ip: string, identity: string, now = Date.now()): Decision {
  state.attempts = state.attempts.filter(r => r.at > now - HOUR);
  state.reservations = state.reservations.filter(r => r.at > now - DAY);
  const ipHash = digest(ip), identityHash = digest(identity.trim().toLowerCase());
  const attempts = state.attempts.filter(r => r.kind === kind);
  const blockedUntil: number[] = [];
  const check = (times: number[], limit: number, window: number) => {
    if (times.length >= limit) blockedUntil.push(Math.min(...times) + window);
  };
  check(attempts.map(r => r.at), kind === 'register' ? ADMISSION_LIMITS.registerGlobal : ADMISSION_LIMITS.verifyGlobal, HOUR);
  check(attempts.filter(r => r.ip === ipHash).map(r => r.at), kind === 'register' ? ADMISSION_LIMITS.registerIp : ADMISSION_LIMITS.verifyIp, HOUR);
  check(attempts.filter(r => r.identity === identityHash).map(r => r.at), kind === 'register' ? ADMISSION_LIMITS.registerIdentity : ADMISSION_LIMITS.verifyIdentity, HOUR);
  const reserved = state.reservations.some(r => r.identity === identityHash);
  if (kind === 'register' && !reserved) check(state.reservations.map(r => r.at), ADMISSION_LIMITS.reservations, DAY);
  if (blockedUntil.length) return { allowed: false, retryAfter: Math.max(1, Math.ceil((Math.max(...blockedUntil) - now) / 1000)) };
  state.attempts.push({ at: now, ip: ipHash, identity: identityHash, kind });
  // Conservative upper bound on pending/unverified registrations; failures and
  // verified accounts keep their reservation until expiry, never increasing capacity early.
  if (kind === 'register' && !reserved) state.reservations.push({ at: now, identity: identityHash });
  return { allowed: true, retryAfter: 0 };
}

export function createAdmissionStore(): AdmissionStore {
  const mode = process.env.SYNDIK_STATE_BACKEND || (process.env.NODE_ENV === 'production' ? 'firestore' : 'file');
  if (mode === 'firestore') {
    const db = getFirestore(getApps()[0] || initializeApp(), process.env.FIRESTORE_DATABASE_ID || '(default)');
    const ref = db.doc('platform_admission/registration_v1');
    return { update: run => db.runTransaction(async tx => {
      const snapshot = await tx.get(ref);
      const state = snapshot.exists ? snapshot.data() as AdmissionState : empty();
      const result = run(state);
      if (result.allowed) tx.set(ref, state);
      return result;
    }) };
  }
  // Separate small file and cross-process lock: never reads shared-state.json.
  const directory = path.join(process.env.SYNDIK_DATA_DIR || path.resolve('.data'), 'admission');
  return { update: async run => {
    await mkdir(directory, { recursive: true });
    const lock = path.join(directory, 'lock');
    let acquired = false;
    for (let i = 0; i < 40; i++) {
      try { await mkdir(lock); acquired = true; break; }
      catch (error: any) {
        if (error.code !== 'EEXIST') throw error;
        try {
          const info = await stat(lock);
          if (Date.now() - info.mtimeMs > 60000) {
            await rm(lock, { recursive: true, force: true });
            continue;
          }
        } catch {
          // Lock vanished before stat; retry mkdir
        }
        await new Promise(r => setTimeout(r, 25));
      }
    }
    if (!acquired) throw new Error('Admission store busy');
    const file = path.join(directory, 'registration.json');
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      let state = empty();
      try { state = JSON.parse(await readFile(file, 'utf8')); }
      catch (error: any) { if (error.code !== 'ENOENT') throw error; }
      const result = run(state);
      if (result.allowed) { await writeFile(temporary, JSON.stringify(state), { mode: 0o600 }); await rename(temporary, file); }
      return result;
    } finally { await rm(temporary, { force: true }); await rm(lock, { recursive: true, force: true }); }
  } };
}

export function registrationAdmission(store: AdmissionStore, verifiedIdentity: (req: Request) => string | undefined = () => undefined): RequestHandler {
  return async (req, res, next) => {
    if (req.method !== 'POST' || !['/api/auth/register', '/api/auth/verification/request'].includes(req.path)) return next();
    const kind: Kind = req.path === '/api/auth/register' ? 'register' : 'verify';
    let identity = kind === 'register' ? String(req.body?.email || '').trim().toLowerCase() : verifiedIdentity(req);
    if (!identity && kind === 'verify') {
      // A JWT claim is only a quota hint, NEVER authentication. Valid tokens for
      // the same Firebase user share a bucket across refreshes; the route still verifies them.
      try {
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
        const claims = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString());
        identity = String(claims.email || claims.sub || 'unknown');
      } catch { identity = 'unknown'; }
    }
    try {
      const result = await store.update(state => admit(state, kind, req.ip || req.socket.remoteAddress || 'unknown', (identity || 'unknown').slice(0, 320)));
      if (!result.allowed) return void res.status(429).set('Retry-After', String(result.retryAfter)).json({ ok: false,
        code: 'AUTH_RATE_LIMITED', error: 'Trop de demandes. Veuillez réessayer plus tard.', retryAfter: result.retryAfter });
      next();
    } catch {
      // No permissive in-memory fallback: storage outages cannot disable quotas.
      res.status(503).set('Retry-After', '30').json({ ok: false, code: 'AUTH_ADMISSION_UNAVAILABLE', error: 'Inscription temporairement indisponible.', retryAfter: 30 });
    }
  };
}
