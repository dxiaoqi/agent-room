# 认证问题调试指南

## 🔍 如何调试认证失败

如果看到 "❌ 连接错误 - 认证失败，请检查用户名"，请按以下步骤排查：

### 步骤 1：检查用户名是否有效

**打开浏览器控制台（F12）**，查看日志：

```javascript
// 查看保存的 session
const session = JSON.parse(localStorage.getItem('agentroom_session'))
console.log('Session:', session)

// 检查 username 字段
console.log('Username:', session?.username)
console.log('Username length:', session?.username?.length)
console.log('Username trimmed:', session?.username?.trim())
```

**预期结果**：
- ✅ username 应该是一个非空字符串，如 "Alice"
- ❌ 如果是空字符串 "" 或 undefined，这就是问题所在

### 步骤 2：清除无效的 session

如果 username 为空：

```javascript
// 清除所有 session 数据
localStorage.clear()

// 刷新页面
location.reload()
```

### 步骤 3：重新连接

1. 输入服务器地址：`ws://localhost:9000` 或 `ws://8.140.63.143:9000`
2. **确保输入用户名**：例如 `Alice`
3. 点击"连接"

### 步骤 4：查看认证日志

控制台应该显示：

```
🔗 ConnectForm.handleConnect: {serverUrl: "ws://...", username: "Alice"}
🔗 Connecting... {url: "ws://...", user: "Alice"}
💾 Session saved: {serverUrl: "ws://...", username: "Alice", ...}
🏠 ChatRoom mounted with: {serverUrl: "ws://...", username: "Alice"}
Attempting to connect to: ws://... with username: Alice
✅ WebSocket connected successfully
📤 Sending authentication request: {username: "Alice", payload: {...}}
✅ Sent authentication request
📨 Received: {type: "response", action: "auth"}
✅ Authentication successful
```

## 🐛 常见问题

### 问题 1：username 为空字符串

**症状**：
```
认证失败，请检查用户名
控制台：username: ""
```

**原因**：
- ConnectForm 中用户名输入框为空
- 或者从 session 恢复的 username 为空

**解决方案**：
```javascript
// 清除 localStorage
localStorage.clear()

// 重新输入用户名并连接
```

### 问题 2：username 是空格

**症状**：
```
username: "   "
认证失败
```

**原因**：
- 用户只输入了空格
- 现在会自动 trim，但旧 session 可能有问题

**解决方案**：
```javascript
// 清除并重新连接
localStorage.clear()
location.reload()
```

### 问题 3：Session 数据损坏

**症状**：
```
Failed to load session: SyntaxError
```

**解决方案**：
```javascript
localStorage.clear()
location.reload()
```

### 问题 4：服务器认证逻辑问题

**症状**：
```
username 有值但仍然认证失败
```

**检查**：
```javascript
// 查看发送的消息
console.log('发送的认证消息:', {
  type: 'action',
  from: username,
  payload: { action: 'auth', name: username }
})

// 查看服务器响应
📨 Received: {type: "response", action: "auth", success: false, error: "..."}
```

## 🔧 快速修复步骤

### 方法 1：清除 localStorage（推荐）

```javascript
// 浏览器控制台执行
localStorage.clear()
location.reload()
```

### 方法 2：只清除 agentroom 数据

```javascript
// 浏览器控制台执行
Object.keys(localStorage)
  .filter(k => k.startsWith('agentroom'))
  .forEach(k => localStorage.removeItem(k))
  
console.log('✅ Cleared all agentroom data')
location.reload()
```

### 方法 3：手动修复 session

```javascript
// 浏览器控制台执行
localStorage.setItem('agentroom_session', JSON.stringify({
  serverUrl: "ws://localhost:9000",
  username: "Alice",  // ← 确保这里有值
  connectedAt: new Date().toISOString(),
  lastActivity: new Date().toISOString()
}))

localStorage.setItem('agentroom_reconnect', JSON.stringify({
  shouldReconnect: true,
  timestamp: new Date().toISOString()
}))

location.reload()
```

## 🎯 验证修复

重新连接后，控制台应该显示：

```
✅ 关键日志检查点：

1. ConnectForm 调用：
   🔗 ConnectForm.handleConnect: {username: "Alice"}

2. Page 处理连接：
   🔗 Connecting... {user: "Alice"}

3. Session 保存：
   💾 Session saved: {username: "Alice"}

4. ChatRoom 挂载：
   🏠 ChatRoom mounted with: {username: "Alice"}

5. WebSocket 连接：
   Attempting to connect with username: Alice

6. 发送认证：
   📤 Sending authentication request: {username: "Alice"}

7. 认证成功：
   ✅ Authentication successful
```

## 💡 预防措施

### 1. 始终 trim 用户名

```typescript
// ✅ 在所有地方使用 trim
const trimmedUsername = username.trim()
```

### 2. 保存前验证

```typescript
// ✅ 保存 session 前检查
if (!username || username.trim().length === 0) {
  console.error('Cannot save: username is empty')
  return
}
```

### 3. 加载后验证

```typescript
// ✅ 从 session 加载后检查
const session = getSession()
if (!session?.username || session.username.trim().length === 0) {
  clearSession()
  return null
}
```

## 🎊 临时解决方案

如果现在就需要使用，执行以下步骤：

```bash
1. 打开浏览器控制台（F12）
2. 执行：localStorage.clear()
3. 执行：location.reload()
4. 重新输入用户名（例如：Alice）
5. 点击连接
6. ✅ 应该可以正常工作了
```

---

**如果问题仍然存在，请查看控制台的完整日志并告诉我！** 🔍
