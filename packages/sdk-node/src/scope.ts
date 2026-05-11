import { AsyncLocalStorage } from 'node:async_hooks';

import { GlobalScope, type ScopeStore } from '@arguslog/sdk-core';
import type { User } from '@arguslog/sdk-core';

/**
 * A ScopeStore that delegates every read/write to the AsyncLocalStorage-current scope, falling
 * back to a shared GlobalScope when no async context is active. This is what makes
 * per-request isolation work in Express/Fastify/etc: middleware calls .run(forkedChild, fn) and
 * any `setUser` / `addBreadcrumb` deeper in the call stack writes to the request's scope, not
 * to a process-wide one.
 */
export class AsyncLocalScopeStore implements ScopeStore {
  private readonly als = new AsyncLocalStorage<ScopeStore>();
  private readonly fallback: GlobalScope;

  constructor(maxBreadcrumbs: number) {
    this.fallback = new GlobalScope(maxBreadcrumbs);
  }

  /** The scope active for the current async context (a child) or the global fallback. */
  active(): ScopeStore {
    return this.als.getStore() ?? this.fallback;
  }

  /** The shared fallback. Useful for one-time setup at boot (e.g. setTag('service', 'api')). */
  globalFallback(): GlobalScope {
    return this.fallback;
  }

  getUser(): User | undefined {
    return this.active().getUser();
  }

  setUser(user: User | undefined): void {
    this.active().setUser(user);
  }

  getTags(): ReadonlyMap<string, string> {
    return this.active().getTags();
  }

  setTag(key: string, value: string): void {
    this.active().setTag(key, value);
  }

  getContexts(): ReadonlyMap<string, Record<string, unknown>> {
    return this.active().getContexts();
  }

  setContext(name: string, ctx: Record<string, unknown>): void {
    this.active().setContext(name, ctx);
  }

  getBreadcrumbs() {
    return this.active().getBreadcrumbs();
  }

  fork(): ScopeStore {
    return this.active().fork();
  }

  /** Runs `fn` with `scope` as the AsyncLocalStorage-current scope. */
  run<T>(scope: ScopeStore, fn: () => T): T {
    return this.als.run(scope, fn);
  }
}
