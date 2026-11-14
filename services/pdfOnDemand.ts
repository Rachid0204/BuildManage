import { notifyOperation } from '../utils/formFeedback';
type Renderer = typeof import('./pdfService');
const failure = () => notifyOperation({ operation: 'pdf', error: 'Document indisponible. Réessayez le téléchargement. / تعذر تحميل المستند. حاول مجدداً.' });
function deferred<K extends keyof Renderer>(name: K) {
  return async (...args: Parameters<Renderer[K]>): Promise<boolean> => {
    try {
      const renderer = await import('./pdfService');
      await Promise.resolve((renderer[name] as (...args: any[]) => unknown)(...args));
      return true;
    } catch { failure(); return false; }
  };
}
export const downloadArchiveDocumentPDF = deferred('downloadArchiveDocumentPDF');
export const exportAnnualRepartitionPDF = deferred('exportAnnualRepartitionPDF');
export const exportApartmentsCSV = deferred('exportApartmentsCSV');
export const exportApartmentsPDF = deferred('exportApartmentsPDF');
export const exportBuildingSummaryReportPDF = deferred('exportBuildingSummaryReportPDF');
export const exportMiseEnDemeurePDF = deferred('exportMiseEnDemeurePDF');
export const exportPrestataireCredentialsPDF = deferred('exportPrestataireCredentialsPDF');
export const exportResidentCredentialsPDF = deferred('exportResidentCredentialsPDF');
export const exportResidentsCSV = deferred('exportResidentsCSV');
export const exportResidentsPDF = deferred('exportResidentsPDF');
export const generateInvoicePDF = deferred('generateInvoicePDF');
export const generateMiseEnDemeurePDF = deferred('generateMiseEnDemeurePDF');
export const generatePvAgPDF = deferred('generatePvAgPDF');
export const generateQuittancePDF = deferred('generateQuittancePDF');
export const generateTransactionVoucherPDF = deferred('generateTransactionVoucherPDF');
export async function generateArchiveDocumentPDFBlobUrl(...args: Parameters<Renderer['generateArchiveDocumentPDFBlobUrl']>): Promise<string | null> {
  try { return (await import('./pdfService')).generateArchiveDocumentPDFBlobUrl(...args); }
  catch { failure(); return null; }
}
