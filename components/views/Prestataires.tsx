import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Prestataire } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { PrestatairesIcon, PlusIcon, PencilIcon, TrashIcon } from '../icons/IconComponents';
import { getPrestatairesForBuilding, savePrestataire, deletePrestataire } from '../../firebase/services';
import Loading from '../common/Loading';
import ServiceProvidersDirectory from './ServiceProvidersDirectory';

interface PrestatairesProps {
  building: Building;
}

const PrestatairesView: React.FC<PrestatairesProps> = ({ building }) => {
  const queryClient = useQueryClient();
  const [activeViewMode, setActiveViewMode] = useState<'directory' | 'legal'>('directory');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPrestataire, setEditingPrestataire] = useState<Prestataire | null>(null);

  const [name, setName] = useState('');
  const [category, setCategory] = useState<Prestataire['category']>('plumbing');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [ice, setIce] = useState('');
  const [rc, setRc] = useState('');
  const [notes, setNotes] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [isEmergency247, setIsEmergency247] = useState(false);
  const [isVerifiedBySyndic, setIsVerifiedBySyndic] = useState(true);

  const { data: prestataires = [], isLoading } = useQuery({
    queryKey: ['prestataires', building.id],
    queryFn: () => getPrestatairesForBuilding(building.id),
  });

  const saveMutation = useMutation({
    mutationFn: savePrestataire,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prestataires', building.id] });
      setIsModalOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deletePrestataire,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['prestataires', building.id] }),
  });

  const resetForm = () => {
    setName('');
    setCategory('plumbing');
    setContactPerson('');
    setPhone('');
    setWhatsapp('');
    setEmail('');
    setIce('');
    setRc('');
    setNotes('');
    setHourlyRate('');
    setIsEmergency247(false);
    setIsVerifiedBySyndic(true);
    setEditingPrestataire(null);
  };

  const handleOpenEdit = (p: Prestataire) => {
    setEditingPrestataire(p);
    setName(p.name);
    setCategory(p.category);
    setContactPerson(p.contactPerson);
    setPhone(p.phone);
    setWhatsapp(p.whatsapp || '');
    setEmail(p.email);
    setIce(p.ice || '');
    setRc(p.rc || '');
    setNotes(p.notes || '');
    setHourlyRate(p.hourlyRate || '');
    setIsEmergency247(!!p.isEmergency247);
    setIsVerifiedBySyndic(p.isVerifiedBySyndic ?? true);
    setIsModalOpen(true);
  };

  const handleSave = () => {
    if (!name || !phone) return alert('Le nom de l\'entreprise et le téléphone sont obligatoires.');

    const payload: Prestataire = {
      id: editingPrestataire?.id || `prest-${Date.now()}`,
      buildingId: building.id,
      syndicId: building.syndicId,
      name,
      category,
      contactPerson,
      phone,
      whatsapp: whatsapp || phone.replace(/\s+/g, ''),
      email,
      ice,
      rc,
      active: true,
      notes,
      hourlyRate,
      isEmergency247,
      isVerifiedBySyndic,
      rating: editingPrestataire?.rating || 4.8,
      reviewsCount: editingPrestataire?.reviewsCount || (editingPrestataire?.reviews?.length || 1),
      reviews: editingPrestataire?.reviews || [],
    };

    saveMutation.mutate(payload);
  };

  const categoryLabels: Record<Prestataire['category'], string> = {
    elevator: 'Ascensoriste',
    cleaning: 'Société de Nettoyage',
    plumbing: 'Plomberie & Surpresseur',
    electrical: 'Électricité & Éclairage',
    security: 'Gardiennage & Sécurité',
    gardener: 'Espaces Verts',
    locksmith: 'Serrurerie & Dépannage',
    painting: 'Peinture & Rénovation',
    air_conditioning: 'Climatisation & Froid',
    insurance: 'Compagnie d\'Assurance',
    other: 'Autre Service',
  };

  if (isLoading) return <Loading message="Chargement des prestataires..." />;

  return (
    <div className="space-y-6">
      {/* View Mode Toggle Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <PrestatairesIcon />
            <span>Prestataires & Artisans de l'Immeuble</span>
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Répertoire des artisans, dépannages d'urgence et contrats officiels pour {building.name}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle between directory and legal view */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setActiveViewMode('directory')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeViewMode === 'directory'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              🛠️ Répertoire & Avis Résidents
            </button>
            <button
              onClick={() => setActiveViewMode('legal')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                activeViewMode === 'legal'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              📑 Gestion Contrats & ICE/RC
            </button>
          </div>

          <Button
            onClick={() => {
              resetForm();
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 text-xs font-bold"
          >
            <PlusIcon />
            <span>Ajouter</span>
          </Button>
        </div>
      </div>

      {/* VIEW MODE 1: DIRECTORY & RESIDENT REVIEWS */}
      {activeViewMode === 'directory' && (
        <ServiceProvidersDirectory
          building={building}
          isResidentPortal={false}
          residentName="Syndic Gestionnaire"
          apartmentNumber="Bureau Syndic"
        />
      )}

      {/* VIEW MODE 2: LEGAL & CONTRACTS VIEW */}
      {activeViewMode === 'legal' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {prestataires.map((p) => (
          <Card key={p.id} className="p-5 border border-slate-200 hover:border-teal-300 transition-colors flex flex-col justify-between">
            <div>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded">
                    {categoryLabels[p.category] || p.category}
                  </span>
                  <h3 className="font-bold text-slate-900 text-base mt-2">{p.name}</h3>
                  <p className="text-xs text-slate-500">Contact : {p.contactPerson || 'Non spécifié'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenEdit(p)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded"
                    title="Modifier"
                  >
                    <PencilIcon />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Supprimer le prestataire ${p.name} ?`)) {
                        deleteMutation.mutate(p.id);
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded"
                    title="Supprimer"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>

              {/* Legal & Contact info */}
              <div className="mt-4 space-y-1.5 text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-400">Tél :</span>
                  <a href={`tel:${p.phone}`} className="font-semibold text-teal-700 hover:underline">
                    {p.phone}
                  </a>
                </div>
                {p.email && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">Email :</span>
                    <a href={`mailto:${p.email}`} className="text-slate-700 truncate max-w-[180px]">
                      {p.email}
                    </a>
                  </div>
                )}
                {p.ice && (
                  <div className="flex justify-between font-mono">
                    <span className="text-slate-400">ICE :</span>
                    <span>{p.ice}</span>
                  </div>
                )}
                {p.rc && (
                  <div className="flex justify-between font-mono">
                    <span className="text-slate-400">RC :</span>
                    <span>{p.rc}</span>
                  </div>
                )}
              </div>

              {p.notes && <p className="text-xs text-slate-500 mt-3 italic line-clamp-2">"{p.notes}"</p>}
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Contrat actif
              </span>
              <a
                href={`tel:${p.phone}`}
                className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-medium transition-colors"
              >
                Appeler
              </a>
            </div>
          </Card>
        ))}
      </div>

      {prestataires.length === 0 && (
        <Card className="p-8 text-center text-slate-500 text-sm">
          Aucun prestataire enregistré. Ajoutez des artisans ou prestataires pour faciliter la maintenance de votre copropriété.
        </Card>
      )}
        </div>
      )}

      {/* Modal Add / Edit Prestataire */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          resetForm();
        }}
        title={editingPrestataire ? 'Modifier le prestataire' : 'Ajouter un prestataire sous contrat'}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
            >
              Annuler
            </Button>
            <Button onClick={handleSave}>Enregistrer</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Nom de l'Entreprise / Artisan *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Atlas Ascenseurs SARL"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Corps de métier</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
              >
                <option value="plumbing">Plomberie & Fuites</option>
                <option value="electrical">Électricité & Domotique</option>
                <option value="locksmith">Serrurerie & Dépannage</option>
                <option value="elevator">Ascensoriste</option>
                <option value="cleaning">Société de Nettoyage</option>
                <option value="air_conditioning">Climatisation & Froid</option>
                <option value="painting">Peinture & Rénovation</option>
                <option value="security">Gardiennage / Sécurité</option>
                <option value="gardener">Espaces Verts</option>
                <option value="insurance">Compagnie d'Assurance</option>
                <option value="other">Autre Service</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Personne de contact</label>
              <input
                type="text"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                placeholder="Ex: Hassan Amrani"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Téléphone *</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Ex: 0522 34 56 78"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">WhatsApp (direct)</label>
              <input
                type="text"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="Ex: 0661 88 99 00"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Ex: contact@atlas.ma"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tarif indicatif</label>
              <input
                type="text"
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                placeholder="Ex: À partir de 150 DH"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">ICE (Maroc)</label>
              <input
                type="text"
                value={ice}
                onChange={(e) => setIce(e.target.value)}
                placeholder="Ex: 001988223000089"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">RC (Registre Commerce)</label>
              <input
                type="text"
                value={rc}
                onChange={(e) => setRc(e.target.value)}
                placeholder="Ex: 45678 Casablanca"
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isEmergency247}
                onChange={(e) => setIsEmergency247(e.target.checked)}
                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>🚨 Astreinte Dépannage Urgent 24h/7j</span>
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isVerifiedBySyndic}
                onChange={(e) => setIsVerifiedBySyndic(e.target.checked)}
                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>✓ Agréé par le Syndic (Loi 18-00)</span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Conditions de contrat & notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Astreinte 24/7, visite de maintenance le 1er mardi du mois..."
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PrestatairesView;
