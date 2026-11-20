import crypto from 'node:crypto';
import type { CmiCurrencyCode, CmiEnv } from '../types';
import { OperationError } from './domain/errors';

export const CMI_TEST_GATEWAY_URL = 'https://testpayment.cmi.co.ma/fim/est3Dgate';
export const CMI_PROD_GATEWAY_URL = 'https://payment.cmi.co.ma/fim/est3Dgate';

export function getCmiCurrencyLabel(
  code: CmiCurrencyCode,
): 'MAD' | 'EUR' | 'USD' {
  if (code === '978') return 'EUR';
  if (code === '840') return 'USD';
  return 'MAD';
}

export function normalizeCmiCurrencyCode(raw: unknown): CmiCurrencyCode {
  const s = String(raw || '').trim();
  if (s === '978' || s.toUpperCase() === 'EUR') return '978';
  if (s === '840' || s.toUpperCase() === 'USD') return '840';
  return '504';
}

export function normalizeCmiEnv(raw: unknown): CmiEnv {
  return String(raw || '').trim().toLowerCase() === 'production'
    ? 'production'
    : 'test';
}

export function getCmiGatewayUrl(env: CmiEnv): string {
  if (
    process.env.NODE_ENV !== 'production' &&
    typeof process.env.CMI_GATEWAY_URL === 'string' &&
    process.env.CMI_GATEWAY_URL.trim()
  ) {
    return process.env.CMI_GATEWAY_URL.trim();
  }
  return env === 'production' ? CMI_PROD_GATEWAY_URL : CMI_TEST_GATEWAY_URL;
}

/**
 * Official Moroccan CMI ver3 escaping:
 * escape backslashes first, then pipe characters.
 */
export function escapeCmiHashValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * Official Moroccan CMI (NestPay / 3D_PAY_HOSTING) hashAlgorithm=ver3:
 * - Exclude `hash` and `encoding` (case-insensitive)
 * - Sort keys alphabetically (case-insensitive, ASCII/en)
 * - Escape each trimmed value (`\` -> `\\`, `|` -> `\|`), join with `|`, append `|` + escaped storeKey
 * - SHA-512 digest encoded as Base64
 */
export function computeCmiHashVer3(
  params: Record<string, unknown>,
  storeKey: string,
): string {
  const keys = Object.keys(params)
    .filter((k) => {
      const lower = k.toLowerCase();
      return lower !== 'hash' && lower !== 'encoding';
    })
    .sort((a, b) => {
      const la = a.toLowerCase();
      const lb = b.toLowerCase();
      if (la < lb) return -1;
      if (la > lb) return 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });

  const parts = keys.map((k) => {
    const raw = params[k];
    const strVal = raw === undefined || raw === null ? '' : String(raw).trim();
    return escapeCmiHashValue(strVal);
  });
  parts.push(escapeCmiHashValue(storeKey));
  const plain = parts.join('|');
  return crypto.createHash('sha512').update(plain, 'utf8').digest('base64');
}

/**
 * Constant-time verification of CMI callback `HASH` (ver3 SHA-512 Base64).
 */
export function verifyCmiCallbackHash(
  body: Record<string, unknown>,
  storeKey: string,
): boolean {
  if (!storeKey || !body || typeof body !== 'object') return false;
  const receivedRaw =
    typeof body.HASH === 'string'
      ? body.HASH
      : typeof body.hash === 'string'
        ? body.hash
        : '';
  const received = receivedRaw.trim();
  if (!received) return false;
  const expected = computeCmiHashVer3(body, storeKey);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sanitizeCmiField(raw: string | undefined, max: number): string {
  return String(raw || '')
    .replace(/[\r\n\t<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export interface CmiCheckoutBuildInput {
  env: CmiEnv;
  clientId: string;
  storeKey: string;
  oid: string;
  amountValue: string;
  currencyCode: CmiCurrencyCode;
  lang: 'fr' | 'ar';
  okUrl: string;
  failUrl: string;
  shopUrl: string;
  callbackUrl: string;
  billToName: string;
  email?: string;
  tel?: string;
  description?: string;
}

export function buildCmiCheckoutPayload(input: CmiCheckoutBuildInput): {
  gatewayUrl: string;
  fields: Record<string, string>;
} {
  if (!input.clientId.trim() || !input.storeKey.trim()) {
    throw new OperationError('Identifiants CMI manquants.', 503);
  }
  const fields: Record<string, string> = {
    clientid: input.clientId.trim(),
    amount: input.amountValue,
    currency: input.currencyCode,
    oid: input.oid,
    okUrl: input.okUrl,
    failUrl: input.failUrl,
    shopurl: input.shopUrl,
    callbackUrl: input.callbackUrl,
    trantype: 'Auth',
    AutoRedirect: 'true',
    storetype: '3D_PAY_HOSTING',
    hashAlgorithm: 'ver3',
    lang: input.lang === 'ar' ? 'ar' : 'fr',
    encoding: 'UTF-8',
    rnd: crypto.randomBytes(12).toString('hex'),
    BillToName: sanitizeCmiField(input.billToName, 120) || 'Cabinet Syndic',
    ...(input.email ? { email: sanitizeCmiField(input.email, 120) } : {}),
    ...(input.tel ? { tel: sanitizeCmiField(input.tel, 40) } : {}),
    ...(input.description
      ? { dim1: sanitizeCmiField(input.description, 120) }
      : {}),
  };
  fields.hash = computeCmiHashVer3(fields, input.storeKey);
  return {
    gatewayUrl: getCmiGatewayUrl(input.env),
    fields,
  };
}

export function runCmiSelfTest(creds: {
  env: CmiEnv;
  clientId: string;
  storeKey: string;
  currencyCode: CmiCurrencyCode;
}): {
  ok: true;
  env: CmiEnv;
  gatewayUrl: string;
  hashPreview: string;
  message: string;
} {
  const clientId = creds.clientId.trim();
  const storeKey = creds.storeKey.trim();
  if (clientId.length < 4) {
    throw new OperationError(
      'Client ID CMI invalide (minimum 4 caractères).',
      400,
    );
  }
  if (storeKey.length < 8) {
    throw new OperationError(
      'Clé secrète (Store Key) CMI manquante ou trop courte (minimum 8 caractères).',
      400,
    );
  }
  const sample: Record<string, string> = {
    clientid: clientId,
    amount: '390.00',
    currency: creds.currencyCode,
    oid: 'SELFTEST-CMI-001',
    storetype: '3D_PAY_HOSTING',
    hashAlgorithm: 'ver3',
    rnd: 'selftest',
    encoding: 'UTF-8',
  };
  const hash = computeCmiHashVer3(sample, storeKey);
  const verified = verifyCmiCallbackHash({ ...sample, HASH: hash }, storeKey);
  if (!verified) {
    throw new OperationError(
      'Échec de vérification cryptographique SHA-512 ver3.',
      500,
    );
  }
  const gatewayUrl = getCmiGatewayUrl(creds.env);
  return {
    ok: true,
    env: creds.env,
    gatewayUrl,
    hashPreview: `${hash.slice(0, 12)}…`,
    message:
      creds.env === 'production'
        ? `Configuration CMI Production valide (signature SHA-512 ver3 vérifiée · ${gatewayUrl}).`
        : `Configuration CMI Test valide (signature SHA-512 ver3 vérifiée · ${gatewayUrl}).`,
  };
}
