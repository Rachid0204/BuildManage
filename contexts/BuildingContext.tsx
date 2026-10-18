
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Building, Syndic } from '../types';

interface BuildingContextType {
    selectedBuildingId: string | null;
    setSelectedBuildingId: (id: string | null) => void;
    selectedBuilding: Building | null;
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
    const selectedBuilding = buildings.find(b => b.id === selectedBuildingId) || null;

    // Auto-select first building if none selected and buildings exist
    useEffect(() => {
        if (buildings.length > 0 && !selectedBuildingId) {
            setSelectedBuildingId(buildings[0].id);
        }
    }, [buildings, selectedBuildingId]);

    return (
        <BuildingContext.Provider value={{
            selectedBuildingId,
            setSelectedBuildingId,
            selectedBuilding,
            buildings,
            syndic,
            setSyndicData: setSyndic
        }}>
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
