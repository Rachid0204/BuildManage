import React from 'react';
import Button from '../common/Button';
import LanguageToggle from '../common/LanguageToggle';
import { useI18n } from '../../hooks/useI18n';
import { BuildingsIcon, FinancialsIcon, SparklesIcon } from '../icons/IconComponents';
import type { SubscriptionPlan } from '../../types';

interface LandingPageProps {
  onLoginClick: () => void;
  onSelectPlan?: (plan: SubscriptionPlan) => void;
}

const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick, onSelectPlan }) => {
  const { t, tr, language } = useI18n();

  const handlePlanChoose = (plan: SubscriptionPlan) => {
    if (onSelectPlan) {
      onSelectPlan(plan);
    } else {
      onLoginClick();
    }
  };

  const scrollToPricing = () => {
    const el = document.getElementById('pricing-plans');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    } else {
      handlePlanChoose('professional');
    }
  };

  return (
    <div
      className="min-h-screen bg-slate-50 flex flex-col font-sans"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Navbar */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center">
              <div className="flex-shrink-0 flex items-center gap-2.5">
                <div className="w-9 h-9 bg-teal-700 rounded-lg flex items-center justify-center text-white shadow-xs">
                  <BuildingsIcon />
                </div>
                <div>
                  <span className="font-extrabold text-xl text-slate-900 tracking-tight">
                    Syndik
                  </span>
                  <span className="hidden sm:inline-block ms-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
                    Loi 18-00 & 106-12
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={scrollToPricing}
                className="hidden md:inline-flex text-xs font-bold text-slate-600 hover:text-teal-700 px-3 py-2 transition-colors"
              >
                {tr('Tarifs & Inscription Syndic', 'الأسعار وتسجيل السنديك')}
              </button>
              <LanguageToggle variant="light" />
              <Button onClick={onLoginClick}>
                {tr('Se connecter', 'تسجيل الدخول')}
              </Button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative bg-white overflow-hidden border-b border-slate-200">
        <div className="max-w-7xl mx-auto">
          <div className="relative z-10 pb-8 bg-white sm:pb-16 md:pb-20 lg:max-w-2xl lg:w-full lg:pb-28 xl:pb-32">
            <svg
              className="hidden lg:block absolute right-0 inset-y-0 h-full w-48 text-white transform translate-x-1/2"
              fill="currentColor"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="50,0 100,0 50,100 0,100" />
            </svg>

            <main className="mt-10 mx-auto max-w-7xl px-4 sm:mt-12 sm:px-6 md:mt-16 lg:mt-20 lg:px-8 xl:mt-24">
              <div className="sm:text-center lg:text-start">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-teal-50 border border-teal-200 text-teal-800 text-xs font-bold uppercase tracking-wider mb-4">
                  🏢 {tr('Plateforme B2B2C pour Syndics Professionnels & Bénévoles', 'منصة احترافية لوكلاء الاتحاد (السنديك) المهنيين والمتطوعين')}
                </span>
                <h1 className="text-4xl tracking-tight font-extrabold text-slate-900 sm:text-5xl md:text-6xl">
                  <span className="block xl:inline">{t('landing.hero.title')}</span>{' '}
                  <span className="block text-teal-700">{t('landing.hero.highlight')}</span>
                </h1>
                <p className="mt-3 text-base text-slate-600 sm:mt-5 sm:text-lg sm:max-w-xl sm:mx-auto md:mt-5 md:text-xl lg:mx-0">
                  {t('landing.hero.subtitle')}
                </p>
                <div className="mt-6 sm:mt-8 sm:flex sm:justify-center lg:justify-start gap-3">
                  <Button
                    onClick={scrollToPricing}
                    className="w-full sm:w-auto px-7 py-3.5 text-base font-bold"
                  >
                    {tr('Choisir un forfait & Créer mon cabinet Syndic', 'اختر باقة وأنشئ مكتب السنديك')}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={onLoginClick}
                    className="mt-3 sm:mt-0 w-full sm:w-auto px-6 py-3.5 text-base font-semibold"
                  >
                    {tr('Accéder à mon espace (Connexion)', 'الولوج إلى فضائي (تسجيل الدخول)')}
                  </Button>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  🔒{' '}
                  {tr(
                    'Accès sécurisé : Les comptes Copropriétaires, Locataires et Prestataires sont créés et délivrés exclusivement par leur Syndic.',
                    'ولوج آمن : يتم إنشاء وتسليم حسابات الملاك المشتركين والمكترين ومقدمي الخدمات حصرياً من طرف السنديك.'
                  )}
                </p>
              </div>
            </main>
          </div>
        </div>
        <div className="lg:absolute lg:inset-y-0 lg:right-0 lg:w-1/2 bg-slate-100 flex items-center justify-center">
          <img
            className="h-56 w-full object-cover sm:h-72 md:h-96 lg:w-full lg:h-full"
            src="https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?ixlib=rb-4.0.3&auto=format&fit=crop&w=1470&q=80"
            alt="Immeuble résidentiel moderne au Maroc"
          />
        </div>
      </div>

      {/* How the Syndic-Centric Governance Works */}
      <div className="py-12 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-widest text-teal-400">
              {tr('Architecture de Confiance Loi 18-00', 'هندسة الثقة والأمان — قانون 18-00')}
            </span>
            <h2 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight">
              {tr(
                'Un flux d’accès maîtrisé à 100% par le Syndic',
                'نظام ولوج مُحكم ومُدار بالكامل من طرف السنديك'
              )}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {tr(
                'Aucune inscription sauvage : le Syndic administre ses immeubles et délivre les identifiants officiels aux résidents et prestataires.',
                'لا وجود لتسجيلات عشوائية : السنديك يدير الإقامات ويسلم بيانات الولوج الرسمية للسكان ومقدمي الخدمات.'
              )}
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 rounded-xl bg-slate-800/90 border border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30">
                  {tr('ÉTAPE 01 • SYNDIC', 'المرحلة 01 • السنديك')}
                </span>
                <span className="text-lg">🏢</span>
              </div>
              <h3 className="text-base font-bold text-white pt-1">
                {tr('Souscription au Forfait & Création du Cabinet', 'اختيار الباقة وإنشاء مكتب السنديك')}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {tr(
                  'Le Syndic choisit son offre ci-dessous (Essentiel, Pro ou Entreprise), crée son compte gestionnaire et configure ses résidences et lots.',
                  'يختار السنديك الباقة المناسبة أدناه، ينشئ حساب المكتب ويقوم بإعداد العمارات والشقق (الأجزاء المفرزة).'
                )}
              </p>
            </div>

            <div className="p-5 rounded-xl bg-slate-800/90 border border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {tr('ÉTAPE 02 • RÉSIDENTS', 'المرحلة 02 • السكان')}
                </span>
                <span className="text-lg">🔑</span>
              </div>
              <h3 className="text-base font-bold text-white pt-1">
                {tr('Génération des Comptes Résidents & Fiche PDF', 'إنشاء حسابات السكان وبطاقة الولوج PDF')}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {tr(
                  "Depuis le menu Résidents, le Syndic rattache chaque copropriétaire ou locataire à son lot et télécharge sa Fiche d'Accès PDF officielle.",
                  'من قسم السكان، يربط السنديك كل مالك أو مكتري بشقته ويُحمّل بطاقة الولوج الرسمية بصيغة PDF لتسليمها له.'
                )}
              </p>
            </div>

            <div className="p-5 rounded-xl bg-slate-800/90 border border-slate-700 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {tr('ÉTAPE 03 • PRESTATAIRES', 'المرحلة 03 • مقدمو الخدمات')}
                </span>
                <span className="text-lg">🛠️</span>
              </div>
              <h3 className="text-base font-bold text-white pt-1">
                {tr('Accréditation des Prestataires Sous Contrat', 'اعتماد مقدمي الخدمات المتعاقدين')}
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                {tr(
                  "Depuis le module Prestataires, le Syndic inscrit ses entreprises agréées (ICE/RC) et génère leurs identifiants d'accès au Portail Prestataire.",
                  'من قسم مقدمي الخدمات، يُسجل السنديك الشركات المعتمدة ويُولّد بيانات ولوجها إلى بوابة المزودين.'
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-12 bg-slate-50 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="lg:text-center">
            <h2 className="text-xs text-teal-700 font-bold tracking-wider uppercase">
              {t('landing.features.subtitle')}
            </h2>
            <p className="mt-2 text-3xl leading-8 font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              {t('landing.features.title')}
            </p>
          </div>

          <div className="mt-10">
            <dl className="space-y-10 md:space-y-0 md:grid md:grid-cols-3 md:gap-x-8 md:gap-y-10">
              <div className="relative bg-white p-6 rounded-xl border border-slate-200 shadow-2xs">
                <dt>
                  <div className="flex items-center justify-center h-11 w-11 rounded-lg bg-teal-700 text-white mb-4">
                    <BuildingsIcon />
                  </div>
                  <p className="text-lg leading-6 font-bold text-slate-900">
                    {t('landing.features.management.title')}
                  </p>
                </dt>
                <dd className="mt-2 text-sm text-slate-600 leading-relaxed">
                  {t('landing.features.management.desc')}
                </dd>
              </div>

              <div className="relative bg-white p-6 rounded-xl border border-slate-200 shadow-2xs">
                <dt>
                  <div className="flex items-center justify-center h-11 w-11 rounded-lg bg-teal-700 text-white mb-4">
                    <FinancialsIcon />
                  </div>
                  <p className="text-lg leading-6 font-bold text-slate-900">
                    {t('landing.features.financials.title')}
                  </p>
                </dt>
                <dd className="mt-2 text-sm text-slate-600 leading-relaxed">
                  {t('landing.features.financials.desc')}
                </dd>
              </div>

              <div className="relative bg-white p-6 rounded-xl border border-slate-200 shadow-2xs">
                <dt>
                  <div className="flex items-center justify-center h-11 w-11 rounded-lg bg-teal-700 text-white mb-4">
                    <SparklesIcon />
                  </div>
                  <p className="text-lg leading-6 font-bold text-slate-900">
                    {t('landing.features.ai.title')}
                  </p>
                </dt>
                <dd className="mt-2 text-sm text-slate-600 leading-relaxed">
                  {t('landing.features.ai.desc')}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* Pricing Section (Syndic Onboarding Entry Point) */}
      <div id="pricing-plans" className="bg-white py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <span className="inline-flex px-3 py-1 rounded-md bg-teal-50 text-teal-800 border border-teal-200 text-xs font-bold uppercase tracking-wider mb-2">
              {tr('Inscription Cabinet Syndic', 'تسجيل مكتب السنديك')}
            </span>
            <h2 className="text-3xl font-extrabold text-slate-900 sm:text-4xl">
              {t('landing.pricing.title')}
            </h2>
            <p className="mt-3 text-base sm:text-lg text-slate-600">
              {tr(
                'Sélectionnez votre forfait pour créer votre compte Syndic et commencer à générer les accès pour vos copropriétaires et prestataires.',
                'اختر الباقة المناسبة لإنشاء حساب السنديك الخاص بك والبدء في توليد حسابات الولوج للملاك المشتركين ومقدمي الخدمات.'
              )}
            </p>
          </div>

          <div className="mt-12 space-y-4 sm:mt-14 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-6 lg:max-w-5xl lg:mx-auto">
            {/* Tier 1: Essentiel (starter) */}
            <div className="border border-slate-200 rounded-2xl shadow-xs divide-y divide-slate-200 flex flex-col bg-white hover:border-teal-400 transition-all">
              <div className="p-6 flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg leading-6 font-bold text-slate-900">
                    {t('landing.pricing.tier1.name')}
                  </h3>
                  <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                    ≤ 4 {tr('immeubles', 'عمارات')}
                  </span>
                </div>
                <p className="mt-3 text-xs sm:text-sm text-slate-500">
                  {t('landing.pricing.tier1.desc')}
                </p>
                <p className="mt-6 flex items-baseline gap-1 font-mono">
                  <span className="text-4xl font-extrabold text-slate-900">200</span>
                  <span className="text-sm font-semibold text-slate-500">
                    MAD / {t('landing.pricing.month')}
                  </span>
                </p>
                <ul className="mt-6 space-y-3 text-sm text-slate-700">
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{t('landing.pricing.limit', { count: '4' })}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{tr('Création illimitée de comptes Résidents & Prestataires', 'إنشاء غير محدود لحسابات السكان ومقدمي الخدمات')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{tr("Fiches d'accès PDF officielles & Quittances Loi 18-00", 'بطاقات ولوج PDF رسمية ووصولات الأداء')}</span>
                  </li>
                </ul>
              </div>
              <div className="p-6 bg-slate-50/60 rounded-b-2xl">
                <Button
                  onClick={() => handlePlanChoose('starter')}
                  variant="secondary"
                  className="w-full py-3 justify-center font-bold"
                >
                  {tr('Choisir Essentiel & Créer mon compte →', 'اختر الباقة الأساسية وأنشئ حسابي ←')}
                </Button>
              </div>
            </div>

            {/* Tier 2: Pro (professional) */}
            <div className="border-2 border-teal-600 rounded-2xl shadow-md divide-y divide-slate-200 flex flex-col relative bg-white">
              <div className="absolute top-0 -translate-y-1/2 left-1/2 -translate-x-1/2">
                <span className="inline-flex rounded-md bg-teal-700 px-3.5 py-1 text-xs font-bold tracking-wider uppercase text-white shadow-xs">
                  {t('landing.pricing.popular')}
                </span>
              </div>
              <div className="p-6 flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg leading-6 font-bold text-teal-900">
                    {t('landing.pricing.tier2.name')}
                  </h3>
                  <span className="text-xs font-mono font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                    ≤ 8 {tr('immeubles', 'عمارات')}
                  </span>
                </div>
                <p className="mt-3 text-xs sm:text-sm text-slate-500">
                  {t('landing.pricing.tier2.desc')}
                </p>
                <p className="mt-6 flex items-baseline gap-1 font-mono">
                  <span className="text-4xl font-extrabold text-slate-900">350</span>
                  <span className="text-sm font-semibold text-slate-500">
                    MAD / {t('landing.pricing.month')}
                  </span>
                </p>
                <ul className="mt-6 space-y-3 text-sm text-slate-700">
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{t('landing.pricing.limit', { count: '8' })}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{t('landing.features.financials.title')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{tr('Assemblées Générales (AGO/AGE) & Vote en ligne', 'الجموع العامة والتصويت الرقمي')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{tr('Portail Résident & Portail Prestataire inclus', 'بوابة السكان وبوابة مقدمي الخدمات مدمجتان')}</span>
                  </li>
                </ul>
              </div>
              <div className="p-6 bg-teal-50/40 rounded-b-2xl">
                <Button
                  onClick={() => handlePlanChoose('professional')}
                  className="w-full py-3 justify-center font-bold"
                >
                  {tr('Choisir Pro & Créer mon compte →', 'اختر الباقة الاحترافية وأنشئ حسابي ←')}
                </Button>
              </div>
            </div>

            {/* Tier 3: Entreprise (enterprise) */}
            <div className="border border-slate-200 rounded-2xl shadow-xs divide-y divide-slate-200 flex flex-col bg-white hover:border-teal-400 transition-all">
              <div className="p-6 flex-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg leading-6 font-bold text-slate-900">
                    {t('landing.pricing.tier3.name')}
                  </h3>
                  <span className="text-xs font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                    {tr('Illimité', 'غير محدود')}
                  </span>
                </div>
                <p className="mt-3 text-xs sm:text-sm text-slate-500">
                  {t('landing.pricing.tier3.desc')}
                </p>
                <p className="mt-6 flex items-baseline gap-1 font-mono">
                  <span className="text-4xl font-extrabold text-slate-900">500</span>
                  <span className="text-sm font-semibold text-slate-500">
                    MAD / {t('landing.pricing.month')}
                  </span>
                </p>
                <ul className="mt-6 space-y-3 text-sm text-slate-700">
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{t('landing.pricing.unlimited')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{t('landing.pricing.allFeatures')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="text-emerald-600 font-bold">✓</span>
                    <span>{tr('Multi-gestionnaires & Support prioritaire 24/7', 'تعدد المسيرين ودعم فني ذو أولوية')}</span>
                  </li>
                </ul>
              </div>
              <div className="p-6 bg-slate-50/60 rounded-b-2xl">
                <Button
                  onClick={() => handlePlanChoose('enterprise')}
                  variant="secondary"
                  className="w-full py-3 justify-center font-bold"
                >
                  {tr('Choisir Entreprise & Créer mon compte →', 'اختر باقة المقاولات وأنشئ حسابي ←')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-slate-900 text-white py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg">Syndik</span>
            <span className="text-xs text-slate-400">
              • {tr('Gestion de Copropriété Maroc', 'تدبير الملكية المشتركة بالمغرب')}
            </span>
          </div>
          <p className="text-sm text-slate-400">
            &copy; {new Date().getFullYear()} Syndik Maroc.{' '}
            {language === 'ar' ? 'جميع الحقوق محفوظة.' : 'Tous droits réservés.'}
          </p>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;