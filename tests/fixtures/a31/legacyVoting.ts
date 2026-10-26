import type { AGResolution, AGVotingSnapshot, AssembleeGenerale } from '../../../types';

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


