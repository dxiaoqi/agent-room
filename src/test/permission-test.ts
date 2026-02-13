/**
 * Permission System Test
 * 
 * Tests the role-based access control system for rooms and messages.
 */

import { 
  UserRole, 
  MessageVisibility,
  permissionChecker,
  PermissionAction,
  getDefaultRoomPermissions,
  type MessagePermission
} from "../service/permissions.js";

console.log("🧪 Permission System Test\n");

// ─── Test 1: Basic Permission Checks ─────────────────────────────────

console.log("📋 Test 1: Basic Permission Checks");
console.log("─".repeat(50));

const roomPermissions = getDefaultRoomPermissions();

const testCases = [
  { role: UserRole.OWNER, action: PermissionAction.DELETE_MESSAGE },
  { role: UserRole.ADMIN, action: PermissionAction.DELETE_MESSAGE },
  { role: UserRole.MEMBER, action: PermissionAction.SEND_MESSAGE },
  { role: UserRole.MEMBER, action: PermissionAction.DELETE_MESSAGE },
  { role: UserRole.GUEST, action: PermissionAction.SEND_MESSAGE },
];

testCases.forEach(({ role, action }) => {
  const canPerform = permissionChecker.canPerformAction(action, role, roomPermissions);
  console.log(`  ${role.padEnd(10)} ${action.padEnd(30)} ${canPerform ? '✅' : '❌'}`);
});

console.log();

// ─── Test 2: Message Visibility ──────────────────────────────────────

console.log("📋 Test 2: Message Visibility");
console.log("─".repeat(50));

// Public message
const publicMessage = {
  from: "alice",
  permission: {
    visibility: MessageVisibility.PUBLIC
  } as MessagePermission
};

// Role-based message (only Admin and above)
const roleBasedMessage = {
  from: "bob",
  permission: {
    visibility: MessageVisibility.ROLE_BASED,
    allowedRoles: [UserRole.ADMIN]
  } as MessagePermission
};

// User-based message (specific users)
const userBasedMessage = {
  from: "charlie",
  permission: {
    visibility: MessageVisibility.USER_BASED,
    allowedUsers: ["alice", "bob"]
  } as MessagePermission
};

const users = [
  { id: "alice", role: UserRole.OWNER },
  { id: "bob", role: UserRole.ADMIN },
  { id: "charlie", role: UserRole.MEMBER },
  { id: "dave", role: UserRole.GUEST }
];

console.log("\n  Public Message:");
users.forEach(user => {
  const canView = permissionChecker.canViewMessage(publicMessage, user.id, user.role);
  console.log(`    ${user.id.padEnd(10)} (${user.role.padEnd(7)}) ${canView ? '✅ Can view' : '❌ Cannot view'}`);
});

console.log("\n  Role-Based Message (Admin only):");
users.forEach(user => {
  const canView = permissionChecker.canViewMessage(roleBasedMessage, user.id, user.role);
  console.log(`    ${user.id.padEnd(10)} (${user.role.padEnd(7)}) ${canView ? '✅ Can view' : '❌ Cannot view'}`);
});

console.log("\n  User-Based Message (alice, bob only):");
users.forEach(user => {
  const canView = permissionChecker.canViewMessage(userBasedMessage, user.id, user.role);
  console.log(`    ${user.id.padEnd(10)} (${user.role.padEnd(7)}) ${canView ? '✅ Can view' : '❌ Cannot view'}`);
});

console.log();

// ─── Test 3: Role Change Permissions ─────────────────────────────────

console.log("📋 Test 3: Role Change Permissions");
console.log("─".repeat(50));

const roleChanges = [
  { actor: UserRole.OWNER, target: UserRole.MEMBER, newRole: UserRole.ADMIN },
  { actor: UserRole.ADMIN, target: UserRole.MEMBER, newRole: UserRole.GUEST },
  { actor: UserRole.ADMIN, target: UserRole.ADMIN, newRole: UserRole.MEMBER },
  { actor: UserRole.MEMBER, target: UserRole.GUEST, newRole: UserRole.MEMBER },
];

