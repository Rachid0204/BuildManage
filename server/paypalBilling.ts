import crypto from 'node:crypto';
import type {
  AdminBillingConfigUpdateInput,
  AdminPlatformBillingConfig,
  BillingConfigSource,
  CashChannel,
  CmiCurrencyCode,
  CmiEnv,
  GatewayEventRecord,
  PayPalCheckoutMode,
  PayPalCurrency,
  PayPalEnv,
  PlatformCommercialPolicy,
  PlatformIssuerProfile,
  PublicCashPaymentConfig,
  PublicCmiConfig,
  PublicPlatformBillingConfig,
  SubscriptionPlan,
  SubscriptionPromoCode,
} from '../types';
import { PLANS } from '../shared/domain/subscription';
import {
  getCmiCurrencyLabel,
  getCmiGatewayUrl,
  normalizeCmiCurrencyCode,
  normalizeCmiEnv,
} from './cmiBilling';
import { OperationError } from './domain/errors';
import { decrypt, encrypt, needsEncryptionRotation } from './mailer';
import type { State } from './repository';

const DEFAULT_BANK_INSTRUCTIONS_FR =
  'Effectuez le virement vers le RIB ci-dessus en indiquant le motif recommandé, puis importez votre reçu ou saisissez la référence bancaire ci-dessous. Activation sous quelques heures après vérification par notre équipe.';
const DEFAULT_BANK_INSTRUCTIONS_AR =
  'قم بإجراء التحويل البنكي إلى رقم RIB أعلاه مع إدراج المرجع المقترح، ثم أرفق وصل التحويل أو أدخل المرجع البنكي أدناه. يتم تفعيل الاشتراك خلال ساعات بعد التحقق.';

const DEFAULT_CASH_INSTRUCTIONS_FR =
  'Réglez en espèces à notre bureau ou via une agence partenaire (Wafacash / Cash Plus / Barid Cash) au nom du bénéficiaire ci-dessus, puis saisissez le code/numéro de reçu et importez la photo du reçu pour validation rapide.';
const DEFAULT_CASH_INSTRUCTIONS_AR =
  'قم بالدفع نقداً بمكتبنا أو عبر وكالة شريكة (وفاكاش / كاش بلوس / بريد كاش) باسم المستفيد أعلاه، ثم أدخل رقم الوصل وأرفق صورته لتفعيل اشتراككم بسرعة.';

const ALLOWED_CASH_CHANNELS: readonly CashChannel[] = [
  'office',
  'wafacash',
  'cashplus',
  'baridcash',
  'check',
];

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
    allowLiveWithoutWebhook?: boolean;
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
  cmi?: {
    enabled: boolean;
    env: CmiEnv;
    clientId: string;
    encryptedStoreKey?: string;
    clearStoreKey?: boolean;
    currencyCode: CmiCurrencyCode;
    lang: 'fr' | 'ar';
    shopUrl: string;
  };
  cashPayment?: {
    enabled: boolean;
    acceptedChannels: CashChannel[];
    beneficiaryName: string;
    officeAddress: string;
    officeHours: string;
    contactPhone: string;
    whatsapp: string;
    maxCashAmountMad: number;
    requireProofUpload: boolean;
    instructionsFr: string;
    instructionsAr: string;
  };
  issuerProfile?: PlatformIssuerProfile;
  commercialPolicy?: PlatformCommercialPolicy;
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
  cmiSecrets: {
    enabled: boolean;
    env: CmiEnv;
    clientId: string;
    storeKey: string;
    currencyCode: CmiCurrencyCode;
    currencyLabel: 'MAD' | 'EUR' | 'USD';
    lang: 'fr' | 'ar';
    shopUrl: string;
    gatewayUrl: string;
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

function clampDiscountPct(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(50, Math.round(n * 100) / 100);
}

function clampGraceDays(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(30, Math.trunc(n));
}

export function maskSecretFingerprint(secret: string): string | undefined {
  const trimmed = secret.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export function normalizeMoroccanRib(raw: string): string {
  return raw.replace(/\s+/g, '');
}

export function formatMoroccanRib(raw: string): string {
  const digits = normalizeMoroccanRib(raw);
  if (!/^\d{24}$/.test(digits)) return raw.trim();
  return digits.replace(/^(\d{3})(\d{3})(\d{16})(\d{2})$/, '$1 $2 $3 $4');
}

export function validateMoroccanIban(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (!compact) return '';
  if (compact.startsWith('MA')) {
    if (!/^MA\d{26}$/.test(compact)) {
      throw new OperationError(
        'IBAN marocain invalide : doit commencer par MA suivi de 26 chiffres (28 caractères).',
        400,
      );
    }
    return compact;
  }
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) {
    throw new OperationError('Format IBAN invalide.', 400);
  }
  return compact;
}

export function validateSwiftBic(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  if (!compact) return '';
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact)) {
    throw new OperationError(
      'Code SWIFT / BIC invalide (8 ou 11 caractères alphanumériques, ex: BCMAMAMC).',
      400,
    );
  }
  return compact;
}

