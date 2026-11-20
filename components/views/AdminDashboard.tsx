import React, { Suspense, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { HelpCircle, LogOut } from 'lucide-react';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import LanguageToggle from '../common/LanguageToggle';
import AdminGatewaysTab from './admin/AdminGatewaysTab';
import AdminCommercialTab from './admin/AdminCommercialTab';
import AdminAuditWebhooksTab from './admin/AdminAuditWebhooksTab';
import {
  escapeCsvCell,
  getCasablancaMonthKey,
  getCashChannelLabel,
  getDaysRemaining,
  getMethodBadgeMeta,
  parseExpiryMs,
} from './admin/adminBillingHelpers';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';
import { useI18n } from '../../hooks/useI18n';
import {
  adminArchiveCabinet,
  adminRestoreCabinet,
  getAdminBillingConfig,
  getAllSyndicsForAdmin,
  getSubscriptionBankTransferRequests,
  getSubscriptionPayments,
  openAuthenticatedUpload,
  recordSubscriptionPayment,
  remoteMutation,
  reviewSubscriptionBankTransfer,
  saveSyndic,
  sendCabinetRenewalReminder,
  syncAllSharedStateFromServer,
  voidSubscriptionPayment,
} from '../../firebase/services';
import { generateSubscriptionInvoicePDF } from '../../services/pdfOnDemand';
import { generateSecureRandomDigits } from '../../utils/security';
import {
  PLANS,
  PLAN_CATALOG,
  countActiveBuildings,
  getEffectiveSubscriptionStatus,
  getGraceDaysRemaining,
  isInGracePeriod,
} from '../../utils/subscriptionPolicy';
import type {
  SubscriptionBankTransferRequest,
  SubscriptionPayment,
  SubscriptionPaymentMethod,
  SubscriptionPlan,
  SubscriptionStatus,
  Syndic,
} from '../../types';
import {
  BuildingsIcon,
  ResidentsIcon,
  FinancialsIcon,
  PlusIcon,
  TrashIcon,
} from '../icons/IconComponents';

type AdminTab = 'cabinets' | 'reports' | 'billing' | 'commercial' | 'audit';
type StatusFilter = 'all' | SubscriptionStatus | 'archived';
type PlanFilter = 'all' | SubscriptionPlan;
type QueueFilter = 'all' | 'virement' | 'cash';

const AdminHelpDrawer = React.lazy(() => import('../help/HelpDrawer'));

const AdminDashboard: React.FC = () => {
  const { userProfile, logout } = useAuth();
  const { t, tr, language } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<AdminTab>('cabinets');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [cabinetSearch, setCabinetSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>('all');
  const [includeVoidedPayments, setIncludeVoidedPayments] = useState(false);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');

  // Manage Cabinet Modal State (Profile + Subscription + Counter Payment + Archive)
  const [selectedSyndic, setSelectedSyndic] = useState<Syndic | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editIce, setEditIce] = useState('');
  const [editRc, setEditRc] = useState('');
  const [editTaxId, setEditTaxId] = useState('');
  const [editPlan, setEditPlan] = useState<SubscriptionPlan>('professional');
  const [editStatus, setEditStatus] = useState<SubscriptionStatus>('active');
  const [editExpiry, setEditExpiry] = useState('');
  const [subscriptionMethod, setSubscriptionMethod] =
    useState<SubscriptionPaymentMethod>('cash');
  const [subscriptionReference, setSubscriptionReference] = useState('');
  const [subscriptionMonths, setSubscriptionMonths] = useState(1);
  const [subscriptionPromoCode, setSubscriptionPromoCode] = useState('');
  const [subscriptionAgencyLocation, setSubscriptionAgencyLocation] = useState('');
  const [subscriptionNotes, setSubscriptionNotes] = useState('');
  const [lastRecordedPayment, setLastRecordedPayment] =
    useState<SubscriptionPayment | null>(null);
  const [subscriptionMessage, setSubscriptionMessage] = useState('');
  const [subscriptionError, setSubscriptionError] = useState('');
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);

  // Void Payment Modal State
  const [voidTarget, setVoidTarget] = useState<SubscriptionPayment | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');

  // Bank Transfer & Cash Requests Review State
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] =
    useState<SubscriptionBankTransferRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [requestActionMessage, setRequestActionMessage] = useState('');
  const [requestActionError, setRequestActionError] = useState('');
  const [showReviewedRequests, setShowReviewedRequests] = useState(false);

  // Dunning Reminder State
  const [busyReminderId, setBusyReminderId] = useState<string | null>(null);
  const [reminderFeedback, setReminderFeedback] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Create New Syndic Cabinet Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newCabinetName, setNewCabinetName] = useState('');
  const [newManagerName, setNewManagerName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState(
    () => `Syndik-${generateSecureRandomDigits(6)}!`,
  );
  const [newPhone, setNewPhone] = useState('+212 6 00 00 00 00');
  const [newCity, setNewCity] = useState('Casablanca');
  const [newPlan, setNewPlan] = useState<SubscriptionPlan>('professional');
  const [newBuildingName, setNewBuildingName] = useState('');
  const [newBuildingAddress, setNewBuildingAddress] = useState('');
  const [newApartmentsCount, setNewApartmentsCount] = useState(8);
  const [newMonthlyFees, setNewMonthlyFees] = useState(250);
  const [createError, setCreateError] = useState('');

  const {
    data: syndics = [],
    isFetching: isFetchingSyndics,
    refetch: refetchSyndics,
  } = useQuery({
    queryKey: ['syndics'],
    queryFn: getAllSyndicsForAdmin,
    staleTime: 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const {
    data: subscriptionPayments = [],
    isFetching: isFetchingPayments,
    refetch: refetchPayments,
  } = useQuery({
    queryKey: ['subscriptionPayments'],
    queryFn: getSubscriptionPayments,
    staleTime: 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const {
    data: transferRequests = [],
    isFetching: isFetchingRequests,
    refetch: refetchRequests,
  } = useQuery({
    queryKey: ['subscriptionBankRequests'],
    queryFn: () => getSubscriptionBankTransferRequests(),
    staleTime: 1000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
  });

  const {
    data: adminBillingConfig,
    isFetching: isFetchingBillingConfig,
    refetch: refetchBillingConfig,
  } = useQuery({
    queryKey: ['adminBillingConfig'],
    queryFn: getAdminBillingConfig,
    staleTime: 10_000,
  });

  const graceDays = adminBillingConfig?.commercialPolicy?.gracePeriodDays ?? 0;

  const isFetching =
    isFetchingSyndics ||
    isFetchingPayments ||
    isFetchingRequests ||
    isFetchingBillingConfig;
  const refetchAll = async () => {
    await syncAllSharedStateFromServer(true).catch(() => {});
    await Promise.all([
      refetchSyndics(),
      refetchPayments(),
      refetchRequests(),
      refetchBillingConfig(),
    ]);
  };

  const updateSyndicMutation = useMutation({
    mutationFn: saveSyndic,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setSelectedSyndic(null);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: adminArchiveCabinet,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setArchiveConfirmId(null);
      if (selectedSyndic?.id === updated.id) {
        setSelectedSyndic((prev) =>
          prev ? { ...prev, archivedAt: updated.archivedAt } : null,
        );
      }
    },
  });

  const restoreMutation = useMutation({
    mutationFn: adminRestoreCabinet,
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setArchiveConfirmId(null);
      if (selectedSyndic?.id === updated.id) {
        setSelectedSyndic((prev) =>
          prev ? { ...prev, archivedAt: undefined } : null,
        );
      }
    },
  });

  const voidPaymentMutation = useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) =>
      voidSubscriptionPayment(paymentId, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscriptionPayments'] }),
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
      ]);
      const refreshed = await refetchSyndics();
      const updatedCab = (refreshed.data || []).find(
        (s) => s.id === selectedSyndic?.id,
      );
      if (updatedCab) {
        setSelectedSyndic(updatedCab);
        setEditPlan(updatedCab.subscriptionPlan);
        setEditStatus(updatedCab.subscriptionStatus);
        setEditExpiry(
          updatedCab.subscriptionExpiry
            ? new Date(updatedCab.subscriptionExpiry).toISOString().split('T')[0]
            : '',
        );
      }
      setVoidTarget(null);
      setVoidReason('');
      setVoidError('');
    },
    onError: (err: unknown) => {
      setVoidError(
        err instanceof Error
          ? err.message
          : tr("Impossible d'annuler le paiement.", 'تعذر إلغاء الدفع.'),
      );
    },
  });

  const createSyndicMutation = useMutation({
    mutationFn: async () => {
      if (newPassword.length < 10)
        throw new Error(
          tr(
            'Mot de passe : 10 caractères minimum.',
            'كلمة المرور: عشرة أحرف على الأقل.',
          ),
        );
      if (newBuildingName.trim() && !newBuildingAddress.trim())
        throw new Error(
          tr(
            "L'adresse de l'immeuble initial est obligatoire.",
            'عنوان العمارة الأولية مطلوب.',
          ),
        );
      return remoteMutation('adminCreateCabinet', [
        {
          name: newCabinetName.trim(),
          email: newEmail.trim(),
          managerName: newManagerName.trim(),
          password: newPassword,
          phone: newPhone.trim(),
          city: newCity.trim(),
          plan: newPlan,
          initialBuilding: newBuildingName.trim()
            ? {
                name: newBuildingName.trim(),
                address: newBuildingAddress.trim(),
                apartmentsCount: Number(newApartmentsCount),
                monthlyFees: Number(newMonthlyFees),
              }
            : undefined,
        },
      ]);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setIsCreateModalOpen(false);
      setNewCabinetName('');
      setNewManagerName('');
      setNewEmail('');
      setNewBuildingName('');
      setNewBuildingAddress('');
      setCreateError('');
    },
    onError: (err: unknown) => {
      setCreateError(
        err instanceof Error
          ? err.message
          : tr(
              'Erreur lors de la création du cabinet.',
              'حدث خطأ أثناء إنشاء المكتب.',
            ),
      );
    },
  });

  const activeSyndics = useMemo(
    () => syndics.filter((s) => !s.archivedAt),
    [syndics],
  );
  const archivedSyndics = useMemo(
    () => syndics.filter((s) => Boolean(s.archivedAt)),
    [syndics],
  );

  const syndicMap = useMemo(() => {
    const map = new Map<string, Syndic>();
    for (const s of syndics) map.set(s.id, s);
    return map;
  }, [syndics]);

  const totalBuildings = useMemo(
    () =>
      activeSyndics.reduce(
        (acc, s) => acc + countActiveBuildings(s.buildings),
        0,
      ),
    [activeSyndics],
  );

  const totalResidents = useMemo(
    () =>
      activeSyndics.reduce(
        (acc, s) =>
          acc +
          (s.buildings || []).reduce(
            (bAcc, b) => bAcc + (b.residents?.length || 0),
            0,
          ),
        0,
      ),
    [activeSyndics],
  );

  const statusBreakdown = useMemo(() => {
    const counts: Record<SubscriptionStatus | 'archived', number> = {
      active: 0,
      trialing: 0,
      expired: 0,
      cancelled: 0,
      archived: archivedSyndics.length,
    };
    for (const s of activeSyndics) {
      counts[getEffectiveSubscriptionStatus(s, Date.now(), graceDays)] += 1;
    }
    return counts;
  }, [activeSyndics, archivedSyndics.length, graceDays]);

  const totalMrr = useMemo(
    () =>
      activeSyndics.reduce(
        (acc, s) =>
          getEffectiveSubscriptionStatus(s, Date.now(), graceDays) === 'active'
            ? acc + (PLANS[s.subscriptionPlan]?.price || PLANS.professional.price)
            : acc,
        0,
      ),
    [activeSyndics, graceDays],
  );

  const activePayments = useMemo(
    () => subscriptionPayments.filter((p) => !p.voidedAt),
    [subscriptionPayments],
  );

  const currentMonthKey = getCasablancaMonthKey();

  const totalCollected = useMemo(
    () => activePayments.reduce((acc, p) => acc + Number(p.amount || 0), 0),
    [activePayments],
  );

  const collectedThisMonth = useMemo(
    () =>
      activePayments
        .filter((p) => String(p.createdAt || '').slice(0, 7) === currentMonthKey)
        .reduce((acc, p) => acc + Number(p.amount || 0), 0),
    [activePayments, currentMonthKey],
  );

  const expiringSoonSyndics = useMemo(
    () =>
      activeSyndics
        .filter((s) => {
          const eff = getEffectiveSubscriptionStatus(s, Date.now(), graceDays);
          if (eff !== 'active' && eff !== 'trialing') return false;
          const days = getDaysRemaining(s.subscriptionExpiry);
          return days !== null && days >= -graceDays && days <= 15;
        })
        .sort(
          (a, b) =>
            (getDaysRemaining(a.subscriptionExpiry) ?? 999) -
            (getDaysRemaining(b.subscriptionExpiry) ?? 999),
        ),
    [activeSyndics, graceDays],
  );

  const planSummary = useMemo(() => {
    const summary: Record<
      SubscriptionPlan,
      { cabinets: number; activeSubscribers: number; collected: number }
    > = {
      starter: { cabinets: 0, activeSubscribers: 0, collected: 0 },
      professional: { cabinets: 0, activeSubscribers: 0, collected: 0 },
      enterprise: { cabinets: 0, activeSubscribers: 0, collected: 0 },
    };
    for (const s of activeSyndics) {
      const entry = summary[s.subscriptionPlan];
      if (!entry) continue;
      entry.cabinets += 1;
      if (getEffectiveSubscriptionStatus(s, Date.now(), graceDays) === 'active') {
        entry.activeSubscribers += 1;
      }
    }
    for (const p of activePayments) {
      const entry = summary[p.plan];
      if (entry) entry.collected += Number(p.amount || 0);
    }
    return summary;
  }, [activeSyndics, activePayments, graceDays]);

  const revenueByGateway = useMemo(() => {
    const groups: Record<string, { label: string; count: number; total: number; color: string }> = {
      cmi: { label: 'CMI Maroc (3DS)', count: 0, total: 0, color: 'bg-teal-600' },
      paypal: { label: 'PayPal & Cartes Intl', count: 0, total: 0, color: 'bg-sky-600' },
      virement: { label: tr('Virement Bancaire', 'تحويل بنكي'), count: 0, total: 0, color: 'bg-emerald-600' },
      cash: { label: tr('Espèces & Agences', 'نقداً ووكالات'), count: 0, total: 0, color: 'bg-amber-500' },
      check: { label: tr('Chèque', 'شيك'), count: 0, total: 0, color: 'bg-purple-600' },
      manual: { label: tr('Manuel', 'يدوي'), count: 0, total: 0, color: 'bg-slate-500' },
    };
    for (const p of activePayments) {
      const m = p.method || 'manual';
      const bucket =
        m === 'cmi'
          ? 'cmi'
          : m === 'paypal' || m === 'card'
            ? 'paypal'
            : m === 'virement'
              ? 'virement'
              : m === 'cash' || m === 'wafacash' || m === 'cashplus' || m === 'baridcash'
                ? 'cash'
                : m === 'check'
                  ? 'check'
                  : 'manual';
      groups[bucket].count += 1;
      groups[bucket].total += Number(p.amount || 0);
    }
    return Object.entries(groups).map(([key, val]) => ({ key, ...val }));
  }, [activePayments, tr]);

  const monthlyRevenueTrend = useMemo(() => {
    const months: Array<{ key: string; label: string; total: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString(language === 'ar' ? 'ar-MA' : 'fr-MA', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      });
      months.push({ key, label, total: 0 });
    }
    const map = new Map(months.map((m) => [m.key, m]));
    for (const p of activePayments) {
      const mk = String(p.createdAt || '').slice(0, 7);
      const bucket = map.get(mk);
      if (bucket) bucket.total += Number(p.amount || 0);
    }
    const maxTotal = Math.max(1, ...months.map((m) => m.total));
    return months.map((m) => ({
      ...m,
      pct: Math.round((m.total / maxTotal) * 100),
    }));
  }, [activePayments, language]);

  const filteredSyndics = useMemo(() => {
    const query = cabinetSearch.trim().toLowerCase();
    return syndics.filter((s) => {
      const isArchived = Boolean(s.archivedAt);
      const effectiveStatus = getEffectiveSubscriptionStatus(s, Date.now(), graceDays);
      if (statusFilter === 'archived') {
        if (!isArchived) return false;
      } else if (statusFilter === 'all') {
        if (isArchived) return false;
      } else {
        if (isArchived || effectiveStatus !== statusFilter) return false;
      }
      if (planFilter !== 'all' && s.subscriptionPlan !== planFilter) {
        return false;
      }
      if (!query) return true;
      return [s.name, s.email, s.phone, s.city, s.ice, s.rc]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query));
    });
  }, [syndics, cabinetSearch, statusFilter, planFilter, graceDays]);

  const filteredPayments = useMemo(() => {
    const query = paymentSearch.trim().toLowerCase();
    return subscriptionPayments.filter((p) => {
      if (!includeVoidedPayments && p.voidedAt) return false;
      if (paymentMethodFilter !== 'all') {
        const m = p.method || 'manual';
        if (paymentMethodFilter === 'cash_all') {
          if (!['cash', 'wafacash', 'cashplus', 'baridcash', 'check'].includes(m)) {
            return false;
          }
        } else if (m !== paymentMethodFilter) {
          return false;
        }
      }
      if (!query) return true;
      const cab = syndicMap.get(p.syndicId);
      return [
        p.reference,
        p.invoiceNumber,
        p.receiptNumber,
        p.promoCode,
        p.syndicName,
        p.syndicEmail,
        cab?.name,
        cab?.email,
        p.plan,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query));
    });
  }, [
    subscriptionPayments,
    includeVoidedPayments,
    paymentMethodFilter,
    paymentSearch,
    syndicMap,
  ]);

  const selectedSyndicPayments = useMemo(
    () =>
      selectedSyndic
        ? subscriptionPayments.filter((p) => p.syndicId === selectedSyndic.id)
        : [],
    [selectedSyndic, subscriptionPayments],
  );

  const pendingTransferRequests = useMemo(
    () => transferRequests.filter((r) => r.status === 'pending'),
    [transferRequests],
  );

  const filteredPendingRequests = useMemo(
    () =>
      pendingTransferRequests.filter((r) => {
        const type = r.requestType || 'virement';
        if (queueFilter === 'virement') return type === 'virement';
        if (queueFilter === 'cash') return type === 'cash' || type === 'check';
        return true;
      }),
    [pendingTransferRequests, queueFilter],
  );

  const reviewedTransferRequests = useMemo(
    () => transferRequests.filter((r) => r.status !== 'pending'),
    [transferRequests],
  );

  const counterEstimatedAmount = useMemo(() => {
    const base = PLANS[editPlan].price * subscriptionMonths;
    const disc = adminBillingConfig?.commercialPolicy?.multiMonthDiscounts;
    const pct =
      subscriptionMonths >= 12
        ? disc?.m12 ?? 0
        : subscriptionMonths >= 6
          ? disc?.m6 ?? 0
          : subscriptionMonths >= 3
            ? disc?.m3 ?? 0
            : 0;
    return {
      base,
      pct,
      afterMulti: Number(((base * (100 - pct)) / 100).toFixed(2)),
    };
  }, [editPlan, subscriptionMonths, adminBillingConfig]);

  const handleOpenManage = (syndic: Syndic) => {
    setSelectedSyndic(syndic);
    setEditName(syndic.name || '');
    setEditEmail(syndic.email || '');
    setEditPhone(syndic.phone || '');
    setEditCity(syndic.city || '');
    setEditAddress(syndic.address || '');
    setEditIce(syndic.ice || '');
    setEditRc(syndic.rc || '');
    setEditTaxId(syndic.taxId || '');
    setEditPlan(syndic.subscriptionPlan);
    setEditStatus(syndic.subscriptionStatus);
    setEditExpiry(
      (syndic.subscriptionExpiry || new Date().toISOString()).split('T')[0],
    );
    setSubscriptionMethod('cash');
    setSubscriptionReference('');
    setSubscriptionMonths(1);
    setSubscriptionPromoCode('');
    setSubscriptionAgencyLocation('');
    setSubscriptionNotes('');
    setLastRecordedPayment(null);
    setSubscriptionMessage('');
    setSubscriptionError('');
    setArchiveConfirmId(null);
  };

  const handleSaveSyndic = async () => {
    if (!selectedSyndic) {
      throw new Error(tr('Sélectionnez un cabinet.', 'حدد مكتباً.'));
    }
    if (editName.trim().length < 2) {
      throw new Error(
        tr(
          'Le nom du cabinet doit contenir au moins 2 caractères.',
          'يجب أن يحتوي اسم المكتب على حرفين على الأقل.',
        ),
      );
    }
    if (editEmail.trim() && !/^\S+@\S+\.\S+$/.test(editEmail.trim())) {
      throw new Error(
        tr('Adresse email invalide.', 'عنوان البريد الإلكتروني غير صالح.'),
      );
    }
    if (!editExpiry || Number.isNaN(Date.parse(editExpiry))) {
      throw new Error(
        tr('Indiquez une date de fin valide.', 'أدخل تاريخ انتهاء صالحاً.'),
      );
    }
    const normalizedExpiry = /^\d{4}-\d{2}-\d{2}$/.test(editExpiry.trim())
      ? `${editExpiry.trim()}T23:59:59.999Z`
      : new Date(editExpiry).toISOString();

    return updateSyndicMutation.mutateAsync({
      ...selectedSyndic,
      name: editName.trim(),
      email: editEmail.trim(),
      phone: editPhone.trim(),
      city: editCity.trim(),
      address: editAddress.trim(),
      ice: editIce.trim(),
      rc: editRc.trim(),
      taxId: editTaxId.trim(),
      subscriptionPlan: editPlan,
      subscriptionStatus: editStatus,
      subscriptionExpiry: normalizedExpiry,
    });
  };

  const handleGenerateCounterRef = () => {
    const prefix =
      subscriptionMethod === 'check'
        ? 'CHQ'
        : subscriptionMethod === 'virement'
          ? 'VIR'
          : 'ESP';
    setSubscriptionReference(
      `${prefix}-${new Date().getFullYear()}-${generateSecureRandomDigits(6)}`,
    );
  };

  const handleRecordSubscriptionPayment = async () => {
    if (!selectedSyndic) return;
    setSubscriptionError('');
    setSubscriptionMessage('');
    setLastRecordedPayment(null);
    if (selectedSyndic.archivedAt) {
      const msg = tr(
        "Restaurez ce cabinet avant d'enregistrer un paiement.",
        'استعد هذا المكتب قبل تسجيل أي دفع.',
      );
      setSubscriptionError(msg);
      throw new Error(msg);
    }
    const isCashLike = [
      'cash',
      'wafacash',
      'cashplus',
      'baridcash',
      'check',
    ].includes(subscriptionMethod);
    if (!isCashLike && !subscriptionReference.trim()) {
      const msg = tr(
        'La référence bancaire est obligatoire.',
        'المرجع البنكي مطلوب.',
      );
      setSubscriptionError(msg);
      throw new Error(msg);
    }
    if (
      !Number.isInteger(subscriptionMonths) ||
      subscriptionMonths < 1 ||
      subscriptionMonths > 12
    ) {
      const msg = tr(
        'Choisissez entre 1 et 12 mois.',
        'اختر من شهر إلى 12 شهراً.',
      );
      setSubscriptionError(msg);
      throw new Error(msg);
    }
    try {
      const result = await recordSubscriptionPayment({
        syndicId: selectedSyndic.id,
        plan: editPlan,
        months: subscriptionMonths,
        method: subscriptionMethod,
        ...(subscriptionReference.trim()
          ? { reference: subscriptionReference.trim() }
          : {}),
        ...(subscriptionPromoCode.trim()
          ? { promoCode: subscriptionPromoCode.trim().toUpperCase() }
          : {}),
        ...(subscriptionAgencyLocation.trim()
          ? { agencyLocation: subscriptionAgencyLocation.trim() }
          : {}),
        ...(subscriptionNotes.trim()
          ? { notes: subscriptionNotes.trim() }
          : {}),
      });
      const nextExpiry =
        result.subscriptionExpiry || selectedSyndic.subscriptionExpiry;
      const nextStatus: SubscriptionStatus =
        result.subscriptionStatus || 'active';

      setEditStatus(nextStatus);
      if (nextExpiry) {
        setEditExpiry(nextExpiry.split('T')[0]);
      }
      setSelectedSyndic((prev) =>
        prev
          ? {
              ...prev,
              subscriptionPlan: editPlan,
              subscriptionStatus: nextStatus,
              subscriptionExpiry: nextExpiry,
            }
          : null,
      );
      setLastRecordedPayment(result);
      setSubscriptionReference('');
      setSubscriptionPromoCode('');
      setSubscriptionAgencyLocation('');
      setSubscriptionNotes('');
      setSubscriptionMessage(
        tr(
          `Abonnement prolongé et paiement enregistré (${result.invoiceNumber || result.reference}).`,
          `تم تمديد الاشتراك وتسجيل الدفع (${result.invoiceNumber || result.reference}).`,
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
        queryClient.invalidateQueries({ queryKey: ['subscriptionPayments'] }),
      ]);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : tr("L'enregistrement du paiement a échoué.", 'فشل تسجيل الدفع.');
      setSubscriptionError(msg);
      throw err;
    }
  };

  const handleDownloadInvoice = async (payment: SubscriptionPayment) => {
    const cab = syndicMap.get(payment.syndicId) || selectedSyndic;
    await generateSubscriptionInvoicePDF(
      payment,
      cab,
      adminBillingConfig?.issuerProfile,
    );
  };

  const handleSendReminder = async (syndic: Syndic) => {
    setBusyReminderId(syndic.id);
    setReminderFeedback(null);
    try {
      const res = await sendCabinetRenewalReminder(syndic.id);
      setReminderFeedback({ ok: true, text: `${syndic.name} — ${res.message}` });
    } catch (err: unknown) {
      setReminderFeedback({
        ok: false,
        text:
          err instanceof Error
            ? err.message
            : tr('Impossible d’envoyer le rappel.', 'تعذر إرسال التذكير.'),
      });
    } finally {
      setBusyReminderId(null);
    }
  };

  const handlePreviewProof = async (proofUrl: string) => {
    setRequestActionError('');
    try {
      await openAuthenticatedUpload(proofUrl);
    } catch (err: unknown) {
      setRequestActionError(
        err instanceof Error
          ? err.message
          : tr(
              'Impossible d’ouvrir le justificatif.',
              'تعذر فتح وصل التحويل.',
            ),
      );
    }
  };

  const handleApproveTransferRequest = async (
    req: SubscriptionBankTransferRequest,
  ) => {
    setBusyRequestId(req.id);
    setRequestActionError('');
    setRequestActionMessage('');
    try {
      const res = await reviewSubscriptionBankTransfer({
        requestId: req.id,
        action: 'approve',
      });
      setRequestActionMessage(
        tr(
          `Paiement ${req.transferReference} validé (${res.payment?.invoiceNumber || ''}) — abonnement de ${req.syndicName} activé (+${req.months} mois).`,
          `تم تأكيد الدفع ${req.transferReference} وتفعيل اشتراك ${req.syndicName}.`,
        ),
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscriptionBankRequests'] }),
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
        queryClient.invalidateQueries({ queryKey: ['subscriptionPayments'] }),
      ]);
    } catch (err: unknown) {
      setRequestActionError(
        err instanceof Error
          ? err.message
          : tr(
              'Impossible de valider cette demande.',
              'تعذر تأكيد هذا الطلب.',
            ),
      );
    } finally {
      setBusyRequestId(null);
    }
  };

  const handleConfirmRejectTransfer = async () => {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 3) {
      const msg = tr(
        'Indiquez un motif de rejet (min. 3 caractères).',
        'أدخل سبب الرفض (3 أحرف على الأقل).',
      );
      setRejectError(msg);
      throw new Error(msg);
    }
    setBusyRequestId(rejectTarget.id);
    setRequestActionError('');
    setRequestActionMessage('');
    try {
      await reviewSubscriptionBankTransfer({
        requestId: rejectTarget.id,
        action: 'reject',
        rejectionReason: rejectReason.trim(),
      });
      setRequestActionMessage(
        tr(
          `Demande ${rejectTarget.transferReference} rejetée.`,
          `تم رفض الطلب ${rejectTarget.transferReference}.`,
        ),
      );
      setRejectTarget(null);
      setRejectReason('');
      setRejectError('');
      await queryClient.invalidateQueries({
        queryKey: ['subscriptionBankRequests'],
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : tr('Impossible de rejeter la demande.', 'تعذر رفض الطلب.');
      setRejectError(msg);
      throw err;
    } finally {
      setBusyRequestId(null);
    }
  };

  const handleExportPaymentsCsv = () => {
    const headers = [
      'Date',
      'N° Facture',
      'N° Recu',
      'Cabinet',
      'Email',
      'Forfait',
      'Duree (mois)',
      'Mode',
      'Sous-total (MAD)',
      'Remise (MAD)',
      'Code Promo',
      'TVA (%)',
      'Montant TTC (MAD)',
      'Montant facture',
      'Devise',
      'Reference',
      'Echeance resultante',
      'Statut',
      'Motif annulation',
    ];
    const rows = filteredPayments.map((p) => {
      const cab = syndicMap.get(p.syndicId);
      const methodLabel = getMethodBadgeMeta(p.method, tr).label;
      return [
        p.createdAt ? new Date(p.createdAt).toLocaleDateString('fr-MA') : '',
        p.invoiceNumber || '',
        p.receiptNumber || '',
        p.syndicName || cab?.name || p.syndicId,
        p.syndicEmail || cab?.email || '',
        p.plan,
        p.months,
        methodLabel,
        p.subtotalMad ?? p.amount,
        p.discountMad ?? 0,
        p.promoCode || '',
        p.vatRate ?? 0,
        p.amount,
        p.chargedAmount ?? p.amount,
        p.currency || 'MAD',
        p.reference,
        p.subscriptionExpiry
          ? new Date(p.subscriptionExpiry).toLocaleDateString('fr-MA')
          : '',
        p.voidedAt ? 'Annulé' : 'Encaissé',
        p.voidReason || '',
      ]
        .map(escapeCsvCell)
        .join(';');
    });
    const csv = `\uFEFF${[headers.map(escapeCsvCell).join(';'), ...rows].join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `syndik-saas-paiements-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renderStatusBadge = (syndic: Syndic) => {
    if (syndic.archivedAt) {
      return (
        <span className="px-2.5 py-0.5 inline-flex text-xs font-bold rounded-full bg-zinc-200 text-zinc-700">
          {tr('Archivé', 'مؤرشف')}
        </span>
      );
    }
    if (isInGracePeriod(syndic, graceDays)) {
      const left = getGraceDaysRemaining(syndic, graceDays);
      return (
        <span className="px-2.5 py-0.5 inline-flex text-xs font-bold rounded-full bg-amber-100 text-amber-900">
          {tr(`Grâce (${left}j)`, `مهلة (${left}ي)`)}
        </span>
      );
    }
    const effectiveStatus = getEffectiveSubscriptionStatus(
      syndic,
      Date.now(),
      graceDays,
    );
    const badgeClass =
      effectiveStatus === 'active'
        ? 'bg-emerald-100 text-emerald-800'
        : effectiveStatus === 'trialing'
          ? 'bg-sky-100 text-sky-800'
          : effectiveStatus === 'cancelled'
            ? 'bg-slate-200 text-slate-700'
            : 'bg-rose-100 text-rose-800';
    const label =
      effectiveStatus === 'active'
        ? tr('Actif', 'نشط')
        : effectiveStatus === 'trialing'
          ? tr('Essai', 'تجريبي')
          : effectiveStatus === 'cancelled'
            ? tr('Suspendu', 'معلق')
            : tr('Expiré', 'منتهي الصلاحية');

    return (
      <span
        className={`px-2.5 py-0.5 inline-flex text-xs font-bold rounded-full ${badgeClass}`}
      >
        {label}
      </span>
    );
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (userProfile && userProfile.role !== 'admin') {
    return <Navigate to={getHomeRouteForRole(userProfile.role)} replace />;
  }

  return (
    <div
      className="min-h-screen bg-slate-100"
      dir={language === 'ar' ? 'rtl' : 'ltr'}
    >
      <nav className="bg-slate-900 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg sm:text-xl font-bold text-white tracking-tight whitespace-nowrap">
                Syndik Admin
              </span>
              <span className="hidden sm:inline-flex px-2.5 py-0.5 bg-rose-600 text-xs font-bold rounded-full text-white whitespace-nowrap">
                {t('adminPortal.badge')}
              </span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              <span className="text-xs sm:text-sm text-slate-300 font-mono hidden md:inline">
                {userProfile?.email}
              </span>
              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                aria-label={tr('Guide Admin', 'دليل الإدارة')}
                className="inline-flex items-center justify-center gap-1.5 px-2 sm:px-2.5 py-1.5 min-w-[36px] min-h-[36px] rounded-lg bg-slate-800 hover:bg-slate-700 text-teal-200 border border-slate-700 text-xs font-bold"
              >
                <HelpCircle className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">{tr('Guide', 'الدليل')}</span>
              </button>
              <LanguageToggle variant="dark" compactMobile />
              <button
                type="button"
                onClick={handleLogout}
                aria-label={t('header.logout')}
                className="inline-flex items-center justify-center gap-1.5 text-xs font-bold text-rose-400 hover:text-rose-200 hover:bg-slate-800 px-2 min-w-[36px] min-h-[36px] rounded-lg transition-colors whitespace-nowrap"
              >
                <LogOut className="w-4 h-4 shrink-0 sm:hidden" />
                <span className="hidden sm:inline">{t('header.logout')}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {t('adminPortal.title')}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('adminPortal.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void refetchAll()}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors flex items-center gap-1.5"
            >
              <span>{isFetching ? '⟳' : '↻'}</span>
              <span>{tr('Actualiser', 'تحديث')}</span>
            </button>
            <Button
              onClick={() => {
                setCreateError('');
                setIsCreateModalOpen(true);
              }}
              leftIcon={<PlusIcon />}
              className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs"
            >
              {tr('Nouveau Cabinet Syndic', 'إضافة مكتب سنديك جديد')}
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-teal-700 text-white">
              <ResidentsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {t('adminPortal.activeCabinets')}
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900">
                {activeSyndics.length}
              </p>
              <p className="text-[11px] text-slate-500">
                {statusBreakdown.active} {tr('actifs', 'نشط')} ·{' '}
                {statusBreakdown.trialing} {tr('essai', 'تجريبي')}
              </p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-indigo-600 text-white">
              <BuildingsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {t('adminPortal.managedBuildings')}
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900">
                {totalBuildings}
              </p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-600 text-white">
              <ResidentsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {t('adminPortal.connectedResidents')}
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900">
                {totalResidents}
              </p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-500 text-white">
              <FinancialsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {t('adminPortal.estimatedMrr')}
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900">
                {totalMrr.toLocaleString('fr-MA')} MAD
              </p>
              <p className="text-[11px] text-slate-500 font-mono">
                ARR {(totalMrr * 12).toLocaleString('fr-MA')} MAD
              </p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-slate-800 text-white">
              <FinancialsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {tr('Revenus Encaissés', 'المداخيل المحصلة')}
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900">
                {totalCollected.toLocaleString('fr-MA')} MAD
              </p>
              <p className="text-[11px] text-emerald-700 font-semibold">
                {collectedThisMonth.toLocaleString('fr-MA')} MAD{' '}
                {tr('ce mois', 'هذا الشهر')}
              </p>
            </div>
          </Card>
        </div>

        {pendingTransferRequests.length > 0 && activeTab !== 'reports' && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs">
            <div className="font-semibold">
              {tr(
                `${pendingTransferRequests.length} demande(s) de paiement (Virement / Espèces / Chèque) en attente de validation`,
                `${pendingTransferRequests.length} طلب(ات) دفع (تحويل / نقد / شيك) في انتظار التحقق`,
              )}
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('reports')}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold transition-colors"
            >
              {tr('Examiner maintenant →', 'مراجعة الآن ←')}
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div
          className="flex flex-wrap items-center gap-2 border-b border-slate-200"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cabinets'}
            onClick={() => setActiveTab('cabinets')}
            className={`px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-xl border-b-2 transition-colors ${
              activeTab === 'cabinets'
                ? 'border-teal-700 text-teal-800 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tr('Cabinets & Abonnements', 'المكاتب والاشتراكات')} (
            {activeSyndics.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'reports'}
            onClick={() => setActiveTab('reports')}
            className={`px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-xl border-b-2 transition-colors inline-flex items-center gap-2 ${
              activeTab === 'reports'
                ? 'border-teal-700 text-teal-800 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>
              {tr('Paiements & Rapports SaaS', 'المدفوعات وتقارير المنصة')} (
              {activePayments.length})
            </span>
            {pendingTransferRequests.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500 text-white">
                {pendingTransferRequests.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'billing'}
            onClick={() => setActiveTab('billing')}
            className={`px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-xl border-b-2 transition-colors inline-flex items-center gap-2 ${
              activeTab === 'billing'
                ? 'border-teal-700 text-teal-800 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>
              {tr('Passerelles & Paiements', 'بوابات الدفع')}
            </span>
            {(adminBillingConfig?.readinessWarnings?.length || 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900">
                {adminBillingConfig?.readinessWarnings?.length}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'commercial'}
            onClick={() => setActiveTab('commercial')}
            className={`px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-xl border-b-2 transition-colors ${
              activeTab === 'commercial'
                ? 'border-teal-700 text-teal-800 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tr('Facturation & Offres', 'الفوترة والعروض')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'audit'}
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2.5 text-xs sm:text-sm font-bold rounded-t-xl border-b-2 transition-colors ${
              activeTab === 'audit'
                ? 'border-teal-700 text-teal-800 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tr('Audit & Webhooks', 'التدقيق و Webhooks')}
          </button>
        </div>

        {activeTab === 'cabinets' && (
          <Card className="p-5 border border-slate-200 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {t('adminPortal.tableTitle')} ({filteredSyndics.length})
                </h2>
                <p className="text-xs text-slate-500">
                  {tr(
                    'Synchronisation temps réel des cabinets inscrits via la page Tarifs ou créés par l’administrateur',
                    'مزامنة فورية لمكاتب السنديك المسجلة عبر صفحة الباقات أو المنشأة من طرف المدير',
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <input
                  type="search"
                  value={cabinetSearch}
                  onChange={(e) => setCabinetSearch(e.target.value)}
                  placeholder={tr(
                    'Rechercher cabinet, email, ville, ICE...',
                    'بحث عن مكتب، بريد، مدينة...',
                  )}
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white w-56"
                />
                <select
                  aria-label={tr('Filtrer par statut', 'تصفية حسب الحالة')}
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as StatusFilter)
                  }
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="all">
                    {tr('Actifs & courants', 'المكاتب الحالية')} (
                    {activeSyndics.length})
                  </option>
                  <option value="active">
                    {tr('Abonnés actifs', 'نشط')} ({statusBreakdown.active})
                  </option>
                  <option value="trialing">
                    {tr('En essai', 'فترة تجريبية')} ({statusBreakdown.trialing})
                  </option>
                  <option value="expired">
                    {tr('Expirés', 'منتهي الصلاحية')} ({statusBreakdown.expired})
                  </option>
                  <option value="cancelled">
                    {tr('Suspendus', 'معلق')} ({statusBreakdown.cancelled})
                  </option>
                  <option value="archived">
                    {tr('Archivés', 'مؤرشف')} ({statusBreakdown.archived})
                  </option>
                </select>
                <select
                  aria-label={tr('Filtrer par forfait', 'تصفية حسب الباقة')}
                  value={planFilter}
                  onChange={(e) => setPlanFilter(e.target.value as PlanFilter)}
                  className="px-3 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="all">
                    {tr('Tous les forfaits', 'كل الباقات')}
                  </option>
                  <option value="starter">
                    {language === 'ar'
                      ? PLAN_CATALOG.starter.nameAr
                      : PLAN_CATALOG.starter.nameFr}
                  </option>
                  <option value="professional">
                    {language === 'ar'
                      ? PLAN_CATALOG.professional.nameAr
                      : PLAN_CATALOG.professional.nameFr}
                  </option>
                  <option value="enterprise">
                    {language === 'ar'
                      ? PLAN_CATALOG.enterprise.nameAr
                      : PLAN_CATALOG.enterprise.nameFr}
                  </option>
                </select>
              </div>
            </div>

            {/* Mobile Cards (< md) */}
            <div className="md:hidden divide-y divide-slate-200 bg-white">
              {filteredSyndics.map((s) => {
                const days = getDaysRemaining(s.subscriptionExpiry);
                const effective = getEffectiveSubscriptionStatus(
                  s,
                  Date.now(),
                  graceDays,
                );
                const planEntry = PLAN_CATALOG[s.subscriptionPlan];
                return (
                  <div
                    key={`card-${s.id}`}
                    className={`p-4 space-y-3 ${s.archivedAt ? 'opacity-75 bg-slate-50/70' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-sm text-slate-900 truncate">
                          {s.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {s.city || tr('Casablanca', 'الدار البيضاء')} ·{' '}
                          {countActiveBuildings(s.buildings)}{' '}
                          {tr('immeuble(s)', 'عمارة(ات)')}
                        </div>
                      </div>
                      {renderStatusBadge(s)}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                          {tr('Forfait', 'الباقة')}
                        </span>
                        <span className="font-bold text-slate-800 truncate block">
                          {planEntry
                            ? language === 'ar'
                              ? planEntry.nameAr
                              : planEntry.nameFr
                            : t(`subscription.plans.${s.subscriptionPlan}`)}{' '}
                          ({PLANS[s.subscriptionPlan]?.price} DH)
                        </span>
                      </div>
                      <div className="min-w-0">
                        <span className="text-[10px] font-semibold uppercase text-slate-400 block">
                          {tr('Échéance', 'تاريخ الانتهاء')}
                        </span>
                        <span className="font-mono font-semibold text-slate-700 block">
                          {s.subscriptionExpiry
                            ? new Date(
                                parseExpiryMs(s.subscriptionExpiry),
                              ).toLocaleDateString(
                                language === 'ar' ? 'ar-MA' : 'fr-MA',
                              )
                            : '—'}
                        </span>
                        {!s.archivedAt &&
                          days !== null &&
                          effective !== 'cancelled' && (
                            <span
                              className={`text-[10px] font-mono ${
                                days <= 0
                                  ? 'text-rose-600 font-bold'
                                  : days <= 15
                                    ? 'text-amber-600 font-semibold'
                                    : 'text-slate-400'
                              }`}
                            >
                              {days > 0
                                ? tr(`Reste ${days} j`, `متبقي ${days} يوم`)
                                : tr(`Échu (${days} j)`, `منتهي (${days} يوم)`)}
                            </span>
                          )}
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                      <span className="truncate">{s.email || '—'}</span>
                      {s.phone && (
                        <span className="font-mono text-slate-500">
                          {s.phone}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleOpenManage(s)}
                        className="flex-1 min-h-[36px] px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors"
                      >
                        {t('adminPortal.manageBtn')}
                      </button>
                      {s.archivedAt ? (
                        <button
                          type="button"
                          disabled={restoreMutation.isPending}
                          onClick={() => void restoreMutation.mutateAsync(s.id)}
                          className="min-h-[36px] px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-bold text-xs"
                        >
                          {tr('Restaurer', 'استعادة')}
                        </button>
                      ) : archiveConfirmId === s.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={archiveMutation.isPending}
                            onClick={() =>
                              void archiveMutation.mutateAsync(s.id)
                            }
                            className="min-h-[36px] px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
                          >
                            {tr('Confirmer', 'تأكيد')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setArchiveConfirmId(null)}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-600 text-xs"
                          >
                            ✕
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          title={tr('Archiver ce cabinet', 'أرشفة هذا المكتب')}
                          onClick={() => setArchiveConfirmId(s.id)}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                      {t('adminPortal.colCompany')}
                    </th>
                    <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                      {tr('Contact / Email', 'البريد والهاتف')}
                    </th>
                    <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                      ICE / RC
                    </th>
                    <th className="px-4 py-3 text-center font-bold text-slate-500 uppercase text-xs">
                      {t('adminPortal.colBuildings')}
                    </th>
                    <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                      {t('adminPortal.colPlan')}
                    </th>
                    <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                      {t('adminPortal.colStatus')}
                    </th>
                    <th className="px-4 py-3 text-end font-bold text-slate-500 uppercase text-xs">
                      {t('adminPortal.colActions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-slate-100">
                  {filteredSyndics.map((s) => {
                    const days = getDaysRemaining(s.subscriptionExpiry);
                    const effective = getEffectiveSubscriptionStatus(
                      s,
                      Date.now(),
                      graceDays,
                    );
                    const planEntry = PLAN_CATALOG[s.subscriptionPlan];
                    return (
                      <tr
                        key={s.id}
                        className={`hover:bg-slate-50 ${s.archivedAt ? 'opacity-75 bg-slate-50/70' : ''}`}
                      >
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="font-bold text-slate-900">
                            {s.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {s.city || tr('Casablanca', 'الدار البيضاء')}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-600">
                          <div className="font-semibold text-slate-800">
                            {s.email || '—'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {s.phone || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap font-mono text-xs text-slate-600">
                          <div>
                            ICE : {s.ice || tr('Non renseigné', 'غير محدد')}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            RC : {s.rc || tr('Non renseigné', 'غير محدد')}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800">
                          {countActiveBuildings(s.buildings)}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className={`px-2.5 py-0.5 inline-flex text-xs font-bold rounded-full ${
                              s.subscriptionPlan === 'enterprise'
                                ? 'bg-slate-900 text-amber-300'
                                : s.subscriptionPlan === 'professional'
                                  ? 'bg-teal-100 text-teal-800'
                                  : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {planEntry
                              ? language === 'ar'
                                ? planEntry.nameAr
                                : planEntry.nameFr
                              : t(`subscription.plans.${s.subscriptionPlan}`)}{' '}
                            ({PLANS[s.subscriptionPlan]?.price} DH)
                          </span>
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {renderStatusBadge(s)}
                            <span className="font-mono text-xs text-slate-600">
                              {s.subscriptionExpiry
                                ? new Date(
                                    parseExpiryMs(s.subscriptionExpiry),
                                  ).toLocaleDateString(
                                    language === 'ar' ? 'ar-MA' : 'fr-MA',
                                  )
                                : '—'}
                            </span>
                          </div>
                          {!s.archivedAt &&
                            days !== null &&
                            effective !== 'cancelled' && (
                              <div
                                className={`text-[11px] font-mono mt-0.5 ${
                                  days <= 0
                                    ? 'text-rose-600'
                                    : days <= 15
                                      ? 'text-amber-600 font-semibold'
                                      : 'text-slate-400'
                                }`}
                              >
                                {days > 0
                                  ? tr(
                                      `Reste ${days} j`,
                                      `متبقي ${days} يوم`,
                                    )
                                  : tr(
                                      `Échu (${days} j)`,
                                      `منتهي (${days} يوم)`,
                                    )}
                              </div>
                            )}
                        </td>
                        <td className="px-4 py-3.5 whitespace-nowrap text-end">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenManage(s)}
                              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors"
                            >
                              {t('adminPortal.manageBtn')}
                            </button>
                            {s.archivedAt ? (
                              <button
                                type="button"
                                disabled={restoreMutation.isPending}
                                onClick={() =>
                                  void restoreMutation.mutateAsync(s.id)
                                }
                                className="px-2.5 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-bold text-xs transition-colors"
                              >
                                {tr('Restaurer', 'استعادة')}
                              </button>
                            ) : archiveConfirmId === s.id ? (
                              <span className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  disabled={archiveMutation.isPending}
                                  onClick={() =>
                                    void archiveMutation.mutateAsync(s.id)
                                  }
                                  className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs"
                                >
                                  {tr('Confirmer', 'تأكيد')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setArchiveConfirmId(null)}
                                  className="px-2 py-1 rounded border border-slate-300 text-slate-600 text-xs"
                                >
                                  ✕
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                title={tr(
                                  'Archiver ce cabinet',
                                  'أرشفة هذا المكتب',
                                )}
                                onClick={() => setArchiveConfirmId(s.id)}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200 transition-colors"
                              >
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredSyndics.length === 0 && (
              <div className="py-12 px-4 text-center border-t border-slate-100">
                <p className="text-sm font-bold text-slate-800">
                  {syndics.length === 0
                    ? tr(
                        'Aucun cabinet Syndic enregistré (Mode Production)',
                        'لا يوجد أي مكتب سنديك مسجل حالياً (وضع الإنتاج)',
                      )
                    : tr(
                        'Aucun cabinet ne correspond aux filtres appliqués.',
                        'لا توجد مكاتب مطابقة لخيارات البحث.',
                      )}
                </p>
                {syndics.length === 0 && (
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    {tr(
                      "La base de données est vierge de toute donnée de démonstration. Les nouveaux cabinets créés via les offres de la page d'accueil ou via le bouton '+ Nouveau Cabinet Syndic' s'afficheront ici en temps réel.",
                      'قاعدة البيانات خالية من أي بيانات تجريبية. ستظهر مكاتب السنديك الجديدة المسجلة عبر صفحة الباقات أو عبر زر الإضافة هنا فوراً.',
                    )}
                  </p>
                )}
              </div>
            )}
          </Card>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-6">
            {/* Unified Offline Validation Queue (Bank Transfer + Cash / Agencies / Check) */}
            <Card className="p-5 border border-slate-200 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {tr(
                      'File de validation — Virements, Espèces & Agences Cash',
                      'قائمة التحقق — التحويلات البنكية والدفع النقدي والوكالات',
                    )}{' '}
                    ({filteredPendingRequests.length}{' '}
                    {tr('en attente', 'في الانتظار')})
                  </h2>
                  <p className="text-xs text-slate-500">
                    {tr(
                      'Vérifiez le reçu (virement RIB, Wafacash, Cash Plus, Barid Cash, guichet ou chèque) avant d’activer l’abonnement.',
                      'تحقق من الوصل قبل تأكيد تفعيل الاشتراك وإصدار الفاتورة.',
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {(
                    [
                      ['all', tr('Tous', 'الكل')],
                      ['virement', tr('Virements', 'التحويلات')],
                      ['cash', tr('Espèces & Chèque', 'نقداً وشيك')],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setQueueFilter(key)}
                      className={`px-3 py-1.5 rounded-lg border font-bold ${
                        queueFilter === key
                          ? 'bg-teal-700 text-white border-teal-700'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  {reviewedTransferRequests.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowReviewedRequests((prev) => !prev)}
                      className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700"
                    >
                      {showReviewedRequests
                        ? tr('Masquer traités', 'إخفاء المعالجة')
                        : tr(
                            `Historique (${reviewedTransferRequests.length})`,
                            `السجل (${reviewedTransferRequests.length})`,
                          )}
                    </button>
                  )}
                </div>
              </div>

              {requestActionError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
                >
                  {requestActionError}
                </div>
              )}
              {requestActionMessage && (
                <div
                  role="status"
                  className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold"
                >
                  {requestActionMessage}
                </div>
              )}

              {filteredPendingRequests.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  {tr(
                    'Aucune demande en attente de validation pour ce filtre.',
                    'لا يوجد أي طلب في انتظار التحقق حالياً.',
                  )}
                </p>
              ) : (
                <div className="space-y-3">
                  {filteredPendingRequests.map((req) => {
                    const isBusy = busyRequestId === req.id;
                    const planEntry = PLAN_CATALOG[req.plan];
                    const isCashLike =
                      req.requestType === 'cash' || req.requestType === 'check';
                    return (
                      <div
                        key={req.id}
                        className={`p-4 rounded-xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs ${
                          isCashLike
                            ? 'border-orange-200 bg-orange-50/60'
                            : 'border-amber-200 bg-amber-50/60'
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-sm text-slate-900">
                              {req.syndicName}
                            </span>
                            {req.syndicEmail && (
                              <span className="text-slate-500">
                                ({req.syndicEmail})
                              </span>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded-full font-bold ${
                                isCashLike
                                  ? 'bg-orange-100 text-orange-900'
                                  : 'bg-emerald-100 text-emerald-900'
                              }`}
                            >
                              {isCashLike
                                ? getCashChannelLabel(req.cashChannel, tr)
                                : tr('Virement Bancaire', 'تحويل بنكي')}
                            </span>
                            {req.promoCode && (
                              <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-900 font-mono font-bold">
                                {req.promoCode}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-700">
                            <span>
                              <strong>{tr('Forfait :', 'الباقة :')}</strong>{' '}
                              {planEntry
                                ? language === 'ar'
                                  ? planEntry.nameAr
                                  : planEntry.nameFr
                                : req.plan}{' '}
                              · {req.months} {tr('mois', 'أشهر')}
                            </span>
                            <span className="font-mono font-bold text-teal-900">
                              {Number(req.amount || 0).toLocaleString('fr-MA')}{' '}
                              MAD
                            </span>
                            <span>
                              <strong>
                                {isCashLike
                                  ? tr('Canal / Agence :', 'القناة / الوكالة :')
                                  : tr('Banque :', 'البنك :')}
                              </strong>{' '}
                              {req.bankName}
                              {req.agencyLocation ? ` (${req.agencyLocation})` : ''}
                            </span>
                            <span className="font-mono">
                              <strong>{tr('Réf. :', 'المرجع :')}</strong>{' '}
                              {req.transferReference}
                            </span>
                            <span>
                              <strong>{tr('Date :', 'التاريخ :')}</strong>{' '}
                              {req.transferDate}
                            </span>
                          </div>
                          {req.notes && (
                            <div className="text-slate-600 italic">
                              {tr('Note :', 'ملاحظة :')} {req.notes}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {req.proofUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                void handlePreviewProof(req.proofUrl as string)
                              }
                              className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 font-bold"
                            >
                              {tr('Voir justificatif', 'عرض الوصل')}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setRejectTarget(req);
                              setRejectReason('');
                              setRejectError('');
                            }}
                            className="px-3 py-2 rounded-lg border border-rose-300 bg-white hover:bg-rose-50 text-rose-700 font-bold disabled:opacity-50"
                          >
                            {tr('Rejeter', 'رفض')}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleApproveTransferRequest(req)}
                            className="px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-50"
                          >
                            {isBusy
                              ? tr('Validation...', 'جاري التأكيد...')
                              : tr('Valider & Activer', 'تأكيد وتفعيل')}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {showReviewedRequests && reviewedTransferRequests.length > 0 && (
                <div className="pt-3 border-t border-slate-200 space-y-2">
                  <div className="text-xs font-bold text-slate-700">
                    {tr('Historique des demandes traitées', 'سجل الطلبات المعالجة')}
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {reviewedTransferRequests.slice(0, 20).map((req) => (
                      <div
                        key={req.id}
                        className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs"
                      >
                        <div>
                          <span className="font-bold text-slate-900">
                            {req.syndicName}
                          </span>{' '}
                          ·{' '}
                          <span className="font-mono font-semibold">
                            {Number(req.amount || 0).toLocaleString('fr-MA')} MAD
                          </span>{' '}
                          · {req.months} {tr('mois', 'أشهر')} ({req.plan}) ·{' '}
                          <span className="font-mono">{req.transferReference}</span>
                          {req.rejectionReason && (
                            <span className="text-rose-700 ms-2">
                              — {req.rejectionReason}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {req.proofUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                void handlePreviewProof(req.proofUrl as string)
                              }
                              className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 font-semibold"
                            >
                              {tr('Justificatif', 'الوصل')}
                            </button>
                          )}
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold ${
                              req.status === 'approved'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {req.status === 'approved'
                              ? tr('Validé', 'مقبول')
                              : tr('Rejeté', 'مرفوض')}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/* Gateway Revenue Breakdown & 6-Month Collection Trend */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="p-5 border border-slate-200 space-y-3 text-xs">
                <h3 className="text-sm font-bold text-slate-900">
                  {tr(
                    'Encaissements par passerelle de paiement',
                    'التحصيلات حسب بوابة الدفع',
                  )}
                </h3>
                <div className="space-y-2.5">
                  {revenueByGateway.map((gw) => {
                    const pct =
                      totalCollected > 0
                        ? Math.round((gw.total / totalCollected) * 100)
                        : 0;
                    return (
                      <div key={gw.key} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-800">
                            {gw.label}{' '}
                            <span className="text-slate-400">({gw.count})</span>
                          </span>
                          <span className="font-mono font-bold text-slate-900">
                            {gw.total.toLocaleString('fr-MA')} MAD ({pct}%)
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${gw.color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card className="p-5 border border-slate-200 space-y-3 text-xs">
                <h3 className="text-sm font-bold text-slate-900">
                  {tr(
                    'Évolution des encaissements (6 derniers mois)',
                    'تطور التحصيلات (آخر 6 أشهر)',
                  )}
                </h3>
                <div className="grid grid-cols-6 gap-2 items-end h-40 pt-4">
                  {monthlyRevenueTrend.map((m) => (
                    <div
                      key={m.key}
                      className="flex flex-col items-center justify-end h-full gap-1.5"
                    >
                      <span className="font-mono text-[10px] font-bold text-slate-700">
                        {m.total > 0 ? m.total.toLocaleString('fr-MA') : '0'}
                      </span>
                      <div className="w-full bg-slate-100 rounded-t-md h-24 flex items-end overflow-hidden">
                        <div
                          className="w-full bg-teal-600 rounded-t-md transition-all"
                          style={{ height: `${Math.max(m.total > 0 ? 8 : 2, m.pct)}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-semibold text-slate-500 capitalize">
                        {m.label}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Reports Summary Breakdown + Dunning Reminders */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card className="p-5 border border-slate-200 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">
                  {tr('Santé des abonnements', 'حالة الاشتراكات')}
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
                    <div className="text-emerald-700 font-semibold">
                      {tr('Actifs', 'نشط')}
                    </div>
                    <div className="text-lg font-bold font-mono text-emerald-900">
                      {statusBreakdown.active}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-sky-50 border border-sky-100">
                    <div className="text-sky-700 font-semibold">
                      {tr('Essai gratuit', 'تجريبي')}
                    </div>
                    <div className="text-lg font-bold font-mono text-sky-900">
                      {statusBreakdown.trialing}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-100">
                    <div className="text-rose-700 font-semibold">
                      {tr('Expirés', 'منتهي')}
                    </div>
                    <div className="text-lg font-bold font-mono text-rose-900">
                      {statusBreakdown.expired}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-100 border border-slate-200">
                    <div className="text-slate-700 font-semibold">
                      {tr('Suspendus / Archivés', 'معلق / مؤرشف')}
                    </div>
                    <div className="text-lg font-bold font-mono text-slate-900">
                      {statusBreakdown.cancelled} / {statusBreakdown.archived}
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="p-5 border border-slate-200 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">
                  {tr('Revenus par forfait SaaS', 'المداخيل حسب الباقة')}
                </h3>
                <div className="space-y-2 text-xs">
                  {(['starter', 'professional', 'enterprise'] as const).map(
                    (plan) => {
                      const entry = PLAN_CATALOG[plan];
                      return (
                        <div
                          key={plan}
                          className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200"
                        >
                          <div>
                            <span className="font-bold text-slate-900">
                              {language === 'ar' ? entry.nameAr : entry.nameFr}
                            </span>
                            <span className="text-slate-500 ms-1.5 font-mono">
                              ({PLANS[plan].price} MAD)
                            </span>
                            <span className="text-slate-500 ms-2">
                              · {planSummary[plan].cabinets}{' '}
                              {tr('cabinets', 'مكتب')} ·{' '}
                              {planSummary[plan].activeSubscribers}{' '}
                              {tr('actifs', 'نشط')}
                            </span>
                          </div>
                          <div className="font-mono font-bold text-slate-900">
                            {planSummary[plan].collected.toLocaleString('fr-MA')}{' '}
                            MAD
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              </Card>

              <Card className="p-5 border border-slate-200 space-y-3">
                <h3 className="text-sm font-bold text-slate-900">
                  {tr('Relances & Échéances < 15 jours', 'تذكير بالتجديد < 15 يوماً')}{' '}
                  ({expiringSoonSyndics.length})
                </h3>
                {reminderFeedback && (
                  <div
                    role="status"
                    className={`p-2 rounded-lg text-[11px] font-semibold ${
                      reminderFeedback.ok
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border border-rose-200 text-rose-800'
                    }`}
                  >
                    {reminderFeedback.text}
                  </div>
                )}
                {expiringSoonSyndics.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">
                    {tr(
                      'Aucun cabinet actif ou en essai n’expire dans les 15 prochains jours.',
                      'لا يوجد مكتب نشط أو تجريبي ينتهي اشتراكه خلال 15 يوماً.',
                    )}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto text-xs">
                    {expiringSoonSyndics.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 truncate">
                            {s.name}
                          </div>
                          <div className="text-[11px] text-amber-800 font-mono">
                            J-{getDaysRemaining(s.subscriptionExpiry)} (
                            {new Date(
                              parseExpiryMs(s.subscriptionExpiry),
                            ).toLocaleDateString('fr-MA')}
                            )
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={busyReminderId === s.id}
                            onClick={() => void handleSendReminder(s)}
                            className="px-2 py-1 rounded border border-amber-400 bg-white hover:bg-amber-100 text-amber-950 font-bold text-[11px] disabled:opacity-50"
                          >
                            {busyReminderId === s.id
                              ? '...'
                              : tr('Rappel', 'تذكير')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenManage(s)}
                            className="px-2.5 py-1 rounded bg-slate-900 text-white font-bold text-[11px]"
                          >
                            {tr('Encaisser', 'تحصيل')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* SaaS Subscription Payments Ledger */}
            <Card className="p-5 border border-slate-200 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {tr(
                      'Journal des paiements & factures SaaS',
                      'سجل مدفوعات وفواتير الاشتراكات',
                    )}{' '}
                    ({filteredPayments.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    {tr(
                      'CMI Maroc, PayPal, Carte, Virement RIB, Espèces / Agences Cash & Chèque — Factures PDF officielles.',
                      'CMI المغرب، PayPal، تحويل بنكي، نقداً ووكالات وشيك مع فواتير PDF رسمية.',
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={paymentMethodFilter}
                    onChange={(e) => setPaymentMethodFilter(e.target.value)}
                    className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
                  >
                    <option value="all">{tr('Tous modes', 'كل الطرق')}</option>
                    <option value="cmi">CMI Maroc (3DS)</option>
                    <option value="paypal">PayPal</option>
                    <option value="card">{tr('Carte (PayPal)', 'بطاقة (PayPal)')}</option>
                    <option value="virement">{tr('Virement RIB', 'تحويل بنكي')}</option>
                    <option value="cash_all">{tr('Espèces / Agences / Chèque', 'نقداً / وكالات / شيك')}</option>
                    <option value="manual">{tr('Manuel', 'يدوي')}</option>
                  </select>
                  <input
                    type="search"
                    value={paymentSearch}
                    onChange={(e) => setPaymentSearch(e.target.value)}
                    placeholder={tr(
                      'Rechercher cabinet, FAC, réf...',
                      'بحث بالمكتب أو الفاتورة...',
                    )}
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-white w-52"
                  />
                  <label className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeVoidedPayments}
                      onChange={(e) =>
                        setIncludeVoidedPayments(e.target.checked)
                      }
                    />
                    <span>{tr('Inclure annulés', 'إظهار الملغاة')}</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleExportPaymentsCsv}
                    className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold"
                  >
                    {tr('Exporter CSV', 'تصدير CSV')}
                  </button>
                </div>
              </div>

              {/* Mobile Cards (< md) */}
              <div className="md:hidden divide-y divide-slate-200 bg-white">
                {filteredPayments.map((p) => {
                  const cab = syndicMap.get(p.syndicId);
                  const cabName = p.syndicName || cab?.name || p.syndicId;
                  const methodBadge = getMethodBadgeMeta(p.method, tr);
                  return (
                    <div
                      key={`pay-card-${p.id}`}
                      className={`p-4 space-y-2.5 ${p.voidedAt ? 'bg-slate-50/70 opacity-75' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-900 truncate">
                            {cabName}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {p.createdAt
                              ? new Date(p.createdAt).toLocaleDateString(
                                  language === 'ar' ? 'ar-MA' : 'fr-MA',
                                )
                              : '—'}
                            {p.invoiceNumber ? ` · ${p.invoiceNumber}` : ''}
                          </div>
                        </div>
                        <div className="text-end shrink-0">
                          <div className="font-mono font-bold text-sm text-slate-900">
                            {Number(p.amount || 0).toLocaleString('fr-MA')} MAD
                          </div>
                          {p.voidedAt ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                              {tr('Annulé', 'ملغى')}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                              {tr('Encaissé', 'محصل')}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${methodBadge.badgeClass}`}
                        >
                          {methodBadge.label}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 capitalize font-semibold text-[11px]">
                          {p.plan} · {p.months} {tr('mois', 'أشهر')}
                        </span>
                        {p.reference && (
                          <span className="font-mono text-[11px] text-slate-500 truncate max-w-[180px]">
                            {p.reference}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => void handleDownloadInvoice(p)}
                          className="min-h-[36px] px-3 py-1.5 rounded-lg border border-teal-300 bg-teal-50/60 text-teal-900 hover:bg-teal-100 font-bold text-xs"
                        >
                          {tr('Facture PDF', 'فاتورة PDF')}
                        </button>
                        {p.proofUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              void handlePreviewProof(p.proofUrl as string)
                            }
                            className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 text-teal-700 hover:bg-slate-50 font-semibold text-xs"
                          >
                            {tr('Justificatif', 'الوصل')}
                          </button>
                        )}
                        {cab && (
                          <button
                            type="button"
                            onClick={() => handleOpenManage(cab)}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold text-xs"
                          >
                            {tr('Cabinet', 'المكتب')}
                          </button>
                        )}
                        {!p.voidedAt && (
                          <button
                            type="button"
                            onClick={() => {
                              setVoidTarget(p);
                              setVoidReason('');
                              setVoidError('');
                            }}
                            className="min-h-[36px] px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold text-xs"
                          >
                            {tr('Annuler', 'إلغاء')}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                        {tr('Date / N°', 'التاريخ / الرقم')}
                      </th>
                      <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                        {tr('Cabinet', 'المكتب')}
                      </th>
                      <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                        {tr('Forfait / Durée', 'الباقة / المدة')}
                      </th>
                      <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                        {tr('Mode', 'طريقة الدفع')}
                      </th>
                      <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                        {tr('Référence', 'المرجع')}
                      </th>
                      <th className="px-4 py-3 text-end font-bold text-slate-500 uppercase text-xs">
                        {tr('Montant', 'المبلغ')}
                      </th>
                      <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                        {tr('Statut', 'الحالة')}
                      </th>
                      <th className="px-4 py-3 text-end font-bold text-slate-500 uppercase text-xs">
                        {tr('Actions', 'إجراءات')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-slate-100">
                    {filteredPayments.map((p) => {
                      const cab = syndicMap.get(p.syndicId);
                      const cabName = p.syndicName || cab?.name || p.syndicId;
                      const cabEmail = p.syndicEmail || cab?.email || '';
                      const methodBadge = getMethodBadgeMeta(p.method, tr);
                      return (
                        <tr
                          key={p.id}
                          className={
                            p.voidedAt ? 'bg-slate-50/70 opacity-75' : ''
                          }
                        >
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-600">
                            <div>
                              {p.createdAt
                                ? new Date(p.createdAt).toLocaleDateString(
                                    language === 'ar' ? 'ar-MA' : 'fr-MA',
                                  )
                                : '—'}
                            </div>
                            {p.invoiceNumber && (
                              <div className="text-[11px] font-bold text-teal-800">
                                {p.invoiceNumber}
                              </div>
                            )}
                            {p.receiptNumber && (
                              <div className="text-[10px] text-amber-800">
                                {p.receiptNumber}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="font-bold text-slate-900">
                              {cabName}
                            </div>
                            {cabEmail && (
                              <div className="text-[11px] text-slate-500">
                                {cabEmail}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="capitalize font-semibold text-slate-800">
                              {p.plan}
                            </span>
                            <span className="ms-1.5 text-xs text-slate-500">
                              · {p.months} {tr('mois', 'أشهر')}
                            </span>
                            {p.promoCode && (
                              <div className="text-[10px] font-mono text-teal-700 font-bold">
                                Promo: {p.promoCode}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-bold ${methodBadge.badgeClass}`}
                            >
                              {methodBadge.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-slate-700">
                            <div>{p.reference}</div>
                            {p.proofUrl && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handlePreviewProof(p.proofUrl as string)
                                }
                                className="text-[11px] font-sans font-semibold text-teal-700 hover:underline mt-0.5"
                              >
                                {tr('Voir justificatif', 'عرض الوصل')}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-end font-mono font-bold text-slate-900">
                            <div>
                              {Number(p.amount || 0).toLocaleString('fr-MA')} MAD
                            </div>
                            {p.discountMad && p.discountMad > 0 ? (
                              <div className="text-[10px] font-normal text-emerald-700">
                                -{p.discountMad.toLocaleString('fr-MA')} MAD
                              </div>
                            ) : null}
                            {p.currency &&
                              p.currency !== 'MAD' &&
                              p.chargedAmount !== undefined && (
                                <div className="text-[11px] font-normal text-slate-500">
                                  ({p.chargedAmount} {p.currency})
                                </div>
                              )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            {p.voidedAt ? (
                              <div>
                                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800">
                                  {tr('Annulé', 'ملغى')}
                                </span>
                                {p.voidReason && (
                                  <div className="text-[11px] text-slate-500 mt-0.5">
                                    {p.voidReason}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                                {tr('Encaissé', 'محصل')}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-end">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleDownloadInvoice(p)}
                                className="px-2.5 py-1 rounded border border-teal-300 bg-teal-50/60 text-teal-900 hover:bg-teal-100 font-semibold text-xs"
                              >
                                {tr('Facture PDF', 'فاتورة PDF')}
                              </button>
                              {cab && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenManage(cab)}
                                  className="px-2.5 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold text-xs"
                                >
                                  {tr('Cabinet', 'المكتب')}
                                </button>
                              )}
                              {!p.voidedAt && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVoidTarget(p);
                                    setVoidReason('');
                                    setVoidError('');
                                  }}
                                  className="px-2.5 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold text-xs"
                                >
                                  {tr('Annuler', 'إلغاء')}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {filteredPayments.length === 0 && (
                <div className="py-10 text-center text-xs text-slate-500 border-t border-slate-100">
                  {tr(
                    'Aucun paiement d’abonnement enregistré pour ces critères.',
                    'لا توجد مدفوعات اشتراك مسجلة بهذه المعايير.',
                  )}
                </div>
              )}
            </Card>
          </div>
        )}

        {activeTab === 'billing' && (
          <AdminGatewaysTab adminBillingConfig={adminBillingConfig} />
        )}

        {activeTab === 'commercial' && (
          <AdminCommercialTab adminBillingConfig={adminBillingConfig} />
        )}

        {activeTab === 'audit' && <AdminAuditWebhooksTab />}
      </main>

      {/* Create New Syndic Cabinet Modal */}
      {isCreateModalOpen && (
        <Modal
          isOpen={isCreateModalOpen}
          onSubmit={async () => {
            if (
              newCabinetName.trim().length < 2 ||
              !/^\S+@\S+\.\S+$/.test(newEmail.trim())
            )
              throw new Error(
                tr(
                  'Renseignez le nom du cabinet et une adresse email valide.',
                  'أدخل اسم المكتب وبريداً إلكترونياً صحيحاً.',
                ),
              );
            await createSyndicMutation.mutateAsync();
          }}
          busy={createSyndicMutation.isPending}
          onClose={() => setIsCreateModalOpen(false)}
          title={tr(
            'Créer un Nouveau Cabinet Syndic',
            'إنشاء مكتب سنديك جديد',
          )}
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setIsCreateModalOpen(false)}
              >
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                type="submit"
                disabled={createSyndicMutation.isPending}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                {createSyndicMutation.isPending
                  ? tr('Création...', 'جاري الإنشاء...')
                  : tr('Créer le Cabinet Syndic', 'إنشاء مكتب السنديك')}
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5 text-xs">
            {createError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-semibold">
                {createError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Nom du Cabinet Syndic *', 'اسم مكتب السنديك *')}
                </label>
                <input
                  type="text"
                  value={newCabinetName}
                  onChange={(e) => setNewCabinetName(e.target.value)}
                  placeholder="Ex: Atlas Copro Gestion"
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Nom du Gérant / Syndic', 'اسم المسير / السنديك')}
                </label>
                <input
                  type="text"
                  value={newManagerName}
                  onChange={(e) => setNewManagerName(e.target.value)}
                  placeholder="Ex: Karim Tazi"
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Email de connexion *', 'البريد الإلكتروني للدخول *')}
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="contact@atlascopro.ma"
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Mot de passe initial', 'كلمة المرور الأولية')}
                </label>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Téléphone', 'الهاتف')}
                </label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Ville', 'المدينة')}
                </label>
                <input
                  type="text"
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {tr('Forfait SaaS :', 'باقة الاشتراك SaaS :')}
              </label>
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value as SubscriptionPlan)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
              >
                {(['starter', 'professional', 'enterprise'] as const).map(
                  (planKey) => {
                    const entry = PLAN_CATALOG[planKey];
                    return (
                      <option key={planKey} value={planKey}>
                        {language === 'ar'
                          ? `${entry.nameAr} — ${PLANS[planKey].price} درهم/شهر (${entry.limitLabelAr})`
                          : `${entry.nameFr} — ${PLANS[planKey].price} MAD/mois (${entry.limitLabelFr})`}
                      </option>
                    );
                  },
                )}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
              <div className="sm:col-span-1">
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('1ère Résidence', 'الإقامة الأولى')}
                </label>
                <input
                  type="text"
                  value={newBuildingName}
                  onChange={(e) => setNewBuildingName(e.target.value)}
                  placeholder="Résidence Al Amal"
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
              <label className="block text-sm">
                {tr('Adresse réelle de l’immeuble', 'العنوان الفعلي للعمارة')}
                <input
                  className="border rounded p-2 w-full"
                  value={newBuildingAddress}
                  onChange={(e) => setNewBuildingAddress(e.target.value)}
                />
              </label>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Nombre de lots', 'عدد الشقق')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={newApartmentsCount || ''}
                  onChange={(e) =>
                    setNewApartmentsCount(
                      e.target.value === ''
                        ? 0
                        : Math.max(0, Number(e.target.value)),
                    )
                  }
                  onBlur={() => {
                    if (!newApartmentsCount || newApartmentsCount < 1)
                      setNewApartmentsCount(8);
                  }}
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Cotisation (MAD)', 'واجب السنديك (درهم)')}
                </label>
                <input
                  type="number"
                  min={50}
                  value={newMonthlyFees || ''}
                  onChange={(e) =>
                    setNewMonthlyFees(
                      e.target.value === ''
                        ? 0
                        : Math.max(0, Number(e.target.value)),
                    )
                  }
                  onBlur={() => {
                    if (!newMonthlyFees || newMonthlyFees < 50)
                      setNewMonthlyFees(250);
                  }}
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Manage Syndic Modal (Full CRUD: Profile, Subscription, Payment, History, Archive/Restore) */}
      {selectedSyndic && (
        <Modal
          isOpen={!!selectedSyndic}
          onSubmit={handleSaveSyndic}
          busy={updateSyndicMutation.isPending}
          onClose={() => setSelectedSyndic(null)}
          maxWidthClass="max-w-2xl"
          title={`${tr('Gérer le Cabinet :', 'إدارة المكتب :')} ${selectedSyndic.name}`}
          footer={
            <div className="flex w-full justify-between items-center gap-2">
              <div>
                {selectedSyndic.archivedAt ? (
                  <Button
                    variant="secondary"
                    disabled={restoreMutation.isPending}
                    onClick={async () => {
                      await restoreMutation.mutateAsync(selectedSyndic.id);
                    }}
                  >
                    {tr('Restaurer ce cabinet', 'استعادة المكتب')}
                  </Button>
                ) : archiveConfirmId === selectedSyndic.id ? (
                  <div className="inline-flex items-center gap-1.5">
                    <Button
                      variant="danger"
                      disabled={archiveMutation.isPending}
                      onClick={async () => {
                        await archiveMutation.mutateAsync(selectedSyndic.id);
                        setSelectedSyndic(null);
                      }}
                    >
                      {tr("Confirmer l'archivage", 'تأكيد الأرشفة')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setArchiveConfirmId(null)}
                    >
                      {tr('Non', 'لا')}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="danger"
                    onClick={() => setArchiveConfirmId(selectedSyndic.id)}
                  >
                    {tr('Archiver ce cabinet', 'أرشفة المكتب')}
                  </Button>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setSelectedSyndic(null)}
                >
                  {tr('Annuler', 'إلغاء')}
                </Button>
                <Button
                  type="submit"
                  disabled={updateSyndicMutation.isPending}
                  className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
                >
                  {tr('Enregistrer les modifications', 'حفظ التعديلات')}
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {selectedSyndic.archivedAt && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-semibold">
                {tr(
                  'Ce cabinet est archivé. Ses accès d’écriture sont suspendus jusqu’à sa restauration.',
                  'هذا المكتب مؤرشف. صلاحيات الكتابة معلقة حتى استعادته.',
                )}
              </div>
            )}

            {/* Cabinet Coordinates CRUD */}
            <fieldset className="border border-slate-200 rounded-xl p-3.5 space-y-3">
              <legend className="px-1.5 font-bold text-slate-800">
                {tr('Coordonnées du cabinet', 'بيانات المكتب')}
              </legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {tr('Raison sociale *', 'الاسم التجاري *')}
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {tr('Email de contact', 'البريد الإلكتروني')}
                  </label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {tr('Téléphone', 'الهاتف')}
                  </label>
                  <input
                    type="text"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {tr('Ville', 'المدينة')}
                  </label>
                  <input
                    type="text"
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-bold text-slate-700 mb-1">
                    {tr('Adresse', 'العنوان')}
                  </label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    ICE
                  </label>
                  <input
                    type="text"
                    value={editIce}
                    onChange={(e) => setEditIce(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      RC
                    </label>
                    <input
                      type="text"
                      value={editRc}
                      onChange={(e) => setEditRc(e.target.value)}
                      className="w-full p-2 rounded-lg border border-slate-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      IF / Tax ID
                    </label>
                    <input
                      type="text"
                      value={editTaxId}
                      onChange={(e) => setEditTaxId(e.target.value)}
                      className="w-full p-2 rounded-lg border border-slate-300 font-mono"
                    />
                  </div>
                </div>
              </div>
            </fieldset>

            {/* Subscription Plan & Status */}
            <fieldset className="border border-slate-200 rounded-xl p-3.5 space-y-3">
              <legend className="px-1.5 font-bold text-slate-800">
                {tr('Paramètres d’abonnement', 'إعدادات الاشتراك')}
              </legend>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Forfait SaaS :', 'باقة الاشتراك SaaS :')}
                </label>
                <select
                  value={editPlan}
                  onChange={(e) =>
                    setEditPlan(e.target.value as SubscriptionPlan)
                  }
                  className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  {(['starter', 'professional', 'enterprise'] as const).map(
                    (planKey) => {
                      const entry = PLAN_CATALOG[planKey];
                      return (
                        <option key={planKey} value={planKey}>
                          {language === 'ar'
                            ? `${entry.nameAr} — ${PLANS[planKey].price} درهم/شهر (${entry.limitLabelAr})`
                            : `${entry.nameFr} — ${PLANS[planKey].price} MAD/mois (${entry.limitLabelFr})`}
                        </option>
                      );
                    },
                  )}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {tr('Statut du compte :', 'حالة الحساب :')}
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) =>
                      setEditStatus(e.target.value as SubscriptionStatus)
                    }
                    className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
                  >
                    <option value="active">{tr('Actif', 'نشط')}</option>
                    <option value="trialing">
                      {tr('Essai gratuit', 'تجريبي')}
                    </option>
                    <option value="expired">
                      {tr('Expiré', 'منتهي الصلاحية')}
                    </option>
                    <option value="cancelled">{tr('Suspendu', 'معلق')}</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    {tr("Date d'échéance :", 'تاريخ انتهاء الصلاحية :')}
                  </label>
                  <input
                    type="date"
                    value={editExpiry}
                    onChange={(e) => setEditExpiry(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                  />
                </div>
              </div>
            </fieldset>

            {/* Record Subscription Payment & Extend (Counter Cash / Agency / Check / Bank) */}
            <fieldset className="border border-teal-200 bg-teal-50/40 rounded-xl p-3.5 space-y-2.5">
              <legend className="px-1.5 font-bold text-teal-900">
                {tr(
                  'Encaisser l’abonnement (Espèces / Agence / Chèque / Virement) & prolonger',
                  'تسجيل دفع اشتراك المنصة (نقداً / وكالة / شيك / تحويل) وتمديده',
                )}
              </legend>
              <div className="flex flex-wrap items-center gap-1.5">
                {[1, 3, 6, 12].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSubscriptionMonths(m)}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold border transition-colors ${
                      subscriptionMonths === m
                        ? 'bg-teal-700 text-white border-teal-700'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {m} {tr('mois', 'أشهر')}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="font-bold text-slate-700">
                    {tr('Mode d’encaissement', 'طريقة التحصيل')}
                  </span>
                  <select
                    value={subscriptionMethod}
                    onChange={(e) =>
                      setSubscriptionMethod(
                        e.target.value as SubscriptionPaymentMethod,
                      )
                    }
                    className="mt-1 border border-slate-300 rounded-lg p-2 w-full bg-white font-semibold"
                  >
                    <option value="cash">{tr('Espèces (Guichet / Bureau)', 'نقداً (الشباك)')}</option>
                    <option value="wafacash">Wafacash</option>
                    <option value="cashplus">Cash Plus</option>
                    <option value="baridcash">Barid Cash</option>
                    <option value="check">{tr('Chèque bancaire', 'شيك بنكي')}</option>
                    <option value="virement">{tr('Virement bancaire RIB', 'تحويل بنكي')}</option>
                    <option value="manual">{tr('Manuel', 'يدوي')}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="font-bold text-slate-700">
                    {tr('Nombre de mois', 'عدد الأشهر')}
                  </span>
                  <input
                    className="mt-1 border border-slate-300 rounded-lg p-2 w-full bg-white font-mono"
                    type="number"
                    min={1}
                    max={12}
                    value={subscriptionMonths}
                    onChange={(e) =>
                      setSubscriptionMonths(
                        Math.min(12, Math.max(1, Number(e.target.value) || 1)),
                      )
                    }
                  />
                </label>
                <label className="block">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-700">
                      {tr('Référence / N° reçu', 'المرجع / رقم الوصل')}
                    </span>
                    <button
                      type="button"
                      onClick={handleGenerateCounterRef}
                      className="text-[11px] font-bold text-teal-700 hover:underline"
                    >
                      {tr('Auto-générer', 'توليد تلقائي')}
                    </button>
                  </div>
                  <input
                    className="mt-1 border border-slate-300 rounded-lg p-2 w-full bg-white font-mono"
                    placeholder={
                      ['cash', 'wafacash', 'cashplus', 'baridcash', 'check'].includes(
                        subscriptionMethod,
                      )
                        ? tr('Auto (ESP-...) si laissé vide', 'تلقائي إذا ترك فارغاً')
                        : 'Ex: VIR-2026-001'
                    }
                    value={subscriptionReference}
                    onChange={(e) => setSubscriptionReference(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="font-bold text-slate-700">
                    {tr('Code promo (optionnel)', 'رمز ترويجي (اختياري)')}
                  </span>
                  <input
                    className="mt-1 border border-slate-300 rounded-lg p-2 w-full bg-white font-mono uppercase"
                    placeholder="Ex: MAROC10"
                    value={subscriptionPromoCode}
                    onChange={(e) =>
                      setSubscriptionPromoCode(e.target.value.toUpperCase())
                    }
                  />
                </label>
                <label className="block">
                  <span className="font-bold text-slate-700">
                    {tr('Agence / Guichet (optionnel)', 'الوكالة / المكتب (اختياري)')}
                  </span>
                  <input
                    className="mt-1 border border-slate-300 rounded-lg p-2 w-full bg-white"
                    placeholder="Ex: Guichet Casablanca / Agence Maarif"
                    value={subscriptionAgencyLocation}
                    onChange={(e) =>
                      setSubscriptionAgencyLocation(e.target.value)
                    }
                  />
                </label>
                <label className="block">
                  <span className="font-bold text-slate-700">
                    {tr('Observation / Caissier (optionnel)', 'ملاحظات (اختياري)')}
                  </span>
                  <input
                    className="mt-1 border border-slate-300 rounded-lg p-2 w-full bg-white"
                    placeholder={tr('Ex: Reçu signé en agence', 'مثال: وصل موقع')}
                    value={subscriptionNotes}
                    onChange={(e) => setSubscriptionNotes(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="font-mono font-bold text-sm text-teal-900">
                  {tr('Montant estimé :', 'المبلغ المقدر:')}{' '}
                  {counterEstimatedAmount.afterMulti.toLocaleString('fr-MA')} MAD
                  {counterEstimatedAmount.pct > 0 && (
                    <span className="ms-1.5 text-[11px] font-sans text-emerald-700">
                      (-{counterEstimatedAmount.pct}% multi-mois)
                    </span>
                  )}
                  {subscriptionPromoCode.trim() && (
                    <span className="ms-1.5 text-[11px] font-sans text-teal-700">
                      + promo {subscriptionPromoCode.trim()}
                    </span>
                  )}
                </div>
                <Button
                  disabled={Boolean(selectedSyndic.archivedAt)}
                  onClick={handleRecordSubscriptionPayment}
                  className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs"
                >
                  {tr('Encaisser & Prolonger', 'تحصيل وتمديد')}
                </Button>
              </div>
              {subscriptionError && (
                <p
                  role="alert"
                  className="text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2 font-semibold"
                >
                  {subscriptionError}
                </p>
              )}
              {subscriptionMessage && (
                <div
                  role="status"
                  className="flex flex-wrap items-center justify-between gap-2 text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2 font-semibold"
                >
                  <span>{subscriptionMessage}</span>
                  {lastRecordedPayment && (
                    <button
                      type="button"
                      onClick={() => void handleDownloadInvoice(lastRecordedPayment)}
                      className="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px]"
                    >
                      {tr('Télécharger Reçu / Facture PDF', 'تحميل الوصل / الفاتورة PDF')}
                    </button>
                  )}
                </div>
              )}
            </fieldset>

            {/* Cabinet Payment History */}
            <div className="p-3.5 bg-white rounded-xl border border-slate-200 space-y-2">
              <div className="font-bold text-slate-800">
                {tr(
                  `Historique des paiements SaaS (${selectedSyndicPayments.length})`,
                  `سجل مدفوعات الاشتراك (${selectedSyndicPayments.length})`,
                )}
              </div>
              {selectedSyndicPayments.length === 0 ? (
                <p className="text-slate-500">
                  {tr(
                    'Aucun paiement encaissé pour ce cabinet.',
                    'لا توجد مدفوعات مسجلة لهذا المكتب.',
                  )}
                </p>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {selectedSyndicPayments.map((p) => {
                    const methodBadge = getMethodBadgeMeta(p.method, tr);
                    return (
                      <div
                        key={p.id}
                        className={`flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border text-[11px] ${
                          p.voidedAt
                            ? 'bg-slate-50 border-slate-200 text-slate-500'
                            : 'bg-slate-50/50 border-slate-200'
                        }`}
                      >
                        <div>
                          <span className="font-mono font-bold text-slate-800">
                            {p.amount} MAD
                          </span>
                          {p.currency &&
                            p.currency !== 'MAD' &&
                            p.chargedAmount !== undefined && (
                              <span className="text-slate-500 ms-1">
                                ({p.chargedAmount} {p.currency})
                              </span>
                            )}{' '}
                          · {p.months} {tr('mois', 'أشهر')} ({p.plan}) ·{' '}
                          <span
                            className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${methodBadge.badgeClass}`}
                          >
                            {methodBadge.label}
                          </span>{' '}
                          · <span className="font-mono">{p.reference}</span>
                          {p.invoiceNumber && (
                            <span className="ms-1.5 font-mono text-teal-800 font-bold">
                              ({p.invoiceNumber})
                            </span>
                          )}
                          <div className="text-slate-400">
                            {new Date(p.createdAt).toLocaleDateString('fr-MA')}
                            {p.voidedAt && p.voidReason
                              ? ` · ${tr('Annulé', 'ملغى')}: ${p.voidReason}`
                              : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleDownloadInvoice(p)}
                            className="px-2 py-1 rounded border border-teal-300 bg-teal-50/60 text-teal-900 hover:bg-teal-100 font-semibold"
                          >
                            {tr('PDF', 'PDF')}
                          </button>
                          {p.proofUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                void handlePreviewProof(p.proofUrl as string)
                              }
                              className="px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-100 font-semibold"
                            >
                              {tr('Justificatif', 'الوصل')}
                            </button>
                          )}
                          {!p.voidedAt && (
                            <button
                              type="button"
                              onClick={() => {
                                setVoidTarget(p);
                                setVoidReason('');
                                setVoidError('');
                              }}
                              className="px-2 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold"
                            >
                              {tr('Annuler', 'إلغاء')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Attached Buildings */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <div className="font-bold text-slate-800">
                {tr(
                  `Immeubles rattachés (${countActiveBuildings(selectedSyndic.buildings)}) :`,
                  `العمارات التابعة (${countActiveBuildings(selectedSyndic.buildings)}) :`,
                )}
              </div>
              {(selectedSyndic.buildings || []).length === 0 ? (
                <div className="text-slate-500 text-[11px]">
                  {tr('Aucun immeuble actif.', 'لا توجد عمارات نشطة.')}
                </div>
              ) : (
                (selectedSyndic.buildings || []).map((b) => (
                  <div
                    key={b.id}
                    className="flex justify-between text-slate-600 font-mono text-[11px]"
                  >
                    <span>
                      • {b.name} ({b.city})
                    </span>
                    <span>
                      {b.apartments?.length || 0} {tr('lots', 'شقة')} ·{' '}
                      {b.residents?.length || 0} {tr('résidents', 'ساكن')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Void Subscription Payment Confirmation Modal */}
      {voidTarget && (
        <Modal
          isOpen={!!voidTarget}
          onClose={() => setVoidTarget(null)}
          busy={voidPaymentMutation.isPending}
          title={tr(
            'Annuler un paiement d’abonnement',
            'إلغاء دفع اشتراك',
          )}
          onSubmit={async () => {
            if (voidReason.trim().length < 3) {
              const msg = tr(
                'Saisissez un motif d’annulation (min. 3 caractères).',
                'أدخل سبب الإلغاء (3 أحرف على الأقل).',
              );
              setVoidError(msg);
              throw new Error(msg);
            }
            await voidPaymentMutation.mutateAsync({
              paymentId: voidTarget.id,
              reason: voidReason.trim(),
            });
          }}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setVoidTarget(null)}>
                {tr('Fermer', 'إغلاق')}
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={voidPaymentMutation.isPending}
              >
                {tr("Confirmer l'annulation", 'تأكيد الإلغاء')}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            {voidError && (
              <div
                role="alert"
                className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-semibold"
              >
                {voidError}
              </div>
            )}
            <p className="text-slate-700">
              {tr(
                `Paiement ${voidTarget.amount} MAD (réf. ${voidTarget.reference}). L’annulation retire ce paiement des rapports encaissés, libère la référence bancaire et rétablit automatiquement l’état précédent de l’abonnement (forfait, statut et date d’échéance) lorsque le dernier paiement est annulé.`,
                `دفع بمبلغ ${voidTarget.amount} درهم (مرجع ${voidTarget.reference}). سيؤدي الإلغاء إلى سحبه من التقارير وتحرير المرجع البنكي واستعادة حالة الاشتراك السابقة تلقائياً عند إلغاء آخر دفعة.`,
              )}
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {tr("Motif de l'annulation *", 'سبب الإلغاء *')}
              </label>
              <textarea
                rows={3}
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder={tr(
                  'Ex: Erreur de saisie, virement rejeté...',
                  'مثال: خطأ في الإدخال، رفض التحويل...',
                )}
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Moroccan Bank Transfer Modal */}
      {rejectTarget && (
        <Modal
          isOpen={!!rejectTarget}
          onClose={() => setRejectTarget(null)}
          busy={busyRequestId === rejectTarget.id}
          title={tr(
            'Rejeter une demande de virement bancaire',
            'رفض طلب التحويل البنكي',
          )}
          onSubmit={handleConfirmRejectTransfer}
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setRejectTarget(null)}
              >
                {tr('Fermer', 'إغلاق')}
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={busyRequestId === rejectTarget.id}
              >
                {tr('Confirmer le rejet', 'تأكيد الرفض')}
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-xs">
            {rejectError && (
              <div
                role="alert"
                className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-semibold"
              >
                {rejectError}
              </div>
            )}
            <p className="text-slate-700">
              {tr(
                `Cabinet ${rejectTarget.syndicName} — Virement ${rejectTarget.amount} MAD (réf. ${rejectTarget.transferReference}). Le cabinet restera au statut actuel et la référence sera libérée.`,
                `المكتب ${rejectTarget.syndicName} — تحويل بمبلغ ${rejectTarget.amount} درهم (مرجع ${rejectTarget.transferReference}). سيبقى الاشتراك في حالته الحالية.`,
              )}
            </p>
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {tr('Motif du rejet *', 'سبب الرفض *')}
              </label>
              <textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={tr(
                  'Ex: Virement non reçu sur le relevé, justificatif illisible, montant incomplet...',
                  'مثال: لم يصل التحويل في كشف الحساب، الوصل غير واضح، المبلغ ناقص...',
                )}
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>
          </div>
        </Modal>
      )}
      {isHelpOpen && (
        <Suspense fallback={null}>
          <AdminHelpDrawer
            isOpen={isHelpOpen}
            onClose={() => setIsHelpOpen(false)}
            role="admin"
            contextKey={activeTab}
            onOpenFullCenter={(articleId) =>
              navigate(
                articleId
                  ? `/guide?role=admin&article=${encodeURIComponent(articleId)}`
                  : '/guide?role=admin',
              )
            }
          />
        </Suspense>
      )}
    </div>
  );
};

export default AdminDashboard;
