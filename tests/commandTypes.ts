// Compile-only contracts: an accidental `any` or string-indexed dispatcher makes
// these @ts-expect-error directives fail the TypeScript gate.
import type {
  BackendCommand,
  BackendMethods,
  CommandRequest,
  CommandResponse,
} from '../shared/api/commands';
import type { remoteMutation } from '../firebase/services';

export function checkCommandTypes(send: typeof remoteMutation): void {
  void send('addAnnouncement', [
    'building',
    { title: 'Notice', content: 'Water maintenance' },
  ]);
  // @ts-expect-error Unknown operations must never enter the dispatch table.
  void send('deleteEveryCabinet', []);
  // @ts-expect-error Command arguments are correlated with the operation.
  void send('addAnnouncement', ['building', 123]);
  // @ts-expect-error Required payload fields are checked at the call site.
  void send('addAnnouncement', ['building', { title: 'Incomplete notice' }]);
  // @ts-expect-error The caller cannot select an arbitrary response type.
  void send<boolean>('addAnnouncement', [
    'building',
    { title: 'Notice', content: 'Text' },
  ]);
  const request: CommandRequest = {
    operation: 'closeFinancialPeriod',
    args: ['building', '2026-10', 'Closure'],
    operationId: 'op:fixture:20261029',
  };
  void request;
  const response: CommandResponse = {
    ok: true,
    operation: 'addAnnouncement',
    // @ts-expect-error A boolean result does not satisfy an announcement response.
    result: true,
  };
  void response;
  // @ts-expect-error Internal helpers are not remotely dispatchable.
  const helper: BackendCommand = { operation: 'postIncome', args: [] };
  void helper;
  // @ts-expect-error The method registry has no arbitrary string index signature.
  type ArbitraryMethod = BackendMethods['anything'];
}
