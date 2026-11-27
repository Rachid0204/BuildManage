import { createHash } from 'node:crypto';
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';

const MINUTE = 60_000;
const DEFAULT_MAX_ENTRIES = 10_000;

export function normalizedClientIp(req: Request): string {
  const raw = (req.ip || req.socket?.remoteAddress || 'unknown').trim();
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface WindowBucket {
  timestamps: number[];
  expiresAt: number;
}

/**
 * Bounded in-memory sliding-window tracker.
 * Stores only SHA-256 digests and evicts expired / oldest keys in O(1) amortized time.
 */
export class BoundedSlidingWindow {
  private readonly buckets = new Map<string, WindowBucket>();

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  private pruneKey(key: string, windowMs: number, now: number): WindowBucket | undefined {
    const existing = this.buckets.get(key);
    if (!existing) return undefined;
    if (existing.expiresAt <= now) {
      this.buckets.delete(key);
      return undefined;
    }
    const cutoff = now - windowMs;
    if (existing.timestamps.length && existing.timestamps[0] <= cutoff) {
      existing.timestamps = existing.timestamps.filter((t) => t > cutoff);
    }
    if (!existing.timestamps.length) {
      this.buckets.delete(key);
      return undefined;
    }
    return existing;
  }

  private ensureCapacity(now: number): void {
    if (this.buckets.size < this.maxEntries) return;
    for (const [k, v] of this.buckets) {
      if (v.expiresAt <= now) this.buckets.delete(k);
      if (this.buckets.size < this.maxEntries) return;
    }
    while (this.buckets.size >= this.maxEntries) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }

  count(rawKey: string, windowMs: number, now = Date.now()): { count: number; retryAfter: number } {
    const key = sha256(rawKey);
    const bucket = this.pruneKey(key, windowMs, now);
    if (!bucket) return { count: 0, retryAfter: 0 };
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { count: bucket.timestamps.length, retryAfter };
  }

  record(rawKey: string, windowMs: number, now = Date.now()): number {
    const key = sha256(rawKey);
    const existing = this.pruneKey(key, windowMs, now);
    if (existing) {
      existing.timestamps.push(now);
      existing.expiresAt = now + windowMs;
      // Refresh LRU insertion order
      this.buckets.delete(key);
      this.buckets.set(key, existing);
      return existing.timestamps.length;
    }
    this.ensureCapacity(now);
    this.buckets.set(key, { timestamps: [now], expiresAt: now + windowMs });
    return 1;
  }

  consume(
    rawKey: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): { allowed: boolean; retryAfter: number } {
    const status = this.count(rawKey, windowMs, now);
    if (status.count >= limit) {
      return { allowed: false, retryAfter: status.retryAfter };
    }
    this.record(rawKey, windowMs, now);
    return { allowed: true, retryAfter: 0 };
  }

  clear(rawKey: string): void {
    this.buckets.delete(sha256(rawKey));
  }
}

interface RouteLimitRule {
  method: 'GET' | 'POST';
  bucket: string;
  limit: number;
  windowMs: number;
  code: 'AUTH_RATE_LIMITED' | 'RATE_LIMITED';
}

const UNAUTHENTICATED_ROUTE_RULES: Readonly<Record<string, RouteLimitRule>> = {
  'GET /api/ready': { method: 'GET', bucket: 'ready', limit: 60, windowMs: MINUTE, code: 'RATE_LIMITED' },
  'GET /api/legal-framework': { method: 'GET', bucket: 'legal-framework', limit: 120, windowMs: MINUTE, code: 'RATE_LIMITED' },
  'POST /api/auth/login': { method: 'POST', bucket: 'login', limit: 120, windowMs: MINUTE, code: 'AUTH_RATE_LIMITED' },
  'POST /api/auth/recovery/request': { method: 'POST', bucket: 'recovery', limit: 10, windowMs: 15 * MINUTE, code: 'AUTH_RATE_LIMITED' },
  'POST /api/auth/recovery/complete': { method: 'POST', bucket: 'recovery', limit: 10, windowMs: 15 * MINUTE, code: 'AUTH_RATE_LIMITED' },
  'POST /api/auth/firebase-session': { method: 'POST', bucket: 'firebase-session', limit: 30, windowMs: 15 * MINUTE, code: 'AUTH_RATE_LIMITED' },
  'POST /api/auth/register': { method: 'POST', bucket: 'register-ip-pre', limit: 30, windowMs: 15 * MINUTE, code: 'AUTH_RATE_LIMITED' },
  'POST /api/auth/verification/request': { method: 'POST', bucket: 'verify-ip-pre', limit: 30, windowMs: 15 * MINUTE, code: 'AUTH_RATE_LIMITED' },
  'POST /api/webhooks/paypal': { method: 'POST', bucket: 'webhook-paypal', limit: 60, windowMs: MINUTE, code: 'RATE_LIMITED' },
  'POST /api/webhooks/cmi': { method: 'POST', bucket: 'webhook-cmi', limit: 60, windowMs: MINUTE, code: 'RATE_LIMITED' },
  'POST /api/subscription/cmi/return': { method: 'POST', bucket: 'cmi-return', limit: 60, windowMs: MINUTE, code: 'RATE_LIMITED' },
  'POST /api/csp-report': { method: 'POST', bucket: 'csp-report', limit: 30, windowMs: MINUTE, code: 'RATE_LIMITED' },
};

/**
 * Runs BEFORE body parsing and BEFORE any repository transaction for unauthenticated routes.
 */
export function createUnauthenticatedIpRateLimiter(
  tracker = new BoundedSlidingWindow(),
): RequestHandler {
  return (req, res, next) => {
    const fullPath = (req.baseUrl ? `${req.baseUrl}${req.path}` : req.path).replace(/\/+$/, '');
    const key = `${req.method} ${fullPath}`;
    const rule = Object.hasOwn(UNAUTHENTICATED_ROUTE_RULES, key)
      ? UNAUTHENTICATED_ROUTE_RULES[key]
      : undefined;
    if (!rule) return next();
    const ip = normalizedClientIp(req);
    const decision = tracker.consume(`unauth:${rule.bucket}:${ip}`, rule.limit, rule.windowMs);
    if (!decision.allowed) {
      res
        .status(429)
        .set('Retry-After', String(decision.retryAfter))
        .json({
          ok: false,
          code: rule.code,
          error: 'Trop de demandes. Veuillez réessayer plus tard.',
          retryAfter: decision.retryAfter,
        });
      return;
    }
    next();
  };
}

const LOGIN_WINDOW_MS = 15 * MINUTE;
const ACCOUNT_IP_MAX_FAILURES = 10;
const IP_MAX_FAILURES = 20;
const PROGRESSIVE_DELAYS_MS = [100, 200, 400, 600, 1000] as const;
const RECOVERY_COOLDOWN_MS = MINUTE;

export interface LoginAttemptGuard {
  checkBeforeLogin(
    ip: string,
    normalizedIdentifier: string,
    now?: number,
  ): { allowed: boolean; retryAfter: number; delayMs: number };
  recordLoginFailure(ip: string, normalizedIdentifier: string, now?: number): void;
  clearAccountIp(ip: string, normalizedIdentifier: string): void;
  checkRecoveryCooldown(
    ip: string,
    normalizedEmail: string,
    now?: number,
  ): { allowed: boolean; retryAfter: number };
  recordRecoveryAttempt(ip: string, normalizedEmail: string, now?: number): void;
}

export function createLoginAttemptGuard(
  tracker = new BoundedSlidingWindow(),
): LoginAttemptGuard {
  const ipKey = (ip: string) => `login-fail-ip:${ip}`;
  const accountIpKey = (ip: string, id: string) => `login-acct-ip:${ip}:${id}`;
  const recoveryKey = (ip: string, email: string) => `recovery-cooldown:${ip}:${email}`;

  return {
    checkBeforeLogin(ip, normalizedIdentifier, now = Date.now()) {
      const ipStatus = tracker.count(ipKey(ip), LOGIN_WINDOW_MS, now);
      if (ipStatus.count >= IP_MAX_FAILURES) {
        return { allowed: false, retryAfter: ipStatus.retryAfter, delayMs: 0 };
      }
      const acctStatus = tracker.count(accountIpKey(ip, normalizedIdentifier), LOGIN_WINDOW_MS, now);
      if (acctStatus.count >= ACCOUNT_IP_MAX_FAILURES) {
        return { allowed: false, retryAfter: acctStatus.retryAfter, delayMs: 0 };
      }
      const delayIdx = acctStatus.count - 5;
      const delayMs =
        delayIdx >= 0
          ? PROGRESSIVE_DELAYS_MS[Math.min(delayIdx, PROGRESSIVE_DELAYS_MS.length - 1)]
          : 0;
      return { allowed: true, retryAfter: 0, delayMs };
    },
    recordLoginFailure(ip, normalizedIdentifier, now = Date.now()) {
      tracker.record(ipKey(ip), LOGIN_WINDOW_MS, now);
      tracker.record(accountIpKey(ip, normalizedIdentifier), LOGIN_WINDOW_MS, now);
    },
    clearAccountIp(ip, normalizedIdentifier) {
      tracker.clear(accountIpKey(ip, normalizedIdentifier));
    },
    checkRecoveryCooldown(ip, normalizedEmail, now = Date.now()) {
      const status = tracker.count(recoveryKey(ip, normalizedEmail), RECOVERY_COOLDOWN_MS, now);
      if (status.count >= 1) {
        return { allowed: false, retryAfter: status.retryAfter };
      }
      return { allowed: true, retryAfter: 0 };
    },
    recordRecoveryAttempt(ip, normalizedEmail, now = Date.now()) {
      tracker.record(recoveryKey(ip, normalizedEmail), RECOVERY_COOLDOWN_MS, now);
    },
  };
}

export const bodyParserErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (!err) return next();
  if (
    err.type === 'entity.too.large' ||
    err.status === 413 ||
    err.statusCode === 413
  ) {
    res.status(413).json({
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      error: 'Requête trop volumineuse.',
    });
    return;
  }
  if (err instanceof SyntaxError && (err as { status?: number }).status === 400) {
    res.status(400).json({
      ok: false,
      code: 'INVALID_JSON',
      error: 'Corps JSON invalide.',
    });
    return;
  }
  next(err);
};

