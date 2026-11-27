import React, { useMemo, useState } from 'react';
import type { Building, Quittance, Syndic } from '../../../../types';
import Card from '../../../common/Card';
import Button from '../../../common/Button';
import InfoTip from '../../../common/InfoTip';
import { QuittanceIcon } from '../../../icons/IconComponents';
import { generateQuittancePDF } from '../../../../services/pdfOnDemand';
import { useAuth } from '../../../../contexts/AuthContext';
import { useI18n } from '../../../../hooks/useI18n';
import { useLegalFramework } from '../../../../hooks/useLegalFramework';
import {
  buildPaymentMethodLabels,
  currencyFormatter,
  formatRecordedFund,
} from '../financeConstants';
import type { ReversiblePaymentSummary } from '../financeReportExport';
import type { ReversePaymentModalRequest } from '../modals/ReversePaymentModal';
import { computeQuittanceTotals, filterQuittances } from '../financeSelectors';

interface QuittancesTabProps {
  building: Building;
  syndic?: Syndic;
  quittances: Quittance[];
  showVoidedQuittances: boolean;
  onChangeShowVoidedQuittances: (show: boolean) => void;
  onOpenNewPayment: () => void;
  onPreviewQuittance: (quittance: Quittance) => void;
  reversiblePayments: ReadonlyMap<string, ReversiblePaymentSummary>;
  onReversePayment: (request: ReversePaymentModalRequest) => void;
}

