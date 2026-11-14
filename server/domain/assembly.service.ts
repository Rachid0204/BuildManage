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
    const targets = targetBuilding.apartments
      .filter((a: any) => !a.archivedAt)
      .map((apt) => ({ apt, residentId: billingPayer(targetBuilding!, apt) }));
    targets.forEach(({ apt, residentId }) =>
      requireBudgetPayer(apt, residentId),
    );
    const lots = targets.map(({ apt: a }) => ({
      id: a.id,
      tantiemes: a.tantiemes ?? 100,
    }));
    const allocations = allocateBudgetInCentimes(
      budgetMad,
      lots,
      targetBuilding.totalTantiemes ?? 1000,
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
import {
  canonicalQuorum,
  presentVotingWeight,
} from '../../shared/domain/voting';
import { minimalVotingSnapshot } from '../assemblyPrivacy';
import type { State } from '../repository';
import type { CommandDependencies } from './dependencies';
import type { Actor } from './errors';


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
    for (const v of r.voterChoices || []) {
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
            r.generatesCharges,
          ]),
          old.resolutions.map((r: any) => [
            r.id,
            r.title,
            r.description,
            r.majorityType,
            r.budgetAmount,
            r.generatesCharges,
          ]),
        ),
        "Résolutions figées après ouverture.",
        409,
      );
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
          ...(r.generatesCharges !== undefined ? { generatesCharges: z.boolean().parse(r.generatesCharges) } : {}),
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
      Object.assign(
        ag,
        applyResidentVote(
          ag,
          ag.votingSnapshot || b,
          str(voter.residentId),
          str(args[1]),
          args[2],
          voter.apartmentId ? str(voter.apartmentId) : undefined,
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
      if (!ag.votingSnapshot) Object.assign(ag, roll(b, ag.attendees));
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
  appendAudit(transactionState, actor, operation, b.id);
  return ag;
}
return {roll, recomputeMeeting, meetingOperation};
}



