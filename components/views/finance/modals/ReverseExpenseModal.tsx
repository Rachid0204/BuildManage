import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Transaction } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import InfoTip from '../../../common/InfoTip';
import { reverseExpense } from '../../../../firebase/services';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import { currencyFormatter } from '../financeConstants';

interface ReverseExpenseModalProps {
  building: Building;
  target: Transaction | null;
  onClose: () => void;
  onReversed: () => void;
}

const ReverseExpenseModal: React.FC<ReverseExpenseModalProps> = ({
  building,
  target,
  onClose,
  onReversed,
}) => {
  const { tr, isAr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [reverseExpenseReason, setReverseExpenseReason] = useState('');

  useEffect(() => {
    setReverseExpenseReason('');
  }, [target?.id]);

  const reverseExpenseMutation = useMutation({
    mutationFn: (input: { transactionId: string; reason: string }) =>
      reverseExpense(building.id, input.transactionId, input.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      setReverseExpenseReason('');
      onReversed();
      showToast(
        tr(
          'Dépense contrepassée sans effacer l’écriture d’origine.',
          'تم عكس المصروف مع الاحتفاظ بالقيد الأصلي.',
        ),
        'success',
      );
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  if (!target) return null;

  return (
    <Modal
      isOpen={!!target}
      onClose={() => {
        setReverseExpenseReason('');
        onClose();
      }}
      title={tr('Annuler une dépense', 'عكس مصروف مسجل')}
      maxWidthClass="max-w-md"
      busy={reverseExpenseMutation.isPending}
      onSubmit={async (e) => {
        e.preventDefault();
        if (reverseExpenseReason.trim().length < 3) {
          throw new Error(tr('Indiquez le motif de contrepassation (min. 3 caractères).', 'أدخل سبب العكس (3 أحرف على الأقل).'));
        }
        await reverseExpenseMutation.mutateAsync({
          transactionId: target.id,
          reason: reverseExpenseReason.trim(),
        });
      }}
    >
      <div className="space-y-4 text-xs">
        <p className="text-slate-600 flex items-center gap-1.5">
          <span>
            {tr(
              "L'opération d'origine est conservée dans l'historique et annulée par une écriture inverse.",
              'يبقى القيد الأصلي محفوظاً في السجل ويتم إلغاؤه بقيد معاكس.',
            )}
          </span>
          <InfoTip label={tr('Contrepassation comptable', 'القيد العكسي')}>
            {tr(
              'Principe de traçabilité comptable (Loi n° 18-00) : aucune écriture enregistrée ne peut être supprimée sans trace.',
              'مبدأ التتبع المحاسبي (القانون 18-00): لا يُحذف أي قيد مسجل دون أثر.',
            )}
          </InfoTip>
        </p>
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
          <p className="font-semibold text-slate-900">{target.description}</p>
          <p className="font-mono text-slate-600">
            {currencyFormatter.format(Math.abs(target.amount))} ·{' '}
            {target.fundType === 'reserve'
              ? tr('Fonds de Réserve', 'صندوق الاحتياط')
              : tr('Compte Courant', 'الحساب الجاري')}{' '}
            · {new Date(target.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
          </p>
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            {tr('Motif de contrepassation :', 'سبب العكس:')}
          </label>
          <textarea
            rows={3}
            maxLength={1000}
            value={reverseExpenseReason}
            onChange={(e) => setReverseExpenseReason(e.target.value)}
            placeholder={tr('Ex: Erreur de saisie ou facture annulée par le fournisseur', 'مثال: خطأ في الإدخال أو فاتورة ملغاة')}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 outline-none"
            required
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setReverseExpenseReason('');
              onClose();
            }}
          >
            {tr('Annuler', 'إلغاء')}
          </Button>
          <Button
            type="submit"
            disabled={reverseExpenseReason.trim().length < 3 || reverseExpenseMutation.isPending}
            className="bg-rose-600 hover:bg-rose-700"
          >
            {tr('Confirmer la contrepassation', 'تأكيد العكس')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ReverseExpenseModal;
