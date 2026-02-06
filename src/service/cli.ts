#!/usr/bin/env node

/**
 * AgentRoom Service CLI — Real-time chat room terminal client.
 *
 * Connects to the Service, authenticates, joins a room, and provides
 * a full interactive chat experience. Push messages (chat) are displayed
 * prominently; signaling messages (responses, system) are shown subtly.
 *
 * Usage:
 *   pnpm run service:cli
 *   pnpm run service:cli -- --name Alice --room general
 *   npx tsx src/service/cli.ts --url ws://server:9000 --name Bob --room dev-ops
 *
 * Commands:
 *   /help                Show all commands
 *   /join <room>         Join a room
 *   /leave [room]        Leave current or specified room
 *   /switch <room>       Switch active room
 *   /rooms               List all rooms
 *   /members             List members in current room
 *   /users               List all online users
 *   /dm <user> <msg>     Send private message
 *   /create <id> [name]  Create a new room
 *   /history             Show current room's buffered history
 *   /debug               Toggle signaling message visibility
 *   /quit                Exit
 */

import WebSocket from "ws";
import * as readline from "readline";
import type { ServiceMessage } from "./protocol.js";

// ─── CLI Args ────────────────────────────────────────────────────────

function getArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const URL = getArg("url", "ws://localhost:9000");
const NAME = getArg("name", process.env.USER ?? "user");
const ROOM = getArg("room", "general");

// ─── Colors ──────────────────────────────────────────────────────────

const R = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";
const WHITE = "\x1b[37m";
const BG_DIM = "\x1b[48;5;236m";

// ─── State ───────────────────────────────────────────────────────────

let connected = false;
let authenticated = false;
let activeRoom = ROOM;
let joinedRooms = new Set<string>();
let showDebug = false;
let promptActive = false;   // true when rl.question is pending
let userId = "";

// ─── UI ──────────────────────────────────────────────────────────────

function clearLine() {
  process.stdout.write("\r\x1b[K");
}

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

/** Print a message, clearing prompt if needed, then re-showing it */
function printMsg(line: string) {
  if (promptActive) {
    clearLine();
  }
  console.log(line);
  // Defer re-showing the prompt to avoid rl.question stacking
  if (!promptActive) {
    schedulePrompt();
  } else {
    // Prompt is still active (rl.question pending), just re-draw the prefix
    process.stdout.write(promptPrefix());
  }
}

function promptPrefix(): string {
  return `${DIM}${timestamp()}${R} ${GREEN}#${activeRoom}${R} ${BOLD}>${R} `;
}

let promptTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePrompt() {
  if (promptTimer) return;
  promptTimer = setTimeout(() => {
    promptTimer = null;
    showPrompt();
  }, 50);
}

function showPrompt() {
  if (connected && authenticated && !promptActive) {
    promptActive = true;
    rl.question(promptPrefix(), handleInput);
  }
}

// ─── Connect ─────────────────────────────────────────────────────────

console.log();
console.log(`${BOLD} AgentRoom Chat ${R}`);
console.log(`${DIM} Connecting to ${URL} as "${NAME}"...${R}`);
console.log();

const ws = new WebSocket(URL);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// ─── Input Handler ───────────────────────────────────────────────────

