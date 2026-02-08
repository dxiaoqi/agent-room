/**
 * User Manager — manages connected user sessions.
 *
 * Each WebSocket connection maps to one user session.
 * Users authenticate with a name (and optional token).
 *
 * Supports reconnect tokens: on first auth the server assigns a long-lived
 * token. If the same name reconnects with the correct token, the old session
 * is seamlessly taken over (old WebSocket is closed, new one inherits rooms).
 */

import { randomUUID } from "crypto";
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
  /** Reconnect token (server-assigned, long-lived) */
  token?: string;
}

export interface UserInfo {
  id: string;
  name: string;
  rooms: string[];
  connectedAt: string;
}

/** Persisted identity record — survives disconnection. */
interface PersistedIdentity {
  /** The reconnect token (never changes once assigned) */
  token: string;
  /** The last known user ID */
  lastUserId: string;
  /** The rooms the user was in (preserved for session takeover) */
  rooms: Set<string>;
  /** When the identity was first created */
  createdAt: string;
}

export interface AuthResult {
  success: boolean;
  userId: string;
  /** The reconnect token (returned on successful auth) */
  token?: string;
  /** Whether this auth was a session takeover (reconnection) */
  reconnected?: boolean;
  /** The rooms restored from previous session (on reconnect) */
  restoredRooms?: string[];
  error?: string;
}

// ─── Manager ─────────────────────────────────────────────────────────

export class UserManager {
  /** ws → UserSession */
  private _byWs = new Map<WebSocket, UserSession>();
  /** userId → UserSession */
  private _byId = new Map<string, UserSession>();
  /** name → UserSession (for DM by name, only online sessions) */
  private _byName = new Map<string, UserSession>();

  /**
   * Persisted identity store — maps name → token + metadata.
   * Survives disconnection so the same name can reconnect with its token.
   */
  private _identities = new Map<string, PersistedIdentity>();

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
   *
   * Token-based reconnection:
   * - If `token` matches the stored token for `name`, the old session is taken
   *   over: old WebSocket is closed, the new connection inherits the identity
   *   and rooms. This avoids "name already taken" failures on reconnect.
   * - If no token is provided and the name is free, a new token is generated
   *   and returned.
   * - If no token is provided but the name is taken, auth fails.
   *
   * Returns the assigned token on success so the client can store it for
   * future reconnections.
   */
  authenticate(ws: WebSocket, name: string, token?: string): AuthResult {
    const session = this._byWs.get(ws);
    if (!session) {
      return { success: false, userId: "", error: "Not connected" };
    }

    const existing = this._byName.get(name);
    const identity = this._identities.get(name);

    // ── Case 1: Name is taken by another active connection ──────────
    if (existing && existing.ws !== ws) {
      // Check if reconnect token matches
      if (token && identity && identity.token === token) {
        // Session takeover: close old WebSocket, inherit identity
        return this._takeOverSession(ws, session, existing, identity);
      }

      // No token or wrong token → reject
      if (token && identity) {
        return { success: false, userId: session.id, error: `Invalid reconnect token for "${name}"` };
      }
      return { success: false, userId: session.id, error: `Name "${name}" is already taken` };
    }

    // ── Case 2: Name is free but we have a persisted identity ───────
    if (!existing && identity) {
      if (token && identity.token === token) {
        // Reconnection after disconnect — restore identity
        return this._restoreSession(ws, session, name, identity);
      }
      if (token) {
        return { success: false, userId: session.id, error: `Invalid reconnect token for "${name}"` };
      }
      // No token provided, name is free → allow (new identity replaces old)
    }

    // ── Case 3: Fresh authentication (name is free, no conflict) ────
    // Remove old name mapping if re-authing
    if (session.authenticated) {
      this._byName.delete(session.name);
    }

    // Generate a new reconnect token
    const newToken = token && identity?.token === token
      ? token
      : randomUUID();

    session.name = name;
    session.token = newToken;
    session.authenticated = true;
    this._byName.set(name, session);

    // Persist identity
    this._identities.set(name, {
      token: newToken,
      lastUserId: session.id,
      rooms: session.rooms,
      createdAt: new Date().toISOString(),
    });

    return { success: true, userId: session.id, token: newToken };
  }

