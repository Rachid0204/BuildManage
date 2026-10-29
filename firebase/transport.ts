import type {
  CommandArgs,
  CommandName,
  CommandResult,
} from '../shared/api/commands';
import { STORAGE_KEYS } from '../shared/api/records';
import { notifyOperation, readableError } from '../utils/formFeedback';
import { getAuthenticatedRequestHeaders } from '../utils/security';
import { clearBusinessCache, engineStorage } from './cache';
import {
  operationHash,
  operationTarget,
  pendingFor,
  removePending,
  savePending,
  type PendingOperation,
} from './operationRecovery';
import { abortMutationRequests, withRequestDeadline } from './requestDeadline';
import {
  WireResponseSchema,
  isRecord,
  sanitizeSnapshot,
  type WireResponse,
} from './wire';

// Read-only server snapshots. All business mutations are submitted to Express.
export function readSnapshot<T>(key: string, fallback: T): T {
  try {
    const raw = engineStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const LEGACY_TEST_KEYS = [
  'syndik_reactive_syndics',
  'syndik_reactive_charges',
  'syndik_reactive_proofs',
  'syndik_reactive_quittances',
  'syndik_reactive_ag',
  'syndik_reactive_prestataires_v2',
  'syndik_reactive_maintenance_v2',
  'syndik_reactive_chat_v1',
  'syndik_reactive_marketplace_v1',
  'syndik_reactive_notifications_v1',
  'syndik_resident_accounts_v1',
  'syndik_prestataire_accounts_v1',
  'syndik_registered_users_v1',
  'syndik_mock_user',
];

const broadcastChannel =
  typeof window !== 'undefined' && 'BroadcastChannel' in window
    ? new BroadcastChannel('syndik_realtime_sync')
    : null;

export function notifyStateUpdated(key: string, broadcast = true) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('syndik-state-updated', { detail: { key } }),
    );
  }
  try {
    if (broadcast)
      broadcastChannel?.postMessage({
        type: 'STATE_UPDATED',
        key,
        timestamp: Date.now(),
      });
  } catch {
    // ignore broadcast errors
  }
}

let lastKnownServerRevision = 0;

let lastSyncTimestampMs = 0;

let inflightSyncPromise: Promise<Record<string, unknown> | null> | null = null;

let stateCacheGeneration = 0;

const syncControllers = new Set<AbortController>();

export const getKnownServerRevision = () => lastKnownServerRevision;

function cacheServerStore(store: Record<string, unknown>) {
  for (const key of Object.values(STORAGE_KEYS)) {
    const value = store[key];
    const next =
      value === undefined || value === null
        ? null
        : JSON.stringify(sanitizeSnapshot(value));
    if (engineStorage.getItem(key) === next) continue;
    if (next === null) engineStorage.removeItem(key);
    else engineStorage.setItem(key, next);
    notifyStateUpdated(key, false);
  }
}

