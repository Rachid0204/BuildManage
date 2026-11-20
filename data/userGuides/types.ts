export type GuideRole = 'syndic' | 'resident' | 'provider' | 'admin';

export interface GuideScreenshot {
  /** Public path served from public/guides/screenshots/... */
  src: string;
  altFr: string;
  altAr: string;
  captionFr?: string;
  captionAr?: string;
}

export interface GuideStep {
  titleFr: string;
  titleAr: string;
  bodyFr: string;
  bodyAr: string;
  tipFr?: string;
  tipAr?: string;
  screenshot?: GuideScreenshot;
}

export interface GuideFaqItem {
  qFr: string;
  qAr: string;
  aFr: string;
  aAr: string;
}

export interface UserGuideArticle {
  id: string;
  role: GuideRole;
  categoryFr: string;
  categoryAr: string;
  /** Route segments or tab keys that auto-select this guide in the contextual '?' drawer */
  contextKeys: string[];
  estimatedMinutes: number;
  titleFr: string;
  titleAr: string;
  summaryFr: string;
  summaryAr: string;
  prerequisitesFr?: string[];
  prerequisitesAr?: string[];
  steps: GuideStep[];
  legalNoteFr?: string;
  legalNoteAr?: string;
  faq?: GuideFaqItem[];
}

export interface GuideRoleMeta {
  id: GuideRole;
  labelFr: string;
  labelAr: string;
  descriptionFr: string;
  descriptionAr: string;
  badgeClass: string;
}
