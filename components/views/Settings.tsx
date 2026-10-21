import Form from '../common/Form';
import React, { useState, useEffect } from 'react';
import type { Syndic } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import { useI18n } from '../../hooks/useI18n';
import { useToast } from '../common/Toast';

interface SettingsProps {
  syndic: Syndic;
  onUpdate: (updatedSyndic: Syndic) => Promise<unknown> | void;
}

const Settings: React.FC<SettingsProps> = ({ syndic, onUpdate }) => {
  const { t, tr } = useI18n();
  const { showToast } = useToast();
  const [name, setName] = useState(syndic.name ?? '');
  const [logoUrl, setLogoUrl] = useState(syndic.logoUrl ?? '');
  const [ice, setIce] = useState(syndic.ice ?? '');
  const [taxId, setTaxId] = useState(syndic.taxId ?? '');
  const [rc, setRc] = useState(syndic.rc ?? '');
  const [patente, setPatente] = useState(syndic.patente ?? '');

  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    setName(syndic.name ?? '');
    setLogoUrl(syndic.logoUrl ?? '');
    setIce(syndic.ice ?? '');
    setTaxId(syndic.taxId ?? '');
    setRc(syndic.rc ?? '');
    setPatente(syndic.patente ?? '');
  }, [syndic]);

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

    setIsLoading(true);
    try {
      await Promise.resolve(
        onUpdate({
          ...syndic,
          name: safeName,
          logoUrl: safeLogoUrl || (syndic.logoUrl ?? ''),
          ice: safeIce,
          taxId: safeTaxId,
          rc: safeRc,
          patente: safePatente,
        })
      );
      setMessage({ type: 'success', text: t('settings.success') });
      showToast(t('settings.success'), 'success');
    } catch (err: unknown) {
      const errorText =
        err instanceof Error
          ? err.message
          : tr(
              "Échec de l'enregistrement des paramètres du cabinet.",
              'فشل حفظ إعدادات مكتب السنديك.'
            );
      setMessage({ type: 'error', text: errorText });
      showToast(errorText, 'error');
    } finally {
      setIsLoading(false);
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
                onChange={(e) => setName(e.target.value)}
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
                onChange={(e) => setLogoUrl(e.target.value)}
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
                  onChange={(e) => setIce(e.target.value)}
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
                  onChange={(e) => setRc(e.target.value)}
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
                  onChange={(e) => setTaxId(e.target.value)}
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
                  onChange={(e) => setPatente(e.target.value)}
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

export default Settings;
