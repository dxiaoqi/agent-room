# AgentRoom

MCP 流桥接工具 + 可部署的实时消息服务。

项目分为两个独立模块：

| 模块 | 用途 | 运行环境 |
|------|------|----------|
| **MCP** | 让 IDE（Cursor/Claude Desktop）和 CLI 工具连接任意 WebSocket/SSE 数据流，或直接接入 Service | 本地 |
| **Service** | 可部署到云服务器的实时消息服务，支持房间和私聊 | 云端 / 本地 |

---

## 目录

- [安装](#安装)
- [快速体验](#快速体验)
- [MCP 接入配置](#mcp-接入配置)
  - [在 Cursor 中接入](#在-cursor-中接入)
  - [在 Claude Desktop 中接入](#在-claude-desktop-中接入)
  - [连接远程服务](#连接远程服务)
- [使用指南](#使用指南)
  - [用户层面：如何使用](#用户层面如何使用)
  - [AI 层面：可用能力](#ai-层面可用能力)
- [模块详解](#模块详解)
  - [MCP 工具和资源](#mcp-工具和资源)
  - [Service 消息服务](#service-消息服务)
- [部署与开发](#部署与开发)

---

## 安装

```bash
# 全局安装（推荐）
npm install -g agent-room

# 或作为项目依赖
npm install agent-room
```

## 快速体验

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

## MCP 接入配置

AgentRoom 基于 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)，为 AI 助手提供实时流连接能力。支持 **Cursor**、**Claude Desktop** 等所有兼容 MCP 的 IDE。

### 在 Cursor 中接入

#### 方式一：连接本地或远程 Service（推荐）

**适用场景：** 你已经有一个运行中的 AgentRoom Service（本地或远程服务器）

1. 找到 Cursor 的 MCP 配置文件：
   - **全局配置**：`~/.cursor/mcp.json`（对所有项目生效）
   - **项目配置**：`项目根目录/.cursor/mcp.json`（仅当前项目生效）

2. 添加配置：

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": [
        "-y",
        "agent-room",
        "--service-url",
        "ws://localhost:9000"
      ]
    }
  }
}
```

> 将 `ws://localhost:9000` 替换为你的 Service 地址。例如远程服务器：`ws://your-server.com:9000`

3. 重启 Cursor（`Cmd/Ctrl + Shift + P` → `Reload Window`）

4. 验证是否生效：打开 Cursor 聊天，输入 `@agent-room`，应该能看到 MCP 工具列表

#### 方式二：纯 MCP 模式（不连接 Service）

**适用场景：** 仅使用 MCP 连接任意 WebSocket/SSE 端点，不使用 AgentRoom Service

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

#### 方式三：本地开发模式

**适用场景：** 开发者调试 AgentRoom 源码

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

### 在 Claude Desktop 中接入

Claude Desktop 同样支持 MCP，配置方式类似：

1. 找到配置文件：
   - **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Linux**: `~/.config/Claude/claude_desktop_config.json`

2. 添加配置（连接远程 Service 示例）：

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": [
        "-y",
        "agent-room",
        "--service-url",
        "ws://your-server.com:9000"
      ]
    }
  }
}
```

3. 重启 Claude Desktop

### 连接远程服务

如果你部署了 AgentRoom Service 到云服务器（例如 `ws://your-server.com:9000`），可以在 MCP 配置中指定：

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": [
        "-y",
        "agent-room",
        "--service-url",
        "ws://your-server.com:9000"
      ]
    }
  }
}
```

这样 AI 可以直接使用 `connect_service` 工具连接到你的远程聊天室，无需每次手动输入地址。

---

## 使用指南

### 用户层面：如何使用

配置好 MCP 后，你可以通过自然语言与 AI 交互，让 AI 帮你操作实时流：

#### 场景 1：加入聊天室并参与对话

**你说：**
```
帮我连接 general 房间，打开一个终端让我也能聊天，然后帮我监听消息
```

**AI 会：**
1. 调用 `connect_service` 连接到配置的 Service
2. 调用 `open_chat_terminal` 打开一个 CLI 聊天终端
3. 调用 `wait_for_message` 监听房间消息
4. 当有新消息时自动通知你，或根据你的要求自动回复

**结果：**
- 你的终端会弹出一个聊天界面，可以实时看到房间消息并输入参与
- AI 在后台同步监听，可以智能响应其他用户的消息

#### 场景 2：监听自定义 WebSocket 数据流

**你说：**
```
帮我连接 ws://localhost:8080/events，监听所有消息并记录下来
```

**AI 会：**
1. 调用 `connect_stream` 连接到你的 WebSocket 端点
2. 调用 `wait_for_message` 持续监听
3. 将收到的消息展示给你，或进行数据分析

#### 场景 3：定时发送消息

**你说：**
```
每隔 30 秒向 general 房间发送一条 "系统健康" 的消息
```

**AI 会：**
1. 调用 `connect_service` 连接房间
2. 循环调用 `send_message` 发送消息
3. 使用 `wait_for_message(timeout: 30000)` 实现定时

#### 场景 4：查看聊天历史

**你说：**
```
帮我看看 general 房间最近 50 条消息
```

**AI 会：**
1. 调用 `connect_service` 连接房间
2. 调用 `read_history` 读取历史记录
3. 格式化展示给你

### AI 层面：可用能力

配置好 MCP 后，AI 助手获得以下能力：

#### 1. 实时流连接能力

- **连接任意 WebSocket/SSE 端点**：监听实时数据、订阅事件流
- **多连接管理**：同时管理多个数据流，每个流独立的 channel_id
- **自动重连**：网络断开时自动重新连接
- **心跳保活**：自动发送心跳包保持连接活跃

#### 2. 消息收发能力

- **发送消息**：向任意已连接的频道发送文本或 JSON 数据
- **等待消息**：阻塞等待特定消息（支持关键词过滤、超时控制）
- **历史回溯**：查询频道历史消息，支持数量限制和格式化
- **实时通知**：收到新消息时通过 MCP 通知机制推送

#### 3. 聊天室协作能力

- **快速接入**：一键连接 AgentRoom Service，自动完成认证和房间加入
- **多房间管理**：同时加入多个聊天室，在不同房间发送和接收消息
- **私聊功能**：发送点对点私密消息
- **用户交互**：为用户打开 CLI 终端，实现 AI + 用户联动

#### 4. 状态查询能力

- **连接状态**：查看所有活跃连接的详细信息
- **消息统计**：获取频道的消息数量、连接时长等指标
- **房间信息**：查询房间成员、在线用户列表

#### 5. 智能决策能力

AI 可以根据收到的消息内容：
- **自动判断**是否需要回复
- **提取关键信息**进行数据分析
- **触发其他操作**（如调用其他 API、执行命令）
- **协调多个连接**实现复杂的数据流转

#### 典型应用场景

| 场景 | AI 能力 | 示例 |
|------|--------|------|
| **聊天助手** | 监听聊天室消息，智能回复 | AI 自动回答技术问题 |
| **数据监控** | 连接监控系统的 WebSocket，实时分析数据 | 异常时自动告警 |
| **多人协作** | 在多个房间之间传递信息 | 跨团队消息同步 |
| **定时任务** | 定时发送提醒或报告 | 每日健康检查通知 |
| **事件响应** | 监听特定事件并触发操作 | CI/CD 构建完成后通知 |

---

## 模块详解

### MCP 工具和资源

AgentRoom MCP 提供了一套完整的工具集，让 AI 可以操作实时数据流。

#### 核心工具

| 工具 | 说明 | 典型用法 |
|------|------|----------|
| `connect_stream` | 连接任意 WebSocket (`ws://`) 或 SSE (`http://`) 端点 | 监听自定义数据流、第三方 WebSocket API |
| `connect_service` | **连接 AgentRoom Service**，自动完成认证和加入房间 | 加入聊天室、参与多人协作 |
| `disconnect_stream` | 断开指定频道 | 清理连接、切换房间 |
| `list_connections` | 列出所有活跃连接及状态 | 查看当前连接、调试 |
| `send_message` | 向频道发送消息 | 发送聊天消息、推送数据 |
| `read_history` | 查看频道历史消息 | 回溯聊天记录、数据分析 |
| `wait_for_message` | 阻塞等待下一条消息（支持关键词过滤） | 监听特定事件、等待响应 |
| `watch_stream` | 连接 + 等待第一条消息 | 快速测试连接、验证数据流 |
| `open_chat_terminal` | **打开 CLI 聊天终端** | 让用户实时参与聊天 |

