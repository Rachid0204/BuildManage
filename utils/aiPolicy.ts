/** Shared public input limits; consumption is enforced only by the server. */
export const AI_LIMITS = {
  topicCharacters: 2000,
  announcementBodyBytes: 16 * 1024,
  proofBodyBytes: 3 * 1024 * 1024,
  imageBytes: 2 * 1024 * 1024,
  providerResponseBytes: 64 * 1024,
  outputTokens: 2048,
} as const;
