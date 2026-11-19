import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashPasswordSync } from '../utils/security';
import {
  computeSubscriptionPricing,
  formatMoroccanRib,
  getPayPalApiBase,
} from '../server/paypalBilling';
import type { PublicPlatformBillingConfig } from '../types';

const root = resolve(import.meta.dirname, '..');

async function getFreePort(): Promise<number> {
  const srv = createNetServer();
  await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
  const addr = srv.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  await new Promise<void>((res) => srv.close(() => res()));
  return port;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

await test('pure billing helpers enforce production PayPal API host and compute pricing / RIB', () => {
  const origNodeEnv = process.env.NODE_ENV;
  const origApiBase = process.env.PAYPAL_API_BASE;
  try {
    process.env.PAYPAL_API_BASE = 'http://127.0.0.1:9999';
    process.env.NODE_ENV = 'test';
    assert.equal(getPayPalApiBase('sandbox'), 'http://127.0.0.1:9999');

    process.env.NODE_ENV = 'production';
    assert.equal(getPayPalApiBase('sandbox'), 'https://api-m.sandbox.paypal.com');
    assert.equal(getPayPalApiBase('live'), 'https://api-m.paypal.com');
  } finally {
    process.env.NODE_ENV = origNodeEnv;
    if (origApiBase === undefined) delete process.env.PAYPAL_API_BASE;
    else process.env.PAYPAL_API_BASE = origApiBase;
  }

  assert.equal(
    formatMoroccanRib('007780000123456789012345'),
    '007 780 0001234567890123 45',
  );

  const cfg: PublicPlatformBillingConfig = {
    paypal: {
      enabled: true,
      env: 'sandbox',
      checkoutMode: 'expanded',
      clientId: 'c',
      currency: 'EUR',
      madPerUnit: 10,
      planPrices: { enterprise: 75 },
    },
    bankTransfer: {
      enabled: true,
      bankName: 'Bank',
      accountHolder: 'Holder',
      rib: '007 780 0001234567890123 45',
      iban: '',
      swift: '',
      ice: '',
      instructionsFr: '',
      instructionsAr: '',
    },
  };
  const pro = computeSubscriptionPricing(cfg, 'professional', 3);
  assert.equal(pro.amountMad, 1170);
  assert.equal(pro.paypalAmount, 117);
  assert.equal(pro.paypalCurrency, 'EUR');

  const ent = computeSubscriptionPricing(cfg, 'enterprise', 2);
  assert.equal(ent.amountMad, 1580);
  assert.equal(ent.paypalAmount, 150); // overridden 75 * 2
});

// Setup PayPal loopback mock server
interface MockOrderRecord {
  orderId: string;
  currency: string;
  value: string;
  customId: string;
  status: 'CREATED' | 'COMPLETED';
  captureId?: string;
  requestPayload: Record<string, any>;
  tamperCaptureCurrency?: string;
  tamperCaptureValue?: string;
}

const mockOrders = new Map<string, MockOrderRecord>();
const captureHits: string[] = [];
const validClientPairs = new Map<string, string>([
  ['env-pp-client', 'env-pp-secret'],
  ['admin-pp-client', 'admin-pp-secret'],
]);
const validWebhookIds = new Set(['env-webhook-id', 'admin-webhook-id']);
let orderSeq = 0;

const paypalMockServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
  const urlPath = (req.url || '/').split('?')[0];
  const rawBody = await readBody(req);
  const jsonOut = (status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'POST' && urlPath === '/v1/oauth2/token') {
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Basic ')) {
      return jsonOut(401, { error: 'invalid_client', error_description: 'Missing Basic auth' });
    }
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const id = sep >= 0 ? decoded.slice(0, sep) : '';
    const secret = sep >= 0 ? decoded.slice(sep + 1) : '';
    if (!id || validClientPairs.get(id) !== secret) {
      return jsonOut(401, {
        error: 'invalid_client',
        error_description: 'Client Authentication failed',
      });
    }
    return jsonOut(200, {
      access_token: `mock-token-${id}`,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  }

  if (req.method === 'POST' && urlPath === '/v2/checkout/orders') {
    const parsed = JSON.parse(rawBody || '{}') as Record<string, any>;
    const unit = parsed.purchase_units?.[0] || {};
    orderSeq += 1;
    const orderId = `PP-ORDER-${orderSeq}`;
    mockOrders.set(orderId, {
      orderId,
      currency: String(unit.amount?.currency_code || 'EUR'),
      value: String(unit.amount?.value || '0.00'),
      customId: String(unit.custom_id || ''),
      status: 'CREATED',
      requestPayload: parsed,
    });
    return jsonOut(201, { id: orderId, status: 'CREATED' });
  }

  const captureMatch = /^\/v2\/checkout\/orders\/([^/]+)\/capture$/.exec(urlPath);
  if (req.method === 'POST' && captureMatch) {
    const orderId = decodeURIComponent(captureMatch[1]);
    captureHits.push(orderId);
    const rec = mockOrders.get(orderId);
    if (!rec) {
      return jsonOut(404, { name: 'RESOURCE_NOT_FOUND', message: 'Order not found' });
    }
    if (rec.status === 'COMPLETED') {
      return jsonOut(422, {
        name: 'UNPROCESSABLE_ENTITY',
        details: [{ issue: 'ORDER_ALREADY_CAPTURED', description: 'Order already captured.' }],
      });
    }
    rec.status = 'COMPLETED';
    rec.captureId = `PP-CAP-${orderId}`;
    const capCurrency = rec.tamperCaptureCurrency || rec.currency;
    const capValue = rec.tamperCaptureValue || rec.value;
    const hasCard = Boolean(rec.requestPayload?.payment_source?.card);
    return jsonOut(201, {
      id: rec.orderId,
      status: 'COMPLETED',
      ...(hasCard ? { payment_source: { card: { last_digits: '4242', brand: 'VISA' } } } : {}),
      purchase_units: [
        {
          custom_id: rec.customId,
          payments: {
            captures: [
              {
                id: rec.captureId,
                status: 'COMPLETED',
                custom_id: rec.customId,
                amount: { currency_code: capCurrency, value: capValue },
              },
            ],
          },
        },
      ],
    });
  }

  const getOrderMatch = /^\/v2\/checkout\/orders\/([^/]+)$/.exec(urlPath);
  if (req.method === 'GET' && getOrderMatch) {
    const orderId = decodeURIComponent(getOrderMatch[1]);
    const rec = mockOrders.get(orderId);
    if (!rec) return jsonOut(404, { message: 'Order not found' });
    const hasCard = Boolean(rec.requestPayload?.payment_source?.card);
    return jsonOut(200, {
      id: rec.orderId,
      status: rec.status,
      ...(hasCard ? { payment_source: { card: { last_digits: '4242', brand: 'VISA' } } } : {}),
      purchase_units: [
        {
          custom_id: rec.customId,
          payments: rec.captureId
            ? {
                captures: [
                  {
                    id: rec.captureId,
                    status: 'COMPLETED',
                    custom_id: rec.customId,
                    amount: {
                      currency_code: rec.tamperCaptureCurrency || rec.currency,
                      value: rec.tamperCaptureValue || rec.value,
                    },
                  },
                ],
              }
            : {},
        },
      ],
    });
  }

  if (req.method === 'POST' && urlPath === '/v1/notifications/verify-webhook-signature') {
    const parsed = JSON.parse(rawBody || '{}') as Record<string, any>;
    const okSig =
      parsed.transmission_sig === 'VALID-SIG' &&
      validWebhookIds.has(String(parsed.webhook_id || ''));
    return jsonOut(200, { verification_status: okSig ? 'SUCCESS' : 'FAILURE' });
  }

  return jsonOut(404, { error: 'Unknown mock endpoint' });
});

