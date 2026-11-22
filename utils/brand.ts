/**
 * Centralized SyndicUnion brand identity constants & design tokens.
 *
 * NOTE: Internal technical storage keys (`syndik_prod_*`), session keys
 * (`syndik_auth_session_v1`), server env vars (`SYNDIK_*`), and the Android
 * notification channel (`syndik_alerts`) are intentionally NOT changed to
 * preserve live production data, sessions, and push delivery.
 */

export const BRAND_NAME = 'SyndicUnion';
export const BRAND_SHORT_NAME = 'SyndicUnion';
export const BRAND_COMPANY_MOROCCO = 'SyndicUnion Maroc';
export const BRAND_DOMAIN = 'syndicunion.ma';
export const BRAND_URL = 'https://syndicunion.ma';
export const BRAND_LOGIN_URL = 'https://syndicunion.ma/login';
export const BRAND_SUPPORT_EMAIL = 'support@syndicunion.ma';
export const BRAND_MOTIF_PREFIX = 'SYNDICUNION';

export const BRAND_TAGLINE_FR = 'La copropriété unie, transparente et conforme.';
export const BRAND_TAGLINE_AR = 'ملكية مشتركة موحّدة، شفافة ومطابقة للقانون.';
export const BRAND_LAW_BADGE = 'Loi 18-00 & 106-12';
export const BRAND_LAW_BADGE_AR = 'القانون 18-00 و 106-12';

export const BRAND_COLORS = {
  primary: '#0F766E',
  primaryBright: '#0D9488',
  primaryDark: '#042F2E',
  accent: '#D97706',
  accentBright: '#F59E0B',
  accentSoft: '#FEF3C7',
  surfaceCanvas: '#F8F7F4',
  ink: '#0F172A',
} as const;
