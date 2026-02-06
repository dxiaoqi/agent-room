import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

const DEFAULT_DEBOUNCE_MS = 1_000;

/**
 * Debounced notification engine that batches resource-update signals
 * so the AI client is not flooded with per-message notifications.
 *
 * Each channel has its own independent debounce timer.
 */
export class NotificationEngine {
  private _server: Server | null = null;
  private _debounceMs: number;
  private _timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** URIs that have pending notifications */
  private _pendingUris = new Map<string, string>();

  constructor(debounceMs: number = DEFAULT_DEBOUNCE_MS) {
    this._debounceMs = debounceMs;
  }

  /**
   * Attach the low-level MCP Server instance.
   * Must be called after the McpServer is created but before notifications are sent.
   */
  setServer(server: Server): void {
    this._server = server;
  }

  /**
   * Signal that a resource has been updated.
   * The actual notification is debounced so rapid updates only fire once.
   *
   * @param channelId  The channel whose data changed
   * @param uri        The MCP resource URI that was updated
   */
  notifyResourceUpdated(channelId: string, uri: string): void {
    // Store the URI for this channel
    this._pendingUris.set(channelId, uri);

    // Reset debounce timer for this channel
    const existing = this._timers.get(channelId);
    if (existing) {
      clearTimeout(existing);
    }

    this._timers.set(
      channelId,
      setTimeout(() => {
        this._flush(channelId);
      }, this._debounceMs),
    );
  }

  /**
   * Immediately flush all pending notifications (e.g. on shutdown).
   */
  flushAll(): void {
    for (const [channelId] of this._timers) {
      this._flush(channelId);
    }
  }

  /**
   * Stop all timers.
   */
  destroy(): void {
    for (const timer of this._timers.values()) {
      clearTimeout(timer);
    }
    this._timers.clear();
    this._pendingUris.clear();
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private _flush(channelId: string): void {
    const timer = this._timers.get(channelId);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(channelId);
    }

    const uri = this._pendingUris.get(channelId);
    this._pendingUris.delete(channelId);

    if (!uri || !this._server) return;

    // Fire and forget — notification errors are non-critical
    this._server.sendResourceUpdated({ uri }).catch(() => {
      // Silently ignore notification delivery failures
    });
  }
}
