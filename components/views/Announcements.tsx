import React, { useState } from 'react';
import type { Building, Announcement } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import { PlusIcon, SparklesIcon, AnnouncementsIcon } from '../icons/IconComponents';
import Modal from '../common/Modal';
import { generateAnnouncementText } from '../../services/geminiService';
import { useI18n } from '../../hooks/useI18n';
import { useToast } from '../common/Toast';

const AnnouncementModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { title: string; content: string }) => void;
  buildingName: string;
}> = ({ isOpen, onClose, onSave, buildingName }) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [aiTopic, setAiTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { t, tr, language } = useI18n();
  const { showToast } = useToast();

  const resetForm = () => {
    setTitle('');
    setContent('');
    setAiTopic('');
    setErrorMsg(null);
  };

  const handleGenerate = async () => {
    if (!aiTopic) return;
    setIsGenerating(true);
    setErrorMsg(null);
    try {
      const generatedContent = await generateAnnouncementText(aiTopic, buildingName, language);
      setContent(generatedContent.trim());
    } catch (error) {
      console.error('Failed to generate announcement', error);
      setContent(t('announcements.modal.generationError'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    if (title.trim() && content.trim()) {
      onSave({ title: title.trim(), content: content.trim() });
      showToast(
        tr(
          'Annonce officielle publiée auprès des copropriétaires.',
          'تم نشر الإعلان الرسمي لجميع الملاك المشتركين.'
        ),
        'success'
      );
      resetForm();
      onClose();
    } else {
      setErrorMsg(tr('Veuillez renseigner un titre et un contenu.', 'يرجى إدخال العنوان والمحتوى.'));
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
          <Button variant="secondary" onClick={handleClose}>
            {t('announcements.modal.cancel')}
          </Button>
          <Button onClick={handleSave} className="ms-3">
            {t('announcements.modal.post')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errorMsg && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
            {errorMsg}
          </div>
        )}
        <div>
          <label htmlFor="title" className="block text-xs font-bold text-slate-700 mb-1">
            {t('announcements.modal.announcementTitle')}
          </label>
          <input
            type="text"
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('announcements.modal.titlePlaceholder')}
            className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <div>
          <label htmlFor="ai-topic" className="block text-xs font-bold text-slate-700 mb-1">
            {t('announcements.modal.generateWithAi')}
          </label>
          <div className="flex rounded-lg shadow-2xs">
            <input
              type="text"
              id="ai-topic"
              placeholder={t('announcements.modal.aiPlaceholder')}
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              className="flex-1 min-w-0 block w-full px-3 py-2 rounded-s-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !aiTopic}
              className="inline-flex items-center px-3 rounded-e-lg border border-s-0 border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 text-sm !shadow-none !rounded-s-none"
            >
              {isGenerating ? t('announcements.modal.generating') : <SparklesIcon />}
            </Button>
          </div>
        </div>
        <div>
          <label htmlFor="content" className="block text-xs font-bold text-slate-700 mb-1">
            {t('announcements.modal.content')}
          </label>
          <textarea
            id="content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            className="block w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
      </div>
    </Modal>
  );
};

const Announcements: React.FC<{
  building: Building;
  announcements: Announcement[];
  onAddAnnouncement: (data: { title: string; content: string }) => void;
}> = ({ building, announcements, onAddAnnouncement }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { t, tr, isAr } = useI18n();

  const sortedAnnouncements = announcements;

  return (
    <div className="space-y-6">
      <AnnouncementModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        buildingName={building.name}
        onSave={onAddAnnouncement}
      />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span className="p-1.5 bg-teal-100 text-teal-800 rounded-lg">
              <AnnouncementsIcon />
            </span>
            <span>{t('announcements.title', { buildingName: building.name })}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {tr(
              "Notes d'information officielles affichées dans le portail des copropriétaires et locataires",
              'مذكرات إخبارية رسمية معروضة في بوابة الملاك المشتركين والمكترين'
            )}
          </p>
        </div>
        <Button icon={<PlusIcon />} onClick={() => setIsModalOpen(true)}>
          {t('announcements.add')}
        </Button>
      </div>

      <div className="space-y-4">
        {sortedAnnouncements.length > 0 ? (
          sortedAnnouncements.map((announcement) => (
            <Card key={announcement.id} className="border border-slate-200">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900">
                    {announcement.title}
                  </h2>
                  <p className="text-xs font-mono text-slate-500 mt-0.5">
                    {new Date(announcement.date).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <span className="px-2.5 py-0.5 rounded-md bg-teal-50 text-teal-800 border border-teal-200 text-[11px] font-bold">
                  {tr('Note Syndic', 'إشعار السنديك')}
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                {announcement.content}
              </p>
            </Card>
          ))
        ) : (
          <Card className="text-center py-12 border border-slate-200">
            <p className="text-sm font-semibold text-slate-700 mb-1">
              {t('announcements.noAnnouncements')}
            </p>
            <p className="text-xs text-slate-500 mb-4">
              {tr(
                'Publiez votre première note officielle pour informer les résidents des travaux ou coupures.',
                'انشر أول إشعار رسمي لإخبار السكان بالأشغال أو المستجدات.'
              )}
            </p>
            <Button icon={<PlusIcon />} onClick={() => setIsModalOpen(true)}>
              {t('announcements.add')}
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
};

export default Announcements;