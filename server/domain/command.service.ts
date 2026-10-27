import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getBuildingCapacity,PLANS,subscriptionCanWrite } from "../../utils/subscriptionPolicy";
import {
ApartmentSchema,
BuildingSchema,
ResidentSchema,
SyndicSchema,
TransactionSchema,
} from "../../utils/validation";
import { privateAttachments } from '../attachments';
import { mailIsConfigured,queueMail } from "../mailer";
import { type State } from "../repository";
import { firebaseLinkedResidentIds,LINKED_RESIDENT_EMAIL_CODE,LINKED_RESIDENT_EMAIL_MESSAGE } from '../residentIdentity';
import { createAssemblyCommands } from './assembly.service';
import { normalizeBillingPeriodKey } from "./billingPeriod";
import { createBuildingCommands } from './building.service';
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
  if (managed) manager(actor);
  else if (!["admin", "syndic"].includes(actor.role))
    check(actor.buildingId === id, "Immeuble non autorisé.");
  const b = s.buildings.find((b: any) => b.id === id);
  b.syndicId = s.id;
  return b;
}
function canWrite(actor: Actor, b: any) {
  const user = (transactionState.syndik_prod_registered_users_v1 || []).find(
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
  const state = transactionState;
  for (const user of transactionState.syndik_prod_registered_users_v1 || [])
    if (user.profile?.residentId === id || user.profile?.prestataireId === id)
      (transactionState.__sessionVersions ??= {})[user.uid] =
        (transactionState.__sessionVersions?.[user.uid] || 0) + 1;
}
function notice(
  residentId: string,
  b: any,
  title: string,
  message: string,
  type: string,
) {
  const state = transactionState,
    uid =
      (transactionState.syndik_prod_registered_users_v1 || []).find(
        (u: any) => u.profile?.residentId === residentId,
      )?.uid || `user-res-${residentId}`;
  const account = (transactionState.syndik_prod_registered_users_v1 || []).find(
    (u: any) => u.uid === uid,
  );
  if (account?.email && mailIsConfigured())
    queueMail(
      state,
      account.email,
      title,
      `${message}\n\n${process.env.PUBLIC_APP_URL || "http://localhost:3000"}`,
    );
  (transactionState.syndik_prod_notifications_v1 ??= []).push({
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
    const meta = transactionState.__files?.[url.slice('/api/uploads/'.length)];
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
    !transactionState.__closedPeriods?.[`${b.id}:${String(date).slice(0, 7)}`],
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
    appendAudit(transactionState, actor, operation);
    return s;
  }
  if (operation === "restoreArchived") return restoreArchived(actor,args);
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
      getBuildingCapacity(s).canAdd,
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
    if (operation === "deleteBuilding") return archiveBuilding(actor,b);
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
    apt.ownerId = next?.id || null;
    const previous = b.residents.find((r: any) => r.id === previousOwnerId);
    if (previous && previous.apartmentId === apt.id && previousOwnerId !== apt.ownerId)
      previous.apartmentId = b.apartments.find((a: any) => !a.archivedAt && a.ownerId === previous.id)?.id;
    if (next && !next.apartmentId) next.apartmentId = apt.id;
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
    for (const field of secretFields) delete r[field];
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
      row.item.archivedAt = new Date().toISOString();
      row.item.hasAccount = false;
      for (const apt of b.apartments)
        for (const field of ["ownerId", "tenantId"])
          if (apt[field] === row.item.id) apt[field] = null;
      disableAccount(row.item.id, "residentId");
      appendAudit(transactionState, actor, operation, b.id);
      return true;
    }
  } else if (operation === "savePrestataire") {
    const p = object(args[0]);
    b = buildingFor(actor, str(p.buildingId));
    buildingId = b.id;
    canWrite(actor, b);
    const old = (transactionState.syndik_prod_prestataires_v1 || []).find(
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
      appendAudit(transactionState, actor, operation, b.id);
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
      const meta = transactionState.__files?.[String(proof.receiptUrl).split("/").at(-1)!];
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
    if (args[0].paymentId !== undefined) z.string().trim().min(1).max(3000).parse(args[0].paymentId);
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
      appendAudit(transactionState, actor, operation, b.id);
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
      if (id) check((transactionState.syndik_prod_prestataires_v1 || []).some((p: any) =>
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
      (transactionState.syndik_prod_notifications_v1 || []).some(
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
      const item = (transactionState.syndik_prod_marketplace_v1 || []).find(
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
    (transactionState.syndik_prod_invoices_v1 || []).map((i: any) => i.id),
  );
  let result: any;
  try {
    result = await dispatch(actor, operation, args, {cabinetId:b?.syndicId,buildingId:b?.id});
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
    result = await dispatch(actor,
      `regenerate${changedCredentials.kind}Credentials`,
      [changedCredentials.id],
    );
    revoke(changedCredentials.id);
  }
  if (operation === "generateMonthlyCharges" && Array.isArray(result))
    for (const id of new Set(
      result.filter((c: any) => c.amount > 0).map((c: any) => c.residentId),
    ))
      await dispatch(actor, "createInvoiceForResident", [id, b.id, b.syndicId], {cabinetId:b.syndicId,buildingId:b.id});
  for (const invoice of transactionState.syndik_prod_invoices_v1 || [])
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
    const item = (transactionState.syndik_prod_maintenance_v1 || []).find(
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
  appendAudit(transactionState, actor, operation, buildingId, { operationId });
  return result;
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

const dependencies: CommandDependencies = {check, object, str, cents, appendAudit, assertPeriod, cabinetFor, buildingFor, canWrite, record, actorIdentity, dispatch, emailAvailable, manager, nested, links, pick};
const {financialOperation}=createFinanceCommands(transactionState,dependencies);
const {createCabinet,subscriptionPayment,restoreArchived,archiveBuilding}=createBuildingCommands(transactionState,dependencies);
const {recomputeMeeting,meetingOperation}=createAssemblyCommands(transactionState,dependencies);
return {runOperation, cabinetFor, buildingFor, canWrite, appendAudit, actorIdentity, recomputeMeeting};
}

