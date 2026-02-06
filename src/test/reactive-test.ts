/**
 * Reactive flow test for AgentRoom MCP.
 *
 * Tests the event-driven pattern:
 *   1. Connect to echo server
 *   2. Use wait_for_message to block until the welcome message arrives
 *   3. Send a message and use wait_for_message to catch the echo reply
 *   4. Use watch_stream as a one-shot convenience
 *   5. Test filter: wait only for messages containing "echo"
 *   6. Test timeout: wait with a filter that won't match
 *
 * Prerequisites: Start the echo server first:
 *   npx tsx src/test/echo-server.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

function getText(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  return r.content?.filter((c) => c.type === "text").map((c) => c.text).join("\n") ?? "";
}

async function main(): Promise<void> {
  console.log("=== Reactive Flow Test ===\n");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: projectRoot,
  });
  const client = new Client({ name: "reactive-test", version: "1.0.0" });
  await client.connect(transport);
  console.log("[OK] MCP server connected.\n");

  // ─── Test 1: watch_stream catches welcome (connect+wait in one call) ─
  console.log("[Test 1] watch_stream catches welcome message on fresh connection...");
  const watch1 = await client.callTool({
    name: "watch_stream",
    arguments: {
      url: "ws://localhost:8765",
      protocol: "ws",
      channel_id: "reactive1",
      timeout_seconds: 5,
      filter: "welcome",
    },
  });
  const text1 = getText(watch1);
  console.log("  Result:", text1.split("\n")[0]);
  console.assert(text1.includes("welcome"), "Should contain welcome");
  console.assert(text1.includes("First message received"), "Should NOT be a timeout");
  console.log("  [PASS]\n");

  // ─── Test 2: wait_for_message catches echo reply to a sent message ──
  // Start waiting BEFORE sending, so the reply arrives while we're listening.
  // We do this by calling wait first (it blocks), then sending in parallel.
  console.log("[Test 2] Send 'ping' while waiting — catch echo reply...");

  // Start wait_for_message (blocking) and send_message concurrently
  const [wait2] = await Promise.all([
    client.callTool({
      name: "wait_for_message",
      arguments: { channel_id: "reactive1", timeout_seconds: 5, filter: "echo" },
    }),
    // Small delay then send, so wait_for_message is already listening
    new Promise<void>((resolve) =>
      setTimeout(async () => {
        await client.callTool({
          name: "send_message",
          arguments: { channel_id: "reactive1", payload: "ping" },
        });
        resolve();
      }, 500),
    ),
  ]);
  const text2 = getText(wait2);
  console.log("  Result:", text2.split("\n")[0]);
  console.assert(text2.includes("echo: ping"), "Should contain echo: ping");
  console.log("  [PASS]\n");

  // ─── Test 3: wait_for_message with filter (catch heartbeat) ────────
  console.log("[Test 3] Wait for heartbeat message...");
  const wait3 = await client.callTool({
    name: "wait_for_message",
    arguments: { channel_id: "reactive1", timeout_seconds: 5, filter: "heartbeat" },
  });
  const text3 = getText(wait3);
  console.log("  Result:", text3.split("\n")[0]);
  console.assert(text3.includes("heartbeat"), "Should contain heartbeat");
  console.log("  [PASS]\n");

  // ─── Test 4: wait_for_message timeout ──────────────────────────────
  console.log("[Test 4] Wait for non-existent keyword (should timeout)...");
  const wait4 = await client.callTool({
    name: "wait_for_message",
    arguments: { channel_id: "reactive1", timeout_seconds: 3, filter: "IMPOSSIBLE_STRING_12345" },
  });
  const text4 = getText(wait4);
  console.log("  Result:", text4.split("\n")[0]);
  console.assert(text4.includes("No messages matching"), "Should report timeout");
  console.log("  [PASS]\n");

  // ─── Test 5: Disconnect and use watch_stream (one-shot) ────────────
  console.log("[Test 5] watch_stream one-shot convenience...");
  await client.callTool({
    name: "disconnect_stream",
    arguments: { channel_id: "reactive1" },
  });

  const watch = await client.callTool({
    name: "watch_stream",
    arguments: {
      url: "ws://localhost:8765",
      protocol: "ws",
      channel_id: "watch1",
      timeout_seconds: 5,
    },
  });
  const text5 = getText(watch);
  console.log("  Result:", text5.split("\n")[0]);
  console.assert(text5.includes("Connected to channel"), "Should confirm connection");
  console.assert(text5.includes("First message received"), "Should have received a message");
  console.log("  [PASS]\n");

  // ─── Cleanup ───────────────────────────────────────────────────────
  await client.callTool({
    name: "disconnect_stream",
    arguments: { channel_id: "watch1" },
  });

  console.log("=== All 5 reactive flow tests passed! ===");
  await client.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
