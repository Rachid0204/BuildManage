import crypto from "crypto";
import type express from "express";
import { z } from "zod";
import { projectAssemblyForRole } from "../assemblyPrivacy";
import {
  CommandEnvelopeSchema,
  CommandIdentitySchema,
} from "../domain/commandContracts";
import {
  accountUid,
  identityAccounts,
  planFirebasePassword,
  usesFirebaseAuth,
} from "../firebaseIdentity";
import {
  assertIdentityReady,
  pendingIdentityPlanId,
  resumeQueuedIdentityMutation,
} from "../identityMutations";
import { assertFreshOperationId } from "../lifecycle";
import { decrypt, encrypt, mailIsConfigured } from "../mailer";
import {
  appendAudit,
  canWrite,
  OperationError,
  recomputeMeeting,
  runOperation,
} from "../operations";
import { operationActorScope, readOperationStatus } from "../operationStatus";
import { verifyPassword } from "../passwords";
import { buildingReport } from "../reports";
import type { StateRepository } from "../repository";
import type { AssembleeGenerale, Building } from "../../types";
import { applyResidentVote } from "../../utils/agVoting";
import type {
  AssertOnboardedFn,
  AuthCallerContext,
  AuthorizedScope,
  ExtractAndVerifyCallerFn,
  ServerStore,
  WrapFn,
  WrappedApi,
} from "./types";

export interface StateAndVoteRoutesDeps {
  api: WrappedApi;
  sharedStore: ServerStore;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  assertOnboarded: AssertOnboardedFn;
  getAuthorizedScopeForCaller: (
    store: ServerStore,
    caller: AuthCallerContext,
  ) => AuthorizedScope;
  filterStoreForCaller: (store: ServerStore, caller: AuthCallerContext) => any;
}

export interface CommandRoutesDeps {
  api: WrappedApi;
  sharedStore: ServerStore;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  filterStoreForCaller: (store: ServerStore, caller: AuthCallerContext) => any;
}

export interface PlatformReadRoutesDeps {
  api: WrappedApi;
  wrap: WrapFn;
  repository: StateRepository;
  sharedStore: ServerStore;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  assertOnboarded: AssertOnboardedFn;
  getAuthorizedScopeForCaller: (
    store: ServerStore,
    caller: AuthCallerContext,
  ) => AuthorizedScope;
  hasConfiguredSessionSecret: boolean;
  firebaseApiKey: string | undefined;
}

