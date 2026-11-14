import { getAuthenticatedRequestHeaders } from '../utils/security';
import { AI_LIMITS } from '../utils/aiPolicy';

export const generateAnnouncementContent = async (topic: string, buildingId: string): Promise<string> => {
  const trimmedTopic = topic.trim();
  if (!trimmedTopic) {
    throw new Error('Veuillez saisir un sujet pour générer l’annonce.');
  }
  if (trimmedTopic.length > AI_LIMITS.topicCharacters) throw new Error('Le sujet est limité à 2 000 caractères.');

  const response = await fetch('/api/ai/announcement', {
    method: 'POST',
    headers: getAuthenticatedRequestHeaders(),
    body: JSON.stringify({ topic: trimmedTopic, buildingId }),
    signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(30000)
      : undefined,
  });

  if (response.status === 401 || response.status === 403) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('syndik-session-invalid', { detail: { status: response.status } }));
    }
    throw new Error('Votre session a expiré. Veuillez vous reconnecter.');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Le service IA est temporairement indisponible.');
  }

  const data = await response.json();
  if (!response.ok || !data?.ok || !data?.content) {
    throw new Error(
      data?.error || 'Impossible de générer le brouillon avec l’IA. Veuillez rédiger manuellement.'
    );
  }

  return String(data.content);
};
