import React from 'react';
import { useI18n } from '../../hooks/useI18n';

interface LanguageToggleProps {
  variant?: 'light' | 'dark';
  className?: string;
  compactMobile?: boolean;
}

const LanguageToggle: React.FC<LanguageToggleProps> = ({
  variant = 'light',
  className = '',
  compactMobile = false,
}) => {
  const { language, setLanguage, t } = useI18n();

  const isLight = variant === 'light';
  const nextLanguage = language === 'fr' ? 'ar' : 'fr';

  return (
    <>
      {compactMobile && (
        <button
          type="button"
          onClick={() => setLanguage(nextLanguage)}
          aria-label={t('header.switchLanguage')}
          className={`sm:hidden inline-flex items-center justify-center min-h-[36px] min-w-[40px] px-2.5 rounded-lg border text-xs font-bold transition-colors shrink-0 cursor-pointer ${
            isLight
              ? 'bg-slate-100 border-slate-200 text-teal-800 hover:bg-slate-200'
              : 'bg-slate-800 border-slate-700 text-teal-200 hover:bg-slate-700'
          } ${className}`}
        >
          {nextLanguage === 'ar' ? 'AR' : 'FR'}
        </button>
      )}
      <div
        role="group"
        aria-label={t('header.switchLanguage')}
        className={`${compactMobile ? 'hidden sm:inline-flex' : 'inline-flex'} items-center rounded-lg p-0.5 border text-xs font-bold transition-colors shrink-0 ${
          isLight
            ? 'bg-slate-100 border-slate-200 text-slate-700'
            : 'bg-slate-800 border-slate-700 text-slate-200'
        } ${className}`}
      >
        <button
          type="button"
          onClick={() => setLanguage('fr')}
          aria-pressed={language === 'fr'}
          className={`px-2.5 py-1.5 min-h-[32px] rounded-md transition-all cursor-pointer ${
            language === 'fr'
              ? isLight
                ? 'bg-white text-teal-700 shadow-2xs'
                : 'bg-teal-600 text-white shadow-2xs'
              : isLight
              ? 'text-slate-600 hover:text-slate-900'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          FR
        </button>
        <button
          type="button"
          onClick={() => setLanguage('ar')}
          aria-pressed={language === 'ar'}
          className={`px-2.5 py-1.5 min-h-[32px] rounded-md transition-all cursor-pointer ${
            language === 'ar'
              ? isLight
                ? 'bg-white text-teal-700 shadow-2xs'
                : 'bg-teal-600 text-white shadow-2xs'
              : isLight
              ? 'text-slate-600 hover:text-slate-900'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          العربية
        </button>
      </div>
    </>
  );
};

export default LanguageToggle;
