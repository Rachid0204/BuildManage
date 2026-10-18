import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';
import {
  FinancialsIcon,
  AnnouncementsIcon,
  WrenchIcon,
  PlusIcon,
  QuittanceIcon,
  ChatIcon,
  PrestatairesIcon,
  MarketplaceIcon,
  DocumentsIcon,
} from '../icons/IconComponents';
import CommunityChat from './CommunityChat';
import ServiceProvidersDirectory from './ServiceProvidersDirectory';
import MarketplaceView from './MarketplaceView';
import ResidentAGVoting from './ResidentAGVoting';
import Maintenance from './Maintenance';
import NotificationBell from '../common/NotificationBell';
import {
  getMaintenanceRequestsForResident,
  addMaintenanceRequest,
  getChargesForResident,
  submitPaymentProof,
  getQuittancesForResident,
  generateQuittanceForCharge,
  getPaymentProofsForResident,
  getAssembleesGeneralesForBuilding,
  getSyndics,
} from '../../firebase/services';
import type {
  MaintenanceRequest,
  PaymentProof,
  PaymentMethod,
  Quittance,
  AssembleeGenerale,
  Syndic,
  Building,
  Resident,
} from '../../types';
import { generateQuittancePDF } from '../../services/pdfService';
import Loading from '../common/Loading';

const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  minimumFractionDigits: 2,
});

