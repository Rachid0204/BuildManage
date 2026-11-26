import type express from "express";
import { z } from "zod";
import { executeFirebaseMutation } from "../firebaseIdentity";
import {
  type identityTransaction,
  resumeIdentityMutations,
} from "../identityMutations";
import { runLifecycle } from "../lifecycle";
import { monthlyBillingJob } from "../monthlyBillingJob";
import {
  authorizeBillingBuilding,
  canWrite,
  generateScheduledMonthlyCharges,
  monthlyBillingHttpStatus,
  OperationError,
} from "../operations";
import type { StateRepository } from "../repository";
import { lifecycleStorage } from "../uploads";
import type {
  AssertOnboardedFn,
  ExtractAndVerifyCallerFn,
  SchedulerAuthFn,
  ServerStore,
  WrapFn,
  WrappedApi,
} from "./types";

export interface JobsRoutesDeps {
  api: WrappedApi;
  wrap: WrapFn;
  repository: StateRepository;
  sharedStore: ServerStore;
  scheduler: SchedulerAuthFn;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  assertOnboarded: AssertOnboardedFn;
  finalizeIdentityResponse: Parameters<typeof identityTransaction>[4];
  uploadsDir: string;
}

export function registerJobsRoutes(
  app: express.Express,
  deps: JobsRoutesDeps,
) {
  const {
    api,
    wrap,
    repository,
    sharedStore,
    scheduler,
    extractAndVerifyCaller,
    assertOnboarded,
    finalizeIdentityResponse,
    uploadsDir,
  } = deps;

  app.post(
    "/api/jobs/lifecycle",
    wrap(async (req: express.Request, res: express.Response) => {
      if (!scheduler(req))
        return res.status(403).json({ error: "Ordonnanceur non autorisé." });
      return res.json(
        await runLifecycle(repository, lifecycleStorage(uploadsDir)),
      );
    }, false),
  );
  app.post(
    "/api/jobs/monthly-charges",
    wrap(monthlyBillingJob(repository, scheduler), false),
  );
  api.get("/api/billing-runs", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller) throw new OperationError("Authentification requise.", 401);
    assertOnboarded(caller, sharedStore);
    const syndicId = String(req.query.syndicId || ""),
      buildingId = String(req.query.buildingId || "");
    authorizeBillingBuilding(sharedStore, caller, syndicId, buildingId);
    const runs = (sharedStore.__billingRuns || []).filter((r: any) =>
      r.results.some(
        (x: any) =>
          x.syndicId === syndicId &&
          x.buildingId === buildingId &&
          x.status === "failed",
      ),
    );
    return res.json({
      runs: runs
        .slice(-50)
        .reverse()
        .map((r: any) => ({
          id: r.id,
          period: r.period,
          startedAt: r.startedAt,
          status: r.status,
          resolved: (sharedStore.__billingRuns || []).some(
            (later: any) =>
              later.period === r.period &&
              later.startedAt >= r.startedAt &&
              later.id !== r.id &&
              later.results.some(
                (x: any) =>
                  x.syndicId === syndicId &&
                  x.buildingId === buildingId &&
                  (x.status === "succeeded" ||
                    (x.status === "skipped" && x.reason === "already_billed")),
              ),
          ),
          results: r.results.filter(
            (x: any) =>
              x.syndicId === syndicId && x.buildingId === buildingId,
          ),
        })),
    });
  });
  app.post(
    "/api/billing-runs/retry",
    wrap(async (req: express.Request, res: express.Response) => {
      const { syndicId, buildingId, runId } = z
        .object({
          syndicId: z.string().min(1),
          buildingId: z.string().min(1),
          runId: z.string().uuid(),
        })
        .parse(req.body);
      const input = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller)
          throw new OperationError("Authentification requise.", 401);
        assertOnboarded(caller, state);
        const b = authorizeBillingBuilding(state, caller, syndicId, buildingId);
        b.syndicId = syndicId;
        canWrite(caller, b);
        const run = (state.__billingRuns || []).find(
          (r: any) => r.id === runId,
        );
        if (!run) throw new OperationError("Exécution introuvable.", 404);
        return { caller, period: run.period };
      });
      const result = await generateScheduledMonthlyCharges(
        repository,
        input.period,
        String(res.getHeader("X-Request-ID")),
        { target: { syndicId, buildingId, runId, actor: input.caller } },
      );
      return res.status(monthlyBillingHttpStatus(result)).json(result);
    }, false),
  );
  api.post("/api/jobs/outbox", async (req, res) => {
    if (!scheduler(req))
      return res.status(403).json({ error: "Ordonnanceur non autorisé." });
    res.locals.afterCommit = () =>
      resumeIdentityMutations(
        repository,
        executeFirebaseMutation,
        finalizeIdentityResponse,
      );
    return res.json({ ok: true });
  });
  api.post("/api/jobs/overdue", async (req, res) => {
    if (!scheduler(req))
      return res.status(403).json({ error: "Ordonnanceur non autorisé." });
    const todayCasablanca = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Casablanca",
    }).format(new Date());
    let updatedInvoices = 0;
    let updatedCharges = 0;
    for (const i of sharedStore.syndik_prod_invoices_v1 || []) {
      const due = typeof i.dueDate === "string" ? i.dueDate.slice(0, 10) : "";
      if (
        i.status !== "paid" &&
        i.status !== "cancelled" &&
        /^\d{4}-\d{2}-\d{2}$/.test(due) &&
        due < todayCasablanca
      ) {
        if (i.status !== "overdue") updatedInvoices++;
        i.status = "overdue";
      }
    }
    for (const c of sharedStore.syndik_prod_charges_v1 || []) {
      const due = typeof c.dueDate === "string" ? c.dueDate.slice(0, 10) : "";
      const remainingCents =
        Math.round((Number(c.amount) || 0) * 100) -
        Math.round((Number(c.paidAmount) || 0) * 100);
      if (
        c.status !== "paid" &&
        remainingCents > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(due) &&
        due < todayCasablanca
      ) {
        if (c.status !== "overdue") updatedCharges++;
        c.status = "overdue";
      }
    }
    return res.json({ ok: true, updatedInvoices, updatedCharges });
  });
}
