import type { State } from '../repository';
import type { Actor } from './errors';
/** Explicit capabilities supplied by the transaction-scoped command coordinator. */
export interface CommandDependencies {
 check(condition: unknown, message: string, status?: number): asserts condition;
 object(value: any): Record<string, any>;
 str(value: any, max?: number): string;
 cents(value: any): number;
 appendAudit(state: State, actor: Actor, operation: string, buildingId?: string, details?: any): void;
 assertPeriod(building: any, date: any): void;
 cabinetFor(actor: Actor, id: string): any;
 buildingFor(actor: Actor, id: string, managed?: boolean): any;
 canWrite(actor: Actor, building: any): void;
 record(actor: Actor, key: string, id: any, managed?: boolean): any;
 actorIdentity(actor: Actor): string;
 dispatch(actor: Actor, operation: string, args: any[], scope?: {cabinetId?:string;buildingId?:string}): Promise<any>;
 pick(value: any,keys: string[]): Record<string,any>;
 manager(actor: Actor): void;
 nested(actor: Actor,key: string,id: string): any;
 links(building: any,apartment: any): void;
 emailAvailable(email: string, field?: string, id?: string): void;
}
