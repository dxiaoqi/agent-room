#!/usr/bin/env node

/**
 * AgentRoom Service CLI — Real-time chat room terminal client.
 *
 * Connects to the Service, authenticates, joins a room, and provides
 * a full interactive chat experience. Push messages (chat) are displayed
 * prominently; signaling messages (responses, system) are shown subtly.
 *
 * Usage:
 *   # Using npm (note the "--" separator)
 *   npm run service:cli -- --name Alice --room general
 *   npm run service:cli -- --url ws://server:9000 --name Bob
 *
 *   # Direct execution
 *   npx agent-room-cli --name Alice --room general
 *   npx tsx src/service/cli.ts --url ws://server:9000 --name Bob
 *
 *   # Show help
 *   npx agent-room-cli --help
 *
 * Options:
 *   --url <url>      WebSocket service URL (default: ws://localhost:9000)
 *   --name <name>    Your display name (default: $USER)
 *   --room <room>    Room to join (default: general)
 *   --help, -h       Show this help message
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

function parseArgs(): { url: string; name: string; room: string } {
  const args = process.argv.slice(2);
  
  // Default values
  let url = "ws://localhost:9000";
  let name = process.env.USER ?? "user";
  let room = "general";
  
  // Parse --flag value style
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];
    
    if (arg === "--url" && nextArg) {
      url = nextArg;
      i++; // Skip next arg
    } else if (arg === "--name" && nextArg) {
      name = nextArg;
      i++; // Skip next arg
    } else if (arg === "--room" && nextArg) {
      room = nextArg;
      i++; // Skip next arg
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: agent-room-cli [options]

Options:
  --url <url>      WebSocket service URL (default: ws://localhost:9000)
  --name <name>    Your display name (default: $USER)
  --room <room>    Room to join (default: general)
  --help, -h       Show this help message

Examples:
  agent-room-cli
  agent-room-cli --name Alice --room general
  agent-room-cli --url ws://server:9000 --name Bob --room dev-ops

When using npm run:
  npm run service:cli -- --name Alice --room general
  (Note the "--" separator after service:cli)
`);
      process.exit(0);
    } else if (!arg.startsWith("--") && i === 0) {
      // Legacy positional args: name url room
      name = arg;
      if (args[i + 1]) url = args[i + 1];
      if (args[i + 2]) room = args[i + 2];
      break;
    }
  }
  
  // Ensure URL has proper protocol
  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    url = "ws://" + url;
  }
  
  return { url, name, room };
}

const { url: URL, name: NAME, room: ROOM } = parseArgs();
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

function getRoleColor(role: string): string {
  switch (role?.toLowerCase()) {
    case "owner": return RED;
    case "admin": return YELLOW;
    case "moderator": return BLUE;
    case "member": return GREEN;
    case "guest": return DIM;
    default: return "";
  }
}

// ─── Mention Parsing ─────────────────────────────────────────────────

/**
 * Extract @mentions from a message
 * @username or @"username with spaces"
 */
function extractMentions(message: string): string[] {
  const mentions: string[] = [];
  // Match @username or @"username with spaces"
  const mentionRegex = /@([\w\-]+|"[^"]+"|'[^']+')/g;
  let match;
  
  while ((match = mentionRegex.exec(message)) !== null) {
    let mentioned = match[1];
    // Remove quotes if present
    if ((mentioned.startsWith('"') && mentioned.endsWith('"')) ||
        (mentioned.startsWith("'") && mentioned.endsWith("'"))) {
      mentioned = mentioned.slice(1, -1);
    }
    if (mentioned && !mentions.includes(mentioned)) {
      mentions.push(mentioned);
    }
  }
  
  return mentions;
}

/**
 * Highlight @mentions in a message
 */
