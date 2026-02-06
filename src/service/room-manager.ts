/**
 * Room Manager — manages chat rooms (channels).
 *
 * Rooms are lightweight containers that hold a set of member user IDs.
 * Messages sent to a room are broadcast to all members.
 */

import { WebSocket } from "ws";
import type { UserManager, UserSession } from "./user-manager.js";
import { chatMessage, systemMessage, serialize, type ServiceMessage } from "./protocol.js";
import { Logger } from "../core/logger.js";

const log = Logger.create("room-mgr");

// ─── Types ───────────────────────────────────────────────────────────

export interface Room {
  /** Unique room ID (e.g. "general", "dev-ops") */
  id: string;
  /** Human-readable room name */
  name: string;
  /** Room description */
  description: string;
  /** User IDs of members */
  members: Set<string>;
  /** Who created it */
  createdBy: string;
  /** When it was created */
  createdAt: string;
  /** Whether the room persists after all members leave */
  persistent: boolean;
  /** Room password (undefined = no password required) */
  password?: string;
  /** Recent message history (for new joiners) */
  history: ServiceMessage[];
  /** Max history messages to keep */
  maxHistory: number;
}

export interface RoomInfo {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  createdBy: string;
  createdAt: string;
  persistent: boolean;
  /** Whether the room requires a password to join */
  hasPassword: boolean;
}

// ─── Manager ─────────────────────────────────────────────────────────

const DEFAULT_MAX_HISTORY = 100;

export class RoomManager {
  private _rooms = new Map<string, Room>();
  private _userManager: UserManager;

  constructor(userManager: UserManager) {
    this._userManager = userManager;

    // Create default rooms
    this._createDefaultRooms();
  }

  // ─── Room CRUD ─────────────────────────────────────────────────────

  /** Create a new room. Returns the room info or an error. */
  createRoom(
    id: string,
    createdBy: string,
    name?: string,
    description?: string,
    persistent?: boolean,
    password?: string,
  ): { success: boolean; room?: RoomInfo; error?: string } {
    // Validate room ID
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return { success: false, error: "Room ID must be alphanumeric (with - and _)" };
    }
    if (this._rooms.has(id)) {
      return { success: false, error: `Room "${id}" already exists` };
    }

    const room: Room = {
      id,
      name: name ?? id,
      description: description ?? "",
      members: new Set(),
      createdBy,
      createdAt: new Date().toISOString(),
      persistent: persistent ?? false,
      password: password || undefined,
      history: [],
      maxHistory: DEFAULT_MAX_HISTORY,
    };

