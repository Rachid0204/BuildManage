import crypto from "crypto";
import type express from "express";
import { verifyCmiCallbackHash } from "../cmiBilling";
import {
  activatePlatformSubscription,
  findProcessedGatewayPayment,
  voidPlatformSubscriptionPayment,
} from "../domain/building.service";
import { OperationError } from "../operations";
import {
  recordGatewayEvent,
  resolvePlatformBillingConfig,
  verifyPayPalWebhookSignature,
} from "../paypalBilling";
import type { StateRepository } from "../repository";
import {
  type EphemeralGatewayEventBuffer,
  validateCmiWebhookEnvelope,
  validatePayPalWebhookEnvelope,
} from "../requestGuard";
import type { GatewayEventRecord, SubscriptionPlan } from "../../types";
import type { WrapFn } from "./types";

export interface PayPalWebhookRoutesDeps {
  wrap: WrapFn;
  repository: StateRepository;
}

export interface CmiWebhookRoutesDeps {
  wrap: WrapFn;
  repository: StateRepository;
  ephemeralGatewayEvents: EphemeralGatewayEventBuffer<GatewayEventRecord>;
}

export function registerPayPalWebhookRoutes(
  app: express.Express,
  deps: PayPalWebhookRoutesDeps,
) {
  const { wrap, repository } = deps;

  app.post(
    "/api/webhooks/paypal",
    wrap(async (req, res) => {
      const envelope = validatePayPalWebhookEnvelope(req.headers, req.body);
      if (!envelope.ok) {
        return res.status(400).json({ error: envelope.error });
      }
      const {
        authAlgo,
        certUrl,
        transmissionId,
        transmissionSig,
        transmissionTime,
        eventType,
      } = envelope.value;

      const webhookCreds = await repository.transaction(async (state) => {
        const secrets = resolvePlatformBillingConfig(state).paypalSecrets;
        return {
          env: secrets.env,
          clientId: secrets.clientId,
          clientSecret: secrets.clientSecret,
          webhookId: secrets.webhookId,
        };
      });

      if (
        !webhookCreds.clientId ||
        !webhookCreds.clientSecret ||
        !webhookCreds.webhookId
      ) {
        return res
          .status(503)
          .json({ error: "Webhook PayPal non configuré sur ce serveur." });
      }

      const verified = await verifyPayPalWebhookSignature(
        {
          env: webhookCreds.env,
          clientId: webhookCreds.clientId,
          clientSecret: webhookCreds.clientSecret,
        },
        {
          authAlgo,
          certUrl,
          transmissionId,
          transmissionSig,
          transmissionTime,
          webhookId: webhookCreds.webhookId,
          webhookEvent: req.body,
        },
      );
      if (!verified) {
        return res
          .status(401)
          .json({ error: "Signature webhook PayPal invalide." });
      }

      const resource = (req.body?.resource || {}) as Record<string, any>;

      if (
        eventType === "PAYMENT.CAPTURE.REFUNDED" ||
        eventType === "PAYMENT.CAPTURE.REVERSED"
      ) {
        const refundId = String(resource.id || "").trim();
        const relatedOrderId = String(
          resource.supplementary_data?.related_ids?.order_id || "",
        ).trim();
        const captureLink = Array.isArray(resource.links)
          ? resource.links.find((l: any) => l?.rel === "up")?.href || ""
          : "";
        const linkedCaptureId =
          String(
            resource.supplementary_data?.related_ids?.capture_id || "",
          ).trim() ||
          (/\/captures\/([^/?]+)/.exec(String(captureLink))?.[1] || "").trim() ||
          (eventType === "PAYMENT.CAPTURE.REVERSED" ? refundId : "");
        const customId = String(resource.custom_id || "").trim();

        const outcome = await repository.transaction(async (state) => {
          const payments =
            state.syndik_prod_subscription_payments_v1 || [];
          const intentPaymentId = customId
            ? state.__paypalIntents?.[customId]?.paymentId
            : undefined;
          const match = payments.find(
            (p: any) =>
              !p.voidedAt &&
              ((linkedCaptureId && p.externalCaptureId === linkedCaptureId) ||
                (relatedOrderId && p.externalOrderId === relatedOrderId) ||
                (intentPaymentId && p.id === intentPaymentId)),
          );
          if (!match) {
            recordGatewayEvent(state, {
              gateway: "paypal",
              eventType,
              status: "ignored",
              reason: "payment_not_found_or_already_voided",
              httpStatus: 200,
              orderId: relatedOrderId || undefined,
              reference: linkedCaptureId || refundId || undefined,
              message: "Paiement introuvable ou déjà annulé.",
            });
            return { ignored: true, reason: "payment_not_found_or_already_voided" };
          }
          const reason =
            eventType === "PAYMENT.CAPTURE.REFUNDED"
              ? `Remboursement PayPal (${refundId || linkedCaptureId || relatedOrderId})`
              : `Annulation / contestation PayPal (${refundId || linkedCaptureId || relatedOrderId})`;
          voidPlatformSubscriptionPayment(
            state,
            { uid: "paypal:webhook", role: "admin" },
            match.id,
            reason,
            "paypalWebhookRefundSubscription",
          );
          if (eventType === "PAYMENT.CAPTURE.REVERSED" && state.__paypalIntents) {
            for (const intent of Object.values(state.__paypalIntents) as any[]) {
              if (intent?.paymentId === match.id) {
                intent.status = "reversed";
              }
            }
          }
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType,
            status: "ok",
            httpStatus: 200,
            syndicId: match.syndicId,
            orderId: relatedOrderId || undefined,
            reference: match.reference,
            message: reason,
          });
          return { ignored: false, voidedPaymentId: match.id };
        });
        return res.json({ ok: true, eventType, ...outcome });
      }

      if (eventType !== "PAYMENT.CAPTURE.COMPLETED") {
        return res.json({ ok: true, ignored: true, eventType });
      }
      const captureStatus = String(resource.status || "");
      const captureId = String(resource.id || "").trim();
      const relatedOrderId = String(
        resource.supplementary_data?.related_ids?.order_id || "",
      ).trim();
      const customId = String(resource.custom_id || "").trim();
      const currency = String(resource.amount?.currency_code || "").toUpperCase();
      const parsedAmount = Number(resource.amount?.value);
      const amountCents = Number.isFinite(parsedAmount)
        ? Math.round(parsedAmount * 100)
        : -1;

      if (
        captureStatus !== "COMPLETED" ||
        (!customId && !relatedOrderId && !captureId)
      ) {
        return res.json({ ok: true, ignored: true });
      }

      const outcome = await repository.transaction(async (state) => {
        const intentKey =
          customId || (relatedOrderId && state.__paypalOrders?.[relatedOrderId]);
        const intent = intentKey
          ? state.__paypalIntents?.[intentKey]
          : undefined;
        const existingPayment = findProcessedGatewayPayment(state, {
          externalOrderIds: [relatedOrderId, intent?.orderId],
          externalCaptureIds: [captureId],
          paymentId: intent?.paymentId,
        });
        if (existingPayment) {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType,
            status: "ignored",
            reason: "already_processed",
            httpStatus: 200,
            syndicId: existingPayment.syndicId || intent?.syndicId,
            orderId:
              relatedOrderId ||
              existingPayment.externalOrderId ||
              intent?.orderId ||
              undefined,
            reference: captureId || existingPayment.reference || undefined,
            message: existingPayment.voidedAt
              ? "Capture PayPal déjà traitée puis remboursée ou annulée."
              : "Capture PayPal déjà traitée.",
          });
          return {
            ignored: true,
            reason: "already_processed",
            paymentId: existingPayment.id,
          };
        }
        if (!customId && !relatedOrderId) {
          return { ignored: true };
        }
        if (!intent) {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType,
            status: "ignored",
            reason: "unknown_intent",
            httpStatus: 200,
            orderId: relatedOrderId || undefined,
            reference: captureId || undefined,
            message: "Intent PayPal inconnu.",
          });
          return { ignored: true, reason: "unknown_intent" };
        }
        if (intent.status && intent.status !== "created") {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType,
            status: "ignored",
            reason: "already_processed",
            httpStatus: 200,
            syndicId: intent.syndicId,
            orderId: relatedOrderId || intent.orderId || undefined,
            reference: captureId || undefined,
            message: `Intent PayPal déjà traité (statut : ${intent.status}).`,
          });
          return {
            ignored: true,
            reason: "already_processed",
            ...(intent.paymentId ? { paymentId: intent.paymentId } : {}),
          };
        }
        if (
          currency !== intent.paypalCurrency ||
          amountCents !== intent.paypalCents
        ) {
          recordGatewayEvent(state, {
            gateway: "paypal",
            eventType,
            status: "rejected",
            httpStatus: 400,
            syndicId: intent.syndicId,
            orderId: relatedOrderId || undefined,
            reference: captureId || undefined,
            message: "Montant ou devise webhook PayPal incohérent.",
          });
          throw new OperationError(
            "Montant ou devise webhook PayPal incohérent.",
            400,
          );
        }
        const payment = activatePlatformSubscription(
          state,
          { uid: "paypal:webhook", role: "admin" },
          {
            syndicId: intent.syndicId,
            plan: intent.plan as SubscriptionPlan,
            months: Number(intent.months),
            reference: captureId || relatedOrderId || intent.intentId,
            amountMad: Number(intent.amountMad),
            method: intent.paymentSourceHint === "card" ? "card" : "paypal",
            currency: intent.paypalCurrency,
            chargedAmount: Number(intent.paypalCents) / 100,
            ...(intent.promoCode ? { promoCode: String(intent.promoCode) } : {}),
            externalOrderId: relatedOrderId || intent.orderId || captureId,
            ...(captureId ? { externalCaptureId: captureId } : {}),
            auditOperation: "paypalWebhookSubscription",
          },
        );
        intent.status = "completed";
        if (relatedOrderId) {
          intent.orderId = relatedOrderId;
          (state.__paypalOrders ??= {})[relatedOrderId] = intentKey;
        }
        intent.paymentId = payment.id;
        recordGatewayEvent(state, {
          gateway: "paypal",
          eventType,
          status: "ok",
          httpStatus: 200,
          syndicId: intent.syndicId,
          orderId: relatedOrderId || intent.orderId || undefined,
          reference: payment.reference,
          message: `Abonnement activé via webhook PayPal (${payment.invoiceNumber || payment.id}).`,
        });
        return { ignored: false, paymentId: payment.id };
      });

      return res.json({ ok: true, ...outcome });
    }, false),
  );
}

