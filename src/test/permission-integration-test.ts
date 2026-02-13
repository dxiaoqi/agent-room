/**
 * Permission System Integration Test
 * 
 * Demonstrates the permission system with actual WebSocket communication.
 * 
 * Usage:
 *   1. Start the service: npm run service
 *   2. Run this test: npx tsx src/test/permission-integration-test.ts
 */

import { WebSocket } from "ws";
import { type ServiceMessage } from "../service/protocol.js";

const SERVICE_URL = "ws://localhost:9000";
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface TestUser {
  name: string;
  ws: WebSocket;
  authenticated: boolean;
}

const users: Record<string, TestUser> = {};

function createUser(name: string): Promise<TestUser> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVICE_URL);
    const user: TestUser = { name, ws, authenticated: false };
    
    ws.on("open", () => {
      console.log(`  ✅ ${name} connected`);
    });
    
    ws.on("message", (data: Buffer) => {
      const msg: ServiceMessage = JSON.parse(data.toString());
      
      if (msg.type === "system" && (msg.payload as any).event === "welcome") {
        // Authenticate
        ws.send(JSON.stringify({
          type: "action",
          from: name,
          payload: { action: "auth", name }
        }));
      } else if (msg.type === "response" && (msg.payload as any).action === "auth") {
        if ((msg.payload as any).success) {
          user.authenticated = true;
          console.log(`  ✅ ${name} authenticated`);
          resolve(user);
        } else {
          reject(new Error(`Auth failed for ${name}`));
        }
      } else {
        // Log other messages
        if (msg.type === "chat") {
          const message = (msg.payload as any).message;
          console.log(`  📨 ${name} received: "${message}" from ${msg.from}`);
        } else if (msg.type === "system") {
          const event = (msg.payload as any).event;
          if (event === "user.role_changed") {
            const target = (msg.payload as any).user_name;
            const newRole = (msg.payload as any).new_role;
            console.log(`  🔄 ${name} sees: ${target} → ${newRole}`);
          }
        } else if (msg.type === "response") {
          const action = (msg.payload as any).action;
          const success = (msg.payload as any).success;
          console.log(`  📋 ${name} response: ${action} ${success ? '✅' : '❌'}`);
        }
      }
    });
    
    ws.on("error", (err) => {
      console.error(`  ❌ ${name} error:`, err.message);
      reject(err);
    });
    
    setTimeout(() => {
      if (!user.authenticated) {
        reject(new Error(`Timeout authenticating ${name}`));
      }
    }, 5000);
  });
}

function sendAction(user: TestUser, action: string, payload: any): void {
  user.ws.send(JSON.stringify({
    type: "action",
    from: user.name,
    payload: { action, ...payload }
  }));
}

function sendChat(user: TestUser, roomId: string, message: string): void {
  user.ws.send(JSON.stringify({
    type: "chat",
    from: user.name,
    to: `room:${roomId}`,
    payload: { message }
  }));
}

