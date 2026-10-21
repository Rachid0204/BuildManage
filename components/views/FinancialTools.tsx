import React, { useState } from "react";
import { remoteMutation } from "../../firebase/services";
import { getAuthenticatedRequestHeaders } from "../../utils/security";
import { useI18n } from "../../hooks/useI18n";
import { useAuth } from "../../contexts/AuthContext";
import type { Building } from "../../types";
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
        .replace(/^[=+@-]/, "'$&")
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
  const { tr } = useI18n(),
    { userProfile } = useAuth(),
    managed = ["admin", "syndic"].includes(userProfile?.role || ""),
    [report, setReport] = useState<any>(),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false),
    [working, setWorking] = useState("0"),
    [reserve, setReserve] = useState("0"),
    [reason, setReason] = useState(""),
    [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [payment, setPayment] = useState(""),
    [lot, setLot] = useState(""),
    [arrears, setArrears] = useState("");
  const load = async () => {
    const r = await fetch(
      `/api/reports?buildingId=${encodeURIComponent(building.id)}`,
      { headers: getAuthenticatedRequestHeaders() },
    );
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    setReport(d);
    return d;
  };
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setStatus("");
    try {
      await action();
      await load();
      setStatus(tr("Opération enregistrée.", "تم تسجيل العملية."));
    } catch (e: any) {
      setStatus(e.message);
    } finally {
      setBusy(false);
    }
  };
  const op = (operation: string, args: any[]) =>
    remoteMutation(operation, args);
  const button =
    "border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:opacity-50";
  return (
    <details className="bg-white border rounded-xl p-4">
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
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th>{tr("Résident", "الساكن")}</th>
                  <th>{tr("Facturé", "المفوتر")}</th>
                  <th>{tr("Réglé", "المدفوع")}</th>
                  <th>{tr("Solde dû", "الرصيد المستحق")}</th>
                  <th>{tr("Plus de 90 jours", "أكثر من 90 يوماً")}</th>
                </tr>
              </thead>
              <tbody>
                {report.statements.map((s: any) => (
                  <tr key={s.residentId}>
                    <td>{s.name}</td>
                    <td>{s.billed} MAD</td>
                    <td>{s.paid} MAD</td>
                    <td>{s.outstanding} MAD</td>
                    <td>{s.over90Days} MAD</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {managed && (
          <>
            <label className="block text-sm">
              {tr("Motif de correction ou clôture", "سبب التصحيح أو الإقفال")}
              <input
                className="border rounded p-2 w-full"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {!(building.financials as any)?.openingBalancesRecordedAt && (
              <fieldset className="border rounded p-3 flex flex-wrap items-end gap-3">
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
                <button
                  className={button}
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    void run(() =>
                      op("setOpeningBalances", [
                        building.id,
                        {
                          working: Number(working),
                          reserve: Number(reserve),
                          reason,
                        },
                      ]),
                    )
                  }
                >
                  {tr("Confirmer une fois", "تأكيد مرة واحدة")}
                </button>
              </fieldset>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label>
                {tr("Période", "الفترة")}
                <input
                  className="border rounded p-2 block"
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                />
              </label>
              <button
                className={button}
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void run(() =>
                    op("closeFinancialPeriod", [building.id, period, reason]),
                  )
                }
              >
                {tr("Clôturer", "إقفال")}
              </button>
              {userProfile?.role === "admin" && (
                <button
                  className={button}
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    void run(() =>
                      op("reopenFinancialPeriod", [
                        building.id,
                        period,
                        reason,
                      ]),
                    )
                  }
                >
                  {tr("Réouvrir", "إعادة فتح")}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label>
                {tr("Encaissement à contrepasser", "دفعة لعكسها")}
                <select
                  className="border rounded p-2 block max-w-sm"
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
              <button
                className={button}
                disabled={busy || !payment || !reason.trim()}
                onClick={() =>
                  void run(() =>
                    op("reversePayment", [building.id, payment, reason]),
                  )
                }
              >
                {tr(
                  "Contrepasser sans effacer l’original",
                  "عكس الدفعة مع الاحتفاظ بالأصل",
                )}
              </button>
            </div>
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
                    .filter((a) => a.ownerId || a.tenantId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.number}
                      </option>
                    ))}
                </select>
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
              <button
                className={button}
                disabled={busy || !lot || Number(arrears) <= 0}
                onClick={() =>
                  void run(() => {
                    const a = building.apartments.find((a) => a.id === lot)!;
                    return op("importOpeningArrears", [
                      building.id,
                      [
                        {
                          apartmentId: lot,
                          residentId: a.ownerId || a.tenantId,
                          period,
                          amount: Number(arrears),
                          description:
                            reason || tr("Arriéré initial", "متأخرات افتتاحية"),
                        },
                      ],
                    ]);
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
  );
}
