import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Charge, PaymentMethod, Syndic } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import InfoTip from '../../../common/InfoTip';
import { QuittanceIcon } from '../../../icons/IconComponents';
import { createQuittance } from '../../../../firebase/services';
import { generateQuittancePDF } from '../../../../services/pdfOnDemand';
import {
  getBuildingReserveRate,
  resolveChargeReserveRate,
  splitChargeReserveAndOperating,
} from '../../../../utils/security';
import { useI18n } from '../../../../hooks/useI18n';
import { useLegalFramework } from '../../../../hooks/useLegalFramework';
import { useToast } from '../../../common/Toast';
import { currencyFormatter, MOROCCAN_BANKS } from '../financeConstants';

export type RecordPaymentModalRequest =
  | { kind: 'new'; nonce: number }
  | {
      kind: 'charge';
      nonce: number;
      charge: Charge;
      prefill?: { amount?: number; reference?: string; bankDate?: string; remarks?: string };
    }
  | null;

interface RecordPaymentModalProps {
  building: Building;
  syndic?: Syndic;
  charges: Charge[];
  request: RecordPaymentModalRequest;
  onClose: () => void;
}

const RecordPaymentModal: React.FC<RecordPaymentModalProps> = ({
  building,
  syndic,
  charges,
  request,
  onClose,
}) => {
  const { tr, isAr } = useI18n();
  const { legal } = useLegalFramework();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [quittanceAccountingOpen, setQuittanceAccountingOpen] = useState(false);
  const [quittancePaymentId, setQuittancePaymentId] = useState(() => crypto.randomUUID());
  const [quittanceChargeId, setQuittanceChargeId] = useState('');
  const [quittanceApartmentId, setQuittanceApartmentId] = useState('');
  const [quittanceResidentId, setQuittanceResidentId] = useState('');
  const [quittanceResidentCin, setQuittanceResidentCin] = useState('');
  const [quittancePeriod, setQuittancePeriod] = useState(() =>
    new Date().toLocaleDateString(isAr ? 'ar-MA' : 'fr-FR', { month: 'long', year: 'numeric' }),
  );
  const [quittanceAmount, setQuittanceAmount] = useState('');
  const [quittanceReserveRatio, setQuittanceReserveRatio] = useState(() =>
    getBuildingReserveRate(building),
  );
  const [quittancePaymentMethod, setQuittancePaymentMethod] = useState<PaymentMethod>('virement');
  const [quittanceBankName, setQuittanceBankName] = useState(building.bankName || '');
  const [quittanceReference, setQuittanceReference] = useState('');
  const [quittancePaymentDate, setQuittancePaymentDate] = useState(
    () => new Date().toISOString().split('T')[0],
  );
  const [quittanceBankTransactionDate, setQuittanceBankTransactionDate] = useState('');
  const [quittancePostingDate, setQuittancePostingDate] = useState('');
  const [quittanceAdjustmentReason, setQuittanceAdjustmentReason] = useState('');
  const [quittanceRemarks, setQuittanceRemarks] = useState('');
  const [appliedNonce, setAppliedNonce] = useState(0);
  const lastSyncedQuittanceKeyRef = useRef<string>('');

  const isOpen = Boolean(request);

  useEffect(() => {
    if (!request) {
      lastSyncedQuittanceKeyRef.current = '';
      setAppliedNonce(0);
      return;
    }

    if (request.kind === 'charge') {
      const { charge, prefill } = request;
      const res = building.residents.find((r) => r.id === charge.residentId);
      const remaining =
        Math.max(0, Math.round((charge.amount - (charge.paidAmount ?? 0)) * 100)) / 100;
      const prefilledAmount =
        prefill?.amount !== undefined && prefill.amount > 0
          ? Math.min(remaining > 0 ? remaining : charge.amount, prefill.amount)
          : charge.status === 'paid'
          ? charge.paidAmount ?? charge.amount
          : remaining;

      setQuittancePaymentId(crypto.randomUUID());
      setQuittanceChargeId(charge.id);
      setQuittanceApartmentId(charge.apartmentId);
      setQuittanceResidentId(charge.residentId);
      setQuittanceResidentCin(res?.cin || '');
      setQuittancePeriod(charge.period || '');
      setQuittanceAmount(String(prefilledAmount));
      setQuittanceReserveRatio(resolveChargeReserveRate(building, charge));
      setQuittancePaymentMethod((charge.paymentMethod as PaymentMethod) || 'virement');
      setQuittanceBankName(building.bankName || '');
      setQuittanceReference(prefill?.reference || `VIR-${charge.id.slice(-6).toUpperCase()}`);
      const defaultDate =
        prefill?.bankDate ||
        (charge.paidAt ? charge.paidAt.split('T')[0] : new Date().toISOString().split('T')[0]);
      setQuittancePaymentDate(defaultDate);
      setQuittanceBankTransactionDate(defaultDate);
      setQuittancePostingDate('');
      setQuittanceAdjustmentReason('');
      setQuittanceRemarks(
        prefill?.remarks ||
          tr(
            'Cotisation copropriété - Récépissé libératoire',
            'مساهمة الملكية المشتركة - وصل إبراء الذمة',
          ),
      );
      lastSyncedQuittanceKeyRef.current = `${charge.id}:${prefilledAmount}`;
      setQuittanceAccountingOpen(false);
      setAppliedNonce(request.nonce);
    } else {
      const defaultApt = building.apartments[0];
      const defaultRes = defaultApt
        ? building.residents.find(
            (r) =>
              r.id === defaultApt.ownerId ||
              r.id === defaultApt.tenantId ||
              r.apartmentId === defaultApt.id,
          )
        : building.residents[0];
      const amt = defaultApt
        ? defaultApt.monthlyFees || building.monthlySyndicFees
        : building.monthlySyndicFees;

      setQuittancePaymentId(crypto.randomUUID());
      setQuittanceChargeId('');
      setQuittanceApartmentId(defaultApt?.id || '');
      setQuittanceResidentId(defaultRes?.id || '');
      setQuittanceResidentCin(defaultRes?.cin || '');
      setQuittancePeriod(
        new Date().toLocaleDateString(isAr ? 'ar-MA' : 'fr-FR', {
          month: 'long',
          year: 'numeric',
        }),
      );
      setQuittanceAmount(String(amt));
      setQuittanceReserveRatio(resolveChargeReserveRate(building));
      setQuittancePaymentMethod('virement');
      setQuittanceBankName(building.bankName || '');
      setQuittanceReference('');
      const today = new Date().toISOString().split('T')[0];
      setQuittancePaymentDate(today);
      setQuittanceBankTransactionDate(today);
      setQuittancePostingDate('');
      setQuittanceAdjustmentReason('');
      setQuittanceRemarks(
        tr(
          'Cotisation mensuelle copropriété - Récépissé libératoire',
          'المساهمة الشهرية للملكية المشتركة - وصل إبراء الذمة',
        ),
      );
      lastSyncedQuittanceKeyRef.current = '';
      setQuittanceAccountingOpen(false);
      setAppliedNonce(request.nonce);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  const receiptCharges = charges.filter(
    (charge) =>
      charge.apartmentId === quittanceApartmentId &&
      charge.residentId === quittanceResidentId &&
      Math.round(
        (charge.amount - (charge.paidAmount ?? (charge.status === 'paid' ? charge.amount : 0))) *
          100,
      ) > 0,
  );
  const receiptCharge = receiptCharges.find((charge) => charge.id === quittanceChargeId);
  const receiptRemaining = receiptCharge
    ? Math.max(0, Math.round((receiptCharge.amount - (receiptCharge.paidAmount ?? 0)) * 100)) / 100
    : 0;
  const receiptSelection = receiptCharge || receiptCharges[0];
  const receiptSelectionRemaining = receiptSelection
    ? Math.max(
        0,
        Math.round((receiptSelection.amount - (receiptSelection.paidAmount ?? 0)) * 100),
      ) / 100
    : 0;

  useEffect(() => {
    if (!request) {
      lastSyncedQuittanceKeyRef.current = '';
      return;
    }
    if (appliedNonce !== request.nonce) return;
    const selectionId = receiptSelection?.id || '';
    const syncKey = `${selectionId}:${receiptSelectionRemaining}`;
    if (lastSyncedQuittanceKeyRef.current === syncKey) return;
    const alreadyPrefilledSameCharge =
      selectionId !== '' && lastSyncedQuittanceKeyRef.current.startsWith(`${selectionId}:`);
    lastSyncedQuittanceKeyRef.current = syncKey;
    setQuittanceChargeId(selectionId);
    setQuittancePeriod(receiptSelection?.period || '');
    if (!alreadyPrefilledSameCharge) {
      setQuittanceAmount(receiptSelection ? String(receiptSelectionRemaining) : '');
    }
    setQuittanceReserveRatio(resolveChargeReserveRate(building, receiptSelection));
  }, [
    request,
    appliedNonce,
    receiptSelection?.id,
    receiptSelection?.period,
    receiptSelection?.chargeType,
    receiptSelection?.worksFundTarget,
    receiptSelectionRemaining,
    building,
  ]);

  const createQuittanceMutation = useMutation({
    mutationFn: async (payload: any) => createQuittance(payload),
    onSuccess: (newQuit) => {
      queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      onClose();

      const apt = building.apartments.find((a) => a.id === newQuit.apartmentId);
      const res = building.residents.find((r) => r.id === newQuit.residentId);
      generateQuittancePDF(newQuit, building, syndic, apt, res);
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const selectedApt = building.apartments.find((a) => a.id === quittanceApartmentId);
  const selectedRes = building.residents.find((r) => r.id === quittanceResidentId);
  const paidNum = parseFloat(quittanceAmount);

  return (
    <Modal
      isOpen={isOpen}
      busy={createQuittanceMutation.isPending}
      onSubmit={async () => {
        const numAmt = parseFloat(quittanceAmount);
        if (!Number.isFinite(numAmt) || numAmt <= 0) {
          throw new Error(tr('Veuillez saisir un montant de cotisation valide.', 'يرجى إدخال مبلغ مساهمة صحيح.'));
        }
        if (!receiptCharge || Math.round(numAmt * 100) > Math.round(receiptRemaining * 100)) {
          throw new Error(tr('Sélectionnez une charge et respectez son solde restant.', 'اختر مساهمة والتزم برصيدها المتبقي.'));
        }
        if (!quittanceApartmentId) {
          throw new Error(tr('Veuillez sélectionner un lot.', 'يرجى اختيار الشقة.'));
        }

        const apt = building.apartments.find((a) => a.id === quittanceApartmentId);
        const res = building.residents.find((r) => r.id === quittanceResidentId);

        if (!apt || !res) {
          throw new Error(tr('Sélectionnez un lot et son résident.', 'حدد الوحدة وساكنها.'));
        }
        if (!quittancePaymentDate || Number.isNaN(Date.parse(quittancePaymentDate))) {
          throw new Error(tr('Indiquez une date de paiement valide.', 'أدخل تاريخ أداء صالحاً.'));
        }
        if (quittanceBankTransactionDate && Number.isNaN(Date.parse(quittanceBankTransactionDate))) {
          setQuittanceAccountingOpen(true);
          throw new Error(tr('Indiquez une date bancaire valide.', 'أدخل تاريخاً بنكياً صالحاً.'));
        }
        if (quittancePostingDate && Number.isNaN(Date.parse(quittancePostingDate))) {
          setQuittanceAccountingOpen(true);
          throw new Error(tr('Indiquez une date de comptabilisation valide.', 'أدخل تاريخ قيد صالحاً.'));
        }
        const { reserveFundAmount: reserveAmt, chargesCourantesAmount: courantesAmt } =
          splitChargeReserveAndOperating(numAmt, quittanceReserveRatio);

        try {
          await createQuittanceMutation.mutateAsync({
            chargeId: quittanceChargeId,
            ...(quittanceReference.trim() ? {} : { paymentId: quittancePaymentId }),
            residentId: quittanceResidentId,
            residentName: res?.name || tr('Copropriétaire', 'مالك مشترك'),
            residentCin: quittanceResidentCin || res?.cin,
            apartmentId: quittanceApartmentId,
            apartmentNumber: apt?.number || 'Lot',
            tantiemes: apt?.tantiemes || 100,
            buildingId: building.id,
            buildingName: building.name,
            syndicId: building.syndicId,
            syndicName: syndic?.name || 'Syndic Mandataire',
            amount: numAmt,
            chargesCourantesAmount: courantesAmt,
            reserveFundAmount: reserveAmt,
            paymentMethod: quittancePaymentMethod,
            paymentDate: quittancePaymentDate,
            bankTransactionDate: quittanceBankTransactionDate || undefined,
            postingDate: quittancePostingDate || undefined,
            priorPeriodAdjustmentReason: quittanceAdjustmentReason.trim() || undefined,
            periodCovered: quittancePeriod,
            bankName: quittanceBankName,
            referenceNumber: quittanceReference || undefined,
            remarks: quittanceRemarks || undefined,
            addTransactionToLedger: true,
          });
        } catch (err: any) {
          if (/période|clôtur|comptabilis|ajustement/i.test(String(err?.message || ''))) {
            setQuittanceAccountingOpen(true);
          }
          throw err;
        }
      }}
      onClose={onClose}
      title={tr('Encaisser un paiement', 'تحصيل دفعة')}
      footer={
        <div className="flex justify-between items-center w-full gap-2">
          <span className="text-[11px] text-slate-500 hidden sm:inline-flex items-center gap-1">
            <span>{tr('Le reçu PDF officiel est téléchargé dès validation', 'يتم تحميل الوصل الرسمي PDF فور التأكيد')}</span>
            <InfoTip label={tr('Quittance officielle', 'وصل أداء رسمي')}>
              {tr(
                `Quittance libératoire conforme (${legal.citations.statuteShortFr} · ${legal.citations.reserveFundRefFr}), incluant la part du fonds de réserve.`,
                `وصل إبراء رسمي مطابق (${legal.citations.statuteShortAr} · ${legal.citations.reserveFundRefAr}) يتضمن حصة صندوق الاحتياط.`,
              )}
            </InfoTip>
          </span>
          <div className="flex items-center gap-2 ms-auto">
            <Button variant="secondary" onClick={onClose}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button
              type="submit"
              disabled={createQuittanceMutation.isPending || !receiptCharge}
              className="bg-teal-700 hover:bg-teal-800 text-white font-bold flex items-center gap-1.5"
            >
              <QuittanceIcon />
              <span>
                {createQuittanceMutation.isPending
                  ? tr('Enregistrement...', 'جاري التسجيل...')
                  : tr('Encaisser et générer le reçu', 'تحصيل وإصدار الوصل')}
              </span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pe-1">
        {/* STEP 1: QUI A PAYÉ ? */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {tr('1. Qui a payé ?', '1. من أدى؟')}
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Lot / Appartement', 'الوحدة / الشقة')} <span className="text-rose-500">*</span>
              </label>
              <select
                value={quittanceApartmentId}
                onChange={(e) => {
                  const aptId = e.target.value;
                  setQuittanceApartmentId(aptId);
                  const apt = building.apartments.find((a) => a.id === aptId);
                  const resident = apt
                    ? building.residents.find(
                        (r) =>
                          r.id === apt.ownerId ||
                          r.id === apt.tenantId ||
                          r.apartmentId === apt.id,
                      )
                    : undefined;
                  if (resident) {
                    setQuittanceResidentId(resident.id);
                    setQuittanceResidentCin(resident.cin || '');
                  } else {
                    setQuittanceResidentId('');
                    setQuittanceResidentCin('');
                  }
                  if (apt && !quittanceAmount) {
                    setQuittanceAmount(String(apt.monthlyFees ?? building.monthlySyndicFees ?? 0));
                  }
                }}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900"
              >
                <option value="">{tr('Sélectionnez un lot...', 'اختر شقة...')}</option>
                {building.apartments.map((a) => {
                  const res = building.residents.find(
                    (r) => r.id === a.ownerId || r.id === a.tenantId || r.apartmentId === a.id,
                  );
                  return (
                    <option key={a.id} value={a.id}>
                      {tr('Lot', 'شقة')} {a.number} — {res?.name || tr('Copropriétaire', 'مالك مشترك')}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Copropriétaire', 'المالك المشترك')}
              </label>
              <select
                value={quittanceResidentId}
                onChange={(e) => {
                  const rId = e.target.value;
                  setQuittanceResidentId(rId);
                  const r = building.residents.find((res) => res.id === rId);
                  if (r) {
                    setQuittanceResidentCin(r.cin || '');
                    if (r.apartmentId) setQuittanceApartmentId(r.apartmentId);
                  }
                }}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900"
              >
                {building.residents.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.isOwner ? `— ${tr('Copropriétaire', 'مالك')}` : `— ${tr('Locataire', 'مكتري')}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* STEP 2: POUR QUOI ? */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {tr('2. Pour quoi ?', '2. مقابل ماذا؟')}
          </h4>

          <div>
            <label htmlFor="quittance-charge" className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Charge à régler', 'المساهمة المستحقة')} <span className="text-rose-500">*</span>
            </label>
            <select
              id="quittance-charge"
              value={quittanceChargeId}
              onChange={(event) => setQuittanceChargeId(event.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
            >
              <option value="">{tr('Sélectionnez une charge...', 'اختر مساهمة...')}</option>
              {receiptCharges.map((charge) => (
                <option key={charge.id} value={charge.id}>
                  {charge.period} — {tr('Reste à payer :', 'الباقي للأداء:')}{' '}
                  {currencyFormatter.format(Math.max(0, charge.amount - (charge.paidAmount ?? 0)))}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-600 mt-1">
              {tr('Tout nouveau reçu confirme un paiement enregistré.', 'كل وصل جديد يؤكد دفعة مسجلة.')}
            </p>
          </div>
        </div>

        {/* STEP 3: COMBIEN ET COMMENT ? */}
        <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {tr('3. Combien et comment ?', '3. كم وكيف؟')}
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="quittance-amount" className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Montant encaissé (MAD)', 'المبلغ المحصل (درهم)')} <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                id="quittance-amount"
                min="0.01"
                max={receiptRemaining}
                step="0.01"
                value={quittanceAmount}
                onChange={(e) => setQuittanceAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold text-teal-900 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Mode de paiement', 'طريقة الدفع')}
              </label>
              <select
                value={quittancePaymentMethod}
                onChange={(e) => setQuittancePaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900"
              >
                <option value="virement">{tr('Virement bancaire', 'تحويل بنكي')}</option>
                <option value="cheque">{tr('Chèque', 'شيك')}</option>
                <option value="versement">{tr('Versement agence / GAB', 'إيداع بنكي')}</option>
                <option value="especes">{tr('Espèces', 'نقداً')}</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Réf. virement / N° chèque', 'مرجع التحويل / رقم الشيك')}
              </label>
              <input
                type="text"
                value={quittanceReference}
                onChange={(e) => setQuittanceReference(e.target.value)}
                placeholder="Ex: VIR-84920"
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Date du paiement', 'تاريخ الأداء')}
              </label>
              <input
                type="date"
                value={quittancePaymentDate}
                onChange={(e) => setQuittancePaymentDate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
              />
            </div>
          </div>
        </div>

        {/* LIVE SUMMARY SENTENCE */}
        {selectedApt && selectedRes && receiptCharge && paidNum > 0 && (() => {
          const remainingAfter = Math.max(
            0,
            Math.round((receiptRemaining - paidNum) * 100) / 100,
          );
          const split = splitChargeReserveAndOperating(paidNum, quittanceReserveRatio);
          const periodLabel = quittancePeriod || receiptCharge.period || '—';
          return (
            <div
              data-testid="quittance-live-summary"
              className="p-3 bg-teal-50 border border-teal-200 rounded-xl space-y-1.5 text-xs text-teal-950"
            >
              <p className="font-medium leading-relaxed">
                {tr(
                  `Lot ${selectedApt.number} — ${selectedRes.name} paie ${currencyFormatter.format(paidNum)} pour ${periodLabel}. Il restera ${currencyFormatter.format(remainingAfter)}. Un reçu PDF sera généré.`,
                  `الشقة ${selectedApt.number} — ${selectedRes.name} يؤدي ${currencyFormatter.format(paidNum)} عن فترة ${periodLabel}. سيتبقى ${currencyFormatter.format(remainingAfter)}. سيتم إصدار وصل PDF.`,
                )}
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-teal-800 font-mono">
                <span>
                  {tr('Compte courant :', 'الحساب الجاري:')}{' '}
                  {currencyFormatter.format(split.chargesCourantesAmount)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span>
                    {tr(`Fonds de réserve (${quittanceReserveRatio}%) :`, `صندوق الاحتياط (${quittanceReserveRatio}%):`)}{' '}
                    {currencyFormatter.format(split.reserveFundAmount)}
                  </span>
                  <InfoTip label={tr('Ventilation fonds de réserve', 'توزيع صندوق الاحتياط')}>
                    {tr(
                      `Répartition automatique prévue par le cadre réglementaire (${legal.citations.reserveFundRefFr}).`,
                      `توزيع تلقائي منصوص عليه قانوناً (${legal.citations.reserveFundRefAr}).`,
                    )}
                  </InfoTip>
                </span>
              </div>
            </div>
          );
        })()}

        {/* COLLAPSIBLE ACCOUNTING OPTIONS */}
        <details
          open={quittanceAccountingOpen}
          onToggle={(e) =>
            setQuittanceAccountingOpen((e.currentTarget as HTMLDetailsElement).open)
          }
          className="rounded-xl border border-slate-200 bg-slate-50/70"
        >
          <summary className="px-3.5 py-2.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
            {tr('Options comptables (optionnel : banque, CIN, date de comptabilisation)', 'خيارات محاسبية (اختياري: البنك، رقم البطاقة، تاريخ القيد)')}
          </summary>
          <div className="px-3.5 pb-3.5 pt-2 space-y-3 border-t border-slate-200/70">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Banque', 'البنك')}
                </label>
                <select
                  value={quittanceBankName}
                  onChange={(e) => setQuittanceBankName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900"
                >
                  {MOROCCAN_BANKS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('CIN sur le reçu', 'رقم البطاقة الوطنية')}
                </label>
                <input
                  type="text"
                  value={quittanceResidentCin}
                  onChange={(e) => setQuittanceResidentCin(e.target.value)}
                  placeholder="CIN"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Observations sur le reçu', 'ملاحظات على الوصل')}
                </label>
                <input
                  type="text"
                  value={quittanceRemarks}
                  onChange={(e) => setQuittanceRemarks(e.target.value)}
                  placeholder={tr('Note facultative', 'ملاحظة اختيارية')}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Date opération bancaire', 'تاريخ العملية البنكية')}
                </label>
                <input
                  type="date"
                  value={quittanceBankTransactionDate}
                  onChange={(e) => setQuittanceBankTransactionDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Date de comptabilisation (optionnel)', 'تاريخ القيد المحاسبي (اختياري)')}
                </label>
                <input
                  type="date"
                  value={quittancePostingDate}
                  onChange={(e) => setQuittancePostingDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Motif ajustement période', 'سبب تعديل الفترة')}
                </label>
                <input
                  type="text"
                  maxLength={1000}
                  value={quittanceAdjustmentReason}
                  onChange={(e) => setQuittanceAdjustmentReason(e.target.value)}
                  placeholder={tr('Si période antérieure / clôturée', 'إذا كانت فترة سابقة أو مغلقة')}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                />
              </div>
            </div>
          </div>
        </details>
      </div>
    </Modal>
  );
};

export default RecordPaymentModal;
