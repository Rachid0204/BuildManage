import { allocateBudgetInCentimes, centimes } from '../../shared/domain/money';
import type { AssembleeGenerale, Building, Charge, Syndic } from '../../types';
import {
  applyResidentVote,
  evaluateResolutionStatus,
} from '../../utils/agVoting';
import {
  assertBudgetConserved,
  billingPayer,
  requireBudgetPayer,
} from './billingAllocation';
import type { DomainContext } from './context';
import { assertContext } from './context';
import { ToggleAGVotingSchema } from './contracts';
import { STORAGE_KEYS } from './records';
import { transactionRecords } from './state';
export function createAssemblyService(context: DomainContext) {
  assertContext(context);
  const {
    read: getLocalItem,
    write: setLocalItem,
    write,
  } = transactionRecords(context.state);

  /**
   * Phase 4.1: Generates prorated calls for funds (Appels de fonds Loi 18-00 Art. 24 / 37)
   * across all building lots using exact centime allocation when an AG resolution with a budget is adopted.
   */
  const generateChargesFromAGResolution = async (
    agId: string,
    resolutionId: string,
  ): Promise<{
    createdCharges: Charge[];
    totalAllocatedMad: number;
  }> => {
    const agList = getLocalItem<AssembleeGenerale[]>(STORAGE_KEYS.AG, []);
    const ag = agList.find((item) => item.id === agId);
    if (!ag) throw new Error('Assemblée Générale introuvable');
    if (!['completed', 'closed'].includes(ag.status))
      throw new Error('Clôturez le vote avant de générer les charges.');
    const res = ag.resolutions.find((r) => r.id === resolutionId);
    if (!res) throw new Error('Résolution introuvable');
    if (res.status !== 'approved') {
      throw new Error(
        'Seules les résolutions adoptées peuvent générer des appels de fonds.',
      );
    }
    const budgetMad = res.budgetAmount ?? 0;
    centimes(budgetMad);
    if (budgetMad <= 0) {
      throw new Error('Aucun budget (MAD) n’est associé à cette résolution.');
    }
    const syndics = getLocalItem<Syndic[]>(STORAGE_KEYS.SYNDICS, []);
    let targetBuilding: Building | undefined;
    let targetSyndicId = ag.syndicId;
    for (const s of syndics) {
      const bld =
        s.id === ag.syndicId
          ? s.buildings.find((b) => b.id === ag.buildingId)
          : undefined;
      if (bld) {
        targetBuilding = bld;
        targetSyndicId = s.id;
        break;
      }
    }
    if (!targetBuilding || targetBuilding.apartments.length === 0) {
      throw new Error(
        'Aucun lot configuré dans cet immeuble pour répartir le budget voté.',
      );
    }
    const snapshotLots = ag.votingSnapshot?.apartments?.length
      ? ag.votingSnapshot.apartments.filter((a: any) => !a.archivedAt)
      : targetBuilding.apartments.filter((a: any) => !a.archivedAt);
    const targets = snapshotLots.map((snapApt: any) => {
      const liveApt = targetBuilding!.apartments.find(
        (a) => a.id === snapApt.id && !(a as any).archivedAt,
      );
      const payerLot = liveApt ?? snapApt;
      return {
        apt: {
          ...payerLot,
          tantiemes: snapApt.tantiemes ?? liveApt?.tantiemes ?? 100,
        },
        residentId: billingPayer(targetBuilding!, payerLot, {
          ownerOnly: true,
        }),
      };
    });
    targets.forEach(({ apt, residentId }) =>
      requireBudgetPayer(apt, residentId),
    );
    const lots = targets.map(({ apt: a }) => ({
      id: a.id,
      tantiemes: a.tantiemes ?? 100,
    }));
    const effectiveTotalTantiemes = ag.votingSnapshot?.apartments?.length
      ? (ag.totalTantiemes ??
          lots.reduce((sum, lot) => sum + (lot.tantiemes || 0), 0)) ||
        1000
      : (targetBuilding.totalTantiemes ?? 1000);
    const allocations = allocateBudgetInCentimes(
      budgetMad,
      lots,
      effectiveTotalTantiemes,
    );
    const charges = getLocalItem<Charge[]>(STORAGE_KEYS.CHARGES, []);
    const nowIso = new Date().toISOString();
    const dueDate = new Date(Date.now() + 30 * 86400000).toISOString();
    const createdCharges: Charge[] = [];
    let totalAllocatedMad = 0;
    for (const { apt, residentId } of targets) {
      const shareMad = allocations.get(apt.id)!;
      if (shareMad <= 0) continue;
      const deterministicId = `chg-ag-${ag.id}-${res.id}-${apt.id}`;
      const existing = charges.find((c) => c.id === deterministicId);
      if (existing) {
        if (
          existing.syndicId !== targetSyndicId ||
          existing.buildingId !== targetBuilding.id ||
          centimes(existing.amount) !== centimes(shareMad)
        )
          throw new Error(
            'Charge existante incompatible avec le budget. Rapprochement nécessaire.',
          );
        continue;
      }
      const newCharge: Charge = {
        id: deterministicId,
        syndicId: targetSyndicId,
        buildingId: targetBuilding.id,
        apartmentId: apt.id,
        residentId: residentId!,
        amount: shareMad,
        paidAmount: 0,
        dueDate,
        status: 'unpaid',
        period: `AG ${new Date(ag.date).getFullYear()} - Rés. #${res.number}`,
        description: `Appel de fonds AG (${ag.title}) — Résolution #${res.number}: ${res.title}`,
        chargeType: 'exceptionnelle_travaux',
        ...(res.worksFundTarget && res.worksFundTarget !== 'default'
          ? { worksFundTarget: res.worksFundTarget }
          : {}),
        tantiemesApplied: apt.tantiemes ?? 100,
        createdAt: nowIso,
      };
      charges.unshift(newCharge);
      createdCharges.push(newCharge);
      totalAllocatedMad =
        Math.round((totalAllocatedMad + shareMad) * 100) / 100;
    }
    assertBudgetConserved(
      charges
        .filter(
          (c) =>
            c.buildingId === targetBuilding!.id &&
            c.syndicId === targetSyndicId &&
            c.id.startsWith(`chg-ag-${ag.id}-${res.id}-`),
        )
        .map((c) => c.amount),
      budgetMad,
    );
    setLocalItem(STORAGE_KEYS.CHARGES, charges);
    res.chargesGeneratedAt ??= nowIso;
    res.generatedChargesCount = charges.filter(
      (c) =>
        c.syndicId === targetSyndicId &&
        c.buildingId === targetBuilding!.id &&
        c.id.startsWith(`chg-ag-${ag.id}-${res.id}-`),
    ).length;
    setLocalItem(STORAGE_KEYS.AG, agList);
    return { createdCharges, totalAllocatedMad };
  };
  return { generateChargesFromAGResolution };
}

