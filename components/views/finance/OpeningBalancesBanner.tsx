import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Building } from '../../../types';
import Button from '../../common/Button';
import InfoTip from '../../common/InfoTip';
import { remoteMutation } from '../../../firebase/services';
import { useAuth } from '../../../contexts/AuthContext';
import { useI18n } from '../../../hooks/useI18n';
import { useToast } from '../../common/Toast';

interface OpeningBalancesBannerProps {
  building: Building;
}

const OpeningBalancesBanner: React.FC<OpeningBalancesBannerProps> = ({ building }) => {
  const { tr } = useI18n();
  const { userProfile } = useAuth();
  const { showToast, confirmAction } = useToast();
  const queryClient = useQueryClient();
  const workingInputRef = useRef<HTMLInputElement>(null);

  const managed = ['admin', 'syndic'].includes(userProfile?.role || '');
  const openingRequired = managed && !(building.financials as any)?.openingBalancesRecordedAt;

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [working, setWorking] = useState('0');
  const [reserve, setReserve] = useState('0');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  if (!openingRequired) return null;

  const saveOpeningBalances = async (workingAmount: number, reserveAmount: number, reason: string) => {
    setBusy(true);
    try {
      await remoteMutation('setOpeningBalances', [
        building.id,
        {
          working: workingAmount,
          reserve: reserveAmount,
          reason,
        },
      ]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['syndics'] }),
        queryClient.invalidateQueries({ queryKey: ['charges', building.id] }),
        queryClient.invalidateQueries({ queryKey: ['quittances', building.id] }),
        queryClient.invalidateQueries({ queryKey: ['proofs', building.id] }),
        queryClient.invalidateQueries({ queryKey: ['financialReport', building.id] }),
      ]);
      showToast(
        tr(
          'Soldes de départ enregistrés. Vous pouvez maintenant encaisser les paiements.',
          'تم تسجيل الأرصدة الافتتاحية. يمكنك الآن تحصيل الدفعات.',
        ),
        'success',
      );
    } catch (err: any) {
      showToast(err?.message || tr('Impossible d’enregistrer les soldes.', 'تعذر حفظ الأرصدة.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      role="region"
      aria-label={tr("Solde de départ de l'immeuble", 'الرصيد الافتتاحي للعمارة')}
      className="rounded-2xl border border-amber-300 bg-gradient-to-r from-amber-50 via-amber-50/80 to-teal-50/40 p-4 sm:p-5 shadow-xs space-y-3"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-200/80 text-amber-950">
              {tr('1ère étape unique', 'خطوة أولى لمرة واحدة')}
            </span>
            <h2 className="text-sm sm:text-base font-bold text-slate-900">
              {tr("Solde de départ de l'immeuble", 'الرصيد الافتتاحي للعمارة')}
            </h2>
            <InfoTip label={tr('Pourquoi confirmer le solde de départ ?', 'لماذا نؤكد الرصيد الافتتاحي؟')}>
              {tr(
                'Cette étape fixe le point de départ officiel de votre trésorerie (banque + caisse) pour que tous vos futurs soldes soient exacts.',
                'تحدد هذه الخطوة نقطة الانطلاق الرسمية لخزينتك (البنك + الصندوق) لضمان دقة جميع الأرصدة اللاحقة.',
              )}
            </InfoTip>
          </div>
          <p className="text-xs sm:text-sm text-slate-700">
            {tr(
              "Combien d'argent la copropriété possède-t-elle déjà aujourd'hui avant vos premières saisies ?",
              'كم تملك الملكية المشتركة من أموال متاحة حالياً قبل بدء تسجيل العمليات؟',
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              const ok = await confirmAction({
                title: tr('Démarrer à 0 MAD', 'البدء برصيد 0 درهم'),
                message: tr(
                  "Confirmez-vous que le compte courant et le fonds de réserve démarrent tous les deux à 0,00 MAD ? (Cette étape ne se fait qu'une seule fois.)",
                  'هل تؤكد أن الحساب الجاري وصندوق الاحتياط يبدآن معاً برصيد 0.00 درهم؟ (تُنجز هذه الخطوة مرة واحدة فقط).',
                ),
                confirmLabel: tr('Confirmer 0 MAD', 'تأكيد 0 درهم'),
              });
              if (!ok) return;
              await saveOpeningBalances(
                0,
                0,
                tr('Démarrage à 0 MAD sur SyndicUnion', 'انطلاق برصيد 0 درهم على المنصة'),
              );
            }}
            className="bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold"
          >
            {tr('Nouvel immeuble : démarrer à 0 MAD', 'عمارة جديدة: البدء بـ 0 درهم')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setShowCustomForm((prev) => {
                const next = !prev;
                if (next) {
                  window.setTimeout(() => workingInputRef.current?.focus(), 40);
                }
                return next;
              });
            }}
            className="text-xs sm:text-sm bg-white"
          >
            {tr('Saisir des soldes existants', 'إدخال أرصدة موجودة')}
          </Button>
        </div>
      </div>

      {showCustomForm && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const w = Number(working);
            const r = Number(reserve);
            if (!Number.isFinite(w) || w < 0 || !Number.isFinite(r) || r < 0) {
              showToast(
                tr('Indiquez des montants positifs ou égaux à 0 MAD.', 'أدخل مبالغ موجبة أو مساوية لـ 0 درهم.'),
                'error',
              );
              return;
            }
            const autoReason =
              note.trim() ||
              tr(
                'Reprise des soldes existants au démarrage sur SyndicUnion',
                'اعتماد الأرصدة الموجودة عند بدء استخدام المنصة',
              );
            await saveOpeningBalances(w, r, autoReason);
          }}
          className="pt-3 border-t border-amber-200/80 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end"
        >
          <div>
            <label htmlFor="opening-working-balance" className="block text-xs font-semibold text-slate-800 mb-1">
              {tr('Argent disponible — Compte courant (MAD)', 'الرصيد المتاح — الحساب الجاري (درهم)')}
            </label>
            <input
              ref={workingInputRef}
              id="opening-working-balance"
              type="number"
              min="0"
              step="0.01"
              value={working}
              onChange={(e) => setWorking(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono bg-white"
              required
            />
          </div>

          <div>
            <label htmlFor="opening-reserve-balance" className="block text-xs font-semibold text-slate-800 mb-1">
              {tr('Épargne — Fonds de réserve (MAD)', 'المدخرات — صندوق الاحتياط (درهم)')}
            </label>
            <input
              id="opening-reserve-balance"
              type="number"
              min="0"
              step="0.01"
              value={reserve}
              onChange={(e) => setReserve(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono bg-white"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <div>
              <label htmlFor="opening-balance-note" className="block text-xs font-medium text-slate-600 mb-1">
                {tr('Note (optionnel)', 'ملاحظة (اختياري)')}
              </label>
              <input
                id="opening-balance-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={tr('Ex: Solde relevé bancaire au 01/01', 'مثال: رصيد الكشف البنكي')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs bg-white"
              />
            </div>
          </div>

          <div className="sm:col-span-3 flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setShowCustomForm(false)}
              className="text-xs"
            >
              {tr('Fermer', 'إغلاق')}
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold"
            >
              {busy
                ? tr('Enregistrement...', 'جاري الحفظ...')
                : tr('Enregistrer les soldes de départ', 'حفظ الأرصدة الافتتاحية')}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
};

export default OpeningBalancesBanner;