export interface ValidatedPayPalWebhookHeaders {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
  eventType: string;
}

function isAllowedPayPalCertUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === 'paypal.com' || host.endsWith('.paypal.com');
  } catch {
    return false;
  }
}

/**
 * Validates PayPal webhook headers and JSON envelope shape BEFORE touching the database
 * or making outbound calls to PayPal.
 */
export function validatePayPalWebhookEnvelope(
  headers: Request['headers'],
  body: unknown,
): { ok: true; value: ValidatedPayPalWebhookHeaders } | { ok: false; error: string } {
  const authAlgo = String(headers['paypal-auth-algo'] || '').trim();
  const certUrl = String(headers['paypal-cert-url'] || '').trim();
  const transmissionId = String(headers['paypal-transmission-id'] || '').trim();
  const transmissionSig = String(headers['paypal-transmission-sig'] || '').trim();
  const transmissionTime = String(headers['paypal-transmission-time'] || '').trim();

  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return { ok: false, error: 'En-têtes de signature PayPal manquants.' };
  }
  if (
    authAlgo.length > 64 ||
    certUrl.length > 512 ||
    transmissionId.length > 256 ||
    transmissionSig.length > 1024 ||
    transmissionTime.length > 64 ||
    !/^[A-Za-z0-9_-]{3,64}$/.test(authAlgo) ||
    /[\s\x00-\x1f\x7f]/.test(transmissionId) ||
    /[\s\x00-\x1f\x7f]/.test(transmissionSig) ||
    !isAllowedPayPalCertUrl(certUrl) ||
    !Number.isFinite(Date.parse(transmissionTime))
  ) {
    return { ok: false, error: 'En-têtes de signature PayPal invalides.' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Événement webhook PayPal invalide.' };
  }
  const eventType = String((body as Record<string, unknown>).event_type || '').trim();
  if (!/^[A-Z0-9._-]{3,120}$/.test(eventType)) {
    return { ok: false, error: 'Type d’événement webhook PayPal invalide.' };
  }
  return {
    ok: true,
    value: {
      authAlgo,
      certUrl,
      transmissionId,
      transmissionSig,
      transmissionTime,
      eventType,
    },
  };
}

