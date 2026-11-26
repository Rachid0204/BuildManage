import React from 'react';
import Card from '../../common/Card';
import { useI18n } from '../../../hooks/useI18n';
import type { FinanceTodo } from './financeTodos';

interface FinanceTodoPanelProps {
  todos: FinanceTodo[];
  formatCurrency: (amount: number) => string;
  onVerifyTransfers: () => void;
  onChaseOverdue: () => void;
  onIssueCharges: (period: string) => void;
}

function formatPeriodLabel(period: string, isAr: boolean): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) return period;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  if (Number.isNaN(date.getTime())) return period;
  return date.toLocaleDateString(isAr ? 'ar-MA' : 'fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const FinanceTodoPanel: React.FC<FinanceTodoPanelProps> = ({
  todos,
  formatCurrency,
  onVerifyTransfers,
  onChaseOverdue,
  onIssueCharges,
}) => {
  const { tr, isAr } = useI18n();

  return (
    <Card className="border border-slate-200 overflow-hidden bg-white">
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
          {tr('À faire maintenant', 'ما يجب القيام به الآن')}
        </h2>
        {todos.length > 0 && (
          <span className="text-[11px] font-semibold text-slate-500">
            {todos.length} {tr('action(s)', 'إجراء')}
          </span>
        )}
      </div>

      {todos.length === 0 ? (
        <div className="px-4 py-3 text-xs text-emerald-800 bg-emerald-50/40 flex items-center gap-2 font-medium">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold shrink-0">
            ✓
          </span>
          <span>
            {tr(
              "Tout est à jour. Rien à faire pour l'instant.",
              'كل شيء محدث. لا يوجد أي إجراء عاجل حالياً.',
            )}
          </span>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {todos.map((todo) => {
            if (todo.kind === 'verifyTransfers') {
              return (
                <div
                  key="todo-verify-transfers"
                  className="px-4 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0 text-xs sm:text-sm text-slate-800">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                    <span className="font-medium">
                      {tr(
                        `${todo.count} virement(s) à vérifier`,
                        `${todo.count} تحويل(ات) بنكية للمراجعة`,
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onVerifyTransfers}
                    className="min-h-[34px] px-3 py-1 rounded-lg border border-teal-300 bg-white hover:bg-teal-50 text-teal-800 text-xs font-semibold shrink-0 transition-colors"
                  >
                    {tr('Vérifier', 'مراجعة')}
                  </button>
                </div>
              );
            }

            if (todo.kind === 'overdue') {
              return (
                <div
                  key="todo-overdue"
                  className="px-4 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0 text-xs sm:text-sm text-slate-800">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-600 shrink-0" />
                    <span className="font-medium">
                      {tr(
                        `${todo.residents} copropriétaire(s) en retard`,
                        `${todo.residents} ملاك مشتركين متأخرين`,
                      )}{' '}
                      ·{' '}
                      <span className="font-mono font-bold text-rose-700">
                        {formatCurrency(todo.amount)}
                      </span>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onChaseOverdue}
                    className="min-h-[34px] px-3 py-1 rounded-lg border border-rose-300 bg-white hover:bg-rose-50 text-rose-800 text-xs font-semibold shrink-0 transition-colors"
                  >
                    {tr('Relancer', 'متابعة')}
                  </button>
                </div>
              );
            }

            if (todo.kind === 'chargesNotIssued') {
              const periodLabel = formatPeriodLabel(todo.period, isAr);
              return (
                <div
                  key="todo-charges-not-issued"
                  className="px-4 py-2.5 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0 text-xs sm:text-sm text-slate-800">
                    <span className="w-2.5 h-2.5 rounded-full bg-teal-600 shrink-0" />
                    <span className="font-medium">
                      {tr(
                        `Charges de ${periodLabel} pas encore appelées`,
                        `مساهمات ${periodLabel} لم تصدر بعد`,
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onIssueCharges(todo.period)}
                    className="min-h-[34px] px-3 py-1 rounded-lg border border-teal-300 bg-white hover:bg-teal-50 text-teal-800 text-xs font-semibold shrink-0 transition-colors"
                  >
                    {tr('Appeler', 'إصدار')}
                  </button>
                </div>
              );
            }

            return (
              <div
                key="todo-unmatched-csv"
                className="px-4 py-2.5 flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0 text-xs sm:text-sm text-slate-800">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                  <span className="font-medium">
                    {tr(
                      `${todo.count} ligne(s) du relevé bancaire à rattacher`,
                      `${todo.count} سطر(اً) من الكشف البنكي للربط`,
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onVerifyTransfers}
                  className="min-h-[34px] px-3 py-1 rounded-lg border border-teal-300 bg-white hover:bg-teal-50 text-teal-800 text-xs font-semibold shrink-0 transition-colors"
                >
                  {tr('Rattacher', 'ربط')}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

export default FinanceTodoPanel;
