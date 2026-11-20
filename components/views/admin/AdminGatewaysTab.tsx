import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Card from '../../common/Card';
import Button from '../../common/Button';
import { useI18n } from '../../../hooks/useI18n';
import {
  saveAdminBillingConfig,
  testCmiBillingConnection,
  testPayPalBillingConnection,
} from '../../../firebase/services';
import { PLANS, PLAN_CATALOG } from '../../../utils/subscriptionPolicy';
import {
  formatRibMoroccan,
  normalizeRibDigits,
} from './adminBillingHelpers';
import type {
  AdminBillingConfigUpdateInput,
  AdminPlatformBillingConfig,
  CashChannel,
  CmiCurrencyCode,
  CmiEnv,
  PayPalCheckoutMode,
  PayPalCurrency,
  PayPalEnv,
  SubscriptionPlan,
} from '../../../types';

const CASH_CHANNEL_OPTIONS: Array<{
  id: CashChannel;
  labelFr: string;
  labelAr: string;
}> = [
  { id: 'office', labelFr: 'Guichet / Bureau', labelAr: 'المكتب / الشباك' },
  { id: 'wafacash', labelFr: 'Wafacash', labelAr: 'وفاكاش (Wafacash)' },
  { id: 'cashplus', labelFr: 'Cash Plus', labelAr: 'كاش بلوس (Cash Plus)' },
  { id: 'baridcash', labelFr: 'Barid Cash', labelAr: 'بريد كاش (Barid Cash)' },
  { id: 'check', labelFr: 'Chèque bancaire', labelAr: 'شيك بنكي' },
];

interface AdminGatewaysTabProps {
  adminBillingConfig?: AdminPlatformBillingConfig;
}

