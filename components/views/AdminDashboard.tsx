import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import LanguageToggle from '../common/LanguageToggle';
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
  saveAdminBillingConfig,
  saveSyndic,
  syncAllSharedStateFromServer,
  testPayPalBillingConnection,
  voidSubscriptionPayment,
} from '../../firebase/services';
import { generateSecureRandomDigits } from '../../utils/security';
import {
  PLANS,
  PLAN_CATALOG,
  countActiveBuildings,
  getEffectiveSubscriptionStatus,
} from '../../utils/subscriptionPolicy';
import type {
  AdminBillingConfigUpdateInput,
  AdminPlatformBillingConfig,
  PayPalCheckoutMode,
  PayPalCurrency,
  PayPalEnv,
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

type AdminTab = 'cabinets' | 'reports' | 'billing';
type StatusFilter = 'all' | SubscriptionStatus | 'archived';
type PlanFilter = 'all' | SubscriptionPlan;

function escapeCsvCell(value: string | number | undefined | null): string {
  const raw = String(value ?? '');
  const sanitized = /^[=+\-@\t\r]/.test(raw.trimStart()) ? `'${raw}` : raw;
  return `"${sanitized.replace(/"/g, '""')}"`;
}

function getCasablancaMonthKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric',
    month: '2-digit',
  })
    .format(date)
    .slice(0, 7);
}

function parseExpiryMs(raw?: string): number {
  const trimmed = (raw || '').trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? `${trimmed}T23:59:59.999Z`
    : trimmed;
  return Date.parse(normalized);
}

function getDaysRemaining(raw?: string): number | null {
  const ms = parseExpiryMs(raw);
  if (!Number.isFinite(ms)) return null;
  return Math.ceil((ms - Date.now()) / 86_400_000);
}

function normalizeRibDigits(raw: string): string {
  return raw.replace(/\s+/g, '');
}

function formatRibMoroccan(raw: string): string {
  const digits = normalizeRibDigits(raw);
  if (!/^\d{24}$/.test(digits)) return raw.trim();
  return digits.replace(/^(\d{3})(\d{3})(\d{16})(\d{2})$/, '$1 $2 $3 $4');
}

function getMethodBadgeMeta(
  method: SubscriptionPaymentMethod | undefined,
  tr: (fr: string, ar: string) => string,
) {
  switch (method) {
    case 'card':
      return {
        label: tr('Carte (PayPal)', 'بطاقة بنكية (PayPal)'),
        badgeClass: 'bg-indigo-100 text-indigo-800',
      };
    case 'paypal':
      return {
        label: 'PayPal',
        badgeClass: 'bg-sky-100 text-sky-800',
      };
    case 'virement':
      return {
        label: tr('Virement Maroc', 'تحويل بنكي'),
        badgeClass: 'bg-emerald-100 text-emerald-800',
      };
    default:
      return {
        label: tr('Manuel', 'يدوي'),
        badgeClass: 'bg-slate-100 text-slate-700',
      };
  }
}

