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
import {
  UserRole,
  MessageVisibility,
  type RoomPermissions,
  type RoomConfig,
  type MessagePermission,
  getDefaultRoomPermissions,
  getDefaultRoomConfig,
  permissionChecker,
  PermissionAction,
} from "./permissions.js";

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
  /** Member roles (userId -> UserRole) */
  memberRoles: Map<string, UserRole>;
  /** Room permission configuration */
  roomPermissions: RoomPermissions;
  /** Room configuration */
  roomConfig: RoomConfig;
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
  /** Your role in this room (if you're a member) */
  yourRole?: UserRole;
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
      memberRoles: new Map([[createdBy, UserRole.OWNER]]),
      roomPermissions: getDefaultRoomPermissions(),
      roomConfig: getDefaultRoomConfig(),
    };

    this._rooms.set(id, room);
    log.info("room created", { roomId: id, createdBy, hasPassword: !!password, persistent: room.persistent });
    Logger.metrics.increment("service.rooms.created");
    return { success: true, room: this._toInfo(room, createdBy) };
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

    // Idempotent: if user is already in the room, return success with current members
    if (room.members.has(userId)) {
      log.debug("user already in room (idempotent join)", { roomId, userId });
      return { success: true, members: this._getMemberNames(room) };
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
    
    // Assign default role if not already set (e.g., on reconnect they keep their role)
    if (!room.memberRoles.has(userId)) {
      room.memberRoles.set(userId, room.roomConfig.defaultRole);
    }
    
    log.info("user joined room", { roomId, userId, role: room.memberRoles.get(userId), memberCount: room.members.size });
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

  /** List all rooms (with optional user context for role info) */
  listRooms(requestingUserId?: string): RoomInfo[] {
    return [...this._rooms.values()].map((r) => this._toInfo(r, requestingUserId));
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

  /** Broadcast a chat message to all members of a room (with permission filtering) */
  broadcastChat(
    roomId: string, 
    fromUser: UserSession, 
    message: string,
    permission?: MessagePermission
  ): { success: boolean; error?: string } {
    const room = this._rooms.get(roomId);
    if (!room) {
      return { success: false, error: `Room "${roomId}" not found` };
    }
    if (!room.members.has(fromUser.id)) {
      return { success: false, error: "You are not in this room. Join first." };
    }

    // Check if user has permission to send message
    const userRole = room.memberRoles.get(fromUser.id) ?? UserRole.GUEST;
    const canSend = permissionChecker.canPerformAction(
      PermissionAction.SEND_MESSAGE,
      userRole,
      room.roomPermissions
    );
    
    if (!canSend) {
      return { success: false, error: "You don't have permission to send messages in this room" };
    }

    // Check if user can create restricted messages
    if (permission && permission.visibility !== MessageVisibility.PUBLIC) {
      const canCreateRestricted = permissionChecker.canPerformAction(
        PermissionAction.SEND_RESTRICTED_MESSAGE,
        userRole,
        room.roomPermissions
      );
      if (!canCreateRestricted) {
        return { success: false, error: "You don't have permission to create restricted messages" };
      }
    }

    const done = log.time("broadcast", { roomId, from: fromUser.name, memberCount: room.members.size });
    const msg = chatMessage(fromUser.name, message, `room:${roomId}`, roomId);
    
    // Attach permission if provided
    if (permission) {
      (msg as any).permission = permission;
    }

    // Save to history
    room.history.push(msg);
    if (room.history.length > room.maxHistory) {
      room.history.splice(0, room.history.length - room.maxHistory);
    }

    // Broadcast with permission filtering
    let deliveredCount = 0;
    for (const memberId of room.members) {
      const member = this._userManager.getById(memberId);
      if (!member || member.ws.readyState !== WebSocket.OPEN) {
        continue;
      }

      // Check if this member can view the message
      const memberRole = room.memberRoles.get(memberId) ?? UserRole.GUEST;
      const canView = permissionChecker.canViewMessage(
        msg as any,
        memberId,
        memberRole,
        room.roomConfig.defaultVisibility
      );

      if (canView) {
        this._sendTo(member.ws, msg);
        deliveredCount++;
      }
    }

    done({ deliveredCount, filteredCount: room.members.size - deliveredCount });
    Logger.metrics.increment("service.messages.broadcast");
    Logger.metrics.increment("service.messages.delivered", deliveredCount);

    return { success: true };
  }

  // ─── Permission Management ────────────────────────────────────────

  /** Set a user's role in a room */
  setUserRole(
    roomId: string,
    actorUserId: string,
    targetUserId: string,
    newRole: UserRole
  ): { success: boolean; error?: string; data?: any } {
    const room = this._rooms.get(roomId);
    if (!room) {
      return { success: false, error: `Room "${roomId}" not found` };
    }

    // Check if target is in the room
    if (!room.members.has(targetUserId)) {
      return { success: false, error: "Target user is not in this room" };
    }

    // Get roles
    const actorRole = room.memberRoles.get(actorUserId) ?? UserRole.GUEST;
    const targetCurrentRole = room.memberRoles.get(targetUserId) ?? UserRole.GUEST;

    // Check if actor has permission to change roles
    const canChange = permissionChecker.canChangeRole(actorRole, targetCurrentRole, newRole);
    if (!canChange) {
      return { 
        success: false, 
        error: `You don't have permission to change this user's role (your role: ${actorRole})` 
      };
    }

    // Prevent changing owner role
    if (targetCurrentRole === UserRole.OWNER && actorRole !== UserRole.OWNER) {
      return { success: false, error: "Cannot change owner's role" };
    }

    // Update role
    room.memberRoles.set(targetUserId, newRole);
    
    const targetUser = this._userManager.getById(targetUserId);
    log.info("user role changed", { 
      roomId, 
      targetUserId, 
      targetName: targetUser?.name,
      oldRole: targetCurrentRole, 
      newRole,
      by: actorUserId 
    });

    // Notify room members about role change
    this._broadcastSystem(room, "user.role_changed", {
      user_id: targetUserId,
      user_name: targetUser?.name ?? targetUserId,
      room_id: roomId,
      old_role: targetCurrentRole,
      new_role: newRole,
    });

    return { 
      success: true, 
      data: { 
        userId: targetUserId, 
        oldRole: targetCurrentRole, 
        newRole 
      } 
    };
  }

  /** Get a user's role in a room */
  getUserRole(roomId: string, userId: string): UserRole | undefined {
    const room = this._rooms.get(roomId);
    if (!room || !room.members.has(userId)) {
      return undefined;
    }
    return room.memberRoles.get(userId);
  }

  /** Get filtered history messages based on user's permission */
  getHistory(
    roomId: string,
    userId: string,
    count: number = 50
  ): { success: boolean; messages?: ServiceMessage[]; error?: string } {
    const room = this._rooms.get(roomId);
    if (!room) {
      return { success: false, error: `Room "${roomId}" not found` };
    }

    if (!room.members.has(userId)) {
      return { success: false, error: "You are not in this room" };
    }

    const userRole = room.memberRoles.get(userId) ?? UserRole.GUEST;

    // Check if user has permission to view history
    const canViewHistory = permissionChecker.canPerformAction(
      PermissionAction.VIEW_HISTORY,
      userRole,
      room.roomPermissions
    );

    if (!canViewHistory) {
      return { success: false, error: "You don't have permission to view history" };
    }

    // Apply history limit for non-admin users
    let historyLimit = count;
    if (userRole === UserRole.MEMBER && room.roomConfig.memberHistoryLimit > 0) {
      historyLimit = Math.min(count, room.roomConfig.memberHistoryLimit);
    }

    // Get messages and filter by permission
    const recentMessages = room.history.slice(-historyLimit);
    const filteredMessages = permissionChecker.filterVisibleMessages(
      recentMessages.map(msg => ({
        ...msg,
        from: msg.from,
        permission: (msg as any).permission
      })),
      userId,
      userRole,
      room.roomConfig.defaultVisibility
    );

    return { success: true, messages: filteredMessages as ServiceMessage[] };
  }

  /** Get user's permissions in a room */
  getUserPermissions(roomId: string, userId: string): { 
    success: boolean; 
    permissions?: Record<string, boolean>;
    role?: UserRole;
    error?: string;
  } {
    const room = this._rooms.get(roomId);
    if (!room) {
      return { success: false, error: `Room "${roomId}" not found` };
    }

    if (!room.members.has(userId)) {
      return { success: false, error: "You are not in this room" };
    }

    const userRole = room.memberRoles.get(userId) ?? UserRole.GUEST;
    const actions = [
      PermissionAction.SEND_MESSAGE,
      PermissionAction.SEND_RESTRICTED_MESSAGE,
      PermissionAction.DELETE_MESSAGE,
      PermissionAction.EDIT_MESSAGE,
      PermissionAction.INVITE_MEMBER,
      PermissionAction.KICK_MEMBER,
      PermissionAction.VIEW_HISTORY,
      PermissionAction.VIEW_MEMBERS,
      PermissionAction.PIN_MESSAGE,
      PermissionAction.SEND_DM,
      PermissionAction.MODIFY_PERMISSIONS,
    ];

    const permissions = actions.reduce((acc, action) => {
      acc[action] = permissionChecker.canPerformAction(
        action,
        userRole,
        room.roomPermissions
      );
      return acc;
    }, {} as Record<string, boolean>);

    return { success: true, permissions, role: userRole };
  }

  /** Get room permission configuration */
  getRoomConfig(roomId: string): {
    success: boolean;
    permissions?: RoomPermissions;
    config?: RoomConfig;
    error?: string;
  } {
    const room = this._rooms.get(roomId);
    if (!room) {
      return { success: false, error: `Room "${roomId}" not found` };
    }

    return {
      success: true,
      permissions: room.roomPermissions,
      config: room.roomConfig,
    };
  }

  // ─── Internal ──────────────────────────────────────────────────────

  private _createDefaultRooms(): void {
    this.createRoom("general", "server", "General", "Default public room", true);
    this.createRoom("random", "server", "Random", "Off-topic chat", true);
  }

  private _toInfo(room: Room, requestingUserId?: string): RoomInfo {
    return {
      id: room.id,
      name: room.name,
      description: room.description,
      memberCount: room.members.size,
      createdBy: room.createdBy,
      createdAt: room.createdAt,
      persistent: room.persistent,
      hasPassword: !!room.password,
      yourRole: requestingUserId ? room.memberRoles.get(requestingUserId) : undefined,
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
