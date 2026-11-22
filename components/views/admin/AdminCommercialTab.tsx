import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Card from '../../common/Card';
import Button from '../../common/Button';
import { useI18n } from '../../../hooks/useI18n';
import {
  createAdminPromo,
  deleteAdminPromo,
  getAdminPromos,
  saveAdminBillingConfig,
  updateAdminPromo,
} from '../../../firebase/services';
import { PLANS, PLAN_CATALOG } from '../../../utils/subscriptionPolicy';
import type {
  AdminPlatformBillingConfig,
  PromoDiscountType,
  SubscriptionPlan,
  SubscriptionPromoCode,
} from '../../../types';

interface AdminCommercialTabProps {
  adminBillingConfig?: AdminPlatformBillingConfig;
}

const AdminCommercialTab: React.FC<AdminCommercialTabProps> = ({
  adminBillingConfig,
}) => {
  const { tr, language } = useI18n();
  const queryClient = useQueryClient();

  const [dirty, setDirty] = useState(false);

  // Issuer Profile
  const [companyName, setCompanyName] = useState('SyndicUnion Maroc');
  const [legalForm, setLegalForm] = useState('SARL');
  const [ice, setIce] = useState('');
  const [rc, setRc] = useState('');
  const [ifNumber, setIfNumber] = useState('');
  const [patente, setPatente] = useState('');
  const [cnss, setCnss] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('Casablanca');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [vatRate, setVatRate] = useState<0 | 20>(0);
  const [invoicePrefix, setInvoicePrefix] = useState('FAC');
  const [receiptPrefix, setReceiptPrefix] = useState('REC');

  // Commercial Policy
  const [gracePeriodDays, setGracePeriodDays] = useState('0');
  const [disc3m, setDisc3m] = useState('0');
  const [disc6m, setDisc6m] = useState('0');
  const [disc12m, setDisc12m] = useState('0');

  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyMsg, setPolicyMsg] = useState('');
  const [policyErr, setPolicyErr] = useState('');

  // Promo Code Creation Form
  const [promoCode, setPromoCode] = useState('');
  const [promoType, setPromoType] = useState<PromoDiscountType>('percent');
  const [promoValue, setPromoValue] = useState('10');
  const [promoMinMonths, setPromoMinMonths] = useState('1');
  const [promoMaxUses, setPromoMaxUses] = useState('');
  const [promoValidUntil, setPromoValidUntil] = useState('');
  const [promoDesc, setPromoDesc] = useState('');
  const [promoPlans, setPromoPlans] = useState<SubscriptionPlan[]>([]);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMsg, setPromoMsg] = useState('');
  const [promoErr, setPromoErr] = useState('');

  const { data: promos = [], refetch: refetchPromos } = useQuery({
    queryKey: ['adminPromos'],
    queryFn: getAdminPromos,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!adminBillingConfig || dirty) return;
    const iss = adminBillingConfig.issuerProfile;
    const com = adminBillingConfig.commercialPolicy;
    if (iss) {
      setCompanyName(iss.companyName || 'SyndicUnion Maroc');
      setLegalForm(iss.legalForm || 'SARL');
      setIce(iss.ice || '');
      setRc(iss.rc || '');
      setIfNumber(iss.ifNumber || '');
      setPatente(iss.patente || '');
      setCnss(iss.cnss || '');
      setAddress(iss.address || '');
      setCity(iss.city || 'Casablanca');
      setEmail(iss.email || '');
      setPhone(iss.phone || '');
      setWhatsapp(iss.whatsapp || '');
      setVatRate(iss.vatRate === 20 ? 20 : 0);
      setInvoicePrefix(iss.invoicePrefix || 'FAC');
      setReceiptPrefix(iss.receiptPrefix || 'REC');
    }
    if (com) {
      setGracePeriodDays(String(com.gracePeriodDays ?? 0));
      setDisc3m(String(com.multiMonthDiscounts?.m3 ?? 0));
      setDisc6m(String(com.multiMonthDiscounts?.m6 ?? 0));
      setDisc12m(String(com.multiMonthDiscounts?.m12 ?? 0));
    }
  }, [adminBillingConfig, dirty]);

  const handleSaveCommercial = async () => {
    if (!adminBillingConfig) return;
    setPolicyErr('');
    setPolicyMsg('');
    setSavingPolicy(true);
    try {
      const updated = await saveAdminBillingConfig({
        paypal: {
          enabled: adminBillingConfig.paypal.enabled,
          env: adminBillingConfig.paypal.env,
          checkoutMode: adminBillingConfig.paypal.checkoutMode,
          clientId: adminBillingConfig.paypal.clientId,
          allowLiveWithoutWebhook:
            adminBillingConfig.paypal.allowLiveWithoutWebhook,
          currency: adminBillingConfig.paypal.currency,
          madPerUnit: adminBillingConfig.paypal.madPerUnit,
          planPrices: adminBillingConfig.paypal.planPrices,
        },
        bankTransfer: {
          enabled: adminBillingConfig.bankTransfer.enabled,
          bankName: adminBillingConfig.bankTransfer.bankName,
          accountHolder: adminBillingConfig.bankTransfer.accountHolder,
          rib: adminBillingConfig.bankTransfer.rib,
          iban: adminBillingConfig.bankTransfer.iban,
          swift: adminBillingConfig.bankTransfer.swift,
          ice: adminBillingConfig.bankTransfer.ice,
          instructionsFr: adminBillingConfig.bankTransfer.instructionsFr,
          instructionsAr: adminBillingConfig.bankTransfer.instructionsAr,
        },
        issuerProfile: {
          companyName: companyName.trim(),
          legalForm: legalForm.trim(),
          ice: ice.trim(),
          rc: rc.trim(),
          ifNumber: ifNumber.trim(),
          patente: patente.trim(),
          cnss: cnss.trim(),
          address: address.trim(),
          city: city.trim(),
          email: email.trim(),
          phone: phone.trim(),
          whatsapp: whatsapp.trim(),
          vatRate,
          invoicePrefix: invoicePrefix.trim().toUpperCase(),
          receiptPrefix: receiptPrefix.trim().toUpperCase(),
        },
        commercialPolicy: {
          gracePeriodDays: Math.min(30, Math.max(0, Number(gracePeriodDays) || 0)),
          multiMonthDiscounts: {
            m3: Math.min(50, Math.max(0, Number(disc3m) || 0)),
            m6: Math.min(50, Math.max(0, Number(disc6m) || 0)),
            m12: Math.min(50, Math.max(0, Number(disc12m) || 0)),
          },
        },
      });
      queryClient.setQueryData(['adminBillingConfig'], updated);
      setDirty(false);
      setPolicyMsg(
        tr(
          'Profil fiscal Maroc, remises multi-mois et période de grâce enregistrés.',
          'تم حفظ الملف الضريبي والخصومات وفترة السماح بنجاح.',
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: ['subscriptionBillingConfig'],
      });
    } catch (err: unknown) {
      setPolicyErr(
        err instanceof Error
          ? err.message
          : tr('Enregistrement impossible.', 'تعذر الحفظ.'),
      );
    } finally {
      setSavingPolicy(false);
    }
  };

  const togglePromoPlan = (plan: SubscriptionPlan) => {
    setPromoPlans((prev) =>
      prev.includes(plan) ? prev.filter((p) => p !== plan) : [...prev, plan],
    );
  };

  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    setPromoErr('');
    setPromoMsg('');
    const cleanCode = promoCode.trim().toUpperCase();
    const numVal = Number(promoValue);
    if (!/^[A-Z0-9_-]{3,32}$/.test(cleanCode)) {
      setPromoErr(
        tr(
          'Code invalide (3 à 32 caractères alphanumériques, tirets ou underscores).',
          'رمز غير صالح (3 إلى 32 حرفاً أو رقماً).',
        ),
      );
      return;
    }
    if (!Number.isFinite(numVal) || numVal <= 0) {
      setPromoErr(tr('Valeur de remise invalide.', 'قيمة الخصم غير صالحة.'));
      return;
    }
    setPromoBusy(true);
    try {
      await createAdminPromo({
        code: cleanCode,
        discountType: promoType,
        discountValue: numVal,
        minMonths: Math.max(1, Math.min(12, Number(promoMinMonths) || 1)),
        ...(promoMaxUses.trim()
          ? { maxUses: Math.max(1, Number(promoMaxUses) || 1) }
          : {}),
        ...(promoValidUntil.trim() ? { validUntil: promoValidUntil.trim() } : {}),
        ...(promoDesc.trim() ? { description: promoDesc.trim() } : {}),
        ...(promoPlans.length > 0 ? { applicablePlans: promoPlans } : {}),
      });
      setPromoCode('');
      setPromoDesc('');
      setPromoMaxUses('');
      setPromoValidUntil('');
      setPromoPlans([]);
      setPromoMsg(
        tr(
          `Code promo ${cleanCode} créé avec succès.`,
          `تم إنشاء الرمز الترويجي ${cleanCode} بنجاح.`,
        ),
      );
      await refetchPromos();
    } catch (err: unknown) {
      setPromoErr(
        err instanceof Error
          ? err.message
          : tr('Impossible de créer le code promo.', 'تعذر إنشاء الرمز الترويجي.'),
      );
    } finally {
      setPromoBusy(false);
    }
  };

  const handleTogglePromo = async (promo: SubscriptionPromoCode) => {
    setPromoErr('');
    try {
      await updateAdminPromo(promo.id, { active: !promo.active });
      await refetchPromos();
    } catch (err: unknown) {
      setPromoErr(
        err instanceof Error ? err.message : tr('Mise à jour échouée.', 'فشل التحديث.'),
      );
    }
  };

  const handleDeletePromo = async (promo: SubscriptionPromoCode) => {
    setPromoErr('');
    try {
      await deleteAdminPromo(promo.id);
      await refetchPromos();
    } catch (err: unknown) {
      setPromoErr(
        err instanceof Error ? err.message : tr('Suppression échouée.', 'فشل الحذف.'),
      );
    }
  };

  const iceDigits = ice.replace(/\s+/g, '');

  return (
    <div className="space-y-6">
      {/* Section 1: Moroccan SaaS Issuer Profile & Fiscal Mentions */}
      <Card className="p-5 border border-slate-200 space-y-4 text-xs">
        <div className="border-b border-slate-200 pb-3">
          <h2 className="text-base font-bold text-slate-900">
            {tr(
              'Profil Émetteur Maroc & Mentions Légales (Factures / Reçus PDF)',
              'بيانات المُصدر والضرائب المغربية (فواتير ووصولات PDF)',
            )}
          </h2>
          <p className="text-slate-500 mt-0.5">
            {tr(
              'Informations imprimées sur chaque Facture SaaS et Reçu de Caisse téléchargés par l’administrateur ou le syndic.',
              'المعلومات المطبوعة على كل فاتورة اشتراك أو وصل نقدي يحمّله المدير أو السنديك.',
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="font-bold text-slate-700">
              {tr('Raison sociale', 'الاسم التجاري')}
            </span>
            <input
              type="text"
              value={companyName}
              onChange={(e) => {
                setCompanyName(e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
            />
          </label>
          <label className="block">
            <span className="font-bold text-slate-700">
              {tr('Forme juridique', 'الشكل القانوني')}
            </span>
            <select
              value={legalForm}
              onChange={(e) => {
                setLegalForm(e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-semibold"
            >
              <option value="SARL">SARL</option>
              <option value="SARL AU">SARL AU</option>
              <option value="SA">SA</option>
              <option value="Auto-Entrepreneur">Auto-Entrepreneur</option>
            </select>
          </label>
          <label className="block">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">ICE (15 chiffres)</span>
              <span
                className={`font-mono text-[11px] font-bold ${
                  /^\d{15}$/.test(iceDigits) ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                {iceDigits.length}/15
              </span>
            </div>
            <input
              type="text"
              value={ice}
              onChange={(e) => {
                setIce(e.target.value);
                setDirty(true);
              }}
              placeholder="001234567000089"
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </label>

          <label className="block">
            <span className="font-bold text-slate-700">RC</span>
            <input
              type="text"
              value={rc}
              onChange={(e) => {
                setRc(e.target.value);
                setDirty(true);
              }}
              placeholder="RC 412345"
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </label>
          <label className="block">
            <span className="font-bold text-slate-700">
              {tr('Identifiant Fiscal (IF)', 'التعريف الضريبي (IF)')}
            </span>
            <input
              type="text"
              value={ifNumber}
              onChange={(e) => {
                setIfNumber(e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </label>
          <label className="block">
            <span className="font-bold text-slate-700">
              {tr('Taxe Professionnelle (Patente)', 'الضريبة المهنية (الباتانتا)')}
            </span>
            <input
              type="text"
              value={patente}
              onChange={(e) => {
                setPatente(e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="font-bold text-slate-700">
              {tr('Adresse siège social', 'عنوان المقر الاجتماعي')}
            </span>
            <input
              type="text"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
            />
          </label>
          <label className="block">
            <span className="font-bold text-slate-700">{tr('Ville', 'المدينة')}</span>
            <input
              type="text"
              value={city}
              onChange={(e) => {
                setCity(e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
            />
          </label>

          <label className="block">
            <span className="font-bold text-slate-700">
              {tr('Email support facturation', 'بريد دعم الفوترة')}
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
            />
          </label>
          <label className="block">
            <span className="font-bold text-slate-700">{tr('Téléphone', 'الهاتف')}</span>
            <input
              type="text"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </label>
          <label className="block">
            <span className="font-bold text-slate-700">CNSS (optionnel)</span>
            <input
              type="text"
              value={cnss}
              onChange={(e) => {
                setCnss(e.target.value);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </label>

          <label className="block">
            <span className="font-bold text-slate-700">
              {tr('Régime TVA Maroc', 'نظام الضريبة على القيمة المضافة TVA')}
            </span>
            <select
              value={vatRate}
              onChange={(e) => {
                setVatRate(Number(e.target.value) === 20 ? 20 : 0);
                setDirty(true);
              }}
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-semibold"
            >
              <option value={0}>
                {tr('0% — Exonéré / Auto-entrepreneur', '0% — معفى')}
              </option>
              <option value={20}>
                {tr('20% — Assujetti TVA Maroc (TTC inclus)', '20% — خاضع لـ TVA (شامل الضريبة)')}
              </option>
            </select>
          </label>
          <label className="block">
            <span className="font-bold text-slate-700">
              {tr('Préfixe Facture', 'بادئة الفاتورة')}
            </span>
            <input
              type="text"
              maxLength={8}
              value={invoicePrefix}
              onChange={(e) => {
                setInvoicePrefix(e.target.value.toUpperCase());
                setDirty(true);
              }}
              placeholder="FAC"
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </label>
          <label className="block">
            <span className="font-bold text-slate-700">
              {tr('Préfixe Reçu Espèces', 'بادئة الوصل النقدي')}
            </span>
            <input
              type="text"
              maxLength={8}
              value={receiptPrefix}
              onChange={(e) => {
                setReceiptPrefix(e.target.value.toUpperCase());
                setDirty(true);
              }}
              placeholder="REC"
              className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
            />
          </label>
        </div>

        {/* Section 2: Commercial Policy (Discounts & Grace Period) */}
        <div className="pt-4 border-t border-slate-200 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">
            {tr(
              'Remises Multi-Mois & Période de Grâce Post-Échéance',
              'خصومات الاشتراك الطويل وفترة السماح بعد الانتهاء',
            )}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Remise 3 mois (%)', 'خصم 3 أشهر (%)')}
              </span>
              <input
                type="number"
                min={0}
                max={50}
                step="0.5"
                value={disc3m}
                onChange={(e) => {
                  setDisc3m(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Remise 6 mois (%)', 'خصم 6 أشهر (%)')}
              </span>
              <input
                type="number"
                min={0}
                max={50}
                step="0.5"
                value={disc6m}
                onChange={(e) => {
                  setDisc6m(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Remise 12 mois (%)', 'خصم 12 شهراً (%)')}
              </span>
              <input
                type="number"
                min={0}
                max={50}
                step="0.5"
                value={disc12m}
                onChange={(e) => {
                  setDisc12m(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
            <label className="block">
              <span className="font-bold text-slate-700">
                {tr('Période de grâce (0–30 jours)', 'فترة السماح (0–30 يوماً)')}
              </span>
              <input
                type="number"
                min={0}
                max={30}
                value={gracePeriodDays}
                onChange={(e) => {
                  setGracePeriodDays(e.target.value);
                  setDirty(true);
                }}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-2">
            {(['starter', 'professional', 'enterprise'] as const).map((planKey) => {
              const base = PLANS[planKey].price;
              const p6 = Number(((base * 6 * (100 - (Number(disc6m) || 0))) / 100).toFixed(2));
              const p12 = Number(((base * 12 * (100 - (Number(disc12m) || 0))) / 100).toFixed(2));
              const entry = PLAN_CATALOG[planKey];
              return (
                <div key={planKey} className="p-2.5 rounded-lg bg-white border border-slate-200">
                  <div className="font-bold text-slate-900">
                    {language === 'ar' ? entry.nameAr : entry.nameFr} · {base} MAD/m
                  </div>
                  <div className="text-[11px] text-slate-600 font-mono mt-1">
                    6m: {p6.toLocaleString('fr-MA')} MAD · 12m: {p12.toLocaleString('fr-MA')} MAD
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {policyErr && (
          <div role="alert" className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
            {policyErr}
          </div>
        )}
        {policyMsg && (
          <div role="status" className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold">
            {policyMsg}
          </div>
        )}

        <div className="flex justify-end pt-2 border-t border-slate-200">
          <Button
            type="button"
            disabled={savingPolicy}
            onClick={() => void handleSaveCommercial()}
            className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
          >
            {savingPolicy
              ? tr('Enregistrement...', 'جاري الحفظ...')
              : tr('Enregistrer le profil fiscal & politique', 'حفظ البيانات الضريبية والخصومات')}
          </Button>
        </div>
      </Card>

      {/* Section 3: Promotional Codes Manager */}
      <Card className="p-5 border border-slate-200 space-y-4 text-xs">
        <div className="border-b border-slate-200 pb-3">
          <h2 className="text-base font-bold text-slate-900">
            {tr('Codes Promotionnels SaaS', 'الرموز الترويجية (كوبونات)')} ({promos.length})
          </h2>
          <p className="text-slate-500 mt-0.5">
            {tr(
              'Applicables sur CMI, PayPal, Virement, Espèces et encaissements guichet. Les usages sont décomptés automatiquement et restaurés en cas d’annulation.',
              'صالحة عبر CMI وPayPal والتحويل والنقد مع احتساب تلقائي لعدد الاستعمالات.',
            )}
          </p>
        </div>

        <form onSubmit={handleCreatePromo} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <label className="block">
              <span className="font-bold text-slate-700">{tr('Code *', 'الرمز *')}</span>
              <input
                type="text"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="RAMADAN20"
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono uppercase"
              />
            </label>
            <label className="block">
              <span className="font-bold text-slate-700">{tr('Type', 'النوع')}</span>
              <select
                value={promoType}
                onChange={(e) => setPromoType(e.target.value as PromoDiscountType)}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-semibold"
              >
                <option value="percent">{tr('Pourcentage (%)', 'نسبة مئوية (%)')}</option>
                <option value="fixed_mad">{tr('Montant fixe (MAD)', 'مبلغ ثابت (درهم)')}</option>
              </select>
            </label>
            <label className="block">
              <span className="font-bold text-slate-700">
                {promoType === 'percent' ? tr('Remise (%) *', 'النسبة (%) *') : tr('Remise (MAD) *', 'المبلغ (درهم) *')}
              </span>
              <input
                type="number"
                step="0.5"
                min="1"
                max={promoType === 'percent' ? 95 : 100000}
                value={promoValue}
                onChange={(e) => setPromoValue(e.target.value)}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
            <label className="block">
              <span className="font-bold text-slate-700">{tr('Durée min. (mois)', 'المدة الدنيا (أشهر)')}</span>
              <input
                type="number"
                min={1}
                max={12}
                value={promoMinMonths}
                onChange={(e) => setPromoMinMonths(e.target.value)}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
            <label className="block">
              <span className="font-bold text-slate-700">{tr('Max utilisations', 'الحد الأقصى')}</span>
              <input
                type="number"
                min={1}
                placeholder={tr('Illimité', 'غير محدود')}
                value={promoMaxUses}
                onChange={(e) => setPromoMaxUses(e.target.value)}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <label className="block">
              <span className="font-bold text-slate-700">{tr('Expire le (optionnel)', 'تاريخ الانتهاء')}</span>
              <input
                type="date"
                value={promoValidUntil}
                onChange={(e) => setPromoValidUntil(e.target.value)}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </label>
            <label className="block">
              <span className="font-bold text-slate-700">{tr('Description', 'الوصف')}</span>
              <input
                type="text"
                value={promoDesc}
                onChange={(e) => setPromoDesc(e.target.value)}
                placeholder={tr('Ex: Offre lancement Casablanca', 'مثال: عرض الإطلاق')}
                className="mt-1 w-full p-2 rounded-lg border border-slate-300 bg-white"
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(['starter', 'professional', 'enterprise'] as const).map((pl) => (
                  <label
                    key={pl}
                    className={`px-2 py-1 rounded border cursor-pointer font-semibold ${
                      promoPlans.includes(pl)
                        ? 'bg-teal-100 border-teal-500 text-teal-900'
                        : 'bg-white border-slate-300 text-slate-600'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={promoPlans.includes(pl)}
                      onChange={() => togglePromoPlan(pl)}
                    />
                    {pl}
                  </label>
                ))}
              </div>
              <Button
                type="submit"
                disabled={promoBusy}
                className="bg-slate-900 hover:bg-slate-800 text-white font-bold"
              >
                {promoBusy ? tr('Création...', 'جاري الإنشاء...') : tr('+ Créer le code', '+ إضافة رمز')}
              </Button>
            </div>
          </div>
        </form>

        {promoErr && (
          <div role="alert" className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 font-semibold">
            {promoErr}
          </div>
        )}
        {promoMsg && (
          <div role="status" className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-semibold">
            {promoMsg}
          </div>
        )}

        {promos.length === 0 ? (
          <p className="text-slate-500 py-3 text-center">
            {tr('Aucun code promotionnel créé pour le moment.', 'لا توجد رموز ترويجية حالياً.')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">Code</th>
                  <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">{tr('Remise', 'الخصم')}</th>
                  <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">{tr('Conditions', 'الشروط')}</th>
                  <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">{tr('Utilisations', 'الاستعمالات')}</th>
                  <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">{tr('Statut', 'الحالة')}</th>
                  <th className="px-3 py-2 text-end font-bold text-slate-500 uppercase">{tr('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {promos.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2.5 font-mono font-bold text-slate-900">
                      {p.code}
                      {p.description && (
                        <div className="font-sans font-normal text-[11px] text-slate-500">
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono font-bold text-teal-800">
                      {p.discountType === 'percent'
                        ? `-${p.discountValue}%`
                        : `-${p.discountValue} MAD`}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {p.minMonths && p.minMonths > 1 ? `≥ ${p.minMonths}m ` : ''}
                      {p.applicablePlans?.length ? `(${p.applicablePlans.join(', ')}) ` : tr('Tous forfaits', 'كل الباقات')}
                      {p.validUntil ? ` · exp. ${p.validUntil}` : ''}
                    </td>
                    <td className="px-3 py-2.5 font-mono">
                      {p.usedCount} / {p.maxUses ?? '∞'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full font-bold ${
                          p.active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {p.active ? tr('Actif', 'نشط') : tr('Inactif', 'معطل')}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-end space-x-1.5">
                      <button
                        type="button"
                        onClick={() => void handleTogglePromo(p)}
                        className="px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-100 font-semibold text-slate-700"
                      >
                        {p.active ? tr('Désactiver', 'تعطيل') : tr('Activer', 'تفعيل')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeletePromo(p)}
                        className="px-2.5 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 font-semibold"
                      >
                        {tr('Supprimer', 'حذف')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AdminCommercialTab;
