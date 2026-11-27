import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Syndic, Resident, Apartment, AGResolution, AGVoteCast } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { AGIcon, DocumentsIcon } from '../icons/IconComponents';
import { getAssembleesGeneralesForBuilding, castResidentAGVote } from '../../firebase/services';
import { generatePvAgPDF, generateConvocationAgPDF } from '../../services/pdfOnDemand';
import { canonicalQuorum } from '../../shared/domain/voting';
import Loading from '../common/Loading';
import { useI18n } from '../../hooks/useI18n';
import { useLegalFramework } from '../../hooks/useLegalFramework';
import { getActiveLegalFramework } from '../../shared/legalFramework';
import { useToast } from '../common/Toast';

interface ResidentAGVotingProps {
  building: Building;
  currentResident?: Resident;
  currentApartment?: Apartment;
  myApartments?: Apartment[];
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
  const { citations } = getActiveLegalFramework();
  switch (majorityType) {
    case 'simple':
    case 'simple_24':
      return tr(`Majorité simple (${citations.agMajoritySimpleRefFr}) · Majorité des voix exprimées`, `الأغلبية البسيطة (${citations.agMajoritySimpleRefAr}) · أغلبية الأصوات المعبر عنها`);
    case 'absolute':
    case 'absolue_25':
      return tr(
        `Majorité absolue (${citations.agMajorityAbsoluteRefFr}) · Au moins ${absThreshold} / ${total} tantièmes`,
        `الأغلبية المطلقة (${citations.agMajorityAbsoluteRefAr}) · على الأقل ${absThreshold} / ${total} جزء`
      );
    case 'three_quarters':
    case 'trois_quarts_26':
      return tr(
        `Majorité 3/4 (${citations.agMajorityThreeQuartersRefFr}) · Au moins ${threeQuartersThreshold} / ${total} tantièmes`,
        `أغلبية 3/4 (${citations.agMajorityThreeQuartersRefAr}) · على الأقل ${threeQuartersThreshold} / ${total} جزء`
      );
    case 'unanimity':
    case 'unanimite':
      return tr(
        `Unanimité (${citations.agMajorityUnanimityRefFr}) · ${total} / ${total} tantièmes`,
        `الإجماع (${citations.agMajorityUnanimityRefAr}) · ${total} / ${total} جزء`
      );
    default:
      return tr(`Majorité simple (${citations.agMajoritySimpleRefFr}) · Majorité des voix exprimées`, `الأغلبية البسيطة (${citations.agMajoritySimpleRefAr}) · أغلبية الأصوات المعبر عنها`);
  }
}

