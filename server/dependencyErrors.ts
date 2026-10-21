/** Safe public failures; SDK details belong only in the request's server log. */
export class DependencyError extends Error {
  readonly status = 503;
  constructor(
    public readonly dependency: 'database' | 'storage',
    public readonly reason: 'access' | 'missing' | 'unavailable',
    public readonly cause: unknown,
  ) {
    super(dependency === 'storage'
      ? 'Le stockage des pièces jointes est indisponible. Votre saisie est conservée. Contactez le gestionnaire.'
      : 'La base de données est indisponible. Votre saisie est conservée. Réessayez dans un instant ou contactez le gestionnaire.');
  }
  get code() { return `${this.dependency.toUpperCase()}_${this.reason.toUpperCase()}`; }
}

export function dependencyFailure(dependency: 'database' | 'storage', cause: any) {
  const code = Number(cause?.code || cause?.statusCode);
  const reason = [7, 16, 401, 403].includes(code) ? 'access'
    : [5, 404].includes(code) ? 'missing' : 'unavailable';
  return new DependencyError(dependency, reason, cause);
}
