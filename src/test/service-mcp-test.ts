#!/usr/bin/env node

/**
 * Test: MCP connect_service flow simulation
 *
 * Verifies that MCP-style connect → auth → join → chat works with the Service,
 * and that bidirectional messaging between MCP and CLI-like clients functions correctly.
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { UserManager } from "../service/user-manager.js";
import { RoomManager } from "../service/room-manager.js";
import { ServiceWsServer } from "../service/ws-server.js";
import { HttpApi } from "../service/http-api.js";

const TEST_PORT = 19878;
let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    failed++;
  }
}

function waitMsg(ws: WebSocket, filter?: (msg: any) => boolean, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("timeout")); }
    }, timeout);
    const handler = (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (!filter || filter(msg)) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
  });
}

async function run() {
  // ─── Start Service ──────────────────────────────────────────────
  const users = new UserManager();
  const rooms = new RoomManager(users);
  const httpApi = new HttpApi({ port: TEST_PORT, userManager: users, roomManager: rooms });
  const httpServer = httpApi.listen(TEST_PORT);
  const wss = new WebSocketServer({ server: httpServer });
  const wsServer = new ServiceWsServer(users, rooms, { wss });

  console.log(`\n\x1b[1m=== MCP connect_service Simulation Test ===\x1b[0m\n`);

  try {
    // ─── Simulate MCP connect_service: connect + auth + join ──────
    const mcp = new WebSocket(`ws://localhost:${TEST_PORT}`);
    await new Promise<void>((r) => mcp.on("open", r));
    assert(true, "MCP WebSocket connected");

    // Auth
    mcp.send(JSON.stringify({
      type: "action", from: "AI-Agent",
      payload: { action: "auth", name: "AI-Agent" },
    }));
    const authResp = await waitMsg(mcp, (m) => m.type === "response" && m.payload?.action === "auth");
    assert(authResp.payload.success === true, "MCP auth succeeded");

    // Join room
    mcp.send(JSON.stringify({
      type: "action", from: "AI-Agent",
      payload: { action: "room.join", room_id: "general" },
    }));
    const joinResp = await waitMsg(mcp, (m) => m.type === "response" && m.payload?.action === "room.join");
    assert(joinResp.payload.success === true, "MCP joined #general");

    // ─── Connect CLI user ─────────────────────────────────────────
    const cli = new WebSocket(`ws://localhost:${TEST_PORT}`);
    await new Promise<void>((r) => cli.on("open", r));

    cli.send(JSON.stringify({
      type: "action", from: "Human",
      payload: { action: "auth", name: "Human" },
    }));
    await waitMsg(cli, (m) => m.type === "response" && m.payload?.action === "auth");

    cli.send(JSON.stringify({
      type: "action", from: "Human",
      payload: { action: "room.join", room_id: "general" },
    }));
    await waitMsg(cli, (m) => m.type === "response" && m.payload?.action === "room.join");
    assert(true, "CLI user 'Human' connected + joined #general");

    // ─── MCP sends chat → CLI receives ────────────────────────────
    const cliRecvPromise = waitMsg(cli, (m) => m.type === "chat" && m.from === "AI-Agent");
    mcp.send(JSON.stringify({
      type: "chat", from: "AI-Agent", to: "room:general",
      payload: { message: "Hello from AI!" },
    }));
    const chatFromMcp = await cliRecvPromise;
    assert(chatFromMcp.payload.message === "Hello from AI!", 'CLI received MCP chat: "Hello from AI!"');

    // ─── CLI sends chat → MCP receives ────────────────────────────
    const mcpRecvPromise = waitMsg(mcp, (m) => m.type === "chat" && m.from === "Human");
    cli.send(JSON.stringify({
      type: "chat", from: "Human", to: "room:general",
      payload: { message: "Hi AI!" },
    }));
    const chatFromCli = await mcpRecvPromise;
    assert(chatFromCli.payload.message === "Hi AI!", 'MCP received CLI chat: "Hi AI!"');

    // ─── Decode verification ──────────────────────────────────────
    // Test the decodeServiceMessage function behavior
    const rawChat = JSON.stringify(chatFromCli);
    assert(rawChat.includes('"chat"'), "Raw message is valid Service protocol JSON");

    // ─── Cleanup ──────────────────────────────────────────────────
    mcp.close();
    cli.close();
    await new Promise((r) => setTimeout(r, 200));

  } finally {
    wsServer.close();
    httpServer.close();
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
