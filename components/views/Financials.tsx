import BillingFailures from './BillingFailures';
import FinancialTools from './FinancialTools';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Transaction, Charge, Syndic, Quittance, PaymentMethod, Invoice } from '../../types';
import Button from '../common/Button';
import Modal from '../common/Modal';
import InfoTip from '../common/InfoTip';
import FinanceActionBar, { FinanceMoreMenu } from './finance/FinanceActionBar';
import FinanceTodoPanel from './finance/FinanceTodoPanel';
import FinanceKpiCards from './finance/FinanceKpiCards';
import FinanceTabBar from './finance/FinanceTabBar';
import TransactionsTab from './finance/tabs/TransactionsTab';
import ChargesTab from './finance/tabs/ChargesTab';
import VerificationsTab from './finance/tabs/VerificationsTab';
import QuittancesTab from './finance/tabs/QuittancesTab';
import OverdueTab from './finance/tabs/OverdueTab';
import { buildFinanceTodos } from './finance/financeTodos';
import {
  PlusIcon,
  FinancialsIcon,
  QuittanceIcon,
  DocumentsIcon,
} from '../icons/IconComponents';
import {
  getChargesForBuilding,
  getInvoicesForBuilding,
  recordPayment,
  voidInvoice,
  getPaymentProofsForBuilding,
  type UnmatchedBankCsvRow,
  getQuittancesForBuilding,
  createQuittance,
  addTransaction,
  transferFunds,
  reverseExpense,
  generateMonthlyCharges,
  getPrestatairesForBuilding,
} from '../../firebase/services';
import {
  generateQuittancePDF,
  generateTransactionVoucherPDF,
  exportAnnualRepartitionPDF,
} from '../../services/pdfOnDemand';
import {
  splitChargeReserveAndOperating,
  getBuildingReserveRate,
  resolveChargeReserveRate,
  isIncomeTransaction,
  signedTransactionAmount,
} from '../../utils/security';
import { todayCasablancaIsoDate } from '../../shared/moroccoDate';
import Loading from '../common/Loading';
import { useI18n } from '../../hooks/useI18n';
import { useToast } from '../common/Toast';
import {
  type FinanceTabType,
  currencyFormatter,
  MOROCCAN_BANKS,
  formatRecordedFund as formatRecordedFundHelper,
  buildCategoryLabels,
  buildPaymentMethodLabels,
  buildDocumentTypeLabels,
} from './finance/financeConstants';
import {
  computeAvailableFiscalYears,
  computeHasBillableLots,
  computeChargePreview,
  computeFinanceOverviewStats,
  groupOverdueChargesByResident,
  computeAgingBuckets,
} from './finance/financeSelectors';

interface FinancialsProps {
  building: Building;
  syndic?: Syndic;
  onAddTransaction?: () => void;
  onGenerateCharges?: () => void;
}

