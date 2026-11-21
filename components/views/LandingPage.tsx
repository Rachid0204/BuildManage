import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../common/Button';
import LanguageToggle from '../common/LanguageToggle';
import { useI18n } from '../../hooks/useI18n';
import {
  AGIcon,
  BuildingsIcon,
  ChatIcon,
  DocumentsIcon,
  FinancialsIcon,
  MarketplaceIcon,
  PrestatairesIcon,
} from '../icons/IconComponents';
import { PLAN_CATALOG, isUnlimitedPlan } from '../../utils/subscriptionPolicy';
import type { SubscriptionPlan } from '../../types';

interface LandingPageProps {
  onLoginClick: () => void;
  onSelectPlan?: (plan: SubscriptionPlan) => void;
}

type HeroPreviewTab = 'collections' | 'csv' | 'assembly';
type PortalKey = 'syndic' | 'resident' | 'provider';

const PLAN_ORDER: SubscriptionPlan[] = ['starter', 'professional', 'enterprise'];

const LandingPage: React.FC<LandingPageProps> = ({
  onLoginClick,
  onSelectPlan,
}) => {
  const { t, tr, language } = useI18n();
  const [heroTab, setHeroTab] = useState<HeroPreviewTab>('collections');
  const [activePortal, setActivePortal] = useState<PortalKey>('syndic');
  const [billingView, setBillingView] = useState<'monthly' | 'annual'>(
    'monthly',
  );
  const [openFaqIndex, setOpenFaqIndex] = useState<number>(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handlePlanChoose = (plan: SubscriptionPlan) => {
    if (onSelectPlan) {
      onSelectPlan(plan);
    } else {
      onLoginClick();
    }
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else if (id === 'pricing-plans') {
      handlePlanChoose('professional');
    }
  };

  const portals: Record<
    PortalKey,
    {
      labelFr: string;
      labelAr: string;
      audienceFr: string;
      audienceAr: string;
      titleFr: string;
      titleAr: string;
      descFr: string;
      descAr: string;
      bulletsFr: string[];
      bulletsAr: string[];
      metricLabelFr: string;
      metricLabelAr: string;
      metricValue: string;
    }
  > = {
    syndic: {
      labelFr: 'Espace Syndic',
      labelAr: 'فضاء السنديك',
      audienceFr: 'Cabinets professionnels & syndics bénévoles',
      audienceAr: 'مكاتب السنديك المهنية والتطوعية',
      titleFr: 'Pilotez l’ensemble de votre portefeuille depuis un seul cockpit',
      titleAr: 'أدر جميع عماراتك من لوحة قيادة موحدة وواضحة',
      descFr:
        'Configurez vos résidences, générez les appels de fonds mensuels ou travaux AG, validez les virements et publiez vos quittances certifiées.',
      descAr:
        'أعد الإقامات، أنشئ طلبات المساهمات الشهرية أو الأشغال، اعتمد التحويلات البنكية وأصدر الوصولات الرسمية.',
      bulletsFr: [
        'Génération mensuelle & suivi automatique des impayés en MAD',
        'Rapprochement bancaire CSV et validation 1-clic des justificatifs',
        'Convocations AGO/AGE, calcul de quorum et appels travaux configurables',
        'Édition instantanée des Fiches d’Accès PDF pour résidents et prestataires',
      ],
      bulletsAr: [
        'إصدار شهري آلي وتتبع دقيق للمتأخرات بالدرهم المغربي',
        'مطابقة كشف الحساب CSV واعتماد إثباتات الدفع بنقرة واحدة',
        'استدعاءات الجمع العام وحساب النصاب وطلبات تمويل الأشغال',
        'إصدار فوري لبطاقات الولوج PDF للسكان ومقدمي الخدمات',
      ],
      metricLabelFr: 'Portefeuille & Comptabilité',
      metricLabelAr: 'المحفظة والمحاسبة',
      metricValue: 'Loi 18-00 & 106-12',
    },
    resident: {
      labelFr: 'Portail Copropriétaire & Locataire',
      labelAr: 'بوابة المالك والمكتري',
      audienceFr: 'Accès délivré exclusivement par le Syndic',
      audienceAr: 'ولوج مؤمّن يُسلَّم حصرياً من طرف السنديك',
      titleFr: 'Transparence financière et vraie vie de résidence entre voisins',
      titleAr: 'شفافية مالية كاملة وحياة جماعية وتعاون بين الجيران',
      descFr:
        'Chaque résident suit ses charges et quittances PDF, vote en AG, discute sur la messagerie interne d’entraide et échange librement sur Le Souk de la résidence.',
      descAr:
        'يتابع كل ساكن مساهماته ووصولاته PDF، ويصوّت في الجمع العام، ويتواصل مع جيرانه عبر المراسلة الداخلية وسوق الإقامة.',
      bulletsFr: [
        'Relevé de compte clair : charges courantes, travaux AG et solde dû',
        'Quittances PDF numérotées & dépôt de justificatif bancaire en direct',
        'Messagerie interne (4 canaux) : dialogue Syndic, entraide & bon voisinage',
        'Le Souk de la résidence : ventes, dons, prêts d’objets & services entre voisins',
      ],
      bulletsAr: [
        'كشف حساب شفاف: الواجبات الجارية وأشغال الجمع العام والرصيد',
        'وصولات PDF مرقمة وإيداع إثباتات التحويل البنكي مباشرة',
        'مراسلة داخلية (4 قنوات): حوار مع السنديك، تعاون وحسن الجوار',
        'سوق الإقامة: بيع، هبات، إعارة أدوات وخدمات بين الجيران',
      ],
      metricLabelFr: 'Confiance & Entraide',
      metricLabelAr: 'الثقة والتعاون',
      metricValue: '24/7 Mobile',
    },
    provider: {
      labelFr: 'Portail Prestataire Agréé',
      labelAr: 'بوابة مقدم الخدمات المعتمد',
      audienceFr: 'Ascensoristes, sécurité, nettoyage, maintenance',
      audienceAr: 'شركات المصاعد، الحراسة، النظافة، الصيانة',
      titleFr: 'Interventions tracées et suivi contractuel sans perte de temps',
      titleAr: 'تتبع التدخلات والعقود بدقة دون مكالمات أو أوراق ضائعة',
      descFr:
        'Les prestataires sous contrat reçoivent les tickets techniques assignés à leur spécialité, mettent à jour le statut d’intervention et déposent leurs comptes rendus.',
      descAr:
        'يتلقى المزودون المتعاقدون طلبات التدخل المرتبطة بمجالهم، ويحدّثون حالة الأشغال ويرفقون تقارير الإنجاز.',
      bulletsFr: [
        'Vue dédiée aux ordres de service et tickets prioritaires par résidence',
        'Traçabilité complète avant / après intervention avec notes techniques',
        'Fiche entreprise ICE, RC, contrat annuel et RIB vérifiés par le Syndic',
        'Coordination directe avec le gestionnaire de l’immeuble',
      ],
      bulletsAr: [
        'واجهة خاصة بأوامر الخدمة والتدخلات ذات الأولوية حسب الإقامة',
        'تتبع كامل قبل وبعد التدخل مع الملاحظات التقنية',
        'ملف الشركة (ICE، السجل التجاري، العقد السنوي) موثق لدى السنديك',
        'تنسيق مباشر وواضح مع مسير العمارة',
      ],
      metricLabelFr: 'Contrats & Maintenance',
      metricLabelAr: 'العقود والصيانة',
      metricValue: 'ICE / RC',
    },
  };

  const faqItems = [
    {
      qFr: 'Comment les copropriétaires, locataires et prestataires reçoivent-ils leurs accès ?',
      qAr: 'كيف يتسلم الملاك المشتركون والمكترون ومقدمو الخدمات بيانات ولوجهم؟',
      aFr: 'Par sécurité et conformément à la gouvernance Loi 18-00, aucune inscription publique n’est ouverte pour les résidents. Depuis votre espace Syndic, vous rattachez le résident ou prestataire à son lot et téléchargez en 1 clic sa Fiche d’Accès PDF officielle avec ses identifiants personnels.',
      aAr: 'لأسباب أمنية وتماشياً مع القانون 18-00، لا يوجد تسجيل مفتوح وعشوائي للسكان. من لوحة السنديك، تربط المالك أو المزود بشقته وتحمّل بنقرة واحدة بطاقة الولوج الرسمية PDF التي تتضمن بيانات الدخول.',
    },
    {
      qFr: 'Comment la Messagerie interne et Le Souk favorisent-ils l’entraide entre résidents ?',
      qAr: 'كيف تساعد المراسلة الداخلية وسوق الإقامة على التعارف والتعاون بين السكان؟',
      aFr: 'Chaque immeuble dispose d’un espace communautaire privé réservé uniquement à ses résidents vérifiés : 4 canaux de discussion (Général, Bureau du Syndic, Entraide & Bon Voisinage pour prêt d’outils, covoiturage ou réception de colis, et Discussions du Souk) plus Le Souk de la résidence pour vendre en MAD, donner gratuitement, prêter ou proposer des services entre voisins.',
      aAr: 'تتوفر كل عمارة على فضاء خاص محصور في سكانها المعتمدين: 4 قنوات للمناقشة (القناة العامة، مكتب السنديك، التعاون وحسن الجوار لإعارة الأدوات والنقل المشترك واستلام الطرود، ومناقشات السوق) إضافة إلى سوق الإقامة للبيع بالدرهم أو الهبة المجانية أو الإعارة وتبادل الخدمات بين الجيران.',
    },
    {
      qFr: 'Comment fonctionne la tarification et que se passe-t-il si j’archive un immeuble ?',
      qAr: 'كيف يتم احتساب الباقة وماذا يحدث عند أرشفة عمارة؟',
      aFr: 'Toutes les fonctionnalités (comptabilité, CSV bancaire, AG, portails, messagerie interne et Le Souk) sont incluses dans les 3 forfaits. Seul le nombre d’immeubles actifs compte : Essentiel (190 MAD/mois jusqu’à 4 immeubles), Pro (390 MAD/mois jusqu’à 8 immeubles), Entreprise (790 MAD/mois illimité). Si vous archivez un immeuble, son historique financier est conservé intégralement et sa place est libérée.',
      aAr: 'جميع الميزات (المالية، كشف البنك CSV، الجموع العامة، البوابات، المراسلة الداخلية وسوق الإقامة) مشمولة في الباقات الثلاث. يتم الاحتساب فقط حسب عدد العمارات النشطة: الأساسية (190 درهم حتى 4 عمارات)، الاحترافية (390 درهم حتى 8 عمارات)، المقاولات (790 درهم غير محدود). عند أرشفة عمارة، يُحفظ سجلها المالي بالكامل وتُحرَّر حصتها فوراً.',
    },
    {
      qFr: 'Puis-je reprendre un immeuble déjà géré avec ses soldes et impayés existants ?',
      qAr: 'هل يمكنني إدخال عمارة قائمة مع أرصدتها الافتتاحية والمتأخرات السابقة؟',
      aFr: 'Oui. Lors de la configuration, vous saisissez les soldes d’ouverture (compte courant et fonds de réserve Loi 106-12), les tantièmes sur 1000 millièmes, ainsi que la date d’affectation des propriétaires pour que la facturation mensuelle démarre proprement sans doublons.',
      aAr: 'نعم. يمكنك إدخال الأرصدة الافتتاحية (الحساب الجاري وصندوق الاحتياط)، وجدول الحصص على 1000 جزء، وتاريخ تعيين الملاك لبدء الفوترة الشهرية بدقة دون تكرار.',
    },
    {
      qFr: 'Comment se déroule l’essai gratuit de 30 jours ?',
      qAr: 'كيف تعمل الفترة التجريبية المجانية لمدة 30 يوماً؟',
      aFr: 'À la création de votre cabinet Syndic, vous bénéficiez immédiatement de 30 jours d’accès complet sans carte bancaire. Dès que vous êtes satisfait, le règlement de votre abonnement (mensuel, semestriel ou annuel par virement marocain) prolonge votre licence sans interruption.',
      aAr: 'بمجرد إنشاء حساب مكتب السنديك، تحصل فوراً على 30 يوماً من الولوج الكامل دون بطاقة بنكية. وعند تأكيد استمرارك، يتم تمديد الاشتراك بتحويل بنكي مغربي دون أي انقطاع في الخدمة.',
    },
  ];

  const comparisonRows = [
    {
      labelFr: 'Immeubles actifs gérés',
      labelAr: 'العمارات النشطة المُسيّرة',
      starter: tr('Jusqu’à 4', 'حتى 4'),
      professional: tr('Jusqu’à 8', 'حتى 8'),
      enterprise: tr('Illimité', 'غير محدود'),
    },
    {
      labelFr: 'Lots, propriétaires & locataires',
      labelAr: 'الشقق والملاك والمكترون',
      starter: tr('Illimités', 'غير محدود'),
      professional: tr('Illimités', 'غير محدود'),
      enterprise: tr('Illimités', 'غير محدود'),
    },
    {
      labelFr: 'Finance Loi 18-00, Tantièmes & Fonds de Réserve 106-12',
      labelAr: 'المالية، التانتييم وصندوق الاحتياط 106-12',
      starter: '✓',
      professional: '✓',
      enterprise: '✓',
    },
    {
      labelFr: 'Quittances PDF numérotées & Fiches d’Accès PDF',
      labelAr: 'وصولات PDF المرقمة وبطاقات الولوج',
      starter: '✓',
      professional: '✓',
      enterprise: '✓',
    },
    {
      labelFr: 'Rapprochement bancaire CSV & validation virements',
      labelAr: 'مطابقة كشف البنك CSV واعتماد التحويلات',
      starter: '✓',
      professional: '✓',
      enterprise: '✓',
    },
    {
      labelFr: 'Assemblées Générales (AGO/AGE), quorum & vote en ligne',
      labelAr: 'الجموع العامة، النصاب والتصويت الرقمي',
      starter: '✓',
      professional: '✓',
      enterprise: '✓',
    },
    {
      labelFr: 'Portails Copropriétaire & Prestataire agréé',
      labelAr: 'بوابة السكان وبوابة مقدمي الخدمات',
      starter: '✓',
      professional: '✓',
      enterprise: '✓',
    },
    {
      labelFr: 'Messagerie interne (4 canaux d’entraide & dialogue Syndic)',
      labelAr: 'المراسلة الداخلية (4 قنوات للتعاون والتواصل مع السنديك)',
      starter: '✓',
      professional: '✓',
      enterprise: '✓',
    },
    {
      labelFr: 'Le Souk de la résidence (ventes, dons, prêts & services entre voisins)',
      labelAr: 'سوق الإقامة (بيع، هبات، إعارة وخدمات بين الجيران)',
      starter: '✓',
      professional: '✓',
      enterprise: '✓',
    },
  ];

  const currentPortal = portals[activePortal];

  return (
    <div
      className="min-h-screen bg-stone-50 text-slate-900 flex flex-col font-sans antialiased"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Top Navigation */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center gap-2 sm:gap-4">
            <a
              href="#top"
              className="flex items-center gap-2 sm:gap-2.5 focus:outline-none shrink-0"
            >
              <div className="w-8 h-8 sm:w-9 sm:h-9 bg-teal-700 rounded-lg flex items-center justify-center text-white shadow-xs shrink-0">
                <BuildingsIcon />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-extrabold text-lg sm:text-xl text-slate-900 tracking-tight">
                  Syndik
                </span>
                <span className="hidden sm:inline-block text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
                  Loi 18-00 &amp; 106-12
                </span>
              </div>
            </a>

            <nav
              aria-label={tr('Navigation principale', 'التنقل الرئيسي')}
              className="hidden lg:flex items-center gap-7 text-sm font-semibold text-slate-600"
            >
              <button
                type="button"
                onClick={() => scrollToSection('features')}
                className="hover:text-teal-700 transition-colors"
              >
                {tr('Fonctionnalités', 'الميزات')}
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('portals')}
                className="hover:text-teal-700 transition-colors"
              >
                {tr('3 Portails', 'البوابات')}
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('pricing-plans')}
                className="hover:text-teal-700 transition-colors"
              >
                {tr('Tarifs', 'الأسعار')}
              </button>
              <button
                type="button"
                onClick={() => scrollToSection('faq')}
                className="hover:text-teal-700 transition-colors"
              >
                {tr('FAQ', 'أسئلة شائعة')}
              </button>
              <Link
                to="/guide"
                className="hover:text-teal-700 transition-colors"
              >
                {tr('Guide', 'الدليل')}
              </Link>
            </nav>

            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              <LanguageToggle variant="light" compactMobile />
              <button
                type="button"
                onClick={onLoginClick}
                className="hidden sm:inline-flex items-center text-xs sm:text-sm font-bold text-slate-700 hover:text-teal-700 px-2.5 py-2 min-h-[36px] transition-colors whitespace-nowrap"
              >
                {tr('Se connecter', 'تسجيل الدخول')}
              </button>
              <Button
                onClick={() => scrollToSection('pricing-plans')}
                className="text-xs sm:text-sm font-bold px-2.5 sm:px-4 py-2 min-h-[36px] whitespace-nowrap"
              >
                <span className="sm:hidden">{tr('Essai 30 j', 'تجربة مجانية')}</span>
                <span className="hidden sm:inline">{tr('Essai gratuit 30 j', 'تجربة 30 يوماً')}</span>
              </Button>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                aria-expanded={isMobileMenuOpen}
                aria-label={tr('Menu de navigation', 'قائمة التنقل')}
                className="lg:hidden inline-flex items-center justify-center min-w-[36px] min-h-[36px] rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {isMobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Collapsible Mobile Navigation Drawer (< lg) */}
        {isMobileMenuOpen && (
          <div className="lg:hidden border-t border-slate-200 bg-white px-4 py-3 space-y-1 shadow-md">
            {(
              [
                { id: 'features', fr: 'Fonctionnalités', ar: 'الميزات' },
                { id: 'portals', fr: '3 Portails (Syndic, Résident, Prestataire)', ar: 'البوابات الثلاث (سنديك، ساكن، مقدم خدمة)' },
                { id: 'pricing-plans', fr: 'Tarifs & Plans', ar: 'الأسعار والباقات' },
                { id: 'faq', fr: 'FAQ', ar: 'أسئلة شائعة' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  scrollToSection(item.id);
                }}
                className="w-full text-start px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-700 hover:bg-teal-50 hover:text-teal-800 transition-colors"
              >
                {tr(item.fr, item.ar)}
              </button>
            ))}
            <Link
              to="/guide"
              onClick={() => setIsMobileMenuOpen(false)}
              className="block w-full text-start px-3 py-2.5 rounded-lg text-sm font-semibold text-teal-800 hover:bg-teal-50 transition-colors"
            >
              {tr('Centre d’Aide & Guides', 'مركز المساعدة والأدلة')}
            </Link>
            <div className="pt-2 mt-2 border-t border-slate-100 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onLoginClick();
                }}
                className="flex-1 py-2.5 px-3 rounded-lg border border-slate-300 text-sm font-bold text-slate-800 hover:bg-slate-50"
              >
                {tr('Se connecter', 'تسجيل الدخول')}
              </button>
              <Button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  scrollToSection('pricing-plans');
                }}
                className="flex-1 py-2.5 text-sm font-bold justify-center"
              >
                {tr('Essai gratuit 30 j', 'تجربة 30 يوماً')}
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section
        id="top"
        className="bg-gradient-to-b from-white via-white to-stone-50 border-b border-slate-200"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            <main className="lg:col-span-6 text-start">
              <p className="text-xs font-bold tracking-[0.14em] uppercase text-teal-800 mb-3">
                {tr(
                  'Logiciel de Syndic au Maroc · Conformité Loi 18-00 & 106-12',
                  'منصة تدبير الملكية المشتركة بالمغرب · قانون 18-00 و 106-12',
                )}
              </p>
              <h1 className="text-3xl sm:text-5xl xl:text-[3.15rem] font-extrabold text-slate-900 tracking-tight leading-[1.12]">
                <span className="block">{t('landing.hero.title')}</span>
                <span className="block text-teal-700 mt-1.5">
                  {t('landing.hero.highlight')}
                </span>
              </h1>
              <p className="mt-5 text-base sm:text-lg text-slate-600 max-w-xl leading-relaxed">
                {t('landing.hero.subtitle')}
              </p>

              <div className="mt-7 flex flex-col sm:flex-row sm:items-center gap-3">
                <Button
                  onClick={() => handlePlanChoose('professional')}
                  className="w-full sm:w-auto px-6 py-3.5 text-sm sm:text-base font-bold justify-center"
                >
                  {tr(
                    'Démarrer mon essai gratuit 30 j',
                    'ابدأ التجربة المجانية 30 يوماً',
                  )}
                </Button>
                <Button
                  variant="secondary"
                  onClick={onLoginClick}
                  className="w-full sm:w-auto px-6 py-3.5 text-sm sm:text-base font-semibold justify-center"
                >
                  {tr('Accéder à mon espace', 'الولوج إلى فضائي')}
                </Button>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium text-slate-600">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-teal-700 font-bold">✓</span>
                  {tr('Toutes fonctionnalités incluses', 'جميع الميزات مشمولة')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-teal-700 font-bold">✓</span>
                  {tr('Sans carte bancaire', 'بدون بطاقة بنكية')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-teal-700 font-bold">✓</span>
                  {tr('Accès résidents via Fiche PDF', 'ولوج السكان عبر بطاقة PDF')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-teal-700 font-bold">✓</span>
                  {tr('Messagerie interne & Le Souk entre voisins', 'المراسلة الداخلية وسوق الإقامة بين الجيران')}
                </span>
              </div>
            </main>

            {/* Self-Contained Interactive Product Preview Workbench */}
            <div className="lg:col-span-6">
              <div
                role="region"
                aria-label={tr(
                  'Aperçu interactif de la plateforme Syndik',
                  'معاينة تفاعلية لمنصة سنديك',
                )}
                className="rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden"
              >
                {/* Preview Window Header & Interactive Tabs */}
                <div className="bg-slate-900 text-white px-4 sm:px-5 pt-4 pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-wider text-teal-400">
                        {tr('Résidence Les Iris · Casablanca', 'إقامة السوسن · الدار البيضاء')}
                      </p>
                      <p className="text-sm font-bold text-white">
                        {tr('Tableau financier & Gouvernance', 'لوحة المالية والحكامة')}
                      </p>
                    </div>
                    <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-slate-800 text-amber-300 border border-slate-700">
                      1 000 / 1 000 {tr('tantièmes', 'جزء')}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(
                      [
                        {
                          id: 'collections',
                          fr: 'Recouvrement MAD',
                          ar: 'التحصيل بالدرهم',
                        },
                        {
                          id: 'csv',
                          fr: 'Rapprochement CSV',
                          ar: 'مطابقة البنك CSV',
                        },
                        {
                          id: 'assembly',
                          fr: 'Vote AGO 18-00',
                          ar: 'تصويت الجمع العام',
                        },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setHeroTab(tab.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                          heroTab === tab.id
                            ? 'bg-teal-600 text-white'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {language === 'ar' ? tab.ar : tab.fr}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Preview Body */}
                <div className="p-4 sm:p-5 space-y-4">
                  {heroTab === 'collections' && (
                    <>
                      <div className="grid grid-cols-3 gap-3 text-start">
                        <div className="p-3 rounded-xl bg-stone-50 border border-slate-200">
                          <span className="text-[11px] font-semibold text-slate-500 block">
                            {tr('Compte courant', 'الحساب الجاري')}
                          </span>
                          <span className="text-base sm:text-lg font-extrabold font-mono text-slate-900">
                            48 250 DH
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-teal-50/70 border border-teal-200">
                          <span className="text-[11px] font-semibold text-teal-800 block">
                            {tr('Réserve 106-12', 'صندوق الاحتياط')}
                          </span>
                          <span className="text-base sm:text-lg font-extrabold font-mono text-teal-900">
                            19 400 DH
                          </span>
                        </div>
                        <div className="p-3 rounded-xl bg-stone-50 border border-slate-200">
                          <span className="text-[11px] font-semibold text-slate-500 block">
                            {tr('Recouvrement', 'نسبة التحصيل')}
                          </span>
                          <span className="text-base sm:text-lg font-extrabold font-mono text-emerald-700">
                            91,4 %
                          </span>
                        </div>
                      </div>

                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs">
                        {[
                          {
                            lot: tr('App. 04 · M. Bennani', 'شقة 04 · السيد بناني'),
                            share: '115 / 1000',
                            amount: '320 MAD',
                            statusFr: 'Quittance #Q-2026-041',
                            statusAr: 'وصل #Q-2026-041',
                            tone: 'bg-emerald-100 text-emerald-800',
                          },
                          {
                            lot: tr('App. 07 · Mme Idrissi', 'شقة 07 · السيدة الإدريسي'),
                            share: '125 / 1000',
                            amount: '350 MAD',
                            statusFr: 'Justificatif à valider',
                            statusAr: 'إثبات قيد المراجعة',
                            tone: 'bg-amber-100 text-amber-800',
                          },
                          {
                            lot: tr('App. 12 · M. Chraïbi', 'شقة 12 · السيد الشرايبي'),
                            share: '90 / 1000',
                            amount: '250 MAD',
                            statusFr: 'Échéance en cours',
                            statusAr: 'أجل الأداء جارٍ',
                            tone: 'bg-slate-100 text-slate-700',
                          },
                        ].map((row) => (
                          <div
                            key={row.lot}
                            className="flex items-center justify-between px-3.5 py-2.5 bg-white"
                          >
                            <div>
                              <p className="font-bold text-slate-900">{row.lot}</p>
                              <p className="text-[11px] font-mono text-slate-500">
                                {tr('Quote-part', 'الحصة')} : {row.share}
                              </p>
                            </div>
                            <div className="text-end">
                              <p className="font-mono font-bold text-slate-900">
                                {row.amount}
                              </p>
                              <span
                                className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${row.tone}`}
                              >
                                {language === 'ar' ? row.statusAr : row.statusFr}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {heroTab === 'csv' && (
                    <div className="space-y-3 text-xs">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-teal-50 border border-teal-200">
                        <div>
                          <p className="font-bold text-teal-900">
                            {tr(
                              'Import relevé bancaire (CSV) · 12 lignes analysées',
                              'استيراد كشف البنك (CSV) · تحليل 12 عملية',
                            )}
                          </p>
                          <p className="text-[11px] text-teal-800 mt-0.5">
                            {tr(
                              'Détection automatique des doublons et références de virement',
                              'كشف تلقائي للعمليات المكررة ومراجع التحويلات',
                            )}
                          </p>
                        </div>
                        <span className="font-mono font-bold px-2.5 py-1 rounded bg-white text-teal-800 border border-teal-200">
                          CIH / AWB
                        </span>
                      </div>

                      <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                        {[
                          {
                            ref: 'VIR-2026-4189',
                            desc: tr('Virement App. 04 · 2 mois', 'تحويل شقة 04 · شهران'),
                            amount: '+640,00 DH',
                            badgeFr: 'Affecté & Quittancé',
                            badgeAr: 'مطابق ومُوصَل',
                            tone: 'bg-emerald-100 text-emerald-800',
                          },
                          {
                            ref: 'VIR-2026-4195',
                            desc: tr('Virement App. 09 · Cotisation + AG', 'تحويل شقة 09 · واجب + أشغال'),
                            amount: '+1 450,00 DH',
                            badgeFr: 'Prêt à valider',
                            badgeAr: 'جاهز للاعتماد',
                            tone: 'bg-sky-100 text-sky-800',
                          },
                          {
                            ref: 'CHQ-882104',
                            desc: tr('Maintenance ascenseur mensuelle', 'صيانة المصعد الشهرية'),
                            amount: '-1 800,00 DH',
                            badgeFr: 'Charge fournisseur',
                            badgeAr: 'مصروف مزود',
                            tone: 'bg-slate-100 text-slate-700',
                          },
                        ].map((tx) => (
                          <div
                            key={tx.ref}
                            className="flex items-center justify-between px-3.5 py-2.5 bg-white"
                          >
                            <div>
                              <p className="font-mono font-bold text-slate-900">
                                {tx.ref}
                              </p>
                              <p className="text-[11px] text-slate-500">{tx.desc}</p>
                            </div>
                            <div className="text-end">
                              <p className="font-mono font-bold text-slate-900">
                                {tx.amount}
                              </p>
                              <span
                                className={`inline-block mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${tx.tone}`}
                              >
                                {language === 'ar' ? tx.badgeAr : tx.badgeFr}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {heroTab === 'assembly' && (
                    <div className="space-y-3 text-xs">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-stone-50 border border-slate-200">
                        <div>
                          <p className="font-bold text-slate-900">
                            {tr('AGO 2026 — Quorum légal atteint', 'الجمع العام 2026 — النصاب القانوني مكتمل')}
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {tr(
                              '685 / 1 000 tantièmes présents ou représentés',
                              '685 / 1000 جزء حاضر أو ممثل',
                            )}
                          </p>
                        </div>
                        <span className="font-mono font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                          68,5 %
                        </span>
                      </div>

                      <div className="space-y-2.5 border border-slate-200 rounded-xl p-3.5 bg-white">
                        <div>
                          <div className="flex justify-between font-bold text-slate-800 mb-1">
                            <span>
                              {tr(
                                'Résolution 01 · Budget prévisionnel 2026',
                                'القرار 01 · الميزانية التقديرية 2026',
                              )}
                            </span>
                            <span className="font-mono text-teal-700">84 % {tr('Pour', 'مع')}</span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-2 bg-teal-600 rounded-full" style={{ width: '84%' }} />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between font-bold text-slate-800 mb-1">
                            <span>
                              {tr(
                                'Résolution 02 · Travaux étanchéité terrasse',
                                'القرار 02 · أشغال عزل السطح',
                              )}
                            </span>
                            <span className="font-mono text-teal-700">76 % {tr('Pour', 'مع')}</span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-2 bg-emerald-600 rounded-full" style={{ width: '76%' }} />
                          </div>
                          <p className="text-[11px] text-slate-500 mt-1">
                            {tr(
                              'Appel de fonds travaux configurable par tantièmes dès approbation.',
                              'تفعيل طلب تمويل الأشغال حسب التانتييم فور المصادقة.',
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Controlled Syndic-Centric Governance Flow */}
      <section className="py-12 sm:py-14 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-400">
              {tr('Gouvernance Loi 18-00', 'حكامة القانون 18-00')}
            </p>
            <h2 className="mt-1.5 text-2xl sm:text-3xl font-extrabold tracking-tight">
              {tr(
                'Un circuit d’accès maîtrisé de bout en bout par le Syndic',
                'مسار ولوج محكم وتحت إشراف السنديك بالكامل',
              )}
            </h2>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              {tr(
                'Aucune inscription sauvage : le cabinet syndic structure ses lots, certifie les comptes et remet à chaque acteur ses accès officiels.',
                'لا تسجيلات عشوائية: مكتب السنديك يهيكل الشقق، يضبط الحسابات ويسلم كل طرف بيانات الولوج الرسمية.',
              )}
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2.5">
              <span className="inline-block text-xs font-mono font-bold text-teal-300">
                {tr('01 · CABINET SYNDIC', '01 · مكتب السنديك')}
              </span>
              <h3 className="text-base font-bold text-white">
                {tr('Création du cabinet & des résidences', 'إنشاء المكتب وتهيئة الإقامات')}
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {tr(
                  'Démarrez votre essai de 30 jours, créez vos immeubles, importez vos tantièmes et fixez votre taux de fonds de réserve (Loi 106-12).',
                  'ابدأ فترتك التجريبية لـ 30 يوماً، أنشئ عماراتك، اضبط حصص التانتييم وحدد نسبة صندوق الاحتياط.',
                )}
              </p>
            </div>

            <div className="p-6 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2.5">
              <span className="inline-block text-xs font-mono font-bold text-amber-300">
                {tr('02 · COPROPRIÉTAIRES & LOCATAIRES', '02 · الملاك والمكترون')}
              </span>
              <h3 className="text-base font-bold text-white">
                {tr('Fiches d’Accès PDF officielles', 'بطاقات الولوج الرسمية PDF')}
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {tr(
                  'Rattachez chaque résident à ses lots et téléchargez sa Fiche d’Accès PDF contenant ses identifiants pour consulter charges et quittances.',
                  'اربط كل ساكن بشقته وحمّل بطاقة الولوج الرسمية PDF لتسليمه بيانات الدخول لمتابعة حسابه ووصولاته.',
                )}
              </p>
            </div>

            <div className="p-6 rounded-xl bg-slate-800/80 border border-slate-700/80 space-y-2.5">
              <span className="inline-block text-xs font-mono font-bold text-emerald-300">
                {tr('03 · PRESTATAIRES AGRÉÉS', '03 · مقدمو الخدمات المعتمدون')}
              </span>
              <h3 className="text-base font-bold text-white">
                {tr('Suivi des contrats & interventions', 'تتبع العقود والتدخلات')}
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {tr(
                  'Enregistrez vos fournisseurs (ICE, RC, RIB), délivrez leur accès portail et assignez les incidents techniques avec photos.',
                  'سجّل شركات الصيانة المعتمدة (ICE/RC)، امنحها ولوجاً خاصاً ووجّه لها طلبات التدخل الموثقة بالصور.',
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Core Platform Capabilities */}
      <section id="features" className="py-14 sm:py-16 bg-stone-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-800">
              {t('landing.features.subtitle')}
            </p>
            <h2 className="mt-2 text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
              {t('landing.features.title')}
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs flex gap-4">
              <div className="flex-shrink-0 h-11 w-11 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center">
                <FinancialsIcon />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {tr(
                    'Comptabilité Tantièmes & Quittances PDF',
                    'محاسبة الحصص (التانتييم) ووصولات PDF',
                  )}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  {tr(
                    'Appels mensuels automatisés, paiements partiels ou multi-échéances, calcul exact au centime, Fonds de Réserve Loi 106-12, contrôle budgétaire strict des dépenses et clôture de période.',
                    'إصدار شهري آلي، أداءات جزئية أو مجمعة بدقة السنتيم، صندوق الاحتياط، مراقبة صارمة للميزانية وإغلاق الفترات المحاسبية.',
                  )}
                </p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs flex gap-4">
              <div className="flex-shrink-0 h-11 w-11 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center">
                <DocumentsIcon />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {tr(
                    'Rapprochement Bancaire CSV & Justificatifs',
                    'مطابقة كشف البنك CSV وإثباتات التحويل',
                  )}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  {tr(
                    'Importez vos relevés bancaires CSV avec dédoublonnage automatique et validez en 1 clic les reçus de virement envoyés par les résidents depuis leur portail.',
                    'استورد كشوفات البنك CSV مع منع التكرار، واعتمد بنقرة واحدة وصولات التحويل المرسلة من طرف السكان.',
                  )}
                </p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs flex gap-4">
              <div className="flex-shrink-0 h-11 w-11 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center">
                <AGIcon />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {tr(
                    'Assemblées Générales AGO/AGE & Travaux',
                    'الجموع العامة AGO/AGE وتمويل الأشغال',
                  )}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  {tr(
                    'Préparez l’ordre du jour, suivez les présences et procurations, calculez le quorum sur 1 000 tantièmes, ouvrez le vote en ligne et générez les appels de travaux exceptionnels configurables.',
                    'حضّر جدول الأعمال، تتبع الحضور والوكالات، احسب النصاب القانوني على 1000 جزء، فعّل التصويت الرقمي وأصدر مساهمات الأشغال.',
                  )}
                </p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs flex gap-4">
              <div className="flex-shrink-0 h-11 w-11 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center">
                <ChatIcon />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {tr(
                    'Messagerie Interne & Entraide entre Voisins',
                    'المراسلة الداخلية والتعاون بين الجيران',
                  )}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  {tr(
                    '4 canaux dédiés par immeuble (Général, Bureau du Syndic, Entraide & Bon Voisinage pour prêt d’outils, covoiturage ou colis, et Discussions du Souk), étiquettes thématiques et réactions entre résidents.',
                    '4 قنوات مخصصة لكل عمارة (القناة العامة، مكتب السنديك، التعاون وحسن الجوار لإعارة الأدوات والنقل المشترك والطرود، ومناقشات السوق) لتعزيز التواصل بين الجيران.',
                  )}
                </p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs flex gap-4">
              <div className="flex-shrink-0 h-11 w-11 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center">
                <MarketplaceIcon />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {tr(
                    'Le Souk de la Résidence (Marketplace)',
                    'سوق الإقامة (البيع، الهبة والخدمات)',
                  )}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  {tr(
                    'Petites annonces privées et vérifiées entre voisins : ventes en MAD, dons gratuits, prêts d’objets ou services d’entraide avec photos, discussion intégrée et contact direct WhatsApp ou téléphone.',
                    'إعلانات خاصة وموثوقة بين سكان نفس العمارة: بيع بالدرهم، هبات مجانية، إعارة أو تبادل خدمات مع الصور، دردشة مدمجة وتواصل مباشر عبر الهاتف أو واتساب.',
                  )}
                </p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs flex gap-4">
              <div className="flex-shrink-0 h-11 w-11 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center">
                <PrestatairesIcon />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {tr(
                    'Prestataires Agréés & Annonces Bilingues FR/AR',
                    'المزودون المعتمدون والإعلانات الثنائية',
                  )}
                </h3>
                <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
                  {tr(
                    'Publiez vos avis officiels et documents de copropriété en français et en arabe, centralisez les fiches fournisseurs (ICE, RC, RIB) et suivez chaque intervention technique avec photos.',
                    'انشر الإعلانات الرسمية ووثائق الملكية المشتركة بالعربية والفرنسية، نظّم ملفات الشركات (ICE/RC/RIB) وتابع أشغال الصيانة بالصور.',
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interactive 3-Portal Switcher */}
      <section id="portals" className="py-14 sm:py-16 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-800">
                {tr('Expérience multi-acteurs', 'تجربة متعددة الأطراف')}
              </p>
              <h2 className="mt-1.5 text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                {tr(
                  'Trois portails dédiés, chacun adapté à son rôle',
                  'ثلاث بوابات متخصصة، كل واحدة مصممة حسب الدور',
                )}
              </h2>
            </div>

            <div
              role="tablist"
              aria-label={tr('Choisir un portail', 'اختر بوابة')}
              className="inline-flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-slate-100 border border-slate-200"
            >
              {(
                [
                  { id: 'syndic', icon: <BuildingsIcon /> },
                  { id: 'resident', icon: <FinancialsIcon /> },
                  { id: 'provider', icon: <PrestatairesIcon /> },
                ] as const
              ).map(({ id }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={activePortal === id}
                  onClick={() => setActivePortal(id)}
                  className={`px-3.5 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${
                    activePortal === id
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {language === 'ar' ? portals[id].labelAr : portals[id].labelFr}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-stone-50 p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-7 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-teal-800 uppercase tracking-wider">
                  {language === 'ar'
                    ? currentPortal.audienceAr
                    : currentPortal.audienceFr}
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900">
                {language === 'ar'
                  ? currentPortal.titleAr
                  : currentPortal.titleFr}
              </h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                {language === 'ar' ? currentPortal.descAr : currentPortal.descFr}
              </p>
              <ul className="space-y-2.5 pt-1 text-sm text-slate-800">
                {(language === 'ar'
                  ? currentPortal.bulletsAr
                  : currentPortal.bulletsFr
                ).map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="text-teal-700 font-bold">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {language === 'ar'
                  ? currentPortal.metricLabelAr
                  : currentPortal.metricLabelFr}
              </p>
              <p className="text-3xl font-extrabold font-mono text-teal-700">
                {currentPortal.metricValue}
              </p>
              <p className="text-xs text-slate-600 leading-relaxed">
                {activePortal === 'syndic'
                  ? tr(
                      'Créez votre cabinet dès aujourd’hui et testez tous les modules gratuitement pendant 30 jours.',
                      'أنشئ مكتبك اليوم وجرّب جميع الوحدات مجاناً لمدة 30 يوماً.',
                    )
                  : tr(
                      'Identifiants sécurisés remis par le Syndic sur Fiche PDF. Connexion instantanée par email ou CIN.',
                      'بيانات ولوج مؤمّنة يسلمها السنديك عبر بطاقة PDF. دخول فوري عبر البريد أو رقم البطاقة الوطنية.',
                    )}
              </p>
              <div className="pt-1">
                {activePortal === 'syndic' ? (
                  <Button
                    onClick={() => handlePlanChoose('professional')}
                    className="w-full justify-center py-2.5 text-sm font-bold"
                  >
                    {tr('Créer mon cabinet Syndic →', 'أنشئ حساب مكتب السنديك ←')}
                  </Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={onLoginClick}
                    className="w-full justify-center py-2.5 text-sm font-bold"
                  >
                    {tr('Ouvrir l’écran de connexion →', 'الانتقال إلى صفحة الدخول ←')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Unified Transparent Pricing */}
      <section id="pricing-plans" className="py-16 bg-stone-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-800">
              {tr('Tarification Maroc · Sans surprise', 'تسعير شفاف بالمغرب · بدون مفاجآت')}
            </p>
            <h2 className="mt-2 text-3xl sm:text-4xl font-extrabold text-slate-900">
              {t('landing.pricing.title')}
            </h2>
            <p className="mt-3 text-base text-slate-600">
              {tr(
                'Toutes les fonctionnalités sont incluses dès le premier forfait : vous choisissez simplement la capacité adaptée à votre nombre d’immeubles actifs.',
                'جميع الميزات مشمولة منذ الباقة الأولى: تختار فقط السعة المناسبة لعدد العمارات النشطة لديك.',
              )}
            </p>

            {/* Billing Display Switcher */}
            <div className="mt-6 inline-flex items-center gap-1 p-1 rounded-xl bg-white border border-slate-200 shadow-2xs">
              <button
                type="button"
                onClick={() => setBillingView('monthly')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                  billingView === 'monthly'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tr('Tarif mensuel (MAD/mois)', 'الدفع الشهري (درهم/شهر)')}
              </button>
              <button
                type="button"
                onClick={() => setBillingView('annual')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
                  billingView === 'annual'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tr('Budget annuel (12 mois)', 'الميزانية السنوية (12 شهراً)')}
              </button>
            </div>
          </div>

          <div className="mt-12 space-y-6 lg:space-y-0 lg:grid lg:grid-cols-3 lg:gap-6 lg:max-w-6xl lg:mx-auto items-stretch">
            {PLAN_ORDER.map((planKey) => {
              const plan = PLAN_CATALOG[planKey];
              const isPro = Boolean(plan.popular);
              const isUnlimited = isUnlimitedPlan(plan.buildingsLimit);
              const annualTotal = plan.priceMad * 12;

              return (
                <div
                  key={plan.id}
                  className={`rounded-2xl flex flex-col bg-white transition-shadow ${
                    isPro
                      ? 'border-2 border-teal-700 shadow-lg relative'
                      : 'border border-slate-200 shadow-xs hover:shadow-md'
                  }`}
                >
                  {isPro && (
                    <div className="bg-teal-700 text-white text-center py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-t-[14px]">
                      {t('landing.pricing.popular')}
                    </div>
                  )}

                  <div className="p-6 sm:p-7 flex-1 flex flex-col">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xl font-extrabold text-slate-900">
                        {language === 'ar' ? plan.nameAr : plan.nameFr}
                      </h3>
                      <span
                        className={`text-xs font-mono font-bold px-2.5 py-1 rounded-md ${
                          isPro
                            ? 'bg-teal-50 text-teal-800 border border-teal-200'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {language === 'ar' ? plan.badgeAr : plan.badgeFr}
                      </span>
                    </div>

                    <p className="mt-2.5 text-sm text-slate-600 min-h-[40px]">
                      {language === 'ar' ? plan.targetAr : plan.targetFr}
                    </p>

                    <div className="mt-5 pb-5 border-b border-slate-100">
                      <div className="flex items-baseline gap-1.5 font-mono">
                        <span className="text-4xl font-extrabold text-slate-900">
                          {billingView === 'monthly'
                            ? plan.priceMad.toLocaleString('fr-MA')
                            : annualTotal.toLocaleString('fr-MA')}
                        </span>
                        <span className="text-sm font-semibold text-slate-500">
                          MAD /{' '}
                          {billingView === 'monthly'
                            ? t('landing.pricing.month')
                            : tr('an', 'سنة')}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 font-medium">
                        {billingView === 'annual'
                          ? `${plan.priceMad} MAD/${t('landing.pricing.month')} · `
                          : ''}
                        {tr(
                          '30 jours d’essai gratuit sans carte bancaire',
                          '30 يوماً تجربة مجانية بدون بطاقة بنكية',
                        )}
                      </p>
                    </div>

                    <ul className="mt-5 space-y-3 text-sm text-slate-700 flex-1">
                      {(language === 'ar'
                        ? plan.highlightsAr
                        : plan.highlightsFr
                      ).map((highlight) => (
                        <li key={highlight} className="flex items-start gap-2.5">
                          <span className="text-teal-700 font-bold shrink-0">
                            ✓
                          </span>
                          <span>{highlight}</span>
                        </li>
                      ))}
                      {!isUnlimited && (
                        <li className="flex items-start gap-2.5 text-xs text-slate-500 pt-1">
                          <span className="text-slate-400 font-bold shrink-0">
                            •
                          </span>
                          <span>
                            {tr(
                              'Évolutif à tout moment sans perte de données',
                              'قابل للترقية في أي وقت دون فقدان أي بيانات',
                            )}
                          </span>
                        </li>
                      )}
                    </ul>
                  </div>

                  <div className="p-6 pt-0">
                    <Button
                      onClick={() => handlePlanChoose(plan.id)}
                      variant={isPro ? 'primary' : 'secondary'}
                      className="w-full py-3 justify-center font-bold text-sm"
                    >
                      {language === 'ar' ? plan.ctaAr : plan.ctaFr}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Concise Plan Comparison Matrix */}
          <div className="mt-12 lg:max-w-5xl lg:mx-auto bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm sm:text-base font-bold text-slate-900">
                {tr(
                  'Comparatif détaillé — Toutes les fonctionnalités métier incluses',
                  'مقارنة مفصلة — جميع الميزات مشمولة في كل الباقات',
                )}
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
                <thead className="bg-white">
                  <tr>
                    <th className="px-5 py-3 text-start font-bold text-slate-500">
                      {tr('Capacité & Modules', 'السعة والوحدات')}
                    </th>
                    {PLAN_ORDER.map((planKey) => (
                      <th
                        key={planKey}
                        className="px-4 py-3 text-center font-bold text-slate-900"
                      >
                        {language === 'ar'
                          ? PLAN_CATALOG[planKey].nameAr
                          : PLAN_CATALOG[planKey].nameFr}{' '}
                        <span className="block text-[11px] font-mono text-teal-700 font-semibold">
                          {PLAN_CATALOG[planKey].priceMad} MAD
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {comparisonRows.map((row) => (
                    <tr key={row.labelFr} className="hover:bg-stone-50/70">
                      <td className="px-5 py-3 font-medium text-slate-700">
                        {language === 'ar' ? row.labelAr : row.labelFr}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-teal-700">
                        {row.starter}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-teal-700 bg-teal-50/30">
                        {row.professional}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-teal-700">
                        {row.enterprise}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Practical FAQ Accordion */}
      <section id="faq" className="py-14 sm:py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-800">
              {tr('Questions fréquentes', 'الأسئلة المتكررة')}
            </p>
            <h2 className="mt-1.5 text-2xl sm:text-3xl font-extrabold text-slate-900">
              {tr(
                'Tout savoir avant de lancer votre cabinet sur Syndik',
                'كل ما تحتاج معرفته قبل انطلاق مكتبك على سنديك',
              )}
            </h2>
          </div>

          <div className="divide-y divide-slate-200 border border-slate-200 rounded-2xl overflow-hidden bg-white">
            {faqItems.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div key={item.qFr}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenFaqIndex(isOpen ? -1 : idx)}
                    className="w-full px-6 py-4 text-start flex items-center justify-between gap-4 hover:bg-stone-50 transition-colors"
                  >
                    <span className="font-bold text-sm sm:text-base text-slate-900">
                      {language === 'ar' ? item.qAr : item.qFr}
                    </span>
                    <span className="font-mono text-lg font-bold text-teal-700 shrink-0">
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 text-sm text-slate-600 leading-relaxed">
                      {language === 'ar' ? item.aAr : item.aFr}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Closing Conversion Banner */}
          <div className="mt-12 rounded-2xl bg-slate-900 text-white p-7 sm:p-9 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-1.5 max-w-xl">
              <h3 className="text-xl sm:text-2xl font-extrabold">
                {tr(
                  'Prêt à moderniser la gestion de vos copropriétés ?',
                  'مستعد لعصرنة تدبير عماراتك؟',
                )}
              </h3>
              <p className="text-sm text-slate-300">
                {tr(
                  '30 jours d’essai gratuit dès 190 MAD/mois ensuite — sans carte bancaire.',
                  '30 يوماً مجانية ابتداءً من 190 درهم/شهر بعد التجربة — بدون بطاقة بنكية.',
                )}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 shrink-0">
              <Button
                onClick={() => handlePlanChoose('professional')}
                className="px-6 py-3 font-bold justify-center"
              >
                {tr('Créer mon cabinet', 'أنشئ حساب المكتب')}
              </Button>
              <button
                type="button"
                onClick={onLoginClick}
                className="px-5 py-3 rounded-lg border border-slate-700 text-sm font-bold text-white hover:bg-slate-800 transition-colors"
              >
                {tr('Se connecter', 'تسجيل الدخول')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-950 text-slate-300 py-8 mt-auto border-t border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2.5">
            <span className="font-bold text-lg text-white">Syndik</span>
            <span className="text-xs text-slate-400">
              •{' '}
              {tr(
                'Gestion de Copropriété Maroc (Loi 18-00 & 106-12)',
                'تدبير الملكية المشتركة بالمغرب (القانون 18-00 و 106-12)',
              )}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-slate-400">
            <Link
              to="/guide"
              className="text-teal-300 hover:text-white font-semibold underline"
            >
              {tr('Guide d’utilisation (captures)', 'دليل الاستخدام بالصور')}
            </Link>
            <Link to="/privacy" className="hover:text-white underline">
              {tr('Confidentialité', 'الخصوصية')}
            </Link>
            <Link to="/terms" className="hover:text-white underline">
              {tr('CGU', 'الشروط')}
            </Link>
            <Link to="/account-deletion" className="hover:text-rose-300 underline">
              {tr('Suppression de compte', 'حذف الحساب')}
            </Link>
            <span>
              &copy; {new Date().getFullYear()} Syndik Maroc.{' '}
              {language === 'ar' ? 'جميع الحقوق محفوظة.' : 'Tous droits réservés.'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;