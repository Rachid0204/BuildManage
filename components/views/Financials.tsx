import BillingFailures from './BillingFailures';
import React, { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Building, Charge, Invoice, Quittance, Syndic, Transaction } from '../../types';
import OpeningBalancesBanner from './finance/OpeningBalancesBanner';
import FinanceActionBar, { FinanceMoreMenu } from './finance/FinanceActionBar';
import FinanceTodoPanel from './finance/FinanceTodoPanel';
import FinanceKpiCards from './finance/FinanceKpiCards';
import FinanceTabBar from './finance/FinanceTabBar';
import TransactionsTab from './finance/tabs/TransactionsTab';
import ChargesTab from './finance/tabs/ChargesTab';
import VerificationsTab from './finance/tabs/VerificationsTab';
import QuittancesTab from './finance/tabs/QuittancesTab';
import OverdueTab from './finance/tabs/OverdueTab';
import TransactionFormModal, { type TransactionModalRequest } from './finance/modals/TransactionFormModal';
import TransactionDetailModal from './finance/modals/TransactionDetailModal';
import GenerateChargesModal, { type GenerateChargesModalRequest } from './finance/modals/GenerateChargesModal';
import RecordPaymentModal, { type RecordPaymentModalRequest } from './finance/modals/RecordPaymentModal';
import QuittancePreviewModal from './finance/modals/QuittancePreviewModal';
import FundTransferModal from './finance/modals/FundTransferModal';
import ReverseExpenseModal from './finance/modals/ReverseExpenseModal';
import ReversePaymentModal, { type ReversePaymentModalRequest } from './finance/modals/ReversePaymentModal';
import OpeningArrearsModal from './finance/modals/OpeningArrearsModal';
import PeriodLockModal from './finance/modals/PeriodLockModal';
import ArchivedItemsModal from './finance/modals/ArchivedItemsModal';
import { PayInvoiceModal, VoidInvoiceModal, type PayInvoiceModalRequest } from './finance/modals/InvoiceModals';
import { buildFinanceTodos } from './finance/financeTodos';
import {
  findReversiblePayments,
  formatLedgerCsv,
  formatStatementsCsv,
} from './finance/financeReportExport';
import { downloadTextFile, useFinancialReport } from './finance/useFinancialReport';
import { FinancialsIcon } from '../icons/IconComponents';
import {
  getChargesForBuilding,
  getInvoicesForBuilding,
  getPaymentProofsForBuilding,
  getPrestatairesForBuilding,
  getQuittancesForBuilding,
  type UnmatchedBankCsvRow,
} from '../../firebase/services';
import { exportAnnualRepartitionPDF } from '../../services/pdfOnDemand';
import { todayCasablancaIsoDate } from '../../shared/moroccoDate';
import Loading from '../common/Loading';
import { useToast } from '../common/Toast';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../hooks/useI18n';
import { currencyFormatter, type FinanceTabType } from './finance/financeConstants';
import {
  computeAgingBuckets,
  computeAvailableFiscalYears,
  computeFinanceOverviewStats,
  computeHasBillableLots,
  groupOverdueChargesByResident,
} from './finance/financeSelectors';

interface FinancialsProps {
  building: Building;
  syndic?: Syndic;
  onAddTransaction?: () => void;
  onGenerateCharges?: () => void;
}

