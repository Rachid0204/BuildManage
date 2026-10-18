import React, { useState } from 'react';
import type { Building, Syndic, SubscriptionPlan } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { PlusIcon } from '../icons/IconComponents';
import { useI18n } from '../../hooks/useI18n';

type BuildingModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    buildingData: Omit<
      Building,
      | 'id'
      | 'residents'
      | 'apartments'
      | 'announcements'
      | 'documents'
      | 'financials'
      | 'syndicId'
    >,
    numApartments: number,
    numberingSystem: 'numeric' | 'alphabetic'
  ) => void;
  syndicName: string;
};

const BuildingModal: React.FC<BuildingModalProps> = ({
  isOpen,
  onClose,
  onSave,
  syndicName,
}) => {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [numApartments, setNumApartments] = useState('');
  const [numberingSystem, setNumberingSystem] = useState<
    'numeric' | 'alphabetic'
  >('numeric');
  const [monthlyFees, setMonthlyFees] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setName('');
    setAddress('');
    setCity('');
    setNumApartments('');
    setNumberingSystem('numeric');
    setMonthlyFees('');
    setManagerName('');
    setManagerPhone('');
    setErrors({});
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim())
      newErrors.name = t('buildings.modal.validation.nameRequired');
    if (!address.trim())
      newErrors.address = t('buildings.modal.validation.addressRequired');
    if (!city.trim())
      newErrors.city = t('buildings.modal.validation.cityRequired');

    const numApt = parseInt(numApartments, 10);
    if (!numApartments.trim()) {
      newErrors.numApartments = t(
        'buildings.modal.validation.numApartmentsRequired'
      );
    } else if (isNaN(numApt) || numApt <= 0) {
      newErrors.numApartments = t(
        'buildings.modal.validation.numApartmentsInvalid'
      );
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

    onSave(
      {
        name,
        address,
        city,
        monthlySyndicFees: parseFloat(monthlyFees),
        managerName: managerName.trim() || undefined,
        managerPhone: managerPhone.trim() || undefined,
      },
      parseInt(numApartments, 10),
      numberingSystem
    );
    resetForm();
    onClose();
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const renderError = (field: string) =>
    errors[field] ? (
      <p className="text-sm text-red-600 mt-1">{errors[field]}</p>
    ) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('buildings.modal.addTitle')}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose}>
            {t('buildings.modal.cancel')}
          </Button>
          <Button onClick={handleSave} className="ms-3">
            {t('buildings.modal.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="bld-name"
            className="block text-sm font-medium text-gray-700"
          >
            {t('buildings.modal.name')}
          </label>
          <input
            type="text"
            id="bld-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('buildings.modal.namePlaceholder')}
            className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm ${
              errors.name ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {renderError('name')}
        </div>
        <div>
          <label
            htmlFor="bld-address"
            className="block text-sm font-medium text-gray-700"
          >
            {t('buildings.modal.address')}
          </label>
          <input
            type="text"
            id="bld-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={t('buildings.modal.addressPlaceholder')}
            className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm ${
              errors.address ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {renderError('address')}
        </div>
        <div>
          <label
            htmlFor="bld-city"
            className="block text-sm font-medium text-gray-700"
          >
            {t('buildings.modal.city')}
          </label>
          <input
            type="text"
            id="bld-city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder={t('buildings.modal.cityPlaceholder')}
            className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm ${
              errors.city ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {renderError('city')}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="bld-num-apartments"
              className="block text-sm font-medium text-gray-700"
            >
              {t('buildings.modal.numApartments')}
            </label>
            <input
              type="number"
              id="bld-num-apartments"
              value={numApartments}
              onChange={(e) => setNumApartments(e.target.value)}
              placeholder={t('buildings.modal.numApartmentsPlaceholder')}
              className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm ${
                errors.numApartments ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {renderError('numApartments')}
          </div>
          <div>
            <label
              htmlFor="bld-numbering"
              className="block text-sm font-medium text-gray-700"
            >
              {t('buildings.modal.numberingSystem')}
            </label>
            <select
              id="bld-numbering"
              value={numberingSystem}
              onChange={(e) =>
                setNumberingSystem(
                  e.target.value as 'numeric' | 'alphabetic'
                )
              }
              className="mt-1 block w-full px-3 py-2 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
            >
              <option value="numeric">{t('buildings.modal.numeric')}</option>
              <option value="alphabetic">
                {t('buildings.modal.alphabetic')}
              </option>
            </select>
          </div>
        </div>
        <div>
          <label
            htmlFor="bld-monthly-fees"
            className="block text-sm font-medium text-gray-700"
          >
            {t('buildings.modal.monthlyFees')}
          </label>
          <input
            type="number"
            id="bld-monthly-fees"
            value={monthlyFees}
            onChange={(e) => setMonthlyFees(e.target.value)}
            placeholder={t('buildings.modal.monthlyFeesPlaceholder')}
            className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm ${
              errors.monthlyFees ? 'border-red-500' : 'border-gray-300'
            }`}
          />
          {renderError('monthlyFees')}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="bld-manager-name"
              className="block text-sm font-medium text-gray-700"
            >
              {t('buildings.modal.managerName')}
            </label>
            <input
              type="text"
              id="bld-manager-name"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              placeholder={t('buildings.modal.managerNamePlaceholder')}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="bld-manager-phone"
              className="block text-sm font-medium text-gray-700"
            >
              {t('buildings.modal.managerPhone')}
            </label>
            <input
              type="text"
              id="bld-manager-phone"
              value={managerPhone}
              onChange={(e) => setManagerPhone(e.target.value)}
              placeholder={t('buildings.modal.managerPhonePlaceholder')}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('buildings.modal.manager')}
          </label>
          <p className="mt-1 text-sm text-gray-500 bg-gray-100 px-3 py-2 rounded-md">
            {syndicName}
          </p>
        </div>
      </div>
    </Modal>
  );
};

const SubscriptionStatusCard: React.FC<{ syndic: Syndic }> = ({ syndic }) => {
  const { t } = useI18n();
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
              {isExpired ? 'Expired' : 'Active'}
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
          <Button variant="secondary" className="mt-2 text-xs px-3 py-1 h-8">
            {t('subscription.upgrade')}
          </Button>
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
    buildingData: Omit<
      Building,
      | 'id'
      | 'residents'
      | 'apartments'
      | 'announcements'
      | 'documents'
      | 'financials'
      | 'syndicId'
    >,
    numApartments: number,
    numberingSystem: 'numeric' | 'alphabetic'
  ) => void;
  onSelectBuilding: (building: Building) => void;
}> = ({ syndic, onAddBuilding, onSelectBuilding }) => {
  const { t } = useI18n();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const planLimits: Record<SubscriptionPlan, number> = {
    starter: 4,
    professional: 8,
    enterprise: Infinity,
  };
  const limitReached =
    syndic.buildings.length >= planLimits[syndic.subscriptionPlan];
  const isExpired = new Date(syndic.subscriptionExpiry) < new Date();
  const canAdd = !limitReached && !isExpired;

  return (
    <div>
      <BuildingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={onAddBuilding}
        syndicName={syndic.name}
      />

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">
            {t('buildings.title')}
          </h1>
          <p className="text-gray-500 mt-1">{t('buildings.subtitle')}</p>
        </div>
        <div className="flex flex-col items-end">
          <Button
            icon={<PlusIcon />}
            onClick={() => setIsModalOpen(true)}
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
          {syndic.buildings.map((building) => (
            <Card
              key={building.id}
              className="cursor-pointer hover:shadow-lg hover:border-primary-500 border-transparent border transition-shadow"
              onClick={() => onSelectBuilding(building)}
            >
              <h2 className="text-xl font-semibold text-gray-800">
                {building.name}
              </h2>
              <p className="text-sm text-gray-500 mt-1">{`${building.address}, ${building.city}`}</p>
              <div className="mt-4 pt-4 border-t border-gray-200 flex justify-between text-sm text-gray-600">
                <span>
                  {building.apartments.length}{' '}
                  {t('apartments.summary.total')}
                </span>
                <span>
                  {building.residents.length}{' '}
                  {t('residents.title', { buildingName: '' }).trim()}
                </span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="text-center py-16">
          <h3 className="text-xl font-medium text-gray-800">
            {t('buildings.noBuildings')}
          </h3>
          <Button
            onClick={() => setIsModalOpen(true)}
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
