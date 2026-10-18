import React, { useState, useMemo, useEffect } from 'react';
import type { Building, Apartment, Resident } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { useI18n } from '../../hooks/useI18n';
import { PlusIcon, PencilIcon, TrashIcon, DocumentsIcon } from '../icons/IconComponents';
import { exportApartmentsPDF, exportApartmentsCSV } from '../../services/pdfService';

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
  const [floor, setFloor] = useState('1');
  const [area, setArea] = useState('80');
  const [tantiemes, setTantiemes] = useState('100');
  const [monthlyFees, setMonthlyFees] = useState(String(monthlySyndicFees || 250));
  const [coproType, setCoproType] = useState<Apartment['coproType']>('apartment');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (existingApartment) {
      setNumber(existingApartment.number);
      setFloor(String(existingApartment.floor));
      setArea(String(existingApartment.area));
      setTantiemes(String(existingApartment.tantiemes || 100));
      setMonthlyFees(String(existingApartment.monthlyFees || monthlySyndicFees || 250));
      setCoproType(existingApartment.coproType || 'apartment');
      setOwnerId(existingApartment.ownerId);
      setTenantId(existingApartment.tenantId);
    } else {
      setNumber('');
      setFloor('1');
      setArea('80');
      setTantiemes('100');
      setMonthlyFees(String(monthlySyndicFees || 250));
      setCoproType('apartment');
      setOwnerId(null);
      setTenantId(null);
    }
    setErrors({});
  }, [existingApartment, isOpen, monthlySyndicFees]);

  const handleAreaChange = (val: string) => {
    setArea(val);
    const numericArea = parseFloat(val);
    if (!isNaN(numericArea) && numericArea > 0 && !existingApartment) {
      const suggestedTantiemes = Math.max(10, Math.round(numericArea * 1.25));
      setTantiemes(String(suggestedTantiemes));
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!number.trim()) newErrors.number = t('apartments.modal.validation.numberRequired');
    const numberExists = apartments.some(
      (apt) =>
        apt.number.trim().toLowerCase() === number.trim().toLowerCase() &&
        apt.id !== existingApartment?.id
    );
    if (numberExists) newErrors.number = t('apartments.modal.validation.numberExists');
    if (floor === '' || isNaN(parseInt(floor, 10))) {
      newErrors.floor = t('apartments.modal.validation.floorRequired');
    }
    if (!area.trim() || isNaN(parseFloat(area)) || parseFloat(area) <= 0) {
      newErrors.area = t('apartments.modal.validation.areaRequired');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const apartmentData = {
      number: number.trim(),
      floor: parseInt(floor, 10),
      area: parseFloat(area),
      tantiemes: parseInt(tantiemes, 10) || 100,
      monthlyFees: parseFloat(monthlyFees) || monthlySyndicFees,
      coproType: coproType || 'apartment',
      ownerId: ownerId || null,
      tenantId: tenantId || null,
    };
    if (existingApartment) {
      onSave({ ...existingApartment, ...apartmentData });
    } else {
      onSave(apartmentData);
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
      title={
        existingApartment
          ? `Modifier le lot ${existingApartment.number}`
          : 'Ajouter un lot de copropriété (Loi 18-00)'
      }
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
              placeholder="Ex: A-101 ou 12"
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
              onChange={(e) => setCoproType(e.target.value as Apartment['coproType'])}
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Étage</label>
            <input
              type="number"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
              placeholder="Ex: 1"
              className={`w-full px-3 py-2 border rounded text-sm ${
                errors.floor ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {errors.floor && <p className="text-xs text-red-600 mt-1">{errors.floor}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Superficie (m²)
            </label>
            <input
              type="number"
              value={area}
              onChange={(e) => handleAreaChange(e.target.value)}
              placeholder="Ex: 95"
              className={`w-full px-3 py-2 border rounded text-sm ${
                errors.area ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {errors.area && <p className="text-xs text-red-600 mt-1">{errors.area}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-teal-800 mb-1">
              Tantièmes (/1000)
            </label>
            <input
              type="number"
              value={tantiemes}
              onChange={(e) => setTantiemes(e.target.value)}
              placeholder="Ex: 100"
              className="w-full px-3 py-2 border border-teal-300 rounded text-sm font-mono font-bold bg-teal-50 text-teal-900"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Cotisation (MAD)
            </label>
            <input
              type="number"
              value={monthlyFees}
              onChange={(e) => setMonthlyFees(e.target.value)}
              placeholder="Ex: 250"
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Copropriétaire (Propriétaire - Optionnel)
          </label>
          <select
            value={ownerId || ''}
            onChange={(e) => setOwnerId(e.target.value || null)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
          >
            <option value="">-- Lot non assigné / Sans copropriétaire --</option>
            {residents
              .filter((r) => r.isOwner)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {getResidentLabel(r)}
                </option>
              ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            Vous pouvez également assigner un lot directement depuis la fiche d&apos;un résident.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            Locataire (Si applicable)
          </label>
          <select
            value={tenantId || ''}
            onChange={(e) => setTenantId(e.target.value || null)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
          >
            <option value="">-- Aucun locataire (Occupé par propriétaire ou vacant) --</option>
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

// ==========================================
// BULK APARTMENT CREATION MODAL
// ==========================================

type DraftBulkApartment = {
  tempId: string;
  number: string;
  floor: number;
  area: number;
  tantiemes: number;
  monthlyFees: number;
  coproType: Apartment['coproType'];
};

type BulkApartmentModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onBulkCreate: (apartments: Omit<Apartment, 'id' | 'buildingId'>[]) => void;
  existingApartments: Apartment[];
  defaultMonthlyFees: number;
};

const BulkApartmentModal: React.FC<BulkApartmentModalProps> = ({
  isOpen,
  onClose,
  onBulkCreate,
  existingApartments,
  defaultMonthlyFees,
}) => {
  const [prefix, setPrefix] = useState('');
  const [floorStart, setFloorStart] = useState('1');
  const [floorEnd, setFloorEnd] = useState('4');
  const [unitsPerFloor, setUnitsPerFloor] = useState('4');
  const [numberingPattern, setNumberingPattern] = useState<
    'floor_num' | 'sequential' | 'floor_alpha'
  >('floor_num');
  const [coproType, setCoproType] = useState<Apartment['coproType']>('apartment');
  const [defaultArea, setDefaultArea] = useState('85');
  const [monthlyFees, setMonthlyFees] = useState(String(defaultMonthlyFees || 250));
  const [distributeTantiemes, setDistributeTantiemes] = useState(true);
  const [fixedTantiemes, setFixedTantiemes] = useState('50');
  const [previewRows, setPreviewRows] = useState<DraftBulkApartment[]>([]);

  const existingNumbersSet = useMemo(
    () => new Set(existingApartments.map((a) => a.number.trim().toLowerCase())),
    [existingApartments]
  );

  const generateDrafts = () => {
    const startF = parseInt(floorStart, 10);
    const endF = parseInt(floorEnd, 10);
    const perFloor = Math.max(1, Math.min(30, parseInt(unitsPerFloor, 10) || 1));
    const areaVal = Math.max(1, parseFloat(defaultArea) || 80);
    const feesVal = Math.max(0, parseFloat(monthlyFees) || defaultMonthlyFees || 250);

    if (isNaN(startF) || isNaN(endF) || endF < startF) return;

    const totalUnits = (endF - startF + 1) * perFloor;
    const autoTantieme =
      distributeTantiemes && totalUnits > 0
        ? Math.max(1, Math.round(1000 / totalUnits))
        : Math.max(1, parseInt(fixedTantiemes, 10) || 50);

    const rows: DraftBulkApartment[] = [];
    let seqCounter = existingApartments.length + 1;

    for (let fl = startF; fl <= endF; fl++) {
      for (let u = 1; u <= perFloor; u++) {
        let numStr = '';
        if (numberingPattern === 'floor_num') {
          const flPrefix = fl === 0 ? 'RDC-' : `${fl}`;
          numStr =
            fl === 0
              ? `${prefix}${flPrefix}${u}`
              : `${prefix}${fl}${u < 10 ? `0${u}` : u}`;
        } else if (numberingPattern === 'floor_alpha') {
          const letter = String.fromCharCode(64 + ((u - 1) % 26) + 1);
          numStr = `${prefix}${fl}${letter}`;
        } else {
          numStr = `${prefix}${seqCounter}`;
        }
        seqCounter++;

        rows.push({
          tempId: `draft-${fl}-${u}-${Math.random().toString(36).slice(2, 6)}`,
          number: numStr,
          floor: fl,
          area: areaVal,
          tantiemes: autoTantieme,
          monthlyFees: feesVal,
          coproType: coproType || 'apartment',
        });
      }
    }
    setPreviewRows(rows);
  };

  useEffect(() => {
    if (isOpen) {
      generateDrafts();
    }
  }, [
    isOpen,
    prefix,
    floorStart,
    floorEnd,
    unitsPerFloor,
    numberingPattern,
    coproType,
    defaultArea,
    monthlyFees,
    distributeTantiemes,
    fixedTantiemes,
  ]);

  const handleRowChange = (
    tempId: string,
    field: keyof DraftBulkApartment,
    value: string | number
  ) => {
    setPreviewRows((prev) =>
      prev.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r))
    );
  };

  const handleRemoveRow = (tempId: string) => {
    setPreviewRows((prev) => prev.filter((r) => r.tempId !== tempId));
  };

  const validNonDuplicateRows = useMemo(
    () =>
      previewRows.filter(
        (r) =>
          r.number.trim() !== '' &&
          !existingNumbersSet.has(r.number.trim().toLowerCase())
      ),
    [previewRows, existingNumbersSet]
  );

  const duplicateCount = previewRows.length - validNonDuplicateRows.length;

  const handleConfirmBulk = () => {
    if (validNonDuplicateRows.length === 0) return;
    onBulkCreate(
      validNonDuplicateRows.map((r) => ({
        number: r.number.trim(),
        floor: Number(r.floor),
        area: Number(r.area),
        tantiemes: Number(r.tantiemes),
        monthlyFees: Number(r.monthlyFees),
        coproType: r.coproType,
        ownerId: null,
        tenantId: null,
      }))
    );
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Création en masse de lots (Générateur par étages / blocs)"
      footer={
        <div className="flex flex-wrap items-center justify-between w-full gap-2">
          <span className="text-xs text-slate-500">
            <strong>{validNonDuplicateRows.length}</strong> lots prêts à créer
            {duplicateCount > 0 && (
              <span className="text-amber-600 ms-1">
                ({duplicateCount} doublon(s) ignoré(s))
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              Annuler
            </Button>
            <Button
              onClick={handleConfirmBulk}
              disabled={validNonDuplicateRows.length === 0}
            >
              Créer {validNonDuplicateRows.length} lots en masse
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Préfixe / Bloc
              </label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="Ex: A- ou vide"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Étage début
              </label>
              <input
                type="number"
                value={floorStart}
                onChange={(e) => setFloorStart(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Étage fin
              </label>
              <input
                type="number"
                value={floorEnd}
                onChange={(e) => setFloorEnd(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Lots / étage
              </label>
              <input
                type="number"
                min={1}
                max={30}
                value={unitsPerFloor}
                onChange={(e) => setUnitsPerFloor(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Numérotation
              </label>
              <select
                value={numberingPattern}
                onChange={(e) => setNumberingPattern(e.target.value as any)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              >
                <option value="floor_num">Étage + N° (101, 102...)</option>
                <option value="floor_alpha">Étage + Lettre (1A, 1B...)</option>
                <option value="sequential">Séquentiel (1, 2, 3...)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Type de bien
              </label>
              <select
                value={coproType}
                onChange={(e) => setCoproType(e.target.value as Apartment['coproType'])}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              >
                <option value="apartment">Appartement</option>
                <option value="duplex">Duplex</option>
                <option value="commercial">Commercial</option>
                <option value="parking">Parking</option>
                <option value="box">Box / Garage</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Surface (m²)
              </label>
              <input
                type="number"
                value={defaultArea}
                onChange={(e) => setDefaultArea(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Cotisation (MAD)
              </label>
              <input
                type="number"
                value={monthlyFees}
                onChange={(e) => setMonthlyFees(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={distributeTantiemes}
                onChange={(e) => setDistributeTantiemes(e.target.checked)}
                className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span>Répartir automatiquement 1000 tantièmes sur la série générée</span>
            </label>
            {!distributeTantiemes && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-600">Tantièmes fixe/lot :</span>
                <input
                  type="number"
                  value={fixedTantiemes}
                  onChange={(e) => setFixedTantiemes(e.target.value)}
                  className="w-20 px-2 py-1 border border-slate-300 rounded text-xs bg-white font-mono"
                />
              </div>
            )}
          </div>
        </div>

        {/* Live Editable Preview Table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Aperçu et personnalisation avant création ({previewRows.length} lots)
            </h4>
          </div>
          <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-100 sticky top-0">
                <tr className="text-left text-slate-600">
                  <th className="px-2.5 py-2">N° Lot</th>
                  <th className="px-2.5 py-2">Étage</th>
                  <th className="px-2.5 py-2">Surface (m²)</th>
                  <th className="px-2.5 py-2">Tantièmes</th>
                  <th className="px-2.5 py-2">Frais (MAD)</th>
                  <th className="px-2.5 py-2 text-right">Retirer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {previewRows.map((row) => {
                  const isDup = existingNumbersSet.has(row.number.trim().toLowerCase());
                  return (
                    <tr
                      key={row.tempId}
                      className={isDup ? 'bg-amber-50/70' : 'hover:bg-slate-50'}
                    >
                      <td className="px-2.5 py-1.5">
                        <input
                          type="text"
                          value={row.number}
                          onChange={(e) =>
                            handleRowChange(row.tempId, 'number', e.target.value)
                          }
                          className={`w-24 px-2 py-1 border rounded font-mono font-bold text-xs ${
                            isDup ? 'border-amber-500 text-amber-800' : 'border-slate-200'
                          }`}
                        />
                        {isDup && (
                          <span className="block text-[10px] text-amber-700">
                            Existe déjà
                          </span>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input
                          type="number"
                          value={row.floor}
                          onChange={(e) =>
                            handleRowChange(
                              row.tempId,
                              'floor',
                              parseInt(e.target.value, 10) || 0
                            )
                          }
                          className="w-16 px-2 py-1 border border-slate-200 rounded text-xs"
                        />
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input
                          type="number"
                          value={row.area}
                          onChange={(e) =>
                            handleRowChange(
                              row.tempId,
                              'area',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="w-16 px-2 py-1 border border-slate-200 rounded text-xs font-mono"
                        />
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input
                          type="number"
                          value={row.tantiemes}
                          onChange={(e) =>
                            handleRowChange(
                              row.tempId,
                              'tantiemes',
                              parseInt(e.target.value, 10) || 0
                            )
                          }
                          className="w-16 px-2 py-1 border border-teal-200 bg-teal-50/50 rounded text-xs font-mono font-bold text-teal-900"
                        />
                      </td>
                      <td className="px-2.5 py-1.5">
                        <input
                          type="number"
                          value={row.monthlyFees}
                          onChange={(e) =>
                            handleRowChange(
                              row.tempId,
                              'monthlyFees',
                              parseFloat(e.target.value) || 0
                            )
                          }
                          className="w-20 px-2 py-1 border border-slate-200 rounded text-xs font-mono"
                        />
                      </td>
                      <td className="px-2.5 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.tempId)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded"
                          title="Retirer cette ligne"
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ==========================================
// MAIN APARTMENTS VIEW
// ==========================================

type ApartmentsProps = {
  building: Building;
  residents: Resident[];
  onAddApartment: (apartment: Omit<Apartment, 'id' | 'buildingId'>) => void;
  onAddApartmentsBulk?: (apartments: Omit<Apartment, 'id' | 'buildingId'>[]) => void;
  onRebalanceTantiemes?: () => void;
  onUpdateApartment: (apartment: Apartment) => void;
  onDeleteApartment: (apartmentId: string) => void;
};

const Apartments: React.FC<ApartmentsProps> = ({
  building,
  residents,
  onAddApartment,
  onAddApartmentsBulk,
  onRebalanceTantiemes,
  onUpdateApartment,
  onDeleteApartment,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [selectedApartment, setSelectedApartment] = useState<Apartment | null>(null);
  const [deletingApartment, setDeletingApartment] = useState<Apartment | null>(null);

  const residentMap = useMemo(
    () => new Map(residents.map((r) => [r.id, r.name])),
    [residents]
  );
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

  const confirmDelete = () => {
    if (deletingApartment) {
      onDeleteApartment(deletingApartment.id);
      setDeletingApartment(null);
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

      {onAddApartmentsBulk && (
        <BulkApartmentModal
          isOpen={isBulkModalOpen}
          onClose={() => setIsBulkModalOpen(false)}
          onBulkCreate={onAddApartmentsBulk}
          existingApartments={building.apartments}
          defaultMonthlyFees={building.monthlySyndicFees}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deletingApartment}
        onClose={() => setDeletingApartment(null)}
        title={`Supprimer le lot ${deletingApartment?.number || ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingApartment(null)}>
              Annuler
            </Button>
            <Button variant="danger" onClick={confirmDelete} className="ms-3">
              Supprimer le lot
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Confirmez-vous la suppression du lot{' '}
          <strong className="text-slate-900">{deletingApartment?.number}</strong> (Étage{' '}
          {deletingApartment?.floor}) ? Les résidents rattachés seront automatiquement désassignés de ce lot.
        </p>
      </Modal>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Lots de Copropriété &amp; Tantièmes
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Répartition des quotes-parts d&apos;indivision (Loi 18-00) pour {building.name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => exportApartmentsPDF(building, residents)}
            disabled={building.apartments.length === 0}
            className="flex items-center gap-1.5 text-xs sm:text-sm"
            title="Exporter l'inventaire des lots et tantièmes en PDF (Loi 18-00)"
          >
            <DocumentsIcon />
            <span>Exporter PDF</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => exportApartmentsCSV(building, residents)}
            disabled={building.apartments.length === 0}
            className="flex items-center gap-1.5 text-xs sm:text-sm"
            title="Exporter l'inventaire des lots au format CSV (Excel)"
          >
            <span>⬇ CSV</span>
          </Button>
          {onAddApartmentsBulk && (
            <Button
              variant="secondary"
              onClick={() => setIsBulkModalOpen(true)}
              className="flex items-center gap-2 text-sm"
            >
              <PlusIcon />
              <span>Création en masse (Bulk)</span>
            </Button>
          )}
          <Button onClick={handleAdd} className="flex items-center gap-2 text-sm">
            <PlusIcon />
            <span>Ajouter un lot</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card className="p-4 border-l-4 border-l-teal-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Total des Lots
          </p>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {totalCount} lots
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {building.apartments.filter((a) => a.ownerId || a.tenantId).length} lots occupés / assignés
          </p>
        </Card>

        <Card className="p-4 border-l-4 border-l-indigo-600">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Tantièmes Enregistrés
              </p>
              <p className="text-2xl font-bold font-mono text-indigo-900 mt-1">
                {totalTantiemesSum} / 1000
              </p>
            </div>
            {totalTantiemesSum !== 1000 && totalCount > 0 && onRebalanceTantiemes && (
              <button
                type="button"
                onClick={onRebalanceTantiemes}
                className="px-2.5 py-1 text-[11px] font-bold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-md transition-colors"
                title="Répartir proportionnellement à la superficie sur 1000"
              >
                Équilibrer / 1000
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {totalTantiemesSum === 1000
              ? '✓ Total exact (1000/1000)'
              : '⚠ À équilibrer sur 1000 millièmes'}
          </p>
        </Card>

        <Card className="p-4 border-l-4 border-l-emerald-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Superficie Totale Privative
          </p>
          <p className="text-2xl font-bold font-mono text-emerald-800 mt-1">
            {building.apartments.reduce((sum, a) => sum + (a.area || 0), 0)} m²
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Base du calcul de répartition
          </p>
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
                    · {typeLabels[apartment.coproType || 'apartment']} · Étage{' '}
                    {apartment.floor}
                  </span>
                </div>
                <p className="text-xs text-slate-700 mt-1">
                  <strong>Propriétaire :</strong>{' '}
                  {apartment.ownerId
                    ? residentMap.get(apartment.ownerId) || 'Assigné'
                    : 'Non assigné'}
                </p>
                {apartment.tenantId && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    <strong>Locataire :</strong>{' '}
                    {residentMap.get(apartment.tenantId)}
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
                  onClick={() => setDeletingApartment(apartment)}
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
                <span className="font-mono font-semibold text-slate-700">
                  {apartment.area} m²
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Tantièmes</span>
                <span className="font-mono font-bold text-teal-700">
                  {apartment.tantiemes || 100} / 1000
                </span>
              </div>
              <div className="text-right">
                <span className="text-slate-400 block text-[10px]">Cotisation</span>
                <span className="font-mono font-bold text-slate-900">
                  {apartment.monthlyFees} MAD
                </span>
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
                <th className="px-4 py-2.5 text-right font-semibold text-teal-800">
                  Tantièmes
                </th>
                <th className="px-4 py-2.5 text-right">Cotisation</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {building.apartments.map((apartment: Apartment) => (
                <tr
                  key={apartment.id}
                  className="hover:bg-slate-50 transition-colors h-11"
                >
                  <td className="px-4 py-2 font-mono font-bold text-teal-900">
                    {apartment.number}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {typeLabels[apartment.coproType || 'apartment']}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{apartment.floor}</td>
                  <td className="px-4 py-2 font-medium text-slate-900">
                    {apartment.ownerId ? (
                      residentMap.get(apartment.ownerId) || '---'
                    ) : (
                      <span className="text-xs text-slate-400 italic">Non assigné</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {apartment.tenantId
                      ? residentMap.get(apartment.tenantId)
                      : '---'}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-slate-700">
                    {apartment.area} m²
                  </td>
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
                      onClick={() => setDeletingApartment(apartment)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded"
                      title="Supprimer"
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
              {building.apartments.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    Aucun lot enregistré pour cet immeuble. Utilisez &laquo; Création en masse &raquo; ou &laquo; Ajouter un lot &raquo;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default Apartments;
