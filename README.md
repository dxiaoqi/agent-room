# AgentRoom

MCP 流桥接工具 + 可部署的实时消息服务。

项目分为两个独立模块：

| 模块 | 用途 | 运行环境 |
|------|------|----------|
| **MCP** | 让 IDE（Cursor）和 CLI 工具连接任意 WebSocket/SSE 数据流，或直接接入 Service | 本地 |
| **Service** | 可部署到云服务器的实时消息服务，支持房间和私聊 | 云端 / 本地 |

---

## 安装

```bash
# 全局安装（推荐）
npm install -g agent-room

# 或作为项目依赖
npm install agent-room
```

## 快速开始

```bash
# 启动消息服务（本地测试）
agent-room-service
# 或
npx agent-room-service

# 启动 CLI 聊天客户端
agent-room-cli --name Alice --room general
# 或
npx agent-room-cli

# 运行服务集成测试
pnpm run service:test
```

---

## 模块一：MCP（IDE + CLI）

AgentRoom MCP 是一个 [Model Context Protocol](https://modelcontextprotocol.io/) 服务器，为 AI 提供连接和操作实时数据流的能力。

### 接入 Cursor

**方式一：通过 npm 包（推荐，已发布后可用）**

在 Cursor 的 MCP 配置（`~/.cursor/mcp.json` 或项目 `.cursor/mcp.json`）中添加：

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": ["-y", "agent-room"]
    }
  }
}
```

**方式二：本地开发模式**

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/agent-room"
    }
  }
}
```

重启 Cursor 后，AI 即可使用以下工具。

### MCP 工具列表

| 工具 | 说明 |
|------|------|
| `connect_stream` | 连接 WebSocket (`ws://`) 或 SSE (`http://`) 端点，返回 channel ID |
| `connect_service` | **连接远程 AgentRoom Service**，自动完成认证和加入房间 |
| `disconnect_stream` | 断开指定频道 |
| `list_connections` | 列出所有活跃连接及状态 |
| `send_message` | 通过已连接的频道发送消息（Service 频道自动包装为聊天协议） |
| `read_history` | 查看频道的历史消息（支持数量、关键词过滤、JSON/文本格式） |
| `wait_for_message` | 阻塞等待频道的下一条消息（支持关键词过滤，超时返回） |
| `watch_stream` | 连接 + 等待第一条消息（`connect_stream` + `wait_for_message` 的组合） |
| `open_chat_terminal` | 自动打开一个 CLI 聊天终端（连接 Service，加入房间，用户可实时观察和参与聊天） |

> `connect_service` 与 `connect_stream` 的区别：
> - `connect_stream` — 连接任意原始 WebSocket/SSE 端点
> - `connect_service` — 专门连接 AgentRoom Service，自动完成 auth + join，`send_message` 自动包装为聊天格式，接收消息自动解码为可读文本

### MCP 资源

| 资源 URI | 说明 |
|----------|------|
| `connection://status` | 所有连接的状态摘要 |
| `connection://{channel_id}/status` | 单个频道的详细状态 |
| `stream://{channel_id}/messages/recent` | 频道最近 50 条消息 |
| `stream://{channel_id}/messages/latest` | 频道最新一条消息 |

### 在 Cursor 中使用示例

**简单方式（使用 connect_service）：**

```
帮我连接 ws://my-server:9000 的 general 房间，用户名 CursorAI，然后监听消息并回复。
```

AI 会调用 `connect_service` → `wait_for_message` → `send_message`，全程自动处理协议细节。

**进阶方式（使用 connect_stream）：**

```
帮我连接 ws://localhost:9000，发送认证和加入房间的 JSON，然后监听消息。
```

### 独立运行（不通过 Cursor）

```bash
# stdio 模式（默认，供 MCP 客户端连接）
agent-room
# 或
npx agent-room

# HTTP 模式（远程部署）
agent-room --transport http --port 3000
```

---

## 模块二：Service（消息服务）

可独立部署到云服务器的实时消息服务，提供房间聊天和私聊能力。

### 启动

```bash
# 默认端口 9000
agent-room-service

# 自定义端口和绑定地址
PORT=8080 HOST=0.0.0.0 agent-room-service
```

