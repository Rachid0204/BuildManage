import React from 'react';
import Card from '../../common/Card';
import InfoTip from '../../common/InfoTip';
import { useI18n } from '../../../hooks/useI18n';
import { useLegalFramework } from '../../../hooks/useLegalFramework';
import { currencyFormatter, type FinanceTabType } from './financeConstants';
import type { FinanceOverviewStats } from './financeSelectors';

interface FinanceKpiCardsProps {
  stats: FinanceOverviewStats;
  bankName?: string;
  overdueResidentsCount: number;
  onSelectFundTransactions: (fund: 'courant' | 'reserve') => void;
  onSelectTab: (tab: FinanceTabType) => void;
}

const FinanceKpiCards: React.FC<FinanceKpiCardsProps> = ({
  stats,
  bankName,
  overdueResidentsCount,
  onSelectFundTransactions,
  onSelectTab,
}) => {
  const { tr } = useI18n();
  const { legal } = useLegalFramework();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="p-0 border-s-4 border-s-teal-600 hover:border-slate-300 transition-colors">
        <button
          type="button"
          onClick={() => onSelectFundTransactions('courant')}
          className="w-full p-4 text-start cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500 rounded-e-xl"
        >
          <span className="block text-xs font-semibold text-slate-600">
            {tr('Argent disponible', 'الرصيد المتاح')}
          </span>
          <span className="block text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
            {currencyFormatter.format(stats.balance)}
          </span>
          <span className="block text-[11px] text-slate-500 mt-1 truncate">
            <span>{tr('Compte courant', 'الحساب الجاري')}</span>
            {bankName ? ` · ${bankName}` : ''}
          </span>
        </button>
      </Card>

      <Card className="p-4 border-s-4 border-s-indigo-600 hover:border-slate-300 transition-colors">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-xs font-semibold text-slate-600">
            {tr('Fonds de réserve', 'صندوق الاحتياط')}
          </span>
          <InfoTip label={tr('Information légale fonds de réserve', 'معلومة قانونية حول صندوق الاحتياط')}>
            {tr(
              `Obligation légale (${legal.citations.reserveFundRefFr}) : épargne réservée aux gros travaux et réparations majeures de la copropriété.`,
              `إلزام قانوني (${legal.citations.reserveFundRefAr}): مدخرات مخصصة للأشغال والإصلاحات الكبرى للملكية المشتركة.`,
            )}
          </InfoTip>
        </div>
        <button
          type="button"
          onClick={() => onSelectFundTransactions('reserve')}
          className="w-full text-start cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500 rounded mt-1"
        >
          <span className="block text-2xl font-bold font-mono text-indigo-900 tabular-nums">
            {currencyFormatter.format(stats.reserveFund)}
          </span>
          <span className="block text-[11px] text-slate-500 mt-1">
            {tr('Réservé aux gros travaux', 'مخصص للأشغال الكبرى')}
          </span>
        </button>
      </Card>

      <Card className="p-0 border-s-4 border-s-amber-500 hover:border-slate-300 transition-colors">
        <button
          type="button"
          onClick={() => onSelectTab('charges')}
          className="w-full p-4 text-start cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500 rounded-e-xl"
        >
          <span className="block text-xs font-semibold text-slate-600">
            {tr('À encaisser', 'قيد التحصيل')}
          </span>
          <span className="block text-2xl font-bold font-mono text-amber-800 mt-1 tabular-nums">
            {currencyFormatter.format(stats.pendingChargesTotal)}
          </span>
          <span className="block text-[11px] text-slate-500 mt-1">
            {tr('Pas encore en retard', 'ضمن أجل الأداء')}
          </span>
        </button>
      </Card>

      <Card className="p-0 border-s-4 border-s-rose-600 hover:border-slate-300 transition-colors">
        <button
          type="button"
          onClick={() => onSelectTab('impayes')}
          className="w-full p-4 text-start cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-teal-500 rounded-e-xl"
        >
          <span className="block text-xs font-semibold text-slate-600">
            {tr('En retard', 'المتأخرات')}
          </span>
          <span className="block text-2xl font-bold font-mono text-rose-700 mt-1 tabular-nums">
            {currencyFormatter.format(stats.overdueChargesTotal)}
          </span>
          <span className="block text-[11px] text-rose-600 mt-1 font-medium">
            {overdueResidentsCount}{' '}
            {tr('copropriétaire(s) en retard', 'ملاك مشتركين متأخرين')}
          </span>
        </button>
      </Card>
    </div>
  );
};

export default FinanceKpiCards;