const QuittancesTab: React.FC<QuittancesTabProps> = ({
  building,
  syndic,
  quittances,
  showVoidedQuittances,
  onChangeShowVoidedQuittances,
  onOpenNewPayment,
  onPreviewQuittance,
  reversiblePayments,
  onReversePayment,
}) => {
  const { tr, isAr } = useI18n();
  const { userProfile } = useAuth();
  const { legal } = useLegalFramework();
  const managed = ['admin', 'syndic'].includes(userProfile?.role || '');
  const [quittanceSearch, setQuittanceSearch] = useState('');
  const [quittanceFilterMethod, setQuittanceFilterMethod] = useState('all');

  const PAYMENT_METHOD_LABELS = useMemo(() => buildPaymentMethodLabels(tr), [tr]);
  const buildingTantiemesBase = building.totalTantiemes || 1000;

  const filteredQuittances = useMemo(
    () => filterQuittances(quittances, quittanceSearch, quittanceFilterMethod),
    [quittances, quittanceSearch, quittanceFilterMethod],
  );

  const activeQuittances = useMemo(
    () => quittances.filter((q) => !q.voidedAt),
    [quittances],
  );

  const { totalAmount: totalQuittancesAmount, totalReserveFundAmount } = useMemo(
    () => computeQuittanceTotals(quittances),
    [quittances],
  );

  return (
    <div className="space-y-4">
      <Card className="bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 text-white p-5 border-none shadow-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold tracking-tight">
                {tr('Reçus de paiement (quittances)', 'وصولات الأداء (المخالصات)')}
              </h3>
              <InfoTip label={tr('Information légale quittances', 'معلومة قانونية حول الوصولات')}>
                {tr(
                  `Conformément au cadre légal (${legal.citations.statuteShortFr} · ${legal.citations.reserveFundRefFr}), chaque quittance officielle libère le copropriétaire pour la période réglée et ventile automatiquement la part du fonds de réserve.`,
                  `وفقاً للإطار القانوني (${legal.citations.statuteShortAr} · ${legal.citations.reserveFundRefAr})، يبرئ كل وصل رسمي ذمة المالك المشترك عن الفترة المؤداة ويوزع تلقائياً حصة صندوق الاحتياط.`,
                )}
              </InfoTip>
            </div>
            <p className="text-xs text-teal-100/90 max-w-2xl leading-relaxed">
              {tr(
                'Tous les reçus officiels délivrés après encaissement, prêts à télécharger ou renvoyer en PDF.',
                'جميع الوصولات الرسمية الصادرة بعد التحصيل، جاهزة للتحميل أو الإرسال بصيغة PDF.',
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={onOpenNewPayment}
              className="bg-white text-teal-900 hover:bg-teal-50 font-bold text-xs sm:text-sm shadow-sm flex items-center gap-1.5"
            >
              <QuittanceIcon />
              <span>{tr('Encaisser un paiement', 'تحصيل دفعة')}</span>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-teal-700/60">
          <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
            <span className="text-[10px] text-teal-200 font-semibold uppercase block">
              {tr('Reçus valides', 'الوصولات السارية')}
            </span>
            <span className="text-lg font-bold font-mono text-white mt-0.5 block">{activeQuittances.length}</span>
          </div>
          <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
            <span className="text-[10px] text-teal-200 font-semibold uppercase block">
              {tr('Total encaissé', 'مجموع المحصل')}
            </span>
            <span className="text-lg font-bold font-mono text-white mt-0.5 block">
              {currencyFormatter.format(totalQuittancesAmount)}
            </span>
          </div>
          <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
            <span className="text-[10px] text-teal-200 font-semibold uppercase block">
              {tr('Dont fonds de réserve', 'حصة صندوق الاحتياط')}
            </span>
            <span className="text-lg font-bold font-mono text-emerald-300 mt-0.5 block">
              {currencyFormatter.format(totalReserveFundAmount)}
            </span>
          </div>
          <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
            <span className="text-[10px] text-teal-200 font-semibold uppercase block">
              {tr('Dernier reçu', 'آخر وصل صادر')}
            </span>
            <span className="text-xs font-mono font-bold text-teal-100 truncate mt-1 block">
              {activeQuittances[0]?.quittanceNumber || quittances[0]?.quittanceNumber || tr('Aucun', 'لا يوجد')}
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-3 bg-white border border-slate-200">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="relative w-full sm:w-80">
            <input
              type="text"
              value={quittanceSearch}
              onChange={(e) => setQuittanceSearch(e.target.value)}
              placeholder={tr('Filtrer par copropriétaire, lot, N° reçu...', 'تصفية حسب المالك، الشقة، رقم الوصل...')}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showVoidedQuittances}
                onChange={(e) => onChangeShowVoidedQuittances(e.target.checked)}
                className="rounded text-rose-600 focus:ring-rose-500"
              />
              <span>{tr('Inclure les reçus annulés', 'إظهار الوصولات الملغاة')}</span>
            </label>

            <select
              value={quittanceFilterMethod}
              onChange={(e) => setQuittanceFilterMethod(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
            >
              <option value="all">{tr('Tous les modes de paiement', 'جميع طرق الأداء')}</option>
              {Object.entries(PAYMENT_METHOD_LABELS).map(([methodKey, label]) => (
                <option key={methodKey} value={methodKey}>
                  {label}
                </option>
              ))}
            </select>

            {quittanceSearch && (
              <button
                onClick={() => setQuittanceSearch('')}
                className="text-xs text-slate-500 hover:text-slate-800 underline px-1"
              >
                {tr('Effacer', 'مسح')}
              </button>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden border border-slate-200">
        {/* Mobile Cards (< md) */}
        <div className="md:hidden divide-y divide-slate-200 bg-white">
          {filteredQuittances.map((quit) => {
            const apt = building.apartments.find((a) => a.id === quit.apartmentId);
            const res = building.residents.find((r) => r.id === quit.residentId);
            return (
              <div
                key={`quit-card-${quit.id}`}
                className={`p-3.5 space-y-2.5 ${quit.voidedAt ? 'opacity-70 bg-rose-50/30' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span
                      className={`font-mono font-bold px-2 py-0.5 rounded text-xs inline-block ${
                        quit.voidedAt
                          ? 'text-rose-700 bg-rose-50 line-through'
                          : 'text-teal-800 bg-teal-50'
                      }`}
                    >
                      {quit.quittanceNumber}
                    </span>
                    <div className="font-bold text-sm text-slate-900 truncate mt-1">
                      {quit.residentName}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {tr('Lot', 'شقة')} {quit.apartmentNumber} · {quit.periodCovered}
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <div
                      className={`font-mono font-bold text-sm ${
                        quit.voidedAt ? 'text-rose-700 line-through' : 'text-teal-900'
                      }`}
                    >
                      {currencyFormatter.format(quit.amount)}
                    </div>
                    <span
                      className={`inline-block mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        quit.voidedAt
                          ? 'text-rose-700 bg-rose-50'
                          : 'text-emerald-700 bg-emerald-50'
                      }`}
                    >
                      {quit.voidedAt ? tr('Annulée', 'ملغى') : tr('Payé', 'مؤدى')}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                  <span>{PAYMENT_METHOD_LABELS[quit.paymentMethod] || quit.paymentMethod}</span>
                  <span>
                    {new Date(quit.postingDate || quit.paymentDate).toLocaleDateString(
                      isAr ? 'ar-MA' : 'fr-MA',
                    )}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onPreviewQuittance(quit)}
                    className="min-h-[36px] px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 font-semibold"
                  >
                    {tr('Aperçu', 'معاينة')}
                  </button>
                  <button
                    type="button"
                    onClick={() => generateQuittancePDF(quit, building, syndic, apt, res)}
                    className="min-h-[36px] px-3 py-1.5 text-xs bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1"
                  >
                    <QuittanceIcon />
                    <span>{tr('Télécharger PDF', 'تحميل PDF')}</span>
                  </button>
                  {managed &&
                    !quit.voidedAt &&
                    quit.paymentId &&
                    reversiblePayments.has(quit.paymentId) && (
                      <button
                        type="button"
                        onClick={() =>
                          onReversePayment({
                            paymentId: quit.paymentId!,
                            residentName: quit.residentName,
                            apartmentNumber: quit.apartmentNumber,
                            quittanceNumber: quit.quittanceNumber,
                            periodLabel: quit.periodCovered,
                            amount: reversiblePayments.get(quit.paymentId!)!.totalAmount,
                          })
                        }
                        className="min-h-[36px] px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 rounded-lg border border-rose-200 font-semibold"
                      >
                        {tr('Annuler', 'إلغاء')}
                      </button>
                    )}
                </div>
              </div>
            );
          })}
          {filteredQuittances.length === 0 && (
            <div className="px-4 py-10 text-center text-slate-500">
              <p className="font-semibold text-sm text-slate-700">
                {tr('Aucun reçu enregistré', 'لم يتم العثور على أي وصل')}
              </p>
              <Button
                onClick={onOpenNewPayment}
                className="mt-3 text-xs bg-teal-700 hover:bg-teal-800"
              >
                {tr('Encaisser un paiement', 'تحصيل دفعة')}
              </Button>
            </div>
          )}
        </div>

        <div className="hidden md:block overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-600 text-start font-semibold">
              <tr>
                <th className="px-4 py-3 text-start">{tr('N° Reçu & Date', 'رقم الوصل والتاريخ')}</th>
                <th className="px-4 py-3 text-start">{tr('Copropriétaire', 'المالك المشترك')}</th>
                <th className="px-4 py-3 text-start">{tr('Lot', 'الشقة')}</th>
                <th className="px-4 py-3 text-start">{tr('Période', 'الفترة المؤداة')}</th>
                <th className="px-4 py-3 text-start">{tr('Répartition fonds', 'توزيع الصناديق')}</th>
                <th className="px-4 py-3 text-end">{tr('Montant', 'المبلغ')}</th>
                <th className="px-4 py-3 text-start">{tr('Paiement', 'الأداء')}</th>
                <th className="px-4 py-3 text-end">{tr('Actions', 'إجراءات')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredQuittances.map((quit) => {
                const apt = building.apartments.find((a) => a.id === quit.apartmentId);
                const res = building.residents.find((r) => r.id === quit.residentId);
                const reversibleSummary =
                  managed && !quit.voidedAt && quit.paymentId
                    ? reversiblePayments.get(quit.paymentId)
                    : undefined;

                return (
                  <tr
                    key={quit.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      quit.voidedAt ? 'opacity-70 bg-rose-50/30' : ''
                    }`}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`font-mono font-bold px-2 py-0.5 rounded text-xs block w-fit ${
                          quit.voidedAt
                            ? 'text-rose-700 bg-rose-50 line-through'
                            : 'text-teal-800 bg-teal-50'
                        }`}
                      >
                        {quit.quittanceNumber}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono mt-0.5 block">
                        {tr('Émise le', 'صادر في')} {new Date(quit.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{quit.residentName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        CIN: {quit.residentCin || res?.cin || tr('Non renseigné', 'غير محدد')}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-semibold text-slate-800">
                        {tr('Lot', 'شقة')} {quit.apartmentNumber}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {quit.tantiemes || apt?.tantiemes || 0} / {buildingTantiemesBase}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">{quit.periodCovered}</span>
                      <span className="text-[11px] text-slate-400 block font-mono">
                        {tr('Date bancaire', 'تاريخ البنك')}: {quit.bankTransactionDate || '—'} · {tr('Comptabilisation', 'تاريخ القيد')}: {new Date(quit.postingDate || quit.paymentDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[11px] space-y-0.5 font-mono">
                        <div className="text-slate-600">{tr('Courant:', 'الجاري:')} {formatRecordedFund(quit, 'chargesCourantesAmount', tr)}</div>
                        <div className="text-emerald-700 font-medium">{tr('Réserve:', 'الاحتياط:')} {formatRecordedFund(quit, 'reserveFundAmount', tr)}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end whitespace-nowrap">
                      <span
                        className={`font-mono font-bold text-base block ${
                          quit.voidedAt ? 'text-rose-700 line-through' : 'text-teal-900'
                        }`}
                      >
                        {currencyFormatter.format(quit.amount)}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${quit.voidedAt ? 'text-rose-700 bg-rose-50' : 'text-emerald-700 bg-emerald-50'}`}>
                        {quit.voidedAt ? tr('Annulée', 'ملغى') : tr('Payé', 'مؤدى')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-slate-700 font-medium">
                        {PAYMENT_METHOD_LABELS[quit.paymentMethod] || quit.paymentMethod}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate max-w-[130px]" title={quit.referenceNumber || quit.bankName}>
                        {quit.bankName || tr('Banque', 'البنك')} {quit.referenceNumber ? `· ${quit.referenceNumber}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onPreviewQuittance(quit)}
                          className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200 font-medium transition-colors"
                        >
                          {tr('Aperçu', 'معاينة')}
                        </button>
                        <button
                          type="button"
                          onClick={() => generateQuittancePDF(quit, building, syndic, apt, res)}
                          className="px-2.5 py-1 text-xs bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded shadow-xs transition-colors flex items-center gap-1"
                        >
                          <QuittanceIcon />
                          <span>{tr('Télécharger PDF', 'تحميل PDF')}</span>
                        </button>
                        {reversibleSummary && (
                          <button
                            type="button"
                            onClick={() =>
                              onReversePayment({
                                paymentId: quit.paymentId!,
                                residentName: quit.residentName,
                                apartmentNumber: quit.apartmentNumber,
                                quittanceNumber: quit.quittanceNumber,
                                periodLabel: quit.periodCovered,
                                amount: reversibleSummary.totalAmount,
                              })
                            }
                            className="px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 rounded border border-rose-200 font-semibold transition-colors"
                          >
                            {tr('Annuler', 'إلغاء')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredQuittances.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    <QuittanceIcon />
                    <p className="font-semibold text-sm mt-2 text-slate-700">{tr('Aucun reçu enregistré', 'لم يتم العثور على أي وصل')}</p>
                    <p className="text-xs mt-1 text-slate-500">
                      {quittanceSearch
                        ? tr('Aucun reçu ne correspond à votre recherche.', 'لا يوجد وصل يطابق معايير البحث.')
                        : tr('Cliquez sur « Encaisser un paiement » lorsqu’un copropriétaire règle ses charges.', 'اضغط على «تحصيل دفعة» عندما يؤدي أحد الملاك المشتركين مساهمته.')}
                    </p>
                    <Button
                      onClick={onOpenNewPayment}
                      className="mt-3 text-xs bg-teal-700 hover:bg-teal-800"
                    >
                      {tr('Encaisser un paiement', 'تحصيل دفعة')}
                    </Button>
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

export default QuittancesTab;
