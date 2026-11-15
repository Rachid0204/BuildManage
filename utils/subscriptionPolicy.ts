import type { SubscriptionPlan, SubscriptionStatus } from '../types';
import { PLANS } from '../shared/domain/subscription';
export * from '../shared/domain/subscription';

export const SUBSCRIPTION_TRIAL_DAYS = 30;

export interface PlanCatalogEntry {
  id: SubscriptionPlan;
  priceMad: number;
  buildingsLimit: number;
  popular?: boolean;
  nameFr: string;
  nameAr: string;
  targetFr: string;
  targetAr: string;
  badgeFr: string;
  badgeAr: string;
  limitLabelFr: string;
  limitLabelAr: string;
  ctaFr: string;
  ctaAr: string;
  highlightsFr: string[];
  highlightsAr: string[];
}

export const PLAN_CATALOG: Record<SubscriptionPlan, PlanCatalogEntry> = {
  starter: {
    id: 'starter',
    priceMad: PLANS.starter.price,
    buildingsLimit: PLANS.starter.buildings,
    nameFr: 'Essentiel',
    nameAr: 'الأساسية',
    targetFr: 'Idéal pour syndic bénévole & petites copropriétés',
    targetAr: 'مثالية للسنديك التطوعي والإقامات الصغيرة',
    badgeFr: '≤ 4 immeubles',
    badgeAr: 'حتى 4 عمارات',
    limitLabelFr: "Jusqu'à 4 immeubles actifs",
    limitLabelAr: 'حتى 4 عمارات نشطة',
    ctaFr: 'Essayer Essentiel gratuitement',
    ctaAr: 'جرّب الباقة الأساسية مجاناً',
    highlightsFr: [
      'Jusqu’à 4 immeubles & lots illimités',
      'Appels mensuels automatisés & tantièmes Loi 18-00',
      'Quittances PDF numérotées & Fonds de Réserve 106-12',
      'Portails Résidents & Prestataires + Fiches d’accès PDF',
      'Assemblées Générales (AGO/AGE), Messagerie interne & Le Souk',
    ],
    highlightsAr: [
      'حتى 4 عمارات وشقق غير محدودة',
      'فوترة شهرية تلقائية وحصص التانتييم (قانون 18-00)',
      'وصولات PDF مرقمة وصندوق الاحتياط (قانون 106-12)',
      'بوابات السكان ومقدمي الخدمات + بطاقات الولوج PDF',
      'الجموع العامة، المراسلة الداخلية وسوق الإقامة مشمولة',
    ],
  },
  professional: {
    id: 'professional',
    priceMad: PLANS.professional.price,
    buildingsLimit: PLANS.professional.buildings,
    popular: true,
    nameFr: 'Pro',
    nameAr: 'الاحترافية',
    targetFr: 'Pour les cabinets syndics professionnels en croissance',
    targetAr: 'لمكاتب السنديك المهنية في طور النمو',
    badgeFr: '≤ 8 immeubles',
    badgeAr: 'حتى 8 عمارات',
    limitLabelFr: "Jusqu'à 8 immeubles actifs",
    limitLabelAr: 'حتى 8 عمارات نشطة',
    ctaFr: 'Démarrer avec Pro (30 j offerts)',
    ctaAr: 'ابدأ بالباقة الاحترافية (30 يوماً مجاناً)',
    highlightsFr: [
      'Jusqu’à 8 immeubles actifs (archives conservées à vie)',
      'Rapprochement bancaire CSV & validation 1-clic des virements',
      'Appels travaux AG configurables & clôture comptable',
      'Suivi prestataires agréés (ICE/RC/RIB) & interventions photo',
      'Messagerie interne (4 canaux d’entraide) & Le Souk de la résidence',
    ],
    highlightsAr: [
      'حتى 8 عمارات نشطة (مع حفظ الأرشيف مدى الحياة)',
      'مطابقة كشف الحساب البنكي CSV واعتماد التحويلات بنقرة',
      'طلبات تمويل الأشغال من الجمع العام وإغلاق الفترة المحاسبية',
      'تتبع المزودين المعتمدين (ICE/RC) والتدخلات بالصور',
      'مراسلة داخلية (4 قنوات للتعاون) وسوق الإقامة بين الجيران',
    ],
  },
  enterprise: {
    id: 'enterprise',
    priceMad: PLANS.enterprise.price,
    buildingsLimit: PLANS.enterprise.buildings,
    nameFr: 'Entreprise',
    nameAr: 'المقاولات',
    targetFr: 'Pour les grands cabinets & gestionnaires multi-villes',
    targetAr: 'للمكاتب الكبرى ومديري العقارات متعددي المدن',
    badgeFr: 'Illimité',
    badgeAr: 'غير محدود',
    limitLabelFr: 'Immeubles & résidences illimités',
    limitLabelAr: 'عدد غير محدود من العمارات',
    ctaFr: 'Choisir Entreprise',
    ctaAr: 'اختر باقة المقاولات',
    highlightsFr: [
      'Immeubles, lots, résidents & prestataires illimités',
      'Toutes les fonctionnalités Finance, AG, Banque CSV & Vie de résidence',
      'Messagerie communautaire, entraide & Le Souk inclus pour chaque immeuble',
      'Import des soldes initiaux & arriérés d’ouverture',
      'Accompagnement démarrage & support prioritaire WhatsApp',
    ],
    highlightsAr: [
      'عدد غير محدود من العمارات والشقق والسكان والمزودين',
      'جميع خصائص المالية والجموع العامة والبنك والحياة المشتركة',
      'المراسلة الداخلية (4 قنوات) وسوق الإقامة مشمولة لكل عمارة',
      'استيراد الأرصدة الافتتاحية والمتأخرات السابقة',
      'مواكبة الإطلاق ودعم فني ذو أولوية عبر واتساب',
    ],
  },
};

export function getEffectiveSubscriptionStatus(
  cabinet: {
    subscriptionStatus?: string;
    subscriptionExpiry?: string;
  },
  nowMs: number = Date.now(),
): SubscriptionStatus {
  if (cabinet.subscriptionStatus === 'cancelled') return 'cancelled';
  const rawExpiry = (cabinet.subscriptionExpiry || '').trim();
  const normalizedExpiry = /^\d{4}-\d{2}-\d{2}$/.test(rawExpiry)
    ? `${rawExpiry}T23:59:59.999Z`
    : rawExpiry;
  const expiryMs = Date.parse(normalizedExpiry);
  if (
    cabinet.subscriptionStatus === 'expired' ||
    !Number.isFinite(expiryMs) ||
    expiryMs <= nowMs
  ) {
    return 'expired';
  }
  if (cabinet.subscriptionStatus === 'trialing') return 'trialing';
  if (cabinet.subscriptionStatus === 'active') return 'active';
  return 'expired';
}

export function subscriptionCanWrite(cabinet: {
  subscriptionStatus?: string;
  subscriptionExpiry?: string;
}) {
  const effective = getEffectiveSubscriptionStatus(cabinet);
  return effective === 'active' || effective === 'trialing';
}


