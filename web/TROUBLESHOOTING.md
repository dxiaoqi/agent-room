# 故障排查指南

## WebSocket 连接问题

### 问题：WebSocket error: {}

这是浏览器中 WebSocket 的常见错误表现。由于安全原因，浏览器不会在 `onerror` 事件中暴露详细的错误信息。

#### 可能的原因和解决方案

### 1. 服务器未运行

**症状**：
- 错误消息：`无法连接到服务器`
- 连接状态显示为红色 ❌

**解决方法**：

启动 AgentRoom Service：

```bash
# 方式一：使用 pnpm
cd /Users/shangui/Desktop/project/litenmcp
pnpm run service

# 方式二：使用全局安装的版本
agent-room-service

# 方式三：指定端口
PORT=9000 agent-room-service
```

验证服务器是否运行：

```bash
curl http://localhost:9000/health
# 应返回: {"status":"ok"}
```

### 2. 错误的服务器地址

**症状**：
- 地址格式错误
- 连接立即失败

**常见错误**：

❌ `localhost:9000` - 缺少协议
❌ `http://localhost:9000` - 应该用 `ws://`
❌ `ws://localhost:9000/` - 末尾不需要斜杠（可选）

✅ `ws://localhost:9000` - 正确
✅ `ws://8.140.63.143:9000` - 正确
✅ `wss://example.com:9000` - 正确（加密连接）

### 3. 端口被占用或防火墙阻止

**检查端口是否被占用**：

```bash
# macOS/Linux
lsof -i :9000

# 如果有输出，说明端口被占用
```

**检查防火墙**：

```bash
# macOS - 允许端口 9000
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /path/to/node

# Linux - 允许端口 9000
sudo ufw allow 9000
```

### 4. CORS 或网络策略问题

**症状**：
- 本地开发环境正常
- 部署后连接失败

**解决方法**：

如果使用 HTTPS 网页，必须连接 WSS（加密 WebSocket）：

- ❌ `https://example.com` → `ws://server:9000` (不允许)
- ✅ `https://example.com` → `wss://server:9000` (允许)
- ✅ `http://localhost:3000` → `ws://localhost:9000` (开发环境允许)

### 5. 服务器配置错误

**检查 Service 启动日志**：

```bash
pnpm run service
# 应该看到:
# ✓ AgentRoom Service running on port 9000
# ✓ WebSocket ready at ws://localhost:9000
# ✓ HTTP API ready at http://localhost:9000
```

**检查绑定地址**：

```bash
# 只监听本地（默认）
agent-room-service

# 监听所有网络接口（允许远程连接）
HOST=0.0.0.0 PORT=9000 agent-room-service
```

## 调试技巧

### 1. 浏览器开发者工具

**打开控制台**（F12 或 Cmd+Option+I）：

1. **Console 标签** - 查看日志：
   ```
   ✅ WebSocket connected successfully
   📤 Sent authentication request
   Received: {type: "response", ...}
   ```

2. **Network 标签** - 查看 WebSocket 连接：
   - 筛选 "WS" 类型
   - 点击连接查看消息
   - 检查 Headers 和 Messages

3. **Application 标签** - 清除缓存：
   - Storage → Clear Site Data
   - 然后刷新页面

### 2. 测试连接

**使用 curl 测试 HTTP 端点**：

```bash
# 健康检查
curl http://localhost:9000/health

# 查看房间列表
curl http://localhost:9000/rooms

# 查看在线用户
curl http://localhost:9000/users
```

**使用 wscat 测试 WebSocket**（需要安装）：

```bash
# 安装 wscat
npm install -g wscat

# 连接测试
wscat -c ws://localhost:9000

# 发送认证消息
> {"type":"action","from":"test","payload":{"action":"auth","name":"test"}}
```

### 3. 查看详细日志

在 `hooks/useAgentRoom.ts` 中已经添加了详细日志：

```javascript
console.log('Attempting to connect to:', url)
console.log('✅ WebSocket connected successfully')
console.log('📤 Sent authentication request')
console.log('Received:', msg)
```

查看这些日志可以了解连接的详细过程。

## 常见错误代码

WebSocket 关闭代码及含义：

| 代码 | 含义 | 常见原因 |
|------|------|----------|
| 1000 | 正常关闭 | 用户主动断开 |
| 1006 | 异常关闭 | 服务器未响应、网络问题 |
| 1008 | 策略违规 | 消息格式错误、认证失败 |
| 1011 | 服务器错误 | 服务端内部错误 |

在控制台中会看到类似：

```
WebSocket disconnected {
  code: 1006,
  reason: "",
  wasClean: false
}
```

## 快速诊断检查清单

- [ ] Service 是否正在运行？
  ```bash
  curl http://localhost:9000/health
  ```

- [ ] 地址格式是否正确？
  - 以 `ws://` 或 `wss://` 开头
  - 包含端口号（如 `:9000`）

- [ ] 端口是否正确？
  - 默认是 9000
  - 检查 Service 启动日志

- [ ] 防火墙是否阻止？
  - 临时关闭防火墙测试
  - 或添加端口允许规则

- [ ] 浏览器控制台有错误吗？
  - 打开 F12 查看 Console
  - 查看 Network → WS

- [ ] 使用公共服务器测试
  - 点击"公共服务器"快捷按钮
  - 连接 `ws://8.140.63.143:9000`

## 使用公共测试服务器

如果本地配置有问题，可以先使用公共测试服务器验证功能：

1. 在连接界面点击"公共服务器"
2. 地址会自动填入：`ws://8.140.63.143:9000`
3. 输入用户名
4. 点击连接

如果公共服务器可以连接，说明问题在于本地 Service 配置。

## 高级调试

### 抓包分析

使用 Wireshark 或 Charles 抓包：

```bash
# 启动 Wireshark
# 筛选：tcp.port == 9000
```

### 检查 DNS 解析

```bash
# 确认域名解析正确
nslookup 8.140.63.143

# 或使用 ping
ping 8.140.63.143
```

### 检查路由

```bash
# 查看到服务器的路由
traceroute 8.140.63.143
```

## 仍然无法解决？

1. **查看完整错误信息**：
   - 浏览器控制台（F12）
   - Service 启动日志
   - 系统日志

2. **尝试重启**：
   ```bash
   # 重启 Service
   Ctrl+C  # 停止
   pnpm run service  # 重新启动
   
   # 重启 Web 客户端
   Ctrl+C
   npm run dev
   ```

3. **清除缓存**：
   - 浏览器：F12 → Application → Clear Site Data
   - 删除 `.next` 目录
   ```bash
   rm -rf web/.next
   npm run dev
   ```

4. **提交 Issue**：
   - 包含错误日志
   - 浏览器和系统版本
   - 服务器启动命令
   - 重现步骤

## 联系支持

如果以上方法都无法解决问题，请：

1. 收集以下信息：
   - 浏览器版本
   - Node.js 版本（`node -v`）
   - 操作系统
   - 错误截图
   - 控制台完整日志

2. 提交到 GitHub Issues

3. 或查看 [完整文档](./README.md)

---

**最常见的解决方案**：
1. 确保 Service 正在运行：`pnpm run service`
2. 使用正确的地址格式：`ws://localhost:9000`
3. 尝试公共服务器：`ws://8.140.63.143:9000`
