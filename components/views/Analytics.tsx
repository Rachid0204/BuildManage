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
import { getInvoicesForBuilding, getMaintenanceRequestsForBuilding } from '../../firebase/services';
import type { Building } from '../../types';
import Card from '../common/Card';
import { useI18n } from '../../hooks/useI18n';
import Loading from '../common/Loading';

const Analytics: React.FC<{ building: Building }> = ({ building }) => {
  const { t, tr, language } = useI18n();

  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ['invoices', building.id],
    queryFn: () => getInvoicesForBuilding(building.id),
  });

  const { data: maintenance = [], isLoading: loadingMaintenance } = useQuery({
    queryKey: ['maintenance', building.id],
    queryFn: () => getMaintenanceRequestsForBuilding(building.id),
  });

  const occupancyData = useMemo(() => {
    const total = building.apartments.length;
    const occupied = building.apartments.filter((a) => a.tenantId || a.ownerId).length;
    const vacant = total - occupied;
    return [
      { name: t('analytics.occupied'), value: occupied },
      { name: t('analytics.vacant'), value: vacant },
    ];
  }, [building.apartments, t]);

  const invoiceData = useMemo(() => {
    let paid = 0;
    let unpaid = 0;
    let overdue = 0;

    invoices.forEach((inv) => {
      if (inv.status === 'paid') paid++;
      else if (inv.status === 'overdue') overdue++;
      else unpaid++;
    });

    return [
      { name: t('analytics.paid'), value: paid },
      { name: t('analytics.unpaid'), value: unpaid },
      { name: t('analytics.overdue'), value: overdue },
    ];
  }, [invoices, t]);

  const maintenanceCostData = useMemo(() => {
    const months: Record<string, number> = {};
    const now = new Date();
    const locale = language === 'ar' ? 'ar-MA' : 'fr-MA';

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toLocaleString(locale, { month: 'short' });
      months[key] = 0;
    }

    maintenance.forEach((req) => {
      if (req.status === 'completed' && req.cost && req.completedAt) {
        const d = new Date(req.completedAt);
        const key = d.toLocaleString(locale, { month: 'short' });
        if (months[key] !== undefined) {
          months[key] += req.cost;
        }
      }
    });

    return Object.keys(months).map((key) => ({
      name: key,
      cost: months[key],
    }));
  }, [maintenance, language]);

  const COLORS_OCCUPANCY = ['#10B981', '#E5E7EB'];
  const COLORS_INVOICE = ['#10B981', '#FBBF24', '#EF4444'];

  if (loadingInvoices || loadingMaintenance)
    return <Loading message={tr('Chargement des statistiques...', 'جاري تحميل الإحصائيات...')} />;

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-800 mb-6">
        {t('analytics.title', { buildingName: building.name })}
      </h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <Card>
          <h2 className="text-xl font-semibold mb-4 text-gray-700">
            {t('analytics.occupancyRate')}
          </h2>
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
                  {occupancyData.map((entry, index) => (
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
            <span className="text-3xl font-bold text-primary-600">
              {building.apartments.length > 0
                ? Math.round((occupancyData[0].value / building.apartments.length) * 100)
                : 0}
              %
            </span>
            <span className="text-gray-500 text-sm ms-2">
              {t('analytics.occupied')}
            </span>
          </div>
        </Card>

        <Card>
          <h2 className="text-xl font-semibold mb-4 text-gray-700">
            {t('analytics.paymentStatus')}
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={invoiceData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                >
                  {invoiceData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS_INVOICE[index % COLORS_INVOICE.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="text-xl font-semibold mb-4 text-gray-700">
          {t('analytics.maintenanceCosts')}
        </h2>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={maintenanceCostData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => `${value} MAD`} />
              <Bar dataKey="cost" fill="#6366F1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};

export default Analytics;
