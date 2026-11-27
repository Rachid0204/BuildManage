import { z } from 'zod';

export interface LegalFrameworkCitations {
  regimeBadgeFr: string;
  regimeBadgeAr: string;
  statuteFullTitleFr: string;
  statuteFullTitleAr: string;
  statuteShortFr: string;
  statuteShortAr: string;
  stampCodeFr: string;
  reserveFundRefFr: string;
  reserveFundRefAr: string;
  accountingRefFr: string;
  accountingRefAr: string;
  collectionNoticeRefFr: string;
  collectionNoticeRefAr: string;
  agConvocationRefFr: string;
  agConvocationRefAr: string;
  agProxyRefFr: string;
  agProxyRefAr: string;
  agAttendanceRefFr: string;
  agAttendanceRefAr: string;
  agMajoritySimpleRefFr: string;
  agMajoritySimpleRefAr: string;
  agMajorityAbsoluteRefFr: string;
  agMajorityAbsoluteRefAr: string;
  agMajorityThreeQuartersRefFr: string;
  agMajorityThreeQuartersRefAr: string;
  agMajorityUnanimityRefFr: string;
  agMajorityUnanimityRefAr: string;
  dataPrivacyLawFr: string;
  dataPrivacyLawAr: string;
}

export interface LegalFrameworkRules {
  defaultReserveFundPercent: number;
  maxProxiesPerHolder: number;
  maxProxyTantiemesSharePercent: number;
  convocationNoticeDays: number;
  miseEnDemeureNoticeDays: number;
}

export interface LegalFrameworkConfig {
  effectiveDate?: string;
  updatedAt?: string;
  updatedBy?: string;
  citations: LegalFrameworkCitations;
  rules: LegalFrameworkRules;
}

export interface StoredLegalFrameworkConfig {
  effectiveDate?: string;
  updatedAt?: string;
  updatedBy?: string;
  citations?: Partial<LegalFrameworkCitations>;
  rules?: Partial<LegalFrameworkRules>;
}

export const DEFAULT_LEGAL_FRAMEWORK: LegalFrameworkConfig = {
  citations: {
    regimeBadgeFr: 'Conforme Copropriété Maroc',
    regimeBadgeAr: 'مطابق لتشريع الملكية المشتركة بالمغرب',
    statuteFullTitleFr:
      'Loi n° 18-00 relative au statut de la copropriété des immeubles bâtis (modifiée et complétée par la Loi n° 106-12)',
    statuteFullTitleAr:
      'القانون رقم 18-00 المتعلق بنظام الملكية المشتركة للعقارات المبنية (كما تم تغييره وتتميمه بالقانون رقم 106-12)',
    statuteShortFr: 'Loi n° 18-00 / 106-12',
    statuteShortAr: 'القانون رقم 18-00 / 106-12',
    stampCodeFr: 'COPROPRIÉTÉ MAROC',
    reserveFundRefFr: 'Loi n° 106-12 (Art. 18 bis)',
    reserveFundRefAr: 'القانون رقم 106-12 (المادة 18 مكرر)',
    accountingRefFr: 'Loi n° 18-00 / 106-12 (Art. 24 & 26)',
    accountingRefAr: 'القانون رقم 18-00 / 106-12 (المادتان 24 و 26)',
    collectionNoticeRefFr: 'Article 25 de la Loi n° 18-00 / 106-12',
    collectionNoticeRefAr: 'المادة 25 من القانون رقم 18-00 / 106-12',
    agConvocationRefFr: 'Loi n° 18-00 / 106-12 (Art. 16-2 & Art. 18)',
    agConvocationRefAr: 'القانون رقم 18-00 / 106-12 (المادة 16-2 والمادة 18)',
    agProxyRefFr: 'Loi n° 18-00 / 106-12 (Art. 16-6)',
    agProxyRefAr: 'القانون رقم 18-00 / 106-12 (المادة 16-6)',
    agAttendanceRefFr: 'Loi n° 18-00 / 106-12 (Art. 16-8)',
    agAttendanceRefAr: 'القانون رقم 18-00 / 106-12 (المادة 16-8)',
    agMajoritySimpleRefFr: 'Art. 21',
    agMajoritySimpleRefAr: 'المادة 21',
    agMajorityAbsoluteRefFr: 'Art. 21',
    agMajorityAbsoluteRefAr: 'المادة 21',
    agMajorityThreeQuartersRefFr: 'Art. 22',
    agMajorityThreeQuartersRefAr: 'المادة 22',
    agMajorityUnanimityRefFr: 'Art. 24',
    agMajorityUnanimityRefAr: 'المادة 24',
    dataPrivacyLawFr: 'Loi n° 09-08 (CNDP)',
    dataPrivacyLawAr: 'القانون رقم 09-08 (CNDP)',
  },
  rules: {
    defaultReserveFundPercent: 5,
    maxProxiesPerHolder: 3,
    maxProxyTantiemesSharePercent: 10,
    convocationNoticeDays: 15,
    miseEnDemeureNoticeDays: 30,
  },
};

