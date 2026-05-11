import type { ArguslogClient } from '@arguslog/sdk-core';

/**
 * Document-level capture-phase listeners for clicks and form submits. We don't trace every
 * DOM event — that's noise — only interactive elements (buttons, links, form controls,
 * elements with {@code role="button"} or {@code data-arguslog-track}) plus form submissions.
 *
 * <p>The element is described as {@code tag#id.class[role]} so the dashboard timeline reads
 * naturally. {@code data-arguslog-label} on a wrapper overrides the auto-derivation so
 * teams can give important CTAs a human-readable label without restructuring the DOM.
 */
const TRACKED_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL']);

export function installDomBreadcrumbs(client: ArguslogClient): () => void {
  if (typeof document === 'undefined') return () => {};

  const onClick = (event: MouseEvent) => {
    const target = trackedTarget(event.target);
    if (!target) return;
    try {
      client.addBreadcrumb({
        category: 'ui.click',
        message: describeElement(target),
        level: 'info',
        data: clickData(target),
      });
    } catch {
      // best-effort
    }
  };

  const onSubmit = (event: SubmitEvent) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    try {
      client.addBreadcrumb({
        category: 'ui.submit',
        message: `submit ${describeElement(form)}`,
        level: 'info',
        data: {
          action: form.action || undefined,
          method: form.method?.toUpperCase() || undefined,
          fieldCount: form.elements.length,
        },
      });
    } catch {
      // best-effort
    }
  };

  // Capture-phase + non-passive so we see clicks even if the user's handler stops propagation.
  document.addEventListener('click', onClick, { capture: true });
  document.addEventListener('submit', onSubmit, { capture: true });

  return () => {
    document.removeEventListener('click', onClick, { capture: true });
    document.removeEventListener('submit', onSubmit, { capture: true });
  };
}

function trackedTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  // Walk up to the closest interactive ancestor — clicks on a <span> inside a <button> still
  // refer to the button as the meaningful target.
  let el: Element | null = target;
  while (el) {
    if (isTrackable(el)) return el as HTMLElement;
    el = el.parentElement;
  }
  return null;
}

function isTrackable(el: Element): boolean {
  if (TRACKED_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute('role');
  if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'menuitem')
    return true;
  if (el.hasAttribute('data-arguslog-track')) return true;
  return false;
}

function describeElement(el: HTMLElement): string {
  const explicit = el.getAttribute('data-arguslog-label');
  if (explicit) return explicit;

  const text = el.textContent?.trim().slice(0, 60);
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className
    ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
    : '';
  const tag = el.tagName.toLowerCase();
  const selector = `${tag}${id}${cls}`;
  return text ? `${selector} "${text}"` : selector;
}

function clickData(el: HTMLElement): Record<string, unknown> | undefined {
  const data: Record<string, unknown> = {};
  if (el.id) data.id = el.id;
  if (typeof el.className === 'string' && el.className) data.className = el.className;
  const testid = el.getAttribute('data-testid');
  if (testid) data.testId = testid;
  const href = el.getAttribute('href');
  if (href) data.href = href;
  return Object.keys(data).length > 0 ? data : undefined;
}