export function registerStateAndVoteRoutes(
  _app: express.Express,
  deps: StateAndVoteRoutesDeps,
) {
  const {
    api,
    sharedStore,
    extractAndVerifyCaller,
    assertOnboarded,
    getAuthorizedScopeForCaller,
    filterStoreForCaller,
  } = deps;

  const CastVoteBodySchema = z.object({
    agId: z.string().min(1).max(200),
    resolutionId: z.string().min(1).max(200),
    choice: z.enum(["for", "against", "abstain"]),
    residentId: z.string().max(200).optional(),
    apartmentId: z.string().max(200).optional(),
    comment: z.string().max(1000).optional(),
    allowOverrideResidentVote: z.boolean().optional(),
  });

  api.post("/api/ag/vote", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    assertOnboarded(caller, sharedStore);
    const parsedBody = CastVoteBodySchema.safeParse(req.body);
    if (!parsedBody.success)
      return res.status(400).json({ error: "Paramètres de vote invalides." });
    const body = parsedBody.data;
    const list: AssembleeGenerale[] = sharedStore.syndik_prod_ag_v1 || [];
    const index = list.findIndex((a) => a.id === body.agId);
    const ag = list[index];
    const scope = getAuthorizedScopeForCaller(sharedStore, caller);
    if (
      !ag ||
      (!scope.isAdmin && !scope.authorizedBuildingIds.has(ag.buildingId))
    )
      return res.status(403).json({ error: "Accès refusé." });
    const residentId =
      caller.role === "resident"
        ? scope.callerResId
        : ["admin", "syndic"].includes(caller.role)
          ? String(body.residentId || "")
          : "";
    if (
      !residentId ||
      (caller.role === "resident" &&
        body.residentId &&
        body.residentId !== residentId)
    ) {
      return res
        .status(403)
        .json({ error: "Identité du votant non autorisée." });
    }
    const cabinet = (sharedStore.syndik_prod_syndics_v1 || []).find((s: any) =>
      (s.buildings || []).some((b: Building) => b.id === ag.buildingId),
    );
    const building: Building | undefined = cabinet?.buildings?.find(
      (b: Building) => b.id === ag.buildingId,
    );
    if (!building)
      return res.status(404).json({ error: "Immeuble introuvable." });
    try {
      canWrite(caller, {
        ...building,
        syndicId: building.syndicId || cabinet?.id,
      });
      const result = applyResidentVote(
        ag,
        ag.votingSnapshot || building,
        residentId,
        body.resolutionId,
        body.choice,
        body.apartmentId || undefined,
        body.comment,
        {
          actorRole: caller.role as "resident" | "syndic" | "admin",
          actorUid: caller.uid,
          allowOverrideResidentVote: Boolean(body.allowOverrideResidentVote),
        },
      );
      recomputeMeeting(result);
      appendAudit(sharedStore, caller, "castResidentAGVote", building.id, {
        agId: ag.id,
        resolutionId: body.resolutionId,
        residentId,
        apartmentId: body.apartmentId || undefined,
      });
      list[index] = result;
      sharedStore.syndik_prod_ag_v1 = list;

      return res.json({
        ag: projectAssemblyForRole(
          result,
          caller.role,
          caller.role === "resident" ? scope.callerResId : undefined,
        ),
        revision: sharedStore.__revision,
      });
    } catch (error) {
      return res
        .status(error instanceof OperationError ? error.status : 400)
        .json({
          error: error instanceof Error ? error.message : "Vote invalide.",
        });
    }
  });

  // Audit Item 02: Authenticated shared-state GET with ETag & sinceRevision delta sync
  api.get("/api/shared-state", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller) {
      return res
        .status(401)
        .json({ ok: false, error: "Unauthorized: authentication required" });
    }
    assertOnboarded(caller, sharedStore);
    const currentRevision = Number(sharedStore.__revision) || 0;
    const etag = `"rev-${currentRevision}-${caller.uid}"`;
    res.setHeader("ETag", etag);

    const sinceRev = Number(req.query.sinceRevision || 0);
    const ifNoneMatch = req.headers["if-none-match"];
    if (
      (sinceRev > 0 && sinceRev === currentRevision) ||
      ifNoneMatch === etag
    ) {
      return res.json({
        ok: true,
        unchanged: true,
        revision: currentRevision,
      });
    }

    const key = req.query.key as string | undefined;
    const scopedStore = filterStoreForCaller(sharedStore, caller);
    if (key) {
      return res.json({
        ok: true,
        revision: currentRevision,
        key,
        value: scopedStore[key] ?? null,
      });
    }
    return res.json({
      ok: true,
      revision: currentRevision,
      store: scopedStore,
    });
  });
}

