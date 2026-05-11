import type { Breadcrumb } from './types.js';

export class BreadcrumbBuffer {
  private readonly buffer: Breadcrumb[] = [];

  constructor(private readonly max: number) {}

  /** The configured ring-buffer cap, exposed so a forked scope can build a buffer of the same size. */
  get capacity(): number {
    return this.max;
  }

  add(crumb: Breadcrumb): void {
    this.buffer.push(crumb);
    if (this.buffer.length > this.max) this.buffer.shift();
  }

  snapshot(): Breadcrumb[] {
    return this.buffer.slice();
  }

  clear(): void {
    this.buffer.length = 0;
  }
}
