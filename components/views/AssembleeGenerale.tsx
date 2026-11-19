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
  createAssembleeGenerale,
  updateAGAttendee,
  castResidentAGVote,
  toggleAGVoting,
  generateChargesFromAGResolution,
} from '../../firebase/services';
import { generatePvAgPDF, generateConvocationAgPDF } from '../../services/pdfOnDemand';
import { canonicalQuorum } from '../../shared/domain/voting';
import Loading from '../common/Loading';
import { useToast } from '../common/Toast';

interface AssembleeGeneraleProps {
  building: Building;
  syndic?: Syndic;
}

function getResolutionBallots(res: AGResolution): AGVoteCast[] {
  return res.voterChoices ?? res.voters ?? [];
}

function formatMajorityLabel(
  majorityType: AGResolution['majorityType'],
  totalTantiemes: number,
  tr: (fr: string, ar: string) => string
): string {
  const total = totalTantiemes || 1000;
  const absThreshold = canonicalQuorum(total);
  const threeQuartersThreshold = Math.ceil(total * 0.75);
  switch (majorityType) {
    case 'simple':
    case 'simple_24':
      return tr('Majorité simple (Art. 21) · Pour > Contre', 'الأغلبية البسيطة (المادة 21) · نعم > لا');
    case 'absolute':
    case 'absolue_25':
      return tr(
        `Majorité absolue (Art. 22) · min. ${absThreshold} / ${total} tantièmes`,
        `الأغلبية المطلقة (المادة 22) · ${absThreshold} / ${total} جزء على الأقل`
      );
    case 'three_quarters':
    case 'trois_quarts_26':
      return tr(
        `Majorité 3/4 (Art. 22 · Loi 106-12) · min. ${threeQuartersThreshold} / ${total} tantièmes`,
        `أغلبية 3/4 (المادة 22 · القانون 106-12) · ${threeQuartersThreshold} / ${total} جزء على الأقل`
      );
    case 'unanimity':
    case 'unanimite':
      return tr(
        `Unanimité (Art. 23) · ${total} / ${total} tantièmes`,
        `الإجماع (المادة 23) · ${total} / ${total} جزء`
      );
    default:
      return tr('Majorité simple (Art. 21) · Pour > Contre', 'الأغلبية البسيطة (المادة 21) · نعم > لا');
  }
}

function ResolutionBudgetEditor({ resolution, onSave }: {
  resolution: AGResolution;
  onSave: (enabled: boolean, budget?: number, worksFundTarget?: AGResolution['worksFundTarget']) => Promise<void>;
}) {
  const { tr } = useI18n();
  const { showToast } = useToast();
  const [enabled, setEnabled] = useState(resolution.generatesCharges === true || resolution.budgetAmount !== undefined);
  const [budget, setBudget] = useState(String(resolution.budgetAmount ?? ''));
  const [worksFundTarget, setWorksFundTarget] = useState<NonNullable<AGResolution['worksFundTarget']>>(
    resolution.worksFundTarget ?? 'default'
  );
  const [saving, setSaving] = useState(false);
  return <div className="text-xs space-y-2 border rounded p-2">
    <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> {tr('Génère des charges exceptionnelles', 'يُصدر رسوماً استثنائية')}</label>
    {enabled && (
      <div className="flex flex-wrap items-center gap-2">
        <label>{tr('Budget voté (MAD)', 'الميزانية للتصويت (درهم)')}<input type="number" min="0.01" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} className="border rounded p-1 mx-2" /></label>
        <label className="inline-flex items-center gap-1.5">
          <span>{tr('Affectation encaissement', 'تخصيص التحصيل')}</span>
          <select
            value={worksFundTarget}
            onChange={e => setWorksFundTarget(e.target.value as NonNullable<AGResolution['worksFundTarget']>)}
            className="border rounded p-1 bg-white"
          >
            <option value="default">{tr('Taux de l’immeuble (défaut)', 'نسبة العمارة (افتراضي)')}</option>
            <option value="courant">{tr('Compte Courant (100%)', 'الحساب الجاري (100%)')}</option>
            <option value="reserve">{tr('Fonds de Réserve (100%)', 'صندوق الاحتياط (100%)')}</option>
          </select>
        </label>
      </div>
    )}
    <Button disabled={saving || (enabled && (!Number.isFinite(Number(budget)) || Number(budget) <= 0))} onClick={async () => {
      setSaving(true);
      try { await onSave(enabled, enabled ? Number(budget) : undefined, enabled ? worksFundTarget : undefined); }
      catch (error: any) { showToast(error.message, 'error'); }
      finally { setSaving(false); }
    }}>{tr('Enregistrer le budget avant vote', 'حفظ الميزانية قبل التصويت')}</Button>
  </div>;
}

