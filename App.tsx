import React, { Suspense, useEffect, useState } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, getHomeRouteForRole } from './contexts/AuthContext';
import { BuildingProvider, useBuilding } from './contexts/BuildingContext';
import DashboardLayout from './components/layout/DashboardLayout';
import Loading from './components/common/Loading';
import LoginScreen from './components/views/LoginScreen';
import LandingPage from './components/views/LandingPage';
import AdminDashboard from './components/views/AdminDashboard';
import ResidentDashboard from './components/views/ResidentDashboard';
import Card from './components/common/Card';
import Button from './components/common/Button';
import {
  getSyndics,
  saveSyndic,
  addBuilding,
  updateBuilding,
  deleteBuilding,
  addResident,
  updateResident,
  deleteResident,
  regenerateResidentCredentials,
  addApartment,
  addApartmentsBulk,
  rebalanceBuildingTantiemes,
  updateApartment,
  deleteApartment,
  generateMonthlyCharges,
  addAnnouncement,
  getMaintenanceRequestsForBuilding,
  updateMaintenanceRequest,
} from './firebase/services';
import type {
  Building,
  Resident,
  Apartment,
  SubscriptionPlan,
  UserRole,
  View,
} from './types';

// Lazy load views for performance
const Dashboard = React.lazy(() => import('./components/views/Dashboard'));
const Buildings = React.lazy(() => import('./components/views/Buildings'));
const Residents = React.lazy(() => import('./components/views/Residents'));
const Apartments = React.lazy(() => import('./components/views/Apartments'));
const Announcements = React.lazy(() =>
  import('./components/views/Announcements')
);
const Documents = React.lazy(() => import('./components/views/Documents'));
const Financials = React.lazy(() => import('./components/views/Financials'));
const Maintenance = React.lazy(() => import('./components/views/Maintenance'));
const AssembleeGenerale = React.lazy(() => import('./components/views/AssembleeGenerale'));
const Prestataires = React.lazy(() => import('./components/views/Prestataires'));
const CommunityChat = React.lazy(() => import('./components/views/CommunityChat'));
const MarketplaceView = React.lazy(() => import('./components/views/MarketplaceView'));
const Analytics = React.lazy(() => import('./components/views/Analytics'));
const Settings = React.lazy(() => import('./components/views/Settings'));

