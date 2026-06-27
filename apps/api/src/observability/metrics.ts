/**
 * In-process metrics (#29).
 *
 * Counts requests and accumulates latency per (method, route, status), and
 * renders Prometheus text at /metrics. Routes use the matched pattern (e.g.
 * `/v1/environments/:id/bundle`), not the raw path, to keep label cardinality
 * bounded. On serverless these reset per cold start — the durable signal is the
 * structured logs; /metrics is for the long-running Node deployment + scrapers.
 */

export interface MetricsSnapshot {
  requests: Record<string, number>;
  durationMs: Record<string, { sum: number; count: number }>;
}

export class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, { sum: number; count: number }>();

  observe(method: string, route: string, status: number, ms: number): void {
    const rkey = `${method}|${route}|${status}`;
    this.requests.set(rkey, (this.requests.get(rkey) ?? 0) + 1);

    const dkey = `${method}|${route}`;
    const d = this.durations.get(dkey) ?? { sum: 0, count: 0 };
    d.sum += ms;
    d.count += 1;
    this.durations.set(dkey, d);
  }

  snapshot(): MetricsSnapshot {
    return {
      requests: Object.fromEntries(this.requests),
      durationMs: Object.fromEntries(this.durations),
    };
  }

  /** Prometheus exposition format. */
  render(): string {
    const lines: string[] = [];
    lines.push("# HELP http_requests_total Total HTTP requests.");
    lines.push("# TYPE http_requests_total counter");
    for (const [key, value] of this.requests) {
      const [method, route, status] = key.split("|");
      lines.push(
        `http_requests_total{method="${method}",route="${esc(route)}",status="${status}"} ${value}`,
      );
    }
    lines.push("# HELP http_request_duration_ms_sum Sum of request durations (ms).");
    lines.push("# TYPE http_request_duration_ms_sum counter");
    for (const [key, d] of this.durations) {
      const [method, route] = key.split("|");
      lines.push(
        `http_request_duration_ms_sum{method="${method}",route="${esc(route)}"} ${d.sum.toFixed(1)}`,
      );
      lines.push(
        `http_request_duration_ms_count{method="${method}",route="${esc(route)}"} ${d.count}`,
      );
    }
    return lines.join("\n") + "\n";
  }
}

function esc(label: string | undefined): string {
  return (label ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Default process metrics registry. */
export const metrics = new Metrics();
