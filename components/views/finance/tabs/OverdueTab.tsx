import React from 'react';
import type { Building, Charge, Quittance, Syndic } from '../../../../types';
import Card from '../../../common/Card';
import Button from '../../../common/Button';
import InfoTip from '../../../common/InfoTip';
import { DocumentsIcon, ShieldAlertIcon } from '../../../icons/IconComponents';
import {
  exportMiseEnDemeurePDF,
  exportResidentStatementPDF,
} from '../../../../services/pdfOnDemand';
import { useI18n } from '../../../../hooks/useI18n';
import { useToast } from '../../../common/Toast';
import { currencyFormatter } from '../financeConstants';
import type { AgingBuckets, OverdueResidentGroup } from '../financeSelectors';

interface OverdueTabProps {
  building: Building;
  syndic?: Syndic;
  charges: Charge[];
  quittances: Quittance[];
  overdueResidents: OverdueResidentGroup[];
  overdueChargesTotal: number;
  agingBuckets: AgingBuckets;
}

const OverdueTab: React.FC<OverdueTabProps> = ({
  building,
  syndic,
  charges,
  quittances,
  overdueResidents,
  overdueChargesTotal,
  agingBuckets,
}) => {
  const { tr, isAr } = useI18n();
  const { showToast } = useToast();

  return (
    <div className="space-y-4">
      {/* Balance Âgée (Aging Report) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-3.5 border-s-4 border-s-amber-400 bg-white">
          <span className="text-[11px] font-semibold text-slate-500 uppercase block">
            {tr('Retard 0 – 30 jours', 'تأخر 0 – 30 يوماً')}
          </span>
          <span className="text-lg font-bold font-mono text-amber-800 mt-1 block tabular-nums">
            {currencyFormatter.format(agingBuckets.d0_30)}
          </span>
        </Card>
        <Card className="p-3.5 border-s-4 border-s-orange-500 bg-white">
          <span className="text-[11px] font-semibold text-slate-500 uppercase block">
            {tr('Retard 31 – 60 jours', 'تأخر 31 – 60 يوماً')}
          </span>
          <span className="text-lg font-bold font-mono text-orange-800 mt-1 block tabular-nums">
            {currencyFormatter.format(agingBuckets.d31_60)}
          </span>
        </Card>
        <Card className="p-3.5 border-s-4 border-s-rose-500 bg-white">
          <span className="text-[11px] font-semibold text-slate-500 uppercase block">
            {tr('Retard 61 – 90 jours', 'تأخر 61 – 90 يوماً')}
          </span>
          <span className="text-lg font-bold font-mono text-rose-700 mt-1 block tabular-nums">
            {currencyFormatter.format(agingBuckets.d61_90)}
          </span>
        </Card>
        <Card className="p-3.5 border-s-4 border-s-red-800 bg-white">
          <span className="text-[11px] font-semibold text-slate-500 uppercase block">
            {tr('Plus de 90 jours', 'أكثر من 90 يوماً')}
          </span>
          <span className="text-lg font-bold font-mono text-red-900 mt-1 block tabular-nums">
            {currencyFormatter.format(agingBuckets.d90_plus)}
          </span>
        </Card>
      </div>

      <Card className="overflow-hidden border border-slate-200">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-3">
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-slate-800 text-sm">
                {tr('Copropriétaires en retard', 'الملاك المشتركون المتأخرون عن الأداء')}
              </h3>
              <InfoTip label={tr('Procédure légale en cas de retard', 'المسطرة القانونية في حالة التأخر')}>
                {tr(
                  "Article 25 de la Loi n° 18-00 : en cas de non-paiement, le syndic peut envoyer une mise en demeure par courrier recommandé avec accusé de réception (délai de 30 jours), puis demander une ordonnance d'injonction de payer au Tribunal de Première Instance.",
                  'المادة 25 من القانون 18-00: في حالة عدم الأداء، يوجه السنديك إنذاراً مضموناً مع إشعار بالتوصل يمنح أجلاً مدته 30 يوماً، ثم يمكنه طلب أمر بالأداء من المحكمة الابتدائية.',
                )}
              </InfoTip>
            </div>
            <p className="text-xs text-slate-500">
              {tr(
                'Téléchargez un relevé de compte à envoyer en rappel ou une mise en demeure officielle.',
                'حمّل كشف حساب للتذكير أو إنذاراً رسمياً بالأداء.',
              )}
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-rose-700 bg-rose-50 px-2.5 py-1 rounded">
            {tr('Total en retard :', 'مجموع المتأخرات:')} {currencyFormatter.format(overdueChargesTotal)}
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {overdueResidents.map((item) => {
            const resident = building.residents.find((r) => r.id === item.residentId);
            const residentApartments =
              item.apartments.length > 0
                ? item.apartments
                : building.apartments.filter(
                    (a) =>
                      a.ownerId === item.residentId ||
                      a.tenantId === item.residentId ||
                      a.id === resident?.apartmentId,
                  );

            return (
              <div
                key={item.residentId}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{item.residentName}</span>
                    <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                      {item.apartments.length > 1 ? tr('Lots', 'شقق') : tr('Lot', 'شقة')} {item.apartmentNumber}
                    </span>
                    <span className="text-xs text-rose-700 font-semibold bg-rose-50 px-2 py-0.5 rounded">
                      {item.overdueCount} {tr('échéance(s) en retard', 'دفعات متأخرة')}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {tr('Depuis le', 'منذ')}{' '}
                    {new Date(item.oldestDate).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')} ·{' '}
                    {tr('Tél :', 'الهاتف:')} {resident?.phone || tr('Non renseigné', 'غير متوفر')}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <div className="text-end me-1">
                    <span className="text-xs text-slate-400 block">{tr('Reste dû', 'المبلغ المستحق')}</span>
                    <span className="font-mono font-bold text-base text-rose-700">
                      {currencyFormatter.format(item.totalOverdue)}
                    </span>
                  </div>

                  {resident && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        exportResidentStatementPDF(
                          building,
                          syndic,
                          resident,
                          residentApartments,
                          charges,
                          quittances,
                        )
                      }
                      className="text-xs flex items-center gap-1"
                    >
                      <DocumentsIcon />
                      <span>{tr('Relevé PDF', 'كشف PDF')}</span>
                    </Button>
                  )}

                  <Button
                    onClick={() => {
                      if (resident && residentApartments.length > 0) {
                        exportMiseEnDemeurePDF(
                          building,
                          syndic,
                          resident,
                          residentApartments,
                          item.charges,
                        );
                      } else {
                        showToast(tr('Informations du copropriétaire incomplètes.', 'بيانات المالك المشترك غير مكتملة.'), 'error');
                      }
                    }}
                    className="text-xs bg-rose-700 hover:bg-rose-800 flex items-center gap-1.5"
                  >
                    <ShieldAlertIcon />
                    <span>{tr('Mise en demeure PDF', 'إنذار بالأداء PDF')}</span>
                  </Button>
                </div>
              </div>
            );
          })}

          {overdueResidents.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-xs space-y-1">
              <p className="font-semibold text-sm text-slate-700">
                {tr('Aucun copropriétaire en retard', 'لا يوجد أي مالك مشترك متأخر')}
              </p>
              <p>
                {tr(
                  'Tous les copropriétaires sont à jour dans leurs paiements.',
                  'جميع الملاك المشتركين في وضعية سليمة.',
                )}
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default OverdueTab;