export function registerCmiWebhookRoutes(
  app: express.Express,
  deps: CmiWebhookRoutesDeps,
) {
  const { wrap, repository, ephemeralGatewayEvents } = deps;

  // Official CMI Server-to-Server Callback (expects plain-text ACTION=POSTAUTH / APPROVED / FAILURE)
  app.post(
    "/api/webhooks/cmi",
    wrap(async (req, res) => {
      const replyPlain = (code: number, token: "ACTION=POSTAUTH" | "APPROVED" | "FAILURE") => {
        res.status(code).type("text/plain").send(token);
      };

      const envelope = validateCmiWebhookEnvelope(req.body);
      if (!envelope.ok) {
        return replyPlain(400, "FAILURE");
      }
      const {
        payload,
        oid,
        procReturnCode,
        responseLabel,
        transId,
        callbackAmount,
        callbackAmountCents,
        callbackCurrency,
      } = envelope.value;

      const recordEphemeralCmiEvent = (
        event: Omit<GatewayEventRecord, "id" | "createdAt">,
      ) => {
        ephemeralGatewayEvents.record({
          id: crypto.randomUUID(),
          ...event,
          message: String(event.message || "").slice(0, 500),
          createdAt: new Date().toISOString(),
        });
      };

      const outcome = await repository.transaction(async (state) => {
        const cmiSecrets = resolvePlatformBillingConfig(state).cmiSecrets;
        if (!cmiSecrets.storeKey || !cmiSecrets.clientId) {
          recordEphemeralCmiEvent({
            gateway: "cmi",
            eventType: "CMI_CALLBACK",
            status: "error",
            httpStatus: 503,
            orderId: oid || undefined,
            message: "Passerelle CMI non configurée sur ce serveur.",
          });
          return { code: 503, token: "FAILURE" as const };
        }

        if (!verifyCmiCallbackHash(payload, cmiSecrets.storeKey)) {
          recordEphemeralCmiEvent({
            gateway: "cmi",
            eventType: "CMI_CALLBACK_INVALID_HASH",
            status: "rejected",
            httpStatus: 200,
            orderId: oid || undefined,
            reference: transId || undefined,
            message: "Signature SHA-512 CMI (HASH) invalide — transaction rejetée.",
          });
          return { code: 200, token: "FAILURE" as const };
        }

        const intent = oid ? state.__cmiIntents?.[oid] : undefined;
        if (!intent) {
          recordEphemeralCmiEvent({
            gateway: "cmi",
            eventType: "CMI_CALLBACK_UNKNOWN_OID",
            status: "rejected",
            httpStatus: 200,
            orderId: oid || undefined,
            message: "Commande CMI (oid) introuvable.",
          });
          return { code: 200, token: "FAILURE" as const };
        }

        if (procReturnCode !== "00") {
          if (intent.status !== "completed" && intent.status !== "refunded") {
            intent.status = "failed";
          }
          intent.lastProcReturnCode = procReturnCode;
          recordGatewayEvent(state, {
            gateway: "cmi",
            eventType: "CMI_PAYMENT_DECLINED",
            status: "ignored",
            httpStatus: 200,
            syndicId: intent.syndicId,
            orderId: oid,
            reference: transId || undefined,
            message: `Paiement CMI refusé (ProcReturnCode=${procReturnCode || "?"}, Response=${responseLabel || "?"}).`,
          });
          return { code: 200, token: "APPROVED" as const };
        }

        const existingPayment = findProcessedGatewayPayment(state, {
          externalOrderIds: [oid],
          externalCaptureIds: [transId],
          paymentId: intent.paymentId,
        });
        if (
          existingPayment ||
          intent.status === "completed" ||
          intent.status === "refunded"
        ) {
          const isVoided = Boolean(
            existingPayment?.voidedAt || intent.status === "refunded",
          );
          recordGatewayEvent(state, {
            gateway: "cmi",
            eventType: "CMI_PAYMENT_POSTAUTH",
            status: "ignored",
            reason: "already_processed",
            httpStatus: 200,
            syndicId: existingPayment?.syndicId || intent.syndicId,
            orderId: oid,
            reference: transId || existingPayment?.reference || undefined,
            message: isVoided
              ? "Callback CMI déjà traité puis annulé."
              : "Callback CMI déjà traité.",
          });
          return {
            code: 200,
            token: isVoided ? ("APPROVED" as const) : ("ACTION=POSTAUTH" as const),
          };
        }

        if (
          callbackAmountCents !== Number(intent.amountMadCents) ||
          (callbackCurrency && callbackCurrency !== String(intent.currencyCode))
        ) {
          recordGatewayEvent(state, {
            gateway: "cmi",
            eventType: "CMI_AMOUNT_MISMATCH",
            status: "rejected",
            httpStatus: 200,
            syndicId: intent.syndicId,
            orderId: oid,
            reference: transId || undefined,
            message: `Montant ou devise CMI incohérent (reçu ${callbackAmount} / ${callbackCurrency}, attendu ${intent.amountMad} / ${intent.currencyCode}).`,
          });
          return { code: 200, token: "FAILURE" as const };
        }

        const payment = activatePlatformSubscription(
          state,
          { uid: "cmi:webhook", role: "admin" },
          {
            syndicId: intent.syndicId,
            plan: intent.plan as SubscriptionPlan,
            months: Number(intent.months),
            reference: transId || oid,
            amountMad: Number(intent.amountMad),
            method: "cmi",
            currency: (intent.currencyLabel || "MAD") as "MAD" | "EUR" | "USD",
            chargedAmount: Number(intent.amountMad),
            ...(intent.promoCode ? { promoCode: String(intent.promoCode) } : {}),
            externalOrderId: oid,
            ...(transId ? { externalCaptureId: transId } : {}),
            auditOperation: "cmiWebhookSubscription",
          },
        );

        intent.status = "completed";
        intent.paymentId = payment.id;
        intent.transId = transId || undefined;
        recordGatewayEvent(state, {
          gateway: "cmi",
          eventType: "CMI_PAYMENT_POSTAUTH",
          status: "ok",
          httpStatus: 200,
          syndicId: intent.syndicId,
          orderId: oid,
          reference: payment.reference,
          message: `Paiement CMI validé (ACTION=POSTAUTH) — ${payment.amount} MAD (${payment.invoiceNumber || payment.id}).`,
        });
        return { code: 200, token: "ACTION=POSTAUTH" as const };
      });

      return replyPlain(outcome.code, outcome.token);
    }, false),
  );
}