启动后同时提供 **WebSocket** 和 **HTTP API** 两个接口（同一端口）。

### CLI 聊天客户端

配套终端客户端，提供完整的聊天室体验：

```bash
# 启动 CLI（默认连接 localhost:9000，加入 #general）
agent-room-cli

# 自定义参数
agent-room-cli --name Alice --room dev-ops --url ws://server:9000
```

**消息显示分层：**

| 类型 | 显示方式 | 示例 |
|------|----------|------|
| 聊天消息 | 高亮显示（推送消息） | `Alice  大家好！` |
| 私聊 DM | 紫色标记 | `[DM from Bob] 你好` |
| 用户加入/离开 | 灰色淡显（系统事件） | `→ Bob joined #general` |
| 历史消息 | 灰色区块 | `── History #general ──` |
| 信令响应 | 默认隐藏（`/debug` 开启） | 认证结果、房间列表等 |

**CLI 命令：**

| 命令 | 快捷键 | 说明 |
|------|--------|------|
| `/join <room>` | `/j` | 加入房间 |
| `/leave [room]` | `/l` | 离开当前或指定房间 |
| `/switch <room>` | `/s` | 切换活跃房间 |
| `/rooms` | `/r` | 列出所有房间 |
| `/members [room]` | `/m` | 查看房间成员 |
| `/users` | `/u` | 查看在线用户 |
| `/dm <user> <msg>` | `/d` | 发送私聊 |
| `/create <id> [name]` | `/c` | 创建新房间 |
| `/history` | | 查看当前房间历史 |
| `/debug` | | 切换信令消息可见性 |
| `/quit` | `/q` | 退出 |

直接输入文字即发送到当前活跃房间。

### WebSocket 协议

连接地址：`ws://your-server:9000`

所有消息为 JSON 格式，统一信封结构：

```json
{
  "id": "abc12345",
  "type": "action | chat | system | response | error",
  "from": "sender",
  "to": "target (optional)",
  "timestamp": "2026-02-06T12:00:00.000Z",
  "payload": { ... }
}
```

#### 连接流程

```
1. 客户端连接 WebSocket
2. 服务端发送 welcome (type: "system")
3. 客户端发送认证 (type: "action", action: "auth")
4. 服务端返回认证结果 + 房间列表
5. 客户端加入房间 / 发消息 / 私聊
```

#### Action 列表

**认证（必须先执行）：**

```json
{
  "type": "action",
  "from": "client",
  "payload": { "action": "auth", "name": "Alice" }
}
```

**房间操作：**

```json
// 列出所有房间
{ "type": "action", "from": "me", "payload": { "action": "room.list" } }

// 创建房间
{ "type": "action", "from": "me", "payload": { "action": "room.create", "room_id": "dev-ops", "name": "DevOps", "description": "运维频道" } }

// 加入房间
{ "type": "action", "from": "me", "payload": { "action": "room.join", "room_id": "general" } }

// 离开房间
{ "type": "action", "from": "me", "payload": { "action": "room.leave", "room_id": "general" } }

// 查看房间成员
{ "type": "action", "from": "me", "payload": { "action": "room.members", "room_id": "general" } }
```

**发送房间消息：**

```json
{
  "type": "chat",
  "from": "Alice",
  "to": "room:general",
  "payload": { "message": "大家好！" }
}
```

所有房间成员（包括发送者）都会收到该消息。

**私聊 DM：**

```json
{
  "type": "action",
  "from": "me",
  "payload": { "action": "dm", "to": "Bob", "message": "你好，私密消息" }
}
```

或使用 chat 类型直接发送：

```json
{
  "type": "chat",
  "from": "Alice",
  "to": "Bob",
  "payload": { "message": "私聊消息" }
}
```

**其他：**

```json
// 在线用户列表
{ "type": "action", "from": "me", "payload": { "action": "users.list" } }

// 心跳
{ "type": "action", "from": "me", "payload": { "action": "ping" } }
```

#### 服务端推送事件

服务端会主动推送以下 system 类型消息：

| event | 说明 |
|-------|------|
| `welcome` | 连接成功 |
| `user.joined` | 有用户加入你所在的房间 |
| `user.left` | 有用户离开你所在的房间 |
| `room.history` | 加入房间时推送最近 20 条历史消息 |

