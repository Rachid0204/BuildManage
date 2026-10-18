import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { getSyndics, saveSyndic } from '../../firebase/services';
import type { Syndic, SubscriptionPlan, SubscriptionStatus } from '../../types';
import { BuildingsIcon, ResidentsIcon, FinancialsIcon } from '../icons/IconComponents';

const PLAN_PRICES: Record<SubscriptionPlan, number> = {
  starter: 200,
  professional: 350,
  enterprise: 500,
};

const AdminDashboard: React.FC = () => {
  const { userProfile, logout, loginWithEmail } = useAuth();
  const queryClient = useQueryClient();

  const [selectedSyndic, setSelectedSyndic] = useState<Syndic | null>(null);
  const [editPlan, setEditPlan] = useState<SubscriptionPlan>('professional');
  const [editStatus, setEditStatus] = useState<SubscriptionStatus>('active');
  const [editExpiry, setEditExpiry] = useState('');

  const { data: syndics = [] } = useQuery({
    queryKey: ['syndics'],
    queryFn: getSyndics,
  });

  const updateSyndicMutation = useMutation({
    mutationFn: saveSyndic,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setSelectedSyndic(null);
    },
  });

  const totalBuildings = syndics.reduce((acc, s) => acc + (s.buildings?.length || 0), 0);
  const totalResidents = syndics.reduce(
    (acc, s) =>
      acc + (s.buildings || []).reduce((bAcc, b) => bAcc + (b.residents?.length || 0), 0),
    0
  );
  const totalMrr = syndics.reduce(
    (acc, s) =>
      s.subscriptionStatus === 'active'
        ? acc + (PLAN_PRICES[s.subscriptionPlan] || 350)
        : acc,
    0
  );

  const handleOpenManage = (syndic: Syndic) => {
    setSelectedSyndic(syndic);
    setEditPlan(syndic.subscriptionPlan);
    setEditStatus(syndic.subscriptionStatus);
    setEditExpiry(syndic.subscriptionExpiry.split('T')[0]);
  };

  const handleSaveSyndic = () => {
    if (!selectedSyndic) return;
    updateSyndicMutation.mutate({
      ...selectedSyndic,
      subscriptionPlan: editPlan,
      subscriptionStatus: editStatus,
      subscriptionExpiry: new Date(editExpiry || Date.now()).toISOString(),
    });
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <nav className="bg-slate-900 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2.5">
              <span className="text-xl font-bold text-white tracking-tight">Syndik Admin</span>
              <span className="px-2.5 py-0.5 bg-rose-600 text-xs font-bold rounded-full text-white">
                Superuser SaaS
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs sm:text-sm text-slate-300 font-mono">
                {userProfile?.email}
              </span>
              <button
                onClick={() => logout()}
                className="text-xs font-bold text-rose-400 hover:text-rose-200 transition-colors"
              >
                Déconnexion
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Console d'Administration SaaS & Supervision Nationale
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Gestion des cabinets de syndic, abonnements SaaS, conformité Loi 18-00 / 106-12 et simulation de rôles.
            </p>
          </div>

          {/* Quick Role Switcher for Testing All User Types */}
          <div className="flex items-center gap-2 flex-wrap bg-white p-2 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-bold text-slate-500 px-1">Simuler vue :</span>
            <button
              onClick={() => loginWithEmail('syndic@syndik.ma', 'password123')}
              className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-bold text-xs"
            >
              🏢 Syndic Pro
            </button>
            <button
              onClick={() => loginWithEmail('resident@syndik.ma', 'password123')}
              className="px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 font-bold text-xs"
            >
              👤 Copropriétaire
            </button>
            <button
              onClick={() => loginWithEmail('provider@syndik.ma', 'password123')}
              className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold text-xs"
            >
              🛠️ Prestataire Agréé
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-teal-700 text-white">
              <ResidentsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Cabinets Syndics</p>
              <p className="text-2xl font-bold font-mono text-slate-900">{syndics.length}</p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-indigo-600 text-white">
              <BuildingsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Résidences Gérées</p>
              <p className="text-2xl font-bold font-mono text-slate-900">{totalBuildings}</p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-600 text-white">
              <ResidentsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Copropriétaires</p>
              <p className="text-2xl font-bold font-mono text-slate-900">{totalResidents}</p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-500 text-white">
              <FinancialsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">Revenu Mensuel (MRR)</p>
              <p className="text-2xl font-bold font-mono text-slate-900">{totalMrr} MAD</p>
            </div>
          </Card>
        </div>

        {/* Registered Syndics Table */}
        <Card className="p-5 border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-slate-900">
              Cabinets de Syndic & Copropriétés Enregistrés
            </h2>
            <span className="text-xs text-slate-500 font-mono">
              Conformité Loi 18-00 & 106-12 vérifiée
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-bold text-slate-500 uppercase text-xs">
                    Cabinet / Syndic
                  </th>
                  <th className="px-4 py-3 text-left font-bold text-slate-500 uppercase text-xs">
                    Identifiants Légaux (ICE / RC)
                  </th>
                  <th className="px-4 py-3 text-center font-bold text-slate-500 uppercase text-xs">
                    Immeubles
                  </th>
                  <th className="px-4 py-3 text-left font-bold text-slate-500 uppercase text-xs">
                    Forfait SaaS
                  </th>
                  <th className="px-4 py-3 text-left font-bold text-slate-500 uppercase text-xs">
                    Statut & Échéance
                  </th>
                  <th className="px-4 py-3 text-right font-bold text-slate-500 uppercase text-xs">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {syndics.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="font-bold text-slate-900">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.city || 'Casablanca'}</div>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap font-mono text-xs text-slate-600">
                      <div>ICE : {s.ice || '001524367000089'}</div>
                      <div className="text-[11px] text-slate-400">RC : {s.rc || '458921'}</div>
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800">
                      {s.buildings?.length || 0}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={`px-2.5 py-0.5 inline-flex text-xs font-bold rounded-full capitalize ${
                          s.subscriptionPlan === 'enterprise'
                            ? 'bg-purple-100 text-purple-800'
                            : s.subscriptionPlan === 'professional'
                            ? 'bg-teal-100 text-teal-800'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {s.subscriptionPlan} ({PLAN_PRICES[s.subscriptionPlan]} DH/mois)
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={`px-2.5 py-0.5 inline-flex text-xs font-bold rounded-full ${
                          s.subscriptionStatus === 'active'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {s.subscriptionStatus === 'active' ? 'Actif' : 'Expiré'}
                      </span>
                      <span className="ms-2 font-mono text-xs text-slate-400">
                        exp. {new Date(s.subscriptionExpiry).toLocaleDateString('fr-MA')}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenManage(s)}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors"
                      >
                        Gérer l'abonnement
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </main>

      {/* Manage Syndic Modal */}
      {selectedSyndic && (
        <Modal
          isOpen={!!selectedSyndic}
          onClose={() => setSelectedSyndic(null)}
          title={`Gérer le Cabinet : ${selectedSyndic.name}`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelectedSyndic(null)}>
                Annuler
              </Button>
              <Button
                onClick={handleSaveSyndic}
                disabled={updateSyndicMutation.isPending}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                Enregistrer les modifications
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Forfait SaaS :</label>
              <select
                value={editPlan}
                onChange={(e) => setEditPlan(e.target.value as SubscriptionPlan)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
              >
                <option value="starter">Starter — 200 MAD/mois (Jusqu'à 4 résidences)</option>
                <option value="professional">Professional — 350 MAD/mois (Jusqu'à 8 résidences)</option>
                <option value="enterprise">Enterprise — 500 MAD/mois (Immeubles illimités)</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Statut du compte :</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as SubscriptionStatus)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="active">Actif</option>
                  <option value="expired">Expiré</option>
                  <option value="cancelled">Suspendu</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Date d'échéance :</label>
                <input
                  type="date"
                  value={editExpiry}
                  onChange={(e) => setEditExpiry(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <div className="font-bold text-slate-800">Immeubles rattachés ({selectedSyndic.buildings.length}) :</div>
              {selectedSyndic.buildings.map((b) => (
                <div key={b.id} className="flex justify-between text-slate-600 font-mono text-[11px]">
                  <span>• {b.name} ({b.city})</span>
                  <span>{b.apartments.length} lots · {b.residents.length} résidents</span>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default AdminDashboard;
