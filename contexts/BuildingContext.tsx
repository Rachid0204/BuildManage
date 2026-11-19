import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Building, Syndic } from '../types';

interface BuildingContextType {
  selectedBuildingId: string | null;
  setSelectedBuildingId: (id: string | null) => void;
  selectedBuilding: Building | null;
  setSelectedBuilding: (building: Building | null) => void;
  buildings: Building[];
  syndic: Syndic | null;
  setSyndicData: (syndic: Syndic | null) => void;
}

const BuildingContext = createContext<BuildingContextType | undefined>(undefined);

const getTenantBuildingStorageKey = (syndicId?: string | null) =>
  syndicId ? `syndik_selected_building_id:${syndicId}` : 'syndik_selected_building_id';

export const BuildingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [syndic, setSyndic] = useState<Syndic | null>(null);
  const [selectedBuildingIdState, setSelectedBuildingIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('syndik_selected_building_id');
    } catch {
      return null;
    }
  });
  const prevSyndicIdRef = useRef<string | null>(null);
  const pendingBuildingIdRef = useRef<string | null>(null);
  const syndicIdRef = useRef<string | null>(null);
  syndicIdRef.current = syndic?.id ?? null;

  const buildings = useMemo(
    () => (syndic?.buildings || []).filter((b) => !b.archivedAt),
    [syndic]
  );

  const persistSelection = useCallback((id: string | null, activeSyndicId?: string | null) => {
    try {
      const targetSyndicId = activeSyndicId ?? syndicIdRef.current;
      if (id && targetSyndicId) {
        localStorage.setItem(getTenantBuildingStorageKey(targetSyndicId), id);
        localStorage.setItem('syndik_selected_building_id', id);
      } else if (!id && targetSyndicId) {
        localStorage.removeItem(getTenantBuildingStorageKey(targetSyndicId));
      }
    } catch {
      // Ignore storage access errors
    }
  }, []);

  const setSelectedBuildingId = useCallback(
    (id: string | null) => {
      if (id && !buildings.some((b) => b.id === id)) {
        // Track newly created building IDs while ['syndics'] refetches so fallback effects do not snap back.
        pendingBuildingIdRef.current = id;
      } else {
        pendingBuildingIdRef.current = null;
      }
      setSelectedBuildingIdState(id);
      persistSelection(id);
    },
    [buildings, persistSelection]
  );

  useEffect(() => {
    const handleLogout = () => {
      prevSyndicIdRef.current = null;
      pendingBuildingIdRef.current = null;
      setSyndic(null);
      setSelectedBuildingIdState(null);
    };
    window.addEventListener('syndik-user-logout', handleLogout);
    return () => window.removeEventListener('syndik-user-logout', handleLogout);
  }, []);

  // Hydrate from localStorage ONLY when syndic?.id transitions (login / cabinet switch / logout),
  // never on routine React Query / SSE refreshes of the same cabinet.
  useEffect(() => {
    const currentSyndicId = syndic?.id ?? null;
    if (prevSyndicIdRef.current === currentSyndicId) return;
    prevSyndicIdRef.current = currentSyndicId;
    pendingBuildingIdRef.current = null;

    if (!currentSyndicId) {
      setSelectedBuildingIdState(null);
      return;
    }

    try {
      const tenantScopedId = localStorage.getItem(getTenantBuildingStorageKey(currentSyndicId));
      if (tenantScopedId && buildings.some((b) => b.id === tenantScopedId)) {
        setSelectedBuildingIdState(tenantScopedId);
        return;
      }
    } catch {
      // Ignore storage access errors
    }

    const fallbackId = buildings[0]?.id ?? null;
    setSelectedBuildingIdState(fallbackId);
    persistSelection(fallbackId, currentSyndicId);
  }, [syndic?.id, buildings, persistSelection]);

  // Clear pending marker once the newly created building arrives in buildings,
  // and only fall back to buildings[0] if the current selection was genuinely removed/archived.
  useEffect(() => {
    if (!syndic?.id) return;
    if (
      pendingBuildingIdRef.current &&
      buildings.some((b) => b.id === pendingBuildingIdRef.current)
    ) {
      const arrivedId = pendingBuildingIdRef.current;
      pendingBuildingIdRef.current = null;
      if (selectedBuildingIdState !== arrivedId) {
        setSelectedBuildingIdState(arrivedId);
      }
      persistSelection(arrivedId, syndic.id);
      return;
    }

    if (
      pendingBuildingIdRef.current &&
      selectedBuildingIdState === pendingBuildingIdRef.current
    ) {
      return;
    }

    if (buildings.length > 0) {
      const exists = buildings.some((b) => b.id === selectedBuildingIdState);
      if (!selectedBuildingIdState || !exists) {
        const nextId = buildings[0].id;
        setSelectedBuildingIdState(nextId);
        persistSelection(nextId, syndic.id);
      }
    } else if (selectedBuildingIdState) {
      setSelectedBuildingIdState(null);
      persistSelection(null, syndic.id);
    }
  }, [syndic?.id, buildings, selectedBuildingIdState, persistSelection]);

  // Derived state
  const selectedBuilding = buildings.find((b) => b.id === selectedBuildingIdState) || null;

  const setSelectedBuilding = useCallback(
    (building: Building | null) => {
      setSelectedBuildingId(building ? building.id : null);
    },
    [setSelectedBuildingId]
  );

  return (
    <BuildingContext.Provider
      value={{
        selectedBuildingId: selectedBuildingIdState,
        setSelectedBuildingId,
        selectedBuilding,
        setSelectedBuilding,
        buildings,
        syndic,
        setSyndicData: setSyndic,
      }}
    >
      {children}
    </BuildingContext.Provider>
  );
};

export const useBuilding = () => {
  const context = useContext(BuildingContext);
  if (context === undefined) {
    throw new Error('useBuilding must be used within a BuildingProvider');
  }
  return context;
};