#### 工具详解

**`connect_service` vs `connect_stream`**

| 特性 | `connect_service` | `connect_stream` |
|------|-------------------|------------------|
| 目标 | AgentRoom Service | 任意 WebSocket/SSE |
| 认证 | 自动完成 | 需手动发送 |
| 消息格式 | 自动包装为聊天协议 | 原始 JSON/文本 |
| 适用场景 | 聊天室、多人协作 | 自定义数据流、第三方 API |

**`open_chat_terminal` — 用户参与的关键**

这个工具会在用户的终端中自动打开一个 CLI 聊天界面，让用户可以：
- 实时看到房间消息
- 输入文字参与聊天
- 使用 `/join`、`/leave`、`/dm` 等命令
- 与 AI 共同参与同一个聊天室

**示例：AI + 用户联动**

```
用户说："帮我加入 dev-ops 房间"

AI 操作：
1. connect_service(room: "dev-ops", name: "AI-Assistant")
2. open_chat_terminal(room: "dev-ops", name: "User-Alice")  ← 打开用户终端
3. wait_for_message() 开始监听

结果：
- AI 在后台监听房间消息
- 用户在终端看到实时聊天界面
- 双方同时在同一个房间中
```

#### MCP 资源

AI 可以通过资源 URI 快速获取状态信息：

