import { getAuthenticatedRequestHeaders } from '../utils/security';

export const generateAnnouncementContent = async (topic: string): Promise<string> => {
  const trimmedTopic = topic.trim();
  if (!trimmedTopic) {
    throw new Error('Veuillez saisir un sujet pour générer l’annonce.');
  }

  const response = await fetch('/api/ai/announcement', {
    method: 'POST',
    headers: getAuthenticatedRequestHeaders(),
    body: JSON.stringify({ topic: trimmedTopic }),
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