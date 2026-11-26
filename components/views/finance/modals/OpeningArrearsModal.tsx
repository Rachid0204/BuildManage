import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import { remoteMutation } from '../../../../firebase/services';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import { computeDefaultLockMonth } from '../financeReportExport';

interface OpeningArrearsModalProps {
  building: Building;
  isOpen: boolean;
  openNonce: number;
  onClose: () => void;
}

const OpeningArrearsModal: React.FC<OpeningArrearsModalProps> = ({
  building,
  isOpen,
  openNonce,
  onClose,
}) => {
  const { tr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const billableApartments = building.apartments.filter(
    (a) => !a.archivedAt && Boolean(a.ownerId || a.tenantId),
  );

  const [lotId, setLotId] = useState('');
  const [period, setPeriod] = useState(() => computeDefaultLockMonth());
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setLotId(billableApartments[0]?.id || '');
    setPeriod(computeDefaultLockMonth());
    setAmount('');
    setDescription('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, openNonce]);

  const arrearsMutation = useMutation({
    mutationFn: async () => {
      const apt = building.apartments.find((a) => a.id === lotId);
      const residentId = apt?.ownerId || apt?.tenantId;
      if (!apt || !residentId) {
        throw new Error(tr('Affectez d’abord un copropriétaire à ce lot.', 'اربط أولاً مالكاً بهذه الشقة.'));
      }
      const numAmt = Number(amount);
      if (!Number.isFinite(numAmt) || numAmt <= 0) {
        throw new Error(tr('Indiquez un montant supérieur à 0 MAD.', 'أدخل مبلغاً أكبر من 0 درهم.'));
      }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
        throw new Error(tr('Sélectionnez le mois concerné.', 'حدد الشهر المعني.'));
      }
      return remoteMutation('importOpeningArrears', [
        building.id,
        [
          {
            apartmentId: apt.id,
            residentId,
            period,
            amount: numAmt,
            description: description.trim() || tr('Ancien impayé', 'متأخرات سابقة'),
          },
        ],
      ]);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['charges', building.id] }),
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
        queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] }),
      ]);
      onClose();
      showToast(
        tr(
          "Ancien impayé ajouté au compte du copropriétaire.",
          'تمت إضافة المتأخرات السابقة إلى حساب المالك المشترك.',
        ),
        'success',
      );
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tr('Ajouter un ancien impayé', 'إضافة متأخرات سابقة')}
      maxWidthClass="max-w-lg"
      busy={arrearsMutation.isPending}
      onSubmit={async (e) => {
        e.preventDefault();
        await arrearsMutation.mutateAsync();
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tr('Annuler', 'إلغاء')}
          </Button>
          <Button
            type="submit"
            disabled={
              arrearsMutation.isPending ||
              billableApartments.length === 0 ||
              !lotId ||
              Number(amount) <= 0
            }
            className="bg-teal-700 hover:bg-teal-800 text-white font-semibold"
          >
            {arrearsMutation.isPending
              ? tr('Enregistrement...', 'جاري الحفظ...')
              : tr("Enregistrer l'impayé", 'حفظ المتأخرات')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        <p className="text-slate-600 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl p-3">
          {tr(
            "Utilisez ce formulaire lorsqu'un copropriétaire devait déjà de l'argent avant votre démarrage sur SyndicUnion. Ce montant s'ajoute à ce qu'il doit payer, sans modifier l'argent actuellement sur votre compte bancaire.",
            'استخدم هذا النموذج إذا كان على أحد الملاك المشتركين مبلغ غير مؤدى قبل بدء العمل بالمنصة. يُضاف هذا المبلغ إلى مستحقاته دون تغيير الرصيد البنكي الحالي.',
          )}
        </p>

        {billableApartments.length === 0 ? (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 space-y-1">
            <p className="font-semibold">
              {tr('Aucun lot lié à un copropriétaire', 'لا توجد أي شقة مرتبطة بمالك مشترك')}
            </p>
            <p>
              {tr(
                'Ajoutez d’abord vos appartements et vos copropriétaires avant de saisir un ancien impayé.',
                'أضف الشقق والملاك المشتركين أولاً قبل تسجيل متأخرات سابقة.',
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="opening-arrear-lot" className="block font-semibold text-slate-700 mb-1">
                  {tr('Lot & Copropriétaire *', 'الشقة والمالك المشترك *')}
                </label>
                <select
                  id="opening-arrear-lot"
                  value={lotId}
                  onChange={(e) => setLotId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white text-slate-900"
                  required
                >
                  <option value="">{tr('Choisir un lot...', 'اختر شقة...')}</option>
                  {billableApartments.map((apt) => {
                    const res = building.residents.find(
                      (r) => r.id === (apt.ownerId || apt.tenantId),
                    );
                    return (
                      <option key={apt.id} value={apt.id}>
                        {tr('Lot', 'شقة')} {apt.number} — {res?.name || tr('Copropriétaire', 'مالك')}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label htmlFor="opening-arrear-period" className="block font-semibold text-slate-700 mb-1">
                  {tr("Mois de l'impayé *", 'شهر المتأخرات *')}
                </label>
                <input
                  id="opening-arrear-period"
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="opening-arrear-amount" className="block font-semibold text-slate-700 mb-1">
                  {tr('Montant restant dû (MAD) *', 'المبلغ المتبقي المستحق (درهم) *')}
                </label>
                <input
                  id="opening-arrear-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono font-bold bg-white"
                  required
                />
              </div>

              <div>
                <label htmlFor="opening-arrear-desc" className="block font-semibold text-slate-700 mb-1">
                  {tr('Note sur le reçu / relevé (optionnel)', 'ملاحظة في الكشف (اختياري)')}
                </label>
                <input
                  id="opening-arrear-desc"
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={tr('Ex: Solde impayé 2025', 'مثال: رصيد غير مؤدى لسنة 2025')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default OpeningArrearsModal;
