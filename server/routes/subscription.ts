import crypto from "crypto";
import type express from "express";
import { z } from "zod";
import {
  buildCmiCheckoutPayload,
  normalizeCmiCurrencyCode,
  normalizeCmiEnv,
  runCmiSelfTest,
} from "../cmiBilling";
import {
  activatePlatformSubscription,
  findProcessedGatewayPayment,
} from "../domain/building.service";
import { appendAudit, OperationError } from "../operations";
import {
  capturePayPalOrder,
  computeSubscriptionPricing,
  createPayPalOrder,
  getPayPalAccessToken,
  getPayPalOrder,
  recordGatewayEvent,
  resolveAndValidatePromoCode,
  resolvePlatformBillingConfig,
  updatePlatformBillingConfig,
} from "../paypalBilling";
import type { StateRepository } from "../repository";
import { PLANS } from "../../shared/domain/subscription";
import type {
  AdminBillingConfigUpdateInput,
  SubscriptionPlan,
} from "../../types";
import type {
  AssertOnboardedFn,
  AuthCallerContext,
  ExtractAndVerifyCallerFn,
  ServerStore,
  WrapFn,
  WrappedApi,
} from "./types";

export interface SubscriptionRoutesDeps {
  api: WrappedApi;
  wrap: WrapFn;
  repository: StateRepository;
  sharedStore: ServerStore;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  assertOnboarded: AssertOnboardedFn;
  filterStoreForCaller: (store: ServerStore, caller: AuthCallerContext) => any;
}

export interface CmiSubscriptionRoutesDeps {
  wrap: WrapFn;
  repository: StateRepository;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  assertOnboarded: AssertOnboardedFn;
}

const resolvePublicOrigin = (
  req: express.Request,
  configuredShopUrl?: string,
): string => {
  if (configuredShopUrl && /^https?:\/\//i.test(configuredShopUrl.trim())) {
    try {
      return new URL(configuredShopUrl.trim()).origin;
    } catch {
      // fallback below
    }
  }
  const envOrigin = String(process.env.PUBLIC_APP_URL || "").trim();
  if (envOrigin && /^https?:\/\//i.test(envOrigin)) {
    try {
      return new URL(envOrigin).origin;
    } catch {
      // fallback below
    }
  }
  const proto =
    String(req.headers["x-forwarded-proto"] || req.protocol || "http")
      .split(",")[0]
      .trim() || "http";
  const host = String(
    req.headers["x-forwarded-host"] || req.get("host") || "localhost",
  )
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
};

