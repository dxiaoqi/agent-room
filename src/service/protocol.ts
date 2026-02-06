/**
 * Service Protocol — Message types for the real-time messaging service.
 *
 * All messages are JSON over WebSocket with a unified envelope.
 * Designed for rooms (group chat) and DM (private messaging).
 */

import { randomUUID } from "crypto";

// ─── Message Types ───────────────────────────────────────────────────

export type MessageType =
  | "chat"         // text message (room or DM)
  | "system"       // system notifications (join, leave, room events)
  | "action"       // client requests (create room, join, leave, list, etc.)
  | "response"     // server response to an action
  | "error";       // error response

export interface ServiceMessage {
  id: string;
  type: MessageType;
  from: string;            // sender user ID
  to?: string;             // target: room ID (prefixed "room:") or user ID for DM
  timestamp: string;       // ISO-8601
  payload: Record<string, unknown>;
}

// ─── Payload types ───────────────────────────────────────────────────

/** chat payload */
export interface ChatPayload {
  message: string;
  room?: string;           // room ID if sent to a room
}

/** action payload — client requests */
export interface ActionPayload {
  action: ActionType;
  [key: string]: unknown;
}

export type ActionType =
  | "auth"            // authenticate: { name, token? }
  | "room.create"     // create room: { room_id, name?, description? }
  | "room.join"       // join room: { room_id }
  | "room.leave"      // leave room: { room_id }
  | "room.list"       // list all rooms
  | "room.members"    // list members of a room: { room_id }
  | "dm"              // send DM: { to, message }
  | "users.list"      // list online users
  | "ping";           // keepalive

/** response payload — server responses */
export interface ResponsePayload {
  action: string;           // which action this responds to
  success: boolean;
  data?: unknown;
  error?: string;
}

/** system payload — server-initiated notifications */
export interface SystemPayload {
  event: string;            // "user.joined", "user.left", "room.created", etc.
  [key: string]: unknown;
}

// ─── Factory helpers ─────────────────────────────────────────────────

function makeId(): string {
  return randomUUID().slice(0, 8);
}

function now(): string {
  return new Date().toISOString();
}

export function chatMessage(from: string, message: string, to?: string, room?: string): ServiceMessage {
  return {
    id: makeId(),
    type: "chat",
    from,
    to,
    timestamp: now(),
    payload: { message, room } as ChatPayload & Record<string, unknown>,
  };
}

export function actionMessage(from: string, action: ActionType, data?: Record<string, unknown>): ServiceMessage {
  return {
    id: makeId(),
    type: "action",
    from,
    timestamp: now(),
    payload: { action, ...data } as ActionPayload,
  };
}

export function responseMessage(action: string, success: boolean, data?: unknown, error?: string): ServiceMessage {
  return {
    id: makeId(),
    type: "response",
    from: "server",
    timestamp: now(),
    payload: { action, success, data, error } as ResponsePayload & Record<string, unknown>,
  };
}

export function systemMessage(event: string, extra?: Record<string, unknown>): ServiceMessage {
  return {
    id: makeId(),
    type: "system",
    from: "server",
    timestamp: now(),
    payload: { event, ...extra } as SystemPayload,
  };
}

export function errorMessage(code: number, message: string): ServiceMessage {
  return {
    id: makeId(),
    type: "error",
    from: "server",
    timestamp: now(),
    payload: { code, message },
  };
}

// ─── Parse / Serialize ───────────────────────────────────────────────

export function parseServiceMessage(raw: string): ServiceMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (typeof msg === "object" && msg !== null && typeof msg.type === "string") {
      msg.id = msg.id ?? makeId();
      msg.from = msg.from ?? "unknown";
      msg.timestamp = msg.timestamp ?? now();
      msg.payload = msg.payload ?? {};
      return msg as ServiceMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export function serialize(msg: ServiceMessage): string {
  return JSON.stringify(msg);
}
