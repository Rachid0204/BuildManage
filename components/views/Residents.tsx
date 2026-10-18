
import React, { useState, useMemo } from 'react';
import type { Building, Resident } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { useI18n } from '../../hooks/useI18n';
import { PlusIcon, PencilIcon, TrashIcon } from '../icons/IconComponents';

type ResidentModalProps = {
    isOpen: boolean;
    onClose: () => void;
    onSave: (resident: Omit<Resident, 'id' | 'syndicId' | 'buildingId'> | Resident, generateCredentials?: boolean) => void;
    existingResident?: Resident | null;
};

const ResidentModal: React.FC<ResidentModalProps> = ({ isOpen, onClose, onSave, existingResident }) => {
    const { t } = useI18n();
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [isOwner, setIsOwner] = useState(false);
    const [generateCredentials, setGenerateCredentials] = useState(false);

    React.useEffect(() => {
        if (existingResident) {
            setName(existingResident.name);
            setEmail(existingResident.email);
            setPhone(existingResident.phone);
            setIsOwner(existingResident.isOwner);
            setGenerateCredentials(false);
        } else {
            setName('');
            setEmail('');
            setPhone('');
            setIsOwner(false);
            setGenerateCredentials(true); // Default to true for new residents
        }
    }, [existingResident, isOpen]);

    const handleSave = () => {
        if (!name || !email || !phone) {
            alert('Please fill all fields');
            return;
        }
        const residentData = { name, email, phone, isOwner };
        if (existingResident) {
            onSave({ ...existingResident, ...residentData });
        } else {
            onSave(residentData, generateCredentials);
        }
        onClose();
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={existingResident ? t('residents.modal.editTitle') : t('residents.modal.addTitle')}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>{t('residents.modal.cancel')}</Button>
                    <Button onClick={handleSave} className="ms-3">{t('residents.modal.save')}</Button>
                </>
            }
        >
            <div className="space-y-4">
                <div>
                    <label htmlFor="res-name" className="block text-sm font-medium text-gray-700">{t('residents.modal.name')}</label>
                    <input type="text" id="res-name" value={name} onChange={e => setName(e.target.value)} placeholder={t('residents.modal.namePlaceholder')} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
                </div>
                <div>
                    <label htmlFor="res-email" className="block text-sm font-medium text-gray-700">{t('residents.modal.email')}</label>
                    <input type="email" id="res-email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('residents.modal.emailPlaceholder')} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
                </div>
                <div>
                    <label htmlFor="res-phone" className="block text-sm font-medium text-gray-700">{t('residents.modal.phone')}</label>
                    <input type="tel" id="res-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('residents.modal.phonePlaceholder')} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">{t('residents.modal.role')}</label>
                     <div className="mt-2 flex space-x-4">
                        <label className="flex items-center">
                            <input type="radio" value="owner" checked={isOwner} onChange={() => setIsOwner(true)} className="form-radio h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500" />
                            <span className="ms-2 text-sm text-gray-700">{t('residents.modal.owner')}</span>
                        </label>
                        <label className="flex items-center">
                            <input type="radio" value="tenant" checked={!isOwner} onChange={() => setIsOwner(false)} className="form-radio h-4 w-4 text-primary-600 border-gray-300 focus:ring-primary-500" />
                            <span className="ms-2 text-sm text-gray-700">{t('residents.modal.tenant')}</span>
                        </label>
                    </div>
                </div>
                {!existingResident && (
                    <div className="mt-4 bg-blue-50 p-3 rounded-md">
                        <label className="flex items-start">
                            <input type="checkbox" checked={generateCredentials} onChange={e => setGenerateCredentials(e.target.checked)} className="mt-1 form-checkbox h-4 w-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500" />
                            <div className="ms-2">
                                <span className="text-sm font-medium text-gray-900">Generate Login Credentials automatically?</span>
                                <p className="text-xs text-gray-500">This will create a user account for the resident and allow them to log in.</p>
                            </div>
                        </label>
                    </div>
                )}
            </div>
        </Modal>
    );
};

const Residents: React.FC<{
    building: Building;
    onAddResident: (resident: Omit<Resident, 'id' | 'syndicId' | 'buildingId'>, generateCredentials?: boolean) => void;
    onUpdateResident: (resident: Resident) => void;
    onDeleteResident: (residentId: string) => void;
}> = ({ building, onAddResident, onUpdateResident, onDeleteResident }) => {
    const { t } = useI18n();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedResident, setSelectedResident] = useState<Resident | null>(null);

    const handleEdit = (resident: Resident) => {
        setSelectedResident(resident);
        setIsModalOpen(true);
    };

    const handleAdd = () => {
        setSelectedResident(null);
        setIsModalOpen(true);
    };

    const handleDelete = (resident: Resident) => {
        if (window.confirm(t('residents.deleteConfirm.message', { name: resident.name }))) {
            onDeleteResident(resident.id);
        }
    };

    return (
        <div>
            <ResidentModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={selectedResident ? onUpdateResident : onAddResident}
                existingResident={selectedResident}
            />
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900">{t('residents.title', { buildingName: building.name })}</h1>
                <Button icon={<PlusIcon />} onClick={handleAdd} className="w-full sm:w-auto justify-center">{t('residents.add')}</Button>
            </div>

            {/* Mobile Card List (< md) */}
            <div className="md:hidden space-y-3">
                {building.residents.map(resident => (
                    <Card key={resident.id} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <h3 className="text-sm font-bold text-slate-900 truncate">{resident.name}</h3>
                                    <span className={`px-2 py-0.5 inline-flex text-[11px] font-semibold rounded-full ${resident.isOwner ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                                        {resident.isOwner ? t('residents.role.owner') : t('residents.role.tenant')}
                                    </span>
                                </div>
                                <p className="text-xs text-slate-500 mt-1 truncate">{resident.email}</p>
                                <p className="text-xs text-slate-600 font-medium mt-0.5">{resident.phone}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                <Button variant="secondary" className="!p-2 min-w-[40px] min-h-[40px]" onClick={() => handleEdit(resident)} title={t('residents.modal.editTitle')}><PencilIcon /></Button>
                                <Button variant="danger" className="!p-2 min-w-[40px] min-h-[40px]" onClick={() => handleDelete(resident)} title="Delete"><TrashIcon /></Button>
                            </div>
                        </div>
                    </Card>
                ))}
                {building.residents.length === 0 && (
                    <Card><p className="text-center py-8 text-gray-500">{t('residents.noResidents')}</p></Card>
                )}
            </div>

            {/* Desktop Table (md+) */}
            <Card className="hidden md:block">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('residents.table.name')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('residents.table.email')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('residents.table.phone')}</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('residents.table.role')}</th>
                                <th className="relative px-6 py-3"><span className="sr-only">{t('residents.table.actions')}</span></th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {building.residents.map(resident => (
                                <tr key={resident.id}>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{resident.name}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{resident.email}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{resident.phone}</td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${resident.isOwner ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                                            {resident.isOwner ? t('residents.role.owner') : t('residents.role.tenant')}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2">
                                        <Button variant="secondary" className="!p-2" onClick={() => handleEdit(resident)} title={t('residents.modal.editTitle')}><PencilIcon /></Button>
                                        <Button variant="danger" className="!p-2" onClick={() => handleDelete(resident)} title="Delete"><TrashIcon /></Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {building.residents.length === 0 && <p className="text-center py-8 text-gray-500">{t('residents.noResidents')}</p>}
            </Card>
        </div>
    );
};

export default Residents;
