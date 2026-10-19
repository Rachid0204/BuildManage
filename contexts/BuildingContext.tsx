import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(() => {
    try {
      return localStorage.getItem('syndik_selected_building_id');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!syndic) {
      setSelectedBuildingId(null);
      return;
    }
    try {
      const tenantScopedId = localStorage.getItem(getTenantBuildingStorageKey(syndic.id));
      if (tenantScopedId && syndic.buildings.some((b) => b.id === tenantScopedId)) {
        setSelectedBuildingId(tenantScopedId);
      } else if (syndic.buildings.length > 0) {
        setSelectedBuildingId(syndic.buildings[0].id);
      } else {
        setSelectedBuildingId(null);
      }
    } catch {
      // Ignore storage access errors
    }
  }, [syndic]);

  useEffect(() => {
    try {
      if (selectedBuildingId && syndic?.id) {
        localStorage.setItem(getTenantBuildingStorageKey(syndic.id), selectedBuildingId);
        localStorage.setItem('syndik_selected_building_id', selectedBuildingId);
      } else if (syndic?.id) {
        localStorage.removeItem(getTenantBuildingStorageKey(syndic.id));
      }
    } catch {
      // Ignore storage access errors
    }
  }, [selectedBuildingId, syndic?.id]);

  const buildings = syndic?.buildings || [];

  // Derived state
  const selectedBuilding = buildings.find((b) => b.id === selectedBuildingId) || null;

  const setSelectedBuilding = useCallback((building: Building | null) => {
    setSelectedBuildingId(building ? building.id : null);
  }, []);

  // Auto-select first building if none selected or if selected building was deleted
  useEffect(() => {
    if (buildings.length > 0) {
      const exists = buildings.some((b) => b.id === selectedBuildingId);
      if (!selectedBuildingId || !exists) {
        setSelectedBuildingId(buildings[0].id);
      }
    } else if (selectedBuildingId) {
      setSelectedBuildingId(null);
    }
  }, [buildings, selectedBuildingId]);

  return (
    <BuildingContext.Provider
      value={{
        selectedBuildingId,
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
