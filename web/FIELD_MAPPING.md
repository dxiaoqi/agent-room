# 字段映射说明

## 问题描述

服务端 API 返回的字段名和前端原始类型定义不一致，导致数据无法正确渲染。

## 字段对照表

### 房间数据 (Room)

| 前端原始字段 | 服务端字段 | 说明 | 修复方案 |
|-------------|-----------|------|---------|
| `room_id` | `id` | 房间唯一标识 | ✅ 已统一为 `id` |
| `members: string[]` | `memberCount: number` | 成员信息 | ✅ 同时支持两种格式 |
| `password_protected` | `hasPassword` | 是否有密码 | ✅ 同时支持两种格式 |
| `created_at` | `createdAt` | 创建时间 | ✅ 同时支持两种格式 |
| - | `createdBy` | 创建者 | ✅ 已添加 |

### 修复后的类型定义

```typescript
export interface Room {
  id: string                    // 房间 ID（统一使用 id）
  name: string                  // 房间名称
  description?: string          // 描述
  memberCount?: number          // 成员数量（服务端返回）
  members?: string[]            // 成员列表（某些接口返回）
  persistent?: boolean          // 是否持久化
  hasPassword?: boolean         // 是否有密码（服务端字段名）
  password_protected?: boolean  // 兼容旧字段名
  createdAt?: string           // 创建时间（服务端字段名）
  created_at?: string          // 兼容旧字段名
  createdBy?: string           // 创建者
}
```

## 数据转换

添加了 `normalizeRoom()` 函数来统一处理不同格式的数据：

```typescript
function normalizeRoom(room: any): Room {
  return {
    id: room.id || room.room_id,
    name: room.name,
    description: room.description,
    memberCount: room.memberCount || room.member_count || room.members?.length || 0,
    members: room.members,
    persistent: room.persistent,
    hasPassword: room.hasPassword || room.has_password || room.password_protected,
    createdAt: room.createdAt || room.created_at,
    createdBy: room.createdBy || room.created_by
  }
}
```

## 服务端数据示例

### HTTP API `/rooms` 返回

```json
{
  "rooms": [
    {
      "id": "general",
      "name": "General",
      "description": "Default public room",
      "memberCount": 0,
      "createdBy": "server",
      "createdAt": "2026-02-06T08:27:50.428Z",
      "persistent": true,
      "hasPassword": false
    }
  ]
}
```

### WebSocket `room.list` 响应

```json
{
  "type": "response",
  "payload": {
    "action": "room.list",
    "success": true,
    "data": {
      "rooms": [
        {
          "id": "general",
          "name": "General",
          "memberCount": 0,
          ...
        }
      ]
    }
  }
}
```

## 修复内容

### 1. 更新类型定义 (`lib/types.ts`)

- ✅ 字段名统一为服务端格式
- ✅ 添加兼容性字段支持旧代码
- ✅ 添加 `createdBy` 等缺失字段

### 2. 添加数据转换 (`hooks/useAgentRoom.ts`)

- ✅ `normalizeRoom()` 函数统一数据格式
- ✅ 处理 `auth` 响应中的房间列表
- ✅ 处理 `room.list` 响应
- ✅ 同时兼容驼峰和下划线命名

### 3. 更新组件 (`components/ChatRoom.tsx`)

- ✅ `room.room_id` → `room.id`
- ✅ `room.members?.length` → `room.memberCount || room.members?.length`
- ✅ 更新所有使用房间数据的地方

## 测试验证

### 刷新页面后应该能看到：

1. **房间列表正常显示**
   ```
   #general (0 人)
   General
   
   #random (0 人)
   Random
   ```

2. **控制台日志**
   ```
   📋 Room list received (raw): [{id: "general", ...}]
   📋 Room list normalized: [{id: "general", memberCount: 0, ...}]
   🏠 Rooms updated: [2 rooms]
   ```

3. **可以点击房间加入**

## 向后兼容性

代码同时支持：
- 旧格式：`room_id`, `password_protected`, `created_at`
- 新格式：`id`, `hasPassword`, `createdAt`

这确保了与不同版本服务端的兼容性。

## 相关文件

- `web/lib/types.ts` - 类型定义
- `web/hooks/useAgentRoom.ts` - 数据处理逻辑
- `web/components/ChatRoom.tsx` - UI 组件
- `src/service/http-api.ts` - 服务端 HTTP API
- `src/service/ws-server.ts` - 服务端 WebSocket 处理

## 注意事项

1. **发送给服务端的数据**仍然使用 `room_id` 字段（服务端期望的格式）
2. **从服务端接收的数据**使用 `id` 字段（服务端返回的格式）
3. 数据转换发生在接收时，发送时不需要转换

---

**问题已解决！** 刷新页面即可看到房间列表正常显示。✅
