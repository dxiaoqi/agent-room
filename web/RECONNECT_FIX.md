# 重连无限循环问题修复

## 🐛 问题描述

用户报告：一直会不停地触发断开重连，导致页面无法正常使用。

## 🔍 问题分析

### 根本原因

原来的重连逻辑存在严重的死循环问题：

```
1. 连接断开 → 触发 attemptReconnect()
2. attemptReconnect() 使用 window.location.reload() 刷新页面
3. 页面刷新触发 beforeunload 事件
4. beforeunload 检测到 connected=true，设置重连标记
5. 页面重新加载，检测到重连标记，自动连接
6. 如果连接失败，回到步骤 1
7. 无限循环 ♾️
```

### 具体代码问题

**之前的代码 (hooks/useAgentRoom.ts)**:
```typescript
const attemptReconnect = useCallback(() => {
  // ...
  reconnectTimeout.current = setTimeout(() => {
    console.log('🔄 Reconnecting...')
    // ❌ 问题：使用 reload 会触发 beforeunload
    window.location.reload()
  }, delay)
}, [])
```

**之前的代码 (app/page.tsx)**:
```typescript
useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (connected) {
      // ❌ 问题：每次 reload 都会设置重连标记
      setReconnectFlag(true)
    }
  }
  // ...
}, [connected])
```

## ✅ 解决方案

### 1. 在 Hook 内部直接重连

不再使用 `window.location.reload()`，而是直接在 hook 内部创建新的 WebSocket 连接：

```typescript
const attemptReconnect = useCallback(() => {
  // 防止重复触发
  if (isReconnecting.current) return
  
  reconnectTimeout.current = setTimeout(() => {
    // ✅ 直接创建新的 WebSocket，不刷新页面
    const newWs = new WebSocket(urlRef.current)
    
    newWs.onopen = () => {
      // 连接成功，重置状态
      setConnected(true)
      reconnectAttempts.current = 0
      // 发送认证、启动心跳...
    }
    
    // 复用相同的消息处理逻辑
    newWs.onmessage = (event) => { /* ... */ }
    newWs.onerror = (event) => { /* ... */ }
    newWs.onclose = (event) => {
      // 失败继续重连，但不刷新页面
      if (!manualDisconnect.current && !event.wasClean) {
        attemptReconnect()
      }
    }
  }, delay)
}, [])
```

### 2. 使用 Ref 存储最新的 url 和 username

避免回调函数的依赖问题：

```typescript
const urlRef = useRef(url)
const usernameRef = useRef(username)

useEffect(() => {
  urlRef.current = url
  usernameRef.current = username
}, [url, username])
```

### 3. 防止重复重连

```typescript
const isReconnecting = useRef(false)

const attemptReconnect = useCallback(() => {
  // 防止重复触发
  if (isReconnecting.current) {
    console.log('⚠️ Already reconnecting, skipping...')
    return
  }
  isReconnecting.current = true
  // ...
}, [])
```

### 4. 区分主动断开和异常断开

```typescript
const manualDisconnect = useRef(false)

websocket.onclose = (event) => {
  // 用户主动断开或组件卸载，不重连
  if (manualDisconnect.current || event.reason === 'Component unmounting') {
    setConnected(false)
    return
  }
  
  // 异常关闭才自动重连
  if (!event.wasClean && (event.code === 1006 || event.code === 1001)) {
    attemptReconnect()
  }
}

const disconnect = useCallback(() => {
  manualDisconnect.current = true
  ws.close(1000, 'User disconnect')
}, [ws])
```

### 5. 保持 UI 稳定

重连期间不改变父组件的 `connected` 状态，避免 ChatRoom 组件卸载：

```typescript
// ❌ 之前：连接断开立即设置 connected=false
setConnected(false)  // 导致 ChatRoom 卸载，切换到 ConnectForm

// ✅ 现在：只在用户主动断开或重连失败时才设置 false
if (manualDisconnect.current) {
  setConnected(false)
} else {
  // 保持 connected=true，只重置认证状态
  setAuthenticated(false)
}
```

## 🎯 修复效果

### 之前 ❌

