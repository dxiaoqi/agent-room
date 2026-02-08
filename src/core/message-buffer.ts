import { randomUUID } from "crypto";
import type { StreamMessage } from "../types.js";

const DEFAULT_MAX_SIZE = 50;

/**
 * Sliding-window buffer that stores the most recent N messages per channel.
 * Automatically parses JSON payloads for structured display.
 * Supports read-cursor tracking for unread message queries.
 */
export class MessageBuffer {
  private _buffers = new Map<string, StreamMessage[]>();
  private _maxSize: number;

  /** Tracks the last-read message ID per channel. Messages after this are "unread". */
  private _readCursors = new Map<string, string>();

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this._maxSize = maxSize;
  }

  /**
   * Add a raw message string to a channel's buffer.
   * Returns the created StreamMessage.
   */
  push(channelId: string, raw: string): StreamMessage {
    let buffer = this._buffers.get(channelId);
    if (!buffer) {
      buffer = [];
      this._buffers.set(channelId, buffer);
    }

    const msg: StreamMessage = {
      id: randomUUID().slice(0, 8),
      timestamp: new Date().toISOString(),
      data: this._tryParseJson(raw),
      raw,
    };

    buffer.push(msg);

    // Trim to sliding window
    if (buffer.length > this._maxSize) {
      buffer.splice(0, buffer.length - this._maxSize);
    }

    return msg;
  }

  /**
   * Get the most recent `count` messages for a channel.
   */
  getRecent(channelId: string, count?: number): StreamMessage[] {
    const buffer = this._buffers.get(channelId);
    if (!buffer || buffer.length === 0) return [];
    const n = count ?? this._maxSize;
    return buffer.slice(-n);
  }

  /**
   * Get only the latest message for a channel.
   */
  getLatest(channelId: string): StreamMessage | undefined {
    const buffer = this._buffers.get(channelId);
    if (!buffer || buffer.length === 0) return undefined;
    return buffer[buffer.length - 1];
  }

  /**
   * Get all buffered messages for a channel.
   */
  getAll(channelId: string): StreamMessage[] {
    return this._buffers.get(channelId) ?? [];
  }

  /**
   * Get unread messages for a channel (messages after the read cursor).
   * Does NOT advance the cursor — call markAsRead() to advance it.
   */
  getUnread(channelId: string): StreamMessage[] {
    const buffer = this._buffers.get(channelId);
    if (!buffer || buffer.length === 0) return [];

    const cursorId = this._readCursors.get(channelId);
    if (!cursorId) {
      // No cursor set → all messages are unread
      return [...buffer];
    }

    const cursorIdx = buffer.findIndex((m) => m.id === cursorId);
    if (cursorIdx === -1) {
      // Cursor message was evicted from the window → all buffered messages are unread
      return [...buffer];
    }

    // Return messages after the cursor
    return buffer.slice(cursorIdx + 1);
  }

  /**
   * Get count of unread messages for a channel.
   */
  getUnreadCount(channelId: string): number {
    return this.getUnread(channelId).length;
  }

  /**
   * Mark all current messages as read (advance cursor to latest).
   * Returns the number of messages that were marked as read.
   */
  markAsRead(channelId: string): number {
    const buffer = this._buffers.get(channelId);
    if (!buffer || buffer.length === 0) return 0;

    const unreadCount = this.getUnread(channelId).length;
    const latest = buffer[buffer.length - 1];
    this._readCursors.set(channelId, latest.id);
    return unreadCount;
  }

  /**
   * Clear a channel's buffer.
   */
  clear(channelId: string): void {
    this._buffers.delete(channelId);
    this._readCursors.delete(channelId);
  }

  /**
   * Clear all buffers.
   */
  clearAll(): void {
    this._buffers.clear();
    this._readCursors.clear();
  }

  /**
   * Format messages for AI-readable display.
   * JSON data is pretty-printed; raw strings are shown as-is.
   */
  formatForDisplay(messages: StreamMessage[]): string {
    if (messages.length === 0) return "(no messages)";

    return messages
      .map((msg) => {
        const dataStr =
          typeof msg.data === "object" && msg.data !== null
            ? JSON.stringify(msg.data, null, 2)
            : String(msg.data);
        return `[${msg.timestamp}] #${msg.id}\n${dataStr}`;
      })
      .join("\n\n---\n\n");
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private _tryParseJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}