export function registerCommandRoutes(
  _app: express.Express,
  deps: CommandRoutesDeps,
) {
  const { api, sharedStore, extractAndVerifyCaller, filterStoreForCaller } =
    deps;

  api.post("/api/operations/status", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    const result = readOperationStatus(
      sharedStore,
      caller,
      req.body?.operationId,
    );
    return res.json({
      ok: true,
      ...result,
      ...(result.status === "completed"
        ? {
            store: filterStoreForCaller(sharedStore, caller),
            revision: sharedStore.__revision || 0,
          }
        : {}),
    });
  });
  api.post("/api/commands", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    const command = CommandIdentitySchema.safeParse(req.body as unknown);
    if (!command.success)
      return res.status(400).json({ error: "Opération invalide." });
    const { operation, args, operationId } = command.data;
    const fingerprint = crypto
        .createHash("sha256")
        .update(JSON.stringify({ operation, args }))
        .digest("hex"),
      key = `${caller.uid}:${operationId}`,
      receipts = (sharedStore.__operations ??= {});
    if (receipts[key]) {
      if (receipts[key].fingerprint !== fingerprint)
        return res.status(409).json({
          error: "Identifiant déjà utilisé pour une autre opération.",
        });
      receipts[key].lastAccessAt = new Date().toISOString();
      if (receipts[key].identityMutationId)
        resumeQueuedIdentityMutation(
          sharedStore,
          receipts[key].identityMutationId,
        );
      return res.json({
        ok: true,
        ...JSON.parse(
          receipts[key].encryptedResponse
            ? decrypt(receipts[key].encryptedResponse)
            : receipts[key].responseJson,
        ),
        store: filterStoreForCaller(sharedStore, caller),
        revision: sharedStore.__revision || 0,
      });
    }
    assertFreshOperationId(sharedStore, operationId);
    if (!CommandEnvelopeSchema.safeParse(command.data).success)
      return res.status(400).json({ error: "Opération invalide." });
    const firebaseBefore = new Map(
      identityAccounts(sharedStore)
        .filter((a) => a.firebaseUid)
        .map((a) => [
          accountUid(a),
          {
            firebaseUid: a.firebaseUid,
            email: a.email,
            accountsJson: JSON.stringify(
              identityAccounts(sharedStore).filter(
                (x) => accountUid(x) === accountUid(a),
              ),
            ),
          },
        ]),
    );
    const result = await runOperation(
      caller,
      operation,
      args,
      operationId,
      res.locals.transactionState,
    );
    for (const [uid, before] of firebaseBefore) {
      const accounts = identityAccounts(sharedStore).filter(
        (a) => accountUid(a) === uid,
      );
      if (JSON.stringify(accounts) !== before.accountsJson)
        assertIdentityReady(sharedStore, uid);
      if (
        accounts.some(
          (a) => a.email?.toLowerCase() !== before.email?.toLowerCase(),
        )
      )
        throw new OperationError(
          "L’adresse liée à Firebase doit être modifiée par une procédure de vérification email.",
          409,
        );
      const secret =
        result?.generatedPassword ||
        result?.invitationCode ||
        result?.invitationToken;
      if (
        accounts.some((a) => a.passwordHash) &&
        secret &&
        accounts.some((a) => verifyPassword(secret, a.passwordHash, a.email))
      ) {
        planFirebasePassword(
          sharedStore,
          uid,
          before.firebaseUid,
          before.email,
          secret,
        );
      }
      for (const a of accounts) {
        a.firebaseUid = before.firebaseUid;
        delete a.password;
        delete a.passwordHash;
      }
    }
    const resultMeta = Array.isArray(result)
        ? Object.fromEntries(
            Object.entries(result).filter(([k]) => !/^\d+$/.test(k)),
          )
        : undefined,
      responseJson = JSON.stringify({ operation, result, resultMeta });
    // Invitation secrets are returned once and kept encrypted in retry receipts.
    for (const cabinet of sharedStore.syndik_prod_syndics_v1 || [])
      for (const building of cabinet.buildings || [])
        for (const resident of building.residents || []) {
          delete resident.invitationCode;
          delete resident.invitationToken;
        }
    for (const provider of sharedStore.syndik_prod_prestataires_v1 || []) {
      delete provider.invitationCode;
      delete provider.invitationToken;
    }
    receipts[key] = {
      operation,
      actorScope: operationActorScope(caller),
      fingerprint,
      identityMutationId: pendingIdentityPlanId(),
      encryptedResponse: encrypt(responseJson),
      createdAt: new Date().toISOString(),
    };
    return res.json({
      ok: true,
      ...JSON.parse(responseJson),
      store: filterStoreForCaller(sharedStore, caller),
      revision: sharedStore.__revision || 0,
    });
  });
}

