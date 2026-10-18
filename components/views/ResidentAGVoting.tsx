import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, AssembleeGenerale, Syndic, Resident, Apartment, AGResolution } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { AGIcon, DocumentsIcon, QuittanceIcon } from '../icons/IconComponents';
import { getAssembleesGeneralesForBuilding, castResidentAGVote } from '../../firebase/services';
import { generatePvAgPDF } from '../../services/pdfService';
import Loading from '../common/Loading';

interface ResidentAGVotingProps {
  building: Building;
  currentResident?: Resident;
  currentApartment?: Apartment;
  syndic?: Syndic;
}

export const ResidentAGVoting: React.FC<ResidentAGVotingProps> = ({
  building,
  currentResident,
  currentApartment,
  syndic,
}) => {
  const queryClient = useQueryClient();
  const [selectedAGId, setSelectedAGId] = useState<string | null>(null);
  const [editingResolutionId, setEditingResolutionId] = useState<string | null>(null);
  const [voteChoice, setVoteChoice] = useState<'for' | 'against' | 'abstain'>('for');
  const [voteComment, setVoteComment] = useState('');
  const [viewVotersResolution, setViewVotersResolution] = useState<AGResolution | null>(null);
  const [showLawInfoModal, setShowLawInfoModal] = useState(false);

  // Fetch AGs for this building
  const { data: agList = [], isLoading } = useQuery({
    queryKey: ['ag', building.id],
    queryFn: () => getAssembleesGeneralesForBuilding(building.id),
  });

  const activeAG = selectedAGId
    ? agList.find((ag) => ag.id === selectedAGId) || agList[0]
    : agList[0];

  // Resolve resident's tantièmes
  const residentTantiemes = currentApartment?.tantiemes || 100;
  const residentLotNumber = currentApartment?.number || 'A-102';
  const residentName = currentResident?.name || 'Copropriétaire';

  // Digital Vote Mutation
  const voteMutation = useMutation({
    mutationFn: async ({
      agId,
      resolutionId,
      vote,
      comment,
    }: {
      agId: string;
      resolutionId: string;
      vote: 'for' | 'against' | 'abstain';
      comment?: string;
    }) => {
      if (!currentResident || !currentApartment) {
        throw new Error('Profil copropriétaire introuvable');
      }
      return castResidentAGVote(
        agId,
        resolutionId,
        currentResident.id,
        currentResident.name,
        currentApartment.id,
        currentApartment.number,
        residentTantiemes,
        vote,
        comment
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ag', building.id] });
      setEditingResolutionId(null);
      setVoteComment('');
    },
  });

  const handleStartVote = (resolution: AGResolution) => {
    const existingVote = resolution.voters?.find((v) => v.residentId === currentResident?.id);
    setVoteChoice(existingVote ? existingVote.vote : 'for');
    setVoteComment(existingVote?.comment || '');
    setEditingResolutionId(resolution.id);
  };

  const handleConfirmVote = (resolutionId: string) => {
    if (!activeAG) return;
    voteMutation.mutate({
      agId: activeAG.id,
      resolutionId,
      vote: voteChoice,
      comment: voteComment.trim() || undefined,
    });
  };

  if (isLoading) {
    return <Loading message="Chargement des sessions d'assemblée générale..." />;
  }

  if (!activeAG) {
    return (
      <Card className="p-8 text-center space-y-3 bg-white border border-slate-200">
        <div className="w-12 h-12 rounded-full bg-teal-50 text-teal-700 flex items-center justify-center mx-auto">
          <AGIcon />
        </div>
        <h3 className="text-base font-bold text-slate-800">Aucune Assemblée Générale en cours</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Le syndic n'a pas encore convoqué d'assemblée générale pour la copropriété {building.name}.
          Vous recevrez une notification officielle dès l'ouverture des votes électroniques.
        </p>
      </Card>
    );
  }

  // Count how many resolutions this resident has already voted on
  const totalResolutions = activeAG.resolutions.length;
  const votedResolutionsCount = activeAG.resolutions.filter((r) =>
    r.voters?.some((v) => v.residentId === currentResident?.id)
  ).length;
  const isVotingCompleted = totalResolutions > 0 && votedResolutionsCount === totalResolutions;

  return (
    <div className="space-y-6">
      {/* Top Banner: Co-ownership Rights & Session Overview */}
      <Card className="bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 text-white p-6 border-none shadow-md">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider bg-teal-700/80 text-teal-100 px-2.5 py-0.5 rounded-full border border-teal-500/30">
                Loi n° 18-00 · Art. 21 à 24
              </span>
              <span className="text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                Vote Électronique Ouvert
              </span>
              <span className="text-xs text-teal-200">
                {activeAG.type === 'AGO' ? 'Assemblée Générale Ordinaire' : 'Assemblée Générale Extraordinaire'}
              </span>
            </div>

            <h2 className="text-xl font-bold tracking-tight text-white">{activeAG.title}</h2>
            <p className="text-xs text-teal-100/90 leading-relaxed max-w-2xl">
              Exprimez vos votes sur les résolutions de la copropriété {building.name}. Conformément à la législation
              marocaine, chaque décision est pondérée au prorata exact des tantièmes de votre lot privatif.
            </p>

            <div className="flex flex-wrap items-center gap-4 text-xs text-teal-200 pt-1">
              <span>📅 Séance : <strong>{new Date(activeAG.date).toLocaleDateString('fr-MA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} à {activeAG.time}</strong></span>
              <span>📍 Lieu : <strong>{activeAG.location}</strong></span>
              <span>🏢 Syndic : <strong>{syndic?.name || 'Syndic'}</strong></span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row md:flex-col items-end gap-2.5 shrink-0">
            <Button
              variant="secondary"
              onClick={() => generatePvAgPDF(activeAG, building, syndic)}
              className="text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 flex items-center gap-1.5"
            >
              <DocumentsIcon />
              <span>Télécharger le PV / Ordre du jour (PDF)</span>
            </Button>
            <button
              onClick={() => setShowLawInfoModal(true)}
              className="text-[11px] text-teal-300 hover:text-white underline"
            >
              Comprendre la règle des tantièmes (Loi 18-00)
            </button>
          </div>
        </div>

        {/* Quorum Progress Bar */}
        <div className="mt-5 pt-4 border-t border-teal-700/60 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-8 space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-teal-200 font-medium">Participation & Quorum légal en séance :</span>
              <span className="font-mono font-bold text-white">
                {activeAG.presentTantiemes} / {activeAG.totalTantiemes || 1000} tantièmes ({Math.round(((activeAG.presentTantiemes || 0) / (activeAG.totalTantiemes || 1000)) * 100)}%)
              </span>
            </div>
            <div className="w-full bg-teal-950/60 rounded-full h-2.5 overflow-hidden border border-teal-600/40">
              <div
                className={`h-full transition-all duration-500 ${
                  activeAG.quorumReached ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
                style={{
                  width: `${Math.min(100, ((activeAG.presentTantiemes || 0) / (activeAG.totalTantiemes || 1000)) * 100)}%`,
                }}
              />
            </div>
            <div className="flex justify-between items-center text-[11px] text-teal-300">
              <span>{activeAG.quorumReached ? '✓ Quorum de 1ère convocation atteint (> 50%)' : '⚠ Quorum en cours de consolidation'}</span>
              <span>Seuil requis : 500/1000 tantièmes</span>
            </div>
          </div>

          <div className="md:col-span-4 bg-teal-950/40 p-3 rounded-lg border border-teal-600/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-teal-300 uppercase tracking-wider block font-semibold">
                Votre Avancement
              </span>
              <span className="text-sm font-bold text-white">
                {votedResolutionsCount} / {totalResolutions} résolution{totalResolutions > 1 ? 's' : ''} votée{votedResolutionsCount > 1 ? 's' : ''}
              </span>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                isVotingCompleted
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              }`}
            >
              {isVotingCompleted ? 'Scrutin Complet ✓' : 'Vote en attente'}
            </span>
          </div>
        </div>
      </Card>

      {/* Resident Voting Power Mandate Card */}
      <Card className="p-4 bg-white border border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center font-bold text-base shrink-0">
              🗳️
            </div>
            <div>
              <div className="text-xs text-slate-500 font-medium">Votre Pouvoir de Vote Légal</div>
              <div className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>{residentName}</span>
                <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                  Lot {residentLotNumber}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm">
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-center">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Tantièmes attribués</span>
              <span className="font-mono font-bold text-teal-800 text-base">{residentTantiemes}</span>
              <span className="text-[10px] text-slate-500"> / 1000èmes</span>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-center">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">Poids relatif</span>
              <span className="font-mono font-bold text-slate-900 text-base">
                {((residentTantiemes / 1000) * 100).toFixed(1)}%
              </span>
              <span className="text-[10px] text-slate-500"> du scrutin</span>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 text-center">
              <span className="text-[10px] text-emerald-600 block font-semibold uppercase">Statut Électoral</span>
              <span className="font-bold text-emerald-800 text-xs">Électeur Actif</span>
              <span className="text-[10px] text-emerald-600 block">Loi n° 18-00</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Resolutions List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900 text-base">Ordre du Jour & Résolutions Soumises au Vote</h3>
            <p className="text-xs text-slate-500">
              Chaque vote est automatiquement comptabilisé et pondéré avec vos <strong>{residentTantiemes} tantièmes</strong>
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {activeAG.resolutions.length} résolution{activeAG.resolutions.length > 1 ? 's' : ''}
          </span>
        </div>

        {activeAG.resolutions.map((res) => {
          const totalTantiemesCast = res.votesFor + res.votesAgainst + res.votesAbstain;
          const myVote = res.voters?.find((v) => v.residentId === currentResident?.id);
          const isEditing = editingResolutionId === res.id;
          const percentFor = totalTantiemesCast > 0 ? Math.round((res.votesFor / totalTantiemesCast) * 100) : 0;
          const percentAgainst = totalTantiemesCast > 0 ? Math.round((res.votesAgainst / totalTantiemesCast) * 100) : 0;

          // Legal majority threshold text
          const majorityLabel =
            res.majorityType === 'simple'
              ? 'Majorité simple (Art. 21) · Majorité des voix exprimées'
              : res.majorityType === 'absolute'
              ? 'Majorité absolue (Art. 22) · Au moins 501 / 1000 tantièmes'
              : 'Unanimité (Art. 23) · 1000 / 1000 tantièmes';

          return (
            <Card key={res.id} className="p-5 border border-slate-200 space-y-4 bg-white transition-all shadow-xs">
              {/* Header: Resolution N°, Title, Status */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded">
                      Résolution N° {res.number}
                    </span>
                    <span className="text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                      {majorityLabel}
                    </span>
                  </div>
                  <h4 className="font-bold text-slate-900 text-base">{res.title}</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">{res.description}</p>
                </div>

                {/* Resolution Status Badge */}
                <div className="shrink-0 flex items-center gap-2">
                  <span
                    className={`text-xs px-3 py-1 rounded-full font-bold border ${
                      res.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                        : res.status === 'rejected'
                        ? 'bg-rose-50 text-rose-800 border-rose-300'
                        : 'bg-amber-50 text-amber-800 border-amber-300'
                    }`}
                  >
                    {res.status === 'approved' ? '✓ Adoptée' : res.status === 'rejected' ? '✗ Rejetée' : 'En délibération'}
                  </span>
                </div>
              </div>

              {/* Tally Bar (Weighted by Tantièmes) */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                <div className="flex flex-wrap justify-between items-center text-xs font-mono">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-emerald-700 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      POUR : {res.votesFor} tantièmes ({percentFor}%)
                    </span>
                    <span className="font-bold text-rose-700 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      CONTRE : {res.votesAgainst} tantièmes ({percentAgainst}%)
                    </span>
                    <span className="text-slate-500">
                      ABSTENTION : {res.votesAbstain} tantièmes
                    </span>
                  </div>
                  <span className="text-slate-500 text-[11px]">
                    Total exprimé : <strong>{totalTantiemesCast} / 1000</strong>
                  </span>
                </div>

                {/* Visual Progress Bar */}
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden flex shadow-inner">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300"
                    style={{ width: `${percentFor}%` }}
                    title={`Pour : ${res.votesFor} tantièmes`}
                  />
                  <div
                    className="bg-rose-500 h-full transition-all duration-300"
                    style={{ width: `${percentAgainst}%` }}
                    title={`Contre : ${res.votesAgainst} tantièmes`}
                  />
                  <div
                    className="bg-slate-400 h-full transition-all duration-300"
                    style={{
                      width: `${totalTantiemesCast > 0 ? Math.round((res.votesAbstain / totalTantiemesCast) * 100) : 0}%`,
                    }}
                    title={`Abstention : ${res.votesAbstain} tantièmes`}
                  />
                </div>
              </div>

              {/* Resident's Digital Vote Status & Action Area */}
              <div className="pt-2 border-t border-slate-100">
                {myVote && !isEditing ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-teal-50/60 p-3.5 rounded-xl border border-teal-200">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-teal-900">Votre Vote Enregistré :</span>
                        <span
                          className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                            myVote.vote === 'for'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : myVote.vote === 'against'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-slate-200 text-slate-800'
                          }`}
                        >
                          {myVote.vote === 'for'
                            ? '✓ POUR (+ ' + myVote.tantiemes + ' tantièmes)'
                            : myVote.vote === 'against'
                            ? '✗ CONTRE (+ ' + myVote.tantiemes + ' tantièmes)'
                            : '— ABSTENTION (' + myVote.tantiemes + ' tantièmes)'}
                        </span>
                      </div>
                      <p className="text-[11px] text-teal-800/80 font-mono">
                        Validé le {new Date(myVote.castAt).toLocaleString('fr-MA')} · Pondération : {myVote.tantiemes}/1000 tantièmes
                      </p>
                      {myVote.comment && (
                        <p className="text-xs text-slate-700 italic bg-white p-2 rounded border border-teal-100 mt-1">
                          « {myVote.comment} »
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleStartVote(res)}
                        className="text-xs px-3 py-1.5 bg-white hover:bg-teal-100 text-teal-800 font-semibold rounded-lg border border-teal-300 transition-colors shadow-xs"
                      >
                        Modifier mon vote
                      </button>
                      <button
                        onClick={() => setViewVotersResolution(res)}
                        className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                      >
                        Votants ({res.voters?.length || 0})
                      </button>
                    </div>
                  </div>
                ) : isEditing ? (
                  /* Voting Form */
                  <div className="bg-slate-50 p-4 rounded-xl border border-teal-300 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <span>🗳️</span>
                        <span>Exprimez votre vote pour la Résolution N° {res.number}</span>
                      </span>
                      <span className="text-xs text-teal-800 font-mono font-bold">
                        Poids : {residentTantiemes} tantièmes
                      </span>
                    </div>

                    {/* 3 Option Buttons */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        onClick={() => setVoteChoice('for')}
                        className={`p-3 rounded-xl border-2 text-center transition-all flex flex-col items-center justify-center gap-1 ${
                          voteChoice === 'for'
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-bold shadow-xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/40'
                        }`}
                      >
                        <span className="text-lg">🟢</span>
                        <span className="text-xs font-bold">VOTER POUR</span>
                        <span className="text-[11px] text-emerald-700 font-mono">
                          +{residentTantiemes} tantièmes
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setVoteChoice('against')}
                        className={`p-3 rounded-xl border-2 text-center transition-all flex flex-col items-center justify-center gap-1 ${
                          voteChoice === 'against'
                            ? 'border-rose-600 bg-rose-50 text-rose-900 font-bold shadow-xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-rose-300 hover:bg-rose-50/40'
                        }`}
                      >
                        <span className="text-lg">🔴</span>
                        <span className="text-xs font-bold">VOTER CONTRE</span>
                        <span className="text-[11px] text-rose-700 font-mono">
                          +{residentTantiemes} tantièmes
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setVoteChoice('abstain')}
                        className={`p-3 rounded-xl border-2 text-center transition-all flex flex-col items-center justify-center gap-1 ${
                          voteChoice === 'abstain'
                            ? 'border-slate-600 bg-slate-200 text-slate-900 font-bold shadow-xs'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-100'
                        }`}
                      >
                        <span className="text-lg">⚪</span>
                        <span className="text-xs font-bold">S'ABSTENIR</span>
                        <span className="text-[11px] text-slate-600 font-mono">
                          {residentTantiemes} tantièmes
                        </span>
                      </button>
                    </div>

                    {/* Optional Note */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Observation ou réserve au procès-verbal (facultatif - Loi 18-00) :
                      </label>
                      <input
                        type="text"
                        value={voteComment}
                        onChange={(e) => setVoteComment(e.target.value)}
                        placeholder="Ex: Vote favorable sous réserve du maintien de la garantie décennale..."
                        className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-teal-500 bg-white"
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      {myVote && (
                        <Button
                          variant="secondary"
                          onClick={() => setEditingResolutionId(null)}
                          className="text-xs"
                        >
                          Annuler
                        </Button>
                      )}
                      <Button
                        onClick={() => handleConfirmVote(res.id)}
                        disabled={voteMutation.isPending}
                        className="text-xs bg-teal-700 hover:bg-teal-800 text-white font-bold px-4 py-2"
                      >
                        {voteMutation.isPending
                          ? 'Enregistrement sécurisé...'
                          : `Confirmer mon vote (${residentTantiemes} tantièmes)`}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Initial state when not voted yet */
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50/60 p-3.5 rounded-xl border border-amber-200">
                    <div>
                      <div className="text-xs font-bold text-amber-900">
                        Votre vote n'a pas encore été enregistré sur cette résolution
                      </div>
                      <p className="text-[11px] text-amber-800">
                        Cliquez pour faire valoir vos <strong>{residentTantiemes} tantièmes</strong> de copropriété.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        onClick={() => handleStartVote(res)}
                        className="text-xs bg-teal-700 hover:bg-teal-800 font-bold flex items-center gap-1.5 shadow-xs"
                      >
                        <span>🗳️</span>
                        <span>Voter maintenant (+{residentTantiemes})</span>
                      </Button>
                      <button
                        onClick={() => setViewVotersResolution(res)}
                        className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                      >
                        Votants ({res.voters?.length || 0})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Modal: View Voters for a Resolution */}
      {viewVotersResolution && (
        <Modal
          isOpen={!!viewVotersResolution}
          onClose={() => setViewVotersResolution(null)}
          title={`Registre des Votes · Résolution N° ${viewVotersResolution.number}`}
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setViewVotersResolution(null)}>
                Fermer
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">{viewVotersResolution.title}</h4>
              <p className="text-xs text-slate-600 mt-0.5">{viewVotersResolution.description}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Copropriétaire</th>
                    <th className="px-3 py-2 text-left">Lot</th>
                    <th className="px-3 py-2 text-center">Poids Légal</th>
                    <th className="px-3 py-2 text-center">Vote Exprimé</th>
                    <th className="px-3 py-2 text-left">Date / Remarque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {viewVotersResolution.voters?.map((v, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {v.residentName}
                        {v.residentId === currentResident?.id && (
                          <span className="ms-1.5 text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded font-semibold">
                            Vous
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-700">{v.apartmentNumber}</td>
                      <td className="px-3 py-2 text-center font-mono font-bold text-teal-800">
                        {v.tantiemes} / 1000
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                            v.vote === 'for'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : v.vote === 'against'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {v.vote === 'for' ? 'POUR' : v.vote === 'against' ? 'CONTRE' : 'ABSTENTION'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">
                        {new Date(v.castAt).toLocaleString('fr-MA')}
                        {v.comment && <div className="text-slate-700 italic font-sans mt-0.5">« {v.comment} »</div>}
                      </td>
                    </tr>
                  ))}

                  {(!viewVotersResolution.voters || viewVotersResolution.voters.length === 0) && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                        Aucun vote n'a encore été enregistré sur cette résolution.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Legal Explanations of Moroccan Co-ownership Voting */}
      {showLawInfoModal && (
        <Modal
          isOpen={showLawInfoModal}
          onClose={() => setShowLawInfoModal(false)}
          title="Règles Juridiques du Vote en Copropriété (Loi 18-00 & 106-12)"
          footer={
            <div className="flex justify-end">
              <Button onClick={() => setShowLawInfoModal(false)}>J'ai compris</Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
            <div className="p-3 bg-teal-50 rounded-lg border border-teal-200 text-teal-900">
              <p className="font-bold text-sm mb-1">Article 21 - Principe de la pondération par tantièmes</p>
              <p>
                Chaque copropriétaire dispose d'un nombre de voix proportionnel à la quote-part de ses parties privatives
                dans l'ensemble de l'immeuble. La base de calcul usuelle est de <strong>1 000 tantièmes</strong>.
              </p>
            </div>

            <div className="space-y-2">
              <h5 className="font-bold text-slate-900 text-sm">Les Trois Régimes de Majorité Légale :</h5>
              <div className="border border-slate-200 rounded-lg p-2.5">
                <span className="font-bold text-slate-900 block">1. Majorité Simple (Article 21)</span>
                <p className="text-slate-600 mt-0.5">
                  Approbation des comptes, quitus de gestion, budget prévisionnel d'exploitation courante, petits travaux d'entretien.
                  Adoptée si les tantièmes « POUR » dépassent les « CONTRE » parmi les voix exprimées.
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-2.5">
                <span className="font-bold text-slate-900 block">2. Majorité Absolue (Article 22)</span>
                <p className="text-slate-600 mt-0.5">
                  Gros travaux d'amélioration, réfection étanchéité ou ascenseur, modification du règlement de copropriété.
                  Nécessite au moins <strong>501 / 1000 tantièmes</strong> de la totalité de la copropriété.
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-2.5">
                <span className="font-bold text-slate-900 block">3. Unanimité (Article 23)</span>
                <p className="text-slate-600 mt-0.5">
                  Aliénation d'une partie commune, surélévation, changement de destination de l'immeuble.
                  Requiert <strong>1 000 / 1 000 tantièmes</strong>.
                </p>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ResidentAGVoting;
