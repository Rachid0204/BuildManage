import BillingFailures from './BillingFailures';
import FinancialTools from './FinancialTools';
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Transaction, Charge, Syndic, Quittance, PaymentMethod, Invoice, Apartment } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import {
  PlusIcon,
  FinancialsIcon,
  QuittanceIcon,
  ShieldAlertIcon,
  DocumentsIcon,
} from '../icons/IconComponents';
import {
  getChargesForBuilding,
  getInvoicesForBuilding,
  createInvoiceForResident,
  recordPayment,
  voidInvoice,
  getPaymentProofsForBuilding,
  reviewPaymentProof,
  approvePaymentProofsBatch,
  reconcileBankStatementCSV,
  type UnmatchedBankCsvRow,
  getQuittancesForBuilding,
  createQuittance,
  generateQuittanceForCharge,
  addTransaction,
  transferFunds,
  reverseExpense,
  generateMonthlyCharges,
  normalizeBillingPeriodKey,
  getPrestatairesForBuilding,
} from '../../firebase/services';
import {
  generateInvoicePDF,
  generateQuittancePDF,
  exportMiseEnDemeurePDF,
  exportResidentStatementPDF,
  generateTransactionVoucherPDF,
  exportAnnualRepartitionPDF,
} from '../../services/pdfOnDemand';
import {
  computeBuildingFundBalances,
  splitChargeReserveAndOperating,
  getBuildingReserveRate,
  resolveChargeReserveRate,
  getRecordedReserveSplit,
  allocateBudgetInCentimes,
  isIncomeTransaction,
  signedTransactionAmount,
} from '../../utils/security';
import { isChargeEffectivelyOverdue, todayCasablancaIsoDate } from '../../shared/moroccoDate';
import Loading from '../common/Loading';
import { useI18n } from '../../hooks/useI18n';
import { useToast } from '../common/Toast';

interface FinancialsProps {
  building: Building;
  syndic?: Syndic;
  onAddTransaction?: () => void;
  onGenerateCharges?: () => void;
}

type TabType = 'transactions' | 'charges' | 'verifications' | 'quittances' | 'impayes';

const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  minimumFractionDigits: 2,
});

const MOROCCAN_BANKS = [
  '',
  'Attijariwafa Bank',
  'Banque Populaire (BCP)',
  'Bank of Africa (BMCE)',
  'CIH Bank',
  'Société Générale Maroc',
  'Crédit du Maroc',
  'Al Barid Bank',
  'CFG Bank',
  'Autre / Trésorerie Caisse',
];

function splitCsvRecord(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseBankCsvAmount(raw: string): number {
  const compact = raw.replace(/[\s\u00A0\u202F]/g, '').replace(/(?:MAD|DH|DHS)$/i, '');
  if (!/^[+-]?\d+(?:[.,]\d+)*$/.test(compact)) return Number.NaN;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;
  if (lastComma !== -1 && lastDot !== -1) {
    normalized = lastComma > lastDot
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact.replace(/,/g, '');
  } else if (lastComma !== -1) {
    normalized = compact.replace(',', '.');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}

function parseBankCsvRows(text: string): Array<{ date: string; label: string; amount: number; reference?: string }> {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  // Prefer semicolon when unquoted semicolons appear, so quoted decimals with commas don't confuse delimiter selection
  const firstLine = lines[0];
  let unquotedSemi = 0;
  let unquotedComma = 0;
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === ';') unquotedSemi++;
    else if (!inQuotes && ch === ',') unquotedComma++;
  }
  const delimiter = unquotedSemi >= unquotedComma && unquotedSemi > 0 ? ';' : ',';

  const firstCols = splitCsvRecord(firstLine, delimiter).map((c) =>
    c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  );
  const hasHeader = firstCols.some((c) =>
    ['date', 'montant', 'amount', 'credit', 'debit', 'libelle', 'label', 'reference', 'ref'].some((k) =>
      c.includes(k)
    )
  );

  const findCol = (keywords: string[]) =>
    hasHeader ? firstCols.findIndex((c) => keywords.some((k) => c.includes(k))) : -1;
  const dateIdx = findCol(['date']);
  const labelIdx = findCol(['libelle', 'label', 'description', 'motif']);
  const refIdx = findCol(['reference', 'ref']);
  const amountIdx = findCol(['montant', 'amount']);
  const creditIdx = findCol(['credit']);
  const debitIdx = findCol(['debit']);

  const dataLines = hasHeader ? lines.slice(1) : lines;
  const rows: Array<{ date: string; label: string; amount: number; reference?: string }> = [];

  for (const line of dataLines) {
    const cols = splitCsvRecord(line, delimiter);
    let amount = Number.NaN;
    if (amountIdx >= 0 && cols[amountIdx]) {
      amount = parseBankCsvAmount(cols[amountIdx]);
    } else if (creditIdx >= 0 || debitIdx >= 0) {
      const creditVal = creditIdx >= 0 && cols[creditIdx] ? parseBankCsvAmount(cols[creditIdx]) : 0;
      const debitVal = debitIdx >= 0 && cols[debitIdx] ? parseBankCsvAmount(cols[debitIdx]) : 0;
      if (Number.isFinite(creditVal) && creditVal > 0) amount = creditVal;
      else if (Number.isFinite(debitVal) && debitVal !== 0) amount = -Math.abs(debitVal);
    } else {
      for (const col of cols) {
        const parsed = parseBankCsvAmount(col);
        if (Number.isFinite(parsed)) {
          amount = parsed;
          break;
        }
      }
    }
    if (!Number.isFinite(amount) || amount === 0) continue;
    const date = (dateIdx >= 0 ? cols[dateIdx] : cols[0]) || '';
    const label = (labelIdx >= 0 ? cols[labelIdx] : cols[1]) || line;
    const reference = (refIdx >= 0 ? cols[refIdx] : hasHeader ? undefined : cols[2])?.trim() || undefined;
    rows.push({ date, label, amount, reference });
  }
  return rows;
}

