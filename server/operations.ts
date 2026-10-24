import { normalizeBillingPeriodKey } from "../firebase/services";
import { minimalVotingSnapshot } from './assemblyPrivacy';
import { queueMail, mailIsConfigured } from "./mailer";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { currentState, type State } from "./repository";
import { executeMutation } from "./domain";
import {
  ApartmentSchema,
  BuildingSchema,
  ResidentSchema,
  SyndicSchema,
  TransactionSchema,
} from "../utils/validation";
import { PLANS, subscriptionCanWrite } from "../utils/subscriptionPolicy";
import { applyResidentVote, evaluateResolutionStatus } from "../utils/agVoting";
import { hashPassword } from "./passwords";
import { privateAttachments } from './attachments';
import { computeBuildingFinancialBalances } from '../utils/security';
export class OperationError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export interface Actor {
  uid: string;
  role: string;
  email?: string;
  syndicId?: string;
  buildingId?: string;
  residentId?: string;
  prestataireId?: string;
}
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
export const actorIdentity = (a: Actor) =>
  a.role === "resident"
    ? a.residentId || a.uid.replace(/^(user-res-|res-)/, "")
    : a.role === "provider"
      ? a.prestataireId || a.uid.replace(/^(user-prest-|prov-)/, "")
      : a.uid;
