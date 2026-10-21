import React from "react";
import { Link } from "react-router-dom";
import type { Building } from "../../types";
import { useI18n } from "../../hooks/useI18n";
export default function SetupChecklist({ building }: { building: Building }) {
  const { tr } = useI18n(),
    checks = [
      {
        ok: !!building.address?.trim() && !!building.city?.trim(),
        label: tr("Adresse et ville", "العنوان والمدينة"),
        to: "/buildings",
      },
      {
        ok:
          building.apartments.length > 0 &&
          building.apartments.every((a) => Number.isFinite(a.tantiemes)),
        label: tr("Lots et tantièmes", "الوحدات والأنصبة"),
        to: "/apartments",
      },
      {
        ok:
          building.apartments.length > 0 &&
          building.apartments.every((a) => a.ownerId || a.tenantId),
        label: tr("Résidents liés aux lots", "ربط السكان بالوحدات"),
        to: "/residents",
      },
      {
        ok: !!(building.financials as any)?.openingBalancesRecordedAt,
        label: tr("Soldes initiaux confirmés", "تأكيد الأرصدة الافتتاحية"),
        to: "/financials",
      },
      {
        ok: !!building.bankRib,
        label: tr("Coordonnées bancaires réelles", "المعلومات البنكية الفعلية"),
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