export interface ValidatedCmiWebhookEnvelope {
  payload: Record<string, unknown>;
  oid: string;
  procReturnCode: string;
  responseLabel: string;
  transId: string;
  callbackAmount: number;
  callbackAmountCents: number;
  callbackCurrency: string;
}

/**
 * Validates CMI ver3 form callback shape BEFORE opening any repository transaction.
 */
export function validateCmiWebhookEnvelope(
  body: unknown,
): { ok: true; value: ValidatedCmiWebhookEnvelope } | { ok: false } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false };
  }
  const payload = body as Record<string, unknown>;
  const keys = Object.keys(payload);
  if (keys.length === 0 || keys.length > 64) {
    return { ok: false };
  }
  const oid = String(payload.oid || '').trim();
  const hash = String(payload.HASH ?? payload.hash ?? '').trim();
  const procReturnCode = String(payload.ProcReturnCode || '').trim();
  const callbackAmount = Number(payload.amount);
  if (
    !/^CMI-[A-Za-z0-9_-]{4,80}$/.test(oid) ||
    hash.length < 4 ||
    hash.length > 256 ||
    /[\s\x00-\x1f\x7f]/.test(hash) ||
    !/^[A-Za-z0-9]{1,16}$/.test(procReturnCode) ||
    !Number.isFinite(callbackAmount) ||
    callbackAmount <= 0
  ) {
    return { ok: false };
  }
  const responseLabel = String(payload.Response || '').trim().slice(0, 120);
  const transId = String(payload.TransId || payload.AuthCode || payload.transid || '')
    .trim()
    .slice(0, 120);
  const callbackCurrency = String(payload.currency || '').trim().slice(0, 16);
  return {
    ok: true,
    value: {
      payload,
      oid,
      procReturnCode,
      responseLabel,
      transId,
      callbackAmount,
      callbackAmountCents: Math.round(callbackAmount * 100),
      callbackCurrency,
    },
  };
}

/**
 * Bounded in-memory ring buffer for unverified gateway rejections so admins retain
 * observability in /api/admin/gateway-events without mutating persisted platform state.
 */
export class EphemeralGatewayEventBuffer<T extends { id: string; createdAt: string }> {
  private readonly items: T[] = [];

  constructor(private readonly capacity = 100) {}

  record(entry: T): T {
    this.items.push(entry);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
    return entry;
  }

  list(): readonly T[] {
    return this.items;
  }
}
