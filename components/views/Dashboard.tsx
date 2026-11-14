import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Building, Syndic, View } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import {
  ApartmentsIcon,
  AnnouncementsIcon,
  FinancialsIcon,
  WrenchIcon,
  AGIcon,
  QuittanceIcon,
  ShieldAlertIcon,
} from '../icons/IconComponents';
import {
  getChargesForBuilding,
  getPaymentProofsForBuilding,
  getMaintenanceRequestsForBuilding,
  getQuittancesForBuilding,
} from '../../firebase/services';
import { exportBuildingSummaryReportPDF } from '../../services/pdfOnDemand';
import { computeBuildingFundBalances } from '../../utils/security';
import { useI18n } from '../../hooks/useI18n';
import { useToast } from '../common/Toast';
import { useBuilding } from '../../contexts/BuildingContext';
import { FileDown } from 'lucide-react';

interface DashboardProps {
  building: Building;
  syndic?: Syndic;
  onNavigate?: (view: View) => void;
}

const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  minimumFractionDigits: 2,
});

const StatCard: React.FC<{
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  accentClass?: string;
  onClick?: () => void;
}> = ({ title, value, subtitle, icon, accentClass = 'bg-teal-50 text-teal-700', onClick }) => (
  <Card
    onClick={onClick}
    className={`flex items-start justify-between p-5 border border-slate-200 transition-all ${
      onClick ? 'cursor-pointer hover:border-teal-400 hover:shadow-md' : ''
    }`}
  >
    <div className="min-w-0">
      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider truncate">{title}</p>
      <p className="text-xl sm:text-2xl font-extrabold text-slate-900 font-mono mt-1 truncate">
        {value}
      </p>
      {subtitle && <p className="text-xs text-slate-500 mt-1 truncate">{subtitle}</p>}
    </div>
    <div className={`p-3 rounded-xl shrink-0 ms-3 ${accentClass}`}>{icon}</div>
  </Card>
);

