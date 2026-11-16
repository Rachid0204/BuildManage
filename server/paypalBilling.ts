import type {
  AdminBillingConfigUpdateInput,
  AdminPlatformBillingConfig,
  BillingConfigSource,
  PayPalCheckoutMode,
  PayPalCurrency,
  PayPalEnv,
  PublicPlatformBillingConfig,
  SubscriptionPlan,
} from '../types';
import { PLANS } from '../shared/domain/subscription';
import { OperationError } from './domain/errors';
import { decrypt, encrypt, needsEncryptionRotation } from './mailer';
import type { State } from './repository';

const DEFAULT_BANK_INSTRUCTIONS_FR =
  'Effectuez le virement vers le RIB ci-dessus en indiquant le motif recommandé, puis importez votre reçu ou saisissez la référence bancaire ci-dessous. Activation sous quelques heures après vérification par notre équipe.';
const DEFAULT_BANK_INSTRUCTIONS_AR =
  'قم بإجراء التحويل البنكي إلى رقم RIB أعلاه مع إدراج المرجع المقترح، ثم أرفق وصل التحويل أو أدخل المرجع البنكي أدناه. يتم تفعيل الاشتراك خلال ساعات بعد التحقق.';

export interface StoredPlatformBillingConfig {
  paypal?: {
    enabled: boolean;
    env: PayPalEnv;
    checkoutMode: PayPalCheckoutMode;
    clientId: string;
    encryptedClientSecret?: string;
    clearClientSecret?: boolean;
    encryptedWebhookId?: string;
    clearWebhookId?: boolean;
    currency: PayPalCurrency;
    madPerUnit: number;
    planPrices?: Partial<Record<SubscriptionPlan, number>>;
  };
  bankTransfer?: {
    enabled: boolean;
    bankName: string;
    accountHolder: string;
    rib: string;
    iban: string;
    swift: string;
    ice: string;
    instructionsFr: string;
    instructionsAr: string;
  };
  updatedAt?: string;
  updatedBy?: string;
}

export interface ResolvedPlatformBillingConfig {
  publicConfig: PublicPlatformBillingConfig;
  adminConfig: AdminPlatformBillingConfig;
  paypalSecrets: {
    enabled: boolean;
    env: PayPalEnv;
    checkoutMode: PayPalCheckoutMode;
    clientId: string;
    clientSecret: string;
    webhookId: string;
    currency: PayPalCurrency;
    madPerUnit: number;
    planPrices: Partial<Record<SubscriptionPlan, number>>;
  };
}

function cleanStr(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parseBoolEnv(raw: string | undefined): boolean | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return undefined;
}

function normalizePayPalEnv(raw: unknown): PayPalEnv {
  return String(raw || '').trim().toLowerCase() === 'live'
    ? 'live'
    : 'sandbox';
}

function normalizeCheckoutMode(raw: unknown): PayPalCheckoutMode {
  return String(raw || '').trim().toLowerCase() === 'standard'
    ? 'standard'
    : 'expanded';
}

function normalizeCurrency(raw: unknown): PayPalCurrency {
  return String(raw || '').trim().toUpperCase() === 'USD' ? 'USD' : 'EUR';
}

function parsePositiveNumber(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 && n < 1_000_000
    ? Number(n.toFixed(4))
    : undefined;
}

