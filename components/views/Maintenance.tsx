import React, { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getMaintenanceRequestsForBuilding,
  updateMaintenanceRequest,
  addMaintenanceRequest,
  getPrestatairesForBuilding,
} from '../../firebase/services';
import type { Building, MaintenanceRequest } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import Loading from '../common/Loading';
import { WrenchIcon, PlusIcon, PencilIcon } from '../icons/IconComponents';

interface MaintenanceProps {
  building: Building;
  isResidentPortal?: boolean;
  currentResidentId?: string;
  currentResidentName?: string;
  currentApartmentNumber?: string;
}

const CATEGORY_META: Record<
  MaintenanceRequest['category'],
  { label: string; icon: string; badgeClass: string }
> = {
  elevator: {
    label: 'Ascenseur & Monte-charge',
    icon: '🛗',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
  },
  plumbing: {
    label: 'Plomberie & Canalisation',
    icon: '🚰',
    badgeClass: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  },
  electrical: {
    label: 'Électricité & Éclairage',
    icon: '⚡',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  common_area: {
    label: 'Parties Communes & Hall',
    icon: '🏢',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
  },
  cleaning: {
    label: 'Propreté & Hygiène',
    icon: '🧹',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  security: {
    label: 'Sécurité, Portail & Accès',
    icon: '🛡️',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
  other: {
    label: 'Autre Intervention',
    icon: '🔧',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
  },
};

const SAMPLE_MAINTENANCE_PHOTOS = [
  {
    label: 'Ascenseur / Machinerie',
    url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: 'Plomberie / Vanne eau',
    url: 'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: 'Éclairage / Parties communes',
    url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800&auto=format&fit=crop&q=80',
  },
  {
    label: 'Chantier / Réparation',
    url: 'https://images.unsplash.com/photo-1541888946425-d09bb18086f6?w=800&auto=format&fit=crop&q=80',
  },
];

const currencyFormatter = new Intl.NumberFormat('fr-MA', {
  style: 'currency',
  currency: 'MAD',
  maximumFractionDigits: 0,
});

// Compress uploaded image files via HTML5 Canvas
const compressPhotoFile = (file: File, maxWidth = 1100, maxHeight = 1100, quality = 0.8): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width / height > maxWidth / maxHeight) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(event.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// Visual 4-Stage Progress Stepper
const MaintenanceProgressStepper: React.FC<{ request: MaintenanceRequest }> = ({ request }) => {
  // Determine active stage (1 to 4)
  // Stage 1: Signalé / Reçu
  // Stage 2: Pris en charge & Artisan assigné
  // Stage 3: Intervention en cours sur site
  // Stage 4: Clôturé & Vérifié
  let activeStage = 1;
  if (request.status === 'completed') {
    activeStage = 4;
  } else if (request.status === 'in_progress') {
    activeStage = request.updates && request.updates.length >= 2 ? 3 : 2;
  } else if (request.assignedTo) {
    activeStage = 2;
  }

  const stages = [
    {
      step: 1,
      label: '1. Signalé & Reçu',
      sub: new Date(request.createdAt).toLocaleDateString('fr-MA'),
    },
    {
      step: 2,
      label: '2. Artisan Assigné',
      sub: request.assignedTo ? request.assignedTo : 'En attente syndic',
    },
    {
      step: 3,
      label: '3. Travaux en cours',
      sub:
        activeStage >= 3
          ? `${request.updates?.length || 1} note(s) de suivi`
          : 'Intervention sur site',
    },
    {
      step: 4,
      label: '4. Résolu & Vérifié',
      sub: request.completedAt
        ? new Date(request.completedAt).toLocaleDateString('fr-MA')
        : 'Clôture finale',
    },
  ];

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Suivi d'avancement en temps réel
        </span>
        <span className="text-[11px] font-mono font-bold text-teal-800">
          Étape {activeStage} / 4 ({Math.round((activeStage / 4) * 100)}%)
        </span>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden mb-3">
        <div
          className={`h-full transition-all duration-500 rounded-full ${
            request.status === 'completed'
              ? 'bg-emerald-600'
              : request.status === 'in_progress'
              ? 'bg-teal-600'
              : 'bg-amber-500'
          }`}
          style={{ width: `${(activeStage / 4) * 100}%` }}
        />
      </div>

      {/* 4 Stage Nodes */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stages.map((st) => {
          const isDone = activeStage >= st.step;
          const isCurrent = activeStage === st.step;
          return (
            <div
              key={st.step}
              className={`p-2 rounded-lg border text-xs transition-all ${
                isCurrent
                  ? 'bg-white border-teal-500 ring-1 ring-teal-500 shadow-xs'
                  : isDone
                  ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                  : 'bg-white/60 border-slate-200 text-slate-400'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold">
                <span
                  className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center shrink-0 ${
                    isDone
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  {isDone ? '✓' : st.step}
                </span>
                <span className="truncate text-[11px]">{st.label}</span>
              </div>
              <div className="text-[10px] truncate mt-0.5 pl-5 font-mono opacity-80">
                {st.sub}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Maintenance: React.FC<MaintenanceProps> = ({
  building,
  isResidentPortal = false,
  currentResidentId = 'res-2',
  currentResidentName = 'Fatima Zahra Mansouri',
  currentApartmentNumber = 'Lot A-102',
}) => {
  const queryClient = useQueryClient();
  const updatePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const newTicketPhotoInputRef = useRef<HTMLInputElement | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [residentScope, setResidentScope] = useState<'all_building' | 'mine'>('all_building');
  const [searchQuery, setSearchQuery] = useState('');

  // Expanded timeline view on cards
  const [expandedTicketIds, setExpandedTicketIds] = useState<Record<string, boolean>>({
    'maint-1': true,
  });

  // Lightbox photo preview
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);

  // Update / Transparency Note Modal State (Syndic or Resident follow-up)
  const [selectedRequest, setSelectedRequest] = useState<MaintenanceRequest | null>(null);
  const [editStatus, setEditStatus] = useState<MaintenanceRequest['status']>('in_progress');
  const [editAssignedTo, setEditAssignedTo] = useState('');
  const [editCost, setEditCost] = useState('');
  const [editInvoiceRef, setEditInvoiceRef] = useState('');
  const [stepTitle, setStepTitle] = useState('');
  const [stepNote, setStepNote] = useState('');
  const [stepPhotos, setStepPhotos] = useState<string[]>([]);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);

  // Create New Maintenance Ticket Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newCategory, setNewCategory] = useState<MaintenanceRequest['category']>('elevator');
  const [newPriority, setNewPriority] = useState<MaintenanceRequest['priority']>('medium');
  const [newDescription, setNewDescription] = useState('');
  const [newPhotos, setNewPhotos] = useState<string[]>([]);

  // Banner Feedback
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['maintenance', building.id],
    queryFn: () => getMaintenanceRequestsForBuilding(building.id),
    enabled: !!building.id,
  });

  const { data: prestataires = [] } = useQuery({
    queryKey: ['prestataires', building.id],
    queryFn: () => getPrestatairesForBuilding(building.id),
    enabled: !!building.id,
  });

  const residentMap = useMemo(
    () => new Map(building.residents.map((r) => [r.id, r])),
    [building.residents]
  );

  const updateMutation = useMutation({
    mutationFn: (variables: {
      id: string;
      updates: Partial<MaintenanceRequest>;
      stepInfo: {
        title?: string;
        note?: string;
        updatedBy?: string;
        updatedByRole?: 'syndic' | 'resident' | 'provider';
        stepPhotos?: string[];
      };
    }) => updateMaintenanceRequest(variables.id, variables.updates, variables.stepInfo),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      setSelectedRequest(null);
      setExpandedTicketIds((prev) => ({ ...prev, [vars.id]: true }));
      setBannerMessage('Le suivi du ticket de maintenance a été mis à jour avec succès.');
      setTimeout(() => setBannerMessage(null), 4000);
    },
  });

  const createMutation = useMutation({
    mutationFn: addMaintenanceRequest,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
      setIsCreateModalOpen(false);
      setNewTitle('');
      setNewLocation('');
      setNewDescription('');
      setNewPhotos([]);
      setExpandedTicketIds((prev) => ({ ...prev, [created.id]: true }));
      setBannerMessage('Votre signalement a été enregistré et transmis au Syndic avec suivi en direct.');
      setTimeout(() => setBannerMessage(null), 4000);
    },
  });

  const handleOpenUpdateModal = (req: MaintenanceRequest) => {
    setSelectedRequest(req);
    setEditStatus(req.status);
    setEditAssignedTo(req.assignedTo || '');
    setEditCost(req.cost !== undefined ? String(req.cost) : '');
    setEditInvoiceRef(req.invoiceRef || '');
    setStepTitle(
      isResidentPortal
        ? 'Observation complémentaire du copropriétaire'
        : req.status === 'pending'
        ? 'Prise en charge & Assignation du prestataire'
        : 'Point d\'avancement de l\'intervention'
    );
    setStepNote('');
    setStepPhotos([]);
  };

  const handleSaveUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRequest) return;

    const updates: Partial<MaintenanceRequest> = {
      status: isResidentPortal ? selectedRequest.status : editStatus,
      assignedTo: isResidentPortal ? selectedRequest.assignedTo : editAssignedTo || undefined,
      cost: isResidentPortal
        ? selectedRequest.cost
        : editCost
        ? parseFloat(editCost)
        : undefined,
      invoiceRef: isResidentPortal ? selectedRequest.invoiceRef : editInvoiceRef || undefined,
      syndicNotes: !isResidentPortal && stepNote.trim() ? stepNote.trim() : selectedRequest.syndicNotes,
    };

    if (!isResidentPortal && editStatus === 'completed' && selectedRequest.status !== 'completed') {
      updates.completedAt = new Date().toISOString();
    }

    updateMutation.mutate({
      id: selectedRequest.id,
      updates,
      stepInfo: {
        title:
          stepTitle.trim() ||
          (isResidentPortal ? 'Note du résident' : 'Mise à jour du statut par le Syndic'),
        note:
          stepNote.trim() ||
          (editStatus === 'completed'
            ? 'Travaux achevés et réceptionnés sans réserve.'
            : `Mise à jour du dossier (${editAssignedTo || 'Syndic'}).`),
        updatedBy: isResidentPortal
          ? `${currentResidentName} (${currentApartmentNumber})`
          : 'SyndicPro Gestion (Bureau Syndic)',
        updatedByRole: isResidentPortal ? 'resident' : 'syndic',
        stepPhotos,
      },
    });
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDescription.trim()) return;

    createMutation.mutate({
      buildingId: building.id,
      residentId: isResidentPortal ? currentResidentId : building.residents[0]?.id || 'res-1',
      residentName: isResidentPortal ? currentResidentName : 'SyndicPro Gestion (Inspection)',
      apartmentNumber: isResidentPortal ? currentApartmentNumber : 'Parties Communes',
      title: newTitle.trim() || `${CATEGORY_META[newCategory].label} — ${newLocation || 'Immeuble'}`,
      location: newLocation.trim() || 'Parties communes de la résidence',
      category: newCategory,
      priority: newPriority,
      description: newDescription.trim(),
      status: 'pending',
      photos: newPhotos,
      photoUrl: newPhotos[0],
      createdAt: new Date().toISOString(),
    });
  };

  const handleUploadFiles = async (
    files: FileList | null,
    targetSetter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    if (!files || files.length === 0) return;
    setIsUploadingPhotos(true);
    try {
      const validFiles = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 4);
      const compressed = await Promise.all(validFiles.map((f) => compressPhotoFile(f)));
      targetSetter((prev) => [...prev, ...compressed].slice(0, 5));
    } finally {
      setIsUploadingPhotos(false);
    }
  };

  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (isResidentPortal && residentScope === 'mine' && req.residentId !== currentResidentId) {
        return false;
      }
      if (statusFilter !== 'all' && req.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && req.priority !== priorityFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchDesc = req.description.toLowerCase().includes(q);
        const matchTitle = (req.title || '').toLowerCase().includes(q);
        const matchLoc = (req.location || '').toLowerCase().includes(q);
        const matchProvider = (req.assignedTo || '').toLowerCase().includes(q);
        if (!matchDesc && !matchTitle && !matchLoc && !matchProvider) return false;
      }
      return true;
    });
  }, [requests, isResidentPortal, residentScope, currentResidentId, statusFilter, priorityFilter, searchQuery]);

  // KPI Metrics
  const stats = useMemo(() => {
    const total = requests.length;
    const pending = requests.filter((r) => r.status === 'pending').length;
    const inProgress = requests.filter((r) => r.status === 'in_progress').length;
    const completed = requests.filter((r) => r.status === 'completed').length;
    const totalCost = requests.reduce((sum, r) => sum + (r.cost || 0), 0);
    return { total, pending, inProgress, completed, totalCost };
  }, [requests]);

  if (isLoading) return <Loading message="Chargement du suivi des interventions..." />;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span className="p-1.5 bg-teal-100 text-teal-800 rounded-lg">
                <WrenchIcon />
              </span>
              <span>Suivi des Incidents & Travaux de Maintenance</span>
            </h1>
            <span className="text-xs bg-teal-50 text-teal-800 border border-teal-200 font-semibold px-2.5 py-0.5 rounded-full">
              Transparence Syndic & Copropriétaires
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Suivez chaque réclamation étape par étape avec notes techniques du Syndic, prestataires mandatés et photos d'intervention ({building.name}).
          </p>
        </div>

        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="text-xs sm:text-sm font-bold flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white shrink-0 shadow-xs"
        >
          <PlusIcon />
          <span>{isResidentPortal ? 'Signaler un incident' : 'Nouveau ticket travaux'}</span>
        </Button>
      </div>

      {/* Confirmation Banner */}
      {bannerMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-semibold flex items-center justify-between">
          <span>✅ {bannerMessage}</span>
          <button onClick={() => setBannerMessage(null)} className="text-emerald-700 hover:text-emerald-950">
            ✕
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="p-3.5 border border-slate-200 bg-white">
          <div className="text-[11px] font-semibold uppercase text-slate-500">Total Dossiers</div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{stats.total}</div>
          <div className="text-[10px] text-slate-400">Parties communes & lots</div>
        </Card>
        <Card className="p-3.5 border border-amber-200 bg-amber-50/40">
          <div className="text-[11px] font-semibold uppercase text-amber-800">En Attente</div>
          <div className="text-2xl font-bold font-mono text-amber-900 mt-1">{stats.pending}</div>
          <div className="text-[10px] text-amber-700">À assigner au prestataire</div>
        </Card>
        <Card className="p-3.5 border border-blue-200 bg-blue-50/40">
          <div className="text-[11px] font-semibold uppercase text-blue-800">En Cours</div>
          <div className="text-2xl font-bold font-mono text-blue-900 mt-1">{stats.inProgress}</div>
          <div className="text-[10px] text-blue-700">Artisan sur site</div>
        </Card>
        <Card className="p-3.5 border border-emerald-200 bg-emerald-50/40">
          <div className="text-[11px] font-semibold uppercase text-emerald-800">Résolus & Vérifiés</div>
          <div className="text-2xl font-bold font-mono text-emerald-900 mt-1">{stats.completed}</div>
          <div className="text-[10px] text-emerald-700">Clôturés avec preuves</div>
        </Card>
        <Card className="p-3.5 border border-slate-200 bg-slate-900 text-white col-span-2 sm:col-span-1">
          <div className="text-[11px] font-semibold uppercase text-slate-300">Coût Engagé</div>
          <div className="text-xl font-bold font-mono text-amber-400 mt-1">
            {currencyFormatter.format(stats.totalCost)}
          </div>
          <div className="text-[10px] text-slate-400">Factures & devis validés</div>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isResidentPortal && (
            <div className="flex items-center bg-slate-100 p-1 rounded-lg me-2">
              <button
                type="button"
                onClick={() => setResidentScope('all_building')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                  residentScope === 'all_building'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🏢 Tout l'immeuble ({requests.length})
              </button>
              <button
                type="button"
                onClick={() => setResidentScope('mine')}
                className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all ${
                  residentScope === 'mine'
                    ? 'bg-white text-teal-800 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                👤 Mes signalements ({requests.filter((r) => r.residentId === currentResidentId).length})
              </button>
            </div>
          )}

          {[
            { id: 'all', label: 'Tous les statuts' },
            { id: 'pending', label: '⏳ Reçus / En attente' },
            { id: 'in_progress', label: '🔧 En cours d\'intervention' },
            { id: 'completed', label: '✅ Résolus & Clôturés' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                statusFilter === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as any)}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 font-medium"
          >
            <option value="all">Toutes urgences</option>
            <option value="high">🔴 Urgence Haute</option>
            <option value="medium">🟠 Urgence Moyenne</option>
            <option value="low">🟢 Normale</option>
          </select>

          <div className="relative flex-1 sm:w-56">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Rechercher ascenseur, fuite, artisan..."
              className="w-full text-xs pl-7 pr-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <span className="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
          </div>
        </div>
      </div>

      {/* Maintenance Tracker Cards List */}
      <div className="space-y-4">
        {filteredRequests.map((req) => {
          const catMeta = CATEGORY_META[req.category] || CATEGORY_META.other;
          const resObj = residentMap.get(req.residentId);
          const displayResident = req.residentName || resObj?.name || 'Copropriétaire';
          const displayLot = req.apartmentNumber || (resObj?.apartmentId ? `Lot ${resObj.apartmentId}` : 'Parties Communes');
          const isExpanded = !!expandedTicketIds[req.id];
          const allPhotos = req.photos && req.photos.length > 0 ? req.photos : req.photoUrl ? [req.photoUrl] : [];
          const updatesList = req.updates || [];

          return (
            <Card
              key={req.id}
              className="p-5 border border-slate-200 hover:border-slate-300 transition-all bg-white space-y-4"
            >
              {/* Top Row: Badges, Title, Actions */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                      #{req.id.toUpperCase()}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${catMeta.badgeClass}`}
                    >
                      <span>{catMeta.icon}</span>
                      <span>{catMeta.label}</span>
                    </span>
                    <span
                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase ${
                        req.priority === 'high'
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : req.priority === 'medium'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      }`}
                    >
                      {req.priority === 'high'
                        ? '🔴 Urgente'
                        : req.priority === 'medium'
                        ? '🟠 Moyenne'
                        : '🟢 Normale'}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        req.status === 'completed'
                          ? 'bg-emerald-600 text-white'
                          : req.status === 'in_progress'
                          ? 'bg-blue-600 text-white'
                          : 'bg-amber-500 text-white'
                      }`}
                    >
                      {req.status === 'completed'
                        ? '✓ Résolu & Vérifié'
                        : req.status === 'in_progress'
                        ? '🔧 En cours d\'intervention'
                        : '⏳ Reçu / En attente'}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900">
                    {req.title || req.description}
                  </h3>

                  <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
                    <span>
                      📍 <strong>Localisation :</strong> {req.location || 'Parties communes'}
                    </span>
                    <span>·</span>
                    <span>
                      👤 <strong>Signalé par :</strong> {displayResident} ({displayLot})
                    </span>
                    <span>·</span>
                    <span className="font-mono">
                      📅 {new Date(req.createdAt).toLocaleDateString('fr-MA')}
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenUpdateModal(req)}
                    className="px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white font-bold text-xs flex items-center gap-1.5 shadow-2xs transition-colors"
                  >
                    <PencilIcon />
                    <span>
                      {isResidentPortal
                        ? 'Ajouter note / photo'
                        : 'Mettre à jour statut & suivi'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Description & Syndic Transparency Summary */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2">
                  <div className="text-[11px] font-bold uppercase text-slate-400">
                    Description de l'incident
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">{req.description}</p>

                  {req.syndicNotes && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <div className="text-[11px] font-bold text-teal-800 flex items-center gap-1">
                        <span>🏢</span>
                        <span>Dernière note officielle du Syndic :</span>
                      </div>
                      <p className="text-xs text-slate-800 mt-0.5 italic">« {req.syndicNotes} »</p>
                    </div>
                  )}
                </div>

                {/* Provider & Cost Transparency Box */}
                <div className="lg:col-span-5 bg-teal-50/50 p-3.5 rounded-xl border border-teal-200/80 flex flex-col justify-between gap-2 text-xs">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Prestataire mandaté :</span>
                      <span className="font-bold text-slate-900">
                        {req.assignedTo || 'En attente de désignation'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Coût / Devis TTC :</span>
                      <span className="font-mono font-bold text-teal-900">
                        {req.cost ? currencyFormatter.format(req.cost) : 'Non chiffré'}
                      </span>
                    </div>
                    {req.invoiceRef && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">Réf. Pièce / Facture :</span>
                        <span className="font-mono text-[11px] bg-white px-2 py-0.5 rounded border border-teal-200 text-teal-900">
                          {req.invoiceRef}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Attached Photos Strip */}
                  {allPhotos.length > 0 && (
                    <div className="pt-2 border-t border-teal-200/60">
                      <div className="text-[10px] font-bold uppercase text-teal-900 mb-1.5">
                        📷 Photos jointes au dossier ({allPhotos.length}) :
                      </div>
                      <div className="flex items-center gap-2 overflow-x-auto">
                        {allPhotos.map((photo, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setLightboxPhoto(photo)}
                            className="relative w-14 h-14 rounded-lg overflow-hidden border border-teal-300 shrink-0 group hover:scale-95 transition-transform"
                            title="Agrandir la photo"
                          >
                            <img
                              src={photo}
                              alt={`Preuve ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-[10px] font-bold">
                              🔍
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 4-Stage Visual Progress Stepper */}
              <MaintenanceProgressStepper request={req} />

              {/* Collapsible Detailed Audit Timeline */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedTicketIds((prev) => ({ ...prev, [req.id]: !prev[req.id] }))
                  }
                  className="text-xs font-bold text-teal-800 hover:text-teal-950 flex items-center gap-1.5"
                >
                  <span>{isExpanded ? '▼' : '▶'}</span>
                  <span>
                    Journal complet des interventions & preuves ({updatesList.length} étape
                    {updatesList.length > 1 ? 's' : ''})
                  </span>
                </button>

                {isExpanded && (
                  <div className="mt-3 pl-3 border-l-2 border-teal-500 space-y-3">
                    {updatesList.map((upd, idx) => (
                      <div
                        key={upd.id || idx}
                        className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1.5"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                                upd.updatedByRole === 'syndic'
                                  ? 'bg-blue-900 text-amber-300'
                                  : 'bg-teal-100 text-teal-900'
                              }`}
                            >
                              {upd.updatedByRole === 'syndic' ? '🏢 Syndic' : '👤 Copropriétaire'}
                            </span>
                            <span className="font-bold text-slate-900">{upd.title}</span>
                          </div>
                          <span className="font-mono text-[11px] text-slate-400">
                            {new Date(upd.timestamp).toLocaleString('fr-MA', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        <p className="text-slate-700 leading-relaxed">{upd.note}</p>

                        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                          <span>Par : {upd.updatedBy}</span>
                          {upd.assignedTo && (
                            <span className="font-semibold text-teal-800">
                              Artisan : {upd.assignedTo}
                              {upd.cost ? ` · ${currencyFormatter.format(upd.cost)}` : ''}
                            </span>
                          )}
                        </div>

                        {upd.photos && upd.photos.length > 0 && (
                          <div className="flex items-center gap-2 pt-1.5">
                            {upd.photos.map((p, pIdx) => (
                              <button
                                key={pIdx}
                                type="button"
                                onClick={() => setLightboxPhoto(p)}
                                className="w-16 h-16 rounded-lg overflow-hidden border border-slate-300 hover:opacity-90"
                              >
                                <img
                                  src={p}
                                  alt="Photo d'étape"
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          );
        })}

        {filteredRequests.length === 0 && (
          <Card className="p-12 text-center border border-dashed border-slate-300">
            <span className="text-3xl block mb-2">🔧</span>
            <h3 className="font-bold text-slate-800 text-sm">
              Aucun ticket de maintenance ne correspond à ces critères
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Signalez un nouvel incident ou modifiez les filtres ci-dessus.
            </p>
          </Card>
        )}
      </div>

      {/* MODAL 1: UPDATE STATUS & ATTACH TRANSPARENCY NOTES / PHOTOS */}
      {selectedRequest && (
        <Modal
          isOpen={!!selectedRequest}
          onClose={() => setSelectedRequest(null)}
          title={
            isResidentPortal
              ? `Ajouter une note ou photo · Ticket #${selectedRequest.id.toUpperCase()}`
              : `Mise à jour du Suivi & Transparence · Ticket #${selectedRequest.id.toUpperCase()}`
          }
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelectedRequest(null)}>
                Annuler
              </Button>
              <Button
                onClick={handleSaveUpdate}
                disabled={updateMutation.isPending || isUploadingPhotos}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                {updateMutation.isPending ? 'Enregistrement...' : 'Enregistrer dans le journal'}
              </Button>
            </div>
          }
        >
          <form onSubmit={handleSaveUpdate} className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <div className="font-bold text-slate-900 text-sm">
                {selectedRequest.title || selectedRequest.description}
              </div>
              <p className="text-slate-600 mt-0.5">{selectedRequest.description}</p>
            </div>

            {!isResidentPortal && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Nouveau statut d'avancement :
                    </label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as any)}
                      className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
                    >
                      <option value="pending">⏳ 1. Reçu / En attente de prise en charge</option>
                      <option value="in_progress">🔧 2-3. En cours d'intervention sur site</option>
                      <option value="completed">✅ 4. Résolu, vérifié et clôturé</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Prestataire / Artisan assigné :
                    </label>
                    <input
                      type="text"
                      list="building-providers-list"
                      value={editAssignedTo}
                      onChange={(e) => setEditAssignedTo(e.target.value)}
                      placeholder="Sélectionner ou saisir un artisan..."
                      className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
                    />
                    <datalist id="building-providers-list">
                      {prestataires.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.contactPerson} — {p.phone}
                        </option>
                      ))}
                    </datalist>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Coût de l'intervention (MAD TTC) :
                    </label>
                    <input
                      type="number"
                      value={editCost}
                      onChange={(e) => setEditCost(e.target.value)}
                      placeholder="Ex: 650"
                      className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      N° Devis ou Facture Fournisseur :
                    </label>
                    <input
                      type="text"
                      value={editInvoiceRef}
                      onChange={(e) => setEditInvoiceRef(e.target.value)}
                      placeholder="Ex: FAC-2026-441"
                      className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Titre de l'étape du journal :
              </label>
              <input
                type="text"
                value={stepTitle}
                onChange={(e) => setStepTitle(e.target.value)}
                placeholder="Ex: Remplacement de la pièce effectué sur site..."
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Note de transparence visible par les copropriétaires * :
              </label>
              <textarea
                rows={3}
                required
                value={stepNote}
                onChange={(e) => setStepNote(e.target.value)}
                placeholder="Détaillez le diagnostic technique, les travaux réalisés ou la date de passage prévue..."
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            {/* Photo Attachment for Step */}
            <div className="space-y-2 pt-1 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700">
                  📷 Joindre des photos justificatives (Avant / Après travaux) :
                </label>
                <input
                  type="file"
                  ref={updatePhotoInputRef}
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUploadFiles(e.target.files, setStepPhotos)}
                />
                <button
                  type="button"
                  onClick={() => updatePhotoInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-bold"
                >
                  + Importer depuis l'appareil
                </button>
              </div>

              {/* Quick Sample Photos for Instant Testing */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="text-[10px] text-slate-400 shrink-0">Photos démo :</span>
                {SAMPLE_MAINTENANCE_PHOTOS.map((sp, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() =>
                      setStepPhotos((prev) =>
                        prev.includes(sp.url) ? prev : [...prev, sp.url]
                      )
                    }
                    className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-medium shrink-0"
                  >
                    + {sp.label}
                  </button>
                ))}
              </div>

              {stepPhotos.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  {stepPhotos.map((p, idx) => (
                    <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-teal-400">
                      <img src={p} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() =>
                          setStepPhotos((prev) => prev.filter((_, i) => i !== idx))
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
          </form>
        </Modal>
      )}

      {/* MODAL 2: CREATE NEW MAINTENANCE REQUEST WITH PHOTOS */}
      {isCreateModalOpen && (
        <Modal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          title="Signaler un incident ou demander une réparation"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
                Annuler
              </Button>
              <Button
                onClick={handleCreateTicket}
                disabled={createMutation.isPending || !newDescription.trim()}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                {createMutation.isPending ? 'Transmission...' : 'Envoyer le signalement'}
              </Button>
            </div>
          }
        >
          <form onSubmit={handleCreateTicket} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Titre court de l'incident * :
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Ex: Fuite d'eau robinet jardin / Panne interphone entrée..."
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Catégorie :</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="elevator">🛗 Ascenseur & Monte-charge</option>
                  <option value="plumbing">🚰 Plomberie & Canalisation</option>
                  <option value="electrical">⚡ Électricité & Éclairage</option>
                  <option value="common_area">🏢 Parties Communes & Hall</option>
                  <option value="cleaning">🧹 Propreté & Hygiène</option>
                  <option value="security">🛡️ Sécurité, Portail & Accès</option>
                  <option value="other">🔧 Autre</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">Niveau d'urgence :</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as any)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="low">🟢 Normale</option>
                  <option value="medium">🟠 Moyenne</option>
                  <option value="high">🔴 Urgente (Sécurité / Fuite / Ascenseur bloqué)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Emplacement précis dans l'immeuble :
              </label>
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder="Ex: Sous-sol -1 près du local technique / Palier 3ème étage..."
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Description détaillée du constat * :
              </label>
              <textarea
                rows={3}
                required
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Précisez les symptômes constatés pour faciliter le diagnostic du prestataire..."
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700">
                  📷 Joindre une photo de l'anomalie :
                </label>
                <input
                  type="file"
                  ref={newTicketPhotoInputRef}
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUploadFiles(e.target.files, setNewPhotos)}
                />
                <button
                  type="button"
                  onClick={() => newTicketPhotoInputRef.current?.click()}
                  className="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 font-bold"
                >
                  + Choisir une photo
                </button>
              </div>

              {newPhotos.length > 0 && (
                <div className="flex items-center gap-2">
                  {newPhotos.map((p, idx) => (
                    <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-teal-400">
                      <img src={p} alt="" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() =>
                          setNewPhotos((prev) => prev.filter((_, i) => i !== idx))
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
          </form>
        </Modal>
      )}

      {/* MODAL 3: PHOTO LIGHTBOX */}
      {lightboxPhoto && (
        <Modal
          isOpen={!!lightboxPhoto}
          onClose={() => setLightboxPhoto(null)}
          title="Justificatif Photographique d'Intervention"
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setLightboxPhoto(null)}>
                Fermer
              </Button>
            </div>
          }
        >
          <div className="bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center max-h-[70vh]">
            <img
              src={lightboxPhoto}
              alt="Preuve d'intervention"
              className="max-w-full max-h-[65vh] object-contain"
            />
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Maintenance;