export async function syncAllSharedStateFromServer(
  force: boolean = false,
): Promise<Record<string, unknown> | null> {
  const headers = getAuthenticatedRequestHeaders();
  if (!headers['Authorization']) {
    return null;
  }

  // Coalesce concurrent sync requests fired on view mount
  if (inflightSyncPromise && !force) {
    return inflightSyncPromise;
  }
  if (
    !force &&
    Date.now() - lastSyncTimestampMs < 1200 &&
    lastKnownServerRevision > 0
  ) {
    return null;
  }

  const generation = stateCacheGeneration;
  const controller = new AbortController();
  syncControllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), 15000);
  const task = (async () => {
    try {
      const url =
        !force && lastKnownServerRevision > 0
          ? `/api/shared-state?sinceRevision=${lastKnownServerRevision}`
          : '/api/shared-state';
      const res = await fetch(url, {
        method: 'GET',
        headers,
        cache: 'no-store',
        signal: controller.signal,
      });
      if (generation !== stateCacheGeneration) return null;
      if (!res.ok) {
        if ([401, 403].includes(res.status) && typeof window !== 'undefined')
          window.dispatchEvent(new CustomEvent('syndik-session-invalid'));
        const failure = await readCommandResponse(res);
        throw new Error(failure.error || 'Chargement des données impossible.');
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json'))
        throw new Error(
          'Le service de données ne répond pas correctement. Réessayez ou contactez le gestionnaire.',
        );

      const data = WireResponseSchema.parse((await res.json()) as unknown);
      if (generation !== stateCacheGeneration) return null;
      if (!data || !data.ok)
        throw new Error(
          'Le service de données ne répond pas correctement. Réessayez ou contactez le gestionnaire.',
        );
      if (
        typeof data.revision === 'number' &&
        data.revision < lastKnownServerRevision
      )
        return null;

      if (typeof data.revision === 'number') {
        lastKnownServerRevision = data.revision;
      }
      lastSyncTimestampMs = Date.now();

      if (data.unchanged || !data.store) {
        return null;
      }

      const serverStore = data.store as Record<string, unknown>;
      const trackedKeys = Object.values(STORAGE_KEYS);

      if (typeof window !== 'undefined' && serverStore.__resetAt) {
        const localResetAt = engineStorage.getItem('syndik_prod_last_reset_at');
        if (localResetAt !== String(serverStore.__resetAt)) {
          for (const k of trackedKeys) {
            engineStorage.removeItem(k);
          }
          engineStorage.setItem(
            'syndik_prod_last_reset_at',
            String(serverStore.__resetAt),
          );
        }
      }

      cacheServerStore(serverStore);
      return serverStore;
    } catch (error) {
      if (generation !== stateCacheGeneration) return null;
      throw error;
    } finally {
      clearTimeout(timeout);
      syncControllers.delete(controller);
    }
  })();

  inflightSyncPromise = task;
  const release = () => {
    if (inflightSyncPromise === task) inflightSyncPromise = null;
  };
  void task.then(release, release);
  return task;
}

export async function resetAllProductionData(): Promise<void> {
  throw new Error(
    'Remise à zéro désactivée : utilisez la sauvegarde et restauration.',
  );
}

const ephemeralInvites = new Map<
  string,
  { invitationCode?: string; invitationToken?: string }
>();

const preparedOperations = new Map<string, unknown[]>();

const inflightOperations = new Map<string, Promise<unknown>>();

export function clearStateCache() {
  stateCacheGeneration++;
  abortMutationRequests();
  for (const controller of syncControllers) controller.abort();
  syncControllers.clear();
  inflightSyncPromise = null;
  clearBusinessCache();
  preparedOperations.clear();
  inflightOperations.clear();
  ephemeralInvites.clear();
  lastKnownServerRevision = 0;
  lastSyncTimestampMs = 0;
}

export function remoteMutation<K extends CommandName>(
  operation: K,
  input: CommandArgs<K>,
): Promise<CommandResult<K>> {
  const args: unknown[] = [...input];
  while (args.length && args.at(-1) === undefined) args.pop();
  const requestKey = JSON.stringify({ operation, args });
  const pending = inflightOperations.get(requestKey);
  if (pending) return pending as Promise<CommandResult<K>>;
  const task = performRemoteMutation<K>(operation, args, requestKey).finally(
    () => {
      if (inflightOperations.get(requestKey) === task)
        inflightOperations.delete(requestKey);
    },
  );
  inflightOperations.set(requestKey, task);
  return task;
}

