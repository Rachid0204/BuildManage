// Canonical API and asset URL resolver.
// On web / Cloud Run same-origin deployments, VITE_API_BASE_URL is empty and all
// requests stay relative ("/api/..."). On Capacitor native mobile builds (Android/iOS),
// VITE_API_BASE_URL points to the HTTPS production backend (e.g. "https://immogest.cloud.run").

const metaEnv =
  (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env || {};

function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

export function getApiBaseUrl(): string {
  const fromVite = normalizeBaseUrl(metaEnv.VITE_API_BASE_URL);
  if (fromVite) return fromVite;
  if (typeof window !== 'undefined') {
    const runtimeOverride = (
      window as Window & { __SYNDIK_API_BASE_URL__?: string }
    ).__SYNDIK_API_BASE_URL__;
    const fromWindow = normalizeBaseUrl(runtimeOverride);
    if (fromWindow) return fromWindow;
  }
  return '';
}

export function apiUrl(path: string): string {
  if (!path) return getApiBaseUrl();
  if (/^https?:\/\//i.test(path) || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function resolveAssetUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('/api/')) return apiUrl(url);
  return url;
}
