import React from "react";
import { Link } from "react-router-dom";
import type { Building } from "../../types";
import { useI18n } from "../../hooks/useI18n";
export default function SetupChecklist({ building }: { building: Building }) {
  const { tr } = useI18n();
  const activeApartments = (building.apartments || []).filter((a) => !a.archivedAt);
  const targetTantiemes = building.totalTantiemes || 1000;
  const totalAllocatedTantiemes = activeApartments.reduce(
    (sum, a) => sum + (typeof a.tantiemes === "number" && Number.isFinite(a.tantiemes) ? a.tantiemes : 0),
    0,
  );
  const activeOwnerIds = new Set(
    (building.residents || [])
      .filter((r) => !r.archivedAt && r.isOwner === true)
      .map((r) => r.id),
  );
  const normalizedRib = (building.bankRib || "").replace(/\s/g, "");

  const checks = [
    {
      ok: !!building.address?.trim() && !!building.city?.trim(),
      label: tr("Adresse et ville", "العنوان والمدينة"),
      to: "/buildings",
    },
    {
      ok:
        activeApartments.length > 0 &&
        activeApartments.every(
          (a) => typeof a.tantiemes === "number" && Number.isFinite(a.tantiemes) && a.tantiemes >= 0,
        ) &&
        totalAllocatedTantiemes === targetTantiemes,
      label: tr(
        `Lots et tantièmes (${totalAllocatedTantiemes}/${targetTantiemes})`,
        `الوحدات والأنصبة (${totalAllocatedTantiemes}/${targetTantiemes})`,
      ),
      to: "/apartments",
    },
    {
      ok:
        activeApartments.length > 0 &&
        activeApartments.every(
          (a) => Boolean(a.ownerId && activeOwnerIds.has(a.ownerId)),
        ),
      label: tr("Copropriétaires liés aux lots", "ربط الملاك بالوحدات"),
      to: "/residents",
    },
    {
      ok: !!(building.financials as any)?.openingBalancesRecordedAt,
      label: tr("Soldes initiaux confirmés", "تأكيد الأرصدة الافتتاحية"),
      to: "/financials",
    },
    {
      ok: /^\d{24}$/.test(normalizedRib),
      label: tr("RIB bancaire (24 chiffres)", "رقم الحساب البنكي RIB (24 رقماً)"),
      to: "/buildings",
    },
  ];
  if (checks.every((c) => c.ok)) return null;
  return (
    <aside className="rounded-xl bg-amber-50 border border-amber-200 p-4 mb-4">
      <h2 className="font-bold text-sm">
        {tr("Préparer cet immeuble", "تجهيز هذه العمارة")}
      </h2>
      <div className="flex gap-3 flex-wrap text-sm mt-2">
        {checks.map((c) => (
          <Link className="underline" key={c.to + c.label} to={c.to}>
            {c.ok ? "✓" : "○"} {c.label}
          </Link>
        ))}
      </div>
    </aside>
  );
}