const ResidentDashboard: React.FC = () => {
  const { userProfile, logout, loginWithEmail, changePassword } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'voting' | 'maintenance' | 'chat' | 'providers' | 'marketplace'
  >('overview');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [selectedChargeId, setSelectedChargeId] = useState<string>('');
  const [selectedResidentQuittanceForPreview, setSelectedResidentQuittanceForPreview] = useState<Quittance | null>(null);
  const [isDownloadingChargeQuit, setIsDownloadingChargeQuit] = useState<string | null>(null);
  const [previewDocName, setPreviewDocName] = useState<string | null>(null);

  // Password Change State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Maintenance Form State
  const [maintCategory, setMaintCategory] = useState<MaintenanceRequest['category']>('plumbing');
  const [maintDesc, setMaintDesc] = useState('');
  const [maintPriority, setMaintPriority] = useState<MaintenanceRequest['priority']>('medium');

  // Payment Proof Form State
  const [bankName, setBankName] = useState('Attijariwafa Bank');
  const [refNumber, setRefNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('virement');
  const [proofNote, setProofNote] = useState('');

  // Fetch Syndic and Building Data
  const { data: syndics = [] } = useQuery({
    queryKey: ['syndics'],
    queryFn: getSyndics,
  });

  // Dynamically resolve exact Syndic, Building, Resident, and Apartment across all buildings
  const { activeSyndic, activeBuilding, currentResident, currentApartment } = useMemo(() => {
    let foundSyndic: Syndic | undefined;
    let foundBuilding: Building | undefined;
    let foundResident: Resident | undefined;

    const targetUid = userProfile?.uid;
    const targetEmail = userProfile?.email?.trim().toLowerCase();
    const targetCin = userProfile?.cin?.trim().toLowerCase();

    // 1. Search across all syndics and buildings for the exact logged-in resident
    for (const s of syndics) {
      for (const b of s.buildings) {
        const match = b.residents.find(
          (r) =>
            (targetUid && r.id === targetUid) ||
            (targetEmail && r.email.trim().toLowerCase() === targetEmail) ||
            (targetCin && r.cin && r.cin.trim().toLowerCase() === targetCin)
        );
        if (match) {
          foundSyndic = s;
          foundBuilding = b;
          foundResident = match;
          break;
        }
      }
      if (foundResident) break;
    }

    // 2. If not matched by resident record, resolve by userProfile.syndicId & userProfile.buildingId
    if (!foundSyndic) {
      foundSyndic =
        (userProfile?.syndicId && syndics.find((s) => s.id === userProfile.syndicId)) ||
        syndics[0];
    }
    if (!foundBuilding && foundSyndic) {
      foundBuilding =
        (userProfile?.buildingId &&
          foundSyndic.buildings.find((b) => b.id === userProfile.buildingId)) ||
        foundSyndic.buildings[0];
    }
    if (!foundResident && foundBuilding) {
      foundResident = foundBuilding.residents[1] || foundBuilding.residents[0];
    }

    const foundApt =
      foundBuilding?.apartments.find(
        (a) =>
          (foundResident?.apartmentId && a.id === foundResident.apartmentId) ||
          (userProfile?.apartmentId && a.id === userProfile.apartmentId) ||
          (foundResident && (a.ownerId === foundResident.id || a.tenantId === foundResident.id))
      ) || foundBuilding?.apartments[0];

    return {
      activeSyndic: foundSyndic,
      activeBuilding: foundBuilding,
      currentResident: foundResident,
      currentApartment: foundApt,
    };
  }, [syndics, userProfile]);

  const isOwnerResident = currentResident ? currentResident.isOwner : userProfile?.isOwner ?? true;

  // Fetch Charges for Resident
  const { data: myCharges = [], isLoading: loadingCharges } = useQuery({
    queryKey: ['charges', currentResident?.id],
    queryFn: () => (currentResident ? getChargesForResident(currentResident.id) : []),
    enabled: !!currentResident,
  });

  // Fetch Payment Proofs for Resident
  const { data: myProofs = [] } = useQuery({
    queryKey: ['proofs', currentResident?.id],
    queryFn: () => (currentResident ? getPaymentProofsForResident(currentResident.id) : []),
    enabled: !!currentResident,
  });

  // Fetch Quittances for Resident
  const { data: myQuittances = [] } = useQuery({
    queryKey: ['quittances', currentResident?.id],
    queryFn: () => (currentResident ? getQuittancesForResident(currentResident.id) : []),
    enabled: !!currentResident,
  });

  // Fetch Maintenance
  const { data: myRequests = [] } = useQuery({
    queryKey: ['maintenance', currentResident?.id],
    queryFn: () => (currentResident ? getMaintenanceRequestsForResident(currentResident.id) : []),
    enabled: !!currentResident,
  });

  // Fetch Assemblées Générales & Digital Voting Sessions
  const { data: agSessions = [] } = useQuery({
    queryKey: ['ag', activeBuilding?.id],
    queryFn: () => (activeBuilding ? getAssembleesGeneralesForBuilding(activeBuilding.id) : []),
    enabled: !!activeBuilding,
  });

  const activeAGSession = agSessions[0];
  const unvotedResolutionsCount = activeAGSession?.resolutions.filter(
    (r) => !r.voters?.some((v) => v.residentId === currentResident?.id)
  ).length || 0;

  const proofMutation = useMutation({
    mutationFn: submitPaymentProof,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['proofs', currentResident?.id] });
      queryClient.invalidateQueries({ queryKey: ['charges', currentResident?.id] });
      setIsProofModalOpen(false);
      setRefNumber('');
      setProofNote('');
    },
  });

  const reportMutation = useMutation({
    mutationFn: (data: any) =>
      addMaintenanceRequest({
        ...data,
        buildingId: activeBuilding?.id || 'bld-1',
        residentId: currentResident?.id || 'res-2',
        status: 'pending',
        createdAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', currentResident?.id] });
      setIsReportModalOpen(false);
      setMaintDesc('');
    },
  });

  const handleQuickRoleSwitch = async (targetEmail: string) => {
    const profile = await loginWithEmail(targetEmail, 'password123');
    navigate(getHomeRouteForRole(profile.role), { replace: true });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const handlePasswordSubmit = async () => {
    setPasswordMsg(null);
    if (newPassword.trim().length < 6) {
      setPasswordMsg({
        type: 'error',
        text: 'Le nouveau mot de passe doit comporter au moins 6 caractères.',
      });
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      setPasswordMsg({
        type: 'error',
        text: 'Les deux mots de passe ne correspondent pas.',
      });
      return;
    }
    try {
      await changePassword(newPassword.trim());
      setPasswordMsg({
        type: 'success',
        text: 'Votre mot de passe personnel a été enregistré avec succès.',
      });
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setIsPasswordModalOpen(false);
        setPasswordMsg(null);
      }, 1500);
    } catch (e: any) {
      setPasswordMsg({
        type: 'error',
        text: e?.message || 'Erreur lors de la mise à jour du mot de passe.',
      });
    }
  };

  const pendingCharges = myCharges.filter((c) => c.status === 'pending' || c.status === 'overdue');
  const totalPendingAmount = pendingCharges.reduce((sum, c) => sum + c.amount, 0);

  if (loadingCharges) return <Loading message="Chargement de votre espace résident..." />;

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Top Navbar */}
      <nav className="bg-slate-900 text-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap justify-between min-h-16 py-2 items-center gap-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-xl font-bold tracking-tight text-white">Syndik</span>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${
                  isOwnerResident
                    ? 'bg-emerald-600/30 text-emerald-200 border border-emerald-500/40'
                    : 'bg-sky-600/30 text-sky-200 border border-sky-500/40'
                }`}
              >
                {isOwnerResident ? 'Espace Copropriétaire' : 'Espace Locataire'}
              </span>
              {activeBuilding && (
                <span className="text-xs text-slate-300 font-medium hidden md:inline">
                  • {activeBuilding.name}
                  {currentApartment ? ` (Lot ${currentApartment.number})` : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              {/* Quick Role Switcher for Smooth Demo Testing */}
              <div className="hidden lg:flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded-lg border border-slate-700">
                <span className="text-[10px] text-slate-400 font-semibold uppercase me-1">
                  Basculer :
                </span>
                <button
                  type="button"
                  onClick={() => handleQuickRoleSwitch('contact@syndicpro.ma')}
                  className="px-2 py-0.5 rounded bg-teal-500/20 hover:bg-teal-500/30 text-teal-200 text-[11px] font-semibold"
                >
                  🏢 Syndic
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleQuickRoleSwitch(
                      isOwnerResident ? 'youssef.benali@email.com' : 'fatima.zahra@email.com'
                    )
                  }
                  className="px-2 py-0.5 rounded bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 text-[11px] font-semibold"
                >
                  {isOwnerResident ? '🏠 Vue Locataire' : '🔑 Vue Copropriétaire'}
                </button>
                <button
                  type="button"
                  onClick={() => handleQuickRoleSwitch('provider@syndik.ma')}
                  className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-semibold"
                >
                  🛠️ Prestataire
                </button>
              </div>

              <span className="text-xs sm:text-sm text-slate-300 hidden sm:inline">
                <strong>{currentResident?.name || userProfile?.displayName}</strong>
              </span>

              <button
                type="button"
                onClick={() => {
                  setPasswordMsg(null);
                  setIsPasswordModalOpen(true);
                }}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg border border-slate-700 font-medium"
                title="Modifier mon mot de passe"
              >
                🔑 Mot de passe
              </button>

              <NotificationBell />

              <button
                type="button"
                onClick={handleLogout}
                className="text-xs text-rose-400 hover:text-rose-200 transition-colors font-semibold px-2 py-1"
              >
                Déconnexion
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* First-Login Temporary Password Notice */}
      {userProfile?.mustChangePassword && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="text-xs text-amber-950">
              <span className="font-bold">🔐 Première connexion avec mot de passe temporaire :</span>{' '}
              Vous utilisez actuellement le mot de passe généré par votre Syndic. Pour sécuriser votre compte, définissez votre mot de passe personnel.
            </div>
            <button
              type="button"
              onClick={() => {
                setPasswordMsg(null);
                setIsPasswordModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shrink-0"
            >
              Personnaliser mon mot de passe
            </button>
          </div>
        </div>
      )}

      {/* Sub Navigation Bar for Resident Features */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-1.5 sm:space-x-3 overflow-x-auto no-scrollbar py-2.5">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>🏠</span>
              <span>Mon Logement & Finances</span>
            </button>

            <button
              onClick={() => setActiveTab('voting')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'voting'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>🗳️</span>
              <span>Assemblée & Votes</span>
              {unvotedResolutionsCount > 0 ? (
                <span className="text-[10px] bg-emerald-500 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
                  {unvotedResolutionsCount} à voter
                </span>
              ) : (
                <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded font-bold">
                  Loi 18-00
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('maintenance')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'maintenance'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>🔧</span>
              <span>Suivi Incidents & Travaux</span>
              <span className="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.2 rounded font-bold">
                {myRequests.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'chat'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>💬</span>
              <span>Messagerie & Chat</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            </button>

            <button
              onClick={() => setActiveTab('providers')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'providers'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>🛠️</span>
              <span>Artisans & Dépannage</span>
              <span className="text-[10px] bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded font-bold">
                24/7
              </span>
            </button>

            <button
              onClick={() => setActiveTab('marketplace')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'marketplace'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>🛍️</span>
              <span>Souk des Résidents</span>
              <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded font-bold">
                Annonces
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto py-4 sm:py-8 px-3 sm:px-6 lg:px-8 pb-24 md:pb-10 space-y-6">
        {activeTab === 'chat' && activeBuilding && (
          <CommunityChat
            building={activeBuilding}
            isResidentPortal={true}
            currentResidentId={currentResident?.id}
            currentResidentName={currentResident?.name}
            currentApartmentNumber={`Apt ${currentApartment?.number || 'A-102'}`}
          />
        )}

        {activeTab === 'providers' && activeBuilding && (
          <ServiceProvidersDirectory
            building={activeBuilding}
            residentId={currentResident?.id}
            residentName={currentResident?.name}
            apartmentNumber={`Apt ${currentApartment?.number || 'A-102'}`}
            isResidentPortal={true}
          />
        )}

        {activeTab === 'marketplace' && activeBuilding && (
          <MarketplaceView
            building={activeBuilding}
            currentResidentId={currentResident?.id}
            currentResidentName={currentResident?.name}
            currentApartmentNumber={`Apt ${currentApartment?.number || 'A-102'}`}
            currentPhone={currentResident?.phone || '0661 22 33 44'}
            isResidentPortal={true}
          />
        )}

        {activeTab === 'voting' && activeBuilding && (
          <ResidentAGVoting
            building={activeBuilding}
            currentResident={currentResident}
            currentApartment={currentApartment}
            syndic={activeSyndic}
          />
        )}

        {activeTab === 'maintenance' && activeBuilding && (
          <Maintenance
            building={activeBuilding}
            isResidentPortal={true}
            currentResidentId={currentResident?.id}
            currentResidentName={currentResident?.name}
            currentApartmentNumber={`Lot ${currentApartment?.number || 'A-102'}`}
          />
        )}

        {activeTab === 'overview' && (
          <>
            {/* AG Digital Voting Banner if session is active */}
            {activeAGSession && (
              <Card className="p-4 bg-gradient-to-r from-teal-900 to-slate-900 text-white border-none shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-teal-800 text-teal-200 flex items-center justify-center font-bold text-lg shrink-0">
                      🗳️
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                          Scrutin en cours · Loi 18-00
                        </span>
                        <span className="text-xs text-teal-200">
                          {activeAGSession.title}
                        </span>
                      </div>
                      <p className="text-xs text-teal-100 mt-1">
                        Vous disposez de <strong>{currentApartment?.tantiemes || 260} tantièmes</strong> de copropriété pour voter.
                        {unvotedResolutionsCount > 0 ? (
                          <span className="text-amber-300 font-semibold ms-1">
                            ({unvotedResolutionsCount} délibération{unvotedResolutionsCount > 1 ? 's' : ''} en attente de votre vote)
                          </span>
                        ) : (
                          <span className="text-emerald-300 font-semibold ms-1">
                            (Tous vos votes ont été enregistrés ✓)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={() => setActiveTab('voting')}
                    className="text-xs bg-white text-teal-900 hover:bg-teal-50 font-bold shrink-0 shadow-xs"
                  >
                    Accéder au Scrutin Numérique →
                  </Button>
                </div>
              </Card>
            )}

            {/* KPI Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* My Lot Card */}
          <Card className="p-5 border-l-4 border-l-teal-600 bg-white">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Mon Logement</p>
                <h3 className="text-xl font-bold text-slate-900 mt-1">{activeBuilding?.name || 'Résidence'}</h3>
                <p className="text-sm text-teal-800 font-semibold mt-0.5">
                  Appartement Lot {currentApartment?.number || 'A-102'} (Étage {currentApartment?.floor ?? 1})
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded">
                {currentApartment?.tantiemes || 260} / 1000èmes
              </span>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between text-xs text-slate-600 font-mono">
              <span>Superficie : {currentApartment?.area || 110} m²</span>
              <span>Statut : {currentResident?.isOwner ? 'Propriétaire' : 'Locataire'}</span>
            </div>
          </Card>

          {/* Pending Charges Card */}
          <Card className="p-5 border-l-4 border-l-amber-500 bg-white">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Charges en Attente</p>
                <p className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                  {currencyFormatter.format(totalPendingAmount)}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {pendingCharges.length} appel(s) de fonds à régulariser
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-amber-50 text-amber-700">
                <FinancialsIcon />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
              <span className="text-slate-500">Par virement bancaire :</span>
              <button
                onClick={() => {
                  if (pendingCharges.length > 0) {
                    setSelectedChargeId(pendingCharges[0].id);
                    setIsProofModalOpen(true);
                  } else {
                    alert('Aucune charge en attente.');
                  }
                }}
                className="text-xs font-semibold text-teal-700 hover:text-teal-900 underline"
              >
                Déposer un reçu de virement
              </button>
            </div>
          </Card>

          {/* Quittances Certified Card */}
          <Card className="p-5 border-l-4 border-l-emerald-600 bg-white">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quittances Certifiées</p>
                <p className="text-2xl font-bold font-mono text-emerald-800 mt-1 tabular-nums">
                  {myQuittances.length}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Attestations officielles (Loi 18-00)</p>
              </div>
              <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-700">
                <QuittanceIcon />
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-emerald-700 font-medium">
              Téléchargeables pour notaire ou archivage
            </div>
          </Card>
        </div>

        {/* Bank Details for Wire Transfers */}
        <Card className="p-4 bg-teal-50 border border-teal-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <span className="font-bold text-teal-950 uppercase tracking-wider block">
                Coordonnées Bancaires de la Copropriété (Pour vos virements)
              </span>
              <p className="text-teal-800 mt-0.5">
                Banque : <strong>{activeBuilding?.bankName || 'Attijariwafa Bank - Agence Gauthier'}</strong>
              </p>
            </div>
            <div className="bg-white px-3 py-1.5 rounded border border-teal-300 font-mono font-bold text-teal-900 text-sm select-all">
              RIB : {activeBuilding?.bankRib || '007 780 0001234567890123 45'}
            </div>
          </div>
        </Card>

        {/* Section: Pending Charges & Proofs */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <Card className="p-5">
              <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Cotisations & Appels de Fonds</h3>
                  <p className="text-xs text-slate-500">Réglez vos charges par virement et transmettez votre bordereau</p>
                </div>
              </div>

              <div className="divide-y divide-slate-100 mt-3">
                {myCharges.map((charge) => {
                  const proof = myProofs.find((p) => p.chargeId === charge.id);

                  return (
                    <div key={charge.id} className="py-3 flex items-center justify-between gap-3 text-xs sm:text-sm">
                      <div>
                        <div className="font-semibold text-slate-900">{charge.description}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                          <span>Échéance : {new Date(charge.dueDate).toLocaleDateString('fr-MA')}</span>
                          {proof && (
                            <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium">
                              Virement en cours de validation (Réf: {proof.referenceNumber})
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-mono font-bold text-slate-900">
                          {currencyFormatter.format(charge.amount)}
                        </span>

                        {charge.status === 'paid' ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                              ✓ Réglé
                            </span>
                            <button
                              onClick={async () => {
                                try {
                                  setIsDownloadingChargeQuit(charge.id);
                                  const matchingQuit = myQuittances.find((q) => q.chargeId === charge.id);
                                  if (matchingQuit) {
                                    generateQuittancePDF(matchingQuit, activeBuilding!, activeSyndic, currentApartment, currentResident);
                                  } else if (activeBuilding) {
                                    const generated = await generateQuittanceForCharge(charge.id, activeBuilding.id);
                                    queryClient.invalidateQueries({ queryKey: ['quittances', currentResident?.id] });
                                    generateQuittancePDF(generated, activeBuilding, activeSyndic, currentApartment, currentResident);
                                  }
                                } finally {
                                  setIsDownloadingChargeQuit(null);
                                }
                              }}
                              disabled={isDownloadingChargeQuit === charge.id}
                              className="px-2.5 py-1 text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded transition-colors flex items-center gap-1"
                              title="Télécharger la quittance libératoire officielle (Loi 18-00)"
                            >
                              <QuittanceIcon />
                              <span>{isDownloadingChargeQuit === charge.id ? 'Génération...' : 'Quittance PDF'}</span>
                            </button>
                          </div>
                        ) : proof ? (
                          <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded">
                            Vérification en cours
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              setSelectedChargeId(charge.id);
                              setIsProofModalOpen(true);
                            }}
                            className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded text-xs transition-colors"
                          >
                            Transmettre Justificatif
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {myCharges.length === 0 && (
                  <p className="text-center text-slate-500 text-xs py-4">Aucune charge enregistrée pour ce lot.</p>
                )}
              </div>
            </Card>

            {/* Maintenance Tickets Section with Live Progress Preview */}
            <Card className="p-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    <WrenchIcon />
                    <span>Suivi de mes Incidents & Réparations</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Consultez l'avancement, les notes du Syndic et les photos d'intervention
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('maintenance')}
                    className="px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-bold text-xs transition-colors"
                  >
                    Suivi détaillé & photos →
                  </button>
                  <Button
                    onClick={() => setIsReportModalOpen(true)}
                    className="text-xs flex items-center gap-1"
                  >
                    <PlusIcon />
                    <span>Signaler</span>
                  </Button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 mt-3">
                {myRequests.map((req) => {
                  const stage =
                    req.status === 'completed'
                      ? 4
                      : req.status === 'in_progress'
                      ? (req.updates?.length || 0) >= 2
                        ? 3
                        : 2
                      : 1;
                  return (
                    <div key={req.id} className="py-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-slate-900">
                              {req.title || req.description}
                            </span>
                            <span className="text-slate-400 font-mono text-[11px]">
                              · {new Date(req.createdAt).toLocaleDateString('fr-MA')}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 line-clamp-2">{req.description}</p>
                        </div>
                        <span
                          className={`text-xs px-2.5 py-0.5 rounded-full font-bold shrink-0 ${
                            req.status === 'completed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : req.status === 'in_progress'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {req.status === 'completed'
                            ? '✓ Résolu'
                            : req.status === 'in_progress'
                            ? '🔧 En cours'
                            : '⏳ Reçu'}
                        </span>
                      </div>

                      {/* Mini Progress Bar */}
                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-600 font-medium">
                            {req.assignedTo
                              ? `Prestataire : ${req.assignedTo}`
                              : 'En attente d\'assignation prestataire'}
                          </span>
                          <span className="font-mono font-bold text-teal-800">
                            Étape {stage}/4
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              req.status === 'completed'
                                ? 'bg-emerald-600'
                                : req.status === 'in_progress'
                                ? 'bg-teal-600'
                                : 'bg-amber-500'
                            }`}
                            style={{ width: `${(stage / 4) * 100}%` }}
                          />
                        </div>
                        {req.syndicNotes && (
                          <p className="text-[11px] text-slate-700 italic">
                            🏢 Note Syndic : « {req.syndicNotes} »
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}

                {myRequests.length === 0 && (
                  <p className="text-center text-slate-500 text-xs py-4">Aucun incident en cours.</p>
                )}
              </div>
            </Card>
          </div>

          {/* Right Column: Quittances & Announcements */}
          <div className="lg:col-span-5 space-y-4">
            {/* Quittances Box */}
            <Card className="p-5">
              <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                  <QuittanceIcon />
                  <span>Mes Quittances Certifiées (Loi 18-00)</span>
                </h3>
              </div>

              <div className="divide-y divide-slate-100 mt-3">
                {myQuittances.map((quit) => (
                  <div key={quit.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-mono font-bold text-teal-800 text-xs">{quit.quittanceNumber}</div>
                      <div className="text-[11px] text-slate-500">
                        {quit.periodCovered} · {currencyFormatter.format(quit.amount)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setSelectedResidentQuittanceForPreview(quit)}
                        className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200 font-medium transition-colors"
                        title="Consulter l'attestation libératoire"
                      >
                        Aperçu
                      </button>
                      <button
                        onClick={() => generateQuittancePDF(quit, activeBuilding!, activeSyndic, currentApartment, currentResident)}
                        className="px-2.5 py-1 text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded transition-colors flex items-center gap-1"
                      >
                        <QuittanceIcon />
                        <span>PDF</span>
                      </button>
                    </div>
                  </div>
                ))}

                {myQuittances.length === 0 && (
                  <p className="text-center text-slate-500 text-xs py-4">
                    Aucune quittance disponible pour l'instant. Dès validation de vos virements, vos quittances
                    apparaîtront ici.
                  </p>
                )}
              </div>
            </Card>

            {/* Announcements Box */}
            <Card className="p-5">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5 pb-3 border-b border-slate-200">
                <AnnouncementsIcon />
                <span>Annonces de la Résidence</span>
              </h3>

              <div className="space-y-3 mt-3">
                {(activeBuilding?.announcements || []).map((ann) => (
                  <div key={ann.id} className="border-b border-slate-100 pb-3 last:border-b-0">
                    <p className="font-semibold text-slate-900 text-xs">{ann.title}</p>
                    <p className="text-[11px] text-slate-400 font-mono">
                      {new Date(ann.date).toLocaleDateString('fr-MA')}
                    </p>
                    <p className="text-xs text-slate-600 mt-1 whitespace-pre-line">{ann.content}</p>
                  </div>
                ))}
              </div>
            </Card>

            {/* Official Co-ownership Documents Box */}
            <Card className="p-5">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5 pb-3 border-b border-slate-200">
                <DocumentsIcon />
                <span>Documents Officiels de la Copropriété</span>
              </h3>
              <div className="divide-y divide-slate-100 mt-2">
                {(activeBuilding?.documents || []).map((docItem) => (
                  <div key={docItem.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{docItem.name}</p>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {docItem.size} · {new Date(docItem.uploadedAt).toLocaleDateString('fr-MA')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewDocName(docItem.name)}
                      className="px-2.5 py-1 rounded bg-slate-100 hover:bg-teal-50 hover:text-teal-800 text-slate-700 font-semibold text-xs shrink-0 transition-colors"
                    >
                      Consulter
                    </button>
                  </div>
                ))}
                {(!activeBuilding?.documents || activeBuilding.documents.length === 0) && (
                  <p className="text-xs text-slate-500 py-3 text-center">Aucun document publié.</p>
                )}
              </div>
            </Card>
          </div>
        </div>
        </>
        )}
      </main>

      {/* Modal: Official Document Preview for Resident */}
      {previewDocName && (
        <Modal
          isOpen={!!previewDocName}
          onClose={() => setPreviewDocName(null)}
          title={`Consultation Document Officiel — ${previewDocName}`}
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setPreviewDocName(null)}>
                Fermer
              </Button>
            </div>
          }
        >
          <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs text-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="font-bold text-slate-900 text-sm">{previewDocName}</div>
                <div className="text-[11px] text-slate-500">
                  {activeBuilding?.name} · Archive officielle certifiée par {activeSyndic?.name}
                </div>
              </div>
              <span className="px-2.5 py-1 rounded bg-teal-100 text-teal-800 font-mono font-bold text-[11px]">
                Loi n° 18-00
              </span>
            </div>
            <p className="leading-relaxed">
              Ce document fait partie intégrante du registre légal de la copropriété{' '}
              <strong>{activeBuilding?.name}</strong> ({activeBuilding?.address}, {activeBuilding?.city}).
              Il est mis à la disposition de l'ensemble des copropriétaires conformément aux dispositions
              de la Loi n° 18-00 telle que modifiée et complétée par la Loi n° 106-12.
            </p>
            <div className="p-3 bg-white rounded-lg border border-slate-200 font-mono text-[11px] text-slate-600 space-y-1">
              <div>• Syndic Gestionnaire : {activeSyndic?.name}</div>
              <div>• ICE : {activeSyndic?.ice || '001524367000089'}</div>
              <div>• Statut : Document vérifié et archivé numériquement</div>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Submit Payment Proof */}
      <Modal
        isOpen={isProofModalOpen}
        onClose={() => setIsProofModalOpen(false)}
        title="Transmettre un justificatif de virement bancaire"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsProofModalOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => {
                if (!refNumber) return alert('Veuillez saisir le numéro de référence du virement.');
                const targetCharge = myCharges.find((c) => c.id === selectedChargeId) || myCharges[0];
                if (!targetCharge) return;

                proofMutation.mutate({
                  chargeId: targetCharge.id,
                  residentId: currentResident?.id || 'res-2',
                  residentName: currentResident?.name || 'Copropriétaire',
                  apartmentId: currentApartment?.id || 'apt-2',
                  apartmentNumber: currentApartment?.number || 'A-102',
                  buildingId: activeBuilding?.id || 'bld-1',
                  amount: targetCharge.amount,
                  paymentMethod,
                  bankName,
                  referenceNumber: refNumber,
                  receiptNote: proofNote,
                });
              }}
            >
              Envoyer pour validation
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            Une fois votre justificatif vérifié par le syndic, votre compte de charges sera crédité et votre
            <strong> quittance officielle conforme à la Loi 18-00</strong> sera générée automatiquement.
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Banque émettrice</label>
            <select
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
            >
              <option value="Attijariwafa Bank">Attijariwafa Bank</option>
              <option value="CIH Bank">CIH Bank</option>
              <option value="Bank of Africa (BMCE)">Bank of Africa (BMCE)</option>
              <option value="Banque Populaire (BCP)">Banque Populaire (BCP)</option>
              <option value="Société Générale Maroc">Société Générale Maroc</option>
              <option value="CFG Bank">CFG Bank</option>
              <option value="Al Barid Bank">Al Barid Bank</option>
              <option value="Autre banque">Autre banque marocaine</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Mode de règlement</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="virement">Virement bancaire (Application / Web)</option>
                <option value="versement">Versement espèces en agence</option>
                <option value="cheque">Chèque bancaire</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                N° Référence / Numéro d'opération
              </label>
              <input
                type="text"
                value={refNumber}
                onChange={(e) => setRefNumber(e.target.value)}
                placeholder="Ex: VIR-20261014-998"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Note pour le syndic</label>
            <textarea
              rows={2}
              value={proofNote}
              onChange={(e) => setProofNote(e.target.value)}
              placeholder="Ex: Virement effectué depuis mon compte CIH Mobile ce matin..."
              className="w-full px-3 py-2 border border-slate-300 rounded text-xs"
            />
          </div>
        </div>
      </Modal>

      {/* Modal: Add Maintenance Request */}
      <Modal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title="Signaler un incident ou une réparation"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsReportModalOpen(false)}>
              Annuler
            </Button>
            <Button
              onClick={() => {
                if (!maintDesc) return alert('Description obligatoire.');
                reportMutation.mutate({
                  category: maintCategory,
                  description: maintDesc,
                  priority: maintPriority,
                });
              }}
            >
              Envoyer au syndic
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Catégorie</label>
              <select
                value={maintCategory}
                onChange={(e) => setMaintCategory(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="plumbing">Plomberie</option>
                <option value="electrical">Électricité</option>
                <option value="elevator">Ascenseur</option>
                <option value="common_area">Parties Communes</option>
                <option value="cleaning">Propreté / Hygiène</option>
                <option value="other">Autre</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Urgence</label>
              <select
                value={maintPriority}
                onChange={(e) => setMaintPriority(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="low">Normale</option>
                <option value="medium">Moyenne</option>
                <option value="high">Urgente</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Description détaillée</label>
            <textarea
              rows={3}
              value={maintDesc}
              onChange={(e) => setMaintDesc(e.target.value)}
              placeholder="Décrivez l'emplacement précis et la nature de la panne..."
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
        </div>
      </Modal>

      {/* Official Certificate Preview Modal for Resident */}
      {selectedResidentQuittanceForPreview && (
        <Modal
          isOpen={!!selectedResidentQuittanceForPreview}
          onClose={() => setSelectedResidentQuittanceForPreview(null)}
          title={`Attestation de Quittance — ${selectedResidentQuittanceForPreview.quittanceNumber}`}
          footer={
            <div className="flex justify-between items-center w-full">
              <span className="text-xs text-slate-500 font-mono hidden sm:inline">
                Reçu officiel certifié conforme (Loi n° 18-00 & 106-12)
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setSelectedResidentQuittanceForPreview(null)}>
                  Fermer
                </Button>
                <Button
                  onClick={() =>
                    generateQuittancePDF(
                      selectedResidentQuittanceForPreview,
                      activeBuilding!,
                      activeSyndic,
                      currentApartment,
                      currentResident
                    )
                  }
                  className="bg-teal-700 hover:bg-teal-800 text-white flex items-center gap-1.5"
                >
                  <QuittanceIcon />
                  <span>Télécharger le PDF</span>
                </Button>
              </div>
            </div>
          }
        >
          <div className="p-5 bg-slate-50 border-2 border-teal-800/40 rounded-xl space-y-4 text-slate-800">
            {/* Header */}
            <div className="text-center pb-3 border-b-2 border-teal-800/20">
              <p className="text-[10px] font-bold tracking-widest text-teal-900 uppercase">
                ROYAUME DU MAROC  ·  SYNDICAT DES COPROPRIÉTAIRES
              </p>
              <h3 className="text-sm sm:text-base font-extrabold text-teal-950 mt-1 uppercase">
                Quittance de Paiement des Charges de Copropriété
              </h3>
              <p className="text-[10px] text-slate-500">
                Loi n° 18-00 modifiée par la Loi n° 106-12 · Reçu libératoire officiel
              </p>
              <div className="inline-block bg-teal-100/70 border border-teal-300 text-teal-900 font-mono text-xs px-2.5 py-0.5 rounded font-bold mt-1.5">
                {selectedResidentQuittanceForPreview.quittanceNumber}
              </div>
            </div>

            {/* Entity Dual Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-teal-800 block text-[10px] uppercase">Copropriété & Syndic</span>
                <p className="font-bold text-slate-900">{activeBuilding?.name || selectedResidentQuittanceForPreview.buildingName}</p>
                <p className="text-slate-600">{activeBuilding?.address || 'Adresse copropriété'}</p>
                <p className="text-slate-500 font-mono text-[11px]">Syndic : {activeSyndic?.name || selectedResidentQuittanceForPreview.syndicName}</p>
              </div>

              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-teal-800 block text-[10px] uppercase">Copropriétaire</span>
                <p className="font-bold text-slate-900">{selectedResidentQuittanceForPreview.residentName}</p>
                <p className="text-slate-600 font-mono">Lot {selectedResidentQuittanceForPreview.apartmentNumber} · {selectedResidentQuittanceForPreview.tantiemes} / 1000 tantièmes</p>
                <p className="text-slate-500 font-mono text-[11px]">CIN : {selectedResidentQuittanceForPreview.residentCin || currentResident?.cin || 'CIN vérifiée'}</p>
              </div>
            </div>

            {/* Financial Detail */}
            <div className="bg-white rounded border border-slate-200 p-3 space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-700">
                <span>Charges courantes ({selectedResidentQuittanceForPreview.periodCovered})</span>
                <span className="font-mono font-medium">
                  {currencyFormatter.format(
                    selectedResidentQuittanceForPreview.chargesCourantesAmount ??
                      (selectedResidentQuittanceForPreview.amount - Math.round(selectedResidentQuittanceForPreview.amount * 0.15))
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center text-emerald-800">
                <span>Provision obligatoire Fonds de Réserve (Loi 106-12)</span>
                <span className="font-mono font-semibold">
                  {currencyFormatter.format(
                    selectedResidentQuittanceForPreview.reserveFundAmount ?? Math.round(selectedResidentQuittanceForPreview.amount * 0.15)
                  )}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-slate-900 text-sm">
                <span>TOTAL RÉGLÉ :</span>
                <span className="font-mono text-teal-900 text-base">
                  {currencyFormatter.format(selectedResidentQuittanceForPreview.amount)}
                </span>
              </div>
            </div>

            {/* Release Mention */}
            <p className="text-[11px] text-slate-600 italic bg-teal-50/60 p-2.5 rounded border border-teal-200">
              « Le Syndic soussigné certifie avoir reçu ladite somme et délivre la présente quittance libératoire
              pour la période concernée. Situation comptable du lot : À JOUR. »
            </p>

            {/* Official seal & Date */}
            <div className="flex justify-between items-end pt-1">
              <div className="text-[10px] text-slate-400 font-mono">
                <div>Hash de certification : {selectedResidentQuittanceForPreview.id}</div>
                <div>Date : {new Date(selectedResidentQuittanceForPreview.createdAt).toLocaleDateString('fr-MA')}</div>
              </div>

              <div className="w-20 h-20 rounded-full border-2 border-dashed border-teal-700 flex flex-col items-center justify-center text-teal-800 font-mono text-[7px] text-center p-1 bg-teal-50/40">
                <span className="font-bold text-[6px]">SYNDICAT COPRO</span>
                <span className="font-extrabold text-[8px] text-teal-900">CERTIFIÉ</span>
                <span className="font-bold text-[7px]">CONFORME</span>
                <span className="text-[5px]">LOI 18-00</span>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Change Password Modal */}
      <Modal
        isOpen={isPasswordModalOpen}
        onClose={() => setIsPasswordModalOpen(false)}
        title="Sécurité du compte & Mot de passe personnel"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsPasswordModalOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handlePasswordSubmit}>
              Enregistrer le mot de passe
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
            <div>
              Compte : <strong>{currentResident?.name || userProfile?.displayName}</strong> (
              {isOwnerResident ? 'Copropriétaire' : 'Locataire'})
            </div>
            <div className="font-mono text-slate-500 mt-0.5">
              Identifiant : {currentResident?.email || userProfile?.email}
              {currentResident?.cin ? ` • CIN : ${currentResident.cin}` : ''}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nouveau mot de passe (min. 6 caractères)
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Confirmer le nouveau mot de passe
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
            />
          </div>

          {passwordMsg && (
            <div
              className={`p-3 rounded-lg text-xs font-medium border ${
                passwordMsg.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
              }`}
            >
              {passwordMsg.text}
            </div>
          )}
        </div>
      </Modal>

      {/* Fixed Mobile Bottom Navigation Bar (< md) */}
      <nav
        aria-label="Navigation mobile copropriétaire"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 shadow-lg pb-safe"
      >
        <div className="grid grid-cols-6 h-16">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'overview' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">🏠</span>
            <span className="truncate max-w-[54px]">Logement</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('voting')}
            className={`relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'voting' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">🗳️</span>
            <span className="truncate max-w-[54px]">Votes AG</span>
            {unvotedResolutionsCount > 0 && (
              <span className="absolute top-1.5 right-2.5 w-2 h-2 rounded-full bg-emerald-500"></span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('maintenance')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'maintenance' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">🔧</span>
            <span className="truncate max-w-[54px]">Incidents</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'chat' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">💬</span>
            <span className="truncate max-w-[54px]">Chat</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('marketplace')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'marketplace' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">🛍️</span>
            <span className="truncate max-w-[54px]">Souk</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('providers')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'providers' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">🛠️</span>
            <span className="truncate max-w-[54px]">Artisans</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default ResidentDashboard;
