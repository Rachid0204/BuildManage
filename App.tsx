import Form from './components/common/Form';
import AccountAction from './components/views/AccountAction';
import EmailVerificationGate from './components/views/EmailVerificationGate';
import React, { Suspense, useEffect, useState } from 'react';
import { AlertTriangle, Clock, AlertCircle, Info } from 'lucide-react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, getHomeRouteForRole } from './contexts/AuthContext';
import { BuildingProvider, useBuilding } from './contexts/BuildingContext';
import { useI18n } from './hooks/useI18n';
import DashboardLayout from './components/layout/DashboardLayout';
import Loading from './components/common/Loading';
import LanguageToggle from './components/common/LanguageToggle';
import LoginScreen from './components/views/LoginScreen';
import LandingPage from './components/views/LandingPage';
import AdminDashboard from './components/views/AdminDashboard';
import ResidentDashboard from './components/views/ResidentDashboard';
import Card from './components/common/Card';
import Button from './components/common/Button';
import {
  getSyndics,
  saveSyndic,
  addBuilding,
  updateBuilding,
  deleteBuilding,
  addResident,
  updateResident,
  deleteResident,
  regenerateResidentCredentials,
  addApartment,
  addApartmentsBulk,
  rebalanceBuildingTantiemes,
  updateApartment,
  deleteApartment,
  generateMonthlyCharges,
  addAnnouncement,
  getMaintenanceRequestsForBuilding,
  updateMaintenanceRequest,
} from './firebase/services';
import type {
  Building,
  Resident,
  Apartment,
  SubscriptionPlan,
  Syndic,
  UserRole,
  View,
} from './types';

// Lazy load views for performance
const Dashboard = React.lazy(() => import('./components/views/Dashboard'));
const Buildings = React.lazy(() => import('./components/views/Buildings'));
const Residents = React.lazy(() => import('./components/views/Residents'));
const Apartments = React.lazy(() => import('./components/views/Apartments'));
const Announcements = React.lazy(() =>
  import('./components/views/Announcements')
);
const Documents = React.lazy(() => import('./components/views/Documents'));
const Financials = React.lazy(() => import('./components/views/Financials'));
const Maintenance = React.lazy(() => import('./components/views/Maintenance'));
const AssembleeGenerale = React.lazy(() => import('./components/views/AssembleeGenerale'));
const Prestataires = React.lazy(() => import('./components/views/Prestataires'));
const CommunityChat = React.lazy(() => import('./components/views/CommunityChat'));
const MarketplaceView = React.lazy(() => import('./components/views/MarketplaceView'));
const Analytics = React.lazy(() => import('./components/views/Analytics'));
const Settings = React.lazy(() => import('./components/views/Settings'));

interface RouteErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RouteErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Erreur inattendue lors du chargement de la vue.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <Card className="max-w-md w-full border border-rose-200 bg-rose-50/40 text-center space-y-4">
            <h2 className="text-lg font-bold text-slate-900">
              Une erreur est survenue lors du chargement du module
            </h2>
            <p className="text-xs text-slate-600 font-mono">
              {this.state.errorMessage}
            </p>
            <div className="flex justify-center gap-2">
              <Button
                onClick={() => {
                  this.setState({ hasError: false, errorMessage: null });
                  window.location.reload();
                }}
              >
                Actualiser la page
              </Button>
            </div>
          </Card>
        </div>
      );
    }
    return this.props.children;
  }
}

