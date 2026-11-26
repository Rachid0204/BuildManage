import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import { transferFunds } from '../../../../firebase/services';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import { currencyFormatter } from '../financeConstants';
import type { FinanceOverviewStats } from '../financeSelectors';

interface FundTransferModalProps {
  building: Building;
  stats: FinanceOverviewStats;
  isOpen: boolean;
  openNonce: number;
  onClose: () => void;
}

const FundTransferModal: React.FC<FundTransferModalProps> = ({
  building,
  stats,
  isOpen,
  openNonce,
  onClose,
}) => {
  const { tr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [transferFromFund, setTransferFromFund] = useState<'courant' | 'reserve'>('courant');
  const [transferToFund, setTransferToFund] = useState<'courant' | 'reserve'>('reserve');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [transferReason, setTransferReason] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setTransferFromFund('courant');
    setTransferToFund('reserve');
    setTransferAmount('');
    setTransferDate(new Date().toISOString().split('T')[0]);
    setTransferReason('');
  }, [isOpen, openNonce]);

  const transferFundsMutation = useMutation({
    mutationFn: (input: {
      fromFund: 'courant' | 'reserve';
      toFund: 'courant' | 'reserve';
      amount: number;
      date: string;
      reason: string;
    }) => transferFunds(building.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      setTransferAmount('');
      setTransferReason('');
      onClose();
      showToast(
        tr('Virement interne entre fonds enregistré.', 'تم تسجيل التحويل الداخلي بين الصناديق.'),
        'success',
      );
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tr('Virement entre fonds', 'تحويل بين الصناديق')}
      maxWidthClass="max-w-lg"
      busy={transferFundsMutation.isPending}
      onSubmit={async (e) => {
        e.preventDefault();
        const numAmt = parseFloat(transferAmount);
        if (!Number.isFinite(numAmt) || numAmt <= 0) {
          throw new Error(tr('Veuillez saisir un montant valide supérieur à 0 MAD.', 'يرجى إدخال مبلغ صحيح أكبر من 0 درهم.'));
        }
        if (transferFromFund === transferToFund) {
          throw new Error(tr('Les fonds source et destination doivent être différents.', 'يجب أن يكون الصندوق المصدر والوجهة مختلفين.'));
        }
        if (!transferDate || Number.isNaN(Date.parse(transferDate))) {
          throw new Error(tr('Indiquez une date comptable valide.', 'أدخل تاريخاً محاسبياً صالحاً.'));
        }
        if (transferReason.trim().length < 3) {
          throw new Error(tr('Le motif du virement (min. 3 caractères) est obligatoire.', 'سبب التحويل إجباري (3 أحرف على الأقل).'));
        }
        await transferFundsMutation.mutateAsync({
          fromFund: transferFromFund,
          toFund: transferToFund,
          amount: numAmt,
          date: transferDate,
          reason: transferReason.trim(),
        });
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tr('Annuler', 'إلغاء')}
          </Button>
          <Button type="submit" disabled={transferFundsMutation.isPending}>
            {transferFundsMutation.isPending
              ? tr('Validation...', 'جاري التنفيذ...')
              : tr('Exécuter le virement', 'تنفيذ التحويل')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Fonds source', 'الصندوق المصدر')}
            </label>
            <select
              value={transferFromFund}
              onChange={(e) => {
                const nextFrom = e.target.value === 'reserve' ? 'reserve' : 'courant';
                setTransferFromFund(nextFrom);
                setTransferToFund(nextFrom === 'courant' ? 'reserve' : 'courant');
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
            >
              <option value="courant">
                {tr('Compte courant', 'الحساب الجاري')} ({currencyFormatter.format(stats.balance)})
              </option>
              <option value="reserve">
                {tr('Fonds de réserve', 'صندوق الاحتياط')} ({currencyFormatter.format(stats.reserveFund)})
              </option>
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Fonds destination', 'الصندوق المستفيد')}
            </label>
            <select
              value={transferToFund}
              onChange={(e) => {
                const nextTo = e.target.value === 'reserve' ? 'reserve' : 'courant';
                setTransferToFund(nextTo);
                setTransferFromFund(nextTo === 'courant' ? 'reserve' : 'courant');
              }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
            >
              <option value="reserve">{tr('Fonds de réserve', 'صندوق الاحتياط')}</option>
              <option value="courant">{tr('Compte courant', 'الحساب الجاري')}</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Montant à transférer (MAD)', 'المبلغ المحول (درهم)')}
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              placeholder="Ex: 5000"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              required
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Date', 'التاريخ')}
            </label>
            <input
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono"
              required
            />
          </div>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            {tr("Motif / décision d'AG", 'السبب / قرار الجمع العام')}
          </label>
          <input
            type="text"
            maxLength={1000}
            value={transferReason}
            onChange={(e) => setTransferReason(e.target.value)}
            placeholder={tr('Ex: Dotation annuelle au fonds de réserve (AG 2026)', 'مثال: المخصص السنوي لصندوق الاحتياط')}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            required
          />
        </div>
      </div>
    </Modal>
  );
};

export default FundTransferModal;
