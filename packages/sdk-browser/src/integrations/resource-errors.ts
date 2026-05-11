import type { ArguslogClient } from '@arguslog/sdk-core';

/**
 * Captures resource load failures — {@code <img>}, {@code <script>}, {@code <link>}, etc. —
 * which the platform fires as a {@code window} {@code 'error'} event with the target set, but
 * which never reach {@code window.onerror} because they aren't script execution errors.
 *
 * <p>The {@code globalHandlers} integration listens to the same event but only when there is no
 * {@code event.target} (script-level errors). Here we listen with {@code capture: true} and
 * filter to actual resource targets, so the two never double-record. Common in the wild: ad
 * blockers killing third-party scripts, broken icon-font URLs, CDN regional outages.
 */
const TRACKED_TAGS = new Set([
  'IMG',
  'SCRIPT',
  'LINK',
  'AUDIO',
  'VIDEO',
  'SOURCE',
  'IFRAME',
  'OBJECT',
  'EMBED',
]);

export function installResourceErrorBreadcrumbs(client: ArguslogClient): () => void {
  if (typeof window === 'undefined') return () => {};

  const onError = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!TRACKED_TAGS.has(target.tagName)) return;
    try {
      const url = resourceUrl(target);
      const tag = target.tagName.toLowerCase();
      client.addBreadcrumb({
        category: 'resource.error',
        message: `<${tag}> failed to load${url ? `: ${url}` : ''}`,
        level: 'error',
        data: {
          tag,
          url,
          id: target.id || undefined,
          className: typeof target.className === 'string' ? target.className : undefined,
        },
      });
    } catch {
      // best-effort
    }
  };

  // capture: true is required — bubbling 'error' from a resource doesn't reach the window
  // listener otherwise. The same event is what globalHandlers listens to, but it skips when
  // event.target is a resource (no script-level Error object).
  window.addEventListener('error', onError, { capture: true });

  return () => {
    window.removeEventListener('error', onError, { capture: true });
  };
}

function resourceUrl(el: Element): string | undefined {
  if (el instanceof HTMLImageElement || el instanceof HTMLScriptElement) {
    return el.src || undefined;
  }
  if (el instanceof HTMLLinkElement) {
    return el.href || undefined;
  }
  if (
    el instanceof HTMLAudioElement ||
    el instanceof HTMLVideoElement ||
    el instanceof HTMLSourceElement ||
    el instanceof HTMLIFrameElement
  ) {
    return (el as { src?: string }).src || undefined;
  }
  return el.getAttribute('src') || el.getAttribute('href') || undefined;
}
