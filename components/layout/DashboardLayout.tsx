import SetupChecklist from '../views/SetupChecklist';
import {
  getEffectiveSubscriptionStatus,
  getGraceDaysRemaining,
  isInGracePeriod,
  subscriptionCanWrite,
} from '../../utils/subscriptionPolicy';
import { isIosNativeApp } from '../../utils/nativeBridge';
import React, { Suspense, useEffect, useState } from 'react';
import { Outlet, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Sidebar from '../Sidebar';
import Header from '../Header';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';
import { useBuilding } from '../../contexts/BuildingContext';
import { useI18n } from '../../hooks/useI18n';
import {
  getSubscriptionBillingConfig,
  syncAllSharedStateFromServer,
} from '../../firebase/services';
import Loading from '../common/Loading';
import {
    DashboardIcon,
    FinancialsIcon,
    AGIcon,
} from '../icons/IconComponents';
import { Wrench } from 'lucide-react';

const SubscriptionRenewalModal = React.lazy(
  () => import('../views/SubscriptionRenewalModal'),
);
const HelpDrawer = React.lazy(() => import('../help/HelpDrawer'));

// Map routes to View types for Sidebar highlighting
const getActiveView = (pathname: string): any => {
    if (pathname === '/' || pathname === '/dashboard') return 'dashboard';
    const path = pathname.substring(1); // remove leading slash
    return path.split('/')[0]; // get first segment
};

const DashboardLayout: React.FC = () => {
    const { logout, userProfile, loading } = useAuth();
    const { syndic, selectedBuilding, setSelectedBuildingId } = useBuilding();
    const { language, t, tr } = useI18n();
    const location = useLocation();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isRenewalOpen, setIsRenewalOpen] = useState(false);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const [helpArticleId, setHelpArticleId] = useState<string | undefined>(
        undefined,
    );
    const [cmiReturnBanner, setCmiReturnBanner] = useState<{
        status: 'ok' | 'fail';
        oid: string;
    } | null>(null);

    const { data: billingConfig } = useQuery({
        queryKey: ['subscriptionBillingConfig'],
        queryFn: getSubscriptionBillingConfig,
        enabled: userProfile?.role === 'syndic',
        staleTime: 60_000,
    });

    const graceDays = billingConfig?.commercialPolicy?.gracePeriodDays ?? 0;

    useEffect(() => {
        const handleOpen = () => setIsRenewalOpen(true);
        const handleOpenHelp = (event: Event) => {
            const custom = event as CustomEvent<{ articleId?: string }>;
            setHelpArticleId(custom.detail?.articleId);
            setIsHelpOpen(true);
        };
        window.addEventListener('syndik-open-renewal', handleOpen);
        window.addEventListener('syndik-open-help', handleOpenHelp);
        return () => {
            window.removeEventListener('syndik-open-renewal', handleOpen);
            window.removeEventListener('syndik-open-help', handleOpenHelp);
        };
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const cmiReturn = params.get('cmi_return');
        if (cmiReturn !== 'ok' && cmiReturn !== 'fail') return;

        const oid = (params.get('oid') || '')
            .replace(/[^A-Za-z0-9_-]/g, '')
            .slice(0, 64);
        setCmiReturnBanner({ status: cmiReturn, oid });

        params.delete('cmi_return');
        params.delete('oid');
        const cleanedQuery = params.toString();
        const nextUrl = `${location.pathname}${cleanedQuery ? `?${cleanedQuery}` : ''}${location.hash || ''}`;
        window.history.replaceState({}, '', nextUrl);

        void syncAllSharedStateFromServer(true)
            .catch(() => {})
            .finally(() => {
                void queryClient.invalidateQueries({ queryKey: ['syndics'] });
                void queryClient.invalidateQueries({
                    queryKey: ['subscriptionPayments'],
                });
            });
    }, [location.pathname, location.search, location.hash, queryClient]);

    const handleLogout = async () => {
        await logout();
        navigate('/login', { replace: true });
    };

    const activeView = getActiveView(location.pathname);

    if (loading) return <Loading message={tr('Initialisation...', 'جاري التحميل...')} />;

    if (userProfile && userProfile.role !== 'syndic') {
        return <Navigate to={getHomeRouteForRole(userProfile.role)} replace />;
    }

    if (userProfile?.role === 'syndic' && !syndic) {
        return <Loading message={tr('Chargement du profil Syndic...', 'جاري تحميل ملف السنديك...')} />;
    }

    if (!syndic) return null;

    const handleViewChange = (view: string) => {
        navigate(view === 'dashboard' ? '/' : `/${view}`);
        setIsMobileMenuOpen(false);
    };

    const effectiveStatus = getEffectiveSubscriptionStatus(
        syndic,
        Date.now(),
        graceDays,
    );
    const inGrace = isInGracePeriod(syndic, graceDays);
    const graceDaysLeft = inGrace ? getGraceDaysRemaining(syndic, graceDays) : 0;
    const canWrite = subscriptionCanWrite(syndic, graceDays);
    const canRenew = effectiveStatus !== 'cancelled';

    return (
        <div
            className="flex h-[100dvh] bg-slate-100 flex-col overflow-hidden"
            dir={language === 'ar' ? 'rtl' : 'ltr'}
        >
            <div className="flex-1 flex overflow-hidden relative">
                <Sidebar 
                    syndic={syndic} 
                    activeView={activeView} 
                    onViewChange={handleViewChange}
                    selectedBuilding={selectedBuilding}
                    onBuildingChange={(b) => setSelectedBuildingId(b.id)}
                    isOpen={isMobileMenuOpen}
                    onClose={() => setIsMobileMenuOpen(false)}
                />
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    <Header 
                        syndic={syndic} 
                        selectedBuilding={selectedBuilding} 
                        onLogout={handleLogout}
                        onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
                        onOpenHelp={() => {
                            setHelpArticleId(undefined);
                            setIsHelpOpen(true);
                        }}
                    />
                    <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-3 sm:p-6 pb-24 lg:pb-6">
                        {cmiReturnBanner && (
                            <div
                                role={cmiReturnBanner.status === 'ok' ? 'status' : 'alert'}
                                className={`text-sm p-3.5 rounded-lg mb-3 flex flex-wrap items-center justify-between gap-2 border font-semibold ${
                                    cmiReturnBanner.status === 'ok'
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                        : 'bg-rose-50 border-rose-200 text-rose-900'
                                }`}
                            >
                                <span>
                                    {cmiReturnBanner.status === 'ok'
                                        ? tr(
                                              `Paiement CMI reçu${cmiReturnBanner.oid ? ` (réf. ${cmiReturnBanner.oid})` : ''}. Votre abonnement et votre facture PDF officielle sont disponibles.`,
                                              `تم استلام الدفع عبر CMI${cmiReturnBanner.oid ? ` (مرجع ${cmiReturnBanner.oid})` : ''}. تم تحديث اشتراككم وفاتورتكم الرسمية جاهزة.`,
                                          )
                                        : tr(
                                              `Le paiement CMI n'a pas été finalisé${cmiReturnBanner.oid ? ` (réf. ${cmiReturnBanner.oid})` : ''}. Vous pouvez réessayer ou choisir un autre mode de règlement.`,
                                              `لم تكتمل عملية الدفع عبر CMI${cmiReturnBanner.oid ? ` (مرجع ${cmiReturnBanner.oid})` : ''}. يمكنكم إعادة المحاولة أو اختيار وسيلة دفع أخرى.`,
                                          )}
                                </span>
                                <div className="flex items-center gap-2">
                                    {canRenew && (
                                        <button
                                            type="button"
                                            onClick={() => setIsRenewalOpen(true)}
                                            className={`px-3 py-1 rounded-md text-xs font-bold ${
                                                cmiReturnBanner.status === 'ok'
                                                    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                                                    : 'bg-rose-700 text-white hover:bg-rose-800'
                                            }`}
                                        >
                                            {cmiReturnBanner.status === 'ok'
                                                ? tr('Mes factures PDF', 'فواتيري PDF')
                                                : tr('Réessayer', 'إعادة المحاولة')}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setCmiReturnBanner(null)}
                                        aria-label={tr('Fermer', 'إغلاق')}
                                        className="px-2 py-1 rounded text-xs font-bold hover:bg-black/5"
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                        )}
                        {syndic && (
                            <div
                                role="status"
                                className={`text-sm p-3 rounded-lg mb-3 flex flex-wrap items-center justify-between gap-2 border ${
                                    inGrace
                                        ? 'bg-amber-50 border-amber-300 text-amber-950 font-semibold'
                                        : canWrite
                                            ? 'bg-slate-100 border-slate-200 text-slate-700'
                                            : 'bg-rose-50 border-rose-200 text-rose-900 font-semibold'
                                }`}
                            >
                                <span>
                                    {inGrace
                                        ? tr(
                                              `Période de grâce active : votre abonnement est échu mais vos accès restent ouverts pendant encore ${graceDaysLeft} jour(s). Renouvelez rapidement pour éviter le mode lecture seule.`,
                                              `فترة السماح نشطة: انتهى الاشتراك ولكن صلاحيات الكتابة لا تزال متاحة لمدة ${graceDaysLeft} يوم(أيام) إضافية. يرجى التجديد لتفادي التقييد.`,
                                          )
                                        : canWrite
                                            ? tr(
                                                  `Abonnement : ${syndic.subscriptionStatus} · Échéance ${new Date(syndic.subscriptionExpiry).toLocaleDateString('fr-MA')}`,
                                                  `الاشتراك: ${syndic.subscriptionStatus} · الانتهاء ${new Date(syndic.subscriptionExpiry).toLocaleDateString('ar-MA')}`,
                                              )
                                            : tr(
                                                  'Abonnement expiré : consultation et export disponibles.',
                                                  'انتهى الاشتراك: الاطلاع والتصدير متاحان.',
                                              )}
                                </span>
                                {canRenew && (
                                    <button
                                        type="button"
                                        onClick={() => setIsRenewalOpen(true)}
                                        className={`px-3 py-1.5 min-h-[36px] rounded-md text-xs font-bold transition-colors ${
                                            inGrace
                                                ? 'bg-amber-700 text-white hover:bg-amber-800'
                                                : canWrite
                                                    ? 'bg-white border border-slate-300 text-slate-800 hover:bg-slate-50'
                                                    : 'bg-rose-700 text-white hover:bg-rose-800'
                                        }`}
                                    >
                                        {isIosNativeApp()
                                            ? tr('Abonnement & Factures →', 'الاشتراك والفواتير ←')
                                            : inGrace
                                              ? tr('Renouveler maintenant →', 'تجديد الآن ←')
                                              : tr('Renouveler / Payer →', 'تجديد / دفع ←')}
                                    </button>
                                )}
                            </div>
                        )}
                        {selectedBuilding && <SetupChecklist building={selectedBuilding} />}
                        <Outlet />
                        {isRenewalOpen && (
                            <Suspense fallback={null}>
                                <SubscriptionRenewalModal
                                    isOpen={isRenewalOpen}
                                    onClose={() => setIsRenewalOpen(false)}
                                    syndic={syndic}
                                />
                            </Suspense>
                        )}
                        {isHelpOpen && (
                            <Suspense fallback={null}>
                                <HelpDrawer
                                    isOpen={isHelpOpen}
                                    onClose={() => setIsHelpOpen(false)}
                                    role="syndic"
                                    contextKey={activeView}
                                    initialArticleId={helpArticleId}
                                    onOpenFullCenter={(articleId) =>
                                        navigate(
                                            articleId
                                                ? `/help?article=${encodeURIComponent(articleId)}`
                                                : '/help',
                                        )
                                    }
                                />
                            </Suspense>
                        )}
                    </main>
                </div>
            </div>

            {/* Mobile Bottom Navigation Bar (< lg) */}
            <nav
                aria-label={tr('Navigation mobile rapide', 'التنقل السريع عبر الهاتف')}
                className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 shadow-lg pb-safe"
            >
                <div className="grid grid-cols-5 h-16">
                    <button
                        type="button"
                        onClick={() => handleViewChange('dashboard')}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            activeView === 'dashboard' ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <span className="scale-90"><DashboardIcon /></span>
                        <span className="truncate max-w-[64px]">{t('mobileNav.home')}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleViewChange('financials')}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            activeView === 'financials' ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <span className="scale-90"><FinancialsIcon /></span>
                        <span className="truncate max-w-[64px]">{t('mobileNav.financials')}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleViewChange('maintenance')}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            activeView === 'maintenance' ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <Wrench className="w-5 h-5" strokeWidth={1.75} />
                        <span className="truncate max-w-[64px]">{t('mobileNav.maintenance')}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleViewChange('ag')}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            activeView === 'ag' ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <span className="scale-90"><AGIcon /></span>
                        <span className="truncate max-w-[64px]">{t('mobileNav.ag')}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setIsMobileMenuOpen(true)}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            isMobileMenuOpen ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                        <span className="truncate max-w-[64px]">{t('mobileNav.more')}</span>
                    </button>
                </div>
            </nav>
        </div>
    );
};

export default DashboardLayout;
