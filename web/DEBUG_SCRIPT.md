# 浏览器调试脚本

在浏览器控制台中运行以下脚本来诊断问题：

## 1. 检查 localStorage

```javascript
// 查看所有 localStorage 数据
console.log('=== localStorage 数据 ===');
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  const value = localStorage.getItem(key);
  console.log(`${key}:`, value);
}

// 检查 session 数据
const session = localStorage.getItem('agentroom_session');
if (session) {
  const data = JSON.parse(session);
  console.log('Session data:', data);
  console.log('Username:', data.username);
  console.log('Username length:', data.username.length);
  console.log('Username trimmed:', data.username.trim());
}
```

## 2. 检查输入框的值

```javascript
// 查找输入框
const inputs = document.querySelectorAll('input[type="text"], input:not([type])');
console.log('=== 输入框数据 ===');
inputs.forEach((input, i) => {
  console.log(`Input ${i}:`, {
    placeholder: input.placeholder,
    value: input.value,
    valueLength: input.value.length
  });
});
```

## 3. 清除所有数据并重新测试

```javascript
// 清除所有 localStorage
console.log('清除 localStorage...');
localStorage.clear();
console.log('已清除');

// 刷新页面
setTimeout(() => {
  location.reload();
}, 1000);
```

## 4. 手动触发连接

```javascript
// 设置测试用户名和服务器
const testUrl = 'ws://8.140.63.143:9000';
const testUsername = 'TestUser123';

// 查找输入框
const inputs = document.querySelectorAll('input');
inputs[0].value = testUrl;  // 服务器地址
inputs[1].value = testUsername;  // 用户名

// 触发 change 事件让 React 知道值改变了
inputs.forEach(input => {
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
});

// 查找并点击连接按钮
setTimeout(() => {
  const buttons = document.querySelectorAll('button');
  const connectBtn = Array.from(buttons).find(btn => btn.textContent.includes('连接'));
  if (connectBtn) {
    console.log('点击连接按钮...');
    connectBtn.click();
  }
}, 500);
```

## 5. 监听 WebSocket 连接

```javascript
// 拦截 WebSocket 创建
const OriginalWebSocket = window.WebSocket;
window.WebSocket = function(...args) {
  console.log('🔌 创建 WebSocket:', args[0]);
  const ws = new OriginalWebSocket(...args);
  
  ws.addEventListener('open', () => {
    console.log('✅ WebSocket 已连接');
  });
  
  ws.addEventListener('message', (event) => {
    console.log('📨 收到消息:', event.data);
  });
  
  ws.addEventListener('error', (event) => {
    console.error('❌ WebSocket 错误:', event);
  });
  
  ws.addEventListener('close', (event) => {
    console.log('🔌 WebSocket 已关闭:', event.code, event.reason);
  });
  
  return ws;
};

console.log('WebSocket 监听已启动');
```

## 使用方法

1. 打开浏览器开发者工具（F12）
2. 进入 Console 标签
3. 复制粘贴上面的脚本
4. 按回车执行
5. 查看输出的调试信息

## 常见问题排查

### 问题1：用户名为空

```javascript
// 检查是否有空用户名
const session = JSON.parse(localStorage.getItem('agentroom_session') || '{}');
if (!session.username || session.username.trim() === '') {
  console.error('❌ 用户名为空！');
  localStorage.removeItem('agentroom_session');
  location.reload();
}
```

### 问题2：连接按钮无响应

```javascript
// 检查按钮是否被禁用
const buttons = document.querySelectorAll('button');
buttons.forEach((btn, i) => {
  console.log(`Button ${i}:`, {
    text: btn.textContent,
    disabled: btn.disabled,
    classList: Array.from(btn.classList)
  });
});
```

### 问题3：React 状态未更新

```javascript
// 强制触发输入事件
const inputs = document.querySelectorAll('input');
inputs.forEach(input => {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  ).set;
  
  nativeInputValueSetter.call(input, input.value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
```
