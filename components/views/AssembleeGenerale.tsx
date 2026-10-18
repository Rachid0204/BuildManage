import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, AssembleeGenerale, Syndic, AGResolution, AGVoteCast } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { useI18n } from '../../hooks/useI18n';
import { AGIcon, PlusIcon, DocumentsIcon } from '../icons/IconComponents';
import {
  getAssembleesGeneralesForBuilding,
  saveAssembleeGenerale,
  updateAGAttendee,
  castResidentAGVote,
  toggleAGVoting,
} from '../../firebase/services';
import { generatePvAgPDF } from '../../services/pdfService';
import Loading from '../common/Loading';

interface AssembleeGeneraleProps {
  building: Building;
  syndic?: Syndic;
}

const AssembleeGeneraleView: React.FC<AssembleeGeneraleProps> = ({ building, syndic }) => {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<'AGO' | 'AGE'>('AGO');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newTime, setNewTime] = useState('18:30');
  const [newLocation, setNewLocation] = useState(`Hall d'entrée - ${building.name}`);
  const [agendaInput, setAgendaInput] = useState(
    "1. Approbation du rapport moral et financier\n2. Quitus de gestion au Syndic\n3. Vote du budget prévisionnel de l'exercice\n4. Constitution du Fonds de réserve pour travaux (Loi 106-12)\n5. Travaux d'étanchéité de la toiture-terrasse"
  );

  // In-session vote casting state
  const [isRecordVoteModalOpen, setIsRecordVoteModalOpen] = useState(false);
  const [selectedResolutionForVote, setSelectedResolutionForVote] = useState<AGResolution | null>(null);
  const [selectedResidentIdForVote, setSelectedResidentIdForVote] = useState<string>('');
  const [inSessionVoteChoice, setInSessionVoteChoice] = useState<'for' | 'against' | 'abstain'>('for');
  const [inSessionVoteComment, setInSessionVoteComment] = useState('');

  // Resolution filtering & voters expansion state
  const [resolutionFilter, setResolutionFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [viewVotersResolution, setViewVotersResolution] = useState<AGResolution | null>(null);

  const { data: agList = [], isLoading } = useQuery({
    queryKey: ['ag', building.id],
    queryFn: () => getAssembleesGeneralesForBuilding(building.id),
  });

  const activeAG = useMemo(() => {
    if (!agList.length) return null;
    if (activeSessionId) return agList.find((a) => a.id === activeSessionId) || agList[0];
    return agList[0];
  }, [agList, activeSessionId]);

  const saveAGMutation = useMutation({
    mutationFn: saveAssembleeGenerale,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ag', building.id] });
      setIsCreateModalOpen(false);
    },
  });

  const attendeeMutation = useMutation({
    mutationFn: (data: { agId: string; residentId: string; status: 'present' | 'represented' | 'absent'; proxy?: string }) =>
      updateAGAttendee(data.agId, data.residentId, data.status, data.proxy),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ag', building.id] }),
  });

  const toggleVotingMutation = useMutation({
    mutationFn: (isOpen: boolean) => {
      if (!activeAG) throw new Error('Aucune AG active');
      return toggleAGVoting(activeAG.id, isOpen);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ag', building.id] }),
  });

  const castVoteMutation = useMutation({
    mutationFn: (data: {
      agId: string;
      resolutionId: string;
      residentId: string;
      residentName: string;
      apartmentId: string;
      apartmentNumber: string;
      tantiemes: number;
      vote: 'for' | 'against' | 'abstain';
      comment?: string;
    }) =>
      castResidentAGVote(
        data.agId,
        data.resolutionId,
        data.residentId,
        data.residentName,
        data.apartmentId,
        data.apartmentNumber,
        data.tantiemes,
        data.vote,
        data.comment
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ag', building.id] });
      setIsRecordVoteModalOpen(false);
      setInSessionVoteComment('');
    },
  });

  const handleOpenRecordVoteModal = (resolution: AGResolution) => {
    setSelectedResolutionForVote(resolution);
    // Default to first resident
    const defaultRes = building.residents[0];
    setSelectedResidentIdForVote(defaultRes?.id || '');
    setInSessionVoteChoice('for');
    setInSessionVoteComment('');
    setIsRecordVoteModalOpen(true);
  };

  const handleConfirmInSessionVote = () => {
    if (!activeAG || !selectedResolutionForVote || !selectedResidentIdForVote) return;
    const res = building.residents.find((r) => r.id === selectedResidentIdForVote);
    const apt = building.apartments.find((a) => a.ownerId === res?.id || a.id === res?.apartmentId);
    if (!res) return;

    const tantiemes = apt?.tantiemes || 100;
    castVoteMutation.mutate({
      agId: activeAG.id,
      resolutionId: selectedResolutionForVote.id,
      residentId: res.id,
      residentName: res.name,
      apartmentId: apt?.id || '',
      apartmentNumber: apt?.number || 'Lot',
      tantiemes,
      vote: inSessionVoteChoice,
      comment: inSessionVoteComment.trim() || undefined,
    });
  };

  const handleCreateAG = () => {
    if (!newTitle) return alert("Veuillez renseigner le titre de l'assemblée.");

    const initialAttendees = building.residents.map((res) => {
      const apt = building.apartments.find((a) => a.id === res.apartmentId || a.ownerId === res.id);
      return {
        residentId: res.id,
        residentName: res.name,
        apartmentId: apt?.id || '',
        apartmentNumber: apt?.number || 'Lot',
        tantiemes: apt?.tantiemes || 100,
        status: 'absent' as const,
      };
    });

    const parsedAgenda = agendaInput
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const initialResolutions: AGResolution[] = parsedAgenda.map((item, idx) => ({
      id: `res-${Date.now()}-${idx}`,
      number: idx + 1,
      title: item.replace(/^\d+[\.\-]\s*/, ''),
      description: `Délibération et vote de l'assemblée concernant : ${item}`,
      majorityType: idx === 0 || idx === 1 ? 'simple' : idx === 4 ? 'absolute' : 'simple',
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      status: 'pending',
    }));

    const newAG: AssembleeGenerale = {
      id: `ag-${Date.now()}`,
      buildingId: building.id,
      syndicId: building.syndicId,
      title: newTitle,
      type: newType,
      date: newDate,
      time: newTime,
      location: newLocation,
      status: 'in_progress',
      isVotingOpen: true,
      quorumRequired: 500,
      totalTantiemes: building.totalTantiemes || 1000,
      presentTantiemes: 0,
      quorumReached: false,
      agendaItems: parsedAgenda,
      resolutions: initialResolutions,
      attendees: initialAttendees,
      presidentName: building.managerName || 'Président élu en séance',
      secretaryName: syndic?.name || 'Le Syndic',
    };

    saveAGMutation.mutate(newAG);
  };

  // Filter resolutions
  const filteredResolutions = useMemo(() => {
    if (!activeAG) return [];
    if (resolutionFilter === 'all') return activeAG.resolutions;
    return activeAG.resolutions.filter((r) => r.status === resolutionFilter);
  }, [activeAG, resolutionFilter]);

  if (isLoading) return <Loading message="Chargement des assemblées générales..." />;

  // Calculate global digital voting participation
  const allVotersSet = new Set<string>();
  let totalUniqueVoterTantiemes = 0;
  if (activeAG) {
    activeAG.resolutions.forEach((res) => {
      res.voters?.forEach((v) => {
        if (!allVotersSet.has(v.residentId)) {
          allVotersSet.add(v.residentId);
          totalUniqueVoterTantiemes += v.tantiemes;
        }
      });
    });
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <AGIcon />
              <span>Gouvernance & Assemblées Générales (Loi 18-00)</span>
            </h1>
            <span className="text-xs bg-teal-50 text-teal-800 font-semibold px-2.5 py-0.5 rounded-full border border-teal-200">
              Scrutin pondéré par tantièmes
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Copropriété {building.name} · Feuille de présence, calcul automatique du quorum et vote électronique certifié
          </p>
        </div>

        <div className="flex items-center gap-3">
          {agList.length > 1 && (
            <select
              value={activeAG?.id || ''}
              onChange={(e) => setActiveSessionId(e.target.value)}
              className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 bg-white font-medium"
            >
              {agList.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.title} ({ag.date})
                </option>
              ))}
            </select>
          )}

          <Button onClick={() => setIsCreateModalOpen(true)} className="flex items-center gap-1.5 text-xs sm:text-sm">
            <PlusIcon />
            <span>Planifier une AG</span>
          </Button>
        </div>
      </div>

      {/* Quorum & Digital Voting Banner */}
      {activeAG && (
        <Card className="bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 text-white p-6 border-none shadow-md">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider bg-teal-700/80 text-teal-100 px-2.5 py-0.5 rounded-full border border-teal-500/30">
                  {activeAG.type === 'AGO' ? 'Assemblée Générale Ordinaire' : 'Assemblée Générale Extraordinaire'}
                </span>
                <span
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                    activeAG.isVotingOpen !== false
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-slate-700/60 text-slate-300 border-slate-600'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      activeAG.isVotingOpen !== false ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                    }`}
                  ></span>
                  {activeAG.isVotingOpen !== false ? 'Vote en ligne actif' : 'Vote en ligne clôturé'}
                </span>
                <span className="text-xs text-teal-200">
                  {new Date(activeAG.date).toLocaleDateString('fr-MA', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}{' '}
                  à {activeAG.time}
                </span>
              </div>

              <h2 className="text-xl font-bold tracking-tight text-white">{activeAG.title}</h2>
              <p className="text-xs text-teal-100/90 max-w-2xl leading-relaxed">
                Lieu : <strong>{activeAG.location}</strong> · Président de séance :{' '}
                <strong>{activeAG.presidentName || 'Élu en séance'}</strong> · Secrétaire :{' '}
                <strong>{activeAG.secretaryName || syndic?.name || 'Le Syndic'}</strong>
              </p>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                onClick={() => toggleVotingMutation.mutate(!(activeAG.isVotingOpen !== false))}
                disabled={toggleVotingMutation.isPending}
                className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all shadow-xs ${
                  activeAG.isVotingOpen !== false
                    ? 'bg-amber-400 hover:bg-amber-500 text-slate-900'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                }`}
                title="Activer ou désactiver la possibilité pour les résidents de voter depuis leur portail"
              >
                {activeAG.isVotingOpen !== false ? 'Clôturer le vote en ligne' : 'Ouvrir le vote en ligne'}
              </button>

              <Button
                variant="secondary"
                onClick={() => generatePvAgPDF(activeAG, building, syndic)}
                className="text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 flex items-center gap-1.5"
              >
                <DocumentsIcon />
                <span>Télécharger le PV Officiel (PDF)</span>
              </Button>
            </div>
          </div>

          {/* Quorum & Turnout KPIs */}
          <div className="mt-5 pt-4 border-t border-teal-700/60 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            <div className="md:col-span-7 space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-teal-200 font-medium">Quorum légal de copropriété (Loi 18-00 Art. 21) :</span>
                <span className="font-mono font-bold text-white">
                  {activeAG.presentTantiemes} / {activeAG.totalTantiemes || 1000} tantièmes (
                  {Math.round(((activeAG.presentTantiemes || 0) / (activeAG.totalTantiemes || 1000)) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-teal-950/60 rounded-full h-2.5 overflow-hidden border border-teal-600/40">
                <div
                  className={`h-full transition-all duration-500 ${
                    activeAG.quorumReached ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      ((activeAG.presentTantiemes || 0) / (activeAG.totalTantiemes || 1000)) * 100
                    )}%`,
                  }}
                />
              </div>
              <div className="flex justify-between items-center text-[11px] text-teal-300">
                <span>
                  {activeAG.quorumReached
                    ? '✓ Quorum de 1ère convocation atteint (> 50%)'
                    : '⚠ Quorum non atteint (< 50% des tantièmes)'}
                </span>
                <span>Seuil légal : 500 / 1000 tantièmes</span>
              </div>
            </div>

            <div className="md:col-span-5 grid grid-cols-2 gap-2.5">
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-300 uppercase tracking-wider block font-semibold">
                  Participation Digitale
                </span>
                <span className="text-base font-bold text-white font-mono mt-0.5 block">
                  {allVotersSet.size} votant{allVotersSet.size > 1 ? 's' : ''} ({totalUniqueVoterTantiemes} t.)
                </span>
              </div>
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-300 uppercase tracking-wider block font-semibold">
                  Résolutions Votées
                </span>
                <span className="text-base font-bold text-white font-mono mt-0.5 block">
                  {activeAG.resolutions.filter((r) => r.status !== 'pending').length} / {activeAG.resolutions.length}
                </span>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Main Two-Column View */}
      {activeAG ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Column 1: Attendees Register (Feuille de présence) */}
          <div className="lg:col-span-5 space-y-4">
            <Card className="p-4 bg-white border border-slate-200">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Feuille de Présence & Émargement</h3>
                  <p className="text-xs text-slate-500">Pondération légale des droits de vote par copropriétaire</p>
                </div>
                <span className="text-xs font-mono font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                  {activeAG.attendees.filter((a) => a.status !== 'absent').length} / {activeAG.attendees.length} votants
                </span>
              </div>

              <div className="divide-y divide-slate-100 mt-2 max-h-[560px] overflow-y-auto">
                {activeAG.attendees.map((attendee) => (
                  <div key={attendee.residentId} className="py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm">
                    <div>
                      <div className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                        <span>{attendee.residentName}</span>
                        {allVotersSet.has(attendee.residentId) && (
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-semibold">
                            Vote en ligne ✓
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                        <span className="font-semibold text-slate-700">Lot {attendee.apartmentNumber}</span>
                        <span>·</span>
                        <span className="font-mono text-teal-800 font-bold">{attendee.tantiemes} / 1000 tantièmes</span>
                        {attendee.proxyHolderName && (
                          <span className="text-amber-700 bg-amber-50 px-1 rounded">
                            Mandat: {attendee.proxyHolderName}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Segmented status buttons */}
                    <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded text-xs shrink-0">
                      <button
                        onClick={() =>
                          attendeeMutation.mutate({
                            agId: activeAG.id,
                            residentId: attendee.residentId,
                            status: 'present',
                          })
                        }
                        className={`px-2 py-1 rounded transition-colors ${
                          attendee.status === 'present'
                            ? 'bg-teal-700 text-white font-bold shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Copropriétaire présent physiquement en séance"
                      >
                        Présent
                      </button>
                      <button
                        onClick={() => {
                          const proxyName = prompt('Nom du mandataire (procuration écrite) :', attendee.proxyHolderName || 'Ahmed Alami');
                          if (proxyName !== null) {
                            attendeeMutation.mutate({
                              agId: activeAG.id,
                              residentId: attendee.residentId,
                              status: 'represented',
                              proxy: proxyName,
                            });
                          }
                        }}
                        className={`px-2 py-1 rounded transition-colors ${
                          attendee.status === 'represented'
                            ? 'bg-amber-600 text-white font-bold shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Copropriétaire représenté par procuration"
                      >
                        Représenté
                      </button>
                      <button
                        onClick={() =>
                          attendeeMutation.mutate({
                            agId: activeAG.id,
                            residentId: attendee.residentId,
                            status: 'absent',
                          })
                        }
                        className={`px-2 py-1 rounded transition-colors ${
                          attendee.status === 'absent'
                            ? 'bg-slate-300 text-slate-800 font-bold'
                            : 'text-slate-400 hover:text-slate-700'
                        }`}
                        title="Absent et non représenté"
                      >
                        Absent
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Column 2: Resolutions Voting & Scrutin Console */}
          <div className="lg:col-span-7 space-y-4">
            <Card className="p-4 bg-white border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Délibérations & Vote des Résolutions</h3>
                  <p className="text-xs text-slate-500">
                    Calcul automatique des majorités légales selon la Loi 18-00 (Articles 21, 22 et 23)
                  </p>
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    onClick={() => setResolutionFilter('all')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      resolutionFilter === 'all'
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Toutes ({activeAG.resolutions.length})
                  </button>
                  <button
                    onClick={() => setResolutionFilter('pending')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      resolutionFilter === 'pending'
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    En délibération
                  </button>
                  <button
                    onClick={() => setResolutionFilter('approved')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      resolutionFilter === 'approved'
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Adoptées
                  </button>
                </div>
              </div>

              {/* Resolutions List */}
              <div className="space-y-4 mt-4">
                {filteredResolutions.map((res) => {
                  const totalVotes = res.votesFor + res.votesAgainst + res.votesAbstain;
                  const percentFor = totalVotes > 0 ? Math.round((res.votesFor / totalVotes) * 100) : 0;
                  const percentAgainst = totalVotes > 0 ? Math.round((res.votesAgainst / totalVotes) * 100) : 0;

                  const majorityLabel =
                    res.majorityType === 'simple'
                      ? 'Majorité simple (Art. 21) · Pour > Contre'
                      : res.majorityType === 'absolute'
                      ? 'Majorité absolue (Art. 22) · min. 501 / 1000 tantièmes'
                      : 'Unanimité (Art. 23) · 1000 / 1000 tantièmes';

                  return (
                    <div
                      key={res.id}
                      className="border border-slate-200 rounded-xl p-4 bg-white space-y-3 hover:border-slate-300 transition-all shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                              Résolution N° {res.number}
                            </span>
                            <span className="text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-medium">
                              {majorityLabel}
                            </span>
                          </div>
                          <h4 className="font-bold text-slate-900 text-sm mt-1">{res.title}</h4>
                          <p className="text-xs text-slate-600 leading-relaxed">{res.description}</p>
                        </div>

                        {/* Status Badge */}
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-bold shrink-0 border ${
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

                      {/* Vote tally bar weighted by tantièmes */}
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5">
                        <div className="flex flex-wrap justify-between items-center text-xs font-mono">
                          <span className="text-emerald-700 font-bold">
                            POUR : {res.votesFor} tantièmes ({percentFor}%)
                          </span>
                          <span className="text-rose-700 font-bold">
                            CONTRE : {res.votesAgainst} ({percentAgainst}%)
                          </span>
                          <span className="text-slate-500 font-medium">
                            ABSTENTION : {res.votesAbstain}
                          </span>
                          <span className="text-slate-400 text-[11px]">
                            Exprimé : <strong>{totalVotes} / 1000</strong>
                          </span>
                        </div>

                        <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden flex shadow-inner">
                          <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${percentFor}%` }} />
                          <div className="bg-rose-500 h-full transition-all duration-300" style={{ width: `${percentAgainst}%` }} />
                          <div
                            className="bg-slate-400 h-full transition-all duration-300"
                            style={{
                              width: `${totalVotes > 0 ? Math.round((res.votesAbstain / totalVotes) * 100) : 0}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Action triggers */}
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setViewVotersResolution(res)}
                            className="text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded border border-slate-200 font-medium transition-colors"
                          >
                            Consulter les votants ({res.voters?.length || 0})
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => handleOpenRecordVoteModal(res)}
                            className="text-xs bg-teal-700 hover:bg-teal-800 text-white font-bold px-3 py-1.5 flex items-center gap-1.5"
                          >
                            <span>+ Enregistrer un vote en séance</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredResolutions.length === 0 && (
                  <p className="text-center text-slate-400 text-xs py-8">
                    Aucune résolution ne correspond au filtre sélectionné.
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="p-8 text-center space-y-3 bg-white border border-slate-200">
          <p className="text-slate-500 text-sm">Aucune assemblée générale n'a été planifiée pour cette copropriété.</p>
          <Button onClick={() => setIsCreateModalOpen(true)} className="text-sm">
            Planifier la 1ère Assemblée Générale
          </Button>
        </Card>
      )}

      {/* Modal: Schedule New AG */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Planifier une Assemblée Générale (Loi 18-00)"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateAG}>Créer & Convoquer l'AG</Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs sm:text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Titre de l'Assemblée</label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Ex: Assemblée Générale Ordinaire Annuelle (AGO 2026)"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Type de réunion</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="AGO">Ordinaire (AGO - Bilan annuel & budget)</option>
                <option value="AGE">Extraordinaire (AGE - Travaux urgents)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Heure de début</label>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Lieu</label>
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Ordre du Jour & Résolutions (Une résolution par ligne)
            </label>
            <textarea
              rows={5}
              value={agendaInput}
              onChange={(e) => setAgendaInput(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-xs font-mono"
            />
          </div>
        </div>
      </Modal>

      {/* Modal: Record Vote on behalf of a resident (En séance / Procuration) */}
      {isRecordVoteModalOpen && selectedResolutionForVote && (
        <Modal
          isOpen={isRecordVoteModalOpen}
          onClose={() => setIsRecordVoteModalOpen(false)}
          title={`Enregistrer un Vote · Résolution N° ${selectedResolutionForVote.number}`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsRecordVoteModalOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleConfirmInSessionVote}
                disabled={castVoteMutation.isPending}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                {castVoteMutation.isPending ? 'Enregistrement...' : 'Enregistrer le Vote Pondéré'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs sm:text-sm">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 bg-teal-50 px-2 py-0.5 rounded">
                Résolution N° {selectedResolutionForVote.number}
              </span>
              <h4 className="font-bold text-slate-900 mt-1">{selectedResolutionForVote.title}</h4>
              <p className="text-xs text-slate-600 mt-0.5">{selectedResolutionForVote.description}</p>
            </div>

            {/* Select Resident */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Copropriétaire Votant (ou représenté par procuration) :
              </label>
              <select
                value={selectedResidentIdForVote}
                onChange={(e) => setSelectedResidentIdForVote(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-xs bg-white text-slate-900"
              >
                {building.residents.map((res) => {
                  const apt = building.apartments.find((a) => a.ownerId === res.id || a.id === res.apartmentId);
                  const existingVote = selectedResolutionForVote.voters?.find((v) => v.residentId === res.id);
                  return (
                    <option key={res.id} value={res.id}>
                      {res.name} — Lot {apt?.number || 'Lot'} ({apt?.tantiemes || 100}/1000 tantièmes)
                      {existingVote ? ` [Vote actuel: ${existingVote.vote.toUpperCase()}]` : ' [Non voté]'}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Resolved Tantièmes Indicator */}
            {(() => {
              const res = building.residents.find((r) => r.id === selectedResidentIdForVote);
              const apt = building.apartments.find((a) => a.ownerId === res?.id || a.id === res?.apartmentId);
              const tantiemes = apt?.tantiemes || 100;

              return (
                <div className="p-3 bg-teal-50 rounded-lg border border-teal-200 flex justify-between items-center text-xs">
                  <div>
                    <span className="font-bold text-teal-900 block">Pondération Légale Automatique :</span>
                    <span className="text-teal-800">
                      Ce vote comptera pour exactement <strong>{tantiemes} tantièmes</strong> ({((tantiemes / 1000) * 100).toFixed(1)}% des voix de la copropriété).
                    </span>
                  </div>
                  <span className="font-mono font-bold text-lg text-teal-900 px-3 py-1 bg-white rounded-md border border-teal-300">
                    {tantiemes} / 1000
                  </span>
                </div>
              );
            })()}

            {/* 3 Option Choice */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Sens du Vote :</label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setInSessionVoteChoice('for')}
                  className={`p-2.5 rounded-lg border-2 text-center transition-all ${
                    inSessionVoteChoice === 'for'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-bold'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300'
                  }`}
                >
                  <span className="block text-base">🟢</span>
                  <span className="text-xs font-bold block">POUR</span>
                </button>

                <button
                  type="button"
                  onClick={() => setInSessionVoteChoice('against')}
                  className={`p-2.5 rounded-lg border-2 text-center transition-all ${
                    inSessionVoteChoice === 'against'
                      ? 'border-rose-600 bg-rose-50 text-rose-900 font-bold'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-rose-300'
                  }`}
                >
                  <span className="block text-base">🔴</span>
                  <span className="text-xs font-bold block">CONTRE</span>
                </button>

                <button
                  type="button"
                  onClick={() => setInSessionVoteChoice('abstain')}
                  className={`p-2.5 rounded-lg border-2 text-center transition-all ${
                    inSessionVoteChoice === 'abstain'
                      ? 'border-slate-600 bg-slate-200 text-slate-900 font-bold'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                  }`}
                >
                  <span className="block text-base">⚪</span>
                  <span className="text-xs font-bold block">ABSTENTION</span>
                </button>
              </div>
            </div>

            {/* Optional Comment / Proxy */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Observation, mandat de procuration ou réserve (Loi 18-00) :
              </label>
              <input
                type="text"
                value={inSessionVoteComment}
                onChange={(e) => setInSessionVoteComment(e.target.value)}
                placeholder="Ex: Vote exprimé en séance par le mandataire..."
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: View Voters for a Resolution */}
      {viewVotersResolution && (
        <Modal
          isOpen={!!viewVotersResolution}
          onClose={() => setViewVotersResolution(null)}
          title={`Registre du Scrutin · Résolution N° ${viewVotersResolution.number}`}
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
              <h4 className="font-bold text-slate-900 text-sm">{viewVotersResolution.title}</h4>
              <p className="text-xs text-slate-600 mt-0.5">{viewVotersResolution.description}</p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-left">Copropriétaire</th>
                    <th className="px-3 py-2 text-left">Lot</th>
                    <th className="px-3 py-2 text-center">Tantièmes</th>
                    <th className="px-3 py-2 text-center">Vote</th>
                    <th className="px-3 py-2 text-left">Date & Observation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {viewVotersResolution.voters?.map((v, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-bold text-slate-900">{v.residentName}</td>
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
    </div>
  );
};

export default AssembleeGeneraleView;