export function registerPlatformReadRoutes(
  app: express.Express,
  deps: PlatformReadRoutesDeps,
) {
  const {
    api,
    wrap,
    repository,
    sharedStore,
    extractAndVerifyCaller,
    assertOnboarded,
    getAuthorizedScopeForCaller,
    hasConfiguredSessionSecret,
    firebaseApiKey,
  } = deps;

  let readyCache: { revision: number; expiresAt: number } | undefined;

  api.get("/api/reports", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller)
      return res.status(401).json({ error: "Authentification requise." });
    assertOnboarded(caller, sharedStore);
    return res.json(
      buildingReport(sharedStore, caller, String(req.query.buildingId || "")),
    );
  });
  api.get("/api/archives", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller || !["admin", "syndic"].includes(caller.role))
      return res.status(403).json({ error: "Accès refusé." });
    assertOnboarded(caller, sharedStore);
    const scope = getAuthorizedScopeForCaller(sharedStore, caller);
    return res.json({
      buildings: scope.authorizedSyndics.flatMap((s: any) =>
        (s.buildings || [])
          .filter((b: any) => b.archivedAt)
          .map((b: any) => ({
            id: b.id,
            name: b.name,
            archivedAt: b.archivedAt,
          })),
      ),
    });
  });
  app.get(
    "/api/ready",
    wrap(async (_req, res) => {
      const now = Date.now();
      let revision: number;
      if (readyCache && readyCache.expiresAt > now) {
        revision = readyCache.revision;
      } else {
        revision = repository.readRevision
          ? await repository.readRevision()
          : await repository.transaction(
              async (s) => Number(s.__revision) || 0,
            );
        readyCache = { revision, expiresAt: now + 2000 };
      }
      return res.json({
        status: "ready",
        revision,
        runtimeRevision: process.env.K_REVISION || "local",
        checks: { databaseRead: "ok", storageWrite: "not_checked" },
      });
    }, false),
  );
  api.get("/api/diagnostics", async (req, res) => {
    const caller = await extractAndVerifyCaller(req, sharedStore);
    if (!caller || !["admin", "syndic"].includes(caller.role))
      return res.status(403).json({ error: "Accès réservé au gestionnaire." });
    assertOnboarded(caller, sharedStore);
    return res.json({
      revision: process.env.K_REVISION || "local",
      database: {
        backend:
          process.env.SYNDIK_STATE_BACKEND ||
          (process.env.NODE_ENV === "production" ? "firestore" : "file"),
        id: process.env.FIRESTORE_DATABASE_ID,
        read: "ok",
      },
      storage: {
        backend:
          process.env.NODE_ENV === "production" ||
          process.env.SYNDIK_UPLOAD_BACKEND === "gcs"
            ? "gcs"
            : "file",
        bucket: process.env.SYNDIK_UPLOAD_BUCKET,
        write: "not_checked",
      },
      sessionSecretConfigured: hasConfiguredSessionSecret,
      authenticationProvider: usesFirebaseAuth() ? "firebase" : "legacy",
      accountEmailProvider: usesFirebaseAuth() ? "firebase" : "sendgrid",
      firebaseAuthentication: {
        configured: Boolean(process.env.FIREBASE_API_KEY || firebaseApiKey),
        liveCheck: "not_checked",
      },
      transactionalMailConfigured: mailIsConfigured(),
      warnings: hasConfiguredSessionSecret
        ? []
        : ["SESSION_SECRET_NOT_CONFIGURED"],
    });
  });
}

export function registerSharedStateGuardRoutes(
  app: express.Express,
  _deps: Record<string, never> = {},
) {
  app.post("/api/shared-state", (_req, res) =>
    res.status(403).json({
      error:
        "Les écritures globales sont désactivées. Utilisez les opérations serveur.",
    }),
  );
  app.post("/api/shared-state/reset", (_req, res) =>
    res.status(403).json({ error: "La remise à zéro web est désactivée." }),
  );
}
