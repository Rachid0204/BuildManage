

import React, { Suspense } from 'react';

import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';
import { getBuildingCapacity } from '../../utils/subscriptionPolicy';
import { useBuilding } from '../../contexts/BuildingContext';
import { useI18n } from '../../hooks/useI18n';
import DashboardLayout from '../../components/layout/DashboardLayout';
import Loading from '../../components/common/Loading';

import { saveSyndic, addBuilding, updateBuilding, deleteBuilding, addResident, updateResident, deleteResident, regenerateResidentCredentials, addApartment, addApartmentsBulk, rebalanceBuildingTantiemes, updateApartment, deleteApartment, generateMonthlyCharges, addAnnouncement } from '../../firebase/services';
import type { Building, Resident, Apartment, View } from '../../types';

import RouteErrorBoundary from '../common/RouteErrorBoundary';
// Lazy load views for performance
const Dashboard = React.lazy(() => import('../../components/views/Dashboard'));
const Buildings = React.lazy(() => import('../../components/views/Buildings'));
const Residents = React.lazy(() => import('../../components/views/Residents'));
const Apartments = React.lazy(() => import('../../components/views/Apartments'));
const Announcements = React.lazy(() =>
  import('../../components/views/Announcements')
);
const Documents = React.lazy(() => import('../../components/views/Documents'));
const Financials = React.lazy(() => import('../../components/views/Financials'));
const Maintenance = React.lazy(() => import('../../components/views/Maintenance'));
const AssembleeGenerale = React.lazy(() => import('../../components/views/AssembleeGenerale'));
const Prestataires = React.lazy(() => import('../../components/views/Prestataires'));
const CommunityChat = React.lazy(() => import('../../components/views/CommunityChat'));
const MarketplaceView = React.lazy(() => import('../../components/views/MarketplaceView'));
const Analytics = React.lazy(() => import('../../components/views/Analytics'));
const Settings = React.lazy(() => import('../../components/views/Settings'));

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

const SyndicPortal: React.FC = () => {
  const { userProfile } = useAuth();
  const { selectedBuilding: storedBuilding, setSelectedBuilding, syndic } = useBuilding();
  const selectedBuilding = storedBuilding || syndic?.buildings[0] || null;
  const { tr } = useI18n();
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
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      if (created && created.hasAccount) {

      }
    },
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
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      if (updated && updated.hasAccount) {

      }
    },
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
    if (!syndic) throw new Error(tr('Sélectionnez un cabinet avant de continuer.', 'حدد مكتباً قبل المتابعة.'));

    if (!getBuildingCapacity(syndic).canAdd) throw new Error(tr('Limite du forfait atteinte. Changez de forfait pour ajouter un immeuble.', 'تم بلوغ حد الاشتراك. غيّر الاشتراك لإضافة عمارة.'));

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
        monthlyFees: buildingData.monthlySyndicFees ?? 0,
      });
    }

    return addBuildingMutation.mutateAsync({
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
    if (!selectedBuilding || !syndic) throw new Error(tr('Sélectionnez un immeuble avant de continuer.', 'حدد عمارة قبل المتابعة.'));
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
    if (!selectedBuilding) throw new Error(tr('Sélectionnez un immeuble avant de continuer.', 'حدد عمارة قبل المتابعة.'));
    const apartment = { ...apartmentData, buildingId: selectedBuilding.id };
    return addApartmentMutation.mutateAsync(apartment);
  };

  const handleAddApartmentsBulk = (
    apartmentsList: Omit<Apartment, 'id' | 'buildingId'>[]
  ) => {
    if (!selectedBuilding) throw new Error(tr('Sélectionnez un immeuble avant de continuer.', 'حدد عمارة قبل المتابعة.'));
    return addApartmentsBulkMutation.mutateAsync({
      buildingId: selectedBuilding.id,
      apartments: apartmentsList,
    });
  };

  if (userProfile && userProfile.role !== 'syndic') {
    return <Navigate to={getHomeRouteForRole(userProfile.role)} replace />;
  }

  return (
    <RouteErrorBoundary>
      <Suspense fallback={<Loading message={tr('Chargement du module...', 'جاري تحميل الوحدة...')} />}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route
              path="/"
              element={
                selectedBuilding ? (
                  <Dashboard
                    building={selectedBuilding}
                    syndic={syndic || undefined}
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
                syndic ? (
                  <Buildings
                    syndic={syndic}
                    onAddBuilding={handleAddBuilding}
                    onUpdateBuilding={(buildingId, updates) =>
                      updateBuildingMutation.mutateAsync({ buildingId, updates })
                    }
                    onDeleteBuilding={(buildingId) =>
                      deleteBuildingMutation.mutateAsync(buildingId)
                    }
                    onSelectBuilding={(building: Building) => {
                      setSelectedBuilding(building);
                      navigate('/');
                    }}
                  />
                ) : (
                  <Loading />
                )
              }
            />

            <Route
              path="/residents"
              element={
                selectedBuilding ? (
                  <Residents
                    building={selectedBuilding}
                    onAddResident={handleAddResident}
                    onUpdateResident={updateResidentMutation.mutateAsync}
                    onDeleteResident={deleteResidentMutation.mutateAsync}
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
                    onUpdateApartment={updateApartmentMutation.mutateAsync}
                    onDeleteApartment={deleteApartmentMutation.mutateAsync}
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
                    onUpdate={(updatedSyndic) => updateSyndicMutation.mutateAsync(updatedSyndic)}
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
    </RouteErrorBoundary>
  );
};

export default SyndicPortal;
