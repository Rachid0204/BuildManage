import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Invoice, PaymentMethod } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import { recordPayment, voidInvoice } from '../../../../firebase/services';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';

export type PayInvoiceModalRequest = {
  invoice: Invoice;
  remaining: number;
} | null;

interface PayInvoiceModalProps {
  building: Building;
  request: PayInvoiceModalRequest;
  onClose: () => void;
}

export const PayInvoiceModal: React.FC<PayInvoiceModalProps> = ({
  building,
  request,
  onClose,
}) => {
  const { tr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [payInvoiceAmount, setPayInvoiceAmount] = useState('');
  const [payInvoiceMethod, setPayInvoiceMethod] = useState<PaymentMethod>('virement');
  const [payInvoiceReference, setPayInvoiceReference] = useState('');
  const [payInvoiceDate, setPayInvoiceDate] = useState(
    () => new Date().toISOString().split('T')[0],
  );

  useEffect(() => {
    if (!request) return;
    setPayInvoiceAmount(String(request.remaining));
    setPayInvoiceMethod('virement');
    setPayInvoiceReference(`VIR-${request.invoice.invoiceNumber}`);
    setPayInvoiceDate(new Date().toISOString().split('T')[0]);
  }, [request]);

  const recordInvoicePaymentMutation = useMutation({
    mutationFn: (input: {
      invoice: Invoice;
      amount: number;
      method: PaymentMethod;
      reference?: string;
      date?: string;
    }) =>
      recordPayment(
        input.invoice,
        input.amount,
        input.method,
        input.reference || undefined,
        input.date ? { bankTransactionDate: input.date } : undefined,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      setPayInvoiceAmount('');
      setPayInvoiceReference('');
      onClose();
      showToast(
        tr(
          'Règlement de la facture enregistré et ventilé sur les charges.',
          'تم تسجيل أداء الفاتورة وتوزيعه على المساهمات.',
        ),
        'success',
      );
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  if (!request) return null;
  const { invoice: payInvoiceTarget } = request;

  return (
    <Modal
      isOpen={!!payInvoiceTarget}
      busy={recordInvoicePaymentMutation.isPending}
      onSubmit={async () => {
        const amount = parseFloat(payInvoiceAmount);
        const remaining =
          Math.max(
            0,
            Math.round(
              ((payInvoiceTarget.totalAmount || 0) - (payInvoiceTarget.paidAmount || 0)) * 100,
            ),
          ) / 100;
        if (
          !Number.isFinite(amount) ||
          amount <= 0 ||
          Math.round(amount * 100) > Math.round(remaining * 100)
        ) {
          throw new Error(
            tr(
              'Indiquez un montant valide inférieur ou égal au solde restant de la facture.',
              'أدخل مبلغاً صالحاً أقل من أو يساوي الرصيد المتبقي للفاتورة.',
            ),
          );
        }
        await recordInvoicePaymentMutation.mutateAsync({
          invoice: payInvoiceTarget,
          amount,
          method: payInvoiceMethod,
          reference: payInvoiceReference.trim() || undefined,
          date: payInvoiceDate || undefined,
        });
      }}
      onClose={() => {
        setPayInvoiceAmount('');
        setPayInvoiceReference('');
        onClose();
      }}
      title={tr(
        `Encaisser la facture ${payInvoiceTarget.invoiceNumber}`,
        `تحصيل الفاتورة ${payInvoiceTarget.invoiceNumber}`,
      )}
    >
      <div className="space-y-3 text-xs">
        <p className="text-slate-600">
          {tr(
            'Le règlement sera automatiquement ventilé sur les charges ouvertes de cette facture (par ordre d’ancienneté).',
            'سيتم توزيع الأداء تلقائياً على المساهمات المفتوحة المرتبطة بهذه الفاتورة حسب الأقدمية.',
          )}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Montant encaissé (MAD)', 'المبلغ المحصل (درهم)')}
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={payInvoiceAmount}
              onChange={(e) => setPayInvoiceAmount(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono font-bold"
              required
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Mode de paiement', 'طريقة الدفع')}
            </label>
            <select
              value={payInvoiceMethod}
              onChange={(e) => setPayInvoiceMethod(e.target.value as PaymentMethod)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded bg-white"
            >
              <option value="virement">{tr('Virement bancaire', 'تحويل بنكي')}</option>
              <option value="cheque">{tr('Chèque', 'شيك')}</option>
              <option value="versement">{tr('Versement agence', 'إيداع بنكي')}</option>
              <option value="especes">{tr('Espèces', 'نقداً')}</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Référence bancaire', 'المرجع البنكي')}
            </label>
            <input
              type="text"
              value={payInvoiceReference}
              onChange={(e) => setPayInvoiceReference(e.target.value)}
              placeholder="Ex: VIR-FAC-2026-0001"
              className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono"
            />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              {tr('Date d’opération bancaire', 'تاريخ العملية البنكية')}
            </label>
            <input
              type="date"
              value={payInvoiceDate}
              onChange={(e) => setPayInvoiceDate(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded font-mono"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {tr('Annuler', 'إلغاء')}
          </Button>
          <Button
            type="submit"
            disabled={recordInvoicePaymentMutation.isPending}
            className="bg-teal-700 hover:bg-teal-800"
          >
            {tr('Enregistrer le règlement', 'تسجيل الأداء')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

interface VoidInvoiceModalProps {
  building: Building;
  target: Invoice | null;
  onClose: () => void;
}

export const VoidInvoiceModal: React.FC<VoidInvoiceModalProps> = ({
  building,
  target,
  onClose,
}) => {
  const { tr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [voidInvoiceReason, setVoidInvoiceReason] = useState('');

  useEffect(() => {
    setVoidInvoiceReason('');
  }, [target?.id]);

  const voidInvoiceMutation = useMutation({
    mutationFn: (input: { invoiceId: string; reason: string }) =>
      voidInvoice(building.id, input.invoiceId, input.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      setVoidInvoiceReason('');
      onClose();
      showToast(tr('Facture / avis annulé.', 'تم إلغاء الفاتورة / الإشعار.'), 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  if (!target) return null;

  return (
    <Modal
      isOpen={!!target}
      busy={voidInvoiceMutation.isPending}
      onSubmit={async () => {
        if (voidInvoiceReason.trim().length < 3) {
          throw new Error(tr('Indiquez un motif d’annulation (min. 3 caractères).', 'أدخل سبب الإلغاء (3 أحرف على الأقل).'));
        }
        await voidInvoiceMutation.mutateAsync({
          invoiceId: target.id,
          reason: voidInvoiceReason.trim(),
        });
      }}
      onClose={() => {
        setVoidInvoiceReason('');
        onClose();
      }}
      title={tr(
        `Annuler la facture ${target.invoiceNumber}`,
        `إلغاء الفاتورة ${target.invoiceNumber}`,
      )}
    >
      <div className="space-y-3 text-xs">
        <p className="text-slate-600">
          {tr(
            'Seule une facture sans paiement encaissé peut être annulée. Les charges restent ouvertes pour un nouvel avis.',
            'يمكن إلغاء الفاتورة فقط إذا لم يتم تحصيل أي مبلغ عنها. تبقى المساهمات مفتوحة لإشعار جديد.',
          )}
        </p>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            {tr('Motif d’annulation :', 'سبب الإلغاء:')}
          </label>
          <textarea
            rows={3}
            maxLength={1000}
            value={voidInvoiceReason}
            onChange={(e) => setVoidInvoiceReason(e.target.value)}
            placeholder={tr('Ex: Avis émis par erreur ou à regrouper différemment', 'مثال: إشعار صادر عن طريق الخطأ')}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
            required
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setVoidInvoiceReason('');
              onClose();
            }}
          >
            {tr('Fermer', 'إغلاق')}
          </Button>
          <Button
            type="submit"
            disabled={voidInvoiceReason.trim().length < 3 || voidInvoiceMutation.isPending}
            className="bg-rose-600 hover:bg-rose-700"
          >
            {tr('Confirmer l’annulation', 'تأكيد الإلغاء')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
