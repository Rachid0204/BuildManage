import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../hooks/useI18n';
import { startLiveSync, type LiveStatus } from '../firebase/liveSync';

const directServerQuery = (query: { queryKey: readonly unknown[] }) =>
  ['financialReport', 'archivedBuildings', 'legalFramework'].includes(String(query.queryKey[0]));

export default function LiveDataSync() {
  const { userProfile, retrySession, sessionError } = useAuth();
  const queryClient = useQueryClient();
  const { tr } = useI18n();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const reconnectRef = useRef<() => void>(() => {});
  const scope = userProfile && [userProfile.uid, userProfile.role, userProfile.syndicId,
    userProfile.buildingId, userProfile.residentId, userProfile.prestataireId,
    userProfile.emailVerified, userProfile.mustChangePassword].join(':');
  useEffect(() => {
    if (!scope || userProfile?.emailVerified === false || userProfile?.mustChangePassword) {
      setStatus('connecting');
      return;
    }
    let active = true, queued = false;
    let connection: ReturnType<typeof startLiveSync> | undefined;
    const invalidSession = () => { void retrySession(); };
    const invalidate = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (active) {
          // Cache readers may be completing the very sync that emitted this event.
          // Independent HTTP reports must cancel older responses to avoid stale totals.
          void queryClient.invalidateQueries({ predicate: query => !directServerQuery(query) }, { cancelRefetch: false });
          void queryClient.invalidateQueries({ predicate: directServerQuery });
        }
      });
    };
    const resume = () => {
      if (!active) return;
      if (document.visibilityState === 'hidden') {
        connection?.stop(); connection = undefined;
        return;
      }
      if (!connection) connection = startLiveSync(setStatus, invalidSession);
      else connection.reconnect();
    };
    const onOffline = () => {
      if (!active) return;
      if (!connection) {
        setStatus('offline');
        return;
      }
      connection.goOffline();
    };
    const onFocus = () => {
      if (!active || document.visibilityState === 'hidden') return;
      if (!connection) connection = startLiveSync(setStatus, invalidSession);
      else connection.refresh();
    };
    const onSyncSucceeded = () => {
      if (!active) return;
      connection?.markSynced();
    };
    const onSessionRestored = () => {
      if (!active || document.visibilityState === 'hidden') return;
      if (!connection) connection = startLiveSync(setStatus, invalidSession);
      else connection.reconnect();
    };
    const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('syndik_realtime_sync');
    channel?.addEventListener('message', event => {
      if (event.data?.type === 'STATE_UPDATED') connection?.refresh();
    });
    reconnectRef.current = resume;
    window.addEventListener('syndik-state-updated', invalidate);
    window.addEventListener('syndik-sync-succeeded', onSyncSucceeded);
    window.addEventListener('syndik-session-invalid', invalidSession);
    window.addEventListener('syndik-session-restored', onSessionRestored);
    window.addEventListener('online', resume);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      active = false;
      connection?.stop(); channel?.close();
      reconnectRef.current = () => {};
      window.removeEventListener('syndik-state-updated', invalidate);
      window.removeEventListener('syndik-sync-succeeded', onSyncSucceeded);
      window.removeEventListener('syndik-session-invalid', invalidSession);
      window.removeEventListener('syndik-session-restored', onSessionRestored);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [scope, queryClient, retrySession]);
  if (!userProfile || (status !== 'offline' && !sessionError)) return null;
  return <div role="status" className="bg-amber-50 border-b border-amber-300 text-amber-950 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
    <span>{sessionError
      ? tr('Vérification de session indisponible. Vos données restent affichées. Reconnexion automatique…', 'التحقق من الجلسة غير متاح. تبقى بياناتك معروضة وستتم إعادة الاتصال تلقائياً…')
      : tr('Connexion interrompue. Vos données restent affichées. Reconnexion automatique…', 'انقطع الاتصال. تبقى بياناتك معروضة وستتم إعادة الاتصال تلقائياً…')}</span>
    <button className="underline font-semibold" onClick={() => sessionError ? void retrySession() : reconnectRef.current()}>{tr('Réessayer maintenant', 'أعد المحاولة الآن')}</button>
  </div>;
}
