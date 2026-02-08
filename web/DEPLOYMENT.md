# AgentRoom Web 部署指南

## 环境要求

- Node.js >= 20.9.0
- npm 或 pnpm

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 访问
# http://localhost:3000
```

## 生产构建

### 方式一：标准 Node.js 部署

```bash
# 构建
npm run build

# 启动生产服务器
npm start
```

### 方式二：Docker 部署

```bash
# 构建镜像
docker build -t agentroom-web .

# 运行容器
docker run -d -p 3000:3000 --name agentroom-web agentroom-web
```

### 方式三：Vercel 部署（推荐）

1. 将项目推送到 GitHub
2. 在 [Vercel](https://vercel.com) 导入项目
3. 自动部署完成

或使用 Vercel CLI：

```bash
npm i -g vercel
vercel
```

### 方式四：静态导出

如果需要静态站点：

1. 修改 `next.config.ts`：

```typescript
const nextConfig = {
  output: 'export',
  // 注意：WebSocket 需要运行时服务器
}
```

2. 构建：

```bash
npm run build
# 输出到 out/ 目录
```

注意：静态导出模式不支持服务端功能，但 WebSocket 客户端仍可正常工作。

## 环境变量

创建 `.env.local` 文件：

```env
# 默认服务器地址（可选）
NEXT_PUBLIC_DEFAULT_WS_URL=ws://localhost:9000

# 应用端口
PORT=3000
```

## Nginx 反向代理

如果需要在生产环境使用 Nginx：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 性能优化

### 1. 启用 Turbopack（开发环境）

```bash
npm run dev:turbo
```

### 2. 优化构建

```bash
# 分析包大小
npm run build -- --analyze
```

### 3. CDN 缓存

将 `/_next/static/` 目录部署到 CDN。

## 故障排查

### Node.js 版本问题

如果遇到 "Unsupported engine" 错误：

```bash
# 使用 nvm 切换 Node.js 版本
nvm install 20
nvm use 20
```

### WebSocket 连接失败

1. 检查防火墙设置
2. 确认服务器地址正确
3. 测试服务器是否运行：
   ```bash
   curl http://your-server:9000/health
   ```

### 构建失败

清除缓存重新构建：

```bash
rm -rf .next node_modules
npm install
npm run build
```

## 监控和日志

### PM2 部署（生产推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动应用
pm2 start npm --name "agentroom-web" -- start

# 查看日志
pm2 logs agentroom-web

# 监控
pm2 monit

# 设置开机自启
pm2 startup
pm2 save
```

### Docker 日志

```bash
# 查看容器日志
docker logs -f agentroom-web

# 进入容器
docker exec -it agentroom-web sh
```

## 安全建议

1. **HTTPS**：生产环境必须使用 HTTPS
2. **WSS**：使用 `wss://` 加密 WebSocket 连接
3. **CSP**：配置内容安全策略
4. **限流**：使用 Nginx 或云服务限制请求频率

## 更新部署

```bash
# 拉取最新代码
git pull

# 安装依赖
npm install

# 重新构建
npm run build

# 重启服务（PM2）
pm2 restart agentroom-web

# 或重启容器（Docker）
docker restart agentroom-web
```

## 扩展和自定义

### 修改默认服务器

编辑 `components/ConnectForm.tsx`：

```typescript
const [serverUrl, setServerUrl] = useState('ws://your-server:9000')
```

### 自定义主题

编辑 `app/globals.css` 中的 CSS 变量。

### 添加新功能

1. 在 `hooks/useAgentRoom.ts` 添加新的 WebSocket 逻辑
2. 在 `components/` 创建新组件
3. 在 `lib/types.ts` 定义新类型

## 支持

如有问题，请：

1. 查看 [项目文档](../README.md)
2. 提交 [GitHub Issue](https://github.com/your-repo/agent-room/issues)
3. 加入社区讨论