export function registerSubscriptionRoutes(
  app: express.Express,
  deps: SubscriptionRoutesDeps,
) {
  const {
    api,
    wrap,
    repository,
    sharedStore,
    extractAndVerifyCaller,
    assertOnboarded,
    filterStoreForCaller,
  } = deps;

  // Platform Subscription Billing Configuration, PayPal, CMI Morocco, Cash, Promos & Observability Routes
  const AdminBillingConfigPaypalSchema = z.object({
    enabled: z.boolean(),
    env: z.enum(["sandbox", "live"]),
    checkoutMode: z.enum(["standard", "expanded"]),
    clientId: z.string().max(300),
    clientSecret: z.string().max(300).optional(),
    clearClientSecret: z.boolean().optional(),
    webhookId: z.string().max(200).optional(),
    clearWebhookId: z.boolean().optional(),
    allowLiveWithoutWebhook: z.boolean().optional(),
    currency: z.enum(["EUR", "USD"]),
    madPerUnit: z.number().positive().max(1_000_000),
    planPrices: z
      .object({
        starter: z.number().positive().max(1_000_000).optional(),
        professional: z.number().positive().max(1_000_000).optional(),
        enterprise: z.number().positive().max(1_000_000).optional(),
      })
      .optional(),
  });
  const AdminBillingConfigBankSchema = z.object({
    enabled: z.boolean(),
    bankName: z.string().max(120),
    accountHolder: z.string().max(160),
    rib: z.string().max(64),
    iban: z.string().max(64).optional(),
    swift: z.string().max(32).optional(),
    ice: z.string().max(40).optional(),
    instructionsFr: z.string().max(1500).optional(),
    instructionsAr: z.string().max(1500).optional(),
  });
  const AdminBillingConfigCmiSchema = z.object({
    enabled: z.boolean(),
    env: z.enum(["test", "production"]),
    clientId: z.string().max(120),
    storeKey: z.string().max(256).optional(),
    clearStoreKey: z.boolean().optional(),
    currencyCode: z.enum(["504", "978", "840"]).optional(),
    lang: z.enum(["fr", "ar"]).optional(),
    shopUrl: z.string().max(300).optional(),
  });
  const AdminBillingConfigCashSchema = z.object({
    enabled: z.boolean(),
    acceptedChannels: z.array(
      z.enum(["office", "wafacash", "cashplus", "baridcash", "check"]),
    ),
    beneficiaryName: z.string().max(160),
    officeAddress: z.string().max(300).optional(),
    officeHours: z.string().max(120).optional(),
    contactPhone: z.string().max(40).optional(),
    whatsapp: z.string().max(40).optional(),
    maxCashAmountMad: z.number().min(0).max(1_000_000).optional(),
    requireProofUpload: z.boolean().optional(),
    instructionsFr: z.string().max(1500).optional(),
    instructionsAr: z.string().max(1500).optional(),
  });
  const AdminBillingConfigIssuerSchema = z.object({
    companyName: z.string().max(160).optional(),
    legalForm: z.string().max(40).optional(),
    ice: z.string().max(40).optional(),
    rc: z.string().max(40).optional(),
    ifNumber: z.string().max(40).optional(),
    patente: z.string().max(40).optional(),
    cnss: z.string().max(40).optional(),
    address: z.string().max(250).optional(),
    city: z.string().max(80).optional(),
    email: z.string().max(120).optional(),
    phone: z.string().max(40).optional(),
    whatsapp: z.string().max(40).optional(),
    vatRate: z.union([z.literal(0), z.literal(20)]).optional(),
    invoicePrefix: z.string().max(12).optional(),
    receiptPrefix: z.string().max(12).optional(),
  });
  const AdminBillingConfigCommercialSchema = z.object({
    gracePeriodDays: z.number().int().min(0).max(30).optional(),
    multiMonthDiscounts: z
      .object({
        m3: z.number().min(0).max(50).optional(),
        m6: z.number().min(0).max(50).optional(),
        m12: z.number().min(0).max(50).optional(),
      })
      .optional(),
  });
  const AdminBillingConfigSchema = z.union([
    z.object({
      resetToEnv: z.literal(true),
      paypal: AdminBillingConfigPaypalSchema.optional(),
      bankTransfer: AdminBillingConfigBankSchema.optional(),
      cmi: AdminBillingConfigCmiSchema.optional(),
      cashPayment: AdminBillingConfigCashSchema.optional(),
      issuerProfile: AdminBillingConfigIssuerSchema.optional(),
      commercialPolicy: AdminBillingConfigCommercialSchema.optional(),
    }),
    z.object({
      resetToEnv: z.literal(false).optional(),
      paypal: AdminBillingConfigPaypalSchema,
      bankTransfer: AdminBillingConfigBankSchema,
      cmi: AdminBillingConfigCmiSchema.optional(),
      cashPayment: AdminBillingConfigCashSchema.optional(),
      issuerProfile: AdminBillingConfigIssuerSchema.optional(),
      commercialPolicy: AdminBillingConfigCommercialSchema.optional(),
    }),
  ]);

  api.get("/api/subscription/billing-config", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (!["admin", "syndic"].includes(caller.role))
      return res.status(403).json({ error: "Opération réservée au syndic." });
    assertOnboarded(caller, sharedStore);
    const resolved = resolvePlatformBillingConfig(sharedStore);
    return res.json({ ok: true, config: resolved.publicConfig });
  });

  api.get("/api/admin/billing-config", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const resolved = resolvePlatformBillingConfig(sharedStore);
    return res.json({ ok: true, config: resolved.adminConfig });
  });

  app.put(
    "/api/admin/billing-config",
    wrap(async (req, res) => {
      const caller = await extractAndVerifyCaller(req, sharedStore);
      if (!caller)
        return res.status(401).json({ error: "Authentification requise." });
      if (caller.role !== "admin")
        return res.status(403).json({ error: "Administration uniquement." });
      assertOnboarded(caller, sharedStore);
      const parsed = AdminBillingConfigSchema.parse(
        req.body,
      ) as AdminBillingConfigUpdateInput;
      const updated = updatePlatformBillingConfig(
        sharedStore,
        caller.uid,
        parsed,
      );
      recordGatewayEvent(sharedStore, {
        gateway: "system",
        eventType: parsed.resetToEnv
          ? "BILLING_CONFIG_RESET_TO_ENV"
          : "BILLING_CONFIG_UPDATED",
        status: "ok",
        httpStatus: 200,
        message: parsed.resetToEnv
          ? "Configuration passerelles réinitialisée aux variables d’environnement."
          : `Passerelles mises à jour (CMI:${updated.cmi.enabled ? "ON" : "OFF"}, PayPal:${updated.paypal.enabled ? "ON" : "OFF"}, Virement:${updated.bankTransfer.enabled ? "ON" : "OFF"}, Espèces:${updated.cashPayment.enabled ? "ON" : "OFF"}).`,
      });
      appendAudit(
        sharedStore,
        caller,
        "updatePlatformBillingConfig",
        undefined,
        {
          paypalEnabled: updated.paypal.enabled,
          paypalEnv: updated.paypal.env,
          paypalCheckoutMode: updated.paypal.checkoutMode,
          paypalCurrency: updated.paypal.currency,
          bankTransferEnabled: updated.bankTransfer.enabled,
          cmiEnabled: updated.cmi.enabled,
          cmiEnv: updated.cmi.env,
          cashPaymentEnabled: updated.cashPayment.enabled,
          gracePeriodDays: updated.commercialPolicy.gracePeriodDays,
          vatRate: updated.issuerProfile.vatRate,
        },
      );
      return res.json({ ok: true, config: updated });
    }, true),
  );

  app.post(
    "/api/admin/billing-config/test-paypal",
    wrap(async (req, res) => {
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (caller.role !== "admin")
          throw new OperationError("Administration uniquement.", 403);
        assertOnboarded(caller, state);
        const resolved = resolvePlatformBillingConfig(state).paypalSecrets;
        const bodyEnv =
          req.body?.env === "live" || req.body?.env === "sandbox"
            ? req.body.env
            : resolved.env;
        const clientId =
          typeof req.body?.clientId === "string" && req.body.clientId.trim()
            ? req.body.clientId.trim()
            : resolved.clientId;
        const clientSecret =
          typeof req.body?.clientSecret === "string" &&
          req.body.clientSecret.trim()
            ? req.body.clientSecret.trim()
            : resolved.clientSecret;
        return { env: bodyEnv, clientId, clientSecret };
      });
      await getPayPalAccessToken(preflight);
      return res.json({
        ok: true,
        env: preflight.env,
        message: "Connexion OAuth PayPal vérifiée avec succès.",
      });
    }, false),
  );

  app.post(
    "/api/admin/billing-config/test-cmi",
    wrap(async (req, res) => {
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (caller.role !== "admin")
          throw new OperationError("Administration uniquement.", 403);
        assertOnboarded(caller, state);
        const resolved = resolvePlatformBillingConfig(state).cmiSecrets;
        const env =
          req.body?.env === "production" || req.body?.env === "test"
            ? normalizeCmiEnv(req.body.env)
            : resolved.env;
        const clientId =
          typeof req.body?.clientId === "string" && req.body.clientId.trim()
            ? req.body.clientId.trim()
            : resolved.clientId;
        const storeKey =
          typeof req.body?.storeKey === "string" && req.body.storeKey.trim()
            ? req.body.storeKey.trim()
            : resolved.storeKey;
        const currencyCode = req.body?.currencyCode
          ? normalizeCmiCurrencyCode(req.body.currencyCode)
          : resolved.currencyCode;
        return { env, clientId, storeKey, currencyCode };
      });
      const result = runCmiSelfTest(preflight);
      return res.json(result);
    }, false),
  );

  const ValidatePromoSchema = z.object({
    plan: z.enum(["starter", "professional", "enterprise"]),
    months: z.number().int().min(1).max(12),
    promoCode: z.string().max(64).optional(),
  });

  api.post("/api/subscription/validate-promo", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (!["admin", "syndic"].includes(caller.role))
      return res.status(403).json({ error: "Opération réservée au syndic." });
    assertOnboarded(caller, sharedStore);
    const body = ValidatePromoSchema.parse(req.body);
    const billing = resolvePlatformBillingConfig(sharedStore).publicConfig;
    const promo = body.promoCode?.trim()
      ? resolveAndValidatePromoCode(
          sharedStore,
          body.promoCode,
          body.plan as SubscriptionPlan,
          body.months,
        )
      : undefined;
    const pricing = computeSubscriptionPricing(
      billing,
      body.plan as SubscriptionPlan,
      body.months,
      promo,
    );
    return res.json({
      ok: true,
      pricing,
      ...(promo
        ? {
            promo: {
              code: promo.code,
              discountType: promo.discountType,
              discountValue: promo.discountValue,
              description: promo.description || "",
            },
          }
        : {}),
    });
  });

  const CreatePayPalOrderSchema = z.object({
    syndicId: z.string().min(1).max(200),
    plan: z.enum(["starter", "professional", "enterprise"]),
    months: z.number().int().min(1).max(12),
    paymentSourceHint: z.enum(["paypal", "card"]).optional(),
    promoCode: z.string().max(64).optional(),
  });

  app.post(
    "/api/subscription/paypal/create-order",
    wrap(async (req, res) => {
      const body = CreatePayPalOrderSchema.parse(req.body);
      const prepared = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (!["admin", "syndic"].includes(caller.role))
          throw new OperationError("Opération réservée au syndic.", 403);
        assertOnboarded(caller, state);
        const s = (state.syndik_prod_syndics_v1 || []).find(
          (cab: any) => cab.id === body.syndicId,
        );
        if (
          !s ||
          (caller.role !== "admin" &&
            s.createdBy !== caller.uid &&
            caller.syndicId !== s.id)
        ) {
          throw new OperationError("Cabinet non autorisé.", 403);
        }
        if (s.archivedAt) {
          throw new OperationError(
            "Cabinet archivé : impossible de renouveler l'abonnement.",
            409,
          );
        }
        if (caller.role !== "admin" && s.subscriptionStatus === "cancelled") {
          throw new OperationError(
            "Votre compte est suspendu. Contactez l'administration.",
            403,
          );
        }
        const billing = resolvePlatformBillingConfig(state);
        if (!billing.paypalSecrets.enabled) {
          throw new OperationError(
            "Le paiement en ligne PayPal n'est pas configuré.",
            400,
          );
        }
        const promo = body.promoCode?.trim()
          ? resolveAndValidatePromoCode(
              state,
              body.promoCode,
              body.plan as SubscriptionPlan,
              body.months,
            )
          : undefined;
        const pricing = computeSubscriptionPricing(
          billing.publicConfig,
          body.plan as SubscriptionPlan,
          body.months,
          promo,
        );
        const intentId = `sub-${crypto.randomUUID()}`;
        const intents = (state.__paypalIntents ??= {});
        // Prune completed or expired intents older than 30 days
        const cutoff = Date.now() - 30 * 86_400_000;
        for (const [k, v] of Object.entries(intents) as [string, any][]) {
          if (v?.createdAt && Date.parse(v.createdAt) < cutoff) {
            delete intents[k];
          }
        }
        intents[intentId] = {
          intentId,
          syndicId: s.id,
          actorUid: caller.uid,
          plan: body.plan,
          months: body.months,
          amountMad: pricing.amountMad,
          paypalCurrency: pricing.paypalCurrency,
          paypalCents: pricing.paypalCents,
          ...(promo ? { promoCode: promo.code } : {}),
          ...(body.paymentSourceHint
            ? { paymentSourceHint: body.paymentSourceHint }
            : {}),
          status: "created",
          createdAt: new Date().toISOString(),
        };
        return {
          intentId,
          cabinetName: String(s.name || "ImmoGest"),
          pricing,
          creds: {
            env: billing.paypalSecrets.env,
            clientId: billing.paypalSecrets.clientId,
            clientSecret: billing.paypalSecrets.clientSecret,
          },
          paymentSourceHint: body.paymentSourceHint,
        };
      });

      const order = await createPayPalOrder(prepared.creds, {
        currency: prepared.pricing.paypalCurrency,
        amountValue: prepared.pricing.paypalAmountString,
        customId: prepared.intentId,
        requestId: prepared.intentId,
        description: `ImmoGest ${body.plan} (${body.months} mois) - ${prepared.cabinetName}`,
        paymentSourceHint: prepared.paymentSourceHint,
      });

      await repository.transaction(async (state) => {
        (state.__paypalOrders ??= {})[order.orderId] = prepared.intentId;
        if (state.__paypalIntents?.[prepared.intentId]) {
          state.__paypalIntents[prepared.intentId].orderId = order.orderId;
        }
      });

      return res.json({
        ok: true,
        orderId: order.orderId,
        currency: prepared.pricing.paypalCurrency,
        amount: prepared.pricing.paypalAmount,
        amountMad: prepared.pricing.amountMad,
      });
    }, false),
  );

  const CapturePayPalOrderSchema = z.object({
    orderId: z.string().min(4).max(120),
    syndicId: z.string().min(1).max(200),
    methodHint: z.enum(["paypal", "card"]).optional(),
  });

  app.post(
    "/api/subscription/paypal/capture-order",
    wrap(async (req, res) => {
      const body = CapturePayPalOrderSchema.parse(req.body);
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (!["admin", "syndic"].includes(caller.role))
          throw new OperationError("Opération réservée au syndic.", 403);
        assertOnboarded(caller, state);
        const s = (state.syndik_prod_syndics_v1 || []).find(
          (cab: any) => cab.id === body.syndicId,
        );
        if (
          !s ||
          (caller.role !== "admin" &&
            s.createdBy !== caller.uid &&
            caller.syndicId !== s.id)
        ) {
          throw new OperationError("Cabinet non autorisé.", 403);
        }
        if (s.archivedAt) {
          throw new OperationError("Cabinet archivé.", 409);
        }
        if (caller.role !== "admin" && s.subscriptionStatus === "cancelled") {
          throw new OperationError(
            "Votre compte est suspendu. Contactez l'administration.",
            403,
          );
        }
        const mappedIntentId = state.__paypalOrders?.[body.orderId];
        const mappedIntent = mappedIntentId
          ? state.__paypalIntents?.[mappedIntentId]
          : undefined;
        if (mappedIntent && mappedIntent.syndicId !== body.syndicId) {
          throw new OperationError(
            "Commande PayPal associée à un autre cabinet.",
            403,
          );
        }
        const existing = findProcessedGatewayPayment(state, {
          externalOrderIds: [body.orderId],
          paymentId: mappedIntent?.paymentId,
        });
        if (existing) {
          if (existing.syndicId !== body.syndicId) {
            throw new OperationError(
              "Cette commande appartient à un autre cabinet.",
              403,
            );
          }
          if (existing.voidedAt) {
            recordGatewayEvent(state, {
              gateway: "paypal",
              eventType: "CAPTURE_ORDER_COMPLETED",
              status: "ignored",
              reason: "already_processed",
              httpStatus: 409,
              syndicId: existing.syndicId,
              orderId: body.orderId,
              reference: existing.reference,
              message: "Commande PayPal déjà traitée puis remboursée ou annulée.",
            });
            return {
              alreadyRefundedOrVoided: true as const,
            };
          }
          return {
            alreadyRefundedOrVoided: false as const,
            alreadyCaptured: true as const,
            payment: existing,
            store: filterStoreForCaller(state, caller),
            revision: state.__revision || 0,
          };
        }
        if (
          mappedIntent &&
          (mappedIntent.status === "refunded" ||
            mappedIntent.status === "reversed")
        ) {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType: "CAPTURE_ORDER_COMPLETED",
            status: "ignored",
            reason: "already_processed",
            httpStatus: 409,
            syndicId: mappedIntent.syndicId,
            orderId: body.orderId,
            message: "Intent PayPal déjà remboursé ou annulé.",
          });
          return {
            alreadyRefundedOrVoided: true as const,
          };
        }
        const billing = resolvePlatformBillingConfig(state);
        if (!billing.paypalSecrets.enabled) {
          throw new OperationError(
            "Le paiement en ligne PayPal n'est pas configuré.",
            400,
          );
        }
        return {
          alreadyRefundedOrVoided: false as const,
          alreadyCaptured: false as const,
          caller,
          hasMappedIntent: Boolean(mappedIntent),
          creds: {
            env: billing.paypalSecrets.env,
            clientId: billing.paypalSecrets.clientId,
            clientSecret: billing.paypalSecrets.clientSecret,
          },
        };
      });

      if (preflight.alreadyRefundedOrVoided) {
        throw new OperationError(
          "Cette commande PayPal a déjà été remboursée ou annulée.",
          409,
        );
      }

      if (preflight.alreadyCaptured) {
        return res.json({
          ok: true,
          alreadyCaptured: true,
          payment: preflight.payment,
          store: preflight.store,
          revision: preflight.revision,
        });
      }

      if (!preflight.hasMappedIntent) {
        // Crash-recovery path: verify ownership via read-only GET order before capturing funds.
        const remoteOrder = await getPayPalOrder(preflight.creds, body.orderId);
        const ownerVerified = await repository.transaction(async (state) => {
          const recoveredIntent = remoteOrder.customId
            ? state.__paypalIntents?.[remoteOrder.customId]
            : undefined;
          return Boolean(
            recoveredIntent &&
              recoveredIntent.syndicId === body.syndicId &&
              recoveredIntent.status !== "refunded" &&
              recoveredIntent.status !== "reversed",
          );
        });
        if (!ownerVerified) {
          throw new OperationError(
            "Commande PayPal introuvable ou non autorisée pour ce cabinet.",
            403,
          );
        }
      }

      const capture = await capturePayPalOrder(preflight.creds, body.orderId);

      const finalized = await repository.transaction(async (state) => {
        const caller = preflight.caller;
        const intentKey = state.__paypalOrders?.[body.orderId] || capture.customId;
        const intent = intentKey ? state.__paypalIntents?.[intentKey] : undefined;
        const existing = findProcessedGatewayPayment(state, {
          externalOrderIds: [body.orderId, capture.orderId],
          externalCaptureIds: [capture.captureId],
          paymentId: intent?.paymentId,
        });
        if (existing) {
          if (existing.syndicId !== body.syndicId) {
            throw new OperationError(
              "Commande PayPal associée à un autre cabinet.",
              403,
            );
          }
          if (existing.voidedAt) {
            recordGatewayEvent(state, {
              gateway: "paypal",
              eventType: "CAPTURE_ORDER_COMPLETED",
              status: "ignored",
              reason: "already_processed",
              httpStatus: 409,
              syndicId: existing.syndicId,
              orderId: capture.orderId || body.orderId,
              reference: capture.captureId || existing.reference,
              message: "Commande PayPal déjà traitée puis remboursée ou annulée.",
            });
            return { alreadyRefundedOrVoided: true as const };
          }
          return {
            alreadyRefundedOrVoided: false as const,
            alreadyCaptured: true,
            payment: existing,
            store: filterStoreForCaller(state, caller),
            revision: state.__revision || 0,
          };
        }

        if (!intent || intent.syndicId !== body.syndicId) {
          throw new OperationError(
            "Commande PayPal introuvable ou non autorisée pour ce cabinet.",
            403,
          );
        }
        if (intent.status === "refunded" || intent.status === "reversed") {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType: "CAPTURE_ORDER_COMPLETED",
            status: "ignored",
            reason: "already_processed",
            httpStatus: 409,
            syndicId: intent.syndicId,
            orderId: capture.orderId || body.orderId,
            reference: capture.captureId || undefined,
            message: "Intent PayPal déjà remboursé ou annulé.",
          });
          return { alreadyRefundedOrVoided: true as const };
        }
        if (
          capture.status !== "COMPLETED" ||
          (capture.captureStatus && capture.captureStatus !== "COMPLETED")
        ) {
          throw new OperationError(
            "Paiement PayPal non finalisé (statut : " + capture.status + ").",
            402,
          );
        }
        if (
          capture.currency !== intent.paypalCurrency ||
          capture.amountCents !== intent.paypalCents
        ) {
          throw new OperationError(
            "Montant ou devise PayPal incohérent avec la commande.",
            409,
          );
        }

        const method =
          capture.hasCardPaymentSource ||
          body.methodHint === "card" ||
          intent.paymentSourceHint === "card"
            ? ("card" as const)
            : ("paypal" as const);

        const payment = activatePlatformSubscription(state, caller, {
          syndicId: intent.syndicId,
          plan: intent.plan as SubscriptionPlan,
          months: Number(intent.months),
          reference: capture.captureId || capture.orderId,
          amountMad: Number(intent.amountMad),
          method,
          currency: intent.paypalCurrency,
          chargedAmount: Number(intent.paypalCents) / 100,
          ...(intent.promoCode ? { promoCode: String(intent.promoCode) } : {}),
          externalOrderId: capture.orderId,
          ...(capture.captureId ? { externalCaptureId: capture.captureId } : {}),
          auditOperation: "paypalCaptureSubscription",
        });

        intent.status = "completed";
        intent.orderId = capture.orderId;
        intent.paymentId = payment.id;
        (state.__paypalOrders ??= {})[capture.orderId] = intentKey;
        recordGatewayEvent(state, {
          gateway: "paypal",
          eventType: "CAPTURE_ORDER_COMPLETED",
          status: "ok",
          httpStatus: 200,
          syndicId: intent.syndicId,
          orderId: capture.orderId,
          reference: payment.reference,
          message: `Capture PayPal (${method}) réussie — ${payment.amount} MAD (${payment.invoiceNumber || payment.id}).`,
        });

        return {
          alreadyRefundedOrVoided: false as const,
          alreadyCaptured: false,
          payment,
          store: filterStoreForCaller(state, caller),
          revision: (state.__revision || 0) + 1,
        };
      });

      if (finalized.alreadyRefundedOrVoided) {
        throw new OperationError(
          "Cette commande PayPal a déjà été remboursée ou annulée.",
          409,
        );
      }

      return res.json({
        ok: true,
        alreadyCaptured: finalized.alreadyCaptured,
        payment: finalized.payment,
        store: finalized.store,
        revision: finalized.revision,
      });
    }, false),
  );
}

