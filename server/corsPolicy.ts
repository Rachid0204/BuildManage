import type { Request, Response, NextFunction } from 'express';

const CAPACITOR_ORIGINS = new Set<string>([
  'capacitor://localhost',
  'https://localhost',
  'http://localhost',
]);

function normalizeOrigin(raw: string): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  if (CAPACITOR_ORIGINS.has(trimmed)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function buildAllowedCorsOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const allowed = new Set<string>(['capacitor://localhost', 'https://localhost']);

  // Allow local dev origins only outside production
  if (env.NODE_ENV !== 'production') {
    allowed.add('http://localhost');
    allowed.add('http://localhost:3000');
    allowed.add('http://localhost:5173');
    allowed.add('http://127.0.0.1:3000');
  }

  const publicAppUrl = normalizeOrigin(env.PUBLIC_APP_URL || '');
  if (publicAppUrl) allowed.add(publicAppUrl);

  const extra = String(env.SYNDIK_CORS_ORIGINS || '')
    .split(',')
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));
  for (const origin of extra) allowed.add(origin);

  return allowed;
}

export function isAllowedCorsOrigin(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!origin) return false;
  return buildAllowedCorsOrigins(env).has(origin);
}

/**
 * Web-only origin allowlist for cookie-authenticated CSRF validation.
 * Explicitly excludes Capacitor native WebView origins (capacitor://localhost, https://localhost)
 * which must authenticate with Authorization: Bearer tokens instead of cookies.
 */
export function isAllowedWebOrigin(
  origin: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!origin) return false;
  const trimmed = origin.trim();
  if (!trimmed || trimmed === 'null') return false;
  const publicAppOrigin = normalizeOrigin(env.PUBLIC_APP_URL || '');
  if (trimmed === 'capacitor://localhost') return false;
  if (trimmed === 'https://localhost' && publicAppOrigin !== 'https://localhost') {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (env.NODE_ENV !== 'production') {
    if (
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
    ) {
      return true;
    }
  }

  if (parsed.protocol !== 'https:') return false;
  if (publicAppOrigin && parsed.origin === publicAppOrigin) return true;

  const extra = String(env.SYNDIK_CORS_ORIGINS || '')
    .split(',')
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));
  return extra.includes(parsed.origin);
}

/**
 * Strict, fail-closed CORS middleware for /api/* routes supporting Capacitor
 * native WebViews (capacitor://localhost, https://localhost) and configured
 * HTTPS frontend origins without ever echoing arbitrary origins.
 */
export function createApiCorsMiddleware(env: NodeJS.ProcessEnv = process.env) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;

    if (origin && isAllowedCorsOrigin(origin, env)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Authorization, Content-Type, Accept, X-Idempotency-Key, X-Syndik-Client-Platform, X-Syndik-CSRF, X-Syndik-Session-Transport, X-Syndik-Uid, X-Syndik-Role, X-Syndik-Sig, X-Syndik-Tenant, X-Syndik-Building',
      );
      res.setHeader('Access-Control-Max-Age', '600');
    }

    if (req.method === 'OPTIONS') {
      if (origin && !isAllowedCorsOrigin(origin, env)) {
        res.status(403).json({ ok: false, error: 'Origin not allowed' });
        return;
      }
      res.status(204).end();
      return;
    }

    next();
  };
}
