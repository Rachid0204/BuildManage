import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import { remoteMutation } from '../../../../firebase/services';
import { todayCasablancaIsoDate } from '../../../../shared/moroccoDate';
import { useAuth } from '../../../../contexts/AuthContext';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import { computeDefaultLockMonth } from '../financeReportExport';
import type { ClosedPeriodMeta } from '../useFinancialReport';

interface PeriodLockModalProps {
  building: Building;
  closedPeriods: Record<string, ClosedPeriodMeta>;
  isOpen: boolean;
  openNonce: number;
  onClose: () => void;
}

const PeriodLockModal: React.FC<PeriodLockModalProps> = ({
  building,
  closedPeriods,
  isOpen,
  openNonce,
  onClose,
}) => {
  const { tr } = useI18n();
  const { userProfile } = useAuth();
  const { showToast, confirmAction } = useToast();
  const queryClient = useQueryClient();

  const currentMonth = todayCasablancaIsoDate().slice(0, 7);
  const [period, setPeriod] = useState(() => computeDefaultLockMonth());
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setPeriod(computeDefaultLockMonth());
    setReason(tr('Comptes du mois vérifiés', 'تمت مراجعة حسابات الشهر'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, openNonce]);

  const closedEntries = Object.entries(closedPeriods || {}).map(([key, meta]) => ({
    key,
    period: key.split(':').pop() || key,
    reason: meta?.reason || '',
  }));

  const isSelectedAlreadyClosed = closedEntries.some((entry) => entry.period === period);
  const isCurrentOrFutureMonth = period >= currentMonth;

  const lockMutation = useMutation({
    mutationFn: async (action: 'close' | 'reopen') => {
      const cleanReason =
        reason.trim() || tr('Comptes du mois vérifiés', 'تمت مراجعة حسابات الشهر');
      if (action === 'close') {
        await remoteMutation('closeFinancialPeriod', [building.id, period, cleanReason]);
      } else {
        await remoteMutation('reopenFinancialPeriod', [building.id, period, cleanReason]);
      }
      return action;
    },
    onSuccess: async (action) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] }),
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
      ]);
      showToast(
        action === 'close'
          ? tr(`Le mois ${period} est maintenant verrouillé.`, `تم قفل شهر ${period}.`)
          : tr(`Le mois ${period} a été déverrouillé.`, `تمت إعادة فتح شهر ${period}.`),
        'success',
      );
      onClose();
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tr('Verrouiller un mois terminé', 'قفل شهر مكتمل')}
      maxWidthClass="max-w-lg"
      busy={lockMutation.isPending}
      onSubmit={async (e) => {
        e.preventDefault();
        const extraWarning = isCurrentOrFutureMonth
          ? tr(
              `Attention : ${period} est le mois en cours (ou futur). Si vous le verrouillez maintenant, vous ne pourrez plus y enregistrer les paiements ou dépenses de ce mois ! `,
              `تنبيه: ${period} هو الشهر الحالي (أو شهر قادم). إذا قمت بقفله الآن فلن تتمكن من تسجيل دفعات أو مصاريف هذا الشهر! `,
            )
          : '';
        const ok = await confirmAction({
          title: tr('Verrouiller ce mois', 'تأكيد قفل الشهر'),
          message:
            extraWarning +
            tr(
              `Confirmez-vous le verrouillage de ${period} ? Seul un administrateur pourra le déverrouiller par la suite.`,
              `هل تؤكد قفل شهر ${period}؟ وحده المدير العام يمكنه إعادة فتحه لاحقاً.`,
            ),
          confirmLabel: tr('Verrouiller le mois', 'قفل الشهر'),
        });
        if (!ok) return;
        await lockMutation.mutateAsync('close');
      }}
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <div>
            {userProfile?.role === 'admin' && isSelectedAlreadyClosed && (
              <Button
                type="button"
                variant="secondary"
                disabled={lockMutation.isPending}
                onClick={async () => {
                  const ok = await confirmAction({
                    title: tr('Déverrouiller ce mois', 'إعادة فتح الشهر'),
                    message: tr(
                      `Confirmer la réouverture du mois ${period} ?`,
                      `تأكيد إعادة فتح شهر ${period}؟`,
                    ),
                    confirmLabel: tr('Déverrouiller', 'إعادة الفتح'),
                  });
                  if (!ok) return;
                  await lockMutation.mutateAsync('reopen');
                }}
                className="text-xs text-amber-800 border-amber-300 hover:bg-amber-50"
              >
                {tr('Déverrouiller ce mois', 'إعادة فتح هذا الشهر')}
              </Button>
            )}
          </div>
          <div className="flex gap-2 ms-auto">
            <Button type="button" variant="secondary" onClick={onClose}>
              {tr('Fermer', 'إغلاق')}
            </Button>
            <Button
              type="submit"
              disabled={lockMutation.isPending || isSelectedAlreadyClosed || !reason.trim()}
              className="bg-slate-900 hover:bg-slate-800 text-white font-semibold"
            >
              {isSelectedAlreadyClosed
                ? tr('Déjà verrouillé', 'مقفل مسبقاً')
                : tr('Verrouiller ce mois', 'قفل هذا الشهر')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 leading-relaxed">
          {tr(
            'Verrouiller un mois empêche toute modification ou ajout accidentel de dépenses et paiements sur ce mois (utile une fois vos comptes mensuels vérifiés).',
            'يمنع قفل الشهر أي تعديل أو إضافة غير مقصودة للمصاريف والدفعات خلال ذلك الشهر (مفيد بعد التحقق من الحسابات الشهرية).',
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="period-lock-month" className="block font-semibold text-slate-700 mb-1">
              {tr('Mois à verrouiller', 'الشهر المراد قفله')}
            </label>
            <input
              id="period-lock-month"
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono"
              required
            />
            {isCurrentOrFutureMonth && (
              <p className="text-[11px] text-rose-700 font-medium mt-1">
                {tr(
                  'Conseil : ne verrouillez un mois qu’une fois celui-ci entièrement terminé.',
                  'نصيحة: لا تقفل الشهر إلا بعد انتهائه بالكامل.',
                )}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="period-lock-reason" className="block font-semibold text-slate-700 mb-1">
              {tr('Note de clôture', 'ملاحظة الإقفال')}
            </label>
            <input
              id="period-lock-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
              required
            />
          </div>
        </div>

        {closedEntries.length > 0 && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <span className="block font-semibold text-slate-700">
              {tr('Mois déjà verrouillés :', 'الأشهر المقفلة حالياً:')}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {closedEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => setPeriod(entry.period)}
                  className="px-2.5 py-1 rounded-full bg-white border border-slate-300 font-mono text-[11px] text-slate-700 hover:border-slate-400"
                  title={entry.reason}
                >
                  🔒 {entry.period}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PeriodLockModal;