export function registerCmiSubscriptionRoutes(
  app: express.Express,
  deps: CmiSubscriptionRoutesDeps,
) {
  const { wrap, repository, extractAndVerifyCaller, assertOnboarded } = deps;

  // --- Moroccan CMI 3D-Secure Hosted Payment Page & Callback Engine ---
  const CreateCmiPaymentSchema = z.object({
    syndicId: z.string().min(1).max(200),
    plan: z.enum(["starter", "professional", "enterprise"]),
    months: z.number().int().min(1).max(12),
    lang: z.enum(["fr", "ar"]).optional(),
    promoCode: z.string().max(64).optional(),
  });

  app.post(
    "/api/subscription/cmi/create-payment",
    wrap(async (req, res) => {
      const body = CreateCmiPaymentSchema.parse(req.body);
      const prepared = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (!["admin", "syndic"].includes(caller.role))
          throw new OperationError("Opération réservée au syndic.", 403);
        assertOnboarded(caller, state);
        const s = (state.syndik_prod_syndics_v1 || []).find(
          (cab: any) => cab.id === body.syndicId,
        );
        if (
          !s ||
          (caller.role !== "admin" &&
            s.createdBy !== caller.uid &&
            caller.syndicId !== s.id)
        ) {
          throw new OperationError("Cabinet non autorisé.", 403);
        }
        if (s.archivedAt) {
          throw new OperationError(
            "Cabinet archivé : impossible de renouveler l'abonnement.",
            409,
          );
        }
        if (caller.role !== "admin" && s.subscriptionStatus === "cancelled") {
          throw new OperationError(
            "Votre compte est suspendu. Contactez l'administration.",
            403,
          );
        }
        const activeBuildings = (s.buildings || []).filter(
          (b: any) => !b.archivedAt,
        ).length;
        const planLimit = PLANS[body.plan].buildings;
        if (activeBuildings > planLimit) {
          throw new OperationError(
            `Impossible de passer au forfait ${body.plan} : ${activeBuildings} immeuble(s) actif(s) pour une limite de ${planLimit}.`,
            409,
          );
        }
        const billing = resolvePlatformBillingConfig(state);
        if (!billing.cmiSecrets.enabled) {
          throw new OperationError(
            "Le paiement par carte marocaine (CMI) n'est pas configuré.",
            400,
          );
        }
        const promo = body.promoCode?.trim()
          ? resolveAndValidatePromoCode(
              state,
              body.promoCode,
              body.plan as SubscriptionPlan,
              body.months,
            )
          : undefined;
        const pricing = computeSubscriptionPricing(
          billing.publicConfig,
          body.plan as SubscriptionPlan,
          body.months,
          promo,
        );

        const oid = `CMI-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
        const intents = (state.__cmiIntents ??= {});
        const cutoff = Date.now() - 30 * 86_400_000;
        for (const [k, v] of Object.entries(intents) as [string, any][]) {
          if (v?.createdAt && Date.parse(v.createdAt) < cutoff) {
            delete intents[k];
          }
        }
        intents[oid] = {
          oid,
          syndicId: s.id,
          actorUid: caller.uid,
          plan: body.plan,
          months: body.months,
          amountMad: pricing.amountMad,
          amountMadCents: pricing.amountMadCents,
          currencyCode: billing.cmiSecrets.currencyCode,
          currencyLabel: billing.cmiSecrets.currencyLabel,
          ...(promo ? { promoCode: promo.code } : {}),
          status: "created",
          createdAt: new Date().toISOString(),
        };

        const origin = resolvePublicOrigin(req, billing.cmiSecrets.shopUrl);
        const checkout = buildCmiCheckoutPayload({
          env: billing.cmiSecrets.env,
          clientId: billing.cmiSecrets.clientId,
          storeKey: billing.cmiSecrets.storeKey,
          oid,
          amountValue: pricing.cmiAmountString,
          currencyCode: billing.cmiSecrets.currencyCode,
          lang: body.lang || billing.cmiSecrets.lang,
          okUrl: `${origin}/api/subscription/cmi/return?status=ok&oid=${encodeURIComponent(oid)}`,
          failUrl: `${origin}/api/subscription/cmi/return?status=fail&oid=${encodeURIComponent(oid)}`,
          shopUrl: billing.cmiSecrets.shopUrl || `${origin}/`,
          callbackUrl: `${origin}/api/webhooks/cmi`,
          billToName: String(s.name || "Cabinet Syndic"),
          email: String(s.email || caller.email || ""),
          tel: String(s.phone || ""),
          description: `Abonnement ${body.plan} (${body.months} mois)`,
        });

        recordGatewayEvent(state, {
          gateway: "cmi",
          eventType: "CMI_CHECKOUT_INITIATED",
          status: "ok",
          httpStatus: 200,
          syndicId: s.id,
          orderId: oid,
          message: `Session CMI initialisée (${pricing.amountMad} MAD · ${body.plan} × ${body.months}m).`,
        });

        return {
          oid,
          amountMad: pricing.amountMad,
          currency: billing.cmiSecrets.currencyLabel,
          gatewayUrl: checkout.gatewayUrl,
          fields: checkout.fields,
        };
      });

      return res.json({ ok: true, ...prepared });
    }, false),
  );

  // CMI redirects the user's browser via HTTP POST to okUrl / failUrl; convert safely to 303 SPA redirect.
  const handleCmiBrowserReturn = (
    req: express.Request,
    res: express.Response,
  ) => {
    const rawStatus = String(
      req.query.status || req.body?.Response || "",
    ).toLowerCase();
    const status = rawStatus === "ok" || rawStatus === "approved" ? "ok" : "fail";
    const oid = String(req.query.oid || req.body?.oid || "")
      .replace(/[^A-Za-z0-9_-]/g, "")
      .slice(0, 64);
    const params = new URLSearchParams({ cmi_return: status });
    if (oid) params.set("oid", oid);
    return res.redirect(303, `/?${params.toString()}`);
  };
  app.post("/api/subscription/cmi/return", handleCmiBrowserReturn);
  app.get("/api/subscription/cmi/return", handleCmiBrowserReturn);
}
