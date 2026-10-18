import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import type { Syndic, UserProfile, SubscriptionPlan, Prestataire } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import LanguageToggle from '../common/LanguageToggle';
import { useI18n } from '../../hooks/useI18n';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';
import { getSyndics } from '../../firebase/services';
import { BuildingsIcon } from '../icons/IconComponents';

interface LoginScreenProps {
  syndics?: Syndic[];
  onLogin?: (syndic: Syndic) => void;
  onBack?: () => void;
}

interface GeneratedAccountItem {
  id: string;
  role: 'resident' | 'provider';
  name: string;
  email: string;
  cin?: string;
  password: string;
  subtitle: string;
  buildingName: string;
}

const PLAN_DETAILS: Record<
  SubscriptionPlan,
  { nameFr: string; nameAr: string; price: string; limitFr: string; limitAr: string }
> = {
  starter: {
    nameFr: 'Forfait Essentiel',
    nameAr: 'الباقة الأساسية',
    price: '200 MAD / mois',
    limitFr: 'Jusqu’à 4 immeubles gérés',
    limitAr: 'حتى 4 عمارات مُسيّرة',
  },
  professional: {
    nameFr: 'Forfait Pro (Recommandé)',
    nameAr: 'الباقة الاحترافية (موصى بها)',
    price: '350 MAD / mois',
    limitFr: 'Jusqu’à 8 immeubles gérés',
    limitAr: 'حتى 8 عمارات مُسيّرة',
  },
  enterprise: {
    nameFr: 'Forfait Entreprise',
    nameAr: 'باقة المقاولات الكبرى',
    price: '500 MAD / mois',
    limitFr: 'Immeubles & résidences illimités',
    limitAr: 'عدد غير محدود من العمارات',
  },
};

