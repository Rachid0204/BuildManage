import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import type { Language } from '../types';
import { translations } from '../i18n/locales';

// Explicit French and Arabic dashboard translations in the i18n hook
export const dashboardTranslations: Record<'fr' | 'ar', Record<string, string>> = {
    fr: {
        'dashboard.tantiemes': 'tantièmes',
        'dashboard.managedBy': 'Géré par',
        'dashboard.conveneAg': 'Convoquer une AG',
        'dashboard.treasuryQuittances': 'Trésorerie & Quittances',
    },
    ar: {
        'dashboard.tantiemes': 'جزء (تانتييم)',
        'dashboard.managedBy': 'تحت إشراف',
        'dashboard.conveneAg': 'استدعاء جمع عام',
        'dashboard.treasuryQuittances': 'الخزينة والوصولات',
    },
};

// Helper to get nested keys
type NestedKey<T> = T extends object ? { [K in keyof T]-?: `${K & string}` | `${K & string}.${NestedKey<T[K]>}` }[keyof T] : never;
export type TranslationKeys =
    | NestedKey<typeof translations.fr>
    | 'dashboard.tantiemes'
    | 'dashboard.managedBy'
    | 'dashboard.conveneAg'
    | 'dashboard.treasuryQuittances';

interface I18nContextType {
    language: Language;
    isAr: boolean;
    setLanguage: (language: Language) => void;
    toggleLanguage: () => void;
    t: (key: TranslationKeys | string, replacements?: Record<string, string>) => string;
    tr: (frText: string, arText: string) => string;
}

const I18nContext = createContext<I18nContextType | undefined>(undefined);

const getInitialLanguage = (): Language => {
    const storedLang = localStorage.getItem('syndik_lang');
    if (storedLang === 'fr' || storedLang === 'ar') {
        return storedLang;
    }
    return 'fr'; // Default to French for Moroccan context
};

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [language, setLanguage] = useState<Language>(getInitialLanguage);
    const isAr = language === 'ar';

    useEffect(() => {
        localStorage.setItem('syndik_lang', language);
        document.documentElement.lang = language;
        document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    }, [language]);

    const toggleLanguage = () => {
        setLanguage((prev) => (prev === 'ar' ? 'fr' : 'ar'));
    };

    const tr = (frText: string, arText: string): string => {
        return language === 'ar' ? arText : frText;
    };

    const t = (key: TranslationKeys | string, replacements?: Record<string, string>): string => {
        const activeLang: 'fr' | 'ar' = language === 'ar' ? 'ar' : 'fr';

        if (dashboardTranslations[activeLang]?.[key]) {
            let directText = dashboardTranslations[activeLang][key];
            if (replacements) {
                Object.keys(replacements).forEach((placeholder) => {
                    directText = directText.replace(`{{${placeholder}}}`, replacements[placeholder]);
                });
            }
            return directText;
        }

        const keys = key.split('.');
        let text: any = translations[activeLang] || translations.fr;

        for (const k of keys) {
            text = text?.[k];
            if (text === undefined) {
                // Fallback to French if key missing in active locale
                let fallback: any = translations.fr;
                for (const fk of keys) {
                    fallback = fallback?.[fk];
                }
                if (fallback !== undefined) {
                    text = fallback;
                    break;
                }
                console.warn(`Translation key not found: ${key}`);
                return key;
            }
        }

        let result = String(text);

        if (replacements) {
            Object.keys(replacements).forEach((placeholder) => {
                result = result.replace(`{{${placeholder}}}`, replacements[placeholder]);
            });
        }

        return result;
    };

    return React.createElement(
        I18nContext.Provider,
        { value: { language, isAr, setLanguage, toggleLanguage, t, tr } },
        children
    );
};

export const useI18n = (): I18nContextType => {
    const context = useContext(I18nContext);
    if (!context) {
        throw new Error('useI18n must be used within an I18nProvider');
    }
    return context;
};