const cabinets = () => currentState().syndik_prod_syndics_v1 || [];
const buildings = () => cabinets().flatMap((s: any) => s.buildings || []);
function manager(actor: Actor) {
  check(
    ["syndic", "admin"].includes(actor.role),
    "Opération réservée au syndic.",
  );
}
export function cabinetFor(actor: Actor, id: string) {
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
export function buildingFor(actor: Actor, id: string, managed = true) {
  const s = cabinets().find((s: any) =>
    s.buildings?.some((b: any) => b.id === id),
  );
  check(s, "Immeuble introuvable.", 404);
  cabinetFor(actor, s.id);
  if (managed) manager(actor);
  else if (!["admin", "syndic"].includes(actor.role))
    check(actor.buildingId === id, "Immeuble non autorisé.");
  const b = s.buildings.find((b: any) => b.id === id);
  b.syndicId = s.id;
  return b;
}
export function canWrite(actor: Actor, b: any) {
  const user = (currentState().syndik_prod_registered_users_v1 || []).find(
    (u: any) => u.uid === actor.uid,
  );
  check(
    user?.profile?.emailVerified !== false,
    "Vérifiez votre adresse email.",
  );
  check(
    !user?.profile?.mustChangePassword && !(actor as any).mustChangePassword,
    "Changez votre mot de passe initial avant de continuer.",
  );
  check(!b.archivedAt, "Immeuble archivé.", 409);
  if (actor.role !== "admin")
    check(
      subscriptionCanWrite(cabinetFor(actor, b.syndicId)),
      "Abonnement expiré : consultation et export disponibles.",
      402,
    );
}
export function appendAudit(
  state: State,
  actor: Actor,
  operation: string,
  buildingId?: string,
  detail?: any,
) {
  (state.syndik_prod_audit_v1 ??= []).push({
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
  const item = (currentState()[key] || []).find((x: any) => x.id === id);
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
  check(
    !b.apartments.some(
      (a: any) => a.number === apt.number && a.id !== apt.id && !a.archivedAt,
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
  const state = currentState();
  for (const user of state.syndik_prod_registered_users_v1 || [])
    if (user.profile?.residentId === id || user.profile?.prestataireId === id)
      (state.__sessionVersions ??= {})[user.uid] =
        (state.__sessionVersions?.[user.uid] || 0) + 1;
}
function notice(
  residentId: string,
  b: any,
  title: string,
  message: string,
  type: string,
) {
  const state = currentState(),
    uid =
      (state.syndik_prod_registered_users_v1 || []).find(
        (u: any) => u.profile?.residentId === residentId,
      )?.uid || `user-res-${residentId}`;
  const account = (state.syndik_prod_registered_users_v1 || []).find(
    (u: any) => u.uid === uid,
  );
  if (account?.email && mailIsConfigured())
    queueMail(
      state,
      account.email,
      title,
      `${message}\n\n${process.env.PUBLIC_APP_URL || "http://localhost:3000"}`,
    );
  (state.syndik_prod_notifications_v1 ??= []).push({
    id: randomUUID(),
    userId: uid,
    buildingId: b.id,
    title,
    message,
    type,
    read: false,
    createdAt: new Date().toISOString(),
  });
}
function validateAttachments(actor: Actor, b: any, input: unknown, existing?: unknown) {
  const previous = privateAttachments(existing);
  for (const url of privateAttachments(input)) {
    const meta = currentState().__files?.[url.slice('/api/uploads/'.length)];
    check(meta && meta.buildingId === b.id &&
      (['admin', 'syndic'].includes(actor.role) || meta.uploadedBy === actor.uid || previous.has(url)),
      'Pièce jointe privée ou non liée à cet immeuble.');
  }
}
function assertPeriod(b: any, date: any) {
  check(
    /^\d{4}-\d{2}-\d{2}/.test(String(date)) &&
      Number.isFinite(Date.parse(String(date))),
    "Date comptable invalide.",
    400,
  );
  check(
    !currentState().__closedPeriods?.[`${b.id}:${String(date).slice(0, 7)}`],
    "Période comptable clôturée.",
    409,
  );
}

export async function runOperation(
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
    state = currentState();
  const user = (state.syndik_prod_registered_users_v1 || []).find(
    (u: any) => u.uid === actor.uid,
  );
  check(
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
  if (operation === "recordSubscriptionPayment")
    return subscriptionPayment(actor, args[0]);
  if (operation === "saveSyndic") {
    manager(actor);
    const input = object(args[0]),
      s = cabinetFor(actor, str(input.id));
    check(
      actor.role === "admin" || subscriptionCanWrite(s),
      "Abonnement expiré : consultation et export disponibles.",
      402,
    );
    const data = SyndicSchema.partial().parse(input);
    if (data.rib)
      check(/^\d{24}$/.test(data.rib.replace(/\s/g, "")), "RIB invalide.", 400);
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
      for (const k of [
        "subscriptionPlan",
        "subscriptionStatus",
        "subscriptionExpiry",
      ])
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
    appendAudit(state, actor, operation);
    return s;
  }
  if (operation === "restoreArchived") {
    manager(actor);
    const [kind, id] = args;
    check(
      ["buildings", "apartments", "residents", "prestataires"].includes(kind),
      "Archive invalide.",
      400,
    );
    let item: any;
    if (kind === "buildings") {
      b = buildingFor(actor, id);
      const s = cabinetFor(actor, b.syndicId);
      check(
        subscriptionCanWrite(s) &&
          s.buildings.filter((x: any) => !x.archivedAt).length <
            PLANS[s.subscriptionPlan as keyof typeof PLANS].buildings,
        "Forfait insuffisant.",
        402,
      );
      item = b;
    } else if (kind === "prestataires") {
      ({ b, item } = record(actor, "syndik_prod_prestataires_v1", id));
    } else ({ b, item } = nested(actor, kind, id));
    if (kind === "apartments") links(b, item);
    delete item.archivedAt;
    appendAudit(state, actor, operation, b.id, { kind, id });
    return item;
  }
  if (operation === "addBuilding") {
    manager(actor);
    const s = cabinetFor(actor, str(args[0]));
    check(
      actor.role === "admin" || subscriptionCanWrite(s),
      "Abonnement expiré.",
      402,
    );
    const plan = PLANS[s.subscriptionPlan as keyof typeof PLANS];
    check(plan, "Forfait invalide.", 400);
    check(
      s.buildings.filter((x: any) => !x.archivedAt).length < plan.buildings,
      "Limite du forfait atteinte.",
      409,
    );
    const data = BuildingSchema.omit({ id: true }).parse({
        ...args[1],
        reserveFundRate: args[1].reserveFundRate !== undefined ? args[1].reserveFundRate
          : args[1].reserveFundPercentage !== undefined ? args[1].reserveFundPercentage : 5,
        syndicId: s.id,
      }),
      lots = z
        .array(ApartmentSchema.omit({ id: true, buildingId: true }))
        .max(500)
        .parse(args[1].apartments || []);
    check(
      lots.every((a) => !a.ownerId && !a.tenantId) &&
        new Set(lots.map((a) => a.number)).size === lots.length,
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
      if (args[1].bankRib)
        check(
          /^\d{24}$/.test(args[1].bankRib.replace(/\s/g, "")),
          "RIB invalide.",
          400,
        );
    }
    if (operation === "deleteBuilding") {
      b.archivedAt = new Date().toISOString();
      appendAudit(state, actor, operation, b.id);
      return true;
    }
    if (operation === "addApartmentsBulk") {
      args[1] = z
        .array(ApartmentSchema.omit({ id: true, buildingId: true }))
        .max(500)
        .parse(args[1]);
      for (const a of args[1]) links(b, a);
      check(
        new Set(args[1].map((a: any) => a.number)).size === args[1].length,
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
        if (args[2] && typeof args[2] === "object") args[3] = args[2];
        const parts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Casablanca",
          year: "numeric",
          month: "2-digit",
        }).formatToParts(new Date());
        args[2] = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
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
    if (operation === "updateApartment")
      check(
        b.apartments.some((a: any) => a.id === apt.id),
        "Lot introuvable.",
        404,
      );
    else delete apt.id;
    args[0] = apt;
  } else if (operation === "deleteApartment") {
    const row = nested(actor, "apartments", str(args[0]));
    row.item.archivedAt = new Date().toISOString();
    appendAudit(state, actor, operation, row.b.id);
    return true;
  } else if (operation === "addResident" || operation === "updateResident") {
    const r = ResidentSchema.parse(args[0]);
    b = buildingFor(actor, r.buildingId);
    buildingId = b.id;
    canWrite(actor, b);
    r.syndicId = b.syndicId;
    r.email = r.email.toLowerCase();
    for (const field of secretFields) delete r[field];
    if (r.apartmentId)
      check(
        b.apartments.some((a: any) => a.id === r.apartmentId && !a.archivedAt),
        "Lot non lié.",
        400,
      );
    if (operation === "updateResident") {
      const old = b.residents.find((x: any) => x.id === r.id);
      check(old, "Résident introuvable.", 404);
      if (old.hasAccount && old.email.toLowerCase() !== r.email)
        changedCredentials = { kind: "Resident", id: r.id! };
    } else delete r.id;
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
      row.item.archivedAt = new Date().toISOString();
      row.item.hasAccount = false;
      for (const apt of b.apartments)
        for (const field of ["ownerId", "tenantId"])
          if (apt[field] === row.item.id) apt[field] = null;
      disableAccount(row.item.id, "residentId");
      appendAudit(state, actor, operation, b.id);
      return true;
    }
  } else if (operation === "savePrestataire") {
    const p = object(args[0]);
    b = buildingFor(actor, str(p.buildingId));
    buildingId = b.id;
    canWrite(actor, b);
    const old = (state.syndik_prod_prestataires_v1 || []).find(
      (x: any) => x.id === p.id,
    );
    check(!old || old.buildingId === b.id, "Prestataire non lié.");
    const needsAccount = Boolean(args[1] || old?.hasAccount);
    const email = String(p.email || '').trim().toLowerCase();
    p.email = needsAccount || email ? z.string().email().parse(email) : '';
    if (p.email)
      check(
        emailAvailable(String(p.email), "prestataireId", String(p.id || "")),
        "Email déjà lié.",
        409,
      );
    for (const field of [...secretFields, "hasAccount"]) delete p[field];
    if (old?.hasAccount && old.email.toLowerCase() !== p.email)
      changedCredentials = { kind: "Prestataire", id: String(p.id) };
    args[0] = { ...p, syndicId: b.syndicId };
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
      disableAccount(row.item.id, "prestataireId");
      appendAudit(state, actor, operation, b.id);
      return true;
    }
    if (operation === "addPrestataireReview") {
      check(actor.role === "resident", "Avis réservé aux résidents.");
      args[1] = {
        ...pick(args[1], ["rating", "comment"]),
        residentId: actorIdentity(actor),
        residentName: b.residents.find(
          (r: any) => r.id === actorIdentity(actor),
        )?.name,
        authorName: actor.email,
        authorRole: "resident",
        date: new Date().toISOString(),
      };
      check(
        Number(args[1].rating) >= 1 && Number(args[1].rating) <= 5,
        "Note invalide.",
        400,
      );
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
      const meta = state.__files?.[String(proof.receiptUrl).split("/").at(-1)!];
      check(
        meta?.uploadedBy === actor.uid && meta.buildingId === b.id,
        "Justificatif non lié.",
      );
    }
    check(
      cents(proof.amount) > 0 &&
        cents(proof.amount) <=
          cents(charge.amount) - cents(charge.paidAmount || 0),
      "Montant supérieur au solde.",
      400,
    );
    const resident = b.residents.find((r: any) => r.id === charge.residentId),
      apartment = b.apartments.find((a: any) => a.id === charge.apartmentId);
    check(resident && apartment, "Résident ou lot non lié à la charge.", 400);
    args[0] = {
      ...pick(proof, [
        "amount",
        "date",
        "receiptUrl",
        "referenceNumber",
        "bankName",
        "paymentMethod",
        "receiptNote",
      ]),
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
    args[0] = {
      ...args[0],
      syndicId: b.syndicId,
      paymentId: args[0].paymentId || (args[0].addTransactionToLedger === false ? undefined : operationId),
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
      b.residents.some((r: any) => r.id === args[0]),
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
    const id = actor.role === "resident" ? actorIdentity(actor) : actor.uid,
      r = b.residents.find((r: any) => r.id === id) || { name: actor.email };
    args[0] = {
      ...pick(input, [
        "title",
        "description",
        "category",
        "location",
        "priority",
        "photos",
        "photoUrl",
      ]),
      description: str(input.description),
      residentId: id,
      residentName: r.name,
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
    if (operation !== "updateMaintenanceRequest") {
      check(
        actor.role !== "provider",
        "Validation réservée au demandeur ou syndic.",
      );
      check(
        operation !== "confirmMaintenanceCompletion" ||
          request.completionPending,
        "Aucune intervention à valider.",
        409,
      );
      request.completionPending = false;
      request.status =
        operation === "confirmMaintenanceCompletion" ? "completed" : "pending";
      request.completedAt =
        request.status === "completed" ? new Date().toISOString() : undefined;
      (request.updates ??= []).push({
        id: randomUUID(),
        note: str(args[1]),
        status: request.status,
        updatedBy: actor.uid,
        updatedByRole: actor.role,
        timestamp: new Date().toISOString(),
      });
      appendAudit(state, actor, operation, b.id);
      return request;
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
    if ('prestataireId' in args[1] || 'assignedTo' in args[1]) {
      const id = args[1].prestataireId ?? args[1].assignedTo ?? '';
      check(!args[1].prestataireId || !args[1].assignedTo || args[1].prestataireId === args[1].assignedTo,
        'Sélectionnez un seul prestataire.', 400);
      if (id) check((state.syndik_prod_prestataires_v1 || []).some((p: any) =>
        p.id === id && p.buildingId === b.id && !p.archivedAt && p.active !== false),
        'Sélectionnez un prestataire actif de cet immeuble.', 400);
      args[1].prestataireId = id;
      args[1].assignedTo = id;
    }
    if (args[1].status)
      check(
        ["pending", "in_progress", "completed"].includes(args[1].status),
        "Statut invalide.",
        400,
      );
    if (args[1].cost !== undefined)
      check(cents(args[1].cost) >= 0, "Coût invalide.", 400);
    if (actor.role === "provider" && args[1].status === "completed") {
      request.completionPending = true;
      args[1].status = "in_progress";
    } else if (args[1].status)
      request.completedAt =
        args[1].status === "completed" ? new Date().toISOString() : undefined;
    args[2] = {
      ...pick(args[2] || {}, ["title", "note", "stepPhotos"]),
      updatedBy: actor.uid,
      updatedByRole: actor.role,
    };
  } else if (operation === "deleteDocument") {
    const row = nested(actor, "documents", str(args[0]?.id));
    b = row.b;
    buildingId = b.id;
    args[0] = row.item;
  } else if (operation === "markNotificationAsRead") {
    check(
      (state.syndik_prod_notifications_v1 || []).some(
        (n: any) => n.id === args[0] && n.userId === actor.uid,
      ),
      "Notification non liée.",
    );
  } else if (operation === "sendChatMessage") {
    const m = object(args[0]);
    b = buildingFor(actor, str(m.buildingId), false);
    buildingId = b.id;
    canWrite(actor, b);
    validateAttachments(actor, b, m);
    const id = actorIdentity(actor),
      peer = m.recipientId;
    check(
      !peer || b.residents.some((r: any) => r.id === peer && !r.archivedAt),
      "Destinataire non lié.",
    );
    let channelId = str(m.channelId, 200);
    if (m.marketplaceItemId) {
      const item = (state.syndik_prod_marketplace_v1 || []).find(
        (x: any) => x.id === m.marketplaceItemId && x.buildingId === b.id,
      );
      check(
        item && peer && (item.residentId === id || item.residentId === peer),
        "Conversation non liée.",
      );
      channelId = `market-${item.id}:${[id, peer].sort().join(":")}`;
    }
    args[0] = {
      ...pick(m, [
        "recipientId",
        "marketplaceItemId",
        "marketplaceItemTitle",
        "attachmentUrl",
        "attachmentName",
      ]),
      buildingId: b.id,
      channelId,
      content: str(m.content),
      senderId: id,
      senderName:
        b.residents.find((r: any) => r.id === id)?.name ||
        actor.email ||
        "Syndic",
      senderRole: actor.role,
    };
  } else if (operation === "toggleChatMessageLike") {
    const row = record(actor, "syndik_prod_chat_v1", str(args[0]), false);
    b = row.b;
    buildingId = b.id;
    check(
      !row.item.recipientId ||
        [row.item.senderId, row.item.recipientId].includes(
          actorIdentity(actor),
        ),
      "Conversation privée.",
    );
    args[1] = actorIdentity(actor);
  } else if (operation === "addMarketplaceItem") {
    const input = object(args[0]);
    b = buildingFor(actor, str(input.buildingId), false);
    buildingId = b.id;
    canWrite(actor, b);
    check(actor.role !== "provider", "Rôle interdit.");
    validateAttachments(actor, b, input);
    const id = actorIdentity(actor);
    args[0] = {
      ...pick(input, [
        "category",
        "type",
        "condition",
        "imageUrl",
        "images",
        "phone",
        "whatsapp",
        "isFree",
      ]),
      title: str(input.title, 200),
      description: str(input.description),
      price: cents(input.price) / 100,
      buildingId: b.id,
      residentId: id,
      sellerId: id,
      residentName: b.residents.find((r: any) => r.id === id)?.name || "Syndic",
      status: "available",
    };
    check(args[0].price >= 0, "Prix invalide.", 400);
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
        ["virement", "versement", "cheque", "especes"].includes(method),
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
      "generateMonthlyCharges",
    ].includes(operation)
  )
    assertPeriod(
      b,
      operation === "createQuittance"
        ? args[0].paymentDate
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
    (state.syndik_prod_invoices_v1 || []).map((i: any) => i.id),
  );
  let result: any;
  try {
    result = await executeMutation(operation, args);
  } catch (e: any) {
    throw new OperationError(e.message, 400);
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
    result = await executeMutation(
      `regenerate${changedCredentials.kind}Credentials`,
      [changedCredentials.id],
    );
    revoke(changedCredentials.id);
  }
  if (operation === "generateMonthlyCharges" && Array.isArray(result))
    for (const id of new Set(
      result.filter((c: any) => c.amount > 0).map((c: any) => c.residentId),
    ))
      await executeMutation("createInvoiceForResident", [id, b.id, b.syndicId]);
  for (const invoice of state.syndik_prod_invoices_v1 || [])
    if (!oldInvoices.has(invoice.id))
      notice(
        invoice.residentId,
        b,
        "Nouvel avis de charges",
        `${invoice.invoiceNumber} : ${invoice.totalAmount} MAD`,
        "invoice",
      );
  if (operation === "addAnnouncement")
    for (const r of b.residents.filter((r: any) => !r.archivedAt))
      notice(r.id, b, "Nouvelle annonce", args[1].title, "announcement");
  if (operation === "updateMaintenanceRequest") {
    const item = (state.syndik_prod_maintenance_v1 || []).find(
      (x: any) => x.id === args[0],
    );
    notice(
      item.residentId,
      b,
      "Suivi intervention",
      item.completionPending ? "Intervention à valider" : item.status,
      "maintenance",
    );
  }
  if (
    [
      "regenerateResidentCredentials",
      "regeneratePrestataireCredentials",
    ].includes(operation) ||
    (operation === "savePrestataire" && args[1])
  )
    revoke(result?.id || args[0]);
  appendAudit(state, actor, operation, buildingId, { operationId });
  return result;
}
function emailAvailable(email: string, field?: string, id?: string) {
  const state = currentState();
  return [
    "syndik_prod_registered_users_v1",
    "syndik_prod_resident_accounts_v1",
    "syndik_prod_prestataire_accounts_v1",
  ].every((key) =>
    (state[key] || []).every(
      (u: any) =>
        u.email?.toLowerCase() !== email.toLowerCase() ||
        Boolean(id && field && (u[field] === id || u.profile?.[field] === id)),
    ),
  );
}
function disableAccount(id: string, field: string) {
  const s = currentState();
  for (const key of [
    "syndik_prod_registered_users_v1",
    "syndik_prod_resident_accounts_v1",
    "syndik_prod_prestataire_accounts_v1",
  ])
    for (const a of s[key] || [])
      if (a[field] === id || a.profile?.[field] === id) a.disabled = true;
  revoke(id);
}

function financialOperation(
  actor: Actor,
  operation: string,
  args: any[],
  b: any,
  operationId: string,
): any {
  const state = currentState();
  if (operation === "setOpeningBalances") {
    check(
      !b.financials?.openingBalancesRecordedAt,
      "Soldes initiaux déjà figés.",
      409,
    );
    const input = object(args[1]),
      working = cents(input.working),
      reserve = cents(input.reserve),
      reason = str(input.reason),
      transactions = b.financials?.transactions || [];
    // Keep the existing write-time validation; the shared selector also reads legacy data.
    for (const transaction of transactions) cents(transaction.amount);
    const financials = {
      ...(b.financials || {}),
      transactions,
      openingWorkingBalance: working / 100,
      openingReserveBalance: reserve / 100,
      openingBalancesRecordedAt: new Date().toISOString(),
    };
    delete financials.openingBalance;
    const balances = computeBuildingFinancialBalances({ ...b, financials });
    b.financials = {
      ...financials,
      balance: balances.workingBalance,
      reserveFundBalance: balances.reserveBalance,
    };
    appendAudit(state, actor, operation, b.id, {
      reason,
      working: working / 100,
      reserve: reserve / 100,
    });
    return b.financials;
  }
  if (
    operation === "closeFinancialPeriod" ||
    operation === "reopenFinancialPeriod"
  ) {
    const period = z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .parse(args[1]),
      reason = str(args[2]);
    if (operation === "reopenFinancialPeriod")
      check(actor.role === "admin", "Réouverture réservée à l’administration.");
    if (operation === "closeFinancialPeriod")
      (state.__closedPeriods ??= {})[`${b.id}:${period}`] = {
        closedAt: new Date().toISOString(),
        actorUid: actor.uid,
        reason,
      };
    else delete (state.__closedPeriods || {})[`${b.id}:${period}`];
    appendAudit(state, actor, operation, b.id, { period, reason });
    return true;
  }
  if (operation === "attachDocument") {
    const meta = state.__files?.[String(args[1]?.fileId)];
    check(meta?.buildingId === b.id, "Fichier non lié.");
    const item = {
      id: randomUUID(),
      name: meta.name,
      url: `/api/uploads/${meta.fileId}`,
      mimeType: meta.mimeType,
      size: `${(meta.sizeBytes / 1048576).toFixed(1)} MB`,
      uploadedAt: new Date().toISOString(),
      category: "autre",
    };
    (b.documents ??= []).push(item);
    appendAudit(state, actor, operation, b.id);
    return item;
  }
  if (operation === "importOpeningArrears") {
    const rows = z.array(z.any()).max(100).parse(args[1]),
      charges = (state.syndik_prod_charges_v1 ??= []);
    for (const row of rows) {
      const lot = b.apartments.find(
        (a: any) => a.id === row.apartmentId && !a.archivedAt,
      );
      check(
        lot &&
          b.residents.some(
            (r: any) => r.id === row.residentId && !r.archivedAt,
          ) &&
          [lot.ownerId, lot.tenantId].includes(row.residentId),
        "Lot/résident non lié.",
        400,
      );
      check(cents(row.amount) > 0, "Montant invalide.", 400);
      const period = z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .parse(row.period);
      const id = `opening:${b.id}:${lot.id}:${period}`;
      check(
        !charges.some((c: any) => c.id === id),
        "Arriéré initial déjà saisi.",
        409,
      );
      charges.push({
        id,
        buildingId: b.id,
        syndicId: b.syndicId,
        apartmentId: lot.id,
        residentId: row.residentId,
        period,
        periodKey: period,
        amount: row.amount,
        paidAmount: 0,
        status: "unpaid",
        dueDate: `${period}-01`,
        openingArrears: true,
        description: str(row.description || "Arriéré initial"),
        createdAt: new Date().toISOString(),
      });
    }
    appendAudit(state, actor, operation, b.id, { rows: rows.length });
    return true;
  }
  if (operation === "reversePayment") {
    const paymentId = str(args[1]),
      reason = str(args[2]),
      journal = b.financials?.transactions || [];
    assertPeriod(b, new Date().toISOString());
    check(
      !journal.some((t: any) => t.reversalOf === paymentId),
      "Paiement déjà contrepassé.",
      409,
    );
    const original = journal.filter(
      (t: any) => t.paymentId === paymentId && t.type === "income",
    );
    check(original.length, "Encaissement introuvable.", 404);
    for (const t of original) assertPeriod(b, t.date);
    const total = original.reduce(
        (sum: number, t: any) => sum + cents(t.amount),
        0,
      ),
      source = original[0],
      allocations =
        source.paymentAllocations ||
        (source.sourceChargeId
          ? [{ chargeId: source.sourceChargeId, amount: total / 100 }]
          : undefined);
    check(
      allocations,
      "Ancien paiement sans ventilation : rapprochement nécessaire.",
      409,
    );
    check(
      allocations.reduce((sum: number, a: any) => sum + cents(a.amount), 0) ===
        total,
      "Ventilation incohérente.",
      409,
    );
    for (const allocation of allocations) {
      const charge = (state.syndik_prod_charges_v1 || []).find(
        (c: any) => c.id === allocation.chargeId && c.buildingId === b.id,
      );
      check(
        charge && cents(charge.paidAmount || 0) >= cents(allocation.amount),
        "Solde de charge incohérent.",
        409,
      );
      charge.paidAmount =
        (cents(charge.paidAmount) - cents(allocation.amount)) / 100;
      charge.status = "unpaid";
      delete charge.paidAt;
    }
    if (source.sourceInvoiceId) {
      const invoice = (state.syndik_prod_invoices_v1 || []).find(
        (i: any) => i.id === source.sourceInvoiceId && i.buildingId === b.id,
      );
      check(
        invoice && cents(invoice.paidAmount || 0) >= total,
        "Solde facture incohérent.",
        409,
      );
      invoice.paidAmount = (cents(invoice.paidAmount) - total) / 100;
      invoice.status = "unpaid";
    }
    for (const t of original) {
      const inverse = {
        ...t,
        id: randomUUID(),
        paymentId: `reversal:${operationId}`,
        reversalOf: paymentId,
        type: "expense",
        description: `Contrepassation : ${reason}`,
        date: new Date().toISOString(),
      };
      journal.unshift(inverse);
      const field = t.fundType === "reserve" ? "reserveFundBalance" : "balance";
      b.financials[field] =
        (cents(b.financials[field] || 0) - cents(t.amount)) / 100;
    }
    for (const receipt of state.syndik_prod_quittances_v1 || [])
      if (
        receipt.paymentId === paymentId ||
        (!receipt.paymentId &&
          allocations.some((a: any) => a.chargeId === receipt.chargeId))
      ) {
        receipt.voidedAt = new Date().toISOString();
        receipt.voidReason = reason;
      }
    appendAudit(state, actor, operation, b.id, {
      paymentId,
      reason,
      total: total / 100,
    });
    return true;
  }
}
async function createCabinet(actor: Actor, input: any) {
  check(actor.role === "admin", "Administration uniquement.");
  const state = currentState(),
    data = object(input),
    email = z.string().email().parse(data.email).toLowerCase(),
    password = z.string().min(10).max(200).parse(data.password);
  check(
    !(state.syndik_prod_registered_users_v1 || []).some(
      (u: any) => u.email === email,
    ),
    "Compte déjà existant.",
    409,
  );
  const plan = z
      .enum(["starter", "professional", "enterprise"])
      .parse(data.plan),
    id = randomUUID(),
    uid = randomUUID(),
    cabinet = {
      id,
      name: str(data.name, 200),
      email,
      phone: String(data.phone || ""),
      city: String(data.city || ""),
      logoUrl: "",
      createdBy: uid,
      subscriptionPlan: plan,
      subscriptionStatus: "trialing",
      subscriptionExpiry: new Date(Date.now() + 30 * 86400000).toISOString(),
      buildings: [],
    };
  const profile = {
    uid,
    email,
    displayName: str(data.managerName || data.name, 200),
    role: "syndic",
    syndicId: id,
    mustChangePassword: true,
    emailVerified: true,
  };
  (state.syndik_prod_syndics_v1 ??= []).push(cabinet);
  (state.syndik_prod_registered_users_v1 ??= []).push({
    uid,
    email,
    passwordHash: hashPassword(password),
    profile,
  });
  if (data.initialBuilding) {
    const info = object(data.initialBuilding),
      count = z
        .number()
        .int()
        .min(1)
        .max(500)
        .parse(Number(info.apartmentsCount)),
      fee = cents(Number(info.monthlyFees)) / 100;
    await executeMutation("addBuilding", [
      id,
      {
        name: str(info.name, 200),
        address: str(info.address, 500),
        city: cabinet.city,
        monthlySyndicFees: fee,
        syndicId: id,
        reserveFundRate: 5,
        apartments: Array.from({ length: count }, (_, i) => ({
          number: String(i + 1),
          floor: 0,
          area: 0,
          monthlyFees: fee,
          tantiemes: Math.floor(1000 / count) + (i < 1000 % count ? 1 : 0),
          ownerId: null,
          tenantId: null,
        })),
      },
    ]);
  }
  appendAudit(state, actor, "adminCreateCabinet", undefined, { syndicId: id });
  return cabinet;
}
function subscriptionPayment(actor: Actor, input: any) {
  check(actor.role === "admin", "Administration uniquement.");
  const state = currentState(),
    data = object(input),
    s = cabinetFor(actor, str(data.syndicId)),
    plan = z.enum(["starter", "professional", "enterprise"]).parse(data.plan),
    months = z.number().int().min(1).max(12).parse(data.months),
    reference = str(data.reference, 200),
    amount = cents(data.amount);
  check(
    amount === PLANS[plan].price * months * 100,
    "Montant incompatible avec le forfait.",
    400,
  );
  check(
    !(state.syndik_prod_subscription_payments_v1 || []).some(
      (p: any) => p.reference === reference,
    ),
    "Référence déjà utilisée.",
    409,
  );
  const expiry = new Date(
    Math.max(Date.now(), Date.parse(s.subscriptionExpiry) || 0),
  );
  const originalDay = expiry.getUTCDate();
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  expiry.setUTCDate(
    Math.min(
      originalDay,
      new Date(
        Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0),
      ).getUTCDate(),
    ),
  );
  Object.assign(s, {
    subscriptionPlan: plan,
    subscriptionStatus: "active",
    subscriptionExpiry: expiry.toISOString(),
  });
  const payment = {
    id: randomUUID(),
    syndicId: s.id,
    plan,
    months,
    reference,
    amount: amount / 100,
    recordedBy: actor.uid,
    createdAt: new Date().toISOString(),
  };
  (state.syndik_prod_subscription_payments_v1 ??= []).push(payment);
  appendAudit(state, actor, "recordSubscriptionPayment", undefined, {
    paymentId: payment.id,
    syndicId: s.id,
  });
  return payment;
}
function roll(building: any, previous: any[] = []) {
  const lots = building.apartments.filter((a: any) => !a.archivedAt);
  check(
    lots.length &&
      lots.every(
        (a: any) =>
          Number.isFinite(a.tantiemes) &&
          a.tantiemes >= 0 &&
          building.residents.some(
            (r: any) => r.id === a.ownerId && r.isOwner && !r.archivedAt,
          ),
      ),
    "Configurez les tantièmes et copropriétaires avant le vote.",
    400,
  );
  const totalTantiemes = lots.reduce(
    (sum: number, a: any) => sum + a.tantiemes,
    0,
  );
  check(totalTantiemes > 0, "Tantièmes invalides.", 400);
  const attendees = lots.map((a: any) => {
    const old = previous.find(
      (p) => p.residentId === a.ownerId && p.apartmentNumber === a.number,
    );
    return {
      residentId: a.ownerId,
      residentName: building.residents.find((r: any) => r.id === a.ownerId)
        .name,
      apartmentNumber: a.number,
      tantiemes: a.tantiemes,
      status: old?.status || "absent",
      ...(old?.proxyHolderName ? { proxyHolderName: old.proxyHolderName } : {}),
    };
  });
  const presentTantiemes = attendees
      .filter((a: any) => ["present", "represented"].includes(a.status))
      .reduce((sum: number, a: any) => sum + a.tantiemes, 0),
    quorumRequired = Math.floor(totalTantiemes / 2) + 1;
  return {
    attendees,
    totalTantiemes,
    presentTantiemes,
    quorumRequired,
    quorumReached: presentTantiemes >= quorumRequired,
  };
}
export function recomputeMeeting(ag: any) {
  if (!ag.votingSnapshot) return;
  Object.assign(ag, roll(ag.votingSnapshot, ag.attendees));
  for (const r of ag.resolutions) {
    const unique = new Map();
    for (const v of r.voterChoices || []) {
      const lot = ag.votingSnapshot.apartments.find(
        (a: any) => a.id === v.apartmentId && a.ownerId === v.residentId,
      );
      check(
        lot && ["for", "against", "abstain"].includes(v.choice || v.vote),
        "Historique de vote incohérent.",
        409,
      );
      unique.set(lot.id, { ...v, tantiemes: lot.tantiemes });
    }
    r.voterChoices = [...unique.values()];
    r.voters = r.voterChoices;
    for (const [field, choice] of [
      ["votesFor", "for"],
      ["votesAgainst", "against"],
      ["votesAbstain", "abstain"],
    ])
      r[field] = r.voterChoices
        .filter((v: any) => (v.choice || v.vote) === choice)
        .reduce((sum: number, v: any) => sum + v.tantiemes, 0);
    r.status = evaluateResolutionStatus(r, ag);
  }
}
async function meetingOperation(actor: Actor, operation: string, args: any[]) {
  const state = currentState(),
    list = (state.syndik_prod_ag_v1 ??= []);
  let ag: any, b: any;
  if (
    ["createAssembleeGenerale", "saveAssembleeGenerale"].includes(operation)
  ) {
    const input = object(args[0]);
    b = buildingFor(actor, str(input.buildingId));
    canWrite(actor, b);
    const old = list.find((x: any) => x.id === input.id);
    check(
      !old ||
        (old.buildingId === b.id &&
          !["completed", "closed"].includes(old.status)),
      "Assemblée clôturée.",
      409,
    );
    const metadata = pick(input, [
      "title",
      "type",
      "date",
      "time",
      "location",
      "presidentName",
      "secretaryName",
      "agendaItems",
      "pvSummary",
    ]);
    if (old?.votingSnapshot) {
      check(
        isDeepStrictEqual(
          ((input.resolutions as any[]) || []).map((r) => [
            r.id,
            r.title,
            r.description,
            r.majorityType,
            r.budgetAmount,
          ]),
          old.resolutions.map((r: any) => [
            r.id,
            r.title,
            r.description,
            r.majorityType,
            r.budgetAmount,
          ]),
        ),
        "Résolutions figées après ouverture.",
        409,
      );
      Object.assign(old, metadata);
      ag = old;
      if (input.status === "completed") {
        recomputeMeeting(ag);
        ag.status = "completed";
        ag.isVotingOpen = false;
      }
    } else {
      check(
        old || operation === "createAssembleeGenerale",
        "Assemblée introuvable.",
        404,
      );
      check(
        input.status !== "completed",
        "Ouvrez le scrutin avant clôture.",
        409,
      );
      const resolutions = z
        .array(z.any())
        .max(100)
        .parse(input.resolutions || [])
        .map((r: any, i: number) => ({
          id: r.id ? str(r.id, 100) : randomUUID(),
          number: i + 1,
          title: str(r.title, 300),
          description: String(r.description || "").slice(0, 10000),
          majorityType: z
            .enum([
              "simple",
              "absolute",
              "three_quarters",
              "unanimity",
              "simple_24",
              "absolue_25",
              "trois_quarts_26",
              "unanimite",
            ])
            .parse(r.majorityType),
          budgetAmount:
            r.budgetAmount === undefined
              ? undefined
              : cents(r.budgetAmount) / 100,
          votesFor: 0,
          votesAgainst: 0,
          votesAbstain: 0,
          voterChoices: [],
          voters: [],
          status: "pending",
        }));
      check(
        new Set(resolutions.map((r) => r.id)).size === resolutions.length,
        "Résolutions en double.",
        409,
      );
      ag = {
        ...metadata,
        id: old?.id || randomUUID(),
        buildingId: b.id,
        syndicId: b.syndicId,
        status: "planned",
        isVotingOpen: false,
        resolutions,
        ...roll(b, old?.attendees),
      };
      if (old) Object.assign(old, ag);
      else list.push(ag);
    }
  } else {
    const row = record(actor, "syndik_prod_ag_v1", str(args[0]));
    ag = row.item;
    b = row.b;
    if (operation === "generateChargesFromAGResolution") {
      check(
        ag.status === "completed",
        "Clôturez le vote avant de générer les charges.",
        409,
      );
      assertPeriod(b, new Date().toISOString());
      const result = await executeMutation(operation, args);
      appendAudit(state, actor, operation, b.id);
      return result;
    }
    check(
      !["completed", "closed"].includes(ag.status),
      "Assemblée clôturée.",
      409,
    );
    if (operation === "toggleAGVoting") {
      check(typeof args[1] === "boolean", "Statut invalide.", 400);
      if (args[1] && !ag.votingSnapshot) {
        Object.assign(ag, roll(b, ag.attendees));
        ag.votingSnapshot = minimalVotingSnapshot({
          id: b.id,
          syndicId: b.syndicId,
          residents: b.residents.filter(
            (r: any) => r.isOwner && !r.archivedAt,
          ),
          apartments: b.apartments.filter((a: any) => !a.archivedAt),
        });
        ag.status = "in_progress";
      }
      ag.isVotingOpen = args[1];
    }
    if (operation === "recordAGVote") {
      const voter = object(args[4]);
      Object.assign(
        ag,
        applyResidentVote(
          ag,
          ag.votingSnapshot || b,
          str(voter.residentId),
          str(args[1]),
          args[2],
          str(voter.apartmentId),
        ),
      );
      recomputeMeeting(ag);
    }
    if (operation === "updateAGAttendee") {
      check(
        ["present", "represented", "absent"].includes(args[2]),
        "Présence invalide.",
        400,
      );
      const attendees = ag.attendees.filter(
        (a: any) => a.residentId === args[1],
      );
      check(attendees.length, "Copropriétaire non lié.", 400);
      if (args[2] === "absent")
        check(
          !ag.resolutions.some((r: any) =>
            r.voterChoices?.some((v: any) => v.residentId === args[1]),
          ),
          "Un votant ne peut être retiré après son vote.",
          409,
        );
      for (const a of attendees) {
        a.status = args[2];
        a.proxyHolderName =
          args[2] === "represented" ? str(args[3], 200) : undefined;
      }
      if (ag.votingSnapshot) recomputeMeeting(ag);
      else Object.assign(ag, roll(b, ag.attendees));
    }
  }
  appendAudit(state, actor, operation, b.id);
  return ag;
}
