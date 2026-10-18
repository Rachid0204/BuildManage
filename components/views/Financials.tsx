import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Transaction, Charge, Syndic, PaymentProof, Quittance, Prestataire, PaymentMethod } from '../../types';
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
  getPaymentProofsForBuilding,
  reviewPaymentProof,
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
} from '../../services/pdfService';
import Loading from '../common/Loading';

interface FinancialsProps {
  building: Building;
  syndic?: Syndic;
}

type TabType = 'transactions' | 'charges' | 'verifications' | 'quittances' | 'impayes';

const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  minimumFractionDigits: 2,
});

const MOROCCAN_BANKS = [
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

const CATEGORY_LABELS: Record<string, string> = {
  maintenance: 'Maintenance & Dépannages',
  elevator: 'Ascenseur & Équipements',
  salary: 'Salaires (Gardien / Concierge)',
  utility: 'Électricité & Eau (Lydec/Redal)',
  cleaning: 'Nettoyage & Hygiène',
  fees: 'Cotisations Copropriété',
  insurance: 'Assurance Multirisque',
  bank_fees: 'Frais Bancaires',
  legal: 'Contentieux & Recouvrement',
  reserve: 'Gros travaux (Fonds Réserve)',
  reimbursement: 'Remboursement / Sinistre',
  other: 'Autre opération',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  virement: 'Virement bancaire',
  cheque: 'Chèque',
  versement: 'Versement agence',
  cmi: 'Carte CMI',
  especes: 'Espèces (Caisse)',
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  facture: 'Facture Fournisseur',
  quittance: 'Quittance',
  recu: 'Reçu / Décharge',
  releve: 'Relevé / Avis d’opéré',
  devis: 'Devis validé AG',
  autre: 'Autre pièce',
};

const FinancialsView: React.FC<FinancialsProps> = ({ building, syndic }) => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('transactions');
  const [isTrxModalOpen, setIsTrxModalOpen] = useState(false);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [selectedTrxForView, setSelectedTrxForView] = useState<Transaction | null>(null);

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
  const [trxBankName, setTrxBankName] = useState(building.bankName || 'Attijariwafa Bank');
  const [trxNotes, setTrxNotes] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Charge Generation Form State
  const [useTantiemes, setUseTantiemes] = useState(true);
  const [periodName, setPeriodName] = useState(
    new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  );
  const [totalBudgetInput, setTotalBudgetInput] = useState(
    String(building.apartments.reduce((acc, a) => acc + (a.monthlyFees || building.monthlySyndicFees), 0))
  );

  // Quittance Generator State (Loi 18-00 & Loi 106-12)
  const [isQuittanceModalOpen, setIsQuittanceModalOpen] = useState(false);
  const [selectedQuittanceForPreview, setSelectedQuittanceForPreview] = useState<Quittance | null>(null);
  const [quittanceChargeId, setQuittanceChargeId] = useState('');
  const [quittanceApartmentId, setQuittanceApartmentId] = useState('');
  const [quittanceResidentId, setQuittanceResidentId] = useState('');
  const [quittanceResidentCin, setQuittanceResidentCin] = useState('');
  const [quittancePeriod, setQuittancePeriod] = useState(
    new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  );
  const [quittanceAmount, setQuittanceAmount] = useState('');
  const [quittanceReserveRatio, setQuittanceReserveRatio] = useState(15);
  const [quittancePaymentMethod, setQuittancePaymentMethod] = useState<PaymentMethod>('virement');
  const [quittanceBankName, setQuittanceBankName] = useState(building.bankName || 'Attijariwafa Bank');
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
    setTrxBankName(building.bankName || 'Attijariwafa Bank');
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
  });

  const generateChargesMutation = useMutation({
    mutationFn: () =>
      generateMonthlyCharges(building.id, building.syndicId, {
        useTantiemes,
        periodName,
        totalMonthlyBudget: parseFloat(totalBudgetInput) || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setIsGenerateModalOpen(false);
      alert('Appel de fonds généré avec succès.');
    },
  });

  // Open Quittance Modal for a specific charge
  const openQuittanceModalForCharge = (charge: Charge) => {
    const apt = building.apartments.find((a) => a.id === charge.apartmentId);
    const res = building.residents.find((r) => r.id === charge.residentId);

    setQuittanceChargeId(charge.id);
    setQuittanceApartmentId(charge.apartmentId);
    setQuittanceResidentId(charge.residentId);
    setQuittanceResidentCin(res?.cin || 'AB123456');
    setQuittancePeriod(charge.period || 'Octobre 2026');
    setQuittanceAmount(String(charge.amount));
    setQuittanceReserveRatio(15);
    setQuittancePaymentMethod(charge.paymentMethod || 'virement');
    setQuittanceBankName(building.bankName || 'Attijariwafa Bank');
    setQuittanceReference(`VIR-${charge.id.slice(-6).toUpperCase()}`);
    setQuittancePaymentDate(
      charge.paidAt ? charge.paidAt.split('T')[0] : new Date().toISOString().split('T')[0]
    );
    setQuittanceRemarks('Cotisation copropriété - Récépissé libératoire (Loi 18-00 / 106-12)');
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

    setQuittanceChargeId('');
    setQuittanceApartmentId(defaultApt?.id || '');
    setQuittanceResidentId(defaultRes?.id || '');
    setQuittanceResidentCin(defaultRes?.cin || 'AB123456');
    setQuittancePeriod(
      new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    );
    setQuittanceAmount(String(amt));
    setQuittanceReserveRatio(15);
    setQuittancePaymentMethod('virement');
    setQuittanceBankName(building.bankName || 'Attijariwafa Bank');
    setQuittanceReference('');
    setQuittancePaymentDate(new Date().toISOString().split('T')[0]);
    setQuittanceRemarks('Cotisation mensuelle copropriété - Récépissé libératoire');
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
    const balance = building.financials?.balance || 0;
    const reserveFund = building.financials?.reserveFundBalance || Math.round(balance * 0.2);

    const pendingChargesTotal = charges
      .filter((c) => c.status === 'pending')
      .reduce((sum, c) => sum + c.amount, 0);

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
          residentName: res?.name || 'Copropriétaire',
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
  }, [charges, building]);

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
    return quittances.reduce((sum, q) => {
      const reserve = q.reserveFundAmount !== undefined ? q.reserveFundAmount : Math.round(q.amount * 0.15);
      return sum + reserve;
    }, 0);
  }, [quittances]);

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
      else if (found.category === 'plumbing' || found.category === 'electricity') setTrxCategory('maintenance');
      if (!trxDesc) {
        setTrxDesc(`Facture entretien/intervention - ${found.name}`);
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
      const resName = res?.name || 'Copropriétaire';
      setTrxThirdPartyName(resName);
      if (!trxDesc) {
        setTrxDesc(`Règlement cotisation charges - Lot ${apt.number} (${resName})`);
      }
      if (!trxAmount) {
        setTrxAmount(String(apt.monthlyFees || building.monthlySyndicFees));
      }
    }
  };

  // Submit Handler with Law 18-00 Validations
  const handleSubmitTransaction = () => {
    const errors: Record<string, string> = {};
    const numericAmount = parseFloat(trxAmount);

    if (isNaN(numericAmount) || numericAmount <= 0) {
      errors.amount = 'Veuillez saisir un montant valide strictement supérieur à 0 MAD';
    }

    if (!trxDesc.trim()) {
      errors.description = "Le libellé de l'opération est obligatoire (Art. 26 Loi 18-00)";
    }

    if (trxType === 'expense' && !trxThirdPartyName.trim()) {
      errors.thirdParty = 'Veuillez renseigner le prestataire, fournisseur ou bénéficiaire';
    }

    if (trxType === 'expense' && !trxInvoiceNumber.trim()) {
      errors.invoiceNumber = 'Le N° de facture ou pièce justificative est obligatoire (Loi 18-00)';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});

    const finalAmount = trxType === 'income' ? numericAmount : -numericAmount;

    addTrxMutation.mutate({
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
    return <Loading message="Chargement des données financières..." />;
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FinancialsIcon />
            <span>Gestion Financière & Recouvrement</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Comptabilité de la copropriété {building.name} · Tantièmes, Quittances certifiées et Mises en demeure (Loi 18-00)
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            variant="secondary"
            onClick={() => setIsGenerateModalOpen(true)}
            className="text-xs sm:text-sm flex items-center gap-1.5"
          >
            <span>Lancer un appel de fonds</span>
          </Button>
          <Button
            onClick={() => setIsTrxModalOpen(true)}
            className="text-xs sm:text-sm flex items-center gap-1.5"
          >
            <PlusIcon />
            <span>Nouvelle opération</span>
          </Button>
        </div>
      </div>

      {/* KPI Financial Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 border-l-4 border-l-teal-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Solde Compte Courant</p>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
            {currencyFormatter.format(stats.balance)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
            <span>Banque :</span>
            <span className="font-medium text-slate-700">{building.bankName || 'Attijariwafa Bank'}</span>
          </p>
        </Card>

        <Card className="p-4 border-l-4 border-l-indigo-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Fonds de Réserve (Loi 106-12)</p>
          <p className="text-2xl font-bold font-mono text-indigo-900 mt-1 tabular-nums">
            {currencyFormatter.format(stats.reserveFund)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">Obligation légale pour gros travaux</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-amber-500">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Charges à Recouvrer</p>
          <p className="text-2xl font-bold font-mono text-amber-800 mt-1 tabular-nums">
            {currencyFormatter.format(stats.pendingChargesTotal)}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">En cours de règlement</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-rose-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Impayés & Contentieux</p>
          <p className="text-2xl font-bold font-mono text-rose-700 mt-1 tabular-nums">
            {currencyFormatter.format(stats.overdueChargesTotal)}
          </p>
          <p className="text-[11px] text-rose-600 mt-1 font-medium">
            {overdueResidents.length} copropriétaires en retard
          </p>
        </Card>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex space-x-6 overflow-x-auto text-sm font-medium">
          <button
            onClick={() => setActiveTab('transactions')}
            className={`pb-3 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'transactions'
                ? 'border-teal-600 text-teal-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Journal des Transactions
          </button>

          <button
            onClick={() => setActiveTab('charges')}
            className={`pb-3 border-b-2 whitespace-nowrap transition-colors ${
              activeTab === 'charges'
                ? 'border-teal-600 text-teal-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Appels de Charges ({charges.length})
          </button>

          <button
            onClick={() => setActiveTab('verifications')}
            className={`pb-3 border-b-2 whitespace-nowrap flex items-center gap-1.5 transition-colors ${
              activeTab === 'verifications'
                ? 'border-teal-600 text-teal-700 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>Vérification des Virements</span>
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
            <span>Quittances Certifiées ({quittances.length})</span>
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
            <span>Recouvrement & Impayés (Loi 18-00)</span>
          </button>
        </nav>
      </div>

      {/* TAB 1: JOURNAL DES TRANSACTIONS (GRAND LIVRE LOI 18-00) */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Filters & Search Toolbar */}
          <Card className="p-4 bg-white border border-slate-200">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              {/* Search */}
              <div className="md:col-span-4">
                <div className="relative">
                  <input
                    type="text"
                    value={searchTrx}
                    onChange={(e) => setSearchTrx(e.target.value)}
                    placeholder="Rechercher par libellé, prestataire, ICE, chèque..."
                    className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                  />
                  <span className="absolute left-2.5 top-2 text-slate-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </span>
                </div>
              </div>

              {/* Fund Filter */}
              <div className="md:col-span-2">
                <select
                  value={filterFund}
                  onChange={(e) => setFilterFund(e.target.value as any)}
                  className="w-full py-1.5 px-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">Tous les fonds</option>
                  <option value="courant">Compte Courant</option>
                  <option value="reserve">Fonds Réserve (106-12)</option>
                </select>
              </div>

              {/* Type Filter */}
              <div className="md:col-span-2">
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                  className="w-full py-1.5 px-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">Toutes opérations</option>
                  <option value="income">Recettes (+) uniquement</option>
                  <option value="expense">Dépenses (-) uniquement</option>
                </select>
              </div>

              {/* Category Filter */}
              <div className="md:col-span-3">
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full py-1.5 px-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">Toutes les catégories</option>
                  {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reset Filters */}
              <div className="md:col-span-1 flex justify-end">
                <button
                  onClick={() => {
                    setSearchTrx('');
                    setFilterFund('all');
                    setFilterType('all');
                    setFilterCategory('all');
                  }}
                  title="Réinitialiser filtres"
                  className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Effacer
                </button>
              </div>
            </div>

            {/* Filtered stats summary strip */}
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="text-slate-500 font-medium">
                Affichage de <strong className="text-slate-800">{filteredStats.count}</strong> écriture(s) sur{' '}
                {building.financials?.transactions?.length || 0}
              </span>
              <div className="flex items-center gap-4 font-mono">
                <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Recettes : +{currencyFormatter.format(filteredStats.income)}
                </span>
                <span className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                  Dépenses : -{currencyFormatter.format(filteredStats.expense)}
                </span>
                <span className="text-slate-900 bg-slate-100 px-2 py-0.5 rounded font-bold border border-slate-300">
                  Solde net : {filteredStats.net >= 0 ? '+' : ''}
                  {currencyFormatter.format(filteredStats.net)}
                </span>
              </div>
            </div>
          </Card>

          {/* Transactions Table Card */}
          <Card className="overflow-hidden border border-slate-200 shadow-sm">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-slate-800 text-sm">
                  Grand Livre des Écritures Comptables
                </h3>
                <p className="text-[11px] text-slate-500">
                  Tenue des comptes selon la Loi 18-00 · Séparation légale Budget courant & Fonds de réserve
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
                  <span>Ajouter une opération</span>
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs">
                <thead className="bg-slate-100/75 text-slate-600 text-left font-semibold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="px-4 py-3">Date & Réf</th>
                    <th className="px-4 py-3">Libellé & Pièce Comptable</th>
                    <th className="px-4 py-3">Affectation Fonds</th>
                    <th className="px-4 py-3">Catégorie</th>
                    <th className="px-4 py-3">Règlement & Banque</th>
                    <th className="px-4 py-3 text-right">Montant</th>
                    <th className="px-4 py-3 text-center">Justificatif</th>
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
                        {/* Date & Ref */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="font-medium text-slate-900">
                            {new Date(trx.date).toLocaleDateString('fr-MA')}
                          </p>
                          <span className="font-mono text-[10px] text-slate-400">
                            {trx.id}
                          </span>
                        </td>

                        {/* Description & Justificatif */}
                        <td className="px-4 py-3 max-w-xs sm:max-w-md">
                          <p className="font-medium text-slate-900 line-clamp-1">{trx.description}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[11px]">
                            {/* Third Party / Provider or Resident */}
                            {trx.thirdPartyName && (
                              <span className="font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                                {trx.thirdPartyName}
                              </span>
                            )}
                            {/* ICE badge */}
                            {trx.thirdPartyIce && (
                              <span className="text-slate-500 font-mono text-[10px] bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                                ICE: {trx.thirdPartyIce}
                              </span>
                            )}
                            {/* Lot number */}
                            {trx.lotNumber && (
                              <span className="text-teal-700 font-medium bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                                Lot {trx.lotNumber}
                              </span>
                            )}
                            {/* Invoice number */}
                            {trx.invoiceNumber && (
                              <span className="text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded font-mono text-[10px] border border-amber-200">
                                {trx.documentType ? DOCUMENT_TYPE_LABELS[trx.documentType] || trx.documentType : 'Pièce'} : #{trx.invoiceNumber}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Fund Badge */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          {trx.fundType === 'reserve' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                              Fonds Réserve (106-12)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-teal-600"></span>
                              Compte Courant
                            </span>
                          )}
                        </td>

                        {/* Category */}
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600 font-medium">
                          {trx.category ? CATEGORY_LABELS[trx.category] || trx.category : 'Charges'}
                        </td>

                        {/* Mode & Bank */}
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                          <p className="uppercase text-[11px] font-semibold text-slate-700">
                            {trx.paymentMethod ? PAYMENT_METHOD_LABELS[trx.paymentMethod] || trx.paymentMethod : 'Virement'}
                          </p>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {trx.reference && <span>Réf: {trx.reference} · </span>}
                            <span>{trx.bankName || building.bankName || 'Attijariwafa'}</span>
                          </div>
                        </td>

                        {/* Amount */}
                        <td
                          className={`px-4 py-3 text-right font-mono font-bold text-sm whitespace-nowrap tabular-nums ${
                            isIncome ? 'text-emerald-600' : 'text-slate-900'
                          }`}
                        >
                          {isIncome ? '+' : ''}
                          {currencyFormatter.format(trx.amount)}
                        </td>

                        {/* Actions */}
                        <td
                          className="px-4 py-3 text-center whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => generateTransactionVoucherPDF(trx, building, syndic)}
                              title="Télécharger la pièce comptable PDF (Loi 18-00)"
                              className="p-1.5 text-slate-600 hover:text-teal-700 hover:bg-teal-50 rounded transition-colors border border-slate-200"
                            >
                              <DocumentsIcon />
                            </button>
                            <button
                              onClick={() => setSelectedTrxForView(trx)}
                              title="Voir les détails complets de l'opération"
                              className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200"
                            >
                              Détails
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredTransactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                        <p className="font-semibold text-sm">Aucune écriture comptable trouvée</p>
                        <p className="text-xs mt-1 text-slate-400">
                          Essayez de modifier vos critères de recherche ou ajoutez une nouvelle opération.
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
                          Réinitialiser les filtres
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
              <h3 className="font-semibold text-slate-800 text-sm">Appels de Charges de Copropriété</h3>
              <p className="text-xs text-slate-500">Montants calculés selon la quote-part en tantièmes de chaque lot (Loi 18-00)</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => setIsGenerateModalOpen(true)}
                className="text-xs"
              >
                + Nouvel Appel Général
              </Button>
              <Button
                onClick={() => openQuittanceModalNew()}
                className="text-xs bg-teal-700 hover:bg-teal-800 flex items-center gap-1.5"
              >
                <QuittanceIcon />
                <span>+ Émettre une Quittance</span>
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
              <thead className="bg-slate-50 text-slate-500 text-left font-medium">
                <tr>
                  <th className="px-4 py-2.5">Lot / Apt</th>
                  <th className="px-4 py-2.5">Copropriétaire</th>
                  <th className="px-4 py-2.5">Période</th>
                  <th className="px-4 py-2.5">Échéance</th>
                  <th className="px-4 py-2.5">Statut</th>
                  <th className="px-4 py-2.5 text-right">Cotisation</th>
                  <th className="px-4 py-2.5 text-right">Documents & Quittance</th>
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
                      <td className="px-4 py-2 font-medium text-slate-900">{res?.name || 'Inconnu'}</td>
                      <td className="px-4 py-2 text-slate-600">{charge.period || 'Octobre 2026'}</td>
                      <td className="px-4 py-2 text-slate-500 font-mono text-xs">
                        {new Date(charge.dueDate).toLocaleDateString('fr-MA')}
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
                          {charge.status === 'paid' ? 'Payé' : charge.status === 'overdue' ? 'En retard' : 'En attente'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-bold text-slate-900">
                        {currencyFormatter.format(charge.amount)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {charge.status === 'paid' ? (
                            <button
                              onClick={() => handleDirectQuittance(charge)}
                              disabled={directGeneratingChargeId === charge.id}
                              className="px-2.5 py-1 text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded transition-colors flex items-center gap-1 shrink-0"
                              title="Télécharger la quittance officielle au format PDF (Loi 18-00)"
                            >
                              <QuittanceIcon />
                              <span>{directGeneratingChargeId === charge.id ? 'Génération...' : 'Quittance PDF'}</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => openQuittanceModalForCharge(charge)}
                              className="px-2 py-0.5 text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-semibold rounded border border-emerald-200 shrink-0"
                              title="Valider le paiement et délivrer une quittance"
                            >
                              + Quittance
                            </button>
                          )}

                          <button
                            onClick={() => {
                              if (res) {
                                const mockInv = {
                                  id: `inv-${charge.id}`,
                                  syndicId: building.syndicId,
                                  buildingId: building.id,
                                  residentId: charge.residentId,
                                  invoiceNumber: `AF-2026-${charge.id.slice(-4)}`,
                                  totalAmount: charge.amount,
                                  status: charge.status === 'paid' ? 'paid' : 'unpaid',
                                  createdAt: charge.createdAt,
                                  dueDate: charge.dueDate,
                                  chargeIds: [charge.id],
                                };
                                generateInvoicePDF(mockInv as any, building, res, syndic);
                              }
                            }}
                            className="text-[11px] text-slate-500 hover:text-slate-800 underline px-1"
                            title="Télécharger l'avis d'appel de fonds"
                          >
                            Avis
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
          <div className="p-4 bg-slate-50 border-b border-slate-200">
            <h3 className="font-semibold text-slate-800 text-sm">File d'Attente des Justificatifs de Virement</h3>
            <p className="text-xs text-slate-500">
              Vérifiez les virements reçus des copropriétaires avant de délivrer la quittance officielle
            </p>
          </div>

          <div className="divide-y divide-slate-100">
            {paymentProofs.map((proof) => (
              <div key={proof.id} className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{proof.residentName}</span>
                    <span className="font-mono text-xs font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded">
                      Lot {proof.apartmentNumber}
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
                      {proof.status === 'pending' ? 'En attente de vérification' : proof.status}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      Banque émettrice : <strong>{proof.bankName}</strong>
                    </span>
                    <span>
                      Réf Virement : <strong className="font-mono">{proof.referenceNumber}</strong>
                    </span>
                    <span>
                      Date : {new Date(proof.submissionDate).toLocaleDateString('fr-MA')}
                    </span>
                  </div>

                  {proof.receiptNote && (
                    <p className="text-xs text-slate-500 italic mt-1">"{proof.receiptNote}"</p>
                  )}
                </div>

                {/* Amount and Verification Actions */}
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <span className="text-xs text-slate-400 block">Montant justifié</span>
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
                        Valider & Délivrer Quittance
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const reason = prompt('Motif du rejet :', 'Référence introuvable sur le relevé');
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
                        Rejeter
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {paymentProofs.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-xs">
                Aucun justificatif de virement en attente de vérification.
              </div>
            )}
          </div>
        </Card>
      )}

      {/* TAB 4: QUITTANCES CERTIFIÉES & GESTIONNAIRE LÉGAL (LOI 18-00 & 106-12) */}
      {activeTab === 'quittances' && (
        <div className="space-y-4">
          {/* Regulatory Header Banner */}
          <Card className="bg-gradient-to-r from-teal-900 via-teal-800 to-slate-900 text-white p-5 border-none shadow-md">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-teal-700/80 text-teal-100 px-2.5 py-0.5 rounded-full border border-teal-500/30">
                    Loi n° 18-00 & Loi n° 106-12 (Art. 18 bis)
                  </span>
                  <span className="text-[11px] text-teal-200">Reçu libératoire officiel</span>
                </div>
                <h3 className="text-lg font-bold tracking-tight">Registre Légal des Quittances de Copropriété</h3>
                <p className="text-xs text-teal-100/90 max-w-2xl leading-relaxed">
                  Conformément aux exigences réglementaires marocaines, toute quittance délivrée par le syndic décharge
                  libératoirement le copropriétaire pour la période certifiée et inclut obligatoirement la quote-part du Fonds
                  de Réserve pour travaux.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={() => openQuittanceModalNew()}
                  className="bg-white text-teal-900 hover:bg-teal-50 font-bold text-xs sm:text-sm shadow-sm flex items-center gap-1.5"
                >
                  <QuittanceIcon />
                  <span>+ Émettre une Quittance</span>
                </Button>
              </div>
            </div>

            {/* Quick KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-teal-700/60">
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-200 font-semibold uppercase block">Quittances Émises</span>
                <span className="text-lg font-bold font-mono text-white mt-0.5 block">{quittances.length}</span>
              </div>
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-200 font-semibold uppercase block">Cotisations Quittancées</span>
                <span className="text-lg font-bold font-mono text-white mt-0.5 block">
                  {currencyFormatter.format(totalQuittancesAmount)}
                </span>
              </div>
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-200 font-semibold uppercase block">Fonds de Réserve (Loi 106-12)</span>
                <span className="text-lg font-bold font-mono text-emerald-300 mt-0.5 block">
                  {currencyFormatter.format(totalReserveFundAmount)}
                </span>
              </div>
              <div className="bg-teal-950/40 p-2.5 rounded-lg border border-teal-600/30">
                <span className="text-[10px] text-teal-200 font-semibold uppercase block">Dernier Récépissé</span>
                <span className="text-xs font-mono font-bold text-teal-100 truncate mt-1 block">
                  {quittances[0]?.quittanceNumber || 'Aucun'}
                </span>
              </div>
            </div>
          </Card>

          {/* Search & Filter Toolbar */}
          <Card className="p-3 bg-white border border-slate-200">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <input
                  type="text"
                  value={quittanceSearch}
                  onChange={(e) => setQuittanceSearch(e.target.value)}
                  placeholder="Filtrer par copropriétaire, lot, N° quittance..."
                  className="w-full pl-3 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <select
                  value={quittanceFilterMethod}
                  onChange={(e) => setQuittanceFilterMethod(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700"
                >
                  <option value="all">Tous les modes de paiement</option>
                  <option value="virement">Virement bancaire</option>
                  <option value="cheque">Chèque bancaire</option>
                  <option value="versement">Versement agence / GAB</option>
                  <option value="cmi">Carte bancaire (CMI)</option>
                  <option value="especes">Espèces (Reçu caisse)</option>
                </select>

                {quittanceSearch && (
                  <button
                    onClick={() => setQuittanceSearch('')}
                    className="text-xs text-slate-500 hover:text-slate-800 underline px-1"
                  >
                    Effacer
                  </button>
                )}
              </div>
            </div>
          </Card>

          {/* Quittances Table */}
          <Card className="overflow-hidden border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
                <thead className="bg-slate-50 text-slate-600 text-left font-semibold">
                  <tr>
                    <th className="px-4 py-3">N° Quittance & Date</th>
                    <th className="px-4 py-3">Copropriétaire & CIN</th>
                    <th className="px-4 py-3">Lot & Tantièmes</th>
                    <th className="px-4 py-3">Période Réglée</th>
                    <th className="px-4 py-3">Ventilation Loi 106-12</th>
                    <th className="px-4 py-3 text-right">Montant Total</th>
                    <th className="px-4 py-3">Règlement & Traçabilité</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredQuittances.map((quit) => {
                    const apt = building.apartments.find((a) => a.id === quit.apartmentId);
                    const res = building.residents.find((r) => r.id === quit.residentId);
                    const reserveAmt = quit.reserveFundAmount !== undefined ? quit.reserveFundAmount : Math.round(quit.amount * 0.15);
                    const courantesAmt = quit.chargesCourantesAmount !== undefined ? quit.chargesCourantesAmount : (quit.amount - reserveAmt);

                    return (
                      <tr key={quit.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-mono font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded text-xs block w-fit">
                            {quit.quittanceNumber}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono mt-0.5 block">
                            Émise le {new Date(quit.createdAt).toLocaleDateString('fr-MA')}
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
                            Lot {quit.apartmentNumber}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {quit.tantiemes || apt?.tantiemes || 100} / 1000èmes
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800">{quit.periodCovered}</span>
                          <span className="text-[11px] text-slate-400 block font-mono">
                            Payé le {new Date(quit.paymentDate).toLocaleDateString('fr-MA')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-[11px] space-y-0.5 font-mono">
                            <div className="text-slate-600">Courant: {currencyFormatter.format(courantesAmt)}</div>
                            <div className="text-emerald-700 font-medium">Réserve (106-12): {currencyFormatter.format(reserveAmt)}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <span className="font-mono font-bold text-base text-teal-900 block">
                            {currencyFormatter.format(quit.amount)}
                          </span>
                          <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.2 rounded">
                            Libératoire
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs text-slate-700 font-medium capitalize">
                            {quit.paymentMethod === 'virement' ? 'Virement bancaire' : quit.paymentMethod === 'cheque' ? 'Chèque' : quit.paymentMethod}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono truncate max-w-[130px]" title={quit.referenceNumber || quit.bankName}>
                            {quit.bankName || 'Banque'} {quit.referenceNumber ? `· ${quit.referenceNumber}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setSelectedQuittanceForPreview(quit)}
                              className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200 font-medium transition-colors"
                              title="Visualiser le récépissé officiel avec cachet"
                            >
                              Aperçu
                            </button>
                            <button
                              onClick={() => generateQuittancePDF(quit, building, syndic, apt, res)}
                              className="px-2.5 py-1 text-xs bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded shadow-xs transition-colors flex items-center gap-1"
                              title="Télécharger le document officiel PDF réglementaire"
                            >
                              <QuittanceIcon />
                              <span>Télécharger PDF</span>
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
                        <p className="font-semibold text-sm mt-2 text-slate-700">Aucune quittance trouvée</p>
                        <p className="text-xs mt-1 text-slate-400">
                          {quittanceSearch
                            ? 'Aucune quittance ne correspond à vos filtres de recherche.'
                            : 'Délivrez votre première quittance certifiée conforme à la Loi 18-00.'}
                        </p>
                        <Button
                          onClick={() => openQuittanceModalNew()}
                          className="mt-3 text-xs bg-teal-700 hover:bg-teal-800"
                        >
                          + Émettre une Quittance
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

      {/* TAB 5: RECOUVREMENT & IMPAYÉS (LOI 18-00) */}
      {activeTab === 'impayes' && (
        <div className="space-y-4">
          <Card className="bg-rose-50 border border-rose-200 p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-rose-100 text-rose-700 rounded-lg shrink-0">
                <ShieldAlertIcon />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-rose-900 text-sm">
                  Procédure Légale de Recouvrement des Charges (Article 25 - Loi n° 18-00)
                </h4>
                <p className="text-xs text-rose-800 leading-relaxed">
                  En cas de non-paiement des charges de copropriété, le syndic est habilité à adresser une
                  <strong> Mise en Demeure par lettre recommandée avec accusé de réception</strong> accordant un
                  <strong> délai de 30 jours</strong>. À l'expiration de ce délai, le syndic peut demander au
                  Président du Tribunal de Première Instance une <strong>Ordonnance d'Injonction de Payer</strong> avec
                  exécution provisoire.
                </p>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden border border-slate-200">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-slate-800 text-sm">Copropriétaires Débiteurs</h3>
                <p className="text-xs text-slate-500">Générez la mise en demeure formelle en 1 clic</p>
              </div>
              <span className="text-xs font-mono font-bold text-rose-700 bg-rose-50 px-2 py-1 rounded">
                Total créances : {currencyFormatter.format(stats.overdueChargesTotal)}
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
                          Lot {item.apartmentNumber}
                        </span>
                        <span className="text-xs text-rose-700 font-semibold bg-rose-50 px-2 py-0.5 rounded">
                          {item.overdueCount} échéance(s) impayée(s)
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Ancienneté de la dette depuis le {new Date(item.oldestDate).toLocaleDateString('fr-MA')} ·
                        Tél : {resident?.phone || 'Non renseigné'}
                      </p>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <span className="text-xs text-slate-400 block">Total Dû</span>
                        <span className="font-mono font-bold text-base text-rose-700">
                          {currencyFormatter.format(item.totalOverdue)}
                        </span>
                      </div>

                      <Button
                        onClick={() => {
                          if (resident && apt) {
                            generateMiseEnDemeurePDF(resident, apt, building, item.totalOverdue, syndic);
                          } else {
                            alert('Informations du copropriétaire incomplètes.');
                          }
                        }}
                        className="text-xs bg-rose-700 hover:bg-rose-800 flex items-center gap-1.5"
                      >
                        <ShieldAlertIcon />
                        <span>Mise en Demeure (Art. 25)</span>
                      </Button>
                    </div>
                  </div>
                );
              })}

              {overdueResidents.length === 0 && (
                <div className="p-8 text-center text-slate-500 text-xs">
                  Aucun impayé constaté. Tous les copropriétaires sont à jour dans leurs cotisations.
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* MODAL 1: ADD TRANSACTION (COMPREHENSIVE LAW 18-00 COMPLIANCE) */}
      <Modal
        isOpen={isTrxModalOpen}
        onClose={() => {
          setIsTrxModalOpen(false);
          resetTrxForm();
        }}
        title="Nouvelle Opération Financière (Loi 18-00 & 106-12)"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              * Pièce justificative requise selon l'Art. 26 de la Loi 18-00
            </span>
            <div className="flex gap-2 ms-auto">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsTrxModalOpen(false);
                  resetTrxForm();
                }}
              >
                Annuler
              </Button>
              <Button
                onClick={handleSubmitTransaction}
                disabled={addTrxMutation.isPending}
                className="bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
              >
                {addTrxMutation.isPending ? 'Enregistrement...' : 'Valider & Enregistrer'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto px-1">
          {/* Section 1: Nature & Fund Allocation */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                1. Nature de l'opération
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
                  <span>Dépense / Décaissement (-)</span>
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
                  <span>Recette / Encaissement (+)</span>
                </button>
              </div>
            </div>

            {/* Fund Allocation (Loi 106-12) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                2. Affectation légale des fonds (Loi 18-00 & 106-12)
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
                    <span className="font-bold block">Compte Courant</span>
                    <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">
                      Dépenses ordinaires, gardiennage, électricité, menues réparations
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
                      <span>Fonds de Réserve</span>
                      <span className="bg-indigo-200 text-indigo-800 text-[9px] px-1 rounded font-mono">
                        Loi 106-12
                      </span>
                    </span>
                    <span className="text-[10px] text-slate-500 block leading-tight mt-0.5">
                      Gros travaux, étanchéité terrasse, réfection façade ou ascenseur
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Section 2: Montant, Date & Catégorie */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Montant net (MAD) *
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
                  className={`w-full px-3 py-2 border rounded-lg text-sm font-mono font-bold pr-12 ${
                    formErrors.amount ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                  }`}
                />
                <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-mono font-bold">
                  MAD
                </span>
              </div>
              {formErrors.amount && (
                <p className="text-[10px] text-rose-600 mt-1">{formErrors.amount}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Date comptable *
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
                Catégorie comptable *
              </label>
              <select
                value={trxCategory}
                onChange={(e) => setTrxCategory(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              >
                {trxType === 'expense' ? (
                  <>
                    <option value="maintenance">Maintenance courante & Dépannages</option>
                    <option value="elevator">Ascenseur & Équipements mécaniques</option>
                    <option value="salary">Salaires Concierge / Gardiennage</option>
                    <option value="utility">Électricité & Eau (Lydec/Redal/Amendis)</option>
                    <option value="cleaning">Nettoyage, Produits & Hygiène</option>
                    <option value="insurance">Assurance Multirisque Immeuble</option>
                    <option value="bank_fees">Frais bancaires & Tenue de compte</option>
                    <option value="legal">Honoraires contentieux & Recouvrement</option>
                    <option value="reserve">Gros travaux (Fonds de réserve)</option>
                    <option value="other">Autre charge diverse</option>
                  </>
                ) : (
                  <>
                    <option value="fees">Cotisations ordinaires de copropriété</option>
                    <option value="reserve">Appel de fonds exceptionnel / Réserve travaux</option>
                    <option value="reimbursement">Remboursement sinistre assurance</option>
                    <option value="other">Autre encaissement</option>
                  </>
                )}
              </select>
            </div>
          </div>

          {/* Section 3: Tiers Concerné (Prestataire ou Copropriétaire) */}
          <div className="p-3 bg-slate-50/75 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800">
                3. Tiers concerné ({trxType === 'expense' ? 'Bénéficiaire / Prestataire' : 'Copropriétaire émetteur'})
              </label>
              {trxType === 'expense' && (
                <span className="text-[10px] text-slate-500 font-mono">
                  Obligation fiscale marocaine : ICE exigé
                </span>
              )}
            </div>

            {trxType === 'expense' ? (
              <div className="space-y-2.5">
                {/* Provider Quick Picker */}
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">
                    Sélectionner un prestataire enregistré de l'immeuble :
                  </label>
                  <select
                    value={selectedPrestataireId}
                    onChange={(e) => handleSelectPrestataire(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                  >
                    <option value="">-- Autre / Nouveau prestataire --</option>
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
                      Nom / Raison sociale du prestataire *
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
                      ICE Prestataire (15 chiffres)
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
                {/* Apartment / Resident Quick Picker */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-1">
                      Lot de copropriété concerné :
                    </label>
                    <select
                      value={selectedApartmentId}
                      onChange={(e) => handleSelectApartment(e.target.value)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                    >
                      <option value="">-- Aucun lot spécifique (Recette générale) --</option>
                      {building.apartments.map((apt) => {
                        const res = building.residents.find((r) => r.id === (apt.ownerId || apt.tenantId));
                        return (
                          <option key={apt.id} value={apt.id}>
                            Lot {apt.number} ({res?.name || 'Copropriétaire'}) - {apt.tantiemes || 100} tantièmes
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Nom du copropriétaire / émetteur :
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

          {/* Section 4: Traçabilité & Pièce Justificative (Obligation Loi 18-00) */}
          <div className="p-3 bg-amber-50/50 border border-amber-200/80 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-amber-900">
                4. Pièce justificative comptable (Obligation Art. 26 Loi 18-00)
              </label>
              <span className="text-[10px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded font-medium">
                Traçabilité audit
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Type de pièce justificative *
                </label>
                <select
                  value={trxDocumentType}
                  onChange={(e) => setTrxDocumentType(e.target.value as any)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="facture">Facture Fournisseur / Prestataire</option>
                  <option value="quittance">Quittance officielle</option>
                  <option value="recu">Reçu / Décharge signée</option>
                  <option value="releve">Avis d'opéré / Relevé bancaire</option>
                  <option value="devis">Devis approuvé en AG</option>
                  <option value="autre">Autre document comptable</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  N° de Pièce / Facture *
                </label>
                <input
                  type="text"
                  value={trxInvoiceNumber}
                  onChange={(e) => {
                    setTrxInvoiceNumber(e.target.value);
                    if (formErrors.invoiceNumber) setFormErrors({ ...formErrors, invoiceNumber: '' });
                  }}
                  placeholder="Ex: FAC-2026-089 ou DECH-04"
                  className={`w-full px-3 py-1.5 border rounded-lg text-xs font-mono ${
                    formErrors.invoiceNumber ? 'border-rose-400 bg-rose-50' : 'border-slate-300'
                  }`}
                />
                {formErrors.invoiceNumber && (
                  <p className="text-[10px] text-rose-600 mt-0.5">{formErrors.invoiceNumber}</p>
                )}
              </div>
            </div>

            {/* Payment Method & Bank */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Mode de règlement *
                </label>
                <select
                  value={trxPaymentMethod}
                  onChange={(e) => setTrxPaymentMethod(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white"
                >
                  <option value="virement">Virement bancaire</option>
                  <option value="cheque">Chèque bancaire</option>
                  <option value="versement">Versement espèces à la banque</option>
                  <option value="cmi">Paiement Carte / CMI</option>
                  <option value="especes">Espèces (Menues dépenses)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  N° Chèque / Réf Virement
                </label>
                <input
                  type="text"
                  value={trxReference}
                  onChange={(e) => setTrxReference(e.target.value)}
                  placeholder="Ex: CHQ 894120 ou VIR-8841"
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Banque de l'opération
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

          {/* Section 5: Libellé & Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              5. Libellé de l'écriture comptable *
            </label>
            <input
              type="text"
              value={trxDesc}
              onChange={(e) => {
                setTrxDesc(e.target.value);
                if (formErrors.description) setFormErrors({ ...formErrors, description: '' });
              }}
              placeholder="Ex: Réparation pompe surpresseur d'eau selon devis voté en AG"
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
              6. Notes & Référence de Résolution d'AG (Optionnel)
            </label>
            <input
              type="text"
              value={trxNotes}
              onChange={(e) => setTrxNotes(e.target.value)}
              placeholder="Ex: Résolution N° 3 votée lors de l'Assemblée Générale Ordinaire du 15 Mars 2026"
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-xs"
            />
          </div>

          {/* Section 6: Live Balance Impact & Legal Check */}
          {(() => {
            const currentBal = fundType === 'reserve' ? stats.reserveFund : stats.balance;
            const numericAmt = parseFloat(trxAmount) || 0;
            const projBal = trxType === 'income' ? currentBal + numericAmt : currentBal - numericAmt;
            return (
              <div className="p-3 bg-teal-50/70 border border-teal-200 rounded-xl space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-teal-900">
                    Impact prévisionnel sur le {fundType === 'reserve' ? 'Fonds de Réserve' : 'Compte Courant'} :
                  </span>
                  <span className="font-mono font-bold text-slate-800">
                    Solde actuel : {currencyFormatter.format(currentBal)}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-teal-200/60 font-mono">
                  <span className={trxType === 'income' ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
                    Opération : {trxType === 'income' ? '+' : '-'}
                    {currencyFormatter.format(numericAmt)}
                  </span>
                  <span className="font-bold text-teal-900 text-sm">
                    Nouveau solde prévu : {currencyFormatter.format(projBal)}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      </Modal>

      {/* MODAL 1.B: TRANSACTION DETAIL & VOUCHER INSPECTION */}
      {selectedTrxForView && (
        <Modal
          isOpen={!!selectedTrxForView}
          onClose={() => setSelectedTrxForView(null)}
          title="Fiche d'Écriture Comptable (Loi 18-00)"
          footer={
            <div className="flex justify-between items-center w-full">
              <Button
                onClick={() => generateTransactionVoucherPDF(selectedTrxForView, building, syndic)}
                className="text-xs bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
              >
                <DocumentsIcon />
                <span>Télécharger Pièce Comptable PDF</span>
              </Button>
              <Button variant="secondary" onClick={() => setSelectedTrxForView(null)}>
                Fermer
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Top header badge */}
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
              <div>
                <span className="font-mono text-[11px] text-slate-400 block">
                  Identifiant écriture : {selectedTrxForView.id}
                </span>
                <span className="font-bold text-sm text-slate-900 mt-0.5 block">
                  {selectedTrxForView.description}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">
                  Montant
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

            {/* 2-Column details grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-400 uppercase">Affectation & Catégorie</p>
                <p className="font-medium text-slate-800">
                  Fonds :{' '}
                  <strong className="text-slate-900">
                    {selectedTrxForView.fundType === 'reserve' ? 'Fonds de Réserve (Loi 106-12)' : 'Compte Courant'}
                  </strong>
                </p>
                <p className="text-slate-600">
                  Catégorie :{' '}
                  {selectedTrxForView.category
                    ? CATEGORY_LABELS[selectedTrxForView.category] || selectedTrxForView.category
                    : 'Charges'}
                </p>
                <p className="text-slate-600">
                  Date : {new Date(selectedTrxForView.date).toLocaleDateString('fr-MA')}
                </p>
              </div>

              <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-400 uppercase">Justificatif & Règlement</p>
                <p className="font-medium text-slate-800 font-mono">
                  {selectedTrxForView.documentType
                    ? DOCUMENT_TYPE_LABELS[selectedTrxForView.documentType] || selectedTrxForView.documentType
                    : 'Pièce'}{' '}
                  : {selectedTrxForView.invoiceNumber ? `#${selectedTrxForView.invoiceNumber}` : 'Non spécifié'}
                </p>
                <p className="text-slate-600">
                  Mode :{' '}
                  {selectedTrxForView.paymentMethod
                    ? PAYMENT_METHOD_LABELS[selectedTrxForView.paymentMethod] || selectedTrxForView.paymentMethod
                    : 'Virement'}
                </p>
                <p className="text-slate-600 font-mono">
                  Réf / Chèque : {selectedTrxForView.reference || 'S/N'} · {selectedTrxForView.bankName || 'Banque'}
                </p>
              </div>
            </div>

            {/* Third party info */}
            {(selectedTrxForView.thirdPartyName || selectedTrxForView.thirdPartyIce || selectedTrxForView.lotNumber) && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-500 block">Tiers concerné :</span>
                  <span className="font-bold text-slate-800 text-sm">
                    {selectedTrxForView.thirdPartyName || 'Tiers'}
                  </span>
                </div>
                <div className="text-right">
                  {selectedTrxForView.thirdPartyIce && (
                    <span className="inline-block bg-white border border-slate-200 font-mono px-2 py-0.5 rounded text-[11px] text-slate-600">
                      ICE : {selectedTrxForView.thirdPartyIce}
                    </span>
                  )}
                  {selectedTrxForView.lotNumber && (
                    <span className="inline-block bg-teal-50 border border-teal-200 text-teal-800 font-medium px-2 py-0.5 rounded text-[11px]">
                      Lot {selectedTrxForView.lotNumber}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Notes */}
            {selectedTrxForView.notes && (
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg">
                <span className="text-[11px] font-semibold text-amber-900 block">
                  Observations & Résolution d'AG :
                </span>
                <p className="text-slate-700 mt-0.5 italic">{selectedTrxForView.notes}</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* MODAL 2: GENERATE MONTHLY CHARGES (WITH TANTIEMES) */}
      <Modal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
        title="Lancer un Appel de Fonds Général (Loi 18-00)"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsGenerateModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => generateChargesMutation.mutate()}>
              Générer pour tous les lots
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            Cette action génère les avis de cotisation pour l'ensemble des {building.apartments.length} lots
            de la résidence.
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Période concernée</label>
            <input
              type="text"
              value={periodName}
              onChange={(e) => setPeriodName(e.target.value)}
              placeholder="Ex: Novembre 2026 ou 4ème Trimestre 2026"
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
                  Calculer selon les tantièmes de copropriété (Loi 18-00)
                </span>
                <span className="text-[11px] text-teal-700 block">
                  La cotisation est calculée proportionnellement à la quote-part de chaque lot sur 1000 tantièmes.
                </span>
              </div>
            </label>

            {useTantiemes && (
              <div className="mt-2 pt-2 border-t border-teal-200">
                <label className="block text-xs font-semibold text-teal-900 mb-1">
                  Budget global mensuel à répartir (MAD)
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

      {/* MODAL 3: MOROCCAN QUITTANCE GENERATOR (LOI 18-00 & 106-12) */}
      <Modal
        isOpen={isQuittanceModalOpen}
        onClose={() => setIsQuittanceModalOpen(false)}
        title="Générateur de Quittance Libératoire (Loi n° 18-00 & 106-12)"
        footer={
          <div className="flex justify-between items-center w-full">
            <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
              Document officiel avec cachet du syndic & QR code d'intégrité
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setIsQuittanceModalOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={() => {
                  const numAmt = parseFloat(quittanceAmount);
                  if (!numAmt || numAmt <= 0) {
                    alert('Veuillez saisir un montant de cotisation valide.');
                    return;
                  }
                  if (!quittanceApartmentId) {
                    alert('Veuillez sélectionner un lot.');
                    return;
                  }

                  const apt = building.apartments.find((a) => a.id === quittanceApartmentId);
                  const res = building.residents.find((r) => r.id === quittanceResidentId);

                  const reserveAmt = Math.round(numAmt * (quittanceReserveRatio / 100));
                  const courantesAmt = numAmt - reserveAmt;

                  createQuittanceMutation.mutate({
                    chargeId: quittanceChargeId || `chg-${Date.now()}`,
                    residentId: quittanceResidentId || res?.id || 'res-1',
                    residentName: res?.name || 'Copropriétaire',
                    residentCin: quittanceResidentCin || res?.cin || 'AB123456',
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
                disabled={createQuittanceMutation.isPending}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold flex items-center gap-1.5"
              >
                <QuittanceIcon />
                <span>
                  {createQuittanceMutation.isPending ? 'Émission en cours...' : 'Délivrer & Télécharger PDF'}
                </span>
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* Header notice */}
          <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg flex items-start gap-2.5">
            <div className="p-1.5 bg-teal-600 text-white rounded shrink-0 mt-0.5">
              <QuittanceIcon />
            </div>
            <div className="text-xs text-teal-900 leading-relaxed">
              <span className="font-bold block">Conformité Loi 18-00 & 106-12 (Article 18 bis) :</span>
              Cette quittance officielle libère définitivement le copropriétaire pour la période indiquée. Le calcul intègre
              automatiquement la répartition obligatoire entre les <strong>charges courantes</strong> et le
              <strong> Fonds de Réserve pour travaux</strong>.
            </div>
          </div>

          {/* Section 1: Lot & Copropriétaire */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
              <span>1. Lot & Copropriétaire Redevable</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Lot / Appartement <span className="text-rose-500">*</span>
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
                      setQuittanceAmount(String(selectedApt.monthlyFees || building.monthlySyndicFees));
                    }
                  }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900"
                >
                  <option value="">Sélectionnez un lot...</option>
                  {building.apartments.map((a) => {
                    const res = building.residents.find((r) => r.apartmentId === a.id);
                    return (
                      <option key={a.id} value={a.id}>
                        Lot {a.number} — {res?.name || 'Copropriétaire'} ({a.tantiemes || 100}/1000 tantièmes)
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nom du Copropriétaire
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
                      {r.name} {r.cin ? `(CIN: ${r.cin})` : ''} {r.isOwner ? '— Copropriétaire' : '— Locataire'}
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
                <span>Tantièmes : </span>
                <strong className="text-teal-800">
                  {building.apartments.find((a) => a.id === quittanceApartmentId)?.tantiemes || 100} / 1000èmes
                </strong>
              </div>
              <div className="text-slate-600">
                <span>Résidence : </span>
                <strong className="text-slate-800">{building.name}</strong>
              </div>
            </div>
          </div>

          {/* Section 2: Période & Montant avec Ventilation Loi 106-12 */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center justify-between">
              <span>2. Période & Ventilation Financière</span>
              <span className="text-[10px] text-teal-700 font-semibold bg-teal-100/60 px-2 py-0.5 rounded">
                Loi 106-12 Art. 18 bis
              </span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Période Couverte <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={quittancePeriod}
                  onChange={(e) => setQuittancePeriod(e.target.value)}
                  placeholder="Ex: Octobre 2026 ou 4ème Trimestre 2026"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Montant Total Encaissé (MAD) <span className="text-rose-500">*</span>
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

            {/* Split breakdown calculator */}
            {parseFloat(quittanceAmount) > 0 && (
              <div className="p-3 bg-white border border-teal-200 rounded-lg space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-700">Ventilation des Charges :</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-500">Quote-part Fonds Réserve :</span>
                    {[10, 15, 20].map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setQuittanceReserveRatio(ratio)}
                        className={`px-2 py-0.5 text-[10px] rounded font-bold transition-colors ${
                          quittanceReserveRatio === ratio
                            ? 'bg-teal-700 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {ratio}% {ratio === 15 ? '(Légal)' : ''}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs font-mono">
                  <div className="bg-slate-50 p-2 rounded">
                    <span className="text-[11px] text-slate-500 block">Charges courantes ({100 - quittanceReserveRatio}%) :</span>
                    <span className="font-bold text-slate-800">
                      {currencyFormatter.format(
                        parseFloat(quittanceAmount) - Math.round(parseFloat(quittanceAmount) * (quittanceReserveRatio / 100))
                      )}
                    </span>
                  </div>
                  <div className="bg-emerald-50 p-2 rounded border border-emerald-100">
                    <span className="text-[11px] text-emerald-800 block">Fonds de Réserve Travaux ({quittanceReserveRatio}%) :</span>
                    <span className="font-bold text-emerald-900">
                      {currencyFormatter.format(
                        Math.round(parseFloat(quittanceAmount) * (quittanceReserveRatio / 100))
                      )}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Traçabilité du Règlement */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              3. Modalités & Traçabilité du Règlement
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mode de Paiement</label>
                <select
                  value={quittancePaymentMethod}
                  onChange={(e) => setQuittancePaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs bg-white text-slate-900"
                >
                  <option value="virement">Virement bancaire</option>
                  <option value="cheque">Chèque bancaire</option>
                  <option value="versement">Versement agence / GAB</option>
                  <option value="cmi">Carte bancaire (CMI)</option>
                  <option value="especes">Espèces (Reçu caisse)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Établissement Bancaire</label>
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
                  Réf. Virement / N° Chèque
                </label>
                <input
                  type="text"
                  value={quittanceReference}
                  onChange={(e) => setQuittanceReference(e.target.value)}
                  placeholder="Ex: VIR-84920 ou CHQ-001248"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded text-xs font-mono bg-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Date Effective d'Encaissement
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
                  Observations & Mentions
                </label>
                <input
                  type="text"
                  value={quittanceRemarks}
                  onChange={(e) => setQuittanceRemarks(e.target.value)}
                  placeholder="Mention particulière ou accord d'AG"
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
                Inscrire automatiquement l'écriture d'encaissement dans le journal comptable de la copropriété
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
          title={`Attestation Officielle — ${selectedQuittanceForPreview.quittanceNumber}`}
          footer={
            <div className="flex justify-between items-center w-full">
              <span className="text-xs text-slate-500 font-mono">
                Conforme Loi 18-00 · Délivré par le Syndic
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setSelectedQuittanceForPreview(null)}>
                  Fermer
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
                  <span>Télécharger le PDF Réglementaire</span>
                </Button>
              </div>
            </div>
          }
        >
          {/* Framed Certificate View */}
          <div className="p-6 bg-slate-50 border-2 border-teal-800/40 rounded-xl space-y-5 text-slate-800 shadow-inner">
            {/* National Header */}
            <div className="text-center pb-4 border-b-2 border-teal-800/20">
              <p className="text-[11px] font-bold tracking-widest text-teal-900 uppercase">
                ROYAUME DU MAROC  ·  SYNDICAT DES COPROPRIÉTAIRES
              </p>
              <h3 className="text-base font-extrabold text-teal-950 mt-1 uppercase tracking-tight">
                Quittance de Paiement des Charges de Copropriété
              </h3>
              <p className="text-[10px] text-slate-500 mt-0.5">
                En vertu de la Loi n° 18-00 relative au statut de la copropriété des immeubles bâtis (modifiée par la Loi n° 106-12)
              </p>
              <div className="inline-block bg-teal-100/70 border border-teal-300 text-teal-900 font-mono text-xs px-3 py-0.5 rounded font-bold mt-2">
                Réf: {selectedQuittanceForPreview.quittanceNumber}  ·  Émise le {new Date(selectedQuittanceForPreview.createdAt).toLocaleDateString('fr-MA')}
              </div>
            </div>

            {/* Entity Dual Columns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-teal-800 block text-[11px] uppercase">Copropriété & Syndic</span>
                <p className="font-bold text-slate-900">{building.name}</p>
                <p className="text-slate-600">{building.address}, {building.city}</p>
                <p className="text-slate-500 font-mono text-[11px]">Syndic: {syndic?.name || selectedQuittanceForPreview.syndicName}</p>
                <p className="text-slate-400 font-mono text-[10px]">RIB: {building.bankRib || '007 780 0001234567890123 45'}</p>
              </div>

              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-teal-800 block text-[11px] uppercase">Copropriétaire & Lot</span>
                <p className="font-bold text-slate-900">{selectedQuittanceForPreview.residentName}</p>
                <p className="text-slate-600 font-mono">Lot {selectedQuittanceForPreview.apartmentNumber} · {selectedQuittanceForPreview.tantiemes} / 1000èmes</p>
                <p className="text-slate-500 font-mono text-[11px]">CIN: {selectedQuittanceForPreview.residentCin || 'AB123456'}</p>
                <p className="text-slate-500 text-[11px]">Usage : Résidentiel</p>
              </div>
            </div>

            {/* Financial Details */}
            <div className="bg-white rounded border border-slate-200 overflow-hidden text-xs">
              <div className="bg-teal-900 text-white p-2 font-bold flex justify-between">
                <span>Désignation des charges (Loi 18-00 & 106-12)</span>
                <span>Montant Réglé</span>
              </div>
              <div className="p-3 space-y-2">
                <div className="flex justify-between items-center text-slate-700">
                  <span>1. Charges générales ordinaires ({selectedQuittanceForPreview.periodCovered})</span>
                  <span className="font-mono font-medium">
                    {currencyFormatter.format(
                      selectedQuittanceForPreview.chargesCourantesAmount ??
                        (selectedQuittanceForPreview.amount - Math.round(selectedQuittanceForPreview.amount * 0.15))
                    )}
                  </span>
                </div>
                <div className="flex justify-between items-center text-emerald-800">
                  <span>2. Provision obligatoire Fonds de Réserve (Loi 106-12 Art. 18 bis)</span>
                  <span className="font-mono font-semibold">
                    {currencyFormatter.format(
                      selectedQuittanceForPreview.reserveFundAmount ?? Math.round(selectedQuittanceForPreview.amount * 0.15)
                    )}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-slate-900 text-sm">
                  <span>TOTAL REÇU ET QUITTANCÉ :</span>
                  <span className="font-mono text-teal-900 text-base">
                    {currencyFormatter.format(selectedQuittanceForPreview.amount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Release Mention */}
            <p className="text-[11px] text-slate-600 italic bg-amber-50/70 p-2.5 rounded border border-amber-200">
              « Le Syndic soussigné donne quittance libératoire au copropriétaire pour ladite période. Cette attestation
              justifie de la régularité des cotisations au regard du Syndicat des Copropriétaires. »
            </p>

            {/* Stamp and Seal */}
            <div className="flex justify-between items-end pt-2">
              <div className="text-[10px] text-slate-400 font-mono">
                <div>Hash Sécurité : {selectedQuittanceForPreview.id}</div>
                <div>Fait à {building.city}, le {new Date().toLocaleDateString('fr-MA')}</div>
              </div>

              {/* Stamp Circle */}
              <div className="w-24 h-24 rounded-full border-2 border-dashed border-teal-700 flex flex-col items-center justify-center text-teal-800 font-mono text-[8px] text-center p-1 bg-teal-50/40">
                <span className="font-bold text-[7px]">SYNDICAT COPRO</span>
                <span className="font-extrabold text-[9px] text-teal-900">CERTIFIÉ</span>
                <span className="font-bold text-[8px]">CONFORME</span>
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