const Dashboard: React.FC<DashboardProps> = ({ building, syndic }) => {
  const { t, tr, language } = useI18n();
  const { showToast } = useToast();
  const { setSelectedBuilding } = useBuilding();
  const navigate = useNavigate();

  const portfolioSummary = useMemo(() => {
    const blds = (syndic?.buildings ?? []).filter((b) => !b.archivedAt);
    if (blds.length <= 1) return null;
    let totalPortfolioOperating = 0;
    let totalPortfolioReserve = 0;
    let totalPortfolioLots = 0;
    for (const b of blds) {
      const bal = computeBuildingFundBalances(b);
      totalPortfolioOperating += bal.operatingBalance;
      totalPortfolioReserve += bal.reserveBalance;
      totalPortfolioLots += b.apartments?.length || 0;
    }
    return {
      buildingsCount: blds.length,
      totalPortfolioOperating,
      totalPortfolioReserve,
      totalPortfolioLots,
      buildings: blds,
    };
  }, [syndic]);

  const { data: charges = [] } = useQuery({
    queryKey: ['charges', building.id],
    queryFn: () => getChargesForBuilding(building.id),
  });

  const { data: proofs = [] } = useQuery({
    queryKey: ['proofs', building.id],
    queryFn: () => getPaymentProofsForBuilding(building.id),
  });

  const { data: maintenanceRequests = [] } = useQuery({
    queryKey: ['maintenance', building.id],
    queryFn: () => getMaintenanceRequestsForBuilding(building.id),
  });

  const { data: quittances = [] } = useQuery({
    queryKey: ['quittances', building.id],
    queryFn: () => getQuittancesForBuilding(building.id),
  });

  const apartmentsList = building?.apartments || [];
  const residentsList = building?.residents || [];
  const announcementsList = building?.announcements || [];
  const ledgerTransactions = building?.financials?.transactions || (building as any)?.transactions || [];

  const financialStats = useMemo(() => {
    const { operatingBalance: workingBalance, reserveBalance } =
      computeBuildingFundBalances(building);

    const totalChargesAmount = charges.reduce((s, c) => s + c.amount, 0);
    const paidChargesAmount = charges
      .filter((c) => c.status === 'paid')
      .reduce((s, c) => s + c.amount, 0);
    const collectionRate =
      totalChargesAmount > 0 ? Math.round((paidChargesAmount / totalChargesAmount) * 100) : 0;

    const pendingProofsCount = proofs.filter(
      (p) => p.status === 'pending' || (p.status as string) === 'pending_review'
    ).length;
    const overdueChargesCount = charges.filter((c) => c.status === 'overdue').length;

    return {
      workingBalance,
      reserveBalance,
      collectionRate,
      pendingProofsCount,
      overdueChargesCount,
      paidChargesAmount,
      totalChargesAmount,
    };
  }, [building, ledgerTransactions, charges, proofs]);

  const onboardingSteps = useMemo(() => {
    const hasBuilding = true;
    const hasApartments = apartmentsList.length > 0;
    const hasResidents = residentsList.length > 0;
    const hasCharges = charges.length > 0;
    const completedCount = [hasBuilding, hasApartments, hasResidents, hasCharges].filter(
      Boolean
    ).length;

    return {
      completedCount,
      isComplete: completedCount === 4,
      steps: [
        {
          id: 'building',
          done: hasBuilding,
          label: tr('1. Immeuble & RIB configurés', '1. إعداد الإقامة والحساب البنكي'),
          actionLabel: tr('Modifier', 'تعديل'),
          path: '/buildings',
        },
        {
          id: 'apartments',
          done: hasApartments,
          label: tr(
            `2. Créer les lots & tantièmes (${apartmentsList.length})`,
            `2. إنشاء الشقق والحصص العقارية (${apartmentsList.length})`
          ),
          actionLabel: tr('Gérer les lots', 'إدارة الشقق'),
          path: '/apartments',
        },
        {
          id: 'residents',
          done: hasResidents,
          label: tr(
            `3. Inscrire les résidents & accès PDF (${residentsList.length})`,
            `3. تسجيل السكان وبطاقات الولوج (${residentsList.length})`
          ),
          actionLabel: tr('Ajouter résident', 'إضافة ساكن'),
          path: '/residents',
        },
        {
          id: 'charges',
          done: hasCharges,
          label: tr(
            `4. Émettre le 1er appel de fonds (${charges.length})`,
            `4. إصدار أول طلب مساهمة (${charges.length})`
          ),
          actionLabel: tr('Ouvrir Comptabilité', 'فتح المحاسبة'),
          path: '/financials',
        },
      ],
    };
  }, [apartmentsList.length, residentsList.length, charges.length, tr]);

  const recentAnnouncements = announcementsList.slice(0, 3);
  const recentTransactions = ledgerTransactions.slice(0, 5);
  const openMaintenance = maintenanceRequests.filter((m) => m.status !== 'completed');
  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-MA';

  return (
    <div className="space-y-6">
      {/* Phase 5.1: Multi-Building Portfolio Cockpit for Professional Syndics */}
      {portfolioSummary && (
        <Card className="bg-slate-900 text-white p-4 border border-slate-800 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-teal-500/20 text-teal-300 border border-teal-500/30 font-bold">
                  {tr('VUE PORTEFEUILLE CABINET', 'نظرة شاملة لمحفظة مكتب السنديك')}
                </span>
                <span className="text-xs text-slate-400">
                  {portfolioSummary.buildingsCount} {tr('immeubles gérés', 'عمارات مُسيّرة')} •{' '}
                  {portfolioSummary.totalPortfolioLots} {tr('lots', 'وحدة')}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs pt-1">
                <span>
                  {tr('Trésorerie Globale :', 'الخزينة الإجمالية:')}{' '}
                  <strong className="font-mono text-emerald-400">
                    {currencyFormatter.format(portfolioSummary.totalPortfolioOperating)}
                  </strong>
                </span>
                <span>
                  {tr('Fonds de Réserve Global (Loi 106-12) :', 'صندوق الاحتياط الإجمالي:')}{' '}
                  <strong className="font-mono text-indigo-300">
                    {currencyFormatter.format(portfolioSummary.totalPortfolioReserve)}
                  </strong>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {portfolioSummary.buildings.map((b) => {
                const isCurrent = b.id === building.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBuilding(b)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all border ${
                      isCurrent
                        ? 'bg-teal-500 text-slate-950 border-teal-400'
                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                    }`}
                  >
                    🏢 {b.name}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {building.name}
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-md bg-teal-50 text-teal-800 border border-teal-200">
              {building.city || 'Maroc'} • {building.totalTantiemes || 1000}{' '}
              {t('dashboard.tantiemes')}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {building.address} — {t('dashboard.managedBy')}{' '}
            <strong className="text-slate-700">{syndic?.name || 'Cabinet Syndic'}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              exportBuildingSummaryReportPDF(building, syndic, {
                ...financialStats,
                quittancesCount: quittances.length,
                charges,
                maintenanceRequests,
              });
              showToast(
                tr(
                  'Rapport PDF de synthèse téléchargé avec succès.',
                  'تم تحميل تقرير الملخص بصيغة PDF بنجاح.'
                ),
                'success'
              );
            }}
            icon={<FileDown className="w-4 h-4" />}
          >
            {tr('Télécharger Rapport PDF', 'تحميل تقرير PDF')}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/ag')} icon={<AGIcon />}>
            {t('dashboard.conveneAg')}
          </Button>
          <Button onClick={() => navigate('/financials')} icon={<FinancialsIcon />}>
            {t('dashboard.treasuryQuittances')}
          </Button>
        </div>
      </div>

      {/* Guided Onboarding Checklist for New Syndics / Buildings */}
      {!onboardingSteps.isComplete && (
        <Card className="border-2 border-teal-600/30 bg-gradient-to-r from-teal-950 to-slate-900 text-white p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-teal-300 font-bold">
                {tr('ASSISTANT DE DÉMARRAGE LOI 18-00', 'دليل الإعداد السريع — قانون 18-00')}
              </span>
              <h2 className="text-base sm:text-lg font-bold text-white mt-0.5">
                {tr(
                  `Configuration de la résidence ${building.name} (${onboardingSteps.completedCount}/4 étapes)`,
                  `إعداد إقامة ${building.name} (${onboardingSteps.completedCount}/4 مراحل)`
                )}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-32 bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-teal-400 h-full transition-all duration-500"
                  style={{ width: `${(onboardingSteps.completedCount / 4) * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono font-bold text-teal-300">
                {Math.round((onboardingSteps.completedCount / 4) * 100)}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {onboardingSteps.steps.map((step) => (
              <div
                key={step.id}
                className={`p-3.5 rounded-xl border flex flex-col justify-between gap-3 ${
                  step.done
                    ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-100'
                    : 'bg-slate-800/90 border-slate-700 text-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold leading-snug">{step.label}</span>
                  <span
                    className={`w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold shrink-0 ${
                      step.done ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {step.done ? '✓' : '•'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => navigate(step.path)}
                  className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold text-center transition-colors ${
                    step.done
                      ? 'bg-white/10 hover:bg-white/20 text-white'
                      : 'bg-teal-500 hover:bg-teal-400 text-slate-950'
                  }`}
                >
                  {step.actionLabel} {language === 'ar' ? '←' : '→'}
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          title={t('dashboard.workingFund')}
          value={currencyFormatter.format(financialStats.workingBalance)}
          subtitle={`RIB: ${building.bankName || 'Banque'} (${building.bankRib?.slice(-6) || 'N/A'})`}
          icon={<FinancialsIcon />}
          accentClass="bg-teal-100 text-teal-800"
          onClick={() => navigate('/financials')}
        />
        <StatCard
          title={t('dashboard.reserveFund')}
          value={currencyFormatter.format(financialStats.reserveBalance)}
          subtitle={t('dashboard.reserveRateSubtitle', {
            rate: String(building.reserveFundRate || 5),
          })}
          icon={<QuittanceIcon />}
          accentClass="bg-indigo-100 text-indigo-800"
          onClick={() => navigate('/financials')}
        />
        <StatCard
          title={t('dashboard.collectionRate')}
          value={`${financialStats.collectionRate}%`}
          subtitle={
            financialStats.pendingProofsCount > 0
              ? t('dashboard.proofsToVerify', {
                  count: String(financialStats.pendingProofsCount),
                })
              : t('dashboard.overdueCount', {
                  count: String(financialStats.overdueChargesCount),
                })
          }
          icon={<ShieldAlertIcon />}
          accentClass={
            financialStats.overdueChargesCount > 0
              ? 'bg-amber-100 text-amber-800'
              : 'bg-emerald-100 text-emerald-800'
          }
          onClick={() => navigate('/financials')}
        />
        <StatCard
          title={t('dashboard.lotsAndCopro')}
          value={`${residentsList.length} / ${apartmentsList.length}`}
          subtitle={t('dashboard.openMaintCount', { count: String(openMaintenance.length) })}
          icon={<ApartmentsIcon />}
          accentClass="bg-slate-200 text-slate-800"
          onClick={() => navigate('/apartments')}
        />
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Recent Ledger & Maintenance */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{t('dashboard.recentLedger')}</h2>
                <p className="text-xs text-slate-500">
                  {t('dashboard.quittancesIssuedCount', { count: String(quittances.length) })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/financials')}
                className="text-xs font-semibold text-teal-700 hover:text-teal-900"
              >
                {t('dashboard.openFullLedger')} {language === 'ar' ? '←' : '→'}
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {recentTransactions.length > 0 ? (
                recentTransactions.map((trx: any) => {
                  const isIncome = trx.type === 'income' || (trx.type !== 'expense' && trx.amount >= 0);
                  return (
                    <div key={trx.id} className="py-3 flex justify-between items-center gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {trx.description}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-slate-400 font-mono">
                            {new Date(trx.date).toLocaleDateString(dateLocale)}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                              trx.fundType === 'reserve'
                                ? 'bg-indigo-50 text-indigo-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {trx.fundType === 'reserve'
                              ? t('dashboard.fundReserveBadge')
                              : t('dashboard.fundWorkingBadge')}
                          </span>
                        </div>
                      </div>
                      <span
                        className={`text-sm font-bold font-mono shrink-0 ${
                          isIncome ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {isIncome ? '+' : '-'}
                        {currencyFormatter.format(Math.abs(trx.amount || 0))}
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="text-slate-500 py-6 text-center text-sm">
                  {t('dashboard.noTransactions')}
                </p>
              )}
            </div>
          </Card>

          <Card className="border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <WrenchIcon />
                <span>{t('dashboard.activeMaintenance')}</span>
              </h2>
              <button
                type="button"
                onClick={() => navigate('/maintenance')}
                className="text-xs font-semibold text-teal-700 hover:text-teal-900"
              >
                {t('dashboard.manageInterventions')} {language === 'ar' ? '←' : '→'}
              </button>
            </div>
            <div className="space-y-3">
              {openMaintenance.length > 0 ? (
                openMaintenance.slice(0, 3).map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            req.priority === 'high' ? 'bg-rose-500' : 'bg-amber-500'
                          }`}
                        />
                        <p className="text-sm font-semibold text-slate-900 truncate">{req.title}</p>
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{req.description}</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 shrink-0">
                      {req.status === 'in_progress'
                        ? t('dashboard.statusInProgress')
                        : t('dashboard.statusPending')}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 py-4 text-center">
                  {t('dashboard.noActiveMaintenance')}
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Official Notices & Concierge Card */}
        <div className="space-y-6">
          <Card className="border border-slate-200 bg-slate-900 text-white">
            <h3 className="text-xs font-bold uppercase tracking-wider text-teal-400">
              {t('dashboard.siteContactTitle')}
            </h3>
            <p className="text-lg font-bold mt-1">{building.managerName}</p>
            <p className="text-sm text-slate-300 font-mono mt-0.5">{building.managerPhone}</p>
            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>{t('dashboard.monthlyFeeLabel')}</span>
              <span className="font-mono font-bold text-white">
                {currencyFormatter.format(building.monthlySyndicFees || 0)} / {t('dashboard.perMonth')}
              </span>
            </div>
          </Card>

          <Card className="border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <AnnouncementsIcon />
                <span>{t('dashboard.recentAnnouncements')}</span>
              </h2>
              <button
                type="button"
                onClick={() => navigate('/announcements')}
                className="text-xs font-semibold text-teal-700 hover:text-teal-900"
              >
                {tr('Publier', 'نشر')} {language === 'ar' ? '←' : '→'}
              </button>
            </div>
            <div className="space-y-4">
              {recentAnnouncements.length > 0 ? (
                recentAnnouncements.map((ann) => (
                  <div
                    key={ann.id}
                    className="p-3.5 bg-slate-50 rounded-lg border border-slate-200/80"
                  >
                    <h3 className="font-bold text-sm text-slate-800">{ann.title}</h3>
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">{ann.content}</p>
                    <p className="text-[11px] text-slate-400 mt-2 font-mono">
                      {new Date(ann.date).toLocaleDateString(dateLocale)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-slate-500 py-4 text-center text-sm">
                  {t('dashboard.noAnnouncements')}
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;