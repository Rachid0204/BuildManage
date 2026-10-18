import React, { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from '../Sidebar';
import Header from '../Header';
import { useAuth } from '../../contexts/AuthContext';
import { useBuilding } from '../../contexts/BuildingContext';
import Loading from '../common/Loading';
import {
    DashboardIcon,
    FinancialsIcon,
    WrenchIcon,
    AGIcon,
} from '../icons/IconComponents';

// Map routes to View types for Sidebar highlighting
const getActiveView = (pathname: string): any => {
    if (pathname === '/' || pathname === '/dashboard') return 'dashboard';
    const path = pathname.substring(1); // remove leading slash
    return path.split('/')[0]; // get first segment
};

const DashboardLayout: React.FC = () => {
    const { logout, userProfile, loading } = useAuth();
    const { syndic, selectedBuilding, setSelectedBuildingId } = useBuilding();
    const location = useLocation();
    const navigate = useNavigate();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const handleLogout = async () => {
        await logout();
        navigate('/login');
    };

    const activeView = getActiveView(location.pathname);

    if (loading) return <Loading message="Initializing..." />;

    if (userProfile?.role === 'syndic' && !syndic) {
        return <Loading message="Loading Syndic Profile..." />;
    }

    if (!syndic) return null;

    const handleViewChange = (view: string) => {
        navigate(view === 'dashboard' ? '/' : `/${view}`);
        setIsMobileMenuOpen(false);
    };

    return (
        <div className="flex h-screen bg-slate-100 flex-col overflow-hidden">
            <div className="flex-1 flex overflow-hidden relative">
                <Sidebar 
                    syndic={syndic} 
                    activeView={activeView} 
                    onViewChange={handleViewChange}
                    selectedBuilding={selectedBuilding}
                    onBuildingChange={(b) => setSelectedBuildingId(b.id)}
                    isOpen={isMobileMenuOpen}
                    onClose={() => setIsMobileMenuOpen(false)}
                />
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    <Header 
                        syndic={syndic} 
                        selectedBuilding={selectedBuilding} 
                        onLogout={handleLogout}
                        onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
                    />
                    <main className="flex-1 overflow-x-hidden overflow-y-auto bg-slate-100 p-3 sm:p-6 pb-24 lg:pb-6">
                        <Outlet />
                    </main>
                </div>
            </div>

            {/* Mobile Bottom Navigation Bar (< lg) */}
            <nav
                aria-label="Navigation mobile rapide"
                className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 shadow-lg pb-safe"
            >
                <div className="grid grid-cols-5 h-16">
                    <button
                        type="button"
                        onClick={() => handleViewChange('dashboard')}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            activeView === 'dashboard' ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <span className="scale-90"><DashboardIcon /></span>
                        <span className="truncate max-w-[64px]">Accueil</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleViewChange('financials')}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            activeView === 'financials' ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <span className="scale-90"><FinancialsIcon /></span>
                        <span className="truncate max-w-[64px]">Finances</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleViewChange('maintenance')}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            activeView === 'maintenance' ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <span className="scale-90"><WrenchIcon /></span>
                        <span className="truncate max-w-[64px]">Travaux</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => handleViewChange('ag')}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            activeView === 'ag' ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <span className="scale-90"><AGIcon /></span>
                        <span className="truncate max-w-[64px]">AG & Votes</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setIsMobileMenuOpen(true)}
                        className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                            isMobileMenuOpen ? 'text-teal-600' : 'text-slate-500 hover:text-slate-900'
                        }`}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                        <span className="truncate max-w-[64px]">Plus</span>
                    </button>
                </div>
            </nav>
        </div>
    );
};

export default DashboardLayout;
