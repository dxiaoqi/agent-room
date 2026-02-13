/**
 * HTTP API — REST endpoints for the service.
 *
 * Provides read-only HTTP endpoints for room discovery, health check, and stats.
 * The real-time operations happen over WebSocket.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "http";
import { UserManager } from "./user-manager.js";
import { RoomManager } from "./room-manager.js";
import { Logger } from "../core/logger.js";

// ─── Types ───────────────────────────────────────────────────────────

export interface HttpApiOptions {
  port: number;
  userManager: UserManager;
  roomManager: RoomManager;
}

// ─── API ─────────────────────────────────────────────────────────────

export class HttpApi {
  private _server: Server;
  private _users: UserManager;
  private _rooms: RoomManager;
  private _startedAt: string;

  constructor(options: HttpApiOptions) {
    this._users = options.userManager;
    this._rooms = options.roomManager;
    this._startedAt = new Date().toISOString();

    this._server = createServer((req, res) => {
      this._handleRequest(req, res);
    });
  }

  /** Start listening on the configured port */
  listen(port: number): Server {
    this._server.listen(port);
    return this._server;
  }

  /** Get the underlying HTTP server (for WebSocket upgrade sharing) */
  get server(): Server {
    return this._server;
  }

  // ─── Route Handler ─────────────────────────────────────────────────

  private _handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = req.method ?? "GET";

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      switch (url.pathname) {
        case "/health":
          this._jsonResponse(res, 200, {
            status: "ok",
            uptime: this._getUptime(),
            startedAt: this._startedAt,
          });
          break;

        case "/stats":
          this._jsonResponse(res, 200, {
            connections: this._users.count,
            authenticated: this._users.authenticatedCount,
            rooms: this._rooms.listRooms().length,
            startedAt: this._startedAt,
            uptime: this._getUptime(),
          });
          break;

        case "/rooms":
          this._jsonResponse(res, 200, {
            rooms: this._rooms.listRooms(),
          });
          break;

        case "/users":
          this._jsonResponse(res, 200, {
            users: this._users.listOnline(),
          });
          break;

        case "/metrics":
          this._jsonResponse(res, 200, Logger.metrics.snapshot());
          break;

        default:
          // Check if it's a specific room: /rooms/:id
          if (url.pathname.startsWith("/rooms/")) {
            const roomId = url.pathname.slice(7); // strip "/rooms/"
            
            // Check for /rooms/:id/permissions
            if (roomId.includes("/permissions")) {
              const actualRoomId = roomId.split("/")[0];
              const configResult = this._rooms.getRoomConfig(actualRoomId);
              if (configResult.success) {
                this._jsonResponse(res, 200, {
                  room_id: actualRoomId,
                  permissions: configResult.permissions,
                  config: configResult.config,
                });
              } else {
                this._jsonResponse(res, 404, { error: configResult.error });
              }
            } else {
              // /rooms/:id - get members
              const result = this._rooms.getMembers(roomId);
              if (result.success) {
                this._jsonResponse(res, 200, {
                  room_id: roomId,
                  members: result.members,
                });
              } else {
                this._jsonResponse(res, 404, { error: result.error });
              }
            }
          } else {
            this._jsonResponse(res, 404, {
              error: "Not found",
              endpoints: [
                "/health", 
                "/stats", 
                "/rooms", 
                "/rooms/:id", 
                "/rooms/:id/permissions",
                "/users", 
                "/metrics"
              ],
            });
          }
      }
    } catch (err) {
      this._jsonResponse(res, 500, {
        error: err instanceof Error ? err.message : "Internal server error",
      });
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private _jsonResponse(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data, null, 2));
  }

  private _getUptime(): string {
    const ms = Date.now() - new Date(this._startedAt).getTime();
    const secs = Math.floor(ms / 1000);
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    if (mins > 0) return `${mins}m ${secs % 60}s`;
    return `${secs}s`;
  }
}