const FinancialsView: React.FC<FinancialsProps> = ({ building, syndic }) => {
  const { tr, isAr } = useI18n();
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const nonceRef = useRef(0);
  const nextNonce = () => {
    nonceRef.current += 1;
    return nonceRef.current;
  };

  const managed = ['admin', 'syndic'].includes(userProfile?.role || '');
  const isAdmin = userProfile?.role === 'admin';

  const [activeTab, setActiveTab] = useState<FinanceTabType>('charges');
  const [filterFund, setFilterFund] = useState<'all' | 'courant' | 'reserve'>('all');
  const [selectedFiscalYear, setSelectedFiscalYear] = useState<number>(() => new Date().getFullYear());
  const [showVoidedQuittances, setShowVoidedQuittances] = useState(false);
  const [unmatchedCsvRows, setUnmatchedCsvRows] = useState<UnmatchedBankCsvRow[]>([]);

  // Modal trigger requests
  const [trxModalRequest, setTrxModalRequest] = useState<TransactionModalRequest>(null);
  const [selectedTrxForView, setSelectedTrxForView] = useState<Transaction | null>(null);
  const [reverseExpenseTarget, setReverseExpenseTarget] = useState<Transaction | null>(null);
  const [reversePaymentRequest, setReversePaymentRequest] = useState<ReversePaymentModalRequest | null>(null);
  const [generateChargesRequest, setGenerateChargesRequest] = useState<GenerateChargesModalRequest>(null);
  const [recordPaymentRequest, setRecordPaymentRequest] = useState<RecordPaymentModalRequest>(null);
  const [selectedQuittanceForPreview, setSelectedQuittanceForPreview] = useState<Quittance | null>(null);
  const [transferModalState, setTransferModalState] = useState<{ open: boolean; nonce: number }>({
    open: false,
    nonce: 0,
  });
  const [openingArrearsModal, setOpeningArrearsModal] = useState<{ open: boolean; nonce: number }>({
    open: false,
    nonce: 0,
  });
  const [periodLockModal, setPeriodLockModal] = useState<{ open: boolean; nonce: number }>({
    open: false,
    nonce: 0,
  });
  const [archivedModalOpen, setArchivedModalOpen] = useState(false);
  const [payInvoiceRequest, setPayInvoiceRequest] = useState<PayInvoiceModalRequest>(null);
  const [voidInvoiceTarget, setVoidInvoiceTarget] = useState<Invoice | null>(null);

  // Building-level queries
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

  const { data: financialReport, refetch: refetchFinancialReport } = useFinancialReport(building.id);

  // Shared derived overview selectors
  const availableFiscalYears = useMemo(() => computeAvailableFiscalYears(charges), [charges]);
  const stats = useMemo(
    () => computeFinanceOverviewStats(building, charges, paymentProofs),
    [building, charges, paymentProofs],
  );
  const overdueResidents = useMemo(
    () => groupOverdueChargesByResident(charges, building, tr('Copropriétaire', 'مالك مشترك')),
    [charges, building, tr],
  );
  const agingBuckets = useMemo(() => computeAgingBuckets(charges), [charges]);
  const activeQuittancesCount = useMemo(
    () => quittances.filter((q) => !q.voidedAt).length,
    [quittances],
  );
  const currentMonthPeriod = useMemo(() => todayCasablancaIsoDate().slice(0, 7), []);
  const hasBillableLots = useMemo(() => computeHasBillableLots(building), [building]);

  const reversiblePayments = useMemo(
    () => findReversiblePayments(building.financials?.transactions || []),
    [building.financials?.transactions],
  );

  const archivedCount = useMemo(() => {
    const arch = financialReport?.archives;
    return (
      (arch?.apartments?.length || 0) +
      (arch?.residents?.length || 0) +
      (arch?.prestataires?.length || 0)
    );
  }, [financialReport?.archives]);

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

  // Shared modal openers & export handlers
  const openExpenseModal = () => setTrxModalRequest({ mode: 'expense', nonce: nextNonce() });
  const openIncomeModal = () => setTrxModalRequest({ mode: 'income', nonce: nextNonce() });
  const openChargeGeneration = (period?: string) =>
    setGenerateChargesRequest({ period, nonce: nextNonce() });
  const openQuittanceModalNew = () => setRecordPaymentRequest({ kind: 'new', nonce: nextNonce() });
  const openQuittanceModalForCharge = (
    charge: Charge,
    prefill?: { amount?: number; reference?: string; bankDate?: string; remarks?: string },
  ) =>
    setRecordPaymentRequest({
      kind: 'charge',
      nonce: nextNonce(),
      charge,
      prefill,
    });
  const openTransferModal = () => setTransferModalState({ open: true, nonce: nextNonce() });

  const ensureLatestReport = async () => {
    const res = await refetchFinancialReport({ throwOnError: true });
    return res.data;
  };

  const handleExportStatementsCsv = async () => {
    try {
      const report = await ensureLatestReport();
      const csvText = formatStatementsCsv(report?.statements || [], isAr);
      downloadTextFile(`situation-coproprietaires-${building.id}.csv`, csvText);
      showToast(tr('Export CSV téléchargé.', 'تم تحميل ملف CSV.'), 'success');
    } catch (err: any) {
      showToast(err?.message || tr('Export impossible.', 'تعذر التصدير.'), 'error');
    }
  };

  const handleExportLedgerCsv = async () => {
    try {
      const report = await ensureLatestReport();
      const csvText = formatLedgerCsv(report?.ledger || [], isAr);
      downloadTextFile(`historique-operations-${building.id}.csv`, csvText);
      showToast(tr('Export CSV téléchargé.', 'تم تحميل ملف CSV.'), 'success');
    } catch (err: any) {
      showToast(err?.message || tr('Export impossible.', 'تعذر التصدير.'), 'error');
    }
  };

  const handleExportFullJson = async () => {
    try {
      const report = await ensureLatestReport();
      downloadTextFile(
        `sauvegarde-immeuble-${building.id}.json`,
        JSON.stringify(report, null, 2),
        'application/json;charset=utf-8',
      );
      showToast(tr('Sauvegarde JSON téléchargée.', 'تم تحميل النسخة الاحتياطية JSON.'), 'success');
    } catch (err: any) {
      showToast(err?.message || tr('Export impossible.', 'تعذر التصدير.'), 'error');
    }
  };

  if (loadingCharges || loadingProofs || loadingQuittances) {
    return <Loading message={tr('Chargement des données financières...', 'جاري تحميل البيانات المالية...')} />;
  }

  return (
    <div className="space-y-6">
      <OpeningBalancesBanner key={building.id} building={building} />
      <BillingFailures key={`billing-${building.id}`} building={building} />

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FinancialsIcon />
            <span>{tr(`Finances — ${building.name}`, `المالية — ${building.name}`)}</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {tr(
              "Suivez l'argent de la copropriété : ce qui est dû, payé et dépensé.",
              'تابع مالية الملكية المشتركة: المستحقات، المدفوعات والمصاريف.',
            )}
          </p>
        </div>
        <FinanceMoreMenu
          managed={managed}
          isAdmin={isAdmin}
          archivedCount={archivedCount}
          onRecordMiscIncome={openIncomeModal}
          onTransferFunds={openTransferModal}
          onOpenOpeningArrears={() => setOpeningArrearsModal({ open: true, nonce: nextNonce() })}
          onOpenPeriodLock={() => setPeriodLockModal({ open: true, nonce: nextNonce() })}
          onOpenArchivedItems={() => setArchivedModalOpen(true)}
          onExportStatementsCsv={handleExportStatementsCsv}
          onExportLedgerCsv={handleExportLedgerCsv}
          onExportAnnualPdf={() =>
            exportAnnualRepartitionPDF(
              building,
              syndic,
              charges,
              quittances,
              selectedFiscalYear,
            )
          }
          onExportFullJson={handleExportFullJson}
          selectedFiscalYear={selectedFiscalYear}
          availableFiscalYears={availableFiscalYears}
          onChangeFiscalYear={setSelectedFiscalYear}
        />
      </div>

      {/* Primary Task Buttons */}
      <FinanceActionBar
        onRecordPayment={openQuittanceModalNew}
        onRecordExpense={openExpenseModal}
        onIssueMonthlyCharges={() => openChargeGeneration()}
      />

      {/* Actionable 'What to do now' Panel */}
      <FinanceTodoPanel
        todos={financeTodos}
        formatCurrency={(n) => currencyFormatter.format(n)}
        onVerifyTransfers={() => setActiveTab('verifications')}
        onChaseOverdue={() => setActiveTab('impayes')}
        onIssueCharges={(period) => openChargeGeneration(period)}
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
        activeQuittancesCount={activeQuittancesCount}
        overdueResidentsCount={overdueResidents.length}
      />

      {activeTab === 'transactions' && (
        <TransactionsTab
          building={building}
          syndic={syndic}
          filterFund={filterFund}
          onChangeFilterFund={setFilterFund}
          onOpenExpenseModal={openExpenseModal}
          onOpenTransferModal={openTransferModal}
          onSelectTransaction={setSelectedTrxForView}
        />
      )}

      {activeTab === 'charges' && (
        <ChargesTab
          building={building}
          syndic={syndic}
          charges={charges}
          statements={financialReport?.statements || []}
          invoices={invoices}
          quittances={quittances}
          onOpenChargeGeneration={() => openChargeGeneration()}
          onOpenNewPayment={openQuittanceModalNew}
          onOpenPaymentForCharge={(charge) => openQuittanceModalForCharge(charge)}
          onOpenPayInvoice={(invoice, remaining) => setPayInvoiceRequest({ invoice, remaining })}
          onOpenVoidInvoice={(invoice) => setVoidInvoiceTarget(invoice)}
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
          reversiblePayments={reversiblePayments}
          onReversePayment={setReversePaymentRequest}
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

      {/* Colocated Modals */}
      <TransactionFormModal
        building={building}
        prestataires={prestataires}
        stats={stats}
        request={trxModalRequest}
        onClose={() => setTrxModalRequest(null)}
      />

      <TransactionDetailModal
        building={building}
        syndic={syndic}
        transaction={selectedTrxForView}
        onClose={() => setSelectedTrxForView(null)}
        onRequestReverseExpense={(trx) => setReverseExpenseTarget(trx)}
        reversiblePayments={reversiblePayments}
        onRequestReversePayment={(req) => setReversePaymentRequest(req)}
      />

      <GenerateChargesModal
        building={building}
        charges={charges}
        request={generateChargesRequest}
        onClose={() => setGenerateChargesRequest(null)}
      />

      <RecordPaymentModal
        building={building}
        syndic={syndic}
        charges={charges}
        request={recordPaymentRequest}
        onClose={() => setRecordPaymentRequest(null)}
      />

      <QuittancePreviewModal
        building={building}
        syndic={syndic}
        quittance={selectedQuittanceForPreview}
        onClose={() => setSelectedQuittanceForPreview(null)}
        reversibleSummary={
          selectedQuittanceForPreview?.paymentId
            ? reversiblePayments.get(selectedQuittanceForPreview.paymentId)
            : undefined
        }
        onRequestReversePayment={(req) => setReversePaymentRequest(req)}
      />

      <FundTransferModal
        building={building}
        stats={stats}
        isOpen={transferModalState.open}
        openNonce={transferModalState.nonce}
        onClose={() => setTransferModalState((prev) => ({ ...prev, open: false }))}
      />

      <ReverseExpenseModal
        building={building}
        target={reverseExpenseTarget}
        onClose={() => setReverseExpenseTarget(null)}
        onReversed={() => {
          setReverseExpenseTarget(null);
          setSelectedTrxForView(null);
        }}
      />

      <ReversePaymentModal
        building={building}
        request={reversePaymentRequest}
        onClose={() => setReversePaymentRequest(null)}
        onReversed={() => {
          setSelectedQuittanceForPreview(null);
          setSelectedTrxForView(null);
        }}
      />

      <OpeningArrearsModal
        building={building}
        isOpen={openingArrearsModal.open}
        openNonce={openingArrearsModal.nonce}
        onClose={() => setOpeningArrearsModal((prev) => ({ ...prev, open: false }))}
      />

      <PeriodLockModal
        building={building}
        closedPeriods={financialReport?.closedPeriods || {}}
        isOpen={periodLockModal.open}
        openNonce={periodLockModal.nonce}
        onClose={() => setPeriodLockModal((prev) => ({ ...prev, open: false }))}
      />

      <ArchivedItemsModal
        building={building}
        archives={financialReport?.archives}
        isOpen={archivedModalOpen}
        onClose={() => setArchivedModalOpen(false)}
      />

      <PayInvoiceModal
        building={building}
        request={payInvoiceRequest}
        onClose={() => setPayInvoiceRequest(null)}
      />

      <VoidInvoiceModal
        building={building}
        target={voidInvoiceTarget}
        onClose={() => setVoidInvoiceTarget(null)}
      />
    </div>
  );
};

export default FinancialsView;
