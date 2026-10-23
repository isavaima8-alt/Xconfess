/**
 * PerformanceInterceptor — measures HTTP handler latency and enforces
 * per-endpoint latency budgets.
 *
 * Behaviour:
 *  - Records p50/p95/p99 percentiles in-process for each route key.
 *  - Logs a WARN when a request exceeds the p95 budget for that route.
 *  - Logs an ERROR when a request exceeds the p99 budget (critical breach).
 *  - Exposes getMetrics() for snapshot reporting in CI or scheduled jobs.
 *
 * Budgets are defined in latency-budgets.ts and reviewed with product owners
 * before each milestone release.
 *
 * This interceptor is registered globally in AppModule and does not require
 * per-controller decoration.
 */

import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { tap } from 'rxjs';
import {
  findBudget,
  classifyLatency,
  LatencyBudget,
} from '../performance/latency-budgets';

/** Statistical summary emitted by getMetrics(). */
export interface RouteMetricSummary {
  route: string;
  count: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  minMs: number;
  budgetP95Ms: number;
  budgetP99Ms: number;
  /** True when the measured p95 exceeds the budget. */
  p95BudgetBreached: boolean;
  /** True when the measured p99 exceeds the budget. */
  p99BudgetBreached: boolean;
}

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Performance');

  /**
   * Raw duration samples per route key ("METHOD /path").
   * The Map is intentionally capped to avoid unbounded growth in long-running
   * processes: see pruneOldRoutes().
   */
  private readonly samples = new Map<string, number[]>();

  /** Maximum number of distinct route keys tracked simultaneously. */
  private static readonly MAX_ROUTES = 200;

  /** Maximum samples retained per route (keeps only the most recent). */
  private static readonly MAX_SAMPLES_PER_ROUTE = 1000;

  intercept(context: ExecutionContext, next: CallHandler): any {
    const req = context.switchToHttp().getRequest();
    if (!req) {
      return next.handle();
    }

    const { method } = req as { method: string };
    const route = this.resolveRoute(req);
    const start = Date.now();

    return (next.handle() as any).pipe(
      tap(() => {
        const durationMs = Date.now() - start;
        const budget = findBudget(method, route);
        const level = classifyLatency(durationMs, budget);

        this.recordSample(method, route, durationMs);

        if (level === 'critical') {
          this.logger.error(
            `LATENCY_CRITICAL: ${method} ${route} ${durationMs}ms` +
              ` (p99 budget=${budget.p99Ms}ms, layer=${budget.primarySlowLayer})`,
          );
        } else if (level === 'warn') {
          this.logger.warn(
            `LATENCY_WARN: ${method} ${route} ${durationMs}ms` +
              ` (p95 budget=${budget.p95Ms}ms, layer=${budget.primarySlowLayer})`,
          );
        }

        // Legacy slow-request log kept for backward compatibility.
        if (durationMs > 200) {
          this.logger.warn(`SLOW: ${method} ${route} took ${durationMs}ms`);
        }
      }),
    );
  }

  /**
   * Snapshot summary of all tracked routes with measured percentiles and
   * budget delta information.  Suitable for CI benchmark reporters or
   * admin dashboards.
   */
  getMetrics(): Record<string, RouteMetricSummary> {
    const result: Record<string, RouteMetricSummary> = {};

    this.samples.forEach((durations, key) => {
      if (durations.length === 0) return;

      const [method, ...pathParts] = key.split(' ');
      const path = pathParts.join(' ');
      const budget = findBudget(method, path);

      const sorted = durations.slice().sort((a, b) => a - b);
      const p50Ms = percentile(sorted, 50);
      const p95Ms = percentile(sorted, 95);
      const p99Ms = percentile(sorted, 99);

      result[key] = {
        route: key,
        count: durations.length,
        p50Ms,
        p95Ms,
        p99Ms,
        maxMs: sorted[sorted.length - 1],
        minMs: sorted[0],
        budgetP95Ms: budget.p95Ms,
        budgetP99Ms: budget.p99Ms,
        p95BudgetBreached: p95Ms > budget.p95Ms,
        p99BudgetBreached: p99Ms > budget.p99Ms,
      };
    });

    return result;
  }

  /**
   * Export budget deltas for CI comparison.
   * Returns only routes whose measured p95 or p99 exceeds the budget.
   */
  getBudgetBreaches(): RouteMetricSummary[] {
    return Object.values(this.getMetrics()).filter(
      (s) => s.p95BudgetBreached || s.p99BudgetBreached,
    );
  }

  /** Reset all samples (used between test runs). */
  resetMetrics(): void {
    this.samples.clear();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private resolveRoute(req: {
    baseUrl?: string;
    route?: { path?: string | string[] };
    url?: string;
  }): string {
    const routePath = Array.isArray(req.route?.path)
      ? req.route.path[0]
      : req.route?.path;
    if (typeof routePath === 'string') {
      return `${req.baseUrl ?? ''}${routePath}`.split('?')[0] || '/';
    }

    return '/:unmatched';
  }

  private recordSample(method: string, route: string, durationMs: number): void {
    const key = `${method} ${route}`;
    let arr = this.samples.get(key);

    if (!arr) {
      // Don't grow the route map beyond the cap.
      if (this.samples.size >= PerformanceInterceptor.MAX_ROUTES) {
        this.pruneOldRoutes();
      }
      arr = [];
      this.samples.set(key, arr);
    }

    arr.push(durationMs);

    // Keep only the most recent N samples to bound memory.
    if (arr.length > PerformanceInterceptor.MAX_SAMPLES_PER_ROUTE) {
      arr.splice(0, arr.length - PerformanceInterceptor.MAX_SAMPLES_PER_ROUTE);
    }
  }

  /**
   * Remove the route with the fewest samples to make room.
   * This is a simple eviction policy; a production system could use LRU.
   */
  private pruneOldRoutes(): void {
    let minKey: string | null = null;
    let minCount = Infinity;

    this.samples.forEach((arr, key) => {
      if (arr.length < minCount) {
        minCount = arr.length;
        minKey = key;
      }
    });

    if (minKey) {
      this.samples.delete(minKey);
    }
  }
}

/** Calculate the Nth percentile of a sorted numeric array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}