| 资源 URI | 说明 | 示例 |
|----------|------|------|
| `connection://status` | 所有连接的状态摘要 | 查看当前活跃的所有频道 |
| `connection://{channel_id}/status` | 单个频道的详细状态 | 查看连接时长、消息数 |
| `stream://{channel_id}/messages/recent` | 频道最近 50 条消息 | 快速回溯历史 |
| `stream://{channel_id}/messages/latest` | 频道最新一条消息 | 检查最新状态 |

#### 工具使用示例

**示例 1：简单聊天（使用 connect_service）**

用户说：
```
帮我连接 general 房间，用户名 AI-Bot
```

AI 自动调用：
```javascript
// 1. 连接 Service（使用配置文件中的 --service-url）
connect_service({
  room: "general",
  name: "AI-Bot"
})

// 2. 返回 channel_id，例如 "ch-abc123"

// 3. 监听消息
wait_for_message({
  channel_id: "ch-abc123",
  timeout: 30000
})

// 4. 发送消息
send_message({
  channel_id: "ch-abc123",
  message: "大家好，我是 AI-Bot"
})
```

**示例 2：监听自定义 WebSocket（使用 connect_stream）**

用户说：
```
帮我连接 ws://api.example.com/events，监听所有事件
```

AI 自动调用：
```javascript
// 1. 连接原始 WebSocket
connect_stream({
  url: "ws://api.example.com/events",
  protocol_type: "websocket"
})

// 2. 等待消息
wait_for_message({
  channel_id: "ch-xyz789",
  format: "json"  // 以 JSON 格式解析
})
```

**示例 3：打开用户终端**

用户说：
```
帮我加入 general 房间，我也想参与聊天
```

AI 自动调用：
```javascript
// 1. AI 自己连接
connect_service({ room: "general", name: "AI-Assistant" })

// 2. 为用户打开终端
open_chat_terminal({
  room: "general",
  name: "User-Alice",
  url: "ws://localhost:9000"  // 可选，默认使用配置的 service-url
})

// 3. 监听消息
wait_for_message({ channel_id: "ch-abc123" })
```

#### 独立运行 MCP 服务器（不通过 IDE）

```bash
# stdio 模式（默认，供 MCP 客户端连接）
agent-room
# 或
npx agent-room

# HTTP 模式（远程部署 MCP 服务器）
agent-room --transport http --port 3000

# 连接到指定 Service
agent-room --service-url ws://your-server.com:9000
```

---

### Service 消息服务

AgentRoom Service 是一个可独立部署的实时消息服务，提供房间聊天和私聊能力。

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

#### MCP + Service + CLI 联动

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
帮我连接 general 房间，打开一个 CLI 让我也能聊天，然后帮我监听消息。
```

---

---

## 部署与开发

### 项目结构

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

### Scripts

```bash
# ─── 通过 npm bin（安装后）─────────────────────
agent-room              # 启动 MCP 服务器（stdio 模式）
agent-room-service      # 启动消息服务
agent-room-cli          # 启动 CLI 聊天客户端

# ─── 通过 pnpm（开发模式）─────────────────────
pnpm run dev            # 启动 MCP 服务器（stdio 模式）
pnpm run service        # 启动消息服务
pnpm run service:cli    # 启动 CLI 聊天客户端
pnpm run service:test   # 运行服务集成测试
pnpm run build          # TypeScript 编译
```

### 部署 Service 到服务器

#### 方式一：Node.js 直接部署

```bash
# 安装
npm install -g agent-room

# 启动服务
PORT=9000 HOST=0.0.0.0 agent-room-service

# 或编译后运行
pnpm run build
PORT=9000 HOST=0.0.0.0 node dist/service/index.js
```

启动后，Service 在 `http://your-server:9000` 提供 WebSocket 和 HTTP API。

