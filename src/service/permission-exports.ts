/**
 * Permission System Exports
 * 
 * Convenience exports for the permission system.
 * Import from this file to use permissions in your code.
 */

export {
  // Enums
  UserRole,
  MessageVisibility,
  PermissionAction,
  
  // Types
  type MessagePermission,
  type RoomPermissions,
  type RoomConfig,
  type PermissionAuditLog,
  
  // Role hierarchy
  ROLE_HIERARCHY,
  
  // Permission checker
  PermissionChecker,
  permissionChecker,
  
  // Configuration helpers
  getDefaultRoomPermissions,
  getConservativeRoomPermissions,
  getOpenRoomPermissions,
  getDefaultRoomConfig,
  getConservativeRoomConfig,
  getOpenRoomConfig,
  
  // Audit log helper
  createAuditLog,
} from "./permissions.js";

// Re-export protocol types for convenience
export {
  type ServiceMessage,
  type ActionType,
  type ActionPayload,
  type ChatPayload,
  type ResponsePayload,
  type SystemPayload,
  type MessageType,
} from "./protocol.js";
