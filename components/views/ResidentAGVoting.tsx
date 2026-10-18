import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Syndic, Resident, Apartment, AGResolution } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { AGIcon, DocumentsIcon } from '../icons/IconComponents';
import { getAssembleesGeneralesForBuilding, castResidentAGVote } from '../../firebase/services';
import { generatePvAgPDF } from '../../services/pdfService';
import Loading from '../common/Loading';
import { useI18n } from '../../hooks/useI18n';

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
  const { tr, isAr } = useI18n();
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
  const residentName = currentResident?.name || tr('Copropriétaire', 'مالك مشترك');

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
        throw new Error(tr('Profil copropriétaire introuvable', 'ملف المالك المشترك غير موجود'));
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
                {tr('Loi n° 18-00 · Art. 21 à 24', 'القانون رقم 18-00 · المواد 21 إلى 24')}
              </span>
              <span className="text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                {tr('Vote Électronique Ouvert', 'التصويت الإلكتروني مفتوح')}
              </span>
              <span className="text-xs text-teal-200">
                {activeAG.type === 'AGO'
                  ? tr('Assemblée Générale Ordinaire', 'الجمع العام العادي')
                  : tr('Assemblée Générale Extraordinaire', 'الجمع العام الاستثنائي')}
              </span>
            </div>

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

          <div className="flex flex-col sm:flex-row md:flex-col items-end gap-2.5 shrink-0">
            <Button
              variant="secondary"
              onClick={() => generatePvAgPDF(activeAG, building, syndic)}
              className="text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 flex items-center gap-1.5"
            >
              <DocumentsIcon />
              <span>{tr('Télécharger le PV / Ordre du jour (PDF)', 'تحميل المحضر / جدول الأعمال (PDF)')}</span>
            </Button>
            <button
              onClick={() => setShowLawInfoModal(true)}
              className="text-[11px] text-teal-300 hover:text-white underline"
            >
              {tr('Comprendre la règle des tantièmes (Loi 18-00)', 'فهم قاعدة الحصة الشائعة (القانون 18-00)')}
            </button>
          </div>
        </div>

        {/* Quorum Progress Bar */}
        <div className="mt-5 pt-4 border-t border-teal-700/60 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-8 space-y-1.5">
            <div className="flex justify-between items-center text-xs">
              <span className="text-teal-200 font-medium">{tr('Participation & Quorum légal en séance :', 'المشاركة والنصاب القانوني للجلسة:')}</span>
              <span className="font-mono font-bold text-white">
                {activeAG.presentTantiemes} / {activeAG.totalTantiemes || 1000} {tr('tantièmes', 'جزء')} ({Math.round(((activeAG.presentTantiemes || 0) / (activeAG.totalTantiemes || 1000)) * 100)}%)
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
              <span>
                {activeAG.quorumReached
                  ? tr('✓ Quorum de 1ère convocation atteint (> 50%)', '✓ تم بلوغ النصاب القانوني للدعوة الأولى (> 50%)')
                  : tr('⚠ Quorum en cours de consolidation', '⚠ النصاب القانوني قيد الاستكمال')}
              </span>
              <span>{tr('Seuil requis : 500/1000 tantièmes', 'العتبة المطلوبة: 500/1000 جزء')}</span>
            </div>
          </div>

          <div className="md:col-span-4 bg-teal-950/40 p-3 rounded-lg border border-teal-600/30 flex items-center justify-between">
            <div>
              <span className="text-[10px] text-teal-300 uppercase tracking-wider block font-semibold">
                {tr('Votre Avancement', 'تقدم تصويتك')}
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
              <div className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>{residentName}</span>
                <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                  {tr('Lot', 'شقة')} {residentLotNumber}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm">
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-center">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">{tr('Tantièmes attribués', 'الأجزاء المخصصة')}</span>
              <span className="font-mono font-bold text-teal-800 text-base">{residentTantiemes}</span>
              <span className="text-[10px] text-slate-500"> / 1000</span>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-center">
              <span className="text-[10px] text-slate-400 block font-semibold uppercase">{tr('Poids relatif', 'الوزن النسبي')}</span>
              <span className="font-mono font-bold text-slate-900 text-base">
                {((residentTantiemes / 1000) * 100).toFixed(1)}%
              </span>
              <span className="text-[10px] text-slate-500"> {tr('du scrutin', 'من الاقتراع')}</span>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 text-center">
              <span className="text-[10px] text-emerald-600 block font-semibold uppercase">{tr('Statut Électoral', 'الصفة الانتخابية')}</span>
              <span className="font-bold text-emerald-800 text-xs">{tr('Électeur Actif', 'مصوت نشط')}</span>
              <span className="text-[10px] text-emerald-600 block">{tr('Loi n° 18-00', 'القانون 18-00')}</span>
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
                `Chaque vote est automatiquement comptabilisé et pondéré avec vos ${residentTantiemes} tantièmes`,
                `يتم احتساب كل تصويت وترجيحه تلقائياً بحصتك البالغة ${residentTantiemes} جزء`
              )}
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {activeAG.resolutions.length} {tr(activeAG.resolutions.length > 1 ? 'résolutions' : 'résolution', 'قرارات')}
          </span>
        </div>

        {activeAG.resolutions.map((res) => {
          const totalTantiemesCast = res.votesFor + res.votesAgainst + res.votesAbstain;
          const myVote = res.voters?.find((v) => v.residentId === currentResident?.id);
          const isEditing = editingResolutionId === res.id;
          const percentFor = totalTantiemesCast > 0 ? Math.round((res.votesFor / totalTantiemesCast) * 100) : 0;
          const percentAgainst = totalTantiemesCast > 0 ? Math.round((res.votesAgainst / totalTantiemesCast) * 100) : 0;

          const majorityLabel =
            res.majorityType === 'simple'
              ? tr('Majorité simple (Art. 21) · Majorité des voix exprimées', 'الأغلبية البسيطة (المادة 21) · أغلبية الأصوات المعبر عنها')
              : res.majorityType === 'absolute'
              ? tr('Majorité absolue (Art. 22) · Au moins 501 / 1000 tantièmes', 'الأغلبية المطلقة (المادة 22) · على الأقل 501 / 1000 جزء')
              : tr('Unanimité (Art. 23) · 1000 / 1000 tantièmes', 'الإجماع (المادة 23) · 1000 / 1000 جزء');

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
                  <div className="flex items-center gap-3">
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
                    {tr('Total exprimé :', 'مجموع الأصوات:')} <strong>{totalTantiemesCast} / 1000</strong>
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
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-teal-900">{tr('Votre Vote Enregistré :', 'تصويتك المسجل:')}</span>
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
                            ? `✓ ${tr('POUR', 'موافق')} (+ ${myVote.tantiemes} ${tr('tantièmes', 'جزء')})`
                            : myVote.vote === 'against'
                            ? `✗ ${tr('CONTRE', 'معارض')} (+ ${myVote.tantiemes} ${tr('tantièmes', 'جزء')})`
                            : `— ${tr('ABSTENTION', 'امتناع')} (${myVote.tantiemes} ${tr('tantièmes', 'جزء')})`}
                        </span>
                      </div>
                      <p className="text-[11px] text-teal-800/80 font-mono">
                        {tr('Validé le', 'تم التأكيد في')} {new Date(myVote.castAt).toLocaleString(isAr ? 'ar-MA' : 'fr-MA')} · {tr('Pondération :', 'الوزن:')} {myVote.tantiemes}/1000
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
                        {tr('Modifier mon vote', 'تعديل تصويتي')}
                      </button>
                      <button
                        onClick={() => setViewVotersResolution(res)}
                        className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                      >
                        {tr('Votants', 'المصوتون')} ({res.voters?.length || 0})
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
                        {tr('Observation ou réserve au procès-verbal (facultatif - Loi 18-00) :', 'ملاحظة أو تحفظ في المحضر (اختياري - القانون 18-00):')}
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
                      {myVote && (
                        <Button
                          variant="secondary"
                          onClick={() => setEditingResolutionId(null)}
                          className="text-xs"
                        >
                          {tr('Annuler', 'إلغاء')}
                        </Button>
                      )}
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
                        {tr("Votre vote n'a pas encore été enregistré sur cette résolution", 'لم يتم تسجيل تصويتك على هذا القرار بعد')}
                      </div>
                      <p className="text-[11px] text-amber-800">
                        {tr(
                          `Cliquez pour faire valoir vos ${residentTantiemes} tantièmes de copropriété.`,
                          `اضغط للتصويت واستعمال حصتك البالغة ${residentTantiemes} جزء في الملكية المشتركة.`
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        onClick={() => handleStartVote(res)}
                        className="text-xs bg-teal-700 hover:bg-teal-800 font-bold flex items-center gap-1.5 shadow-xs"
                      >
                        <span>🗳️</span>
                        <span>{tr(`Voter maintenant (+${residentTantiemes})`, `صوّت الآن (+${residentTantiemes})`)}</span>
                      </Button>
                      <button
                        onClick={() => setViewVotersResolution(res)}
                        className="text-xs px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
                      >
                        {tr('Votants', 'المصوتون')} ({res.voters?.length || 0})
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
                  {viewVotersResolution.voters?.map((v, i) => (
                    <tr key={i} className="hover:bg-slate-50">
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
                          {v.vote === 'for' ? tr('POUR', 'موافق') : v.vote === 'against' ? tr('CONTRE', 'معارض') : tr('ABSTENTION', 'ممتنع')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500 font-mono text-[11px]">
                        {new Date(v.castAt).toLocaleString(isAr ? 'ar-MA' : 'fr-MA')}
                        {v.comment && <div className="text-slate-700 italic font-sans mt-0.5">« {v.comment} »</div>}
                      </td>
                    </tr>
                  ))}

                  {(!viewVotersResolution.voters || viewVotersResolution.voters.length === 0) && (
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

      {/* Modal: Legal Explanations of Moroccan Co-ownership Voting */}
      {showLawInfoModal && (
        <Modal
          isOpen={showLawInfoModal}
          onClose={() => setShowLawInfoModal(false)}
          title={tr('Règles Juridiques du Vote en Copropriété (Loi 18-00 & 106-12)', 'القواعد القانونية للتصويت في الملكية المشتركة (القانون 18-00 و 106-12)')}
          footer={
            <div className="flex justify-end">
              <Button onClick={() => setShowLawInfoModal(false)}>{tr("J'ai compris", 'فهمت')}</Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
            <div className="p-3 bg-teal-50 rounded-lg border border-teal-200 text-teal-900">
              <p className="font-bold text-sm mb-1">
                {tr('Article 21 - Principe de la pondération par tantièmes', 'المادة 21 - مبدأ الترجيح بالحصة الشائعة (الأجزاء)')}
              </p>
              <p>
                {tr(
                  "Chaque copropriétaire dispose d'un nombre de voix proportionnel à la quote-part de ses parties privatives dans l'ensemble de l'immeuble. La base de calcul usuelle est de 1 000 tantièmes.",
                  'يتمتع كل مالك مشترك بعدد من الأصوات يتناسب مع حصة أجزائه المفرزة في مجموع العقار. قاعدة الحساب المعتمدة هي 1000 جزء.'
                )}
              </p>
            </div>

            <div className="space-y-2">
              <h5 className="font-bold text-slate-900 text-sm">
                {tr('Les Trois Régimes de Majorité Légale :', 'أنظمة الأغلبية القانونية الثلاثة:')}
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
                    "Gros travaux d'amélioration, réfection étanchéité ou ascenseur, modification du règlement de copropriété. Nécessite au moins 501 / 1000 tantièmes de la totalité de la copropriété.",
                    'أشغال التحسين الكبرى، إصلاح العزل المائي أو المصعد، تعديل نظام الملكية المشتركة. تتطلب على الأقل 501 / 1000 جزء من مجموع الملكية المشتركة.'
                  )}
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-2.5">
                <span className="font-bold text-slate-900 block">
                  {tr('3. Unanimité (Article 23)', '3. الإجماع (المادة 23)')}
                </span>
                <p className="text-slate-600 mt-0.5">
                  {tr(
                    "Aliénation d'une partie commune, surélévation, changement de destination de l'immeuble. Requiert 1 000 / 1 000 tantièmes.",
                    'تفويت جزء مشترك، تعلية البناء، أو تغيير الغرض المخصص له العقار. يتطلب إجماع 1000 / 1000 جزء.'
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
