import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ConnectionManager } from "./core/connection-manager.js";
import { MessageBuffer } from "./core/message-buffer.js";
import { NotificationEngine } from "./core/notification-engine.js";
import { Logger } from "./core/logger.js";

const log = Logger.create("mcp-server");

// ─── Service channel metadata ─────────────────────────────────────────

interface ServiceChannelInfo {
  name: string;
  room: string;
  url: string;
  joinedRooms: Set<string>;
  /** Reconnect token assigned by the service on auth. Used for seamless reconnection. */
  reconnectToken?: string;
}

/**
 * Persistent token store: maps "url|name" → reconnect token.
 * Allows MCP to automatically reconnect without re-authentication issues.
 */
const reconnectTokenStore = new Map<string, string>();

function tokenStoreKey(url: string, name: string): string {
  return `${url}|${name}`;
}

/**
 * Decode a raw Service protocol JSON string into a human-readable line.
 * Returns null if not a valid Service message.
 */
function decodeServiceMessage(raw: string): string | null {
  try {
    const msg = JSON.parse(raw);
    if (typeof msg !== "object" || !msg || !msg.type) return null;
    const p = msg.payload ?? {};
    const ts = msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("en-US", { hour12: false }) : "";
    const prefix = ts ? `[${ts}]` : "";

    switch (msg.type) {
      case "chat": {
        const dm = p.dm ? " [DM]" : "";
        const room = p.room ? ` #${p.room}` : "";
        return `${prefix}${room}${dm} ${msg.from}: ${p.message}`;
      }
      case "system": {
        switch (p.event) {
          case "welcome":
            return `${prefix} [system] Connected — ${p.message}`;
          case "user.joined":
            return `${prefix} [system] ${p.user_name} joined #${p.room_id}`;
          case "user.left":
            return `${prefix} [system] ${p.user_name} left #${p.room_id}`;
          case "room.history":
            const msgs = (p.messages as any[]) ?? [];
            return `${prefix} [system] Room history: ${msgs.length} message(s)`;
          default:
            return `${prefix} [system:${p.event}] ${JSON.stringify(p)}`;
        }
      }
      case "response":
        return `${prefix} [response:${p.action}] ${p.success ? "ok" : `error: ${p.error}`}`;
      case "error":
        return `${prefix} [error ${p.code}] ${p.message}`;
      default:
        return `${prefix} [${msg.type}] ${JSON.stringify(p)}`;
    }
  } catch {
    return null;
  }
}

// ─── Server Options ───────────────────────────────────────────────────

export interface AgentRoomServerOptions {
  /** Default Service WebSocket URL. Read from AGENT_ROOM_URL env var or --service-url CLI arg. */
  serviceUrl?: string;
}

/**
 * Create and configure the AgentRoom MCP server with all tools and resources.
 */
