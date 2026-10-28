import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuthenticatedRequestHeaders } from '../../utils/security';
import type { Building } from '../../types';

export default function BillingFailures({ building }: { building: Building }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState('');
  const query = useQuery({
    queryKey: ['billing-runs', building.syndicId, building.id],
    queryFn: async () => {
      const params = new URLSearchParams({ syndicId: building.syndicId, buildingId: building.id });
      const response = await fetch(`/api/billing-runs?${params}`, { headers: getAuthenticatedRequestHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chargement des échecs impossible.');
      return data.runs as Array<{ id: string; period: string; startedAt: string; resolved: boolean;
        results: Array<{ reason: string; retryable: boolean; attempts: number }> }>;
    },
  });
  async function retry(runId: string) {
    setBusy(runId); setMessage('');
    try {
      const response = await fetch('/api/billing-runs/retry', { method: 'POST', headers: getAuthenticatedRequestHeaders(),
        body: JSON.stringify({ runId, syndicId: building.syndicId, buildingId: building.id }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.results?.find((r: any) => r.status === 'failed')?.reason || data.error || 'La relance a échoué.');
      setMessage('Relance terminée. Les charges déjà émises sont conservées.');
    } catch (error: any) { setMessage(error.message); }
    finally { setBusy(undefined); await client.invalidateQueries(); }
  }
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data?.length) return null;
  return <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
    <h2 className="font-semibold">Historique des échecs de facturation mensuelle</h2>
    {message && <p role="status">{message}</p>}
    {query.data.map(run => <div key={run.id} className="border-t border-amber-200 pt-2">
      <p><strong>{run.period}</strong> · {new Date(run.startedAt).toLocaleString('fr-FR')}</p>
      <p>{run.results[0].reason} ({run.results[0].attempts} tentative(s))</p>
      {run.resolved ? <p>Résolu</p> : <>
        <p className="text-sm">{run.results[0].retryable ? 'Incident technique : relance possible.' : 'Corrigez la configuration indiquée avant de relancer.'}</p>
        <button type="button" className="mt-2 rounded bg-slate-900 text-white px-3 py-2 disabled:opacity-50"
          disabled={Boolean(busy)} onClick={() => void retry(run.id)}>
          {busy === run.id ? 'Relance en cours…' : 'Relancer cet immeuble'}
        </button>
      </>}
    </div>)}
  </section>;
}