import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { bankDate } from '../../shared/domain/paymentDates';
import {
  canonicalQuorum,
  presentVotingWeight,
} from '../../shared/domain/voting';
import { minimalVotingSnapshot } from '../assemblyPrivacy';
import type { State } from '../repository';
import type { CommandDependencies } from './dependencies';
import type { Actor } from './errors';


const AGMetadataSchema = z.object({
  title: z.string().trim().min(1, "Titre d'assemblée requis.").max(300, "Titre d'assemblée trop long.").optional(),
  type: z.enum(["ordinaire", "extraordinaire", "AGO", "AGE"]).optional(),
  convocationNumber: z.union([z.literal(1), z.literal(2)]).optional(),
  date: z.string().max(40).optional(),
  time: z.string().max(20).optional(),
  location: z.string().max(300).optional(),
  presidentName: z.string().max(200).optional(),
  secretaryName: z.string().max(200).optional(),
  agendaItems: z.array(z.string().max(500)).max(100).optional(),
  pvSummary: z.string().max(20000).optional(),
});

const normalizePersonName = (value: unknown) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function createAssemblyCommands(transactionState: State, dependencies: CommandDependencies) {
const state=transactionState;
const check: CommandDependencies['check'] = dependencies.check;
const {issueChargeInvoices, object, str, cents, appendAudit, assertPeriod, cabinetFor, buildingFor, canWrite, record, actorIdentity, dispatch, emailAvailable, pick}=dependencies;
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
      (p) =>
        p.residentId === a.ownerId &&
        (p.apartmentId ? p.apartmentId === a.id : p.apartmentNumber === a.number),
    );
    return {
      residentId: a.ownerId,
      residentName: building.residents.find((r: any) => r.id === a.ownerId)
        .name,
      apartmentId: a.id,
      apartmentNumber: a.number,
      tantiemes: a.tantiemes,
      status: old?.status || "absent",
      ...(old?.proxyHolderName ? { proxyHolderName: old.proxyHolderName } : {}),
    };
  });
  const presentTantiemes = presentVotingWeight(attendees),
    quorumRequired = canonicalQuorum(totalTantiemes);
  return {
    attendees,
    totalTantiemes,
    presentTantiemes,
    quorumRequired,
    quorumReached: presentTantiemes >= quorumRequired,
  };
}

