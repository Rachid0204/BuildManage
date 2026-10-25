import Form from './components/common/Form';
import AccountAction from './components/views/AccountAction';
import EmailVerificationGate from './components/views/EmailVerificationGate';
import SessionRecovery from './components/SessionRecovery';
import React, { Suspense, useEffect, useState } from 'react';

import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth, getHomeRouteForRole } from './contexts/AuthContext';

import { BuildingProvider, useBuilding } from './contexts/BuildingContext';
import { useI18n } from './hooks/useI18n';

import Loading from './components/common/Loading';
import LanguageToggle from './components/common/LanguageToggle';
import LoginScreen from './components/views/LoginScreen';
import LandingPage from './components/views/LandingPage';
import Card from './components/common/Card';
import Button from './components/common/Button';
import { getSyndics } from './firebase/services';
import type { SubscriptionPlan, Syndic, UserRole } from './types';

import RouteErrorBoundary from './components/common/RouteErrorBoundary';
import PortalSkeleton from './components/common/PortalSkeleton';
const AdminPortal = React.lazy(() => import('./components/views/AdminDashboard'));
const ResidentDashboard = React.lazy(() => import('./components/views/ResidentDashboard'));
const SyndicPortal = React.lazy(() => import('./components/portals/SyndicPortal'));
const PrestatairePortal = React.lazy(() => import('./components/portals/PrestatairePortal'));

const SyndicDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { currentUser, userProfile, logout } = useAuth();
  const { setSyndicData } = useBuilding();
  const { tr } = useI18n();
  const [unassignedAccount, setUnassignedAccount] = useState(false);
  const [readyForIdentity,setReadyForIdentity] = useState<string | null>(null);

  const { data: syndics = [], isLoading, error: dataError, refetch } = useQuery({
    queryKey: ['syndics', userProfile?.uid || 'anon'],
    queryFn: getSyndics,
    enabled: !!currentUser,
    retry: 1,
  });

  useEffect(() => {
    if (userProfile && !isLoading) setReadyForIdentity(userProfile.uid);
    if (!userProfile) {
      setSyndicData(null);
      setUnassignedAccount(false);
      return;
    }

    if (userProfile.role === 'admin') {
      setUnassignedAccount(false);
      if (syndics.length > 0) {
        setSyndicData(syndics[0]);
      }
      return;
    }

    if (syndics.length > 0) {
      const normalizedEmail = userProfile.email?.trim().toLowerCase();
      let matchedSyndic: Syndic | undefined;

      if (userProfile.syndicId) {
        matchedSyndic = syndics.find((s) => s.id === userProfile.syndicId);
      }

      if (!matchedSyndic && userProfile.role === 'syndic') {
        matchedSyndic = syndics.find(
          (s) =>
            s.createdBy === userProfile.uid ||
            (normalizedEmail && s.email?.trim().toLowerCase() === normalizedEmail)
        );
      }

      if (!matchedSyndic && userProfile.role === 'resident') {
        const cleanResId =
          userProfile.residentId || userProfile.uid.replace(/^(user-res-|res-)/, '');
        matchedSyndic = syndics.find((s) =>
          s.buildings.some(
            (b) =>
              (userProfile.buildingId && b.id === userProfile.buildingId) ||
              b.residents.some(
                (r) =>
                  r.id === userProfile.uid ||
                  r.id === cleanResId ||
                  (normalizedEmail && r.email?.trim().toLowerCase() === normalizedEmail)
              )
          )
        );
      }

      if (!matchedSyndic && userProfile.role === 'provider') {
        matchedSyndic =
          syndics.find((s) =>
            s.buildings.some((b) => userProfile.buildingId && b.id === userProfile.buildingId)
          ) || (userProfile.prestataireId || userProfile.buildingId ? syndics[0] : undefined);
      }

      if (matchedSyndic) {
        setUnassignedAccount(false);
        setSyndicData(matchedSyndic);
        return;
      }
    }

    if (!isLoading) { setSyndicData(null); setUnassignedAccount(true); }
  }, [syndics, isLoading, userProfile, setSyndicData]);

  if (dataError && syndics.length === 0) return (
    <div role="alert" className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <Card className="max-w-md space-y-4">
        <h1 className="text-lg font-bold">{tr('Données temporairement indisponibles', 'البيانات غير متاحة مؤقتاً')}</h1>
        <p>{tr('Vos accès sont conservés. Réessayez de charger votre espace.', 'تم الاحتفاظ بجلستك. أعد محاولة تحميل حسابك.')}</p>
        <p className="text-sm whitespace-pre-line">{dataError instanceof Error ? dataError.message : String(dataError)}</p>
        <Button onClick={() => refetch()}>{tr('Réessayer le chargement', 'إعادة محاولة التحميل')}</Button>
      </Card>
    </div>
  );

  if (isLoading || (!unassignedAccount && readyForIdentity !== userProfile?.uid))
    return (
      <Loading
        message={tr(
          'Chargement des données de la copropriété...',
          'جاري تحميل بيانات الملكية المشتركة...'
        )}
      />
    );

  if (unassignedAccount && userProfile && userProfile.role !== 'admin') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full border border-amber-200 bg-white text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto font-bold text-lg">
            !
          </div>
          <h2 className="text-lg font-bold text-slate-900">
            {tr('Compte en attente de rattachement', 'حساب في انتظار الربط بالإقامة')}
          </h2>
          <p className="text-xs text-slate-600 leading-relaxed">
            {tr(
              "Votre compte n'est rattaché à aucune copropriété autorisée. Veuillez demander une invitation officielle à votre Syndic gestionnaire.",
              'حسابكم غير مرتبط بأي إقامة مرخصة حالياً. يرجى طلب دعوة رسمية من وكيل الاتحاد (السنديك).'
            )}
          </p>
          <div className="flex justify-center pt-2">
            <Button variant="secondary" onClick={() => void logout()}>
              {tr('Se déconnecter', 'تسجيل الخروج')}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
};