roleChanges.forEach(({ actor, target, newRole }) => {
  const canChange = permissionChecker.canChangeRole(actor, target, newRole);
  console.log(
    `  ${actor.padEnd(7)} change ${target.padEnd(7)} → ${newRole.padEnd(7)} ${canChange ? '✅' : '❌'}`
  );
});

console.log();

// ─── Test 4: Message Filtering ───────────────────────────────────────

console.log("📋 Test 4: Message Filtering");
console.log("─".repeat(50));

const messages = [
  {
    id: "msg1",
    from: "alice",
    content: "Public announcement",
    permission: { visibility: MessageVisibility.PUBLIC } as MessagePermission
  },
  {
    id: "msg2",
    from: "bob",
    content: "Admin only discussion",
    permission: {
      visibility: MessageVisibility.ROLE_BASED,
      allowedRoles: [UserRole.ADMIN]
    } as MessagePermission
  },
  {
    id: "msg3",
    from: "charlie",
    content: "Team discussion",
    permission: {
      visibility: MessageVisibility.USER_BASED,
      allowedUsers: ["alice", "bob", "charlie"]
    } as MessagePermission
  },
  {
    id: "msg4",
    from: "dave",
    content: "Another public message",
    permission: { visibility: MessageVisibility.PUBLIC } as MessagePermission
  }
];

console.log(`\n  Total messages: ${messages.length}`);

users.forEach(user => {
  const filtered = permissionChecker.filterVisibleMessages(
    messages,
    user.id,
    user.role
  );
  console.log(`  ${user.id.padEnd(10)} (${user.role.padEnd(7)}) can see ${filtered.length}/${messages.length} messages`);
});

console.log();

// ─── Test 5: Permission Denied by Deny List ──────────────────────────

console.log("📋 Test 5: Denied Users List");
console.log("─".repeat(50));

const messageWithDenyList = {
  from: "alice",
  content: "Everyone except Dave",
  permission: {
    visibility: MessageVisibility.PUBLIC,
    deniedUsers: ["dave"]
  } as MessagePermission
};

console.log("\n  Message with deny list (dave is denied):");
users.forEach(user => {
  const canView = permissionChecker.canViewMessage(
    messageWithDenyList,
    user.id,
    user.role
  );
  console.log(`    ${user.id.padEnd(10)} (${user.role.padEnd(7)}) ${canView ? '✅ Can view' : '❌ Cannot view (denied)'}`);
});

console.log();

// ─── Test 6: Expired Permissions ─────────────────────────────────────

console.log("📋 Test 6: Expired Permissions");
console.log("─".repeat(50));

const expiredMessage = {
  from: "alice",
  content: "This message expired 1 hour ago",
  permission: {
    visibility: MessageVisibility.PUBLIC,
    expiresAt: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
  } as MessagePermission
};

const futureMessage = {
  from: "alice",
  content: "This message expires in 1 hour",
  permission: {
    visibility: MessageVisibility.PUBLIC,
    expiresAt: new Date(Date.now() + 3600000).toISOString() // 1 hour from now
  } as MessagePermission
};

console.log("\n  Expired message:");
const canViewExpired = permissionChecker.canViewMessage(expiredMessage, "bob", UserRole.ADMIN);
console.log(`    Admin can view: ${canViewExpired ? '✅' : '❌ (expired)'}`);

console.log("\n  Future expiry message:");
const canViewFuture = permissionChecker.canViewMessage(futureMessage, "bob", UserRole.ADMIN);
console.log(`    Admin can view: ${canViewFuture ? '✅' : '❌'}`);

console.log();

// ─── Summary ─────────────────────────────────────────────────────────

console.log("✅ Permission System Test Complete");
console.log();
console.log("📊 Summary:");
console.log("  - 4 role levels: Owner, Admin, Member, Guest");
console.log("  - 4 visibility types: Public, Role-Based, User-Based, Private");
console.log("  - Message filtering by permissions");
console.log("  - Deny lists and expiration support");
console.log("  - Role-based action control");
console.log();
