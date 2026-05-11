import type { EventPayload } from '@arguslog/sdk-core';
import express from 'express';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandler, requestHandler } from '../express.js';
import { __resetForTests, captureMessage, flush, init, setTag, setUser } from '../index.js';

describe('express middleware', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let sent: EventPayload[];

  beforeEach(() => {
    sent = [];
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(init?.body as string) as EventPayload);
      return new Response(null, { status: 202 });
    });
    init({
      dsn: 'arguslog://k@localhost:8080/api/1',
      transport: { fetch: fetchMock as unknown as typeof fetch, maxRetries: 0 },
    });
  });

  afterEach(() => {
    __resetForTests();
    vi.restoreAllMocks();
  });

  it('requestHandler adds an http breadcrumb visible to events captured in the same request', async () => {
    const app = express();
    app.use(requestHandler());
    app.get('/users/:id', (req, _res, next) => {
      captureMessage(`looking up user ${req.params.id}`);
      next(); // continue to the route handler
    });
    app.get('/users/:id', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await supertest(app).get('/users/42').expect(200);
    await flush();

    const ev = sent.find((e) => e.message?.includes('looking up user'));
    expect(ev).toBeDefined();
    const crumb = ev?.breadcrumbs?.find((b) => b.category === 'http');
    // requestHandler runs before Express's routing step, so req.path is the literal URL.
    expect(crumb?.message).toBe('GET /users/42');
    expect(crumb?.data).toMatchObject({ method: 'GET', path: '/users/42' });
  });

  it('isolates scope across concurrent requests (no setUser cross-contamination)', async () => {
    const app = express();
    app.use(requestHandler());
    app.get('/whoami/:id', async (req, res) => {
      setUser({ id: req.params.id! });
      // Sleep to overlap with the other in-flight request.
      await new Promise((r) => setTimeout(r, 30));
      captureMessage(`hi from ${req.params.id}`);
      res.status(200).json({ ok: true });
    });

    await Promise.all([
      supertest(app).get('/whoami/alice').expect(200),
      supertest(app).get('/whoami/bob').expect(200),
    ]);
    await flush();

    const alice = sent.find((e) => e.message === 'hi from alice');
    const bob = sent.find((e) => e.message === 'hi from bob');
    expect(alice?.user?.id).toBe('alice');
    expect(bob?.user?.id).toBe('bob');
  });

  it('errorHandler captures thrown errors with method + path tags', async () => {
    const app = express();
    app.use(requestHandler());
    app.get('/boom', (_req, _res) => {
      throw new Error('kaboom');
    });
    app.use(errorHandler());
    // Final handler so the response doesn't hang. Express needs a 4-arg signature here.
    app.use(
      (
        _err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).json({ error: 'boom' });
      },
    );

    await supertest(app).get('/boom').expect(500);
    await flush();

    const ev = sent.find((e) => e.exception?.values[0]?.value === 'kaboom');
    expect(ev).toBeDefined();
    expect(ev?.tags).toMatchObject({ 'http.method': 'GET', 'http.path': '/boom' });
    expect(ev?.level).toBe('error');
  });

  it('errorHandler also captures errors passed via next(err)', async () => {
    const app = express();
    app.use(requestHandler());
    app.get('/async-boom', (_req, _res, next) => {
      next(new Error('async-kaboom'));
    });
    app.use(errorHandler());
    app.use(
      (
        _err: unknown,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).end();
      },
    );

    await supertest(app).get('/async-boom').expect(500);
    await flush();

    const ev = sent.find((e) => e.exception?.values[0]?.value === 'async-kaboom');
    expect(ev).toBeDefined();
    expect(ev?.tags?.['http.path']).toBe('/async-boom');
  });

  it('per-request setTag does not leak to subsequent requests', async () => {
    const app = express();
    app.use(requestHandler());
    app.get('/tag/:value', (req, res) => {
      setTag('marker', req.params.value!);
      captureMessage('msg');
      res.status(200).end();
    });

    await supertest(app).get('/tag/first').expect(200);
    await supertest(app).get('/tag/second').expect(200);
    await flush();

    const first = sent.find((e) => e.tags?.marker === 'first');
    const second = sent.find((e) => e.tags?.marker === 'second');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // Verify the second request's event does not also carry "first" as the marker.
    expect(second?.tags?.marker).toBe('second');
  });
});
