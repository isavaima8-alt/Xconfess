import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of } from 'rxjs';
import { PerformanceInterceptor } from '../performance.interceptor';

function makeContext(
  method: string,
  url: string,
  route?: { baseUrl: string; path: string },
): ExecutionContext {
  const matchedRoute = route ?? { baseUrl: '', path: url.split('?')[0] };
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        url,
        route: { path: matchedRoute.path },
        baseUrl: matchedRoute.baseUrl,
      }),
    }),
  } as unknown as ExecutionContext;
}

function makeHandler(delayMs = 0): CallHandler {
  return {
    handle: () => of(undefined),
  } as CallHandler;
}

describe('PerformanceInterceptor', () => {
  let interceptor: PerformanceInterceptor;

  beforeEach(() => {
    interceptor = new PerformanceInterceptor();
  });

  it('passes the response through unchanged', async () => {
    const ctx = makeContext('GET', '/api/confessions');
    const handler: CallHandler = { handle: () => of({ data: 'ok' }) };
    const result = await interceptor.intercept(ctx, handler).toPromise();
    expect(result).toEqual({ data: 'ok' });
  });

  it('records a sample after a request completes', async () => {
    const ctx = makeContext('GET', '/api/confessions');
    await interceptor.intercept(ctx, makeHandler()).toPromise();
    const metrics = interceptor.getMetrics();
    const entry = metrics['GET /api/confessions'];
    expect(entry).toBeDefined();
    expect(entry.count).toBe(1);
  });

  it('accumulates multiple samples for the same route', async () => {
    const ctx = makeContext('GET', '/api/confessions');
    await interceptor.intercept(ctx, makeHandler()).toPromise();
    await interceptor.intercept(ctx, makeHandler()).toPromise();
    await interceptor.intercept(ctx, makeHandler()).toPromise();
    const metrics = interceptor.getMetrics();
    expect(metrics['GET /api/confessions'].count).toBe(3);
  });

  it('calculates p50, p95, p99 without throwing', async () => {
    const ctx = makeContext('GET', '/api/confessions');
    for (let i = 0; i < 10; i++) {
      await interceptor.intercept(ctx, makeHandler()).toPromise();
    }
    const entry = interceptor.getMetrics()['GET /api/confessions'];
    expect(entry.p50Ms).toBeGreaterThanOrEqual(0);
    expect(entry.p95Ms).toBeGreaterThanOrEqual(entry.p50Ms);
    expect(entry.p99Ms).toBeGreaterThanOrEqual(entry.p95Ms);
  });

  it('exposes budget values alongside measurements', async () => {
    const ctx = makeContext('GET', '/api/confessions');
    await interceptor.intercept(ctx, makeHandler()).toPromise();
    const entry = interceptor.getMetrics()['GET /api/confessions'];
    expect(entry.budgetP95Ms).toBeGreaterThan(0);
    expect(entry.budgetP99Ms).toBeGreaterThan(entry.budgetP95Ms);
  });

  it('resetMetrics() clears all recorded samples', async () => {
    const ctx = makeContext('GET', '/api/confessions');
    await interceptor.intercept(ctx, makeHandler()).toPromise();
    interceptor.resetMetrics();
    expect(interceptor.getMetrics()).toEqual({});
  });

  it('getBudgetBreaches() returns empty when all requests are fast', async () => {
    // Fast requests should not breach budgets.
    const ctx = makeContext('GET', '/api/confessions');
    await interceptor.intercept(ctx, makeHandler()).toPromise();
    // p95 measured for 1 fast sample will be < budget.
    const breaches = interceptor.getBudgetBreaches();
    expect(breaches).toHaveLength(0);
  });

  it('handles a null HTTP context gracefully (e.g. WS context)', async () => {
    const wsCtx = {
      switchToHttp: () => ({
        getRequest: () => null,
      }),
    } as unknown as ExecutionContext;
    const result = await interceptor.intercept(wsCtx, { handle: () => of('ws') }).toPromise();
    expect(result).toBe('ws');
  });

  it('tracks distinct routes separately', async () => {
    await interceptor.intercept(makeContext('GET', '/api/confessions'), makeHandler()).toPromise();
    await interceptor.intercept(makeContext('POST', '/api/confessions'), makeHandler()).toPromise();
    const metrics = interceptor.getMetrics();
    expect(metrics['GET /api/confessions']).toBeDefined();
    expect(metrics['POST /api/confessions']).toBeDefined();
  });

  it('aggregates identifier paths and excludes query strings using the route template', async () => {
    const route = { baseUrl: '/api/confessions', path: '/:id' };
    await interceptor
      .intercept(
        makeContext('GET', '/api/confessions/user-secret-1?token=one', route),
        makeHandler(),
      )
      .toPromise();
    await interceptor
      .intercept(
        makeContext('GET', '/api/confessions/user-secret-2?token=two', route),
        makeHandler(),
      )
      .toPromise();

    const metrics = interceptor.getMetrics();
    expect(metrics['GET /api/confessions/:id'].count).toBe(2);
    expect(Object.keys(metrics).join(' ')).not.toContain('user-secret');
    expect(Object.keys(metrics).join(' ')).not.toContain('token=');
  });
});
