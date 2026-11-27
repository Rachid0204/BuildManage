import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_LEGAL_FRAMEWORK,
  getActiveLegalFramework,
  resolveLegalFramework,
  setActiveLegalFramework,
  type LegalFrameworkConfig,
  type LegalFrameworkUpdateInput,
} from '../shared/legalFramework';
import { apiUrl } from '../utils/apiBase';
import { getAuthenticatedRequestHeaders } from '../utils/security';

export { getActiveLegalFramework, setActiveLegalFramework };

export interface LegalFrameworkResponse {
  ok: boolean;
  config: LegalFrameworkConfig;
  isCustomized: boolean;
}

export async function fetchLegalFramework(signal?: AbortSignal): Promise<LegalFrameworkResponse> {
  const response = await fetch(apiUrl('/api/legal-framework'), {
    headers: getAuthenticatedRequestHeaders(),
    signal,
    cache: 'no-store',
  });
  if (!response.ok) {
    return {
      ok: true,
      config: getActiveLegalFramework(),
      isCustomized: false,
    };
  }
  const data = await response.json();
  const resolved = resolveLegalFramework(data?.config);
  setActiveLegalFramework(resolved);
  return {
    ok: true,
    config: resolved,
    isCustomized: Boolean(data?.isCustomized),
  };
}

export async function updateAdminLegalFramework(
  input: LegalFrameworkUpdateInput,
): Promise<LegalFrameworkResponse> {
  const response = await fetch(apiUrl('/api/admin/legal-framework'), {
    method: 'PUT',
    headers: getAuthenticatedRequestHeaders(),
    body: JSON.stringify(input),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || 'Impossible de mettre à jour le cadre légal.');
  }
  const resolved = resolveLegalFramework(data.config);
  setActiveLegalFramework(resolved);
  return {
    ok: true,
    config: resolved,
    isCustomized: Boolean(data.isCustomized),
  };
}

export function useLegalFramework() {
  const query = useQuery<LegalFrameworkResponse>({
    queryKey: ['legalFramework'],
    queryFn: ({ signal }) => fetchLegalFramework(signal),
    staleTime: 60_000,
    placeholderData: (prev) =>
      prev ?? {
        ok: true,
        config: getActiveLegalFramework(),
        isCustomized: false,
      },
  });

  useEffect(() => {
    if (query.data?.config) {
      setActiveLegalFramework(query.data.config);
    }
  }, [query.data]);

  return {
    legal: query.data?.config || DEFAULT_LEGAL_FRAMEWORK,
    isCustomized: Boolean(query.data?.isCustomized),
    refetch: query.refetch,
  };
}