function highlightMentions(message: string, currentUser: string): string {
  // Highlight mentions of current user
  const mentionRegex = /@([\w\-]+|"[^"]+"|'[^']+')/g;
  
  return message.replace(mentionRegex, (match, username) => {
    let cleanUsername = username;
    // Remove quotes
    if ((cleanUsername.startsWith('"') && cleanUsername.endsWith('"')) ||
        (cleanUsername.startsWith("'") && cleanUsername.endsWith("'"))) {
      cleanUsername = cleanUsername.slice(1, -1);
    }
    
    // Highlight if it's mentioning current user
    if (cleanUsername === currentUser) {
      return `${YELLOW}${BOLD}@${cleanUsername}${R}`;
    }
    return `${CYAN}@${cleanUsername}${R}`;
  });
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

// ─── Command Completion ──────────────────────────────────────────────

const COMMANDS = [
  "/help", "/h",
  "/join", "/j",
  "/leave", "/l",
  "/switch", "/s",
  "/rooms", "/r",
  "/members", "/m",
  "/users", "/u",
  "/dm", "/d",
  "/create", "/c",
  "/history",
  "/debug",
  "/role", "/setrole",
  "/grant",
  "/myrole", "/whoami",
  "/permissions", "/perms",
  "/restrict",
  "/mention", "/at",
  "/quit", "/q", "/exit"
];

function completer(line: string): [string[], string] {
  // Only complete if the line starts with /
  if (!line.startsWith("/")) {
    return [[], line];
  }

  const hits = COMMANDS.filter((cmd) => cmd.startsWith(line));
  
  // Show all commands if no match, otherwise show matches
  return [hits.length > 0 ? hits : COMMANDS, line];
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: completer,
  terminal: true,
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
      case "d": {
        if (!parts[1] || !parts[2]) {
          printMsg(`${RED}  Usage: /dm <user> <message>${R}`);
          printMsg(`${DIM}  Multiple users: /dm user1,user2,user3 <message>${R}`);
          printMsg(`${DIM}  Array syntax: /dm [user1,user2] <message>${R}`);
          break;
        }
        
        const recipientsRaw = parts[1];
        let recipients: string[] = [];
        let messageStartIndex = 2;
        
        // Parse array syntax: [user1,user2] or [user1, user2]
        if (recipientsRaw.startsWith("[")) {
          // Find the closing bracket
          const fullRecipients = parts.slice(1).join(" ");
          const closeBracket = fullRecipients.indexOf("]");
          if (closeBracket !== -1) {
            const userList = fullRecipients.slice(1, closeBracket);
            recipients = userList.split(",").map(u => u.trim()).filter(u => u);
            // Find where message starts
            const afterBracket = fullRecipients.slice(closeBracket + 1).trim();
            messageStartIndex = parts.length - afterBracket.split(/\s+/).length;
          } else {
            printMsg(`${RED}  Invalid array syntax. Use: /dm [user1,user2] message${R}`);
            break;
          }
        } else if (recipientsRaw.includes(",")) {
          // Comma-separated: user1,user2,user3
          recipients = recipientsRaw.split(",").map(u => u.trim()).filter(u => u);
        } else {
          // Single user
          recipients = [recipientsRaw];
        }
        
        const message = parts.slice(messageStartIndex).join(" ");
        
        if (!message) {
          printMsg(`${RED}  Message cannot be empty${R}`);
          break;
        }
        
        if (recipients.length === 1) {
          // Traditional DM
          sendAction("dm", { to: recipients[0], message });
        } else {
          // Multi-user visible message using permission system
          sendAction("permission.send_restricted", {
            room_id: activeRoom,
            message,
            visibility: "user_based",
            allowed_users: recipients,
          });
        }
        break;
      }

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

      // ── Permission Management ─────────────────────────────────────
      case "role":
      case "setrole":
        if (!parts[1] || !parts[2]) {
          printMsg(`${RED}  Usage: /role <user> <role>${R}`);
          printMsg(`${DIM}  Roles: owner, admin, member, guest${R}`);
          break;
        }
        sendAction("permission.set_role", {
          room_id: activeRoom,
          user_id: parts[1],
          role: parts[2].toLowerCase(),
        });
        break;

      case "grant":
        if (!parts[1] || !parts[2]) {
          printMsg(`${RED}  Usage: /grant <user> <role>${R}`);
          printMsg(`${DIM}  Roles: admin, member, guest${R}`);
          break;
        }
        sendAction("permission.set_role", {
          room_id: activeRoom,
          user_id: parts[1],
          role: parts[2].toLowerCase(),
        });
        break;

      case "myrole":
      case "whoami":
        sendAction("permission.get_my_permissions", { room_id: activeRoom });
        break;

      case "permissions":
      case "perms":
        sendAction("permission.get_room_config", { room_id: activeRoom });
        break;

      case "restrict":
        if (!parts[1]) {
          printMsg(`${RED}  Usage: /restrict <message> [visibility] [roles/users]${R}`);
          printMsg(`${DIM}  visibility: public, role_based, user_based${R}`);
          printMsg(`${DIM}  Example: /restrict "Admin only" role_based admin${R}`);
          break;
        }
        const restrictMsg = parts.slice(1).join(" ").split(/["']/).filter(s => s.trim())[0];
        const restrictVisibility = parts[parts.indexOf(restrictMsg.split(" ")[0]) + restrictMsg.split(" ").length + 1] || "role_based";
        const restrictTarget = parts.slice(parts.indexOf(restrictVisibility) + 1);
        
        sendAction("permission.send_restricted", {
          room_id: activeRoom,
          message: restrictMsg,
          visibility: restrictVisibility,
          allowed_roles: restrictVisibility === "role_based" ? restrictTarget : undefined,
          allowed_users: restrictVisibility === "user_based" ? restrictTarget : undefined,
        });
        break;

      case "mention":
      case "at":
        if (!parts[1]) {
          printMsg(`${RED}  Usage: /mention <user> [message]${R}`);
          printMsg(`${DIM}  Example: /mention Alice Hello there!${R}`);
          printMsg(`${DIM}  Or just type: @Alice Hello there!${R}`);
          break;
        }
        // Send message with @mention
        const mentionUser = parts[1];
        const mentionMessage = parts.length > 2 
          ? `@${mentionUser} ${parts.slice(2).join(" ")}`
          : `@${mentionUser}`;
        
        const mentionsList = extractMentions(mentionMessage);
        
        send({
          type: "chat",
          from: NAME,
          to: `room:${activeRoom}`,
          payload: { 
            message: mentionMessage,
            room: activeRoom,
            mentions: mentionsList.length > 0 ? mentionsList : undefined,
          },
        });
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

  // Extract @mentions from the message
  const mentions = extractMentions(trimmed);

  send({
    type: "chat",
    from: NAME,
    to: `room:${activeRoom}`,
    payload: { 
      message: trimmed,
      room: activeRoom,
      mentions: mentions.length > 0 ? mentions : undefined,
    },
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
      const rawMessage = p.message ?? "";
      const mentions = p.mentions as string[] | undefined;
      const ts = `${DIM}${timestamp()}${R}`;
      
      // Highlight mentions in the message
      const message = highlightMentions(rawMessage, NAME);
      
      // Check if current user is mentioned
      const isMentioned = mentions?.includes(NAME);
      const mentionIndicator = isMentioned ? ` ${YELLOW}[@]${R}` : "";

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
        printMsg(`${ts} ${roomTag}${CYAN}${msg.from}${R}${mentionIndicator}  ${message}`);
      } else {
        printMsg(`${ts} ${CYAN}${msg.from}${R}${mentionIndicator}  ${message}`);
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

        case "user.role_changed":
          const targetName = p.user_name;
          const newRole = p.new_role;
          const oldRole = p.old_role;
          printMsg(`${DIM}${timestamp()} ${YELLOW}⚡${R} ${targetName} role changed: ${getRoleColor(oldRole)}${oldRole}${R} → ${getRoleColor(newRole)}${newRole}${R} in #${p.room_id}${R}`);
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
            printMsg(`${DIM}  → Auto-joining #${room.id}...${R}`);
            // Auto-join the newly created room
            sendAction("room.join", { room_id: room.id });
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

        // ── Permission Management Responses ───────────────────────
        case "permission.set_role":
          if (success) {
            const data = p.data as any;
            printMsg(`${GREEN}  ✓ Role updated: ${data.userId} → ${data.newRole}${R}`);
          } else {
            printMsg(`${RED}  ✗ Failed to set role: ${p.error}${R}`);
          }
          break;

        case "permission.get_my_permissions": {
          if (success) {
            const data = p.data as any;
            const role = data.role;
            const perms = data.permissions;
            printMsg(`${DIM}  ┌ Your Permissions in #${data.room_id} ────${R}`);
            printMsg(`  ${BOLD}Role:${R} ${getRoleColor(role)}${role}${R}`);
            printMsg(`  ${BOLD}Capabilities:${R}`);
            if (perms) {
              const categories = {
                "Messaging": ["send_message", "send_restricted_message"],
                "Moderation": ["delete_message", "edit_message", "pin_message"],
                "Management": ["invite_member", "kick_member", "modify_permissions"],
                "Access": ["view_history", "view_members", "send_dm"]
              };
              
              for (const [category, actions] of Object.entries(categories)) {
                const relevantPerms = actions.filter(a => perms[a] !== undefined);
                if (relevantPerms.length > 0) {
                  printMsg(`    ${BOLD}${category}:${R}`);
                  for (const perm of relevantPerms) {
                    const value = perms[perm];
                    const icon = value ? `${GREEN}✓${R}` : `${DIM}✗${R}`;
                    const name = perm.replace(/_/g, " ");
                    printMsg(`      ${icon} ${name}`);
                  }
                }
              }
            }
            printMsg(`${DIM}  └──────────────────────────────────${R}`);
          } else {
            printMsg(`${RED}  ✗ Failed to get permissions: ${p.error}${R}`);
          }
          break;
        }

        case "permission.get_room_config": {
          if (success) {
            const data = p.data as any;
            const config = data.config;
            const perms = data.permissions;
            printMsg(`${DIM}  ┌ Room Configuration #${data.room_id} ───${R}`);
            if (config) {
              printMsg(`  ${BOLD}Settings:${R}`);
              printMsg(`    Default Role: ${getRoleColor(config.defaultRole)}${config.defaultRole}${R}`);
              printMsg(`    Default Visibility: ${config.defaultVisibility}`);
              printMsg(`    Message Rate Limit: ${config.messageRateLimit}/min`);
              if (config.memberHistoryLimit > 0) {
                printMsg(`    History Limit: ${config.memberHistoryLimit} messages`);
              }
            }
            if (perms) {
              printMsg(`  ${BOLD}Who Can:${R}`);
              const actions = {
                "Send messages": perms.canSendMessage,
                "Delete messages": perms.canDeleteMessages,
                "Invite members": perms.canInviteMembers,
                "Kick members": perms.canKickMembers,
                "Modify permissions": perms.canModifyPermissions,
              };
              for (const [action, roles] of Object.entries(actions)) {
                if (roles && Array.isArray(roles)) {
                  const roleStr = roles.map((r: string) => getRoleColor(r) + r + R).join(", ");
                  printMsg(`    ${action}: ${roleStr}`);
                }
              }
            }
            printMsg(`${DIM}  └──────────────────────────────────${R}`);
          } else {
            printMsg(`${RED}  ✗ Failed to get config: ${p.error}${R}`);
          }
          break;
        }

        case "permission.send_restricted":
          if (success) {
            printMsg(`${GREEN}  ✓ Restricted message sent${R}`);
          } else {
            printMsg(`${RED}  ✗ Failed to send restricted message: ${p.error}${R}`);
          }
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
  ${BOLD}Room & Chat${R}
  ${GREEN}/join${R} <room>         Join a room
  ${GREEN}/leave${R} [room]        Leave current or specified room
  ${GREEN}/switch${R} <room>       Switch active room (short: ${DIM}/s${R})
  ${GREEN}/rooms${R}               List all rooms
  ${GREEN}/members${R} [room]      Show room members
  ${GREEN}/users${R}               List online users
  ${GREEN}/create${R} <id> [name]  Create a new room
  ${GREEN}/history${R}             Show current room history

  ${BOLD}Messaging${R}
  ${GREEN}/dm${R} <user> <msg>     Send private message
  ${GREEN}/dm${R} user1,user2 ...  Send to multiple users
  ${GREEN}/mention${R} <user> ...  Mention a user (@user)
  ${DIM}Or just type: @username in any message${R}

  ${BOLD}Permission Management${R}
  ${GREEN}/role${R} <user> <role>  Set user role (owner/admin/member/guest)
  ${GREEN}/grant${R} <user> <role> Grant role to user (alias)
  ${GREEN}/myrole${R}              Show your role and permissions
  ${GREEN}/permissions${R}         Show room permission config
  ${GREEN}/restrict${R} <msg> ...  Send restricted message (advanced)

  ${BOLD}Other${R}
  ${GREEN}/debug${R}               Toggle signaling visibility
  ${GREEN}/quit${R}                Exit

  ${DIM}Type plain text to send to the active room.${R}
  ${DIM}Press TAB to autocomplete commands.${R}
  ${DIM}Short aliases: /j /l /s /r /m /u /d /c /at /q /h${R}
  ${DIM}Permission shortcuts: /whoami = /myrole, /perms = /permissions${R}
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