function recomputeMeeting(ag: any) {
  if (!ag.votingSnapshot) return;
  Object.assign(ag, roll(ag.votingSnapshot, ag.attendees));
  for (const r of ag.resolutions) {
    const unique = new Map();
    for (const v of r.voterChoices ?? r.voters ?? []) {
      const lot = ag.votingSnapshot.apartments.find(
        (a: any) =>
          (v.apartmentId ? a.id === v.apartmentId : a.number === v.apartmentNumber) &&
          a.ownerId === v.residentId,
      );
      check(
        lot && ["for", "against", "abstain"].includes(v.choice || v.vote),
        "Historique de vote incohérent.",
        409,
      );
      unique.set(lot.id, { ...v, apartmentId: lot.id, tantiemes: lot.tantiemes });
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
  const state = transactionState,
    list = (transactionState.syndik_prod_ag_v1 ??= []);
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
    const rawMetadata = pick(input, [
      "title",
      "type",
      "convocationNumber",
      "date",
      "time",
      "location",
      "presidentName",
      "secretaryName",
      "agendaItems",
      "pvSummary",
    ]);
    const parsedMetadata = AGMetadataSchema.safeParse(rawMetadata);
    check(
      parsedMetadata.success,
      parsedMetadata.success
        ? ""
        : parsedMetadata.error.issues[0]?.message || "Métadonnées d'assemblée invalides.",
      400,
    );
    const metadata = parsedMetadata.data;
    if (operation === "createAssembleeGenerale") {
      check(Boolean(metadata.title), "Titre d'assemblée requis.", 400);
    }
    if (metadata.date !== undefined && String(metadata.date).trim() !== "") {
      try {
        metadata.date = bankDate(String(metadata.date));
      } catch {
        check(false, "Date d'assemblée invalide.", 400);
      }
    }
    if (old?.votingSnapshot) {
      check(
        isDeepStrictEqual(
          ((input.resolutions as any[]) || []).map((r) => [
            r.id,
            r.title,
            r.description,
            r.majorityType,
            r.budgetAmount,
            r.generatesCharges,
            r.worksFundTarget ?? 'default',
          ]),
          old.resolutions.map((r: any) => [
            r.id,
            r.title,
            r.description,
            r.majorityType,
            r.budgetAmount,
            r.generatesCharges,
            r.worksFundTarget ?? 'default',
          ]),
        ),
        "Résolutions figées après ouverture.",
        409,
      );
      if (
        metadata.convocationNumber !== undefined &&
        metadata.convocationNumber !== (old.convocationNumber ?? 1)
      ) {
        check(
          false,
          "Le numéro de convocation ne peut être modifié après ouverture du vote.",
          409,
        );
      }
      Object.assign(old, metadata);
      ag = old;
      if (input.status === "completed") {
        ag.status = "completed";
        ag.isVotingOpen = false;
        recomputeMeeting(ag);
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
        .map((r: any, i: number) => {
          const parsedBudget =
            r.budgetAmount === undefined
              ? undefined
              : cents(r.budgetAmount) / 100;
          if (parsedBudget !== undefined) {
            check(parsedBudget >= 0, "Le budget d'une résolution ne peut pas être négatif.", 400);
          }
          return {
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
            ...(r.generatesCharges !== undefined ? { generatesCharges: z.boolean().parse(r.generatesCharges) } : {}),
            ...(r.worksFundTarget !== undefined
              ? {
                  worksFundTarget: z
                    .enum(["default", "courant", "reserve"])
                    .parse(r.worksFundTarget),
                }
              : {}),
            budgetAmount: parsedBudget,
            votesFor: 0,
            votesAgainst: 0,
            votesAbstain: 0,
            voterChoices: [],
            voters: [],
            status: "pending",
          };
        });
      check(
        new Set(resolutions.map((r) => r.id)).size === resolutions.length,
        "Résolutions en double.",
        409,
      );
      ag = {
        convocationNumber: old?.convocationNumber ?? 1,
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
        ["completed", "closed"].includes(ag.status),
        "Clôturez le vote avant de générer les charges.",
        409,
      );
      assertPeriod(b, new Date().toISOString());
      const result = await dispatch(actor, operation, args, {cabinetId:b.syndicId,buildingId:b.id});
      const charges = (transactionState.syndik_prod_charges_v1 || []).filter((c: any) =>
        c.syndicId === b.syndicId && c.buildingId === b.id && c.id.startsWith(`chg-ag-${ag.id}-${str(args[1])}-`));
      await issueChargeInvoices(actor, b, charges);
      appendAudit(transactionState, actor, operation, b.id);
      return result;
    }
    check(
      !["completed", "closed"].includes(ag.status),
      "Assemblée clôturée.",
      409,
    );
    if (operation === "toggleAGVoting") {
      check(typeof args[1] === "boolean", "Statut invalide.", 400);
      ToggleAGVotingSchema.parse({agId:args[0],isOpen:args[1]});
      if (args[1]) {
        check(ag.resolutions.every((r: any) =>
          !(r.generatesCharges === true || r.budgetAmount !== undefined) ||
          (Number.isFinite(r.budgetAmount) && cents(r.budgetAmount) > 0)),
          "Définissez un budget positif pour chaque résolution générant des charges avant ouverture du vote.", 400);
      }
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
      const comment =
        typeof voter.comment === "string"
          ? voter.comment
          : typeof args[5] === "string"
            ? args[5]
            : undefined;
      try {
        Object.assign(
          ag,
          applyResidentVote(
            ag,
            ag.votingSnapshot || b,
            str(voter.residentId),
            str(args[1]),
            args[2],
            voter.apartmentId ? str(voter.apartmentId) : undefined,
            comment,
            {
              actorRole: actor.role as "resident" | "syndic" | "admin",
              actorUid: actor.uid,
              allowOverrideResidentVote: Boolean(voter.allowOverrideResidentVote),
            },
          ),
        );
      } catch (err: any) {
        check(false, err?.message || "Vote invalide.", err?.status || 400);
      }
      recomputeMeeting(ag);
    }
    if (operation === "updateAGAttendee") {
      check(
        ["present", "represented", "absent"].includes(args[2]),
        "Présence invalide.",
        400,
      );
      if (!ag.votingSnapshot) Object.assign(ag, roll(b, ag.attendees));
      const attendees = ag.attendees.filter(
        (a: any) => a.residentId === args[1],
      );
      check(attendees.length, "Copropriétaire non lié.", 400);
      if (args[2] === "absent")
        check(
          !ag.resolutions.some((r: any) =>
            (r.voterChoices ?? r.voters ?? []).some(
              (v: any) => v.residentId === args[1],
            ),
          ),
          "Un votant ne peut être retiré après son vote.",
          409,
        );
      let trimmedProxyName: string | undefined;
      if (args[2] === "represented") {
        trimmedProxyName = str(args[3], 200).trim();
        check(
          trimmedProxyName.length > 0,
          "Le nom du mandataire est requis pour une procuration.",
          400,
        );
        const normalizedProxy = normalizePersonName(trimmedProxyName);
        // Law 18-00 / 106-12 Art. 16-6: Syndic (or secretary/cabinet) cannot hold proxies.
        const cabinet = (state.syndik_prod_syndics_v1 || []).find(
          (s: any) => s.id === b.syndicId,
        );
        const forbiddenHolders = [
          cabinet?.name,
          ag.secretaryName,
          "le syndic",
          "syndic",
        ]
          .map(normalizePersonName)
          .filter(Boolean);
        check(
          !forbiddenHolders.includes(normalizedProxy),
          "Conformément à la Loi 18-00 (Art. 16-6), le syndic ou le secrétaire de séance ne peut recevoir de procuration.",
          400,
        );
        // Count distinct mandants (owners) already represented by this mandataire (excluding target owner).
        const otherMandants = new Set<string>();
        let otherRepresentedTantiemes = 0;
        for (const a of ag.attendees) {
          if (
            a.residentId !== args[1] &&
            a.status === "represented" &&
            normalizePersonName(a.proxyHolderName) === normalizedProxy
          ) {
            otherMandants.add(a.residentId);
            otherRepresentedTantiemes += Number(a.tantiemes) || 0;
          }
        }
        const totalMandants = otherMandants.size + 1;
        check(
          totalMandants <= 3,
          "Conformément à la Loi 18-00 (Art. 16-6), un mandataire ne peut détenir plus de 3 procurations.",
          400,
        );
        const targetTantiemes = attendees.reduce(
          (sum: number, a: any) => sum + (Number(a.tantiemes) || 0),
          0,
        );
        const totalRepresentedTantiemes =
          otherRepresentedTantiemes + targetTantiemes;
        const maxProxyTantiemes = (Number(ag.totalTantiemes) || 1000) * 0.1;
        // Law 18-00 Art. 16-6: Cap at 10% of total votes, allowing single-mandant exception when one represented lot already exceeds 10%.
        const singleOwnerException =
          totalMandants === 1 && targetTantiemes > maxProxyTantiemes;
        check(
          totalRepresentedTantiemes <= maxProxyTantiemes + 1e-9 ||
            singleOwnerException,
          "Conformément à la Loi 18-00 (Art. 16-6), un mandataire ne peut cumuler des procurations dépassant 10% des tantièmes de la copropriété.",
          400,
        );
      }
      for (const a of attendees) {
        a.status = args[2];
        a.proxyHolderName =
          args[2] === "represented" ? trimmedProxyName : undefined;
      }
      if (ag.votingSnapshot) recomputeMeeting(ag);
      else Object.assign(ag, roll(b, ag.attendees));
    }
  }
  appendAudit(transactionState, actor, operation, b.id);
  return ag;
}
return {roll, recomputeMeeting, meetingOperation};
}



