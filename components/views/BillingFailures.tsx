import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuthenticatedRequestHeaders } from '../../utils/security';
import { useI18n } from '../../hooks/useI18n';
import type { Building } from '../../types';

export default function BillingFailures({ building }: { building: Building }) {
  const client = useQueryClient();
  const { tr, isAr } = useI18n();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['billing-runs', building.syndicId, building.id],
    queryFn: async () => {
      const params = new URLSearchParams({ syndicId: building.syndicId, buildingId: building.id });
      const response = await fetch(`/api/billing-runs?${params}`, { headers: getAuthenticatedRequestHeaders() });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || tr('Chargement des échecs impossible.', 'تعذر تحميل سجل الإخفاقات.'));
      return data.runs as Array<{ id: string; period: string; startedAt: string; resolved: boolean;
        results?: Array<{ reason?: string; retryable?: boolean; attempts?: number }> }>;
    },
  });
  async function retry(runId: string) {
    setBusy(runId); setMessage('');
    try {
      const response = await fetch('/api/billing-runs/retry', { method: 'POST', headers: getAuthenticatedRequestHeaders(),
        body: JSON.stringify({ runId, syndicId: building.syndicId, buildingId: building.id }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.results?.find((r: any) => r.status === 'failed')?.reason || data.error || tr('La relance a échoué.', 'فشلت إعادة المحاولة.'));
      setMessage(tr('Relance terminée. Les charges déjà émises sont conservées.', 'انتهت إعادة المحاولة. تم الاحتفاظ بالمساهمات الصادرة مسبقاً.'));
    } catch (error: any) { setMessage(error.message); }
    finally { setBusy(undefined); await client.invalidateQueries(); }
  }
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data?.length) return null;
  return <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
    <h2 className="font-semibold">{tr('Historique des échecs de facturation mensuelle', 'سجل إخفاقات الفوترة الشهرية')}</h2>
    {message && <p role="status">{message}</p>}
    {query.data.map(run => {
      const firstResult = run.results?.[0];
      return (
        <div key={run.id} className="border-t border-amber-200 pt-2">
          <p><strong>{run.period}</strong> · {new Date(run.startedAt).toLocaleString(isAr ? 'ar-MA' : 'fr-FR')}</p>
          {firstResult && (
            <p>{firstResult.reason || tr('Échec de facturation', 'فشل الفوترة')} ({firstResult.attempts ?? 1} {tr('tentative(s)', 'محاولة')})</p>
          )}
          {run.resolved ? <p>{tr('Résolu', 'تم الحل')}</p> : <>
            <p className="text-sm">
              {firstResult?.retryable
                ? tr('Incident technique : relance possible.', 'عطل تقني: يمكن إعادة المحاولة.')
                : tr('Corrigez la configuration indiquée avant de relancer.', 'صحح الإعدادات المشار إليها قبل إعادة المحاولة.')}
            </p>
            <button type="button" className="mt-2 rounded bg-slate-900 text-white px-3 py-2 disabled:opacity-50"
              disabled={Boolean(busy)} onClick={() => void retry(run.id)}>
              {busy === run.id ? tr('Relance en cours…', 'جاري إعادة المحاولة…') : tr('Relancer cet immeuble', 'إعادة المحاولة لهذه العمارة')}
            </button>
          </>}
        </div>
      );
    })}
  </section>;
}
