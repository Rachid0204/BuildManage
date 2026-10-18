import React from 'react';
import type { Building } from '../../types';
import Card from '../common/Card';
import { useI18n } from '../../hooks/useI18n';
import {
  ResidentsIcon,
  ApartmentsIcon,
  FinancialsIcon,
  AGIcon,
  PrestatairesIcon,
  QuittanceIcon,
  ShieldAlertIcon,
} from '../icons/IconComponents';

type View =
  | 'dashboard'
  | 'residents'
  | 'apartments'
  | 'announcements'
  | 'documents'
  | 'financials'
  | 'buildings'
  | 'ag'
  | 'prestataires'
  | 'maintenance'
  | 'analytics';

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
  onClick?: () => void;
}> = ({ icon, label, value, subtitle, color, onClick }) => (
  <Card
    className={`p-4 transition-all ${
      onClick
        ? 'cursor-pointer hover:shadow-md hover:border-teal-300 border border-slate-200'
        : 'border border-slate-200'
    }`}
    onClick={onClick}
  >
    <div className="flex items-center">
      <div className={`p-3 rounded-xl ${color} text-white me-3 shrink-0`}>{icon}</div>
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold font-mono text-slate-900 mt-0.5 tabular-nums">{value}</p>
        {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  </Card>
);

const Dashboard: React.FC<{ building: Building; onNavigate: (view: any) => void }> = ({
  building,
  onNavigate,
}) => {
  const { t } = useI18n();
  const currencyFormatter = new Intl.NumberFormat('fr-MA', {
    style: 'currency',
    currency: 'MAD',
    minimumFractionDigits: 2,
  });

  const recentAnnouncements = [...(building.announcements || [])]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 3);

  const totalTantiemes = building.apartments.reduce((sum, a) => sum + (a.tantiemes || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="pb-2 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {building.name}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {building.address}, {building.city} · Copropriété régie par la Loi n° 18-00
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono bg-teal-50 text-teal-800 border border-teal-200 px-2.5 py-1 rounded font-semibold">
            Quote-part totale : {totalTantiemes} / 1000 tantièmes
          </span>
        </div>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<FinancialsIcon />}
          label="Solde Copropriété"
          value={currencyFormatter.format(building.financials.balance)}
          subtitle="Compte bancaire syndicat"
          color="bg-teal-700"
          onClick={() => onNavigate('financials')}
        />
        <StatCard
          icon={<ApartmentsIcon />}
          label="Lots & Tantièmes"
          value={`${building.apartments.length} lots`}
          subtitle={`${totalTantiemes}/1000 millièmes`}
          color="bg-slate-800"
          onClick={() => onNavigate('apartments')}
        />
        <StatCard
          icon={<ResidentsIcon />}
          label="Copropriétaires"
          value={building.residents.length}
          subtitle={`${building.residents.filter((r) => r.isOwner).length} propriétaires`}
          color="bg-indigo-600"
          onClick={() => onNavigate('residents')}
        />
        <StatCard
          icon={<AGIcon />}
          label="Assemblée Générale"
          value="AGO 2026"
          subtitle="Quorum légal atteint (>50%)"
          color="bg-emerald-600"
          onClick={() => onNavigate('ag')}
        />
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Announcements */}
        <Card className="p-5 border border-slate-200">
          <div className="flex justify-between items-center pb-3 border-b border-slate-200">
            <h2 className="font-bold text-slate-900 text-sm">{t('dashboard.recentAnnouncements')}</h2>
            <button
              onClick={() => onNavigate('announcements')}
              className="text-xs text-teal-700 hover:text-teal-900 font-semibold"
            >
              Voir tout
            </button>
          </div>
          <div className="space-y-3.5 mt-3">
            {recentAnnouncements.length > 0 ? (
              recentAnnouncements.map((ann) => (
                <div key={ann.id} className="border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                  <p className="font-semibold text-slate-900 text-xs sm:text-sm">{ann.title}</p>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                    {new Date(ann.date).toLocaleDateString('fr-MA')}
                  </p>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2">{ann.content}</p>
                </div>
              ))
            ) : (
              <p className="text-slate-500 text-xs py-4 text-center">
                {t('dashboard.noRecentAnnouncements')}
              </p>
            )}
          </div>
        </Card>

        {/* Quick Actions & Legal Modules */}
        <Card className="p-5 border border-slate-200">
          <h2 className="font-bold text-slate-900 text-sm pb-3 border-b border-slate-200">
            Actions Rapides & Modules Réglementaires
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <button
              onClick={() => onNavigate('financials')}
              className="p-3 rounded-lg border border-slate-200 hover:border-teal-300 hover:bg-slate-50 text-left transition-colors flex items-start gap-2.5"
            >
              <div className="p-2 rounded bg-teal-50 text-teal-700">
                <FinancialsIcon />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-xs">Vérifier les Virements</p>
                <p className="text-[11px] text-slate-500">Valider les justificatifs des résidents</p>
              </div>
            </button>

            <button
              onClick={() => onNavigate('ag')}
              className="p-3 rounded-lg border border-slate-200 hover:border-teal-300 hover:bg-slate-50 text-left transition-colors flex items-start gap-2.5"
            >
              <div className="p-2 rounded bg-emerald-50 text-emerald-700">
                <AGIcon />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-xs">Assemblée Générale</p>
                <p className="text-[11px] text-slate-500">Feuille de présence & votes</p>
              </div>
            </button>

            <button
              onClick={() => onNavigate('prestataires')}
              className="p-3 rounded-lg border border-slate-200 hover:border-teal-300 hover:bg-slate-50 text-left transition-colors flex items-start gap-2.5"
            >
              <div className="p-2 rounded bg-indigo-50 text-indigo-700">
                <PrestatairesIcon />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-xs">Prestataires & Contrats</p>
                <p className="text-[11px] text-slate-500">Ascenseur, nettoyage, sécurité</p>
              </div>
            </button>

            <button
              onClick={() => onNavigate('apartments')}
              className="p-3 rounded-lg border border-slate-200 hover:border-teal-300 hover:bg-slate-50 text-left transition-colors flex items-start gap-2.5"
            >
              <div className="p-2 rounded bg-slate-100 text-slate-700">
                <ApartmentsIcon />
              </div>
              <div>
                <p className="font-bold text-slate-900 text-xs">Grille des Tantièmes</p>
                <p className="text-[11px] text-slate-500">Quotes-parts et répartition</p>
              </div>
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;