```
连接失败
  ↓
尝试重连
  ↓
刷新页面 (reload)
  ↓
触发 beforeunload
  ↓
设置重连标记
  ↓
页面加载
  ↓
自动连接
  ↓
连接失败
  ↓
(无限循环)
```

### 现在 ✅

```
连接失败
  ↓
尝试重连 (第 1 次，1秒后)
  ↓
直接创建新 WebSocket (不刷新页面)
  ↓
连接失败
  ↓
尝试重连 (第 2 次，2秒后)
  ↓
直接创建新 WebSocket
  ↓
连接失败
  ↓
...
  ↓
尝试重连 (第 5 次，16秒后)
  ↓
连接失败
  ↓
停止重连，显示错误 ✅
```

## 📝 修改的文件

### 1. web/hooks/useAgentRoom.ts

**主要改动**：
- 添加 `urlRef` 和 `usernameRef` 来存储最新值
- 添加 `isReconnecting` 和 `manualDisconnect` 标记
- 重写 `attemptReconnect`，直接创建 WebSocket，不使用 reload
- 修改 `onclose` 逻辑，区分主动断开和异常断开
- 添加 `disconnect` 方法供外部调用
- 重连期间保持 `connected=true`，避免组件卸载

### 2. web/components/ChatRoom.tsx

**主要改动**：
- 引入 `disconnect` 方法
- 断开连接按钮先调用 `disconnect()`，再调用 `onDisconnect()`

### 3. web/app/page.tsx

**主要改动**：
- 移除 `reconnectTrigger` 状态（不再需要）
- 移除 `agentroom-reconnect` 事件监听（不再需要）
- 简化重连逻辑

## 🧪 测试场景

### 场景 1：服务器未运行

```bash
# 不启动 Service，直接连接
连接 → 失败 (1006) → 自动重连 5 次 → 停止 → 显示错误 ✅
```

### 场景 2：服务器中途关闭

```bash
# 连接后，停止 Service (Ctrl+C)
连接成功 → Service 停止 → 自动重连 → Service 重启 → 重连成功 ✅
```

### 场景 3：网络波动

```bash
# 关闭 WiFi 几秒后再打开
连接成功 → WiFi 关闭 → 自动重连（进行中） → WiFi 恢复 → 重连成功 ✅
```

### 场景 4：用户主动断开

```bash
# 点击"断开连接"
连接成功 → 点击断开 → 清理资源 → 返回连接表单 ✅
不会触发自动重连 ✅
```

### 场景 5：刷新页面

```bash
# 按 F5 刷新
连接成功 → 刷新页面 → 自动重连 → 恢复房间 ✅
```

## 🔧 调试日志

现在的日志输出更清晰：

```
# 连接失败场景
❌ WebSocket error occurred
🔌 WebSocket disconnected
Close code: 1006
说明: 异常关闭（无法连接或连接中断）
Manual disconnect: false
🔄 Attempting reconnect (1/5) in 1000ms...
🔄 Reconnecting now...
✅ Reconnected successfully (或继续重试)

# 重复重连保护
⚠️ Already reconnecting, skipping...

# 达到最大次数
❌ Max reconnect attempts reached
重连失败，已尝试 5 次。请手动重新连接。

# 用户主动断开
🔌 Manual disconnect requested
👋 Manual disconnect or unmounting
```

## ✨ 改进总结

1. **✅ 修复无限循环**：不再使用 `reload`，直接创建新连接
2. **✅ 防止重复触发**：使用 `isReconnecting` 标记
3. **✅ 区分断开类型**：主动 vs 异常，分别处理
4. **✅ UI 保持稳定**：重连期间不卸载组件
5. **✅ 清晰的重试策略**：指数退避，最多 5 次
6. **✅ 完善的日志**：每个步骤都有清晰的日志输出

## 🎉 现在可以正常使用了！

- ✅ 不会无限循环重连
- ✅ 网络波动自动恢复
- ✅ 服务器重启自动连接
- ✅ 刷新页面自动恢复
- ✅ 用户断开不会重连
- ✅ 重连失败有明确提示

---

**问题已完全修复！** 🎊
