
import React, { useState } from 'react';
import type { Building, Announcement } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import { PlusIcon, SparklesIcon } from '../icons/IconComponents';
import Modal from '../common/Modal';
import { generateAnnouncementText } from '../../services/geminiService';
import { useI18n } from '../../hooks/useI18n';

const AnnouncementModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: { title: string, content: string }) => void;
    buildingName: string;
}> = ({ isOpen, onClose, onSave, buildingName }) => {
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [aiTopic, setAiTopic] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const { t, language } = useI18n();

    const resetForm = () => {
        setTitle('');
        setContent('');
        setAiTopic('');
    };

    const handleGenerate = async () => {
        if (!aiTopic) return;
        setIsGenerating(true);
        try {
            const generatedContent = await generateAnnouncementText(aiTopic, buildingName, language);
            // FIX: Trim the AI-generated content before setting it in the state.
            setContent(generatedContent.trim());
        } catch (error) {
            console.error("Failed to generate announcement", error);
            setContent(t('announcements.modal.generationError'));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleSave = () => {
        if (title && content) {
            onSave({ title, content });
            resetForm();
            onClose();
        } else {
            alert("Please fill in a title and content.");
        }
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };


    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            title={t('announcements.modal.title')}
            footer={
                <>
                    <Button variant="secondary" onClick={handleClose}>{t('announcements.modal.cancel')}</Button>
                    <Button onClick={handleSave} className="ms-3">{t('announcements.modal.post')}</Button>
                </>
            }
        >
            <div className="space-y-4">
                <div>
                    <label htmlFor="title" className="block text-sm font-medium text-gray-700">{t('announcements.modal.announcementTitle')}</label>
                    <input type="text" id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('announcements.modal.titlePlaceholder')} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm" />
                </div>
                <div>
                    <label htmlFor="ai-topic" className="block text-sm font-medium text-gray-700">{t('announcements.modal.generateWithAi')}</label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                        <input type="text" id="ai-topic" placeholder={t('announcements.modal.aiPlaceholder')} value={aiTopic} onChange={(e) => setAiTopic(e.target.value)} className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-s-md focus:ring-primary-500 focus:border-primary-500 sm:text-sm border-gray-300" />
                        <Button onClick={handleGenerate} disabled={isGenerating || !aiTopic} className="inline-flex items-center px-3 rounded-e-md border border-s-0 border-gray-300 bg-gray-50 text-gray-500 text-sm !shadow-none !rounded-s-none">
                           {isGenerating ? t('announcements.modal.generating') : <SparklesIcon />}
                        </Button>
                    </div>
                </div>
                <div>
                    <label htmlFor="content" className="block text-sm font-medium text-gray-700">{t('announcements.modal.content')}</label>
                    <textarea id="content" value={content} onChange={(e) => setContent(e.target.value)} rows={6} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm"></textarea>
                </div>
            </div>
        </Modal>
    );
};

const Announcements: React.FC<{ 
    building: Building; 
    announcements: Announcement[];
    onAddAnnouncement: (data: { title: string, content: string }) => void;
}> = ({ building, announcements, onAddAnnouncement }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const { t } = useI18n();
    
    // The announcements are now sorted in App.tsx by prepending new ones
    const sortedAnnouncements = announcements;

    return (
        <div>
             <AnnouncementModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                buildingName={building.name} 
                onSave={onAddAnnouncement}
            />
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold text-gray-800">{t('announcements.title', { buildingName: building.name })}</h1>
                <Button icon={<PlusIcon />} onClick={() => setIsModalOpen(true)}>{t('announcements.add')}</Button>
            </div>
            
            <div className="space-y-6">
                {sortedAnnouncements.length > 0 ? sortedAnnouncements.map(announcement => (
                    <Card key={announcement.id}>
                        <div className="flex justify-between items-start">
                             <div>
                                <h2 className="text-xl font-semibold text-gray-800">{announcement.title}</h2>
                                <p className="text-sm text-gray-500">{new Date(announcement.date).toLocaleString()}</p>
                             </div>
                        </div>
                        <p className="mt-4 text-gray-600 whitespace-pre-wrap">{announcement.content}</p>
                    </Card>
                )) : (
                    <Card className="text-center py-12">
                         <p className="text-gray-500">{t('announcements.noAnnouncements')}</p>
                    </Card>
                )}
            </div>
        </div>
    );
};

export default Announcements;