const shortText = (max = 240) => z.string().trim().min(1).max(max);

export const LegalFrameworkCitationsPatchSchema = z
  .object({
    regimeBadgeFr: shortText(120).optional(),
    regimeBadgeAr: shortText(120).optional(),
    statuteFullTitleFr: shortText(360).optional(),
    statuteFullTitleAr: shortText(360).optional(),
    statuteShortFr: shortText(140).optional(),
    statuteShortAr: shortText(140).optional(),
    stampCodeFr: shortText(40).optional(),
    reserveFundRefFr: shortText(140).optional(),
    reserveFundRefAr: shortText(140).optional(),
    accountingRefFr: shortText(140).optional(),
    accountingRefAr: shortText(140).optional(),
    collectionNoticeRefFr: shortText(160).optional(),
    collectionNoticeRefAr: shortText(160).optional(),
    agConvocationRefFr: shortText(140).optional(),
    agConvocationRefAr: shortText(140).optional(),
    agProxyRefFr: shortText(140).optional(),
    agProxyRefAr: shortText(140).optional(),
    agAttendanceRefFr: shortText(140).optional(),
    agAttendanceRefAr: shortText(140).optional(),
    agMajoritySimpleRefFr: shortText(100).optional(),
    agMajoritySimpleRefAr: shortText(100).optional(),
    agMajorityAbsoluteRefFr: shortText(100).optional(),
    agMajorityAbsoluteRefAr: shortText(100).optional(),
    agMajorityThreeQuartersRefFr: shortText(100).optional(),
    agMajorityThreeQuartersRefAr: shortText(100).optional(),
    agMajorityUnanimityRefFr: shortText(100).optional(),
    agMajorityUnanimityRefAr: shortText(100).optional(),
    dataPrivacyLawFr: shortText(140).optional(),
    dataPrivacyLawAr: shortText(140).optional(),
  })
  .strict();

export const LegalFrameworkRulesPatchSchema = z
  .object({
    defaultReserveFundPercent: z.number().finite().min(0).max(50).optional(),
    maxProxiesPerHolder: z.number().int().min(1).max(20).optional(),
    maxProxyTantiemesSharePercent: z.number().finite().min(1).max(100).optional(),
    convocationNoticeDays: z.number().int().min(1).max(90).optional(),
    miseEnDemeureNoticeDays: z.number().int().min(1).max(180).optional(),
  })
  .strict();

export const LegalFrameworkUpdateSchema = z
  .object({
    resetToDefaults: z.boolean().optional(),
    effectiveDate: z.string().trim().max(40).optional(),
    citations: LegalFrameworkCitationsPatchSchema.optional(),
    rules: LegalFrameworkRulesPatchSchema.optional(),
  })
  .strict();

export type LegalFrameworkUpdateInput = z.infer<typeof LegalFrameworkUpdateSchema>;

function pickNonEmptyString(candidate: unknown, fallback: string): string {
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return fallback;
}

function pickBoundedNumber(
  candidate: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= min && candidate <= max) {
    return integer ? Math.round(candidate) : Number(candidate.toFixed(2));
  }
  return fallback;
}

