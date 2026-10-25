import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import { encrypt, decrypt } from './mailer';
import { OperationError } from './operations';
import { assertOutsideTransaction, type State, type StateRepository } from './repository';

export type FirebaseMutation = {
  kind: 'create' | 'password' | 'revoke' | 'login' | 'verify' | 'reset';
  target: string; firebaseUid: string; email: string; password?: string; emailVerified?: boolean;
};
type Plan = { operationId: string; actions: FirebaseMutation[]; actorUid?: string; actorRole?: string; actorSyndicId?: string; resumeId?: string };
type Response = { payload: any; status: number; format: string; identityFinalized?: boolean };
type Intent = {
  operationId: string; fingerprint: string; status: 'pending' | 'running' | 'finalized';
  createdAt: string; finalizedAt?: string; actorUid?: string; actorVersion?: number;
  actorRole?: string; actorSyndicId?: string;
  targets: string[]; scope: { uid: string; syndicId?: string; buildingId?: string }[];
  encryptedPlan?: string; encryptedResponse: string; completedSteps: number;
  leaseOwner?: string; leaseUntil?: number; lastError?: string;
};
const context = new AsyncLocalStorage<Plan>();
const rows = (s: State): Record<string, Intent> => (s.__firebaseMutations_v1 ??= {});
const accounts = (s: State): any[] => ['syndik_prod_registered_users_v1', 'syndik_prod_resident_accounts_v1',
  'syndik_prod_prestataire_accounts_v1'].flatMap(k => s[k] || []);
const uidOf = (a: any) => a.uid || a.profile?.uid || (a.residentId ? `user-res-${a.residentId}` : `user-prest-${a.prestataireId}`);
const pendingError = () => new OperationError('Modification des accès en cours. Réessayez la même demande dans un instant.', 409, 'IDENTITY_MUTATION_PENDING');
export function assertIdentityReady(state: State, uid: string) {
  const locks = state.__firebaseMutationLocks_v1;
  if (locks ? Boolean(locks[uid]) : Object.values(state.__firebaseMutations_v1 || {}).some((i: any) => i.status !== 'finalized' && i.targets.includes(uid))) throw pendingError();
}
export function identityMutationActor(actor: { uid: string; role: string; syndicId?: string }) {
  const plan = context.getStore();
  if (plan) { plan.actorUid = actor.uid; plan.actorRole = actor.role; plan.actorSyndicId = actor.syndicId; }
}
export function pendingIdentityPlanId() { const p = context.getStore(); return p?.actions.length ? p.operationId : undefined; }
export function resumeQueuedIdentityMutation(state: State, id: string) {
  const plan = context.getStore(), intent = state.__firebaseMutations_v1?.[id] as Intent | undefined;
  if (!intent || intent.status === 'finalized') return;
  if (!plan || intent.actorUid !== plan.actorUid || intent.actorRole !== plan.actorRole || intent.actorSyndicId !== plan.actorSyndicId)
    throw new OperationError('Accès à cette modification interdit.', 403);
  plan.resumeId = id;
}
export function plannedIdentityUid() {
  const plan = context.getStore();
  if (!plan) throw new Error('Identity creation requires a durable transaction plan');
  return `usr-${plan.operationId}`;
}
export function queueFirebaseMutation(state: State, action: FirebaseMutation) {
  const plan = context.getStore();
  if (!plan) throw new Error('Identity mutation requires a durable transaction plan');
  assertIdentityReady(state, action.target);
  plan.actions.push(action);
}
export const identityRequestFingerprint = (route: string, authorization: string, body: any) =>
  createHmac('sha256', process.env.SYNDIK_SERVER_SECRET || '').update(JSON.stringify([route, authorization, body])).digest('hex');
type Execute = (action: FirebaseMutation, results: any[]) => Promise<any>;
type Finalize = (response: Response, results: any[], state: State, intent: Intent) => void;

