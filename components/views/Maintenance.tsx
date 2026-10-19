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
import { useI18n } from '../../hooks/useI18n';

interface MaintenanceProps {
  building: Building;
  isResidentPortal?: boolean;
  currentResidentId?: string;
  currentResidentName?: string;
  currentApartmentNumber?: string;
}

const CATEGORY_META: Record<
  MaintenanceRequest['category'],
  { labelFr: string; labelAr: string; icon: string; badgeClass: string }
> = {
  elevator: {
    labelFr: 'Ascenseur & Monte-charge',
    labelAr: 'المصعد والآليات',
    icon: '🛗',
    badgeClass: 'bg-purple-50 text-purple-800 border-purple-200',
  },
  plumbing: {
    labelFr: 'Plomberie & Canalisation',
    labelAr: 'السباكة وقنوات المياه',
    icon: '🚰',
    badgeClass: 'bg-cyan-50 text-cyan-800 border-cyan-200',
  },
  electrical: {
    labelFr: 'Électricité & Éclairage',
    labelAr: 'الكهرباء والإنارة',
    icon: '⚡',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  common_area: {
    labelFr: 'Parties Communes & Hall',
    labelAr: 'الأجزاء المشتركة والبهو',
    icon: '🏢',
    badgeClass: 'bg-teal-50 text-teal-800 border-teal-200',
  },
  cleaning: {
    labelFr: 'Propreté & Hygiène',
    labelAr: 'النظافة والصحة',
    icon: '🧹',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  },
  security: {
    labelFr: 'Sécurité, Portail & Accès',
    labelAr: 'الأمن، البوابة والولوج',
    icon: '🛡️',
    badgeClass: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  },
  other: {
    labelFr: 'Autre Intervention',
    labelAr: 'تدخل آخر',
    icon: '🔧',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-200',
  },
};

const SAMPLE_MAINTENANCE_PHOTOS = [
  {
    labelFr: 'Ascenseur / Machinerie',
    labelAr: 'المصعد / المحرك',
    url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&auto=format&fit=crop&q=80',
  },
  {
    labelFr: 'Plomberie / Vanne eau',
    labelAr: 'السباكة / صمام المياه',
    url: 'https://images.unsplash.com/photo-1585704032915-c3400ca199e7?w=800&auto=format&fit=crop&q=80',
  },
  {
    labelFr: 'Éclairage / Parties communes',
    labelAr: 'الإنارة / الأجزاء المشتركة',
    url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800&auto=format&fit=crop&q=80',
  },
  {
    labelFr: 'Chantier / Réparation',
    labelAr: 'ورش / إصلاح',
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
  const { tr, isAr } = useI18n();
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
      label: tr('1. Signalé & Reçu', '1. تم التبليغ والاستلام'),
      sub: new Date(request.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA'),
    },
    {
      step: 2,
      label: tr('2. Artisan Assigné', '2. تعيين المهني'),
      sub: request.assignedTo ? request.assignedTo : tr('En attente syndic', 'في انتظار السنديك'),
    },
    {
      step: 3,
      label: tr('3. Travaux en cours', '3. الأشغال جارية'),
      sub:
        activeStage >= 3
          ? tr(`${request.updates?.length || 1} note(s) de suivi`, `${request.updates?.length || 1} ملاحظات تتبع`)
          : tr('Intervention sur site', 'تدخل ميداني'),
    },
    {
      step: 4,
      label: tr('4. Résolu & Vérifié', '4. تم الحل والتحقق'),
      sub: request.completedAt
        ? new Date(request.completedAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')
        : tr('Clôture finale', 'إغلاق نهائي'),
    },
  ];

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {tr("Suivi d'avancement en temps réel", 'تتبع تقدم الأشغال في الوقت الفعلي')}
        </span>
        <span className="text-[11px] font-mono font-bold text-teal-800">
          {tr(`Étape ${activeStage} / 4`, `المرحلة ${activeStage} / 4`)} ({Math.round((activeStage / 4) * 100)}%)
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
              <div className="text-[10px] truncate mt-0.5 ps-5 font-mono opacity-80">
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
  const { tr, isAr } = useI18n();
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
    () => new Map((building.residents || []).map((r) => [r.id, r])),
    [building.residents]
  );

  const apartmentMap = useMemo(
    () => new Map((building.apartments || []).map((a) => [a.id, a])),
    [building.apartments]
  );

  const findResidentForRequest = (req: MaintenanceRequest) => {
    if (!req) return undefined;
    const direct =
      residentMap.get(req.residentId) ||
      (req.residentId?.startsWith('res-res-')
        ? residentMap.get(req.residentId.replace(/^res-res-/, 'res-'))
        : undefined);
    if (direct) return direct;

    if (req.residentName) {
      const targetName = req.residentName.trim().toLowerCase();
      return (building.residents || []).find(
        (r) => r.name.trim().toLowerCase() === targetName
      );
    }
    return undefined;
  };

  const resolveApartmentNumberFromId = (rawAptId?: string): string | undefined => {
    if (!rawAptId) return undefined;
    const exactApt = apartmentMap.get(rawAptId);
    if (exactApt?.number && !exactApt.number.startsWith('apt-')) {
      return exactApt.number.replace(/^(Lot|شقة)\s+/i, '').trim();
    }
    const indexMatch = rawAptId.match(/apt-\d+-(\d+)/);
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10);
      const indexedApt = (building.apartments || [])[idx];
      if (indexedApt?.number && !indexedApt.number.startsWith('apt-')) {
        return indexedApt.number.replace(/^(Lot|شقة)\s+/i, '').trim();
      }
      return String(idx + 1);
    }
    return undefined;
  };

  const resolveDisplayLot = (
    req: MaintenanceRequest,
    resObj?: (typeof building.residents)[number]
  ): string => {
    // 1. Check apartment linked to the resident in building.apartments
    const linkedApt =
      (resObj?.apartmentId && apartmentMap.get(resObj.apartmentId)) ||
      (building.apartments || []).find(
        (a) =>
          a.ownerId === req.residentId ||
          a.tenantId === req.residentId ||
          (resObj && (a.ownerId === resObj.id || a.tenantId === resObj.id))
      );

    if (linkedApt?.number && !linkedApt.number.startsWith('apt-')) {
      const cleanNum = linkedApt.number.replace(/^(Lot|شقة)\s+/i, '').trim();
      return `${tr('Lot', 'شقة')} ${cleanNum}`;
    }

    // 2. Check if req.apartmentNumber contains an internal 'apt-...' identifier
    if (req.apartmentNumber) {
      const idMatch = req.apartmentNumber.match(/apt-[\w-]+/);
      if (idMatch) {
        const resolvedNum =
          resolveApartmentNumberFromId(idMatch[0]) ||
          resolveApartmentNumberFromId(resObj?.apartmentId);
        if (resolvedNum) {
          return `${tr('Lot', 'شقة')} ${resolvedNum}`;
        }
      } else {
        return req.apartmentNumber;
      }
    }

    // 3. Fallback to resolving resObj.apartmentId (including index-based lookup in building.apartments)
    if (resObj?.apartmentId) {
      const resolvedNum = resolveApartmentNumberFromId(resObj.apartmentId);
      if (resolvedNum) {
        return `${tr('Lot', 'شقة')} ${resolvedNum}`;
      }
    }

    return tr('Parties Communes', 'الأجزاء المشتركة');
  };

  const formatUpdatedBy = (
    rawUpdatedBy: string | undefined,
    displayResident: string,
    displayLot: string
  ): string => {
    if (!rawUpdatedBy || rawUpdatedBy === 'Copropriétaire') {
      return `${displayResident} (${displayLot})`;
    }
    const idMatch = rawUpdatedBy.match(/apt-[\w-]+/);
    if (idMatch) {
      const resolvedNum = resolveApartmentNumberFromId(idMatch[0]);
      if (resolvedNum) {
        return rawUpdatedBy.replace(idMatch[0], resolvedNum);
      }
      return `${displayResident} (${displayLot})`;
    }
    return rawUpdatedBy;
  };

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
      setBannerMessage(
        tr(
          'Le suivi du ticket de maintenance a été mis à jour avec succès.',
          'تم تحديث تتبع طلب الصيانة بنجاح.'
        )
      );
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
      setBannerMessage(
        tr(
          'Votre signalement a été enregistré et transmis au Syndic avec suivi en direct.',
          'تم تسجيل بلاغكم وإرساله إلى وكيل الاتحاد (السنديك) مع التتبع المباشر.'
        )
      );
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
        ? tr('Observation complémentaire du copropriétaire', 'ملاحظة إضافية من المالك المشترك')
        : req.status === 'pending'
        ? tr('Prise en charge & Assignation du prestataire', 'التكفل بالطلب وتعيين المهني')
        : tr("Point d'avancement de l'intervention", 'تحديث تقدم التدخل')
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
          (isResidentPortal
            ? tr('Note du résident', 'ملاحظة الساكن')
            : tr('Mise à jour du statut par le Syndic', 'تحديث الحالة من طرف السنديك')),
        note:
          stepNote.trim() ||
          (editStatus === 'completed'
            ? tr('Travaux achevés et réceptionnés sans réserve.', 'انتهت الأشغال وتم استلامها بدون تحفظ.')
            : tr(`Mise à jour du dossier (${editAssignedTo || 'Syndic'}).`, `تحديث الملف (${editAssignedTo || 'السنديك'}).`)),
        updatedBy: isResidentPortal
          ? `${currentResidentName} (${currentApartmentNumber})`
          : tr('SyndicPro Gestion (Bureau Syndic)', 'مكتب السنديك'),
        updatedByRole: isResidentPortal ? 'resident' : 'syndic',
        stepPhotos,
      },
    });
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDescription.trim()) return;

    const catLabel = isAr ? CATEGORY_META[newCategory].labelAr : CATEGORY_META[newCategory].labelFr;
    createMutation.mutate({
      buildingId: building.id,
      residentId: isResidentPortal ? currentResidentId : building.residents[0]?.id || 'res-1',
      residentName: isResidentPortal ? currentResidentName : tr('SyndicPro Gestion (Inspection)', 'مكتب السنديك (معاينة)'),
      apartmentNumber: isResidentPortal ? currentApartmentNumber : tr('Parties Communes', 'الأجزاء المشتركة'),
      title: newTitle.trim() || `${catLabel} — ${newLocation || tr('Immeuble', 'العمارة')}`,
      location: newLocation.trim() || tr('Parties communes de la résidence', 'الأجزاء المشتركة للإقامة'),
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

  if (isLoading) return <Loading message={tr('Chargement du suivi des interventions...', 'جاري تحميل تتبع التدخلات والأشغال...')} />;

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
              <span>{tr('Suivi des Incidents & Travaux de Maintenance', 'تتبع الأعطاب وأشغال الصيانة')}</span>
            </h1>
            <span className="text-xs bg-teal-50 text-teal-800 border border-teal-200 font-semibold px-2.5 py-0.5 rounded-full">
              {tr('Transparence Syndic & Copropriétaires', 'شفافية بين السنديك والملاك المشتركين')}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            {tr(
              `Suivez chaque réclamation étape par étape avec notes techniques du Syndic, prestataires mandatés et photos d'intervention (${building.name}).`,
              `تتبع كل شكاية خطوة بخطوة مع الملاحظات التقنية للسنديك، المهنيين المكلفين وصور التدخل (${building.name}).`
            )}
          </p>
        </div>

        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="text-xs sm:text-sm font-bold flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 text-white shrink-0 shadow-xs"
        >
          <PlusIcon />
          <span>{isResidentPortal ? tr('Signaler un incident', 'التبليغ عن عطب') : tr('Nouveau ticket travaux', 'طلب أشغال جديد')}</span>
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
          <div className="text-[11px] font-semibold uppercase text-slate-500">{tr('Total Dossiers', 'مجموع الملفات')}</div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">{stats.total}</div>
          <div className="text-[10px] text-slate-400">{tr('Parties communes & lots', 'الأجزاء المشتركة والشقق')}</div>
        </Card>
        <Card className="p-3.5 border border-amber-200 bg-amber-50/40">
          <div className="text-[11px] font-semibold uppercase text-amber-800">{tr('En Attente', 'قيد الانتظار')}</div>
          <div className="text-2xl font-bold font-mono text-amber-900 mt-1">{stats.pending}</div>
          <div className="text-[10px] text-amber-700">{tr('À assigner au prestataire', 'في انتظار تعيين المهني')}</div>
        </Card>
        <Card className="p-3.5 border border-blue-200 bg-blue-50/40">
          <div className="text-[11px] font-semibold uppercase text-blue-800">{tr('En Cours', 'قيد الإنجاز')}</div>
          <div className="text-2xl font-bold font-mono text-blue-900 mt-1">{stats.inProgress}</div>
          <div className="text-[10px] text-blue-700">{tr('Artisan sur site', 'المهني في عين المكان')}</div>
        </Card>
        <Card className="p-3.5 border border-emerald-200 bg-emerald-50/40">
          <div className="text-[11px] font-semibold uppercase text-emerald-800">{tr('Résolus & Vérifiés', 'تم الحل والتحقق')}</div>
          <div className="text-2xl font-bold font-mono text-emerald-900 mt-1">{stats.completed}</div>
          <div className="text-[10px] text-emerald-700">{tr('Clôturés avec preuves', 'مغلقة مع الإثباتات')}</div>
        </Card>
        <Card className="p-3.5 border border-slate-200 bg-slate-900 text-white col-span-2 sm:col-span-1">
          <div className="text-[11px] font-semibold uppercase text-slate-300">{tr('Coût Engagé', 'التكلفة الملتزم بها')}</div>
          <div className="text-xl font-bold font-mono text-amber-400 mt-1">
            {currencyFormatter.format(stats.totalCost)}
          </div>
          <div className="text-[10px] text-slate-400">{tr('Factures & devis validés', 'الفواتير وعروض الأسعار المصادق عليها')}</div>
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
                🏢 {tr("Tout l'immeuble", 'كل العمارة')} ({requests.length})
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
                👤 {tr('Mes signalements', 'بلاغاتي')} ({requests.filter((r) => r.residentId === currentResidentId).length})
              </button>
            </div>
          )}

          {[
            { id: 'all', label: tr('Tous les statuts', 'جميع الحالات') },
            { id: 'pending', label: tr('⏳ Reçus / En attente', '⏳ مستلمة / في الانتظار') },
            { id: 'in_progress', label: tr("🔧 En cours d'intervention", '🔧 قيد التدخل') },
            { id: 'completed', label: tr('✅ Résolus & Clôturés', '✅ تم الحل والإغلاق') },
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
            <option value="all">{tr('Toutes urgences', 'جميع الأولويات')}</option>
            <option value="high">{tr('🔴 Urgence Haute', '🔴 مستعجل جداً')}</option>
            <option value="medium">{tr('🟠 Urgence Moyenne', '🟠 متوسط الأهمية')}</option>
            <option value="low">{tr('🟢 Normale', '🟢 عادي')}</option>
          </select>

          <div className="relative flex-1 sm:w-56">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr('Rechercher ascenseur, fuite, artisan...', 'بحث: مصعد، تسرب، مهني...')}
              className="w-full text-xs ps-7 pe-3 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <span className="absolute start-2.5 top-2 text-slate-400 text-xs">🔍</span>
          </div>
        </div>
      </div>

      {/* Maintenance Tracker Cards List */}
      <div className="space-y-4">
        {filteredRequests.map((req) => {
          const catMeta = CATEGORY_META[req.category] || CATEGORY_META.other;
          const catLabel = isAr ? catMeta.labelAr : catMeta.labelFr;
          const resObj = findResidentForRequest(req);
          const displayResident = req.residentName || resObj?.name || tr('Copropriétaire', 'مالك مشترك');
          const displayLot = resolveDisplayLot(req, resObj);
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
                      <span>{catLabel}</span>
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
                        ? tr('🔴 Urgente', '🔴 مستعجل')
                        : req.priority === 'medium'
                        ? tr('🟠 Moyenne', '🟠 متوسط')
                        : tr('🟢 Normale', '🟢 عادي')}
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
                        ? tr('✓ Résolu & Vérifié', '✓ تم الحل والتحقق')
                        : req.status === 'in_progress'
                        ? tr("🔧 En cours d'intervention", '🔧 قيد التدخل')
                        : tr('⏳ Reçu / En attente', '⏳ قيد الانتظار')}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900">
                    {req.title || req.description}
                  </h3>

                  <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
                    <span>
                      📍 <strong>{tr('Localisation :', 'الموقع:')}</strong> {req.location || tr('Parties communes', 'الأجزاء المشتركة')}
                    </span>
                    <span>·</span>
                    <span>
                      👤 <strong>{tr('Signalé par :', 'مُبلّغ من طرف:')}</strong> {displayResident} ({displayLot})
                    </span>
                    <span>·</span>
                    <span className="font-mono">
                      📅 {new Date(req.createdAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
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
                        ? tr('Ajouter note / photo', 'إضافة ملاحظة / صورة')
                        : tr('Mettre à jour statut & suivi', 'تحديث الحالة والتتبع')}
                    </span>
                  </button>
                </div>
              </div>

              {/* Description & Syndic Transparency Summary */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-2">
                  <div className="text-[11px] font-bold uppercase text-slate-400">
                    {tr("Description de l'incident", 'وصف العطب أو الأشغال')}
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">{req.description}</p>

                  {req.syndicNotes && (
                    <div className="mt-2 pt-2 border-t border-slate-200">
                      <div className="text-[11px] font-bold text-teal-800 flex items-center gap-1">
                        <span>🏢</span>
                        <span>{tr('Dernière note officielle du Syndic :', 'آخر ملاحظة رسمية من السنديك:')}</span>
                      </div>
                      <p className="text-xs text-slate-800 mt-0.5 italic">« {req.syndicNotes} »</p>
                    </div>
                  )}
                </div>

                {/* Provider & Cost Transparency Box */}
                <div className="lg:col-span-5 bg-teal-50/50 p-3.5 rounded-xl border border-teal-200/80 flex flex-col justify-between gap-2 text-xs">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">{tr('Prestataire mandaté :', 'المهني المكلف:')}</span>
                      <span className="font-bold text-slate-900">
                        {req.assignedTo || tr('En attente de désignation', 'في انتظار التعيين')}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-medium">{tr('Coût / Devis TTC :', 'التكلفة / عرض السعر:')}</span>
                      <span className="font-mono font-bold text-teal-900">
                        {req.cost ? currencyFormatter.format(req.cost) : tr('Non chiffré', 'غير محدد')}
                      </span>
                    </div>
                    {req.invoiceRef && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 font-medium">{tr('Réf. Pièce / Facture :', 'مرجع الفاتورة:')}</span>
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
                        📷 {tr('Photos jointes au dossier', 'الصور المرفقة بالملف')} ({allPhotos.length}) :
                      </div>
                      <div className="flex items-center gap-2 overflow-x-auto">
                        {allPhotos.map((photo, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setLightboxPhoto(photo)}
                            className="relative w-14 h-14 rounded-lg overflow-hidden border border-teal-300 shrink-0 group hover:scale-95 transition-transform"
                            title={tr('Agrandir la photo', 'تكبير الصورة')}
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
                    {tr(
                      `Journal complet des interventions & preuves (${updatesList.length} étape${updatesList.length > 1 ? 's' : ''})`,
                      `السجل الكامل للتدخلات والإثباتات (${updatesList.length} مراحل)`
                    )}
                  </span>
                </button>

                {isExpanded && (
                  <div className="mt-3 ps-3 border-s-2 border-teal-500 space-y-3">
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
                              {upd.updatedByRole === 'syndic'
                                ? tr('🏢 Syndic', '🏢 السنديك')
                                : tr('👤 Copropriétaire', '👤 مالك مشترك')}
                            </span>
                            <span className="font-bold text-slate-900">{upd.title}</span>
                          </div>
                          <span className="font-mono text-[11px] text-slate-400">
                            {new Date(upd.timestamp).toLocaleString(isAr ? 'ar-MA' : 'fr-MA', {
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
                          <span>
                            {tr('Par :', 'بواسطة:')}{' '}
                            {formatUpdatedBy(upd.updatedBy, displayResident, displayLot)}
                          </span>
                          {upd.assignedTo && (
                            <span className="font-semibold text-teal-800">
                              {tr('Artisan :', 'المهني:')} {upd.assignedTo}
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
                                  alt={tr("Photo d'étape", 'صورة المرحلة')}
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
              {tr('Aucun ticket de maintenance ne correspond à ces critères', 'لا يوجد أي طلب صيانة يطابق هذه المعايير')}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {tr('Signalez un nouvel incident ou modifiez les filtres ci-dessus.', 'قم بالتبليغ عن عطب جديد أو قم بتعديل الفلاتر أعلاه.')}
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
              ? tr(
                  `Ajouter une note ou photo · Ticket #${selectedRequest.id.toUpperCase()}`,
                  `إضافة ملاحظة أو صورة · تذكرة #${selectedRequest.id.toUpperCase()}`
                )
              : tr(
                  `Mise à jour du Suivi & Transparence · Ticket #${selectedRequest.id.toUpperCase()}`,
                  `تحديث التتبع والشفافية · تذكرة #${selectedRequest.id.toUpperCase()}`
                )
          }
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSelectedRequest(null)}>
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                onClick={handleSaveUpdate}
                disabled={updateMutation.isPending || isUploadingPhotos}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                {updateMutation.isPending
                  ? tr('Enregistrement...', 'جاري الحفظ...')
                  : tr('Enregistrer dans le journal', 'حفظ في السجل')}
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
                      {tr("Nouveau statut d'avancement :", 'حالة التقدم الجديدة:')}
                    </label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value as any)}
                      className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-semibold"
                    >
                      <option value="pending">{tr('⏳ 1. Reçu / En attente de prise en charge', '⏳ 1. مستلم / في انتظار التكفل')}</option>
                      <option value="in_progress">{tr("🔧 2-3. En cours d'intervention sur site", '🔧 2-3. قيد التدخل في عين المكان')}</option>
                      <option value="completed">{tr('✅ 4. Résolu, vérifié et clôturé', '✅ 4. تم الحل والتحقق والإغلاق')}</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      {tr('Prestataire / Artisan assigné :', 'المهني / المقاول المكلف:')}
                    </label>
                    <input
                      type="text"
                      list="building-providers-list"
                      value={editAssignedTo}
                      onChange={(e) => setEditAssignedTo(e.target.value)}
                      placeholder={tr('Sélectionner ou saisir un artisan...', 'اختر أو أدخل اسم المهني...')}
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
                      {tr("Coût de l'intervention (MAD TTC) :", 'تكلفة التدخل (درهم شاملة الضريبة):')}
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
                      {tr('N° Devis ou Facture Fournisseur :', 'رقم عرض السعر أو الفاتورة:')}
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
                {tr("Titre de l'étape du journal :", 'عنوان مرحلة السجل:')}
              </label>
              <input
                type="text"
                value={stepTitle}
                onChange={(e) => setStepTitle(e.target.value)}
                placeholder={tr('Ex: Remplacement de la pièce effectué sur site...', 'مثال: تم استبدال القطعة في عين المكان...')}
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {tr('Note de transparence visible par les copropriétaires * :', 'ملاحظة الشفافية المرئية للملاك المشتركين * :')}
              </label>
              <textarea
                rows={3}
                required
                value={stepNote}
                onChange={(e) => setStepNote(e.target.value)}
                placeholder={tr(
                  'Détaillez le diagnostic technique, les travaux réalisés ou la date de passage prévue...',
                  'فصّل التشخيص التقني، الأشغال المنجزة أو تاريخ التدخل المرتقب...'
                )}
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            {/* Photo Attachment for Step */}
            <div className="space-y-2 pt-1 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700">
                  📷 {tr('Joindre des photos justificatives (Avant / Après travaux) :', 'إرفاق صور إثباتية (قبل / بعد الأشغال):')}
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
                  {tr("+ Importer depuis l'appareil", '+ استيراد من الجهاز')}
                </button>
              </div>

              {/* Quick Sample Photos for Instant Testing */}
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="text-[10px] text-slate-400 shrink-0">{tr('Photos démo :', 'صور تجريبية:')}</span>
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
                    + {isAr ? sp.labelAr : sp.labelFr}
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
          title={tr('Signaler un incident ou demander une réparation', 'التبليغ عن عطب أو طلب إصلاح')}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsCreateModalOpen(false)}>
                {tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                onClick={handleCreateTicket}
                disabled={createMutation.isPending || !newDescription.trim()}
                className="bg-teal-700 hover:bg-teal-800 text-white font-bold"
              >
                {createMutation.isPending
                  ? tr('Transmission...', 'جاري الإرسال...')
                  : tr('Envoyer le signalement', 'إرسال التبليغ')}
              </Button>
            </div>
          }
        >
          <form onSubmit={handleCreateTicket} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {tr("Titre court de l'incident * :", 'عنوان مختصر للعطب * :')}
              </label>
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder={tr("Ex: Fuite d'eau robinet jardin / Panne interphone entrée...", 'مثال: تسرب مياه في الحديقة / عطب في الأنترفون...')}
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{tr('Catégorie :', 'الفئة:')}</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="elevator">🛗 {tr('Ascenseur & Monte-charge', 'المصعد والآليات')}</option>
                  <option value="plumbing">🚰 {tr('Plomberie & Canalisation', 'السباكة وقنوات المياه')}</option>
                  <option value="electrical">⚡ {tr('Électricité & Éclairage', 'الكهرباء والإنارة')}</option>
                  <option value="common_area">🏢 {tr('Parties Communes & Hall', 'الأجزاء المشتركة والبهو')}</option>
                  <option value="cleaning">🧹 {tr('Propreté & Hygiène', 'النظافة والصحة')}</option>
                  <option value="security">🛡️ {tr('Sécurité, Portail & Accès', 'الأمن، البوابة والولوج')}</option>
                  <option value="other">🔧 {tr('Autre', 'أخرى')}</option>
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">{tr("Niveau d'urgence :", 'مستوى الاستعجال:')}</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as any)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
                >
                  <option value="low">🟢 {tr('Normale', 'عادي')}</option>
                  <option value="medium">🟠 {tr('Moyenne', 'متوسط')}</option>
                  <option value="high">🔴 {tr('Urgente (Sécurité / Fuite / Ascenseur bloqué)', 'مستعجل (أمن / تسرب / مصعد متوقف)')}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {tr("Emplacement précis dans l'immeuble :", 'الموقع الدقيق داخل العمارة:')}
              </label>
              <input
                type="text"
                value={newLocation}
                onChange={(e) => setNewLocation(e.target.value)}
                placeholder={tr('Ex: Sous-sol -1 près du local technique / Palier 3ème étage...', 'مثال: الطابق تحت الأرضي -1 / بهو الطابق الثالث...')}
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                {tr('Description détaillée du constat * :', 'وصف مفصل للعطب * :')}
              </label>
              <textarea
                rows={3}
                required
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={tr(
                  'Précisez les symptômes constatés pour faciliter le diagnostic du prestataire...',
                  'حدد تفاصيل العطب الملاحظ لتسهيل التشخيص على المهني...'
                )}
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="space-y-2 pt-1 border-t border-slate-200">
              <div className="flex items-center justify-between">
                <label className="font-bold text-slate-700">
                  📷 {tr("Joindre une photo de l'anomalie :", 'إرفاق صورة للعطب:')}
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
                  {tr('+ Choisir une photo', '+ اختيار صورة')}
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
          title={tr("Justificatif Photographique d'Intervention", 'الإثبات المصور للتدخل')}
          footer={
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setLightboxPhoto(null)}>
                {tr('Fermer', 'إغلاق')}
              </Button>
            </div>
          }
        >
          <div className="bg-slate-950 rounded-xl overflow-hidden flex items-center justify-center max-h-[70vh]">
            <img
              src={lightboxPhoto}
              alt={tr("Preuve d'intervention", 'صورة التدخل')}
              className="max-w-full max-h-[65vh] object-contain"
            />
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Maintenance;
