import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Syndic, UserRole, UserProfile } from '../../types';
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
  residentId: string;
  name: string;
  email: string;
  cin?: string;
  password: string;
  isOwner: boolean;
  buildingName: string;
  apartmentNumber?: string;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onBack }) => {
  const { tr, language } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { loginWithEmail, loginWithGoogle, register } = useAuth();

  const [isRegistering, setIsRegistering] = useState(false);
  const [identifier, setIdentifier] = useState('contact@syndicpro.ma');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [cin, setCin] = useState('');
  const [role, setRole] = useState<UserRole>('syndic');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password modal
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Generated resident accounts for 1-click verification
  const [generatedAccounts, setGeneratedAccounts] = useState<GeneratedAccountItem[]>([]);

  useEffect(() => {
    let mounted = true;
    const loadGeneratedAccounts = async () => {
      try {
        const syndics = await getSyndics();
        const items: GeneratedAccountItem[] = [];
        const seenEmails = new Set<string>();

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
                  residentId: r.id,
                  name: r.name,
                  email: r.email,
                  cin: r.cin,
                  password: r.generatedPassword,
                  isOwner: r.isOwner,
                  buildingName: b.name,
                  apartmentNumber: apt?.number,
                });
                seenEmails.add(r.email.toLowerCase());
              }
            }
          }
        }

        const rawSaved = localStorage.getItem('syndik_resident_accounts_v1');
        if (rawSaved) {
          const parsed = JSON.parse(rawSaved) as Array<{
            residentId: string;
            name: string;
            email: string;
            password: string;
            isOwner?: boolean;
            buildingId: string;
            apartmentId?: string;
          }>;
          for (const acc of parsed) {
            if (!seenEmails.has(acc.email.toLowerCase())) {
              items.push({
                residentId: acc.residentId,
                name: acc.name,
                email: acc.email,
                password: acc.password,
                isOwner: acc.isOwner ?? true,
                buildingName: tr('Résidence Gérée', 'إقامة مُسيّرة'),
              });
              seenEmails.add(acc.email.toLowerCase());
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
    loadGeneratedAccounts();
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
      if (isRegistering) {
        profile = await register(identifier, password, name, role, {
          phone,
          cin,
          companyName,
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
            {tr('← Accueil', '→ الرئيسية')}
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

        {/* Role-Based 1-Click Demo Access */}
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
                <span>🏢 {tr('Syndic Pro', 'وكيل الاتحاد (السنديك)')}</span>
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

          {/* Generated Resident Credentials Quick Access */}
          {generatedAccounts.length > 0 && (
            <div className="pt-2.5 border-t border-slate-100">
              <p className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider mb-1.5">
                🔑 {tr('Comptes Résidents Générés par le Syndic', 'حسابات السكان المُنشأة من طرف السنديك')} ({generatedAccounts.length})
              </p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {generatedAccounts.map((acc) => (
                  <div
                    key={acc.residentId}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">
                        {acc.name}{' '}
                        <span className="text-[10px] font-normal text-slate-500">
                          ({acc.isOwner ? tr('Copropriétaire', 'مالك مشترك') : tr('Locataire', 'مكتري')}
                          {acc.apartmentNumber ? ` • ${tr('Lot', 'شقة')} ${acc.apartmentNumber}` : ''})
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
                      {tr('Connecter →', 'دخول ←')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main Auth Card */}
        <Card className="p-6 border border-slate-200">
          <div className="flex rounded-xl bg-slate-100 p-1 mb-5">
            <button
              type="button"
              onClick={() => {
                setIsRegistering(false);
                setError('');
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                !isRegistering
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tr('Connexion à mon espace', 'تسجيل الدخول إلى فضائي')}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegistering(true);
                setError('');
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                isRegistering
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tr('Créer un compte Syndik', 'إنشاء حساب Syndik')}
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegistering && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tr('Profil utilisateur *', 'صفة المستخدم *')}
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-medium text-slate-900"
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                  >
                    <option value="syndic">
                      🏢 {tr('Syndic de Copropriété (Professionnel ou Bénévole)', 'وكيل الاتحاد / السنديك (مهني أو متطوع)')}
                    </option>
                    <option value="resident">
                      🏠 {tr("Copropriétaire / Résident d'immeuble", 'مالك مشترك / ساكن بالإقامة')}
                    </option>
                    <option value="provider">
                      🛠️ {tr('Prestataire Technique Agréé', 'مقدم خدمات تقنية معتمد')}
                    </option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr('Nom complet *', 'الاسم الكامل *')}
                    </label>
                    <input
                      type="text"
                      required
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={tr('Ex: Karim Tazi', 'مثال: كريم التازي')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr('Téléphone GSM (Maroc)', 'رقم الهاتف النقال')}
                    </label>
                    <input
                      type="tel"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="06 61 23 45 67"
                    />
                  </div>
                </div>

                {role === 'syndic' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr('Nom du Cabinet ou Syndicat des Copropriétaires', 'اسم مكتب السنديك أو اتحاد الملاك')}
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder={tr('Ex: Cabinet Atlas Gestion Immobilier', 'مثال: مكتب أطلس لتدبير العقارات')}
                    />
                  </div>
                )}

                {role === 'resident' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      {tr("Numéro CIN (Carte Nationale d'Identité)", 'رقم البطاقة الوطنية للتعريف (CIN)')}
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm uppercase font-mono focus:ring-1 focus:ring-teal-500"
                      value={cin}
                      onChange={(e) => setCin(e.target.value.toUpperCase())}
                      placeholder="Ex: BK124578"
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isRegistering
                  ? tr('Adresse e-mail professionnelle ou personnelle *', 'البريد الإلكتروني المهني أو الشخصي *')
                  : tr('Adresse e-mail ou N° CIN (pour les résidents) *', 'البريد الإلكتروني أو رقم البطاقة الوطنية CIN (للسكان) *')}
              </label>
              <input
                type={isRegistering ? 'email' : 'text'}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  isRegistering
                    ? 'votre.email@domaine.ma'
                    : tr('Ex: contact@syndicpro.ma ou CIN BK124578', 'مثال: contact@syndicpro.ma أو رقم CIN BK124578')
                }
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  {tr('Mot de passe *', 'كلمة المرور *')}
                </label>
                {!isRegistering && (
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
                )}
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
                : isRegistering
                ? tr('Créer mon compte et accéder à mon espace', 'إنشاء حسابي والولوج إلى فضائي')
                : tr('Se connecter', 'تسجيل الدخول')}
            </Button>
          </form>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
            >
              <span>🌐</span>
              <span>{tr('Continuer avec Google Workspace (Syndic)', 'المتابعة عبر Google Workspace (للسنديك)')}</span>
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={handleReturnToPublicSite}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              {tr("← Retour à la page d'accueil publique", '→ العودة إلى الصفحة الرئيسية')}
            </button>
          </div>
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
                <strong>{tr('Note Copropriétaires / Locataires :', 'ملاحظة للملاك المشتركين / المكترين :')}</strong>{' '}
                {tr(
                  'Votre Syndic peut également régénérer votre mot de passe temporaire en 1 clic depuis son module Résidents → Générer Accès.',
                  'يمكن لوكيل الاتحاد (السنديك) أيضاً إعادة توليد كلمة المرور المؤقتة الخاصة بكم بنقرة واحدة من قسم السكان ← توليد بيانات الولوج.'
                )}
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                {tr(
                  "Saisissez votre adresse e-mail ou numéro CIN. Si vous êtes résident d'un immeuble géré, votre Syndic peut aussi vous transmettre votre fiche d'accès sur WhatsApp.",
                  'أدخل بريدك الإلكتروني أو رقم البطاقة الوطنية CIN. إذا كنت ساكناً في إقامة مُسيّرة، يمكن للسنديك أيضاً إرسال بطاقة الولوج الخاصة بك عبر واتساب.'
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