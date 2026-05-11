import { __resetForTests, init } from '@arguslog/sdk-browser';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArguslogErrorBoundary } from '../error-boundary.js';

const Boom = ({ msg }: { msg: string }): never => {
  throw new Error(msg);
};

describe('ArguslogErrorBoundary', () => {
  beforeEach(() => {
    __resetForTests();
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: {
        fetch: vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch,
      },
    });
    // suppress React's expected error log for thrown components
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
  });

  it('renders children when no error', () => {
    render(
      <ArguslogErrorBoundary fallback={<div>fallback</div>}>
        <div>ok</div>
      </ArguslogErrorBoundary>,
    );
    expect(screen.getByText('ok')).toBeDefined();
  });

  it('renders fallback when child throws', () => {
    render(
      <ArguslogErrorBoundary fallback={<div>fallback</div>}>
        <Boom msg="boom" />
      </ArguslogErrorBoundary>,
    );
    expect(screen.getByText('fallback')).toBeDefined();
  });

  it('supports a render-prop fallback', () => {
    render(
      <ArguslogErrorBoundary fallback={({ error }) => <div>{error.message}</div>}>
        <Boom msg="custom" />
      </ArguslogErrorBoundary>,
    );
    expect(screen.getByText('custom')).toBeDefined();
  });

  it('calls onError prop', () => {
    const onError = vi.fn();
    render(
      <ArguslogErrorBoundary fallback={<div>x</div>} onError={onError}>
        <Boom msg="cb" />
      </ArguslogErrorBoundary>,
    );
    expect(onError).toHaveBeenCalled();
  });

  it('reset clears the error and re-renders children', async () => {
    const { rerender } = render(
      <ArguslogErrorBoundary
        fallback={({ error, reset }) => (
          <button onClick={reset} type="button">
            reset {error.message}
          </button>
        )}
      >
        <Boom msg="x" />
      </ArguslogErrorBoundary>,
    );
    const btn = await screen.findByRole('button');
    btn.click();
    rerender(
      <ArguslogErrorBoundary fallback={<div>fallback</div>}>
        <div>recovered</div>
      </ArguslogErrorBoundary>,
    );
    expect(screen.getByText('recovered')).toBeDefined();
  });
});
