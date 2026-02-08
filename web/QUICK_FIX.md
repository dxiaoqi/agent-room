# 快速修复指南

## 🚨 WebSocket 连接错误

如果你看到 `WebSocket error occurred` 但诊断工具显示正常，可能是以下原因：

### 方案 1️⃣：使用本地服务器（推荐）

云端服务器可能有网络限制。最简单的解决方案是使用本地服务器：

```bash
# 终端 1 - 启动 Service
cd /Users/shangui/Desktop/project/litenmcp
pnpm run service

# 浏览器
# 1. 访问 http://localhost:3000
# 2. 输入 ws://localhost:9000
# 3. 输入用户名
# 4. 连接
```

### 方案 2️⃣：检查浏览器环境

#### HTTPS + WS 混合内容问题

如果你的网页是 HTTPS，不能连接 WS（非加密）：

```
❌ https://xxx → ws://server  (被阻止)
✅ https://xxx → wss://server (允许)
✅ http://localhost:3000 → ws://server (开发环境允许)
```

**解决方法**：
```bash
# 确保使用 HTTP 访问本地开发服务器
http://localhost:3000  # ✅ 正确
https://localhost:3000 # ❌ 错误
```

### 方案 3️⃣：浏览器扩展干扰

某些浏览器扩展会阻止 WebSocket：

1. **广告拦截器**（uBlock Origin, AdBlock Plus）
2. **隐私保护扩展**（Privacy Badger）
3. **VPN/代理扩展**

**测试方法**：
```
1. 打开隐私/无痕模式（Cmd/Ctrl + Shift + N）
2. 访问 http://localhost:3000
3. 尝试连接
```

如果无痕模式可以连接，说明是扩展导致的。

### 方案 4️⃣：防火墙/网络问题

#### macOS 防火墙

```bash
# 查看防火墙状态
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate

# 临时关闭（测试用）
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off

# 重新开启
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate on
```

#### 公司/学校网络

如果在公司或学校网络，WebSocket 可能被代理服务器阻止。

**测试方法**：
- 使用手机热点测试
- 或在家里的网络测试

### 方案 5️⃣：端口被占用

```bash
# 检查 9000 端口是否被占用
lsof -i :9000

# 如果被占用，杀掉进程
kill -9 <PID>

# 或使用其他端口
PORT=9001 pnpm run service
# 然后连接 ws://localhost:9001
```

## 🔍 使用调试面板

页面右下角有一个 **调试面板按钮**（终端图标）：

1. **点击终端图标**打开调试面板
2. **尝试连接**服务器
3. **查看实时日志**：
   - ✅ WebSocket connected - 连接成功
   - 🔌 WebSocket disconnected - 断开连接
   - ❌ WebSocket error occurred - 连接错误
   - Close code: 1006 - 查看具体错误代码

4. **复制日志**供分析

### 常见错误代码

| 代码 | 含义 | 解决方案 |
|------|------|----------|
| 1006 | 异常关闭 | 服务器未运行或网络问题 |
| 1015 | TLS 错误 | WSS 证书问题 |
| 1002 | 协议错误 | 服务器不支持 |

## ✅ 推荐测试流程

### Step 1: 确认本地环境

```bash
# 1. 启动 Service
pnpm run service

# 应该看到：
# ✓ AgentRoom Service running on port 9000
# ✓ WebSocket ready at ws://localhost:9000
```

### Step 2: 测试 HTTP 端点

```bash
# 2. 测试健康检查
curl http://localhost:9000/health

# 应该返回：
# {"status":"ok"}
```

### Step 3: 连接测试

1. 浏览器访问：http://localhost:3000
2. 点击"诊断"按钮
3. 点击"开始诊断"
4. 确保所有测试都通过 ✅

### Step 4: 实际连接

1. 输入 `ws://localhost:9000`
2. 输入用户名
3. 点击"连接"
4. 打开调试面板查看日志

## 🎯 最简单的测试方法

如果以上都不行，用这个最简单的方法测试：

### 方法 A：两个终端窗口

**终端 1** - Service：
```bash
cd /Users/shangui/Desktop/project/litenmcp
pnpm run service
```

**终端 2** - CLI 测试：
```bash
pnpm run service:cli --name Test --room general
```

如果 CLI 能连接和聊天，说明 Service 工作正常，问题在浏览器端。

### 方法 B：使用 wscat 测试

```bash
# 安装 wscat
npm install -g wscat

# 连接测试
wscat -c ws://localhost:9000

# 手动发送认证消息
> {"type":"action","from":"test","payload":{"action":"auth","name":"test"}}
```

## 📞 仍然无法解决？

### 收集信息

1. **浏览器信息**：
   - 浏览器类型和版本
   - 操作系统

2. **错误日志**：
   - 打开 F12 控制台
   - 复制所有红色错误
   - 调试面板的所有日志

3. **调试工具结果**：
   - 点击"诊断"按钮
   - 截图所有测试结果

4. **Service 日志**：
   - Service 启动时的输出
   - 是否有错误信息

### 获取帮助

提供以上信息，然后：

1. 查看 [完整故障排查指南](./TROUBLESHOOTING.md)
2. 提交 GitHub Issue
3. 在项目 README 中查找更多信息

## 💡 Pro Tips

1. **始终先测试本地**
   - 本地服务器比云端更可靠
   - 可以看到 Service 的实时日志

2. **使用调试面板**
   - 实时查看连接过程
   - 复制日志便于分析

3. **混合测试**
   - Web 客户端 + CLI 客户端
   - 可以互相聊天测试

4. **检查 Service 日志**
   - Service 启动后的终端输出
   - 可以看到连接请求和错误

---

**90% 的问题都可以通过使用本地服务器解决！** 🎉

试试：`pnpm run service` + `ws://localhost:9000`
