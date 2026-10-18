import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Prestataire } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import {
  PrestatairesIcon,
  PhoneIcon,
  WhatsAppIcon,
  StarIcon,
} from '../icons/IconComponents';
import { getPrestatairesForBuilding, addPrestataireReview } from '../../firebase/services';
import Loading from '../common/Loading';
import { useI18n } from '../../hooks/useI18n';

interface ServiceProvidersDirectoryProps {
  building: Building;
  residentName?: string;
  apartmentNumber?: string;
  residentId?: string;
  isResidentPortal?: boolean;
}

export const ServiceProvidersDirectory: React.FC<ServiceProvidersDirectoryProps> = ({
  building,
  residentName = 'Résident',
  apartmentNumber = 'Lot A-102',
  residentId = 'res-2',
}) => {
  const { tr } = useI18n();
  const queryClient = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [emergencyOnly, setEmergencyOnly] = useState(false);

  const CATEGORY_FILTERS = [
    { id: 'all', label: tr("Tous les corps d'état", 'جميع التخصصات'), icon: '🛠️' },
    { id: 'plumbing', label: tr('Plomberie & Fuites', 'السباكة والتسربات'), icon: '🚰' },
    { id: 'electrical', label: tr('Électricité & Éclairage', 'الكهرباء والإنارة'), icon: '⚡' },
    { id: 'locksmith', label: tr('Serrurerie & Portes', 'الأقفال والأبواب'), icon: '🔑' },
    { id: 'elevator', label: tr('Ascensoristes', 'صيانة المصاعد'), icon: '🛗' },
    { id: 'air_conditioning', label: tr('Climatisation', 'التكييف'), icon: '❄️' },
    { id: 'cleaning', label: tr('Nettoyage & Hygiène', 'النظافة والتعقيم'), icon: '🧹' },
    { id: 'painting', label: tr('Peinture & Finitions', 'الصباغة والترميم'), icon: '🎨' },
  ];

  // Review Modal State
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [targetPrestataire, setTargetPrestataire] = useState<Prestataire | null>(null);
  const [ratingScore, setRatingScore] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  // Request Intervention Modal State
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [urgencyLevel, setUrgencyLevel] = useState<'urgent' | 'normal'>('urgent');
  const [problemDescription, setProblemDescription] = useState('');

  const { data: prestataires = [], isLoading } = useQuery({
    queryKey: ['prestataires', building.id],
    queryFn: () => getPrestatairesForBuilding(building.id),
  });

  const reviewMutation = useMutation({
    mutationFn: ({
      prestataireId,
      rating,
      comment,
    }: {
      prestataireId: string;
      rating: number;
      comment: string;
    }) =>
      addPrestataireReview(prestataireId, {
        residentId,
        residentName,
        apartmentNumber,
        rating,
        comment,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestataires', building.id] });
      setIsReviewModalOpen(false);
      setReviewComment('');
      setRatingScore(5);
      alert(tr('Merci ! Votre avis a été publié pour vos voisins.', 'شكراً! تم نشر تقييمكم لفائدة جيرانكم.'));
    },
  });

  const filteredPrestataires = useMemo(() => {
    return prestataires.filter((p) => {
      if (selectedCategory !== 'all' && p.category !== selectedCategory) return false;
      if (emergencyOnly && !p.isEmergency247) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesContact = p.contactPerson.toLowerCase().includes(q);
        const matchesPhone = p.phone.toLowerCase().includes(q);
        const matchesSpecialties = p.specialties?.some((s) => s.toLowerCase().includes(q));
        if (!matchesName && !matchesContact && !matchesPhone && !matchesSpecialties) return false;
      }
      return true;
    });
  }, [prestataires, selectedCategory, emergencyOnly, searchQuery]);

  const handleOpenReview = (p: Prestataire) => {
    setTargetPrestataire(p);
    setIsReviewModalOpen(true);
  };

  const handleOpenRequest = (p: Prestataire) => {
    setTargetPrestataire(p);
    setProblemDescription('');
    setIsRequestModalOpen(true);
  };

  const handleSendWhatsAppRequest = () => {
    if (!targetPrestataire) return;
    const cleanPhone = (targetPrestataire.whatsapp || targetPrestataire.phone)
      .replace(/\s+/g, '')
      .replace('+', '');
    const text = encodeURIComponent(
      tr(
        `Bonjour ${targetPrestataire.contactPerson || targetPrestataire.name},\nJe suis ${residentName} résidant à ${building.name} (${apartmentNumber}).\nJ'ai besoin d'une intervention : ${problemDescription || 'Demande de dépannage'}.\nUrgence : ${urgencyLevel === 'urgent' ? 'URGENT' : 'Normal'}.\nMerci de me contacter !`,
        `مرحباً ${targetPrestataire.contactPerson || targetPrestataire.name}،\nأنا ${residentName} ساكن في ${building.name} (${apartmentNumber}).\nأحتاج إلى تدخل تقني : ${problemDescription || 'طلب إصلاح'}.\nدرجة الاستعجال : ${urgencyLevel === 'urgent' ? 'مستعجل جداً' : 'عادي'}.\nشكراً للتواصل معي!`
      )
    );
    window.open(`https://wa.me/${cleanPhone}?text=${text}`, '_blank');
    setIsRequestModalOpen(false);
  };

  if (isLoading)
    return (
      <Loading
        message={tr(
          'Chargement des prestataires et artisans...',
          'جاري تحميل دليل مقدمي الخدمات والحرفيين...'
        )}
      />
    );

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="p-1.5 bg-amber-100 text-amber-800 rounded-lg">
                <PrestatairesIcon />
              </span>
              <span>
                {tr('Artisans & Prestataires Recommandés', 'الحرفيون ومقدمو الخدمات الموصى بهم')}
              </span>
            </h1>
            <span className="text-xs bg-teal-100 text-teal-800 font-semibold px-2.5 py-0.5 rounded-full">
              {tr('Loi 18-00 & Répertoire Agréé', 'قانون 18-00 والدليل المعتمد')}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {tr(
              'Artisans de confiance, plombiers, électriciens et serruriers agréés par le Syndic pour vos dépannages privatifs ou communs.',
              'حرفيون موثوقون، سباكون، كهربائيون وتقنيو أقفال معتمدون من طرف السنديك لإصلاحاتكم الخاصة أو المشتركة.'
            )}
          </p>
        </div>

        {/* Quick Emergency Toggle */}
        <button
          onClick={() => setEmergencyOnly(!emergencyOnly)}
          className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border ${
            emergencyOnly
              ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
              : 'bg-white hover:bg-rose-50 text-rose-700 border-rose-200'
          }`}
        >
          <span className="text-sm">🚨</span>
          <span>{tr('Urgences 24h/7j uniquement', 'طوارئ 24/7 فقط')}</span>
        </button>
      </div>

      {/* Emergency Quick Action Banner */}
      <div className="p-4 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 rounded-2xl text-white shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-bold text-xs uppercase tracking-wider flex items-center gap-1">
              <span>⚡ {tr('Dépannage Immédiat Résidence', 'تدخل فوري بالإقامة')}</span>
            </span>
            <span className="text-[10px] bg-rose-500/30 text-rose-300 font-bold px-2 py-0.5 rounded border border-rose-500/40">
              {tr('Astreinte active', 'مداومة نشطة')}
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-bold">
            {tr(
              "Fuite d'eau, panne électrique ou porte bloquée ?",
              'تسرب مياه، عطب كهربائي أو باب مغلق؟'
            )}
          </h3>
          <p className="text-xs text-slate-300 max-w-2xl">
            {tr(
              'Tous les prestataires listés ci-dessous ont été vérifiés par le Conseil Syndical (assurance RC pro, ICE valide et tarifs négociés).',
              'جميع مقدمي الخدمات المدرجين أدناه تم التحقق منهم من طرف مكتب السنديك (تأمين المسؤولية المدنية، تعريف ICE صالح وأسعار تفضيلية).'
            )}
          </p>
        </div>

        {/* Quick emergency call pills */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="tel:0662114477"
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
          >
            <PhoneIcon />
            <span>{tr('SOS Plombier', 'سباك طوارئ')}</span>
          </a>
          <a
            href="tel:0661774411"
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
          >
            <PhoneIcon />
            <span>{tr('SOS Serrurier', 'أقفال طوارئ')}</span>
          </a>
          <a
            href="tel:0522345678"
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
          >
            <PhoneIcon />
            <span>{tr('Ascenseur 24/7', 'المصعد 24/7')}</span>
          </a>
        </div>
      </div>

      {/* Category Pills & Search Toolbar */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              placeholder={tr(
                'Rechercher par artisan, métier, spécialité (ex: fuite, chauffe-eau, serrure)...',
                'البحث حسب الحرفي، المهنة أو التخصص (مثال: تسرب، سخان، قفل)...'
              )}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs sm:text-sm ps-9 pe-3 py-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <span className="absolute start-3 top-3 text-slate-400 text-xs">🔍</span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute end-3 top-2.5 text-xs text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            )}
          </div>

          <div className="text-xs text-slate-500 font-medium">
            <strong>{filteredPrestataires.length}</strong>{' '}
            {tr('artisan(s) disponible(s)', 'حرفي / مقدم خدمة متاح')}
          </div>
        </div>

        {/* Category Pills Slider */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          {CATEGORY_FILTERS.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                    : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Providers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredPrestataires.map((p) => {
          const cleanPhone = (p.whatsapp || p.phone).replace(/\s+/g, '').replace('+', '');
          const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
            tr(
              `Bonjour ${p.contactPerson || p.name}, je vous contacte depuis la Résidence ${building.name}. Avez-vous une disponibilité pour un dépannage ?`,
              `مرحباً ${p.contactPerson || p.name}، أتواصل معكم من إقامة ${building.name}. هل أنتم متاحون للتدخل والإصلاح؟`
            )
          )}`;

          return (
            <Card
              key={p.id}
              className="p-5 flex flex-col justify-between bg-white border border-slate-200 hover:border-teal-300 hover:shadow-md transition-all rounded-2xl relative overflow-hidden"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {p.isVerifiedBySyndic && (
                        <span className="text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <span>✓</span> {tr('Agréé Syndic', 'معتمد من السنديك')}
                        </span>
                      )}
                      {p.isEmergency247 && (
                        <span className="text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded-full flex items-center gap-0.5">
                          <span>🚨</span> 24/7
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-slate-900 mt-2">{p.name}</h3>
                    <p className="text-xs text-slate-500 font-medium">
                      {tr('Interlocuteur :', 'المخاطب :')} <strong>{p.contactPerson}</strong>
                    </p>
                  </div>

                  {/* Rating Badge */}
                  <div className="flex flex-col items-end shrink-0">
                    <div className="flex items-center gap-1 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                      <StarIcon filled />
                      <span className="font-bold text-xs text-amber-900">
                        {p.rating ? p.rating.toFixed(1) : '4.8'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 mt-0.5">
                      ({p.reviewsCount || (p.reviews ? p.reviews.length : 12)} {tr('avis', 'تقييم')})
                    </span>
                  </div>
                </div>

                {/* Specialties tags */}
                {p.specialties && p.specialties.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {p.specialties.map((s, idx) => (
                      <span
                        key={idx}
                        className="text-[10px] bg-slate-100 text-slate-700 font-medium px-2 py-0.5 rounded"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                {/* Tariff & Notes */}
                <div className="mt-3.5 pt-3 border-t border-slate-100 space-y-1 text-xs">
                  {p.hourlyRate && (
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="text-[11px] text-slate-400">
                        {tr('Tarif indicatif :', 'التعريفة التقريبية :')}
                      </span>
                      <span className="font-semibold text-slate-900">{p.hourlyRate}</span>
                    </div>
                  )}
                  {p.city && (
                    <div className="flex items-center justify-between text-slate-600">
                      <span className="text-[11px] text-slate-400">
                        {tr('Zone :', 'المنطقة :')}
                      </span>
                      <span className="text-slate-700">{p.city}</span>
                    </div>
                  )}
                  {p.notes && (
                    <p className="text-[11px] text-slate-500 italic mt-1 bg-slate-50 p-2 rounded border border-slate-100">
                      "{p.notes}"
                    </p>
                  )}
                </div>

                {/* Recent neighbor reviews snippet */}
                {p.reviews && p.reviews.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      {tr('Dernier avis copropriétaire :', 'آخر تقييم من السكان :')}
                    </p>
                    <div className="bg-slate-50 p-2 rounded text-[11px] text-slate-700 border border-slate-100 space-y-0.5">
                      <div className="flex items-center justify-between text-[10px] font-semibold text-slate-900">
                        <span>
                          {p.reviews[0].residentName} ({p.reviews[0].apartmentNumber})
                        </span>
                        <span className="text-amber-600">{'★'.repeat(p.reviews[0].rating)}</span>
                      </div>
                      <p className="italic text-slate-600">"{p.reviews[0].comment}"</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="mt-5 pt-3 border-t border-slate-100 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <a
                    href={`tel:${p.phone.replace(/\s+/g, '')}`}
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors shadow-sm"
                  >
                    <PhoneIcon />
                    <span>{tr('Appeler', 'اتصال')}</span>
                  </a>

                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors shadow-sm"
                  >
                    <WhatsAppIcon />
                    <span>WhatsApp</span>
                  </a>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <button
                    onClick={() => handleOpenReview(p)}
                    className="text-[11px] text-slate-600 hover:text-teal-700 font-semibold flex items-center gap-1"
                  >
                    <span>⭐</span>
                    <span>{tr('Laisser un avis', 'إضافة تقييم')}</span>
                  </button>

                  <button
                    onClick={() => handleOpenRequest(p)}
                    className="text-[11px] text-teal-700 hover:text-teal-900 font-bold underline"
                  >
                    {tr('Demander une intervention', 'طلب تدخل تقني')}
                  </button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {filteredPrestataires.length === 0 && (
        <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 space-y-2">
          <span className="text-3xl block">🔍</span>
          <p className="text-sm font-semibold text-slate-800">
            {tr(
              'Aucun prestataire ne correspond à vos critères de recherche.',
              'لا يوجد أي مقدم خدمة يطابق معايير البحث الخاصة بكم.'
            )}
          </p>
          <Button
            variant="secondary"
            onClick={() => {
              setSelectedCategory('all');
              setSearchQuery('');
              setEmergencyOnly(false);
            }}
            className="text-xs"
          >
            {tr('Réinitialiser les filtres', 'إعادة ضبط الفلاتر')}
          </Button>
        </div>
      )}

      {/* MODAL 1: ADD REVIEW */}
      <Modal
        isOpen={isReviewModalOpen}
        onClose={() => setIsReviewModalOpen(false)}
        title={`${tr('Laisser un avis sur', 'إضافة تقييم حول')} ${targetPrestataire?.name || ''}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsReviewModalOpen(false)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button
              onClick={() => {
                if (!targetPrestataire) return;
                if (!reviewComment.trim())
                  return alert(tr('Veuillez rédiger un court commentaire.', 'يرجى كتابة تعليق قصير.'));
                reviewMutation.mutate({
                  prestataireId: targetPrestataire.id,
                  rating: ratingScore,
                  comment: reviewComment.trim(),
                });
              }}
              disabled={reviewMutation.isPending}
            >
              {tr("Publier l'avis", 'نشر التقييم')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600">
            {tr(
              `Votre retour d'expérience aide l'ensemble des résidents de ${building.name} à choisir des artisans fiables.`,
              `يساعد تقييمكم جميع سكان إقامة ${building.name} على اختيار حرفيين موثوقين.`
            )}
          </p>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Note globale (sur 5 étoiles) :', 'التقييم العام (من 5 نجوم) :')}
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRatingScore(star)}
                  className="text-2xl hover:scale-110 transition-transform"
                >
                  {star <= ratingScore ? '⭐' : '☆'}
                </button>
              ))}
              <span className="font-bold text-slate-800 text-sm ms-2">
                {ratingScore} / 5
              </span>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Votre commentaire :', 'تعليقكم :')}
            </label>
            <textarea
              rows={3}
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder={tr(
                'Ponctualité, propreté du chantier, respect des tarifs annoncés...',
                'الالتزام بالمواعيد، جودة العمل، احترام الأسعار المتفق عليها...'
              )}
              className="w-full text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="bg-slate-50 p-2.5 rounded border border-slate-200 text-[11px] text-slate-500">
            {tr('Avis publié sous le nom de :', 'سيُنشر التقييم باسم :')}{' '}
            <strong>{residentName}</strong> ({apartmentNumber})
          </div>
        </div>
      </Modal>

      {/* MODAL 2: REQUEST INTERVENTION / QUOTE */}
      <Modal
        isOpen={isRequestModalOpen}
        onClose={() => setIsRequestModalOpen(false)}
        title={`${tr("Demande d'intervention à", 'طلب تدخل تقني من')} ${targetPrestataire?.name || ''}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsRequestModalOpen(false)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button onClick={handleSendWhatsAppRequest} className="bg-emerald-600 hover:bg-emerald-700">
              <span className="flex items-center gap-1.5">
                <WhatsAppIcon />
                <span>{tr('Envoyer sur WhatsApp', 'إرسال عبر واتساب')}</span>
              </span>
            </Button>
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600">
            {tr(
              "Un message WhatsApp structuré sera pré-rempli avec les coordonnées de votre appartement pour une prise en charge rapide par l'artisan.",
              'سيتم تجهيز رسالة واتساب منظمة تتضمن معلومات شقتكم لتسريع تكفل الحرفي بطلبكم.'
            )}
          </p>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr("Niveau d'urgence :", 'درجة الاستعجال :')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setUrgencyLevel('urgent')}
                className={`py-2 px-3 rounded-lg font-bold text-xs border transition-all ${
                  urgencyLevel === 'urgent'
                    ? 'bg-rose-50 border-rose-300 text-rose-700'
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                🚨 {tr('Urgent (Intervention rapide)', 'مستعجل (تدخل فوري)')}
              </button>
              <button
                type="button"
                onClick={() => setUrgencyLevel('normal')}
                className={`py-2 px-3 rounded-lg font-bold text-xs border transition-all ${
                  urgencyLevel === 'normal'
                    ? 'bg-teal-50 border-teal-300 text-teal-800'
                    : 'bg-white border-slate-200 text-slate-600'
                }`}
              >
                🗓️ {tr('Normal (Devis / Rénovation)', 'عادي (طلب عرض سعر / إصلاح)')}
              </button>
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Description de la panne ou du besoin :', 'وصف العطب أو الحاجة :')}
            </label>
            <textarea
              rows={3}
              value={problemDescription}
              onChange={(e) => setProblemDescription(e.target.value)}
              placeholder={tr(
                "Ex: Robinet qui fuit sous l'évier de la cuisine, besoin d'un changement de joint...",
                'مثال: تسرب مياه تحت حوض المطبخ، حاجة لتغيير الصمام...'
              )}
              className="w-full text-xs p-3 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1 text-[11px] text-slate-600">
            <div>
              {tr('Artisan contacté :', 'الحرفي المعني :')}{' '}
              <strong>{targetPrestataire?.name}</strong> ({targetPrestataire?.contactPerson})
            </div>
            <div>
              {tr('Téléphone :', 'الهاتف :')} <strong>{targetPrestataire?.phone}</strong>
            </div>
            <div>
              {tr('Immeuble :', 'الإقامة :')} <strong>{building.name}</strong> · {tr('Lot :', 'الشقة :')}{' '}
              <strong>{apartmentNumber}</strong>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ServiceProvidersDirectory;
