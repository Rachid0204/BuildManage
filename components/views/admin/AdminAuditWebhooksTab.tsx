import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Card from '../../common/Card';
import { useI18n } from '../../../hooks/useI18n';
import {
  getAdminAuditLogs,
  getAdminGatewayEvents,
} from '../../../firebase/services';

const AdminAuditWebhooksTab: React.FC = () => {
  const { tr, language } = useI18n();

  const [gatewayFilter, setGatewayFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [auditSearch, setAuditSearch] = useState('');
  const [auditOperation, setAuditOperation] = useState('');

  const {
    data: gatewayData,
    isFetching: fetchingEvents,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: ['adminGatewayEvents', gatewayFilter, statusFilter],
    queryFn: () =>
      getAdminGatewayEvents({
        limit: 100,
        ...(gatewayFilter ? { gateway: gatewayFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      }),
    staleTime: 5_000,
  });

  const {
    data: auditData,
    isFetching: fetchingAudit,
    refetch: refetchAudit,
  } = useQuery({
    queryKey: ['adminAuditLogs', auditOperation, auditSearch],
    queryFn: () =>
      getAdminAuditLogs({
        limit: 100,
        ...(auditOperation ? { operation: auditOperation } : {}),
        ...(auditSearch.trim() ? { q: auditSearch.trim() } : {}),
      }),
    staleTime: 5_000,
  });

  const events = gatewayData?.events || [];
  const logs = auditData?.logs || [];

  const statusBadge = (status: string) => {
    if (status === 'ok') return 'bg-emerald-100 text-emerald-800';
    if (status === 'rejected' || status === 'error')
      return 'bg-rose-100 text-rose-800';
    return 'bg-slate-200 text-slate-700';
  };

  const gatewayBadge = (gw: string) => {
    if (gw === 'cmi') return 'bg-teal-100 text-teal-800';
    if (gw === 'paypal') return 'bg-sky-100 text-sky-800';
    if (gw === 'cash') return 'bg-amber-100 text-amber-900';
    if (gw === 'bank_transfer') return 'bg-emerald-100 text-emerald-800';
    return 'bg-slate-100 text-slate-700';
  };

  return (
    <div className="space-y-6 text-xs">
      {/* Gateway Webhooks & Callbacks Monitor */}
      <Card className="p-5 border border-slate-200 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {tr(
                'Moniteur Webhooks & Callbacks Passerelles',
                'مراقبة إشعارات وبوابات الدفع (Webhooks & Callbacks)',
              )}{' '}
              ({events.length}/{gatewayData?.total ?? 0})
            </h2>
            <p className="text-slate-500">
              {tr(
                'Trace temps réel des callbacks CMI (POSTAUTH/FAILURE), webhooks PayPal, signatures rejetées et flux Espèces/Virement.',
                'تتبع فوري لإشعارات CMI وPayPal والتحقق من التوقيعات وعمليات النقد والتحويل.',
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={gatewayFilter}
              onChange={(e) => setGatewayFilter(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
            >
              <option value="">{tr('Toutes passerelles', 'كل البوابات')}</option>
              <option value="cmi">CMI Maroc</option>
              <option value="paypal">PayPal</option>
              <option value="bank_transfer">{tr('Virement', 'تحويل بنكي')}</option>
              <option value="cash">{tr('Espèces / Agences', 'نقداً / وكالات')}</option>
              <option value="system">{tr('Système', 'النظام')}</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
            >
              <option value="">{tr('Tous statuts', 'كل الحالات')}</option>
              <option value="ok">OK</option>
              <option value="rejected">{tr('Rejeté', 'مرفوض')}</option>
              <option value="ignored">{tr('Ignoré', 'متجاهل')}</option>
              <option value="error">{tr('Erreur', 'خطأ')}</option>
            </select>
            <button
              type="button"
              onClick={() => void refetchEvents()}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700"
            >
              {fetchingEvents ? '⟳' : '↻'} {tr('Actualiser', 'تحديث')}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Date', 'التاريخ')}
                </th>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Passerelle', 'البوابة')}
                </th>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Événement', 'الحدث')}
                </th>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Statut', 'الحالة')}
                </th>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Réf. / Commande', 'المرجع')}
                </th>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Détail', 'التفاصيل')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-500">
                    {new Date(ev.createdAt).toLocaleString(
                      language === 'ar' ? 'ar-MA' : 'fr-MA',
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${gatewayBadge(ev.gateway)}`}
                    >
                      {ev.gateway}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono font-semibold text-slate-800">
                    {ev.eventType}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full font-bold uppercase text-[10px] ${statusBadge(ev.status)}`}
                    >
                      {ev.status} ({ev.httpStatus})
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-600">
                    {ev.orderId || ev.reference || '—'}
                  </td>
                  <td className="px-3 py-2 text-slate-700 max-w-md">
                    {ev.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && (
            <div className="py-8 text-center text-slate-500">
              {tr(
                'Aucun événement passerelle enregistré pour ces filtres.',
                'لا توجد أحداث مسجلة لهذه المعايير.',
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Admin Audit Trail */}
      <Card className="p-5 border border-slate-200 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {tr('Journal d’Audit Plateforme', 'سجل تدقيق عمليات المنصة')} (
              {logs.length}/{auditData?.total ?? 0})
            </h2>
            <p className="text-slate-500">
              {tr(
                'Historique immuable des modifications de passerelles, encaissements, annulations, promos et rappels.',
                'سجل غير قابل للتعديل لجميع إعدادات البوابات والمدفوعات والإلغاءات والرموز.',
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={auditOperation}
              onChange={(e) => setAuditOperation(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-slate-300 bg-white font-semibold"
            >
              <option value="">{tr('Toutes opérations', 'كل العمليات')}</option>
              <option value="updatePlatformBillingConfig">updatePlatformBillingConfig</option>
              <option value="cmiWebhookSubscription">cmiWebhookSubscription</option>
              <option value="paypalCaptureSubscription">paypalCaptureSubscription</option>
              <option value="paypalWebhookSubscription">paypalWebhookSubscription</option>
              <option value="paypalWebhookRefundSubscription">paypalWebhookRefundSubscription</option>
              <option value="recordSubscriptionPayment">recordSubscriptionPayment</option>
              <option value="reviewSubscriptionBankTransfer">reviewSubscriptionBankTransfer</option>
              <option value="voidSubscriptionPayment">voidSubscriptionPayment</option>
              <option value="adminCreatePromoCode">adminCreatePromoCode</option>
              <option value="adminSendRenewalReminder">adminSendRenewalReminder</option>
              <option value="adminCreateCabinet">adminCreateCabinet</option>
            </select>
            <input
              type="search"
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder={tr('Rechercher UID, cabinet, réf...', 'بحث...')}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white w-52"
            />
            <button
              type="button"
              onClick={() => void refetchAudit()}
              className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-bold text-slate-700"
            >
              {fetchingAudit ? '⟳' : '↻'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Date', 'التاريخ')}
                </th>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Opération', 'العملية')}
                </th>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Acteur', 'الفاعل')}
                </th>
                <th className="px-3 py-2 text-start font-bold text-slate-500 uppercase">
                  {tr('Métadonnées', 'التفاصيل')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {logs.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-500">
                    {new Date(entry.createdAt).toLocaleString(
                      language === 'ar' ? 'ar-MA' : 'fr-MA',
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono font-bold text-slate-900">
                    {entry.operation}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[11px] text-slate-600">
                    {entry.actorUid || 'system'} ({entry.actorRole || '—'})
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600 max-w-lg truncate">
                    {entry.detail ? JSON.stringify(entry.detail) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && (
            <div className="py-8 text-center text-slate-500">
              {tr('Aucune entrée d’audit trouvée.', 'لا توجد سجلات تدقيق.')}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
};

export default AdminAuditWebhooksTab;