export function normalizeMoroccanRib(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export function formatMoroccanRib(raw: string): string {
  const digits = normalizeMoroccanRib(raw);
  if (!/^\d{24}$/.test(digits)) return raw.trim();
  return digits.replace(/^(\d{3})(\d{3})(\d{16})(\d{2})$/, '$1 $2 $3 $4');
}

function sanitizePlanPrices(
  raw: unknown,
): Partial<Record<SubscriptionPlan, number>> {
  const input =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const result: Partial<Record<SubscriptionPlan, number>> = {};
  for (const plan of ['starter', 'professional', 'enterprise'] as const) {
    const val = parsePositiveNumber(input[plan]);
    if (val !== undefined) {
      result[plan] = Number(val.toFixed(2));
    }
  }
  return result;
}

function readEnvDefaults(env: NodeJS.ProcessEnv = process.env) {
  const clientId = cleanStr(env.PAYPAL_CLIENT_ID, 300);
  const clientSecret = cleanStr(env.PAYPAL_CLIENT_SECRET, 300);
  const webhookId = cleanStr(env.PAYPAL_WEBHOOK_ID, 200);
  const paypalEnv = normalizePayPalEnv(env.PAYPAL_ENV);
  const checkoutMode = normalizeCheckoutMode(env.PAYPAL_CHECKOUT_MODE);
  const currency = normalizeCurrency(env.PAYPAL_CURRENCY);
  const madPerUnit = parsePositiveNumber(env.PAYPAL_MAD_PER_UNIT) ?? 10;
  const planPrices = sanitizePlanPrices({
    starter: env.PAYPAL_PRICE_STARTER,
    professional: env.PAYPAL_PRICE_PRO,
    enterprise: env.PAYPAL_PRICE_ENTERPRISE,
  });
  const explicitPayPalEnabled = parseBoolEnv(env.PAYPAL_ENABLED);
  const paypalEnabled =
    explicitPayPalEnabled ?? Boolean(clientId && clientSecret);

  const bankName = cleanStr(env.SUBSCRIPTION_BANK_NAME, 120);
  const accountHolder = cleanStr(env.SUBSCRIPTION_BANK_HOLDER, 160);
  const rib = formatMoroccanRib(cleanStr(env.SUBSCRIPTION_BANK_RIB, 64));
  const iban = cleanStr(env.SUBSCRIPTION_BANK_IBAN, 64).toUpperCase();
  const swift = cleanStr(env.SUBSCRIPTION_BANK_SWIFT, 32).toUpperCase();
  const ice = cleanStr(env.SUBSCRIPTION_BANK_ICE, 40);
  const instructionsFr =
    cleanStr(env.SUBSCRIPTION_BANK_INSTRUCTIONS_FR, 1500) ||
    DEFAULT_BANK_INSTRUCTIONS_FR;
  const instructionsAr =
    cleanStr(env.SUBSCRIPTION_BANK_INSTRUCTIONS_AR, 1500) ||
    DEFAULT_BANK_INSTRUCTIONS_AR;
  const explicitBankEnabled = parseBoolEnv(env.SUBSCRIPTION_BANK_ENABLED);
  const bankEnabled =
    explicitBankEnabled ??
    Boolean(bankName && accountHolder && /^\d{24}$/.test(normalizeMoroccanRib(rib)));

  return {
    paypal: {
      enabled: paypalEnabled,
      env: paypalEnv,
      checkoutMode,
      clientId,
      clientSecret,
      webhookId,
      currency,
      madPerUnit,
      planPrices,
    },
    bankTransfer: {
      enabled: bankEnabled,
      bankName,
      accountHolder,
      rib,
      iban,
      swift,
      ice,
      instructionsFr,
      instructionsAr,
      hasEnvConfig: Boolean(bankName || accountHolder || rib || explicitBankEnabled !== undefined),
    },
  };
}

export function resolvePlatformBillingConfig(
  state: State,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedPlatformBillingConfig {
  const defaults = readEnvDefaults(env);
  const stored = (state.__platformBillingConfig || {}) as StoredPlatformBillingConfig;
  const storedPaypal = stored.paypal;
  const storedBank = stored.bankTransfer;

  let clientSecret = '';
  let clientSecretSource: BillingConfigSource = 'none';
  if (storedPaypal?.clearClientSecret) {
    clientSecret = '';
    clientSecretSource = 'none';
  } else if (storedPaypal?.encryptedClientSecret) {
    clientSecret = decrypt(storedPaypal.encryptedClientSecret);
    clientSecretSource = 'admin';
  } else if (defaults.paypal.clientSecret) {
    clientSecret = defaults.paypal.clientSecret;
    clientSecretSource = 'env';
  }

  let webhookId = '';
  let webhookIdSource: BillingConfigSource = 'none';
  if (storedPaypal?.clearWebhookId) {
    webhookId = '';
    webhookIdSource = 'none';
  } else if (storedPaypal?.encryptedWebhookId) {
    webhookId = decrypt(storedPaypal.encryptedWebhookId);
    webhookIdSource = 'admin';
  } else if (defaults.paypal.webhookId) {
    webhookId = defaults.paypal.webhookId;
    webhookIdSource = 'env';
  }

  const paypalEnv = storedPaypal
    ? normalizePayPalEnv(storedPaypal.env)
    : defaults.paypal.env;
  const checkoutMode = storedPaypal
    ? normalizeCheckoutMode(storedPaypal.checkoutMode)
    : defaults.paypal.checkoutMode;
  const clientId = storedPaypal
    ? cleanStr(storedPaypal.clientId, 300)
    : defaults.paypal.clientId;
  const currency = storedPaypal
    ? normalizeCurrency(storedPaypal.currency)
    : defaults.paypal.currency;
  const madPerUnit = storedPaypal
    ? parsePositiveNumber(storedPaypal.madPerUnit) ?? defaults.paypal.madPerUnit
    : defaults.paypal.madPerUnit;
  const planPrices = storedPaypal
    ? sanitizePlanPrices(storedPaypal.planPrices)
    : defaults.paypal.planPrices;
  const paypalEnabled = Boolean(
    (storedPaypal ? storedPaypal.enabled : defaults.paypal.enabled) &&
      clientId &&
      clientSecret,
  );

  const bankEnabled = Boolean(
    storedBank ? storedBank.enabled : defaults.bankTransfer.enabled,
  );
  const bankName = storedBank
    ? cleanStr(storedBank.bankName, 120)
    : defaults.bankTransfer.bankName;
  const accountHolder = storedBank
    ? cleanStr(storedBank.accountHolder, 160)
    : defaults.bankTransfer.accountHolder;
  const rib = storedBank
    ? formatMoroccanRib(cleanStr(storedBank.rib, 64))
    : defaults.bankTransfer.rib;
  const iban = storedBank
    ? cleanStr(storedBank.iban, 64).toUpperCase()
    : defaults.bankTransfer.iban;
  const swift = storedBank
    ? cleanStr(storedBank.swift, 32).toUpperCase()
    : defaults.bankTransfer.swift;
  const ice = storedBank
    ? cleanStr(storedBank.ice, 40)
    : defaults.bankTransfer.ice;
  const instructionsFr =
    (storedBank
      ? cleanStr(storedBank.instructionsFr, 1500)
      : defaults.bankTransfer.instructionsFr) || DEFAULT_BANK_INSTRUCTIONS_FR;
  const instructionsAr =
    (storedBank
      ? cleanStr(storedBank.instructionsAr, 1500)
      : defaults.bankTransfer.instructionsAr) || DEFAULT_BANK_INSTRUCTIONS_AR;

  const bankSource: 'admin' | 'env' | 'default' = storedBank
    ? 'admin'
    : defaults.bankTransfer.hasEnvConfig
      ? 'env'
      : 'default';

  const publicConfig: PublicPlatformBillingConfig = {
    paypal: {
      enabled: paypalEnabled,
      env: paypalEnv,
      checkoutMode,
      clientId: paypalEnabled ? clientId : '',
      currency,
      madPerUnit,
      planPrices,
    },
    bankTransfer: {
      enabled:
        bankEnabled &&
        Boolean(bankName && accountHolder && /^\d{24}$/.test(normalizeMoroccanRib(rib))),
      bankName,
      accountHolder,
      rib,
      iban,
      swift,
      ice,
      instructionsFr,
      instructionsAr,
    },
  };

  const adminConfig: AdminPlatformBillingConfig = {
    paypal: {
      enabled: storedPaypal ? Boolean(storedPaypal.enabled) : defaults.paypal.enabled,
      env: paypalEnv,
      checkoutMode,
      clientId,
      currency,
      madPerUnit,
      planPrices,
      hasClientSecret: Boolean(clientSecret),
      clientSecretSource,
      hasWebhookId: Boolean(webhookId),
      webhookIdSource,
      envDefaults: {
        enabled: defaults.paypal.enabled,
        env: defaults.paypal.env,
        checkoutMode: defaults.paypal.checkoutMode,
        clientId: defaults.paypal.clientId,
        hasClientSecret: Boolean(defaults.paypal.clientSecret),
        hasWebhookId: Boolean(defaults.paypal.webhookId),
        currency: defaults.paypal.currency,
        madPerUnit: defaults.paypal.madPerUnit,
      },
    },
    bankTransfer: {
      enabled: bankEnabled,
      bankName,
      accountHolder,
      rib,
      iban,
      swift,
      ice,
      instructionsFr,
      instructionsAr,
      source: bankSource,
    },
    updatedAt: stored.updatedAt,
    updatedBy: stored.updatedBy,
  };

  return {
    publicConfig,
    adminConfig,
    paypalSecrets: {
      enabled: paypalEnabled,
      env: paypalEnv,
      checkoutMode,
      clientId,
      clientSecret,
      webhookId,
      currency,
      madPerUnit,
      planPrices,
    },
  };
}

export function updatePlatformBillingConfig(
  state: State,
  actorUid: string,
  input: AdminBillingConfigUpdateInput,
  env: NodeJS.ProcessEnv = process.env,
): AdminPlatformBillingConfig {
  if (input?.resetToEnv) {
    delete state.__platformBillingConfig;
    return resolvePlatformBillingConfig(state, env).adminConfig;
  }

  const prev = (state.__platformBillingConfig || {}) as StoredPlatformBillingConfig;
  const envDefaults = readEnvDefaults(env);

  const rawPaypal = input?.paypal;
  if (!rawPaypal || typeof rawPaypal !== 'object') {
    throw new OperationError('Configuration PayPal invalide.', 400);
  }
  const rawBank = input?.bankTransfer;
  if (!rawBank || typeof rawBank !== 'object') {
    throw new OperationError('Configuration bancaire invalide.', 400);
  }

  const paypalEnv = normalizePayPalEnv(rawPaypal.env);
  const checkoutMode = normalizeCheckoutMode(rawPaypal.checkoutMode);
  const currency = normalizeCurrency(rawPaypal.currency);
  const madPerUnit = parsePositiveNumber(rawPaypal.madPerUnit);
  if (madPerUnit === undefined || madPerUnit < 0.01) {
    throw new OperationError('Taux de conversion MAD invalide.', 400);
  }
  const clientId = cleanStr(rawPaypal.clientId, 300);
  const suppliedSecret = cleanStr(rawPaypal.clientSecret, 300);
  const clearSecret = Boolean(rawPaypal.clearClientSecret) && !suppliedSecret;

  let encryptedClientSecret = prev.paypal?.encryptedClientSecret;
  let clearClientSecretFlag = clearSecret || Boolean(prev.paypal?.clearClientSecret);
  if (suppliedSecret) {
    encryptedClientSecret = encrypt(suppliedSecret);
    clearClientSecretFlag = false;
  } else if (clearSecret) {
    encryptedClientSecret = undefined;
    clearClientSecretFlag = true;
  }

  const effectiveSecretAvailable = suppliedSecret
    ? true
    : clearClientSecretFlag
      ? false
      : Boolean(encryptedClientSecret || envDefaults.paypal.clientSecret);

  if (rawPaypal.enabled && (!clientId || !effectiveSecretAvailable)) {
    throw new OperationError(
      'Renseignez le Client ID et le Client Secret PayPal avant d’activer PayPal.',
      400,
    );
  }

  const suppliedWebhookId = cleanStr(rawPaypal.webhookId, 200);
  const clearWebhook = Boolean(rawPaypal.clearWebhookId) && !suppliedWebhookId;
  let encryptedWebhookId = prev.paypal?.encryptedWebhookId;
  let clearWebhookIdFlag = clearWebhook || Boolean(prev.paypal?.clearWebhookId);
  if (suppliedWebhookId) {
    encryptedWebhookId = encrypt(suppliedWebhookId);
    clearWebhookIdFlag = false;
  } else if (clearWebhook) {
    encryptedWebhookId = undefined;
    clearWebhookIdFlag = true;
  }

  const ribRaw = cleanStr(rawBank.rib, 64);
  const ribDigits = normalizeMoroccanRib(ribRaw);
  if (ribDigits && !/^\d{24}$/.test(ribDigits)) {
    throw new OperationError(
      'RIB marocain invalide : saisissez exactement 24 chiffres.',
      400,
    );
  }

  const bankName = cleanStr(rawBank.bankName, 120);
  const accountHolder = cleanStr(rawBank.accountHolder, 160);
  if (rawBank.enabled) {
    if (bankName.length < 2 || accountHolder.length < 2) {
      throw new OperationError(
        'Renseignez le nom de la banque et le titulaire du compte avant d’activer le virement bancaire.',
        400,
      );
    }
    if (!/^\d{24}$/.test(ribDigits)) {
      throw new OperationError(
        'Saisissez un RIB marocain complet à 24 chiffres avant d’activer le virement bancaire.',
        400,
      );
    }
  }

  const nextPaypal: NonNullable<StoredPlatformBillingConfig['paypal']> = {
    enabled: Boolean(rawPaypal.enabled),
    env: paypalEnv,
    checkoutMode,
    clientId,
    currency,
    madPerUnit,
    planPrices: sanitizePlanPrices(rawPaypal.planPrices),
  };
  if (encryptedClientSecret) {
    nextPaypal.encryptedClientSecret = encryptedClientSecret;
  }
  if (clearClientSecretFlag) {
    nextPaypal.clearClientSecret = true;
  }
  if (encryptedWebhookId) {
    nextPaypal.encryptedWebhookId = encryptedWebhookId;
  }
  if (clearWebhookIdFlag) {
    nextPaypal.clearWebhookId = true;
  }

  const nextConfig: StoredPlatformBillingConfig = {
    paypal: nextPaypal,
    bankTransfer: {
      enabled: Boolean(rawBank.enabled),
      bankName,
      accountHolder,
      rib: ribDigits ? formatMoroccanRib(ribDigits) : '',
      iban: cleanStr(rawBank.iban, 64).toUpperCase(),
      swift: cleanStr(rawBank.swift, 32).toUpperCase(),
      ice: cleanStr(rawBank.ice, 40),
      instructionsFr:
        cleanStr(rawBank.instructionsFr, 1500) || DEFAULT_BANK_INSTRUCTIONS_FR,
      instructionsAr:
        cleanStr(rawBank.instructionsAr, 1500) || DEFAULT_BANK_INSTRUCTIONS_AR,
    },
    updatedAt: new Date().toISOString(),
    updatedBy: actorUid,
  };

  state.__platformBillingConfig = nextConfig;
  return resolvePlatformBillingConfig(state, env).adminConfig;
}

export function rotatePlatformBillingConfigSecrets(state: State): void {
  const stored = state.__platformBillingConfig as
    | StoredPlatformBillingConfig
    | undefined;
  if (!stored?.paypal) return;
  for (const field of ['encryptedClientSecret', 'encryptedWebhookId'] as const) {
    const val = stored.paypal[field];
    if (typeof val === 'string' && needsEncryptionRotation(val)) {
      stored.paypal[field] = encrypt(decrypt(val));
    }
  }
}

export function computeSubscriptionPricing(
  config: PublicPlatformBillingConfig,
  plan: SubscriptionPlan,
  months: number,
) {
  const safeMonths = Math.max(1, Math.min(12, Math.trunc(months)));
  const monthlyMad = PLANS[plan].price;
  const amountMad = monthlyMad * safeMonths;
  const amountMadCents = Math.round(amountMad * 100);
  const overrideMonthly = config.paypal.planPrices[plan];
  const monthlyPaypalCents =
    typeof overrideMonthly === 'number' && overrideMonthly > 0
      ? Math.round(overrideMonthly * 100)
      : Math.max(100, Math.round((monthlyMad / config.paypal.madPerUnit) * 100));
  const paypalCents = Math.max(100, monthlyPaypalCents * safeMonths);
  const paypalAmount = Number((paypalCents / 100).toFixed(2));
  return {
    amountMad,
    amountMadCents,
    paypalCurrency: config.paypal.currency,
    paypalCents,
    paypalAmount,
    paypalAmountString: paypalAmount.toFixed(2),
  };
}

export function getPayPalApiBase(paypalEnv: PayPalEnv): string {
  if (
    process.env.NODE_ENV !== 'production' &&
    typeof process.env.PAYPAL_API_BASE === 'string' &&
    process.env.PAYPAL_API_BASE.trim()
  ) {
    return process.env.PAYPAL_API_BASE.trim().replace(/\/+$/, '');
  }
  return paypalEnv === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export async function getPayPalAccessToken(creds: {
  env: PayPalEnv;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  if (!creds.clientId || !creds.clientSecret) {
    throw new OperationError('Identifiants PayPal manquants.', 503);
  }
  const base = getPayPalApiBase(creds.env);
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString(
    'base64',
  );
  let res: Response;
  try {
    res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
  } catch {
    throw new OperationError('Connexion au serveur PayPal impossible.', 502);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.access_token !== 'string' || !data.access_token) {
    const desc =
      typeof data.error_description === 'string'
        ? data.error_description
        : 'Authentification PayPal refusée.';
    throw new OperationError(desc, res.status === 401 ? 400 : 502);
  }
  return data.access_token;
}

export interface PayPalOrderCaptureSummary {
  orderId: string;
  status: string;
  customId?: string;
  captureId?: string;
  captureStatus?: string;
  currency?: string;
  amountCents?: number;
  hasCardPaymentSource: boolean;
}

export function extractPayPalOrderSummary(
  data: Record<string, unknown>,
): PayPalOrderCaptureSummary {
  const orderId = String(data.id || '');
  const status = String(data.status || '');
  const units = Array.isArray(data.purchase_units) ? data.purchase_units : [];
  const firstUnit = (units[0] || {}) as Record<string, unknown>;
  const payments = (firstUnit.payments || {}) as Record<string, unknown>;
  const captures = Array.isArray(payments.captures) ? payments.captures : [];
  const firstCapture = (captures[0] || {}) as Record<string, unknown>;
  const captureAmount = (firstCapture.amount ||
    firstUnit.amount ||
    {}) as Record<string, unknown>;
  const customId =
    typeof firstCapture.custom_id === 'string'
      ? firstCapture.custom_id
      : typeof firstUnit.custom_id === 'string'
        ? firstUnit.custom_id
        : undefined;
  const parsedAmount = Number(captureAmount.value);
  const amountCents = Number.isFinite(parsedAmount)
    ? Math.round(parsedAmount * 100)
    : undefined;
  const paymentSource =
    data.payment_source && typeof data.payment_source === 'object'
      ? (data.payment_source as Record<string, unknown>)
      : {};
  return {
    orderId,
    status,
    customId,
    captureId: firstCapture.id ? String(firstCapture.id) : undefined,
    captureStatus: firstCapture.status ? String(firstCapture.status) : undefined,
    currency: captureAmount.currency_code
      ? String(captureAmount.currency_code).toUpperCase()
      : undefined,
    amountCents,
    hasCardPaymentSource: Boolean(paymentSource.card),
  };
}

export async function createPayPalOrder(
  creds: { env: PayPalEnv; clientId: string; clientSecret: string },
  params: {
    currency: PayPalCurrency;
    amountValue: string;
    customId: string;
    requestId: string;
    description: string;
    paymentSourceHint?: 'paypal' | 'card';
  },
): Promise<{ orderId: string; status: string }> {
  const token = await getPayPalAccessToken(creds);
  const base = getPayPalApiBase(creds.env);
  const bodyPayload: Record<string, unknown> = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: params.customId,
        custom_id: params.customId,
        description: params.description.slice(0, 127),
        amount: {
          currency_code: params.currency,
          value: params.amountValue,
        },
      },
    ],
  };
  if (params.paymentSourceHint === 'card') {
    bodyPayload.payment_source = {
      card: {
        attributes: {
          verification: {
            method: 'SCA_WHEN_REQUIRED',
          },
        },
      },
    };
  }
  let res: Response;
  try {
    res = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': params.requestId,
      },
      body: JSON.stringify(bodyPayload),
    });
  } catch {
    throw new OperationError('Création de commande PayPal impossible.', 502);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof data.id !== 'string' || !data.id) {
    const details = Array.isArray(data.details) ? data.details : [];
    const issue = (details[0] as Record<string, unknown> | undefined)
      ?.description;
    throw new OperationError(
      typeof issue === 'string' && issue
        ? issue
        : 'PayPal a refusé la création de la commande.',
      502,
    );
  }
  return { orderId: data.id, status: String(data.status || 'CREATED') };
}