await new Promise<void>((resolveListen) => paypalMockServer.listen(0, '127.0.0.1', resolveListen));
const mockAddr = paypalMockServer.address();
const mockPort = typeof mockAddr === 'object' && mockAddr ? mockAddr.port : 0;

const dataDir = mkdtempSync(join(tmpdir(), 'buildmanage-sub-billing-'));
const stateFile = join(dataDir, 'shared-state.json');
const password = 'Synthetic-Billing-Password-42!';

const profiles = [
  {
    uid: 'bill-admin',
    email: 'admin@billing.invalid',
    displayName: 'Platform Admin',
    role: 'admin' as const,
    emailVerified: true,
  },
  {
    uid: 'bill-syndic-a',
    email: 'syndic-a@billing.invalid',
    displayName: 'Expired Syndic A',
    role: 'syndic' as const,
    syndicId: 'cab-a',
    emailVerified: true,
  },
  {
    uid: 'bill-syndic-b',
    email: 'syndic-b@billing.invalid',
    displayName: 'Trialing Syndic B',
    role: 'syndic' as const,
    syndicId: 'cab-b',
    buildingId: 'bld-b',
    emailVerified: true,
  },
  {
    uid: 'bill-syndic-cancelled',
    email: 'cancelled@billing.invalid',
    displayName: 'Cancelled Syndic',
    role: 'syndic' as const,
    syndicId: 'cab-cancelled',
    emailVerified: true,
  },
  {
    uid: 'bill-syndic-exp2',
    email: 'syndic-exp2@billing.invalid',
    displayName: 'Expired Syndic Virement',
    role: 'syndic' as const,
    syndicId: 'cab-exp-vir',
    emailVerified: true,
  },
  {
    uid: 'bill-res-b',
    email: 'resident-b@billing.invalid',
    displayName: 'Resident B',
    role: 'resident' as const,
    syndicId: 'cab-b',
    buildingId: 'bld-b',
    residentId: 'res-b',
    emailVerified: true,
  },
];

const futureIso = new Date(Date.now() + 20 * 86_400_000).toISOString();
const seedState = {
  syndik_prod_registered_users_v1: profiles.map((p) => ({
    uid: p.uid,
    email: p.email,
    passwordHash: hashPasswordSync(password, p.email),
    profile: p,
  })),
  syndik_prod_resident_accounts_v1: [
    {
      residentId: 'res-b',
      email: 'resident-b@billing.invalid',
      syndicId: 'cab-b',
      buildingId: 'bld-b',
      passwordHash: hashPasswordSync(password, 'resident-b@billing.invalid'),
      mustChangePassword: false,
    },
  ],
  syndik_prod_syndics_v1: [
    {
      id: 'cab-a',
      name: 'Cabinet Expired ZeroBuildings',
      email: 'syndic-a@billing.invalid',
      createdBy: 'bill-syndic-a',
      subscriptionPlan: 'starter',
      subscriptionStatus: 'expired',
      subscriptionExpiry: '2025-01-01T00:00:00.000Z',
      buildings: [], // 0 buildings!
    },
    {
      id: 'cab-exp-vir',
      name: 'Cabinet Expired Virement ZeroBuildings',
      email: 'syndic-exp2@billing.invalid',
      createdBy: 'bill-syndic-exp2',
      subscriptionPlan: 'starter',
      subscriptionStatus: 'expired',
      subscriptionExpiry: '2025-01-01T00:00:00.000Z',
      buildings: [], // 0 buildings!
    },
    {
      id: 'cab-b',
      name: 'Cabinet Trialing B',
      email: 'syndic-b@billing.invalid',
      createdBy: 'bill-syndic-b',
      subscriptionPlan: 'professional',
      subscriptionStatus: 'trialing',
      subscriptionExpiry: futureIso,
      buildings: [
        {
          id: 'bld-b',
          syndicId: 'cab-b',
          name: 'Residence B',
          address: '10 Rue Atlas',
          city: 'Rabat',
          monthlySyndicFees: 200,
          apartments: [],
          residents: [
            {
              id: 'res-b',
              name: 'Resident B',
              email: 'resident-b@billing.invalid',
              isOwner: true,
              hasAccount: true,
            },
          ],
          documents: [],
          announcements: [],
          financials: { balance: 0, reserveFundBalance: 0, transactions: [] },
        },
      ],
    },
    {
      id: 'cab-cancelled',
      name: 'Cabinet Cancelled',
      email: 'cancelled@billing.invalid',
      createdBy: 'bill-syndic-cancelled',
      subscriptionPlan: 'starter',
      subscriptionStatus: 'cancelled',
      subscriptionExpiry: '2025-01-01T00:00:00.000Z',
      buildings: [],
    },
  ],
};