const FinancialsView: React.FC<FinancialsProps> = ({ building, syndic }) => {
  const { tr, isAr } = useI18n();
  const formatRecordedFund = (receipt: Quittance, fund: 'reserveFundAmount' | 'chargesCourantesAmount') =>
    formatRecordedFundHelper(receipt, fund, tr);
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<FinanceTabType>('charges');
  const [isTrxModalOpen, setIsTrxModalOpen] = useState(false);
  const [trxDetailsOpen, setTrxDetailsOpen] = useState(false);
  const [quittanceAccountingOpen, setQuittanceAccountingOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [selectedTrxForView, setSelectedTrxForView] = useState<Transaction | null>(null);

  const CATEGORY_LABELS = useMemo(() => buildCategoryLabels(tr), [tr]);
  const PAYMENT_METHOD_LABELS = useMemo(() => buildPaymentMethodLabels(tr), [tr]);
  const DOCUMENT_TYPE_LABELS = useMemo(() => buildDocumentTypeLabels(tr), [tr]);

  // Filter state shared between KPI cards and TransactionsTab
  const [filterFund, setFilterFund] = useState<'all' | 'courant' | 'reserve'>('all');

  // Comprehensive Law 18-00 Transaction Form State
  const [trxType, setTrxType] = useState<'income' | 'expense'>('expense');
  const [fundType, setFundType] = useState<'courant' | 'reserve'>('courant');
  const [trxDesc, setTrxDesc] = useState('');
  const [trxAmount, setTrxAmount] = useState('');
  const [trxCategory, setTrxCategory] = useState<Transaction['category']>('maintenance');
  const [trxDate, setTrxDate] = useState(new Date().toISOString().split('T')[0]);
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

  // Fund Transfer Modal State
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferFromFund, setTransferFromFund] = useState<'courant' | 'reserve'>('courant');
  const [transferToFund, setTransferToFund] = useState<'courant' | 'reserve'>('reserve');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferDate, setTransferDate] = useState(new Date().toISOString().split('T')[0]);
  const [transferReason, setTransferReason] = useState('');

  // Expense Reversal Modal State
  const [reverseExpenseTarget, setReverseExpenseTarget] = useState<Transaction | null>(null);
  const [reverseExpenseReason, setReverseExpenseReason] = useState('');

  // Fiscal Year, Voided Quittances, Invoices & CSV Unmatched State
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(() => new Date().getFullYear());
  const [showVoidedQuittances, setShowVoidedQuittances] = useState(false);
  const [unmatchedCsvRows, setUnmatchedCsvRows] = useState<UnmatchedBankCsvRow[]>([]);
  const [payInvoiceTarget, setPayInvoiceTarget] = useState<Invoice | null>(null);
  const [payInvoiceAmount, setPayInvoiceAmount] = useState('');
  const [payInvoiceMethod, setPayInvoiceMethod] = useState<PaymentMethod>('virement');
  const [payInvoiceReference, setPayInvoiceReference] = useState('');
  const [payInvoiceDate, setPayInvoiceDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [voidInvoiceTarget, setVoidInvoiceTarget] = useState<Invoice | null>(null);
  const [voidInvoiceReason, setVoidInvoiceReason] = useState('');

  // Charge Generation Form State
  const [useTantiemes, setUseTantiemes] = useState(false);
  const [periodName, setPeriodName] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [totalBudgetInput, setTotalBudgetInput] = useState(
    String(
      building.apartments.reduce(
        (acc, a) => acc + (a.monthlyFees ?? building.monthlySyndicFees ?? 0),
        0
      )
    )
  );

  // Quittance Generator State (Loi 18-00 & Loi 106-12)
  const [isQuittanceModalOpen, setIsQuittanceModalOpen] = useState(false);
  const [selectedQuittanceForPreview, setSelectedQuittanceForPreview] = useState<Quittance | null>(null);
  const [quittancePaymentId, setQuittancePaymentId] = useState(() => crypto.randomUUID());
  const [quittanceChargeId, setQuittanceChargeId] = useState('');
  const [quittanceApartmentId, setQuittanceApartmentId] = useState('');
  const [quittanceResidentId, setQuittanceResidentId] = useState('');
  const [quittanceResidentCin, setQuittanceResidentCin] = useState('');
  const [quittancePeriod, setQuittancePeriod] = useState(
    new Date().toLocaleDateString(isAr ? 'ar-MA' : 'fr-FR', { month: 'long', year: 'numeric' })
  );
  const [quittanceAmount, setQuittanceAmount] = useState('');
  const [quittanceReserveRatio, setQuittanceReserveRatio] = useState(
    getBuildingReserveRate(building)
  );
  const [quittancePaymentMethod, setQuittancePaymentMethod] = useState<PaymentMethod>('virement');
  const [quittanceBankName, setQuittanceBankName] = useState(building.bankName || '');
  const [quittanceReference, setQuittanceReference] = useState('');
  const [quittancePaymentDate, setQuittancePaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [quittanceBankTransactionDate, setQuittanceBankTransactionDate] = useState('');
  const [quittancePostingDate, setQuittancePostingDate] = useState('');
  const [quittanceAdjustmentReason, setQuittanceAdjustmentReason] = useState('');
  const [quittanceRemarks, setQuittanceRemarks] = useState('');
  const lastSyncedQuittanceKeyRef = useRef<string>('');

  // Queries
  const { data: charges = [], isLoading: loadingCharges } = useQuery({
    queryKey: ['charges', building.id],
    queryFn: () => getChargesForBuilding(building.id),
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', building.id],
    queryFn: () => getInvoicesForBuilding(building.id),
  });

  const { data: paymentProofs = [], isLoading: loadingProofs } = useQuery({
    queryKey: ['proofs', building.id],
    queryFn: () => getPaymentProofsForBuilding(building.id),
  });

  const { data: quittances = [], isLoading: loadingQuittances } = useQuery({
    queryKey: ['quittances', building.id, showVoidedQuittances],
    queryFn: () => getQuittancesForBuilding(building.id, { includeVoided: showVoidedQuittances }),
  });

  const { data: prestataires = [] } = useQuery({
    queryKey: ['prestataires', building.id],
    queryFn: () => getPrestatairesForBuilding(building.id),
  });

  const buildingTantiemesBase = building.totalTantiemes || 1000;

  const availableFiscalYears = useMemo(() => computeAvailableFiscalYears(charges), [charges]);

  const openChargeGeneration = () => {
    setUseTantiemes(false);
    setTotalBudgetInput(String(building.apartments
      .filter((a: any) => !a.archivedAt)
      .reduce((sum, a) => sum + (a.monthlyFees ?? building.monthlySyndicFees ?? 0), 0)));
    setIsGenerateModalOpen(true);
  };
  const { chargePreview, vacantLotsInTantiemesMode } = useMemo(
    () =>
      computeChargePreview({
        building,
        charges,
        periodName,
        useTantiemes,
        totalBudgetInput,
      }),
    [building, charges, periodName, totalBudgetInput, useTantiemes]
  );

  // Reset form helper
  const resetTrxForm = () => {
    setTrxType('expense');
    setFundType('courant');
    setTrxDesc('');
    setTrxAmount('');
    setTrxCategory('maintenance');
    setTrxDate(new Date().toISOString().split('T')[0]);
    setTrxPaymentMethod('virement');
    setTrxReference('');
    setTrxDocumentType('facture');
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

  const openExpenseModal = () => {
    resetTrxForm();
    setTrxType('expense');
    setTrxCategory('maintenance');
    setTrxDocumentType('facture');
    setFundType('courant');
    setIsTrxModalOpen(true);
  };

  const openIncomeModal = () => {
    resetTrxForm();
    setTrxType('income');
    setTrxCategory('fees');
    setTrxDocumentType('recu');
    setFundType('courant');
    setIsTrxModalOpen(true);
  };

  // Mutations
  const addTrxMutation = useMutation({
    mutationFn: (data: Omit<Transaction, 'id'>) => addTransaction(building.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      setIsTrxModalOpen(false);
      resetTrxForm();
    },
  });

  const transferFundsMutation = useMutation({
    mutationFn: (input: { fromFund: 'courant' | 'reserve'; toFund: 'courant' | 'reserve'; amount: number; date: string; reason: string }) =>
      transferFunds(building.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      setIsTransferModalOpen(false);
      setTransferAmount('');
      setTransferReason('');
      showToast(tr('Virement interne entre fonds enregistré.', 'تم تسجيل التحويل الداخلي بين الصناديق.'), 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const reverseExpenseMutation = useMutation({
    mutationFn: (input: { transactionId: string; reason: string }) =>
      reverseExpense(building.id, input.transactionId, input.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      setReverseExpenseTarget(null);
      setReverseExpenseReason('');
      setSelectedTrxForView(null);
      showToast(tr('Dépense contrepassée sans effacer l’écriture d’origine.', 'تم عكس المصروف مع الاحتفاظ بالقيد الأصلي.'), 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

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
      setIsGenerateModalOpen(false);
      showToast(
        tr('Appel de fonds généré avec succès.', 'تم إصدار طلب المساهمات بنجاح.'),
        'success'
      );
    },
  });

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
        input.date ? { bankTransactionDate: input.date } : undefined
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      setPayInvoiceTarget(null);
      setPayInvoiceAmount('');
      setPayInvoiceReference('');
      showToast(
        tr('Règlement de la facture enregistré et ventilé sur les charges.', 'تم تسجيل أداء الفاتورة وتوزيعه على المساهمات.'),
        'success'
      );
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const voidInvoiceMutation = useMutation({
    mutationFn: (input: { invoiceId: string; reason: string }) =>
      voidInvoice(building.id, input.invoiceId, input.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      setVoidInvoiceTarget(null);
      setVoidInvoiceReason('');
      showToast(tr('Facture / avis annulé.', 'تم إلغاء الفاتورة / الإشعار.'), 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  // Open Quittance Modal for a specific charge (with optional bank CSV prefill)
  const openQuittanceModalForCharge = (
    charge: Charge,
    prefill?: { amount?: number; reference?: string; bankDate?: string; remarks?: string }
  ) => {
    const res = building.residents.find((r) => r.id === charge.residentId);
    const remaining = Math.max(0, Math.round((charge.amount - (charge.paidAmount ?? 0)) * 100)) / 100;
    const prefilledAmount =
      prefill?.amount !== undefined && prefill.amount > 0
        ? Math.min(remaining > 0 ? remaining : charge.amount, prefill.amount)
        : charge.status === 'paid'
        ? charge.paidAmount ?? charge.amount
        : remaining;

    setQuittancePaymentId(crypto.randomUUID());
    setQuittanceChargeId(charge.id);
    setQuittanceApartmentId(charge.apartmentId);
    setQuittanceResidentId(charge.residentId);
    setQuittanceResidentCin(res?.cin || '');
    setQuittancePeriod(charge.period || '');
    setQuittanceAmount(String(prefilledAmount));
    setQuittanceReserveRatio(resolveChargeReserveRate(building, charge));
    setQuittancePaymentMethod((charge.paymentMethod as PaymentMethod) || 'virement');
    setQuittanceBankName(building.bankName || '');
    setQuittanceReference(prefill?.reference || `VIR-${charge.id.slice(-6).toUpperCase()}`);
    const defaultDate =
      prefill?.bankDate ||
      (charge.paidAt ? charge.paidAt.split('T')[0] : new Date().toISOString().split('T')[0]);
    setQuittancePaymentDate(defaultDate);
    setQuittanceBankTransactionDate(defaultDate);
    setQuittancePostingDate('');
    setQuittanceAdjustmentReason('');
    setQuittanceRemarks(
      prefill?.remarks ||
        tr(
          'Cotisation copropriété - Récépissé libératoire (Loi 18-00 / 106-12)',
          'مساهمة الملكية المشتركة - وصل إبراء الذمة (القانون 18-00 / 106-12)'
        )
    );
    lastSyncedQuittanceKeyRef.current = `${charge.id}:${prefilledAmount}`;
    setQuittanceAccountingOpen(false);
    setIsQuittanceModalOpen(true);
  };

  // Open Quittance Modal from scratch
  const openQuittanceModalNew = () => {
    const defaultApt = building.apartments[0];
    const defaultRes = defaultApt
      ? building.residents.find(
          (r) =>
            r.id === defaultApt.ownerId ||
            r.id === defaultApt.tenantId ||
            r.apartmentId === defaultApt.id
        )
      : building.residents[0];
    const amt = defaultApt ? (defaultApt.monthlyFees || building.monthlySyndicFees) : building.monthlySyndicFees;

    setQuittancePaymentId(crypto.randomUUID());
    setQuittanceChargeId('');
    setQuittanceApartmentId(defaultApt?.id || '');
    setQuittanceResidentId(defaultRes?.id || '');
    setQuittanceResidentCin(defaultRes?.cin || '');
    setQuittancePeriod(
      new Date().toLocaleDateString(isAr ? 'ar-MA' : 'fr-FR', { month: 'long', year: 'numeric' })
    );
    setQuittanceAmount(String(amt));
    setQuittanceReserveRatio(resolveChargeReserveRate(building));
    setQuittancePaymentMethod('virement');
    setQuittanceBankName(building.bankName || '');
    setQuittanceReference('');
    const today = new Date().toISOString().split('T')[0];
    setQuittancePaymentDate(today);
    setQuittanceBankTransactionDate(today);
    setQuittancePostingDate('');
    setQuittanceAdjustmentReason('');
    setQuittanceRemarks(
      tr(
        'Cotisation mensuelle copropriété - Récépissé libératoire',
        'المساهمة الشهرية للملكية المشتركة - وصل إبراء الذمة'
      )
    );
    lastSyncedQuittanceKeyRef.current = '';
    setQuittanceAccountingOpen(false);
    setIsQuittanceModalOpen(true);
  };

  const receiptCharges = charges.filter(charge => charge.apartmentId === quittanceApartmentId &&
    charge.residentId === quittanceResidentId && Math.round((charge.amount - (charge.paidAmount ?? (charge.status === 'paid' ? charge.amount : 0))) * 100) > 0);
  const receiptCharge = receiptCharges.find(charge => charge.id === quittanceChargeId);
  const receiptRemaining = receiptCharge
    ? Math.max(0, Math.round((receiptCharge.amount - (receiptCharge.paidAmount ?? 0)) * 100)) / 100 : 0;
  const receiptSelection = receiptCharge || receiptCharges[0];
  const receiptSelectionRemaining = receiptSelection
    ? Math.max(0, Math.round((receiptSelection.amount - (receiptSelection.paidAmount ?? 0)) * 100)) / 100 : 0;
  useEffect(() => {
    if (!isQuittanceModalOpen) {
      lastSyncedQuittanceKeyRef.current = '';
      return;
    }
    const selectionId = receiptSelection?.id || '';
    const syncKey = `${selectionId}:${receiptSelectionRemaining}`;
    if (lastSyncedQuittanceKeyRef.current === syncKey) return;
    // If openQuittanceModalForCharge already prefilled this exact charge (e.g., from CSV), keep user's/prefilled amount.
    const alreadyPrefilledSameCharge =
      selectionId !== '' && lastSyncedQuittanceKeyRef.current.startsWith(`${selectionId}:`);
    lastSyncedQuittanceKeyRef.current = syncKey;
    setQuittanceChargeId(selectionId);
    setQuittancePeriod(receiptSelection?.period || '');
    if (!alreadyPrefilledSameCharge) {
      setQuittanceAmount(receiptSelection ? String(receiptSelectionRemaining) : '');
    }
    setQuittanceReserveRatio(resolveChargeReserveRate(building, receiptSelection));
  }, [isQuittanceModalOpen, receiptSelection?.id, receiptSelection?.period, receiptSelection?.chargeType, receiptSelection?.worksFundTarget, receiptSelectionRemaining, building]);

  // Create Quittance Mutation
  const createQuittanceMutation = useMutation({
    mutationFn: async (payload: any) => {
      return createQuittance(payload);
    },
    onSuccess: (newQuit) => {
      queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
      setIsQuittanceModalOpen(false);

      const apt = building.apartments.find((a) => a.id === newQuit.apartmentId);
      const res = building.residents.find((r) => r.id === newQuit.residentId);
      generateQuittancePDF(newQuit, building, syndic, apt, res);
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  // Calculated Stats
  const stats = useMemo(
    () => computeFinanceOverviewStats(building, charges, paymentProofs),
    [building, charges, paymentProofs]
  );

  // Overdue Debts Grouped by Resident (supports multi-lot owners & dynamic dueDate overdue detection)
  const overdueResidents = useMemo(
    () => groupOverdueChargesByResident(charges, building, tr('Copropriétaire', 'مالك مشترك')),
    [charges, building, tr]
  );

  const currentMonthPeriod = useMemo(() => todayCasablancaIsoDate().slice(0, 7), []);
  const hasBillableLots = useMemo(
    () => computeHasBillableLots(building),
    [building]
  );

  const financeTodos = useMemo(
    () =>
      buildFinanceTodos({
        pendingProofsCount: stats.pendingProofsCount,
        overdueResidentsCount: overdueResidents.length,
        overdueAmount: stats.overdueChargesTotal,
        charges,
        currentPeriod: currentMonthPeriod,
        unmatchedBankRows: unmatchedCsvRows.length,
        hasBillableLots,
      }),
    [
      stats.pendingProofsCount,
      overdueResidents.length,
      stats.overdueChargesTotal,
      charges,
      currentMonthPeriod,
      unmatchedCsvRows.length,
      hasBillableLots,
    ],
  );

  // Balance Âgée (Aging Report buckets in integer centimes)
  const agingBuckets = useMemo(() => computeAgingBuckets(charges), [charges]);

  const activeQuittances = useMemo(
    () => quittances.filter((q) => !q.voidedAt),
    [quittances]
  );

  // Prestataire quick-select handler
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

  // Apartment/Resident quick-select handler for income
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
        setTrxDesc(tr(`Règlement cotisation charges - Lot ${apt.number} (${resName})`, `تسديد واجبات السنديك - شقة ${apt.number} (${resName})`));
      }
      if (!trxAmount) {
        setTrxAmount(String(apt.monthlyFees || building.monthlySyndicFees));
      }
    }
  };

  // Submit Handler with Law 18-00 Validations
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
        'رصيد الصندوق المحدد غير كافٍ: يرجى إدخال سبب لتجاوز الرصيد (3 أحرف على الأقل).'
      );
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      throw new Error(Object.values(errors).join("\n"));
    }

    if (!trxDate || Number.isNaN(Date.parse(trxDate))) throw new Error(tr('Indiquez une date valide.', 'أدخل تاريخاً صالحاً.'));
    setFormErrors({});

    // The server accepts a positive magnitude and applies the income/expense sign.
    const finalAmount = numericAmount;

    return addTrxMutation.mutateAsync({
      date: trxDate,
      description: trxDesc.trim(),
      amount: finalAmount,
      type: trxType,
      fundType: fundType,
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

  if (loadingCharges || loadingProofs || loadingQuittances) {
    return <Loading message={tr('Chargement des données financières...', 'جاري تحميل البيانات المالية...')} />;
  }

  return (
    <div className="space-y-6">
      <FinancialTools key={building.id} building={building} />
      <BillingFailures key={`billing-${building.id}`} building={building} />
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FinancialsIcon />
            <span>
              {tr(`Finances — ${building.name}`, `المالية — ${building.name}`)}
            </span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {tr(
              "Suivez l'argent de la copropriété : ce qui est dû, payé et dépensé.",
              'تابع مالية الملكية المشتركة: المستحقات، المدفوعات والمصاريف.'
            )}
          </p>
        </div>
        <FinanceMoreMenu
          onRecordMiscIncome={openIncomeModal}
          onTransferFunds={() => {
            setTransferFromFund('courant');
            setTransferToFund('reserve');
            setTransferAmount('');
            setTransferDate(new Date().toISOString().split('T')[0]);
            setTransferReason('');
            setIsTransferModalOpen(true);
          }}
          onExportAnnualPdf={() =>
            exportAnnualRepartitionPDF(
              building,
              syndic,
              charges,
              quittances,
              selectedFiscalYear
            )
          }
          selectedFiscalYear={selectedFiscalYear}
          availableFiscalYears={availableFiscalYears}
          onChangeFiscalYear={setSelectedFiscalYear}
        />
      </div>

      {/* Primary Task Buttons */}
      <FinanceActionBar
        onRecordPayment={() => openQuittanceModalNew()}
        onRecordExpense={openExpenseModal}
        onIssueMonthlyCharges={openChargeGeneration}
      />

      {/* Actionable 'What to do now' Panel */}
      <FinanceTodoPanel
        todos={financeTodos}
        formatCurrency={(n) => currencyFormatter.format(n)}
        onVerifyTransfers={() => setActiveTab('verifications')}
        onChaseOverdue={() => setActiveTab('impayes')}
        onIssueCharges={(period) => {
          setPeriodName(period);
          openChargeGeneration();
        }}
      />

      {/* KPI Financial Overview Cards */}
      <FinanceKpiCards
        stats={stats}
        bankName={building.bankName}
        overdueResidentsCount={overdueResidents.length}
        onSelectFundTransactions={(fund) => {
          setFilterFund(fund);
          setActiveTab('transactions');
        }}
        onSelectTab={setActiveTab}
      />

      {/* Navigation Tabs */}
      <FinanceTabBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        chargesCount={charges.length}
        pendingProofsCount={stats.pendingProofsCount}
        activeQuittancesCount={activeQuittances.length}
        overdueResidentsCount={overdueResidents.length}
      />

      {activeTab === 'transactions' && (
        <TransactionsTab
          building={building}
          syndic={syndic}
          filterFund={filterFund}
          onChangeFilterFund={setFilterFund}
          onOpenExpenseModal={openExpenseModal}
          onOpenTransferModal={() => {
            setTransferFromFund('courant');
            setTransferToFund('reserve');
            setTransferAmount('');
            setTransferDate(new Date().toISOString().split('T')[0]);
            setTransferReason('');
            setIsTransferModalOpen(true);
          }}
          onSelectTransaction={setSelectedTrxForView}
        />
      )}

      {activeTab === 'charges' && (
        <ChargesTab
          building={building}
          syndic={syndic}
          charges={charges}
          invoices={invoices}
          quittances={quittances}
          onOpenChargeGeneration={openChargeGeneration}
          onOpenNewPayment={openQuittanceModalNew}
          onOpenPaymentForCharge={(charge) => openQuittanceModalForCharge(charge)}
          onOpenPayInvoice={(inv, remaining) => {
            setPayInvoiceTarget(inv);
            setPayInvoiceAmount(String(remaining));
            setPayInvoiceMethod('virement');
            setPayInvoiceReference(`VIR-${inv.invoiceNumber}`);
            setPayInvoiceDate(new Date().toISOString().split('T')[0]);
          }}
          onOpenVoidInvoice={(inv) => {
            setVoidInvoiceTarget(inv);
            setVoidInvoiceReason('');
          }}
        />
      )}

      {activeTab === 'verifications' && (
        <VerificationsTab
          building={building}
          charges={charges}
          paymentProofs={paymentProofs}
          pendingProofsCount={stats.pendingProofsCount}
          unmatchedCsvRows={unmatchedCsvRows}
          onChangeUnmatchedCsvRows={setUnmatchedCsvRows}
          onOpenPaymentForCharge={openQuittanceModalForCharge}
        />
      )}

      {activeTab === 'quittances' && (
        <QuittancesTab
          building={building}
          syndic={syndic}
          quittances={quittances}
          showVoidedQuittances={showVoidedQuittances}
          onChangeShowVoidedQuittances={setShowVoidedQuittances}
          onOpenNewPayment={openQuittanceModalNew}
          onPreviewQuittance={setSelectedQuittanceForPreview}
        />
      )}

      {activeTab === 'impayes' && (
        <OverdueTab
          building={building}
          syndic={syndic}
          charges={charges}
          quittances={quittances}
          overdueResidents={overdueResidents}
          overdueChargesTotal={stats.overdueChargesTotal}
          agingBuckets={agingBuckets}
        />
      )}

      {/* MODAL 1: ADD TRANSACTION (EXPENSE / MISC INCOME) */}
      <Modal
        isOpen={isTrxModalOpen}
        onSubmit={handleSubmitTransaction}
        busy={addTrxMutation.isPending}
        onClose={() => {
          setIsTrxModalOpen(false);
          resetTrxForm();
        }}
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
                  "Article 26 de la Loi n° 18-00 : chaque dépense de la copropriété doit être appuyée par une pièce justificative numérotée.",
                  'المادة 26 من القانون 18-00: يجب أن يستند كل مصروف للملكية المشتركة إلى وثيقة مثبتة مرقمة.'
                )}
              </InfoTip>
            </span>
            <div className="flex gap-2 ms-auto">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsTrxModalOpen(false);
                  resetTrxForm();
                }}
              >
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
                    'الحساب الجاري: المصاريف العادية (الماء، الكهرباء، الحراسة، الصيانة). صندوق الاحتياط (القانون 106-12): الأشغال الكبرى.'
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
                  "Conservez le numéro de facture ou de reçu pour le contrôle des comptes en Assemblée Générale (Art. 26 Loi 18-00).",
                  'احتفظ برقم الفاتورة أو الإيصال لمراقبة الحسابات في الجمع العام (المادة 26 من القانون 18-00).'
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
                  onChange={(e) => setTrxDocumentType(e.target.value as any)}
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
                    trxType === 'expense' ? 'رقم الفاتورة أو الإيصال *' : 'رقم الوثيقة أو الإيصال'
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
                  onChange={(e) => setTrxPaymentMethod(e.target.value as any)}
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
                  placeholder={tr("Ex: Résolution N° 3 votée en AG", 'مثال: القرار رقم 3 المصوت عليه في الجمع العام')}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                />
              </div>
            </div>
          </details>

          {(() => {
            const currentBal = fundType === 'reserve' ? stats.reserveFund : stats.balance;
            const numericAmt = parseFloat(trxAmount) || 0;
            const projBal = trxType === 'income' ? currentBal + numericAmt : currentBal - numericAmt;
            const isOverdraft = trxType === 'expense' && numericAmt > 0 && Math.round(projBal * 100) < 0;
            return (
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
                        'رصيد الصندوق غير كافٍ. وضح سبب تسجيل العملية رغم ذلك *'
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
                        'مثال: تسبيق استعجالي مصادق عليه'
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
            );
          })()}
        </div>
      </Modal>

      {/* MODAL 1.B: TRANSACTION DETAIL */}
      {selectedTrxForView && (
        <Modal
          isOpen={!!selectedTrxForView}
          onClose={() => setSelectedTrxForView(null)}
          title={tr("Détail de l'opération", 'تفاصيل العملية')}
          footer={
            <div className="flex justify-between items-center w-full gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={() => generateTransactionVoucherPDF(selectedTrxForView, building, syndic)}
                  className="text-xs bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
                >
                  <DocumentsIcon />
                  <span>{tr('Télécharger le justificatif PDF', 'تحميل الوثيقة PDF')}</span>
                </Button>
                {!isIncomeTransaction(selectedTrxForView) &&
                  !selectedTrxForView.reversalOf &&
                  !selectedTrxForView.transferId &&
                  !(building.financials?.transactions || []).some((t) => t.reversalOf === selectedTrxForView.id) && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setReverseExpenseTarget(selectedTrxForView);
                        setReverseExpenseReason('');
                      }}
                      className="text-xs text-rose-700 border-rose-200 hover:bg-rose-50"
                    >
                      {tr('Annuler cette dépense', 'عكس المصروف')}
                    </Button>
                  )}
              </div>
              <Button variant="secondary" onClick={() => setSelectedTrxForView(null)}>
                {tr('Fermer', 'إغلاق')}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
              <div>
                <span className="font-mono text-[11px] text-slate-400 block">
                  {tr('Identifiant :', 'المعرف:')} {selectedTrxForView.id}
                </span>
                <span className="font-bold text-sm text-slate-900 mt-0.5 block">
                  {selectedTrxForView.description}
                </span>
              </div>
              <div className="text-end">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">
                  {tr('Montant', 'المبلغ')}
                </span>
                <span
                  className={`font-mono text-base font-bold ${
                    isIncomeTransaction(selectedTrxForView) ? 'text-emerald-600' : 'text-slate-900'
                  }`}
                >
                  {isIncomeTransaction(selectedTrxForView) ? '+' : ''}
                  {currencyFormatter.format(signedTransactionAmount(selectedTrxForView))}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-400 uppercase">{tr('Fonds & Catégorie', 'الصندوق والفئة')}</p>
                <p className="font-medium text-slate-800 flex items-center gap-1 flex-wrap">
                  <span>{tr('Fonds :', 'الصندوق:')}</span>
                  <strong className="text-slate-900">
                    {selectedTrxForView.fundType === 'reserve'
                      ? tr('Fonds de réserve', 'صندوق الاحتياط')
                      : tr('Compte courant', 'الحساب الجاري')}
                  </strong>
                  {selectedTrxForView.fundType === 'reserve' && (
                    <InfoTip label={tr('Fonds de réserve', 'صندوق الاحتياط')}>
                      {tr('Fonds de réserve travaux prévu par la Loi n° 106-12.', 'صندوق احتياط الأشغال المنصوص عليه في القانون 106-12.')}
                    </InfoTip>
                  )}
                </p>
                <p className="text-slate-600">
                  {tr('Catégorie :', 'الفئة:')}{' '}
                  {selectedTrxForView.category
                    ? CATEGORY_LABELS[selectedTrxForView.category] || selectedTrxForView.category
                    : tr('Charges', 'تكاليف')}
                </p>
                <p className="text-slate-600">
                  {tr('Date :', 'التاريخ:')} {new Date(selectedTrxForView.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                </p>
              </div>

              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-400 uppercase">{tr('Justificatif & Paiement', 'الإثبات والأداء')}</p>
                <p className="font-medium text-slate-800 font-mono">
                  {selectedTrxForView.documentType
                    ? DOCUMENT_TYPE_LABELS[selectedTrxForView.documentType] || selectedTrxForView.documentType
                    : tr('Pièce', 'وثيقة')}{' '}
                  : {selectedTrxForView.invoiceNumber ? `#${selectedTrxForView.invoiceNumber}` : tr('Non spécifié', 'غير محدد')}
                </p>
                <p className="text-slate-600">
                  {tr('Mode :', 'الطريقة:')}{' '}
                  {selectedTrxForView.paymentMethod
                    ? PAYMENT_METHOD_LABELS[selectedTrxForView.paymentMethod] || selectedTrxForView.paymentMethod
                    : tr('Virement', 'تحويل')}
                </p>
                <p className="text-slate-600 font-mono">
                  {tr('Réf / Chèque :', 'المرجع / الشيك:')} {selectedTrxForView.reference || 'S/N'} · {selectedTrxForView.bankName || tr('Banque', 'البنك')}
                </p>
              </div>
            </div>

            {(selectedTrxForView.thirdPartyName || selectedTrxForView.thirdPartyIce || selectedTrxForView.lotNumber) && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-500 block">{tr('Bénéficiaire / Payeur :', 'المستفيد / الدافع:')}</span>
                  <span className="font-bold text-slate-800 text-sm">
                    {selectedTrxForView.thirdPartyName || tr('Tiers', 'طرف ثالث')}
                  </span>
                </div>
                <div className="text-end">
                  {selectedTrxForView.thirdPartyIce && (
                    <span className="inline-block bg-white border border-slate-200 font-mono px-2 py-0.5 rounded text-[11px] text-slate-600">
                      ICE : {selectedTrxForView.thirdPartyIce}
                    </span>
                  )}
                  {selectedTrxForView.lotNumber && (
                    <span className="inline-block bg-teal-50 border border-teal-200 text-teal-800 font-medium px-2 py-0.5 rounded text-[11px]">
                      {tr('Lot', 'شقة')} {selectedTrxForView.lotNumber}
                    </span>
                  )}
                </div>
              </div>
            )}

            {selectedTrxForView.notes && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg">
                <span className="text-[11px] font-semibold text-amber-900 block">
                  {tr("Notes / décision d'AG :", 'ملاحظات وقرار الجمع العام:')}
                </span>
                <p className="text-slate-700 mt-0.5 italic">{selectedTrxForView.notes}</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL 2: GENERATE MONTHLY CHARGES */}
      <Modal
        isOpen={isGenerateModalOpen}
        busy={generateChargesMutation.isPending}
        onSubmit={async () => {
          if (!periodName.trim()) throw new Error(tr('Indiquez la période des cotisations.', 'أدخل فترة المساهمات.'));
          if (useTantiemes && (!totalBudgetInput.trim() || !Number.isFinite(Number(totalBudgetInput)) || Number(totalBudgetInput) <= 0)) throw new Error(tr('Le budget doit être un montant supérieur à zéro.', 'يجب أن تكون الميزانية مبلغاً أكبر من صفر.'));
          await generateChargesMutation.mutateAsync();
        }}
        onClose={() => setIsGenerateModalOpen(false)}
        title={tr('Appeler les charges du mois', 'إصدار مساهمات الشهر')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsGenerateModalOpen(false)}>
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
              'تصدر المساهمات للشقق المرتبطة بساكن مرة واحدة لكل شهر. لا تتغير المساهمات الصادرة سابقاً.'
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
                      'يحسب حصة كل شقة بالتناسب مع حصتها الشائعة في الملكية المشتركة (القانون 18-00).'
                    )}
                  </InfoTip>
                </span>
                <span className="text-[11px] text-teal-700 block">
                  {tr(
                    'Optionnel : remplace les montants habituels par une répartition du budget ci-dessous.',
                    'اختياري: يستبدل المساهمات المعتادة بتوزيع الميزانية الإجمالية أدناه.'
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
                      `تنبيه: ${vacantLotsInTantiemesMode} شقة(ات) نشطة بدون ساكن مرتبط لن يتم إصدار مساهمة لها في هذا الطلب (تبقى حصتها محفوظة من الميزانية الإجمالية).`
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label={tr('Aperçu des cotisations', 'معاينة المساهمات')}>
              <thead><tr><th className="text-start p-2">{tr('Lot', 'الشقة')}</th><th className="text-end p-2">{tr('Montant', 'المبلغ')}</th><th className="p-2">{tr('Émission', 'الإصدار')}</th></tr></thead>
              <tbody>{chargePreview.map(row => <tr key={row.id}>
                <td className="p-2">{row.number}</td>
                <td className="p-2 text-end font-mono">{Number.isFinite(row.amount) ? currencyFormatter.format(row.amount) : '—'}</td>
                <td className="p-2">{row.existing ? tr('Déjà émis — inchangé', 'صدر سابقاً — دون تغيير') : tr('À émettre', 'سيصدر')}</td>
              </tr>)}</tbody>
            </table>
            {chargePreview.length === 0 && <p className="text-xs text-slate-600">{tr('Liez un résident à un lot avant de générer les cotisations.', 'اربط ساكناً بشقة قبل إصدار المساهمات.')}</p>}
          </div>
        </div>
      </Modal>

      {/* MODAL 3: RECORD RESIDENT PAYMENT & RECEIPT */}
      <Modal
        isOpen={isQuittanceModalOpen}
        busy={createQuittanceMutation.isPending}
        onSubmit={async () => {
          const numAmt = parseFloat(quittanceAmount);
          if (!Number.isFinite(numAmt) || numAmt <= 0) {
            throw new Error(tr('Veuillez saisir un montant de cotisation valide.', 'يرجى إدخال مبلغ مساهمة صحيح.'));
          }
          if (!receiptCharge || Math.round(numAmt * 100) > Math.round(receiptRemaining * 100)) {
            throw new Error(tr('Sélectionnez une charge et respectez son solde restant.', 'اختر مساهمة والتزم برصيدها المتبقي.'));
          }
          if (!quittanceApartmentId) {
            throw new Error(tr('Veuillez sélectionner un lot.', 'يرجى اختيار الشقة.'));
          }

          const apt = building.apartments.find((a) => a.id === quittanceApartmentId);
          const res = building.residents.find((r) => r.id === quittanceResidentId);

          if (!apt || !res) throw new Error(tr('Sélectionnez un lot et son résident.', 'حدد الوحدة وساكنها.'));
          if (!quittancePaymentDate || Number.isNaN(Date.parse(quittancePaymentDate))) {
            throw new Error(tr('Indiquez une date de paiement valide.', 'أدخل تاريخ أداء صالحاً.'));
          }
          if (quittanceBankTransactionDate && Number.isNaN(Date.parse(quittanceBankTransactionDate))) {
            setQuittanceAccountingOpen(true);
            throw new Error(tr('Indiquez une date bancaire valide.', 'أدخل تاريخاً بنكياً صالحاً.'));
          }
          if (quittancePostingDate && Number.isNaN(Date.parse(quittancePostingDate))) {
            setQuittanceAccountingOpen(true);
            throw new Error(tr('Indiquez une date de comptabilisation valide.', 'أدخل تاريخ قيد صالحاً.'));
          }
          const { reserveFundAmount: reserveAmt, chargesCourantesAmount: courantesAmt } =
            splitChargeReserveAndOperating(numAmt, quittanceReserveRatio);

          try {
            await createQuittanceMutation.mutateAsync({
              chargeId: quittanceChargeId,
              ...(quittanceReference.trim() ? {} : { paymentId: quittancePaymentId }),
              residentId: quittanceResidentId,
              residentName: res?.name || tr('Copropriétaire', 'مالك مشترك'),
              residentCin: quittanceResidentCin || res?.cin,
              apartmentId: quittanceApartmentId,
              apartmentNumber: apt?.number || 'Lot',
              tantiemes: apt?.tantiemes || 100,
              buildingId: building.id,
              buildingName: building.name,
              syndicId: building.syndicId,
              syndicName: syndic?.name || 'Syndic Mandataire',
              amount: numAmt,
              chargesCourantesAmount: courantesAmt,
              reserveFundAmount: reserveAmt,
              paymentMethod: quittancePaymentMethod,
              paymentDate: quittancePaymentDate,
              bankTransactionDate: quittanceBankTransactionDate || undefined,
              postingDate: quittancePostingDate || undefined,
              priorPeriodAdjustmentReason: quittanceAdjustmentReason.trim() || undefined,
              periodCovered: quittancePeriod,
              bankName: quittanceBankName,
              referenceNumber: quittanceReference || undefined,
              remarks: quittanceRemarks || undefined,
              addTransactionToLedger: true,
            });
          } catch (err: any) {
            if (/période|clôtur|comptabilis|ajustement/i.test(String(err?.message || ''))) {
              setQuittanceAccountingOpen(true);
            }
            throw err;
          }
        }}
        onClose={() => setIsQuittanceModalOpen(false)}
        title={tr('Encaisser un paiement', 'تحصيل دفعة')}
        footer={
          <div className="flex justify-between items-center w-full gap-2">
            <span className="text-[11px] text-slate-500 hidden sm:inline-flex items-center gap-1">
              <span>{tr('Le reçu PDF officiel est téléchargé dès validation', 'يتم تحميل الوصل الرسمي PDF فور التأكيد')}</span>
              <InfoTip label={tr('Quittance officielle', 'وصل أداء رسمي')}>
                {tr(
                  'Quittance libératoire conforme aux lois n° 18-00 et 106-12 (Art. 18 bis), incluant la part du fonds de réserve.',
                  'وصل إبراء رسمي مطابق للقانونين 18-00 و106-12 (المادة 18 مكرر) يتضمن حصة صندوق الاحتياط.'
                )}
              </InfoTip>
            </span>
            <div className="flex items-center gap-2 ms-auto">
              <Button variant="secondary" onClick={() => setIsQuittanceModalOpen(false)}>
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                type="submit"
                disabled={createQuittanceMutation.isPending || !receiptCharge}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold flex items-center gap-1.5"
              >
                <QuittanceIcon />
                <span>
                  {createQuittanceMutation.isPending
                    ? tr('Enregistrement...', 'جاري التسجيل...')
                    : tr('Encaisser et générer le reçu', 'تحصيل وإصدار الوصل')}
                </span>
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pe-1">
          {/* STEP 1: QUI A PAYÉ ? */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              {tr('1. Qui a payé ?', '1. من أدى؟')}
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Lot / Appartement', 'الوحدة / الشقة')} <span className="text-rose-500">*</span>
                </label>
                <select
                  value={quittanceApartmentId}
                  onChange={(e) => {
                    const aptId = e.target.value;
                    setQuittanceApartmentId(aptId);
                    const selectedApt = building.apartments.find((a) => a.id === aptId);
                    const resident = selectedApt
                      ? building.residents.find(
                          (r) =>
                            r.id === selectedApt.ownerId ||
                            r.id === selectedApt.tenantId ||
                            r.apartmentId === selectedApt.id
                        )
                      : undefined;
                    if (resident) {
                      setQuittanceResidentId(resident.id);
                      setQuittanceResidentCin(resident.cin || '');
                    } else {
                      setQuittanceResidentId('');
                      setQuittanceResidentCin('');
                    }
                    if (selectedApt && !quittanceAmount) {
                      setQuittanceAmount(
                        String(selectedApt.monthlyFees ?? building.monthlySyndicFees ?? 0)
                      );
                    }
                  }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900"
                >
                  <option value="">{tr('Sélectionnez un lot...', 'اختر شقة...')}</option>
                  {building.apartments.map((a) => {
                    const res = building.residents.find(
                      (r) => r.id === a.ownerId || r.id === a.tenantId || r.apartmentId === a.id
                    );
                    return (
                      <option key={a.id} value={a.id}>
                        {tr('Lot', 'شقة')} {a.number} — {res?.name || tr('Copropriétaire', 'مالك مشترك')}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Copropriétaire', 'المالك المشترك')}
                </label>
                <select
                  value={quittanceResidentId}
                  onChange={(e) => {
                    const rId = e.target.value;
                    setQuittanceResidentId(rId);
                    const r = building.residents.find((res) => res.id === rId);
                    if (r) {
                      setQuittanceResidentCin(r.cin || '');
                      if (r.apartmentId) setQuittanceApartmentId(r.apartmentId);
                    }
                  }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900"
                >
                  {building.residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.isOwner ? `— ${tr('Copropriétaire', 'مالك')}` : `— ${tr('Locataire', 'مكتري')}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* STEP 2: POUR QUOI ? */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              {tr('2. Pour quoi ?', '2. مقابل ماذا؟')}
            </h4>

            <div>
              <label htmlFor="quittance-charge" className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Charge à régler', 'المساهمة المستحقة')} <span className="text-rose-500">*</span>
              </label>
              <select
                id="quittance-charge"
                value={quittanceChargeId}
                onChange={(event) => setQuittanceChargeId(event.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
              >
                <option value="">{tr('Sélectionnez une charge...', 'اختر مساهمة...')}</option>
                {receiptCharges.map((charge) => (
                  <option key={charge.id} value={charge.id}>
                    {charge.period} — {tr('Reste à payer :', 'الباقي للأداء:')}{' '}
                    {currencyFormatter.format(Math.max(0, charge.amount - (charge.paidAmount ?? 0)))}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-600 mt-1">
                {tr('Tout nouveau reçu confirme un paiement enregistré.', 'كل وصل جديد يؤكد دفعة مسجلة.')}
              </p>
            </div>
          </div>

          {/* STEP 3: COMBIEN ET COMMENT ? */}
          <div className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              {tr('3. Combien et comment ?', '3. كم وكيف؟')}
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="quittance-amount" className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Montant encaissé (MAD)', 'المبلغ المحصل (درهم)')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
                  id="quittance-amount"
                  min="0.01"
                  max={receiptRemaining}
                  step="0.01"
                  value={quittanceAmount}
                  onChange={(e) => setQuittanceAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono font-bold text-teal-900 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Mode de paiement', 'طريقة الدفع')}
                </label>
                <select
                  value={quittancePaymentMethod}
                  onChange={(e) => setQuittancePaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900"
                >
                  <option value="virement">{tr('Virement bancaire', 'تحويل بنكي')}</option>
                  <option value="cheque">{tr('Chèque', 'شيك')}</option>
                  <option value="versement">{tr('Versement agence / GAB', 'إيداع بنكي')}</option>
                  <option value="especes">{tr('Espèces', 'نقداً')}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Réf. virement / N° chèque', 'مرجع التحويل / رقم الشيك')}
                </label>
                <input
                  type="text"
                  value={quittanceReference}
                  onChange={(e) => setQuittanceReference(e.target.value)}
                  placeholder="Ex: VIR-84920"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Date du paiement', 'تاريخ الأداء')}
                </label>
                <input
                  type="date"
                  value={quittancePaymentDate}
                  onChange={(e) => setQuittancePaymentDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                />
              </div>
            </div>
          </div>

          {/* LIVE SUMMARY SENTENCE */}
          {(() => {
            const selectedApt = building.apartments.find((a) => a.id === quittanceApartmentId);
            const selectedRes = building.residents.find((r) => r.id === quittanceResidentId);
            const paidNum = parseFloat(quittanceAmount);
            if (!selectedApt || !selectedRes || !receiptCharge || !(paidNum > 0)) return null;
            const remainingAfter = Math.max(
              0,
              Math.round((receiptRemaining - paidNum) * 100) / 100,
            );
            const split = splitChargeReserveAndOperating(paidNum, quittanceReserveRatio);
            const periodLabel = quittancePeriod || receiptCharge.period || '—';
            return (
              <div
                data-testid="quittance-live-summary"
                className="p-3 bg-teal-50 border border-teal-200 rounded-xl space-y-1.5 text-xs text-teal-950"
              >
                <p className="font-medium leading-relaxed">
                  {tr(
                    `Lot ${selectedApt.number} — ${selectedRes.name} paie ${currencyFormatter.format(paidNum)} pour ${periodLabel}. Il restera ${currencyFormatter.format(remainingAfter)}. Un reçu PDF sera généré.`,
                    `الشقة ${selectedApt.number} — ${selectedRes.name} يؤدي ${currencyFormatter.format(paidNum)} عن فترة ${periodLabel}. سيتبقى ${currencyFormatter.format(remainingAfter)}. سيتم إصدار وصل PDF.`
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-teal-800 font-mono">
                  <span>
                    {tr('Compte courant :', 'الحساب الجاري:')}{' '}
                    {currencyFormatter.format(split.chargesCourantesAmount)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span>
                      {tr(`Fonds de réserve (${quittanceReserveRatio}%) :`, `صندوق الاحتياط (${quittanceReserveRatio}%):`)}{' '}
                      {currencyFormatter.format(split.reserveFundAmount)}
                    </span>
                    <InfoTip label={tr('Ventilation fonds de réserve', 'توزيع صندوق الاحتياط')}>
                      {tr(
                        'Répartition automatique prévue par la Loi n° 106-12 (Art. 18 bis).',
                        'توزيع تلقائي منصوص عليه في القانون 106-12 (المادة 18 مكرر).'
                      )}
                    </InfoTip>
                  </span>
                </div>
              </div>
            );
          })()}

          {/* COLLAPSIBLE ACCOUNTING OPTIONS */}
          <details
            open={quittanceAccountingOpen}
            onToggle={(e) =>
              setQuittanceAccountingOpen((e.currentTarget as HTMLDetailsElement).open)
            }
            className="rounded-xl border border-slate-200 bg-slate-50/70"
          >
            <summary className="px-3.5 py-2.5 text-xs font-semibold text-slate-700 cursor-pointer select-none">
              {tr('Options comptables (optionnel : banque, CIN, date de comptabilisation)', 'خيارات محاسبية (اختياري: البنك، رقم البطاقة، تاريخ القيد)')}
            </summary>
            <div className="px-3.5 pb-3.5 pt-2 space-y-3 border-t border-slate-200/70">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tr('Banque', 'البنك')}
                  </label>
                  <select
                    value={quittanceBankName}
                    onChange={(e) => setQuittanceBankName(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white text-slate-900"
                  >
                    {MOROCCAN_BANKS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tr('CIN sur le reçu', 'رقم البطاقة الوطنية')}
                  </label>
                  <input
                    type="text"
                    value={quittanceResidentCin}
                    onChange={(e) => setQuittanceResidentCin(e.target.value)}
                    placeholder="CIN"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tr('Observations sur le reçu', 'ملاحظات على الوصل')}
                  </label>
                  <input
                    type="text"
                    value={quittanceRemarks}
                    onChange={(e) => setQuittanceRemarks(e.target.value)}
                    placeholder={tr('Note facultative', 'ملاحظة اختيارية')}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tr('Date opération bancaire', 'تاريخ العملية البنكية')}
                  </label>
                  <input
                    type="date"
                    value={quittanceBankTransactionDate}
                    onChange={(e) => setQuittanceBankTransactionDate(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tr('Date de comptabilisation (optionnel)', 'تاريخ القيد المحاسبي (اختياري)')}
                  </label>
                  <input
                    type="date"
                    value={quittancePostingDate}
                    onChange={(e) => setQuittancePostingDate(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {tr('Motif ajustement période', 'سبب تعديل الفترة')}
                  </label>
                  <input
                    type="text"
                    maxLength={1000}
                    value={quittanceAdjustmentReason}
                    onChange={(e) => setQuittanceAdjustmentReason(e.target.value)}
                    placeholder={tr('Si période antérieure / clôturée', 'إذا كانت فترة سابقة أو مغلقة')}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  />
                </div>
              </div>
            </div>
          </details>
        </div>
      </Modal>

      {/* MODAL 4: OFFICIAL CERTIFICATE VIEWER MODAL */}
      {selectedQuittanceForPreview && (
        <Modal
          isOpen={!!selectedQuittanceForPreview}
          onClose={() => setSelectedQuittanceForPreview(null)}
          title={tr(
            `Attestation Officielle — ${selectedQuittanceForPreview.quittanceNumber}`,
            `شهادة إبراء رسمية — ${selectedQuittanceForPreview.quittanceNumber}`
          )}
          footer={
            <div className="flex justify-between items-center w-full">
              <span className="text-xs text-slate-500 font-mono">
                {tr('Conforme Loi 18-00 · Délivré par le Syndic', 'مطابق للقانون 18-00 · مسلم من طرف السنديك')}
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setSelectedQuittanceForPreview(null)}>
                  {tr('Fermer', 'إغلاق')}
                </Button>
                <Button
                  onClick={() => {
                    const apt = building.apartments.find((a) => a.id === selectedQuittanceForPreview.apartmentId);
                    const res = building.residents.find((r) => r.id === selectedQuittanceForPreview.residentId);
                    generateQuittancePDF(selectedQuittanceForPreview, building, syndic, apt, res);
                  }}
                  className="bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
                >
                  <QuittanceIcon />
                  <span>{tr('Télécharger le PDF Réglementaire', 'تحميل الوصل الرسمي PDF')}</span>
                </Button>
              </div>
            </div>
          }
        >
          <div className="p-6 bg-slate-50 border-2 border-teal-800/40 rounded-xl space-y-5 text-slate-800 shadow-inner">
            {selectedQuittanceForPreview.voidedAt && (
              <div className="p-3 rounded-lg bg-rose-100 border-2 border-rose-500 text-rose-900 text-center space-y-1">
                <p className="text-sm font-extrabold tracking-widest uppercase">
                  {tr('QUITTANCE ANNULÉE — SANS VALEUR LIBÉRATOIRE', 'وصل ملغى — لا يُعتد به لإبراء الذمة')}
                </p>
                <p className="text-xs">
                  {tr('Annulée le', 'أُلغي في')}{' '}
                  {new Date(selectedQuittanceForPreview.voidedAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                  {selectedQuittanceForPreview.voidReason
                    ? ` · ${selectedQuittanceForPreview.voidReason}`
                    : ''}
                </p>
              </div>
            )}
            <div className="text-center pb-4 border-b-2 border-teal-800/20">
              <p className="text-[11px] font-bold tracking-widest text-teal-900 uppercase">
                {tr('ROYAUME DU MAROC  ·  SYNDICAT DES COPROPRIÉTAIRES', 'المملكة المغربية  ·  اتحاد الملاك المشتركين')}
              </p>
              <h3 className="text-base font-extrabold text-teal-950 mt-1 uppercase tracking-tight">
                {tr('Quittance de Paiement des Charges de Copropriété', 'وصل أداء مساهمات الملكية المشتركة')}
              </h3>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {tr(
                  'En vertu de la Loi n° 18-00 relative au statut de la copropriété des immeubles bâtis (modifiée par la Loi n° 106-12)',
                  'بموجب القانون رقم 18-00 المتعلق بنظام الملكية المشتركة للعقارات المبنية (المعدل بالقانون رقم 106-12)'
                )}
              </p>
              <div className="inline-block bg-teal-100/70 border border-teal-300 text-teal-900 font-mono text-xs px-3 py-0.5 rounded font-bold mt-2">
                {tr('Réf:', 'المرجع:')} {selectedQuittanceForPreview.quittanceNumber} · {tr('Émise le', 'صادر في')}{' '}
                {new Date(selectedQuittanceForPreview.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-teal-800 block text-[11px] uppercase">
                  {tr('Copropriété & Syndic', 'الملكية المشتركة والسنديك')}
                </span>
                <p className="font-bold text-slate-900">{building.name}</p>
                <p className="text-slate-600">{building.address}, {building.city}</p>
                <p className="text-slate-500 font-mono text-[11px]">
                  {tr('Syndic:', 'السنديك:')} {syndic?.name || selectedQuittanceForPreview.syndicName}
                </p>
                <p className="text-slate-400 font-mono text-[10px]">
                  RIB: {building.bankRib || tr('Non renseigné','غير مسجل')}
                </p>
              </div>

              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-teal-800 block text-[11px] uppercase">
                  {tr('Copropriétaire & Lot', 'المالك المشترك والوحدة')}
                </span>
                <p className="font-bold text-slate-900">{selectedQuittanceForPreview.residentName}</p>
                <p className="text-slate-600 font-mono">
                  {tr('Lot', 'شقة')} {selectedQuittanceForPreview.apartmentNumber} · {selectedQuittanceForPreview.tantiemes} / {buildingTantiemesBase}
                </p>
                <p className="text-slate-500 font-mono text-[11px]">
                  CIN: {selectedQuittanceForPreview.residentCin || tr('Non renseigné', 'غير محدد')}
                </p>
                <p className="text-slate-500 text-[11px]">{tr('Usage : Résidentiel', 'الاستعمال: سكني')}</p>
              </div>
            </div>

            <div className="bg-white rounded border border-slate-200 overflow-hidden text-xs">
              <div className="bg-teal-900 text-white p-2 font-bold flex justify-between">
                <span>{tr('Désignation des charges (Loi 18-00 & 106-12)', 'بيان التكاليف والمساهمات (القانون 18-00 و 106-12)')}</span>
                <span>{tr('Montant Réglé', 'المبلغ المؤدى')}</span>
              </div>
              <div className="p-3 space-y-2">
                <div className="flex justify-between items-center text-slate-700">
                  <span>{tr('1. Charges générales ordinaires', '1. التكاليف العامة الجارية')} ({selectedQuittanceForPreview.periodCovered})</span>
                  <span className="font-mono font-medium">
                    {formatRecordedFund(selectedQuittanceForPreview, 'chargesCourantesAmount')}
                  </span>
                </div>
                <div className="flex justify-between items-center text-emerald-800">
                  <span>{tr('2. Provision obligatoire Fonds de Réserve (Loi 106-12 Art. 18 bis)', '2. مساهمة صندوق الاحتياط الإلزامي (القانون 106-12)')}</span>
                  <span className="font-mono font-semibold">
                    {formatRecordedFund(selectedQuittanceForPreview, 'reserveFundAmount')}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-slate-900 text-sm">
                  <span>{tr('TOTAL REÇU ET QUITTANCÉ :', 'المجموع المستلم والمبرأ عنه:')}</span>
                  <span className="font-mono text-teal-900 text-base">
                    {currencyFormatter.format(selectedQuittanceForPreview.amount)}
                  </span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-slate-600 italic bg-amber-50/70 p-2.5 rounded border border-amber-200">
              {tr(
                '« Le Syndic soussigné donne quittance libératoire au copropriétaire pour ladite période. Cette attestation justifie de la régularité des cotisations au regard du Syndicat des Copropriétaires. »',
                '« يمنح وكيل الاتحاد (السنديك) الموقع أسفله إبراءً تاماً للمالك المشترك عن الفترة المذكورة. وتشهد هذه الوثيقة على انتظام أداء المساهمات تجاه اتحاد الملاك المشتركين. »'
              )}
            </p>

            <div className="flex justify-between items-end pt-2">
              <div className="text-[10px] text-slate-400 font-mono">
                <div>Hash : {selectedQuittanceForPreview.id}</div>
                <div>
                  {tr('Fait à', 'حرر بـ')} {building.city}, {tr('le', 'في')} {new Date().toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                </div>
              </div>

              <div className="w-24 h-24 rounded-full border-2 border-dashed border-teal-700 flex flex-col items-center justify-center text-teal-800 font-mono text-[8px] text-center p-1 bg-teal-50/40">
                <span className="font-bold text-[7px]">SYNDICAT COPRO</span>
                <span className="font-extrabold text-[9px] text-teal-900">{tr('CERTIFIÉ', 'معتمد')}</span>
                <span className="font-bold text-[8px]">{tr('CONFORME', 'مطابق')}</span>
                <span className="text-[6px]">LOI 18-00</span>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 5: INTERNAL FUND TRANSFER */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
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
            <Button type="button" variant="secondary" onClick={() => setIsTransferModalOpen(false)}>
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

      {/* MODAL 6: REVERSE EXPENSE */}
      {reverseExpenseTarget && (
        <Modal
          isOpen={!!reverseExpenseTarget}
          onClose={() => {
            setReverseExpenseTarget(null);
            setReverseExpenseReason('');
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
              transactionId: reverseExpenseTarget.id,
              reason: reverseExpenseReason.trim(),
            });
          }}
        >
          <div className="space-y-4 text-xs">
            <p className="text-slate-600 flex items-center gap-1.5">
              <span>
                {tr(
                  "L'opération d'origine est conservée dans l'historique et annulée par une écriture inverse.",
                  'يبقى القيد الأصلي محفوظاً في السجل ويتم إلغاؤه بقيد معاكس.'
                )}
              </span>
              <InfoTip label={tr('Contrepassation comptable', 'القيد العكسي')}>
                {tr(
                  'Principe de traçabilité comptable (Loi n° 18-00) : aucune écriture enregistrée ne peut être supprimée sans trace.',
                  'مبدأ التتبع المحاسبي (القانون 18-00): لا يُحذف أي قيد مسجل دون أثر.'
                )}
              </InfoTip>
            </p>
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
              <p className="font-semibold text-slate-900">{reverseExpenseTarget.description}</p>
              <p className="font-mono text-slate-600">
                {currencyFormatter.format(Math.abs(reverseExpenseTarget.amount))} ·{' '}
                {reverseExpenseTarget.fundType === 'reserve'
                  ? tr('Fonds de Réserve', 'صندوق الاحتياط')
                  : tr('Compte Courant', 'الحساب الجاري')}{' '}
                · {new Date(reverseExpenseTarget.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
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
                  setReverseExpenseTarget(null);
                  setReverseExpenseReason('');
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
      )}

      {/* MODAL: RECORD MULTI-CHARGE INVOICE PAYMENT */}
      {payInvoiceTarget && (
        <Modal
          isOpen={!!payInvoiceTarget}
          busy={recordInvoicePaymentMutation.isPending}
          onSubmit={async () => {
            const amount = parseFloat(payInvoiceAmount);
            const remaining =
              Math.max(
                0,
                Math.round(((payInvoiceTarget.totalAmount || 0) - (payInvoiceTarget.paidAmount || 0)) * 100)
              ) / 100;
            if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) > Math.round(remaining * 100)) {
              throw new Error(
                tr(
                  'Indiquez un montant valide inférieur ou égal au solde restant de la facture.',
                  'أدخل مبلغاً صالحاً أقل من أو يساوي الرصيد المتبقي للفاتورة.'
                )
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
            setPayInvoiceTarget(null);
            setPayInvoiceAmount('');
            setPayInvoiceReference('');
          }}
          title={tr(
            `Encaisser la facture ${payInvoiceTarget.invoiceNumber}`,
            `تحصيل الفاتورة ${payInvoiceTarget.invoiceNumber}`
          )}
        >
          <div className="space-y-3 text-xs">
            <p className="text-slate-600">
              {tr(
                'Le règlement sera automatiquement ventilé sur les charges ouvertes de cette facture (par ordre d’ancienneté).',
                'سيتم توزيع الأداء تلقائياً على المساهمات المفتوحة المرتبطة بهذه الفاتورة حسب الأقدمية.'
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
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPayInvoiceTarget(null)}
              >
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
      )}

      {/* MODAL: VOID UNPAID INVOICE */}
      {voidInvoiceTarget && (
        <Modal
          isOpen={!!voidInvoiceTarget}
          busy={voidInvoiceMutation.isPending}
          onSubmit={async () => {
            if (voidInvoiceReason.trim().length < 3) {
              throw new Error(tr('Indiquez un motif d’annulation (min. 3 caractères).', 'أدخل سبب الإلغاء (3 أحرف على الأقل).'));
            }
            await voidInvoiceMutation.mutateAsync({
              invoiceId: voidInvoiceTarget.id,
              reason: voidInvoiceReason.trim(),
            });
          }}
          onClose={() => {
            setVoidInvoiceTarget(null);
            setVoidInvoiceReason('');
          }}
          title={tr(
            `Annuler la facture ${voidInvoiceTarget.invoiceNumber}`,
            `إلغاء الفاتورة ${voidInvoiceTarget.invoiceNumber}`
          )}
        >
          <div className="space-y-3 text-xs">
            <p className="text-slate-600">
              {tr(
                'Seule une facture sans paiement encaissé peut être annulée. Les charges restent ouvertes pour un nouvel avis.',
                'يمكن إلغاء الفاتورة فقط إذا لم يتم تحصيل أي مبلغ عنها. تبقى المساهمات مفتوحة لإشعار جديد.'
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
                  setVoidInvoiceTarget(null);
                  setVoidInvoiceReason('');
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
      )}
    </div>
  );
};

export default FinancialsView;

