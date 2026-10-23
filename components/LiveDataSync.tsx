import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../hooks/useI18n';
import { startLiveSync, type LiveStatus } from '../firebase/liveSync';

export default function LiveDataSync() {
  const { userProfile, retrySession } = useAuth();
  const queryClient = useQueryClient();
  const { tr } = useI18n();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const reconnectRef = useRef<() => void>(() => {});
  const scope = userProfile && [userProfile.uid, userProfile.role, userProfile.syndicId,
    userProfile.buildingId, userProfile.residentId, userProfile.prestataireId,
    userProfile.emailVerified, userProfile.mustChangePassword].join(':');
  useEffect(() => {
    if (!scope || userProfile?.emailVerified === false || userProfile?.mustChangePassword) return;
    let active = true, queued = false;
    let connection: ReturnType<typeof startLiveSync> | undefined;
    const invalidSession = () => { void retrySession(); };
    const invalidate = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (active) void queryClient.invalidateQueries({}, { cancelRefetch: false });
      });
    };
    const resume = () => {
      if (!active) return;
      if (document.visibilityState === 'hidden' || navigator.onLine === false) {
        connection?.stop(); connection = undefined;
        if (navigator.onLine === false) setStatus('offline');
        return;
      }
      if (!connection) connection = startLiveSync(setStatus, invalidSession);
      else connection.reconnect();
    };
    const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('syndik_realtime_sync');
    channel?.addEventListener('message', event => {
      if (event.data?.type === 'STATE_UPDATED') connection?.refresh();
    });
    reconnectRef.current = resume;
    window.addEventListener('syndik-state-updated', invalidate);
    window.addEventListener('syndik-session-invalid', invalidSession);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    resume();
    return () => {
      active = false;
      connection?.stop(); channel?.close();
      reconnectRef.current = () => {};
      window.removeEventListener('syndik-state-updated', invalidate);
      window.removeEventListener('syndik-session-invalid', invalidSession);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', resume);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [scope, queryClient, retrySession]);
  if (!userProfile || status !== 'offline') return null;
  return <div role="status" className="bg-amber-50 border-b border-amber-300 text-amber-950 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm">
    <span>{tr('Connexion interrompue. Vos données restent affichées. Reconnexion automatique…', 'انقطع الاتصال. تبقى بياناتك معروضة وستتم إعادة الاتصال تلقائياً…')}</span>
    <button className="underline font-semibold" onClick={() => reconnectRef.current()}>{tr('Réessayer maintenant', 'أعد المحاولة الآن')}</button>
  </div>;
}
