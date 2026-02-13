#!/usr/bin/env node

/**
 * AgentRoom Service — Real-time messaging service with rooms and DM.
 *
 * Deployable on any cloud server. Provides:
 *   - WebSocket for real-time messaging (rooms + DM)
 *   - HTTP API for room discovery, health check, stats
 *
 * Env vars:
 *   PORT      — HTTP + WebSocket port (default: 9000)
 *   HOST      — Bind address (default: 0.0.0.0)
 *
 * Usage:
 *   npx tsx src/service/index.ts
 *   PORT=8080 npx tsx src/service/index.ts
 *
 * Docker:
 *   docker build -t agent-room-service .
 *   docker run -p 9000:9000 agent-room-service
 */

import { WebSocketServer } from "ws";
import { UserManager } from "./user-manager.js";
import { RoomManager } from "./room-manager.js";
import { ServiceWsServer } from "./ws-server.js";
import { HttpApi } from "./http-api.js";

// ─── Config ──────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "9000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

// ─── Start ───────────────────────────────────────────────────────────

function main(): void {
  // Core managers
  const userManager = new UserManager();
  const roomManager = new RoomManager(userManager);

  // Cleanup zombie connections every 30 seconds
  const cleanupInterval = setInterval(() => {
    const cleaned = userManager.cleanupZombieConnections();
    if (cleaned > 0) {
      console.log(`[Service] Periodic cleanup: removed ${cleaned} zombie connection(s)`);
    }
  }, 30000); // 30 seconds

  // HTTP API
  const httpApi = new HttpApi({
    port: PORT,
    userManager,
    roomManager,
  });
  const httpServer = httpApi.listen(PORT);

  // WebSocket server — share the HTTP server so both run on the same port
  const wss = new WebSocketServer({ server: httpServer });
  const wsServer = new ServiceWsServer(userManager, roomManager, { wss });

  httpServer.on("listening", () => {
    console.log("");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║          AgentRoom Service                        ║");
    console.log("╚══════════════════════════════════════════════════╝");
    console.log("");
    console.log(`  WebSocket:  ws://${HOST}:${PORT}`);
    console.log(`  HTTP API:   http://${HOST}:${PORT}`);
    console.log("");
    console.log("  Endpoints:");
    console.log("    GET /health   — health check");
    console.log("    GET /stats    — connection & room stats");
    console.log("    GET /rooms    — list all rooms");
    console.log("    GET /users    — list online users");
    console.log("    GET /metrics  — performance & error metrics");
    console.log("");
    console.log("  Default rooms: general, random");
    console.log("");
    console.log("  Ready for connections.");
    console.log("");
  });

  // ─── Graceful shutdown ─────────────────────────────────────────────

  const shutdown = () => {
    console.log("\n[Service] Shutting down...");
    clearInterval(cleanupInterval); // Stop cleanup task
    wsServer.close();
    httpServer.close(() => {
      console.log("[Service] Goodbye.");
      process.exit(0);
    });
    // Force exit after 5 seconds
    setTimeout(() => process.exit(0), 5000);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
