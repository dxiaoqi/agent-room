#!/usr/bin/env node

import { createAgentRoomServer } from "./server.js";

// ─── CLI Argument Parsing ────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const transport = getArg("transport") ?? "stdio";
const port = parseInt(getArg("port") ?? "3000", 10);

// Service URL: CLI arg > env var > undefined
const serviceUrl = getArg("service-url") ?? process.env.AGENT_ROOM_URL ?? undefined;

// ─── Server Startup ──────────────────────────────────────────────────

async function main(): Promise<void> {
  if (serviceUrl) {
    console.error(`[AgentRoom] Default Service URL: ${serviceUrl}`);
  }

  const mcpServer = createAgentRoomServer({ serviceUrl });

  if (transport === "stdio") {
    await startStdio(mcpServer);
  } else if (transport === "http") {
    await startStreamableHttp(mcpServer, port);
  } else {
    console.error(`Unknown transport: "${transport}". Use "stdio" or "http".`);
    process.exit(1);
  }
}

// ─── stdio Transport ─────────────────────────────────────────────────

async function startStdio(
  mcpServer: Awaited<ReturnType<typeof createAgentRoomServer>>,
): Promise<void> {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );

  const stdioTransport = new StdioServerTransport();
  await mcpServer.connect(stdioTransport);

  console.error("[AgentRoom] Running on stdio transport");
}

// ─── Streamable HTTP Transport ───────────────────────────────────────

async function startStreamableHttp(
  mcpServer: Awaited<ReturnType<typeof createAgentRoomServer>>,
  httpPort: number,
): Promise<void> {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { createServer } = await import("http");
  const { randomUUID } = await import("crypto");

  const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await mcpServer.connect(httpTransport);

  const server = createServer(async (req, res) => {
    // Only handle /mcp endpoint
    const url = new URL(req.url ?? "/", `http://localhost:${httpPort}`);

    if (url.pathname === "/mcp") {
      // Collect body for POST
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          let parsedBody: unknown;
          try {
            parsedBody = JSON.parse(body);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Invalid JSON" }));
            return;
          }
          await httpTransport.handleRequest(req, res, parsedBody);
        });
      } else if (req.method === "GET" || req.method === "DELETE") {
        await httpTransport.handleRequest(req, res);
      } else {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
      }
    } else if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", transport: "http" }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  });

  server.listen(httpPort, () => {
    console.error(
      `[AgentRoom] Running on Streamable HTTP transport at http://localhost:${httpPort}/mcp`,
    );
  });
}

// ─── Run ─────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[AgentRoom] Fatal error:", err);
  process.exit(1);
});
