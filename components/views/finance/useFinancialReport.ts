import { useQuery } from '@tanstack/react-query';
import type { Apartment, Prestataire, Resident, Transaction } from '../../../types';
import { getAuthenticatedRequestHeaders } from '../../../utils/security';
import { apiUrl } from '../../../utils/apiBase';
import { saveOrShareBlob } from '../../../utils/nativeBridge';
import type { ResidentStatementRow } from './financeReportExport';

export interface ClosedPeriodMeta {
  closedAt?: string;
  actorUid?: string;
  reason?: string;
}

export interface BuildingFinancialReport {
  building: { id: string; name: string };
  statements: ResidentStatementRow[];
  ledger: Transaction[];
  closedPeriods: Record<string, ClosedPeriodMeta>;
  archives?: {
    apartments?: Apartment[];
    residents?: Resident[];
    prestataires?: Prestataire[];
  };
}

export function downloadTextFile(name: string, content: string, mimeType = 'text/csv;charset=utf-8') {
  void saveOrShareBlob(new Blob([content], { type: mimeType }), name, name);
}

export async function fetchBuildingFinancialReport(
  buildingId: string,
  signal?: AbortSignal,
): Promise<BuildingFinancialReport> {
  const response = await fetch(
    apiUrl(`/api/reports?buildingId=${encodeURIComponent(buildingId)}`),
    {
      headers: getAuthenticatedRequestHeaders(),
      signal,
      cache: 'no-store',
    },
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || 'Impossible de charger le rapport financier.');
  }
  return data as BuildingFinancialReport;
}

export function useFinancialReport(buildingId: string) {
  return useQuery({
    queryKey: ['financialReport', buildingId],
    queryFn: ({ signal }) => fetchBuildingFinancialReport(buildingId, signal),
  });
}
