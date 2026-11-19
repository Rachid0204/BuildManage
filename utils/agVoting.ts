import type { AGResolution, AGVotingSnapshot, AssembleeGenerale } from '../types';
import { canonicalQuorum, evaluateResolutionStatus } from '../shared/domain/voting';
export { evaluateResolutionStatus } from '../shared/domain/voting';

export interface ApplyVoteOptions {
  actorRole?: 'resident' | 'syndic' | 'admin';
  actorUid?: string;
  allowOverrideResidentVote?: boolean;
}

/** A vote is a scoped operation, never a replacement of client-provided meeting totals. */
export function applyResidentVote(
  source: AssembleeGenerale,
  building: AGVotingSnapshot,
  residentId: string,
  resolutionId: string,
  choice: 'for' | 'against' | 'abstain',
  apartmentId?: string,
  comment?: string,
  options?: ApplyVoteOptions,
): AssembleeGenerale {
  if (!['for', 'against', 'abstain'].includes(choice)) throw new Error('Choix de vote invalide.');
  if (
    source.buildingId !== building.id ||
    source.syndicId !== building.syndicId ||
    source.isVotingOpen !== true ||
    ['completed', 'closed'].includes(source.status)
  ) {
    throw new Error('Le scrutin est fermé.');
  }
  const owner = building.residents.find((r) => r.id === residentId && r.isOwner === true);
  const eligibleLots = building.apartments.filter((a) => a.ownerId === residentId);
  const lot = apartmentId
    ? eligibleLots.find((a) => a.id === apartmentId)
    : eligibleLots.length === 1
      ? eligibleLots[0]
      : undefined;
  const matchAttendee = (a: AssembleeGenerale['attendees'][number], targetLot?: typeof lot) =>
    a.residentId === residentId &&
    Boolean(targetLot) &&
    (a.apartmentId ? a.apartmentId === targetLot!.id : a.apartmentNumber === targetLot!.number);
  const attendance = source.attendees.find((a) => matchAttendee(a, lot));
  if (!owner || !lot || !attendance || !Number.isFinite(lot.tantiemes) || lot.tantiemes! <= 0) {
    throw new Error('Copropriétaire ou lot non éligible au vote.');
  }
  const ag = structuredClone(source);
  const resolution = ag.resolutions.find((r) => r.id === resolutionId);
  if (!resolution) throw new Error('Résolution introuvable.');
  const attendee = ag.attendees.find((a) => matchAttendee(a, lot))!;
  const actorRole = options?.actorRole ?? 'resident';
  if (attendee.status === 'absent') {
    if (actorRole === 'resident') {
      // Remote owner self-voting checks them in as present.
      attendee.status = 'present';
    } else {
      throw new Error(
        'Le copropriétaire doit être marqué présent ou représenté sur la feuille de présence avant d’enregistrer un vote en séance.',
      );
    }
  }
  if (!['present', 'represented'].includes(attendee.status)) throw new Error('Présence non valide.');
  const canonical = new Map<string, NonNullable<AGResolution['voterChoices']>[number]>();
  const existingBallots = resolution.voterChoices ?? resolution.voters ?? [];
  for (const vote of existingBallots) {
    const actualLot = building.apartments.find(
      (a) =>
        (vote.apartmentId ? a.id === vote.apartmentId : a.number === vote.apartmentNumber) &&
        a.ownerId === vote.residentId,
    );
    const present = ag.attendees.some(
      (a) =>
        a.residentId === vote.residentId &&
        Boolean(actualLot) &&
        (a.apartmentId ? a.apartmentId === actualLot!.id : a.apartmentNumber === actualLot!.number) &&
        ['present', 'represented'].includes(a.status),
    );
    if (
      actualLot &&
      present &&
      Number.isFinite(actualLot.tantiemes) &&
      actualLot.tantiemes! > 0 &&
      ['for', 'against', 'abstain'].includes(vote.choice || vote.vote || '')
    ) {
      canonical.set(actualLot.id, { ...vote, apartmentId: actualLot.id, tantiemes: actualLot.tantiemes! });
    }
  }
  const priorForLot = canonical.get(lot.id);
  if (
    actorRole !== 'resident' &&
    priorForLot?.castByRole === 'resident' &&
    !options?.allowOverrideResidentVote
  ) {
    throw new Error(
      'Ce copropriétaire a déjà voté électroniquement pour ce lot. Confirmez explicitement la rectification si nécessaire.',
    );
  }
  const now = new Date().toISOString();
  canonical.set(lot.id, {
    residentId,
    residentName: owner.name,
    apartmentId: lot.id,
    apartmentNumber: lot.number,
    tantiemes: lot.tantiemes!,
    choice,
    vote: choice,
    comment: comment?.slice(0, 1000),
    votedAt: now,
    castAt: now,
    castByRole: actorRole,
    ...(options?.actorUid ? { castByUid: options.actorUid } : {}),
    ...(attendee.status === 'represented' && attendee.proxyHolderName
      ? { proxyHolderName: attendee.proxyHolderName }
      : {}),
  });
  resolution.voterChoices = [...canonical.values()];
  resolution.voters = resolution.voterChoices;
  const total = (v: string) =>
    resolution.voterChoices!
      .filter((x) => (x.choice || x.vote) === v)
      .reduce((sum, x) => sum + x.tantiemes, 0);
  resolution.votesFor = total('for');
  resolution.votesAgainst = total('against');
  resolution.votesAbstain = total('abstain');
  ag.presentTantiemes = building.apartments
    .filter((a) =>
      ag.attendees.some(
        (p) =>
          p.residentId === a.ownerId &&
          (p.apartmentId ? p.apartmentId === a.id : p.apartmentNumber === a.number) &&
          ['present', 'represented'].includes(p.status),
      ),
    )
    .reduce((sum, a) => sum + (Number.isFinite(a.tantiemes) ? a.tantiemes! : 0), 0);
  const effectiveQuorumRequired = ag.quorumRequired ?? canonicalQuorum(ag.totalTantiemes || 1000);
  ag.quorumRequired = effectiveQuorumRequired;
  ag.quorumReached = ag.presentTantiemes >= effectiveQuorumRequired;
  resolution.status = evaluateResolutionStatus(resolution, ag);
  return ag;
}