function handleInput(input: string) {
  promptActive = false;
  const trimmed = input.trim();

  if (!trimmed) {
    showPrompt();
    return;
  }

  // ── Commands ─────────────────────────────────────────────────────
  if (trimmed.startsWith("/")) {
    const parts = trimmed.slice(1).split(/\s+/);
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case "quit":
      case "exit":
      case "q":
        console.log(`\n${DIM}Goodbye!${R}`);
        ws.close();
        rl.close();
        process.exit(0);
        break;

      case "help":
      case "h":
        printHelp();
        break;

      case "join":
      case "j":
        if (!parts[1]) { printMsg(`${RED}  Usage: /join <room>${R}`); break; }
        sendAction("room.join", { room_id: parts[1] });
        break;

      case "leave":
      case "l":
        sendAction("room.leave", { room_id: parts[1] ?? activeRoom });
        break;

      case "switch":
      case "s":
        if (!parts[1]) { printMsg(`${RED}  Usage: /switch <room>${R}`); break; }
        if (!joinedRooms.has(parts[1])) {
          printMsg(`${YELLOW}  Not in #${parts[1]}. Join first with /join ${parts[1]}${R}`);
        } else {
          activeRoom = parts[1];
          printMsg(`${GREEN}  Switched to #${activeRoom}${R}`);
        }
        break;

      case "rooms":
      case "r":
        sendAction("room.list", {});
        break;

      case "members":
      case "m":
        sendAction("room.members", { room_id: parts[1] ?? activeRoom });
        break;

      case "users":
      case "u":
        sendAction("users.list", {});
        break;

      case "dm":
      case "d":
        if (!parts[1] || !parts[2]) {
          printMsg(`${RED}  Usage: /dm <user> <message>${R}`);
          break;
        }
        sendAction("dm", { to: parts[1], message: parts.slice(2).join(" ") });
        break;

      case "create":
      case "c":
        if (!parts[1]) { printMsg(`${RED}  Usage: /create <room_id> [name]${R}`); break; }
        sendAction("room.create", {
          room_id: parts[1],
          name: parts.slice(2).join(" ") || parts[1],
        });
        break;

      case "history":
        sendAction("room.members", { room_id: activeRoom }); // just to trigger history display
        printMsg(`${DIM}  (History is sent on room join. Use /leave then /join to refresh.)${R}`);
        break;

      case "debug":
        showDebug = !showDebug;
        printMsg(`${DIM}  Debug mode: ${showDebug ? "ON — signaling messages visible" : "OFF — signaling hidden"}${R}`);
        break;

      default:
        printMsg(`${RED}  Unknown command: /${cmd}. Type /help for commands.${R}`);
    }

    showPrompt();
    return;
  }

  // ── Chat message → active room ───────────────────────────────────
  if (!joinedRooms.has(activeRoom)) {
    printMsg(`${YELLOW}  Not in #${activeRoom}. Join with /join ${activeRoom}${R}`);
    showPrompt();
    return;
  }

  send({
    type: "chat",
    from: NAME,
    to: `room:${activeRoom}`,
    payload: { message: trimmed },
  });

  showPrompt();
}

// ─── Message Display ─────────────────────────────────────────────────

