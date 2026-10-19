import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Prestataire } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import {
  PrestatairesIcon,
  PlusIcon,
  PencilIcon,
  TrashIcon,
  DocumentsIcon,
} from '../icons/IconComponents';
import {
  getPrestatairesForBuilding,
  savePrestataire,
  deletePrestataire,
  regeneratePrestataireCredentials,
  recordPrestataireCredentialShare,
} from '../../firebase/services';
import { exportPrestataireCredentialsPDF } from '../../services/pdfService';
import { useAuth } from '../../contexts/AuthContext';
import Loading from '../common/Loading';
import ServiceProvidersDirectory from './ServiceProvidersDirectory';
import { useI18n } from '../../hooks/useI18n';

function formatAuditTimestamp(iso?: string, lang?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(lang === 'ar' ? 'ar-MA' : 'fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

interface PrestatairesProps {
  building: Building;
}

const PrestataireCredentialsModal: React.FC<{
  prestataire: Prestataire | null;
  building: Building;
  categoryLabel: string;
  onClose: () => void;
  onRegenerate: (prestataireId: string) => void;
  onShareRecorded?: (prestataireId: string, method: 'pdf' | 'copy') => void;
}> = ({
  prestataire,
  building,
  categoryLabel,
  onClose,
  onRegenerate,
  onShareRecorded,
}) => {
  const { tr, language } = useI18n();
  const [copied, setCopied] = useState(false);

  if (!prestataire) return null;

  const password = prestataire.generatedPassword || 'Syn-2026-MA';
  const portalUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/login` : 'https://syndik.ma/login';

  const shareText = tr(
    `Bonjour ${prestataire.contactPerson || prestataire.name},\nVoici vos identifiants officiels d'accès au Portail Prestataire Agréé (${building.name}) :\n• Lien de connexion : ${portalUrl}\n• Entreprise : ${prestataire.name} (${categoryLabel})\n• Identifiant (Email) : ${prestataire.email}\n• Mot de passe temporaire : ${password}\nNote : Lors de votre première connexion, il vous sera demandé de définir un mot de passe personnel.`,
    `مرحباً ${prestataire.contactPerson || prestataire.name}،\nإليكم بيانات الولوج الرسمية إلى بوابة مقدمي الخدمات المعتمدين (${building.name}) :\n• رابط الدخول : ${portalUrl}\n• المقاولة : ${prestataire.name} (${categoryLabel})\n• المعرف (البريد الإلكتروني) : ${prestataire.email}\n• كلمة المرور المؤقتة : ${password}\nملاحظة : عند أول تسجيل دخول، سيُطلب منكم تعيين كلمة مرور شخصية جديدة.`
  );

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
    onShareRecorded?.(prestataire.id, 'copy');
  };

  const handleDownloadPDF = () => {
    exportPrestataireCredentialsPDF(prestataire, building);
    onShareRecorded?.(prestataire.id, 'pdf');
  };

  return (
    <Modal
      isOpen={!!prestataire}
      onClose={onClose}
      title={tr("Fiche Officielle d'Accès Prestataire Agréé", 'بطاقة الولوج الرسمية لمقدم الخدمة المعتمد')}
      footer={
        <div className="flex flex-wrap items-center justify-between w-full gap-2">
          <button
            type="button"
            onClick={() => onRegenerate(prestataire.id)}
            className="text-xs font-semibold text-slate-600 hover:text-teal-700 underline"
          >
            {tr('🔄 Régénérer un mot de passe temporaire', '🔄 إعادة توليد كلمة مرور مؤقتة')}
          </button>
          <div className="flex flex-wrap items-center gap-2 ms-auto">
            <Button variant="secondary" onClick={onClose}>
              {tr('Fermer', 'إغلاق')}
            </Button>
            <Button
              variant="secondary"
              onClick={handleDownloadPDF}
              className="flex items-center gap-1.5 border-teal-200 text-teal-800 hover:bg-teal-50"
            >
              <DocumentsIcon />
              <span>{tr("Fiche d'Accès PDF", 'تحميل بطاقة PDF')}</span>
            </Button>
            <Button onClick={handleCopy}>
              {copied
                ? tr('✓ Identifiants copiés !', '✓ تم نسخ البيانات!')
                : tr('Copier les identifiants', 'نسخ بيانات الولوج')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shrink-0">
            ✓
          </div>
          <div className="text-xs text-emerald-950 flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="font-bold text-sm">
                {tr('Compte Portail Prestataire Actif', 'حساب بوابة مقدم الخدمة مفعل')}
              </p>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                {prestataire.mustChangePassword !== false
                  ? tr('Changement MDP requis au 1er login', 'تغيير كلمة المرور إلزامي عند أول دخول')
                  : tr('Mot de passe personnalisé actif', 'كلمة مرور شخصية مفعلة')}
              </span>
            </div>
            <p className="mt-1 text-emerald-800">
              {tr(
                `Remettez cette fiche PDF officielle ou copiez ces identifiants à ${prestataire.name} pour lui donner accès à ses ordres de mission (/provider).`,
                `سلموا بطاقة PDF الرسمية أو انسخوا هذه البيانات لـ ${prestataire.name} لتمكينه من متابعة أوامر التدخل (/provider).`
              )}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3 font-mono text-xs">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <span className="text-slate-400 font-sans">
              {tr('Entreprise / Artisan :', 'المقاولة / الحرفي :')}
            </span>
            <span className="font-bold text-white font-sans">
              {prestataire.name} ({categoryLabel})
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <span className="text-slate-400 font-sans">
              {tr('Immeuble rattaché :', 'الإقامة المرتبطة :')}
            </span>
            <span className="font-bold text-teal-300">{building.name}</span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <span className="text-slate-400 font-sans">
              {tr('Identifiant (Email) :', 'المعرف (البريد الإلكتروني) :')}
            </span>
            <span className="font-bold text-amber-300 select-all">{prestataire.email}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400 font-sans">
              {tr('Mot de passe temporaire :', 'كلمة المرور المؤقتة :')}
            </span>
            <span className="px-2.5 py-1 rounded bg-slate-800 text-emerald-300 font-bold text-sm tracking-wider select-all border border-slate-700 tabular-nums">
              {password}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-3">
          <div>
            <p className="font-bold">
              {tr('Sécurité 1ère connexion activée', 'حماية أول تسجيل دخول مفعلة')}
            </p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              {tr(
                "Lors de sa première connexion sur /login, le prestataire devra obligatoirement choisir un mot de passe personnel.",
                'عند أول تسجيل دخول عبر /login، سيتعين على مقدم الخدمة اختيار كلمة مرور شخصية.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadPDF}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold text-xs transition-colors"
          >
            {tr('📄 Télécharger PDF', '📄 تحميل PDF')}
          </button>
        </div>

        {/* Audit Trail Section in Modal */}
        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
              {tr("Journal d'audit des identifiants", 'سجل تدقيق بيانات الولوج')}
            </span>
            <span className="text-[11px] font-mono text-slate-500">
              {tr('Traçabilité Syndic', 'تتبع السنديك')}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <div className="p-2 rounded-lg bg-white border border-slate-200">
              <div className="text-[10px] font-semibold uppercase text-slate-400">
                {tr('Dernière génération', 'آخر توليد')}
              </div>
              <div className="font-mono font-bold text-slate-800 mt-0.5">
                {formatAuditTimestamp(prestataire.credentialsCreatedAt, language)}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-white border border-slate-200">
              <div className="text-[10px] font-semibold uppercase text-slate-400">
                {tr('Dernier partage au prestataire', 'آخر مشاركة مع مقدم الخدمة')}
              </div>
              <div className="font-mono font-bold text-slate-800 mt-0.5 flex items-center gap-1.5">
                {prestataire.credentialsSharedAt ? (
                  <>
                    <span>{formatAuditTimestamp(prestataire.credentialsSharedAt, language)}</span>
                    <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-sans">
                      {prestataire.credentialsLastSharedMethod === 'pdf'
                        ? tr('📄 PDF', '📄 PDF')
                        : tr('📋 Copié', '📋 نسخ')}
                    </span>
                  </>
                ) : (
                  <span className="text-amber-700 font-sans font-semibold">
                    {tr('Non partagé', 'لم تتم مشاركته بعد')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const PrestatairesView: React.FC<PrestatairesProps> = ({ building }) => {
  const { tr, language } = useI18n();
  const { registerOrUpdateUserCredentials } = useAuth();
  const queryClient = useQueryClient();
  const [activeViewMode, setActiveViewMode] = useState<'directory' | 'legal'>('directory');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPrestataire, setEditingPrestataire] = useState<Prestataire | null>(null);
  const [credentialPrestataireId, setCredentialPrestataireId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
  const [generateCredentials, setGenerateCredentials] = useState(true);

  const { data: prestataires = [], isLoading } = useQuery({
    queryKey: ['prestataires', building.id],
    queryFn: () => getPrestatairesForBuilding(building.id),
  });

  const activeCredentialPrestataire =
    prestataires.find((p) => p.id === credentialPrestataireId) || null;

  const syncProviderToAuthRegistry = (saved: Prestataire) => {
    if (saved.email && saved.generatedPassword) {
      registerOrUpdateUserCredentials(saved.email, saved.generatedPassword, {
        uid: `prov-${saved.id}`,
        email: saved.email.trim().toLowerCase(),
        displayName: saved.name,
        role: 'provider',
        syndicId: saved.syndicId,
        buildingId: saved.buildingId,
        providerCategory: saved.category,
        mustChangePassword: saved.mustChangePassword ?? true,
      });
    }
  };

  const saveMutation = useMutation({
    mutationFn: ({
      prestataire,
      shouldGenerate,
    }: {
      prestataire: Prestataire;
      shouldGenerate: boolean;
    }) => savePrestataire(prestataire, shouldGenerate),
    onSuccess: (saved, variables) => {
      queryClient.invalidateQueries({ queryKey: ['prestataires', building.id] });
      setIsModalOpen(false);
      resetForm();
      if (saved && saved.hasAccount && saved.generatedPassword) {
        syncProviderToAuthRegistry(saved);
        if (variables.shouldGenerate) {
          setCredentialPrestataireId(saved.id);
        }
      }
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: (prestataireId: string) => regeneratePrestataireCredentials(prestataireId),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['prestataires', building.id] });
      if (updated) {
        syncProviderToAuthRegistry(updated);
        setCredentialPrestataireId(updated.id);
      }
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
    setGenerateCredentials(true);
    setEditingPrestataire(null);
    setFormError(null);
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
    setHourlyRate(p.hourlyRate !== undefined && p.hourlyRate !== null ? String(p.hourlyRate) : '');
    setIsEmergency247(!!p.isEmergency247);
    setIsVerifiedBySyndic(p.isVerifiedBySyndic ?? true);
    setGenerateCredentials(false);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleManageCredentials = (p: Prestataire) => {
    if (p.hasAccount && p.generatedPassword) {
      setCredentialPrestataireId(p.id);
    } else {
      if (!p.email || !p.email.includes('@')) {
        handleOpenEdit(p);
        setGenerateCredentials(true);
        setFormError(
          tr(
            "Veuillez renseigner une adresse email professionnelle pour générer les identifiants d'accès de ce prestataire.",
            'يرجى إدخال بريد إلكتروني مهني لتوليد بيانات الولوج الخاصة بمقدم الخدمة هذا.'
          )
        );
        return;
      }
      regenerateMutation.mutate(p.id);
    }
  };

  const handleSave = () => {
    setFormError(null);
    if (!name.trim() || !phone.trim()) {
      setFormError(
        tr(
          "Le nom de l'entreprise et le téléphone sont obligatoires.",
          'اسم الشركة ورقم الهاتف إلزاميان.'
        )
      );
      return;
    }

    const shouldGenerate = !editingPrestataire ? generateCredentials : generateCredentials;
    if (shouldGenerate && (!email.trim() || !email.includes('@'))) {
      setFormError(
        tr(
          "Une adresse email valide est obligatoire pour créer le compte d'accès Portail Prestataire.",
          'عنوان بريد إلكتروني صالح إلزامي لإنشاء حساب الولوج إلى بوابة مقدم الخدمة.'
        )
      );
      return;
    }

    const payload: Prestataire = {
      id: editingPrestataire?.id || `prest-${Date.now()}`,
      buildingId: building.id,
      syndicId: building.syndicId,
      name: name.trim(),
      category,
      contactPerson: contactPerson.trim(),
      phone: phone.trim(),
      whatsapp: whatsapp.trim() || phone.replace(/\s+/g, ''),
      email: email.trim().toLowerCase(),
      ice: ice.trim(),
      rc: rc.trim(),
      active: true,
      notes: notes.trim(),
      hourlyRate: hourlyRate.trim(),
      isEmergency247,
      isVerifiedBySyndic,
      rating: editingPrestataire?.rating || 4.8,
      reviewsCount: editingPrestataire?.reviewsCount || (editingPrestataire?.reviews?.length || 1),
      reviews: editingPrestataire?.reviews || [],
      hasAccount: editingPrestataire?.hasAccount,
      generatedPassword: editingPrestataire?.generatedPassword,
      credentialsCreatedAt: editingPrestataire?.credentialsCreatedAt,
      mustChangePassword: editingPrestataire?.mustChangePassword,
    };

    saveMutation.mutate({ prestataire: payload, shouldGenerate });
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

  const handleRecordShare = async (prestataireId: string, method: 'pdf' | 'copy') => {
    await recordPrestataireCredentialShare(prestataireId, method);
    await queryClient.invalidateQueries({ queryKey: ['prestataires', building.id] });
  };

  if (isLoading)
    return <Loading message={tr('Chargement des prestataires...', 'جاري تحميل مقدمي الخدمات...')} />;

  return (
    <div className="space-y-6">
      <PrestataireCredentialsModal
        prestataire={activeCredentialPrestataire}
        building={building}
        categoryLabel={
          activeCredentialPrestataire
            ? categoryLabels[activeCredentialPrestataire.category] ||
              activeCredentialPrestataire.category
            : ''
        }
        onClose={() => setCredentialPrestataireId(null)}
        onRegenerate={(id) => regenerateMutation.mutate(id)}
        onShareRecorded={handleRecordShare}
      />

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
              `Répertoire des artisans agréés, création des comptes Portail Prestataire et suivi des contrats pour ${building.name}`,
              `دليل الحرفيين المعتمدين، إنشاء حسابات بوابة مقدمي الخدمات وتتبع العقود لإقامة ${building.name}`
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
              📑 {tr('Contrats, ICE & Accès Portail', 'العقود وبيانات ولوج البوابة')}
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
            <span>{tr('Ajouter un prestataire', 'إضافة مقدم خدمة')}</span>
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
          onManageCredentials={handleManageCredentials}
        />
      )}

      {/* VIEW MODE 2: LEGAL, CONTRACTS & PORTAL CREDENTIALS VIEW */}
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
                        {tr('Contact :', 'المسؤول :')}{' '}
                        {p.contactPerson || tr('Non spécifié', 'غير محدد')}
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
                      <a
                        href={`tel:${p.phone}`}
                        className="font-semibold text-teal-700 hover:underline font-mono"
                      >
                        {p.phone}
                      </a>
                    </div>
                    {p.email && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">{tr('Email :', 'البريد :')}</span>
                        <a
                          href={`mailto:${p.email}`}
                          className="text-slate-700 truncate max-w-[180px] font-mono"
                        >
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

                  {p.hasAccount && (
                    <div className="mt-3 p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] font-mono space-y-0.5">
                      <div className="flex justify-between">
                        <span className="font-sans text-slate-400">
                          {tr('Généré :', 'تم التوليد :')}
                        </span>
                        <span className="text-slate-700 font-semibold">
                          {formatAuditTimestamp(p.credentialsCreatedAt, language)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="font-sans text-slate-400">
                          {tr('Partagé :', 'تمت المشاركة :')}
                        </span>
                        {p.credentialsSharedAt ? (
                          <span className="text-teal-700 font-semibold">
                            {formatAuditTimestamp(p.credentialsSharedAt, language)} (
                            {p.credentialsLastSharedMethod === 'pdf'
                              ? 'PDF'
                              : tr('Copié', 'نسخ')}
                            )
                          </span>
                        ) : (
                          <span className="font-sans text-amber-700 font-semibold">
                            {tr('Non partagé', 'لم تتم مشاركته')}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    {tr('Contrat actif', 'عقد ساري المفعول')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleManageCredentials(p)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                        p.hasAccount
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                          : 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100'
                      }`}
                    >
                      {p.hasAccount
                        ? tr('🔑 Voir Identifiants', '🔑 عرض بيانات الولوج')
                        : tr('⚡ Générer Accès', '⚡ توليد حساب ولوج')}
                    </button>
                    <a
                      href={`tel:${p.phone}`}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-medium transition-colors"
                    >
                      {tr('Appeler', 'اتصال')}
                    </a>
                  </div>
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

      {/* Credential Audit Trail Table for Service Providers */}
      {prestataires.length > 0 && (
        <Card className="overflow-hidden border border-slate-200">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                {tr(
                  'Registre des Accès & Journal d’Audit des Identifiants Prestataires',
                  'سجل حسابات الولوج وتدقيق مشاركة بيانات مقدمي الخدمات'
                )}
              </h2>
              <p className="text-xs text-slate-500">
                {tr(
                  'Suivi horodaté de la dernière génération et du dernier partage (PDF ou copie) des identifiants portail',
                  'تتبع زمني لآخر توليد وآخر مشاركة (PDF أو نسخ) لبيانات ولوج البوابة'
                )}
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {prestataires.filter((p) => p.hasAccount).length} / {prestataires.length}{' '}
              {tr('comptes activés', 'حسابات مفعلة')}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-5 py-3 text-start text-xs font-semibold text-slate-500 uppercase">
                    {tr('Prestataire / Entreprise', 'المقاولة / الحرفي')}
                  </th>
                  <th className="px-5 py-3 text-start text-xs font-semibold text-slate-500 uppercase">
                    {tr('Spécialité & Contact', 'التخصص والاتصال')}
                  </th>
                  <th className="px-5 py-3 text-start text-xs font-semibold text-slate-500 uppercase">
                    {tr('Identifiant Portail', 'معرف البوابة')}
                  </th>
                  <th className="px-5 py-3 text-start text-xs font-semibold text-slate-500 uppercase">
                    {tr('Accès Portail', 'ولوج البوابة')}
                  </th>
                  <th className="px-5 py-3 text-start text-xs font-semibold text-slate-500 uppercase">
                    {tr('Audit Identifiants (Généré / Partagé)', 'سجل التدقيق (التوليد / المشاركة)')}
                  </th>
                  <th className="px-5 py-3 text-end text-xs font-semibold text-slate-500 uppercase">
                    {tr('Actions', 'إجراءات')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {prestataires.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">{p.name}</div>
                      {p.ice && (
                        <div className="text-xs text-slate-400 font-mono">ICE: {p.ice}</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                      <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 font-semibold">
                        {categoryLabels[p.category] || p.category}
                      </span>
                      <div className="text-slate-500 mt-1">
                        {p.contactPerson || '—'} • <span className="font-mono">{p.phone}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs font-mono text-slate-700">
                      {p.email || (
                        <span className="text-slate-400 font-sans italic">
                          {tr('Non renseigné', 'غير متوفر')}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleManageCredentials(p)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                          p.hasAccount
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                            : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        {p.hasAccount
                          ? tr('🔑 Voir Identifiants', '🔑 عرض بيانات الولوج')
                          : tr('⚡ Générer Accès', '⚡ توليد حساب ولوج')}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                      {p.hasAccount ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-slate-700">
                            <span className="text-[11px] font-semibold text-slate-400">
                              {tr('Généré :', 'التوليد :')}
                            </span>
                            <span className="font-mono text-[11px] font-semibold">
                              {formatAuditTimestamp(p.credentialsCreatedAt, language)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-slate-400">
                              {tr('Partagé :', 'المشاركة :')}
                            </span>
                            {p.credentialsSharedAt ? (
                              <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                                <span>{formatAuditTimestamp(p.credentialsSharedAt, language)}</span>
                                <span className="font-sans text-[10px] font-bold">
                                  ({p.credentialsLastSharedMethod === 'pdf'
                                    ? 'PDF'
                                    : tr('Copié', 'نسخ')})
                                </span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold">
                                {tr('Non partagé', 'لم تتم مشاركته')}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-xs">
                          {tr('Aucun identifiant généré', 'لم يتم توليد حساب')}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-end text-sm font-medium space-x-2">
                      <Button
                        variant="secondary"
                        className="!p-2"
                        onClick={() => handleOpenEdit(p)}
                        title={tr('Modifier', 'تعديل')}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="danger"
                        className="!p-2"
                        onClick={() => deleteMutation.mutate(p.id)}
                        title={tr('Supprimer', 'حذف')}
                      >
                        <TrashIcon />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
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
            : tr('Ajouter un prestataire & générer son accès', 'إضافة مقدم خدمة وتوليد حساب الولوج')
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
          {formError && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {formError}
            </div>
          )}

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
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
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
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Email de connexion *', 'البريد الإلكتروني للولوج *')}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ex: contact@atlas-ascenseurs.ma"
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

          <div className="bg-teal-50/80 border border-teal-200 p-3.5 rounded-xl">
            <label className="flex items-start cursor-pointer">
              <input
                type="checkbox"
                checked={generateCredentials}
                onChange={(e) => setGenerateCredentials(e.target.checked)}
                className="mt-0.5 h-4 w-4 text-teal-600 border-slate-300 rounded focus:ring-teal-500"
              />
              <div className="ms-2.5">
                <span className="text-xs sm:text-sm font-bold text-teal-950 block">
                  {editingPrestataire
                    ? tr(
                        'Générer / réinitialiser les identifiants du Portail Prestataire',
                        'توليد / إعادة تعيين بيانات ولوج بوابة مقدم الخدمة'
                      )
                    : tr(
                        "Créer un compte Portail Prestataire & générer les identifiants d'accès",
                        'إنشاء حساب بوابة مقدم الخدمة وتوليد بيانات الولوج'
                      )}
                </span>
                <p className="text-xs text-teal-800 mt-0.5">
                  {tr(
                    "Génère un mot de passe temporaire (Syn-XXXX-MA) et ouvre la fiche d'accès officielle (copiable + PDF imprimable) pour permettre à ce prestataire de suivre ses interventions.",
                    'يولد كلمة مرور مؤقتة (Syn-XXXX-MA) ويفتح بطاقة الولوج الرسمية (قابلة للنسخ + PDF للطباعة) لتمكين مقدم الخدمة من تتبع تدخلاته.'
                  )}
                </p>
              </div>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PrestatairesView;
