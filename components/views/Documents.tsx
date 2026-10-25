import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Download, FileText } from 'lucide-react';
import type { Building, Document } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { PlusIcon, TrashIcon, DocumentsIcon } from '../icons/IconComponents';
import { useI18n } from '../../hooks/useI18n';
import { uploadDocument, deleteDocument } from '../../firebase/services';
import {
  generateArchiveDocumentPDFBlobUrl,
  downloadArchiveDocumentPDF,
} from '../../services/pdfOnDemand';
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

  const [resolvedPreviewUrl, setResolvedPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let generatedUrl: string | null = null;
    setResolvedPreviewUrl(null);
    setPreviewLoading(false);
    if (!previewDoc) return;
    if (previewDoc.url && /^(\/api\/uploads\/|data:|blob:|https?:)/.test(previewDoc.url)) {
      setResolvedPreviewUrl(previewDoc.url);
      return;
    }
    setPreviewLoading(true);
    void generateArchiveDocumentPDFBlobUrl(previewDoc, building).then(url => {
      if (cancelled) { if (url) URL.revokeObjectURL(url); return; }
      generatedUrl = url;
      setResolvedPreviewUrl(url);
      setPreviewLoading(false);
    });
    return () => { cancelled = true; if (generatedUrl) URL.revokeObjectURL(generatedUrl); };
  }, [previewDoc, building]);

  const isImagePreview = useMemo(() => {
    if (!previewDoc) return false;
    const lower = previewDoc.name.toLowerCase();
    return (
      lower.endsWith('.jpg') ||
      lower.endsWith('.jpeg') ||
      lower.endsWith('.png') ||
      lower.endsWith('.webp') ||
      Boolean(previewDoc.url?.startsWith('data:image/'))
    );
  }, [previewDoc]);

  const handleDownloadDoc = async (docItem: Document) => {
    if (
      docItem.url &&
      docItem.url !== '#' &&
      (docItem.url.startsWith('/api/uploads/') ||
        docItem.url.startsWith('data:') ||
        docItem.url.startsWith('blob:') ||
        docItem.url.startsWith('http'))
    ) {
      const link = document.createElement('a');
      link.href = docItem.url;
      link.download = docItem.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      if (!await downloadArchiveDocumentPDF(docItem, building)) return;
    }
    showToast(
      tr(
        `Téléchargement de « ${docItem.name} » lancé.`,
        `تم بدء تحميل « ${docItem.name} ».`
      ),
      'info'
    );
  };

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadDocument(building.id, file),
    onMutate: () => setIsUploading(true),
    onSuccess: (createdDoc) => {
      queryClient.invalidateQueries({ queryKey: ['syndics'] });
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showToast(
        tr(
          'Document déposé dans les archives de la copropriété.',
          'تم إيداع الوثيقة في أرشيف الإقامة.'
        ),
        'success'
      );
      setPreviewDoc(createdDoc);
    },
    onError: (error) => {
      console.error('Upload failed', error);
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      showToast(
        error instanceof Error ? error.message : tr('Erreur lors du téléversement du document.', 'حدث خطأ أثناء رفع الوثيقة.'),
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
      if (file.size > 5 * 1024 * 1024 || file.size === 0) {
        showToast(
          tr(
            'Le fichier dépasse la taille maximale autorisée (5 Mo).',
            'يتجاوز الملف الحجم الأقصى المسموح به (5 ميغابايت).'
          ),
          'warning'
        );
        e.target.value = '';
        return;
      }
      if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        showToast(tr('Formats acceptés : PDF, JPG, PNG ou WebP.', 'الصيغ المقبولة: PDF أو JPG أو PNG أو WebP.'), 'error');
        e.target.value = '';
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
            accept="application/pdf,image/jpeg,image/png,image/webp"
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
                      className="flex items-center gap-2 hover:underline text-start"
                    >
                      <FileText className="w-4 h-4 text-teal-600 shrink-0" />
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
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-xs transition-colors border border-teal-200"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{tr('Aperçu PDF', 'معاينة PDF')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDownloadDoc(docItem)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                        title={tr('Télécharger', 'تحميل')}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{tr('Télécharger', 'تحميل')}</span>
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
          maxWidthClass="sm:max-w-4xl"
          title={`${tr('Aperçu Documentaire', 'معاينة الوثيقة')} — ${previewDoc.name}`}
          footer={
            <div className="flex flex-wrap items-center justify-between w-full gap-2">
              <span className="text-xs text-slate-500 font-mono">
                {tr('Lecture directe sans téléchargement obligatoire', 'معاينة مباشرة في المتصفح دون الحاجة للتحميل')}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  onClick={() => handleDownloadDoc(previewDoc)}
                  icon={<Download className="w-4 h-4" />}
                >
                  {tr('Télécharger une copie', 'تحميل نسخة')}
                </Button>
                <Button onClick={() => setPreviewDoc(null)}>
                  {tr('Fermer', 'إغلاق')}
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4 text-teal-700 shrink-0" />
                  <span>{previewDoc.name}</span>
                </h4>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  {tr('Taille :', 'الحجم :')} {previewDoc.size} · {tr('Déposé le', 'أودع بتاريخ')}{' '}
                  {new Date(previewDoc.uploadedAt).toLocaleDateString(isAr ? 'ar-MA' : 'fr-MA')} ·{' '}
                  {building.name}
                </p>
              </div>
              <span className="px-2.5 py-1 rounded bg-teal-100 text-teal-800 font-mono font-bold text-[11px] self-start sm:self-center">
                {tr('Certifié Loi 18-00', 'معتمد قانون 18-00')}
              </span>
            </div>

            {previewLoading && <div role="status" className="h-[62vh] bg-slate-100 p-6">{tr('Préparation du document…', 'جاري إعداد المستند…')}</div>}
            {!previewLoading && !resolvedPreviewUrl && <p role="alert">{tr('Aperçu indisponible. Fermez puis réessayez.', 'المعاينة غير متاحة. أغلق ثم حاول مجدداً.')}</p>}
            {/* Embedded In-Browser PDF / Image Viewer */}
            {resolvedPreviewUrl && (
              <div className="rounded-xl overflow-hidden border border-slate-300 bg-slate-900 shadow-inner">
                {isImagePreview ? (
                  <div className="flex items-center justify-center p-4 max-h-[65vh] overflow-auto">
                    <img
                      src={resolvedPreviewUrl}
                      alt={previewDoc.name}
                      className="max-w-full max-h-[60vh] object-contain rounded"
                    />
                  </div>
                ) : (
                  <iframe
                    src={resolvedPreviewUrl}
                    title={previewDoc.name}
                    className="w-full h-[62vh] bg-white border-0"
                  />
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Documents;
