import type { Quittance } from '../../../types';
import { getRecordedReserveSplit } from '../../../utils/security';

export type FinanceTabType = 'transactions' | 'charges' | 'verifications' | 'quittances' | 'impayes';

export type TranslateFn = (frText: string, arText: string) => string;

export const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  minimumFractionDigits: 2,
});

export const MOROCCAN_BANKS: readonly string[] = [
  '',
  'Attijariwafa Bank',
  'Banque Populaire (BCP)',
  'Bank of Africa (BMCE)',
  'CIH Bank',
  'Société Générale Maroc',
  'Crédit du Maroc',
  'Al Barid Bank',
  'CFG Bank',
  'Autre / Trésorerie Caisse',
];

export function formatRecordedFund(
  receipt: Quittance,
  fund: 'reserveFundAmount' | 'chargesCourantesAmount',
  tr: TranslateFn,
): string {
  const split = getRecordedReserveSplit(receipt);
  return split ? currencyFormatter.format(split[fund]) : tr('Non documenté', 'غير موثق');
}

export function buildCategoryLabels(tr: TranslateFn): Record<string, string> {
  return {
    maintenance: tr('Maintenance & Dépannages', 'الصيانة والإصلاحات'),
    elevator: tr('Ascenseur & Équipements', 'المصعد والتجهيزات'),
    salary: tr('Salaires (Gardien / Concierge)', 'رواتب (الحارس / البواب)'),
    utility: tr('Électricité & Eau (Lydec/Redal)', 'الكهرباء والماء (ليدك / ريضال)'),
    cleaning: tr('Nettoyage & Hygiène', 'النظافة والصحة'),
    fees: tr('Cotisations Copropriété', 'مساهمات الملكية المشتركة'),
    insurance: tr('Assurance Multirisque', 'التأمين المتعدد المخاطر'),
    bank_fees: tr('Frais Bancaires', 'المصاريف البنكية'),
    legal: tr('Contentieux & Recouvrement', 'المنازعات والتحصيل'),
    reserve: tr('Gros travaux (Fonds Réserve)', 'الأشغال الكبرى (صندوق الاحتياط)'),
    reimbursement: tr('Remboursement / Sinistre', 'تعويض / حادث'),
    other: tr('Autre opération', 'عملية أخرى'),
  };
}

export function buildPaymentMethodLabels(tr: TranslateFn): Record<string, string> {
  return {
    virement: tr('Virement bancaire', 'تحويل بنكي'),
    cheque: tr('Chèque', 'شيك'),
    versement: tr('Versement agence', 'إيداع بالوكالة'),
    versement_especes: tr('Versement espèces', 'إيداع نقدي'),
    cmi: tr('Carte CMI', 'بطاقة بنكية CMI'),
    especes: tr('Espèces (Caisse)', 'نقداً (الصندوق)'),
  };
}

export function buildDocumentTypeLabels(tr: TranslateFn): Record<string, string> {
  return {
    facture: tr('Facture Fournisseur', 'فاتورة المورد'),
    quittance: tr('Quittance', 'وصل إبراء (مخالصة)'),
    recu: tr('Reçu / Décharge', 'إيصال / إبراء'),
    releve: tr('Relevé / Avis d’opéré', 'كشف / إشعار بالعملية'),
    devis: tr('Devis validé AG', 'عرض سعر مصادق عليه بالجمع العام'),
    autre: tr('Autre pièce', 'وثيقة أخرى'),
  };
}
