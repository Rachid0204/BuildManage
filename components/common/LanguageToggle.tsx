import React from 'react';
import { useI18n } from '../../hooks/useI18n';

interface LanguageToggleProps {
  variant?: 'light' | 'dark';
  className?: string;
}

const LanguageToggle: React.FC<LanguageToggleProps> = ({
  variant = 'light',
  className = '',
}) => {
  const { language, setLanguage, t } = useI18n();

  const isLight = variant === 'light';

  return (
    <div
      role="group"
      aria-label={t('header.switchLanguage')}
      className={`inline-flex items-center rounded-lg p-0.5 border text-xs font-bold transition-colors shrink-0 ${
        isLight
          ? 'bg-slate-100 border-slate-200 text-slate-700'
          : 'bg-slate-800 border-slate-700 text-slate-200'
      } ${className}`}
    >
      <button
        type="button"
        onClick={() => setLanguage('fr')}
        aria-pressed={language === 'fr'}
        className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${
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
        className={`px-2.5 py-1.5 rounded-md transition-all cursor-pointer ${
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
  );
};

export default LanguageToggle;
