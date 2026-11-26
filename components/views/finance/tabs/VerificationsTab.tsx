import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Charge, PaymentProof } from '../../../../types';
import Card from '../../../common/Card';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import {
  approvePaymentProofsBatch,
  openAuthenticatedUpload,
  reconcileBankStatementCSV,
  reviewPaymentProof,
  type UnmatchedBankCsvRow,
} from '../../../../firebase/services';
import { resolveAssetUrl } from '../../../../utils/apiBase';
import { isNativeApp } from '../../../../utils/nativeBridge';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import { parseBankCsvRows } from '../bankCsv';
import { currencyFormatter } from '../financeConstants';

interface VerificationsTabProps {
  building: Building;
  charges: Charge[];
  paymentProofs: PaymentProof[];
  pendingProofsCount: number;
  unmatchedCsvRows: UnmatchedBankCsvRow[];
  onChangeUnmatchedCsvRows: (rows: UnmatchedBankCsvRow[]) => void;
  onOpenPaymentForCharge: (
    charge: Charge,
    prefill?: { amount?: number; reference?: string; bankDate?: string; remarks?: string },
  ) => void;
}

const VerificationsTab: React.FC<VerificationsTabProps> = ({
  building,
  charges,
  paymentProofs,
  pendingProofsCount,
  unmatchedCsvRows,
  onChangeUnmatchedCsvRows,
  onOpenPaymentForCharge,
}) => {
  const { tr, isAr } = useI18n();
  const { showToast, confirmAction } = useToast();
  const queryClient = useQueryClient();

  const [approvingBatch, setApprovingBatch] = useState(false);
  const [rejectingProofId, setRejectingProofId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [bankPostingDate, setBankPostingDate] = useState('');
  const [bankAdjustmentReason, setBankAdjustmentReason] = useState('');

  const bankPostingOptions = {
    postingDate: bankPostingDate || undefined,
    priorPeriodAdjustmentReason: bankAdjustmentReason || undefined,
  };

  const reviewProofMutation = useMutation({
    mutationFn: (data: { proofId: string; decision: 'approve' | 'reject'; reason?: string }) =>
      reviewPaymentProof(data.proofId, data.decision, data.reason, bankPostingOptions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  return (
    <>
      <Card className="overflow-hidden border border-slate-200">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-slate-800 text-sm">
              {tr('Virements envoyés par les copropriétaires', 'التحويلات المرسلة من الملاك المشتركين')}
            </h3>
            <p className="text-xs text-slate-500">
              {tr(
                'Comparez la preuve avec votre relevé bancaire puis validez : le reçu PDF est créé automatiquement.',
                'قارن إثبات التحويل مع كشفك البنكي ثم صادق عليه ليتم إنشاء الوصل تلقائياً.',
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors">
              <span>📥 {tr('Import Relevé CSV Bancaire', 'استيراد كشف بنكي CSV')}</span>
              <input
                type="file"
                accept=".csv,.txt"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    const parsedRows = parseBankCsvRows(text);
                    if (!parsedRows.some((r) => r.amount > 0)) {
                      throw new Error(
                        tr(
                          'Aucune ligne de crédit bancaire valide détectée dans le CSV.',
                          'لم يتم العثور على أي سطر دائن بنكي صالح في ملف CSV.',
                        ),
                      );
                    }
                    const preview = await reconcileBankStatementCSV(building.id, parsedRows, {
                      ...bankPostingOptions,
                      preview: true,
                    });
                    const dates = (preview.preview || []).map(
                      (row) =>
                        `${row.amount} MAD — ${tr('Date bancaire', 'تاريخ البنك')}: ${row.bankTransactionDate} — ${tr('Comptabilisation', 'تاريخ القيد')}: ${row.postingDate}`,
                    );
                    const confirmed = await confirmAction({
                      title: tr('Confirmer le rapprochement bancaire', 'تأكيد المطابقة البنكية'),
                      message: [tr('Confirmer le rapprochement', 'تأكيد المطابقة'), ...dates].join('\n'),
                      confirmLabel: tr('Confirmer', 'تأكيد'),
                    });
                    if (!confirmed) return;
                    const res = await reconcileBankStatementCSV(building.id, parsedRows, bankPostingOptions);
                    onChangeUnmatchedCsvRows(res.unmatchedRows || []);
                    await queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['syndics'] });
                    await queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
                    const unmatchedCount = (res.unmatchedRows || []).length;
                    showToast(
                      unmatchedCount > 0
                        ? tr(
                            `Rapprochement bancaire terminé : ${res.matchedCount} virement(s) lettré(s) (${res.totalReconciledMad} MAD), ${unmatchedCount} ligne(s) à rapprocher manuellement.`,
                            `تمت المطابقة البنكية: ${res.matchedCount} تحويلات مطابقة (${res.totalReconciledMad} درهم)، و${unmatchedCount} سطر(اً) يتطلب مطابقة يدوية.`,
                          )
                        : tr(
                            `Rapprochement bancaire terminé : ${res.matchedCount} virement(s) lettré(s) (${res.totalReconciledMad} MAD).`,
                            `تمت المطابقة البنكية: ${res.matchedCount} تحويلات مطابقة (${res.totalReconciledMad} درهم).`,
                          ),
                      res.matchedCount > 0 ? 'success' : 'info',
                    );
                  } catch (err: any) {
                    showToast(err?.message || 'Erreur lors de la lecture du CSV', 'error');
                  } finally {
                    e.target.value = '';
                  }
                }}
              />
            </label>
            {pendingProofsCount > 0 && (
              <Button
                disabled={approvingBatch}
                onClick={async () => {
                  setApprovingBatch(true);
                  try {
                    const res = await approvePaymentProofsBatch(building.id, undefined, bankPostingOptions);
                    await queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['syndics'] });
                    await queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
                    const skippedSuffixFr = res.skippedCount
                      ? ` (${res.skippedCount} ignoré(s) : montant non exact ou charge déjà soldée)`
                      : '';
                    const skippedSuffixAr = res.skippedCount
                      ? ` (تم تجاوز ${res.skippedCount} لعدم تطابق المبلغ أو تسديد المساهمة مسبقاً)`
                      : '';
                    showToast(
                      tr(
                        `${res.approvedCount} justificatif(s) conforme(s) validé(s) (${res.totalAmountMad} MAD)${skippedSuffixFr}.`,
                        `تمت المصادقة على ${res.approvedCount} إثباتات مطابقة (${res.totalAmountMad} درهم)${skippedSuffixAr}.`,
                      ),
                      res.approvedCount > 0 ? 'success' : 'info',
                    );
                  } catch (error: any) {
                    showToast(error.message, 'error');
                  } finally {
                    setApprovingBatch(false);
                  }
                }}
                className="text-xs bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                ✓ {tr('Valider les virements conformes (1-clic)', 'تأكيد التحويلات المطابقة (نقرة واحدة)')}
              </Button>
            )}
          </div>
        </div>

        <details className="p-4 border-b border-slate-200">
          <summary>{tr('Ajustement explicite de période comptable (optionnel)', 'تعديل صريح للفترة المحاسبية (اختياري)')}</summary>
          <p className="text-xs text-slate-600 my-2">
            {tr(
              'Par défaut, la date bancaire est utilisée. Pour une période clôturée, choisissez une date ouverte et justifiez l’ajustement. Ces valeurs s’appliquent aux validations individuelles et au CSV.',
              'يُستخدم تاريخ البنك افتراضياً. للفترة المغلقة اختر تاريخاً في فترة مفتوحة مع ذكر السبب. تنطبق القيم على الموافقات الفردية وملف CSV.',
            )}
          </p>
          <label>
            {tr('Date de comptabilisation', 'تاريخ القيد')}
            <input
              type="date"
              value={bankPostingDate}
              onChange={(e) => setBankPostingDate(e.target.value)}
              className="border rounded p-2 mx-2"
            />
          </label>
          <label>
            {tr('Motif de l’ajustement', 'سبب التعديل')}
            <input
              value={bankAdjustmentReason}
              maxLength={1000}
              onChange={(e) => setBankAdjustmentReason(e.target.value)}
              className="border rounded p-2 mx-2"
            />
          </label>
        </details>

        {unmatchedCsvRows.length > 0 && (
          <div className="p-4 bg-amber-50/70 border-b border-amber-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                  {tr(
                    `Lignes CSV non lettrées automatiquement (${unmatchedCsvRows.length})`,
                    `أسطر CSV غير مطابقة تلقائياً (${unmatchedCsvRows.length})`,
                  )}
                </h4>
                <p className="text-[11px] text-amber-800">
                  {tr(
                    'Cliquez sur une charge candidate pour pré-remplir la quittance avec les informations du relevé.',
                    'انقر على مساهمة مرشحة لتعبئة الوصل تلقائياً ببيانات الكشف البنكي.',
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onChangeUnmatchedCsvRows([])}
                className="text-xs font-semibold text-amber-900 hover:underline"
              >
                {tr('Fermer', 'إغلاق')}
              </button>
            </div>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {unmatchedCsvRows.map((row, rowIdx) => {
                const reasonLabel =
                  row.reason === 'duplicate'
                    ? tr('Déjà importé', 'تم استيراده مسبقاً')
                    : row.reason === 'ambiguous'
                    ? tr('Ambiguë (plusieurs lots)', 'غائم (عدة شقق)')
                    : row.reason === 'non_positive'
                    ? tr('Montant ≤ 0', 'مبلغ ≤ 0')
                    : tr('Aucune correspondance exacte', 'لا يوجد تطابق دقيق');
                return (
                  <div
                    key={`${rowIdx}-${row.reference || row.label}`}
                    className="p-2.5 bg-white rounded-lg border border-amber-200/80 text-xs space-y-1.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-500">{row.date}</span>
                        <span className="font-semibold text-slate-900">{row.label}</span>
                        {row.reference && (
                          <span className="font-mono text-[11px] text-slate-500">
                            ({row.reference})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">
                          {currencyFormatter.format(row.amount)}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                          {reasonLabel}
                        </span>
                      </div>
                    </div>
                    {row.candidates && row.candidates.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] text-slate-500">
                          {tr('Affecter à :', 'توجيه إلى:')}
                        </span>
                        {row.candidates.map((cand, candIdx) => {
                          const matchedCharge = cand.chargeId
                            ? charges.find((c) => c.id === cand.chargeId)
                            : undefined;
                          if (!matchedCharge) return null;
                          return (
                            <button
                              key={cand.chargeId || cand.invoiceId || candIdx}
                              type="button"
                              onClick={() =>
                                onOpenPaymentForCharge(matchedCharge, {
                                  amount: row.amount,
                                  reference: row.reference || undefined,
                                  bankDate: /^\d{4}-\d{2}-\d{2}/.test(row.date)
                                    ? row.date.slice(0, 10)
                                    : undefined,
                                  remarks: `Rapprochement relevé CSV : ${row.label}`,
                                })
                              }
                              className="px-2 py-0.5 rounded border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-900 font-medium text-[11px]"
                            >
                              {tr('Lot', 'شقة')} {cand.apartmentNumber} · {cand.residentName} (
                              {matchedCharge.period || cand.invoiceNumber || '—'} —{' '}
                              {currencyFormatter.format(cand.remainingAmount)})
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="divide-y divide-slate-100">
          {paymentProofs.map((proof) => (
            <div key={proof.id} className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-sm">{proof.residentName}</span>
                  <span className="font-mono text-xs font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded">
                    {tr('Lot', 'شقة')} {proof.apartmentNumber}
                  </span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                      proof.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700'
                        : proof.status === 'rejected'
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {proof.status === 'pending'
                      ? tr('En attente de vérification', 'في انتظار التحقق')
                      : proof.status === 'approved'
                      ? tr('Validé', 'مصادق عليه')
                      : tr('Rejeté', 'مرفوض')}
                  </span>
                </div>

                <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    {tr('Banque émettrice :', 'البنك المصدر:')} <strong>{proof.bankName}</strong>
                  </span>
                  <span>
                    {tr('Réf Virement :', 'مرجع التحويل:')} <strong className="font-mono">{proof.referenceNumber}</strong>
                  </span>
                  <span>
                    {tr('Soumis le :', 'تاريخ الإرسال:')} {new Date(proof.submissionDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')} · {tr('Date bancaire :', 'تاريخ البنك:')} {proof.bankTransactionDate || '—'} · {tr('Comptabilisation :', 'تاريخ القيد:')} {proof.postingDate || bankPostingDate || proof.bankTransactionDate || proof.submissionDate.slice(0, 10)}
                  </span>
                </div>

                {proof.receiptNote && (
                  <p className="text-xs text-slate-500 italic mt-1">"{proof.receiptNote}"</p>
                )}
                {proof.receiptUrl?.startsWith('/api/uploads/') && (
                  <a
                    href={resolveAssetUrl(proof.receiptUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (isNativeApp()) {
                        e.preventDefault();
                        void openAuthenticatedUpload(proof.receiptUrl!);
                      }
                    }}
                    className="inline-block text-xs font-semibold text-teal-700 hover:text-teal-900 underline"
                  >
                    {tr('Ouvrir le justificatif', 'فتح إثبات الأداء')}
                  </a>
                )}
              </div>

              <div className="flex items-center gap-4 shrink-0">
                <div className="text-end">
                  <span className="text-xs text-slate-400 block">{tr('Montant justifié', 'المبلغ المصرح به')}</span>
                  <span className="font-mono font-bold text-base text-slate-900">
                    {currencyFormatter.format(proof.amount)}
                  </span>
                </div>

                {proof.status === 'pending' && (
                  <div className="flex items-center gap-2">
                    <Button
                      disabled={reviewProofMutation.isPending}
                      onClick={() =>
                        reviewProofMutation.mutate({ proofId: proof.id, decision: 'approve' })
                      }
                      className="text-xs bg-emerald-600 hover:bg-emerald-700"
                    >
                      {tr('Valider le virement', 'تأكيد التحويل')}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={reviewProofMutation.isPending}
                      onClick={() => {
                        setRejectingProofId(proof.id);
                        setRejectReason(
                          tr('Référence introuvable sur le relevé', 'المرجع غير موجود في الكشف البنكي'),
                        );
                      }}
                      className="text-xs text-rose-600 hover:bg-rose-50"
                    >
                      {tr('Rejeter', 'رفض')}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {paymentProofs.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-xs space-y-1">
              <p className="font-semibold text-sm text-slate-700">
                {tr('Aucun virement à vérifier', 'لا توجد تحويلات في انتظار المراجعة')}
              </p>
              <p>
                {tr(
                  "Lorsqu'un copropriétaire envoie une preuve de virement depuis son espace, elle apparaît ici.",
                  'عندما يرسل مالك مشترك إثبات تحويل بنكي من فضائه الخاص، يظهر هنا.',
                )}
              </p>
            </div>
          )}
        </div>
      </Card>

      {rejectingProofId && (
        <Modal
          isOpen={!!rejectingProofId}
          onClose={() => {
            setRejectingProofId(null);
            setRejectReason('');
          }}
          title={tr('Motif du rejet du justificatif', 'سبب رفض إثبات التحويل')}
          maxWidthClass="max-w-md"
          onSubmit={async (e) => {
            e.preventDefault();
            await reviewProofMutation.mutateAsync({
              proofId: rejectingProofId,
              decision: 'reject',
              reason: rejectReason.trim(),
            });
            setRejectingProofId(null);
            setRejectReason('');
          }}
          busy={reviewProofMutation.isPending}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Motif du rejet :', 'سبب الرفض:')}
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRejectingProofId(null);
                  setRejectReason('');
                }}
              >
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                type="submit"
                disabled={!rejectReason.trim() || reviewProofMutation.isPending}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {tr('Confirmer le rejet', 'تأكيد الرفض')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

export default VerificationsTab;