    this._rooms.set(id, room);
    log.info("room created", { roomId: id, createdBy, hasPassword: !!password, persistent: room.persistent });
    Logger.metrics.increment("service.rooms.created");
    return { success: true, room: this._toInfo(room) };
  }

  /** Join a room. Returns member list or error. */
  joinRoom(roomId: string, userId: string, password?: string): { success: boolean; members?: string[]; error?: string } {
    const room = this._rooms.get(roomId);
    if (!room) {
      return { success: false, error: `Room "${roomId}" not found` };
    }

    const user = this._userManager.getById(userId);
    if (!user) {
      return { success: false, error: "User not found" };
    }

    if (room.members.has(userId)) {
      return { success: false, error: "Already in this room" };
    }

    // Check password if room is password-protected
    if (room.password) {
      if (!password) {
        log.warn("room join denied — password required", { roomId, userId });
        Logger.metrics.increment("service.rooms.join_denied");
        return { success: false, error: `Room "${roomId}" requires a password` };
      }
      if (password !== room.password) {
        log.warn("room join denied — wrong password", { roomId, userId });
        Logger.metrics.increment("service.rooms.join_denied");
        return { success: false, error: "Incorrect room password" };
      }
    }

    room.members.add(userId);
    log.info("user joined room", { roomId, userId, memberCount: room.members.size });
    Logger.metrics.increment("service.rooms.joins");
    this._userManager.joinRoom(user.ws, roomId);

    // Notify existing members
    this._broadcastSystem(room, "user.joined", {
      user_id: userId,
      user_name: user.name,
      room_id: roomId,
    }, userId); // exclude the joiner from this notification

    // Send room history to the new member
    if (room.history.length > 0) {
      const historyMsg = systemMessage("room.history", {
        room_id: roomId,
        messages: room.history.slice(-20), // last 20 messages
      });
      this._sendTo(user.ws, historyMsg);
    }

    return {
      success: true,
      members: this._getMemberNames(room),
    };
  }

  /** Leave a room. */
  leaveRoom(roomId: string, userId: string): { success: boolean; error?: string } {
    const room = this._rooms.get(roomId);
    if (!room) {
      return { success: false, error: `Room "${roomId}" not found` };
    }

    if (!room.members.has(userId)) {
      return { success: false, error: "Not in this room" };
    }

    room.members.delete(userId);
    const user = this._userManager.getById(userId);
    if (user) {
      this._userManager.leaveRoom(user.ws, roomId);
    }

    log.info("user left room", { roomId, userId, memberCount: room.members.size });
    Logger.metrics.increment("service.rooms.leaves");

    // Notify remaining members
    this._broadcastSystem(room, "user.left", {
      user_id: userId,
      user_name: user?.name ?? userId,
      room_id: roomId,
    });

    // Clean up empty non-persistent rooms
    if (room.members.size === 0 && !room.persistent) {
      log.info("room destroyed (empty, non-persistent)", { roomId });
      Logger.metrics.increment("service.rooms.destroyed");
      this._rooms.delete(roomId);
    }

    return { success: true };
  }

  /** Remove user from all rooms (on disconnect). */
  removeUserFromAll(userId: string): void {
    for (const [roomId, room] of this._rooms) {
      if (room.members.has(userId)) {
        room.members.delete(userId);

        const user = this._userManager.getById(userId);
        this._broadcastSystem(room, "user.left", {
          user_id: userId,
          user_name: user?.name ?? userId,
          room_id: roomId,
        });

        // Clean up empty non-persistent rooms
        if (room.members.size === 0 && !room.persistent) {
          this._rooms.delete(roomId);
        }
      }
    }
  }

  /** Get room members as a list of names */
  getMembers(roomId: string): { success: boolean; members?: string[]; error?: string } {
    const room = this._rooms.get(roomId);
    if (!room) {
      return { success: false, error: `Room "${roomId}" not found` };
    }
    return { success: true, members: this._getMemberNames(room) };
  }

  /** List all rooms */
  listRooms(): RoomInfo[] {
    return [...this._rooms.values()].map((r) => this._toInfo(r));
  }

  /** Check if room exists */
  has(roomId: string): boolean {
    return this._rooms.has(roomId);
  }

  /** Check if user is in a room */
  isMember(roomId: string, userId: string): boolean {
    const room = this._rooms.get(roomId);
    return room ? room.members.has(userId) : false;
  }

  // ─── Messaging ─────────────────────────────────────────────────────

  /** Broadcast a chat message to all members of a room */
  broadcastChat(roomId: string, fromUser: UserSession, message: string): { success: boolean; error?: string } {
    const room = this._rooms.get(roomId);
    if (!room) {
      return { success: false, error: `Room "${roomId}" not found` };
    }
    if (!room.members.has(fromUser.id)) {
      return { success: false, error: "You are not in this room. Join first." };
    }

    const done = log.time("broadcast", { roomId, from: fromUser.name, memberCount: room.members.size });
    const msg = chatMessage(fromUser.name, message, `room:${roomId}`, roomId);

    // Save to history
    room.history.push(msg);
    if (room.history.length > room.maxHistory) {
      room.history.splice(0, room.history.length - room.maxHistory);
    }

    // Broadcast to all members (including sender)
    let deliveredCount = 0;
    for (const memberId of room.members) {
      const member = this._userManager.getById(memberId);
      if (member && member.ws.readyState === WebSocket.OPEN) {
        this._sendTo(member.ws, msg);
        deliveredCount++;
      }
    }

    done({ deliveredCount });
    Logger.metrics.increment("service.messages.broadcast");
    Logger.metrics.increment("service.messages.delivered", deliveredCount);

    return { success: true };
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private _createDefaultRooms(): void {
    this.createRoom("general", "server", "General", "Default public room", true);
    this.createRoom("random", "server", "Random", "Off-topic chat", true);
  }

  private _toInfo(room: Room): RoomInfo {
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      memberCount: room.members.size,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
      persistent: room.persistent,
      hasPassword: !!room.password,
    };
  }

  private _getMemberNames(room: Room): string[] {
    return [...room.members]
      .map((id) => this._userManager.getById(id))
      .filter((u): u is UserSession => u !== undefined)
      .map((u) => u.name);
  }

  private _broadcastSystem(room: Room, event: string, data: Record<string, unknown>, excludeUserId?: string): void {
    const msg = systemMessage(event, data);
    for (const memberId of room.members) {
      if (excludeUserId && memberId === excludeUserId) continue;
      const member = this._userManager.getById(memberId);
      if (member && member.ws.readyState === WebSocket.OPEN) {
        this._sendTo(member.ws, msg);
      }
    }
  }

  private _sendTo(ws: WebSocket, msg: ServiceMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialize(msg));
    }
  }
}
