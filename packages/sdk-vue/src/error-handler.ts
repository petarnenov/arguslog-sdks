import { captureException } from '@arguslog/sdk-browser';
import type { App, ComponentPublicInstance } from 'vue';

/**
 * Replaces `app.config.errorHandler` with a chain that forwards uncaught Vue
 * component errors to `captureException`. The previously-configured handler
 * (if any) is invoked afterwards so user-defined logging is preserved.
 */
export function installVueErrorHandler(app: App): () => void {
  const previous = app.config.errorHandler;

  app.config.errorHandler = (err, instance, info) => {
    captureException(err, { tags: { framework: 'vue', vueInfo: info } });
    previous?.(err, instance, info);
  };

  return () => {
    app.config.errorHandler = previous;
  };
}

/** Standalone helper for users who manage errorHandler chaining themselves. */
export function vueErrorHandler(
  err: unknown,
  _instance: ComponentPublicInstance | null,
  info: string,
): void {
  captureException(err, { tags: { framework: 'vue', vueInfo: info } });
}
