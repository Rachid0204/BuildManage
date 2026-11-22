import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  Check,
  Copy,
  CreditCard,
  Download,
  FileUp,
  Landmark,
  ShieldCheck,
  Sparkles,
  Tag,
} from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { useI18n } from '../../hooks/useI18n';
import {
  capturePayPalSubscriptionOrder,
  createCmiSubscriptionPayment,
  createPayPalSubscriptionOrder,
  getSubscriptionBankTransferRequests,
  getSubscriptionBillingConfig,
  getSubscriptionPayments,
  openAuthenticatedUpload,
  submitSubscriptionBankTransfer,
  uploadSubscriptionProof,
  validateSubscriptionPromoCode,
} from '../../firebase/services';
import type { SubscriptionPricingPreview } from '../../firebase/services';
import { generateSubscriptionInvoicePDF } from '../../services/pdfOnDemand';
import { PLANS, PLAN_CATALOG } from '../../utils/subscriptionPolicy';
import { isIosNativeApp } from '../../utils/nativeBridge';
import {
  getCashChannelLabel,
  getMethodBadgeMeta,
} from './admin/adminBillingHelpers';
import type {
  CashChannel,
  PublicPlatformBillingConfig,
  SubscriptionPayment,
  SubscriptionPlan,
  Syndic,
} from '../../types';

interface PayPalButtonsInstance {
  render: (container: HTMLElement) => Promise<void>;
  close?: () => Promise<void>;
}

interface PayPalFieldInstance {
  render: (container: HTMLElement) => Promise<void>;
  close?: () => Promise<void>;
}

interface PayPalCardFieldsInstance {
  isEligible: () => boolean;
  NameField: (options?: { style?: Record<string, unknown> }) => PayPalFieldInstance;
  NumberField: (options?: { style?: Record<string, unknown> }) => PayPalFieldInstance;
  ExpiryField: (options?: { style?: Record<string, unknown> }) => PayPalFieldInstance;
  CVVField: (options?: { style?: Record<string, unknown> }) => PayPalFieldInstance;
  submit: () => Promise<void>;
}

