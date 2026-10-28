/** Retry inside the invocation: Scheduler's Pub/Sub publish retry does not retry consumer failures. */
export async function retryMonthlyBilling<T>(request: (retryRunId?: string) => Promise<T>,
  log: (error: unknown) => void, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<T> {
  let retryRunId: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { return await request(retryRunId); }
    catch (error: any) {
      log(error);
      if (error.details?.retryable === false || attempt === 3) throw error;
      // A summary permits retrying only failed transient buildings. A lost response
      // safely replays the same period using the existing per-lot billing identity.
      retryRunId = error.details?.runId;
      await wait(5000 * 2 ** (attempt - 1));
    }
  }
  throw new Error('Monthly billing retries exhausted');
}
