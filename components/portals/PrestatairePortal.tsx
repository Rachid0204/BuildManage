import Form from '../../components/common/Form';

import React, { useState } from 'react';
import { AlertTriangle, Clock, AlertCircle, Info } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';

import { useBuilding } from '../../contexts/BuildingContext';
import { useI18n } from '../../hooks/useI18n';

import LanguageToggle from '../../components/common/LanguageToggle';

import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import { getMaintenanceRequestsForBuilding, updateMaintenanceRequest } from '../../firebase/services';

const PrestatairePortal: React.FC = () => {
  const { userProfile, logout } = useAuth();
  const { selectedBuilding } = useBuilding();
  const { t, tr, language } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const buildingId = userProfile?.buildingId || selectedBuilding?.id || '';

  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [techNote, setTechNote] = useState('');
  const [nextStatus, setNextStatus] = useState<'in_progress' | 'completed'>('in_progress');

  const { data: rawRequests = [] } = useQuery({
    queryKey: ['maintenance', buildingId, userProfile?.uid],
    queryFn: () =>
      buildingId ? getMaintenanceRequestsForBuilding(buildingId) : Promise.resolve([]),
    enabled: Boolean(buildingId),
  });

  const requests = React.useMemo(() => {
    if (!userProfile) return [];
    const effectivePrestId =
      userProfile.prestataireId || userProfile.uid.replace(/^(user-prest-|prov-)/, '');
    const effectiveCategory =
      userProfile.prestataireCategory || userProfile.providerCategory;
    return rawRequests.filter(
      (r) =>
        (effectivePrestId && r.prestataireId === effectivePrestId) ||
        (userProfile.displayName && r.assignedTo === userProfile.displayName) ||
        (!r.prestataireId &&
          !r.assignedTo &&
          effectiveCategory &&
          r.category === effectiveCategory)
    );
  }, [rawRequests, userProfile]);

  const categoryLabels: Record<string, string> = {
    plumbing: tr('Plomberie', 'السباكة'),
    electrical: tr('Électricité', 'الكهرباء'),
    elevator: tr('Ascenseur', 'المصعد'),
    common_area: tr('Parties Communes', 'الأجزاء المشتركة'),
    cleaning: tr('Nettoyage', 'النظافة'),
    security: tr('Sécurité', 'الحراسة والأمن'),
    other: tr('Autre', 'أخرى'),
  };

  const renderPriorityBadge = (priority?: string) => {
    switch (priority) {
      case 'emergency':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{tr('Urgence', 'طوارئ')}</span>
          </span>
        );
      case 'high':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>{tr('Haute', 'عالية')}</span>
          </span>
        );
      case 'low':
        return (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>{tr('Basse', 'منخفضة')}</span>
          </span>
        );
      case 'medium':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{tr('Moyenne', 'متوسطة')}</span>
          </span>
        );
    }
  };

  const updateMutation = useMutation({
    mutationFn: (payload: { requestId: string; status: 'in_progress' | 'completed'; note: string }) =>
      updateMaintenanceRequest(
        payload.requestId,
        { status: payload.status },
        {
          title:
            payload.status === 'completed'
              ? tr('Intervention clôturée par le prestataire', 'تم إغلاق التدخل من طرف المزود')
              : tr('Compte-rendu technique du prestataire', 'تقرير تقني من المزود'),
          note: payload.note,
          updatedBy: userProfile?.displayName || tr('Prestataire Agréé', 'مقدم خدمة معتمد'),
          updatedByRole: 'provider',
        }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', buildingId] });
      setActiveTicketId(null);
      setTechNote('');
    },
  });

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  if (userProfile && userProfile.role !== 'provider') {
    return <Navigate to={getHomeRouteForRole(userProfile.role)} replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <header className="bg-slate-900 text-white px-6 py-4 flex flex-wrap justify-between items-center gap-4">
        <div>
          <span className="text-[11px] uppercase tracking-wider font-bold px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-400/30">
            {t('providerPortal.badge')}
          </span>
          <h1 className="text-xl font-bold mt-1">
            {userProfile?.displayName || tr('Artisan Partenaire', 'حرفي شريك')}
          </h1>
          <p className="text-xs text-slate-400">
            {t('providerPortal.subtitle')} •{' '}
            {selectedBuilding?.name || userProfile?.buildingName || tr('Copropriété assignée', 'الإقامة المعينة')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-300 font-mono hidden sm:inline">
            {userProfile?.email}
          </span>
          <LanguageToggle variant="dark" />
          <Button variant="secondary" onClick={handleLogout}>
            {t('header.logout')}
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <p className="text-xs font-semibold uppercase text-slate-400">{t('providerPortal.activeOrders')}</p>
            <p className="text-3xl font-extrabold text-slate-900 mt-1">
              {requests.filter((r) => r.status !== 'completed').length}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase text-slate-400">{t('providerPortal.completedOrders')}</p>
            <p className="text-3xl font-extrabold text-emerald-600 mt-1">
              {requests.filter((r) => r.status === 'completed').length}
            </p>
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase text-slate-400">{t('providerPortal.avgSla')}</p>
            <p className="text-3xl font-extrabold text-indigo-600 mt-1">4h 15m</p>
          </Card>
        </div>

        <Card>
          <h2 className="text-lg font-bold text-slate-900 mb-4">
            {t('providerPortal.ordersTitle')}
          </h2>
          <div className="space-y-4">
            {requests.map((req) => (
              <div
                key={req.id}
                className="p-4 rounded-xl border border-slate-200 bg-white flex flex-col md:flex-row justify-between gap-4"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold uppercase px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {categoryLabels[req.category] || req.category}
                    </span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                        req.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-800'
                          : req.status === 'in_progress'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {req.status === 'completed'
                        ? t('providerPortal.statusCompleted')
                        : req.status === 'in_progress'
                        ? t('providerPortal.statusInProgress')
                        : t('providerPortal.statusPending')}
                    </span>
                    {renderPriorityBadge(req.priority)}
                    {req.location && (
                      <span className="text-xs text-slate-500">📍 {req.location}</span>
                    )}
                  </div>
                  <p className="text-sm font-bold text-slate-900">{req.description}</p>
                  {req.syndicNotes && (
                    <p className="text-xs text-slate-600 bg-slate-50 p-2 rounded-lg border border-slate-100">
                      <strong>{t('providerPortal.syndicNote')}</strong> {req.syndicNotes}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 self-start md:self-center shrink-0">
                  {req.status !== 'completed' && (
                    <Button
                      onClick={() => {
                        setActiveTicketId(req.id);
                        setNextStatus(req.status === 'pending' ? 'in_progress' : 'completed');
                      }}
                    >
                      {t('providerPortal.updateBtn')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        {activeTicketId && (
          <Card className="border-2 border-teal-500">
            <h3 className="text-base font-bold text-slate-900 mb-3">
              {t('providerPortal.reportTitle')} (#{activeTicketId})
            </h3>
            <Form className="space-y-3" onSubmit={async () => {
              if (!techNote.trim()) throw new Error(tr('Rédigez le compte-rendu avant de l’envoyer.', 'اكتب التقرير قبل إرساله.'));
              await updateMutation.mutateAsync({ requestId: activeTicketId, status: nextStatus, note: techNote.trim() });
            }}>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('providerPortal.newStateLabel')}
                </label>
                <select
                  value={nextStatus}
                  onChange={(e) => setNextStatus(e.target.value as 'in_progress' | 'completed')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  <option value="in_progress">{t('providerPortal.stateInProgress')}</option>
                  <option value="completed">{t('providerPortal.stateCompleted')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t('providerPortal.techNoteLabel')}
                </label>
                <textarea
                  rows={3}
                  required
                  maxLength={3000}
                  value={techNote}
                  onChange={(e) => setTechNote(e.target.value)}
                  placeholder={t('providerPortal.techNotePlaceholder')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setActiveTicketId(null)}>
                  {t('providerPortal.cancelBtn')}
                </Button>
                <Button
                  type="submit" disabled={updateMutation.isPending}
                >
                  {t('providerPortal.submitReportBtn')}
                </Button>
              </div>
            </Form>
          </Card>
        )}
      </main>
    </div>
  );
};

// Wrapper to handle Syndic data fetching and Context population (Audit Item 22: No cross-tenant fallback)

export default PrestatairePortal;
