import { BreadcrumbBuffer } from './breadcrumbs.js';
import type { User } from './types.js';

/**
 * Holds the mutable per-request (or per-tab) state that decorates an event before send: the
 * current user, tags, contexts, and the breadcrumb trail. Pluggable so the browser can use a
 * single global scope while the Node SDK can swap in an AsyncLocalStorage-backed store that
 * isolates scope per HTTP request.
 */
export interface ScopeStore {
  getUser(): User | undefined;
  setUser(user: User | undefined): void;
  getTags(): ReadonlyMap<string, string>;
  setTag(key: string, value: string): void;
  getContexts(): ReadonlyMap<string, Record<string, unknown>>;
  setContext(name: string, ctx: Record<string, unknown>): void;
  getBreadcrumbs(): BreadcrumbBuffer;
  /**
   * Returns a child scope that inherits a snapshot of the current tags and contexts but starts
   * with a fresh breadcrumb buffer and no user. Mutations to the child do not leak back to the
   * parent.
   */
  fork(): ScopeStore;
}

/**
 * The default scope: a single shared instance. Correct for browsers (one tab, one user). Used
 * as the fallback in the Node SDK when no AsyncLocalStorage context is active.
 */
export class GlobalScope implements ScopeStore {
  private user: User | undefined;
  private readonly tags: Map<string, string> = new Map();
  private readonly contexts: Map<string, Record<string, unknown>> = new Map();
  private readonly breadcrumbs: BreadcrumbBuffer;

  constructor(maxBreadcrumbs: number) {
    this.breadcrumbs = new BreadcrumbBuffer(maxBreadcrumbs);
  }

  getUser(): User | undefined {
    return this.user;
  }

  setUser(user: User | undefined): void {
    this.user = user;
  }

  getTags(): ReadonlyMap<string, string> {
    return this.tags;
  }

  setTag(key: string, value: string): void {
    this.tags.set(key, value);
  }

  getContexts(): ReadonlyMap<string, Record<string, unknown>> {
    return this.contexts;
  }

  setContext(name: string, ctx: Record<string, unknown>): void {
    this.contexts.set(name, ctx);
  }

  getBreadcrumbs(): BreadcrumbBuffer {
    return this.breadcrumbs;
  }

  fork(): ScopeStore {
    const child = new GlobalScope(this.breadcrumbs.capacity);
    for (const [k, v] of this.tags) child.setTag(k, v);
    for (const [k, v] of this.contexts) child.setContext(k, { ...v });
    return child;
  }
}
