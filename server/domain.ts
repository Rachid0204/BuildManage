/** @deprecated Legacy parity oracle only. Production dispatch uses server/domain/command.service.ts. */
import { currentState } from "./repository";
import { hashPassword } from "./passwords";
import { configureServerRuntime } from "../firebase/serverRuntime";
import * as services from "../firebase/services";
configureServerRuntime({ hashPassword });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) =>
      currentState()[key] === undefined
        ? null
        : typeof currentState()[key] === "string"
          ? currentState()[key]
          : JSON.stringify(currentState()[key]),
    setItem: (key: string, value: string) => {
      try {
        currentState()[key] = JSON.parse(value);
      } catch {
        currentState()[key] = value;
      }
    },
    removeItem: (key: string) => {
      delete currentState()[key];
    },
  },
});
export const MUTATIONS = [
  "saveSyndic",
  "addBuilding",
  "updateBuilding",
  "deleteBuilding",
  "addApartment",
  "addApartmentsBulk",
  "rebalanceBuildingTantiemes",
  "updateApartment",
  "deleteApartment",
  "addResident",
  "updateResident",
  "regenerateResidentCredentials",
  "recordResidentCredentialShare",
  "deleteResident",
  "generateMonthlyCharges",
  "submitPaymentProof",
  "approvePaymentProofsBatch",
  "reconcileBankStatementCSV",
  "reviewPaymentProof",
  "createQuittance",
  "generateQuittanceForCharge",
  "saveAssembleeGenerale",
  "createAssembleeGenerale",
  "toggleAGVoting",
  "generateChargesFromAGResolution",
  "recordAGVote",
  "updateAGAttendee",
  "savePrestataire",
  "regeneratePrestataireCredentials",
  "recordPrestataireCredentialShare",
  "deletePrestataire",
  "addPrestataireReview",
  "addTransaction",
  "createInvoiceForResident",
  "recordPayment",
  "addMaintenanceRequest",
  "updateMaintenanceRequest",
  "addAnnouncement",
  "deleteDocument",
  "markNotificationAsRead",
  "sendChatMessage",
  "toggleChatMessageLike",
  "addMarketplaceItem",
  "updateMarketplaceItemStatus",
  "deleteMarketplaceItem",
] as const;
export async function executeMutation(
  operation: string,
  args: any[],
): Promise<any> {
  if (!(MUTATIONS as readonly string[]).includes(operation))
    throw new Error("Unknown operation");
  return (
    services[operation as keyof typeof services] as (...args: any[]) => unknown
  )(...args);
}

