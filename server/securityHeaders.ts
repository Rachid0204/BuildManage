import type { Request, RequestHandler, Response } from 'express';
import firebaseAppletConfig from '../firebase-applet-config.json' with { type: 'json' };

export type CspMode = 'report-only' | 'enforce';

export const HSTS_HEADER_VALUE = 'max-age=15552000; includeSubDomains';

/**
 * CameraCaptureModal.tsx uses navigator.mediaDevices.getUserMedia({ video: ..., audio: false })
 * on same-origin web pages; all other sensitive browser capabilities are disabled, and the
 * Payment Request API is scoped strictly to self + PayPal checkout frames.
 */
export const PERMISSIONS_POLICY_VALUE =
  'camera=(self), microphone=(), geolocation=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=(), payment=(self "https://www.paypal.com" "https://www.sandbox.paypal.com")';

/**
 * same-origin-allow-popups isolates top-level browsing context from cross-origin openers
 * while preserving window.opener for popups opened by the app itself:
 * - Firebase Google Sign-In (signInWithPopup in contexts/AuthContext.tsx)
 * - PayPal Checkout & 3D-Secure popups (zoid popup bridge in SubscriptionRenewalModal.tsx)
 */
export const COOP_HEADER_VALUE = 'same-origin-allow-popups';

export function resolveCspMode(env: NodeJS.ProcessEnv = process.env): CspMode {
  const raw = String(env.CSP_MODE || '').trim().toLowerCase();
  return raw === 'enforce' ? 'enforce' : 'report-only';
}

export function cspHeaderName(mode: CspMode): 'Content-Security-Policy' | 'Content-Security-Policy-Report-Only' {
  return mode === 'enforce'
    ? 'Content-Security-Policy'
    : 'Content-Security-Policy-Report-Only';
}

function normalizeHttpsOrigin(raw: string | undefined): string | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizeHttpsHostOrigin(rawHost: string | undefined): string | null {
  const trimmed = String(rawHost || '').trim().toLowerCase();
  if (!trimmed || !/^[a-z0-9.-]+$/.test(trimmed)) return null;
  return `https://${trimmed}`;
}

function uniqueTokens(tokens: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tokens) {
    const token = String(raw || '').trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Builds the Content-Security-Policy from the verified codebase and dist/ origin inventory:
 * - dist/index.html has zero inline <script> blocks -> script-src has NO 'unsafe-inline' or 'unsafe-eval'.
 * - style-src retains 'unsafe-inline' solely because React runtime style={{ ... }} attributes across
 *   UI/chart components, jsPDF/html2canvas DOM measurements, and the PayPal JS SDK inject inline
 *   styles and <style> elements without nonces.
 */
export function buildContentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): string {
  const defaultAuthOrigin = normalizeHttpsHostOrigin(firebaseAppletConfig.authDomain);
  const envAuthOrigin = normalizeHttpsHostOrigin(env.VITE_FIREBASE_AUTH_DOMAIN);
  const defaultBucketHost = normalizeHttpsHostOrigin(firebaseAppletConfig.storageBucket);
  const envBucketHost = normalizeHttpsHostOrigin(env.VITE_FIREBASE_STORAGE_BUCKET);
  const publicAppOrigin = normalizeHttpsOrigin(env.PUBLIC_APP_URL);
  const extraCorsOrigins = String(env.SYNDIK_CORS_ORIGINS || '')
    .split(',')
    .map((entry) => normalizeHttpsOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));

  const nonProdLocalConnect =
    env.NODE_ENV !== 'production'
      ? [
          'http://127.0.0.1:*',
          'http://localhost:*',
          'ws://127.0.0.1:*',
          'ws://localhost:*',
        ]
      : [];

  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'self'"]],
    [
      'script-src',
      uniqueTokens([
        "'self'",
        'https://www.paypal.com',
        'https://www.sandbox.paypal.com',
        'https://*.paypalobjects.com',
        'https://apis.google.com',
        'https://www.google.com',
        'https://www.gstatic.com',
      ]),
    ],
    [
      'style-src',
      uniqueTokens([
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com',
      ]),
    ],
    [
      'font-src',
      uniqueTokens([
        "'self'",
        'data:',
        'https://fonts.gstatic.com',
      ]),
    ],
    [
      'img-src',
      uniqueTokens([
        "'self'",
        'data:',
        'blob:',
        'https://images.unsplash.com',
        'https://*.paypal.com',
        'https://*.paypalobjects.com',
        'https://*.googleusercontent.com',
        'https://www.gstatic.com',
      ]),
    ],
    [
      'connect-src',
      uniqueTokens([
        "'self'",
        publicAppOrigin,
        ...extraCorsOrigins,
        'https://identitytoolkit.googleapis.com',
        'https://securetoken.googleapis.com',
        'https://www.googleapis.com',
        'https://apis.google.com',
        'https://firebaseinstallations.googleapis.com',
        defaultAuthOrigin,
        envAuthOrigin,
        defaultBucketHost,
        envBucketHost,
        'https://firebasestorage.googleapis.com',
        'https://www.paypal.com',
        'https://www.sandbox.paypal.com',
        'https://api.paypal.com',
        'https://api-m.paypal.com',
        'https://api.sandbox.paypal.com',
        'https://api-m.sandbox.paypal.com',
        'https://*.paypal.com',
        'https://*.paypalobjects.com',
        ...nonProdLocalConnect,
      ]),
    ],
    [
      'frame-src',
      uniqueTokens([
        "'self'",
        'https://www.paypal.com',
        'https://www.sandbox.paypal.com',
        'https://*.paypal.com',
        defaultAuthOrigin,
        envAuthOrigin,
        'https://accounts.google.com',
        'https://apis.google.com',
        'https://www.google.com',
      ]),
    ],
    [
      'form-action',
      uniqueTokens([
        "'self'",
        'https://payment.cmi.co.ma',
        'https://testpayment.cmi.co.ma',
        'https://www.paypal.com',
        'https://www.sandbox.paypal.com',
      ]),
    ],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['report-uri', ['/api/csp-report']],
  ];

  return directives
    .map(([name, values]) => (values.length > 0 ? `${name} ${values.join(' ')}` : name))
    .join('; ');
}