const FirstLoginPasswordGate: React.FC = () => {
  const { userProfile, changePassword, logout } = useAuth();
  const { tr, language } = useI18n();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.trim().length < 10) {
      setError(
        tr(
          'Votre nouveau mot de passe doit contenir au moins 10 caractères.',
          'يجب أن تتكون كلمة المرور الجديدة من 10 أحرف على الأقل.'
        )
      );
      return;
    }

    if (newPassword.trim() !== confirmPassword.trim()) {
      setError(
        tr(
          'La confirmation du mot de passe ne correspond pas.',
          'تأكيد كلمة المرور غير مطابق.'
        )
      );
      return;
    }

    if (
      (newPassword.trim().startsWith('Syn-') || newPassword.trim().startsWith('INV-')) &&
      newPassword.trim().endsWith('-MA')
    ) {
      setError(
        tr(
          "Veuillez choisir un mot de passe personnel différent du code d'invitation généré par le Syndic.",
          'يرجى اختيار كلمة مرور شخصية مختلفة عن رمز الدعوة المؤقت.'
        )
      );
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(newPassword.trim());
    } catch (err: any) {
      setError(
        err?.message ||
          tr(
            'Une erreur est survenue lors de la mise à jour du mot de passe.',
            'حدث خطأ أثناء تحديث كلمة المرور.'
          )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelAndLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const roleBadge =
    userProfile?.role === 'provider'
      ? tr('Portail Prestataire Agréé', 'بوابة مقدم الخدمة المعتمد')
      : userProfile?.isOwner
      ? tr('Portail Copropriétaire', 'بوابة المالك المشترك')
      : tr('Portail Locataire', 'بوابة المكتري');

  return (
    <div
      className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-950 text-white p-6 border-b border-slate-800">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-400/30">
              {tr('Sécurité 1ère Connexion', 'حماية أول تسجيل دخول')}
            </span>
            <LanguageToggle variant="dark" />
          </div>
          <h1 className="text-xl font-extrabold tracking-tight">
            {tr('Définissez votre mot de passe personnel', 'تعيين كلمة المرور الشخصية الخاصة بكم')}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            {tr(
              `Bienvenue ${userProfile?.displayName || ''}. Votre compte (${roleBadge}) a été invité par votre Syndic.`,
              `مرحباً ${userProfile?.displayName || ''}. تم إنشاء حسابكم (${roleBadge}) بدعوة من طرف السنديك.`
            )}
          </p>
        </div>

        <Form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <p className="font-bold">
              {tr(
                'Activation sécurisée de votre espace',
                'تفعيل آمن لفضائكم الشخصي'
              )}
            </p>
            <p className="mt-0.5 text-amber-800">
              {tr(
                "Pour garantir la confidentialité de vos accès, veuillez choisir un nouveau mot de passe personnel que vous seul connaissez avant d'accéder à votre portail.",
                'لضمان سرية ولوجكم، يرجى اختيار كلمة مرور شخصية جديدة لا يعرفها سواكم قبل الدخول إلى البوابة.'
              )}
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Identifiant de connexion', 'معرف الاتصال')}
            </label>
            <input
              type="text"
              disabled
              value={userProfile?.email || ''}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-slate-100 text-slate-600 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Nouveau mot de passe personnel *', 'كلمة المرور الشخصية الجديدة *')}
            </label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={tr('Minimum 6 caractères', '10 أحرف على الأقل')}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Confirmer le nouveau mot de passe *', 'تأكيد كلمة المرور الجديدة *')}
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={tr('Retapez votre nouveau mot de passe', 'أعد إدخال كلمة المرور الجديدة')}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <Button type="submit" disabled={submitting} className="w-full justify-center py-2.5">
              {submitting
                ? tr('Sécurisation en cours...', 'جاري تأمين الحساب...')
                : tr('Enregistrer et accéder à mon portail', 'حفظ والدخول إلى البوابة')}
            </Button>
            <button
              type="button"
              onClick={handleCancelAndLogout}
              className="text-xs text-slate-500 hover:text-slate-700 font-medium py-1.5"
            >
              {tr('Se déconnecter', 'تسجيل الخروج')}
            </button>
          </div>
        </Form>
      </div>
    </div>
  );
};

const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  roles?: UserRole[];
}> = ({ children, roles }) => {
  const { currentUser, userProfile, loading, sessionError } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;

  if (!currentUser || !userProfile) {
    if (sessionError) return <SessionRecovery />;
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(userProfile.role)) {
    const correctHome = getHomeRouteForRole(userProfile.role);
    return <Navigate to={correctHome} replace />;
  }

  if (userProfile.emailVerified === false) return <EmailVerificationGate />;
  if (userProfile.mustChangePassword) {
    return <FirstLoginPasswordGate />;
  }

  return <>{children}</>;
};

