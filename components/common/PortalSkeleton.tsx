import React from 'react';
import { useI18n } from '../../hooks/useI18n';
export default function PortalSkeleton() {
  const { tr } = useI18n();
  return <div role="status" aria-live="polite" aria-busy="true" className="min-h-screen bg-slate-50 p-4 md:p-8">
    <p className="sr-only">{tr('Chargement de votre espace…', 'جاري تحميل حسابك…')}</p>
    <div aria-hidden="true" className="max-w-7xl mx-auto space-y-6 motion-safe:animate-pulse">
      <div className="h-16 rounded-xl bg-slate-200" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{[1,2,3,4].map(i=><div key={i} className="h-28 rounded-xl bg-slate-200" />)}</div>
      <div className="min-h-[60vh] rounded-xl bg-white border border-slate-200" />
    </div>
  </div>;
}
