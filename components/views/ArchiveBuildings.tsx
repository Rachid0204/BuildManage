import React, { useState } from "react";
import { remoteMutation } from "../../firebase/services";
import { getAuthenticatedRequestHeaders } from "../../utils/security";
import { useI18n } from "../../hooks/useI18n";

export default function ArchiveBuildings() {
  const { tr } = useI18n();
  const [items, setItems] = useState<Array<{ id: string; name: string }>>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/archives", {
        headers: getAuthenticatedRequestHeaders(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setItems(data.buildings);
      setMessage(
        data.buildings.length
          ? ""
          : tr("Aucun immeuble archivé.", "لا توجد عمارات مؤرشفة."),
      );
    } catch (error: any) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (id: string) => {
    setBusy(true);
    try {
      await remoteMutation("restoreArchived", ["buildings", id]);
      window.location.reload();
    } catch (error: any) {
      setMessage(error.message);
      setBusy(false);
    }
  };
  return (
    <details className="mb-4 border rounded-xl p-3 bg-white">
      <summary className="font-bold cursor-pointer">
        {tr("Immeubles archivés", "العمارات المؤرشفة")}
      </summary>
      <button
        className="border rounded p-2 mt-2"
        disabled={busy}
        onClick={() => void load()}
      >
        {tr("Charger les archives", "تحميل الأرشيف")}
      </button>
      <div className="flex flex-wrap gap-2 mt-2">
        {items.map((item) => (
          <button
            key={item.id}
            className="border rounded p-2"
            disabled={busy}
            onClick={() => void restore(item.id)}
          >
            {tr("Restaurer", "استعادة")} {item.name}
          </button>
        ))}
      </div>
      <p role="status">{message}</p>
    </details>
  );
}
