import { getAuthenticatedRequestHeaders } from '../utils/security';
import { AI_LIMITS } from '../utils/aiPolicy';

export const generateAnnouncementContent = async (topic: string, buildingId: string): Promise<string> => {
  const trimmedTopic = topic.trim();
  if (!trimmedTopic) {
    throw new Error('Veuillez saisir un sujet pour générer l’annonce.');
  }
  if (topic.length > AI_LIMITS.topicCharacters) throw new Error('Le sujet est limité à 2 000 caractères.');

  const response = await fetch('/api/ai/announcement', {
    method: 'POST',
    headers: getAuthenticatedRequestHeaders(),
    body: JSON.stringify({ topic: trimmedTopic, buildingId }),
  });

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