function displayMessage(msg: ServiceMessage) {
  const p = msg.payload as any;

  switch (msg.type) {
    // ── Push: Chat messages (prominent) ──────────────────────────
    case "chat": {
      const isDm = !!p.dm;
      const room = p.room ?? (msg.to?.startsWith("room:") ? msg.to.slice(5) : null);
      const message = p.message ?? "";
      const ts = `${DIM}${timestamp()}${R}`;

      if (isDm) {
        // DM — magenta
        if (msg.from === NAME) {
          printMsg(`${ts} ${MAGENTA}[DM → ${msg.to}]${R} ${message}`);
        } else {
          printMsg(`${ts} ${MAGENTA}[DM from ${msg.from}]${R} ${WHITE}${message}${R}`);
        }
      } else if (room) {
        // Room message
        if (msg.from === NAME) {
          // Own message echoed back — skip (we already see what we typed)
          return;
        }
        const roomTag = joinedRooms.size > 1 ? `${BLUE}#${room}${R} ` : "";
        printMsg(`${ts} ${roomTag}${CYAN}${msg.from}${R}  ${message}`);
      } else {
        printMsg(`${ts} ${CYAN}${msg.from}${R}  ${message}`);
      }
      break;
    }

    // ── Push: System events (subtle) ─────────────────────────────
    case "system": {
      const event = p.event as string;

      switch (event) {
        case "welcome":
          // Handled in auth flow, skip
          break;

        case "user.joined":
          printMsg(`${DIM}${timestamp()} → ${p.user_name} joined #${p.room_id}${R}`);
          break;

        case "user.left":
          printMsg(`${DIM}${timestamp()} ← ${p.user_name} left #${p.room_id}${R}`);
          break;

        case "room.history": {
          const msgs = p.messages as ServiceMessage[] | undefined;
          if (msgs && msgs.length > 0) {
            printMsg(`${DIM}── History #${p.room_id} (${msgs.length} messages) ──${R}`);
            for (const hm of msgs) {
              const hp = hm.payload as any;
              const ht = new Date(hm.timestamp).toLocaleTimeString("en-US", { hour12: false });
              printMsg(`${DIM}  ${ht} ${hm.from}: ${hp.message}${R}`);
            }
            printMsg(`${DIM}── End history ──${R}`);
          }
          break;
        }

        default:
          if (showDebug) {
            printMsg(`${DIM}${timestamp()} [sys:${event}] ${JSON.stringify(p)}${R}`);
          }
      }
      break;
    }

    // ── Signal: Responses (hidden by default) ────────────────────
    case "response": {
      const action = p.action as string;
      const success = p.success as boolean;

      // Some responses have meaningful UI side effects
      switch (action) {
        case "auth":
          if (success) {
            authenticated = true;
            userId = (p.data as any)?.user_id ?? "";
            const rooms = (p.data as any)?.rooms as any[] | undefined;
            printMsg(`${GREEN}  ✓ Authenticated as "${NAME}" (${userId})${R}`);
            if (rooms && rooms.length > 0) {
              printMsg(`${DIM}  Rooms: ${rooms.map((r: any) => r.id).join(", ")}${R}`);
            }
            // Auto-join the initial room
            sendAction("room.join", { room_id: ROOM });
          } else {
            printMsg(`${RED}  ✗ Auth failed: ${p.error}${R}`);
          }
          break;

        case "room.join":
          if (success) {
            const roomId = (p.data as any)?.room_id;
            const members = (p.data as any)?.members as string[] | undefined;
            joinedRooms.add(roomId);
            activeRoom = roomId;
            printMsg(`${GREEN}  ✓ Joined #${roomId}${R}${members ? `${DIM} — ${members.join(", ")}${R}` : ""}`);
          } else {
            printMsg(`${YELLOW}  ${p.error}${R}`);
          }
          break;

        case "room.leave":
          if (success) {
            const roomId = (p.data as any)?.room_id;
            joinedRooms.delete(roomId);
            if (activeRoom === roomId && joinedRooms.size > 0) {
              activeRoom = [...joinedRooms][0];
              printMsg(`${DIM}  Left #${roomId}, switched to #${activeRoom}${R}`);
            } else if (joinedRooms.size === 0) {
              printMsg(`${DIM}  Left #${roomId}. No active rooms.${R}`);
            } else {
              printMsg(`${DIM}  Left #${roomId}${R}`);
            }
          } else {
            printMsg(`${YELLOW}  ${p.error}${R}`);
          }
          break;

        case "room.create":
          if (success) {
            const room = p.data as any;
            printMsg(`${GREEN}  ✓ Room created: #${room.id}${R}`);
          } else {
            printMsg(`${YELLOW}  ${p.error}${R}`);
          }
          break;

        case "room.list": {
          const rooms = (p.data as any)?.rooms as any[] | undefined;
          if (rooms) {
            printMsg(`${DIM}  ┌ Rooms ────────────────────────────${R}`);
            for (const r of rooms) {
              const badge = joinedRooms.has(r.id) ? `${GREEN}●${R}` : `${DIM}○${R}`;
              printMsg(`  ${badge} ${BOLD}#${r.id}${R}  ${DIM}${r.description || r.name}  (${r.memberCount} online)${R}`);
            }
            printMsg(`${DIM}  └─────────────────────────────────${R}`);
          }
          break;
        }

        case "room.members": {
          const members = (p.data as any)?.members as string[] | undefined;
          const roomId = (p.data as any)?.room_id;
          if (members) {
            printMsg(`${DIM}  Members of #${roomId}: ${members.join(", ")}${R}`);
          }
          break;
        }

        case "users.list": {
          const users = (p.data as any)?.users as any[] | undefined;
          if (users) {
            printMsg(`${DIM}  ┌ Online Users ─────────────────────${R}`);
            for (const u of users) {
              const isSelf = u.name === NAME ? ` ${GREEN}(you)${R}` : "";
              printMsg(`  ${CYAN}${u.name}${R}${isSelf}  ${DIM}in ${u.rooms.map((r: string) => `#${r}`).join(", ") || "(lobby)"}${R}`);
            }
            printMsg(`${DIM}  └─────────────────────────────────${R}`);
          }
          break;
        }

        case "dm":
          if (success) {
            // Already displayed via chat message echo
          } else {
            printMsg(`${RED}  DM failed: ${p.error}${R}`);
          }
          break;

        case "ping":
          // Silent
          break;

        default:
          if (showDebug) {
            printMsg(`${DIM}${timestamp()} [rsp:${action}] ${success ? "ok" : p.error}${R}`);
          }
      }
      break;
    }

    // ── Error ────────────────────────────────────────────────────
    case "error": {
      printMsg(`${RED}  ✗ Error ${p.code}: ${p.message}${R}`);
      break;
    }

    default:
      if (showDebug) {
        printMsg(`${DIM}${timestamp()} [${msg.type}] ${JSON.stringify(p)}${R}`);
      }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function send(data: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendAction(action: string, data: Record<string, unknown>) {
  send({ type: "action", from: NAME, payload: { action, ...data } });
}

function printHelp() {
  printMsg(`
${BOLD}  Commands${R}
  ${DIM}─────────────────────────────────────────${R}
  ${GREEN}/join${R} <room>         Join a room
  ${GREEN}/leave${R} [room]        Leave current or specified room
  ${GREEN}/switch${R} <room>       Switch active room (short: ${DIM}/s${R})
  ${GREEN}/rooms${R}               List all rooms
  ${GREEN}/members${R} [room]      Show room members
  ${GREEN}/users${R}               List online users
  ${GREEN}/dm${R} <user> <msg>     Send private message
  ${GREEN}/create${R} <id> [name]  Create a new room
  ${GREEN}/history${R}             Show current room history
  ${GREEN}/debug${R}               Toggle signaling visibility
  ${GREEN}/quit${R}                Exit

  ${DIM}Type plain text to send to the active room.${R}
  ${DIM}Short aliases: /j /l /s /r /m /u /d /c /q /h${R}
`);
}

// ─── WebSocket Events ────────────────────────────────────────────────

ws.on("open", () => {
  connected = true;
  console.log(`${GREEN}  ● Connected${R}`);
  // Authenticate immediately
  sendAction("auth", { name: NAME });

  // Auth timeout — warn if auth never succeeds
  setTimeout(() => {
    if (!authenticated) {
      console.log(`${YELLOW}  ⚠ Auth timeout — server may not support the expected protocol.${R}`);
      console.log(`${DIM}  Make sure you are connecting to an AgentRoom Service.${R}`);
    }
  }, 5000);
});

ws.on("message", (raw: WebSocket.RawData) => {
  try {
    const msg = JSON.parse(raw.toString("utf-8")) as ServiceMessage;
    displayMessage(msg);
  } catch {
    // Ignore non-JSON
  }
});

ws.on("close", () => {
  connected = false;
  console.log(`\n${YELLOW}  Disconnected from server.${R}`);
  rl.close();
  process.exit(0);
});

ws.on("error", (err: Error) => {
  console.error(`\n${RED}  Connection error: ${err.message}${R}`);
  if (!connected) {
    console.log(`${DIM}  Make sure the service is running: pnpm run service${R}`);
    process.exit(1);
  }
});

// ─── Keepalive ───────────────────────────────────────────────────────

setInterval(() => {
  if (connected && authenticated) {
    sendAction("ping", {});
  }
}, 30_000);