export function resolveLegalFramework(
  stored?: StoredLegalFrameworkConfig | null,
): LegalFrameworkConfig {
  const c = stored?.citations || {};
  const r = stored?.rules || {};
  const d = DEFAULT_LEGAL_FRAMEWORK;

  return {
    ...(stored?.effectiveDate ? { effectiveDate: String(stored.effectiveDate).trim().slice(0, 40) } : {}),
    ...(stored?.updatedAt ? { updatedAt: String(stored.updatedAt) } : {}),
    ...(stored?.updatedBy ? { updatedBy: String(stored.updatedBy) } : {}),
    citations: {
      regimeBadgeFr: pickNonEmptyString(c.regimeBadgeFr, d.citations.regimeBadgeFr),
      regimeBadgeAr: pickNonEmptyString(c.regimeBadgeAr, d.citations.regimeBadgeAr),
      statuteFullTitleFr: pickNonEmptyString(c.statuteFullTitleFr, d.citations.statuteFullTitleFr),
      statuteFullTitleAr: pickNonEmptyString(c.statuteFullTitleAr, d.citations.statuteFullTitleAr),
      statuteShortFr: pickNonEmptyString(c.statuteShortFr, d.citations.statuteShortFr),
      statuteShortAr: pickNonEmptyString(c.statuteShortAr, d.citations.statuteShortAr),
      stampCodeFr: pickNonEmptyString(c.stampCodeFr, d.citations.stampCodeFr),
      reserveFundRefFr: pickNonEmptyString(c.reserveFundRefFr, d.citations.reserveFundRefFr),
      reserveFundRefAr: pickNonEmptyString(c.reserveFundRefAr, d.citations.reserveFundRefAr),
      accountingRefFr: pickNonEmptyString(c.accountingRefFr, d.citations.accountingRefFr),
      accountingRefAr: pickNonEmptyString(c.accountingRefAr, d.citations.accountingRefAr),
      collectionNoticeRefFr: pickNonEmptyString(c.collectionNoticeRefFr, d.citations.collectionNoticeRefFr),
      collectionNoticeRefAr: pickNonEmptyString(c.collectionNoticeRefAr, d.citations.collectionNoticeRefAr),
      agConvocationRefFr: pickNonEmptyString(c.agConvocationRefFr, d.citations.agConvocationRefFr),
      agConvocationRefAr: pickNonEmptyString(c.agConvocationRefAr, d.citations.agConvocationRefAr),
      agProxyRefFr: pickNonEmptyString(c.agProxyRefFr, d.citations.agProxyRefFr),
      agProxyRefAr: pickNonEmptyString(c.agProxyRefAr, d.citations.agProxyRefAr),
      agAttendanceRefFr: pickNonEmptyString(c.agAttendanceRefFr, d.citations.agAttendanceRefFr),
      agAttendanceRefAr: pickNonEmptyString(c.agAttendanceRefAr, d.citations.agAttendanceRefAr),
      agMajoritySimpleRefFr: pickNonEmptyString(c.agMajoritySimpleRefFr, d.citations.agMajoritySimpleRefFr),
      agMajoritySimpleRefAr: pickNonEmptyString(c.agMajoritySimpleRefAr, d.citations.agMajoritySimpleRefAr),
      agMajorityAbsoluteRefFr: pickNonEmptyString(c.agMajorityAbsoluteRefFr, d.citations.agMajorityAbsoluteRefFr),
      agMajorityAbsoluteRefAr: pickNonEmptyString(c.agMajorityAbsoluteRefAr, d.citations.agMajorityAbsoluteRefAr),
      agMajorityThreeQuartersRefFr: pickNonEmptyString(
        c.agMajorityThreeQuartersRefFr,
        d.citations.agMajorityThreeQuartersRefFr,
      ),
      agMajorityThreeQuartersRefAr: pickNonEmptyString(
        c.agMajorityThreeQuartersRefAr,
        d.citations.agMajorityThreeQuartersRefAr,
      ),
      agMajorityUnanimityRefFr: pickNonEmptyString(
        c.agMajorityUnanimityRefFr,
        d.citations.agMajorityUnanimityRefFr,
      ),
      agMajorityUnanimityRefAr: pickNonEmptyString(
        c.agMajorityUnanimityRefAr,
        d.citations.agMajorityUnanimityRefAr,
      ),
      dataPrivacyLawFr: pickNonEmptyString(c.dataPrivacyLawFr, d.citations.dataPrivacyLawFr),
      dataPrivacyLawAr: pickNonEmptyString(c.dataPrivacyLawAr, d.citations.dataPrivacyLawAr),
    },
    rules: {
      defaultReserveFundPercent: pickBoundedNumber(
        r.defaultReserveFundPercent,
        d.rules.defaultReserveFundPercent,
        0,
        50,
      ),
      maxProxiesPerHolder: pickBoundedNumber(
        r.maxProxiesPerHolder,
        d.rules.maxProxiesPerHolder,
        1,
        20,
        true,
      ),
      maxProxyTantiemesSharePercent: pickBoundedNumber(
        r.maxProxyTantiemesSharePercent,
        d.rules.maxProxyTantiemesSharePercent,
        1,
        100,
      ),
      convocationNoticeDays: pickBoundedNumber(
        r.convocationNoticeDays,
        d.rules.convocationNoticeDays,
        1,
        90,
        true,
      ),
      miseEnDemeureNoticeDays: pickBoundedNumber(
        r.miseEnDemeureNoticeDays,
        d.rules.miseEnDemeureNoticeDays,
        1,
        180,
        true,
      ),
    },
  };
}

let activeLegalFrameworkSnapshot: LegalFrameworkConfig = DEFAULT_LEGAL_FRAMEWORK;

export function getActiveLegalFramework(): LegalFrameworkConfig {
  return activeLegalFrameworkSnapshot;
}

export function setActiveLegalFramework(config: LegalFrameworkConfig): void {
  activeLegalFrameworkSnapshot = config;
}

