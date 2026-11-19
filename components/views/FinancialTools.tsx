import type { CommandName, CommandArgs } from '../../shared/api/commands';
import React, { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { remoteMutation } from "../../firebase/services";
import { getAuthenticatedRequestHeaders } from "../../utils/security";
import { useI18n } from "../../hooks/useI18n";
import { useAuth } from "../../contexts/AuthContext";
import type { Building } from "../../types";
import { useToast } from "../common/Toast";
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csv = (rows: any[]) => {
  const keys = [...new Set(rows.flatMap(Object.keys))],
    cell = (v: any) =>
      '"' +
      String(v ?? "")
        .replace(/^(?=[\s\t\r]*[=+\-@]|[\t\r])/, "'")
        .replaceAll('"', '""') +
      '"';
  return (
    "\uFEFF" +
    [
      keys,
      ...rows.map((row) =>
        keys.map((k) =>
          typeof row[k] === "object" ? JSON.stringify(row[k]) : row[k],
        ),
      ),
    ]
      .map((row) => row.map(cell).join(";"))
      .join("\r\n")
  );
};
export default function FinancialTools({ building }: { building: Building }) {
  const queryClient = useQueryClient();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const openingRef = useRef<HTMLFieldSetElement>(null);
  const { showToast, confirmAction } = useToast();
  const { tr } = useI18n(),
    { userProfile } = useAuth(),
    managed = ["admin", "syndic"].includes(userProfile?.role || ""),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [working, setWorking] = useState("0"),
    [reserve, setReserve] = useState("0"),
    [openingReason, setOpeningReason] = useState(""),
    [periodReason, setPeriodReason] = useState(""),
    [reversalReason, setReversalReason] = useState(""),
    [arrearsDescription, setArrearsDescription] = useState(""),
    [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [arrearsPeriod, setArrearsPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [payment, setPayment] = useState(""),
    [lot, setLot] = useState(""),
    [arrears, setArrears] = useState("");
  const openingRequired = managed && !(building.financials as any)?.openingBalancesRecordedAt;
  useEffect(() => {
    if (openingRequired && detailsRef.current) detailsRef.current.open = true;
  }, [openingRequired]);
  const { data: report, refetch: refetchReport } = useQuery({
    queryKey: ['financialReport', building.id],
    queryFn: async ({ signal }): Promise<any> => {
      const response = await fetch(`/api/reports?buildingId=${encodeURIComponent(building.id)}`, {
        headers: getAuthenticatedRequestHeaders(), signal, cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data;
    },
  });
  const load = async () => {
    return (await refetchReport({ throwOnError: true })).data;
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setStatus("");
    try {
      await action();
      await load();
      setStatus(tr("Opération enregistrée.", "تم تسجيل العملية."));
      showToast(tr("Opération terminée. Les relevés sont actualisés.", "اكتملت العملية وتم تحديث الكشوف."), 'success');
    } catch (e: any) {
      setStatus(e.message);
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const op = async <K extends CommandName,>(operation: K, args: CommandArgs<K>) => {
    const result = await remoteMutation(operation, args);
    await queryClient.invalidateQueries({ queryKey: ['syndics'] });
    await queryClient.invalidateQueries({ queryKey: ['charges', building.id] });
    await queryClient.invalidateQueries({ queryKey: ['quittances', building.id] });
    await queryClient.invalidateQueries({ queryKey: ['proofs', building.id] });
    return result;
  };
  const button =
    "border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50";
  const closedPeriodsEntries = Object.entries(report?.closedPeriods || {});
  return (
    <section className="space-y-3">
      {openingRequired && <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-2" role="note">
        <p className="font-semibold text-amber-950">{tr('Avant le premier encaissement : confirmez les soldes initiaux', 'قبل أول تحصيل: أكد الأرصدة الافتتاحية')}</p>
        <p className="text-sm text-amber-900">{tr('Indiquez les fonds courant et de réserve détenus au démarrage. Si les deux étaient nuls, confirmez 0 MAD. Cette étape est requise une seule fois pour valider les paiements.', 'أدخل رصيد الصندوق الجاري والاحتياطي عند بدء المحاسبة. إذا كانا صفراً، أكد 0 درهم. هذه الخطوة مطلوبة مرة واحدة للمصادقة على الأداءات.')}</p>
        <button className={button} onClick={() => {
          if (detailsRef.current) detailsRef.current.open = true;
          openingRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          openingRef.current?.querySelector('input')?.focus({ preventScroll: true });
        }}>{tr('Configurer les soldes initiaux', 'إعداد الأرصدة الافتتاحية')}</button>
      </div>}
    <details ref={detailsRef} className="bg-white border rounded-xl p-4">
      <summary className="font-bold cursor-pointer">
        {tr("Relevés, corrections et clôture", "الكشوف والتصحيحات والإقفال")}
      </summary>
      <div className="space-y-4 mt-4">
        <div className="flex flex-wrap gap-2">
          <button
            className={button}
            disabled={busy}
            onClick={() => void run(load)}
          >
            {tr("Actualiser les relevés", "تحديث الكشوف")}
          </button>
          <button
            className={button}
            onClick={() =>
              void run(async () =>
                download(
                  "releves.csv",
                  csv((await load()).statements),
                  "text/csv;charset=utf-8",
                ),
              )
            }
          >
            {tr("Exporter les relevés CSV", "تصدير الكشوف CSV")}
          </button>
          {managed && (
            <>
              <button
                className={button}
                onClick={() =>
                  void run(async () =>
                    download(
                      "journal.csv",
                      csv((await load()).ledger),
                      "text/csv;charset=utf-8",
                    ),
                  )
                }
              >
                {tr("Exporter le journal CSV", "تصدير دفتر العمليات CSV")}
              </button>
              <button
                className={button}
                onClick={() =>
                  void run(async () =>
                    download(
                      "export-immeuble.json",
                      JSON.stringify(await load(), null, 2),
                    ),
                  )
                }
              >
                {tr("Exporter les données", "تصدير البيانات")}
              </button>
            </>
          )}
        </div>
        {report && (
          <div className="overflow-auto">
            <table className="w-full text-sm" aria-label={tr('Relevés des résidents', 'كشوف السكان')}>
              <thead>
                <tr>
                  <th className="text-start">{tr("Résident", "الساكن")}</th>
                  <th className="text-end">{tr("Facturé", "المفوتر")}</th>
                  <th className="text-end">{tr("Réglé", "المدفوع")}</th>
                  <th className="text-end">{tr("Arriérés initiaux (facturé / dû)", "المتأخرات الافتتاحية (مفوتر / مستحق)")}</th>
                  <th className="text-end">{tr("Solde dû", "الرصيد المستحق")}</th>
                  <th className="text-end">{tr("Plus de 90 jours", "أكثر من 90 يوماً")}</th>
                </tr>
              </thead>
              <tbody>
                {report.statements.map((s: any) => {
                  const arrearsBilled = s.openingArrearsBilled ?? s.openingArrears ?? 0;
                  const arrearsDue = s.openingArrearsOutstanding ?? s.openingArrears ?? 0;
                  return (
                    <tr key={s.residentId}>
                      <td>{s.name}</td>
                      <td className="text-end">{s.billed} MAD</td>
                      <td className="text-end">{s.paid} MAD</td>
                      <td className="text-end font-mono text-xs">{arrearsBilled} / {arrearsDue} MAD</td>
                      <td className="text-end font-semibold">{s.outstanding} MAD</td>
                      <td className="text-end">{s.over90Days} MAD</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {managed && (
          <>
            {openingRequired && (
              <fieldset ref={openingRef} className="border rounded p-3 flex flex-wrap items-end gap-3">
                <legend>
                  {tr(
                    "Confirmer les soldes initiaux (y compris zéro)",
                    "تأكيد الأرصدة الافتتاحية بما فيها الصفر",
                  )}
                </legend>
                <label>
                  {tr("Fonds courant MAD", "الصندوق الجاري MAD")}
                  <input
                    className="border rounded p-2 block"
                    type="number"
                    step="0.01"
                    value={working}
                    onChange={(e) => setWorking(e.target.value)}
                  />
                </label>
                <label>
                  {tr("Réserve MAD", "الاحتياطي MAD")}
                  <input
                    className="border rounded p-2 block"
                    type="number"
                    step="0.01"
                    value={reserve}
                    onChange={(e) => setReserve(e.target.value)}
                  />
                </label>
                <label className="w-full">
                  {tr('Motif de confirmation des soldes', 'سبب تأكيد الأرصدة')}
                  <input className="border rounded p-2 block w-full" value={openingReason} onChange={e => setOpeningReason(e.target.value)} />
                </label>
                <button
                  className={button}
                  disabled={busy || !openingReason.trim() || !working.trim() || !reserve.trim() || !Number.isFinite(Number(working)) || !Number.isFinite(Number(reserve))}
                  onClick={() =>
                    void run(() =>
                      op("setOpeningBalances", [
                        building.id,
                        {
                          working: Number(working),
                          reserve: Number(reserve),
                          reason: openingReason.trim(),
                        },
                      ]),
                    )
                  }
                >
                  {tr("Confirmer une fois", "تأكيد مرة واحدة")}
                </button>
              </fieldset>
            )}
            <fieldset className="border rounded p-3 space-y-3">
              <legend className="text-xs font-semibold px-1">
                {tr("Clôture / Réouverture de période comptable", "إقفال / إعادة فتح الفترة المحاسبية")}
              </legend>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs">
                  {tr("Période", "الفترة")}
                  <input
                    className="border rounded p-2 block text-sm"
                    type="month"
                    value={period}
                    onChange={(e) => setPeriod(e.target.value)}
                  />
                </label>
                <label className="flex-1 min-w-[200px] text-xs">
                  {tr("Motif de clôture / réouverture", "سبب الإقفال / إعادة الفتح")}
                  <input
                    className="border rounded p-2 block w-full text-sm"
                    value={periodReason}
                    onChange={(e) => setPeriodReason(e.target.value)}
                  />
                </label>
                <button
                  className={button}
                  disabled={busy || !periodReason.trim()}
                  onClick={async () => {
                    const ok = await confirmAction({
                      title: tr("Clôturer la période", "إقفال الفترة"),
                      message: tr(
                        `Confirmer la clôture comptable de ${period} ? Motif : ${periodReason.trim()}`,
                        `تأكيد الإقفال المحاسبي للفترة ${period}؟ السبب: ${periodReason.trim()}`
                      ),
                      confirmLabel: tr("Clôturer", "إقفال"),
                    });
                    if (!ok) return;
                    await run(async () => {
                      await op("closeFinancialPeriod", [building.id, period, periodReason.trim()]);
                      setPeriodReason("");
                    });
                  }}
                >
                  {tr("Clôturer", "إقفال")}
                </button>
                {userProfile?.role === "admin" && (
                  <button
                    className={button}
                    disabled={busy || !periodReason.trim()}
                    onClick={async () => {
                      const ok = await confirmAction({
                        title: tr("Réouvrir la période", "إعادة فتح الفترة"),
                        message: tr(
                          `Confirmer la réouverture de ${period} ? Motif : ${periodReason.trim()}`,
                          `تأكيد إعادة فتح الفترة ${period}؟ السبب: ${periodReason.trim()}`
                        ),
                        confirmLabel: tr("Réouvrir", "إعادة فتح"),
                      });
                      if (!ok) return;
                      await run(async () => {
                        await op("reopenFinancialPeriod", [building.id, period, periodReason.trim()]);
                        setPeriodReason("");
                      });
                    }}
                  >
                    {tr("Réouvrir", "إعادة فتح")}
                  </button>
                )}
              </div>
              {closedPeriodsEntries.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="font-semibold">{tr("Périodes clôturées :", "الفترات المغلقة:")}</span>
                  {closedPeriodsEntries.map(([key, meta]: [string, any]) => {
                    const p = key.split(":").pop() || key;
                    return (
                      <span key={key} className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono" title={meta?.reason || ""}>
                        {p}{meta?.reason ? ` (${meta.reason})` : ""}
                      </span>
                    );
                  })}
                </div>
              )}
            </fieldset>
            <fieldset className="border rounded p-3 flex flex-wrap items-end gap-3">
              <legend className="text-xs font-semibold px-1">
                {tr("Contrepassation d’encaissement", "عكس دفعة محصلة")}
              </legend>
              <label className="text-xs">
                {tr("Encaissement à contrepasser", "دفعة لعكسها")}
                <select
                  className="border rounded p-2 block max-w-sm text-sm"
                  value={payment}
                  onChange={(e) => setPayment(e.target.value)}
                >
                  <option value="">
                    {tr("Choisir un encaissement", "اختر دفعة")}
                  </option>
                  {[
                    ...new Set(
                      (report?.ledger || [])
                        .filter(
                          (t: any) =>
                            t.type === "income" &&
                            t.paymentId &&
                            !t.transferId &&
                            !t.reversalOf &&
                            (Boolean(t.sourceChargeId) ||
                              (Array.isArray(t.paymentAllocations) &&
                                t.paymentAllocations.length > 0)) &&
                            !report.ledger.some(
                              (r: any) => r.reversalOf === t.paymentId,
                            ),
                        )
                        .map((t: any) => t.paymentId),
                    ),
                  ].map((id: any) => (
                    <option key={id} value={id}>
                      {
                        report.ledger.find((t: any) => t.paymentId === id)
                          ?.description
                      }{" "}
                      · {id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex-1 min-w-[200px] text-xs">
                {tr("Motif de contrepassation", "سبب العكس")}
                <input
                  className="border rounded p-2 block w-full text-sm"
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                />
              </label>
              <button
                className={button}
                disabled={busy || !payment || !reversalReason.trim()}
                onClick={async () => {
                  const ok = await confirmAction({
                    title: tr("Contrepasser l'encaissement", "تأكيد عكس الدفعة"),
                    message: tr(
                      `Contrepasser l'encaissement ${payment} et annuler la quittance associée ? Motif : ${reversalReason.trim()}`,
                      `هل تؤكد عكس الدفعة ${payment} وإلغاء الوصل المرتبط بها؟ السبب: ${reversalReason.trim()}`
                    ),
                    confirmLabel: tr("Contrepasser", "عكس الدفعة"),
                  });
                  if (!ok) return;
                  await run(async () => {
                    await op("reversePayment", [building.id, payment, reversalReason.trim()]);
                    setPayment("");
                    setReversalReason("");
                  });
                }}
              >
                {tr(
                  "Contrepasser sans effacer l’original",
                  "عكس الدفعة مع الاحتفاظ بالأصل",
                )}
              </button>
            </fieldset>
            <fieldset className="border rounded p-3 flex flex-wrap items-end gap-3">
              <legend>
                {tr("Reprise d’un arriéré initial", "ترحيل متأخرات افتتاحية")}
              </legend>
              <label>
                {tr("Lot", "الوحدة")}
                <select
                  className="border rounded p-2 block"
                  value={lot}
                  onChange={(e) => setLot(e.target.value)}
                >
                  <option value="">{tr("Choisir", "اختر")}</option>
                  {building.apartments
                    .filter((a) => !a.archivedAt && (a.ownerId || a.tenantId))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.number}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {tr("Période de l'arriéré", "فترة المتأخرات")}
                <input
                  className="border rounded p-2 block"
                  type="month"
                  value={arrearsPeriod}
                  onChange={(e) => setArrearsPeriod(e.target.value)}
                />
              </label>
              <label>
                {tr("Montant MAD", "المبلغ MAD")}
                <input
                  className="border rounded p-2 block"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={arrears}
                  onChange={(e) => setArrears(e.target.value)}
                />
              </label>
              <label className="flex-1 min-w-[180px]">
                {tr("Libellé (optionnel)", "البيان (اختياري)")}
                <input
                  className="border rounded p-2 block w-full"
                  value={arrearsDescription}
                  onChange={(e) => setArrearsDescription(e.target.value)}
                  placeholder={tr("Arriéré initial", "متأخرات افتتاحية")}
                />
              </label>
              <button
                className={button}
                disabled={busy || !lot || !arrearsPeriod || Number(arrears) <= 0}
                onClick={() =>
                  void run(async () => {
                    const a = building.apartments.find((a) => a.id === lot);
                    const residentId = a?.ownerId || a?.tenantId;
                    if (!residentId) throw new Error(tr('Affectez un résident à ce lot.', 'يرجى ربط ساكن بهذا العقار.'));
                    await op("importOpeningArrears", [
                      building.id,
                      [
                        {
                          apartmentId: lot,
                          residentId,
                          period: arrearsPeriod,
                          amount: Number(arrears),
                          description:
                            arrearsDescription.trim() || tr("Arriéré initial", "متأخرات افتتاحية"),
                        },
                      ],
                    ]);
                    setArrears("");
                    setArrearsDescription("");
                  })
                }
              >
                {tr(
                  "Ajouter la dette sans mouvement de caisse",
                  "إضافة الدين دون حركة نقدية",
                )}
              </button>
            </fieldset>
            {report?.archives && (
              <div className="flex gap-2 flex-wrap">
                {Object.entries(report.archives).flatMap(([kind, items]) =>
                  (items as any[]).map((item) => (
                    <button
                      key={kind + item.id}
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void run(() => op("restoreArchived", [kind, item.id]))
                      }
                    >
                      {tr("Restaurer", "استعادة")} {item.name || item.number}
                    </button>
                  )),
                )}
              </div>
            )}
          </>
        )}
        <p className="text-sm" role="status">
          {status}
        </p>
      </div>
    </details>
    </section>
  );
}

