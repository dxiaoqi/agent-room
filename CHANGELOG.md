# Changelog

## [v0.3.5] - 2026-02-13

### Added
- **@Mention System**: Mention users with `@username` in chat messages
  - Highlighted display for mentioned users
  - Support for usernames with spaces using quotes
  - Visual `[@]` indicator for mentions
  
- **TAB Command Completion**: Autocomplete commands with TAB key
  - 30+ commands supported
  - Partial match completion
  - Show all commands with `/[TAB]`

- **Multi-User Messages**: Send messages to multiple users
  - Syntax: `/dm [user1, user2] message` or `/dm user1,user2 message`
  - Recipients must be in the same room
  - Requires admin/owner permission
  
- **Permission Management**: CLI commands for role management
  - `/role <user> <role>` - Set user roles
  - `/myrole` - View your permissions
  - `/permissions` - View room configuration
  - `/mention <user>` - Mention command

- **Auto-Join Created Rooms**: Automatically join rooms after creation with owner permission

### Fixed
- Multi-user message delivery (username to user ID conversion)
- Zombie connection cleanup (disconnected sessions prevention)
- CLI argument parsing for `--name`, `--url`, `--room` flags
- Room owner permission on creation

### Changed
- Updated help text with new commands
- Improved user feedback for multi-user messages
- Enhanced CLI user experience

### Technical
- Extended `ChatPayload` with `mentions` and `dm` fields
- Added `getByName()` support in user management
- Implemented TAB completion using readline completer
- Added mention parsing and highlighting functions

---

## [v0.2.3] - Previous

### Added
- Permission system with role-based access control
- Room-level and message-level permissions
- User roles: Owner, Admin, Member, Guest
- Message visibility controls
- Reconnection token system
- Zombie connection cleanup

### Core Features
- Real-time messaging service
- WebSocket and SSE support
- Room management
- Direct messages
- MCP integration
- Web client interface

---

For detailed documentation, see:
- [README.md](./README.md) - Main documentation
- [DOC.md](./DOC.md) - Technical documentation
- [README.zh-CN.md](./README.zh-CN.md) - Chinese version
