import { EventSource } from "eventsource";
import { StreamAdapter, type AdapterOptions, type ConnectionState } from "./adapter-interface.js";
import { Logger } from "../core/logger.js";

const log = Logger.create("sse-adapter");

const DEFAULT_MAX_RECONNECT = 10;
const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * Server-Sent Events (SSE) protocol adapter.
 * SSE is inherently receive-only; calling send() will throw.
 *
 * The eventsource library handles reconnection internally via the SSE spec,
 * but we add our own layer for tracking state and max-attempt limits.
 */
export class SseAdapter extends StreamAdapter {
  private _state: ConnectionState = "disconnected";
  private _es: EventSource | null = null;
  private _url = "";
  private _options: AdapterOptions = {};
  private _intentionalDisconnect = false;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  get state(): ConnectionState {
    return this._state;
  }

  async connect(url: string, options?: AdapterOptions): Promise<void> {
    this._url = url;
    this._options = options ?? {};
    this._intentionalDisconnect = false;
    this._reconnectAttempt = 0;

    return this._doConnect();
  }

  async disconnect(): Promise<void> {
    this._intentionalDisconnect = true;
    this._clearTimers();

    if (this._es) {
      this._es.close();
      this._es = null;
    }

    this._setState("disconnected");
  }

  async send(_data: string | Buffer): Promise<void> {
    throw new Error("SSE is a receive-only protocol — cannot send messages");
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private _doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._setState("connecting");

      // Build the URL with auth token as query param if no custom fetch is provided
      // The eventsource v4 library accepts EventSourceInit with optional fetch
      const headers: Record<string, string> = { ...this._options.headers };
      if (this._options.authToken) {
        headers["Authorization"] = `Bearer ${this._options.authToken}`;
      }

      // eventsource v4 uses the global fetch; we can inject headers via a custom fetch wrapper
      const customFetch: typeof globalThis.fetch = (input, init) => {
        const mergedHeaders = new Headers(init?.headers);
        for (const [key, value] of Object.entries(headers)) {
          mergedHeaders.set(key, value);
        }
        return globalThis.fetch(input, { ...init, headers: mergedHeaders });
      };

      const es = new EventSource(this._url, {
        fetch: customFetch,
      });
      this._es = es;

      let settled = false;

      es.addEventListener("open", () => {
        this._reconnectAttempt = 0;
        this._setState("connected");
        log.info("SSE connected", { url: this._url });
        this.emit("connected");
        if (!settled) {
          settled = true;
          resolve();
        }
      });

      es.addEventListener("message", (event) => {
        const me = event as MessageEvent;
        this.emit("message", me.data as string);
      });

      es.addEventListener("error", (event) => {
        const errorEvent = event as ErrorEvent;
        const err = new Error(errorEvent.message ?? "SSE connection error");
        log.error("SSE error", { url: this._url }, err);
        this.emit("error", err);

        // EventSource spec: readyState === CLOSED means the connection is done
        if (es.readyState === EventSource.CLOSED) {
          this._es = null;
          if (!this._intentionalDisconnect) {
            this.emit("disconnected", "SSE connection closed");
            this._scheduleReconnect();
          }
          if (!settled) {
            settled = true;
            reject(err);
          }
        }
      });
    });
  }

  private _scheduleReconnect(): void {
    const maxAttempts =
      this._options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT;

    if (this._reconnectAttempt >= maxAttempts) {
      this._setState("failed");
      log.error("max reconnect attempts reached", { url: this._url, maxAttempts });
      this.emit("error", new Error(`Max reconnect attempts (${maxAttempts}) reached`));
      return;
    }

    this._reconnectAttempt++;
    this._setState("reconnecting");
    this.emit("reconnecting", this._reconnectAttempt);

    const baseDelay =
      this._options.initialReconnectDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    const maxDelay = this._options.maxReconnectDelayMs ?? DEFAULT_MAX_DELAY_MS;
    const expDelay = baseDelay * Math.pow(2, this._reconnectAttempt - 1);
    const jitter = Math.random() * baseDelay;
    const delay = Math.min(expDelay + jitter, maxDelay);

    log.info("scheduling SSE reconnect", { url: this._url, attempt: this._reconnectAttempt, delay_ms: Math.round(delay) });

    this._reconnectTimer = setTimeout(async () => {
      try {
        await this._doConnect();
      } catch {
        // reconnect scheduling handled via error/close events
      }
    }, delay);
  }

  private _clearTimers(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _setState(state: ConnectionState): void {
    this._state = state;
  }
}