export function createAgentRoomServer(options: AgentRoomServerOptions = {}): McpServer {
  const defaultServiceUrl = options.serviceUrl;

  // ─── Core services ─────────────────────────────────────────────────

  const connectionManager = new ConnectionManager();
  const messageBuffer = new MessageBuffer(50);
  const notificationEngine = new NotificationEngine(1_000);

  /** Tracks which channels are connected via connect_service (Service protocol aware) */
  const serviceChannels = new Map<string, ServiceChannelInfo>();

  // ─── MCP Server ────────────────────────────────────────────────────

  const mcpServer = new McpServer(
    {
      name: "agent-room",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: { subscribe: true },
        tools: {},
        logging: {},
      },
    },
  );

  // Attach the low-level Server instance to the notification engine
  notificationEngine.setServer(mcpServer.server);

  // ─── Wire ConnectionManager events ─────────────────────────────────

  connectionManager.on("message", (channelId: string, data: string) => {
    // For service channels, decode protocol messages into readable text
    const svcInfo = serviceChannels.get(channelId);
    let bufferData = data;
    if (svcInfo) {
      const decoded = decodeServiceMessage(data);
      if (decoded) {
        bufferData = decoded;
      }
    }

    // Buffer the (possibly decoded) message
    messageBuffer.push(channelId, bufferData);

    // Notify AI that the stream resource has been updated
    const recentUri = `stream://${channelId}/messages/recent`;
    notificationEngine.notifyResourceUpdated(channelId, recentUri);
  });

  // ─── Tools ─────────────────────────────────────────────────────────

  // Tool: connect_stream
  mcpServer.tool(
    "connect_stream",
    "Establish a new stream connection to a WebSocket or SSE endpoint. Returns the channel ID for subsequent operations.",
    {
      url: z.string().describe("The WebSocket (ws:// or wss://) or SSE (http:// or https://) URL to connect to"),
      protocol: z.enum(["ws", "sse"]).describe("The streaming protocol to use"),
      channel_id: z.string().optional().describe("Optional custom channel ID. Auto-generated if not provided."),
      auth_token: z.string().optional().describe("Optional bearer token for authentication"),
      headers: z.record(z.string(), z.string()).optional().describe("Optional custom headers to send on connect"),
    },
    async ({ url, protocol, channel_id, auth_token, headers }) => {
      const done = log.time("tool.connect_stream", { url, protocol });
      try {
        const channelId = await connectionManager.connect(url, protocol, channel_id, {
          authToken: auth_token,
          headers,
        });

        done({ channelId });
        return {
          content: [
            {
              type: "text" as const,
              text: `Connected to ${protocol.toUpperCase()} stream.\n\nChannel ID: ${channelId}\nURL: ${url}\nProtocol: ${protocol}\nStatus: connected\n\nUse this channel_id for send_message, disconnect_stream, and to read stream resources.`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("tool.connect_stream failed", { url, protocol }, err);
        return {
          content: [{ type: "text" as const, text: `Failed to connect: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: disconnect_stream
  mcpServer.tool(
    "disconnect_stream",
    "Disconnect and close a specific stream connection.",
    {
      channel_id: z.string().describe("The channel ID to disconnect"),
    },
    async ({ channel_id }) => {
      try {
        await connectionManager.disconnect(channel_id);
        messageBuffer.clear(channel_id);
        serviceChannels.delete(channel_id); // Clean up service metadata if any
        return {
          content: [
            {
              type: "text" as const,
              text: `Channel "${channel_id}" disconnected and buffer cleared.`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Failed to disconnect: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: list_connections
  mcpServer.tool(
    "list_connections",
    "List all active stream connections and their current status.",
    {},
    async () => {
      const connections = connectionManager.listConnections();
      if (connections.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No active connections." }],
        };
      }

      const summary = connections
        .map((c) => {
          return [
            `Channel: ${c.channelId}`,
            `  URL: ${c.url}`,
            `  Protocol: ${c.protocol}`,
            `  State: ${c.state}`,
            `  Connected at: ${c.connectedAt ?? "N/A"}`,
            `  Messages received: ${c.messageCount}`,
          ].join("\n");
        })
        .join("\n\n");

      return {
        content: [{ type: "text" as const, text: summary }],
      };
    },
  );

  // Tool: send_message
  mcpServer.tool(
    "send_message",
    "Send a message to the cloud through an active stream connection. Only works for WebSocket connections (SSE is receive-only).",
    {
      channel_id: z.string().describe("The channel ID to send through"),
      payload: z.string().describe("The message payload to send. For Service channels (connected via connect_service), this is the chat text — it will be auto-wrapped in the Service protocol."),
      format: z.enum(["text", "json"]).optional().describe("Optional format hint. If 'json', the payload is validated as JSON before sending. For Service channels, 'json' sends raw protocol (bypass auto-wrap)."),
    },
    async ({ channel_id, payload, format }) => {
      try {
        // Check if this is a service channel
        const svcInfo = serviceChannels.get(channel_id);

        if (svcInfo && format !== "json") {
          // Auto-wrap plain text as a Service chat message
          const wrapped = JSON.stringify({
            type: "chat",
            from: svcInfo.name,
            to: `room:${svcInfo.room}`,
            payload: { message: payload },
          });
          await connectionManager.send(channel_id, wrapped);

          return {
            content: [{
              type: "text" as const,
              text: `Chat sent to #${svcInfo.room} as "${svcInfo.name}" at ${new Date().toISOString()}.\n\nMessage: ${payload}`,
            }],
          };
        }

        // Raw send for non-service channels (or json format override)
        if (format === "json") {
          try {
            JSON.parse(payload);
          } catch {
            return {
              content: [{ type: "text" as const, text: "Invalid JSON payload. Please provide valid JSON." }],
              isError: true,
            };
          }
        }

        await connectionManager.send(channel_id, payload);

        return {
          content: [
            {
              type: "text" as const,
              text: `Message sent to channel "${channel_id}" at ${new Date().toISOString()}.\n\nPayload: ${payload.length > 200 ? payload.slice(0, 200) + "..." : payload}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Failed to send: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: read_history
  mcpServer.tool(
    "read_history",
    "Read buffered message history from a stream channel. Returns the most recent messages stored in the sliding window buffer (up to 50). Use this to review what has already been received without waiting for new messages.",
    {
      channel_id: z.string().describe("The channel ID to read history from"),
      count: z.number().optional().describe("Number of recent messages to return (default 20, max 50)"),
      filter: z.string().optional().describe("Only return messages whose text contains this substring"),
      format: z.enum(["text", "json"]).optional().describe("Output format: 'text' (default, human-readable) or 'json' (structured array)"),
    },
    async ({ channel_id, count, filter, format }) => {
      try {
        if (!connectionManager.has(channel_id)) {
          return {
            content: [{ type: "text" as const, text: `Channel "${channel_id}" not found. Connect first using connect_stream.` }],
            isError: true,
          };
        }

        const n = Math.min(Math.max(count ?? 20, 1), 50);
        let messages = messageBuffer.getRecent(channel_id, n);

        // Apply filter if provided
        if (filter) {
          messages = messages.filter((m) => m.raw.includes(filter));
        }

        if (messages.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: filter
                ? `No messages matching "${filter}" in channel "${channel_id}" history.`
                : `No messages in channel "${channel_id}" history yet.`,
            }],
          };
        }

        let output: string;
        if (format === "json") {
          output = JSON.stringify(
            messages.map((m) => ({
              id: m.id,
              timestamp: m.timestamp,
              data: m.data,
            })),
            null,
            2,
          );
        } else {
          output = messageBuffer.formatForDisplay(messages);
        }

        const info = connectionManager.getConnectionInfo(channel_id);
        const header = `Channel "${channel_id}" history — ${messages.length} message(s)${filter ? ` matching "${filter}"` : ""} (total buffered: ${messageBuffer.getAll(channel_id).length}, connection: ${info?.state ?? "unknown"})`;

        return {
          content: [{ type: "text" as const, text: `${header}\n\n${output}` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error reading history: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: get_unread_messages
  mcpServer.tool(
    "get_unread_messages",
    "Get unread messages from a stream channel. Returns only messages received since the last time messages were marked as read. Use mark_as_read=true to advance the read cursor after fetching. Useful for checking what's new without re-reading the entire history.",
    {
      channel_id: z.string().describe("The channel ID to check for unread messages"),
      mark_as_read: z.boolean().optional().describe("If true, mark all returned messages as read (advance the cursor). Default: true"),
      format: z.enum(["text", "json"]).optional().describe("Output format: 'text' (default, human-readable) or 'json' (structured array)"),
    },
    async ({ channel_id, mark_as_read, format }) => {
      try {
        if (!connectionManager.has(channel_id)) {
          return {
            content: [{ type: "text" as const, text: `Channel "${channel_id}" not found. Connect first using connect_stream.` }],
            isError: true,
          };
        }

        const unread = messageBuffer.getUnread(channel_id);
        const totalBuffered = messageBuffer.getAll(channel_id).length;

        if (unread.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No unread messages on channel "${channel_id}" (total buffered: ${totalBuffered}).`,
            }],
          };
        }

        // Mark as read by default
        const shouldMark = mark_as_read !== false;
        if (shouldMark) {
          messageBuffer.markAsRead(channel_id);
        }

        let output: string;
        if (format === "json") {
          output = JSON.stringify(
            unread.map((m) => ({
              id: m.id,
              timestamp: m.timestamp,
              data: m.data,
            })),
            null,
            2,
          );
        } else {
          output = messageBuffer.formatForDisplay(unread);
        }

        const info = connectionManager.getConnectionInfo(channel_id);
        const header = `Channel "${channel_id}" — ${unread.length} unread message(s) (total buffered: ${totalBuffered}, connection: ${info?.state ?? "unknown"})${shouldMark ? " [marked as read]" : ""}`;

        return {
          content: [{ type: "text" as const, text: `${header}\n\n${output}` }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error getting unread messages: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: wait_for_message
  mcpServer.tool(
    "wait_for_message",
    "Block until a new message arrives on a channel (or timeout). Returns the message content so you can react to it immediately. Use this in a loop to continuously monitor a stream. Only messages arriving AFTER this call are considered.",
    {
      channel_id: z.string().describe("The channel ID to listen on"),
      timeout_seconds: z.number().optional().describe("Max seconds to wait before returning (default 30, max 55)"),
      filter: z.string().optional().describe("Only return messages whose raw text contains this substring (e.g. 'ERROR', '500')"),
    },
    async ({ channel_id, timeout_seconds, filter }) => {
      try {
        if (!connectionManager.has(channel_id)) {
          return {
            content: [{ type: "text" as const, text: `Channel "${channel_id}" not found. Connect first using connect_stream.` }],
            isError: true,
          };
        }

        // Clamp timeout to a safe range (Cursor tool calls typically timeout at ~60s)
        const timeoutSec = Math.min(Math.max(timeout_seconds ?? 30, 1), 55);
        const timeoutMs = timeoutSec * 1000;

        const result = await connectionManager.waitForMessage(channel_id, timeoutMs, filter);

        if (result.timedOut) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No ${filter ? `messages matching "${filter}"` : "messages"} received on channel "${channel_id}" within ${timeoutSec}s.\n\nYou can call wait_for_message again to keep listening, or disconnect_stream to stop.`,
              },
            ],
          };
        }

        // Auto-format JSON for readability
        let displayData = result.data;
        try {
          const parsed = JSON.parse(result.data);
          displayData = JSON.stringify(parsed, null, 2);
        } catch {
          // Not JSON, display as-is
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `New message on channel "${channel_id}" at ${new Date().toISOString()}${filter ? ` (matched filter: "${filter}")` : ""}:\n\n${displayData}`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error waiting for message: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: watch_stream
  mcpServer.tool(
    "watch_stream",
    "Convenience tool: connect to a stream (if not already connected) and wait for the next message. Combines connect_stream + wait_for_message in one step.",
    {
      url: z.string().describe("The WebSocket (ws:// or wss://) or SSE (http:// or https://) URL to connect to"),
      protocol: z.enum(["ws", "sse"]).describe("The streaming protocol to use"),
      channel_id: z.string().optional().describe("Optional custom channel ID. Auto-generated if not provided."),
      auth_token: z.string().optional().describe("Optional bearer token for authentication"),
      timeout_seconds: z.number().optional().describe("Max seconds to wait for a message (default 30, max 55)"),
      filter: z.string().optional().describe("Only return messages whose raw text contains this substring"),
    },
    async ({ url, protocol, channel_id, auth_token, timeout_seconds, filter }) => {
      try {
        // Connect if not already connected
        let channelId = channel_id;
        if (!channelId || !connectionManager.has(channelId)) {
          channelId = await connectionManager.connect(url, protocol, channelId, {
            authToken: auth_token,
          });
        }

        // Wait for next message
        const timeoutSec = Math.min(Math.max(timeout_seconds ?? 30, 1), 55);
        const timeoutMs = timeoutSec * 1000;

        const result = await connectionManager.waitForMessage(channelId, timeoutMs, filter);

        if (result.timedOut) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Connected to channel "${channelId}" at ${url}, but no ${filter ? `messages matching "${filter}"` : "messages"} received within ${timeoutSec}s.\n\nCall wait_for_message("${channelId}") to keep listening.`,
              },
            ],
          };
        }

        let displayData = result.data;
        try {
          const parsed = JSON.parse(result.data);
          displayData = JSON.stringify(parsed, null, 2);
        } catch {
          // Not JSON
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Connected to channel "${channelId}" at ${url}.\n\nFirst message received at ${new Date().toISOString()}${filter ? ` (matched filter: "${filter}")` : ""}:\n\n${displayData}\n\nCall wait_for_message("${channelId}") to continue listening, or send_message("${channelId}", payload) to respond.`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Failed: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: connect_service
  mcpServer.tool(
    "connect_service",
    `Connect to a remote AgentRoom Service (chat server). Handles authentication and room joining automatically. After connecting, use send_message to chat and wait_for_message to receive messages. Messages are decoded from Service protocol into human-readable format.${defaultServiceUrl ? ` Default URL: ${defaultServiceUrl}` : ""}`,
    {
      url: z.string().optional().describe("Service WebSocket URL (e.g. ws://localhost:9000 or wss://my-server.com:9000)"),
      name: z.string().optional().describe("Username for authentication (default: 'AI-Agent')"),
      room: z.string().optional().describe("Room to auto-join (default: 'general')"),
      channel_id: z.string().optional().describe("Optional custom channel ID"),
    },
    async ({ url, name, room, channel_id }) => {
      const serviceUrl = url ?? defaultServiceUrl;
      if (!serviceUrl) {
        return {
          content: [{ type: "text" as const, text: "URL is required. Provide a 'url' parameter or configure AGENT_ROOM_URL environment variable." }],
          isError: true,
        };
      }
      const userName = name ?? "AI-Agent";
      const roomId = room ?? "general";
      const done = log.time("tool.connect_service", { url: serviceUrl, userName, roomId });

      try {
        // 1. Connect raw WebSocket
        const channelId = await connectionManager.connect(serviceUrl, "ws", channel_id);

        // Helper to wait for a specific response
        const waitForResponse = (actionName: string, timeoutMs = 8000) =>
          new Promise<any>((resolve, reject) => {
            let settled = false;
            const handler = (id: string, data: string) => {
              if (settled || id !== channelId) return;
              try {
                const msg = JSON.parse(data);
                if (msg.type === "response" && msg.payload?.action === actionName) {
                  settled = true;
                  clearTimeout(timer);
                  connectionManager.removeListener("message", handler);
                  resolve(msg);
                }
              } catch { /* ignore non-JSON */ }
            };
            const timer = setTimeout(() => {
              if (settled) return;
              settled = true;
              connectionManager.removeListener("message", handler);
              reject(new Error(`Timeout waiting for ${actionName} response`));
            }, timeoutMs);
            // Use EventEmitter.prototype.on to bypass typed overload
            (connectionManager as any).on("message", handler);
          });

        // 2. Send auth — include stored reconnect token if available
        const storeKey = tokenStoreKey(serviceUrl, userName);
        const storedToken = reconnectTokenStore.get(storeKey);

        const authPayload: Record<string, unknown> = { action: "auth", name: userName };
        if (storedToken) {
          authPayload.token = storedToken;
          log.info("using stored reconnect token", { userName, url: serviceUrl });
        }

        await connectionManager.send(channelId, JSON.stringify({
          type: "action",
          from: userName,
          payload: authPayload,
        }));

        const authMsg = await waitForResponse("auth");
        if (!authMsg.payload?.success) {
          await connectionManager.disconnect(channelId);
          return {
            content: [{ type: "text" as const, text: `Authentication failed: ${authMsg.payload?.error ?? "unknown error"}` }],
            isError: true,
          };
        }

        // Store the reconnect token for future use
        const serverToken = authMsg.payload?.data?.token as string | undefined;
        if (serverToken) {
          reconnectTokenStore.set(storeKey, serverToken);
        }

        const wasReconnected = authMsg.payload?.data?.reconnected === true;
        const restoredRooms = (authMsg.payload?.data?.restored_rooms ?? []) as string[];

        // 3. Join room (skip if already restored via reconnect)
        let members: string[] | undefined;
        if (wasReconnected && restoredRooms.includes(roomId)) {
          // Room was restored — just fetch members
          log.info("room already restored via reconnect", { roomId, restoredRooms });
          // We still need to get member info
          await connectionManager.send(channelId, JSON.stringify({
            type: "action",
            from: userName,
            payload: { action: "room.members", room_id: roomId },
          }));
          const membersMsg = await waitForResponse("room.members");
          members = membersMsg.payload?.data?.members as string[] | undefined;
        } else {
          await connectionManager.send(channelId, JSON.stringify({
            type: "action",
            from: userName,
            payload: { action: "room.join", room_id: roomId },
          }));

          const joinMsg = await waitForResponse("room.join");
          members = joinMsg.payload?.data?.members as string[] | undefined;
        }

        // 4. Register as a service channel
        const allJoinedRooms = new Set([roomId, ...restoredRooms]);
        serviceChannels.set(channelId, {
          name: userName,
          room: roomId,
          url: serviceUrl,
          joinedRooms: allJoinedRooms,
          reconnectToken: serverToken,
        });

        const memberList = members && members.length > 0
          ? `\nMembers: ${members.join(", ")}`
          : "";

        const reconnectNote = wasReconnected
          ? `\nReconnected: session restored (rooms: ${restoredRooms.join(", ") || "none"})`
          : "";

        done({ channelId, reconnected: wasReconnected });

        return {
          content: [{
            type: "text" as const,
            text: [
              `Connected to AgentRoom Service and joined #${roomId} as "${userName}".`,
              ``,
              `Channel ID: ${channelId}`,
              `URL: ${serviceUrl}`,
              `Room: #${roomId}${memberList}${reconnectNote}`,
              `Token: ${serverToken ? "(stored for reconnection)" : "(none)"}`,
              ``,
              `Usage:`,
              `• send_message("${channelId}", "hello") → sends chat to #${roomId}`,
              `• wait_for_message("${channelId}") → waits for next incoming message`,
              `• read_history("${channelId}") → shows buffered messages`,
              `• get_unread_messages("${channelId}") → shows only new/unread messages`,
              `• Messages are auto-decoded into human-readable format.`,
            ].join("\n"),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("tool.connect_service failed", { url: serviceUrl, userName }, err);
        // Clean up on failure
        if (channel_id && connectionManager.has(channel_id)) {
          try { await connectionManager.disconnect(channel_id); } catch { /* ignore */ }
        }
        return {
          content: [{ type: "text" as const, text: `Failed to connect to service: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // ─── Room Management Tools (require an active Service connection) ────

  /**
   * Helper: send an action to the service and wait for the response.
   * Reusable for list_rooms, create_room, join_room, leave_room.
   */
  async function sendServiceAction(
    channelId: string,
    svcInfo: ServiceChannelInfo,
    action: string,
    extra: Record<string, unknown> = {},
    timeoutMs = 8000,
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    return new Promise((resolve) => {
      let settled = false;

      const handler = (id: string, data: string) => {
        if (settled || id !== channelId) return;
        try {
          const msg = JSON.parse(data);
          if (msg.type === "response" && msg.payload?.action === action) {
            settled = true;
            clearTimeout(timer);
            connectionManager.removeListener("message", handler);
            if (msg.payload.success) {
              resolve({ success: true, data: msg.payload.data });
            } else {
              resolve({ success: false, error: msg.payload.error ?? "Unknown error" });
            }
          }
        } catch { /* ignore non-JSON */ }
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        connectionManager.removeListener("message", handler);
        resolve({ success: false, error: `Timeout waiting for ${action} response` });
      }, timeoutMs);

      (connectionManager as any).on("message", handler);

      // Send the action
      connectionManager.send(channelId, JSON.stringify({
        type: "action",
        from: svcInfo.name,
        payload: { action, ...extra },
      })).catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connectionManager.removeListener("message", handler);
        resolve({ success: false, error: err instanceof Error ? err.message : String(err) });
      });
    });
  }

  /**
   * Helper: find the active service channel. Returns [channelId, info] or an error response.
   */
  function getServiceChannel(channel_id?: string): { channelId: string; info: ServiceChannelInfo } | { error: string } {
    if (channel_id) {
      const info = serviceChannels.get(channel_id);
      if (!info) return { error: `Channel "${channel_id}" is not a Service connection. Use connect_service first.` };
      return { channelId: channel_id, info };
    }
    // Auto-detect: use the first (or only) service channel
    const entries = [...serviceChannels.entries()];
    if (entries.length === 0) return { error: "No active Service connection. Use connect_service first." };
    if (entries.length === 1) return { channelId: entries[0][0], info: entries[0][1] };
    return { error: `Multiple Service connections active. Please specify channel_id: ${entries.map(([id]) => id).join(", ")}` };
  }

  // Tool: list_rooms
  mcpServer.tool(
    "list_rooms",
    "List all rooms on the connected AgentRoom Service. Shows room names, descriptions, member counts, and whether a password is required.",
    {
      channel_id: z.string().optional().describe("Service channel ID. Auto-detected if only one Service connection exists."),
    },
    async ({ channel_id }) => {
      const svc = getServiceChannel(channel_id);
      if ("error" in svc) {
        return { content: [{ type: "text" as const, text: svc.error }], isError: true };
      }

      const result = await sendServiceAction(svc.channelId, svc.info, "room.list");
      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Failed to list rooms: ${result.error}` }], isError: true };
      }

      const rooms = (result.data?.rooms ?? []) as Array<{
        id: string; name: string; description: string; memberCount: number;
        hasPassword?: boolean; createdBy: string; persistent: boolean;
      }>;

      if (rooms.length === 0) {
        return { content: [{ type: "text" as const, text: "No rooms found." }] };
      }

      const lines = rooms.map((r) => {
        const lock = r.hasPassword ? " [password]" : "";
        const pin = r.persistent ? " [persistent]" : "";
        return `• #${r.id} — ${r.name}${lock}${pin}\n  ${r.description || "(no description)"}\n  Members: ${r.memberCount}`;
      });

      const currentRoom = svc.info.room;
      return {
        content: [{
          type: "text" as const,
          text: `Rooms on ${svc.info.url} (current: #${currentRoom}):\n\n${lines.join("\n\n")}`,
        }],
      };
    },
  );

  // Tool: create_room
  mcpServer.tool(
    "create_room",
    "Create a new room on the connected AgentRoom Service. Optionally set a password to make it private.",
    {
      room_id: z.string().describe("Room ID (alphanumeric, dashes, underscores)"),
      name: z.string().optional().describe("Human-readable room name (defaults to room_id)"),
      description: z.string().optional().describe("Room description"),
      password: z.string().optional().describe("Room password. If set, users must provide it to join."),
      persistent: z.boolean().optional().describe("Whether the room persists after all members leave (default: false)"),
      channel_id: z.string().optional().describe("Service channel ID. Auto-detected if only one Service connection exists."),
    },
    async ({ room_id, name, description, password, persistent, channel_id }) => {
      const svc = getServiceChannel(channel_id);
      if ("error" in svc) {
        return { content: [{ type: "text" as const, text: svc.error }], isError: true };
      }

      const extra: Record<string, unknown> = { room_id };
      if (name) extra.name = name;
      if (description) extra.description = description;
      if (password) extra.password = password;
      if (persistent !== undefined) extra.persistent = persistent;

      const result = await sendServiceAction(svc.channelId, svc.info, "room.create", extra);
      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Failed to create room: ${result.error}` }], isError: true };
      }

      const lock = password ? " (password-protected)" : "";
      return {
        content: [{
          type: "text" as const,
          text: `Room #${room_id} created successfully${lock}.\n\nUse join_room("${room_id}"${password ? ', password="..."' : ""}) to enter.`,
        }],
      };
    },
  );

  // Tool: join_room
  mcpServer.tool(
    "join_room",
    "Join a room on the connected AgentRoom Service. After joining, send_message will route to the current room.",
    {
      room_id: z.string().describe("Room ID to join"),
      password: z.string().optional().describe("Room password (required if the room is password-protected)"),
      channel_id: z.string().optional().describe("Service channel ID. Auto-detected if only one Service connection exists."),
    },
    async ({ room_id, password, channel_id }) => {
      const svc = getServiceChannel(channel_id);
      if ("error" in svc) {
        return { content: [{ type: "text" as const, text: svc.error }], isError: true };
      }

      const extra: Record<string, unknown> = { room_id };
      if (password) extra.password = password;

      const result = await sendServiceAction(svc.channelId, svc.info, "room.join", extra);
      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Failed to join room: ${result.error}` }], isError: true };
      }

      const members = (result.data?.members ?? []) as string[];

      // Update the service channel's current room
      svc.info.room = room_id;
      svc.info.joinedRooms.add(room_id);

      return {
        content: [{
          type: "text" as const,
          text: `Joined #${room_id}. Messages will now be sent to this room.\n\nMembers: ${members.join(", ") || "(empty)"}`,
        }],
      };
    },
  );

  // Tool: leave_room
  mcpServer.tool(
    "leave_room",
    "Leave a room on the connected AgentRoom Service.",
    {
      room_id: z.string().describe("Room ID to leave"),
      channel_id: z.string().optional().describe("Service channel ID. Auto-detected if only one Service connection exists."),
    },
    async ({ room_id, channel_id }) => {
      const svc = getServiceChannel(channel_id);
      if ("error" in svc) {
        return { content: [{ type: "text" as const, text: svc.error }], isError: true };
      }

      const result = await sendServiceAction(svc.channelId, svc.info, "room.leave", { room_id });
      if (!result.success) {
        return { content: [{ type: "text" as const, text: `Failed to leave room: ${result.error}` }], isError: true };
      }

      svc.info.joinedRooms.delete(room_id);

      // If the user left their current room, switch to another joined room or fallback
      if (svc.info.room === room_id) {
        const remaining = [...svc.info.joinedRooms];
        svc.info.room = remaining.length > 0 ? remaining[0] : "general";
      }

      return {
        content: [{
          type: "text" as const,
          text: `Left #${room_id}. Current room is now #${svc.info.room}.`,
        }],
      };
    },
  );

  // Tool: open_chat_terminal
  mcpServer.tool(
    "open_chat_terminal",
    `Open an interactive chat terminal (CLI) that connects to an AgentRoom Service. This launches a separate terminal window where the user can observe real-time messages and participate in the chat room. Call this after connecting to a Service to give the user a live view.${defaultServiceUrl ? ` Default URL: ${defaultServiceUrl}` : ""}`,
    {
      url: z.string().optional().describe(`Service WebSocket URL (default: ${defaultServiceUrl ?? "ws://localhost:9000"})`),
      name: z.string().optional().describe("Username for the chat (default: current system user)"),
      room: z.string().optional().describe("Room to auto-join (default: general)"),
    },
    async ({ url, name, room }) => {
      const cliUrl = url ?? defaultServiceUrl ?? "ws://localhost:9000";
      const cliName = name ?? "Observer";
      const cliRoom = room ?? "general";

      try {
        const { spawn } = await import("child_process");
        const path = await import("path");
        const { fileURLToPath } = await import("url");

        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const cliPath = path.resolve(__dirname, "service", "cli.ts");

        const args = ["tsx", cliPath, "--url", cliUrl, "--name", cliName, "--room", cliRoom];

        // Try platform-appropriate terminal
        const platform = process.platform;
        let launched = false;

        if (platform === "darwin") {
          // macOS: open in Terminal.app
          const script = `tell application "Terminal" to do script "cd ${path.resolve(__dirname, "..")} && npx ${args.join(" ")}"`;
          spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" }).unref();
          launched = true;
        } else if (platform === "linux") {
          // Linux: try common terminal emulators
          for (const term of ["gnome-terminal", "xterm", "konsole"]) {
            try {
              spawn(term, ["--", "npx", ...args], {
                cwd: path.resolve(__dirname, ".."),
                detached: true,
                stdio: "ignore",
              }).unref();
              launched = true;
              break;
            } catch {
              continue;
            }
          }
        }

        if (launched) {
          return {
            content: [{
              type: "text" as const,
              text: `Chat terminal opened!\n\nConnecting to: ${cliUrl}\nUsername: ${cliName}\nRoom: #${cliRoom}\n\nThe user can now see real-time messages and participate in the chat.`,
            }],
          };
        }

        // Fallback: provide the command for the user to run manually
        return {
          content: [{
            type: "text" as const,
            text: `Could not auto-open terminal. Ask the user to run this in a new terminal:\n\n  npx tsx src/service/cli.ts --url ${cliUrl} --name ${cliName} --room ${cliRoom}\n\nOr the short form:\n\n  pnpm run service:cli -- --name ${cliName} --room ${cliRoom}`,
          }],
        };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: "text" as const,
            text: `Failed to open terminal: ${errMsg}\n\nManual command:\n  npx tsx src/service/cli.ts --url ${cliUrl} --name ${cliName} --room ${cliRoom}`,
          }],
          isError: true,
        };
      }
    },
  );

  // ─── Resources ─────────────────────────────────────────────────────

  // Resource: connection://status (all connections summary)
  mcpServer.resource(
    "connection-status",
    "connection://status",
    {
      description: "Summary of all active stream connections and their current state",
      mimeType: "application/json",
    },
    async () => {
      const connections = connectionManager.listConnections();
      return {
        contents: [
          {
            uri: "connection://status",
            text: JSON.stringify(connections, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource template: connection://{channel_id}/status
  mcpServer.resource(
    "channel-status",
    new ResourceTemplate("connection://{channel_id}/status", {
      list: async () => {
        // List all existing channel status resources
        return {
          resources: connectionManager.listConnections().map((c) => ({
            uri: `connection://${c.channelId}/status`,
            name: `Status for channel "${c.channelId}"`,
            mimeType: "application/json",
          })),
        };
      },
    }),
    {
      description: "Detailed status for a specific stream connection",
      mimeType: "application/json",
    },
    async (uri, { channel_id }) => {
      const info = connectionManager.getConnectionInfo(channel_id as string);
      if (!info) {
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify({ error: `Channel "${channel_id}" not found` }),
              mimeType: "application/json",
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(info, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  // Resource template: stream://{channel_id}/messages/recent
  mcpServer.resource(
    "stream-messages-recent",
    new ResourceTemplate("stream://{channel_id}/messages/recent", {
      list: async () => {
        return {
          resources: connectionManager.listConnections().map((c) => ({
            uri: `stream://${c.channelId}/messages/recent`,
            name: `Recent messages for channel "${c.channelId}"`,
            mimeType: "text/plain",
          })),
        };
      },
    }),
    {
      description: "The most recent messages (up to 50) from a stream channel, formatted for readability",
      mimeType: "text/plain",
    },
    async (uri, { channel_id }) => {
      const messages = messageBuffer.getRecent(channel_id as string);
      const formatted = messageBuffer.formatForDisplay(messages);
      return {
        contents: [
          {
            uri: uri.href,
            text: formatted,
            mimeType: "text/plain",
          },
        ],
      };
    },
  );

  // Resource template: stream://{channel_id}/messages/latest
  mcpServer.resource(
    "stream-messages-latest",
    new ResourceTemplate("stream://{channel_id}/messages/latest", {
      list: async () => {
        return {
          resources: connectionManager.listConnections().map((c) => ({
            uri: `stream://${c.channelId}/messages/latest`,
            name: `Latest message for channel "${c.channelId}"`,
            mimeType: "text/plain",
          })),
        };
      },
    }),
    {
      description: "Only the most recent message from a stream channel",
      mimeType: "text/plain",
    },
    async (uri, { channel_id }) => {
      const latest = messageBuffer.getLatest(channel_id as string);
      if (!latest) {
        return {
          contents: [
            {
              uri: uri.href,
              text: "(no messages yet)",
              mimeType: "text/plain",
            },
          ],
        };
      }
      const formatted = messageBuffer.formatForDisplay([latest]);
      return {
        contents: [
          {
            uri: uri.href,
            text: formatted,
            mimeType: "text/plain",
          },
        ],
      };
    },
  );

  // Resource: metrics://snapshot (aggregated performance & error metrics)
  mcpServer.resource(
    "metrics-snapshot",
    "metrics://snapshot",
    {
      description: "Aggregated performance and error metrics: counters (connections, messages, errors) and histograms (latency, durations). Use this to diagnose performance issues.",
      mimeType: "application/json",
    },
    async () => {
      const snapshot = Logger.metrics.snapshot();
      return {
        contents: [
          {
            uri: "metrics://snapshot",
            text: JSON.stringify(snapshot, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  return mcpServer;
}
