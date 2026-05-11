import { Injectable } from '@angular/core';
import {
  addBreadcrumb,
  captureException,
  captureMessage,
  flush,
  getClient,
  setContext,
  setTag,
  setUser,
  type Breadcrumb,
  type Level,
  type User,
} from '@arguslog/sdk-browser';

@Injectable({ providedIn: 'root' })
export class ArguslogService {
  captureException(
    error: unknown,
    hint?: { level?: Level; tags?: Record<string, string> },
  ): string | undefined {
    return captureException(error, hint);
  }

  captureMessage(message: string, level?: Level): string | undefined {
    return captureMessage(message, level);
  }

  setUser(user: User | undefined): void {
    setUser(user);
  }

  setTag(key: string, value: string): void {
    setTag(key, value);
  }

  setContext(name: string, ctx: Record<string, unknown>): void {
    setContext(name, ctx);
  }

  addBreadcrumb(crumb: Omit<Breadcrumb, 'timestamp'> & { timestamp?: number }): void {
    addBreadcrumb(crumb);
  }

  flush(): Promise<void> {
    return flush();
  }

  isInitialized(): boolean {
    return Boolean(getClient());
  }
}
