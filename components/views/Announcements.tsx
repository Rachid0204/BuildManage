import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { PlusIcon, SparklesIcon } from '../icons/IconComponents';
import { generateAnnouncementContent } from '../../services/geminiService';
import { addAnnouncement } from '../../firebase/services';
import { useI18n } from '../../hooks/useI18n';

interface AnnouncementsProps {
  building: Building;
  announcements?: Building['announcements'];
  onAddAnnouncement?: (data: { title: string; content: string }) => void;
}

const Announcements: React.FC<AnnouncementsProps> = ({ building }) => {
  const { t, tr, language } = useI18n();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [aiTopic, setAiTopic] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const addMutation = useMutation({
    mutationFn: (data: { title: string; content: string }) =>
      addAnnouncement(building.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setNewTitle('');
      setNewContent('');
      setAiTopic('');
      setAiError(null);
      setSaveError(null);
      setIsModalOpen(false);
    },
    onError: (err: any) => {
      setSaveError(
        err?.message ||
          tr(
            "Échec de la publication de l'annonce. Vos modifications ont été conservées.",
            'فشل نشر الإعلان. تم الاحتفاظ بمسودتك.'
          )
      );
    },
  });

  const handleGenerateContent = async () => {
    if (!aiTopic.trim()) return;
    setIsGenerating(true);
    setAiError(null);
    try {
      const content = await generateAnnouncementContent(aiTopic);
      setNewContent(content);
      if (!newTitle.trim()) {
        setNewTitle(aiTopic.charAt(0).toUpperCase() + aiTopic.slice(1));
      }
    } catch (error: any) {
      // Audit Item 27: Never insert error messages into the announcement draft body
      setAiError(
        error?.message ||
          tr(
            "Le service d'IA est indisponible. Veuillez rédiger le contenu manuellement.",
            'خدمة الذكاء الاصطناعي غير متوفرة حالياً. يرجى كتابة المحتوى يدوياً.'
          )
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAddAnnouncement = () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setSaveError(null);
    addMutation.mutate({ title: newTitle.trim(), content: newContent.trim() });
  };

  const dateLocale = language === 'ar' ? 'ar-MA' : 'fr-FR';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <h2 className="text-2xl font-bold text-slate-800">{t('announcements.title')}</h2>
        <Button onClick={() => setIsModalOpen(true)} icon={<PlusIcon />}>
          {t('announcements.newAnnouncement')}
        </Button>
      </div>

      <div className="space-y-4">
        {building.announcements && building.announcements.length > 0 ? (
          building.announcements.map((ann) => (
            <Card key={ann.id} className="p-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-1">
                <h3 className="text-lg font-bold text-slate-900">{ann.title}</h3>
                <p className="text-xs text-slate-400">
                  {new Date(ann.date).toLocaleDateString(dateLocale, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <p className="mt-2 text-slate-600 whitespace-pre-wrap">{ann.content}</p>
            </Card>
          ))
        ) : (
          <Card className="p-8 text-center text-slate-500 text-sm">
            {tr(
              'Aucune annonce publiée pour cette résidence.',
              'لا توجد أي إعلانات منشورة لهذه الإقامة.'
            )}
          </Card>
        )}
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setAiError(null);
          setSaveError(null);
        }}
        title={t('announcements.createModalTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleAddAnnouncement}
              disabled={addMutation.isPending || !newTitle.trim() || !newContent.trim()}
            >
              {addMutation.isPending
                ? t('announcements.publishing')
                : t('announcements.publish')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {saveError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {saveError}
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-slate-700">
              {t('announcements.announcementTitle')}
            </label>
            <input
              type="text"
              id="title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-xs focus:outline-hidden focus:ring-primary focus:border-primary sm:text-sm"
              placeholder={t('announcements.titlePlaceholder')}
            />
          </div>

          <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
            <label htmlFor="ai-topic" className="block text-sm font-medium text-slate-700">
              {t('announcements.generateWithAi')}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                id="ai-topic"
                value={aiTopic}
                onChange={(e) => {
                  setAiTopic(e.target.value);
                  if (aiError) setAiError(null);
                }}
                className="grow block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-xs focus:outline-hidden focus:ring-primary focus:border-primary sm:text-sm"
                placeholder={t('announcements.aiTopicPlaceholder')}
              />
              <Button
                onClick={handleGenerateContent}
                disabled={isGenerating || !aiTopic.trim()}
                icon={<SparklesIcon />}
              >
                {isGenerating ? t('announcements.generating') : t('announcements.generate')}
              </Button>
            </div>
            {aiError && (
              <p className="text-xs text-rose-600 font-medium mt-1" role="alert">
                {aiError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="content" className="block text-sm font-medium text-slate-700">
              {t('announcements.contentLabel')}
            </label>
            <textarea
              id="content"
              rows={8}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-xs focus:outline-hidden focus:ring-primary focus:border-primary sm:text-sm"
              placeholder={t('announcements.contentPlaceholder')}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Announcements;