// Dedicated Provider Portal for Prestataire Agréé role
const ProviderPortal: React.FC = () => {
  const { userProfile, logout, loginWithEmail } = useAuth();
  const { selectedBuilding } = useBuilding();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const buildingId = userProfile?.buildingId || selectedBuilding?.id || 'bld-1';

  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [techNote, setTechNote] = useState('');
  const [nextStatus, setNextStatus] = useState<'in_progress' | 'completed'>('in_progress');

  const { data: requests = [] } = useQuery({
    queryKey: ['maintenance', buildingId],
    queryFn: () => getMaintenanceRequestsForBuilding(buildingId),
  });

  const updateMutation = useMutation({
    mutationFn: (payload: { requestId: string; status: 'in_progress' | 'completed'; note: string }) =>
      updateMaintenanceRequest(
        payload.requestId,
        { status: payload.status },
        {
          title:
            payload.status === 'completed'
              ? 'Intervention clôturée par le prestataire'
              : 'Compte-rendu technique du prestataire',
          note: payload.note,
          updatedBy: userProfile?.displayName || 'Prestataire Agréé',
          updatedByRole: 'provider',
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', buildingId] });
      setActiveTicketId(null);
      setTechNote('');
    },
  });

  const handleQuickSwitch = async (targetEmail: string) => {
    const profile = await loginWithEmail(targetEmail, 'password123');
    navigate(getHomeRouteForRole(profile.role), { replace: true });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <span className="text-[11px] uppercase tracking-wider font-bold px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/30">
            Portail Prestataire Agréé
          </span>
          <h1 className="text-xl font-bold mt-1">{userProfile?.displayName || 'Artisan Partenaire'}</h1>
          <p className="text-xs text-slate-400">
            Interventions techniques assignées • {selectedBuilding?.name || 'Résidence Les Palmiers'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleQuickSwitch('contact@syndicpro.ma')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-emerald-300 border border-slate-700"
          >
            🏢 Vue Syndic
          </button>
          <button
            type="button"
            onClick={() => handleQuickSwitch('fatima.zahra@email.com')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-sky-300 border border-slate-700"
          >
            🔑 Vue Copropriétaire
          </button>
          <button
            type="button"
            onClick={() => handleQuickSwitch('admin@syndik.ma')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-rose-300 border border-slate-700"
          >
            🛡️ Vue Admin
          </button>
          <Button variant="secondary" onClick={handleLogout}>
            Déconnexion
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <p className="text-xs font-semibold uppercase text-slate-400">Bons de travaux actifs</p>
            <p className="text-3xl font-extrabold text-slate-900 mt-1">
              {requests.filter((r) => r.status !== 'completed').length}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase text-slate-400">Interventions terminées</p>
            <p className="text-3xl font-extrabold text-emerald-600 mt-1">
              {requests.filter((r) => r.status === 'completed').length}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase text-slate-400">SLA Moyen de résolution</p>
            <p className="text-3xl font-extrabold text-indigo-600 mt-1">4h 15m</p>
          </Card>
        </div>

        <Card>
          <h2 className="text-lg font-bold text-slate-900 mb-4">
            Ordres d&apos;intervention sur la copropriété
          </h2>
          <div className="space-y-4">
            {requests.map((req) => (
              <div
                key={req.id}
                className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col md:flex-row justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {req.category}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        req.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : req.status === 'in_progress'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {req.status === 'completed'
                        ? 'Clôturé'
                        : req.status === 'in_progress'
                        ? 'En cours'
                        : 'En attente'}
                    </span>
                    {req.location && (
                      <span className="text-xs text-slate-500">📍 {req.location}</span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-slate-900">{req.description}</p>
                  {req.syndicNotes && (
                    <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <strong>Note Syndic :</strong> {req.syndicNotes}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 self-start md:self-center shrink-0">
                  {req.status !== 'completed' && (
                    <Button
                      onClick={() => {
                        setActiveTicketId(req.id);
                        setNextStatus(req.status === 'pending' ? 'in_progress' : 'completed');
                      }}
                    >
                      Mettre à jour l&apos;intervention
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {activeTicketId && (
          <Card className="border-2 border-teal-500">
            <h3 className="text-base font-bold text-slate-900 mb-3">
              Rapport d&apos;intervention technique (Ticket #{activeTicketId})
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Nouvel état d&apos;avancement
                </label>
                <select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as 'in_progress' | 'completed')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  <option value="in_progress">En cours d&apos;intervention sur site</option>
                  <option value="completed">Travaux terminés &amp; vérifiés</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Compte-rendu technique (visible par le Syndic et les Copropriétaires)
                </label>
                <textarea
                  rows={3}
                  value={techNote}
                  onChange={(e) => setTechNote(e.target.value)}
                  placeholder="Décrivez les pièces remplacées, tests effectués et garantie..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setActiveTicketId(null)}>
                  Annuler
                </Button>
                <Button
                  onClick={() => {
                    if (!techNote.trim()) return;
                    updateMutation.mutate({
                      requestId: activeTicketId,
                      status: nextStatus,
                      note: techNote.trim(),
                    });
                  }}
                >
                  Envoyer le rapport
                </Button>
              </div>
            </div>
          </Card>
        )}
      </main>
    </div>
  );
};

// Wrapper to handle Syndic data fetching and Context population
const SyndicDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { currentUser, userProfile } = useAuth();
  const { setSyndicData } = useBuilding();

  const { data: syndics = [], isLoading } = useQuery({
    queryKey: ['syndics'],
    queryFn: getSyndics,
    enabled: !!currentUser,
  });

  useEffect(() => {
    if (syndics.length > 0) {
      const targetSyndic =
        (userProfile?.syndicId &&
          syndics.find((s) => s.id === userProfile.syndicId)) ||
        syndics[0];
      setSyndicData(targetSyndic);
    }
  }, [syndics, userProfile?.syndicId, setSyndicData]);

  if (isLoading) return <Loading message="Chargement des données de la copropriété..." />;

  return <>{children}</>;
};

const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  roles?: UserRole[];
}> = ({ children, roles }) => {
  const { currentUser, userProfile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;

  if (!currentUser || !userProfile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roles && !roles.includes(userProfile.role)) {
    const correctHome = getHomeRouteForRole(userProfile.role);
    return <Navigate to={correctHome} replace />;
  }

  return <>{children}</>;
};

const VIEW_TO_ROUTE: Record<View, string> = {
  dashboard: '/',
  buildings: '/buildings',
  residents: '/residents',
  apartments: '/apartments',
  financials: '/financials',
  announcements: '/announcements',
  documents: '/documents',
  maintenance: '/maintenance',
  ag: '/ag',
  prestataires: '/prestataires',
  chat: '/chat',
  marketplace: '/marketplace',
  analytics: '/analytics',
  settings: '/settings',
};

const AppContent: React.FC = () => {
  const { userProfile } = useAuth();
  const { selectedBuilding, setSelectedBuilding, syndic } = useBuilding();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // --- Global Mutations ---

  const addBuildingMutation = useMutation({
    mutationFn: (data: {
      syndicId: string;
      building: Omit<
        Building,
        | 'id'
        | 'residents'
        | 'apartments'
        | 'announcements'
        | 'documents'
        | 'financials'
        | 'syndicId'
      > & { apartments?: Omit<Apartment, 'id' | 'buildingId'>[] };
    }) => addBuilding(data.syndicId, data.building),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      if (created && 'id' in created) {
        setSelectedBuilding(created as Building);
      }
    },
  });

  const updateBuildingMutation = useMutation({
    mutationFn: (data: {
      buildingId: string;
      updates: Partial<Building> & { syncApartmentFees?: boolean };
    }) => updateBuilding(data.buildingId, data.updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const deleteBuildingMutation = useMutation({
    mutationFn: deleteBuilding,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const addResidentMutation = useMutation({
    mutationFn: (data: {
      resident: Omit<Resident, 'id'>;
      generateCredentials: boolean;
    }) => addResident(data.resident, data.generateCredentials),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const updateResidentMutation = useMutation({
    mutationFn: updateResident,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const deleteResidentMutation = useMutation({
    mutationFn: deleteResident,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const regenerateCredentialsMutation = useMutation({
    mutationFn: regenerateResidentCredentials,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const addApartmentMutation = useMutation({
    mutationFn: addApartment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const addApartmentsBulkMutation = useMutation({
    mutationFn: (data: {
      buildingId: string;
      apartments: Omit<Apartment, 'id' | 'buildingId'>[];
    }) => addApartmentsBulk(data.buildingId, data.apartments),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const rebalanceTantiemesMutation = useMutation({
    mutationFn: rebalanceBuildingTantiemes,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const updateApartmentMutation = useMutation({
    mutationFn: updateApartment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const deleteApartmentMutation = useMutation({
    mutationFn: deleteApartment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const updateSyndicMutation = useMutation({
    mutationFn: saveSyndic,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const addAnnouncementMutation = useMutation({
    mutationFn: ({
      buildingId,
      title,
      content,
    }: {
      buildingId: string;
      title: string;
      content: string;
    }) => addAnnouncement(buildingId, { title, content }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['syndics'] }),
  });

  const generateChargesMutation = useMutation({
    mutationFn: ({ bId, sId }: { bId: string; sId: string }) =>
      generateMonthlyCharges(bId, sId),
    onSuccess: () => {
      if (queryClient) {
        queryClient.invalidateQueries({ queryKey: ['charges'] });
        queryClient.invalidateQueries({ queryKey: ['syndics'] });
      }
    },
  });

  // --- Handlers ---

  const handleAddBuilding = (
    buildingData: Omit<
      Building,
      | 'id'
      | 'residents'
      | 'apartments'
      | 'announcements'
      | 'documents'
      | 'financials'
      | 'syndicId'
    >,
    numApartments: number,
    numberingSystem: 'numeric' | 'alphabetic' | 'floor_numeric',
    floorsCount: number = 4
  ) => {
    if (!syndic) return;

    const planLimits: Record<SubscriptionPlan, number> = {
      starter: 4,
      professional: 8,
      enterprise: Infinity,
    };
    const currentBuildings = syndic.buildings.length;
    const limit = planLimits[syndic.subscriptionPlan];

    if (currentBuildings >= limit) return;

    const generatedApartments: Omit<Apartment, 'id' | 'buildingId'>[] = [];
    const safeFloors = Math.max(1, floorsCount || 4);
    const unitsPerFloor = Math.max(1, Math.ceil(numApartments / safeFloors));
    const baseTantieme = numApartments > 0 ? Math.floor(1000 / numApartments) : 100;

    for (let i = 1; i <= numApartments; i++) {
      const floorIndex = Math.min(
        safeFloors,
        Math.floor((i - 1) / unitsPerFloor) + 1
      );
      const unitOnFloor = ((i - 1) % unitsPerFloor) + 1;
      let number = '';

      if (numberingSystem === 'floor_numeric') {
        number = `${floorIndex}${unitOnFloor < 10 ? `0${unitOnFloor}` : unitOnFloor}`;
      } else if (numberingSystem === 'numeric') {
        number = `${i}`;
      } else {
        let n = i;
        while (n > 0) {
          const remainder = (n - 1) % 26;
          number = String.fromCharCode(65 + remainder) + number;
          n = Math.floor((n - 1) / 26);
        }
      }
      generatedApartments.push({
        number,
        floor: floorIndex,
        area: 80,
        tantiemes:
          i === 1
            ? baseTantieme + (1000 - baseTantieme * numApartments)
            : baseTantieme,
        coproType: 'apartment',
        ownerId: null,
        tenantId: null,
        monthlyFees: buildingData.monthlySyndicFees,
      });
    }

    addBuildingMutation.mutate({
      syndicId: syndic.id,
      building: {
        ...buildingData,
        apartments: generatedApartments,
      },
    });
  };

  const handleAddResident = async (
    residentData: Omit<Resident, 'id' | 'syndicId' | 'buildingId'>,
    generateCredentials?: boolean
  ) => {
    if (!selectedBuilding || !syndic) return;
    const resident = {
      ...residentData,
      syndicId: syndic.id,
      buildingId: selectedBuilding.id,
    };
    return await addResidentMutation.mutateAsync({
      resident,
      generateCredentials: generateCredentials ?? true,
    });
  };

  const handleAddApartment = (
    apartmentData: Omit<Apartment, 'id' | 'buildingId'>
  ) => {
    if (!selectedBuilding) return;
    const apartment = { ...apartmentData, buildingId: selectedBuilding.id };
    addApartmentMutation.mutate(apartment);
  };

  const handleAddApartmentsBulk = (
    apartmentsList: Omit<Apartment, 'id' | 'buildingId'>[]
  ) => {
    if (!selectedBuilding) return;
    addApartmentsBulkMutation.mutate({
      buildingId: selectedBuilding.id,
      apartments: apartmentsList,
    });
  };

  return (
    <Suspense fallback={<Loading message="Chargement du module..." />}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route
            path="/"
            element={
              selectedBuilding ? (
                <Dashboard
                  building={selectedBuilding}
                  onNavigate={(view: View) => {
                    const target = VIEW_TO_ROUTE[view] || '/';
                    navigate(target);
                  }}
                />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />

          <Route
            path="/buildings"
            element={
              <Buildings
                syndic={syndic!}
                onAddBuilding={handleAddBuilding}
                onUpdateBuilding={(buildingId, updates) =>
                  updateBuildingMutation.mutate({ buildingId, updates })
                }
                onDeleteBuilding={(buildingId) =>
                  deleteBuildingMutation.mutate(buildingId)
                }
                onSelectBuilding={(building: Building) => {
                  setSelectedBuilding(building);
                  navigate('/');
                }}
              />
            }
          />

          <Route
            path="/residents"
            element={
              selectedBuilding ? (
                <Residents
                  building={selectedBuilding}
                  onAddResident={handleAddResident}
                  onUpdateResident={updateResidentMutation.mutate}
                  onDeleteResident={deleteResidentMutation.mutate}
                  onRegenerateCredentials={(residentId) =>
                    regenerateCredentialsMutation.mutateAsync(residentId)
                  }
                />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/apartments"
            element={
              selectedBuilding ? (
                <Apartments
                  building={selectedBuilding}
                  residents={selectedBuilding.residents}
                  onAddApartment={handleAddApartment}
                  onAddApartmentsBulk={handleAddApartmentsBulk}
                  onRebalanceTantiemes={() =>
                    rebalanceTantiemesMutation.mutate(selectedBuilding.id)
                  }
                  onUpdateApartment={updateApartmentMutation.mutate}
                  onDeleteApartment={deleteApartmentMutation.mutate}
                />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/financials"
            element={
              selectedBuilding && syndic ? (
                <Financials
                  building={selectedBuilding}
                  syndic={syndic}
                  onAddTransaction={() =>
                    queryClient.invalidateQueries({ queryKey: ['syndics'] })
                  }
                  onGenerateCharges={() =>
                    generateChargesMutation.mutate({
                      bId: selectedBuilding.id,
                      sId: syndic.id,
                    })
                  }
                />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/announcements"
            element={
              selectedBuilding ? (
                <Announcements
                  building={selectedBuilding}
                  announcements={selectedBuilding.announcements}
                  onAddAnnouncement={(data) =>
                    addAnnouncementMutation.mutate({
                      buildingId: selectedBuilding.id,
                      title: data.title,
                      content: data.content,
                    })
                  }
                />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/documents"
            element={
              selectedBuilding ? (
                <Documents
                  building={selectedBuilding}
                  documents={selectedBuilding.documents}
                />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/maintenance"
            element={
              selectedBuilding ? (
                <Maintenance building={selectedBuilding} />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/ag"
            element={
              selectedBuilding ? (
                <AssembleeGenerale building={selectedBuilding} syndic={syndic || undefined} />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/prestataires"
            element={
              selectedBuilding ? (
                <Prestataires building={selectedBuilding} />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/chat"
            element={
              selectedBuilding ? (
                <CommunityChat building={selectedBuilding} />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/marketplace"
            element={
              selectedBuilding ? (
                <MarketplaceView building={selectedBuilding} />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/analytics"
            element={
              selectedBuilding ? (
                <Analytics building={selectedBuilding} />
              ) : (
                <Navigate to="/buildings" replace />
              )
            }
          />

          <Route
            path="/settings"
            element={
              syndic ? (
                <Settings
                  syndic={syndic}
                  onUpdate={updateSyndicMutation.mutate}
                />
              ) : (
                <Loading />
              )
            }
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
};

const LandingRouteWrapper: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const navigate = useNavigate();
  return (
    <LandingPage
      onLoginClick={() => {
        onDone();
        navigate('/login');
      }}
    />
  );
};

const App: React.FC = () => {
  const [showLanding, setShowLanding] = React.useState(true);
  const { currentUser, userProfile, loading } = useAuth();

  useEffect(() => {
    if (!loading && currentUser) {
      setShowLanding(false);
    }
  }, [currentUser, loading]);

  if (loading) return <Loading />;

  return (
    <Router>
      <BuildingProvider>
        <Routes>
          <Route
            path="/welcome"
            element={<LandingRouteWrapper onDone={() => setShowLanding(false)} />}
          />

          <Route
            path="/login"
            element={
              currentUser && userProfile ? (
                <Navigate to={getHomeRouteForRole(userProfile.role)} replace />
              ) : (
                <LoginScreen
                  onLogin={() => setShowLanding(false)}
                  onBack={() => setShowLanding(true)}
                />
              )
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <SyndicDataProvider>
                  <AdminDashboard />
                </SyndicDataProvider>
              </ProtectedRoute>
            }
          />

          <Route
            path="/resident"
            element={
              <ProtectedRoute roles={['resident']}>
                <SyndicDataProvider>
                  <ResidentDashboard />
                </SyndicDataProvider>
              </ProtectedRoute>
            }
          />

          <Route
            path="/provider"
            element={
              <ProtectedRoute roles={['provider']}>
                <SyndicDataProvider>
                  <ProviderPortal />
                </SyndicDataProvider>
              </ProtectedRoute>
            }
          />

          <Route
            path="/*"
            element={
              showLanding && !currentUser ? (
                <LandingRouteWrapper onDone={() => setShowLanding(false)} />
              ) : (
                <ProtectedRoute roles={['syndic']}>
                  <SyndicDataProvider>
                    <AppContent />
                  </SyndicDataProvider>
                </ProtectedRoute>
              )
            }
          />
        </Routes>
      </BuildingProvider>
    </Router>
  );
};

export default App;

