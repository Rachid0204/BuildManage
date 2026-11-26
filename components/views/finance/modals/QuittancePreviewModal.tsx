import React from 'react';
import type { Building, Quittance, Syndic } from '../../../../types';
import Button from '../../../common/Button';
import Modal from '../../../common/Modal';
import { QuittanceIcon } from '../../../icons/IconComponents';
import { generateQuittancePDF } from '../../../../services/pdfOnDemand';
import { useI18n } from '../../../../hooks/useI18n';
import { currencyFormatter, formatRecordedFund } from '../financeConstants';

interface QuittancePreviewModalProps {
  building: Building;
  syndic?: Syndic;
  quittance: Quittance | null;
  onClose: () => void;
}

const QuittancePreviewModal: React.FC<QuittancePreviewModalProps> = ({
  building,
  syndic,
  quittance,
  onClose,
}) => {
  const { tr, isAr } = useI18n();
  if (!quittance) return null;

  const buildingTantiemesBase = building.totalTantiemes || 1000;

  return (
    <Modal
      isOpen={!!quittance}
      onClose={onClose}
      title={tr(
        `Attestation Officielle — ${quittance.quittanceNumber}`,
        `شهادة إبراء رسمية — ${quittance.quittanceNumber}`,
      )}
      footer={
        <div className="flex justify-between items-center w-full">
          <span className="text-xs text-slate-500 font-mono">
            {tr('Conforme Loi 18-00 · Délivré par le Syndic', 'مطابق للقانون 18-00 · مسلم من طرف السنديك')}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {tr('Fermer', 'إغلاق')}
            </Button>
            <Button
              onClick={() => {
                const apt = building.apartments.find((a) => a.id === quittance.apartmentId);
                const res = building.residents.find((r) => r.id === quittance.residentId);
                generateQuittancePDF(quittance, building, syndic, apt, res);
              }}
              className="bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
            >
              <QuittanceIcon />
              <span>{tr('Télécharger le PDF Réglementaire', 'تحميل الوصل الرسمي PDF')}</span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="p-6 bg-slate-50 border-2 border-teal-800/40 rounded-xl space-y-5 text-slate-800 shadow-inner">
        {quittance.voidedAt && (
          <div className="p-3 rounded-lg bg-rose-100 border-2 border-rose-500 text-rose-900 text-center space-y-1">
            <p className="text-sm font-extrabold tracking-widest uppercase">
              {tr('QUITTANCE ANNULÉE — SANS VALEUR LIBÉRATOIRE', 'وصل ملغى — لا يُعتد به لإبراء الذمة')}
            </p>
            <p className="text-xs">
              {tr('Annulée le', 'أُلغي في')}{' '}
              {new Date(quittance.voidedAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
              {quittance.voidReason ? ` · ${quittance.voidReason}` : ''}
            </p>
          </div>
        )}
        <div className="text-center pb-4 border-b-2 border-teal-800/20">
          <p className="text-[11px] font-bold tracking-widest text-teal-900 uppercase">
            {tr('ROYAUME DU MAROC  ·  SYNDICAT DES COPROPRIÉTAIRES', 'المملكة المغربية  ·  اتحاد الملاك المشتركين')}
          </p>
          <h3 className="text-base font-extrabold text-teal-950 mt-1 uppercase tracking-tight">
            {tr('Quittance de Paiement des Charges de Copropriété', 'وصل أداء مساهمات الملكية المشتركة')}
          </h3>
          <p className="text-[10px] text-slate-500 mt-0.5">
            {tr(
              'En vertu de la Loi n° 18-00 relative au statut de la copropriété des immeubles bâtis (modifiée par la Loi n° 106-12)',
              'بموجب القانون رقم 18-00 المتعلق بنظام الملكية المشتركة للعقارات المبنية (المعدل بالقانون رقم 106-12)',
            )}
          </p>
          <div className="inline-block bg-teal-100/70 border border-teal-300 text-teal-900 font-mono text-xs px-3 py-0.5 rounded font-bold mt-2">
            {tr('Réf:', 'المرجع:')} {quittance.quittanceNumber} · {tr('Émise le', 'صادر في')}{' '}
            {new Date(quittance.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
            <span className="font-bold text-teal-800 block text-[11px] uppercase">
              {tr('Copropriété & Syndic', 'الملكية المشتركة والسنديك')}
            </span>
            <p className="font-bold text-slate-900">{building.name}</p>
            <p className="text-slate-600">{building.address}, {building.city}</p>
            <p className="text-slate-500 font-mono text-[11px]">
              {tr('Syndic:', 'السنديك:')} {syndic?.name || quittance.syndicName}
            </p>
            <p className="text-slate-400 font-mono text-[10px]">
              RIB: {building.bankRib || tr('Non renseigné', 'غير مسجل')}
            </p>
          </div>

          <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
            <span className="font-bold text-teal-800 block text-[11px] uppercase">
              {tr('Copropriétaire & Lot', 'المالك المشترك والوحدة')}
            </span>
            <p className="font-bold text-slate-900">{quittance.residentName}</p>
            <p className="text-slate-600 font-mono">
              {tr('Lot', 'شقة')} {quittance.apartmentNumber} · {quittance.tantiemes} / {buildingTantiemesBase}
            </p>
            <p className="text-slate-500 font-mono text-[11px]">
              CIN: {quittance.residentCin || tr('Non renseigné', 'غير محدد')}
            </p>
            <p className="text-slate-500 text-[11px]">{tr('Usage : Résidentiel', 'الاستعمال: سكني')}</p>
          </div>
        </div>

        <div className="bg-white rounded border border-slate-200 overflow-hidden text-xs">
          <div className="bg-teal-900 text-white p-2 font-bold flex justify-between">
            <span>{tr('Désignation des charges (Loi 18-00 & 106-12)', 'بيان التكاليف والمساهمات (القانون 18-00 و 106-12)')}</span>
            <span>{tr('Montant Réglé', 'المبلغ المؤدى')}</span>
          </div>
          <div className="p-3 space-y-2">
            <div className="flex justify-between items-center text-slate-700">
              <span>{tr('1. Charges générales ordinaires', '1. التكاليف العامة الجارية')} ({quittance.periodCovered})</span>
              <span className="font-mono font-medium">
                {formatRecordedFund(quittance, 'chargesCourantesAmount', tr)}
              </span>
            </div>
            <div className="flex justify-between items-center text-emerald-800">
              <span>{tr('2. Provision obligatoire Fonds de Réserve (Loi 106-12 Art. 18 bis)', '2. مساهمة صندوق الاحتياط الإلزامي (القانون 106-12)')}</span>
              <span className="font-mono font-semibold">
                {formatRecordedFund(quittance, 'reserveFundAmount', tr)}
              </span>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-slate-900 text-sm">
              <span>{tr('TOTAL REÇU ET QUITTANCÉ :', 'المجموع المستلم والمبرأ عنه:')}</span>
              <span className="font-mono text-teal-900 text-base">
                {currencyFormatter.format(quittance.amount)}
              </span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-600 italic bg-amber-50/70 p-2.5 rounded border border-amber-200">
          {tr(
            '« Le Syndic soussigné donne quittance libératoire au copropriétaire pour ladite période. Cette attestation justifie de la régularité des cotisations au regard du Syndicat des Copropriétaires. »',
            '« يمنح وكيل الاتحاد (السنديك) الموقع أسفله إبراءً تاماً للمالك المشترك عن الفترة المذكورة. وتشهد هذه الوثيقة على انتظام أداء المساهمات تجاه اتحاد الملاك المشتركين. »',
          )}
        </p>

        <div className="flex justify-between items-end pt-2">
          <div className="text-[10px] text-slate-400 font-mono">
            <div>Hash : {quittance.id}</div>
            <div>
              {tr('Fait à', 'حرر بـ')} {building.city}, {tr('le', 'في')} {new Date().toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
            </div>
          </div>

          <div className="w-24 h-24 rounded-full border-2 border-dashed border-teal-700 flex flex-col items-center justify-center text-teal-800 font-mono text-[8px] text-center p-1 bg-teal-50/40">
            <span className="font-bold text-[7px]">SYNDICAT COPRO</span>
            <span className="font-extrabold text-[9px] text-teal-900">{tr('CERTIFIÉ', 'معتمد')}</span>
            <span className="font-bold text-[8px]">{tr('CONFORME', 'مطابق')}</span>
            <span className="text-[6px]">LOI 18-00</span>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default QuittancePreviewModal;