const AdminGatewaysTab: React.FC<AdminGatewaysTabProps> = ({
  adminBillingConfig,
}) => {
  const { tr, language } = useI18n();
  const queryClient = useQueryClient();

  const [dirty, setDirty] = useState(false);

  // CMI Morocco state
  const [cmiEnabled, setCmiEnabled] = useState(false);
  const [cmiEnv, setCmiEnv] = useState<CmiEnv>('test');
  const [cmiClientId, setCmiClientId] = useState('');
  const [cmiStoreKey, setCmiStoreKey] = useState('');
  const [cmiClearStoreKey, setCmiClearStoreKey] = useState(false);
  const [cmiCurrency, setCmiCurrency] = useState<CmiCurrencyCode>('504');
  const [cmiLang, setCmiLang] = useState<'fr' | 'ar'>('fr');
  const [cmiShopUrl, setCmiShopUrl] = useState('');
  const [cmiTesting, setCmiTesting] = useState(false);
  const [cmiTestResult, setCmiTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [copiedCmiUrl, setCopiedCmiUrl] = useState<'callback' | 'return' | null>(null);

  // PayPal state
  const [ppEnabled, setPpEnabled] = useState(false);
  const [ppEnv, setPpEnv] = useState<PayPalEnv>('sandbox');
  const [ppCheckoutMode, setPpCheckoutMode] =
    useState<PayPalCheckoutMode>('expanded');
  const [ppClientId, setPpClientId] = useState('');
  const [ppClientSecret, setPpClientSecret] = useState('');
  const [ppClearSecret, setPpClearSecret] = useState(false);
  const [ppWebhookId, setPpWebhookId] = useState('');
  const [ppClearWebhook, setPpClearWebhook] = useState(false);
  const [ppAllowLiveWithoutWebhook, setPpAllowLiveWithoutWebhook] = useState(false);
  const [ppCurrency, setPpCurrency] = useState<PayPalCurrency>('EUR');
  const [ppMadPerUnit, setPpMadPerUnit] = useState('10');
  const [ppStarterPrice, setPpStarterPrice] = useState('');
  const [ppProPrice, setPpProPrice] = useState('');
  const [ppEnterprisePrice, setPpEnterprisePrice] = useState('');
  const [ppTesting, setPpTesting] = useState(false);
  const [ppTestResult, setPpTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [copiedPpWebhook, setCopiedPpWebhook] = useState(false);

  // Bank Transfer state
  const [bankEnabled, setBankEnabled] = useState(false);
  const [bankName, setBankName] = useState('');
  const [bankHolder, setBankHolder] = useState('');
  const [bankRib, setBankRib] = useState('');
  const [bankIban, setBankIban] = useState('');
  const [bankSwift, setBankSwift] = useState('');
  const [bankIce, setBankIce] = useState('');
  const [bankInstructionsFr, setBankInstructionsFr] = useState('');
  const [bankInstructionsAr, setBankInstructionsAr] = useState('');

  // Hybrid Cash / Agency state
  const [cashEnabled, setCashEnabled] = useState(false);
  const [cashChannels, setCashChannels] = useState<CashChannel[]>([
    'office',
    'wafacash',
    'cashplus',
  ]);
  const [cashBeneficiary, setCashBeneficiary] = useState('');
  const [cashAddress, setCashAddress] = useState('');
  const [cashHours, setCashHours] = useState('');
  const [cashPhone, setCashPhone] = useState('');
  const [cashWhatsapp, setCashWhatsapp] = useState('');
  const [cashMaxAmount, setCashMaxAmount] = useState('5000');
  const [cashRequireProof, setCashRequireProof] = useState(true);
  const [cashInstructionsFr, setCashInstructionsFr] = useState('');
  const [cashInstructionsAr, setCashInstructionsAr] = useState('');

  // Save / Reset state
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirmResetEnv, setConfirmResetEnv] = useState(false);

  const hydrate = (cfg: AdminPlatformBillingConfig) => {
    setCmiEnabled(Boolean(cfg.cmi?.enabled));
    setCmiEnv(cfg.cmi?.env || 'test');
    setCmiClientId(cfg.cmi?.clientId || '');
    setCmiStoreKey('');
    setCmiClearStoreKey(false);
    setCmiCurrency(cfg.cmi?.currencyCode || '504');
    setCmiLang(cfg.cmi?.lang === 'ar' ? 'ar' : 'fr');
    setCmiShopUrl(cfg.cmi?.shopUrl || '');

    setPpEnabled(cfg.paypal.enabled);
    setPpEnv(cfg.paypal.env);
    setPpCheckoutMode(cfg.paypal.checkoutMode);
    setPpClientId(cfg.paypal.clientId || '');
    setPpClientSecret('');
    setPpClearSecret(false);
    setPpWebhookId('');
    setPpClearWebhook(false);
    setPpAllowLiveWithoutWebhook(Boolean(cfg.paypal.allowLiveWithoutWebhook));
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

    setCashEnabled(Boolean(cfg.cashPayment?.enabled));
    setCashChannels(
      cfg.cashPayment?.acceptedChannels?.length
        ? cfg.cashPayment.acceptedChannels
        : ['office', 'wafacash', 'cashplus'],
    );
    setCashBeneficiary(cfg.cashPayment?.beneficiaryName || '');
    setCashAddress(cfg.cashPayment?.officeAddress || '');
    setCashHours(cfg.cashPayment?.officeHours || '');
    setCashPhone(cfg.cashPayment?.contactPhone || '');
    setCashWhatsapp(cfg.cashPayment?.whatsapp || '');
    setCashMaxAmount(String(cfg.cashPayment?.maxCashAmountMad ?? 5000));
    setCashRequireProof(cfg.cashPayment?.requireProofUpload ?? true);
    setCashInstructionsFr(cfg.cashPayment?.instructionsFr || '');
    setCashInstructionsAr(cfg.cashPayment?.instructionsAr || '');
    setDirty(false);
  };

  useEffect(() => {
    if (adminBillingConfig && !dirty) {
      hydrate(adminBillingConfig);
    }
  }, [adminBillingConfig, dirty]);

  const toggleCashChannel = (channel: CashChannel) => {
    setDirty(true);
    setCashChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((c) => c !== channel)
        : [...prev, channel],
    );
  };

  const handleSave = async () => {
    setError('');
    setMessage('');

    const parsedMadRate = Number(ppMadPerUnit);
    if (!Number.isFinite(parsedMadRate) || parsedMadRate < 0.01) {
      setError(
        tr(
          'Indiquez un taux de conversion MAD valide (> 0).',
          'أدخل سعر تحويل صالحاً من الدرهم (> 0).',
        ),
      );
      return;
    }

    const planPrices: Partial<Record<SubscriptionPlan, number>> = {};
    for (const [planKey, rawVal] of [
      ['starter', ppStarterPrice],
      ['professional', ppProPrice],
      ['enterprise', ppEnterprisePrice],
    ] as const) {
      if (rawVal.trim()) {
        const parsed = Number(rawVal);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setError(
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
      setError(
        tr(
          'Le RIB marocain doit comporter exactement 24 chiffres.',
          'يجب أن يتكون رقم RIB المغربي من 24 رقماً بالضبط.',
        ),
      );
      return;
    }

    const parsedMaxCash = Number(cashMaxAmount);
    if (!Number.isFinite(parsedMaxCash) || parsedMaxCash < 0) {
      setError(
        tr(
          'Plafond espèces invalide (0 = illimité).',
          'سقف الدفع نقداً غير صالح (0 = غير محدود).',
        ),
      );
      return;
    }

    setSaving(true);
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
          allowLiveWithoutWebhook: ppAllowLiveWithoutWebhook,
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
        cmi: {
          enabled: cmiEnabled,
          env: cmiEnv,
          clientId: cmiClientId.trim(),
          ...(cmiStoreKey.trim()
            ? { storeKey: cmiStoreKey.trim() }
            : cmiClearStoreKey
              ? { clearStoreKey: true }
              : {}),
          currencyCode: cmiCurrency,
          lang: cmiLang,
          shopUrl: cmiShopUrl.trim(),
        },
        cashPayment: {
          enabled: cashEnabled,
          acceptedChannels: cashChannels,
          beneficiaryName: cashBeneficiary.trim(),
          officeAddress: cashAddress.trim(),
          officeHours: cashHours.trim(),
          contactPhone: cashPhone.trim(),
          whatsapp: cashWhatsapp.trim(),
          maxCashAmountMad: Math.round(parsedMaxCash),
          requireProofUpload: cashRequireProof,
          instructionsFr: cashInstructionsFr.trim(),
          instructionsAr: cashInstructionsAr.trim(),
        },
      };
      const updated = await saveAdminBillingConfig(payload);
      queryClient.setQueryData(['adminBillingConfig'], updated);
      hydrate(updated);
      setMessage(
        tr(
          'Passerelles enregistrées et clés secrètes chiffrées (AES-256) sur le serveur.',
          'تم حفظ بوابات الدفع وتشفير المفاتيح السرية (AES-256) على الخادم.',
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: ['subscriptionBillingConfig'],
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : tr(
              'Erreur lors de l’enregistrement des passerelles.',
              'حدث خطأ أثناء حفظ إعدادات البوابات.',
            ),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleTestCmi = async () => {
    setCmiTesting(true);
    setCmiTestResult(null);
    setError('');
    try {
      const res = await testCmiBillingConnection({
        env: cmiEnv,
        ...(cmiClientId.trim() ? { clientId: cmiClientId.trim() } : {}),
        ...(cmiStoreKey.trim() ? { storeKey: cmiStoreKey.trim() } : {}),
        currencyCode: cmiCurrency,
      });
      setCmiTestResult({ ok: true, message: res.message });
    } catch (err: unknown) {
      setCmiTestResult({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : tr('Échec du test CMI.', 'فشل اختبار CMI.'),
      });
    } finally {
      setCmiTesting(false);
    }
  };

  const handleTestPayPal = async () => {
    setPpTesting(true);
    setPpTestResult(null);
    setError('');
    try {
      const res = await testPayPalBillingConnection({
        env: ppEnv,
        ...(ppClientId.trim() ? { clientId: ppClientId.trim() } : {}),
        ...(ppClientSecret.trim() ? { clientSecret: ppClientSecret.trim() } : {}),
      });
      setPpTestResult({ ok: true, message: res.message });
    } catch (err: unknown) {
      setPpTestResult({
        ok: false,
        message:
          err instanceof Error
            ? err.message
            : tr('Échec du test OAuth PayPal.', 'فشل اختبار اتصال PayPal.'),
      });
    } finally {
      setPpTesting(false);
    }
  };

  const handleResetToEnv = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    setConfirmResetEnv(false);
    try {
      const updated = await saveAdminBillingConfig({ resetToEnv: true });
      queryClient.setQueryData(['adminBillingConfig'], updated);
      hydrate(updated);
      setPpTestResult(null);
      setCmiTestResult(null);
      setMessage(
        tr(
          'Surcharge Admin supprimée : la configuration revient aux variables d’environnement.',
          'تمت إزالة إعدادات المدير والعودة إلى متغيرات البيئة.',
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: ['subscriptionBillingConfig'],
      });
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Impossible de réinitialiser.', 'تعذرت إعادة التعيين.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const ribValid = /^\d{24}$/.test(normalizeRibDigits(bankRib));
  const ibanClean = bankIban.replace(/\s+/g, '').toUpperCase();
  const ibanValid =
    !ibanClean ||
    (ibanClean.startsWith('MA')
      ? /^MA\d{26}$/.test(ibanClean)
      : /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(ibanClean));
  const swiftClean = bankSwift.replace(/\s+/g, '').toUpperCase();
  const swiftValid =
    !swiftClean || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swiftClean);
  const iceClean = bankIce.replace(/\s+/g, '');
  const iceValid = !iceClean || /^\d{15}$/.test(iceClean);

  const readinessWarnings = adminBillingConfig?.readinessWarnings || [];

  return (
    <div className="space-y-5">
      {/* Gateway Readiness Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        {[
          {
            title: 'CMI Maroc (3DS)',
            active: Boolean(adminBillingConfig?.cmi?.enabled && adminBillingConfig?.cmi?.hasStoreKey),
            sub: adminBillingConfig?.cmi?.env === 'production' ? 'Production' : 'Test',
          },
          {
            title: 'PayPal & Cartes Intl',
            active: Boolean(adminBillingConfig?.paypal.enabled && adminBillingConfig?.paypal.hasClientSecret),
            sub: `${adminBillingConfig?.paypal.env || 'sandbox'} · ${adminBillingConfig?.paypal.currency || 'EUR'}`,
          },
          {
            title: tr('Virement Bancaire RIB', 'التحويل البنكي'),
            active: Boolean(adminBillingConfig?.bankTransfer.enabled),
            sub: adminBillingConfig?.bankTransfer.bankName || tr('Non configuré', 'غير مضبوط'),
          },
          {
            title: tr('Espèces / Agences Cash', 'نقداً / الوكالات'),
            active: Boolean(adminBillingConfig?.cashPayment?.enabled),
            sub: `${adminBillingConfig?.cashPayment?.acceptedChannels?.length || 0} ${tr('canal(aux)', 'قنوات')}`,
          },
        ].map((gw) => (
          <Card
            key={gw.title}
            className="p-3.5 border border-slate-200 flex items-center justify-between gap-2"
          >
            <div>
              <div className="font-bold text-slate-900">{gw.title}</div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[160px]">
                {gw.sub}
              </div>
            </div>
            <span
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${
                gw.active
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              {gw.active ? tr('Actif', 'مفعل') : tr('Inactif', 'معطل')}
            </span>
          </Card>
        ))}
      </div>

      {readinessWarnings.length > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 text-xs space-y-1">
          <div className="font-bold">
            {tr(
              'Points d’attention sécurité & production :',
              'تنبيهات الأمان والإنتاج :',
            )}
          </div>
          <ul className="list-disc ps-5 space-y-0.5">
            {readinessWarnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <Card className="p-5 border border-slate-200 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {tr(
                'Configuration sécurisée des passerelles (CMI Maroc, PayPal, Virement & Espèces)',
                'الإعداد الآمن لبوابات الدفع (CMI المغرب، PayPal، التحويل والنقد)',
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {tr(
                'Toutes les clés secrètes (CMI Store Key, PayPal Secret & Webhook ID) sont chiffrées en AES-256-GCM côté serveur et ne sont jamais renvoyées en clair.',
                'جميع المفاتيح السرية تُشفّر بتقنية AES-256-GCM على الخادم ولا تُعرض أبداً بشكل مكشوف.',
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

        {/* Section 1: Moroccan CMI 3D-Secure */}
        <div className="rounded-2xl border border-teal-200 bg-teal-50/40 p-4 sm:p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {tr(
                  '1. CMI Maroc — Cartes Bancaires Marocaines 3D-Secure (MAD)',
                  '1. CMI المغرب — البطاقات البنكية المغربية 3D-Secure (درهم)',
                )}
              </h3>
              <p className="text-slate-600 mt-0.5">
                {tr(
                  'Passerelle officielle Centre Monétique Interbancaire (3D_PAY_HOSTING · SHA-512 ver3) pour accepter les cartes marocaines en Dirhams.',
                  'البوابة الرسمية لمركز النقديات المغربي CMI لقبول البطاقات المغربية بالدرهم مع توقيع SHA-512.',
                )}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-teal-300 bg-white font-bold text-teal-900 cursor-pointer">
              <input
                type="checkbox"
                checked={cmiEnabled}
                onChange={(e) => {
                  setCmiEnabled(e.target.checked);
                  setDirty(true);
                }}
              />
              <span>
                {cmiEnabled
                  ? tr('CMI activé', 'CMI مفعل')
                  : tr('CMI désactivé', 'CMI معطل')}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Environnement CMI', 'بيئة CMI')}
              </span>
              <select
                value={cmiEnv}
                onChange={(e) => {
                  setCmiEnv(e.target.value as CmiEnv);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-semibold"
              >
                <option value="test">
                  {tr('Test (testpayment.cmi.co.ma)', 'اختبار (Test CMI)')}
                </option>
                <option value="production">
                  {tr('Production (payment.cmi.co.ma)', 'الإنتاج (Production CMI)')}
                </option>
              </select>
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Client ID Marchand CMI *', 'معرف التاجر CMI *')}
              </span>
              <input
                type="text"
                value={cmiClientId}
                onChange={(e) => {
                  setCmiClientId(e.target.value);
                  setDirty(true);
                }}
                placeholder="60000XXXX"
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Devise ISO CMI', 'عملة CMI')}
              </span>
              <select
                value={cmiCurrency}
                onChange={(e) => {
                  setCmiCurrency(e.target.value as CmiCurrencyCode);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono font-semibold"
              >
                <option value="504">504 — MAD (Dirham marocain)</option>
                <option value="978">978 — EUR</option>
                <option value="840">840 — USD</option>
              </select>
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Langue page CMI', 'لغة صفحة CMI')}
              </span>
              <select
                value={cmiLang}
                onChange={(e) => {
                  setCmiLang(e.target.value === 'ar' ? 'ar' : 'fr');
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-semibold"
              >
                <option value="fr">Français (fr)</option>
                <option value="ar">العربية (ar)</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-700">
                  {tr('Clé secrète CMI (Store Key) *', 'المفتاح السري CMI (Store Key) *')}
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {cmiClearStoreKey
                    ? tr('Sera effacée', 'سيتم الحذف')
                    : adminBillingConfig?.cmi?.hasStoreKey
                      ? `${adminBillingConfig.cmi.storeKeySource === 'admin' ? tr('Chiffrée', 'مشفر') : 'ENV'} ${adminBillingConfig.cmi.storeKeyFingerprint || ''}`
                      : tr('Non définie', 'غير محدد')}
                </span>
              </div>
              <div className="mt-1 flex gap-1.5">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={cmiStoreKey}
                  onChange={(e) => {
                    setCmiStoreKey(e.target.value);
                    if (e.target.value.trim()) setCmiClearStoreKey(false);
                    setDirty(true);
                  }}
                  placeholder={
                    adminBillingConfig?.cmi?.hasStoreKey && !cmiClearStoreKey
                      ? tr(
                          '•••••••• (laisser vide pour conserver)',
                          '•••••••• (اتركه فارغاً للإبقاء)',
                        )
                      : tr('Saisir la Store Key CMI (min. 8 car.)', 'أدخل المفتاح السري CMI')
                  }
                  className="w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                />
                {(adminBillingConfig?.cmi?.hasStoreKey || cmiClearStoreKey) && (
                  <button
                    type="button"
                    onClick={() => {
                      setCmiClearStoreKey((prev) => !prev);
                      setCmiStoreKey('');
                      setDirty(true);
                    }}
                    className="px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold shrink-0"
                  >
                    {cmiClearStoreKey
                      ? tr('Annuler', 'تراجع')
                      : tr('Effacer', 'حذف')}
                  </button>
                )}
              </div>
            </div>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('URL Boutique (shopUrl, optionnel)', 'رابط المتجر (اختياري)')}
              </span>
              <input
                type="url"
                value={cmiShopUrl}
                onChange={(e) => {
                  setCmiShopUrl(e.target.value);
                  setDirty(true);
                }}
                placeholder={origin || 'https://votre-domaine.ma'}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>

            <div>
              <span className="font-bold text-slate-700 block">
                {tr('Callback URL à communiquer au CMI', 'رابط Callback للتسجيل لدى CMI')}
              </span>
              <div className="mt-1 flex gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={`${origin}/api/webhooks/cmi`}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-slate-100 font-mono text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(`${origin}/api/webhooks/cmi`);
                    setCopiedCmiUrl('callback');
                    window.setTimeout(() => setCopiedCmiUrl(null), 2000);
                  }}
                  className="px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-bold text-slate-800 shrink-0"
                >
                  {copiedCmiUrl === 'callback'
                    ? tr('Copié ✓', 'تم ✓')
                    : tr('Copier', 'نسخ')}
                </button>
              </div>
            </div>

            <div>
              <span className="font-bold text-slate-700 block">
                {tr('Return URL (okUrl / failUrl)', 'رابط العودة CMI')}
              </span>
              <div className="mt-1 flex gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={`${origin}/api/subscription/cmi/return`}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-slate-100 font-mono text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      `${origin}/api/subscription/cmi/return`,
                    );
                    setCopiedCmiUrl('return');
                    window.setTimeout(() => setCopiedCmiUrl(null), 2000);
                  }}
                  className="px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-bold text-slate-800 shrink-0"
                >
                  {copiedCmiUrl === 'return'
                    ? tr('Copié ✓', 'تم ✓')
                    : tr('Copier', 'نسخ')}
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              disabled={cmiTesting}
              onClick={() => void handleTestCmi()}
              className="px-3.5 py-2 rounded-lg border border-teal-400 bg-white hover:bg-teal-50 text-teal-900 font-bold disabled:opacity-50"
            >
              {cmiTesting
                ? tr('Vérification SHA-512...', 'جاري التحقق...')
                : tr(
                    'Tester la configuration & signature CMI',
                    'اختبار إعدادات وتوقيع CMI',
                  )}
            </button>
            {cmiTestResult && (
              <span
                className={`px-3 py-1.5 rounded-lg font-semibold ${
                  cmiTestResult.ok
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border border-rose-200 text-rose-800'
                }`}
              >
                {cmiTestResult.message}
              </span>
            )}
          </div>
        </div>

        {/* Section 2: PayPal Standard & Expanded Checkout */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {tr(
                  '2. PayPal Standard & Expanded Checkout (Cartes Internationales 3DS)',
                  '2. PayPal Standard و Expanded Checkout (البطاقات الدولية 3DS)',
                )}
              </h3>
              <p className="text-slate-500 mt-0.5">
                {tr(
                  'Acceptez les paiements par compte PayPal ou carte internationale (Visa/Mastercard) avec conversion MAD automatique.',
                  'اقبل الدفع عبر PayPal أو البطاقات الدولية مع التحويل التلقائي من الدرهم.',
                )}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-300 bg-white font-bold text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={ppEnabled}
                onChange={(e) => {
                  setPpEnabled(e.target.checked);
                  setDirty(true);
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
                  setDirty(true);
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
                  setDirty(true);
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
                  setDirty(true);
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
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
          </div>

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
                    {language === 'ar' ? entry.nameAr : entry.nameFr} ({mad} MAD
                    → {rawVal.trim() ? rawVal.trim() : autoVal} {ppCurrency}
                    /mois)
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="1"
                    placeholder={`Auto (${autoVal} ${ppCurrency})`}
                    value={rawVal}
                    onChange={(e) => {
                      setter(e.target.value);
                      setDirty(true);
                    }}
                    className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                  />
                </label>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="font-bold text-slate-700">PayPal Client ID</span>
              <input
                type="text"
                value={ppClientId}
                onChange={(e) => {
                  setPpClientId(e.target.value);
                  setDirty(true);
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
                    : adminBillingConfig?.paypal.hasClientSecret
                      ? `${adminBillingConfig.paypal.clientSecretSource === 'admin' ? tr('Chiffré', 'مشفر') : 'ENV'} ${adminBillingConfig.paypal.clientSecretFingerprint || ''}`
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
                    setDirty(true);
                  }}
                  placeholder={
                    adminBillingConfig?.paypal.hasClientSecret && !ppClearSecret
                      ? tr(
                          '•••••••• (laisser vide pour conserver)',
                          '•••••••• (اتركه فارغاً للإبقاء)',
                        )
                      : tr('Saisir le Client Secret', 'أدخل المفتاح السري')
                  }
                  className="w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                />
                {(adminBillingConfig?.paypal.hasClientSecret || ppClearSecret) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPpClearSecret((prev) => !prev);
                      setPpClientSecret('');
                      setDirty(true);
                    }}
                    className="px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold shrink-0"
                  >
                    {ppClearSecret ? tr('Annuler', 'تراجع') : tr('Effacer', 'حذف')}
                  </button>
                )}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-slate-700">
                  {tr(
                    'Webhook ID PayPal (requis en Live)',
                    'معرف Webhook PayPal (مطلوب في Live)',
                  )}
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {ppClearWebhook
                    ? tr('Sera effacé', 'سيتم الحذف')
                    : adminBillingConfig?.paypal.hasWebhookId
                      ? `${adminBillingConfig.paypal.webhookIdSource === 'admin' ? tr('Chiffré', 'مشفر') : 'ENV'} ${adminBillingConfig.paypal.webhookIdFingerprint || ''}`
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
                    setDirty(true);
                  }}
                  placeholder={
                    adminBillingConfig?.paypal.hasWebhookId && !ppClearWebhook
                      ? tr(
                          'Configuré (laisser vide pour conserver)',
                          'مضبوط (اتركه فارغاً للإبقاء)',
                        )
                      : 'WH-...'
                  }
                  className="w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                />
                {(adminBillingConfig?.paypal.hasWebhookId || ppClearWebhook) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPpClearWebhook((prev) => !prev);
                      setPpWebhookId('');
                      setDirty(true);
                    }}
                    className="px-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold shrink-0"
                  >
                    {ppClearWebhook ? tr('Annuler', 'تراجع') : tr('Effacer', 'حذف')}
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
                  value={`${origin}/api/webhooks/paypal`}
                  className="w-full p-2 rounded-lg border border-slate-200 bg-slate-100 font-mono text-slate-700"
                />
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(
                      `${origin}/api/webhooks/paypal`,
                    );
                    setCopiedPpWebhook(true);
                    window.setTimeout(() => setCopiedPpWebhook(false), 2000);
                  }}
                  className="px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 font-bold text-slate-800 shrink-0"
                >
                  {copiedPpWebhook ? tr('Copié ✓', 'تم ✓') : tr('Copier', 'نسخ')}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                PAYMENT.CAPTURE.COMPLETED, PAYMENT.CAPTURE.REFUNDED, PAYMENT.CAPTURE.REVERSED
              </p>
            </div>
          </div>

          {ppEnv === 'live' && (
            <label className="inline-flex items-center gap-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={ppAllowLiveWithoutWebhook}
                onChange={(e) => {
                  setPpAllowLiveWithoutWebhook(e.target.checked);
                  setDirty(true);
                }}
              />
              <span>
                {tr(
                  'Exception explicite : autoriser PayPal Live sans Webhook ID (déconseillé — les remboursements ne seront pas synchronisés automatiquement).',
                  'استثناء صريح: السماح بوضع Live دون Webhook ID (غير موصى به).',
                )}
              </span>
            </label>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              disabled={ppTesting}
              onClick={() => void handleTestPayPal()}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold disabled:opacity-50"
            >
              {ppTesting
                ? tr('Test OAuth en cours...', 'جاري الاختبار...')
                : tr('Tester la connexion PayPal', 'اختبار اتصال PayPal')}
            </button>
            {ppTestResult && (
              <span
                className={`px-3 py-1.5 rounded-lg font-semibold ${
                  ppTestResult.ok
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border border-rose-200 text-rose-800'
                }`}
              >
                {ppTestResult.message}
              </span>
            )}
          </div>
        </div>

        {/* Section 3: Moroccan Bank Transfer */}
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {tr(
                  '3. Virement Bancaire Maroc (RIB 24 chiffres)',
                  '3. التحويل البنكي المغربي (RIB من 24 رقماً)',
                )}
              </h3>
              <p className="text-slate-500 mt-0.5">
                {tr('Source :', 'المصدر :')}{' '}
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
                  setDirty(true);
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
                  setDirty(true);
                }}
                placeholder="Ex: Attijariwafa Bank / CIH Bank"
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
              />
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Titulaire du compte *', 'صاحب الحساب *')}
              </span>
              <input
                type="text"
                value={bankHolder}
                onChange={(e) => {
                  setBankHolder(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ex: IMMOGEST MAROC SARL"
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
                    ribValid ? 'text-emerald-700' : 'text-slate-500'
                  }`}
                >
                  {normalizeRibDigits(bankRib).replace(/\D/g, '').length} / 24
                </span>
              </div>
              <input
                type="text"
                value={bankRib}
                onChange={(e) => {
                  setBankRib(e.target.value);
                  setDirty(true);
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
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-700">
                  {tr('IBAN Maroc (MA + 26 chiffres)', 'IBAN (اختياري)')}
                </span>
                {ibanClean && (
                  <span
                    className={`text-[11px] font-bold ${ibanValid ? 'text-emerald-700' : 'text-rose-700'}`}
                  >
                    {ibanValid ? '✓' : tr('Format invalide', 'صيغة غير صالحة')}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={bankIban}
                onChange={(e) => {
                  setBankIban(e.target.value);
                  setDirty(true);
                }}
                placeholder="MA64007780000123456789012345"
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700">SWIFT / BIC</span>
                  {swiftClean && (
                    <span
                      className={`text-[11px] font-bold ${swiftValid ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {swiftValid ? '✓' : '!'}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={bankSwift}
                  onChange={(e) => {
                    setBankSwift(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="BCMAMAMC"
                  className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-700">ICE (15 ch.)</span>
                  {iceClean && (
                    <span
                      className={`text-[11px] font-bold ${iceValid ? 'text-emerald-700' : 'text-rose-700'}`}
                    >
                      {iceValid ? '✓' : `${iceClean.length}/15`}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={bankIce}
                  onChange={(e) => {
                    setBankIce(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="001234567000089"
                  className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
                />
              </label>
            </div>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Instructions affichées au syndic (FR)', 'تعليمات (فرنسي)')}
              </span>
              <textarea
                rows={2}
                value={bankInstructionsFr}
                onChange={(e) => {
                  setBankInstructionsFr(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
              />
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Instructions affichées au syndic (AR)', 'تعليمات (عربي)')}
              </span>
              <textarea
                rows={2}
                dir="rtl"
                value={bankInstructionsAr}
                onChange={(e) => {
                  setBankInstructionsAr(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
              />
            </label>
          </div>
        </div>

        {/* Section 4: Hybrid Cash, Agencies (Wafacash / Cash Plus / Barid Cash) & Check */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4 sm:p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {tr(
                  '4. Paiement en Espèces, Agences Cash (Wafacash / Cash Plus) & Chèque',
                  '4. الدفع نقداً، وكالات التحويل (وفاكاش / كاش بلوس) والشيك',
                )}
              </h3>
              <p className="text-slate-600 mt-0.5">
                {tr(
                  'Permet aux syndics de déclarer un dépôt espèces/agence avec reçu à valider, et à l’administration d’encaisser directement au guichet.',
                  'يمكّن السنديك من إرسال وصل الدفع النقدي أو الوكالة للمراجعة، وللإدارة التسجيل المباشر بالشباك.',
                )}
              </p>
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-300 bg-white font-bold text-amber-950 cursor-pointer">
              <input
                type="checkbox"
                checked={cashEnabled}
                onChange={(e) => {
                  setCashEnabled(e.target.checked);
                  setDirty(true);
                }}
              />
              <span>
                {cashEnabled
                  ? tr('Espèces / Agences activé', 'الدفع النقدي مفعل')
                  : tr('Espèces / Agences désactivé', 'الدفع النقدي معطل')}
              </span>
            </label>
          </div>

          <div>
            <span className="font-bold text-slate-700 block mb-1.5">
              {tr('Canaux acceptés *', 'القنوات المقبولة *')}
            </span>
            <div className="flex flex-wrap gap-2">
              {CASH_CHANNEL_OPTIONS.map((ch) => {
                const checked = cashChannels.includes(ch.id);
                return (
                  <label
                    key={ch.id}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-semibold cursor-pointer transition-colors ${
                      checked
                        ? 'border-amber-600 bg-amber-100/80 text-amber-950'
                        : 'border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCashChannel(ch.id)}
                    />
                    <span>{language === 'ar' ? ch.labelAr : ch.labelFr}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Bénéficiaire (Nom / Société) *', 'المستفيد (الاسم / الشركة) *')}
              </span>
              <input
                type="text"
                value={cashBeneficiary}
                onChange={(e) => {
                  setCashBeneficiary(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ex: ImmoGest Maroc SARL"
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
              />
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Adresse du bureau / guichet', 'عنوان المكتب / الشباك')}
              </span>
              <input
                type="text"
                value={cashAddress}
                onChange={(e) => {
                  setCashAddress(e.target.value);
                  setDirty(true);
                }}
                placeholder="Ex: 45 Bd d’Anfa, Casablanca"
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
              />
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Horaires d’ouverture', 'أوقات العمل')}
              </span>
              <input
                type="text"
                value={cashHours}
                onChange={(e) => {
                  setCashHours(e.target.value);
                  setDirty(true);
                }}
                placeholder="Lun–Ven 09h00–17h30"
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
              />
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Téléphone guichet', 'هاتف الشباك')}
              </span>
              <input
                type="text"
                value={cashPhone}
                onChange={(e) => {
                  setCashPhone(e.target.value);
                  setDirty(true);
                }}
                placeholder="+212 5 22 00 00 00"
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">WhatsApp</span>
              <input
                type="text"
                value={cashWhatsapp}
                onChange={(e) => {
                  setCashWhatsapp(e.target.value);
                  setDirty(true);
                }}
                placeholder="+212 6 00 00 00 00"
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr(
                  'Plafond espèces MAD (CGI Art. 193, 0 = illimité)',
                  'سقف الدفع نقداً بالدرهم (0 = غير محدود)',
                )}
              </span>
              <input
                type="number"
                min={0}
                max={1000000}
                value={cashMaxAmount}
                onChange={(e) => {
                  setCashMaxAmount(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
            <input
              type="checkbox"
              checked={cashRequireProof}
              onChange={(e) => {
                setCashRequireProof(e.target.checked);
                setDirty(true);
              }}
            />
            <span>
              {tr(
                'Exiger le téléversement du reçu (photo/PDF) pour les demandes espèces & agences',
                'إلزامية إرفاق وصل الإيداع (صورة أو PDF) لطلبات الدفع النقدي والوكالات',
              )}
            </span>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Instructions espèces (FR)', 'تعليمات الدفع النقدي (فرنسي)')}
              </span>
              <textarea
                rows={2}
                value={cashInstructionsFr}
                onChange={(e) => {
                  setCashInstructionsFr(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
              />
            </label>

            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Instructions espèces (AR)', 'تعليمات الدفع النقدي (عربي)')}
              </span>
              <textarea
                rows={2}
                dir="rtl"
                value={cashInstructionsAr}
                onChange={(e) => {
                  setCashInstructionsAr(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
              />
            </label>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
          >
            {error}
          </div>
        )}
        {message && (
          <div
            role="status"
            className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold"
          >
            {message}
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
                  disabled={saving}
                  onClick={() => void handleResetToEnv()}
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
            disabled={saving}
            onClick={() => void handleSave()}
            className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
          >
            {saving
              ? tr('Enregistrement...', 'جاري الحفظ...')
              : tr('Enregistrer toutes les passerelles', 'حفظ جميع بوابات الدفع')}
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default AdminGatewaysTab;
