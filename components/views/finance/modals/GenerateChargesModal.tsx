import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Charge } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import InfoTip from '../../../common/InfoTip';
import { generateMonthlyCharges } from '../../../../firebase/services';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import { currencyFormatter } from '../financeConstants';
import { computeChargePreview } from '../financeSelectors';

export type GenerateChargesModalRequest = {
  period?: string;
  nonce: number;
} | null;

interface GenerateChargesModalProps {
  building: Building;
  charges: Charge[];
  request: GenerateChargesModalRequest;
  onClose: () => void;
}

const GenerateChargesModal: React.FC<GenerateChargesModalProps> = ({
  building,
  charges,
  request,
  onClose,
}) => {
  const { tr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const computeDefaultBudget = () =>
    String(
      building.apartments
        .filter((a) => !a.archivedAt)
        .reduce((sum, a) => sum + (a.monthlyFees ?? building.monthlySyndicFees ?? 0), 0),
    );

  const [useTantiemes, setUseTantiemes] = useState(false);
  const [periodName, setPeriodName] = useState(() => new Date().toISOString().slice(0, 7));
  const [totalBudgetInput, setTotalBudgetInput] = useState(computeDefaultBudget);

  useEffect(() => {
    if (!request) return;
    setUseTantiemes(false);
    setTotalBudgetInput(computeDefaultBudget());
    if (request.period) {
      setPeriodName(request.period);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce, request?.period]);

  const { chargePreview, vacantLotsInTantiemesMode } = useMemo(
    () =>
      computeChargePreview({
        building,
        charges,
        periodName,
        useTantiemes,
        totalBudgetInput,
      }),
    [building, charges, periodName, totalBudgetInput, useTantiemes],
  );

  const generateChargesMutation = useMutation({
    mutationFn: () =>
      generateMonthlyCharges(building.id, building.syndicId, periodName, {
        useTantiemes,
        ...(useTantiemes ? { totalMonthlyBudget: Number(totalBudgetInput) } : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      onClose();
      showToast(
        tr('Appel de fonds généré avec succès.', 'تم إصدار طلب المساهمات بنجاح.'),
        'success',
      );
    },
  });

  return (
    <Modal
      isOpen={Boolean(request)}
      busy={generateChargesMutation.isPending}
      onSubmit={async () => {
        if (!periodName.trim()) {
          throw new Error(tr('Indiquez la période des cotisations.', 'أدخل فترة المساهمات.'));
        }
        if (
          useTantiemes &&
          (!totalBudgetInput.trim() ||
            !Number.isFinite(Number(totalBudgetInput)) ||
            Number(totalBudgetInput) <= 0)
        ) {
          throw new Error(tr('Le budget doit être un montant supérieur à zéro.', 'يجب أن تكون الميزانية مبلغاً أكبر من صفر.'));
        }
        await generateChargesMutation.mutateAsync();
      }}
      onClose={onClose}
      title={tr('Appeler les charges du mois', 'إصدار مساهمات الشهر')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr('Annuler', 'إلغاء')}
          </Button>
          <Button type="submit" disabled={generateChargesMutation.isPending}>
            {tr('Générer pour tous les lots', 'إصدار لجميع الشقق')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-600">
          {tr(
            'Chaque lot occupé est facturé une seule fois pour le mois choisi. Les charges déjà créées ne sont pas modifiées.',
            'تصدر المساهمات للشقق المرتبطة بساكن مرة واحدة لكل شهر. لا تتغير المساهمات الصادرة سابقاً.',
          )}
        </p>

        <div>
          <label htmlFor="charge-period" className="block text-xs font-semibold text-slate-700 mb-1">
            {tr('Période concernée', 'الفترة المعنية')}
          </label>
          <input
            type="month"
            id="charge-period"
            value={periodName}
            onChange={(e) => setPeriodName(e.target.value)}
            required
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
          />
        </div>

        <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg space-y-2">
          <p className="text-xs font-semibold text-teal-900">
            {tr('Par défaut : cotisation mensuelle configurée pour chaque lot, sans supplément.', 'افتراضياً: المساهمة الشهرية المحددة لكل شقة دون زيادة.')}
          </p>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useTantiemes}
              onChange={(e) => setUseTantiemes(e.target.checked)}
              className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
            />
            <div>
              <span className="text-xs font-bold text-teal-900 flex items-center gap-1.5">
                <span>{tr('Répartir un budget global selon les tantièmes', 'توزيع ميزانية إجمالية حسب الحصص الشائعة')}</span>
                <InfoTip label={tr('Répartition aux tantièmes', 'التوزيع حسب الحصص الشائعة')}>
                  {tr(
                    'Calcule la part de chaque lot proportionnellement à ses tantièmes de copropriété (Loi n° 18-00).',
                    'يحسب حصة كل شقة بالتناسب مع حصتها الشائعة في الملكية المشتركة (القانون 18-00).',
                  )}
                </InfoTip>
              </span>
              <span className="text-[11px] text-teal-700 block">
                {tr(
                  'Optionnel : remplace les montants habituels par une répartition du budget ci-dessous.',
                  'اختياري: يستبدل المساهمات المعتادة بتوزيع الميزانية الإجمالية أدناه.',
                )}
              </span>
            </div>
          </label>

          {useTantiemes && (
            <div className="mt-2 pt-2 border-t border-teal-200">
              <label htmlFor="charge-budget" className="block text-xs font-semibold text-teal-900 mb-1">
                {tr('Budget global mensuel à répartir (MAD)', 'الميزانية الشهرية الإجمالية للتوزيع (درهم)')}
              </label>
              <input
                type="number"
                id="charge-budget"
                min="0.01"
                step="0.01"
                value={totalBudgetInput}
                onChange={(e) => setTotalBudgetInput(e.target.value)}
                className="w-full px-3 py-1.5 border border-teal-300 rounded text-sm font-mono bg-white"
              />
              {vacantLotsInTantiemesMode > 0 && (
                <p className="mt-2 p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                  {tr(
                    `Attention : ${vacantLotsInTantiemesMode} lot(s) actif(s) sans résident assigné ne seront pas facturés dans cet appel (leur quote-part en tantièmes reste réservée sur le budget global).`,
                    `تنبيه: ${vacantLotsInTantiemesMode} شقة(ات) نشطة بدون ساكن مرتبط لن يتم إصدار مساهمة لها في هذا الطلب (تبقى حصتها محفوظة من الميزانية الإجمالية).`,
                  )}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label={tr('Aperçu des cotisations', 'معاينة المساهمات')}>
            <thead>
              <tr>
                <th className="text-start p-2">{tr('Lot', 'الشقة')}</th>
                <th className="text-end p-2">{tr('Montant', 'المبلغ')}</th>
                <th className="p-2">{tr('Émission', 'الإصدار')}</th>
              </tr>
            </thead>
            <tbody>
              {chargePreview.map((row) => (
                <tr key={row.id}>
                  <td className="p-2">{row.number}</td>
                  <td className="p-2 text-end font-mono">
                    {Number.isFinite(row.amount) ? currencyFormatter.format(row.amount) : '—'}
                  </td>
                  <td className="p-2">
                    {row.existing ? tr('Déjà émis — inchangé', 'صدر سابقاً — دون تغيير') : tr('À émettre', 'سيصدر')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {chargePreview.length === 0 && (
            <p className="text-xs text-slate-600">
              {tr('Liez un résident à un lot avant de générer les cotisations.', 'اربط ساكناً بشقة قبل إصدار المساهمات.')}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default GenerateChargesModal;
