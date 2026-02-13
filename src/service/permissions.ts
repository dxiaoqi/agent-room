/**
 * Permission System — Role-based access control for rooms and messages
 *
 * Defines roles, permissions, and access control logic for the messaging service.
 */

import { Logger } from "../core/logger.js";

const log = Logger.create("permissions");

// ─── Role Definitions ────────────────────────────────────────────────

/**
 * User roles in a room (hierarchical)
 * Simplified to 4 roles (Admin combines Administrator + Moderator capabilities)
 */
export enum UserRole {
  OWNER = "owner",         // Room creator, highest authority
  ADMIN = "admin",         // Administrator, can manage room, users, and content
  MEMBER = "member",       // Regular member, basic permissions
  GUEST = "guest"          // Guest, read-only access
}

/**
 * Role hierarchy (higher number = higher privilege)
 */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  [UserRole.OWNER]: 4,
  [UserRole.ADMIN]: 3,
  [UserRole.MEMBER]: 2,
  [UserRole.GUEST]: 1,
};

// ─── Message Visibility ──────────────────────────────────────────────

/**
 * Message visibility levels
 */
export enum MessageVisibility {
  PUBLIC = "public",           // All room members can see
  ROLE_BASED = "role_based",   // Only specified roles can see
  USER_BASED = "user_based",   // Only specified users can see
  PRIVATE = "private"          // Only sender and explicit receivers
}

/**
 * Permission configuration for a message
 */
export interface MessagePermission {
  /** Visibility level */
  visibility: MessageVisibility;

  /** Allowed roles (for ROLE_BASED visibility) */
  allowedRoles?: UserRole[];

  /** Allowed user IDs (for USER_BASED or PRIVATE visibility) */
  allowedUsers?: string[];

  /** Explicitly denied user IDs (overrides other permissions) */
  deniedUsers?: string[];

  /** Permission expiration time (ISO-8601) */
  expiresAt?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

// ─── Room Permissions ────────────────────────────────────────────────

/**
 * Room-level permission configuration
 */
export interface RoomPermissions {
  /** Who can send messages */
  canSendMessage: UserRole[];

  /** Who can view full history */
  canViewHistory: UserRole[];

  /** Who can create restricted (permission-controlled) messages */
  canCreateRestrictedMessage: UserRole[];

  /** Who can invite new members */
  canInviteMembers: UserRole[];

  /** Who can kick members (note: still subject to role hierarchy) */
  canKickMembers: UserRole[];

  /** Who can modify room permissions */
  canModifyPermissions: UserRole[];

  /** Who can delete others' messages */
  canDeleteMessages: UserRole[];

  /** Who can edit others' messages */
  canEditMessages: UserRole[];

  /** Who can pin messages */
  canPinMessages: UserRole[];

  /** Who can view member list */
  canViewMembers: UserRole[];

  /** Who can send DMs */
  canSendDM: UserRole[];
}

/**
 * Room configuration options
 */
export interface RoomConfig {
  /** Default visibility for messages */
  defaultVisibility: MessageVisibility;

  /** Default role for new members */
  defaultRole: UserRole;

  /** Whether members can invite others */
  memberCanInvite: boolean;

  /** History message limit for members (-1 = unlimited) */
  memberHistoryLimit: number;

  /** Guest session timeout in seconds (-1 = no timeout) */
  guestSessionTimeout: number;

  /** Whether approval is required to become a member */
  requireApprovalForMember: boolean;

  /** Message rate limit (messages per minute, -1 = no limit) */
  messageRateLimit: number;
}

// ─── Permission Actions ──────────────────────────────────────────────

/**
 * All possible permission-controlled actions
 */
export enum PermissionAction {
  // Room management
  DELETE_ROOM = "delete_room",
  MODIFY_ROOM = "modify_room",
  TRANSFER_OWNERSHIP = "transfer_ownership",

  // Permission management
  MODIFY_PERMISSIONS = "modify_permissions",
  SET_USER_ROLE = "set_user_role",

  // Member management
  INVITE_MEMBER = "invite_member",
  KICK_MEMBER = "kick_member",
  BAN_MEMBER = "ban_member",
  VIEW_MEMBERS = "view_members",

