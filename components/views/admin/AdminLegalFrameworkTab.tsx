import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Card from '../../common/Card';
import Button from '../../common/Button';
import { useI18n } from '../../../hooks/useI18n';
import { useToast } from '../../common/Toast';
import {
  updateAdminLegalFramework,
  useLegalFramework,
} from '../../../hooks/useLegalFramework';
import {
  DEFAULT_LEGAL_FRAMEWORK,
  type LegalFrameworkCitations,
  type LegalFrameworkRules,
} from '../../../shared/legalFramework';

const AdminLegalFrameworkTab: React.FC = () => {
  const { tr } = useI18n();
  const { showToast, confirmAction } = useToast();
  const queryClient = useQueryClient();
  const { legal, isCustomized } = useLegalFramework();

  const [effectiveDate, setEffectiveDate] = useState(legal.effectiveDate || '');
  const [citations, setCitations] = useState<LegalFrameworkCitations>(legal.citations);
  const [rules, setRules] = useState<LegalFrameworkRules>(legal.rules);

  useEffect(() => {
    setEffectiveDate(legal.effectiveDate || '');
    setCitations(legal.citations);
    setRules(legal.rules);
  }, [legal]);

  const saveMutation = useMutation({
    mutationFn: updateAdminLegalFramework,
    onSuccess: async (res) => {
      queryClient.setQueryData(['legalFramework'], res);
      await queryClient.invalidateQueries({ queryKey: ['legalFramework'] });
      showToast(
        res.isCustomized
          ? tr(
              'Cadre légal mis à jour pour toute la plateforme.',
              'تم تحديث الإطار القانوني على مستوى المنصة بالكامل.',
            )
          : tr(
              'Valeurs réglementaires par défaut rétablies.',
              'تمت استعادة القيم التنظيمية الافتراضية.',
            ),
        'success',
      );
    },
    onError: (err: Error) => showToast(err.message, 'error'),
  });

  const setCitation = <K extends keyof LegalFrameworkCitations>(key: K, value: string) => {
    setCitations((prev) => ({ ...prev, [key]: value }));
  };

  const setRule = <K extends keyof LegalFrameworkRules>(key: K, value: number) => {
    setRules((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6">
      <Card className="p-5 border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-slate-900">
                {tr(
                  'Cadre Légal & Seuils Réglementaires (Copropriété)',
                  'الإطار القانوني والعتبات التنظيمية (الملكية المشتركة)',
                )}
              </h2>
              <span
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                  isCustomized
                    ? 'bg-amber-100 text-amber-900 border border-amber-200'
                    : 'bg-teal-50 text-teal-800 border border-teal-200'
                }`}
              >
                {isCustomized
                  ? tr('Personnalisé par Super-Admin', 'مخصص من طرف الإدارة')
                  : tr('Valeurs standards actives', 'القيم القياسية مفعلة')}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
              {tr(
                "Adaptez les références de loi, articles et délais légaux sans redéployer l'application. Les reçus (quittances), PV d'assemblée déjà émis et taux de fonds de réserve des immeubles existants restent strictement inchangés (application prospective).",
                'عدّل مراجع القوانين والمواد والآجال القانونية دون إعادة نشر التطبيق. تظل الوصولات ومحاضر الجموع الصادرة سابقاً ونسب صندوق الاحتياط للعمارات القائمة محفوظة دون أي تعديل بأثر رجعي.',
              )}
            </p>
          </div>

          {isCustomized && (
            <Button
              type="button"
              variant="secondary"
              disabled={saveMutation.isPending}
              onClick={async () => {
                const ok = await confirmAction({
                  title: tr('Rétablir le cadre légal par défaut', 'استعادة الإطار القانوني الافتراضي'),
                  message: tr(
                    'Voulez-vous rétablir toutes les références et seuils réglementaires par défaut ?',
                    'هل تريد استعادة جميع المراجع والعتبات القانونية الافتراضية؟',
                  ),
                  confirmLabel: tr('Rétablir par défaut', 'استعادة الافتراضي'),
                });
                if (!ok) return;
                setCitations(DEFAULT_LEGAL_FRAMEWORK.citations);
                setRules(DEFAULT_LEGAL_FRAMEWORK.rules);
                setEffectiveDate('');
                await saveMutation.mutateAsync({ resetToDefaults: true });
              }}
              className="text-xs shrink-0"
            >
              {tr('Rétablir les valeurs par défaut', 'استعادة القيم الافتراضية')}
            </Button>
          )}
        </div>
      </Card>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await saveMutation.mutateAsync({
            effectiveDate: effectiveDate.trim() || undefined,
            citations,
            rules,
          });
        }}
        className="space-y-6"
      >
        {/* Numeric Statutory Thresholds */}
        <Card className="p-5 border border-slate-200 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">
            {tr('1. Seuils & délais réglementaires', '1. النسب والآجال القانونية')}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
            <div>
              <label htmlFor="legal-rule-reserve" className="block font-semibold text-slate-700 mb-1">
                {tr('Fonds de réserve par défaut (%)', 'نسبة الاحتياط الافتراضية (%)')}
              </label>
              <input
                id="legal-rule-reserve"
                type="number"
                min={0}
                max={50}
                step="0.5"
                value={rules.defaultReserveFundPercent}
                onChange={(e) => setRule('defaultReserveFundPercent', Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white"
                required
              />
              <span className="text-[11px] text-slate-400 block mt-1">
                {tr('Nouveaux immeubles uniquement', 'للعمارات الجديدة فقط')}
              </span>
            </div>

            <div>
              <label htmlFor="legal-rule-max-proxies" className="block font-semibold text-slate-700 mb-1">
                {tr('Procurations max / mandataire', 'الحد الأقصى للوكالات / وكيل')}
              </label>
              <input
                id="legal-rule-max-proxies"
                type="number"
                min={1}
                max={20}
                step={1}
                value={rules.maxProxiesPerHolder}
                onChange={(e) => setRule('maxProxiesPerHolder', Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-rule-proxy-share" className="block font-semibold text-slate-700 mb-1">
                {tr('Plafond voix mandataire (%)', 'سقف أصوات الوكيل (%)')}
              </label>
              <input
                id="legal-rule-proxy-share"
                type="number"
                min={1}
                max={100}
                step="0.5"
                value={rules.maxProxyTantiemesSharePercent}
                onChange={(e) => setRule('maxProxyTantiemesSharePercent', Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-rule-convocation-days" className="block font-semibold text-slate-700 mb-1">
                {tr('Préavis convocation AG (jours)', 'أجل استدعاء الجمع العام (أيام)')}
              </label>
              <input
                id="legal-rule-convocation-days"
                type="number"
                min={1}
                max={90}
                step={1}
                value={rules.convocationNoticeDays}
                onChange={(e) => setRule('convocationNoticeDays', Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-rule-med-days" className="block font-semibold text-slate-700 mb-1">
                {tr('Délai mise en demeure (jours)', 'أجل الإنذار بالأداء (أيام)')}
              </label>
              <input
                id="legal-rule-med-days"
                type="number"
                min={1}
                max={180}
                step={1}
                value={rules.miseEnDemeureNoticeDays}
                onChange={(e) => setRule('miseEnDemeureNoticeDays', Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white"
                required
              />
            </div>
          </div>
        </Card>

        {/* Official Citations */}
        <Card className="p-5 border border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-slate-900">
              {tr(
                '2. Références légales imprimées sur les documents PDF & infobulles',
                '2. المراجع القانونية المطبوعة في الوثائق الرسمية PDF والتلميحات',
              )}
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="legal-effective-date" className="text-slate-600 font-medium">
                {tr("Date d'entrée en vigueur :", 'تاريخ السريان:')}
              </label>
              <input
                id="legal-effective-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="px-2.5 py-1 border border-slate-300 rounded-lg font-mono text-xs bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label htmlFor="legal-short-fr" className="block font-semibold text-slate-700 mb-1">
                {tr('Référence courte (FR)', 'المرجع المختصر (FR)')}
              </label>
              <input
                id="legal-short-fr"
                type="text"
                value={citations.statuteShortFr}
                onChange={(e) => setCitation('statuteShortFr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-short-ar" className="block font-semibold text-slate-700 mb-1">
                {tr('Référence courte (AR)', 'المرجع المختصر (AR)')}
              </label>
              <input
                id="legal-short-ar"
                type="text"
                dir="rtl"
                value={citations.statuteShortAr}
                onChange={(e) => setCitation('statuteShortAr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="legal-full-fr" className="block font-semibold text-slate-700 mb-1">
                {tr('Intitulé officiel complet sur PDF (FR)', 'العنوان القانوني الكامل في وثائق PDF (FR)')}
              </label>
              <input
                id="legal-full-fr"
                type="text"
                value={citations.statuteFullTitleFr}
                onChange={(e) => setCitation('statuteFullTitleFr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="legal-full-ar" className="block font-semibold text-slate-700 mb-1">
                {tr('Intitulé officiel complet sur PDF (AR)', 'العنوان القانوني الكامل في وثائق PDF (AR)')}
              </label>
              <input
                id="legal-full-ar"
                type="text"
                dir="rtl"
                value={citations.statuteFullTitleAr}
                onChange={(e) => setCitation('statuteFullTitleAr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-reserve-fr" className="block font-semibold text-slate-700 mb-1">
                {tr('Réf. Fonds de réserve (FR)', 'مرجع صندوق الاحتياط (FR)')}
              </label>
              <input
                id="legal-reserve-fr"
                type="text"
                value={citations.reserveFundRefFr}
                onChange={(e) => setCitation('reserveFundRefFr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-reserve-ar" className="block font-semibold text-slate-700 mb-1">
                {tr('Réf. Fonds de réserve (AR)', 'مرجع صندوق الاحتياط (AR)')}
              </label>
              <input
                id="legal-reserve-ar"
                type="text"
                dir="rtl"
                value={citations.reserveFundRefAr}
                onChange={(e) => setCitation('reserveFundRefAr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-accounting-fr" className="block font-semibold text-slate-700 mb-1">
                {tr('Réf. Comptabilité & justificatifs (FR)', 'مرجع المحاسبة والوثائق المثبتة (FR)')}
              </label>
              <input
                id="legal-accounting-fr"
                type="text"
                value={citations.accountingRefFr}
                onChange={(e) => setCitation('accountingRefFr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-proxy-fr" className="block font-semibold text-slate-700 mb-1">
                {tr('Réf. Procurations AG (FR)', 'مرجع وكالات الجمع العام (FR)')}
              </label>
              <input
                id="legal-proxy-fr"
                type="text"
                value={citations.agProxyRefFr}
                onChange={(e) => setCitation('agProxyRefFr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-med-fr" className="block font-semibold text-slate-700 mb-1">
                {tr('Réf. Recouvrement / Mise en demeure (FR)', 'مرجع التحصيل والإنذار بالأداء (FR)')}
              </label>
              <input
                id="legal-med-fr"
                type="text"
                value={citations.collectionNoticeRefFr}
                onChange={(e) => setCitation('collectionNoticeRefFr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                required
              />
            </div>

            <div>
              <label htmlFor="legal-stamp-fr" className="block font-semibold text-slate-700 mb-1">
                {tr('Mention cachet quittance (FR)', 'عبارة ختم الوصل (FR)')}
              </label>
              <input
                id="legal-stamp-fr"
                type="text"
                maxLength={40}
                value={citations.stampCodeFr}
                onChange={(e) => setCitation('stampCodeFr', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono bg-white"
                required
              />
            </div>
          </div>

          {/* Live Preview */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 block">
              {tr('Aperçu en direct (documents officiels & règles AG)', 'معاينة فورية (الوثائق الرسمية وقواعد الجمع العام)')}
            </span>
            <p className="text-slate-800 font-medium">
              • {tr('En-tête Quittance PDF :', 'ترويسة وصل الأداء:')} « En vertu de la {citations.statuteFullTitleFr} »
            </p>
            <p className="text-slate-700">
              • {tr('Règle procurations AG :', 'قاعدة وكالات الجمع العام:')} « {citations.agProxyRefFr} — max. {rules.maxProxiesPerHolder} procuration(s) et {rules.maxProxyTantiemesSharePercent}% des voix »
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={saveMutation.isPending}
              className="bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold"
            >
              {saveMutation.isPending
                ? tr('Enregistrement...', 'جاري الحفظ...')
                : tr('Enregistrer le cadre légal', 'حفظ الإطار القانوني')}
            </Button>
          </div>
        </Card>
      </form>
    </div>
  );
};

export default AdminLegalFrameworkTab;
