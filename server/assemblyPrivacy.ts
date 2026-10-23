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

export function projectAssemblyForRole(assembly: AssembleeGenerale, role: string): AssembleeGenerale {
  if (role === 'admin' || role === 'syndic' || !assembly.votingSnapshot) return assembly;
  return { ...assembly, votingSnapshot: minimalVotingSnapshot(assembly.votingSnapshot) };
}
