import type { AGResolution, AssembleeGenerale, Building } from '../types';

export function evaluateResolutionStatus(res: AGResolution, ag: AssembleeGenerale): AGResolution['status'] {
  const totalTantiemes = ag.totalTantiemes || 1000;
  const maj = res.majorityType;
  const isUnanimity = maj === 'unanimity' || maj === 'unanimite';
  const isThreeQuarters = maj === 'three_quarters' || maj === 'trois_quarts_26';
  const isAbsolute = maj === 'absolute' || maj === 'absolue_25';

  // Audit Item 20: Resolution cannot be approved if quorum is not reached
  if (!ag.quorumReached) {
    if (isUnanimity && res.votesAgainst > 0) {
      return 'rejected';
    }
    return 'pending';
  }

  if (isUnanimity) {
    if (res.votesFor >= totalTantiemes) return 'approved';
    if (res.votesAgainst > 0) return 'rejected';
    return 'pending';
  }

  if (isThreeQuarters) {
    const threshold = Math.ceil(totalTantiemes * 0.75);
    if (res.votesFor >= threshold) return 'approved';
    if (res.votesAgainst > totalTantiemes - threshold) return 'rejected';
    return 'pending';
  }

  if (isAbsolute) {
    const threshold = Math.floor(totalTantiemes / 2) + 1; // 501 / 1000
    if (res.votesFor >= threshold) return 'approved';
    if (res.votesAgainst >= totalTantiemes - threshold + 1) return 'rejected';
    return 'pending';
  }

  // Majorité simple (Art. 21): majorité des voix exprimées des présents ou représentés
  const expressed = res.votesFor + res.votesAgainst;
  if (expressed > 0) {
    return res.votesFor > res.votesAgainst ? 'approved' : 'rejected';
  }
  return 'pending';
}


/** A vote is a scoped operation, never a replacement of client-provided meeting totals. */
export function applyResidentVote(
  source: AssembleeGenerale, building: Building, residentId: string, resolutionId: string,
  choice: 'for' | 'against' | 'abstain', apartmentId?: string, comment?: string
): AssembleeGenerale {
  if (!['for', 'against', 'abstain'].includes(choice)) throw new Error('Choix de vote invalide.');
  if (source.buildingId !== building.id || source.syndicId !== building.syndicId ||
      source.isVotingOpen !== true || ['completed', 'closed'].includes(source.status)) {
    throw new Error('Le scrutin est fermé.');
  }
  const owner = building.residents.find((r) => r.id === residentId && r.isOwner === true);
  const eligibleLots = building.apartments.filter((a) => a.ownerId === residentId);
  const lot = apartmentId ? eligibleLots.find((a) => a.id === apartmentId) :
    eligibleLots.length === 1 ? eligibleLots[0] : undefined;
  const attendance = source.attendees.find((a) => a.residentId === residentId && a.apartmentNumber === lot?.number);
  if (!owner || !lot || !attendance || !Number.isFinite(lot.tantiemes) || lot.tantiemes! <= 0) {
    throw new Error('Copropriétaire ou lot non éligible au vote.');
  }
  const ag = structuredClone(source);
  const resolution = ag.resolutions.find((r) => r.id === resolutionId);
  if (!resolution) throw new Error('Résolution introuvable.');
  // Preserve the existing remote owner check-in policy after verifying the actual ownership.
  const attendee = ag.attendees.find((a) => a.residentId === residentId && a.apartmentNumber === lot.number)!;
  if (attendee.status === 'absent') attendee.status = 'present';
  if (!['present', 'represented'].includes(attendee.status)) throw new Error('Présence non valide.');
  const canonical = new Map<string, NonNullable<AGResolution['voterChoices']>[number]>();
  for (const vote of resolution.voterChoices || []) {
    const actualLot = building.apartments.find((a) =>
      (vote.apartmentId ? a.id === vote.apartmentId : a.number === vote.apartmentNumber) && a.ownerId === vote.residentId);
    const present = ag.attendees.some((a) => a.residentId === vote.residentId && a.apartmentNumber === actualLot?.number &&
      ['present', 'represented'].includes(a.status));
    if (actualLot && present && Number.isFinite(actualLot.tantiemes) && actualLot.tantiemes! > 0 &&
      ['for', 'against', 'abstain'].includes(vote.choice || vote.vote)) {
      canonical.set(actualLot.id, { ...vote, apartmentId: actualLot.id, tantiemes: actualLot.tantiemes! });
    }
  }
  const now = new Date().toISOString();
  canonical.set(lot.id, { residentId, residentName: owner.name, apartmentId: lot.id, apartmentNumber: lot.number,
    tantiemes: lot.tantiemes!, choice, vote: choice, comment: comment?.slice(0, 1000), votedAt: now, castAt: now });
  resolution.voterChoices = [...canonical.values()];
  resolution.voters = resolution.voterChoices;
  const total = (v: string) => resolution.voterChoices!.filter((x) => (x.choice || x.vote) === v)
    .reduce((sum, x) => sum + x.tantiemes, 0);
  resolution.votesFor = total('for'); resolution.votesAgainst = total('against'); resolution.votesAbstain = total('abstain');
  ag.presentTantiemes = building.apartments.filter((a) => ag.attendees.some((p) => p.residentId === a.ownerId &&
    p.apartmentNumber === a.number && ['present', 'represented'].includes(p.status)))
    .reduce((sum, a) => sum + (Number.isFinite(a.tantiemes) ? a.tantiemes! : 0), 0);
  ag.quorumReached = ag.presentTantiemes >= ag.quorumRequired;
  resolution.status = evaluateResolutionStatus(resolution, ag);
  return ag;
}
