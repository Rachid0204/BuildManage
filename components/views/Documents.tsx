import React, { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Building, Document } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { PlusIcon, TrashIcon, DocumentsIcon } from '../icons/IconComponents';
import { useI18n } from '../../hooks/useI18n';
import { uploadDocument, deleteDocument } from '../../firebase/services';
import { useToast } from '../common/Toast';

const Documents: React.FC<{
  building: Building;
  documents: Document[];
  onAddDocument?: () => void;
  onDeleteDocument?: (docId: string) => void;
}> = ({ building, documents }) => {
  const { t, tr, isAr } = useI18n();
  const { showToast, confirmAction } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);

  const sortedDocuments = [...documents].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(building.id, file),
    onMutate: () => setIsUploading(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showToast(
        tr('Document déposé dans les archives de la copropriété.', 'تم إيداع الوثيقة في أرشيف الإقامة.'),
        'success'
      );
    },
    onError: (error) => {
      console.error('Upload failed', error);
      setIsUploading(false);
      showToast(
        tr('Erreur lors du téléversement du document.', 'حدث خطأ أثناء رفع الوثيقة.'),
        'error'
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      showToast(tr('Document supprimé.', 'تم حذف الوثيقة.'), 'info');
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 10 * 1024 * 1024) {
        showToast(
          tr('Le fichier dépasse la taille maximale autorisée (10 Mo).', 'يتجاوز الملف الحجم الأقصى المسموح به (10 ميغابايت).'),
          'warning'
        );
        return;
      }
      uploadMutation.mutate(file);
    }
  };

  const handleDelete = async (docItem: Document) => {
    const confirmed = await confirmAction({
      title: tr('Supprimer le document', 'حذف الوثيقة'),
      message: tr(
        `Voulez-vous vraiment supprimer le document « ${docItem.name} » des archives de la copropriété ?`,
        `هل تريدون فعلاً حذف الوثيقة « ${docItem.name} » من أرشيف الملكية المشتركة ؟`
      ),
      confirmLabel: tr('Supprimer', 'حذف'),
      cancelLabel: tr('Annuler', 'إلغاء'),
      variant: 'danger',
    });
    if (confirmed) {
      deleteMutation.mutate(docItem);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <span className="p-1.5 bg-teal-100 text-teal-800 rounded-lg">
              <DocumentsIcon />
            </span>
            <span>{t('documents.title', { buildingName: building.name })}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {tr(
              "Archives légales de la copropriété (Règlement de copropriété, PV d'AG, contrats et assurances — Loi 18-00)",
              'الأرشيف القانوني للملكية المشتركة (نظام الملكية المشتركة، محاضر الجموع العامة، العقود والتأمينات — قانون 18-00)'
            )}
          </p>
        </div>

        <div className="relative">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileChange}
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          />
          <Button
            icon={<PlusIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold"
          >
            {isUploading ? tr('Téléversement...', 'جاري الرفع...') : t('documents.add')}
          </Button>
        </div>
      </div>

      <Card className="border border-slate-200 overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-xs sm:text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-start text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('documents.table.name')}
                </th>
                <th className="px-6 py-3 text-start text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('documents.table.size')}
                </th>
                <th className="px-6 py-3 text-start text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {t('documents.table.uploadedAt')}
                </th>
                <th className="px-6 py-3 text-end text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {tr('Actions', 'إجراءات')}
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-slate-100">
              {sortedDocuments.map((docItem) => (
                <tr key={docItem.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap font-semibold text-teal-800">
                    <button
                      type="button"
                      onClick={() => setPreviewDoc(docItem)}
                      className="flex items-center hover:underline text-start"
                    >
                      <svg
                        className="w-4 h-4 me-2 text-teal-600 shrink-0"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" />
                      </svg>
                      <span>{docItem.name}</span>
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-slate-500">
                    {docItem.size}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-slate-500">
                    {new Date(docItem.uploadedAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-end font-medium">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(docItem)}
                        className="px-2.5 py-1 rounded bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs transition-colors"
                      >
                        {tr('Consulter', 'اطلاع')}
                      </button>
                      <Button
                        variant="danger"
                        className="!p-1.5"
                        onClick={() => handleDelete(docItem)}
                        aria-label={tr('Supprimer', 'حذف')}
                        title={tr('Supprimer', 'حذف')}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {documents.length === 0 && (
          <div className="text-center py-10 px-4">
            <p className="text-sm font-semibold text-slate-700 mb-1">
              {t('documents.noDocuments')}
            </p>
            <p className="text-xs text-slate-500">
              {tr(
                "Déposez le règlement de copropriété, les procès-verbaux d'AG ou les contrats d'assurance.",
                'أودعوا نظام الملكية المشتركة أو محاضر الجموع العامة أو عقود التأمين.'
              )}
            </p>
          </div>
        )}
      </Card>

      {previewDoc && (
        <Modal
          isOpen={!!previewDoc}
          onClose={() => setPreviewDoc(null)}
          title={`${tr('Archive Documentaire', 'الأرشيف الوثائقي')} — ${previewDoc.name}`}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreviewDoc(null)}>
                {tr('Fermer', 'إغلاق')}
              </Button>
            </div>
          }
        >
          <div className="p-5 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs text-slate-700">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h4 className="font-bold text-slate-900 text-sm">{previewDoc.name}</h4>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  {tr('Taille :', 'الحجم :')} {previewDoc.size} · {tr('Déposé le', 'أودع بتاريخ')}{' '}
                  {new Date(previewDoc.uploadedAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded bg-teal-100 text-teal-800 font-mono font-bold text-[11px]">
                {tr('Certifié Loi 18-00', 'معتمد قانون 18-00')}
              </span>
            </div>
            <p className="leading-relaxed">
              {tr(
                `Ce document officiel de la résidence ${building.name} (${building.address}, ${building.city}) est partagé automatiquement dans l'espace numérique de tous les copropriétaires.`,
                `هذه الوثيقة الرسمية الخاصة بإقامة ${building.name} (${building.address}، ${building.city}) متاحة تلقائياً في الفضاء الرقمي لجميع الملاك المشتركين.`
              )}
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Documents;
