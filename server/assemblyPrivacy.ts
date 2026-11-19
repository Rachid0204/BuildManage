import type { AGVotingSnapshot, AssembleeGenerale } from '../types';

/** Also projects legacy full-building snapshots without mutating persisted history. */
export function minimalVotingSnapshot(snapshot: AGVotingSnapshot): AGVotingSnapshot {
  return {
    id: snapshot.id,
    syndicId: snapshot.syndicId,
    residents: (snapshot.residents || []).map(resident => ({
      id: resident.id,
      name: resident.name,
      isOwner: resident.isOwner,
    })),
    apartments: (snapshot.apartments || []).map(lot => ({
      id: lot.id,
      number: lot.number,
      ownerId: lot.ownerId,
      tantiemes: lot.tantiemes,
    })),
  };
}

export function projectAssemblyForRole(
  assembly: AssembleeGenerale,
  role: string,
  viewerResidentId?: string,
): AssembleeGenerale {
  if (role === 'admin' || role === 'syndic') return assembly;
  const isClosed = ['completed', 'closed'].includes(assembly.status);
  const projectedSnapshot = assembly.votingSnapshot
    ? minimalVotingSnapshot(assembly.votingSnapshot)
    : undefined;
  const projectedAttendees = isClosed
    ? assembly.attendees
    : (assembly.attendees || []).map((attendee) => {
        if (!('proxyHolderName' in attendee)) return attendee;
        const { proxyHolderName: _proxy, ...rest } = attendee;
        return rest;
      });
  const projectedResolutions = isClosed
    ? assembly.resolutions
    : (assembly.resolutions || []).map((resolution) => {
        const ownBallots = (resolution.voterChoices ?? resolution.voters ?? []).filter(
          (vote) => Boolean(viewerResidentId) && vote.residentId === viewerResidentId,
        );
        return {
          ...resolution,
          ...(resolution.voterChoices !== undefined ? { voterChoices: ownBallots } : {}),
          ...(resolution.voters !== undefined ? { voters: ownBallots } : {}),
        };
      });
  return {
    ...assembly,
    ...(assembly.votingSnapshot ? { votingSnapshot: projectedSnapshot } : {}),
    attendees: projectedAttendees,
    resolutions: projectedResolutions,
  };
}