async function performRemoteMutation<K extends CommandName>(
  operation: K,
  args: unknown[],
  requestKey: string,
): Promise<CommandResult<K>> {
  const generation = stateCacheGeneration;
  const requireSameIdentity = () => {
    if (
      generation !== stateCacheGeneration ||
      getAuthenticatedRequestHeaders()['X-Syndik-Uid'] !== uid
    )
      throw new Error('La session a changé. Recommencez depuis votre espace.');
  };
  const uid = getAuthenticatedRequestHeaders()['X-Syndik-Uid'];
  if (!uid) throw new Error('Authentification requise.');
  let record: PendingOperation | undefined;
  try {
    const requestHash = await operationHash(requestKey);
    requireSameIdentity();
    const target = operationTarget(operation, args);
    const records = pendingFor(uid);
    record =
      records.find(
        (r) => r.requestHash === requestHash && r.operation === operation,
      ) ||
      records.find((r) => r.operation === operation && r.target === target);
    if (record) {
      notifyOperation({
        operation,
        phase: 'checking',
        operationId: record.operationId,
      });
      try {
        const { response, data } = await commandRequest(
          '/api/operations/status',
          {
            method: 'POST',
            headers: getAuthenticatedRequestHeaders(),
            body: JSON.stringify({ operationId: record.operationId }),
          },
        );
        requireSameIdentity();
        if (!response.ok)
          throw new Error(
            data.error || 'Vérification de la demande impossible.',
          );
        if (data.status === 'completed') {
          if (data.operation !== operation)
            throw new Error('Résultat incompatible avec la demande.');
          applyCommandResult(data, operation);
          removePending(uid, record.operationId);
          if (record.requestHash !== requestHash)
            throw new Error(
              'La demande précédente a abouti. Vérifiez les données actualisées avant de soumettre une nouvelle demande.',
            );
          preparedOperations.delete(requestKey);
          return (
            Array.isArray(data.result)
              ? Object.assign(data.result, data.resultMeta || {})
              : data.result
          ) as CommandResult<K>;
        }
        if (record.requestHash !== requestHash)
          throw new Error(
            'Une demande différente reste non résolue pour cette cible. Reprenez la demande initiale avant de continuer.',
          );
        if (data.status !== 'not_found')
          throw new Error(
            'Demande encore en cours. Vérifiez son résultat dans un instant.',
          );
      } finally {
        notifyOperation({
          operation,
          phase: 'settled',
          operationId: record.operationId,
        });
      }
    } else {
      record = {
        operationId: `op:${Date.now()}:${crypto.randomUUID()}`,
        operation,
        target: operationTarget(operation, args),
        timestamp: Date.now(),
        requestHash,
        uploads: {},
      };
      savePending(uid, record);
    }
    const first: unknown = args[0];
    const linked =
      typeof first === 'string'
        ? [
            STORAGE_KEYS.MAINTENANCE,
            STORAGE_KEYS.MARKETPLACE,
            STORAGE_KEYS.CHAT,
          ]
            .flatMap((key) =>
              readSnapshot<Array<{ id: string; buildingId?: string }>>(key, []),
            )
            .find((item) => item.id === first)
        : undefined;
    const buildingId =
      (isRecord(first) && typeof first.buildingId === 'string'
        ? first.buildingId
        : undefined) ||
      linked?.buildingId ||
      (operation === 'attachDocument' && typeof first === 'string'
        ? first
        : undefined);
    if (preparedOperations.has(requestKey))
      args = preparedOperations.get(requestKey)!;
    else if (buildingId) {
      const uploadFile = async (value: string, name: string) => {
        const hash = await operationHash(value);
        requireSameIdentity();
        if (record!.uploads[hash]) return record!.uploads[hash];
        const { response, data: result } = await commandRequest(
          '/api/uploads',
          {
            method: 'POST',
            headers: getAuthenticatedRequestHeaders(),
            body: JSON.stringify({ buildingId, name, dataUrl: value }),
          },
        );
        requireSameIdentity();
        if (!response.ok)
          throw new Error(result.error || 'Téléversement impossible.');
        if (
          typeof result.url !== 'string' ||
          !/^\/api\/uploads\/[a-zA-Z0-9_-]+$/.test(result.url)
        )
          throw new Error('Référence de fichier invalide.');
        record!.uploads[hash] = result.url;
        savePending(uid, record!);
        return result.url;
      };
      const uploaded = new Map<string, Promise<string>>();
      const upload = async (value: unknown, key = ''): Promise<unknown> => {
        if (
          typeof value === 'string' &&
          value.startsWith('data:') &&
          [
            'photoUrl',
            'photos',
            'images',
            'imageUrl',
            'receiptUrl',
            'attachmentUrl',
            'stepPhotos',
          ].includes(key)
        ) {
          let pending = uploaded.get(value);
          if (!pending) {
            pending = uploadFile(value, 'piece-jointe');
            uploaded.set(value, pending);
          }
          return pending;
        }
        if (Array.isArray(value))
          return Promise.all(value.map((item) => upload(item, key)));
        if (value && typeof value === 'object')
          return Object.fromEntries(
            await Promise.all(
              Object.entries(value).map(async ([field, item]) => [
                field,
                await upload(item, field),
              ]),
            ),
          );
        return value;
      };
      const document = args[1];
      if (
        operation === 'attachDocument' &&
        isRecord(document) &&
        typeof document.dataUrl === 'string' &&
        typeof document.name === 'string'
      ) {
        const url = await uploadFile(document.dataUrl, document.name);
        args = [buildingId, { fileId: url.split('/').at(-1) }];
      } else args = await Promise.all(args.map((value) => upload(value)));
      requireSameIdentity();
      preparedOperations.set(requestKey, args);
    }
    requireSameIdentity();
    // Persisted identity and private upload references survive an uncertain response and reload.
    const operationId = record.operationId;
    const { response, data } = await commandRequest('/api/commands', {
      method: 'POST',
      headers: getAuthenticatedRequestHeaders(),
      body: JSON.stringify({ operation, args, operationId }),
    });
    requireSameIdentity();
    if (!response.ok) {
      if (
        response.status < 500 &&
        ![401, 408, 409, 429].includes(response.status)
      ) {
        removePending(uid, operationId);
        preparedOperations.delete(requestKey);
      }
      throw new Error(data.error || 'Enregistrement impossible.');
    }
    if (data.ok !== true)
      throw new Error(
        'Réponse serveur incertaine. Vérifiez le résultat avant de réessayer.',
      );
    applyCommandResult(data, operation);
    removePending(uid, operationId);
    preparedOperations.delete(requestKey);
    return (
      Array.isArray(data.result)
        ? Object.assign(data.result, data.resultMeta || {})
        : data.result
    ) as CommandResult<K>;
  } catch (error) {
    if (generation !== stateCacheGeneration)
      throw new Error('La session a changé. Recommencez depuis votre espace.');
    notifyOperation({
      operation,
      error:
        error instanceof Error ? error.message : 'Enregistrement impossible.',
    });
    throw error;
  }
}

