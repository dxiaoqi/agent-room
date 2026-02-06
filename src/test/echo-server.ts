/**
 * Simple WebSocket echo server for testing AgentRoom.
 *
 * - Echoes all received messages back to the client.
 * - Sends periodic heartbeat messages every 3 seconds.
 * - Responds to "ping" with "pong".
 * - Responds to JSON messages by adding a "server_ts" field.
 *
 * Usage: npx tsx src/test/echo-server.ts [port]
 */

import { WebSocketServer, WebSocket } from "ws";

const port = parseInt(process.argv[2] ?? "8765", 10);

const wss = new WebSocketServer({ port });

console.log(`[Echo Server] WebSocket echo server listening on ws://localhost:${port}`);

wss.on("connection", (ws: WebSocket) => {
  console.log("[Echo Server] Client connected");

  // Send a welcome message
  ws.send(
    JSON.stringify({
      type: "welcome",
      message: "Connected to echo server",
      timestamp: new Date().toISOString(),
    }),
  );

  // Periodic heartbeat
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: "heartbeat",
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }, 3000);

  ws.on("message", (raw: Buffer) => {
    const data = raw.toString("utf-8");
    console.log(`[Echo Server] Received: ${data}`);

    // Try to parse as JSON and add server timestamp
    try {
      const parsed = JSON.parse(data);
      const response = {
        ...parsed,
        server_ts: new Date().toISOString(),
        echo: true,
      };
      ws.send(JSON.stringify(response));
    } catch {
      // Not JSON, echo as-is
      ws.send(`echo: ${data}`);
    }
  });

  ws.on("close", () => {
    console.log("[Echo Server] Client disconnected");
    clearInterval(heartbeat);
  });

  ws.on("error", (err: Error) => {
    console.error("[Echo Server] Error:", err.message);
    clearInterval(heartbeat);
  });
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Echo Server] Shutting down...");
  wss.close(() => {
    process.exit(0);
  });
});