export function validateMoroccanIce(raw: string): string {
  const digits = raw.replace(/\s+/g, '');
  if (!digits) return '';
  if (!/^\d{15}$/.test(digits)) {
    throw new OperationError(
      'ICE marocain invalide : saisissez exactement 15 chiffres.',
      400,
    );
  }
  return digits;
}

function sanitizePrefix(raw: unknown, fallback: string): string {
  const cleaned = cleanStr(raw, 8)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return cleaned.length >= 2 ? cleaned : fallback;
}

function sanitizeCashChannels(raw: unknown): CashChannel[] {
  if (!Array.isArray(raw)) return ['office', 'wafacash', 'cashplus'];
  const unique = new Set<CashChannel>();
  for (const item of raw) {
    if (
      typeof item === 'string' &&
      (ALLOWED_CASH_CHANNELS as readonly string[]).includes(item)
    ) {
      unique.add(item as CashChannel);
    }
  }
  return Array.from(unique);
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

  // CMI Morocco defaults
  const cmiClientId = cleanStr(env.CMI_CLIENT_ID, 120);
  const cmiStoreKey = cleanStr(env.CMI_STORE_KEY, 256);
  const cmiEnv = normalizeCmiEnv(env.CMI_ENV);
  const cmiCurrencyCode = normalizeCmiCurrencyCode(env.CMI_CURRENCY);
  const cmiLang: 'fr' | 'ar' =
    cleanStr(env.CMI_LANG, 10).toLowerCase() === 'ar' ? 'ar' : 'fr';
  const cmiShopUrl = cleanStr(env.CMI_SHOP_URL, 300);
  const explicitCmiEnabled = parseBoolEnv(env.CMI_ENABLED);
  const cmiEnabled =
    explicitCmiEnabled ?? Boolean(cmiClientId && cmiStoreKey);

  // Cash / Agency defaults
  const cashBeneficiary = cleanStr(env.SUBSCRIPTION_CASH_BENEFICIARY, 160);
  const cashOfficeAddress = cleanStr(env.SUBSCRIPTION_CASH_ADDRESS, 300);
  const cashOfficeHours = cleanStr(env.SUBSCRIPTION_CASH_HOURS, 120);
  const cashPhone = cleanStr(env.SUBSCRIPTION_CASH_PHONE, 40);
  const cashWhatsapp = cleanStr(env.SUBSCRIPTION_CASH_WHATSAPP, 40);
  const cashMaxRaw = Number(env.SUBSCRIPTION_CASH_MAX_MAD);
  const cashMaxAmountMad =
    Number.isFinite(cashMaxRaw) && cashMaxRaw >= 0 ? Math.round(cashMaxRaw) : 5000;
  const cashRequireProof =
    parseBoolEnv(env.SUBSCRIPTION_CASH_REQUIRE_PROOF) ?? true;
  const cashInstructionsFr =
    cleanStr(env.SUBSCRIPTION_CASH_INSTRUCTIONS_FR, 1500) ||
    DEFAULT_CASH_INSTRUCTIONS_FR;
  const cashInstructionsAr =
    cleanStr(env.SUBSCRIPTION_CASH_INSTRUCTIONS_AR, 1500) ||
    DEFAULT_CASH_INSTRUCTIONS_AR;
  const explicitCashEnabled = parseBoolEnv(env.SUBSCRIPTION_CASH_ENABLED);
  const cashEnabled =
    explicitCashEnabled ?? Boolean(cashBeneficiary && cashOfficeAddress);

  const issuerProfile: PlatformIssuerProfile = {
    companyName: cleanStr(env.PLATFORM_COMPANY_NAME, 160) || 'ImmoGest Maroc',
    legalForm: cleanStr(env.PLATFORM_LEGAL_FORM, 40) || 'SARL',
    ice: cleanStr(env.PLATFORM_ICE, 20) || ice,
    rc: cleanStr(env.PLATFORM_RC, 40),
    ifNumber: cleanStr(env.PLATFORM_IF, 40),
    patente: cleanStr(env.PLATFORM_PATENTE, 40),
    cnss: cleanStr(env.PLATFORM_CNSS, 40),
    address: cleanStr(env.PLATFORM_ADDRESS, 250) || cashOfficeAddress,
    city: cleanStr(env.PLATFORM_CITY, 80) || 'Casablanca',
    email: cleanStr(env.PLATFORM_SUPPORT_EMAIL, 120),
    phone: cleanStr(env.PLATFORM_SUPPORT_PHONE, 40) || cashPhone,
    whatsapp: cleanStr(env.PLATFORM_SUPPORT_WHATSAPP, 40) || cashWhatsapp,
    vatRate: Number(env.PLATFORM_VAT_RATE) === 20 ? 20 : 0,
    invoicePrefix: sanitizePrefix(env.PLATFORM_INVOICE_PREFIX, 'FAC'),
    receiptPrefix: sanitizePrefix(env.PLATFORM_RECEIPT_PREFIX, 'REC'),
  };

  const commercialPolicy: PlatformCommercialPolicy = {
    gracePeriodDays: clampGraceDays(env.SUBSCRIPTION_GRACE_PERIOD_DAYS),
    multiMonthDiscounts: {
      m3: clampDiscountPct(env.SUBSCRIPTION_DISCOUNT_3M),
      m6: clampDiscountPct(env.SUBSCRIPTION_DISCOUNT_6M),
      m12: clampDiscountPct(env.SUBSCRIPTION_DISCOUNT_12M),
    },
  };

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
      hasEnvConfig: Boolean(
        bankName || accountHolder || rib || explicitBankEnabled !== undefined,
      ),
    },
    cmi: {
      enabled: cmiEnabled,
      env: cmiEnv,
      clientId: cmiClientId,
      storeKey: cmiStoreKey,
      currencyCode: cmiCurrencyCode,
      lang: cmiLang,
      shopUrl: cmiShopUrl,
    },
    cashPayment: {
      enabled: cashEnabled,
      acceptedChannels: ['office', 'wafacash', 'cashplus'] as CashChannel[],
      beneficiaryName: cashBeneficiary,
      officeAddress: cashOfficeAddress,
      officeHours: cashOfficeHours,
      contactPhone: cashPhone,
      whatsapp: cashWhatsapp,
      maxCashAmountMad: cashMaxAmountMad,
      requireProofUpload: cashRequireProof,
      instructionsFr: cashInstructionsFr,
      instructionsAr: cashInstructionsAr,
      hasEnvConfig: Boolean(
        cashBeneficiary ||
          cashOfficeAddress ||
          explicitCashEnabled !== undefined,
      ),
    },
    issuerProfile,
    commercialPolicy,
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
  const storedCmi = stored.cmi;
  const storedCash = stored.cashPayment;
  const storedIssuer = stored.issuerProfile;
  const storedCommercial = stored.commercialPolicy;

  // --- PayPal ---
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
  const allowLiveWithoutWebhook = Boolean(storedPaypal?.allowLiveWithoutWebhook);
  const paypalEnabled = Boolean(
    (storedPaypal ? storedPaypal.enabled : defaults.paypal.enabled) &&
      clientId &&
      clientSecret,
  );

  // --- Moroccan Bank Transfer ---
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

  // --- Moroccan CMI 3D-Secure ---
  let cmiStoreKey = '';
  let cmiStoreKeySource: BillingConfigSource = 'none';
  if (storedCmi?.clearStoreKey) {
    cmiStoreKey = '';
    cmiStoreKeySource = 'none';
  } else if (storedCmi?.encryptedStoreKey) {
    cmiStoreKey = decrypt(storedCmi.encryptedStoreKey);
    cmiStoreKeySource = 'admin';
  } else if (defaults.cmi.storeKey) {
    cmiStoreKey = defaults.cmi.storeKey;
    cmiStoreKeySource = 'env';
  }
  const cmiEnv = storedCmi ? normalizeCmiEnv(storedCmi.env) : defaults.cmi.env;
  const cmiClientId = storedCmi
    ? cleanStr(storedCmi.clientId, 120)
    : defaults.cmi.clientId;
  const cmiCurrencyCode = storedCmi
    ? normalizeCmiCurrencyCode(storedCmi.currencyCode)
    : defaults.cmi.currencyCode;
  const cmiLang: 'fr' | 'ar' = storedCmi
    ? storedCmi.lang === 'ar'
      ? 'ar'
      : 'fr'
    : defaults.cmi.lang;
  const cmiShopUrl = storedCmi
    ? cleanStr(storedCmi.shopUrl, 300)
    : defaults.cmi.shopUrl;
  const cmiEnabled = Boolean(
    (storedCmi ? storedCmi.enabled : defaults.cmi.enabled) &&
      cmiClientId &&
      cmiStoreKey,
  );
  const cmiGatewayUrl = getCmiGatewayUrl(cmiEnv);

  // --- Hybrid Cash / Agency / Check ---
  const cashEnabledRaw = Boolean(
    storedCash ? storedCash.enabled : defaults.cashPayment.enabled,
  );
  const acceptedChannels = storedCash
    ? sanitizeCashChannels(storedCash.acceptedChannels)
    : defaults.cashPayment.acceptedChannels;
  const beneficiaryName = storedCash
    ? cleanStr(storedCash.beneficiaryName, 160)
    : defaults.cashPayment.beneficiaryName;
  const officeAddress = storedCash
    ? cleanStr(storedCash.officeAddress, 300)
    : defaults.cashPayment.officeAddress;
  const officeHours = storedCash
    ? cleanStr(storedCash.officeHours, 120)
    : defaults.cashPayment.officeHours;
  const contactPhone = storedCash
    ? cleanStr(storedCash.contactPhone, 40)
    : defaults.cashPayment.contactPhone;
  const whatsapp = storedCash
    ? cleanStr(storedCash.whatsapp, 40)
    : defaults.cashPayment.whatsapp;
  const maxCashAmountMad =
    storedCash &&
    Number.isFinite(Number(storedCash.maxCashAmountMad)) &&
    Number(storedCash.maxCashAmountMad) >= 0
      ? Math.round(Number(storedCash.maxCashAmountMad))
      : defaults.cashPayment.maxCashAmountMad;
  const requireProofUpload = storedCash
    ? Boolean(storedCash.requireProofUpload)
    : defaults.cashPayment.requireProofUpload;
  const cashInstructionsFr =
    (storedCash
      ? cleanStr(storedCash.instructionsFr, 1500)
      : defaults.cashPayment.instructionsFr) || DEFAULT_CASH_INSTRUCTIONS_FR;
  const cashInstructionsAr =
    (storedCash
      ? cleanStr(storedCash.instructionsAr, 1500)
      : defaults.cashPayment.instructionsAr) || DEFAULT_CASH_INSTRUCTIONS_AR;
  const cashSource: 'admin' | 'env' | 'default' = storedCash
    ? 'admin'
    : defaults.cashPayment.hasEnvConfig
      ? 'env'
      : 'default';
  const cashPublicEnabled = Boolean(
    cashEnabledRaw && acceptedChannels.length > 0 && beneficiaryName.length >= 2,
  );

  // --- Moroccan Platform Issuer Profile ---
  const issuerProfile: PlatformIssuerProfile = {
    companyName:
      cleanStr(storedIssuer?.companyName, 160) ||
      defaults.issuerProfile.companyName,
    legalForm:
      cleanStr(storedIssuer?.legalForm, 40) || defaults.issuerProfile.legalForm,
    ice: cleanStr(storedIssuer?.ice, 20) || defaults.issuerProfile.ice,
    rc: cleanStr(storedIssuer?.rc, 40) || defaults.issuerProfile.rc,
    ifNumber:
      cleanStr(storedIssuer?.ifNumber, 40) || defaults.issuerProfile.ifNumber,
    patente:
      cleanStr(storedIssuer?.patente, 40) || defaults.issuerProfile.patente,
    cnss: cleanStr(storedIssuer?.cnss, 40) || defaults.issuerProfile.cnss,
    address:
      cleanStr(storedIssuer?.address, 250) || defaults.issuerProfile.address,
    city: cleanStr(storedIssuer?.city, 80) || defaults.issuerProfile.city,
    email: cleanStr(storedIssuer?.email, 120) || defaults.issuerProfile.email,
    phone: cleanStr(storedIssuer?.phone, 40) || defaults.issuerProfile.phone,
    whatsapp:
      cleanStr(storedIssuer?.whatsapp, 40) || defaults.issuerProfile.whatsapp,
    vatRate:
      storedIssuer?.vatRate === 20 || storedIssuer?.vatRate === 0
        ? storedIssuer.vatRate
        : defaults.issuerProfile.vatRate,
    invoicePrefix: sanitizePrefix(
      storedIssuer?.invoicePrefix,
      defaults.issuerProfile.invoicePrefix,
    ),
    receiptPrefix: sanitizePrefix(
      storedIssuer?.receiptPrefix,
      defaults.issuerProfile.receiptPrefix,
    ),
  };

  // --- Commercial Policy (Grace period & Multi-month discounts) ---
  const commercialPolicy: PlatformCommercialPolicy = {
    gracePeriodDays: storedCommercial
      ? clampGraceDays(storedCommercial.gracePeriodDays)
      : defaults.commercialPolicy.gracePeriodDays,
    multiMonthDiscounts: {
      m3: storedCommercial
        ? clampDiscountPct(storedCommercial.multiMonthDiscounts?.m3)
        : defaults.commercialPolicy.multiMonthDiscounts.m3,
      m6: storedCommercial
        ? clampDiscountPct(storedCommercial.multiMonthDiscounts?.m6)
        : defaults.commercialPolicy.multiMonthDiscounts.m6,
      m12: storedCommercial
        ? clampDiscountPct(storedCommercial.multiMonthDiscounts?.m12)
        : defaults.commercialPolicy.multiMonthDiscounts.m12,
    },
  };

  const bankPublicEnabled =
    bankEnabled &&
    Boolean(bankName && accountHolder && /^\d{24}$/.test(normalizeMoroccanRib(rib)));

  const publicCmi: PublicCmiConfig = {
    enabled: cmiEnabled,
    env: cmiEnv,
    clientId: cmiEnabled ? cmiClientId : '',
    currencyCode: cmiCurrencyCode,
    currencyLabel: getCmiCurrencyLabel(cmiCurrencyCode),
    storeType: '3D_PAY_HOSTING',
    lang: cmiLang,
    shopUrl: cmiShopUrl,
    gatewayUrl: cmiGatewayUrl,
  };

  const publicCash: PublicCashPaymentConfig = {
    enabled: cashPublicEnabled,
    acceptedChannels,
    beneficiaryName,
    officeAddress,
    officeHours,
    contactPhone,
    whatsapp,
    maxCashAmountMad,
    requireProofUpload,
    instructionsFr: cashInstructionsFr,
    instructionsAr: cashInstructionsAr,
  };

  const readinessWarnings: string[] = [];
  if (!paypalEnabled && !cmiEnabled && !bankPublicEnabled && !cashPublicEnabled) {
    readinessWarnings.push(
      'Aucune passerelle de paiement active : les syndics ne peuvent pas renouveler en autonomie.',
    );
  }
  if (paypalEnabled && paypalEnv === 'sandbox') {
    readinessWarnings.push('PayPal est actif en mode Sandbox (test).');
  }
  if (paypalEnabled && paypalEnv === 'live' && !webhookId) {
    readinessWarnings.push(
      'PayPal Live actif sans Webhook ID : les remboursements et captures différées ne seront pas synchronisés.',
    );
  }
  if (cmiEnabled && cmiEnv === 'test') {
    readinessWarnings.push('CMI Maroc est actif en mode Test (testpayment.cmi.co.ma).');
  }
  if (!issuerProfile.ice) {
    readinessWarnings.push(
      'ICE émetteur manquant dans le profil de facturation Maroc (obligatoire sur les factures SaaS).',
    );
  }

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
      enabled: bankPublicEnabled,
      bankName,
      accountHolder,
      rib,
      iban,
      swift,
      ice,
      instructionsFr,
      instructionsAr,
    },
    cmi: publicCmi,
    cashPayment: publicCash,
    issuerProfile,
    commercialPolicy,
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
      ...(clientSecret ? { clientSecretFingerprint: maskSecretFingerprint(clientSecret) } : {}),
      hasWebhookId: Boolean(webhookId),
      webhookIdSource,
      ...(webhookId ? { webhookIdFingerprint: maskSecretFingerprint(webhookId) } : {}),
      allowLiveWithoutWebhook,
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
    cmi: {
      ...publicCmi,
      enabled: storedCmi ? Boolean(storedCmi.enabled) : defaults.cmi.enabled,
      clientId: cmiClientId,
      hasStoreKey: Boolean(cmiStoreKey),
      storeKeySource: cmiStoreKeySource,
      ...(cmiStoreKey ? { storeKeyFingerprint: maskSecretFingerprint(cmiStoreKey) } : {}),
      envDefaults: {
        enabled: defaults.cmi.enabled,
        env: defaults.cmi.env,
        clientId: defaults.cmi.clientId,
        hasStoreKey: Boolean(defaults.cmi.storeKey),
        currencyCode: defaults.cmi.currencyCode,
      },
    },
    cashPayment: {
      ...publicCash,
      enabled: cashEnabledRaw,
      source: cashSource,
    },
    issuerProfile,
    commercialPolicy,
    readinessWarnings,
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
    cmiSecrets: {
      enabled: cmiEnabled,
      env: cmiEnv,
      clientId: cmiClientId,
      storeKey: cmiStoreKey,
      currencyCode: cmiCurrencyCode,
      currencyLabel: getCmiCurrencyLabel(cmiCurrencyCode),
      lang: cmiLang,
      shopUrl: cmiShopUrl,
      gatewayUrl: cmiGatewayUrl,
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

  // --- PayPal validation ---
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

  const effectiveWebhookAvailable = suppliedWebhookId
    ? true
    : clearWebhookIdFlag
      ? false
      : Boolean(encryptedWebhookId || envDefaults.paypal.webhookId);
  const allowLiveWithoutWebhook = Boolean(rawPaypal.allowLiveWithoutWebhook);

  if (
    rawPaypal.enabled &&
    paypalEnv === 'live' &&
    !effectiveWebhookAvailable &&
    !allowLiveWithoutWebhook
  ) {
    throw new OperationError(
      'Configurez le Webhook ID PayPal avant d’activer le mode Live (ou activez l’exception explicite).',
      400,
    );
  }

  // --- Bank transfer validation ---
  const ribRaw = cleanStr(rawBank.rib, 64);
  const ribDigits = normalizeMoroccanRib(ribRaw);
  if (ribDigits && !/^\d{24}$/.test(ribDigits)) {
    throw new OperationError(
      'RIB marocain invalide : saisissez exactement 24 chiffres.',
      400,
    );
  }
  const validatedIban = validateMoroccanIban(cleanStr(rawBank.iban, 64));
  const validatedSwift = validateSwiftBic(cleanStr(rawBank.swift, 32));
  const validatedBankIce = validateMoroccanIce(cleanStr(rawBank.ice, 40));

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

  // --- CMI Morocco validation (optional section, preserves previous if omitted) ---
  let nextCmi = prev.cmi;
  if (input.cmi && typeof input.cmi === 'object') {
    const rawCmi = input.cmi;
    const cmiEnv = normalizeCmiEnv(rawCmi.env);
    const cmiClientId = cleanStr(rawCmi.clientId, 120);
    const cmiCurrencyCode = normalizeCmiCurrencyCode(rawCmi.currencyCode);
    const cmiLang: 'fr' | 'ar' = rawCmi.lang === 'ar' ? 'ar' : 'fr';
    const cmiShopUrl = cleanStr(rawCmi.shopUrl, 300);
    if (cmiShopUrl && !/^https?:\/\//i.test(cmiShopUrl)) {
      throw new OperationError(
        'URL boutique CMI invalide (doit commencer par https://).',
        400,
      );
    }

    const suppliedStoreKey = cleanStr(rawCmi.storeKey, 256);
    const clearStoreKey = Boolean(rawCmi.clearStoreKey) && !suppliedStoreKey;
    let encryptedStoreKey = prev.cmi?.encryptedStoreKey;
    let clearStoreKeyFlag = clearStoreKey || Boolean(prev.cmi?.clearStoreKey);
    if (suppliedStoreKey) {
      if (suppliedStoreKey.length < 8) {
        throw new OperationError(
          'Clé secrète CMI (Store Key) trop courte : minimum 8 caractères.',
          400,
        );
      }
      encryptedStoreKey = encrypt(suppliedStoreKey);
      clearStoreKeyFlag = false;
    } else if (clearStoreKey) {
      encryptedStoreKey = undefined;
      clearStoreKeyFlag = true;
    }

    const effectiveStoreKeyAvailable = suppliedStoreKey
      ? true
      : clearStoreKeyFlag
        ? false
        : Boolean(encryptedStoreKey || envDefaults.cmi.storeKey);

    if (rawCmi.enabled && (cmiClientId.length < 4 || !effectiveStoreKeyAvailable)) {
      throw new OperationError(
        'Renseignez le Client ID (min. 4 caractères) et la Store Key CMI avant d’activer CMI.',
        400,
      );
    }

    nextCmi = {
      enabled: Boolean(rawCmi.enabled),
      env: cmiEnv,
      clientId: cmiClientId,
      currencyCode: cmiCurrencyCode,
      lang: cmiLang,
      shopUrl: cmiShopUrl,
      ...(encryptedStoreKey ? { encryptedStoreKey } : {}),
      ...(clearStoreKeyFlag ? { clearStoreKey: true } : {}),
    };
  }

  // --- Cash / Agency / Check validation ---
  let nextCash = prev.cashPayment;
  if (input.cashPayment && typeof input.cashPayment === 'object') {
    const rawCash = input.cashPayment;
    const channels = sanitizeCashChannels(rawCash.acceptedChannels);
    const beneficiaryName = cleanStr(rawCash.beneficiaryName, 160);
    const officeAddress = cleanStr(rawCash.officeAddress, 300);
    const officeHours = cleanStr(rawCash.officeHours, 120);
    const contactPhone = cleanStr(rawCash.contactPhone, 40);
    const whatsapp = cleanStr(rawCash.whatsapp, 40);
    const rawMax =
      rawCash.maxCashAmountMad === undefined
        ? 5000
        : Number(rawCash.maxCashAmountMad);
    if (!Number.isFinite(rawMax) || rawMax < 0 || rawMax > 1_000_000) {
      throw new OperationError('Plafond espèces (MAD) invalide.', 400);
    }
    if (rawCash.enabled) {
      if (beneficiaryName.length < 2) {
        throw new OperationError(
          'Renseignez le nom du bénéficiaire avant d’activer le paiement en espèces.',
          400,
        );
      }
      if (channels.length === 0) {
        throw new OperationError(
          'Sélectionnez au moins un canal espèces/agence (Bureau, Wafacash, Cash Plus, Barid Cash ou Chèque).',
          400,
        );
      }
    }
    nextCash = {
      enabled: Boolean(rawCash.enabled),
      acceptedChannels: channels,
      beneficiaryName,
      officeAddress,
      officeHours,
      contactPhone,
      whatsapp,
      maxCashAmountMad: Math.round(rawMax),
      requireProofUpload:
        rawCash.requireProofUpload === undefined
          ? true
          : Boolean(rawCash.requireProofUpload),
      instructionsFr:
        cleanStr(rawCash.instructionsFr, 1500) || DEFAULT_CASH_INSTRUCTIONS_FR,
      instructionsAr:
        cleanStr(rawCash.instructionsAr, 1500) || DEFAULT_CASH_INSTRUCTIONS_AR,
    };
  }

  // --- Platform Issuer Profile ---
  let nextIssuer = prev.issuerProfile;
  if (input.issuerProfile && typeof input.issuerProfile === 'object') {
    const rawIss = input.issuerProfile;
    const issuerIce = validateMoroccanIce(cleanStr(rawIss.ice, 40));
    const issuerEmail = cleanStr(rawIss.email, 120);
    if (issuerEmail && !/^\S+@\S+\.\S+$/.test(issuerEmail)) {
      throw new OperationError('Email émetteur invalide.', 400);
    }
    nextIssuer = {
      companyName:
        cleanStr(rawIss.companyName, 160) ||
        prev.issuerProfile?.companyName ||
        envDefaults.issuerProfile.companyName,
      legalForm: cleanStr(rawIss.legalForm, 40) || 'SARL',
      ice: issuerIce,
      rc: cleanStr(rawIss.rc, 40),
      ifNumber: cleanStr(rawIss.ifNumber, 40),
      patente: cleanStr(rawIss.patente, 40),
      cnss: cleanStr(rawIss.cnss, 40),
      address: cleanStr(rawIss.address, 250),
      city: cleanStr(rawIss.city, 80) || 'Casablanca',
      email: issuerEmail,
      phone: cleanStr(rawIss.phone, 40),
      whatsapp: cleanStr(rawIss.whatsapp, 40),
      vatRate: rawIss.vatRate === 20 ? 20 : 0,
      invoicePrefix: sanitizePrefix(rawIss.invoicePrefix, 'FAC'),
      receiptPrefix: sanitizePrefix(rawIss.receiptPrefix, 'REC'),
    };
  }

  // --- Commercial Policy (Grace period + Multi-month discounts) ---
  let nextCommercial = prev.commercialPolicy;
  if (input.commercialPolicy && typeof input.commercialPolicy === 'object') {
    const rawCom = input.commercialPolicy;
    nextCommercial = {
      gracePeriodDays: clampGraceDays(rawCom.gracePeriodDays),
      multiMonthDiscounts: {
        m3: clampDiscountPct(rawCom.multiMonthDiscounts?.m3),
        m6: clampDiscountPct(rawCom.multiMonthDiscounts?.m6),
        m12: clampDiscountPct(rawCom.multiMonthDiscounts?.m12),
      },
    };
  }

  const nextPaypal: NonNullable<StoredPlatformBillingConfig['paypal']> = {
    enabled: Boolean(rawPaypal.enabled),
    env: paypalEnv,
    checkoutMode,
    clientId,
    currency,
    madPerUnit,
    planPrices: sanitizePlanPrices(rawPaypal.planPrices),
    ...(allowLiveWithoutWebhook ? { allowLiveWithoutWebhook: true } : {}),
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
      iban: validatedIban,
      swift: validatedSwift,
      ice: validatedBankIce,
      instructionsFr:
        cleanStr(rawBank.instructionsFr, 1500) || DEFAULT_BANK_INSTRUCTIONS_FR,
      instructionsAr:
        cleanStr(rawBank.instructionsAr, 1500) || DEFAULT_BANK_INSTRUCTIONS_AR,
    },
    ...(nextCmi ? { cmi: nextCmi } : {}),
    ...(nextCash ? { cashPayment: nextCash } : {}),
    ...(nextIssuer ? { issuerProfile: nextIssuer } : {}),
    ...(nextCommercial ? { commercialPolicy: nextCommercial } : {}),
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
  if (stored?.paypal) {
    for (const field of ['encryptedClientSecret', 'encryptedWebhookId'] as const) {
      const val = stored.paypal[field];
      if (typeof val === 'string' && needsEncryptionRotation(val)) {
        stored.paypal[field] = encrypt(decrypt(val));
      }
    }
  }
  if (stored?.cmi?.encryptedStoreKey && needsEncryptionRotation(stored.cmi.encryptedStoreKey)) {
    stored.cmi.encryptedStoreKey = encrypt(decrypt(stored.cmi.encryptedStoreKey));
  }
}

