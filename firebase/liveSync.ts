import { z } from 'zod';
import { getAuthenticatedRequestHeaders } from '../utils/security';
import { apiUrl } from '../utils/apiBase';
import {
  getKnownServerRevision,
  SyncHttpError,
  syncAllSharedStateFromServer,
} from './services';

const EventRevision = z.object({ revision: z.number().finite() });

export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';

export interface LiveSyncConnection {
  stop: () => void;
  refresh: () => void;
  reconnect: () => void;
  markSynced: () => void;
  goOffline: () => void;
}

function getErrorHttpStatus(error: unknown): number | undefined {
  if (error instanceof SyncHttpError) return error.status;
  if (
    error &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

const isOnline = () =>
  typeof navigator === 'undefined' || navigator.onLine !== false;

export function startLiveSync(
  onStatus: (status: LiveStatus) => void,
  onUnauthorized: () => void,
): LiveSyncConnection {
  let stopped = false;
  let connected = false;
  let syncing = false;
  let syncFailed = false;
  let hasSyncedOnce = false;
  let unauthorizedPaused = false;
  let dirty = false;
  let attempt = 0;
  let consecutiveFailures = 0;
  let syncEpoch = 0;
  let syncGeneration = 0;
  let controller: AbortController | undefined;
  let syncController: AbortController | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let retrySyncTimer: ReturnType<typeof setTimeout> | undefined;

  const status = (value: LiveStatus) => {
    if (!stopped) onStatus(value);
  };

  const emitHealthyStatus = () => {
    if (stopped) return;
    status(connected ? 'live' : 'polling');
  };

  const markSynced = () => {
    if (stopped) return;
    hasSyncedOnce = true;
    syncFailed = false;
    consecutiveFailures = 0;
    unauthorizedPaused = false;
    syncGeneration++;
    clearTimeout(retrySyncTimer);
    retrySyncTimer = undefined;
    emitHealthyStatus();
  };

  const synchronize = async (options?: { cancelPending?: boolean }) => {
    if (stopped) return;
    if (unauthorizedPaused && !options?.cancelPending) return;
    if (syncing) {
      if (!options?.cancelPending) return;
      syncEpoch++;
      syncController?.abort();
      syncController = undefined;
      syncing = false;
    }
    const epoch = ++syncEpoch;
    const startGeneration = syncGeneration;
    const activeSync = new AbortController();
    syncController = activeSync;
    syncing = true;
    dirty = false;
    clearTimeout(retrySyncTimer);
    retrySyncTimer = undefined;
    try {
      await syncAllSharedStateFromServer(true, activeSync.signal);
      if (stopped || epoch !== syncEpoch) return;
      hasSyncedOnce = true;
      syncFailed = false;
      consecutiveFailures = 0;
      unauthorizedPaused = false;
      emitHealthyStatus();
    } catch (error) {
      if (stopped || epoch !== syncEpoch) return;
      const httpStatus = getErrorHttpStatus(error);
      if (httpStatus === 401 || httpStatus === 403) {
        unauthorizedPaused = true;
        dirty = false;
        syncFailed = false;
        consecutiveFailures = 0;
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        controller?.abort();
        controller = undefined;
        connected = false;
        onUnauthorized();
        return;
      }
      if (startGeneration !== syncGeneration) {
        return;
      }
      syncFailed = true;
      consecutiveFailures += 1;
      if (!isOnline() || consecutiveFailures >= 2) {
        status('offline');
      } else {
        clearTimeout(retrySyncTimer);
        retrySyncTimer = setTimeout(() => {
          retrySyncTimer = undefined;
          void synchronize();
        }, 1200);
      }
    } finally {
      if (epoch === syncEpoch) {
        syncing = false;
        if (syncController === activeSync) syncController = undefined;
        if (dirty && !stopped && !unauthorizedPaused) refresh();
      }
    }
  };

  const refresh = () => {
    if (stopped || unauthorizedPaused) return;
    dirty = true;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void synchronize(), 75);
  };

  const connect = async () => {
    if (stopped || unauthorizedPaused) return;
    const active = new AbortController();
    controller = active;
    let idle = setTimeout(() => active.abort(), 15000);
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(() => active.abort(), 22000);
    };
    let sawHealthyFrame = false;
    try {
      const response = await fetch(apiUrl('/api/events'), {
        headers: getAuthenticatedRequestHeaders(),
        cache: 'no-store',
        signal: active.signal,
      });
      if (stopped || controller !== active) return;
      if ([401, 403].includes(response.status)) {
        unauthorizedPaused = true;
        dirty = false;
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
        onUnauthorized();
        return;
      }
      if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('text/event-stream') ||
        !response.body
      ) {
        throw new Error('Live stream unavailable');
      }
      connected = true;
      if (!syncFailed) {
        status('live');
      }
      if (!hasSyncedOnce || syncFailed) {
        refresh();
      }
      touch();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        while (!stopped && !active.signal.aborted) {
          const chunk = await reader.read();
          if (chunk.done) break;
          touch();
          buffer += decoder.decode(chunk.value, { stream: true });
          buffer = buffer.replace(/\r\n/g, '\n');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const lines = frame.split('\n');
            if (lines.some((line) => line.startsWith(':'))) {
              sawHealthyFrame = true;
              attempt = 0;
            }
            const data = lines
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trim())
              .join('\n');
            if (data) {
              try {
                const decoded = EventRevision.safeParse(
                  JSON.parse(data) as unknown,
                );
                if (decoded.success) {
                  sawHealthyFrame = true;
                  attempt = 0;
                  if (decoded.data.revision > getKnownServerRevision()) {
                    refresh();
                  }
                }
              } catch {
                // Ignore malformed SSE event payload
              }
            }
          }
          if (buffer.length > 8192) throw new Error('Invalid event stream');
        }
        if (sawHealthyFrame) attempt = 0;
      } finally {
        void reader.cancel().catch(() => {});
      }
    } catch {
      if (stopped || controller !== active) return;
      refresh();
    } finally {
      clearTimeout(idle);
      if (controller === active) {
        controller = undefined;
        connected = false;
        if (!stopped && !unauthorizedPaused) {
          const delay = Math.min(1000 * 2 ** attempt++, 30000);
          reconnectTimer = setTimeout(() => void connect(), delay);
        }
      }
    }
  };

  const fallback = setInterval(() => {
    if (stopped || unauthorizedPaused) return;
    if (!connected || syncFailed) refresh();
  }, 3000);

  const goOffline = () => {
    if (stopped) return;
    syncEpoch++;
    syncController?.abort();
    syncController = undefined;
    syncing = false;
    syncFailed = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    clearTimeout(retrySyncTimer);
    retrySyncTimer = undefined;
    controller?.abort();
    controller = undefined;
    connected = false;
    status('offline');
  };

  const reconnect = () => {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    clearTimeout(retrySyncTimer);
    retrySyncTimer = undefined;
    controller?.abort();
    controller = undefined;
    connected = false;
    unauthorizedPaused = false;
    attempt = 0;
    consecutiveFailures = 0;
    syncFailed = false;
    status('connecting');
    void synchronize({ cancelPending: true });
    void connect();
  };

  const stop = () => {
    stopped = true;
    syncEpoch++;
    clearInterval(fallback);
    clearTimeout(reconnectTimer);
    clearTimeout(refreshTimer);
    clearTimeout(retrySyncTimer);
    controller?.abort();
    controller = undefined;
    syncController?.abort();
    syncController = undefined;
  };

  status('connecting');
  void connect();
  return { stop, refresh, reconnect, markSynced, goOffline };
}