export function parseContentSecurityPolicy(raw: string): Map<string, string[]> {
  if (typeof raw !== 'string' || raw.trim().length === 0 || /[\r\n\0]/.test(raw)) {
    throw new Error('CSP header must be a non-empty single-line string');
  }
  const directives = new Map<string, string[]>();
  const parts = raw
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new Error('CSP header contains no directives');
  }
  for (const part of parts) {
    const tokens = part.split(/\s+/).filter(Boolean);
    const name = tokens[0]?.toLowerCase();
    if (!name || !/^[a-z0-9-]+$/.test(name)) {
      throw new Error(`Invalid CSP directive name in segment: ${part}`);
    }
    if (directives.has(name)) {
      throw new Error(`Duplicate CSP directive: ${name}`);
    }
    directives.set(name, tokens.slice(1));
  }
  return directives;
}

export function applyCommonSecurityHeaders(res: Response): void {
  res.setHeader('Strict-Transport-Security', HSTS_HEADER_VALUE);
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY_VALUE);
  res.setHeader('Cross-Origin-Opener-Policy', COOP_HEADER_VALUE);
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export function applyHtmlShellHeaders(
  res: Response,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const mode = resolveCspMode(env);
  const policy = buildContentSecurityPolicy(env);
  res.setHeader('Cache-Control', 'no-cache');
  applyCommonSecurityHeaders(res);
  res.setHeader(cspHeaderName(mode), policy);
}

/**
 * Sets common browser security headers on API and HTML responses while preserving
 * stricter route-specific headers (such as private download sandbox CSP).
 */
export function createSecurityHeadersMiddleware(
  env: NodeJS.ProcessEnv = process.env,
): RequestHandler {
  const mode = resolveCspMode(env);
  const headerName = cspHeaderName(mode);
  const policy = buildContentSecurityPolicy(env);

  return (req: Request, res: Response, next) => {
    if (req.path.startsWith('/api/')) {
      applyCommonSecurityHeaders(res);
      next();
      return;
    }

    // Ensure any HTML response (including Vite dev middleware or error pages) carries
    // both the common security headers and the configured CSP header.
    const origSetHeader = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: number | string | readonly string[]) => {
      const result = origSetHeader(name, value);
      if (
        name.toLowerCase() === 'content-type' &&
        typeof value === 'string' &&
        value.toLowerCase().includes('text/html')
      ) {
        applyCommonSecurityHeaders(res);
        if (!res.getHeader('Content-Security-Policy') && !res.getHeader('Content-Security-Policy-Report-Only')) {
          origSetHeader(headerName, policy);
        }
      }
      return result;
    }) as typeof res.setHeader;

    next();
  };
}