export function resolveAndValidatePromoCode(
  state: State,
  rawCode: string | undefined,
  plan: SubscriptionPlan,
  months: number,
  nowMs: number = Date.now(),
): SubscriptionPromoCode | undefined {
  const normalized = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (!normalized) return undefined;
  const promos: SubscriptionPromoCode[] = state.__subscriptionPromos || [];
  const promo = promos.find(
    (p) => String(p.code || '').trim().toUpperCase() === normalized,
  );
  if (!promo) {
    throw new OperationError('Code promotionnel introuvable.', 404);
  }
  if (!promo.active) {
    throw new OperationError('Ce code promotionnel est désactivé.', 400);
  }
  if (promo.validUntil) {
    const rawDate = promo.validUntil.trim();
    const expMs = Date.parse(
      /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? `${rawDate}T23:59:59.999Z` : rawDate,
    );
    if (Number.isFinite(expMs) && expMs < nowMs) {
      throw new OperationError('Ce code promotionnel a expiré.', 400);
    }
  }
  if (
    typeof promo.maxUses === 'number' &&
    promo.maxUses > 0 &&
    Number(promo.usedCount || 0) >= promo.maxUses
  ) {
    throw new OperationError(
      'Ce code promotionnel a atteint sa limite d’utilisations.',
      409,
    );
  }
  if (
    Array.isArray(promo.applicablePlans) &&
    promo.applicablePlans.length > 0 &&
    !promo.applicablePlans.includes(plan)
  ) {
    throw new OperationError(
      'Ce code promotionnel n’est pas applicable à ce forfait.',
      400,
    );
  }
  if (typeof promo.minMonths === 'number' && months < promo.minMonths) {
    throw new OperationError(
      `Ce code promotionnel nécessite au moins ${promo.minMonths} mois.`,
      400,
    );
  }
  return promo;
}