const LoginScreen: React.FC<LoginScreenProps> = ({ onBack }) => {
  const { tr, language } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { loginWithEmail, loginWithGoogle, register } = useAuth();

  const urlMode = searchParams.get('mode');
  const urlPlan = searchParams.get('plan') as SubscriptionPlan | null;

  const [isSyndicSignup, setIsSyndicSignup] = useState<boolean>(
    urlMode === 'syndic-signup'
  );
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>(
    urlPlan && ['starter', 'professional', 'enterprise'].includes(urlPlan)
      ? urlPlan
      : 'professional'
  );

  // Sign-In Fields
  const [identifier, setIdentifier] = useState('contact@syndicpro.ma');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);

  // Syndic Onboarding Fields (only used when creating a Syndic account via pricing plan)
  const [syndicName, setSyndicName] = useState('');
  const [cabinetName, setCabinetName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('Casablanca');
  const [initialBuildingName, setInitialBuildingName] = useState('');
  const [initialApartmentsCount, setInitialApartmentsCount] = useState(8);
  const [initialBuildingFees, setInitialBuildingFees] = useState(250);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password modal
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Syndic-generated Resident & Prestataire accounts for 1-click verification
  const [generatedAccounts, setGeneratedAccounts] = useState<GeneratedAccountItem[]>([]);

  useEffect(() => {
    const modeParam = searchParams.get('mode');
    const planParam = searchParams.get('plan') as SubscriptionPlan | null;
    if (modeParam === 'syndic-signup') {
      setIsSyndicSignup(true);
      if (identifier === 'contact@syndicpro.ma') {
        setIdentifier('');
        setPassword('');
      }
    } else {
      setIsSyndicSignup(false);
    }
    if (planParam && ['starter', 'professional', 'enterprise'].includes(planParam)) {
      setSelectedPlan(planParam);
    }
  }, [searchParams]);

  useEffect(() => {
    let mounted = true;
    const loadProvisionedAccounts = async () => {
      try {
        const syndics = await getSyndics();
        const items: GeneratedAccountItem[] = [];
        const seenEmails = new Set<string>();

        // 1. Load Syndic-provisioned Resident accounts
        for (const s of syndics) {
          for (const b of s.buildings) {
            for (const r of b.residents) {
              if (r.hasAccount && r.generatedPassword) {
                const apt = b.apartments.find(
                  (a) =>
                    a.id === r.apartmentId ||
                    a.ownerId === r.id ||
                    a.tenantId === r.id
                );
                items.push({
                  id: r.id,
                  role: 'resident',
                  name: r.name,
                  email: r.email,
                  cin: r.cin,
                  password: r.generatedPassword,
                  subtitle: `${
                    r.isOwner
                      ? tr('Copropriétaire', 'مالك مشترك')
                      : tr('Locataire', 'مكتري')
                  }${apt?.number ? ` • ${tr('Lot', 'شقة')} ${apt.number}` : ''}`,
                  buildingName: b.name,
                });
                seenEmails.add(r.email.toLowerCase());
              }
            }
          }
        }

        const rawSavedRes = localStorage.getItem('syndik_resident_accounts_v1');
        if (rawSavedRes) {
          const parsed = JSON.parse(rawSavedRes) as Array<{
            residentId: string;
            name: string;
            email: string;
            password: string;
            isOwner?: boolean;
          }>;
          for (const acc of parsed) {
            if (!seenEmails.has(acc.email.toLowerCase())) {
              items.push({
                id: acc.residentId,
                role: 'resident',
                name: acc.name,
                email: acc.email,
                password: acc.password,
                subtitle: acc.isOwner
                  ? tr('Copropriétaire', 'مالك مشترك')
                  : tr('Locataire', 'مكتري'),
                buildingName: tr('Résidence Gérée', 'إقامة مُسيّرة'),
              });
              seenEmails.add(acc.email.toLowerCase());
            }
          }
        }

        // 2. Load Syndic-provisioned Prestataire accounts
        const rawProviders = localStorage.getItem('syndik_reactive_prestataires_v2');
        if (rawProviders) {
          const parsedProviders = JSON.parse(rawProviders) as Prestataire[];
          for (const p of parsedProviders) {
            if (p.hasAccount && p.generatedPassword && p.email) {
              if (!seenEmails.has(p.email.toLowerCase())) {
                items.push({
                  id: p.id,
                  role: 'provider',
                  name: p.name,
                  email: p.email,
                  password: p.generatedPassword,
                  subtitle: `${tr('Prestataire Agréé', 'مقدم خدمة معتمد')} (${p.contactPerson || p.category})`,
                  buildingName: tr('Portail Prestataire', 'بوابة مقدمي الخدمات'),
                });
                seenEmails.add(p.email.toLowerCase());
              }
            }
          }
        }

        if (mounted) {
          setGeneratedAccounts(items);
        }
      } catch {
        // ignore
      }
    };
    loadProvisionedAccounts();
    return () => {
      mounted = false;
    };
  }, [language]);

  const redirectUserToCorrectPage = (profile: UserProfile) => {
    const defaultTarget = getHomeRouteForRole(profile.role);
    const requestedFrom = (location.state as any)?.from?.pathname;

    if (
      profile.role === 'syndic' &&
      requestedFrom &&
      requestedFrom !== '/login' &&
      requestedFrom !== '/welcome' &&
      !requestedFrom.startsWith('/admin') &&
      !requestedFrom.startsWith('/resident') &&
      !requestedFrom.startsWith('/provider')
    ) {
      navigate(requestedFrom, { replace: true });
      return;
    }

    navigate(defaultTarget, { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let profile: UserProfile;
      if (isSyndicSignup) {
        profile = await register(identifier, password, syndicName, 'syndic', {
          phone,
          companyName: cabinetName || syndicName,
          city,
          subscriptionPlan: selectedPlan,
          initialBuildingName: initialBuildingName.trim() || undefined,
          initialApartmentsCount,
          initialBuildingFees,
        });
      } else {
        profile = await loginWithEmail(identifier, password);
      }
      redirectUserToCorrectPage(profile);
    } catch (err: any) {
      console.error(err);
      setError(
        err.message ||
          tr(
            'Échec de la connexion. Vérifiez vos identifiants.',
            'فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد الخاصة بك.'
          )
      );
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async (demoEmail: string, pass = 'password123') => {
    setLoading(true);
    setError('');
    setIsSyndicSignup(false);
    setIdentifier(demoEmail);
    setPassword(pass);
    try {
      const profile = await loginWithEmail(demoEmail, pass);
      redirectUserToCorrectPage(profile);
    } catch (err: any) {
      setError(err.message || tr('Connexion démo échouée', 'فشل الاتصال التجريبي'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const profile = await loginWithGoogle();
      redirectUserToCorrectPage(profile);
    } catch (err: any) {
      setError(err.message || tr('Connexion Google échouée', 'فشل تسجيل الدخول عبر Google'));
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToPublicSite = () => {
    if (onBack) onBack();
    navigate('/welcome');
  };

  const handleSwitchToSignIn = () => {
    setIsSyndicSignup(false);
    setSearchParams({});
    setError('');
    if (!identifier) {
      setIdentifier('contact@syndicpro.ma');
      setPassword('password123');
    }
  };

  const currentPlanMeta = PLAN_DETAILS[selectedPlan];

  return (
    <div
      className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="max-w-lg w-full space-y-5">
        {/* Top Bar with Language Switcher */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleReturnToPublicSite}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
          >
            {tr('← Accueil & Offres Syndic', '→ الرئيسية وباقات السنديك')}
          </button>
          <LanguageToggle variant="light" />
        </div>

        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-teal-700 text-white shadow-sm mb-2.5">
            <BuildingsIcon />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Syndik
          </h1>
          <p className="text-xs text-slate-500 mt-1 uppercase font-semibold tracking-wider">
            {tr(
              'Plateforme Marocaine de Gestion de Copropriété (Loi 18-00 & 106-12)',
              'المنصة المغربية لتدبير الملكية المشتركة (القانون 18-00 و 106-12)'
            )}
          </p>
        </div>

        {/* Role-Based 1-Click Demo Access (Only shown in Sign-In mode) */}
        {!isSyndicSignup && (
          <div className="bg-white border border-teal-100 rounded-xl p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-teal-900 uppercase tracking-wider">
                {tr(
                  'Accès Démo Immédiat par Profil & Redirection Automatique',
                  'ولوج تجريبي فوري حسب الصفة مع التوجيه التلقائي'
                )}
              </p>
              <span className="text-[10px] font-mono bg-teal-50 text-teal-700 px-2 py-0.5 rounded border border-teal-200">
                {tr('5 Rôles Métiers', '5 أدوار مهنية')}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleQuickDemoLogin('contact@syndicpro.ma')}
                className="p-2.5 bg-teal-50 hover:bg-teal-100 text-teal-900 rounded-lg text-start transition-colors border border-teal-200 flex flex-col justify-between"
              >
                <span className="font-bold flex items-center justify-between">
                  <span>🏢 {tr('Syndic Pro', 'وكيل الاتحاد')}</span>
                  <span className="text-[10px] text-teal-600 font-mono">→ /</span>
                </span>
                <span className="text-[10px] text-teal-700 mt-1 truncate">
                  Cabinet SyndicPro Maroc
                </span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleQuickDemoLogin('fatima.zahra@email.com')}
                className="p-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 rounded-lg text-start transition-colors border border-indigo-200 flex flex-col justify-between"
              >
                <span className="font-bold flex items-center justify-between">
                  <span>🔑 {tr('Copropriétaire', 'مالك مشترك')}</span>
                  <span className="text-[10px] text-indigo-600 font-mono">→ /resident</span>
                </span>
                <span className="text-[10px] text-indigo-700 mt-1 truncate">
                  Fatima Zahra • {tr('Lot', 'شقة')} A-102
                </span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleQuickDemoLogin('youssef.benali@email.com')}
                className="p-2.5 bg-sky-50 hover:bg-sky-100 text-sky-900 rounded-lg text-start transition-colors border border-sky-200 flex flex-col justify-between"
              >
                <span className="font-bold flex items-center justify-between">
                  <span>🏠 {tr('Locataire', 'مكتري')}</span>
                  <span className="text-[10px] text-sky-600 font-mono">→ /resident</span>
                </span>
                <span className="text-[10px] text-sky-700 mt-1 truncate">
                  Youssef Benali • {tr('Lot', 'شقة')} A-102
                </span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleQuickDemoLogin('provider@syndik.ma')}
                className="p-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-lg text-start transition-colors border border-amber-200 flex flex-col justify-between"
              >
                <span className="font-bold flex items-center justify-between">
                  <span>🛠️ {tr('Prestataire', 'مقدم خدمة')}</span>
                  <span className="text-[10px] text-amber-700 font-mono">→ /provider</span>
                </span>
                <span className="text-[10px] text-amber-800 mt-1 truncate">
                  {tr('Artisan / Ascenseurs', 'تقني / مصاعد')}
                </span>
              </button>

              <button
                type="button"
                disabled={loading}
                onClick={() => handleQuickDemoLogin('admin@syndik.ma')}
                className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg text-start transition-colors border border-slate-300 flex flex-col justify-between sm:col-span-2"
              >
                <span className="font-bold flex items-center justify-between">
                  <span>🛡️ {tr('Super Admin SaaS', 'المدير العام للنظام SaaS')}</span>
                  <span className="text-[10px] text-slate-600 font-mono">→ /admin</span>
                </span>
                <span className="text-[10px] text-slate-600 mt-1 truncate">
                  {tr(
                    'Supervision Nationale des Cabinets Syndics & Abonnements',
                    'الإشراف الوطني على مكاتب السنديك والاشتراكات'
                  )}
                </span>
              </button>
            </div>

            {/* Syndic-Provisioned Resident & Prestataire Accounts Quick Access */}
            {generatedAccounts.length > 0 && (
              <div className="pt-2.5 border-t border-slate-100">
                <p className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider mb-1.5">
                  🔑{' '}
                  {tr(
                    'Comptes Résidents & Prestataires Générés par le Syndic',
                    'حسابات السكان ومقدمي الخدمات المُنشأة من طرف السنديك'
                  )}{' '}
                  ({generatedAccounts.length})
                </p>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pe-1">
                  {generatedAccounts.map((acc) => (
                    <div
                      key={`${acc.role}-${acc.id}`}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate flex items-center gap-1.5">
                          <span>{acc.role === 'provider' ? '🛠️' : '🏠'}</span>
                          <span>{acc.name}</span>
                          <span className="text-[10px] font-normal text-slate-500">
                            ({acc.subtitle})
                          </span>
                        </div>
                        <div className="font-mono text-[11px] text-slate-600 truncate">
                          {acc.email} · {tr('MDP', 'كلمة المرور')}:{' '}
                          <span className="font-bold text-emerald-800">{acc.password}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleQuickDemoLogin(acc.email, acc.password)}
                        className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] shrink-0"
                      >
                        {tr('Tester →', 'تجربة ←')}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Main Auth Card */}
        <Card className="p-6 border border-slate-200">
          {isSyndicSignup ? (
            /* ============================================================
               MODE B: SYNDIC ACCOUNT CREATION AFTER SELECTING A PLAN
               ============================================================ */
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
                    {tr('Souscription Syndic B2B', 'تسجيل مكتب السنديك')}
                  </span>
                  <h2 className="text-lg font-extrabold text-slate-900 mt-1">
                    {tr('Création de votre Cabinet Syndic', 'إنشاء حساب مكتب السنديك')}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleSwitchToSignIn}
                  className="text-xs font-semibold text-teal-700 hover:text-teal-900 underline"
                >
                  {tr('Déjà inscrit ? Se connecter', 'لديك حساب؟ تسجيل الدخول')}
                </button>
              </div>

              {/* Selected Plan Banner & Selector */}
              <div className="p-3.5 rounded-xl bg-slate-900 text-white space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-teal-400 font-bold">
                      {tr('Forfait Sélectionné', 'الباقة المختارة')}
                    </p>
                    <p className="text-sm font-bold">
                      {language === 'ar' ? currentPlanMeta.nameAr : currentPlanMeta.nameFr} —{' '}
                      <span className="font-mono text-amber-300">{currentPlanMeta.price}</span>
                    </p>
                    <p className="text-[11px] text-slate-300">
                      {language === 'ar' ? currentPlanMeta.limitAr : currentPlanMeta.limitFr}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  {(['starter', 'professional', 'enterprise'] as SubscriptionPlan[]).map(
                    (planKey) => (
                      <button
                        key={planKey}
                        type="button"
                        onClick={() => setSelectedPlan(planKey)}
                        className={`py-1.5 px-2 rounded-lg text-[11px] font-bold border transition-all ${
                          selectedPlan === planKey
                            ? 'bg-teal-600 text-white border-teal-400'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        {planKey === 'starter'
                          ? 'Essentiel (200)'
                          : planKey === 'professional'
                          ? 'Pro (350)'
                          : 'Entreprise (500)'}
                      </button>
                    )
                  )}
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr('Nom du Cabinet / Syndicat *', 'اسم مكتب السنديك / اتحاد الملاك *')}
                    </label>
                    <input
                      type="text"
                      required
                      value={cabinetName}
                      onChange={(e) => setCabinetName(e.target.value)}
                      placeholder={tr('Ex: Cabinet Atlas Gestion', 'مثال: مكتب أطلس للتدبير')}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr('Nom du Syndic Gestionnaire *', 'الاسم الكامل للمسير *')}
                    </label>
                    <input
                      type="text"
                      required
                      value={syndicName}
                      onChange={(e) => setSyndicName(e.target.value)}
                      placeholder={tr('Ex: Karim Tazi', 'مثال: كريم التازي')}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr('Téléphone GSM / WhatsApp *', 'رقم الهاتف / واتساب *')}
                    </label>
                    <input
                      type="tel"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="06 61 23 45 67"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr('Ville principale *', 'المدينة *')}
                    </label>
                    <input
                      type="text"
                      required
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Casablanca, Rabat, Marrakech..."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr('Email professionnel (Identifiant) *', 'البريد الإلكتروني المهني *')}
                    </label>
                    <input
                      type="email"
                      required
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder="contact@moncabinet.ma"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr('Mot de passe *', 'كلمة المرور *')}
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-1 focus:ring-teal-500"
                    />
                  </div>
                </div>

                {/* Optional 1st Building Initialization */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                  <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                    🏢 {tr('Configuration rapide de votre 1er Immeuble (Optionnel)', 'إعداد العمارة الأولى (اختياري)')}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div className="sm:col-span-1">
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {tr('Nom de la Résidence', 'اسم الإقامة')}
                      </label>
                      <input
                        type="text"
                        value={initialBuildingName}
                        onChange={(e) => setInitialBuildingName(e.target.value)}
                        placeholder={tr('Ex: Résidence Anfa', 'مثال: إقامة أنفا')}
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {tr('Nombre de lots', 'عدد الشقق')}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={initialApartmentsCount}
                        onChange={(e) => setInitialApartmentsCount(Number(e.target.value) || 8)}
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                        {tr('Cotisation (MAD/mois)', 'واجب السنديك (درهم)')}
                      </label>
                      <input
                        type="number"
                        min={50}
                        step={50}
                        value={initialBuildingFees}
                        onChange={(e) => setInitialBuildingFees(Number(e.target.value) || 250)}
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                      />
                    </div>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full justify-center py-2.5 text-sm font-bold"
                  disabled={loading}
                >
                  {loading
                    ? tr('Création du cabinet en cours...', 'جاري إنشاء مكتب السنديك...')
                    : tr(
                        'Activer mon Cabinet Syndic & Accéder au Tableau de Bord →',
                        'تفعيل مكتب السنديك والولوج إلى لوحة القيادة ←'
                      )}
                </Button>
              </form>
            </div>
          ) : (
            /* ============================================================
               MODE A: STRICT SIGN-IN SCREEN (/login)
               ============================================================ */
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-lg font-extrabold text-slate-900">
                  {tr('Connexion à votre espace', 'تسجيل الدخول إلى فضائكم')}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {tr(
                    'Espace sécurisé pour Syndics, Copropriétaires, Locataires et Prestataires agréés.',
                    'فضاء آمن لوكلاء الاتحاد (السنديك)، الملاك المشتركين، المكترين ومقدمي الخدمات المعتمدين.'
                  )}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tr(
                      'Adresse e-mail ou N° CIN (pour les résidents) *',
                      'البريد الإلكتروني أو رقم البطاقة الوطنية CIN (للسكان) *'
                    )}
                  </label>
                  <input
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder={tr(
                      'Ex: contact@syndicpro.ma ou CIN BK124578',
                      'مثال: contact@syndicpro.ma أو رقم CIN BK124578'
                    )}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700">
                      {tr('Mot de passe *', 'كلمة المرور *')}
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotEmail(identifier.includes('@') ? identifier : '');
                        setForgotSent(false);
                        setIsForgotOpen(true);
                      }}
                      className="text-[11px] font-semibold text-teal-700 hover:text-teal-900"
                    >
                      {tr('Mot de passe oublié ?', 'نسيت كلمة المرور؟')}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      className="w-full px-3 py-2 pe-16 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 font-mono"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 end-0 px-3 text-xs font-semibold text-slate-500 hover:text-slate-800"
                    >
                      {showPassword ? tr('Masquer', 'إخفاء') : tr('Afficher', 'إظهار')}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full justify-center py-2.5 text-sm font-bold"
                  disabled={loading}
                >
                  {loading
                    ? tr('Authentification et redirection...', 'جاري التحقق والتوجيه...')
                    : tr('Se connecter', 'تسجيل الدخول')}
                </Button>
              </form>

              <div>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
                >
                  <span>🌐</span>
                  <span>
                    {tr(
                      'Continuer avec Google Workspace (Syndic)',
                      'المتابعة عبر Google Workspace (للسنديك)'
                    )}
                  </span>
                </button>
              </div>

              {/* Information Box for Residents & Service Providers */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs text-slate-600">
                <p className="font-bold text-slate-800 flex items-center gap-1.5">
                  <span>🔒</span>
                  <span>
                    {tr(
                      'Vous êtes Copropriétaire, Locataire ou Prestataire ?',
                      'هل أنتم مالك مشترك، مكتري أو مقدم خدمة؟'
                    )}
                  </span>
                </p>
                <p className="leading-relaxed">
                  {tr(
                    "Vos identifiants de connexion (Email & Mot de passe temporaire) sont générés exclusivement par votre Syndic et figurent sur votre Fiche d'Accès Officielle PDF.",
                    'يتم توليد بيانات الولوج الخاصة بكم (البريد الإلكتروني وكلمة المرور المؤقتة) حصرياً من طرف السنديك وتوجد في بطاقة الولوج الرسمية PDF.'
                  )}
                </p>
              </div>

              {/* B2B Syndic Onboarding Callout */}
              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
                <span className="text-slate-600 font-medium">
                  {tr('Vous êtes un nouveau Syndic ?', 'هل أنتم مكتب سنديك جديد؟')}
                </span>
                <button
                  type="button"
                  onClick={handleReturnToPublicSite}
                  className="font-bold text-teal-700 hover:text-teal-900 underline"
                >
                  {tr(
                    'Choisir un forfait & créer mon cabinet →',
                    'اختر باقة وأنشئ مكتب السنديك ←'
                  )}
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Password Recovery Modal */}
      <Modal
        isOpen={isForgotOpen}
        onClose={() => setIsForgotOpen(false)}
        title={tr('Réinitialisation du mot de passe', 'إعادة تعيين كلمة المرور')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsForgotOpen(false)}>
              {tr('Fermer', 'إغلاق')}
            </Button>
            {!forgotSent && (
              <Button
                onClick={() => {
                  if (!forgotEmail.trim()) return;
                  setForgotSent(true);
                }}
              >
                {tr('Envoyer les instructions', 'إرسال التعليمات')}
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3 text-xs sm:text-sm text-slate-700">
          {forgotSent ? (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-2">
              <p className="font-bold">✓ {tr('Instructions envoyées', 'تم إرسال التعليمات')}</p>
              <p className="text-xs">
                {tr(
                  `Si un compte correspond à ${forgotEmail}, un lien de réinitialisation a été envoyé.`,
                  `إذا كان هناك حساب مرتبط بـ ${forgotEmail}، فقد تم إرسال رابط إعادة التعيين.`
                )}
              </p>
              <p className="text-xs text-emerald-800 pt-1 border-t border-emerald-200">
                <strong>
                  {tr(
                    'Note Résidents & Prestataires :',
                    'ملاحظة للسكان ومقدمي الخدمات :'
                  )}
                </strong>{' '}
                {tr(
                  'Votre Syndic peut également régénérer votre mot de passe temporaire et votre Fiche PDF en 1 clic depuis son tableau de bord.',
                  'يمكن لوكيل الاتحاد (السنديك) أيضاً إعادة توليد كلمة المرور المؤقتة وبطاقة الولوج PDF بنقرة واحدة من لوحة القيادة.'
                )}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                {tr(
                  "Saisissez votre adresse e-mail ou numéro CIN. Si vous êtes résident ou prestataire d'un immeuble géré, votre Syndic peut aussi vous rééditer votre fiche d'accès PDF.",
                  'أدخل بريدك الإلكتروني أو رقم البطاقة الوطنية CIN. إذا كنت ساكناً أو مقدم خدمة، يمكن للسنديك أيضاً إعادة إصدار بطاقة الولوج PDF الخاصة بك.'
                )}
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Adresse e-mail ou N° CIN', 'البريد الإلكتروني أو رقم CIN')}
                </label>
                <input
                  type="text"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="Ex: ahmed.alami@email.com / BE458921"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default LoginScreen;