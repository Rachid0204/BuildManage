import type { Express, Request } from 'express';
import { randomUUID } from 'node:crypto';
import type { State, StateRepository } from './repository';

// Stream revision numbers only. Business records are always fetched through the
// authenticated, tenant-filtered state endpoint, including after reconnecting.
export function registerLiveUpdates(app: Express, repository: StateRepository,
  authenticate: (request: Request, state: State) => Promise<unknown>) {
  app.get('/api/events', async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    try {
      const caller = await repository.transaction(state => authenticate(req, state));
      if (res.destroyed) return;
      if (!caller) { res.status(401).json({ error: 'Authentification requise.' }); return; }
      if (!repository.watchRevision) { res.status(503).json({ error: 'Synchronisation en direct indisponible.' }); return; }
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      let lastRevision = -1, stopped = false;
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(heartbeat); clearTimeout(expiry);
        unsubscribe?.();
        res.end();
      };
      res.on('close', stop);
      unsubscribe = repository.watchRevision(revision => {
        if (stopped || revision <= lastRevision) return;
        lastRevision = revision;
        if (!res.write(`event: revision\ndata: ${JSON.stringify({ revision })}\n\n`)) stop();
      }, () => stop());
      // Reconnect periodically to recheck account/session validity across instances.
      heartbeat = setInterval(() => { if (!stopped) res.write(': heartbeat\n\n'); }, 15000);
      expiry = setTimeout(stop, 60000);
      if (stopped) { unsubscribe(); clearInterval(heartbeat); clearTimeout(expiry); }
    } catch (error: any) {
      console.error(JSON.stringify({ event: 'realtime_unavailable', requestId, code: error.code || 'UNAVAILABLE' }));
      if (!res.headersSent) res.status(error.status || 503).json({ error: 'Connexion en direct indisponible.', requestId });
      else res.end();
    }
  });
}
