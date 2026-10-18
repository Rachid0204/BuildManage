
import React, { useState, useRef, useEffect } from 'react';
import Button from '../common/Button';
import { useI18n } from '../../hooks/useI18n';
import type { Language } from '../../types';
import { BuildingsIcon, FinancialsIcon, SparklesIcon } from '../icons/IconComponents';

interface LandingPageProps {
    onLoginClick: () => void;
}

const LandingLanguageSwitcher: React.FC = () => {
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
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center justify-center px-3 py-2 text-sm font-medium text-gray-700 hover:text-primary-600 focus:outline-none"
            >
                <span className="uppercase me-1">{language}</span>
                <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </button>
            {isOpen && (
                <div className="absolute right-0 mt-2 w-40 bg-white rounded-md shadow-lg z-20 ring-1 ring-black ring-opacity-5">
                    <ul className="py-1">
                        {languages.map(lang => (
                            <li key={lang.code}>
                                <button
                                    onClick={() => handleLanguageChange(lang.code)}
                                    className={`block w-full text-start px-4 py-2 text-sm ${language === lang.code ? 'bg-primary-50 text-primary-700 font-bold' : 'text-gray-700 hover:bg-gray-100'}`}
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

const LandingPage: React.FC<LandingPageProps> = ({ onLoginClick }) => {
    const { t } = useI18n();

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
            {/* Navbar */}
            <nav className="bg-white shadow-sm sticky top-0 z-40">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                        <div className="flex items-center">
                            <div className="flex-shrink-0 flex items-center">
                                <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center me-2">
                                    <span className="text-white font-bold text-lg">S</span>
                                </div>
                                <span className="font-bold text-xl text-gray-900">Syndik</span>
                            </div>
                        </div>
                        <div className="flex items-center space-x-4">
                            <LandingLanguageSwitcher />
                            <Button onClick={onLoginClick}>
                                {t('landing.login')}
                            </Button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <div className="relative bg-white overflow-hidden">
                <div className="max-w-7xl mx-auto">
                    <div className="relative z-10 pb-8 bg-white sm:pb-16 md:pb-20 lg:max-w-2xl lg:w-full lg:pb-28 xl:pb-32">
                        <svg className="hidden lg:block absolute right-0 inset-y-0 h-full w-48 text-white transform translate-x-1/2" fill="currentColor" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                            <polygon points="50,0 100,0 50,100 0,100" />
                        </svg>

                        <main className="mt-10 mx-auto max-w-7xl px-4 sm:mt-12 sm:px-6 md:mt-16 lg:mt-20 lg:px-8 xl:mt-28">
                            <div className="sm:text-center lg:text-start">
                                <h1 className="text-4xl tracking-tight font-extrabold text-gray-900 sm:text-5xl md:text-6xl">
                                    <span className="block xl:inline">{t('landing.hero.title')}</span>
                                    <span className="block text-primary-600">{t('landing.hero.highlight')}</span>
                                </h1>
                                <p className="mt-3 text-base text-gray-500 sm:mt-5 sm:text-lg sm:max-w-xl sm:mx-auto md:mt-5 md:text-xl lg:mx-0">
                                    {t('landing.hero.subtitle')}
                                </p>
                                <div className="mt-5 sm:mt-8 sm:flex sm:justify-center lg:justify-start">
                                    <div className="rounded-md shadow">
                                        <Button onClick={onLoginClick} className="w-full md:w-auto px-8 py-3 md:py-4 md:text-lg">
                                            {t('landing.hero.cta')}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </main>
                    </div>
                </div>
                <div className="lg:absolute lg:inset-y-0 lg:right-0 lg:w-1/2 bg-gray-50 flex items-center justify-center">
                     <div className="p-8 text-center opacity-20 transform rotate-12 select-none pointer-events-none">
                         <FinancialsIcon />
                         <BuildingsIcon />
                         <SparklesIcon />
                     </div>
                     <img 
                        className="h-56 w-full object-cover sm:h-72 md:h-96 lg:w-full lg:h-full opacity-90" 
                        src="https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1470&q=80" 
                        alt="Modern apartment building in Morocco" 
                    />
                </div>
            </div>

            {/* Features Section */}
            <div className="py-12 bg-gray-50">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="lg:text-center">
                        <h2 className="text-base text-primary-600 font-semibold tracking-wide uppercase">{t('landing.features.subtitle')}</h2>
                        <p className="mt-2 text-3xl leading-8 font-extrabold tracking-tight text-gray-900 sm:text-4xl">
                            {t('landing.features.title')}
                        </p>
                    </div>

                    <div className="mt-10">
                        <dl className="space-y-10 md:space-y-0 md:grid md:grid-cols-3 md:gap-x-8 md:gap-y-10">
                            <div className="relative">
                                <dt>
                                    <div className="absolute flex items-center justify-center h-12 w-12 rounded-md bg-primary-500 text-white">
                                        <BuildingsIcon />
                                    </div>
                                    <p className="ms-16 text-lg leading-6 font-medium text-gray-900">{t('landing.features.management.title')}</p>
                                </dt>
                                <dd className="mt-2 ms-16 text-base text-gray-500">
                                    {t('landing.features.management.desc')}
                                </dd>
                            </div>

                            <div className="relative">
                                <dt>
                                    <div className="absolute flex items-center justify-center h-12 w-12 rounded-md bg-primary-500 text-white">
                                        <FinancialsIcon />
                                    </div>
                                    <p className="ms-16 text-lg leading-6 font-medium text-gray-900">{t('landing.features.financials.title')}</p>
                                </dt>
                                <dd className="mt-2 ms-16 text-base text-gray-500">
                                    {t('landing.features.financials.desc')}
                                </dd>
                            </div>

                            <div className="relative">
                                <dt>
                                    <div className="absolute flex items-center justify-center h-12 w-12 rounded-md bg-primary-500 text-white">
                                        <SparklesIcon />
                                    </div>
                                    <p className="ms-16 text-lg leading-6 font-medium text-gray-900">{t('landing.features.ai.title')}</p>
                                </dt>
                                <dd className="mt-2 ms-16 text-base text-gray-500">
                                    {t('landing.features.ai.desc')}
                                </dd>
                            </div>
                        </dl>
                    </div>
                </div>
            </div>

            {/* Pricing Section */}
            <div className="bg-white py-12">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="text-center">
                        <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
                            {t('landing.pricing.title')}
                        </h2>
                        <p className="mt-4 text-xl text-gray-500">
                            {t('landing.pricing.subtitle')}
                        </p>
                    </div>
                    <div className="mt-12 space-y-4 sm:mt-16 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-6 lg:max-w-4xl lg:mx-auto xl:max-w-none xl:mx-0 xl:grid-cols-3">
                        
                        {/* Tier 1 */}
                        <div className="border border-gray-200 rounded-lg shadow-sm divide-y divide-gray-200 flex flex-col">
                            <div className="p-6 flex-1">
                                <h2 className="text-lg leading-6 font-medium text-gray-900">{t('landing.pricing.tier1.name')}</h2>
                                <p className="mt-4 text-sm text-gray-500">{t('landing.pricing.tier1.desc')}</p>
                                <p className="mt-8">
                                    <span className="text-4xl font-extrabold text-gray-900">200</span>
                                    <span className="text-base font-medium text-gray-500"> MAD/{t('landing.pricing.month')}</span>
                                </p>
                                <ul className="mt-6 space-y-4">
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        </div>
                                        <p className="ms-3 text-base text-gray-700">{t('landing.pricing.limit', { count: '4' })}</p>
                                    </li>
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        </div>
                                        <p className="ms-3 text-base text-gray-700">{t('landing.features.management.title')}</p>
                                    </li>
                                </ul>
                            </div>
                            <div className="p-6">
                                <Button onClick={onLoginClick} variant="secondary" className="w-full py-3">
                                    {t('landing.pricing.select')}
                                </Button>
                            </div>
                        </div>

                        {/* Tier 2 */}
                        <div className="border border-primary-200 rounded-lg shadow-lg divide-y divide-gray-200 flex flex-col relative ring-2 ring-primary-500">
                             <div className="absolute top-0 -translate-y-1/2 left-1/2 -translate-x-1/2">
                                <span className="inline-flex rounded-full bg-primary-600 px-4 py-1 text-sm font-semibold tracking-wide uppercase text-white">
                                    {t('landing.pricing.popular')}
                                </span>
                            </div>
                            <div className="p-6 flex-1">
                                <h2 className="text-lg leading-6 font-medium text-primary-900">{t('landing.pricing.tier2.name')}</h2>
                                <p className="mt-4 text-sm text-gray-500">{t('landing.pricing.tier2.desc')}</p>
                                <p className="mt-8">
                                    <span className="text-4xl font-extrabold text-gray-900">350</span>
                                    <span className="text-base font-medium text-gray-500"> MAD/{t('landing.pricing.month')}</span>
                                </p>
                                <ul className="mt-6 space-y-4">
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        </div>
                                        <p className="ms-3 text-base text-gray-700">{t('landing.pricing.limit', { count: '8' })}</p>
                                    </li>
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        </div>
                                        <p className="ms-3 text-base text-gray-700">{t('landing.features.financials.title')}</p>
                                    </li>
                                     <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        </div>
                                        <p className="ms-3 text-base text-gray-700">{t('landing.features.ai.title')}</p>
                                    </li>
                                </ul>
                            </div>
                            <div className="p-6">
                                <Button onClick={onLoginClick} className="w-full py-3">
                                    {t('landing.pricing.select')}
                                </Button>
                            </div>
                        </div>

                        {/* Tier 3 */}
                        <div className="border border-gray-200 rounded-lg shadow-sm divide-y divide-gray-200 flex flex-col">
                            <div className="p-6 flex-1">
                                <h2 className="text-lg leading-6 font-medium text-gray-900">{t('landing.pricing.tier3.name')}</h2>
                                <p className="mt-4 text-sm text-gray-500">{t('landing.pricing.tier3.desc')}</p>
                                <p className="mt-8">
                                    <span className="text-4xl font-extrabold text-gray-900">500</span>
                                    <span className="text-base font-medium text-gray-500"> MAD/{t('landing.pricing.month')}</span>
                                </p>
                                <ul className="mt-6 space-y-4">
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        </div>
                                        <p className="ms-3 text-base text-gray-700">{t('landing.pricing.unlimited')}</p>
                                    </li>
                                    <li className="flex items-start">
                                        <div className="flex-shrink-0">
                                            <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                        </div>
                                        <p className="ms-3 text-base text-gray-700">{t('landing.pricing.allFeatures')}</p>
                                    </li>
                                </ul>
                            </div>
                            <div className="p-6">
                                <Button onClick={onLoginClick} variant="secondary" className="w-full py-3">
                                    {t('landing.pricing.select')}
                                </Button>
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            {/* Footer */}
            <footer className="bg-gray-800 text-white py-8">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center">
                    <div className="flex items-center">
                         <span className="font-bold text-lg">Syndik</span>
                    </div>
                    <p className="text-sm text-gray-400">&copy; {new Date().getFullYear()} Syndik Morocco. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
};

export default LandingPage;