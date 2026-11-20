import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getBuildingCapacity,PLANS,subscriptionCanWrite } from "../../utils/subscriptionPolicy";
import {
ApartmentSchema,
BuildingSchema,
PrestataireSchema,
ResidentSchema,
SyndicSchema,
TransactionSchema,
} from "../../utils/validation";
import { allAttachmentValues, privateAttachments } from '../attachments';
import { fileIsReferenced } from '../lifecycle';
import { mailIsConfigured,queueMail } from "../mailer";
import { queuePushNotification } from "../pushNotifications";
import { resolvePlatformBillingConfig } from "../paypalBilling";
import { type State } from "../repository";
import { firebaseLinkedResidentIds,LINKED_RESIDENT_EMAIL_CODE,LINKED_RESIDENT_EMAIL_MESSAGE } from '../residentIdentity';
import { createAssemblyCommands } from './assembly.service';
import { normalizeBillingPeriodKey } from "./billingPeriod";
import { createBuildingCommands, syncResidentAccountApartment } from './building.service';
import type { CommandDependencies } from './dependencies';
import { dispatchMutation } from "./dispatch";
import { createFinanceCommands } from './finance.service';

import { OperationError,type Actor } from "./errors";

export function createCommandService(transactionState: State) {
const state = transactionState;
const dispatch = (actor: Actor, operation: string, args: any[], scope?: {cabinetId?:string;buildingId?:string}) => dispatchMutation(transactionState, actor, operation, args, scope);
function check(
  condition: unknown,
  message: string,
  status = 403,
): asserts condition {
  if (!condition) throw new OperationError(message, status);
}
const object = (value: any) => z.record(z.unknown()).parse(value);
const str = (value: any, max = 3000) => z.string().min(1).max(max).parse(value);
const pick = (value: any, keys: string[]) =>
  Object.fromEntries(
    Object.entries(object(value)).filter(([key]) => keys.includes(key)),
  );
const cents = (value: any) => {
  check(
    typeof value === "number" &&
      Number.isFinite(value) &&
      Math.abs(value) < 1e10,
    "Montant invalide.",
    400,
  );
  return Math.round(value * 100);
};
const actorIdentity = (a: Actor) =>
  a.role === "resident"
    ? a.residentId || a.uid.replace(/^(user-res-|res-)/, "")
    : a.role === "provider"
      ? a.prestataireId || a.uid.replace(/^(user-prest-|prov-)/, "")
      : a.uid;
const cabinets = () => transactionState.syndik_prod_syndics_v1 || [];
const buildings = () => cabinets().flatMap((s: any) => s.buildings || []);
function manager(actor: Actor) {
  check(
    ["syndic", "admin"].includes(actor.role),
    "Opération réservée au syndic.",
  );
}
function cabinetFor(actor: Actor, id: string) {
  const s = cabinets().find((s: any) => s.id === id);
  check(
    s &&
      (actor.role === "admin" ||
        s.createdBy === actor.uid ||
        actor.syndicId === id),
    "Cabinet non autorisé.",
  );
  return s;
}
function buildingFor(actor: Actor, id: string, managed = true) {
  const s = cabinets().find((s: any) =>
    s.buildings?.some((b: any) => b.id === id),
  );
  check(s, "Immeuble introuvable.", 404);
  cabinetFor(actor, s.id);
  const b = s.buildings.find((b: any) => b.id === id);
  if (managed) manager(actor);
  else if (!["admin", "syndic"].includes(actor.role)) {
    const memberId = actorIdentity(actor);
    const inBuilding =
      actor.buildingId === id ||
      (actor.role === "resident" &&
        Array.isArray(b?.residents) &&
        b.residents.some(
          (r: any) =>
            !r.archivedAt && (r.id === memberId || r.id === actor.uid),
        )) ||
      (actor.role === "provider" &&
        (transactionState.syndik_prod_prestataires_v1 || []).some(
          (p: any) =>
            p.buildingId === id &&
            !p.archivedAt &&
            p.active !== false &&
            (p.id === memberId || p.id === actor.uid),
        ));
    check(inBuilding, "Immeuble non autorisé.");
  }
  b.syndicId = s.id;
  return b;
}
function canWrite(actor: Actor, b: any) {
  const user = (transactionState.syndik_prod_registered_users_v1 || []).find(
    (u: any) => u.uid === actor.uid,
  );
  check(
    (actor as any).emailVerified !== false &&
      user?.profile?.emailVerified !== false,
    "Vérifiez votre adresse email.",
  );
  check(
    !user?.profile?.mustChangePassword && !(actor as any).mustChangePassword,
    "Changez votre mot de passe initial avant de continuer.",
  );
  check(!b.archivedAt, "Immeuble archivé.", 409);
  if (actor.role !== "admin") {
    const cab = cabinetFor(actor, b.syndicId);
    check(!cab.archivedAt, "Cabinet archivé.", 409);
    const graceDays =
      resolvePlatformBillingConfig(transactionState).publicConfig
        .commercialPolicy?.gracePeriodDays ?? 0;
    check(
      subscriptionCanWrite(cab, graceDays),
      "Abonnement expiré : consultation et export disponibles.",
      402,
    );
  }
}
function appendAudit(
  state: State,
  actor: Actor,
  operation: string,
  buildingId?: string,
  detail?: any,
) {
  (transactionState.syndik_prod_audit_v1 ??= []).push({
    id: randomUUID(),
    actorUid: actor.uid,
    actorRole: actor.role,
    syndicId: buildingId
      ? buildings().find((b: any) => b.id === buildingId)?.syndicId
      : actor.syndicId,
    buildingId,
    operation,
    detail,
    createdAt: new Date().toISOString(),
  });
}
function record(actor: Actor, key: string, id: any, managed = true) {
  const item = (state[key] || []).find((x: any) => x.id === id);
  check(item, "Enregistrement introuvable.", 404);
  const b = buildingFor(actor, item.buildingId, managed);
  canWrite(actor, b);
  return { item, b };
}
function nested(actor: Actor, key: string, id: string) {
  const b = buildings().find((b: any) => b[key]?.some((x: any) => x.id === id));
  check(b, "Enregistrement introuvable.", 404);
  buildingFor(actor, b.id);
  canWrite(actor, b);
  return { b, item: b[key].find((x: any) => x.id === id) };
}
function links(b: any, apt: any) {
  for (const field of ["ownerId", "tenantId"])
    if (apt[field])
      check(
        b.residents.some(
          (r: any) =>
            r.id === apt[field] &&
            !r.archivedAt &&
            r.isOwner === (field === "ownerId"),
        ),
        "Occupant non lié.",
        400,
      );
  const normalizedNumber = String(apt.number || "").trim().toLowerCase();
  check(
    !b.apartments.some(
      (a: any) =>
        String(a.number || "").trim().toLowerCase() === normalizedNumber &&
        a.id !== apt.id &&
        !a.archivedAt,
    ),
    "Numéro de lot déjà utilisé.",
    409,
  );
}
const secretFields = [
  "password",
  "passwordHash",
  "generatedPassword",
  "invitationToken",
  "invitationCode",
  "invitationExpiresAt",
  "invitationStatus",
  "credentialsCreatedAt",
  "credentialsSharedAt",
  "credentialsLastSharedMethod",
  "credentialsAuditLog",
  "mustChangePassword",
];
function revoke(id: string) {
  const state = transactionState;
  for (const user of transactionState.syndik_prod_registered_users_v1 || [])
    if (user.profile?.residentId === id || user.profile?.prestataireId === id)
      (transactionState.__sessionVersions ??= {})[user.uid] =
        (transactionState.__sessionVersions?.[user.uid] || 0) + 1;
}
const SAFE_MEDIA_URL_RE = /^(\/api\/uploads\/[A-Za-z0-9_-]+|https:\/\/[^\s]+)$/;
const MARKETPLACE_CATEGORY_MAP: Record<string, string> = {
  mobilier: "mobilier",
  furniture: "mobilier",
  electromenager: "electromenager",
  electronics: "electromenager",
  appliances: "electromenager",
  parking: "parking",
  services: "services",
  service: "services",
  enfants: "enfants",
  kids: "enfants",
  don_gratuit: "don_gratuit",
  free: "don_gratuit",
  bricolage: "autre",
  autre: "autre",
  other: "autre",
};
const MARKETPLACE_CONDITION_MAP: Record<string, string> = {
  neuf: "neuf",
  new: "neuf",
  tres_bon_etat: "tres_bon_etat",
  like_new: "tres_bon_etat",
  bon_etat: "bon_etat",
  good: "bon_etat",
  a_depanner: "a_depanner",
  fair: "a_depanner",
};
const ALLOWED_MAINTENANCE_CATEGORIES = [
  "elevator",
  "plumbing",
  "electrical",
  "common_area",
  "cleaning",
  "security",
  "other",
] as const;
const ALLOWED_MAINTENANCE_PRIORITIES = [
  "low",
  "medium",
  "high",
  "emergency",
] as const;
const ALLOWED_PUBLIC_CHAT_CHANNELS = [
  "general",
  "syndic",
  "help",
  "marketplace",
] as const;

function validateMediaUrls(urls: unknown): string[] | undefined {
  if (urls === undefined || urls === null) return undefined;
  const list = z.array(z.string().trim().min(1).max(2048)).max(10).parse(urls);
  for (const url of list) {
    check(
      SAFE_MEDIA_URL_RE.test(url),
      "URL de média invalide (HTTPS ou /api/uploads/ requis).",
      400,
    );
  }
  return list;
}

function validateMediaUrl(url: unknown): string | undefined {
  if (url === undefined || url === null || String(url).trim() === "")
    return undefined;
  const clean = z.string().trim().min(1).max(2048).parse(url);
  check(
    SAFE_MEDIA_URL_RE.test(clean),
    "URL de média invalide (HTTPS ou /api/uploads/ requis).",
    400,
  );
  return clean;
}

function cabinetSyndicUids(b: any): Set<string> {
  const uids = new Set<string>();
  const cab = cabinets().find((s: any) => s.id === b?.syndicId);
  if (cab?.createdBy) uids.add(cab.createdBy);
  for (const u of transactionState.syndik_prod_registered_users_v1 || []) {
    if (u?.disabled) continue;
    if (
      u?.profile?.role === "syndic" &&
      (u.profile.syndicId === b?.syndicId || u.uid === cab?.createdBy)
    ) {
      uids.add(u.uid);
    }
  }
  return uids;
}

function actorDisplayName(actor: Actor, b?: any): string {
  const id = actorIdentity(actor);
  if (actor.role === "resident") {
    const res = (b?.residents || []).find(
      (r: any) => r.id === id || r.id === actor.uid,
    );
    if (res?.name) return res.name;
    const reg = (transactionState.syndik_prod_registered_users_v1 || []).find(
      (u: any) => u.uid === actor.uid,
    );
    return reg?.profile?.displayName || "Copropriétaire";
  }
  if (actor.role === "provider") {
    const prov = (transactionState.syndik_prod_prestataires_v1 || []).find(
      (p: any) => p.id === id || p.id === actor.uid,
    );
    if (prov?.name) return prov.name;
    const reg = (transactionState.syndik_prod_registered_users_v1 || []).find(
      (u: any) => u.uid === actor.uid,
    );
    return reg?.profile?.displayName || "Prestataire";
  }
  const reg = (transactionState.syndik_prod_registered_users_v1 || []).find(
    (u: any) => u.uid === actor.uid,
  );
  if (reg?.profile?.displayName) return reg.profile.displayName;
  const cab = cabinets().find(
    (s: any) => s.id === (b?.syndicId || actor.syndicId),
  );
  if (cab?.name) return cab.name;
  return actor.role === "admin" ? "Administration" : "Syndic";
}

function residentApartmentLabel(b: any, residentId: string): string | undefined {
  const res = (b?.residents || []).find(
    (r: any) => !r.archivedAt && r.id === residentId,
  );
  const apts = (b?.apartments || []).filter((a: any) => !a.archivedAt);
  const linked =
    (res?.apartmentId &&
      apts.find(
        (a: any) =>
          a.id === res.apartmentId &&
          (a.ownerId === residentId || a.tenantId === residentId),
      )) ||
    apts.find((a: any) => a.ownerId === residentId || a.tenantId === residentId);
  return linked?.number
    ? `Lot ${String(linked.number).replace(/^(Lot|شقة)\s+/i, "").trim()}`
    : undefined;
}

function maintenanceStatusFr(status?: string, completionPending?: boolean): string {
  if (completionPending) return "Intervention à valider";
  if (status === "completed") return "Clôturée";
  if (status === "in_progress") return "En cours";
  return "En attente";
}

function defaultNotificationLink(type: string): string {
  if (type === "invoice") return "/financials";
  if (type === "maintenance") return "/maintenance";
  if (type === "announcement") return "/announcements";
  return "/";
}

function pushUserNotification(
  uid: string,
  b: any,
  title: string,
  message: string,
  type: string,
  link?: string,
) {
  const resolvedLink = link || defaultNotificationLink(type);
  const account = (transactionState.syndik_prod_registered_users_v1 || []).find(
    (u: any) => !u.disabled && u.uid === uid,
  );
  if (account?.email && mailIsConfigured())
    queueMail(
      transactionState,
      account.email,
      title,
      `${message}\n\n${process.env.PUBLIC_APP_URL || "http://localhost:3000"}`,
    );
  queuePushNotification(transactionState, {
    uid,
    title,
    body: message,
    type,
    link: resolvedLink,
  });
  (transactionState.syndik_prod_notifications_v1 ??= []).push({
    id: randomUUID(),
    userId: uid,
    buildingId: b.id,
    title,
    message,
    type,
    link: resolvedLink,
    read: false,
    createdAt: new Date().toISOString(),
  });
}

function notice(
  residentId: string,
  b: any,
  title: string,
  message: string,
  type: string,
  link?: string,
) {
  const regUsers = transactionState.syndik_prod_registered_users_v1 || [];
  const account = regUsers.find(
    (u: any) =>
      !u.disabled &&
      (u.uid === residentId || u.profile?.residentId === residentId),
  );
  if (account?.uid) {
    pushUserNotification(account.uid, b, title, message, type, link);
    return;
  }
  const isKnownResident = (b?.residents || []).some(
    (r: any) => !r.archivedAt && r.id === residentId,
  );
  if (!isKnownResident) return;
  pushUserNotification(`user-res-${residentId}`, b, title, message, type, link);
}

function notifyCabinetSyndics(
  b: any,
  title: string,
  message: string,
  type: string,
  link?: string,
) {
  for (const uid of cabinetSyndicUids(b)) {
    pushUserNotification(uid, b, title, message, type, link);
  }
}
function validateAttachments(actor: Actor, b: any, input: unknown, existing?: unknown) {
  const previous = privateAttachments(existing);
  for (const url of privateAttachments(input)) {
    const meta = transactionState.__files?.[url.slice('/api/uploads/'.length)];
    check(meta && meta.buildingId === b.id &&
      (['admin', 'syndic'].includes(actor.role) || meta.uploadedBy === actor.uid || previous.has(url)),
      'Pièce jointe privée ou non liée à cet immeuble.');
  }
}
function assertPeriod(b: any, date: any) {
  const s = String(date || "");
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(s);
  const valid =
    Boolean(m) &&
    Number.isFinite(Date.parse(s)) &&
    (() => {
      const y = Number(m![1]);
      const mo = Number(m![2]);
      const d = Number(m![3]);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === mo - 1 &&
        dt.getUTCDate() === d
      );
    })();
  check(valid, "Date comptable invalide.", 400);
  check(
    !transactionState.__closedPeriods?.[`${b.id}:${s.slice(0, 7)}`],
    "Période comptable clôturée.",
    409,
  );
}