  /**
   * Take over an active session (old WS is still connected).
   * Closes the old WebSocket and transfers identity to the new one.
   */
  private _takeOverSession(
    newWs: WebSocket,
    newSession: UserSession,
    oldSession: UserSession,
    identity: PersistedIdentity,
  ): AuthResult {
    const name = oldSession.name;
    const restoredRooms = [...oldSession.rooms];

    // Close old WebSocket silently (code 4001 = superseded by reconnect)
    try {
      oldSession.ws.close(4001, "Session taken over by reconnect");
    } catch { /* ignore */ }

    // Clean up old session mappings
    this._byWs.delete(oldSession.ws);
    this._byId.delete(oldSession.id);
    this._byName.delete(name);

    // Configure new session with old identity
    newSession.name = name;
    newSession.token = identity.token;
    newSession.authenticated = true;
    newSession.rooms = new Set(restoredRooms);

    // Set up new mappings
    this._byName.set(name, newSession);

    // Update persisted identity
    identity.lastUserId = newSession.id;
    identity.rooms = newSession.rooms;

    return {
      success: true,
      userId: newSession.id,
      token: identity.token,
      reconnected: true,
      restoredRooms,
    };
  }

  /**
   * Restore a session after disconnect (old WS is gone, but identity persists).
   */
  private _restoreSession(
    ws: WebSocket,
    session: UserSession,
    name: string,
    identity: PersistedIdentity,
  ): AuthResult {
    const restoredRooms = [...identity.rooms];

    // Remove old name mapping if re-authing
    if (session.authenticated) {
      this._byName.delete(session.name);
    }

    session.name = name;
    session.token = identity.token;
    session.authenticated = true;
    session.rooms = new Set(restoredRooms);

    this._byName.set(name, session);

    // Update persisted identity
    identity.lastUserId = session.id;
    identity.rooms = session.rooms;

    return {
      success: true,
      userId: session.id,
      token: identity.token,
      reconnected: true,
      restoredRooms,
    };
  }

  /** Remove a user (on disconnect). Returns the session for cleanup.
   *  Note: the persisted identity is NOT removed, allowing future reconnection. */
  remove(ws: WebSocket): UserSession | undefined {
    const session = this._byWs.get(ws);
    if (!session) return undefined;

    this._byWs.delete(ws);
    this._byId.delete(session.id);
    if (session.authenticated) {
      this._byName.delete(session.name);

      // Update persisted identity with last-known rooms
      const identity = this._identities.get(session.name);
      if (identity) {
        identity.rooms = new Set(session.rooms);
        identity.lastUserId = session.id;
      }
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

  /** Check if a persisted identity exists for a name */
  hasIdentity(name: string): boolean {
    return this._identities.has(name);
  }

  /** Get the reconnect token for a name (if identity exists) */
  getTokenForName(name: string): string | undefined {
    return this._identities.get(name)?.token;
  }

  /** Add a room to the user's joined rooms */
  joinRoom(ws: WebSocket, roomId: string): void {
    const session = this._byWs.get(ws);
    if (session) {
      session.rooms.add(roomId);
      // Also update persisted identity
      const identity = this._identities.get(session.name);
      if (identity) identity.rooms.add(roomId);
    }
  }

  /** Remove a room from the user's joined rooms */
  leaveRoom(ws: WebSocket, roomId: string): void {
    const session = this._byWs.get(ws);
    if (session) {
      session.rooms.delete(roomId);
      // Also update persisted identity
      const identity = this._identities.get(session.name);
      if (identity) identity.rooms.delete(roomId);
    }
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

  /** Number of persisted identities (including offline users) */
  get identityCount(): number {
    return this._identities.size;
  }
}
