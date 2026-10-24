import type { Response } from 'express';
import { OperationError } from './operations';
import { AI_LIMITS } from '../utils/aiPolicy';

export function aiDeadlineMs(): number {
  const configured = Number(process.env.AI_PROCESSING_TIMEOUT_MS);
  return Number.isFinite(configured) && configured >= 1000 && configured <= 30000 ? configured : 20000;
}

/** One deadline covers admission, upstream headers, body streaming and decoding. */
export async function withAiDeadline<T>(response: Response, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new OperationError('Le traitement IA a dépassé le délai autorisé.', 504, 'AI_TIMEOUT')), aiDeadlineMs());
  const disconnect = () => controller.abort(new OperationError('Requête interrompue.', 499, 'AI_CLIENT_CLOSED'));
  response.once('close', disconnect);
  const stopped = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }));
  try {
    if (response.destroyed) disconnect();
    return await Promise.race([run(controller.signal), stopped]);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof OperationError) throw error;
    throw new OperationError('Le service IA est temporairement indisponible.', 502, 'AI_UPSTREAM_FAILED');
  } finally {
    clearTimeout(timer); response.off('close', disconnect);
  }
}

/** Native fetch keeps the actual provider connection cancellable on timeout/disconnect. */
export async function generateAiText(apiKey: string, parts: unknown[], signal: AbortSignal): Promise<string> {
  const result = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { maxOutputTokens: AI_LIMITS.outputTokens } }),
  });
  if (!result.ok) { await result.body?.cancel(); throw new OperationError('Échec du traitement par le service IA.', 502, 'AI_UPSTREAM_FAILED'); }
  if (Number(result.headers.get('Content-Length')) > AI_LIMITS.providerResponseBytes) {
    await result.body?.cancel(); throw new OperationError('Réponse IA trop volumineuse.', 502, 'AI_RESPONSE_TOO_LARGE');
  }
  const reader = result.body?.getReader();
  if (!reader) throw new OperationError('Réponse IA vide.', 502, 'AI_EMPTY_RESPONSE');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > AI_LIMITS.providerResponseBytes) { await reader.cancel(); throw new OperationError('Réponse IA trop volumineuse.', 502, 'AI_RESPONSE_TOO_LARGE'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const text = (payload.candidates?.[0]?.content?.parts || [])
    .filter((part: any) => !part.thought && typeof part.text === 'string').map((part: any) => part.text).join('').trim();
  if (!text) throw new OperationError('Le modèle IA n’a retourné aucun contenu.', 502, 'AI_EMPTY_RESPONSE');
  return text;
}
