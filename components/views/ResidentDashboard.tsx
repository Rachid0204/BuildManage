import React, { Suspense, useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Image as ImageIcon } from 'lucide-react';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import CameraCaptureModal, { compressImageFile } from '../common/CameraCaptureModal';
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
import NotificationBell from '../common/NotificationBell';
import LanguageToggle from '../common/LanguageToggle';
import { useI18n } from '../../hooks/useI18n';
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
  PaymentMethod,
  Quittance,
  Syndic,
  Building,
  Resident,
} from '../../types';
import { generateQuittancePDF } from '../../services/pdfService';
import { splitChargeReserveAndOperating } from '../../utils/security';
import Loading from '../common/Loading';

const CommunityChat = React.lazy(() => import('./CommunityChat'));
const ServiceProvidersDirectory = React.lazy(() => import('./ServiceProvidersDirectory'));
const MarketplaceView = React.lazy(() => import('./MarketplaceView'));
const ResidentAGVoting = React.lazy(() => import('./ResidentAGVoting'));
const Maintenance = React.lazy(() => import('./Maintenance'));

const ResidentDashboard: React.FC = () => {
  const { userProfile, logout, changePassword } = useAuth();
  const { t, tr, language } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat(language === 'ar' ? 'ar-MA' : 'fr-MA', {
        style: 'currency',
        currency: 'MAD',
        minimumFractionDigits: 2,
      }),
    [language]
  );

  const [activeTab, setActiveTab] = useState<
    'overview' | 'voting' | 'maintenance' | 'chat' | 'providers' | 'marketplace'
  >('overview');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [selectedChargeId, setSelectedChargeId] = useState<string>('');
  const [selectedResidentQuittanceForPreview, setSelectedResidentQuittanceForPreview] =
    useState<Quittance | null>(null);
  const [isDownloadingChargeQuit, setIsDownloadingChargeQuit] = useState<string | null>(null);
  const [previewDocName, setPreviewDocName] = useState<string | null>(null);

  // Password Change State
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Maintenance Form State
  const [maintTitle, setMaintTitle] = useState('');
  const [maintLocation, setMaintLocation] = useState('');
  const [maintCategory, setMaintCategory] = useState<MaintenanceRequest['category']>('plumbing');
  const [maintDesc, setMaintDesc] = useState('');
  const [maintPriority, setMaintPriority] = useState<MaintenanceRequest['priority']>('medium');
  const [maintPhotos, setMaintPhotos] = useState<string[]>([]);
  const [isMaintCameraOpen, setIsMaintCameraOpen] = useState(false);
  const [residentLightboxPhoto, setResidentLightboxPhoto] = useState<string | null>(null);
  const maintPhotoInputRef = useRef<HTMLInputElement | null>(null);

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

    // 2. If not matched by resident record, resolve strictly by userProfile.syndicId & userProfile.buildingId (no cross-tenant fallback)
    if (!foundSyndic && userProfile?.syndicId) {
      foundSyndic = syndics.find((s) => s.id === userProfile.syndicId);
    }
    if (!foundBuilding && foundSyndic && userProfile?.buildingId) {
      foundBuilding = foundSyndic.buildings.find((b) => b.id === userProfile.buildingId);
    }
    const foundApt = foundBuilding?.apartments.find(
      (a) =>
        (foundResident?.apartmentId && a.id === foundResident.apartmentId) ||
        (userProfile?.apartmentId && a.id === userProfile.apartmentId) ||
        (foundResident && (a.ownerId === foundResident.id || a.tenantId === foundResident.id))
    );

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
  const unvotedResolutionsCount =
    activeAGSession?.resolutions.filter(
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
        buildingId: activeBuilding?.id || userProfile?.buildingId || '',
        residentId: currentResident?.id || userProfile?.uid || '',
        residentName:
          currentResident?.name ||
          userProfile?.displayName ||
          tr('Copropriétaire', 'مالك مشترك'),
        apartmentNumber: currentApartment?.number
          ? `${tr('Lot', 'شقة')} ${currentApartment.number}`
          : undefined,
        photos: data.photos && data.photos.length > 0 ? data.photos : undefined,
        photoUrl: data.photos && data.photos.length > 0 ? data.photos[0] : undefined,
        status: 'pending',
        createdAt: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', currentResident?.id] });
      queryClient.invalidateQueries({ queryKey: ['maintenance', activeBuilding?.id] });
      setIsReportModalOpen(false);
      setMaintTitle('');
      setMaintLocation('');
      setMaintDesc('');
      setMaintPhotos([]);
    },
  });

  const handleMaintGallerySelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const validFiles = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 4);
    const compressed = await Promise.all(validFiles.map((f) => compressImageFile(f)));
    setMaintPhotos((prev) => [...prev, ...compressed].slice(0, 5));
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
        text: tr(
          'Le nouveau mot de passe doit comporter au moins 6 caractères.',
          'يجب أن تتكون كلمة المرور الجديدة من 6 أحرف على الأقل.'
        ),
      });
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      setPasswordMsg({
        type: 'error',
        text: tr('Les deux mots de passe ne correspondent pas.', 'كلمتا المرور غير متطابقتين.'),
      });
      return;
    }
    try {
      await changePassword(newPassword.trim());
      setPasswordMsg({
        type: 'success',
        text: tr(
          'Votre mot de passe personnel a été enregistré avec succès.',
          'تم حفظ كلمة المرور الشخصية الخاصة بكم بنجاح.'
        ),
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
        text:
          e?.message ||
          tr(
            'Erreur lors de la mise à jour du mot de passe.',
            'حدث خطأ أثناء تحديث كلمة المرور.'
          ),
      });
    }
  };

  const pendingCharges = myCharges.filter(
    (c) => c.status === 'pending' || c.status === 'unpaid' || c.status === 'overdue'
  );
  const totalPendingAmount = pendingCharges.reduce(
    (sum, c) => sum + Math.max(0, c.amount - (c.paidAmount || 0)),
    0
  );

  if (userProfile && userProfile.role !== 'resident') {
    navigate(getHomeRouteForRole(userProfile.role), { replace: true });
    return null;
  }

  if (loadingCharges)
    return (
      <Loading
        message={tr('Chargement de votre espace résident...', 'جاري تحميل فضاء الساكن الخاص بكم...')}
      />
    );

  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-MA';

  return (
    <div className="min-h-screen bg-slate-100" dir={language === 'ar' ? 'rtl' : 'ltr'}>
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
                {isOwnerResident ? t('residentPortal.ownerBadge') : t('residentPortal.tenantBadge')}
              </span>
              {activeBuilding && (
                <span className="text-xs text-slate-300 font-medium hidden md:inline">
                  • {activeBuilding.name}
                  {currentApartment
                    ? ` (${t('residentPortal.lotLabel', { number: currentApartment.number })})`
                    : ''}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
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
                title={t('residentPortal.passwordBtn')}
              >
                🔑 {t('residentPortal.passwordBtn')}
              </button>

              <NotificationBell />

              <LanguageToggle variant="dark" />

              <button
                type="button"
                onClick={handleLogout}
                className="text-xs text-rose-400 hover:text-rose-200 transition-colors font-semibold px-2 py-1"
              >
                {t('header.logout')}
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
              <span className="font-bold">🔐 {t('residentPortal.tempPasswordTitle')}</span>{' '}
              {t('residentPortal.tempPasswordDesc')}
            </div>
            <button
              type="button"
              onClick={() => {
                setPasswordMsg(null);
                setIsPasswordModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shrink-0"
            >
              {t('residentPortal.customizePasswordBtn')}
            </button>
          </div>
        </div>
      )}

      {/* Sub Navigation Bar for Resident Features */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-1.5 sm:gap-3 overflow-x-auto no-scrollbar py-2.5">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'overview'
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <span>🏠</span>
              <span>{t('residentPortal.tabOverview')}</span>
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
              <span>{t('residentPortal.tabAg')}</span>
              {unvotedResolutionsCount > 0 ? (
                <span className="text-[10px] bg-emerald-500 text-white px-2 py-0.5 rounded-full font-bold animate-pulse">
                  {unvotedResolutionsCount}
                </span>
              ) : (
                <span className="text-[10px] bg-teal-100 text-teal-800 px-1.5 py-0.2 rounded font-bold">
                  18-00
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
              <span>{t('residentPortal.tabMaintenance')}</span>
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
              <span>{t('residentPortal.tabChat')}</span>
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
              <span>{t('sidebar.prestataires')}</span>
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
              <span>{t('residentPortal.tabMarketplace')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto py-4 sm:py-8 px-3 sm:px-6 lg:px-8 pb-24 md:pb-10 space-y-6">
        <Suspense fallback={<Loading />}>
          {activeTab === 'chat' && activeBuilding && (
            <CommunityChat
              building={activeBuilding}
              isResidentPortal={true}
              currentResidentId={currentResident?.id}
              currentResidentName={currentResident?.name}
              currentApartmentNumber={
                currentApartment?.number
                  ? `${tr('Lot', 'شقة')} ${currentApartment.number}`
                  : tr('Copropriétaire', 'مالك مشترك')
              }
            />
          )}

          {activeTab === 'providers' && activeBuilding && (
            <ServiceProvidersDirectory
              building={activeBuilding}
              residentId={currentResident?.id}
              residentName={currentResident?.name}
              apartmentNumber={
                currentApartment?.number
                  ? `${tr('Lot', 'شقة')} ${currentApartment.number}`
                  : tr('Copropriétaire', 'مالك مشترك')
              }
              isResidentPortal={true}
            />
          )}

          {activeTab === 'marketplace' && activeBuilding && (
            <MarketplaceView
              building={activeBuilding}
              currentResidentId={currentResident?.id}
              currentResidentName={currentResident?.name}
              currentApartmentNumber={
                currentApartment?.number
                  ? `${tr('Lot', 'شقة')} ${currentApartment.number}`
                  : tr('Copropriétaire', 'مالك مشترك')
              }
              currentPhone={currentResident?.phone || ''}
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
              currentApartmentNumber={
                currentApartment?.number
                  ? `${tr('Lot', 'شقة')} ${currentApartment.number}`
                  : tr('Parties Communes', 'الأجزاء المشتركة')
              }
            />
          )}
        </Suspense>

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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                          {tr('Scrutin en cours · Loi 18-00', 'تصويت جاري · قانون 18-00')}
                        </span>
                        <span className="text-xs text-teal-200">{activeAGSession.title}</span>
                      </div>
                      <p className="text-xs text-teal-100 mt-1">
                        {tr('Vous disposez de', 'تتوفرون على')}{' '}
                        <strong>
                          {currentApartment?.tantiemes || 260} {tr('tantièmes', 'جزءاً عقارياً')}
                        </strong>{' '}
                        {tr('de copropriété pour voter.', 'من الملكية المشتركة للتصويت.')}
                        {unvotedResolutionsCount > 0 ? (
                          <span className="text-amber-300 font-semibold ms-1">
                            (
                            {tr(
                              `${unvotedResolutionsCount} délibération(s) en attente de votre vote`,
                              `${unvotedResolutionsCount} قرار(ات) في انتظار تصويتكم`
                            )}
                            )
                          </span>
                        ) : (
                          <span className="text-emerald-300 font-semibold ms-1">
                            ({tr('Tous vos votes ont été enregistrés ✓', 'تم تسجيل جميع أصواتكم ✓')})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <Button
                    onClick={() => setActiveTab('voting')}
                    className="text-xs bg-white text-teal-900 hover:bg-teal-50 font-bold shrink-0 shadow-xs"
                  >
                    {tr('Accéder au Scrutin Numérique →', 'الولوج إلى التصويت الرقمي ←')}
                  </Button>
                </div>
              </Card>
            )}

            {/* KPI Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* My Lot Card */}
              <Card className="p-5 border-s-4 border-s-teal-600 bg-white">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {tr('Mon Logement', 'وحدتي السكنية')}
                    </p>
                    <h3 className="text-xl font-bold text-slate-900 mt-1">
                      {activeBuilding?.name || tr('Résidence', 'الإقامة')}
                    </h3>
                    <p className="text-sm text-teal-800 font-semibold mt-0.5">
                      {tr('Appartement Lot', 'شقة رقم')} {currentApartment?.number || 'A-102'} (
                      {tr('Étage', 'الطابق')} {currentApartment?.floor ?? 1})
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded">
                    {currentApartment?.tantiemes || 260} / 1000
                  </span>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between text-xs text-slate-600 font-mono">
                  <span>
                    {tr('Superficie :', 'المساحة :')} {currentApartment?.area || 110} m²
                  </span>
                  <span>
                    {tr('Statut :', 'الصفة :')}{' '}
                    {currentResident?.isOwner
                      ? tr('Propriétaire', 'مالك مشترك')
                      : tr('Locataire', 'مكتري')}
                  </span>
                </div>
              </Card>

              {/* Pending Charges Card */}
              <Card className="p-5 border-s-4 border-s-amber-500 bg-white">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {tr('Charges en Attente', 'المساهمات قيد الأداء')}
                    </p>
                    <p className="text-2xl font-bold font-mono text-slate-900 mt-1 tabular-nums">
                      {currencyFormatter.format(totalPendingAmount)}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {pendingCharges.length}{' '}
                      {tr('appel(s) de fonds à régulariser', 'طلب(ات) أداء للتسوية')}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-amber-50 text-amber-700">
                    <FinancialsIcon />
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center text-xs">
                  <span className="text-slate-500">
                    {tr('Par virement bancaire :', 'عبر تحويل بنكي :')}
                  </span>
                  <button
                    onClick={() => {
                      if (pendingCharges.length > 0) {
                        setSelectedChargeId(pendingCharges[0].id);
                        setIsProofModalOpen(true);
                      } else {
                        alert(
                          tr(
                            'Aucune charge en attente.',
                            'لا توجد أي مساهمات عالقة حالياً.'
                          )
                        );
                      }
                    }}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-900 underline"
                  >
                    {tr('Déposer un reçu de virement', 'إيداع وصل التحويل البنكي')}
                  </button>
                </div>
              </Card>

              {/* Quittances Certified Card */}
              <Card className="p-5 border-s-4 border-s-emerald-600 bg-white">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {tr('Quittances Certifiées', 'وصولات الأداء المعتمدة')}
                    </p>
                    <p className="text-2xl font-bold font-mono text-emerald-800 mt-1 tabular-nums">
                      {myQuittances.length}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {tr('Attestations officielles (Loi 18-00)', 'شهادات إبراء رسمية (قانون 18-00)')}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-700">
                    <QuittanceIcon />
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 text-xs text-emerald-700 font-medium">
                  {tr(
                    'Téléchargeables pour notaire ou archivage',
                    'قابلة للتحميل بصيغة PDF للتوثيق أو الأرشفة'
                  )}
                </div>
              </Card>
            </div>

            {/* Bank Details for Wire Transfers */}
            <Card className="p-4 bg-teal-50 border border-teal-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-bold text-teal-950 uppercase tracking-wider block">
                    {tr(
                      'Coordonnées Bancaires de la Copropriété (Pour vos virements)',
                      'المعلومات البنكية للملكية المشتركة (لتحويلاتكم البنكية)'
                    )}
                  </span>
                  <p className="text-teal-800 mt-0.5">
                    {tr('Banque :', 'البنك :')}{' '}
                    <strong>{activeBuilding?.bankName || 'Attijariwafa Bank - Agence Gauthier'}</strong>
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
                      <h3 className="font-bold text-slate-900 text-sm">
                        {tr('Cotisations & Appels de Fonds', 'المساهمات وطلبات الأداء الشهرية')}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {tr(
                          'Réglez vos charges par virement et transmettez votre bordereau',
                          'أدّوا مساهماتكم عبر تحويل بنكي وأرسلوا إثبات الأداء'
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100 mt-3">
                    {myCharges.map((charge) => {
                      const proof = myProofs.find((p) => p.chargeId === charge.id);

                      return (
                        <div
                          key={charge.id}
                          className="py-3 flex items-center justify-between gap-3 text-xs sm:text-sm"
                        >
                          <div>
                            <div className="font-semibold text-slate-900">{charge.description}</div>
                            <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap">
                              <span>
                                {tr('Échéance :', 'تاريخ الاستحقاق :')}{' '}
                                {new Date(charge.dueDate).toLocaleDateString(dateLocale)}
                              </span>
                              {proof && (
                                <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded font-medium">
                                  {tr(
                                    `Virement en cours de validation (Réf: ${proof.referenceNumber})`,
                                    `تحويل قيد التحقق (مرجع: ${proof.referenceNumber})`
                                  )}
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
                                  {tr('✓ Réglé', '✓ مؤدى')}
                                </span>
                                <button
                                  onClick={async () => {
                                    try {
                                      setIsDownloadingChargeQuit(charge.id);
                                      const matchingQuit = myQuittances.find(
                                        (q) => q.chargeId === charge.id
                                      );
                                      if (matchingQuit) {
                                        generateQuittancePDF(
                                          matchingQuit,
                                          activeBuilding!,
                                          activeSyndic,
                                          currentApartment,
                                          currentResident
                                        );
                                      } else if (activeBuilding) {
                                        const generated = await generateQuittanceForCharge(
                                          charge.id,
                                          activeBuilding.id
                                        );
                                        queryClient.invalidateQueries({
                                          queryKey: ['quittances', currentResident?.id],
                                        });
                                        generateQuittancePDF(
                                          generated,
                                          activeBuilding,
                                          activeSyndic,
                                          currentApartment,
                                          currentResident
                                        );
                                      }
                                    } finally {
                                      setIsDownloadingChargeQuit(null);
                                    }
                                  }}
                                  disabled={isDownloadingChargeQuit === charge.id}
                                  className="px-2.5 py-1 text-xs bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold rounded transition-colors flex items-center gap-1"
                                  title={tr(
                                    'Télécharger la quittance libératoire officielle (Loi 18-00)',
                                    'تحميل وصل الإبراء الرسمي بصيغة PDF (قانون 18-00)'
                                  )}
                                >
                                  <QuittanceIcon />
                                  <span>
                                    {isDownloadingChargeQuit === charge.id
                                      ? tr('Génération...', 'جاري الإنشاء...')
                                      : tr('Quittance PDF', 'وصل PDF')}
                                  </span>
                                </button>
                              </div>
                            ) : proof ? (
                              <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded">
                                {tr('Vérification en cours', 'قيد التحقق')}
                              </span>
                            ) : (
                              <button
                                onClick={() => {
                                  setSelectedChargeId(charge.id);
                                  setIsProofModalOpen(true);
                                }}
                                className="px-3 py-1 bg-teal-600 hover:bg-teal-700 text-white font-medium rounded text-xs transition-colors"
                              >
                                {tr('Transmettre Justificatif', 'إرسال إثبات الأداء')}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {myCharges.length === 0 && (
                      <p className="text-center text-slate-500 text-xs py-4">
                        {tr('Aucune charge enregistrée pour ce lot.', 'لا توجد أي مساهمات مسجلة لهذه الشقة.')}
                      </p>
                    )}
                  </div>
                </Card>

                {/* Maintenance Tickets Section with Live Progress Preview */}
                <Card className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <WrenchIcon />
                        <span>
                          {tr('Suivi de mes Incidents & Réparations', 'تتبع الأعطاب وطلبات الإصلاح')}
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500">
                        {tr(
                          "Consultez l'avancement, les notes du Syndic et les photos d'intervention",
                          'اطلعوا على مراحل التقدم، ملاحظات السنديك وصور التدخل التقني'
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTab('maintenance')}
                        className="px-3 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-bold text-xs transition-colors"
                      >
                        {tr('Suivi détaillé & photos →', 'تتبع مفصل وصور ←')}
                      </button>
                      <Button
                        onClick={() => setIsReportModalOpen(true)}
                        className="text-xs flex items-center gap-1"
                      >
                        <PlusIcon />
                        <span>{tr('Signaler', 'تبليغ')}</span>
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
                                  · {new Date(req.createdAt).toLocaleDateString(dateLocale)}
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
                                ? tr('✓ Résolu', '✓ منجز')
                                : req.status === 'in_progress'
                                ? tr('🔧 En cours', '🔧 قيد الإنجاز')
                                : tr('⏳ Reçu', '⏳ تم الاستلام')}
                            </span>
                          </div>

                          {/* Mini Progress Bar */}
                          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/80 space-y-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="text-slate-600 font-medium">
                                {req.assignedTo
                                  ? `${tr('Prestataire :', 'مقدم الخدمة :')} ${req.assignedTo}`
                                  : tr(
                                      "En attente d'assignation prestataire",
                                      'في انتظار تعيين تقني مختص'
                                    )}
                              </span>
                              <span className="font-mono font-bold text-teal-800">
                                {tr(`Étape ${stage}/4`, `مرحلة ${stage}/4`)}
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
                                🏢 {tr('Note Syndic :', 'ملاحظة السنديك :')} « {req.syndicNotes} »
                              </p>
                            )}
                            {((req.photos && req.photos.length > 0) || req.photoUrl) && (
                              <div className="flex items-center gap-2 pt-1 overflow-x-auto">
                                {(req.photos && req.photos.length > 0
                                  ? req.photos
                                  : req.photoUrl
                                  ? [req.photoUrl]
                                  : []
                                ).map((photo, pIdx) => (
                                  <button
                                    key={pIdx}
                                    type="button"
                                    onClick={() => setResidentLightboxPhoto(photo)}
                                    className="w-12 h-12 rounded-lg overflow-hidden border border-teal-300 shrink-0 hover:opacity-90 transition-opacity"
                                    title={tr('Agrandir la photo', 'تكبير الصورة')}
                                  >
                                    <img
                                      src={photo}
                                      alt=""
                                      className="w-full h-full object-cover"
                                    />
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {myRequests.length === 0 && (
                      <p className="text-center text-slate-500 text-xs py-4">
                        {tr('Aucun incident en cours.', 'لا يوجد أي عطب مسجل حالياً.')}
                      </p>
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
                      <span>
                        {tr('Mes Quittances Certifiées (Loi 18-00)', 'وصولات الأداء المعتمدة (قانون 18-00)')}
                      </span>
                    </h3>
                  </div>

                  <div className="divide-y divide-slate-100 mt-3">
                    {myQuittances.map((quit) => (
                      <div
                        key={quit.id}
                        className="py-2.5 flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-mono font-bold text-teal-800 text-xs">
                            {quit.quittanceNumber}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {quit.periodCovered} · {currencyFormatter.format(quit.amount)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => setSelectedResidentQuittanceForPreview(quit)}
                            className="px-2 py-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded border border-slate-200 font-medium transition-colors"
                            title={tr("Consulter l'attestation libératoire", 'معاينة شهادة الإبراء')}
                          >
                            {tr('Aperçu', 'معاينة')}
                          </button>
                          <button
                            onClick={() =>
                              generateQuittancePDF(
                                quit,
                                activeBuilding!,
                                activeSyndic,
                                currentApartment,
                                currentResident
                              )
                            }
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
                        {tr(
                          "Aucune quittance disponible pour l'instant. Dès validation de vos virements, vos quittances apparaîtront ici.",
                          'لا يوجد أي وصل متاح حالياً. بمجرد المصادقة على تحويلاتكم البنكية، ستظهر وصولاتكم المعتمدة هنا.'
                        )}
                      </p>
                    )}
                  </div>
                </Card>

                {/* Announcements Box */}
                <Card className="p-5">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5 pb-3 border-b border-slate-200">
                    <AnnouncementsIcon />
                    <span>{tr('Annonces de la Résidence', 'إعلانات وبلاغات الإقامة')}</span>
                  </h3>

                  <div className="space-y-3 mt-3">
                    {(activeBuilding?.announcements || []).map((ann) => (
                      <div key={ann.id} className="border-b border-slate-100 pb-3 last:border-b-0">
                        <p className="font-semibold text-slate-900 text-xs">{ann.title}</p>
                        <p className="text-[11px] text-slate-400 font-mono">
                          {new Date(ann.date).toLocaleDateString(dateLocale)}
                        </p>
                        <p className="text-xs text-slate-600 mt-1 whitespace-pre-line">
                          {ann.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* Official Co-ownership Documents Box */}
                <Card className="p-5">
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-1.5 pb-3 border-b border-slate-200">
                    <DocumentsIcon />
                    <span>
                      {tr(
                        'Documents Officiels de la Copropriété',
                        'الوثائق الرسمية للملكية المشتركة'
                      )}
                    </span>
                  </h3>
                  <div className="divide-y divide-slate-100 mt-2">
                    {(activeBuilding?.documents || []).map((docItem) => (
                      <div
                        key={docItem.id}
                        className="py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-800 truncate">{docItem.name}</p>
                          <p className="text-[11px] text-slate-400 font-mono">
                            {docItem.size} ·{' '}
                            {new Date(docItem.uploadedAt).toLocaleDateString(dateLocale)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setPreviewDocName(docItem.name)}
                          className="px-2.5 py-1 rounded bg-slate-100 hover:bg-teal-50 hover:text-teal-800 text-slate-700 font-semibold text-xs shrink-0 transition-colors"
                        >
                          {tr('Consulter', 'اطلاع')}
                        </button>
                      </div>
                    ))}
                    {(!activeBuilding?.documents || activeBuilding.documents.length === 0) && (
                      <p className="text-xs text-slate-500 py-3 text-center">
                        {tr('Aucun document publié.', 'لا توجد أي وثيقة منشورة.')}
                      </p>
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
          title={`${tr('Consultation Document Officiel', 'معاينة وثيقة رسمية')} — ${previewDocName}`}
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setPreviewDocName(null)}>
                {tr('Fermer', 'إغلاق')}
              </Button>
            </div>
          }
        >
          <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs text-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="font-bold text-slate-900 text-sm">{previewDocName}</div>
                <div className="text-[11px] text-slate-500">
                  {activeBuilding?.name} ·{' '}
                  {tr(
                    `Archive officielle certifiée par ${activeSyndic?.name}`,
                    `أرشيف رسمي معتمد من طرف ${activeSyndic?.name}`
                  )}
                </div>
              </div>
              <span className="px-2.5 py-1 rounded bg-teal-100 text-teal-800 font-mono font-bold text-[11px]">
                {tr('Loi n° 18-00', 'قانون رقم 18-00')}
              </span>
            </div>
            <p className="leading-relaxed">
              {tr(
                `Ce document fait partie intégrante du registre légal de la copropriété ${activeBuilding?.name} (${activeBuilding?.address}, ${activeBuilding?.city}). Il est mis à la disposition de l'ensemble des copropriétaires conformément aux dispositions de la Loi n° 18-00 telle que modifiée et complétée par la Loi n° 106-12.`,
                `تعتبر هذه الوثيقة جزءاً لا يتجزأ من السجل القانوني للملكية المشتركة ${activeBuilding?.name} (${activeBuilding?.address}، ${activeBuilding?.city}). وهي موضوعة رهن إشارة جميع الملاك المشتركين طبقا لمقتضيات القانون رقم 18-00 كما تم تغييره وتتميمه بالقانون رقم 106-12.`
              )}
            </p>
            <div className="p-3 bg-white rounded-lg border border-slate-200 font-mono text-[11px] text-slate-600 space-y-1">
              <div>
                • {tr('Syndic Gestionnaire :', 'السنديك المسير :')} {activeSyndic?.name}
              </div>
              <div>• ICE : {activeSyndic?.ice || '001524367000089'}</div>
              <div>
                •{' '}
                {tr(
                  'Statut : Document vérifié et archivé numériquement',
                  'الحالة : وثيقة محققة ومؤرشفة رقمياً'
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Modal: Submit Payment Proof */}
      <Modal
        isOpen={isProofModalOpen}
        onClose={() => setIsProofModalOpen(false)}
        title={tr(
          'Transmettre un justificatif de virement bancaire',
          'إرسال إثبات التحويل البنكي'
        )}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsProofModalOpen(false)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button
              onClick={() => {
                if (!refNumber)
                  return alert(
                    tr(
                      'Veuillez saisir le numéro de référence du virement.',
                      'يرجى إدخال الرقم المرجعي لعملية التحويل.'
                    )
                  );
                const targetCharge =
                  myCharges.find((c) => c.id === selectedChargeId) || myCharges[0];
                if (!targetCharge) return;

                proofMutation.mutate({
                  chargeId: targetCharge.id,
                  residentId: currentResident?.id || 'res-2',
                  residentName: currentResident?.name || tr('Copropriétaire', 'مالك مشترك'),
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
              {tr('Envoyer pour validation', 'إرسال للمصادقة')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            {tr(
              'Une fois votre justificatif vérifié par le syndic, votre compte de charges sera crédité et votre quittance officielle conforme à la Loi 18-00 sera générée automatiquement.',
              'بمجرد التحقق من وصل الأداء من طرف السنديك، سيتم تحديث حساب مساهماتكم وإصدار وصل الإبراء الرسمي المطابق للقانون 18-00 تلقائياً.'
            )}
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Banque émettrice', 'البنك المصدر للتحويل')}
            </label>
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
              <option value="Autre banque">
                {tr('Autre banque marocaine', 'بنك مغربي آخر')}
              </option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Mode de règlement', 'طريقة الأداء')}
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="virement">
                  {tr('Virement bancaire (Application / Web)', 'تحويل بنكي (تطبيق / ويب)')}
                </option>
                <option value="versement">
                  {tr('Versement espèces en agence', 'إيداع نقدي بالوكالة')}
                </option>
                <option value="cheque">{tr('Chèque bancaire', 'شيك بنكي')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr("N° Référence / Numéro d'opération", 'رقم المرجع / رقم العملية')}
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
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Note pour le syndic', 'ملاحظة للسنديك')}
            </label>
            <textarea
              rows={2}
              value={proofNote}
              onChange={(e) => setProofNote(e.target.value)}
              placeholder={tr(
                'Ex: Virement effectué depuis mon compte CIH Mobile ce matin...',
                'مثال: تم التحويل من حسابي البنكي هذا الصباح...'
              )}
              className="w-full px-3 py-2 border border-slate-300 rounded text-xs"
            />
          </div>
        </div>
      </Modal>

      {/* Modal: Add Maintenance Request */}
      <Modal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        title={tr('Signaler un incident ou une réparation', 'التبليغ عن عطب أو طلب إصلاح')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsReportModalOpen(false)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button
              disabled={reportMutation.isPending}
              onClick={() => {
                if (!maintDesc.trim())
                  return alert(tr('Description obligatoire.', 'يرجى إدخال وصف العطب.'));
                reportMutation.mutate({
                  title:
                    maintTitle.trim() ||
                    `${maintCategory.toUpperCase()} — ${
                      maintLocation.trim() ||
                      (currentApartment?.number
                        ? `${tr('Lot', 'شقة')} ${currentApartment.number}`
                        : tr('Parties communes', 'الأجزاء المشتركة'))
                    }`,
                  location:
                    maintLocation.trim() ||
                    (currentApartment?.number
                      ? `${tr('Lot', 'شقة')} ${currentApartment.number}`
                      : tr('Parties communes', 'الأجزاء المشتركة')),
                  category: maintCategory,
                  description: maintDesc.trim(),
                  priority: maintPriority,
                  photos: maintPhotos,
                });
              }}
            >
              {reportMutation.isPending
                ? tr('Envoi en cours...', 'جاري الإرسال...')
                : tr('Envoyer au syndic', 'إرسال إلى السنديك')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr("Titre court de l'incident", 'عنوان مختصر للعطب')}
            </label>
            <input
              type="text"
              value={maintTitle}
              onChange={(e) => setMaintTitle(e.target.value)}
              placeholder={tr(
                "Ex: Fuite d'eau palier / Panne éclairage...",
                'مثال: تسرب مياه في البهو / عطب في الإنارة...'
              )}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Catégorie', 'التصنيف')}
              </label>
              <select
                value={maintCategory}
                onChange={(e) => setMaintCategory(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="plumbing">{tr('Plomberie', 'السباكة')}</option>
                <option value="electrical">{tr('Électricité', 'الكهرباء')}</option>
                <option value="elevator">{tr('Ascenseur', 'المصعد')}</option>
                <option value="common_area">{tr('Parties Communes', 'الأجزاء المشتركة')}</option>
                <option value="cleaning">{tr('Propreté / Hygiène', 'النظافة')}</option>
                <option value="security">{tr('Sécurité & Accès', 'الأمن والولوج')}</option>
                <option value="other">{tr('Autre', 'أخرى')}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {tr('Urgence', 'درجة الاستعجال')}
              </label>
              <select
                value={maintPriority}
                onChange={(e) => setMaintPriority(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="low">{tr('Normale', 'عادية')}</option>
                <option value="medium">{tr('Moyenne', 'متوسطة')}</option>
                <option value="high">{tr('Urgente', 'مستعجلة')}</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Emplacement précis', 'الموقع الدقيق')}
            </label>
            <input
              type="text"
              value={maintLocation}
              onChange={(e) => setMaintLocation(e.target.value)}
              placeholder={tr(
                'Ex: Couloir 2ème étage, Parking sous-sol...',
                'مثال: ممر الطابق الثاني، مرآب السيارات...'
              )}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Description détaillée', 'وصف مفصل للعطب')}
            </label>
            <textarea
              rows={3}
              value={maintDesc}
              onChange={(e) => setMaintDesc(e.target.value)}
              placeholder={tr(
                "Décrivez l'emplacement précis et la nature de la panne...",
                'اذكروا المكان الدقيق وطبيعة العطب...'
              )}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>

          {/* Camera & Photo Attachment Section */}
          <div className="space-y-2.5 pt-2 border-t border-slate-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <label className="block text-xs font-semibold text-slate-700">
                📷 {tr("Photo de l'incident (Caméra ou Galerie)", 'صورة العطب (الكاميرا أو المعرض)')}
              </label>
              <input
                ref={maintPhotoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleMaintGallerySelect}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setIsMaintCameraOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold flex items-center gap-1.5 shadow-2xs transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{tr('Prendre une photo', 'التقاط صورة بالكاميرا')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => maintPhotoInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>{tr('Choisir une image', 'اختيار صورة')}</span>
                </button>
              </div>
            </div>

            {maintPhotos.length > 0 && (
              <div className="flex items-center gap-2 pt-1 flex-wrap">
                {maintPhotos.map((photo, idx) => (
                  <div
                    key={idx}
                    className="relative w-16 h-16 rounded-lg overflow-hidden border border-teal-400"
                  >
                    <img src={photo} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() =>
                        setMaintPhotos((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-rose-600 text-white text-[10px] flex items-center justify-center"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Camera Live Capture Modal for Resident Overview Maintenance Report */}
      <CameraCaptureModal
        isOpen={isMaintCameraOpen}
        onClose={() => setIsMaintCameraOpen(false)}
        onCapture={(dataUrl) => {
          setMaintPhotos((prev) => [...prev, dataUrl].slice(0, 5));
        }}
      />

      {/* Lightbox for Resident Overview Maintenance Photos */}
      {residentLightboxPhoto && (
        <Modal
          isOpen={!!residentLightboxPhoto}
          onClose={() => setResidentLightboxPhoto(null)}
          title={tr("Photo de l'incident", 'صورة العطب')}
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setResidentLightboxPhoto(null)}>
                {tr('Fermer', 'إغلاق')}
              </Button>
            </div>
          }
        >
          <div className="bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center max-h-[70vh]">
            <img
              src={residentLightboxPhoto}
              alt={tr("Photo de l'incident", 'صورة العطب')}
              className="max-w-full max-h-[65vh] object-contain"
            />
          </div>
        </Modal>
      )}

      {/* Official Certificate Preview Modal for Resident */}
      {selectedResidentQuittanceForPreview && (
        <Modal
          isOpen={!!selectedResidentQuittanceForPreview}
          onClose={() => setSelectedResidentQuittanceForPreview(null)}
          title={`${tr('Attestation de Quittance', 'شهادة وصل الأداء')} — ${
            selectedResidentQuittanceForPreview.quittanceNumber
          }`}
          footer={
            <div className="flex justify-between items-center w-full">
              <span className="text-xs text-slate-500 font-mono hidden sm:inline">
                {tr(
                  'Reçu officiel certifié conforme (Loi n° 18-00 & 106-12)',
                  'وصل رسمي مطابق للقانون (قانون رقم 18-00 و 106-12)'
                )}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setSelectedResidentQuittanceForPreview(null)}
                >
                  {tr('Fermer', 'إغلاق')}
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
                  <span>{tr('Télécharger le PDF', 'تحميل PDF')}</span>
                </Button>
              </div>
            </div>
          }
        >
          <div className="p-5 bg-slate-50 border-2 border-teal-800/40 rounded-xl space-y-4 text-slate-800">
            {/* Header */}
            <div className="text-center pb-3 border-b-2 border-teal-800/20">
              <p className="text-[10px] font-bold tracking-widest text-teal-900 uppercase">
                {tr(
                  'ROYAUME DU MAROC  ·  SYNDICAT DES COPROPRIÉTAIRES',
                  'المملكة المغربية  ·  اتحاد الملاك المشتركين'
                )}
              </p>
              <h3 className="text-sm sm:text-base font-extrabold text-teal-950 mt-1 uppercase">
                {tr(
                  'Quittance de Paiement des Charges de Copropriété',
                  'وصل أداء مساهمات الملكية المشتركة'
                )}
              </h3>
              <p className="text-[10px] text-slate-500">
                {tr(
                  'Loi n° 18-00 modifiée par la Loi n° 106-12 · Reçu libératoire officiel',
                  'القانون رقم 18-00 المعدل بالقانون رقم 106-12 · وصل إبراء رسمي'
                )}
              </p>
              <div className="inline-block bg-teal-100/70 border border-teal-300 text-teal-900 font-mono text-xs px-2.5 py-0.5 rounded font-bold mt-1.5">
                {selectedResidentQuittanceForPreview.quittanceNumber}
              </div>
            </div>

            {/* Entity Dual Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-teal-800 block text-[10px] uppercase">
                  {tr('Copropriété & Syndic', 'الإقامة والسنديك')}
                </span>
                <p className="font-bold text-slate-900">
                  {activeBuilding?.name || selectedResidentQuittanceForPreview.buildingName}
                </p>
                <p className="text-slate-600">
                  {activeBuilding?.address || tr('Adresse copropriété', 'عنوان الإقامة')}
                </p>
                <p className="text-slate-500 font-mono text-[11px]">
                  {tr('Syndic :', 'السنديك :')}{' '}
                  {activeSyndic?.name || selectedResidentQuittanceForPreview.syndicName}
                </p>
              </div>

              <div className="p-3 bg-white rounded border border-slate-200 space-y-1">
                <span className="font-bold text-teal-800 block text-[10px] uppercase">
                  {tr('Copropriétaire', 'المالك المشترك')}
                </span>
                <p className="font-bold text-slate-900">
                  {selectedResidentQuittanceForPreview.residentName}
                </p>
                <p className="text-slate-600 font-mono">
                  {tr('Lot', 'شقة')} {selectedResidentQuittanceForPreview.apartmentNumber} ·{' '}
                  {selectedResidentQuittanceForPreview.tantiemes} / 1000{' '}
                  {tr('tantièmes', 'جزء')}
                </p>
                <p className="text-slate-500 font-mono text-[11px]">
                  CIN :{' '}
                  {selectedResidentQuittanceForPreview.residentCin ||
                    currentResident?.cin ||
                    tr('CIN vérifiée', 'بطاقة محققة')}
                </p>
              </div>
            </div>

            {/* Financial Detail */}
            <div className="bg-white rounded border border-slate-200 p-3 space-y-2 text-xs">
              <div className="flex justify-between items-center text-slate-700">
                <span>
                  {tr('Charges courantes', 'التكاليف الجارية')} (
                  {selectedResidentQuittanceForPreview.periodCovered})
                </span>
                <span className="font-mono font-medium">
                  {currencyFormatter.format(
                    selectedResidentQuittanceForPreview.chargesCourantesAmount ??
                      splitChargeReserveAndOperating(
                        selectedResidentQuittanceForPreview.amount,
                        activeBuilding?.reserveFundPercentage ?? 5
                      ).chargesCourantesAmount
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center text-emerald-800">
                <span>
                  {tr(
                    'Provision obligatoire Fonds de Réserve (Loi 106-12)',
                    'مساهمة صندوق الاحتياط الإلزامية (قانون 106-12)'
                  )}
                </span>
                <span className="font-mono font-semibold">
                  {currencyFormatter.format(
                    selectedResidentQuittanceForPreview.reserveFundAmount ??
                      splitChargeReserveAndOperating(
                        selectedResidentQuittanceForPreview.amount,
                        activeBuilding?.reserveFundPercentage ?? 5
                      ).reserveFundAmount
                  )}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between items-center font-bold text-slate-900 text-sm">
                <span>{tr('TOTAL RÉGLÉ :', 'المجموع المؤدى :')}</span>
                <span className="font-mono text-teal-900 text-base">
                  {currencyFormatter.format(selectedResidentQuittanceForPreview.amount)}
                </span>
              </div>
            </div>

            {/* Release Mention */}
            <p className="text-[11px] text-slate-600 italic bg-teal-50/60 p-2.5 rounded border border-teal-200">
              {tr(
                '« Le Syndic soussigné certifie avoir reçu ladite somme et délivre la présente quittance libératoire pour la période concernée. Situation comptable du lot : À JOUR. »',
                '« يشهد وكيل الاتحاد (السنديك) الموقع أسفله بتوصل الاتحاد بالمبلغ المذكور ويسلم هذا الوصل المبرئ للذمة عن الفترة المعنية. الوضعية المحاسبية للشقة : مُسوّاة. »'
              )}
            </p>

            {/* Official seal & Date */}
            <div className="flex justify-between items-end pt-1">
              <div className="text-[10px] text-slate-400 font-mono">
                <div>
                  {tr('Hash de certification :', 'رمز المصادقة :')}{' '}
                  {selectedResidentQuittanceForPreview.id}
                </div>
                <div>
                  {tr('Date :', 'التاريخ :')}{' '}
                  {new Date(selectedResidentQuittanceForPreview.createdAt).toLocaleDateString(
                    dateLocale
                  )}
                </div>
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
        title={tr(
          'Sécurité du compte & Mot de passe personnel',
          'أمان الحساب وكلمة المرور الشخصية'
        )}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsPasswordModalOpen(false)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button onClick={handlePasswordSubmit}>
              {tr('Enregistrer le mot de passe', 'حفظ كلمة المرور')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
            <div>
              {tr('Compte :', 'الحساب :')}{' '}
              <strong>{currentResident?.name || userProfile?.displayName}</strong> (
              {isOwnerResident ? tr('Copropriétaire', 'مالك مشترك') : tr('Locataire', 'مكتري')})
            </div>
            <div className="font-mono text-slate-500 mt-0.5">
              {tr('Identifiant :', 'المعرف :')} {currentResident?.email || userProfile?.email}
              {currentResident?.cin ? ` • CIN : ${currentResident.cin}` : ''}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr(
                'Nouveau mot de passe (min. 6 caractères)',
                'كلمة المرور الجديدة (6 أحرف على الأقل)'
              )}
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
              {tr('Confirmer le nouveau mot de passe', 'تأكيد كلمة المرور الجديدة')}
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
        aria-label={tr('Navigation mobile copropriétaire', 'تنقل الجوال للمالك المشترك')}
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
            <span className="truncate max-w-[54px]">{t('residentPortal.mobileHome')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('voting')}
            className={`relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'voting' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">🗳️</span>
            <span className="truncate max-w-[54px]">{t('residentPortal.mobileAg')}</span>
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
            <span className="truncate max-w-[54px]">{t('residentPortal.mobileMaintenance')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'chat' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">💬</span>
            <span className="truncate max-w-[54px]">{t('residentPortal.mobileChat')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('marketplace')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'marketplace' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">🛍️</span>
            <span className="truncate max-w-[54px]">{t('residentPortal.mobileMarketplace')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('providers')}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-bold transition-colors ${
              activeTab === 'providers' ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <span className="text-base leading-none">🛠️</span>
            <span className="truncate max-w-[54px]">{t('sidebar.prestataires')}</span>
          </button>
        </div>
      </nav>
    </div>
  );
};

export default ResidentDashboard;
