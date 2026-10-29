import { z } from 'zod';
const EventRevision = z.object({ revision: z.number().finite() });
import { getAuthenticatedRequestHeaders } from '../utils/security';
import { getKnownServerRevision, syncAllSharedStateFromServer } from './services';

export type LiveStatus = 'connecting' | 'live' | 'polling' | 'offline';

export function startLiveSync(onStatus: (status: LiveStatus) => void, onUnauthorized: () => void) {
  let stopped = false, connected = false, syncing = false, syncFailed = false, dirty = false, attempt = 0;
  let controller: AbortController | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const status = (value: LiveStatus) => { if (!stopped) onStatus(value); };
  const synchronize = async () => {
    if (stopped || syncing || navigator.onLine === false) return;
    syncing = true;
    dirty = false;
    try {
      await syncAllSharedStateFromServer(true);
      syncFailed = false;
      status(connected ? 'live' : 'polling');
    } catch { syncFailed = true; status('offline'); }
    finally {
      syncing = false;
      if (dirty && !stopped) refresh();
    }
  };
  const refresh = () => {
    if (stopped) return;
    dirty = true;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void synchronize(), 75);
  };
  const connect = async () => {
    if (stopped || navigator.onLine === false) { status('offline'); return; }
    const active = new AbortController();
    controller = active;
    let idle = setTimeout(() => active.abort(), 15000);
    const touch = () => { clearTimeout(idle); idle = setTimeout(() => active.abort(), 35000); };
    try {
      const response = await fetch('/api/events', { headers: getAuthenticatedRequestHeaders(),
        cache: 'no-store', signal: active.signal });
      if ([401, 403].includes(response.status)) { onUnauthorized(); return; }
      if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
        throw new Error('Live stream unavailable');
      connected = true;
      status('live');
      refresh();
      touch();
      const reader = response.body.getReader(), decoder = new TextDecoder();
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
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
            if (data) {
              const decoded = EventRevision.safeParse(JSON.parse(data) as unknown);
              if (decoded.success) {
                const value = decoded.data;
                attempt = 0;
                if (value.revision > getKnownServerRevision()) refresh();
              }
            }
          }
          if (buffer.length > 8192) throw new Error('Invalid event stream');
        }
      } finally { void reader.cancel().catch(() => {}); }
    } catch {
      if (!stopped) refresh();
    } finally {
      clearTimeout(idle);
      if (controller === active) {
        controller = undefined;
        connected = false;
        if (!stopped) reconnectTimer = setTimeout(() => void connect(), Math.min(1000 * 2 ** attempt++, 30000));
      }
    }
  };
  const fallback = setInterval(() => { if (!connected || syncFailed) refresh(); }, 3000);
  const reconnect = () => {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    controller?.abort();
    controller = undefined;
    connected = false;
    refresh();
    void connect();
  };
  const stop = () => {
    stopped = true;
    clearInterval(fallback); clearTimeout(reconnectTimer); clearTimeout(refreshTimer);
    controller?.abort();
  };
  status('connecting');
  void connect();
  return { stop, refresh, reconnect };
}

