import { Injectable, type ErrorHandler } from '@angular/core';
import { captureException } from '@arguslog/sdk-browser';

@Injectable()
export class ArguslogErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    // Angular wraps thrown values in a Promise/Zone error with `.rejection` or `.originalError`.
    // Unwrap so the captured payload contains the real Error rather than the wrapper.
    const unwrapped = unwrap(error);
    captureException(unwrapped, { tags: { framework: 'angular' } });
  }
}

function unwrap(error: unknown): unknown {
  if (error && typeof error === 'object') {
    const candidate =
      (error as { rejection?: unknown; originalError?: unknown }).rejection ??
      (error as { originalError?: unknown }).originalError;
    if (candidate !== undefined) return candidate;
  }
  return error;
}