export async function getPayPalOrder(
  creds: { env: PayPalEnv; clientId: string; clientSecret: string },
  orderId: string,
): Promise<PayPalOrderCaptureSummary> {
  const token = await getPayPalAccessToken(creds);
  const base = getPayPalApiBase(creds.env);
  let res: Response;
  try {
    res = await fetch(
      `${base}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
      {
        method: 'GET',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      },
    );
  } catch {
    throw new OperationError('Lecture de commande PayPal impossible.', 502);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !data.id) {
    throw new OperationError('Commande PayPal introuvable.', 404);
  }
  return extractPayPalOrderSummary(data);
}

export async function capturePayPalOrder(
  creds: { env: PayPalEnv; clientId: string; clientSecret: string },
  orderId: string,
): Promise<PayPalOrderCaptureSummary> {
  const token = await getPayPalAccessToken(creds);
  const base = getPayPalApiBase(creds.env);
  let res: Response;
  try {
    res = await fetch(
      `${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
      {
        method: 'POST',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `capture:${orderId}`,
        },
        body: '{}',
      },
    );
  } catch {
    throw new OperationError('Capture PayPal impossible.', 502);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const details = Array.isArray(data.details) ? data.details : [];
    const issueCode = String(
      (details[0] as Record<string, unknown> | undefined)?.issue || '',
    );
    if (res.status === 422 && issueCode === 'ORDER_ALREADY_CAPTURED') {
      return getPayPalOrder(creds, orderId);
    }
    const msg = String(
      (details[0] as Record<string, unknown> | undefined)?.description ||
        data.message ||
        'La capture PayPal a échoué.',
    );
    throw new OperationError(msg, res.status >= 400 && res.status < 500 ? 402 : 502);
  }
  return extractPayPalOrderSummary(data);
}

export async function verifyPayPalWebhookSignature(
  creds: { env: PayPalEnv; clientId: string; clientSecret: string },
  params: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
    webhookId: string;
    webhookEvent: unknown;
  },
): Promise<boolean> {
  const token = await getPayPalAccessToken(creds);
  const base = getPayPalApiBase(creds.env);
  let res: Response;
  try {
    res = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: params.authAlgo,
        cert_url: params.certUrl,
        transmission_id: params.transmissionId,
        transmission_sig: params.transmissionSig,
        transmission_time: params.transmissionTime,
        webhook_id: params.webhookId,
        webhook_event: params.webhookEvent,
      }),
    });
  } catch {
    return false;
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return res.ok && String(data.verification_status || '').toUpperCase() === 'SUCCESS';
}
