import crypto from "crypto";
import type express from "express";
import { privateAttachments } from "../attachments";
import {
  actorIdentity,
  buildingFor,
  canWrite,
  OperationError,
} from "../operations";
import type { StateRepository } from "../repository";
import { readPrivateFile, savePrivateFile } from "../uploads";
import type {
  AssertOnboardedFn,
  ExtractAndVerifyCallerFn,
  WrapFn,
} from "./types";

export interface UploadsRoutesDeps {
  wrap: WrapFn;
  repository: StateRepository;
  extractAndVerifyCaller: ExtractAndVerifyCallerFn;
  assertOnboarded: AssertOnboardedFn;
  uploadsDir: string;
}

export function registerUploadsRoutes(
  app: express.Express,
  deps: UploadsRoutesDeps,
) {
  const {
    wrap,
    repository,
    extractAndVerifyCaller,
    assertOnboarded,
    uploadsDir,
  } = deps;

  const decodeValidatedUploadBytes = (dataUrlRaw: unknown) => {
    const match = String(dataUrlRaw || "").match(
      /^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/,
    );
    if (!match) return null;
    const bytes = Buffer.from(match[2], "base64"),
      mime = match[1];
    if (bytes.length > 5 * 1048576) {
      throw new OperationError("Fichier limité à 5 Mo.", 413);
    }
    const valid =
      mime === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : mime === "image/png"
          ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
          : mime === "image/jpeg"
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : mime === "image/webp"
              ? bytes.subarray(0, 4).toString() === "RIFF" &&
                bytes.subarray(8, 12).toString() === "WEBP"
              : false;
    if (!valid) {
      throw new OperationError(
        "Format accepté : PDF, PNG, JPEG ou WebP.",
        400,
      );
    }
    return { bytes, mime };
  };

  // Binary Document & Receipt Offload Endpoints (/api/uploads) with building-scoped auth (Audit P1-5)
  app.post(
    "/api/uploads",
    wrap(async (req, res) => {
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller)
          throw new OperationError("Authentification requise.", 401);
        assertOnboarded(caller, state);
        const buildingId = String(req.body?.buildingId || caller.buildingId || ""),
          b = buildingFor(caller, buildingId, false);
        canWrite(caller, b);
        const decoded = decodeValidatedUploadBytes(req.body?.dataUrl);
        if (!decoded) throw new OperationError("Fichier invalide.", 400);
        const { bytes, mime } = decoded;
        const fileId = crypto
            .createHash("sha256")
            .update(`${buildingId}:${caller.uid}:`)
            .update(bytes)
            .digest("hex"),
          key = `private/${buildingId}/${fileId}`;
        if (state.__files?.[fileId]?.lifecycle === "deleting")
          throw new OperationError(
            "Fichier en cours de suppression. Réessayez dans un instant.",
            409,
          );
        return { caller, buildingId, fileId, key, bytes, mime };
      });

      await savePrivateFile(
        uploadsDir,
        preflight.fileId,
        preflight.key,
        preflight.bytes,
        preflight.mime,
      );

      await repository.transaction(async (state) => {
        if (state.__files?.[preflight.fileId]?.lifecycle === "deleting")
          throw new OperationError(
            "Fichier en cours de suppression. Réessayez dans un instant.",
            409,
          );
        (state.__files ??= {})[preflight.fileId] = {
          fileId: preflight.fileId,
          key: preflight.key,
          mimeType: preflight.mime,
          buildingId: preflight.buildingId,
          uploadedBy: preflight.caller.uid,
          name: String(req.body?.name || "document").slice(0, 200),
          sizeBytes: preflight.bytes.length,
          createdAt:
            state.__files?.[preflight.fileId]?.createdAt ||
            new Date().toISOString(),
          lastUploadedAt: new Date().toISOString(),
        };
      });

      return res.json({
        ok: true,
        fileId: preflight.fileId,
        url: `/api/uploads/${preflight.fileId}`,
        mimeType: preflight.mime,
        sizeBytes: preflight.bytes.length,
      });
    }, false),
  );

  app.post(
    "/api/subscription/upload-proof",
    wrap(async (req, res) => {
      const preflight = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller)
          throw new OperationError("Authentification requise.", 401);
        if (!["admin", "syndic"].includes(caller.role))
          throw new OperationError("Opération réservée au syndic.", 403);
        assertOnboarded(caller, state);

        const requestedSyndicId = String(
          req.body?.syndicId || caller.syndicId || "",
        ).trim();
        const syndics = state.syndik_prod_syndics_v1 || [];
        const s = syndics.find((cab: any) =>
          requestedSyndicId
            ? cab.id === requestedSyndicId
            : cab.createdBy === caller.uid || caller.syndicId === cab.id,
        );
        if (
          !s ||
          (caller.role !== "admin" &&
            s.createdBy !== caller.uid &&
            caller.syndicId !== s.id)
        ) {
          throw new OperationError("Cabinet non autorisé.", 403);
        }
        if (s.archivedAt) {
          throw new OperationError(
            "Cabinet archivé : impossible de téléverser un justificatif.",
            409,
          );
        }
        if (caller.role !== "admin" && s.subscriptionStatus === "cancelled") {
          throw new OperationError(
            "Votre compte est suspendu. Contactez l'administration.",
            403,
          );
        }

        const decoded = decodeValidatedUploadBytes(req.body?.dataUrl);
        if (!decoded) throw new OperationError("Fichier invalide.", 400);
        const { bytes, mime } = decoded;
        const fileId = crypto
            .createHash("sha256")
            .update(`sub:${s.id}:${caller.uid}:`)
            .update(bytes)
            .digest("hex"),
          key = `private/subscription-${s.id}/${fileId}`;
        if (state.__files?.[fileId]?.lifecycle === "deleting")
          throw new OperationError(
            "Fichier en cours de suppression. Réessayez dans un instant.",
            409,
          );
        return { caller, syndicId: s.id as string, fileId, key, bytes, mime };
      });

      await savePrivateFile(
        uploadsDir,
        preflight.fileId,
        preflight.key,
        preflight.bytes,
        preflight.mime,
      );

      await repository.transaction(async (state) => {
        if (state.__files?.[preflight.fileId]?.lifecycle === "deleting")
          throw new OperationError(
            "Fichier en cours de suppression. Réessayez dans un instant.",
            409,
          );
        (state.__files ??= {})[preflight.fileId] = {
          fileId: preflight.fileId,
          key: preflight.key,
          mimeType: preflight.mime,
          scope: "subscription",
          syndicId: preflight.syndicId,
          uploadedBy: preflight.caller.uid,
          name: String(req.body?.name || "justificatif-virement").slice(0, 200),
          sizeBytes: preflight.bytes.length,
          createdAt:
            state.__files?.[preflight.fileId]?.createdAt ||
            new Date().toISOString(),
          lastUploadedAt: new Date().toISOString(),
        };
      });

      return res.json({
        ok: true,
        fileId: preflight.fileId,
        url: `/api/uploads/${preflight.fileId}`,
        mimeType: preflight.mime,
        sizeBytes: preflight.bytes.length,
      });
    }, false),
  );

  app.get(
    "/api/uploads/:fileId",
    wrap(async (req, res) => {
      const id = String(req.params.fileId);
      const authorized = await repository.transaction(async (state) => {
        const caller = await extractAndVerifyCaller(req, state);
        if (!caller)
          throw new OperationError("Authentification requise.", 401);
        assertOnboarded(caller, state);
        const meta = state.__files?.[id];
        if (!meta || meta.deletedAt) throw new OperationError("Fichier introuvable.", 404);
        if (meta.scope === "subscription") {
          const ownerSyndic =
            caller.role === "syndic" &&
            (state.syndik_prod_syndics_v1 || []).some(
              (s: any) =>
                s.id === meta.syndicId &&
                (s.createdBy === caller.uid || caller.syndicId === s.id),
            );
          if (
            caller.role !== "admin" &&
            meta.uploadedBy !== caller.uid &&
            !ownerSyndic
          ) {
            throw new OperationError("Fichier privé.", 403);
          }
          return { key: meta.key as string, mimeType: meta.mimeType as string };
        }
        const b = buildingFor(caller, meta.buildingId, false),
          callerResidentRec =
            caller.role === "resident"
              ? (b.residents || []).find(
                  (r: any) =>
                    !r.archivedAt &&
                    (r.id === actorIdentity(caller) || r.id === caller.uid),
                )
              : undefined,
          publicDocument =
            caller.role !== "provider" &&
            (b.documents || []).some((d: any) => {
              if (d.url !== `/api/uploads/${id}`) return false;
              const vis = d.visibility || "all";
              if (vis === "syndic_only") return false;
              if (vis === "owners_only") return callerResidentRec?.isOwner === true;
              return true;
            }),
          marketImage =
            caller.role !== "provider" &&
            (state.syndik_prod_marketplace_v1 || []).some(
              (m: any) =>
                m.buildingId === b.id &&
                (m.imageUrl === `/api/uploads/${id}` ||
                  m.images?.includes(`/api/uploads/${id}`)),
            ),
          assigned = (state.syndik_prod_maintenance_v1 || []).some(
            (m: any) =>
              m.buildingId === b.id &&
              ((caller.role === "provider" &&
                caller.prestataireId &&
                [m.prestataireId, m.assignedTo].includes(
                  caller.prestataireId,
                )) ||
                (caller.role === "resident" &&
                  caller.residentId &&
                  m.residentId === caller.residentId)) &&
              privateAttachments(m).has(`/api/uploads/${id}`),
          ),
          sharedInChat =
            caller.role !== "provider" &&
            (state.syndik_prod_chat_v1 || []).some(
              (m: any) =>
                m.buildingId === b.id &&
                m.attachmentUrl === `/api/uploads/${id}` &&
                (!m.recipientId ||
                  [m.senderId, m.recipientId].includes(actorIdentity(caller))),
            );
        if (
          !["admin", "syndic"].includes(caller.role) &&
          meta.uploadedBy !== caller.uid &&
          !publicDocument &&
          !marketImage &&
          !assigned &&
          !sharedInChat
        ) {
          throw new OperationError("Fichier privé.", 403);
        }
        return { key: meta.key as string, mimeType: meta.mimeType as string };
      });

      const bytes = await readPrivateFile(uploadsDir, id, authorized.key);
      res.setHeader("Content-Type", authorized.mimeType);
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(bytes);
    }, false),
  );
}
