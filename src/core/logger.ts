/**
 * Structured Logger — lightweight, zero-dependency logging for AgentRoom.
 *
 * Features:
 *   - Log levels: debug, info, warn, error
 *   - Structured context (key-value pairs attached to every log line)
 *   - Performance timing via `time()` / `timeEnd()` (tracks duration in ms)
 *   - Error tracking with stack traces
 *   - Metrics: counters and histograms for aggregate stats
 *   - Outputs to stderr (stdout reserved for MCP protocol)
 *   - Configurable via LOG_LEVEL env var (default: "info")
 *
 * Usage:
 *   const log = Logger.create("ws-adapter");
 *   log.info("connected", { url, channelId });
 *   log.error("connection failed", { url, err });
 *
 *   const done = log.time("connect");
 *   await doConnect();
 *   done();  // logs: [ws-adapter] connect completed in 42ms
 *
 *   Logger.metrics.increment("messages.received");
 *   Logger.metrics.record("connect.duration_ms", 42);
 *   Logger.metrics.snapshot(); // returns all metrics
 */

// ─── Types ────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  context?: Record<string, unknown>;
  error?: { message: string; stack?: string };
  duration_ms?: number;
}

// ─── Level Ordering ───────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ─── Metrics Collector ────────────────────────────────────────────────

export class MetricsCollector {
  private _counters = new Map<string, number>();
  private _histograms = new Map<string, number[]>();
  private _startedAt = Date.now();

  /** Increment a counter by 1 (or a custom amount). */
  increment(name: string, amount = 1): void {
    this._counters.set(name, (this._counters.get(name) ?? 0) + amount);
  }

  /** Record a numeric sample into a histogram (e.g. latency, duration). */
  record(name: string, value: number): void {
    let samples = this._histograms.get(name);
    if (!samples) {
      samples = [];
      this._histograms.set(name, samples);
    }
    samples.push(value);
    // Keep last 1000 samples to bound memory
    if (samples.length > 1000) {
      samples.splice(0, samples.length - 1000);
    }
  }

  /** Get current value of a counter. */
  getCounter(name: string): number {
    return this._counters.get(name) ?? 0;
  }

  /** Get summary statistics for a histogram. */
  getHistogram(name: string): { count: number; min: number; max: number; avg: number; p50: number; p95: number; p99: number } | null {
    const samples = this._histograms.get(name);
    if (!samples || samples.length === 0) return null;

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      avg: Math.round((sum / count) * 100) / 100,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    };
  }

  /** Return a full snapshot of all metrics. */
  snapshot(): {
    uptime_ms: number;
    counters: Record<string, number>;
    histograms: Record<string, ReturnType<MetricsCollector["getHistogram"]>>;
  } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this._counters) counters[k] = v;

    const histograms: Record<string, ReturnType<MetricsCollector["getHistogram"]>> = {};
    for (const [k] of this._histograms) histograms[k] = this.getHistogram(k);

    return {
      uptime_ms: Date.now() - this._startedAt,
      counters,
      histograms,
    };
  }

  /** Reset all metrics. */
  reset(): void {
    this._counters.clear();
    this._histograms.clear();
    this._startedAt = Date.now();
  }
}

// ─── Logger ───────────────────────────────────────────────────────────

export class Logger {
  /** Shared metrics collector (singleton). */
  static readonly metrics = new MetricsCollector();

  /** Current global log level. Override with LOG_LEVEL env var. */
  private static _level: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

  /** JSON output mode (LOG_FORMAT=json). Default: human-readable. */
  private static _jsonMode = process.env.LOG_FORMAT === "json";

  private _component: string;

  private constructor(component: string) {
    this._component = component;
  }

  /** Create a logger for a specific component. */
  static create(component: string): Logger {
    return new Logger(component);
  }

  /** Set the global log level at runtime. */
  static setLevel(level: LogLevel): void {
    Logger._level = level;
  }

  /** Get the global log level. */
  static getLevel(): LogLevel {
    return Logger._level;
  }

  // ─── Log Methods ──────────────────────────────────────────────────

  debug(message: string, context?: Record<string, unknown>): void {
    this._log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this._log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this._log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>, err?: Error | unknown): void {
    const entry: Partial<LogEntry> = {};
    if (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      entry.error = { message: e.message, stack: e.stack };
    }
    this._log("error", message, context, entry);
  }

  // ─── Performance Timing ───────────────────────────────────────────

  /**
   * Start a performance timer. Returns a `done()` function.
   * When called, `done()` logs the elapsed time and records it in metrics.
   *
   * @param operation  Name of the operation (e.g. "ws.connect", "room.join")
   * @param context    Optional extra context
   * @returns          A `done(extraContext?)` function
   */
  time(operation: string, context?: Record<string, unknown>): (extraContext?: Record<string, unknown>) => number {
    const start = performance.now();

    return (extraContext?: Record<string, unknown>) => {
      const duration = Math.round((performance.now() - start) * 100) / 100;
      const mergedContext = { ...context, ...extraContext };

      this._log("info", `${operation} completed`, mergedContext, { duration_ms: duration });

      // Record in metrics histogram
      Logger.metrics.record(`${operation}.duration_ms`, duration);

      return duration;
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private _log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    extra?: Partial<LogEntry>,
  ): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[Logger._level]) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this._component,
      message,
      ...extra,
    };

    if (context && Object.keys(context).length > 0) {
      entry.context = context;
    }

    if (Logger._jsonMode) {
      process.stderr.write(JSON.stringify(entry) + "\n");
    } else {
      process.stderr.write(this._formatHuman(entry) + "\n");
    }
  }

  private _formatHuman(entry: LogEntry): string {
    const ts = entry.timestamp.slice(11, 23); // HH:mm:ss.SSS
    const lvl = entry.level.toUpperCase().padEnd(5);
    const comp = entry.component;
    const dur = entry.duration_ms !== undefined ? ` (${entry.duration_ms}ms)` : "";

    let line = `${ts} ${lvl} [${comp}] ${entry.message}${dur}`;

    if (entry.context) {
      const pairs = Object.entries(entry.context)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ");
      line += ` | ${pairs}`;
    }

    if (entry.error) {
      line += `\n  ERROR: ${entry.error.message}`;
      if (entry.error.stack && entry.level === "error") {
        // Show first 3 stack frames
        const frames = entry.error.stack.split("\n").slice(1, 4).map((f) => `  ${f.trim()}`).join("\n");
        line += `\n${frames}`;
      }
    }

    return line;
  }
}