interface PayPalNamespace {
  Buttons?: (options: {
    style?: Record<string, unknown>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
  }) => PayPalButtonsInstance;
  CardFields?: (options: {
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onCancel?: () => void;
    onError?: (err: unknown) => void;
    inputEvents?: {
      onChange?: (data: { isFormValid?: boolean }) => void;
    };
  }) => PayPalCardFieldsInstance;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

type PaymentTab = 'cmi' | 'paypal' | 'virement' | 'cash';

const MOROCCAN_BANKS = [
  'Attijariwafa Bank',
  'Banque Populaire (BCP)',
  'Bank of Africa (BMCE)',
  'CIH Bank',
  'Société Générale Maroc',
  'Crédit du Maroc',
  'Crédit Agricole du Maroc',
  'Al Barid Bank',
  'CFG Bank',
  'Umnia Bank',
  'Bank Assafa',
];

const DURATIONS = [
  { months: 1, labelFr: '1 mois', labelAr: 'شهر واحد' },
  { months: 3, labelFr: '3 mois', labelAr: '3 أشهر' },
  { months: 6, labelFr: '6 mois', labelAr: '6 أشهر' },
  { months: 12, labelFr: '12 mois', labelAr: '12 شهراً' },
] as const;

function getMultiMonthDiscountPct(
  config: PublicPlatformBillingConfig | undefined,
  months: number,
): number {
  const disc = config?.commercialPolicy?.multiMonthDiscounts;
  if (!disc) return 0;
  if (months >= 12) return disc.m12 || 0;
  if (months >= 6) return disc.m6 || 0;
  if (months >= 3) return disc.m3 || 0;
  return 0;
}

function computeLocalEstimatedPricing(
  config: PublicPlatformBillingConfig | undefined,
  plan: SubscriptionPlan,
  months: number,
) {
  const monthlyMad = PLANS[plan].price;
  const baseAmountMad = monthlyMad * months;
  const multiMonthDiscountPct = getMultiMonthDiscountPct(config, months);
  const multiMonthDiscountMad = Number(
    ((baseAmountMad * multiMonthDiscountPct) / 100).toFixed(2),
  );
  const amountMad = Math.max(
    1,
    Number((baseAmountMad - multiMonthDiscountMad).toFixed(2)),
  );
  const vatRate = config?.issuerProfile?.vatRate === 20 ? 20 : 0;
  const totalHtMad =
    vatRate > 0 ? Number((amountMad / (1 + vatRate / 100)).toFixed(2)) : amountMad;
  const vatAmountMad = Number((amountMad - totalHtMad).toFixed(2));

  const override = config?.paypal.planPrices?.[plan];
  const basePaypalCents =
    typeof override === 'number' && override > 0
      ? Math.round(override * 100) * months
      : Math.max(
          100,
          Math.round((baseAmountMad / (config?.paypal.madPerUnit || 10)) * 100),
        );
  const ratio = baseAmountMad > 0 ? amountMad / baseAmountMad : 1;
  const paypalAmount = Number(
    (Math.max(100, Math.round(basePaypalCents * ratio)) / 100).toFixed(2),
  );

  return {
    baseAmountMad,
    multiMonthDiscountPct,
    multiMonthDiscountMad,
    promoDiscountMad: 0,
    totalDiscountMad: multiMonthDiscountMad,
    amountMad,
    vatRate,
    totalHtMad,
    vatAmountMad,
    paypalAmount,
  };
}

function loadPayPalSdk(
  config: PublicPlatformBillingConfig['paypal'],
  locale: string,
): Promise<PayPalNamespace> {
  if (!config.enabled || !config.clientId) {
    return Promise.reject(new Error('PayPal non configuré.'));
  }
  const components =
    config.checkoutMode === 'expanded' ? 'buttons,card-fields' : 'buttons';
  const sdkKey = `${config.clientId}:${config.currency}:${components}:${locale}`;
  const existing = document.querySelector<HTMLScriptElement>(
    'script[data-immogest-paypal-sdk="1"]',
  );

  if (existing && existing.dataset.sdkKey === sdkKey && window.paypal) {
    return Promise.resolve(window.paypal);
  }
  if (existing) {
    existing.remove();
    delete window.paypal;
  }

  return new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      config.clientId,
    )}&currency=${encodeURIComponent(config.currency)}&intent=capture&components=${encodeURIComponent(
      components,
    )}&locale=${encodeURIComponent(locale)}`;
    script.async = true;
    script.dataset.immogestPaypalSdk = '1';
    script.dataset.sdkKey = sdkKey;
    script.onload = () => {
      if (window.paypal) resolve(window.paypal);
      else reject(new Error('SDK PayPal indisponible après chargement.'));
    };
    script.onerror = () =>
      reject(
        new Error(
          'Impossible de charger le module de paiement PayPal. Vérifiez votre connexion internet ou choisissez un autre moyen de paiement.',
        ),
      );
    document.head.appendChild(script);
  });
}

function submitHiddenCmiForm(
  gatewayUrl: string,
  fields: Record<string, string>,
): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = gatewayUrl;
  form.acceptCharset = 'UTF-8';
  form.style.display = 'none';
  for (const [key, value] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = key;
    input.value = String(value ?? '');
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

const SubscriptionRenewalModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  syndic: Syndic;
}> = ({ isOpen, onClose, syndic }) => {
  const { tr, language } = useI18n();
  const queryClient = useQueryClient();

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>(
    syndic.subscriptionPlan || 'professional',
  );
  const [selectedMonths, setSelectedMonths] = useState<number>(6);
  const [paymentTab, setPaymentTab] = useState<PaymentTab>('cmi');

  // Promo code state
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromoCode, setAppliedPromoCode] = useState<string | undefined>(
    undefined,
  );
  const [appliedPromoDesc, setAppliedPromoDesc] = useState('');
  const [promoPricing, setPromoPricing] =
    useState<SubscriptionPricingPreview | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');

  // CMI state
  const [cmiRedirecting, setCmiRedirecting] = useState(false);
  const [cmiError, setCmiError] = useState('');

  // PayPal / CardFields state
  const paypalButtonsContainerRef = useRef<HTMLDivElement>(null);
  const cardNameRef = useRef<HTMLDivElement>(null);
  const cardNumberRef = useRef<HTMLDivElement>(null);
  const cardExpiryRef = useRef<HTMLDivElement>(null);
  const cardCvvRef = useRef<HTMLDivElement>(null);
  const cardFieldsInstanceRef = useRef<PayPalCardFieldsInstance | null>(null);
  const [sdkState, setSdkState] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');
  const [sdkError, setSdkError] = useState('');
  const [cardEligible, setCardEligible] = useState(false);
  const [cardSubmitting, setCardSubmitting] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState('');
  const [checkoutError, setCheckoutError] = useState('');
  const [lastPaidRecord, setLastPaidRecord] =
    useState<SubscriptionPayment | null>(null);

  // Bank transfer form state
  const [copiedField, setCopiedField] = useState<
    'rib' | 'motif' | 'whatsapp' | null
  >(null);
  const [transferBank, setTransferBank] = useState(MOROCCAN_BANKS[0]);
  const [transferRef, setTransferRef] = useState('');
  const [transferDate, setTransferDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [transferNotes, setTransferNotes] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [proofName, setProofName] = useState('');
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingBank, setSubmittingBank] = useState(false);
  const [bankMessage, setBankMessage] = useState('');
  const [bankError, setBankError] = useState('');

  // Cash / Agency / Check form state
  const [cashChannel, setCashChannel] = useState<CashChannel>('wafacash');
  const [cashRef, setCashRef] = useState('');
  const [cashAgencyLocation, setCashAgencyLocation] = useState('');
  const [cashDate, setCashDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [cashNotes, setCashNotes] = useState('');
  const [cashProofUrl, setCashProofUrl] = useState('');
  const [cashProofName, setCashProofName] = useState('');
  const [uploadingCashProof, setUploadingCashProof] = useState(false);
  const [submittingCash, setSubmittingCash] = useState(false);
  const [cashMessage, setCashMessage] = useState('');
  const [cashError, setCashError] = useState('');

  // PDF busy indicator
  const [pdfDownloadingId, setPdfDownloadingId] = useState<string | null>(null);

  const { data: billingConfig, isLoading: loadingConfig } = useQuery({
    queryKey: ['subscriptionBillingConfig'],
    queryFn: getSubscriptionBillingConfig,
    enabled: isOpen,
    staleTime: 30_000,
  });

  const { data: transferRequests = [], refetch: refetchRequests } = useQuery({
    queryKey: ['subscriptionBankRequests', syndic.id],
    queryFn: () => getSubscriptionBankTransferRequests(syndic.id),
    enabled: isOpen,
    staleTime: 10_000,
  });

  const { data: allPayments = [], refetch: refetchPayments } = useQuery({
    queryKey: ['subscriptionPayments'],
    queryFn: getSubscriptionPayments,
    enabled: isOpen,
    staleTime: 10_000,
  });

  const cabinetPayments = useMemo(
    () => allPayments.filter((p) => p.syndicId === syndic.id),
    [allPayments, syndic.id],
  );

  const enabledTabs = useMemo<PaymentTab[]>(() => {
    if (!billingConfig) return [];
    const tabs: PaymentTab[] = [];
    if (billingConfig.cmi?.enabled) tabs.push('cmi');
    if (billingConfig.paypal.enabled) tabs.push('paypal');
    if (billingConfig.bankTransfer.enabled) tabs.push('virement');
    if (billingConfig.cashPayment?.enabled) tabs.push('cash');
    return tabs;
  }, [billingConfig]);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedPlan(syndic.subscriptionPlan || 'professional');
    setCheckoutError('');
    setCheckoutSuccess('');
    setLastPaidRecord(null);
    setCmiError('');
    setBankError('');
    setBankMessage('');
    setCashError('');
    setCashMessage('');
    setPromoError('');
  }, [isOpen, syndic.id, syndic.subscriptionPlan]);

  useEffect(() => {
    if (enabledTabs.length > 0 && !enabledTabs.includes(paymentTab)) {
      setPaymentTab(enabledTabs[0]);
    }
  }, [enabledTabs, paymentTab]);

  useEffect(() => {
    const accepted = billingConfig?.cashPayment?.acceptedChannels;
    if (accepted && accepted.length > 0 && !accepted.includes(cashChannel)) {
      setCashChannel(accepted[0]);
    }
  }, [billingConfig?.cashPayment?.acceptedChannels, cashChannel]);

  // Re-validate applied promo code whenever plan or duration changes
  useEffect(() => {
    if (!isOpen || !appliedPromoCode) return;
    let active = true;
    setPromoLoading(true);
    setPromoError('');
    void validateSubscriptionPromoCode({
      plan: selectedPlan,
      months: selectedMonths,
      promoCode: appliedPromoCode,
    })
      .then((res) => {
        if (!active) return;
        setPromoPricing(res.pricing);
        setAppliedPromoDesc(res.promo?.description || '');
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPromoPricing(null);
        setAppliedPromoCode(undefined);
        setAppliedPromoDesc('');
        setPromoError(
          err instanceof Error
            ? err.message
            : tr(
                'Ce code promo ne s’applique pas à cette formule ou durée.',
                'هذا الرمز الترويجي غير صالح لهذه الباقة أو المدة.',
              ),
        );
      })
      .finally(() => {
        if (active) setPromoLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, appliedPromoCode, selectedPlan, selectedMonths, tr]);

  const localPricing = useMemo(
    () =>
      computeLocalEstimatedPricing(billingConfig, selectedPlan, selectedMonths),
    [billingConfig, selectedPlan, selectedMonths],
  );

  const effectivePricing = promoPricing || localPricing;
  const totalMad = effectivePricing.amountMad;
  const paypalAmount = effectivePricing.paypalAmount;
  const motifSuggestion = `SYNDICUNION-${syndic.id.slice(0, 8).toUpperCase()}`;

  const selectionRef = useRef({
    syndicId: syndic.id,
    plan: selectedPlan,
    months: selectedMonths,
    promoCode: appliedPromoCode,
  });
  useEffect(() => {
    selectionRef.current = {
      syndicId: syndic.id,
      plan: selectedPlan,
      months: selectedMonths,
      promoCode: appliedPromoCode,
    };
  }, [syndic.id, selectedPlan, selectedMonths, appliedPromoCode]);

  const handleApplyPromo = async () => {
    const clean = promoInput.trim().toUpperCase();
    setPromoError('');
    if (!clean) {
      setAppliedPromoCode(undefined);
      setPromoPricing(null);
      setAppliedPromoDesc('');
      return;
    }
    setPromoLoading(true);
    try {
      const res = await validateSubscriptionPromoCode({
        plan: selectedPlan,
        months: selectedMonths,
        promoCode: clean,
      });
      setAppliedPromoCode(res.promo?.code || clean);
      setAppliedPromoDesc(res.promo?.description || '');
      setPromoPricing(res.pricing);
      setPromoInput(res.promo?.code || clean);
    } catch (err: unknown) {
      setAppliedPromoCode(undefined);
      setPromoPricing(null);
      setAppliedPromoDesc('');
      setPromoError(
        err instanceof Error
          ? err.message
          : tr('Code promo invalide ou expiré.', 'رمز ترويجي غير صالح أو منتهي.'),
      );
    } finally {
      setPromoLoading(false);
    }
  };

  const handleClearPromo = () => {
    setPromoInput('');
    setAppliedPromoCode(undefined);
    setAppliedPromoDesc('');
    setPromoPricing(null);
    setPromoError('');
  };

  const handleStartCmiPayment = async () => {
    setCmiError('');
    setCmiRedirecting(true);
    try {
      const result = await createCmiSubscriptionPayment({
        syndicId: syndic.id,
        plan: selectedPlan,
        months: selectedMonths,
        lang: language === 'ar' ? 'ar' : 'fr',
        ...(appliedPromoCode ? { promoCode: appliedPromoCode } : {}),
      });
      submitHiddenCmiForm(result.gatewayUrl, result.fields);
    } catch (err: unknown) {
      setCmiRedirecting(false);
      setCmiError(
        err instanceof Error
          ? err.message
          : tr(
              'Impossible d’initialiser le paiement sécurisé CMI.',
              'تعذر بدء عملية الدفع عبر CMI.',
            ),
      );
    }
  };

  useEffect(() => {
    if (
      isIosNativeApp() ||
      !isOpen ||
      paymentTab !== 'paypal' ||
      !billingConfig?.paypal.enabled ||
      !billingConfig.paypal.clientId
    ) {
      return;
    }

    let cancelled = false;
    let buttonsInstance: PayPalButtonsInstance | undefined;
    const fieldInstances: PayPalFieldInstance[] = [];
    cardFieldsInstanceRef.current = null;
    setSdkState('loading');
    setSdkError('');
    setCardEligible(false);

    const locale = language === 'ar' ? 'ar_EG' : 'fr_FR';

    void loadPayPalSdk(billingConfig.paypal, locale)
      .then(async (paypal) => {
        if (cancelled) return;

        if (paypal.Buttons && paypalButtonsContainerRef.current) {
          paypalButtonsContainerRef.current.innerHTML = '';
          buttonsInstance = paypal.Buttons({
            style: {
              layout: 'vertical',
              shape: 'rect',
              color: 'gold',
              label: 'pay',
            },
            createOrder: async () => {
              setCheckoutError('');
              setCheckoutSuccess('');
              setLastPaidRecord(null);
              const cur = selectionRef.current;
              const order = await createPayPalSubscriptionOrder({
                syndicId: cur.syndicId,
                plan: cur.plan,
                months: cur.months,
                paymentSourceHint: 'paypal',
                ...(cur.promoCode ? { promoCode: cur.promoCode } : {}),
              });
              return order.orderId;
            },
            onApprove: async (data) => {
              try {
                const cur = selectionRef.current;
                const result = await capturePayPalSubscriptionOrder({
                  orderId: data.orderID,
                  syndicId: cur.syndicId,
                  methodHint: 'paypal',
                });
                if (!cancelled) {
                  setLastPaidRecord(result.payment);
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['syndics'] }),
                    queryClient.invalidateQueries({
                      queryKey: ['subscriptionPayments'],
                    }),
                    refetchPayments(),
                  ]);
                  setCheckoutSuccess(
                    tr(
                      `Paiement confirmé (${result.payment.reference}). Votre abonnement est actif jusqu'au ${
                        result.payment.subscriptionExpiry
                          ? new Date(
                              result.payment.subscriptionExpiry,
                            ).toLocaleDateString('fr-MA')
                          : '—'
                      }.`,
                      `تم تأكيد الدفع (${result.payment.reference}). اشتراككم نشط الآن.`,
                    ),
                  );
                }
              } catch (err) {
                if (!cancelled) {
                  setCheckoutError(
                    err instanceof Error
                      ? err.message
                      : tr(
                          'Erreur lors de la validation PayPal.',
                          'تعذر تأكيد الدفع عبر PayPal.',
                        ),
                  );
                }
              }
            },
            onCancel: () => {
              if (!cancelled) {
                setCheckoutError(
                  tr('Paiement PayPal annulé.', 'تم إلغاء عملية PayPal.'),
                );
              }
            },
            onError: () => {
              if (!cancelled) {
                setCheckoutError(
                  tr(
                    'Une erreur est survenue avec PayPal. Vous pouvez réessayer ou choisir un autre moyen de paiement.',
                    'حدث خطأ في PayPal. يمكنك إعادة المحاولة أو اختيار طريقة دفع أخرى.',
                  ),
                );
              }
            },
          });
          await buttonsInstance.render(paypalButtonsContainerRef.current);
        }

        if (
          billingConfig.paypal.checkoutMode === 'expanded' &&
          paypal.CardFields
        ) {
          const cf = paypal.CardFields({
            createOrder: async () => {
              setCheckoutError('');
              setCheckoutSuccess('');
              setLastPaidRecord(null);
              const cur = selectionRef.current;
              const order = await createPayPalSubscriptionOrder({
                syndicId: cur.syndicId,
                plan: cur.plan,
                months: cur.months,
                paymentSourceHint: 'card',
                ...(cur.promoCode ? { promoCode: cur.promoCode } : {}),
              });
              return order.orderId;
            },
            onApprove: async (data) => {
              try {
                const cur = selectionRef.current;
                const result = await capturePayPalSubscriptionOrder({
                  orderId: data.orderID,
                  syndicId: cur.syndicId,
                  methodHint: 'card',
                });
                if (!cancelled) {
                  setCardSubmitting(false);
                  setLastPaidRecord(result.payment);
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['syndics'] }),
                    queryClient.invalidateQueries({
                      queryKey: ['subscriptionPayments'],
                    }),
                    refetchPayments(),
                  ]);
                  setCheckoutSuccess(
                    tr(
                      `Paiement par carte confirmé (${result.payment.reference}). Votre abonnement est actif jusqu'au ${
                        result.payment.subscriptionExpiry
                          ? new Date(
                              result.payment.subscriptionExpiry,
                            ).toLocaleDateString('fr-MA')
                          : '—'
                      }.`,
                      `تم تأكيد الدفع بالبطاقة (${result.payment.reference}). تم تفعيل اشتراككم بنجاح.`,
                    ),
                  );
                }
              } catch (err) {
                if (!cancelled) {
                  setCardSubmitting(false);
                  setCheckoutError(
                    err instanceof Error
                      ? err.message
                      : tr(
                          'Échec de capture du paiement par carte.',
                          'فشل استخلاص الدفع بالبطاقة.',
                        ),
                  );
                }
              }
            },
            onCancel: () => {
              if (!cancelled) {
                setCardSubmitting(false);
                setCheckoutError(
                  tr('Paiement par carte annulé.', 'تم إلغاء الدفع بالبطاقة.'),
                );
              }
            },
            onError: () => {
              if (!cancelled) {
                setCardSubmitting(false);
                setCheckoutError(
                  tr(
                    'Carte refusée ou vérification 3D Secure interrompue.',
                    'تم رفض البطاقة أو إلغاء التحقق 3D Secure.',
                  ),
                );
              }
            },
          });

          if (!cancelled && cf.isEligible()) {
            setCardEligible(true);
            cardFieldsInstanceRef.current = cf;
            const fieldStyle = {
              input: {
                'font-size': '14px',
                'font-family': 'Inter, system-ui, sans-serif',
                color: '#0f172a',
              },
            };
            const bindings: Array<[HTMLDivElement | null, PayPalFieldInstance]> = [
              [cardNameRef.current, cf.NameField({ style: fieldStyle })],
              [cardNumberRef.current, cf.NumberField({ style: fieldStyle })],
              [cardExpiryRef.current, cf.ExpiryField({ style: fieldStyle })],
              [cardCvvRef.current, cf.CVVField({ style: fieldStyle })],
            ];
            for (const [el, field] of bindings) {
              if (el && !cancelled) {
                el.innerHTML = '';
                fieldInstances.push(field);
                await field.render(el);
              }
            }
          }
        }

        if (!cancelled) setSdkState('ready');
      })
      .catch((err) => {
        if (!cancelled) {
          setSdkState('error');
          setSdkError(
            err instanceof Error
              ? err.message
              : tr('Erreur PayPal SDK.', 'خطأ في تحميل PayPal.'),
          );
        }
      });

    return () => {
      cancelled = true;
      cardFieldsInstanceRef.current = null;
      void buttonsInstance?.close?.().catch(() => {});
      for (const f of fieldInstances) {
        void f.close?.().catch(() => {});
      }
    };
  }, [isOpen, paymentTab, billingConfig, language, queryClient, refetchPayments, tr]);

  const handleCardSubmit = async () => {
    const cf = cardFieldsInstanceRef.current;
    if (!cf) return;
    setCheckoutError('');
    setCheckoutSuccess('');
    setCardSubmitting(true);
    try {
      await cf.submit();
    } catch (err) {
      setCardSubmitting(false);
      setCheckoutError(
        err instanceof Error
          ? err.message
          : tr(
              'Vérifiez les champs de votre carte bancaire.',
              'تحقق من بيانات البطاقة البنكية.',
            ),
      );
    }
  };

  const handleCopy = async (
    value: string,
    field: 'rib' | 'motif' | 'whatsapp',
  ) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const handleUploadProof = async (
    e: React.ChangeEvent<HTMLInputElement>,
    target: 'bank' | 'cash',
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (target === 'bank') {
      setBankError('');
      setUploadingProof(true);
    } else {
      setCashError('');
      setUploadingCashProof(true);
    }
    try {
      const uploaded = await uploadSubscriptionProof(syndic.id, file);
      if (target === 'bank') {
        setProofUrl(uploaded.url);
        setProofName(file.name);
      } else {
        setCashProofUrl(uploaded.url);
        setCashProofName(file.name);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : tr(
              'Impossible de téléverser le justificatif.',
              'تعذر رفع الوصل.',
            );
      if (target === 'bank') setBankError(msg);
      else setCashError(msg);
    } finally {
      if (target === 'bank') setUploadingProof(false);
      else setUploadingCashProof(false);
    }
  };

  const handleSubmitBankTransfer = async () => {
    setBankError('');
    setBankMessage('');
    if (transferRef.trim().length < 3) {
      setBankError(
        tr(
          'Saisissez la référence du virement (min. 3 caractères).',
          'أدخل مرجع التحويل (3 أحرف على الأقل).',
        ),
      );
      return;
    }
    setSubmittingBank(true);
    try {
      await submitSubscriptionBankTransfer({
        syndicId: syndic.id,
        plan: selectedPlan,
        months: selectedMonths,
        requestType: 'virement',
        transferReference: transferRef.trim(),
        bankName: transferBank.trim(),
        transferDate,
        ...(appliedPromoCode ? { promoCode: appliedPromoCode } : {}),
        proofUrl: proofUrl || undefined,
        notes: transferNotes.trim() || undefined,
      });
      setBankMessage(
        tr(
          'Demande de virement enregistrée ! L’administration validera votre abonnement dès vérification du reçu.',
          'تم إرسال طلب التحويل بنجاح! ستفعل الإدارة اشتراككم فور التحقق من الوصل.',
        ),
      );
      setTransferRef('');
      setTransferNotes('');
      setProofUrl('');
      setProofName('');
      await Promise.all([
        refetchRequests(),
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
      ]);
    } catch (err) {
      setBankError(
        err instanceof Error
          ? err.message
          : tr('Envoi impossible.', 'تعذر إرسال الطلب.'),
      );
    } finally {
      setSubmittingBank(false);
    }
  };

  const cashMaxAmount = billingConfig?.cashPayment?.maxCashAmountMad ?? 5000;
  const isCashOverCgiCap =
    cashChannel !== 'check' && cashMaxAmount > 0 && totalMad > cashMaxAmount;

  const handleSubmitCashRequest = async () => {
    setCashError('');
    setCashMessage('');
    if (isCashOverCgiCap) {
      setCashError(
        tr(
          `Ce montant (${totalMad.toLocaleString('fr-MA')} MAD) dépasse le plafond espèces autorisé (${cashMaxAmount.toLocaleString('fr-MA')} MAD). Choisissez Chèque, Virement ou CMI.`,
          `هذا المبلغ (${totalMad.toLocaleString('fr-MA')} درهم) يتجاوز السقف النقدي المسموح (${cashMaxAmount.toLocaleString('fr-MA')} درهم). اختر الشيك أو التحويل أو CMI.`,
        ),
      );
      return;
    }
    if (cashRef.trim().length < 3) {
      setCashError(
        tr(
          'Saisissez le code de transfert, numéro de reçu ou numéro de chèque (min. 3 caractères).',
          'أدخل رمز التحويل أو رقم الوصل أو الشيك (3 أحرف على الأقل).',
        ),
      );
      return;
    }
    if (billingConfig?.cashPayment?.requireProofUpload && !cashProofUrl) {
      setCashError(
        tr(
          'Veuillez joindre la photo ou le scan du reçu d’agence / chèque.',
          'يرجى إرفاق صورة أو نسخة من وصل الوكالة أو الشيك.',
        ),
      );
      return;
    }
    setSubmittingCash(true);
    try {
      await submitSubscriptionBankTransfer({
        syndicId: syndic.id,
        plan: selectedPlan,
        months: selectedMonths,
        requestType: cashChannel === 'check' ? 'check' : 'cash',
        cashChannel,
        agencyLocation: cashAgencyLocation.trim() || undefined,
        transferReference: cashRef.trim(),
        bankName: getCashChannelLabel(cashChannel, tr),
        transferDate: cashDate,
        ...(appliedPromoCode ? { promoCode: appliedPromoCode } : {}),
        proofUrl: cashProofUrl || undefined,
        notes: cashNotes.trim() || undefined,
      });
      setCashMessage(
        tr(
          'Déclaration de versement enregistrée ! Votre abonnement sera activé dès validation du reçu par notre service comptable.',
          'تم إرسال تصريح الأداء بنجاح! سيتم تفعيل اشتراككم فور التحقق من الوصل.',
        ),
      );
      setCashRef('');
      setCashAgencyLocation('');
      setCashNotes('');
      setCashProofUrl('');
      setCashProofName('');
      await Promise.all([
        refetchRequests(),
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
      ]);
    } catch (err) {
      setCashError(
        err instanceof Error
          ? err.message
          : tr('Envoi impossible.', 'تعذر إرسال الطلب.'),
      );
    } finally {
      setSubmittingCash(false);
    }
  };

  const handleDownloadInvoice = async (payment: SubscriptionPayment) => {
    setPdfDownloadingId(payment.id);
    try {
      await generateSubscriptionInvoicePDF(
        payment,
        syndic,
        billingConfig?.issuerProfile,
      );
    } finally {
      setPdfDownloadingId(null);
    }
  };

  const noMethodsConfigured =
    !loadingConfig && billingConfig && enabledTabs.length === 0;

  if (isIosNativeApp()) {
    const planEntry = PLAN_CATALOG[syndic.subscriptionPlan];
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        maxWidthClass="max-w-2xl"
        title={tr(
          'Mon Abonnement Cabinet Syndic',
          'اشتراك مكتب السنديك',
        )}
        footer={
          <Button variant="secondary" onClick={onClose}>
            {tr('Fermer', 'إغلاق')}
          </Button>
        }
      >
        <div className="space-y-5">
          <div className="p-4 rounded-xl bg-teal-50 border border-teal-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-teal-950">{syndic.name}</span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-700 text-white">
                {planEntry
                  ? language === 'ar'
                    ? planEntry.nameAr
                    : planEntry.nameFr
                  : syndic.subscriptionPlan}
              </span>
            </div>
            <p className="text-xs text-teal-900">
              {tr('Statut :', 'الحالة :')}{' '}
              <strong className="uppercase">{syndic.subscriptionStatus}</strong>
              {syndic.subscriptionExpiry
                ? ` · ${tr('Échéance', 'تاريخ الانتهاء')} : ${new Date(
                    syndic.subscriptionExpiry,
                  ).toLocaleDateString(language === 'ar' ? 'ar-MA' : 'fr-MA')}`
                : ''}
            </p>
            <p className="text-xs text-slate-700 pt-1 leading-relaxed">
              {tr(
                'La gestion commerciale et le renouvellement de votre contrat cabinet B2B s’effectuent depuis votre espace administrateur web. Vous pouvez consulter et partager vos factures officielles PDF ci-dessous.',
                'تتم إدارة وتجديد اشتراك المكتب المهني عبر البوابة الإلكترونية على الويب. يمكنكم الاطلاع على فواتيركم الرسمية PDF ومشاركتها أدناه.',
              )}
            </p>
          </div>

          {cabinetPayments.length > 0 ? (
            <div className="space-y-2">
              <h5 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                {tr(
                  `Mes Factures & Reçus Officiels (${cabinetPayments.length})`,
                  `فواتيري ووصولاتي الرسمية (${cabinetPayments.length})`,
                )}
              </h5>
              <div className="space-y-1.5 max-h-64 overflow-y-auto text-xs">
                {cabinetPayments.map((p) => {
                  const badge = getMethodBadgeMeta(p.method, tr);
                  return (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-white"
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-bold text-teal-900">
                            {p.invoiceNumber || p.receiptNumber || p.reference}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${badge.badgeClass}`}>
                            {badge.label}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {new Date(p.createdAt).toLocaleDateString(
                            language === 'ar' ? 'ar-MA' : 'fr-MA',
                          )}{' '}
                          ·{' '}
                          <span className="font-mono font-bold text-slate-800">
                            {Number(p.amount || 0).toLocaleString('fr-MA')} MAD
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={pdfDownloadingId === p.id}
                        onClick={() => void handleDownloadInvoice(p)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[36px] rounded-lg border border-teal-300 bg-teal-50 text-teal-900 hover:bg-teal-100 font-bold text-[11px] disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {pdfDownloadingId === p.id
                          ? tr('Génération...', 'جاري التحميل...')
                          : tr('Facture PDF', 'فاتورة PDF')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-4">
              {tr('Aucune facture enregistrée pour le moment.', 'لا توجد فواتير مسجلة حالياً.')}
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      title={tr(
        'Renouveler ou changer votre abonnement SyndicUnion',
        'تجديد أو تغيير اشتراك منصة SyndicUnion',
      )}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {tr('Fermer', 'إغلاق')}
        </Button>
      }
    >
      <div className="space-y-5">
        {/* Step 1: Select Plan, Duration & Promo Code */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {tr('1. Choisissez votre forfait & durée', '1. اختر الباقة والمدة')}
            </span>
            <span className="text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full">
              {syndic.name}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {(['starter', 'professional', 'enterprise'] as const).map((planId) => {
              const entry = PLAN_CATALOG[planId];
              const active = selectedPlan === planId;
              return (
                <button
                  key={planId}
                  type="button"
                  onClick={() => setSelectedPlan(planId)}
                  className={`p-3 rounded-xl border text-start transition-all ${
                    active
                      ? 'border-teal-700 bg-teal-50/70 ring-2 ring-teal-600/20'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-slate-900 text-sm">
                      {language === 'ar' ? entry.nameAr : entry.nameFr}
                    </span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {language === 'ar' ? entry.badgeAr : entry.badgeFr}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-base font-extrabold text-teal-800">
                    {entry.priceMad} MAD
                    <span className="text-[11px] font-normal text-slate-500">
                      /{tr('mois', 'شهر')}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {DURATIONS.map((d) => {
              const active = selectedMonths === d.months;
              const multiPct = getMultiMonthDiscountPct(billingConfig, d.months);
              return (
                <button
                  key={d.months}
                  type="button"
                  onClick={() => setSelectedMonths(d.months)}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold transition-colors flex items-center justify-center gap-1.5 ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span>{language === 'ar' ? d.labelAr : d.labelFr}</span>
                  {multiPct > 0 && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-extrabold ${
                        active
                          ? 'bg-emerald-400 text-slate-950'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      -{multiPct}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Optional Promo Code Bar */}
          <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
            <Tag className="w-4 h-4 text-teal-700 flex-shrink-0" />
            <input
              type="text"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleApplyPromo();
                }
              }}
              placeholder={tr('Code promo (optionnel)', 'رمز ترويجي (اختياري)')}
              aria-label={tr('Code promo', 'رمز ترويجي')}
              className="flex-1 min-w-[140px] px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-mono text-xs uppercase"
            />
            {appliedPromoCode ? (
              <button
                type="button"
                onClick={handleClearPromo}
                className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold"
              >
                {tr('Retirer', 'إزالة')}
              </button>
            ) : (
              <button
                type="button"
                disabled={promoLoading || !promoInput.trim()}
                onClick={() => void handleApplyPromo()}
                className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold"
              >
                {promoLoading
                  ? tr('Vérification...', 'جاري التحقق...')
                  : tr('Appliquer', 'تطبيق')}
              </button>
            )}
            {appliedPromoCode && (
              <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-full">
                ✓ {appliedPromoCode}
                {appliedPromoDesc ? ` — ${appliedPromoDesc}` : ''}
              </span>
            )}
            {promoError && (
              <span
                role="alert"
                className="w-full text-[11px] font-semibold text-rose-700"
              >
                {promoError}
              </span>
            )}
          </div>

          {/* Summary Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-900 text-white">
            <div className="space-y-0.5">
              <div className="text-[11px] text-slate-300">
                {tr('Montant total TTC de la période', 'المبلغ الإجمالي للفترة')}
              </div>
              <div className="flex flex-wrap items-baseline gap-2">
                {effectivePricing.totalDiscountMad > 0 && (
                  <span className="text-sm font-mono line-through text-slate-400">
                    {effectivePricing.baseAmountMad.toLocaleString('fr-MA')} MAD
                  </span>
                )}
                <span className="text-lg font-extrabold font-mono">
                  {totalMad.toLocaleString('fr-MA')} MAD
                </span>
                {effectivePricing.totalDiscountMad > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[11px] font-bold">
                    -{effectivePricing.totalDiscountMad.toLocaleString('fr-MA')}{' '}
                    MAD
                  </span>
                )}
              </div>
              {effectivePricing.vatRate > 0 && (
                <div className="text-[11px] text-slate-400 font-mono">
                  HT: {effectivePricing.totalHtMad.toFixed(2)} MAD · TVA (
                  {effectivePricing.vatRate}%):{' '}
                  {effectivePricing.vatAmountMad.toFixed(2)} MAD
                </div>
              )}
            </div>
            {billingConfig?.paypal.enabled && (
              <div className="text-end">
                <div className="text-[11px] text-teal-300">
                  {tr(
                    `Équivalent PayPal (${billingConfig.paypal.currency})`,
                    `المعادل عبر PayPal (${billingConfig.paypal.currency})`,
                  )}
                </div>
                <div className="text-base font-bold font-mono text-white">
                  {paypalAmount.toFixed(2)} {billingConfig.paypal.currency}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Payment Methods */}
        {loadingConfig ? (
          <div className="py-6 text-center text-xs text-slate-500">
            {tr(
              'Chargement des moyens de paiement...',
              'جاري تحميل طرق الدفع...',
            )}
          </div>
        ) : noMethodsConfigured ? (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
            <div className="font-bold">
              {tr(
                'Paiement en ligne en cours de configuration',
                'الدفع الإلكتروني قيد التهيئة حالياً',
              )}
            </div>
            <p>
              {tr(
                'Aucun moyen de paiement (CMI, PayPal, Virement ou Espèces) n’est encore activé par l’administrateur. Contactez le support SyndicUnion pour activer votre renouvellement.',
                'لم تقم الإدارة بتفعيل بوابات الدفع بعد. تواصلوا مع دعم المنصة لتجديد اشتراككم.',
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
              {billingConfig?.cmi?.enabled && (
                <button
                  type="button"
                  onClick={() => setPaymentTab('cmi')}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    paymentTab === 'cmi'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  {tr('Carte Marocaine (CMI — MAD)', 'البطاقة المغربية CMI')}
                </button>
              )}
              {billingConfig?.paypal.enabled && (
                <button
                  type="button"
                  onClick={() => setPaymentTab('paypal')}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    paymentTab === 'paypal'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  {billingConfig.paypal.checkoutMode === 'expanded'
                    ? tr('PayPal & Carte Intl', 'PayPal وبطاقة دولية')
                    : 'PayPal'}
                </button>
              )}
              {billingConfig?.bankTransfer.enabled && (
                <button
                  type="button"
                  onClick={() => setPaymentTab('virement')}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    paymentTab === 'virement'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Landmark className="w-4 h-4" />
                  {tr('Virement RIB Maroc', 'تحويل بنكي RIB')}
                </button>
              )}
              {billingConfig?.cashPayment?.enabled && (
                <button
                  type="button"
                  onClick={() => setPaymentTab('cash')}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    paymentTab === 'cash'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Banknote className="w-4 h-4" />
                  {tr('Espèces / Agences / Chèque', 'نقداً / وكالات / شيك')}
                </button>
              )}
            </div>

            {/* Tab 1: Moroccan CMI 3D-Secure */}
            {paymentTab === 'cmi' && billingConfig?.cmi?.enabled && (
              <div className="space-y-4">
                {cmiError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
                  >
                    {cmiError}
                  </div>
                )}
                <div className="p-4 rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50/80 to-white space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-teal-700" />
                      <div>
                        <div className="text-sm font-bold text-slate-900">
                          {tr(
                            'Paiement Sécurisé CMI — Centre Monétique Interbancaire',
                            'الدفع الإلكتروني الآمن عبر CMI المغرب',
                          )}
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {tr(
                            'Cartes bancaires marocaines (CMI, Visa, Mastercard) en Dirhams · Activation immédiate après validation 3D Secure.',
                            'البطاقات البنكية المغربية بالدرهم · تفعيل فوري بعد تأكيد 3D Secure.',
                          )}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono ${
                        billingConfig.cmi.env === 'production'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {billingConfig.cmi.env === 'production'
                        ? 'CMI LIVE'
                        : 'CMI TEST'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-700">
                    <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                      <div className="font-bold text-slate-900">
                        {tr('Devise officielle', 'العملة الرسمية')}
                      </div>
                      <div className="font-mono text-teal-800 font-bold">
                        {billingConfig.cmi.currencyCode === '504'
                          ? 'MAD (504)'
                          : billingConfig.cmi.currencyCode === '978'
                            ? 'EUR (978)'
                            : 'USD (840)'}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                      <div className="font-bold text-slate-900">
                        {tr('Signature cryptographique', 'التشفير والحماية')}
                      </div>
                      <div className="text-slate-600">
                        CMI 3DS · SHA-512
                      </div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                      <div className="font-bold text-slate-900">
                        {tr('Facture officielle', 'الفاتورة الرسمية')}
                      </div>
                      <div className="text-slate-600">
                        {tr('PDF disponible dès retour', 'PDF متاح فور التأكيد')}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="text-xs text-slate-600">
                      {tr(
                        'Vous serez redirigé vers la page de paiement officielle du CMI puis ramené automatiquement sur SyndicUnion.',
                        'سيتم توجيهكم إلى صفحة الدفع الرسمية CMI ثم العودة تلقائياً إلى المنصة.',
                      )}
                    </div>
                    <Button
                      type="button"
                      disabled={cmiRedirecting}
                      onClick={() => void handleStartCmiPayment()}
                      className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
                    >
                      {cmiRedirecting
                        ? tr(
                            'Redirection sécurisée vers CMI...',
                            'جاري التحويل إلى CMI...',
                          )
                        : tr(
                            `Payer ${totalMad.toLocaleString('fr-MA')} MAD via CMI →`,
                            `دفع ${totalMad.toLocaleString('fr-MA')} درهم عبر CMI ←`,
                          )}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: PayPal / International Card */}
            {paymentTab === 'paypal' && billingConfig?.paypal.enabled && (
              <div className="space-y-4">
                {checkoutSuccess && (
                  <div
                    role="status"
                    className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 text-emerald-700 flex-shrink-0 mt-0.5" />
                      <span>{checkoutSuccess}</span>
                    </div>
                    {lastPaidRecord && (
                      <button
                        type="button"
                        onClick={() => void handleDownloadInvoice(lastPaidRecord)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px]"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {tr('Télécharger Facture PDF', 'تحميل الفاتورة PDF')}
                      </button>
                    )}
                  </div>
                )}
                {checkoutError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
                  >
                    {checkoutError}
                  </div>
                )}
                {sdkError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
                  >
                    {sdkError}
                  </div>
                )}

                {billingConfig.paypal.checkoutMode === 'expanded' && (
                  <div
                    className={
                      cardEligible
                        ? 'p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3'
                        : 'hidden'
                    }
                    aria-hidden={!cardEligible}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-bold text-slate-900 text-xs sm:text-sm">
                        <CreditCard className="w-4 h-4 text-teal-700" />
                        <span>
                          {tr(
                            'Payer directement par Carte Bancaire (Visa / Mastercard)',
                            'الدفع مباشرة بالبطاقة البنكية',
                          )}
                        </span>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        3D Secure
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          {tr('Nom sur la carte', 'الاسم على البطاقة')}
                        </label>
                        <div
                          ref={cardNameRef}
                          className="h-10 px-3 bg-white border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                          {tr('Numéro de carte', 'رقم البطاقة')}
                        </label>
                        <div
                          ref={cardNumberRef}
                          className="h-10 px-3 bg-white border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            {tr('Expiration (MM/AA)', 'تاريخ الانتهاء')}
                          </label>
                          <div
                            ref={cardExpiryRef}
                            className="h-10 px-3 bg-white border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            CVV
                          </label>
                          <div
                            ref={cardCvvRef}
                            className="h-10 px-3 bg-white border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      onClick={handleCardSubmit}
                      disabled={cardSubmitting || !cardEligible}
                      className="w-full"
                    >
                      {cardSubmitting
                        ? tr('Traitement sécurisé...', 'جاري المعالجة الآمنة...')
                        : tr(
                            `Payer ${paypalAmount.toFixed(2)} ${billingConfig.paypal.currency} par carte`,
                            `دفع ${paypalAmount.toFixed(2)} ${billingConfig.paypal.currency} بالبطاقة`,
                          )}
                    </Button>
                  </div>
                )}

                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-700">
                      {cardEligible
                        ? tr(
                            'Ou payer avec votre compte PayPal',
                            'أو الدفع عبر PayPal',
                          )
                        : tr(
                            'Payer avec PayPal ou Carte via PayPal',
                            'الدفع عبر PayPal أو البطاقة البنكية',
                          )}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500">
                      {billingConfig.paypal.env === 'sandbox' ? 'SANDBOX' : 'LIVE'}
                    </span>
                  </div>
                  {sdkState === 'loading' && (
                    <div className="py-4 text-center text-xs text-slate-500">
                      {tr(
                        'Chargement des boutons PayPal...',
                        'جاري تحميل PayPal...',
                      )}
                    </div>
                  )}
                  <div ref={paypalButtonsContainerRef} className="min-h-[48px]" />
                </div>
              </div>
            )}

            {/* Tab 3: Moroccan Bank Transfer (RIB) */}
            {paymentTab === 'virement' &&
              billingConfig?.bankTransfer.enabled && (
                <div className="space-y-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold uppercase tracking-wider text-teal-800">
                          {billingConfig.bankTransfer.bankName}
                        </div>
                        <div className="text-sm font-bold text-slate-900">
                          {billingConfig.bankTransfer.accountHolder}
                        </div>
                      </div>
                      {billingConfig.bankTransfer.ice && (
                        <span className="text-[11px] font-mono text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded">
                          ICE: {billingConfig.bankTransfer.ice}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white border border-slate-200 rounded-lg">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-400">
                          RIB (24 chiffres)
                        </div>
                        <div className="font-mono text-sm font-bold text-slate-900">
                          {billingConfig.bankTransfer.rib}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopy(
                            billingConfig.bankTransfer.rib.replace(/\s+/g, ''),
                            'rib',
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                      >
                        {copiedField === 'rib' ? (
                          <Check className="w-3.5 h-3.5" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiedField === 'rib'
                          ? tr('Copié', 'تم النسخ')
                          : tr('Copier RIB', 'نسخ RIB')}
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                      <div className="flex flex-wrap gap-3 font-mono text-[11px]">
                        {billingConfig.bankTransfer.iban && (
                          <span>IBAN: {billingConfig.bankTransfer.iban}</span>
                        )}
                        {billingConfig.bankTransfer.swift && (
                          <span>SWIFT: {billingConfig.bankTransfer.swift}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleCopy(motifSuggestion, 'motif')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-teal-50 border border-teal-200 text-teal-800 font-mono text-[11px] font-bold hover:bg-teal-100"
                      >
                        {copiedField === 'motif' ? (
                          <Check className="w-3 h-3" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        {tr('Motif :', 'المرجع:')} {motifSuggestion}
                      </button>
                    </div>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      {language === 'ar'
                        ? billingConfig.bankTransfer.instructionsAr
                        : billingConfig.bankTransfer.instructionsFr}
                    </p>
                  </div>

                  {bankMessage && (
                    <div
                      role="status"
                      className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold"
                    >
                      {bankMessage}
                    </div>
                  )}
                  {bankError && (
                    <div
                      role="alert"
                      className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
                    >
                      {bankError}
                    </div>
                  )}

                  <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      {tr(
                        'Déclarer votre virement effectué',
                        'التصريح بالتحويل البنكي المنجز',
                      )}
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          {tr('Votre banque *', 'البنك المرسل *')}
                        </label>
                        <input
                          type="text"
                          list="ma-banks-list"
                          value={transferBank}
                          onChange={(e) => setTransferBank(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300"
                        />
                        <datalist id="ma-banks-list">
                          {MOROCCAN_BANKS.map((bank) => (
                            <option key={bank} value={bank} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          {tr('Référence virement *', 'مرجع التحويل *')}
                        </label>
                        <input
                          type="text"
                          value={transferRef}
                          onChange={(e) => setTransferRef(e.target.value)}
                          placeholder="VIR-2026-..."
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          {tr('Date d’exécution *', 'تاريخ التحويل *')}
                        </label>
                        <input
                          type="date"
                          value={transferDate}
                          onChange={(e) => setTransferDate(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs items-start">
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          {tr(
                            'Reçu bancaire (PDF, PNG, JPG — max 5 Mo)',
                            'إيصال التحويل (PDF أو صورة — 5 ميجا كحد أقصى)',
                          )}
                        </label>
                        <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-slate-700 font-semibold">
                          <FileUp className="w-4 h-4 text-teal-700" />
                          <span>
                            {uploadingProof
                              ? tr('Téléversement...', 'جاري الرفع...')
                              : proofName
                                ? proofName
                                : tr('Joindre un justificatif', 'إرفاق الإيصال')}
                          </span>
                          <input
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                            onChange={(e) => void handleUploadProof(e, 'bank')}
                            className="hidden"
                          />
                        </label>
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">
                          {tr('Note facultative', 'ملاحظة اختيارية')}
                        </label>
                        <input
                          type="text"
                          value={transferNotes}
                          onChange={(e) => setTransferNotes(e.target.value)}
                          placeholder={motifSuggestion}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={() => void handleSubmitBankTransfer()}
                        disabled={submittingBank || uploadingProof}
                      >
                        {submittingBank
                          ? tr('Envoi en cours...', 'جاري الإرسال...')
                          : tr(
                              `Envoyer le justificatif (${totalMad.toLocaleString('fr-MA')} MAD)`,
                              `إرسال إثبات الدفع (${totalMad.toLocaleString('fr-MA')} درهم)`,
                            )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

            {/* Tab 4: Moroccan Hybrid Cash / Agency / Check */}
            {paymentTab === 'cash' && billingConfig?.cashPayment?.enabled && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-3 text-xs">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
                        {tr(
                          'Bénéficiaire du versement',
                          'المستفيد من التحويل النقدي',
                        )}
                      </div>
                      <div className="text-sm font-bold text-slate-900">
                        {billingConfig.cashPayment.beneficiaryName}
                      </div>
                    </div>
                    {cashMaxAmount > 0 && (
                      <span className="px-2 py-1 rounded bg-white border border-amber-300 font-mono text-[11px] font-bold text-amber-900">
                        {tr(
                          `Plafond espèces : ${cashMaxAmount.toLocaleString('fr-MA')} MAD`,
                          `السقف النقدي: ${cashMaxAmount.toLocaleString('fr-MA')} درهم`,
                        )}
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-700">
                    {billingConfig.cashPayment.officeAddress && (
                      <div className="p-2 rounded-lg bg-white/80 border border-amber-200/70">
                        <span className="font-bold text-slate-900">
                          {tr('Adresse guichet :', 'عنوان المكتب:')}{' '}
                        </span>
                        {billingConfig.cashPayment.officeAddress}
                      </div>
                    )}
                    {billingConfig.cashPayment.officeHours && (
                      <div className="p-2 rounded-lg bg-white/80 border border-amber-200/70">
                        <span className="font-bold text-slate-900">
                          {tr('Horaires :', 'أوقات العمل:')}{' '}
                        </span>
                        {billingConfig.cashPayment.officeHours}
                      </div>
                    )}
                    {billingConfig.cashPayment.contactPhone && (
                      <div className="p-2 rounded-lg bg-white/80 border border-amber-200/70 font-mono">
                        <span className="font-sans font-bold text-slate-900">
                          {tr('Téléphone :', 'الهاتف:')}{' '}
                        </span>
                        {billingConfig.cashPayment.contactPhone}
                      </div>
                    )}
                    {billingConfig.cashPayment.whatsapp && (
                      <div className="p-2 rounded-lg bg-white/80 border border-amber-200/70 flex items-center justify-between gap-2">
                        <span className="font-mono">
                          <span className="font-sans font-bold text-slate-900">
                            WhatsApp :{' '}
                          </span>
                          {billingConfig.cashPayment.whatsapp}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void handleCopy(
                              billingConfig.cashPayment!.whatsapp,
                              'whatsapp',
                            )
                          }
                          className="text-[11px] font-bold text-teal-800 hover:underline"
                        >
                          {copiedField === 'whatsapp'
                            ? tr('Copié', 'تم النسخ')
                            : tr('Copier', 'نسخ')}
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-slate-700 leading-relaxed">
                    {language === 'ar'
                      ? billingConfig.cashPayment.instructionsAr
                      : billingConfig.cashPayment.instructionsFr}
                  </p>
                </div>

                {isCashOverCgiCap && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
                  >
                    {tr(
                      `Attention (CGI Maroc) : Le montant (${totalMad.toLocaleString('fr-MA')} MAD) dépasse le plafond espèces de ${cashMaxAmount.toLocaleString('fr-MA')} MAD. Sélectionnez « Chèque bancaire », ou utilisez Virement RIB / CMI.`,
                      `تنبيه: المبلغ (${totalMad.toLocaleString('fr-MA')} درهم) يتجاوز السقف النقدي المحدد في ${cashMaxAmount.toLocaleString('fr-MA')} درهم. اختر شيكاً بنكياً أو تحويلاً بنكياً.`,
                    )}
                  </div>
                )}

                {cashMessage && (
                  <div
                    role="status"
                    className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold"
                  >
                    {cashMessage}
                  </div>
                )}
                {cashError && (
                  <div
                    role="alert"
                    className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold"
                  >
                    {cashError}
                  </div>
                )}

                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3 text-xs">
                  <h4 className="font-bold uppercase tracking-wider text-slate-700">
                    {tr(
                      'Déclarer votre dépôt espèces / agence / chèque',
                      'التصريح بالأداء النقدي أو عبر وكالة أو شيك',
                    )}
                  </h4>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1.5">
                      {tr('Canal de paiement *', 'قناة الأداء *')}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {billingConfig.cashPayment.acceptedChannels.map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => setCashChannel(ch)}
                          className={`px-3 py-1.5 rounded-lg border font-bold transition-colors ${
                            cashChannel === ch
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-slate-50 text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {getCashChannelLabel(ch, tr)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {cashChannel === 'check'
                          ? tr('N° de chèque *', 'رقم الشيك *')
                          : tr('Code transfert / N° reçu *', 'رمز التحويل / رقم الوصل *')}
                      </label>
                      <input
                        type="text"
                        value={cashRef}
                        onChange={(e) => setCashRef(e.target.value)}
                        placeholder={
                          cashChannel === 'check'
                            ? 'CHQ-2026-...'
                            : 'WFC-2026-...'
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {tr('Agence / Ville', 'الوكالة / المدينة')}
                      </label>
                      <input
                        type="text"
                        value={cashAgencyLocation}
                        onChange={(e) => setCashAgencyLocation(e.target.value)}
                        placeholder={tr('Ex: Maarif Casablanca', 'مثال: المعاريف الدار البيضاء')}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {tr('Date de dépôt *', 'تاريخ الإيداع *')}
                      </label>
                      <input
                        type="date"
                        value={cashDate}
                        onChange={(e) => setCashDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {tr('Reçu d’agence / photo', 'صورة الوصل')}{' '}
                        {billingConfig.cashPayment.requireProofUpload ? '*' : ''}
                      </label>
                      <label className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 cursor-pointer text-slate-700 font-semibold">
                        <FileUp className="w-4 h-4 text-teal-700" />
                        <span>
                          {uploadingCashProof
                            ? tr('Téléversement...', 'جاري الرفع...')
                            : cashProofName
                              ? cashProofName
                              : tr('Joindre le reçu', 'إرفاق الوصل')}
                        </span>
                        <input
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                          onChange={(e) => void handleUploadProof(e, 'cash')}
                          className="hidden"
                        />
                      </label>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {tr('Note facultative', 'ملاحظة اختيارية')}
                      </label>
                      <input
                        type="text"
                        value={cashNotes}
                        onChange={(e) => setCashNotes(e.target.value)}
                        placeholder={motifSuggestion}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      onClick={() => void handleSubmitCashRequest()}
                      disabled={
                        submittingCash || uploadingCashProof || isCashOverCgiCap
                      }
                    >
                      {submittingCash
                        ? tr('Envoi en cours...', 'جاري الإرسال...')
                        : tr(
                            `Soumettre la déclaration (${totalMad.toLocaleString('fr-MA')} MAD)`,
                            `إرسال التصريح (${totalMad.toLocaleString('fr-MA')} درهم)`,
                          )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Cabinet Pending/Reviewed Requests + Confirmed SaaS Factures / Reçus PDF */}
        {(transferRequests.length > 0 || cabinetPayments.length > 0) && (
          <div className="pt-4 border-t border-slate-200 space-y-4">
            {transferRequests.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  {tr(
                    `Vos demandes de règlement hors-ligne (${transferRequests.length})`,
                    `طلبات الأداء غير الفورية (${transferRequests.length})`,
                  )}
                </h5>
                <div className="space-y-1.5 max-h-36 overflow-y-auto text-xs">
                  {transferRequests.map((req) => (
                    <div
                      key={req.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50"
                    >
                      <div>
                        <span className="font-mono font-bold text-slate-900">
                          {req.transferReference}
                        </span>
                        <span className="text-slate-600 ms-2">
                          {Number(req.amount || 0).toLocaleString('fr-MA')} MAD ·{' '}
                          {req.months} {tr('mois', 'أشهر')} (
                          {req.cashChannel
                            ? getCashChannelLabel(req.cashChannel, tr)
                            : req.bankName}
                          )
                        </span>
                        {req.promoCode && (
                          <span className="ms-1.5 text-[10px] font-mono font-bold text-teal-700">
                            [{req.promoCode}]
                          </span>
                        )}
                        {req.rejectionReason && (
                          <div className="text-[11px] text-rose-700 mt-0.5">
                            {tr('Motif :', 'السبب:')} {req.rejectionReason}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {req.proofUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              void openAuthenticatedUpload(req.proofUrl!)
                            }
                            className="px-2 py-1 rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 font-semibold text-[11px]"
                          >
                            {tr('Voir reçu', 'عرض الوصل')}
                          </button>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                            req.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : req.status === 'rejected'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {req.status === 'approved'
                            ? tr('Validé', 'مصادق عليه')
                            : req.status === 'rejected'
                              ? tr('Refusé', 'مرفوض')
                              : tr('En attente', 'قيد المراجعة')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {cabinetPayments.length > 0 && (
              <div className="space-y-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  {tr(
                    `Mes Factures & Reçus Officiels (${cabinetPayments.length})`,
                    `فواتيري ووصولاتي الرسمية (${cabinetPayments.length})`,
                  )}
                </h5>
                <div className="space-y-1.5 max-h-44 overflow-y-auto text-xs">
                  {cabinetPayments.map((p) => {
                    const badge = getMethodBadgeMeta(p.method, tr);
                    return (
                      <div
                        key={p.id}
                        className={`flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border ${
                          p.voidedAt
                            ? 'border-slate-200 bg-slate-50 opacity-75'
                            : 'border-slate-200 bg-white'
                        }`}
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold text-teal-900">
                              {p.invoiceNumber || p.receiptNumber || p.reference}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${badge.badgeClass}`}
                            >
                              {badge.label}
                            </span>
                            {p.voidedAt && (
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                                {tr('Annulé / Avoir', 'ملغى')}
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {new Date(p.createdAt).toLocaleDateString(
                              language === 'ar' ? 'ar-MA' : 'fr-MA',
                            )}{' '}
                            ·{' '}
                            <span className="font-mono font-bold text-slate-800">
                              {Number(p.amount || 0).toLocaleString('fr-MA')} MAD
                            </span>{' '}
                            · {p.months} {tr('mois', 'أشهر')} ({p.plan})
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={pdfDownloadingId === p.id}
                          onClick={() => void handleDownloadInvoice(p)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-teal-300 bg-teal-50 text-teal-900 hover:bg-teal-100 font-bold text-[11px] disabled:opacity-50"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {pdfDownloadingId === p.id
                            ? tr('Génération...', 'جاري التحميل...')
                            : tr('Facture PDF', 'فاتورة PDF')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default SubscriptionRenewalModal;
