import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Prestataire } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { PrestatairesIcon, PlusIcon, PencilIcon, TrashIcon } from '../icons/IconComponents';
import { getPrestatairesForBuilding, savePrestataire, deletePrestataire } from '../../firebase/services';
import Loading from '../common/Loading';
import ServiceProvidersDirectory from './ServiceProvidersDirectory';
import { useI18n } from '../../hooks/useI18n';

interface PrestatairesProps {
  building: Building;
}

const PrestatairesView: React.FC<PrestatairesProps> = ({ building }) => {
  const { tr } = useI18n();
  const queryClient = useQueryClient();
  const [activeViewMode, setActiveViewMode] = useState<'directory' | 'legal'>('directory');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPrestataire, setEditingPrestataire] = useState<Prestataire | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<Prestataire['category']>('plumbing');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [ice, setIce] = useState('');
  const [rc, setRc] = useState('');
  const [notes, setNotes] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [isEmergency247, setIsEmergency247] = useState(false);
  const [isVerifiedBySyndic, setIsVerifiedBySyndic] = useState(true);

  const { data: prestataires = [], isLoading } = useQuery({
    queryKey: ['prestataires', building.id],
    queryFn: () => getPrestatairesForBuilding(building.id),
  });

  const saveMutation = useMutation({
    mutationFn: savePrestataire,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestataires', building.id] });
      setIsModalOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePrestataire,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prestataires', building.id] }),
  });

  const resetForm = () => {
    setName('');
    setCategory('plumbing');
    setContactPerson('');
    setPhone('');
    setWhatsapp('');
    setEmail('');
    setIce('');
    setRc('');
    setNotes('');
    setHourlyRate('');
    setIsEmergency247(false);
    setIsVerifiedBySyndic(true);
    setEditingPrestataire(null);
  };

  const handleOpenEdit = (p: Prestataire) => {
    setEditingPrestataire(p);
    setName(p.name);
    setCategory(p.category);
    setContactPerson(p.contactPerson);
    setPhone(p.phone);
    setWhatsapp(p.whatsapp || '');
    setEmail(p.email);
    setIce(p.ice || '');
    setRc(p.rc || '');
    setNotes(p.notes || '');
    setHourlyRate(p.hourlyRate || '');
    setIsEmergency247(!!p.isEmergency247);
    setIsVerifiedBySyndic(p.isVerifiedBySyndic ?? true);
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!name || !phone)
      return alert(
        tr(
          "Le nom de l'entreprise et le téléphone sont obligatoires.",
          'اسم الشركة ورقم الهاتف إلزاميان.'
        )
      );

    const payload: Prestataire = {
      id: editingPrestataire?.id || `prest-${Date.now()}`,
      buildingId: building.id,
      syndicId: building.syndicId,
      name,
      category,
      contactPerson,
      phone,
      whatsapp: whatsapp || phone.replace(/\s+/g, ''),
      email,
      ice,
      rc,
      active: true,
      notes,
      hourlyRate,
      isEmergency247,
      isVerifiedBySyndic,
      rating: editingPrestataire?.rating || 4.8,
      reviewsCount: editingPrestataire?.reviewsCount || (editingPrestataire?.reviews?.length || 1),
      reviews: editingPrestataire?.reviews || [],
    };

    saveMutation.mutate(payload);
  };

  const categoryLabels: Record<Prestataire['category'], string> = {
    elevator: tr('Ascensoriste', 'صيانة المصاعد'),
    cleaning: tr('Société de Nettoyage', 'شركة النظافة'),
    plumbing: tr('Plomberie & Surpresseur', 'السباكة والمضخات'),
    electrical: tr('Électricité & Éclairage', 'الكهرباء والإنارة'),
    security: tr('Gardiennage & Sécurité', 'الحراسة والأمن'),
    gardener: tr('Espaces Verts', 'البستنة والمساحات الخضراء'),
    locksmith: tr('Serrurerie & Dépannage', 'الأقفال والمفاتيح'),
    painting: tr('Peinture & Rénovation', 'الصباغة والترميم'),
    air_conditioning: tr('Climatisation & Froid', 'التكييف والتبريد'),
    insurance: tr("Compagnie d'Assurance", 'شركة التأمين'),
    other: tr('Autre Service', 'خدمة أخرى'),
  };

  if (isLoading)
    return <Loading message={tr('Chargement des prestataires...', 'جاري تحميل مقدمي الخدمات...')} />;

  return (
    <div className="space-y-6">
      {/* View Mode Toggle Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <PrestatairesIcon />
            <span>
              {tr("Prestataires & Artisans de l'Immeuble", 'مقدمو الخدمات والحرفيون المعتمدون')}
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {tr(
              `Répertoire des artisans, dépannages d'urgence et contrats officiels pour ${building.name}`,
              `دليل الحرفيين، تدخلات الطوارئ والعقود الرسمية لإقامة ${building.name}`
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setActiveViewMode('directory')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeViewMode === 'directory'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🛠️ {tr('Répertoire & Avis Résidents', 'الدليل وتقييمات السكان')}
            </button>
            <button
              onClick={() => setActiveViewMode('legal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeViewMode === 'legal'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📑 {tr('Gestion Contrats & ICE/RC', 'تدبير العقود و ICE/RC')}
            </button>
          </div>

          <Button
            onClick={() => {
              resetForm();
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 text-xs font-bold"
          >
            <PlusIcon />
            <span>{tr('Ajouter', 'إضافة')}</span>
          </Button>
        </div>
      </div>

      {/* VIEW MODE 1: DIRECTORY & RESIDENT REVIEWS */}
      {activeViewMode === 'directory' && (
        <ServiceProvidersDirectory
          building={building}
          isResidentPortal={false}
          residentName={tr('Syndic Gestionnaire', 'وكيل الاتحاد (السنديك)')}
          apartmentNumber={tr('Bureau Syndic', 'مكتب السنديك')}
        />
      )}

      {/* VIEW MODE 2: LEGAL & CONTRACTS VIEW */}
      {activeViewMode === 'legal' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {prestataires.map((p) => (
              <Card
                key={p.id}
                className="p-5 border border-slate-200 hover:border-teal-300 transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded">
                        {categoryLabels[p.category] || p.category}
                      </span>
                      <h3 className="font-bold text-slate-900 text-base mt-2">{p.name}</h3>
                      <p className="text-xs text-slate-500">
                        {tr('Contact :', 'المسؤول :')} {p.contactPerson || tr('Non spécifié', 'غير محدد')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleOpenEdit(p)}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded"
                        title={tr('Modifier', 'تعديل')}
                      >
                        <PencilIcon />
                      </button>
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              tr(
                                `Supprimer le prestataire ${p.name} ?`,
                                `حذف مقدم الخدمة ${p.name} ؟`
                              )
                            )
                          ) {
                            deleteMutation.mutate(p.id);
                          }
                        }}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded"
                        title={tr('Supprimer', 'حذف')}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>

                  {/* Legal & Contact info */}
                  <div className="mt-4 space-y-1.5 text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100">
                    <div className="flex justify-between">
                      <span className="text-slate-400">{tr('Tél :', 'الهاتف :')}</span>
                      <a href={`tel:${p.phone}`} className="font-semibold text-teal-700 hover:underline">
                        {p.phone}
                      </a>
                    </div>
                    {p.email && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">{tr('Email :', 'البريد :')}</span>
                        <a href={`mailto:${p.email}`} className="text-slate-700 truncate max-w-[180px]">
                          {p.email}
                        </a>
                      </div>
                    )}
                    {p.ice && (
                      <div className="flex justify-between font-mono">
                        <span className="text-slate-400">ICE :</span>
                        <span>{p.ice}</span>
                      </div>
                    )}
                    {p.rc && (
                      <div className="flex justify-between font-mono">
                        <span className="text-slate-400">RC :</span>
                        <span>{p.rc}</span>
                      </div>
                    )}
                  </div>

                  {p.notes && (
                    <p className="text-xs text-slate-500 mt-3 italic line-clamp-2">"{p.notes}"</p>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    {tr('Contrat actif', 'عقد ساري المفعول')}
                  </span>
                  <a
                    href={`tel:${p.phone}`}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-medium transition-colors"
                  >
                    {tr('Appeler', 'اتصال')}
                  </a>
                </div>
              </Card>
            ))}
          </div>

          {prestataires.length === 0 && (
            <Card className="p-8 text-center text-slate-500 text-sm">
              {tr(
                'Aucun prestataire enregistré. Ajoutez des artisans ou prestataires pour faciliter la maintenance de votre copropriété.',
                'لا يوجد أي مقدم خدمة مسجل. أضيفوا الحرفيين أو الشركات لتسهيل صيانة الملكية المشتركة.'
              )}
            </Card>
          )}
        </div>
      )}

      {/* Modal Add / Edit Prestataire */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        title={
          editingPrestataire
            ? tr('Modifier le prestataire', 'تعديل مقدم الخدمة')
            : tr('Ajouter un prestataire sous contrat', 'إضافة مقدم خدمة متعاقد')
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
            >
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button onClick={handleSave}>{tr('Enregistrer', 'حفظ')}</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr("Nom de l'Entreprise / Artisan *", 'اسم الشركة / الحرفي *')}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr('Ex: Atlas Ascenseurs SARL', 'مثال: أطلس للمصاعد ش.م.م')}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Corps de métier', 'التخصص المهني')}
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="plumbing">{tr('Plomberie & Fuites', 'السباكة وتسربات المياه')}</option>
                <option value="electrical">{tr('Électricité & Domotique', 'الكهرباء والإنارة')}</option>
                <option value="locksmith">{tr('Serrurerie & Dépannage', 'الأقفال والمفاتيح')}</option>
                <option value="elevator">{tr('Ascensoriste', 'صيانة المصاعد')}</option>
                <option value="cleaning">{tr('Société de Nettoyage', 'شركة النظافة')}</option>
                <option value="air_conditioning">{tr('Climatisation & Froid', 'التكييف والتبريد')}</option>
                <option value="painting">{tr('Peinture & Rénovation', 'الصباغة والترميم')}</option>
                <option value="security">{tr('Gardiennage / Sécurité', 'الحراسة والأمن')}</option>
                <option value="gardener">{tr('Espaces Verts', 'البستنة والمساحات الخضراء')}</option>
                <option value="insurance">{tr("Compagnie d'Assurance", 'شركة التأمين')}</option>
                <option value="other">{tr('Autre Service', 'خدمة أخرى')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Personne de contact', 'المخاطب المسؤول')}
              </label>
              <input
                type="text"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                placeholder={tr('Ex: Hassan Amrani', 'مثال: حسن العمراني')}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Téléphone *', 'الهاتف *')}
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ex: 0522 34 56 78"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('WhatsApp (direct)', 'واتساب (مباشر)')}
              </label>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="Ex: 0661 88 99 00"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Email', 'البريد الإلكتروني')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ex: contact@atlas.ma"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Tarif indicatif', 'التعريفة التقريبية')}
              </label>
              <input
                type="text"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder={tr('Ex: À partir de 150 DH', 'مثال: ابتداءً من 150 درهم')}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('ICE (Maroc)', 'التعريف الموحد للمقاولة ICE')}
              </label>
              <input
                type="text"
                value={ice}
                onChange={(e) => setIce(e.target.value)}
                placeholder="Ex: 001988223000089"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('RC (Registre Commerce)', 'السجل التجاري RC')}
              </label>
              <input
                type="text"
                value={rc}
                onChange={(e) => setRc(e.target.value)}
                placeholder="Ex: 45678 Casablanca"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isEmergency247}
                onChange={(e) => setIsEmergency247(e.target.checked)}
                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>🚨 {tr('Astreinte Dépannage Urgent 24h/7j', 'خدمة طوارئ مستمرة 24/7')}</span>
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isVerifiedBySyndic}
                onChange={(e) => setIsVerifiedBySyndic(e.target.checked)}
                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>✓ {tr('Agréé par le Syndic (Loi 18-00)', 'معتمد من طرف السنديك (قانون 18-00)')}</span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Conditions de contrat & notes', 'شروط العقد وملاحظات')}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={tr(
                'Ex: Astreinte 24/7, visite de maintenance le 1er mardi du mois...',
                'مثال: مداومة 24/7، زيارة صيانة دورية كل أول ثلاثاء من الشهر...'
              )}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PrestatairesView;