// Dedicated Provider Portal for Prestataire Agréé role
const ProviderPortal: React.FC = () => {
  const { userProfile, logout } = useAuth();
  const { selectedBuilding } = useBuilding();
  const { t, tr, language } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const buildingId = userProfile?.buildingId || selectedBuilding?.id || '';

  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [techNote, setTechNote] = useState('');
  const [nextStatus, setNextStatus] = useState<'in_progress' | 'completed'>('in_progress');

  const { data: rawRequests = [] } = useQuery({
    queryKey: ['maintenance', buildingId, userProfile?.uid],
    queryFn: () =>
      buildingId ? getMaintenanceRequestsForBuilding(buildingId) : Promise.resolve([]),
    enabled: Boolean(buildingId),
  });

  const requests = React.useMemo(() => {
    if (!userProfile) return [];
    const effectivePrestId =
      userProfile.prestataireId || userProfile.uid.replace(/^(user-prest-|prov-)/, '');
    const effectiveCategory =
      userProfile.prestataireCategory || userProfile.providerCategory;
    return rawRequests.filter(
      (r) =>
        (effectivePrestId && r.prestataireId === effectivePrestId) ||
        (userProfile.displayName && r.assignedTo === userProfile.displayName) ||
        (!r.prestataireId &&
          !r.assignedTo &&
          effectiveCategory &&
          r.category === effectiveCategory)
    );
  }, [rawRequests, userProfile]);

  const categoryLabels: Record<string, string> = {
    plumbing: tr('Plomberie', 'السباكة'),
    electrical: tr('Électricité', 'الكهرباء'),
    elevator: tr('Ascenseur', 'المصعد'),
    common_area: tr('Parties Communes', 'الأجزاء المشتركة'),
    cleaning: tr('Nettoyage', 'النظافة'),
    security: tr('Sécurité', 'الحراسة والأمن'),
    other: tr('Autre', 'أخرى'),
  };

  const renderPriorityBadge = (priority?: string) => {
    switch (priority) {
      case 'emergency':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{tr('Urgence', 'طوارئ')}</span>
          </span>
        );
      case 'high':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>{tr('Haute', 'عالية')}</span>
          </span>
        );
      case 'low':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>{tr('Basse', 'منخفضة')}</span>
          </span>
        );
      case 'medium':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{tr('Moyenne', 'متوسطة')}</span>
          </span>
        );
    }
  };

  const updateMutation = useMutation({
    mutationFn: (payload: { requestId: string; status: 'in_progress' | 'completed'; note: string }) =>
      updateMaintenanceRequest(
        payload.requestId,
        { status: payload.status },
        {
          title:
            payload.status === 'completed'
              ? tr('Intervention clôturée par le prestataire', 'تم إغلاق التدخل من طرف المزود')
              : tr('Compte-rendu technique du prestataire', 'تقرير تقني من المزود'),
          note: payload.note,
          updatedBy: userProfile?.displayName || tr('Prestataire Agréé', 'مقدم خدمة معتمد'),
          updatedByRole: 'provider',
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', buildingId] });
      setActiveTicketId(null);
      setTechNote('');
    },
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (userProfile && userProfile.role !== 'provider') {
    return <Navigate to={getHomeRouteForRole(userProfile.role)} replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="bg-slate-900 text-white px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <span className="text-[11px] uppercase tracking-wider font-bold px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/30">
            {t('providerPortal.badge')}
          </span>
          <h1 className="text-xl font-bold mt-1">
            {userProfile?.displayName || tr('Artisan Partenaire', 'حرفي شريك')}
          </h1>
          <p className="text-xs text-slate-400">
            {t('providerPortal.subtitle')} •{' '}
            {selectedBuilding?.name || userProfile?.buildingName || tr('Copropriété assignée', 'الإقامة المعينة')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-300 font-mono hidden sm:inline">
            {userProfile?.email}
          </span>
          <LanguageToggle variant="dark" />
          <Button variant="secondary" onClick={handleLogout}>
            {t('header.logout')}
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <p className="text-xs font-semibold uppercase text-slate-400">{t('providerPortal.activeOrders')}</p>
            <p className="text-3xl font-extrabold text-slate-900 mt-1">
              {requests.filter((r) => r.status !== 'completed').length}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase text-slate-400">{t('providerPortal.completedOrders')}</p>
            <p className="text-3xl font-extrabold text-emerald-600 mt-1">
              {requests.filter((r) => r.status === 'completed').length}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase text-slate-400">{t('providerPortal.avgSla')}</p>
            <p className="text-3xl font-extrabold text-indigo-600 mt-1">4h 15m</p>
          </Card>
        </div>

        <Card>
          <h2 className="text-lg font-bold text-slate-900 mb-4">
            {t('providerPortal.ordersTitle')}
          </h2>
          <div className="space-y-4">
            {requests.map((req) => (
              <div
                key={req.id}
                className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col md:flex-row justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold uppercase px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {categoryLabels[req.category] || req.category}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        req.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : req.status === 'in_progress'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {req.status === 'completed'
                        ? t('providerPortal.statusCompleted')
                        : req.status === 'in_progress'
                        ? t('providerPortal.statusInProgress')
                        : t('providerPortal.statusPending')}
                    </span>
                    {renderPriorityBadge(req.priority)}
                    {req.location && (
                      <span className="text-xs text-slate-500">📍 {req.location}</span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-slate-900">{req.description}</p>
                  {req.syndicNotes && (
                    <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <strong>{t('providerPortal.syndicNote')}</strong> {req.syndicNotes}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 self-start md:self-center shrink-0">
                  {req.status !== 'completed' && (
                    <Button
                      onClick={() => {
                        setActiveTicketId(req.id);
                        setNextStatus(req.status === 'pending' ? 'in_progress' : 'completed');
                      }}
                    >
                      {t('providerPortal.updateBtn')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {activeTicketId && (
          <Card className="border-2 border-teal-500">
            <h3 className="text-base font-bold text-slate-900 mb-3">
              {t('providerPortal.reportTitle')} (#{activeTicketId})
            </h3>
            <Form className="space-y-3" onSubmit={async () => {
              if (!techNote.trim()) throw new Error(tr('Rédigez le compte-rendu avant de l’envoyer.', 'اكتب التقرير قبل إرساله.'));
              await updateMutation.mutateAsync({ requestId: activeTicketId, status: nextStatus, note: techNote.trim() });
            }}>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('providerPortal.newStateLabel')}
                </label>
                <select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as 'in_progress' | 'completed')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  <option value="in_progress">{t('providerPortal.stateInProgress')}</option>
                  <option value="completed">{t('providerPortal.stateCompleted')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('providerPortal.techNoteLabel')}
                </label>
                <textarea
                  rows={3}
                  required
                  maxLength={3000}
                  value={techNote}
                  onChange={(e) => setTechNote(e.target.value)}
                  placeholder={t('providerPortal.techNotePlaceholder')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setActiveTicketId(null)}>
                  {t('providerPortal.cancelBtn')}
                </Button>
                <Button
                  type="submit" disabled={updateMutation.isPending}
                >
                  {t('providerPortal.submitReportBtn')}
                </Button>
              </div>
            </Form>
          </Card>
        )}
      </main>
    </div>
  );
};

// Wrapper to handle Syndic data fetching and Context population (Audit Item 22: No cross-tenant fallback)
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
  const { currentUser, userProfile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;



  if (!currentUser || !userProfile) {
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

const VIEW_TO_ROUTE: Record<View, string> = {
  dashboard: '/',
  buildings: '/buildings',
  residents: '/residents',
  apartments: '/apartments',
  financials: '/financials',
  announcements: '/announcements',
  documents: '/documents',
  maintenance: '/maintenance',
  ag: '/ag',
  prestataires: '/prestataires',
  chat: '/chat',
  marketplace: '/marketplace',
  analytics: '/analytics',
  settings: '/settings',
};

const AppContent: React.FC = () => {
  const { userProfile } = useAuth();
  const { selectedBuilding: storedBuilding, setSelectedBuilding, syndic } = useBuilding();
  const selectedBuilding = storedBuilding || syndic?.buildings[0] || null;
  const { tr } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // --- Global Mutations ---

  const addBuildingMutation = useMutation({
    mutationFn: (data: {
      syndicId: string;
      building: Omit<
        Building,
        | 'id'
        | 'residents'
        | 'apartments'
        | 'announcements'
        | 'documents'
        | 'financials'
        | 'syndicId'
      > & { apartments?: Omit<Apartment, 'id' | 'buildingId'>[] };
    }) => addBuilding(data.syndicId, data.building),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      if (created && 'id' in created) {
        setSelectedBuilding(created as Building);
      }
    },
  });

  const updateBuildingMutation = useMutation({
    mutationFn: (data: {
      buildingId: string;
      updates: Partial<Building> & { syncApartmentFees?: boolean };
    }) => updateBuilding(data.buildingId, data.updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const deleteBuildingMutation = useMutation({
    mutationFn: deleteBuilding,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const addResidentMutation = useMutation({
    mutationFn: (data: {
      resident: Omit<Resident, 'id'>;
      generateCredentials: boolean;
    }) => addResident(data.resident, data.generateCredentials),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      if (created && created.hasAccount) {

      }
    },
  });

  const updateResidentMutation = useMutation({
    mutationFn: updateResident,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const deleteResidentMutation = useMutation({
    mutationFn: deleteResident,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const regenerateCredentialsMutation = useMutation({
    mutationFn: regenerateResidentCredentials,
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      if (updated && updated.hasAccount) {

      }
    },
  });

  const addApartmentMutation = useMutation({
    mutationFn: addApartment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const addApartmentsBulkMutation = useMutation({
    mutationFn: (data: {
      buildingId: string;
      apartments: Omit<Apartment, 'id' | 'buildingId'>[];
    }) => addApartmentsBulk(data.buildingId, data.apartments),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const rebalanceTantiemesMutation = useMutation({
    mutationFn: rebalanceBuildingTantiemes,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const updateApartmentMutation = useMutation({
    mutationFn: updateApartment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const deleteApartmentMutation = useMutation({
    mutationFn: deleteApartment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const updateSyndicMutation = useMutation({
    mutationFn: saveSyndic,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const addAnnouncementMutation = useMutation({
    mutationFn: ({
      buildingId,
      title,
      content,
    }: {
      buildingId: string;
      title: string;
      content: string;
    }) => addAnnouncement(buildingId, { title, content }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const generateChargesMutation = useMutation({
    mutationFn: ({ bId, sId }: { bId: string; sId: string }) =>
      generateMonthlyCharges(bId, sId),
    onSuccess: () => {
      if (queryClient) {
        queryClient.invalidateQueries({ queryKey: ['charges'] });
        queryClient.invalidateQueries({ queryKey: ['syndics'] });
      }
    },
  });

  // --- Handlers ---

  const handleAddBuilding = (
    buildingData: Omit<
      Building,
      | 'id'
      | 'residents'
      | 'apartments'
      | 'announcements'
      | 'documents'
      | 'financials'
      | 'syndicId'
    >,
    numApartments: number,
    numberingSystem: 'numeric' | 'alphabetic' | 'floor_numeric',
    floorsCount: number = 4
  ) => {
    if (!syndic) throw new Error(tr('Sélectionnez un cabinet avant de continuer.', 'حدد مكتباً قبل المتابعة.'));

    const planLimits: Record<SubscriptionPlan, number> = {
      starter: 4,
      professional: 8,
      enterprise: Infinity,
    };
    const currentBuildings = syndic.buildings.length;
    const limit = planLimits[syndic.subscriptionPlan];

    if (currentBuildings >= limit) throw new Error(tr('Limite du forfait atteinte. Changez de forfait pour ajouter un immeuble.', 'تم بلوغ حد الاشتراك. غيّر الاشتراك لإضافة عمارة.'));

    const generatedApartments: Omit<Apartment, 'id' | 'buildingId'>[] = [];
    const safeFloors = Math.max(1, floorsCount || 4);
    const unitsPerFloor = Math.max(1, Math.ceil(numApartments / safeFloors));
    const baseTantieme = numApartments > 0 ? Math.floor(1000 / numApartments) : 100;

    for (let i = 1; i <= numApartments; i++) {
      const floorIndex = Math.min(
        safeFloors,
        Math.floor((i - 1) / unitsPerFloor) + 1
      );
      const unitOnFloor = ((i - 1) % unitsPerFloor) + 1;
      let number = '';

      if (numberingSystem === 'floor_numeric') {
        number = `${floorIndex}${unitOnFloor < 10 ? `0${unitOnFloor}` : unitOnFloor}`;
      } else if (numberingSystem === 'numeric') {
        number = `${i}`;
      } else {
        let n = i;
        while (n > 0) {
          const remainder = (n - 1) % 26;
          number = String.fromCharCode(65 + remainder) + number;
          n = Math.floor((n - 1) / 26);
        }
      }
      generatedApartments.push({
        number,
        floor: floorIndex,
        area: 80,
        tantiemes:
          i === 1
            ? baseTantieme + (1000 - baseTantieme * numApartments)
            : baseTantieme,
        coproType: 'apartment',
        ownerId: null,
        tenantId: null,
        monthlyFees: buildingData.monthlySyndicFees ?? 0,
      });
    }

    return addBuildingMutation.mutateAsync({
      syndicId: syndic.id,
      building: {
        ...buildingData,
        apartments: generatedApartments,
      },
    });
  };

  const handleAddResident = async (
    residentData: Omit<Resident, 'id' | 'syndicId' | 'buildingId'>,
    generateCredentials?: boolean
  ) => {
    if (!selectedBuilding || !syndic) throw new Error(tr('Sélectionnez un immeuble avant de continuer.', 'حدد عمارة قبل المتابعة.'));
    const resident = {
      ...residentData,
      syndicId: syndic.id,
      buildingId: selectedBuilding.id,
    };
    return await addResidentMutation.mutateAsync({
      resident,
      generateCredentials: generateCredentials ?? true,
    });
  };

  const handleAddApartment = (
    apartmentData: Omit<Apartment, 'id' | 'buildingId'>
  ) => {
    if (!selectedBuilding) throw new Error(tr('Sélectionnez un immeuble avant de continuer.', 'حدد عمارة قبل المتابعة.'));
    const apartment = { ...apartmentData, buildingId: selectedBuilding.id };
    return addApartmentMutation.mutateAsync(apartment);
  };

  const handleAddApartmentsBulk = (
    apartmentsList: Omit<Apartment, 'id' | 'buildingId'>[]
  ) => {
    if (!selectedBuilding) throw new Error(tr('Sélectionnez un immeuble avant de continuer.', 'حدد عمارة قبل المتابعة.'));
    return addApartmentsBulkMutation.mutateAsync({
      buildingId: selectedBuilding.id,
      apartments: apartmentsList,
    });
  };

  if (userProfile && userProfile.role !== 'syndic') {
    return <Navigate to={getHomeRouteForRole(userProfile.role)} replace />;
  }

  return (
    <RouteErrorBoundary>
      <Suspense fallback={<Loading message={tr('Chargement du module...', 'جاري تحميل الوحدة...')} />}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route
              path="/"
              element={
                selectedBuilding ? (
                  <Dashboard
                    building={selectedBuilding}
                    syndic={syndic || undefined}
                    onNavigate={(view: View) => {
                      const target = VIEW_TO_ROUTE[view] || '/';
                      navigate(target);
                    }}
                  />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />

            <Route
              path="/buildings"
              element={
                syndic ? (
                  <Buildings
                    syndic={syndic}
                    onAddBuilding={handleAddBuilding}
                    onUpdateBuilding={(buildingId, updates) =>
                      updateBuildingMutation.mutateAsync({ buildingId, updates })
                    }
                    onDeleteBuilding={(buildingId) =>
                      deleteBuildingMutation.mutateAsync(buildingId)
                    }
                    onSelectBuilding={(building: Building) => {
                      setSelectedBuilding(building);
                      navigate('/');
                    }}
                  />
                ) : (
                  <Loading />
                )
              }
            />

            <Route
              path="/residents"
              element={
                selectedBuilding ? (
                  <Residents
                    building={selectedBuilding}
                    onAddResident={handleAddResident}
                    onUpdateResident={updateResidentMutation.mutateAsync}
                    onDeleteResident={deleteResidentMutation.mutateAsync}
                    onRegenerateCredentials={(residentId) =>
                      regenerateCredentialsMutation.mutateAsync(residentId)
                    }
                  />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/apartments"
              element={
                selectedBuilding ? (
                  <Apartments
                    building={selectedBuilding}
                    residents={selectedBuilding.residents}
                    onAddApartment={handleAddApartment}
                    onAddApartmentsBulk={handleAddApartmentsBulk}
                    onRebalanceTantiemes={() =>
                      rebalanceTantiemesMutation.mutate(selectedBuilding.id)
                    }
                    onUpdateApartment={updateApartmentMutation.mutateAsync}
                    onDeleteApartment={deleteApartmentMutation.mutateAsync}
                  />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/financials"
              element={
                selectedBuilding && syndic ? (
                  <Financials
                    building={selectedBuilding}
                    syndic={syndic}
                    onAddTransaction={() =>
                      queryClient.invalidateQueries({ queryKey: ['syndics'] })
                    }
                    onGenerateCharges={() =>
                      generateChargesMutation.mutate({
                        bId: selectedBuilding.id,
                        sId: syndic.id,
                      })
                    }
                  />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/announcements"
              element={
                selectedBuilding ? (
                  <Announcements
                    building={selectedBuilding}
                    announcements={selectedBuilding.announcements}
                    onAddAnnouncement={(data) =>
                      addAnnouncementMutation.mutate({
                        buildingId: selectedBuilding.id,
                        title: data.title,
                        content: data.content,
                      })
                    }
                  />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/documents"
              element={
                selectedBuilding ? (
                  <Documents
                    building={selectedBuilding}
                    documents={selectedBuilding.documents}
                  />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/maintenance"
              element={
                selectedBuilding ? (
                  <Maintenance building={selectedBuilding} />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/ag"
              element={
                selectedBuilding ? (
                  <AssembleeGenerale building={selectedBuilding} syndic={syndic || undefined} />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/prestataires"
              element={
                selectedBuilding ? (
                  <Prestataires building={selectedBuilding} />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/chat"
              element={
                selectedBuilding ? (
                  <CommunityChat building={selectedBuilding} />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/marketplace"
              element={
                selectedBuilding ? (
                  <MarketplaceView building={selectedBuilding} />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/analytics"
              element={
                selectedBuilding ? (
                  <Analytics building={selectedBuilding} />
                ) : (
                  <Navigate to="/buildings" replace />
                )
              }
            />

            <Route
              path="/settings"
              element={
                syndic ? (
                  <Settings
                    syndic={syndic}
                    onUpdate={(updatedSyndic) => updateSyndicMutation.mutateAsync(updatedSyndic)}
                  />
                ) : (
                  <Loading />
                )
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
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
  const { currentUser, userProfile, loading, sessionError, sessionRetrying, retrySession } = useAuth();
  const { tr } = useI18n();

  useEffect(() => {
    if (!loading && currentUser) {
      setShowLanding(false);
    }
  }, [currentUser, loading]);

  if (loading) return <Loading />;

  if (sessionError) return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div role="alert" className="max-w-md rounded-xl border border-amber-300 bg-white p-6 shadow-sm space-y-4">
        <h1 className="text-lg font-bold">{tr('Connexion au serveur interrompue', 'انقطع الاتصال بالخادم')}</h1>
        <p>{tr('Votre session est conservée. La reconnexion est automatique dès que le serveur est disponible.', 'تم الاحتفاظ بجلستك. ستتم إعادة الاتصال تلقائياً عند توفر الخادم.')}</p>
        <Button disabled={sessionRetrying} onClick={() => void retrySession()}>{sessionRetrying ? tr('Reconnexion…', 'جارٍ إعادة الاتصال…') : tr('Réessayer la connexion', 'إعادة محاولة الاتصال')}</Button>
      </div>
    </div>
  );

  return (
    <Router>
      <BuildingProvider>
        <RouteErrorBoundary>
          <Routes>
            <Route path="/account-action" element={<AccountAction />} />
            <Route
              path="/welcome"
              element={<LandingRouteWrapper onDone={() => setShowLanding(false)} />}
            />

            <Route
              path="/login"
              element={
                currentUser && userProfile ? (
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
                    <AdminDashboard />
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
                    <ProviderPortal />
                  </SyndicDataProvider>
                </ProtectedRoute>
              }
            />
            <Route path="/provider-portal" element={<Navigate to="/provider" replace />} />

            <Route
              path="/*"
              element={
                showLanding && !currentUser ? (
                  <LandingRouteWrapper onDone={() => setShowLanding(false)} />
                ) : (
                  <ProtectedRoute roles={['syndic']}>
                    <SyndicDataProvider>
                      <AppContent />
                    </SyndicDataProvider>
                  </ProtectedRoute>
                )
              }
            />
          </Routes>
        </RouteErrorBoundary>
      </BuildingProvider>
    </Router>
  );
};

export default App;
