import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ShieldCheck, FileText, Trash2, ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import { useLegalFramework } from '../../hooks/useLegalFramework';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';
import LanguageToggle from '../common/LanguageToggle';
import Button from '../common/Button';
import Card from '../common/Card';
import BrandLogo from '../common/BrandLogo';
import { apiUrl } from '../../utils/apiBase';
import { getAuthenticatedRequestHeaders } from '../../utils/security';

export type LegalSection = 'privacy' | 'terms' | 'account-deletion';

interface DeletionRequestSummary {
  id: string;
  status: 'pending' | 'cancelled' | 'completed';
  requestedAt: string;
  revokedPushTokens?: number;
}

const SUPPORT_EMAIL = 'support@syndicunion.ma';

const LegalCompliancePage: React.FC<{ section: LegalSection }> = ({ section }) => {
  const { language, tr } = useI18n();
  const { legal } = useLegalFramework();
  const { currentUser, userProfile } = useAuth();
  const navigate = useNavigate();
  const isAr = language === 'ar';

  const [confirmEmail, setConfirmEmail] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [loadingRequest, setLoadingRequest] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [activeRequest, setActiveRequest] = useState<DeletionRequestSummary | null>(null);

  useEffect(() => {
    if (section !== 'account-deletion' || !currentUser || !userProfile) {
      setActiveRequest(null);
      return;
    }
    let cancelled = false;
    setLoadingRequest(true);
    fetch(apiUrl('/api/account/deletion-request'), {
      headers: getAuthenticatedRequestHeaders(),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.ok) {
          setActiveRequest(data.request || null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingRequest(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, currentUser, userProfile]);

  const handleSubmitDeletion = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    if (!acknowledged) {
      setError(
        tr(
          'Veuillez confirmer que vous avez pris connaissance des conséquences de la suppression.',
          'يرجى تأكيد اطلاعكم على عواقب حذف الحساب.',
        ),
      );
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(apiUrl('/api/account/deletion-request'), {
        method: 'POST',
        headers: getAuthenticatedRequestHeaders(),
        body: JSON.stringify({
          confirmEmail: confirmEmail.trim(),
          reason: reason.trim() || undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(
          data?.error ||
            tr(
              'Impossible d’enregistrer votre demande pour le moment.',
              'تعذر تسجيل طلبكم في الوقت الحالي.',
            ),
        );
      }
      setActiveRequest(data.request);
      setSuccessMsg(
        tr(
          'Votre demande de suppression de compte a été enregistrée et vos notifications push ont été désactivées.',
          'تم تسجيل طلب حذف حسابكم بنجاح وتم إيقاف الإشعارات الفورية فوراً.',
        ),
      );
      setConfirmEmail('');
      setReason('');
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Erreur inattendue.', 'حدث خطأ غير متوقع.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelDeletion = async () => {
    setError('');
    setSuccessMsg('');
    setCancelling(true);
    try {
      const response = await fetch(apiUrl('/api/account/deletion-request'), {
        method: 'DELETE',
        headers: getAuthenticatedRequestHeaders(),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || tr('Annulation impossible.', 'تعذر إلغاء الطلب.'));
      }
      setActiveRequest(null);
      setSuccessMsg(
        tr(
          'Votre demande de suppression de compte a été annulée. Votre compte reste actif.',
          'تم إلغاء طلب حذف الحساب. حسابكم لا يزال نشطاً.',
        ),
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Annulation impossible.', 'تعذر إلغاء الطلب.'),
      );
    } finally {
      setCancelling(false);
    }
  };

  const handleBack = () => {
    if (currentUser && userProfile) {
      navigate(getHomeRouteForRole(userProfile.role));
    } else {
      navigate('/login');
    }
  };

  const navItems: Array<{ key: LegalSection; path: string; labelFr: string; labelAr: string; icon: React.ReactNode }> = [
    {
      key: 'privacy',
      path: '/privacy',
      labelFr: 'Confidentialité',
      labelAr: 'الخصوصية',
      icon: <ShieldCheck className="w-4 h-4" />,
    },
    {
      key: 'terms',
      path: '/terms',
      labelFr: 'Conditions (CGU)',
      labelAr: 'شروط الاستخدام',
      icon: <FileText className="w-4 h-4" />,
    },
    {
      key: 'account-deletion',
      path: '/account-deletion',
      labelFr: 'Suppression de compte',
      labelAr: 'حذف الحساب',
      icon: <Trash2 className="w-4 h-4" />,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900" dir={isAr ? 'rtl' : 'ltr'}>
      <header className="sticky top-0 z-30 bg-slate-950 text-white border-b border-slate-800 pt-safe">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white transition-colors shrink-0"
            >
              <ArrowLeft className={`w-4 h-4 ${isAr ? 'rotate-180' : ''}`} />
              <span>{tr('Retour', 'رجوع')}</span>
            </button>
            <div className="min-w-0">
              <BrandLogo variant="lockup" theme="dark" size="xs" />
              <div className="text-[11px] text-amber-300/90 truncate mt-0.5">
                {tr('Conformité Légale, Confidentialité & Données', 'الامتثال القانوني والخصوصية وحماية البيانات')}
              </div>
            </div>
          </div>
          <LanguageToggle variant="dark" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 pb-16">
        {/* Section Tabs */}
        <nav
          aria-label={tr('Navigation légale', 'التنقل القانوني')}
          className="flex flex-wrap gap-2"
        >
          {navItems.map((item) => {
            const active = section === item.key;
            return (
              <Link
                key={item.key}
                to={item.path}
                className={`inline-flex items-center gap-2 px-3.5 py-2.5 min-h-[44px] rounded-xl text-xs sm:text-sm font-bold border transition-colors ${
                  active
                    ? 'bg-teal-700 text-white border-teal-700 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {item.icon}
                <span>{isAr ? item.labelAr : item.labelFr}</span>
              </Link>
            );
          })}
        </nav>

        {section === 'privacy' && (
          <Card className="p-6 sm:p-8 space-y-6 border border-slate-200">
            <div className="border-b border-slate-200 pb-4">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-teal-50 text-teal-800 border border-teal-200">
                <ShieldCheck className="w-3.5 h-3.5" />
                {tr(`${legal.citations.dataPrivacyLawFr} · App Store & Google Play`, `${legal.citations.dataPrivacyLawAr} · App Store و Google Play`)}
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-2 font-display">
                {tr('Politique de Confidentialité — SyndicUnion', 'سياسة الخصوصية — SyndicUnion')}
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                {tr('Dernière mise à jour : Novembre 2026', 'آخر تحديث: نوفمبر 2026')}
              </p>
            </div>

            <section className="space-y-2 text-sm text-slate-700 leading-relaxed">
              <h2 className="text-base font-bold text-slate-900">
                {tr('1. Données collectées', '1. البيانات التي يتم جمعها')}
              </h2>
              <p>
                {tr(
                  `SyndicUnion collecte uniquement les données strictement nécessaires à la gestion de la copropriété au Maroc conformément au cadre légal applicable (${legal.citations.statuteShortFr}) :`,
                  `يجمع تطبيق SyndicUnion فقط البيانات الضرورية لتدبير الملكية المشتركة بالمغرب وفق الإطار القانوني الجاري به العمل (${legal.citations.statuteShortAr}):`,
                )}
              </p>
              <ul className="list-disc ps-5 space-y-1">
                <li>
                  {tr(
                    'Identité & accès : nom, adresse email, numéro de téléphone, rôle (Syndic, Copropriétaire, Locataire, Prestataire) et lot rattaché.',
                    'الهوية والولوج: الاسم، البريد الإلكتروني، رقم الهاتف، الدور (سنديك، مالك مشترك، مكتري، مقدم خدمة) والوحدة المرتبطة.',
                  )}
                </li>
                <li>
                  {tr(
                    'Pièces & photos facultatives (Caméra / Galerie) : justificatifs de virement bancaire, photos d’incidents de maintenance et annonces du Souk des résidents, uniquement lorsque vous choisissez de les téléverser.',
                    'الوثائق والصور الاختيارية (الكاميرا / المعرض): إثباتات التحويل البنكي، صور أعطاب الصيانة وإعلانات سوق الجيران، فقط عند اختياركم رفعها.',
                  )}
                </li>
                <li>
                  {tr(
                    'Notifications Push mobiles : jeton technique Firebase Cloud Messaging (FCM / APNs) associé à votre appareil, supprimé automatiquement lors de la déconnexion ou de la suppression du compte.',
                    'الإشعارات الفورية للهاتف: رمز تقني (FCM / APNs) مرتبط بجهازكم، يتم حذفه تلقائياً عند تسجيل الخروج أو طلب حذف الحساب.',
                  )}
                </li>
                <li>
                  {tr(
                    'Données de gestion : appels de charges, quittances PDF, votes d’Assemblées Générales et historique comptable de la résidence.',
                    'بيانات التدبير: واجبات السنديك، وصولات الأداء PDF، تصويت الجمعيات العامة والسجل المحاسبي للإقامة.',
                  )}
                </li>
              </ul>
            </section>

            <section className="space-y-2 text-sm text-slate-700 leading-relaxed">
              <h2 className="text-base font-bold text-slate-900">
                {tr('2. Sécurité, chiffrement & sous-traitants', '2. الأمان والتشفير ومزودو الخدمة')}
              </h2>
              <p>
                {tr(
                  'Toutes les communications transitent en HTTPS/TLS. Les secrets, justificatifs privés et journaux sensibles sont protégés par chiffrement AES-256-GCM et contrôle d’accès strict par rôle et résidence (aucun accès inter-copropriétés). Nous utilisons Google Cloud / Firebase (hébergement, authentification, notifications FCM) et ne vendons jamais vos données personnelles à des tiers ou régies publicitaires.',
                  'تتم جميع الاتصالات عبر HTTPS/TLS. تتم حماية الوثائق الخاصة والبيانات الحساسة بتشفير AES-256-GCM والتحكم الصارم في الصلاحيات حسب الإقامة والدور. نعتمد على Google Cloud / Firebase ولا نبيع بياناتكم الشخصية أبداً لأي طرف ثالث أو لأغراض إعلانية.',
                )}
              </p>
            </section>

            <section className="space-y-2 text-sm text-slate-700 leading-relaxed">
              <h2 className="text-base font-bold text-slate-900">
                {tr(`3. Vos droits (${legal.citations.dataPrivacyLawFr}) & suppression de compte`, `3. حقوقكم (${legal.citations.dataPrivacyLawAr}) وحذف الحساب`)}
              </h2>
              <p>
                {tr(
                  `Conformément à la réglementation relative à la protection des données à caractère personnel (${legal.citations.dataPrivacyLawFr}), vous disposez d’un droit d’accès, de rectification et de suppression. Vous pouvez soumettre une demande directement depuis notre page dédiée :`,
                  `وفقاً للتشريع المتعلق بحماية المعطيات ذات الطابع الشخصي (${legal.citations.dataPrivacyLawAr})، يحق لكم الولوج وتصحيح وطلب حذف بياناتكم مباشرة عبر صفحتنا المخصصة:`,
                )}
              </p>
              <div className="pt-1 flex flex-wrap gap-3 items-center">
                <Link
                  to="/account-deletion"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100 text-xs font-bold"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{tr('Demander la suppression de mon compte', 'طلب حذف حسابي وبياناتي')}</span>
                </Link>
                <span className="text-xs text-slate-500">
                  {tr('Contact DPO / Support :', 'التواصل مع الدعم:')} <strong className="font-mono text-slate-700">{SUPPORT_EMAIL}</strong>
                </span>
              </div>
            </section>
          </Card>
        )}

        {section === 'terms' && (
          <Card className="p-6 sm:p-8 space-y-6 border border-slate-200">
            <div className="border-b border-slate-200 pb-4">
              <h1 className="text-2xl font-extrabold text-slate-900 font-display">
                {tr('Conditions Générales d’Utilisation (CGU)', 'الشروط العامة للاستخدام')}
              </h1>
              <p className="text-xs text-slate-500 mt-1">
                {tr('SyndicUnion Maroc · Dernière mise à jour : Novembre 2026', 'SyndicUnion المغرب · آخر تحديث: نوفمبر 2026')}
              </p>
            </div>

            <section className="space-y-2 text-sm text-slate-700 leading-relaxed">
              <h2 className="text-base font-bold text-slate-900">
                {tr('1. Objet du service', '1. موضوع الخدمة')}
              </h2>
              <p>
                {tr(
                  'SyndicUnion fournit aux cabinets de syndic, syndicats de copropriétaires, résidents et prestataires agréés une plateforme numérique de gestion de copropriété au Maroc (comptabilité en tantièmes, quittances certifiées, convocations et votes d’Assemblées Générales, suivi de maintenance et communication interne).',
                  'توفر منصة SyndicUnion لمكاتب السنديك واتحادات الملاك والسكان ومقدمي الخدمات المعتمدين حلاً رقمياً لتدبير الملكية المشتركة بالمغرب (المحاسبة، الوصولات الرسمية، الجمعيات العامة، تتبع الصيانة والتواصل الداخلي).',
                )}
              </p>
            </section>

            <section className="space-y-2 text-sm text-slate-700 leading-relaxed">
              <h2 className="text-base font-bold text-slate-900">
                {tr(`2. Comptes, responsabilités & conformité (${legal.citations.statuteShortFr})`, `2. الحسابات والمسؤوليات والامتثال (${legal.citations.statuteShortAr})`)}
              </h2>
              <p>
                {tr(
                  'Les comptes Copropriétaires, Locataires et Prestataires sont créés et rattachés par le Syndic gestionnaire dûment mandaté. Chaque utilisateur est responsable de la confidentialité de ses identifiants et de l’exactitude des justificatifs transmis. Les décisions d’Assemblée Générale et écritures comptables relèvent de la responsabilité légale du Syndicat des Copropriétaires.',
                  'يتم إنشاء وربط حسابات الملاك المشتركين والمكترين ومقدمي الخدمات من طرف السنديك المفوض. يتحمل كل مستخدم مسؤولية سرية بيانات الولوج وصحة الوثائق المرسلة، وتبقى قرارات الجمع العام والقيود المحاسبية تحت المسؤولية القانونية لاتحاد الملاك.',
                )}
              </p>
            </section>

            <section className="space-y-2 text-sm text-slate-700 leading-relaxed">
              <h2 className="text-base font-bold text-slate-900">
                {tr('3. Abonnements cabinets B2B & droit applicable', '3. اشتراكات المكاتب المهنية والقانون المطبق')}
              </h2>
              <p>
                {tr(
                  'Les contrats d’abonnement professionnels des cabinets Syndic sont gérés en ligne sur le portail web administratif. Les présentes conditions sont régies par le droit marocain. Pour toute assistance : ',
                  'تتم إدارة عقود الاشتراك المهنية لمكاتب السنديك عبر البوابة الإلكترونية على الويب. تخضع هذه الشروط للقانون المغربي. لأي استفسار يرجى التواصل عبر: ',
                )}
                <strong className="font-mono text-slate-900">{SUPPORT_EMAIL}</strong>.
              </p>
            </section>
          </Card>
        )}

        {section === 'account-deletion' && (
          <Card className="p-6 sm:p-8 space-y-6 border border-slate-200">
            <div className="border-b border-slate-200 pb-4">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-800 border border-rose-200">
                <Trash2 className="w-3.5 h-3.5" />
                {tr('Gestion & Suppression de Compte (CNDP · App Store · Play Store)', 'إدارة وحذف الحساب (CNDP · App Store · Play Store)')}
              </span>
              <h1 className="text-2xl font-extrabold text-slate-900 mt-2">
                {tr('Supprimer mon compte SyndicUnion', 'حذف حسابي على SyndicUnion')}
              </h1>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs sm:text-sm">
              <div className="p-4 rounded-xl bg-rose-50/70 border border-rose-200 space-y-1.5">
                <h2 className="font-bold text-rose-950">
                  {tr('Données supprimées', 'البيانات التي يتم حذفها')}
                </h2>
                <ul className="list-disc ps-4 text-rose-900 space-y-1">
                  <li>{tr('Identifiants de connexion & sessions actives', 'بيانات تسجيل الدخول والجلسات النشطة')}</li>
                  <li>{tr('Jetons de notifications push mobiles (immédiat)', 'رموز الإشعارات الفورية للهاتف (فوراً)')}</li>
                  <li>{tr('Coordonnées personnelles (téléphone, email de profil)', 'معلومات الاتصال الشخصية (الهاتف والبريد)')}</li>
                </ul>
              </div>
              <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1.5">
                <h2 className="font-bold text-amber-950">
                  {tr(`Archives légales conservées (${legal.citations.statuteShortFr})`, `الأرشيف القانوني المحفوظ (${legal.citations.statuteShortAr})`)}
                </h2>
                <p className="text-amber-900 leading-relaxed">
                  {tr(
                    'Les quittances de charges, écritures comptables de copropriété et procès-verbaux d’Assemblées Générales sont conservés jusqu’à 10 ans conformément aux obligations comptables et légales marocaines.',
                    'يتم الاحتفاظ بوصولات الأداء والقيود المحاسبية ومحاضر الجمعيات العامة لمدة تصل إلى 10 سنوات وفق الالتزامات القانونية والمحاسبية بالمغرب.',
                  )}
                </p>
              </div>
            </div>

            {error && (
              <div role="alert" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs sm:text-sm font-semibold flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs sm:text-sm font-semibold flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{successMsg}</span>
              </div>
            )}

            {currentUser && userProfile ? (
              loadingRequest ? (
                <p className="text-sm text-slate-500">
                  {tr('Vérification de votre statut...', 'جاري التحقق من حالة الطلب...')}
                </p>
              ) : activeRequest ? (
                <div className="p-5 rounded-xl bg-amber-50 border border-amber-300 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-extrabold text-amber-950">
                      {tr('Demande de suppression en cours de traitement', 'طلب حذف الحساب قيد المعالجة')}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-200 text-amber-950">
                      {activeRequest.id}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-amber-900">
                    {tr(
                      `Enregistrée le ${new Date(activeRequest.requestedAt).toLocaleString('fr-MA')} pour ${userProfile.email}. Vos accès seront clôturés sous 30 jours maximum.`,
                      `تم التسجيل بتاريخ ${new Date(activeRequest.requestedAt).toLocaleString('ar-MA')} للحساب ${userProfile.email}. سيتم إغلاق حسابكم خلال 30 يوماً كحد أقصى.`,
                    )}
                  </p>
                  <Button
                    variant="secondary"
                    disabled={cancelling}
                    onClick={() => void handleCancelDeletion()}
                  >
                    {cancelling
                      ? tr('Annulation...', 'جاري الإلغاء...')
                      : tr('Annuler ma demande et conserver mon compte', 'إلغاء الطلب والاحتفاظ بحسابي')}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleSubmitDeletion} className="space-y-4 pt-2 border-t border-slate-200">
                  <div>
                    <label
                      htmlFor="confirm-deletion-email"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      {tr(
                        `Confirmez votre adresse email (${userProfile.email}) *`,
                        `أكّد بريدك الإلكتروني (${userProfile.email}) *`,
                      )}
                    </label>
                    <input
                      id="confirm-deletion-email"
                      type="email"
                      required
                      value={confirmEmail}
                      onChange={(e) => setConfirmEmail(e.target.value)}
                      placeholder={userProfile.email}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="deletion-reason"
                      className="block text-xs font-bold text-slate-700 mb-1"
                    >
                      {tr('Motif (optionnel)', 'السبب (اختياري)')}
                    </label>
                    <textarea
                      id="deletion-reason"
                      rows={3}
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={tr('Ex: Départ de la résidence, changement de gestionnaire...', 'مثال: مغادرة الإقامة، تغيير المكتب المسير...')}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                    />
                  </div>
                  <label className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(e) => setAcknowledged(e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                    />
                    <span>
                      {tr(
                        'Je confirme vouloir demander la suppression de mon compte SyndicUnion et la désactivation immédiate de mes notifications mobiles.',
                        'أؤكد رغبتي في طلب حذف حسابي على SyndicUnion وإيقاف الإشعارات الفورية فوراً.',
                      )}
                    </span>
                  </label>
                  <div className="pt-1">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-rose-700 hover:bg-rose-800 text-white text-sm font-bold transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>
                        {submitting
                          ? tr('Envoi en cours...', 'جاري الإرسال...')
                          : tr('Soumettre la demande de suppression', 'إرسال طلب حذف الحساب')}
                      </span>
                    </button>
                  </div>
                </form>
              )
            ) : (
              <div className="p-5 rounded-xl bg-slate-100 border border-slate-200 space-y-3 text-sm text-slate-700">
                <p className="font-bold text-slate-900">
                  {tr('Comment supprimer votre compte ?', 'كيف تحذف حسابك؟')}
                </p>
                <ol className="list-decimal ps-5 space-y-1.5 text-xs sm:text-sm">
                  <li>
                    {tr(
                      'Connectez-vous à votre compte SyndicUnion puis revenez sur cette page pour soumettre votre demande en 1 clic.',
                      'قم بتسجيل الدخول إلى حسابك في SyndicUnion ثم عد إلى هذه الصفحة لإرسال طلب الحذف بنقرة واحدة.',
                    )}
                  </li>
                  <li>
                    {tr(
                      `Si vous n'avez plus accès à votre compte, envoyez votre demande depuis l'adresse email enregistrée à ${SUPPORT_EMAIL} (traitement sous 30 jours maximum).`,
                      `إذا فقدت الوصول إلى حسابك، أرسل طلبك من البريد الإلكتروني المسجل إلى ${SUPPORT_EMAIL} (تتم المعالجة خلال 30 يوماً كحد أقصى).`,
                    )}
                  </li>
                </ol>
                <div className="pt-1">
                  <Button onClick={() => navigate('/login')}>
                    {tr('Se connecter pour demander la suppression', 'تسجيل الدخول لطلب حذف الحساب')}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </main>
    </div>
  );
};

export default LegalCompliancePage;
