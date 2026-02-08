# Session 持久化与心跳机制

## 🎯 新增功能

### 1. Session 持久化

刷新页面不再丢失连接状态！

#### 自动保存
- ✅ 连接成功时自动保存服务器地址和用户名
- ✅ 加入房间时自动保存最后的房间
- ✅ Session 有效期 24 小时

#### 自动恢复
- ✅ 刷新页面（F5）自动重连
- ✅ 自动加入最后的房间
- ✅ 恢复聊天状态

#### 智能清除
- ✅ 用户主动断开时清除 session
- ✅ Session 过期（24小时）自动清除
- ✅ 离开房间时清除房间记录

### 2. 心跳机制

保持连接活跃，避免异常关闭！

#### 定时心跳
- ⏰ 每 30 秒发送一次 ping 消息
- 💓 保持 WebSocket 连接活跃
- 📊 实时更新活动时间

#### 连接监控
- 🔍 检测连接状态
- ⚠️ 连接异常时自动停止心跳
- 📝 详细的日志记录

### 3. 自动重连

连接断开后智能重连！

#### 重连策略
- 🔄 异常断开（1006）自动重连
- 📈 指数退避算法（1s, 2s, 4s, 8s, 16s, 30s）
- 🎯 最多尝试 5 次
- ⏱️ 显示重连倒计时

#### 重连场景
- ⚡ 网络波动
- 🔌 服务器重启
- 🌐 连接中断

## 📋 使用流程

### 首次连接

```
1. 输入服务器地址和用户名
2. 点击"连接"
   └─> 保存到 localStorage
3. 连接成功
   └─> 启动心跳（30s）
4. 加入房间
   └─> 保存最后的房间
```

### 刷新页面

```
1. 按 F5 刷新页面
   └─> 触发 beforeunload 事件
   └─> 设置重连标记
2. 页面重新加载
   └─> 检查重连标记和 session
   └─> 发现需要重连
3. 自动连接
   └─> 使用保存的服务器地址和用户名
   └─> 启动心跳
4. 认证成功
   └─> 获取房间列表
   └─> 自动加入最后的房间
5. 恢复完成！
```

### 连接断开

```
1. 检测到连接关闭
   └─> 停止心跳
2. 判断关闭代码
   └─> 1006 (异常关闭) → 自动重连
   └─> 1001 (服务器关闭) → 自动重连
   └─> 1000 (正常关闭) → 不重连
3. 自动重连
   └─> 第 1 次：1 秒后
   └─> 第 2 次：2 秒后
   └─> 第 3 次：4 秒后
   └─> 第 4 次：8 秒后
   └─> 第 5 次：16 秒后
4. 重连成功
   └─> 恢复正常
```

### 用户断开

```
1. 点击"断开连接"
   └─> 清除 session
   └─> 清除房间记录
   └─> 停止心跳
2. 关闭 WebSocket
3. 返回连接界面
```

## 💾 存储结构

### LocalStorage Keys

| Key | 内容 | 说明 |
|-----|------|------|
| `agentroom_session` | 连接信息 | 服务器地址、用户名、时间戳 |
| `agentroom_last_room` | 最后的房间 | 房间 ID |
| `agentroom_reconnect` | 重连标记 | 是否需要自动重连 |

### Session 数据结构

```typescript
{
  serverUrl: "ws://localhost:9000",
  username: "Alice",
  connectedAt: "2026-02-08T10:30:00.000Z",
  lastActivity: "2026-02-08T10:35:00.000Z"
}
```

### 重连标记

```typescript
{
  shouldReconnect: true,
  timestamp: "2026-02-08T10:35:00.000Z"
}
```

## 🔍 日志说明

### 连接日志

```
💾 Session saved: {serverUrl, username, ...}
💗 Starting heartbeat (30s interval)
✅ WebSocket connected successfully
📤 Sent authentication request
```

### 心跳日志

```
💓 Heartbeat sent                    // 正常心跳
⚠️ WebSocket not open, stopping heartbeat  // 连接异常
💔 Heartbeat stopped                 // 停止心跳
```

### 重连日志

```
🔌 WebSocket disconnected
说明: 异常关闭（无法连接或连接中断）
🔄 Attempting reconnect (1/5) in 1000ms...
🔄 Reconnecting...
✅ WebSocket connected successfully  // 重连成功
```