  // Message actions
  SEND_MESSAGE = "send_message",
  SEND_RESTRICTED_MESSAGE = "send_restricted_message",
  DELETE_MESSAGE = "delete_message",
  EDIT_MESSAGE = "edit_message",
  PIN_MESSAGE = "pin_message",

  // Content viewing
  VIEW_PUBLIC_MESSAGES = "view_public_messages",
  VIEW_RESTRICTED_MESSAGES = "view_restricted_messages",
  VIEW_HISTORY = "view_history",
  VIEW_AUDIT_LOG = "view_audit_log",

  // Direct messaging
  SEND_DM = "send_dm",
  RECEIVE_DM = "receive_dm",
}

// ─── Permission Checker ──────────────────────────────────────────────

/**
 * Permission checker — validates if a user can perform an action
 */
export class PermissionChecker {
  /**
   * Check if a user can perform an action based on their role
   */
  canPerformAction(
    action: PermissionAction,
    userRole: UserRole,
    roomPermissions: RoomPermissions,
    targetRole?: UserRole
  ): boolean {
    switch (action) {
      // Room management (Owner only)
      case PermissionAction.DELETE_ROOM:
      case PermissionAction.TRANSFER_OWNERSHIP:
        return userRole === UserRole.OWNER;

      case PermissionAction.MODIFY_ROOM:
        return [UserRole.OWNER, UserRole.ADMIN].includes(userRole);

      // Permission management
      case PermissionAction.MODIFY_PERMISSIONS:
        return roomPermissions.canModifyPermissions.includes(userRole);

      case PermissionAction.SET_USER_ROLE:
        // Owner can set any role
        if (userRole === UserRole.OWNER) {
          return true;
        }
        // Admin can only set Member and Guest roles
        if (userRole === UserRole.ADMIN && targetRole) {
          return ROLE_HIERARCHY[targetRole] <= ROLE_HIERARCHY[UserRole.MEMBER];
        }
        return false;

      // Member management
      case PermissionAction.INVITE_MEMBER:
        return roomPermissions.canInviteMembers.includes(userRole);

      case PermissionAction.KICK_MEMBER:
      case PermissionAction.BAN_MEMBER:
        // Must have permission AND higher role than target
        if (targetRole && !this.isHigherRole(userRole, targetRole)) {
          return false;
        }
        return roomPermissions.canKickMembers.includes(userRole);

      case PermissionAction.VIEW_MEMBERS:
        return roomPermissions.canViewMembers.includes(userRole);

      // Message actions
      case PermissionAction.SEND_MESSAGE:
        return roomPermissions.canSendMessage.includes(userRole);

      case PermissionAction.SEND_RESTRICTED_MESSAGE:
        return roomPermissions.canCreateRestrictedMessage.includes(userRole);

      case PermissionAction.DELETE_MESSAGE:
        return roomPermissions.canDeleteMessages.includes(userRole);

      case PermissionAction.EDIT_MESSAGE:
        return roomPermissions.canEditMessages.includes(userRole);

      case PermissionAction.PIN_MESSAGE:
        return roomPermissions.canPinMessages.includes(userRole);

      // Content viewing
      case PermissionAction.VIEW_PUBLIC_MESSAGES:
        return true; // Everyone can view public messages

      case PermissionAction.VIEW_HISTORY:
        return roomPermissions.canViewHistory.includes(userRole);

      case PermissionAction.VIEW_AUDIT_LOG:
        return [UserRole.OWNER, UserRole.ADMIN].includes(userRole);

      // Direct messaging
      case PermissionAction.SEND_DM:
        return roomPermissions.canSendDM.includes(userRole);

      case PermissionAction.RECEIVE_DM:
        return userRole !== UserRole.GUEST; // Guests cannot receive DMs

      default:
        log.warn("unknown permission action", { action });
        return false;
    }
  }

