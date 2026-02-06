#!/usr/bin/env node

/**
 * Service Integration Test
 *
 * Tests the full Service lifecycle:
 *   1. Start the service
 *   2. Client A connects & authenticates
 *   3. Client B connects & authenticates
 *   4. Create a room, both join
 *   5. A sends a message to the room — B receives it
 *   6. A sends a DM to B — B receives it
 *   7. HTTP API checks (health, rooms, users)
 *   8. Disconnect & cleanup
 *
 * Usage: pnpm run service:test
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer, type Server } from "http";
import { UserManager } from "./user-manager.js";
import { RoomManager } from "./room-manager.js";
import { ServiceWsServer } from "./ws-server.js";
import { HttpApi } from "./http-api.js";
import {
  type ServiceMessage,
  parseServiceMessage,
} from "./protocol.js";

// Use `any` for payload access in tests to avoid verbose casting
type P = any;

// ─── Colors ──────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";

function pass(name: string) { console.log(`  ${GREEN}✓${RESET} ${name}`); }
function fail(name: string, err?: string) { console.log(`  ${RED}✗${RESET} ${name}${err ? ` — ${err}` : ""}`); }

// ─── Test Client ─────────────────────────────────────────────────────

interface TestClient {
  ws: WebSocket;
  messages: ServiceMessage[];
  waitFor: (pred: (m: ServiceMessage) => boolean, ms?: number) => Promise<ServiceMessage>;
  send: (msg: Record<string, unknown>) => void;
  close: () => void;
}

function createClient(url: string): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const messages: ServiceMessage[] = [];
    const waiters: Array<{
      pred: (m: ServiceMessage) => boolean;
      res: (m: ServiceMessage) => void;
      rej: (e: Error) => void;
    }> = [];

    ws.on("open", () => {
      resolve({
        ws,
        messages,
        waitFor: (pred, ms = 5000) => {
          const existing = messages.find(pred);
          if (existing) return Promise.resolve(existing);
          return new Promise((res, rej) => {
            const timer = setTimeout(() => rej(new Error(`waitFor timed out (${ms}ms)`)), ms);
            waiters.push({
              pred,
              res: (m) => { clearTimeout(timer); res(m); },
              rej,
            });
          });
        },
        send: (msg) => ws.send(JSON.stringify(msg)),
        close: () => ws.close(),
      });
    });

    ws.on("message", (raw: Buffer) => {
      const msg = parseServiceMessage(raw.toString("utf-8"));
      if (!msg) return;
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].pred(msg)) {
          waiters.splice(i, 1)[0].res(msg);
        }
      }
    });

    ws.on("error", reject);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

async function runTests() {
  console.log(`${BOLD}╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║       AgentRoom Service — Integration Test        ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════╝${RESET}`);
  console.log();

  const PORT = 19876;
  let httpServer: Server | undefined;
  let passed = 0;
  let failed = 0;

  try {
    // ── 1. Start Service ───────────────────────────────────────────
    const userManager = new UserManager();
    const roomManager = new RoomManager(userManager);
    const httpApi = new HttpApi({ port: PORT, userManager, roomManager });
    httpServer = httpApi.listen(PORT);

    const wss = new WebSocketServer({ server: httpServer });
    const wsServer = new ServiceWsServer(userManager, roomManager, { wss });

    await new Promise((r) => httpServer!.on("listening", r));
    pass("Service started on port " + PORT);
    passed++;

    // ── 2. Client A connects ───────────────────────────────────────
    const clientA = await createClient(`ws://localhost:${PORT}`);
    const welcomeA = await clientA.waitFor((m) => m.type === "system");
    pass(`Client A connected (userId: ${(welcomeA.payload as any).user_id})`);
    passed++;

    // ── 3. Client A authenticates ──────────────────────────────────
    clientA.send({ type: "action", from: "a", payload: { action: "auth", name: "Alice" } });
    const authA = await clientA.waitFor(
      (m) => m.type === "response" && (m.payload as P).action === "auth",
    );
    if ((authA.payload as P).success) {
      pass("Client A authenticated as 'Alice'");
      passed++;
    } else {
      fail("Client A auth", (authA.payload as P).error);
      failed++;
    }

    // ── 4. Client B connects & authenticates ───────────────────────
    const clientB = await createClient(`ws://localhost:${PORT}`);
    await clientB.waitFor((m) => m.type === "system");
    clientB.send({ type: "action", from: "b", payload: { action: "auth", name: "Bob" } });
    const authB = await clientB.waitFor(
      (m) => m.type === "response" && (m.payload as P).action === "auth",
    );
    if ((authB.payload as P).success) {
      pass("Client B authenticated as 'Bob'");
      passed++;
    } else {
      fail("Client B auth", (authB.payload as P).error);
      failed++;
    }

    // ── 5. List rooms (should have defaults) ───────────────────────
    clientA.send({ type: "action", from: "a", payload: { action: "room.list" } });
    const roomList = await clientA.waitFor(
      (m) => m.type === "response" && (m.payload as P).action === "room.list",
    );
    const rooms = (roomList.payload as P).data.rooms;
    if (rooms.length >= 2) {
      pass(`Default rooms exist: ${rooms.map((r: any) => r.id).join(", ")}`);
      passed++;
    } else {
      fail("Default rooms", `Expected >= 2, got ${rooms.length}`);
      failed++;
    }

    // ── 6. Both join "general" ─────────────────────────────────────
    clientA.send({ type: "action", from: "a", payload: { action: "room.join", room_id: "general" } });
    const joinA = await clientA.waitFor(
      (m) => m.type === "response" && (m.payload as P).action === "room.join",
    );
    if ((joinA.payload as P).success) {
      pass("Alice joined #general");
      passed++;
    } else {
      fail("Alice join general", (joinA.payload as P).error);
      failed++;
    }

    clientB.send({ type: "action", from: "b", payload: { action: "room.join", room_id: "general" } });
    const joinB = await clientB.waitFor(
      (m) => m.type === "response" && (m.payload as P).action === "room.join",
    );
    if ((joinB.payload as P).success) {
      pass("Bob joined #general");
      passed++;
    } else {
      fail("Bob join general", (joinB.payload as P).error);
      failed++;
    }

    // Alice should receive a notification that Bob joined
    const bobJoinedNotif = await clientA.waitFor(
      (m) => m.type === "system" && (m.payload as any).event === "user.joined" && (m.payload as any).user_name === "Bob",
    );
    pass("Alice received 'Bob joined' notification");
    passed++;

    // ── 7. Room message: Alice → #general → Bob receives ──────────
    clientA.send({
      type: "chat",
      from: "Alice",
      to: "room:general",
      payload: { message: "Hello everyone!" },
    });

    const roomMsgB = await clientB.waitFor(
      (m) => m.type === "chat" && (m.payload as P).message === "Hello everyone!",
    );
    pass(`Bob received room message: "${(roomMsgB.payload as P).message}" from ${roomMsgB.from}`);
    passed++;

    // ── 8. DM: Alice → Bob (private) ──────────────────────────────
    clientA.send({
      type: "action",
      from: "a",
      payload: { action: "dm", to: "Bob", message: "Hey Bob, private message!" },
    });

    const dmB = await clientB.waitFor(
      (m) => m.type === "chat" && (m.payload as P).dm === true,
    );
    pass(`Bob received DM: "${(dmB.payload as P).message}" from ${dmB.from}`);
    passed++;

    // ── 9. Create a new room ──────────────────────────────────────
    clientA.send({
      type: "action",
      from: "a",
      payload: { action: "room.create", room_id: "dev-ops", name: "DevOps", description: "Operations room" },
    });
    const createRoom = await clientA.waitFor(
      (m) => m.type === "response" && (m.payload as P).action === "room.create",
    );
    if ((createRoom.payload as P).success) {
      pass("Room 'dev-ops' created");
      passed++;
    } else {
      fail("Create room", (createRoom.payload as P).error);
      failed++;
    }

    // ── 10. HTTP API ──────────────────────────────────────────────
    const healthRes = await fetch(`http://localhost:${PORT}/health`);
    const health = await healthRes.json() as any;
    if (health.status === "ok") {
      pass("HTTP /health returns ok");
      passed++;
    } else {
      fail("HTTP /health");
      failed++;
    }

    const statsRes = await fetch(`http://localhost:${PORT}/stats`);
    const stats = await statsRes.json() as any;
    if (stats.connections === 2 && stats.rooms >= 3) {
      pass(`HTTP /stats: ${stats.connections} connections, ${stats.rooms} rooms`);
      passed++;
    } else {
      fail("HTTP /stats", JSON.stringify(stats));
      failed++;
    }

    const roomsRes = await fetch(`http://localhost:${PORT}/rooms`);
    const roomsData = await roomsRes.json() as any;
    if (roomsData.rooms.find((r: any) => r.id === "dev-ops")) {
      pass("HTTP /rooms includes 'dev-ops'");
      passed++;
    } else {
      fail("HTTP /rooms missing 'dev-ops'");
      failed++;
    }

    const usersRes = await fetch(`http://localhost:${PORT}/users`);
    const usersData = await usersRes.json() as any;
    if (usersData.users.length === 2) {
      pass(`HTTP /users: ${usersData.users.map((u: any) => u.name).join(", ")}`);
      passed++;
    } else {
      fail("HTTP /users", JSON.stringify(usersData));
      failed++;
    }

    // ── 11. Disconnect ────────────────────────────────────────────
    clientA.close();
    clientB.close();
    await new Promise((r) => setTimeout(r, 200));
    pass("Clients disconnected");
    passed++;

    wsServer.close();
  } catch (err) {
    fail("Test error", (err as Error).message);
    failed++;
  } finally {
    httpServer?.close();
  }

  // ── Summary ────────────────────────────────────────────────────────
  console.log();
  console.log(`${"─".repeat(50)}`);
  console.log(`  ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : DIM}${failed} failed${RESET}`);
  console.log();

  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 300);
}

runTests().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
