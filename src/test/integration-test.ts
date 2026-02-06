/**
 * Integration test for AgentRoom.
 *
 * Prerequisites: Start the echo server first:
 *   npx tsx src/test/echo-server.ts
 *
 * Then run this test:
 *   npx tsx src/test/integration-test.ts
 *
 * This test uses the MCP Client SDK to talk to our server via stdio transport.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log("=== AgentRoom Integration Test ===\n");

  // ─── 1. Start MCP server as child process via stdio ────────────────

  console.log("[1] Starting MCP server via stdio transport...");

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts"],
    cwd: projectRoot,
  });

  const client = new Client({
    name: "test-client",
    version: "1.0.0",
  });

  await client.connect(transport);
  console.log("    Connected to MCP server.\n");

  // ─── 2. List tools ─────────────────────────────────────────────────

  console.log("[2] Listing available tools...");
  const tools = await client.listTools();
  for (const tool of tools.tools) {
    console.log(`    - ${tool.name}: ${tool.description?.slice(0, 80)}...`);
  }
  console.log();

  // ─── 3. List resources ─────────────────────────────────────────────

  console.log("[3] Listing available resources...");
  const resources = await client.listResources();
  for (const res of resources.resources) {
    console.log(`    - ${res.uri}: ${res.name}`);
  }
  console.log();

  // ─── 4. Connect to echo server ─────────────────────────────────────

  console.log("[4] Connecting to WebSocket echo server...");
  const connectResult = await client.callTool({
    name: "connect_stream",
    arguments: {
      url: "ws://localhost:8765",
      protocol: "ws",
      channel_id: "echo1",
    },
  });
  console.log("    Result:", getTextContent(connectResult));
  console.log();

  // ─── 5. Wait for welcome + heartbeat messages ─────────────────────

  console.log("[5] Waiting 4s for welcome + heartbeat messages...");
  await sleep(4000);

  // ─── 6. Read recent messages ───────────────────────────────────────

  console.log("[6] Reading recent messages from stream...");
  const recentResource = await client.readResource({
    uri: "stream://echo1/messages/recent",
  });
  for (const content of recentResource.contents) {
    console.log("    ---");
    console.log(
      "   ",
      ("text" in content ? (content.text as string) : "").split("\n").join("\n    "),
    );
  }
  console.log();

  // ─── 7. Send a message ─────────────────────────────────────────────

  console.log('[7] Sending message: {"action":"restart","service":"db"}...');
  const sendResult = await client.callTool({
    name: "send_message",
    arguments: {
      channel_id: "echo1",
      payload: JSON.stringify({ action: "restart", service: "db" }),
      format: "json",
    },
  });
  console.log("    Result:", getTextContent(sendResult));
  console.log();

  // ─── 8. Wait for echo reply ────────────────────────────────────────

  console.log("[8] Waiting 1s for echo reply...");
  await sleep(1000);

  // ─── 9. Read latest message ────────────────────────────────────────

  console.log("[9] Reading latest message...");
  const latestResource = await client.readResource({
    uri: "stream://echo1/messages/latest",
  });
  for (const content of latestResource.contents) {
    console.log("    ---");
    console.log(
      "   ",
      ("text" in content ? (content.text as string) : "").split("\n").join("\n    "),
    );
  }
  console.log();

  // ─── 10. Check connection status ───────────────────────────────────

  console.log("[10] Reading connection status...");
  const statusResource = await client.readResource({
    uri: "connection://status",
  });
  for (const content of statusResource.contents) {
    console.log("    ", "text" in content ? content.text : "");
  }
  console.log();

  // ─── 11. List connections via tool ─────────────────────────────────

  console.log("[11] Listing connections via tool...");
  const listResult = await client.callTool({
    name: "list_connections",
    arguments: {},
  });
  console.log("    Result:", getTextContent(listResult));
  console.log();

  // ─── 12. Disconnect ────────────────────────────────────────────────

  console.log("[12] Disconnecting channel echo1...");
  const disconnectResult = await client.callTool({
    name: "disconnect_stream",
    arguments: {
      channel_id: "echo1",
    },
  });
  console.log("    Result:", getTextContent(disconnectResult));
  console.log();

  // ─── 13. Verify disconnected ───────────────────────────────────────

  console.log("[13] Verifying no connections remain...");
  const finalList = await client.callTool({
    name: "list_connections",
    arguments: {},
  });
  console.log("    Result:", getTextContent(finalList));
  console.log();

  // ─── Done ──────────────────────────────────────────────────────────

  console.log("=== All tests passed! ===");

  await client.close();
  process.exit(0);
}

function getTextContent(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text?: string }> };
  if (r.content) {
    return r.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text)
      .join("\n");
  }
  return JSON.stringify(result);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