const AssembleeGeneraleView: React.FC<AssembleeGeneraleProps> = ({ building, syndic }) => {
  const { tr, isAr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<'AGO' | 'AGE'>('AGO');
  const [newConvocationNumber, setNewConvocationNumber] = useState<1 | 2>(1);
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newTime, setNewTime] = useState('18:30');
  const [newLocation, setNewLocation] = useState(`Hall d'entrée - ${building.name}`);
  const [agendaInput, setAgendaInput] = useState(
    "1. Approbation du rapport moral et financier\n2. Quitus de gestion au Syndic\n3. Vote du budget prévisionnel de l'exercice\n4. Constitution du Fonds de réserve pour travaux (Loi 106-12)\n5. Travaux d'étanchéité de la toiture-terrasse"
  );

  const [newBudgets, setNewBudgets] = useState<Record<number, string>>({});
  const [newWorksFundTargets, setNewWorksFundTargets] = useState<Record<number, NonNullable<AGResolution['worksFundTarget']>>>({});
  const [newMajorityTypes, setNewMajorityTypes] = useState<Record<number, AGResolution['majorityType']>>({});
  const [issuingResolution, setIssuingResolution] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  // In-session vote casting state (keyed per lot so multi-lot owners can vote per lot)
  const [isRecordVoteModalOpen, setIsRecordVoteModalOpen] = useState(false);
  const [selectedResolutionForVote, setSelectedResolutionForVote] = useState<AGResolution | null>(null);
  const [selectedLotKeyForVote, setSelectedLotKeyForVote] = useState<string>('');
  const [inSessionVoteChoice, setInSessionVoteChoice] = useState<'for' | 'against' | 'abstain'>('for');
  const [inSessionVoteComment, setInSessionVoteComment] = useState('');
  const [allowOverrideResidentVote, setAllowOverrideResidentVote] = useState(false);

  // Resolution filtering & voters expansion state
  const [resolutionFilter, setResolutionFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [viewVotersResolution, setViewVotersResolution] = useState<AGResolution | null>(null);
  const [proxyAttendee, setProxyAttendee] = useState<{ residentId: string; residentName: string } | null>(null);
  const [proxyNameInput, setProxyNameInput] = useState('');

  const { data: agList = [], isLoading } = useQuery({
    queryKey: ['ag', building.id],
    queryFn: () => getAssembleesGeneralesForBuilding(building.id),
  });

  const activeAG = useMemo(() => {
    if (!agList.length) return null;
    if (activeSessionId) return agList.find((a) => a.id === activeSessionId) || agList[0];
    return agList[0];
  }, [agList, activeSessionId]);

  const isClosed = Boolean(activeAG && ['completed', 'closed'].includes(activeAG.status));
  const isVotingActive = Boolean(activeAG && activeAG.isVotingOpen === true && !isClosed);
  const effectiveTotalTantiemes = activeAG?.totalTantiemes || building.totalTantiemes || 1000;
  const effectiveQuorumRequired = activeAG?.quorumRequired || canonicalQuorum(effectiveTotalTantiemes);
  const isSecondConvocation = activeAG?.convocationNumber === 2;

  const saveAGMutation = useMutation({
    mutationFn: createAssembleeGenerale,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['ag', building.id] });
      if (created?.id) setActiveSessionId(created.id);
      setIsCreateModalOpen(false);
      setNewTitle('');
      setNewConvocationNumber(1);
      setNewBudgets({});
      setNewWorksFundTargets({});
      setNewMajorityTypes({});
    },
    onError: (err: Error) => {
      showToast(err.message || tr("Impossible de créer l'assemblée générale.", 'تعذر إنشاء الجمعية العامة.'), 'error');
    },
  });

  const attendeeMutation = useMutation({
    mutationFn: (data: { agId: string; residentId: string; status: 'present' | 'represented' | 'absent'; proxy?: string }) =>
      updateAGAttendee(data.agId, data.residentId, data.status, data.proxy),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ag', building.id] }),
    onError: (err: Error) => {
      showToast(err.message || tr("Impossible de mettre à jour la présence.", 'تعذر تحديث الحضور.'), 'error');
    },
  });

  const toggleVotingMutation = useMutation({
    mutationFn: (isOpen: boolean) => {
      if (!activeAG) throw new Error(tr('Aucune AG active', 'لا توجد جمعية عامة نشطة'));
      return toggleAGVoting(activeAG.id, isOpen);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ag', building.id] }),
    onError: (err: Error) => {
      showToast(err.message || tr("Impossible de modifier l'état du scrutin.", 'تعذر تغيير حالة التصويت.'), 'error');
    },
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
      allowOverrideResidentVote?: boolean;
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
        data.comment,
        data.allowOverrideResidentVote
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ag', building.id] });
      setIsRecordVoteModalOpen(false);
      setInSessionVoteComment('');
      setAllowOverrideResidentVote(false);
    },
    onError: (err: Error) => {
      showToast(err.message || tr("Impossible d'enregistrer le vote.", 'تعذر تسجيل التصويت.'), 'error');
    },
  });

  const eligibleOwners = useMemo(
    () => building.residents.filter((res) => res.isOwner === true && !res.archivedAt),
    [building.residents]
  );

  // Per-lot eligible voters sourced from frozen votingSnapshot when open/closed, or from active attendees/building lots.
  const votingLots = useMemo(() => {
    const attendees = activeAG?.attendees || [];
    if (activeAG?.votingSnapshot?.apartments?.length) {
      const snapshotResidents = activeAG.votingSnapshot.residents || [];
      return activeAG.votingSnapshot.apartments
        .filter((lot) => Boolean(lot.ownerId))
        .map((lot) => {
          const owner = snapshotResidents.find((r) => r.id === lot.ownerId);
          const attendee = attendees.find(
            (a) => (a.apartmentId && a.apartmentId === lot.id) || (a.residentId === lot.ownerId && a.apartmentNumber === lot.number)
          ) || attendees.find((a) => a.residentId === lot.ownerId);
          return {
            lotKey: lot.id || `${lot.ownerId}:${lot.number}`,
            apartmentId: lot.id,
            apartmentNumber: lot.number,
            residentId: lot.ownerId!,
            residentName: owner?.name || attendee?.residentName || tr('Copropriétaire', 'مالك مشترك'),
            tantiemes: lot.tantiemes || 0,
            attendanceStatus: attendee?.status ?? 'absent',
            proxyHolderName: attendee?.proxyHolderName,
          };
        });
    }
    if (attendees.length > 0) {
      return attendees.map((a) => {
        const apt = building.apartments.find(
          (ap) => (a.apartmentId && ap.id === a.apartmentId) || (ap.ownerId === a.residentId && ap.number === a.apartmentNumber)
        );
        return {
          lotKey: a.apartmentId || apt?.id || `${a.residentId}:${a.apartmentNumber}`,
          apartmentId: a.apartmentId || apt?.id || '',
          apartmentNumber: a.apartmentNumber,
          residentId: a.residentId,
          residentName: a.residentName,
          tantiemes: a.tantiemes,
          attendanceStatus: a.status,
          proxyHolderName: a.proxyHolderName,
        };
      });
    }
    return building.apartments
      .filter((apt) => !apt.archivedAt && eligibleOwners.some((o) => o.id === apt.ownerId))
      .map((apt) => {
        const owner = eligibleOwners.find((o) => o.id === apt.ownerId)!;
        return {
          lotKey: apt.id,
          apartmentId: apt.id,
          apartmentNumber: apt.number,
          residentId: owner.id,
          residentName: owner.name,
          tantiemes: apt.tantiemes || 0,
          attendanceStatus: 'absent' as const,
          proxyHolderName: undefined,
        };
      });
  }, [activeAG, building.apartments, eligibleOwners, tr]);

  const handleOpenRecordVoteModal = (resolution: AGResolution) => {
    setSelectedResolutionForVote(resolution);
    const defaultLot = votingLots.find((l) => l.attendanceStatus !== 'absent') || votingLots[0];
    setSelectedLotKeyForVote(defaultLot?.lotKey || '');
    setInSessionVoteChoice('for');
    setInSessionVoteComment('');
    setAllowOverrideResidentVote(false);
    setIsRecordVoteModalOpen(true);
  };

  const selectedVoteLot = useMemo(
    () => votingLots.find((l) => l.lotKey === selectedLotKeyForVote) || null,
    [votingLots, selectedLotKeyForVote]
  );

  const selectedLotExistingVote = useMemo(() => {
    if (!selectedResolutionForVote || !selectedVoteLot) return undefined;
    return getResolutionBallots(selectedResolutionForVote).find((v) =>
      v.apartmentId && selectedVoteLot.apartmentId
        ? v.apartmentId === selectedVoteLot.apartmentId
        : v.residentId === selectedVoteLot.residentId && v.apartmentNumber === selectedVoteLot.apartmentNumber
    );
  }, [selectedResolutionForVote, selectedVoteLot]);

  const handleConfirmInSessionVote = async () => {
    if (!activeAG || !selectedResolutionForVote || !selectedVoteLot) {
      throw new Error(tr('Sélectionnez une résolution et un lot.', 'حدد قراراً ووحدة.'));
    }
    if (selectedVoteLot.attendanceStatus === 'absent') {
      throw new Error(
        tr(
          'Ce copropriétaire est marqué absent. Veuillez d’abord enregistrer sa présence ou sa procuration sur la feuille de présence.',
          'هذا المالك مسجل كغائب. يرجى أولاً تسجيل حضوره أو وكالته في ورقة الحضور.'
        )
      );
    }
    if (selectedLotExistingVote?.castByRole === 'resident' && !allowOverrideResidentVote) {
      throw new Error(
        tr(
          'Cochez la confirmation pour remplacer un vote déjà exprimé par le copropriétaire.',
          'يرجى تأكيد استبدال تصويت سابق صادر عن المالك المشترك.'
        )
      );
    }

    return castVoteMutation.mutateAsync({
      agId: activeAG.id,
      resolutionId: selectedResolutionForVote.id,
      residentId: selectedVoteLot.residentId,
      residentName: selectedVoteLot.residentName,
      apartmentId: selectedVoteLot.apartmentId,
      apartmentNumber: selectedVoteLot.apartmentNumber,
      tantiemes: selectedVoteLot.tantiemes,
      vote: inSessionVoteChoice,
      comment: inSessionVoteComment.trim() || undefined,
      allowOverrideResidentVote: selectedLotExistingVote?.castByRole === 'resident' ? allowOverrideResidentVote : undefined,
    });
  };

  const handleCreateAG = async () => {
    if (!newTitle.trim()) throw new Error(tr("Veuillez renseigner le titre de l'assemblée.", 'يرجى إدخال عنوان الجمعية العامة.'));
    if (!newDate || !newTime || !newLocation.trim()) throw new Error(tr('La date, l’heure et le lieu sont obligatoires.', 'التاريخ والوقت والمكان مطلوبة.'));
    if (!agendaInput.trim()) throw new Error(tr('Ajoutez au moins un point à l’ordre du jour.', 'أضف نقطة واحدة على الأقل لجدول الأعمال.'));

    const ownerById = new Map(eligibleOwners.map((r) => [r.id, r]));
    const initialAttendees = building.apartments
      .filter((apt) => !apt.archivedAt && apt.ownerId && ownerById.has(apt.ownerId))
      .map((apt) => {
        const owner = ownerById.get(apt.ownerId!)!;
        return {
          residentId: owner.id,
          residentName: owner.name,
          apartmentId: apt.id,
          apartmentNumber: apt.number,
          tantiemes: apt.tantiemes || 0,
          status: 'absent' as const,
        };
      });

    const parsedAgenda = agendaInput
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const budget of Object.values(newBudgets))
      if (!Number.isFinite(Number(budget)) || Number(budget) <= 0)
        throw new Error(tr('Définissez un budget positif pour chaque appel de fonds.', 'حدد ميزانية موجبة لكل طلب مساهمة.'));

    const buildingTotalTantiemes = building.totalTantiemes || 1000;
    const initialResolutions: AGResolution[] = parsedAgenda.map((item, idx) => ({
      id: `res-${Date.now()}-${idx}`,
      number: idx + 1,
      title: item.replace(/^\d+[\.\-]\s*/, ''),
      description: tr(
        `Délibération et vote de l'assemblée concernant : ${item.replace(/^\d+[\.\-]\s*/, '')}`,
        `مداولة وتصويت الجمعية العامة حول: ${item.replace(/^\d+[\.\-]\s*/, '')}`
      ),
      majorityType: newMajorityTypes[idx] ?? (idx === 4 ? 'absolute' : 'simple'),
      ...(newBudgets[idx] !== undefined
        ? {
            generatesCharges: true,
            budgetAmount: Number(newBudgets[idx]),
            ...(newWorksFundTargets[idx] && newWorksFundTargets[idx] !== 'default'
              ? { worksFundTarget: newWorksFundTargets[idx] }
              : {}),
          }
        : {}),
      votesFor: 0,
      votesAgainst: 0,
      votesAbstain: 0,
      status: 'pending',
    }));

    const newAG: AssembleeGenerale = {
      id: `ag-${Date.now()}`,
      buildingId: building.id,
      syndicId: building.syndicId,
      title: newTitle.trim(),
      type: newType,
      convocationNumber: newConvocationNumber,
      date: newDate,
      time: newTime,
      location: newLocation.trim(),
      status: 'planned',
      isVotingOpen: false,
      quorumRequired: canonicalQuorum(buildingTotalTantiemes),
      totalTantiemes: buildingTotalTantiemes,
      presentTantiemes: 0,
      quorumReached: false,
      agendaItems: parsedAgenda,
      resolutions: initialResolutions,
      attendees: initialAttendees,
      presidentName: building.managerName || tr('Président élu en séance', 'الرئيس المنتخب في الجلسة'),
      secretaryName: syndic?.name || tr('Le Syndic', 'وكيل الاتحاد (السنديك)'),
    };

    return saveAGMutation.mutateAsync(newAG);
  };

  // Filter resolutions
  const filteredResolutions = useMemo(() => {
    if (!activeAG) return [];
    if (resolutionFilter === 'all') return activeAG.resolutions;
    return activeAG.resolutions.filter((r) => r.status === resolutionFilter);
  }, [activeAG, resolutionFilter]);

  if (isLoading) return <Loading message={tr('Chargement des assemblées générales...', 'جاري تحميل الجمعيات العامة...')} />;

  // Calculate global digital voting participation per lot (multi-lot owners counted per lot)
  const votedLotsSet = new Set<string>();
  let totalUniqueVoterTantiemes = 0;
  if (activeAG) {
    activeAG.resolutions.forEach((res) => {
      getResolutionBallots(res).forEach((v) => {
        const lotKey = v.apartmentId || `${v.residentId}:${v.apartmentNumber}`;
        if (!votedLotsSet.has(lotKey)) {
          votedLotsSet.add(lotKey);
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
              <span>{tr('Gouvernance & Assemblées Générales (Loi 18-00)', 'الحكامة والجمعيات العامة (القانون 18-00)')}</span>
            </h1>
            <span className="text-xs bg-teal-50 text-teal-800 font-semibold px-2.5 py-0.5 rounded-full border border-teal-200">
              {tr('Scrutin pondéré par tantièmes', 'تصويت مرجح بالحصة الشائعة')}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {tr(
              `Copropriété ${building.name} · Feuille de présence, calcul automatique du quorum et vote électronique certifié`,
              `الملكية المشتركة ${building.name} · ورقة الحضور، حساب النصاب القانوني والتصويت الإلكتروني المعتمد`
            )}
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
            <span>{tr('Planifier une AG', 'برمجة جمع عام')}</span>
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
                  {activeAG.type === 'AGO'
                    ? tr('Assemblée Générale Ordinaire', 'جمع عام عادي (AGO)')
                    : tr('Assemblée Générale Extraordinaire', 'جمع عام استثنائي (AGE)')}
                </span>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-indigo-500/20 text-indigo-200 border-indigo-400/30">
                  {isSecondConvocation
                    ? tr('2ème convocation (Art. 18 · sans quorum)', 'الدعوة الثانية (المادة 18 · بدون نصاب)')
                    : tr('1ère convocation (Art. 18)', 'الدعوة الأولى (المادة 18)')}
                </span>
                <span
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                    isVotingActive
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-slate-700/60 text-slate-300 border-slate-600'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isVotingActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                    }`}
                  ></span>
                  {isClosed
                    ? tr('Assemblée clôturée (PV validé)', 'جمعية مغلقة (محضر معتمد)')
                    : isVotingActive
                    ? tr('Vote en ligne actif', 'التصويت الإلكتروني مفعل')
                    : tr('Vote en ligne fermé', 'التصويت الإلكتروني مغلق')}
                </span>
                <span className="text-xs text-teal-200">
                  {new Date(activeAG.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}{' '}
                  {tr('à', 'على الساعة')} {activeAG.time}
                </span>
              </div>

              <h2 className="text-xl font-bold tracking-tight text-white">{activeAG.title}</h2>
              <p className="text-xs text-teal-100/90 max-w-2xl leading-relaxed">
                {tr('Lieu :', 'المكان:')} <strong>{activeAG.location}</strong> · {tr('Président de séance :', 'رئيس الجلسة:')}{' '}
                <strong>{activeAG.presidentName || tr('Élu en séance', 'منتخب في الجلسة')}</strong> · {tr('Secrétaire :', 'الكاتب:')}{' '}
                <strong>{activeAG.secretaryName || syndic?.name || tr('Le Syndic', 'وكيل الاتحاد')}</strong>
              </p>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!isClosed && (
                <button
                  onClick={() => toggleVotingMutation.mutate(!isVotingActive)}
                  disabled={
                    toggleVotingMutation.isPending ||
                    isClosing ||
                    (!isVotingActive &&
                      activeAG.resolutions.some(
                        (r) =>
                          (r.generatesCharges || r.budgetAmount !== undefined) &&
                          (!Number.isFinite(r.budgetAmount) || (r.budgetAmount ?? 0) <= 0)
                      ))
                  }
                  className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all shadow-xs disabled:opacity-50 disabled:cursor-not-allowed ${
                    isVotingActive
                      ? 'bg-amber-400 hover:bg-amber-500 text-slate-900'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  }`}
                  title={tr(
                    'Activer ou désactiver la possibilité pour les résidents de voter depuis leur portail',
                    'تفعيل أو إيقاف التصويت الإلكتروني للساكنة من بوابتهم'
                  )}
                >
                  {isVotingActive
                    ? tr('Clôturer le vote en ligne', 'إغلاق التصويت الإلكتروني')
                    : !activeAG.votingSnapshot
                    ? tr('Ouvrir le scrutin en ligne', 'فتح التصويت الإلكتروني')
                    : tr('Ouvrir le vote en ligne', 'فتح التصويت الإلكتروني')}
                </button>
              )}

              {(activeAG.status === 'in_progress' || (Boolean(activeAG.votingSnapshot) && !isClosed)) && (
                <button
                  type="button"
                  disabled={isClosing || toggleVotingMutation.isPending}
                  onClick={async () => {
                    setIsClosing(true);
                    try {
                      await saveAssembleeGenerale({
                        ...activeAG,
                        status: 'completed',
                        isVotingOpen: false,
                      });
                      await queryClient.invalidateQueries({ queryKey: ['ag', building.id] });
                      showToast(tr('Assemblée clôturée et PV validé.', 'تم إغلاق الجمع العام واعتماد المحضر.'), 'success');
                    } catch (err: any) {
                      showToast(err?.message || tr("Impossible de clôturer l'AG.", 'تعذر إغلاق الجمع العام.'), 'error');
                    } finally {
                      setIsClosing(false);
                    }
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg font-bold transition-all shadow-xs bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isClosing
                    ? tr('Clôture en cours...', 'جاري الإغلاق...')
                    : tr('Clôturer l’AG (Valider le PV)', 'إغلاق الجمع العام (اعتماد المحضر)')}
                </button>
              )}

              <Button
                variant="secondary"
                onClick={() => generateConvocationAgPDF(activeAG, building, syndic)}
                className="text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 flex items-center gap-1.5"
              >
                <DocumentsIcon />
                <span>{tr('Convocation + Procuration (PDF)', 'الاستدعاء + الوكالة (PDF)')}</span>
              </Button>

              <Button
                variant="secondary"
                onClick={() => generatePvAgPDF(activeAG, building, syndic)}
                className="text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 flex items-center gap-1.5"
              >
                <DocumentsIcon />
                <span>{tr('Télécharger le PV Officiel (PDF)', 'تحميل المحضر الرسمي (PDF)')}</span>
              </Button>
            </div>
          </div>

          {/* Quorum & Turnout KPIs */}
          <div className="mt-5 pt-4 border-t border-teal-700/60 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            <div className="md:col-span-7 space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-teal-200 font-medium">
                  {tr('Quorum légal de copropriété (Loi 18-00 Art. 18) :', 'النصاب القانوني للملكية المشتركة (المادة 18 من القانون 18-00):')}
                </span>
                <span className="font-mono font-bold text-white">
                  {activeAG.presentTantiemes} / {effectiveTotalTantiemes} {tr('tantièmes', 'جزء')} (
                  {Math.round(((activeAG.presentTantiemes || 0) / effectiveTotalTantiemes) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-teal-950/60 rounded-full h-2.5 overflow-hidden border border-teal-600/40">
                <div
                  className={`h-full transition-all duration-500 ${
                    activeAG.quorumReached || isSecondConvocation ? 'bg-emerald-400' : 'bg-amber-400'
                  }`}
                  style={{
                    width: `${Math.min(
                      100,
                      ((activeAG.presentTantiemes || 0) / effectiveTotalTantiemes) * 100
                    )}%`,
                  }}
                />
              </div>
              <div className="flex justify-between items-center text-[11px] text-teal-300">
                <span>
                  {isSecondConvocation
                    ? tr('✓ 2ème convocation : délibération valable sans quorum (Art. 18)', '✓ الدعوة الثانية: المداولة صالحة بدون نصاب (المادة 18)')
                    : activeAG.quorumReached
                    ? tr('✓ Quorum de 1ère convocation atteint (> 50%)', '✓ تم بلوغ النصاب القانوني للدعوة الأولى (> 50%)')
                    : tr('⚠ Quorum non atteint (< 50% des tantièmes)', '⚠ لم يكتمل النصاب القانوني بعد (< 50% من الأجزاء)')}
                </span>
                <span>
                  {isSecondConvocation
                    ? tr('Seuil : aucun (2ème convocation)', 'العتبة: بدون نصاب (الدعوة الثانية)')
                    : tr(
                        `Seuil légal : ${effectiveQuorumRequired} / ${effectiveTotalTantiemes} tantièmes`,
                        `العتبة القانونية: ${effectiveQuorumRequired} / ${effectiveTotalTantiemes} جزء`
                      )}
                </span>
              </div>
            </div>

            <div className="md:col-span-5 grid grid-cols-2 gap-2.5">
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-300 uppercase tracking-wider block font-semibold">
                  {tr('Participation Digitale', 'المشاركة الرقمية')}
                </span>
                <span className="text-base font-bold text-white font-mono mt-0.5 block">
                  {votedLotsSet.size} {tr(votedLotsSet.size > 1 ? 'lots votants' : 'lot votant', 'وحدة مصوتة')} ({totalUniqueVoterTantiemes} t.)
                </span>
              </div>
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-300 uppercase tracking-wider block font-semibold">
                  {tr('Résolutions Votées', 'القرارات المصوت عليها')}
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
                  <h3 className="font-bold text-slate-900 text-sm">{tr('Feuille de Présence & Émargement', 'ورقة الحضور والتوقيع')}</h3>
                  <p className="text-xs text-slate-500">
                    {tr('Pondération légale des droits de vote par lot', 'الوزن القانوني لحقوق التصويت لكل وحدة')}
                  </p>
                </div>
                <span className="text-xs font-mono font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                  {activeAG.attendees.filter((a) => a.status !== 'absent').length} / {activeAG.attendees.length} {tr('lots présents', 'حاضرين')}
                </span>
              </div>

              <div className="divide-y divide-slate-100 mt-2 max-h-[560px] overflow-y-auto">
                {activeAG.attendees.map((attendee) => {
                  const attendeeLotKey = attendee.apartmentId || `${attendee.residentId}:${attendee.apartmentNumber}`;
                  return (
                    <div key={attendeeLotKey} className="py-2.5 flex items-center justify-between gap-3 text-xs sm:text-sm">
                      <div>
                        <div className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
                          <span>{attendee.residentName}</span>
                          {votedLotsSet.has(attendeeLotKey) && (
                            <span className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.2 rounded font-semibold">
                              {tr('Vote enregistré ✓', 'تم التصويت ✓')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="font-semibold text-slate-700">{tr('Lot', 'شقة')} {attendee.apartmentNumber}</span>
                          <span>·</span>
                          <span className="font-mono text-teal-800 font-bold">
                            {attendee.tantiemes} / {effectiveTotalTantiemes} {tr('tantièmes', 'جزء')}
                          </span>
                          {attendee.proxyHolderName && (
                            <span className="text-amber-700 bg-amber-50 px-1 rounded">
                              {tr('Mandat:', 'وكالة:')} {attendee.proxyHolderName}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Segmented status buttons */}
                      <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded text-xs shrink-0">
                        <button
                          disabled={isClosed || attendeeMutation.isPending}
                          onClick={() =>
                            attendeeMutation.mutate({
                              agId: activeAG.id,
                              residentId: attendee.residentId,
                              status: 'present',
                            })
                          }
                          className={`px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            attendee.status === 'present'
                              ? 'bg-teal-700 text-white font-bold shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                          title={tr('Copropriétaire présent physiquement en séance', 'حاضر شخصياً في الجلسة')}
                        >
                          {tr('Présent', 'حاضر')}
                        </button>
                        <button
                          disabled={isClosed || attendeeMutation.isPending}
                          onClick={() => {
                            setProxyAttendee({
                              residentId: attendee.residentId,
                              residentName: attendee.residentName,
                            });
                            setProxyNameInput(attendee.proxyHolderName || '');
                          }}
                          className={`px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            attendee.status === 'represented'
                              ? 'bg-amber-600 text-white font-bold shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                          title={tr('Copropriétaire représenté par procuration (Art. 16-6)', 'ممثل بتفويض قانوني (المادة 16-6)')}
                        >
                          {tr('Représenté', 'ممثل')}
                        </button>
                        <button
                          disabled={isClosed || attendeeMutation.isPending}
                          onClick={() =>
                            attendeeMutation.mutate({
                              agId: activeAG.id,
                              residentId: attendee.residentId,
                              status: 'absent',
                            })
                          }
                          className={`px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            attendee.status === 'absent'
                              ? 'bg-slate-300 text-slate-800 font-bold'
                              : 'text-slate-400 hover:text-slate-700'
                          }`}
                          title={tr('Absent et non représenté', 'غائب وغير ممثل')}
                        >
                          {tr('Absent', 'غائب')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Column 2: Resolutions Voting & Scrutin Console */}
          <div className="lg:col-span-7 space-y-4">
            <Card className="p-4 bg-white border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{tr('Délibérations & Vote des Résolutions', 'المداولات والتصويت على القرارات')}</h3>
                  <p className="text-xs text-slate-500">
                    {tr(
                      'Calcul automatique des majorités légales selon la Loi 18-00 & 106-12 (Articles 21, 22 et 23)',
                      'حساب تلقائي للأغلبيات القانونية وفق القانون 18-00 و 106-12 (المواد 21، 22 و 23)'
                    )}
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
                    {tr('Toutes', 'الكل')} ({activeAG.resolutions.length})
                  </button>
                  <button
                    onClick={() => setResolutionFilter('pending')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      resolutionFilter === 'pending'
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tr('En délibération', 'قيد التداول')}
                  </button>
                  <button
                    onClick={() => setResolutionFilter('approved')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      resolutionFilter === 'approved'
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tr('Adoptées', 'مصادق عليها')}
                  </button>
                  <button
                    onClick={() => setResolutionFilter('rejected')}
                    className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                      resolutionFilter === 'rejected'
                        ? 'bg-rose-700 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {tr('Rejetées', 'مرفوضة')}
                  </button>
                </div>
              </div>

              {/* Resolutions List */}
              <div className="space-y-4 mt-4">
                {filteredResolutions.map((res) => {
                  const ballots = getResolutionBallots(res);
                  const totalVotes = res.votesFor + res.votesAgainst + res.votesAbstain;
                  const percentFor = totalVotes > 0 ? Math.round((res.votesFor / totalVotes) * 100) : 0;
                  const percentAgainst = totalVotes > 0 ? Math.round((res.votesAgainst / totalVotes) * 100) : 0;
                  const majorityLabel = formatMajorityLabel(res.majorityType, effectiveTotalTantiemes, tr);

                  return (
                    <div
                      key={res.id}
                      className="border border-slate-200 rounded-xl p-4 bg-white space-y-3 hover:border-slate-300 transition-all shadow-xs"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                              {tr('Résolution N°', 'القرار رقم')} {res.number}
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
                          {res.status === 'approved'
                            ? tr('✓ Adoptée', '✓ مصادق عليه')
                            : res.status === 'rejected'
                            ? tr('✗ Rejetée', '✗ مرفوض')
                            : tr('En délibération', 'قيد التداول')}
                        </span>
                      </div>

                      {!activeAG.votingSnapshot && activeAG.status === 'planned' && <ResolutionBudgetEditor
                        key={`${res.id}-${res.budgetAmount}-${res.generatesCharges}-${res.worksFundTarget ?? 'default'}`} resolution={res}
                        onSave={async (enabled, budget, worksFundTarget) => {
                          await saveAssembleeGenerale({ ...activeAG, resolutions: activeAG.resolutions.map(r =>
                            r.id === res.id
                              ? { ...r, generatesCharges: enabled, budgetAmount: budget, worksFundTarget }
                              : r) });
                          await queryClient.invalidateQueries({ queryKey: ['ag', building.id] });
                        }} />}
                      {res.budgetAmount !== undefined && (
                        <p className="text-xs flex flex-wrap items-center gap-2">
                          <span>{tr('Budget voté', 'الميزانية المصوت عليها')}: {res.budgetAmount} MAD</span>
                          {(res.worksFundTarget === 'courant' || res.worksFundTarget === 'reserve') && (
                            <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                              {res.worksFundTarget === 'reserve'
                                ? tr('Fonds de Réserve (100%)', 'صندوق الاحتياط (100%)')
                                : tr('Compte Courant (100%)', 'الحساب الجاري (100%)')}
                            </span>
                          )}
                        </p>
                      )}
                      {/* Vote tally bar weighted by tantièmes */}
                      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5">
                        <div className="flex flex-wrap justify-between items-center text-xs font-mono">
                          <span className="text-emerald-700 font-bold">
                            {tr('POUR :', 'نعم (مع):')} {res.votesFor} {tr('tantièmes', 'جزء')} ({percentFor}%)
                          </span>
                          <span className="text-rose-700 font-bold">
                            {tr('CONTRE :', 'لا (ضد):')} {res.votesAgainst} ({percentAgainst}%)
                          </span>
                          <span className="text-slate-500 font-medium">
                            {tr('ABSTENTION :', 'امتناع:')} {res.votesAbstain}
                          </span>
                          <span className="text-slate-400 text-[11px]">
                            {tr('Exprimé :', 'المعبر عنه:')} <strong>{totalVotes} / {effectiveTotalTantiemes}</strong>
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
                            {tr('Consulter les votants', 'عرض المصوتين')} ({ballots.length})
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {res.status === 'approved' && (res.generatesCharges || (res.budgetAmount ?? 0) > 0) && (
                            <Button
                              variant="secondary"
                              disabled={!isClosed || !res.budgetAmount || !!res.chargesGeneratedAt || issuingResolution !== null}
                              title={!isClosed ? tr('Clôturez l’assemblée avant émission.', 'أغلق الجمعية قبل الإصدار.') : undefined}
                              onClick={async () => {
                                setIssuingResolution(res.id);
                                try {
                                  const out = await generateChargesFromAGResolution(
                                    activeAG.id,
                                    res.id
                                  );
                                  await queryClient.invalidateQueries({
                                    queryKey: ['charges', building.id],
                                  });
                                  await queryClient.invalidateQueries({
                                    queryKey: ['ag', building.id],
                                  });
                                  await queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
                                  await queryClient.invalidateQueries({ queryKey: ['notifications'] });
                                  showToast(
                                    tr(
                                      `${out.createdCharges.length} appels de fonds générés (${out.totalAllocatedMad} MAD répartis aux tantièmes).`,
                                      `تم إصدار ${out.createdCharges.length} طلبات مساهمة (${out.totalAllocatedMad} درهم موزعة حسب الحصص).`
                                    ),
                                    'success'
                                  );
                                } catch (err: any) {
                                  showToast(
                                    err?.message ||
                                      tr('Erreur lors de la répartition', 'خطأ أثناء التوزيع'),
                                    'error'
                                  );
                                } finally { setIssuingResolution(null); }
                              }}
                              className="text-xs border-teal-300 text-teal-800 hover:bg-teal-50 font-semibold px-3 py-1.5"
                            >
                              {res.chargesGeneratedAt
                                ? tr('✓ Appels de fonds émis', '✓ تم إصدار المساهمات')
                                : tr(
                                    '⚡ Générer Appels de Fonds (Tantièmes)',
                                    '⚡ إصدار المساهمات (حسب الحصص)'
                                  )}
                            </Button>
                          )}
                          <Button
                            disabled={isClosed || !isVotingActive}
                            title={
                              isClosed
                                ? tr('Assemblée clôturée', 'الجمعية مغلقة')
                                : !isVotingActive
                                ? tr('Ouvrez le scrutin en ligne pour enregistrer un vote.', 'افتح التصويت لتسجيل الأصوات.')
                                : undefined
                            }
                            onClick={() => handleOpenRecordVoteModal(res)}
                            className="text-xs bg-teal-700 hover:bg-teal-800 text-white font-bold px-3 py-1.5 flex items-center gap-1.5"
                          >
                            <span>{tr('+ Enregistrer un vote en séance', '+ تسجيل تصويت في الجلسة')}</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {filteredResolutions.length === 0 && (
                  <p className="text-center text-slate-400 text-xs py-8">
                    {tr('Aucune résolution ne correspond au filtre sélectionné.', 'لا يوجد أي قرار يطابق الفلتر المحدد.')}
                  </p>
                )}
              </div>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="p-8 text-center space-y-3 bg-white border border-slate-200">
          <p className="text-slate-500 text-sm">
            {tr("Aucune assemblée générale n'a été planifiée pour cette copropriété.", 'لم تتم برمجة أي جمعية عامة لهذه الإقامة بعد.')}
          </p>
          <Button onClick={() => setIsCreateModalOpen(true)} className="text-sm">
            {tr('Planifier la 1ère Assemblée Générale', 'برمجة الجمع العام الأول')}
          </Button>
        </Card>
      )}

      {/* Modal: Schedule New AG */}
      <Modal
        isOpen={isCreateModalOpen}
        onSubmit={handleCreateAG}
        busy={saveAGMutation.isPending}
        onClose={() => setIsCreateModalOpen(false)}
        title={tr('Planifier une Assemblée Générale (Loi 18-00)', 'برمجة جمع عام (القانون 18-00)')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button type="submit" disabled={saveAGMutation.isPending}>{tr("Créer & Convoquer l'AG", 'إنشاء واستدعاء الجمع العام')}</Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs sm:text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr("Titre de l'Assemblée", 'عنوان الجمع العام')}
            </label>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={tr('Ex: Assemblée Générale Ordinaire Annuelle (AGO 2026)', 'مثال: الجمع العام العادي السنوي 2026')}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-teal-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{tr('Type de réunion', 'نوع الاجتماع')}</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as 'AGO' | 'AGE')}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="AGO">{tr('Ordinaire (AGO - Bilan annuel & budget)', 'عادي (AGO - الحصيلة والميزانية السنوية)')}</option>
                <option value="AGE">{tr('Extraordinaire (AGE - Travaux urgents)', 'استثنائي (AGE - أشغال مستعجلة)')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{tr('Convocation (Loi 18-00 Art. 18)', 'الدعوة (القانون 18-00 المادة 18)')}</label>
              <select
                value={newConvocationNumber}
                onChange={(e) => setNewConvocationNumber(Number(e.target.value) === 2 ? 2 : 1)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value={1}>{tr('1ère convocation (Quorum > 50% requis)', 'الدعوة الأولى (نصاب > 50% مطلوب)')}</option>
                <option value={2}>{tr('2ème convocation (Sans quorum · Art. 18)', 'الدعوة الثانية (بدون نصاب · المادة 18)')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{tr('Date', 'التاريخ')}</label>
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{tr('Heure de début', 'ساعة البداية')}</label>
              <input
                type="time"
                value={newTime}
                onChange={(e) => setNewTime(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">{tr('Lieu', 'المكان')}</label>
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
              {tr('Ordre du Jour & Résolutions (Une résolution par ligne)', 'جدول الأعمال والقرارات (قرار واحد في كل سطر)')}
            </label>
            <textarea
              rows={5}
              value={agendaInput}
              onChange={(e) => {
                setAgendaInput(e.target.value);
                setNewBudgets({});
                setNewWorksFundTargets({});
                setNewMajorityTypes({});
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded text-xs font-mono"
            />
          </div>
          {agendaInput.split('\n').map(line => line.trim()).filter(Boolean).map((line, index) => (
            <div key={index} className="border rounded p-2 text-xs space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={newBudgets[index] !== undefined}
                    onChange={e => setNewBudgets(old => {
                      const next = { ...old };
                      if (e.target.checked) next[index] = '';
                      else delete next[index];
                      return next;
                    })}
                  />
                  <span>{line} — {tr('Appel de fonds', 'طلب مساهمة')}</span>
                </label>
                <select
                  value={newMajorityTypes[index] ?? (index === 4 ? 'absolute' : 'simple')}
                  onChange={e => setNewMajorityTypes(old => ({ ...old, [index]: e.target.value as AGResolution['majorityType'] }))}
                  className="border rounded px-1.5 py-0.5 bg-white text-[11px]"
                  aria-label={tr('Majorité requise', 'الأغلبية المطلوبة')}
                >
                  <option value="simple">{tr('Majorité simple (Art. 21)', 'الأغلبية البسيطة (المادة 21)')}</option>
                  <option value="absolute">{tr('Majorité absolue (Art. 22)', 'الأغلبية المطلقة (المادة 22)')}</option>
                  <option value="three_quarters">{tr('Majorité 3/4 (Loi 106-12)', 'أغلبية 3/4 (القانون 106-12)')}</option>
                  <option value="unanimity">{tr('Unanimité (Art. 23)', 'الإجماع (المادة 23)')}</option>
                </select>
              </div>
              {newBudgets[index] !== undefined && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <label>{tr('Budget (MAD)', 'الميزانية (درهم)')}<input type="number" min="0.01" step="0.01" value={newBudgets[index]} onChange={e => setNewBudgets(old => ({ ...old, [index]: e.target.value }))} className="border rounded p-1 mx-2" /></label>
                  <label className="inline-flex items-center gap-1.5">
                    <span>{tr('Affectation', 'التخصيص')}</span>
                    <select
                      value={newWorksFundTargets[index] ?? 'default'}
                      onChange={e => setNewWorksFundTargets(old => ({ ...old, [index]: e.target.value as NonNullable<AGResolution['worksFundTarget']> }))}
                      className="border rounded p-1 bg-white"
                    >
                      <option value="default">{tr('Taux de l’immeuble (défaut)', 'نسبة العمارة (افتراضي)')}</option>
                      <option value="courant">{tr('Compte Courant (100%)', 'الحساب الجاري (100%)')}</option>
                      <option value="reserve">{tr('Fonds de Réserve (100%)', 'صندوق الاحتياط (100%)')}</option>
                    </select>
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </Modal>

      {/* Modal: Record Vote on behalf of a resident (En séance / Procuration) */}
      {isRecordVoteModalOpen && selectedResolutionForVote && (
        <Modal
          isOpen={isRecordVoteModalOpen}
          onSubmit={handleConfirmInSessionVote}
          busy={castVoteMutation.isPending}
          onClose={() => {
            setIsRecordVoteModalOpen(false);
            setAllowOverrideResidentVote(false);
          }}
          title={tr(
            `Enregistrer un Vote · Résolution N° ${selectedResolutionForVote.number}`,
            `تسجيل تصويت · القرار رقم ${selectedResolutionForVote.number}`
          )}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsRecordVoteModalOpen(false)}>
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                type="submit"
                disabled={
                  castVoteMutation.isPending ||
                  !selectedVoteLot ||
                  selectedVoteLot.attendanceStatus === 'absent' ||
                  (selectedLotExistingVote?.castByRole === 'resident' && !allowOverrideResidentVote)
                }
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                {castVoteMutation.isPending
                  ? tr('Enregistrement...', 'جاري التسجيل...')
                  : tr('Enregistrer le Vote Pondéré', 'تسجيل التصويت المرجح')}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs sm:text-sm">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 bg-teal-50 px-2 py-0.5 rounded">
                {tr('Résolution N°', 'القرار رقم')} {selectedResolutionForVote.number}
              </span>
              <h4 className="font-bold text-slate-900 mt-1">{selectedResolutionForVote.title}</h4>
              <p className="text-xs text-slate-600 mt-0.5">{selectedResolutionForVote.description}</p>
            </div>

            {/* Select Lot / Owner */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Lot & Copropriétaire Votant (ou représenté par procuration) :', 'الوحدة والمالك المشترك المصوت (أو الممثل بوكالة):')}
              </label>
              <select
                value={selectedLotKeyForVote}
                onChange={(e) => {
                  setSelectedLotKeyForVote(e.target.value);
                  setAllowOverrideResidentVote(false);
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded text-xs bg-white text-slate-900"
              >
                {votingLots.map((lot) => {
                  const existingVote = getResolutionBallots(selectedResolutionForVote).find((v) =>
                    v.apartmentId && lot.apartmentId
                      ? v.apartmentId === lot.apartmentId
                      : v.residentId === lot.residentId && v.apartmentNumber === lot.apartmentNumber
                  );
                  const statusTag =
                    lot.attendanceStatus === 'present'
                      ? tr('Présent', 'حاضر')
                      : lot.attendanceStatus === 'represented'
                      ? `${tr('Représenté', 'ممثل')}${lot.proxyHolderName ? ` (${lot.proxyHolderName})` : ''}`
                      : tr('Absent', 'غائب');
                  return (
                    <option key={lot.lotKey} value={lot.lotKey}>
                      {lot.residentName} — {tr('Lot', 'شقة')} {lot.apartmentNumber} ({lot.tantiemes}/{effectiveTotalTantiemes} {tr('tantièmes', 'جزء')}) · {statusTag}
                      {existingVote ? ` [${tr('Vote actuel:', 'التصويت الحالي:')} ${(existingVote.choice || existingVote.vote || 'abstain').toUpperCase()}]` : ` [${tr('Non voté', 'لم يصوت')}]`}
                    </option>
                  );
                })}
              </select>
            </div>

            {selectedVoteLot?.attendanceStatus === 'absent' && (
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-900">
                {tr(
                  'Ce copropriétaire est actuellement marqué « Absent ». Marquez-le « Présent » ou « Représenté » sur la feuille de présence avant d’enregistrer un vote en séance.',
                  'هذا المالك مسجل حالياً كـ «غائب». يرجى تسجيله كـ «حاضر» أو «ممثل» في ورقة الحضور قبل تسجيل التصويت.'
                )}
              </div>
            )}

            {selectedLotExistingVote?.castByRole === 'resident' && (
              <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-xs text-rose-900 space-y-2">
                <p className="font-semibold">
                  {tr(
                    'Attention : ce copropriétaire a déjà exprimé son vote personnellement depuis son portail.',
                    'تنبيه: لقد سبق لهذا المالك أن عبّر عن تصويته شخصياً عبر بوابتـه.'
                  )}
                </p>
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowOverrideResidentVote}
                    onChange={(e) => setAllowOverrideResidentVote(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {tr(
                      'Je confirme remplacer le vote électronique du copropriétaire suite à une instruction en séance.',
                      'أؤكد استبدال التصويت الإلكتروني للمالك بناءً على تعليمات في الجلسة.'
                    )}
                  </span>
                </label>
              </div>
            )}

            {/* Resolved Tantièmes Indicator */}
            {selectedVoteLot && (
              <div className="p-3 bg-teal-50 rounded-lg border border-teal-200 flex justify-between items-center text-xs">
                <div>
                  <span className="font-bold text-teal-900 block">
                    {tr('Pondération Légale Automatique :', 'الترجيح القانوني التلقائي:')}
                  </span>
                  <span className="text-teal-800">
                    {tr(
                      `Ce vote comptera pour exactement ${selectedVoteLot.tantiemes} tantièmes (${((selectedVoteLot.tantiemes / effectiveTotalTantiemes) * 100).toFixed(1)}% des voix de la copropriété).`,
                      `سيُحتسب هذا التصويت بوزن ${selectedVoteLot.tantiemes} جزء (${((selectedVoteLot.tantiemes / effectiveTotalTantiemes) * 100).toFixed(1)}% من مجموع أصوات الملكية المشتركة).`
                    )}
                  </span>
                </div>
                <span className="font-mono font-bold text-lg text-teal-900 px-3 py-1 bg-white rounded-md border border-teal-300 shrink-0">
                  {selectedVoteLot.tantiemes} / {effectiveTotalTantiemes}
                </span>
              </div>
            )}

            {/* 3 Option Choice */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {tr('Sens du Vote :', 'اتجاه التصويت:')}
              </label>
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
                  <span className="text-xs font-bold block">{tr('POUR', 'موافق (نعم)')}</span>
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
                  <span className="text-xs font-bold block">{tr('CONTRE', 'معارض (لا)')}</span>
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
                  <span className="text-xs font-bold block">{tr('ABSTENTION', 'امتناع')}</span>
                </button>
              </div>
            </div>

            {/* Optional Comment / Proxy */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Observation, mandat de procuration ou réserve (Loi 18-00) :', 'ملاحظة، تفويض وكالة أو تحفظ (القانون 18-00):')}
              </label>
              <input
                type="text"
                value={inSessionVoteComment}
                onChange={(e) => setInSessionVoteComment(e.target.value)}
                placeholder={tr('Ex: Vote exprimé en séance par le mandataire...', 'مثال: تصويت معبر عنه في الجلسة بواسطة الوكيل...')}
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
          title={tr(
            `Registre du Scrutin · Résolution N° ${viewVotersResolution.number}`,
            `سجل الاقتراع · القرار رقم ${viewVotersResolution.number}`
          )}
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setViewVotersResolution(null)}>
                {tr('Fermer', 'إغلاق')}
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
                    <th className="px-3 py-2 text-start">{tr('Copropriétaire', 'المالك المشترك')}</th>
                    <th className="px-3 py-2 text-start">{tr('Lot', 'الوحدة')}</th>
                    <th className="px-3 py-2 text-center">{tr('Tantièmes', 'الحصة الشائعة')}</th>
                    <th className="px-3 py-2 text-center">{tr('Vote', 'التصويت')}</th>
                    <th className="px-3 py-2 text-start">{tr('Date & Observation', 'التاريخ والملاحظة')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {getResolutionBallots(viewVotersResolution).map((v, i) => {
                    const choice = v.choice || v.vote || 'abstain';
                    return (
                      <tr key={v.apartmentId || `${v.residentId}-${i}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-bold text-slate-900">
                          <div>{v.residentName}</div>
                          {v.proxyHolderName && (
                            <div className="text-[10px] font-normal text-amber-700">
                              {tr('Mandataire :', 'الوكيل:')} {v.proxyHolderName}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-slate-700">{v.apartmentNumber}</td>
                        <td className="px-3 py-2 text-center font-mono font-bold text-teal-800">
                          {v.tantiemes} / {effectiveTotalTantiemes}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                              choice === 'for'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : choice === 'against'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {choice === 'for' ? tr('POUR', 'موافق') : choice === 'against' ? tr('CONTRE', 'معارض') : tr('ABSTENTION', 'ممتنع')}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">
                          {(v.castAt || v.votedAt) ? new Date((v.castAt || v.votedAt)!).toLocaleString(isAr ? 'ar-MA' : 'fr-MA') : '—'}
                          {v.castByRole && v.castByRole !== 'resident' && (
                            <span className="ms-1.5 text-[10px] bg-slate-100 text-slate-600 px-1 rounded font-sans">
                              {tr('Saisi en séance', 'مسجل في الجلسة')}
                            </span>
                          )}
                          {v.comment && <div className="text-slate-700 italic font-sans mt-0.5">« {v.comment} »</div>}
                        </td>
                      </tr>
                    );
                  })}

                  {getResolutionBallots(viewVotersResolution).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                        {tr("Aucun vote n'a encore été enregistré sur cette résolution.", 'لم يتم تسجيل أي تصويت على هذا القرار بعد.')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {proxyAttendee && activeAG && (
        <Modal
          isOpen={!!proxyAttendee}
          onClose={() => {
            setProxyAttendee(null);
            setProxyNameInput('');
          }}
          title={tr('Mandataire (Procuration écrite · Art. 16-6)', 'الوكيل (تفويض كتابي · المادة 16-6)')}
          maxWidthClass="max-w-md"
          onSubmit={async () => {
            const trimmed = proxyNameInput.trim();
            if (!trimmed) {
              throw new Error(tr('Veuillez saisir le nom complet du mandataire.', 'يرجى إدخال الاسم الكامل للوكيل.'));
            }
            await attendeeMutation.mutateAsync({
              agId: activeAG.id,
              residentId: proxyAttendee.residentId,
              status: 'represented',
              proxy: trimmed,
            });
            setProxyAttendee(null);
            setProxyNameInput('');
          }}
          busy={attendeeMutation.isPending}
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-600">
              {tr(
                `Saisissez le nom complet du mandataire représentant ${proxyAttendee.residentName} (Loi 106-12 Art. 16-6 : max 3 mandats et 10% des voix, hors syndic) :`,
                `أدخل الاسم الكامل للوكيل الذي يمثل ${proxyAttendee.residentName} (القانون 106-12 المادة 16-6: حد أقصى 3 وكالات و 10% من الأصوات، باستثناء السنديك):`
              )}
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Nom du mandataire', 'اسم الوكيل')}
              </label>
              <input
                type="text"
                value={proxyNameInput}
                onChange={(e) => setProxyNameInput(e.target.value)}
                placeholder={tr('Ex: Nom et prénom du mandataire', 'مثال: الاسم الكامل للوكيل')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setProxyAttendee(null);
                  setProxyNameInput('');
                }}
              >
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button type="submit" disabled={!proxyNameInput.trim() || attendeeMutation.isPending}>
                {tr('Enregistrer', 'حفظ')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default AssembleeGeneraleView;


