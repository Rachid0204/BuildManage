import Form from '../common/Form';
import React, { useState, useEffect, useReducer, useRef } from 'react';
import type { Syndic } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import { useI18n } from '../../hooks/useI18n';
import { useToast } from '../common/Toast';
import { SETTINGS_FIELDS, settingsValues, createSettingsDraft, settingsDraftReducer, type SettingsField } from './settingsDraft';

interface SettingsProps {
  syndic: Syndic;
  onUpdate: (updatedSyndic: Syndic) => Promise<unknown> | void;
}

const SettingsForm: React.FC<SettingsProps> = ({ syndic, onUpdate }) => {
  const { t, tr } = useI18n();
  const { showToast } = useToast();
  const [draft, dispatch] = useReducer(settingsDraftReducer, syndic, createSettingsDraft);
  const { name, logoUrl, ice, taxId, rc, patente } = draft.values;
  const remote = settingsValues(syndic);
  const isLoading = !!draft.pending;
  const dirty = SETTINGS_FIELDS.some(field => draft.values[field] !== draft.remote[field]);
  const mounted = useRef(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Only Settings scalars trigger hydration. Unrelated SSE object replacements do not.
  useEffect(() => { dispatch({ type: 'remote', values: remote }); },
    [remote.name, remote.logoUrl, remote.ice, remote.taxId, remote.rc, remote.patente]);
  const edit = (field: SettingsField, value: string) => dispatch({ type: 'edit', field, value });
  const labels = { name: t('settings.companyName'), logoUrl: t('settings.logoUrl'), ice: t('settings.ice'),
    taxId: t('settings.taxId'), rc: t('settings.rc'), patente: t('settings.patente') };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setMessage(null);

    const safeName = (name ?? '').trim();
    const safeLogoUrl = (logoUrl ?? '').trim();
    const safeIce = (ice ?? '').trim();
    const safeTaxId = (taxId ?? '').trim();
    const safeRc = (rc ?? '').trim();
    const safePatente = (patente ?? '').trim();

    if (!safeName) {
      throw new Error(t('settings.validation.nameRequired'));
    }

    if (safeIce && !/^\d{15}$/.test(safeIce)) {
      throw new Error(tr("L'identifiant Commun de l'Entreprise (ICE) doit comporter exactement 15 chiffres.", 'يجب أن يتكون التعريف الموحد للمقاولة (ICE) من 15 رقماً بالضبط.'));
    }

    const submitted = { name: safeName, logoUrl: safeLogoUrl || (syndic.logoUrl ?? ''),
      ice: safeIce, taxId: safeTaxId, rc: safeRc, patente: safePatente };
    const updated = { ...syndic, ...submitted };
    dispatch({ type: 'saveStarted', values: submitted });
    try {
      const saved = await Promise.resolve(onUpdate(updated));
      if (!mounted.current) return;
      const accepted = saved && typeof saved === 'object' && (saved as Partial<Syndic>).id === syndic.id
        ? { ...updated, ...(saved as Partial<Syndic>) } : updated;
      dispatch({ type: 'saved', values: settingsValues(accepted) });
      setMessage({ type: 'success', text: t('settings.success') });
      showToast(t('settings.success'), 'success');
    } catch (err: unknown) {
      if (!mounted.current) return;
      dispatch({ type: 'saveFailed' });
      const errorText =
        err instanceof Error
          ? err.message
          : tr(
              "Échec de l'enregistrement des paramètres du cabinet.",
              'فشل حفظ إعدادات مكتب السنديك.'
            );
      setMessage({ type: 'error', text: errorText });
      showToast(errorText, 'error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('settings.title')}</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          {tr(
            'Identité légale et fiscale figurant sur les quittances, appels de fonds et procès-verbaux (Loi 18-00)',
            'الهوية القانونية والضريبية التي تظهر على وصولات الأداء، طلبات المساهمات ومحاضر الجموع العامة (قانون 18-00)'
          )}
        </p>
      </div>

      <Card className="border border-slate-200">
        <h2 className="text-base font-bold text-slate-900 mb-4 border-b border-slate-200 pb-3">
          {t('settings.profile')}
        </h2>

        <Form onSubmit={handleSubmit} className="space-y-6">
          {dirty && <p className="text-sm text-amber-800">{tr('Modifications non enregistrées', 'تعديلات غير محفوظة')}</p>}
          {draft.conflicts.length > 0 && (
            <div role="status" aria-live="polite" className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2 text-sm text-amber-950">
              <p>{tr('Des champs modifiés localement ont aussi changé à distance. Votre saisie est conservée. Enregistrer appliquera votre saisie.', 'تغيّرت بعض الحقول التي عدلتها أيضاً عن بُعد. تم الاحتفاظ بتعديلاتك. سيطبّق الحفظ تعديلاتك.')}</p>
              {draft.conflicts.map(field => <div key={field} className="flex flex-wrap items-center gap-2">
                <span className="break-all">{labels[field]} : {draft.remote[field] || tr('(vide)', '(فارغ)')}</span>
                <button type="button" className="underline font-semibold" onClick={() => dispatch({ type: 'useRemote', field })}
                  aria-label={`${tr('Utiliser la valeur distante', 'استخدام القيمة المحفوظة')} — ${labels[field]}`}>
                  {tr('Utiliser la valeur distante', 'استخدام القيمة المحفوظة')}
                </button>
                <button type="button" className="underline font-semibold" onClick={() => dispatch({ type: 'keepLocal', field })}
                  aria-label={`${tr('Conserver ma version', 'الاحتفاظ بتعديلي')} — ${labels[field]}`}>
                  {tr('Conserver ma version', 'الاحتفاظ بتعديلي')}
                </button>
              </div>)}
            </div>
          )}
          {message && (
            <div
              className={`p-3.5 rounded-lg text-xs font-semibold border ${
                message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border-rose-200'
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label htmlFor="companyName" className="block text-xs font-bold text-slate-700 mb-1">
                {t('settings.companyName')}
              </label>
              <input
                type="text"
                id="companyName"
                value={name}
                onChange={(e) => edit('name', e.target.value)}
                placeholder={t('settings.companyNamePlaceholder')}
                className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label htmlFor="logoUrl" className="block text-xs font-bold text-slate-700 mb-1">
                {t('settings.logoUrl')}
              </label>
              <input
                type="text"
                id="logoUrl"
                value={logoUrl}
                onChange={(e) => edit('logoUrl', e.target.value)}
                placeholder={t('settings.logoUrlPlaceholder')}
                className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              {logoUrl && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-slate-500">{tr('Aperçu :', 'معاينة :')}</span>
                  <img
                    src={logoUrl}
                    alt="Logo Preview"
                    className="h-10 object-contain border border-slate-200 rounded p-1 bg-white"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-5">
            <h3 className="text-sm font-bold text-slate-900 mb-4">{t('settings.legal')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label htmlFor="ice" className="block text-xs font-bold text-slate-700 mb-1">
                  {t('settings.ice')}
                </label>
                <input
                  type="text"
                  id="ice"
                  maxLength={15}
                  value={ice}
                  onChange={(e) => edit('ice', e.target.value)}
                  placeholder="001234567000089 (15 chiffres)"
                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label htmlFor="rc" className="block text-xs font-bold text-slate-700 mb-1">
                  {t('settings.rc')}
                </label>
                <input
                  type="text"
                  id="rc"
                  value={rc}
                  onChange={(e) => edit('rc', e.target.value)}
                  placeholder="Ex: 145890 - Casablanca"
                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label htmlFor="taxId" className="block text-xs font-bold text-slate-700 mb-1">
                  {t('settings.taxId')}
                </label>
                <input
                  type="text"
                  id="taxId"
                  value={taxId}
                  onChange={(e) => edit('taxId', e.target.value)}
                  placeholder="Ex: 45891230"
                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label htmlFor="patente" className="block text-xs font-bold text-slate-700 mb-1">
                  {t('settings.patente')}
                </label>
                <input
                  type="text"
                  id="patente"
                  value={patente}
                  onChange={(e) => edit('patente', e.target.value)}
                  placeholder="Ex: 34291021"
                  className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? tr('Enregistrement...', 'جاري الحفظ...') : t('settings.save')}
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
};

const Settings: React.FC<SettingsProps> = props => <SettingsForm key={props.syndic.id} {...props} />;
export default Settings;
