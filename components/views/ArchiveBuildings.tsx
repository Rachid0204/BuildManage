import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { remoteMutation } from "../../firebase/services";
import { getAuthenticatedRequestHeaders } from "../../utils/security";
import { useI18n } from "../../hooks/useI18n";

export default function ArchiveBuildings() {
  const { tr } = useI18n();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const { data: items = [], refetch, isFetching, error } = useQuery({
    queryKey: ['archivedBuildings'],
    queryFn: async ({ signal }): Promise<Array<{ id: string; name: string }>> => {
      const response = await fetch('/api/archives', { headers: getAuthenticatedRequestHeaders(), signal, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.buildings;
    },
  });
  const load = async () => {
    setMessage('');
    try {
      await refetch({ throwOnError: true });
    } catch (error: any) {
      setMessage(error.message);
    }
  };
  const restore = async (id: string) => {
    setBusy(true);
    try {
      await remoteMutation("restoreArchived", ["buildings", id]);
      await refetch({ throwOnError: true, cancelRefetch: false });
      setMessage('');
    } catch (error: any) {
      setMessage(error.message);
    } finally { setBusy(false); }
  };
  return (
    <details className="mb-4 border rounded-xl p-3 bg-white">
      <summary className="font-bold cursor-pointer">
        {tr("Immeubles archivés", "العمارات المؤرشفة")}
      </summary>
      <button
        className="border rounded p-2 mt-2"
        disabled={busy || isFetching}
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
      <p role="status">{message || error?.message || (!isFetching && !items.length ? tr('Aucun immeuble archivé.', 'لا توجد عمارات مؤرشفة.') : '')}</p>
    </details>
  );
}
