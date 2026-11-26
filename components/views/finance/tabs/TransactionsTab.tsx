import React, { useMemo, useState } from 'react';
import type { Building, Syndic, Transaction } from '../../../../types';
import Card from '../../../common/Card';
import Button from '../../../common/Button';
import InfoTip from '../../../common/InfoTip';
import { DocumentsIcon, PlusIcon } from '../../../icons/IconComponents';
import { generateTransactionVoucherPDF } from '../../../../services/pdfOnDemand';
import { isIncomeTransaction, signedTransactionAmount } from '../../../../utils/security';
import { useI18n } from '../../../../hooks/useI18n';
import {
  buildCategoryLabels,
  buildDocumentTypeLabels,
  buildPaymentMethodLabels,
  currencyFormatter,
} from '../financeConstants';
import {
  computeFilteredTransactionStats,
  filterTransactions,
} from '../financeSelectors';

interface TransactionsTabProps {
  building: Building;
  syndic?: Syndic;
  filterFund: 'all' | 'courant' | 'reserve';
  onChangeFilterFund: (fund: 'all' | 'courant' | 'reserve') => void;
  onOpenExpenseModal: () => void;
  onOpenTransferModal: () => void;
  onSelectTransaction: (trx: Transaction) => void;
}

const TransactionsTab: React.FC<TransactionsTabProps> = ({
  building,
  syndic,
  filterFund,
  onChangeFilterFund,
  onOpenExpenseModal,
  onOpenTransferModal,
  onSelectTransaction,
}) => {
  const { tr, isAr } = useI18n();
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchTrx, setSearchTrx] = useState('');

  const CATEGORY_LABELS = useMemo(() => buildCategoryLabels(tr), [tr]);
  const PAYMENT_METHOD_LABELS = useMemo(() => buildPaymentMethodLabels(tr), [tr]);
  const DOCUMENT_TYPE_LABELS = useMemo(() => buildDocumentTypeLabels(tr), [tr]);

  const allTransactions = building.financials?.transactions || [];

  const filteredTransactions = useMemo(
    () =>
      filterTransactions(allTransactions, {
        fund: filterFund,
        type: filterType,
        category: filterCategory,
        search: searchTrx,
      }),
    [allTransactions, filterFund, filterType, filterCategory, searchTrx],
  );

  const filteredStats = useMemo(
    () => computeFilteredTransactionStats(allTransactions, filteredTransactions, filterFund),
    [allTransactions, filteredTransactions, filterFund],
  );

  const resetFilters = () => {
    setSearchTrx('');
    onChangeFilterFund('all');
    setFilterType('all');
    setFilterCategory('all');
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-white border border-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-4">
            <div className="relative">
              <input
                type="text"
                value={searchTrx}
                onChange={(e) => setSearchTrx(e.target.value)}
                placeholder={tr('Rechercher par libellé, prestataire, ICE, chèque...', 'بحث حسب البيان، المهني، رقم ICE، الشيك...')}
                className="w-full ps-9 pe-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
              />
              <span className="absolute start-2.5 top-2 text-slate-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
            </div>
          </div>

          <div className="md:col-span-2">
            <select
              value={filterFund}
              onChange={(e) => onChangeFilterFund(e.target.value as 'all' | 'courant' | 'reserve')}
              className="w-full py-1.5 px-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">{tr('Tous les fonds', 'جميع الصناديق')}</option>
              <option value="courant">{tr('Compte courant', 'الحساب الجاري')}</option>
              <option value="reserve">{tr('Fonds de réserve', 'صندوق الاحتياط')}</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'income' | 'expense')}
              className="w-full py-1.5 px-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">{tr('Toutes opérations', 'جميع العمليات')}</option>
              <option value="income">{tr('Recettes (+) uniquement', 'المداخيل (+) فقط')}</option>
              <option value="expense">{tr('Dépenses (-) uniquement', 'المصاريف (-) فقط')}</option>
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full py-1.5 px-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="all">{tr('Toutes les catégories', 'جميع الفئات')}</option>
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1 flex justify-end">
            <button
              onClick={resetFilters}
              title={tr('Réinitialiser filtres', 'إعادة ضبط الفلاتر')}
              className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              {tr('Effacer', 'مسح')}
            </button>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          <span className="text-slate-500 font-medium">
            {tr(
              `${filteredStats.count} opération(s) affichée(s) sur ${allTransactions.length}`,
              `عرض ${filteredStats.count} عملية من أصل ${allTransactions.length}`,
            )}
          </span>
          <div className="flex items-center gap-4 font-mono">
            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              {tr('Recettes :', 'المداخيل:')} +{currencyFormatter.format(filteredStats.income)}
            </span>
            <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
              {tr('Dépenses :', 'المصاريف:')} -{currencyFormatter.format(filteredStats.expense)}
            </span>
            <span className="text-slate-900 bg-slate-100 px-2 py-0.5 rounded font-bold border border-slate-300">
              {tr('Solde net :', 'الرصيد الصافي:')} {filteredStats.net >= 0 ? '+' : ''}
              {currencyFormatter.format(filteredStats.net)}
            </span>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden border border-slate-200 shadow-sm">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-slate-800 text-sm">
                {tr('Historique des entrées et sorties', 'سجل المداخيل والمصاريف')}
              </h3>
              <InfoTip label={tr('Information légale grand livre', 'معلومة قانونية حول السجل المحاسبي')}>
                {tr(
                  'Grand livre comptable inaltérable (Loi n° 18-00) : séparation stricte entre le compte courant et le fonds de réserve (Loi n° 106-12).',
                  'السجل المحاسبي العام (القانون 18-00): فصل قانوني بين الحساب الجاري وصندوق الاحتياط (القانون 106-12).',
                )}
              </InfoTip>
            </div>
            <p className="text-xs text-slate-500">
              {tr(
                'Toutes les dépenses, encaissements et virements entre fonds de la copropriété.',
                'جميع المصاريف والتحصيلات والتحويلات بين صناديق الإقامة.',
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="secondary"
              onClick={onOpenTransferModal}
              className="text-xs py-1.5"
            >
              {tr('Virement entre fonds', 'تحويل بين الصناديق')}
            </Button>
            <Button
              onClick={onOpenExpenseModal}
              className="text-xs py-1.5 flex items-center gap-1.5"
            >
              <PlusIcon />
              <span>{tr('Enregistrer une dépense', 'تسجيل مصروف')}</span>
            </Button>
          </div>
        </div>

        {/* Mobile Cards (< md) */}
        <div className="md:hidden divide-y divide-slate-200 bg-white">
          {filteredTransactions.map((trx) => {
            const isIncome = isIncomeTransaction(trx);
            const displayAmount = signedTransactionAmount(trx);
            return (
              <div
                key={`trx-card-${trx.id}`}
                className="p-3.5 space-y-2 active:bg-slate-50"
                onClick={() => onSelectTransaction(trx)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-slate-900 line-clamp-2">
                      {trx.description}
                    </p>
                    <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                      {new Date(trx.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                      {trx.lotNumber ? ` · ${tr('Lot', 'شقة')} ${trx.lotNumber}` : ''}
                    </p>
                  </div>
                  <span
                    className={`font-mono font-bold text-sm whitespace-nowrap tabular-nums shrink-0 ${
                      isIncome ? 'text-emerald-600' : 'text-slate-900'
                    }`}
                  >
                    {isIncome ? '+' : ''}
                    {currencyFormatter.format(displayAmount)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {trx.fundType === 'reserve' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {tr('Fonds Réserve', 'صندوق الاحتياط')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                      {tr('Compte Courant', 'الحساب الجاري')}
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                    {trx.category ? CATEGORY_LABELS[trx.category] || trx.category : tr('Charges', 'تكاليف')}
                  </span>
                  {trx.thirdPartyName && (
                    <span className="text-slate-600 truncate max-w-[160px]">
                      {trx.thirdPartyName}
                    </span>
                  )}
                </div>

                <div
                  className="flex items-center justify-end gap-2 pt-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => generateTransactionVoucherPDF(trx, building, syndic)}
                    className="inline-flex items-center gap-1 min-h-[36px] px-2.5 py-1 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg border border-teal-200"
                  >
                    <DocumentsIcon />
                    <span>PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTransaction(trx)}
                    className="min-h-[36px] px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200"
                  >
                    {tr('Détails', 'التفاصيل')}
                  </button>
                </div>
              </div>
            );
          })}
          {filteredTransactions.length === 0 && (
            <div className="px-4 py-10 text-center text-slate-500">
              <p className="font-semibold text-sm">{tr('Aucune écriture comptable trouvée', 'لم يتم العثور على أي قيد محاسبي')}</p>
            </div>
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-100/75 text-slate-600 text-start font-semibold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="px-4 py-3 text-start">{tr('Date & Réf', 'التاريخ والمرجع')}</th>
                <th className="px-4 py-3 text-start">{tr('Libellé & Pièce Comptable', 'البيان والوثيقة المحاسبية')}</th>
                <th className="px-4 py-3 text-start">{tr('Affectation Fonds', 'تخصيص الصندوق')}</th>
                <th className="px-4 py-3 text-start">{tr('Catégorie', 'الفئة')}</th>
                <th className="px-4 py-3 text-start">{tr('Règlement & Banque', 'طريقة الأداء والبنك')}</th>
                <th className="px-4 py-3 text-end">{tr('Montant', 'المبلغ')}</th>
                <th className="px-4 py-3 text-center">{tr('Justificatif', 'الإثبات')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white font-normal text-slate-800">
              {filteredTransactions.map((trx) => {
                const isIncome = isIncomeTransaction(trx);
                const displayAmount = signedTransactionAmount(trx);
                return (
                  <tr
                    key={trx.id}
                    className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                    onClick={() => onSelectTransaction(trx)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <p className="font-medium text-slate-900">
                        {new Date(trx.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                      </p>
                      <span className="font-mono text-[10px] text-slate-400">
                        {trx.id}
                      </span>
                    </td>

                    <td className="px-4 py-3 max-w-xs sm:max-w-md">
                      <p className="font-medium text-slate-900 line-clamp-1">{trx.description}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px]">
                        {trx.thirdPartyName && (
                          <span className="font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                            {trx.thirdPartyName}
                          </span>
                        )}
                        {trx.thirdPartyIce && (
                          <span className="text-slate-500 font-mono text-[10px] bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                            ICE: {trx.thirdPartyIce}
                          </span>
                        )}
                        {trx.lotNumber && (
                          <span className="text-teal-700 font-medium bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                            {tr('Lot', 'شقة')} {trx.lotNumber}
                          </span>
                        )}
                        {trx.invoiceNumber && (
                          <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-mono text-[10px] border border-amber-200">
                            {trx.documentType ? DOCUMENT_TYPE_LABELS[trx.documentType] || trx.documentType : tr('Pièce', 'وثيقة')} : #{trx.invoiceNumber}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap">
                      {trx.fundType === 'reserve' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                          {tr('Fonds de réserve', 'صندوق الاحتياط')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-teal-600"></span>
                          {tr('Compte courant', 'الحساب الجاري')}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap text-slate-600 font-medium">
                      {trx.category ? CATEGORY_LABELS[trx.category] || trx.category : tr('Charges', 'تكاليف')}
                    </td>

                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      <p className="uppercase text-[11px] font-semibold text-slate-700">
                        {trx.paymentMethod ? PAYMENT_METHOD_LABELS[trx.paymentMethod] || trx.paymentMethod : tr('Virement', 'تحويل بنكي')}
                      </p>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        {trx.reference && <span>{tr('Réf:', 'مرجع:')} {trx.reference} · </span>}
                        <span>{trx.bankName || building.bankName || ''}</span>
                      </div>
                    </td>

                    <td
                      className={`px-4 py-3 text-end font-mono font-bold text-sm whitespace-nowrap tabular-nums ${
                        isIncome ? 'text-emerald-600' : 'text-slate-900'
                      }`}
                    >
                      {isIncome ? '+' : ''}
                      {currencyFormatter.format(displayAmount)}
                    </td>

                    <td
                      className="px-4 py-3 text-center whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => generateTransactionVoucherPDF(trx, building, syndic)}
                          title={tr('Télécharger le justificatif PDF', 'تحميل الوثيقة المحاسبية PDF')}
                          className="p-1.5 text-slate-600 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors border border-slate-200"
                        >
                          <DocumentsIcon />
                        </button>
                        <button
                          onClick={() => onSelectTransaction(trx)}
                          title={tr("Voir les détails complets de l'opération", 'عرض التفاصيل الكاملة للعملية')}
                          className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200"
                        >
                          {tr('Détails', 'التفاصيل')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <p className="font-semibold text-sm text-slate-700">
                      {tr('Aucune opération affichée', 'لا توجد أي عملية معروضة')}
                    </p>
                    <p className="text-xs mt-1 text-slate-500">
                      {searchTrx || filterFund !== 'all' || filterType !== 'all' || filterCategory !== 'all'
                        ? tr(
                            'Aucune opération ne correspond aux filtres choisis.',
                            'لا توجد عملية تطابق الفلاتر المختارة.',
                          )
                        : tr(
                            "Les paiements reçus et les dépenses de l'immeuble apparaîtront ici.",
                            'ستظهر هنا المدفوعات المستلمة ومصاريف الإقامة.',
                          )}
                    </p>
                    {searchTrx || filterFund !== 'all' || filterType !== 'all' || filterCategory !== 'all' ? (
                      <Button
                        variant="secondary"
                        onClick={resetFilters}
                        className="mt-3 text-xs"
                      >
                        {tr('Réinitialiser les filtres', 'إعادة ضبط الفلاتر')}
                      </Button>
                    ) : (
                      <Button onClick={onOpenExpenseModal} className="mt-3 text-xs">
                        {tr('Enregistrer une dépense', 'تسجيل مصروف')}
                      </Button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default TransactionsTab;