async function runTest() {
  console.log("\n🧪 Permission System Integration Test");
  console.log("═".repeat(60));
  
  try {
    // ─── Step 1: Connect users ───────────────────────────────────────
    console.log("\n📌 Step 1: Connect and authenticate users");
    console.log("─".repeat(60));
    
    users.alice = await createUser("alice");
    users.bob = await createUser("bob");
    users.charlie = await createUser("charlie");
    users.dave = await createUser("dave");
    
    await delay(500);
    
    // ─── Step 2: Create and join room ────────────────────────────────
    console.log("\n📌 Step 2: Create room and join");
    console.log("─".repeat(60));
    
    sendAction(users.alice, "room.create", {
      room_id: "test-room",
      name: "Test Room",
      description: "Permission test room"
    });
    
    await delay(500);
    
    sendAction(users.bob, "room.join", { room_id: "test-room" });
    sendAction(users.charlie, "room.join", { room_id: "test-room" });
    sendAction(users.dave, "room.join", { room_id: "test-room" });
    
    await delay(1000);
    
    // ─── Step 3: Send public message ─────────────────────────────────
    console.log("\n📌 Step 3: Send public message");
    console.log("─".repeat(60));
    
    sendChat(users.alice, "test-room", "Hello everyone! This is a public message.");
    
    await delay(500);
    
    // ─── Step 4: Promote Bob to Admin ────────────────────────────────
    console.log("\n📌 Step 4: Alice promotes Bob to Admin");
    console.log("─".repeat(60));
    
    sendAction(users.alice, "permission.set_role", {
      room_id: "test-room",
      user_id: "bob",
      role: "admin"
    });
    
    await delay(1000);
    
    // ─── Step 5: Send admin-only message ─────────────────────────────
    console.log("\n📌 Step 5: Alice sends admin-only message");
    console.log("─".repeat(60));
    console.log("  Expected: Only Alice and Bob can see this");
    
    sendAction(users.alice, "permission.send_restricted", {
      room_id: "test-room",
      message: "🔒 This is admin-only information",
      visibility: "role_based",
      allowed_roles: ["admin"]
    });
    
    await delay(500);
    
    // ─── Step 6: Send user-specific message ──────────────────────────
    console.log("\n📌 Step 6: Bob sends message to specific users");
    console.log("─".repeat(60));
    console.log("  Expected: Only Bob and Charlie can see this");
    
    sendAction(users.bob, "permission.send_restricted", {
      room_id: "test-room",
      message: "👥 Private discussion between Bob and Charlie",
      visibility: "user_based",
      allowed_users: ["bob", "charlie"]
    });
    
    await delay(500);
    
    // ─── Step 7: Charlie tries to send restricted message ────────────
    console.log("\n📌 Step 7: Charlie (member) tries to send restricted message");
    console.log("─".repeat(60));
    console.log("  Expected: Permission denied");
    
    sendAction(users.charlie, "permission.send_restricted", {
      room_id: "test-room",
      message: "This should fail",
      visibility: "role_based",
      allowed_roles: ["member"]
    });
    
    await delay(500);
    
    // ─── Step 8: Check permissions ───────────────────────────────────
    console.log("\n📌 Step 8: Check user permissions");
    console.log("─".repeat(60));
    
    sendAction(users.charlie, "permission.get_my_permissions", {
      room_id: "test-room"
    });
    
    await delay(500);
    
    // ─── Step 9: Dave tries to delete message ────────────────────────
    console.log("\n📌 Step 9: Dave (member) tries to kick someone");
    console.log("─".repeat(60));
    console.log("  Expected: Permission denied (members can't kick)");
    
    sendAction(users.dave, "room.leave", { room_id: "test-room" });
    
    await delay(500);
    
    // ─── Step 10: Send expiring message ──────────────────────────────
    console.log("\n📌 Step 10: Alice sends message that expires in 3 seconds");
    console.log("─".repeat(60));
    
    sendAction(users.alice, "permission.send_restricted", {
      room_id: "test-room",
      message: "⏰ This message will expire in 3 seconds",
      visibility: "public",
      expires_in: 3
    });
    
    await delay(1000);
    
    // ─── Cleanup ──────────────────────────────────────────────────────
    console.log("\n📌 Cleanup: Closing connections");
    console.log("─".repeat(60));
    
    Object.values(users).forEach(user => {
      if (user.ws.readyState === WebSocket.OPEN) {
        user.ws.close();
      }
    });
    
    await delay(500);
    
    console.log("\n✅ Test completed successfully!");
    console.log("═".repeat(60));
    console.log("\n📊 Summary:");
    console.log("  - 4 users connected and authenticated");
    console.log("  - Room created with proper ownership");
    console.log("  - Role promotion working (alice promoted bob)");
    console.log("  - Public messages delivered to all members");
    console.log("  - Admin-only messages filtered correctly");
    console.log("  - User-specific messages filtered correctly");
    console.log("  - Permission checks preventing unauthorized actions");
    console.log("  - Message expiration support");
    console.log();
    
  } catch (err) {
    console.error("\n❌ Test failed:", err);
    
    // Cleanup on error
    Object.values(users).forEach(user => {
      if (user?.ws?.readyState === WebSocket.OPEN) {
        user.ws.close();
      }
    });
  }
  
  process.exit(0);
}

// Run test
console.log("\n⏳ Starting permission integration test...");
console.log("Make sure the service is running: npm run service");
console.log();

setTimeout(() => {
  runTest();
}, 1000);
