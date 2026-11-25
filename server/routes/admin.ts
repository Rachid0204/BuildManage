import crypto from "crypto";
import type express from "express";
import { z } from "zod";
import { deliverOutbox, mailIsConfigured, queueMail } from "../mailer";
import { appendAudit, OperationError } from "../operations";
import { resolvePlatformBillingConfig } from "../paypalBilling";
import {
  deliverPushOutbox,
  queuePushNotification,
} from "../pushNotifications";
import type { StateRepository } from "../repository";
import type { EphemeralGatewayEventBuffer } from "../requestGuard";
import { PLANS } from "../../shared/domain/subscription";
import type {
  GatewayEventRecord,
  SubscriptionPlan,
  SubscriptionPromoCode,
} from "../../types";
import type {
  AssertOnboardedFn,
  ExtractAndVerifyCallerFn,
  ServerStore,
  WrapFn,
  WrappedApi,
} from "./types";

export interface AdminRoutesDeps {
  api: WrappedApi;
  wrap: WrapFn;
  repository: StateRepository;
  sharedStore: ServerStore;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  assertOnboarded: AssertOnboardedFn;
  ephemeralGatewayEvents: EphemeralGatewayEventBuffer<GatewayEventRecord>;
}

export function registerAdminRoutes(
  app: express.Express,
  deps: AdminRoutesDeps,
) {
  const {
    api,
    wrap,
    repository,
    sharedStore,
    extractAndVerifyCaller,
    assertOnboarded,
    ephemeralGatewayEvents,
  } = deps;

  // --- Admin Promo Code CRUD ---
  const PromoCreateSchema = z.object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(32)
      .regex(/^[A-Za-z0-9_-]+$/),
    discountType: z.enum(["percent", "fixed_mad"]),
    discountValue: z.number().positive().max(100_000),
    active: z.boolean().optional(),
    applicablePlans: z
      .array(z.enum(["starter", "professional", "enterprise"]))
      .optional(),
    minMonths: z.number().int().min(1).max(12).optional(),
    maxUses: z.number().int().min(1).max(100_000).optional(),
    validUntil: z.string().max(40).optional(),
    description: z.string().max(240).optional(),
  });

  api.get("/api/admin/promos", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const promos: SubscriptionPromoCode[] =
      sharedStore.__subscriptionPromos || [];
    return res.json({ ok: true, promos: [...promos].reverse() });
  });

  api.post("/api/admin/promos", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const parsed = PromoCreateSchema.parse(req.body);
    if (parsed.discountType === "percent" && parsed.discountValue > 95) {
      throw new OperationError(
        "La remise en pourcentage ne peut dépasser 95%.",
        400,
      );
    }
    const normalizedCode = parsed.code.trim().toUpperCase();
    const promos: SubscriptionPromoCode[] =
      (sharedStore.__subscriptionPromos ??= []);
    if (promos.some((p) => p.code.toUpperCase() === normalizedCode)) {
      throw new OperationError("Ce code promotionnel existe déjà.", 409);
    }
    const promo: SubscriptionPromoCode = {
      id: crypto.randomUUID(),
      code: normalizedCode,
      discountType: parsed.discountType,
      discountValue: Number(parsed.discountValue.toFixed(2)),
      active: parsed.active ?? true,
      ...(parsed.applicablePlans?.length
        ? { applicablePlans: parsed.applicablePlans }
        : {}),
      ...(parsed.minMonths ? { minMonths: parsed.minMonths } : {}),
      ...(parsed.maxUses ? { maxUses: parsed.maxUses } : {}),
      usedCount: 0,
      ...(parsed.validUntil?.trim()
        ? { validUntil: parsed.validUntil.trim() }
        : {}),
      ...(parsed.description?.trim()
        ? { description: parsed.description.trim() }
        : {}),
      createdAt: new Date().toISOString(),
      createdBy: caller.uid,
    };
    promos.push(promo);
    appendAudit(sharedStore, caller, "adminCreatePromoCode", undefined, {
      promoId: promo.id,
      code: promo.code,
      discountType: promo.discountType,
      discountValue: promo.discountValue,
    });
    return res.json({ ok: true, promo });
  });

  app.patch(
    "/api/admin/promos/:id",
    wrap(async (req, res) => {
      const caller = await extractAndVerifyCaller(req, sharedStore);
      if (!caller)
        return res.status(401).json({ error: "Authentification requise." });
      if (caller.role !== "admin")
        return res.status(403).json({ error: "Administration uniquement." });
      assertOnboarded(caller, sharedStore);
      const promos: SubscriptionPromoCode[] =
        sharedStore.__subscriptionPromos || [];
      const promo = promos.find((p) => p.id === req.params.id);
      if (!promo) throw new OperationError("Code promo introuvable.", 404);
      if (typeof req.body?.active === "boolean") {
        promo.active = req.body.active;
      }
      if (typeof req.body?.description === "string") {
        promo.description = req.body.description.trim().slice(0, 240);
      }
      if (typeof req.body?.validUntil === "string") {
        const trimmed = req.body.validUntil.trim();
        if (trimmed) promo.validUntil = trimmed;
        else delete promo.validUntil;
      }
      if (req.body?.maxUses !== undefined) {
        const n = Number(req.body.maxUses);
        if (Number.isInteger(n) && n >= 1) promo.maxUses = n;
        else if (req.body.maxUses === null || req.body.maxUses === "")
          delete promo.maxUses;
      }
      appendAudit(sharedStore, caller, "adminUpdatePromoCode", undefined, {
        promoId: promo.id,
        code: promo.code,
        active: promo.active,
      });
      return res.json({ ok: true, promo });
    }, true),
  );

  app.delete(
    "/api/admin/promos/:id",
    wrap(async (req, res) => {
      const caller = await extractAndVerifyCaller(req, sharedStore);
      if (!caller)
        return res.status(401).json({ error: "Authentification requise." });
      if (caller.role !== "admin")
        return res.status(403).json({ error: "Administration uniquement." });
      assertOnboarded(caller, sharedStore);
      const promos: SubscriptionPromoCode[] =
        sharedStore.__subscriptionPromos || [];
      const idx = promos.findIndex((p) => p.id === req.params.id);
      if (idx < 0) throw new OperationError("Code promo introuvable.", 404);
      const [removed] = promos.splice(idx, 1);
      appendAudit(sharedStore, caller, "adminDeletePromoCode", undefined, {
        promoId: removed.id,
        code: removed.code,
      });
      return res.json({ ok: true });
    }, true),
  );

  // --- Admin Audit Trail & Gateway Webhook Monitor ---
  api.get("/api/admin/audit-logs", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const operation = String(req.query.operation || "").trim().toLowerCase();
    const search = String(req.query.q || "").trim().toLowerCase();
    const all = [...(sharedStore.syndik_prod_audit_v1 || [])].reverse();
    const filtered = all
      .filter((entry: any) => {
        if (
          operation &&
          String(entry.operation || "").toLowerCase() !== operation
        ) {
          return false;
        }
        if (!search) return true;
        return JSON.stringify(entry).toLowerCase().includes(search);
      })
      .slice(0, limit);
    return res.json({ ok: true, logs: filtered, total: all.length });
  });

  api.get("/api/admin/gateway-events", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    if (caller.role !== "admin")
      return res.status(403).json({ error: "Administration uniquement." });
    assertOnboarded(caller, sharedStore);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const gateway = String(req.query.gateway || "").trim().toLowerCase();
    const status = String(req.query.status || "").trim().toLowerCase();
    const all = [
      ...(sharedStore.__gatewayEvents || []),
      ...ephemeralGatewayEvents.list(),
    ].sort((a: any, b: any) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    );
    const filtered = all
      .filter((ev: any) => {
        if (gateway && String(ev.gateway || "").toLowerCase() !== gateway)
          return false;
        if (status && String(ev.status || "").toLowerCase() !== status)
          return false;
        return true;
      })
      .slice(0, limit);
    return res.json({ ok: true, events: filtered, total: all.length });
  });

  // --- Admin Renewal Dunning Reminder (with 24h anti-spam cooldown) ---
  app.post(
    "/api/admin/cabinets/:id/send-reminder",
    wrap(async (req, res) => {
      const dispatched = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller) throw new OperationError("Authentification requise.", 401);
        if (caller.role !== "admin")
          throw new OperationError("Administration uniquement.", 403);
        assertOnboarded(caller, state);
        const syndic = (state.syndik_prod_syndics_v1 || []).find(
          (s: any) => s.id === req.params.id,
        );
        if (!syndic) throw new OperationError("Cabinet introuvable.", 404);
        if (syndic.archivedAt)
          throw new OperationError("Cabinet archivé.", 409);
        const targetEmail = String(syndic.email || "").trim();
        if (!targetEmail || !/^\S+@\S+\.\S+$/.test(targetEmail)) {
          throw new OperationError(
            "Ce cabinet ne dispose pas d'une adresse email valide.",
            400,
          );
        }
        const sentMap = (state.__renewalRemindersSent ??= {});
        const lastSentIso = sentMap[syndic.id];
        const cooldownMs = 24 * 3600 * 1000;
        if (lastSentIso && Date.now() - Date.parse(lastSentIso) < cooldownMs) {
          throw new OperationError(
            "Un rappel a déjà été envoyé à ce cabinet au cours des dernières 24 heures.",
            429,
          );
        }
        const billing = resolvePlatformBillingConfig(state).publicConfig;
        const expiryFormatted = syndic.subscriptionExpiry
          ? new Date(syndic.subscriptionExpiry).toLocaleDateString("fr-MA")
          : "—";
        const planPrice =
          PLANS[syndic.subscriptionPlan as SubscriptionPlan]?.price ?? 390;
        const subject = `Rappel de renouvellement — Abonnement ${billing.issuerProfile?.companyName || "Syndik"} (${syndic.name})`;
        const bodyLines = [
          `Bonjour ${syndic.name},`,
          "",
          `Votre abonnement (${syndic.subscriptionPlan} — ${planPrice} MAD/mois) arrive à échéance le ${expiryFormatted}.`,
          "Connectez-vous à votre espace Syndic pour renouveler votre abonnement (Carte CMI Maroc, PayPal, Virement RIB ou Espèces / Agence).",
          ...(billing.issuerProfile?.phone
            ? [`Support : ${billing.issuerProfile.phone}`]
            : []),
          "",
          `Cordialement,`,
          billing.issuerProfile?.companyName || "Équipe Syndik",
        ];
        const mailReady = mailIsConfigured();
        if (mailReady) {
          queueMail(state, targetEmail, subject, bodyLines.join("\n"));
        }
        const nowIso = new Date().toISOString();
        const notifs = (state.syndik_prod_notifications_v1 ??= []);
        const targetUsers = (state.syndik_prod_registered_users_v1 || []).filter(
          (u: any) =>
            !u.disabled &&
            u.profile?.role === "syndic" &&
            (u.uid === syndic.createdBy || u.profile?.syndicId === syndic.id),
        );
        const notifiedUids = new Set<string>(
          targetUsers.map((u: any) => String(u.uid)),
        );
        if (syndic.createdBy) notifiedUids.add(String(syndic.createdBy));
        for (const uid of notifiedUids) {
          const reminderTitle = "Rappel de renouvellement d'abonnement";
          const reminderBody = `Votre abonnement (${syndic.subscriptionPlan}) arrive à échéance le ${expiryFormatted}.`;
          notifs.push({
            id: crypto.randomUUID(),
            userId: uid,
            title: reminderTitle,
            message: `${reminderBody} Renouvelez par CMI, PayPal, Virement ou Espèces.`,
            type: "warning",
            read: false,
            link: "/settings",
            createdAt: nowIso,
          });
          queuePushNotification(state, {
            uid,
            title: reminderTitle,
            body: reminderBody,
            type: "warning",
            link: "/settings",
          });
        }
        sentMap[syndic.id] = nowIso;
        appendAudit(state, caller, "adminSendRenewalReminder", undefined, {
          syndicId: syndic.id,
          email: targetEmail,
          emailQueued: mailReady,
          inAppRecipients: notifiedUids.size,
          subscriptionExpiry: syndic.subscriptionExpiry,
        });
        return {
          email: targetEmail,
          sentAt: nowIso,
          emailQueued: mailReady,
          inAppRecipients: notifiedUids.size,
        };
      });
      if (dispatched.emailQueued) {
        await deliverOutbox(repository, 5).catch(() => {});
      }
      void deliverPushOutbox(repository, 5).catch(() => {});
      return res.json({
        ok: true,
        email: dispatched.email,
        sentAt: dispatched.sentAt,
        emailQueued: dispatched.emailQueued,
        inAppRecipients: dispatched.inAppRecipients,
        message: dispatched.emailQueued
          ? `Rappel envoyé par email (${dispatched.email}) et notification portail.`
          : `Notification de renouvellement envoyée dans le portail du cabinet (SMTP/SendGrid non configuré).`,
      });
    }, false),
  );
}
