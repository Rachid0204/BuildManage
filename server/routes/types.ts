import type express from "express";

export interface ServerStore {
  __revision?: number;
  __resetAt?: number;
  __deletedIds?: Record<string, string[]>;
  [key: string]: any;
}

export interface AuthCallerContext {
  sessionVersion?: number;
  firebaseAuthTime?: number;
  uid: string;
  email?: string;
  role: string;
  syndicId?: string;
  buildingId?: string;
  residentId?: string;
  prestataireId?: string;
}

export interface AuthorizedScope {
  isAdmin: boolean;
  authorizedSyndicIds: Set<string>;
  authorizedBuildingIds: Set<string>;
  authorizedSyndics: any[];
  callerResId: string;
  callerPrestId: string;
}

export type WrapFn = (
  handler: express.RequestHandler,
  transactional?: boolean,
) => (req: express.Request, res: express.Response) => Promise<void>;

export interface WrappedApi {
  get: (
    route: string,
    handler: (req: express.Request, res: express.Response) => unknown,
  ) => unknown;
  post: (
    route: string,
    handler: (req: express.Request, res: express.Response) => unknown,
    preflight?: express.RequestHandler,
  ) => unknown;
}

export type ExtractAndVerifyCallerFn = (
  req: express.Request,
  store: ServerStore,
) => Promise<AuthCallerContext | null>;

export type HasValidCallerCredentialFn = (
  req: express.Request,
) => Promise<boolean>;

export type AssertOnboardedFn = (
  caller: AuthCallerContext,
  state: Record<string, any>,
) => void;

export type SchedulerAuthFn = (req: express.Request) => boolean;