const AdminDashboard: React.FC = () => {
  const { userProfile, logout } = useAuth();
  const { t, tr, language } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<AdminTab>('cabinets');
  const [cabinetSearch, setCabinetSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [planFilter, setPlanFilter] = useState<PlanFilter>('all');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [includeVoidedPayments, setIncludeVoidedPayments] = useState(false);

  // Manage Cabinet Modal State (Profile + Subscription + Payments + Archive)
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
  const [subscriptionReference, setSubscriptionReference] = useState('');
  const [subscriptionMonths, setSubscriptionMonths] = useState(1);
  const [subscriptionMessage, setSubscriptionMessage] = useState('');
  const [subscriptionError, setSubscriptionError] = useState('');
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);

  // Void Payment Modal State
  const [voidTarget, setVoidTarget] = useState<SubscriptionPayment | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState('');

  // Bank Transfer Requests Review State
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] =
    useState<SubscriptionBankTransferRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');
  const [requestActionMessage, setRequestActionMessage] = useState('');
  const [requestActionError, setRequestActionError] = useState('');
  const [showReviewedRequests, setShowReviewedRequests] = useState(false);

  // Platform Billing Config Form State (PayPal + Virement Maroc)
  const [billingDirty, setBillingDirty] = useState(false);
  const [ppEnabled, setPpEnabled] = useState(false);
  const [ppEnv, setPpEnv] = useState<PayPalEnv>('sandbox');
  const [ppCheckoutMode, setPpCheckoutMode] =
    useState<PayPalCheckoutMode>('expanded');
  const [ppClientId, setPpClientId] = useState('');
  const [ppClientSecret, setPpClientSecret] = useState('');
  const [ppClearSecret, setPpClearSecret] = useState(false);
  const [ppWebhookId, setPpWebhookId] = useState('');
  const [ppClearWebhook, setPpClearWebhook] = useState(false);
  const [ppCurrency, setPpCurrency] = useState<PayPalCurrency>('EUR');
  const [ppMadPerUnit, setPpMadPerUnit] = useState('10');
  const [ppStarterPrice, setPpStarterPrice] = useState('');
  const [ppProPrice, setPpProPrice] = useState('');
  const [ppEnterprisePrice, setPpEnterprisePrice] = useState('');

  const [bankEnabled, setBankEnabled] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankHolder, setBankHolder] = useState('');
  const [bankRib, setBankRib] = useState('');
  const [bankIban, setBankIban] = useState('');
  const [bankSwift, setBankSwift] = useState('');
  const [bankIce, setBankIce] = useState('');
  const [bankInstructionsFr, setBankInstructionsFr] = useState('');
  const [bankInstructionsAr, setBankInstructionsAr] = useState('');
  const [billingSaving, setBillingSaving] = useState(false);
  const [billingTesting, setBillingTesting] = useState(false);
  const [billingMessage, setBillingMessage] = useState('');
  const [billingError, setBillingError] = useState('');
  const [paypalTestResult, setPaypalTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [confirmResetEnv, setConfirmResetEnv] = useState(false);
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState(false);

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

  const applyBillingConfigToForm = (cfg: AdminPlatformBillingConfig) => {
    setPpEnabled(cfg.paypal.enabled);
    setPpEnv(cfg.paypal.env);
    setPpCheckoutMode(cfg.paypal.checkoutMode);
    setPpClientId(cfg.paypal.clientId || '');
    setPpClientSecret('');
    setPpClearSecret(false);
    setPpWebhookId('');
    setPpClearWebhook(false);
    setPpCurrency(cfg.paypal.currency);
    setPpMadPerUnit(String(cfg.paypal.madPerUnit || 10));
    setPpStarterPrice(
      cfg.paypal.planPrices?.starter !== undefined
        ? String(cfg.paypal.planPrices.starter)
        : '',
    );
    setPpProPrice(
      cfg.paypal.planPrices?.professional !== undefined
        ? String(cfg.paypal.planPrices.professional)
        : '',
    );
    setPpEnterprisePrice(
      cfg.paypal.planPrices?.enterprise !== undefined
        ? String(cfg.paypal.planPrices.enterprise)
        : '',
    );

    setBankEnabled(cfg.bankTransfer.enabled);
    setBankName(cfg.bankTransfer.bankName || '');
    setBankHolder(cfg.bankTransfer.accountHolder || '');
    setBankRib(cfg.bankTransfer.rib || '');
    setBankIban(cfg.bankTransfer.iban || '');
    setBankSwift(cfg.bankTransfer.swift || '');
    setBankIce(cfg.bankTransfer.ice || '');
    setBankInstructionsFr(cfg.bankTransfer.instructionsFr || '');
    setBankInstructionsAr(cfg.bankTransfer.instructionsAr || '');
    setBillingDirty(false);
  };

  useEffect(() => {
    if (adminBillingConfig && !billingDirty) {
      applyBillingConfigToForm(adminBillingConfig);
    }
  }, [adminBillingConfig, billingDirty]);

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
      counts[getEffectiveSubscriptionStatus(s)] += 1;
    }
    return counts;
  }, [activeSyndics, archivedSyndics.length]);

  const totalMrr = useMemo(
    () =>
      activeSyndics.reduce(
        (acc, s) =>
          getEffectiveSubscriptionStatus(s) === 'active'
            ? acc + (PLANS[s.subscriptionPlan]?.price || PLANS.professional.price)
            : acc,
        0,
      ),
    [activeSyndics],
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
          const eff = getEffectiveSubscriptionStatus(s);
          if (eff !== 'active' && eff !== 'trialing') return false;
          const days = getDaysRemaining(s.subscriptionExpiry);
          return days !== null && days >= 0 && days <= 15;
        })
        .sort(
          (a, b) =>
            (getDaysRemaining(a.subscriptionExpiry) ?? 999) -
            (getDaysRemaining(b.subscriptionExpiry) ?? 999),
        ),
    [activeSyndics],
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
      if (getEffectiveSubscriptionStatus(s) === 'active') {
        entry.activeSubscribers += 1;
      }
    }
    for (const p of activePayments) {
      const entry = summary[p.plan];
      if (entry) entry.collected += Number(p.amount || 0);
    }
    return summary;
  }, [activeSyndics, activePayments]);

  const filteredSyndics = useMemo(() => {
    const query = cabinetSearch.trim().toLowerCase();
    return syndics.filter((s) => {
      const isArchived = Boolean(s.archivedAt);
      const effectiveStatus = getEffectiveSubscriptionStatus(s);
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
  }, [syndics, cabinetSearch, statusFilter, planFilter]);

  const filteredPayments = useMemo(() => {
    const query = paymentSearch.trim().toLowerCase();
    return subscriptionPayments.filter((p) => {
      if (!includeVoidedPayments && p.voidedAt) return false;
      if (!query) return true;
      const cab = syndicMap.get(p.syndicId);
      return [
        p.reference,
        p.syndicName,
        p.syndicEmail,
        cab?.name,
        cab?.email,
        p.plan,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(query));
    });
  }, [subscriptionPayments, includeVoidedPayments, paymentSearch, syndicMap]);

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

  const reviewedTransferRequests = useMemo(
    () => transferRequests.filter((r) => r.status !== 'pending'),
    [transferRequests],
  );

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
    setSubscriptionReference('');
    setSubscriptionMonths(1);
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

  const handleRecordSubscriptionPayment = async () => {
    if (!selectedSyndic) return;
    setSubscriptionError('');
    setSubscriptionMessage('');
    if (selectedSyndic.archivedAt) {
      const msg = tr(
        "Restaurez ce cabinet avant d'enregistrer un paiement.",
        'استعد هذا المكتب قبل تسجيل أي دفع.',
      );
      setSubscriptionError(msg);
      throw new Error(msg);
    }
    if (!subscriptionReference.trim()) {
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
        reference: subscriptionReference.trim(),
        amount: PLANS[editPlan].price * subscriptionMonths,
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
      setSubscriptionReference('');
      setSubscriptionMessage(
        tr(
          'Abonnement prolongé et paiement enregistré.',
          'تم تمديد الاشتراك وتسجيل الدفع.',
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
      await reviewSubscriptionBankTransfer({
        requestId: req.id,
        action: 'approve',
      });
      setRequestActionMessage(
        tr(
          `Virement ${req.transferReference} validé — abonnement de ${req.syndicName} activé (+${req.months} mois).`,
          `تم تأكيد التحويل ${req.transferReference} وتفعيل اشتراك ${req.syndicName}.`,
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
              'Impossible de valider ce virement.',
              'تعذر تأكيد هذا التحويل.',
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

  const handleSaveBillingConfig = async () => {
    setBillingError('');
    setBillingMessage('');
    const parsedMadRate = Number(ppMadPerUnit);
    if (!Number.isFinite(parsedMadRate) || parsedMadRate < 0.01) {
      setBillingError(
        tr(
          'Indiquez un taux de conversion MAD valide (> 0).',
          'أدخل سعر تحويل صالحاً من الدرهم (> 0).',
        ),
      );
      return;
    }
    const planPrices: Partial<Record<SubscriptionPlan, number>> = {};
    const priceInputs: Array<[SubscriptionPlan, string]> = [
      ['starter', ppStarterPrice],
      ['professional', ppProPrice],
      ['enterprise', ppEnterprisePrice],
    ];
    for (const [planKey, rawVal] of priceInputs) {
      if (rawVal.trim()) {
        const parsed = Number(rawVal);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setBillingError(
            tr(
              `Tarif PayPal invalide pour le forfait ${planKey}.`,
              `سعر PayPal غير صالح للباقة ${planKey}.`,
            ),
          );
          return;
        }
        planPrices[planKey] = Number(parsed.toFixed(2));
      }
    }
    const cleanRib = normalizeRibDigits(bankRib);
    if (cleanRib && !/^\d{24}$/.test(cleanRib)) {
      setBillingError(
        tr(
          'Le RIB marocain doit comporter exactement 24 chiffres.',
          'يجب أن يتكون رقم RIB المغربي من 24 رقماً بالضبط.',
        ),
      );
      return;
    }

    setBillingSaving(true);
    try {
      const payload: AdminBillingConfigUpdateInput = {
        paypal: {
          enabled: ppEnabled,
          env: ppEnv,
          checkoutMode: ppCheckoutMode,
          clientId: ppClientId.trim(),
          ...(ppClientSecret.trim()
            ? { clientSecret: ppClientSecret.trim() }
            : ppClearSecret
              ? { clearClientSecret: true }
              : {}),
          ...(ppWebhookId.trim()
            ? { webhookId: ppWebhookId.trim() }
            : ppClearWebhook
              ? { clearWebhookId: true }
              : {}),
          currency: ppCurrency,
          madPerUnit: parsedMadRate,
          planPrices,
        },
        bankTransfer: {
          enabled: bankEnabled,
          bankName: bankName.trim(),
          accountHolder: bankHolder.trim(),
          rib: cleanRib ? formatRibMoroccan(cleanRib) : '',
          iban: bankIban.trim().toUpperCase(),
          swift: bankSwift.trim().toUpperCase(),
          ice: bankIce.trim(),
          instructionsFr: bankInstructionsFr.trim(),
          instructionsAr: bankInstructionsAr.trim(),
        },
      };
      const updated = await saveAdminBillingConfig(payload);
      queryClient.setQueryData(['adminBillingConfig'], updated);
      applyBillingConfigToForm(updated);
      setBillingMessage(
        tr(
          'Configuration des paiements enregistrée et chiffrée sur le serveur.',
          'تم حفظ إعدادات الدفع وتشفيرها على الخادم.',
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: ['subscriptionBillingConfig'],
      });
    } catch (err: unknown) {
      setBillingError(
        err instanceof Error
          ? err.message
          : tr(
              'Erreur lors de l’enregistrement de la configuration.',
              'حدث خطأ أثناء حفظ الإعدادات.',
            ),
      );
    } finally {
      setBillingSaving(false);
    }
  };

  const handleTestPayPalConnection = async () => {
    setBillingTesting(true);
    setPaypalTestResult(null);
    setBillingError('');
    try {
      const result = await testPayPalBillingConnection({
        env: ppEnv,
        ...(ppClientId.trim() ? { clientId: ppClientId.trim() } : {}),
        ...(ppClientSecret.trim()
          ? { clientSecret: ppClientSecret.trim() }
          : {}),
      });
      setPaypalTestResult({ ok: true, message: result.message });
    } catch (err: unknown) {
      setPaypalTestResult({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : tr(
                'Échec du test de connexion PayPal.',
                'فشل اختبار الاتصال مع PayPal.',
              ),
      });
    } finally {
      setBillingTesting(false);
    }
  };

  const handleResetBillingToEnv = async () => {
    setBillingSaving(true);
    setBillingError('');
    setBillingMessage('');
    setConfirmResetEnv(false);
    try {
      const updated = await saveAdminBillingConfig({
        resetToEnv: true,
        paypal: {
          enabled: false,
          env: 'sandbox',
          checkoutMode: 'expanded',
          clientId: '',
          currency: 'EUR',
          madPerUnit: 10,
        },
        bankTransfer: {
          enabled: false,
          bankName: '',
          accountHolder: '',
          rib: '',
        },
      });
      queryClient.setQueryData(['adminBillingConfig'], updated);
      applyBillingConfigToForm(updated);
      setPaypalTestResult(null);
      setBillingMessage(
        tr(
          'Surcharge Admin supprimée : la configuration utilise désormais les variables d’environnement.',
          'تمت إزالة تخصيص المدير: تعتمد الإعدادات الآن على متغيرات البيئة.',
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: ['subscriptionBillingConfig'],
      });
    } catch (err: unknown) {
      setBillingError(
        err instanceof Error
          ? err.message
          : tr(
              'Impossible de réinitialiser la configuration.',
              'تعذر إعادة تعيين الإعدادات.',
            ),
      );
    } finally {
      setBillingSaving(false);
    }
  };

  const handleExportPaymentsCsv = () => {
    const headers = [
      'Date',
      'Cabinet',
      'Email',
      'Forfait',
      'Duree (mois)',
      'Mode',
      'Montant (MAD)',
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
        p.syndicName || cab?.name || p.syndicId,
        p.syndicEmail || cab?.email || '',
        p.plan,
        p.months,
        methodLabel,
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
    const effectiveStatus = getEffectiveSubscriptionStatus(syndic);
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2.5">
              <span className="text-xl font-bold text-white tracking-tight">
                Syndik Admin
              </span>
              <span className="px-2.5 py-0.5 bg-rose-600 text-xs font-bold rounded-full text-white">
                {t('adminPortal.badge')}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs sm:text-sm text-slate-300 font-mono hidden sm:inline">
                {userProfile?.email}
              </span>
              <LanguageToggle variant="dark" />
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs font-bold text-rose-400 hover:text-rose-200 transition-colors"
              >
                {t('header.logout')}
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
                {totalMrr} MAD
              </p>
              <p className="text-[11px] text-slate-500">
                {statusBreakdown.expired > 0
                  ? `${statusBreakdown.expired} ${tr('expiré(s)', 'منتهي')}`
                  : tr('Abonnements actifs', 'اشتراكات نشطة')}
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
                `${pendingTransferRequests.length} virement(s) bancaire(s) Maroc en attente de validation`,
                `${pendingTransferRequests.length} طلب(ات) تحويل بنكي في انتظار التحقق`,
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
              {tr('Configuration Paiements', 'إعدادات الدفع والمنصة')}
            </span>
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

            <div className="overflow-x-auto">
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
                    const effective = getEffectiveSubscriptionStatus(s);
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
            {/* Moroccan Bank Transfer Validation Queue */}
            <Card className="p-5 border border-slate-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {tr(
                      'Demandes de virement bancaire Maroc',
                      'طلبات التحويل البنكي المغربي',
                    )}{' '}
                    ({pendingTransferRequests.length}{' '}
                    {tr('en attente', 'في الانتظار')})
                  </h2>
                  <p className="text-xs text-slate-500">
                    {tr(
                      'Vérifiez le reçu bancaire ou le relevé avant de valider l’activation de l’abonnement.',
                      'تحقق من وصل التحويل البنكي أو كشف الحساب قبل تأكيد تفعيل الاشتراك.',
                    )}
                  </p>
                </div>
                {reviewedTransferRequests.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowReviewedRequests((prev) => !prev)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700"
                  >
                    {showReviewedRequests
                      ? tr('Masquer l’historique traité', 'إخفاء الطلبات المعالجة')
                      : tr(
                          `Voir l’historique traité (${reviewedTransferRequests.length})`,
                          `عرض السجل المعالج (${reviewedTransferRequests.length})`,
                        )}
                  </button>
                )}
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

              {pendingTransferRequests.length === 0 ? (
                <p className="text-xs text-slate-500 py-2">
                  {tr(
                    'Aucune demande de virement en attente de validation.',
                    'لا يوجد أي طلب تحويل بنكي في انتظار التحقق حالياً.',
                  )}
                </p>
              ) : (
                <div className="space-y-3">
                  {pendingTransferRequests.map((req) => {
                    const isBusy = busyRequestId === req.id;
                    const planEntry = PLAN_CATALOG[req.plan];
                    return (
                      <div
                        key={req.id}
                        className="p-4 rounded-xl border border-amber-200 bg-amber-50/60 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
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
                            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold">
                              {tr('En attente', 'قيد المراجعة')}
                            </span>
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
                              <strong>{tr('Banque :', 'البنك :')}</strong>{' '}
                              {req.bankName}
                            </span>
                            <span className="font-mono">
                              <strong>{tr('Réf. :', 'المرجع :')}</strong>{' '}
                              {req.transferReference}
                            </span>
                            <span>
                              <strong>{tr('Date virement :', 'تاريخ التحويل :')}</strong>{' '}
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

            {/* Reports Summary Breakdown */}
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
                  {tr('Échéances < 15 jours', 'تنتهي خلال 15 يوماً')} (
                  {expiringSoonSyndics.length})
                </h3>
                {expiringSoonSyndics.length === 0 ? (
                  <p className="text-xs text-slate-500 py-4">
                    {tr(
                      'Aucun cabinet actif ou en essai n’expire dans les 15 prochains jours.',
                      'لا يوجد مكتب نشط أو تجريبي ينتهي اشتراكه خلال 15 يوماً.',
                    )}
                  </p>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto text-xs">
                    {expiringSoonSyndics.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between p-2 rounded-lg bg-amber-50 border border-amber-200"
                      >
                        <div>
                          <div className="font-bold text-slate-900">
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
                        <button
                          type="button"
                          onClick={() => handleOpenManage(s)}
                          className="px-2.5 py-1 rounded bg-slate-900 text-white font-bold text-[11px]"
                        >
                          {tr('Prolonger', 'تمديد')}
                        </button>
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
                      'Journal des paiements d’abonnement encaissés',
                      'سجل مدفوعات الاشتراكات المحصلة',
                    )}{' '}
                    ({filteredPayments.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    {tr(
                      'Historique complet des encaissements plateforme (PayPal, Carte, Virement Maroc et Manuel)',
                      'السجل الكامل لتحصيلات اشتراكات المنصة (PayPal، بطاقة بنكية، تحويل بنكي، يدوي)',
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <input
                    type="search"
                    value={paymentSearch}
                    onChange={(e) => setPaymentSearch(e.target.value)}
                    placeholder={tr(
                      'Rechercher cabinet ou référence...',
                      'بحث بالمكتب أو المرجع...',
                    )}
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-white w-56"
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

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                        {tr('Date', 'التاريخ')}
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
                            {p.createdAt
                              ? new Date(p.createdAt).toLocaleDateString(
                                  language === 'ar' ? 'ar-MA' : 'fr-MA',
                                )
                              : '—'}
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
                            <div className="inline-flex items-center gap-2">
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
          <div className="space-y-6">
            <Card className="p-5 border border-slate-200 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {tr(
                      'Configuration des passerelles de paiement (PayPal & Virement Maroc)',
                      'إعدادات بوابات الدفع (PayPal والتحويل البنكي المغربي)',
                    )}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {tr(
                      'Priorité : les paramètres enregistrés ici sont chiffrés sur le serveur (AES-256) et remplacent les variables d’environnement (.env / Cloud Run).',
                      'الأولوية: الإعدادات المحفوظة هنا تُشفّر على الخادم (AES-256) وتحل محل متغيرات البيئة.',
                    )}
                  </p>
                </div>
                {adminBillingConfig?.updatedAt && (
                  <div className="text-[11px] text-slate-500 font-mono text-end">
                    {tr('Dernière modif. :', 'آخر تعديل :')}{' '}
                    {new Date(adminBillingConfig.updatedAt).toLocaleString(
                      language === 'ar' ? 'ar-MA' : 'fr-MA',
                    )}
                  </div>
                )}
              </div>

              {/* Section 1: PayPal Expanded Checkout */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {tr(
                        '1. PayPal Standard & Expanded Checkout (Cartes 3D Secure)',
                        '1. PayPal Standard و Expanded Checkout (البطاقات البنكية 3DS)',
                      )}
                    </h3>
                    <p className="text-slate-500 mt-0.5">
                      {tr(
                        'Acceptez les paiements par compte PayPal ou carte bancaire internationale (Visa/Mastercard) avec conversion MAD automatique.',
                        'اقبل الدفع عبر حساب PayPal أو البطاقات الدولية مع التحويل التلقائي من الدرهم.',
                      )}
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 bg-white font-bold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ppEnabled}
                      onChange={(e) => {
                        setPpEnabled(e.target.checked);
                        setBillingDirty(true);
                      }}
                    />
                    <span>
                      {ppEnabled
                        ? tr('PayPal activé', 'PayPal مفعل')
                        : tr('PayPal désactivé', 'PayPal معطل')}
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                  <label className="block">
                    <span className="font-bold text-slate-700">
                      {tr('Environnement', 'البيئة')}
                    </span>
                    <select
                      value={ppEnv}
                      onChange={(e) => {
                        setPpEnv(e.target.value as PayPalEnv);
                        setBillingDirty(true);
                      }}
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-semibold"
                    >
                      <option value="sandbox">
                        {tr('Sandbox (Test développeur)', 'Sandbox (تجريبي)')}
                      </option>
                      <option value="live">
                        {tr('Live (Production réelle)', 'Live (الإنتاج الفعلي)')}
                      </option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="font-bold text-slate-700">
                      {tr('Mode Checkout', 'وضع الدفع')}
                    </span>
                    <select
                      value={ppCheckoutMode}
                      onChange={(e) => {
                        setPpCheckoutMode(e.target.value as PayPalCheckoutMode);
                        setBillingDirty(true);
                      }}
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-semibold"
                    >
                      <option value="expanded">
                        {tr(
                          'Expanded Checkout (Boutons + Carte 3DS)',
                          'Expanded Checkout (PayPal + حقول البطاقة)',
                        )}
                      </option>
                      <option value="standard">
                        {tr(
                          'Standard (Boutons PayPal uniquement)',
                          'Standard (أزرار PayPal فقط)',
                        )}
                      </option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="font-bold text-slate-700">
                      {tr('Devise PayPal', 'عملة PayPal')}
                    </span>
                    <select
                      value={ppCurrency}
                      onChange={(e) => {
                        setPpCurrency(e.target.value as PayPalCurrency);
                        setBillingDirty(true);
                      }}
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-semibold font-mono"
                    >
                      <option value="EUR">EUR (€)</option>
                      <option value="USD">USD ($)</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="font-bold text-slate-700">
                      {tr(
                        `Taux : 1 ${ppCurrency} = X MAD`,
                        `سعر الصرف : 1 ${ppCurrency} = X درهم`,
                      )}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={ppMadPerUnit}
                      onChange={(e) => {
                        setPpMadPerUnit(e.target.value);
                        setBillingDirty(true);
                      }}
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                    />
                  </label>
                </div>

                <div className="p-2.5 rounded-lg bg-sky-50 border border-sky-200 text-sky-900">
                  {tr(
                    'Note Expanded Checkout : PayPal active automatiquement les champs carte bancaire 3D Secure si votre compte PayPal Business est éligible à « Advanced Credit and Debit Card Payments ». Sinon, l’interface bascule sans erreur vers les boutons PayPal + paiement carte standard.',
                    'ملاحظة: يظهر نموذج البطاقة المدمج تلقائياً إذا كان حساب PayPal Business مؤهلاً لخدمة Expanded Checkout، وإلا تنتقل الواجهة تلقائياً إلى أزرار PayPal القياسية.',
                  )}
                </div>

                {/* Optional fixed monthly prices per plan */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(
                    [
                      ['starter', ppStarterPrice, setPpStarterPrice],
                      ['professional', ppProPrice, setPpProPrice],
                      ['enterprise', ppEnterprisePrice, setPpEnterprisePrice],
                    ] as const
                  ).map(([planKey, rawVal, setter]) => {
                    const mad = PLANS[planKey].price;
                    const rate = Number(ppMadPerUnit) > 0 ? Number(ppMadPerUnit) : 10;
                    const autoVal = Math.max(1, mad / rate).toFixed(2);
                    const entry = PLAN_CATALOG[planKey];
                    return (
                      <label key={planKey} className="block">
                        <span className="font-bold text-slate-700">
                          {language === 'ar' ? entry.nameAr : entry.nameFr} (
                          {mad} MAD →{' '}
                          {rawVal.trim() ? rawVal.trim() : autoVal}{' '}
                          {ppCurrency}/mois)
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="1"
                          placeholder={tr(
                            `Auto (${autoVal} ${ppCurrency})`,
                            `تلقائي (${autoVal} ${ppCurrency})`,
                          )}
                          value={rawVal}
                          onChange={(e) => {
                            setter(e.target.value);
                            setBillingDirty(true);
                          }}
                          className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                        />
                      </label>
                    );
                  })}
                </div>

                {/* PayPal Credentials & Webhook */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="font-bold text-slate-700">
                      PayPal Client ID
                    </span>
                    <input
                      type="text"
                      value={ppClientId}
                      onChange={(e) => {
                        setPpClientId(e.target.value);
                        setBillingDirty(true);
                      }}
                      placeholder="A..."
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                    />
                  </label>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-700">
                        PayPal Client Secret
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {ppClearSecret
                          ? tr('Sera effacé', 'سيتم الحذف')
                          : adminBillingConfig?.paypal.clientSecretSource ===
                              'admin'
                            ? tr('Chiffré (Admin)', 'مشفر (المدير)')
                            : adminBillingConfig?.paypal.clientSecretSource ===
                                'env'
                              ? tr('Variable ENV', 'متغير البيئة')
                              : tr('Non défini', 'غير محدد')}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={ppClientSecret}
                        onChange={(e) => {
                          setPpClientSecret(e.target.value);
                          if (e.target.value.trim()) setPpClearSecret(false);
                          setBillingDirty(true);
                        }}
                        placeholder={
                          adminBillingConfig?.paypal.hasClientSecret &&
                          !ppClearSecret
                            ? tr(
                                '•••••••• (laisser vide pour conserver)',
                                '•••••••• (اتركه فارغاً للإبقاء)',
                              )
                            : tr('Saisir le Client Secret', 'أدخل المفتاح السري')
                        }
                        className="w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                      />
                      {(adminBillingConfig?.paypal.hasClientSecret ||
                        ppClearSecret) && (
                        <button
                          type="button"
                          onClick={() => {
                            setPpClearSecret((prev) => !prev);
                            setPpClientSecret('');
                            setBillingDirty(true);
                          }}
                          className="px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold shrink-0"
                        >
                          {ppClearSecret
                            ? tr('Annuler', 'تراجع')
                            : tr('Effacer', 'حذف')}
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-700">
                        {tr(
                          'Webhook ID PayPal (recommandé en production)',
                          'معرف Webhook PayPal (موصى به للإنتاج)',
                        )}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500">
                        {ppClearWebhook
                          ? tr('Sera effacé', 'سيتم الحذف')
                          : adminBillingConfig?.paypal.webhookIdSource === 'admin'
                            ? tr('Chiffré (Admin)', 'مشفر (المدير)')
                            : adminBillingConfig?.paypal.webhookIdSource === 'env'
                              ? tr('Variable ENV', 'متغير البيئة')
                              : tr('Non défini', 'غير محدد')}
                      </span>
                    </div>
                    <div className="mt-1 flex gap-1.5">
                      <input
                        type="text"
                        value={ppWebhookId}
                        onChange={(e) => {
                          setPpWebhookId(e.target.value);
                          if (e.target.value.trim()) setPpClearWebhook(false);
                          setBillingDirty(true);
                        }}
                        placeholder={
                          adminBillingConfig?.paypal.hasWebhookId &&
                          !ppClearWebhook
                            ? tr(
                                'Configuré (laisser vide pour conserver)',
                                'مضبوط (اتركه فارغاً للإبقاء)',
                              )
                            : 'WH-...'
                        }
                        className="w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                      />
                      {(adminBillingConfig?.paypal.hasWebhookId ||
                        ppClearWebhook) && (
                        <button
                          type="button"
                          onClick={() => {
                            setPpClearWebhook((prev) => !prev);
                            setPpWebhookId('');
                            setBillingDirty(true);
                          }}
                          className="px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold shrink-0"
                        >
                          {ppClearWebhook
                            ? tr('Annuler', 'تراجع')
                            : tr('Effacer', 'حذف')}
                        </button>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="font-bold text-slate-700 block">
                      {tr(
                        'URL Webhook à déclarer dans PayPal',
                        'رابط Webhook للتسجيل في PayPal',
                      )}
                    </span>
                    <div className="mt-1 flex gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={`${window.location.origin}/api/webhooks/paypal`}
                        className="w-full p-2 rounded-lg border border-slate-200 bg-slate-100 font-mono text-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(
                            `${window.location.origin}/api/webhooks/paypal`,
                          );
                          setCopiedWebhookUrl(true);
                          window.setTimeout(() => setCopiedWebhookUrl(false), 2000);
                        }}
                        className="px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-bold text-slate-800 shrink-0"
                      >
                        {copiedWebhookUrl
                          ? tr('Copié ✓', 'تم النسخ ✓')
                          : tr('Copier', 'نسخ')}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {tr(
                        'Événements à abonner : PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.REVERSED',
                        'الأحداث المطلوب تفعيلها: PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.REVERSED',
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button
                    type="button"
                    disabled={billingTesting}
                    onClick={() => void handleTestPayPalConnection()}
                    className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold disabled:opacity-50"
                  >
                    {billingTesting
                      ? tr('Test OAuth en cours...', 'جاري الاختبار...')
                      : tr('Tester la connexion PayPal', 'اختبار اتصال PayPal')}
                  </button>
                  {paypalTestResult && (
                    <span
                      className={`px-3 py-1.5 rounded-lg font-semibold ${
                        paypalTestResult.ok
                          ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                          : 'bg-rose-50 border border-rose-200 text-rose-800'
                      }`}
                    >
                      {paypalTestResult.message}
                    </span>
                  )}
                </div>
              </div>

              {/* Section 2: Moroccan Bank Transfer */}
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-4 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {tr(
                        '2. Virement Bancaire Maroc (RIB 24 chiffres)',
                        '2. التحويل البنكي المغربي (RIB من 24 رقماً)',
                      )}
                    </h3>
                    <p className="text-slate-500 mt-0.5">
                      {tr(
                        'Coordonnées bancaires affichées aux syndics dans la fenêtre de renouvellement · Source :',
                        'البيانات البنكية المعروضة للسنديك عند تجديد الاشتراك · المصدر :',
                      )}{' '}
                      <span className="font-mono font-semibold">
                        {adminBillingConfig?.bankTransfer.source || 'default'}
                      </span>
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 bg-white font-bold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={bankEnabled}
                      onChange={(e) => {
                        setBankEnabled(e.target.checked);
                        setBillingDirty(true);
                      }}
                    />
                    <span>
                      {bankEnabled
                        ? tr('Virement activé', 'التحويل البنكي مفعل')
                        : tr('Virement désactivé', 'التحويل البنكي معطل')}
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="font-bold text-slate-700">
                      {tr('Nom de la banque *', 'اسم البنك *')}
                    </span>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => {
                        setBankName(e.target.value);
                        setBillingDirty(true);
                      }}
                      placeholder="Ex: Attijariwafa Bank / CIH Bank"
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
                    />
                  </label>

                  <label className="block">
                    <span className="font-bold text-slate-700">
                      {tr(
                        'Titulaire du compte (Bénéficiaire) *',
                        'صاحب الحساب (المستفيد) *',
                      )}
                    </span>
                    <input
                      type="text"
                      value={bankHolder}
                      onChange={(e) => {
                        setBankHolder(e.target.value);
                        setBillingDirty(true);
                      }}
                      placeholder="Ex: IMMOGEST SARL"
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
                    />
                  </label>

                  <div className="md:col-span-2">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-slate-700">
                        {tr(
                          'RIB Marocain (24 chiffres exacts) *',
                          'رقم الحساب البنكي RIB (24 رقماً) *',
                        )}
                      </label>
                      <span
                        className={`font-mono text-[11px] font-bold ${
                          /^\d{24}$/.test(normalizeRibDigits(bankRib))
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                        }`}
                      >
                        {normalizeRibDigits(bankRib).replace(/\D/g, '').length}{' '}
                        / 24 {tr('chiffres', 'رقم')}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={bankRib}
                      onChange={(e) => {
                        setBankRib(e.target.value);
                        setBillingDirty(true);
                      }}
                      onBlur={() => {
                        const clean = normalizeRibDigits(bankRib);
                        if (/^\d{24}$/.test(clean)) {
                          setBankRib(formatRibMoroccan(clean));
                        }
                      }}
                      placeholder="007 780 0001234567890123 45"
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                    />
                  </div>

                  <label className="block">
                    <span className="font-bold text-slate-700">
                      {tr('IBAN (optionnel)', 'IBAN (اختياري)')}
                    </span>
                    <input
                      type="text"
                      value={bankIban}
                      onChange={(e) => {
                        setBankIban(e.target.value);
                        setBillingDirty(true);
                      }}
                      placeholder="MA64..."
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="font-bold text-slate-700">
                        {tr('SWIFT / BIC', 'SWIFT / BIC')}
                      </span>
                      <input
                        type="text"
                        value={bankSwift}
                        onChange={(e) => {
                          setBankSwift(e.target.value);
                          setBillingDirty(true);
                        }}
                        placeholder="BCMAMAMC"
                        className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                      />
                    </label>
                    <label className="block">
                      <span className="font-bold text-slate-700">ICE</span>
                      <input
                        type="text"
                        value={bankIce}
                        onChange={(e) => {
                          setBankIce(e.target.value);
                          setBillingDirty(true);
                        }}
                        placeholder="001234567000089"
                        className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="font-bold text-slate-700">
                      {tr(
                        'Instructions affichées au syndic (FR)',
                        'تعليمات الدفع المعروضة للسنديك (فرنسي)',
                      )}
                    </span>
                    <textarea
                      rows={3}
                      value={bankInstructionsFr}
                      onChange={(e) => {
                        setBankInstructionsFr(e.target.value);
                        setBillingDirty(true);
                      }}
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
                    />
                  </label>

                  <label className="block">
                    <span className="font-bold text-slate-700">
                      {tr(
                        'Instructions affichées au syndic (AR)',
                        'تعليمات الدفع المعروضة للسنديك (عربي)',
                      )}
                    </span>
                    <textarea
                      rows={3}
                      dir="rtl"
                      value={bankInstructionsAr}
                      onChange={(e) => {
                        setBankInstructionsAr(e.target.value);
                        setBillingDirty(true);
                      }}
                      className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
                    />
                  </label>
                </div>
              </div>

              {billingError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
                >
                  {billingError}
                </div>
              )}
              {billingMessage && (
                <div
                  role="status"
                  className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold"
                >
                  {billingMessage}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 text-xs">
                <div>
                  {confirmResetEnv ? (
                    <div className="inline-flex items-center gap-2">
                      <span className="text-amber-800 font-semibold">
                        {tr(
                          'Supprimer la surcharge Admin et revenir aux variables .env ?',
                          'حذف إعدادات المدير والعودة إلى متغيرات البيئة؟',
                        )}
                      </span>
                      <button
                        type="button"
                        disabled={billingSaving}
                        onClick={() => void handleResetBillingToEnv()}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold"
                      >
                        {tr('Confirmer', 'تأكيد')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmResetEnv(false)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-slate-700"
                      >
                        {tr('Annuler', 'إلغاء')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmResetEnv(true)}
                      className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold"
                    >
                      {tr(
                        'Réinitialiser aux variables d’environnement',
                        'إعادة التعيين لمتغيرات البيئة',
                      )}
                    </button>
                  )}
                </div>

                <Button
                  type="button"
                  disabled={billingSaving}
                  onClick={() => void handleSaveBillingConfig()}
                  className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
                >
                  {billingSaving
                    ? tr('Enregistrement...', 'جاري الحفظ...')
                    : tr('Enregistrer la configuration', 'حفظ الإعدادات')}
                </Button>
              </div>
            </Card>
          </div>
        )}
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

            {/* Record Subscription Payment & Extend */}
            <fieldset className="border border-teal-200 bg-teal-50/40 rounded-xl p-3.5 space-y-2.5">
              <legend className="px-1.5 font-bold text-teal-900">
                {tr(
                  'Encaisser l’abonnement plateforme & prolonger',
                  'تسجيل دفع اشتراك المنصة وتمديده',
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
                  <span className="font-bold text-slate-700">
                    {tr('Référence bancaire unique', 'مرجع بنكي فريد')}
                  </span>
                  <input
                    className="mt-1 border border-slate-300 rounded-lg p-2 w-full bg-white font-mono"
                    placeholder="Ex: VIR-2026-001"
                    value={subscriptionReference}
                    onChange={(e) => setSubscriptionReference(e.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="font-mono font-bold text-sm text-teal-900">
                  {tr('Montant à encaisser :', 'المبلغ المطلوب:')}{' '}
                  {(PLANS[editPlan].price * subscriptionMonths).toLocaleString(
                    'fr-MA',
                  )}{' '}
                  MAD
                </p>
                <Button
                  disabled={Boolean(selectedSyndic.archivedAt)}
                  onClick={handleRecordSubscriptionPayment}
                  className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs"
                >
                  {tr('Enregistrer le paiement', 'تسجيل الدفع')}
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
                <p
                  role="status"
                  className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg p-2 font-semibold"
                >
                  {subscriptionMessage}
                </p>
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
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
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
                          <div className="text-slate-400">
                            {new Date(p.createdAt).toLocaleDateString('fr-MA')}
                            {p.voidedAt && p.voidReason
                              ? ` · ${tr('Annulé', 'ملغى')}: ${p.voidReason}`
                              : ''}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
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
    </div>
  );
};

export default AdminDashboard;
