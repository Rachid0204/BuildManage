import type { Request, Response, NextFunction } from 'express';
import { isAllowedWebOrigin } from './corsPolicy';

export type SessionTransportMode = 'bearer-only' | 'dual' | 'cookie-web';
export type SessionCookieName = 'syndik_session' | '__session';

export const SESSION_COOKIE_MAX_AGE_MS = 12 * 3600 * 1000;

const PUBLIC_COOKIE_IGNORED_PATHS = new Set<string>([
  '/api/health',
  '/api/ready',
  '/api/csp-report',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/firebase-session',
  '/api/auth/recovery/request',
  '/api/auth/recovery/complete',
  '/api/webhooks/paypal',
  '/api/webhooks/cmi',
  '/api/subscription/cmi/return',
]);

export function resolveSessionTransportMode(
  env: NodeJS.ProcessEnv = process.env,
): SessionTransportMode {
  const raw = String(env.SESSION_TRANSPORT_MODE || '')
    .trim()
    .toLowerCase();
  if (raw === 'bearer-only') return 'bearer-only';
  if (raw === 'cookie-web') return 'cookie-web';
  return 'dual';
}

export function resolveSessionCookieName(
  env: NodeJS.ProcessEnv = process.env,
): SessionCookieName {
  const raw = String(env.SESSION_COOKIE_NAME || '').trim();
  if (raw === '__session') return '__session';
  return 'syndik_session';
}

export function getCanonicalRequestPath(req: Request): string {
  const rawUrl = req.originalUrl || `${req.baseUrl || ''}${req.path || ''}` || '/';
  const qIndex = rawUrl.indexOf('?');
  const pathname = qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl;
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

export function getSessionCookieOptions(env: NodeJS.ProcessEnv = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
  };
}

export function setSessionCookie(
  res: Response,
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  res.cookie(resolveSessionCookieName(env), token, {
    ...getSessionCookieOptions(env),
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
  });
}

export function clearSessionCookie(
  res: Response,
  env: NodeJS.ProcessEnv = process.env,
): void {
  res.clearCookie(resolveSessionCookieName(env), getSessionCookieOptions(env));
}

export function shouldOmitJsonSessionToken(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const mode = resolveSessionTransportMode(env);
  if (mode === 'bearer-only') return false;
  const requestedTransport = String(
    req.headers['x-syndik-session-transport'] || '',
  )
    .trim()
    .toLowerCase();
  if (requestedTransport === 'cookie') return true;
  if (mode === 'cookie-web') {
    const clientPlatform = String(
      req.headers['x-syndik-client-platform'] || '',
    )
      .trim()
      .toLowerCase();
    return clientPlatform !== 'android' && clientPlatform !== 'ios';
  }
  return false;
}

function readNamedCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      const rawValue = trimmed.slice(prefix.length).trim();
      if (!rawValue) return undefined;
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }
  }
  return undefined;
}

export interface ExtractedRequestCredential {
  source: 'bearer' | 'cookie';
  token: string;
}

/**
 * Extracts caller session credential with strict anti-fallback semantics:
 * 1. If an Authorization header is present, always return source='bearer' (never fall back
 *    to a cookie if the bearer token is malformed, expired, or invalid).
 * 2. Otherwise inspect the configured HttpOnly session cookie (only on GET /api/uploads/* in
 *    'bearer-only' rollback mode; on all authenticated /api/* endpoints in 'dual'/'cookie-web').
 */
export function extractRequestCredential(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): ExtractedRequestCredential | null {
  const rawAuth = typeof req.headers.authorization === 'string'
    ? req.headers.authorization.trim()
    : '';
  if (rawAuth) {
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(rawAuth);
    return {
      source: 'bearer',
      token: bearerMatch ? bearerMatch[1]!.trim() : rawAuth,
    };
  }

  const fullPath = getCanonicalRequestPath(req);
  if (
    PUBLIC_COOKIE_IGNORED_PATHS.has(fullPath) ||
    fullPath.startsWith('/api/jobs/')
  ) {
    return null;
  }

  const mode = resolveSessionTransportMode(env);
  const method = req.method.toUpperCase();
  const isDirectUploadGet =
    (method === 'GET' || method === 'HEAD') &&
    fullPath.startsWith('/api/uploads/');

  if (mode === 'bearer-only' && !isDirectUploadGet) {
    return null;
  }

  const cookieToken = readNamedCookie(
    typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined,
    resolveSessionCookieName(env),
  );
  if (!cookieToken) return null;

  return {
    source: 'cookie',
    token: cookieToken,
  };
}