const LandingRouteWrapper: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const navigate = useNavigate();
  return (
    <LandingPage
      onLoginClick={() => {
        onDone();
        navigate('/login');
      }}
      onSelectPlan={(plan: SubscriptionPlan) => {
        onDone();
        navigate(`/login?mode=syndic-signup&plan=${plan}`);
      }}
    />
  );
};

const App: React.FC = () => {
  const [showLanding, setShowLanding] = React.useState(true);
  const { currentUser, userProfile, loading, sessionError } = useAuth();

  useEffect(() => {
    if (!loading && currentUser) {
      setShowLanding(false);
    }
  }, [currentUser, loading]);

  if (loading) return <Loading />;

  return (
    <Router>
      <BuildingProvider>
        <RouteErrorBoundary>
          <Suspense fallback={<PortalSkeleton />}><Routes>
            <Route path="/account-action" element={<AccountAction />} />
            <Route
              path="/welcome"
              element={<LandingRouteWrapper onDone={() => setShowLanding(false)} />}
            />

            <Route
              path="/login"
              element={
                currentUser && userProfile && !sessionError ? (
                  <Navigate to={getHomeRouteForRole(userProfile.role)} replace />
                ) : (
                  <LoginScreen
                    onLogin={() => setShowLanding(false)}
                    onBack={() => setShowLanding(true)}
                  />
                )
              }
            />

            <Route
              path="/admin"
              element={
                <ProtectedRoute roles={['admin']}>
                  <SyndicDataProvider>
                    <AdminPortal />
                  </SyndicDataProvider>
                </ProtectedRoute>
              }
            />
            <Route path="/admin-portal" element={<Navigate to="/admin" replace />} />

            <Route
              path="/resident"
              element={
                <ProtectedRoute roles={['resident']}>
                  <SyndicDataProvider>
                    <ResidentDashboard />
                  </SyndicDataProvider>
                </ProtectedRoute>
              }
            />
            <Route path="/resident-portal" element={<Navigate to="/resident" replace />} />

            <Route
              path="/provider"
              element={
                <ProtectedRoute roles={['provider']}>
                  <SyndicDataProvider>
                    <PrestatairePortal />
                  </SyndicDataProvider>
                </ProtectedRoute>
              }
            />
            <Route path="/provider-portal" element={<Navigate to="/provider" replace />} />

            <Route
              path="/*"
              element={
                showLanding && !currentUser && !sessionError ? (
                  <LandingRouteWrapper onDone={() => setShowLanding(false)} />
                ) : (
                  <ProtectedRoute roles={['syndic']}>
                    <SyndicDataProvider>
                      <SyndicPortal />
                    </SyndicDataProvider>
                  </ProtectedRoute>
                )
              }
            />
          </Routes></Suspense>
        </RouteErrorBoundary>
      </BuildingProvider>
    </Router>
  );
};

export default App;
