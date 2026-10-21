import FinancialTools from './FinancialTools';
import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Transaction, Charge, Syndic, Quittance, PaymentMethod } from '../../types';
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
  getPaymentProofsForBuilding,
  reviewPaymentProof,
  approvePaymentProofsBatch,
  reconcileBankStatementCSV,
  getQuittancesForBuilding,
  createQuittance,
  generateQuittanceForCharge,
  addTransaction,
  generateMonthlyCharges,
  getPrestatairesForBuilding,
} from '../../firebase/services';
import {
  generateInvoicePDF,
  generateQuittancePDF,
  generateMiseEnDemeurePDF,
  generateTransactionVoucherPDF,
  exportAnnualRepartitionPDF,
} from '../../services/pdfService';
import {
  computeBuildingFundBalances,
  splitChargeReserveAndOperating,
} from '../../utils/security';
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
  'Banque Populaire (BCP)',
  'Bank of Africa (BMCE)',
  'CIH Bank',
  'Société Générale Maroc',
  'Crédit du Maroc',
  'Al Barid Bank',
  'CFG Bank',
  'Autre / Trésorerie Caisse',
];

const FinancialsView: React.FC<FinancialsProps> = ({ building, syndic }) => {
  const { tr, isAr } = useI18n();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('transactions');
  const [isTrxModalOpen, setIsTrxModalOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [selectedTrxForView, setSelectedTrxForView] = useState<Transaction | null>(null);

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
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Charge Generation Form State
  const [useTantiemes, setUseTantiemes] = useState(true);
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
    building?.reserveFundPercentage ?? building?.reserveFundRate ?? 5
  );
  const [quittancePaymentMethod, setQuittancePaymentMethod] = useState<PaymentMethod>('virement');
  const [quittanceBankName, setQuittanceBankName] = useState(building.bankName || '');
  const [quittanceReference, setQuittanceReference] = useState('');
  const [quittancePaymentDate, setQuittancePaymentDate] = useState(new Date().toISOString().split('T')[0]);
  const [quittanceRemarks, setQuittanceRemarks] = useState('');
  const [quittanceAddLedgerTrx, setQuittanceAddLedgerTrx] = useState(true);
  const [quittanceSearch, setQuittanceSearch] = useState('');
  const [quittanceFilterMethod, setQuittanceFilterMethod] = useState('all');
  const [directGeneratingChargeId, setDirectGeneratingChargeId] = useState<string | null>(null);

  // Queries
  const { data: charges = [], isLoading: loadingCharges } = useQuery({
    queryKey: ['charges', building.id],
    queryFn: () => getChargesForBuilding(building.id),
  });

  const { data: paymentProofs = [], isLoading: loadingProofs } = useQuery({
    queryKey: ['proofs', building.id],
    queryFn: () => getPaymentProofsForBuilding(building.id),
  });

  const { data: quittances = [], isLoading: loadingQuittances } = useQuery({
    queryKey: ['quittances', building.id],
    queryFn: () => getQuittancesForBuilding(building.id),
  });

  const { data: prestataires = [] } = useQuery({
    queryKey: ['prestataires', building.id],
    queryFn: () => getPrestatairesForBuilding(building.id),
  });

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
    setFormErrors({});
  };

  // Mutations
  const addTrxMutation = useMutation({
    mutationFn: (data: Omit<Transaction, 'id'>) => addTransaction(building.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setIsTrxModalOpen(false);
      resetTrxForm();
    },
  });

  const reviewProofMutation = useMutation({
    mutationFn: (data: { proofId: string; decision: 'approve' | 'reject'; reason?: string }) =>
      reviewPaymentProof(data.proofId, data.decision, data.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const generateChargesMutation = useMutation({
    mutationFn: () =>
      generateMonthlyCharges(building.id, building.syndicId, periodName, {
        useTantiemes,
        totalMonthlyBudget: parseFloat(totalBudgetInput) || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setIsGenerateModalOpen(false);
      showToast(
        tr('Appel de fonds généré avec succès.', 'تم إصدار طلب المساهمات بنجاح.'),
        'success'
      );
    },
  });

  // Open Quittance Modal for a specific charge
  const openQuittanceModalForCharge = (charge: Charge) => {
    const res = building.residents.find((r) => r.id === charge.residentId);

    setQuittancePaymentId(crypto.randomUUID());
    setQuittanceChargeId(charge.id);
    setQuittanceApartmentId(charge.apartmentId);
    setQuittanceResidentId(charge.residentId);
    setQuittanceResidentCin(res?.cin || 'AB123456');
    setQuittancePeriod(charge.period || 'Octobre 2026');
    setQuittanceAmount(String(charge.status === 'paid' ? (charge.paidAmount ?? charge.amount) : Math.max(0, charge.amount - (charge.paidAmount ?? 0))));
    setQuittanceReserveRatio(building?.reserveFundPercentage ?? building?.reserveFundRate ?? 5);
    setQuittancePaymentMethod((charge.paymentMethod as PaymentMethod) || 'virement');
    setQuittanceBankName(building.bankName || '');
    setQuittanceReference(`VIR-${charge.id.slice(-6).toUpperCase()}`);
    setQuittancePaymentDate(
      charge.paidAt ? charge.paidAt.split('T')[0] : new Date().toISOString().split('T')[0]
    );
    setQuittanceRemarks(
      tr(
        'Cotisation copropriété - Récépissé libératoire (Loi 18-00 / 106-12)',
        'مساهمة الملكية المشتركة - وصل إبراء الذمة (القانون 18-00 / 106-12)'
      )
    );
    setQuittanceAddLedgerTrx(charge.status !== 'paid');
    setIsQuittanceModalOpen(true);
  };

  // Open Quittance Modal from scratch
  const openQuittanceModalNew = () => {
    const defaultApt = building.apartments[0];
    const defaultRes = defaultApt
      ? building.residents.find((r) => r.apartmentId === defaultApt.id)
      : building.residents[0];
    const amt = defaultApt ? (defaultApt.monthlyFees || building.monthlySyndicFees) : building.monthlySyndicFees;

    setQuittancePaymentId(crypto.randomUUID());
    setQuittanceChargeId('');
    setQuittanceApartmentId(defaultApt?.id || '');
    setQuittanceResidentId(defaultRes?.id || '');
    setQuittanceResidentCin(defaultRes?.cin || 'AB123456');
    setQuittancePeriod(
      new Date().toLocaleDateString(isAr ? 'ar-MA' : 'fr-FR', { month: 'long', year: 'numeric' })
    );
    setQuittanceAmount(String(amt));
    setQuittanceReserveRatio(building.reserveFundPercentage ?? building.reserveFundRate ?? 5);
    setQuittancePaymentMethod('virement');
    setQuittanceBankName(building.bankName || '');
    setQuittanceReference('');
    setQuittancePaymentDate(new Date().toISOString().split('T')[0]);
    setQuittanceRemarks(
      tr(
        'Cotisation mensuelle copropriété - Récépissé libératoire',
        'المساهمة الشهرية للملكية المشتركة - وصل إبراء الذمة'
      )
    );
    setQuittanceAddLedgerTrx(true);
    setIsQuittanceModalOpen(true);
  };

  // Create Quittance Mutation
  const createQuittanceMutation = useMutation({
    mutationFn: async (payload: any) => {
      return createQuittance(payload);
    },
    onSuccess: (newQuit) => {
      queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
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
      const existing = quittances.find((q) => q.chargeId === charge.id);
      const apt = building.apartments.find((a) => a.id === charge.apartmentId);
      const res = building.residents.find((r) => r.id === charge.residentId);

      if (existing) {
        generateQuittancePDF(existing, building, syndic, apt, res);
      } else {
        const generated = await generateQuittanceForCharge(charge.id, building.id);
        queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
        generateQuittancePDF(generated, building, syndic, apt, res);
      }
    } finally {
      setDirectGeneratingChargeId(null);
    }
  };

  // Calculated Stats
  const stats = useMemo(() => {
    const { operatingBalance: balance, reserveBalance: reserveFund } =
      computeBuildingFundBalances(building);

    const pendingChargesTotal = charges
      .filter((c) => c.status === 'pending' || c.status === 'unpaid')
      .reduce((sum, c) => sum + Math.max(0, c.amount - (c.paidAmount || 0)), 0);

    const overdueChargesTotal = charges
      .filter((c) => c.status === 'overdue')
      .reduce((sum, c) => sum + c.amount, 0);

    const pendingProofsCount = paymentProofs.filter((p) => p.status === 'pending').length;

    return {
      balance,
      reserveFund,
      pendingChargesTotal,
      overdueChargesTotal,
      pendingProofsCount,
    };
  }, [building, charges, paymentProofs]);

  // Overdue Debts Grouped by Resident
  const overdueResidents = useMemo(() => {
    const overdueList = charges.filter((c) => c.status === 'overdue');
    const grouped: Record<
      string,
      {
        residentId: string;
        residentName: string;
        apartmentNumber: string;
        apartment?: any;
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
          apartmentNumber: apt?.number || 'Lot',
          apartment: apt,
          totalOverdue: 0,
          overdueCount: 0,
          oldestDate: c.dueDate,
        };
      }
      grouped[c.residentId].totalOverdue += c.amount;
      grouped[c.residentId].overdueCount += 1;
      if (new Date(c.dueDate) < new Date(grouped[c.residentId].oldestDate)) {
        grouped[c.residentId].oldestDate = c.dueDate;
      }
    });

    return Object.values(grouped);
  }, [charges, building, tr]);

  // Filtered transactions for the Grand Livre
  const filteredTransactions = useMemo(() => {
    const list = building.financials?.transactions || [];
    return list.filter((trx) => {
      if (filterFund === 'courant' && trx.fundType === 'reserve') return false;
      if (filterFund === 'reserve' && trx.fundType !== 'reserve') return false;

      if (filterType === 'income' && (trx.amount < 0 || trx.type === 'expense')) return false;
      if (filterType === 'expense' && (trx.amount > 0 || trx.type === 'income')) return false;

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
    let income = 0;
    let expense = 0;
    filteredTransactions.forEach((t) => {
      if (t.amount >= 0) income += t.amount;
      else expense += Math.abs(t.amount);
    });
    return {
      income,
      expense,
      net: income - expense,
      count: filteredTransactions.length,
    };
  }, [filteredTransactions]);

  // Filtered Quittances and stats
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

  const totalQuittancesAmount = useMemo(() => {
    return quittances.reduce((sum, q) => sum + (q.amount || 0), 0);
  }, [quittances]);

  const totalReserveFundAmount = useMemo(() => {
    const fallbackRatio = (building.reserveFundPercentage ?? building.reserveFundRate ?? 5) / 100;
    return quittances.reduce((sum, q) => {
      const reserve =
        q.reserveFundAmount !== undefined ? q.reserveFundAmount : Math.round(q.amount * fallbackRatio);
      return sum + reserve;
    }, 0);
  }, [quittances, building.reserveFundPercentage, building.reserveFundRate]);

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

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      throw new Error(Object.values(errors).join("\n"));
    }

    if (!trxDate || Number.isNaN(Date.parse(trxDate))) throw new Error(tr('Indiquez une date valide.', 'أدخل تاريخاً صالحاً.'));
    setFormErrors({});

    // The server accepts a positive magnitude and applies the income/expense sign.
    const finalAmount = numericAmount;

    return addTrxMutation.mutateAsync({
      date: new Date(trxDate).toISOString(),
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
    });
  };

  if (loadingCharges || loadingProofs || loadingQuittances) {
    return <Loading message={tr('Chargement des données financières...', 'جاري تحميل البيانات المالية...')} />;
  }

  return (
    <div className="space-y-6">
      <FinancialTools building={building} />
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
        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            onClick={() =>
              exportAnnualRepartitionPDF(
                building,
                syndic,
                charges,
                quittances,
                new Date().getFullYear()
              )
            }
            className="text-xs sm:text-sm flex items-center gap-1.5"
          >
            <DocumentsIcon />
            <span>{tr('Clôture Annuelle (PDF)', 'الحصيلة السنوية (PDF)')}</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsGenerateModalOpen(true)}
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
            <span>{tr('Quittances Certifiées', 'وصولات الأداء المعتمدة')} ({quittances.length})</span>
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
              <div className="flex items-center gap-2">
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

            <div className="overflow-x-auto">
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
                    const isIncome = trx.amount >= 0 || trx.type === 'income';
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
                          {currencyFormatter.format(trx.amount)}
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

      {/* TAB 2: APPELS DE CHARGES */}
      {activeTab === 'charges' && (
        <Card className="overflow-hidden border border-slate-200">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
            <div>
              <h3 className="font-semibold text-slate-800 text-sm">{tr('Appels de Charges de Copropriété', 'طلبات مساهمات الملكية المشتركة')}</h3>
              <p className="text-xs text-slate-500">
                {tr('Montants calculés selon la quote-part en tantièmes de chaque lot (Loi 18-00)', 'المبالغ محتسبة حسب الحصة الشائعة لكل شقة (القانون 18-00)')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setIsGenerateModalOpen(true)}
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

          <div className="overflow-x-auto">
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

                  return (
                    <tr key={charge.id} className="hover:bg-slate-50 transition-colors h-11">
                      <td className="px-4 py-2 font-mono font-bold text-teal-800">
                        {apt?.number || 'Lot'}
                        {apt?.tantiemes && (
                          <span className="ms-1.5 text-[11px] font-normal text-slate-400">
                            ({apt.tantiemes}/1000)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900">{res?.name || tr('Inconnu', 'غير معروف')}</td>
                      <td className="px-4 py-2 text-slate-600">{charge.period || 'Octobre 2026'}</td>
                      <td className="px-4 py-2 text-slate-500 font-mono text-xs">
                        {new Date(charge.dueDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                            charge.status === 'paid'
                              ? 'bg-emerald-50 text-emerald-700'
                              : charge.status === 'overdue'
                              ? 'bg-rose-50 text-rose-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {charge.status === 'paid'
                            ? tr('Payé', 'مؤدى')
                            : charge.status === 'overdue'
                            ? tr('En retard', 'متأخر')
                            : tr('En attente', 'في الانتظار')}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-end font-mono font-bold text-slate-900">
                        {currencyFormatter.format(charge.amount)}
                      </td>
                      <td className="px-4 py-2 text-end">
                        <div className="flex items-center justify-end gap-1.5">
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
                            <button
                              onClick={() => openQuittanceModalForCharge(charge)}
                              className="px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded border border-emerald-200 shrink-0"
                            >
                              {tr('+ Quittance', '+ إصدار وصل')}
                            </button>
                          )}

                          <button
                            onClick={async () => {
                              if (!res) return;
                              try {
                                const invoices = await getInvoicesForBuilding(building.id);
                                const invoice = invoices.find(i => i.id === charge.invoiceId || i.chargeIds.includes(charge.id)) || await createInvoiceForResident(charge.residentId,building.id,building.syndicId);
                                generateInvoicePDF(invoice,building,res,syndic);
                              } catch (e:any) { showToast(e.message,'error'); }
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
                      const lines = text
                        .split(/\r?\n/)
                        .map((l) => l.trim())
                        .filter(Boolean);
                      const parsedRows = lines
                        .slice(lines[0]?.toLowerCase().includes('montant') || lines[0]?.toLowerCase().includes('amount') ? 1 : 0)
                        .map((line) => {
                          const cols = line.split(/[;,]/).map((c) => c.trim().replace(/^"|"$/g, ''));
                          const numCol = cols.find((c) => /^-?\d+([.,]\d+)?$/.test(c.replace(/\s/g, '')));
                          return {
                            date: cols[0] || new Date().toISOString(),
                            label: cols[1] || line,
                            amount: numCol ? parseFloat(numCol.replace(',', '.')) : 0,
                            reference: cols[2] || undefined,
                          };
                        })
                        .filter((r) => r.amount > 0);
                      const res = await reconcileBankStatementCSV(building.id, parsedRows);
                      await queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
                      await queryClient.invalidateQueries({ queryKey: ['syndics'] });
                      showToast(
                        tr(
                          `Rapprochement bancaire terminé : ${res.matchedCount} virement(s) lettré(s) (${res.totalReconciledMad} MAD).`,
                          `تمت المطابقة البنكية: ${res.matchedCount} تحويلات مطابقة (${res.totalReconciledMad} درهم).`
                        ),
                        'success'
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
                  onClick={async () => {
                    const res = await approvePaymentProofsBatch(building.id);
                    await queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
                    await queryClient.invalidateQueries({ queryKey: ['syndics'] });
                    showToast(
                      tr(
                        `${res.approvedCount} justificatif(s) conforme(s) validé(s) (${res.totalAmountMad} MAD).`,
                        `تمت المصادقة على ${res.approvedCount} إثباتات مطابقة (${res.totalAmountMad} درهم).`
                      ),
                      res.approvedCount > 0 ? 'success' : 'info'
                    );
                  }}
                  className="text-xs bg-teal-700 hover:bg-teal-800 text-white font-bold"
                >
                  ✓ {tr('Valider les virements conformes (1-clic)', 'تأكيد التحويلات المطابقة (نقرة واحدة)')}
                </Button>
              )}
            </div>
          </div>

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
                      {tr('Date :', 'التاريخ:')} {new Date(proof.submissionDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
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
                        onClick={() =>
                          reviewProofMutation.mutate({ proofId: proof.id, decision: 'approve' })
                        }
                        className="text-xs bg-emerald-600 hover:bg-emerald-700"
                      >
                        {tr('Valider & Délivrer Quittance', 'تأكيد وإصدار الوصل')}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const reason = prompt(
                            tr('Motif du rejet :', 'سبب الرفض:'),
                            tr('Référence introuvable sur le relevé', 'المرجع غير موجود في الكشف البنكي')
                          );
                          if (reason !== null) {
                            reviewProofMutation.mutate({
                              proofId: proof.id,
                              decision: 'reject',
                              reason,
                            });
                          }
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
                  {tr('Quittances Émises', 'الوصولات الصادرة')}
                </span>
                <span className="text-lg font-bold font-mono text-white mt-0.5 block">{quittances.length}</span>
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
                  {tr('Fonds de Réserve (Loi 106-12)', 'صندوق الاحتياط (106-12)')}
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
                  {quittances[0]?.quittanceNumber || tr('Aucun', 'لا يوجد')}
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

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <select
                  value={quittanceFilterMethod}
                  onChange={(e) => setQuittanceFilterMethod(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
                >
                  <option value="all">{tr('Tous les modes de paiement', 'جميع طرق الأداء')}</option>
                  <option value="virement">{tr('Virement bancaire', 'تحويل بنكي')}</option>
                  <option value="cheque">{tr('Chèque bancaire', 'شيك بنكي')}</option>
                  <option value="versement">{tr('Versement agence / GAB', 'إيداع بنكي')}</option>
                  <option value="especes">{tr('Espèces (Reçu caisse)', 'نقداً (وصل صندوق)')}</option>
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
            <div className="overflow-x-auto">
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
                    const reserveAmt = quit.reserveFundAmount !== undefined ? quit.reserveFundAmount : splitChargeReserveAndOperating(quit.amount, building.reserveFundPercentage ?? building.reserveFundRate ?? 5).reserveFundAmount;
                    const courantesAmt = quit.chargesCourantesAmount !== undefined ? quit.chargesCourantesAmount : (quit.amount - reserveAmt);

                    return (
                      <tr key={quit.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-mono font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded text-xs block w-fit">
                            {quit.quittanceNumber}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono mt-0.5 block">
                            {tr('Émise le', 'صادر في')} {new Date(quit.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900">{quit.residentName}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            CIN: {quit.residentCin || res?.cin || 'AB123456'}
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="font-semibold text-slate-800">
                            {tr('Lot', 'شقة')} {quit.apartmentNumber}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {quit.tantiemes || apt?.tantiemes || 100} / 1000
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800">{quit.periodCovered}</span>
                          <span className="text-[11px] text-slate-400 block font-mono">
                            {tr('Payé le', 'أُدي في')} {new Date(quit.paymentDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[11px] space-y-0.5 font-mono">
                            <div className="text-slate-600">{tr('Courant:', 'الجاري:')} {currencyFormatter.format(courantesAmt)}</div>
                            <div className="text-emerald-700 font-medium">{tr('Réserve (106-12):', 'الاحتياط:')} {currencyFormatter.format(reserveAmt)}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-end whitespace-nowrap">
                          <span className="font-mono font-bold text-base text-teal-900 block">
                            {currencyFormatter.format(quit.amount)}
                          </span>
                          <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.2 rounded">
                            {tr('Libératoire', 'مُبرئ للذمة')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-slate-700 font-medium capitalize">
                            {quit.paymentMethod === 'virement'
                              ? tr('Virement bancaire', 'تحويل بنكي')
                              : quit.paymentMethod === 'cheque'
                              ? tr('Chèque', 'شيك')
                              : quit.paymentMethod}
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

          <Card className="overflow-hidden border border-slate-200">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-slate-800 text-sm">{tr('Copropriétaires Débiteurs', 'الملاك المشتركون المتأخرون عن الأداء')}</h3>
                <p className="text-xs text-slate-500">{tr('Générez la mise en demeure formelle en 1 clic', 'إصدار الإنذار الرسمي بالأداء بنقرة واحدة')}</p>
              </div>
              <span className="text-xs font-mono font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded">
                {tr('Total créances :', 'مجموع الديون:')} {currencyFormatter.format(stats.overdueChargesTotal)}
              </span>
            </div>

            <div className="divide-y divide-slate-100">
              {overdueResidents.map((item) => {
                const resident = building.residents.find((r) => r.id === item.residentId);
                const apt = item.apartment;

                return (
                  <div
                    key={item.residentId}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-sm">{item.residentName}</span>
                        <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                          {tr('Lot', 'شقة')} {item.apartmentNumber}
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

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-end">
                        <span className="text-xs text-slate-400 block">{tr('Total Dû', 'المبلغ المستحق')}</span>
                        <span className="font-mono font-bold text-base text-rose-700">
                          {currencyFormatter.format(item.totalOverdue)}
                        </span>
                      </div>

                      <Button
                        onClick={() => {
                          if (resident && apt) {
                            generateMiseEnDemeurePDF(resident, apt, building, item.totalOverdue, syndic);
                          } else {
                            alert(tr('Informations du copropriétaire incomplètes.', 'بيانات المالك المشترك غير مكتملة.'));
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
            return (
              <div className="p-3 bg-teal-50/70 border border-teal-200 rounded-xl space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-teal-900">
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
                  <span className="font-bold text-teal-900 text-sm">
                    {tr('Nouveau solde prévu :', 'الرصيد الجديد المتوقع:')} {currencyFormatter.format(projBal)}
                  </span>
                </div>
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
            <div className="flex justify-between items-center w-full">
              <Button
                onClick={() => generateTransactionVoucherPDF(selectedTrxForView, building, syndic)}
                className="text-xs bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
              >
                <DocumentsIcon />
                <span>{tr('Télécharger Pièce Comptable PDF', 'تحميل الوثيقة المحاسبية PDF')}</span>
              </Button>
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
                    selectedTrxForView.amount >= 0 ? 'text-emerald-600' : 'text-slate-900'
                  }`}
                >
                  {selectedTrxForView.amount >= 0 ? '+' : ''}
                  {currencyFormatter.format(selectedTrxForView.amount)}
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
          if (totalBudgetInput && (!Number.isFinite(Number(totalBudgetInput)) || Number(totalBudgetInput) <= 0)) throw new Error(tr('Le budget doit être un montant supérieur à zéro.', 'يجب أن تكون الميزانية مبلغاً أكبر من صفر.'));
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
              `Cette action génère les avis de cotisation pour l'ensemble des ${building.apartments.length} lots de la résidence.`,
              `يقوم هذا الإجراء بإصدار إشعارات المساهمة لجميع الشقق (${building.apartments.length} وحدة) في الإقامة.`
            )}
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Période concernée', 'الفترة المعنية')}
            </label>
            <input
              type="month"
              value={periodName}
              onChange={(e) => setPeriodName(e.target.value)}
              required
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>

          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useTantiemes}
                onChange={(e) => setUseTantiemes(e.target.checked)}
                className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
              />
              <div>
                <span className="text-xs font-bold text-teal-900 block">
                  {tr('Calculer selon les tantièmes de copropriété (Loi 18-00)', 'الاحتساب حسب الحصة الشائعة (الأجزاء) وفق القانون 18-00')}
                </span>
                <span className="text-[11px] text-teal-700 block">
                  {tr(
                    'La cotisation est calculée proportionnellement à la quote-part de chaque lot sur 1000 tantièmes.',
                    'يتم احتساب المساهمة بشكل تناسبي مع حصة كل شقة على أساس 1000 جزء.'
                  )}
                </span>
              </div>
            </label>

            {useTantiemes && (
              <div className="mt-2 pt-2 border-t border-teal-200">
                <label className="block text-xs font-semibold text-teal-900 mb-1">
                  {tr('Budget global mensuel à répartir (MAD)', 'الميزانية الشهرية الإجمالية للتوزيع (درهم)')}
                </label>
                <input
                  type="number"
                  value={totalBudgetInput}
                  onChange={(e) => setTotalBudgetInput(e.target.value)}
                  className="w-full px-3 py-1.5 border border-teal-300 rounded text-sm font-mono bg-white"
                />
              </div>
            )}
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
                  if (!quittanceApartmentId) {
                    throw new Error(tr('Veuillez sélectionner un lot.', 'يرجى اختيار الشقة.'));
                  }

                  const apt = building.apartments.find((a) => a.id === quittanceApartmentId);
                  const res = building.residents.find((r) => r.id === quittanceResidentId);

                  if (!apt || !res) throw new Error(tr('Sélectionnez un lot et son résident.', 'حدد الوحدة وساكنها.'));
                  if (!quittancePaymentDate || Number.isNaN(Date.parse(quittancePaymentDate))) throw new Error(tr('Indiquez une date de paiement valide.', 'أدخل تاريخ أداء صالحاً.'));
                  const { reserveFundAmount: reserveAmt, chargesCourantesAmount: courantesAmt } =
                    splitChargeReserveAndOperating(numAmt, quittanceReserveRatio);

                  await createQuittanceMutation.mutateAsync({
                    chargeId: quittanceChargeId,
                    paymentId: quittancePaymentId,
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
                    periodCovered: quittancePeriod,
                    bankName: quittanceBankName,
                    referenceNumber: quittanceReference || undefined,
                    remarks: quittanceRemarks || undefined,
                    addTransactionToLedger: quittanceAddLedgerTrx,
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
                disabled={createQuittanceMutation.isPending}
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
                    const resident = building.residents.find((r) => r.apartmentId === aptId) || building.residents[0];
                    if (resident) {
                      setQuittanceResidentId(resident.id);
                      setQuittanceResidentCin(resident.cin || 'AB123456');
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
                    const res = building.residents.find((r) => r.apartmentId === a.id);
                    return (
                      <option key={a.id} value={a.id}>
                        {tr('Lot', 'شقة')} {a.number} — {res?.name || tr('Copropriétaire', 'مالك مشترك')} ({a.tantiemes || 100}/1000)
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
                      setQuittanceResidentCin(r.cin || 'AB123456');
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
                  {building.apartments.find((a) => a.id === quittanceApartmentId)?.tantiemes || 100} / 1000
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Période Couverte', 'الفترة المشمولة')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={quittancePeriod}
                  onChange={(e) => setQuittancePeriod(e.target.value)}
                  placeholder={tr('Ex: Octobre 2026', 'مثال: أكتوبر 2026')}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  {tr('Montant Total Encaissé (MAD)', 'المبلغ الإجمالي المحصل (درهم)')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="number"
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

            <label className="flex items-center gap-2 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={quittanceAddLedgerTrx}
                onChange={(e) => setQuittanceAddLedgerTrx(e.target.checked)}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="text-xs text-slate-700">
                {tr(
                  "Inscrire automatiquement l'écriture d'encaissement dans le journal comptable de la copropriété",
                  'تسجيل عملية التحصيل تلقائياً في السجل المحاسبي للملكية المشتركة'
                )}
              </span>
            </label>
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
                  {tr('Lot', 'شقة')} {selectedQuittanceForPreview.apartmentNumber} · {selectedQuittanceForPreview.tantiemes} / 1000
                </p>
                <p className="text-slate-500 font-mono text-[11px]">
                  CIN: {selectedQuittanceForPreview.residentCin || 'AB123456'}
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
                    {currencyFormatter.format(
                      selectedQuittanceForPreview.chargesCourantesAmount ??
                        splitChargeReserveAndOperating(
                          selectedQuittanceForPreview.amount,
                          building?.reserveFundPercentage ?? building?.reserveFundRate ?? 5
                        ).chargesCourantesAmount
                    )}
                  </span>
                </div>
                <div className="flex justify-between items-center text-emerald-800">
                  <span>{tr('2. Provision obligatoire Fonds de Réserve (Loi 106-12 Art. 18 bis)', '2. مساهمة صندوق الاحتياط الإلزامي (القانون 106-12)')}</span>
                  <span className="font-mono font-semibold">
                    {currencyFormatter.format(
                      selectedQuittanceForPreview.reserveFundAmount ??
                        splitChargeReserveAndOperating(
                          selectedQuittanceForPreview.amount,
                          building?.reserveFundPercentage ?? building?.reserveFundRate ?? 5
                        ).reserveFundAmount
                    )}
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
    </div>
  );
};

export default FinancialsView;