export const ResidentAGVoting: React.FC<ResidentAGVotingProps> = ({
  building,
  currentResident,
  currentApartment,
  myApartments,
  syndic,
}) => {
  const { tr, isAr } = useI18n();
  const { legal } = useLegalFramework();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [selectedAGId, setSelectedAGId] = useState<string | null>(null);
  const [selectedApartmentId, setSelectedApartmentId] = useState<string | null>(null);
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

  const ownedApartments = useMemo(() => {
    const base = myApartments?.length
      ? myApartments
      : currentApartment
      ? [currentApartment]
      : [];
    return base.filter((a) => !a.archivedAt);
  }, [myApartments, currentApartment]);

  const activeApartment = useMemo(() => {
    if (!ownedApartments.length) return undefined;
    if (selectedApartmentId) {
      return ownedApartments.find((a) => a.id === selectedApartmentId) || ownedApartments[0];
    }
    return ownedApartments[0];
  }, [ownedApartments, selectedApartmentId]);

  const isClosed = Boolean(activeAG && ['completed', 'closed'].includes(activeAG.status));
  const isVotingOpen = Boolean(activeAG && activeAG.isVotingOpen === true && !isClosed);
  const isOwner = currentResident?.isOwner === true;
  const canVote = isVotingOpen && isOwner && Boolean(activeApartment);

  const effectiveTotalTantiemes = activeAG?.totalTantiemes || building.totalTantiemes || 1000;
  const effectiveQuorumRequired = activeAG?.quorumRequired || canonicalQuorum(effectiveTotalTantiemes);
  const isSecondConvocation = activeAG?.convocationNumber === 2;

  // Resolve resident's tantièmes from frozen votingSnapshot if available, otherwise from activeApartment
  const snapshotLot = activeAG?.votingSnapshot?.apartments?.find(
    (l) => activeApartment && l.id === activeApartment.id
  );
  const residentTantiemes = snapshotLot?.tantiemes ?? activeApartment?.tantiemes ?? 0;
  const residentLotNumber = activeApartment?.number || '—';
  const residentName = currentResident?.name || tr('Copropriétaire', 'مالك مشترك');

  const findMyVote = (resolution: AGResolution): AGVoteCast | undefined => {
    if (!currentResident) return undefined;
    const ballots = getResolutionBallots(resolution);
    if (activeApartment) {
      return ballots.find(
        (v) =>
          v.residentId === currentResident.id &&
          (v.apartmentId ? v.apartmentId === activeApartment.id : v.apartmentNumber === activeApartment.number)
      );
    }
    return ballots.find((v) => v.residentId === currentResident.id);
  };

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
      if (!currentResident || !activeApartment) {
        throw new Error(tr('Profil copropriétaire ou lot introuvable', 'ملف المالك المشترك أو الوحدة غير موجود'));
      }
      if (currentResident.isOwner !== true) {
        throw new Error(
          tr(
            'Seuls les copropriétaires (ou leurs mandataires) disposent du droit de vote en Assemblée Générale.',
            'يقتصر حق التصويت في الجمع العام على الملاك المشتركين (أو وكلائهم).'
          )
        );
      }
      return castResidentAGVote(
        agId,
        resolutionId,
        currentResident.id,
        currentResident.name,
        activeApartment.id,
        activeApartment.number,
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
    onError: (err: Error) => {
      showToast(err.message, 'error');
    },
  });

  const handleStartVote = (resolution: AGResolution) => {
    const existingVote = findMyVote(resolution);
    setVoteChoice(existingVote ? existingVote.choice || existingVote.vote || 'abstain' : 'for');
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
    return <Loading message={tr("Chargement des sessions d'assemblée générale...", 'جاري تحميل جلسات الجمع العام...')} />;
  }

  if (!activeAG) {
    return (
      <Card className="p-8 text-center space-y-3 bg-white border border-slate-200">
        <div className="w-12 h-12 rounded-full bg-teal-50 text-teal-700 flex items-center justify-center mx-auto">
          <AGIcon />
        </div>
        <h3 className="text-base font-bold text-slate-800">{tr('Aucune Assemblée Générale en cours', 'لا يوجد جمع عام جارٍ حالياً')}</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          {tr(
            `Le syndic n'a pas encore convoqué d'assemblée générale pour la copropriété ${building.name}. Vous recevrez une notification officielle dès l'ouverture des votes électroniques.`,
            `لم يقم وكيل الاتحاد (السنديك) باستدعاء جمع عام للإقامة ${building.name} بعد. ستتلقى إشعاراً رسمياً فور فتح باب التصويت الإلكتروني.`
          )}
        </p>
      </Card>
    );
  }

  // Count how many resolutions this lot has already voted on
  const totalResolutions = activeAG.resolutions.length;
  const votedResolutionsCount = activeAG.resolutions.filter((r) => Boolean(findMyVote(r))).length;
  const isVotingCompleted = totalResolutions > 0 && votedResolutionsCount === totalResolutions;

  return (
    <div className="space-y-6">
      {/* Top Banner: Co-ownership Rights & Session Overview */}
      <Card className="bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 text-white p-6 border-none shadow-md">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider bg-teal-700/80 text-teal-100 px-2.5 py-0.5 rounded-full border border-teal-500/30">
                {tr(activeAG.legalCitationFr || legal.citations.statuteShortFr, activeAG.legalCitationAr || legal.citations.statuteShortAr)}
              </span>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-indigo-500/20 text-indigo-200 border-indigo-400/30">
                {isSecondConvocation
                  ? tr('2ème convocation (Art. 18 · sans quorum)', 'الدعوة الثانية (المادة 18 · بدون نصاب)')
                  : tr('1ère convocation (Art. 18)', 'الدعوة الأولى (المادة 18)')}
              </span>
              <span
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                  isVotingOpen
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-slate-700/60 text-slate-300 border-slate-600'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isVotingOpen ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'
                  }`}
                ></span>
                {isClosed
                  ? tr('Assemblée Clôturée', 'الجمعية مغلقة')
                  : isVotingOpen
                  ? tr('Vote Électronique Ouvert', 'التصويت الإلكتروني مفتوح')
                  : tr('Vote Électronique Fermé', 'التصويت الإلكتروني مغلق')}
              </span>
              <span className="text-xs text-teal-200">
                {activeAG.type === 'AGO'
                  ? tr('Assemblée Générale Ordinaire', 'الجمع العام العادي')
                  : tr('Assemblée Générale Extraordinaire', 'الجمع العام الاستثنائي')}
              </span>
            </div>

            {agList.length > 1 && (
              <div className="pt-1">
                <select
                  value={activeAG.id}
                  onChange={(e) => {
                    setSelectedAGId(e.target.value);
                    setEditingResolutionId(null);
                  }}
                  aria-label={tr('Sélectionner une assemblée générale', 'اختر الجمعية العامة')}
                  className="text-xs bg-teal-950/70 text-white border border-teal-500/50 rounded-lg px-2.5 py-1.5 font-medium"
                >
                  {agList.map((ag) => (
                    <option key={ag.id} value={ag.id} className="bg-slate-900 text-white">
                      {ag.title} ({ag.date})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <h2 className="text-xl font-bold tracking-tight text-white">{activeAG.title}</h2>
            <p className="text-xs text-teal-100/90 leading-relaxed max-w-2xl">
              {tr(
                `Exprimez vos votes sur les résolutions de la copropriété ${building.name}. Conformément à la législation marocaine, chaque décision est pondérée au prorata exact des tantièmes de votre lot privatif.`,
                `عبّر عن تصويتك على قرارات الملكية المشتركة ${building.name}. وفقاً للتشريع المغربي، يتم ترجيح كل قرار بحسب الحصة الشائعة (الأجزاء) الخاصة بوحدتك السكنية.`
              )}
            </p>

            <div className="flex flex-wrap items-center gap-4 text-xs text-teal-200 pt-1">
              <span>
                📅 {tr('Séance :', 'الجلسة:')}{' '}
                <strong>
                  {new Date(activeAG.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}{' '}
                  {tr('à', 'على الساعة')} {activeAG.time}
                </strong>
              </span>
              <span>
                📍 {tr('Lieu :', 'المكان:')} <strong>{activeAG.location}</strong>
              </span>
              <span>
                🏢 {tr('Syndic :', 'السنديك:')} <strong>{syndic?.name || 'Syndic'}</strong>
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row md:flex-col items-end gap-2 shrink-0">
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
            <button
              onClick={() => setShowLawInfoModal(true)}
              className="text-[11px] text-teal-300 hover:text-white underline"
            >
              {tr('Comprendre la règle des tantièmes', 'فهم قاعدة الحصة الشائعة')}
            </button>
          </div>
        </div>

        {/* Quorum Progress Bar */}
        <div className="mt-5 pt-4 border-t border-teal-700/60 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-8 space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-teal-200 font-medium">{tr('Participation & Quorum légal en séance :', 'المشاركة والنصاب القانوني للجلسة:')}</span>
              <span className="font-mono font-bold text-white">
                {activeAG.presentTantiemes} / {effectiveTotalTantiemes} {tr('tantièmes', 'جزء')} ({Math.round(((activeAG.presentTantiemes || 0) / effectiveTotalTantiemes) * 100)}%)
              </span>
            </div>
            <div className="w-full bg-teal-950/60 rounded-full h-2.5 overflow-hidden border border-teal-600/40">
              <div
                className={`h-full transition-all duration-500 ${
                  activeAG.quorumReached || isSecondConvocation ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
                style={{
                  width: `${Math.min(100, ((activeAG.presentTantiemes || 0) / effectiveTotalTantiemes) * 100)}%`,
                }}
              />
            </div>
            <div className="flex justify-between items-center text-[11px] text-teal-300">
              <span>
                {isSecondConvocation
                  ? tr('✓ 2ème convocation : délibération valable sans quorum (Art. 18)', '✓ الدعوة الثانية: المداولة صالحة بدون نصاب (المادة 18)')
                  : activeAG.quorumReached
                  ? tr('✓ Quorum de 1ère convocation atteint (> 50%)', '✓ تم بلوغ النصاب القانوني للدعوة الأولى (> 50%)')
                  : tr('⚠ Quorum en cours de consolidation', '⚠ النصاب القانوني قيد الاستكمال')}
              </span>
              <span>
                {isSecondConvocation
                  ? tr('Seuil : aucun (2ème convocation)', 'العتبة: بدون نصاب')
                  : tr(
                      `Seuil requis : ${effectiveQuorumRequired} / ${effectiveTotalTantiemes} tantièmes`,
                      `العتبة المطلوبة: ${effectiveQuorumRequired} / ${effectiveTotalTantiemes} جزء`
                    )}
              </span>
            </div>
          </div>

          <div className="md:col-span-4 bg-teal-950/40 p-3 rounded-lg border border-teal-600/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-teal-300 uppercase tracking-wider block font-semibold">
                {tr('Votre Avancement', 'تقدم تصويتك')}
                {ownedApartments.length > 1 && activeApartment ? ` (${tr('Lot', 'شقة')} ${activeApartment.number})` : ''}
              </span>
              <span className="text-sm font-bold text-white">
                {votedResolutionsCount} / {totalResolutions} {tr('résolutions votées', 'قرارات مصوت عليها')}
              </span>
            </div>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                isVotingCompleted
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
              }`}
            >
              {isVotingCompleted ? tr('Scrutin Complet ✓', 'اكتمل التصويت ✓') : tr('Vote en attente', 'في انتظار التصويت')}
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
              <div className="text-xs text-slate-500 font-medium">{tr('Votre Pouvoir de Vote Légal', 'قوتك التصويتية القانونية')}</div>
              <div className="text-base font-bold text-slate-900 flex flex-wrap items-center gap-2">
                <span>{residentName}</span>
                {ownedApartments.length > 1 ? (
                  <select
                    value={activeApartment?.id || ''}
                    onChange={(e) => {
                      setSelectedApartmentId(e.target.value);
                      setEditingResolutionId(null);
                    }}
                    aria-label={tr('Sélectionner le lot pour voter', 'اختر الوحدة للتصويت')}
                    className="text-xs font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-300"
                  >
                    {ownedApartments.map((apt) => (
                      <option key={apt.id} value={apt.id}>
                        {tr('Lot', 'شقة')} {apt.number} ({apt.tantiemes || 0} t.)
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                    {tr('Lot', 'شقة')} {residentLotNumber}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm">
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-center">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">{tr('Tantièmes attribués', 'الأجزاء المخصصة')}</span>
              <span className="font-mono font-bold text-teal-800 text-base">{residentTantiemes}</span>
              <span className="text-[10px] text-slate-500"> / {effectiveTotalTantiemes}</span>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-center">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">{tr('Poids relatif', 'الوزن النسبي')}</span>
              <span className="font-mono font-bold text-slate-900 text-base">
                {((residentTantiemes / effectiveTotalTantiemes) * 100).toFixed(1)}%
              </span>
              <span className="text-[10px] text-slate-500"> {tr('du scrutin', 'من الاقتراع')}</span>
            </div>

            <div
              className={`border rounded-lg px-3 py-1.5 text-center ${
                isOwner
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-slate-100 border-slate-300'
              }`}
            >
              <span
                className={`text-[10px] block font-semibold uppercase ${
                  isOwner ? 'text-emerald-600' : 'text-slate-500'
                }`}
              >
                {tr('Statut Électoral', 'الصفة الانتخابية')}
              </span>
              <span
                className={`font-bold text-xs ${
                  isOwner ? 'text-emerald-800' : 'text-slate-700'
                }`}
              >
                {isOwner
                  ? tr('Électeur Actif', 'مصوت نشط')
                  : tr('Consultation seule (Locataire)', 'اطلاع فقط (مكتري)')}
              </span>
              <span
                className={`text-[10px] block ${
                  isOwner ? 'text-emerald-600' : 'text-slate-500'
                }`}
              >
                {tr(legal.citations.statuteShortFr, legal.citations.statuteShortAr)}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Resolutions List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-slate-200">
          <div>
            <h3 className="font-bold text-slate-900 text-base">{tr('Ordre du Jour & Résolutions Soumises au Vote', 'جدول الأعمال والقرارات المعروضة للتصويت')}</h3>
            <p className="text-xs text-slate-500">
              {tr(
                `Chaque vote est automatiquement comptabilisé et pondéré avec vos ${residentTantiemes} tantièmes (Lot ${residentLotNumber})`,
                `يتم احتساب كل تصويت وترجيحه تلقائياً بحصتك البالغة ${residentTantiemes} جزء (شقة ${residentLotNumber})`
              )}
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {activeAG.resolutions.length} {tr(activeAG.resolutions.length > 1 ? 'résolutions' : 'résolution', 'قرارات')}
          </span>
        </div>

        {activeAG.resolutions.map((res) => {
          const ballots = getResolutionBallots(res);
          const totalTantiemesCast = res.votesFor + res.votesAgainst + res.votesAbstain;
          const myVote = findMyVote(res);
          const myVoteChoice = myVote ? (myVote.choice || myVote.vote || 'abstain') : undefined;
          const isEditing = editingResolutionId === res.id && canVote;
          const percentFor = totalTantiemesCast > 0 ? Math.round((res.votesFor / totalTantiemesCast) * 100) : 0;
          const percentAgainst = totalTantiemesCast > 0 ? Math.round((res.votesAgainst / totalTantiemesCast) * 100) : 0;
          const majorityLabel = formatMajorityLabel(res.majorityType, effectiveTotalTantiemes, tr);

          return (
            <Card key={res.id} className="p-5 border border-slate-200 space-y-4 bg-white transition-all shadow-xs">
              {/* Header: Resolution N°, Title, Status */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-0.5 rounded">
                      {tr('Résolution N°', 'القرار رقم')} {res.number}
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
                    {res.status === 'approved'
                      ? tr('✓ Adoptée', '✓ مصادق عليه')
                      : res.status === 'rejected'
                      ? tr('✗ Rejetée', '✗ مرفوض')
                      : tr('En délibération', 'قيد التداول')}
                  </span>
                </div>
              </div>

              {/* Tally Bar (Weighted by Tantièmes) */}
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2">
                <div className="flex flex-wrap justify-between items-center text-xs font-mono">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-bold text-emerald-700 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      {tr('POUR :', 'نعم:')} {res.votesFor} {tr('tantièmes', 'جزء')} ({percentFor}%)
                    </span>
                    <span className="font-bold text-rose-700 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                      {tr('CONTRE :', 'لا:')} {res.votesAgainst} {tr('tantièmes', 'جزء')} ({percentAgainst}%)
                    </span>
                    <span className="text-slate-500">
                      {tr('ABSTENTION :', 'امتناع:')} {res.votesAbstain} {tr('tantièmes', 'جزء')}
                    </span>
                  </div>
                  <span className="text-slate-500 text-[11px]">
                    {tr('Total exprimé :', 'مجموع الأصوات:')} <strong>{totalTantiemesCast} / {effectiveTotalTantiemes}</strong>
                  </span>
                </div>

                {/* Visual Progress Bar */}
                <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden flex shadow-inner">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300"
                    style={{ width: `${percentFor}%` }}
                  />
                  <div
                    className="bg-rose-500 h-full transition-all duration-300"
                    style={{ width: `${percentAgainst}%` }}
                  />
                  <div
                    className="bg-slate-400 h-full transition-all duration-300"
                    style={{
                      width: `${totalTantiemesCast > 0 ? Math.round((res.votesAbstain / totalTantiemesCast) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>

              {/* Resident's Digital Vote Status & Action Area */}
              <div className="pt-2 border-t border-slate-100">
                {myVote && !isEditing ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-teal-50/60 p-3.5 rounded-xl border border-teal-200">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-teal-900">
                          {tr('Votre Vote Enregistré', 'تصويتك المسجل')} ({tr('Lot', 'شقة')} {myVote.apartmentNumber}) :
                        </span>
                        <span
                          className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                            myVoteChoice === 'for'
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : myVoteChoice === 'against'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-slate-200 text-slate-800'
                          }`}
                        >
                          {myVoteChoice === 'for'
                            ? `✓ ${tr('POUR', 'موافق')} (+ ${myVote.tantiemes} ${tr('tantièmes', 'جزء')})`
                            : myVoteChoice === 'against'
                            ? `✗ ${tr('CONTRE', 'معارض')} (+ ${myVote.tantiemes} ${tr('tantièmes', 'جزء')})`
                            : `— ${tr('ABSTENTION', 'امتناع')} (${myVote.tantiemes} ${tr('tantièmes', 'جزء')})`}
                        </span>
                      </div>
                      <p className="text-[11px] text-teal-800/80 font-mono">
                        {tr('Validé le', 'تم التأكيد في')} {(myVote.castAt || myVote.votedAt) ? new Date((myVote.castAt || myVote.votedAt)!).toLocaleString(isAr ? 'ar-MA' : 'fr-MA') : '—'} · {tr('Pondération :', 'الوزن:')} {myVote.tantiemes}/{effectiveTotalTantiemes}
                      </p>
                      {myVote.comment && (
                        <p className="text-xs text-slate-700 italic bg-white p-2 rounded border border-teal-100 mt-1">
                          « {myVote.comment} »
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canVote && (
                        <button
                          onClick={() => handleStartVote(res)}
                          className="text-xs px-3 py-1.5 bg-white hover:bg-teal-100 text-teal-800 font-semibold rounded-lg border border-teal-300 transition-colors shadow-xs"
                        >
                          {tr('Modifier mon vote', 'تعديل تصويتي')}
                        </button>
                      )}
                      <button
                        onClick={() => setViewVotersResolution(res)}
                        className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                      >
                        {isClosed
                          ? `${tr('Votants', 'المصوتون')} (${ballots.length})`
                          : tr('Mon bulletin', 'تصويتي')}
                      </button>
                    </div>
                  </div>
                ) : isEditing ? (
                  /* Voting Form */
                  <div className="bg-slate-50 p-4 rounded-xl border border-teal-300 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <span>🗳️</span>
                        <span>
                          {tr(`Exprimez votre vote pour la Résolution N° ${res.number}`, `عبّر عن تصويتك للقرار رقم ${res.number}`)}
                        </span>
                      </span>
                      <span className="text-xs text-teal-800 font-mono font-bold">
                        {tr('Poids :', 'الوزن:')} {residentTantiemes} {tr('tantièmes', 'جزء')}
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
                        <span className="text-xs font-bold">{tr('VOTER POUR', 'التصويت بـ نعم')}</span>
                        <span className="text-[11px] text-emerald-700 font-mono">
                          +{residentTantiemes} {tr('tantièmes', 'جزء')}
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
                        <span className="text-xs font-bold">{tr('VOTER CONTRE', 'التصويت بـ لا')}</span>
                        <span className="text-[11px] text-rose-700 font-mono">
                          +{residentTantiemes} {tr('tantièmes', 'جزء')}
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
                        <span className="text-xs font-bold">{tr("S'ABSTENIR", 'الامتناع عن التصويت')}</span>
                        <span className="text-[11px] text-slate-600 font-mono">
                          {residentTantiemes} {tr('tantièmes', 'جزء')}
                        </span>
                      </button>
                    </div>

                    {/* Optional Note */}
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        {tr('Observation ou réserve au procès-verbal (facultatif) :', 'ملاحظة أو تحفظ في المحضر (اختياري):')}
                      </label>
                      <input
                        type="text"
                        value={voteComment}
                        onChange={(e) => setVoteComment(e.target.value)}
                        placeholder={tr('Ex: Vote favorable sous réserve du maintien de la garantie décennale...', 'مثال: تصويت إيجابي شريطة الحفاظ على الضمان العشري...')}
                        className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-teal-500 bg-white"
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Button
                        variant="secondary"
                        onClick={() => setEditingResolutionId(null)}
                        className="text-xs"
                      >
                        {tr('Annuler', 'إلغاء')}
                      </Button>
                      <Button
                        onClick={() => handleConfirmVote(res.id)}
                        disabled={voteMutation.isPending}
                        className="text-xs bg-teal-700 hover:bg-teal-800 text-white font-bold px-4 py-2"
                      >
                        {voteMutation.isPending
                          ? tr('Enregistrement sécurisé...', 'جاري التسجيل الآمن...')
                          : tr(`Confirmer mon vote (${residentTantiemes} tantièmes)`, `تأكيد تصويتي (${residentTantiemes} جزء)`)}
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Initial state when not voted yet */
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50/60 p-3.5 rounded-xl border border-amber-200">
                    <div>
                      <div className="text-xs font-bold text-amber-900">
                        {!isOwner
                          ? tr('Droit de vote réservé aux copropriétaires', 'حق التصويت مخصص للملاك المشتركين')
                          : !activeApartment
                          ? tr('Aucun lot privatif rattaché à votre compte', 'لا توجد وحدة مفرزة مرتبطة بحسابكم')
                          : !isVotingOpen
                          ? tr('Le scrutin électronique est actuellement fermé', 'التصويت الإلكتروني مغلق حالياً')
                          : tr("Votre vote n'a pas encore été enregistré sur cette résolution", 'لم يتم تسجيل تصويتك على هذا القرار بعد')}
                      </div>
                      <p className="text-[11px] text-amber-800">
                        {canVote
                          ? tr(
                              `Cliquez pour faire valoir vos ${residentTantiemes} tantièmes (Lot ${residentLotNumber}).`,
                              `اضغط للتصويت واستعمال حصتك البالغة ${residentTantiemes} جزء (شقة ${residentLotNumber}).`
                            )
                          : tr(
                              'Vous pouvez consulter les résultats et le détail officiel après clôture.',
                              'يمكنك الاطلاع على النتائج والتفاصيل الرسمية بعد الإغلاق.'
                            )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canVote && (
                        <Button
                          onClick={() => handleStartVote(res)}
                          className="text-xs bg-teal-700 hover:bg-teal-800 font-bold flex items-center gap-1.5 shadow-xs"
                        >
                          <span>🗳️</span>
                          <span>{tr(`Voter maintenant (+${residentTantiemes})`, `صوّت الآن (+${residentTantiemes})`)}</span>
                        </Button>
                      )}
                      <button
                        onClick={() => setViewVotersResolution(res)}
                        className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                      >
                        {isClosed
                          ? `${tr('Votants', 'المصوتون')} (${ballots.length})`
                          : tr('Détails', 'التفاصيل')}
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
          title={tr(
            `Registre des Votes · Résolution N° ${viewVotersResolution.number}`,
            `سجل الأصوات · القرار رقم ${viewVotersResolution.number}`
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
              <h4 className="font-bold text-slate-900 text-xs sm:text-sm">{viewVotersResolution.title}</h4>
              <p className="text-xs text-slate-600 mt-0.5">{viewVotersResolution.description}</p>
            </div>

            {!isClosed && (
              <div className="p-2.5 bg-teal-50 border border-teal-200 rounded-lg text-[11px] text-teal-900">
                {tr(
                  'Confidentialité du scrutin : pendant le vote, seul votre propre bulletin est affiché. Le détail nominal complet est publié dans le procès-verbal dès la clôture de l’assemblée.',
                  'سرية الاقتراع: أثناء التصويت، يظهر تصويتك الشخصي فقط. يُنشر التفصيل الاسمي الكامل في المحضر فور إغلاق الجمعية العامة.'
                )}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-50 text-slate-600 font-semibold">
                  <tr>
                    <th className="px-3 py-2 text-start">{tr('Copropriétaire', 'المالك المشترك')}</th>
                    <th className="px-3 py-2 text-start">{tr('Lot', 'الوحدة')}</th>
                    <th className="px-3 py-2 text-center">{tr('Poids Légal', 'الوزن القانوني')}</th>
                    <th className="px-3 py-2 text-center">{tr('Vote Exprimé', 'التصويت')}</th>
                    <th className="px-3 py-2 text-start">{tr('Date / Remarque', 'التاريخ / ملاحظة')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {getResolutionBallots(viewVotersResolution).map((v, i) => {
                    const choice = v.choice || v.vote || 'abstain';
                    return (
                      <tr key={v.apartmentId || `${v.residentId}-${i}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {v.residentName}
                          {v.residentId === currentResident?.id && (
                            <span className="ms-1.5 text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded font-semibold">
                              {tr('Vous', 'أنت')}
                            </span>
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
                          {v.comment && <div className="text-slate-700 italic font-sans mt-0.5">« {v.comment} »</div>}
                        </td>
                      </tr>
                    );
                  })}

                  {getResolutionBallots(viewVotersResolution).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                        {!isClosed
                          ? tr('Vous n’avez pas encore voté sur cette résolution.', 'لم تقم بالتصويت على هذا القرار بعد.')
                          : tr("Aucun vote n'a été enregistré sur cette résolution.", 'لم يتم تسجيل أي تصويت على هذا القرار.')}
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
          title={tr(`Règles Juridiques du Vote en Copropriété (${legal.citations.statuteShortFr})`, `القواعد القانونية للتصويت في الملكية المشتركة (${legal.citations.statuteShortAr})`)}
          footer={
            <div className="flex justify-end">
              <Button onClick={() => setShowLawInfoModal(false)}>{tr("J'ai compris", 'فهمت')}</Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
            <div className="p-3 bg-teal-50 rounded-lg border border-teal-200 text-teal-900">
              <p className="font-bold text-sm mb-1">
                {tr('Articles 18 & 21 - Quorum et pondération par tantièmes', 'المادتان 18 و 21 - النصاب والترجيح بالحصة الشائعة (الأجزاء)')}
              </p>
              <p>
                {tr(
                  `Chaque copropriétaire dispose d'un nombre de voix proportionnel à la quote-part de ses lots dans l'immeuble (base de votre résidence : ${effectiveTotalTantiemes} tantièmes ; quorum de 1ère convocation : ${effectiveQuorumRequired} tantièmes). En 2ème convocation (Art. 18), l'assemblée délibère valablement sans condition de quorum.`,
                  `يتمتع كل مالك مشترك بعدد من الأصوات يتناسب مع حصة وحداته في العقار (قاعدة إقامتكم: ${effectiveTotalTantiemes} جزء؛ نصاب الدعوة الأولى: ${effectiveQuorumRequired} جزء). في الدعوة الثانية (المادة 18)، تتداول الجمعية بشكل صحيح بدون شرط النصاب.`
                )}
              </p>
            </div>

            <div className="space-y-2">
              <h5 className="font-bold text-slate-900 text-sm">
                {tr('Les Régimes de Majorité Légale :', 'أنظمة الأغلبية القانونية:')}
              </h5>
              <div className="border border-slate-200 rounded-lg p-2.5">
                <span className="font-bold text-slate-900 block">
                  {tr('1. Majorité Simple (Article 21)', '1. الأغلبية البسيطة (المادة 21)')}
                </span>
                <p className="text-slate-600 mt-0.5">
                  {tr(
                    "Approbation des comptes, quitus de gestion, budget prévisionnel d'exploitation courante, petits travaux d'entretien. Adoptée si les tantièmes « POUR » dépassent les « CONTRE » parmi les voix exprimées.",
                    'المصادقة على الحسابات، إبراء ذمة السنديك، الميزانية التوقعية للتسيير العادي، وأشغال الصيانة البسيطة. تُعتمد إذا تجاوزت أصوات "نعم" أصوات "لا" من بين المصوتين.'
                  )}
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-2.5">
                <span className="font-bold text-slate-900 block">
                  {tr('2. Majorité Absolue (Article 22)', '2. الأغلبية المطلقة (المادة 22)')}
                </span>
                <p className="text-slate-600 mt-0.5">
                  {tr(
                    `Désignation du syndic, travaux d'amélioration ou renouvellement d'équipements. Nécessite au moins ${effectiveQuorumRequired} / ${effectiveTotalTantiemes} tantièmes de l'ensemble de la copropriété.`,
                    `تعيين السنديك، أشغال التحسين أو تجديد التجهيزات. تتطلب على الأقل ${effectiveQuorumRequired} / ${effectiveTotalTantiemes} جزء من مجموع الملكية المشتركة.`
                  )}
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-2.5">
                <span className="font-bold text-slate-900 block">
                  {tr(`3. Majorité des 3/4 (${legal.citations.agMajorityThreeQuartersRefFr})`, `3. أغلبية ثلاثة أرباع 3/4 (${legal.citations.agMajorityThreeQuartersRefAr})`)}
                </span>
                <p className="text-slate-600 mt-0.5">
                  {tr(
                    `Modification du règlement de copropriété, gros travaux affectant les parties communes. Nécessite au moins ${Math.ceil(effectiveTotalTantiemes * 0.75)} / ${effectiveTotalTantiemes} tantièmes.`,
                    `تعديل نظام الملكية المشتركة، الأشغال الكبرى المتعلقة بالأجزاء المشتركة. تتطلب على الأقل ${Math.ceil(effectiveTotalTantiemes * 0.75)} / ${effectiveTotalTantiemes} جزء.`
                  )}
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-2.5">
                <span className="font-bold text-slate-900 block">
                  {tr('4. Unanimité (Article 23)', '4. الإجماع (المادة 23)')}
                </span>
                <p className="text-slate-600 mt-0.5">
                  {tr(
                    `Aliénation d'une partie commune, surélévation, changement de destination de l'immeuble. Requiert ${effectiveTotalTantiemes} / ${effectiveTotalTantiemes} tantièmes.`,
                    `تفويت جزء مشترك، تعلية البناء، أو تغيير الغرض المخصص له العقار. يتطلب إجماع ${effectiveTotalTantiemes} / ${effectiveTotalTantiemes} جزء.`
                  )}
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