async function runOperation(
  actor: Actor,
  operation: string,
  rawArgs: any[],
  operationId: string,
): Promise<any> {
  check(
    Array.isArray(rawArgs) && rawArgs.length <= 10,
    "Arguments invalides.",
    400,
  );
  const args = JSON.parse(JSON.stringify(rawArgs)),
    state = transactionState;
  const user = (transactionState.syndik_prod_registered_users_v1 || []).find(
    (u: any) => u.uid === actor.uid,
  );
  check(
    (actor as any).emailVerified !== false &&
      user?.profile?.emailVerified !== false,
    "Vérifiez votre adresse email.",
  );
  check(
    !user?.profile?.mustChangePassword && !(actor as any).mustChangePassword,
    "Changez votre mot de passe initial avant de continuer.",
  );
  let b: any,
    buildingId: string | undefined,
    changedCredentials: { kind: string; id: string } | undefined;
  if (operation === "adminCreateCabinet") return createCabinet(actor, args[0]);
  if (operation === "adminArchiveCabinet") return archiveCabinet(actor, args[0]);
  if (operation === "adminRestoreCabinet") return restoreCabinet(actor, args[0]);
  if (operation === "recordSubscriptionPayment")
    return subscriptionPayment(actor, args[0]);
  if (operation === "voidSubscriptionPayment")
    return voidSubscriptionPayment(actor, args[0], args[1]);
  if (operation === "submitSubscriptionBankTransfer")
    return submitSubscriptionBankTransfer(actor, args[0]);
  if (operation === "reviewSubscriptionBankTransfer")
    return reviewSubscriptionBankTransfer(actor, args[0]);
  if (operation === "saveSyndic") {
    manager(actor);
    const input = object(args[0]),
      s = cabinetFor(actor, str(input.id));
    check(!s.archivedAt, "Cabinet archivé.", 409);
    const graceDays =
      resolvePlatformBillingConfig(transactionState).publicConfig
        .commercialPolicy?.gracePeriodDays ?? 0;
    check(
      actor.role === "admin" || subscriptionCanWrite(s, graceDays),
      "Abonnement expiré : consultation et export disponibles.",
      402,
    );
    const data = SyndicSchema.partial().parse(input);
    if (data.rib && data.rib.trim() !== "")
      check(/^\d{24}$/.test(data.rib.replace(/\s/g, "")), "RIB invalide.", 400);
    if (data.ice && data.ice.trim() !== "")
      check(
        /^\d{15}$/.test(data.ice.replace(/\s/g, "")),
        "ICE invalide (15 chiffres requis).",
        400,
      );
    if (actor.role === "admin") {
      if (input.subscriptionPlan)
        check(
          String(input.subscriptionPlan) in PLANS,
          "Forfait invalide.",
          400,
        );
      if (input.subscriptionStatus)
        check(
          ["active", "trialing", "expired", "cancelled"].includes(
            String(input.subscriptionStatus),
          ),
          "Statut invalide.",
          400,
        );
      if ("subscriptionExpiry" in input) {
        const rawExpiry = String(input.subscriptionExpiry || "").trim();
        const parsedExpiry = Date.parse(rawExpiry);
        check(
          Boolean(rawExpiry) && Number.isFinite(parsedExpiry),
          "Date d’expiration invalide.",
          400,
        );
        s.subscriptionExpiry = /^\d{4}-\d{2}-\d{2}$/.test(rawExpiry)
          ? `${rawExpiry}T23:59:59.999Z`
          : new Date(parsedExpiry).toISOString();
      }
      for (const k of ["subscriptionPlan", "subscriptionStatus"])
        if (k in input) s[k] = input[k];
    } else
      for (const k of [
        "subscriptionPlan",
        "subscriptionStatus",
        "subscriptionExpiry",
        "createdBy",
      ])
        if (k in input) check(input[k] === s[k], "Champ protégé.");
    Object.assign(s, data, { id: s.id });
    appendAudit(transactionState, actor, operation);
    return s;
  }
  if (operation === "restoreArchived") return restoreArchived(actor,args);
  if (operation === "addBuilding") {
    manager(actor);
    const s = cabinetFor(actor, str(args[0]));
    const graceDays =
      resolvePlatformBillingConfig(transactionState).publicConfig
        .commercialPolicy?.gracePeriodDays ?? 0;
    check(
      actor.role === "admin" || subscriptionCanWrite(s, graceDays),
      "Abonnement expiré.",
      402,
    );
    const plan = PLANS[s.subscriptionPlan as keyof typeof PLANS];
    check(plan, "Forfait invalide.", 400);
    check(
      getBuildingCapacity(s).canAdd,
      "Limite du forfait atteinte.",
      409,
    );
    const data = BuildingSchema.omit({ id: true }).parse({
        ...args[1],
        reserveFundRate: args[1].reserveFundRate !== undefined ? args[1].reserveFundRate
          : args[1].reserveFundPercentage !== undefined ? args[1].reserveFundPercentage : 5,
        syndicId: s.id,
      });
    if (data.bankRib && data.bankRib.trim() !== "")
      check(
        /^\d{24}$/.test(data.bankRib.replace(/\s/g, "")),
        "RIB invalide (24 chiffres requis).",
        400,
      );
    const initialLotSchema = ApartmentSchema.omit({
      id: true,
      buildingId: true,
      tantiemes: true,
    }).extend({
      tantiemes: z.number().nonnegative().optional(),
    });
    const lots = z
      .array(initialLotSchema)
      .max(500)
      .parse(args[1].apartments || []);
    check(
      lots.every((a) => !a.ownerId && !a.tenantId) &&
        new Set(lots.map((a) => a.number.trim().toLowerCase())).size ===
          lots.length,
      "Lots initiaux invalides.",
      400,
    );
    args[1] = { ...data, apartments: lots };
  } else if (
    [
      "updateBuilding",
      "deleteBuilding",
      "addApartmentsBulk",
      "rebalanceBuildingTantiemes",
      "generateMonthlyCharges",
      "approvePaymentProofsBatch",
      "reconcileBankStatementCSV",
      "addTransaction",
      "addAnnouncement",
      "setOpeningBalances",
      "closeFinancialPeriod",
      "reopenFinancialPeriod",
      "importOpeningArrears",
      "reversePayment",
      "transferFunds",
      "voidInvoice",
      "reverseExpense",
      "attachDocument",
    ].includes(operation)
  ) {
    buildingId = str(args[0]);
    b = buildingFor(actor, buildingId);
    canWrite(actor, b);
    if (operation === "updateBuilding") {
      check(
        Object.keys(object(args[1])).every((k) =>
          [
            ...Object.keys(BuildingSchema.shape).filter(
              (k) => !["id", "syndicId"].includes(k),
            ),
            "syncApartmentFees",
          ].includes(k),
        ),
        "Champ immeuble protégé.",
      );
      BuildingSchema.partial().parse(args[1]);
      if (args[1].bankRib && String(args[1].bankRib).trim() !== "")
        check(
          /^\d{24}$/.test(String(args[1].bankRib).replace(/\s/g, "")),
          "RIB invalide (24 chiffres requis).",
          400,
        );
    }
    if (operation === "deleteBuilding") return archiveBuilding(actor,b);
    if (operation === "addApartmentsBulk") {
      args[1] = z
        .array(ApartmentSchema.omit({ id: true, buildingId: true }))
        .max(500)
        .parse(args[1]);
      for (const a of args[1]) links(b, a);
      check(
        new Set(args[1].map((a: any) => String(a.number || "").trim().toLowerCase())).size ===
          args[1].length,
        "Numéros en double.",
        409,
      );
    }
    if (operation === "generateMonthlyCharges") {
      check(
        b.address?.trim() && b.city?.trim(),
        "Renseignez l’adresse et la ville avant facturation.",
        400,
      );
      check(
        b.apartments
          .filter((a: any) => !a.archivedAt)
          .every((a: any) => Number.isFinite(a.tantiemes) && a.tantiemes >= 0),
        "Tantièmes invalides.",
        400,
      );
      args[1] = b.syndicId;
      if (typeof args[2] !== "string") {
        const requestedPeriod =
          args[2] && typeof args[2] === "object" && typeof args[2].periodName === "string"
            ? args[2].periodName.trim()
            : "";
        if (args[2] && typeof args[2] === "object") args[3] = args[2];
        if (requestedPeriod) {
          args[2] = requestedPeriod;
        } else {
          const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Africa/Casablanca",
            year: "numeric",
            month: "2-digit",
          }).formatToParts(new Date());
          args[2] = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
        }
      }
    }
    if (operation === "addTransaction") {
      args[1] = TransactionSchema.parse(args[1]);
      args[1].paymentId = `journal:${operationId}`;
    }
    if (operation === "addAnnouncement")
      args[1] = {
        title: str(args[1]?.title, 200),
        content: str(args[1]?.content, 10000),
        priority: args[1]?.priority === "urgent" ? "urgent" : "normal",
        date: new Date().toISOString(),
      };
    if (
      [
        "setOpeningBalances",
        "closeFinancialPeriod",
        "reopenFinancialPeriod",
        "importOpeningArrears",
        "reversePayment",
        "transferFunds",
        "voidInvoice",
        "reverseExpense",
        "attachDocument",
      ].includes(operation)
    )
      return financialOperation(actor, operation, args, b, operationId);
  } else if (operation === "addApartment" || operation === "updateApartment") {
    const apt = ApartmentSchema.parse(args[0]);
    b = buildingFor(actor, apt.buildingId);
    buildingId = b.id;
    canWrite(actor, b);
    links(b, apt);
    if (operation === "updateApartment") {
      const existingApt = b.apartments.find(
        (a: any) => a.id === apt.id && !a.archivedAt,
      );
      check(existingApt, "Lot introuvable.", 404);
      check(
        (existingApt.ownerId || null) === (apt.ownerId || null),
        "Utilisez la procédure explicite de transfert de copropriétaire (assignApartmentOwner).",
        409,
      );
    } else delete apt.id;
    args[0] = apt;
  } else if (operation === "deleteApartment") {
    const row = nested(actor, "apartments", str(args[0]));
    const openVotingAg = (transactionState.syndik_prod_ag_v1 || []).some(
      (ag: any) =>
        ag.buildingId === row.b.id &&
        ag.isVotingOpen === true &&
        !["completed", "closed"].includes(ag.status),
    );
    check(
      !openVotingAg,
      "Impossible d'archiver ce lot : une Assemblée Générale a un scrutin ouvert.",
      409,
    );
    const pendingProof = (
      transactionState.syndik_prod_payment_proofs_v1 || []
    ).some((p: any) => {
      if (p.buildingId !== row.b.id || p.status !== "pending") return false;
      if (p.apartmentId === row.item.id) return true;
      const charge = (transactionState.syndik_prod_charges_v1 || []).find(
        (c: any) => c.id === p.chargeId,
      );
      return charge?.apartmentId === row.item.id;
    });
    check(
      !pendingProof,
      "Impossible d'archiver ce lot : un justificatif de paiement est en attente de validation.",
      409,
    );
    const affectedResidentIds = new Set<string>();
    if (row.item.ownerId) affectedResidentIds.add(row.item.ownerId);
    if (row.item.tenantId) affectedResidentIds.add(row.item.tenantId);
    row.item.archivedAt = new Date().toISOString();
    row.item.ownerId = null;
    row.item.tenantId = null;
    for (const res of row.b.residents || []) {
      if (res.apartmentId === row.item.id) {
        res.apartmentId = (row.b.apartments || []).find(
          (a: any) =>
            !a.archivedAt &&
            a.id !== row.item.id &&
            (a.ownerId === res.id || a.tenantId === res.id),
        )?.id;
        affectedResidentIds.add(res.id);
      }
    }
    for (const resId of affectedResidentIds) {
      syncResidentAccountApartment(transactionState, row.b, resId);
    }
    appendAudit(transactionState, actor, operation, row.b.id);
    return true;
  } else if (operation === "assignApartmentOwner") {
    const input = object(args[0]);
    b = buildingFor(actor, str(input.buildingId));
    canWrite(actor, b);
    const apt = b.apartments.find((a: any) => a.id === input.apartmentId && !a.archivedAt);
    check(apt, "Lot introuvable.", 404);
    check(Object.prototype.hasOwnProperty.call(input, "expectedOwnerId") &&
      (apt.ownerId || null) === input.expectedOwnerId,
      "Le propriétaire a changé. Actualisez le lot avant le transfert.", 409);
    const reason = str(input.reason).trim();
    check(reason.length >= 3 && reason.length <= 1000, "Motif du transfert requis.", 400);
    const next = input.residentId === null ? null : b.residents.find((r: any) =>
      r.id === input.residentId && r.isOwner && !r.archivedAt && r.buildingId === b.id && r.syndicId === b.syndicId);
    check(input.residentId === null || next, "Propriétaire non lié.", 400);
    const previousOwnerId = apt.ownerId || null;
    const nextOwnerId = next?.id || null;
    check(
      previousOwnerId !== nextOwnerId,
      "Ce copropriétaire est déjà titulaire de ce lot.",
      409,
    );
    apt.ownerId = nextOwnerId;
    const previous = b.residents.find((r: any) => r.id === previousOwnerId);
    if (previous && previous.apartmentId === apt.id && previousOwnerId !== apt.ownerId)
      previous.apartmentId = b.apartments.find((a: any) => !a.archivedAt && a.ownerId === previous.id)?.id;
    if (
      next &&
      (!next.apartmentId ||
        !b.apartments.some(
          (a: any) =>
            !a.archivedAt && a.id === next.apartmentId && a.ownerId === next.id,
        ))
    )
      next.apartmentId = apt.id;
    if (previous) syncResidentAccountApartment(transactionState, b, previous.id);
    if (next) syncResidentAccountApartment(transactionState, b, next.id);
    appendAudit(transactionState, actor, operation, b.id, {
      apartmentId: apt.id, previousOwnerId, ownerId: apt.ownerId, reason, operationId,
    });
    return apt;
  } else if (operation === "addResident" || operation === "updateResident") {
    const r = ResidentSchema.parse(args[0]);
    b = buildingFor(actor, r.buildingId);
    buildingId = b.id;
    canWrite(actor, b);
    r.syndicId = b.syndicId;
    r.email = r.email.toLowerCase();
    for (const field of secretFields) Reflect.deleteProperty(r, field);
    if (operation === "addResident" && r.apartmentId)
      check(
        b.apartments.some((a: any) => a.id === r.apartmentId && !a.archivedAt),
        "Lot non lié.",
        400,
      );
    if (operation === "updateResident") {
      const old = b.residents.find((x: any) => x.id === r.id);
      check(old, "Résident introuvable.", 404);
      check(r.isOwner === old.isOwner &&
        (r.apartmentId === undefined || (r.apartmentId || undefined) === old.apartmentId),
        "Utilisez une affectation explicite du lot pour modifier les associations.", 409);
      r.apartmentId = old.apartmentId;
      if (old.email.trim().toLowerCase() !== r.email && firebaseLinkedResidentIds(state).has(old.id))
        throw new OperationError(LINKED_RESIDENT_EMAIL_MESSAGE, 409, LINKED_RESIDENT_EMAIL_CODE);
      if (old.hasAccount && old.email.toLowerCase() !== r.email)
        changedCredentials = { kind: "Resident", id: r.id! };
    } else {
      const apt = b.apartments.find((a: any) => a.id === r.apartmentId);
      check(!apt || !(r.isOwner ? apt.ownerId : apt.tenantId),
        "Lot déjà occupé. Utilisez une affectation explicite du lot.", 409);
      delete r.id;
    }
    check(
      emailAvailable(r.email, "residentId", r.id),
      "Email déjà lié à un compte.",
      409,
    );
    args[0] = r;
  } else if (
    [
      "regenerateResidentCredentials",
      "recordResidentCredentialShare",
      "deleteResident",
    ].includes(operation)
  ) {
    const row = nested(actor, "residents", str(args[0]));
    b = row.b;
    buildingId = b.id;
    if (operation === "deleteResident") {
      const openVotingAg = (transactionState.syndik_prod_ag_v1 || []).some(
        (ag: any) =>
          ag.buildingId === b.id &&
          ag.isVotingOpen === true &&
          !["completed", "closed"].includes(ag.status),
      );
      check(
        !openVotingAg,
        "Impossible d'archiver ce résident : une Assemblée Générale a un scrutin ouvert.",
        409,
      );
      const pendingProof = (
        transactionState.syndik_prod_payment_proofs_v1 || []
      ).some(
        (p: any) =>
          p.buildingId === b.id &&
          p.residentId === row.item.id &&
          p.status === "pending",
      );
      check(
        !pendingProof,
        "Impossible d'archiver ce résident : un justificatif de paiement est en attente de validation.",
        409,
      );
      row.item.archivedAt = new Date().toISOString();
      row.item.hasAccount = false;
      row.item.apartmentId = undefined;
      for (const apt of b.apartments)
        for (const field of ["ownerId", "tenantId"])
          if (apt[field] === row.item.id) apt[field] = null;
      for (const item of transactionState.syndik_prod_marketplace_v1 || []) {
        if (
          item.buildingId === b.id &&
          (item.residentId === row.item.id || item.sellerId === row.item.id) &&
          item.status !== "sold"
        ) {
          item.status = "sold";
        }
      }
      syncResidentAccountApartment(transactionState, b, row.item.id);
      disableAccount(row.item.id, "residentId");
      appendAudit(transactionState, actor, operation, b.id);
      return true;
    }
    check(!row.item.archivedAt, "Résident archivé.", 409);
    if (operation === "regenerateResidentCredentials") {
      const residentEmail = String(row.item.email || "").trim().toLowerCase();
      check(Boolean(residentEmail), "Adresse email requise.", 400);
      check(
        emailAvailable(residentEmail, "residentId", row.item.id),
        "Email déjà lié à un compte.",
        409,
      );
    }
  } else if (operation === "savePrestataire") {
    const raw = object(args[0]);
    b = buildingFor(actor, str(raw.buildingId));
    buildingId = b.id;
    canWrite(actor, b);
    const cleaned = { ...raw };
    for (const field of [
      ...secretFields,
      "hasAccount",
      "rating",
      "reviews",
      "reviewsCount",
      "archivedAt",
      "completedJobsCount",
      "interventionsCount",
      "totalPaid",
    ])
      delete cleaned[field];
    const p = PrestataireSchema.parse(cleaned);
    const resolvedId =
      typeof p.id === "string" && p.id.trim()
        ? p.id.trim()
        : `prest-${randomUUID()}`;
    const old = (transactionState.syndik_prod_prestataires_v1 || []).find(
      (x: any) => x.id === resolvedId,
    );
    check(!old || old.buildingId === b.id, "Prestataire non lié.");
    check(!old?.archivedAt, "Prestataire archivé.", 409);
    const isActive = p.active !== false;
    if (!isActive) args[1] = false;
    const needsAccount = Boolean(args[1] || (old?.hasAccount && isActive));
    const email = String(p.email || "").trim().toLowerCase();
    p.email = needsAccount || email ? z.string().email().parse(email) : "";
    if (p.email && isActive)
      check(
        emailAvailable(String(p.email), "prestataireId", resolvedId),
        "Email déjà lié.",
        409,
      );
    if (old?.hasAccount && isActive && old.email.toLowerCase() !== p.email)
      changedCredentials = { kind: "Prestataire", id: resolvedId };
    args[0] = { ...p, id: resolvedId, active: isActive, syndicId: b.syndicId };
  } else if (
    [
      "regeneratePrestataireCredentials",
      "recordPrestataireCredentialShare",
      "deletePrestataire",
      "addPrestataireReview",
    ].includes(operation)
  ) {
    const row = record(
      actor,
      "syndik_prod_prestataires_v1",
      str(args[0]),
      operation !== "addPrestataireReview",
    );
    b = row.b;
    buildingId = b.id;
    if (operation === "deletePrestataire") {
      row.item.archivedAt = new Date().toISOString();
      row.item.active = false;
      for (const req of transactionState.syndik_prod_maintenance_v1 || []) {
        if (
          req.buildingId === b.id &&
          req.status !== "completed" &&
          (req.prestataireId === row.item.id || req.assignedTo === row.item.id)
        ) {
          req.prestataireId = "";
          req.assignedTo = "";
          req.completionPending = false;
          (req.updates ??= []).push({
            id: randomUUID(),
            status: req.status,
            title: "Prestataire désaffecté",
            note: `Le prestataire ${row.item.name} a été archivé et désaffecté de cette intervention.`,
            updatedBy: actorDisplayName(actor, b),
            updatedByRole: actor.role === "admin" ? "syndic" : actor.role,
            timestamp: new Date().toISOString(),
          });
        }
      }
      disableAccount(row.item.id, "prestataireId");
      appendAudit(transactionState, actor, operation, b.id);
      return true;
    }
    if (
      operation === "regeneratePrestataireCredentials" ||
      operation === "recordPrestataireCredentialShare"
    ) {
      check(!row.item.archivedAt, "Prestataire archivé.", 409);
      check(row.item.active !== false, "Prestataire inactif.", 409);
      if (operation === "regeneratePrestataireCredentials") {
        const slug =
          String(row.item.name || "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .slice(0, 12) || "prestataire";
        const targetEmail =
          String(row.item.email || "").trim().toLowerCase() ||
          `contact@${slug}.ma`;
        check(
          emailAvailable(targetEmail, "prestataireId", row.item.id),
          "Email déjà lié.",
          409,
        );
      }
    }
    if (operation === "addPrestataireReview") {
      check(actor.role === "resident", "Avis réservé aux résidents.");
      check(
        !row.item.archivedAt && row.item.active !== false,
        "Impossible d'évaluer un prestataire archivé ou inactif.",
        409,
      );
      const reviewerId = actorIdentity(actor);
      check(
        !(row.item.reviews || []).some((rev: any) => rev.residentId === reviewerId),
        "Vous avez déjà publié un avis pour ce prestataire.",
        409,
      );
      const rawReview = pick(args[1], ["rating", "comment"]);
      const rating = Number(rawReview.rating);
      check(
        Number.isInteger(rating) && rating >= 1 && rating <= 5,
        "Note invalide (entier de 1 à 5 requis).",
        400,
      );
      const comment =
        typeof rawReview.comment === "string" ? rawReview.comment.trim() : "";
      check(comment.length <= 2000, "Commentaire trop long.", 400);
      const reviewerName = actorDisplayName(actor, b);
      const reviewerApt = residentApartmentLabel(b, reviewerId);
      args[1] = {
        rating,
        comment,
        residentId: reviewerId,
        residentName: reviewerName,
        apartmentNumber: reviewerApt,
        authorName: reviewerName,
        authorRole: "resident",
        date: new Date().toISOString(),
      };
    }
  } else if (operation === "submitPaymentProof") {
    const proof = object(args[0]),
      row = record(actor, "syndik_prod_charges_v1", str(proof.chargeId), false),
      charge = row.item;
    b = row.b;
    buildingId = b.id;
    check(
      ["admin", "syndic", "resident"].includes(actor.role),
      "Rôle interdit.",
    );
    if (actor.role === "resident") {
      check(charge.residentId === actorIdentity(actor), "Charge non liée.");
      const rawUrl = String(proof.receiptUrl || "");
      check(rawUrl.startsWith("/api/uploads/"), "Justificatif non lié.");
      const meta = transactionState.__files?.[rawUrl.slice("/api/uploads/".length)];
      check(
        meta?.uploadedBy === actor.uid && meta.buildingId === b.id,
        "Justificatif non lié.",
      );
    } else if (proof.receiptUrl !== undefined && proof.receiptUrl !== "") {
      const rawUrl = String(proof.receiptUrl);
      check(rawUrl.startsWith("/api/uploads/"), "Justificatif non lié.", 400);
      const meta = transactionState.__files?.[rawUrl.slice("/api/uploads/".length)];
      check(meta?.buildingId === b.id, "Justificatif non lié à cet immeuble.");
    }
    const pendingProofsCents = (
      transactionState.syndik_prod_proofs_v1 || []
    )
      .filter(
        (p: any) =>
          p.chargeId === charge.id &&
          p.buildingId === b.id &&
          p.status === "pending",
      )
      .reduce((sum: number, p: any) => sum + cents(p.amount), 0);
    const availableCents =
      cents(charge.amount) - cents(charge.paidAmount || 0) - pendingProofsCents;
    check(
      cents(proof.amount) > 0 && cents(proof.amount) <= availableCents,
      pendingProofsCents > 0
        ? "Montant supérieur au solde disponible (des justificatifs sont déjà en attente de validation)."
        : "Montant supérieur au solde.",
      400,
    );
    const resident = b.residents.find((r: any) => r.id === charge.residentId),
      apartment = b.apartments.find((a: any) => a.id === charge.apartmentId);
    check(resident && apartment, "Résident ou lot non lié à la charge.", 400);
    args[0] = {
      ...pick(proof, [
        "amount",
        "bankTransactionDate",
        "receiptUrl",
        "referenceNumber",
        "bankName",
        "paymentMethod",
        "receiptNote",
      ]),
      bankTransactionDate: proof.bankTransactionDate ?? proof.date,
      chargeId: charge.id,
      buildingId: b.id,
      syndicId: b.syndicId,
      residentId: charge.residentId,
      residentName: resident.name,
      apartmentId: apartment.id,
      apartmentNumber: apartment.number,
      status: "pending",
      submittedAt: new Date().toISOString(),
    };
  } else if (operation === "reviewPaymentProof") {
    const row = record(actor, "syndik_prod_proofs_v1", str(args[0]));
    b = row.b;
    buildingId = b.id;
    check(
      ["approved", "rejected"].includes(args[1]),
      "Décision invalide.",
      400,
    );
  } else if (operation === "createQuittance") {
    b = buildingFor(actor, str(args[0]?.buildingId));
    buildingId = b.id;
    canWrite(actor, b);
    if (args[0].addTransactionToLedger !== undefined) z.boolean().parse(args[0].addTransactionToLedger);
    if (args[0].paymentId !== undefined) z.string().trim().min(1).max(3000).parse(args[0].paymentId);
    args[0] = {
      ...args[0],
      syndicId: b.syndicId,
      paymentId:
        args[0].paymentId ||
        (args[0].addTransactionToLedger === false ||
        String(args[0].referenceNumber || "").trim()
          ? undefined
          : operationId),
    };
  } else if (operation === "generateQuittanceForCharge") {
    const row = record(
      actor,
      "syndik_prod_charges_v1",
      typeof args[0] === "string" ? args[0] : args[0]?.id,
    );
    b = row.b;
    buildingId = b.id;
    args[0] = row.item.id;
  } else if (operation === "createInvoiceForResident") {
    b = buildingFor(actor, str(args[1]));
    buildingId = b.id;
    canWrite(actor, b);
    check(
      b.residents.some((r: any) => !r.archivedAt && r.id === args[0]),
      "Résident non lié.",
      400,
    );
    args[2] = b.syndicId;
  } else if (operation === "recordPayment") {
    const row = record(actor, "syndik_prod_invoices_v1", str(args[0]?.id));
    b = row.b;
    buildingId = b.id;
    args[0] = row.item;
    args[3] ||= operationId;
    check(cents(args[1]) > 0, "Montant invalide.", 400);
    check(
      !b.financials?.transactions.some((t: any) => t.reversalOf === args[3]),
      "Paiement contrepassé.",
      409,
    );
  } else if (
    [
      "createAssembleeGenerale",
      "saveAssembleeGenerale",
      "toggleAGVoting",
      "recordAGVote",
      "updateAGAttendee",
      "generateChargesFromAGResolution",
    ].includes(operation)
  )
    return meetingOperation(actor, operation, args);
  else if (operation === "addMaintenanceRequest") {
    const input = object(args[0]);
    b = buildingFor(actor, str(input.buildingId), false);
    buildingId = b.id;
    canWrite(actor, b);
    check(actor.role !== "provider", "Rôle interdit.");
    validateAttachments(actor, b, input);
    const id = actor.role === "resident" ? actorIdentity(actor) : actor.uid;
    const category =
      input.category !== undefined && String(input.category).trim() !== ""
        ? z.enum(ALLOWED_MAINTENANCE_CATEGORIES).parse(input.category)
        : "other";
    const priority =
      input.priority !== undefined && String(input.priority).trim() !== ""
        ? z.enum(ALLOWED_MAINTENANCE_PRIORITIES).parse(input.priority)
        : "medium";
    const title =
      input.title !== undefined && String(input.title).trim() !== ""
        ? z.string().trim().min(1).max(200).parse(input.title)
        : undefined;
    const description = z.string().trim().min(1).max(5000).parse(input.description);
    const location =
      input.location !== undefined && String(input.location).trim() !== ""
        ? z.string().trim().max(200).parse(input.location)
        : undefined;
    const photoUrl = validateMediaUrl(input.photoUrl);
    const photos = validateMediaUrls(input.photos);

    let apartmentId: string | undefined;
    let apartmentNumber: string | undefined;
    const rawAptId =
      typeof input.apartmentId === "string" ? input.apartmentId.trim() : "";
    const rawAptNum =
      typeof input.apartmentNumber === "string"
        ? input.apartmentNumber.trim()
        : "";
    if (
      rawAptId === "common" ||
      /^(parties\s*communes|common|common_area|المناطق\s*المشتركة)$/i.test(rawAptNum)
    ) {
      apartmentId = "common";
      apartmentNumber = "Parties Communes";
    } else if (rawAptId) {
      const apt = (b.apartments || []).find(
        (a: any) => !a.archivedAt && a.id === rawAptId,
      );
      check(apt, "Lot introuvable dans cet immeuble.", 400);
      if (actor.role === "resident") {
        check(
          apt.ownerId === id || apt.tenantId === id,
          "Vous ne pouvez signaler que pour vos propres lots ou les parties communes.",
          403,
        );
      }
      apartmentId = apt.id;
      apartmentNumber = `Lot ${String(apt.number).replace(/^(Lot|شقة)\s+/i, "").trim()}`;
    } else if (actor.role === "resident") {
      const apts = (b.apartments || []).filter((a: any) => !a.archivedAt);
      const res = (b.residents || []).find((r: any) => !r.archivedAt && r.id === id);
      const linked =
        (res?.apartmentId &&
          apts.find(
            (a: any) =>
              a.id === res.apartmentId &&
              (a.ownerId === id || a.tenantId === id),
          )) ||
        apts.find((a: any) => a.ownerId === id || a.tenantId === id);
      if (linked) {
        apartmentId = linked.id;
        apartmentNumber = `Lot ${String(linked.number).replace(/^(Lot|شقة)\s+/i, "").trim()}`;
      }
    } else if (rawAptNum) {
      apartmentNumber = rawAptNum.slice(0, 80);
    }

    args[0] = {
      ...(title ? { title } : {}),
      description,
      category,
      priority,
      ...(location ? { location } : {}),
      ...(photoUrl ? { photoUrl } : {}),
      ...(photos ? { photos } : {}),
      ...(apartmentId ? { apartmentId } : {}),
      ...(apartmentNumber ? { apartmentNumber } : {}),
      residentId: id,
      residentName: actorDisplayName(actor, b),
      buildingId: b.id,
      syndicId: b.syndicId,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
  } else if (
    [
      "updateMaintenanceRequest",
      "confirmMaintenanceCompletion",
      "reopenMaintenance",
    ].includes(operation)
  ) {
    const row = record(
        actor,
        "syndik_prod_maintenance_v1",
        str(args[0]),
        false,
      ),
      request = row.item;
    b = row.b;
    buildingId = b.id;
    if (actor.role === "resident")
      check(
        request.residentId === actorIdentity(actor),
        "Signalement non lié.",
      );
    if (actor.role === "provider")
      check(
        [request.prestataireId, request.assignedTo].includes(
          actorIdentity(actor),
        ),
        "Intervention non affectée.",
      );
    validateAttachments(actor, b, [args[1], args[2]], request);
    const displayActor = actorDisplayName(actor, b);
    const stepRole = actor.role === "admin" ? "syndic" : actor.role;
    if (operation !== "updateMaintenanceRequest") {
      check(
        actor.role !== "provider",
        "Validation réservée au demandeur ou syndic.",
      );
      if (operation === "confirmMaintenanceCompletion") {
        check(
          request.completionPending,
          "Aucune intervention à valider.",
          409,
        );
      } else {
        check(
          request.status === "completed",
          "Seule une intervention clôturée peut être réouverte.",
          409,
        );
      }
      request.completionPending = false;
      request.status =
        operation === "confirmMaintenanceCompletion" ? "completed" : "pending";
      request.completedAt =
        request.status === "completed" ? new Date().toISOString() : undefined;
      (request.updates ??= []).push({
        id: randomUUID(),
        title:
          operation === "confirmMaintenanceCompletion"
            ? "Intervention validée"
            : "Intervention réouverte",
        note: str(args[1]),
        status: request.status,
        updatedBy: displayActor,
        updatedByRole: stepRole,
        timestamp: new Date().toISOString(),
      });
      const label = request.title || "Intervention";
      if (actor.role === "resident") {
        notifyCabinetSyndics(
          b,
          operation === "confirmMaintenanceCompletion"
            ? "Intervention validée par le résident"
            : "Intervention réouverte par le résident",
          `${displayActor} : ${label}`,
          "maintenance",
          "/maintenance",
        );
      } else {
        notice(
          request.residentId,
          b,
          "Suivi intervention",
          `${label} : ${maintenanceStatusFr(request.status, false)}`,
          "maintenance",
          "/maintenance",
        );
      }
      appendAudit(transactionState, actor, operation, b.id);
      return request;
    }
    const isManager = ["admin", "syndic"].includes(actor.role);
    if (!isManager) {
      check(
        request.status !== "completed",
        "Intervention clôturée : modification non autorisée.",
        409,
      );
    }
    const fields =
      actor.role === "resident"
        ? ["description", "photos", "photoUrl"]
        : actor.role === "provider"
          ? ["status", "photos", "photoUrl", "estimatedCompletionDate"]
          : [
              "description",
              "status",
              "priority",
              "assignedTo",
              "prestataireId",
              "estimatedCompletionDate",
              "cost",
              "invoiceRef",
              "photos",
              "photoUrl",
              "syndicNotes",
            ];
    check(
      Object.keys(object(args[1])).every((k) => fields.includes(k)),
      "Champ de suivi protégé.",
    );
    if ("priority" in args[1] && args[1].priority !== undefined) {
      args[1].priority = z.enum(ALLOWED_MAINTENANCE_PRIORITIES).parse(args[1].priority);
    }
    if ("photoUrl" in args[1] && args[1].photoUrl !== undefined && args[1].photoUrl !== null && args[1].photoUrl !== "") {
      args[1].photoUrl = validateMediaUrl(args[1].photoUrl);
    }
    if ("photos" in args[1] && args[1].photos !== undefined) {
      args[1].photos = validateMediaUrls(args[1].photos) || [];
    }
    if (args[2]?.stepPhotos !== undefined) {
      args[2] = { ...args[2], stepPhotos: validateMediaUrls(args[2].stepPhotos) };
    }
    if ("prestataireId" in args[1] || "assignedTo" in args[1]) {
      const id = args[1].prestataireId ?? args[1].assignedTo ?? "";
      check(
        !args[1].prestataireId ||
          !args[1].assignedTo ||
          args[1].prestataireId === args[1].assignedTo,
        "Sélectionnez un seul prestataire.",
        400,
      );
      if (id)
        check(
          (transactionState.syndik_prod_prestataires_v1 || []).some(
            (p: any) =>
              p.id === id &&
              p.buildingId === b.id &&
              !p.archivedAt &&
              p.active !== false,
          ),
          "Sélectionnez un prestataire actif de cet immeuble.",
          400,
        );
      args[1].prestataireId = id;
      args[1].assignedTo = id;
    }
    if (args[1].status) {
      check(
        ["pending", "in_progress", "completed"].includes(args[1].status),
        "Statut invalide.",
        400,
      );
      if (actor.role === "provider") {
        check(
          !(request.status === "in_progress" && args[1].status === "pending"),
          "Transition de statut non autorisée pour un prestataire.",
          409,
        );
      }
    }
    if ("cost" in args[1]) {
      if (args[1].cost === null || args[1].cost === "") {
        args[1].cost = null;
      } else if (args[1].cost !== undefined) {
        check(cents(args[1].cost) >= 0, "Coût invalide.", 400);
      }
    }
    if ("invoiceRef" in args[1]) {
      if (args[1].invoiceRef === null || String(args[1].invoiceRef).trim() === "") {
        args[1].invoiceRef = "";
      } else {
        args[1].invoiceRef = z.string().trim().max(120).parse(args[1].invoiceRef);
      }
    }
    if ("syndicNotes" in args[1]) {
      if (args[1].syndicNotes === null || String(args[1].syndicNotes).trim() === "") {
        args[1].syndicNotes = "";
      } else {
        args[1].syndicNotes = z.string().trim().max(2000).parse(args[1].syndicNotes);
      }
    }
    if (actor.role === "provider" && args[1].status === "completed") {
      request.completionPending = true;
      args[1].status = "in_progress";
    } else if (args[1].status) {
      if (["completed", "pending"].includes(args[1].status)) {
        request.completionPending = false;
      }
      request.completedAt =
        args[1].status === "completed" ? new Date().toISOString() : undefined;
    }
    args[2] = {
      ...pick(args[2] || {}, ["title", "note", "stepPhotos"]),
      updatedBy: displayActor,
      updatedByRole: stepRole,
    };
  } else if (operation === "deleteDocument") {
    const row = nested(actor, "documents", str(args[0]?.id));
    b = row.b;
    buildingId = b.id;
    args[0] = row.item;
  } else if (operation === "markNotificationAsRead") {
    const notifId = str(args[0]);
    const notif = (transactionState.syndik_prod_notifications_v1 || []).find(
      (n: any) => n.id === notifId,
    );
    check(notif, "Notification introuvable.", 404);
    if (notif.userId === "all") {
      check(notif.buildingId, "Notification non liée.");
      buildingFor(actor, notif.buildingId, false);
      const readBy: string[] = Array.isArray(notif.readBy) ? notif.readBy : [];
      if (!readBy.includes(actor.uid)) readBy.push(actor.uid);
      notif.readBy = readBy;
      appendAudit(transactionState, actor, operation, notif.buildingId, {
        notificationId: notif.id,
      });
      return true;
    }
    check(notif.userId === actor.uid, "Notification non liée.");
    notif.read = true;
    appendAudit(transactionState, actor, operation, notif.buildingId, {
      notificationId: notif.id,
    });
    return true;
  } else if (operation === "markAllNotificationsAsRead") {
    let updated = 0;
    const accessibleBuildings = new Set<string>();
    for (const s of cabinets()) {
      for (const bld of s.buildings || []) {
        try {
          buildingFor(actor, bld.id, false);
          accessibleBuildings.add(bld.id);
        } catch {
          // Not accessible to caller
        }
      }
    }
    for (const n of transactionState.syndik_prod_notifications_v1 || []) {
      if (n.userId === actor.uid) {
        if (!n.read) {
          n.read = true;
          updated++;
        }
      } else if (n.userId === "all" && n.buildingId && accessibleBuildings.has(n.buildingId)) {
        const readBy: string[] = Array.isArray(n.readBy) ? n.readBy : [];
        if (!readBy.includes(actor.uid)) {
          readBy.push(actor.uid);
          n.readBy = readBy;
          updated++;
        }
      }
    }
    appendAudit(transactionState, actor, operation, undefined, { updated });
    return { updated };
  } else if (operation === "sendChatMessage") {
    const m = object(args[0]);
    b = buildingFor(actor, str(m.buildingId), false);
    buildingId = b.id;
    canWrite(actor, b);
    check(actor.role !== "provider", "Rôle interdit.");
    validateAttachments(actor, b, m);
    const id = actorIdentity(actor);
    const syndicUids = cabinetSyndicUids(b);
    const isManager = ["admin", "syndic"].includes(actor.role);
    const peer = typeof m.recipientId === "string" && m.recipientId.trim() ? m.recipientId.trim() : undefined;
    const peerIsSyndic = Boolean(peer && (peer === b.syndicId || syndicUids.has(peer)));
    const peerIsResident = Boolean(
      peer && b.residents.some((r: any) => r.id === peer && !r.archivedAt),
    );
    check(!peer || peerIsSyndic || peerIsResident, "Destinataire non lié.");
    check(
      !peer || (peer !== id && !(isManager && peerIsSyndic)),
      "Vous ne pouvez pas vous envoyer un message à vous-même.",
      400,
    );
    const attachmentUrl = validateMediaUrl(m.attachmentUrl);
    const attachmentName =
      typeof m.attachmentName === "string" && m.attachmentName.trim()
        ? m.attachmentName.trim().slice(0, 200)
        : undefined;
    const badge =
      typeof m.badge === "string" && m.badge.trim()
        ? m.badge.trim().slice(0, 40)
        : undefined;
    let channelId = str(m.channelId, 200).trim();
    let marketplaceMeta: Record<string, any> = {};
    if (m.marketplaceItemId) {
      const item = (transactionState.syndik_prod_marketplace_v1 || []).find(
        (x: any) => x.id === m.marketplaceItemId && x.buildingId === b.id,
      );
      check(item, "Annonce introuvable.", 404);
      check(
        item.status !== "sold",
        "Cette annonce est déjà vendue : impossible d'envoyer un message.",
        409,
      );
      const itemOwnerIsSyndic =
        item.residentId === b.syndicId || syndicUids.has(item.residentId);
      const senderIsOwner =
        item.residentId === id || (isManager && itemOwnerIsSyndic);
      const peerIsOwner =
        Boolean(peer) &&
        (item.residentId === peer || (peerIsSyndic && itemOwnerIsSyndic));
      check(
        Boolean(peer) && (senderIsOwner || peerIsOwner),
        "Conversation non liée.",
      );
      const canonicalSelf = isManager ? b.syndicId : id;
      const canonicalPeer = peerIsSyndic ? b.syndicId : peer!;
      channelId = `market-${item.id}:${[canonicalSelf, canonicalPeer].sort().join(":")}`;
      marketplaceMeta = {
        marketplaceItemId: item.id,
        marketplaceItemTitle: item.title,
        marketplaceItemPrice: item.price,
        ...(item.imageUrl || item.images?.[0]
          ? { marketplaceItemImage: item.imageUrl || item.images[0] }
          : {}),
      };
    } else {
      check(!channelId.startsWith("market-"), "Conversation non liée.");
      const allowedChannels = peer
        ? [...ALLOWED_PUBLIC_CHAT_CHANNELS, "private"]
        : [...ALLOWED_PUBLIC_CHAT_CHANNELS];
      check(
        allowedChannels.includes(channelId as any),
        "Canal de discussion invalide.",
        400,
      );
    }
    const senderApt =
      actor.role === "resident" ? residentApartmentLabel(b, id) : undefined;
    const recipientName = peer
      ? peerIsSyndic
        ? cabinets().find((s: any) => s.id === b.syndicId)?.name || "Syndic"
        : b.residents.find((r: any) => r.id === peer)?.name
      : undefined;
    args[0] = {
      ...(peer ? { recipientId: peerIsSyndic ? b.syndicId : peer } : {}),
      ...(recipientName ? { recipientName } : {}),
      ...marketplaceMeta,
      ...(attachmentUrl ? { attachmentUrl } : {}),
      ...(attachmentName ? { attachmentName } : {}),
      ...(badge ? { badge } : {}),
      ...(senderApt ? { senderApartment: senderApt, apartmentNumber: senderApt } : {}),
      buildingId: b.id,
      channelId,
      content: z.string().trim().min(1).max(3000).parse(m.content),
      senderId: id,
      senderName: actorDisplayName(actor, b),
      senderRole: actor.role === "admin" ? "syndic" : actor.role,
    };
  } else if (operation === "toggleChatMessageLike") {
    check(actor.role !== "provider", "Rôle interdit.");
    const row = record(actor, "syndik_prod_chat_v1", str(args[0]), false);
    b = row.b;
    buildingId = b.id;
    const id = actorIdentity(actor);
    const syndicUids = cabinetSyndicUids(b);
    const isManagerParticipant =
      ["admin", "syndic"].includes(actor.role) &&
      [row.item.senderId, row.item.recipientId].some(
        (p) => p === b.syndicId || syndicUids.has(p),
      );
    check(
      !row.item.recipientId ||
        [row.item.senderId, row.item.recipientId].includes(id) ||
        isManagerParticipant,
      "Conversation privée.",
    );
    args[1] = id;
  } else if (operation === "deleteChatMessage") {
    check(actor.role !== "provider", "Rôle interdit.");
    const row = record(actor, "syndik_prod_chat_v1", str(args[0]), false);
    b = row.b;
    buildingId = b.id;
    const id = actorIdentity(actor);
    const isManager = ["admin", "syndic"].includes(actor.role);
    check(
      isManager || row.item.senderId === id,
      "Suppression réservée à l'auteur ou au syndic.",
    );
    transactionState.syndik_prod_chat_v1 = (
      transactionState.syndik_prod_chat_v1 || []
    ).filter((m: any) => m.id !== row.item.id);
    appendAudit(transactionState, actor, operation, b.id, {
      messageId: row.item.id,
    });
    return true;
  } else if (operation === "addMarketplaceItem") {
    const input = object(args[0]);
    b = buildingFor(actor, str(input.buildingId), false);
    buildingId = b.id;
    canWrite(actor, b);
    check(actor.role !== "provider", "Rôle interdit.");
    validateAttachments(actor, b, input);
    const id = actorIdentity(actor);
    const rawCat =
      input.category !== undefined && String(input.category).trim() !== ""
        ? String(input.category).trim().toLowerCase()
        : "autre";
    const category = MARKETPLACE_CATEGORY_MAP[rawCat];
    check(Boolean(category), "Catégorie d'annonce invalide.", 400);
    const rawType =
      input.type !== undefined && String(input.type).trim() !== ""
        ? String(input.type).trim().toLowerCase()
        : input.isFree
          ? "free"
          : "sale";
    const type = z.enum(["sale", "free", "service"]).parse(rawType);
    const rawCond =
      input.condition !== undefined && String(input.condition).trim() !== ""
        ? String(input.condition).trim().toLowerCase()
        : "bon_etat";
    const condition = MARKETPLACE_CONDITION_MAP[rawCond];
    check(Boolean(condition), "État d'objet invalide.", 400);
    const isFree = type === "free" || Boolean(input.isFree);
    const numericPrice = isFree ? 0 : cents(input.price) / 100;
    check(numericPrice >= 0, "Prix invalide.", 400);
    const imageUrl = validateMediaUrl(input.imageUrl);
    const images = validateMediaUrls(input.images);
    const sellerDisplay = actorDisplayName(actor, b);
    const aptLabel =
      actor.role === "resident"
        ? residentApartmentLabel(b, id) || ""
        : "Bureau Syndic";
    args[0] = {
      category,
      type,
      condition,
      isFree,
      ...(imageUrl ? { imageUrl } : {}),
      ...(images ? { images } : {}),
      ...(typeof input.phone === "string" && input.phone.trim()
        ? { phone: input.phone.trim().slice(0, 40) }
        : {}),
      ...(typeof input.whatsapp === "string" && input.whatsapp.trim()
        ? { whatsapp: input.whatsapp.trim().slice(0, 40) }
        : {}),
      title: z.string().trim().min(2).max(200).parse(input.title),
      description: z.string().trim().min(1).max(5000).parse(input.description),
      price: numericPrice,
      buildingId: b.id,
      residentId: id,
      sellerId: id,
      residentName: sellerDisplay,
      sellerName: sellerDisplay,
      apartmentNumber: aptLabel,
      status: "available",
    };
  } else if (
    ["deleteMarketplaceItem", "updateMarketplaceItemStatus"].includes(operation)
  ) {
    const row = record(
      actor,
      "syndik_prod_marketplace_v1",
      str(args[0]),
      false,
    );
    b = row.b;
    buildingId = b.id;
    check(
      ["admin", "syndic"].includes(actor.role) ||
        row.item.residentId === actorIdentity(actor),
      "Annonce non liée.",
    );
    if (operation === "updateMarketplaceItemStatus")
      check(
        ["available", "reserved", "sold"].includes(args[1]),
        "Statut invalide.",
        400,
      );
  } else throw new OperationError("Opération inconnue.", 400);

  if (
    b &&
    [
      "recordPayment",
      "createQuittance",
      "addTransaction",
      "reviewPaymentProof",
      "approvePaymentProofsBatch",
      "reconcileBankStatementCSV",
    ].includes(operation)
  ) {
    check(
      b.financials?.openingBalancesRecordedAt,
      "Confirmez les soldes initiaux dans les outils financiers.",
      409,
    );
    const method =
      operation === "recordPayment"
        ? args[2]
        : operation === "createQuittance"
          ? args[0].paymentMethod
          : operation === "addTransaction"
            ? args[1].paymentMethod
            : undefined;
    if (method)
      check(
        ["virement", "versement", "versement_especes", "cheque", "especes"].includes(method),
        "Mode de paiement indisponible.",
        400,
      );
  }
  if (
    b &&
    [
      "recordPayment",
      "createQuittance",
      "addTransaction",
      "reviewPaymentProof",
      "approvePaymentProofsBatch",
      "reconcileBankStatementCSV",
    ].includes(operation)
  )
    if (
      !["reviewPaymentProof", "approvePaymentProofsBatch", "reconcileBankStatementCSV"].includes(operation) &&
      !(operation === "createQuittance" && args[0]?.addTransactionToLedger === false)
    )
      assertPeriod(
        b,
        operation === "createQuittance"
          ? (args[0].postingDate ?? args[0].paymentDate)
          : operation === "recordPayment"
            ? (args[4]?.postingDate ?? args[4]?.bankTransactionDate ?? new Date().toISOString())
            : operation === "addTransaction"
              ? args[1].date
              : new Date().toISOString(),
      );
  const oldJournalIds = new Set(
    (b?.financials?.transactions || []).map((t: any) => t.id),
  );
  if (
    b &&
    operation === "generateMonthlyCharges" &&
    typeof args[2] === "string"
  )
    assertPeriod(b, normalizeBillingPeriodKey(args[2]) + "-01");
  const oldInvoices = new Set(
    (transactionState.syndik_prod_invoices_v1 || []).map((i: any) => i.id),
  );
  let result: any;
  try {
    result = await dispatch(actor, operation, args, {cabinetId:b?.syndicId,buildingId:b?.id});
  } catch (e: any) {
    throw new OperationError(
      e.message,
      e instanceof OperationError ? e.status : 400,
      e instanceof OperationError ? e.code : undefined,
    );
  }
  if (operation === "reconcileBankStatementCSV" && args[2]?.preview === true) return result;
  if (operation === "deleteDocument") {
    const docUrl = String(args[0]?.url || "");
    if (docUrl.startsWith("/api/uploads/")) {
      const fileId = docUrl.slice("/api/uploads/".length);
      const meta = transactionState.__files?.[fileId];
      if (meta && !fileIsReferenced(transactionState, { id: fileId, key: meta.key })) {
        meta.deletedAt = new Date().toISOString();
      }
    }
  }
  if (operation === "savePrestataire") {
    const prestId = result?.id || args[0]?.id;
    if (args[0]?.active === false && prestId) {
      disableAccount(prestId, "prestataireId");
    } else if (args[0]?.active !== false && prestId) {
      const prestEmail = String(result?.email || args[0]?.email || "").trim().toLowerCase();
      if (!prestEmail || emailAvailable(prestEmail, "prestataireId", prestId)) {
        for (const key of [
          "syndik_prod_registered_users_v1",
          "syndik_prod_prestataire_accounts_v1",
        ]) {
          for (const a of transactionState[key] || []) {
            if (a.prestataireId === prestId || a.profile?.prestataireId === prestId) {
              delete a.disabled;
            }
          }
        }
      }
    }
  }
  if (
    b &&
    [
      "recordPayment",
      "createQuittance",
      "reviewPaymentProof",
      "approvePaymentProofsBatch",
      "reconcileBankStatementCSV",
      "addTransaction",
    ].includes(operation)
  ) {
    const updated = buildingFor(actor, b.id);
    for (const entry of updated.financials?.transactions || [])
      if (!oldJournalIds.has(entry.id)) assertPeriod(updated, entry.date);
  }
  if (changedCredentials) {
    result = await dispatch(actor,
      `regenerate${changedCredentials.kind}Credentials`,
      [changedCredentials.id],
    );
    revoke(changedCredentials.id);
  }
  if (operation === "generateMonthlyCharges" && Array.isArray(result))
    await issueChargeInvoices(actor, b, result);
  for (const invoice of transactionState.syndik_prod_invoices_v1 || [])
    if (operation !== "generateMonthlyCharges" && !oldInvoices.has(invoice.id))
      notice(
        invoice.residentId,
        b,
        "Nouvel avis de charges",
        `${invoice.invoiceNumber} : ${invoice.totalAmount} MAD`,
        "invoice",
        "/financials",
      );
  if (operation === "submitPaymentProof" && actor.role === "resident") {
    notifyCabinetSyndics(
      b,
      "Nouveau justificatif de paiement",
      `${args[0].residentName} (${args[0].apartmentNumber}) : ${args[0].amount} MAD`,
      "invoice",
      "/financials",
    );
  }
  if (operation === "addAnnouncement")
    for (const r of b.residents.filter((r: any) => !r.archivedAt))
      notice(
        r.id,
        b,
        args[1].priority === "urgent" ? "Annonce urgente" : "Nouvelle annonce",
        args[1].title,
        "announcement",
        "/announcements",
      );
  if (operation === "addMaintenanceRequest" && actor.role === "resident") {
    notifyCabinetSyndics(
      b,
      "Nouveau signalement",
      `${args[0].residentName} : ${args[0].title || args[0].description.slice(0, 80)}`,
      "maintenance",
      "/maintenance",
    );
  }
  if (operation === "updateMaintenanceRequest") {
    const item = (transactionState.syndik_prod_maintenance_v1 || []).find(
      (x: any) => x.id === args[0],
    );
    if (item) {
      const statusText = maintenanceStatusFr(item.status, item.completionPending);
      if (actor.role === "resident") {
        notifyCabinetSyndics(
          b,
          "Mise à jour d'un signalement",
          `${actorDisplayName(actor, b)} a mis à jour : ${item.title || "Intervention"}`,
          "maintenance",
          "/maintenance",
        );
      } else {
        const isBuildingResident = (b.residents || []).some(
          (r: any) => !r.archivedAt && r.id === item.residentId,
        );
        if (isBuildingResident) {
          notice(
            item.residentId,
            b,
            "Suivi intervention",
            statusText,
            "maintenance",
            "/maintenance",
          );
        } else if (actor.role === "provider") {
          notifyCabinetSyndics(
            b,
            "Suivi intervention prestataire",
            `${item.title || "Intervention"} : ${statusText}`,
            "maintenance",
            "/maintenance",
          );
        }
      }
    }
  }
  if (
    [
      "regenerateResidentCredentials",
      "regeneratePrestataireCredentials",
    ].includes(operation) ||
    (operation === "savePrestataire" && args[1])
  )
    revoke(result?.id || args[0]);
  appendAudit(transactionState, actor, operation, buildingId, { operationId });
  return result;
}
async function issueChargeInvoices(actor: Actor, b: any, charges: any[]) {
  const before = new Set((transactionState.syndik_prod_invoices_v1 || []).map((i: any) => i.id));
  for (const residentId of new Set(charges.filter(c => c.amount > 0 && !c.invoiceId &&
      c.syndicId === b.syndicId && c.buildingId === b.id && (c.paidAmount || 0) < c.amount).map(c => c.residentId))) {
    await dispatch(actor, "createInvoiceForResident", [residentId, b.id, b.syndicId], { cabinetId: b.syndicId, buildingId: b.id });
  }
  for (const invoice of transactionState.syndik_prod_invoices_v1 || [])
    if (!before.has(invoice.id)) notice(invoice.residentId, b, "Nouvel avis de charges",
      `${invoice.invoiceNumber} : ${invoice.totalAmount} MAD`, "invoice");
}

function emailAvailable(email: string, field?: string, id?: string) {
  const state = transactionState;
  return [
    "syndik_prod_registered_users_v1",
    "syndik_prod_resident_accounts_v1",
    "syndik_prod_prestataire_accounts_v1",
  ].every((key) =>
    (state[key] || []).every(
      (u: any) =>
        Boolean(u.disabled) ||
        u.email?.toLowerCase() !== email.toLowerCase() ||
        Boolean(id && field && (u[field] === id || u.profile?.[field] === id)),
    ),
  );
}
function disableAccount(id: string, field: string) {
  const s = state;
  for (const key of [
    "syndik_prod_registered_users_v1",
    "syndik_prod_resident_accounts_v1",
    "syndik_prod_prestataire_accounts_v1",
  ])
    for (const a of s[key] || [])
      if (a[field] === id || a.profile?.[field] === id) a.disabled = true;
  revoke(id);
}

const dependencies: CommandDependencies = {issueChargeInvoices, check, object, str, cents, appendAudit, assertPeriod, cabinetFor, buildingFor, canWrite, record, actorIdentity, dispatch, emailAvailable, manager, nested, links, pick};
const {financialOperation}=createFinanceCommands(transactionState,dependencies);
const {createCabinet,archiveCabinet,restoreCabinet,subscriptionPayment,voidSubscriptionPayment,submitSubscriptionBankTransfer,reviewSubscriptionBankTransfer,restoreArchived,archiveBuilding}=createBuildingCommands(transactionState,dependencies);
const {recomputeMeeting,meetingOperation}=createAssemblyCommands(transactionState,dependencies);
return {runOperation, cabinetFor, buildingFor, canWrite, appendAudit, actorIdentity, recomputeMeeting};
}



