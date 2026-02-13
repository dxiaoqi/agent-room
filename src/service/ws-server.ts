/**
 * WebSocket Server — handles WebSocket connections and routes messages.
 *
 * This is the core real-time layer of the Service.
 * It uses UserManager for session management and RoomManager for room operations.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import { UserManager } from "./user-manager.js";
import { RoomManager } from "./room-manager.js";
import {
  type ServiceMessage,
  type ActionPayload,
  type ChatPayload,
  parseServiceMessage,
  responseMessage,
  systemMessage,
  errorMessage,
  chatMessage,
  serialize,
} from "./protocol.js";
import { Logger } from "../core/logger.js";

const log = Logger.create("ws-server");

// ─── Types ───────────────────────────────────────────────────────────

export interface WsServerOptions {
  /** External WebSocketServer instance (when using shared HTTP server) */
  wss?: WebSocketServer;
  /** Port to listen on (if not providing external wss) */
  port?: number;
}

// ─── Server ──────────────────────────────────────────────────────────

export class ServiceWsServer {
  private _wss: WebSocketServer;
  private _users: UserManager;
  private _rooms: RoomManager;
  private _ownsWss: boolean;

  constructor(users: UserManager, rooms: RoomManager, options: WsServerOptions = {}) {
    this._users = users;
    this._rooms = rooms;

    if (options.wss) {
      this._wss = options.wss;
      this._ownsWss = false;
    } else {
      this._wss = new WebSocketServer({ port: options.port ?? 9000 });
      this._ownsWss = true;
    }

    this._wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
      this._handleConnection(ws, req);
    });
  }

  /** Close the server */
  close(): void {
    if (this._ownsWss) {
      this._wss.close();
    }
  }

  /** Get WebSocketServer instance (for external use) */
  get wss(): WebSocketServer {
    return this._wss;
  }

  // ─── Connection Handling ───────────────────────────────────────────

  private _handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const userId = this._users.register(ws);
    const remoteAddr = req.socket.remoteAddress ?? "unknown";
    log.info("client connected", { userId, remoteAddr });
    Logger.metrics.increment("service.connections.total");

    // Send welcome — prompt the client to authenticate
    this._send(ws, systemMessage("welcome", {
      message: "Connected to service. Send an 'auth' action with your name to begin.",
      user_id: userId,
    }));

    ws.on("message", (raw: Buffer) => {
      const msg = parseServiceMessage(raw.toString("utf-8"));
      if (!msg) {
        log.warn("invalid message format", { userId });
        Logger.metrics.increment("service.errors.invalid_message");
        this._send(ws, errorMessage(400, "Invalid message format. Expected JSON."));
        return;
      }
      Logger.metrics.increment("service.messages.received");
      this._routeMessage(ws, msg);
    });

    ws.on("close", () => {
      this._handleDisconnect(ws);
    });

    ws.on("error", (err: Error) => {
      log.error("client error", { userId }, err);
      Logger.metrics.increment("service.errors.client");
      // Also handle disconnect on error to ensure cleanup
      this._handleDisconnect(ws);
    });
  }

  private _handleDisconnect(ws: WebSocket): void {
    const session = this._users.getByWs(ws);
    if (!session) return;

    log.info("client disconnected", { userId: session.id, name: session.name });
    Logger.metrics.increment("service.connections.disconnected");

    // Remove from all rooms
    this._rooms.removeUserFromAll(session.id);

    // Remove user session
    this._users.remove(ws);
  }

  // ─── Message Routing ───────────────────────────────────────────────

  private _routeMessage(ws: WebSocket, msg: ServiceMessage): void {
    switch (msg.type) {
      case "action":
        this._handleAction(ws, msg);
        break;

      case "chat":
        this._handleChat(ws, msg);
        break;

      default:
        this._send(ws, errorMessage(400, `Unsupported message type: "${msg.type}". Use "action" or "chat".`));
    }
  }

  // ─── Action Handler ────────────────────────────────────────────────

  private _handleAction(ws: WebSocket, msg: ServiceMessage): void {
    const payload = msg.payload as ActionPayload;
    const session = this._users.getByWs(ws);
    if (!session) return;

    switch (payload.action) {
      // ── Auth ────────────────────────────────────────────────────
      case "auth": {
        const name = payload.name as string;
        if (!name || typeof name !== "string" || name.trim().length === 0) {
          this._send(ws, responseMessage("auth", false, undefined, "Name is required"));
          return;
        }

        const done = log.time("auth", { name: name.trim() });
        const result = this._users.authenticate(ws, name.trim(), payload.token as string | undefined);
        if (result.success) {
          done({ userId: result.userId, reconnected: result.reconnected });

          if (result.reconnected) {
            Logger.metrics.increment("service.auth.reconnected");
            log.info("session reconnected", {
              name: name.trim(),
              userId: result.userId,
              restoredRooms: result.restoredRooms,
            });

            // Re-register the user in restored rooms in RoomManager
            if (result.restoredRooms && result.restoredRooms.length > 0) {
              for (const roomId of result.restoredRooms) {
                if (this._rooms.has(roomId) && !this._rooms.isMember(roomId, result.userId)) {
                  this._rooms.joinRoom(roomId, result.userId);
                }
              }
            }
          } else {
            Logger.metrics.increment("service.auth.success");
          }

          this._send(ws, responseMessage("auth", true, {
            user_id: result.userId,
            name: name.trim(),
            token: result.token,
            reconnected: result.reconnected ?? false,
            restored_rooms: result.restoredRooms ?? [],
            rooms: this._rooms.listRooms(),
          }));
        } else {
          log.warn("auth failed", { name: name.trim(), error: result.error });
          Logger.metrics.increment("service.auth.failed");
          this._send(ws, responseMessage("auth", false, undefined, result.error));
        }
        break;
      }

      // ── Room operations ─────────────────────────────────────────
      case "room.create": {
        this._requireAuth(ws, session, () => {
          const roomId = payload.room_id as string;
          if (!roomId) {
            this._send(ws, responseMessage("room.create", false, undefined, "room_id is required"));
            return;
          }
          const result = this._rooms.createRoom(
            roomId,
            session.id,
            payload.name as string | undefined,
            payload.description as string | undefined,
            payload.persistent as boolean | undefined,
            payload.password as string | undefined,
          );
          this._send(ws, responseMessage("room.create", result.success, result.room, result.error));
        });
        break;
      }

      case "room.join": {
        this._requireAuth(ws, session, () => {
          const roomId = payload.room_id as string;
          if (!roomId) {
            this._send(ws, responseMessage("room.join", false, undefined, "room_id is required"));
            return;
          }
          const result = this._rooms.joinRoom(roomId, session.id, payload.password as string | undefined);
          this._send(ws, responseMessage("room.join", result.success, {
            room_id: roomId,
            members: result.members,
          }, result.error));
        });
        break;
      }

      case "room.leave": {
        this._requireAuth(ws, session, () => {
          const roomId = payload.room_id as string;
          if (!roomId) {
            this._send(ws, responseMessage("room.leave", false, undefined, "room_id is required"));
            return;
          }
          const result = this._rooms.leaveRoom(roomId, session.id);
          this._send(ws, responseMessage("room.leave", result.success, { room_id: roomId }, result.error));
        });
        break;
      }

      case "room.list": {
        const rooms = this._rooms.listRooms(session.id);
        this._send(ws, responseMessage("room.list", true, { rooms }));
        break;
      }

      case "room.members": {
        const roomId = payload.room_id as string;
        if (!roomId) {
          this._send(ws, responseMessage("room.members", false, undefined, "room_id is required"));
          return;
        }
        const result = this._rooms.getMembers(roomId);
        this._send(ws, responseMessage("room.members", result.success, {
          room_id: roomId,
          members: result.members,
        }, result.error));
        break;
      }

      // ── DM ──────────────────────────────────────────────────────
      case "dm": {
        this._requireAuth(ws, session, () => {
          const targetName = payload.to as string;
          const message = payload.message as string;

          if (!targetName || !message) {
            this._send(ws, responseMessage("dm", false, undefined, "'to' and 'message' are required"));
            return;
          }

          const target = this._users.getByName(targetName);
          if (!target) {
            this._send(ws, responseMessage("dm", false, undefined, `User "${targetName}" not found or offline`));
            return;
          }

          // Send the DM to the target
          const dmMsg = chatMessage(session.name, message, target.name);
          dmMsg.payload = { ...dmMsg.payload, dm: true };
          this._send(target.ws, dmMsg);

          // Confirm to the sender
          this._send(ws, responseMessage("dm", true, { to: targetName, delivered: true }));
        });
        break;
      }

      // ── Users ───────────────────────────────────────────────────
      case "users.list": {
        const users = this._users.listOnline();
        this._send(ws, responseMessage("users.list", true, { users }));
        break;
      }

      // ── Ping ────────────────────────────────────────────────────
      case "ping": {
        this._send(ws, responseMessage("ping", true, { pong: true, time: new Date().toISOString() }));
        break;
      }

      // ── Permission Management ───────────────────────────────────
      case "permission.send_restricted": {
        this._requireAuth(ws, session, () => {
          const roomId = payload.room_id as string;
          const message = payload.message as string;
          const visibility = payload.visibility as string;

          if (!roomId || !message) {
            this._send(ws, responseMessage("permission.send_restricted", false, undefined, "room_id and message are required"));
            return;
          }

          // Build permission object
          const permission: any = {
            visibility: visibility || "public",
          };

          if (payload.allowed_roles) {
            permission.allowedRoles = payload.allowed_roles;
          }
          
          // Convert usernames to user IDs
          if (payload.allowed_users) {
            const allowedUsers = payload.allowed_users as string[];
            permission.allowedUsers = allowedUsers.map((nameOrId: string) => {
              // Try to find user by name first
              const user = this._users.getByName(nameOrId);
              return user ? user.id : nameOrId; // Fallback to original if not found
            });
          }
          
          if (payload.denied_users) {
            const deniedUsers = payload.denied_users as string[];
            permission.deniedUsers = deniedUsers.map((nameOrId: string) => {
              const user = this._users.getByName(nameOrId);
              return user ? user.id : nameOrId;
            });
          }
          
          if (payload.expires_in) {
            const expiresIn = payload.expires_in as number;
            permission.expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
          }

          // Send message with permission
          const result = this._rooms.broadcastChat(roomId, session, message, permission);
          
          if (result.success) {
            this._send(ws, responseMessage("permission.send_restricted", true, { room_id: roomId }));
          } else {
            this._send(ws, responseMessage("permission.send_restricted", false, undefined, result.error));
          }
        });
        break;
      }

      case "permission.set_role": {
        this._requireAuth(ws, session, () => {
          const roomId = payload.room_id as string;
          const targetUserId = payload.user_id as string;
          const newRole = payload.role as string;

          if (!roomId || !targetUserId || !newRole) {
            this._send(ws, responseMessage("permission.set_role", false, undefined, "room_id, user_id, and role are required"));
            return;
          }

          // Validate role
          const validRoles = ["owner", "admin", "member", "guest"];
          if (!validRoles.includes(newRole)) {
            this._send(ws, responseMessage("permission.set_role", false, undefined, `Invalid role. Must be one of: ${validRoles.join(", ")}`));
            return;
          }

          const result = this._rooms.setUserRole(roomId, session.id, targetUserId, newRole as any);
          
          if (result.success) {
            this._send(ws, responseMessage("permission.set_role", true, result.data));
          } else {
            this._send(ws, responseMessage("permission.set_role", false, undefined, result.error));
          }
        });
        break;
      }

      case "permission.get_my_permissions": {
        this._requireAuth(ws, session, () => {
          const roomId = payload.room_id as string;

          if (!roomId) {
            this._send(ws, responseMessage("permission.get_my_permissions", false, undefined, "room_id is required"));
            return;
          }

          const result = this._rooms.getUserPermissions(roomId, session.id);
          
          if (result.success) {
            this._send(ws, responseMessage("permission.get_my_permissions", true, {
              user_id: session.id,
              room_id: roomId,
              role: result.role,
              permissions: result.permissions,
            }));
          } else {
            this._send(ws, responseMessage("permission.get_my_permissions", false, undefined, result.error));
          }
        });
        break;
      }

      case "permission.get_room_config": {
        const roomId = payload.room_id as string;

        if (!roomId) {
          this._send(ws, responseMessage("permission.get_room_config", false, undefined, "room_id is required"));
          return;
        }

        const result = this._rooms.getRoomConfig(roomId);
        
        if (result.success) {
          this._send(ws, responseMessage("permission.get_room_config", true, {
            room_id: roomId,
            permissions: result.permissions,
            config: result.config,
          }));
        } else {
          this._send(ws, responseMessage("permission.get_room_config", false, undefined, result.error));
        }
        break;
      }

      default:
        this._send(ws, errorMessage(400, `Unknown action: "${payload.action}"`));
    }
  }

  // ─── Chat Handler ──────────────────────────────────────────────────

  private _handleChat(ws: WebSocket, msg: ServiceMessage): void {
    const session = this._users.getByWs(ws);
    if (!session) return;

    if (!session.authenticated) {
      this._send(ws, errorMessage(401, "Authenticate first. Send an 'auth' action."));
      return;
    }

    const payload = msg.payload as unknown as ChatPayload;
    const message = payload.message;

    if (!message || typeof message !== "string") {
      this._send(ws, errorMessage(400, "Chat message requires a 'message' field in payload"));
      return;
    }

    // Determine target: room or DM
    const to = msg.to;

    if (to && to.startsWith("room:")) {
      // Room message
      const roomId = to.slice(5); // strip "room:"
      const result = this._rooms.broadcastChat(roomId, session, message);
      if (!result.success) {
        this._send(ws, errorMessage(400, result.error ?? "Failed to send to room"));
      }
    } else if (to) {
      // DM — 'to' is a username
      const target = this._users.getByName(to);
      if (!target) {
        this._send(ws, errorMessage(404, `User "${to}" not found or offline`));
        return;
      }
      const dmMsg = chatMessage(session.name, message, target.name);
      dmMsg.payload = { ...dmMsg.payload, dm: true };
      this._send(target.ws, dmMsg);
      // Echo back to sender for confirmation
      this._send(ws, dmMsg);
    } else {
      // No target specified — error
      this._send(ws, errorMessage(400, "Chat message requires 'to' field: 'room:<room_id>' or a username for DM"));
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private _requireAuth(ws: WebSocket, session: { authenticated: boolean }, fn: () => void): void {
    if (!session.authenticated) {
      this._send(ws, errorMessage(401, "Authenticate first. Send an 'auth' action with your name."));
      return;
    }
    fn();
  }

  private _send(ws: WebSocket, msg: ServiceMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serialize(msg));
    }
  }
}