function cleanShortString(value: unknown, maxLen = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!cleaned) return undefined;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

/**
 * Strips query parameters, fragments, and credentials from reported URIs so tokens,
 * recovery links, or user identifiers can never be written into Cloud Logging.
 */
export function sanitizeCspReportUri(value: unknown): string | undefined {
  const cleaned = cleanShortString(value, 500);
  if (!cleaned) return undefined;
  if (/^[a-z-]+$/i.test(cleaned)) {
    return cleaned.slice(0, 64);
  }
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.origin}${parsed.pathname}`.slice(0, 200);
    }
    return `${parsed.protocol}${parsed.pathname}`.slice(0, 120);
  } catch {
    return cleaned.split(/[?#]/)[0].slice(0, 200) || undefined;
  }
}

function cleanPortOrLine(value: unknown): number | undefined {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(num) || num < 0 || num > 1_000_000) return undefined;
  return num;
}

function extractViolationBody(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload)) {
    const first = payload.find(
      (item) => item && typeof item === 'object' && !Array.isArray(item),
    ) as Record<string, unknown> | undefined;
    if (!first) return null;
    if (first.body && typeof first.body === 'object' && !Array.isArray(first.body)) {
      return {
        ...first.body,
        ...(typeof first.url === 'string' && !('documentURL' in (first.body as object))
          ? { documentURL: first.url }
          : {}),
      } as Record<string, unknown>;
    }
    return first;
  }
  const obj = payload as Record<string, unknown>;
  if (obj['csp-report'] && typeof obj['csp-report'] === 'object' && !Array.isArray(obj['csp-report'])) {
    return obj['csp-report'] as Record<string, unknown>;
  }
  if (obj.body && typeof obj.body === 'object' && !Array.isArray(obj.body)) {
    return obj.body as Record<string, unknown>;
  }
  return obj;
}

/**
 * Handles POST /api/csp-report without touching any database or shared state:
 * validates and sanitizes the browser report, emits exactly one structured JSON line
 * on stderr for Cloud Logging, and responds 204 No Content.
 */
export function createCspReportHandler(
  env: NodeJS.ProcessEnv = process.env,
): RequestHandler {
  return (req: Request, res: Response) => {
    const report = extractViolationBody(req.body);
    if (!report) {
      res.status(400).json({ ok: false, error: 'Invalid CSP report payload' });
      return;
    }

    const mode = resolveCspMode(env);
    const documentUri = sanitizeCspReportUri(
      report['document-uri'] ?? report.documentURL ?? report.documentUri,
    );
    const blockedUri = sanitizeCspReportUri(
      report['blocked-uri'] ?? report.blockedURL ?? report.blockedUri,
    );
    const violatedDirective = cleanShortString(
      report['violated-directive'] ?? report.violatedDirective,
      80,
    );
    const effectiveDirective = cleanShortString(
      report['effective-directive'] ?? report.effectiveDirective ?? violatedDirective,
      80,
    );
    const disposition = cleanShortString(report.disposition, 32);
    const sourceFile = sanitizeCspReportUri(
      report['source-file'] ?? report.sourceFile,
    );
    const statusCode = cleanPortOrLine(report['status-code'] ?? report.statusCode);
    const lineNumber = cleanPortOrLine(report['line-number'] ?? report.lineNumber);
    const columnNumber = cleanPortOrLine(report['column-number'] ?? report.columnNumber);

    const logEntry = {
      severity: 'WARNING',
      event: 'csp_violation_report',
      mode,
      ...(documentUri ? { documentUri } : {}),
      ...(blockedUri ? { blockedUri } : {}),
      ...(violatedDirective ? { violatedDirective } : {}),
      ...(effectiveDirective ? { effectiveDirective } : {}),
      ...(disposition ? { disposition } : {}),
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(sourceFile ? { sourceFile } : {}),
      ...(lineNumber !== undefined ? { lineNumber } : {}),
      ...(columnNumber !== undefined ? { columnNumber } : {}),
    };

    console.warn(JSON.stringify(logEntry));
    res.status(204).end();
  };
}
