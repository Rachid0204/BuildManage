import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import InfoTip from '../../../common/InfoTip';
import { remoteMutation } from '../../../../firebase/services';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import { currencyFormatter } from '../financeConstants';

export interface ReversePaymentModalRequest {
  paymentId: string;
  residentName?: string;
  apartmentNumber?: string;
  quittanceNumber?: string;
  periodLabel?: string;
  amount: number;
}

interface ReversePaymentModalProps {
  building: Building;
  request: ReversePaymentModalRequest | null;
  onClose: () => void;
  onReversed?: () => void;
}

const ReversePaymentModal: React.FC<ReversePaymentModalProps> = ({
  building,
  request,
  onClose,
  onReversed,
}) => {
  const { tr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  useEffect(() => {
    setReason('');
  }, [request?.paymentId]);

  const reversePaymentMutation = useMutation({
    mutationFn: (input: { paymentId: string; reason: string }) =>
      remoteMutation('reversePayment', [building.id, input.paymentId, input.reason]),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['quittances', building.id] }),
        queryClient.invalidateQueries({ queryKey: ['charges', building.id] }),
        queryClient.invalidateQueries({ queryKey: ['invoices', building.id] }),
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
        queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] }),
      ]);
      setReason('');
      onReversed?.();
      onClose();
      showToast(
        tr(
          'Paiement annulé : le reçu est marqué annulé et le montant redevient à payer.',
          'تم إلغاء الدفعة: أُلغي الوصل وعاد المبلغ مستحقاً للأداء.',
        ),
        'success',
      );
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  if (!request) return null;

  const quickReasons = [
    tr('Chèque rejeté / impayé', 'شيك مرفوض / بدون رصيد'),
    tr('Erreur de montant saisi', 'خطأ في المبلغ المدخل'),
    tr('Erreur de copropriétaire ou de lot', 'خطأ في المالك أو الشقة'),
  ];

  return (
    <Modal
      isOpen={!!request}
      onClose={() => {
        setReason('');
        onClose();
      }}
      title={tr('Annuler ce paiement', 'إلغاء هذه الدفعة')}
      maxWidthClass="max-w-md"
      busy={reversePaymentMutation.isPending}
      onSubmit={async (e) => {
        e.preventDefault();
        if (reason.trim().length < 3) {
          throw new Error(
            tr(
              "Indiquez la raison de l'annulation (min. 3 caractères).",
              'أدخل سبب الإلغاء (3 أحرف على الأقل).',
            ),
          );
        }
        await reversePaymentMutation.mutateAsync({
          paymentId: request.paymentId,
          reason: reason.trim(),
        });
      }}
    >
      <div className="space-y-4 text-xs">
        <p className="text-slate-600 leading-relaxed flex items-start gap-1.5">
          <span>
            {tr(
              'Le reçu sera marqué comme annulé et le montant redeviendra à payer par le copropriétaire.',
              'سيتم تعليم الوصل كملغى وسيعود المبلغ مستحقاً على المالك المشترك.',
            )}
          </span>
          <InfoTip label={tr('Traçabilité comptable', 'التتبع المحاسبي')}>
            {tr(
              "Conformément à la Loi n° 18-00, l'écriture initiale reste visible dans l'historique accompagnée d'une écriture d'annulation (contrepassation).",
              'وفقاً للقانون 18-00، يبقى القيد الأصلي ظاهراً في السجل مرفقاً بقيد إلغاء معاكس.',
            )}
          </InfoTip>
        </p>

        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-900 text-sm">
              {request.residentName || tr('Paiement copropriétaire', 'أداء مالك مشترك')}
            </span>
            <span className="font-mono font-bold text-rose-700 text-sm">
              {currencyFormatter.format(request.amount)}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 font-mono flex flex-wrap gap-x-2">
            {request.apartmentNumber && (
              <span>
                {tr('Lot', 'شقة')} {request.apartmentNumber}
              </span>
            )}
            {request.quittanceNumber && <span>· {request.quittanceNumber}</span>}
            {request.periodLabel && <span>· {request.periodLabel}</span>}
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="reverse-payment-reason" className="block font-semibold text-slate-700">
            {tr("Pourquoi annulez-vous ce paiement ?", 'ما سبب إلغاء هذه الدفعة؟')}
          </label>
          <div className="flex flex-wrap gap-1.5">
            {quickReasons.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setReason(preset)}
                className={`px-2.5 py-1 rounded-full border text-[11px] font-medium transition-colors ${
                  reason === preset
                    ? 'bg-rose-50 border-rose-300 text-rose-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
          <textarea
            id="reverse-payment-reason"
            rows={2}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tr('Ex: Chèque revenu impayé par la banque', 'مثال: شيك مرفوض من البنك')}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-rose-500 outline-none"
            required
          />
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setReason('');
              onClose();
            }}
          >
            {tr('Fermer', 'إغلاق')}
          </Button>
          <Button
            type="submit"
            disabled={reason.trim().length < 3 || reversePaymentMutation.isPending}
            className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
          >
            {reversePaymentMutation.isPending
              ? tr('Annulation...', 'جاري الإلغاء...')
              : tr('Confirmer l’annulation', 'تأكيد الإلغاء')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ReversePaymentModal;
