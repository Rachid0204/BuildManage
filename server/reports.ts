import { buildingFor, actorIdentity, OperationError, type Actor } from "./operations";
import type { State } from "./repository";
export function buildingReport(state: State, actor: Actor, id: string) {
  const b = buildingFor(actor, id, false),
    managed = ["admin", "syndic"].includes(actor.role);
  if (actor.role === "provider")
    throw new OperationError("Accès refusé", 403);
  const charges = (state.syndik_prod_charges_v1 || []).filter(
      (c: any) =>
        c.buildingId === id &&
        (managed || c.residentId === actorIdentity(actor)),
    ),
    invoices = (state.syndik_prod_invoices_v1 || []).filter(
      (c: any) =>
        c.buildingId === id &&
        (managed || c.residentId === actorIdentity(actor)),
    ),
    receipts = (state.syndik_prod_quittances_v1 || []).filter(
      (c: any) =>
        c.buildingId === id &&
        (managed || c.residentId === actorIdentity(actor)),
    );
  const statements = b.residents
    .filter((r: any) => managed || r.id === actorIdentity(actor))
    .map((r: any) => {
      const entries = charges.filter((c: any) => c.residentId === r.id);
      return {
        residentId: r.id,
        name: r.name,
        openingArrears: entries
          .filter((c: any) => c.openingArrears)
          .reduce(
            (s: number, c: any) => Math.round(s * 100 + c.amount * 100) / 100,
            0,
          ),
        billed:
          entries.reduce(
            (s: number, c: any) => s + Math.round(c.amount * 100),
            0,
          ) / 100,
        paid:
          entries.reduce(
            (s: number, c: any) =>
              s +
              Math.round(
                (c.paidAmount ?? (c.status === "paid" ? c.amount : 0)) * 100,
              ),
            0,
          ) / 100,
        outstanding:
          entries.reduce(
            (s: number, c: any) =>
              s +
              Math.max(
                0,
                Math.round(
                  (c.amount -
                    (c.paidAmount ?? (c.status === "paid" ? c.amount : 0))) *
                    100,
                ),
              ),
            0,
          ) / 100,
        over90Days:
          entries
            .filter(
              (c: any) => Date.parse(c.dueDate) < Date.now() - 90 * 86400000,
            )
            .reduce(
              (s: number, c: any) =>
                s +
                Math.max(
                  0,
                  Math.round(
                    (c.amount -
                      (c.paidAmount ?? (c.status === "paid" ? c.amount : 0))) *
                      100,
                  ),
                ),
              0,
            ) / 100,
      };
    });
  return {
    building: { id: b.id, name: b.name },
    statements,
    charges,
    invoices,
    receipts,
    ledger: managed ? b.financials?.transactions || [] : [],
    financials: managed ? b.financials : undefined,
    audit: managed
      ? (state.syndik_prod_audit_v1 || []).filter(
          (a: any) => a.buildingId === id,
        )
      : [],
    closedPeriods: managed
      ? Object.fromEntries(
          Object.entries(state.__closedPeriods || {}).filter(([key]) =>
            key.startsWith(id + ":"),
          ),
        )
      : {},
    archives: managed
      ? {
          apartments: b.apartments.filter((a: any) => a.archivedAt),
          residents: b.residents.filter((r: any) => r.archivedAt),
          prestataires: (state.syndik_prod_prestataires_v1 || []).filter(
            (p: any) => p.buildingId === id && p.archivedAt,
          ),
        }
      : undefined,
  };
}
