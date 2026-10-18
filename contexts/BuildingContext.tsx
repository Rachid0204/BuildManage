import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Building, Syndic } from '../types';

interface BuildingContextType {
  selectedBuildingId: string | null;
  setSelectedBuildingId: (id: string | null) => void;
  selectedBuilding: Building | null;
  setSelectedBuilding: (building: Building | null) => void;
  buildings: Building[];
  syndic: Syndic | null;
  setSyndicData: (syndic: Syndic) => void;
}

const BuildingContext = createContext<BuildingContextType | undefined>(undefined);

export const BuildingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(() => {
    return localStorage.getItem('syndik_selected_building_id');
  });
  const [syndic, setSyndic] = useState<Syndic | null>(null);

  useEffect(() => {
    if (selectedBuildingId) {
      localStorage.setItem('syndik_selected_building_id', selectedBuildingId);
    } else {
      localStorage.removeItem('syndik_selected_building_id');
    }
  }, [selectedBuildingId]);

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
