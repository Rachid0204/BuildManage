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
  onSave: (apartment: Omit<Apartment, 'id' | 'buildingId'> | Apartment) => Promise<unknown> | void;
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
  const { t, tr } = useI18n();
  const [number, setNumber] = useState('');
  const [floor, setFloor] = useState('1');
  const [area, setArea] = useState('80');
  const [tantiemes, setTantiemes] = useState('100');
  const [monthlyFees, setMonthlyFees] = useState(String(monthlySyndicFees ?? 250));
  const [coproType, setCoproType] = useState<Apartment['coproType']>('apartment');
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (existingApartment) {
      setNumber(existingApartment.number);
      setFloor(String(existingApartment.floor));
      setArea(String(existingApartment.area));
      setTantiemes(String(existingApartment.tantiemes ?? 100));
      setMonthlyFees(String(existingApartment.monthlyFees ?? monthlySyndicFees ?? 250));
      setCoproType(existingApartment.coproType || 'apartment');
      setOwnerId(existingApartment.ownerId);
      setTenantId(existingApartment.tenantId);
    } else {
      setNumber('');
      setFloor('1');
      setArea('80');
      setTantiemes('100');
      setMonthlyFees(String(monthlySyndicFees ?? 250));
      setCoproType('apartment');
      setOwnerId(null);
      setTenantId(null);
    }
    setErrors({});
  }, [existingApartment?.id, isOpen]);

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
    if (floor === '' || !Number.isInteger(Number(floor)) || Number(floor) < -5) {
      newErrors.floor = t('apartments.modal.validation.floorRequired');
    }
    if (!area.trim() || isNaN(parseFloat(area)) || parseFloat(area) <= 0) {
      newErrors.area = t('apartments.modal.validation.areaRequired');
    }

    if (!tantiemes.trim() || !Number.isFinite(Number(tantiemes)) || Number(tantiemes) < 0)
      newErrors.tantiemes = tr('Les tantièmes doivent être un nombre positif ou nul.', 'يجب أن تكون الحصص رقماً موجباً أو صفراً.');
    if (!monthlyFees.trim() || !Number.isFinite(Number(monthlyFees)) || Number(monthlyFees) < 0)
      newErrors.monthlyFees = tr('Les frais mensuels doivent être un montant positif ou nul.', 'يجب أن تكون المساهمة الشهرية مبلغاً موجباً أو صفراً.');
    setErrors(newErrors);
    if (Object.keys(newErrors).length) throw new Error(Object.values(newErrors).join("\n"));
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    const apartmentData = {
      number: number.trim(),
      floor: parseInt(floor, 10),
      area: parseFloat(area),
      tantiemes: Number(tantiemes),
      monthlyFees: Number(monthlyFees),
      coproType: coproType || 'apartment',
      ownerId: ownerId || null,
      tenantId: tenantId || null,
    };
    if (existingApartment) {
      await onSave({ ...existingApartment, ...apartmentData });
    } else {
      await onSave(apartmentData);
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
      onSubmit={handleSave}
      title={
        existingApartment
          ? `${tr('Modifier le lot', 'تعديل الشقة / الوحدة')} ${existingApartment.number}`
          : tr('Ajouter un lot de copropriété (Loi 18-00)', 'إضافة شقة / وحدة للملكية المشتركة (قانون 18-00)')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('apartments.modal.cancel')}
          </Button>
          <Button type="submit" className="ms-3">
            {t('apartments.modal.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Numéro de lot / Appartement', 'رقم الشقة / الوحدة')}
            </label>
            <input
              type="text"
              required
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder={tr('Ex: A-101 ou 12', 'مثال: A-101 أو 12')}
              className={`w-full px-3 py-2 border rounded text-sm ${
                errors.number ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {errors.number && <p className="text-xs text-red-600 mt-1">{errors.number}</p>}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Type de bien', 'نوع العقار')}
            </label>
            <select
              value={coproType}
              onChange={(e) => setCoproType(e.target.value as Apartment['coproType'])}
              className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
            >
              <option value="apartment">{tr('Appartement', 'شقة سكنية')}</option>
              <option value="duplex">{tr('Duplex / Penthouse', 'دوبلكس / بنتهاوس')}</option>
              <option value="commercial">{tr('Local Commercial', 'محل تجاري')}</option>
              <option value="parking">{tr('Place de Parking', 'موقف سيارة')}</option>
              <option value="box">{tr('Box / Garage', 'مرآب / مستودع')}</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              {tr('Étage', 'الطابق')}
            </label>
            <input
              type="number"
              required
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
              {tr('Superficie (m²)', 'المساحة (م²)')}
            </label>
            <input
              type="number"
              required
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
              {tr('Tantièmes (/1000)', 'الحصص العقارية (/1000)')}
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
              {tr('Cotisation (MAD)', 'المساهمة (درهم)')}
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
            {tr('Copropriétaire (Propriétaire - Optionnel)', 'المالك المشترك (اختياري)')}
          </label>
          <select
            value={ownerId || ''}
            onChange={(e) => setOwnerId(e.target.value || null)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
          >
            <option value="">
              {tr('-- Lot non assigné / Sans copropriétaire --', '-- وحدة غير معينة / بدون مالك --')}
            </option>
            {residents
              .filter((r) => r.isOwner)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {getResidentLabel(r)}
                </option>
              ))}
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            {tr(
              "Vous pouvez également assigner un lot directement depuis la fiche d'un résident.",
              'يمكنكم أيضاً تعيين شقة مباشرة من بطاقة الساكن.'
            )}
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            {tr('Locataire (Si applicable)', 'المكتري (إن وجد)')}
          </label>
          <select
            value={tenantId || ''}
            onChange={(e) => setTenantId(e.target.value || null)}
            className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
          >
            <option value="">
              {tr(
                '-- Aucun locataire (Occupé par propriétaire ou vacant) --',
                '-- بدون مكتري (مشغولة من المالك أو شاغرة) --'
              )}
            </option>
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
  onBulkCreate: (apartments: Omit<Apartment, 'id' | 'buildingId'>[]) => Promise<unknown> | void;
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
  const { tr } = useI18n();
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

  const handleConfirmBulk = async () => {
    if (validNonDuplicateRows.length === 0) throw new Error(tr('Aucun lot valide à créer. Vérifiez les numéros et les doublons.', 'لا توجد وحدات صالحة للإنشاء. تحقق من الأرقام والتكرارات.'));
    await onBulkCreate(
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
      onSubmit={handleConfirmBulk}
      title={tr(
        'Création en masse de lots (Générateur par étages / blocs)',
        'إنشاء جماعي للشقق والوحدات (حسب الطوابق / الأجنحة)'
      )}
      footer={
        <div className="flex flex-wrap items-center justify-between w-full gap-2">
          <span className="text-xs text-slate-500">
            <strong>{validNonDuplicateRows.length}</strong>{' '}
            {tr('lots prêts à créer', 'وحدة جاهزة للإنشاء')}
            {duplicateCount > 0 && (
              <span className="text-amber-600 ms-1">
                ({duplicateCount} {tr('doublon(s) ignoré(s)', 'مكررة تم تجاهلها')})
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button
              type="submit"
              disabled={validNonDuplicateRows.length === 0}
            >
              {tr(
                `Créer ${validNonDuplicateRows.length} lots en masse`,
                `إنشاء ${validNonDuplicateRows.length} وحدة دفعة واحدة`
              )}
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
                {tr('Préfixe / Bloc', 'البادئة / الجناح')}
              </label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder={tr('Ex: A- ou vide', 'مثال: A- أو فارغ')}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {tr('Étage début', 'من الطابق')}
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
                {tr('Étage fin', 'إلى الطابق')}
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
                {tr('Lots / étage', 'عدد الشقق / طابق')}
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
                {tr('Numérotation', 'طريقة الترقيم')}
              </label>
              <select
                value={numberingPattern}
                onChange={(e) => setNumberingPattern(e.target.value as any)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              >
                <option value="floor_num">{tr('Étage + N° (101, 102...)', 'الطابق + الرقم (101، 102...)')}</option>
                <option value="floor_alpha">{tr('Étage + Lettre (1A, 1B...)', 'الطابق + حرف (1A، 1B...)')}</option>
                <option value="sequential">{tr('Séquentiel (1, 2, 3...)', 'تسلسلي (1، 2، 3...)')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {tr('Type de bien', 'نوع العقار')}
              </label>
              <select
                value={coproType}
                onChange={(e) => setCoproType(e.target.value as Apartment['coproType'])}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded text-xs bg-white"
              >
                <option value="apartment">{tr('Appartement', 'شقة')}</option>
                <option value="duplex">{tr('Duplex', 'دوبلكس')}</option>
                <option value="commercial">{tr('Commercial', 'محل تجاري')}</option>
                <option value="parking">{tr('Parking', 'موقف سيارة')}</option>
                <option value="box">{tr('Box / Garage', 'مرآب')}</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                {tr('Surface (m²)', 'المساحة (م²)')}
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
                {tr('Cotisation (MAD)', 'المساهمة (درهم)')}
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
              <span>
                {tr(
                  'Répartir automatiquement 1000 tantièmes sur la série générée',
                  'توزيع 1000 حصة عقارية تلقائياً على المجموعة المُنشأة'
                )}
              </span>
            </label>
            {!distributeTantiemes && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-600">
                  {tr('Tantièmes fixe/lot :', 'حصص ثابتة لكل وحدة :')}
                </span>
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
              {tr(
                `Aperçu et personnalisation avant création (${previewRows.length} lots)`,
                `معاينة وتخصيص قبل الإنشاء (${previewRows.length} وحدة)`
              )}
            </h4>
          </div>
          <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-lg">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-100 sticky top-0">
                <tr className="text-start text-slate-600">
                  <th className="px-2.5 py-2">{tr('N° Lot', 'رقم الشقة')}</th>
                  <th className="px-2.5 py-2">{tr('Étage', 'الطابق')}</th>
                  <th className="px-2.5 py-2">{tr('Surface (m²)', 'المساحة (م²)')}</th>
                  <th className="px-2.5 py-2">{tr('Tantièmes', 'الحصص')}</th>
                  <th className="px-2.5 py-2">{tr('Frais (MAD)', 'الواجب (درهم)')}</th>
                  <th className="px-2.5 py-2 text-end">{tr('Retirer', 'إزالة')}</th>
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
                            {tr('Existe déjà', 'موجود مسبقاً')}
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
                      <td className="px-2.5 py-1.5 text-end">
                        <button
                          type="button"
                          onClick={() => handleRemoveRow(row.tempId)}
                          className="p-1 text-slate-400 hover:text-rose-600 rounded"
                          title={tr('Retirer cette ligne', 'إزالة هذا السطر')}
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
  onAddApartment: (apartment: Omit<Apartment, 'id' | 'buildingId'>) => Promise<unknown> | void;
  onAddApartmentsBulk?: (apartments: Omit<Apartment, 'id' | 'buildingId'>[]) => Promise<unknown> | void;
  onRebalanceTantiemes?: () => Promise<unknown> | void;
  onUpdateApartment: (apartment: Apartment) => Promise<unknown> | void;
  onDeleteApartment: (apartmentId: string) => Promise<unknown> | void;
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
  const { tr } = useI18n();
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

  const confirmDelete = async () => {
    if (deletingApartment) {
      await onDeleteApartment(deletingApartment.id);
      setDeletingApartment(null);
    }
  };

  const typeLabels: Record<string, string> = {
    apartment: tr('Appartement', 'شقة'),
    duplex: tr('Duplex', 'دوبلكس'),
    commercial: tr('Commercial', 'تجاري'),
    parking: tr('Parking', 'موقف سيارة'),
    box: tr('Box / Garage', 'مرآب'),
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
        title={`${tr('Supprimer le lot', 'حذف الشقة / الوحدة')} ${deletingApartment?.number || ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingApartment(null)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button variant="danger" onClick={confirmDelete} className="ms-3">
              {tr('Supprimer le lot', 'حذف الوحدة')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          {tr(
            `Confirmez-vous la suppression du lot ${deletingApartment?.number} (Étage ${deletingApartment?.floor}) ? Les résidents rattachés seront automatiquement désassignés de ce lot.`,
            `هل تؤكدون حذف الشقة / الوحدة ${deletingApartment?.number} (الطابق ${deletingApartment?.floor})؟ سيتم إلغاء ربط السكان المسجلين بهذه الوحدة تلقائياً.`
          )}
        </p>
      </Modal>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            {tr('Lots de Copropriété & Tantièmes', 'الشقق والوحدات والحصص العقارية')}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {tr(
              `Répartition des quotes-parts d'indivision (Loi 18-00) pour ${building.name}`,
              `توزيع الحصص الشائعة للملكية المشتركة (قانون 18-00) لإقامة ${building.name}`
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => exportApartmentsPDF(building, residents)}
            disabled={building.apartments.length === 0}
            className="flex items-center gap-1.5 text-xs sm:text-sm"
            title={tr(
              "Exporter l'inventaire des lots et tantièmes en PDF (Loi 18-00)",
              'تصدير جرد الشقق والحصص العقارية بصيغة PDF (قانون 18-00)'
            )}
          >
            <DocumentsIcon />
            <span>{tr('Exporter PDF', 'تصدير PDF')}</span>
          </Button>
          <Button
            variant="secondary"
            onClick={() => exportApartmentsCSV(building, residents)}
            disabled={building.apartments.length === 0}
            className="flex items-center gap-1.5 text-xs sm:text-sm"
            title={tr(
              "Exporter l'inventaire des lots au format CSV (Excel)",
              'تصدير جرد الشقق بصيغة CSV (إكسل)'
            )}
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
              <span>{tr('Création en masse (Bulk)', 'إنشاء جماعي للشقق')}</span>
            </Button>
          )}
          <Button onClick={handleAdd} className="flex items-center gap-2 text-sm">
            <PlusIcon />
            <span>{tr('Ajouter un lot', 'إضافة شقة / وحدة')}</span>
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <Card className="p-4 border-s-4 border-s-teal-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {tr('Total des Lots', 'مجموع الوحدات / الشقق')}
          </p>
          <p className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {totalCount} {tr('lots', 'شقة')}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {building.apartments.filter((a) => a.ownerId || a.tenantId).length}{' '}
            {tr('lots occupés / assignés', 'وحدة مشغولة / معينة')}
          </p>
        </Card>

        <Card className="p-4 border-s-4 border-s-indigo-600">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {tr('Total Tantièmes Enregistrés', 'مجموع الحصص العقارية المسجلة')}
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
                title={tr(
                  'Répartir proportionnellement à la superficie sur 1000',
                  'توزيع الحصص تناسبياً حسب المساحة على 1000'
                )}
              >
                {tr('Équilibrer / 1000', 'موازنة / 1000')}
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {totalTantiemesSum === 1000
              ? tr('✓ Total exact (1000/1000)', '✓ المجموع مضبوط (1000/1000)')
              : tr('⚠ À équilibrer sur 1000 millièmes', '⚠ يجب موازنة المجموع على 1000 جزء')}
          </p>
        </Card>

        <Card className="p-4 border-s-4 border-s-emerald-600">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {tr('Superficie Totale Privative', 'المساحة الإجمالية الخاصة')}
          </p>
          <p className="text-2xl font-bold font-mono text-emerald-800 mt-1">
            {building.apartments.reduce((sum, a) => sum + (a.area || 0), 0)} m²
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {tr('Base du calcul de répartition', 'أساس احتساب توزيع التكاليف')}
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
                    {tr('Lot', 'شقة')} {apartment.number}
                  </span>
                  <span className="text-xs text-slate-500">
                    · {typeLabels[apartment.coproType || 'apartment']} · {tr('Étage', 'الطابق')}{' '}
                    {apartment.floor}
                  </span>
                </div>
                <p className="text-xs text-slate-700 mt-1">
                  <strong>{tr('Propriétaire :', 'المالك :')}</strong>{' '}
                  {apartment.ownerId
                    ? residentMap.get(apartment.ownerId) || tr('Assigné', 'مُعيّن')
                    : tr('Non assigné', 'غير معين')}
                </p>
                {apartment.tenantId && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    <strong>{tr('Locataire :', 'المكتري :')}</strong>{' '}
                    {residentMap.get(apartment.tenantId)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => handleEdit(apartment)}
                  className="p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 min-w-[40px] min-h-[40px] flex items-center justify-center"
                  title={tr('Modifier', 'تعديل')}
                >
                  <PencilIcon />
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingApartment(apartment)}
                  className="p-2 text-slate-500 hover:text-rose-600 rounded-lg hover:bg-rose-50 min-w-[40px] min-h-[40px] flex items-center justify-center"
                  title={tr('Supprimer', 'حذف')}
                >
                  <TrashIcon />
                </button>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px]">
                  {tr('Superficie', 'المساحة')}
                </span>
                <span className="font-mono font-semibold text-slate-700">
                  {apartment.area} m²
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">
                  {tr('Tantièmes', 'الحصص')}
                </span>
                <span className="font-mono font-bold text-teal-700">
                  {apartment.tantiemes || 100} / 1000
                </span>
              </div>
              <div className="text-end">
                <span className="text-slate-400 block text-[10px]">
                  {tr('Cotisation', 'المساهمة')}
                </span>
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
            <thead className="bg-slate-50 text-slate-500 text-start font-medium">
              <tr>
                <th className="px-4 py-2.5 text-start">{tr('Lot / N°', 'رقم الوحدة')}</th>
                <th className="px-4 py-2.5 text-start">{tr('Type', 'النوع')}</th>
                <th className="px-4 py-2.5 text-start">{tr('Étage', 'الطابق')}</th>
                <th className="px-4 py-2.5 text-start">{tr('Copropriétaire', 'المالك المشترك')}</th>
                <th className="px-4 py-2.5 text-start">{tr('Locataire', 'المكتري')}</th>
                <th className="px-4 py-2.5 text-end">{tr('Superficie', 'المساحة')}</th>
                <th className="px-4 py-2.5 text-end font-semibold text-teal-800">
                  {tr('Tantièmes', 'الحصص')}
                </th>
                <th className="px-4 py-2.5 text-end">{tr('Cotisation', 'المساهمة')}</th>
                <th className="px-4 py-2.5 text-end">{tr('Actions', 'إجراءات')}</th>
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
                      <span className="text-xs text-slate-400 italic">
                        {tr('Non assigné', 'غير معين')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {apartment.tenantId
                      ? residentMap.get(apartment.tenantId)
                      : '---'}
                  </td>
                  <td className="px-4 py-2 text-end font-mono text-slate-700">
                    {apartment.area} m²
                  </td>
                  <td className="px-4 py-2 text-end font-mono font-bold text-teal-700">
                    {apartment.tantiemes || 100} / 1000
                  </td>
                  <td className="px-4 py-2 text-end font-mono text-slate-800">
                    {apartment.monthlyFees} MAD
                  </td>
                  <td className="px-4 py-2 text-end space-x-1.5 whitespace-nowrap">
                    <button
                      onClick={() => handleEdit(apartment)}
                      className="p-1 text-slate-400 hover:text-slate-600 rounded"
                      title={tr('Modifier', 'تعديل')}
                    >
                      <PencilIcon />
                    </button>
                    <button
                      onClick={() => setDeletingApartment(apartment)}
                      className="p-1 text-slate-400 hover:text-rose-600 rounded"
                      title={tr('Supprimer', 'حذف')}
                    >
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              ))}
              {building.apartments.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-slate-400">
                    {tr(
                      'Aucun lot enregistré pour cet immeuble. Utilisez « Création en masse » ou « Ajouter un lot ».',
                      'لا توجد أي شقة مسجلة لهذه العمارة. استخدموا « إنشاء جماعي للشقق » أو « إضافة شقة / وحدة ».'
                    )}
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