function applyCommandResult(data: WireResponse, operation: string) {
  if (isRecord(data.result) && typeof data.result.id === 'string') {
    const invitationCode =
      typeof data.result.invitationCode === 'string'
        ? data.result.invitationCode
        : undefined;
    const invitationToken =
      typeof data.result.invitationToken === 'string'
        ? data.result.invitationToken
        : undefined;
    if (invitationCode || invitationToken)
      ephemeralInvites.set(data.result.id, { invitationCode, invitationToken });
  }
  if (
    data.store &&
    (typeof data.revision !== 'number' ||
      data.revision >= lastKnownServerRevision)
  ) {
    if (typeof data.revision === 'number')
      lastKnownServerRevision = data.revision;
    lastSyncTimestampMs = Date.now();
    cacheServerStore(data.store);
  }
  for (const key of Object.values(STORAGE_KEYS)) notifyStateUpdated(key);
  notifyOperation({ operation });
}

export async function commandRequest(url: string, init: RequestInit) {
  return withRequestDeadline(url, init, async (response) => ({
    response,
    data: await readCommandResponse(response),
  }));
}

async function readCommandResponse(response: Response): Promise<WireResponse> {
  try {
    const result = WireResponseSchema.parse((await response.json()) as unknown);
    if (!response.ok && result.error) {
      const isAr =
        typeof window !== 'undefined' &&
        window.localStorage.getItem('syndik_lang') === 'ar';
      result.error = readableError(result.error, isAr);
      if (
        result.requestId &&
        [
          'INTERNAL_ERROR',
          'DATABASE_ACCESS',
          'DATABASE_MISSING',
          'DATABASE_UNAVAILABLE',
          'STORAGE_ACCESS',
          'STORAGE_MISSING',
          'STORAGE_UNAVAILABLE',
        ].includes(result.code || '')
      )
        result.error += `\n${isAr ? 'مرجع الدعم' : 'Référence pour le support'} : ${result.requestId}`;
    }
    return result;
  } catch {
    if (response.status === 413)
      throw new Error(
        'Fichier trop volumineux. Joignez un fichier de 5 Mo maximum.',
      );
    if (response.status === 401) throw new Error('Authentification requise.');
    if (response.status === 429)
      throw new Error(
        'Trop de demandes. Patientez un instant avant de réessayer.',
      );
    throw new Error(
      'Le serveur est temporairement indisponible. Réessayez dans un instant.',
    );
  }
}

// Clear historical browser persistence once; snapshots remain memory-only.
if (typeof window !== 'undefined') {
  for (const key of [...Object.values(STORAGE_KEYS), ...LEGACY_TEST_KEYS])
    window.localStorage.removeItem(key);
  void syncAllSharedStateFromServer().catch(() => {});
}
export function ephemeralInvitation(id: string) {
  return ephemeralInvites.get(id);
}