/**
 * Normalizes credential material fed into identityRequestFingerprint so:
 * - Public pre-session endpoints (/api/auth/login, /api/auth/register, /api/auth/recovery/request)
 *   are unaffected by unrelated cookies.
 * - Authenticated identity mutations (/api/commands, /api/auth/change-password, /api/auth/logout)
 *   produce identical fingerprints for the same underlying session token regardless of whether
 *   unrelated cookies exist in req.headers.cookie or whether bearer vs cookie transport is used.
 */
export function canonicalAuthFingerprintInput(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fullPath = getCanonicalRequestPath(req);
  if (
    fullPath === '/api/auth/register' ||
    fullPath === '/api/auth/login' ||
    fullPath === '/api/auth/recovery/request'
  ) {
    return '';
  }
  const cred = extractRequestCredential(req, env);
  return cred?.token ? `Bearer ${cred.token}` : '';
}

export type CsrfCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

const SAFE_METHODS = new Set<string>(['GET', 'HEAD', 'OPTIONS']);

/**
 * Multi-layer CSRF validation for requests authenticating via the HttpOnly session cookie:
 * 1. Fetch Metadata (Sec-Fetch-Site): rejects 'cross-site' and 'same-site' (and 'none' except
 *    direct browser navigation on safe GET /api/uploads/:fileId).
 * 2. Custom header (X-Syndik-CSRF: 1): required on all cookie-authenticated API calls except
 *    direct browser navigation on safe GET /api/uploads/:fileId.
 * 3. Origin / Referer verification on state-changing requests (POST/PUT/PATCH/DELETE) against
 *    the web allowlist in server/corsPolicy.ts (explicitly rejecting Capacitor native origins
 *    and Origin: null).
 */
export function verifyCookieCsrf(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): CsrfCheckResult {
  const fullPath = getCanonicalRequestPath(req);
  const method = req.method.toUpperCase();
  const isSafe = SAFE_METHODS.has(method);
  const isDirectUploadGet =
    (method === 'GET' || method === 'HEAD') &&
    fullPath.startsWith('/api/uploads/');

  const rawFetchSite =
    typeof req.headers['sec-fetch-site'] === 'string'
      ? req.headers['sec-fetch-site'].trim().toLowerCase()
      : '';
  if (rawFetchSite) {
    const allowedFetchSite =
      rawFetchSite === 'same-origin' ||
      (isDirectUploadGet && rawFetchSite === 'none');
    if (!allowedFetchSite) {
      return { ok: false, reason: 'sec_fetch_site_rejected' };
    }
  }

  if (!isDirectUploadGet) {
    const csrfHeader =
      typeof req.headers['x-syndik-csrf'] === 'string'
        ? req.headers['x-syndik-csrf'].trim()
        : '';
    if (csrfHeader !== '1') {
      return { ok: false, reason: 'missing_csrf_header' };
    }
  }

  if (!isSafe) {
    const origin =
      typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (origin) {
      if (!isAllowedWebOrigin(origin, env)) {
        return { ok: false, reason: 'origin_not_allowed' };
      }
    } else {
      const referer =
        typeof req.headers.referer === 'string'
          ? req.headers.referer.trim()
          : '';
      if (referer) {
        let refererOrigin: string | undefined;
        try {
          refererOrigin = new URL(referer).origin;
        } catch {
          return { ok: false, reason: 'invalid_referer' };
        }
        if (!isAllowedWebOrigin(refererOrigin, env)) {
          return { ok: false, reason: 'referer_not_allowed' };
        }
      }
    }
  }

  return { ok: true };
}

/**
 * Pre-body, pre-transaction CSRF enforcement middleware for /api/* routes.
 * Rejects forged cross-site cookie requests with 403 CSRF_REJECTED before buffering
 * request bodies or touching the state repository.
 */
export function createSessionCsrfMiddleware(
  env: NodeJS.ProcessEnv = process.env,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method.toUpperCase() === 'OPTIONS') {
      next();
      return;
    }
    const cred = extractRequestCredential(req, env);
    if (cred?.source === 'cookie') {
      const check = verifyCookieCsrf(req, env);
      if (!check.ok) {
        res.status(403).json({
          ok: false,
          error: 'Requête cross-site refusée.',
          code: 'CSRF_REJECTED',
        });
        return;
      }
    }
    next();
  };
}
