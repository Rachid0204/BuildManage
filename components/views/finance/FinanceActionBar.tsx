import React, { useEffect, useRef, useState } from 'react';
import { DocumentsIcon, FinancialsIcon, PlusIcon, QuittanceIcon } from '../../icons/IconComponents';
import { useI18n } from '../../../hooks/useI18n';

interface FinanceActionBarProps {
  onRecordPayment: () => void;
  onRecordExpense: () => void;
  onIssueMonthlyCharges: () => void;
  onRecordMiscIncome: () => void;
  onTransferFunds: () => void;
  onExportAnnualPdf: () => void;
  selectedFiscalYear: number;
  availableFiscalYears: number[];
  onChangeFiscalYear: (year: number) => void;
}

export const FinanceMoreMenu: React.FC<{
  managed: boolean;
  isAdmin: boolean;
  archivedCount: number;
  onRecordMiscIncome: () => void;
  onTransferFunds: () => void;
  onOpenOpeningArrears: () => void;
  onOpenPeriodLock: () => void;
  onOpenArchivedItems: () => void;
  onExportStatementsCsv: () => void;
  onExportLedgerCsv: () => void;
  onExportAnnualPdf: () => void;
  onExportFullJson: () => void;
  selectedFiscalYear: number;
  availableFiscalYears: number[];
  onChangeFiscalYear: (year: number) => void;
}> = ({
  managed,
  isAdmin,
  archivedCount,
  onRecordMiscIncome,
  onTransferFunds,
  onOpenOpeningArrears,
  onOpenPeriodLock,
  onOpenArchivedItems,
  onExportStatementsCsv,
  onExportLedgerCsv,
  onExportAnnualPdf,
  onExportFullJson,
  selectedFiscalYear,
  availableFiscalYears,
  onChangeFiscalYear,
}) => {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('touchstart', handleOutside, { passive: true });
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('touchstart', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={tr('Exercice fiscal', 'السنة المالية')}
        value={selectedFiscalYear}
        onChange={(e) => onChangeFiscalYear(Number(e.target.value))}
        className="min-h-[38px] px-2.5 py-1.5 text-xs font-mono font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        {availableFiscalYears.map((yr) => (
          <option key={yr} value={yr}>
            {yr}
          </option>
        ))}
      </select>

      <div ref={menuRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg inline-flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          <span>{tr("Plus d'actions", 'إجراءات أخرى')}</span>
          <span aria-hidden="true" className="text-[10px] text-slate-500">
            ▾
          </span>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute end-0 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-white border border-slate-200 shadow-lg py-2 z-30 text-xs"
          >
            {managed && (
              <>
                <div className="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {tr('Opérations occasionnelles', 'عمليات عرضية')}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onRecordMiscIncome();
                  }}
                  className="w-full px-3.5 py-2 text-start text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                >
                  <PlusIcon />
                  <span>{tr('Recette diverse', 'تسجيل مدخول آخر')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onTransferFunds();
                  }}
                  className="w-full px-3.5 py-2 text-start text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                >
                  <FinancialsIcon />
                  <span>{tr('Virement entre fonds', 'تحويل بين الصناديق')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onOpenOpeningArrears();
                  }}
                  className="w-full px-3.5 py-2 text-start text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                >
                  <PlusIcon />
                  <span>{tr('Ajouter un ancien impayé', 'إضافة متأخرات سابقة')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onOpenPeriodLock();
                  }}
                  className="w-full px-3.5 py-2 text-start text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                >
                  <FinancialsIcon />
                  <span>{tr('Verrouiller un mois terminé', 'قفل شهر مكتمل')}</span>
                </button>
                {archivedCount > 0 && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpen(false);
                      onOpenArchivedItems();
                    }}
                    className="w-full px-3.5 py-2 text-start text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
                  >
                    <DocumentsIcon />
                    <span>
                      {tr(
                        `Éléments archivés (${archivedCount})`,
                        `العناصر المؤرشفة (${archivedCount})`,
                      )}
                    </span>
                  </button>
                )}
                <div className="my-1.5 border-t border-slate-100" />
              </>
            )}

            <div className="px-3.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {tr('Exports & documents', 'التصدير والوثائق')}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onExportStatementsCsv();
              }}
              className="w-full px-3.5 py-2 text-start text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
            >
              <DocumentsIcon />
              <span>{tr('Exporter situation copropriétaires (CSV)', 'تصدير وضعية الملاك (CSV)')}</span>
            </button>
            {managed && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onExportLedgerCsv();
                }}
                className="w-full px-3.5 py-2 text-start text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
              >
                <DocumentsIcon />
                <span>{tr('Exporter historique opérations (CSV)', 'تصدير سجل العمليات (CSV)')}</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onExportAnnualPdf();
              }}
              className="w-full px-3.5 py-2 text-start text-slate-700 hover:bg-slate-50 flex items-center gap-2 font-medium"
            >
              <DocumentsIcon />
              <span>
                {tr('Clôture annuelle (PDF)', 'الحصيلة السنوية (PDF)')} ({selectedFiscalYear})
              </span>
            </button>
            {isAdmin && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onExportFullJson();
                }}
                className="w-full px-3.5 py-2 text-start text-slate-500 hover:bg-slate-50 flex items-center gap-2 font-mono text-[11px]"
              >
                <DocumentsIcon />
                <span>{tr('Sauvegarde technique (JSON)', 'نسخة احتياطية تقنية (JSON)')}</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const FinanceActionBar: React.FC<
  Pick<
    FinanceActionBarProps,
    'onRecordPayment' | 'onRecordExpense' | 'onIssueMonthlyCharges'
  >
> = ({ onRecordPayment, onRecordExpense, onIssueMonthlyCharges }) => {
  const { tr } = useI18n();

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <button
        type="button"
        onClick={onRecordPayment}
        className="group text-start p-3.5 sm:p-4 rounded-xl border border-teal-200 bg-teal-50/70 hover:bg-teal-100/70 hover:border-teal-400 transition-all flex items-start gap-3 focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <span className="p-2 rounded-lg bg-teal-700 text-white shrink-0 mt-0.5">
          <QuittanceIcon />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-900">
            {tr('Encaisser un paiement', 'تحصيل دفعة')}
          </span>
          <span className="block text-xs text-slate-600 mt-0.5">
            {tr('Un copropriétaire a payé', 'أدى أحد الملاك المشتركين مساهمته')}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={onRecordExpense}
        className="group text-start p-3.5 sm:p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all flex items-start gap-3 focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <span className="p-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 shrink-0 mt-0.5">
          <PlusIcon />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-900">
            {tr('Enregistrer une dépense', 'تسجيل مصروف')}
          </span>
          <span className="block text-xs text-slate-600 mt-0.5">
            {tr('Facture, salaire, électricité…', 'فاتورة، راتب، كهرباء...')}
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={onIssueMonthlyCharges}
        className="group text-start p-3.5 sm:p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all flex items-start gap-3 focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <span className="p-2 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 shrink-0 mt-0.5">
          <DocumentsIcon />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-900">
            {tr('Appeler les charges du mois', 'إصدار مساهمات الشهر')}
          </span>
          <span className="block text-xs text-slate-600 mt-0.5">
            {tr('Créer les montants à payer', 'إنشاء المبالغ المستحقة للشقق')}
          </span>
        </span>
      </button>
    </div>
  );
};

export default FinanceActionBar;
