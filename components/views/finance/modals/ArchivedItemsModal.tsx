import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import { remoteMutation } from '../../../../firebase/services';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import type { BuildingFinancialReport } from '../useFinancialReport';

interface ArchivedItemsModalProps {
  building: Building;
  archives?: BuildingFinancialReport['archives'];
  isOpen: boolean;
  onClose: () => void;
}

const ArchivedItemsModal: React.FC<ArchivedItemsModalProps> = ({
  building,
  archives,
  isOpen,
  onClose,
}) => {
  const { tr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const items = [
    ...(archives?.apartments || []).map((a) => ({
      kind: 'apartments',
      id: a.id,
      label: `${tr('Lot', 'شقة')} ${a.number}`,
    })),
    ...(archives?.residents || []).map((r) => ({
      kind: 'residents',
      id: r.id,
      label: `${tr('Résident', 'ساكن')} — ${r.name}`,
    })),
    ...(archives?.prestataires || []).map((p) => ({
      kind: 'prestataires',
      id: p.id,
      label: `${tr('Prestataire', 'مهني')} — ${p.name}`,
    })),
  ];

  const restoreMutation = useMutation({
    mutationFn: (input: { kind: string; id: string }) =>
      remoteMutation('restoreArchived', [input.kind, input.id]),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
        queryClient.invalidateQueries({ queryKey: ['prestataires', building.id] }),
        queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] }),
      ]);
      showToast(tr('Élément restauré avec succès.', 'تمت استعادة العنصر بنجاح.'), 'success');
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={tr('Éléments archivés', 'العناصر المؤرشفة')}
      maxWidthClass="max-w-md"
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tr('Fermer', 'إغلاق')}
          </Button>
        </div>
      }
    >
      <div className="space-y-2.5 text-xs">
        {items.length === 0 ? (
          <p className="text-slate-500 text-center py-4">
            {tr('Aucun élément archivé pour cet immeuble.', 'لا توجد عناصر مؤرشفة لهذه العمارة.')}
          </p>
        ) : (
          items.map((item) => (
            <div
              key={`${item.kind}:${item.id}`}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3"
            >
              <span className="font-medium text-slate-800">{item.label}</span>
              <Button
                type="button"
                variant="secondary"
                disabled={restoreMutation.isPending}
                onClick={() => restoreMutation.mutate({ kind: item.kind, id: item.id })}
                className="text-xs"
              >
                {tr('Restaurer', 'استعادة')}
              </Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
};

export default ArchivedItemsModal;
