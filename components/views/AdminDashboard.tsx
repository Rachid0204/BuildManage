import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import LanguageToggle from '../common/LanguageToggle';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';
import { useI18n } from '../../hooks/useI18n';
import {
  getSyndics,
  saveSyndic,
  addBuilding,
  STORAGE_KEYS,
  pushKeyToSharedServer,
  remoteMutation,
} from '../../firebase/services';
import { hashPasswordSync, generateSecureRandomDigits } from '../../utils/security';
import { countActiveBuildings } from '../../utils/subscriptionPolicy';
import type { Syndic, SubscriptionPlan, SubscriptionStatus, Apartment } from '../../types';
import { BuildingsIcon, ResidentsIcon, FinancialsIcon, PlusIcon, TrashIcon } from '../icons/IconComponents';

const PLAN_PRICES: Record<SubscriptionPlan, number> = {
  starter: 200,
  professional: 350,
  enterprise: 500,
};

const AdminDashboard: React.FC = () => {
  const { userProfile, logout } = useAuth();
  const { t, tr, language } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedSyndic, setSelectedSyndic] = useState<Syndic | null>(null);
  const [subscriptionReference, setSubscriptionReference] = useState('');
  const [subscriptionMonths, setSubscriptionMonths] = useState(1);
  const [subscriptionMessage, setSubscriptionMessage] = useState('');
  const [editPlan, setEditPlan] = useState<SubscriptionPlan>('professional');
  const [editStatus, setEditStatus] = useState<SubscriptionStatus>('active');
  const [editExpiry, setEditExpiry] = useState('');

  // Create New Syndic Cabinet Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newCabinetName, setNewCabinetName] = useState('');
  const [newManagerName, setNewManagerName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState(() => `Syndik-${generateSecureRandomDigits(6)}!`);
  const [newPhone, setNewPhone] = useState('+212 6 00 00 00 00');
  const [newCity, setNewCity] = useState('Casablanca');
  const [newPlan, setNewPlan] = useState<SubscriptionPlan>('professional');
  const [newBuildingName, setNewBuildingName] = useState('');
  const [newBuildingAddress, setNewBuildingAddress] = useState('');
  const [newApartmentsCount, setNewApartmentsCount] = useState(8);
  const [newMonthlyFees, setNewMonthlyFees] = useState(250);
  const [createError, setCreateError] = useState('');

  const {
    data: syndics = [],
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['syndics'],
    queryFn: getSyndics,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 4000,
  });

  const updateSyndicMutation = useMutation({
    mutationFn: saveSyndic,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setSelectedSyndic(null);
    },
  });

  const createSyndicMutation = useMutation({
    mutationFn: async () => {
      if (newPassword.length < 10) throw new Error(tr('Mot de passe : 10 caractères minimum.', 'كلمة المرور: عشرة أحرف على الأقل.'));
      return remoteMutation<Syndic>('adminCreateCabinet', [{name:newCabinetName.trim(),email:newEmail.trim(),managerName:newManagerName.trim(),password:newPassword,phone:newPhone.trim(),city:newCity.trim(),plan:newPlan,initialBuilding:newBuildingName.trim()?{name:newBuildingName.trim(),address:newBuildingAddress.trim(),apartmentsCount:Number(newApartmentsCount),monthlyFees:Number(newMonthlyFees)}:undefined}]);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setIsCreateModalOpen(false);
      setNewCabinetName('');
      setNewManagerName('');
      setNewEmail('');
      setNewBuildingName('');
      setCreateError('');
    },
    onError: (err: any) => {
      setCreateError(err?.message || 'Erreur lors de la création du cabinet.');
    },
  });

  const totalBuildings = syndics.reduce((acc, s) => acc + countActiveBuildings(s.buildings), 0);
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
    setEditExpiry((syndic.subscriptionExpiry || new Date().toISOString()).split('T')[0]);
  };

  const handleSaveSyndic = async () => {
    if (!selectedSyndic) throw new Error(tr('Sélectionnez un cabinet.', 'حدد مكتباً.'));
    if (!editExpiry || Number.isNaN(Date.parse(editExpiry))) throw new Error(tr('Indiquez une date de fin valide.', 'أدخل تاريخ انتهاء صالحاً.'));
    return updateSyndicMutation.mutateAsync({
      ...selectedSyndic,
      subscriptionPlan: editPlan,
      subscriptionStatus: editStatus,
      subscriptionExpiry: new Date(editExpiry || Date.now()).toISOString(),
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (userProfile && userProfile.role !== 'admin') {
    navigate(getHomeRouteForRole(userProfile.role), { replace: true });
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-100" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <nav className="bg-slate-900 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2.5">
              <span className="text-xl font-bold text-white tracking-tight">Syndik Admin</span>
              <span className="px-2.5 py-0.5 bg-rose-600 text-xs font-bold rounded-full text-white">
                {t('adminPortal.badge')}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs sm:text-sm text-slate-300 font-mono hidden sm:inline">
                {userProfile?.email}
              </span>
              <LanguageToggle variant="dark" />
              <button
                type="button"
                onClick={handleLogout}
                className="text-xs font-bold text-rose-400 hover:text-rose-200 transition-colors"
              >
                {t('header.logout')}
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              {t('adminPortal.title')}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('adminPortal.subtitle')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void refetch()}
              className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs transition-colors flex items-center gap-1.5"
            >
              <span>{isFetching ? '⟳' : '↻'}</span>
              <span>{tr('Actualiser', 'تحديث')}</span>
            </button>
            <Button
              onClick={() => {
                setCreateError('');
                setIsCreateModalOpen(true);
              }}
              leftIcon={<PlusIcon />}
              className="bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs"
            >
              {tr('Nouveau Cabinet Syndic', 'إضافة مكتب سنديك جديد')}
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-teal-700 text-white">
              <ResidentsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {t('adminPortal.activeCabinets')}
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900">{syndics.length}</p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-indigo-600 text-white">
              <BuildingsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {t('adminPortal.managedBuildings')}
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900">{totalBuildings}</p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-emerald-600 text-white">
              <ResidentsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {t('adminPortal.connectedResidents')}
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900">{totalResidents}</p>
            </div>
          </Card>

          <Card className="p-5 border border-slate-200 flex items-center gap-4">
            <div className="p-3 rounded-xl bg-amber-500 text-white">
              <FinancialsIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500">
                {t('adminPortal.estimatedMrr')}
              </p>
              <p className="text-2xl font-bold font-mono text-slate-900">{totalMrr} MAD</p>
            </div>
          </Card>
        </div>

        {/* Registered Syndics Table */}
        <Card className="p-5 border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {t('adminPortal.tableTitle')} ({syndics.length})
              </h2>
              <p className="text-xs text-slate-500">
                {tr(
                  'Synchronisation temps réel des cabinets inscrits via la page Tarifs ou créés par l’administrateur',
                  'مزامنة فورية لمكاتب السنديك المسجلة عبر صفحة الباقات أو المنشأة من طرف المدير'
                )}
              </p>
            </div>
            <span className="text-xs text-slate-500 font-mono">18-00 / 106-12</span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                    {t('adminPortal.colCompany')}
                  </th>
                  <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                    {tr('Contact / Email', 'البريد والهاتف')}
                  </th>
                  <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                    ICE / RC
                  </th>
                  <th className="px-4 py-3 text-center font-bold text-slate-500 uppercase text-xs">
                    {t('adminPortal.colBuildings')}
                  </th>
                  <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                    {t('adminPortal.colPlan')}
                  </th>
                  <th className="px-4 py-3 text-start font-bold text-slate-500 uppercase text-xs">
                    {t('adminPortal.colStatus')}
                  </th>
                  <th className="px-4 py-3 text-end font-bold text-slate-500 uppercase text-xs">
                    {t('adminPortal.colActions')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {syndics.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <div className="font-bold text-slate-900">{s.name}</div>
                      <div className="text-xs text-slate-500">
                        {s.city || tr('Casablanca', 'الدار البيضاء')}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-xs text-slate-600">
                      <div className="font-semibold text-slate-800">{s.email || '—'}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{s.phone || '—'}</div>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap font-mono text-xs text-slate-600">
                      <div>ICE : {s.ice || '001524367000089'}</div>
                      <div className="text-[11px] text-slate-400">RC : {s.rc || '458921'}</div>
                    </td>
                    <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800">
                      {countActiveBuildings(s.buildings)}
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
                        {t(`subscription.plans.${s.subscriptionPlan}` as any)} (
                        {PLAN_PRICES[s.subscriptionPlan]} DH)
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
                        {s.subscriptionStatus === 'active'
                          ? tr('Actif', 'نشط')
                          : s.subscriptionStatus === 'cancelled'
                          ? tr('Suspendu', 'معلق')
                          : tr('Expiré', 'منتهي الصلاحية')}
                      </span>
                      <span className="ms-2 font-mono text-xs text-slate-400">
                        {new Date(s.subscriptionExpiry || Date.now()).toLocaleDateString(
                          language === 'ar' ? 'ar-MA' : 'fr-MA'
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap text-end">
                      <button
                        type="button"
                        onClick={() => handleOpenManage(s)}
                        className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors"
                      >
                        {t('adminPortal.manageBtn')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {syndics.length === 0 && (
            <div className="py-12 px-4 text-center border-t border-slate-100">
              <p className="text-sm font-bold text-slate-800">
                {tr(
                  'Aucun cabinet Syndic enregistré (Mode Production)',
                  'لا يوجد أي مكتب سنديك مسجل حالياً (وضع الإنتاج)'
                )}
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                {tr(
                  "La base de données est vierge de toute donnée de démonstration. Les nouveaux cabinets créés via les offres de la page d'accueil ou via le bouton '+ Nouveau Cabinet Syndic' s'afficheront ici en temps réel.",
                  'قاعدة البيانات خالية من أي بيانات تجريبية. ستظهر مكاتب السنديك الجديدة المسجلة عبر صفحة الباقات أو عبر زر الإضافة هنا فوراً.'
                )}
              </p>
            </div>
          )}
        </Card>
      </main>

      {/* Create New Syndic Cabinet Modal */}
      {isCreateModalOpen && (
        <Modal
          isOpen={isCreateModalOpen}
          onSubmit={async () => {
            if (newCabinetName.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(newEmail.trim())) throw new Error(tr("Renseignez le nom du cabinet et une adresse email valide.", "أدخل اسم المكتب وبريداً إلكترونياً صحيحاً."));
            await createSyndicMutation.mutateAsync();
          }}
          busy={createSyndicMutation.isPending}
          onClose={() => setIsCreateModalOpen(false)}
          title={tr('Créer un Nouveau Cabinet Syndic', 'إنشاء مكتب سنديك جديد')}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                type="submit"
                disabled={createSyndicMutation.isPending}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                {createSyndicMutation.isPending
                  ? tr('Création...', 'جاري الإنشاء...')
                  : tr('Créer le Cabinet Syndic', 'إنشاء مكتب السنديك')}
              </Button>
            </div>
          }
        >
          <div className="space-y-3.5 text-xs">
            {createError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 font-semibold">
                {createError}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Nom du Cabinet Syndic *', 'اسم مكتب السنديك *')}
                </label>
                <input
                  type="text"
                  value={newCabinetName}
                  onChange={(e) => setNewCabinetName(e.target.value)}
                  placeholder="Ex: Atlas Copro Gestion"
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Nom du Gérant / Syndic', 'اسم المسير / السنديك')}
                </label>
                <input
                  type="text"
                  value={newManagerName}
                  onChange={(e) => setNewManagerName(e.target.value)}
                  placeholder="Ex: Karim Tazi"
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Email de connexion *', 'البريد الإلكتروني للدخول *')}
                </label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="contact@atlascopro.ma"
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Mot de passe initial', 'كلمة المرور الأولية')}
                </label>
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Téléphone', 'الهاتف')}
                </label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Ville', 'المدينة')}
                </label>
                <input
                  type="text"
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {tr('Forfait SaaS :', 'باقة الاشتراك SaaS :')}
              </label>
              <select
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value as SubscriptionPlan)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
              >
                <option value="starter">
                  {tr(
                    "Starter — 200 MAD/mois (Jusqu'à 4 résidences)",
                    'مبتدئ (Starter) — 200 درهم/شهر (حتى 4 إقامات)'
                  )}
                </option>
                <option value="professional">
                  {tr(
                    "Professional — 350 MAD/mois (Jusqu'à 8 résidences)",
                    'محترف (Professional) — 350 درهم/شهر (حتى 8 إقامات)'
                  )}
                </option>
                <option value="enterprise">
                  {tr(
                    'Enterprise — 500 MAD/mois (Immeubles illimités)',
                    'مؤسسة (Enterprise) — 500 درهم/شهر (عدد غير محدود من العمارات)'
                  )}
                </option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-200">
              <div className="sm:col-span-1">
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('1ère Résidence', 'الإقامة الأولى')}
                </label>
                <input
                  type="text"
                  value={newBuildingName}
                  onChange={(e) => setNewBuildingName(e.target.value)}
                  placeholder="Résidence Al Amal"
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
              <label className="block text-sm">{tr('Adresse réelle de l’immeuble','العنوان الفعلي للعمارة')}<input className="border rounded p-2 w-full" value={newBuildingAddress} onChange={e=>setNewBuildingAddress(e.target.value)} /></label>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Nombre de lots', 'عدد الشقق')}
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={newApartmentsCount}
                  onChange={(e) => setNewApartmentsCount(Number(e.target.value) || 8)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Cotisation (MAD)', 'واجب السنديك (درهم)')}
                </label>
                <input
                  type="number"
                  min={50}
                  value={newMonthlyFees}
                  onChange={(e) => setNewMonthlyFees(Number(e.target.value) || 250)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Manage Syndic Modal */}
      {selectedSyndic && (
        <Modal
          isOpen={!!selectedSyndic}
          onSubmit={handleSaveSyndic}
          busy={updateSyndicMutation.isPending}
          onClose={() => setSelectedSyndic(null)}
          title={`${tr('Gérer le Cabinet :', 'إدارة المكتب :')} ${selectedSyndic.name}`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelectedSyndic(null)}>
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                type="submit"
                disabled={updateSyndicMutation.isPending}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                {tr('Enregistrer les modifications', 'حفظ التعديلات')}
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {tr('Forfait SaaS :', 'باقة الاشتراك SaaS :')}
              </label>
              <select
                value={editPlan}
                onChange={(e) => setEditPlan(e.target.value as SubscriptionPlan)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
              >
                <option value="starter">
                  {tr(
                    "Starter — 200 MAD/mois (Jusqu'à 4 résidences)",
                    'مبتدئ (Starter) — 200 درهم/شهر (حتى 4 إقامات)'
                  )}
                </option>
                <option value="professional">
                  {tr(
                    "Professional — 350 MAD/mois (Jusqu'à 8 résidences)",
                    'محترف (Professional) — 350 درهم/شهر (حتى 8 إقامات)'
                  )}
                </option>
                <option value="enterprise">
                  {tr(
                    'Enterprise — 500 MAD/mois (Immeubles illimités)',
                    'مؤسسة (Enterprise) — 500 درهم/شهر (عدد غير محدود من العمارات)'
                  )}
                </option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr('Statut du compte :', 'حالة الحساب :')}
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as SubscriptionStatus)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
                >
                  <option value="active">{tr('Actif', 'نشط')}</option>
                  <option value="expired">{tr('Expiré', 'منتهي الصلاحية')}</option>
                  <option value="cancelled">{tr('Suspendu', 'معلق')}</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {tr("Date d'échéance :", 'تاريخ انتهاء الصلاحية :')}
                </label>
                <input
                  type="date"
                  value={editExpiry}
                  onChange={(e) => setEditExpiry(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
              <div className="font-bold text-slate-800">
                {tr(
                  `Immeubles rattachés (${countActiveBuildings(selectedSyndic.buildings)}) :`,
                  `العمارات التابعة (${countActiveBuildings(selectedSyndic.buildings)}) :`
                )}
              </div>
              <fieldset className="border rounded-xl p-3 space-y-2"><legend>{tr('Encaisser l’abonnement plateforme','تسجيل دفع اشتراك المنصة')}</legend><label className="block">{tr('Nombre de mois','عدد الأشهر')}<input className="border rounded p-2 ms-2" type="number" min={1} max={12} value={subscriptionMonths} onChange={e=>setSubscriptionMonths(Number(e.target.value))}/></label><label className="block">{tr('Référence bancaire unique','مرجع بنكي فريد')}<input className="border rounded p-2 w-full" value={subscriptionReference} onChange={e=>setSubscriptionReference(e.target.value)}/></label><p>{PLAN_PRICES[editPlan]*subscriptionMonths} MAD</p><Button onClick={async()=>{try{if (!subscriptionReference.trim()) throw new Error(tr('La référence bancaire est obligatoire.', 'المرجع البنكي مطلوب.'));if (!Number.isInteger(subscriptionMonths) || subscriptionMonths < 1 || subscriptionMonths > 12) throw new Error(tr('Choisissez entre 1 et 12 mois.', 'اختر من شهر إلى 12 شهراً.'));await remoteMutation('recordSubscriptionPayment',[{syndicId:selectedSyndic.id,plan:editPlan,months:subscriptionMonths,reference:subscriptionReference.trim(),amount:PLAN_PRICES[editPlan]*subscriptionMonths}]);setSubscriptionMessage(tr('Abonnement prolongé et paiement enregistré.','تم تمديد الاشتراك وتسجيل الدفع.'));void queryClient.invalidateQueries({queryKey:['syndics']});}catch(e:any){setSubscriptionMessage(e.message);throw e;}}}>{tr('Enregistrer le paiement','تسجيل الدفع')}</Button><p role="status">{subscriptionMessage}</p></fieldset>
              {(selectedSyndic.buildings || []).map((b) => (
                <div key={b.id} className="flex justify-between text-slate-600 font-mono text-[11px]">
                  <span>
                    • {b.name} ({b.city})
                  </span>
                  <span>
                    {b.apartments?.length || 0} {tr('lots', 'شقة')} · {b.residents?.length || 0}{' '}
                    {tr('résidents', 'ساكن')}
                  </span>
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
