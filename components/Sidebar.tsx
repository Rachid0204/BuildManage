import React from 'react';
import type { Building, Syndic } from '../types';
import { useI18n } from '../hooks/useI18n';
import {
  DashboardIcon,
  ResidentsIcon,
  ApartmentsIcon,
  AnnouncementsIcon,
  DocumentsIcon,
  FinancialsIcon,
  BuildingsIcon,
  WrenchIcon,
  ChartBarIcon,
  SettingsIcon,
  AGIcon,
  PrestatairesIcon,
  ChatIcon,
  MarketplaceIcon,
} from './icons/IconComponents';

type View =
  | 'dashboard'
  | 'residents'
  | 'apartments'
  | 'announcements'
  | 'documents'
  | 'financials'
  | 'buildings'
  | 'maintenance'
  | 'ag'
  | 'prestataires'
  | 'chat'
  | 'marketplace'
  | 'analytics'
  | 'settings';

interface SidebarProps {
  syndic: Syndic;
  activeView: View;
  onViewChange: (view: View) => void;
  selectedBuilding: Building | null;
  onBuildingChange: (building: Building) => void;
  isOpen?: boolean;
  onClose?: () => void;
}

const NavLink: React.FC<{
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}> = ({ icon, label, isActive, onClick, disabled }) => {
  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) onClick();
      }}
      disabled={disabled}
      className={`w-full flex items-center px-4 py-3 min-h-[44px] text-sm font-medium transition-colors duration-150 rounded-lg text-start ${
        isActive
          ? 'text-white bg-primary-700 shadow-xs'
          : 'text-primary-100 hover:bg-primary-800'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span className="me-3 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
};

const TrialProgressBar: React.FC<{ expiryDate: string }> = ({
  expiryDate,
}) => {
  const { t } = useI18n();
  const today = new Date();
  const expiry = new Date(expiryDate);

  const diffTime = expiry.getTime() - today.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  const totalDuration = 30;
  const percentage = Math.max(
    0,
    Math.min(100, (daysLeft / totalDuration) * 100)
  );

  let barColor = 'bg-green-500';
  if (daysLeft <= 7) barColor = 'bg-red-500';
  else if (daysLeft <= 14) barColor = 'bg-yellow-500';

  if (daysLeft < 0) return null;

  return (
    <div className="mt-auto px-4 py-3.5 bg-slate-950/60 rounded-lg mx-3 mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-xs font-semibold text-primary-100 uppercase tracking-wider">
          {t('subscription.trial')}
        </span>
        <span className="text-xs font-bold text-white">{daysLeft}d</span>
      </div>
      <div className="w-full bg-primary-900 rounded-full h-2">
        <div
          className={`${barColor} h-2 rounded-full transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
      <p className="text-[11px] text-primary-200 mt-1.5 text-center">
        {t('subscription.daysLeft', { count: String(daysLeft) })}
      </p>
    </div>
  );
};

const Sidebar: React.FC<SidebarProps> = ({
  syndic,
  activeView,
  onViewChange,
  selectedBuilding,
  onBuildingChange,
  isOpen = false,
  onClose,
}) => {
  const { t } = useI18n();

  const navItems = [
    {
      id: 'buildings',
      label: t('sidebar.buildings'),
      icon: <BuildingsIcon />,
      requiresBuilding: false,
    },
    {
      id: 'dashboard',
      label: t('sidebar.dashboard'),
      icon: <DashboardIcon />,
      requiresBuilding: true,
    },
    {
      id: 'residents',
      label: t('sidebar.residents'),
      icon: <ResidentsIcon />,
      requiresBuilding: true,
    },
    {
      id: 'apartments',
      label: t('sidebar.apartments'),
      icon: <ApartmentsIcon />,
      requiresBuilding: true,
    },
    {
      id: 'maintenance',
      label: t('sidebar.maintenance'),
      icon: <WrenchIcon />,
      requiresBuilding: true,
    },
    {
      id: 'financials',
      label: t('sidebar.financials'),
      icon: <FinancialsIcon />,
      requiresBuilding: true,
    },
    {
      id: 'ag',
      label: t('sidebar.ag'),
      icon: <AGIcon />,
      requiresBuilding: true,
    },
    {
      id: 'prestataires',
      label: t('sidebar.prestataires'),
      icon: <PrestatairesIcon />,
      requiresBuilding: true,
    },
    {
      id: 'chat',
      label: t('sidebar.chat'),
      icon: <ChatIcon />,
      requiresBuilding: true,
    },
    {
      id: 'marketplace',
      label: t('sidebar.marketplace'),
      icon: <MarketplaceIcon />,
      requiresBuilding: true,
    },
    {
      id: 'analytics',
      label: t('sidebar.analytics'),
      icon: <ChartBarIcon />,
      requiresBuilding: true,
    },
    {
      id: 'announcements',
      label: t('sidebar.announcements'),
      icon: <AnnouncementsIcon />,
      requiresBuilding: true,
    },
    {
      id: 'documents',
      label: t('sidebar.documents'),
      icon: <DocumentsIcon />,
      requiresBuilding: true,
    },
    {
      id: 'settings',
      label: t('sidebar.settings'),
      icon: <SettingsIcon />,
      requiresBuilding: false,
    },
  ];

  const handleSelectView = (view: View) => {
    onViewChange(view);
    if (onClose) onClose();
  };

  const sidebarContent = (
    <div className="w-72 lg:w-64 h-full flex-shrink-0 bg-slate-900 text-white flex flex-col shadow-xl lg:shadow-none">
      <div className="h-16 lg:h-20 flex items-center justify-between px-5 border-b border-slate-800">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center font-bold text-white text-base">
            S
          </div>
          <h1 className="text-xl lg:text-2xl font-bold text-white tracking-tight">Syndik</h1>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le menu"
            className="lg:hidden p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      <div className="px-4 my-3">
        <label
          htmlFor="building-select"
          className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5"
        >
          {t('sidebar.selectBuilding')}
        </label>
        <select
          id="building-select"
          value={selectedBuilding?.id || ''}
          onChange={(e) => {
            const building = syndic.buildings.find(
              (b) => b.id === e.target.value
            );
            if (building) {
              onBuildingChange(building);
              if (onClose) onClose();
            }
          }}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg py-2.5 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-500 min-h-[44px]"
        >
          <option value="" disabled>
            {t('sidebar.selectBuildingPrompt')}
          </option>
          {syndic.buildings.map((building) => (
            <option key={building.id} value={building.id}>
              {building.name}
            </option>
          ))}
        </select>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto overscroll-contain">
        {navItems.map((item) => (
          <NavLink
            key={item.id}
            icon={item.icon}
            label={item.label}
            isActive={activeView === item.id}
            onClick={() => handleSelectView(item.id as View)}
            disabled={item.requiresBuilding && !selectedBuilding}
          />
        ))}
      </nav>

      <TrialProgressBar expiryDate={syndic.subscriptionExpiry} />
    </div>
  );

  return (
    <>
      {/* Desktop Static Sidebar */}
      <aside className="hidden lg:flex h-full flex-shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs transition-opacity"
            onClick={onClose}
            aria-hidden="true"
          />
          <aside className="relative z-10 flex h-full max-w-full">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
};

export default Sidebar;
