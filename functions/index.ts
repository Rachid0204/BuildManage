import { retryMonthlyBilling } from './monthlyBilling';
import * as functions from "firebase-functions/v1";
async function backend(route: string, body: unknown, authorization?: string) {
  const origin = process.env.SYNDIK_BACKEND_URL;
  if (
    !origin ||
    (!origin.startsWith("https://") && !process.env.FUNCTIONS_EMULATOR)
  )
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Configure an HTTPS SYNDIK_BACKEND_URL.",
      { retryable: false },
    );
  const response = await fetch(new URL(route, origin), {
    method: "POST",
    signal: AbortSignal.timeout(route === '/api/jobs/monthly-charges' ? 120000 : 300000),
    headers: {
      "Content-Type": "application/json",
      ...(authorization
        ? { Authorization: authorization }
        : { "X-Syndik-Scheduler": process.env.SYNDIK_SCHEDULER_SECRET || "" }),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (route === '/api/jobs/monthly-charges' && data.ok === false) {
    functions.logger.error('Monthly billing has failed buildings', data);
    if (response.ok && Array.isArray(data.results) && data.results.some((r: any) => r.status === 'failed') &&
        data.results.every((r: any) => r.status !== 'failed' || r.retryable === false)) return data;
    throw new functions.https.HttpsError('unavailable', 'Monthly billing requires retry.', { retryable: response.ok || response.status >= 500 || response.status === 429, runId: data.id });
  }
  if (!response.ok)
    throw new functions.https.HttpsError(
      "failed-precondition",
      data.error || "Backend operation rejected",
      { retryable: response.status >= 500 || response.status === 429 },
    );
  return data;
}
function credential(context: functions.https.CallableContext) {
  if (
    !context.auth ||
    typeof context.rawRequest.headers.authorization !== "string"
  )
    throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
  return context.rawRequest.headers.authorization;
}
export const generateMonthlyCharges = functions
  .runWith({ timeoutSeconds: 300 })
  .https.onCall(async (data, context) => {
    const result = await backend(
      "/api/commands",
      {
        operation: "generateMonthlyCharges",
        operationId:
          data.operationId ||
          `op:${new Date().setUTCHours(0,0,0,0)}:monthly:${data.buildingId}:${data.period || new Date().toISOString().slice(0, 7)}`,
        args: [data.buildingId, data.syndicId, data.period, data.options],
      },
      credential(context),
    );
    return { success: true, charges: result.result, ...result.resultMeta };
  });
export const scheduledMonthlyCharges = functions
  .runWith({ timeoutSeconds: 540, secrets: ["SYNDIK_SCHEDULER_SECRET"] })
  .pubsub.schedule("0 0 1 * *")
  .timeZone("Africa/Casablanca")
  .onRun(async context => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit' })
      .formatToParts(new Date(context.timestamp));
    const period = `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
    return retryMonthlyBilling(retryRunId => backend('/api/jobs/monthly-charges', { period, retryRunId }),
      error => functions.logger.error('Monthly billing scheduler attempt failed', error));
  });
export const createInvoice = functions.https.onCall(async (data, context) => {
  const r = await backend(
    "/api/commands",
    {
      operation: "createInvoiceForResident",
      operationId:
        data.operationId ||
        `op:${new Date().setUTCHours(0,0,0,0)}:invoice:${data.buildingId}:${data.residentId}:${new Date().toISOString().slice(0, 10)}`,
      args: [data.residentId, data.buildingId, data.syndicId],
    },
    credential(context),
  );
  return { success: true, invoiceId: r.result.id };
});
export const createUserForResident = functions.https.onCall(
  async (data, context) =>
    backend(
      "/api/commands",
      {
        operation: "regenerateResidentCredentials",
        operationId:
          data.operationId ||
          `op:${new Date().setUTCHours(0,0,0,0)}:invite:${data.residentId}:${new Date().toISOString().slice(0, 10)}`,
        args: [data.residentId],
      },
      credential(context),
    ),
);
export const checkOverdueInvoices = functions
  .runWith({ secrets: ["SYNDIK_SCHEDULER_SECRET"] })
  .pubsub.schedule("every 24 hours")
  .onRun(async () => backend("/api/jobs/overdue", {}));
export const deliverTransactionalEmails = functions
  .runWith({ secrets: ["SYNDIK_SCHEDULER_SECRET"] })
  .pubsub.schedule("every 5 minutes")
  .onRun(async () => backend("/api/jobs/outbox", {}));
export const generateCmiPaymentData = functions.https.onCall(async () => {
  throw new functions.https.HttpsError(
    "failed-precondition",
    "Card processing is unavailable pending merchant integration.",
  );
});
export const cmiCallback = functions.https.onRequest((_req, res) => {
  res.status(503).send("Card processing unavailable");
});
// Retain old deployed trigger names while replacing all business writes with
// backend operations. Legacy mirrors can no longer create a second ledger.
export const onInvoiceCreated = functions.firestore
  .document("invoices/{invoiceId}")
  .onCreate(async () => null);
export const onInvoicePaid = functions.firestore
  .document("invoices/{invoiceId}")
  .onUpdate(async () => null);
export const onPaymentProofSubmitted = functions.firestore
  .document("payment_proofs/{proofId}")
  .onCreate(async () => null);
export const onPaymentProofReviewed = functions.firestore
  .document("payment_proofs/{proofId}")
  .onUpdate(async () => null);
export const onMaintenanceRequestCreated = functions.firestore
  .document("maintenance/{requestId}")
  .onCreate(async () => null);
export const onMaintenanceUpdated = functions.firestore
  .document("maintenance/{requestId}")
  .onUpdate(async () => null);
export const onAnnouncementCreated = functions.firestore
  .document("announcements/{announcementId}")
  .onCreate(async () => null);

export const onUserCreate = functions.auth.user().onCreate(async () => null);

export const cleanupOperationalStorage = functions
 .runWith({timeoutSeconds:540,secrets:["SYNDIK_SCHEDULER_SECRET"]})
 .pubsub.schedule("every 60 minutes")
 .onRun(async()=>backend("/api/jobs/lifecycle",{}));

