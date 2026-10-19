import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Syndic, Building } from '../types';
import { LogoutIcon } from './icons/IconComponents';
import { useI18n } from '../hooks/useI18n';
import NotificationBell from './common/NotificationBell';
import LanguageToggle from './common/LanguageToggle';

interface HeaderProps {
  syndic: Syndic;
  selectedBuilding: Building | null;
  onLogout: () => void;
  onOpenMobileMenu?: () => void;
}

const getInitials = (name?: string): string => {
  if (!name) return 'SY';
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'SY';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
};

const Header: React.FC<HeaderProps> = ({
  syndic,
  selectedBuilding,
  onLogout,
  onOpenMobileMenu,
}) => {
  const { t, tr } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();

  const routeMap: Record<string, { fr: string; ar: string }> = {
    '': { fr: 'Tableau de bord', ar: 'لوحة القيادة' },
    dashboard: { fr: 'Tableau de bord', ar: 'لوحة القيادة' },
    buildings: { fr: 'Immeubles & Résidences', ar: 'العمارات والإقامات' },
    residents: { fr: 'Résidents & Accès', ar: 'السكان وحسابات الولوج' },
    apartments: { fr: 'Lots & Appartements', ar: 'الشقق والوحدات' },
    maintenance: { fr: 'Maintenance & Dépannages', ar: 'الصيانة والتدخلات' },
    financials: { fr: 'Comptabilité & Trésorerie', ar: 'المحاسبة والمالية' },
    ag: { fr: 'Assemblées Générales', ar: 'الجمعيات العامة' },
    prestataires: { fr: 'Prestataires & Contrats', ar: 'مقدمو الخدمات والعقود' },
    chat: { fr: 'Messagerie Communautaire', ar: 'فضاء التواصل والمحادثات' },
    marketplace: { fr: 'Souk des Résidents', ar: 'سوق الجيران' },
    analytics: { fr: 'Rapports & Statistiques', ar: 'التقارير والإحصائيات' },
    announcements: { fr: 'Annonces Officielles', ar: 'الإعلانات الرسمية' },
    documents: { fr: 'Archives & Documents', ar: 'الأرشيف والوثائق' },
    settings: { fr: 'Paramètres du Cabinet', ar: 'إعدادات المكتب' },
  };

  const segment = location.pathname.replace(/^\//, '').split('/')[0] || 'dashboard';
  const currentBreadcrumb = routeMap[segment] || routeMap.dashboard;
  const syndicInitials = getInitials(syndic?.name);

  return (
    <header className="flex items-center justify-between h-16 sm:h-20 px-3 sm:px-6 bg-white border-b border-slate-200 shrink-0">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {onOpenMobileMenu && (
          <button
            type="button"
            onClick={onOpenMobileMenu}
            aria-label={t('header.openMenu')}
            className="lg:hidden p-2 -ms-1 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1">
          {/* Hide breadcrumbs on mobile screens so the building title isn't cramped/truncated */}
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-0.5 truncate">
            <button
              type="button"
              onClick={() => navigate('/buildings')}
              className="hover:text-teal-700 transition-colors truncate"
            >
              {syndic.name}
            </button>
            <span className="text-slate-300">/</span>
            <span className="text-teal-700 font-bold truncate">
              {tr(currentBreadcrumb.fr, currentBreadcrumb.ar)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg lg:text-xl font-bold text-slate-900 truncate">
              {selectedBuilding ? selectedBuilding.name : t('header.selectBuilding')}
            </h2>
            {selectedBuilding && (
              <span className="hidden md:inline-block text-xs text-slate-500 truncate">
                • {selectedBuilding.address}, {selectedBuilding.city}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 ms-2">
        <div className="flex items-center gap-2">
          <span className="hidden md:inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
            {t('header.syndicSpace')}
          </span>
          <div
            title={syndic.name}
            aria-label={syndic.name}
            className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg bg-teal-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center border border-teal-800 shadow-2xs shrink-0 select-none"
          >
            {syndicInitials}
          </div>
        </div>

        <NotificationBell />

        <LanguageToggle variant="light" />

        <button
          type="button"
          onClick={onLogout}
          aria-label={t('header.logout')}
          className="flex items-center justify-center p-2 text-slate-500 hover:text-rose-600 focus:outline-none min-w-[40px] min-h-[40px] rounded-lg hover:bg-slate-100 transition-colors"
        >
          <LogoutIcon />
          <span className="ms-2 text-xs sm:text-sm hidden md:block font-semibold">
            {t('header.logout')}
          </span>
        </button>
      </div>
    </header>
  );
};

export default Header;