### Session 日志

```
🔍 Checking for saved session...
📂 Session loaded: {serverUrl, username, ...}
🔄 Auto-reconnecting from saved session...
🔄 Auto-joining last room: general
🗑️ Session cleared
```

## 🎮 控制台命令

打开浏览器控制台（F12），可以手动操作 session：

### 查看 Session

```javascript
// 查看所有存储
Object.keys(localStorage).filter(k => k.startsWith('agentroom'))

// 查看 session
JSON.parse(localStorage.getItem('agentroom_session'))

// 查看最后的房间
localStorage.getItem('agentroom_last_room')
```

### 清除 Session

```javascript
// 清除所有 agentroom 数据
Object.keys(localStorage)
  .filter(k => k.startsWith('agentroom'))
  .forEach(k => localStorage.removeItem(k))

// 刷新页面
location.reload()
```

### 模拟重连

```javascript
// 设置重连标记
localStorage.setItem('agentroom_reconnect', JSON.stringify({
  shouldReconnect: true,
  timestamp: new Date().toISOString()
}))

// 刷新页面
location.reload()
```

## 🛡️ 安全考虑

### 不存储敏感信息
- ❌ 不存储密码
- ❌ 不存储 Token（如果有）
- ✅ 只存储服务器地址和用户名

### 自动过期
- ⏰ 24 小时后 session 自动失效
- 🔄 重连标记 5 秒后自动失效

### 用户控制
- 👤 用户主动断开立即清除
- 🗑️ 可以手动清除浏览器数据

## 🎯 适用场景

### ✅ 推荐场景

1. **刷新页面**
   - 不小心按了 F5
   - 修改了浏览器设置
   - 开发者调试

2. **短暂断网**
   - WiFi 切换
   - 网络波动
   - VPN 重连

3. **服务器重启**
   - 维护更新
   - 临时重启
   - 配置更改

### ⚠️ 注意场景

1. **长时间断开**
   - 超过 24 小时
   - Session 会过期
   - 需要重新连接

2. **更换设备**
   - Session 只在当前浏览器
   - 新设备需要重新连接

3. **清除浏览器数据**
   - 清除后 session 丢失
   - 需要重新连接

## 📊 性能影响

### 心跳流量
```
30 秒一次 ping 消息
每次约 50-100 字节
一小时约 6-12 KB
一天约 144-288 KB
```

### 存储占用
```
Session 数据：< 1 KB
重连标记：< 100 字节
总计：< 2 KB
```

### 性能优化
- ✅ 使用 localStorage（同步操作，快速）
- ✅ 最小化存储数据
- ✅ 智能清除过期数据

## 🐛 故障排查

### Session 不恢复

**检查步骤**：
1. 打开控制台查看日志
2. 检查 localStorage 中是否有数据
3. 确认 session 是否过期（24h）
4. 检查重连标记是否存在

**解决方案**：
```javascript
// 手动设置重连标记
localStorage.setItem('agentroom_reconnect', JSON.stringify({
  shouldReconnect: true,
  timestamp: new Date().toISOString()
}))

// 刷新页面
location.reload()
```

### 心跳不工作

**检查步骤**：
1. 查看控制台是否有 `💓 Heartbeat sent`
2. 检查 WebSocket 连接状态
3. 确认服务器支持 ping 消息

**解决方案**：
- 重新连接
- 检查服务器日志
- 确认网络连接

### 重连失败

**检查步骤**：
1. 查看重连次数（最多 5 次）
2. 检查服务器是否运行
3. 确认网络是否正常

**解决方案**：
- 等待服务器恢复
- 手动点击"连接"
- 检查服务器地址

## 🎉 最佳实践

### 开发环境

```bash
# 终端 1 - 启动 Service
pnpm run service

# 终端 2 - 启动 Web
cd web && npm run dev

# 测试流程
1. 连接到 ws://localhost:9000
2. 加入房间
3. 刷新页面（F5）
4. 验证自动重连和恢复房间
```

### 生产环境

- ✅ 使用 WSS（加密连接）
- ✅ 配置合理的心跳间隔
- ✅ 监控重连频率
- ✅ 日志记录和分析

---

**现在刷新页面试试，你的连接状态会自动恢复！** 🎉
