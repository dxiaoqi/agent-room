/**
 * User Manager — manages connected user sessions.
 *
 * Each WebSocket connection maps to one user session.
 * Users authenticate with a name (and optional token).
 */

import type { WebSocket } from "ws";

// ─── Types ───────────────────────────────────────────────────────────

export interface UserSession {
  /** Unique user ID (auto-generated) */
  id: string;
  /** Display name */
  name: string;
  /** WebSocket connection */
  ws: WebSocket;
  /** Set of room IDs this user has joined */
  rooms: Set<string>;
  /** When the user connected */
  connectedAt: string;
  /** Whether the user has authenticated */
  authenticated: boolean;
  /** Optional auth token */
  token?: string;
}

export interface UserInfo {
  id: string;
  name: string;
  rooms: string[];
  connectedAt: string;
}

// ─── Manager ─────────────────────────────────────────────────────────

export class UserManager {
  /** ws → UserSession */
  private _byWs = new Map<WebSocket, UserSession>();
  /** userId → UserSession */
  private _byId = new Map<string, UserSession>();
  /** name → UserSession (for DM by name) */
  private _byName = new Map<string, UserSession>();

  private _idCounter = 0;

  /** Register a new WebSocket connection (pre-auth). Returns a temp user ID. */
  register(ws: WebSocket): string {
    const id = `u${++this._idCounter}`;
    const session: UserSession = {
      id,
      name: id, // temp name until auth
      ws,
      rooms: new Set(),
      connectedAt: new Date().toISOString(),
      authenticated: false,
    };
    this._byWs.set(ws, session);
    this._byId.set(id, session);
    return id;
  }

  /**
   * Authenticate a user — set their display name.
   * Returns false if the name is already taken.
   */
  authenticate(ws: WebSocket, name: string, token?: string): { success: boolean; userId: string; error?: string } {
    const session = this._byWs.get(ws);
    if (!session) {
      return { success: false, userId: "", error: "Not connected" };
    }

    // Check name collision
    const existing = this._byName.get(name);
    if (existing && existing.ws !== ws) {
      return { success: false, userId: session.id, error: `Name "${name}" is already taken` };
    }

    // Remove old name mapping
    if (session.authenticated) {
      this._byName.delete(session.name);
    }

    session.name = name;
    session.token = token;
    session.authenticated = true;
    this._byName.set(name, session);

    return { success: true, userId: session.id };
  }

  /** Remove a user (on disconnect). Returns the session for cleanup. */
  remove(ws: WebSocket): UserSession | undefined {
    const session = this._byWs.get(ws);
    if (!session) return undefined;

    this._byWs.delete(ws);
    this._byId.delete(session.id);
    if (session.authenticated) {
      this._byName.delete(session.name);
    }
    return session;
  }

  /** Get session by WebSocket */
  getByWs(ws: WebSocket): UserSession | undefined {
    return this._byWs.get(ws);
  }

  /** Get session by user ID */
  getById(userId: string): UserSession | undefined {
    return this._byId.get(userId);
  }

  /** Get session by display name (for DM) */
  getByName(name: string): UserSession | undefined {
    return this._byName.get(name);
  }

  /** Add a room to the user's joined rooms */
  joinRoom(ws: WebSocket, roomId: string): void {
    const session = this._byWs.get(ws);
    if (session) session.rooms.add(roomId);
  }

  /** Remove a room from the user's joined rooms */
  leaveRoom(ws: WebSocket, roomId: string): void {
    const session = this._byWs.get(ws);
    if (session) session.rooms.delete(roomId);
  }

  /** List all authenticated online users */
  listOnline(): UserInfo[] {
    return [...this._byId.values()]
      .filter((s) => s.authenticated)
      .map((s) => ({
        id: s.id,
        name: s.name,
        rooms: [...s.rooms],
        connectedAt: s.connectedAt,
      }));
  }

  /** Total connected count */
  get count(): number {
    return this._byWs.size;
  }

  /** Authenticated user count */
  get authenticatedCount(): number {
    return this._byName.size;
  }
}
