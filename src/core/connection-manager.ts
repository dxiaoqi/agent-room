import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import {
  type ConnectionInfo,
  type ProtocolType,
  type AdapterOptions,
  type StreamAdapter,
} from "../types.js";
import { WsAdapter } from "../protocols/ws-adapter.js";
import { SseAdapter } from "../protocols/sse-adapter.js";
import { Logger } from "./logger.js";

const log = Logger.create("connection-mgr");

// ─── Internal connection record ──────────────────────────────────────

interface ManagedConnection {
  channelId: string;
  url: string;
  protocol: ProtocolType;
  adapter: StreamAdapter;
  connectedAt?: string;
  messageCount: number;
}

// ─── Events emitted by ConnectionManager ─────────────────────────────

export interface ConnectionManagerEvents {
  /** A new message arrived on a channel */
  message: (channelId: string, data: string) => void;
  /** A connection's state changed */
  stateChange: (channelId: string, info: ConnectionInfo) => void;
}

/**
 * Manages multiple concurrent stream connections, each identified by a channelId.
 * Delegates actual protocol handling to WsAdapter / SseAdapter.
 */
export class ConnectionManager extends EventEmitter {
  private _connections = new Map<string, ManagedConnection>();

  // ─── Public API ────────────────────────────────────────────────────

  /**
   * Open a new stream connection.
   * Returns the channelId (auto-generated if not provided).
   */
  async connect(
    url: string,
    protocol: ProtocolType,
    channelId?: string,
    options?: AdapterOptions,
  ): Promise<string> {
    const id = channelId ?? randomUUID().slice(0, 8);

    if (this._connections.has(id)) {
      throw new Error(`Channel "${id}" already exists. Disconnect first or use a different ID.`);
    }

    const done = log.time("connect", { channelId: id, url, protocol });

    const adapter = this._createAdapter(protocol);
    const conn: ManagedConnection = {
      channelId: id,
      url,
      protocol,
      adapter,
      messageCount: 0,
    };

    // Wire adapter events before connecting
    adapter.on("connected", () => {
      conn.connectedAt = new Date().toISOString();
      this._emitStateChange(conn);
    });

    adapter.on("message", (data: string) => {
      conn.messageCount++;
      Logger.metrics.increment("messages.received");
      this.emit("message", id, data);
      this._emitStateChange(conn);
    });

    adapter.on("disconnected", (reason) => {
      log.warn("channel disconnected", { channelId: id, reason });
      Logger.metrics.increment("connections.disconnected");
      this._emitStateChange(conn);
    });

    adapter.on("reconnecting", (attempt) => {
      log.info("channel reconnecting", { channelId: id, attempt });
      Logger.metrics.increment("connections.reconnect_attempts");
      this._emitStateChange(conn);
    });

    adapter.on("error", (err) => {
      log.error("channel error", { channelId: id }, err);
      Logger.metrics.increment("errors.connection");
      this._emitStateChange(conn);
    });

    this._connections.set(id, conn);

    try {
      await adapter.connect(url, options);
      done();
      Logger.metrics.increment("connections.opened");
    } catch (err) {
      // If initial connect fails, clean up
      this._connections.delete(id);
      log.error("connect failed", { channelId: id, url, protocol }, err);
      Logger.metrics.increment("errors.connect_failed");
      throw err;
    }

    return id;
  }

  /**
   * Disconnect a channel.
   */
  async disconnect(channelId: string): Promise<void> {
    const conn = this._connections.get(channelId);
    if (!conn) {
      throw new Error(`Channel "${channelId}" not found`);
    }
    log.debug("disconnecting channel", { channelId });
    await conn.adapter.disconnect();
    this._connections.delete(channelId);
    Logger.metrics.increment("connections.closed");
    log.info("channel disconnected (intentional)", { channelId });
  }

  /**
   * Disconnect all channels.
   */
  async disconnectAll(): Promise<void> {
    const ids = [...this._connections.keys()];
    await Promise.allSettled(ids.map((id) => this.disconnect(id)));
  }

  /**
   * Send data through a specific channel.
   */
  async send(channelId: string, data: string): Promise<void> {
    const conn = this._connections.get(channelId);
    if (!conn) {
      throw new Error(`Channel "${channelId}" not found`);
    }
    const done = log.time("send", { channelId });
    try {
      await conn.adapter.send(data);
      done();
      Logger.metrics.increment("messages.sent");
    } catch (err) {
      log.error("send failed", { channelId }, err);
      Logger.metrics.increment("errors.send_failed");
      throw err;
    }
  }

  /**
   * Get info for a specific channel.
   */
  getConnectionInfo(channelId: string): ConnectionInfo | undefined {
    const conn = this._connections.get(channelId);
    if (!conn) return undefined;
    return this._toInfo(conn);
  }

  /**
   * List all active connections.
   */
  listConnections(): ConnectionInfo[] {
    return [...this._connections.values()].map((c) => this._toInfo(c));
  }

  /**
   * Check if a channel exists.
   */
  has(channelId: string): boolean {
    return this._connections.has(channelId);
  }

  /**
   * Wait for the next message on a channel, with optional substring filter.
   * Returns a Promise that resolves with the raw message data, or rejects on timeout.
   *
   * @param channelId  The channel to listen on
   * @param timeoutMs  Max time to wait (default 30000ms)
   * @param filter     Optional substring — only messages containing this string will resolve the promise
   * @returns          The raw message string that matched
   */
  waitForMessage(
    channelId: string,
    timeoutMs: number = 30_000,
    filter?: string,
  ): Promise<{ data: string; timedOut: false } | { data: null; timedOut: true }> {
    if (!this._connections.has(channelId)) {
      return Promise.reject(new Error(`Channel "${channelId}" not found`));
    }

    return new Promise((resolve) => {
      let settled = false;

      const onMessage = (id: string, data: string) => {
        if (settled) return;
        if (id !== channelId) return;
        if (filter && !data.includes(filter)) return;

        settled = true;
        clearTimeout(timer);
        this.removeListener("message", onMessage);
        resolve({ data, timedOut: false });
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.removeListener("message", onMessage);
        resolve({ data: null, timedOut: true });
      }, timeoutMs);

      // Use the base EventEmitter 'on' to avoid typed overload issues
      super.on("message", onMessage);
    });
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private _createAdapter(protocol: ProtocolType): StreamAdapter {
    switch (protocol) {
      case "ws":
        return new WsAdapter();
      case "sse":
        return new SseAdapter();
      default:
        throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  private _toInfo(conn: ManagedConnection): ConnectionInfo {
    return {
      channelId: conn.channelId,
      url: conn.url,
      protocol: conn.protocol,
      state: conn.adapter.state,
      connectedAt: conn.connectedAt,
      messageCount: conn.messageCount,
    };
  }

  private _emitStateChange(conn: ManagedConnection): void {
    this.emit("stateChange", conn.channelId, this._toInfo(conn));
  }

  // Typed event helpers
  override on<K extends keyof ConnectionManagerEvents>(
    event: K,
    listener: ConnectionManagerEvents[K],
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof ConnectionManagerEvents>(
    event: K,
    ...args: Parameters<ConnectionManagerEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}
