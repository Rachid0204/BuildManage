import type { MaintenanceRequest, Syndic, Building } from '../types';
export function normalizeMaintenanceRequestApartment(req: MaintenanceRequest, syndics: Syndic[]): MaintenanceRequest {
  let targetBld: Building | undefined;
  for (const s of syndics) {
    const found = s.buildings.find((b) => b.id === req.buildingId);
    if (found) {
      targetBld = found;
      break;
    }
  }
  if (!targetBld) return req;

  const apartments = targetBld.apartments || [];
  const residents = targetBld.residents || [];
  const resObj = residents.find(
    (r) =>
      r.id === req.residentId ||
      `res-${r.id}` === req.residentId ||
      (req.residentName && r.name.trim().toLowerCase() === req.residentName.trim().toLowerCase())
  );

  const resolveAptNum = (aptId?: string): string | undefined => {
    if (!aptId) return undefined;
    const direct = apartments.find((a) => a.id === aptId);
    if (direct?.number && !direct.number.startsWith('apt-')) {
      return direct.number.replace(/^(Lot|شقة)\s+/i, '').trim();
    }
    const idxMatch = aptId.match(/apt-\d+-(\d+)/);
    if (idxMatch) {
      const idx = parseInt(idxMatch[1], 10);
      const byIdx = apartments[idx];
      if (byIdx?.number && !byIdx.number.startsWith('apt-')) {
        return byIdx.number.replace(/^(Lot|شقة)\s+/i, '').trim();
      }
      return String(idx + 1);
    }
    return undefined;
  };

  let resolvedNumber = req.apartmentNumber;
  const linkedApt =
    (resObj?.apartmentId && apartments.find((a) => a.id === resObj.apartmentId)) ||
    apartments.find(
      (a) =>
        a.ownerId === req.residentId ||
        a.tenantId === req.residentId ||
        (resObj && (a.ownerId === resObj.id || a.tenantId === resObj.id))
    );

  if (linkedApt?.number && !linkedApt.number.startsWith('apt-')) {
    resolvedNumber = `Lot ${linkedApt.number.replace(/^(Lot|شقة)\s+/i, '').trim()}`;
  } else if (req.apartmentNumber && /apt-[\w-]+/.test(req.apartmentNumber)) {
    const idMatch = req.apartmentNumber.match(/apt-[\w-]+/);
    const num = resolveAptNum(idMatch?.[0]) || resolveAptNum(resObj?.apartmentId);
    if (num) resolvedNumber = `Lot ${num}`;
  } else if (!req.apartmentNumber && resObj?.apartmentId) {
    const num = resolveAptNum(resObj.apartmentId);
    if (num) resolvedNumber = `Lot ${num}`;
  }

  return {
    ...req,
    residentName: req.residentName || resObj?.name,
    apartmentNumber: resolvedNumber,
  };
}
