import React, { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Building, Resident, Apartment } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { useI18n } from '../../hooks/useI18n';
import { PlusIcon, PencilIcon, TrashIcon, DocumentsIcon } from '../icons/IconComponents';
import {
  exportResidentsPDF,
  exportResidentsCSV,
  exportResidentCredentialsPDF,
} from '../../services/pdfOnDemand';
import { recordResidentCredentialShare } from '../../firebase/services';

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

type ResidentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    resident: Omit<Resident, 'id' | 'syndicId' | 'buildingId'> | Resident,
    generateCredentials?: boolean
  ) => Promise<unknown> | void;
  existingResident?: Resident | null;
  apartments: Apartment[];
  residents: Resident[];
};

const ResidentModal: React.FC<ResidentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingResident,
  apartments,
  residents,
}) => {
  const { t, tr } = useI18n();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [cin, setCin] = useState('');
  const [isOwner, setIsOwner] = useState(true);
  const [apartmentId, setApartmentId] = useState<string>('');
  const [generateCredentials, setGenerateCredentials] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const emailIdentityLinked = existingResident?.emailIdentityLinked === true;
  // A live identity link can arrive while the modal has an unsaved email draft.
  const effectiveEmail = emailIdentityLinked ? existingResident.email : email;

  const residentMap = useMemo(
    () => new Map(residents.map((r) => [r.id, r.name])),
    [residents]
  );

  useEffect(() => {
    if (existingResident) {
      setName(existingResident.name);
      setEmail(existingResident.email);
      setPhone(existingResident.phone);
      setCin(existingResident.cin || '');
      setIsOwner(existingResident.isOwner);
      const linkedApt =
        apartments.find((a) => a.id === existingResident.apartmentId) ||
        apartments.find(
          (a) =>
            a.ownerId === existingResident.id || a.tenantId === existingResident.id
        );
      setApartmentId(linkedApt ? linkedApt.id : '');
      setGenerateCredentials(false);
    } else {
      setName('');
      setEmail('');
      setPhone('');
      setCin('');
      setIsOwner(true);
      setApartmentId('');
      setGenerateCredentials(true);
    }
    setErrors({});
  }, [existingResident?.id, isOpen]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 2) {
      newErrors.name = tr(
        'Le nom complet est obligatoire (min. 2 caractères)',
        'الاسم الكامل مطلوب (حرفان على الأقل)'
      );
    }
    if (!/^\S+@\S+\.\S+$/.test(effectiveEmail.trim())) {
      newErrors.email = tr(
        'Une adresse email valide est obligatoire',
        'يرجى إدخال بريد إلكتروني صحيح'
      );
    }
    if (!phone.trim() || phone.trim().length < 6) {
      newErrors.phone = tr(
        'Un numéro de téléphone valide est obligatoire',
        'يرجى إدخال رقم هاتف صحيح'
      );
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length) throw new Error(Object.values(newErrors).join("\n"));
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const residentData = {
      name: name.trim(),
      email: effectiveEmail.trim(),
      phone: phone.trim(),
      cin: cin.trim() || undefined,
      isOwner,
      apartmentId: apartmentId || undefined,
    };
    if (existingResident) {
      await onSave({ ...existingResident, ...residentData });
    } else {
      await onSave(residentData, generateCredentials);
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSave}
      title={
        existingResident
          ? t('residents.modal.editTitle')
          : t('residents.modal.addTitle')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('residents.modal.cancel')}
          </Button>
          <Button type="submit" className="ms-3">
            {t('residents.modal.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="res-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t('residents.modal.name')}
            </label>
            <input
              type="text"
              id="res-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('residents.modal.namePlaceholder')}
              className={`block w-full px-3 py-2 border rounded-md text-sm ${
                errors.name ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {errors.name && (
              <p className="text-xs text-red-600 mt-1">{errors.name}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="res-cin"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {tr('N° CIN (Optionnel)', 'رقم البطاقة الوطنية CIN (اختياري)')}
            </label>
            <input
              type="text"
              id="res-cin"
              value={cin}
              onChange={(e) => setCin(e.target.value)}
              placeholder="Ex: BK123456"
              className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm font-mono uppercase"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="res-email"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t('residents.modal.email')}
            </label>
            <input
              type="email"
              id="res-email"
              required
              disabled={emailIdentityLinked}
              aria-describedby={emailIdentityLinked ? 'res-email-identity-help' : undefined}
              value={effectiveEmail}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('residents.modal.emailPlaceholder')}
              className={`block w-full px-3 py-2 border rounded-md text-sm disabled:bg-slate-100 disabled:text-slate-500 ${
                errors.email ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {emailIdentityLinked && (
              <p id="res-email-identity-help" className="text-xs text-slate-600 mt-1">
                {tr(
                  'Cet email de connexion est lié à Firebase et ne peut pas être modifié ici. Suivez la procédure sécurisée du compte avec vérification email.',
                  'بريد تسجيل الدخول هذا مرتبط بـ Firebase ولا يمكن تعديله هنا. يلزم اتباع إجراءات أمان الحساب مع التحقق من البريد الإلكتروني.'
                )}
              </p>
            )}
            {errors.email && (
              <p className="text-xs text-red-600 mt-1">{errors.email}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="res-phone"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t('residents.modal.phone')}
            </label>
            <input
              type="tel"
              id="res-phone"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t('residents.modal.phonePlaceholder')}
              className={`block w-full px-3 py-2 border rounded-md text-sm ${
                errors.phone ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {errors.phone && (
              <p className="text-xs text-red-600 mt-1">{errors.phone}</p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            {t('residents.modal.role')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label
              className={`flex items-center p-2.5 border rounded-lg cursor-pointer transition-colors ${
                isOwner
                  ? 'border-teal-600 bg-teal-50/60 text-teal-900 font-semibold'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <input
                type="radio"
                value="owner"
                checked={isOwner}
                onChange={() => setIsOwner(true)}
                className="h-4 w-4 text-teal-600 border-slate-300 focus:ring-teal-500"
              />
              <span className="ms-2 text-xs sm:text-sm">
                {t('residents.modal.owner')}
              </span>
            </label>
            <label
              className={`flex items-center p-2.5 border rounded-lg cursor-pointer transition-colors ${
                !isOwner
                  ? 'border-sky-600 bg-sky-50/60 text-sky-900 font-semibold'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <input
                type="radio"
                value="tenant"
                checked={!isOwner}
                onChange={() => setIsOwner(false)}
                className="h-4 w-4 text-sky-600 border-slate-300 focus:ring-sky-500"
              />
              <span className="ms-2 text-xs sm:text-sm">
                {t('residents.modal.tenant')}
              </span>
            </label>
          </div>
        </div>

        {/* Apartment Assignment */}
        <div>
          <label
            htmlFor="res-apartment"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            {tr("Lot / Appartement assigné dans l'immeuble", 'الشقة / الوحدة المخصصة في العمارة')}
          </label>
          <select
            id="res-apartment"
            value={apartmentId}
            onChange={(e) => setApartmentId(e.target.value)}
            className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
          >
            <option value="">
              {tr('-- Aucun lot assigné pour le moment --', '-- لم يتم تعيين أي شقة حالياً --')}
            </option>
            {apartments.map((apt) => {
              const currentHolderId = isOwner ? apt.ownerId : apt.tenantId;
              const currentHolderName = currentHolderId
                ? residentMap.get(currentHolderId)
                : null;
              const statusText = currentHolderName
                ? `${isOwner ? tr('Propriétaire', 'المالك') : tr('Locataire', 'المكتري')} ${tr('actuel', 'الحالي')} : ${currentHolderName}`
                : tr('Libre', 'شاغرة');
              return (
                <option key={apt.id} value={apt.id}>
                  {tr('Lot', 'شقة')} {apt.number} ({tr('Étage', 'طابق')} {apt.floor} · {apt.area}m²) — {statusText}
                </option>
              );
            })}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            {tr(
              "L'assignation met automatiquement à jour le propriétaire ou locataire sur la fiche du lot choisi.",
              'يؤدي التعيين إلى تحديث اسم المالك أو المكتري تلقائياً في بطاقة الشقة المختارة.'
            )}
          </p>
        </div>

        {!existingResident && (
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
                  {tr(
                    "Générer automatiquement les identifiants d'accès portail",
                    'توليد بيانات الولوج إلى بوابة الساكن تلقائياً'
                  )}
                </span>
                <p className="text-xs text-teal-800 mt-0.5">
                  {tr(
                    "Crée immédiatement un compte résident avec mot de passe temporaire et affiche la fiche d'accès prête à partager (WhatsApp / Email).",
                    'ينشئ فوراً حساباً للساكن مع كلمة مرور مؤقتة ويعرض بطاقة الولوج الجاهزة للمشاركة (واتساب / بريد إلكتروني).'
                  )}
                </p>
              </div>
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
};

// ==========================================
// CREDENTIALS HANDOVER MODAL
// ==========================================

type CredentialsModalProps = {
  resident: Resident | null;
  building: Building;
  apartmentNumber?: string;
  onClose: () => void;
  onRegenerate?: (residentId: string) => Promise<unknown> | void;
  onShareRecorded?: (residentId: string, method: 'pdf' | 'copy') => Promise<unknown> | void;
};

const CredentialsModal: React.FC<CredentialsModalProps> = ({
  resident,
  building,
  apartmentNumber,
  onClose,
  onRegenerate,
  onShareRecorded,
}) => {
  const { tr, language } = useI18n();
  const [copied, setCopied] = useState(false);

  if (!resident) return null;

  const buildingName = building.name;
  const password = resident.invitationCode || resident.invitationToken || 'INV-2026-MA';
  const portalUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/login` : 'https://syndik.ma/login';

  const shareText = tr(
    `Bonjour ${resident.name},\nVoici vos identifiants officiels d'accès au Portail Copropriétaire (${buildingName}${
      apartmentNumber ? ` - Lot ${apartmentNumber}` : ''
    }) :\n• Lien de connexion : ${portalUrl}\n• Identifiant (Email) : ${resident.email}${
      resident.cin ? ` (ou CIN : ${resident.cin})` : ''
    }\n• Mot de passe temporaire : ${password}\n• Statut : ${
      resident.isOwner ? 'Copropriétaire' : 'Locataire'
    }\nNote : Lors de votre première connexion, il vous sera demandé de choisir un mot de passe personnel.`,
    `مرحباً ${resident.name}،\nإليكم بيانات الولوج الرسمية إلى بوابة الملكية المشتركة (${buildingName}${
      apartmentNumber ? ` - شقة ${apartmentNumber}` : ''
    }) :\n• رابط الدخول : ${portalUrl}\n• المعرف (البريد الإلكتروني) : ${resident.email}${
      resident.cin ? ` (أو CIN : ${resident.cin})` : ''
    }\n• كلمة المرور المؤقتة : ${password}\n• الصفة : ${
      resident.isOwner ? 'مالك مشترك' : 'مكتري'
    }\nملاحظة : عند أول تسجيل دخول، سيُطلب منكم تعيين كلمة مرور شخصية جديدة.`
  );

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
    onShareRecorded?.(resident.id, 'copy');
  };

  const handleDownloadPDF = async () => {
    if (!await exportResidentCredentialsPDF(resident, building, apartmentNumber)) return;
    onShareRecorded?.(resident.id, 'pdf');
  };

  return (
    <Modal
      isOpen={!!resident}
      onClose={onClose}
      title={tr("Fiche Officielle d'Accès Résident", 'بطاقة الولوج الرسمية للساكن')}
      footer={
        <div className="flex flex-wrap items-center justify-between w-full gap-2">
          {onRegenerate && (
            <button
              type="button"
              onClick={() => onRegenerate(resident.id)}
              className="text-xs font-semibold text-slate-600 hover:text-teal-700 underline"
            >
              {tr('🔄 Régénérer un mot de passe temporaire', '🔄 إعادة توليد كلمة مرور مؤقتة')}
            </button>
          )}
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
                {tr('Compte Portail Résident Actif', 'حساب بوابة الساكن مفعل')}
              </p>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                {resident.mustChangePassword !== false
                  ? tr('Changement MDP requis au 1er login', 'تغيير كلمة المرور إلزامي عند أول دخول')
                  : tr('Mot de passe personnalisé actif', 'كلمة مرور شخصية مفعلة')}
              </span>
            </div>
            <p className="mt-1 text-emerald-800">
              {tr(
                `Imprimez la Fiche PDF officielle ou copiez ces identifiants pour les remettre à ${resident.name}.`,
                `اطبعوا بطاقة PDF الرسمية أو انسخوا هذه البيانات لتسليمها إلى ${resident.name}.`
              )}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 text-white space-y-3 font-mono text-xs">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <span className="text-slate-400 font-sans">
              {tr('Résident :', 'الساكن :')}
            </span>
            <span className="font-bold text-white font-sans">
              {resident.name} (
              {resident.isOwner
                ? tr('Copropriétaire', 'مالك مشترك')
                : tr('Locataire', 'مكتري')}
              )
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <span className="text-slate-400 font-sans">
              {tr('Immeuble / Lot :', 'العمارة / الشقة :')}
            </span>
            <span className="font-bold text-teal-300">
              {buildingName}{' '}
              {apartmentNumber
                ? `• ${tr('Lot', 'شقة')} ${apartmentNumber}`
                : `• ${tr('Non assigné', 'غير معين')}`}
            </span>
          </div>
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <span className="text-slate-400 font-sans">
              {tr('Identifiant (Email / CIN) :', 'المعرف (البريد / CIN) :')}
            </span>
            <span className="font-bold text-amber-300 select-all">
              {resident.email} {resident.cin ? `(${resident.cin})` : ''}
            </span>
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
                "Dès sa première connexion sur /login, le résident sera invité à définir son propre mot de passe confidentiel.",
                'عند أول تسجيل دخول عبر /login، سيُطلب من الساكن اختيار كلمة مرور خاصة وسرية.'
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
                {formatAuditTimestamp(resident.credentialsCreatedAt, language)}
              </div>
            </div>
            <div className="p-2 rounded-lg bg-white border border-slate-200">
              <div className="text-[10px] font-semibold uppercase text-slate-400">
                {tr('Dernier partage au résident', 'آخر مشاركة مع الساكن')}
              </div>
              <div className="font-mono font-bold text-slate-800 mt-0.5 flex items-center gap-1.5">
                {resident.credentialsSharedAt ? (
                  <>
                    <span>{formatAuditTimestamp(resident.credentialsSharedAt, language)}</span>
                    <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-sans">
                      {resident.credentialsLastSharedMethod === 'pdf'
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

// ==========================================
// MAIN RESIDENTS VIEW
// ==========================================

const Residents: React.FC<{
  building: Building;
  onAddResident: (
    resident: Omit<Resident, 'id' | 'syndicId' | 'buildingId'>,
    generateCredentials?: boolean
  ) => Promise<Resident> | void;
  onUpdateResident: (resident: Resident) => Promise<unknown> | void;
  onDeleteResident: (residentId: string) => Promise<unknown> | void;
  onRegenerateCredentials?: (residentId: string) => Promise<Resident> | void;
}> = ({
  building,
  onAddResident,
  onUpdateResident,
  onDeleteResident,
  onRegenerateCredentials,
}) => {
  const { t, tr, language } = useI18n();
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null);
  const [credentialResidentId, setCredentialResidentId] = useState<string | null>(
    null
  );
  const [deletingResident, setDeletingResident] = useState<Resident | null>(null);

  const handleRecordShare = async (residentId: string, method: 'pdf' | 'copy') => {
    await recordResidentCredentialShare(residentId, method);
    await queryClient.invalidateQueries({ queryKey: ['syndics'] });
  };

  // Map residentId -> Apartment for fast lookup
  const residentApartmentMap = useMemo(() => {
    const map = new Map<string, Apartment>();
    building.apartments.forEach((apt) => {
      if (apt.ownerId) map.set(apt.ownerId, apt);
      if (apt.tenantId) map.set(apt.tenantId, apt);
    });
    building.residents.forEach((res) => {
      if (res.apartmentId && !map.has(res.id)) {
        const found = building.apartments.find((a) => a.id === res.apartmentId);
        if (found) map.set(res.id, found);
      }
    });
    return map;
  }, [building.apartments, building.residents]);

  const activeCredentialResident = useMemo(
    () =>
      building.residents.find((r) => r.id === credentialResidentId) || null,
    [building.residents, credentialResidentId]
  );

  const handleEdit = (resident: Resident) => {
    setSelectedResident(resident);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setSelectedResident(null);
    setIsModalOpen(true);
  };

  const handleSaveResident = async (
    residentPayload: Omit<Resident, 'id' | 'syndicId' | 'buildingId'> | Resident,
    generateCredentials?: boolean
  ) => {
    if ('id' in residentPayload) {
      await onUpdateResident(residentPayload);
    } else {
      const created = await onAddResident(residentPayload, generateCredentials);
      if (generateCredentials && created && typeof created === 'object' && 'id' in created) {
        setCredentialResidentId(created.id);
      }
    }
  };

  const handleGenerateOrShowCredentials = async (resident: Resident) => {
    if (resident.hasAccount && (resident.invitationCode || resident.invitationToken)) {
      setCredentialResidentId(resident.id);
    } else if (onRegenerateCredentials) {
      const updated = await onRegenerateCredentials(resident.id);
      if (updated && typeof updated === 'object' && 'id' in updated) {
        setCredentialResidentId(updated.id);
      } else {
        setCredentialResidentId(resident.id);
      }
    } else {
      setCredentialResidentId(resident.id);
    }
  };

  const handleRegenerateInsideModal = async (residentId: string) => {
    if (onRegenerateCredentials) {
      await onRegenerateCredentials(residentId);
    }
  };

  const confirmDelete = async () => {
    if (deletingResident) {
      await onDeleteResident(deletingResident.id);
      setDeletingResident(null);
    }
  };

  return (
    <div className="space-y-6">
      <ResidentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveResident}
        existingResident={building.residents.find((r) => r.id === selectedResident?.id) || selectedResident}
        apartments={building.apartments}
        residents={building.residents}
      />

      <CredentialsModal
        resident={activeCredentialResident}
        building={building}
        apartmentNumber={
          activeCredentialResident
            ? residentApartmentMap.get(activeCredentialResident.id)?.number
            : undefined
        }
        onClose={() => setCredentialResidentId(null)}
        onRegenerate={handleRegenerateInsideModal}
        onShareRecorded={handleRecordShare}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deletingResident}
        onClose={() => setDeletingResident(null)}
        title={tr('Supprimer le résident', 'حذف الساكن')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingResident(null)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button variant="danger" onClick={confirmDelete} className="ms-3">
              {tr('Supprimer', 'حذف')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {t('residents.deleteConfirm.message', {
            name: deletingResident?.name || '',
          })}
        </p>
      </Modal>

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            {t('residents.title', { buildingName: building.name })}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {tr(
              'Gestion des copropriétaires, locataires, affectation des lots et génération des accès portail',
              'تدبير الملاك المشتركين والمكترين وتعيين الشقق وتوليد بيانات الولوج إلى البوابة'
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => exportResidentsPDF(building)}
            disabled={building.residents.length === 0}
            className="flex items-center gap-1.5 text-xs sm:text-sm"
            title={tr(
              'Exporter le registre officiel des résidents en PDF (Loi 18-00)',
              'تصدير السجل الرسمي للسكان بصيغة PDF (قانون 18-00)'
            )}
          >
            <DocumentsIcon />
            <span>{tr('Exporter PDF', 'تصدير PDF')}</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => exportResidentsCSV(building)}
            disabled={building.residents.length === 0}
            className="flex items-center gap-1.5 text-xs sm:text-sm"
            title={tr(
              'Exporter la liste des résidents au format CSV (Excel)',
              'تصدير لائحة السكان بصيغة CSV (إكسل)'
            )}
          >
            <span>⬇ CSV</span>
          </Button>
          <Button
            icon={<PlusIcon />}
            onClick={handleAdd}
            className="w-full sm:w-auto justify-center"
          >
            {t('residents.add')}
          </Button>
        </div>
      </div>

      {/* Mobile Card List (< md) */}
      <div className="md:hidden space-y-3">
        {building.residents.map((resident) => {
          const assignedApt = residentApartmentMap.get(resident.id);
          return (
            <Card key={resident.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-900 truncate">
                      {resident.name}
                    </h3>
                    <span
                      className={`px-2 py-0.5 inline-flex text-[11px] font-semibold rounded-full ${
                        resident.isOwner
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-sky-100 text-sky-800'
                      }`}
                    >
                      {resident.isOwner
                        ? t('residents.role.owner')
                        : t('residents.role.tenant')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 truncate">
                    {resident.email}
                  </p>
                  <p className="text-xs text-slate-600 font-medium mt-0.5">
                    {resident.phone} {resident.cin ? `• CIN: ${resident.cin}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {assignedApt ? (
                      <span className="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-mono text-xs font-bold">
                        {tr('Lot', 'شقة')} {assignedApt.number} ({tr('Étage', 'طابق')} {assignedApt.floor})
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-xs">
                        {tr('Lot non assigné', 'شقة غير معينة')}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleGenerateOrShowCredentials(resident)}
                      className={`px-2.5 py-0.5 rounded text-xs font-semibold border transition-colors ${
                        resident.hasAccount
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                          : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                      }`}
                    >
                      {resident.hasAccount
                        ? tr('🔑 Voir Identifiants', '🔑 عرض بيانات الولوج')
                        : tr('⚡ Générer Accès', '⚡ توليد حساب ولوج')}
                    </button>
                  </div>
                  {resident.hasAccount && (
                    <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-0.5 font-mono">
                      <div>
                        <span className="font-sans text-slate-400">
                          {tr('Généré :', 'تم التوليد :')}
                        </span>{' '}
                        {formatAuditTimestamp(resident.credentialsCreatedAt, language)}
                      </div>
                      <div>
                        <span className="font-sans text-slate-400">
                          {tr('Partagé :', 'تمت المشاركة :')}
                        </span>{' '}
                        {resident.credentialsSharedAt ? (
                          <span className="text-teal-700 font-semibold">
                            {formatAuditTimestamp(resident.credentialsSharedAt, language)} (
                            {resident.credentialsLastSharedMethod === 'pdf'
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
                <div className="flex items-center gap-1.5 shrink-0">
                  <Button
                    variant="secondary"
                    className="!p-2 min-w-[40px] min-h-[40px]"
                    onClick={() => handleEdit(resident)}
                    title={t('residents.modal.editTitle')}
                  >
                    <PencilIcon />
                  </Button>
                  <Button
                    variant="danger"
                    className="!p-2 min-w-[40px] min-h-[40px]"
                    onClick={() => setDeletingResident(resident)}
                    title={tr('Supprimer', 'حذف')}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
        {building.residents.length === 0 && (
          <Card>
            <p className="text-center py-8 text-gray-500">
              {t('residents.noResidents')}
            </p>
          </Card>
        )}
      </div>

      {/* Desktop Table (md+) */}
      <Card className="hidden md:block overflow-hidden border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-start text-xs font-semibold text-slate-500 uppercase">
                  {t('residents.table.name')}
                </th>
                <th className="px-5 py-3 text-start text-xs font-semibold text-slate-500 uppercase">
                  {tr('Lot Assigné', 'الشقة المعينة')}
                </th>
                <th className="px-5 py-3 text-start text-xs font-semibold text-slate-500 uppercase">
                  {t('residents.table.role')}
                </th>
                <th className="px-5 py-3 text-start text-xs font-semibold text-slate-500 uppercase">
                  {tr('Contact', 'الاتصال')}
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
              {building.residents.map((resident) => {
                const assignedApt = residentApartmentMap.get(resident.id);
                return (
                  <tr key={resident.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="font-semibold text-slate-900">
                        {resident.name}
                      </div>
                      {resident.cin && (
                        <div className="text-xs text-slate-400 font-mono">
                          CIN: {resident.cin}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {assignedApt ? (
                        <span className="px-2.5 py-1 rounded-md bg-teal-50 text-teal-900 border border-teal-200 font-mono text-xs font-bold">
                          {tr('Lot', 'شقة')} {assignedApt.number} · {tr('Étage', 'طابق')} {assignedApt.floor}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleEdit(resident)}
                          className="text-xs text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-md font-medium"
                        >
                          {tr('+ Assigner un lot', '+ تعيين شقة')}
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span
                        className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          resident.isOwner
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-sky-100 text-sky-800'
                        }`}
                      >
                        {resident.isOwner
                          ? t('residents.role.owner')
                          : t('residents.role.tenant')}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-slate-600">
                      <div>{resident.email}</div>
                      <div className="font-mono text-slate-500 mt-0.5">
                        {resident.phone}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleGenerateOrShowCredentials(resident)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                          resident.hasAccount
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                            : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        {resident.hasAccount
                          ? tr('🔑 Voir Identifiants', '🔑 عرض بيانات الولوج')
                          : tr('⚡ Générer Accès', '⚡ توليد حساب ولوج')}
                      </button>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs">
                      {resident.hasAccount ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-slate-700">
                            <span className="text-[11px] font-semibold text-slate-400">
                              {tr('Généré :', 'التوليد :')}
                            </span>
                            <span className="font-mono text-[11px] font-semibold">
                              {formatAuditTimestamp(resident.credentialsCreatedAt, language)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-slate-400">
                              {tr('Partagé :', 'المشاركة :')}
                            </span>
                            {resident.credentialsSharedAt ? (
                              <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-teal-800 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                                <span>
                                  {formatAuditTimestamp(resident.credentialsSharedAt, language)}
                                </span>
                                <span className="font-sans text-[10px] font-bold">
                                  ({resident.credentialsLastSharedMethod === 'pdf'
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
                        onClick={() => handleEdit(resident)}
                        title={t('residents.modal.editTitle')}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        variant="danger"
                        className="!p-2"
                        onClick={() => setDeletingResident(resident)}
                        title={tr('Supprimer', 'حذف')}
                      >
                        <TrashIcon />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {building.residents.length === 0 && (
          <p className="text-center py-8 text-gray-500">
            {t('residents.noResidents')}
          </p>
        )}
      </Card>
    </div>
  );
};

export default Residents;