const FinancialsView: React.FC<FinancialsProps> = ({ building, syndic }) => {
  const { tr, isAr } = useI18n();
  const formatRecordedFund = (receipt: Quittance, fund: 'reserveFundAmount' | 'chargesCourantesAmount') => {
    const split = getRecordedReserveSplit(receipt);
    return split ? currencyFormatter.format(split[fund]) : tr('Non documenté', 'غير موثق');
  };
  const { showToast, confirmAction } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('transactions');
  const [isTrxModalOpen, setIsTrxModalOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [selectedTrxForView, setSelectedTrxForView] = useState<Transaction | null>(null);
  const [approvingBatch, setApprovingBatch] = useState(false);
  const [rejectingProofId, setRejectingProofId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const CATEGORY_LABELS: Record<string, string> = useMemo(
    () => ({
      maintenance: tr('Maintenance & Dépannages', 'الصيانة والإصلاحات'),
      elevator: tr('Ascenseur & Équipements', 'المصعد والتجهيزات'),
      salary: tr('Salaires (Gardien / Concierge)', 'رواتب (الحارس / البواب)'),
      utility: tr('Électricité & Eau (Lydec/Redal)', 'الكهرباء والماء (ليدك / ريضال)'),
      cleaning: tr('Nettoyage & Hygiène', 'النظافة والصحة'),
      fees: tr('Cotisations Copropriété', 'مساهمات الملكية المشتركة'),
      insurance: tr('Assurance Multirisque', 'التأمين المتعدد المخاطر'),
      bank_fees: tr('Frais Bancaires', 'المصاريف البنكية'),
      legal: tr('Contentieux & Recouvrement', 'المنازعات والتحصيل'),
      reserve: tr('Gros travaux (Fonds Réserve)', 'الأشغال الكبرى (صندوق الاحتياط)'),
      reimbursement: tr('Remboursement / Sinistre', 'تعويض / حادث'),
      other: tr('Autre opération', 'عملية أخرى'),
    }),
    [tr]
  );

  const PAYMENT_METHOD_LABELS: Record<string, string> = useMemo(
    () => ({
      virement: tr('Virement bancaire', 'تحويل بنكي'),
      cheque: tr('Chèque', 'شيك'),
      versement: tr('Versement agence', 'إيداع بالوكالة'),
      versement_especes: tr('Versement espèces', 'إيداع نقدي'),
      cmi: tr('Carte CMI', 'بطاقة بنكية CMI'),
      especes: tr('Espèces (Caisse)', 'نقداً (الصندوق)'),
    }),
    [tr]
  );

  const DOCUMENT_TYPE_LABELS: Record<string, string> = useMemo(
    () => ({
      facture: tr('Facture Fournisseur', 'فاتورة المورد'),
      quittance: tr('Quittance', 'وصل إبراء (مخالصة)'),
      recu: tr('Reçu / Décharge', 'إيصال / إبراء'),
      releve: tr('Relevé / Avis d’opéré', 'كشف / إشعار بالعملية'),
      devis: tr('Devis validé AG', 'عرض سعر مصادق عليه بالجمع العام'),
      autre: tr('Autre pièce', 'وثيقة أخرى'),
    }),
    [tr]
  );

  // Filter state for Transactions Journal
  const [filterFund, setFilterFund] = useState<'all' | 'courant' | 'reserve'>('all');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchTrx, setSearchTrx] = useState('');

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
  const [chargesSubTab, setChargesSubTab] = useState<'charges' | 'invoices'>('charges');
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
  const [quittanceSearch, setQuittanceSearch] = useState('');
  const [quittanceFilterMethod, setQuittanceFilterMethod] = useState('all');
  const [directGeneratingChargeId, setDirectGeneratingChargeId] = useState<string | null>(null);
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

  const availableFiscalYears = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years = new Set<number>([
      currentYear,
      currentYear - 1,
      currentYear - 2,
      currentYear - 3,
      currentYear - 4,
    ]);
    charges.forEach((c) => {
      const m = `${c.period || ''} ${c.dueDate || ''}`.match(/\b(20\d{2})\b/);
      if (m) years.add(Number(m[1]));
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [charges]);

  const openChargeGeneration = () => {
    setUseTantiemes(false);
    setTotalBudgetInput(String(building.apartments
      .filter((a: any) => !a.archivedAt)
      .reduce((sum, a) => sum + (a.monthlyFees ?? building.monthlySyndicFees ?? 0), 0)));
    setIsGenerateModalOpen(true);
  };
  const { chargePreview, vacantLotsInTantiemesMode } = useMemo(() => {
    const lots = building.apartments.filter((a: any) => !a.archivedAt);
    const parsedBudget = Number(totalBudgetInput);
    let allocations: Map<string, number> | null = null;
    if (useTantiemes && Number.isFinite(parsedBudget) && parsedBudget > 0 && lots.length > 0) {
      try {
        allocations = allocateBudgetInCentimes(
          parsedBudget,
          lots.map((a) => ({ id: a.id, tantiemes: a.tantiemes ?? 100 })),
          buildingTantiemesBase
        );
      } catch {
        allocations = null;
      }
    }
    let vacantCount = 0;
    const rows = lots.flatMap((apt) => {
      const residentId =
        apt.ownerId ||
        apt.tenantId ||
        building.residents.find((r: any) => !r.archivedAt && r.apartmentId === apt.id)?.id;
      if (!residentId) {
        vacantCount += 1;
        return [];
      }
      const existing = charges.find(
        (c) =>
          c.apartmentId === apt.id &&
          normalizeBillingPeriodKey(c.period || '') === normalizeBillingPeriodKey(periodName) &&
          (c.chargeType || 'courante') === 'courante'
      );
      return [
        {
          id: apt.id,
          number: apt.number,
          existing: !!existing,
          amount:
            existing?.amount ??
            (useTantiemes
              ? allocations?.get(apt.id) ?? Number.NaN
              : Math.round((apt.monthlyFees ?? building.monthlySyndicFees ?? 0) * 100) / 100),
        },
      ];
    });
    return { chargePreview: rows, vacantLotsInTantiemesMode: vacantCount };
  }, [building, buildingTantiemesBase, charges, periodName, totalBudgetInput, useTantiemes]);

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

  const [bankPostingDate, setBankPostingDate] = useState('');
  const [bankAdjustmentReason, setBankAdjustmentReason] = useState('');
  const bankPostingOptions = {
    postingDate: bankPostingDate || undefined,
    priorPeriodAdjustmentReason: bankAdjustmentReason || undefined,
  };

  const reviewProofMutation = useMutation({
    mutationFn: (data: { proofId: string; decision: 'approve' | 'reject'; reason?: string }) =>
      reviewPaymentProof(data.proofId, data.decision, data.reason, bankPostingOptions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
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

  // Direct one-click download/generate for a charge
  const handleDirectQuittance = async (charge: Charge) => {
    try {
      setDirectGeneratingChargeId(charge.id);
      const existing = quittances.find((q) => q.chargeId === charge.id && !q.voidedAt);
      const apt = building.apartments.find((a) => a.id === charge.apartmentId);
      const res = building.residents.find((r) => r.id === charge.residentId);

      if (existing) {
        generateQuittancePDF(existing, building, syndic, apt, res);
      } else {
        const generated = await generateQuittanceForCharge(charge.id, building.id);
        queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
        generateQuittancePDF(generated, building, syndic, apt, res);
      }
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setDirectGeneratingChargeId(null);
    }
  };

  // Calculated Stats
  const stats = useMemo(() => {
    const { operatingBalance: balance, reserveBalance: reserveFund } =
      computeBuildingFundBalances(building);

    let pendingCents = 0;
    let overdueCents = 0;
    charges.forEach((c) => {
      const remCents = Math.max(0, Math.round((c.amount - (c.paidAmount || 0)) * 100));
      if (remCents <= 0 || c.status === 'paid') return;
      if (isChargeEffectivelyOverdue(c)) {
        overdueCents += remCents;
      } else {
        pendingCents += remCents;
      }
    });

    const pendingProofsCount = paymentProofs.filter((p) => p.status === 'pending').length;

    return {
      balance,
      reserveFund,
      pendingChargesTotal: pendingCents / 100,
      overdueChargesTotal: overdueCents / 100,
      pendingProofsCount,
    };
  }, [building, charges, paymentProofs]);

  // Overdue Debts Grouped by Resident (supports multi-lot owners & dynamic dueDate overdue detection)
  const overdueResidents = useMemo(() => {
    const overdueList = charges.filter((c) => isChargeEffectivelyOverdue(c));
    const grouped: Record<
      string,
      {
        residentId: string;
        residentName: string;
        apartmentNumbers: string[];
        apartmentNumber: string;
        apartment?: Apartment;
        apartments: Apartment[];
        charges: Charge[];
        totalOverdue: number;
        overdueCount: number;
        oldestDate: string;
      }
    > = {};

    overdueList.forEach((c) => {
      const res = building.residents.find((r) => r.id === c.residentId);
      const apt = building.apartments.find((a) => a.id === c.apartmentId);
      if (!grouped[c.residentId]) {
        grouped[c.residentId] = {
          residentId: c.residentId,
          residentName: res?.name || tr('Copropriétaire', 'مالك مشترك'),
          apartmentNumbers: apt?.number ? [apt.number] : [],
          apartmentNumber: apt?.number || 'Lot',
          apartment: apt,
          apartments: apt ? [apt] : [],
          charges: [],
          totalOverdue: 0,
          overdueCount: 0,
          oldestDate: c.dueDate,
        };
      } else if (apt && !grouped[c.residentId].apartments.some((a) => a.id === apt.id)) {
        grouped[c.residentId].apartments.push(apt);
        if (apt.number && !grouped[c.residentId].apartmentNumbers.includes(apt.number)) {
          grouped[c.residentId].apartmentNumbers.push(apt.number);
          grouped[c.residentId].apartmentNumber = grouped[c.residentId].apartmentNumbers.join(', ');
        }
      }
      grouped[c.residentId].charges.push(c);
      grouped[c.residentId].totalOverdue =
        Math.round(
          (grouped[c.residentId].totalOverdue + Math.max(0, c.amount - (c.paidAmount || 0))) * 100
        ) / 100;
      grouped[c.residentId].overdueCount += 1;
      if (new Date(c.dueDate) < new Date(grouped[c.residentId].oldestDate)) {
        grouped[c.residentId].oldestDate = c.dueDate;
      }
    });

    return Object.values(grouped).sort((a, b) => b.totalOverdue - a.totalOverdue);
  }, [charges, building, tr]);

  // Balance Âgée (Aging Report buckets in integer centimes)
  const agingBuckets = useMemo(() => {
    const todayMs = Date.parse(`${todayCasablancaIsoDate()}T00:00:00Z`);
    const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    charges.forEach((c) => {
      if (!isChargeEffectivelyOverdue(c)) return;
      const remCents = Math.max(0, Math.round((c.amount - (c.paidAmount || 0)) * 100));
      if (remCents <= 0) return;
      const dueIso = (c.dueDate || '').slice(0, 10);
      const dueMs = Date.parse(`${dueIso}T00:00:00Z`);
      const ageDays = Number.isFinite(dueMs)
        ? Math.max(0, Math.floor((todayMs - dueMs) / 86_400_000))
        : 0;
      if (ageDays <= 30) buckets.d0_30 += remCents;
      else if (ageDays <= 60) buckets.d31_60 += remCents;
      else if (ageDays <= 90) buckets.d61_90 += remCents;
      else buckets.d90_plus += remCents;
    });
    return {
      d0_30: buckets.d0_30 / 100,
      d31_60: buckets.d31_60 / 100,
      d61_90: buckets.d61_90 / 100,
      d90_plus: buckets.d90_plus / 100,
    };
  }, [charges]);

  // Filtered transactions for the Grand Livre
  const filteredTransactions = useMemo(() => {
    const list = building.financials?.transactions || [];
    return list.filter((trx) => {
      if (filterFund === 'courant' && trx.fundType === 'reserve') return false;
      if (filterFund === 'reserve' && trx.fundType !== 'reserve') return false;

      if (filterType === 'income' && !isIncomeTransaction(trx)) return false;
      if (filterType === 'expense' && isIncomeTransaction(trx)) return false;

      if (filterCategory !== 'all' && trx.category !== filterCategory) return false;

      if (searchTrx.trim()) {
        const q = searchTrx.toLowerCase();
        const desc = (trx.description || '').toLowerCase();
        const ref = (trx.reference || '').toLowerCase();
        const third = (trx.thirdPartyName || '').toLowerCase();
        const ice = (trx.thirdPartyIce || '').toLowerCase();
        const inv = (trx.invoiceNumber || '').toLowerCase();
        const lot = (trx.lotNumber || '').toLowerCase();
        if (
          !desc.includes(q) &&
          !ref.includes(q) &&
          !third.includes(q) &&
          !ice.includes(q) &&
          !inv.includes(q) &&
          !lot.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [building.financials?.transactions, filterFund, filterType, filterCategory, searchTrx]);

  const filteredStats = useMemo(() => {
    const reversedOriginalIds = new Set(
      (building.financials?.transactions || [])
        .map((t) => t.reversalOf)
        .filter((id): id is string => Boolean(id))
    );
    let incomeCents = 0;
    let expenseCents = 0;
    let netCents = 0;
    filteredTransactions.forEach((t) => {
      const signedCents = Math.round(signedTransactionAmount(t) * 100);
      netCents += signedCents;
      // Exclude inter-fund transfers when viewing both funds combined, and exclude cancelled original+reversal pairs from gross flows
      if (filterFund === 'all' && t.transferId) return;
      if (t.reversalOf || reversedOriginalIds.has(t.id)) return;
      if (signedCents >= 0) incomeCents += signedCents;
      else expenseCents += Math.abs(signedCents);
    });
    return {
      income: incomeCents / 100,
      expense: expenseCents / 100,
      net: netCents / 100,
      count: filteredTransactions.length,
    };
  }, [building.financials?.transactions, filteredTransactions, filterFund]);

  // Filtered Quittances and stats (active totals exclude voided quittances)
  const filteredQuittances = useMemo(() => {
    return quittances.filter((q) => {
      const qNum = (q.quittanceNumber || '').toLowerCase();
      const resName = (q.residentName || '').toLowerCase();
      const aptNum = (q.apartmentNumber || '').toLowerCase();
      const ref = (q.referenceNumber || '').toLowerCase();
      const search = quittanceSearch.trim().toLowerCase();

      const matchesSearch =
        search === '' ||
        qNum.includes(search) ||
        resName.includes(search) ||
        aptNum.includes(search) ||
        ref.includes(search);

      const matchesMethod =
        quittanceFilterMethod === 'all' || q.paymentMethod === quittanceFilterMethod;

      return matchesSearch && matchesMethod;
    });
  }, [quittances, quittanceSearch, quittanceFilterMethod]);

  const activeQuittances = useMemo(
    () => quittances.filter((q) => !q.voidedAt),
    [quittances]
  );

  const totalQuittancesAmount = useMemo(() => {
    return (
      activeQuittances.reduce((sum, q) => sum + Math.round((q.amount || 0) * 100), 0) / 100
    );
  }, [activeQuittances]);

  const totalReserveFundAmount = useMemo(() => {
    return (
      activeQuittances.reduce(
        (sum, q) => sum + Math.round((getRecordedReserveSplit(q)?.reserveFundAmount ?? 0) * 100),
        0
      ) / 100
    );
  }, [activeQuittances]);

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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FinancialsIcon />
            <span>{tr('Gestion Financière & Recouvrement', 'الإدارة المالية والتحصيل')}</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {tr(
              `Comptabilité de la copropriété ${building.name} · Tantièmes, Quittances enregistrées et Mises en demeure (Loi 18-00)`,
              `محاسبة الملكية المشتركة ${building.name} · الحصص الشائعة، وصولات الأداء المعتمدة والإنذارات القانونية (القانون 18-00)`
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
            <select
              aria-label={tr('Exercice fiscal', 'السنة المالية')}
              value={selectedFiscalYear}
              onChange={(e) => setSelectedFiscalYear(Number(e.target.value))}
              className="px-2 py-1.5 text-xs font-mono font-semibold text-slate-700 bg-slate-50 border-e border-slate-200 focus:outline-none"
            >
              {availableFiscalYears.map((yr) => (
                <option key={yr} value={yr}>
                  {yr}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              onClick={() =>
                exportAnnualRepartitionPDF(
                  building,
                  syndic,
                  charges,
                  quittances,
                  selectedFiscalYear
                )
              }
              className="text-xs sm:text-sm flex items-center gap-1.5 border-none rounded-none"
            >
              <DocumentsIcon />
              <span>{tr('Clôture Annuelle (PDF)', 'الحصيلة السنوية (PDF)')}</span>
            </Button>
          </div>
          <Button
            variant="secondary"
            onClick={openChargeGeneration}
            className="text-xs sm:text-sm flex items-center gap-1.5"
          >
            <span>{tr('Lancer un appel de fonds', 'إصدار طلب المساهمات')}</span>
          </Button>
          <Button
            onClick={() => setIsTrxModalOpen(true)}
            className="text-xs sm:text-sm flex items-center gap-1.5"
          >
            <PlusIcon />
            <span>{tr('Nouvelle opération', 'عملية مالية جديدة')}</span>
          </Button>
        </div>
      </div>

      {/* KPI Financial Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-s-4 border-s-teal-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {tr('Solde Compte Courant', 'رصيد الحساب الجاري')}
          </p>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
            {currencyFormatter.format(stats.balance)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span>{tr('Banque :', 'البنك:')}</span>
            <span className="font-medium text-slate-700">{building.bankName || ''}</span>
          </p>
        </Card>

        <Card className="p-4 border-s-4 border-s-indigo-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {tr('Fonds de Réserve (Loi 106-12)', 'صندوق الاحتياط (القانون 106-12)')}
          </p>
          <p className="text-2xl font-bold font-mono text-indigo-900 mt-1 tabular-nums">
            {currencyFormatter.format(stats.reserveFund)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {tr('Obligation légale pour gros travaux', 'إلزام قانوني للأشغال الكبرى')}
          </p>
        </Card>

        <Card className="p-4 border-s-4 border-s-amber-500">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {tr('Charges à Recouvrer', 'مساهمات قيد التحصيل')}
          </p>
          <p className="text-2xl font-bold font-mono text-amber-800 mt-1 tabular-nums">
            {currencyFormatter.format(stats.pendingChargesTotal)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">{tr('En cours de règlement', 'في طور الأداء')}</p>
        </Card>

        <Card className="p-4 border-s-4 border-s-rose-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {tr('Impayés & Contentieux', 'المتأخرات والمنازعات')}
          </p>
          <p className="text-2xl font-bold font-mono text-rose-700 mt-1 tabular-nums">
            {currencyFormatter.format(stats.overdueChargesTotal)}
          </p>
          <p className="text-[11px] text-rose-600 mt-1 font-medium">
            {overdueResidents.length} {tr('copropriétaires en retard', 'ملاك مشتركين متأخرين')}
          </p>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-6 overflow-x-auto text-sm font-medium">
          <button
            onClick={() => setActiveTab('transactions')}
            className={`pb-3 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'transactions'
                ? 'border-teal-600 text-teal-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tr('Journal des Transactions', 'سجل المعاملات المالية')}
          </button>

          <button
            onClick={() => setActiveTab('charges')}
            className={`pb-3 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'charges'
                ? 'border-teal-600 text-teal-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tr('Appels de Charges', 'طلبات المساهمات')} ({charges.length})
          </button>

          <button
            onClick={() => setActiveTab('verifications')}
            className={`pb-3 border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              activeTab === 'verifications'
                ? 'border-teal-600 text-teal-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>{tr('Vérification des Virements', 'مراجعة التحويلات البنكية')}</span>
            {stats.pendingProofsCount > 0 && (
              <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                {stats.pendingProofsCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('quittances')}
            className={`pb-3 border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              activeTab === 'quittances'
                ? 'border-teal-600 text-teal-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <QuittanceIcon />
            <span>{tr('Quittances Certifiées', 'وصولات الأداء المعتمدة')} ({activeQuittances.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('impayes')}
            className={`pb-3 border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              activeTab === 'impayes'
                ? 'border-rose-600 text-rose-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldAlertIcon />
            <span>{tr('Recouvrement & Impayés (Loi 18-00)', 'التحصيل والمتأخرات (القانون 18-00)')}</span>
          </button>
        </nav>
      </div>

      {/* TAB 1: JOURNAL DES TRANSACTIONS */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <Card className="p-4 bg-white border border-slate-200">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <div className="md:col-span-4">
                <div className="relative">
                  <input
                    type="text"
                    value={searchTrx}
                    onChange={(e) => setSearchTrx(e.target.value)}
                    placeholder={tr('Rechercher par libellé, prestataire, ICE, chèque...', 'بحث حسب البيان، المهني، رقم ICE، الشيك...')}
                    className="w-full ps-9 pe-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                  <span className="absolute start-2.5 top-2 text-slate-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </span>
                </div>
              </div>

              <div className="md:col-span-2">
                <select
                  value={filterFund}
                  onChange={(e) => setFilterFund(e.target.value as any)}
                  className="w-full py-1.5 px-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">{tr('Tous les fonds', 'جميع الصناديق')}</option>
                  <option value="courant">{tr('Compte Courant', 'الحساب الجاري')}</option>
                  <option value="reserve">{tr('Fonds Réserve (106-12)', 'صندوق الاحتياط (106-12)')}</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="w-full py-1.5 px-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">{tr('Toutes opérations', 'جميع العمليات')}</option>
                  <option value="income">{tr('Recettes (+) uniquement', 'المداخيل (+) فقط')}</option>
                  <option value="expense">{tr('Dépenses (-) uniquement', 'المصاريف (-) فقط')}</option>
                </select>
              </div>

              <div className="md:col-span-3">
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full py-1.5 px-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">{tr('Toutes les catégories', 'جميع الفئات')}</option>
                  {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1 flex justify-end">
                <button
                  onClick={() => {
                    setSearchTrx('');
                    setFilterFund('all');
                    setFilterType('all');
                    setFilterCategory('all');
                  }}
                  title={tr('Réinitialiser filtres', 'إعادة ضبط الفلاتر')}
                  className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  {tr('Effacer', 'مسح')}
                </button>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-slate-500 font-medium">
                {tr(
                  `Affichage de ${filteredStats.count} écriture(s) sur ${building.financials?.transactions?.length || 0}`,
                  `عرض ${filteredStats.count} قيد محاسبي من أصل ${building.financials?.transactions?.length || 0}`
                )}
              </span>
              <div className="flex items-center gap-4 font-mono">
                <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {tr('Recettes :', 'المداخيل:')} +{currencyFormatter.format(filteredStats.income)}
                </span>
                <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                  {tr('Dépenses :', 'المصاريف:')} -{currencyFormatter.format(filteredStats.expense)}
                </span>
                <span className="text-slate-900 bg-slate-100 px-2 py-0.5 rounded font-bold border border-slate-300">
                  {tr('Solde net :', 'الرصيد الصافي:')} {filteredStats.net >= 0 ? '+' : ''}
                  {currencyFormatter.format(filteredStats.net)}
                </span>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden border border-slate-200 shadow-sm">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-slate-800 text-sm">
                  {tr('Grand Livre des Écritures Comptables', 'الدفتر الكبير للقيود المحاسبية')}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {tr(
                    'Tenue des comptes selon la Loi 18-00 · Séparation légale Budget courant & Fonds de réserve',
                    'مسك الحسابات وفق القانون 18-00 · الفصل القانوني بين الميزانية الجارية وصندوق الاحتياط'
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTransferFromFund('courant');
                    setTransferToFund('reserve');
                    setTransferAmount('');
                    setTransferDate(new Date().toISOString().split('T')[0]);
                    setTransferReason('');
                    setIsTransferModalOpen(true);
                  }}
                  className="text-xs py-1.5"
                >
                  {tr('Virement entre fonds', 'تحويل بين الصناديق')}
                </Button>
                <Button
                  onClick={() => {
                    resetTrxForm();
                    setIsTrxModalOpen(true);
                  }}
                  className="text-xs py-1.5 flex items-center gap-1.5"
                >
                  <PlusIcon />
                  <span>{tr('Ajouter une opération', 'إضافة عملية')}</span>
                </Button>
              </div>
            </div>

            {/* Mobile Cards (< md) */}
            <div className="md:hidden divide-y divide-slate-200 bg-white">
              {filteredTransactions.map((trx) => {
                const isIncome = isIncomeTransaction(trx);
                const displayAmount = signedTransactionAmount(trx);
                return (
                  <div
                    key={`trx-card-${trx.id}`}
                    className="p-3.5 space-y-2 active:bg-slate-50"
                    onClick={() => setSelectedTrxForView(trx)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-900 line-clamp-2">
                          {trx.description}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                          {new Date(trx.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                          {trx.lotNumber ? ` · ${tr('Lot', 'شقة')} ${trx.lotNumber}` : ''}
                        </p>
                      </div>
                      <span
                        className={`font-mono font-bold text-sm whitespace-nowrap tabular-nums shrink-0 ${
                          isIncome ? 'text-emerald-600' : 'text-slate-900'
                        }`}
                      >
                        {isIncome ? '+' : ''}
                        {currencyFormatter.format(displayAmount)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {trx.fundType === 'reserve' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {tr('Fonds Réserve', 'صندوق الاحتياط')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                          {tr('Compte Courant', 'الحساب الجاري')}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                        {trx.category ? CATEGORY_LABELS[trx.category] || trx.category : tr('Charges', 'تكاليف')}
                      </span>
                      {trx.thirdPartyName && (
                        <span className="text-slate-600 truncate max-w-[160px]">
                          {trx.thirdPartyName}
                        </span>
                      )}
                    </div>

                    <div
                      className="flex items-center justify-end gap-2 pt-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => generateTransactionVoucherPDF(trx, building, syndic)}
                        className="inline-flex items-center gap-1 min-h-[36px] px-2.5 py-1 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 rounded-lg border border-teal-200"
                      >
                        <DocumentsIcon />
                        <span>PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedTrxForView(trx)}
                        className="min-h-[36px] px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200"
                      >
                        {tr('Détails', 'التفاصيل')}
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredTransactions.length === 0 && (
                <div className="px-4 py-10 text-center text-slate-500">
                  <p className="font-semibold text-sm">{tr('Aucune écriture comptable trouvée', 'لم يتم العثور على أي قيد محاسبي')}</p>
                </div>
              )}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-100/75 text-slate-600 text-start font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="px-4 py-3 text-start">{tr('Date & Réf', 'التاريخ والمرجع')}</th>
                    <th className="px-4 py-3 text-start">{tr('Libellé & Pièce Comptable', 'البيان والوثيقة المحاسبية')}</th>
                    <th className="px-4 py-3 text-start">{tr('Affectation Fonds', 'تخصيص الصندوق')}</th>
                    <th className="px-4 py-3 text-start">{tr('Catégorie', 'الفئة')}</th>
                    <th className="px-4 py-3 text-start">{tr('Règlement & Banque', 'طريقة الأداء والبنك')}</th>
                    <th className="px-4 py-3 text-end">{tr('Montant', 'المبلغ')}</th>
                    <th className="px-4 py-3 text-center">{tr('Justificatif', 'الإثبات')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white font-normal text-slate-800">
                  {filteredTransactions.map((trx) => {
                    const isIncome = isIncomeTransaction(trx);
                    const displayAmount = signedTransactionAmount(trx);
                    return (
                      <tr
                        key={trx.id}
                        className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                        onClick={() => setSelectedTrxForView(trx)}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-medium text-slate-900">
                            {new Date(trx.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                          </p>
                          <span className="font-mono text-[10px] text-slate-400">
                            {trx.id}
                          </span>
                        </td>

                        <td className="px-4 py-3 max-w-xs sm:max-w-md">
                          <p className="font-medium text-slate-900 line-clamp-1">{trx.description}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px]">
                            {trx.thirdPartyName && (
                              <span className="font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                {trx.thirdPartyName}
                              </span>
                            )}
                            {trx.thirdPartyIce && (
                              <span className="text-slate-500 font-mono text-[10px] bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                ICE: {trx.thirdPartyIce}
                              </span>
                            )}
                            {trx.lotNumber && (
                              <span className="text-teal-700 font-medium bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                                {tr('Lot', 'شقة')} {trx.lotNumber}
                              </span>
                            )}
                            {trx.invoiceNumber && (
                              <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-mono text-[10px] border border-amber-200">
                                {trx.documentType ? DOCUMENT_TYPE_LABELS[trx.documentType] || trx.documentType : tr('Pièce', 'وثيقة')} : #{trx.invoiceNumber}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3 whitespace-nowrap">
                          {trx.fundType === 'reserve' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                              {tr('Fonds Réserve (106-12)', 'صندوق الاحتياط (106-12)')}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-teal-600"></span>
                              {tr('Compte Courant', 'الحساب الجاري')}
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3 whitespace-nowrap text-slate-600 font-medium">
                          {trx.category ? CATEGORY_LABELS[trx.category] || trx.category : tr('Charges', 'تكاليف')}
                        </td>

                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                          <p className="uppercase text-[11px] font-semibold text-slate-700">
                            {trx.paymentMethod ? PAYMENT_METHOD_LABELS[trx.paymentMethod] || trx.paymentMethod : tr('Virement', 'تحويل بنكي')}
                          </p>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {trx.reference && <span>{tr('Réf:', 'مرجع:')} {trx.reference} · </span>}
                            <span>{trx.bankName || building.bankName || ''}</span>
                          </div>
                        </td>

                        <td
                          className={`px-4 py-3 text-end font-mono font-bold text-sm whitespace-nowrap tabular-nums ${
                            isIncome ? 'text-emerald-600' : 'text-slate-900'
                          }`}
                        >
                          {isIncome ? '+' : ''}
                          {currencyFormatter.format(displayAmount)}
                        </td>

                        <td
                          className="px-4 py-3 text-center whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => generateTransactionVoucherPDF(trx, building, syndic)}
                              title={tr('Télécharger la pièce comptable PDF (Loi 18-00)', 'تحميل الوثيقة المحاسبية PDF')}
                              className="p-1.5 text-slate-600 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors border border-slate-200"
                            >
                              <DocumentsIcon />
                            </button>
                            <button
                              onClick={() => setSelectedTrxForView(trx)}
                              title={tr("Voir les détails complets de l'opération", 'عرض التفاصيل الكاملة للعملية')}
                              className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200"
                            >
                              {tr('Détails', 'التفاصيل')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredTransactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                        <p className="font-semibold text-sm">{tr('Aucune écriture comptable trouvée', 'لم يتم العثور على أي قيد محاسبي')}</p>
                        <p className="text-xs mt-1 text-slate-400">
                          {tr(
                            'Essayez de modifier vos critères de recherche ou ajoutez une nouvelle opération.',
                            'حاول تعديل معايير البحث أو أضف عملية مالية جديدة.'
                          )}
                        </p>
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSearchTrx('');
                            setFilterFund('all');
                            setFilterType('all');
                            setFilterCategory('all');
                          }}
                          className="mt-3 text-xs"
                        >
                          {tr('Réinitialiser les filtres', 'إعادة ضبط الفلاتر')}
                        </Button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 2: APPELS DE CHARGES & FACTURES */}
      {activeTab === 'charges' && (
        <Card className="overflow-hidden border border-slate-200">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="font-semibold text-slate-800 text-sm">{tr('Appels de Charges & Factures (Avis d’appel)', 'طلبات المساهمات والفواتير (إشعارات الأداء)')}</h3>
              <p className="text-xs text-slate-500">
                {tr('Cotisations configurées par lot ou budget réparti selon les tantièmes, selon le mode choisi à l’émission.', 'مساهمات محددة لكل شقة أو ميزانية موزعة حسب الحصص وفق طريقة الإصدار المختارة.')}
              </p>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mt-2">
                <button
                  type="button"
                  onClick={() => setChargesSubTab('charges')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    chargesSubTab === 'charges'
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tr('Appels par lot', 'المساهمات حسب الوحدة')} ({charges.length})
                </button>
                <button
                  type="button"
                  onClick={() => setChargesSubTab('invoices')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${
                    chargesSubTab === 'invoices'
                      ? 'bg-teal-700 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tr('Factures / Avis d’appel', 'الفواتير / إشعارات الأداء')} ({invoices.length})
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={openChargeGeneration}
                className="text-xs"
              >
                {tr('+ Nouvel Appel Général', '+ طلب مساهمات عام جديد')}
              </Button>
              <Button
                onClick={() => openQuittanceModalNew()}
                className="text-xs bg-teal-700 hover:bg-teal-800 flex items-center gap-1.5"
              >
                <QuittanceIcon />
                <span>{tr('+ Émettre une Quittance', '+ إصدار وصل إبراء')}</span>
              </Button>
            </div>
          </div>

          {chargesSubTab === 'charges' ? (
          <>
          {/* Mobile Cards (< md) */}
          <div className="md:hidden divide-y divide-slate-200 bg-white">
            {charges.map((charge) => {
              const apt = building.apartments.find((a) => a.id === charge.apartmentId);
              const res = building.residents.find((r) => r.id === charge.residentId);
              const paidCents = Math.round((charge.paidAmount || 0) * 100);
              const amountCents = Math.round((charge.amount || 0) * 100);
              const remainingCents = Math.max(0, amountCents - paidCents);
              const isPartial = charge.status !== 'paid' && paidCents > 0 && remainingCents > 0;
              const effectivelyOverdue = isChargeEffectivelyOverdue(charge);
              const activeChargeQuittances = quittances.filter(
                (q) => q.chargeId === charge.id && !q.voidedAt
              );
              return (
                <div key={`charge-card-${charge.id}`} className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono font-bold text-sm text-teal-800">
                          {apt?.number || 'Lot'}
                        </span>
                        <span className="font-semibold text-sm text-slate-900 truncate">
                          {res?.name || tr('Inconnu', 'غير معروف')}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {charge.period || '—'} · {tr('Éch.', 'استحقاق')}{' '}
                        <span className="font-mono">
                          {new Date(charge.dueDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                        </span>
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="font-mono font-bold text-sm text-slate-900">
                        {currencyFormatter.format(charge.amount)}
                      </div>
                      <span
                        className={`inline-block mt-0.5 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          charge.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : isPartial
                            ? effectivelyOverdue
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-sky-50 text-sky-700'
                            : effectivelyOverdue
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {charge.status === 'paid'
                          ? tr('Payé', 'مؤدى')
                          : isPartial
                          ? effectivelyOverdue
                            ? tr('Partiel (en retard)', 'جزئي (متأخر)')
                            : tr('Partiellement payée', 'مؤدى جزئياً')
                          : effectivelyOverdue
                          ? tr('En retard', 'متأخر')
                          : tr('En attente', 'في الانتظار')}
                      </span>
                    </div>
                  </div>
                  {isPartial && (
                    <div className="text-[11px] font-mono text-sky-700 bg-sky-50/70 rounded px-2.5 py-1">
                      {tr('Réglé:', 'المؤدى:')} {currencyFormatter.format(paidCents / 100)} ·{' '}
                      {tr('Reste:', 'الباقي:')} {currencyFormatter.format(remainingCents / 100)}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {charge.status === 'paid' ? (
                      <button
                        type="button"
                        onClick={() => handleDirectQuittance(charge)}
                        disabled={directGeneratingChargeId === charge.id}
                        className="min-h-[36px] px-3 py-1.5 text-xs bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold rounded-lg border border-teal-200 flex items-center gap-1"
                      >
                        <QuittanceIcon />
                        <span>
                          {directGeneratingChargeId === charge.id
                            ? tr('Génération...', 'جاري الإصدار...')
                            : tr('Quittance PDF', 'وصل PDF')}
                        </span>
                      </button>
                    ) : (
                      <>
                        {activeChargeQuittances.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              generateQuittancePDF(activeChargeQuittances[0], building, syndic, apt, res)
                            }
                            className="min-h-[36px] px-2.5 py-1.5 text-xs bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold rounded-lg border border-teal-200 flex items-center gap-1"
                          >
                            <QuittanceIcon />
                            <span>{tr('Quittance PDF', 'وصل PDF')}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openQuittanceModalForCharge(charge)}
                          className="min-h-[36px] px-3 py-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-semibold rounded-lg border border-emerald-200"
                        >
                          {tr('+ Quittance', '+ إصدار وصل')}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        if (!res) return;
                        try {
                          const buildingInvoices = await getInvoicesForBuilding(building.id);
                          const invoice =
                            buildingInvoices.find(
                              (i) =>
                                i.status !== 'cancelled' &&
                                (i.id === charge.invoiceId || i.chargeIds.includes(charge.id))
                            ) || (await createInvoiceForResident(charge.residentId, building.id, building.syndicId));
                          queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
                          generateInvoicePDF(invoice, building, res, syndic);
                        } catch (e: any) {
                          showToast(e.message, 'error');
                        }
                      }}
                      className="min-h-[36px] px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 font-semibold"
                    >
                      {tr('Avis PDF', 'إشعار PDF')}
                    </button>
                  </div>
                </div>
              );
            })}
            {charges.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                {tr('Aucun appel de charges enregistré.', 'لا توجد مساهمات مسجلة حالياً.')}
              </div>
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-500 text-start font-medium">
                <tr>
                  <th className="px-4 py-2.5 text-start">{tr('Lot / Apt', 'الشقة / الوحدة')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Copropriétaire', 'المالك المشترك')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Période', 'الفترة')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Échéance', 'تاريخ الاستحقاق')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Statut', 'الحالة')}</th>
                  <th className="px-4 py-2.5 text-end">{tr('Cotisation', 'المساهمة')}</th>
                  <th className="px-4 py-2.5 text-end">{tr('Documents & Quittance', 'الوثائق والوصل')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {charges.map((charge) => {
                  const apt = building.apartments.find((a) => a.id === charge.apartmentId);
                  const res = building.residents.find((r) => r.id === charge.residentId);
                  const paidCents = Math.round((charge.paidAmount || 0) * 100);
                  const amountCents = Math.round((charge.amount || 0) * 100);
                  const remainingCents = Math.max(0, amountCents - paidCents);
                  const isPartial = charge.status !== 'paid' && paidCents > 0 && remainingCents > 0;
                  const effectivelyOverdue = isChargeEffectivelyOverdue(charge);
                  const activeChargeQuittances = quittances.filter(
                    (q) => q.chargeId === charge.id && !q.voidedAt
                  );

                  return (
                    <tr key={charge.id} className="hover:bg-slate-50 transition-colors h-11">
                      <td className="px-4 py-2 font-mono font-bold text-teal-800">
                        {apt?.number || 'Lot'}
                        {apt?.tantiemes !== undefined && (
                          <span className="ms-1.5 text-[11px] font-normal text-slate-400">
                            ({apt.tantiemes}/{buildingTantiemesBase})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900">{res?.name || tr('Inconnu', 'غير معروف')}</td>
                      <td className="px-4 py-2 text-slate-600">{charge.period || '—'}</td>
                      <td className="px-4 py-2 text-slate-500 font-mono text-xs">
                        {new Date(charge.dueDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            charge.status === 'paid'
                              ? 'bg-emerald-50 text-emerald-700'
                              : isPartial
                              ? effectivelyOverdue
                                ? 'bg-rose-50 text-rose-700'
                                : 'bg-sky-50 text-sky-700'
                              : effectivelyOverdue
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {charge.status === 'paid'
                            ? tr('Payé', 'مؤدى')
                            : isPartial
                            ? effectivelyOverdue
                              ? tr('Partiel (en retard)', 'جزئي (متأخر)')
                              : tr('Partiellement payée', 'مؤدى جزئياً')
                            : effectivelyOverdue
                            ? tr('En retard', 'متأخر')
                            : tr('En attente', 'في الانتظار')}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-end font-mono font-bold text-slate-900">
                        <div>{currencyFormatter.format(charge.amount)}</div>
                        {isPartial && (
                          <div className="text-[10px] font-normal text-sky-700">
                            {tr('Réglé:', 'المؤدى:')} {currencyFormatter.format(paidCents / 100)} ·{' '}
                            {tr('Reste:', 'الباقي:')} {currencyFormatter.format(remainingCents / 100)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-end">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          {charge.status === 'paid' ? (
                            <button
                              onClick={() => handleDirectQuittance(charge)}
                              disabled={directGeneratingChargeId === charge.id}
                              className="px-2.5 py-1 text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded transition-colors flex items-center gap-1 shrink-0"
                            >
                              <QuittanceIcon />
                              <span>
                                {directGeneratingChargeId === charge.id
                                  ? tr('Génération...', 'جاري الإصدار...')
                                  : tr('Quittance PDF', 'وصل PDF')}
                              </span>
                            </button>
                          ) : (
                            <>
                              {activeChargeQuittances.length > 0 && (
                                <button
                                  onClick={() => {
                                    generateQuittancePDF(
                                      activeChargeQuittances[0],
                                      building,
                                      syndic,
                                      apt,
                                      res
                                    );
                                  }}
                                  className="px-2 py-0.5 text-[11px] bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded transition-colors flex items-center gap-1 shrink-0"
                                >
                                  <QuittanceIcon />
                                  <span>{tr('Quittance PDF', 'وصل PDF')}</span>
                                </button>
                              )}
                              <button
                                onClick={() => openQuittanceModalForCharge(charge)}
                                className="px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded border border-emerald-200 shrink-0"
                              >
                                {tr('+ Quittance', '+ إصدار وصل')}
                              </button>
                            </>
                          )}

                          <button
                            onClick={async () => {
                              if (!res) return;
                              try {
                                const buildingInvoices = await getInvoicesForBuilding(building.id);
                                const invoice =
                                  buildingInvoices.find(
                                    (i) =>
                                      i.status !== 'cancelled' &&
                                      (i.id === charge.invoiceId || i.chargeIds.includes(charge.id))
                                  ) || (await createInvoiceForResident(charge.residentId, building.id, building.syndicId));
                                queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
                                generateInvoicePDF(invoice, building, res, syndic);
                              } catch (e: any) {
                                showToast(e.message, 'error');
                              }
                            }}
                            className="text-[11px] text-slate-500 hover:text-slate-800 underline px-1"
                          >
                            {tr('Avis', 'إشعار')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
          ) : (
          <>
          {/* Mobile Cards (< md) */}
          <div className="md:hidden divide-y divide-slate-200 bg-white">
            {invoices.map((inv) => {
              const res = building.residents.find((r) => r.id === inv.residentId);
              const remaining = Math.max(
                0,
                Math.round(((inv.totalAmount || 0) - (inv.paidAmount || 0)) * 100)
              ) / 100;
              const isVoided = inv.status === 'cancelled' || Boolean(inv.voidedAt);
              const isPartialInv = !isVoided && inv.status !== 'paid' && (inv.paidAmount || 0) > 0 && remaining > 0;
              const canPay = !isVoided && inv.status !== 'paid' && remaining > 0;
              const canVoid = !isVoided && (inv.paidAmount || 0) === 0;
              return (
                <div
                  key={`inv-card-${inv.id}`}
                  className={`p-3.5 space-y-2.5 ${isVoided ? 'opacity-60 bg-slate-50/70' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm text-teal-800">{inv.invoiceNumber}</div>
                      <div className="font-semibold text-sm text-slate-900 truncate">
                        {res?.name || inv.issuedTo?.name || tr('Copropriétaire', 'مالك مشترك')}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                        {inv.chargeIds.length} {tr('charge(s)', 'مساهمة(ات)')} · {tr('Éch.:', 'الاستحقاق:')}{' '}
                        {new Date(inv.dueDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                      </div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className={`font-mono font-bold text-sm ${isVoided ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                        {currencyFormatter.format(inv.totalAmount)}
                      </div>
                      <span
                        className={`inline-block mt-0.5 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          inv.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : isVoided
                            ? 'bg-slate-200 text-slate-600'
                            : inv.status === 'overdue'
                            ? 'bg-rose-50 text-rose-700'
                            : isPartialInv
                            ? 'bg-sky-50 text-sky-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {inv.status === 'paid'
                          ? tr('Soldée', 'مؤداة')
                          : isVoided
                          ? tr('Annulée', 'ملغاة')
                          : inv.status === 'overdue'
                          ? tr('En retard', 'متأخرة')
                          : isPartialInv
                          ? tr('Partielle', 'جزئية')
                          : tr('Émise', 'صادرة')}
                      </span>
                    </div>
                  </div>
                  {!isVoided && remaining > 0 && remaining < inv.totalAmount && (
                    <div className="text-[11px] font-mono text-sky-700 bg-sky-50/70 rounded px-2.5 py-1">
                      {tr('Reste:', 'الباقي:')} {currencyFormatter.format(remaining)}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {res && (
                      <button
                        type="button"
                        onClick={() => generateInvoicePDF(inv, building, res, syndic)}
                        className="min-h-[36px] px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                      >
                        PDF
                      </button>
                    )}
                    {canPay && (
                      <button
                        type="button"
                        onClick={() => {
                          setPayInvoiceTarget(inv);
                          setPayInvoiceAmount(String(remaining));
                          setPayInvoiceMethod('virement');
                          setPayInvoiceReference(`VIR-${inv.invoiceNumber}`);
                          setPayInvoiceDate(new Date().toISOString().split('T')[0]);
                        }}
                        className="min-h-[36px] px-3 py-1.5 text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded-lg border border-emerald-200"
                      >
                        {tr('Encaisser', 'تحصيل')}
                      </button>
                    )}
                    {canVoid && (
                      <button
                        type="button"
                        onClick={() => {
                          setVoidInvoiceTarget(inv);
                          setVoidInvoiceReason('');
                        }}
                        className="min-h-[36px] px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 font-semibold rounded-lg border border-rose-200"
                      >
                        {tr('Annuler', 'إلغاء')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {invoices.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-slate-500">
                {tr(
                  'Aucune facture / avis groupé émis. Cliquez sur « Avis » sur une charge pour générer une facture consolidée.',
                  'لم تصدر أي فاتورة أو إشعار مجمع بعد. اضغط على «إشعار» بجانب أي مساهمة لإصدار فاتورة مجمعة.'
                )}
              </div>
            )}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-500 text-start font-medium">
                <tr>
                  <th className="px-4 py-2.5 text-start">{tr('N° Facture / Avis', 'رقم الفاتورة / الإشعار')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Copropriétaire', 'المالك المشترك')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Émission & Échéance', 'الإصدار والاستحقاق')}</th>
                  <th className="px-4 py-2.5 text-start">{tr('Statut', 'الحالة')}</th>
                  <th className="px-4 py-2.5 text-end">{tr('Total / Reste', 'المجموع / الباقي')}</th>
                  <th className="px-4 py-2.5 text-end">{tr('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {invoices.map((inv) => {
                  const res = building.residents.find((r) => r.id === inv.residentId);
                  const remaining = Math.max(
                    0,
                    Math.round(((inv.totalAmount || 0) - (inv.paidAmount || 0)) * 100)
                  ) / 100;
                  const isVoided = inv.status === 'cancelled' || Boolean(inv.voidedAt);
                  const isPartialInv = !isVoided && inv.status !== 'paid' && (inv.paidAmount || 0) > 0 && remaining > 0;
                  const canPay = !isVoided && inv.status !== 'paid' && remaining > 0;
                  const canVoid = !isVoided && (inv.paidAmount || 0) === 0;
                  return (
                    <tr
                      key={inv.id}
                      className={`hover:bg-slate-50 transition-colors ${isVoided ? 'opacity-60 bg-slate-50/70' : ''}`}
                    >
                      <td className="px-4 py-2.5 font-mono font-bold text-teal-800">
                        <div>{inv.invoiceNumber}</div>
                        <div className="text-[10px] font-normal text-slate-400">
                          {inv.chargeIds.length} {tr('charge(s)', 'مساهمة(ات)')}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">
                        {res?.name || inv.issuedTo?.name || tr('Copropriétaire', 'مالك مشترك')}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">
                        <div>{new Date(inv.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}</div>
                        <div className="text-[10px] text-slate-400">
                          {tr('Éch.:', 'الاستحقاق:')} {new Date(inv.dueDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            inv.status === 'paid'
                              ? 'bg-emerald-50 text-emerald-700'
                              : isVoided
                              ? 'bg-slate-200 text-slate-600'
                              : inv.status === 'overdue'
                              ? 'bg-rose-50 text-rose-700'
                              : isPartialInv
                              ? 'bg-sky-50 text-sky-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {inv.status === 'paid'
                            ? tr('Soldée', 'مؤداة')
                            : isVoided
                            ? tr('Annulée', 'ملغاة')
                            : inv.status === 'overdue'
                            ? tr('En retard', 'متأخرة')
                            : isPartialInv
                            ? tr('Partielle', 'جزئية')
                            : tr('Émise', 'صادرة')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-end font-mono">
                        <div className={`font-bold ${isVoided ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                          {currencyFormatter.format(inv.totalAmount)}
                        </div>
                        {!isVoided && remaining > 0 && remaining < inv.totalAmount && (
                          <div className="text-[10px] text-sky-700">
                            {tr('Reste:', 'الباقي:')} {currencyFormatter.format(remaining)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-end whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {res && (
                            <button
                              type="button"
                              onClick={() => generateInvoicePDF(inv, building, res, syndic)}
                              className="px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded"
                            >
                              PDF
                            </button>
                          )}
                          {canPay && (
                            <button
                              type="button"
                              onClick={() => {
                                setPayInvoiceTarget(inv);
                                setPayInvoiceAmount(String(remaining));
                                setPayInvoiceMethod('virement');
                                setPayInvoiceReference(`VIR-${inv.invoiceNumber}`);
                                setPayInvoiceDate(new Date().toISOString().split('T')[0]);
                              }}
                              className="px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded border border-emerald-200"
                            >
                              {tr('Encaisser', 'تحصيل')}
                            </button>
                          )}
                          {canVoid && (
                            <button
                              type="button"
                              onClick={() => {
                                setVoidInvoiceTarget(inv);
                                setVoidInvoiceReason('');
                              }}
                              className="px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 font-semibold rounded border border-rose-200"
                            >
                              {tr('Annuler', 'إلغاء')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">
                      {tr(
                        'Aucune facture / avis groupé émis. Cliquez sur « Avis » sur une charge pour générer une facture consolidée.',
                        'لم تصدر أي فاتورة أو إشعار مجمع بعد. اضغط على «إشعار» بجانب أي مساهمة لإصدار فاتورة مجمعة.'
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </>
          )}
        </Card>
      )}

      {/* TAB 3: VÉRIFICATION DES VIREMENTS */}
      {activeTab === 'verifications' && (
        <Card className="overflow-hidden border border-slate-200">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-800 text-sm">
                {tr("File d'Attente des Justificatifs de Virement", 'قائمة انتظار إثباتات التحويل البنكي')}
              </h3>
              <p className="text-xs text-slate-500">
                {tr(
                  'Vérifiez les virements reçus ou validez en 1 clic les justificatifs pré-vérifiés (montant exact)',
                  'تحقق من التحويلات البنكية أو صادق بنقرة واحدة على التحويلات المطابقة تلقائياً'
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors">
                <span>📥 {tr('Import Relevé CSV Bancaire', 'استيراد كشف بنكي CSV')}</span>
                <input
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const text = await file.text();
                      const parsedRows = parseBankCsvRows(text);
                      if (!parsedRows.some((r) => r.amount > 0)) {
                        throw new Error(tr('Aucune ligne de crédit bancaire valide détectée dans le CSV.', 'لم يتم العثور على أي سطر دائن بنكي صالح في ملف CSV.'));
                      }
                      const preview = await reconcileBankStatementCSV(building.id, parsedRows, { ...bankPostingOptions, preview: true });
                      const dates = (preview.preview || []).map(row =>
                        `${row.amount} MAD — ${tr('Date bancaire', 'تاريخ البنك')}: ${row.bankTransactionDate} — ${tr('Comptabilisation', 'تاريخ القيد')}: ${row.postingDate}`);
                      const confirmed = await confirmAction({
                        title: tr('Confirmer le rapprochement bancaire', 'تأكيد المطابقة البنكية'),
                        message: [tr('Confirmer le rapprochement', 'تأكيد المطابقة'), ...dates].join('\n'),
                        confirmLabel: tr('Confirmer', 'تأكيد'),
                      });
                      if (!confirmed) return;
                      const res = await reconcileBankStatementCSV(building.id, parsedRows, bankPostingOptions);
                      setUnmatchedCsvRows(res.unmatchedRows || []);
                      await queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['invoices', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
                      await queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
                      const unmatchedCount = (res.unmatchedRows || []).length;
                      showToast(
                        unmatchedCount > 0
                          ? tr(
                              `Rapprochement bancaire terminé : ${res.matchedCount} virement(s) lettré(s) (${res.totalReconciledMad} MAD), ${unmatchedCount} ligne(s) à rapprocher manuellement.`,
                              `تمت المطابقة البنكية: ${res.matchedCount} تحويلات مطابقة (${res.totalReconciledMad} درهم)، و${unmatchedCount} سطر(اً) يتطلب مطابقة يدوية.`
                            )
                          : tr(
                              `Rapprochement bancaire terminé : ${res.matchedCount} virement(s) lettré(s) (${res.totalReconciledMad} MAD).`,
                              `تمت المطابقة البنكية: ${res.matchedCount} تحويلات مطابقة (${res.totalReconciledMad} درهم).`
                            ),
                        res.matchedCount > 0 ? 'success' : 'info'
                      );
                    } catch (err: any) {
                      showToast(err?.message || 'Erreur lors de la lecture du CSV', 'error');
                    } finally {
                      e.target.value = '';
                    }
                  }}
                />
              </label>
              {stats.pendingProofsCount > 0 && (
                <Button
                  disabled={approvingBatch}
                  onClick={async () => {
                    setApprovingBatch(true);
                    try {
                      const res = await approvePaymentProofsBatch(building.id, undefined, bankPostingOptions);
                      await queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
                      await queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] });
                      const skippedSuffixFr = res.skippedCount
                        ? ` (${res.skippedCount} ignoré(s) : montant non exact ou charge déjà soldée)`
                        : '';
                      const skippedSuffixAr = res.skippedCount
                        ? ` (تم تجاوز ${res.skippedCount} لعدم تطابق المبلغ أو تسديد المساهمة مسبقاً)`
                        : '';
                      showToast(
                        tr(
                          `${res.approvedCount} justificatif(s) conforme(s) validé(s) (${res.totalAmountMad} MAD)${skippedSuffixFr}.`,
                          `تمت المصادقة على ${res.approvedCount} إثباتات مطابقة (${res.totalAmountMad} درهم)${skippedSuffixAr}.`
                        ),
                        res.approvedCount > 0 ? 'success' : 'info'
                      );
                    } catch (error: any) {
                      showToast(error.message, 'error');
                    } finally {
                      setApprovingBatch(false);
                    }
                  }}
                  className="text-xs bg-teal-700 hover:bg-teal-800 text-white font-bold"
                >
                  ✓ {tr('Valider les virements conformes (1-clic)', 'تأكيد التحويلات المطابقة (نقرة واحدة)')}
                </Button>
              )}
            </div>
          </div>

          <details className="p-4 border-b border-slate-200">
            <summary>{tr('Ajustement explicite de période comptable (optionnel)', 'تعديل صريح للفترة المحاسبية (اختياري)')}</summary>
            <p className="text-xs text-slate-600 my-2">{tr('Par défaut, la date bancaire est utilisée. Pour une période clôturée, choisissez une date ouverte et justifiez l’ajustement. Ces valeurs s’appliquent aux validations individuelles et au CSV.', 'يُستخدم تاريخ البنك افتراضياً. للفترة المغلقة اختر تاريخاً في فترة مفتوحة مع ذكر السبب. تنطبق القيم على الموافقات الفردية وملف CSV.')}</p>
            <label>{tr('Date de comptabilisation', 'تاريخ القيد')}<input type="date" value={bankPostingDate} onChange={e => setBankPostingDate(e.target.value)} className="border rounded p-2 mx-2" /></label>
            <label>{tr('Motif de l’ajustement', 'سبب التعديل')}<input value={bankAdjustmentReason} maxLength={1000} onChange={e => setBankAdjustmentReason(e.target.value)} className="border rounded p-2 mx-2" /></label>
          </details>

          {unmatchedCsvRows.length > 0 && (
            <div className="p-4 bg-amber-50/70 border-b border-amber-200 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                    {tr(
                      `Lignes CSV non lettrées automatiquement (${unmatchedCsvRows.length})`,
                      `أسطر CSV غير مطابقة تلقائياً (${unmatchedCsvRows.length})`
                    )}
                  </h4>
                  <p className="text-[11px] text-amber-800">
                    {tr(
                      'Cliquez sur une charge candidate pour pré-remplir la quittance avec les informations du relevé.',
                      'انقر على مساهمة مرشحة لتعبئة الوصل تلقائياً ببيانات الكشف البنكي.'
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUnmatchedCsvRows([])}
                  className="text-xs font-semibold text-amber-900 hover:underline"
                >
                  {tr('Fermer', 'إغلاق')}
                </button>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {unmatchedCsvRows.map((row, rowIdx) => {
                  const reasonLabel =
                    row.reason === 'duplicate'
                      ? tr('Déjà importé', 'تم استيراده مسبقاً')
                      : row.reason === 'ambiguous'
                      ? tr('Ambiguë (plusieurs lots)', 'غائم (عدة شقق)')
                      : row.reason === 'non_positive'
                      ? tr('Montant ≤ 0', 'مبلغ ≤ 0')
                      : tr('Aucune correspondance exacte', 'لا يوجد تطابق دقيق');
                  return (
                    <div
                      key={`${rowIdx}-${row.reference || row.label}`}
                      className="p-2.5 bg-white rounded-lg border border-amber-200/80 text-xs space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-slate-500">{row.date}</span>
                          <span className="font-semibold text-slate-900">{row.label}</span>
                          {row.reference && (
                            <span className="font-mono text-[11px] text-slate-500">
                              ({row.reference})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900">
                            {currencyFormatter.format(row.amount)}
                          </span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
                            {reasonLabel}
                          </span>
                        </div>
                      </div>
                      {row.candidates && row.candidates.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                          <span className="text-[11px] text-slate-500">
                            {tr('Affecter à :', 'توجيه إلى:')}
                          </span>
                          {row.candidates.map((cand, candIdx) => {
                            const matchedCharge = cand.chargeId
                              ? charges.find((c) => c.id === cand.chargeId)
                              : undefined;
                            if (!matchedCharge) return null;
                            return (
                              <button
                                key={cand.chargeId || cand.invoiceId || candIdx}
                                type="button"
                                onClick={() =>
                                  openQuittanceModalForCharge(matchedCharge, {
                                    amount: row.amount,
                                    reference: row.reference || undefined,
                                    bankDate: /^\d{4}-\d{2}-\d{2}/.test(row.date)
                                      ? row.date.slice(0, 10)
                                      : undefined,
                                    remarks: `Rapprochement relevé CSV : ${row.label}`,
                                  })
                                }
                                className="px-2 py-0.5 rounded border border-teal-300 bg-teal-50 hover:bg-teal-100 text-teal-900 font-medium text-[11px]"
                              >
                                {tr('Lot', 'شقة')} {cand.apartmentNumber} · {cand.residentName} (
                                {matchedCharge.period || cand.invoiceNumber || '—'} —{' '}
                                {currencyFormatter.format(cand.remainingAmount)})
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="divide-y divide-slate-100">
            {paymentProofs.map((proof) => (
              <div key={proof.id} className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{proof.residentName}</span>
                    <span className="font-mono text-xs font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded">
                      {tr('Lot', 'شقة')} {proof.apartmentNumber}
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                        proof.status === 'approved'
                          ? 'bg-emerald-50 text-emerald-700'
                          : proof.status === 'rejected'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {proof.status === 'pending'
                        ? tr('En attente de vérification', 'في انتظار التحقق')
                        : proof.status === 'approved'
                        ? tr('Validé', 'مصادق عليه')
                        : tr('Rejeté', 'مرفوض')}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      {tr('Banque émettrice :', 'البنك المصدر:')} <strong>{proof.bankName}</strong>
                    </span>
                    <span>
                      {tr('Réf Virement :', 'مرجع التحويل:')} <strong className="font-mono">{proof.referenceNumber}</strong>
                    </span>
                    <span>
                      {tr('Soumis le :', 'تاريخ الإرسال:')} {new Date(proof.submissionDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')} · {tr('Date bancaire :', 'تاريخ البنك:')} {proof.bankTransactionDate || '—'} · {tr('Comptabilisation :', 'تاريخ القيد:')} {proof.postingDate || bankPostingDate || proof.bankTransactionDate || proof.submissionDate.slice(0, 10)}
                    </span>
                  </div>

                  {proof.receiptNote && (
                    <p className="text-xs text-slate-500 italic mt-1">"{proof.receiptNote}"</p>
                  )}
                  {proof.receiptUrl?.startsWith('/api/uploads/') && (
                    <a href={proof.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-xs font-semibold text-teal-700 underline">
                      {tr('Ouvrir le justificatif', 'فتح إثبات الأداء')}
                    </a>
                  )}
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-end">
                    <span className="text-xs text-slate-400 block">{tr('Montant justifié', 'المبلغ المصرح به')}</span>
                    <span className="font-mono font-bold text-base text-slate-900">
                      {currencyFormatter.format(proof.amount)}
                    </span>
                  </div>

                  {proof.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <Button
                        disabled={reviewProofMutation.isPending}
                        onClick={() =>
                          reviewProofMutation.mutate({ proofId: proof.id, decision: 'approve' })
                        }
                        className="text-xs bg-emerald-600 hover:bg-emerald-700"
                      >
                        {tr('Valider & Délivrer Quittance', 'تأكيد وإصدار الوصل')}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={reviewProofMutation.isPending}
                        onClick={() => {
                          setRejectingProofId(proof.id);
                          setRejectReason(
                            tr('Référence introuvable sur le relevé', 'المرجع غير موجود في الكشف البنكي')
                          );
                        }}
                        className="text-xs text-rose-600 hover:bg-rose-50"
                      >
                        {tr('Rejeter', 'رفض')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {paymentProofs.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs">
                {tr('Aucun justificatif de virement en attente de vérification.', 'لا يوجد أي إثبات تحويل بنكي في انتظار المراجعة.')}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* TAB 4: QUITTANCES CERTIFIÉES */}
      {activeTab === 'quittances' && (
        <div className="space-y-4">
          <Card className="bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 text-white p-5 border-none shadow-md">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-teal-700/80 text-teal-100 px-2.5 py-0.5 rounded-full border border-teal-500/30">
                    {tr('Loi n° 18-00 & Loi n° 106-12 (Art. 18 bis)', 'القانون 18-00 والقانون 106-12 (المادة 18 مكرر)')}
                  </span>
                  <span className="text-[11px] text-teal-200">{tr('Reçu libératoire officiel', 'وصل إبراء رسمي')}</span>
                </div>
                <h3 className="text-lg font-bold tracking-tight">
                  {tr('Registre Légal des Quittances de Copropriété', 'السجل القانوني لوصولات أداء الملكية المشتركة')}
                </h3>
                <p className="text-xs text-teal-100/90 max-w-2xl leading-relaxed">
                  {tr(
                    'Conformément aux exigences réglementaires marocaines, toute quittance délivrée par le syndic décharge libératoirement le copropriétaire pour la période certifiée et inclut obligatoirement la quote-part du Fonds de Réserve pour travaux.',
                    'وفقاً للمتطلبات القانونية المغربية، فإن كل وصل أداء يسلمه السنديك يبرئ ذمة المالك المشترك عن الفترة المحددة ويتضمن وجوباً حصة صندوق الاحتياط للأشغال.'
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={() => openQuittanceModalNew()}
                  className="bg-white text-teal-900 hover:bg-teal-50 font-bold text-xs sm:text-sm shadow-sm flex items-center gap-1.5"
                >
                  <QuittanceIcon />
                  <span>{tr('+ Émettre une Quittance', '+ إصدار وصل إبراء')}</span>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-teal-700/60">
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-200 font-semibold uppercase block">
                  {tr('Quittances Actives', 'الوصولات السارية')}
                </span>
                <span className="text-lg font-bold font-mono text-white mt-0.5 block">{activeQuittances.length}</span>
              </div>
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-200 font-semibold uppercase block">
                  {tr('Cotisations Quittancées', 'المساهمات المؤداة')}
                </span>
                <span className="text-lg font-bold font-mono text-white mt-0.5 block">
                  {currencyFormatter.format(totalQuittancesAmount)}
                </span>
              </div>
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-200 font-semibold uppercase block">
                  {tr('Réserve documentée (Quittances)', 'الاحتياطي الموثق (الوصولات)')}
                </span>
                <span className="text-lg font-bold font-mono text-emerald-300 mt-0.5 block">
                  {currencyFormatter.format(totalReserveFundAmount)}
                </span>
              </div>
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-200 font-semibold uppercase block">
                  {tr('Dernier Récépissé', 'آخر وصل صادر')}
                </span>
                <span className="text-xs font-mono font-bold text-teal-100 truncate mt-1 block">
                  {activeQuittances[0]?.quittanceNumber || quittances[0]?.quittanceNumber || tr('Aucun', 'لا يوجد')}
                </span>
              </div>
            </div>
          </Card>

          <Card className="p-3 bg-white border border-slate-200">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <input
                  type="text"
                  value={quittanceSearch}
                  onChange={(e) => setQuittanceSearch(e.target.value)}
                  placeholder={tr('Filtrer par copropriétaire, lot, N° quittance...', 'تصفية حسب المالك، الشقة، رقم الوصل...')}
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showVoidedQuittances}
                    onChange={(e) => setShowVoidedQuittances(e.target.checked)}
                    className="rounded text-rose-600 focus:ring-rose-500"
                  />
                  <span>{tr('Inclure les quittances annulées', 'إظهار الوصولات الملغاة')}</span>
                </label>

                <select
                  value={quittanceFilterMethod}
                  onChange={(e) => setQuittanceFilterMethod(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
                >
                  <option value="all">{tr('Tous les modes de paiement', 'جميع طرق الأداء')}</option>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([methodKey, label]) => (
                    <option key={methodKey} value={methodKey}>
                      {label}
                    </option>
                  ))}
                </select>

                {quittanceSearch && (
                  <button
                    onClick={() => setQuittanceSearch('')}
                    className="text-xs text-slate-500 hover:text-slate-800 underline px-1"
                  >
                    {tr('Effacer', 'مسح')}
                  </button>
                )}
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden border border-slate-200">
            {/* Mobile Cards (< md) */}
            <div className="md:hidden divide-y divide-slate-200 bg-white">
              {filteredQuittances.map((quit) => {
                const apt = building.apartments.find((a) => a.id === quit.apartmentId);
                const res = building.residents.find((r) => r.id === quit.residentId);
                return (
                  <div
                    key={`quit-card-${quit.id}`}
                    className={`p-3.5 space-y-2.5 ${quit.voidedAt ? 'opacity-70 bg-rose-50/30' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded text-xs inline-block ${
                            quit.voidedAt
                              ? 'text-rose-700 bg-rose-50 line-through'
                              : 'text-teal-800 bg-teal-50'
                          }`}
                        >
                          {quit.quittanceNumber}
                        </span>
                        <div className="font-bold text-sm text-slate-900 truncate mt-1">
                          {quit.residentName}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {tr('Lot', 'شقة')} {quit.apartmentNumber} · {quit.periodCovered}
                        </div>
                      </div>
                      <div className="text-end shrink-0">
                        <div
                          className={`font-mono font-bold text-sm ${
                            quit.voidedAt ? 'text-rose-700 line-through' : 'text-teal-900'
                          }`}
                        >
                          {currencyFormatter.format(quit.amount)}
                        </div>
                        <span
                          className={`inline-block mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            quit.voidedAt
                              ? 'text-rose-700 bg-rose-50'
                              : 'text-emerald-700 bg-emerald-50'
                          }`}
                        >
                          {quit.voidedAt ? tr('Annulée', 'ملغى') : tr('Libératoire', 'مُبرئ للذمة')}
                        </span>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5 font-mono">
                      <span>{PAYMENT_METHOD_LABELS[quit.paymentMethod] || quit.paymentMethod}</span>
                      <span>
                        {new Date(quit.postingDate || quit.paymentDate).toLocaleDateString(
                          isAr ? 'ar-MA' : 'fr-MA'
                        )}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => setSelectedQuittanceForPreview(quit)}
                        className="min-h-[36px] px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100 rounded-lg border border-slate-200 font-semibold"
                      >
                        {tr('Aperçu', 'معاينة')}
                      </button>
                      <button
                        type="button"
                        onClick={() => generateQuittancePDF(quit, building, syndic, apt, res)}
                        className="min-h-[36px] px-3 py-1.5 text-xs bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-lg shadow-xs flex items-center gap-1"
                      >
                        <QuittanceIcon />
                        <span>{tr('Télécharger PDF', 'تحميل PDF')}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredQuittances.length === 0 && (
                <div className="px-4 py-10 text-center text-slate-500">
                  <p className="font-semibold text-sm text-slate-700">
                    {tr('Aucune quittance trouvée', 'لم يتم العثور على أي وصل')}
                  </p>
                  <Button
                    onClick={() => openQuittanceModalNew()}
                    className="mt-3 text-xs bg-teal-700 hover:bg-teal-800"
                  >
                    {tr('+ Émettre une Quittance', '+ إصدار وصل إبراء')}
                  </Button>
                </div>
              )}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
                <thead className="bg-slate-50 text-slate-600 text-start font-semibold">
                  <tr>
                    <th className="px-4 py-3 text-start">{tr('N° Quittance & Date', 'رقم الوصل والتاريخ')}</th>
                    <th className="px-4 py-3 text-start">{tr('Copropriétaire & CIN', 'المالك المشترك و ر.ب.و')}</th>
                    <th className="px-4 py-3 text-start">{tr('Lot & Tantièmes', 'الوحدة والحصة الشائعة')}</th>
                    <th className="px-4 py-3 text-start">{tr('Période Réglée', 'الفترة المؤداة')}</th>
                    <th className="px-4 py-3 text-start">{tr('Ventilation Loi 106-12', 'التوزيع (القانون 106-12)')}</th>
                    <th className="px-4 py-3 text-end">{tr('Montant Total', 'المبلغ الإجمالي')}</th>
                    <th className="px-4 py-3 text-start">{tr('Règlement & Traçabilité', 'الأداء والتتبع')}</th>
                    <th className="px-4 py-3 text-end">{tr('Actions', 'إجراءات')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredQuittances.map((quit) => {
                    const apt = building.apartments.find((a) => a.id === quit.apartmentId);
                    const res = building.residents.find((r) => r.id === quit.residentId);

                    return (
                      <tr
                        key={quit.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          quit.voidedAt ? 'opacity-70 bg-rose-50/30' : ''
                        }`}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`font-mono font-bold px-2 py-0.5 rounded text-xs block w-fit ${
                              quit.voidedAt
                                ? 'text-rose-700 bg-rose-50 line-through'
                                : 'text-teal-800 bg-teal-50'
                            }`}
                          >
                            {quit.quittanceNumber}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono mt-0.5 block">
                            {tr('Émise le', 'صادر في')} {new Date(quit.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900">{quit.residentName}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            CIN: {quit.residentCin || res?.cin || tr('Non renseigné', 'غير محدد')}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="font-semibold text-slate-800">
                            {tr('Lot', 'شقة')} {quit.apartmentNumber}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {quit.tantiemes || apt?.tantiemes || 0} / {buildingTantiemesBase}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800">{quit.periodCovered}</span>
                          <span className="text-[11px] text-slate-400 block font-mono">
                            {tr('Date bancaire', 'تاريخ البنك')}: {quit.bankTransactionDate || '—'} · {tr('Comptabilisation', 'تاريخ القيد')}: {new Date(quit.postingDate || quit.paymentDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[11px] space-y-0.5 font-mono">
                            <div className="text-slate-600">{tr('Courant:', 'الجاري:')} {formatRecordedFund(quit, 'chargesCourantesAmount')}</div>
                            <div className="text-emerald-700 font-medium">{tr('Réserve (106-12):', 'الاحتياط:')} {formatRecordedFund(quit, 'reserveFundAmount')}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-end whitespace-nowrap">
                          <span
                            className={`font-mono font-bold text-base block ${
                              quit.voidedAt ? 'text-rose-700 line-through' : 'text-teal-900'
                            }`}
                          >
                            {currencyFormatter.format(quit.amount)}
                          </span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.2 rounded ${quit.voidedAt ? 'text-rose-700 bg-rose-50' : 'text-emerald-700 bg-emerald-50'}`}>
                            {quit.voidedAt ? tr('Annulée', 'ملغى') : tr('Libératoire', 'مُبرئ للذمة')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-slate-700 font-medium">
                            {PAYMENT_METHOD_LABELS[quit.paymentMethod] || quit.paymentMethod}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono truncate max-w-[130px]" title={quit.referenceNumber || quit.bankName}>
                            {quit.bankName || tr('Banque', 'البنك')} {quit.referenceNumber ? `· ${quit.referenceNumber}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-end whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setSelectedQuittanceForPreview(quit)}
                              className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200 font-medium transition-colors"
                            >
                              {tr('Aperçu', 'معاينة')}
                            </button>
                            <button
                              onClick={() => generateQuittancePDF(quit, building, syndic, apt, res)}
                              className="px-2.5 py-1 text-xs bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded shadow-xs transition-colors flex items-center gap-1"
                            >
                              <QuittanceIcon />
                              <span>{tr('Télécharger PDF', 'تحميل PDF')}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredQuittances.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                        <QuittanceIcon />
                        <p className="font-semibold text-sm mt-2 text-slate-700">{tr('Aucune quittance trouvée', 'لم يتم العثور على أي وصل')}</p>
                        <p className="text-xs mt-1 text-slate-400">
                          {quittanceSearch
                            ? tr('Aucune quittance ne correspond à vos filtres de recherche.', 'لا يوجد وصل يطابق معايير البحث.')
                            : tr('Délivrez votre première quittance à partir d’un règlement enregistré.', 'أصدر أول وصل مرتبط بدفعة مسجلة.')}
                        </p>
                        <Button
                          onClick={() => openQuittanceModalNew()}
                          className="mt-3 text-xs bg-teal-700 hover:bg-teal-800"
                        >
                          {tr('+ Émettre une Quittance', '+ إصدار وصل إبراء')}
                        </Button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 5: RECOUVREMENT & IMPAYÉS */}
      {activeTab === 'impayes' && (
        <div className="space-y-4">
          <Card className="bg-rose-50 border border-rose-200 p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-rose-100 text-rose-700 rounded-lg shrink-0">
                <ShieldAlertIcon />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-rose-900 text-sm">
                  {tr(
                    'Procédure Légale de Recouvrement des Charges (Article 25 - Loi n° 18-00)',
                    'المسطرة القانونية لتحصيل المساهمات (المادة 25 - القانون رقم 18-00)'
                  )}
                </h4>
                <p className="text-xs text-rose-800 leading-relaxed">
                  {tr(
                    "En cas de non-paiement des charges de copropriété, le syndic est habilité à adresser une Mise en Demeure par lettre recommandée avec accusé de réception accordant un délai de 30 jours. À l'expiration de ce délai, le syndic peut demander au Président du Tribunal de Première Instance une Ordonnance d'Injonction de Payer avec exécution provisoire.",
                    'في حالة عدم أداء مساهمات الملكية المشتركة، يحق للسنديك توجيه إنذار بالأداء عبر رسالة مضمونة مع إشعار بالتوصل يمنح أجلاً مدته 30 يوماً. وبعد انصرام هذا الأجل، يمكن للسنديك تقديم طلب إلى رئيس المحكمة الابتدائية لإصدار أمر بالأداء مشمول بالنفاذ المعجل.'
                  )}
                </p>
              </div>
            </div>
          </Card>

          {/* Balance Âgée (Aging Report) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-3.5 border-s-4 border-s-amber-400 bg-white">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                {tr('Retard 0 – 30 jours', 'تأخر 0 – 30 يوماً')}
              </span>
              <span className="text-lg font-bold font-mono text-amber-800 mt-1 block tabular-nums">
                {currencyFormatter.format(agingBuckets.d0_30)}
              </span>
            </Card>
            <Card className="p-3.5 border-s-4 border-s-orange-500 bg-white">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                {tr('Retard 31 – 60 jours', 'تأخر 31 – 60 يوماً')}
              </span>
              <span className="text-lg font-bold font-mono text-orange-800 mt-1 block tabular-nums">
                {currencyFormatter.format(agingBuckets.d31_60)}
              </span>
            </Card>
            <Card className="p-3.5 border-s-4 border-s-rose-500 bg-white">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                {tr('Retard 61 – 90 jours', 'تأخر 61 – 90 يوماً')}
              </span>
              <span className="text-lg font-bold font-mono text-rose-700 mt-1 block tabular-nums">
                {currencyFormatter.format(agingBuckets.d61_90)}
              </span>
            </Card>
            <Card className="p-3.5 border-s-4 border-s-red-800 bg-white">
              <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                {tr('Contentieux > 90 jours', 'منازعات أكثر من 90 يوماً')}
              </span>
              <span className="text-lg font-bold font-mono text-red-900 mt-1 block tabular-nums">
                {currencyFormatter.format(agingBuckets.d90_plus)}
              </span>
            </Card>
          </div>

          <Card className="overflow-hidden border border-slate-200">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-slate-800 text-sm">{tr('Copropriétaires Débiteurs', 'الملاك المشتركون المتأخرون عن الأداء')}</h3>
                <p className="text-xs text-slate-500">{tr('Générez la mise en demeure formelle ou le relevé de compte en 1 clic', 'إصدار الإنذار الرسمي أو كشف الحساب بنقرة واحدة')}</p>
              </div>
              <span className="text-xs font-mono font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded">
                {tr('Total créances :', 'مجموع الديون:')} {currencyFormatter.format(stats.overdueChargesTotal)}
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {overdueResidents.map((item) => {
                const resident = building.residents.find((r) => r.id === item.residentId);
                const residentApartments =
                  item.apartments.length > 0
                    ? item.apartments
                    : building.apartments.filter(
                        (a) =>
                          a.ownerId === item.residentId ||
                          a.tenantId === item.residentId ||
                          a.id === resident?.apartmentId
                      );

                return (
                  <div
                    key={item.residentId}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{item.residentName}</span>
                        <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                          {item.apartments.length > 1 ? tr('Lots', 'شقق') : tr('Lot', 'شقة')} {item.apartmentNumber}
                        </span>
                        <span className="text-xs text-rose-700 font-semibold bg-rose-50 px-2 py-0.5 rounded">
                          {item.overdueCount} {tr('échéance(s) impayée(s)', 'دفعات غير مؤداة')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        {tr('Ancienneté de la dette depuis le', 'تاريخ أقدم دين منذ')}{' '}
                        {new Date(item.oldestDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')} ·{' '}
                        {tr('Tél :', 'الهاتف:')} {resident?.phone || tr('Non renseigné', 'غير متوفر')}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      <div className="text-end me-1">
                        <span className="text-xs text-slate-400 block">{tr('Total Dû', 'المبلغ المستحق')}</span>
                        <span className="font-mono font-bold text-base text-rose-700">
                          {currencyFormatter.format(item.totalOverdue)}
                        </span>
                      </div>

                      {resident && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            exportResidentStatementPDF(
                              building,
                              syndic,
                              resident,
                              residentApartments,
                              charges,
                              quittances
                            )
                          }
                          className="text-xs flex items-center gap-1"
                        >
                          <DocumentsIcon />
                          <span>{tr('Relevé PDF', 'كشف PDF')}</span>
                        </Button>
                      )}

                      <Button
                        onClick={() => {
                          if (resident && residentApartments.length > 0) {
                            exportMiseEnDemeurePDF(
                              building,
                              syndic,
                              resident,
                              residentApartments,
                              item.charges
                            );
                          } else {
                            showToast(tr('Informations du copropriétaire incomplètes.', 'بيانات المالك المشترك غير مكتملة.'), 'error');
                          }
                        }}
                        className="text-xs bg-rose-700 hover:bg-rose-800 flex items-center gap-1.5"
                      >
                        <ShieldAlertIcon />
                        <span>{tr('Mise en Demeure (Art. 25)', 'إنذار بالأداء (المادة 25)')}</span>
                      </Button>
                    </div>
                  </div>
                );
              })}

              {overdueResidents.length === 0 && (
                <div className="p-8 text-center text-slate-500 text-xs">
                  {tr(
                    'Aucun impayé constaté. Tous les copropriétaires sont à jour dans leurs cotisations.',
                    'لا توجد أي متأخرات. جميع الملاك المشتركين في وضعية سليمة.'
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* MODAL 1: ADD TRANSACTION */}
      <Modal
        isOpen={isTrxModalOpen}
        onSubmit={handleSubmitTransaction}
        busy={addTrxMutation.isPending}
        onClose={() => {
          setIsTrxModalOpen(false);
          resetTrxForm();
        }}
        title={tr('Nouvelle Opération Financière (Loi 18-00 & 106-12)', 'عملية مالية جديدة (القانون 18-00 و 106-12)')}
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              {tr("* Pièce justificative requise selon l'Art. 26 de la Loi 18-00", '* الوثيقة المثبتة مطلوبة وفق المادة 26 من القانون 18-00')}
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
                {addTrxMutation.isPending ? tr('Enregistrement...', 'جاري الحفظ...') : tr('Valider & Enregistrer', 'تأكيد وحفظ')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto px-1">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {tr("1. Nature de l'opération", '1. طبيعة العملية')}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTrxType('expense');
                    setTrxCategory('maintenance');
                    setTrxDocumentType('facture');
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border flex items-center justify-center gap-1.5 ${
                    trxType === 'expense'
                      ? 'bg-rose-50 border-rose-400 text-rose-800 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-rose-600"></span>
                  <span>{tr('Dépense / Décaissement (-)', 'مصروف / صرف (-)')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTrxType('income');
                    setTrxCategory('fees');
                    setTrxDocumentType('recu');
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold transition-all border flex items-center justify-center gap-1.5 ${
                    trxType === 'income'
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-800 shadow-sm'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                  <span>{tr('Recette / Encaissement (+)', 'مدخول / تحصيل (+)')}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                {tr('2. Affectation légale des fonds (Loi 18-00 & 106-12)', '2. التخصيص القانوني للصندوق (القانون 18-00 و 106-12)')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label
                  className={`p-2.5 rounded-lg border cursor-pointer text-xs transition-all flex items-start gap-2 ${
                    fundType === 'courant'
                      ? 'bg-teal-50 border-teal-400 text-teal-900 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="fundType"
                    value="courant"
                    checked={fundType === 'courant'}
                    onChange={() => setFundType('courant')}
                    className="mt-0.5 text-teal-600 focus:ring-teal-500"
                  />
                  <div>
                    <span className="font-bold block">{tr('Compte Courant', 'الحساب الجاري')}</span>
                    <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">
                      {tr('Dépenses ordinaires, gardiennage, électricité, menues réparations', 'المصاريف العادية، الحراسة، الكهرباء، الإصلاحات البسيطة')}
                    </span>
                  </div>
                </label>

                <label
                  className={`p-2.5 rounded-lg border cursor-pointer text-xs transition-all flex items-start gap-2 ${
                    fundType === 'reserve'
                      ? 'bg-indigo-50 border-indigo-400 text-indigo-900 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="fundType"
                    value="reserve"
                    checked={fundType === 'reserve'}
                    onChange={() => {
                      setFundType('reserve');
                      setTrxCategory('reserve');
                    }}
                    className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="font-bold block flex items-center gap-1">
                      <span>{tr('Fonds de Réserve', 'صندوق الاحتياط')}</span>
                      <span className="bg-indigo-200 text-indigo-800 text-[9px] px-1 rounded font-mono">
                        {tr('Loi 106-12', 'قانون 106-12')}
                      </span>
                    </span>
                    <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">
                      {tr('Gros travaux, étanchéité terrasse, réfection façade ou ascenseur', 'الأشغال الكبرى، عزل السطح، ترميم الواجهة أو المصعد')}
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Montant net (MAD) *', 'المبلغ الصافي (درهم) *')}
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
                  className={`w-full px-3 py-2 border rounded-lg text-sm font-mono font-bold pe-12 ${
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
                {tr('Date comptable *', 'التاريخ المحاسبي *')}
              </label>
              <input
                type="date"
                value={trxDate}
                onChange={(e) => setTrxDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Catégorie comptable *', 'الفئة المحاسبية *')}
              </label>
              <select
                value={trxCategory}
                onChange={(e) => setTrxCategory(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              >
                {trxType === 'expense' ? (
                  <>
                    <option value="maintenance">{tr('Maintenance courante & Dépannages', 'الصيانة الجارية والإصلاحات')}</option>
                    <option value="elevator">{tr('Ascenseur & Équipements mécaniques', 'المصعد والتجهيزات الميكانيكية')}</option>
                    <option value="salary">{tr('Salaires Concierge / Gardiennage', 'رواتب البواب / الحراسة')}</option>
                    <option value="utility">{tr('Électricité & Eau (Lydec/Redal/Amendis)', 'الكهرباء والماء')}</option>
                    <option value="cleaning">{tr('Nettoyage, Produits & Hygiène', 'النظافة ومواد التنظيف')}</option>
                    <option value="insurance">{tr('Assurance Multirisque Immeuble', 'تأمين العمارة المتعدد المخاطر')}</option>
                    <option value="bank_fees">{tr('Frais bancaires & Tenue de compte', 'المصاريف البنكية')}</option>
                    <option value="legal">{tr('Honoraires contentieux & Recouvrement', 'أتعاب المنازعات والتحصيل')}</option>
                    <option value="reserve">{tr('Gros travaux (Fonds de réserve)', 'الأشغال الكبرى (صندوق الاحتياط)')}</option>
                    <option value="other">{tr('Autre charge diverse', 'مصاريف أخرى')}</option>
                  </>
                ) : (
                  <>
                    <option value="fees">{tr('Cotisations ordinaires de copropriété', 'مساهمات الملكية المشتركة العادية')}</option>
                    <option value="reserve">{tr('Appel de fonds exceptionnel / Réserve travaux', 'طلب مساهمة استثنائي / احتياط الأشغال')}</option>
                    <option value="reimbursement">{tr('Remboursement sinistre assurance', 'تعويض تأمين')}</option>
                    <option value="other">{tr('Autre encaissement', 'مدخول آخر')}</option>
                  </>
                )}
              </select>
            </div>
          </div>

          <div className="p-3 bg-slate-50/75 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800">
                {tr(
                  `3. Tiers concerné (${trxType === 'expense' ? 'Bénéficiaire / Prestataire' : 'Copropriétaire émetteur'})`,
                  `3. الطرف المعني (${trxType === 'expense' ? 'المستفيد / المهني' : 'المالك المشترك الدافع'})`
                )}
              </label>
              {trxType === 'expense' && (
                <span className="text-[10px] text-slate-500 font-mono">
                  {tr('Obligation fiscale marocaine : ICE exigé', 'إلزام ضريبي مغربي: رقم ICE مطلوب')}
                </span>
              )}
            </div>

            {trxType === 'expense' ? (
              <div className="space-y-2.5">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    {tr("Sélectionner un prestataire enregistré de l'immeuble :", 'اختر مهنياً مسجلاً في الإقامة:')}
                  </label>
                  <select
                    value={selectedPrestataireId}
                    onChange={(e) => handleSelectPrestataire(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">{tr('-- Autre / Nouveau prestataire --', '-- آخر / مهني جديد --')}</option>
                    {prestataires.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.ice ? `(ICE: ${p.ice})` : ''} - {p.category}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
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

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {tr('ICE Prestataire (15 chiffres)', 'رقم التعريف الموحد للمقاولة ICE (15 رقماً)')}
                    </label>
                    <input
                      type="text"
                      maxLength={15}
                      value={trxThirdPartyIce}
                      onChange={(e) => setTrxThirdPartyIce(e.target.value)}
                      placeholder="Ex: 001988223000089"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      {tr('Lot de copropriété concerné :', 'الوحدة السكنية المعنية:')}
                    </label>
                    <select
                      value={selectedApartmentId}
                      onChange={(e) => handleSelectApartment(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      <option value="">{tr('-- Aucun lot spécifique (Recette générale) --', '-- بدون شقة محددة (مدخول عام) --')}</option>
                      {building.apartments.map((apt) => {
                        const res = building.residents.find((r) => r.id === (apt.ownerId || apt.tenantId));
                        return (
                          <option key={apt.id} value={apt.id}>
                            {tr('Lot', 'شقة')} {apt.number} ({res?.name || tr('Copropriétaire', 'مالك مشترك')}) - {apt.tantiemes || 100} {tr('tantièmes', 'جزء')}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {tr('Nom du copropriétaire / émetteur :', 'اسم المالك المشترك / الدافع:')}
                    </label>
                    <input
                      type="text"
                      value={trxThirdPartyName}
                      onChange={(e) => setTrxThirdPartyName(e.target.value)}
                      placeholder="Ex: Ahmed Alami"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-3 bg-amber-50/50 border border-amber-200/80 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-amber-900">
                {tr('4. Pièce justificative comptable (Obligation Art. 26 Loi 18-00)', '4. الوثيقة المحاسبية المثبتة (إلزام المادة 26 من القانون 18-00)')}
              </label>
              <span className="text-[10px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded font-medium">
                {tr('Traçabilité audit', 'تتبع التدقيق')}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {tr('Type de pièce justificative *', 'نوع الوثيقة المثبتة *')}
                </label>
                <select
                  value={trxDocumentType}
                  onChange={(e) => setTrxDocumentType(e.target.value as any)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="facture">{tr('Facture Fournisseur / Prestataire', 'فاتورة المورد / المهني')}</option>
                  <option value="quittance">{tr('Quittance officielle', 'وصل أداء رسمي')}</option>
                  <option value="recu">{tr('Reçu / Décharge signée', 'إيصال / إبراء موقع')}</option>
                  <option value="releve">{tr("Avis d'opéré / Relevé bancaire", 'إشعار بالعملية / كشف بنكي')}</option>
                  <option value="devis">{tr('Devis approuvé en AG', 'عرض سعر مصادق عليه في الجمع العام')}</option>
                  <option value="autre">{tr('Autre document comptable', 'وثيقة محاسبية أخرى')}</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {tr('N° de Pièce / Facture *', 'رقم الوثيقة / الفاتورة *')}
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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {tr('Mode de règlement *', 'طريقة الأداء *')}
                </label>
                <select
                  value={trxPaymentMethod}
                  onChange={(e) => setTrxPaymentMethod(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="virement">{tr('Virement bancaire', 'تحويل بنكي')}</option>
                  <option value="cheque">{tr('Chèque bancaire', 'شيك بنكي')}</option>
                  <option value="versement">{tr('Versement espèces à la banque', 'إيداع نقدي بالبنك')}</option>
                  <option value="especes">{tr('Espèces (Menues dépenses)', 'نقداً (مصاريف بسيطة)')}</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {tr('N° Chèque / Réf Virement', 'رقم الشيك / مرجع التحويل')}
                </label>
                <input
                  type="text"
                  value={trxReference}
                  onChange={(e) => setTrxReference(e.target.value)}
                  placeholder="Ex: CHQ 894120"
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  {tr("Banque de l'opération", 'بنك العملية')}
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
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr("5. Libellé de l'écriture comptable *", '5. بيان القيد المحاسبي *')}
            </label>
            <input
              type="text"
              value={trxDesc}
              onChange={(e) => {
                setTrxDesc(e.target.value);
                if (formErrors.description) setFormErrors({ ...formErrors, description: '' });
              }}
              placeholder={tr("Ex: Réparation pompe surpresseur d'eau selon devis voté en AG", 'مثال: إصلاح مضخة المياه حسب عرض السعر المصادق عليه')}
              className={`w-full px-3 py-2 border rounded-lg text-xs ${
                formErrors.description ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
              }`}
            />
            {formErrors.description && (
              <p className="text-[10px] text-rose-600 mt-0.5">{formErrors.description}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr("6. Notes & Référence de Résolution d'AG (Optionnel)", '6. ملاحظات ومرجع قرار الجمع العام (اختياري)')}
            </label>
            <input
              type="text"
              value={trxNotes}
              onChange={(e) => setTrxNotes(e.target.value)}
              placeholder={tr("Ex: Résolution N° 3 votée lors de l'Assemblée Générale Ordinaire", 'مثال: القرار رقم 3 المصوت عليه في الجمع العام العادي')}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
            />
          </div>

          {(() => {
            const currentBal = fundType === 'reserve' ? stats.reserveFund : stats.balance;
            const numericAmt = parseFloat(trxAmount) || 0;
            const projBal = trxType === 'income' ? currentBal + numericAmt : currentBal - numericAmt;
            const isOverdraft = trxType === 'expense' && numericAmt > 0 && Math.round(projBal * 100) < 0;
            return (
              <div className="space-y-3">
                <div className={`p-3 border rounded-xl space-y-1.5 text-xs ${isOverdraft ? 'bg-rose-50/80 border-rose-300' : 'bg-teal-50/70 border-teal-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`font-semibold ${isOverdraft ? 'text-rose-900' : 'text-teal-900'}`}>
                      {tr(
                        `Impact prévisionnel sur le ${fundType === 'reserve' ? 'Fonds de Réserve' : 'Compte Courant'} :`,
                        `الأثر المتوقع على ${fundType === 'reserve' ? 'صندوق الاحتياط' : 'الحساب الجاري'}:`
                      )}
                    </span>
                    <span className="font-mono font-bold text-slate-800">
                      {tr('Solde actuel :', 'الرصيد الحالي:')} {currencyFormatter.format(currentBal)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-teal-200/60 font-mono">
                    <span className={trxType === 'income' ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
                      {tr('Opération :', 'العملية:')} {trxType === 'income' ? '+' : '-'}
                      {currencyFormatter.format(numericAmt)}
                    </span>
                    <span className={`font-bold text-sm ${isOverdraft ? 'text-rose-800' : 'text-teal-900'}`}>
                      {tr('Nouveau solde prévu :', 'الرصيد الجديد المتوقع:')} {currencyFormatter.format(projBal)}
                    </span>
                  </div>
                </div>

                {isOverdraft && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-1.5">
                    <label className="block text-xs font-bold text-amber-950">
                      {tr(
                        'Dérogation requise : le montant dépasse le solde du fonds sélectionné *',
                        'ترخيص استثنائي مطلوب: المبلغ يتجاوز رصيد الصندوق المحدد *'
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
                        'Ex: Avance urgente syndic validée par le conseil syndical',
                        'مثال: تسبيق استعجالي للسنديك مصادق عليه'
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
          title={tr("Fiche d'Écriture Comptable (Loi 18-00)", 'بطاقة القيد المحاسبي (القانون 18-00)')}
          footer={
            <div className="flex justify-between items-center w-full gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={() => generateTransactionVoucherPDF(selectedTrxForView, building, syndic)}
                  className="text-xs bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
                >
                  <DocumentsIcon />
                  <span>{tr('Télécharger Pièce Comptable PDF', 'تحميل الوثيقة المحاسبية PDF')}</span>
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
                      {tr('Contrepasser dépense', 'عكس المصروف')}
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
                  {tr('Identifiant écriture :', 'معرف القيد:')} {selectedTrxForView.id}
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
                <p className="text-[11px] font-semibold text-slate-400 uppercase">{tr('Affectation & Catégorie', 'التخصيص والفئة')}</p>
                <p className="font-medium text-slate-800">
                  {tr('Fonds :', 'الصندوق:')}{' '}
                  <strong className="text-slate-900">
                    {selectedTrxForView.fundType === 'reserve'
                      ? tr('Fonds de Réserve (Loi 106-12)', 'صندوق الاحتياط (106-12)')
                      : tr('Compte Courant', 'الحساب الجاري')}
                  </strong>
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
                <p className="text-[11px] font-semibold text-slate-400 uppercase">{tr('Justificatif & Règlement', 'الإثبات والأداء')}</p>
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
                  <span className="text-[11px] text-slate-500 block">{tr('Tiers concerné :', 'الطرف المعني:')}</span>
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
                  {tr("Observations & Résolution d'AG :", 'ملاحظات وقرار الجمع العام:')}
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
        title={tr('Lancer un Appel de Fonds Général (Loi 18-00)', 'إصدار طلب مساهمات عام (القانون 18-00)')}
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
              'Les lots liés à un résident sont facturés une seule fois par période. Les avis déjà émis conservent leur montant.',
              'تصدر المساهمات للشقق المرتبطة بساكن مرة واحدة لكل فترة. لا تتغير مبالغ الإشعارات الصادرة سابقاً.'
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
                <span className="text-xs font-bold text-teal-900 block">
                  {tr('Répartir un budget global selon les tantièmes', 'توزيع ميزانية إجمالية حسب الحصص الشائعة')}
                </span>
                <span className="text-[11px] text-teal-700 block">
                  {tr(
                    'Optionnel : remplace les cotisations configurées par une répartition du budget. Les montants peuvent différer entre lots.',
                    'اختياري: يستبدل المساهمات المحددة بتوزيع الميزانية وقد تختلف المبالغ بين الشقق.'
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

      {/* MODAL 3: MOROCCAN QUITTANCE GENERATOR */}
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
                  if (!quittancePaymentDate || Number.isNaN(Date.parse(quittancePaymentDate))) throw new Error(tr('Indiquez une date de paiement valide.', 'أدخل تاريخ أداء صالحاً.'));
                  if (quittanceBankTransactionDate && Number.isNaN(Date.parse(quittanceBankTransactionDate))) {
                    throw new Error(tr('Indiquez une date bancaire valide.', 'أدخل تاريخاً بنكياً صالحاً.'));
                  }
                  if (quittancePostingDate && Number.isNaN(Date.parse(quittancePostingDate))) {
                    throw new Error(tr('Indiquez une date de comptabilisation valide.', 'أدخل تاريخ قيد صالحاً.'));
                  }
                  const { reserveFundAmount: reserveAmt, chargesCourantesAmount: courantesAmt } =
                    splitChargeReserveAndOperating(numAmt, quittanceReserveRatio);

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
                }}
        onClose={() => setIsQuittanceModalOpen(false)}
        title={tr('Générateur de Quittance Libératoire (Loi n° 18-00 & 106-12)', 'مُصدر وصل الأداء المبرئ للذمة (القانون 18-00 و 106-12)')}
        footer={
          <div className="flex justify-between items-center w-full">
            <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
              {tr("Reçu traçable à partir du règlement enregistré", 'وصل مرتبط بالدفعة المسجلة')}
            </span>
            <div className="flex items-center gap-2">
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
                    ? tr('Émission en cours...', 'جاري الإصدار...')
                    : tr('Délivrer & Télécharger PDF', 'إصدار وتحميل PDF')}
                </span>
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pe-1">
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg flex items-start gap-2.5">
            <div className="p-1.5 bg-teal-600 text-white rounded shrink-0 mt-0.5">
              <QuittanceIcon />
            </div>
            <div className="text-xs text-teal-900 leading-relaxed">
              <span className="font-bold block">
                {tr('Conformité Loi 18-00 & 106-12 (Article 18 bis) :', 'المطابقة للقانون 18-00 و 106-12 (المادة 18 مكرر):')}
              </span>
              {tr(
                'Cette quittance officielle libère définitivement le copropriétaire pour la période indiquée. Le calcul intègre automatiquement la répartition obligatoire entre les charges courantes et le Fonds de Réserve pour travaux.',
                'يُبرئ هذا الوصل الرسمي ذمة المالك المشترك بصفة نهائية عن الفترة المحددة، ويدمج تلقائياً التوزيع الإلزامي بين التكاليف الجارية وصندوق الاحتياط للأشغال.'
              )}
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <span>{tr('1. Lot & Copropriétaire Redevable', '1. الوحدة والمالك المشترك')}</span>
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
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900"
                >
                  <option value="">{tr('Sélectionnez un lot...', 'اختر شقة...')}</option>
                  {building.apartments.map((a) => {
                    const res = building.residents.find(
                      (r) => r.id === a.ownerId || r.id === a.tenantId || r.apartmentId === a.id
                    );
                    return (
                      <option key={a.id} value={a.id}>
                        {tr('Lot', 'شقة')} {a.number} — {res?.name || tr('Copropriétaire', 'مالك مشترك')} ({a.tantiemes || 0}/{buildingTantiemesBase})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Nom du Copropriétaire', 'اسم المالك المشترك')}
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
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900"
                >
                  {building.residents.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} {r.cin ? `(CIN: ${r.cin})` : ''} {r.isOwner ? `— ${tr('Copropriétaire', 'مالك')}` : `— ${tr('Locataire', 'مكتري')}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-200/80 text-[11px] font-mono">
              <div className="text-slate-600">
                <span>CIN / ID : </span>
                <input
                  type="text"
                  value={quittanceResidentCin}
                  onChange={(e) => setQuittanceResidentCin(e.target.value)}
                  placeholder="CIN"
                  className="px-1.5 py-0.5 border border-slate-300 rounded w-24 text-xs font-bold text-slate-800"
                />
              </div>
              <div className="text-slate-600">
                <span>{tr('Tantièmes :', 'الأجزاء:')} </span>
                <strong className="text-teal-800">
                  {building.apartments.find((a) => a.id === quittanceApartmentId)?.tantiemes || 0} / {buildingTantiemesBase}
                </strong>
              </div>
              <div className="text-slate-600">
                <span>{tr('Résidence :', 'الإقامة:')} </span>
                <strong className="text-slate-800">{building.name}</strong>
              </div>
            </div>
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
              <span>{tr('2. Période & Ventilation Financière', '2. الفترة والتوزيع المالي')}</span>
              <span className="text-[10px] text-teal-700 font-semibold bg-teal-100/60 px-2 py-0.5 rounded">
                {tr('Loi 106-12 Art. 18 bis', 'القانون 106-12 المادة 18 مكرر')}
              </span>
            </h4>

            <div>
              <label htmlFor="quittance-charge" className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Charge à régler', 'المساهمة المستحقة')}
              </label>
              <select id="quittance-charge" value={quittanceChargeId} onChange={event => setQuittanceChargeId(event.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white">
                <option value="">{tr('Sélectionnez une charge...', 'اختر مساهمة...')}</option>
                {receiptCharges.map(charge => <option key={charge.id} value={charge.id}>
                  {charge.period} — {currencyFormatter.format(Math.max(0, charge.amount - (charge.paidAmount ?? 0)))}
                </option>)}
              </select>
              <p className="text-xs text-slate-600 mt-1">{tr('Tout nouveau reçu confirme un paiement enregistré.', 'كل وصل جديد يؤكد دفعة مسجلة.')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Période Couverte', 'الفترة المشمولة')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={quittancePeriod}
                  readOnly
                  placeholder={tr('Ex: Octobre 2026', 'مثال: أكتوبر 2026')}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white"
                />
              </div>

              <div>
                <label htmlFor="quittance-amount" className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Montant Total Encaissé (MAD)', 'المبلغ الإجمالي المحصل (درهم)')} <span className="text-rose-500">*</span>
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
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono font-bold text-teal-900 bg-white"
                />
              </div>
            </div>

            {parseFloat(quittanceAmount) > 0 && (
              <div className="p-3 bg-white border border-teal-200 rounded-lg space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-700">{tr('Ventilation des Charges :', 'توزيع المساهمة:')}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">{tr('Quote-part Fonds Réserve :', 'حصة صندوق الاحتياط:')}</span>
                    <span className="px-2 py-0.5 text-[10px] rounded font-bold bg-teal-700 text-white">
                      {quittanceReserveRatio}% {tr('(Configuré)', '(معتمد)')}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs font-mono">
                  <div className="bg-slate-50 p-2 rounded">
                    <span className="text-[11px] text-slate-500 block">
                      {tr(`Charges courantes (${100 - quittanceReserveRatio}%) :`, `التكاليف الجارية (${100 - quittanceReserveRatio}%):`)}
                    </span>
                    <span className="font-bold text-slate-800">
                      {currencyFormatter.format(
                        splitChargeReserveAndOperating(
                          parseFloat(quittanceAmount),
                          quittanceReserveRatio
                        ).chargesCourantesAmount
                      )}
                    </span>
                  </div>
                  <div className="bg-emerald-50 p-2 rounded border border-emerald-100">
                    <span className="text-[11px] text-emerald-800 block">
                      {tr(`Fonds de Réserve Travaux (${quittanceReserveRatio}%) :`, `صندوق احتياط الأشغال (${quittanceReserveRatio}%):`)}
                    </span>
                    <span className="font-bold text-emerald-900">
                      {currencyFormatter.format(
                        splitChargeReserveAndOperating(
                          parseFloat(quittanceAmount),
                          quittanceReserveRatio
                        ).reserveFundAmount
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              {tr('3. Modalités & Traçabilité du Règlement', '3. طرق وتتبع الأداء')}
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Mode de Paiement', 'طريقة الدفع')}
                </label>
                <select
                  value={quittancePaymentMethod}
                  onChange={(e) => setQuittancePaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900"
                >
                  <option value="virement">{tr('Virement bancaire', 'تحويل بنكي')}</option>
                  <option value="cheque">{tr('Chèque bancaire', 'شيك بنكي')}</option>
                  <option value="versement">{tr('Versement agence / GAB', 'إيداع بنكي')}</option>
                  <option value="especes">{tr('Espèces (Reçu caisse)', 'نقداً (وصل صندوق)')}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Établissement Bancaire', 'المؤسسة البنكية')}
                </label>
                <select
                  value={quittanceBankName}
                  onChange={(e) => setQuittanceBankName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900"
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
                  {tr('Réf. Virement / N° Chèque', 'مرجع التحويل / رقم الشيك')}
                </label>
                <input
                  type="text"
                  value={quittanceReference}
                  onChange={(e) => setQuittanceReference(e.target.value)}
                  placeholder="Ex: VIR-84920"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr("Date Effective d'Encaissement", 'التاريخ الفعلي للتحصيل')}
                </label>
                <input
                  type="date"
                  value={quittancePaymentDate}
                  onChange={(e) => setQuittancePaymentDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Observations & Mentions', 'ملاحظات وبيانات')}
                </label>
                <input
                  type="text"
                  value={quittanceRemarks}
                  onChange={(e) => setQuittanceRemarks(e.target.value)}
                  placeholder={tr("Mention particulière ou accord d'AG", 'ملاحظة خاصة أو قرار جمع عام')}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Date opération bancaire', 'تاريخ العملية البنكية')}
                </label>
                <input
                  type="date"
                  value={quittanceBankTransactionDate}
                  onChange={(e) => setQuittanceBankTransactionDate(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white font-mono"
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
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white font-mono"
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
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white"
                />
              </div>
            </div>
          </div>
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

      {rejectingProofId && (
        <Modal
          isOpen={!!rejectingProofId}
          onClose={() => {
            setRejectingProofId(null);
            setRejectReason('');
          }}
          title={tr('Motif du rejet du justificatif', 'سبب رفض إثبات التحويل')}
          maxWidthClass="max-w-md"
          onSubmit={async (e) => {
            e.preventDefault();
            await reviewProofMutation.mutateAsync({
              proofId: rejectingProofId,
              decision: 'reject',
              reason: rejectReason.trim(),
            });
            setRejectingProofId(null);
            setRejectReason('');
          }}
          busy={reviewProofMutation.isPending}
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Motif du rejet :', 'سبب الرفض:')}
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 outline-none"
                required
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRejectingProofId(null);
                  setRejectReason('');
                }}
              >
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                type="submit"
                disabled={!rejectReason.trim() || reviewProofMutation.isPending}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {tr('Confirmer le rejet', 'تأكيد الرفض')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODAL 5: INTERNAL FUND TRANSFER */}
      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title={tr('Virement Interne entre Fonds (Compte Courant ↔ Réserve)', 'تحويل داخلي بين الصناديق (الحساب الجاري ↔ الاحتياط)')}
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
                  {tr('Compte Courant', 'الحساب الجاري')} ({currencyFormatter.format(stats.balance)})
                </option>
                <option value="reserve">
                  {tr('Fonds de Réserve (106-12)', 'صندوق الاحتياط (106-12)')} ({currencyFormatter.format(stats.reserveFund)})
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
                <option value="reserve">{tr('Fonds de Réserve (106-12)', 'صندوق الاحتياط (106-12)')}</option>
                <option value="courant">{tr('Compte Courant', 'الحساب الجاري')}</option>
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
                {tr('Date comptable', 'التاريخ المحاسبي')}
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
              {tr('Motif / Référence résolution AG', 'السبب / مرجع قرار الجمع العام')}
            </label>
            <input
              type="text"
              maxLength={1000}
              value={transferReason}
              onChange={(e) => setTransferReason(e.target.value)}
              placeholder={tr('Ex: Affectation dotation annuelle au fonds de réserve (AG 2026)', 'مثال: تخصيص المخصص السنوي لصندوق الاحتياط')}
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
          title={tr("Contrepassation d'une dépense", 'عكس مصروف مسجل')}
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

