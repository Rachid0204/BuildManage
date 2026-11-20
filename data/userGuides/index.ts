import { SYNDIC_GUIDES } from './syndicGuides';
import { RESIDENT_GUIDES } from './residentGuides';
import { PROVIDER_GUIDES } from './providerGuides';
import { ADMIN_GUIDES } from './adminGuides';
import type { GuideRole, GuideRoleMeta, UserGuideArticle } from './types';

export type {
  GuideFaqItem,
  GuideRole,
  GuideRoleMeta,
  GuideScreenshot,
  GuideStep,
  UserGuideArticle,
} from './types';

export const GUIDE_ROLES: GuideRoleMeta[] = [
  {
    id: 'syndic',
    labelFr: 'Syndic Gestionnaire',
    labelAr: 'وكيل الاتحاد (السنديك)',
    descriptionFr:
      'Immeubles, lots & tantièmes, finances Loi 18-00, AG, maintenance, documents et abonnement SaaS.',
    descriptionAr:
      'العمارات والأنصبة والمحاسبة القانونية والجموع العامة والصيانة والوثائق واشتراك المنصة.',
    badgeClass: 'bg-teal-100 text-teal-900 border-teal-200',
  },
  {
    id: 'resident',
    labelFr: 'Copropriétaire & Locataire',
    labelAr: 'المالك المشترك والمكتري',
    descriptionFr:
      'Charges, envoi de justificatifs, quittances PDF, vote en ligne AG, incidents, messagerie et Le Souk.',
    descriptionAr:
      'الواجبات وإرسال الوصولات وتوصيلات PDF والتصويت الإلكتروني والأعطاب وسوق الإقامة.',
    badgeClass: 'bg-sky-100 text-sky-900 border-sky-200',
  },
  {
    id: 'provider',
    labelFr: 'Prestataire Agréé',
    labelAr: 'مقدم الخدمة المعتمد',
    descriptionFr:
      'Activation du compte partenaire, suivi des bons d’intervention, notes techniques et clôture.',
    descriptionAr:
      'تفعيل حساب الشريك التقني وتتبع أوامر التدخل وكتابة التقارير وإغلاق الإصلاحات.',
    badgeClass: 'bg-amber-100 text-amber-900 border-amber-200',
  },
  {
    id: 'admin',
    labelFr: 'Super-Admin SaaS',
    labelAr: 'الإدارة العامة للمنصة',
    descriptionFr:
      'Cabinets syndics, passerelles CMI/PayPal/RIB/Espèces, profil fiscal, codes promo et audit.',
    descriptionAr:
      'إدارة مكاتب السنديك وبوابات الدفع المغربية والملف الضريبي والرموز الترويجية والتدقيق.',
    badgeClass: 'bg-slate-900 text-amber-300 border-slate-700',
  },
];

export const ALL_USER_GUIDES: UserGuideArticle[] = [
  ...SYNDIC_GUIDES,
  ...RESIDENT_GUIDES,
  ...PROVIDER_GUIDES,
  ...ADMIN_GUIDES,
];

export function getGuidesByRole(role: GuideRole): UserGuideArticle[] {
  return ALL_USER_GUIDES.filter((g) => g.role === role);
}

export function getGuideById(id: string): UserGuideArticle | undefined {
  return ALL_USER_GUIDES.find((g) => g.id === id);
}

/**
 * Returns the contextual guide(s) matching a given portal role and active route/tab key.
 * Falls back cleanly to the first guide of that role if no exact contextKey matches.
 */
export function resolveContextualGuides(
  role: GuideRole,
  contextKey?: string,
): UserGuideArticle[] {
  const roleGuides = getGuidesByRole(role);
  const normalized = (contextKey || '').trim().toLowerCase();
  if (normalized) {
    const matched = roleGuides.filter((g) =>
      g.contextKeys.some((k) => k.toLowerCase() === normalized),
    );
    if (matched.length > 0) return matched;
  }
  return roleGuides.slice(0, 1);
}

export function searchGuides(
  query: string,
  role?: GuideRole | 'all',
): UserGuideArticle[] {
  const base =
    role && role !== 'all' ? getGuidesByRole(role) : ALL_USER_GUIDES;
  const q = query.trim().toLowerCase();
  if (!q) return base;
  const tokens = q.split(/\s+/).filter(Boolean);
  return base.filter((guide) => {
    const haystack = [
      guide.id,
      guide.categoryFr,
      guide.categoryAr,
      guide.titleFr,
      guide.titleAr,
      guide.summaryFr,
      guide.summaryAr,
      guide.legalNoteFr || '',
      guide.legalNoteAr || '',
      ...guide.steps.flatMap((s) => [
        s.titleFr,
        s.titleAr,
        s.bodyFr,
        s.bodyAr,
        s.tipFr || '',
        s.tipAr || '',
      ]),
      ...(guide.faq || []).flatMap((f) => [f.qFr, f.qAr, f.aFr, f.aAr]),
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((tok) => haystack.includes(tok));
  });
}