  /**
   * Check if a user can perform any action (with Owner bypass)
   */
  private _canPerformWithOwnerBypass(
    action: PermissionAction,
    userRole: UserRole,
    roomPermissions: RoomPermissions,
    targetRole?: UserRole
  ): boolean {
    // Owner can do everything except transfer to themselves
    if (userRole === UserRole.OWNER) {
      return true;
    }
    return this.canPerformAction(action, userRole, roomPermissions, targetRole);
  }

  /**
   * Check if a user can view a specific message
   */
  canViewMessage(
    message: { from: string; permission?: MessagePermission },
    userId: string,
    userRole: UserRole,
    defaultVisibility: MessageVisibility = MessageVisibility.PUBLIC
  ): boolean {
    // Message sender can always see their own message
    if (message.from === userId) {
      return true;
    }

    // Owner can see everything
    if (userRole === UserRole.OWNER) {
      return true;
    }

    const permission = message.permission ?? {
      visibility: defaultVisibility,
    };

    // Check if permission has expired
    if (permission.expiresAt) {
      if (new Date(permission.expiresAt) < new Date()) {
        return false;
      }
    }

    // Check explicit deny list
    if (permission.deniedUsers?.includes(userId)) {
      return false;
    }

    // Check visibility level
    switch (permission.visibility) {
      case MessageVisibility.PUBLIC:
        return true;

      case MessageVisibility.ROLE_BASED:
        if (!permission.allowedRoles || permission.allowedRoles.length === 0) {
          return false;
        }
        // User's role must match or be higher than any allowed role
        const minAllowedLevel = Math.min(
          ...permission.allowedRoles.map((r) => ROLE_HIERARCHY[r])
        );
        return ROLE_HIERARCHY[userRole] >= minAllowedLevel;

      case MessageVisibility.USER_BASED:
      case MessageVisibility.PRIVATE:
        return permission.allowedUsers?.includes(userId) ?? false;

      default:
        return false;
    }
  }

  /**
   * Filter messages based on user's view permissions
   */
  filterVisibleMessages<T extends { from: string; permission?: MessagePermission }>(
    messages: T[],
    userId: string,
    userRole: UserRole,
    defaultVisibility: MessageVisibility = MessageVisibility.PUBLIC
  ): T[] {
    return messages.filter((msg) =>
      this.canViewMessage(msg, userId, userRole, defaultVisibility)
    );
  }

  /**
   * Check if role A is higher than role B
   */
  isHigherRole(roleA: UserRole, roleB: UserRole): boolean {
    return ROLE_HIERARCHY[roleA] > ROLE_HIERARCHY[roleB];
  }

  /**
   * Check if a user can promote/demote another user
   */
  canChangeRole(
    actorRole: UserRole,
    targetCurrentRole: UserRole,
    targetNewRole: UserRole
  ): boolean {
    // Owner can change anyone's role (except their own)
    if (actorRole === UserRole.OWNER) {
      return targetCurrentRole !== UserRole.OWNER;
    }

    // Admin can only promote/demote between Member and Guest
    if (actorRole === UserRole.ADMIN) {
      return (
        [UserRole.MEMBER, UserRole.GUEST].includes(targetCurrentRole) &&
        [UserRole.MEMBER, UserRole.GUEST].includes(targetNewRole)
      );
    }

    // Member and Guest cannot change roles
    return false;
  }
}

// ─── Default Configurations ──────────────────────────────────────────

/**
 * Get default room permissions (balanced)
 */
export function getDefaultRoomPermissions(): RoomPermissions {
  return {
    canSendMessage: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
    canViewHistory: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
    canCreateRestrictedMessage: [UserRole.OWNER, UserRole.ADMIN],
    canInviteMembers: [UserRole.OWNER, UserRole.ADMIN],
    canKickMembers: [UserRole.OWNER, UserRole.ADMIN],
    canModifyPermissions: [UserRole.OWNER, UserRole.ADMIN],
    canDeleteMessages: [UserRole.OWNER, UserRole.ADMIN],
    canEditMessages: [UserRole.OWNER, UserRole.ADMIN],
    canPinMessages: [UserRole.OWNER, UserRole.ADMIN],
    canViewMembers: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER, UserRole.GUEST],
    canSendDM: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
  };
}

