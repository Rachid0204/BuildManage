import type { AGResolution, AGVotingSnapshot, AssembleeGenerale } from '../../types';

export function evaluateResolutionStatus(resolution: AGResolution, ag: AssembleeGenerale): AGResolution['status'] {
  const totalTantiemes = ag.totalTantiemes || 1000;
  const maj = resolution.majorityType;
  const isUnanimity = maj === 'unanimity' || maj === 'unanimite';
  const isThreeQuarters = maj === 'three_quarters' || maj === 'trois_quarts_26';
  const isAbsolute = maj === 'absolute' || maj === 'absolue_25';
  const isClosed = ['completed', 'closed'].includes(ag.status);
  const isExplicitlyOpen = ['in_progress', 'planned', 'convocations_sent', 'upcoming'].includes(ag.status);
  const unapprovedStatus: AGResolution['status'] = isClosed ? 'rejected' : 'pending';
  const quorumWaived = ag.convocationNumber === 2;

  // Audit Item 20: 1st convocation requires quorum; 2nd convocation deliberates without quorum.
  if (!ag.quorumReached && !quorumWaived) {
    if (isUnanimity && resolution.votesAgainst > 0) {
      return 'rejected';
    }
    return unapprovedStatus;
  }

  if (isUnanimity) {
    if (resolution.votesFor >= totalTantiemes) return 'approved';
    if (resolution.votesAgainst > 0) return 'rejected';
    return unapprovedStatus;
  }

  if (isThreeQuarters) {
    const threshold = Math.ceil(totalTantiemes * 0.75);
    if (resolution.votesFor >= threshold) return 'approved';
    if (resolution.votesAgainst > totalTantiemes - threshold) return 'rejected';
    return unapprovedStatus;
  }

  if (isAbsolute) {
    const threshold = Math.floor(totalTantiemes / 2) + 1; // 501 / 1000
    if (resolution.votesFor >= threshold) return 'approved';
    if (resolution.votesAgainst >= totalTantiemes - threshold + 1) return 'rejected';
    return unapprovedStatus;
  }

  // Majorité simple (Art. 21): majorité des voix exprimées des présents ou représentés.
  // While open, only lock an outcome if it is mathematically unbeatable across all building tantièmes.
  if (isExplicitlyOpen) {
    if (resolution.votesFor > totalTantiemes / 2) return 'approved';
    if (resolution.votesAgainst >= totalTantiemes / 2) return 'rejected';
    return 'pending';
  }
  const expressed = resolution.votesFor + resolution.votesAgainst;
  if (expressed > 0) {
    return resolution.votesFor > resolution.votesAgainst ? 'approved' : 'rejected';
  }
  return unapprovedStatus;
}


export function canonicalQuorum(total: number): number { return Math.floor(total / 2) + 1; }
export function legacyQuorum(total: number): number { return Math.ceil((total || 1000) / 2); }

/** Sum captured weights without rounding or consulting current building ownership. */
export function presentVotingWeight(attendees: readonly { status: string; tantiemes: number }[]): number {
  return attendees.filter(a => ['present', 'represented'].includes(a.status))
    .reduce((sum, a) => sum + a.tantiemes, 0);
}
