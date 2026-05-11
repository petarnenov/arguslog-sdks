import type { ArguslogOptions } from '@arguslog/sdk-browser';

export type RnIntegration = 'globalHandlers';

export interface RnArguslogOptions extends Omit<ArguslogOptions, 'integrations'> {
  integrations?: RnIntegration[];
}

export type ErrorUtilsHandler = (error: Error, isFatal?: boolean) => void;

export interface ErrorUtilsLike {
  setGlobalHandler(handler: ErrorUtilsHandler): void;
  getGlobalHandler(): ErrorUtilsHandler | undefined;
}

export type AppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export interface AppStateSubscriptionLike {
  remove(): void;
}

export interface AppStateLike {
  addEventListener(
    type: 'change',
    listener: (status: AppStateStatus) => void,
  ): AppStateSubscriptionLike;
}
