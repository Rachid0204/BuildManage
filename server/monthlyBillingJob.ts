import type { Request, Response } from 'express';
import { z } from 'zod';
import type { StateRepository } from './repository';
import { generateScheduledMonthlyCharges, monthlyBillingHttpStatus } from './operations';

export function monthlyBillingJob(repository: StateRepository, authorized: (req: Request) => boolean) {
  return async (req: Request, res: Response) => {
    if (!authorized(req)) return res.status(403).json({ error: 'Ordonnanceur non autorisé.' });
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
    const period = `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
    const result = await generateScheduledMonthlyCharges(repository, req.body.period ?? period, String(res.getHeader('X-Request-ID') || ''),
      { retryRunId: req.body.retryRunId === undefined ? undefined : z.string().uuid().parse(req.body.retryRunId) });
    return res.status(monthlyBillingHttpStatus(result)).json(result);
  };
}
