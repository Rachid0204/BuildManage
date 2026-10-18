import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Syndic, Building, Language } from '../types';
import { LogoutIcon } from './icons/IconComponents';
import { useI18n } from '../hooks/useI18n';
import { useAuth, getHomeRouteForRole } from '../contexts/AuthContext';
import NotificationBell from './common/NotificationBell';

interface HeaderProps {
    syndic: Syndic;
    selectedBuilding: Building | null;
    onLogout: () => void;
    onOpenMobileMenu?: () => void;
}

const LanguageSwitcher: React.FC = () => {
    const { language, setLanguage } = useI18n();
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const languages: { code: Language, name: string }[] = [
        { code: 'en', name: 'English' },
        { code: 'fr', name: 'Français' },
        { code: 'ar', name: 'العربية' },
    ];

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleLanguageChange = (lang: Language) => {
        setLanguage(lang);
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Change language"
                className="flex items-center justify-center w-10 h-10 bg-gray-100 rounded-full hover:bg-gray-200 focus:outline-none text-xs sm:text-sm"
            >
                <span className="font-semibold text-gray-700">{language.toUpperCase()}</span>
            </button>
            {isOpen && (
                <div className="absolute end-0 mt-2 w-40 bg-white rounded-lg shadow-lg z-30 border border-slate-200">
                    <ul className="py-1">
                        {languages.map(lang => (
                            <li key={lang.code}>
                                <button
                                    type="button"
                                    onClick={() => handleLanguageChange(lang.code)}
                                    className={`w-full text-start block px-4 py-2.5 text-sm ${language === lang.code ? 'font-bold text-primary-600 bg-primary-50' : 'text-gray-700 hover:bg-gray-100'}`}
                                >
                                    {lang.name}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

const Header: React.FC<HeaderProps> = ({ syndic, selectedBuilding, onLogout, onOpenMobileMenu }) => {
    const { t } = useI18n();
    const { loginWithEmail } = useAuth();
    const navigate = useNavigate();

    const handleSwitchRole = async (email: string) => {
        const profile = await loginWithEmail(email, 'password123');
        navigate(getHomeRouteForRole(profile.role), { replace: true });
    };

    return (
        <header className="flex items-center justify-between h-16 sm:h-20 px-3 sm:px-6 bg-white border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {onOpenMobileMenu && (
                    <button
                        type="button"
                        onClick={onOpenMobileMenu}
                        aria-label="Ouvrir le menu de navigation"
                        className="lg:hidden p-2 -ms-1 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>
                )}
                <div className="min-w-0 flex-1">
                    <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-slate-900 truncate">
                        {selectedBuilding ? selectedBuilding.name : t('header.selectBuilding')}
                    </h2>
                    <p className="text-xs sm:text-sm text-slate-500 truncate hidden xs:block sm:block">
                        {selectedBuilding ? selectedBuilding.address : t('header.noBuildingSelected')}
                    </p>
                </div>
            </div>
           
            <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 ms-2">
                {/* Role Switcher Pills for Demo & Testing */}
                <div className="hidden xl:flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 me-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase px-1.5">Simuler :</span>
                    <button
                        type="button"
                        onClick={() => handleSwitchRole('fatima.zahra@email.com')}
                        className="px-2 py-1 rounded bg-white hover:bg-indigo-50 text-indigo-800 border border-slate-200 text-[11px] font-semibold transition-colors"
                        title="Basculer vers l'Espace Copropriétaire"
                    >
                        🔑 Copropriétaire
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSwitchRole('youssef.benali@email.com')}
                        className="px-2 py-1 rounded bg-white hover:bg-sky-50 text-sky-800 border border-slate-200 text-[11px] font-semibold transition-colors"
                        title="Basculer vers l'Espace Locataire"
                    >
                        🏠 Locataire
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSwitchRole('provider@syndik.ma')}
                        className="px-2 py-1 rounded bg-white hover:bg-amber-50 text-amber-800 border border-slate-200 text-[11px] font-semibold transition-colors"
                        title="Basculer vers le Portail Prestataire"
                    >
                        🛠️ Prestataire
                    </button>
                    <button
                        type="button"
                        onClick={() => handleSwitchRole('admin@syndik.ma')}
                        className="px-2 py-1 rounded bg-white hover:bg-slate-200 text-slate-800 border border-slate-200 text-[11px] font-semibold transition-colors"
                        title="Basculer vers la Console Super Admin"
                    >
                        🛡️ Admin
                    </button>
                </div>

                <div className="flex items-center">
                    <span className="me-3 font-medium text-slate-700 hidden 2xl:block text-sm">{syndic.name}</span>
                    <img className="h-8 w-8 sm:h-10 sm:w-10 rounded-full object-cover border border-slate-200" src={syndic.logoUrl} alt="Syndic Logo" />
                </div>
                
                <NotificationBell />
                
                <LanguageSwitcher />
                
                <button
                    type="button"
                    onClick={onLogout}
                    aria-label={t('header.logout')}
                    className="flex items-center justify-center p-2 text-slate-500 hover:text-primary-600 focus:outline-none min-w-[40px] min-h-[40px] rounded-lg hover:bg-slate-100"
                >
                    <LogoutIcon />
                    <span className="ms-2 text-sm hidden md:block font-medium">{t('header.logout')}</span>
                </button>
            </div>
        </header>
    );
};

export default Header;