export function computeSubscriptionPricing(
  config: PublicPlatformBillingConfig,
  plan: SubscriptionPlan,
  months: number,
  promo?: SubscriptionPromoCode,
) {
  const safeMonths = Math.max(1, Math.min(12, Math.trunc(months)));
  const monthlyMad = PLANS[plan].price;
  const baseAmountMad = monthlyMad * safeMonths;

  const discounts = config.commercialPolicy?.multiMonthDiscounts;
  const multiMonthDiscountPct =
    safeMonths >= 12
      ? clampDiscountPct(discounts?.m12)
      : safeMonths >= 6
        ? clampDiscountPct(discounts?.m6)
        : safeMonths >= 3
          ? clampDiscountPct(discounts?.m3)
          : 0;
  const multiMonthDiscountMad = Number(
    ((baseAmountMad * multiMonthDiscountPct) / 100).toFixed(2),
  );
  const afterMultiMad = Math.max(1, Number((baseAmountMad - multiMonthDiscountMad).toFixed(2)));

  let promoDiscountMad = 0;
  if (promo) {
    if (promo.discountType === 'percent') {
      promoDiscountMad = Number(
        ((afterMultiMad * Math.min(95, Math.max(0, promo.discountValue))) / 100).toFixed(2),
      );
    } else {
      promoDiscountMad = Math.min(
        Math.max(0, afterMultiMad - 1),
        Math.max(0, Number(promo.discountValue.toFixed(2))),
      );
    }
  }
  const amountMad = Math.max(1, Number((afterMultiMad - promoDiscountMad).toFixed(2)));
  const totalDiscountMad = Number(Math.max(0, baseAmountMad - amountMad).toFixed(2));
  const amountMadCents = Math.round(amountMad * 100);

  const vatRate = config.issuerProfile?.vatRate === 20 ? 20 : 0;
  const totalHtMad =
    vatRate > 0 ? Number((amountMad / (1 + vatRate / 100)).toFixed(2)) : amountMad;
  const vatAmountMad = Number((amountMad - totalHtMad).toFixed(2));

  const overrideMonthly = config.paypal.planPrices[plan];
  const monthlyPaypalCents =
    typeof overrideMonthly === 'number' && overrideMonthly > 0
      ? Math.round(overrideMonthly * 100)
      : Math.max(100, Math.round((monthlyMad / config.paypal.madPerUnit) * 100));
  const basePaypalCents = Math.max(100, monthlyPaypalCents * safeMonths);
  const discountRatio = baseAmountMad > 0 ? amountMad / baseAmountMad : 1;
  const paypalCents = Math.max(100, Math.round(basePaypalCents * discountRatio));
  const paypalAmount = Number((paypalCents / 100).toFixed(2));

  return {
    baseAmountMad,
    multiMonthDiscountPct,
    multiMonthDiscountMad,
    promoCode: promo?.code,
    promoDiscountMad,
    totalDiscountMad,
    amountMad,
    amountMadCents,
    cmiAmountString: amountMad.toFixed(2),
    vatRate,
    totalHtMad,
    vatAmountMad,
    paypalCurrency: config.paypal.currency,
    paypalCents,
    paypalAmount,
    paypalAmountString: paypalAmount.toFixed(2),
  };
}

export function nextSubscriptionDocumentNumber(
  state: State,
  prefix: string,
  now: Date = new Date(),
): string {
  const year = now.getUTCFullYear();
  const cleanPrefix = sanitizePrefix(prefix, 'FAC');
  const key = `${cleanPrefix}-${year}`;
  const seqMap = (state.__subscriptionDocSeq ??= {});
  const next = (Number(seqMap[key]) || 0) + 1;
  seqMap[key] = next;
  return `${key}-${String(next).padStart(4, '0')}`;
}

export function recordGatewayEvent(
  state: State,
  event: Omit<GatewayEventRecord, 'id' | 'createdAt'>,
): GatewayEventRecord {
  const list: GatewayEventRecord[] = (state.__gatewayEvents ??= []);
  const entry: GatewayEventRecord = {
    id: crypto.randomUUID(),
    ...event,
    message: String(event.message || '').slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  list.push(entry);
  if (list.length > 500) {
    list.splice(0, list.length - 500);
  }
  return entry;
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