writeFileSync(stateFile, JSON.stringify(seedState));

const serverPort = await getFreePort();
const child = spawn(
  process.execPath,
  ['--import', './tests/helpers/networkGuard.mjs', '--import', 'tsx', 'server.ts'],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(serverPort),
      NODE_ENV: 'test',
      SYNDIK_AUTH_PROVIDER: 'legacy',
      SYNDIK_STATE_BACKEND: 'file',
      SYNDIK_DATA_DIR: dataDir,
      SYNDIK_SERVER_SECRET: 'synthetic-billing-server-secret-123456789012345678',
      SENDGRID_API_KEY: '',
      FIREBASE_AUTH_EMULATOR_HOST: '',
      PAYPAL_API_BASE: `http://127.0.0.1:${mockPort}`,
      PAYPAL_ENABLED: 'true',
      PAYPAL_ENV: 'sandbox',
      PAYPAL_CHECKOUT_MODE: 'expanded',
      PAYPAL_CLIENT_ID: 'env-pp-client',
      PAYPAL_CLIENT_SECRET: 'env-pp-secret',
      PAYPAL_WEBHOOK_ID: 'env-webhook-id',
      PAYPAL_CURRENCY: 'EUR',
      PAYPAL_MAD_PER_UNIT: '10',
      SUBSCRIPTION_BANK_ENABLED: 'true',
      SUBSCRIPTION_BANK_NAME: 'Attijariwafa Bank Env',
      SUBSCRIPTION_BANK_HOLDER: 'ImmoGest Env SARL',
      SUBSCRIPTION_BANK_RIB: '007780000123456789012345',
      SUBSCRIPTION_BANK_IBAN: 'MA64007780000123456789012345',
      SUBSCRIPTION_BANK_SWIFT: 'BCMAMAMC',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

const exited = once(child, 'exit');
let serverLogs = '';
child.stdout.on('data', (d) => { serverLogs += d; });
child.stderr.on('data', (d) => { serverLogs += d; });
const killTimer = setTimeout(() => child.kill(), 90_000);

async function httpCall(
  route: string,
  opts: {
    method?: 'GET' | 'POST' | 'PUT';
    token?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const res = await fetch(`http://127.0.0.1:${serverPort}${route}`, {
    method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.headers || {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString('utf8');
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, buf, headers: res.headers };
}

const command = (token: string, operation: string, args: unknown[]) =>
  httpCall('/api/commands', {
    token,
    body: { operation, args, operationId: crypto.randomUUID() },
  });

const readDiskState = () => JSON.parse(readFileSync(stateFile, 'utf8'));

try {
  for (let i = 0; i < 200 && !serverLogs.includes('Server running'); i++) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early: ${serverLogs}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(serverLogs.includes('Server running'), serverLogs);

  const loginToken = async (email: string) => {
    const res = await httpCall('/api/auth/login', {
      body: { identifier: email, password },
    });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    return String(res.data.token);
  };

  const adminToken = await loginToken('admin@billing.invalid');
  const syndicAToken = await loginToken('syndic-a@billing.invalid');
  const syndicExp2Token = await loginToken('syndic-exp2@billing.invalid');
  const syndicBToken = await loginToken('syndic-b@billing.invalid');
  const cancelledToken = await loginToken('cancelled@billing.invalid');
  const residentToken = await loginToken('resident-b@billing.invalid');

  await test('billing config RBAC, env defaults, and secret redaction', async () => {
    assert.equal((await httpCall('/api/subscription/billing-config')).status, 401);
    assert.equal((await httpCall('/api/subscription/billing-config', { token: residentToken })).status, 403);

    assert.equal((await httpCall('/api/admin/billing-config')).status, 401);
    assert.equal((await httpCall('/api/admin/billing-config', { token: syndicAToken })).status, 403);
    assert.equal((await httpCall('/api/admin/billing-config', { token: residentToken })).status, 403);
    assert.equal(
      (await httpCall('/api/admin/billing-config', { method: 'PUT', token: syndicAToken, body: { resetToEnv: true } })).status,
      403,
    );
    assert.equal(
      (await httpCall('/api/admin/billing-config/test-paypal', { token: syndicAToken, body: {} })).status,
      403,
    );

    const adminCfg = await httpCall('/api/admin/billing-config', { token: adminToken });
    assert.equal(adminCfg.status, 200);
    assert.equal(adminCfg.data.config.paypal.clientId, 'env-pp-client');
    assert.equal(adminCfg.data.config.paypal.hasClientSecret, true);
    assert.equal(adminCfg.data.config.paypal.clientSecretSource, 'env');
    assert.equal(adminCfg.data.config.paypal.hasWebhookId, true);
    assert.equal(adminCfg.data.config.paypal.webhookIdSource, 'env');
    assert.equal(adminCfg.data.config.bankTransfer.source, 'env');
    assert.equal(adminCfg.data.config.bankTransfer.rib, '007 780 0001234567890123 45');
    const serializedAdmin = JSON.stringify(adminCfg.data);
    assert.ok(!serializedAdmin.includes('env-pp-secret'));
    assert.ok(!serializedAdmin.includes('env-webhook-id'));

    const syndicCfg = await httpCall('/api/subscription/billing-config', { token: syndicAToken });
    assert.equal(syndicCfg.status, 200);
    assert.equal(syndicCfg.data.config.paypal.enabled, true);
    assert.equal(syndicCfg.data.config.paypal.checkoutMode, 'expanded');
    assert.equal(syndicCfg.data.config.paypal.clientId, 'env-pp-client');
    assert.equal(syndicCfg.data.config.bankTransfer.enabled, true);
    assert.equal(syndicCfg.data.config.bankTransfer.rib, '007 780 0001234567890123 45');
    const serializedSyndic = JSON.stringify(syndicCfg.data);
    assert.ok(!serializedSyndic.includes('env-pp-secret'));
    assert.ok(!serializedSyndic.includes('env-webhook-id'));
  });

  await test('Admin billing config overrides encrypt secrets, validate RIB/PayPal, test OAuth, and reset to env', async () => {
    const badRib = await httpCall('/api/admin/billing-config', {
      method: 'PUT',
      token: adminToken,
      body: {
        paypal: {
          enabled: true,
          env: 'sandbox',
          checkoutMode: 'expanded',
          clientId: 'admin-pp-client',
          clientSecret: 'admin-pp-secret',
          currency: 'USD',
          madPerUnit: 10,
        },
        bankTransfer: {
          enabled: true,
          bankName: 'CIH Bank',
          accountHolder: 'ImmoGest SAS',
          rib: '12345',
        },
      },
    });
    assert.equal(badRib.status, 400);

    const clearedSecretEnable = await httpCall('/api/admin/billing-config', {
      method: 'PUT',
      token: adminToken,
      body: {
        paypal: {
          enabled: true,
          env: 'sandbox',
          checkoutMode: 'expanded',
          clientId: 'admin-pp-client',
          clearClientSecret: true,
          currency: 'USD',
          madPerUnit: 10,
        },
        bankTransfer: {
          enabled: true,
          bankName: 'CIH Bank',
          accountHolder: 'ImmoGest SAS',
          rib: '230780000123456789012345',
        },
      },
    });
    assert.equal(clearedSecretEnable.status, 400);

    const saved = await httpCall('/api/admin/billing-config', {
      method: 'PUT',
      token: adminToken,
      body: {
        paypal: {
          enabled: true,
          env: 'sandbox',
          checkoutMode: 'expanded',
          clientId: 'admin-pp-client',
          clientSecret: 'admin-pp-secret',
          webhookId: 'admin-webhook-id',
          currency: 'USD',
          madPerUnit: 10,
          planPrices: { professional: 29 },
        },
        bankTransfer: {
          enabled: true,
          bankName: 'CIH Bank Admin',
          accountHolder: 'ImmoGest Admin SARL',
          rib: '230780000123456789012345',
          iban: 'MA64230780000123456789012345',
          swift: 'CIHMMAMC',
          ice: '001234567000089',
        },
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.config.paypal.clientSecretSource, 'admin');
    assert.equal(saved.data.config.paypal.webhookIdSource, 'admin');
    assert.equal(saved.data.config.paypal.currency, 'USD');
    assert.equal(saved.data.config.paypal.planPrices.professional, 29);
    assert.equal(saved.data.config.bankTransfer.source, 'admin');
    assert.equal(saved.data.config.bankTransfer.rib, '230 780 0001234567890123 45');
    assert.ok(!JSON.stringify(saved.data).includes('admin-pp-secret'));
    assert.ok(!JSON.stringify(saved.data).includes('admin-webhook-id'));

    // Disk persistence must be encrypted without plaintext secrets
    const rawDisk = readFileSync(stateFile, 'utf8');
    assert.ok(!rawDisk.includes('admin-pp-secret'));
    assert.ok(!rawDisk.includes('admin-webhook-id'));
    const diskState = JSON.parse(rawDisk);
    assert.ok(diskState.__platformBillingConfig?.paypal?.encryptedClientSecret);
    assert.ok(diskState.__platformBillingConfig?.paypal?.encryptedWebhookId);

    // /api/shared-state must never leak __platformBillingConfig or PayPal secrets
    const sharedAdmin = await httpCall('/api/shared-state', { token: adminToken });
    assert.equal(sharedAdmin.status, 200);
    assert.equal(sharedAdmin.data.store.__platformBillingConfig, undefined);

    // Public billing config immediately reflects Admin override
    const pub = await httpCall('/api/subscription/billing-config', { token: syndicAToken });
    assert.equal(pub.data.config.paypal.currency, 'USD');
    assert.equal(pub.data.config.paypal.clientId, 'admin-pp-client');
    assert.equal(pub.data.config.paypal.planPrices.professional, 29);
    assert.equal(pub.data.config.bankTransfer.bankName, 'CIH Bank Admin');

    // Test PayPal OAuth endpoint (valid vs invalid secret)
    const testOk = await httpCall('/api/admin/billing-config/test-paypal', {
      token: adminToken,
      body: {},
    });
    assert.equal(testOk.status, 200, JSON.stringify(testOk.data));
    assert.equal(testOk.data.ok, true);

    const testFail = await httpCall('/api/admin/billing-config/test-paypal', {
      token: adminToken,
      body: { env: 'sandbox', clientId: 'admin-pp-client', clientSecret: 'wrong-secret' },
    });
    assert.equal(testFail.status, 400);

    // Reset back to Env vars
    const reset = await httpCall('/api/admin/billing-config', {
      method: 'PUT',
      token: adminToken,
      body: { resetToEnv: true },
    });
    assert.equal(reset.status, 200, JSON.stringify(reset.data));
    assert.equal(reset.data.config.paypal.clientSecretSource, 'env');
    assert.equal(reset.data.config.paypal.currency, 'EUR');
    assert.equal(reset.data.config.bankTransfer.source, 'env');
    assert.equal(readDiskState().__platformBillingConfig, undefined);
  });

  await test('PayPal Expanded card + Standard checkout, tamper checks, and webhook idempotency (including expired 0-building cabinet)', async () => {
    // Forbidden roles & cancelled cabinet
    assert.equal(
      (await httpCall('/api/subscription/paypal/create-order', {
        token: residentToken,
        body: { syndicId: 'cab-b', plan: 'professional', months: 1 },
      })).status,
      403,
    );
    assert.equal(
      (await httpCall('/api/subscription/paypal/create-order', {
        token: syndicBToken,
        body: { syndicId: 'cab-a', plan: 'professional', months: 1 },
      })).status,
      403,
    );
    assert.equal(
      (await httpCall('/api/subscription/paypal/create-order', {
        token: cancelledToken,
        body: { syndicId: 'cab-cancelled', plan: 'starter', months: 1 },
      })).status,
      403,
    );

    // Expired Syndic A (0 buildings) starts Expanded Card checkout for Professional x 3 months (1170 MAD -> 117 EUR)
    const createdCard = await httpCall('/api/subscription/paypal/create-order', {
      token: syndicAToken,
      body: {
        syndicId: 'cab-a',
        plan: 'professional',
        months: 3,
        paymentSourceHint: 'card',
      },
    });
    assert.equal(createdCard.status, 200, JSON.stringify(createdCard.data));
    assert.equal(createdCard.data.currency, 'EUR');
    assert.equal(createdCard.data.amount, 117);
    assert.equal(createdCard.data.amountMad, 1170);

    const cardOrderId = createdCard.data.orderId as string;
    const mockOrder = mockOrders.get(cardOrderId);
    assert.ok(mockOrder);
    assert.equal(
      mockOrder.requestPayload?.payment_source?.card?.attributes?.verification?.method,
      'SCA_WHEN_REQUIRED',
    );

    // Cross-tenant capture rejected 403
    assert.equal(
      (await httpCall('/api/subscription/paypal/capture-order', {
        token: syndicBToken,
        body: { orderId: cardOrderId, syndicId: 'cab-a' },
      })).status,
      403,
    );

    // Valid capture activates expired cab-a
    const captured = await httpCall('/api/subscription/paypal/capture-order', {
      token: syndicAToken,
      body: { orderId: cardOrderId, syndicId: 'cab-a', methodHint: 'card' },
    });
    assert.equal(captured.status, 200, JSON.stringify(captured.data));
    assert.equal(captured.data.alreadyCaptured, false);
    assert.equal(captured.data.payment.method, 'card');
    assert.equal(captured.data.payment.currency, 'EUR');
    assert.equal(captured.data.payment.chargedAmount, 117);
    assert.equal(captured.data.payment.amount, 1170);
    assert.equal(captured.data.payment.externalOrderId, cardOrderId);

    const cabAAfterCapture = readDiskState().syndik_prod_syndics_v1.find((s: any) => s.id === 'cab-a');
    assert.equal(cabAAfterCapture.subscriptionStatus, 'active');
    assert.equal(cabAAfterCapture.subscriptionPlan, 'professional');
    const expiryAfterFirst = cabAAfterCapture.subscriptionExpiry;

    // Repeat capture is idempotent (no double charge/extension)
    const repeatCapture = await httpCall('/api/subscription/paypal/capture-order', {
      token: syndicAToken,
      body: { orderId: cardOrderId, syndicId: 'cab-a' },
    });
    assert.equal(repeatCapture.status, 200);
    assert.equal(repeatCapture.data.alreadyCaptured, true);
    assert.equal(repeatCapture.data.payment.id, captured.data.payment.id);

    // Signed PayPal webhook replay on already captured order is ALSO idempotent
    const webhookReplay = await httpCall('/api/webhooks/paypal', {
      body: {
        id: 'WH-EVT-1',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: mockOrder.captureId,
          status: 'COMPLETED',
          custom_id: mockOrder.customId,
          amount: { currency_code: 'EUR', value: '117.00' },
          supplementary_data: { related_ids: { order_id: cardOrderId } },
        },
      },
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
        'paypal-transmission-id': 'tx-1',
        'paypal-transmission-sig': 'VALID-SIG',
        'paypal-transmission-time': new Date().toISOString(),
      },
    });
    assert.equal(webhookReplay.status, 200, JSON.stringify(webhookReplay.data));
    assert.equal(webhookReplay.data.paymentId, captured.data.payment.id);

    const diskAfterReplay = readDiskState();
    assert.equal(
      diskAfterReplay.syndik_prod_subscription_payments_v1.filter((p: any) => p.syndicId === 'cab-a').length,
      1,
    );
    assert.equal(
      diskAfterReplay.syndik_prod_syndics_v1.find((s: any) => s.id === 'cab-a').subscriptionExpiry,
      expiryAfterFirst,
    );

    // Invalid webhook headers / signature rejected
    assert.equal((await httpCall('/api/webhooks/paypal', { body: {} })).status, 400);
    assert.equal(
      (await httpCall('/api/webhooks/paypal', {
        body: { event_type: 'PAYMENT.CAPTURE.COMPLETED' },
        headers: {
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
          'paypal-transmission-id': 'tx-bad',
          'paypal-transmission-sig': 'INVALID-SIG',
          'paypal-transmission-time': new Date().toISOString(),
        },
      })).status,
      401,
    );

    // Amount/currency tamper check: PayPal returns USD instead of EUR -> 409, no payment
    const tamperedOrderRes = await httpCall('/api/subscription/paypal/create-order', {
      token: syndicAToken,
      body: { syndicId: 'cab-a', plan: 'starter', months: 1, paymentSourceHint: 'paypal' },
    });
    assert.equal(tamperedOrderRes.status, 200);
    const tamperedMock = mockOrders.get(tamperedOrderRes.data.orderId)!;
    tamperedMock.tamperCaptureCurrency = 'USD';
    const tamperedCapRes = await httpCall('/api/subscription/paypal/capture-order', {
      token: syndicAToken,
      body: { orderId: tamperedMock.orderId, syndicId: 'cab-a' },
    });
    assert.equal(tamperedCapRes.status, 409);
    assert.equal(
      readDiskState().syndik_prod_subscription_payments_v1.filter((p: any) => p.syndicId === 'cab-a').length,
      1,
    );

    // Webhook-before-capture flow for cab-b (PayPal Wallet, Enterprise x 2 months = 158 EUR / 1580 MAD)
    const cabBOrderRes = await httpCall('/api/subscription/paypal/create-order', {
      token: syndicBToken,
      body: { syndicId: 'cab-b', plan: 'enterprise', months: 2, paymentSourceHint: 'paypal' },
    });
    assert.equal(cabBOrderRes.status, 200);
    assert.equal(cabBOrderRes.data.amount, 158);
    assert.equal(cabBOrderRes.data.amountMad, 1580);
    const cabBOrder = mockOrders.get(cabBOrderRes.data.orderId)!;
    // Mark completed on PayPal mock as webhook fires asynchronously
    cabBOrder.status = 'COMPLETED';
    cabBOrder.captureId = `PP-CAP-${cabBOrder.orderId}`;

    const webhookFirst = await httpCall('/api/webhooks/paypal', {
      body: {
        id: 'WH-EVT-2',
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: {
          id: cabBOrder.captureId,
          status: 'COMPLETED',
          custom_id: cabBOrder.customId,
          amount: { currency_code: 'EUR', value: '158.00' },
          supplementary_data: { related_ids: { order_id: cabBOrder.orderId } },
        },
      },
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
        'paypal-transmission-id': 'tx-2',
        'paypal-transmission-sig': 'VALID-SIG',
        'paypal-transmission-time': new Date().toISOString(),
      },
    });
    assert.equal(webhookFirst.status, 200, JSON.stringify(webhookFirst.data));
    assert.equal(webhookFirst.data.ignored, false);

    // Now client browser calls capture-order afterward -> alreadyCaptured: true, zero duplicate payments
    const followUpCapture = await httpCall('/api/subscription/paypal/capture-order', {
      token: syndicBToken,
      body: { orderId: cabBOrder.orderId, syndicId: 'cab-b', methodHint: 'paypal' },
    });
    assert.equal(followUpCapture.status, 200, JSON.stringify(followUpCapture.data));
    assert.equal(followUpCapture.data.alreadyCaptured, true);
    assert.equal(followUpCapture.data.payment.id, webhookFirst.data.paymentId);
    assert.equal(followUpCapture.data.payment.method, 'paypal');
    assert.equal(
      readDiskState().syndik_prod_subscription_payments_v1.filter((p: any) => p.syndicId === 'cab-b').length,
      1,
    );
  });

  await test('Moroccan Bank Transfer upload isolation, duplicate guards, reject/resubmit, and Admin approval on expired 0-building cabinet', async () => {
    const validPng =
      'data:image/png;base64,' +
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]).toString('base64');

    // Resident denied upload
    assert.equal(
      (await httpCall('/api/subscription/upload-proof', {
        token: residentToken,
        body: { syndicId: 'cab-b', name: 'receipt.png', dataUrl: validPng },
      })).status,
      403,
    );

    // Cancelled syndic denied upload
    assert.equal(
      (await httpCall('/api/subscription/upload-proof', {
        token: cancelledToken,
        body: { syndicId: 'cab-cancelled', name: 'receipt.png', dataUrl: validPng },
      })).status,
      403,
    );

    // Expired Syndic exp2 (0 buildings) uploads proof
    const uploadRes = await httpCall('/api/subscription/upload-proof', {
      token: syndicExp2Token,
      body: { syndicId: 'cab-exp-vir', name: 'virement-attijari.png', dataUrl: validPng },
    });
    assert.equal(uploadRes.status, 200, JSON.stringify(uploadRes.data));
    const proofUrl = uploadRes.data.url as string;

    // Upload retrieval access checks
    assert.equal((await httpCall(proofUrl)).status, 401);
    assert.equal((await httpCall(proofUrl, { token: residentToken })).status, 403);
    assert.equal((await httpCall(proofUrl, { token: syndicBToken })).status, 403);
    assert.equal((await httpCall(proofUrl, { token: syndicExp2Token })).status, 200);
    assert.equal((await httpCall(proofUrl, { token: adminToken })).status, 200);

    const today = new Date().toISOString().slice(0, 10);
    // Resident cannot submit bank transfer
    assert.equal(
      (await command(residentToken, 'submitSubscriptionBankTransfer', [
        {
          syndicId: 'cab-b',
          plan: 'starter',
          months: 1,
          transferReference: 'VIR-RES-FORBIDDEN',
          bankName: 'CIH',
          transferDate: today,
        },
      ])).status,
      403,
    );

    // Cross-syndic cannot attach Syndic exp2's proofUrl
    assert.equal(
      (await command(syndicBToken, 'submitSubscriptionBankTransfer', [
        {
          syndicId: 'cab-b',
          plan: 'starter',
          months: 1,
          transferReference: 'VIR-CROSS-PROOF',
          bankName: 'CIH',
          transferDate: today,
          proofUrl,
        },
      ])).status,
      403,
    );

    // Expired Syndic exp2 submits valid Moroccan bank transfer request (starter 190 MAD * 6 = 1140 MAD)
    const expiryBeforeTransfer = readDiskState().syndik_prod_syndics_v1.find(
      (s: any) => s.id === 'cab-exp-vir',
    ).subscriptionExpiry;

    const submit1 = await command(syndicExp2Token, 'submitSubscriptionBankTransfer', [
      {
        syndicId: 'cab-exp-vir',
        plan: 'starter',
        months: 6,
        transferReference: 'VIR-MA-2026-001',
        bankName: 'Attijariwafa Bank',
        transferDate: today,
        proofUrl,
        notes: 'Virement agence Casa Anfa',
      },
    ]);
    assert.equal(submit1.status, 200, JSON.stringify(submit1.data));
    const req1Id = submit1.data.result.id as string;
    assert.equal(submit1.data.result.status, 'pending');
    assert.equal(submit1.data.result.amount, 1140);
    assert.equal(
      readDiskState().syndik_prod_syndics_v1.find((s: any) => s.id === 'cab-exp-vir').subscriptionStatus,
      'expired',
    );
    assert.equal(
      readDiskState().syndik_prod_syndics_v1.find((s: any) => s.id === 'cab-exp-vir').subscriptionExpiry,
      expiryBeforeTransfer,
    );

    // Duplicate reference rejected 409 (case-insensitive)
    assert.equal(
      (await command(syndicExp2Token, 'submitSubscriptionBankTransfer', [
        {
          syndicId: 'cab-exp-vir',
          plan: 'starter',
          months: 6,
          transferReference: 'vir-ma-2026-001',
          bankName: 'Attijariwafa Bank',
          transferDate: today,
        },
      ])).status,
      409,
    );

    // Tenant scoping in /api/shared-state: syndicB cannot see cab-exp-vir's transfer request
    const stateB = await httpCall('/api/shared-state', { token: syndicBToken });
    assert.equal(
      stateB.data.store.syndik_prod_subscription_requests_v1.some((r: any) => r.id === req1Id),
      false,
    );

    // Non-admin review forbidden
    assert.equal(
      (await command(syndicExp2Token, 'reviewSubscriptionBankTransfer', [
        { requestId: req1Id, action: 'approve' },
      ])).status,
      403,
    );
    assert.equal(
      (await command(residentToken, 'reviewSubscriptionBankTransfer', [
        { requestId: req1Id, action: 'approve' },
      ])).status,
      403,
    );

    // Admin reject requires motif >= 3 chars
    assert.equal(
      (await command(adminToken, 'reviewSubscriptionBankTransfer', [
        { requestId: req1Id, action: 'reject', rejectionReason: 'ab' },
      ])).status,
      400,
    );

    // Admin rejects cleanly -> cabinet stays expired, reference freed for resubmission
    const rejected = await command(adminToken, 'reviewSubscriptionBankTransfer', [
      {
        requestId: req1Id,
        action: 'reject',
        rejectionReason: 'Photo du reçu coupée, merci de renvoyer.',
      },
    ]);
    assert.equal(rejected.status, 200, JSON.stringify(rejected.data));
    assert.equal(rejected.data.result.request.status, 'rejected');
    assert.equal(
      readDiskState().syndik_prod_syndics_v1.find((s: any) => s.id === 'cab-exp-vir').subscriptionStatus,
      'expired',
    );

    // Resubmit using same transferReference now succeeds (professional 390 MAD * 6 = 2340 MAD)
    const resubmit = await command(syndicExp2Token, 'submitSubscriptionBankTransfer', [
      {
        syndicId: 'cab-exp-vir',
        plan: 'professional',
        months: 6,
        transferReference: 'VIR-MA-2026-001',
        bankName: 'Attijariwafa Bank',
        transferDate: today,
        proofUrl,
      },
    ]);
    assert.equal(resubmit.status, 200, JSON.stringify(resubmit.data));
    const req2Id = resubmit.data.result.id as string;

    // Admin approves resubmitted request -> activates expired cabinet & records virement payment with proofUrl
    const approved = await command(adminToken, 'reviewSubscriptionBankTransfer', [
      { requestId: req2Id, action: 'approve' },
    ]);
    assert.equal(approved.status, 200, JSON.stringify(approved.data));
    assert.equal(approved.data.result.request.status, 'approved');
    assert.equal(approved.data.result.payment.method, 'virement');
    assert.equal(approved.data.result.payment.currency, 'MAD');
    assert.equal(approved.data.result.payment.amount, 2340);
    assert.equal(approved.data.result.payment.proofUrl, proofUrl);
    assert.equal(approved.data.result.payment.requestId, req2Id);

    const cabAfterTransfer = readDiskState().syndik_prod_syndics_v1.find(
      (s: any) => s.id === 'cab-exp-vir',
    );
    assert.equal(cabAfterTransfer.subscriptionStatus, 'active');
    assert.equal(cabAfterTransfer.subscriptionPlan, 'professional');
    assert.ok(Date.parse(cabAfterTransfer.subscriptionExpiry) > Date.parse(expiryBeforeTransfer));

    // Re-approving same request rejected 409
    assert.equal(
      (await command(adminToken, 'reviewSubscriptionBankTransfer', [
        { requestId: req2Id, action: 'approve' },
      ])).status,
      409,
    );

    // Voiding cab-exp-vir's only subscription payment rolls back subscriptionStatus & subscriptionExpiry
    const transferPaymentId = approved.data.result.payment.id as string;
    const voidRes = await command(adminToken, 'voidSubscriptionPayment', [
      transferPaymentId,
      'Virement rejeté par la banque émettrice',
    ]);
    assert.equal(voidRes.status, 200, JSON.stringify(voidRes.data));
    const cabAfterVoid = readDiskState().syndik_prod_syndics_v1.find(
      (s: any) => s.id === 'cab-exp-vir',
    );
    assert.equal(cabAfterVoid.subscriptionStatus, 'expired');
    assert.equal(cabAfterVoid.subscriptionExpiry, expiryBeforeTransfer);
    const voidedPayment = readDiskState().syndik_prod_subscription_payments_v1.find(
      (p: any) => p.id === transferPaymentId,
    );
    assert.ok(voidedPayment?.voidedAt, 'voided transfer payment must record voidedAt');

    // PayPal PAYMENT.CAPTURE.REFUNDED webhook voids cab-b's captured payment and rolls back expiry
    const cabBPayment = readDiskState().syndik_prod_subscription_payments_v1.find(
      (p: any) => p.syndicId === 'cab-b' && p.externalCaptureId,
    );
    const cabBPriorExpiry = cabBPayment?.previousSubscriptionExpiry;
    const cabBCaptureId = cabBPayment?.externalCaptureId as string;
    assert.ok(cabBCaptureId, 'cab-b must have a recorded PayPal externalCaptureId');

    const refundWebhook = await httpCall('/api/webhooks/paypal', {
      body: {
        id: 'WH-EVT-REFUND-1',
        event_type: 'PAYMENT.CAPTURE.REFUNDED',
        resource: {
          id: 'PP-REFUND-1',
          status: 'COMPLETED',
          links: [
            {
              rel: 'up',
              href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${cabBCaptureId}`,
            },
          ],
        },
      },
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
        'paypal-transmission-id': 'tx-refund-1',
        'paypal-transmission-sig': 'VALID-SIG',
        'paypal-transmission-time': new Date().toISOString(),
      },
    });
    assert.equal(refundWebhook.status, 200, JSON.stringify(refundWebhook.data));
    assert.equal(refundWebhook.data.ignored, false);
    assert.equal(refundWebhook.data.voidedPaymentId, cabBPayment.id);
    const cabBAfterRefund = readDiskState().syndik_prod_syndics_v1.find(
      (s: any) => s.id === 'cab-b',
    );
    if (cabBPriorExpiry) {
      assert.equal(cabBAfterRefund.subscriptionExpiry, cabBPriorExpiry);
    }
    const refundedPayment = readDiskState().syndik_prod_subscription_payments_v1.find(
      (p: any) => p.externalCaptureId === cabBCaptureId,
    );
    assert.ok(refundedPayment?.voidedAt, 'refunded PayPal payment must record voidedAt');

    // Replaying the same refund webhook is idempotent (ignored: true)
    const refundReplay = await httpCall('/api/webhooks/paypal', {
      body: {
        id: 'WH-EVT-REFUND-2',
        event_type: 'PAYMENT.CAPTURE.REFUNDED',
        resource: {
          id: 'PP-REFUND-1',
          status: 'COMPLETED',
          links: [
            {
              rel: 'up',
              href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${cabBCaptureId}`,
            },
          ],
        },
      },
      headers: {
        'paypal-auth-algo': 'SHA256withRSA',
        'paypal-cert-url': 'https://api.sandbox.paypal.com/cert.pem',
        'paypal-transmission-id': 'tx-refund-2',
        'paypal-transmission-sig': 'VALID-SIG',
        'paypal-transmission-time': new Date().toISOString(),
      },
    });
    assert.equal(refundReplay.status, 200, JSON.stringify(refundReplay.data));
    assert.equal(refundReplay.data.ignored, true);
    assert.equal(refundReplay.data.reason, 'payment_not_found_or_already_voided');
  });

  await test('PayPal capture preflight rejects unmapped foreign orders BEFORE calling PayPal /capture and supports crash-recovery', async () => {
    // 1. Create a real intent/order for cab-b so we have a live persisted intent customId
    const createdForB = await httpCall('/api/subscription/paypal/create-order', {
      token: syndicBToken,
      body: { syndicId: 'cab-b', plan: 'professional', months: 1 },
    });
    assert.equal(createdForB.status, 200, JSON.stringify(createdForB.data));
    const origOrder = mockOrders.get(createdForB.data.orderId as string);
    assert.ok(origOrder, 'expected mock order for cab-b');

    // 2. Inject an unmapped PayPal order carrying cab-b's intent customId; cab-a tries to capture it
    mockOrders.set('PP-FOREIGN-UNMAPPED', {
      orderId: 'PP-FOREIGN-UNMAPPED',
      currency: origOrder.currency,
      value: origOrder.value,
      customId: origOrder.customId,
      status: 'CREATED',
      requestPayload: origOrder.requestPayload,
    });
    const foreignRes = await httpCall('/api/subscription/paypal/capture-order', {
      token: syndicAToken,
      body: { orderId: 'PP-FOREIGN-UNMAPPED', syndicId: 'cab-a' },
    });
    assert.equal(foreignRes.status, 403, JSON.stringify(foreignRes.data));
    assert.ok(
      !captureHits.includes('PP-FOREIGN-UNMAPPED'),
      'PayPal /capture must NEVER be invoked for an unmapped foreign order',
    );

    // 3. Inject an unmapped PayPal order with an unknown customId; cab-b tries to capture it
    mockOrders.set('PP-UNKNOWN-INTENT', {
      orderId: 'PP-UNKNOWN-INTENT',
      currency: origOrder.currency,
      value: origOrder.value,
      customId: 'non-existent-intent-id',
      status: 'CREATED',
      requestPayload: origOrder.requestPayload,
    });
    const unknownRes = await httpCall('/api/subscription/paypal/capture-order', {
      token: syndicBToken,
      body: { orderId: 'PP-UNKNOWN-INTENT', syndicId: 'cab-b' },
    });
    assert.equal(unknownRes.status, 403, JSON.stringify(unknownRes.data));
    assert.ok(
      !captureHits.includes('PP-UNKNOWN-INTENT'),
      'PayPal /capture must NEVER be invoked for an order with unknown intent',
    );

    // 4. Crash-recovery: unmapped PayPal order whose customId matches cab-b's persisted intent succeeds
    mockOrders.set('PP-CRASH-RECOVERY-1', {
      orderId: 'PP-CRASH-RECOVERY-1',
      currency: origOrder.currency,
      value: origOrder.value,
      customId: origOrder.customId,
      status: 'CREATED',
      requestPayload: origOrder.requestPayload,
    });
    const recoveryRes = await httpCall('/api/subscription/paypal/capture-order', {
      token: syndicBToken,
      body: { orderId: 'PP-CRASH-RECOVERY-1', syndicId: 'cab-b' },
    });
    assert.equal(recoveryRes.status, 200, JSON.stringify(recoveryRes.data));
    assert.equal(recoveryRes.data.alreadyCaptured, false);
    assert.equal(recoveryRes.data.payment.externalOrderId, 'PP-CRASH-RECOVERY-1');
    assert.ok(
      captureHits.includes('PP-CRASH-RECOVERY-1'),
      'Crash-recovery order must be captured after read-only ownership proof',
    );
  });
} finally {
  clearTimeout(killTimer);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await exited;
  }
  await new Promise<void>((resolveClose) => paypalMockServer.close(() => resolveClose()));
  rmSync(dataDir, { recursive: true, force: true });
}