/**
 * Get conservative room permissions (high security)
 */
export function getConservativeRoomPermissions(): RoomPermissions {
  return {
    canSendMessage: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
    canViewHistory: [UserRole.OWNER, UserRole.ADMIN],
    canCreateRestrictedMessage: [UserRole.OWNER, UserRole.ADMIN],
    canInviteMembers: [UserRole.OWNER, UserRole.ADMIN],
    canKickMembers: [UserRole.OWNER, UserRole.ADMIN],
    canModifyPermissions: [UserRole.OWNER],
    canDeleteMessages: [UserRole.OWNER, UserRole.ADMIN],
    canEditMessages: [UserRole.OWNER],
    canPinMessages: [UserRole.OWNER, UserRole.ADMIN],
    canViewMembers: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
    canSendDM: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
  };
}

/**
 * Get open room permissions (easy to use)
 */
export function getOpenRoomPermissions(): RoomPermissions {
  return {
    canSendMessage: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
    canViewHistory: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER, UserRole.GUEST],
    canCreateRestrictedMessage: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
    canInviteMembers: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
    canKickMembers: [UserRole.OWNER, UserRole.ADMIN],
    canModifyPermissions: [UserRole.OWNER, UserRole.ADMIN],
    canDeleteMessages: [UserRole.OWNER, UserRole.ADMIN],
    canEditMessages: [UserRole.OWNER, UserRole.ADMIN],
    canPinMessages: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
    canViewMembers: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER, UserRole.GUEST],
    canSendDM: [UserRole.OWNER, UserRole.ADMIN, UserRole.MEMBER],
  };
}

/**
 * Get default room configuration (balanced)
 */
export function getDefaultRoomConfig(): RoomConfig {
  return {
    defaultVisibility: MessageVisibility.PUBLIC,
    defaultRole: UserRole.MEMBER,
    memberCanInvite: true,
    memberHistoryLimit: -1, // unlimited
    guestSessionTimeout: -1, // no timeout
    requireApprovalForMember: false,
    messageRateLimit: 60, // 60 messages per minute
  };
}

/**
 * Get conservative room configuration (high security)
 */
export function getConservativeRoomConfig(): RoomConfig {
  return {
    defaultVisibility: MessageVisibility.PUBLIC,
    defaultRole: UserRole.GUEST,
    memberCanInvite: false,
    memberHistoryLimit: 100,
    guestSessionTimeout: 3600, // 1 hour
    requireApprovalForMember: true,
    messageRateLimit: 20, // 20 messages per minute
  };
}

/**
 * Get open room configuration (easy to use)
 */
export function getOpenRoomConfig(): RoomConfig {
  return {
    defaultVisibility: MessageVisibility.PUBLIC,
    defaultRole: UserRole.MEMBER,
    memberCanInvite: true,
    memberHistoryLimit: -1,
    guestSessionTimeout: -1,
    requireApprovalForMember: false,
    messageRateLimit: 120, // 120 messages per minute
  };
}

// ─── Audit Logging ───────────────────────────────────────────────────

/**
 * Permission audit log entry
 */
export interface PermissionAuditLog {
  /** Timestamp (ISO-8601) */
  timestamp: string;

  /** User who performed the action */
  actor: string;

  /** Action type */
  action: PermissionAction | string;

  /** Target user (if applicable) */
  target?: string;

  /** Room ID */
  roomId: string;

  /** Whether the action was successful */
  success: boolean;

  /** Old value (for changes) */
  oldValue?: unknown;

  /** New value (for changes) */
  newValue?: unknown;

  /** Failure reason (if applicable) */
  reason?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Create an audit log entry
 */
export function createAuditLog(
  actor: string,
  action: PermissionAction | string,
  roomId: string,
  success: boolean,
  options?: {
    target?: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    metadata?: Record<string, unknown>;
  }
): PermissionAuditLog {
  return {
    timestamp: new Date().toISOString(),
    actor,
    action,
    roomId,
    success,
    ...options,
  };
}

// ─── Singleton Instance ──────────────────────────────────────────────

export const permissionChecker = new PermissionChecker();
