import React, { useState, useEffect } from 'react';
import ArchiveBuildings from './ArchiveBuildings';
import type { Building, Syndic, SubscriptionPlan } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { PlusIcon, PencilIcon, TrashIcon } from '../icons/IconComponents';
import { useI18n } from '../../hooks/useI18n';

export type BuildingFormPayload = Omit<
  Building,
  | 'id'
  | 'residents'
  | 'apartments'
  | 'announcements'
  | 'documents'
  | 'financials'
  | 'syndicId'
>;

type BuildingModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSaveCreate: (
    buildingData: BuildingFormPayload,
    numApartments: number,
    numberingSystem: 'numeric' | 'alphabetic' | 'floor_numeric',
    floorsCount: number
  ) => void;
  onSaveUpdate?: (
    buildingId: string,
    updates: Partial<BuildingFormPayload> & { syncApartmentFees?: boolean }
  ) => void;
  existingBuilding?: Building | null;
  syndicName: string;
};

const BuildingModal: React.FC<BuildingModalProps> = ({
  isOpen,
  onClose,
  onSaveCreate,
  onSaveUpdate,
  existingBuilding,
  syndicName,
}) => {
  const { t, tr } = useI18n();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [numApartments, setNumApartments] = useState('12');
  const [floorsCount, setFloorsCount] = useState('4');
  const [numberingSystem, setNumberingSystem] = useState<
    'numeric' | 'alphabetic' | 'floor_numeric'
  >('floor_numeric');
  const [monthlyFees, setMonthlyFees] = useState('250');
  const [reserveFundRate, setReserveFundRate] = useState('5');
  const [bankName, setBankName] = useState('');
  const [bankRib, setBankRib] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [syncApartmentFees, setSyncApartmentFees] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (existingBuilding) {
      setName(existingBuilding.name || '');
      setAddress(existingBuilding.address || '');
      setCity(existingBuilding.city || '');
      setMonthlyFees(String(existingBuilding.monthlySyndicFees || 250));
      setReserveFundRate(String(existingBuilding.reserveFundRate ?? 5));
      setBankName(existingBuilding.bankName || '');
      setBankRib(existingBuilding.bankRib || '');
      setManagerName(existingBuilding.managerName || '');
      setManagerPhone(existingBuilding.managerPhone || '');
      setSyncApartmentFees(false);
    } else {
      setName('');
      setAddress('');
      setCity('');
      setNumApartments('12');
      setFloorsCount('4');
      setNumberingSystem('floor_numeric');
      setMonthlyFees('250');
      setReserveFundRate('5');
      setBankName('');
      setBankRib('');
      setManagerName('');
      setManagerPhone('');
      setSyncApartmentFees(false);
    }
    setErrors({});
  }, [existingBuilding, isOpen]);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim())
      newErrors.name = t('buildings.modal.validation.nameRequired');
    if (!address.trim())
      newErrors.address = t('buildings.modal.validation.addressRequired');
    if (!city.trim())
      newErrors.city = t('buildings.modal.validation.cityRequired');

    if (!existingBuilding) {
      const numApt = parseInt(numApartments, 10);
      if (!numApartments.trim()) {
        newErrors.numApartments = t(
          'buildings.modal.validation.numApartmentsRequired'
        );
      } else if (isNaN(numApt) || numApt < 0) {
        newErrors.numApartments = t(
          'buildings.modal.validation.numApartmentsInvalid'
        );
      }
    }

    const fees = parseFloat(monthlyFees);
    if (!monthlyFees.trim()) {
      newErrors.monthlyFees = t(
        'buildings.modal.validation.monthlyFeesRequired'
      );
    } else if (isNaN(fees) || fees <= 0) {
      newErrors.monthlyFees = t(
        'buildings.modal.validation.monthlyFeesInvalid'
      );
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const payload: BuildingFormPayload = {
      name: name.trim(),
      address: address.trim(),
      city: city.trim(),
      monthlySyndicFees: parseFloat(monthlyFees),
      reserveFundRate: parseFloat(reserveFundRate) || 5,
      bankName: bankName.trim() || undefined,
      bankRib: bankRib.trim() || undefined,
      managerName: managerName.trim() || undefined,
      managerPhone: managerPhone.trim() || undefined,
    };

    if (existingBuilding && onSaveUpdate) {
      onSaveUpdate(existingBuilding.id, {
        ...payload,
        syncApartmentFees,
      });
    } else {
      onSaveCreate(
        payload,
        Math.max(0, parseInt(numApartments, 10) || 0),
        numberingSystem,
        Math.max(1, parseInt(floorsCount, 10) || 1)
      );
    }
    onClose();
  };

  const renderError = (field: string) =>
    errors[field] ? (
      <p className="text-xs text-red-600 mt-1">{errors[field]}</p>
    ) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        existingBuilding
          ? `${tr("Modifier l'immeuble :", 'تعديل العمارة :')} ${existingBuilding.name}`
          : t('buildings.modal.addTitle')
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('buildings.modal.cancel')}
          </Button>
          <Button onClick={handleSave} className="ms-3">
            {existingBuilding
              ? tr('Enregistrer les modifications', 'حفظ التعديلات')
              : t('buildings.modal.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="bld-name"
            className="block text-xs font-semibold text-slate-700 mb-1"
          >
            {t('buildings.modal.name')}
          </label>
          <input
            type="text"
            id="bld-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('buildings.modal.namePlaceholder')}
            className={`block w-full px-3 py-2 border rounded-md text-sm ${
              errors.name ? 'border-red-500' : 'border-slate-300'
            }`}
          />
          {renderError('name')}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label
              htmlFor="bld-address"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t('buildings.modal.address')}
            </label>
            <input
              type="text"
              id="bld-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('buildings.modal.addressPlaceholder')}
              className={`block w-full px-3 py-2 border rounded-md text-sm ${
                errors.address ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {renderError('address')}
          </div>
          <div>
            <label
              htmlFor="bld-city"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t('buildings.modal.city')}
            </label>
            <input
              type="text"
              id="bld-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={t('buildings.modal.cityPlaceholder')}
              className={`block w-full px-3 py-2 border rounded-md text-sm ${
                errors.city ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {renderError('city')}
          </div>
        </div>

        {!existingBuilding && (
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-3">
            <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              {tr('Génération initiale des lots (Optionnel)', 'الإنشاء الأولي للشقق والوحدات (اختياري)')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="bld-num-apartments"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  {tr('Nombre de lots', 'عدد الشقق / الوحدات')}
                </label>
                <input
                  type="number"
                  id="bld-num-apartments"
                  min={0}
                  value={numApartments}
                  onChange={(e) => setNumApartments(e.target.value)}
                  placeholder="Ex: 12"
                  className={`block w-full px-3 py-2 border rounded-md text-sm bg-white ${
                    errors.numApartments ? 'border-red-500' : 'border-slate-300'
                  }`}
                />
                {renderError('numApartments')}
              </div>
              <div>
                <label
                  htmlFor="bld-floors"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  {tr("Nombre d'étages", 'عدد الطوابق')}
                </label>
                <input
                  type="number"
                  id="bld-floors"
                  min={1}
                  value={floorsCount}
                  onChange={(e) => setFloorsCount(e.target.value)}
                  placeholder="Ex: 4"
                  className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm bg-white"
                />
              </div>
              <div>
                <label
                  htmlFor="bld-numbering"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  {tr('Format de numérotation', 'صيغة الترقيم')}
                </label>
                <select
                  id="bld-numbering"
                  value={numberingSystem}
                  onChange={(e) =>
                    setNumberingSystem(
                      e.target.value as 'numeric' | 'alphabetic' | 'floor_numeric'
                    )
                  }
                  className="block w-full px-3 py-2 border border-slate-300 bg-white rounded-md text-sm"
                >
                  <option value="floor_numeric">
                    {tr('Par étage (101, 102, 201...)', 'حسب الطابق (101، 102، 201...)')}
                  </option>
                  <option value="numeric">
                    {tr('Numérique (1, 2, 3...)', 'رقمي تسلسلي (1، 2، 3...)')}
                  </option>
                  <option value="alphabetic">
                    {tr('Alphabétique (A, B, C...)', 'أبجدي (A, B, C...)')}
                  </option>
                </select>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              {tr(
                "Vous pourrez aussi générer ou personnaliser des lots par bloc/étage via l'outil de création en masse dans le module Lots & Appartements.",
                'يمكنكم أيضاً إنشاء أو تخصيص الشقق حسب العمارة أو الطابق عبر أداة الإنشاء الجماعي في قسم الشقق والوحدات.'
              )}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="bld-monthly-fees"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t('buildings.modal.monthlyFees')} (MAD)
            </label>
            <input
              type="number"
              id="bld-monthly-fees"
              value={monthlyFees}
              onChange={(e) => setMonthlyFees(e.target.value)}
              placeholder={t('buildings.modal.monthlyFeesPlaceholder')}
              className={`block w-full px-3 py-2 border rounded-md text-sm ${
                errors.monthlyFees ? 'border-red-500' : 'border-slate-300'
              }`}
            />
            {renderError('monthlyFees')}
          </div>
          <div>
            <label
              htmlFor="bld-reserve-rate"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {tr('Fonds de réserve Loi 106-12 (%)', 'صندوق الاحتياط قانون 106-12 (%)')}
            </label>
            <input
              type="number"
              id="bld-reserve-rate"
              min={0}
              max={50}
              value={reserveFundRate}
              onChange={(e) => setReserveFundRate(e.target.value)}
              placeholder="Ex: 5"
              className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
            />
          </div>
        </div>

        {existingBuilding && (
          <label className="flex items-center gap-2 text-xs text-slate-700 bg-amber-50 border border-amber-200 p-2.5 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={syncApartmentFees}
              onChange={(e) => setSyncApartmentFees(e.target.checked)}
              className="rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span>
              {tr(
                `Appliquer cette nouvelle cotisation mensuelle (${monthlyFees || 0} MAD) à tous les lots existants de l'immeuble`,
                `تطبيق هذه المساهمة الشهرية الجديدة (${monthlyFees || 0} درهم) على جميع الشقق الحالية في العمارة`
              )}
            </span>
          </label>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="bld-bank-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {tr('Banque de la copropriété', 'بنك اتحاد الملاك')}
            </label>
            <input
              type="text"
              id="bld-bank-name"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Ex: Attijariwafa Bank, CIH, BCP..."
              className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="bld-bank-rib"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {tr('RIB (24 chiffres)', 'رقم الحساب البنكي RIB (24 رقماً)')}
            </label>
            <input
              type="text"
              id="bld-bank-rib"
              value={bankRib}
              onChange={(e) => setBankRib(e.target.value)}
              placeholder="Ex: 007 780 0001234567890123 45"
              className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="bld-manager-name"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t('buildings.modal.managerName')} ({tr('Concierge / Responsable', 'الحارس / المسؤول')})
            </label>
            <input
              type="text"
              id="bld-manager-name"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              placeholder={t('buildings.modal.managerNamePlaceholder')}
              className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="bld-manager-phone"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              {t('buildings.modal.managerPhone')}
            </label>
            <input
              type="text"
              id="bld-manager-phone"
              value={managerPhone}
              onChange={(e) => setManagerPhone(e.target.value)}
              placeholder={t('buildings.modal.managerPhonePlaceholder')}
              className="block w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">
            {t('buildings.modal.manager')}
          </label>
          <p className="text-xs text-slate-600 bg-slate-100 px-3 py-2 rounded-md">
            {syndicName}
          </p>
        </div>
      </div>
    </Modal>
  );
};

const SubscriptionStatusCard: React.FC<{ syndic: Syndic }> = ({ syndic }) => {
  const { t, tr } = useI18n();
  const planLimits: Record<SubscriptionPlan, number> = {
    starter: 4,
    professional: 8,
    enterprise: Infinity,
  };
  const currentCount = syndic.buildings.length;
  const maxCount = planLimits[syndic.subscriptionPlan];
  const isUnlimited = maxCount === Infinity;
  const usagePercent = isUnlimited
    ? 0
    : Math.min((currentCount / maxCount) * 100, 100);

  const isExpired = new Date(syndic.subscriptionExpiry) < new Date();

  return (
    <Card className="mb-8 border-t-4 border-primary-500">
      <h3 className="text-lg font-semibold text-gray-800">
        {t('subscription.status')}
      </h3>
      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div>
          <p className="text-sm text-gray-500">
            {t('subscription.plan', {
              plan: t(`subscription.plans.${syndic.subscriptionPlan}` as any),
            })}
          </p>
          <div className="mt-2 flex items-center">
            <span
              className={`px-2 py-1 text-xs font-semibold rounded-full ${
                isExpired
                  ? 'bg-red-100 text-red-800'
                  : 'bg-green-100 text-green-800'
              }`}
            >
              {isExpired ? tr('Expiré', 'منتهي الصلاحية') : tr('Actif', 'نشط')}
            </span>
          </div>
        </div>
        <div>
          <p className="text-sm text-gray-500">
            {isUnlimited
              ? t('subscription.usageUnlimited', {
                  current: String(currentCount),
                })
              : t('subscription.usage', {
                  current: String(currentCount),
                  max: String(maxCount),
                })}
          </p>
          {!isUnlimited && (
            <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
              <div
                className="bg-primary-600 h-2.5 rounded-full"
                style={{ width: `${usagePercent}%` }}
              ></div>
            </div>
          )}
        </div>
        <div>
          <p className="text-sm text-gray-500">
            {t('subscription.expiresOn', {
              date: new Date(syndic.subscriptionExpiry).toLocaleDateString(),
            })}
          </p>
        </div>
      </div>
      {isExpired && (
        <div className="mt-4 p-3 bg-red-50 text-red-700 text-sm rounded-md">
          {t('subscription.expired')}
        </div>
      )}
    </Card>
  );
};

const Buildings: React.FC<{
  syndic: Syndic;
  onAddBuilding: (
    buildingData: BuildingFormPayload,
    numApartments: number,
    numberingSystem: 'numeric' | 'alphabetic' | 'floor_numeric',
    floorsCount?: number
  ) => void;
  onUpdateBuilding?: (
    buildingId: string,
    updates: Partial<BuildingFormPayload> & { syncApartmentFees?: boolean }
  ) => void;
  onDeleteBuilding?: (buildingId: string) => void;
  onSelectBuilding: (building: Building) => void;
}> = ({
  syndic,
  onAddBuilding,
  onUpdateBuilding,
  onDeleteBuilding,
  onSelectBuilding,
}) => {
  const { t, tr } = useI18n();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState<Building | null>(null);
  const [deletingBuilding, setDeletingBuilding] = useState<Building | null>(null);

  const planLimits: Record<SubscriptionPlan, number> = {
    starter: 4,
    professional: 8,
    enterprise: Infinity,
  };
  const limitReached =
    syndic.buildings.length >= planLimits[syndic.subscriptionPlan];
  const isExpired = new Date(syndic.subscriptionExpiry) < new Date();
  const canAdd = !limitReached && !isExpired;

  const handleOpenCreate = () => {
    setEditingBuilding(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (e: React.MouseEvent, bld: Building) => {
    e.stopPropagation();
    setEditingBuilding(bld);
    setIsModalOpen(true);
  };

  const handleOpenDelete = (e: React.MouseEvent, bld: Building) => {
    e.stopPropagation();
    setDeletingBuilding(bld);
  };

  const confirmDelete = () => {
    if (deletingBuilding && onDeleteBuilding) {
      onDeleteBuilding(deletingBuilding.id);
    }
    setDeletingBuilding(null);
  };

  return (
    <div>
      <ArchiveBuildings />
      <BuildingModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingBuilding(null);
        }}
        onSaveCreate={onAddBuilding}
        onSaveUpdate={onUpdateBuilding}
        existingBuilding={editingBuilding}
        syndicName={syndic.name}
      />

      {/* Delete Building Confirmation Modal */}
      <Modal
        isOpen={!!deletingBuilding}
        onClose={() => setDeletingBuilding(null)}
        title={tr("Confirmer la suppression de l'immeuble", 'تأكيد حذف العمارة')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingBuilding(null)}>
              {tr('Annuler', 'إلغاء')}
            </Button>
            <Button variant="danger" onClick={confirmDelete} className="ms-3">
              {tr('Supprimer définitivement', 'حذف نهائي')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-600">
          <p>
            {tr('Êtes-vous sûr de vouloir supprimer la résidence', 'هل أنت متأكد من رغبتك في حذف الإقامة')}{' '}
            <strong className="text-slate-900">{deletingBuilding?.name}</strong> ?
          </p>
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
            {tr(
              `Cette action supprimera également les ${deletingBuilding?.apartments.length || 0} lots et ${deletingBuilding?.residents.length || 0} résidents rattachés à cet immeuble.`,
              `سيؤدي هذا الإجراء أيضاً إلى حذف ${deletingBuilding?.apartments.length || 0} شقة و ${deletingBuilding?.residents.length || 0} ساكن مرتبطين بهذه العمارة.`
            )}
          </div>
        </div>
      </Modal>

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            {t('buildings.title')}
          </h1>
          <p className="text-slate-500 text-sm mt-1">{t('buildings.subtitle')}</p>
        </div>
        <div className="flex flex-col sm:items-end">
          <Button
            icon={<PlusIcon />}
            onClick={handleOpenCreate}
            disabled={!canAdd}
            className={!canAdd ? 'opacity-50 cursor-not-allowed' : ''}
            title={
              !canAdd
                ? limitReached
                  ? t('subscription.limitReached')
                  : t('subscription.expired')
                : ''
            }
          >
            {t('buildings.add')}
          </Button>
        </div>
      </div>

      <SubscriptionStatusCard syndic={syndic} />

      {syndic.buildings.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {syndic.buildings.map((building) => {
            const occupiedLots = building.apartments.filter(
              (a) => a.ownerId || a.tenantId
            ).length;
            return (
              <Card
                key={building.id}
                className="cursor-pointer hover:shadow-lg hover:border-teal-600 border-slate-200 border transition-all flex flex-col justify-between"
                onClick={() => onSelectBuilding(building)}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">
                        {building.name}
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">{`${building.address}, ${building.city}`}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleOpenEdit(e, building)}
                        className="p-2 text-slate-400 hover:text-teal-700 hover:bg-slate-100 rounded-lg transition-colors"
                        title={tr("Modifier l'immeuble", 'تعديل العمارة')}
                      >
                        <PencilIcon />
                      </button>
                      {onDeleteBuilding && (
                        <button
                          type="button"
                          onClick={(e) => handleOpenDelete(e, building)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title={tr("Supprimer l'immeuble", 'حذف العمارة')}
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-100 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[11px]">
                        {tr('Cotisation Syndic', 'واجب السنديك الشهري')}
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {building.monthlySyndicFees} {tr('MAD / mois', 'درهم / شهر')}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[11px]">
                        {tr('Fonds Réserve', 'صندوق الاحتياط')}
                      </span>
                      <span className="font-mono font-bold text-teal-700">
                        {building.reserveFundRate ?? 5}% ({tr('Loi 106-12', 'قانون 106-12')})
                      </span>
                    </div>
                  </div>

                  {building.managerName && (
                    <p className="text-xs text-slate-600 mt-3">
                      <span className="font-semibold text-slate-700">
                        {tr('Responsable / Gardien :', 'المسؤول / الحارس :')}
                      </span>{' '}
                      {building.managerName} {building.managerPhone ? `(${building.managerPhone})` : ''}
                    </p>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                  <span className="font-medium">
                    <strong className="text-slate-900">{building.apartments.length}</strong>{' '}
                    {tr('lots', 'شقق')} ({occupiedLots} {tr('assignés', 'مُعيّنة')})
                  </span>
                  <span className="font-medium">
                    <strong className="text-slate-900">{building.residents.length}</strong>{' '}
                    {tr('résidents', 'سكان')}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="text-center py-16">
          <h3 className="text-xl font-medium text-gray-800">
            {t('buildings.noBuildings')}
          </h3>
          <Button
            onClick={handleOpenCreate}
            className="mt-4"
            disabled={!canAdd}
          >
            {t('buildings.add')}
          </Button>
        </Card>
      )}
    </div>
  );
};

export default Buildings;