#### 方式二：Docker 部署

```bash
# 构建镜像
docker build -t agent-room-service .

# 运行容器
docker run -d -p 9000:9000 --name agent-room agent-room-service

# 自定义端口
docker run -d -p 8080:8080 -e PORT=8080 agent-room-service
```

#### 方式三：使用 PM2（推荐生产环境）

```bash
# 安装 PM2
npm install -g pm2

# 启动 Service
PORT=9000 pm2 start agent-room-service --name "agent-room-service"

# 查看日志
pm2 logs agent-room-service

# 设置开机自启
pm2 startup
pm2 save
```

#### 部署后配置 MCP

在你的 Cursor/Claude Desktop 的 MCP 配置中，将 `--service-url` 指向你的服务器：

```json
{
  "mcpServers": {
    "agent-room": {
      "command": "npx",
      "args": [
        "-y",
        "agent-room",
        "--service-url",
        "ws://your-server.com:9000"
      ]
    }
  }
}
```

### 开发调试

```bash
# 克隆项目
git clone https://github.com/your-repo/agent-room.git
cd agent-room

# 安装依赖
pnpm install

# 启动 Service
pnpm run service

# 新开终端，启动 CLI 测试
pnpm run service:cli --name Alice --room general

# 新开终端，运行集成测试
pnpm run service:test
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

---

## 常见问题

### 1. MCP 工具没有生效怎么办？

**检查步骤：**

1. 确认配置文件路径正确：
   - Cursor: `~/.cursor/mcp.json` 或 `.cursor/mcp.json`
   - Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`

2. 确认 JSON 格式正确（可以用 JSON 校验工具检查）

3. 重启 IDE（Cursor: `Cmd/Ctrl + Shift + P` → `Reload Window`）

4. 查看 MCP 日志：
   - Cursor: 打开开发者工具查看控制台
   - 检查 `npx agent-room` 是否能正常运行

### 2. 连接 Service 失败怎么办？

**检查步骤：**

1. 确认 Service 是否正在运行：
   ```bash
   curl http://localhost:9000/health
   # 应该返回 {"status":"ok"}
   ```

2. 检查防火墙和端口是否开放（云服务器需要开放安全组）

3. 检查 MCP 配置中的 `--service-url` 是否正确

4. 尝试用 CLI 直接连接测试：
   ```bash
   agent-room-cli --url ws://your-server:9000 --name Test
   ```

### 3. 如何查看 AI 调用了哪些工具？

在 Cursor 中，AI 调用工具时会在聊天界面显示。你也可以：

1. 查看 MCP 资源获取连接状态：
   - 让 AI 读取 `connection://status` 资源
   - 或调用 `list_connections` 工具

2. 查看频道历史消息：
   - 调用 `read_history` 工具查看所有发送和接收的消息

### 4. 可以同时连接多个房间吗？

可以。每次调用 `connect_service` 都会创建一个新的连接（新的 channel_id），AI 可以通过不同的 channel_id 同时管理多个房间。

示例：
```javascript
// 连接第一个房间
connect_service({ room: "general", name: "AI-Bot" })  // 返回 ch-1

// 连接第二个房间
connect_service({ room: "dev-ops", name: "AI-Bot" })  // 返回 ch-2

// 分别发送消息
send_message({ channel_id: "ch-1", message: "Hello general" })
send_message({ channel_id: "ch-2", message: "Hello dev-ops" })
```

### 5. 如何让 AI 自动响应消息？

给 AI 明确的指令，例如：

```
帮我连接 general 房间，然后持续监听消息。当有人说"你好"时，回复"你好，我是 AI 助手"。
```

AI 会循环调用 `wait_for_message` 监听，并根据消息内容调用 `send_message` 回复。

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

### 开发流程

1. Fork 本项目
2. 创建特性分支：`git checkout -b feature/my-feature`
3. 提交代码：`git commit -m "Add my feature"`
4. 推送分支：`git push origin feature/my-feature`
5. 提交 Pull Request

### 测试

```bash
# 运行服务集成测试
pnpm run service:test

# 手动测试 MCP 工具
pnpm run dev  # 启动 MCP 服务器
# 然后在另一个终端用 MCP Inspector 测试
```

---

## License

MIT

---

## 相关资源

- [Model Context Protocol 官方文档](https://modelcontextprotocol.io/)
- [Cursor IDE](https://cursor.sh/)
- [Claude Desktop](https://claude.ai/download)
- [WebSocket 协议规范](https://datatracker.ietf.org/doc/html/rfc6455)

---

**AgentRoom** - 让 AI 与实时世界无缝连接
