import React from 'react';
import { QuittanceIcon, ShieldAlertIcon } from '../../icons/IconComponents';
import { useI18n } from '../../../hooks/useI18n';
import type { FinanceTabType } from './financeConstants';

interface FinanceTabBarProps {
  activeTab: FinanceTabType;
  onSelectTab: (tab: FinanceTabType) => void;
  chargesCount: number;
  pendingProofsCount: number;
  activeQuittancesCount: number;
  overdueResidentsCount: number;
}

const FinanceTabBar: React.FC<FinanceTabBarProps> = ({
  activeTab,
  onSelectTab,
  chargesCount,
  pendingProofsCount,
  activeQuittancesCount,
  overdueResidentsCount,
}) => {
  const { tr } = useI18n();

  return (
    <div className="border-b border-slate-200">
      <nav className="flex gap-5 sm:gap-6 overflow-x-auto text-sm font-medium">
        <button
          type="button"
          onClick={() => onSelectTab('charges')}
          className={`pb-3 border-b-2 whitespace-nowrap transition-colors ${
            activeTab === 'charges'
              ? 'border-teal-600 text-teal-700 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {tr('Charges appelées', 'المساهمات المطلوبة')} ({chargesCount})
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('verifications')}
          className={`pb-3 border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
            activeTab === 'verifications'
              ? 'border-teal-600 text-teal-700 font-semibold'
              : pendingProofsCount > 0
              ? 'border-transparent text-amber-800 hover:text-amber-900 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>{tr('Virements à vérifier', 'التحويلات للمراجعة')}</span>
          {pendingProofsCount > 0 && (
            <span className="bg-amber-500 text-white text-[11px] px-2 py-0.5 rounded-full font-bold">
              {pendingProofsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('quittances')}
          className={`pb-3 border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
            activeTab === 'quittances'
              ? 'border-teal-600 text-teal-700 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <QuittanceIcon />
          <span>
            {tr('Reçus (quittances)', 'الوصولات (المخالصات)')} ({activeQuittancesCount})
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('impayes')}
          className={`pb-3 border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
            activeTab === 'impayes'
              ? 'border-rose-600 text-rose-700 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ShieldAlertIcon />
          <span>{tr('Retards', 'المتأخرات')}</span>
          {overdueResidentsCount > 0 && (
            <span className="bg-rose-100 text-rose-800 text-[11px] px-1.5 py-0.5 rounded-full font-bold">
              {overdueResidentsCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('transactions')}
          className={`pb-3 border-b-2 whitespace-nowrap transition-colors ${
            activeTab === 'transactions'
              ? 'border-teal-600 text-teal-700 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {tr("Tout l'historique", 'كل السجل المالي')}
        </button>
      </nav>
    </div>
  );
};

export default FinanceTabBar;
