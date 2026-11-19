import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  CreditCard,
  FileUp,
  Landmark,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { useI18n } from '../../hooks/useI18n';
import {
  capturePayPalSubscriptionOrder,
  createPayPalSubscriptionOrder,
  getSubscriptionBankTransferRequests,
  getSubscriptionBillingConfig,
  openAuthenticatedUpload,
  submitSubscriptionBankTransfer,
  uploadSubscriptionProof,
} from '../../firebase/services';
import { PLANS, PLAN_CATALOG } from '../../utils/subscriptionPolicy';
import type {
  PublicPlatformBillingConfig,
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

function computeClientPaypalAmount(
  config: PublicPlatformBillingConfig | undefined,
  plan: SubscriptionPlan,
  months: number,
): number {
  const monthlyMad = PLANS[plan].price;
  if (!config) return Number(((monthlyMad / 10) * months).toFixed(2));
  const override = config.paypal.planPrices?.[plan];
  const monthlyCents =
    typeof override === 'number' && override > 0
      ? Math.round(override * 100)
      : Math.max(100, Math.round((monthlyMad / config.paypal.madPerUnit) * 100));
  return Number((Math.max(100, monthlyCents * months) / 100).toFixed(2));
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
          'Impossible de charger le module de paiement PayPal. Vérifiez votre connexion internet ou utilisez le virement bancaire.',
        ),
      );
    document.head.appendChild(script);
  });
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
  const [paymentTab, setPaymentTab] = useState<'paypal' | 'virement'>('paypal');

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

  // Bank transfer form state
  const [copiedField, setCopiedField] = useState<'rib' | 'motif' | null>(null);
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

  const { data: billingConfig, isLoading: loadingConfig } = useQuery({
    queryKey: ['subscriptionBillingConfig'],
    queryFn: getSubscriptionBillingConfig,
    enabled: isOpen,
    staleTime: 30_000,
  });

  const {
    data: transferRequests = [],
    refetch: refetchRequests,
  } = useQuery({
    queryKey: ['subscriptionBankRequests', syndic.id],
    queryFn: () => getSubscriptionBankTransferRequests(syndic.id),
    enabled: isOpen,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!isOpen) return;
    setSelectedPlan(syndic.subscriptionPlan || 'professional');
    setCheckoutError('');
    setCheckoutSuccess('');
    setBankError('');
    setBankMessage('');
  }, [isOpen, syndic.id, syndic.subscriptionPlan]);

  useEffect(() => {
    if (!billingConfig) return;
    if (!billingConfig.paypal.enabled && billingConfig.bankTransfer.enabled) {
      setPaymentTab('virement');
    } else if (
      billingConfig.paypal.enabled &&
      !billingConfig.bankTransfer.enabled
    ) {
      setPaymentTab('paypal');
    }
  }, [billingConfig]);

  const selectionRef = useRef({
    syndicId: syndic.id,
    plan: selectedPlan,
    months: selectedMonths,
  });
  useEffect(() => {
    selectionRef.current = {
      syndicId: syndic.id,
      plan: selectedPlan,
      months: selectedMonths,
    };
  }, [syndic.id, selectedPlan, selectedMonths]);

  const totalMad = PLANS[selectedPlan].price * selectedMonths;
  const paypalAmount = useMemo(
    () => computeClientPaypalAmount(billingConfig, selectedPlan, selectedMonths),
    [billingConfig, selectedPlan, selectedMonths],
  );
  const motifSuggestion = `SYNDIK-${syndic.id.slice(0, 8).toUpperCase()}`;

  useEffect(() => {
    if (
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
              const cur = selectionRef.current;
              const order = await createPayPalSubscriptionOrder({
                syndicId: cur.syndicId,
                plan: cur.plan,
                months: cur.months,
                paymentSourceHint: 'paypal',
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
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['syndics'] }),
                    queryClient.invalidateQueries({
                      queryKey: ['subscriptionPayments'],
                    }),
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
                    'Une erreur est survenue avec PayPal. Vous pouvez réessayer ou régler par virement bancaire.',
                    'حدث خطأ في PayPal. يمكنك إعادة المحاولة أو الدفع بالتحويل البنكي.',
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
              const cur = selectionRef.current;
              const order = await createPayPalSubscriptionOrder({
                syndicId: cur.syndicId,
                plan: cur.plan,
                months: cur.months,
                paymentSourceHint: 'card',
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
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ['syndics'] }),
                    queryClient.invalidateQueries({
                      queryKey: ['subscriptionPayments'],
                    }),
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
  }, [isOpen, paymentTab, billingConfig, language, queryClient, tr]);

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

  const handleCopy = async (value: string, field: 'rib' | 'motif') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const handleUploadProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBankError('');
    setUploadingProof(true);
    try {
      const uploaded = await uploadSubscriptionProof(syndic.id, file);
      setProofUrl(uploaded.url);
      setProofName(file.name);
    } catch (err) {
      setBankError(
        err instanceof Error
          ? err.message
          : tr(
              'Impossible de téléverser le justificatif.',
              'تعذر رفع وصل التحويل.',
            ),
      );
    } finally {
      setUploadingProof(false);
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
        transferReference: transferRef.trim(),
        bankName: transferBank.trim(),
        transferDate,
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

  const noMethodsConfigured =
    !loadingConfig &&
    billingConfig &&
    !billingConfig.paypal.enabled &&
    !billingConfig.bankTransfer.enabled;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      title={tr(
        'Renouveler ou changer votre abonnement Syndik',
        'تجديد أو تغيير اشتراك منصة Syndik',
      )}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {tr('Fermer', 'إغلاق')}
        </Button>
      }
    >
      <div className="space-y-5">
        {/* Step 1: Select Plan & Duration */}
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
              return (
                <button
                  key={d.months}
                  type="button"
                  onClick={() => setSelectedMonths(d.months)}
                  className={`py-2 px-3 rounded-lg border text-xs font-bold transition-colors ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {language === 'ar' ? d.labelAr : d.labelFr}
                </button>
              );
            })}
          </div>

          {/* Summary Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-900 text-white">
            <div>
              <div className="text-[11px] text-slate-300">
                {tr('Montant total de la période', 'المبلغ الإجمالي للفترة')}
              </div>
              <div className="text-lg font-extrabold font-mono">
                {totalMad.toLocaleString('fr-MA')} MAD
              </div>
            </div>
            {billingConfig?.paypal.enabled && (
              <div className="text-end">
                <div className="text-[11px] text-teal-300">
                  {tr(
                    `Équivalent règlement en ligne (${billingConfig.paypal.currency})`,
                    `المعادل للدفع الإلكتروني (${billingConfig.paypal.currency})`,
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
                'Aucun moyen de paiement (PayPal / Virement) n’est encore activé par l’administrateur. Contactez le support Syndik pour activer votre renouvellement.',
                'لم تقم الإدارة بتفعيل بوابة الدفع بعد. تواصلوا مع دعم المنصة لتجديد اشتراككم.',
              )}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
              {billingConfig?.paypal.enabled && (
                <button
                  type="button"
                  onClick={() => setPaymentTab('paypal')}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    paymentTab === 'paypal'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  {billingConfig.paypal.checkoutMode === 'expanded'
                    ? tr(
                        'Carte Bancaire & PayPal (Instantané)',
                        'بطاقة بنكية و PayPal (تفعيل فوري)',
                      )
                    : tr('PayPal (Activation immédiate)', 'PayPal (تفعيل فوري)')}
                </button>
              )}
              {billingConfig?.bankTransfer.enabled && (
                <button
                  type="button"
                  onClick={() => setPaymentTab('virement')}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors ${
                    paymentTab === 'virement'
                      ? 'bg-teal-700 text-white border-teal-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <Landmark className="w-4 h-4" />
                  {tr('Virement Bancaire (Maroc)', 'تحويل بنكي (المغرب)')}
                </button>
              )}
            </div>

            {paymentTab === 'paypal' && billingConfig?.paypal.enabled && (
              <div className="space-y-4">
                {checkoutSuccess && (
                  <div
                    role="status"
                    className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-start gap-2"
                  >
                    <Sparkles className="w-4 h-4 text-emerald-700 flex-shrink-0 mt-0.5" />
                    <span>{checkoutSuccess}</span>
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

                {/* Expanded Checkout Card Fields (mounted in expanded mode so refs exist when SDK renders) */}
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
                        ? tr('Ou payer avec votre compte PayPal', 'أو الدفع عبر PayPal')
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
                      {tr('Chargement des boutons PayPal...', 'جاري تحميل PayPal...')}
                    </div>
                  )}
                  <div ref={paypalButtonsContainerRef} className="min-h-[48px]" />
                </div>
              </div>
            )}

            {paymentTab === 'virement' &&
              billingConfig?.bankTransfer.enabled && (
                <div className="space-y-4">
                  {/* Beneficiary Bank Coordinates Card */}
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
                          handleCopy(
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
                        onClick={() => handleCopy(motifSuggestion, 'motif')}
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

                  {/* Bank transfer declaration form (no nested <form> inside Modal) */}
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
                            onChange={handleUploadProof}
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
                        onClick={handleSubmitBankTransfer}
                        disabled={submittingBank || uploadingProof}
                      >
                        {submittingBank
                          ? tr('Envoi en cours...', 'جاري الإرسال...')
                          : tr(
                              `Envoyer le justificatif (${totalMad} MAD)`,
                              `إرسال إثبات الدفع (${totalMad} درهم)`,
                            )}
                      </Button>
                    </div>
                  </div>

                  {/* Cabinet recent bank transfer requests */}
                  {transferRequests.length > 0 && (
                    <div className="space-y-2">
                      <h5 className="text-xs font-bold text-slate-700">
                        {tr(
                          'Vos demandes de virement récentes',
                          'طلبات التحويل البنكي الأخيرة',
                        )}
                      </h5>
                      <div className="space-y-1.5 max-h-40 overflow-y-auto text-xs">
                        {transferRequests.map((req) => (
                          <div
                            key={req.id}
                            className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50"
                          >
                            <div>
                              <span className="font-mono font-bold text-slate-900">
                                {req.transferReference}
                              </span>
                              <span className="text-slate-500 ms-2">
                                {req.amount} MAD · {req.months}{' '}
                                {tr('mois', 'أشهر')} ({req.bankName})
                              </span>
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
                </div>
              )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default SubscriptionRenewalModal;
