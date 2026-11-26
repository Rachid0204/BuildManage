import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, PaymentMethod, Prestataire, Transaction } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import InfoTip from '../../../common/InfoTip';
import { addTransaction } from '../../../../firebase/services';
import { useI18n } from '../../../../hooks/useI18n';
import { currencyFormatter, MOROCCAN_BANKS } from '../financeConstants';
import type { FinanceOverviewStats } from '../financeSelectors';

export type TransactionModalRequest =
  | { mode: 'expense'; nonce: number }
  | { mode: 'income'; nonce: number }
  | null;

interface TransactionFormModalProps {
  building: Building;
  prestataires: Prestataire[];
  stats: FinanceOverviewStats;
  request: TransactionModalRequest;
  onClose: () => void;
}

const TransactionFormModal: React.FC<TransactionFormModalProps> = ({
  building,
  prestataires,
  stats,
  request,
  onClose,
}) => {
  const { tr } = useI18n();
  const queryClient = useQueryClient();

  const [trxDetailsOpen, setTrxDetailsOpen] = useState(false);
  const [trxType, setTrxType] = useState<'income' | 'expense'>('expense');
  const [fundType, setFundType] = useState<'courant' | 'reserve'>('courant');
  const [trxDesc, setTrxDesc] = useState('');
  const [trxAmount, setTrxAmount] = useState('');
  const [trxCategory, setTrxCategory] = useState<Transaction['category']>('maintenance');
  const [trxDate, setTrxDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [trxPaymentMethod, setTrxPaymentMethod] = useState<PaymentMethod>('virement');
  const [trxReference, setTrxReference] = useState('');
  const [trxDocumentType, setTrxDocumentType] = useState<Transaction['documentType']>('facture');
  const [trxInvoiceNumber, setTrxInvoiceNumber] = useState('');
  const [selectedPrestataireId, setSelectedPrestataireId] = useState('');
  const [trxThirdPartyName, setTrxThirdPartyName] = useState('');
  const [trxThirdPartyIce, setTrxThirdPartyIce] = useState('');
  const [selectedApartmentId, setSelectedApartmentId] = useState('');
  const [trxBankName, setTrxBankName] = useState(building.bankName || '');
  const [trxNotes, setTrxNotes] = useState('');
  const [overdraftOverrideReason, setOverdraftOverrideReason] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const resetTrxForm = (mode: 'expense' | 'income' = 'expense') => {
    setTrxType(mode);
    setFundType('courant');
    setTrxDesc('');
    setTrxAmount('');
    setTrxCategory(mode === 'expense' ? 'maintenance' : 'fees');
    setTrxDate(new Date().toISOString().split('T')[0]);
    setTrxPaymentMethod('virement');
    setTrxReference('');
    setTrxDocumentType(mode === 'expense' ? 'facture' : 'recu');
    setTrxInvoiceNumber('');
    setSelectedPrestataireId('');
    setTrxThirdPartyName('');
    setTrxThirdPartyIce('');
    setSelectedApartmentId('');
    setTrxBankName(building.bankName || '');
    setTrxNotes('');
    setOverdraftOverrideReason('');
    setFormErrors({});
    setTrxDetailsOpen(false);
  };

  useEffect(() => {
    if (!request) return;
    resetTrxForm(request.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce, request?.mode]);

  const addTrxMutation = useMutation({
    mutationFn: (data: Omit<Transaction, 'id'>) => addTransaction(building.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      resetTrxForm('expense');
      onClose();
    },
  });

  const handleSelectPrestataire = (pId: string) => {
    setSelectedPrestataireId(pId);
    if (!pId) {
      setTrxThirdPartyName('');
      setTrxThirdPartyIce('');
      return;
    }
    const found = prestataires.find((p) => p.id === pId);
    if (found) {
      setTrxThirdPartyName(found.name);
      setTrxThirdPartyIce(found.ice || '');
      if (found.category === 'elevator') setTrxCategory('elevator');
      else if (found.category === 'cleaning') setTrxCategory('cleaning');
      else if (found.category === 'plumbing' || found.category === 'electrical') setTrxCategory('maintenance');
      if (!trxDesc) {
        setTrxDesc(tr(`Facture entretien/intervention - ${found.name}`, `فاتورة صيانة/تدخل - ${found.name}`));
      }
    }
  };

  const handleSelectApartment = (aptId: string) => {
    setSelectedApartmentId(aptId);
    if (!aptId) {
      setTrxThirdPartyName('');
      return;
    }
    const apt = building.apartments.find((a) => a.id === aptId);
    if (apt) {
      const res = building.residents.find((r) => r.id === (apt.ownerId || apt.tenantId));
      const resName = res?.name || tr('Copropriétaire', 'مالك مشترك');
      setTrxThirdPartyName(resName);
      if (!trxDesc) {
        setTrxDesc(
          tr(
            `Règlement cotisation charges - Lot ${apt.number} (${resName})`,
            `تسديد واجبات السنديك - شقة ${apt.number} (${resName})`,
          ),
        );
      }
      if (!trxAmount) {
        setTrxAmount(String(apt.monthlyFees || building.monthlySyndicFees));
      }
    }
  };

  const handleSubmitTransaction = async () => {
    const errors: Record<string, string> = {};
    const numericAmount = parseFloat(trxAmount);
    const currentBal = fundType === 'reserve' ? stats.reserveFund : stats.balance;
    const isOverdraft =
      trxType === 'expense' &&
      Number.isFinite(numericAmount) &&
      Math.round((currentBal - numericAmount) * 100) < 0;

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      errors.amount = tr('Veuillez saisir un montant valide strictement supérieur à 0 MAD', 'يرجى إدخال مبلغ صحيح أكبر من 0 درهم');
    }

    if (!trxDesc.trim()) {
      errors.description = tr("Le libellé de l'opération est obligatoire (Art. 26 Loi 18-00)", 'بيان العملية إجباري (المادة 26 من القانون 18-00)');
    }

    if (trxType === 'expense' && !trxThirdPartyName.trim()) {
      errors.thirdParty = tr('Veuillez renseigner le prestataire, fournisseur ou bénéficiaire', 'يرجى تحديد اسم المهني، المورد أو المستفيد');
    }

    if (trxType === 'expense' && !trxInvoiceNumber.trim()) {
      errors.invoiceNumber = tr('Le N° de facture ou pièce justificative est obligatoire (Loi 18-00)', 'رقم الفاتورة أو الوثيقة المثبتة إجباري (القانون 18-00)');
    }

    if (isOverdraft && overdraftOverrideReason.trim().length < 3) {
      errors.overdraftOverrideReason = tr(
        'Le solde du fonds sélectionné est insuffisant : indiquez un motif de dépassement (min. 3 caractères).',
        'رصيد الصندوق المحدد غير كافٍ: يرجى إدخال سبب لتجاوز الرصيد (3 أحرف على الأقل).',
      );
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      throw new Error(Object.values(errors).join('\n'));
    }

    if (!trxDate || Number.isNaN(Date.parse(trxDate))) {
      throw new Error(tr('Indiquez une date valide.', 'أدخل تاريخاً صالحاً.'));
    }
    setFormErrors({});

    return addTrxMutation.mutateAsync({
      date: trxDate,
      description: trxDesc.trim(),
      amount: numericAmount,
      type: trxType,
      fundType,
      category: trxCategory,
      paymentMethod: trxPaymentMethod,
      reference: trxReference.trim() || undefined,
      documentType: trxDocumentType,
      invoiceNumber: trxInvoiceNumber.trim() || undefined,
      thirdPartyName: trxThirdPartyName.trim() || undefined,
      thirdPartyIce: trxThirdPartyIce.trim() || undefined,
      lotNumber: selectedApartmentId
        ? building.apartments.find((a) => a.id === selectedApartmentId)?.number
        : undefined,
      bankName: trxBankName,
      notes: trxNotes.trim() || undefined,
      overdraftOverrideReason: isOverdraft ? overdraftOverrideReason.trim() : undefined,
    });
  };

  const handleClose = () => {
    resetTrxForm('expense');
    onClose();
  };

  const currentBal = fundType === 'reserve' ? stats.reserveFund : stats.balance;
  const numericAmt = parseFloat(trxAmount) || 0;
  const projBal = trxType === 'income' ? currentBal + numericAmt : currentBal - numericAmt;
  const isOverdraft = trxType === 'expense' && numericAmt > 0 && Math.round(projBal * 100) < 0;

  return (
    <Modal
      isOpen={Boolean(request)}
      onSubmit={handleSubmitTransaction}
      busy={addTrxMutation.isPending}
      onClose={handleClose}
      title={
        trxType === 'expense'
          ? tr('Enregistrer une dépense', 'تسجيل مصروف')
          : tr('Enregistrer une recette', 'تسجيل مدخول')
      }
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <span className="text-[11px] text-slate-500 hidden sm:inline-flex items-center gap-1">
            <span>{tr('* Champs obligatoires', '* حقول إجبارية')}</span>
            <InfoTip label={tr('Obligation légale de justificatif', 'الإلزام القانوني للوثائق المثبتة')}>
              {tr(
                'Article 26 de la Loi n° 18-00 : chaque dépense de la copropriété doit être appuyée par une pièce justificative numérotée.',
                'المادة 26 من القانون 18-00: يجب أن يستند كل مصروف للملكية المشتركة إلى وثيقة مثبتة مرقمة.',
              )}
            </InfoTip>
          </span>
          <div className="flex gap-2 ms-auto">
            <Button variant="secondary" onClick={handleClose}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button
              type="submit"
              disabled={addTrxMutation.isPending}
              className="bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
            >
              {addTrxMutation.isPending
                ? tr('Enregistrement...', 'جاري الحفظ...')
                : tr('Valider & Enregistrer', 'تأكيد وحفظ')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto px-1">
        {/* Compact Expense / Income Switcher */}
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setTrxType('expense');
              setTrxCategory('maintenance');
              setTrxDocumentType('facture');
              setFundType('courant');
            }}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 ${
              trxType === 'expense'
                ? 'bg-white text-rose-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-600" />
            <span>{tr('Dépense (-)', 'مصروف (-)')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTrxType('income');
              setTrxCategory('fees');
              setTrxDocumentType('recu');
              setFundType('courant');
            }}
            className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 ${
              trxType === 'income'
                ? 'bg-white text-emerald-800 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-600" />
            <span>{tr('Recette (+)', 'مدخول (+)')}</span>
          </button>
        </div>

        {/* BLOCK 1: L'ESSENTIEL */}
        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {tr("L'essentiel", 'المعلومات الأساسية')}
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Montant (MAD) *', 'المبلغ (درهم) *')}
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={trxAmount}
                  onChange={(e) => {
                    setTrxAmount(e.target.value);
                    if (formErrors.amount) setFormErrors({ ...formErrors, amount: '' });
                  }}
                  placeholder="0.00"
                  className={`w-full px-3 py-2 border rounded-lg text-sm font-mono font-bold pe-12 bg-white ${
                    formErrors.amount ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                  }`}
                />
                <span className="absolute end-3 top-2.5 text-xs text-slate-400 font-mono font-bold">
                  MAD
                </span>
              </div>
              {formErrors.amount && (
                <p className="text-[10px] text-rose-600 mt-1">{formErrors.amount}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Catégorie *', 'الفئة *')}
              </label>
              <select
                value={trxCategory}
                onChange={(e) => {
                  const nextCat = e.target.value as Transaction['category'];
                  setTrxCategory(nextCat);
                  setFundType(nextCat === 'reserve' ? 'reserve' : 'courant');
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              >
                {trxType === 'expense' ? (
                  <>
                    <option value="maintenance">{tr('Maintenance & Dépannages', 'الصيانة والإصلاحات')}</option>
                    <option value="elevator">{tr('Ascenseur & Équipements', 'المصعد والتجهيزات')}</option>
                    <option value="salary">{tr('Salaires (Gardien / Concierge)', 'رواتب (الحارس / البواب)')}</option>
                    <option value="utility">{tr('Électricité & Eau', 'الكهرباء والماء')}</option>
                    <option value="cleaning">{tr('Nettoyage & Produits', 'النظافة ومواد التنظيف')}</option>
                    <option value="insurance">{tr('Assurance immeuble', 'تأمين العمارة')}</option>
                    <option value="bank_fees">{tr('Frais bancaires', 'المصاريف البنكية')}</option>
                    <option value="legal">{tr('Frais juridiques & recouvrement', 'أتعاب المنازعات والتحصيل')}</option>
                    <option value="reserve">{tr('Gros travaux (Fonds de réserve)', 'الأشغال الكبرى (صندوق الاحتياط)')}</option>
                    <option value="other">{tr('Autre dépense', 'مصروف آخر')}</option>
                  </>
                ) : (
                  <>
                    <option value="fees">{tr('Cotisations copropriété', 'مساهمات الملكية المشتركة')}</option>
                    <option value="reserve">{tr('Apport fonds de réserve travaux', 'مساهمة صندوق احتياط الأشغال')}</option>
                    <option value="reimbursement">{tr('Remboursement assurance / sinistre', 'تعويض تأمين')}</option>
                    <option value="other">{tr('Autre recette', 'مدخول آخر')}</option>
                  </>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Date *', 'التاريخ *')}
              </label>
              <input
                type="date"
                value={trxDate}
                onChange={(e) => setTrxDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Libellé (courte description) *', 'البيان (وصف مختصر) *')}
            </label>
            <input
              type="text"
              value={trxDesc}
              onChange={(e) => {
                setTrxDesc(e.target.value);
                if (formErrors.description) setFormErrors({ ...formErrors, description: '' });
              }}
              placeholder={
                trxType === 'expense'
                  ? tr('Ex: Réparation pompe à eau', 'مثال: إصلاح مضخة المياه')
                  : tr('Ex: Remboursement sinistre dégât des eaux', 'مثال: تعويض تأمين')
              }
              className={`w-full px-3 py-2 border rounded-lg text-xs bg-white ${
                formErrors.description ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
              }`}
            />
            {formErrors.description && (
              <p className="text-[10px] text-rose-600 mt-0.5">{formErrors.description}</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex items-center gap-1.5 text-slate-600">
              <span>
                {trxType === 'expense'
                  ? tr('Payé depuis :', 'مدفوع من:')
                  : tr('Versé sur :', 'مودع في:')}
              </span>
              <select
                aria-label={tr('Fonds concerné', 'الصندوق المعني')}
                value={fundType}
                onChange={(e) => {
                  const nextFund = e.target.value === 'reserve' ? 'reserve' : 'courant';
                  setFundType(nextFund);
                  if (nextFund === 'reserve') setTrxCategory('reserve');
                }}
                className="px-2 py-1 border border-slate-300 rounded-md bg-white font-semibold text-slate-800 text-xs"
              >
                <option value="courant">{tr('Compte courant', 'الحساب الجاري')}</option>
                <option value="reserve">{tr('Fonds de réserve', 'صندوق الاحتياط')}</option>
              </select>
              <InfoTip label={tr('Choix du fonds', 'اختيار الصندوق')}>
                {tr(
                  'Compte courant : dépenses habituelles (eau, électricité, gardiennage, entretien). Fonds de réserve (Loi 106-12) : gros travaux votés.',
                  'الحساب الجاري: المصاريف العادية (الماء، الكهرباء، الحراسة، الصيانة). صندوق الاحتياط (القانون 106-12): الأشغال الكبرى.',
                )}
              </InfoTip>
            </div>
          </div>
        </div>

        {/* BLOCK 2: JUSTIFICATIF */}
        <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-3">
          <div className="flex items-center gap-1.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              {tr('Justificatif & bénéficiaire', 'الوثيقة المثبتة والمستفيد')}
            </h4>
            <InfoTip label={tr('Justificatif obligatoire', 'الوثيقة المثبتة إجبارية')}>
              {tr(
                'Conservez le numéro de facture ou de reçu pour le contrôle des comptes en Assemblée Générale (Art. 26 Loi 18-00).',
                'احتفظ برقم الفاتورة أو الإيصال لمراقبة الحسابات في الجمع العام (المادة 26 من القانون 18-00).',
              )}
            </InfoTip>
          </div>

          {trxType === 'expense' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {tr('Prestataire enregistré (optionnel)', 'مهني مسجل (اختياري)')}
                </label>
                <select
                  value={selectedPrestataireId}
                  onChange={(e) => handleSelectPrestataire(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="">{tr('-- Saisir un autre fournisseur --', '-- إدخال مورد آخر --')}</option>
                  {prestataires.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.ice ? `(ICE: ${p.ice})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {tr('Nom / Raison sociale du prestataire *', 'اسم الشركة أو المهني *')}
                </label>
                <input
                  type="text"
                  value={trxThirdPartyName}
                  onChange={(e) => {
                    setTrxThirdPartyName(e.target.value);
                    if (formErrors.thirdParty) setFormErrors({ ...formErrors, thirdParty: '' });
                  }}
                  placeholder="Ex: Atlas Ascenseurs SARL"
                  className={`w-full px-3 py-1.5 border rounded-lg text-xs ${
                    formErrors.thirdParty ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                  }`}
                />
                {formErrors.thirdParty && (
                  <p className="text-[10px] text-rose-600 mt-0.5">{formErrors.thirdParty}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {tr('Lot concerné (optionnel)', 'الشقة المعنية (اختياري)')}
                </label>
                <select
                  value={selectedApartmentId}
                  onChange={(e) => handleSelectApartment(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="">{tr('-- Aucun lot (recette générale) --', '-- بدون شقة محددة (مدخول عام) --')}</option>
                  {building.apartments.map((apt) => {
                    const res = building.residents.find((r) => r.id === (apt.ownerId || apt.tenantId));
                    return (
                      <option key={apt.id} value={apt.id}>
                        {tr('Lot', 'شقة')} {apt.number} ({res?.name || tr('Copropriétaire', 'مالك مشترك')})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {tr('Payé par (nom)', 'الدافع (الاسم)')}
                </label>
                <input
                  type="text"
                  value={trxThirdPartyName}
                  onChange={(e) => setTrxThirdPartyName(e.target.value)}
                  placeholder="Ex: Compagnie d'assurance"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                {tr('Type de justificatif *', 'نوع الوثيقة *')}
              </label>
              <select
                value={trxDocumentType}
                onChange={(e) => setTrxDocumentType(e.target.value as Transaction['documentType'])}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
              >
                <option value="facture">{tr('Facture', 'فاتورة')}</option>
                <option value="recu">{tr('Reçu / Décharge', 'إيصال / إبراء')}</option>
                <option value="releve">{tr('Relevé bancaire', 'كشف بنكي')}</option>
                <option value="devis">{tr('Devis validé en AG', 'عرض سعر مصادق عليه')}</option>
                <option value="quittance">{tr('Quittance', 'وصل أداء')}</option>
                <option value="autre">{tr('Autre document', 'وثيقة أخرى')}</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                {tr(
                  trxType === 'expense' ? 'N° de Facture ou reçu *' : 'N° de Facture ou reçu',
                  trxType === 'expense' ? 'رقم الفاتورة أو الإيصال *' : 'رقم الوثيقة أو الإيصال',
                )}
              </label>
              <input
                type="text"
                value={trxInvoiceNumber}
                onChange={(e) => {
                  setTrxInvoiceNumber(e.target.value);
                  if (formErrors.invoiceNumber) setFormErrors({ ...formErrors, invoiceNumber: '' });
                }}
                placeholder="Ex: FAC-2026-089"
                className={`w-full px-3 py-1.5 border rounded-lg text-xs font-mono ${
                  formErrors.invoiceNumber ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                }`}
              />
              {formErrors.invoiceNumber && (
                <p className="text-[10px] text-rose-600 mt-0.5">{formErrors.invoiceNumber}</p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-700 mb-1">
                {tr('Mode de paiement *', 'طريقة الأداء *')}
              </label>
              <select
                value={trxPaymentMethod}
                onChange={(e) => setTrxPaymentMethod(e.target.value as PaymentMethod)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
              >
                <option value="virement">{tr('Virement bancaire', 'تحويل بنكي')}</option>
                <option value="cheque">{tr('Chèque', 'شيك')}</option>
                <option value="versement">{tr('Versement agence', 'إيداع بنكي')}</option>
                <option value="especes">{tr('Espèces', 'نقداً')}</option>
              </select>
            </div>
          </div>
        </div>

        {/* BLOCK 3: PLUS DE DÉTAILS (COLLAPSED BY DEFAULT) */}
        <details
          open={trxDetailsOpen}
          onToggle={(e) => setTrxDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="rounded-xl border border-slate-200 bg-slate-50/70"
        >
          <summary className="px-3.5 py-2.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
            {tr('Plus de détails (optionnel : ICE, chèque, banque, notes)', 'تفاصيل إضافية (اختياري: ICE، شيك، بنك، ملاحظات)')}
          </summary>
          <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-slate-200/70">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {trxType === 'expense' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    {tr('ICE du prestataire (15 chiffres)', 'رقم ICE للمهني (15 رقماً)')}
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    value={trxThirdPartyIce}
                    onChange={(e) => setTrxThirdPartyIce(e.target.value)}
                    placeholder="Ex: 001988223000089"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {tr('N° Chèque / Réf. virement', 'رقم الشيك / مرجع التحويل')}
                </label>
                <input
                  type="text"
                  value={trxReference}
                  onChange={(e) => setTrxReference(e.target.value)}
                  placeholder="Ex: CHQ 894120"
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">
                  {tr('Banque', 'البنك')}
                </label>
                <select
                  value={trxBankName}
                  onChange={(e) => setTrxBankName(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  {MOROCCAN_BANKS.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                {tr("Notes / décision d'AG", 'ملاحظات / قرار الجمع العام')}
              </label>
              <input
                type="text"
                value={trxNotes}
                onChange={(e) => setTrxNotes(e.target.value)}
                placeholder={tr('Ex: Résolution N° 3 votée en AG', 'مثال: القرار رقم 3 المصوت عليه في الجمع العام')}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
              />
            </div>
          </div>
        </details>

        <div className="space-y-3">
          <div
            className={`p-3 border rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs ${
              isOverdraft ? 'bg-rose-50/80 border-rose-300' : 'bg-teal-50/70 border-teal-200'
            }`}
          >
            <span className={`font-semibold ${isOverdraft ? 'text-rose-900' : 'text-teal-900'}`}>
              {fundType === 'reserve'
                ? tr('Solde fonds de réserve après opération :', 'رصيد صندوق الاحتياط بعد العملية:')
                : tr('Argent disponible après opération :', 'الرصيد المتاح بعد العملية:')}
            </span>
            <span className={`font-mono font-bold text-sm ${isOverdraft ? 'text-rose-800' : 'text-teal-900'}`}>
              {currencyFormatter.format(projBal)}{' '}
              <span className="text-[11px] font-normal text-slate-600">
                ({tr('actuel :', 'الحالي:')} {currencyFormatter.format(currentBal)})
              </span>
            </span>
          </div>

          {isOverdraft && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-1.5">
              <label className="block text-xs font-bold text-amber-950">
                {tr(
                  "Le fonds n'a pas assez d'argent. Expliquez pourquoi vous enregistrez quand même *",
                  'رصيد الصندوق غير كافٍ. وضح سبب تسجيل العملية رغم ذلك *',
                )}
              </label>
              <input
                type="text"
                value={overdraftOverrideReason}
                onChange={(e) => {
                  setOverdraftOverrideReason(e.target.value);
                  if (formErrors.overdraftOverrideReason) {
                    setFormErrors({ ...formErrors, overdraftOverrideReason: '' });
                  }
                }}
                placeholder={tr(
                  'Ex: Avance urgente validée par le conseil syndical',
                  'مثال: تسبيق استعجالي مصادق عليه',
                )}
                className={`w-full px-3 py-1.5 border rounded-lg text-xs bg-white ${
                  formErrors.overdraftOverrideReason ? 'border-rose-400 bg-rose-50' : 'border-amber-300'
                }`}
              />
              {formErrors.overdraftOverrideReason && (
                <p className="text-[10px] text-rose-600">{formErrors.overdraftOverrideReason}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default TransactionFormModal;
