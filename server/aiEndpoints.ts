import express, { type Express, type Request, type RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import type { State, StateRepository } from './repository';
import { buildingFor, canWrite, OperationError, type Actor } from './operations';
import { subscriptionCanWrite } from '../utils/subscriptionPolicy';
import { AI_LIMITS } from '../utils/aiPolicy';
import { aiDeadlineMs, generateAiText, withAiDeadline } from './aiProvider';

const announcementPath = '/api/ai/announcement', proofPath = '/api/ai/verify-proof';
const day = 86400000;
const windows = [
  { duration: 60000, user: 5, cabinet: 20 },
  { duration: 3600000, user: 20, cabinet: 100 },
  { duration: day, user: 100, cabinet: 500 },
] as const;
class AiQuotaError extends OperationError {
  constructor(public retryAfter: number) { super('Quota de traitement IA atteint. Réessayez après le délai indiqué.', 429, 'AI_RATE_LIMITED'); }
}
function reject(condition: unknown, message: string, status = 400, code = 'AI_INVALID_REQUEST'): asserts condition {
  if (!condition) throw new OperationError(message, status, code);
}

/** Must be installed before the general JSON parser. No oversized JSON is parsed. */
export function installAiBodyParsers(app: Express) {
  for (const [route, limit] of [[announcementPath, AI_LIMITS.announcementBodyBytes], [proofPath, AI_LIMITS.proofBodyBytes]] as const) {
    const parse = express.json({ limit, inflate: false, strict: true });
    app.post(route, (req, res, next) => {
      const requestId = randomUUID();
      res.setHeader('X-Request-ID', requestId); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
      const fail = (status: number, code: string, error: string) => {
        // Return the error immediately, but drain in-flight bytes without buffering
        // so uploading clients can read it instead of receiving a broken pipe.
        if (!req.complete) {
          const drain = setTimeout(() => req.destroy(), aiDeadlineMs()); drain.unref();
          const stop = () => clearTimeout(drain); req.once('end', stop); req.once('close', stop); req.resume();
        }
        res.status(status).json({ ok: false, code, error, requestId });
      };
      if (Number(req.headers['content-length']) > limit) return fail(413, 'AI_PAYLOAD_TOO_LARGE', 'La requête dépasse la taille autorisée.');
      if (!req.is('application/json') || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity'))
        return fail(415, 'AI_UNSUPPORTED_CONTENT_TYPE', 'Envoyez un document JSON non compressé.');
      const timer = setTimeout(() => {
        if (!res.headersSent) { res.setHeader('Connection', 'close'); res.once('finish', () => req.destroy()); fail(408, 'AI_BODY_TIMEOUT', 'Délai de réception dépassé.'); }
      }, aiDeadlineMs());
      const stop = () => clearTimeout(timer); req.once('aborted', stop); res.once('close', stop);
      parse(req, res, (error?: any) => {
        stop(); req.off('aborted', stop); res.off('close', stop);
        if (res.headersSent || res.destroyed) return;
        if (error) return fail(error.status === 413 ? 413 : 400, error.status === 413 ? 'AI_PAYLOAD_TOO_LARGE' : 'AI_INVALID_JSON',
          error.status === 413 ? 'La requête dépasse la taille autorisée.' : 'Document JSON invalide.');
        next();
      });
    });
  }
}

function imageInput(value: unknown) {
  reject(typeof value === 'string', 'Une image de justificatif est requise.');
  // Bound encoded bytes before decoding; canonical base64 cannot conceal ignored junk.
  if (value.length > Math.ceil(AI_LIMITS.imageBytes / 3) * 4 + 64)
    throw new OperationError('Image limitée à 2 Mio.', 413, 'AI_PAYLOAD_TOO_LARGE');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  reject(match, 'Image acceptée : PNG, JPEG ou WebP encodé en base64.', 415, 'AI_INVALID_IMAGE');
  const bytes = Buffer.from(match[2], 'base64');
  reject(bytes.toString('base64') === match[2], 'Encodage base64 invalide.');
  if (bytes.length > AI_LIMITS.imageBytes) throw new OperationError('Image limitée à 2 Mio.', 413, 'AI_PAYLOAD_TOO_LARGE');
  const mimeType = match[1];
  const valid = mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  reject(valid, 'Le contenu de l’image ne correspond pas à son format.', 415, 'AI_INVALID_IMAGE');
  return { mimeType, data: match[2] };
}

function consume(state: State, userId: string, cabinetId: string, now = Date.now()) {
  const usage: Record<string, number[]> = state.__aiUsage_v1 ??= {};
  for (const [key, timestamps] of Object.entries(usage)) {
    usage[key] = timestamps.filter(at => Number.isFinite(at) && at > now - day);
    if (!usage[key].length) delete usage[key];
  }
  const keys = [`user:${userId}`, `cabinet:${cabinetId}`];
  let retryAfter = 0;
  for (const [index, key] of keys.entries()) for (const window of windows) {
    const active = (usage[key] || []).filter(at => at > now - window.duration).sort((a, b) => a - b);
    const limit = index === 0 ? window.user : window.cabinet;
    if (active.length >= limit) retryAfter = Math.max(retryAfter, Math.ceil((active[active.length - limit] + window.duration - now) / 1000));
  }
  if (retryAfter) throw new AiQuotaError(Math.max(1, retryAfter));
  for (const key of keys) (usage[key] ??= []).push(now);
}

function reference(value: unknown, name: string): string {
  reject(typeof value === 'string' && value.length > 0 && value.length <= 200, `${name} est requis.`);
  return value;
}
function readyCabinet(state: State, caller: Actor, buildingId: string) {
  const building = buildingFor(caller, buildingId, false);
  canWrite(caller, building);
  const cabinet = (state.syndik_prod_syndics_v1 || []).find((s: any) => s.id === building.syndicId);
  reject(cabinet && !cabinet.archivedAt, 'Cabinet indisponible.', 409);
  // Paid AI capacity is tenant-scoped, including when a platform admin requests it.
  reject(subscriptionCanWrite(cabinet), 'Un abonnement actif est requis pour le traitement IA.', 402, 'AI_SUBSCRIPTION_REQUIRED');
  return { building, cabinet };
}

function proofScope(state: State, caller: Actor, body: any) {
  const manager = ['syndic', 'admin'].includes(caller.role);
  reject(manager || caller.role === 'resident', 'Cette fonctionnalité n’est pas autorisée pour votre rôle.', 403, 'AI_FORBIDDEN');
  reject(!manager || body.proofId, 'Un justificatif en attente est requis pour cette vérification.');
  const proof = body.proofId === undefined ? undefined : (state.syndik_prod_proofs_v1 || []).find((p: any) => p.id === reference(body.proofId, 'proofId'));
  if (body.proofId !== undefined) reject(proof, 'Justificatif introuvable.', 404);
  const chargeId = proof?.chargeId || reference(body.chargeId, 'chargeId');
  reject(!proof || body.chargeId === undefined || body.chargeId === chargeId, 'Charge non liée au justificatif.', 403);
  const charge = (state.syndik_prod_charges_v1 || []).find((c: any) => c.id === chargeId);
  reject(charge, 'Charge introuvable.', 404);
  const { building, cabinet } = readyCabinet(state, caller, charge.buildingId);
  reject(!charge.syndicId || charge.syndicId === cabinet.id, 'Charge non liée à ce cabinet.', 403);
  const lot = (building.apartments || []).find((a: any) => a.id === charge.apartmentId && !a.archivedAt);
  reject(lot, 'Lot introuvable.', 404);
  if (!manager) {
    const id = caller.residentId || caller.uid.replace(/^(user-res-|res-)/, '');
    reject(charge.residentId === id && (building.residents || []).some((r: any) => r.id === id && !r.archivedAt) &&
      [lot.ownerId, lot.tenantId].includes(id), 'Ce justificatif ne concerne pas votre lot.', 403, 'AI_FORBIDDEN');
  }
  reject((body.buildingId === undefined || body.buildingId === building.id) &&
    (body.apartmentId === undefined || body.apartmentId === lot.id), 'Contexte de lot non autorisé.', 403, 'AI_FORBIDDEN');
  const outstanding = Math.round((Number(charge.amount) - Number(charge.paidAmount || 0)) * 100) / 100;
  reject(Number.isFinite(outstanding) && outstanding > 0 && charge.status !== 'paid', 'Cette charge est déjà réglée.', 409);
  if (proof) {
    reject(proof.buildingId === building.id && (!proof.syndicId || proof.syndicId === cabinet.id) && proof.residentId === charge.residentId &&
      (!proof.apartmentId || proof.apartmentId === lot.id), 'Justificatif non lié à cette charge.', 403);
    reject(proof.status === 'pending', 'Le justificatif n’est plus en attente.', 409, 'AI_PROOF_NOT_PENDING');
    reject(Number.isFinite(proof.amount) && proof.amount > 0 && proof.amount <= outstanding, 'Montant du justificatif invalide.', 409);
  }
  return { cabinetId: cabinet.id, amount: proof?.amount ?? outstanding,
    reference: proof?.referenceNumber, bank: proof?.bankName, image: imageInput(body.imageBase64) };
}

export function registerAiEndpoints(api: { post: (route: string, handler: RequestHandler) => unknown }, repository: StateRepository,
  authenticate: (request: Request, state: State) => Promise<any>) {
  const reserveInRepository = (req: Request, kind: 'announcement' | 'proof', apiKey: string | undefined, signal: AbortSignal) => repository.transaction(async state => {
    signal.throwIfAborted();
    const caller = await authenticate(req, state);
    signal.throwIfAborted();
    reject(caller, 'Authentification requise.', 401, 'AI_AUTHENTICATION_REQUIRED');
    reject(caller.emailVerified !== false, 'Vérifiez votre adresse email avant le traitement IA.', 403, 'AI_EMAIL_VERIFICATION_REQUIRED');
    const body = req.body || {};
    if (kind === 'announcement') {
      reject(['syndic', 'admin'].includes(caller.role), 'Cette fonctionnalité est réservée au syndic ou administrateur.', 403, 'AI_FORBIDDEN');
      const { cabinet } = readyCabinet(state, caller, reference(body.buildingId, 'buildingId'));
      reject(typeof body.topic === 'string', 'Veuillez fournir un sujet pour l’annonce.');
      if (body.topic.length > AI_LIMITS.topicCharacters) throw new OperationError('Sujet limité à 2 000 caractères.', 413, 'AI_PAYLOAD_TOO_LARGE');
      const topic = body.topic.trim(); reject(topic, 'Veuillez fournir un sujet pour l’annonce.');
      reject(apiKey, 'Le service de rédaction IA n’est pas configuré.', 503, 'AI_NOT_CONFIGURED');
      consume(state, caller.uid, cabinet.id); return { topic };
    }
    const target = proofScope(state, caller, body); consume(state, caller.uid, target.cabinetId); return target;
  });
  // Avoid a local burst of competing writes to the repository revision. Other
  // instances still use the same atomic counters; provider I/O never joins this queue.
  let admissionTail: Promise<unknown> = Promise.resolve();
  const reserve = (...args: Parameters<typeof reserveInRepository>) => {
    const result = admissionTail.then(() => {
      args[3].throwIfAborted();
      return reserveInRepository(...args);
    });
    admissionTail = result.catch(() => undefined);
    return result;
  };
  const handle = (kind: 'announcement' | 'proof'): RequestHandler => async (req, res) => {
    await withAiDeadline(res, async signal => {
      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      let target: Awaited<ReturnType<typeof reserve>>;
      try { target = await reserve(req, kind, apiKey, signal); }
      catch (error) { if (error instanceof AiQuotaError) res.setHeader('Retry-After', error.retryAfter); throw error; }
      signal.throwIfAborted();
      // The short reservation has committed. No AI work or network waits hold its lock.
      if (kind === 'announcement' && 'topic' in target) {
        const topic = target.topic;
        const text = await generateAiText(apiKey!, [{ text:
          `Tu es un syndic de copropriété professionnel au Maroc (Loi 18-00). Rédige une annonce claire, polie et formelle en français pour les résidents concernant : "${topic}". Sans introduction superflue.` }], signal);
        reject(text.length <= 10000, 'Réponse IA trop longue.', 502, 'AI_RESPONSE_TOO_LARGE');
        res.json({ ok: true, content: text }); return;
      }
      if (!('image' in target)) throw new OperationError('Requête IA invalide.', 400);
      const proof = target;
      const fallback = (mode: string) => ({ ok: true, verified: false, confidence: 0, extractedAmount: proof.amount,
        extractedReference: proof.reference, extractedBank: proof.bank, mode });
      if (!apiKey) { res.json(fallback('heuristic')); return; }
      try {
        const raw = await generateAiText(apiKey, [{ inlineData: proof.image }, { text:
          `Analyse ce reçu de virement bancaire marocain. Retourne uniquement un objet JSON avec extractedAmount (nombre ou null), extractedReference (texte ou null), extractedBank (texte ou null), confidence (0 à 1). Montant attendu : ${proof.amount} MAD.` }], signal);
        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
        reject(parsed && typeof parsed === 'object' && (parsed.extractedAmount === null || (Number.isFinite(parsed.extractedAmount) && parsed.extractedAmount >= 0)) &&
          Number.isFinite(parsed.confidence) && parsed.confidence >= 0 && parsed.confidence <= 1, 'Résultat OCR invalide.', 502);
        const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 200) : undefined;
        res.json({ ok: true, verified: false, extractedAmount: parsed.extractedAmount, extractedReference: text(parsed.extractedReference),
          extractedBank: text(parsed.extractedBank), confidence: parsed.confidence, mode: 'gemini-ocr' });
      } catch (error) {
        if (signal.aborted) throw signal.reason;
        if (error instanceof OperationError && ['AI_TIMEOUT', 'AI_CLIENT_CLOSED', 'AI_RESPONSE_TOO_LARGE'].includes(error.code)) throw error;
        res.json(fallback('heuristic-fallback'));
      }
    });
  };
  api.post(announcementPath, handle('announcement')); api.post(proofPath, handle('proof'));
}
