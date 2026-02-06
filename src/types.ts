import { EventEmitter } from "events";

// ─── Connection States ───────────────────────────────────────────────

export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "failed";

export type ProtocolType = "ws" | "sse";

// ─── Stream Message ──────────────────────────────────────────────────

export interface StreamMessage {
  /** Unique message id (auto-generated) */
  id: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Parsed data (JSON object if parsable, otherwise the raw string) */
  data: unknown;
  /** Original raw string as received */
  raw: string;
}

// ─── Adapter Options ─────────────────────────────────────────────────

export interface AdapterOptions {
  /** Bearer token or other auth credential */
  authToken?: string;
  /** Custom headers to send on connect */
  headers?: Record<string, string>;
  /** Heartbeat / ping interval in ms (WebSocket only, default 30000) */
  heartbeatIntervalMs?: number;
  /** Max reconnect attempts before entering 'failed' state (default 10) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default 1000) */
  initialReconnectDelayMs?: number;
  /** Max reconnect delay in ms (default 30000) */
  maxReconnectDelayMs?: number;
}

// ─── Stream Adapter Interface ────────────────────────────────────────

export interface StreamAdapterEvents {
  message: (data: string) => void;
  connected: () => void;
  disconnected: (reason?: string) => void;
  reconnecting: (attempt: number) => void;
  error: (err: Error) => void;
}

/**
 * Common interface for protocol-specific stream adapters.
 * Extends EventEmitter for typed events.
 */
export abstract class StreamAdapter extends EventEmitter {
  abstract get state(): ConnectionState;

  abstract connect(url: string, options?: AdapterOptions): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract send(data: string | Buffer): Promise<void>;

  // Typed event helpers
  override on<K extends keyof StreamAdapterEvents>(
    event: K,
    listener: StreamAdapterEvents[K],
  ): this {
    return super.on(event, listener);
  }

  override emit<K extends keyof StreamAdapterEvents>(
    event: K,
    ...args: Parameters<StreamAdapterEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }
}

// ─── Connection Info ─────────────────────────────────────────────────

export interface ConnectionInfo {
  channelId: string;
  url: string;
  protocol: ProtocolType;
  state: ConnectionState;
  connectedAt?: string;
  messageCount: number;
}
