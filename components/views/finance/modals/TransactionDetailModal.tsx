import React, { useMemo } from 'react';
import type { Building, Syndic, Transaction } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import InfoTip from '../../../common/InfoTip';
import { DocumentsIcon } from '../../../icons/IconComponents';
import { generateTransactionVoucherPDF } from '../../../../services/pdfOnDemand';
import { isIncomeTransaction, signedTransactionAmount } from '../../../../utils/security';
import { useI18n } from '../../../../hooks/useI18n';
import {
  buildCategoryLabels,
  buildDocumentTypeLabels,
  buildPaymentMethodLabels,
  currencyFormatter,
} from '../financeConstants';

interface TransactionDetailModalProps {
  building: Building;
  syndic?: Syndic;
  transaction: Transaction | null;
  onClose: () => void;
  onRequestReverseExpense: (transaction: Transaction) => void;
}

const TransactionDetailModal: React.FC<TransactionDetailModalProps> = ({
  building,
  syndic,
  transaction,
  onClose,
  onRequestReverseExpense,
}) => {
  const { tr, isAr } = useI18n();
  const CATEGORY_LABELS = useMemo(() => buildCategoryLabels(tr), [tr]);
  const PAYMENT_METHOD_LABELS = useMemo(() => buildPaymentMethodLabels(tr), [tr]);
  const DOCUMENT_TYPE_LABELS = useMemo(() => buildDocumentTypeLabels(tr), [tr]);

  if (!transaction) return null;

  const canReverse =
    !isIncomeTransaction(transaction) &&
    !transaction.reversalOf &&
    !transaction.transferId &&
    !(building.financials?.transactions || []).some((t) => t.reversalOf === transaction.id);

  return (
    <Modal
      isOpen={!!transaction}
      onClose={onClose}
      title={tr("Détail de l'opération", 'تفاصيل العملية')}
      footer={
        <div className="flex justify-between items-center w-full gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={() => generateTransactionVoucherPDF(transaction, building, syndic)}
              className="text-xs bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
            >
              <DocumentsIcon />
              <span>{tr('Télécharger le justificatif PDF', 'تحميل الوثيقة PDF')}</span>
            </Button>
            {canReverse && (
              <Button
                variant="secondary"
                onClick={() => onRequestReverseExpense(transaction)}
                className="text-xs text-rose-700 border-rose-200 hover:bg-rose-50"
              >
                {tr('Annuler cette dépense', 'عكس المصروف')}
              </Button>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            {tr('Fermer', 'إغلاق')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
          <div>
            <span className="font-mono text-[11px] text-slate-400 block">
              {tr('Identifiant :', 'المعرف:')} {transaction.id}
            </span>
            <span className="font-bold text-sm text-slate-900 mt-0.5 block">
              {transaction.description}
            </span>
          </div>
          <div className="text-end">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">
              {tr('Montant', 'المبلغ')}
            </span>
            <span
              className={`font-mono text-base font-bold ${
                isIncomeTransaction(transaction) ? 'text-emerald-600' : 'text-slate-900'
              }`}
            >
              {isIncomeTransaction(transaction) ? '+' : ''}
              {currencyFormatter.format(signedTransactionAmount(transaction))}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-400 uppercase">{tr('Fonds & Catégorie', 'الصندوق والفئة')}</p>
            <p className="font-medium text-slate-800 flex items-center gap-1 flex-wrap">
              <span>{tr('Fonds :', 'الصندوق:')}</span>
              <strong className="text-slate-900">
                {transaction.fundType === 'reserve'
                  ? tr('Fonds de réserve', 'صندوق الاحتياط')
                  : tr('Compte courant', 'الحساب الجاري')}
              </strong>
              {transaction.fundType === 'reserve' && (
                <InfoTip label={tr('Fonds de réserve', 'صندوق الاحتياط')}>
                  {tr('Fonds de réserve travaux prévu par la Loi n° 106-12.', 'صندوق احتياط الأشغال المنصوص عليه في القانون 106-12.')}
                </InfoTip>
              )}
            </p>
            <p className="text-slate-600">
              {tr('Catégorie :', 'الفئة:')}{' '}
              {transaction.category
                ? CATEGORY_LABELS[transaction.category] || transaction.category
                : tr('Charges', 'تكاليف')}
            </p>
            <p className="text-slate-600">
              {tr('Date :', 'التاريخ:')} {new Date(transaction.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
            </p>
          </div>

          <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5">
            <p className="text-[11px] font-semibold text-slate-400 uppercase">{tr('Justificatif & Paiement', 'الإثبات والأداء')}</p>
            <p className="font-medium text-slate-800 font-mono">
              {transaction.documentType
                ? DOCUMENT_TYPE_LABELS[transaction.documentType] || transaction.documentType
                : tr('Pièce', 'وثيقة')}{' '}
              : {transaction.invoiceNumber ? `#${transaction.invoiceNumber}` : tr('Non spécifié', 'غير محدد')}
            </p>
            <p className="text-slate-600">
              {tr('Mode :', 'الطريقة:')}{' '}
              {transaction.paymentMethod
                ? PAYMENT_METHOD_LABELS[transaction.paymentMethod] || transaction.paymentMethod
                : tr('Virement', 'تحويل')}
            </p>
            <p className="text-slate-600 font-mono">
              {tr('Réf / Chèque :', 'المرجع / الشيك:')} {transaction.reference || 'S/N'} · {transaction.bankName || tr('Banque', 'البنك')}
            </p>
          </div>
        </div>

        {(transaction.thirdPartyName || transaction.thirdPartyIce || transaction.lotNumber) && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
            <div>
              <span className="text-[11px] text-slate-500 block">{tr('Bénéficiaire / Payeur :', 'المستفيد / الدافع:')}</span>
              <span className="font-bold text-slate-800 text-sm">
                {transaction.thirdPartyName || tr('Tiers', 'طرف ثالث')}
              </span>
            </div>
            <div className="text-end">
              {transaction.thirdPartyIce && (
                <span className="inline-block bg-white border border-slate-200 font-mono px-2 py-0.5 rounded text-[11px] text-slate-600">
                  ICE : {transaction.thirdPartyIce}
                </span>
              )}
              {transaction.lotNumber && (
                <span className="inline-block bg-teal-50 border border-teal-200 text-teal-800 font-medium px-2 py-0.5 rounded text-[11px]">
                  {tr('Lot', 'شقة')} {transaction.lotNumber}
                </span>
              )}
            </div>
          </div>
        )}

        {transaction.notes && (
          <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg">
            <span className="text-[11px] font-semibold text-amber-900 block">
              {tr("Notes / décision d'AG :", 'ملاحظات وقرار الجمع العام:')}
            </span>
            <p className="text-slate-700 mt-0.5 italic">{transaction.notes}</p>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default TransactionDetailModal;
