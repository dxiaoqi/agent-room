# AgentRoom Web Client

基于 Next.js 和 shadcn/ui 的 AgentRoom 实时聊天网页客户端。

## 功能特性

### 核心功能
- ✨ 现代化 UI 设计（shadcn/ui 风格）
- 🔌 支持 WebSocket 和 SSE 连接
- 💬 实时聊天消息
- 🏠 多房间管理（创建、加入、离开）
- 👥 用户列表和房间成员实时显示
- 🎨 深色/浅色主题自适应
- 📱 响应式设计

### 增强功能 🆕
- 💾 **Session 持久化** - 刷新页面自动恢复连接
- 💗 **心跳机制** - 保持连接活跃（30s 间隔）
- 🔄 **自动重连** - 断线后智能重连（指数退避）
- 🏠 **房间状态恢复** - 自动加入上次的房间
- 🎯 **流畅的交互动画**
  - 按钮悬停缩放和阴影
  - 图标旋转和移动动画
  - 输入框聚焦效果
  - 自定义动画库

### 开发工具
- 🔧 **浮动调试面板** - 实时查看 WebSocket 日志
- 🔍 **连接诊断工具** - 一键测试连接问题
- 📋 **日志复制** - 方便分析和报告

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

### 构建生产版本

```bash
npm run build
npm start
```

## 使用说明

### 1. 连接服务器

启动应用后，输入：
- **服务器地址**：WebSocket 地址（如 `ws://localhost:9000`）
- **用户名**：你的显示名称

点击"连接"按钮。

### 2. 加入房间

连接成功后：
- 在左侧边栏查看可用房间列表
- 点击房间名称加入
- 或点击"创建"按钮创建新房间

### 3. 聊天

- 在消息输入框输入文字
- 按 Enter 或点击发送按钮
- 查看右侧边栏的房间成员列表

### 4. 管理

- **刷新**：更新房间列表
- **创建房间**：输入房间 ID 和名称
- **离开房间**：点击房间头部的"离开"按钮
- **断开连接**：左侧边栏底部的"断开连接"按钮

## 连接到 AgentRoom Service

### 本地服务

```bash
# 在项目根目录启动 Service
pnpm run service

# 或使用全局安装的版本
agent-room-service
```

然后在 Web 界面输入：`ws://localhost:9000`

### 公共服务器

项目默认配置了公共测试服务器：`ws://8.140.63.143:9000`

你可以直接使用快捷按钮连接。

## 技术栈

- **Next.js 16** - React 框架（App Router）
- **TypeScript** - 类型安全
- **Tailwind CSS** - 样式框架
- **shadcn/ui** - UI 组件库
- **Lucide React** - 图标库
- **WebSocket API** - 实时通信

## 项目结构

```
web/
├── app/                    # Next.js App Router
│   ├── page.tsx           # 主页面
│   ├── layout.tsx         # 布局
│   └── globals.css        # 全局样式
├── components/            # React 组件
│   ├── ui/               # shadcn/ui 组件
│   ├── ConnectForm.tsx   # 连接配置表单
│   └── ChatRoom.tsx      # 聊天室主界面
├── hooks/                 # React Hooks
│   └── useAgentRoom.ts   # AgentRoom 连接管理
├── lib/                   # 工具库
│   ├── types.ts          # 类型定义
│   └── utils.ts          # 工具函数
└── components.json        # shadcn/ui 配置

```

## 开发指南

### 添加新的 shadcn/ui 组件

```bash
npx shadcn@latest add [component-name]
```

### 自定义样式

编辑 `app/globals.css` 中的 CSS 变量：

```css
:root {
  --primary: 0 0% 9%;
  --background: 0 0% 100%;
  /* ... 更多变量 */
}
```

### WebSocket 协议

本客户端实现了 AgentRoom Service 协议，支持：

- 认证（auth）
- 房间操作（join, leave, create, list）
- 聊天消息（chat）
- 系统事件（system）

详见 `lib/types.ts` 和 `hooks/useAgentRoom.ts`。

## 部署

### Vercel（推荐）

```bash
npm i -g vercel
vercel
```

### Docker

```bash
# 构建镜像
docker build -t agentroom-web .

# 运行容器
docker run -p 3000:3000 agentroom-web
```

### 静态导出

```bash
npm run build
# 输出到 out/ 目录
```

## 浏览器兼容性

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- 支持 WebSocket 的现代浏览器

## 功能文档

- 📖 [功能列表](./FEATURES.md) - 完整功能说明和使用场景
- 💾 [Session 指南](./SESSION_GUIDE.md) - 持久化、心跳和重连详解
- 🎨 [交互指南](./INTERACTION_GUIDE.md) - 动画效果和交互设计
- 🔧 [快速修复](./QUICK_FIX.md) - 常见问题快速解决

## 故障排查

遇到连接问题？查看详细的 [故障排查指南](./TROUBLESHOOTING.md)

**快速检查**：

```bash
# 1. 确认 Service 运行
curl http://localhost:9000/health

# 2. 查看浏览器控制台（F12）
# 3. 尝试公共服务器：ws://8.140.63.143:9000
```

## License

MIT