// Every repository callback is pure with respect to Firebase. Only the winning
// Phase A attempt survives; its encrypted arguments and response become canonical.
export async function identityTransaction(repo: StateRepository, fingerprint: string,
  prepare: (state: State) => Promise<Response>, execute: Execute, finalize: Finalize,
  authorizeResume: (state: State, intent: Intent) => Promise<void>): Promise<Response> {
  const operationId = randomUUID(); // Stable across ALL callback retries.
  const prepared = await repo.transaction(async state => {
    const pending = Object.values(state.__firebaseMutations_v1 || {}).find((i: any) =>
      i.fingerprint === fingerprint && i.status !== 'finalized') as Intent | undefined;
    if (pending) { await authorizeResume(state, pending); return { operationId: pending.operationId }; }
    const plan: Plan = { operationId, actions: [] };
    const response = await context.run(plan, () => prepare(state));
    if (plan.resumeId) return { operationId: plan.resumeId };
    if (!plan.actions.length) return { response };
    if (response.status >= 400) throw new OperationError('Modification des accès refusée.', response.status);
    plan.actorUid ||= response.payload?.profile?.uid;
    plan.actorRole ||= response.payload?.profile?.role;
    plan.actorSyndicId ||= response.payload?.profile?.syndicId;
    const targets = [...new Set(plan.actions.map(a => a.target))];
    const scope = targets.map(uid => {
      const a = accounts(state).find(a => uidOf(a) === uid);
      if (!a || a.disabled) throw new OperationError('Compte indisponible.', 409);
      return { uid, syndicId: a.syndicId || a.profile?.syndicId, buildingId: a.buildingId || a.profile?.buildingId };
    });
    rows(state)[operationId] = { operationId, fingerprint, status: 'pending', targets, scope,
      actorUid: plan.actorUid, actorVersion: plan.actorUid ? state.__sessionVersions?.[plan.actorUid] || 0 : undefined,
      actorRole: plan.actorRole, actorSyndicId: plan.actorSyndicId,
      createdAt: new Date().toISOString(), completedSteps: 0,
      encryptedPlan: encrypt(JSON.stringify({ actions: plan.actions, results: [] })),
      encryptedResponse: encrypt(JSON.stringify(response)) };
    // A private UID index keeps ordinary authentication independent of the
    // historical intent count. Older unindexed pending records remain readable.
    state.__firebaseMutationLocks_v1 ??= Object.fromEntries(Object.values(rows(state))
      .filter(i => i.status !== 'finalized').flatMap(i => i.targets.map(uid => [uid, i.operationId])));
    for (const uid of targets) state.__firebaseMutationLocks_v1[uid] = operationId;
    return { operationId };
  });
  return prepared.response || dispatchIdentityMutation(repo, prepared.operationId!, execute, finalize);
}

export async function dispatchIdentityMutation(repo: StateRepository, operationId: string, execute: Execute, finalize: Finalize): Promise<Response> {
  assertOutsideTransaction();
  const owner = randomUUID();
  const snapshot = await repo.transaction(async state => {
    const intent = rows(state)[operationId];
    if (!intent) throw new OperationError('Modification des accès introuvable.', 404);
    if (intent.status === 'finalized') return structuredClone(intent);
    if ((intent.leaseUntil || 0) > Date.now()) throw pendingError();
    intent.status = 'running'; intent.leaseOwner = owner; intent.leaseUntil = Date.now() + 5 * 60000;
    return structuredClone(intent);
  });
  if (snapshot.status === 'finalized') return JSON.parse(decrypt(snapshot.encryptedResponse));
  const plan = JSON.parse(decrypt(snapshot.encryptedPlan!));
  try {
    for (let index = snapshot.completedSteps; index < plan.actions.length; index++) {
      // Claim renewal/checkpoint is short; provider work is never in its callback.
      await repo.transaction(async state => {
        const i = rows(state)[operationId];
        if (i.leaseOwner !== owner) throw pendingError();
        i.leaseUntil = Date.now() + 5 * 60000;
      });
      const result = await execute(plan.actions[index], plan.results);
      plan.results[index] = result ?? null;
      await repo.transaction(async state => {
        const i = rows(state)[operationId];
        if (i.leaseOwner !== owner) throw pendingError();
        i.completedSteps = index + 1;
        i.encryptedPlan = encrypt(JSON.stringify(plan));
      });
    }
    return await repo.transaction(async state => {
      const i = rows(state)[operationId];
      if (i.leaseOwner !== owner) throw pendingError();
      const response: Response = JSON.parse(decrypt(i.encryptedResponse));
      finalize(response, plan.results, state, i);
      response.identityFinalized = true;
      i.status = 'finalized'; i.finalizedAt = new Date().toISOString();
      for (const uid of i.targets)
        if (state.__firebaseMutationLocks_v1?.[uid] === operationId) delete state.__firebaseMutationLocks_v1[uid];
      i.encryptedResponse = encrypt(JSON.stringify(response));
      delete i.encryptedPlan; delete i.leaseOwner; delete i.leaseUntil; delete i.lastError;
      return response;
    });
  } catch (error: any) {
    // If checkpoint/finalization fails, keep the encrypted intent, never roll
    // back Firebase or unlock the account for a newer competing credential.
    try { await repo.transaction(async state => {
      const i = rows(state)[operationId];
      if (i?.leaseOwner === owner && i.status !== 'finalized') {
        i.status = 'pending'; i.leaseUntil = 0; delete i.leaseOwner;
        i.lastError = 'IDENTITY_PROVIDER_OR_FINALIZATION_UNAVAILABLE';
      }
    }); } catch {}
    if (error?.status === 409) throw error;
    throw new OperationError('Modification des accès enregistrée, mais non terminée. Réessayez la même demande.', 503, 'IDENTITY_MUTATION_PENDING');
  }
}

export async function resumeIdentityMutations(repo: StateRepository, execute: Execute, finalize: Finalize, limit = 10) {
  const ids = await repo.transaction(async s => Object.values(s.__firebaseMutations_v1 || {})
    .filter((i: any) => i.status !== 'finalized' && (i.leaseUntil || 0) <= Date.now()).slice(0, limit).map((i: any) => i.operationId));
  const result: { operationId: string; status: string }[] = [];
  for (const id of ids) {
    try { await dispatchIdentityMutation(repo, id, execute, finalize); result.push({ operationId: id, status: 'finalized' }); }
    catch { result.push({ operationId: id, status: 'pending' }); }
  }
  return result;
}
