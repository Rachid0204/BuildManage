import React, { useState, useEffect } from 'react';
import type { Syndic } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import { useI18n } from '../../hooks/useI18n';

interface SettingsProps {
    syndic: Syndic;
    onUpdate: (updatedSyndic: Syndic) => void;
}

const Settings: React.FC<SettingsProps> = ({ syndic, onUpdate }) => {
    const { t, tr } = useI18n();
    const [name, setName] = useState(syndic.name);
    const [logoUrl, setLogoUrl] = useState(syndic.logoUrl);
    const [ice, setIce] = useState(syndic.ice || '');
    const [taxId, setTaxId] = useState(syndic.taxId || '');
    const [rc, setRc] = useState(syndic.rc || '');
    const [patente, setPatente] = useState(syndic.patente || '');
    
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        setName(syndic.name);
        setLogoUrl(syndic.logoUrl);
        setIce(syndic.ice || '');
        setTaxId(syndic.taxId || '');
        setRc(syndic.rc || '');
        setPatente(syndic.patente || '');
    }, [syndic]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);

        if (!name.trim()) {
            setMessage({ type: 'error', text: t('settings.validation.nameRequired') });
            return;
        }

        setIsLoading(true);
        
        setTimeout(() => {
            onUpdate({
                ...syndic,
                name,
                logoUrl,
                ice,
                taxId,
                rc,
                patente
            });
            setIsLoading(false);
            setMessage({ type: 'success', text: t('settings.success') });
        }, 800);
    };

    return (
        <div className="max-w-4xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">{t('settings.title')}</h1>
            
            <div className="grid grid-cols-1 gap-8">
                <Card>
                    <h2 className="text-xl font-semibold text-gray-800 mb-4 border-b border-gray-200 pb-2">{t('settings.profile')}</h2>
                    
                    <form onSubmit={handleSubmit} className="space-y-6">
                         {message && (
                            <div className={`p-4 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                                {message.text}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label htmlFor="companyName" className="block text-sm font-medium text-gray-700">{t('settings.companyName')}</label>
                                <input
                                    type="text"
                                    id="companyName"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={t('settings.companyNamePlaceholder')}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                />
                            </div>
                            <div>
                                <label htmlFor="logoUrl" className="block text-sm font-medium text-gray-700">{t('settings.logoUrl')}</label>
                                <input
                                    type="text"
                                    id="logoUrl"
                                    value={logoUrl}
                                    onChange={(e) => setLogoUrl(e.target.value)}
                                    placeholder={t('settings.logoUrlPlaceholder')}
                                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                />
                                {logoUrl && (
                                    <div className="mt-2">
                                        <p className="text-xs text-gray-500 mb-1">{tr('Aperçu :', 'معاينة :')}</p>
                                        <img src={logoUrl} alt="Logo Preview" className="h-12 object-contain border border-gray-200 rounded p-1 bg-white" onError={(e) => (e.currentTarget.style.display = 'none')} />
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <div className="border-t border-gray-100 pt-4">
                            <h3 className="text-lg font-medium text-gray-800 mb-4">{t('settings.legal')}</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label htmlFor="ice" className="block text-sm font-medium text-gray-700">{t('settings.ice')}</label>
                                    <input
                                        type="text"
                                        id="ice"
                                        value={ice}
                                        onChange={(e) => setIce(e.target.value)}
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="rc" className="block text-sm font-medium text-gray-700">{t('settings.rc')}</label>
                                    <input
                                        type="text"
                                        id="rc"
                                        value={rc}
                                        onChange={(e) => setRc(e.target.value)}
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="taxId" className="block text-sm font-medium text-gray-700">{t('settings.taxId')}</label>
                                    <input
                                        type="text"
                                        id="taxId"
                                        value={taxId}
                                        onChange={(e) => setTaxId(e.target.value)}
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="patente" className="block text-sm font-medium text-gray-700">{t('settings.patente')}</label>
                                    <input
                                        type="text"
                                        id="patente"
                                        value={patente}
                                        onChange={(e) => setPatente(e.target.value)}
                                        className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end pt-4">
                            <Button type="submit" disabled={isLoading}>
                                {isLoading ? tr('Enregistrement...', 'جاري الحفظ...') : t('settings.save')}
                            </Button>
                        </div>
                    </form>
                </Card>
            </div>
        </div>
    );
};

export default Settings;
