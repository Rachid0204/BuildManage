import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  getChargesForBuilding,
  getMaintenanceRequestsForBuilding,
} from '../../firebase/services';
import type { Building } from '../../types';
import Card from '../common/Card';
import { useI18n } from '../../hooks/useI18n';
import { DashboardSkeleton } from '../common/Skeleton';

const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  maximumFractionDigits: 0,
});

const Analytics: React.FC<{ building: Building }> = ({ building }) => {
  const { t, tr, language } = useI18n();

  const { data: charges = [], isLoading: loadingCharges } = useQuery({
    queryKey: ['charges', building.id],
    queryFn: () => getChargesForBuilding(building.id),
  });

  const { data: maintenance = [], isLoading: loadingMaintenance } = useQuery({
    queryKey: ['maintenance', building.id],
    queryFn: () => getMaintenanceRequestsForBuilding(building.id),
  });

  const apartmentsList = building?.apartments || [];
  const ledgerTransactions = building?.financials?.transactions || (building as any)?.transactions || [];

  const occupancyData = useMemo(() => {
    const total = apartmentsList.length;
    const occupied = apartmentsList.filter((a) => a.tenantId || a.ownerId).length;
    const vacant = Math.max(0, total - occupied);
    return [
      { name: t('analytics.occupied'), value: occupied },
      { name: t('analytics.vacant'), value: vacant },
    ];
  }, [apartmentsList, t]);

  const chargeStatusData = useMemo(() => {
    let paid = 0;
    let unpaid = 0;
    let overdue = 0;

    charges.forEach((ch) => {
      if (ch.status === 'paid') paid++;
      else if (ch.status === 'overdue') overdue++;
      else unpaid++;
    });

    return [
      { name: t('analytics.paid'), value: paid },
      { name: t('analytics.unpaid'), value: unpaid },
      { name: t('analytics.overdue'), value: overdue },
    ];
  }, [charges, t]);

  const financialSummary = useMemo(() => {
    const totalBilled = charges.reduce((sum, c) => sum + c.amount, 0);
    const totalPaid = charges
      .filter((c) => c.status === 'paid')
      .reduce((sum, c) => sum + c.amount, 0);
    const totalPending = totalBilled - totalPaid;
    const collectionRate = totalBilled > 0 ? Math.round((totalPaid / totalBilled) * 100) : 0;

    return { totalBilled, totalPaid, totalPending, collectionRate };
  }, [charges]);

  const maintenanceCostData = useMemo(() => {
    const buckets: Array<{ key: string; name: string; cost: number }> = [];
    const byKey = new Map<string, { key: string; name: string; cost: number }>();
    const now = new Date();
    const locale = language === 'ar' ? 'ar-MA' : 'fr-MA';

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString(locale, { month: 'short' });
      const entry = { key, name: label, cost: 0 };
      buckets.push(entry);
      byKey.set(key, entry);
    }

    const monthKey = (raw: string) => {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return '';
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const recordedTicketCosts = new Set<string>();
    maintenance.forEach((req) => {
      if ((req.status === 'completed' || req.cost) && (req.completedAt || req.createdAt)) {
        const key = monthKey(req.completedAt || req.createdAt);
        const bucket = byKey.get(key);
        if (bucket && (req.cost ?? 0) > 0) {
          bucket.cost += req.cost ?? 0;
          if (req.invoiceRef) recordedTicketCosts.add(`${key}:${req.invoiceRef}`);
        }
      }
    });

    ledgerTransactions
      .filter(
        (tx: any) =>
          (tx.amount < 0 || tx.type === 'expense') &&
          !tx.reversalOf &&
          ['maintenance', 'elevator', 'cleaning', 'security'].includes(tx.category || '')
      )
      .forEach((tx: any) => {
        const key = monthKey(tx.date);
        const bucket = byKey.get(key);
        if (bucket && (!tx.reference || !recordedTicketCosts.has(`${key}:${tx.reference}`))) {
          bucket.cost += Math.abs(tx.amount || 0);
        }
      });

    return buckets.map(({ name, cost }) => ({ name, cost }));
  }, [maintenance, ledgerTransactions, language]);

  const COLORS_OCCUPANCY = ['#0D9488', '#E2E8F0'];
  const COLORS_CHARGES = ['#10B981', '#F59E0B', '#EF4444'];

  if (loadingCharges || loadingMaintenance) {
    return <DashboardSkeleton />;
  }

  const occupancyPct =
    apartmentsList.length > 0
      ? Math.round((occupancyData[0].value / apartmentsList.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {t('analytics.title', { buildingName: building.name })}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            {tr(
              'Indicateurs de recouvrement Loi 18-00, occupation des lots et évolution des charges',
              'مؤشرات التحصيل المالي قانون 18-00، نسبة شغل الشقق وتطور المصاريف'
            )}
          </p>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-5 border border-slate-200">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {tr('Taux de Recouvrement', 'نسبة التحصيل')}
          </p>
          <p className="text-2xl font-extrabold font-mono text-teal-700 mt-1">
            {financialSummary.collectionRate}%
          </p>
          <p className="text-[11px] text-slate-500 mt-1 font-mono">
            {currencyFormatter.format(financialSummary.totalPaid)} /{' '}
            {currencyFormatter.format(financialSummary.totalBilled)}
          </p>
        </Card>

        <Card className="p-5 border border-slate-200">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {tr('Reste à Recouvrer', 'الباقي استخلاصه')}
          </p>
          <p className="text-2xl font-extrabold font-mono text-amber-700 mt-1">
            {currencyFormatter.format(financialSummary.totalPending)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {charges.filter((c) => c.status !== 'paid').length}{' '}
            {tr('appels en attente', 'مساهمات قيد الانتظار')}
          </p>
        </Card>

        <Card className="p-5 border border-slate-200">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {t('analytics.occupancyRate')}
          </p>
          <p className="text-2xl font-extrabold font-mono text-slate-900 mt-1">{occupancyPct}%</p>
          <p className="text-[11px] text-slate-500 mt-1">
            {occupancyData[0].value} / {apartmentsList.length}{' '}
            {tr('lots attribués', 'شقق معينة')}
          </p>
        </Card>

        <Card className="p-5 border border-slate-200">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {tr('Interventions Maintenance', 'تدخلات الصيانة')}
          </p>
          <p className="text-2xl font-extrabold font-mono text-indigo-700 mt-1">
            {maintenance.length}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {maintenance.filter((m) => m.status === 'completed').length}{' '}
            {tr('clôturées', 'منجزة')}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border border-slate-200">
          <h2 className="text-base font-bold mb-4 text-slate-900">
            {t('analytics.occupancyRate')}
          </h2>
          {apartmentsList.length > 0 ? (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={occupancyData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {occupancyData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS_OCCUPANCY[index % COLORS_OCCUPANCY.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="text-center mt-2">
                <span className="text-2xl font-bold font-mono text-teal-700">{occupancyPct}%</span>
                <span className="text-slate-500 text-xs ms-2">{t('analytics.occupied')}</span>
              </div>
            </>
          ) : (
            <div className="h-64 flex items-center justify-center text-xs text-slate-500">
              {tr('Aucun lot enregistré pour cet immeuble.', 'لا توجد شقق مسجلة لهذه الإقامة.')}
            </div>
          )}
        </Card>

        <Card className="border border-slate-200">
          <h2 className="text-base font-bold mb-4 text-slate-900">
            {t('analytics.paymentStatus')}
          </h2>
          {charges.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chargeStatusData}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="value"
                  >
                    {chargeStatusData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS_CHARGES[index % COLORS_CHARGES.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-xs text-slate-500">
              {tr(
                'Aucun appel de fonds émis pour le moment.',
                'لم يتم إصدار أي طلب مساهمة حتى الآن.'
              )}
            </div>
          )}
        </Card>
      </div>

      <Card className="border border-slate-200">
        <h2 className="text-base font-bold mb-4 text-slate-900">
          {t('analytics.maintenanceCosts')}
        </h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={maintenanceCostData}
              margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => `${value} MAD`} />
              <Bar dataKey="cost" fill="#0D9488" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};

export default Analytics;