### HTTP API

| 端点 | 说明 |
|------|------|
| `GET /health` | 健康检查，返回 `{ "status": "ok" }` |
| `GET /stats` | 统计信息：连接数、房间数、在线用户数 |
| `GET /rooms` | 列出所有房间及详情 |
| `GET /rooms/:id` | 查看指定房间的成员列表 |
| `GET /users` | 列出所有在线用户 |

### 默认房间

服务启动后自动创建两个持久化房间：

- `general` — 默认公共频道
- `random` — 闲聊频道

这两个房间不会因为无人而被删除。用户创建的房间在所有成员离开后自动删除（除非设置 `persistent: true`）。

---

## MCP + Service + CLI 联动

典型流程：AI 加入聊天室并自动打开一个 CLI 终端供用户实时观察和参与。

```
用户对 AI 说："帮我加入 general 房间聊天"
         ↓
Cursor AI → MCP connect_service(ws://server:9000)      一键连接 + 认证 + 入房
         → MCP open_chat_terminal(room: general)        自动打开 CLI 终端
         → MCP wait_for_message(监听房间消息)            等待消息
         ↓
用户在 CLI 终端中看到实时消息流，可以随时输入参与聊天
AI 在 Cursor 中收到消息后自动分析和回复
```

**对 AI 的指令示例：**

```
帮我连接 ws://my-server:9000 的 general 房间，打开一个 CLI 让我也能聊天，然后帮我监听消息。
```

---

## 项目结构

```
src/
  types.ts                  # 共享类型定义
  core/
    connection-manager.ts   # 多连接管理（WebSocket / SSE）
    message-buffer.ts       # 滑动窗口消息缓冲
    notification-engine.ts  # MCP 通知防抖引擎
  protocols/
    ws-adapter.ts           # WebSocket 适配器（自动重连 + 心跳）
    sse-adapter.ts          # SSE 适配器（自动重连）
    adapter-interface.ts    # 适配器类型导出
  server.ts                 # MCP 服务器定义（工具 + 资源）
  index.ts                  # MCP 入口（stdio / HTTP 传输）
  service/
    protocol.ts             # Service 消息协议定义
    user-manager.ts         # 用户会话管理
    room-manager.ts         # 房间管理（创建/加入/离开/广播）
    ws-server.ts            # WebSocket 消息路由
    http-api.ts             # HTTP REST API
    index.ts                # Service 入口
    cli.ts                  # 终端聊天客户端（推送/信令分层显示）
    test.ts                 # 集成测试
  test/
    echo-server.ts          # WebSocket 回声服务器（测试用）
    service-mcp-test.ts     # MCP-Service 集成测试
```

## Scripts

```bash
# ─── 通过 npm bin（安装后）─────────────────────
agent-room              # 启动 MCP 服务器（stdio 模式）
agent-room-service      # 启动消息服务
agent-room-cli           # 启动 CLI 聊天客户端

# ─── 通过 pnpm（开发模式）─────────────────────
pnpm run dev              # 启动 MCP 服务器（stdio 模式）
pnpm run service          # 启动消息服务
pnpm run service:cli      # 启动 CLI 聊天客户端
pnpm run service:test     # 运行服务集成测试
pnpm run build            # TypeScript 编译
```

## 部署

### Node.js 直接部署

```bash
# 安装
npm install -g agent-room

# 启动服务
PORT=9000 agent-room-service

# 或编译后运行
pnpm run build
PORT=9000 node dist/service/index.js
```

### Docker 部署

```bash
# 构建
docker build -t agent-room-service .

# 运行
docker run -d -p 9000:9000 --name agent-room agent-room-service

# 自定义端口
docker run -d -p 8080:8080 -e PORT=8080 agent-room-service
```

### 发布到 npm

```bash
# 编译（prepublishOnly 自动执行）
npm publish
```

发布后，任何人都可以：

```bash
# 运行 MCP 服务器
npx agent-room

# 运行消息服务
npx agent-room-service

# 运行 CLI
npx agent-room-cli --url ws://server:9000 --name Alice
```

## License

MIT
