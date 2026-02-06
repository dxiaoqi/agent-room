import WebSocket from "ws";
import { StreamAdapter, type AdapterOptions, type ConnectionState } from "./adapter-interface.js";
import { Logger } from "../core/logger.js";

const log = Logger.create("ws-adapter");

const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_MAX_RECONNECT = 10;
const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 30_000;

/**
 * WebSocket protocol adapter with ping/pong heartbeat and exponential-backoff reconnection.
 */
export class WsAdapter extends StreamAdapter {
  private _state: ConnectionState = "disconnected";
  private _ws: WebSocket | null = null;
  private _url = "";
  private _options: AdapterOptions = {};

  // heartbeat
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _pongReceived = true;

  // reconnect
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _intentionalDisconnect = false;

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

    if (this._ws) {
      this._ws.removeAllListeners();
      if (
        this._ws.readyState === WebSocket.OPEN ||
        this._ws.readyState === WebSocket.CONNECTING
      ) {
        this._ws.close(1000, "Client disconnect");
      }
      this._ws = null;
    }

    this._setState("disconnected");
  }

  async send(data: string | Buffer): Promise<void> {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected — cannot send");
    }
    this._ws.send(data);
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private _doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this._setState("connecting");

      const headers: Record<string, string> = { ...this._options.headers };
      if (this._options.authToken) {
        headers["Authorization"] = `Bearer ${this._options.authToken}`;
      }

      const ws = new WebSocket(this._url, { headers });
      this._ws = ws;

      ws.on("open", () => {
        this._reconnectAttempt = 0;
        this._setState("connected");
        this._startHeartbeat();
        log.info("websocket connected", { url: this._url });
        this.emit("connected");
        resolve();
      });

      ws.on("message", (raw: WebSocket.RawData) => {
        const data =
          raw instanceof Buffer ? raw.toString("utf-8") : String(raw);
        this.emit("message", data);
      });

      ws.on("pong", () => {
        this._pongReceived = true;
      });

      ws.on("close", (code: number, reason: Buffer) => {
        this._stopHeartbeat();
        log.debug("websocket closed", { url: this._url, code, reason: reason.toString() });

        if (!this._intentionalDisconnect) {
          this.emit("disconnected", "Connection closed");
          this._scheduleReconnect();
        }
      });

      ws.on("error", (err: Error) => {
        log.error("websocket error", { url: this._url }, err);
        this.emit("error", err);
        // Only reject the initial connect promise; subsequent errors go through events
        if (this._state === "connecting" && this._reconnectAttempt === 0) {
          reject(err);
        }
      });
    });
  }

  private _startHeartbeat(): void {
    const interval =
      this._options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
    this._pongReceived = true;

    this._heartbeatTimer = setInterval(() => {
      if (!this._pongReceived) {
        // Missed pong — connection is likely dead
        log.warn("heartbeat timeout — missed pong, terminating", { url: this._url });
        Logger.metrics.increment("ws.heartbeat_timeout");
        this._ws?.terminate();
        return;
      }
      this._pongReceived = false;
      this._ws?.ping();
    }, interval);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
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

    log.info("scheduling reconnect", { url: this._url, attempt: this._reconnectAttempt, delay_ms: Math.round(delay) });

    this._reconnectTimer = setTimeout(async () => {
      try {
        await this._doConnect();
      } catch {
        // _doConnect already handles scheduling next reconnect via the close handler
      }
    }, delay);
  }

  private _clearTimers(): void {
    this._stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  private _setState(state: ConnectionState): void {
    this._state = state;
  }
}
