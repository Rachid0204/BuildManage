const controllers = new Set<AbortController>();
export function abortMutationRequests() { for (const controller of controllers) controller.abort(); controllers.clear(); }
/** Deadline covers response-body parsing as well as the initial headers. */
export async function withRequestDeadline<T>(url: string, init: RequestInit,
  consume: (response: Response) => Promise<T>, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  controllers.add(controller);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await consume(await fetch(url, { ...init, signal: controller.signal })); }
  finally { clearTimeout(timeout); controllers.delete(controller); }
}
