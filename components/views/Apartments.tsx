import React, { useState, useMemo } from 'react';
import type { Building, Apartment, Resident } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { useI18n } from '../../hooks/useI18n';
import { PlusIcon, PencilIcon, TrashIcon } from '../icons/IconComponents';

type ApartmentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (apartment: Omit<Apartment, 'id' | 'buildingId'> | Apartment) => void;
  existingApartment?: Apartment | null;
  residents: Resident[];
  apartments: Apartment[];
  monthlySyndicFees: number;
};

const ApartmentModal: React.FC<ApartmentModalProps> = ({
  isOpen,
  onClose,
  onSave,
  existingApartment,
  residents,
  apartments,
  monthlySyndicFees,
}) => {
  const { t } = useI18n();
  const [number, setNumber] = useState('');
  const [floor, setFloor] = useState('');
  const [area, setArea] = useState('');
  const [tantiemes, setTantiemes] = useState('100');
  const [coproType, setCoproType] = useState<Apartment['coproType']>('apartment');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  React.useEffect(() => {
    if (existingApartment) {
      setNumber(existingApartment.number);
      setFloor(String(existingApartment.floor));
      setArea(String(existingApartment.area));
      setTantiemes(String(existingApartment.tantiemes || 100));
      setCoproType(existingApartment.coproType || 'apartment');
      setOwnerId(existingApartment.ownerId);
      setTenantId(existingApartment.tenantId);
    } else {
      setNumber('');
      setFloor('');
      setArea('');
      setTantiemes('100');
      setCoproType('apartment');
      setOwnerId(null);
      setTenantId(null);
    }
    setErrors({});
  }, [existingApartment, isOpen]);

  // Suggest tantièmes when area changes
  const handleAreaChange = (val: string) => {
    setArea(val);
    const numericArea = parseFloat(val);
    if (!isNaN(numericArea) && numericArea > 0 && !existingApartment) {
      // Suggest based on ~100m² typical fraction
      const suggestedTantiemes = Math.round(numericArea * 2.3);
      setTantiemes(String(suggestedTantiemes));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!number.trim()) newErrors.number = t('apartments.modal.validation.numberRequired');
    const numberExists = apartments.some(
      (apt) => apt.number.toLowerCase() === number.trim().toLowerCase() && apt.id !== existingApartment?.id
    );
    if (numberExists) newErrors.number = t('apartments.modal.validation.numberExists');
    if (!floor.trim()) newErrors.floor = t('apartments.modal.validation.floorRequired');
    if (!area.trim()) newErrors.area = t('apartments.modal.validation.areaRequired');
    if (!ownerId) newErrors.ownerId = t('apartments.modal.validation.ownerRequired');

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const apartmentData = {
      number,
      floor: parseInt(floor, 10),
      area: parseFloat(area),
      tantiemes: parseInt(tantiemes, 10) || 100,
      coproType: coproType || 'apartment',
      ownerId,
      tenantId,
    };
    if (existingApartment) {
      onSave({ ...existingApartment, ...apartmentData });
    } else {
      onSave({ ...apartmentData, monthlyFees: monthlySyndicFees });
    }
    onClose();
  };

  const getResidentLabel = (resident: Resident) => {
    return `${resident.name} (${resident.phone})`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={existingApartment ? "Modifier le lot de copropriété" : "Ajouter un lot de copropriété (Loi 18-00)"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('apartments.modal.cancel')}
          </Button>
          <Button onClick={handleSave} className="ms-3">
            {t('apartments.modal.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Numéro de lot / Appartement
            </label>
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Ex: A-101"
              className={`w-full px-3 py-2 border rounded text-sm ${
                errors.number ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {errors.number && <p className="text-xs text-red-600 mt-1">{errors.number}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Type de bien</label>
            <select
              value={coproType}
              onChange={(e) => setCoproType(e.target.value as any)}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
            >
              <option value="apartment">Appartement</option>
              <option value="duplex">Duplex / Penthouse</option>
              <option value="commercial">Local Commercial</option>
              <option value="parking">Place de Parking</option>
              <option value="box">Box / Garage</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Étage</label>
            <input
              type="number"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="Ex: 1"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Superficie (m²)</label>
            <input
              type="number"
              value={area}
              onChange={(e) => handleAreaChange(e.target.value)}
              placeholder="Ex: 95"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-teal-800 mb-1">
              Tantièmes (/ 1000)
            </label>
            <input
              type="number"
              value={tantiemes}
              onChange={(e) => setTantiemes(e.target.value)}
              placeholder="Ex: 220"
              className="w-full px-3 py-2 border border-teal-300 rounded text-sm font-mono font-bold bg-teal-50 text-teal-900"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Copropriétaire (Propriétaire)</label>
          <select
            value={ownerId || ''}
            onChange={(e) => setOwnerId(e.target.value || null)}
            className={`w-full px-3 py-2 border rounded text-sm bg-white ${
              errors.ownerId ? 'border-red-500' : 'border-slate-300'
            }`}
          >
            <option value="">Sélectionnez le copropriétaire...</option>
            {residents
              .filter((r) => r.isOwner)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {getResidentLabel(r)}
                </option>
              ))}
          </select>
          {errors.ownerId && <p className="text-xs text-red-600 mt-1">{errors.ownerId}</p>}
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Locataire (Si applicable)</label>
          <select
            value={tenantId || ''}
            onChange={(e) => setTenantId(e.target.value || null)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
          >
            <option value="">Aucun locataire (Occupé par propriétaire ou vide)</option>
            {residents
              .filter((r) => !r.isOwner)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {getResidentLabel(r)}
                </option>
              ))}
          </select>
        </div>
      </div>
    </Modal>
  );
};

type ApartmentsProps = {
  building: Building;
  residents: Resident[];
  onAddApartment: (apartment: Omit<Apartment, 'id' | 'buildingId'>) => void;
  onUpdateApartment: (apartment: Apartment) => void;
  onDeleteApartment: (apartmentId: string) => void;
};

const Apartments: React.FC<ApartmentsProps> = ({
  building,
  residents,
  onAddApartment,
  onUpdateApartment,
  onDeleteApartment,
}) => {
  const { t } = useI18n();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedApartment, setSelectedApartment] = useState<Apartment | null>(null);

  const residentMap = useMemo(() => new Map(residents.map((r) => [r.id, r.name])), [residents]);
  const totalCount = building.apartments.length;
  const totalTantiemesSum = useMemo(
    () => building.apartments.reduce((sum, a) => sum + (a.tantiemes || 0), 0),
    [building.apartments]
  );

  const handleEdit = (apartment: Apartment) => {
    setSelectedApartment(apartment);
    setIsModalOpen(true);
  };

  const handleAdd = () => {
    setSelectedApartment(null);
    setIsModalOpen(true);
  };

  const handleDelete = (apartment: Apartment) => {
    if (window.confirm(`Supprimer le lot ${apartment.number} ?`)) {
      onDeleteApartment(apartment.id);
    }
  };

  const typeLabels: Record<string, string> = {
    apartment: 'Appartement',
    duplex: 'Duplex',
    commercial: 'Commercial',
    parking: 'Parking',
    box: 'Box / Garage',
  };

  return (
    <div className="space-y-6">
      <ApartmentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={selectedApartment ? onUpdateApartment : onAddApartment}
        existingApartment={selectedApartment}
        residents={residents}
        apartments={building.apartments}
        monthlySyndicFees={building.monthlySyndicFees}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Lots de Copropriété & Tantièmes
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Répartition des quotes-parts d'indivision (Loi 18-00) pour {building.name}
          </p>
        </div>
        <Button onClick={handleAdd} className="flex items-center gap-2 text-sm">
          <PlusIcon />
          <span>Ajouter un lot</span>
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card className="p-4 border-l-4 border-l-teal-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total des Lots</p>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-1">{totalCount} lots</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Appartements, commerces et parkings</p>
        </Card>

        <Card className="p-4 border-l-4 border-l-indigo-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Tantièmes Enregistrés</p>
          <p className="text-2xl font-bold font-mono text-indigo-900 mt-1">
            {totalTantiemesSum} / 1000
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {totalTantiemesSum === 1000 ? '✓ Total exact (1000/1000)' : '⚠ À équilibrer sur 1000'}
          </p>
        </Card>

        <Card className="p-4 border-l-4 border-l-emerald-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Superficie Totale Privative</p>
          <p className="text-2xl font-bold font-mono text-emerald-800 mt-1">
            {building.apartments.reduce((sum, a) => sum + (a.area || 0), 0)} m²
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">Base du calcul de répartition</p>
        </Card>
      </div>

      {/* Mobile Card List (< md) */}
      <div className="md:hidden space-y-3">
        {building.apartments.map((apartment: Apartment) => (
          <Card key={apartment.id} className="p-4 border border-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-base text-teal-900">
                    Lot {apartment.number}
                  </span>
                  <span className="text-xs text-slate-500">
                    · {typeLabels[apartment.coproType || 'apartment']} · Étage {apartment.floor}
                  </span>
                </div>
                <p className="text-xs text-slate-700 mt-1">
                  <strong>Propriétaire :</strong>{' '}
                  {apartment.ownerId ? residentMap.get(apartment.ownerId) : '---'}
                </p>
                {apartment.tenantId && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    <strong>Locataire :</strong> {residentMap.get(apartment.tenantId)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleEdit(apartment)}
                  className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                  title="Modifier"
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(apartment)}
                  className="p-2 text-slate-500 hover:text-rose-600 rounded-lg hover:bg-rose-50 min-w-[40px] min-h-[40px] flex items-center justify-center"
                  title="Supprimer"
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px]">Superficie</span>
                <span className="font-mono font-semibold text-slate-700">{apartment.area} m²</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Tantièmes</span>
                <span className="font-mono font-bold text-teal-700">
                  {apartment.tantiemes || 100} / 1000
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">Cotisation</span>
                <span className="font-mono font-bold text-slate-900">{apartment.monthlyFees} MAD</span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* High-density Data Table (md+) */}
      <Card className="hidden md:block overflow-hidden border border-slate-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-500 text-left font-medium">
              <tr>
                <th className="px-4 py-2.5">Lot / N°</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Étage</th>
                <th className="px-4 py-2.5">Copropriétaire</th>
                <th className="px-4 py-2.5">Locataire</th>
                <th className="px-4 py-2.5 text-right">Superficie</th>
                <th className="px-4 py-2.5 text-right font-semibold text-teal-800">Tantièmes</th>
                <th className="px-4 py-2.5 text-right">Cotisation</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {building.apartments.map((apartment: Apartment) => (
                <tr key={apartment.id} className="hover:bg-slate-50 transition-colors h-11">
                  <td className="px-4 py-2 font-mono font-bold text-teal-900">{apartment.number}</td>
                  <td className="px-4 py-2 text-slate-600">{typeLabels[apartment.coproType || 'apartment']}</td>
                  <td className="px-4 py-2 text-slate-600">{apartment.floor}</td>
                  <td className="px-4 py-2 font-medium text-slate-900">
                    {apartment.ownerId ? residentMap.get(apartment.ownerId) : '---'}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {apartment.tenantId ? residentMap.get(apartment.tenantId) : '---'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">{apartment.area} m²</td>
                  <td className="px-4 py-2 text-right font-mono font-bold text-teal-700">
                    {apartment.tantiemes || 100} / 1000
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-800">
                    {apartment.monthlyFees} MAD
                  </td>
                  <td className="px-4 py-2 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      onClick={() => handleEdit(apartment)}
                      className="p-1 text-slate-400 hover:text-slate-600 rounded"
                      title="Modifier"
                    >
                      <PencilIcon />
                    </button>
                    <button
                      onClick={() => handleDelete(apartment)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded"
                      title="Supprimer"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default Apartments;
