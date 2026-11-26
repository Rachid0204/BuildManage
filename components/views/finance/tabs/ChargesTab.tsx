import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Building, Charge, Invoice, Quittance, Syndic } from '../../../../types';
import Card from '../../../common/Card';
import Button from '../../../common/Button';
import { QuittanceIcon } from '../../../icons/IconComponents';
import {
  createInvoiceForResident,
  generateQuittanceForCharge,
  getInvoicesForBuilding,
} from '../../../../firebase/services';
import {
  generateInvoicePDF,
  generateQuittancePDF,
} from '../../../../services/pdfOnDemand';
import { isChargeEffectivelyOverdue } from '../../../../shared/moroccoDate';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import { currencyFormatter } from '../financeConstants';

interface ChargesTabProps {
  building: Building;
  syndic?: Syndic;
  charges: Charge[];
  invoices: Invoice[];
  quittances: Quittance[];
  onOpenChargeGeneration: () => void;
  onOpenNewPayment: () => void;
  onOpenPaymentForCharge: (charge: Charge) => void;
  onOpenPayInvoice: (invoice: Invoice, remaining: number) => void;
  onOpenVoidInvoice: (invoice: Invoice) => void;
}

const ChargesTab: React.FC<ChargesTabProps> = ({
  building,
  syndic,
  charges,
  invoices,
  quittances,
  onOpenChargeGeneration,
  onOpenNewPayment,
  onOpenPaymentForCharge,
  onOpenPayInvoice,
  onOpenVoidInvoice,
}) => {
  const { tr, isAr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [chargesSubTab, setChargesSubTab] = useState<'charges' | 'invoices'>('charges');
  const [directGeneratingChargeId, setDirectGeneratingChargeId] = useState<string | null>(null);

  const buildingTantiemesBase = building.totalTantiemes || 1000;

  const handleDirectQuittance = async (charge: Charge) => {
    try {
      setDirectGeneratingChargeId(charge.id);
      const existing = quittances.find((q) => q.chargeId === charge.id && !q.voidedAt);
      const apt = building.apartments.find((a) => a.id === charge.apartmentId);
      const res = building.residents.find((r) => r.id === charge.residentId);

      if (existing) {
        generateQuittancePDF(existing, building, syndic, apt, res);
      } else {
        const generated = await generateQuittanceForCharge(charge.id, building.id);
        queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
        generateQuittancePDF(generated, building, syndic, apt, res);
      }
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setDirectGeneratingChargeId(null);
    }
  };

  const handleDownloadOrCreateInvoicePdf = async (charge: Charge) => {
    const res = building.residents.find((r) => r.id === charge.residentId);
    if (!res) return;
    try {
      const buildingInvoices = await getInvoicesForBuilding(building.id);
      const invoice =
        buildingInvoices.find(
          (i) =>
            i.status !== 'cancelled' &&
            (i.id === charge.invoiceId || i.chargeIds.includes(charge.id)),
        ) || (await createInvoiceForResident(charge.residentId, building.id, building.syndicId));
      queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
      generateInvoicePDF(invoice, building, res, syndic);
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  return (
    <Card className="overflow-hidden border border-slate-200">
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
        <div>
          <h3 className="font-semibold text-slate-800 text-sm">
            {tr('Charges appelées aux copropriétaires', 'المساهمات المطلوبة من الملاك المشتركين')}
          </h3>
          <p className="text-xs text-slate-500">
            {tr(
              "Ce que chaque lot doit payer par période, avec l'état du paiement.",
              'ما يجب على كل شقة أداؤه حسب الفترة مع حالة الدفع.',
            )}
          </p>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mt-2">
            <button
              type="button"
              onClick={() => setChargesSubTab('charges')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                chargesSubTab === 'charges'
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tr('Par lot', 'حسب الشقة')} ({charges.length})
            </button>
            <button
              type="button"
              onClick={() => setChargesSubTab('invoices')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                chargesSubTab === 'invoices'
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tr('Avis groupés', 'الإشعارات المجمعة')} ({invoices.length})
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            onClick={onOpenChargeGeneration}
            className="text-xs"
          >
            {tr('Appeler les charges', 'إصدار المساهمات')}
          </Button>
          <Button
            onClick={onOpenNewPayment}
            className="text-xs bg-teal-700 hover:bg-teal-800 flex items-center gap-1.5"
          >
            <QuittanceIcon />
            <span>{tr('Encaisser un paiement', 'تحصيل دفعة')}</span>
          </Button>
        </div>
      </div>

      {chargesSubTab === 'charges' ? (
        <>
          {/* Mobile Cards (< md) */}
          <div className="md:hidden divide-y divide-slate-200 bg-white">
            {charges.map((charge) => {
              const apt = building.apartments.find((a) => a.id === charge.apartmentId);
              const res = building.residents.find((r) => r.id === charge.residentId);
              const paidCents = Math.round((charge.paidAmount || 0) * 100);
              const amountCents = Math.round((charge.amount || 0) * 100);
              const remainingCents = Math.max(0, amountCents - paidCents);
              const isPartial = charge.status !== 'paid' && paidCents > 0 && remainingCents > 0;
              const effectivelyOverdue = isChargeEffectivelyOverdue(charge);
              const activeChargeQuittances = quittances.filter(
                (q) => q.chargeId === charge.id && !q.voidedAt,
              );
              return (
                <div key={`charge-card-${charge.id}`} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-sm text-teal-800">
                          {apt?.number || 'Lot'}
                        </span>
                        <span className="font-semibold text-sm text-slate-900 truncate">
                          {res?.name || tr('Inconnu', 'غير معروف')}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {charge.period || '—'} · {tr('Éch.', 'استحقاق')}{' '}
                        <span className="font-mono">
                          {new Date(charge.dueDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                        </span>
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="font-mono font-bold text-sm text-slate-900">
                        {currencyFormatter.format(charge.amount)}
                      </div>
                      <span
                        className={`inline-block mt-0.5 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          charge.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : isPartial
                            ? effectivelyOverdue
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-sky-50 text-sky-700'
                            : effectivelyOverdue
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {charge.status === 'paid'
                          ? tr('Payé', 'مؤدى')
                          : isPartial
                          ? effectivelyOverdue
                            ? tr('Partiel (en retard)', 'جزئي (متأخر)')
                            : tr('Partiellement payée', 'مؤدى جزئياً')
                          : effectivelyOverdue
                          ? tr('En retard', 'متأخر')
                          : tr('En attente', 'في الانتظار')}
                      </span>
                    </div>
                  </div>
                  {isPartial && (
                    <div className="text-[11px] font-mono text-sky-700 bg-sky-50/70 rounded px-2.5 py-1">
                      {tr('Réglé:', 'المؤدى:')} {currencyFormatter.format(paidCents / 100)} ·{' '}
                      {tr('Reste:', 'الباقي:')} {currencyFormatter.format(remainingCents / 100)}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {charge.status === 'paid' ? (
                      <button
                        type="button"
                        onClick={() => handleDirectQuittance(charge)}
                        disabled={directGeneratingChargeId === charge.id}
                        className="min-h-[36px] px-3 py-1.5 text-xs bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold rounded-lg border border-teal-200 flex items-center gap-1"
                      >
                        <QuittanceIcon />
                        <span>
                          {directGeneratingChargeId === charge.id
                            ? tr('Génération...', 'جاري الإصدار...')
                            : tr('Quittance PDF', 'وصل PDF')}
                        </span>
                      </button>
                    ) : (
                      <>
                        {activeChargeQuittances.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              generateQuittancePDF(activeChargeQuittances[0], building, syndic, apt, res)
                            }
                            className="min-h-[36px] px-2.5 py-1.5 text-xs bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold rounded-lg border border-teal-200 flex items-center gap-1"
                          >
                            <QuittanceIcon />
                            <span>{tr('Quittance PDF', 'وصل PDF')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenPaymentForCharge(charge)}
                          className="min-h-[36px] px-3 py-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold rounded-lg border border-emerald-200"
                        >
                          {tr('Encaisser', 'تحصيل')}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleDownloadOrCreateInvoicePdf(charge)}
                      className="min-h-[36px] px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 font-semibold"
                    >
                      {tr('Avis PDF', 'إشعار PDF')}
                    </button>
                  </div>
                </div>
              );
            })}
            {charges.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-slate-500 space-y-2">
                <p className="font-semibold text-sm text-slate-700">
                  {tr('Aucune charge appelée pour le moment', 'لم تصدر أي مساهمات بعد')}
                </p>
                <p>
                  {tr(
                    'Cliquez sur « Appeler les charges du mois » pour créer ce que chaque lot doit payer.',
                    'اضغط على «إصدار مساهمات الشهر» لإنشاء المبالغ المستحقة لكل شقة.',
                  )}
                </p>
                <Button onClick={onOpenChargeGeneration} className="mt-1 text-xs">
                  {tr('Appeler les charges du mois', 'إصدار مساهمات الشهر')}
                </Button>
              </div>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-500 text-start font-medium">
                <tr>
                  <th className="px-4 py-2.5 text-start">{tr('Lot / Apt', 'الشقة / الوحدة')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Copropriétaire', 'المالك المشترك')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Période', 'الفترة')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Échéance', 'تاريخ الاستحقاق')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Statut', 'الحالة')}</th>
                  <th className="px-4 py-2.5 text-end">{tr('Cotisation', 'المساهمة')}</th>
                  <th className="px-4 py-2.5 text-end">{tr('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {charges.map((charge) => {
                  const apt = building.apartments.find((a) => a.id === charge.apartmentId);
                  const res = building.residents.find((r) => r.id === charge.residentId);
                  const paidCents = Math.round((charge.paidAmount || 0) * 100);
                  const amountCents = Math.round((charge.amount || 0) * 100);
                  const remainingCents = Math.max(0, amountCents - paidCents);
                  const isPartial = charge.status !== 'paid' && paidCents > 0 && remainingCents > 0;
                  const effectivelyOverdue = isChargeEffectivelyOverdue(charge);
                  const activeChargeQuittances = quittances.filter(
                    (q) => q.chargeId === charge.id && !q.voidedAt,
                  );

                  return (
                    <tr key={charge.id} className="hover:bg-slate-50 transition-colors h-11">
                      <td className="px-4 py-2 font-mono font-bold text-teal-800">
                        {apt?.number || 'Lot'}
                        {apt?.tantiemes !== undefined && (
                          <span className="ms-1.5 text-[11px] font-normal text-slate-400">
                            ({apt.tantiemes}/{buildingTantiemesBase})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900">{res?.name || tr('Inconnu', 'غير معروف')}</td>
                      <td className="px-4 py-2 text-slate-600">{charge.period || '—'}</td>
                      <td className="px-4 py-2 text-slate-500 font-mono text-xs">
                        {new Date(charge.dueDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            charge.status === 'paid'
                              ? 'bg-emerald-50 text-emerald-700'
                              : isPartial
                              ? effectivelyOverdue
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-sky-50 text-sky-700'
                              : effectivelyOverdue
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {charge.status === 'paid'
                            ? tr('Payé', 'مؤدى')
                            : isPartial
                            ? effectivelyOverdue
                              ? tr('Partiel (en retard)', 'جزئي (متأخر)')
                              : tr('Partiellement payée', 'مؤدى جزئياً')
                            : effectivelyOverdue
                            ? tr('En retard', 'متأخر')
                            : tr('En attente', 'في الانتظار')}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-end font-mono font-bold text-slate-900">
                        <div>{currencyFormatter.format(charge.amount)}</div>
                        {isPartial && (
                          <div className="text-[10px] font-normal text-sky-700">
                            {tr('Réglé:', 'المؤدى:')} {currencyFormatter.format(paidCents / 100)} ·{' '}
                            {tr('Reste:', 'الباقي:')} {currencyFormatter.format(remainingCents / 100)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-end">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {charge.status === 'paid' ? (
                            <button
                              onClick={() => handleDirectQuittance(charge)}
                              disabled={directGeneratingChargeId === charge.id}
                              className="px-2.5 py-1 text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded transition-colors flex items-center gap-1 shrink-0"
                            >
                              <QuittanceIcon />
                              <span>
                                {directGeneratingChargeId === charge.id
                                  ? tr('Génération...', 'جاري الإصدار...')
                                  : tr('Quittance PDF', 'وصل PDF')}
                              </span>
                            </button>
                          ) : (
                            <>
                              {activeChargeQuittances.length > 0 && (
                                <button
                                  onClick={() => {
                                    generateQuittancePDF(
                                      activeChargeQuittances[0],
                                      building,
                                      syndic,
                                      apt,
                                      res,
                                    );
                                  }}
                                  className="px-2 py-0.5 text-[11px] bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded transition-colors flex items-center gap-1 shrink-0"
                                >
                                  <QuittanceIcon />
                                  <span>{tr('Quittance PDF', 'وصل PDF')}</span>
                                </button>
                              )}
                              <button
                                onClick={() => onOpenPaymentForCharge(charge)}
                                className="px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded border border-emerald-200 shrink-0"
                              >
                                {tr('Encaisser', 'تحصيل')}
                              </button>
                            </>
                          )}

                          <button
                            onClick={() => void handleDownloadOrCreateInvoicePdf(charge)}
                            className="text-[11px] text-slate-500 hover:text-slate-800 underline px-1"
                          >
                            {tr('Avis', 'إشعار')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {charges.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-xs text-slate-500 space-y-2">
                      <p className="font-semibold text-sm text-slate-700">
                        {tr('Aucune charge appelée pour le moment', 'لم تصدر أي مساهمات بعد')}
                      </p>
                      <p>
                        {tr(
                          'Cliquez sur « Appeler les charges du mois » pour créer ce que chaque lot doit payer.',
                          'اضغط على «إصدار مساهمات الشهر» لإنشاء المبالغ المستحقة لكل شقة.',
                        )}
                      </p>
                      <Button onClick={onOpenChargeGeneration} className="mt-2 text-xs">
                        {tr('Appeler les charges du mois', 'إصدار مساهمات الشهر')}
                      </Button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          {/* Mobile Cards (< md) */}
          <div className="md:hidden divide-y divide-slate-200 bg-white">
            {invoices.map((inv) => {
              const res = building.residents.find((r) => r.id === inv.residentId);
              const remaining =
                Math.max(
                  0,
                  Math.round(((inv.totalAmount || 0) - (inv.paidAmount || 0)) * 100),
                ) / 100;
              const isVoided = inv.status === 'cancelled' || Boolean(inv.voidedAt);
              const isPartialInv = !isVoided && inv.status !== 'paid' && (inv.paidAmount || 0) > 0 && remaining > 0;
              const canPay = !isVoided && inv.status !== 'paid' && remaining > 0;
              const canVoid = !isVoided && (inv.paidAmount || 0) === 0;
              return (
                <div
                  key={`inv-card-${inv.id}`}
                  className={`p-3.5 space-y-2.5 ${isVoided ? 'opacity-60 bg-slate-50/70' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm text-teal-800">{inv.invoiceNumber}</div>
                      <div className="font-semibold text-sm text-slate-900 truncate">
                        {res?.name || inv.issuedTo?.name || tr('Copropriétaire', 'مالك مشترك')}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {inv.chargeIds.length} {tr('charge(s)', 'مساهمة(ات)')} · {tr('Éch.:', 'الاستحقاق:')}{' '}
                        {new Date(inv.dueDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className={`font-mono font-bold text-sm ${isVoided ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                        {currencyFormatter.format(inv.totalAmount)}
                      </div>
                      <span
                        className={`inline-block mt-0.5 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          inv.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : isVoided
                            ? 'bg-slate-200 text-slate-600'
                            : inv.status === 'overdue'
                            ? 'bg-rose-50 text-rose-700'
                            : isPartialInv
                            ? 'bg-sky-50 text-sky-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {inv.status === 'paid'
                          ? tr('Soldée', 'مؤداة')
                          : isVoided
                          ? tr('Annulée', 'ملغاة')
                          : inv.status === 'overdue'
                          ? tr('En retard', 'متأخرة')
                          : isPartialInv
                          ? tr('Partielle', 'جزئية')
                          : tr('Émise', 'صادرة')}
                      </span>
                    </div>
                  </div>
                  {!isVoided && remaining > 0 && remaining < inv.totalAmount && (
                    <div className="text-[11px] font-mono text-sky-700 bg-sky-50/70 rounded px-2.5 py-1">
                      {tr('Reste:', 'الباقي:')} {currencyFormatter.format(remaining)}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {res && (
                      <button
                        type="button"
                        onClick={() => generateInvoicePDF(inv, building, res, syndic)}
                        className="min-h-[36px] px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                      >
                        PDF
                      </button>
                    )}
                    {canPay && (
                      <button
                        type="button"
                        onClick={() => onOpenPayInvoice(inv, remaining)}
                        className="min-h-[36px] px-3 py-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded-lg border border-emerald-200"
                      >
                        {tr('Encaisser', 'تحصيل')}
                      </button>
                    )}
                    {canVoid && (
                      <button
                        type="button"
                        onClick={() => onOpenVoidInvoice(inv)}
                        className="min-h-[36px] px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 font-semibold rounded-lg border border-rose-200"
                      >
                        {tr('Annuler', 'إلغاء')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {invoices.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                {tr(
                  'Aucune facture / avis groupé émis. Cliquez sur « Avis » sur une charge pour générer une facture consolidée.',
                  'لم تصدر أي فاتورة أو إشعار مجمع بعد. اضغط على «إشعار» بجانب أي مساهمة لإصدار فاتورة مجمعة.',
                )}
              </div>
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-500 text-start font-medium">
                <tr>
                  <th className="px-4 py-2.5 text-start">{tr('N° Facture / Avis', 'رقم الفاتورة / الإشعار')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Copropriétaire', 'المالك المشترك')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Émission & Échéance', 'الإصدار والاستحقاق')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Statut', 'الحالة')}</th>
                  <th className="px-4 py-2.5 text-end">{tr('Total / Reste', 'المجموع / الباقي')}</th>
                  <th className="px-4 py-2.5 text-end">{tr('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {invoices.map((inv) => {
                  const res = building.residents.find((r) => r.id === inv.residentId);
                  const remaining =
                    Math.max(
                      0,
                      Math.round(((inv.totalAmount || 0) - (inv.paidAmount || 0)) * 100),
                    ) / 100;
                  const isVoided = inv.status === 'cancelled' || Boolean(inv.voidedAt);
                  const isPartialInv = !isVoided && inv.status !== 'paid' && (inv.paidAmount || 0) > 0 && remaining > 0;
                  const canPay = !isVoided && inv.status !== 'paid' && remaining > 0;
                  const canVoid = !isVoided && (inv.paidAmount || 0) === 0;
                  return (
                    <tr
                      key={inv.id}
                      className={`hover:bg-slate-50 transition-colors ${isVoided ? 'opacity-60 bg-slate-50/70' : ''}`}
                    >
                      <td className="px-4 py-2.5 font-mono font-bold text-teal-800">
                        <div>{inv.invoiceNumber}</div>
                        <div className="text-[10px] font-normal text-slate-400">
                          {inv.chargeIds.length} {tr('charge(s)', 'مساهمة(ات)')}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {res?.name || inv.issuedTo?.name || tr('Copropriétaire', 'مالك مشترك')}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">
                        <div>{new Date(inv.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}</div>
                        <div className="text-[10px] text-slate-400">
                          {tr('Éch.:', 'الاستحقاق:')} {new Date(inv.dueDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            inv.status === 'paid'
                              ? 'bg-emerald-50 text-emerald-700'
                              : isVoided
                              ? 'bg-slate-200 text-slate-600'
                              : inv.status === 'overdue'
                              ? 'bg-rose-50 text-rose-700'
                              : isPartialInv
                              ? 'bg-sky-50 text-sky-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {inv.status === 'paid'
                            ? tr('Soldée', 'مؤداة')
                            : isVoided
                            ? tr('Annulée', 'ملغاة')
                            : inv.status === 'overdue'
                            ? tr('En retard', 'متأخرة')
                            : isPartialInv
                            ? tr('Partielle', 'جزئية')
                            : tr('Émise', 'صادرة')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono">
                        <div className={`font-bold ${isVoided ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                          {currencyFormatter.format(inv.totalAmount)}
                        </div>
                        {!isVoided && remaining > 0 && remaining < inv.totalAmount && (
                          <div className="text-[10px] text-sky-700">
                            {tr('Reste:', 'الباقي:')} {currencyFormatter.format(remaining)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-end whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {res && (
                            <button
                              type="button"
                              onClick={() => generateInvoicePDF(inv, building, res, syndic)}
                              className="px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded"
                            >
                              PDF
                            </button>
                          )}
                          {canPay && (
                            <button
                              type="button"
                              onClick={() => onOpenPayInvoice(inv, remaining)}
                              className="px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded border border-emerald-200"
                            >
                              {tr('Encaisser', 'تحصيل')}
                            </button>
                          )}
                          {canVoid && (
                            <button
                              type="button"
                              onClick={() => onOpenVoidInvoice(inv)}
                              className="px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 font-semibold rounded border border-rose-200"
                            >
                              {tr('Annuler', 'إلغاء')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">
                      {tr(
                        'Aucune facture / avis groupé émis. Cliquez sur « Avis » sur une charge pour générer une facture consolidée.',
                        'لم تصدر أي فاتورة أو إشعار مجمع بعد. اضغط على «إشعار» بجانب أي مساهمة لإصدار فاتورة مجمعة.',
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
};

export default ChargesTab;
